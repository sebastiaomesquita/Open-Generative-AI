const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localAI', {
    isElectron: true,

    // ── sd.cpp engine ──────────────────────────────────────────────────────
    getBinaryStatus: () => ipcRenderer.invoke('local-ai:binary-status'),
    downloadBinary: () => ipcRenderer.invoke('local-ai:download-binary'),

    listModels: () => ipcRenderer.invoke('local-ai:list-models'),
    downloadModel: (modelId) => ipcRenderer.invoke('local-ai:download-model', modelId),
    downloadAuxiliary: (auxKey) => ipcRenderer.invoke('local-ai:download-auxiliary', auxKey),
    deleteModel: (modelId) => ipcRenderer.invoke('local-ai:delete-model', modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke('local-ai:cancel-download', modelId),

    generate: (params) => ipcRenderer.invoke('local-ai:generate', params),
    cancelGeneration: () => ipcRenderer.invoke('local-ai:cancel-generation'),

    // ── Wan2GP engine (remote Gradio server) ───────────────────────────────
    wan2gp: {
        getConfig:  () => ipcRenderer.invoke('wan2gp:get-config'),
        setUrl:     (url) => ipcRenderer.invoke('wan2gp:set-url', url),
        probe:      (url) => ipcRenderer.invoke('wan2gp:probe', url),
        listModels: () => ipcRenderer.invoke('wan2gp:list-models'),
        generate:   (params) => ipcRenderer.invoke('wan2gp:generate', params),
        cancelGeneration: () => ipcRenderer.invoke('wan2gp:cancel-generation'),
        uploadFile: (payload) => ipcRenderer.invoke('wan2gp:upload-file', payload),
    },

    // ── Higgsfield API (cloud, credential stays in the main process) ───────
    higgsfield: {
        status:      () => ipcRenderer.invoke('higgsfield:status'),
        setCredentials: (raw) => ipcRenderer.invoke('higgsfield:set-credentials', raw),
        clearCredentials: () => ipcRenderer.invoke('higgsfield:clear-credentials'),
        test:        (raw) => ipcRenderer.invoke('higgsfield:test', raw),
        listModels:  () => ipcRenderer.invoke('higgsfield:list-models'),
        uploadImage: (payload) => ipcRenderer.invoke('higgsfield:upload-image', payload),
        generate:    (params) => ipcRenderer.invoke('higgsfield:generate', params),
        cancelGeneration: () => ipcRenderer.invoke('higgsfield:cancel-generation'),
    },

    // OpenRouter key, read from the macOS keychain by the main process so the
    // user does not have to paste it into the app as well.
    openrouterKey: {
        get: () => ipcRenderer.invoke('openrouter:get-key'),
        has: () => ipcRenderer.invoke('openrouter:has-key'),
    },

    // Progress events — both engines emit on local-ai:progress
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:progress', listener);
        return () => ipcRenderer.removeListener('local-ai:progress', listener);
    },
    onDownloadProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:download-progress', listener);
        return () => ipcRenderer.removeListener('local-ai:download-progress', listener);
    },
});
