// GENERATED FILE — do not edit by hand.
// Source: electron/lib/higgsfieldCatalog.js
// Regenerate with: node scripts/gen-higgsfield-mirror.js

export const HIGGSFIELD_MODELS = [
    {
        "id": "hf-soul-v2",
        "name": "Soul 2",
        "kind": "image",
        "endpoint": "higgsfield-ai/soul/v2/standard",
        "description": "Soul 2, o modelo fotorrealista da própria Higgsfield.",
        "aspectRatios": [
            "9:16",
            "16:9",
            "4:3",
            "3:4",
            "1:1",
            "2:3",
            "3:2"
        ],
        "qualities": [
            "720p",
            "1080p"
        ],
        "featured": true,
        "provider": "higgsfield"
    },
    {
        "id": "hf-soul-cinema",
        "name": "Soul Cinema",
        "kind": "image",
        "endpoint": "higgsfield-ai/soul/cinema",
        "description": "Still cinematográfico. Mais caro por imagem que o Soul 2.",
        "aspectRatios": [
            "9:16",
            "16:9",
            "4:3",
            "3:4",
            "1:1",
            "2:3",
            "3:2"
        ],
        "qualities": [
            "720p",
            "1080p"
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-recraft-41-pro",
        "name": "Recraft V4.1 Pro",
        "kind": "image",
        "endpoint": "recraft/v4.1/pro/text-to-image",
        "description": "Recraft V4.1 Pro — forte em tipografia, vetor e paleta dirigida.",
        "aspectRatios": [
            "1:1",
            "16:9",
            "9:16",
            "4:3",
            "3:4",
            "3:2",
            "2:3"
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-kling-3-t2v",
        "name": "Kling 3.0 (texto → vídeo)",
        "kind": "video",
        "endpoint": "kling-video/v3.0/std/text-to-video",
        "description": "Kling 3.0 standard, com áudio. Movimento consistente.",
        "aspectRatios": [
            "16:9",
            "9:16",
            "1:1"
        ],
        "durations": [
            5,
            10
        ],
        "featured": true,
        "provider": "higgsfield"
    },
    {
        "id": "hf-kling-3-turbo-t2v",
        "name": "Kling 3.0 Turbo (texto → vídeo)",
        "kind": "video",
        "endpoint": "kling-video/v3.0-turbo/text-to-video",
        "description": "Kling Turbo — mais rápido e barato, sem áudio nem multi-shot.",
        "aspectRatios": [
            "16:9",
            "9:16",
            "1:1"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-seedance-25-t2v",
        "name": "Seedance 2.5 (texto → vídeo)",
        "kind": "video",
        "endpoint": "bytedance/seedance-2.5/text-to-video",
        "description": "Seedance 2.5 da ByteDance. O mais caro por segundo, melhor detalhe.",
        "aspectRatios": [
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16",
            "21:9"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-wan-3-t2v",
        "name": "Wan 3.0 (texto → vídeo)",
        "kind": "video",
        "endpoint": "alibaba/wan-3.0/text-to-video",
        "description": "Wan 3.0 da Alibaba — a opção mais barata por segundo, aceita 1080p.",
        "aspectRatios": [
            "adaptive",
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-kling-3-i2v",
        "name": "Kling 3.0 (imagem → vídeo)",
        "kind": "video",
        "endpoint": "kling-video/v3.0/std/image-to-video",
        "description": "Anima uma imagem inicial. Aceita frame final opcional.",
        "needsImage": true,
        "aspectRatios": [
            "16:9",
            "9:16",
            "1:1"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-seedance-25-i2v",
        "name": "Seedance 2.5 (imagem → vídeo)",
        "kind": "video",
        "endpoint": "bytedance/seedance-2.5/image-to-video",
        "description": "Seedance 2.5 animando uma imagem inicial.",
        "needsImage": true,
        "aspectRatios": [
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16",
            "21:9"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    },
    {
        "id": "hf-wan-3-i2v",
        "name": "Wan 3.0 (imagem → vídeo)",
        "kind": "video",
        "endpoint": "alibaba/wan-3.0/image-to-video",
        "description": "Wan 3.0 animando uma imagem inicial. A opção mais barata.",
        "needsImage": true,
        "aspectRatios": [
            "adaptive",
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16"
        ],
        "durations": [
            5,
            10
        ],
        "provider": "higgsfield"
    }
];

export const HIGGSFIELD_IMAGE_MODELS = HIGGSFIELD_MODELS.filter((m) => m.kind === 'image');
export const HIGGSFIELD_VIDEO_MODELS = HIGGSFIELD_MODELS.filter((m) => m.kind === 'video');

export const isHiggsfieldModelId = (id) => HIGGSFIELD_MODELS.some((m) => m.id === id);
export const getHiggsfieldModelById = (id) => HIGGSFIELD_MODELS.find((m) => m.id === id) || null;
