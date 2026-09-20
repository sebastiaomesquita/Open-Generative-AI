const test = require('node:test');
const assert = require('node:assert/strict');

const director = require('../electron/lib/director');
const ff = require('../electron/lib/ffmpegCompose');
const { cardHtml, THEMES } = (() => {
    // titleCard imports electron for the renderer; only the pure half is tested.
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'electron', 'lib', 'titleCard.js'), 'utf8');
    const body = src.replace(/const \{ BrowserWindow \}[^;]+;/, 'const BrowserWindow = null;');
    const module_ = { exports: {} };
    new Function('module', 'exports', 'require', body)(module_, module_.exports, require);
    return module_.exports;
})();

// ── The director ──────────────────────────────────────────────────────────

test('a brief becomes a plan whose every choice is executable', () => {
    const plan = director.validatePlan(director.planByKeywords(
        'abertura cinematográfica do mar ao amanhecer. Depois a cidade acordando'));
    assert.ok(plan.shots.length >= 2);
    assert.equal(plan.transitions.length, plan.shots.length - 1, 'one fewer transition than shots');
    for (const s of plan.shots) {
        assert.ok(director.CAMERA_MOVES.includes(s.cameraMove), `${s.cameraMove} must be a real LoRA`);
        assert.ok(s.seconds >= 1 && s.seconds <= director.MAX_SECONDS_PER_SHOT);
    }
    for (const tr of plan.transitions) assert.ok(ff.TRANSITIONS.includes(tr), `${tr} must be a real xfade`);
});

test('the mood in the brief picks the transition, not a default', () => {
    const calm = director.planByKeywords('uma cena calma e serena de um lago');
    const fast = director.planByKeywords('b-roll energético e rápido de uma corrida');
    const epic = director.planByKeywords('uma abertura dramática e épica das montanhas');
    assert.equal(calm.transitions.length ? calm.transitions[0] : 'fade', 'fade');
    assert.notEqual(fast.shots[0].seconds, calm.shots[0].seconds, 'pace should differ');
    assert.equal(director.planByKeywords('cena dramática. outra cena').transitions[0], 'fadeblack');
    assert.ok(epic.shots.length >= 1);
});

test('words in the brief steer the camera', () => {
    const cases = [
        ['aproxime no rosto do pescador', 'zoom-in'],
        ['afaste revelando a cidade', 'zoom-out'],
        ['a câmera sobe para o céu', 'tilt-up'],
        ['gira em torno do carro', 'roll-cw'],
    ];
    for (const [brief, expected] of cases) {
        assert.equal(director.planByKeywords(brief).shots[0].cameraMove, expected, brief);
    }
});

test('a quoted title becomes a card and stops being a shot', () => {
    const plan = director.planByKeywords('o mar ao amanhecer. Título: "Bom dia"');
    assert.equal(plan.title, 'Bom dia');
    assert.ok(plan.shots.every((s) => !/t[íi]tulo/i.test(s.prompt)), 'the title clause must not be filmed');
});

test('validation refuses what a model might invent', () => {
    const plan = director.validatePlan({
        shots: [
            { prompt: 'a', cameraMove: 'dolly-zoom', seconds: 40 },
            { prompt: 'b', cameraMove: 'pan-left', seconds: 2 },
        ],
        transitions: ['explode'],
        title: 'x'.repeat(500),
    });
    assert.ok(director.CAMERA_MOVES.includes(plan.shots[0].cameraMove), 'unknown move replaced');
    assert.equal(plan.shots[0].seconds, director.MAX_SECONDS_PER_SHOT, 'duration clamped');
    assert.equal(plan.transitions[0], 'fade', 'unknown transition replaced');
    assert.ok(plan.title.length <= 80, 'title truncated');
    assert.throws(() => director.validatePlan({ shots: [] }), /nenhuma cena/);
});

test('the LLM planner tolerates a fenced, chatty answer', async () => {
    const chat = async () => 'Claro! Aqui está:\n```json\n{"title":"Mar","subtitle":"","shots":[{"prompt":"ocean at dawn","cameraMove":"zoom-in","seconds":2}],"transitions":[]}\n```';
    const plan = await director.planByLlm('mar', { chat });
    assert.equal(plan.title, 'Mar');
    assert.equal(plan.plannedBy, 'llm');
});

