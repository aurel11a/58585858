// Твиттер-профиль персонажа или НПС: био, читатели и «история» — старые твиты и ретвиты,
// чтобы был виден вайб человека. История пишется экстра-API один раз, по кнопке — заново.

import { generate } from '../../core/api.js';
import { REAL_LIFE_PUBLIC } from '../../core/realism.js';
import { getApi } from '../../core/settings.js';
import { cleanHandle } from '../../core/contacts.js';
import { getStoryNow } from '../../core/story-clock.js';
import { momentLine, personBlock, userBlock } from '../messages/reply.js';
import { isUserAccountPost, makeTweet, parseJson, publicKnowledgeBlock, settingBlock, startImages, storyLanguage } from './feed.js';
import { imagePromptRule } from './images.js';

export const authorKey = (handle) => cleanHandle(handle);

/**
 * Автор по хэндлу: аккаунт юзера, контакт или НПС из твитов/ответов.
 * @returns {{ author: object, own?: boolean, contact?: object } | null}
 */
export function findAuthor(data, handle) {
    const key = authorKey(handle);
    const account = data.accounts.find(a => authorKey(a.handle) === key);
    if (account) return { author: account, own: true };
    const contact = data.contacts.find(c => authorKey(c.handle) === key);
    if (contact) return { author: { id: contact.id, name: contact.name, handle: contact.handle, charAvatar: contact.charAvatar, contact: true }, contact };
    const all = [...data.tweets, ...Object.values(data.profiles ?? {}).flatMap(p => p.tweets ?? [])];
    for (const tweet of all) {
        if (authorKey(tweet.author?.handle) === key) return { author: tweet.author };
        const reply = tweet.replies?.find(r => authorKey(r.author?.handle) === key);
        if (reply) return { author: reply.author };
    }
    // твиты могли вытесниться из ленты — остаётся снимок из подписок
    for (const acc of data.accounts) {
        const follow = (acc.follows ?? []).find(f => authorKey(f.handle) === key);
        if (follow?.author) return { author: follow.author };
    }
    return null;
}

/** Все твиты человека: из ленты и из его истории, свежие сверху */
export function authorTweets(data, handle) {
    const key = authorKey(handle);
    const fromFeed = data.tweets.filter(t => authorKey(t.author?.handle) === key);
    const history = data.profiles?.[key]?.tweets ?? [];
    return [...fromFeed, ...history].sort((a, b) => b.ts - a.ts);
}

const PROFILE_PROMPT = `You create the Twitter/X profile of one person in an ongoing roleplay story, as USER would see it when opening it.
Write their bio and their recent timeline BEFORE now: own tweets and retweets of others that show who they are — their vibe, interests, humor, daily life, opinions. Stay true to the person; it is a real account, not a summary of the story. Private scenes are unknown to the public: no spoilers of private events.
Engagement must match the account size. Retweets are of other accounts (realistic NPC names/handles fitting the setting).
${REAL_LIFE_PUBLIC}
Reply with ONLY JSON:
{"bio": "...", "followers": 0, "following": 0, "tweets": [{"text": "...", "likes": 0, "retweets": 0, "views": 0, "daysAgo": 0, "replies": [{"name": "...", "handle": "...", "text": "..."}]} or {"retweet": {"name": "...", "handle": "...", "text": "...", "likes": 0, "retweets": 0, "views": 0}, "daysAgo": 0}]}
Write 8-12 timeline entries, daysAgo between 0 and 60, 0-2 replies on own tweets. Write them in {{language}}.`;

/**
 * Сгенерировать (или переписать) профиль и историю.
 * @param {object} data
 * @param {{ author: object, contact?: object }} found
 */
export async function generateProfile(data, found) {
    const { author, contact } = found;
    const key = authorKey(author.handle);
    const known = data.tweets.filter(t => authorKey(t.author?.handle) === key).slice(0, 6);

    const person = contact
        ? personBlock(contact)
        : `Name: ${author.name}\nHandle: ${author.handle}\n(a person from the feed)`;
    const sections = [
        `PERSON:\n${person}`,
        known.length ? `THEIR RECENT TWEETS (already in the feed):\n${known.map(t => `- ${t.text}`).join('\n')}` : '',
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        settingBlock(),
        publicKnowledgeBlock(data) && `PUBLIC CHATTER (already online):\n${publicKnowledgeBlock(data)}`,
    ].filter(Boolean);

    const system = [PROFILE_PROMPT.replace('{{language}}', storyLanguage()), imagePromptRule()].filter(Boolean).join('\n');
    const raw = await generate(getApi(), [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }]);
    const parsed = parseJson(raw);

    const now = getStoryNow().getTime();
    const tweets = [];
    for (const entry of Array.isArray(parsed.tweets) ? parsed.tweets : []) {
        const minutesAgo = Math.max(0, Number(entry?.daysAgo) || 0) * 24 * 60 + 30 + Math.random() * 600;
        if (entry?.retweet && String(entry.retweet.text || '').trim()) {
            if (isUserAccountPost(data, entry.retweet)) continue;
            const tweet = makeTweet(data, { ...entry.retweet, minutesAgo }, { kind: 'history', maxMinutes: Infinity });
            tweet.retweetedBy = author.name;
            tweets.push(tweet);
        } else if (String(entry?.text || '').trim()) {
            tweets.push({ ...makeTweet(data, { ...entry, minutesAgo }, { kind: 'history', maxMinutes: Infinity }), author });
        }
    }

    data.profiles ??= {};
    data.profiles[key] = {
        bio: String(parsed.bio || '').trim(),
        followers: Math.max(0, Math.round(Number(parsed.followers) || 0)),
        following: Math.max(0, Math.round(Number(parsed.following) || 0)),
        tweets,
    };
    startImages(tweets);
}
