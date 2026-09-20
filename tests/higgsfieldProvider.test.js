const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCredentials, describeError, resolveOutput } = require('../electron/lib/higgsfieldCredentials');
const catalog = require('../electron/lib/higgsfieldCatalog');

test('parseCredentials accepts id:secret and rejects malformed input', () => {
    assert.deepEqual(parseCredentials('  abc:def  '), { apiKey: 'abc', apiSecret: 'def' });
    // a secret containing colons stays intact
    assert.deepEqual(parseCredentials('id:a:b:c'), { apiKey: 'id', apiSecret: 'a:b:c' });
    for (const bad of ['', '   ', 'nocolon', ':secret', 'id:', 'id: ']) {
        assert.throws(() => parseCredentials(bad), /KEY_ID:KEY_SECRET/, `should reject ${JSON.stringify(bad)}`);
    }
});

test('describeError maps SDK error classes to readable sentences', () => {
    class AuthenticationError extends Error {}
    class NotEnoughCreditsError extends Error {}
    class TimeoutError extends Error {}
    class BadInputError extends Error {}
    assert.match(describeError(new AuthenticationError('bad key')), /rejected by Higgsfield: bad key/);
    assert.match(describeError(new NotEnoughCreditsError('0 usd')), /Not enough Higgsfield balance/);
    assert.match(describeError(new TimeoutError('600s')), /took too long/);
    assert.match(describeError(new BadInputError('duration')), /Invalid input: duration/);
    assert.match(describeError(new Error('Maximum number of concurrent requests (20) has been reached')), /Concurrency limit/);
    assert.equal(describeError(new Error('plain')), 'plain');
});

test('resolveOutput prefers video, falls back to images, and refuses empty or flagged results', () => {
    assert.deepEqual(resolveOutput({ status: 'completed', request_id: 'r1', video: { url: 'v.mp4' } }),
        { url: 'v.mp4', mediaType: 'video', requestId: 'r1', allUrls: ['v.mp4'] });
    assert.deepEqual(resolveOutput({ status: 'completed', request_id: 'r2', images: [{ url: 'a.png' }, { url: 'b.png' }] }),
        { url: 'a.png', mediaType: 'image', requestId: 'r2', allUrls: ['a.png', 'b.png'] });
    assert.throws(() => resolveOutput({ status: 'nsfw' }), /NSFW.*Nothing was charged/);
    assert.throws(() => resolveOutput({ status: 'failed' }), /failed.*Nothing was charged/);
    assert.throws(() => resolveOutput({ status: 'completed' }), /no output/);
});

test('catalog is internally consistent and its public view carries no functions', () => {
    const pub = catalog.toPublic();
    assert.equal(pub.length, catalog.CATALOG.length);
    const ids = pub.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
    for (const m of pub) {
        assert.ok(['image', 'video'].includes(m.kind), `${m.id} needs a valid kind`);
        // Docs call this the "Endpoint ID": no leading slash, no host. The SDK
        // prepends the slash itself.
        assert.doesNotMatch(m.endpoint, /^\/|^https?:/, `${m.id} must be a bare endpoint id`);
        assert.match(m.endpoint, /^[a-z0-9][a-z0-9./-]+$/, `${m.id} endpoint looks malformed`);
        assert.equal(m.provider, 'higgsfield');
        for (const v of Object.values(m)) assert.notEqual(typeof v, 'function');
    }
});

