const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;
let modelServer = null;
let modelServerPort = 0;

// ============ Vosk nativo (main process) ============
let voskModel = null;
let voskRecognizer = null;
let loadedVosk = null;

function initVoskNative() {
  try {
    loadedVosk = require('vosk');
    loadedVosk.setLogLevel(0);
    console.log('Vosk nativo carregado!');
  } catch(e) {
    console.error('Vosk nativo não disponível:', e.message);
    loadedVosk = null;
  }
}

function loadVoskModel() {
  if (!loadedVosk) return false;
  const modelPath = path.join(__dirname, '..', 'models', 'vosk-model-small-pt-0.3');
  if (!fs.existsSync(modelPath)) {
    console.error('Modelo não encontrado:', modelPath);
    return false;
  }
  try {
    voskModel = new loadedVosk.Model(modelPath);
    console.log('Modelo Vosk carregado!');
    return true;
  } catch(e) {
    console.error('Erro ao carregar modelo:', e.message);
    return false;
  }
}

// ============ Configurações ============
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const SCRIPTS_PATH = path.join(app.getPath('userData'), 'scripts.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch(e) {}
  return { threshold: 60, selectedMic: '', windowBounds: { width: 1200, height: 800 } };
}

function saveConfig(config) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }

function loadScripts() {
  try {
    if (fs.existsSync(SCRIPTS_PATH)) return JSON.parse(fs.readFileSync(SCRIPTS_PATH, 'utf-8'));
  } catch(e) {}
  return [{ id: '1', text: 'E ande logo antes que mudem de ideia!', effectName: 'Risada', audioPath: '', createdAt: Date.now() }];
}

function saveScripts(scripts) { fs.writeFileSync(SCRIPTS_PATH, JSON.stringify(scripts, null, 2)); }

// ============ Servidor HTTP local ============
function startModelServer() {
  const modelDir = path.join(__dirname, '..', 'models', 'vosk-model-small-pt-0.3');
  if (!fs.existsSync(modelDir)) return null;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    
    let filePath = path.join(modelDir, decodeURIComponent(req.url).split('?')[0]);
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(fs.readdirSync(filePath))); return; }
    
    const ext = path.extname(filePath);
    const mimeTypes = { '.gz': 'application/gzip', '.tar': 'application/x-tar' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  });
  
  server.listen(0, '127.0.0.1', () => { modelServerPort = server.address().port; console.log('Model server:', modelServerPort); });
  return server;
}

// ============ IPC ============
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (e, c) => saveConfig(c));
ipcMain.handle('get-scripts', () => loadScripts());
ipcMain.handle('save-scripts', (e, s) => saveScripts(s));
ipcMain.handle('select-audio', async () => { const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['mp3','wav','ogg','webm','m4a'] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('import-audio', async (e, src) => { const fn = path.basename(src); const dir = path.join(app.getPath('userData'), 'audio'); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); const dest = path.join(dir, fn); fs.copyFileSync(src, dest); return dest; });
ipcMain.handle('get-model-url', () => modelServerPort > 0 ? 'http://127.0.0.1:' + modelServerPort + '/' : null);

// Vosk IPC
ipcMain.handle('vosk-init', () => {
  initVoskNative();
  if (!loadedVosk) return { success: false, error: 'Módulo vosk não disponível' };
  const ok = loadVoskModel();
  return { success: ok, error: ok ? null : 'Falha ao carregar modelo' };
});

ipcMain.handle('vosk-status', () => ({
  native: !!loadedVosk,
  model: !!voskModel
}));

// Vosk audio processing (síncrono para baixa latência)
ipcMain.on('vosk-audio', (event, audioData) => {
  if (!voskModel || !voskRecognizer) return;
  try {
    const accepted = voskRecognizer.acceptWaveform(Buffer.from(audioData));
    if (accepted) {
      const result = JSON.parse(voskRecognizer.result());
      if (result.text && result.text.trim()) {
        event.sender.send('vosk-result', result.text);
      }
    } else {
      const partial = JSON.parse(voskRecognizer.partialResult());
      if (partial.partial && partial.partial.trim()) {
        event.sender.send('vosk-partial', partial.partial);
      }
    }
  } catch(e) {
    // ignora erros de áudio
  }
});

ipcMain.handle('vosk-start', () => {
  if (!voskModel) return { success: false, error: 'Modelo não carregado' };
  try {
    if (voskRecognizer) voskRecognizer.free();
    voskRecognizer = new loadedVosk.Recognizer({ model: voskModel, sampleRate: 16000 });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('vosk-stop', () => {
  if (voskRecognizer) {
    try {
      const finalResult = voskRecognizer.finalResult();
      voskRecognizer.free();
      voskRecognizer = null;
      return { success: true, finalResult: JSON.parse(finalResult) };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }
  return { success: true };
});

// ============ App Lifecycle ============
function createWindow() {
  const config = loadConfig();
  mainWindow = new BrowserWindow({
    width: config.windowBounds?.width || 1200,
    height: config.windowBounds?.height || 800,
    minWidth: 800, minHeight: 600,
    frame: true, title: 'Teatro Teleprompter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'assets', 'index.html'));
  mainWindow.on('resize', () => { const b = mainWindow.getBounds(); const c = loadConfig(); c.windowBounds = { width: b.width, height: b.height }; saveConfig(c); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  modelServer = startModelServer();
  
  // Inicializa Vosk nativo
  initVoskNative();
  if (loadedVosk) {
    loadVoskModel();
  }
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (modelServer) modelServer.close();
  if (voskRecognizer) voskRecognizer.free();
  if (voskModel) voskModel.free();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
