const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  validateBounds,
} = require('./window_bounds')

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const SERVER_PORT = 12393
const WINDOW_BOUNDS_SAVE_DELAY_MS = 300

let mainWindow = null
let setupWindow = null
let pythonProcess = null
let mainWindowBoundsSaveTimer = null
let mainWindowSaveStatus = { state: 'saved' }
let latestAutoConnectProgress = null
let isQuitting = false

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
  const windowBounds = normalizeStoredBounds(cfg?.window_bounds)
  return {
    whep_url: typeof cfg?.whep_url === 'string' ? cfg.whep_url : '',
    last_updated: typeof cfg?.last_updated === 'string' ? cfg.last_updated : new Date().toISOString(),
    ...(windowBounds ? { window_bounds: windowBounds } : {}),
  }
}

function writeConfig(cfg) {
  const nextConfig = normalizeConfig({ ...readConfig(), ...cfg })
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2), 'utf8')
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

function getDisplayWorkAreas() {
  return screen.getAllDisplays().map((display) => display.workArea)
}

function boundsEqual(first, second) {
  return first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
}

function sendToMainWindow(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }
  mainWindow.webContents.send(channel, payload)
}

function sendToSetupWindow(channel, payload) {
  if (!setupWindow || setupWindow.isDestroyed() || setupWindow.webContents.isDestroyed()) {
    return
  }
  setupWindow.webContents.send(channel, payload)
}

function updateMainWindowSaveStatus(status) {
  mainWindowSaveStatus = status
  sendToMainWindow('main-window-save-status', status)
}

function persistMainWindowBounds(bounds) {
  try {
    writeConfig({ window_bounds: bounds })
    const status = { state: 'saved' }
    updateMainWindowSaveStatus(status)
    return status
  } catch (error) {
    const status = {
      state: 'error',
      message: error?.message || 'Unable to write the window configuration.',
    }
    updateMainWindowSaveStatus(status)
    return status
  }
}

function clearMainWindowBoundsSaveTimer() {
  if (!mainWindowBoundsSaveTimer) {
    return
  }
  clearTimeout(mainWindowBoundsSaveTimer)
  mainWindowBoundsSaveTimer = null
}

function correctMainWindowBounds(bounds, fallbackWorkArea) {
  if (hasMinimumVisibleArea(bounds, getDisplayWorkAreas(), MIN_VISIBLE_SIZE)) {
    return bounds
  }
  return constrainBoundsToWorkArea(bounds, fallbackWorkArea, MIN_VISIBLE_SIZE)
}

function flushMainWindowBoundsSave() {
  if (!mainWindowBoundsSaveTimer || !mainWindow || mainWindow.isDestroyed()) {
    clearMainWindowBoundsSaveTimer()
    return null
  }

  clearMainWindowBoundsSaveTimer()
  const currentBounds = mainWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const correctedBounds = correctMainWindowBounds(currentBounds, display.workArea)
  if (!boundsEqual(currentBounds, correctedBounds)) {
    mainWindow.setBounds(correctedBounds)
    sendToMainWindow('main-window-bounds-changed', correctedBounds)
  }
  return persistMainWindowBounds(correctedBounds)
}

function queueMainWindowBoundsSave() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const bounds = mainWindow.getBounds()
  sendToMainWindow('main-window-bounds-changed', bounds)
  updateMainWindowSaveStatus({ state: 'saving' })
  clearMainWindowBoundsSaveTimer()
  mainWindowBoundsSaveTimer = setTimeout(
    flushMainWindowBoundsSave,
    WINDOW_BOUNDS_SAVE_DELAY_MS
  )
}

function assertMainWindowSender(event) {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!mainWindow || senderWindow !== mainWindow) {
    throw new Error('Window controls are only available in the main display window.')
  }
}

function applyMainWindowBounds(bounds) {
  const fieldErrors = validateBounds(bounds)
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      fieldErrors,
      message: 'Correct the highlighted fields.',
    }
  }

  if (!hasMinimumVisibleArea(bounds, getDisplayWorkAreas(), MIN_VISIBLE_SIZE)) {
    const message = `At least ${MIN_VISIBLE_SIZE}×${MIN_VISIBLE_SIZE}px of the window must remain visible.`
    return {
      ok: false,
      fieldErrors: { x: message, y: message },
      message,
    }
  }

  try {
    if (mainWindow.isMaximized()) {
      mainWindow.restore()
    }
    mainWindow.setBounds(bounds)
    const appliedBounds = mainWindow.getBounds()
    clearMainWindowBoundsSaveTimer()
    sendToMainWindow('main-window-bounds-changed', appliedBounds)
    updateMainWindowSaveStatus({ state: 'saving' })
    const saveStatus = persistMainWindowBounds(appliedBounds)
    return {
      ok: true,
      bounds: appliedBounds,
      saveStatus,
    }
  } catch (error) {
    const message = error?.message || 'The operating system rejected these window bounds.'
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((field) => [field, message])
      ),
      message,
    }
  }
}

