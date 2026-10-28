// Контакты пишут первыми. После нового сообщения истории с шансом из настроек
// спрашиваем модель: кто из людей в телефоне сейчас напишет юзеру и что.
// Кто «был в сцене», считаем сами (имя в тексте) и прямо говорим модели —
// остальные знают только общий фон своей жизни, дату и время.

import { ctx, LOG } from '../../core/context.js';
import { generate } from '../../core/api.js';
import { getApi, getSettings } from '../../core/settings.js';
import { displayName, findGroupByName, getChat, getGroupChat, nextTs, resolveContact, findContact } from '../../core/contacts.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { getStoryClock, getStoryNow } from '../../core/story-clock.js';
import { formatStory, isPresent, storyWindow } from '../../core/presence.js';
import { chatLanguage, momentLine, personBlock, phoneHistory, userBlock } from './reply.js';
import { showBanner } from '../../ui/banner.js';
import { memoRule, saveMemo } from './memo.js';
import { normalizeEntry, VOICE_RULE } from '../../core/voice.js';
import { REAL_LIFE_TEXTING } from '../../core/realism.js';
import { tr } from '../../i18n.js';

/** Сколько сообщений истории должно пройти после чьей-то инициативы */
const COOLDOWN_MESSAGES = 3;
/** Ночью (00–06 по сюжетным часам) люди пишут реже */
const NIGHT_FACTOR = 0.3;
const RECENT_PHONE_MESSAGES = 4;

let busy = false;

const SYSTEM_PROMPT = `You decide whether anyone in USER's phone texts USER first right now, in an ongoing roleplay story.
Look at each contact's life, relationship with USER, the CURRENT MOMENT and their recent phone messages. Usually one person writes, sometimes two; if nobody would realistically text right now, return an empty list.

KNOWLEDGE RULE — strict:
- Contacts marked "present: yes" were part of the recent STORY or were mentioned in it; they may react to those events.
- Contacts marked "present: no" were NOT there. They do not know what exactly happened in the scene. They can only write from their own life, the general recent context of their relationship with USER, the time, the weekday, a holiday on this date, or continue their phone conversation.

Each texter writes in their own texting style. Never narrate, never use asterisks — only the texts themselves.
People text first for real reasons (a need, worry, news, a plan, missing someone), not to entertain.
${REAL_LIFE_TEXTING}
${VOICE_RULE}
A group chat message is allowed if it fits (someone posts in the family chat, etc.).
Reply with ONLY JSON:
{"messages": [{"from": "exact contact name", "to": "direct" or "exact group name", "texts": ["text" or {"voice": "..."}, ...]}]}
Write the texts in {{language}}.`;

/** Заметка для основной ролевой — в том же ответе, у каждой переписки своя */
const memoField = () => (memoRule()
    ? `\nEach item may also have "memo": {"importance": "none|minor|important", "note": "..."} — a private note for the story narrator about that conversation including these new texts. "important": plans, promises, requests, conflicts, confessions, secrets, news; "minor": a detail worth remembering; "none": nothing. "note": 1-2 sentences in English, past tense, explicit names.`
    : '');

function isNight() {
    const hour = Number(getStoryClock().time.slice(0, 2));
    return hour < 6;
}

function contactsSection(data, window) {
    return data.contacts.map(contact => {
        const present = window.length > 0 && isPresent(contact, window);
        const chat = getChat(data, contact.id);
        const recent = chat?.messages.length ? `\nRecent texts with USER:\n${phoneHistory(data, chat.messages, RECENT_PHONE_MESSAGES)}` : '';
        return `${personBlock(contact)}\npresent: ${present ? 'yes' : 'no'}${recent}`;
    }).join('\n\n---\n\n');
}

