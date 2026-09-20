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

module.exports = { textToImage, textToVideo, imageSize, snapVideoGeometry, AR_TO_SIZE };
