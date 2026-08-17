const { app, BrowserWindow, dialog, ipcMain, Menu, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const { createPresentationController } = require('./presentation_controller')
const { runPresentationExit } = require('./presentation_exit')
const { createPresentationMenuTemplate } = require('./presentation_menu')
const {
  buildStageMediaUrl,
  createStageMediaTracker,
  getMediaSignature,
} = require('./presentation_media')
const {
  PRESENTATION_MODES,
  STAGE_BACKGROUND_KINDS,
  getStageMediaType,
  normalizeConfig,
} = require('./presentation_state')
const {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  selectLatestDesktopBounds,
  validateBounds,
} = require('./window_bounds')

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const SERVER_PORT = 12393
const WINDOW_BOUNDS_SAVE_DELAY_MS = 3000
const STAGE_MEDIA_POLL_INTERVAL_MS = 3000
const STAGE_MEDIA_VALIDATION_TIMEOUT_MS = 12000

let mainWindow = null
let setupWindow = null
let pythonProcess = null
let mainWindowBoundsSaveTimer = null
let mainWindowSaveStatus = { state: 'saved' }
let latestAutoConnectProgress = null
let isQuitting = false
let presentationController = null
let pendingMainWindowBounds = null
let stageMediaPollTimer = null
let nextMediaValidationId = 1
let lastNonModalError = ''
let quitConfirmationInProgress = false
const pendingMediaValidations = new Map()
const stageMediaTracker = createStageMediaTracker({ validate: requestMediaValidation })

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

function writeConfig(cfg) {
  const nextConfig = normalizeConfig({ ...readConfig(), ...cfg })
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(nextConfig, null, 2), 'utf8')
    fs.renameSync(temporaryPath, CONFIG_PATH)
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath)
    } catch {}
    throw error
  }
  return nextConfig
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

function getConfiguredMediaPath() {
  return presentationController?.getSnapshot().stage_background.media_path || ''
}

function getApprovedMediaDescriptor() {
  return stageMediaTracker.getDescriptor(getConfiguredMediaPath())
}

function buildPresentationSnapshot(snapshot = presentationController?.getSnapshot()) {
  if (!snapshot) return null
  return {
    ...snapshot,
    ...getApprovedMediaDescriptor(),
  }
}

function publishPresentationState(snapshot) {
  const payload = buildPresentationSnapshot(snapshot)
  if (payload) sendToMainWindow('presentation-state-changed', payload)
  updateStageMediaPolling()
  return payload
}

function showNonModalError(message) {
  if (!message || message === lastNonModalError) return
  lastNonModalError = message
  sendToMainWindow('non-modal-notification', { kind: 'error', message })
}

async function showOperationError(title, error) {
  await dialog.showMessageBox(mainWindow || setupWindow, {
    type: 'error',
    title,
    message: error?.message || String(error),
    buttons: ['确定'],
    defaultId: 0,
    noLink: true,
  })
}

function clearPendingMediaValidations(result = { ok: false, error: '媒体校验已取消' }) {
  for (const pending of pendingMediaValidations.values()) {
    clearTimeout(pending.timeout)
    pending.resolve(result)
  }
  pendingMediaValidations.clear()
}

function requestMediaValidation(mediaPath, stats) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return Promise.resolve({ ok: false, error: '主展示窗口不可用' })
  }
  const mediaType = getStageMediaType(mediaPath)
  if (!mediaType) {
    return Promise.resolve({ ok: false, error: '不支持的舞台背景格式' })
  }
  const requestId = nextMediaValidationId++
  const signature = getMediaSignature(stats)
  const mediaUrl = buildStageMediaUrl(mediaPath, signature)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingMediaValidations.delete(requestId)
      resolve({ ok: false, error: '媒体文件解码超时' })
    }, STAGE_MEDIA_VALIDATION_TIMEOUT_MS)
    pendingMediaValidations.set(requestId, { resolve, timeout })
    sendToMainWindow('validate-stage-media', {
      request_id: requestId,
      media_type: mediaType,
      media_url: mediaUrl,
    })
  })
}

function isStageMediaRelevant() {
  const snapshot = presentationController?.getSnapshot()
  return Boolean(
    snapshot &&
    snapshot.effective_mode === PRESENTATION_MODES.FULLSCREEN_STAGE &&
    snapshot.stage_background.kind === STAGE_BACKGROUND_KINDS.MEDIA &&
    snapshot.stage_background.media_path &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible()
  )
}

async function checkStageMedia() {
  if (!isStageMediaRelevant()) return
  const result = await stageMediaTracker.check(getConfiguredMediaPath())
  if (result.changed) publishPresentationState()
}

function stopStageMediaPolling() {
  if (stageMediaPollTimer) {
    clearInterval(stageMediaPollTimer)
    stageMediaPollTimer = null
  }
}

