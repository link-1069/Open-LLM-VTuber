const test = require('node:test')
const assert = require('node:assert/strict')

const { createStageView } = require('./stage_view')

function createElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    hidden: false,
    style: {},
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener
    },
    removeEventListener(type, listener) {
      if (this.listeners[type] === listener) delete this.listeners[type]
    },
    setPointerCapture() {},
    replaceChildren(...children) {
      this.children = children
    },
    pause() { this.paused = true },
    play() { this.played = true; return Promise.resolve() },
    removeAttribute(name) { delete this[name] },
    load() { this.loaded = true },
  }
}

function createHarness() {
  const body = createElement()
  const background = createElement()
  const editor = createElement()
  const frame = createElement()
  const save = createElement()
  const cancel = createElement()
  const slots = [0, 1].map(() => ({
    layer: createElement(),
    video: {
      ...createElement(),
      videoWidth: 480,
      videoHeight: 800,
    },
  }))
  const elements = {
    'stage-background': background,
    'stage-person-editor': editor,
    'stage-person-frame': frame,
    'stage-person-save': save,
    'stage-person-cancel': cancel,
  }
  const createdElements = []
  const document = {
    body,
    getElementById(id) { return elements[id] || null },
    createElement(tagName) {
      const element = createElement(tagName)
      createdElements.push(element)
      return element
    },
  }
  const windowObject = {
    innerWidth: 1920,
    innerHeight: 1080,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener },
    removeEventListener(type, listener) {
      if (this.listeners[type] === listener) delete this.listeners[type]
    },
  }
  const apiCalls = []
  const electronAPI = {
    saveStagePersonLayout(layout) {
      apiCalls.push(['saveStagePersonLayout', layout])
      return Promise.resolve()
    },
    cancelStagePersonEditing() {
      apiCalls.push(['cancelStagePersonEditing'])
      return Promise.resolve()
    },
  }
  const view = createStageView({
    document,
    window: windowObject,
    slots,
    electronAPI,
  })
  return { apiCalls, body, cancel, createdElements, frame, save, slots, view, windowObject }
}

test('fullscreen stage applies an independently sized relative person frame', () => {
  const harness = createHarness()

  harness.view.applyPresentationState({
    effective_mode: 'fullscreen_stage',
    previewing_stage: false,
    editing_person: false,
    stage_background: { kind: 'transparent', media_path: '' },
    stage_person_layout: { center_x: 0.25, center_y: 0.75, width_scale: 2, height_scale: 0.5 },
  })

  assert.equal(harness.body.dataset.presentationMode, 'fullscreen_stage')
  for (const slot of harness.slots) {
    assert.deepEqual(slot.layer.style, {
      left: '-168px',
      top: '540px',
      width: '1296px',
      height: '540px',
    })
  }
})

test('person editor drags and proportionally wheel-scales before explicit save', async () => {
  const harness = createHarness()
  harness.view.applyPresentationState({
    effective_mode: 'fullscreen_stage',
    previewing_stage: false,
    editing_person: true,
    stage_background: { kind: 'transparent', media_path: '' },
    stage_person_layout: { center_x: 0.5, center_y: 0.5, width_scale: 1, height_scale: 1 },
  })

  harness.frame.listeners.pointerdown({ clientX: 960, clientY: 540, pointerId: 1 })
  harness.windowObject.listeners.pointermove({ clientX: 1152, clientY: 648, pointerId: 1 })
  harness.frame.listeners.wheel({
    deltaY: -Math.log(2) / 0.001,
    preventDefault() {},
  })
  await harness.save.listeners.click()

  assert.equal(harness.apiCalls.length, 1)
  assert.equal(harness.apiCalls[0][0], 'saveStagePersonLayout')
  assert.equal(harness.apiCalls[0][1].center_x, 0.6)
  assert.equal(harness.apiCalls[0][1].center_y, 0.6)
  assert.ok(Math.abs(harness.apiCalls[0][1].width_scale - 2) < 0.000001)
  assert.ok(Math.abs(harness.apiCalls[0][1].height_scale - 2) < 0.000001)
})

test('person editor resize handles change width and height independently', async () => {
  const harness = createHarness()
  harness.view.applyPresentationState({
    effective_mode: 'fullscreen_stage',
    previewing_stage: false,
    editing_person: true,
    stage_background: { kind: 'transparent', media_path: '' },
    stage_person_layout: { center_x: 0.5, center_y: 0.5, width_scale: 1, height_scale: 1 },
  })

  harness.frame.listeners.pointerdown({
    clientX: 1284,
    clientY: 540,
    pointerId: 2,
    target: { dataset: { stageResize: 'e' } },
  })
  harness.windowObject.listeners.pointermove({ clientX: 1608, clientY: 540, pointerId: 2 })
  harness.windowObject.listeners.pointerup({ pointerId: 2 })
  harness.frame.listeners.pointerdown({
    clientX: 1122,
    clientY: 1080,
    pointerId: 3,
    target: { dataset: { stageResize: 's' } },
  })
  harness.windowObject.listeners.pointermove({ clientX: 1122, clientY: 1350, pointerId: 3 })
  harness.windowObject.listeners.pointerup({ pointerId: 3 })
  await harness.save.listeners.click()

  const saved = harness.apiCalls[0][1]
  assert.ok(Math.abs(saved.width_scale - 1.5) < 0.000001)
  assert.ok(Math.abs(saved.height_scale - 1.25) < 0.000001)
  assert.ok(Math.abs(saved.center_x - 0.584375) < 0.000001)
  assert.equal(saved.center_y, 0.625)
})

test('fullscreen MP4 background is silent, looping, cover-fitted, and released on desktop', () => {
  const harness = createHarness()
  harness.view.applyPresentationState({
    effective_mode: 'fullscreen_stage',
    previewing_stage: false,
    editing_person: false,
    stage_background: { kind: 'media', media_path: 'D:\\media\\loop.mp4' },
    stage_person_layout: { center_x: 0.5, center_y: 0.5, width_scale: 1, height_scale: 1 },
    media_available: true,
    media_type: 'video',
    media_url: 'file:///D:/media/loop.mp4?v=1',
  })

  const media = harness.view.getBackgroundElement()
  assert.equal(media.tagName, 'VIDEO')
  assert.equal(media.muted, true)
  assert.equal(media.loop, true)
  assert.equal(media.autoplay, true)
  assert.equal(media.controls, false)
  assert.equal(media.style.objectFit, 'cover')
  assert.equal(media.style.objectPosition, 'center')

  harness.view.applyPresentationState({
    effective_mode: 'desktop_pet',
    previewing_stage: false,
    editing_person: false,
    stage_background: { kind: 'media', media_path: 'D:\\media\\loop.mp4' },
    stage_person_layout: { center_x: 0.5, center_y: 0.5, width_scale: 1, height_scale: 1 },
    media_available: true,
    media_type: 'video',
    media_url: 'file:///D:/media/loop.mp4?v=1',
  })
  assert.equal(media.paused, true)
  assert.equal(harness.view.getBackgroundElement(), null)
})

test('media validation resolves only after the browser decodes the selected image', async () => {
  const harness = createHarness()
  const validation = harness.view.validateMedia({
    media_type: 'image',
    media_url: 'file:///D:/media/stage.png',
  })
  const probe = harness.createdElements.at(-1)
  assert.equal(probe.tagName, 'IMG')

  probe.listeners.load()

  assert.deepEqual(await validation, { ok: true })
})
