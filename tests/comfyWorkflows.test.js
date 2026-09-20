const test = require('node:test');
const assert = require('node:assert/strict');

const wf = require('../electron/lib/comfyWorkflows');

test('LTX geometry always satisfies the model, in every aspect ratio', () => {
    // The model rejects anything else, and the rejection arrives as a crash
    // minutes into the run rather than as a validation error.
    for (const ar of ['16:9', '9:16', '1:1', '4:3', '3:4', 'nonsense']) {
        for (const secs of [1, 2, 3, 4, 10]) {
            const g = wf.snapVideoGeometry(ar, secs);
            assert.equal(g.width % 32, 0, `${ar}/${secs}s width`);
            assert.equal(g.height % 32, 0, `${ar}/${secs}s height`);
            assert.equal((g.frames - 1) % 8, 0, `${ar}/${secs}s frames must be 8n+1`);
            assert.ok(g.frames >= 9, 'never fewer than 9 frames');
        }
    }
});

test('video stays inside the pixel budget that avoids swap on 16 GB', () => {
    for (const ar of ['16:9', '9:16', '1:1', '4:3']) {
        const g = wf.snapVideoGeometry(ar, 2);
        // Measured ceiling: 512x320 ran in 5 min; above it macOS pages to disk
        // and the same job takes an hour.
        assert.ok(g.width * g.height <= 512 * 320 * 1.2, `${ar} is ${g.width}x${g.height}, too large for 16 GB`);
    }
});

test('image sizes land on multiples of 8 and respect the model base', () => {
    for (const ar of ['1:1', '16:9', '9:16', '4:3', '3:4']) {
        for (const base of [512, 1024]) {
            const { width, height } = wf.imageSize(ar, base);
            assert.equal(width % 8, 0, `${ar}@${base} width`);
            assert.equal(height % 8, 0, `${ar}@${base} height`);
            assert.ok(width >= 256 && height >= 256);
        }
    }
    assert.deepEqual(wf.imageSize('1:1', 1024), { width: 1024, height: 1024 });
    const wide = wf.imageSize('16:9', 512);
    assert.ok(wide.width > wide.height, '16:9 must be landscape');
});

test('the image graph wires every node to the checkpoint it needs', () => {
    const g = wf.textToImage({
        checkpoint: 'model.safetensors', prompt: 'a fox', negativePrompt: 'blurry',
        width: 512, height: 512, steps: 20, cfg: 7.5, seed: 42,
    });
    assert.equal(g.ckpt.inputs.ckpt_name, 'model.safetensors');
    assert.equal(g.pos.inputs.text, 'a fox');
    assert.equal(g.neg.inputs.text, 'blurry');
    assert.deepEqual(g.pos.inputs.clip, ['ckpt', 1], 'CLIP is output 1 of the loader');
    assert.deepEqual(g.dec.inputs.vae, ['ckpt', 2], 'VAE is output 2 of the loader');
    assert.equal(g.run.inputs.seed, 42);
    assert.equal(g.save.class_type, 'SaveImage');
});

test('the video graph loads the T5 encoder separately and saves an animation', () => {
    const g = wf.textToVideo({
        checkpoint: 'ltx.safetensors', textEncoder: 't5xxl_fp16.safetensors',
        prompt: 'a wave', width: 512, height: 320, frames: 49, steps: 30, cfg: 3, seed: 7,
    });
    assert.equal(g.clip.inputs.clip_name, 't5xxl_fp16.safetensors');
    assert.equal(g.clip.inputs.type, 'ltxv');
    assert.equal(g.lat.inputs.length, 49);
    assert.equal(g.noise.inputs.noise_seed, 7);
    assert.equal(g.guide.inputs.cfg, 3);
    assert.equal(g.save.class_type, 'SaveAnimatedWEBP');
    // LTX carries its own VAE inside the checkpoint; a separate VAELoader
    // would be wrong and would fail at run time.
    assert.deepEqual(g.dec.inputs.vae, ['ckpt', 2]);
    assert.equal(Object.values(g).some((n) => n.class_type === 'VAELoader'), false);
});

test('an empty negative prompt still gets the default the model needs', () => {
    const g = wf.textToVideo({
        checkpoint: 'c', textEncoder: 't', prompt: 'x',
        width: 512, height: 320, frames: 9, steps: 30, cfg: 3, seed: 1,
    });
    assert.match(g.neg.inputs.text, /low quality/);
});

