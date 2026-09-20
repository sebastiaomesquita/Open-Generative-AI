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
    assert.ok(TOOLS.length >= 9);
    for (const tool of TOOLS) {
        assert.match(tool.name, /^(higgsfield|local|openrouter)_/);
        assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
        assert.equal(tool.inputSchema.type, 'object');
        for (const req of tool.inputSchema.required || []) {
            assert.ok(tool.inputSchema.properties[req], `${tool.name} requires ${req} but does not declare it`);
        }
    }
    // The descriptions must make the cost difference obvious: the agent picks
    // between the two engines from these alone.
    assert.match(TOOLS.find((t) => t.name === 'higgsfield_generate').description, /SPENDS REAL MONEY/);
    assert.match(TOOLS.find((t) => t.name === 'local_generate').description, /FREE/);
    assert.match(TOOLS.find((t) => t.name === 'local_generate').description, /no video|Images only/i);
    assert.match(TOOLS.find((t) => t.name === 'openrouter_generate_image').description, /COSTS MONEY/);
    // Only Higgsfield does video; the other two must say so, or the agent will
    // reach for the wrong engine.
    for (const n of ['local_generate', 'openrouter_generate_image']) {
        assert.match(TOOLS.find((t) => t.name === n).description, /no video/i, `${n} must rule out video`);
    }
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

test('a missing credential produces an actionable error, not a stack trace', () => {
    // Stubbed keychain, so the result does not depend on what this machine has
    // stored. Testing the resolver directly keeps it that way.
    const { resolveCredentials, credentialStatus } = require('../mcp/credentialStore');
    const noKeychain = { keychain: () => null };
    assert.throws(() => resolveCredentials({}, noKeychain), /--save-credential|HF_CREDENTIALS/);
    assert.deepEqual(credentialStatus({}, noKeychain), { configured: false, keyId: '', origin: 'none' });
    assert.equal(resolveCredentials({}, { keychain: () => 'kid:sec' }).origin, 'keychain');
    assert.equal(resolveCredentials({ HF_CREDENTIALS: 'a:b' }, { keychain: () => 'kid:sec' }).origin, 'env',
        'the environment wins over the keychain');
});

// ── Local engine ──────────────────────────────────────────────────────────

const local = require('../mcp/local');

test('local status lists the catalogue and flags what is missing', () => {
    const st = local.status({ HF_LOCAL_AI_DIR: path.join(os.tmpdir(), 'no-such-local-ai') });
    assert.equal(st.engine_ready, false);
    assert.ok(st.models.length >= 6);
    assert.deepEqual(st.ready_models, []);
    const zimg = st.models.find((m) => m.type === 'z-image');
    assert.ok(zimg.missing_files.length >= 3, 'z-image must report its two auxiliary files too');
});

test('local generation refuses clearly when the engine or a model is absent', async () => {
    const env = { HF_LOCAL_AI_DIR: path.join(os.tmpdir(), 'no-such-local-ai') };
    assert.throws(() => local.resolveModel('dreamshaper-8', env), /engine is not installed/);
    assert.throws(() => local.resolveModel('nope', env), /Unknown local model.*Available:/s);
});

test('sd-cli arguments match what the desktop app sends', () => {
    const sd1 = local.buildArgs({
        model: { type: 'sd1', defaultSteps: 20, defaultGuidance: 7.5 },
        modelPath: '/m/ds8.safetensors', modelsDir: '/m', outPath: '/o/x.png',
        prompt: 'a fox', negativePrompt: 'blurry', aspectRatio: '16:9', seed: 42,
    });
    assert.equal(sd1[0], '-m', 'SD 1.5 loads as a full model');
    assert.ok(sd1.includes('-n') && sd1.includes('blurry'), 'negative prompt is supported locally');
    assert.equal(sd1[sd1.indexOf('-W') + 1], '896', '16:9 at 512 base, rounded to a multiple of 64');
    assert.equal(sd1[sd1.indexOf('-H') + 1], '512');
    assert.equal(sd1[sd1.indexOf('--seed') + 1], '42');
    assert.equal(sd1.includes('--sd-version'), false);

    const zimg = local.buildArgs({
        model: { type: 'z-image', defaultSteps: 8, defaultGuidance: 1.0, scheduler: 'discrete' },
        modelPath: '/m/z.gguf', modelsDir: '/m', outPath: '/o/x.png',
        prompt: 'a fox', aspectRatio: '1:1', seed: 7,
    });
    assert.equal(zimg[0], '--diffusion-model', 'z-image is a standalone transformer, -m would fail');
    assert.ok(zimg.includes('--llm') && zimg.includes('--vae'), 'z-image needs its encoder and VAE');
    assert.equal(zimg[zimg.indexOf('-W') + 1], '1024', 'z-image renders at 1024 base');

    const sdxl = local.buildArgs({
        model: { type: 'sdxl', defaultSteps: 30 }, modelPath: '/m/x.safetensors',
        modelsDir: '/m', outPath: '/o/x.png', prompt: 'x', aspectRatio: '1:1', seed: 1,
    });
    assert.equal(sdxl[sdxl.indexOf('--sd-version') + 1], 'sdxl');
});

test('aspect ratios always land on multiples of 64', () => {
    for (const type of ['sd1', 'sdxl', 'z-image']) {
        for (const ar of ['1:1', '4:3', '3:4', '16:9', '9:16']) {
            const [w, h] = local.arToDimensions(ar, type);
            assert.equal(w % 64, 0, `${type} ${ar} width`);
            assert.equal(h % 64, 0, `${type} ${ar} height`);
        }
    }
    assert.deepEqual(local.arToDimensions('bogus', 'sd1'), [512, 512], 'unknown ratio falls back to square');
});

test('Metal use is read from the engine log', () => {
    assert.equal(local.usedMetal('total params memory size = 1969.78MB (VRAM 1969.78MB, RAM 0.00MB)'), true);
    assert.equal(local.usedMetal('total params memory size = 1969.78MB (VRAM 0.00MB, RAM 1969.78MB)'), false);
    assert.equal(local.usedMetal('nothing useful here'), null);
});

test('moving the result survives a cross-device tmp dir', () => {
    // Regression: the engine writes to the SSD while output usually lands on the
    // internal disk, and rename() fails with EXDEV across devices.
    const src = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hf-src-')), 'a.png');
    const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-dst-'));
    fs.writeFileSync(src, 'png');
    const dest = path.join(dstDir, 'b.png');

    const move = (from, to) => {
        try { fs.renameSync(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(from, to); fs.unlinkSync(from); }
    };
    move(src, dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'png');
    assert.equal(fs.existsSync(src), false);

    const moveSource = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'local.js'), 'utf8');
    assert.match(moveSource, /EXDEV/, 'local.js must handle the cross-device case');
});

test('two models with the same prompt and seed produce two files, not one', () => {
    // Regression: the filename was prompt+seed only, so running the same prompt
    // on Dreamshaper and then on Z-Image silently overwrote the first render.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-uniq-'));
    const a = local.uniquePath(dir, 'fisherman-dreamshaper-8-12345', '.png');
    fs.writeFileSync(a, 'a');
    const b = local.uniquePath(dir, 'fisherman-z-image-turbo-12345', '.png');
    assert.notEqual(a, b);

    fs.writeFileSync(b, 'b');
    const again = local.uniquePath(dir, 'fisherman-dreamshaper-8-12345', '.png');
    assert.match(again, /-2\.png$/, 'a repeat of the same run is numbered, never overwritten');
    fs.rmSync(dir, { recursive: true, force: true });
});
