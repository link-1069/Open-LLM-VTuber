;(function initializeStageView(root, factory) {
  const layoutAPI = typeof module !== 'undefined' && module.exports
    ? require('../presentation_layout')
    : root.presentationLayout
  const contractAPI = typeof module !== 'undefined' && module.exports
    ? require('../presentation_contract')
    : root.presentationContract
  const api = factory(layoutAPI, contractAPI)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createStageView = api.createStageView
})(typeof globalThis !== 'undefined' ? globalThis : window, function (layoutAPI, contractAPI) {
  'use strict'

  const { calculateStagePersonFrame } = layoutAPI
  const { PRESENTATION_MODES, STAGE_BACKGROUND_KINDS } = contractAPI

  function createStageView(options) {
    const documentObject = options.document
    const windowObject = options.window
    const slots = options.slots
    const background = documentObject.getElementById('stage-background')
    const editor = documentObject.getElementById('stage-person-editor')
    const editFrame = documentObject.getElementById('stage-person-frame')
    const saveButton = documentObject.getElementById('stage-person-save')
    const cancelButton = documentObject.getElementById('stage-person-cancel')
    let snapshot = null
    let draftLayout = null
    let drag = null
    let backgroundElement = null
    let backgroundUrl = ''
    const setTimeoutFunction = options.setTimeout || setTimeout
    const clearTimeoutFunction = options.clearTimeout || clearTimeout

    function clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value))
    }

    function getVideoDimensions() {
      const video = slots.map((slot) => slot.video)
        .find((candidate) => candidate.videoWidth > 0 && candidate.videoHeight > 0)
      return video
        ? { width: video.videoWidth, height: video.videoHeight }
        : { width: 480, height: 800 }
    }

    function applyPersonFrame() {
      if (!snapshot) return
      if (snapshot.effective_mode !== PRESENTATION_MODES.FULLSCREEN_STAGE) {
        slots.forEach((slot) => {
          Object.assign(slot.layer.style, {
            left: '0',
            top: '0',
            width: '100%',
            height: '100%',
          })
        })
        return
      }
      const dimensions = getVideoDimensions()
      const frame = calculateStagePersonFrame({
        viewport_width: windowObject.innerWidth,
        viewport_height: windowObject.innerHeight,
        video_width: dimensions.width,
        video_height: dimensions.height,
        layout: snapshot.stage_person_layout,
      })
      slots.forEach((slot) => {
        Object.assign(slot.layer.style, {
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
        })
      })
      if (editFrame && snapshot.editing_person) {
        Object.assign(editFrame.style, {
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
        })
      }
    }

    function releaseBackground() {
      if (!backgroundElement) return
      if (backgroundElement.tagName === 'VIDEO') {
        backgroundElement.pause?.()
        backgroundElement.removeAttribute?.('src')
        backgroundElement.load?.()
      }
      background?.replaceChildren()
      backgroundElement = null
      backgroundUrl = ''
    }

    function applyBackground() {
      const shouldShowMedia = snapshot?.effective_mode === PRESENTATION_MODES.FULLSCREEN_STAGE &&
        snapshot.stage_background?.kind === STAGE_BACKGROUND_KINDS.MEDIA &&
        snapshot.media_available !== false &&
        Boolean(snapshot.media_url)
      if (!shouldShowMedia) {
        releaseBackground()
        return
      }
      if (backgroundElement && backgroundUrl === snapshot.media_url) return
      releaseBackground()
      const media = documentObject.createElement(snapshot.media_type === 'video' ? 'video' : 'img')
      media.className = 'stage-background-media'
      Object.assign(media.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'center',
        pointerEvents: 'none',
      })
      if (snapshot.media_type === 'video') {
        media.autoplay = true
        media.muted = true
        media.loop = true
        media.playsInline = true
        media.controls = false
      }
      media.addEventListener('error', () => {
        options.electronAPI.reportStageMediaFailure?.({ media_url: snapshot.media_url })
      })
      media.src = snapshot.media_url
      background?.replaceChildren(media)
      backgroundElement = media
      backgroundUrl = snapshot.media_url
      if (snapshot.media_type === 'video') {
        media.play?.().catch(() => {})
      }
    }

    function validateMedia(payload) {
      return new Promise((resolve) => {
        const media = documentObject.createElement(payload.media_type === 'video' ? 'video' : 'img')
        const successEvent = payload.media_type === 'video' ? 'canplay' : 'load'
        let settled = false
        const finish = (result) => {
          if (settled) return
          settled = true
          clearTimeoutFunction(timeout)
          media.removeEventListener(successEvent, handleSuccess)
          media.removeEventListener('error', handleError)
          if (media.tagName === 'VIDEO') {
            media.pause?.()
            media.removeAttribute?.('src')
            media.load?.()
          }
          resolve(result)
        }
        const handleSuccess = () => finish({ ok: true })
        const handleError = () => finish({ ok: false, error: '媒体文件无法解码' })
        const timeout = setTimeoutFunction(
          () => finish({ ok: false, error: '媒体文件解码超时' }),
          10000
        )
        media.addEventListener(successEvent, handleSuccess)
        media.addEventListener('error', handleError)
        if (payload.media_type === 'video') {
          media.muted = true
          media.playsInline = true
          media.preload = 'auto'
        }
        media.src = payload.media_url
        if (payload.media_type === 'video') media.load?.()
      })
    }

    function applyPresentationState(nextSnapshot) {
      const continueEditing = Boolean(snapshot?.editing_person && nextSnapshot.editing_person && draftLayout)
      draftLayout = nextSnapshot.editing_person
        ? (continueEditing ? draftLayout : { ...nextSnapshot.stage_person_layout })
        : null
      snapshot = draftLayout
        ? { ...nextSnapshot, stage_person_layout: draftLayout }
        : nextSnapshot
      documentObject.body.dataset.presentationMode = nextSnapshot.effective_mode
      if (editor) editor.hidden = !nextSnapshot.editing_person
      applyPersonFrame()
      applyBackground()
    }

    function handleResize() {
      applyPersonFrame()
    }

    function handlePointerDown(event) {
      if (!snapshot?.editing_person || !draftLayout) return
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        centerX: draftLayout.center_x,
        centerY: draftLayout.center_y,
      }
      editFrame.setPointerCapture?.(event.pointerId)
    }

    function handlePointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId || !draftLayout) return
      draftLayout.center_x = clamp(
        drag.centerX + (event.clientX - drag.clientX) / Math.max(1, windowObject.innerWidth),
        0,
        1
      )
      draftLayout.center_y = clamp(
        drag.centerY + (event.clientY - drag.clientY) / Math.max(1, windowObject.innerHeight),
        0,
        1
      )
      applyPersonFrame()
    }

    function handlePointerUp(event) {
      if (drag && event.pointerId === drag.pointerId) drag = null
    }

    function handleWheel(event) {
      if (!snapshot?.editing_person || !draftLayout) return
      event.preventDefault()
      draftLayout.scale = clamp(draftLayout.scale * Math.exp(-event.deltaY * 0.001), 0.01, 100)
      applyPersonFrame()
    }

    function savePersonLayout() {
      if (!draftLayout) return Promise.resolve()
      return options.electronAPI.saveStagePersonLayout({ ...draftLayout })
    }

    function cancelPersonEditing() {
      return options.electronAPI.cancelStagePersonEditing()
    }

    windowObject.addEventListener('resize', handleResize)
    windowObject.addEventListener('pointermove', handlePointerMove)
    windowObject.addEventListener('pointerup', handlePointerUp)
    slots.forEach((slot) => slot.video.addEventListener('loadedmetadata', applyPersonFrame))
    editFrame?.addEventListener('pointerdown', handlePointerDown)
    editFrame?.addEventListener('wheel', handleWheel)
    saveButton?.addEventListener('click', savePersonLayout)
    cancelButton?.addEventListener('click', cancelPersonEditing)

    function dispose() {
      releaseBackground()
      windowObject.removeEventListener('resize', handleResize)
      windowObject.removeEventListener('pointermove', handlePointerMove)
      windowObject.removeEventListener('pointerup', handlePointerUp)
      slots.forEach((slot) => slot.video.removeEventListener('loadedmetadata', applyPersonFrame))
      editFrame?.removeEventListener('pointerdown', handlePointerDown)
      editFrame?.removeEventListener('wheel', handleWheel)
      saveButton?.removeEventListener('click', savePersonLayout)
      cancelButton?.removeEventListener('click', cancelPersonEditing)
    }

    return {
      applyPresentationState,
      dispose,
      getBackgroundElement: () => backgroundElement,
      validateMedia,
    }
  }

  return {
    createStageView,
  }
})
