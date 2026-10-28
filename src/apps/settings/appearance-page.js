// Подстраница настроек «Оформление»: готовые сочетания, цвета таверны, свои цвета
// (акцент и фон), размер шрифта и иконок. Всё применяется сразу.

import { getLanguage, tr } from '../../i18n.js';
import { escapeHtml } from '../../core/format.js';
import { getSettings, setSetting } from '../../core/settings.js';
import { currentColors, PRESETS, tavernColors } from '../../core/theme.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';

const presetName = (preset) => preset.name[getLanguage()] ?? preset.name.en;

/** Подпись справа в строке настроек */
export function appearanceSummary() {
    const { themeMode, themePreset } = getSettings();
    if (themeMode === 'tavern') return tr('themeTavern');
    if (themeMode === 'custom') return tr('themeCustom');
    return presetName(PRESETS.find(p => p.id === themePreset) ?? PRESETS[0]);
}

/** Маленький «экран» с цветами темы: фон, полоска текста, кружок акцента */
const swatch = ({ bg, text, accent }) => `
<div class="wv-theme-swatch" style="background:${bg}">
  <i style="background:${text}"></i><b style="background:${accent}"></b>
</div>`;

function themeRow(key, title, colors, selected) {
    return `
<div class="wv-ios-row wv-account-row wv-ios-link" data-wv-theme="${escapeHtml(key)}">
  ${swatch(colors)}
  <div class="wv-account-info"><div class="wv-account-name">${escapeHtml(title)}</div></div>
  <div class="wv-check ${selected ? 'wv-on' : ''}">${ICONS.check}</div>
</div>`;
}

const SCALES = [
    { id: 'fontScale', label: () => tr('fontSize'), min: 80, max: 140, step: 5 },
    { id: 'iconScale', label: () => tr('iconSize'), min: 80, max: 150, step: 5 },
];

export const appearancePage = {
    id: 'appearance',
    title: () => tr('appearance'),

    html: () => `
<div class="wv-ios-section-title">${tr('themeReady')}</div>
<div class="wv-ios-group" data-wv="themePresets"></div>

<div class="wv-ios-section-title">${tr('themeOther')}</div>
<div class="wv-ios-group" data-wv="themeOther"></div>
<div class="wv-ios-group wv-ios-gap" data-wv="themeCustomColors">
  <label class="wv-ios-row">
    <div class="wv-ios-label">${tr('accentColor')}</div>
    <span class="wv-color-pick"><input type="color" data-wv-color="themeAccent"><span data-wv-color-dot="themeAccent"></span></span>
  </label>
  <label class="wv-ios-row">
    <div class="wv-ios-label">${tr('bgColor')}</div>
    <span class="wv-color-pick"><input type="color" data-wv-color="themeBg"><span data-wv-color-dot="themeBg"></span></span>
  </label>
</div>
<div class="wv-ios-footer">${tr('themeFooter')}</div>

<div class="wv-ios-section-title">${tr('sizes')}</div>
<div class="wv-ios-group">
  ${SCALES.map(s => `
  <div class="wv-ios-row">
    <div class="wv-ios-label">${s.label()}</div>
    <div class="wv-stepper">
      <div class="wv-stepper-btn" data-wv-scale="${s.id}" data-dir="-1">−</div>
      <div class="wv-stepper-value" data-wv-scale-value="${s.id}"></div>
      <div class="wv-stepper-btn" data-wv-scale="${s.id}" data-dir="1">+</div>
    </div>
  </div>`).join('')}
</div>`,

    bind() {
        // цвет применяется сразу, пока тянешь ползунок
        for (const input of document.querySelectorAll('#wavey-phone [data-wv-color]')) {
            input.addEventListener('input', () => {
                const key = /** @type {HTMLInputElement} */ (input).dataset.wvColor;
                if (getSettings().themeMode !== 'custom') seedCustom();
                setSetting(key, /** @type {HTMLInputElement} */ (input).value);
                if (getSettings().themeMode !== 'custom') setSetting('themeMode', 'custom');
                this.render();
            });
        }
    },

    render() {
        const settings = getSettings();
        const mode = settings.themeMode;
        el('themePresets').innerHTML = PRESETS
            .map(p => themeRow(`preset:${p.id}`, presetName(p), p, mode === 'preset' && settings.themePreset === p.id))
            .join('');
        const custom = { bg: settings.themeBg, text: currentColors({ ...settings, themeMode: 'custom' }).text, accent: settings.themeAccent };
        el('themeOther').innerHTML = themeRow('tavern', tr('themeTavern'), tavernColors(), mode === 'tavern')
            + themeRow('custom', tr('themeCustom'), custom, mode === 'custom');

        for (const key of ['themeAccent', 'themeBg']) {
            const input = /** @type {HTMLInputElement} */ (document.querySelector(`#wavey-phone [data-wv-color="${key}"]`));
            if (document.activeElement !== input) input.value = settings[key];
            /** @type {HTMLElement} */ (document.querySelector(`#wavey-phone [data-wv-color-dot="${key}"]`)).style.background = settings[key];
        }

        for (const s of SCALES) {
            const value = Number(settings[s.id]) || 100;
            document.querySelector(`#wavey-phone [data-wv-scale-value="${s.id}"]`).textContent = `${value}%`;
            document.querySelector(`#wavey-phone [data-wv-scale="${s.id}"][data-dir="-1"]`).classList.toggle('wv-disabled', value <= s.min);
            document.querySelector(`#wavey-phone [data-wv-scale="${s.id}"][data-dir="1"]`).classList.toggle('wv-disabled', value >= s.max);
        }
    },

    /** @param {HTMLElement} target */
    onClick(target) {
        const pick = target.closest('[data-wv-theme]');
        if (pick) {
            const key = pick.dataset.wvTheme;
            if (key.startsWith('preset:')) {
                setSetting('themePreset', key.slice(7));
                setSetting('themeMode', 'preset');
            } else {
                if (key === 'custom' && getSettings().themeMode !== 'custom') seedCustom();
                setSetting('themeMode', key);
            }
            this.render();
            return true;
        }
        const step = target.closest('[data-wv-scale]');
        if (step) {
            const scale = SCALES.find(s => s.id === step.dataset.wvScale);
            const next = (Number(getSettings()[scale.id]) || 100) + Number(step.dataset.dir) * scale.step;
            setSetting(scale.id, Math.max(scale.min, Math.min(scale.max, next)));
            this.render();
            return true;
        }
        return false;
    },
};

/** Переходим на свои цвета — начинаем с того, что видно сейчас, а не с нуля */
function seedCustom() {
    const settings = getSettings();
    if (settings.themeCustomTouched) return;
    const { bg, accent } = currentColors(settings);
    settings.themeBg = bg;
    settings.themeAccent = accent;
    settings.themeCustomTouched = true;
}
