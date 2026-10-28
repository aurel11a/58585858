// Мягкая синхронизация с Mnema. Её может не быть вовсе — тогда всё возвращает пустоту.

import { ctx } from './context.js';

const MNEMA_KEY = 'mnema_meta';

export function mnemaEnabled() {
    const disabled = ctx().extensionSettings.disabledExtensions ?? [];
    return !disabled.some(name => /(^|\/)mnema$/i.test(name));
}

/** Состояние Mnema для текущего чата или null */
export function getMnemaState() {
    if (!mnemaEnabled()) return null;
    const state = ctx().chatMetadata?.[MNEMA_KEY];
    return state && typeof state === 'object' ? state : null;
}

/**
 * Люди истории, которых знает Mnema (без выбывших).
 * @returns {{ name: string, relation: string }[]}
 */
export function getMnemaPeople() {
    const cast = getMnemaState()?.cast;
    if (!Array.isArray(cast)) return [];
    return cast
        .filter(member => member?.name && !member.gone)
        .map(member => ({
            name: String(member.name).trim(),
            relation: String(member.toUser || member.howUser || member.relation || member.role || '').trim(),
        }));
}

/** Кем человек приходится юзеру по версии Mnema (для подсказки в карточке) */
export function mnemaRelationOf(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return '';
    return getMnemaPeople().find(person => person.name.toLowerCase() === key)?.relation ?? '';
}
