// Assembly with ffmpeg: frames to clips, clips to a piece.
//
// No Electron here, so the command building can be unit-tested. Nothing in this
// module shells out by itself; it returns argument lists and the caller runs
// them. That keeps the part most likely to be wrong — the filtergraph — visible
// and testable.

const path = require('node:path');

/**
 * The transitions worth offering out of ffmpeg's 58. The rest are either
 * gimmicks or read as a slideshow.
 */
const TRANSITIONS = ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'smoothleft', 'smoothright', 'circleopen', 'dissolve'];

const TRANSITION_SECONDS = 0.5;

/** A numbered PNG sequence becomes an h264 clip at a fixed rate. */
function framesToClip({ pattern, fps, outPath, width, height }) {
    return [
        '-y', '-loglevel', 'error',
        '-framerate', String(fps),
        '-i', pattern,
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-r', String(fps),
        outPath,
    ];
}

/** A still (the title card) becomes a clip of a given length, fading in and out. */
function stillToClip({ imagePath, seconds, fps, outPath, width, height, fade = 0.4 }) {
    const out = Math.max(0, seconds - fade);
    return [
        '-y', '-loglevel', 'error',
        '-loop', '1', '-i', imagePath,
        '-t', String(seconds),
        '-vf', [
            `scale=${width}:${height}:force_original_aspect_ratio=increase`,
            `crop=${width}:${height}`,
            `fade=t=in:st=0:d=${fade}`,
            `fade=t=out:st=${out.toFixed(2)}:d=${fade}`,
            'format=yuv420p',
        ].join(','),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-r', String(fps),
        outPath,
    ];
}

/**
 * Chains clips with xfade.
 *
 * The subtlety that bites: each transition overlaps the pair by its own
 * duration, so every offset after the first must subtract the transitions
 * already spent. Getting this wrong does not error — it silently drops the
 * tail of the piece.
 */
function buildXfadeGraph(durations, transitions, { transitionSeconds = TRANSITION_SECONDS } = {}) {
    if (durations.length !== transitions.length + 1) {
        throw new Error(`São necessárias ${durations.length - 1} transições para ${durations.length} clipes.`);
    }

    const steps = [];
    let label = '[0:v]';
    let elapsed = durations[0];

    for (let i = 0; i < transitions.length; i += 1) {
        const offset = Math.max(0, elapsed - transitionSeconds);
        const out = i === transitions.length - 1 ? '[v]' : `[x${i}]`;
        steps.push(`${label}[${i + 1}:v]xfade=transition=${transitions[i]}:duration=${transitionSeconds}:offset=${offset.toFixed(3)}${out}`);
        label = out;
        // The next clip starts where this transition began, not where the
        // previous clip ended — that overlap is the whole point of xfade.
        elapsed = offset + durations[i + 1];
    }
    return steps.join(';');
}

function joinWithTransitions({ clips, durations, transitions, outPath, fps, transitionSeconds = TRANSITION_SECONDS }) {
    if (clips.length === 1) {
        return ['-y', '-loglevel', 'error', '-i', clips[0], '-c', 'copy', outPath];
    }
    const args = ['-y', '-loglevel', 'error'];
    for (const clip of clips) args.push('-i', clip);
    args.push(
        '-filter_complex', buildXfadeGraph(durations, transitions, { transitionSeconds }),
        '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-r', String(fps),
        '-pix_fmt', 'yuv420p',
        outPath,
    );
    return args;
}

/** Total length after the overlaps are accounted for. */
function totalDuration(durations, transitionCount, transitionSeconds = TRANSITION_SECONDS) {
    return durations.reduce((a, b) => a + b, 0) - transitionCount * transitionSeconds;
}

/** Frame pattern ComfyUI's SaveImage produces: prefix_00001_.png */
function framePattern(dir, prefix) {
    return path.join(dir, `${prefix}_%05d_.png`);
}

module.exports = {
    framesToClip, stillToClip, joinWithTransitions, buildXfadeGraph,
    totalDuration, framePattern, TRANSITIONS, TRANSITION_SECONDS,
};
