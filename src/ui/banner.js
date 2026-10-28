// Уведомление сверху экрана телефона, как пуш в iOS. Только когда телефон открыт —
// закрытый телефон показывает точку на плавающей кнопке.
// Тап по баннеру открывает чат: у него те же data-open-*, что у строк списка чатов.

import { escapeHtml } from '../core/format.js';
import { avatarHtml } from './avatar.js';
import { ICONS } from './icons.js';
import { getRoot } from './dom.js';

const SHOW_MS = 4500;
let hideTimer = null;

function bannerEl() {
    const root = getRoot();
    let banner = root?.querySelector('.wv-banner');
    if (!banner && root) {
        banner = document.createElement('div');
        banner.className = 'wv-banner';
        root.querySelector('.wv-screen').appendChild(banner);
        // тап по баннеру: чат откроет мессенджер (data-open-*), а мы просто прячемся
        banner.addEventListener('click', () => hideBanner());
    }
    return banner;
}

export function hideBanner() {
    clearTimeout(hideTimer);
    getRoot()?.querySelector('.wv-banner')?.classList.remove('wv-open');
}

/**
 * @param {{ target: {type: string, id: string}, title: string, text: string, contact?: object|null }} note
 */
export function showBanner({ target, title, text, contact }) {
    const root = getRoot();
    if (!root?.classList.contains('wv-open')) return;
    const banner = bannerEl();

    const attr = target.type === 'group' ? 'data-open-group' : 'data-open-chat';
    banner.removeAttribute('data-open-group');
    banner.removeAttribute('data-open-chat');
    banner.setAttribute(attr, target.id);

    const avatar = contact ? avatarHtml(contact, 'wv-sm') : `<div class="wv-avatar wv-group-avatar wv-sm">${ICONS.users}</div>`;
    banner.innerHTML = `${avatar}<div class="wv-banner-text"><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div>`;

    banner.classList.remove('wv-open');
    // перезапуск анимации, если баннер уже висел
    void banner.offsetWidth;
    banner.classList.add('wv-open');

    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBanner, SHOW_MS);
}
