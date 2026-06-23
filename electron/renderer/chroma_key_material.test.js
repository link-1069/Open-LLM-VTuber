const test = require('node:test')
const assert = require('node:assert/strict')
const THREE = require('three')

const {
  DEFAULT_CHROMA_KEY,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
  createChromaKeyMaterial,
} = require('./chroma_key_material')

test('exports chroma key defaults from the reference project', () => {
  assert.deepEqual(DEFAULT_CHROMA_KEY, {
    keyColor: 0x19ae31,
    similarity: 0.159,
    smoothness: 0.082,
    spill: 0.214,
  })
})

test('includes the reference chroma key shader functions', () => {
  assert.match(VERTEX_SHADER, /varying vec2 vUv/)
  assert.match(FRAGMENT_SHADER, /RGBtoUV/)
  assert.match(FRAGMENT_SHADER, /ProcessChromaKey/)
  assert.match(FRAGMENT_SHADER, /uniform vec3 keyColor/)
})

test('creates a transparent Three.js shader material backed by video texture', () => {
  const video = { readyState: 2 }
  const material = createChromaKeyMaterial(THREE, video)

  assert.ok(material instanceof THREE.ShaderMaterial)
  assert.equal(material.transparent, true)
  assert.ok(material.uniforms.tex.value instanceof THREE.VideoTexture)
  assert.equal(material.uniforms.tex.value.image, video)
  assert.equal(material.uniforms.similarity.value, DEFAULT_CHROMA_KEY.similarity)
  assert.equal(material.uniforms.smoothness.value, DEFAULT_CHROMA_KEY.smoothness)
  assert.equal(material.uniforms.spill.value, DEFAULT_CHROMA_KEY.spill)
  assert.equal(material.userData.videoTexture, material.uniforms.tex.value)
})
