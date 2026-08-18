const path = require('path')
const { PRESENTATION_MODES, STAGE_BACKGROUND_KINDS } = require('./presentation_state')

function createPresentationMenuTemplate(snapshot, mediaAvailable, actions) {
  const mediaPath = snapshot.stage_background.media_path
  const mediaName = mediaPath ? path.basename(mediaPath) : '未选择'
  return [
    {
      label: '桌面宠物模式',
      type: 'radio',
      checked: snapshot.presentation_mode === PRESENTATION_MODES.DESKTOP_PET,
      click: () => actions.setMode(PRESENTATION_MODES.DESKTOP_PET),
    },
    {
      label: '全屏舞台模式',
      type: 'radio',
      checked: snapshot.presentation_mode === PRESENTATION_MODES.FULLSCREEN_STAGE,
      click: () => actions.setMode(PRESENTATION_MODES.FULLSCREEN_STAGE),
    },
    { type: 'separator' },
    {
      label: '舞台背景',
      submenu: [
        {
          label: '透明背景',
          type: 'radio',
          checked: snapshot.stage_background.kind === STAGE_BACKGROUND_KINDS.TRANSPARENT,
          click: () => actions.setBackgroundKind(STAGE_BACKGROUND_KINDS.TRANSPARENT),
        },
        {
          label: `使用已选媒体：${mediaName}${mediaPath && !mediaAvailable ? '（不可用）' : ''}`,
          type: 'radio',
          checked: snapshot.stage_background.kind === STAGE_BACKGROUND_KINDS.MEDIA,
          enabled: Boolean(mediaPath && mediaAvailable),
          click: () => actions.setBackgroundKind(STAGE_BACKGROUND_KINDS.MEDIA),
        },
        { type: 'separator' },
        { label: '选择本地媒体…', click: actions.chooseMedia },
        { label: '清除已选媒体…', enabled: Boolean(mediaPath), click: actions.clearMedia },
      ],
    },
    {
      label: '编辑桌宠大小和位置…',
      enabled: snapshot.effective_mode === PRESENTATION_MODES.DESKTOP_PET,
      click: actions.editDesktopPet,
    },
    { label: '编辑全屏舞台人物大小和位置…', click: actions.editPerson },
    { label: '恢复默认人物布局…', click: actions.resetPerson },
    { type: 'separator' },
    { ...actions.restart },
    { type: 'separator' },
    { label: '退出应用…', click: actions.quit },
  ]
}

module.exports = {
  createPresentationMenuTemplate,
}
