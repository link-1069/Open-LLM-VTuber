const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const setupHtmlPath = path.join(__dirname, 'setup.html')
const setupScriptPath = path.join(__dirname, 'setup.js')
const preloadPath = path.join(__dirname, '..', 'preload.js')
const mainHtmlPath = path.join(__dirname, 'main.html')
const rendererScriptPath = path.join(__dirname, 'renderer.js')
const mainProcessPath = path.join(__dirname, '..', 'main.js')
const stylePath = path.join(__dirname, 'style.css')

test('automatic access window exposes progress without manual controls', () => {
  const html = fs.readFileSync(setupHtmlPath, 'utf8')
  const script = fs.readFileSync(setupScriptPath, 'utf8')
  const preload = fs.readFileSync(preloadPath, 'utf8')

  assert.doesNotMatch(html, /<input\b/)
  assert.doesNotMatch(html, /<button\b/)
  assert.match(html, /id="detection-round"/)
  assert.match(html, /id="discovery-status"/)
  assert.match(html, /id="active-stream-id"/)
  assert.match(html, /id="probe-status"/)
  assert.match(html, /id="access-phase"/)
  assert.match(html, /id="access-error"/)
  assert.match(html, /id="access-countdown"/)
  assert.match(html, /<script src="auto_connect\.js"><\/script>[\s\S]*<script src="setup\.js"><\/script>/)
  assert.match(script, /window\.electronAPI\.onAutoConnectProgress/)
  assert.match(script, /window\.AUTO_CONNECT_PHASES/)
  assert.match(script, /hasOwnProperty\.call\(snapshot, 'streamId'\)/)
  assert.match(preload, /onAutoConnectProgress:\s*\(callback\) => subscribe\('auto-connect-progress', callback\)/)
})

test('main window provides two stream slots before loading automatic access', () => {
  const html = fs.readFileSync(mainHtmlPath, 'utf8')

  assert.match(html, /id="stream-layer-0"[^>]*hidden/)
  assert.match(html, /id="stream-layer-1"[^>]*hidden/)
  assert.match(html, /id="stage-0"/)
  assert.match(html, /id="stage-1"/)
  assert.match(html, /id="video-0"/)
  assert.match(html, /id="video-1"/)
})

test('automatic access window displays the complete active stream ID', () => {
  const style = fs.readFileSync(stylePath, 'utf8')
  const streamIdRule = style.match(/#active-stream-id\s*\{([\s\S]*?)\}/)?.[1] || ''

  assert.match(streamIdRule, /overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(streamIdRule, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(streamIdRule, /white-space:\s*nowrap/)
})

test('renderer wires automatic discovery, probing, persistence, and dual-stream activation', () => {
  const script = fs.readFileSync(rendererScriptPath, 'utf8')

  assert.match(script, /window\.createDigitalHumanStreamManager\(/)
  assert.match(script, /window\.createAutoConnectController\(/)
  assert.match(script, /http:\/\/localhost:8500\/api\/active-streams/)
  assert.match(script, /http:\/\/127\.0\.0\.1:1985\/api\/v1/)
  assert.match(script, /http:\/\/127\.0\.0\.1:1985\/rtc\/v1\/whep\/\?app=live&stream=/)
  assert.match(script, /window\.electronAPI\.reportAutoConnectProgress/)
  assert.match(script, /window\.electronAPI\.onRestartAutoConnect/)
  assert.match(script, /window\.electronAPI\.showMainWindow/)
  assert.match(script, /window\.electronAPI\.showAutoConnectWindow/)
})

test('main process preloads both windows and relays automatic access IPC', () => {
  const script = fs.readFileSync(mainProcessPath, 'utf8')

  assert.match(script, /backgroundThrottling:\s*false/)
  assert.match(script, /ipcMain\.on\('auto-connect-progress'/)
  assert.match(script, /ipcMain\.handle\('show-main-window'/)
  assert.match(script, /ipcMain\.handle\('show-auto-connect-window'/)
  assert.match(script, /label:\s*'重新检测连接'/)
  assert.match(script, /sendToMainWindow\('restart-auto-connect'\)/)
  assert.match(script, /createSetupWindow\(\)[\s\S]*createMainWindow\(\{ show: false \}\)/)
})
