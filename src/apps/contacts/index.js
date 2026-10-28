// Приложение «Контакты»: телефонная книга юзера. Персонажи истории + люди,
// которых придумывает экстра-API. Тап по контакту открывает переписку.

import { tr } from '../../i18n.js';
import { LOG } from '../../core/context.js';
import { escapeHtml } from '../../core/format.js';
import { displayName, sortedContacts } from '../../core/contacts.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { avatarHtml } from '../../ui/avatar.js';
import { ICONS } from '../../ui/icons.js';
import { el } from '../../ui/dom.js';
import { bindContactCard, closeContactCard, contactCardHtml, contactCardOnClick, contactCardOnEscape, openContactCard } from './card.js';
import { generateContacts } from './generate.js';

let generating = false;

function setStatus(text, kind = '') {
    const status = el('contactsStatus');
    status.textContent = text;
    status.className = `wv-list-status ${kind ? 'wv-' + kind : ''}`;
}

function explainError(error) {
    const message = error?.cause?.message || error?.message || String(error);
    const map = {
        'no-profile': tr('errNoProfile'),
        'no-endpoint': tr('errNoEndpoint'),
        'no-model': tr('errNoModel'),
        unreachable: tr('errUnreachable'),
        'bad-json': tr('errBadJson'),
    };
    return map[message] ?? (error instanceof SyntaxError ? tr('errBadJson') : message);
}

async function runGeneration() {
    const data = getPhoneData();
    if (!data || generating) return;

    generating = true;
    el('genContacts').classList.add('wv-spin');
    setStatus(tr('genContacts'));
    try {
        const added = await generateContacts(data);
        notifyDataChanged();
        const any = added.contacts || added.groups || added.chats;
        setStatus(any ? tr('genAdded', added.contacts, added.groups, added.chats) : tr('genNothing'), 'ok');
        setTimeout(() => setStatus(''), 4000);
    } catch (error) {
        console.warn(LOG, 'contacts', error);
        setStatus(tr('testFail', explainError(error)), 'error');
    } finally {
        generating = false;
        el('genContacts').classList.remove('wv-spin');
    }
}

function contactRowHtml(contact) {
    return `
<div class="wv-row" data-open-chat="${escapeHtml(contact.id)}">
  ${avatarHtml(contact)}
  <div class="wv-info">
    <div class="wv-name"><b>${escapeHtml(displayName(contact))}</b><span class="wv-ts">${escapeHtml(contact.handle)}</span></div>
    <div class="wv-contact-note">${escapeHtml(contact.relation || tr('noRelation'))}</div>
  </div>
</div>`;
}

/** @type {import('../types.js').PhoneApp} */
export const contactsApp = {
    id: 'contacts',
    icon: ICONS.users,
    title: () => tr('contacts'),

    html: () => `
<div class="wv-list-header">
  ${tr('contacts')}
  <div class="wv-header-tools">
    <div class="wv-icon-btn" data-wv="genContacts" data-wv-action="genContacts" title="${tr('genContactsTitle')}">${ICONS.sparkle}</div>
    <div class="wv-icon-btn" data-wv-action="newContact" title="${tr('newContact')}">${ICONS.plus}</div>
  </div>
</div>
<div class="wv-list-status" data-wv="contactsStatus"></div>
<div class="wv-scroll wv-list" data-wv="contactList"></div>`,

    overlayHtml: contactCardHtml,

    bind() {
        bindContactCard();
    },

    render(data) {
        const list = el('contactList');
        if (!data) {
            list.innerHTML = `<div class="wv-empty">${tr('noContacts')}</div>`;
            return;
        }

        const contacts = sortedContacts(data);
        const story = contacts.filter(c => c.main);
        const others = contacts.filter(c => !c.main);

        list.innerHTML = story.map(contactRowHtml).join('')
            + (others.length ? `<div class="wv-list-divider"></div>${others.map(contactRowHtml).join('')}` : '')
            + (others.length ? '' : `<div class="wv-empty wv-empty-hint">${tr('contactsHint')}</div>`);
    },

    onClick(target) {
        if (contactCardOnClick(target)) return true;
        switch (target.closest('[data-wv-action]')?.dataset.wvAction) {
            case 'genContacts': return runGeneration(), true;
            case 'newContact': return openContactCard(null), true;
        }
        // тап по строке контакта ловит мессенджер (data-open-chat)
        return false;
    },

    onEscape: contactCardOnEscape,

    onChatChanged() {
        closeContactCard();
        setStatus('');
    },
};

