// ComfyUI provider: local image and video, from inside the app.
//
// ComfyUI is a Python server. Rather than making the user open a terminal and
// a browser, the app starts it on demand, talks to it over HTTP on loopback,
// and stops it when the app quits so the weights do not sit in RAM.
//
// Why this exists next to the sd.cpp engine: on this hardware ComfyUI is about
// nine times faster for the same image (25 s against 228 s), and it is the only
// local path that produces video at all.

const { ipcMain, app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const workflows = require('./comfyWorkflows');

const HOST = '127.0.0.1';
const PORT = Number(process.env.OGAI_COMFY_PORT) || 8188;
const BASE = `http://${HOST}:${PORT}`;
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'local-ai', 'comfyui.json');

let child = null;          // the server we started ourselves
let startingPromise = null;
let cancelled = false;

// ── Install discovery ─────────────────────────────────────────────────────

const CANDIDATE_DIRS = [
    '/Volumes/Hiex4_Dados/ComfyUI',
    path.join(os.homedir(), 'ComfyUI'),
    path.join(os.homedir(), 'Dev', 'ComfyUI'),
];

function readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
    const file = CONFIG_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

/** A directory is a usable install when it has main.py and a venv python. */
function inspectDir(dir) {
    if (!dir) return null;
    const python = path.join(dir, '.venv', 'bin', 'python');
    const main = path.join(dir, 'main.py');
    if (!fs.existsSync(python) || !fs.existsSync(main)) return null;
    return { dir, python, main };
}

function findInstall() {
    const saved = readConfig().dir;
    const fromConfig = inspectDir(saved);
    if (fromConfig) return fromConfig;
    for (const dir of CANDIDATE_DIRS) {
        const found = inspectDir(dir);
        if (found) return found;
    }
    return null;
}

function listModels(install) {
    const read = (sub) => {
        try {
            return fs.readdirSync(path.join(install.dir, 'models', sub))
                .filter((f) => /\.(safetensors|ckpt|gguf)$/i.test(f));
        } catch { return []; }
    };
    return {
        checkpoints: read('checkpoints'),
        textEncoders: read('text_encoders'),
        motionModules: read('animatediff_models'),
        motionLoras: read('animatediff_motion_lora'),
    };
}

// ── Server lifecycle ──────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ping(timeoutMs = 1500) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(`${BASE}/system_stats`, { signal: ctrl.signal });
        clearTimeout(t);
        return res.ok ? res.json() : null;
    } catch {
        return null;
    }
}

async function status() {
    const install = findInstall();
    const stats = await ping();
    return {
        installed: Boolean(install),
        dir: install?.dir || readConfig().dir || '',
        running: Boolean(stats),
        managedByApp: Boolean(child),
        url: BASE,
        device: stats?.devices?.[0]?.name || '',
        models: install ? listModels(install) : { checkpoints: [], textEncoders: [] },
    };
}

