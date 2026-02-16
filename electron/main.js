const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const {
  readLocalManifest,
  loadRemoteManifest,
  calcUpdates,
  applyModelUpdate,
} = require('../scripts/model-updater');

let mainWindow;
let backendProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

function startLocalBackend() {
  const backendDir = path.join(__dirname, '..', 'backend');
  const isWin = process.platform === 'win32';
  const pythonExe = isWin
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');

  backendProcess = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    { cwd: backendDir }
  );

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend:err] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
  });
}

function registerModelIpc() {
  ipcMain.handle('models:check-updates', async () => {
    const manifestUrl = process.env.MODEL_MANIFEST_URL;
    if (!manifestUrl) {
      return { updates: [], warning: 'MODEL_MANIFEST_URL is not set' };
    }

    const local = readLocalManifest();
    const remote = await loadRemoteManifest(manifestUrl);
    const updates = calcUpdates(local, remote);
    return { updates };
  });

  ipcMain.handle('models:update', async (_event, model) => {
    const result = await applyModelUpdate(model, ({ received, total }) => {
      if (!mainWindow || !total) return;
      mainWindow.webContents.send('models:download-progress', {
        model: model.name,
        received,
        total,
        percent: Math.floor((received / total) * 100),
      });
    });
    return result;
  });
}

app.whenReady().then(() => {
  startLocalBackend();
  registerModelIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
