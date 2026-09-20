// Turns one sentence into a shot list.
//
// The point of this module is that the user should not have to know that
// "zoom-in" is a LoRA, that "wipeleft" is an ffmpeg filter, or that a title has
// to be rendered outside the diffusion model. They write what they want; this
// decides.
//
// Two planners, in order:
//   1. the LLM already configured for prompt rewriting, asked for strict JSON;
//   2. a keyword planner that needs no network and no key.
// The second is not a degraded mode — it is what runs offline, and its output
// goes through the same validation, so a plan is a plan whoever wrote it.

const CAMERA_MOVES = ['none', 'pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'tilt-up', 'tilt-down', 'roll-cw', 'roll-ccw'];

// A deliberately small set out of ffmpeg's 58: these read as intentional rather
// than as a slideshow effect.
const TRANSITIONS = ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'smoothleft', 'smoothright', 'circleopen', 'dissolve'];

const MAX_SHOTS = 6;
const MAX_SECONDS_PER_SHOT = 4;

// ── Keyword planner ───────────────────────────────────────────────────────

// Portuguese first: that is what gets typed here.
const MOVE_HINTS = [
    [/\b(aproxim|zoom in|close ?up|aproximando|fecha n)/i, 'zoom-in'],
    [/\b(afast|zoom out|abre|revela|wide)/i, 'zoom-out'],
    [/\b(panor[âa]mic|pan|varre|percorre|da esquerda|left)/i, 'pan-left'],
    [/\b(direita|right)/i, 'pan-right'],
    [/\b(sobe|subindo|para cima|up|c[ée]u|sky)/i, 'tilt-up'],
    [/\b(desce|descendo|para baixo|down|ch[ãa]o|ground)/i, 'tilt-down'],
    [/\b(gira|rota[çc]|roll|spin)/i, 'roll-cw'],
];

const MOOD_HINTS = [
    [/\b(calm|sereno|suave|tranquil|gentle|slow|len)/i, { transition: 'fade', seconds: 3 }],
    [/\b(energ|r[áa]pid|din[âa]mic|fast|punch|ação|acao|action)/i, { transition: 'slideleft', seconds: 2 }],
    [/\b(dram[áa]tic|cinemat|[ée]pic|epic|grand)/i, { transition: 'fadeblack', seconds: 3 }],
    [/\b(sonh|dream|etére|ethereal|m[áa]gic|magic)/i, { transition: 'dissolve', seconds: 3 }],
];

/** Splits a brief into shot-sized pieces without inventing content. */
function splitIntoShots(text) {
    const parts = String(text)
        .split(/[.;\n]|\be depois\b|\bem seguida\b|\bdepois\b|\bthen\b|\bnext\b/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 8);
    return parts.length ? parts : [String(text).trim()];
}

function pickMove(text, index) {
    for (const [re, move] of MOVE_HINTS) if (re.test(text)) return move;
    // No hint: alternate gently rather than repeating one move, which reads as
    // a stuck camera.
    return ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'][index % 4];
}

function pickMood(text) {
    for (const [re, mood] of MOOD_HINTS) if (re.test(text)) return mood;
    return { transition: 'fade', seconds: 2 };
}

/** Pulls a quoted phrase, which is the natural way people write a title. */
function extractTitle(text) {
    const quoted = String(text).match(/["“']([^"”']{2,60})["”']/);
    if (quoted) return quoted[1].trim();
    const labelled = String(text).match(/\b(?:t[íi]tulo|title|abertura|intro)\s*[:\-]\s*([^.;\n]{2,60})/i);
    if (labelled) return labelled[1].trim();
    return '';
}

