// Аккаунты твиттера: шторка выбора снизу и экран создания/редактирования.
// Всё внутри телефона — никаких диалогов таверны. У аккаунта: фото из галереи, имя, юзернейм,
// био, читатели/читаю и заметка «что это за профиль» (её видит только модель).

import { tr } from '../../i18n.js';
import { LOG } from '../../core/context.js';
import { escapeHtml, makeHandle } from '../../core/format.js';
import { getCurrentAccount, getPhoneData, makeAccount, savePhoneData } from '../../core/store.js';
import { isHandleTaken, sanitizeCount } from '../../core/contacts.js';
import { avatarHtml } from '../../ui/avatar.js';
import { deleteImage, pickImageFile, squareAvatar, uploadImage } from '../../ui/image.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';

/** @type {() => void} перерисовать твиттер после изменений */
let onChange = () => {};

/**
 * avatar: undefined — фото не трогали, null — убрали, объект — новое фото (в папку уходит по «Готово»)
 * @type {{ mode: 'new'|'edit', handleTouched: boolean, avatar?: { blob: Blob, preview: string } | null, saving?: boolean } | null}
 */
let editor = null;

const HANDLE_MAX = 15;

export function accountsOverlayHtml() {
    return `
<div class="wv-sheet-backdrop" data-wv="sheetBackdrop"></div>
<div class="wv-sheet" data-wv="accountSheet">
  <div class="wv-sheet-grabber"></div>
  <div class="wv-sheet-title">${tr('accounts')}</div>
  <div class="wv-ios-group" data-wv="accountList"></div>
  <div class="wv-ios-group">
    <div class="wv-ios-row wv-ios-link" data-wv-action="newAccount">
      <div class="wv-ios-tile">${ICONS.plus}</div>
      <div class="wv-ios-label">${tr('addAccount')}</div>
    </div>
  </div>
</div>

<div class="wv-screen-page" data-wv="accountEditor">
  <div class="wv-navbar">
    <div class="wv-nav-btn" data-wv-action="editorCancel">${tr('cancel')}</div>
    <div class="wv-navbar-title" data-wv="editorTitle"></div>
    <div class="wv-nav-btn wv-nav-strong" data-wv="editorDone" data-wv-action="editorDone">${tr('done')}</div>
  </div>
  <div class="wv-scroll wv-ios-scroll">
    <div class="wv-editor-avatar" data-wv="editorAvatar"></div>
    <div class="wv-photo-actions">
      <span data-wv-action="editorPhoto">${tr('choosePhoto')}</span>
      <span data-wv="editorPhotoRemove" data-wv-action="editorPhotoRemove">${tr('removePhoto')}</span>
    </div>

    <div class="wv-ios-group">
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('displayName')}</span>
        <input class="wv-field" type="text" data-wv="editorName" autocomplete="off" spellcheck="false">
      </label>
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('username')}</span>
        <div class="wv-handle-field">
          <span>@</span>
          <input class="wv-field" type="text" data-wv="editorHandle" maxlength="${HANDLE_MAX}" autocomplete="off" spellcheck="false">
        </div>
      </label>
      <div class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('bio')}</span>
        <textarea class="wv-field wv-textarea" data-wv="editorBio" rows="2" placeholder="${tr('bioPh')}"></textarea>
      </div>
      <div class="wv-ios-field wv-field-pair">
        <label><span class="wv-ios-field-label">${tr('followers')}</span>
          <input class="wv-field" type="number" min="0" inputmode="numeric" data-wv="editorFollowers"></label>
        <label><span class="wv-ios-field-label">${tr('following')}</span>
          <input class="wv-field" type="number" min="0" inputmode="numeric" data-wv="editorFollowing"></label>
      </div>
    </div>
    <div class="wv-ios-footer" data-wv="editorHint"></div>

    <div class="wv-ios-section-title">${tr('accountNote')}</div>
    <div class="wv-ios-group">
      <div class="wv-ios-field">
        <textarea class="wv-field wv-textarea" data-wv="editorNote" rows="3" placeholder="${tr('accountNotePh')}"></textarea>
      </div>
    </div>
    <div class="wv-ios-footer">${tr('accountNoteHint')}</div>

    <div class="wv-ios-section-title">${tr('accountInterests')}</div>
    <div class="wv-ios-group">
      <div class="wv-ios-field">
        <textarea class="wv-field wv-textarea" data-wv="editorInterests" rows="3" placeholder="${tr('accountInterestsPh')}"></textarea>
      </div>
    </div>
    <div class="wv-ios-footer">${tr('accountInterestsHint')}</div>
  </div>
</div>`;
}

