// OpenRouter image generation for the MCP server.
//
// One account and one key already cover prompt rewriting in the desktop app,
// so the same credential buys images here. Cheaper than Higgsfield for stills
// and it reaches Nano Banana and the GPT image models.
//
// Cost control differs from Higgsfield on purpose. Higgsfield prices a job
// before it runs, so that engine uses a per-call ceiling. OpenRouter reports
// the real cost only in the response, so this one runs a daily budget: see
// mcp/spendLedger.js.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('./spendLedger');
const { slug } = require('./server-utils');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const SERVICE = 'openrouter-mcp';
const ACCOUNT = 'api-key';

const REFERER = 'https://github.com/Anil-matcha/Open-Generative-AI';
const TITLE = 'Open Generative AI';

// ── Credential ────────────────────────────────────────────────────────────

function fromKeychain() {
    if (process.platform !== 'darwin') return null;
    try {
        return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
    } catch {
        return null;
    }
}

function saveKey(key) {
    const value = String(key || '').trim();
    if (!value.startsWith('sk-or-')) {
        throw new Error('An OpenRouter key looks like sk-or-v1-... Create one at https://openrouter.ai/keys');
    }
    if (process.platform !== 'darwin') throw new Error('Keychain storage is macOS only. Set OPENROUTER_API_KEY instead.');
    execFileSync('security', [
        'add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT,
        '-l', 'OpenRouter MCP API key', '-w', value,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { ok: true, prefix: `${value.slice(0, 12)}...` };
}

function deleteKey() {
    if (process.platform !== 'darwin') return { ok: false };
    try {
        execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { stdio: 'ignore' });
        return { ok: true };
    } catch {
        return { ok: false };
    }
}

/**
 * `keychain` is injectable so tests stay hermetic: without it they would pass
 * or fail depending on whether this machine happens to have a key stored.
 */
function resolveKey(env = process.env, { keychain = fromKeychain } = {}) {
    const fromEnv = String(env.OPENROUTER_API_KEY || '').trim();
    if (fromEnv) return { key: fromEnv, origin: 'env' };
    const stored = keychain();
    if (stored) return { key: stored, origin: 'keychain' };
    throw new Error(
        'No OpenRouter key found. Store one with:\n'
        + '  node mcp/server.js --save-openrouter-key sk-or-v1-...\n'
        + 'or export OPENROUTER_API_KEY. Create a key at https://openrouter.ai/keys'
    );
}

function keyStatus(env = process.env, deps) {
    try {
        const { key, origin } = resolveKey(env, deps);
        return { configured: true, origin, prefix: `${key.slice(0, 12)}...` };
    } catch {
        return { configured: false, origin: 'none', prefix: '' };
    }
}

// ── Models ────────────────────────────────────────────────────────────────

/**
 * `image_output` is priced per output token, not per image, and an image costs
 * roughly 1100-1300 tokens depending on size. So we surface a range rather
 * than pretend a flat price; the real figure comes back with every call.
 */
const TOKENS_PER_IMAGE = { low: 1100, high: 1300 };

function priceRange(imageOutputPerToken) {
    const p = Number(imageOutputPerToken);
    if (!Number.isFinite(p) || p <= 0) return null;
    return {
        per_token_usd: p,
        approx_usd_low: Number((p * TOKENS_PER_IMAGE.low).toFixed(4)),
        approx_usd_high: Number((p * TOKENS_PER_IMAGE.high).toFixed(4)),
    };
}

async function listImageModels(env = process.env) {
    const res = await fetch(`${BASE_URL}/models`);
    if (!res.ok) throw new Error(`Could not list OpenRouter models: HTTP ${res.status}`);
    const { data } = await res.json();

    const models = data
        .filter((m) => (m.architecture?.output_modalities || []).includes('image'))
        .filter((m) => !m.id.startsWith('openrouter/auto'))
        .map((m) => ({
            id: m.id,
            name: m.name,
            accepts_input_image: (m.architecture?.input_modalities || []).includes('image'),
            moderated: Boolean(m.top_provider?.is_moderated),
            price: priceRange(m.pricing?.image_output),
        }))
        .sort((a, b) => (a.price?.per_token_usd ?? 9) - (b.price?.per_token_usd ?? 9));

    return {
        count: models.length,
        key: keyStatus(env),
        budget: ledger.summary(env),
        note: 'Prices are per output token; an image runs about 1100-1300 tokens. Every generation returns its real cost.',
        models,
    };
}

// ── Generation ────────────────────────────────────────────────────────────

function decodeImage(payload) {
    const item = payload?.data?.[0];
    if (!item) throw new Error('OpenRouter returned no image.');
    if (item.b64_json) {
        const mediaType = item.media_type || 'image/png';
        const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[mediaType] || '.png';
        return { buffer: Buffer.from(item.b64_json, 'base64'), ext, mediaType };
    }
    if (item.url) return { url: item.url };
    throw new Error('OpenRouter returned an image in a shape this server does not understand.');
}

async function generateImage(args, log = () => {}, env = process.env) {
    if (!String(args.prompt || '').trim()) throw new Error('Prompt is required.');
    const { key } = resolveKey(env);

    const gate = ledger.check(env);
    if (!gate.allowed) return { status: 'refused', reason: gate.reason, spent_today_usd: gate.spent, budget_usd: gate.budget };

    const body = { model: args.model || 'google/gemini-2.5-flash-image', prompt: args.prompt };
    if (args.size) body.size = args.size;
    if (args.n) body.n = args.n;

    // Reference images: public URL or data: URI, per the docs.
    const refs = [];
    for (const ref of args.input_references || []) {
        if (/^https?:|^data:/.test(ref)) refs.push({ type: 'image_url', image_url: { url: ref } });
        else {
            const abs = path.resolve(ref);
            if (!fs.existsSync(abs)) throw new Error(`Reference image not found: ${abs}`);
            const mt = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(abs).toLowerCase()];
            if (!mt) throw new Error(`Unsupported reference image type: ${path.extname(abs)}`);
            refs.push({ type: 'image_url', image_url: { url: `data:${mt};base64,${fs.readFileSync(abs).toString('base64')}` } });
        }
    }
    if (refs.length) body.input_references = refs;

    log(`openrouter: ${body.model} (US$ ${gate.remaining.toFixed(4)} left today)`);
    const startedAt = Date.now();

    const res = await fetch(`${BASE_URL}/images`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': REFERER,
            'X-Title': TITLE,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
        const hints = {
            401: 'key rejected',
            402: 'no credit on the OpenRouter account',
            403: 'the request was blocked by moderation',
            404: 'unknown model id',
            429: 'rate limited',
        };
        throw new Error(`OpenRouter HTTP ${res.status}${hints[res.status] ? ` (${hints[res.status]})` : ''}: ${detail}`.trim());
    }

    const payload = await res.json();
    const cost = Number(payload?.usage?.cost) || 0;
    const accounting = ledger.record(cost, { model: body.model, kind: 'image' }, env);

    const decoded = decodeImage(payload);
    const outDir = path.resolve(args.output_dir || env.HF_OUTPUT_DIR || path.join(os.homedir(), 'Downloads', 'higgsfield'));
    fs.mkdirSync(outDir, { recursive: true });

    const base = `${slug(args.prompt)}-${slug(body.model.split('/').pop())}`;
    let dest = path.join(outDir, `${base}${decoded.ext || '.png'}`);
    let n = 2;
    while (fs.existsSync(dest)) { dest = path.join(outDir, `${base}-${n}${decoded.ext || '.png'}`); n += 1; }

    if (decoded.buffer) {
        fs.writeFileSync(dest, decoded.buffer);
    } else {
        const img = await fetch(decoded.url);
        if (!img.ok) throw new Error(`Could not download the generated image: HTTP ${img.status}`);
        fs.writeFileSync(dest, Buffer.from(await img.arrayBuffer()));
    }

    return {
        status: 'completed',
        engine: 'openrouter',
        model: body.model,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        file: { path: dest, bytes: fs.statSync(dest).size },
        ...accounting,
    };
}

module.exports = { listImageModels, generateImage, keyStatus, saveKey, deleteKey, resolveKey, decodeImage, priceRange, BASE_URL };
