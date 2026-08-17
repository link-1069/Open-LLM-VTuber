'use strict'

const ACTIVE_STREAM_URL = 'http://localhost:8500/api/active-streams'
const SRS_API_URL = 'http://127.0.0.1:1985/api/v1'
const WHEP_BASE_URL = 'http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream='

const slots = [0, 1].map((index) => ({
  layer: document.getElementById(`stream-layer-${index}`),
  mount: document.getElementById(`stage-${index}`),
  video: document.getElementById(`video-${index}`),
}))

let ws = null
let wsReconnectTimer = null
let streamManager = null
let autoConnectController = null
let unsubscribeRestart = null
let unsubscribePresentation = null
let unsubscribeMediaValidation = null
let unsubscribeNotification = null
let notificationTimer = null
let stageView = null

window.__openLlmVtuberStageReady = false
window.__openLlmVtuberStreamControllerReady = false
window.__openLlmVtuberPresentationReady = false

function showNonModalNotification(notification) {
  const element = document.getElementById('non-modal-notification')
  if (!element || !notification?.message) return
  element.textContent = notification.message
  element.hidden = false
  clearTimeout(notificationTimer)
  notificationTimer = setTimeout(() => {
    element.hidden = true
  }, 5000)
}

function initPresentation() {
  stageView = window.createStageView({
    document,
    window,
    slots,
    electronAPI: window.electronAPI,
  })
  unsubscribePresentation = window.electronAPI.onPresentationStateChanged((snapshot) => {
    stageView.applyPresentationState(snapshot)
  })
  unsubscribeMediaValidation = window.electronAPI.onValidateStageMedia((request) => {
    stageView.validateMedia(request)
      .then((result) => window.electronAPI.resolveStageMediaValidation({
        request_id: request.request_id,
        ...result,
      }))
      .catch((error) => window.electronAPI.resolveStageMediaValidation({
        request_id: request.request_id,
        ok: false,
        error: error?.message || String(error),
      }))
  })
  unsubscribeNotification = window.electronAPI.onNonModalNotification(showNonModalNotification)
  window.electronAPI.getPresentationState()
    .then((snapshot) => stageView.applyPresentationState(snapshot))
    .catch((error) => console.error('Presentation initialization failed:', error))
  window.__openLlmVtuberPresentationReady = true
}

function createStreamManager() {
  return window.createDigitalHumanStreamManager({
    slots,
    connectTimeoutMs: 10000,
    frameTimeoutMs: 120000,
    disconnectGraceMs: 3000,
    createStage: ({ video, mount, onFrameRendered }) => window.createThreeVideoStage({
      THREE: window.THREE,
      video,
      mount,
      onFrameRendered,
      showError: (message) => console.error('Three.js stage error:', message),
    }),
    createStreamController: (options) => window.createSrsStreamController({
      ...options,
      getSdkCtor: () => window.SrsRtcWhipWhepAsync,
      showStatus: (message) => console.debug('SRS stream status:', message),
      logger: console,
    }),
  })
}

async function discoverActiveStream({ signal }) {
  const response = await fetch(ACTIVE_STREAM_URL, { method: 'GET', signal })
  if (!response.ok) {
    throw new Error(`获取活动流 ID 失败：HTTP ${response.status}`)
  }
  const body = await response.json()
  if (!body?.ok) {
    throw new Error(body?.message || '活动流接口返回失败')
  }
  const streamId = body?.stream?.av_stream_id
  return typeof streamId === 'string' || typeof streamId === 'number'
    ? String(streamId).trim()
    : ''
}

async function probeConnection(_candidate, { signal }) {
  const response = await fetch(SRS_API_URL, { method: 'GET', signal })
  return response.ok
}

function buildWhepUrl(streamId) {
  return `${WHEP_BASE_URL}${encodeURIComponent(streamId)}`
}

function persistWhepUrl(whepUrl) {
  return window.electronAPI.saveConfig({
    whep_url: whepUrl,
    last_updated: new Date().toISOString(),
  })
}

function reportAutoConnectProgress(snapshot) {
  if (snapshot.error) {
    console.warn('Automatic access attempt failed:', snapshot.error)
  }
  window.electronAPI.reportAutoConnectProgress(snapshot)
}

function initAutomaticAccess() {
  try {
    streamManager = createStreamManager()
    window.__openLlmVtuberStageReady = true
    window.__openLlmVtuberStreamControllerReady = true

    autoConnectController = window.createAutoConnectController({
      discoverActiveStream,
      probeConnection,
      buildWhepUrl,
      clearConfig: () => persistWhepUrl(''),
      saveConfig: persistWhepUrl,
      streamManager,
      showMain: () => window.electronAPI.showMainWindow(),
      showSetup: () => window.electronAPI.showAutoConnectWindow(),
      onProgress: reportAutoConnectProgress,
    })
    unsubscribeRestart = window.electronAPI.onRestartAutoConnect(() => {
      autoConnectController.restart().catch((error) => {
        console.error('Automatic access restart failed:', error)
      })
    })
    autoConnectController.start().catch((error) => {
      console.error('Automatic access startup failed:', error)
    })
  } catch (error) {
    console.error('Automatic access initialization failed:', error)
    reportAutoConnectProgress({
      round: 0,
      phase: 'retrying',
      error: error?.message || String(error),
    })
  }
}

function scheduleWsReconnect() {
  if (wsReconnectTimer) {
    return
  }
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    connectWs().catch(handleConnectWsError)
  }, 3000)
}

function handleConnectWsError(error) {
  console.error('WebSocket setup failed:', error)
  scheduleWsReconnect()
}

async function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return
  }

  const wsUrl = await window.electronAPI.getWsUrl()
  ws = new WebSocket(wsUrl)
  const socket = ws

  socket.onopen = () => {
    console.log('WebSocket connected to Python backend')
  }

  socket.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }

    switch (message.type) {
      case 'conversation-chain-start':
        console.log('[conversation-chain-start]')
        break
      case 'control':
        if (message.text === 'conversation-chain-start') {
          console.log('[conversation-chain-start]')
        }
        break
      case 'backend-synth-complete':
        console.log('[backend-synth-complete]')
        break
      case 'full-text':
        console.log('[full-text]', message.text)
        break
      case 'set-conf':
        console.log('[conf]', message.conf_name, message.conf_uid)
        break
      case 'error':
        console.error('[backend error]', message.message)
        break
      default:
        break
    }
  }

  socket.onerror = (error) => console.error('WebSocket error:', error)
  socket.onclose = () => {
    if (ws === socket) {
      ws = null
    }
    console.warn('WebSocket closed - reconnecting in 3 s')
    scheduleWsReconnect()
  }
}

window.addEventListener('beforeunload', () => {
  clearTimeout(notificationTimer)
  clearTimeout(wsReconnectTimer)
  if (typeof unsubscribeRestart === 'function') {
    unsubscribeRestart()
  }
  unsubscribePresentation?.()
  unsubscribeMediaValidation?.()
  unsubscribeNotification?.()
  stageView?.dispose()
  autoConnectController?.stop()
  streamManager?.dispose()
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
})

initPresentation()
initAutomaticAccess()
connectWs().catch(handleConnectWsError)
