// Аватары: персона → картинка персоны, персонаж → его аватар, иначе первая буква

import { user_avatar } from '../../../../../personas.js';
import { ctx } from '../core/context.js';
import { escapeHtml } from '../core/format.js';
import { imageUrl } from './image.js';

export function resolveAvatarUrl(account) {
    // своё фото важнее всего: превью ещё не сохранённого → файл в папке wavey → старый base64
    if (account.avatarPreview) return account.avatarPreview;
    if (account.avatarPath) return imageUrl(account.avatarPath);
    if (account.avatarData) return account.avatarData;
    if (account.persona && user_avatar) return ctx().getThumbnailUrl('persona', user_avatar);
    if (account.charAvatar) return ctx().getThumbnailUrl('avatar', account.charAvatar);
    return null;
}

/** @param {string} [size] доп. класс размера: wv-sm, wv-md, wv-lg */
export function avatarHtml(account, size = '') {
    const url = resolveAvatarUrl(account);
    const cls = `wv-avatar ${size}`.trim();
    if (url) return `<div class="${cls}" style="background-image:url('${url}')"></div>`;
    // у контакта буква — по подписи в телефоне («Мама» → М)
    // [...str] — по символам, а не UTF-16 половинкам, чтобы эмодзи в начале не ломались
    const letter = escapeHtml(([...(account.label || account.name || '?').trim()][0] ?? '?').toUpperCase());
    return `<div class="${cls}">${letter}</div>`;
}
