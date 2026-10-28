// Приложение «Настройки» в стиле iOS: карточка Wavey ID сверху, ниже группы категорий.
// Категория со своей страницей = объект { id, title, html, bind, render, onClick } в PAGES.

import { tr } from '../../i18n.js';
import { VERSION } from '../../core/context.js';
import { escapeHtml, makeEmail } from '../../core/format.js';
import { getSettings, setFloatingButton, setSetting, SETTINGS_EVENT } from '../../core/settings.js';
import { getStoryClock } from '../../core/story-clock.js';
import { localeTag } from '../../core/format.js';
import { getPersonaName } from '../../core/store.js';
import { avatarHtml } from '../../ui/avatar.js';
import { ICONS } from '../../ui/icons.js';
import { $q, $qa, el } from '../../ui/dom.js';
import { apiPage, apiSummary } from './api-page.js';
import { imageStylePage, imageStyleSummary } from './image-style-page.js';
import { cosInstalled } from '../twitter/images.js';

const PAGES = [apiPage, imageStylePage];

/**
 * Разделы главного экрана: { title, rows }. Типы строк:
 *   page   — открывает подстраницу (value — подпись справа)
 *   toggle — переключатель
 *   info   — просто значение
 *   stepper — число с кнопками − / + (min, max, step)
 * У раздела может быть footer — подпись под карточкой.
 */
const GROUPS = [
    {
        title: () => tr('sectionGeneral'),
        rows: [
            { type: 'page', page: 'api', icon: ICONS.plug, label: () => tr('apiSection'), value: apiSummary },
            {
                type: 'toggle', id: 'floating', icon: ICONS.phone, label: () => tr('floatingShort'),
                get: () => getSettings().floatingButton, set: setFloatingButton,
            },
        ],
    },
    {
        title: () => tr('sectionTime'),
        rows: [
            {
                type: 'toggle', id: 'storyClock', icon: ICONS.clock, label: () => tr('storyTime'),
                get: () => getSettings().storyClock, set: (value) => setSetting('storyClock', value),
            },
            { type: 'info', id: 'clockNow', icon: ICONS.calendar, label: () => tr('clockNow'), value: clockSummary },
        ],
    },
    {
        title: () => tr('sectionContext'),
        footer: () => tr('storyContextHint'),
        rows: [
            {
                type: 'stepper', id: 'storyContext', icon: ICONS.book, label: () => tr('storyContext'),
                min: 0, max: 200, step: 5,
                get: () => getSettings().storyContext, set: (value) => setSetting('storyContext', value),
                format: (value) => (value ? String(value) : tr('off')),
            },
        ],
    },
    {
        title: () => tr('sectionMessages'),
        footer: () => `${tr('initiativeHint')} ${tr('inchatHint')} ${tr('dmMemoHint')}`,
        rows: [
            {
                type: 'stepper', id: 'initiativeChance', icon: ICONS.chat, label: () => tr('initiative'),
                min: 0, max: 100, step: 5,
                get: () => getSettings().initiativeChance, set: (value) => setSetting('initiativeChance', value),
                format: (value) => (value ? `${value}%` : tr('off')),
            },
            {
                type: 'toggle', id: 'inChatPhone', icon: ICONS.phone, label: () => tr('inchatToggle'),
                get: () => getSettings().inChatPhone, set: (value) => setSetting('inChatPhone', value),
            },
            {
                type: 'toggle', id: 'visionPhotos', icon: ICONS.image, label: () => tr('visionPhotos'),
                get: () => getSettings().visionPhotos, set: (value) => setSetting('visionPhotos', value),
            },
            {
                type: 'toggle', id: 'chatPhotos', icon: ICONS.image, label: () => tr('chatPhotos'),
                hidden: () => !cosInstalled(),
                get: () => getSettings().chatPhotos, set: (value) => setSetting('chatPhotos', value),
            },
            {
                type: 'toggle', id: 'dmMemo', icon: ICONS.book, label: () => tr('dmMemoToggle'),
                get: () => getSettings().dmMemo, set: (value) => setSetting('dmMemo', value),
            },
        ],
    },
    {
        title: () => 'Twitter',
        footer: () => `${tr('twitterHint')} ${cosInstalled() ? tr('tweetImagesHint') : tr('tweetImagesNoCos')}`,
        rows: [
            {
                type: 'toggle', id: 'feedAuto', icon: ICONS.refresh, label: () => tr('feedAuto'),
                get: () => getSettings().feedAuto, set: (value) => setSetting('feedAuto', value),
            },
            {
                type: 'toggle', id: 'buzzEnabled', icon: ICONS.sparkle, label: () => tr('buzzToggle'),
                get: () => getSettings().buzzEnabled, set: (value) => setSetting('buzzEnabled', value),
            },
            {
                type: 'stepper', id: 'buzzDelay', icon: ICONS.clock, label: () => tr('buzzDelay'),
                min: 0, max: 15, step: 1,
                get: () => getSettings().buzzDelay, set: (value) => setSetting('buzzDelay', value),
                format: (value) => (value ? String(value) : tr('now')),
            },
            {
                type: 'toggle', id: 'tweetImages', icon: ICONS.image, label: () => tr('tweetImages'),
                get: () => getSettings().tweetImages, set: (value) => setSetting('tweetImages', value),
                hidden: () => !cosInstalled(),
            },
            {
                type: 'toggle', id: 'tweetImagesAuto', icon: ICONS.refresh, label: () => tr('tweetImagesAuto'),
                get: () => getSettings().tweetImagesAuto, set: (value) => setSetting('tweetImagesAuto', value),
                hidden: () => !cosInstalled(),
            },
            {
                type: 'page', page: 'imageStyle', icon: ICONS.sparkle, label: () => tr('imageStyle'), value: imageStyleSummary,
                hidden: () => !cosInstalled(),
            },
        ],
    },
];

