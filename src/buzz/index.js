// Слухи из истории. Основная модель оставляет скрытый тег <!-- buzz: что могла узнать публика -->,
// когда в сцене случилось что-то реально публичное. Спустя N сообщений истории тема «всплывает»:
// модель честно решает охват (чаще всего мелочь), пишет главный твит и обсуждение,
// под сообщением появляется карточка «горячая новость», а основная модель получает фоновую заметку.

import { tr } from '../i18n.js';
import { ctx, LOG, MODULE } from '../core/context.js';
import { escapeHtml, formatCount } from '../core/format.js';
import { generate } from '../core/api.js';
import { getApi, getSettings, SETTINGS_EVENT } from '../core/settings.js';
import { getPhoneData, notifyDataChanged } from '../core/store.js';
import { momentLine, userBlock } from '../apps/messages/reply.js';
import { addTweets, isUserAccountPost, makeTweet, parseJson, settingBlock, startImages, storyLanguage, twitterContactsBlock } from '../apps/twitter/feed.js';
import { imagePromptRule } from '../apps/twitter/images.js';

const RULE_KEY = `${MODULE}_buzz_rule`;
const BACKGROUND_KEY = `${MODULE}_buzz_bg`;
const TAG_RE = /<!--\s*buzz\s*:\s*([\s\S]*?)-->/gi;
/** Сколько сообщений истории обсуждение остаётся «фоном» для основной модели */
const BACKGROUND_LIFETIME = 15;

const enabled = () => getSettings().buzzEnabled !== false;
const storyLength = () => ctx().chat?.length ?? 0;

let busy = false;

// ---------- правило для основной модели ----------

const RULE = `If something happens in the scene that outsiders could realistically find out about and talk about online — it happened in public, was seen or filmed, involves a public figure, or is newsworthy — add at the very end of your reply a hidden note:
<!-- buzz: one sentence of what the public could actually know, no private details -->
Use it rarely, only for genuinely public moments. Never mention the note in the story.`;

function refreshRule() {
    ctx().setExtensionPrompt(RULE_KEY, enabled() ? RULE : '', 0, 0);
}

// ---------- фон для основной модели ----------

const IMPACT_TEXT = {
    small: 'small — a handful of people noticed',
    medium: 'medium — a local topic today',
    viral: 'viral — widely discussed',
};

function refreshBackground() {
    const data = ctx().chatMetadata?.[MODULE];
    const now = storyLength();
    const active = (data?.buzz?.active ?? []).filter(b => b.expiresAt > now);
    const text = enabled() && active.length
        ? `[Background — what people are saying online. Characters only know this if they plausibly saw it; react in proportion to its reach. It does not have to matter to the scene.]\n${active.map(b => `- (${IMPACT_TEXT[b.impact] ?? b.impact}) ${b.summary}`).join('\n')}`
        : '';
    // 1 — IN_CHAT, глубина 2: рядом с последними сообщениями, как свежий фон
    ctx().setExtensionPrompt(BACKGROUND_KEY, text, 1, 2);
}

// ---------- тег в тексте ----------

/** Тег не должен быть виден в чате — режем до Markdown */
function hideTags(text) {
    return /<!--\s*buzz/i.test(text) ? text.replace(TAG_RE, '').replace(/\n{3,}/g, '\n\n') : text;
}

