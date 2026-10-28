// Сюжетные дата и время для телефона.
// Источники: Mnema (chatMetadata.mnema_meta) и сам текст сообщений чата.
// Побеждает тот, что взят из более позднего сообщения; ничего не нашли — реальные часы.

import { ctx } from './context.js';
import { getSettings } from './settings.js';
import { getMnemaState } from './mnema.js';

const SCAN_LIMIT = 40;

const MONTHS = new Map([
    ['январь', 1], ['января', 1], ['янв', 1], ['january', 1], ['jan', 1],
    ['февраль', 2], ['февраля', 2], ['фев', 2], ['february', 2], ['feb', 2],
    ['март', 3], ['марта', 3], ['мар', 3], ['march', 3], ['mar', 3],
    ['апрель', 4], ['апреля', 4], ['апр', 4], ['april', 4], ['apr', 4],
    ['май', 5], ['мая', 5], ['may', 5],
    ['июнь', 6], ['июня', 6], ['июн', 6], ['june', 6], ['jun', 6],
    ['июль', 7], ['июля', 7], ['июл', 7], ['july', 7], ['jul', 7],
    ['август', 8], ['августа', 8], ['авг', 8], ['august', 8], ['aug', 8],
    ['сентябрь', 9], ['сентября', 9], ['сен', 9], ['september', 9], ['sep', 9], ['sept', 9],
    ['октябрь', 10], ['октября', 10], ['окт', 10], ['october', 10], ['oct', 10],
    ['ноябрь', 11], ['ноября', 11], ['ноя', 11], ['november', 11], ['nov', 11],
    ['декабрь', 12], ['декабря', 12], ['дек', 12], ['december', 12], ['dec', 12],
]);
const MONTH_RE = [...MONTHS.keys()].sort((a, b) => b.length - a.length).join('|');

// ---------- даты ----------

/** Дата без сюрпризов с годами 0–99 (конструктор Date считает их 1900-ми) */
function makeDate(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (!(y >= 1) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    const date = new Date(2000, 0, 1, 12);
    date.setFullYear(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function dateFromIso(value) {
    const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || ''));
    return match ? makeDate(match[1], match[2], match[3]) : null;
}

function expandYear(raw, anchor) {
    if (raw == null || raw === '') return null;
    const text = String(raw);
    if (text.length !== 2) return Number(text);
    const century = anchor ? Math.floor(anchor.getFullYear() / 100) * 100 : 2000;
    return century + Number(text);
}

/** 14/11/24, 11/14/24: если одно из чисел > 12, оно и есть день; иначе считаем день первым */
function dayMonthOrder(a, b) {
    const x = Number(a), y = Number(b);
    if (x > 12 && y <= 12) return [x, y];
    if (y > 12 && x <= 12) return [y, x];
    return [x, y];
}

/**
 * Все даты в тексте с позицией и «весом»: подписанные (date:, дата:) важнее,
 * с явным годом важнее, чем без него.
 * @returns {{ date: Date, index: number, weight: number }[]}
 */
function findDates(text, anchor) {
    const found = [];
    const yearOr = (raw) => expandYear(raw, anchor) ?? anchor?.getFullYear() ?? new Date().getFullYear();
    const labelled = (index) => /(?:date|дата|день)\s*[:：=]\s*$/iu.test(text.slice(Math.max(0, index - 12), index));
    const add = (match, date, explicitYear) => {
        if (!date) return;
        found.push({ date, index: match.index, weight: (labelled(match.index) ? 2 : 0) + (explicitYear ? 1 : 0) });
    };

    for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(m, makeDate(m[1], m[2], m[3]), true);
    for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\b/g)) {
        const [day, month] = dayMonthOrder(m[1], m[2]);
        add(m, makeDate(expandYear(m[3], anchor), month, day), true);
    }
    const yearPart = '(?:,?\\s*(\\d{3,4})(?:\\s*(?:г\\.?|года?))?)?';
    for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:-?(?:го|е|st|nd|rd|th))?\\s+(${MONTH_RE})\\.?${yearPart}`, 'giu'))) {
        add(m, makeDate(yearOr(m[3]), MONTHS.get(m[2].toLowerCase()), m[1]), Boolean(m[3]));
    }
    for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${yearPart}`, 'giu'))) {
        add(m, makeDate(yearOr(m[3]), MONTHS.get(m[1].toLowerCase()), m[2]), Boolean(m[3]));
    }
    return found;
}

// ---------- время ----------

