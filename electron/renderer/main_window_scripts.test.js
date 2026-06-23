const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const htmlPath = path.join(__dirname, 'main.html')

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
