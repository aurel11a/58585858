// Ритм ответа как в живом мессенджере: юзер может отправить серию сообщений,
// собеседник ждёт, пока тот допишет, потом «читает» и только после этого печатает ответ.
//   отправил → «Доставлено» → (юзер затих) → «Прочитано» → (пауза на чтение) → ответ
// Пока в поле ввода есть текст — юзер ещё пишет, и отсчёт стоит на паузе.

/** Сколько юзер должен «молчать», прежде чем сообщение прочитают */
const IDLE_MS = 3500;
/** Пауза между «прочитано» и началом печати */
const READ_MIN_MS = 900;
const READ_MAX_MS = 2200;

/** @typedef {'delivered'|'read'} ReceiptState */

export class ReplyPacer {
    /**
     * @param {{ onState: (key: string) => void, onFire: (key: string) => void }} handlers
     */
    constructor({ onState, onFire }) {
        this.onState = onState;
        this.onFire = onFire;
        /** @type {Map<string, ReceiptState>} */
        this.states = new Map();
        /** @type {Map<string, number>} */
        this.timers = new Map();
        /** @type {Set<string>} в поле ввода сейчас есть текст */
        this.writing = new Set();
    }

    /** @returns {ReceiptState|null} */
    state(key) {
        return this.states.get(key) ?? null;
    }

    /** Юзер отправил сообщение */
    sent(key) {
        this.writing.delete(key);
        this.#set(key, 'delivered');
        this.#schedule(key);
    }

    /** Юзер печатает (hasText) или очистил поле */
    typing(key, hasText) {
        if (hasText) this.writing.add(key);
        else this.writing.delete(key);
        if (!this.states.has(key)) return;
        this.#clear(key);
        if (!hasText) this.#schedule(key);
    }

    /** Забыть о чате (ответ пришёл другим путём, чат удалили) */
    reset(key) {
        this.#clear(key);
        this.writing.delete(key);
        if (this.states.delete(key)) this.onState(key);
    }

    #set(key, state) {
        if (this.states.get(key) === state) return;
        this.states.set(key, state);
        this.onState(key);
    }

    #clear(key) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
    }

    #schedule(key) {
        this.#clear(key);
        if (this.writing.has(key)) return;

        if (this.states.get(key) === 'delivered') {
            this.timers.set(key, setTimeout(() => {
                this.#set(key, 'read');
                this.#schedule(key);
            }, IDLE_MS));
            return;
        }

        const pause = READ_MIN_MS + Math.random() * (READ_MAX_MS - READ_MIN_MS);
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            this.states.delete(key);
            this.onState(key);
            this.onFire(key);
        }, pause));
    }
}
