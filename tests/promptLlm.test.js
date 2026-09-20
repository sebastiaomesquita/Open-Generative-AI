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

test('settings default to OpenRouter plus a local backup, and round-trip', async () => {
    const { getLlmSettings, saveLlmSettings, LLM_DEFAULTS } = await load();
    const s = new MemoryStorage();
    assert.deepEqual(getLlmSettings(s), {
        baseUrl: LLM_DEFAULTS.baseUrl, apiKey: '', model: LLM_DEFAULTS.model,
        fallbackUrl: LLM_DEFAULTS.fallbackUrl, fallbackModel: LLM_DEFAULTS.fallbackModel,
    });
    saveLlmSettings({ baseUrl: 'http://localhost:1234/v1/', apiKey: ' k ', model: '', fallbackUrl: 'http://127.0.0.1:8080/v1/', fallbackModel: 'qwen' }, s);
    assert.deepEqual(getLlmSettings(s), {
        baseUrl: 'http://localhost:1234/v1', apiKey: 'k', model: LLM_DEFAULTS.model,
        fallbackUrl: 'http://127.0.0.1:8080/v1', fallbackModel: 'qwen',
    });
});

test('an empty fallback url means the user turned the backup off', async () => {
    const { getLlmSettings, saveLlmSettings } = await load();
    const s = new MemoryStorage();
    saveLlmSettings({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm', fallbackUrl: '' }, s);
    assert.equal(getLlmSettings(s).fallbackUrl, '', 'an explicit empty value must not revert to the default');
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

test('the local backup takes over when the cloud endpoint cannot be reached', async () => {
    const { enhancePrompt } = await load();
    const seen = [];
    const fetchImpl = async (url, init) => {
        seen.push(url);
        if (url.includes('openrouter.ai')) throw new Error('getaddrinfo ENOTFOUND');
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'local rewrite' } }] }) };
    };
    const settings = {
        baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'cloud',
        fallbackUrl: 'http://127.0.0.1:11434/v1', fallbackModel: 'local',
    };
    const out = await enhancePrompt('um gato', { settings, fetchImpl, withMeta: true });
    assert.deepEqual(out, { text: 'local rewrite', via: 'fallback' });
    assert.equal(seen.length, 2, 'one attempt each, never a retry loop');
    assert.match(seen[1], /127\.0\.0\.1:11434/);
});

test('a spent or rejected key also falls through to the local backup', async () => {
    const { enhancePrompt } = await load();
    for (const status of [401, 402, 429, 500]) {
        const fetchImpl = async (url) => (url.includes('openrouter.ai')
            ? { ok: false, status, json: async () => ({ error: { message: 'x' } }) }
            : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'local' } }] }) });
        const out = await enhancePrompt('x', {
            settings: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'c', fallbackUrl: 'http://127.0.0.1:11434/v1', fallbackModel: 'l' },
            fetchImpl, withMeta: true,
        });
        assert.equal(out.via, 'fallback', `HTTP ${status} should reach the backup`);
    }
});

test('with no key at all the backup serves directly, so offline works out of the box', async () => {
    const { enhancePrompt } = await load();
    const seen = [];
    const fetchImpl = async (url) => {
        seen.push(url);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'local only' } }] }) };
    };
    const out = await enhancePrompt('x', {
        settings: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'c', fallbackUrl: 'http://127.0.0.1:11434/v1', fallbackModel: 'l' },
        fetchImpl, withMeta: true,
    });
    assert.deepEqual(out, { text: 'local only', via: 'fallback' });
    assert.equal(seen.length, 1, 'an unusable cloud endpoint is not even attempted');
});

test('when both fail the message names both causes', async () => {
    const { enhancePrompt } = await load();
    const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
    await assert.rejects(
        enhancePrompt('x', {
            settings: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'c', fallbackUrl: 'http://127.0.0.1:11434/v1', fallbackModel: 'l' },
            fetchImpl,
        }),
        /Network error.*Local backup also failed.*Network error/s,
    );
});

test('without a backup configured the original error survives untouched', async () => {
    const { enhancePrompt } = await load();
    const fetchImpl = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'no credit' } }) });
    await assert.rejects(
        enhancePrompt('x', { settings: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk', model: 'c', fallbackUrl: '' }, fetchImpl }),
        /Insufficient credits \(HTTP 402\). no credit/,
    );
});

test('the curated model list is ordered by price and the default is in it', async () => {
    const { LLM_MODELS } = await import('../src/lib/llmModels.js');
    const { LLM_DEFAULTS } = await load();
    const paid = LLM_MODELS.filter((m) => m.usdPer1000 > 0).map((m) => m.usdPer1000);
    assert.deepEqual(paid, [...paid].sort((a, b) => a - b), 'cheapest first');
    assert.ok(LLM_MODELS.some((m) => m.id === LLM_DEFAULTS.model), 'the default must be pickable');
    assert.ok(LLM_MODELS.some((m) => m.usdPer1000 === 0), 'at least one free option');
    for (const m of LLM_MODELS) assert.ok(m.usdPer1000 < 0.05, `${m.id} is too expensive for a rewrite`);
});
