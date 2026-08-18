;(function initializeDesktopPetEditor(root, factory) {
  const boundsAPI = typeof module !== 'undefined' && module.exports
    ? require('../window_bounds')
    : root.windowBounds
  const api = factory(boundsAPI)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createDesktopPetEditor = api.createDesktopPetEditor
})(typeof globalThis !== 'undefined' ? globalThis : window, function (boundsAPI) {
  'use strict'

  const { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } = boundsAPI

  function calculateDesktopPetBounds(startBounds, direction, deltaX, deltaY) {
    const start = { ...startBounds }
    if (direction === 'move') {
      return {
        ...start,
        x: Math.round(start.x + deltaX),
        y: Math.round(start.y + deltaY),
      }
    }

    let left = start.x
    let top = start.y
    let right = start.x + start.width
    let bottom = start.y + start.height
    if (direction.includes('w')) left = Math.min(right - MIN_WINDOW_WIDTH, left + deltaX)
    if (direction.includes('e')) right = Math.max(left + MIN_WINDOW_WIDTH, right + deltaX)
    if (direction.includes('n')) top = Math.min(bottom - MIN_WINDOW_HEIGHT, top + deltaY)
    if (direction.includes('s')) bottom = Math.max(top + MIN_WINDOW_HEIGHT, bottom + deltaY)
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    }
  }

  function createDesktopPetEditor(options) {
    const documentObject = options.document
    const windowObject = options.window
    const editor = documentObject.getElementById('desktop-pet-editor')
    const frame = documentObject.getElementById('desktop-pet-frame')
    const saveButton = documentObject.getElementById('desktop-pet-save')
    const cancelButton = documentObject.getElementById('desktop-pet-cancel')
    let editing = false
    let draftBounds = null
    let drag = null
    let pendingPreview = Promise.resolve()

    function applyPresentationState(snapshot) {
      const nextEditing = Boolean(snapshot?.editing_desktop_pet)
      if (nextEditing && (!editing || !draftBounds)) {
        draftBounds = { ...snapshot.desktop_bounds }
      }
      editing = nextEditing
      if (documentObject.body?.dataset) {
        documentObject.body.dataset.desktopPetEditing = String(editing)
      }
      if (!editing) {
        drag = null
        draftBounds = null
      }
      if (editor) editor.hidden = !editing
    }

    function handlePointerDown(event) {
      if (!editing || !draftBounds) return
      drag = {
        pointerId: event.pointerId,
        screenX: event.screenX,
        screenY: event.screenY,
        direction: event.target?.dataset?.desktopResize || 'move',
        bounds: { ...draftBounds },
      }
      event.target?.setPointerCapture?.(event.pointerId)
      frame?.setPointerCapture?.(event.pointerId)
    }

    function handlePointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId || !draftBounds) return
      const nextBounds = calculateDesktopPetBounds(
        drag.bounds,
        drag.direction,
        event.screenX - drag.screenX,
        event.screenY - drag.screenY
      )
      draftBounds = nextBounds
      pendingPreview = pendingPreview
        .then(() => options.electronAPI.updateDesktopPetBounds(nextBounds))
        .catch(() => {})
    }

    function handlePointerUp(event) {
      if (drag && event.pointerId === drag.pointerId) drag = null
    }

    function save() {
      return pendingPreview.then(() => options.electronAPI.saveDesktopPetEditing())
    }

    function cancel() {
      return pendingPreview.then(() => options.electronAPI.cancelDesktopPetEditing())
    }

    windowObject.addEventListener('pointermove', handlePointerMove)
    windowObject.addEventListener('pointerup', handlePointerUp)
    frame?.addEventListener('pointerdown', handlePointerDown)
    saveButton?.addEventListener('click', save)
    cancelButton?.addEventListener('click', cancel)

    function dispose() {
      windowObject.removeEventListener('pointermove', handlePointerMove)
      windowObject.removeEventListener('pointerup', handlePointerUp)
      frame?.removeEventListener('pointerdown', handlePointerDown)
      saveButton?.removeEventListener('click', save)
      cancelButton?.removeEventListener('click', cancel)
    }

    return {
      applyPresentationState,
      dispose,
    }
  }

  return {
    calculateDesktopPetBounds,
    createDesktopPetEditor,
  }
})
