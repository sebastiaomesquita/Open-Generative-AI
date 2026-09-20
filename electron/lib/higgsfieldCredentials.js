// Pure helpers for the Higgsfield provider — no Electron imports, so they can
// be unit-tested with plain `node --test`.

/** Accepts "KEY_ID:KEY_SECRET"; never logs or echoes the secret. */
function parseCredentials(raw) {
    const value = String(raw || '').trim();
    const sep = value.indexOf(':');
    if (sep <= 0 || sep === value.length - 1) {
        throw new Error('Credential must look like KEY_ID:KEY_SECRET.');
    }
    const apiKey = value.slice(0, sep).trim();
    const apiSecret = value.slice(sep + 1).trim();
    if (!apiKey || !apiSecret) throw new Error('Credential must look like KEY_ID:KEY_SECRET.');
    return { apiKey, apiSecret };
}

/** Turns SDK/API errors into one readable sentence for the UI. */
function describeError(err) {
    const name = err?.constructor?.name || '';
    const msg = err?.message || String(err);
    if (name === 'CredentialsMissedError') return 'No Higgsfield credential saved.';
    if (name === 'AuthenticationError') return `Credential rejected by Higgsfield: ${msg}`;
    if (name === 'NotEnoughCreditsError') return `Not enough Higgsfield balance: ${msg}`;
    if (name === 'TimeoutError') return `Higgsfield took too long: ${msg}`;
    if (name === 'ValidationError' || name === 'BadInputError') return `Invalid input: ${msg}`;
    if (/concurrent requests/i.test(msg)) return `Concurrency limit reached: ${msg}`;
    if (/\b404\b|not found/i.test(msg)) return `Higgsfield does not know this endpoint (404). The model may have been renamed: ${msg}`;
    return msg;
}

/**
 * Picks the output URL out of a completed generation.
 *
 * SDK 0.2.6 hands back the raw v2 response ({ status, images, video }), but the
 * SDK README documents a JobSet ({ isCompleted, jobs[].results.raw.url }). We
 * accept both so a future SDK bump does not silently break generation.
 */
function resolveOutput(res) {
    const status = res?.status || (res?.isNsfw ? 'nsfw' : res?.isFailed ? 'failed' : res?.isCompleted ? 'completed' : '');
    if (status === 'nsfw') throw new Error('Higgsfield flagged the result as NSFW. Nothing was charged.');
    if (status === 'failed') throw new Error('Higgsfield reported the generation as failed. Nothing was charged.');

    const jobUrls = (res?.jobs || [])
        .map((j) => j?.results?.raw?.url)
        .filter(Boolean);

    const videoUrl = res?.video?.url || '';
    const imageUrls = (res?.images || []).map((i) => i?.url).filter(Boolean);
    const url = videoUrl || imageUrls[0] || jobUrls[0] || '';
    if (!url) throw new Error(`Higgsfield returned no output (status: ${status || 'unknown'}).`);

    const isVideo = Boolean(videoUrl) || /\.(mp4|mov|webm)(\?|$)/i.test(url);
    return {
        url,
        mediaType: isVideo ? 'video' : 'image',
        requestId: res?.request_id || res?.id || '',
        allUrls: videoUrl ? [videoUrl] : (imageUrls.length ? imageUrls : jobUrls),
    };
}

module.exports = { parseCredentials, describeError, resolveOutput };
