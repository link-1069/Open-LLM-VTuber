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
    editDesktopPet() {},
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
  assert.equal(template[4].label, '编辑桌宠大小和位置…')
  assert.equal(template[4].enabled, false)
})

test('desktop pet visual editor is available only while the desktop mode is effective', () => {
  const template = createPresentationMenuTemplate(createSnapshot({
    effective_mode: 'desktop_pet',
  }), true, createActions())

  assert.equal(template[4].enabled, true)
  assert.equal(template[5].label, '编辑全屏舞台人物大小和位置…')
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
