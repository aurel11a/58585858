// Голосовые сообщения. Звука нет: модель пишет расшифровку разговорной речью
// (паузы, «эм», вздохи, кашель), а телефон рисует её как голосовое с волной и длительностью.

/** Кусок правил для промптов ответа/инициативы */
export const VOICE_RULE = `Sometimes a person sends a VOICE MESSAGE instead of typing — only when it fits them and the moment (a long or emotional thought, they're busy, driving, lazy to type, want to sound warm or angry). Not often. A voice message is written as {"voice": "..."}: a transcript of natural SPEECH, not text — filler words, false starts, pauses (…), and sounds in parentheses like (sighs), (laughs), (coughs), (clears throat), (background noise). No emoji in voice messages.`;

/**
 * Привести элемент ответа модели к сообщению.
 * Строка — обычный текст, {"voice": "..."} — голосовое, {"text": "..."} — текст.
 * @returns {{ text: string, voice: boolean } | null}
 */
export function normalizeEntry(item) {
    if (typeof item === 'string') return item.trim() ? { text: item.trim(), voice: false } : null;
    const voice = String(item?.voice ?? '').trim();
    if (voice) return { text: voice, voice: true };
    const text = String(item?.text ?? '').trim();
    return text ? { text, voice: false } : null;
}

/** Длительность «записи» по расшифровке: ~2.5 слова в секунду плюс паузы и звуки */
export function voiceDuration(text) {
    const words = String(text).split(/\s+/).filter(Boolean).length;
    const pauses = (String(text).match(/…|\.\.\.|\(/g) ?? []).length;
    return Math.max(2, Math.round(words / 2.5 + pauses * 0.7));
}

export const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Высоты полосок волны — стабильные для одного сообщения (от его id), без случайного дрожания при перерисовке */
export function waveform(seed, bars = 28) {
    let hash = 0;
    for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const heights = [];
    for (let i = 0; i < bars; i++) {
        hash = (hash * 1103515245 + 12345) | 0;
        const noise = ((hash >>> 16) & 0xff) / 255;
        // огибающая: тише по краям, громче в середине
        const envelope = 0.45 + 0.55 * Math.sin(Math.PI * (i + 0.5) / bars);
        heights.push(Math.round(18 + 82 * noise * envelope));
    }
    return heights;
}

/** Как голосовое выглядит в истории для модели */
export const historyText = (message) => (message.voice ? `[voice message] ${message.text}` : message.text);
