// Мессенджер: список переписок (личные и группы) и экран чата.
// Время сообщений — сюжетное (getStoryNow), а не реальное.

import { tr } from '../../i18n.js';
import { escapeHtml, localeTag } from '../../core/format.js';
import { displayName, findContact, findGroup, getChat, getGroupChat, isIncoming, lastMessage, makeGroup, nextTs, orderMessages, sortedContacts } from '../../core/contacts.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { getStoryNow } from '../../core/story-clock.js';
import { avatarHtml } from '../../ui/avatar.js';
import { ICONS } from '../../ui/icons.js';
import { $q, el } from '../../ui/dom.js';
import { isContactCardOpen, openContactCard } from '../contacts/card.js';
import { clearReplyError, isTyping, replyError, requestReply } from './reply.js';
import { ReplyPacer } from '../../ui/pacer.js';
import { formatDuration, voiceDuration, waveform } from '../../core/voice.js';
import { deleteImage, imageUrl, pickImageFile, preparePhoto, uploadImage } from '../../ui/image.js';
import { requestChatImage } from '../twitter/images.js';

/** @type {{ type: 'contact'|'group', id: string } | null} */
let open = null;
/** @type {string|null} группа, открытая на экране «О группе» */
let groupInfoId = null;

// ---------- время ----------

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const clockOf = (ts) => new Date(ts).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
const dayOf = (ts) => new Date(ts).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' });

/** В списке: сегодня (по сюжету) — время, иначе дата */
function listStamp(ts) {
    const date = new Date(ts);
    return sameDay(date, getStoryNow()) ? clockOf(ts) : date.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' });
}

// ---------- общее ----------

function groupAvatarHtml(size = '') {
    return `<div class="wv-avatar wv-group-avatar ${size}">${ICONS.users}</div>`;
}

/** Чат, открытый сейчас, или null */
function currentChat(data, create = false) {
    if (!open || !data) return null;
    return open.type === 'group' ? getGroupChat(data, open.id, create) : getChat(data, open.id, create);
}

/** Текст сообщения для превью: пересланный твит подписываем, как в настоящем мессенджере */
const summaryOf = (message) => {
    if (message.photo || message.image) return `${tr('photoMsg')}${message.text ? ` · ${message.text}` : ''}`;
    if (message.voice) return `${tr('voiceMessage')} · ${formatDuration(voiceDuration(message.text))}`;
    return message.tweet ? `${tr('sharedTweet')} ${message.tweet.handle}${message.text ? ` · ${message.text}` : ''}` : message.text;
};

/** Короткая подпись отправителя в превью группы: подпись в телефоне или первое имя */
const shortName = (contact) => (contact?.label ? contact.label : String(contact?.name ?? '?').split(/\s+/)[0]);

// ---------- список ----------

function chatRowHtml(data, chat) {
    const last = lastMessage(chat);
    const badge = chat.unread ? `<span class="wv-badge">${chat.unread}</span>` : '';

    if (chat.groupId) {
        const group = findGroup(data, chat.groupId);
        const sender = !last ? '' : last.from === 'user' ? tr('youPrefix') : `${shortName(findContact(data, last.from))}: `;
        const typing = isTyping({ type: 'group', id: group.id });
        const preview = last ? escapeHtml(sender + summaryOf(last)) : `<i>${tr('groupCreated')}</i>`;
        return `
<div class="wv-row" data-open-group="${escapeHtml(group.id)}">
  ${groupAvatarHtml()}
  <div class="wv-info">
    <div class="wv-name"><b>${escapeHtml(group.name)}</b><span class="wv-ts">${last ? listStamp(last.ts) : ''}</span></div>
    <div class="wv-preview"><span>${typing ? `<i>${tr('typing')}</i>` : preview}</span>${badge}</div>
  </div>
</div>`;
    }

    const contact = findContact(data, chat.contactId);
    const preview = (last.from === 'user' ? tr('youPrefix') : '') + summaryOf(last);
    const typing = isTyping({ type: 'contact', id: contact.id });
    return `
<div class="wv-row" data-open-chat="${escapeHtml(contact.id)}">
  ${avatarHtml(contact)}
  <div class="wv-info">
    <div class="wv-name"><b>${escapeHtml(displayName(contact))}</b><span class="wv-ts">${listStamp(last.ts)}</span></div>
    <div class="wv-preview"><span>${typing ? `<i>${tr('typing')}</i>` : escapeHtml(preview)}</span>${badge}</div>
  </div>
</div>`;
}

