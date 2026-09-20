// Local generation for the MCP server: runs stable-diffusion.cpp on this Mac.
//
// Free. No account, no network, no balance. The weights and the Metal-enabled
// binary are the ones the desktop app already downloaded, so there is one copy
// of everything on disk and one catalogue in the repo.
//
// Image only: stable-diffusion.cpp does not do video, and the app's video
// engine (Wan2GP) has no Apple Silicon path.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { LOCAL_MODEL_CATALOG, ZIMAGE_AUXILIARY } = require('../electron/lib/modelCatalog');

/**
 * Where the engine lives. The desktop app keeps this under its Electron user
 * data directory, which on this machine is a symlink to the external SSD.
 * HF_LOCAL_AI_DIR overrides it.
 */
function localAiDir(env = process.env) {
    if (env.HF_LOCAL_AI_DIR) return path.resolve(env.HF_LOCAL_AI_DIR);
    return path.join(os.homedir(), 'Library', 'Application Support', 'open-generative-ai', 'local-ai');
}

function paths(env = process.env) {
    const dir = localAiDir(env);
    return {
        dir,
        binary: path.join(dir, 'bin', 'sd-cli'),
        models: path.join(dir, 'models'),
        tmp: path.join(dir, 'tmp'),
    };
}

/** sd.cpp only accepts dimensions that are multiples of 64. */
function arToDimensions(ar, modelType) {
    const base = (modelType === 'sdxl' || modelType === 'z-image') ? 1024 : 512;
    const wide = Math.round((base * 16) / 9 / 64) * 64;
    const tall = Math.round((base * 4) / 3 / 64) * 64;
    const map = {
        '1:1': [base, base],
        '16:9': [wide, base],
        '9:16': [base, wide],
        '4:3': [tall, base],
        '3:4': [base, tall],
    };
    return map[ar] || [base, base];
}

/** Reports what is installed, so the agent can tell the user what to download. */
function status(env = process.env) {
    const p = paths(env);
    const engineReady = fs.existsSync(p.binary);
    const have = (file) => fs.existsSync(path.join(p.models, file));

    const models = LOCAL_MODEL_CATALOG.map((m) => {
        const needsAux = m.type === 'z-image';
        const missing = [];
        if (!have(m.filename)) missing.push(m.filename);
        if (needsAux) {
            if (!have(ZIMAGE_AUXILIARY.llm.filename)) missing.push(ZIMAGE_AUXILIARY.llm.filename);
            if (!have(ZIMAGE_AUXILIARY.vae.filename)) missing.push(ZIMAGE_AUXILIARY.vae.filename);
        }
        return {
            id: m.id,
            name: m.name,
            type: m.type,
            size_gb: m.sizeGB,
            ready: missing.length === 0,
            missing_files: missing,
            default_steps: m.defaultSteps,
            aspect_ratios: m.aspectRatios || ['1:1', '4:3', '3:4', '16:9', '9:16'],
            description: m.description,
        };
    });

    return {
        engine_ready: engineReady,
        engine_path: p.binary,
        models_dir: p.models,
        ready_models: models.filter((m) => m.ready).map((m) => m.id),
        models,
    };
}

function resolveModel(id, env = process.env) {
    const p = paths(env);
    const model = LOCAL_MODEL_CATALOG.find((m) => m.id === id);
    if (!model) {
        const ids = LOCAL_MODEL_CATALOG.map((m) => m.id).join(', ');
        throw new Error(`Unknown local model "${id}". Available: ${ids}`);
    }
    if (!fs.existsSync(p.binary)) {
        throw new Error(`The local engine is not installed at ${p.binary}. Open the desktop app, Settings > Local Models, and install the sd.cpp engine.`);
    }
    const modelPath = path.join(p.models, model.filename);
    if (!fs.existsSync(modelPath)) {
        throw new Error(`"${model.name}" is not downloaded (${model.sizeGB} GB). Expected at ${modelPath}. Download it in the desktop app, Settings > Local Models.`);
    }
    if (model.type === 'z-image') {
        for (const aux of [ZIMAGE_AUXILIARY.llm, ZIMAGE_AUXILIARY.vae]) {
            if (!fs.existsSync(path.join(p.models, aux.filename))) {
                throw new Error(`"${model.name}" also needs ${aux.filename} (${aux.sizeGB} GB), which is missing from ${p.models}.`);
            }
        }
    }
    return { model, modelPath, paths: p };
}

