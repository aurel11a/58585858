// Данные телефона: хранятся в метаданных чата, у каждой ролевой свой телефон

import { ctx, MODULE } from './context.js';
import { makeHandle } from './format.js';
import { ensureContacts } from './contacts.js';

/** Возвращает данные текущего чата или null, если чат не открыт */
export function getPhoneData() {
    const { chatMetadata, chatId } = ctx();
    if (!chatId || !chatMetadata) return null;

    if (!chatMetadata[MODULE]) {
        chatMetadata[MODULE] = { accounts: [], currentAccountId: null, tweets: [], chats: [] };
    }
    const data = chatMetadata[MODULE];

    // Основной аккаунт — текущая персона пользователя
    if (!data.accounts.length) {
        data.accounts.push(makeAccount(getPersonaName(), true));
        data.currentAccountId = data.accounts[0].id;
    }
    ensureContacts(data);
    return data;
}

/** Твит по id — из ленты или из истории чьего-то профиля */
export function findTweet(data, id) {
    return data?.tweets.find(t => t.id === id)
        ?? Object.values(data?.profiles ?? {}).flatMap(p => p.tweets ?? []).find(t => t.id === id)
        ?? null;
}

export function savePhoneData() {
    ctx().saveMetadataDebounced();
}

/** Данные поменялись в одном приложении — остальные перерисуются (слушает phone.js) */
export const DATA_EVENT = 'wavey:data';

export function notifyDataChanged() {
    savePhoneData();
    document.dispatchEvent(new CustomEvent(DATA_EVENT));
}

export function getPersonaName() {
    return ctx().name1 || 'User';
}

export function makeAccount(name, isPersona = false) {
    return {
        id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        handle: makeHandle(name),
        persona: isPersona,
        bio: '',
        // что это за профиль (тайный, рабочий, фанатский…) — видит только модель
        note: '',
        // путь к файлу в user/images/wavey (сам файл — не в данных чата)
        avatarPath: null,
        following: Math.floor(Math.random() * 300) + 20,
        followers: Math.floor(Math.random() * 200) + 5,
    };
}

export function getCurrentAccount(data) {
    return data.accounts.find(a => a.id === data.currentAccountId) ?? data.accounts[0];
}

/** Снимок автора для твита/ответа */
export function authorOf(account) {
    const { id, name, handle, persona, charAvatar } = account;
    return { id, name, handle, persona, charAvatar };
}