/** Removes the title clause so it does not also become a shot to film. */
function stripTitleClause(text, title) {
    if (!title) return text;
    return String(text)
        .replace(/\b(?:t[íi]tulo|title|abertura|intro)\s*[:\-]\s*["“']?[^.;\n]{2,60}["”']?/i, ' ')
        .replace(new RegExp(`["“']${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["”']`), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function planByKeywords(brief, { maxShots = 3 } = {}) {
    const text = String(brief || '').trim();
    const mood = pickMood(text);
    const title = extractTitle(text);
    const pieces = splitIntoShots(stripTitleClause(text, title)).slice(0, Math.min(maxShots, MAX_SHOTS));

    return {
        title,
        subtitle: '',
        shots: pieces.map((piece, i) => ({
            prompt: piece,
            cameraMove: pickMove(piece, i),
            seconds: mood.seconds,
        })),
        transitions: Array(Math.max(0, pieces.length - 1)).fill(mood.transition),
        plannedBy: 'keywords',
    };
}

// ── Validation ────────────────────────────────────────────────────────────

const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/**
 * Whatever produced the plan, it leaves here safe to execute: known camera
 * moves, known transitions, bounded shot count and duration. An LLM will
 * cheerfully invent 'dolly-zoom' and 40 seconds, and both would fail deep
 * inside ffmpeg or ComfyUI.
 */
function validatePlan(raw, { maxShots = MAX_SHOTS } = {}) {
    const shots = (Array.isArray(raw?.shots) ? raw.shots : [])
        .filter((s) => String(s?.prompt || '').trim())
        .slice(0, maxShots)
        .map((s, i) => ({
            prompt: String(s.prompt).trim().slice(0, 500),
            cameraMove: CAMERA_MOVES.includes(s.cameraMove) ? s.cameraMove : pickMove(String(s.prompt), i),
            seconds: clamp(s.seconds, 1, MAX_SECONDS_PER_SHOT, 2),
        }));

    if (!shots.length) throw new Error('O plano não tem nenhuma cena utilizável.');

    const wanted = Math.max(0, shots.length - 1);
    const given = Array.isArray(raw?.transitions) ? raw.transitions : [];
    const transitions = Array.from({ length: wanted }, (_, i) =>
        TRANSITIONS.includes(given[i]) ? given[i] : 'fade');

    return {
        title: String(raw?.title || '').trim().slice(0, 80),
        subtitle: String(raw?.subtitle || '').trim().slice(0, 120),
        shots,
        transitions,
        plannedBy: raw?.plannedBy || 'llm',
    };
}

// ── LLM planner ───────────────────────────────────────────────────────────

const SYSTEM = `You plan short video pieces: openers, b-roll, montages.
Return ONLY a JSON object, no prose and no code fence:
{"title": string, "subtitle": string, "shots": [{"prompt": string, "cameraMove": string, "seconds": number}], "transitions": [string]}

Rules:
- 1 to 4 shots. transitions has exactly one fewer item than shots.
- cameraMove is one of: ${CAMERA_MOVES.join(', ')}
- transitions come from: ${TRANSITIONS.join(', ')}
- seconds is 1 to 4.
- Each shot prompt is a vivid English image description: subject, setting, light, lens. No camera directions inside the prompt — the move is the cameraMove field.
- title and subtitle are short on-screen text in the user's own language. Empty strings if the brief does not call for a title.
- Pick moves and transitions that match the mood the user describes.`;

function extractJson(text) {
    const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('A resposta do modelo não trouxe JSON.');
    return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * @param {object} deps.chat  async ({system, user}) => string — injected so the
 *                            planner can be tested without a network.
 */
async function planByLlm(brief, { chat, maxShots = MAX_SHOTS } = {}) {
    const answer = await chat({ system: SYSTEM, user: String(brief || '').trim() });
    return validatePlan({ ...extractJson(answer), plannedBy: 'llm' }, { maxShots });
}

/**
 * Asks the model, and falls back to keywords on any failure.
 *
 * The fallback reason is carried on the plan rather than swallowed: a plan that
 * quietly came from keywords when the user expected the model looks like the
 * planner ignoring them, and there is no way to tell from the outside.
 */
async function plan(brief, { chat, maxShots = 3 } = {}) {
    if (!String(brief || '').trim()) throw new Error('Descreva o vídeo que você quer.');

    let note = '';
    if (chat) {
        try {
            return await planByLlm(brief, { chat, maxShots });
        } catch (err) {
            note = err?.message || String(err);
        }
    }
    const fallback = validatePlan(planByKeywords(brief, { maxShots }), { maxShots });
    return note ? { ...fallback, planningNote: note } : fallback;
}

module.exports = {
    plan, planByLlm, planByKeywords, validatePlan, extractJson, stripTitleClause,
    CAMERA_MOVES, TRANSITIONS, MAX_SHOTS, MAX_SECONDS_PER_SHOT,
};
