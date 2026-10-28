// Лента твиттера: живые посты НПС и контактов с твиттером, без пересказа истории.
// Приватные сцены публике неизвестны; известно только то, что уже «вышло в сеть» (buzz).

import { ctx } from '../../core/context.js';
import { generate } from '../../core/api.js';
import { getApi, getSettings } from '../../core/settings.js';
import { cleanHandle, findContactByName, resolveContact } from '../../core/contacts.js';
import { getStoryNow } from '../../core/story-clock.js';
import { getCurrentAccount } from '../../core/store.js';
import { momentLine, userBlock } from '../messages/reply.js';
import { imageFromRaw, imagePromptRule, imagesAuto, MAX_IMAGES_PER_BATCH, queueTweetImages } from './images.js';

/** Сколько твитов ленты храним (свои и «горячие» не вытесняются) */
const FEED_LIMIT = 80;
/** Автообновление при открытии — не чаще, чем раз в столько сообщений истории */
export const AUTO_REFRESH_EVERY = 8;

const clean = (text) => String(text ?? '').replace(/\s+\n/g, '\n').trim();

/** Язык истории — по буквам последних сообщений (сами сообщения в промпт не идут) */
export function storyLanguage() {
    const sample = (ctx().chat ?? []).slice(-6).map(m => m?.mes || '').join(' ');
    const cyrillic = (sample.match(/[а-яё]/gi) ?? []).length;
    const latin = (sample.match(/[a-z]/gi) ?? []).length;
    return cyrillic > latin ? 'Russian' : 'English';
}

/** Сеттинг: сценарий и карточки персонажей — откуда модель поймёт место, эпоху, мир */
export function settingBlock() {
    const { characters, characterId, substituteParams } = ctx();
    const char = characters[characterId];
    const scenario = clean(substituteParams(char?.scenario || ''));
    const description = clean(substituteParams(char?.description || ''));
    return [scenario && `SCENARIO:\n${scenario}`, description && `STORY CHARACTER (${char.name}):\n${description}`].filter(Boolean).join('\n\n');
}

/** Контакты с твиттером — могут постить и отвечать */
export function twitterContactsBlock(data) {
    const list = data.contacts.filter(c => c.twitter?.enabled);
    if (!list.length) return '';
    return list.map(c => `- ${c.name} (${c.handle}, ${c.twitter.followers} followers) — ${c.relation || 'contact'}; texts/posts like: ${c.style || 'normal'}`).join('\n');
}

/** Твиттер-аккаунты юзера: био, читатели и заметка «что это за профиль» */
export function userAccountsBlock(data) {
    return (data.accounts ?? []).map(a => {
        const parts = [`${a.handle} (${a.name}, ${a.followers ?? 0} followers)`];
        if (a.bio) parts.push(`bio: ${a.bio}`);
        if (a.note) parts.push(`about this account: ${a.note}`);
        if (a.interests) parts.push(`into: ${a.interests}`);
        return `- ${parts.join(' — ')}`;
    }).join('\n');
}

/** Короткая сводка того, что уже обсуждают в сети (из buzz) */
export function publicKnowledgeBlock(data) {
    const active = data.buzz?.active ?? [];
    return active.map(b => `- ${b.summary}`).join('\n');
}

