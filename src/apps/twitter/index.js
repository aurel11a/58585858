// Приложение «Твиттер»: лента, профиль с аккаунтами, ветка твита

import { tr } from '../../i18n.js';
import { LOG, TWEET_LIMIT } from '../../core/context.js';
import { escapeHtml, formatCount, localeTag, relativeTime } from '../../core/format.js';
import { authorOf, findTweet, getCurrentAccount, getPhoneData, notifyDataChanged, savePhoneData } from '../../core/store.js';
import { authorKey, authorTweets, findAuthor, generateProfile } from './profile.js';
import { getStoryNow } from '../../core/story-clock.js';
import { feedIsStale, generateFeed } from './feed.js';
import { migrateInlineAvatars } from '../../ui/image.js';
import { avatarHtml } from '../../ui/avatar.js';
import { ICONS } from '../../ui/icons.js';
import { $q, $qa, el, getRoot } from '../../ui/dom.js';
import { reactToTweet } from './reactions.js';
import { requestTweetImage } from './images.js';
import { imageUrl, pickImageFile, preparePhoto, uploadImage } from '../../ui/image.js';
import { closeShareSheet, openShareSheet, shareOnClick, shareOnEscape, shareSheetHtml } from './share.js';
import { accountsOnClick, accountsOnEscape, accountsOverlayHtml, bindAccounts, openAccountSheet, resetAccounts } from './accounts.js';

let currentThreadId = null;
let refreshing = false;

/** Аккаунты юзера по id: в твитах хранится снимок автора, а фото и имя берём живые */
let accountsById = new Map();
const liveAuthor = (author) => accountsById.get(author?.id) ?? author;

/** «5 мин» — от сюжетного «сейчас», а не от реальных часов */
const ago = (ts) => relativeTime(ts, getStoryNow().getTime());

/**
 * Фото твита: описание без картинки — плашка «нажми, чтобы показать»; рисуется — мерцание;
 * готово — картинка с ↻; не получилось — «Повторить».
 */
function tweetImageHtml(tweet) {
    const image = tweet.image;
    if (!image) return '';
    const id = escapeHtml(tweet.id);
    if (image.status === 'pending') return `<div class="wv-tweet-photo wv-photo-pending"><span>${tr('photoLoading')}</span></div>`;
    if (image.status === 'done' && image.path) {
        const regen = image.prompt ? `<div class="wv-photo-regen" data-wv-photo-gen="${id}" title="${tr('photoRegen')}">${ICONS.refresh}</div>` : '';
        return `<div class="wv-tweet-photo"><img src="${imageUrl(image.path)}" alt="" loading="lazy">${regen}</div>`;
    }
    const label = image.status === 'failed' ? tr('photoFailedRetry') : tr('photoTap');
    return `<div class="wv-tweet-photo wv-photo-idle" data-wv-photo-gen="${id}">
  ${ICONS.image}<span>${label}</span>
</div>`;
}

function trendLabel(tweet) {
    return tweet.kind === 'buzz' ? `<div class="wv-trend">${ICONS.sparkle}<span>${tr('trending')} · ${tr(`impact_${tweet.buzz?.impact ?? 'small'}`)}</span></div>` : '';
}

// ---------- разметка ----------

function retweetLabel(tweet) {
    return tweet.retweetedBy ? `<div class="wv-trend">${ICONS.retweet}<span>${escapeHtml(tr('retweeted', tweet.retweetedBy))}</span></div>` : '';
}

