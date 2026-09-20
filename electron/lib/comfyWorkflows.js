// Workflows in ComfyUI's API format, parameterised.
//
// Kept in their own module, free of Electron, so the shapes can be unit-tested
// without a running server. Every field here was verified against a real
// generation on an M1 Pro: image in 25 s, video in 5 min.

/** SD 1.5 / SDXL text-to-image through an all-in-one checkpoint. */
function textToImage({ checkpoint, prompt, negativePrompt = '', width, height, steps, cfg, seed, sampler = 'euler_ancestral' }) {
    return {
        ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
        pos: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['ckpt', 1] } },
        neg: { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['ckpt', 1] } },
        lat: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
        run: {
            class_type: 'KSampler',
            inputs: {
                seed, steps, cfg, sampler_name: sampler, scheduler: 'normal', denoise: 1.0,
                model: ['ckpt', 0], positive: ['pos', 0], negative: ['neg', 0], latent_image: ['lat', 0],
            },
        },
        dec: { class_type: 'VAEDecode', inputs: { samples: ['run', 0], vae: ['ckpt', 2] } },
        save: { class_type: 'SaveImage', inputs: { images: ['dec', 0], filename_prefix: 'ogai_image' } },
    };
}

/**
 * LTX-Video text-to-video. The checkpoint carries its own VAE, so only the T5
 * text encoder is loaded separately.
 *
 * The model is strict about geometry: sides must divide by 32 and the frame
 * count must be a multiple of 8 plus 1. `snapVideoGeometry` enforces that
 * before anything reaches the GPU, because the failure is a crash five minutes
 * in, not a validation error.
 */
function textToVideo({ checkpoint, textEncoder, prompt, negativePrompt = '', width, height, frames, steps, cfg, seed, fps = 24 }) {
    return {
        ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
        clip: { class_type: 'CLIPLoader', inputs: { clip_name: textEncoder, type: 'ltxv' } },
        pos: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['clip', 0] } },
        neg: { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt || 'low quality, worst quality, deformed, distorted, watermark', clip: ['clip', 0] } },
        cond: { class_type: 'LTXVConditioning', inputs: { positive: ['pos', 0], negative: ['neg', 0], frame_rate: 25.0 } },
        lat: { class_type: 'EmptyLTXVLatentVideo', inputs: { width, height, length: frames, batch_size: 1 } },
        sched: { class_type: 'LTXVScheduler', inputs: { steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: ['lat', 0] } },
        samp: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
        guide: { class_type: 'CFGGuider', inputs: { model: ['ckpt', 0], positive: ['cond', 0], negative: ['cond', 1], cfg } },
        noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
        run: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guide', 0], sampler: ['samp', 0], sigmas: ['sched', 0], latent_image: ['lat', 0] } },
        dec: { class_type: 'VAEDecode', inputs: { samples: ['run', 0], vae: ['ckpt', 2] } },
        save: { class_type: 'SaveAnimatedWEBP', inputs: { images: ['dec', 0], filename_prefix: 'ogai_video', fps, lossless: false, quality: 85, method: 'default' } },
    };
}

const AR_TO_SIZE = {
    '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16], '4:3': [4, 3], '3:4': [3, 4],
};

/** Image side lengths, snapped to the multiple of 8 that diffusion models need. */
function imageSize(aspectRatio, base = 512) {
    const [w, h] = AR_TO_SIZE[aspectRatio] || [1, 1];
    const scale = base / Math.sqrt(w * h);
    const snap = (v) => Math.max(256, Math.round((v * scale) / 8) * 8);
    return { width: snap(w), height: snap(h) };
}

/**
 * LTX geometry: sides divisible by 32, frames divisible by 8 plus 1.
 * Also caps the pixel budget, because on 16 GB the failure mode above it is
 * swap, which turns five minutes into an hour rather than raising an error.
 */
function snapVideoGeometry(aspectRatio, seconds = 2, fps = 24, { maxPixels = 512 * 320 } = {}) {
    const [rw, rh] = AR_TO_SIZE[aspectRatio] || [16, 9];
    const scale = Math.sqrt(maxPixels / (rw * rh));
    const snap32 = (v) => Math.max(160, Math.round((v * scale) / 32) * 32);
    const width = snap32(rw);
    const height = snap32(rh);

    const wanted = Math.round(seconds * fps);
    const frames = Math.max(9, Math.round((wanted - 1) / 8) * 8 + 1);
    return { width, height, frames };
}


