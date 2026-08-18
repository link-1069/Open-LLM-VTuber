const test = require('node:test')
const assert = require('node:assert/strict')

const { createDesktopPetEditController } = require('./desktop_pet_edit_controller')

function createHarness(options = {}) {
  const writes = []
  const commits = []
  const restores = []
  const states = []
  const window = {
    bounds: { x: 100, y: 50, width: 480, height: 800 },
    getBounds() { return { ...this.bounds } },
    setBounds(bounds) { this.bounds = { ...bounds } },
  }
  const controller = createDesktopPetEditController({
    window,
    validateBounds: () => ({}),
    isVisible: () => true,
    persist: (bounds) => {
      if (options.writeError) throw options.writeError
      writes.push({ ...bounds })
    },
    onCommit: (bounds) => commits.push({ ...bounds }),
    onRestore: (bounds) => restores.push({ ...bounds }),
    onStateChange: (state) => states.push(state),
  })
  return { commits, controller, restores, states, window, writes }
}

test('desktop pet preview changes the window but persists only after explicit save', () => {
  const harness = createHarness()
  harness.controller.begin()
  const edited = { x: 140, y: 80, width: 620, height: 700 }

  assert.equal(harness.controller.preview(edited).ok, true)
  assert.deepEqual(harness.window.bounds, edited)
  assert.deepEqual(harness.writes, [])

  assert.equal(harness.controller.save().ok, true)
  assert.deepEqual(harness.writes, [edited])
  assert.deepEqual(harness.commits, [edited])
  assert.equal(harness.controller.isEditing(), false)
})

test('desktop pet cancel restores original bounds without persisting preview', () => {
  const harness = createHarness()
  const original = { ...harness.window.bounds }
  harness.controller.begin()
  harness.controller.preview({ x: 300, y: 200, width: 700, height: 500 })

  assert.equal(harness.controller.cancel(), true)
  assert.deepEqual(harness.window.bounds, original)
  assert.deepEqual(harness.restores, [original])
  assert.deepEqual(harness.writes, [])
})

test('desktop pet save failure restores original bounds and leaves durable state untouched', () => {
  const harness = createHarness({ writeError: new Error('disk full') })
  const original = { ...harness.window.bounds }
  harness.controller.begin()
  harness.controller.preview({ x: 300, y: 200, width: 700, height: 500 })

  assert.throws(() => harness.controller.save(), /disk full/)
  assert.deepEqual(harness.window.bounds, original)
  assert.deepEqual(harness.restores, [original])
  assert.equal(harness.controller.isEditing(), false)
})
