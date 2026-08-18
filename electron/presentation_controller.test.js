const test = require('node:test')
const assert = require('node:assert/strict')

const { createPresentationController } = require('./presentation_controller')

function createHarness(config = {}, setup = {}) {
  let storedConfig = { ...config }
  const calls = []
  const windowAdapter = {
    bounds: config.window_bounds || { x: 100, y: 50, width: 480, height: 800 },
    resizable: true,
    getBounds() { return { ...this.bounds } },
    setBounds(bounds) {
      if (!setup.enforceResizable || this.resizable ||
        (this.bounds.width === bounds.width && this.bounds.height === bounds.height)) {
        this.bounds = { ...bounds }
      }
      calls.push(['setBounds', { ...bounds }])
    },
    setResizable(value) { this.resizable = value; calls.push(['setResizable', value]) },
    setAlwaysOnTop(flag, level) { calls.push(['setAlwaysOnTop', flag, level]) },
  }
  const displays = setup.displays || [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    },
  ]
  const controller = createPresentationController({
    readConfig: () => storedConfig,
    writeConfig: (next) => {
      if (setup.writeError) throw setup.writeError
      storedConfig = next
    },
    window: windowAdapter,
    getDisplayMatching: () => displays[setup.matchingDisplayIndex || 0],
    getPrimaryDisplay: () => displays[0],
    getAllDisplays: () => displays,
    send: (channel, payload) => calls.push(['send', channel, payload]),
    setTimeout: (callback) => { callback(); return null },
    clearTimeout: () => {},
  })
  return {
    calls,
    controller,
    getStoredConfig: () => storedConfig,
    windowAdapter,
  }
}

test('user can enter fullscreen stage and return to the saved desktop pet bounds', async () => {
  const harness = createHarness({
    window_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })

  await harness.controller.setMode('fullscreen_stage')
  assert.deepEqual(harness.windowAdapter.bounds, { x: 0, y: 0, width: 1920, height: 1080 })
  assert.equal(harness.getStoredConfig().presentation_mode, 'fullscreen_stage')

  await harness.controller.setMode('desktop_pet')
  assert.deepEqual(harness.windowAdapter.bounds, { x: 100, y: 50, width: 480, height: 800 })
  assert.equal(harness.getStoredConfig().presentation_mode, 'desktop_pet')
})

test('desktop pet user can edit through a temporary fullscreen preview without changing saved mode', async () => {
  const harness = createHarness({
    presentation_mode: 'desktop_pet',
    window_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })

  const editing = await harness.controller.beginPersonEditing()
  assert.equal(editing.previewing_stage, true)
  assert.equal(editing.editing_person, true)
  assert.deepEqual(harness.windowAdapter.bounds, { x: 0, y: 0, width: 1920, height: 1080 })
  assert.equal(harness.getStoredConfig().presentation_mode, 'desktop_pet')

  const canceled = await harness.controller.cancelPersonEditing()
  assert.equal(canceled.previewing_stage, false)
  assert.equal(canceled.editing_person, false)
  assert.deepEqual(harness.windowAdapter.bounds, { x: 100, y: 50, width: 480, height: 800 })
  assert.equal(harness.getStoredConfig().presentation_mode, 'desktop_pet')
})

test('saving a temporary person preview persists relative layout and returns to desktop pet', async () => {
  const harness = createHarness({
    presentation_mode: 'desktop_pet',
    window_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })
  await harness.controller.beginPersonEditing()

  const saved = await harness.controller.savePersonLayout({
    center_x: 0.2,
    center_y: 0.8,
    width_scale: 3,
    height_scale: 2,
  })

  assert.deepEqual(harness.getStoredConfig().stage_person_layout, {
    center_x: 0.2,
    center_y: 0.8,
    width_scale: 3,
    height_scale: 2,
  })
  assert.equal(saved.effective_mode, 'desktop_pet')
  assert.equal(saved.editing_person, false)
  assert.deepEqual(harness.windowAdapter.bounds, { x: 100, y: 50, width: 480, height: 800 })
})

test('media selection keeps transparent intent but replaces an active media background', async () => {
  const transparent = createHarness({
    stage_background: { kind: 'transparent', media_path: '' },
  })
  await transparent.controller.selectMediaPath('D:\\media\\first.png')
  assert.deepEqual(transparent.getStoredConfig().stage_background, {
    kind: 'transparent',
    media_path: 'D:\\media\\first.png',
  })

  await transparent.controller.setBackgroundKind('media')
  await transparent.controller.selectMediaPath('D:\\media\\second.mp4')
  assert.deepEqual(transparent.getStoredConfig().stage_background, {
    kind: 'media',
    media_path: 'D:\\media\\second.mp4',
  })

  await transparent.controller.clearMediaPath()
  assert.deepEqual(transparent.getStoredConfig().stage_background, {
    kind: 'transparent',
    media_path: '',
  })
})