/** Starts the server if it is not already answering, and waits until it is. */
async function ensureRunning(onProgress = () => {}) {
    if (await ping()) return { ok: true, alreadyRunning: true };
    if (startingPromise) return startingPromise;

    const install = findInstall();
    if (!install) {
        throw new Error('ComfyUI não encontrado. Aponte a pasta em Settings → ComfyUI.');
    }

    startingPromise = (async () => {
        onProgress({ status: 'starting', message: 'Iniciando o ComfyUI...' });
        child = spawn(install.python, ['main.py', '--listen', HOST, '--port', String(PORT)], {
            cwd: install.dir,
            env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', (b) => onProgress({ status: 'starting', message: String(b).trim().slice(-120) }));
        child.stderr?.on('data', (b) => onProgress({ status: 'starting', message: String(b).trim().slice(-120) }));
        child.on('exit', () => { child = null; });

        // Loading torch takes a while on a cold start; 90 s is generous but finite.
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            if (!child) throw new Error('O ComfyUI encerrou durante a inicialização.');
            if (await ping()) {
                onProgress({ status: 'ready', message: 'ComfyUI pronto.' });
                return { ok: true, alreadyRunning: false };
            }
            await sleep(1500);
        }
        stop();
        throw new Error('O ComfyUI não respondeu em 90 s.');
    })().finally(() => { startingPromise = null; });

    return startingPromise;
}

function stop() {
    if (!child) return { ok: true, wasRunning: false };
    child.kill('SIGTERM');
    child = null;
    return { ok: true, wasRunning: true };
}

// ── Generation ────────────────────────────────────────────────────────────

async function submit(prompt) {
    const res = await fetch(`${BASE}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: 'open-generative-ai' }),
    });
    if (!res.ok) {
        let detail = '';
        try {
            const body = await res.json();
            // ComfyUI reports which node rejected the graph, which is the only
            // part worth showing: the rest is a full traceback.
            detail = body?.error?.message || body?.node_errors
                ? `${body?.error?.message || ''} ${Object.keys(body?.node_errors || {}).join(', ')}`.trim()
                : '';
        } catch { /* ignore */ }
        throw new Error(`ComfyUI recusou o pedido (HTTP ${res.status}). ${detail}`.trim());
    }
    return (await res.json()).prompt_id;
}

function outputsOf(history) {
    const files = [];
    for (const out of Object.values(history?.outputs || {})) {
        for (const item of [...(out.images || []), ...(out.gifs || []), ...(out.videos || [])]) {
            files.push(item);
        }
    }
    return files;
}

function viewUrl(item) {
    const q = new URLSearchParams({
        filename: item.filename,
        subfolder: item.subfolder || '',
        type: item.type || 'output',
    });
    return `${BASE}/view?${q}`;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const INLINE_LIMIT = 40 * 1024 * 1024;

/**
 * Turns a ComfyUI output into something the renderer can actually display.
 *
 * The obvious answer — hand over the server's /view URL — does not work: the
 * window is a file:// page with webSecurity on, so Electron blocks http://
 * subresources, and the image silently fails to load. It would also rot, since
 * the app stops the server on quit and every history entry would break.
 *
 * So the bytes are fetched here and returned inline. Anything unusually large
 * is written next to the app's data instead, to keep a video out of a string.
 */
async function materialise(item) {
    const res = await fetch(viewUrl(item));
    if (!res.ok) throw new Error(`Não consegui ler o resultado do ComfyUI (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(item.filename).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    if (buf.length <= INLINE_LIMIT) {
        return `data:${mime};base64,${buf.toString('base64')}`;
    }
    const dir = path.join(app.getPath('userData'), 'comfy-output');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${Date.now()}-${item.filename}`);
    fs.writeFileSync(dest, buf);
    return `file://${dest}`;
}

async function waitFor(promptId, onProgress, maxMs) {
    const started = Date.now();
    let lastPct = -1;
    while (Date.now() - started < maxMs) {
        if (cancelled) throw new Error('Cancelado.');

        const hist = await (await fetch(`${BASE}/history/${promptId}`)).json().catch(() => ({}));
        if (hist[promptId]) {
            const st = hist[promptId].status;
            if (st?.status_str !== 'success') {
                const msgs = (st?.messages || []).slice(-2).map((m) => JSON.stringify(m).slice(0, 200)).join(' | ');
                throw new Error(`A geração falhou. ${msgs}`);
            }
            return outputsOf(hist[promptId]);
        }

        // /prompt exposes queue depth; progress comes from the running node.
        const prog = await (await fetch(`${BASE}/prompt`)).json().catch(() => null);
        const remaining = prog?.exec_info?.queue_remaining;
        const secs = Math.round((Date.now() - started) / 1000);
        const pct = Math.min(95, Math.round((secs / (maxMs / 1000)) * 100));
        if (pct !== lastPct) {
            lastPct = pct;
            onProgress({ status: 'in_progress', progress: pct / 100, message: `ComfyUI: ${secs}s${remaining ? ` (fila ${remaining})` : ''}` });
        }
        await sleep(2000);
    }
    throw new Error(`A geração passou de ${Math.round(maxMs / 60000)} min e foi abandonada.`);
}

function emit(win, payload) {
    if (win && !win.isDestroyed()) win.webContents.send('local-ai:progress', payload);
}

async function generate(params, win) {
    cancelled = false;
    const install = findInstall();
    if (!install) throw new Error('ComfyUI não encontrado. Aponte a pasta em Settings → ComfyUI.');

    const onProgress = (p) => emit(win, p);
    await ensureRunning(onProgress);

    const { checkpoints, textEncoders } = listModels(install);
    const seed = Number.isFinite(Number(params.seed)) && Number(params.seed) > 0
        ? Math.round(Number(params.seed))
        : Math.floor(Math.random() * 2147483647);

    let graph;
    let maxMs;
    if (params.kind === 'motion') {
        // AnimateDiff over SD 1.5: slower per second of footage than LTX, but
        // the only local route with a named camera movement.
        const checkpoint = params.checkpoint || checkpoints.find((c) => !/ltx/i.test(c));
        if (!checkpoint) throw new Error('Nenhum modelo SD 1.5 encontrado em models/checkpoints.');
        const motionModule = params.motionModule || listModels(install).motionModules[0];
        if (!motionModule) throw new Error('Módulo de movimento não encontrado em models/animatediff_models.');

        graph = workflows.animateDiff({
            checkpoint, motionModule,
            prompt: params.prompt,
            negativePrompt: params.negative_prompt,
            ...workflows.animateDiffGeometry(params.aspect_ratio || '16:9', { base: 448 }),
            frames: 16,
            steps: Number(params.steps) || 20,
            cfg: Number(params.cfg_scale) || 7.5,
            seed,
            fps: 8,
            cameraMove: params.cameraMove || 'none',
            cameraStrength: Number(params.cameraStrength) || 0.8,
        });
        maxMs = 45 * 60 * 1000;
    } else if (params.kind === 'video') {
        const checkpoint = params.checkpoint || checkpoints.find((c) => /ltx/i.test(c));
        if (!checkpoint) throw new Error('Nenhum modelo de vídeo encontrado. Baixe um LTX-Video para models/checkpoints.');
        const textEncoder = params.textEncoder || textEncoders.find((t) => /t5xxl/i.test(t));
        if (!textEncoder) throw new Error('Codificador de texto T5 não encontrado em models/text_encoders.');

        const geom = workflows.snapVideoGeometry(params.aspect_ratio || '16:9', Number(params.seconds) || 2);
        graph = workflows.textToVideo({
            checkpoint, textEncoder,
            prompt: params.prompt,
            negativePrompt: params.negative_prompt,
            ...geom,
            steps: Number(params.steps) || 30,
            cfg: Number(params.cfg_scale) || 3.0,
            seed,
        });
        maxMs = 45 * 60 * 1000;
    } else {
        const checkpoint = params.checkpoint || checkpoints.find((c) => !/ltx/i.test(c));
        if (!checkpoint) throw new Error('Nenhum modelo de imagem encontrado em models/checkpoints.');
        const isXl = /xl|1024/i.test(checkpoint);
        graph = workflows.textToImage({
            checkpoint,
            prompt: params.prompt,
            negativePrompt: params.negative_prompt,
            ...workflows.imageSize(params.aspect_ratio || '1:1', isXl ? 1024 : 512),
            steps: Number(params.steps) || 20,
            cfg: Number(params.cfg_scale) || 7.5,
            seed,
        });
        maxMs = 20 * 60 * 1000;
    }

    const promptId = await submit(graph);
    const files = await waitFor(promptId, onProgress, maxMs);
    if (!files.length) throw new Error('A geração terminou sem produzir arquivo.');

    onProgress({ status: 'in_progress', progress: 0.98, message: 'Carregando o resultado...' });
    const urls = [];
    for (const file of files) urls.push(await materialise(file));

    emit(win, { status: 'completed', progress: 1, message: 'Pronto' });
    return {
        url: urls[0],
        mediaType: (params.kind === 'video' || params.kind === 'motion') ? 'video' : 'image',
        allUrls: urls,
        seed,
        engine: 'comfyui',
        cost_usd: 0,
    };
}

function cancel() {
    cancelled = true;
    fetch(`${BASE}/interrupt`, { method: 'POST' }).catch(() => {});
    return { ok: true };
}

// ── Wiring ────────────────────────────────────────────────────────────────

function getWindow() {
    return BrowserWindow.getAllWindows()[0] || null;
}

function register() {
    ipcMain.handle('comfy:status', () => status());
    ipcMain.handle('comfy:set-dir', (_, dir) => {
        const found = inspectDir(dir);
        if (!found) throw new Error(`Não encontrei main.py e .venv/bin/python em ${dir}.`);
        writeConfig({ dir: found.dir });
        return { ok: true, dir: found.dir };
    });
    ipcMain.handle('comfy:start', () => ensureRunning((p) => emit(getWindow(), p)));
    ipcMain.handle('comfy:stop', () => stop());
    ipcMain.handle('comfy:generate', (_, params) => generate(params, getWindow()));
    ipcMain.handle('comfy:cancel', () => cancel());

    // Never leave a Python server behind when the app closes.
    app.on('before-quit', stop);
    app.on('will-quit', stop);
}

module.exports = { register, status, ensureRunning, stop, findInstall, listModels, snapVideoGeometry: workflows.snapVideoGeometry, CAMERA_MOVES: workflows.CAMERA_MOVES };
