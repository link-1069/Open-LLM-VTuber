const test = require('node:test')
const assert = require('node:assert/strict')

const { createPresentationMenuTemplate } = require('./presentation_menu')

function createSnapshot(overrides = {}) {
  return {
    presentation_mode: 'desktop_pet',
    stage_background: { kind: 'transparent', media_path: 'D:\\media\\stage.gif' },
    ...overrides,
  }
}

function createActions() {
  return {
    setMode() {},
    setBackgroundKind() {},
    chooseMedia() {},
    clearMedia() {},
    editPerson() {},
    resetPerson() {},
    restart: { label: '重新检测连接', click() {} },
    quit() {},
  }
}

test('menu exposes both modes and marks an unavailable expected media background', () => {
  const template = createPresentationMenuTemplate(createSnapshot({
    presentation_mode: 'fullscreen_stage',
    stage_background: { kind: 'media', media_path: 'D:\\media\\stage.gif' },
  }), false, createActions())

  assert.equal(template[0].checked, false)
  assert.equal(template[1].checked, true)
  const mediaItem = template[3].submenu[1]
  assert.equal(mediaItem.checked, true)
  assert.equal(mediaItem.enabled, false)
  assert.equal(mediaItem.label, '使用已选媒体：stage.gif（不可用）')
})

test('menu actions delegate discrete choices to the coordinator callbacks', () => {
  const calls = []
  const actions = createActions()
  actions.setMode = (mode) => calls.push(['mode', mode])
  actions.setBackgroundKind = (kind) => calls.push(['background', kind])
  actions.quit = () => calls.push(['quit'])
  const template = createPresentationMenuTemplate(createSnapshot(), true, actions)

  template[1].click()
  template[3].submenu[0].click()
  template.at(-1).click()

  assert.deepEqual(calls, [
    ['mode', 'fullscreen_stage'],
    ['background', 'transparent'],
    ['quit'],
  ])
})
