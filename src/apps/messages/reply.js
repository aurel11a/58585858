// Ответы контактов в мессенджере через экстра-API.
// Сюжет персонаж получает, только если его имя есть в недавних сообщениях истории;
// иначе он опирается лишь на дату и время (и может вспомнить праздник).

import { getLanguage } from '../../i18n.js';
import { ctx, LOG } from '../../core/context.js';
import { getApi } from '../../core/settings.js';
import { displayName, findContact, findGroup, getChat, getGroupChat, nextTs, resolveContact } from '../../core/contacts.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { getStoryClock, getStoryNow } from '../../core/story-clock.js';
import { formatStory, isPresent, storyWindow } from '../../core/presence.js';
import { showBanner } from '../../ui/banner.js';
import { historyText, normalizeEntry, VOICE_RULE } from '../../core/voice.js';
import { generateWithPhotos } from '../../core/vision.js';
import { tr } from '../../i18n.js';
import { memoRule, saveMemo } from './memo.js';
import { chatImageFromRaw, chatPhotoRule, startChatImages } from '../twitter/images.js';

const PHONE_HISTORY = 40;

/** @typedef {{ type: 'contact'|'group', id: string }} ChatTarget */

const keyOf = (target) => `${target.type}:${target.id}`;

/** chatKey → { error } ; наличие ключа = персонаж «печатает» */
const pending = new Map();
const errors = new Map();
/** юзер дописал, пока шёл запрос — после ответа спросим ещё раз */
const dirty = new Set();

export const isTyping = (target) => pending.has(keyOf(target));
export const replyError = (target) => errors.get(keyOf(target)) ?? null;

// ---------- промпт ----------

const clean = (text) => String(text ?? '').replace(/\s+\n/g, '\n').trim();

/** «Thursday, November 14, 2024, 14:15» — по-английски, модели так однозначнее */
export function momentLine() {
    const clock = getStoryClock();
    const day = clock.date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${day}, ${clock.time}`;
}

/** Язык переписки — по последним сообщениям чата в телефоне или истории */
export function chatLanguage(messages) {
    const sample = messages.slice(-6).map(m => m.text).join(' ') + ' ' + (ctx().chat ?? []).slice(-4).map(m => m?.mes || '').join(' ');
    const cyrillic = (sample.match(/[а-яё]/gi) ?? []).length;
    const latin = (sample.match(/[a-z]/gi) ?? []).length;
    if (!cyrillic && !latin) return getLanguage() === 'ru' ? 'Russian' : 'English';
    return cyrillic > latin ? 'Russian' : 'English';
}

export function personBlock(contact) {
    const lines = [`Name: ${contact.name}`, `Handle: ${contact.handle}`];
    if (contact.label) lines.push(`Saved in USER's phone as: ${contact.label}`);
    if (contact.relation) lines.push(`Who they are to USER: ${contact.relation}`);
    if (contact.style) lines.push(`Texting style: ${contact.style}`);
    // персонаж самой истории — подкладываем его карточку целиком
    if (contact.main && contact.charAvatar) {
        const char = ctx().characters.find(c => c.avatar === contact.charAvatar);
        const description = clean(ctx().substituteParams(char?.description || ''));
        const personality = clean(ctx().substituteParams(char?.personality || ''));
        if (description) lines.push(`Character card:\n${description}`);
        if (personality) lines.push(`Personality: ${personality}`);
    }
    return lines.join('\n');
}

export function userBlock() {
    const { name1, substituteParams, powerUserSettings } = ctx();
    const persona = clean(substituteParams(powerUserSettings?.persona_description || ''));
    return `USER: ${name1}${persona ? `\n${persona}` : ''}`;
}

