// Переписки прямо в сообщениях ролевой: строки (in)/(out) рисуются окошком мессенджера,
// а в переписке с юзером в последнем сообщении можно ответить. Ответы юзера и персонажа
// дописываются отдельным приложением в конце сообщения («[Text chat that followed…]»),
// а не внутрь блока модели — чтобы она не приняла переписку за свой текст.
// В окошке всё показывается вместе.

import { tr } from '../i18n.js';
import { ctx, LOG, MODULE } from '../core/context.js';
import { escapeHtml } from '../core/format.js';
import { generate } from '../core/api.js';
import { getApi, getSettings, SETTINGS_EVENT } from '../core/settings.js';
import { displayName } from '../core/contacts.js';
import { formatStory, storyWindow } from '../core/presence.js';
import { chatLanguage, momentLine, personBlock, userBlock } from '../apps/messages/reply.js';
import { appendToAppendix, isUserBlock, isUserName, parseAppendix, parseBlocks, removeFromAppendix, stripAppendix } from './blocks.js';
import { scheduleStorySync } from './sync.js';
import { ReplyPacer } from '../ui/pacer.js';

const PROMPT_KEY = `${MODULE}_inchat`;
const TOKEN = 'WVPHONEBLOCK';

/** токен → готовый HTML блока (между стадиями форматирования) */
const rendered = new Map();
let tokenSeq = 0;

/** `${messageId}:${blockIndex}` — персонаж печатает ответ */
const pending = new Set();
/** key → тексты юзера, которые ещё ждут ответа (при неудаче их забираем обратно) */
const unanswered = new Map();
/** key → текст, вернувшийся в поле ввода после неудачи */
const failed = new Map();

const pacer = new ReplyPacer({
    onState: (key) => updateReceipt(key),
    onFire: (key) => {
        const [messageId, blockIndex] = key.split(':').map(Number);
        requestCharacterReply(messageId, blockIndex);
    },
});

/** «Доставлено» / «Прочитано» над полем ответа; DOM трогаем только при смене текста */
function updateReceipt(key) {
    const box = document.querySelector(`.wavey-inchat-composer[data-key="${key}"] .wavey-inchat-receipt`);
    if (!box) return;
    const state = pacer.state(key);
    const text = state ? tr(`receipt_${state}`) : '';
    if (box.textContent !== text) box.textContent = text;
}

const enabled = () => getSettings().inChatPhone !== false;

// ---------- инструкция основной модели ----------

function promptText() {
    const user = ctx().name1 || 'User';
    return `If any character sends or reads a text message on a phone, writing it with this template is mandatory, one message per line:
(in) Sender name | message
(out) Receiver name | message
"in" is a message the phone owner received, "out" is one they sent. The phone owner is the character whose phone it is in the scene.
Texts between a character and ${user} always use ${user}'s exact name: "(out) ${user} | ..." when the character texts ${user}, "(in) ${user} | ..." for ${user}'s texts. Never write ${user}'s texts unless ${user} already wrote them. For anyone else, use their name.
Example:
(out) Martin | Where are you?
(out) Martin | I'm already here
(in) Kate | Great, see you soon!
A list under "[Text chat that followed between A and B:]" at the end of a message is a real text conversation those characters had after that scene — written by them, not by you. Take it into account and continue the story from there; never rewrite or repeat it.`;
}

export function refreshPrompt() {
    const { setExtensionPrompt } = ctx();
    // 0 — IN_PROMPT: рядом с системными инструкциями, постоянно
    setExtensionPrompt(PROMPT_KEY, enabled() ? promptText() : '', 0, 0);
}

// ---------- отрисовка ----------

/** Как подписан владелец телефона: подпись контакта в Wavey, если есть, иначе имя */
function ownerLabel(ownerName) {
    const contacts = ctx().chatMetadata?.[MODULE]?.contacts ?? [];
    const contact = contacts.find(c => c.name?.toLowerCase() === String(ownerName).toLowerCase());
    return contact ? displayName(contact) : ownerName;
}

