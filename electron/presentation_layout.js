;(function initializePresentationLayout(globalObject) {
  const DEFAULT_STAGE_PERSON_LAYOUT = Object.freeze({
    center_x: 0.5,
    center_y: 0.5,
    scale: 1,
  })

  function normalizeStagePersonLayout(layout) {
    const value = layout && typeof layout === 'object' ? layout : {}
    return {
      center_x: Number.isFinite(value.center_x) && value.center_x >= 0 && value.center_x <= 1
        ? value.center_x
        : DEFAULT_STAGE_PERSON_LAYOUT.center_x,
      center_y: Number.isFinite(value.center_y) && value.center_y >= 0 && value.center_y <= 1
        ? value.center_y
        : DEFAULT_STAGE_PERSON_LAYOUT.center_y,
      scale: Number.isFinite(value.scale) && value.scale >= 0.01 && value.scale <= 100
        ? value.scale
        : DEFAULT_STAGE_PERSON_LAYOUT.scale,
    }
  }

  function calculateStagePersonFrame(options) {
    const viewportWidth = Math.max(1, Number(options?.viewport_width) || 1)
    const viewportHeight = Math.max(1, Number(options?.viewport_height) || 1)
    const videoWidth = Math.max(1, Number(options?.video_width) || 1)
    const videoHeight = Math.max(1, Number(options?.video_height) || 1)
    const layout = normalizeStagePersonLayout(options?.layout)
    const height = viewportHeight * layout.scale
    const width = height * videoWidth / videoHeight
    return {
      left: viewportWidth * layout.center_x - width / 2,
      top: viewportHeight * layout.center_y - height / 2,
      width,
      height,
    }
  }

  const presentationLayoutAPI = {
    DEFAULT_STAGE_PERSON_LAYOUT,
    calculateStagePersonFrame,
    normalizeStagePersonLayout,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = presentationLayoutAPI
  }

  if (globalObject) {
    globalObject.presentationLayout = presentationLayoutAPI
  }
})(typeof window !== 'undefined' ? window : null)
