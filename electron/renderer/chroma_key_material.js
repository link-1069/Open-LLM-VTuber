(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.DEFAULT_CHROMA_KEY = api.DEFAULT_CHROMA_KEY
  root.VERTEX_SHADER = api.VERTEX_SHADER
  root.FRAGMENT_SHADER = api.FRAGMENT_SHADER
  root.createChromaKeyMaterial = api.createChromaKeyMaterial
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict'

  const DEFAULT_CHROMA_KEY = Object.freeze({
    keyColor: 0x19ae31,
    similarity: 0.159,
    smoothness: 0.082,
    spill: 0.214,
  })

  const VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

  const FRAGMENT_SHADER = `
uniform sampler2D tex;
uniform vec3 keyColor;
uniform float similarity;
uniform float smoothness;
uniform float spill;

varying vec2 vUv;

vec2 RGBtoUV(vec3 rgb) {
  return vec2(
    rgb.r * -0.169 + rgb.g * -0.331 + rgb.b *  0.5    + 0.5,
    rgb.r *  0.5   + rgb.g * -0.419 + rgb.b * -0.081  + 0.5
  );
}

vec4 ProcessChromaKey(vec2 texCoord) {
  vec4 rgba = texture2D(tex, texCoord);
  float chromaDist = distance(RGBtoUV(rgba.rgb), RGBtoUV(keyColor));

  float baseMask = chromaDist - similarity;
  float fullMask = pow(clamp(baseMask / smoothness, 0.0, 1.0), 1.5);
  rgba.a = fullMask;

  float spillVal = pow(clamp(baseMask / spill, 0.0, 1.0), 1.5);
  float desat = clamp(rgba.r * 0.2126 + rgba.g * 0.7152 + rgba.b * 0.0722, 0.0, 1.0);
  rgba.rgb = mix(vec3(desat, desat, desat), rgba.rgb, spillVal);

  return rgba;
}

void main(void) {
  gl_FragColor = ProcessChromaKey(vUv);
}
`

  function createChromaKeyMaterial(THREE, video, options = {}) {
    if (!THREE) {
      throw new Error('THREE is required')
    }
    if (!video) {
      throw new Error('video is required')
    }

    const config = {
      ...DEFAULT_CHROMA_KEY,
      ...options,
    }
    const texture = new THREE.VideoTexture(video)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: texture },
        keyColor: { value: new THREE.Color(config.keyColor) },
        similarity: { value: config.similarity },
        smoothness: { value: config.smoothness },
        spill: { value: config.spill },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
    })

    material.userData.videoTexture = texture
    return material
  }

  return {
    DEFAULT_CHROMA_KEY,
    VERTEX_SHADER,
    FRAGMENT_SHADER,
    createChromaKeyMaterial,
  }
})
