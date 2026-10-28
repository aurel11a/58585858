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

// ---------- длина ответа ----------
// Своих ограничений длины нет: обрезанный JSON просто не разобрать, а думающие модели
// тратят часть лимита на размышления. Просим с большим запасом; если провайдер такой
// потолок не принимает — повторяем с меньшим и запоминаем, какой подошёл.

const TOKEN_LADDER = [32768, 16384, 8192, 4096];
/** ключ API → подошедший потолок */
const workingLimit = new Map();

const apiKey = (api) => (api.mode === 'profile' ? `profile:${api.profileId}` : `manual:${api.endpoint}:${api.model}`);

/** Ошибка именно из-за слишком большого max_tokens / контекста */
function isLimitError(error) {
    const text = [error?.message, error?.cause?.message, error?.cause?.error?.message, JSON.stringify(error?.cause ?? '')].join(' ');
    return /max[_ ]?(output[_ ]?)?tokens|maxOutputTokens|too large|too many tokens|maximum|context[_ ]length|exceeds|must be (less|at most)|out of range/i.test(text);
}

/**
 * Один запрос к выбранному API.
 * @param {{role: string, content: string}[]} messages
 * @param {number} [maxTokens]  только для служебных запросов (проверка связи); обычно не задаётся
 * @returns {Promise<string>}
 */
export async function generate(api, messages, maxTokens) {
    if (maxTokens) return generateOnce(api, messages, maxTokens);
    const key = apiKey(api);
    const known = workingLimit.get(key);
    const ladder = known ? TOKEN_LADDER.filter(n => n <= known) : TOKEN_LADDER;
    let lastError;
    for (const limit of ladder) {
        try {
            const result = await generateOnce(api, messages, limit);
            workingLimit.set(key, limit);
            return result;
        } catch (error) {
            lastError = error;
            if (!isLimitError(error)) throw error;
        }
    }
    throw lastError;
}

async function generateOnce(api, messages, maxTokens) {
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
