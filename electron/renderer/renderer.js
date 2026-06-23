'use strict'

const canvas   = document.getElementById('canvas')
const video    = document.getElementById('video')
const subtitle = document.getElementById('subtitle')
const gl       = canvas.getContext('webgl')

let subtitleTimer = null

function showSubtitle(text) {
  subtitle.textContent = text
  subtitle.style.display = 'block'
  clearTimeout(subtitleTimer)
  subtitleTimer = setTimeout(() => { subtitle.style.display = 'none' }, 5000)
}

function initWebGlRenderer() {
  if (!gl) {
    console.error('WebGL not supported')
    showSubtitle('WebGL not supported')
    return
  }

  // WebGL shader setup (passthrough placeholder)
  const VERT_SRC = `
    attribute vec2 aPos;
    varying vec2 vUV;
    void main() {
      vUV = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `

  // Passthrough fragment shader.
  // TODO: Replace with chroma-key shader and discard mostly green pixels.
  const FRAG_SRC = `
    precision mediump float;
    uniform sampler2D uVideo;
    varying vec2 vUV;
    void main() {
      vec4 color = texture2D(uVideo, vec2(vUV.x, 1.0 - vUV.y));
      // TODO: chroma key
      // float greenness = color.g - max(color.r, color.b);
      // if (greenness > 0.35) discard;
      gl_FragColor = color;
    }
  `

  function compileShader(type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s))
    }
    return s
  }

  const prog = gl.createProgram()
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, VERT_SRC))
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, FRAG_SRC))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Shader link error: ' + gl.getProgramInfoLog(prog))
  }
  gl.useProgram(prog)

  // Full-screen quad: two triangles via TRIANGLE_STRIP
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
    gl.STATIC_DRAW
  )
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // Video texture
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  function resizeCanvas() {
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  window.addEventListener('resize', resizeCanvas)
  resizeCanvas()

  function renderFrame() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    requestAnimationFrame(renderFrame)
  }
  requestAnimationFrame(renderFrame)
}

let sdk = null
let streamRetryTimer = null
let currentWhepUrl = null
let streamAttemptId = 0

function clearStreamRetryTimer() {
  if (streamRetryTimer) {
    clearTimeout(streamRetryTimer)
    streamRetryTimer = null
  }
}

function scheduleStreamRetry(whepUrl, attemptId) {
  if (attemptId !== streamAttemptId || whepUrl !== currentWhepUrl || streamRetryTimer) {
    return
  }
  streamRetryTimer = setTimeout(() => {
    streamRetryTimer = null
    if (attemptId === streamAttemptId && whepUrl === currentWhepUrl) {
      startStream(whepUrl, true)
    }
  }, 5000)
}

async function startStream(whepUrl, forceRestart = false) {
  if (!forceRestart && currentWhepUrl === whepUrl && sdk) {
    return
  }

  clearStreamRetryTimer()
  currentWhepUrl = whepUrl
  const attemptId = ++streamAttemptId

  if (sdk) {
    sdk.close()
    sdk = null
  }

  if (typeof SrsRtcWhipWhepAsync !== 'function') {
    console.error('SRS SDK is not available')
    showSubtitle('SRS SDK is not available')
    scheduleStreamRetry(whepUrl, attemptId)
    return
  }

  sdk = new SrsRtcWhipWhepAsync()
  video.srcObject = sdk.stream
  try {
    const session = await sdk.play(whepUrl)
    if (attemptId !== streamAttemptId) {
      return
    }
    console.log('SRS session:', session.sessionid)
    await video.play()
  } catch (e) {
    if (attemptId !== streamAttemptId) {
      return
    }
    console.error('SRS stream error:', e)
    scheduleStreamRetry(whepUrl, attemptId)
  }
}

let ws = null
let wsReconnectTimer = null
let cachedConfig = null

function scheduleWsReconnect() {
  if (wsReconnectTimer) {
    return
  }
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    connectWs()
  }, 3000)
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

  if (config.whep_url && (config.whep_url !== previousWhepUrl || config.whep_url !== currentWhepUrl || !sdk)) {
    startStream(config.whep_url)
  }

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

  socket.onerror = (e) => console.error('WebSocket error:', e)

  socket.onclose = () => {
    if (ws === socket) {
      ws = null
    }
    console.warn('WebSocket closed - reconnecting in 3 s')
    scheduleWsReconnect()
  }
}

initWebGlRenderer()
connectWs()
