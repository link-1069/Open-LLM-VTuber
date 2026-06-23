const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const PROJECT_ROOT = path.join(__dirname, '..')
const SERVER_PORT = 12393

let mainWindow = null
let setupWindow = null
let pythonProcess = null

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

function spawnPython() {
  pythonProcess = spawn('uv', ['run', 'run_server.py'], {
    cwd: PROJECT_ROOT,
    shell: true,
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Python server startup timeout (30s)')),
      30000
    )
    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString()
      console.log('[Python]', text.trimEnd())
      if (text.includes('Application startup complete')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    pythonProcess.stderr.on('data', (data) => {
      console.error('[Python stderr]', data.toString().trimEnd())
    })
    pythonProcess.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 800,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 520,
    height: 240,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'))
  setupWindow.on('closed', () => { setupWindow = null })
}

app.whenReady().then(async () => {
  ipcMain.handle('get-config', () => readConfig())
  ipcMain.handle('save-config', (_, cfg) => { writeConfig(cfg); return true })
  ipcMain.handle('get-ws-url', () => `ws://localhost:${SERVER_PORT}/client-ws`)
  ipcMain.handle('open-main-window', () => {
    if (setupWindow) setupWindow.close()
    createMainWindow()
  })

  try {
    await spawnPython()
    console.log('Python server ready.')
  } catch (e) {
    console.error('Python server failed to start:', e.message)
    // Continue anyway 鈥?user may have server running separately
  }

  const cfg = readConfig()
  if (cfg.whep_url) {
    createMainWindow()
  } else {
    createSetupWindow()
  }
})

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill()
    pythonProcess = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
