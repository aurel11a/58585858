// Подстраница «Сброс телефона»: как «стереть данные» в настоящем телефоне, только по пунктам.
// Стирается телефон текущего чата; файлы фото, которые больше не нужны, удаляются из папки wavey.

import { tr } from '../../i18n.js';
import { getPersonaName, getPhoneData, makeAccount, notifyDataChanged } from '../../core/store.js';
import { isPinned } from '../../core/persona-pins.js';
import { refreshReminder } from '../messages/memo.js';
import { deleteImage } from '../../ui/image.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';

const ITEMS = [
    { id: 'chats', label: () => tr('resetChats'), hint: () => tr('resetChatsHint') },
    { id: 'groups', label: () => tr('resetGroups') },
    { id: 'contacts', label: () => tr('resetContacts'), hint: () => tr('resetContactsHint'), pinned: () => isPinned('contacts') },
    { id: 'tweets', label: () => tr('resetTweets'), hint: () => tr('resetTweetsHint') },
    { id: 'accounts', label: () => tr('resetAccounts'), hint: () => tr('resetAccountsHint'), pinned: () => isPinned('accounts') },
];

/** Что отмечено; подтверждение — вторым нажатием, без диалогов */
const picked = new Set();
let confirming = false;
let confirmTimer = null;

/** Только наши файлы: свои фото и аватарки. Картинки Chamber of Secrets остаются в его галерее. */
const isOwnFile = (path) => /^\/?user\/images\/wavey\//.test(String(path || ''));
const dropFile = (path) => { if (isOwnFile(path)) deleteImage(path); };

function eraseChats(data, chats) {
    for (const chat of chats) {
        for (const m of chat.messages ?? []) {
            dropFile(m.photo);
            dropFile(m.image?.path);
        }
    }
}

function erase(data) {
    if (picked.has('chats')) {
        eraseChats(data, data.chats);
        data.chats = [];
        // реплики из ролевой снова зеркалятся в телефон — это история, её не стереть отсюда
        data.hiddenSrc = [];
    }
    if (picked.has('groups')) {
        const groupIds = new Set((data.groups ?? []).map(g => g.id));
        eraseChats(data, data.chats.filter(c => groupIds.has(c.groupId)));
        data.chats = data.chats.filter(c => !c.groupId);
        data.groups = [];
    }
    if (picked.has('contacts')) {
        const removed = data.contacts.filter(c => !c.main);
        const ids = new Set(removed.map(c => c.id));
        removed.forEach(c => dropFile(c.avatarPath));
        eraseChats(data, data.chats.filter(c => ids.has(c.contactId)));
        data.chats = data.chats.filter(c => !ids.has(c.contactId));
        for (const group of data.groups ?? []) group.memberIds = group.memberIds.filter(id => !ids.has(id));
        // у персонажей истории остаётся карточка, но без ручных правок и своей аватарки
        for (const c of data.contacts.filter(c => c.main)) {
            dropFile(c.avatarPath);
            Object.assign(c, { label: '', aliases: '', relation: '', style: '', avatarPath: null, edited: false });
        }
        data.contacts = data.contacts.filter(c => c.main);
    }
    if (picked.has('tweets')) {
        for (const tweet of data.tweets ?? []) if (tweet.image?.own) dropFile(tweet.image.path);
        data.tweets = [];
        data.profiles = {};
        data.feeds = {};
        delete data.feed;
        data.buzz = { queue: [], active: [] };
        data.twitterUnseen = false;
    }
    if (picked.has('accounts')) {
        data.accounts.forEach(a => dropFile(a.avatarPath));
        const fresh = makeAccount(getPersonaName(), true);
        // массив тот же — если аккаунты закреплены за персоной, сбрасываются и у неё
        data.accounts.splice(0, data.accounts.length, fresh);
        data.currentAccountId = fresh.id;
    }
}

function itemRow(item) {
    const pinned = item.pinned?.() ? ` · ${tr('resetPinned')}` : '';
    const hint = (item.hint?.() ?? '') + pinned;
    return `
<div class="wv-ios-row wv-account-row wv-ios-link" data-wv-reset="${item.id}">
  <div class="wv-account-info">
    <div class="wv-account-name">${item.label()}</div>
    ${hint ? `<div class="wv-account-handle">${hint}</div>` : ''}
  </div>
  <div class="wv-check ${picked.has(item.id) ? 'wv-on' : ''}">${ICONS.check}</div>
</div>`;
}

export const resetPage = {
    id: 'reset',
    title: () => tr('resetPhone'),

    html: () => `
<div class="wv-ios-section-title">${tr('resetWhat')}</div>
<div class="wv-ios-group" data-wv="resetList"></div>
<div class="wv-ios-footer">${tr('resetFooter')}</div>
<div class="wv-ios-group wv-ios-gap">
  <div class="wv-ios-row wv-ios-button" data-wv="resetButton" data-wv-action="resetErase"></div>
</div>`,

    render() {
        el('resetList').innerHTML = ITEMS.map(itemRow).join('');
        const button = el('resetButton');
        button.textContent = confirming ? tr('resetConfirm') : tr('resetErase');
        button.classList.toggle('wv-disabled', !picked.size || !getPhoneData());
    },

    /** @param {HTMLElement} target */
    onClick(target) {
        const row = target.closest('[data-wv-reset]');
        if (row) {
            const id = row.dataset.wvReset;
            if (picked.has(id)) picked.delete(id);
            else picked.add(id);
            confirming = false;
            this.render();
            return true;
        }
        if (target.closest('[data-wv-action="resetErase"]')) {
            const data = getPhoneData();
            if (!data || !picked.size) return true;
            if (!confirming) {
                confirming = true;
                clearTimeout(confirmTimer);
                confirmTimer = setTimeout(() => { confirming = false; this.render(); }, 3000);
                this.render();
                return true;
            }
            clearTimeout(confirmTimer);
            erase(data);
            confirming = false;
            picked.clear();
            notifyDataChanged();
            refreshReminder();
            el('resetButton').textContent = tr('resetDone');
            setTimeout(() => this.render(), 1500);
            el('resetList').innerHTML = ITEMS.map(itemRow).join('');
            return true;
        }
        return false;
    },
};
