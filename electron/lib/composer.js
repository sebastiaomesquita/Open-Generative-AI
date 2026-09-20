// The composition layer: one sentence in, one finished piece out.
//
// It reads the brief, decides the shots, the camera moves, the transitions and
// whether there is a title, then renders each part with the tool that is
// actually good at it:
//   - moving pictures -> AnimateDiff on this Mac's GPU
//   - lettering       -> the Chromium this app already ships
//   - cutting         -> ffmpeg, which is already installed
// Nothing here costs money and nothing leaves the machine.

const { ipcMain, app, BrowserWindow } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const director = require('./director');
const titleCard = require('./titleCard');
const ff = require('./ffmpegCompose');
const comfy = require('./comfyProvider');

const FPS = 8;            // AnimateDiff's native rate; upsampling it invents motion
const OUT_FPS = 24;
const TITLE_SECONDS = 2.5;

let cancelled = false;

function run(bin, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                const detail = String(stderr || err.message).trim().split('\n').slice(-3).join(' | ');
                reject(new Error(`${path.basename(bin)} falhou: ${detail.slice(0, 400)}`));
            } else {
                resolve(String(stdout));
            }
        });
    });
}

/** ffmpeg is a hard dependency here; say so before doing five minutes of work. */
async function ffmpegPath() {
    for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']) {
        try {
            await run(candidate, ['-version'], { timeoutMs: 8000 });
            return candidate;
        } catch { /* try the next */ }
    }
    throw new Error('ffmpeg não encontrado. Instale com: brew install ffmpeg');
}

function emit(win, payload) {
    if (win && !win.isDestroyed()) win.webContents.send('compose:progress', payload);
}

