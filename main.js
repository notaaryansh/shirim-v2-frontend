import { app, BrowserWindow, session, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

/**
 * Strip X-Frame-Options and CSP frame-ancestors from localhost responses so
 * installed apps can be embedded in the AppViewer iframe. Only affects
 * localhost/127.0.0.1 — external sites are untouched.
 */
function allowLocalhostIframes() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = new URL(details.url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        const headers = { ...details.responseHeaders };
        // Strip X-Frame-Options (case-insensitive keys)
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'x-frame-options') {
            delete headers[key];
          }
          // Strip frame-ancestors from Content-Security-Policy
          if (key.toLowerCase() === 'content-security-policy') {
            headers[key] = headers[key].map(v =>
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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0A0A09',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    // frameless with custom titlebar behavior could be set here
    titleBarStyle: 'hiddenInset',
    vibrancy: 'menu',
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// Resize the window by a delta — used by the AI edit panel to grow/shrink
// the window so the iframe keeps its original dimensions.
// Shifts the window left if needed so the new size fits on screen.
ipcMain.on('resize-window-by', (event, { deltaWidth }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [w, h] = win.getSize();
  const [x, y] = win.getPosition();
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  const newWidth = w + deltaWidth;

  if (deltaWidth > 0) {
    // Growing: shift left if needed so the window fits on screen
    const overflow = (x + newWidth) - screenWidth;
    if (overflow > 0) {
      const newX = Math.max(0, x - overflow);
      win.setBounds({ x: newX, y, width: Math.min(newWidth, screenWidth), height: h }, true);
    } else {
      win.setSize(newWidth, h, true);
    }
  } else {
    // Shrinking: just reduce width, keep position
    win.setSize(Math.max(800, newWidth), h, true);
  }
});

app.whenReady().then(() => {
  allowLocalhostIframes();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
