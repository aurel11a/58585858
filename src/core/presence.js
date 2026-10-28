// Кто из контактов «был в сцене»: персонаж знает, что происходило в истории,
// только если его имя встречается в недавних сообщениях или он сам там говорит.

import { ctx } from './context.js';
import { getSettings } from './settings.js';
import { toLatin } from './format.js';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Как контакта могут назвать в тексте: полное имя, первое имя и прозвища в кавычках.
 * «Johnathan "John" Fletcher» → [Johnathan "John" Fletcher, Johnathan, John]
 */
export function nameTokens(contact) {
    const full = String(contact?.name ?? '').trim();
    if (!full) return [];
    const tokens = new Set([full]);
    const first = full.split(/\s+/)[0].replace(/["«»“”']/g, '');
    if (first.length >= 3) tokens.add(first);
    for (const match of full.matchAll(/["«“']([^"»”']{2,})["»”']/g)) tokens.add(match[1].trim());
    return [...tokens];
}

function wordRegex(tokens) {
    // границы слова с учётом кириллицы: \b в JS её не понимает
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Проверка имени как есть и в транслите: «Irina» в карточке = «Ирина» в русском тексте */
function mentionTest(contact) {
    const tokens = nameTokens(contact);
    if (!tokens.length) return null;
    const direct = wordRegex(tokens);
    const latin = wordRegex([...new Set(tokens.map(toLatin))]);
    return (text) => direct.test(text) || latin.test(toLatin(text));
}

/**
 * Последние сообщения истории, сколько разрешено в настройках (0 — не отправлять вовсе).
 * @returns {{ name: string, text: string, isUser: boolean }[]}
 */
export function storyWindow() {
    const limit = Math.max(0, Number(getSettings().storyContext) || 0);
    if (!limit) return [];
    const { chat, name1 } = ctx();
    return (chat ?? [])
        .filter(m => m?.mes && !m.is_system)
        .slice(-limit)
        .map(m => ({ name: m.is_user ? name1 : m.name, text: String(m.mes).trim(), isUser: Boolean(m.is_user) }));
}

/** Был ли контакт в этих сообщениях: говорил сам или его назвали */
export function isPresent(contact, window) {
    const test = mentionTest(contact);
    if (!test) return false;
    return window.some(m => (!m.isUser && test(m.name)) || test(m.text));
}

export function formatStory(window) {
    return window.map(m => `${m.name}: ${m.text}`).join('\n\n');
}
