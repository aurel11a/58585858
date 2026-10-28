// Входы в телефон: плавающая кнопка, пункт в волшебной палочке, блок в настройках расширений

import { tr } from './i18n.js';
import { getSettings, saveSettings, setFloatingButton, SETTINGS_EVENT } from './core/settings.js';
import { DATA_EVENT } from './core/store.js';
import { ctx, MODULE } from './core/context.js';
import { clampIntoView, makeDraggable, placeAt } from './ui/drag.js';
import { ICONS } from './ui/icons.js';
import { openPhone, resetPhonePosition, togglePhone } from './phone.js';

/** @type {HTMLElement} */
let fabEl;

const FAB_DEFAULT_POS = 'right:20px;bottom:120px';

function updateFabVisibility() {
    const enabled = getSettings().floatingButton;
    fabEl?.classList.toggle('wv-hidden', !enabled);
    const checkbox = /** @type {HTMLInputElement} */ (document.getElementById('wavey_floating'));
    if (checkbox) checkbox.checked = enabled;
}

export function createFab() {
    fabEl = document.createElement('div');
    fabEl.id = 'wavey-fab';
    fabEl.title = tr('menuOpen');
    fabEl.innerHTML = `${ICONS.phone}<span class="wv-fab-dot"></span>`;
    document.body.appendChild(fabEl);

    const { fabPos } = getSettings();
    if (fabPos) placeAt(fabEl, fabPos.left, fabPos.top);
    else fabEl.style.cssText = FAB_DEFAULT_POS;

    const wasDragged = makeDraggable(fabEl, fabEl, (pos) => {
        getSettings().fabPos = pos;
        saveSettings();
    });

    fabEl.addEventListener('click', () => {
        if (!wasDragged()) togglePhone();
    });

    document.addEventListener(SETTINGS_EVENT, updateFabVisibility);
    document.addEventListener(DATA_EVENT, updateFabDot);
    window.addEventListener('resize', () => clampIntoView(fabEl));
    updateFabVisibility();
}

/** Точка на кнопке — есть непрочитанные в телефоне этого чата */
export function updateFabDot() {
    // читаем напрямую, не создавая данные телефона в чатах, где его ещё не открывали
    const data = ctx().chatMetadata?.[MODULE];
    // непрочитанные сообщения или новые реакции в твиттере
    const unread = (data?.chats ?? []).some(chat => chat.unread > 0) || Boolean(data?.twitterUnseen);
    fabEl?.querySelector('.wv-fab-dot')?.classList.toggle('wv-show', unread);
}

export function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('wavey-wand-button')) return;

    const item = document.createElement('div');
    item.id = 'wavey-wand-button';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid fa-mobile-screen extensionsMenuExtensionButton"></div><span>${tr('menuOpen')}</span>`;
    item.addEventListener('click', () => {
        togglePhone();
        // закрываем меню палочки, как это делают встроенные пункты
        document.getElementById('extensionsMenuButton')?.click();
    });
    menu.appendChild(item);
}

export function addExtensionSettings() {
    const container = document.getElementById('extensions_settings2');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', `
<div class="wavey-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Wavey</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label" for="wavey_floating">
        <input type="checkbox" id="wavey_floating" ${getSettings().floatingButton ? 'checked' : ''}>
        <span>${tr('settingsFloating')}</span>
      </label>
      <div class="flex-container">
        <div class="menu_button" id="wavey_open">${tr('menuOpen')}</div>
        <div class="menu_button" id="wavey_reset_pos">${tr('settingsResetPos')}</div>
      </div>
    </div>
  </div>
</div>`);

    document.getElementById('wavey_floating').addEventListener('change', (e) => {
        setFloatingButton(/** @type {HTMLInputElement} */ (e.target).checked);
    });
    document.getElementById('wavey_open').addEventListener('click', openPhone);
    document.getElementById('wavey_reset_pos').addEventListener('click', () => {
        const settings = getSettings();
        settings.fabPos = null;
        settings.phonePos = null;
        saveSettings();
        fabEl.style.cssText = FAB_DEFAULT_POS;
        resetPhonePosition();
    });
}
