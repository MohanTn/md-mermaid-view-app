import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocumentKind, listSupportedFiles, readDocument } from './file-service.js';

// Electron 36 can load GTK 4 alongside GTK 3 on Linux desktop environments.
// Force the GTK 3 path used by the packaged Debian application.
if (process.platform === 'linux') app.commandLine.appendSwitch('gtk-version', '3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let windowLoaded = false;
const pendingOpenPaths: string[] = [];

/** Queues a file path to be opened in the renderer once its window is ready. */
function queueOpenPath(filePath: string): void {
  if (pendingOpenPaths[pendingOpenPaths.length - 1] === filePath) return;
  pendingOpenPaths.push(filePath);
  flushOpenPaths();
}

function flushOpenPaths(): void {
  if (!mainWindow || !windowLoaded) return;
  while (pendingOpenPaths.length > 0) {
    const filePath = pendingOpenPaths.shift();
    if (filePath) mainWindow.webContents.send('open-path-event', filePath);
  }
}

/** Finds the first supported document path among command-line arguments. */
function getFilePathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    const absolutePath = path.resolve(arg);
    if (getDocumentKind(absolutePath) && existsSync(absolutePath)) return absolutePath;
  }
  return null;
}

function createWindow(): void {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on('did-finish-load', () => {
    windowLoaded = true;
    flushOpenPaths();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('choose-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown & Mermaid', extensions: ['md', 'markdown', 'mmd', 'mermaid'] }],
  });
  return result.canceled || !result.filePaths[0] ? null : readDocument(result.filePaths[0]);
});
ipcMain.handle('open-path', (_event, filePath: string) => readDocument(filePath));
ipcMain.handle('list-directory', (_event, directoryPath?: string) => listSupportedFiles(directoryPath ?? app.getPath('documents')));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // A file opened while the app is already running arrives here on Windows/Linux.
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const filePath = getFilePathFromArgv(argv);
    if (filePath) queueOpenPath(filePath);
  });

  // A file opened while the app is already running arrives here on macOS.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (getDocumentKind(filePath)) queueOpenPath(filePath);
  });

  app.whenReady().then(() => {
    createWindow();
    const startupFile = getFilePathFromArgv(process.argv);
    if (startupFile) queueOpenPath(startupFile);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
