// Фото в твитах через расширение Chamber of Secrets (если оно стоит и включено).
// Модель ленты даёт только описание кадра и кто в кадре; стиль выбирается в настройках Wavey
// (стиль из Chamber of Secrets или наш «Реализм»), рефы собирает сам Chamber of Secrets.
// Картинка — необязательная: не получилось — твит просто без фото.

import { ctx, LOG } from '../../core/context.js';
import { getSettings } from '../../core/settings.js';
import { findTweet, getPhoneData, notifyDataChanged } from '../../core/store.js';
import { deleteImage, uploadImage } from '../../ui/image.js';

const COS_SETTINGS_KEY = 'chamber_gen';
/** Папки, где обычно лежит Chamber of Secrets (имя папки = имя репозитория) */
const COS_FOLDERS = ['vish-v2', 'chamber-of-secrets', 'Chamber-of-Secrets', 'vish'];
/** Не больше стольких фото за одно обновление ленты */
export const MAX_IMAGES_PER_BATCH = 2;

export const REALISM_STYLE = 'Candid smartphone photo posted on social media: realistic, natural light, true-to-life colors, slight grain and imperfect framing, no filters, no text overlays.';

/** Кусок правил для промптов ленты/слухов — только если фото включены */
export function imagePromptRule() {
    if (!imagesEnabled()) return '';
    return `A tweet MAY have a photo when it naturally would (a selfie, food, a view, an outfit, an event, a screenshot-like moment) — at most ${MAX_IMAGES_PER_BATCH} per reply, most tweets have none. Add it as "image": {"prompt": "what is in the photo, concrete and visual, in English, no art-style words; call people in it by their exact names", "people": ["exact names of story characters or USER visible in the photo"]}.`;
}

// ---------- Chamber of Secrets ----------

let cos = null; // { generateImageWithRetry, folder } | null
let cosChecked = false;

const disabled = (folder) => (ctx().extensionSettings.disabledExtensions ?? []).includes(`third-party/${folder}`);

/** Найти и подгрузить пайплайн Chamber of Secrets (тот же экземпляр модуля, что у расширения) */
async function loadCos() {
    if (cosChecked) return cos;
    cosChecked = true;
    if (!ctx().extensionSettings[COS_SETTINGS_KEY]) return null;
    for (const folder of COS_FOLDERS) {
        if (disabled(folder)) continue;
        try {
            const settingsModule = await import(`/scripts/extensions/third-party/${folder}/src/settings.js`);
            if (settingsModule.MODULE_NAME !== COS_SETTINGS_KEY) continue;
            const pipeline = await import(`/scripts/extensions/third-party/${folder}/src/pipeline.js`);
            const utils = await import(`/scripts/extensions/third-party/${folder}/src/utils.js`);
            if (typeof pipeline.generateImageWithRetry !== 'function') continue;
            cos = { generateImageWithRetry: pipeline.generateImageWithRetry, saveImageToFile: utils.saveImageToFile, folder };
            return cos;
        } catch { /* не та папка — пробуем следующую */ }
    }
    return null;
}

/** Есть ли Chamber of Secrets (без загрузки модулей — по настройкам) */
export function cosInstalled() {
    if (!ctx().extensionSettings[COS_SETTINGS_KEY]) return false;
    return COS_FOLDERS.some(folder => !disabled(folder));
}

export const imagesEnabled = () => Boolean(getSettings().tweetImages) && cosInstalled();

/** Стили из Chamber of Secrets для выбора в настройках */
export function cosStyles() {
    const styles = ctx().extensionSettings[COS_SETTINGS_KEY]?.styles;
    return Array.isArray(styles) ? styles.filter(s => s?.id && String(s.value || '').trim()) : [];
}

function chosenStyle() {
    const id = getSettings().tweetImageStyle;
    const style = id && id !== 'realism' ? cosStyles().find(s => s.id === id) : null;
    return { text: style ? String(style.value) : REALISM_STYLE, id: style?.id ?? null };
}

/**
 * На время нашей генерации ставим выбранный в Wavey стиль; всё остальное (рефы персонажей,
 * аватары, картинки из чата) Chamber of Secrets берёт по своим настройкам — мы их не трогаем.
 * Стиль Chamber of Secrets берёт из своего активного стиля (он важнее переданного текста),
 * поэтому выбранный стиль делаем активным, а для «Реализма» активный стиль снимаем —
 * тогда уходит наш текст. Сами стили не трогаем: Chamber of Secrets пересоздаёт их массив.
 */
function withStyle(styleId, run) {
    const s = ctx().extensionSettings[COS_SETTINGS_KEY];
    const backup = s.activeStyleId;
    s.activeStyleId = styleId ?? '';
    return run().finally(() => { s.activeStyleId = backup; });
}

// ---------- генерация ----------

