const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getScripts: () => ipcRenderer.invoke('get-scripts'),
  saveScripts: (scripts) => ipcRenderer.invoke('save-scripts', scripts),
  selectAudio: () => ipcRenderer.invoke('select-audio'),
  importAudio: (sourcePath) => ipcRenderer.invoke('import-audio', sourcePath),
  getModelUrl: () => ipcRenderer.invoke('get-model-url'),
  
  // Vosk nativo (main process)
  voskInit: () => ipcRenderer.invoke('vosk-init'),
  voskStatus: () => ipcRenderer.invoke('vosk-status'),
  voskStart: () => ipcRenderer.invoke('vosk-start'),
  voskStop: () => ipcRenderer.invoke('vosk-stop'),
  sendAudio: (audioData) => ipcRenderer.send('vosk-audio', audioData),
  onVoskResult: (callback) => ipcRenderer.on('vosk-result', (event, text) => callback(text)),
  onVoskPartial: (callback) => ipcRenderer.on('vosk-partial', (event, text) => callback(text)),
  
  platform: process.platform,
  isElectron: true
});
