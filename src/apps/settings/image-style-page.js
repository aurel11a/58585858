// Подстраница настроек «Стиль фото»: наш «Реализм» или любой стиль из Chamber of Secrets.

import { tr } from '../../i18n.js';
import { escapeHtml } from '../../core/format.js';
import { getSettings, setSetting } from '../../core/settings.js';
import { cosStyles } from '../twitter/images.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';

/** Подпись справа в строке настроек */
export function imageStyleSummary() {
    const id = getSettings().tweetImageStyle;
    return (id !== 'realism' && cosStyles().find(s => s.id === id)?.name) || tr('realism');
}

function row(id, title, subtitle, selected) {
    return `
<div class="wv-ios-row wv-account-row wv-ios-link" data-wv-image-style="${escapeHtml(id)}">
  <div class="wv-account-info">
    <div class="wv-account-name">${escapeHtml(title)}</div>
    <div class="wv-account-handle">${escapeHtml(subtitle)}</div>
  </div>
  <div class="wv-check ${selected ? 'wv-on' : ''}">${ICONS.check}</div>
</div>`;
}

export const imageStylePage = {
    id: 'imageStyle',
    title: () => tr('imageStyle'),

    html: () => `
<div class="wv-ios-group" data-wv="imageStyleList"></div>
<div class="wv-ios-footer">${tr('imageStyleFooter')}</div>`,

    render() {
        const current = getSettings().tweetImageStyle;
        const styles = cosStyles();
        // выбранный стиль удалили в Chamber of Secrets — считаем, что выбран «Реализм»
        const known = current === 'realism' || styles.some(s => s.id === current);
        el('imageStyleList').innerHTML = [
            row('realism', tr('realism'), tr('realismHint'), !known || current === 'realism'),
            ...styles.map(s => row(s.id, s.name, String(s.value).slice(0, 90), s.id === current)),
        ].join('');
    },

    /** @param {HTMLElement} target */
    onClick(target) {
        const pick = target.closest('[data-wv-image-style]');
        if (!pick) return false;
        setSetting('tweetImageStyle', pick.dataset.wvImageStyle);
        this.render();
        return true;
    },
};
