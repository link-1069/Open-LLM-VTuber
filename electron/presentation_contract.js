;(function initializePresentationContract(globalObject) {
const PRESENTATION_MODES = Object.freeze({
  DESKTOP_PET: 'desktop_pet',
  FULLSCREEN_STAGE: 'fullscreen_stage',
})

const STAGE_BACKGROUND_KINDS = Object.freeze({
  TRANSPARENT: 'transparent',
  MEDIA: 'media',
})

const presentationContractAPI = {
  PRESENTATION_MODES,
  STAGE_BACKGROUND_KINDS,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = presentationContractAPI
}

if (globalObject) {
  globalObject.presentationContract = presentationContractAPI
}
})(typeof window !== 'undefined' ? window : null)
