const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopRuntime', {
  backendHealthUrl: 'http://127.0.0.1:8000/api/health',
  checkModelUpdates: () => ipcRenderer.invoke('models:check-updates'),
  updateModel: (model) => ipcRenderer.invoke('models:update', model),
  onModelDownloadProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('models:download-progress', handler);
    return () => ipcRenderer.removeListener('models:download-progress', handler);
  },
});