export function phoneHistory(data, messages, limit = PHONE_HISTORY) {
    const { name1 } = ctx();
    return messages.slice(-limit).map(m => {
        const who = m.from === 'user' ? name1 : (findContact(data, m.from)?.name ?? '?');
        const time = new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const photo = m.tweet?.image?.prompt ? ` [photo: ${m.tweet.image.prompt}]` : '';
        const shared = m.tweet ? `[shared a tweet by ${m.tweet.name} (${m.tweet.handle}): "${m.tweet.text}"${photo}]${m.text ? ' ' : ''}` : '';
        const sentPhoto = m.photo ? `[sent a photo]${m.text ? ' ' : ''}`
            : m.image ? `[sent a photo: ${m.image.prompt}]${m.text ? ' ' : ''}` : '';
        const quoted = m.replyTo && messages.find(q => q.id === m.replyTo);
        const reply = quoted ? `(replying to ${quoted.from === 'user' ? name1 : (findContact(data, quoted.from)?.name ?? '?')}: "${quoted.image ? '[photo]' : quoted.text}") ` : '';
        return `[${time}] ${who}: ${reply}${shared}${sentPhoto}${historyText(m)}`;
    }).join('\n');
}

const RULES = `Stay fully in character. Text exactly like this person would on a phone: their tone, message length, punctuation, emoji, slang. Never narrate actions, never use asterisks, never describe — only the texts themselves.
Use the CURRENT MOMENT: time of day, weekday, and if this date is a holiday or notable day in this setting, it may come up naturally.
Only know what you could know. If STORY is not given, you were not part of recent events: do not reference them.
${VOICE_RULE}`;

const rules = () => [RULES, chatPhotoRule()].filter(Boolean).join('\n');

function directPrompt(data, contact, messages) {
    const { name1 } = ctx();
    const window = storyWindow();
    const present = window.length && isPresent(contact, window);

    const system = `You are ${contact.name}, texting ${name1} (USER) in an ongoing story.
${rules()}
Reply with ONLY JSON: {"messages": ["text" or {"voice": "..."}, ...]} — 1 to 3 separate messages, as you would actually send them. Write them in ${chatLanguage(messages)}.
${memoRule()}`;

    const sections = [
        `YOU:\n${personBlock(contact)}`,
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        present ? `STORY (recent events you were part of or were mentioned in):\n${formatStory(window)}` : '',
        `PHONE CHAT WITH ${name1}:\n${phoneHistory(data, messages) || '(no messages yet)'}`,
    ].filter(Boolean);

    return [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }];
}

function groupPrompt(data, group, members, messages) {
    const { name1 } = ctx();
    const window = storyWindow();
    const present = members.filter(m => window.length && isPresent(m, window));

    const system = `You write the next messages in the group chat "${group.name}" of an ongoing story. Members: ${members.map(m => m.name).join(', ')} and ${name1} (USER). You never write for USER.
${rules()}
Only the members listed as present in STORY know those events; the others don't.
Like a real group chat, NOT everyone answers. Only members who were addressed, who care about the topic, or who would naturally jump in reply — often just one person, sometimes two or three. The rest stay silent. If nobody would realistically answer right now, return an empty list.
Reply with ONLY JSON: {"messages": [{"from": "member name", "text": "..."} or {"from": "member name", "voice": "..."}]} — 0 to 4 messages. Write them in ${chatLanguage(messages)}.
${memoRule()}`;

    const sections = [
        `MEMBERS:\n${members.map(personBlock).join('\n\n')}`,
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        present.length ? `STORY (recent events; present: ${present.map(m => m.name).join(', ')}):\n${formatStory(window)}` : '',
        `GROUP CHAT:\n${phoneHistory(data, messages) || '(no messages yet)'}`,
    ].filter(Boolean);

    return [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }];
}

/**
 * Фото из недавней переписки — модель их «видит». Свои фото юзера и картинки пересланных твитов.
 * @returns {{ path: string, label: string }[]}
 */
