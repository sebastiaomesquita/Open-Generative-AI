#!/usr/bin/env node
// Higgsfield MCP server (stdio) — for Claude Code on this Mac.
//
// Two engines behind one server:
//   - local: stable-diffusion.cpp on this Mac's GPU. Free, offline, images only.
//   - cloud: the Higgsfield API. Costs money, does video, much higher quality.
// Prefer local unless the user asks for video or for a cloud-only model.
//
// Why this exists next to the official remote MCP at mcp.higgsfield.ai:
//   - it bills the pay-per-use API balance, not the higgsfield.ai plan credits
//   - it writes the result to disk, where the agent is already working
//     (outputs on Higgsfield's CDN expire in about 7 days)
//   - it prices every job first and refuses to overspend on its own
//   - it shares the catalogue with the desktop app, so both stay in step
//
// Transport is stdio, which only Claude Code can use: a custom connector for
// Chat or Cowork is dialled from Anthropic's cloud and cannot reach this Mac.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { toPublic, getModelById, buildInput } = require('../electron/lib/higgsfieldCatalog');
const { resolveCredentials, credentialStatus, saveToKeychain, deleteFromKeychain } = require('./credentialStore');
const api = require('./api');
const local = require('./local');
const guard = require('./spendGuard');

const VERSION = '0.1.0';

function defaultOutputDir() {
    return process.env.HF_OUTPUT_DIR || path.join(os.homedir(), 'Downloads', 'higgsfield');
}

const slug = (s) => String(s || 'output').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'output';

// ── Tool implementations ──────────────────────────────────────────────────

function listModels({ kind } = {}) {
    const models = toPublic().filter((m) => !kind || m.kind === kind);
    return {
        count: models.length,
        spend_ceiling_usd: guard.ceiling(),
        credential: credentialStatus(),
        models: models.map((m) => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            endpoint: m.endpoint,
            description: m.description,
            needs_image: Boolean(m.needsImage),
            aspect_ratios: m.aspectRatios,
            durations: m.durations,
            qualities: m.qualities,
        })),
    };
}

async function estimateTool(args) {
    const creds = resolveCredentials();
    const model = getModelById(args.model);
    if (!model) throw new Error(`Unknown model "${args.model}". Call higgsfield_list_models first.`);
    const input = buildInput(model.id, args);
    const price = await api.estimate(creds, model.endpoint, input);
    return {
        model: model.id,
        endpoint: model.endpoint,
        input,
        credits: price.credits,
        usd: price.usd,
        within_ceiling: guard.check(price.usd, undefined).allowed,
        spend_ceiling_usd: guard.ceiling(),
    };
}

async function uploadTool(args) {
    const creds = resolveCredentials();
    const file = path.resolve(args.path);
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    const { url, contentType } = await api.uploadFile(creds, file);
    return { url, content_type: contentType, note: 'Public URL, valid for use as image_url. Higgsfield keeps uploads temporarily.' };
}

async function generateTool(args, log) {
    const creds = resolveCredentials();
    const model = getModelById(args.model);
    if (!model) throw new Error(`Unknown model "${args.model}". Call higgsfield_list_models first.`);

    const input = buildInput(model.id, args);

    // 1. Price it before spending anything.
    let price = { credits: null, usd: null };
    let priceError = null;
    try {
        price = await api.estimate(creds, model.endpoint, input);
    } catch (err) {
        priceError = err.message;
    }

    const verdict = guard.check(price.usd, args.approve_usd);
    if (!verdict.allowed) {
        return {
            status: 'refused',
            reason: verdict.reason,
            estimate_error: priceError,
            model: model.id,
            estimated_usd: price.usd,
            spend_ceiling_usd: verdict.max,
            input,
        };
    }

    if (args.dry_run) {
        return { status: 'dry_run', model: model.id, endpoint: model.endpoint, input, estimated_usd: price.usd, credits: price.credits };
    }

    // 2. Submit and wait.
    log(`submitting ${model.id} (estimated US$ ${price.usd ?? '?'})`);
    const submitted = await api.submit(creds, model.endpoint, input);
    const final = await api.poll(creds, submitted, {
        maxMs: Number(args.timeout_minutes || 20) * 60 * 1000,
        onTick: (status, secs) => log(`${model.id}: ${status} (${secs}s)`),
    });

    if (final.status !== 'completed') {
        // failed / nsfw / canceled all refund, per the billing docs.
        return {
            status: final.status,
            request_id: final.request_id,
            error: final.error || null,
            charged: false,
            note: 'Higgsfield refunds anything that does not complete.',
        };
    }

    // 3. Save it locally — CDN links expire in about 7 days.
    const urls = api.outputUrls(final);
    if (!urls.length) throw new Error(`Job completed but returned no media (request ${final.request_id}).`);

    const outDir = path.resolve(args.output_dir || defaultOutputDir());
    const base = `${slug(args.prompt || model.id)}-${String(final.request_id || Date.now()).slice(0, 8)}`;
    const files = [];
    for (const [i, url] of urls.entries()) {
        files.push(await api.download(url, outDir, urls.length > 1 ? `${base}-${i + 1}` : base));
    }

    return {
        status: 'completed',
        model: model.id,
        request_id: final.request_id,
        estimated_usd: price.usd,
        credits: price.credits,
        files: files.map((f) => ({ path: f.path, bytes: f.bytes })),
        remote_urls: urls,
        note: 'Remote URLs expire in about 7 days; the local files do not.',
    };
}