function letterOf(name) {
    return escapeHtml(([...String(name).trim()][0] ?? '?').toUpperCase());
}

function bubble(side, text, sender = '') {
    const label = sender ? `<div class="wvc-sender">${escapeHtml(sender)}</div>` : '';
    return `<div class="wvc-row wvc-${side}">${label}<div class="wvc-bubble">${escapeHtml(text)}</div></div>`;
}

/**
 * @param {import('./blocks.js').AppendixEntry[]} [followUp] реплики из приложения в конце сообщения
 */
function blockHtml(block, blockIndex, messageId, ownerName, ownerIsUser = false, followUp = []) {
    const userName = ctx().name1;
    // в сообщении юзера телефон — его собственный: это всегда «наша» переписка
    const withUser = !ownerIsUser && (isUserBlock(block, userName) || followUp.length > 0);

    let title;
    let rows;
    if (withUser) {
        // глазами юзера: персонаж слева, юзер справа
        title = ownerLabel(ownerName);
        rows = block.lines.map(line => {
            // (out) Юзер — персонаж пишет юзеру, (in) Юзер — юзер пишет персонажу
            if (isUserName(line.name, userName)) return bubble(line.dir === 'out' ? 'left' : 'right', line.text);
            // кто-то третий в той же переписке — слева, с подписью
            return bubble('left', line.text, line.name);
        });
        // продолжение из приложения: юзер справа, персонаж слева
        rows.push(...followUp.map(entry => bubble(entry.from === 'user' ? 'right' : 'left', entry.text)));
    } else {
        // чужая переписка глазами владельца телефона
        const others = [...new Set(block.lines.map(l => l.name))];
        title = ownerIsUser ? others.map(ownerLabel).join(', ') : `${ownerName} · ${others.join(', ')}`;
        const multi = others.length > 1;
        rows = block.lines.map(line => line.dir === 'out'
            ? bubble('right', line.text)
            : bubble('left', line.text, multi ? line.name : ''));
    }

    const sub = withUser ? tr('inchatWithYou') : ownerIsUser ? tr('inchatYourPhone') : tr('inchatTheirPhone', ownerName);
    return `<div class="wvc-window" data-wvc-mes="${messageId}" data-wvc-block="${blockIndex}" data-wvc-user="${withUser ? 1 : 0}">
<div class="wvc-head"><div class="wvc-ava">${letterOf(title)}</div><div class="wvc-title"><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span></div></div>
<div class="wvc-body">${rows.join('')}</div>
</div>`;
}

/** Стадия до Markdown: блоки строк меняем на токены, HTML откладываем */
function beforeMarkdown(text, info) {
    if (!enabled() || info.isReasoning || info.isSystem) return text;
    if (!/\(\s*(?:in|out)\s*\)/i.test(text) && !text.includes('[Text chat that followed')) return text;

    const userName = ctx().name1;
    const ownerName = ctx().chat?.[info.messageId]?.name || info.characterName || '';
    // приложение с продолжением в тексте не показываем — его реплики уходят в окошко
    const { text: body, entries } = info.isUser ? { text, entries: [] } : stripAppendix(text, userName);

    const blocks = parseBlocks(body);
    const rows = body.split('\n');
    // продолжение принадлежит последней переписке с юзером
    let target = -1;
    blocks.forEach((block, b) => { if (!info.isUser && isUserBlock(block, userName)) target = b; });

    if (entries.length && target < 0) {
        // блок модели пропал (правка) — показываем продолжение отдельным окошком
        const token = `${TOKEN}${++tokenSeq}X`;
        rendered.set(token, blockHtml({ start: 0, end: 0, lines: [] }, blocks.length, info.messageId, ownerName, false, entries));
        rows.push('', token, '');
    }

    for (let b = blocks.length - 1; b >= 0; b--) {
        const token = `${TOKEN}${++tokenSeq}X`;
        const followUp = b === target ? entries : [];
        rendered.set(token, blockHtml(blocks[b], b, info.messageId, ownerName, Boolean(info.isUser), followUp));
        rows.splice(blocks[b].start, blocks[b].end - blocks[b].start + 1, '', token, '');
    }
    return rows.join('\n');
}