function renderList(data) {
    const list = el('chatList');
    const chats = (data?.chats ?? [])
        .filter(chat => chat.messages.length && (chat.groupId ? findGroup(data, chat.groupId) : findContact(data, chat.contactId)));
    // свежесозданные группы без сообщений тоже видны в списке
    for (const group of data?.groups ?? []) {
        if (!chats.some(chat => chat.groupId === group.id)) chats.push({ groupId: group.id, messages: [], unread: 0, createdAt: group.createdAt ?? 0 });
    }
    const stamp = (chat) => lastMessage(chat)?.ts ?? chat.createdAt ?? 0;
    chats.sort((a, b) => stamp(b) - stamp(a));

    const unread = chats.reduce((sum, chat) => sum + (chat.unread || 0), 0);
    el('unread').textContent = unread ? tr('unread', unread) : '';
    $q('[data-wv-dot="chats"]').classList.toggle('wv-show', unread > 0);

    list.innerHTML = chats.length
        ? chats.map(chat => chatRowHtml(data, chat)).join('')
        : `<div class="wv-empty">${data ? tr('noChats') : tr('noChat')}</div>`;
}

// ---------- экран чата ----------

function renderHeader(data) {
    if (open.type === 'group') {
        const group = findGroup(data, open.id);
        el('chatHeadAvatar').innerHTML = groupAvatarHtml('wv-sm');
        el('chatHeadName').textContent = group.name;
        el('chatHeadSub').textContent = isTyping(open) ? tr('typing') : tr('members', group.memberIds.length + 1);
        return group;
    }
    const contact = findContact(data, open.id);
    el('chatHeadAvatar').innerHTML = avatarHtml(contact, 'wv-sm');
    el('chatHeadName').textContent = displayName(contact);
    el('chatHeadSub').textContent = isTyping(open) ? tr('typing') : (contact.relation || contact.handle);
    return contact;
}

function emptyChatHtml(data, subject) {
    if (open.type === 'group') {
        return `<div class="wv-chat-empty">${groupAvatarHtml('wv-lg')}<b>${escapeHtml(subject.name)}</b><span>${tr('members', subject.memberIds.length + 1)}</span></div>`;
    }
    return `<div class="wv-chat-empty">${avatarHtml(subject, 'wv-lg')}<b>${escapeHtml(displayName(subject))}</b><span>${escapeHtml(subject.handle)}</span></div>`;
}

function renderChatScreen() {
    const data = getPhoneData();
    const subject = open && (open.type === 'group' ? findGroup(data, open.id) : findContact(data, open.id));
    if (!subject) return closeChat();

    renderHeader(data);
    const messages = currentChat(data)?.messages ?? [];
    const typing = isTyping(open) ? '<div class="wv-bubble-row wv-from-contact"><div class="wv-bubble wv-typing"><span></span><span></span><span></span></div></div>' : '';
    // «Доставлено» / «Прочитано» под последним сообщением юзера
    const receiptState = pacer.state(keyOf(open));
    const receipt = receiptState && lastMessage(currentChat(data))?.from === 'user' ? `<div class="wv-receipt">${tr(`receipt_${receiptState}`)}</div>` : '';
    const error = replyError(open);
    const errorRow = error ? `<div class="wv-chat-error" data-wv-action="chatRetry">${escapeHtml(tr('replyFailed'))} · <u>${tr('retry')}</u></div>` : '';
    if (!messages.length) {
        el('chatBody').innerHTML = emptyChatHtml(data, subject) + typing + errorRow;
        return;
    }

    const isGroup = open.type === 'group';
    let prevDay = null;
    el('chatBody').innerHTML = messages.map((message, i) => {
        const day = dayOf(message.ts);
        const divider = day !== prevDay ? `<div class="wv-chat-day">${escapeHtml(day)}</div>` : '';
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const newDay = day !== prevDay;
        prevDay = day;

        const incoming = isIncoming(message);
        const side = incoming ? 'contact' : 'user';
        // хвостик и время — у последнего пузыря в серии от одного автора
        const tail = !next || next.from !== message.from || dayOf(next.ts) !== day;
        // в группе над первым пузырём серии — имя отправителя
        const sender = isGroup && incoming && (newDay || !prev || prev.from !== message.from)
            ? `<div class="wv-bubble-sender">${escapeHtml(displayName(findContact(data, message.from)))}</div>`
            : '';

        const selected = selecting?.has(message.id) ? 'wv-selected' : '';
        return `${divider}<div class="wv-bubble-row wv-from-${side} ${selected}" data-wv-msg="${escapeHtml(message.id)}">
  <div class="wv-msg-check">${ICONS.check}</div>
  ${sender}<div class="wv-bubble ${tail ? 'wv-tail' : ''} ${message.tweet ? 'wv-bubble-shared' : ''} ${message.voice ? 'wv-bubble-voice' : ''}">${bubbleBody(message)}</div>
  ${tail ? `<div class="wv-bubble-time">${clockOf(message.ts)}</div>` : ''}
</div>`;
    }).join('') + receipt + typing + errorRow;

    const body = el('chatBody');
    // при выборе не прыгаем вниз — юзер отмечает сообщения где-то в середине
    if (!selecting) body.scrollTop = body.scrollHeight;
}