/** Результат генерации → data URL картинки (для видео — его превью) */
async function toDataUrl(generated) {
    const src = typeof generated === 'string' ? generated : generated?.posterDataUrl || generated?.dataUrl;
    if (!src) throw new Error('empty image');
    if (src.startsWith('data:')) return src;
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Сохранить сгенерированное фото туда же, куда Chamber of Secrets кладёт свои картинки
 * (user/images/<персонаж>/iig_…). Его сохранялки нет — в нашу папку wavey.
 */
async function saveGenerated(pipeline, generated) {
    const dataUrl = await toDataUrl(generated);
    if (typeof pipeline.saveImageToFile === 'function') {
        const path = await pipeline.saveImageToFile(dataUrl, { mode: 'wavey-tweet' });
        // путь приходит уже URL-закодированным — храним обычный, кодируем один раз при показе
        return String(path).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/');
    }
    return uploadImage(await (await fetch(dataUrl)).blob(), 'tweet');
}

/**
 * Chamber of Secrets подбирает рефы по именам в тексте промпта —
 * поэтому имена тех, кто в кадре, обязательно дописываем.
 */
function promptWithPeople(image) {
    const { name1 } = ctx();
    const people = (image.people ?? [])
        .map(p => (String(p).trim().toLowerCase() === 'user' ? name1 : String(p).trim()))
        .filter(Boolean);
    const missing = people.filter(name => !image.prompt.toLowerCase().includes(name.toLowerCase()));
    return missing.length ? `${image.prompt}. In the photo: ${missing.join(', ')}.` : image.prompt;
}

/** Живое поле image у твита или сообщения чата */
function imageOf(data, kind, id) {
    if (kind === 'tweet') return findTweet(data, id)?.image ?? null;
    for (const chat of data?.chats ?? []) {
        const message = chat.messages.find(m => m.id === id);
        if (message) return message.image ?? null;
    }
    return null;
}

/**
 * Нарисовать фото (твита или сообщения от персонажа) и сохранить файлом.
 * @param {'tweet'|'chat'} kind
 * @param {string} id
 */
async function generateFor(kind, id) {
    const image = imageOf(getPhoneData(), kind, id);
    if (!image || image.status !== 'pending') return;

    const pipeline = await loadCos();
    if (!pipeline) {
        image.status = 'failed';
        return notifyDataChanged();
    }

    const style = chosenStyle();

    try {
        const generated = await withStyle(style.id, () =>
            pipeline.generateImageWithRetry(promptWithPeople(image), style.text, null, {}));
        const path = await saveGenerated(pipeline, generated);
        const fresh = imageOf(getPhoneData(), kind, id);
        if (fresh) {
            fresh.path = path;
            fresh.status = 'done';
        }
    } catch (error) {
        console.warn(LOG, 'image', error);
        const fresh = imageOf(getPhoneData(), kind, id);
        if (fresh) fresh.status = 'failed';
    }
    notifyDataChanged();
}

let queue = Promise.resolve();

/** Поставить фото в очередь — по одному, чтобы не долбить провайдера параллельно */
function queueImages(kind, ids) {
    for (const id of ids) queue = queue.then(() => generateFor(kind, id)).catch(() => {});
}

export const queueTweetImages = (tweetIds) => queueImages('tweet', tweetIds);

/** Описание кадра из ответа модели → поле image ('idle' — ещё не рисовали) */
function parseImage(raw) {
    if (!raw) return null;
    const prompt = String(typeof raw === 'string' ? raw : raw.prompt || '').trim();
    if (!prompt) return null;
    const people = Array.isArray(raw.people) ? raw.people.map(String) : [];
    return { prompt, people, status: 'idle' };
}

/**
 * Разобрать "image" из ответа модели в поле твита.
 * Статус: 'idle' — описание есть, картинку ещё не просили; 'pending' — рисуется;
 * 'done' — готово (path); 'failed' — не получилось (можно повторить).
 */
export const imageFromRaw = (raw) => (imagesEnabled() ? parseImage(raw) : null);

/** Рисовать ли фото сразу, или только по нажатию */
export const imagesAuto = () => Boolean(getSettings().tweetImagesAuto);

/**
 * Нарисовать фото твита сейчас (по нажатию) или перерисовать готовое.
 * @param {string} tweetId
 */
export function requestTweetImage(tweetId) {
    const data = getPhoneData();
    const tweet = findTweet(data, tweetId);
    if (!tweet?.image || tweet.image.status === 'pending') return;
    // перерисовка: старый файл удаляем, если его не переслали в какой-нибудь чат
    const old = tweet.image.path;
    const sharedSomewhere = old && data.chats.some(chat => chat.messages.some(m => m.tweet?.image?.path === old));
    if (old && !sharedSomewhere) deleteImage(old);
    tweet.image.path = null;
    tweet.image.status = 'pending';
    notifyDataChanged();
    queueImages('tweet', [tweetId]);
}

// ---------- фото от персонажей в чатах ----------

/** Персонажи могут слать фото, если включено и стоит Chamber of Secrets */
export const chatImagesEnabled = () => getSettings().chatPhotos !== false && cosInstalled();

export const chatImageFromRaw = (raw) => (chatImagesEnabled() ? parseImage(raw) : null);

/** Правило для промпта переписки */
export function chatPhotoRule() {
    if (!chatImagesEnabled()) return '';
    return 'You MAY send a photo when it fits naturally (a selfie, what you are looking at, food, an outfit, a place, a meme) — not often. A photo is a message of its own: {"photo": {"prompt": "what is in the photo, concrete and visual, in English, no art-style words; call people in it by their exact names", "people": ["exact names of story characters or USER visible in it"]}, "text": "optional caption"}.';
}

/** Новые фото от персонажа: сразу рисуем (если так настроено) */
export function startChatImages(messageIds) {
    if (!imagesAuto() || !messageIds.length) return;
    const data = getPhoneData();
    for (const id of messageIds) {
        const image = imageOf(data, 'chat', id);
        if (image) image.status = 'pending';
    }
    queueImages('chat', messageIds);
}

/** Показать фото из чата по нажатию / повторить после ошибки / перерисовать готовое */
export function requestChatImage(messageId) {
    const image = imageOf(getPhoneData(), 'chat', messageId);
    if (!image || image.status === 'pending') return;
    if (image.path) deleteImage(image.path);
    image.path = null;
    image.status = 'pending';
    notifyDataChanged();
    queueImages('chat', [messageId]);
}
