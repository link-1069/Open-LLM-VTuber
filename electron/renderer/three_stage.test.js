const test = require('node:test')
const assert = require('node:assert/strict')

const { createThreeVideoStage } = require('./three_stage')

function createMount() {
  return {
    children: [],
    appendChild(node) {
      node.parentNode = this
      this.children.push(node)
    },
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node)
      node.parentNode = null
    },
  }
}

function createWindowRef() {
  const windowRef = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1.5,
    listeners: {},
    canceledFrame: null,
    addEventListener(type, fn) {
      this.listeners[type] = fn
    },
    removeEventListener(type, fn) {
      if (this.listeners[type] === fn) {
        delete this.listeners[type]
      }
    },
    requestAnimationFrame() {
      return 42
    },
    cancelAnimationFrame(id) {
      this.canceledFrame = id
    },
  }
  return windowRef
}

function createFakeThree() {
  const calls = {
    renderer: null,
    scene: null,
    geometry: null,
    mesh: null,
  }

  class WebGLRenderer {
    constructor(options) {
      this.options = options
      this.domElement = {
        id: '',
        style: {},
        parentNode: null,
        remove() {
          if (this.parentNode) {
            this.parentNode.removeChild(this)
          }
        },
      }
      this.clearColor = null
      this.pixelRatio = null
      this.size = null
      this.disposed = false
      calls.renderer = this
    }

    setClearColor(color, alpha) {
      this.clearColor = [color, alpha]
    }

    setPixelRatio(value) {
      this.pixelRatio = value
    }

    setSize(width, height, updateStyle) {
      this.size = [width, height, updateStyle]
    }

    render() {}

    dispose() {
      this.disposed = true
    }
  }

  class Scene {
    constructor() {
      this.children = []
      calls.scene = this
    }

    add(object) {
      this.children.push(object)
    }
  }

  class OrthographicCamera {
    constructor(left, right, top, bottom, near, far) {
      this.args = [left, right, top, bottom, near, far]
    }
  }

  class PlaneGeometry {
    constructor(width, height) {
      this.width = width
      this.height = height
      this.disposed = false
      calls.geometry = this
    }

    dispose() {
      this.disposed = true
    }
  }

  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry
      this.material = material
      calls.mesh = this
    }
  }

  return {
    calls,
    THREE: {
      WebGLRenderer,
      Scene,
      OrthographicCamera,
      PlaneGeometry,
      Mesh,
    },
  }
}

test('creates a transparent Three.js stage and mounts the renderer canvas', () => {
  const mount = createMount()
  const windowRef = createWindowRef()
  const fakeThree = createFakeThree()
  const material = {
    userData: { videoTexture: { disposed: false, dispose() { this.disposed = true } } },
    disposed: false,
    dispose() { this.disposed = true },
  }

  const stage = createThreeVideoStage({
    THREE: fakeThree.THREE,
    video: { readyState: 2 },
    mount,
    windowRef,
    createMaterial: () => material,
    showError: () => {},
  })

  assert.equal(mount.children.length, 1)
  assert.equal(mount.children[0].id, 'three-canvas')
  assert.deepEqual(fakeThree.calls.renderer.options, { alpha: true, antialias: true })
  assert.deepEqual(fakeThree.calls.renderer.clearColor, [0x000000, 0])
  assert.equal(fakeThree.calls.renderer.pixelRatio, 1.5)
  assert.deepEqual(fakeThree.calls.renderer.size, [800, 600, false])
  assert.equal(fakeThree.calls.geometry.width, 2)
  assert.equal(fakeThree.calls.geometry.height, 2)
  assert.equal(fakeThree.calls.mesh.material, material)
  assert.equal(fakeThree.calls.scene.children.length, 1)

  stage.dispose()

  assert.equal(mount.children.length, 0)
  assert.equal(windowRef.listeners.resize, undefined)
  assert.equal(windowRef.canceledFrame, 42)
  assert.equal(material.disposed, true)
  assert.equal(material.userData.videoTexture.disposed, true)
  assert.equal(fakeThree.calls.geometry.disposed, true)
  assert.equal(fakeThree.calls.renderer.disposed, true)
})
