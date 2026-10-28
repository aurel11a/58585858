// Реакция людей на твит юзера — соразмерно аудитории аккаунта.
// Модель честно оценивает отклик (читатели, био, «что это за профиль», сам текст),
// а цифры и ответы приходят постепенно, как в жизни.

import { LOG } from '../../core/context.js';
import { generateWithPhotos } from '../../core/vision.js';
import { getApi } from '../../core/settings.js';
import { getPhoneData, notifyDataChanged } from '../../core/store.js';
import { getStoryNow } from '../../core/story-clock.js';
import { momentLine } from '../messages/reply.js';
import { authorFrom, isUserAccountPost, parseJson, publicKnowledgeBlock, settingBlock, storyLanguage, twitterContactsBlock } from './feed.js';

/** Пауза после публикации, прежде чем пойдёт отклик */
const FIRST_DELAY_MS = 4000;
/** За сколько шагов «докручиваются» цифры */
const STEPS = 6;
const STEP_MIN_MS = 2500;
const STEP_MAX_MS = 6000;

const PROMPT = `USER just posted a tweet in an ongoing roleplay story. Decide honestly how people react, then write the reaction.
Engagement MUST be proportional to the account and the post:
- Small accounts (under ~300 followers): usually 0-5 likes, often zero replies. Silence is normal.
- Mid accounts (~300-10k): a few dozen likes, 1-4 replies.
- Big accounts (10k+): hundreds to thousands of likes, 5-10 replies, a lot of views.
- A secret/alt account barely reaches anyone; nobody there knows it is USER unless the note says so.
- The text matters: funny, controversial, emotional or newsworthy posts travel further; dull ones don't.
Replies come from realistic NPC accounts fitting the setting. TWITTER CONTACTS may reply only if they would realistically follow this account, in their own style.
Reply with ONLY JSON:
{"likes": 0, "retweets": 0, "views": 0, "newFollowers": 0, "replies": [{"name": "...", "handle": "...", "text": "..."}]}
Write replies in {{language}}.`;

function accountBlock(account) {
    const lines = [`${account.name} (${account.handle}), ${account.followers ?? 0} followers, follows ${account.following ?? 0}`];
    if (account.bio) lines.push(`Bio: ${account.bio}`);
    if (account.note) lines.push(`About this account: ${account.note}`);
    return lines.join('\n');
}

const count = (value) => Math.max(0, Math.round(Number(value) || 0));
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);

/** Отметить, что в твиттере есть что-то новое (точка на иконке) */
function markUnseen(data) {
    data.twitterUnseen = true;
}

/**
 * Запустить реакцию на твит. Ничего не возвращает: всё приходит постепенно через notifyDataChanged.
 * @param {string} tweetId
 * @param {(tweetId: string) => boolean} isWatching  смотрит ли юзер сейчас этот твит/ленту (тогда без точки)
 */
export async function reactToTweet(tweetId, isWatching) {
    await wait(FIRST_DELAY_MS);
    const data = getPhoneData();
    const tweet = data?.tweets.find(t => t.id === tweetId);
    const account = data?.accounts.find(a => a.id === tweet?.author.id);
    if (!tweet || !account) return;

    const sections = [
        `POSTING ACCOUNT:\n${accountBlock(account)}`,
        `TWEET: ${tweet.text || '(no text, photo only)'}${tweet.image?.path ? ' [the tweet has a photo — see the image]' : ''}`,
        `CURRENT MOMENT: ${momentLine()}`,
        settingBlock(),
        twitterContactsBlock(data) && `TWITTER CONTACTS:\n${twitterContactsBlock(data)}`,
        publicKnowledgeBlock(data) && `PUBLIC CHATTER (already online):\n${publicKnowledgeBlock(data)}`,
    ].filter(Boolean);

    let parsed;
    try {
        const photos = tweet.image?.path ? [{ path: tweet.image.path, label: 'Photo attached to the tweet:' }] : [];
        const raw = await generateWithPhotos(getApi(), [
            { role: 'system', content: PROMPT.replace('{{language}}', storyLanguage()) },
            { role: 'user', content: sections.join('\n\n') },
        ], photos);
        parsed = parseJson(raw);
    } catch (error) {
        // без попапов: в худшем случае твит просто останется без реакции
        console.warn(LOG, 'tweet reactions', error);
        return;
    }

    const target = {
        likes: count(parsed.likes),
        retweets: count(parsed.retweets),
        views: Math.max(count(parsed.views), count(parsed.likes)),
        followers: count(parsed.newFollowers),
    };
    const replies = (Array.isArray(parsed.replies) ? parsed.replies : [])
        .filter(r => String(r?.text || '').trim() && !isUserAccountPost(data, r));
    const start = { likes: tweet.likes || 0, retweets: tweet.retweets || 0, views: tweet.views || 0, followers: account.followers || 0 };

    // ответы раскладываем по шагам: сначала тихо, потом по одному
    const replyAt = replies.map((_, i) => Math.min(STEPS - 1, Math.floor(((i + 1) / (replies.length + 1)) * STEPS + Math.random())));

    for (let step = 0; step < STEPS; step++) {
        await wait(between(STEP_MIN_MS, STEP_MAX_MS));
        const fresh = getPhoneData();
        const live = fresh?.tweets.find(t => t.id === tweetId);
        if (!live) return; // чат сменили или твит удалили

        const likesBefore = live.likes || 0;
        // кривая «сначала быстро, потом медленнее»
        const k = 1 - Math.pow(1 - (step + 1) / STEPS, 2);
        live.likes = Math.round(start.likes + target.likes * k);
        live.retweets = Math.round(start.retweets + target.retweets * k);
        live.views = Math.round(start.views + target.views * k);

        const liveAccount = fresh.accounts.find(a => a.id === account.id);
        if (liveAccount && target.followers) liveAccount.followers = Math.round(start.followers + target.followers * k);

        let arrived = false;
        replies.forEach((reply, i) => {
            if (replyAt[i] !== step) return;
            live.replies ??= [];
            live.replies.push({
                id: `rp_${Date.now()}_${i}`,
                author: authorFrom(fresh, reply),
                text: String(reply.text).trim(),
                ts: getStoryNow().getTime() + i * 1000,
            });
            arrived = true;
        });

        // точка на иконке — только если правда что-то пришло, а юзер не смотрит
        if ((arrived || live.likes > likesBefore) && !isWatching(tweetId)) markUnseen(fresh);
        notifyDataChanged();
    }
}
