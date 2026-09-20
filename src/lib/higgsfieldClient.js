// Renderer-side wrapper over window.higgsfield (Electron IPC).
// The credential never lives here: the main process holds it and this module
// only ever sees booleans, model metadata and result URLs.

export const isHiggsfieldAvailable = () =>
    typeof window !== 'undefined' && !!window.localAI?.isElectron && !!window.localAI?.higgsfield;

const bridge = () => {
    if (!isHiggsfieldAvailable()) throw new Error('Higgsfield is only available in the desktop app.');
    return window.localAI.higgsfield;
};

let modelCache = null;

class HiggsfieldClientWrapper {
    async status() {
        if (!isHiggsfieldAvailable()) return { configured: false, keyId: '', encrypted: false };
        return bridge().status();
    }

    async isConfigured() {
        return Boolean((await this.status()).configured);
    }

    async setCredentials(raw) {
        return bridge().setCredentials(raw);
    }

    async clearCredentials() {
        return bridge().clearCredentials();
    }

    /** Validates a credential without saving it (pass undefined to test the saved one). */
    async test(raw) {
        if (!isHiggsfieldAvailable()) return { ok: false, message: 'Desktop app only.' };
        return bridge().test(raw);
    }

    async listModels({ kind } = {}) {
        if (!isHiggsfieldAvailable()) return [];
        if (!modelCache) modelCache = await bridge().listModels();
        return kind ? modelCache.filter((m) => m.kind === kind) : modelCache;
    }

    async getModelById(id) {
        return (await this.listModels()).find((m) => m.id === id) || null;
    }

    /** Pushes a File/Blob to the Higgsfield CDN, returning a public URL. */
    async uploadImage(file) {
        const buf = await file.arrayBuffer();
        const format = /png/i.test(file.type) ? 'png' : /webp/i.test(file.type) ? 'webp' : 'jpeg';
        const { url } = await bridge().uploadImage({ bytes: new Uint8Array(buf), format });
        return url;
    }

    async generate(params) {
        return bridge().generate(params);
    }

    cancelGeneration() {
        if (!isHiggsfieldAvailable()) return;
        bridge().cancelGeneration();
    }

    /** Progress rides the same channel the local engines use. */
    onProgress(callback) {
        if (!isHiggsfieldAvailable()) return () => {};
        return window.localAI.onProgress(callback);
    }
}

export const higgsfield = new HiggsfieldClientWrapper();
