// Память о личных переписках для основной ролевой.
// Вместе с ответом в телефоне экстра-API пишет короткую заметку «о чём говорили»
// и оценивает важность (в том же запросе). Когда собеседник появляется в истории, а переписка была важной
// и недавней, основная модель получает напоминание — персонажи это помнят.

import { ctx, MODULE } from '../../core/context.js';
import { getSettings, SETTINGS_EVENT } from '../../core/settings.js';
import { getChat, getGroupChat } from '../../core/contacts.js';
import { getPhoneData, savePhoneData } from '../../core/store.js';
import { getStoryNow } from '../../core/story-clock.js';
import { isPresent } from '../../core/presence.js';

const REMINDER_KEY = `${MODULE}_dm_memo`;
/** Важная переписка «помнится» столько сюжетного времени */
const RECENT_MS = 48 * 60 * 60 * 1000;
/** Персонаж «появился», если его имя есть в стольких последних сообщениях истории */
const SCENE_MESSAGES = 4;

const enabled = () => getSettings().dmMemo !== false;

// ---------- заметка ----------

/**
 * Кусок промпта ответа: вместе с сообщениями модель сразу пишет заметку о переписке
 * (отдельного запроса нет). Пусто, если напоминания выключены.
 */
export function memoRule() {
    if (!enabled()) return '';
    return `Also add "memo": {"importance": "none|minor|important", "note": "..."} — a private note for the story narrator about this phone conversation INCLUDING the messages you are sending now.
- "important": plans, promises, requests, conflicts, confessions, secrets, news — things that could matter when these people meet.
- "minor": small talk with a detail worth remembering. "none": nothing worth remembering.
"note": 1-2 sentences in English, past tense, explicit names, the latest state of the conversation (what was agreed, what is unresolved).`;
}

/**
 * Сохранить заметку из ответа модели.
 * @param {{ type: 'contact'|'group', id: string }} target
 * @param {any} raw  поле "memo" из ответа
 */
export function saveMemo(target, raw) {
    const data = getPhoneData();
    if (!data || !enabled() || !raw || typeof raw !== 'object') return;
    const chat = target.type === 'group' ? getGroupChat(data, target.id) : getChat(data, target.id);
    // зеркальные реплики из истории и так в контексте — заметка только о «телефонном»
    const last = chat?.messages.filter(m => !m.src).at(-1);
    if (!last) return;
    const importance = ['none', 'minor', 'important'].includes(raw.importance) ? raw.importance : 'none';
    chat.memo = { importance, note: String(raw.note || '').trim(), upTo: last.id, ts: last.ts };
    savePhoneData();
    refreshReminder();
}

// ---------- напоминание основной модели ----------

/** Последние сообщения истории — кто сейчас «в сцене» */
function sceneWindow() {
    const { chat, name1 } = ctx();
    return (chat ?? [])
        .filter(m => m?.mes && !m.is_system)
        .slice(-SCENE_MESSAGES)
        .map(m => ({ name: m.is_user ? name1 : m.name, text: String(m.mes), isUser: Boolean(m.is_user) }));
}

function agoText(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function refreshReminder() {
    const { setExtensionPrompt, chatMetadata, name1 } = ctx();
    // данные не создаём — читаем, что есть
    const data = chatMetadata?.[MODULE];
    const lines = [];

    if (enabled() && data?.chats?.length) {
        const window = sceneWindow();
        const now = getStoryNow().getTime();
        const present = new Set((data.contacts ?? []).filter(c => isPresent(c, window)).map(c => c.id));

        for (const chat of data.chats) {
            const memo = chat.memo;
            if (!memo || memo.importance !== 'important' || !memo.note) continue;
            if (now - memo.ts > RECENT_MS) continue;

            if (chat.contactId && present.has(chat.contactId)) {
                const contact = data.contacts.find(c => c.id === chat.contactId);
                lines.push(`- ${contact?.name} ↔ ${name1}, texted ${agoText(now - memo.ts)}: ${memo.note}`);
            } else if (chat.groupId) {
                const group = data.groups?.find(g => g.id === chat.groupId);
                const here = group?.memberIds.filter(id => present.has(id)) ?? [];
                if (here.length) lines.push(`- group chat "${group.name}", ${agoText(now - memo.ts)}: ${memo.note}`);
            }
        }
    }

    const text = lines.length
        ? `[Phone memory — recent private texts with characters who are in the scene now. They remember these; bring them up only if it fits naturally, never recite them.]\n${lines.join('\n')}`
        : '';
    // 1 — IN_CHAT, глубина 1: рядом с последним сообщением
    setExtensionPrompt(REMINDER_KEY, text, 1, 1);
}

export function initMemo() {
    const { eventSource, eventTypes } = ctx();
    for (const type of ['GENERATION_STARTED', 'CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) {
        if (eventTypes[type]) eventSource.on(eventTypes[type], refreshReminder);
    }
    document.addEventListener(SETTINGS_EVENT, (e) => {
        if (/** @type {CustomEvent} */ (e).detail?.key === 'dmMemo') refreshReminder();
    });
    refreshReminder();
}
