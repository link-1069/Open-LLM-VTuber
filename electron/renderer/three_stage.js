(function (root, factory) {
  const api = factory(root)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createThreeVideoStage = api.createThreeVideoStage
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict'

  function getDefaultCreateMaterial() {
    if (typeof require === 'function') {
      try {
        return require('./chroma_key_material').createChromaKeyMaterial
      } catch {
        return root.createChromaKeyMaterial
      }
    }
    return root.createChromaKeyMaterial
  }

  function createThreeVideoStage(options) {
    const THREE = options.THREE
    const video = options.video
    const mount = options.mount
    const windowRef = options.windowRef || root.window || root
    const showError = options.showError || function () {}
    const createMaterial = options.createMaterial || getDefaultCreateMaterial()

    if (!THREE) {
      const error = new Error('Three.js is not available')
      showError(error.message)
      throw error
    }
    if (!video) {
      throw new Error('video is required')
    }
    if (!mount || typeof mount.appendChild !== 'function') {
      throw new Error('mount is required')
    }
    if (typeof createMaterial !== 'function') {
      throw new Error('createChromaKeyMaterial is not available')
    }

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 2))
    renderer.domElement.id = 'three-canvas'
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.top = '0'
    renderer.domElement.style.left = '0'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.pointerEvents = 'none'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = createMaterial(THREE, video, options.chromaKeyOptions)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    let frameId = null
    let disposed = false

    function resize() {
      const width = Math.max(1, windowRef.innerWidth || mount.clientWidth || 1)
      const height = Math.max(1, windowRef.innerHeight || mount.clientHeight || 1)
      renderer.setSize(width, height, false)
    }

    function animate() {
      if (disposed) {
        return
      }
      if (video.readyState >= 2) {
        if (material.userData && material.userData.videoTexture) {
          material.userData.videoTexture.needsUpdate = true
        }
        renderer.render(scene, camera)
      }
      frameId = windowRef.requestAnimationFrame(animate)
    }

    function dispose() {
      if (disposed) {
        return
      }
      disposed = true
      if (frameId !== null) {
        windowRef.cancelAnimationFrame(frameId)
      }
      windowRef.removeEventListener('resize', resize)
      if (material.userData && material.userData.videoTexture) {
        material.userData.videoTexture.dispose()
      }
      material.dispose()
      geometry.dispose()
      renderer.dispose()
      if (renderer.domElement && typeof renderer.domElement.remove === 'function') {
        renderer.domElement.remove()
      } else if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }

    resize()
    windowRef.addEventListener('resize', resize)
    frameId = windowRef.requestAnimationFrame(animate)

    return {
      dispose,
    }
  }

  return {
    createThreeVideoStage,
  }
})