// ---------- шторка ----------

function renderSheet(data) {
    const current = getCurrentAccount(data);
    el('accountList').innerHTML = data.accounts.map(a => `
<div class="wv-ios-row wv-account-row" data-account-id="${escapeHtml(a.id)}">
  ${avatarHtml(a, 'wv-sm')}
  <div class="wv-account-info">
    <div class="wv-account-name">${escapeHtml(a.name)}</div>
    <div class="wv-account-handle">${escapeHtml(a.handle)}</div>
  </div>
  <div class="wv-check ${a.id === current.id ? 'wv-on' : ''}">${ICONS.check}</div>
</div>`).join('');
}

export function openAccountSheet() {
    const data = getPhoneData();
    if (!data) return;
    renderSheet(data);
    el('sheetBackdrop').classList.add('wv-open');
    el('accountSheet').classList.add('wv-open');
}

export function closeAccountSheet() {
    el('sheetBackdrop')?.classList.remove('wv-open');
    el('accountSheet')?.classList.remove('wv-open');
}

function selectAccount(id) {
    const data = getPhoneData();
    if (!data) return;
    data.currentAccountId = id;
    savePhoneData();
    renderSheet(data);
    onChange();
    // даём увидеть галочку, потом закрываем
    setTimeout(closeAccountSheet, 180);
}

// ---------- экран редактора ----------

const field = (name) => /** @type {HTMLInputElement} */ (el(name));

function cleanHandle(value) {
    return String(value).toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '').slice(0, HANDLE_MAX);
}

/** Аккаунт, который сейчас редактируем (для нового — null) */
function editedAccount(data) {
    return editor?.mode === 'edit' && data ? getCurrentAccount(data) : null;
}

function refreshEditor() {
    const name = field('editorName').value.trim();
    const handle = field('editorHandle').value;
    const data = getPhoneData();
    const account = editedAccount(data);
    // юзернейм уникален и среди аккаунтов, и среди контактов
    const taken = Boolean(data && handle && isHandleTaken(data, handle, account?.id ?? null));

    // превью: выбранное фото → фото аккаунта → картинка персоны / буква
    const photo = editor?.avatar === undefined
        ? { avatarPath: account?.avatarPath ?? null, avatarData: account?.avatarData ?? null }
        : { avatarPreview: editor.avatar?.preview ?? null, avatarPath: null, avatarData: null };
    el('editorAvatar').innerHTML = avatarHtml({ ...(account ?? {}), name: name || '?', ...photo }, 'wv-lg');
    el('editorPhotoRemove').style.display = photo.avatarPreview || photo.avatarPath || photo.avatarData ? '' : 'none';

    el('editorHint').textContent = taken ? tr('handleTaken') : '';
    el('editorHint').classList.toggle('wv-status', !!taken);
    el('editorHint').classList.toggle('wv-error', !!taken);

    const valid = name.length > 0 && handle.length > 0 && !taken;
    el('editorDone').classList.toggle('wv-disabled', !valid || Boolean(editor?.saving));
    return valid;
}

function fitTextareas() {
    for (const name of ['editorBio', 'editorNote', 'editorInterests']) {
        const area = el(name);
        area.style.height = 'auto';
        area.style.height = area.scrollHeight + 2 + 'px';
    }
}

export function openAccountEditor(mode) {
    const data = getPhoneData();
    if (!data) return;
    closeAccountSheet();

    editor = { mode, handleTouched: mode === 'edit', avatar: undefined };
    const account = mode === 'edit' ? getCurrentAccount(data) : null;

    el('editorTitle').textContent = mode === 'edit' ? tr('editProfile') : tr('newAccount');
    field('editorName').value = account?.name ?? '';
    field('editorHandle').value = account ? cleanHandle(account.handle) : '';
    field('editorBio').value = account?.bio ?? '';
    field('editorNote').value = account?.note ?? '';
    field('editorInterests').value = account?.interests ?? '';
    field('editorFollowers').value = String(account?.followers ?? 0);
    field('editorFollowing').value = String(account?.following ?? 0);
    refreshEditor();
    el('accountEditor').classList.add('wv-open');
    requestAnimationFrame(fitTextareas);
    if (mode === 'new') setTimeout(() => field('editorName').focus(), 260);
}

/** Превью нового фото живёт в памяти, пока не нажали «Готово» */
function dropPreview() {
    if (editor?.avatar?.preview) URL.revokeObjectURL(editor.avatar.preview);
}

