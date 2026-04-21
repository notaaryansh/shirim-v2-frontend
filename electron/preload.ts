import { contextBridge, ipcRenderer } from 'electron';

/** Type-safe IPC bridge exposed as window.shirim in the renderer. */
const shirimApi = {
  install: {
    start: (owner: string, repo: string, ref?: string, authToken?: string) =>
      ipcRenderer.invoke('install:start', owner, repo, ref, authToken),

    cancel: (installId: string) =>
      ipcRenderer.invoke('install:cancel', installId),

    delete: (installId: string) =>
      ipcRenderer.invoke('install:delete', installId),

    getProgress: (installId: string) =>
      ipcRenderer.invoke('install:get-progress', installId),

    getSize: (installId: string) =>
      ipcRenderer.invoke('install:get-size', installId),

    refreshToken: (installId: string, token: string) =>
      ipcRenderer.invoke('install:refresh-token', installId, token),

    onProgress: (installId: string, callback: (progress: unknown) => void) => {
      const channel = `install:progress:${installId}`;
      const handler = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  },

  edit: {
    send: (installId: string, message: string, sessionId?: string | null) =>
      ipcRenderer.invoke('edit:send', installId, message, sessionId),

    getSession: (installId: string) =>
      ipcRenderer.invoke('edit:get-session', installId),

    undo: (installId: string, turnId: number) =>
      ipcRenderer.invoke('edit:undo', installId, turnId),
  },

  run: {
    start: (installId: string, options?: { command?: string; wait_for_url?: number }) =>
      ipcRenderer.invoke('run:start', installId, options),

    stop: (installId: string) =>
      ipcRenderer.invoke('run:stop', installId),

    getState: (installId: string) =>
      ipcRenderer.invoke('run:get-state', installId),

    getLogs: (installId: string, limit?: number) =>
      ipcRenderer.invoke('run:get-logs', installId, limit),

    onLogs: (installId: string, callback: (line: unknown) => void) => {
      const channel = `run:log:${installId}`;
      const handler = (_event: Electron.IpcRendererEvent, line: unknown) =>
        callback(line);
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  },

  secrets: {
    list: () => ipcRenderer.invoke('secrets:list'),
    add: (name: string, value: string) => ipcRenderer.invoke('secrets:add', name, value),
    delete: (name: string) => ipcRenderer.invoke('secrets:delete', name),
    reveal: (name: string) => ipcRenderer.invoke('secrets:reveal', name),
    check: (names: string[]) => ipcRenderer.invoke('secrets:check', names),
  },
};

contextBridge.exposeInMainWorld('shirim', shirimApi);

export type ShirimApi = typeof shirimApi;