// ── MCP wiring ────────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'local_status',
        description: 'Show which local image models are downloaded and ready to run on this Mac, and which are missing. Local generation is FREE, offline, and needs no account. Call this before local_generate.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'local_generate',
        description: 'Generate an image on this Mac with stable-diffusion.cpp, using the GPU. FREE: no account, no network, no spending. Images only, no video. Slower and lower quality than the cloud models, so it suits drafts, iteration and anything private. Saves the file to disk and returns its path.',
        inputSchema: {
            type: 'object',
            required: ['model', 'prompt'],
            properties: {
                model: { type: 'string', description: 'Local model id from local_status, e.g. dreamshaper-8 or z-image-turbo.' },
                prompt: { type: 'string', description: 'What to draw. English works best with these models.' },
                negative_prompt: { type: 'string', description: 'What to avoid. Local models support this; the cloud ones do not.' },
                aspect_ratio: { type: 'string', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'], description: 'Default 1:1.' },
                steps: { type: 'number', description: 'More steps, more detail and more time. The model default is usually right.' },
                cfg_scale: { type: 'number', description: 'How strictly to follow the prompt. Around 7.5 for SD 1.5, 1.0 for Z-Image Turbo.' },
                seed: { type: 'number', description: 'Reuse a seed to reproduce an image exactly.' },
                output_dir: { type: 'string', description: 'Where to save. Defaults to HF_OUTPUT_DIR or ~/Downloads/higgsfield.' },
                timeout_minutes: { type: 'number', description: 'Default 15.' },
            },
        },
    },
    {
        name: 'higgsfield_list_models',
        description: 'List the Higgsfield image and video models this server can run, with their allowed aspect ratios, durations and whether they need a reference image. Also reports whether a credential is configured and the current spend ceiling. Call this before generating.',
        inputSchema: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['image', 'video'], description: 'Filter by media type.' } },
        },
    },
    {
        name: 'higgsfield_estimate',
        description: 'Price a generation without running it. Returns the cost in US dollars and credits for the exact parameters given. Use this whenever the user asks what something will cost, or before an expensive video.',
        inputSchema: {
            type: 'object',
            required: ['model'],
            properties: {
                model: { type: 'string', description: 'Model id from higgsfield_list_models.' },
                prompt: { type: 'string' },
                aspect_ratio: { type: 'string' },
                duration: { type: 'number', description: 'Seconds, for video models.' },
                quality: { type: 'string', description: 'Resolution, e.g. 720p or 1080p.' },
                image_url: { type: 'string', description: 'Public HTTPS URL, required by image-to-video models.' },
                seed: { type: 'number' },
            },
        },
    },
    {
        name: 'higgsfield_generate',
        description: 'Generate an image or video with Higgsfield and save it to disk. SPENDS REAL MONEY from the pay-per-use API balance. The job is priced first and refused above the spend ceiling unless approve_usd is given. Returns the local file paths; remote URLs expire in about 7 days.',
        inputSchema: {
            type: 'object',
            required: ['model'],
            properties: {
                model: { type: 'string', description: 'Model id from higgsfield_list_models.' },
                prompt: { type: 'string', description: 'Required except for image-to-video models.' },
                aspect_ratio: { type: 'string', description: 'Ignored by image-to-video models, which follow the source frame.' },
                duration: { type: 'number', description: 'Seconds, for video models.' },
                quality: { type: 'string', description: 'Resolution, e.g. 720p or 1080p.' },
                image_url: { type: 'string', description: 'Public HTTPS URL. Use higgsfield_upload_image for a local file.' },
                end_image_url: { type: 'string', description: 'Optional final frame, on the models that support it.' },
                seed: { type: 'number', description: 'Only Soul and Wan accept a seed.' },
                output_dir: { type: 'string', description: 'Where to save. Defaults to HF_OUTPUT_DIR or ~/Downloads/higgsfield.' },
                approve_usd: { type: 'number', description: 'Explicit budget for this call, in US dollars. Required when the price is above the ceiling.' },
                dry_run: { type: 'boolean', description: 'Price and validate the request without running it.' },
                timeout_minutes: { type: 'number', description: 'How long to wait. Default 20.' },
            },
        },
    },
    {
        name: 'higgsfield_upload_image',
        description: 'Upload a local image to Higgsfield and return a public HTTPS URL, for use as image_url in an image-to-video generation. Free.',
        inputSchema: {
            type: 'object',
            required: ['path'],
            properties: { path: { type: 'string', description: 'Absolute path to a jpg, png, webp or gif file.' } },
        },
    },
];

