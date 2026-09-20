const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('../mcp/spendLedger');
const or = require('../mcp/openrouter');

const tmpLedger = () => ({ HF_SPEND_LEDGER: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'led-')), 'spend.json') });

// ── Ledger ────────────────────────────────────────────────────────────────

test('the ledger accumulates spend and blocks once the daily budget is gone', () => {
    const env = { ...tmpLedger(), OPENROUTER_DAILY_USD: '0.10' };
    assert.equal(ledger.check(env).allowed, true);
    ledger.record(0.04, { model: 'a' }, env);
    assert.deepEqual(
        { allowed: ledger.check(env).allowed, remaining: Number(ledger.check(env).remaining.toFixed(4)) },
        { allowed: true, remaining: 0.06 },
    );
    const after = ledger.record(0.07, { model: 'a' }, env);
    assert.equal(after.spent_today_usd, 0.11);
    assert.equal(after.remaining_usd, 0);
    const blocked = ledger.check(env);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /daily budget is spent.*OPENROUTER_DAILY_USD/s);
});

test('spend is attributed per model and survives a corrupt ledger file', () => {
    const env = { ...tmpLedger(), OPENROUTER_DAILY_USD: '5' };
    ledger.record(0.03, { model: 'google/nano' }, env);
    ledger.record(0.05, { model: 'openai/gpt-image' }, env);
    const s = ledger.summary(env);
    assert.equal(s.today.calls, 2);
    assert.equal(s.today.by_model['google/nano'], 0.03);
    assert.equal(Number(s.today.usd.toFixed(4)), 0.08);

    fs.writeFileSync(env.HF_SPEND_LEDGER, 'not json at all');
    assert.equal(ledger.spentToday(env), 0, 'a corrupt ledger must not block work');
    assert.equal(ledger.check(env).allowed, true);
});

test('the daily budget falls back to a safe default when misconfigured', () => {
    assert.equal(ledger.dailyBudget({}), ledger.DEFAULT_DAILY_USD);
    assert.equal(ledger.dailyBudget({ OPENROUTER_DAILY_USD: 'abc' }), ledger.DEFAULT_DAILY_USD);
    assert.equal(ledger.dailyBudget({ OPENROUTER_DAILY_USD: '-1' }), ledger.DEFAULT_DAILY_USD);
    assert.equal(ledger.dailyBudget({ OPENROUTER_DAILY_USD: '0' }), 0, 'zero is a valid freeze');
});

// ── Pricing and key handling ──────────────────────────────────────────────

test('prices are reported as a range wide enough to cover both model families', () => {
    // Measured 2026-09-20: Nano Banana spent 827 tokens on a prompt where
    // GPT-5 Image Mini spent 6251. A range tuned to one family understates the
    // other by about 7x, so the band has to span both.
    const nano = or.priceRange('0.00003');
    assert.equal(nano.per_token_usd, 0.00003);
    assert.ok(nano.approx_usd_low <= 0.0248, 'the measured Nano Banana cost must fall inside the range');
    assert.ok(nano.approx_usd_high >= 0.0248);

    const mini = or.priceRange('0.000008');
    assert.ok(mini.approx_usd_low <= 0.05001, 'the measured GPT-5 Image Mini cost must fall inside the range');
    assert.ok(mini.approx_usd_high >= 0.05001);

    assert.equal(or.priceRange('0'), null);
    assert.equal(or.priceRange(undefined), null);
});

test('the app model snapshot stays ordered by price and keeps its measured figures', () => {
    const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'src', 'lib', 'openrouterModels.js'), 'utf8');
    const prices = [...src.matchAll(/approxUsd:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(prices.length >= 5);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'the picker must list cheapest first');
    // The two we actually paid for, so a future edit cannot quietly revert them.
    assert.match(src, /id: 'google\/gemini-2\.5-flash-image',[\s\S]{0,120}approxUsd: 0\.025,[\s\S]{0,40}measured: true/);
    assert.match(src, /id: 'openai\/gpt-5-image-mini',[\s\S]{0,120}approxUsd: 0\.05,[\s\S]{0,40}measured: true/);
});

test('a missing key produces an actionable error', () => {
    // The keychain reader is stubbed: otherwise this test would pass or fail
    // depending on whether the machine running it happens to have a key stored.
    const noKeychain = { keychain: () => null };
    assert.throws(() => or.resolveKey({ OPENROUTER_API_KEY: '' }, noKeychain), /--save-openrouter-key|OPENROUTER_API_KEY/);
    assert.deepEqual(or.keyStatus({}, noKeychain), { configured: false, origin: 'none', prefix: '' });

    assert.deepEqual(or.keyStatus({ OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijk' }), {
        configured: true, origin: 'env', prefix: 'sk-or-v1-abc...',
    });
    // A stored key is used when the environment is silent.
    assert.equal(or.resolveKey({}, { keychain: () => 'sk-or-v1-stored' }).origin, 'keychain');
});

test('an obviously wrong key is rejected before it reaches the keychain', () => {
    assert.throws(() => or.saveKey('hunter2'), /looks like sk-or-v1/);
    assert.throws(() => or.saveKey(''), /looks like sk-or-v1/);
});

test('the response decoder handles base64 and refuses shapes it does not know', () => {
    const png = or.decodeImage({ data: [{ b64_json: Buffer.from('x').toString('base64'), media_type: 'image/png' }] });
    assert.equal(png.ext, '.png');
    assert.equal(or.decodeImage({ data: [{ b64_json: 'eA==', media_type: 'image/webp' }] }).ext, '.webp');
    assert.equal(or.decodeImage({ data: [{ url: 'https://x/y.png' }] }).url, 'https://x/y.png');
    assert.throws(() => or.decodeImage({ data: [] }), /no image/);
    assert.throws(() => or.decodeImage({ data: [{ weird: true }] }), /does not understand/);
});

// ── End to end against a fake OpenRouter ──────────────────────────────────

function fakeOpenRouter({ cost = 0.039, status = 200, error = 'nope' } = {}) {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            calls.push({ url: req.url, auth: req.headers.authorization, referer: req.headers['http-referer'], body: body ? JSON.parse(body) : null });
            if (status !== 200) {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: { message: error } }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                created: 1, data: [{ b64_json: Buffer.from('fake-png-bytes').toString('base64'), media_type: 'image/png' }],
                usage: { total_tokens: 1290, cost },
            }));
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
}

