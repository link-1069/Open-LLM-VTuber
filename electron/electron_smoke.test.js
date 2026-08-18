const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { _electron } = require('playwright')
const electronPath = process.env.ELECTRON_SMOKE_EXECUTABLE || require('electron')

function getElectronArgs(userDataDir) {
  return [
    ...(process.env.ELECTRON_SMOKE_EXECUTABLE ? [] : [process.cwd()]),
    `--user-data-dir=${userDataDir}`,
  ]
}

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

async function forceCloseElectron(app) {
  const electronProcess = app.process()
  if (electronProcess.exitCode === null) {
    const exited = new Promise((resolve) => electronProcess.once('exit', resolve))
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/pid', String(electronProcess.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      electronProcess.kill()
    }
    await exited
  }
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
}

test('automatically discovers, renders, saves, and shows a digital human stream', { timeout: 120000 }, async () => {
  const mark = (step) => console.log(`# smoke: ${step}`)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollv-electron-smoke-'))
  const configPath = path.join(userDataDir, 'config.json')
  const stageMediaPath = path.join(process.cwd(), '..', 'backgrounds', 'cityscape.jpeg')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      whep_url: 'http://stale.example.test/rtc/v1/whep/?app=live&stream=old',
      last_updated: new Date().toISOString(),
      window_bounds: { x: 0, y: 0, width: 480, height: 800 },
      presentation_mode: 'desktop_pet',
      stage_background: { kind: 'media', media_path: stageMediaPath },
      stage_person_layout: { center_x: 0.5, center_y: 0.5, scale: 1 },
    }, null, 2),
    'utf8'
  )

  const fatalErrors = []
  let app = null
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: getElectronArgs(userDataDir),
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_SKIP_BACKEND_STARTUP_FOR_TESTS: '1',
      },
    })
    mark('electron launched')

    await app.firstWindow({ timeout: 30000 })
    const { mainPage, setupPage } = await waitForBothWindows(app)
    mark('both windows ready')
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
        window.__openLlmVtuberPresentationReady === true &&
        document.querySelectorAll('.stream-stage canvas').length === 2
      )
    }, null, { timeout: 30000 })
    await setupPage.waitForFunction(() => {
      return Number(document.getElementById('detection-round')?.textContent || 0) >= 1
    }, null, { timeout: 30000 })
    mark('renderers initialized')

    const result = await mainPage.evaluate(() => ({
      hasThree: Boolean(window.THREE),
      stageReady: window.__openLlmVtuberStageReady,
      streamControllerReady: window.__openLlmVtuberStreamControllerReady,
      presentationReady: window.__openLlmVtuberPresentationReady,
      canvasCount: document.querySelectorAll('.stream-stage canvas').length,
      videosHaveSrcObject: Array.from(document.querySelectorAll('.stream-video'))
        .some((video) => Boolean(video.srcObject)),
      controlsPanelHidden: document.getElementById('window-controls-panel')?.hidden,
      scripts: Array.from(document.scripts).map((script) => script.getAttribute('src')),
    }))

    assert.equal(result.hasThree, true)
    assert.equal(result.stageReady, true)
    assert.equal(result.streamControllerReady, true)
    assert.equal(result.presentationReady, true)
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
      '../presentation_contract.js',
      '../presentation_layout.js',
      'window_controls.js',
      'desktop_pet_editor.js',
      'stage_view.js',
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
    mark('automatic stream connected')

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
    mark('desktop bounds saved')

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.equal(savedConfig.window_bounds.width, nextWidth)
    assert.equal(
      savedConfig.whep_url,
      'http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=smoke-stream'
    )

    await mainPage.evaluate(() => window.electronAPI.beginDesktopPetEditing())
    await mainPage.waitForFunction(() => !document.getElementById('desktop-pet-editor').hidden)
    const desktopResizeHandle = mainPage.locator('[data-desktop-resize="se"]')
    const desktopResizeBox = await desktopResizeHandle.boundingBox()
    assert.ok(desktopResizeBox)
    await mainPage.mouse.move(
      desktopResizeBox.x + desktopResizeBox.width / 2,
      desktopResizeBox.y + desktopResizeBox.height / 2
    )
    await mainPage.mouse.down()
    await mainPage.mouse.move(
      desktopResizeBox.x + desktopResizeBox.width / 2 + 30,
      desktopResizeBox.y + desktopResizeBox.height / 2 + 20,
      { steps: 3 }
    )
    await mainPage.mouse.up()
    const previewBounds = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().endsWith('/renderer/main.html'))
        .getBounds()
    })
    assert.ok(previewBounds.width > nextWidth)
    assert.ok(previewBounds.height > originalBounds.height)
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).window_bounds.width, nextWidth)
    await mainPage.evaluate(() => window.electronAPI.cancelDesktopPetEditing())
    await mainPage.waitForFunction(() => document.getElementById('desktop-pet-editor').hidden)
    const restoredAfterCancel = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().endsWith('/renderer/main.html'))
        .getBounds()
    })
    assert.equal(restoredAfterCancel.width, nextWidth)

    const editedDesktopBounds = {
      x: restoredAfterCancel.x,
      y: restoredAfterCancel.y,
      width: nextWidth + 40,
      height: Math.max(240, restoredAfterCancel.height - 40),
    }
    await mainPage.evaluate(() => window.electronAPI.beginDesktopPetEditing())
    assert.equal((await mainPage.evaluate(
      (bounds) => window.electronAPI.updateDesktopPetBounds(bounds),
      editedDesktopBounds
    )).ok, true)
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).window_bounds.width, nextWidth)
    await mainPage.evaluate(() => window.electronAPI.saveDesktopPetEditing())
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).window_bounds.width, editedDesktopBounds.width)
    mark('desktop visual edit saved explicitly')

    await mainPage.evaluate(() => window.electronAPI.setPresentationMode('fullscreen_stage'))
    mark('fullscreen requested')
    try {
      await mainPage.waitForFunction(() => {
        return document.body.dataset.presentationMode === 'fullscreen_stage' &&
          document.querySelector('#stage-background img')?.naturalWidth > 0 &&
          Math.abs(window.innerWidth - window.screen.width) <= 1 &&
          Math.abs(window.innerHeight - window.screen.height) <= 1
      }, null, { timeout: 15000 })
    } catch (error) {
      const presentationDebug = await mainPage.evaluate(() => ({
        mode: document.body.dataset.presentationMode,
        background: document.getElementById('stage-background')?.innerHTML,
        naturalWidth: document.querySelector('#stage-background img')?.naturalWidth,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      }))
      throw new Error(`Fullscreen media did not render: ${JSON.stringify(presentationDebug)}; ${error.message}`)
    }
    mark('fullscreen media decoded')
    const rendererDisplay = await mainPage.evaluate(async () => {
      const image = document.querySelector('#stage-background img')
      const result = {
        x: window.screenLeft,
        y: window.screenTop,
        width: window.screen.width,
        height: window.screen.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        objectFit: image.style.objectFit,
        objectPosition: image.style.objectPosition,
      }
      await window.electronAPI.setPresentationMode('desktop_pet')
      return result
    })
    mark('fullscreen geometry read')
    assert.equal(rendererDisplay.x, 0)
    assert.equal(rendererDisplay.y, 0)
    assert.ok(Math.abs(rendererDisplay.innerWidth - rendererDisplay.width) <= 1)
    assert.ok(Math.abs(rendererDisplay.innerHeight - rendererDisplay.height) <= 1)
    assert.equal(rendererDisplay.objectFit, 'cover')
    assert.match(rendererDisplay.objectPosition, /^center(?: center)?$/)

    await mainPage.waitForFunction(
      () => document.body.dataset.presentationMode === 'desktop_pet',
      null,
      { timeout: 15000 }
    )
    const desktopResult = await mainPage.evaluate(async () => {
      const result = {
        width: window.innerWidth,
        backgroundChildren: document.getElementById('stage-background').children.length,
      }
      await window.electronAPI.beginStagePersonEditing()
      return result
    })
    assert.equal(desktopResult.width, editedDesktopBounds.width)
    assert.equal(desktopResult.backgroundChildren, 0)
    mark('desktop restored')

    await mainPage.waitForFunction(() => {
      return document.body.dataset.presentationMode === 'fullscreen_stage' &&
        !document.getElementById('stage-person-editor').hidden
    }, null, { timeout: 15000 })
    const eastHandle = mainPage.locator('[data-stage-resize="e"]')
    const eastHandleBox = await eastHandle.boundingBox()
    assert.ok(eastHandleBox)
    await mainPage.mouse.move(
      eastHandleBox.x + eastHandleBox.width / 2,
      eastHandleBox.y + eastHandleBox.height / 2
    )
    await mainPage.mouse.down()
    await mainPage.mouse.move(
      eastHandleBox.x + eastHandleBox.width / 2 - 120,
      eastHandleBox.y + eastHandleBox.height / 2,
      { steps: 5 }
    )
    await mainPage.mouse.up()
    await mainPage.locator('#stage-person-save').click()
    await mainPage.waitForFunction(
      () => document.body.dataset.presentationMode === 'desktop_pet',
      null,
      { timeout: 15000 }
    )
    const finalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.equal(finalConfig.presentation_mode, 'desktop_pet')
    assert.ok(finalConfig.stage_person_layout.width_scale < 1)
    assert.equal(finalConfig.stage_person_layout.height_scale, 1)
    mark('person layout saved')
    assert.deepEqual(fatalErrors, [])
  } finally {
    if (app) {
      await forceCloseElectron(app)
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    } catch (error) {
      console.warn(`Smoke cleanup deferred for ${userDataDir}: ${error.message}`)
    }
  }
})