// ---------- ответ на конкретное сообщение ----------

/** id сообщения, на которое отвечаем; null — обычное сообщение */
let replyingTo = null;

function setReplyTo(messageId) {
    const data = getPhoneData();
    const message = currentChat(data)?.messages.find(m => m.id === messageId);
    if (!message) return;
    replyingTo = messageId;
    const author = message.from === 'user' ? tr('you') : displayName(findContact(data, message.from));
    el('chatReply').innerHTML = `<div class="wv-reply-bar">
  <div class="wv-quote"><b>${escapeHtml(tr('replyingTo', author))}</b><span>${escapeHtml(summaryOf(message) || '')}</span></div>
  <div class="wv-attach-remove" data-wv-action="chatReplyCancel">${ICONS.close}</div>
</div>`;
    el('chatInput').focus();
}

function clearReplyTo() {
    replyingTo = null;
    const box = el('chatReply');
    if (box) box.innerHTML = '';
}

/** Подсветить сообщение, к которому ведёт цитата */
function jumpTo(messageId) {
    const row = el('chatBody').querySelector(`[data-wv-msg="${CSS.escape(messageId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('wv-flash');
    setTimeout(() => row.classList.remove('wv-flash'), 900);
}

// ---------- выбор и удаление сообщений ----------

/** Выбранные id сообщений; null — обычный режим */
let selecting = null;
/** Долгое нажатие уже включило выбор — следующий click не должен снять отметку */
let suppressClick = false;
let pressTimer = null;

function renderSelectState() {
    el('chatScreen').classList.toggle('wv-selecting', Boolean(selecting));
    if (!selecting) return;
    el('selectTitle').textContent = selecting.size ? tr('selectedCount', selecting.size) : tr('selectMessages');
    el('selectDelete').classList.toggle('wv-disabled', !selecting.size);
}

function startSelect(messageId) {
    selecting = new Set(messageId ? [messageId] : []);
    renderSelectState();
    renderChatScreen();
}

function stopSelect() {
    if (!selecting) return;
    selecting = null;
    renderSelectState();
    if (open) renderChatScreen();
}

function toggleSelected(messageId) {
    if (selecting.has(messageId)) selecting.delete(messageId);
    else selecting.add(messageId);
    renderSelectState();
    renderChatScreen();
}

/** Удалить выбранные сообщения — и свои, и собеседника */
function deleteSelected() {
    const data = getPhoneData();
    const chat = data && open && currentChat(data);
    if (!chat || !selecting?.size) return;
    const removed = chat.messages.filter(m => selecting.has(m.id));
    chat.messages = chat.messages.filter(m => !selecting.has(m.id));
    for (const m of removed) {
        // реплики из истории ролевой — запоминаем, чтобы зеркало не вернуло их обратно
        if (m.src) (data.hiddenSrc ??= []).push(m.src);
        // файлы фото больше никому не нужны
        if (m.photo) deleteImage(m.photo);
        if (m.image?.path) deleteImage(m.image.path);
    }
    selecting = null;
    renderSelectState();
    notifyDataChanged();
}

/** Долгое нажатие на пузырь (телефон) или правый клик (компьютер) — режим выбора */
function bindSelect() {
    const body = el('chatBody');
    let swipe = null; // { row, x, y }
    const cancel = () => clearTimeout(pressTimer);
    const endSwipe = () => {
        if (!swipe) return;
        swipe.row.style.transform = '';
        swipe = null;
    };
    body.addEventListener('pointerdown', (e) => {
        const row = /** @type {HTMLElement} */ (e.target).closest('[data-wv-msg]');
        if (!row || selecting) return;
        swipe = { row, x: e.clientX, y: e.clientY };
        pressTimer = setTimeout(() => {
            suppressClick = true;
            endSwipe();
            startSelect(row.dataset.wvMsg);
        }, 450);
    });
    body.addEventListener('pointermove', (e) => {
        if (!swipe) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) cancel();
        if (Math.abs(dy) > 24) return endSwipe();
        if (dx > 0) swipe.row.style.transform = `translateX(${Math.min(dx, 60)}px)`;
        if (dx > 55) {
            const id = swipe.row.dataset.wvMsg;
            endSwipe();
            suppressClick = true;
            setReplyTo(id);
        }
    });
    body.addEventListener('pointerup', () => { cancel(); endSwipe(); });
    body.addEventListener('pointercancel', () => { cancel(); endSwipe(); });
    body.addEventListener('dblclick', (e) => {
        const row = /** @type {HTMLElement} */ (e.target).closest('[data-wv-msg]');
        if (!row || selecting) return;
        window.getSelection()?.removeAllRanges();
        setReplyTo(row.dataset.wvMsg);
    });
    body.addEventListener('contextmenu', (e) => {
        const row = /** @type {HTMLElement} */ (e.target).closest('[data-wv-msg]');
        if (!row) return;
        e.preventDefault();
        cancel();
        if (selecting) toggleSelected(row.dataset.wvMsg);
        else startSelect(row.dataset.wvMsg);
    });
}

/** Режим голосового: текст поля — это расшифровка, уходит голосовым */
let voiceMode = false;

function setVoiceMode(on) {
    voiceMode = on;
    el('chatComposer').classList.toggle('wv-voice-mode', on);
    /** @type {HTMLTextAreaElement} */ (el('chatInput')).placeholder = on ? tr('voicePh') : tr('messagePh');
    if (on) el('chatInput').focus();
}

function openScreen(target) {
    const data = getPhoneData();
    if (!data) return;
    open = target;
    setVoiceMode(false);

    const chat = currentChat(data);
    if (chat) {
        const ordered = orderMessages(chat.messages);
        const reordered = ordered.some((m, i) => m !== chat.messages[i]);
        if (reordered) chat.messages = ordered;
        if (chat.unread || reordered) {
            chat.unread = 0;
            notifyDataChanged();
        }
    }

    renderChatScreen();
    /** @type {HTMLTextAreaElement} */ (el('chatInput')).value = '';
    updateComposer();
    el('chatScreen').classList.add('wv-open');
}

/** Открыть переписку с контактом (из контактов или из списка чатов) */
export function openChat(contactId) {
    if (findContact(getPhoneData(), contactId)) openScreen({ type: 'contact', id: contactId });
}

// ---------- новый чат ----------

/** @type {Set<string>|null} выбранные контакты; null — экран закрыт */
let picking = null;

function renderNewChat() {
    const data = getPhoneData();
    const contacts = sortedContacts(data);
    el('newChatList').innerHTML = contacts.length
        ? contacts.map(contact => `
<div class="wv-ios-row wv-account-row" data-wv-pick="${escapeHtml(contact.id)}">
  ${avatarHtml(contact, 'wv-sm')}
  <div class="wv-account-info">
    <div class="wv-account-name">${escapeHtml(displayName(contact))}</div>
    <div class="wv-account-handle">${escapeHtml(contact.relation || contact.handle)}</div>
  </div>
  <div class="wv-check ${picking.has(contact.id) ? 'wv-on' : ''}">${ICONS.check}</div>
</div>`).join('')
        : `<div class="wv-empty">${tr('noContacts')}</div>`;

    // название — только для группы (двое и больше)
    el('newChatNameGroup').style.display = picking.size > 1 ? '' : 'none';
    el('newChatCreate').classList.toggle('wv-disabled', picking.size === 0);
    el('newChatCreate').textContent = picking.size > 1 ? tr('createGroup') : tr('openChat');
}

function openNewChat() {
    if (!getPhoneData()) return;
    picking = new Set();
    /** @type {HTMLInputElement} */ (el('newChatName')).value = '';
    renderNewChat();
    el('newChatScreen').classList.add('wv-open');
}

function closeNewChat() {
    picking = null;
    el('newChatScreen')?.classList.remove('wv-open');
}

function createChat() {
    const data = getPhoneData();
    if (!data || !picking?.size) return;
    const ids = [...picking];
    closeNewChat();

    if (ids.length === 1) return openChat(ids[0]);

    const typed = /** @type {HTMLInputElement} */ (el('newChatName')).value.trim();
    // без названия — как в iOS: имена участников через запятую
    const name = typed || ids.map(id => displayName(findContact(data, id))).join(', ');
    const group = makeGroup(name, ids);
    group.createdAt = getStoryNow().getTime();
    data.groups.push(group);
    notifyDataChanged();
    openGroupChat(group.id);
}

export function openGroupChat(groupId) {
    if (findGroup(getPhoneData(), groupId)) openScreen({ type: 'group', id: groupId });
}

function closeChat() {
    open = null;
    clearReplyTo();
    selecting = null;
    el('chatScreen')?.classList.remove('wv-selecting');
    clearPendingPhoto();
    closeGroupInfo();
    el('chatScreen')?.classList.remove('wv-open');
}

function updateComposer() {
    const input = /** @type {HTMLTextAreaElement} */ (el('chatInput'));
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    const hasText = input.value.trim().length > 0;
    el('chatSend').classList.toggle('wv-ready', hasText || Boolean(pendingPhoto));
    // юзер ещё пишет — собеседник ждёт
    if (open) pacer.typing(keyOf(open), hasText);
}

/** Пересланный твит — карточкой, комментарий под ней */
function sharedTweetHtml(tweet) {
    return `<div class="wv-shared" data-wv-open-tweet="${escapeHtml(tweet.id)}">
  <div class="wv-shared-head"><b>${escapeHtml(tweet.name)}</b><span>${escapeHtml(tweet.handle)}</span></div>
  <div class="wv-shared-text">${escapeHtml(tweet.text)}</div>
  ${tweet.image?.path ? `<img class="wv-shared-photo" src="${imageUrl(tweet.image.path)}" alt="" loading="lazy">` : tweet.image ? `<div class="wv-shared-photo-note">${ICONS.image}<span>${tr('sharedPhoto')}</span></div>` : ''}
</div>`;
}

/** Голосовое: ▶, волна, длительность, под ними — расшифровка */
function voiceHtml(message) {
    const seconds = voiceDuration(message.text);
    const bars = waveform(message.id).map(h => `<i style="height:${h}%"></i>`).join('');
    return `<div class="wv-voice" data-wv-voice="${escapeHtml(message.id)}" data-seconds="${seconds}">
  <div class="wv-voice-play">${ICONS.play}</div>
  <div class="wv-voice-wave">${bars}<div class="wv-voice-progress">${bars}</div></div>
  <div class="wv-voice-time">${formatDuration(seconds)}</div>
</div><div class="wv-voice-transcript">${escapeHtml(message.text)}</div>`;
}

/** «Воспроизведение» без звука: волна закрашивается за длительность записи */
function playVoice(voiceEl) {
    if (voiceEl.classList.contains('wv-playing')) {
        voiceEl.classList.remove('wv-playing');
        return;
    }
    const seconds = Number(voiceEl.dataset.seconds) || 3;
    voiceEl.style.setProperty('--wv-voice-duration', `${seconds}s`);
    voiceEl.classList.remove('wv-playing');
    void voiceEl.offsetWidth; // перезапуск анимации
    voiceEl.classList.add('wv-playing');
    clearTimeout(Number(voiceEl.dataset.timer));
    voiceEl.dataset.timer = String(setTimeout(() => voiceEl.classList.remove('wv-playing'), seconds * 1000));
}

/** Фото в пузыре: картинка (тап — на весь экран), подпись под ней */
function photoHtml(message) {
    const caption = message.text ? `<div class="wv-photo-caption">${escapeHtml(message.text)}</div>` : '';
    return `<img class="wv-bubble-img" src="${imageUrl(message.photo)}" data-wv-view="${escapeHtml(message.photo)}" alt="" loading="lazy">${caption}`;
}

/** Фото от персонажа: описание есть всегда, картинка — по нажатию или сразу (настройка) */
function sentImageHtml(message) {
    const image = message.image;
    const caption = message.text ? `<div class="wv-photo-caption">${escapeHtml(message.text)}</div>` : '';
    if (image.status === 'done' && image.path) {
        return `<div class="wv-bubble-photo-wrap"><img class="wv-bubble-img" src="${imageUrl(image.path)}" data-wv-view="${escapeHtml(image.path)}" alt="" loading="lazy">
  <div class="wv-photo-regen" data-wv-chat-photo="${escapeHtml(message.id)}" title="${tr('photoRegen')}">${ICONS.refresh}</div></div>${caption}`;
    }
    if (image.status === 'pending') return `<div class="wv-tweet-photo wv-bubble-photo wv-photo-pending"><span>${tr('photoLoading')}</span></div>${caption}`;
    const label = image.status === 'failed' ? tr('photoFailedRetry') : tr('photoTap');
    return `<div class="wv-tweet-photo wv-bubble-photo wv-photo-idle" data-wv-chat-photo="${escapeHtml(message.id)}">${ICONS.image}<span>${label}</span></div>${caption}`;
}

/** Цитата сообщения, на которое отвечают — над текстом пузыря */
function quoteHtml(message) {
    if (!message.replyTo) return '';
    const data = getPhoneData();
    const original = currentChat(data)?.messages.find(m => m.id === message.replyTo);
    if (!original) return `<div class="wv-quote"><span>${tr('quoteDeleted')}</span></div>`;
    const author = original.from === 'user' ? tr('you') : displayName(findContact(data, original.from));
    return `<div class="wv-quote" data-wv-jump="${escapeHtml(original.id)}"><b>${escapeHtml(author)}</b><span>${escapeHtml(summaryOf(original) || '')}</span></div>`;
}

function bubbleBody(message) {
    return quoteHtml(message) + bubbleContent(message);
}

function bubbleContent(message) {
    if (message.photo) return photoHtml(message);
    if (message.image) return sentImageHtml(message);
    if (message.voice) return voiceHtml(message);
    if (!message.tweet) return escapeHtml(message.text);
    return sharedTweetHtml(message.tweet) + (message.text ? `<div class="wv-shared-comment">${escapeHtml(message.text)}</div>` : '');
}

/**
 * Переслать твит в чат (из твиттера) и открыть переписку — дальше обычный ритм ответа.
 * @param {{ type: 'contact'|'group', id: string }} target
 * @param {{ id: string, name: string, handle: string, text: string }} tweet
 * @param {string} [comment]
 */
export function shareToChat(target, tweet, comment = '') {
    const data = getPhoneData();
    if (!data) return;
    const chat = target.type === 'group' ? getGroupChat(data, target.id, true) : getChat(data, target.id, true);
    chat.messages.push({ id: `msg_${Date.now()}`, from: 'user', text: String(comment).trim(), tweet, ts: nextTs(chat, getStoryNow().getTime()) });
    notifyDataChanged();
    openScreen(target);
    pacer.sent(keyOf(target));
}

// ---------- фото из галереи ----------

/** Выбранное, но ещё не отправленное фото: { blob, format, preview } */
let pendingPhoto = null;
let sending = false;

function clearPendingPhoto() {
    if (pendingPhoto?.preview) URL.revokeObjectURL(pendingPhoto.preview);
    pendingPhoto = null;
    renderAttach();
}

function renderAttach(error = '') {
    const box = el('chatAttach');
    if (!box) return;
    if (error) {
        box.innerHTML = `<div class="wv-attach-error">${escapeHtml(error)}</div>`;
        return;
    }
    box.innerHTML = pendingPhoto
        ? `<div class="wv-attach-thumb"><img src="${pendingPhoto.preview}" alt=""><div class="wv-attach-remove" data-wv-action="chatAttachRemove">${ICONS.close}</div></div>`
        : '';
}

async function attachPhoto() {
    // выбор файла открываем прямо из нажатия — иначе мобильные браузеры его заблокируют
    const file = await pickImageFile();
    if (!file) return;
    try {
        const prepared = await preparePhoto(file);
        clearPendingPhoto();
        pendingPhoto = { ...prepared, preview: URL.createObjectURL(prepared.blob) };
        renderAttach();
        updateComposer();
        el('chatInput').focus();
    } catch {
        renderAttach(tr('photoUnsupported'));
    }
}

async function sendMessage() {
    const input = /** @type {HTMLTextAreaElement} */ (el('chatInput'));
    const text = input.value.trim();
    const data = getPhoneData();
    if ((!text && !pendingPhoto) || !data || !open || sending) return;

    // фото — сначала файлом в папку wavey, в сообщении только путь
    let photo = null;
    if (pendingPhoto) {
        sending = true;
        el('chatSend').classList.add('wv-busy');
        try {
            photo = await uploadImage(pendingPhoto.blob, 'photo', pendingPhoto.format);
        } catch {
            renderAttach(tr('photoFailed'));
            return;
        } finally {
            sending = false;
            el('chatSend').classList.remove('wv-busy');
        }
        clearPendingPhoto();
    }

    const chat = currentChat(data, true);
    chat.messages.push({
        id: `msg_${Date.now()}`, from: 'user', text,
        ...(photo ? { photo } : {}),
        ...(voiceMode && !photo ? { voice: true } : {}),
        ...(replyingTo ? { replyTo: replyingTo } : {}),
        ts: nextTs(chat, getStoryNow().getTime()),
    });
    clearReplyTo();
    // после отправки голосового поле возвращается к обычному тексту
    setVoiceMode(false);

    input.value = '';
    updateComposer();
    clearReplyError(open);
    notifyDataChanged();
    pacer.sent(keyOf(open));
    renderChatScreen();
}

const isOpenNow = (target) => Boolean(open && open.type === target.type && open.id === target.id);

// ---------- просмотр фото на весь экран ----------

function openViewer(path) {
    el('viewer').querySelector('img').src = imageUrl(path);
    el('viewer').classList.add('wv-open');
}

function closeViewer() {
    el('viewer')?.classList.remove('wv-open');
}

/** Открыт ли сейчас этот чат на экране (для непрочитанных и уведомлений) */
export const isChatOpen = isOpenNow;

const keyOf = (target) => `${target.type}:${target.id}`;
const targetOf = (key) => {
    const [type, ...rest] = key.split(':');
    return { type: /** @type {'contact'|'group'} */ (type), id: rest.join(':') };
};

const pacer = new ReplyPacer({
    onState: (key) => { if (open && keyOf(open) === key) renderChatScreen(); },
    onFire: (key) => requestReply(targetOf(key), isOpenNow),
});

// ---------- экран «О группе» ----------

function renderGroupInfo() {
    const data = getPhoneData();
    const group = findGroup(data, groupInfoId);
    if (!group) return closeGroupInfo();

    const members = group.memberIds.map(id => findContact(data, id)).filter(Boolean);
    el('groupMembers').innerHTML = members.map(contact => `
<div class="wv-ios-row wv-account-row wv-ios-link" data-wv-member="${escapeHtml(contact.id)}">
  ${avatarHtml(contact, 'wv-sm')}
  <div class="wv-account-info">
    <div class="wv-account-name">${escapeHtml(displayName(contact))}</div>
    <div class="wv-account-handle">${escapeHtml(contact.relation || contact.handle)}</div>
  </div>
  <div class="wv-ios-chevron">${ICONS.chevronRight}</div>
</div>`).join('');
}

function openGroupInfo() {
    const group = findGroup(getPhoneData(), open?.id);
    if (!group) return;
    groupInfoId = group.id;
    /** @type {HTMLInputElement} */ (el('groupName')).value = group.name;
    el('groupMembersTitle').textContent = tr('members', group.memberIds.length + 1);
    renderGroupInfo();
    el('groupInfo').classList.add('wv-open');
}

function closeGroupInfo() {
    groupInfoId = null;
    el('groupInfo')?.classList.remove('wv-open');
}

function saveGroupInfo() {
    const data = getPhoneData();
    const group = findGroup(data, groupInfoId);
    const name = /** @type {HTMLInputElement} */ (el('groupName')).value.trim();
    if (group && name) {
        group.name = name;
        notifyDataChanged();
    }
    closeGroupInfo();
}

// ---------- приложение ----------

/** @type {import('../types.js').PhoneApp} */
export const messagesApp = {
    id: 'chats',
    icon: ICONS.chat,
    title: () => tr('chats'),
    hasDot: true,

    html: () => `
<div class="wv-list-header">
  <div>${tr('chats')} <span data-wv="unread"></span></div>
  <div class="wv-header-tools">
    <div class="wv-icon-btn" data-wv-action="newChat" title="${tr('newChat')}">${ICONS.compose}</div>
  </div>
</div>
<div class="wv-scroll wv-list" data-wv="chatList"></div>`,

    overlayHtml: () => `
<div class="wv-screen-page wv-push" data-wv="chatScreen">
  <div class="wv-chat-header">
    <div class="wv-icon-btn" data-wv-action="chatBack">${ICONS.back}</div>
    <div class="wv-chat-head" data-wv-action="chatInfo">
      <div data-wv="chatHeadAvatar"></div>
      <div class="wv-chat-head-text">
        <div class="wv-chat-head-name" data-wv="chatHeadName"></div>
        <div class="wv-chat-head-sub" data-wv="chatHeadSub"></div>
      </div>
    </div>
    <div class="wv-icon-btn" data-wv-action="chatInfo">${ICONS.info}</div>
    <div class="wv-nav-btn wv-select-only" data-wv-action="selectCancel">${tr('cancel')}</div>
    <div class="wv-select-title wv-select-only" data-wv="selectTitle"></div>
    <div class="wv-nav-btn wv-select-only wv-select-spacer"></div>
  </div>
  <div class="wv-scroll wv-chat-body" data-wv="chatBody"></div>
  <div class="wv-attach" data-wv="chatAttach"></div>
  <div class="wv-attach" data-wv="chatReply"></div>
  <div class="wv-chat-composer" data-wv="chatComposer">
    <div class="wv-mic" data-wv-action="chatPhoto" title="${tr('photoMsg')}">${ICONS.image}</div>
    <div class="wv-mic" data-wv-action="chatVoiceMode" title="${tr('voiceMode')}">${ICONS.mic}</div>
    <textarea class="wv-chat-input" data-wv="chatInput" rows="1" placeholder="${tr('messagePh')}"></textarea>
    <div class="wv-send" data-wv="chatSend" data-wv-action="chatSend">${ICONS.arrowUp}</div>
  </div>
  <div class="wv-select-bar">
    <div class="wv-select-delete" data-wv="selectDelete" data-wv-action="selectDelete">${ICONS.trash}<span>${tr('deleteMessages')}</span></div>
  </div>
</div>

<div class="wv-viewer" data-wv="viewer"><img alt=""></div>

<div class="wv-screen-page" data-wv="newChatScreen">
  <div class="wv-navbar">
    <div class="wv-nav-btn" data-wv-action="newChatCancel">${tr('cancel')}</div>
    <div class="wv-navbar-title">${tr('newChat')}</div>
    <div class="wv-nav-btn wv-nav-strong" data-wv="newChatCreate" data-wv-action="newChatCreate"></div>
  </div>
  <div class="wv-scroll wv-ios-scroll">
    <div data-wv="newChatNameGroup">
      <div class="wv-ios-section-title">${tr('groupName')}</div>
      <div class="wv-ios-group">
        <label class="wv-ios-field">
          <input class="wv-field" type="text" data-wv="newChatName" placeholder="${tr('groupNamePh')}" autocomplete="off" spellcheck="false">
        </label>
      </div>
    </div>
    <div class="wv-ios-section-title">${tr('chatWith')}</div>
    <div class="wv-ios-group" data-wv="newChatList"></div>
    <div class="wv-ios-footer">${tr('newChatHint')}</div>
  </div>
</div>

<div class="wv-screen-page" data-wv="groupInfo">
  <div class="wv-navbar">
    <div class="wv-nav-btn" data-wv-action="groupCancel">${tr('cancel')}</div>
    <div class="wv-navbar-title">${tr('group')}</div>
    <div class="wv-nav-btn wv-nav-strong" data-wv-action="groupDone">${tr('done')}</div>
  </div>
  <div class="wv-scroll wv-ios-scroll">
    <div class="wv-editor-avatar">${groupAvatarHtml('wv-lg')}</div>
    <div class="wv-ios-group">
      <label class="wv-ios-field">
        <span class="wv-ios-field-label">${tr('groupName')}</span>
        <input class="wv-field" type="text" data-wv="groupName" autocomplete="off" spellcheck="false">
      </label>
    </div>
    <div class="wv-ios-section-title" data-wv="groupMembersTitle"></div>
    <div class="wv-ios-group" data-wv="groupMembers"></div>
  </div>
</div>`,

    bind() {
        const input = el('chatInput');
        input.addEventListener('input', updateComposer);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        bindSelect();
        el('groupName').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveGroupInfo();
        });
        document.addEventListener('wavey:contact-removed', (e) => {
            if (open?.type === 'contact' && /** @type {CustomEvent} */ (e).detail?.id === open.id) closeChat();
        });
    },

    render(data) {
        renderList(data);
        if (open) renderChatScreen();
        if (groupInfoId) renderGroupInfo();
    },

    onClick(target) {
        if (suppressClick) {
            suppressClick = false;
            if (target.closest('[data-wv-msg]')) return true;
        }
        if (selecting) {
            const row = target.closest('[data-wv-msg]');
            if (row) return toggleSelected(row.dataset.wvMsg), true;
            const action = target.closest('[data-wv-action]')?.dataset.wvAction;
            if (action === 'selectCancel') return stopSelect(), true;
            if (action === 'selectDelete') return deleteSelected(), true;
            if (target.closest('[data-wv="chatScreen"]')) return true;
        }

        const jump = target.closest('[data-wv-jump]');
        if (jump) return jumpTo(jump.dataset.wvJump), true;

        const sentPhoto = target.closest('[data-wv-chat-photo]');
        if (sentPhoto) return requestChatImage(sentPhoto.dataset.wvChatPhoto), true;

        const view = target.closest('[data-wv-view]');
        if (view) return openViewer(view.dataset.wvView), true;
        if (target.closest('[data-wv="viewer"]')) return closeViewer(), true;

        const voice = target.closest('[data-wv-voice]');
        if (voice) return playVoice(/** @type {HTMLElement} */ (voice)), true;

        // тап по пересланному твиту — открыть его ветку в твиттере
        const shared = target.closest('[data-wv-open-tweet]');
        if (shared) {
            closeChat();
            document.dispatchEvent(new CustomEvent('wavey:open-tweet', { detail: { id: shared.dataset.wvOpenTweet } }));
            return true;
        }

        const row = target.closest('[data-open-chat]');
        if (row) return openChat(row.dataset.openChat), true;
        const groupRow = target.closest('[data-open-group]');
        if (groupRow) return openGroupChat(groupRow.dataset.openGroup), true;
        const pick = target.closest('[data-wv-pick]');
        if (pick && picking) {
            const id = pick.dataset.wvPick;
            if (picking.has(id)) picking.delete(id);
            else picking.add(id);
            renderNewChat();
            return true;
        }
        const member = target.closest('[data-wv-member]');
        if (member) return openContactCard(member.dataset.wvMember), true;

        switch (target.closest('[data-wv-action]')?.dataset.wvAction) {
            case 'chatBack': return closeChat(), true;
            case 'chatInfo':
                if (open?.type === 'group') openGroupInfo();
                else if (open) openContactCard(open.id);
                return true;
            case 'chatSend': return sendMessage(), true;
            case 'chatVoiceMode': return setVoiceMode(!voiceMode), true;
            case 'chatPhoto': return attachPhoto(), true;
            case 'chatAttachRemove': return clearPendingPhoto(), updateComposer(), true;
            case 'chatReplyCancel': return clearReplyTo(), true;
            case 'chatRetry':
                if (open) { clearReplyError(open); pacer.reset(keyOf(open)); requestReply({ ...open }, isOpenNow); }
                return true;
            case 'groupCancel': return closeGroupInfo(), true;
            case 'groupDone': return saveGroupInfo(), true;
            case 'newChat': return openNewChat(), true;
            case 'newChatCancel': return closeNewChat(), true;
            case 'newChatCreate': return createChat(), true;
        }
        return false;
    },

    onEscape() {
        // карточка контакта лежит поверх всего — её закрывает приложение контактов
        if (el('viewer').classList.contains('wv-open')) return closeViewer(), true;
        if (selecting) return stopSelect(), true;
        if (isContactCardOpen()) return false;
        if (groupInfoId) return closeGroupInfo(), true;
        if (picking) return closeNewChat(), true;
        if (!open) return false;
        closeChat();
        return true;
    },

    onChatChanged() {
        closeChat();
    },
};