export function parseJson(raw) {
    const text = String(raw ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('bad-json');
    return JSON.parse(text.slice(start, end + 1));
}

const count = (value, fallback = 0) => Math.max(0, Math.round(Number(value) || fallback));

/**
 * Автор твита: если это контакт — берём его (аватар, хэндл), иначе НПС.
 * @param {object} data
 * @param {{ name?: string, handle?: string }} raw
 */
export function authorFrom(data, raw) {
    const name = String(raw?.name || '').trim() || 'user';
    const handle = '@' + (cleanHandle(raw?.handle) || cleanHandle(name) || 'user');
    const contact = findContactByName(data, name)
        ?? data.contacts.find(c => c.twitter?.enabled && cleanHandle(c.handle) === cleanHandle(handle))
        ?? (resolveContact(data, name)?.twitter?.enabled ? resolveContact(data, name) : null);
    if (contact) return { id: contact.id, name: contact.name, handle: contact.handle, charAvatar: contact.charAvatar, contact: true };
    return { id: `npc_${cleanHandle(handle)}`, name, handle, npc: true };
}

/**
 * Пост или ответ «от аккаунта юзера», который написала модель. За юзера в твиттере
 * пишет только он сам — такие выбрасываем (по хэндлу или имени любого его аккаунта).
 */
export function isUserAccountPost(data, raw) {
    const handle = cleanHandle(raw?.handle);
    const name = String(raw?.name || '').trim().toLowerCase();
    return (data.accounts ?? []).some(a =>
        (handle && cleanHandle(a.handle) === handle) || (name && a.name.trim().toLowerCase() === name));
}

/** Твит из ответа модели, время — сюжетное */
export function makeTweet(data, raw, { kind = 'feed', now = getStoryNow().getTime(), maxMinutes = 60 * 24 * 3 } = {}) {
    const ago = Math.max(0, Math.min(maxMinutes, Number(raw.minutesAgo ?? raw.ago) || 0));
    const ts = now - ago * 60_000;
    const rawReplies = (Array.isArray(raw.replies) ? raw.replies : [])
        .filter(r => String(r?.text || '').trim() && !isUserAccountPost(data, r));
    // ответы — по порядку между твитом и «сейчас», не позже настоящего момента
    const span = Math.max(60_000, now - ts);
    const replies = rawReplies.map((r, i) => ({
        id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`,
        author: authorFrom(data, r),
        text: String(r.text).trim(),
        ts: Math.min(now, ts + span * ((i + 0.5 + Math.random() * 0.5) / (rawReplies.length + 1))),
    }));
    return {
        id: `tw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        kind,
        author: authorFrom(data, raw),
        text: String(raw.text || '').trim(),
        ts,
        likes: count(raw.likes, Math.random() * 40),
        retweets: count(raw.retweets, Math.random() * 8),
        views: count(raw.views, 100 + Math.random() * 900),
        replies,
        // фото — только описание кадра; сама картинка дорисуется через Chamber of Secrets
        image: imageFromRaw(raw.image),
    };
}

/**
 * Оставить не больше MAX_IMAGES_PER_BATCH фото. В автоматическом режиме — сразу в очередь,
 * иначе остаются описанием («нажми, чтобы показать»).
 */
export function startImages(tweets) {
    const withImage = tweets.filter(t => t.image);
    withImage.slice(MAX_IMAGES_PER_BATCH).forEach(t => { t.image = null; });
    if (!imagesAuto()) return;
    const kept = withImage.slice(0, MAX_IMAGES_PER_BATCH);
    kept.forEach(t => { t.image.status = 'pending'; });
    queueTweetImages(kept.map(t => t.id));
}

// ---------- у каждого аккаунта юзера своя лента ----------

/** Чья это лента: старые твиты без пометки — ленты основного аккаунта */
export const feedOwner = (data, tweet) => tweet.accountId ?? data.accounts[0]?.id;

/**
 * Виден ли твит в ленте аккаунта: свои твиты этого аккаунта, его лента и «горячее» —
 * обсуждаемое в сети видно всем.
 */
export function inFeedOf(data, account, tweet) {
    if (tweet.kind === 'buzz') return true;
    if (tweet.kind === 'user') return tweet.author?.id === account.id;
    return feedOwner(data, tweet) === account.id;
}

/** Добавить твиты в ленту и подрезать старые сгенерированные — у каждой ленты свой лимит */
export function addTweets(data, tweets) {
    data.tweets.push(...tweets);
    data.tweets.sort((a, b) => b.ts - a.ts);
    const byOwner = new Map();
    for (const t of data.tweets.filter(t => t.kind === 'feed')) {
        const owner = feedOwner(data, t);
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner).push(t);
    }
    const drop = new Set();
    for (const list of byOwner.values()) list.slice(FEED_LIMIT).forEach(t => drop.add(t.id));
    if (drop.size) data.tweets = data.tweets.filter(t => !drop.has(t.id));
}

const FEED_PROMPT = `You write the Twitter/X home feed of ONE of USER's accounts (FEED OWNER) right now, in an ongoing roleplay story.
Each of USER's accounts has its own feed: it follows different people and gets posts that fit what that account is (a fan account sees the fandom, a work account sees work, a secret account sees what it was made for).
It must feel like a real feed, NOT a retelling of the story: private scenes are unknown to the public and must not appear.
Mix: local news for the place, world/setting news that fits the date and era, sports, celebrity gossip, memes and jokes, niche posts matching the FEED OWNER account, small everyday posts from random people. Accounts the feed owner FOLLOWS post more often. Contacts listed under TWITTER CONTACTS may post about their own lives in their style (not every time) — only if this account would plausibly follow them.
Never write posts or replies from any of USER's own accounts — only USER posts from them.
NPC accounts need realistic display names and handles that fit the setting's culture. Engagement must be realistic: most posts are small, a few are big.
If PUBLIC CHATTER is listed, a post or two may touch it — lightly.
Reply with ONLY JSON:
{"tweets": [{"name": "...", "handle": "...", "text": "...", "likes": 0, "retweets": 0, "views": 0, "minutesAgo": 0, "replies": [{"name": "...", "handle": "...", "text": "..."}]}]}
Write {{count}} tweets, 0-3 replies each, minutesAgo between 1 and 600. Write them in {{language}}.`;

function followsBlock(account) {
    return (account.follows ?? []).map(f => `- ${f.name} (${f.handle})`).join('\n');
}

/** Сгенерировать свежую порцию ленты текущего аккаунта. @returns {Promise<number>} сколько твитов добавлено */
export async function generateFeed(data) {
    const account = getCurrentAccount(data);
    const owner = [`${account.handle} (${account.name}, ${account.followers ?? 0} followers)`];
    if (account.bio) owner.push(`bio: ${account.bio}`);
    if (account.note) owner.push(`about this account: ${account.note}`);
    const sections = [
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        settingBlock(),
        `FEED OWNER: ${owner.join(' — ')}`,
        account.interests && `WHAT THIS ACCOUNT FOLLOWS AND IS INTO (build the feed mostly around this):\n${account.interests}`,
        followsBlock(account) && `THE FEED OWNER FOLLOWS:\n${followsBlock(account)}`,
        `ALL OF USER'S ACCOUNTS (respect what each account is — e.g. nobody links a secret account to USER):\n${userAccountsBlock(data)}`,
        twitterContactsBlock(data) && `TWITTER CONTACTS:\n${twitterContactsBlock(data)}`,
        publicKnowledgeBlock(data) && `PUBLIC CHATTER (already online):\n${publicKnowledgeBlock(data)}`,
    ].filter(Boolean);

    const system = [FEED_PROMPT.replace('{{count}}', '7').replace('{{language}}', storyLanguage()), imagePromptRule()].filter(Boolean).join('\n');
    const raw = await generate(getApi(), [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }]);
    const parsed = parseJson(raw);
    const tweets = (Array.isArray(parsed.tweets) ? parsed.tweets : [])
        .filter(t => String(t?.text || '').trim() && !isUserAccountPost(data, t))
        .map(t => ({ ...makeTweet(data, t), accountId: account.id }));

    addTweets(data, tweets);
    startImages(tweets);
    data.feeds ??= {};
    data.feeds[account.id] = { lastAt: ctx().chat?.length ?? 0 };
    return tweets.length;
}

/** Пора ли обновить ленту сама при открытии твиттера */
export function feedIsStale(data) {
    if (!getSettings().feedAuto) return false;
    const account = getCurrentAccount(data);
    if (!data.tweets.some(t => t.kind === 'feed' && feedOwner(data, t) === account.id)) return true;
    // старое поле feed — это лента основного аккаунта
    const legacy = account.id === data.accounts[0]?.id ? data.feed?.lastAt : undefined;
    const last = data.feeds?.[account.id]?.lastAt ?? legacy ?? -Infinity;
    return (ctx().chat?.length ?? 0) - last >= AUTO_REFRESH_EVERY;
}
