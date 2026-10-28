// Закрепление за персоной: Twitter-аккаунты и/или контакты общие для всех чатов
// с этой персоной (как будто это один и тот же телефон). Хранятся в настройках расширения;
// в данных чата — те же самые объекты, так что правка в любом чате видна во всех.
// Персонажи самой истории (main) у каждого чата свои и не закрепляются.

import { user_avatar } from '../../../../../personas.js';
import { ctx } from './context.js';
import { getSettings } from './settings.js';

/** @typedef {'accounts'|'contacts'} PinKind */

const nameKey = (value) => String(value ?? '').trim().toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Персона — по файлу аватарки (имя у разных персон может совпадать) */
export const personaKey = () => user_avatar || `name:${ctx().name1 || 'User'}`;

/** @returns {{ accounts?: object[], contacts?: object[] } | null} */
function getPin(key = personaKey()) {
    return getSettings().personaPins?.[key] ?? null;
}

export const isPinned = (kind) => Array.isArray(getPin()?.[kind]);

/** Переименовать контакт во всех местах чата (переписка, сообщения, группы) */
function remapContact(data, from, to) {
    for (const chat of data.chats ?? []) {
        if (chat.contactId === from) chat.contactId = to;
        for (const m of chat.messages ?? []) if (m.from === from) m.from = to;
    }
    for (const group of data.groups ?? []) group.memberIds = group.memberIds.map(id => (id === from ? to : id));
}

/** То же для аккаунта юзера: свои твиты и ответы, ленты, текущий аккаунт */
function remapAccount(data, from, to) {
    for (const tweet of data.tweets ?? []) {
        for (const node of [tweet, ...(tweet.replies ?? [])]) if (node.author?.id === from) node.author.id = to;
        if (tweet.accountId === from) tweet.accountId = to;
    }
    if (data.feeds?.[from]) {
        data.feeds[to] = data.feeds[from];
        delete data.feeds[from];
    }
    if (data.currentAccountId === from) data.currentAccountId = to;
}

/**
 * Подключить закреплённое к данным чата. Вызывается при каждом getPhoneData — дёшево,
 * если всё уже подключено. Своё у чата не теряется: совпадающие по имени/хэндлу
 * сливаются с закреплёнными, новые добавляются персоне.
 */
export function applyPins(data) {
    const key = personaKey();
    const pin = getPin(key);

    // персону сменили: чужие закреплённые объекты отцепляем, чтобы правки не утекли
    if (data.pinnedTo && data.pinnedTo !== key) {
        data.accounts = clone(data.accounts);
        data.contacts = clone(data.contacts);
        delete data.pinnedTo;
    }
    if (!pin) return;

    if (Array.isArray(pin.accounts) && data.accounts !== pin.accounts) {
        for (const local of data.accounts) {
            const twin = pin.accounts.find(a => a.id === local.id)
                ?? pin.accounts.find(a => (a.persona && local.persona) || nameKey(a.handle) === nameKey(local.handle));
            if (twin) {
                if (twin.id !== local.id) remapAccount(data, local.id, twin.id);
            } else {
                pin.accounts.push(local);
            }
        }
        data.accounts = pin.accounts;
        if (!data.accounts.some(a => a.id === data.currentAccountId)) data.currentAccountId = data.accounts[0]?.id ?? null;
        data.pinnedTo = key;
    }

    if (Array.isArray(pin.contacts)) {
        const shared = new Set(pin.contacts);
        const locals = data.contacts.filter(c => !c.main && !shared.has(c));
        // подключено = в чате ровно закреплённые объекты (плюс персонажи истории)
        const attached = data.pinnedTo === key && !locals.length
            && data.contacts.filter(c => !c.main).length === pin.contacts.length;
        if (!attached) {
            for (const local of locals) {
                const twin = pin.contacts.find(c => c.id === local.id) ?? pin.contacts.find(c => nameKey(c.name) === nameKey(local.name));
                if (twin) {
                    if (twin.id !== local.id) remapContact(data, local.id, twin.id);
                } else {
                    pin.contacts.push(local);
                }
            }
            data.contacts = [...data.contacts.filter(c => c.main), ...pin.contacts];
            data.pinnedTo = key;
        }
    }
}

/** После изменений в чате — закреплённые списки персоны следуют за ним */
export function syncPins(data) {
    const pin = getPin();
    if (!pin || data.pinnedTo !== personaKey()) return;
    let changed = false;
    if (Array.isArray(pin.accounts)) {
        pin.accounts = data.accounts;
        changed = true;
    }
    if (Array.isArray(pin.contacts)) {
        pin.contacts = data.contacts.filter(c => !c.main);
        changed = true;
    }
    if (changed) ctx().saveSettingsDebounced();
}

/**
 * Включить / выключить закрепление.
 * Включение: если у персоны уже есть закреплённое — чат подключается к нему, иначе
 * персона получает то, что сейчас в этом чате. Выключение: чат оставляет себе копию.
 * @param {object} data
 * @param {PinKind} kind
 * @param {boolean} on
 */
export function setPinned(data, kind, on) {
    const settings = getSettings();
    settings.personaPins ??= {};
    const key = personaKey();
    const pin = (settings.personaPins[key] ??= {});
    if (on) {
        if (!Array.isArray(pin[kind])) pin[kind] = [];
        applyPins(data);
    } else {
        delete pin[kind];
        if (kind === 'accounts') data.accounts = clone(data.accounts);
        else data.contacts = clone(data.contacts);
        if (!Array.isArray(pin.accounts) && !Array.isArray(pin.contacts)) {
            delete settings.personaPins[key];
            delete data.pinnedTo;
        }
    }
    ctx().saveSettingsDebounced();
}
