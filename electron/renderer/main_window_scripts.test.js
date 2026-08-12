const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const htmlPath = path.join(__dirname, 'main.html')
const mainProcessPath = path.join(__dirname, '..', 'main.js')
const preloadPath = path.join(__dirname, '..', 'preload.js')
const rendererScriptPath = path.join(__dirname, 'renderer.js')
const windowControlsScriptPath = path.join(__dirname, 'window_controls.js')
const setupScriptPath = path.join(__dirname, 'setup.js')

function getScriptSources(html) {
  const matches = html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)
  return Array.from(matches, (match) => match[1])
}

test('loads Three.js and renderer modules before the main renderer', () => {
  const html = fs.readFileSync(htmlPath, 'utf8')
  assert.match(html, /<div id="stage-0" class="stream-stage"><\/div>/)
  assert.match(html, /<div id="stage-1" class="stream-stage"><\/div>/)
  assert.doesNotMatch(html, /<canvas id="canvas"><\/canvas>/)

  assert.deepEqual(getScriptSources(html), [
    'vendor/three.min.js',
    'srs.sdk.js',
    'chroma_key_material.js',
    'three_stage.js',
    'srs_stream.js',
    'digital_human_stream_manager.js',
    'auto_connect.js',
    '../window_bounds.js',
    'window_controls.js',
    'renderer.js',
  ])
})

test('main window includes an invisible hotspot and in-window control panel', () => {
  const html = fs.readFileSync(htmlPath, 'utf8')
  const controlsScript = fs.readFileSync(windowControlsScriptPath, 'utf8')
  const preloadScript = fs.readFileSync(preloadPath, 'utf8')
  const mainScript = fs.readFileSync(mainProcessPath, 'utf8')

  assert.match(html, /id="window-controls-hotspot"/)
  assert.match(html, /width:\s*50px;[\s\S]*height:\s*50px;/)
  assert.match(html, /top:\s*0;[\s\S]*right:\s*0;/)
  assert.match(html, /id="window-controls-panel"[^>]*hidden/)
  assert.match(html, /id="window-x"/)
  assert.match(html, /id="window-y"/)
  assert.match(html, /id="window-width"/)
  assert.match(html, /id="window-height"/)
  assert.match(html, /id="window-reset"/)
  assert.match(controlsScript, /window\.windowBounds/)
  assert.match(controlsScript, /createTripleClickGate\(5000\)/)
  assert.match(preloadScript, /getMainWindowState:\s*\(\) => ipcRenderer\.invoke\('get-main-window-state'\)/)
  assert.match(preloadScript, /setMainWindowBounds:\s*\(bounds\) => ipcRenderer\.invoke\('set-main-window-bounds', bounds\)/)
  assert.match(mainScript, /ipcMain\.handle\('get-main-window-state'/)
  assert.match(mainScript, /ipcMain\.handle\('set-main-window-bounds'/)
  assert.match(mainScript, /ipcMain\.handle\('reset-main-window-bounds'/)
})

test('ships the local Three.js browser build used by the main window', () => {
  const vendorPath = path.join(__dirname, 'vendor', 'three.min.js')
  assert.equal(fs.existsSync(vendorPath), true)
  assert.ok(fs.statSync(vendorPath).size > 100000)
})

test('main window context menu can restart automatic connection detection', () => {
  const script = fs.readFileSync(mainProcessPath, 'utf8')
  const menuItemIndex = script.indexOf("label: '重新检测连接'")
  const restartIndex = script.indexOf('click: restartAutomaticAccess', menuItemIndex)

  assert.match(script, /const \{ app, BrowserWindow, ipcMain, Menu, screen \} = require\('electron'\)/)
  assert.match(script, /mainWindow\.webContents\.on\('context-menu'/)
  assert.notEqual(menuItemIndex, -1)
  assert.notEqual(restartIndex, -1)
  assert.match(script, /function restartAutomaticAccess\(\) \{[\s\S]*showAutoConnectWindow\(\)[\s\S]*sendToMainWindow\('restart-auto-connect'\)/)
})

test('setup window creation reuses an existing setup window', () => {
  const script = fs.readFileSync(mainProcessPath, 'utf8')

  assert.match(script, /if \(setupWindow\) \{[\s\S]*setupWindow\.show\(\)[\s\S]*setupWindow\.focus\(\)[\s\S]*return[\s\S]*\}/)
})

test('setup page renders automatic connection progress', () => {
  const script = fs.readFileSync(setupScriptPath, 'utf8')
  assert.match(script, /window\.electronAPI\.onAutoConnectProgress\(renderProgress\)/)
  assert.match(script, /case 'connecting'/)
  assert.match(script, /case 'waiting-frame'/)
})

test('main renderer delegates stream failure recovery to automatic access', () => {
  const mainScript = fs.readFileSync(mainProcessPath, 'utf8')
  const preloadScript = fs.readFileSync(preloadPath, 'utf8')
  const rendererScript = fs.readFileSync(rendererScriptPath, 'utf8')

  assert.match(preloadScript, /showAutoConnectWindow:\s*\(\) => ipcRenderer\.invoke\('show-auto-connect-window'\)/)
  assert.match(mainScript, /ipcMain\.handle\('show-auto-connect-window'[\s\S]*showAutoConnectWindow\(\)/)
  assert.match(rendererScript, /showSetup:\s*\(\) => window\.electronAPI\.showAutoConnectWindow\(\)/)
})