function tagsOf(message) {
    return [...String(message?.mes ?? '').matchAll(TAG_RE)].map(m => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function buzzState(data) {
    data.buzz ??= { queue: [], active: [] };
    data.buzz.queue ??= [];
    data.buzz.active ??= [];
    return data.buzz;
}

/** Новое сообщение: ставим теги в очередь с задержкой */
function enqueueFrom(messageId) {
    const message = ctx().chat?.[messageId];
    const facts = tagsOf(message);
    if (!facts.length) return;

    const data = getPhoneData();
    if (!data) return;
    const state = buzzState(data);
    const delay = Math.max(0, Number(getSettings().buzzDelay) || 0);
    const src = message.send_date ?? messageId;

    for (const fact of facts) {
        if (state.queue.some(q => q.src === src && q.fact === fact)) continue;
        state.queue.push({ id: `bz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, fact, src, dueAt: storyLength() + delay - 1 });
    }
}

/** Источник ещё на месте? (сообщение могли удалить или перелистнуть свайп) */
function stillTold(item) {
    const message = ctx().chat?.find(m => (m.send_date ?? null) === item.src);
    return Boolean(message) && tagsOf(message).includes(item.fact);
}

// ---------- обсуждение ----------

const THREAD_PROMPT = `Something from the story has become public. First decide honestly how far it spreads, then write how Twitter/X reacts.
IMPACT:
- "small": a handful of people notice. Most events end here.
- "medium": a local topic for a day.
- "viral": only for genuinely huge public things.
Scale everything to the impact: small → dozens of likes and 2-4 replies; medium → hundreds or thousands and 4-7 replies; viral → big numbers and 6-10 replies.
People know ONLY the PUBLIC FACT — not private details, feelings or what happened behind closed doors. Reactions are human and mixed: jokes, takes, doubts, people who don't care, sometimes wrong guesses.
TWITTER CONTACTS may join only if they would realistically see it, in their own style.
Reply with ONLY JSON:
{"impact": "small|medium|viral", "headline": {"name": "...", "handle": "...", "text": "...", "likes": 0, "retweets": 0, "views": 0}, "replies": [{"name": "...", "handle": "...", "text": "..."}], "summary": "one English sentence for the narrator: what the online talk is like and how big it is"}
Write the tweets in {{language}}.`;

async function surface(data, item) {
    const sections = [
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        settingBlock(),
        twitterContactsBlock(data) && `TWITTER CONTACTS:\n${twitterContactsBlock(data)}`,
        `PUBLIC FACT: ${item.fact}`,
    ].filter(Boolean);

    const system = [THREAD_PROMPT.replace('{{language}}', storyLanguage()), imagePromptRule() && `${imagePromptRule()} Only the headline may have it.`].filter(Boolean).join('\n');
    const raw = await generate(getApi(), [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }]);
    return publishThread(data, parseJson(raw), item.fact);
}

/** Ответ модели (impact, headline, replies, summary) → твит в ленте и фон для основной модели */
function publishThread(data, parsed, fact) {
    const impact = ['small', 'medium', 'viral'].includes(parsed.impact) ? parsed.impact : 'small';

    // за аккаунты юзера модель не пишет — такой заголовок не публикуем
    if (isUserAccountPost(data, parsed.headline)) return null;
    const tweet = makeTweet(data, { ...parsed.headline, replies: parsed.replies, minutesAgo: 5 + Math.random() * 40 }, { kind: 'buzz' });
    if (!tweet.text) return null;
    tweet.buzz = { impact, fact };
    addTweets(data, [tweet]);
    startImages([tweet]);

    const at = storyLength();
    buzzState(data).active.push({
        tweetId: tweet.id,
        impact,
        summary: String(parsed.summary || fact).trim(),
        at,
        expiresAt: at + BACKGROUND_LIFETIME,
    });
    return tweet;
}

/**
 * Сеть заговорила не из-за истории, а из-за действия в телефоне (например, подписки):
 * твит в ленте, карточка под последним сообщением и фон для основной модели.
 */
export function publishPublicTalk(data, parsed, fact) {
    if (!enabled()) return null;
    const tweet = publishThread(data, parsed, fact);
    if (!tweet) return null;
    attachCardToStory(tweet);
    data.twitterUnseen = true;
    notifyDataChanged();
    refreshBackground();
    renderCards();
    return tweet;
}

/** Карточка вешается на последнее сообщение — туда, где новость «догнала» историю */
function attachCardToStory(tweet) {
    const { chat, saveChat } = ctx();
    const message = chat?.[chat.length - 1];
    if (!message) return;
    message.extra ??= {};
    const list = Array.isArray(message.extra.wavey_buzz) ? message.extra.wavey_buzz : [];
    list.push({
        tweetId: tweet.id,
        name: tweet.author.name,
        handle: tweet.author.handle,
        text: tweet.text,
        likes: tweet.likes,
        retweets: tweet.retweets,
        replies: tweet.replies.length,
        impact: tweet.buzz.impact,
    });
    message.extra.wavey_buzz = list;
    saveChat();
}

/** Всплыть всё, чему пора. Вызывается после каждого нового сообщения истории. */
async function processQueue() {
    if (!enabled() || busy) return;
    const data = ctx().chatMetadata?.[MODULE] ? getPhoneData() : null;
    const state = data?.buzz;
    if (!state?.queue.length) return;

    const now = storyLength();
    const due = state.queue.filter(q => now - 1 >= q.dueAt);
    if (!due.length) return;

    busy = true;
    try {
        for (const item of due) {
            state.queue = state.queue.filter(q => q.id !== item.id);
            if (!stillTold(item)) continue;
            const tweet = await surface(data, item);
            if (tweet) attachCardToStory(tweet);
        }
        notifyDataChanged();
        refreshBackground();
        renderCards();
    } catch (error) {
        console.warn(LOG, 'buzz', error);
    } finally {
        busy = false;
    }
}

// ---------- карточка под сообщением ----------

/** @type {(tweetId: string) => void} */
let openTweet = () => {};

function cardHtml(snap) {
    const letter = escapeHtml(([...String(snap.name).trim()][0] ?? '?').toUpperCase());
    return `
<div class="wavey-buzz-label">${escapeHtml(tr('hotNews'))} · ${escapeHtml(tr(`impact_${snap.impact}`))}</div>
<div class="wavey-buzz-tweet">
  <div class="wavey-buzz-ava">${letter}</div>
  <div class="wavey-buzz-body">
    <div class="wavey-buzz-head"><b>${escapeHtml(snap.name)}</b><span>${escapeHtml(snap.handle)}</span></div>
    <div class="wavey-buzz-text">${escapeHtml(snap.text)}</div>
    <div class="wavey-buzz-stats">
      <span>${escapeHtml(tr('repliesCount', snap.replies))}</span>
      <span>${formatCount(snap.retweets || 0)} ${escapeHtml(tr('retweets'))}</span>
      <span>${formatCount(snap.likes || 0)} ${escapeHtml(tr('likes'))}</span>
    </div>
  </div>
</div>`;
}

/**
 * Повесить карточки внутрь тела сообщения, под текст (DOM перерисовывается — вешаем заново).
 * Таверна при перерисовке заменяет содержимое .mes_text целиком, так что карточки уходят вместе с ним.
 */
function renderCards() {
    const { chat } = ctx();
    document.querySelectorAll('#chat .mes').forEach(mesEl => {
        const id = Number(/** @type {HTMLElement} */ (mesEl).getAttribute('mesid'));
        const cards = enabled() ? chat?.[id]?.extra?.wavey_buzz : null;
        const host = mesEl.querySelector('.mes_text');
        // карточки старого вида (под телом сообщения) тоже убираем
        const existing = mesEl.querySelectorAll('.wavey-buzz-card');
        if (!cards?.length) {
            existing.forEach(e => e.remove());
            return;
        }
        const inside = host?.querySelectorAll(':scope > .wavey-buzz-card') ?? [];
        if (!host || (inside.length === cards.length && existing.length === inside.length)) return;
        existing.forEach(e => e.remove());

        for (const snap of cards) {
            const card = document.createElement('div');
            card.className = 'wavey-buzz-card';
            card.innerHTML = cardHtml(snap);
            card.addEventListener('click', () => openTweet(snap.tweetId));
            host.appendChild(card); // по порядку, в самом конце текста
        }
    });
}

// ---------- запуск ----------

/** @param {{ openTweet: (tweetId: string) => void }} deps */
export function initBuzz(deps) {
    openTweet = deps.openTweet;
    const { messageFormatter, eventSource, eventTypes } = ctx();
    const formatter = messageFormatter?.addHook ? messageFormatter : messageFormatter?.instance;
    formatter?.addHook((text) => hideTags(text), { stage: formatter.stage.AFTER_REGEX });

    refreshRule();
    refreshBackground();

    eventSource.on(eventTypes.MESSAGE_RECEIVED, (messageId) => {
        if (!enabled()) return;
        enqueueFrom(Number(messageId));
        processQueue();
        refreshBackground();
    });
    eventSource.on(eventTypes.MESSAGE_SENT, () => processQueue());
    for (const type of ['CHAT_CHANGED', 'GENERATION_STARTED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']) {
        if (eventTypes[type]) eventSource.on(eventTypes[type], () => { refreshRule(); refreshBackground(); });
    }

    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; renderCards(); }, 40);
    });
    const chatEl = document.getElementById('chat');
    if (chatEl) observer.observe(chatEl, { childList: true, subtree: true });

    document.addEventListener(SETTINGS_EVENT, (e) => {
        if (/** @type {CustomEvent} */ (e).detail?.key !== 'buzzEnabled') return;
        refreshRule();
        refreshBackground();
        renderCards();
    });
}

/** Для проверки и ручного запуска: всплыть очередь сразу */
export const forceSurface = async () => {
    const data = getPhoneData();
    if (data?.buzz) data.buzz.queue.forEach(q => { q.dueAt = -Infinity; });
    await processQueue();
};