async function dispatch(name, args, log) {
    switch (name) {
        case 'local_status': return local.status();
        case 'local_generate': return local.generate(args || {}, log);
        case 'higgsfield_list_models': return listModels(args || {});
        case 'higgsfield_estimate': return estimateTool(args || {});
        case 'higgsfield_generate': return generateTool(args || {}, log);
        case 'higgsfield_upload_image': return uploadTool(args || {});
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

async function main() {
    const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

    const server = new Server({ name: 'higgsfield-local', version: VERSION }, { capabilities: { tools: {} } });
    // stdout is the protocol channel; progress notes go to stderr.
    const log = (msg) => process.stderr.write(`[higgsfield] ${msg}\n`);

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        try {
            const result = await dispatch(req.params.name, req.params.arguments, log);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
            log(`error in ${req.params.name}: ${err.message}`);
            return { isError: true, content: [{ type: 'text', text: err.message }] };
        }
    });

    await server.connect(new StdioServerTransport());
    const l = local.status();
    log(`ready (v${VERSION}); local: ${l.engine_ready ? `${l.ready_models.length} model(s)` : 'engine missing'}; cloud credential: ${credentialStatus().origin}; ceiling: US$ ${guard.ceiling()}`);
}

// ── CLI helpers (not part of the MCP protocol) ────────────────────────────

if (require.main === module) {
    const [flag, value] = process.argv.slice(2);
    if (flag === '--save-credential') {
        if (!value) { console.error('Usage: node mcp/server.js --save-credential KEY_ID:KEY_SECRET'); process.exit(1); }
        const { keyId } = saveToKeychain(value);
        console.log(`Saved to the macOS keychain (service "higgsfield-mcp"). Key id: ${keyId}`);
        process.exit(0);
    } else if (flag === '--delete-credential') {
        console.log(deleteFromKeychain().ok ? 'Credential removed from the keychain.' : 'No credential found.');
        process.exit(0);
    } else if (flag === '--status') {
        const l = local.status();
        console.log(JSON.stringify({
            version: VERSION,
            local_engine_ready: l.engine_ready,
            local_models_ready: l.ready_models,
            cloud_credential: credentialStatus(),
            ceiling_usd: guard.ceiling(),
            output_dir: defaultOutputDir(),
        }, null, 2));
        process.exit(0);
    } else if (flag === '--self-test') {
        console.log(JSON.stringify({ local: local.status(), cloud: listModels({}) }, null, 2));
        process.exit(0);
    } else {
        main().catch((err) => { process.stderr.write(`[higgsfield] fatal: ${err.stack}\n`); process.exit(1); });
    }
}

module.exports = { TOOLS, dispatch, listModels, defaultOutputDir, slug };