function updateStageMediaPolling() {
  if (!isStageMediaRelevant()) {
    stopStageMediaPolling()
    return
  }
  if (!stageMediaPollTimer) {
    stageMediaPollTimer = setInterval(checkStageMedia, STAGE_MEDIA_POLL_INTERVAL_MS)
  }
  setTimeout(checkStageMedia, 0)
}

function updateMainWindowSaveStatus(status) {
  mainWindowSaveStatus = status
  sendToMainWindow('main-window-save-status', status)
}

function persistMainWindowBounds(bounds) {
  try {
    writeConfig({ window_bounds: bounds })
    pendingMainWindowBounds = null
    presentationController?.updateDesktopBounds(bounds)
    lastNonModalError = ''
    const status = { state: 'saved' }
    updateMainWindowSaveStatus(status)
    return status
  } catch (error) {
    pendingMainWindowBounds = { ...bounds }
    const status = {
      state: 'error',
      message: error?.message || 'Unable to write the window configuration.',
    }
    updateMainWindowSaveStatus(status)
    showNonModalError(`窗口位置和尺寸保存失败：${status.message}`)
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    clearMainWindowBoundsSaveTimer()
    return null
  }

  const snapshot = presentationController?.getSnapshot()
  if (snapshot?.effective_mode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
    clearMainWindowBoundsSaveTimer()
    return null
  }
  if (!mainWindowBoundsSaveTimer && !pendingMainWindowBounds) return null

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
  if (presentationController?.getSnapshot().effective_mode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
    return
  }

  const bounds = mainWindow.getBounds()
  pendingMainWindowBounds = { ...bounds }
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
  if (presentationController?.getSnapshot().effective_mode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
    return {
      ok: false,
      fieldErrors: {},
      message: '全屏舞台中不能修改桌面宠物窗口。',
    }
  }
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

async function runDiscretePresentationAction(title, action) {
  try {
    await action()
    return true
  } catch (error) {
    await showOperationError(title, error)
    return false
  }
}

async function setPresentationMode(mode) {
  if (presentationController?.getSnapshot().editing_person) return false
  flushMainWindowBoundsSave()
  return runDiscretePresentationAction('切换呈现模式失败', async () => {
    const snapshot = await presentationController.setMode(mode)
    publishPresentationState(snapshot)
  })
}

async function setStageBackgroundKind(kind) {
  let approvedCandidate = null
  if (kind === STAGE_BACKGROUND_KINDS.MEDIA) {
    const mediaPath = getConfiguredMediaPath()
    const inspection = stageMediaTracker.inspect(mediaPath)
    if (!inspection.available) {
      await showOperationError('设置舞台背景失败', new Error('已选媒体文件不可用'))
      return false
    }
    const { signature, stats } = inspection
    const approvedMedia = stageMediaTracker.getApproved()
    if (approvedMedia?.path !== mediaPath || approvedMedia.signature !== signature) {
      const validation = await stageMediaTracker.validateCandidate(mediaPath, stats)
      if (!validation.ok) {
        stageMediaTracker.markDecodeFailure(mediaPath, signature)
        await showOperationError('设置舞台背景失败', new Error(validation.error || '媒体文件无法解码'))
        return false
      }
      approvedCandidate = validation.descriptor
    }
  }
  return runDiscretePresentationAction('设置舞台背景失败', async () => {
    const snapshot = presentationController.setBackgroundKind(kind)
    if (approvedCandidate) stageMediaTracker.approve(approvedCandidate)
    publishPresentationState(snapshot)
  })
}

async function chooseStageBackgroundMedia() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择舞台背景媒体',
    properties: ['openFile'],
    filters: [
      { name: '舞台背景', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'mp4'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return false
  const mediaPath = result.filePaths[0]
  const mediaType = getStageMediaType(mediaPath)
  if (!mediaType) {
    await showOperationError('舞台背景不可用', new Error('仅支持 PNG、JPG/JPEG、WebP、BMP、GIF 和 MP4。'))
    return false
  }
  const inspection = stageMediaTracker.inspect(mediaPath)
  if (!inspection.available) {
    await showOperationError('舞台背景不可用', new Error('所选媒体文件不可用'))
    return false
  }
  const { stats } = inspection
  const validation = await stageMediaTracker.validateCandidate(mediaPath, stats)
  if (!validation.ok) {
    await showOperationError('舞台背景不可用', new Error(validation.error || '媒体文件无法解码'))
    return false
  }
  const saved = await runDiscretePresentationAction('保存舞台背景失败', async () => {
    const snapshot = presentationController.selectMediaPath(mediaPath)
    stageMediaTracker.approve(validation.descriptor)
    publishPresentationState(snapshot)
  })
  return saved
}

async function clearStageBackgroundMedia() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '清除舞台背景媒体',
    message: '确认切换为透明背景并删除已保存的媒体路径吗？',
    buttons: ['取消', '清除'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  })
  if (result.response !== 1) return false
  return runDiscretePresentationAction('清除舞台背景失败', async () => {
    const snapshot = presentationController.clearMediaPath()
    stageMediaTracker.clear()
    publishPresentationState(snapshot)
  })
}

