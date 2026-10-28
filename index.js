// Wavey — телефон для ролевой. Точка входа: только сборка частей из src/.

import { ctx, LOG } from './src/core/context.js';
import { getSettings } from './src/core/settings.js';
import { detectLanguage, getLanguage } from './src/i18n.js';
import { clampIntoView } from './src/ui/drag.js';
import { getRoot } from './src/ui/dom.js';
import { createPhone, isPhoneOpen, onChatChanged, onStoryChanged, openApp } from './src/phone.js';
import { addExtensionSettings, addWandButton, createFab, updateFabDot } from './src/launchers.js';
import { maybeInitiate } from './src/apps/messages/initiative.js';
import { isChatOpen } from './src/apps/messages/index.js';
import { initInChat } from './src/inchat/index.js';
import { initBuzz } from './src/buzz/index.js';
import { initMemo } from './src/apps/messages/memo.js';
import { openTweetThread } from './src/apps/twitter/index.js';

(function init() {
    const { eventSource, eventTypes, getCurrentLocale } = ctx();
    detectLanguage(getCurrentLocale?.() ?? localStorage.getItem('language'));

    getSettings();
    createPhone();
    createFab();
    addWandButton();
    addExtensionSettings();
    initInChat();
    initMemo();
    // пересланный твит в чате → его ветка в твиттере
    document.addEventListener('wavey:open-tweet', (e) => {
        openApp('twitter');
        openTweetThread(/** @type {CustomEvent} */ (e).detail.id);
    });
    initBuzz({
        openTweet: (tweetId) => {
            openApp('twitter');
            openTweetThread(tweetId);
        },
    });

    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        onChatChanged();
        updateFabDot();
    });
    // история продвинулась — кто-то из контактов может написать первым
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => maybeInitiate(isChatOpen));
    for (const type of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
        if (eventTypes[type]) eventSource.on(eventTypes[type], onStoryChanged);
    }
    window.addEventListener('resize', () => {
        if (isPhoneOpen()) clampIntoView(getRoot());
    });

    console.log(`${LOG} loaded (${getLanguage()})`);
})();