test('outputs must not be handed to the renderer as server URLs', () => {
    // Regression: returning ComfyUI's /view URL produced a blank canvas. The
    // window is a file:// page with webSecurity on, so Electron blocks http://
    // subresources — the image fails to load without raising anything. It would
    // also rot, because the app stops the server on quit.
    const src = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'electron', 'lib', 'comfyProvider.js'), 'utf8');

    assert.match(src, /async function materialise/, 'results must be fetched, not linked');
    assert.match(src, /data:\$\{mime\};base64/, 'small results are inlined');
    assert.match(src, /file:\/\/\$\{dest\}/, 'large results are written to disk');

    // The returned object must never carry a raw viewUrl.
    const returnBlock = src.slice(src.indexOf('const promptId = await submit'), src.indexOf("engine: 'comfyui'"));
    assert.doesNotMatch(returnBlock, /viewUrl\(/, 'the generate() result must not expose viewUrl');
});

// ── AnimateDiff camera motion ─────────────────────────────────────────────

test('the eight camera moves map to the LoRA files that exist on disk', () => {
    const moves = Object.keys(wf.CAMERA_MOVES);
    assert.equal(moves.length, 9, 'eight moves plus "none"');
    assert.equal(wf.CAMERA_MOVES.none, null);
    for (const [move, file] of Object.entries(wf.CAMERA_MOVES)) {
        if (move === 'none') continue;
        assert.match(file, /^v2_lora_\w+\.ckpt$/, `${move} must name a v2 LoRA`);
    }
    // v2 is load-bearing: the LoRAs were trained on the v2 motion module and
    // do not work over v1.4, v1.5-v1 or v3.
    assert.ok(Object.values(wf.CAMERA_MOVES).filter(Boolean).every((f) => f.startsWith('v2_lora_')));
});

test('a camera move inserts the LoRA and chains it into the motion model', () => {
    const g = wf.animateDiff({
        checkpoint: 'sd15.safetensors', motionModule: 'mm_sd_v15_v2.ckpt',
        prompt: 'a coast', width: 512, height: 512, seed: 1, cameraMove: 'pan-left', cameraStrength: 0.7,
    });
    assert.equal(g.mlora.inputs.name, 'v2_lora_PanLeft.ckpt');
    assert.equal(g.mlora.inputs.strength, 0.7);
    assert.deepEqual(g.apply.inputs.motion_lora, ['mlora', 0]);
    assert.deepEqual(g.apply.inputs.motion_model, ['motion', 0]);
    assert.deepEqual(g.evolved.inputs.m_models, ['apply', 0]);
    assert.equal(g.evolved.inputs.beta_schedule, 'sqrt_linear (AnimateDiff)');
});

test('without a camera move no LoRA node is created at all', () => {
    for (const move of ['none', undefined]) {
        const g = wf.animateDiff({
            checkpoint: 'a', motionModule: 'b', prompt: 'x',
            width: 512, height: 512, seed: 1, cameraMove: move,
        });
        assert.equal('mlora' in g, false, `${move} must not add a LoRA node`);
        assert.equal('motion_lora' in g.apply.inputs, false);
    }
});

test('frames become the batch, which is how AnimateDiff receives them', () => {
    const g = wf.animateDiff({
        checkpoint: 'a', motionModule: 'b', prompt: 'x',
        width: 512, height: 512, frames: 16, seed: 1,
    });
    assert.equal(g.lat.inputs.batch_size, 16, 'frames ride in batch_size, not a length field');
    assert.equal(g.ctx.inputs.context_length, 16, 'the module was trained on 16');
    assert.equal(g.save.class_type, 'SaveAnimatedWEBP');
});

test('AnimateDiff geometry stays on multiples of 8 around the SD 1.5 base', () => {
    for (const ar of ['16:9', '9:16', '1:1', '4:3']) {
        const { width, height } = wf.animateDiffGeometry(ar, { base: 448 });
        assert.equal(width % 8, 0, `${ar} width`);
        assert.equal(height % 8, 0, `${ar} height`);
        assert.ok(width >= 256 && height >= 256);
    }
});
