'use strict'

const stageEl = document.getElementById('stage')
const video = document.getElementById('video')
const subtitle = document.getElementById('subtitle')

let subtitleTimer = null
let ws = null
let wsReconnectTimer = null
let cachedConfig = null
let stage = null
let streamController = null
let returningToSetup = false

window.__openLlmVtuberStageReady = false
window.__openLlmVtuberStreamControllerReady = false

function showSubtitle(text) {
  subtitle.textContent = text
  subtitle.style.display = 'block'
  clearTimeout(subtitleTimer)
  subtitleTimer = setTimeout(() => { subtitle.style.display = 'none' }, 5000)
}

function initThreeStage() {
  try {
    stage = window.createThreeVideoStage({
      THREE: window.THREE,
      video,
      mount: stageEl,
      showError: showSubtitle,
    })
    window.__openLlmVtuberStageReady = true
  } catch (error) {
    console.error('Three.js stage initialization failed:', error)
    showSubtitle(`Three.js stage failed: ${error.message}`)
  }
}

function initStreamController() {
  try {
    streamController = window.createSrsStreamController({
      video,
      showStatus: showSubtitle,
      getSdkCtor: () => window.SrsRtcWhipWhepAsync,
      logger: console,
      playTimeoutMs: 10000,
      mediaReadyTimeoutMs: 10000,
      onConnectionFailed: () => {
        if (returningToSetup) {
          return
        }
        returningToSetup = true
        showSubtitle('SRS 连接失败，请重新设置投流地址')
        window.electronAPI.openSetupWindow().catch((error) => {
          returningToSetup = false
          console.error('Failed to open SRS setup window:', error)
          showSubtitle(`Failed to open SRS setup window: ${error.message}`)
        })
      },
    })
    window.__openLlmVtuberStreamControllerReady = true
  } catch (error) {
    console.error('SRS stream controller initialization failed:', error)
    showSubtitle(`SRS stream controller failed: ${error.message}`)
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
  showSubtitle(`WebSocket setup failed: ${error.message}`)
  scheduleWsReconnect()
}

function handleStreamStartupError(error) {
  console.error('SRS stream startup failed:', error)
  showSubtitle(`SRS stream startup failed: ${error.message}`)
}

async function startConfiguredStream(config, previousWhepUrl) {
  if (!streamController || !config.whep_url) {
    return
  }
  if (config.whep_url === previousWhepUrl) {
    return
  }
  await streamController.start(config.whep_url)
}

async function connectWs() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return
  }

  const [config, wsUrl] = await Promise.all([
    window.electronAPI.getConfig(),
    window.electronAPI.getWsUrl(),
  ])
  const previousWhepUrl = cachedConfig?.whep_url
  cachedConfig = config

  startConfiguredStream(config, previousWhepUrl).catch(handleStreamStartupError)

  ws = new WebSocket(wsUrl)
  const socket = ws

  socket.onopen = () => {
    console.log('WebSocket connected to Python backend')
  }

  socket.onmessage = (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }

    switch (msg.type) {
      case 'display-text':
        if (msg.display_text?.text) showSubtitle(msg.display_text.text)
        break
      case 'conversation-chain-start':
        console.log('[conversation-chain-start]')
        break
      case 'control':
        if (msg.text === 'conversation-chain-start') {
          console.log('[conversation-chain-start]')
        }
        break
      case 'backend-synth-complete':
        console.log('[backend-synth-complete]')
        break
      case 'full-text':
        console.log('[full-text]', msg.text)
        break
      case 'set-conf':
        console.log('[conf]', msg.conf_name, msg.conf_uid)
        break
      case 'error':
        console.error('[backend error]', msg.message)
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
  if (streamController) {
    streamController.close()
  }
  if (stage) {
    stage.dispose()
  }
})

initThreeStage()
initStreamController()
connectWs().catch(handleConnectWsError)