function resetMainWindowBounds() {
  const currentBounds = mainWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const defaultBounds = centerBoundsInWorkArea(DEFAULT_WINDOW_SIZE, display.workArea)
  return applyMainWindowBounds(defaultBounds)
}

function getInitialMainWindowBounds() {
  const storedBounds = normalizeStoredBounds(readConfig().window_bounds)
  if (!storedBounds) {
    return { bounds: null, corrected: false }
  }

  if (hasMinimumVisibleArea(storedBounds, getDisplayWorkAreas(), MIN_VISIBLE_SIZE)) {
    return { bounds: storedBounds, corrected: false }
  }

  const correctedBounds = constrainBoundsToWorkArea(
    storedBounds,
    screen.getPrimaryDisplay().workArea,
    MIN_VISIBLE_SIZE
  )
  return { bounds: correctedBounds, corrected: true }
}

function createMainWindow({ show = true } = {}) {
  if (mainWindow) {
    if (show) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }
    return
  }
  const initialWindowBounds = getInitialMainWindowBounds()
  mainWindow = new BrowserWindow({
    ...(initialWindowBounds.bounds || DEFAULT_WINDOW_SIZE),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    show,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  mainWindow.webContents.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: '重新检测连接',
        click: restartAutomaticAccess,
      },
    ])
    menu.popup({ window: mainWindow })
  })
  mainWindow.on('move', queueMainWindowBoundsSave)
  mainWindow.on('resize', queueMainWindowBoundsSave)
  mainWindow.on('close', (event) => {
    flushMainWindowBoundsSave()
    quitFromWindowClose(event)
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'))
  if (initialWindowBounds.corrected) {
    persistMainWindowBounds(initialWindowBounds.bounds)
  }
  mainWindow.on('closed', () => {
    clearMainWindowBoundsSaveTimer()
    mainWindow = null
  })
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
    height: 420,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'))
  setupWindow.webContents.on('did-finish-load', () => {
    if (latestAutoConnectProgress) {
      sendToSetupWindow('auto-connect-progress', latestAutoConnectProgress)
    }
  })
  setupWindow.on('close', quitFromWindowClose)
  setupWindow.on('closed', () => { setupWindow = null })
}

function quitFromWindowClose(event) {
  if (isQuitting) {
    return
  }
  event.preventDefault()
  app.quit()
}

function showMainWindow() {
  createMainWindow({ show: true })
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.hide()
  }
}

function showAutoConnectWindow() {
  createSetupWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
}

function restartAutomaticAccess() {
  showAutoConnectWindow()
  sendToMainWindow('restart-auto-connect')
}

app.whenReady().then(() => {
  ipcMain.handle('get-config', () => normalizeConfig(readConfig()))
  ipcMain.handle('save-config', (_, cfg) => { writeConfig(cfg); return true })
  ipcMain.handle('get-ws-url', () => `ws://localhost:${SERVER_PORT}/client-ws`)
  ipcMain.handle('get-main-window-state', (event) => {
    assertMainWindowSender(event)
    return {
      bounds: mainWindow.getBounds(),
      saveStatus: mainWindowSaveStatus,
    }
  })
  ipcMain.handle('set-main-window-bounds', (event, bounds) => {
    assertMainWindowSender(event)
    return applyMainWindowBounds(bounds)
  })
  ipcMain.handle('reset-main-window-bounds', (event) => {
    assertMainWindowSender(event)
    return resetMainWindowBounds()
  })
  ipcMain.handle('show-main-window', (event) => {
    assertMainWindowSender(event)
    showMainWindow()
    return true
  })
  ipcMain.handle('show-auto-connect-window', (event) => {
    assertMainWindowSender(event)
    showAutoConnectWindow()
    return true
  })
  ipcMain.on('auto-connect-progress', (event, snapshot) => {
    assertMainWindowSender(event)
    latestAutoConnectProgress = snapshot
    sendToSetupWindow('auto-connect-progress', snapshot)
  })

  createSetupWindow()
  createMainWindow({ show: false })

  Promise.resolve()
    .then(spawnPython)
    .then(() => console.log('Python server ready.'))
    .catch((e) => {
    console.error('Python server failed to start:', e.message)
    // Continue anyway - user may have server running separately
    })
})

app.on('before-quit', () => {
  isQuitting = true
  flushMainWindowBoundsSave()
  stopPythonProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
