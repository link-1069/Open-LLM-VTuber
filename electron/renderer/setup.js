'use strict'

const AUTO_CONNECT_PHASES = window.AUTO_CONNECT_PHASES
const roundEl = document.getElementById('detection-round')
const discoveryEl = document.getElementById('discovery-status')
const streamIdEl = document.getElementById('active-stream-id')
const probeEl = document.getElementById('probe-status')
const phaseEl = document.getElementById('access-phase')
const errorEl = document.getElementById('access-error')
const countdownEl = document.getElementById('access-countdown')

let deadlineAt = 0
let deadlineLabel = ''

function setBadge(element, text, state) {
  element.textContent = text
  element.className = `status-badge ${state}`
}

function setError(message) {
  errorEl.textContent = message || ''
  errorEl.hidden = !message
}

function updateCountdown() {
  if (!deadlineAt || !deadlineLabel) {
    countdownEl.textContent = ''
    return
  }
  const remainingSeconds = Math.ceil(Math.max(0, deadlineAt - Date.now()) / 1000)
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  const formatted = minutes > 0
    ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
    : `${remainingSeconds} 秒`
  countdownEl.textContent = `${deadlineLabel}：剩余 ${formatted}`
}

function renderProgress(snapshot) {
  roundEl.textContent = String(snapshot.round || 0)
  if (Object.prototype.hasOwnProperty.call(snapshot, 'streamId')) {
    streamIdEl.textContent = snapshot.streamId || '尚未发现'
    streamIdEl.title = snapshot.streamId || ''
  }
  deadlineAt = snapshot.deadlineAt || 0
  deadlineLabel = ''
  setError(snapshot.error)

  switch (snapshot.phase) {
    case AUTO_CONNECT_PHASES.DISCOVERING:
      setBadge(discoveryEl, '检测中', 'running')
      setBadge(probeEl, '等待 ID', 'waiting')
      phaseEl.textContent = '正在获取活动流 ID…'
      break
    case AUTO_CONNECT_PHASES.PROBING:
      setBadge(discoveryEl, '已获取', 'ok')
      setBadge(probeEl, '测试中', 'running')
      phaseEl.textContent = '正在测试 SRS HTTP 服务…'
      break
    case AUTO_CONNECT_PHASES.SAVING:
      setBadge(discoveryEl, '已获取', 'ok')
      setBadge(probeEl, '已连接', 'ok')
      phaseEl.textContent = '正在保存已验证的连接…'
      break
    case AUTO_CONNECT_PHASES.CONNECTING:
      setBadge(discoveryEl, '已获取', 'ok')
      setBadge(probeEl, '已连接', 'ok')
      phaseEl.textContent = '正在建立 WHEP 连接…'
      deadlineLabel = 'WHEP 建连'
      break
    case AUTO_CONNECT_PHASES.WAITING_FRAME:
      setBadge(discoveryEl, '持续检测', 'running')
      setBadge(probeEl, '已连接', 'ok')
      phaseEl.textContent = 'WHEP 已连接，正在等待数字人画面…'
      deadlineLabel = '等待首帧'
      break
    case AUTO_CONNECT_PHASES.COOLDOWN:
      setBadge(discoveryEl, '已获取', 'ok')
      setBadge(probeEl, '暂缓重试', 'waiting')
      phaseEl.textContent = '该活动流正在冷却，继续实时检测…'
      deadlineLabel = '冷却'
      break
    case AUTO_CONNECT_PHASES.ACTIVE:
      setBadge(discoveryEl, '持续检测', 'running')
      setBadge(probeEl, '已连接', 'ok')
      phaseEl.textContent = '数字人画面已就绪'
      break
    case AUTO_CONNECT_PHASES.CLEAR_ERROR:
      setBadge(discoveryEl, '继续检测', 'running')
      setBadge(probeEl, '等待 ID', 'waiting')
      phaseEl.textContent = '旧配置清除失败，自动检测仍在继续'
      break
    default:
      setBadge(discoveryEl, snapshot.streamId ? '已获取' : '重试中', snapshot.streamId ? 'ok' : 'error')
      setBadge(probeEl, '等待重试', 'error')
      phaseEl.textContent = '本轮未完成，下一秒自动重试'
      deadlineLabel = '下一次检测'
      break
  }
  updateCountdown()
}

const unsubscribeProgress = window.electronAPI.onAutoConnectProgress(renderProgress)
const countdownTimer = setInterval(updateCountdown, 250)

window.addEventListener('beforeunload', () => {
  clearInterval(countdownTimer)
  unsubscribeProgress()
})
