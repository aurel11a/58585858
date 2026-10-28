// Оформление телефона: готовые сочетания, цвета темы таверны или свои цвета,
// плюс масштаб шрифта и иконок. Пишем только базовые переменные (фон, текст, акцент,
// масштабы) в свой <style> — все оттенки серого style.css выводит из них сам.

import { getSettings, SETTINGS_EVENT } from './settings.js';

/** Готовые сочетания. Текст на акценте подбирается сам — по яркости акцента. */
export const PRESETS = [
    { id: 'midnight', name: { en: 'Midnight', ru: 'Полночь' }, bg: '#0c0c0c', text: '#f0f0f0', accent: '#e8e8e8' },
    { id: 'paper', name: { en: 'Paper', ru: 'Бумага' }, bg: '#f6f5f1', text: '#18181a', accent: '#18181a' },
    { id: 'rose', name: { en: 'Rose', ru: 'Роза' }, bg: '#150e11', text: '#f6e8ee', accent: '#f2a5c0' },
    { id: 'cherry', name: { en: 'Cherry', ru: 'Вишня' }, bg: '#120a0b', text: '#f3e6e6', accent: '#e0475b' },
    { id: 'ocean', name: { en: 'Ocean', ru: 'Океан' }, bg: '#0a1219', text: '#e4eff7', accent: '#7cc3f0' },
    { id: 'matcha', name: { en: 'Matcha', ru: 'Матча' }, bg: '#0f140d', text: '#e9f0e2', accent: '#b3d898' },
    { id: 'lavender', name: { en: 'Lavender', ru: 'Лаванда' }, bg: '#f4f1fb', text: '#1e1933', accent: '#7a5fd6' },
    { id: 'latte', name: { en: 'Latte', ru: 'Латте' }, bg: '#f5eee5', text: '#2a2019', accent: '#a5673c' },
];

const THEME_KEYS = new Set(['themeMode', 'themePreset', 'themeAccent', 'themeBg', 'fontScale', 'iconScale']);

// ---------- цвета ----------

let probe = null;

/** Любой CSS-цвет → [r, g, b, a] (0–255, a 0–1) */
function parseColor(value) {
    probe ??= document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#000';
    probe.fillStyle = String(value || '').trim() || '#000';
    const normalized = probe.fillStyle;
    if (normalized.startsWith('#')) {
        const n = parseInt(normalized.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const parts = normalized.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Относительная яркость 0–1 */
function luminance(color) {
    const [r, g, b] = parseColor(color).map((v, i) => (i < 3 ? v / 255 : v));
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Тёмный или светлый текст поверх цвета */
export const readableOn = (color) => (luminance(color) > 0.35 ? '#111111' : '#ffffff');
/** Текст для своего фона: на тёмном — светлый, на светлом — тёмный */
const textFor = (bg) => (luminance(bg) > 0.4 ? '#18181a' : '#f0f0f0');

/** Полупрозрачный цвет таверны → сплошной (поверх тёмного, как его и видно в таверне) */
function solid(value, under = [12, 12, 12]) {
    const [r, g, b, a] = parseColor(value);
    return toHex([r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)]);
}

/** Цвета текущей темы SillyTavern */
export function tavernColors() {
    const root = getComputedStyle(document.documentElement);
    const read = (name) => root.getPropertyValue(name).trim();
    const bg = solid(read('--SmartThemeBlurTintColor') || read('--SmartThemeChatTintColor') || '#171717');
    const text = solid(read('--SmartThemeBodyColor') || '#dcdcd2', parseColor(bg));
    const accent = solid(read('--SmartThemeQuoteColor') || read('--SmartThemeEmColor') || text, parseColor(bg));
    return { bg, text, accent };
}

/** Цвета, которые сейчас должны быть у телефона */
export function currentColors(settings = getSettings()) {
    if (settings.themeMode === 'tavern') return tavernColors();
    if (settings.themeMode === 'custom') {
        const bg = settings.themeBg || '#0c0c0c';
        return { bg, text: textFor(bg), accent: settings.themeAccent || '#e8e8e8' };
    }
    const preset = PRESETS.find(p => p.id === settings.themePreset) ?? PRESETS[0];
    return { bg: preset.bg, text: preset.text, accent: preset.accent };
}

// ---------- применение ----------

let styleEl = null;

export function applyTheme() {
    const settings = getSettings();
    const { bg, text, accent } = currentColors(settings);
    const fs = Math.max(0.7, Math.min(1.6, (Number(settings.fontScale) || 100) / 100));
    const is = Math.max(0.7, Math.min(1.8, (Number(settings.iconScale) || 100) / 100));

    styleEl ??= Object.assign(document.createElement('style'), { id: 'wavey-theme' });
    // в конец <head>, после style.css — и :root:root, чтобы точно перебить значения по умолчанию
    if (!styleEl.isConnected) document.head.appendChild(styleEl);
    styleEl.textContent = `:root:root {
  --wv-bg: ${bg};
  --wv-text: ${text};
  --wv-accent: ${accent};
  --wv-on-accent: ${readableOn(accent)};
  --wv-fs: ${fs};
  --wv-is: ${is};
}`;
}

export function initTheme() {
    applyTheme();
    document.addEventListener(SETTINGS_EVENT, (e) => {
        if (THEME_KEYS.has(/** @type {CustomEvent} */ (e).detail?.key)) applyTheme();
    });
    // таверна меняет свою тему через переменные на <html> — в режиме «цвета таверны» следуем за ней
    let timer = null;
    new MutationObserver(() => {
        if (getSettings().themeMode !== 'tavern') return;
        clearTimeout(timer);
        timer = setTimeout(applyTheme, 150);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
}