// Аватар и имя в строку (тап — профиль), текст, фото и кнопки — на всю ширину под ними
function tweetHtml(tweet) {
    const replies = tweet.replies?.length ?? 0;
    return `
<div class="wv-tweet" data-tweet-id="${escapeHtml(tweet.id)}">
  ${retweetLabel(tweet)}
  ${trendLabel(tweet)}
  <div class="wv-tweet-head" data-wv-author="${escapeHtml(tweet.author.handle)}">
    ${avatarHtml(liveAuthor(tweet.author), 'wv-sm')}
    <div class="wv-tweet-header">
      <span class="wv-tweet-user">${escapeHtml(tweet.author.name)}</span>
      <span class="wv-tweet-handle">${escapeHtml(tweet.author.handle)} · ${ago(tweet.ts)}</span>
    </div>
  </div>
  ${tweet.text ? `<div class="wv-tweet-text">${escapeHtml(tweet.text)}</div>` : ''}
  ${tweetImageHtml(tweet)}
  <div class="wv-tweet-actions">
    <span>${ICONS.chat} ${replies}</span>
    <span>${ICONS.retweet} ${formatCount(tweet.retweets || 0)}</span>
    <span class="${tweet.liked ? 'wv-liked' : ''}" data-wv-like>${ICONS.heart} ${formatCount(likesOf(tweet))}</span>
    <span data-wv-share>${ICONS.share}</span>
  </div>
</div>`;
}

const likesOf = (tweet) => (tweet.likes || 0) + (tweet.liked ? 1 : 0);

function mainTweetHtml(tweet) {
    const date = new Date(tweet.ts);
    const time = date.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
    const day = date.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });

    // Аватар и имя в строку, всё остальное на всю ширину под ними
    return `
<div class="wv-main-tweet" data-tweet-id="${escapeHtml(tweet.id)}">
  ${retweetLabel(tweet)}
  ${trendLabel(tweet)}
  <div class="wv-main-head" data-wv-author="${escapeHtml(tweet.author.handle)}">
    ${avatarHtml(liveAuthor(tweet.author), 'wv-md')}
    <div class="wv-tweet-header">
      <span class="wv-tweet-user">${escapeHtml(tweet.author.name)}</span>
      <span class="wv-tweet-handle">${escapeHtml(tweet.author.handle)}</span>
    </div>
  </div>
  <div class="wv-node-text">${escapeHtml(tweet.text)}</div>
  ${tweetImageHtml(tweet)}
  <div class="wv-node-date">${time} · ${day} · <strong>${formatCount(tweet.views || 0)}</strong> ${tr('views')}</div>
  <div class="wv-stats-row">
    <span><strong>${formatCount(tweet.retweets || 0)}</strong> ${tr('retweets')}</span>
    <span><strong>${formatCount(likesOf(tweet))}</strong> ${tr('likes')}</span>
  </div>
  <div class="wv-main-actions">
    <span>${ICONS.chat}</span>
    <span>${ICONS.retweet}</span>
    <span class="${tweet.liked ? 'wv-liked' : ''}" data-wv-like>${ICONS.heart}</span>
    <span data-wv-share>${ICONS.share}</span>
  </div>
</div>`;
}

function replyHtml(node, withLine) {
    return `
<div class="wv-node ${withLine ? 'wv-line' : ''}">
  <div data-wv-author="${escapeHtml(node.author.handle)}">${avatarHtml(liveAuthor(node.author), 'wv-md')}</div>
  <div class="wv-node-body">
    <div class="wv-tweet-header">
      <span class="wv-tweet-user">${escapeHtml(node.author.name)}</span>
      <span class="wv-tweet-handle">${escapeHtml(node.author.handle)} · ${ago(node.ts)}</span>
    </div>
    <div class="wv-node-text wv-reply-text">${escapeHtml(node.text)}</div>
  </div>
</div>`;
}

// ---------- рендер ----------

