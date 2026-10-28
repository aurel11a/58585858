// Оболочка телефона: рамка, статус-бар, боковая панель приложений, открытие/закрытие

import { tr } from './i18n.js';
import { localeTag } from './core/format.js';
import { getSettings, saveSettings, SETTINGS_EVENT } from './core/settings.js';
import { getStoryClock, invalidateStoryClock } from './core/story-clock.js';
import { DATA_EVENT, getPhoneData } from './core/store.js';
import { $q, $qa, getRoot, setRoot } from './ui/dom.js';
import { clampIntoView, makeDraggable, placeAt } from './ui/drag.js';
import { ICONS } from './ui/icons.js';
import { messagesApp } from './apps/messages/index.js';
import { twitterApp, resetTwitterOverlays } from './apps/twitter/index.js';
import { contactsApp } from './apps/contacts/index.js';
import { settingsApp } from './apps/settings/index.js';

/** Порядок = порядок иконок в боковой панели (pinBottom — вниз) */
const APPS = [messagesApp, twitterApp, contactsApp, settingsApp];

let activeAppId = APPS[0].id;
let clockTimer = null;

/** Mnema обновляет дату/время асинхронно и без событий — пока телефон открыт, перечитываем */
const CLOCK_POLL_MS = 3000;

const activeApp = () => APPS.find(a => a.id === activeAppId);

function sideIconHtml(app) {
    const active = app.id === activeAppId ? 'wv-active' : '';
    const dot = app.hasDot ? `<span class="wv-dot" data-wv-dot="${app.id}"></span>` : '';
    return `<div class="wv-side-icon ${active}" data-wv-panel="${app.id}" title="${app.title()}">${app.icon}${dot}</div>`;
}

function buildHtml() {
    const top = APPS.filter(a => !a.pinBottom);
    const bottom = APPS.filter(a => a.pinBottom);

    return `
<div class="wv-mockup">
  <div class="wv-screen">
    <div class="wv-status-bar" data-wv-drag>
      <div class="wv-datetime"><span class="wv-time"></span><span class="wv-date"></span></div>
      <div class="wv-status-icons">${ICONS.signal}${ICONS.battery}</div>
    </div>

    <div class="wv-app-header">
      <h1>${tr('appTitle')}</h1>
      <div class="wv-header-actions">
        <div class="wv-icon-btn" data-wv-action="close" title="${tr('close')}">${ICONS.close}</div>
      </div>
    </div>

    <div class="wv-main">
      <div class="wv-sidebar">
        ${top.map(sideIconHtml).join('')}
        <div class="wv-spacer"></div>
        ${bottom.map(sideIconHtml).join('')}
      </div>
      <div class="wv-content">
        ${APPS.map(app => `<div class="wv-panel ${app.id === activeAppId ? 'wv-active' : ''}" data-wv-panel-id="${app.id}">${app.html()}</div>`).join('')}
      </div>
    </div>

    ${APPS.map(app => app.overlayHtml?.() ?? '').join('')}
  </div>
</div>`;
}

function renderClock() {
    const clock = getStoryClock();
    $q('.wv-time').textContent = clock.time;
    $q('.wv-date').textContent = clock.date.toLocaleDateString(localeTag(), { weekday: 'short', day: 'numeric', month: 'short' });
    APPS.forEach(app => app.onClock?.(clock));
}

export function renderAll() {
    if (!getRoot()) return;
    renderClock();
    const data = getPhoneData();
    APPS.forEach(app => app.render(data));
}

function switchPanel(id) {
    activeAppId = id;
    $qa('[data-wv-panel]').forEach(i => i.classList.toggle('wv-active', i.dataset.wvPanel === id));
    $qa('[data-wv-panel-id]').forEach(p => p.classList.toggle('wv-active', p.dataset.wvPanelId === id));
    activeApp().onShow?.();
}

function bindEvents(root) {
    root.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);

        const panelBtn = target.closest('[data-wv-panel]');
        if (panelBtn) return switchPanel(panelBtn.dataset.wvPanel);

        const action = target.closest('[data-wv-action]')?.dataset.wvAction;
        if (action === 'close') return closePhone();

        for (const app of APPS) {
            if (app.onClick?.(target)) return;
        }
    });

    // Клавиши внутри телефона не должны улетать в чат таверны
    root.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key !== 'Escape') return;
        if (APPS.some(app => app.onEscape?.())) return;
        closePhone();
    });

    APPS.forEach(app => app.bind?.());

    // одно приложение поменяло данные — перерисовываем все
    document.addEventListener(DATA_EVENT, () => {
        if (isPhoneOpen()) APPS.forEach(app => app.render(getPhoneData()));
    });

    document.addEventListener(SETTINGS_EVENT, (e) => {
        if (/** @type {CustomEvent} */ (e).detail?.key === 'storyClock' && isPhoneOpen()) renderClock();
    });
}

export function createPhone() {
    const root = document.createElement('div');
    root.id = 'wavey-phone';
    root.innerHTML = buildHtml();
    document.body.appendChild(root);
    setRoot(root);

    const { phonePos } = getSettings();
    if (phonePos) placeAt(root, phonePos.left, phonePos.top);

    makeDraggable($q('[data-wv-drag]'), root, (pos) => {
        getSettings().phonePos = pos;
        saveSettings();
    }, { disableWhenNarrow: true });

    bindEvents(root);
}

export const isPhoneOpen = () => getRoot().classList.contains('wv-open');

export function openPhone() {
    renderAll();
    getRoot().classList.add('wv-open');
    clampIntoView(getRoot());
    clearInterval(clockTimer);
    clockTimer = setInterval(renderClock, CLOCK_POLL_MS);
}

export function closePhone() {
    getRoot().classList.remove('wv-open');
    resetTwitterOverlays();
    clearInterval(clockTimer);
    clockTimer = null;
}

/** Открыть телефон сразу на нужном приложении */
export function openApp(id) {
    if (!isPhoneOpen()) openPhone();
    switchPanel(id);
}

export function togglePhone() {
    isPhoneOpen() ? closePhone() : openPhone();
}

export function onChatChanged() {
    invalidateStoryClock();
    APPS.forEach(app => app.onChatChanged?.());
    if (isPhoneOpen()) renderAll();
}

/** В чате что-то поменялось (новое, правка, свайп, удаление) — дата/время могли сдвинуться */
export function onStoryChanged() {
    invalidateStoryClock();
    if (isPhoneOpen()) renderClock();
}

export function resetPhonePosition() {
    getRoot().style.cssText = '';
}