/** «14 нояб., 14:15 · чат» */
function clockSummary(clock = getStoryClock()) {
    const day = clock.date.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' });
    const sources = new Set([clock.dateSource, clock.timeSource]);
    const source = [...sources].map(s => tr(`src_${s}`)).join(' + ');
    return `${day}, ${clock.time} · ${source}`;
}

let currentPage = 'main';

function rowHtml(row) {
    const tile = `<div class="wv-ios-tile">${row.icon}</div>`;
    const label = `<div class="wv-ios-label">${escapeHtml(row.label())}</div>`;

    if (row.type === 'page') {
        return `<div class="wv-ios-row wv-ios-link" data-wv-open-page="${row.page}">${tile}${label}
  <div class="wv-ios-value" data-wv-row-value="${row.page}"></div>
  <div class="wv-ios-chevron">${ICONS.chevronRight}</div></div>`;
    }
    if (row.type === 'toggle') {
        return `<div class="wv-ios-row" data-wv-toggle="${row.id}">${tile}${label}
  <div class="wv-switch" data-wv-switch="${row.id}"><span></span></div></div>`;
    }
    if (row.type === 'stepper') {
        return `<div class="wv-ios-row">${tile}${label}
  <div class="wv-stepper">
    <div class="wv-stepper-btn" data-wv-step="${row.id}" data-dir="-1">−</div>
    <div class="wv-stepper-value" data-wv-row-value="${row.id}"></div>
    <div class="wv-stepper-btn" data-wv-step="${row.id}" data-dir="1">+</div>
  </div></div>`;
    }
    return `<div class="wv-ios-row">${tile}${label}<div class="wv-ios-value" data-wv-row-value="${row.id}"></div></div>`;
}

const allRows = () => GROUPS.flatMap(g => g.rows).filter(r => !r.hidden?.());

function groupHtml(group) {
    const title = group.title ? `<div class="wv-ios-section-title">${escapeHtml(group.title())}</div>` : '';
    const footer = group.footer ? `<div class="wv-ios-footer">${escapeHtml(group.footer())}</div>` : '';
    return `${title}<div class="wv-ios-group">${group.rows.filter(r => !r.hidden?.()).map(rowHtml).join('')}</div>${footer}`;
}