function recentPhotos(data, messages) {
    const { name1 } = ctx();
    const photos = [];
    for (const m of messages.slice(-12)) {
        const who = m.from === 'user' ? name1 : (findContact(data, m.from)?.name ?? '?');
        if (m.photo) photos.push({ path: m.photo, label: `Photo sent by ${who}${m.text ? ` with the caption "${m.text}"` : ''}:` });
        if (m.tweet?.image?.path) photos.push({ path: m.tweet.image.path, label: `Photo in the tweet ${who} shared (by ${m.tweet.name}):` });
    }
    return photos;
}

// ---------- разбор ответа ----------

/** JSON из ответа (сообщения + заметка); если модель прислала просто текст — это одно сообщение */
function parseReply(raw) {
    const text = String(raw ?? '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(parsed.messages)) return { messages: parsed.messages, memo: parsed.memo };
        } catch { /* ниже — как простой текст */ }
    }
    return { messages: text ? [text.replace(/^["']|["']$/g, '')] : [], memo: null };
}

// ---------- запрос ----------

/**
 * Попросить ответ в чате. Пока идёт запрос, чат «печатает».
 * @param {ChatTarget} target
 * @param {(target: ChatTarget) => boolean} isOpen  открыт ли сейчас этот чат (для счётчика непрочитанных)
 */
export async function requestReply(target, isOpen) {
    const key = keyOf(target);
    if (pending.has(key)) {
        dirty.add(key);
        return;
    }

    const data = getPhoneData();
    if (!data) return;
    const isGroup = target.type === 'group';
    const group = isGroup ? findGroup(data, target.id) : null;
    const contact = isGroup ? null : findContact(data, target.id);
    const members = group ? group.memberIds.map(id => findContact(data, id)).filter(Boolean) : [];
    if (isGroup ? !members.length : !contact) return;

    const chat = isGroup ? getGroupChat(data, target.id, true) : getChat(data, target.id, true);
    const prompt = isGroup ? groupPrompt(data, group, members, chat.messages) : directPrompt(data, contact, chat.messages);

    pending.set(key, true);
    errors.delete(key);
    notifyDataChanged();

    try {
        const raw = await generateWithPhotos(getApi(), prompt, recentPhotos(data, chat.messages), 1500);
        const { messages: replies, memo } = parseReply(raw);
        const base = getStoryNow().getTime();
        let added = 0;
        const photoIds = [];

        for (const item of replies) {
            const image = chatImageFromRaw(item?.photo);
            const entry = normalizeEntry(item) ?? (image ? { text: '', voice: false } : null);
            if (!entry) continue;
            const { text } = entry;
            const voice = entry.voice && !image;
            let from = contact?.id;
            if (isGroup) {
                const sender = resolveContact(data, item?.from);
                if (!sender || !group.memberIds.includes(sender.id)) continue;
                from = sender.id;
            }
            // сюжетные часы стоят на месте — разносим пузыри на секунды, чтобы порядок не путался
            const id = `msg_${Date.now()}_${added}`;
            chat.messages.push({ id, from, text, ...(voice ? { voice: true } : {}), ...(image ? { image } : {}), ts: nextTs(chat, base) });
            if (image) photoIds.push(id);
            added++;
        }

        // обмен состоялся — позже запишем заметку для основной ролевой
        if (added) saveMemo(target, memo);
        startChatImages(photoIds);
        if (added && !isOpen(target)) {
            chat.unread = (chat.unread || 0) + added;
            const last = chat.messages[chat.messages.length - 1];
            const sender = findContact(data, last.from);
            showBanner({
                target,
                title: isGroup ? group.name : displayName(contact),
                text: (isGroup ? `${displayName(sender)}: ` : '') + (last.image ? tr('photoMsg') : last.voice ? tr('voiceMessage') : last.text),
                contact: isGroup ? null : contact,
            });
        }
    } catch (error) {
        console.warn(LOG, 'reply', error);
        errors.set(key, error?.cause?.message || error?.message || String(error));
    } finally {
        pending.delete(key);
        notifyDataChanged();
    }

    if (dirty.delete(key)) requestReply(target, isOpen);
}

export function clearReplyError(target) {
    errors.delete(keyOf(target));
}
