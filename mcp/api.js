// Thin REST layer for the MCP server.
//
// Deliberately not the JS SDK: the SDK's subscribe() hides the request id until
// it finishes, and this server wants the estimate, the spend guard and the
// download to be separate, inspectable steps. The wire format is the documented
// one: POST /{endpoint-id}, then poll /requests/{id}/status.

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const BASE_URL = process.env.HF_BASE_URL || 'https://api.higgsfield.ai';
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);

function authHeader({ apiKey, apiSecret }) {
    return { Authorization: `Key ${apiKey}:${apiSecret}`, 'Content-Type': 'application/json' };
}

async function readError(res) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    let detail = body;
    try { detail = JSON.parse(body)?.detail || JSON.parse(body)?.error || body; } catch { /* keep raw */ }
    const correlation = res.headers.get('x-correlation-id');
    const hints = {
        400: 'bad parameters, or the concurrency limit was reached',
        401: 'credential rejected',
        403: 'no balance on the Higgsfield API account',
        404: 'endpoint unknown or not enabled for this account',
        422: 'input failed validation',
        423: 'model temporarily locked',
        503: 'model disabled',
    };
    const hint = hints[res.status] ? ` (${hints[res.status]})` : '';
    return new Error(`Higgsfield HTTP ${res.status}${hint}: ${String(detail).slice(0, 400)}${correlation ? ` [${correlation}]` : ''}`);
}

/** POST /estimate/{endpoint} — same body as the generation, returns cost only. */
async function estimate(creds, endpoint, input) {
    const res = await fetch(`${BASE_URL}/estimate/${endpoint}`, {
        method: 'POST',
        headers: authHeader(creds),
        body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    return { credits: data?.credits ?? null, usd: data?.usd != null ? Number(data.usd) : null };
}

async function submit(creds, endpoint, input) {
    const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: authHeader(creds),
        body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res);
    return res.json();
}

async function getStatus(creds, statusUrl) {
    const res = await fetch(statusUrl, { headers: authHeader(creds) });
    if (!res.ok) throw await readError(res);
    return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls from 2s up to 10s, as the docs recommend, until a terminal status. */
async function poll(creds, submitted, { maxMs = 20 * 60 * 1000, onTick } = {}) {
    const statusUrl = submitted.status_url || `${BASE_URL}/requests/${submitted.request_id}/status`;
    const started = Date.now();
    let delay = 2000;
    let last = submitted;

    while (!TERMINAL.has(last?.status)) {
        if (Date.now() - started > maxMs) {
            throw new Error(`Timed out after ${Math.round(maxMs / 60000)} min. The job may still finish: request ${submitted.request_id}.`);
        }
        await sleep(delay);
        delay = Math.min(10000, Math.round(delay * 1.3));
        last = await getStatus(creds, statusUrl);
        onTick?.(last.status, Math.round((Date.now() - started) / 1000));
    }
    return last;
}

async function cancel(creds, requestId) {
    const res = await fetch(`${BASE_URL}/requests/${requestId}/cancel`, { method: 'POST', headers: authHeader(creds) });
    if (!res.ok) throw await readError(res);
    return { ok: true };
}

/** Uploads a local file through the documented presigned flow. */
async function uploadFile(creds, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.wav': 'audio/wav', '.mp4': 'video/mp4',
    };
    const contentType = types[ext];
    if (!contentType) throw new Error(`Unsupported file type "${ext}". Accepted: ${Object.keys(types).join(', ')}`);

    const linkRes = await fetch(`${BASE_URL}/files/generate-upload-url`, {
        method: 'POST',
        headers: authHeader(creds),
        body: JSON.stringify({ content_type: contentType }),
    });
    if (!linkRes.ok) throw await readError(linkRes);
    const link = await linkRes.json();

    // The storage PUT must NOT carry the Higgsfield credentials.
    const put = await fetch(link.upload_url, {
        method: 'PUT',
        headers: link.upload_headers || { 'Content-Type': contentType },
        body: fs.readFileSync(filePath),
    });
    if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status}`);
    return { url: link.public_url, contentType };
}

/** Outputs expire in about 7 days, so every generation lands on disk. */
async function download(url, destDir, basename) {
    fs.mkdirSync(destDir, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download the result: HTTP ${res.status}`);
    const fromUrl = path.extname(new URL(url).pathname);
    const fromType = { 'image/png': '.png', 'image/jpeg': '.jpg', 'video/mp4': '.mp4' }[res.headers.get('content-type')];
    const ext = fromUrl || fromType || '.bin';
    const dest = path.join(destDir, `${basename}${ext}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    return { path: dest, bytes: fs.statSync(dest).size };
}

/** Picks the media URL out of a terminal status payload. */
function outputUrls(status) {
    if (status.video?.url) return [status.video.url];
    if (Array.isArray(status.images)) return status.images.map((i) => i.url).filter(Boolean);
    if (status.audio?.url) return [status.audio.url];
    if (Array.isArray(status.audios)) return status.audios.map((a) => a.url).filter(Boolean);
    return [];
}

module.exports = { BASE_URL, estimate, submit, poll, cancel, uploadFile, download, outputUrls, getStatus };
