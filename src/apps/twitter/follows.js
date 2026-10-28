// Подписки юзера в твиттере: «Читать» / «Вы читаете» в профиле и список подписок у каждого
// аккаунта юзера. Подписка (и отписка) может стать новостью: экстра-API решает, заметит ли
// это кто-нибудь, и если да — сеть обсуждает, как с горячей новостью из истории.

import { ctx, LOG } from '../../core/context.js';
import { REAL_LIFE_PUBLIC } from '../../core/realism.js';
import { generate } from '../../core/api.js';
import { getApi, getSettings } from '../../core/settings.js';
import { getCurrentAccount, notifyDataChanged } from '../../core/store.js';
import { getStoryNow } from '../../core/story-clock.js';
import { momentLine, userBlock } from '../messages/reply.js';
import { parseJson, publicKnowledgeBlock, settingBlock, storyLanguage, twitterContactsBlock } from './feed.js';
import { authorKey } from './profile.js';
import { publishPublicTalk } from '../../buzz/index.js';

/** @returns {{ handle: string, name: string, author: object, at: number }[]} */
export const followsOf = (account) => (account.follows ??= []);

export const isFollowing = (account, handle) => followsOf(account).some(f => authorKey(f.handle) === authorKey(handle));

/** Читатели того, на кого подписались: у контакта — в карточке, у остальных — в профиле */
function bumpFollowers(data, found, delta) {
    if (found.contact?.twitter) {
        found.contact.twitter.followers = Math.max(0, (found.contact.twitter.followers || 0) + delta);
        return;
    }
    const profile = data.profiles?.[authorKey(found.author.handle)];
    if (profile) profile.followers = Math.max(0, (profile.followers || 0) + delta);
}

/**
 * Подписаться / отписаться текущим аккаунтом.
 * @param {object} data
 * @param {{ author: object, contact?: object }} found  из findAuthor
 * @returns {boolean} подписан ли теперь
 */
export function toggleFollow(data, found) {
    const account = getCurrentAccount(data);
    const handle = found.author.handle;
    const following = isFollowing(account, handle);
    if (following) {
        account.follows = followsOf(account).filter(f => authorKey(f.handle) !== authorKey(handle));
        account.following = Math.max(0, (account.following || 0) - 1);
    } else {
        followsOf(account).unshift({ handle, name: found.author.name, author: found.author, at: getStoryNow().getTime() });
        account.following = (account.following || 0) + 1;
    }
    bumpFollowers(data, found, following ? -1 : 1);
    notifyDataChanged();
    discussFollow(data, account, found, !following);
    return !following;
}

// ---------- заметит ли сеть ----------

const FOLLOW_PROMPT = `On Twitter/X, one of USER's accounts just {{action}} another account, in an ongoing roleplay story.
Decide honestly whether anyone online notices. Most follows and unfollows go completely unnoticed — then reply {"noticed": false}.
People notice only when it is actually interesting: a famous or closely watched account is involved, it hints at drama (rivals, exes, a feud, a rumored couple), it contradicts something public, or fans track who someone follows. Respect what each account is: nobody links a secret or anonymous account to USER unless that is already public.
If it is noticed, write how Twitter reacts, scaled to how far it spreads:
- "small": a few people notice (dozens of likes, 2-4 replies). Most noticed follows end here.
- "medium": a topic for a day (hundreds or thousands of likes, 4-7 replies).
- "viral": only if it is genuinely huge.
Reactions are human and mixed: jokes, theories, people who don't care. TWITTER CONTACTS may join only if they would realistically see it.
${REAL_LIFE_PUBLIC}
Reply with ONLY JSON:
{"noticed": true, "impact": "small|medium|viral", "headline": {"name": "...", "handle": "...", "text": "...", "likes": 0, "retweets": 0, "views": 0}, "replies": [{"name": "...", "handle": "...", "text": "..."}], "summary": "one English sentence for the narrator: what people online are saying and how big it is"}
Write the tweets in {{language}}.`;

function accountLine(account) {
    const parts = [`${account.handle} (${account.name}, ${account.followers ?? 0} followers)`];
    if (account.bio) parts.push(`bio: ${account.bio}`);
    if (account.note) parts.push(`about this account: ${account.note}`);
    return parts.join(' — ');
}

function targetLine(data, found) {
    const { author, contact } = found;
    const profile = data.profiles?.[authorKey(author.handle)];
    const followers = contact?.twitter?.followers ?? profile?.followers;
    const parts = [`${author.handle} (${author.name}${followers != null ? `, ${followers} followers` : ''})`];
    if (contact?.relation) parts.push(`who they are to USER: ${contact.relation}`);
    if (profile?.bio) parts.push(`bio: ${profile.bio}`);
    return parts.join(' — ');
}

async function discussFollow(data, account, found, followed) {
    if (getSettings().buzzEnabled === false) return;
    const action = followed ? 'followed' : 'unfollowed';
    const sections = [
        userBlock(),
        `CURRENT MOMENT: ${momentLine()}`,
        settingBlock(),
        `USER'S ACCOUNT: ${accountLine(account)}`,
        `${followed ? 'FOLLOWED' : 'UNFOLLOWED'} ACCOUNT: ${targetLine(data, found)}`,
        twitterContactsBlock(data) && `TWITTER CONTACTS:\n${twitterContactsBlock(data)}`,
        publicKnowledgeBlock(data) && `PUBLIC CHATTER (already online):\n${publicKnowledgeBlock(data)}`,
    ].filter(Boolean);

    try {
        const system = FOLLOW_PROMPT.replace('{{action}}', action).replace('{{language}}', storyLanguage());
        const raw = await generate(getApi(), [{ role: 'system', content: system }, { role: 'user', content: sections.join('\n\n') }]);
        const parsed = parseJson(raw);
        if (!parsed.noticed) return;
        // чат могли сменить, пока шёл запрос
        if (ctx().chatMetadata?.wavey !== data) return;
        publishPublicTalk(data, parsed, `${account.handle} ${action} ${found.author.handle}`);
    } catch (error) {
        console.warn(LOG, 'follow', error);
    }
}
