const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('../mcp/spendGuard');
const { credentialStatus } = require('../mcp/credentialStore');

// ── Spend guard ───────────────────────────────────────────────────────────

test('spend guard clears cheap jobs and blocks expensive ones', () => {
    const env = { HF_MAX_USD: '0.50' };
    assert.equal(guard.check(0.003, undefined, env).allowed, true);
    assert.equal(guard.check(0.5, undefined, env).allowed, true, 'the ceiling itself is allowed');
    const blocked = guard.check(1.7, undefined, env);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /above the US\$ 0\.50 ceiling/);
    assert.match(blocked.reason, /approve_usd: 1\.7000/, 'tells the caller exactly how to approve');
});

test('an explicit budget overrides the ceiling, but only up to that budget', () => {
    const env = { HF_MAX_USD: '0.50' };
    assert.equal(guard.check(1.7, 2, env).allowed, true);
    assert.equal(guard.check(1.7, 1, env).allowed, false);
    assert.match(guard.check(1.7, 1, env).reason, /above the US\$ 1\.0000 you approved/);
});

test('an unknown price is refused rather than assumed cheap', () => {
    const v = guard.check(null, undefined, {});
    assert.equal(v.allowed, false);
    assert.match(v.reason, /did not return a price/);
    assert.equal(guard.check(null, 0.10, {}).allowed, false, 'even an approved budget cannot price an unknown job');
});

test('the ceiling falls back to a safe default when misconfigured', () => {
    assert.equal(guard.ceiling({}), guard.DEFAULT_MAX_USD);
    assert.equal(guard.ceiling({ HF_MAX_USD: 'abc' }), guard.DEFAULT_MAX_USD);
    assert.equal(guard.ceiling({ HF_MAX_USD: '-5' }), guard.DEFAULT_MAX_USD);
    assert.equal(guard.ceiling({ HF_MAX_USD: '0' }), 0, 'zero is a valid ceiling: price everything, run nothing');
});

// ── Credential store ──────────────────────────────────────────────────────

test('credential status reads the environment without touching the keychain', () => {
    assert.deepEqual(credentialStatus({ HF_CREDENTIALS: 'kid_abc:sec_def' }), { configured: true, keyId: 'kid_abc', origin: 'env' });
});

// ── Tool surface ──────────────────────────────────────────────────────────

test('every declared tool has a usable schema and a dispatch branch', async () => {
    const { TOOLS, dispatch } = require('../mcp/server');
    assert.ok(TOOLS.length >= 4);
    for (const tool of TOOLS) {
        assert.match(tool.name, /^higgsfield_/);
        assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
        assert.equal(tool.inputSchema.type, 'object');
        for (const req of tool.inputSchema.required || []) {
            assert.ok(tool.inputSchema.properties[req], `${tool.name} requires ${req} but does not declare it`);
        }
    }
    assert.match(TOOLS.find((t) => t.name === 'higgsfield_generate').description, /SPENDS REAL MONEY/);
    await assert.rejects(dispatch('higgsfield_nope', {}, () => {}), /Unknown tool/);
});

test('list_models reports the catalogue and the guard state', async () => {
    const { dispatch } = require('../mcp/server');
    const all = await dispatch('higgsfield_list_models', {}, () => {});
    assert.equal(all.count, all.models.length);
    assert.ok(all.count >= 10);
    assert.equal(typeof all.spend_ceiling_usd, 'number');
    const video = await dispatch('higgsfield_list_models', { kind: 'video' }, () => {});
    assert.ok(video.models.every((m) => m.kind === 'video'));
    assert.ok(video.models.some((m) => m.needs_image === true));
});

test('slug keeps filenames tame', () => {
    const { slug } = require('../mcp/server');
    assert.equal(slug('Retrato de um pescador, ao amanhecer!'), 'retrato-de-um-pescador-ao-amanhecer');
    assert.equal(slug(''), 'output');
    assert.ok(slug('x'.repeat(200)).length <= 40);
});

// ── End-to-end against a fake Higgsfield ──────────────────────────────────

function fakeHiggsfield({ usd = '0.0032', finalStatus = 'completed' } = {}) {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
            const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

            if (req.url.startsWith('/estimate/')) return send(200, { credits: '1.500', usd });
            if (req.url.includes('/requests/') && req.url.endsWith('/status')) {
                return send(200, {
                    status: finalStatus, request_id: 'req-test-1',
                    ...(finalStatus === 'completed' ? { images: [{ url: `http://127.0.0.1:${server.address().port}/media/out.png` }] } : { error: 'boom' }),
                });
            }
            if (req.url === '/media/out.png') {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
            }
            // submission
            return send(200, {
                status: 'queued', request_id: 'req-test-1',
                status_url: `http://127.0.0.1:${server.address().port}/requests/req-test-1/status`,
            });
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
}

