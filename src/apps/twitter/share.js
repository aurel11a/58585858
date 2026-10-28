// «Поделиться» твитом: шторка снизу со списком людей и групп, как share sheet в iOS.
// Тап по получателю — твит уходит карточкой в переписку и открывается чат.

import { tr } from '../../i18n.js';
import { escapeHtml } from '../../core/format.js';
import { displayName, sortedContacts } from '../../core/contacts.js';
import { findTweet, getPhoneData } from '../../core/store.js';
import { avatarHtml } from '../../ui/avatar.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';
import { shareToChat } from '../messages/index.js';

/** @type {string|null} какой твит пересылаем */
let sharingId = null;

export function shareSheetHtml() {
    return `
<div class="wv-sheet-backdrop" data-wv="shareBackdrop"></div>
<div class="wv-sheet" data-wv="shareSheet">
  <div class="wv-sheet-grabber"></div>
  <div class="wv-sheet-title">${tr('share')}</div>
  <div class="wv-shared wv-share-preview" data-wv="sharePreview"></div>
  <div class="wv-ios-group">
    <div class="wv-ios-field">
      <input class="wv-field" type="text" data-wv="shareComment" placeholder="${tr('shareCommentPh')}" autocomplete="off">
    </div>
  </div>
  <div class="wv-ios-section-title">${tr('shareTo')}</div>
  <div class="wv-ios-group" data-wv="shareList"></div>
</div>`;
}

function recipientRow(key, avatar, title, subtitle) {
    return `
<div class="wv-ios-row wv-account-row wv-ios-link" data-wv-share-to="${escapeHtml(key)}">
  ${avatar}
  <div class="wv-account-info">
    <div class="wv-account-name">${escapeHtml(title)}</div>
    <div class="wv-account-handle">${escapeHtml(subtitle)}</div>
  </div>
  <div class="wv-ios-chevron">${ICONS.arrowUp}</div>
</div>`;
}

export function openShareSheet(tweetId) {
    const data = getPhoneData();
    const tweet = findTweet(data, tweetId);
    if (!tweet) return;
    sharingId = tweetId;

    el('sharePreview').innerHTML = `
<div class="wv-shared-head"><b>${escapeHtml(tweet.author.name)}</b><span>${escapeHtml(tweet.author.handle)}</span></div>
<div class="wv-shared-text">${escapeHtml(tweet.text)}</div>`;
    /** @type {HTMLInputElement} */ (el('shareComment')).value = '';

    const groups = (data.groups ?? []).map(g => recipientRow(`group:${g.id}`, `<div class="wv-avatar wv-group-avatar wv-sm">${ICONS.users}</div>`, g.name, tr('members', g.memberIds.length + 1)));
    const people = sortedContacts(data).map(c => recipientRow(`contact:${c.id}`, avatarHtml(c, 'wv-sm'), displayName(c), c.relation || c.handle));
    el('shareList').innerHTML = [...people, ...groups].join('') || `<div class="wv-empty">${tr('noContacts')}</div>`;

    el('shareBackdrop').classList.add('wv-open');
    el('shareSheet').classList.add('wv-open');
}

export function closeShareSheet() {
    sharingId = null;
    el('shareBackdrop')?.classList.remove('wv-open');
    el('shareSheet')?.classList.remove('wv-open');
}

function send(key) {
    const data = getPhoneData();
    const tweet = findTweet(data, sharingId);
    if (!tweet) return closeShareSheet();
    const [type, ...rest] = key.split(':');
    const comment = /** @type {HTMLInputElement} */ (el('shareComment')).value;
    closeShareSheet();
    shareToChat(
        { type: /** @type {'contact'|'group'} */ (type), id: rest.join(':') },
        {
            id: tweet.id, name: tweet.author.name, handle: tweet.author.handle, text: tweet.text,
            // что на фото — модель не видит картинку, но знает описание кадра
            ...(tweet.image ? { image: { prompt: tweet.image.prompt, path: tweet.image.status === 'done' ? tweet.image.path : null } } : {}),
        },
        comment,
    );
}

/** @param {HTMLElement} target */
export function shareOnClick(target) {
    const row = target.closest('[data-wv-share-to]');
    if (row && sharingId) return send(row.dataset.wvShareTo), true;
    if (target.closest('[data-wv="shareBackdrop"]')) return closeShareSheet(), true;
    return false;
}

export function shareOnEscape() {
    if (!sharingId) return false;
    closeShareSheet();
    return true;
}
