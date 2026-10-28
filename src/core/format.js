// Форматирование: экранирование, числа, время, хэндлы

import { getLanguage, tr } from '../i18n.js';

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** Кириллица → латиница («Ирина» → «irina»), регистр снижается */
export function toLatin(text) {
    return String(text).toLowerCase().split('').map(c => TRANSLIT[c] ?? c).join('');
}

/** Латинский слаг из имени: «Лулу Ким» → lulu_kim (sep задаёт разделитель) */
export function makeSlug(name, sep = '_', maxLength = 15) {
    const latin = String(name).toLowerCase().split('').map(c => TRANSLIT[c] ?? c).join('');
    const slug = latin.replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '').slice(0, maxLength);
    return slug || 'user';
}

export function makeHandle(name) {
    return '@' + makeSlug(name);
}

export function makeEmail(name) {
    return `${makeSlug(name, '.', 24)}@wavey.com`;
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

export function formatCount(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

export function relativeTime(ts, now = Date.now()) {
    const diff = Math.max(0, now - ts) / 1000;
    if (diff < 60) return tr('justNow');
    if (diff < 3600) return tr('minutesAgo', Math.floor(diff / 60));
    if (diff < 86400) return tr('hoursAgo', Math.floor(diff / 3600));
    return tr('daysAgo', Math.floor(diff / 86400));
}

export function localeTag() {
    return getLanguage() === 'ru' ? 'ru-RU' : 'en-US';
}