test('fullscreen stage moves to the primary display when its target is removed', async () => {
  const displays = [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    },
    {
      id: 2,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    },
  ]
  const harness = createHarness(
    { window_bounds: { x: 2100, y: 50, width: 480, height: 800 } },
    { displays, matchingDisplayIndex: 1 }
  )
  await harness.controller.setMode('fullscreen_stage')
  assert.deepEqual(harness.windowAdapter.bounds, displays[1].bounds)

  const moved = harness.controller.handleDisplayRemoved(2)
  assert.equal(moved, true)
  assert.deepEqual(harness.windowAdapter.bounds, displays[0].bounds)
})

test('a disconnected stage display can correct the saved desktop bounds before returning', async () => {
  const displays = [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    },
    {
      id: 2,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    },
  ]
  const harness = createHarness({
    presentation_mode: 'fullscreen_stage',
    window_bounds: { x: 2100, y: 50, width: 480, height: 800 },
  }, { displays, matchingDisplayIndex: 1 })
  harness.controller.applySavedMode()

  harness.controller.correctDesktopBounds({ x: 100, y: 50, width: 480, height: 800 })
  harness.controller.handleDisplayRemoved(2)
  await harness.controller.setMode('desktop_pet')

  assert.deepEqual(harness.windowAdapter.bounds, { x: 100, y: 50, width: 480, height: 800 })
  assert.deepEqual(harness.getStoredConfig().window_bounds, {
    x: 100,
    y: 50,
    width: 480,
    height: 800,
  })
})

test('a failed mode save restores the prior desktop window and durable state', async () => {
  const harness = createHarness(
    {
      presentation_mode: 'desktop_pet',
      window_bounds: { x: 100, y: 50, width: 480, height: 800 },
    },
    { writeError: new Error('disk full') }
  )

  await assert.rejects(
    harness.controller.setMode('fullscreen_stage'),
    /disk full/
  )
  assert.equal(harness.controller.getSnapshot().effective_mode, 'desktop_pet')
  assert.equal(harness.getStoredConfig().presentation_mode, 'desktop_pet')
  assert.deepEqual(harness.windowAdapter.bounds, { x: 100, y: 50, width: 480, height: 800 })
})

test('a failed desktop save restores the prior fullscreen stage', async () => {
  let shouldFail = false
  const harness = createHarness({
    presentation_mode: 'fullscreen_stage',
    window_bounds: { x: 100, y: 50, width: 480, height: 800 },
  }, {
    get writeError() { return shouldFail ? new Error('disk full') : null },
    enforceResizable: true,
  })
  harness.controller.applySavedMode()
  shouldFail = true

  await assert.rejects(
    harness.controller.setMode('desktop_pet'),
    /disk full/
  )

  assert.equal(harness.controller.getSnapshot().effective_mode, 'fullscreen_stage')
  assert.equal(harness.getStoredConfig().presentation_mode, 'fullscreen_stage')
  assert.deepEqual(harness.windowAdapter.bounds, { x: 0, y: 0, width: 1920, height: 1080 })
})

test('reset person layout is an immediate durable discrete setting', () => {
  const harness = createHarness({
    stage_person_layout: { center_x: 0.2, center_y: 0.3, width_scale: 4, height_scale: 2 },
  })

  harness.controller.resetPersonLayout()

  assert.deepEqual(harness.getStoredConfig().stage_person_layout, {
    center_x: 0.5,
    center_y: 0.5,
    width_scale: 1,
    height_scale: 1,
  })
})

test('desktop bounds can be refreshed without accepting fullscreen bounds', async () => {
  const harness = createHarness({
    window_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })
  const movedBounds = { x: 200, y: 80, width: 600, height: 900 }
  harness.windowAdapter.bounds = movedBounds
  harness.controller.updateDesktopBounds(movedBounds)
  assert.deepEqual(harness.controller.getSnapshot().desktop_bounds, movedBounds)
  await harness.controller.setMode('fullscreen_stage')

  assert.deepEqual(harness.getStoredConfig().window_bounds, {
    x: 200,
    y: 80,
    width: 600,
    height: 900,
  })
  harness.controller.updateDesktopBounds({ x: 0, y: 0, width: 1920, height: 1080 })
  assert.deepEqual(harness.controller.getSnapshot().desktop_bounds, movedBounds)
  await harness.controller.setMode('desktop_pet')
  assert.deepEqual(harness.windowAdapter.bounds, { x: 200, y: 80, width: 600, height: 900 })
})