function closeEditor() {
    dropPreview();
    editor = null;
    el('accountEditor')?.classList.remove('wv-open');
    field('editorName')?.blur();
}

async function choosePhoto() {
    if (!editor) return;
    const file = await pickImageFile();
    if (!file || !editor) return;
    try {
        const blob = await squareAvatar(file);
        if (!editor) return;
        dropPreview();
        editor.avatar = { blob, preview: URL.createObjectURL(blob) };
        refreshEditor();
    } catch (error) {
        console.warn(LOG, 'avatar', error);
    }
}

async function saveEditor() {
    if (!editor || editor.saving || !refreshEditor()) return;
    const data = getPhoneData();
    if (!data) return closeEditor();

    // новое фото — сначала файлом в папку wavey, в данных останется только путь
    let newPath;
    if (editor.avatar) {
        editor.saving = true;
        refreshEditor();
        try {
            newPath = await uploadImage(editor.avatar.blob);
        } catch (error) {
            console.warn(LOG, 'avatar upload', error);
            editor.saving = false;
            el('editorHint').textContent = tr('photoFailed');
            return refreshEditor();
        }
        if (!editor) return;
    }

    const name = field('editorName').value.trim();
    const handle = '@' + field('editorHandle').value;
    const fields = {
        bio: field('editorBio').value.trim(),
        note: field('editorNote').value.trim(),
        interests: field('editorInterests').value.trim(),
        followers: sanitizeCount(field('editorFollowers').value),
        following: sanitizeCount(field('editorFollowing').value),
    };

    let account;
    if (editor.mode === 'new') {
        account = makeAccount(name);
        account.handle = handle;
        data.accounts.push(account);
        data.currentAccountId = account.id;
    } else {
        account = getCurrentAccount(data);
        account.name = name;
        account.handle = handle;
        // старые твиты и ответы хранят снимок автора — обновляем подпись
        for (const tweet of data.tweets) {
            for (const node of [tweet, ...(tweet.replies ?? [])]) {
                if (node.author.id === account.id) Object.assign(node.author, { name, handle });
            }
        }
    }
    Object.assign(account, fields);
    if (editor.avatar !== undefined) {
        // старый файл больше не нужен
        if (account.avatarPath && account.avatarPath !== newPath) deleteImage(account.avatarPath);
        account.avatarPath = newPath ?? null;
        delete account.avatarData;
    }

    savePhoneData();
    closeEditor();
    onChange();
}

// ---------- подключение к приложению ----------

export function bindAccounts(changeCallback) {
    onChange = changeCallback;

    field('editorName').addEventListener('input', () => {
        // пока юзернейм не трогали руками, он следует за именем
        if (editor && !editor.handleTouched) field('editorHandle').value = cleanHandle(makeHandle(field('editorName').value));
        refreshEditor();
    });
    field('editorHandle').addEventListener('input', () => {
        if (editor) editor.handleTouched = true;
        const input = field('editorHandle');
        const clean = cleanHandle(input.value);
        if (clean !== input.value) input.value = clean;
        refreshEditor();
    });
    for (const name of ['editorBio', 'editorNote', 'editorInterests']) el(name).addEventListener('input', fitTextareas);
    el('accountEditor').addEventListener('keydown', (e) => {
        // Enter в однострочных полях — «Готово», в био и заметке — новая строка
        if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).tagName !== 'TEXTAREA') saveEditor();
    });
}

/** @param {HTMLElement} target */
export function accountsOnClick(target) {
    const action = target.closest('[data-wv-action]')?.dataset.wvAction;
    switch (action) {
        case 'newAccount': return openAccountEditor('new'), true;
        case 'editProfile': return openAccountEditor('edit'), true;
        case 'editorCancel': return closeEditor(), true;
        case 'editorDone': return saveEditor(), true;
        case 'editorPhoto': return choosePhoto(), true;
        case 'editorPhotoRemove':
            if (editor) { dropPreview(); editor.avatar = null; refreshEditor(); }
            return true;
    }

    if (target.closest('[data-wv="sheetBackdrop"]')) return closeAccountSheet(), true;

    const row = target.closest('[data-account-id]');
    if (row) return selectAccount(row.dataset.accountId), true;

    return false;
}

export function accountsOnEscape() {
    if (editor) return closeEditor(), true;
    if (el('accountSheet').classList.contains('wv-open')) return closeAccountSheet(), true;
    return false;
}

export function resetAccounts() {
    closeAccountSheet();
    closeEditor();
}