/** Стадия после Markdown: токены (обычно в своём <p>) → окошки */
function afterMarkdown(html) {
    if (!html.includes(TOKEN)) return html;
    return html.replace(new RegExp(`(?:<p>\\s*)?(${TOKEN}\\d+X)(?:\\s*</p>)?`, 'g'), (_, token) => {
        const block = rendered.get(token) ?? '';
        rendered.delete(token);
        return block;
    });
}

// ---------- ответ прямо из чата ----------

function lastMessageId() {
    return (ctx().chat?.length ?? 0) - 1;
}

function writeMessage(messageId, text) {
    const { chat, updateMessageBlock, saveChat } = ctx();
    const message = chat[messageId];
    if (!message) return;
    message.mes = text;
    // текст свайпа — тоже, иначе при перелистывании вернётся старый
    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = text;
    updateMessageBlock(messageId, message);
    saveChat();
    attachComposers();
    scheduleStorySync();
}

function ownerContact(ownerName) {
    const { characters, chatMetadata } = ctx();
    const contacts = chatMetadata?.[MODULE]?.contacts ?? [];
    const contact = contacts.find(c => c.name?.toLowerCase() === String(ownerName).toLowerCase());
    if (contact) return contact;
    const char = characters.find(c => c.name === ownerName);
    return { name: ownerName, handle: '', main: Boolean(char), charAvatar: char?.avatar ?? null };
}

async function requestCharacterReply(messageId, blockIndex) {
    const key = `${messageId}:${blockIndex}`;
    const { chat, name1 } = ctx();
    const message = chat[messageId];
    // блок модели мог пропасть после правки — тогда переписка целиком в приложении
    const block = parseBlocks(message?.mes)[blockIndex] ?? { lines: [] };
    if (!message || pending.has(key)) return;

    const owner = ownerContact(message.name);
    const followUp = parseAppendix(message.mes, name1)?.entries ?? [];
    const conversation = [
        ...block.lines.map(line => `${isUserName(line.name, name1) && line.dir === 'in' ? name1 : owner.name}: ${line.text}`),
        ...followUp.map(entry => `${entry.from === 'user' ? name1 : owner.name}: ${entry.text}`),
    ].join('\n');
    const window = storyWindow();

    const system = `You are ${owner.name}, texting ${name1} (USER) on the phone in the middle of an ongoing roleplay scene.
Stay fully in character. Text exactly like this person would: tone, length, punctuation, emoji, slang. Never narrate, never use asterisks — only the texts.
Reply with ONLY JSON: {"messages": ["text", ...]} — 1 to 3 separate texts. Write them in ${chatLanguage(block.lines.map(l => ({ text: l.text })))}.`;
    const sections = [
        `YOU:\n${personBlock(owner)}`,
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        window.length ? `STORY SO FAR (you are in this scene):\n${formatStory(window)}` : '',
        `THIS TEXT CONVERSATION:\n${conversation}`,
    ].filter(Boolean);

    pending.add(key);
    attachComposers();
    try {
        const raw = await generate(getApi(), [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }]);
        const texts = parseTexts(raw);
        const current = ctx().chat[messageId];
        if (!texts.length) throw new Error('empty-reply');
        if (current) {
            unanswered.delete(key);
            writeMessage(messageId, appendToAppendix(current.mes, current.name, name1, texts.map(t => ({ from: 'owner', text: t }))));
        }
    } catch (error) {
        console.warn(LOG, 'inchat reply', error);
        retractUnanswered(messageId, blockIndex);
    } finally {
        pending.delete(key);
        attachComposers();
    }
}

