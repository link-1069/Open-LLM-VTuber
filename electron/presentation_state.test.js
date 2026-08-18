const test = require('node:test')
const assert = require('node:assert/strict')

const {
  calculateStagePersonFrame,
  DEFAULT_PRESENTATION_CONFIG,
  getStageMediaType,
  normalizeConfig,
} = require('./presentation_state')

test('legacy configuration gains safe presentation defaults without losing existing values', () => {
  const normalized = normalizeConfig({
    whep_url: 'http://example.test/live',
    last_updated: '2026-08-17T00:00:00.000Z',
    window_bounds: { x: -100, y: 20, width: 480, height: 800 },
  })

  assert.deepEqual(normalized, {
    whep_url: 'http://example.test/live',
    last_updated: '2026-08-17T00:00:00.000Z',
    window_bounds: { x: -100, y: 20, width: 480, height: 800 },
    presentation_mode: DEFAULT_PRESENTATION_CONFIG.presentation_mode,
    stage_background: DEFAULT_PRESENTATION_CONFIG.stage_background,
    stage_person_layout: DEFAULT_PRESENTATION_CONFIG.stage_person_layout,
  })
})

test('presentation values round-trip while invalid values fall back safely', () => {
  const valid = normalizeConfig({
    presentation_mode: 'fullscreen_stage',
    stage_background: { kind: 'media', media_path: 'D:\\media\\stage.mp4' },
    stage_person_layout: { center_x: 0.25, center_y: 0.75, width_scale: 2, height_scale: 0.5 },
  })
  assert.equal(valid.presentation_mode, 'fullscreen_stage')
  assert.deepEqual(valid.stage_background, {
    kind: 'media',
    media_path: 'D:\\media\\stage.mp4',
  })
  assert.deepEqual(valid.stage_person_layout, {
    center_x: 0.25,
    center_y: 0.75,
    width_scale: 2,
    height_scale: 0.5,
  })

  const invalid = normalizeConfig({
    presentation_mode: 'kiosk',
    stage_background: { kind: 'video', media_path: 'relative\\stage.png' },
    stage_person_layout: { center_x: -1, center_y: 3, width_scale: -1, height_scale: Infinity },
  })
  assert.equal(invalid.presentation_mode, 'desktop_pet')
  assert.deepEqual(invalid.stage_background, {
    kind: 'transparent',
    media_path: '',
  })
  assert.deepEqual(invalid.stage_person_layout, {
    center_x: 0.5,
    center_y: 0.5,
    width_scale: 1,
    height_scale: 1,
  })

  const invalidMedia = normalizeConfig({
    stage_background: { kind: 'media', media_path: 'relative\\stage.png' },
  })
  assert.deepEqual(invalidMedia.stage_background, {
    kind: 'transparent',
    media_path: '',
  })
})

test('stage media type accepts only the configured image, GIF, and MP4 formats', () => {
  assert.equal(getStageMediaType('C:\\media\\background.JPEG'), 'image')
  assert.equal(getStageMediaType('C:\\media\\animated.GiF'), 'image')
  assert.equal(getStageMediaType('C:\\media\\loop.MP4'), 'video')
  assert.equal(getStageMediaType('C:\\media\\movie.webm'), null)
  assert.equal(getStageMediaType('C:\\media\\fake.mp4.exe'), null)
})

test('stage person frame supports independent relative width and height', () => {
  assert.deepEqual(
    calculateStagePersonFrame({
      viewport_width: 1920,
      viewport_height: 1080,
      video_width: 480,
      video_height: 800,
      layout: { center_x: 0.25, center_y: 0.75, width_scale: 2, height_scale: 0.5 },
    }),
    { left: -168, top: 540, width: 1296, height: 540 }
  )
})

test('legacy single-scale person layouts migrate without changing their shape', () => {
  assert.deepEqual(normalizeConfig({
    stage_person_layout: { center_x: 0.2, center_y: 0.8, scale: 3 },
  }).stage_person_layout, {
    center_x: 0.2,
    center_y: 0.8,
    width_scale: 3,
    height_scale: 3,
  })
})
