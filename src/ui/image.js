// Картинки из галереи → файлы в папке пользователя таверны (data/<user>/user/images/wavey/).
// В данных чата хранится только путь к файлу, без base64.

import { ctx, LOG } from '../core/context.js';

const AVATAR_SIZE = 256;
/** Подпапка в user/images — у таверны это «папка персонажа» в загрузчике картинок */
const FOLDER = 'wavey';

/**
 * Открыть выбор фото (как «Выбрать фото» в телефоне). Резолвится null, если ничего не выбрали.
 * accept="image/*" без capture: на iOS/Android система сама предложит галерею или камеру.
 * Поле временно кладём в DOM — iOS Safari не открывает выбор у «висящего в воздухе» input.
 * Вызывать прямо из обработчика нажатия, иначе мобильные браузеры заблокируют окно выбора.
 */
export function pickImageFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
        document.body.appendChild(input);
        let settled = false;
        const finish = (file) => {
            if (settled) return;
            settled = true;
            input.remove();
            window.removeEventListener('focus', onFocus);
            resolve(file);
        };
        // отмена выбора: событие change не придёт, но окно вернёт фокус
        const onFocus = () => setTimeout(() => finish(input.files?.[0] ?? null), 800);
        input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
        window.addEventListener('focus', onFocus, { once: true });
        input.click();
    });
}

/** Форматы, которые таверна примет как есть, если браузер не смог открыть картинку сам */
const RAW_FORMATS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const PHOTO_MAX_SIDE = 1600;

/**
 * Подготовить фото из галереи к сохранению: уменьшить до PHOTO_MAX_SIDE и пересохранить в JPEG
 * (заодно снимаются EXIF-повороты и тяжёлые форматы). Если браузер не умеет открыть файл
 * (например HEIC не в Safari) — оставляем оригинал, когда таверна его примет.
 * @returns {Promise<{ blob: Blob, format: string }>}
 */
export async function preparePhoto(file) {
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
        if (blob) return { blob, format: 'jpg' };
    } catch { /* не открылось — пробуем оригинал */ }
    const format = RAW_FORMATS[file.type];
    if (format) return { blob: file, format };
    throw new Error('unsupported-image');
}

async function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/** Обрезать по центру в квадрат и уменьшить до AVATAR_SIZE. @returns {Promise<Blob>} */
export async function squareAvatar(source) {
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    try {
        const image = await loadImage(url);
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        canvas.getContext('2d').drawImage(
            image,
            (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
            0, 0, AVATAR_SIZE, AVATAR_SIZE,
        );
        return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    } finally {
        if (source instanceof Blob) URL.revokeObjectURL(url);
    }
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

/**
 * Сохранить картинку файлом через загрузчик таверны.
 * @returns {Promise<string>} путь вида user/images/wavey/avatar_….jpg
 */
export async function uploadImage(blob, prefix = 'avatar', format = 'jpg') {
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({
            image: await blobToBase64(blob),
            format,
            ch_name: FOLDER,
            filename: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        }),
    });
    if (!response.ok) throw new Error(`upload failed: HTTP ${response.status}`);
    const { path } = await response.json();
    // храним без начального слэша: user/images/wavey/…
    return String(path).replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Удалить файл, который больше не нужен (тихо — если его уже нет, ничего страшного) */
export async function deleteImage(path) {
    if (!path) return;
    try {
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (error) {
        console.warn(LOG, 'delete image', error);
    }
}

/** URL для <img>/background по сохранённому пути */
export const imageUrl = (path) => '/' + String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');

const migrating = new Set();

/**
 * Старые аватарки, сохранённые base64 прямо в данных чата, переносим в файлы.
 * @param {{ accounts?: object[] }} data
 * @param {() => void} onDone  сохранить и перерисовать
 */
export function migrateInlineAvatars(data, onDone) {
    for (const account of data?.accounts ?? []) {
        if (!account.avatarData || migrating.has(account.id)) continue;
        migrating.add(account.id);
        (async () => {
            try {
                const blob = await (await fetch(account.avatarData)).blob();
                account.avatarPath = await uploadImage(blob);
                delete account.avatarData;
                onDone();
            } catch (error) {
                console.warn(LOG, 'avatar migration', error);
            } finally {
                migrating.delete(account.id);
            }
        })();
    }
}
