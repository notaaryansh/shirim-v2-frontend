import { contextBridge, ipcRenderer } from 'electron';
/** Type-safe IPC bridge exposed as window.shirim in the renderer. */
const shirimApi = {
    install: {
        start: (owner, repo, ref, authToken) => ipcRenderer.invoke('install:start', owner, repo, ref, authToken),
        cancel: (installId) => ipcRenderer.invoke('install:cancel', installId),
        delete: (installId) => ipcRenderer.invoke('install:delete', installId),
        getProgress: (installId) => ipcRenderer.invoke('install:get-progress', installId),
        getSize: (installId) => ipcRenderer.invoke('install:get-size', installId),
        refreshToken: (installId, token) => ipcRenderer.invoke('install:refresh-token', installId, token),
        onProgress: (installId, callback) => {
            const channel = `install:progress:${installId}`;
            const handler = (_event, progress) => callback(progress);
            ipcRenderer.on(channel, handler);
            return () => { ipcRenderer.removeListener(channel, handler); };
        },
    },
    edit: {
        send: (installId, message, sessionId) => ipcRenderer.invoke('edit:send', installId, message, sessionId),
        getSession: (installId) => ipcRenderer.invoke('edit:get-session', installId),
        undo: (installId, turnId) => ipcRenderer.invoke('edit:undo', installId, turnId),
    },
    run: {
        start: (installId, options) => ipcRenderer.invoke('run:start', installId, options),
        stop: (installId) => ipcRenderer.invoke('run:stop', installId),
        getState: (installId) => ipcRenderer.invoke('run:get-state', installId),
        getLogs: (installId, limit) => ipcRenderer.invoke('run:get-logs', installId, limit),
        onLogs: (installId, callback) => {
            const channel = `run:log:${installId}`;
            const handler = (_event, line) => callback(line);
            ipcRenderer.on(channel, handler);
            return () => { ipcRenderer.removeListener(channel, handler); };
        },
    },
    secrets: {
        list: () => ipcRenderer.invoke('secrets:list'),
        add: (name, value) => ipcRenderer.invoke('secrets:add', name, value),
        delete: (name) => ipcRenderer.invoke('secrets:delete', name),
        reveal: (name) => ipcRenderer.invoke('secrets:reveal', name),
        check: (names) => ipcRenderer.invoke('secrets:check', names),
    },
};
contextBridge.exposeInMainWorld('shirim', shirimApi);
//# sourceMappingURL=preload.js.map