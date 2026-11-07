// العملية الرئيسية للبرنامج (Electron)
'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('./server');

const DEFAULT_CONFIG = { mode: 'local', port: 5055, serverHost: '', accessKey: '' };

let win = null;
let server = null;
let actualPort = null;
let serverError = '';

const userDir = () => app.getPath('userData');
const configFile = () => path.join(userDir(), 'config.json');
const dataDir = () => path.join(userDir(), 'data');

function loadConfig() {
  try {
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(configFile(), 'utf8')));
  } catch (_) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
}

function localIPs() {
  const list = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) list.push(i.address);
    }
  }
  return list;
}

async function applyConfig(cfg) {
  if (server) { await server.close(); server = null; }
  actualPort = null;
  serverError = '';
  if (cfg.mode === 'client') return;

  // جهاز واحد: نستمع على هذا الجهاز فقط وبمنفذ عشوائي حتى ما يتعارض مع شي
  // خادم: نستمع على الشبكة بالمنفذ المحدد
  const isServer = cfg.mode === 'server';
  server = createServer({
    dataDir: dataDir(),
    accessKey: isServer ? cfg.accessKey : '',
    version: app.getVersion()
  });
  try {
    actualPort = await server.listen(isServer ? Number(cfg.port) || 5055 : 0,
      isServer ? '0.0.0.0' : '127.0.0.1');
  } catch (e) {
    serverError = e.code === 'EADDRINUSE'
      ? `المنفذ ${cfg.port} مستخدم من برنامج آخر. غيّر رقم المنفذ من الإعدادات.`
      : 'تعذر تشغيل الخادم: ' + e.message;
    server = null;
  }
}

function state() {
  const cfg = loadConfig();
  let apiBase = '';
  if (cfg.mode === 'client') {
    apiBase = cfg.serverHost ? `http://${cfg.serverHost}:${Number(cfg.port) || 5055}` : '';
  } else if (actualPort) {
    apiBase = `http://127.0.0.1:${actualPort}`;
  }
  return {
    config: cfg,
    apiBase,
    // جهاز العميل يرسل الرمز مع كل طلب، والخادم المحلي ما يحتاجه
    sendKey: cfg.mode === 'client' ? cfg.accessKey : (cfg.mode === 'server' ? cfg.accessKey : ''),
    localIPs: localIPs(),
    serverError,
    version: app.getVersion(),
    dataDir: dataDir()
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 860,
    minHeight: 520,
    title: 'برنامج العملاء',
    backgroundColor: '#c0c0c0',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('crm:state', () => state());

ipcMain.handle('crm:saveConfig', async (_e, incoming) => {
  const cfg = Object.assign(loadConfig(), {
    mode: ['local', 'server', 'client'].includes(incoming.mode) ? incoming.mode : 'local',
    port: Math.min(65535, Math.max(1024, Number(incoming.port) || 5055)),
    serverHost: String(incoming.serverHost || '').trim(),
    accessKey: String(incoming.accessKey || '')
  });
  saveConfig(cfg);
  await applyConfig(cfg);
  return state();
});

ipcMain.handle('crm:saveText', async (_e, { defaultName, content }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'حفظ الملف',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Excel (CSV)', extensions: ['csv'] }]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  fs.writeFileSync(res.filePath, content, 'utf8');
  return { saved: true, path: res.filePath };
});

ipcMain.handle('crm:openDataFolder', () => {
  fs.mkdirSync(dataDir(), { recursive: true });
  return shell.openPath(dataDir());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await applyConfig(loadConfig());
    createWindow();
  });

  app.on('window-all-closed', async () => {
    if (server) await server.close();
    app.quit();
  });
}