async function resetStagePersonLayout() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '恢复默认人物布局',
    message: '确认恢复全屏舞台的默认人物大小和位置吗？',
    buttons: ['取消', '恢复默认'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  })
  if (result.response !== 1) return false
  return runDiscretePresentationAction('恢复人物布局失败', async () => {
    const snapshot = presentationController.resetPersonLayout()
    publishPresentationState(snapshot)
  })
}

function beginStagePersonEditing() {
  if (!presentationController || presentationController.getSnapshot().editing_person) return false
  flushMainWindowBoundsSave()
  try {
    publishPresentationState(presentationController.beginPersonEditing())
    return true
  } catch (error) {
    showOperationError('打开人物布局编辑失败', error)
    return false
  }
}

function isConfiguredMediaAvailable() {
  const mediaPath = getConfiguredMediaPath()
  if (!mediaPath) return false
  return stageMediaTracker.inspect(mediaPath).available
}

function buildMainWindowContextMenu() {
  const snapshot = presentationController.getSnapshot()
  const mediaAvailable = isConfiguredMediaAvailable()
  return Menu.buildFromTemplate(createPresentationMenuTemplate(snapshot, mediaAvailable, {
    setMode: setPresentationMode,
    setBackgroundKind: setStageBackgroundKind,
    chooseMedia: chooseStageBackgroundMedia,
    clearMedia: clearStageBackgroundMedia,
    editPerson: beginStagePersonEditing,
    resetPerson: resetStagePersonLayout,
    restart: { label: '重新检测连接', click: restartAutomaticAccess },
    quit: requestApplicationQuit,
  }))
}

