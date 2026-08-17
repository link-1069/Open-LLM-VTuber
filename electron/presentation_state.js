const path = require('path')
const { normalizeStoredBounds } = require('./window_bounds')
const {
  DEFAULT_STAGE_PERSON_LAYOUT,
  calculateStagePersonFrame,
  normalizeStagePersonLayout,
} = require('./presentation_layout')

const PRESENTATION_MODES = Object.freeze({
  DESKTOP_PET: 'desktop_pet',
  FULLSCREEN_STAGE: 'fullscreen_stage',
})

const STAGE_BACKGROUND_KINDS = Object.freeze({
  TRANSPARENT: 'transparent',
  MEDIA: 'media',
})

const DEFAULT_PRESENTATION_CONFIG = Object.freeze({
  presentation_mode: PRESENTATION_MODES.DESKTOP_PET,
  stage_background: Object.freeze({
    kind: STAGE_BACKGROUND_KINDS.TRANSPARENT,
    media_path: '',
  }),
  stage_person_layout: DEFAULT_STAGE_PERSON_LAYOUT,
})

const STAGE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])

function getStageMediaType(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return null
  }
  const extension = path.extname(filePath).toLowerCase()
  if (STAGE_IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (extension === '.mp4') {
    return 'video'
  }
  return null
}

function normalizeConfig(config) {
  const value = config && typeof config === 'object' ? config : {}
  const windowBounds = normalizeStoredBounds(value.window_bounds)
  const presentationMode = Object.values(PRESENTATION_MODES).includes(value.presentation_mode)
    ? value.presentation_mode
    : DEFAULT_PRESENTATION_CONFIG.presentation_mode
  const background = value.stage_background && typeof value.stage_background === 'object'
    ? value.stage_background
    : {}
  const backgroundKind = Object.values(STAGE_BACKGROUND_KINDS).includes(background.kind)
    ? background.kind
    : DEFAULT_PRESENTATION_CONFIG.stage_background.kind
  const personLayout = normalizeStagePersonLayout(value.stage_person_layout)
  return {
    whep_url: typeof value.whep_url === 'string' ? value.whep_url : '',
    last_updated: typeof value.last_updated === 'string'
      ? value.last_updated
      : new Date().toISOString(),
    ...(windowBounds ? { window_bounds: windowBounds } : {}),
    presentation_mode: presentationMode,
    stage_background: {
      kind: backgroundKind,
      media_path: typeof background.media_path === 'string' && path.isAbsolute(background.media_path)
        ? background.media_path
        : '',
    },
    stage_person_layout: {
      ...personLayout,
    },
  }
}

module.exports = {
  calculateStagePersonFrame,
  DEFAULT_PRESENTATION_CONFIG,
  DEFAULT_STAGE_PERSON_LAYOUT,
  PRESENTATION_MODES,
  STAGE_BACKGROUND_KINDS,
  getStageMediaType,
  normalizeConfig,
  normalizeStagePersonLayout,
}
