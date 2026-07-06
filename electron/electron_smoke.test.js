const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')
const electronPath = require('electron')

function startEntryPageServer() {
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><title>LangQingV6</title></head>',
    '<body>',
    '  <button id="startButton">开始体验</button>',
    '  <script>window.__entryPageLoaded = true</script>',
    '</body>',
    '</html>',
  ].join('')

  const server = http.createServer((req, res) => {
    if (req.url === '/static/h5.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(8500, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

test('loads the external h5 entry page in a real Electron window', { timeout: 120000 }, async () => {
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
  let server = null
  try {
    server = await startEntryPageServer()
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
    await page.waitForFunction(() => window.__entryPageLoaded === true, null, { timeout: 30000 })

    const result = await page.evaluate(() => {
      return {
        href: window.location.href,
        title: document.title,
        entryPageLoaded: window.__entryPageLoaded,
        hasStartButton: Boolean(document.getElementById('startButton')),
        hasBundledChromakeyStage: Boolean(document.querySelector('#stage canvas')),
      }
    })

    assert.equal(result.href, 'http://localhost:8500/static/h5.html')
    assert.equal(result.title, 'LangQingV6')
    assert.equal(result.entryPageLoaded, true)
    assert.equal(result.hasStartButton, true)
    assert.equal(result.hasBundledChromakeyStage, false)
    assert.deepEqual(fatalErrors, [])
  } finally {
    if (app) {
      await app.close()
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})