async function withFake(opts, fn) {
    const { server, calls, port } = await fakeOpenRouter(opts);
    const prev = process.env.OPENROUTER_BASE_URL;
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}`;
    delete require.cache[require.resolve('../mcp/openrouter')];
    const mod = require('../mcp/openrouter');
    try {
        return await fn(mod, calls);
    } finally {
        server.close();
        if (prev === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = prev;
        delete require.cache[require.resolve('../mcp/openrouter')];
    }
}

test('generate posts the documented body, saves the file and records the real cost', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-out-'));
    const env = { ...tmpLedger(), OPENROUTER_API_KEY: 'sk-or-v1-test', OPENROUTER_DAILY_USD: '2' };

    await withFake({ cost: 0.039 }, async (mod, calls) => {
        const out = await mod.generateImage({ prompt: 'um pescador no cais', output_dir: outDir }, () => {}, env);
        assert.equal(out.status, 'completed');
        assert.equal(out.model, 'google/gemini-2.5-flash-image', 'defaults to Nano Banana');
        assert.equal(out.charged_usd, 0.039, 'the cost comes from the response, not a guess');
        assert.equal(out.spent_today_usd, 0.039);
        assert.equal(Number(out.remaining_usd.toFixed(3)), 1.961);
        assert.ok(fs.existsSync(out.file.path));
        assert.equal(fs.readFileSync(out.file.path, 'utf8'), 'fake-png-bytes');

        assert.equal(calls[0].url, '/images');
        assert.equal(calls[0].auth, 'Bearer sk-or-v1-test');
        assert.ok(calls[0].referer, 'OpenRouter attribution headers must be sent');
        assert.deepEqual(calls[0].body, { model: 'google/gemini-2.5-flash-image', prompt: 'um pescador no cais' });

        // A second identical run must not overwrite the first.
        const again = await mod.generateImage({ prompt: 'um pescador no cais', output_dir: outDir }, () => {}, env);
        assert.notEqual(again.file.path, out.file.path);
        assert.equal(again.spent_today_usd, 0.078);
    });
    fs.rmSync(outDir, { recursive: true, force: true });
});

test('a local reference image is inlined as a data URI', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-ref-'));
    const ref = path.join(dir, 'ref.png');
    fs.writeFileSync(ref, 'refbytes');
    const env = { ...tmpLedger(), OPENROUTER_API_KEY: 'sk-or-v1-test', OPENROUTER_DAILY_USD: '2' };

    await withFake({}, async (mod, calls) => {
        await mod.generateImage({ prompt: 'watercolour', input_references: [ref, 'https://x/y.jpg'], output_dir: dir }, () => {}, env);
        const refs = calls[0].body.input_references;
        assert.equal(refs.length, 2);
        assert.match(refs[0].image_url.url, /^data:image\/png;base64,/);
        assert.equal(refs[1].image_url.url, 'https://x/y.jpg');
        await assert.rejects(
            mod.generateImage({ prompt: 'x', input_references: [path.join(dir, 'missing.png')] }, () => {}, env),
            /Reference image not found/,
        );
    });
    fs.rmSync(dir, { recursive: true, force: true });
});

test('generation is refused once the budget is gone, before any request is sent', async () => {
    const env = { ...tmpLedger(), OPENROUTER_API_KEY: 'sk-or-v1-test', OPENROUTER_DAILY_USD: '0.01' };
    ledger.record(0.02, { model: 'x' }, env);
    await withFake({}, async (mod, calls) => {
        const out = await mod.generateImage({ prompt: 'x' }, () => {}, env);
        assert.equal(out.status, 'refused');
        assert.match(out.reason, /daily budget is spent/);
        assert.equal(calls.length, 0, 'nothing was sent to OpenRouter');
    });
});

test('HTTP errors are translated into something a person can act on', async () => {
    const env = { ...tmpLedger(), OPENROUTER_API_KEY: 'sk-or-v1-test', OPENROUTER_DAILY_USD: '2' };
    await withFake({ status: 402, error: 'Insufficient credits' }, async (mod) => {
        await assert.rejects(mod.generateImage({ prompt: 'x' }, () => {}, env), /402.*no credit.*Insufficient credits/s);
    });
    await withFake({ status: 404, error: 'no such model' }, async (mod) => {
        await assert.rejects(mod.generateImage({ prompt: 'x', model: 'bogus/model' }, () => {}, env), /404.*unknown model id/s);
    });
});

test('an empty prompt never reaches the API', async () => {
    const env = { ...tmpLedger(), OPENROUTER_API_KEY: 'sk-or-v1-test' };
    await withFake({}, async (mod, calls) => {
        await assert.rejects(mod.generateImage({ prompt: '   ' }, () => {}, env), /Prompt is required/);
        assert.equal(calls.length, 0);
    });
});
