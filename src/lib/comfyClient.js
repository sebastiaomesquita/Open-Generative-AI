// Renderer-side wrapper over window.localAI.comfy.
//
// ComfyUI runs as a local server that the main process starts on demand, so
// nothing here needs a key, a network or a browser tab.

export const isComfyAvailable = () =>
    typeof window !== 'undefined' && !!window.localAI?.isElectron && !!window.localAI?.comfy;

const bridge = () => {
    if (!isComfyAvailable()) throw new Error('ComfyUI só está disponível no aplicativo desktop.');
    return window.localAI.comfy;
};

class ComfyClient {
    async status() {
        if (!isComfyAvailable()) {
            return { installed: false, running: false, dir: '', models: { checkpoints: [], textEncoders: [] } };
        }
        return bridge().status();
    }

    async isInstalled() {
        return Boolean((await this.status()).installed);
    }

    async setDir(dir) { return bridge().setDir(dir); }
    async start() { return bridge().start(); }
    async stop() { return bridge().stop(); }

    /** kind is 'image' or 'video'. The server is started if it is not up. */
    async generate(params) { return bridge().generate(params); }

    cancel() {
        if (isComfyAvailable()) bridge().cancel();
    }

    onProgress(callback) {
        if (!isComfyAvailable()) return () => {};
        return window.localAI.onProgress(callback);
    }
}

export const comfy = new ComfyClient();
