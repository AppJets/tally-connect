const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const TallyDetector = require('./tally-detector');
const TallySync = require('./tally-sync');

// Simple JSON-based store to avoid ESM compatibility issues
class SimpleStore {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'config.json');
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        this.data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      this.data = {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  get(key, defaultValue = undefined) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

let store;
let mainWindow = null;
let tray = null;
let tallyDetector = null;
let tallySync = null;

// Disable GPU acceleration and caching to prevent cache errors
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function getIconPath() {
  // Try different icon paths
  const iconPaths = [
    path.join(__dirname, '../assets/icon.png'),
    path.join(__dirname, '../assets/icon.ico'),
  ];

  for (const iconPath of iconPaths) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  // Return null if no icon found (Electron will use default)
  return null;
}

function createWindow() {
  const iconPath = getIconPath();
  const windowOptions = {
    width: 500,
    height: 700,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  };

  if (iconPath) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenu(null);

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = getIconPath();

  if (!iconPath) {
    // Create a simple colored icon if no icon file exists
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
  } else {
    tray = new Tray(iconPath);
  }

  updateTrayMenu();

  tray.setToolTip('LexOrigin Tally Connector');

  tray.on('double-click', () => {
    mainWindow.show();
  });
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open LexOrigin Connector',
      click: () => mainWindow.show()
    },
    {
      label: 'Sync Now',
      click: () => {
        if (tallySync) tallySync.syncNow();
      }
    },
    { type: 'separator' },
    {
      label: tallyDetector?.isRunning ? 'Tally: Running' : 'Tally: Not Running',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// IPC Handlers
ipcMain.handle('detect-tally', async () => {
  tallyDetector = new TallyDetector();
  const result = await tallyDetector.detect();
  updateTrayMenu();
  return result;
});

ipcMain.handle('get-config', () => {
  return {
    apiKey: store.get('apiKey', ''),
    apiSecret: store.get('apiSecret', ''),
    syncUrl: store.get('syncUrl', 'http://localhost:3100/api/v1'),
    tallyPath: store.get('tallyPath', ''),
    autoSync: store.get('autoSync', true),
    syncInterval: store.get('syncInterval', 5),
  };
});

ipcMain.handle('save-config', async (event, config) => {
  store.set('apiKey', config.apiKey);
  store.set('apiSecret', config.apiSecret);
  store.set('syncUrl', config.syncUrl);
  store.set('tallyPath', config.tallyPath);
  store.set('autoSync', config.autoSync);
  store.set('syncInterval', config.syncInterval);

  // Restart sync with new config
  if (tallySync) {
    tallySync.stop();
  }
  tallySync = new TallySync(config);
  if (config.autoSync) {
    tallySync.start();
  }

  return { success: true };
});

ipcMain.handle('install-tdl', async (event, tallyPath) => {
  try {
    const tdlSource = path.join(__dirname, '../tdl/LexTallySync.tdl');
    const tdlDest = path.join(tallyPath, 'TDL', 'LexTallySync.tdl');

    // Create TDL folder if it doesn't exist
    const tdlFolder = path.join(tallyPath, 'TDL');
    if (!fs.existsSync(tdlFolder)) {
      fs.mkdirSync(tdlFolder, { recursive: true });
    }

    // Copy TDL file
    fs.copyFileSync(tdlSource, tdlDest);

    return { success: true, path: tdlDest };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-connection', async () => {
  if (!tallySync) {
    const config = {
      apiKey: store.get('apiKey'),
      apiSecret: store.get('apiSecret'),
      syncUrl: store.get('syncUrl'),
    };
    tallySync = new TallySync(config);
  }
  return await tallySync.testConnection();
});

ipcMain.handle('sync-now', async () => {
  if (tallySync) {
    return await tallySync.syncNow();
  }
  return { success: false, error: 'Sync not configured' };
});

ipcMain.handle('check-tally-running', async () => {
  if (!tallyDetector) {
    tallyDetector = new TallyDetector();
  }
  const isRunning = await tallyDetector.isTallyRunning();
  updateTrayMenu();
  return isRunning;
});

ipcMain.handle('open-tally-folder', async (event, tallyPath) => {
  shell.openPath(tallyPath);
});

// App lifecycle
app.whenReady().then(() => {
  // Initialize store after app is ready
  store = new SimpleStore();

  createWindow();
  createTray();

  // Load saved config and start sync if enabled
  const config = {
    apiKey: store.get('apiKey'),
    apiSecret: store.get('apiSecret'),
    syncUrl: store.get('syncUrl', 'http://localhost:3100/api/v1'),
    autoSync: store.get('autoSync', true),
    syncInterval: store.get('syncInterval', 5),
  };

  if (config.apiKey && config.apiSecret && config.autoSync) {
    tallySync = new TallySync(config);
    tallySync.start();
  }
});

app.on('second-instance', () => {
  // Someone tried to run a second instance, focus our window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // Keep running in system tray on all platforms
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (tallySync) {
    tallySync.stop();
  }
});
