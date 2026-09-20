// Curated snapshot of the OpenRouter image models, so the studio can build its
// picker synchronously at mount.
//
// Prices are per IMAGE, not per token, because that is what a person needs to
// decide. OpenRouter itself bills per output token, and the token count per
// image differs sharply by family: measured on 2026-09-20, Nano Banana spent
// 827 tokens per image while GPT-5 Image Mini spent 6251. So the OpenAI models
// cost far more than their per-token price suggests.
//
// `measured: true` means the figure came from a real generation on this
// machine. The others are derived from the measured token count of their own
// family, so treat them as close but not exact. The true cost of any single
// generation is shown on the button once it finishes.
export const OPENROUTER_IMAGE_MODELS = [
    {
        id: 'google/gemini-2.5-flash-image',
        name: 'Nano Banana',
        approxUsd: 0.025,
        measured: true,
        description: 'O mais barato e o melhor custo-benefício. Padrão.',
        featured: true,
    },
    {
        id: 'openai/gpt-5-image-mini',
        name: 'GPT-5 Image Mini',
        approxUsd: 0.05,
        measured: true,
        description: 'Bom em texto dentro da imagem. Gasta ~7x mais tokens que o Gemini.',
    },
    {
        id: 'google/gemini-3.1-flash-image',
        name: 'Nano Banana 2',
        approxUsd: 0.05,
        description: 'Geração mais recente do Flash Image.',
    },
    {
        id: 'google/gemini-3-pro-image',
        name: 'Nano Banana Pro',
        approxUsd: 0.10,
        description: 'O mais detalhado da família Gemini.',
    },
    {
        id: 'openai/gpt-5-image',
        name: 'GPT-5 Image',
        approxUsd: 0.25,
        description: 'O mais caro da lista. Só quando o texto na imagem for crítico.',
    },
];

export const getOpenrouterModelById = (id) => OPENROUTER_IMAGE_MODELS.find((m) => m.id === id) || null;
