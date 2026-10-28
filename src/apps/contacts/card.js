// Карточка контакта: просмотр и правка всех полей. Экран внутри телефона, без диалогов.

import { tr } from '../../i18n.js';
import { cleanHandle, findContact, HANDLE_MAX, isHandleTaken, makeContact, removeContact, sanitizeCount, uniqueHandle } from '../../core/contacts.js';
import { mnemaRelationOf } from '../../core/mnema.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { avatarHtml } from '../../ui/avatar.js';
import { el } from '../../ui/dom.js';

/** @type {{ id: string|null, twitter: boolean, confirmDelete: boolean } | null} */
let card = null;
let deleteTimer = null;

const input = (name) => /** @type {HTMLInputElement} */ (el(name));

/** Поле стиля растёт под текст — длинное описание видно целиком */
function fitStyleField() {
    const area = el('cardStyle');
    area.style.height = 'auto';
    area.style.height = area.scrollHeight + 2 + 'px';
}

export function contactCardHtml() {
    return `
<div class="wv-screen-page" data-wv="contactCard">
  <div class="wv-navbar">
    <div class="wv-nav-btn" data-wv-action="cardCancel">${tr('cancel')}</div>
    <div class="wv-navbar-title" data-wv="cardTitle"></div>
    <div class="wv-nav-btn wv-nav-strong" data-wv="cardDone" data-wv-action="cardDone">${tr('done')}</div>
  </div>
  <div class="wv-scroll wv-ios-scroll">
    <div class="wv-editor-avatar" data-wv="cardAvatar"></div>
    <div class="wv-card-badge" data-wv="cardBadge"></div>

    <div class="wv-ios-group">
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('savedAs')}</span>
        <input class="wv-field" type="text" data-wv="cardLabel" autocomplete="off" spellcheck="false">
      </label>
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('realName')}</span>
        <input class="wv-field" type="text" data-wv="cardName" autocomplete="off" spellcheck="false">
      </label>
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('username')}</span>
        <div class="wv-handle-field"><span>@</span>
          <input class="wv-field" type="text" data-wv="cardHandle" maxlength="${HANDLE_MAX}" autocomplete="off" spellcheck="false">
        </div>
      </label>
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('relation')}</span>
        <input class="wv-field" type="text" data-wv="cardRelation" autocomplete="off">
      </label>
    </div>
    <div class="wv-ios-footer" data-wv="cardHint"></div>

    <div class="wv-ios-section-title">${tr('textingStyle')}</div>
    <div class="wv-ios-group">
      <div class="wv-ios-field">
        <textarea class="wv-field wv-textarea" data-wv="cardStyle" rows="3" placeholder="${tr('textingStylePh')}"></textarea>
      </div>
    </div>

    <div class="wv-ios-section-title">Twitter</div>
    <div class="wv-ios-group">
      <div class="wv-ios-row" data-wv-action="cardTwitter">
        <div class="wv-ios-label">${tr('hasTwitter')}</div>
        <div class="wv-switch" data-wv="cardTwitterSwitch"><span></span></div>
      </div>
      <div class="wv-ios-field wv-field-pair" data-wv="cardTwitterStats">
        <label><span class="wv-ios-field-label">${tr('followers')}</span>
          <input class="wv-field" type="number" min="0" inputmode="numeric" data-wv="cardFollowers"></label>
        <label><span class="wv-ios-field-label">${tr('following')}</span>
          <input class="wv-field" type="number" min="0" inputmode="numeric" data-wv="cardFollowing"></label>
      </div>
    </div>

    <div class="wv-ios-group wv-ios-gap" data-wv="cardDeleteGroup">
      <div class="wv-ios-row wv-ios-button" data-wv-action="cardDelete" data-wv="cardDelete"></div>
    </div>
  </div>
</div>`;
}

function renderTwitterBlock() {
    el('cardTwitterSwitch').classList.toggle('wv-on', card.twitter);
    el('cardTwitterStats').style.display = card.twitter ? '' : 'none';
}

function refreshCard() {
    const data = getPhoneData();
    const name = input('cardName').value.trim();
    const label = input('cardLabel').value.trim();
    // пустая подпись — в телефоне видно настоящее имя
    input('cardLabel').placeholder = name || tr('savedAsPh');
    const handle = cleanHandle(input('cardHandle').value);
    const taken = data && handle && isHandleTaken(data, handle, card?.id);
    const contact = card?.id ? findContact(data, card.id) : null;

    el('cardAvatar').innerHTML = avatarHtml({ name: label || name || '?', charAvatar: contact?.charAvatar }, 'wv-lg');

    // подсказка из Mnema, если поле «кем приходится» пустое
    const fromMnema = !input('cardRelation').value.trim() ? mnemaRelationOf(name) : '';
    input('cardRelation').placeholder = fromMnema || tr('relationPh');

    const hint = el('cardHint');
    hint.textContent = taken ? tr('handleTaken') : fromMnema ? tr('mnemaHint', fromMnema) : '';
    hint.classList.toggle('wv-status', Boolean(taken));
    hint.classList.toggle('wv-error', Boolean(taken));

    // пустой юзернейм можно — подберём сами; введённый должен быть не короче 2 символов
    const valid = (name || label).length > 0 && (handle.length === 0 || handle.length >= 2) && !taken;
    el('cardDone').classList.toggle('wv-disabled', !valid);
    return valid;
}

