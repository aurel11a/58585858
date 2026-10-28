// Подстраница настроек «Экстра API»

import { tr } from '../../i18n.js';
import { LOG } from '../../core/context.js';
import { escapeHtml } from '../../core/format.js';
import { getApi, saveSettings } from '../../core/settings.js';
import { fetchModels, isConnectionManagerAvailable, listProfiles, testConnection } from '../../core/api.js';
import { ICONS } from '../../ui/icons.js';
import { $q, $qa, el } from '../../ui/dom.js';

function optionsHtml(items, selected, placeholder) {
    const opts = [`<option value="">${escapeHtml(placeholder)}</option>`];
    for (const { value, label } of items) {
        opts.push(`<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`);
    }
    return opts.join('');
}

/** Короткое описание текущего подключения для строки в списке настроек */
export function apiSummary() {
    const api = getApi();
    if (api.mode === 'profile') {
        return listProfiles().find(p => p.id === api.profileId)?.name ?? tr('notConfigured');
    }
    return api.endpoint && api.model ? api.model : tr('notConfigured');
}

function renderModelOptions() {
    const api = getApi();
    const models = [...api.models];
    // выбранная модель остаётся в списке, даже если список ещё не обновляли
    if (api.model && !models.includes(api.model)) models.unshift(api.model);
    el('apiModel').innerHTML = optionsHtml(models.map(m => ({ value: m, label: m })), api.model, tr('selectModel'));
}

function setStatus(text, kind = '') {
    const status = el('apiStatus');
    status.textContent = text;
    status.className = `wv-ios-footer wv-status ${kind ? 'wv-' + kind : ''}`;
}

function setMode(mode) {
    getApi().mode = mode;
    saveSettings();
    setStatus('');
    apiPage.render();
}

function toggleKeyVisibility() {
    const input = /** @type {HTMLInputElement} */ (el('apiKey'));
    input.type = input.type === 'password' ? 'text' : 'password';
}

function explainError(error) {
    const map = {
        'no-profile': tr('errNoProfile'),
        'no-endpoint': tr('errNoEndpoint'),
        'no-model': tr('errNoModel'),
        unreachable: tr('errUnreachable'),
    };
    const message = error?.cause?.message || error?.message || String(error);
    return map[message] ?? message;
}

async function refreshModels() {
    const api = getApi();
    const btn = $q('[data-wv-action="refreshModels"]');
    btn.classList.add('wv-spin');
    setStatus(tr('testing'));
    try {
        api.models = await fetchModels(api.endpoint, api.key);
        saveSettings();
        renderModelOptions();
        setStatus(tr('modelsLoaded', api.models.length), 'ok');
    } catch (error) {
        console.warn(LOG, 'models', error);
        setStatus(tr('modelsFailed', explainError(error)), 'error');
    } finally {
        btn.classList.remove('wv-spin');
    }
}

async function runTest() {
    const btn = $q('[data-wv-action="testApi"]');
    if (btn.classList.contains('wv-busy')) return;
    btn.classList.add('wv-busy');
    setStatus(tr('testing'));
    try {
        const { ms } = await testConnection(getApi());
        setStatus(tr('testOk', ms), 'ok');
    } catch (error) {
        console.warn(LOG, 'test', error);
        setStatus(tr('testFail', explainError(error)), 'error');
    } finally {
        btn.classList.remove('wv-busy');
    }
}