test('a broken model never blocks the piece', async () => {
    for (const chat of [async () => 'desculpe, não posso', async () => { throw new Error('offline'); }]) {
        const plan = await director.plan('o mar ao amanhecer', { chat });
        assert.equal(plan.plannedBy, 'keywords', 'falls back silently to keywords');
        assert.ok(plan.shots.length >= 1);
    }
});

// ── The cut ───────────────────────────────────────────────────────────────

test('xfade offsets account for the overlap each transition spends', () => {
    // Three clips of 2, 3 and 4 seconds with 0.5s transitions run 8s, not 9.
    const graph = ff.buildXfadeGraph([2, 3, 4], ['fade', 'wipeleft']);
    assert.match(graph, /offset=1\.500/, 'first transition starts 0.5s before clip 1 ends');
    assert.match(graph, /offset=4\.000/, 'second accounts for the first overlap');
    assert.match(graph, /\[v\]$/, 'the chain ends on the mapped label');
    assert.equal(ff.totalDuration([2, 3, 4], 2), 8);
});

test('a mismatched transition count is refused before ffmpeg runs', () => {
    assert.throws(() => ff.buildXfadeGraph([2, 3], ['fade', 'wipeleft']), /transições/);
    assert.throws(() => ff.buildXfadeGraph([2, 3, 4], ['fade']), /transições/);
});

test('a single clip is copied, not re-encoded through an empty filtergraph', () => {
    const args = ff.joinWithTransitions({ clips: ['a.mp4'], durations: [2], transitions: [], outPath: 'o.mp4', fps: 24 });
    assert.ok(args.includes('copy'));
    assert.equal(args.includes('-filter_complex'), false);
});

test('clips are letterbox-free: scaled up then cropped to the exact frame', () => {
    const args = ff.framesToClip({ pattern: 'f_%05d.png', fps: 8, outPath: 'o.mp4', width: 768, height: 432 });
    const vf = args[args.indexOf('-vf') + 1];
    assert.match(vf, /force_original_aspect_ratio=increase/);
    assert.match(vf, /crop=768:432/);
    assert.match(vf, /format=yuv420p/, 'without this the file will not play in most players');
});

test('the title card fades at both ends and never past its own length', () => {
    const args = ff.stillToClip({ imagePath: 'c.png', seconds: 2.5, fps: 24, outPath: 'o.mp4', width: 768, height: 432, fade: 0.4 });
    const vf = args[args.indexOf('-vf') + 1];
    assert.match(vf, /fade=t=in:st=0:d=0\.4/);
    assert.match(vf, /fade=t=out:st=2\.10:d=0\.4/, 'the out-fade must end exactly at the card end');
});

// ── The title card ────────────────────────────────────────────────────────

test('card markup escapes what the user typed', () => {
    const html = cardHtml({ title: '<script>alert(1)</script>', subtitle: 'a & b', width: 800, height: 450 });
    assert.equal(html.includes('<script>alert'), false, 'a brief must not inject markup');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /a &amp; b/);
});

test('card type scales with the frame, so one card works at any size', () => {
    const small = cardHtml({ title: 'T', width: 512, height: 288 });
    const large = cardHtml({ title: 'T', width: 1920, height: 1080 });
    const size = (h) => Number(h.match(/font-size:(\d+)px;\s*font-weight:800/)[1]);
    assert.ok(size(large) > size(small) * 3, 'a 1920 card must not use 512-sized type');
});

test('every theme defines the full set of colours', () => {
    for (const [name, c] of Object.entries(THEMES)) {
        for (const key of ['bg', 'fg', 'accent', 'sub']) {
            assert.ok(c[key], `theme ${name} is missing ${key}`);
        }
    }
});

test('a card without a subtitle omits the rule instead of leaving a gap', () => {
    assert.equal(cardHtml({ title: 'A', width: 800, height: 450 }).includes('class="rule"'), false);
    assert.ok(cardHtml({ title: 'A', subtitle: 'B', width: 800, height: 450 }).includes('class="rule"'));
});