/** Builds the chat function the director needs, from the app's own LLM settings. */
function chatFromSettings(llm) {
    if (!llm?.baseUrl || (!llm.apiKey && !/localhost|127\.0\.0\.1/.test(llm.baseUrl))) return null;
    return async ({ system, user }) => {
        // A planning call must not be able to hang the studio. Without this the
        // button sits on "Loading" forever instead of falling back to keywords.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25_000);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
            const res = await fetch(`${llm.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model: llm.model,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    temperature: 0.6,
                    // Three shots with descriptive prompts overflow 700 and the
                    // JSON comes back truncated, which reads as a parse failure.
                    max_tokens: 1200,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            return body?.choices?.[0]?.message?.content || '';
        } finally {
            clearTimeout(timer);
        }
    };
}

function workDir() {
    const dir = path.join(app.getPath('userData'), 'compose', String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function outputDir() {
    const dir = process.env.HF_OUTPUT_DIR || path.join(os.homedir(), 'Movies', 'Open Generative AI');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const slug = (s) => String(s || 'video').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'video';

/** Frames land in ComfyUI's output dir; collect the ones this shot wrote. */
function collectFrames(dir, prefix) {
    return fs.readdirSync(dir)
        .filter((f) => f.startsWith(`${prefix}_`) && f.endsWith('.png'))
        .sort()
        .map((f) => path.join(dir, f));
}

/** Renumbers frames into their own folder so ffmpeg's pattern is unambiguous. */
function stageFrames(frames, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    frames.forEach((src, i) => {
        fs.copyFileSync(src, path.join(destDir, `f_${String(i + 1).padStart(5, '0')}.png`));
    });
    return path.join(destDir, 'f_%05d.png');
}

async function compose(params, win) {
    cancelled = false;
    const ffmpeg = await ffmpegPath();
    const width = Number(params.width) || 768;
    const height = Number(params.height) || 432;

    // 1. Decide what to make.
    emit(win, { stage: 'planning', progress: 0.02, message: 'Planejando as cenas...' });
    const chat = chatFromSettings(params.llm);
    const plan = await director.plan(params.brief, { chat, maxShots: Number(params.maxShots) || 3 });
    emit(win, { stage: 'planned', progress: 0.06, message: `${plan.shots.length} cena(s), planejadas por ${plan.plannedBy === 'llm' ? 'modelo' : 'palavras-chave'}`, plan });

    const work = workDir();
    const clips = [];
    const durations = [];

    // 2. A title card, when the brief asks for one. Seconds, not minutes.
    if (plan.title) {
        emit(win, { stage: 'title', progress: 0.1, message: 'Renderizando o título...' });
        const cardPng = path.join(work, 'title.png');
        await titleCard.renderCard({
            title: plan.title, subtitle: plan.subtitle,
            theme: params.theme || 'dark',
            width, height, outPath: cardPng,
        });
        const clip = path.join(work, 'clip_title.mp4');
        await run(ffmpeg, ff.stillToClip({ imagePath: cardPng, seconds: TITLE_SECONDS, fps: OUT_FPS, outPath: clip, width, height }));
        clips.push(clip);
        durations.push(TITLE_SECONDS);
    }

    // 3. The shots. This is where the minutes go.
    for (const [i, shot] of plan.shots.entries()) {
        if (cancelled) throw new Error('Cancelado.');
        const base = 0.12 + (i / plan.shots.length) * 0.78;
        emit(win, { stage: 'shot', progress: base, message: `Cena ${i + 1}/${plan.shots.length}: ${shot.cameraMove}`, shot: i });

        const prefix = `ogai_c_${Date.now()}_${i}`;
        const res = await comfy.generate({
            kind: 'motion',
            prompt: shot.prompt,
            aspect_ratio: params.aspect_ratio || '16:9',
            cameraMove: shot.cameraMove,
            framesPrefix: prefix,
        }, win);

        const frames = res.frames?.length ? res.frames : collectFrames(res.outputDir, prefix);
        if (!frames.length) throw new Error(`A cena ${i + 1} não produziu quadros.`);

        const pattern = stageFrames(frames, path.join(work, `frames_${i}`));
        const clip = path.join(work, `clip_${i}.mp4`);
        // The shot lasts as long as its frames do; stretching it would stutter.
        await run(ffmpeg, ff.framesToClip({ pattern, fps: FPS, outPath: clip, width, height }));
        clips.push(clip);
        durations.push(frames.length / FPS);
    }

    // 4. Cut them together.
    emit(win, { stage: 'assembling', progress: 0.93, message: 'Montando com as transições...' });
    const transitions = clips.length - 1 === plan.transitions.length
        ? plan.transitions
        // A title card adds a clip the director did not plan a transition for.
        : ['fade', ...plan.transitions].slice(0, clips.length - 1);

    const finalPath = path.join(outputDir(), `${slug(plan.title || plan.shots[0].prompt)}-${Date.now()}.mp4`);
    await run(ffmpeg, ff.joinWithTransitions({ clips, durations, transitions, outPath: finalPath, fps: OUT_FPS }),
        { timeoutMs: 15 * 60 * 1000 });

    // 5. Hand back a poster the renderer can show without loading the video.
    const posterPath = path.join(work, 'poster.png');
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', finalPath, '-frames:v', '1', '-vf', 'scale=480:-2', posterPath]);
    const poster = `data:image/png;base64,${fs.readFileSync(posterPath).toString('base64')}`;

    emit(win, { stage: 'done', progress: 1, message: 'Pronto' });
    return {
        path: finalPath,
        poster,
        seconds: Number(ff.totalDuration(durations, transitions.length).toFixed(2)),
        plan,
        transitions,
        cost_usd: 0,
    };
}

function cancel() {
    cancelled = true;
    comfy.stop === undefined ? null : null;
    return { ok: true };
}

function getWindow() {
    return BrowserWindow.getAllWindows()[0] || null;
}

function register() {
    ipcMain.handle('compose:plan', async (_, params) => {
        const chat = chatFromSettings(params?.llm);
        return director.plan(params?.brief, { chat, maxShots: Number(params?.maxShots) || 3 });
    });
    ipcMain.handle('compose:run', (_, params) => compose(params || {}, getWindow()));
    ipcMain.handle('compose:cancel', () => cancel());
    ipcMain.handle('compose:themes', () => Object.keys(titleCard.THEMES));
}

module.exports = { register, compose, chatFromSettings, collectFrames, stageFrames, slug };