function renderMain() {
    const name = getPersonaName();
    el('idCard').innerHTML = `
${avatarHtml({ name, persona: true }, 'wv-id-avatar')}
<div class="wv-id-info">
  <div class="wv-id-name">${escapeHtml(name)}</div>
  <div class="wv-id-mail">${escapeHtml(makeEmail(name))}</div>
  <div class="wv-id-sub">${tr('waveyId')}</div>
</div>`;

    for (const row of allRows()) {
        if (row.type === 'page') $q(`[data-wv-row-value="${row.page}"]`).textContent = row.value();
        if (row.type === 'info') $q(`[data-wv-row-value="${row.id}"]`).textContent = row.value();
        if (row.type === 'toggle') $q(`[data-wv-switch="${row.id}"]`).classList.toggle('wv-on', !!row.get());
        if (row.type === 'stepper') {
            const value = row.get();
            $q(`[data-wv-row-value="${row.id}"]`).textContent = row.format(value);
            $q(`[data-wv-step="${row.id}"][data-dir="-1"]`).classList.toggle('wv-disabled', value <= row.min);
            $q(`[data-wv-step="${row.id}"][data-dir="1"]`).classList.toggle('wv-disabled', value >= row.max);
        }
    }
}

function showPage(id) {
    currentPage = id;
    $qa('[data-wv-page]').forEach(p => p.classList.toggle('wv-active', p.dataset.wvPage === id));
    if (id === 'main') renderMain();
    else PAGES.find(p => p.id === id)?.render();
}

/** @type {import('../types.js').PhoneApp} */
export const settingsApp = {
    id: 'settings',
    icon: ICONS.gear,
    title: () => tr('settings'),
    pinBottom: true,

    html: () => `
<div class="wv-ios">
  <div class="wv-ios-page wv-active" data-wv-page="main">
    <div class="wv-scroll wv-ios-scroll">
      <div class="wv-ios-large-title">${tr('settings')}</div>
      <div class="wv-ios-id" data-wv="idCard"></div>
      ${GROUPS.map(groupHtml).join('')}
      <div class="wv-ios-version">Wavey ${VERSION}</div>
    </div>
  </div>
  ${PAGES.map(page => `
  <div class="wv-ios-page" data-wv-page="${page.id}">
    <div class="wv-ios-navbar">
      <div class="wv-ios-back" data-wv-action="settingsBack">${ICONS.back}<span>${tr('settings')}</span></div>
    </div>
    <div class="wv-scroll wv-ios-scroll">
      <div class="wv-ios-large-title wv-ios-page-title">${escapeHtml(page.title())}</div>
      ${page.html()}
    </div>
  </div>`).join('')}
</div>`,

    bind() {
        PAGES.forEach(page => page.bind?.());
        // переключатель могли поменять из настроек расширения в таверне
        document.addEventListener(SETTINGS_EVENT, () => { if (currentPage === 'main') renderMain(); });
    },

    render() {
        showPage(currentPage);
    },

    onShow() {
        showPage(currentPage);
    },

    onClick(target) {
        const open = target.closest('[data-wv-open-page]');
        if (open) return showPage(open.dataset.wvOpenPage), true;

        if (target.closest('[data-wv-action="settingsBack"]')) return showPage('main'), true;

        const toggle = target.closest('[data-wv-toggle]');
        const row = toggle && allRows().find(r => r.id === toggle.dataset.wvToggle);
        if (row) {
            row.set(!row.get());
            renderMain();
            return true;
        }

        const stepBtn = target.closest('[data-wv-step]');
        const stepper = stepBtn && allRows().find(r => r.id === stepBtn.dataset.wvStep);
        if (stepper) {
            const next = stepper.get() + Number(stepBtn.dataset.dir) * stepper.step;
            stepper.set(Math.max(stepper.min, Math.min(stepper.max, next)));
            renderMain();
            return true;
        }

        const page = PAGES.find(p => p.id === currentPage);
        return page?.onClick?.(target) ?? false;
    },

    onClock(clock) {
        if (currentPage !== 'main') return;
        const cell = $q('[data-wv-row-value="clockNow"]');
        if (cell) cell.textContent = clockSummary(clock);
    },

    onEscape() {
        if (currentPage === 'main') return false;
        showPage('main');
        return true;
    },
};
