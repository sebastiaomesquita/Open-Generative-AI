// Curated text models for the Enhance prompt button, cheapest first.
//
// Cost is what a thousand rewrites run to, at roughly 200 input and 150 output
// tokens each, from OpenRouter's published per-token prices on 2026-09-20.
// Even the dearest here is under three cents per thousand, so the choice is
// about quality, not money.
export const LLM_MODELS = [
    { id: 'mistralai/mistral-nemo', name: 'Mistral Nemo', usdPer1000: 0.008, description: 'O mais barato que ainda escreve bem.' },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', usdPer1000: 0.018, description: 'Melhor equilíbrio. Padrão.', featured: true },
    { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', usdPer1000: 0.022, description: 'Alternativa conhecida e estável.' },
    { id: 'qwen/qwen3.7-flash', name: 'Qwen 3.7 Flash', usdPer1000: 0.026, description: 'Forte em instruções longas.' },
    { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (grátis)', usdPer1000: 0, description: 'Sem custo. Sujeito a limite de uso.' },
    { id: 'qwen/qwen3.8-27b:free', name: 'Qwen 3.8 27B (grátis)', usdPer1000: 0, description: 'Sem custo. Sujeito a limite de uso.' },
];

export const getLlmModelById = (id) => LLM_MODELS.find((m) => m.id === id) || null;
