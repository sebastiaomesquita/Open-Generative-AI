// Prompt enhancement through any OpenAI-compatible chat endpoint.
// Default is OpenRouter; Ollama (http://localhost:11434/v1) and LM Studio
// (http://localhost:1234/v1) work with the same code path and need no key.

export const LLM_KEYS = {
    baseUrl: 'llm_base_url',
    apiKey: 'llm_api_key',
    model: 'llm_model',
};

export const LLM_DEFAULTS = {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4-flash',
};

const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

export function normalizeBaseUrl(url) {
    let u = String(url || '').trim();
    if (!u) return LLM_DEFAULTS.baseUrl;
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/i, '');
    return u;
}

export function isLocalEndpoint(baseUrl) {
    return LOCAL_HOST_RE.test(String(baseUrl || ''));
}

function storageOf(storage) {
    if (storage) return storage;
    return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function getLlmSettings(storage) {
    const s = storageOf(storage);
    const read = (k) => (s?.getItem(k) || '').trim();
    return {
        baseUrl: normalizeBaseUrl(read(LLM_KEYS.baseUrl)),
        apiKey: read(LLM_KEYS.apiKey),
        model: read(LLM_KEYS.model) || LLM_DEFAULTS.model,
    };
}

export function saveLlmSettings({ baseUrl, apiKey, model }, storage) {
    const s = storageOf(storage);
    if (!s) return;
    s.setItem(LLM_KEYS.baseUrl, normalizeBaseUrl(baseUrl));
    s.setItem(LLM_KEYS.apiKey, String(apiKey || '').trim());
    s.setItem(LLM_KEYS.model, String(model || '').trim() || LLM_DEFAULTS.model);
}

// A local server (Ollama / LM Studio) is usable without a key.
export function isLlmConfigured(settings) {
    const s = settings || getLlmSettings();
    return Boolean(s.apiKey) || isLocalEndpoint(s.baseUrl);
}

const SYSTEM_PROMPTS = {
    image: `You are a prompt engineer for AI image generation models (Flux, SDXL, Stable Diffusion, Nano Banana, Midjourney).
Rewrite the user's idea into ONE vivid, concrete prompt in English covering: subject, setting, composition, lighting, color palette, style or medium, camera and lens when photographic.
Preserve the user's intent, named people or brands, any text that must appear in the image, and any technical parameters they wrote.
Length: 40 to 90 words. Output ONLY the prompt: no title, no quotes, no alternatives, no explanations.`,
    video: `You are a prompt engineer for AI video generation models (Kling, Veo, Sora, Wan, Seedance, Runway).
Rewrite the user's idea into ONE vivid, concrete prompt in English covering: subject and action, setting, camera movement (push-in, pan, orbit, handheld...), shot type, lighting, mood, pacing.
Preserve the user's intent, named people or brands, any on-screen text, and any technical parameters they wrote. Describe motion, not a still.
Length: 40 to 90 words. Output ONLY the prompt: no title, no quotes, no alternatives, no explanations.`,
};

export function buildMessages(prompt, kind = 'image') {
    return [
        { role: 'system', content: SYSTEM_PROMPTS[kind] || SYSTEM_PROMPTS.image },
        { role: 'user', content: String(prompt || '').trim() },
    ];
}

function stripQuotes(text) {
    const t = String(text || '').trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) return t.slice(1, -1).trim();
    return t;
}

// Tolerates reasoning models (<think> blocks), wrapping quotes and "Prompt:" prefixes.
export function extractEnhancedPrompt(json) {
    const msg = json?.choices?.[0]?.message;
    let text = typeof msg?.content === 'string'
        ? msg.content
        : Array.isArray(msg?.content) ? msg.content.map((p) => p?.text || '').join('') : '';
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = stripQuotes(text);
    text = text.replace(/^(enhanced\s+)?prompt\s*:\s*/i, '').trim();
    return stripQuotes(text);
}

function describeHttpError(status, body) {
    const detail = body?.error?.message || body?.message || body?.error || '';
    if (status === 401 || status === 403) return `Invalid or missing API key (HTTP ${status}). ${detail}`.trim();
    if (status === 402) return `Insufficient credits (HTTP 402). ${detail}`.trim();
    if (status === 404) return `Model or endpoint not found (HTTP 404). ${detail}`.trim();
    if (status === 429) return `Rate limited (HTTP 429). ${detail}`.trim();
    return `HTTP ${status}. ${detail}`.trim();
}

export async function enhancePrompt(prompt, {
    kind = 'image',
    settings,
    fetchImpl,
    timeoutMs = 45_000,
    signal,
} = {}) {
    const clean = String(prompt || '').trim();
    if (!clean) throw new Error('Prompt is empty.');

    const s = settings || getLlmSettings();
    if (!isLlmConfigured(s)) throw new Error('Prompt LLM is not configured.');

    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('fetch is not available.');

    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;
    if (/openrouter\.ai/i.test(s.baseUrl)) {
        headers['HTTP-Referer'] = 'https://github.com/Anil-matcha/Open-Generative-AI';
        headers['X-Title'] = 'Open Generative AI';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    let res;
    try {
        res = await doFetch(`${s.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: s.model,
                messages: buildMessages(clean, kind),
                temperature: 0.7,
                max_tokens: 400,
            }),
        });
    } catch (err) {
        clearTimeout(timer);
        if (err?.name === 'AbortError') throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s.`);
        throw new Error(`Network error: ${err?.message || err}`);
    }
    clearTimeout(timer);

    let body = null;
    try { body = await res.json(); } catch { body = null; }

    if (!res.ok) throw new Error(describeHttpError(res.status, body));

    const text = extractEnhancedPrompt(body);
    if (!text) throw new Error('The model returned an empty response.');
    return text;
}
