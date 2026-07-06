const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const SERVER_PORT = 12393
const ENTRY_PAGE_URL = 'http://localhost:8500/static/h5.html'

let entryWindow = null
let mainWindow = null
let setupWindow = null
let pythonProcess = null

function getProjectRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..')
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function normalizeConfig(cfg) {
  return {
    whep_url: typeof cfg?.whep_url === 'string' ? cfg.whep_url : '',
    last_updated: typeof cfg?.last_updated === 'string' ? cfg.last_updated : new Date().toISOString(),
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalizeConfig(cfg), null, 2), 'utf8')
}

function handlePythonOutput(data, log, prefix, markReady) {
  const text = data.toString()
  log(prefix, text.trimEnd())
  if (text.includes('Application startup complete')) {
    markReady()
  }
}

function stopPythonProcess() {
  if (!pythonProcess) {
    return
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pythonProcess.pid), '/t', '/f'], { shell: true })
  } else {
    pythonProcess.kill()
  }
  pythonProcess = null
}

function ensureBackendConfig(projectRoot) {
  const targetConfig = path.join(projectRoot, 'conf.yaml')
  if (fs.existsSync(targetConfig)) {
    return
  }

  const defaultConfig = path.join(projectRoot, 'config_templates', 'conf.default.yaml')
  fs.copyFileSync(defaultConfig, targetConfig)
}

function assertUvAvailable() {
  const result = spawnSync('uv', ['--version'], { stdio: 'ignore' })
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('uv is not available in PATH. Install uv or add it to PATH before starting the bundled backend.')
  }
  if (result.status !== 0) {
    throw new Error('uv check failed. Ensure uv is installed and available in PATH.')
  }
}

function spawnPython() {
  const projectRoot = getProjectRoot()
  ensureBackendConfig(projectRoot)
  assertUvAvailable()
  pythonProcess = spawn('uv', ['run', 'run_server.py'], {
    cwd: projectRoot,
    shell: true,
  })
  return new Promise((resolve, reject) => {
    let settled = false
    let ready = false
    let timeout = null
    function cleanup() {
      if (pythonProcess) {
        pythonProcess.removeListener('error', onError)
        pythonProcess.removeListener('exit', onExit)
        pythonProcess.removeListener('close', onClose)
        pythonProcess.stdout.removeListener('data', onStdout)
        pythonProcess.stderr.removeListener('data', onStderr)
      }
    }
    function finish() {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      resolve()
    }
    function fail(err) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      stopPythonProcess()
      reject(err)
    }
    function onStdout(data) {
      handlePythonOutput(data, console.log, '[Python]', () => {
        ready = true
        finish()
      })
    }
    function onStderr(data) {
      handlePythonOutput(data, console.error, '[Python stderr]', () => {
        ready = true
        finish()
      })
    }
    function onError(err) {
      if (err.code === 'ENOENT') {
        fail(new Error('uv is not available in PATH. Install uv or add it to PATH before starting the bundled backend.'))
        return
      }
      fail(err)
    }
    function onExit(code, signal) {
      if (!settled && !ready) {
        fail(new Error(`Python server exited before startup complete (code=${code}, signal=${signal})`))
      }
    }
    function onClose(code, signal) {
      if (!settled && !ready) {
        fail(new Error(`Python server closed before startup complete (code=${code}, signal=${signal})`))
      }
    }
    timeout = setTimeout(
      () => fail(new Error('Python server startup timeout (30s)')),
      30000
    )
    pythonProcess.stdout.on('data', onStdout)
    pythonProcess.stderr.on('data', onStderr)
    pythonProcess.on('error', onError)
    pythonProcess.on('exit', onExit)
    pythonProcess.on('close', onClose)
  })
}

function createMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    return
  }
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
  mainWindow.webContents.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: '设置投流地址',
        click: openSetupWindowAndCloseMain,
      },
    ])
    menu.popup({ window: mainWindow })
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

function createEntryWindow() {
  if (entryWindow) {
    if (entryWindow.isMinimized()) {
      entryWindow.restore()
    }
    entryWindow.show()
    entryWindow.focus()
    return
  }
  entryWindow = new BrowserWindow({
    width: 480,
    height: 800,
    frame: false,
    autoHideMenuBar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  entryWindow.setMenu(null)
  entryWindow.loadURL(ENTRY_PAGE_URL)
  entryWindow.on('closed', () => { entryWindow = null })
}

function createSetupWindow() {
  if (setupWindow) {
    if (setupWindow.isMinimized()) {
      setupWindow.restore()
    }
    setupWindow.show()
    setupWindow.focus()
    return
  }
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

function openSetupWindowAndCloseMain() {
  createSetupWindow()
  if (mainWindow) {
    mainWindow.close()
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  ipcMain.handle('get-config', () => normalizeConfig(readConfig()))
  ipcMain.handle('save-config', (_, cfg) => { writeConfig(cfg); return true })
  ipcMain.handle('get-ws-url', () => `ws://localhost:${SERVER_PORT}/client-ws`)
  ipcMain.handle('open-main-window', () => {
    if (setupWindow) setupWindow.close()
    createMainWindow()
  })
  ipcMain.handle('open-setup-window', () => {
    createSetupWindow()
    if (mainWindow) {
      mainWindow.close()
    }
    return true
  })

  createEntryWindow()

  try {
    await spawnPython()
    console.log('Python server ready.')
  } catch (e) {
    console.error('Python server failed to start:', e.message)
    // Continue anyway - user may have server running separately
  }
})

app.on('before-quit', () => {
  stopPythonProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