/** Builds the sd-cli argv. Kept pure so the tests can assert it. */
function buildArgs({ model, modelPath, modelsDir, outPath, prompt, negativePrompt, aspectRatio, steps, cfgScale, seed }) {
    // z-image GGUFs are standalone diffusion transformers: -m would trigger
    // full-model version detection, which fails on these files.
    const modelFlag = (model.type === 'z-image' || model.type === 'flux') ? '--diffusion-model' : '-m';
    const [width, height] = arToDimensions(aspectRatio || '1:1', model.type);

    const args = [
        modelFlag, modelPath,
        '-p', prompt || '',
        '-o', outPath,
        '--steps', String(steps ?? model.defaultSteps ?? 20),
        '-H', String(height),
        '-W', String(width),
        '--cfg-scale', String(cfgScale ?? model.defaultGuidance ?? 7.5),
        '--seed', String(seed),
        '--sampling-method', model.sampler || 'euler_a',
        '-v',
    ];
    if (negativePrompt) args.push('-n', negativePrompt);

    if (model.type === 'z-image') {
        args.push('--llm', path.join(modelsDir, ZIMAGE_AUXILIARY.llm.filename));
        args.push('--vae', path.join(modelsDir, ZIMAGE_AUXILIARY.vae.filename));
        if (model.scheduler) args.push('--scheduler', model.scheduler);
    } else if (model.type === 'sdxl') {
        args.push('--sd-version', 'sdxl');
    } else if (model.type === 'sd2') {
        args.push('--sd-version', 'sd2');
    } else if (model.type === 'flux') {
        args.push('--flux');
    }
    return args;
}

/** True when the engine reported it put the weights on the GPU. */
function usedMetal(log) {
    const m = log.match(/total params memory size = [\d.]+MB \(VRAM ([\d.]+)MB/);
    return m ? Number(m[1]) > 0 : null;
}

/** Never overwrite an earlier render: add -2, -3 ... when the name is taken. */
function uniquePath(dir, base, ext) {
    let candidate = path.join(dir, `${base}${ext}`);
    let n = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${base}-${n}${ext}`);
        n += 1;
    }
    return candidate;
}

async function generate(args, log = () => {}, env = process.env) {
    const { model, modelPath, paths: p } = resolveModel(args.model, env);

    const seed = Number.isFinite(Number(args.seed)) && Number(args.seed) > 0
        ? Math.round(Number(args.seed))
        : Math.floor(Math.random() * 2147483647);

    fs.mkdirSync(p.tmp, { recursive: true });
    const outPath = path.join(p.tmp, `mcp-${Date.now()}.png`);

    const argv = buildArgs({
        model, modelPath, modelsDir: p.models, outPath,
        prompt: args.prompt,
        negativePrompt: args.negative_prompt,
        aspectRatio: args.aspect_ratio,
        steps: args.steps,
        cfgScale: args.cfg_scale,
        seed,
    });

    log(`${model.name}: starting (seed ${seed})`);
    const startedAt = Date.now();

    const stdout = await new Promise((resolve, reject) => {
        const child = spawn(p.binary, argv, {
            env: { ...process.env, DYLD_LIBRARY_PATH: path.dirname(p.binary) },
        });
        let out = '';
        let lastStep = 0;
        const timeoutMs = Number(args.timeout_minutes || 15) * 60 * 1000;
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Local generation exceeded ${Math.round(timeoutMs / 60000)} min and was stopped.`));
        }, timeoutMs);

        const onChunk = (buf) => {
            const text = buf.toString();
            out += text;
            const step = [...text.matchAll(/(\d+)\/(\d+)/g)].pop();
            if (step && Number(step[1]) !== lastStep) {
                lastStep = Number(step[1]);
                log(`${model.name}: step ${step[1]}/${step[2]}`);
            }
        };
        child.stdout.on('data', onChunk);
        child.stderr.on('data', onChunk);

        child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Could not start the local engine: ${err.message}`)); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(out);
            else reject(new Error(`Local engine exited with code ${code}. Last output: ${out.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`));
        });
    });

    if (!fs.existsSync(outPath)) throw new Error('The local engine finished but wrote no image.');

    const outDir = path.resolve(args.output_dir || process.env.HF_OUTPUT_DIR || path.join(os.homedir(), 'Downloads', 'higgsfield'));
    fs.mkdirSync(outDir, { recursive: true });
    // The model id is part of the name on purpose: the same prompt and seed on
    // two different models are exactly the comparison worth keeping, and
    // without it the second run silently overwrites the first.
    const base = require('./server-utils').slug(args.prompt || model.id);
    const dest = uniquePath(outDir, `${base}-${model.id}-${seed}`, '.png');
    // rename() cannot cross devices, and it routinely would here: the engine's
    // scratch dir lives on the external SSD while the output usually does not.
    try {
        fs.renameSync(outPath, dest);
    } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.copyFileSync(outPath, dest);
        fs.unlinkSync(outPath);
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    return {
        status: 'completed',
        engine: 'stable-diffusion.cpp',
        model: model.id,
        cost_usd: 0,
        seed,
        seconds,
        metal: usedMetal(stdout),
        file: { path: dest, bytes: fs.statSync(dest).size },
        note: 'Generated on this Mac. Nothing was sent anywhere and nothing was charged.',
    };
}

module.exports = { status, generate, buildArgs, arToDimensions, resolveModel, paths, localAiDir, usedMetal, uniquePath };
