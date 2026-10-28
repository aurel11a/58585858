// Контакты юзера и переписки с ними. Живут в данных телефона (метаданные чата).

import { ctx } from './context.js';
import { splitAliases } from './presence.js';
import { makeSlug } from './format.js';

export const HANDLE_MAX = 15;

/**
 * @typedef {object} Contact
 * @property {string} id
 * @property {string} name        настоящее имя — для модели
 * @property {string} label       как юзер записал контакт в телефоне («Мама», «Mina 🏠») — для интерфейса
 * @property {string} handle        @username, уникальный среди контактов и аккаунтов
 * @property {string} relation      кем приходится юзеру
 * @property {string} style         как пишет: тон, пунктуация, эмодзи
 * @property {{ enabled: boolean, followers: number, following: number }} twitter
 * @property {string|null} charAvatar  аватар карточки таверны (для персонажей истории)
 * @property {boolean} main         персонаж самой истории — не удаляется
 * @property {'story'|'ai'|'manual'} source
 * @property {boolean} edited       карточку правили руками
 */

/** Персонажи текущего чата: один персонаж или участники группы */
export function getStoryCharacters() {
    const { characters, characterId, groupId, groups } = ctx();
    if (groupId) {
        const group = groups.find(g => g.id === groupId);
        return (group?.members ?? [])
            .map(avatar => characters.find(c => c.avatar === avatar))
            .filter(Boolean);
    }
    const char = characters[characterId];
    return char ? [char] : [];
}

// ---------- хэндлы ----------

export function cleanHandle(value) {
    return String(value ?? '').toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '').slice(0, HANDLE_MAX);
}

function takenHandles(data, exceptId) {
    const taken = new Set();
    for (const c of data.contacts ?? []) if (c.id !== exceptId) taken.add(cleanHandle(c.handle));
    for (const a of data.accounts ?? []) if (a.id !== exceptId) taken.add(cleanHandle(a.handle));
    return taken;
}