async function withFake(opts, fn) {
    const { server, calls, port } = await fakeHiggsfield(opts);
    const prevBase = process.env.HF_BASE_URL;
    const prevCred = process.env.HF_CREDENTIALS;
    process.env.HF_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.HF_CREDENTIALS = 'kid_test:sec_test';
    delete require.cache[require.resolve('../mcp/api')];
    delete require.cache[require.resolve('../mcp/server')];
    try {
        return await fn(require('../mcp/server'), calls);
    } finally {
        server.close();
        if (prevBase === undefined) delete process.env.HF_BASE_URL; else process.env.HF_BASE_URL = prevBase;
        if (prevCred === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = prevCred;
        delete require.cache[require.resolve('../mcp/api')];
        delete require.cache[require.resolve('../mcp/server')];
    }
}

test('estimate prices a job and sends the documented auth header', async () => {
    await withFake({ usd: '0.0032' }, async ({ dispatch }, calls) => {
        const out = await dispatch('higgsfield_estimate', { model: 'hf-soul-v2', prompt: 'a fox' }, () => {});
        assert.equal(out.usd, 0.0032);
        assert.equal(out.within_ceiling, true);
        assert.equal(out.endpoint, 'higgsfield-ai/soul/v2/standard');
        assert.equal(calls[0].auth, 'Key kid_test:sec_test');
        assert.equal(calls[0].url, '/estimate/higgsfield-ai/soul/v2/standard');
        assert.equal(calls[0].body.resolution, '1080p', 'the catalogue builder shaped the body');
    });
});

test('generate prices, submits, polls and writes the file to disk', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-mcp-'));
    await withFake({ usd: '0.0032' }, async ({ dispatch }, calls) => {
        const out = await dispatch('higgsfield_generate', { model: 'hf-soul-v2', prompt: 'um pescador', output_dir: outDir }, () => {});
        assert.equal(out.status, 'completed');
        assert.equal(out.estimated_usd, 0.0032);
        assert.equal(out.files.length, 1);
        assert.ok(fs.existsSync(out.files[0].path), 'result must exist on disk');
        assert.match(out.files[0].path, /um-pescador-req-test\.png$/);
        assert.ok(calls.some((c) => c.url === '/higgsfield-ai/soul/v2/standard'), 'submitted to the model endpoint');
        assert.ok(calls.some((c) => c.url.endsWith('/status')), 'polled for status');
    });
    fs.rmSync(outDir, { recursive: true, force: true });
});

test('generate refuses to spend above the ceiling and says how to approve', async () => {
    await withFake({ usd: '1.7000' }, async ({ dispatch }, calls) => {
        const out = await dispatch('higgsfield_generate', { model: 'hf-kling-3-t2v', prompt: 'a fox', duration: 10 }, () => {});
        assert.equal(out.status, 'refused');
        assert.match(out.reason, /approve_usd/);
        assert.equal(calls.length, 1, 'only the estimate was called — nothing was submitted');

        const approved = await dispatch('higgsfield_generate', { model: 'hf-kling-3-t2v', prompt: 'a fox', duration: 10, approve_usd: 2, dry_run: true }, () => {});
        assert.equal(approved.status, 'dry_run');
        assert.equal(approved.input.duration, 10);
    });
});

test('a failed job reports that nothing was charged', async () => {
    await withFake({ usd: '0.0032', finalStatus: 'failed' }, async ({ dispatch }) => {
        const out = await dispatch('higgsfield_generate', { model: 'hf-soul-v2', prompt: 'x' }, () => {});
        assert.equal(out.status, 'failed');
        assert.equal(out.charged, false);
    });
});

test('a missing credential produces an actionable error, not a stack trace', async () => {
    const prev = process.env.HF_CREDENTIALS;
    delete process.env.HF_CREDENTIALS;
    delete require.cache[require.resolve('../mcp/server')];
    const { dispatch } = require('../mcp/server');
    try {
        await assert.rejects(
            dispatch('higgsfield_estimate', { model: 'hf-soul-v2', prompt: 'x' }, () => {}),
            /--save-credential|HF_CREDENTIALS/,
        );
    } finally {
        if (prev !== undefined) process.env.HF_CREDENTIALS = prev;
        delete require.cache[require.resolve('../mcp/server')];
    }
});
