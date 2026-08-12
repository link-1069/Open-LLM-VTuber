const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')
const electronPath = require('electron')

async function waitForBothWindows(app) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const windows = app.windows()
    const mainPage = windows.find((page) => page.url().endsWith('/renderer/main.html'))
    const setupPage = windows.find((page) => page.url().endsWith('/renderer/setup.html'))
    if (mainPage && setupPage) {
      return { mainPage, setupPage }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for the setup and main windows')
}

test('automatically discovers, renders, saves, and shows a digital human stream', { timeout: 120000 }, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollv-electron-smoke-'))
  const configPath = path.join(userDataDir, 'config.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      whep_url: 'http://stale.example.test/rtc/v1/whep/?app=live&stream=old',
      last_updated: new Date().toISOString(),
      window_bounds: { x: 0, y: 0, width: 480, height: 800 },
    }, null, 2),
    'utf8'
  )

  const fatalErrors = []
  let app = null
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [process.cwd(), `--user-data-dir=${userDataDir}`],
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    })

    await app.firstWindow({ timeout: 30000 })
    const { mainPage, setupPage } = await waitForBothWindows(app)
    for (const page of [mainPage, setupPage]) {
      page.on('console', (message) => {
        const text = message.text()
        if (message.type() === 'error' && /Three\.js stage|stream manager|ReferenceError|TypeError|SyntaxError/.test(text)) {
          fatalErrors.push(text)
        }
      })
      page.on('pageerror', (error) => fatalErrors.push(error.stack || error.message))
      await page.waitForLoadState('domcontentloaded')
    }

    await mainPage.waitForFunction(() => {
      return Boolean(
        window.THREE &&
        window.__openLlmVtuberStageReady === true &&
        window.__openLlmVtuberStreamControllerReady === true &&
        document.querySelectorAll('.stream-stage canvas').length === 2
      )
    }, null, { timeout: 30000 })
    await setupPage.waitForFunction(() => {
      return Number(document.getElementById('detection-round')?.textContent || 0) >= 1
    }, null, { timeout: 30000 })

    const result = await mainPage.evaluate(() => ({
      hasThree: Boolean(window.THREE),
      stageReady: window.__openLlmVtuberStageReady,
      streamControllerReady: window.__openLlmVtuberStreamControllerReady,
      canvasCount: document.querySelectorAll('.stream-stage canvas').length,
      videosHaveSrcObject: Array.from(document.querySelectorAll('.stream-video'))
        .some((video) => Boolean(video.srcObject)),
      controlsPanelHidden: document.getElementById('window-controls-panel')?.hidden,
      scripts: Array.from(document.scripts).map((script) => script.getAttribute('src')),
    }))

    assert.equal(result.hasThree, true)
    assert.equal(result.stageReady, true)
    assert.equal(result.streamControllerReady, true)
    assert.equal(result.canvasCount, 2)
    assert.equal(result.videosHaveSrcObject, false)
    assert.equal(result.controlsPanelHidden, true)
    assert.deepEqual(result.scripts, [
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

    const windowVisibility = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        visible: window.isVisible(),
      }))
    })
    assert.equal(windowVisibility.find((window) => window.url.endsWith('/renderer/setup.html')).visible, true)
    assert.equal(windowVisibility.find((window) => window.url.endsWith('/renderer/main.html')).visible, false)

    await mainPage.route('http://localhost:8500/api/active-streams', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, stream: { av_stream_id: 'smoke-stream' } }),
    }))
    await mainPage.route('http://127.0.0.1:1985/api/v1', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ code: 0 }),
    }))
    await mainPage.evaluate(() => {
      window.SrsRtcWhipWhepAsync = class FakeSrsRtcWhipWhepAsync {
        constructor() {
          this.canvas = document.createElement('canvas')
          this.canvas.width = 16
          this.canvas.height = 16
          this.context = this.canvas.getContext('2d')
          this.paintFrame()
          this.paintTimer = setInterval(() => this.paintFrame(), 33)
          this.stream = this.canvas.captureStream(30)
          this.pc = {
            connectionState: 'connected',
            iceConnectionState: 'connected',
          }
        }

        paintFrame() {
          this.context.fillStyle = '#00ff00'
          this.context.fillRect(0, 0, 16, 16)
        }

        async play() {
          return { sessionid: 'smoke-session' }
        }

        close() {
          clearInterval(this.paintTimer)
          this.stream.getTracks().forEach((track) => track.stop())
        }
      }
    })
    await app.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('/renderer/main.html'))
      mainWindow.webContents.send('restart-auto-connect')
    })
    await mainPage.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.stream-layer'))
        .some((layer) => !layer.hidden)
    }, null, { timeout: 30000 })

    const connectedVisibility = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        visible: window.isVisible(),
      }))
    })
    assert.equal(connectedVisibility.find((window) => window.url.endsWith('/renderer/setup.html')).visible, false)
    assert.equal(connectedVisibility.find((window) => window.url.endsWith('/renderer/main.html')).visible, true)

    const hotspot = mainPage.locator('#window-controls-hotspot')
    await hotspot.click({ force: true })
    await hotspot.click({ force: true })
    await hotspot.click({ force: true })
    await mainPage.waitForFunction(() => !document.getElementById('window-controls-panel').hidden)

    const originalBounds = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().endsWith('/renderer/main.html'))
      return window.getBounds()
    })
    const widthInput = mainPage.locator('#window-width')
    const nextWidth = Math.max(320, originalBounds.width - 20)
    await widthInput.fill(String(nextWidth))
    await widthInput.press('Enter')
    await mainPage.waitForFunction((width) => {
      return document.getElementById('window-width').value === String(width) &&
        document.getElementById('window-save-status').dataset.state === 'saved'
    }, nextWidth)

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.equal(savedConfig.window_bounds.width, nextWidth)
    assert.equal(
      savedConfig.whep_url,
      'http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=smoke-stream'
    )
    assert.deepEqual(fatalErrors, [])
  } finally {
    if (app) {
      await app.close()
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