export function isHandleTaken(data, handle, exceptId) {
    return takenHandles(data, exceptId).has(cleanHandle(handle));
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

/** Варианты, похожие на настоящие юзернеймы, а не «@имя» у всех подряд */
function handleVariants(name) {
    const [first = 'user', last = ''] = makeSlug(name, '_', 40).split('_');
    const year = pick(['94', '96', '98', '99', '01', '02', '03', '05']);
    const variants = [
        last && `${first}${last}`,
        last && `${first}_${last}`,
        last && `${first}${last[0]}`,
        last && `${first[0]}${last}`,
        last && `${last}_${first[0]}`,
        `${first}${year}`,
        `${first}_${digits(2)}`,
        `its${first}`,
        `${first}xo`,
        `${first}_irl`,
        `not${first}`,
        `${first}${pick(['bean', 'moon', 'cat', 'luv', 'tea', 'ok'])}`,
        `x${first}x`,
        `${first}${digits(3)}`,
    ].filter(Boolean);
    return variants.map(cleanHandle).filter(h => h.length >= 3);
}

/**
 * Хэндл, которого ещё нет в телефоне. Предпочитаем желаемый (от модели или юзера),
 * занят — подбираем правдоподобный вариант от имени.
 */
export function uniqueHandle(data, wanted, name, exceptId = null) {
    const taken = takenHandles(data, exceptId);
    const clean = cleanHandle(wanted);
    if (clean.length >= 2 && !taken.has(clean)) return '@' + clean;

    const options = handleVariants(name).filter(h => !taken.has(h));
    if (options.length) return '@' + pick(options);

    let fallback;
    do fallback = cleanHandle(`${makeSlug(name).slice(0, 10)}${digits(4)}`); while (taken.has(fallback));
    return '@' + fallback;
}

// ---------- контакты ----------

const clampCount = (value) => Math.max(0, Math.min(50_000_000, Math.round(Number(value) || 0)));

/** @returns {Contact} */
export function makeContact(data, fields = {}) {
    const name = String(fields.name || '').trim() || '?';
    const id = `ct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const twitter = fields.twitter ?? {};
    return {
        id,
        name,
        label: String(fields.label || '').trim(),
        // как ещё зовут в истории: «Ally, Al» — по ним ловится, что человек был в сцене
        aliases: String(fields.aliases || '').trim(),
        handle: uniqueHandle(data, fields.handle, name, id),
        relation: String(fields.relation || '').trim(),
        style: String(fields.style || '').trim(),
        twitter: {
            enabled: Boolean(twitter.enabled),
            followers: clampCount(twitter.followers),
            following: clampCount(twitter.following),
        },
        charAvatar: fields.charAvatar ?? null,
        main: Boolean(fields.main),
        source: fields.source ?? 'manual',
        // правил ли юзер карточку руками — генерация такие не перезаписывает
        edited: Boolean(fields.edited),
    };
}

export function sanitizeCount(value) {
    return clampCount(value);
}

/** Добавляет персонажей истории в контакты и чинит структуру старых данных */
export function ensureContacts(data) {
    data.contacts = Array.isArray(data.contacts) ? data.contacts : [];
    data.groups = Array.isArray(data.groups) ? data.groups : [];
    // чат принадлежит либо контакту, либо группе; старый формат без них выбрасываем
    data.chats = (Array.isArray(data.chats) ? data.chats : []).filter(chat => chat?.contactId || chat?.groupId);

    for (const char of getStoryCharacters()) {
        if (data.contacts.some(c => c.charAvatar === char.avatar)) continue;
        data.contacts.unshift(makeContact(data, { name: char.name, charAvatar: char.avatar, main: true, source: 'story' }));
    }
}

/** Как контакт подписан в телефоне: «Мама», а если подписи нет — настоящее имя */
export function displayName(contact) {
    return String(contact?.label || '').trim() || String(contact?.name ?? '?');
}

export function findContact(data, id) {
    return data?.contacts?.find(c => c.id === id) ?? null;
}

const nameKey = (value) => String(value ?? '').trim().toLowerCase();

export function findContactByName(data, name) {
    return data?.contacts?.find(c => nameKey(c.name) === nameKey(name)) ?? null;
}

/**
 * Найти контакт по имени, как его назвала модель: точное совпадение,
 * иначе единственный контакт, чьё имя содержит названное («John» → «Johnathan "John" Fletcher»).
 */
export function resolveContact(data, name) {
    const key = nameKey(name);
    if (!key) return null;
    const exact = findContactByName(data, name);
    if (exact) return exact;
    const byLabel = (data.contacts ?? []).find(c => c.label && nameKey(c.label) === key);
    if (byLabel) return byLabel;
    const byAlias = (data.contacts ?? []).find(c => splitAliases(c.aliases).some(alias => nameKey(alias) === key));
    if (byAlias) return byAlias;
    const partial = (data.contacts ?? []).filter(c => nameKey(c.name).includes(key) || key.includes(nameKey(c.name)));
    return partial.length === 1 ? partial[0] : null;
}

/** Контакты в порядке телефонной книги: персонажи истории сверху, дальше по алфавиту */
export function sortedContacts(data) {
    return [...(data?.contacts ?? [])].sort((a, b) => (Number(b.main) - Number(a.main)) || displayName(a).localeCompare(displayName(b)));
}

export function removeContact(data, id) {
    const contact = findContact(data, id);
    if (!contact || contact.main) return false;
    data.contacts = data.contacts.filter(c => c.id !== id);
    data.chats = data.chats.filter(chat => chat.contactId !== id);
    // из групп человек выходит, его старые сообщения остаются
    for (const group of data.groups) group.memberIds = group.memberIds.filter(m => m !== id);
    return true;
}

// ---------- группы ----------

/**
 * @typedef {object} Group
 * @property {string} id
 * @property {string} name
 * @property {string[]} memberIds   контакты в группе (юзер в группе всегда)
 */

/** @returns {Group} */
export function makeGroup(name, memberIds) {
    return {
        id: `gr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: String(name || '').trim() || '?',
        memberIds: [...new Set(memberIds)],
    };
}

export function findGroup(data, id) {
    return data?.groups?.find(g => g.id === id) ?? null;
}

