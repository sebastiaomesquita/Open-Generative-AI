const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/lib/promptLlm.js');

class MemoryStorage {
    constructor(init = {}) { this.map = new Map(Object.entries(init)); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
}

test('normalizeBaseUrl strips trailing slash and /chat/completions', async () => {
    const { normalizeBaseUrl, LLM_DEFAULTS } = await load();
    assert.equal(normalizeBaseUrl('https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1');
    assert.equal(normalizeBaseUrl('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1');
    assert.equal(normalizeBaseUrl(''), LLM_DEFAULTS.baseUrl);
});

test('settings default to OpenRouter and round-trip through storage', async () => {
    const { getLlmSettings, saveLlmSettings, LLM_DEFAULTS } = await load();
    const s = new MemoryStorage();
    assert.deepEqual(getLlmSettings(s), { baseUrl: LLM_DEFAULTS.baseUrl, apiKey: '', model: LLM_DEFAULTS.model });
    saveLlmSettings({ baseUrl: 'http://localhost:1234/v1/', apiKey: ' k ', model: '' }, s);
    assert.deepEqual(getLlmSettings(s), { baseUrl: 'http://localhost:1234/v1', apiKey: 'k', model: LLM_DEFAULTS.model });
});

test('local endpoints count as configured without a key; remote ones need a key', async () => {
    const { isLlmConfigured } = await load();
    assert.equal(isLlmConfigured({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'x' }), true);
    assert.equal(isLlmConfigured({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: 'x' }), true);
    assert.equal(isLlmConfigured({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'x' }), false);
    assert.equal(isLlmConfigured({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'x' }), true);
    assert.equal(isLlmConfigured({ baseUrl: 'https://localhost.evil.com/v1', apiKey: '', model: 'x' }), false);
});

test('extractEnhancedPrompt strips think blocks, prefixes and quotes', async () => {
    const { extractEnhancedPrompt } = await load();
    const wrap = (content) => ({ choices: [{ message: { content } }] });
    assert.equal(extractEnhancedPrompt(wrap('<think>hmm</think>\n"Prompt: a red fox"')), 'a red fox');
    assert.equal(extractEnhancedPrompt(wrap('Enhanced prompt: golden hour city')), 'golden hour city');
    assert.equal(extractEnhancedPrompt(wrap([{ type: 'text', text: 'part a ' }, { type: 'text', text: 'part b' }])), 'part a part b');
    assert.equal(extractEnhancedPrompt({}), '');
});

test('enhancePrompt posts an OpenAI-compatible body and returns the content', async () => {
    const { enhancePrompt } = await load();
    let captured;
    const fetchImpl = async (url, init) => {
        captured = { url, init };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: ' a cinematic fox ' } }] }) };
    };
    const settings = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test', model: 'm' };
    const out = await enhancePrompt('raposa', { kind: 'video', settings, fetchImpl });
    assert.equal(out, 'a cinematic fox');
    assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(captured.init.headers.Authorization, 'Bearer sk-test');
    assert.equal(captured.init.headers['X-Title'], 'Open Generative AI');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, 'm');
    assert.equal(body.messages[1].content, 'raposa');
    assert.match(body.messages[0].content, /video/i);
});

test('enhancePrompt surfaces HTTP errors and refuses unconfigured or empty input', async () => {
    const { enhancePrompt } = await load();
    const settings = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'm' };
    const fetch401 = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    await assert.rejects(enhancePrompt('x', { settings, fetchImpl: fetch401 }), /HTTP 401.*bad key/);
    await assert.rejects(enhancePrompt('   ', { settings, fetchImpl: fetch401 }), /empty/i);
    await assert.rejects(enhancePrompt('x', { settings: { ...settings, apiKey: '' }, fetchImpl: fetch401 }), /not configured/i);
    const fetchEmpty = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) });
    await assert.rejects(enhancePrompt('x', { settings, fetchImpl: fetchEmpty }), /empty response/i);
});