export const apiPage = {
    id: 'api',
    title: () => tr('apiSection'),

    html: () => `
<div class="wv-ios-section-title">${tr('source')}</div>
<div class="wv-segmented" data-wv="apiMode">
  <div class="wv-seg" data-wv-mode="profile">${tr('modeProfile')}</div>
  <div class="wv-seg" data-wv-mode="manual">${tr('modeManual')}</div>
</div>
<div class="wv-ios-footer">${tr('apiHint')}</div>

<div data-wv-mode-block="profile">
  <div class="wv-ios-section-title">${tr('profile')}</div>
  <div class="wv-ios-group">
    <div class="wv-ios-field">
      <select class="wv-select" data-wv="apiProfile"></select>
    </div>
  </div>
  <div class="wv-ios-footer" data-wv="profileNote"></div>
</div>

<div data-wv-mode-block="manual">
  <div class="wv-ios-section-title">${tr('connection')}</div>
  <div class="wv-ios-group">
    <label class="wv-ios-field">
      <span class="wv-ios-field-label">${tr('endpoint')}</span>
      <input class="wv-field" type="text" data-wv="apiEndpoint" placeholder="${tr('endpointPh')}" autocomplete="off" spellcheck="false">
    </label>
    <div class="wv-ios-field">
      <span class="wv-ios-field-label">${tr('apiKey')}</span>
      <div class="wv-field-row">
        <input class="wv-field" type="password" data-wv="apiKey" placeholder="sk-…" autocomplete="off" spellcheck="false">
        <div class="wv-icon-btn wv-field-btn" data-wv-action="toggleKey" title="${tr('showKey')}">${ICONS.eye}</div>
      </div>
    </div>
    <div class="wv-ios-field">
      <span class="wv-ios-field-label">${tr('model')}</span>
      <div class="wv-field-row">
        <select class="wv-select" data-wv="apiModel"></select>
        <div class="wv-icon-btn wv-field-btn" data-wv-action="refreshModels" title="${tr('refreshModels')}">${ICONS.refresh}</div>
      </div>
    </div>
  </div>
  <div class="wv-ios-footer">${tr('keyStoredNote')}</div>
</div>

<div class="wv-ios-group wv-ios-gap">
  <div class="wv-ios-row wv-ios-button" data-wv-action="testApi">${tr('testConnection')}</div>
</div>
<div class="wv-ios-footer wv-status" data-wv="apiStatus"></div>`,

    bind() {
        el('apiProfile').addEventListener('change', (e) => {
            getApi().profileId = /** @type {HTMLSelectElement} */ (e.target).value;
            saveSettings();
            setStatus('');
        });
        el('apiEndpoint').addEventListener('input', (e) => {
            getApi().endpoint = /** @type {HTMLInputElement} */ (e.target).value.trim();
            saveSettings();
        });
        el('apiKey').addEventListener('input', (e) => {
            getApi().key = /** @type {HTMLInputElement} */ (e.target).value.trim();
            saveSettings();
        });
        el('apiModel').addEventListener('change', (e) => {
            getApi().model = /** @type {HTMLSelectElement} */ (e.target).value;
            saveSettings();
            setStatus('');
        });
    },

    render() {
        const api = getApi();

        $qa('[data-wv-mode]').forEach(b => b.classList.toggle('wv-active', b.dataset.wvMode === api.mode));
        $qa('[data-wv-mode-block]').forEach(b => { b.style.display = b.dataset.wvModeBlock === api.mode ? '' : 'none'; });

        const profiles = listProfiles();
        const profileSelect = /** @type {HTMLSelectElement} */ (el('apiProfile'));
        profileSelect.innerHTML = optionsHtml(profiles.map(p => ({ value: p.id, label: p.name })), api.profileId, tr('selectProfile'));
        profileSelect.disabled = !profiles.length;
        el('profileNote').textContent = !isConnectionManagerAvailable() ? tr('cmDisabled') : profiles.length ? '' : tr('noProfiles');

        /** @type {HTMLInputElement} */ (el('apiEndpoint')).value = api.endpoint;
        /** @type {HTMLInputElement} */ (el('apiKey')).value = api.key;
        renderModelOptions();
    },

    /** @param {HTMLElement} target */
    onClick(target) {
        const modeBtn = target.closest('[data-wv-mode]');
        if (modeBtn) return setMode(modeBtn.dataset.wvMode), true;

        switch (target.closest('[data-wv-action]')?.dataset.wvAction) {
            case 'toggleKey': return toggleKeyVisibility(), true;
            case 'refreshModels': return refreshModels(), true;
            case 'testApi': return runTest(), true;
        }
        return false;
    },
};
