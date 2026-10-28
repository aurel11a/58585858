// Экстра-API для генерации контента телефона.
// Два режима:
//   profile — профиль подключения таверны (Connection Manager)
//   manual  — свой OpenAI-совместимый эндпоинт; запросы идут через бэкенд таверны
//             (источник "custom"), поэтому CORS провайдера не мешает.

const ctx = () => SillyTavern.getContext();

export const defaultApiSettings = Object.freeze({
    mode: 'profile',
    profileId: '',
    endpoint: '',
    key: '',
    model: '',
    models: [],
});

/** Заголовки для custom-источника: таверна мёржит их поверх своих, JSON — валидный YAML */
function authHeaders(key) {
    return key ? JSON.stringify({ Authorization: `Bearer ${key}` }) : '';
}

function normalizeEndpoint(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

export function isConnectionManagerAvailable() {
    return !ctx().extensionSettings.disabledExtensions.includes('connection-manager');
}

/** @returns {{id: string, name: string}[]} */
export function listProfiles() {
    if (!isConnectionManagerAvailable()) return [];
    try {
        return ctx().ConnectionManagerRequestService.getSupportedProfiles().map(p => ({ id: p.id, name: p.name }));
    } catch {
        return [];
    }
}

/**
 * Список моделей эндпоинта.
 * @returns {Promise<string[]>}
 */
export async function fetchModels(endpoint, key) {
    const url = normalizeEndpoint(endpoint);
    if (!url) throw new Error('no-endpoint');

    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: url,
            custom_include_headers: authHeaders(key),
        }),
    });

    const data = await response.json().catch(() => ({}));
    // таверна при недоступном эндпоинте отвечает 200 с { error: true } без текста
    if (!response.ok || data?.error) throw new Error(data?.message || 'unreachable');

    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list.map(m => m?.id ?? m?.name ?? m).filter(m => typeof m === 'string').sort((a, b) => a.localeCompare(b));
}

/**
 * Один запрос к выбранному API.
 * @param {{role: string, content: string}[]} messages
 * @param {number} [maxTokens]
 * @returns {Promise<string>}
 */
export async function generate(api, messages, maxTokens = 600) {
    if (api.mode === 'profile') {
        if (!api.profileId) throw new Error('no-profile');
        const result = await ctx().ConnectionManagerRequestService.sendRequest(api.profileId, messages, maxTokens, {
            stream: false,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        return String(/** @type {any} */ (result)?.content ?? '').trim();
    }

    const url = normalizeEndpoint(api.endpoint);
    if (!url) throw new Error('no-endpoint');
    if (!api.model) throw new Error('no-model');

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: url,
            custom_include_headers: authHeaders(api.key),
            model: api.model,
            messages,
            max_tokens: maxTokens,
            temperature: 1,
            stream: false,
        }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
        throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    }
    return String(data?.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * Проверка: короткий запрос «ответь OK». Успех = запрос прошёл без ошибки
 * (у думающих моделей текст может прийти пустым, это не провал).
 * @returns {Promise<{ms: number, reply: string}>}
 */
export async function testConnection(api) {
    const started = performance.now();
    const reply = await generate(api, [{ role: 'user', content: 'Reply with the single word: OK' }], 64);
    return { ms: Math.round(performance.now() - started), reply };
}
