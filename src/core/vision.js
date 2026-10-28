// Фото для модели: картинки (из папки таверны) уходят в запрос как image_url,
// чтобы собеседник «видел» присланное. Если модель картинки не принимает —
// повторяем запрос без них, а в тексте остаётся пометка, что было фото.

import { generate } from './api.js';
import { getSettings } from './settings.js';
import { LOG } from './context.js';

/** Больше картинок за раз не шлём — дорого и модели путаются */
export const MAX_VISION_IMAGES = 3;
const VISION_MAX_SIDE = 1024;

export const visionEnabled = () => getSettings().visionPhotos !== false;

const toUrl = (path) => '/' + String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');

/** Файл из папки картинок → компактный data URL для модели */
async function pathToDataUrl(path) {
    const blob = await (await fetch(toUrl(path))).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, VISION_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Запрос к экстра-API с картинками в последнем сообщении юзера.
 * @param {object} api
 * @param {{ role: string, content: string }[]} messages
 * @param {{ path: string, label: string }[]} photos  label — подпись перед картинкой («Photo #1 from Mina»)
 * @param {number} maxTokens
 */
export async function generateWithPhotos(api, messages, photos, maxTokens) {
    const usable = visionEnabled() ? photos.slice(-MAX_VISION_IMAGES) : [];
    if (!usable.length) return generate(api, messages, maxTokens);

    let parts;
    try {
        const images = await Promise.all(usable.map(photo => pathToDataUrl(photo.path)));
        const last = messages[messages.length - 1];
        parts = [{ type: 'text', text: last.content }];
        usable.forEach((photo, i) => {
            parts.push({ type: 'text', text: photo.label });
            parts.push({ type: 'image_url', image_url: { url: images[i] } });
        });
    } catch (error) {
        console.warn(LOG, 'vision: could not read photos', error);
        return generate(api, messages, maxTokens);
    }

    try {
        const withImages = [...messages.slice(0, -1), { role: messages[messages.length - 1].role, content: parts }];
        return await generate(api, withImages, maxTokens);
    } catch (error) {
        // модель без зрения или профиль текстового комплишена — тот же запрос без картинок
        console.warn(LOG, 'vision: retrying without images', error);
        return generate(api, messages, maxTokens);
    }
}
