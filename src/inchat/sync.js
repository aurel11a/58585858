// Переписки с юзером из сообщений ролевой → мессенджер телефона, в чат с этим персонажем.
// Это зеркало, а не копия: при каждом изменении истории (новое, правка, свайп, удаление)
// пересобираем story-сообщения заново, так что дублей и «застрявших» версий не бывает.
//
// Сообщение персонажа (владелец — он): (out) Юзер | … — он пишет юзеру, (in) Юзер | … — юзер ему.
// Сообщение юзера (владелец — юзер):   (out) Имя | … — юзер пишет Имени, (in) Имя | … — Имя юзеру.

import { ctx, MODULE } from '../core/context.js';
import { getChat, orderMessages, resolveContact } from '../core/contacts.js';
import { getPhoneData, notifyDataChanged } from '../core/store.js';
import { getStoryNow } from '../core/story-clock.js';
import { getSettings } from '../core/settings.js';
import { isUserName, parseAppendix, parseBlocks } from './blocks.js';

const SRC = 'story';

/**
 * Все реплики переписок с юзером из истории.
 * @returns {{ key: string, contactName: string, from: 'user'|'contact', text: string }[]}
 */
function collectStoryTexts() {
    const { chat, name1 } = ctx();
    const found = [];

    (chat ?? []).forEach((message, index) => {
        if (!message?.mes || message.is_system) return;
        // send_date не меняется при удалении соседних сообщений, в отличие от номера
        const stamp = message.send_date ?? index;

        // сначала блок модели, потом продолжение — в этом порядке переписка и шла
        parseBlocks(message.mes).forEach((block, b) => {
            block.lines.forEach((line, l) => {
                const key = `${SRC}:${stamp}:${b}:${l}`;
                if (message.is_user) {
                    if (isUserName(line.name, name1)) return;
                    found.push({ key, contactName: line.name, from: line.dir === 'out' ? 'user' : 'contact', text: line.text });
                } else if (isUserName(line.name, name1)) {
                    found.push({ key, contactName: message.name, from: line.dir === 'out' ? 'contact' : 'user', text: line.text });
                }
            });
        });

        // продолжение переписки из приложения в конце сообщения персонажа
        if (!message.is_user) {
            (parseAppendix(message.mes, name1)?.entries ?? []).forEach((entry, i) => {
                found.push({ key: `${SRC}:${stamp}:a:${i}`, contactName: message.name, from: entry.from === 'user' ? 'user' : 'contact', text: entry.text });
            });
        }
    });
    return found;
}

let timer = null;

/** То же, но с небольшой задержкой — события таверны часто идут пачкой */
export function scheduleStorySync() {
    clearTimeout(timer);
    timer = setTimeout(syncStoryTexts, 250);
}

/** Пересобрать зеркало. Вызывать после любых изменений в истории. */
export function syncStoryTexts() {
    // выключено — зеркало очищается, а не застывает
    const texts = getSettings().inChatPhone === false ? [] : collectStoryTexts();

    // данные телефона не создаём в чатах, где нет ни переписок, ни телефона
    if (!texts.length && !ctx().chatMetadata?.[MODULE]) return;
    const data = getPhoneData();
    if (!data) return;

    // старые story-сообщения запоминаем, чтобы сохранить их время
    const previous = new Map();
    for (const chat of data.chats) {
        for (const m of chat.messages) if (m.src) previous.set(m.src, m);
    }

    // сюжетные часы могут стоять на месте — новые реплики ставим после всех уже известных
    // реплики, которые юзер удалил в телефоне, обратно не возвращаем
    const hidden = new Set(data.hiddenSrc ?? []);
    let latest = getStoryNow().getTime() - 1000;
    for (const chat of data.chats) for (const m of chat.messages) latest = Math.max(latest, m.ts);
    const wanted = new Map(); // contactId → сообщения
    for (const item of texts) {
        if (hidden.has(item.key)) continue;
        const contact = resolveContact(data, item.contactName);
        if (!contact) continue;
        const old = previous.get(item.key);
        const message = {
            id: old?.id ?? `msg_${item.key}`,
            from: item.from === 'user' ? 'user' : contact.id,
            text: item.text,
            // новые — сразу после последней известной реплики, с шагом в секунду
            ts: old?.ts ?? (latest += 1000),
            src: item.key,
        };
        if (!wanted.has(contact.id)) wanted.set(contact.id, []);
        wanted.get(contact.id).push(message);
    }

    let changed = false;
    for (const chat of data.chats) {
        const keep = chat.messages.filter(m => !m.src);
        const mirror = chat.contactId ? (wanted.get(chat.contactId) ?? []) : [];
        wanted.delete(chat.contactId);
        const next = orderMessages([...keep, ...mirror]);
        if (JSON.stringify(next) !== JSON.stringify(chat.messages)) {
            chat.messages = next;
            changed = true;
        }
    }
    // чаты, которых в телефоне ещё не было
    for (const [contactId, messages] of wanted) {
        getChat(data, contactId, true).messages = orderMessages(messages);
        changed = true;
    }

    data.chats = data.chats.filter(chat => chat.messages.length);
    if (changed) notifyDataChanged();
}