function renderFeedAndProfile(data) {
    const tweets = data?.tweets ?? [];
    accountsById = new Map((data?.accounts ?? []).map(a => [a.id, a]));
    // точка на иконке: пришли реакции, пока юзер был не в твиттере
    $q('[data-wv-dot="twitter"]')?.classList.toggle('wv-show', Boolean(data?.twitterUnseen) && !isTwitterVisible());

    el('feed').innerHTML = tweets.length
        ? tweets.map(tweetHtml).join('')
        : `<div class="wv-empty">${data ? tr('feedEmpty') : tr('noChat')}</div>`;

    if (!data) return;
    const account = getCurrentAccount(data);
    const mine = tweets.filter(t => t.author.id === account.id);

    el('myFeed').innerHTML = mine.length ? mine.map(tweetHtml).join('') : `<div class="wv-empty">${tr('noTweets')}</div>`;
    el('myCount').textContent = String(mine.length);

    el('composeAvatar').innerHTML = avatarHtml(account, 'wv-sm');
    el('replyAvatar').innerHTML = avatarHtml(account, 'wv-sm');
    el('profileAvatar').innerHTML = avatarHtml(account, 'wv-lg');
    el('profileName').textContent = account.name;
    el('profileHandle').textContent = account.handle;
    el('profileBio').textContent = account.bio || '';
    el('statFollowing').textContent = formatCount(account.following);
    el('statFollowers').textContent = formatCount(account.followers);
}

function renderThread(data) {
    accountsById = new Map((data?.accounts ?? []).map(a => [a.id, a]));
    const tweet = findTweet(data, currentThreadId);
    if (!tweet) return closeThread();

    const replies = tweet.replies ?? [];
    el('threadNodes').innerHTML = mainTweetHtml(tweet)
        + replies.map((r, i) => replyHtml(r, i < replies.length - 1)).join('');
}

// ---------- действия ----------

function switchTab(name) {
    $qa('[data-wv-tab]').forEach(i => i.classList.toggle('wv-active', i.dataset.wvTab === name));
    $qa('[data-wv-tab-id]').forEach(t => t.classList.toggle('wv-active', t.dataset.wvTabId === name));
}

function updateCharCount() {
    const input = /** @type {HTMLTextAreaElement} */ (el('tweetInput'));
    const left = TWEET_LIMIT - input.value.length;
    const counter = el('charCount');
    counter.textContent = String(left);
    counter.classList.toggle('wv-warn', left < 20);
    /** @type {HTMLButtonElement} */ (el('sendTweet')).disabled = (input.value.trim().length === 0 && !tweetPhoto) || posting;
}

// ---------- фото к своему твиту ----------

/** Выбранное фото к твиту: { blob, format, preview } */
let tweetPhoto = null;
let posting = false;

function renderTweetPhoto(error = '') {
    const box = el('tweetAttach');
    if (error) {
        box.innerHTML = `<div class="wv-attach-error">${escapeHtml(error)}</div>`;
        return;
    }
    box.innerHTML = tweetPhoto
        ? `<div class="wv-attach-thumb wv-attach-wide"><img src="${tweetPhoto.preview}" alt=""><div class="wv-attach-remove" data-wv-action="tweetPhotoRemove">${ICONS.close}</div></div>`
        : '';
}

function clearTweetPhoto() {
    if (tweetPhoto?.preview) URL.revokeObjectURL(tweetPhoto.preview);
    tweetPhoto = null;
    renderTweetPhoto();
    updateCharCount();
}

async function attachTweetPhoto() {
    // прямо из нажатия — иначе мобильные браузеры не откроют выбор
    const file = await pickImageFile();
    if (!file) return;
    try {
        const prepared = await preparePhoto(file);
        if (tweetPhoto?.preview) URL.revokeObjectURL(tweetPhoto.preview);
        tweetPhoto = { ...prepared, preview: URL.createObjectURL(prepared.blob) };
        renderTweetPhoto();
        updateCharCount();
    } catch {
        renderTweetPhoto(tr('photoUnsupported'));
    }
}

