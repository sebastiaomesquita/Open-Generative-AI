// Credential resolution for the MCP server.
//
// The desktop app encrypts its credential with Electron's safeStorage, which a
// plain Node process cannot read. So the server keeps its own copy in the macOS
// login keychain, which never lands in a config file in plaintext.
//
// Order: HF_CREDENTIALS env → macOS keychain → error with instructions.

const { execFileSync } = require('node:child_process');
const { parseCredentials } = require('../electron/lib/higgsfieldCredentials');

const SERVICE = 'higgsfield-mcp';
const ACCOUNT = 'api-credential';

function fromKeychain() {
    if (process.platform !== 'darwin') return null;
    try {
        const out = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.trim() || null;
    } catch {
        return null; // not found, or the user denied keychain access
    }
}

function saveToKeychain(raw) {
    const { apiKey, apiSecret } = parseCredentials(raw);
    if (process.platform !== 'darwin') {
        throw new Error('Keychain storage is macOS only. Set HF_CREDENTIALS in the environment instead.');
    }
    // -U updates an existing item instead of failing.
    execFileSync('security', [
        'add-generic-password', '-U',
        '-s', SERVICE, '-a', ACCOUNT,
        '-l', 'Higgsfield MCP API credential',
        '-w', `${apiKey}:${apiSecret}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { keyId: apiKey };
}

function deleteFromKeychain() {
    if (process.platform !== 'darwin') return { ok: false };
    try {
        execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], {
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        return { ok: true };
    } catch {
        return { ok: false };
    }
}

/** Returns { apiKey, apiSecret, origin } or throws with a fix-it message. */
function resolveCredentials(env = process.env) {
    const fromEnv = String(env.HF_CREDENTIALS || '').trim();
    if (fromEnv) return { ...parseCredentials(fromEnv), origin: 'env' };

    const stored = fromKeychain();
    if (stored) return { ...parseCredentials(stored), origin: 'keychain' };

    throw new Error(
        'No Higgsfield credential found. Store one with:\n' +
        '  node mcp/server.js --save-credential KEY_ID:KEY_SECRET\n' +
        'or export HF_CREDENTIALS="KEY_ID:KEY_SECRET".\n' +
        'Create the credential at https://console.higgsfield.ai'
    );
}

function credentialStatus(env = process.env) {
    try {
        const { apiKey, origin } = resolveCredentials(env);
        return { configured: true, keyId: apiKey, origin };
    } catch {
        return { configured: false, keyId: '', origin: 'none' };
    }
}

module.exports = { SERVICE, ACCOUNT, resolveCredentials, credentialStatus, saveToKeychain, deleteFromKeychain };