/**
 * Ответа нет — как в мессенджере при плохой связи: неотвеченные сообщения юзера
 * убираем из текста и возвращаем в поле ввода, чтобы отправить заново.
 */
function retractUnanswered(messageId, blockIndex) {
    const key = `${messageId}:${blockIndex}`;
    const texts = unanswered.get(key) ?? [];
    unanswered.delete(key);
    const message = ctx().chat[messageId];
    if (!texts.length || !message) return;

    failed.set(key, texts.join('\n'));
    writeMessage(messageId, removeFromAppendix(message.mes, ctx().name1, texts));
}

function parseTexts(raw) {
    const text = String(raw ?? '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(parsed.messages)) return parsed.messages.map(t => String(t ?? '').trim()).filter(Boolean);
        } catch { /* ниже — как простой текст */ }
    }
    return text ? [text.replace(/^["']|["']$/g, '')] : [];
}

function sendFromChat(messageId, blockIndex, input) {
    const message = ctx().chat[messageId];
    // каждая строка поля — отдельное сообщение (так же возвращаются недоставленные)
    const texts = input.value.split('\n').map(t => t.trim()).filter(Boolean);
    if (!texts.length || !message) return;
    input.value = '';

    const key = `${messageId}:${blockIndex}`;
    failed.delete(key);
    unanswered.set(key, [...(unanswered.get(key) ?? []), ...texts]);
    writeMessage(messageId, appendToAppendix(message.mes, message.name, ctx().name1, texts.map(t => ({ from: 'user', text: t }))));

    // персонаж ждёт, пока юзер допишет серию: «доставлено» → «прочитано» → печатает
    pacer.sent(key);
    // фокус на новое поле после перерисовки
    setTimeout(() => document.querySelector(`.wavey-inchat-composer[data-key="${key}"] textarea`)?.focus(), 50);
}

function composerEl(messageId, blockIndex) {
    const key = `${messageId}:${blockIndex}`;
    const wrap = document.createElement('div');
    wrap.className = 'wavey-inchat-composer';
    wrap.dataset.key = key;
    const restored = failed.get(key) ?? '';
    wrap.innerHTML = `
<div class="wavey-inchat-failed">${restored ? escapeHtml(tr('inchatFailed')) : ''}</div>
<div class="wavey-inchat-receipt">${pacer.state(key) ? escapeHtml(tr(`receipt_${pacer.state(key)}`)) : ''}</div>
<div class="wavey-inchat-typing">${pending.has(key) ? '<span></span><span></span><span></span>' : ''}</div>
<div class="wavey-inchat-row">
  <textarea rows="1" placeholder="${escapeHtml(tr('inchatReplyPh'))}"></textarea>
  <div class="wavey-inchat-send" title="${escapeHtml(tr('inchatSend'))}"><svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></div>
</div>`;

    const input = /** @type {HTMLTextAreaElement} */ (wrap.querySelector('textarea'));
    const send = wrap.querySelector('.wavey-inchat-send');
    const update = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        const hasText = input.value.trim().length > 0;
        send.classList.toggle('wavey-ready', hasText);
        pacer.typing(key, hasText);
    };
    input.addEventListener('input', update);
    if (restored) {
        input.value = restored;
        // после перерисовки — сразу в поле, чтобы можно было нажать Enter ещё раз
        setTimeout(() => { update(); input.focus(); }, 0);
    }
    input.addEventListener('keydown', (e) => {
        // клавиши поля не должны трогать хоткеи таверны (свайпы стрелками и т.п.)
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendFromChat(messageId, blockIndex, input);
        }
    });
    send.addEventListener('click', () => sendFromChat(messageId, blockIndex, input));
    return wrap;
}

/** Окошки с длинной перепиской открываются на последних сообщениях, как в мессенджере */
function scrollWindowsToEnd() {
    document.querySelectorAll('#chat .mes_text .custom-wvc-body').forEach(body => {
        const el = /** @type {HTMLElement} */ (body);
        // каждый перерисованный блок — новый элемент, так что метка ставится один раз на отрисовку
        if (el.dataset.wvScrolled) return;
        el.dataset.wvScrolled = '1';
        el.scrollTop = el.scrollHeight;
    });
}