async function requestApplicationQuit() {
  if (isQuitting || quitConfirmationInProgress) return
  quitConfirmationInProgress = true
  try {
    const shouldExit = await runPresentationExit({
      confirmExit: async () => {
        const confirmation = await dialog.showMessageBox(mainWindow || setupWindow, {
          type: 'question',
          title: '退出应用',
          message: '确认退出 Open-LLM-VTuber 吗？',
          buttons: ['取消', '退出'],
          cancelId: 0,
          defaultId: 0,
          noLink: true,
        })
        return confirmation.response === 1
      },
      flushPendingSave: flushMainWindowBoundsSave,
      hasPendingSave: () => Boolean(pendingMainWindowBounds),
      retryPendingSave: () => pendingMainWindowBounds
        ? persistMainWindowBounds(pendingMainWindowBounds)
        : null,
      resolveSaveFailure: async (saveStatus) => {
        const decision = await dialog.showMessageBox(mainWindow || setupWindow, {
          type: 'error',
          title: '最终保存失败',
          message: saveStatus.message || '窗口位置和尺寸无法保存。',
          buttons: ['重试', '仍然退出'],
          cancelId: 0,
          defaultId: 0,
          noLink: true,
        })
        return decision.response === 1 ? 'exit' : 'retry'
      },
    })
    if (!shouldExit) return
    isQuitting = true
    app.quit()
  } finally {
    quitConfirmationInProgress = false
  }
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
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  if (initialWindowBounds.corrected) {
    writeConfig({ window_bounds: initialWindowBounds.bounds })
  }
  presentationController = createPresentationController({
    readConfig,
    writeConfig,
    window: mainWindow,
    getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    getAllDisplays: () => screen.getAllDisplays(),
  })
  presentationController.applySavedMode()
  mainWindow.webContents.on('context-menu', () => {
    if (presentationController.getSnapshot().editing_person) return
    buildMainWindowContextMenu().popup({ window: mainWindow })
  })
  mainWindow.on('move', queueMainWindowBoundsSave)
  mainWindow.on('resize', queueMainWindowBoundsSave)
  mainWindow.on('close', (event) => {
    quitFromWindowClose(event)
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'))
  mainWindow.webContents.on('did-finish-load', () => {
    publishPresentationState(presentationController.applySavedMode())
  })
  mainWindow.on('closed', () => {
    clearMainWindowBoundsSaveTimer()
    stopStageMediaPolling()
    clearPendingMediaValidations()
    presentationController?.dispose()
    presentationController = null
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
  requestApplicationQuit()
}

function showMainWindow() {
  createMainWindow({ show: true })
  if (presentationController) {
    publishPresentationState(presentationController.applySavedMode())
  }
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.hide()
  }
}

function showAutoConnectWindow() {
  createSetupWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (presentationController?.getSnapshot().editing_person) {
      presentationController.cancelPersonEditing()
    }
    const suspendedSnapshot = {
      ...presentationController?.getSnapshot(),
      effective_mode: PRESENTATION_MODES.DESKTOP_PET,
      previewing_stage: false,
      editing_person: false,
    }
    sendToMainWindow('presentation-state-changed', buildPresentationSnapshot(suspendedSnapshot))
    stopStageMediaPolling()
    mainWindow.hide()
  }
}

function restartAutomaticAccess() {
  showAutoConnectWindow()
  sendToMainWindow('restart-auto-connect')
}

app.whenReady().then(() => {
  ipcMain.handle('get-config', () => normalizeConfig(readConfig()))
  ipcMain.handle('save-config', (_, cfg) => {
    writeConfig(cfg)
    presentationController?.reloadConfig()
    return true
  })
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
  ipcMain.handle('get-presentation-state', (event) => {
    assertMainWindowSender(event)
    return buildPresentationSnapshot()
  })
  ipcMain.handle('set-presentation-mode', (event, mode) => {
    assertMainWindowSender(event)
    return setPresentationMode(mode)
  })
  ipcMain.handle('set-stage-background-kind', (event, kind) => {
    assertMainWindowSender(event)
    return setStageBackgroundKind(kind)
  })
  ipcMain.handle('begin-stage-person-editing', (event) => {
    assertMainWindowSender(event)
    return beginStagePersonEditing()
  })
  ipcMain.handle('save-stage-person-layout', async (event, layout) => {
    assertMainWindowSender(event)
    try {
      publishPresentationState(presentationController.savePersonLayout(layout))
      return true
    } catch (error) {
      publishPresentationState(presentationController.cancelPersonEditing())
      await showOperationError('保存人物布局失败', error)
      return false
    }
  })
  ipcMain.handle('cancel-stage-person-editing', (event) => {
    assertMainWindowSender(event)
    publishPresentationState(presentationController.cancelPersonEditing())
    return true
  })
  ipcMain.handle('request-application-quit', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow !== mainWindow && senderWindow !== setupWindow) {
      throw new Error('Unknown quit request source.')
    }
    requestApplicationQuit()
    return true
  })
  ipcMain.on('stage-media-validation-result', (event, result) => {
    assertMainWindowSender(event)
    const pending = pendingMediaValidations.get(result?.request_id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pendingMediaValidations.delete(result.request_id)
    pending.resolve(result?.ok
      ? { ok: true }
      : { ok: false, error: result?.error || '媒体文件无法解码' })
  })
  ipcMain.on('stage-media-render-failure', (event, payload) => {
    assertMainWindowSender(event)
    if (stageMediaTracker.markRenderFailure(payload?.media_url)) publishPresentationState()
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

  screen.on('display-removed', (_event, display) => {
    const config = normalizeConfig(readConfig())
    const latestDesktopBounds = selectLatestDesktopBounds(
      pendingMainWindowBounds,
      presentationController?.getSnapshot().desktop_bounds,
      config.window_bounds
    )
    if (latestDesktopBounds && !hasMinimumVisibleArea(
      latestDesktopBounds,
      getDisplayWorkAreas(),
      MIN_VISIBLE_SIZE
    )) {
      const corrected = constrainBoundsToWorkArea(
        latestDesktopBounds,
        screen.getPrimaryDisplay().workArea,
        MIN_VISIBLE_SIZE
      )
      presentationController?.correctDesktopBounds(corrected)
      if (presentationController?.getSnapshot().effective_mode === PRESENTATION_MODES.DESKTOP_PET) {
        mainWindow.setBounds(corrected)
        sendToMainWindow('main-window-bounds-changed', corrected)
      }
      persistMainWindowBounds(corrected)
    }
    if (presentationController?.handleDisplayRemoved(display.id)) {
      publishPresentationState()
    }
  })
  screen.on('display-metrics-changed', (_event, display) => {
    if (presentationController?.refreshStageDisplay(display.id)) {
      publishPresentationState()
    }
  })

  if (process.env.ELECTRON_SKIP_BACKEND_STARTUP_FOR_TESTS !== '1') {
    Promise.resolve()
      .then(spawnPython)
      .then(() => console.log('Python server ready.'))
      .catch((error) => {
        console.error('Python server failed to start:', error.message)
        // Continue anyway - user may have server running separately
      })
  }
})

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault()
    requestApplicationQuit()
    return
  }
  flushMainWindowBoundsSave()
  stopStageMediaPolling()
  clearPendingMediaValidations()
  presentationController?.dispose()
  stopPythonProcess()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
