// Higgsfield API provider (main process only).
//
// Why the main process: the official SDK refuses to run in a browser context
// (BrowserNotSupportedError) and the credential is an `ID:SECRET` pair that
// must never reach the renderer. It is stored encrypted with Electron's
// safeStorage (Keychain on macOS) and only ever leaves this file as an
// Authorization header inside the SDK.

const { ipcMain, app, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const { toPublic, getModelById, buildInput } = require('./higgsfieldCatalog');
const { parseCredentials, describeError, resolveOutput } = require('./higgsfieldCredentials');

const DATA_DIR = path.join(app.getPath('userData'), 'local-ai');
const CRED_FILE = path.join(DATA_DIR, 'higgsfield.cred');

let activeRequest = null; // { cancel: () => void, requestId: string }

// ── Credential storage ────────────────────────────────────────────────────

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveCredentials(raw) {
    const { apiKey, apiSecret } = parseCredentials(raw);
    ensureDir();
    const plain = `${apiKey}:${apiSecret}`;
    if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(CRED_FILE, safeStorage.encryptString(plain));
    } else {
        // No OS keychain (rare on macOS): still never world-readable.
        fs.writeFileSync(CRED_FILE, plain, { mode: 0o600 });
    }
    return { ok: true, keyId: apiKey };
}

function readCredentials() {
    if (!fs.existsSync(CRED_FILE)) return null;
    const buf = fs.readFileSync(CRED_FILE);
    let plain;
    try {
        plain = safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(buf)
            : buf.toString('utf8');
    } catch {
        return null; // keychain entry unusable (e.g. copied between machines)
    }
    try {
        return parseCredentials(plain);
    } catch {
        return null;
    }
}

function clearCredentials() {
    if (fs.existsSync(CRED_FILE)) fs.unlinkSync(CRED_FILE);
    return { ok: true };
}

/** Never returns the secret — only whether it exists and the visible key id. */
function getStatus() {
    const creds = readCredentials();
    return {
        configured: Boolean(creds),
        keyId: creds?.apiKey || '',
        encrypted: safeStorage.isEncryptionAvailable(),
    };
}

// ── SDK clients ───────────────────────────────────────────────────────────

function requireCredentials() {
    const creds = readCredentials();
    if (!creds) throw new Error('No Higgsfield credential saved. Add one in Settings → Higgsfield.');
    return creds;
}

function v2Client() {
    const { createHiggsfieldClient } = require('@higgsfield/client/v2');
    const { apiKey, apiSecret } = requireCredentials();
    // The SDK defaults to maxPollTime 300s, which is not enough for a 30s
    // video: the docs say timeouts are model-specific and long jobs are normal.
    return createHiggsfieldClient({
        apiKey,
        apiSecret,
        pollInterval: 2000,
        maxPollTime: 20 * 60 * 1000,
        timeout: 120000,
    });
}

function v1Client() {
    const { HiggsfieldClient } = require('@higgsfield/client');
    const { apiKey, apiSecret } = requireCredentials();
    return new HiggsfieldClient({ apiKey, apiSecret });
}

// ── Operations ────────────────────────────────────────────────────────────

/** Cheap authenticated GET, used by the Test button. */
async function testCredentials(raw) {
    const { HiggsfieldClient } = require('@higgsfield/client');
    const { apiKey, apiSecret } = raw ? parseCredentials(raw) : requireCredentials();
    const client = new HiggsfieldClient({ apiKey, apiSecret });
    try {
        const styles = await client.getSoulStyles();
        return { ok: true, message: `Credential accepted — ${Array.isArray(styles) ? styles.length : 0} Soul styles reachable.` };
    } catch (err) {
        return { ok: false, message: describeError(err) };
    } finally {
        client.close?.();
    }
}

/** Uploads bytes to the Higgsfield CDN and returns a public URL. */
async function uploadImage({ bytes, format }) {
    const client = v1Client();
    try {
        const url = await client.uploadImage(Buffer.from(bytes), format || 'jpeg');
        return { url };
    } catch (err) {
        throw new Error(describeError(err));
    } finally {
        client.close?.();
    }
}

function emit(mainWindow, payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('local-ai:progress', payload);
}

async function generate(params, mainWindow) {
    const model = getModelById(params?.model);
    if (!model) throw new Error(`Unknown Higgsfield model: ${params?.model}`);

    const input = buildInput(model.id, params);
    const client = v2Client();

    emit(mainWindow, { status: 'starting', progress: 0, message: `Submitting to ${model.name}...` });

    // The SDK polls internally; we surface an indeterminate heartbeat so the
    // UI does not look frozen during long video jobs.
    let elapsed = 0;
    const ticker = setInterval(() => {
        elapsed += 2;
        emit(mainWindow, {
            status: 'in_progress',
            progress: Math.min(0.95, elapsed / (model.kind === 'video' ? 180 : 45)),
            message: `Higgsfield: ${elapsed}s`,
        });
    }, 2000);

    let cancelled = false;
    activeRequest = { cancel: () => { cancelled = true; } };

    try {
        const res = await client.subscribe(model.endpoint, { input, withPolling: true });

        if (cancelled) throw new Error('Cancelled.');

        const out = resolveOutput(res);
        emit(mainWindow, { status: 'completed', progress: 1, message: 'Done' });
        return { ...out, model: model.id };
    } catch (err) {
        throw new Error(describeError(err));
    } finally {
        clearInterval(ticker);
        activeRequest = null;
    }
}

function cancelGeneration() {
    activeRequest?.cancel?.();
    return { ok: true };
}

function getMainWindow() {
    return BrowserWindow.getAllWindows()[0] || null;
}

function register() {
    ipcMain.handle('higgsfield:status', () => getStatus());
    ipcMain.handle('higgsfield:set-credentials', (_, raw) => saveCredentials(raw));
    ipcMain.handle('higgsfield:clear-credentials', () => clearCredentials());
    ipcMain.handle('higgsfield:test', (_, raw) => testCredentials(raw));
    ipcMain.handle('higgsfield:list-models', () => toPublic());
    ipcMain.handle('higgsfield:upload-image', (_, payload) => uploadImage(payload));
    ipcMain.handle('higgsfield:generate', (_, params) => generate(params, getMainWindow()));
    ipcMain.handle('higgsfield:cancel-generation', () => cancelGeneration());
}

module.exports = { register };
