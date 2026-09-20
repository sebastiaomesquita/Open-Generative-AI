// Renderer wrapper for the composition layer.

import { getLlmSettings } from './promptLlm.js';

export const isComposeAvailable = () =>
    typeof window !== 'undefined' && !!window.localAI?.isElectron && !!window.localAI?.compose;

const bridge = () => {
    if (!isComposeAvailable()) throw new Error('A composição só existe no aplicativo desktop.');
    return window.localAI.compose;
};

/**
 * The planner runs in the main process but the LLM credentials live in the
 * renderer's settings, so they ride along with the call. Nothing is stored on
 * the other side.
 */
const withLlm = (params = {}) => ({ ...params, llm: getLlmSettings() });

export const composer = {
    plan: (brief, opts) => bridge().plan(withLlm({ brief, ...opts })),
    run: (params) => bridge().run(withLlm(params)),
    cancel: () => bridge().cancel(),
    themes: () => bridge().themes(),
    onProgress: (cb) => (isComposeAvailable() ? bridge().onProgress(cb) : () => {}),
};
