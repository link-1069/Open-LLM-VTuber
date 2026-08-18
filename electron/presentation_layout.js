;(function initializePresentationLayout(globalObject) {
  const DEFAULT_STAGE_PERSON_LAYOUT = Object.freeze({
    center_x: 0.5,
    center_y: 0.5,
    width_scale: 1,
    height_scale: 1,
  })

  function isPositiveFinite(value) {
    return Number.isFinite(value) && value > 0
  }

  function normalizeStagePersonLayout(layout) {
    const value = layout && typeof layout === 'object' ? layout : {}
    const legacyScale = isPositiveFinite(value.scale) ? value.scale : null
    return {
      center_x: Number.isFinite(value.center_x) && value.center_x >= 0 && value.center_x <= 1
        ? value.center_x
        : DEFAULT_STAGE_PERSON_LAYOUT.center_x,
      center_y: Number.isFinite(value.center_y) && value.center_y >= 0 && value.center_y <= 1
        ? value.center_y
        : DEFAULT_STAGE_PERSON_LAYOUT.center_y,
      width_scale: isPositiveFinite(value.width_scale)
        ? value.width_scale
        : (legacyScale || DEFAULT_STAGE_PERSON_LAYOUT.width_scale),
      height_scale: isPositiveFinite(value.height_scale)
        ? value.height_scale
        : (legacyScale || DEFAULT_STAGE_PERSON_LAYOUT.height_scale),
    }
  }

  function calculateStagePersonFrame(options) {
    const viewportWidth = Math.max(1, Number(options?.viewport_width) || 1)
    const viewportHeight = Math.max(1, Number(options?.viewport_height) || 1)
    const videoWidth = Math.max(1, Number(options?.video_width) || 1)
    const videoHeight = Math.max(1, Number(options?.video_height) || 1)
    const layout = normalizeStagePersonLayout(options?.layout)
    const baseWidth = viewportHeight * videoWidth / videoHeight
    const height = viewportHeight * layout.height_scale
    const width = baseWidth * layout.width_scale
    return {
      left: viewportWidth * layout.center_x - width / 2,
      top: viewportHeight * layout.center_y - height / 2,
      width,
      height,
    }
  }

  function resizeStagePersonLayout(options) {
    const viewportWidth = Math.max(1, Number(options?.viewport_width) || 1)
    const viewportHeight = Math.max(1, Number(options?.viewport_height) || 1)
    const videoWidth = Math.max(1, Number(options?.video_width) || 1)
    const videoHeight = Math.max(1, Number(options?.video_height) || 1)
    const direction = String(options?.direction || '')
    const deltaX = Number(options?.delta_x) || 0
    const deltaY = Number(options?.delta_y) || 0
    const layout = normalizeStagePersonLayout(options?.layout)
    const frame = calculateStagePersonFrame({
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
      video_width: videoWidth,
      video_height: videoHeight,
      layout,
    })
    let left = frame.left
    let top = frame.top
    let right = frame.left + frame.width
    let bottom = frame.top + frame.height

    if (direction.includes('w')) left = Math.min(right - 1, left + deltaX)
    if (direction.includes('e')) right = Math.max(left + 1, right + deltaX)
    if (direction.includes('n')) top = Math.min(bottom - 1, top + deltaY)
    if (direction.includes('s')) bottom = Math.max(top + 1, bottom + deltaY)

    const width = right - left
    const height = bottom - top
    const baseWidth = viewportHeight * videoWidth / videoHeight
    return {
      center_x: Math.min(1, Math.max(0, (left + width / 2) / viewportWidth)),
      center_y: Math.min(1, Math.max(0, (top + height / 2) / viewportHeight)),
      width_scale: width / baseWidth,
      height_scale: height / viewportHeight,
    }
  }

  const presentationLayoutAPI = {
    DEFAULT_STAGE_PERSON_LAYOUT,
    calculateStagePersonFrame,
    normalizeStagePersonLayout,
    resizeStagePersonLayout,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = presentationLayoutAPI
  }

  if (globalObject) {
    globalObject.presentationLayout = presentationLayoutAPI
  }
})(typeof window !== 'undefined' ? window : null)
