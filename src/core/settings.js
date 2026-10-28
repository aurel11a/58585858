// Глобальные настройки расширения (живут в settings.json таверны)

import { ctx, MODULE } from './context.js';
import { defaultApiSettings } from './api.js';

const defaultSettings = Object.freeze({
    floatingButton: true,
    storyClock: true,
    // сколько последних сообщений ролевой может уйти персонажу (0 — никогда)
    storyContext: 20,
    // шанс (%), что после нового сообщения истории кто-то из контактов напишет первым
    initiativeChance: 15,
    // переписки (in)/(out) в сообщениях ролевой — окошком, с ответом прямо из чата
    inChatPhone: true,
    // напоминать основной ролевой о важной недавней переписке с теми, кто появился в сцене
    dmMemo: true,
    // лента твиттера обновляется сама при открытии (иначе — только по кнопке)
    feedAuto: true,
    // слухи из истории: скрытый тег основной модели → обсуждение в твиттере
    buzzEnabled: true,
    // через сколько сообщений истории слух «всплывает»
    buzzDelay: 3,
    // фото в твитах через Chamber of Secrets (выключено — картинки необязательны)
    tweetImages: false,
    // 'realism' — наш стиль, иначе id стиля из Chamber of Secrets
    tweetImageStyle: 'realism',
    // рисовать фото сразу; иначе — только по нажатию на твит
    tweetImagesAuto: false,
    // показывать модели присланные фото (если модель не умеет — ответ без них)
    visionPhotos: true,
    // персонажи могут присылать фото (рисует Chamber of Secrets)
    chatPhotos: true,
    // оформление: preset — готовое сочетание, tavern — цвета темы таверны, custom — свои
    themeMode: 'preset',
    themePreset: 'midnight',
    themeAccent: '#e8e8e8',
    themeBg: '#0c0c0c',
    // размер шрифта и иконок, %
    fontScale: 100,
    iconScale: 100,
    fabPos: null,
    phonePos: null,
    api: defaultApiSettings,
});

/** Дописать недостающие ключи на месте — объект не пересоздаём, иначе ссылки, взятые до await, отвалятся */
function fillDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in target)) target[key] = Array.isArray(value) ? [...value] : value;
    }
    return target;
}

export function getSettings() {
    const all = ctx().extensionSettings;
    const settings = fillDefaults(all[MODULE] ??= {}, defaultSettings);
    if (!settings.api || settings.api === defaultApiSettings) settings.api = {};
    fillDefaults(settings.api, defaultApiSettings);
    return settings;
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

export const getApi = () => getSettings().api;

/** Изменения, которые должны увидеть разные части UI (кнопки входа, телефон) */
export const SETTINGS_EVENT = 'wavey:settings';

/** Поменять настройку, сохранить и оповестить UI */
export function setSetting(key, value) {
    getSettings()[key] = value;
    saveSettings();
    document.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key } }));
}

export const setFloatingButton = (enabled) => setSetting('floatingButton', enabled);
