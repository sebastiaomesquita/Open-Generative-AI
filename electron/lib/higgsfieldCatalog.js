// Catalogue of Higgsfield API endpoints exposed as models inside the studio.
//
// Single source of truth: the renderer gets a serialisable copy (see
// scripts/gen-higgsfield-mirror.js), so the input builders never leave the
// main process and the two catalogues cannot drift.
//
// Field names and allowed values come from the per-model pages at
// docs.higgsfield.ai (which the docs themselves declare authoritative over
// openapi.json). Notes worth keeping in mind while editing:
//   - `negative_prompt` does not exist on any of these models.
//   - Kling / Seedance / Minimax do not take a `seed`; Soul and Wan do.
//   - image-to-video takes `image_url` as a plain string, not an array, and
//     drops `aspect_ratio` (the source frame decides it).
//   - every *_url must be a public HTTPS URL; data URIs are not supported.

const clampInt = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const seedOrUndefined = (seed, max) => {
    const n = Math.round(Number(seed));
    return Number.isFinite(n) && n > 0 ? Math.min(max, n) : undefined;
};

const SOUL_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'];
const KLING_RATIOS = ['16:9', '9:16', '1:1'];
const SEEDANCE_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const WAN_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'];

const CATALOG = [
    // ── Imagem ────────────────────────────────────────────────────────────
    {
        id: 'hf-soul-v2',
        name: 'Soul 2',
        kind: 'image',
        endpoint: 'higgsfield-ai/soul/v2/standard',
        description: 'Soul 2, o modelo fotorrealista da própria Higgsfield.',
        aspectRatios: SOUL_RATIOS,
        qualities: ['720p', '1080p'],
        featured: true,
        buildInput: (p) => ({
            prompt: p.prompt,
            aspect_ratio: pick(p.aspect_ratio, SOUL_RATIOS, '4:3'),
            resolution: pick(p.quality, ['720p', '1080p'], '1080p'),
            batch_size: 1,
            enhance_prompt: false,
            ...(seedOrUndefined(p.seed, 1000000) ? { seed: seedOrUndefined(p.seed, 1000000) } : {}),
        }),
    },
    {
        id: 'hf-soul-cinema',
        name: 'Soul Cinema',
        kind: 'image',
        endpoint: 'higgsfield-ai/soul/cinema',
        description: 'Still cinematográfico. Mais caro por imagem que o Soul 2.',
        aspectRatios: SOUL_RATIOS,
        qualities: ['720p', '1080p'],
        buildInput: (p) => ({
            prompt: p.prompt,
            aspect_ratio: pick(p.aspect_ratio, SOUL_RATIOS, '16:9'),
            resolution: pick(p.quality, ['720p', '1080p'], '1080p'),
            batch_size: 1,
            enhance_prompt: false,
            ...(seedOrUndefined(p.seed, 1000000) ? { seed: seedOrUndefined(p.seed, 1000000) } : {}),
        }),
    },
    {
        id: 'hf-recraft-41-pro',
        name: 'Recraft V4.1 Pro',
        kind: 'image',
        endpoint: 'recraft/v4.1/pro/text-to-image',
        description: 'Recraft V4.1 Pro — forte em tipografia, vetor e paleta dirigida.',
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
        buildInput: (p) => ({
            prompt: p.prompt,
            aspect_ratio: pick(p.aspect_ratio, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], '1:1'),
            output_format: 'png',
        }),
    },

    // ── Vídeo: texto → vídeo ──────────────────────────────────────────────
    {
        id: 'hf-kling-3-t2v',
        name: 'Kling 3.0 (texto → vídeo)',
        kind: 'video',
        endpoint: 'kling-video/v3.0/std/text-to-video',
        description: 'Kling 3.0 standard, com áudio. Movimento consistente.',
        aspectRatios: KLING_RATIOS,
        durations: [5, 10],
        featured: true,
        buildInput: (p) => ({
            prompt: p.prompt,
            duration: clampInt(p.duration, 5, 3, 15),
            aspect_ratio: pick(p.aspect_ratio, KLING_RATIOS, '16:9'),
            sound: 'on',
        }),
    },
    {
        id: 'hf-kling-3-turbo-t2v',
        name: 'Kling 3.0 Turbo (texto → vídeo)',
        kind: 'video',
        endpoint: 'kling-video/v3.0-turbo/text-to-video',
        description: 'Kling Turbo — mais rápido e barato, sem áudio nem multi-shot.',
        aspectRatios: KLING_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            prompt: p.prompt,
            duration: clampInt(p.duration, 5, 3, 15),
            aspect_ratio: pick(p.aspect_ratio, KLING_RATIOS, '16:9'),
            resolution: pick(p.quality, ['720p', '1080p'], '720p'),
        }),
    },
    {
        id: 'hf-seedance-25-t2v',
        name: 'Seedance 2.5 (texto → vídeo)',
        kind: 'video',
        endpoint: 'bytedance/seedance-2.5/text-to-video',
        description: 'Seedance 2.5 da ByteDance. O mais caro por segundo, melhor detalhe.',
        aspectRatios: SEEDANCE_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            prompt: p.prompt,
            duration: clampInt(p.duration, 5, 4, 30),
            aspect_ratio: pick(p.aspect_ratio, SEEDANCE_RATIOS, '16:9'),
            resolution: pick(p.quality, ['480p', '720p'], '720p'),
            generate_audio: true,
            output_format: 'mp4',
        }),
    },
    {
        id: 'hf-wan-3-t2v',
        name: 'Wan 3.0 (texto → vídeo)',
        kind: 'video',
        endpoint: 'alibaba/wan-3.0/text-to-video',
        description: 'Wan 3.0 da Alibaba — a opção mais barata por segundo, aceita 1080p.',
        aspectRatios: WAN_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            prompt: p.prompt,
            duration: clampInt(p.duration, 5, 2, 30),
            aspect_ratio: pick(p.aspect_ratio, WAN_RATIOS, 'adaptive'),
            resolution: pick(p.quality, ['480p', '720p', '1080p'], '1080p'),
            generate_audio: true,
            ...(seedOrUndefined(p.seed, 2147483647) ? { seed: seedOrUndefined(p.seed, 2147483647) } : {}),
        }),
    },

    // ── Vídeo: imagem → vídeo ─────────────────────────────────────────────
    // No aspect_ratio here: these endpoints take it from the source frame.
    {
        id: 'hf-kling-3-i2v',
        name: 'Kling 3.0 (imagem → vídeo)',
        kind: 'video',
        endpoint: 'kling-video/v3.0/std/image-to-video',
        description: 'Anima uma imagem inicial. Aceita frame final opcional.',
        needsImage: true,
        aspectRatios: KLING_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            prompt: p.prompt || '',
            image_url: p.image_url,
            duration: clampInt(p.duration, 5, 3, 15),
            sound: 'on',
            ...(p.end_image_url ? { last_image_url: p.end_image_url } : {}),
        }),
    },
    {
        id: 'hf-seedance-25-i2v',
        name: 'Seedance 2.5 (imagem → vídeo)',
        kind: 'video',
        endpoint: 'bytedance/seedance-2.5/image-to-video',
        description: 'Seedance 2.5 animando uma imagem inicial.',
        needsImage: true,
        aspectRatios: SEEDANCE_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            ...(String(p.prompt || '').trim() ? { prompt: p.prompt.trim() } : {}),
            image_url: p.image_url,
            duration: clampInt(p.duration, 5, 4, 30),
            resolution: pick(p.quality, ['480p', '720p'], '720p'),
            generate_audio: true,
            output_format: 'mp4',
            ...(p.end_image_url ? { end_image_url: p.end_image_url } : {}),
        }),
    },
    {
        id: 'hf-wan-3-i2v',
        name: 'Wan 3.0 (imagem → vídeo)',
        kind: 'video',
        endpoint: 'alibaba/wan-3.0/image-to-video',
        description: 'Wan 3.0 animando uma imagem inicial. A opção mais barata.',
        needsImage: true,
        aspectRatios: WAN_RATIOS,
        durations: [5, 10],
        buildInput: (p) => ({
            prompt: p.prompt || '',
            image_url: p.image_url,
            duration: clampInt(p.duration, 5, 2, 30),
            resolution: pick(p.quality, ['480p', '720p', '1080p'], '1080p'),
            generate_audio: true,
            ...(p.end_image_url ? { end_image_url: p.end_image_url } : {}),
            ...(seedOrUndefined(p.seed, 2147483647) ? { seed: seedOrUndefined(p.seed, 2147483647) } : {}),
        }),
    },
];

function getModelById(id) {
    return CATALOG.find((m) => m.id === id) || null;
}

/** Serialisable view for the renderer: everything except the builders. */
function toPublic() {
    return CATALOG.map(({ buildInput, ...rest }) => ({ ...rest, provider: 'higgsfield' }));
}

function buildInput(id, params) {
    const model = getModelById(id);
    if (!model) throw new Error(`Unknown Higgsfield model: ${id}`);
    if (model.needsImage && !params?.image_url) {
        throw new Error('This model needs a reference image.');
    }
    // Seedance i2v is the only endpoint where the prompt is genuinely optional.
    const promptOptional = model.needsImage;
    if (!promptOptional && !String(params?.prompt || '').trim()) {
        throw new Error('Prompt is required.');
    }
    return model.buildInput(params || {});
}

module.exports = { CATALOG, getModelById, toPublic, buildInput };