async function postTweet() {
    const data = getPhoneData();
    const input = /** @type {HTMLTextAreaElement} */ (el('tweetInput'));
    const text = input.value.trim();
    if (!data || (!text && !tweetPhoto) || posting) return;

    // своё фото — файлом в папку wavey; описания нет, перерисовать нельзя
    let image = null;
    if (tweetPhoto) {
        posting = true;
        updateCharCount();
        try {
            image = { path: await uploadImage(tweetPhoto.blob, 'photo', tweetPhoto.format), status: 'done', own: true };
        } catch {
            posting = false;
            updateCharCount();
            return renderTweetPhoto(tr('photoFailed'));
        }
        posting = false;
        clearTweetPhoto();
    }

    const id = `tw_${Date.now()}`;
    data.tweets.unshift({
        id,
        kind: 'user',
        author: authorOf(getCurrentAccount(data)),
        text,
        ...(image ? { image } : {}),
        ts: getStoryNow().getTime(),
        likes: 0,
        retweets: 0,
        views: 1,
        replies: [],
    });
    savePhoneData();

    input.value = '';
    updateCharCount();
    renderFeedAndProfile(data);
    // люди реагируют соразмерно аудитории — постепенно, в фоне
    reactToTweet(id, isTwitterVisible);
}

/** Юзер сейчас смотрит твиттер — тогда новое видно и без точки на иконке */
function isTwitterVisible() {
    return Boolean(getRoot()?.classList.contains('wv-open') && $q('[data-wv-panel-id="twitter"]')?.classList.contains('wv-active'));
}

function postReply() {
    const data = getPhoneData();
    const input = /** @type {HTMLTextAreaElement} */ (el('replyInput'));
    const text = input.value.trim();
    const tweet = findTweet(data, currentThreadId);
    if (!tweet || !text) return;

    tweet.replies = tweet.replies ?? [];
    tweet.replies.push({ id: `rp_${Date.now()}`, author: authorOf(getCurrentAccount(data)), text, ts: getStoryNow().getTime() });
    savePhoneData();

    input.value = '';
    input.style.height = '';
    /** @type {HTMLButtonElement} */ (el('sendReply')).disabled = true;
    renderThread(data);
    renderFeedAndProfile(data);
    const scroll = el('threadScroll');
    scroll.scrollTop = scroll.scrollHeight;
}

function toggleLike(tweetId) {
    const data = getPhoneData();
    const tweet = findTweet(data, tweetId);
    if (!tweet) return;
    tweet.liked = !tweet.liked;
    savePhoneData();
    renderFeedAndProfile(data);
    if (currentThreadId === tweetId) renderThread(data);
    if (authorHandle) renderAuthorPage(data);
}

function openThread(tweetId) {
    const data = getPhoneData();
    if (!data) return;
    currentThreadId = tweetId;
    /** @type {HTMLTextAreaElement} */ (el('replyInput')).value = '';
    /** @type {HTMLButtonElement} */ (el('sendReply')).disabled = true;
    renderThread(data);
    raise(el('thread'));
    el('thread').classList.add('wv-open');
}

// ---------- профиль другого человека ----------

/** Чей профиль открыт (хэндл) */
let authorHandle = null;
const loadingProfiles = new Set();
const failedProfiles = new Set();

/** Ветка и профиль открываются друг из друга — последний открытый сверху */
let layer = 100;
const raise = (node) => { node.style.zIndex = String(++layer); };

function openAuthor(handle) {
    const data = getPhoneData();
    const found = data && findAuthor(data, handle);
    if (!found) return;
    // свой аккаунт — это вкладка профиля
    if (found.own) {
        closeThread();
        closeAuthor();
        return switchTab('profile');
    }
    authorHandle = found.author.handle;
    raise(el('authorPage'));
    el('authorPage').classList.add('wv-open');
    el('authorScroll').scrollTop = 0;
    renderAuthorPage(data);
    if (!data.profiles?.[authorKey(authorHandle)]) loadProfile();
}

function closeAuthor() {
    authorHandle = null;
    el('authorPage')?.classList.remove('wv-open');
}