function groupsSection(data) {
    return data.groups.map(group => {
        const members = group.memberIds.map(id => findContact(data, id)?.name).filter(Boolean);
        const chat = getGroupChat(data, group.id);
        const recent = chat?.messages.length ? `\n${phoneHistory(data, chat.messages, RECENT_PHONE_MESSAGES)}` : '';
        return `"${group.name}" — members: ${members.join(', ')}${recent}`;
    }).join('\n\n');
}

function buildPrompt(data) {
    const window = storyWindow();
    const anyPresent = data.contacts.some(c => window.length && isPresent(c, window));

    const sections = [
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        `CONTACTS:\n${contactsSection(data, window)}`,
        data.groups.length ? `GROUP CHATS:\n${groupsSection(data)}` : '',
        anyPresent ? `STORY (recent events — only "present: yes" contacts know them):\n${formatStory(window)}` : '',
    ].filter(Boolean);

    const system = SYSTEM_PROMPT.replace('{{language}}', chatLanguage([])) + memoField();
    return [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }];
}

function parseReply(raw) {
    const text = String(raw ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed.messages) ? parsed.messages : [];
    } catch {
        return [];
    }
}

/**
 * Разложить ответ модели по чатам.
 * @param {(target: {type: string, id: string}) => boolean} isOpen
 * @returns {number} сколько сообщений пришло
 */
function applyMessages(data, items, isOpen) {
    const base = getStoryNow().getTime();
    let total = 0;

    for (const item of items) {
        const sender = resolveContact(data, item?.from);
        if (!sender) continue;
        const texts = (Array.isArray(item.texts) ? item.texts : [item.text]).map(normalizeEntry).filter(Boolean);
        if (!texts.length) continue;

        const to = String(item.to ?? 'direct').trim();
        const group = to.toLowerCase() !== 'direct' ? findGroupByName(data, to) : null;
        if (group && !group.memberIds.includes(sender.id)) continue;

        const target = group ? { type: 'group', id: group.id } : { type: 'contact', id: sender.id };
        const chat = group ? getGroupChat(data, group.id, true) : getChat(data, sender.id, true);
        for (const { text, voice } of texts) {
            chat.messages.push({ id: `msg_${Date.now()}_${total}`, from: sender.id, text, ...(voice ? { voice: true } : {}), ts: nextTs(chat, base) });
            total++;
        }

        saveMemo(target, item.memo);
        if (!isOpen(target)) {
            chat.unread = (chat.unread || 0) + texts.length;
            showBanner({
                target,
                title: group ? group.name : displayName(sender),
                text: (group ? `${displayName(sender)}: ` : '') + (texts[texts.length - 1].voice ? tr('voiceMessage') : texts[texts.length - 1].text),
                contact: group ? null : sender,
            });
        }
    }
    return total;
}

/**
 * Вызывается после каждого нового сообщения истории.
 * @param {(target: {type: string, id: string}) => boolean} isOpen  открыт ли сейчас этот чат
 * @param {{ force?: boolean }} [options] force — без броска шанса (для проверки)
 */
export async function maybeInitiate(isOpen, { force = false } = {}) {
    const chance = Number(getSettings().initiativeChance) || 0;
    if (busy || (!chance && !force)) return;

    const data = getPhoneData();
    if (!data?.contacts.length) return;

    const storyLength = ctx().chat?.length ?? 0;
    data.initiative ??= { lastAt: -Infinity };
    if (!force && storyLength - data.initiative.lastAt < COOLDOWN_MESSAGES) return;

    const effective = chance * (isNight() ? NIGHT_FACTOR : 1);
    if (!force && Math.random() * 100 >= effective) return;

    busy = true;
    try {
        const raw = await generate(getApi(), buildPrompt(data));
        const added = applyMessages(data, parseReply(raw), isOpen);
        if (added) {
            data.initiative.lastAt = storyLength;
            notifyDataChanged();
        }
    } catch (error) {
        // без попапов: экстра-API может быть просто не настроен
        console.warn(LOG, 'initiative', error);
    } finally {
        busy = false;
    }
}
