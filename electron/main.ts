import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers.js';
import { stopAllRuns } from './launcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

/**
 * Strip X-Frame-Options and CSP frame-ancestors from localhost responses so
 * installed apps can be embedded in the AppViewer iframe.  Only affects
 * localhost/127.0.0.1 — external sites are untouched.
 */
function allowLocalhostIframes(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = new URL(details.url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        const headers = { ...details.responseHeaders };
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'x-frame-options') {
            delete headers[key];
          }
          if (key.toLowerCase() === 'content-security-policy') {
            headers[key] = headers[key]!.map((v: string) =>
              v.replace(/frame-ancestors\s+[^;]*(;|$)/gi, '')
            );
          }
        }
        callback({ cancel: false, responseHeaders: headers });
        return;
      }
    } catch { /* malformed URL — pass through */ }
    callback({ cancel: false });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0A0A09',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    vibrancy: 'menu',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

/** Expose the main window for IPC handlers that need to push events. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

app.whenReady().then(() => {
  allowLocalhostIframes();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Kill all spawned processes when the app quits so ports aren't left occupied.
app.on('will-quit', () => {
  stopAllRuns();
});

// Also handle abrupt exits (SIGTERM, SIGINT).
process.on('SIGTERM', () => { stopAllRuns(); process.exit(0); });
process.on('SIGINT', () => { stopAllRuns(); process.exit(0); });