async function loadProfile() {
    const data = getPhoneData();
    const found = data && authorHandle && findAuthor(data, authorHandle);
    if (!found) return;
    const key = authorKey(found.author.handle);
    if (loadingProfiles.has(key)) return;
    loadingProfiles.add(key);
    failedProfiles.delete(key);
    renderAuthorPage(data);
    try {
        await generateProfile(data, found);
    } catch (error) {
        console.warn(LOG, 'profile', error);
        failedProfiles.add(key);
    } finally {
        loadingProfiles.delete(key);
        notifyDataChanged();
    }
}

function renderAuthorPage(data) {
    if (!authorHandle || !data) return;
    const found = findAuthor(data, authorHandle);
    if (!found) return closeAuthor();
    const { author, contact } = found;
    const key = authorKey(author.handle);
    const profile = data.profiles?.[key];
    const followers = contact?.twitter?.enabled ? contact.twitter.followers : profile?.followers ?? 0;
    const following = contact?.twitter?.enabled ? contact.twitter.following : profile?.following ?? 0;

    el('authorTitle').textContent = author.name;
    el('authorRefresh').classList.toggle('wv-spin', loadingProfiles.has(key));
    el('authorHead').innerHTML = `
${avatarHtml(liveAuthor(author), 'wv-lg')}
<div class="wv-profile-name">${escapeHtml(author.name)}</div>
<div class="wv-profile-handle">${escapeHtml(author.handle)}</div>
${profile?.bio ? `<div class="wv-profile-bio">${escapeHtml(profile.bio)}</div>` : ''}
<div class="wv-stats">
  <div class="wv-stat"><span class="wv-num">${formatCount(following)}</span><span class="wv-label">${tr('following')}</span></div>
  <div class="wv-stat"><span class="wv-num">${formatCount(followers)}</span><span class="wv-label">${tr('followers')}</span></div>
</div>`;

    const status = loadingProfiles.has(key) ? tr('profileLoading') : failedProfiles.has(key) ? tr('profileFailed') : '';
    el('authorStatus').textContent = status;
    el('authorStatus').className = `wv-list-status ${failedProfiles.has(key) ? 'wv-error' : ''}`;
    const tweets = authorTweets(data, author.handle);
    el('authorFeed').innerHTML = tweets.length ? tweets.map(tweetHtml).join('') : (status ? '' : `<div class="wv-empty">${tr('noTweetsOther')}</div>`);
}

function setFeedStatus(text, kind = '') {
    const status = el('feedStatus');
    status.textContent = text;
    status.className = `wv-list-status ${kind ? 'wv-' + kind : ''}`;
}

async function refreshFeed() {
    const data = getPhoneData();
    if (!data || refreshing) return;
    refreshing = true;
    el('refreshFeed').classList.add('wv-spin');
    setFeedStatus(tr('feedRefreshing'));
    try {
        await generateFeed(data);
        notifyDataChanged();
        setFeedStatus('');
        el('feedScroll').scrollTop = 0;
    } catch (error) {
        console.warn(LOG, 'feed', error);
        setFeedStatus(tr('feedFailed'), 'error');
    } finally {
        refreshing = false;
        el('refreshFeed').classList.remove('wv-spin');
    }
}

/** Открыть ветку твита (из карточки «горячая новость» под сообщением ролевой) */
export function openTweetThread(tweetId) {
    switchTab('feed');
    openThread(tweetId);
}

function closeThread() {
    currentThreadId = null;
    el('thread')?.classList.remove('wv-open');
}

// ---------- приложение ----------

