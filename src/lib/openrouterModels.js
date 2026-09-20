// Curated snapshot of the OpenRouter image models, so the studio can build its
// picker synchronously at mount. Prices are approximate: OpenRouter bills per
// output token (~1100-1300 per image), and the real figure only exists after a
// generation. Refresh with: node scripts/refresh-openrouter-models.js
export const OPENROUTER_IMAGE_MODELS = [
    {
        id: 'openai/gpt-5-image-mini',
        name: 'GPT-5 Image Mini',
        approxUsd: 0.01,
        description: 'O mais barato. Bom para rascunho com qualidade acima do local.',
    },
    {
        id: 'google/gemini-2.5-flash-image',
        name: 'Nano Banana',
        approxUsd: 0.04,
        description: 'Melhor equilíbrio entre custo e qualidade. Padrão.',
        featured: true,
    },
    {
        id: 'openai/gpt-5-image',
        name: 'GPT-5 Image',
        approxUsd: 0.05,
        description: 'Forte em texto dentro da imagem e em seguir instruções.',
    },
    {
        id: 'google/gemini-3.1-flash-image',
        name: 'Nano Banana 2',
        approxUsd: 0.07,
        description: 'Geração mais recente do Flash Image.',
    },
    {
        id: 'google/gemini-3-pro-image',
        name: 'Nano Banana Pro',
        approxUsd: 0.15,
        description: 'O mais caro e o mais detalhado da lista.',
    },
];

export const getOpenrouterModelById = (id) => OPENROUTER_IMAGE_MODELS.find((m) => m.id === id) || null;