/** Поле ответа — только у переписок с юзером в последнем сообщении (там «живая» сцена) */
export function attachComposers() {
    scrollWindowsToEnd();
    document.querySelectorAll('.wavey-inchat-composer').forEach(el => {
        const [mes] = String(/** @type {HTMLElement} */ (el).dataset.key).split(':');
        if (Number(mes) !== lastMessageId() || !enabled()) el.remove();
    });
    if (!enabled()) return;

    const id = lastMessageId();
    const message = ctx().chat?.[id];
    if (!message || message.is_user) return;

    // отвечать можно только в последней переписке с юзером — к ней пишется продолжение
    const all = [...document.querySelectorAll(`#chat .mes[mesid="${id}"] .mes_text .custom-wvc-window[data-wvc-user="1"]`)];
    all.slice(0, -1).forEach(win => win.querySelector('.wavey-inchat-composer')?.remove());
    all.slice(-1).forEach(win => {
        const blockIndex = Number(/** @type {HTMLElement} */ (win).dataset.wvcBlock);
        const key = `${id}:${blockIndex}`;
        const existing = win.querySelector('.wavey-inchat-composer');
        if (existing) {
            // трогаем DOM только при смене состояния — иначе наблюдатель за чатом зациклится
            const typing = existing.querySelector('.wavey-inchat-typing');
            const want = pending.has(key);
            if (typing.childElementCount > 0 !== want) typing.innerHTML = want ? '<span></span><span></span><span></span>' : '';
            return;
        }
        win.appendChild(composerEl(id, blockIndex));
    });
}

/** Перерисовать сообщения с переписками (после переключения настройки) */
function rerenderPhoneMessages() {
    const { chat, updateMessageBlock } = ctx();
    (chat ?? []).forEach((message, id) => {
        if (/\(\s*(?:in|out)\s*\)/i.test(message?.mes ?? '')) updateMessageBlock(id, message);
    });
    attachComposers();
}

// ---------- запуск ----------

export function initInChat() {
    const { messageFormatter, eventSource, eventTypes } = ctx();
    // в контексте лежит уже готовый экземпляр; .instance — на случай, если отдадут класс
    const formatter = messageFormatter?.addHook ? messageFormatter : messageFormatter?.instance;
    if (!formatter) {
        console.warn(LOG, 'MessageFormatter is not available — in-chat phone windows are disabled');
        return;
    }

    formatter.addHook(beforeMarkdown, { stage: formatter.stage.AFTER_REGEX });
    formatter.addHook(afterMarkdown, { stage: formatter.stage.AFTER_MARKDOWN });

    refreshPrompt();
    eventSource.on(eventTypes.CHAT_CHANGED, refreshPrompt);
    eventSource.on(eventTypes.GENERATION_STARTED, refreshPrompt);

    // переписки с юзером из истории зеркалятся в мессенджер телефона
    for (const type of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
        if (eventTypes[type]) eventSource.on(eventTypes[type], scheduleStorySync);
    }
    scheduleStorySync();

    // сообщения перерисовываются по многим причинам — проще следить за DOM чата
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        // setTimeout, а не requestAnimationFrame: rAF стоит на паузе в фоновой вкладке
        setTimeout(() => {
            scheduled = false;
            attachComposers();
        }, 30);
    });
    const chatEl = document.getElementById('chat');
    if (chatEl) observer.observe(chatEl, { childList: true, subtree: true });

    document.addEventListener(SETTINGS_EVENT, (e) => {
        if (/** @type {CustomEvent} */ (e).detail?.key !== 'inChatPhone') return;
        refreshPrompt();
        rerenderPhoneMessages();
        scheduleStorySync();
    });
}
