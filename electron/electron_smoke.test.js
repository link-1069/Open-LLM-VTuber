const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')
const electronPath = require('electron')

test('loads the Three.js chromakey stage in a real Electron main window', { timeout: 120000 }, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollv-electron-smoke-'))
  const configPath = path.join(userDataDir, 'config.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      whep_url: 'http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=1782211996791800259',
      last_updated: new Date().toISOString(),
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

    const page = await app.firstWindow({ timeout: 90000 })
    page.on('console', (msg) => {
      const text = msg.text()
      if (msg.type() === 'error' && /Three\.js stage|SRS stream controller|ReferenceError|TypeError|SyntaxError/.test(text)) {
        fatalErrors.push(text)
      }
    })
    page.on('pageerror', (error) => fatalErrors.push(error.stack || error.message))

    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => {
      return Boolean(
        window.THREE &&
        window.__openLlmVtuberStageReady === true &&
        window.__openLlmVtuberStreamControllerReady === true &&
        document.querySelector('#stage canvas')
      )
    }, null, { timeout: 30000 })

    const result = await page.evaluate(() => {
      const video = document.getElementById('video')
      return {
        hasThree: Boolean(window.THREE),
        stageReady: window.__openLlmVtuberStageReady,
        streamControllerReady: window.__openLlmVtuberStreamControllerReady,
        canvasCount: document.querySelectorAll('#stage canvas').length,
        canvasId: document.querySelector('#stage canvas')?.id || '',
        videoHasSrcObject: Boolean(video && video.srcObject),
        scripts: Array.from(document.scripts).map((script) => script.getAttribute('src')),
      }
    })

    assert.equal(result.hasThree, true)
    assert.equal(result.stageReady, true)
    assert.equal(result.streamControllerReady, true)
    assert.equal(result.canvasCount, 1)
    assert.equal(result.canvasId, 'three-canvas')
    assert.equal(result.videoHasSrcObject, true)
    assert.deepEqual(result.scripts, [
      'vendor/three.min.js',
      'srs.sdk.js',
      'chroma_key_material.js',
      'three_stage.js',
      'srs_stream.js',
      'renderer.js',
    ])
    assert.deepEqual(fatalErrors, [])
  } finally {
    if (app) {
      await app.close()
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
