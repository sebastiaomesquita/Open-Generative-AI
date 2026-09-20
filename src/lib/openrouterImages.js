// OpenRouter image generation for the renderer.
//
// It deliberately reuses the credential from the Prompt LLM settings: one
// OpenRouter key pays for rewriting the prompt and for rendering it, so the
// user fills a single field.
//
// Electron's file:// renderer calls the upstream directly, the same way
// lib/muapi.js does; there is no proxy in front of this.

import { getLlmSettings } from './promptLlm.js';
import { getOpenrouterModelById } from './openrouterModels.js';

const IMAGES_URL = 'https://openrouter.ai/api/v1/images';

export function getOpenrouterKey() {
    return getLlmSettings().apiKey || '';
}

export const isOpenrouterConfigured = () => Boolean(getOpenrouterKey());

function describeHttpError(status, detail) {
    const hints = {
        401: 'chave recusada',
        402: 'sem crédito na conta OpenRouter',
        403: 'bloqueado pela moderação',
        404: 'modelo desconhecido',
        429: 'limite de taxa atingido',
    };
    return `OpenRouter HTTP ${status}${hints[status] ? ` (${hints[status]})` : ''}${detail ? `: ${detail}` : ''}`;
}

/** Returns { url, cost, model } where url is a data: URI ready for <img>. */
export async function generateImage({ model, prompt, referenceUrls = [], signal } = {}) {
    const clean = String(prompt || '').trim();
    if (!clean) throw new Error('Escreva um prompt antes de gerar.');

    const key = getOpenrouterKey();
    if (!key) throw new Error('Nenhuma chave OpenRouter salva. Configure em Settings → Prompt LLM.');

    const body = { model: model || 'google/gemini-2.5-flash-image', prompt: clean };
    const refs = referenceUrls.filter(Boolean).map((url) => ({ type: 'image_url', image_url: { url } }));
    if (refs.length) body.input_references = refs;

    const res = await fetch(IMAGES_URL, {
        method: 'POST',
        signal,
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/Anil-matcha/Open-Generative-AI',
            'X-Title': 'Open Generative AI',
        },
        body: JSON.stringify(body),
    });

    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }

    if (!res.ok) throw new Error(describeHttpError(res.status, payload?.error?.message || ''));

    const item = payload?.data?.[0];
    if (!item) throw new Error('OpenRouter não devolveu imagem.');

    const url = item.b64_json
        ? `data:${item.media_type || 'image/png'};base64,${item.b64_json}`
        : item.url;
    if (!url) throw new Error('OpenRouter devolveu a imagem num formato não suportado.');

    return {
        url,
        cost: Number(payload?.usage?.cost) || 0,
        model: body.model,
        modelName: getOpenrouterModelById(body.model)?.name || body.model,
    };
}
