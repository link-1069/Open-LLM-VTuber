const test = require('node:test')
const assert = require('node:assert/strict')

const {
  calculateDesktopPetBounds,
  createDesktopPetEditor,
} = require('./desktop_pet_editor')

function createElement() {
  return {
    dataset: {},
    hidden: true,
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener },
    removeEventListener(type, listener) {
      if (this.listeners[type] === listener) delete this.listeners[type]
    },
    setPointerCapture() {},
  }
}

test('desktop pet bounds support moving and independent edge or corner resizing', () => {
  const start = { x: 100, y: 50, width: 480, height: 800 }

  assert.deepEqual(calculateDesktopPetBounds(start, 'move', 40, -20), {
    x: 140, y: 30, width: 480, height: 800,
  })
  assert.deepEqual(calculateDesktopPetBounds(start, 'e', 120, 0), {
    x: 100, y: 50, width: 600, height: 800,
  })
  assert.deepEqual(calculateDesktopPetBounds(start, 'nw', 80, 100), {
    x: 180, y: 150, width: 400, height: 700,
  })
})

test('desktop pet editor previews visual bounds and saves only through the explicit action', async () => {
  const editor = createElement()
  const frame = createElement()
  const save = createElement()
  const cancel = createElement()
  const elements = {
    'desktop-pet-editor': editor,
    'desktop-pet-frame': frame,
    'desktop-pet-save': save,
    'desktop-pet-cancel': cancel,
  }
  const windowObject = {
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener },
    removeEventListener(type, listener) {
      if (this.listeners[type] === listener) delete this.listeners[type]
    },
  }
  const calls = []
  const documentBody = { dataset: {} }
  const view = createDesktopPetEditor({
    document: { body: documentBody, getElementById: (id) => elements[id] || null },
    window: windowObject,
    electronAPI: {
      updateDesktopPetBounds: async (bounds) => {
        calls.push(['bounds', bounds])
        return { ok: true, bounds }
      },
      saveDesktopPetEditing: async () => { calls.push(['save']) },
      cancelDesktopPetEditing: async () => { calls.push(['cancel']) },
    },
  })
  view.applyPresentationState({
    editing_desktop_pet: true,
    desktop_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })

  frame.listeners.pointerdown({
    pointerId: 1,
    screenX: 580,
    screenY: 850,
    target: { dataset: { desktopResize: 'se' }, setPointerCapture() {} },
  })
  windowObject.listeners.pointermove({ pointerId: 1, screenX: 700, screenY: 900 })
  await Promise.resolve()
  await save.listeners.click()

  assert.equal(editor.hidden, false)
  assert.equal(documentBody.dataset.desktopPetEditing, 'true')
  assert.deepEqual(calls, [
    ['bounds', { x: 100, y: 50, width: 600, height: 850 }],
    ['save'],
  ])
})

test('desktop pet editor exposes cancel without committing preview bounds', async () => {
  const editor = createElement()
  const frame = createElement()
  const save = createElement()
  const cancel = createElement()
  const calls = []
  const view = createDesktopPetEditor({
    document: {
      getElementById(id) {
        return {
          'desktop-pet-editor': editor,
          'desktop-pet-frame': frame,
          'desktop-pet-save': save,
          'desktop-pet-cancel': cancel,
        }[id] || null
      },
    },
    window: { addEventListener() {}, removeEventListener() {} },
    electronAPI: {
      updateDesktopPetBounds: async () => ({ ok: true }),
      saveDesktopPetEditing: async () => { calls.push('save') },
      cancelDesktopPetEditing: async () => { calls.push('cancel') },
    },
  })
  view.applyPresentationState({
    editing_desktop_pet: true,
    desktop_bounds: { x: 100, y: 50, width: 480, height: 800 },
  })

  await cancel.listeners.click()

  assert.deepEqual(calls, ['cancel'])
})