/**
 * The eight camera moves AnimateDiff ships as motion LoRAs, keyed by a plain
 * name. They only work over the v2 motion module on an SD 1.5 checkpoint:
 * there is no SDXL equivalent and none was ever published for LTX.
 */
const CAMERA_MOVES = {
    none: null,
    'pan-left': 'v2_lora_PanLeft.ckpt',
    'pan-right': 'v2_lora_PanRight.ckpt',
    'zoom-in': 'v2_lora_ZoomIn.ckpt',
    'zoom-out': 'v2_lora_ZoomOut.ckpt',
    'tilt-up': 'v2_lora_TiltUp.ckpt',
    'tilt-down': 'v2_lora_TiltDown.ckpt',
    'roll-cw': 'v2_lora_RollingClockwise.ckpt',
    'roll-ccw': 'v2_lora_RollingAnticlockwise.ckpt',
};

/**
 * AnimateDiff over SD 1.5: the cheapest video this machine can make, and the
 * only local route with named camera movement.
 *
 * Geometry differs from LTX: SD 1.5 wants multiples of 8 around a 512 base, and
 * the motion module was trained on 16 frames, so going far past that degrades
 * rather than extends.
 */
function animateDiff({ checkpoint, motionModule, prompt, negativePrompt = '', width, height, frames = 16, steps = 20, cfg = 7.5, seed, fps = 8, cameraMove = 'none', cameraStrength = 0.8 }) {
    const graph = {
        ckpt: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
        motion: { class_type: 'ADE_LoadAnimateDiffModel', inputs: { model_name: motionModule } },
        pos: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['ckpt', 1] } },
        neg: { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt || 'blurry, distorted, watermark, text, low quality', clip: ['ckpt', 1] } },
        lat: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: frames } },
        ctx: {
            class_type: 'ADE_AnimateDiffUniformContextOptions',
            inputs: { context_length: 16, context_stride: 1, context_overlap: 4, context_schedule: 'uniform', closed_loop: false },
        },
    };

    const loraFile = CAMERA_MOVES[cameraMove];
    if (loraFile) {
        graph.mlora = { class_type: 'ADE_AnimateDiffLoRALoader', inputs: { name: loraFile, strength: cameraStrength } };
        graph.apply = { class_type: 'ADE_ApplyAnimateDiffModelSimple', inputs: { motion_model: ['motion', 0], motion_lora: ['mlora', 0] } };
    } else {
        graph.apply = { class_type: 'ADE_ApplyAnimateDiffModelSimple', inputs: { motion_model: ['motion', 0] } };
    }

    graph.evolved = {
        class_type: 'ADE_UseEvolvedSampling',
        inputs: { model: ['ckpt', 0], beta_schedule: 'sqrt_linear (AnimateDiff)', m_models: ['apply', 0], context_options: ['ctx', 0] },
    };
    graph.run = {
        class_type: 'KSampler',
        inputs: {
            seed, steps, cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
            model: ['evolved', 0], positive: ['pos', 0], negative: ['neg', 0], latent_image: ['lat', 0],
        },
    };
    graph.dec = { class_type: 'VAEDecode', inputs: { samples: ['run', 0], vae: ['ckpt', 2] } };
    graph.save = { class_type: 'SaveAnimatedWEBP', inputs: { images: ['dec', 0], filename_prefix: 'ogai_motion', fps, lossless: false, quality: 85, method: 'default' } };
    return graph;
}

/** SD 1.5 geometry for AnimateDiff: multiples of 8 around a 512 base. */
function animateDiffGeometry(aspectRatio, { base = 512 } = {}) {
    const [rw, rh] = AR_TO_SIZE[aspectRatio] || [1, 1];
    const scale = base / Math.sqrt(rw * rh);
    const snap = (v) => Math.max(256, Math.round((v * scale) / 8) * 8);
    return { width: snap(rw), height: snap(rh) };
}

module.exports = {
    animateDiff, animateDiffGeometry, CAMERA_MOVES, textToImage, textToVideo, imageSize, snapVideoGeometry, AR_TO_SIZE };