export function findGroupByName(data, name) {
    return data?.groups?.find(g => nameKey(g.name) === nameKey(name)) ?? null;
}

// ---------- переписки ----------
// Сообщение: { id, from: 'user' | contactId, text, ts }. ts — сюжетное время.

/**
 * Сюжетное время нового сообщения: «сейчас», но не раньше последнего в чате —
 * часы истории могут откатиться назад, а переписка от этого перемешиваться не должна.
 */
export function nextTs(chat, ts) {
    const last = chat?.messages.at(-1)?.ts;
    return last != null && ts <= last ? last + 1000 : ts;
}

/** Когда сообщение появилось на самом деле: телефонное — по id (msg_<ms>), из ролевой — по дате сообщения */
function createdAt(message) {
    if (message.src) {
        const stamp = String(message.src).split(':').slice(1, -2).join(':');
        const time = Date.parse(stamp);
        if (Number.isFinite(time)) return time;
    }
    const match = /^msg_(\d{12,})/.exec(String(message.id));
    return match ? Number(match[1]) : null;
}

/**
 * Предыстория, сгенерированная вместе с контактами: её время — в прошлом сюжета, и стоит она
 * по сюжетному времени. Старые данные без пометки узнаём по пачке с одним id-временем,
 * растянутой по сюжету (ответы и первые сообщения идут подряд, с разницей в секунды).
 */
function seedIds(messages) {
    const batches = new Map();
    for (const m of messages) {
        const match = /^(msg_\d{12,})_\d+$/.exec(String(m.id));
        if (!match) continue;
        if (!batches.has(match[1])) batches.set(match[1], []);
        batches.get(match[1]).push(m);
    }
    const seeds = new Set(messages.filter(m => m.seed).map(m => m.id));
    for (const batch of batches.values()) {
        const times = batch.map(m => m.ts);
        if (batch.length > 1 && Math.max(...times) - Math.min(...times) > 10 * 60_000) batch.forEach(m => seeds.add(m.id));
    }
    return seeds;
}

/**
 * Упорядочить переписку. Основа — сюжетное время, но живое сообщение, появившееся позже другого,
 * никогда не встаёт выше него: часы истории могут откатиться, а переписка перемешиваться не должна.
 * @returns {object[]} новый массив (сообщения с поправленным временем — копии)
 */
export function orderMessages(messages) {
    const seeds = seedIds(messages);
    const byCreation = messages
        .map((message, index) => ({ message, index, created: createdAt(message) }))
        .filter(item => item.created != null)
        .sort((a, b) => (a.created - b.created) || (a.index - b.index));

    const fixedTs = new Map();
    let latest = -Infinity;
    for (const { message } of byCreation) {
        let ts = message.ts;
        if (!seeds.has(message.id) && ts < latest) ts = latest + 1000;
        if (ts !== message.ts) fixedTs.set(message, ts);
        latest = Math.max(latest, ts);
    }

    const created = new Map(byCreation.map(item => [item.message, item.created]));
    return messages
        .map((message, index) => ({ message, index, ts: fixedTs.get(message) ?? message.ts }))
        .sort((a, b) => (a.ts - b.ts) || ((created.get(a.message) ?? 0) - (created.get(b.message) ?? 0)) || (a.index - b.index))
        .map(({ message, ts }) => (ts === message.ts ? message : { ...message, ts }));
}

export function getChat(data, contactId, create = false) {
    let chat = data.chats.find(c => c.contactId === contactId);
    if (!chat && create) {
        chat = { contactId, messages: [], unread: 0 };
        data.chats.push(chat);
    }
    return chat ?? null;
}

export function getGroupChat(data, groupId, create = false) {
    let chat = data.chats.find(c => c.groupId === groupId);
    if (!chat && create) {
        chat = { groupId, messages: [], unread: 0 };
        data.chats.push(chat);
    }
    return chat ?? null;
}

export const lastMessage = (chat) => chat?.messages?.[chat.messages.length - 1] ?? null;

/** Входящее ли сообщение (старые 1:1 сообщения хранили from: 'contact') */
export const isIncoming = (message) => message.from !== 'user';