test('buildInput uses the documented field names for each model', () => {
    // Soul takes aspect_ratio + resolution, not the v1 width_and_height/quality.
    const soul = catalog.buildInput('hf-soul-v2', { prompt: 'a fox', aspect_ratio: '9:16', quality: '720p' });
    assert.deepEqual(soul, { prompt: 'a fox', aspect_ratio: '9:16', resolution: '720p', batch_size: 1, enhance_prompt: false });
    assert.equal(catalog.buildInput('hf-soul-v2', { prompt: 'x', aspect_ratio: 'bogus' }).aspect_ratio, '4:3', 'falls back to the documented default');
    assert.equal(catalog.buildInput('hf-soul-v2', { prompt: 'x', seed: 5 }).seed, 5);

    // Kling has no seed and no negative_prompt; duration is clamped to 3..15.
    const kling = catalog.buildInput('hf-kling-3-t2v', { prompt: 'a fox', duration: 10, aspect_ratio: '9:16', seed: 7, negative_prompt: 'blur' });
    assert.deepEqual(kling, { prompt: 'a fox', duration: 10, aspect_ratio: '9:16', sound: 'on' });
    assert.equal(catalog.buildInput('hf-kling-3-t2v', { prompt: 'x', duration: 99 }).duration, 15);
    assert.equal(catalog.buildInput('hf-kling-3-t2v', { prompt: 'x', duration: 1 }).duration, 3);

    // image-to-video: image_url is a plain string and aspect_ratio is dropped.
    const i2v = catalog.buildInput('hf-kling-3-i2v', { prompt: '', image_url: 'https://cdn/x.jpg', aspect_ratio: '1:1' });
    assert.equal(i2v.image_url, 'https://cdn/x.jpg');
    assert.equal('aspect_ratio' in i2v, false, 'i2v must not send aspect_ratio');
    assert.equal('input_images' in i2v, false, 'i2v takes image_url, not input_images');

    // Seedance i2v is the one endpoint where the prompt is genuinely optional.
    const seed25 = catalog.buildInput('hf-seedance-25-i2v', { image_url: 'https://cdn/x.jpg' });
    assert.equal('prompt' in seed25, false, 'empty prompt is omitted rather than sent blank');
    assert.equal(seed25.output_format, 'mp4');

    // Wan keeps its seed, with the wider documented range.
    assert.equal(catalog.buildInput('hf-wan-3-t2v', { prompt: 'x', seed: 2147483648 }).seed, 2147483647);

    assert.throws(() => catalog.buildInput('hf-kling-3-i2v', { prompt: 'x' }), /needs a reference image/);
    assert.throws(() => catalog.buildInput('hf-soul-v2', { prompt: '  ' }), /Prompt is required/);
    assert.throws(() => catalog.buildInput('nope', { prompt: 'x' }), /Unknown Higgsfield model/);
});

test('no model sends a field the API does not document', () => {
    const forbidden = ['negative_prompt', 'width_and_height', 'quality', 'input_images'];
    for (const m of catalog.CATALOG) {
        const input = catalog.buildInput(m.id, {
            prompt: 'x', image_url: 'https://cdn/x.jpg', aspect_ratio: '16:9',
            quality: '720p', duration: 5, seed: 3, negative_prompt: 'blur',
        });
        for (const f of forbidden) assert.equal(f in input, false, `${m.id} must not send ${f}`);
        if (m.needsImage) assert.equal('aspect_ratio' in input, false, `${m.id} must not send aspect_ratio`);
        if (/kling|seedance|minimax/.test(m.id)) assert.equal('seed' in input, false, `${m.id} does not accept seed`);
    }
});

test('renderer mirror is in sync with the main-process catalogue', () => {
    const fs = require('node:fs');
    const { render, OUT } = require('../scripts/gen-higgsfield-mirror');
    assert.equal(fs.readFileSync(OUT, 'utf8'), render(),
        'src/lib/higgsfieldModels.js is stale — run: node scripts/gen-higgsfield-mirror.js');
});

test('every video model reachable from the Video Studio has durations and ratios', () => {
    for (const m of catalog.toPublic().filter((m) => m.kind === 'video')) {
        assert.ok(Array.isArray(m.durations) && m.durations.length, `${m.id} needs durations`);
        assert.ok(Array.isArray(m.aspectRatios) && m.aspectRatios.length, `${m.id} needs aspectRatios`);
    }
});

test('resolveOutput also understands the JobSet shape the SDK README documents', () => {
    const jobSet = {
        id: 'js-1',
        isCompleted: true,
        jobs: [{ results: { raw: { url: 'https://cdn/out.png' }, min: { url: 'https://cdn/thumb.png' } } }],
    };
    assert.deepEqual(resolveOutput(jobSet), {
        url: 'https://cdn/out.png', mediaType: 'image', requestId: 'js-1', allUrls: ['https://cdn/out.png'],
    });
    assert.equal(resolveOutput({ isCompleted: true, jobs: [{ results: { raw: { url: 'https://cdn/a.mp4' } } }] }).mediaType, 'video');
    assert.throws(() => resolveOutput({ isNsfw: true }), /NSFW/);
    assert.throws(() => resolveOutput({ isFailed: true }), /failed/);
});

test('describeError explains a 404 as a renamed endpoint', () => {
    assert.match(describeError(new Error('Request failed with status code 404')), /does not know this endpoint/);
});