function normalizeClock(hours, minutes, meridiem = '') {
    let h = Number(hours);
    const m = Number(minutes);
    const ampm = meridiem.toLowerCase().replace(/[^ap]/g, '');
    if (ampm) {
        if (h < 1 || h > 12) return null;
        if (ampm === 'p' && h !== 12) h += 12;
        if (ampm === 'a' && h === 12) h = 0;
    }
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Время в тексте. Вес: подписанное (time:, время:) > в заголовке-теге [..] или **..** > 12-часовое > просто ЧЧ:ММ.
 * @returns {{ clock: string, index: number, weight: number }[]}
 */
function findTimes(text) {
    const found = [];
    const re = /\b(\d{1,2})[:.](\d{2})(?!\d|[.:/]\d)(?:\s*([AaPp]\.?\s*[Mm]\b\.?))?/g;
    for (const m of text.matchAll(re)) {
        // хвост даты вроде «14.11.24» или «20/11» — не время
        if (/[\d./]$/.test(text.slice(0, m.index))) continue;
        const clock = normalizeClock(m[1], m[2], m[3] ?? '');
        if (!clock) continue;
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        const labelled = /(?:time|время|час)\s*[:：=]\s*$/iu.test(before);
        // «3.15» без подписи — скорее число или дата, чем время
        if (m[0][m[1].length] === '.' && !labelled) continue;
        let weight = 1;
        if (labelled) weight = 4;
        else if (/(?:\[[^\]\n]*|\*\*[^*\n]*)$/.test(before)) weight = 3;
        else if (m[3]) weight = 2;
        found.push({ clock, index: m.index, weight });
    }
    return found;
}

const best = (items) => items.reduce((top, item) => (!top || item.weight > top.weight ? item : top), null);

// ---------- источники ----------

function readMnema() {
    const meta = getMnemaState();
    if (!meta) return { date: null, time: null };
    const date = dateFromIso(meta.calendar?.currentDate);
    const clock = /^\d{2}:\d{2}$/.test(meta.world?.clock || '') ? meta.world.clock : null;
    // без номера сообщения значение «старше» любого найденного в тексте
    const rank = (index) => (Number.isInteger(index) ? index : -1);
    return {
        date: date ? { value: date, rank: rank(meta.calendar.sourceMessageIndex), source: 'mnema' } : null,
        time: clock ? { value: clock, rank: rank(meta.world.clockIndex), source: 'mnema' } : null,
    };
}

let cache = { key: '', result: null };

/** Самые свежие дата и время из текста последних сообщений */
function readChat(anchor) {
    const { chat, chatId } = ctx();
    if (!Array.isArray(chat) || !chat.length) return { date: null, time: null };

    const last = chat[chat.length - 1];
    const key = `${chatId}|${chat.length}|${last?.swipe_id}|${anchor?.getTime()}|${last?.mes}`;
    if (cache.key === key) return cache.result;

    let date = null, time = null;
    for (let i = chat.length - 1; i >= Math.max(0, chat.length - SCAN_LIMIT) && !(date && time); i--) {
        const message = chat[i];
        if (!message?.mes || message.is_system) continue;
        const text = String(message.mes);
        if (!date) {
            const hit = best(findDates(text, anchor));
            if (hit) date = { value: hit.date, rank: i, source: 'chat' };
        }
        if (!time) {
            const hit = best(findTimes(text));
            if (hit) time = { value: hit.clock, rank: i, source: 'chat' };
        }
    }

    cache = { key, result: { date, time } };
    return cache.result;
}

/** Сбросить кэш разбора (после правки/удаления сообщений) */
export function invalidateStoryClock() {
    cache = { key: '', result: null };
}

const fresher = (a, b) => (!a ? b : !b ? a : b.rank >= a.rank ? b : a);

/**
 * @typedef {object} StoryClock
 * @property {Date} date              дата для отображения (сюжетная или сегодняшняя)
 * @property {string} time            ЧЧ:ММ
 * @property {'mnema'|'chat'|'real'} dateSource
 * @property {'mnema'|'chat'|'real'} timeSource
 */

/** @returns {StoryClock} */
export function getStoryClock() {
    const now = new Date();
    const real = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (!getSettings().storyClock || !ctx().chatId) {
        return { date: now, time: real, dateSource: 'real', timeSource: 'real' };
    }

    const mnema = readMnema();
    const chat = readChat(mnema.date?.value ?? null);
    const date = fresher(mnema.date, chat.date);
    const time = fresher(mnema.time, chat.time);

    return {
        date: date?.value ?? now,
        time: time?.value ?? real,
        dateSource: date?.source ?? 'real',
        timeSource: time?.source ?? 'real',
    };
}

/** Сюжетный «сейчас» одним объектом Date — пригодится для времени твитов и сообщений */
export function getStoryNow() {
    const { date, time } = getStoryClock();
    const result = new Date(date);
    const [h, m] = time.split(':').map(Number);
    result.setHours(h, m, 0, 0);
    return result;
}
