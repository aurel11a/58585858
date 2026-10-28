// Переписки внутри сообщений ролевой. Формат (одно сообщение — одна строка):
//   (in) Отправитель | текст    — владелец телефона получил
//   (out) Получатель | текст    — владелец телефона отправил
// Владелец телефона — персонаж, который ведёт сообщение. Переписка «с юзером» —
// если в строках стоит имя юзера: (out) Юзер | … — персонаж пишет юзеру, (in) Юзер | … — юзер ему.

import { toLatin } from '../core/format.js';

const LINE_RE = /^\s*[*_~]*\(\s*(in|out)\s*\)[*_~]*\s*([^|\n]+?)\s*\|\s*(.*?)\s*$/i;

/**
 * @typedef {{ dir: 'in'|'out', name: string, text: string }} PhoneLine
 * @typedef {{ start: number, end: number, lines: PhoneLine[] }} PhoneBlock  start/end — номера строк текста (end включительно)
 */

export function parseLine(line) {
    const match = LINE_RE.exec(line);
    if (!match || !match[3]) return null;
    return { dir: /** @type {'in'|'out'} */ (match[1].toLowerCase()), name: match[2].replace(/[*_~]+/g, '').trim(), text: match[3].replace(/[*_~]+$/, '').trim() };
}

/**
 * Блоки подряд идущих строк-сообщений. Пустые строки внутри блока не рвут его,
 * если дальше снова идёт строка-сообщение.
 * @returns {PhoneBlock[]}
 */
export function parseBlocks(text) {
    const rows = String(text ?? '').split('\n');
    const blocks = [];
    let current = null;

    for (let i = 0; i < rows.length; i++) {
        const parsed = parseLine(rows[i]);
        if (parsed) {
            if (!current) current = { start: i, end: i, lines: [] };
            current.lines.push(parsed);
            current.end = i;
            continue;
        }
        if (current && rows[i].trim() === '') continue;
        if (current) blocks.push(current);
        current = null;
    }
    if (current) blocks.push(current);
    return blocks;
}

const nameKey = (name) => toLatin(String(name ?? '').trim()).replace(/[^a-z0-9]+/g, '');
const firstKey = (name) => nameKey(String(name ?? '').trim().split(/\s+/)[0]);

/** Это имя юзера? Без регистра, через транслит, по полному или первому имени */
export function isUserName(name, userName) {
    const full = nameKey(name);
    if (!full || !nameKey(userName)) return false;
    if (full === nameKey(userName) || full === firstKey(userName)) return true;
    const first = firstKey(name);
    return first.length >= 3 && first === firstKey(userName);
}

/** Переписка в блоке ведётся с юзером? */
export const isUserBlock = (block, userName) => block.lines.some(line => isUserName(line.name, userName));

/**
 * Вставить строки после блока номер blockIndex и вернуть новый текст.
 * @param {string} text
 * @param {number} blockIndex
 * @param {string[]} newLines
 */
export function appendToBlock(text, blockIndex, newLines) {
    const rows = String(text ?? '').split('\n');
    const block = parseBlocks(text)[blockIndex];
    if (!block) return text;
    rows.splice(block.end + 1, 0, ...newLines);
    return rows.join('\n');
}

export const formatLine = (dir, name, message) => `(${dir}) ${name} | ${String(message).replace(/\s*\n\s*/g, ' ').trim()}`;

// ---------- продолжение переписки ----------
// То, что юзер и персонаж дописали в окошке, идёт не внутрь блока модели, а отдельным
// приложением в самом конце сообщения — чтобы модель не приняла это за свой текст:
//   [Text chat that followed between Nolan and Loulou:]
//   Loulou: ты где?
//   Nolan: omw

const APPENDIX_RE = /^\s*\[Text chat that followed between (.+?) and (.+?):\]\s*$/;
const ENTRY_RE = /^\s*([^:\n[\]]{1,60}?):\s+(.+?)\s*$/;

export const appendixHeader = (owner, user) => `[Text chat that followed between ${owner} and ${user}:]`;

const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' ').trim();

/**
 * @typedef {{ from: 'user'|'owner', text: string }} AppendixEntry
 * @returns {{ start: number, end: number, entries: AppendixEntry[] } | null} start — строка заголовка, end — последняя реплика
 */
export function parseAppendix(text, userName) {
    const rows = String(text ?? '').split('\n');
    let start = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
        if (APPENDIX_RE.test(rows[i])) { start = i; break; }
    }
    if (start < 0) return null;

    const entries = [];
    let end = start;
    for (let i = start + 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        const match = ENTRY_RE.exec(rows[i]);
        if (!match) break;
        entries.push({ from: isUserName(match[1], userName) ? 'user' : 'owner', text: match[2] });
        end = i;
    }
    return { start, end, entries };
}

/** Текст без приложения (для отрисовки — его реплики рисуются внутри окошка) */
export function stripAppendix(text, userName) {
    const appendix = parseAppendix(text, userName);
    if (!appendix) return { text, entries: [] };
    const rows = String(text).split('\n');
    rows.splice(appendix.start, appendix.end - appendix.start + 1);
    return { text: rows.join('\n').replace(/\n+$/, ''), entries: appendix.entries };
}

/** Дописать реплики в приложение (создаёт его в конце сообщения, если ещё нет) */
export function appendToAppendix(text, owner, user, items) {
    const lines = items.map(item => `${item.from === 'user' ? user : owner}: ${oneLine(item.text)}`);
    const appendix = parseAppendix(text, user);
    const rows = String(text ?? '').split('\n');
    if (appendix) {
        rows.splice(appendix.end + 1, 0, ...lines);
        return rows.join('\n');
    }
    return `${String(text ?? '').replace(/\s+$/, '')}\n\n${appendixHeader(owner, user)}\n${lines.join('\n')}`;
}

/** Убрать последние реплики юзера (недоставленные); пустое приложение уходит целиком */
export function removeFromAppendix(text, user, texts) {
    const appendix = parseAppendix(text, user);
    if (!appendix) return text;
    const rows = String(text).split('\n');
    let end = appendix.end;
    for (const message of [...texts].reverse()) {
        const line = `${user}: ${oneLine(message)}`;
        for (let i = end; i > appendix.start; i--) {
            if (rows[i].trim() === line) {
                rows.splice(i, 1);
                end--;
                break;
            }
        }
    }
    const left = rows.slice(appendix.start + 1, end + 1).some(row => row.trim());
    if (!left) {
        rows.splice(appendix.start, end - appendix.start + 1);
        return rows.join('\n').replace(/\n+$/, '');
    }
    return rows.join('\n');
}