/** @type {import('../types.js').PhoneApp} */
export const twitterApp = {
    id: 'twitter',
    icon: ICONS.bird,
    title: () => 'Twitter',
    hasDot: true,

    html: () => `
<div class="wv-scroll" data-wv="feedScroll">
  <div class="wv-tab wv-active" data-wv-tab-id="feed">
    <div class="wv-list-header">${tr('feed')}
      <div class="wv-header-tools">
        <div class="wv-icon-btn" data-wv="refreshFeed" data-wv-action="refreshFeed" title="${tr('feedRefresh')}">${ICONS.refresh}</div>
      </div>
    </div>
    <div class="wv-list-status" data-wv="feedStatus"></div>
    <div class="wv-compose">
      <div class="wv-compose-top">
        <div data-wv="composeAvatar"></div>
        <textarea class="wv-input" data-wv="tweetInput" placeholder="${tr('whatsHappening')}" maxlength="${TWEET_LIMIT}" rows="2"></textarea>
      </div>
      <div data-wv="tweetAttach"></div>
      <div class="wv-compose-bottom">
        <div class="wv-icon-btn wv-compose-photo" data-wv-action="tweetPhoto" title="${tr('photoMsg')}">${ICONS.image}</div>
        <span class="wv-char-count" data-wv="charCount">${TWEET_LIMIT}</span>
        <button class="wv-btn" data-wv="sendTweet" disabled>${tr('tweet')}</button>
      </div>
    </div>
    <div class="wv-feed" data-wv="feed"></div>
  </div>

  <div class="wv-tab" data-wv-tab-id="profile">
    <div class="wv-profile">
      <div data-wv="profileAvatar"></div>
      <div class="wv-profile-name-wrap" data-wv="profileNameWrap">
        <div class="wv-profile-name" data-wv="profileName"></div>
        <div class="wv-chevron" data-wv="chevron">${ICONS.chevron}</div>
      </div>
      <div class="wv-profile-handle" data-wv="profileHandle"></div>
      <div class="wv-profile-bio" data-wv="profileBio"></div>
      <div class="wv-stats">
        <div class="wv-stat"><span class="wv-num" data-wv="statFollowing"></span><span class="wv-label">${tr('following')}</span></div>
        <div class="wv-stat"><span class="wv-num" data-wv="statFollowers"></span><span class="wv-label">${tr('followers')}</span></div>
      </div>
      <button class="wv-profile-btn" data-wv-action="editProfile">${tr('editProfile')}</button>
    </div>
    <div class="wv-section-header">${tr('yourTweets')} <span data-wv="myCount">0</span></div>
    <div class="wv-feed" data-wv="myFeed"></div>
  </div>
</div>

<div class="wv-bottom-nav">
  <div class="wv-nav-item wv-active" data-wv-tab="feed">${ICONS.home}</div>
  <div class="wv-nav-item" data-wv-tab="profile">${ICONS.user}</div>
</div>`,

    overlayHtml: () => accountsOverlayHtml() + shareSheetHtml() + `
<div class="wv-thread" data-wv="authorPage">
  <div class="wv-thread-header">
    <div class="wv-icon-btn" data-wv-action="authorBack">${ICONS.back}</div>
    <div class="wv-thread-title" data-wv="authorTitle"></div>
    <div class="wv-icon-btn wv-header-end" data-wv="authorRefresh" data-wv-action="authorRefresh" title="${tr('profileRefresh')}">${ICONS.refresh}</div>
  </div>
  <div class="wv-scroll" data-wv="authorScroll">
    <div class="wv-profile" data-wv="authorHead"></div>
    <div class="wv-list-status" data-wv="authorStatus"></div>
    <div class="wv-feed" data-wv="authorFeed"></div>
  </div>
</div>
<div class="wv-thread" data-wv="thread">
  <div class="wv-thread-header">
    <div class="wv-icon-btn" data-wv-action="threadBack">${ICONS.back}</div>
    <div class="wv-thread-title">${tr('thread')}</div>
  </div>
  <div class="wv-scroll" data-wv="threadScroll">
    <div data-wv="threadNodes"></div>
  </div>
  <div class="wv-reply-compose">
    <div data-wv="replyAvatar"></div>
    <div class="wv-reply-wrap">
      <textarea class="wv-reply-input" data-wv="replyInput" placeholder="${tr('replyPlaceholder')}" maxlength="${TWEET_LIMIT}" rows="1"></textarea>
      <button class="wv-btn" data-wv="sendReply" disabled>${tr('reply')}</button>
    </div>
  </div>
</div>`,

    bind() {
        el('tweetInput').addEventListener('input', updateCharCount);
        el('sendTweet').addEventListener('click', postTweet);

        const replyInput = /** @type {HTMLTextAreaElement} */ (el('replyInput'));
        replyInput.addEventListener('input', () => {
            /** @type {HTMLButtonElement} */ (el('sendReply')).disabled = replyInput.value.trim().length === 0;
            replyInput.style.height = 'auto';
            replyInput.style.height = replyInput.scrollHeight + 'px';
        });
        el('sendReply').addEventListener('click', postReply);

        bindAccounts(() => renderFeedAndProfile(getPhoneData()));
    },

    render(data) {
        // старые аватарки в base64 тихо переезжают файлами в папку wavey
        migrateInlineAvatars(data, notifyDataChanged);
        renderFeedAndProfile(data);
        if (currentThreadId && data) renderThread(data);
        else closeThread();
        if (authorHandle && data) renderAuthorPage(data);
        else closeAuthor();
    },

    onClick(target) {
        const tabBtn = target.closest('[data-wv-tab]');
        if (tabBtn) return switchTab(tabBtn.dataset.wvTab), true;

        if (accountsOnClick(target)) return true;
        if (shareOnClick(target)) return true;

        const action = target.closest('[data-wv-action]')?.dataset.wvAction;
        if (action === 'threadBack') return closeThread(), true;
        if (action === 'authorBack') return closeAuthor(), true;
        if (action === 'authorRefresh') return loadProfile(), true;
        if (action === 'tweetPhoto') return attachTweetPhoto(), true;
        if (action === 'tweetPhotoRemove') return clearTweetPhoto(), true;
        if (action === 'refreshFeed') return refreshFeed(), true;

        if (target.closest('[data-wv="profileNameWrap"]')) return openAccountSheet(), true;

        // фото: показать по нажатию / перерисовать — не открывая ветку
        const photo = target.closest('[data-wv-photo-gen]');
        if (photo) return requestTweetImage(photo.dataset.wvPhotoGen), true;

        const authorEl = target.closest('[data-wv-author]');
        if (authorEl) return openAuthor(authorEl.dataset.wvAuthor), true;

        const tweetEl = target.closest('[data-tweet-id]');
        if (tweetEl) {
            if (target.closest('[data-wv-share]')) openShareSheet(tweetEl.dataset.tweetId);
            else if (target.closest('[data-wv-like]')) toggleLike(tweetEl.dataset.tweetId);
            else if (!tweetEl.classList.contains('wv-main-tweet')) openThread(tweetEl.dataset.tweetId);
            return true;
        }
        return false;
    },

    onShow() {
        // автообновление при заходе — если выбрано в настройках и лента «устарела»
        const data = getPhoneData();
        if (data?.twitterUnseen) {
            data.twitterUnseen = false;
            notifyDataChanged();
        }
        if (data && feedIsStale(data)) refreshFeed();
    },

    onEscape() {
        if (accountsOnEscape()) return true;
        if (shareOnEscape()) return true;
        const thread = el('thread').classList.contains('wv-open');
        const author = el('authorPage').classList.contains('wv-open');
        if (!thread && !author) return false;
        // закрываем верхний
        if (thread && (!author || Number(el('thread').style.zIndex) > Number(el('authorPage').style.zIndex))) closeThread();
        else closeAuthor();
        return true;
    },

    onChatChanged() {
        closeThread();
        closeAuthor();
        resetAccounts();
        closeShareSheet();
    },
};

/** Закрыть шторку и редактор аккаунтов (например, при закрытии телефона) */
export function resetTwitterOverlays() {
    resetAccounts();
}