test('real Electron decodes GIF and MP4 stage backgrounds and releases them on desktop', {
  timeout: 120000,
}, async (t) => {
  if (spawnSync('ffmpeg.exe', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required to create bounded real-codec fixtures')
    return
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ollv-electron-codecs-'))
  const gifPath = path.join(fixtureRoot, 'stage.gif')
  const mp4Path = path.join(fixtureRoot, 'stage.mp4')
  const fixtureCommands = [
    ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-vf', 'fps=5', gifPath],
    [
      '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path,
    ],
  ]
  for (const args of fixtureCommands) {
    const result = spawnSync('ffmpeg.exe', args, { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }

  async function probeMedia(mediaPath, expectedTag) {
    const userDataDir = path.join(fixtureRoot, expectedTag.toLowerCase())
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
      presentation_mode: 'fullscreen_stage',
      window_bounds: { x: 0, y: 0, width: 480, height: 800 },
      stage_background: { kind: 'media', media_path: mediaPath },
      stage_person_layout: { center_x: 0.5, center_y: 0.5, scale: 1 },
    }, null, 2), 'utf8')

    let app = null
    try {
      app = await _electron.launch({
        executablePath: electronPath,
        args: getElectronArgs(userDataDir),
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_SKIP_BACKEND_STARTUP_FOR_TESTS: '1',
        },
      })
      await app.firstWindow({ timeout: 30000 })
      const { mainPage } = await waitForBothWindows(app)
      await mainPage.waitForLoadState('domcontentloaded')
      await mainPage.waitForFunction(
        () => window.__openLlmVtuberPresentationReady === true,
        null,
        { timeout: 30000 }
      )
      await mainPage.evaluate(() => window.electronAPI.showMainWindow())
      await mainPage.waitForFunction((tagName) => {
        const media = document.querySelector('#stage-background > *')
        const decoded = tagName === 'VIDEO' ? media?.readyState >= 2 : media?.naturalWidth > 0
        return document.body.dataset.presentationMode === 'fullscreen_stage' &&
          media?.tagName === tagName && decoded
      }, expectedTag, { timeout: 30000 })
      const playback = await mainPage.evaluate(async () => {
        const media = document.querySelector('#stage-background > *')
        const result = {
          tagName: media.tagName,
          muted: media.muted,
          loop: media.loop,
          controls: media.controls,
          objectFit: media.style.objectFit,
        }
        await window.electronAPI.setPresentationMode('desktop_pet')
        return result
      })
      assert.equal(playback.tagName, expectedTag)
      assert.equal(playback.objectFit, 'cover')
      if (expectedTag === 'VIDEO') {
        assert.equal(playback.muted, true)
        assert.equal(playback.loop, true)
        assert.equal(playback.controls, false)
      }
      await mainPage.waitForFunction(() => {
        return document.body.dataset.presentationMode === 'desktop_pet' &&
          document.getElementById('stage-background').children.length === 0
      }, null, { timeout: 30000 })
    } finally {
      if (app) await forceCloseElectron(app)
    }
  }

  try {
    await probeMedia(gifPath, 'IMG')
    await probeMedia(mp4Path, 'VIDEO')
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})
