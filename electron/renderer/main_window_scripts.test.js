const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const htmlPath = path.join(__dirname, 'main.html')
const mainProcessPath = path.join(__dirname, '..', 'main.js')
const preloadPath = path.join(__dirname, '..', 'preload.js')
const rendererScriptPath = path.join(__dirname, 'renderer.js')
const setupScriptPath = path.join(__dirname, 'setup.js')

function getScriptSources(html) {
  const matches = html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)
  return Array.from(matches, (match) => match[1])
}

test('loads Three.js and renderer modules before the main renderer', () => {
  const html = fs.readFileSync(htmlPath, 'utf8')
  assert.match(html, /<div id="stage"><\/div>/)
  assert.doesNotMatch(html, /<canvas id="canvas"><\/canvas>/)

  assert.deepEqual(getScriptSources(html), [
    'vendor/three.min.js',
    'srs.sdk.js',
    'chroma_key_material.js',
    'three_stage.js',
    'srs_stream.js',
    'renderer.js',
  ])
})

test('ships the local Three.js browser build used by the main window', () => {
  const vendorPath = path.join(__dirname, 'vendor', 'three.min.js')
  assert.equal(fs.existsSync(vendorPath), true)
  assert.ok(fs.statSync(vendorPath).size > 100000)
})

test('main window context menu can return to stream setup', () => {
  const script = fs.readFileSync(mainProcessPath, 'utf8')
  const menuItemIndex = script.indexOf("label: '设置投流地址'")
  const openSetupIndex = script.indexOf('createSetupWindow()', menuItemIndex)
  const closeMainIndex = script.indexOf('mainWindow.close()', menuItemIndex)

  assert.match(script, /const \{ app, BrowserWindow, ipcMain, Menu \} = require\('electron'\)/)
  assert.match(script, /mainWindow\.webContents\.on\('context-menu'/)
  assert.notEqual(menuItemIndex, -1)
  assert.notEqual(openSetupIndex, -1)
  assert.notEqual(closeMainIndex, -1)
  assert.ok(openSetupIndex < closeMainIndex)
})

test('setup window creation reuses an existing setup window', () => {
  const script = fs.readFileSync(mainProcessPath, 'utf8')

  assert.match(script, /if \(setupWindow\) \{[\s\S]*setupWindow\.show\(\)[\s\S]*setupWindow\.focus\(\)[\s\S]*return[\s\S]*\}/)
})

test('setup page prefills the saved WHEP URL', () => {
  const script = fs.readFileSync(setupScriptPath, 'utf8')
  const getConfigIndex = script.indexOf('window.electronAPI.getConfig()')
  const prefillIndex = script.indexOf('urlInput.value = config.whep_url', getConfigIndex)
  const disableConfirmIndex = script.indexOf('btnConfirm.disabled = true', prefillIndex)

  assert.notEqual(getConfigIndex, -1)
  assert.notEqual(prefillIndex, -1)
  assert.notEqual(disableConfirmIndex, -1)
})

test('main renderer can return to setup when SRS connection fails', () => {
  const mainScript = fs.readFileSync(mainProcessPath, 'utf8')
  const preloadScript = fs.readFileSync(preloadPath, 'utf8')
  const rendererScript = fs.readFileSync(rendererScriptPath, 'utf8')

  assert.match(preloadScript, /openSetupWindow:\s*\(\) => ipcRenderer\.invoke\('open-setup-window'\)/)
  assert.match(mainScript, /ipcMain\.handle\('open-setup-window'[\s\S]*createSetupWindow\(\)[\s\S]*mainWindow\.close\(\)/)
  assert.match(rendererScript, /onConnectionFailed:\s*\(\) => \{[\s\S]*window\.electronAPI\.openSetupWindow\(\)/)
})