/** @param {string|null} contactId null — новый контакт */
export function openContactCard(contactId = null) {
    const data = getPhoneData();
    if (!data) return;
    const contact = contactId ? findContact(data, contactId) : null;

    card = { id: contact?.id ?? null, twitter: Boolean(contact?.twitter.enabled), confirmDelete: false };

    el('cardTitle').textContent = contact ? tr('contact') : tr('newContact');
    el('cardBadge').textContent = contact?.main ? tr('storyCharacter') : '';
    input('cardName').value = contact?.name ?? '';
    input('cardLabel').value = contact?.label ?? '';
    input('cardHandle').value = cleanHandle(contact?.handle ?? '');
    input('cardRelation').value = contact?.relation ?? '';
    /** @type {HTMLTextAreaElement} */ (el('cardStyle')).value = contact?.style ?? '';
    input('cardFollowers').value = String(contact?.twitter.followers ?? 0);
    input('cardFollowing').value = String(contact?.twitter.following ?? 0);

    el('cardDeleteGroup').style.display = contact && !contact.main ? '' : 'none';
    el('cardDelete').textContent = tr('deleteContact');

    renderTwitterBlock();
    refreshCard();
    el('contactCard').classList.add('wv-open');
    requestAnimationFrame(fitStyleField);
    if (!contact) setTimeout(() => input('cardLabel').focus(), 260);
}

function closeCard() {
    card = null;
    clearTimeout(deleteTimer);
    el('contactCard')?.classList.remove('wv-open');
    /** @type {HTMLElement} */ (document.activeElement)?.blur?.();
}

function saveCard() {
    if (!card || !refreshCard()) return;
    const data = getPhoneData();
    if (!data) return closeCard();

    const label = input('cardLabel').value.trim();
    const fields = {
        // имя обязательно для модели; если вписали только подпись — берём её
        name: input('cardName').value.trim() || label,
        label,
        handle: cleanHandle(input('cardHandle').value),
        relation: input('cardRelation').value.trim(),
        style: /** @type {HTMLTextAreaElement} */ (el('cardStyle')).value.trim(),
        twitter: {
            enabled: card.twitter,
            followers: sanitizeCount(input('cardFollowers').value),
            following: sanitizeCount(input('cardFollowing').value),
        },
    };

    const contact = card.id ? findContact(data, card.id) : null;
    if (contact) {
        Object.assign(contact, fields, { edited: true });
        contact.handle = uniqueHandle(data, fields.handle, contact.name, contact.id);
    }
    else data.contacts.push(makeContact(data, { ...fields, source: 'manual', edited: true }));

    closeCard();
    notifyDataChanged();
}

function deleteCard() {
    if (!card?.id) return;
    // вместо диалога — второе нажатие подтверждает
    if (!card.confirmDelete) {
        card.confirmDelete = true;
        el('cardDelete').textContent = tr('deleteConfirm');
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(() => {
            if (!card) return;
            card.confirmDelete = false;
            el('cardDelete').textContent = tr('deleteContact');
        }, 3000);
        return;
    }
    const data = getPhoneData();
    const id = card.id;
    closeCard();
    if (data && removeContact(data, id)) notifyDataChanged();
    document.dispatchEvent(new CustomEvent('wavey:contact-removed', { detail: { id } }));
}

export function bindContactCard() {
    el('cardStyle').addEventListener('input', fitStyleField);
    for (const name of ['cardLabel', 'cardName', 'cardHandle', 'cardRelation']) {
        el(name).addEventListener('input', () => {
            if (name === 'cardHandle') {
                const clean = cleanHandle(input('cardHandle').value);
                if (clean !== input('cardHandle').value) input('cardHandle').value = clean;
            }
            refreshCard();
        });
    }
}

/** @param {HTMLElement} target */
export function contactCardOnClick(target) {
    switch (target.closest('[data-wv-action]')?.dataset.wvAction) {
        case 'cardCancel': return closeCard(), true;
        case 'cardDone': return saveCard(), true;
        case 'cardDelete': return deleteCard(), true;
        case 'cardTwitter':
            if (card) { card.twitter = !card.twitter; renderTwitterBlock(); }
            return true;
    }
    return false;
}

export function contactCardOnEscape() {
    if (!card) return false;
    closeCard();
    return true;
}

export const isContactCardOpen = () => Boolean(card);
export const closeContactCard = () => card && closeCard();
