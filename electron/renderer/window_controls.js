const windowBounds = typeof module !== 'undefined' && module.exports
  ? require('../window_bounds')
  : window.windowBounds
const { parseBoundsInput } = windowBounds

function createTripleClickGate(timeoutMs) {
  let clickCount = 0
  let firstClickAt = 0

  return {
    record(timestamp = Date.now()) {
      if (clickCount === 0 || timestamp - firstClickAt > timeoutMs || timestamp < firstClickAt) {
        clickCount = 1
        firstClickAt = timestamp
        return false
      }

      clickCount += 1
      if (clickCount < 3) {
        return false
      }

      clickCount = 0
      firstClickAt = 0
      return true
    },
    reset() {
      clickCount = 0
      firstClickAt = 0
    },
  }
}

function initializeWindowControls(windowObject, documentObject) {
  const electronAPI = windowObject.electronAPI
  if (!electronAPI) {
    return
  }

  const hotspot = documentObject.getElementById('window-controls-hotspot')
  const panel = documentObject.getElementById('window-controls-panel')
  const closeButton = documentObject.getElementById('window-controls-close')
  const resetButton = documentObject.getElementById('window-reset')
  const status = documentObject.getElementById('window-save-status')
  const fields = Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((field) => [
      field,
      documentObject.getElementById(`window-${field}`),
    ])
  )
  const errorElements = Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((field) => [
      field,
      documentObject.getElementById(`window-${field}-error`),
    ])
  )
  const gate = createTripleClickGate(5000)

  function setStatus(state, message) {
    status.dataset.state = state
    status.textContent = message
  }

  function updateFields(bounds, preserveFocusedField = false) {
    if (!bounds) {
      return
    }
    for (const [field, input] of Object.entries(fields)) {
      if (preserveFocusedField && documentObject.activeElement === input) {
        continue
      }
      input.value = String(bounds[field])
    }
  }

  function showFieldErrors(errors = {}) {
    for (const field of Object.keys(fields)) {
      const message = errors[field] || ''
      errorElements[field].textContent = message
      fields[field].setAttribute('aria-invalid', message ? 'true' : 'false')
    }
  }

  function applySaveStatus(saveStatus) {
    if (saveStatus?.state === 'error') {
      setStatus('error', `Save failed: ${saveStatus.message || 'Unknown error'}`)
      return
    }
    if (saveStatus?.state === 'saving') {
      setStatus('saving', 'Auto-saving…')
      return
    }
    setStatus('saved', 'Auto-saved')
  }

  async function refreshState() {
    try {
      const state = await electronAPI.getMainWindowState()
      updateFields(state.bounds)
      applySaveStatus(state.saveStatus)
    } catch (error) {
      setStatus('error', `Failed to read window state: ${error.message}`)
    }
  }

  function setPanelOpen(open) {
    panel.hidden = !open
    panel.setAttribute('aria-hidden', open ? 'false' : 'true')
    if (open) {
      refreshState()
    }
  }

  function applyBoundsResult(result) {
    if (!result?.ok) {
      showFieldErrors(result?.fieldErrors)
      setStatus('error', result?.message || 'Invalid window position or size.')
      return false
    }
    showFieldErrors()
    updateFields(result.bounds)
    applySaveStatus(result.saveStatus)
    return true
  }

  async function applyBounds() {
    const rawValues = Object.fromEntries(
      Object.entries(fields).map(([field, input]) => [field, input.value])
    )
    const parsed = parseBoundsInput(rawValues)
    showFieldErrors(parsed.errors)
    if (!parsed.bounds) {
      setStatus('error', 'Correct the highlighted fields.')
      return
    }

    setStatus('saving', 'Auto-saving…')
    try {
      const result = await electronAPI.setMainWindowBounds(parsed.bounds)
      applyBoundsResult(result)
    } catch (error) {
      setStatus('error', `Failed to update window bounds: ${error.message}`)
    }
  }

  hotspot.addEventListener('click', (event) => {
    if (event.button !== 0) {
      return
    }
    if (gate.record()) {
      setPanelOpen(panel.hidden)
    }
  })

  closeButton.addEventListener('click', () => setPanelOpen(false))
  documentObject.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setPanelOpen(false)
    }
  })

  for (const input of Object.values(fields)) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        input.blur()
      }
    })
    input.addEventListener('blur', applyBounds)
  }

  resetButton.addEventListener('click', async () => {
    showFieldErrors()
    setStatus('saving', 'Auto-saving…')
    try {
      const result = await electronAPI.resetMainWindowBounds()
      applyBoundsResult(result)
    } catch (error) {
      setStatus('error', `Failed to restore defaults: ${error.message}`)
    }
  })

  const unsubscribeBounds = electronAPI.onMainWindowBoundsChanged((bounds) => {
    updateFields(bounds, true)
  })
  const unsubscribeSaveStatus = electronAPI.onMainWindowSaveStatus(applySaveStatus)
  const unsubscribePresentation = electronAPI.onPresentationStateChanged
    ? electronAPI.onPresentationStateChanged((snapshot) => {
        if (snapshot?.effective_mode === 'fullscreen_stage') setPanelOpen(false)
      })
    : function () {}
  windowObject.addEventListener('beforeunload', () => {
    unsubscribeBounds()
    unsubscribeSaveStatus()
    unsubscribePresentation()
  })

  refreshState()
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createTripleClickGate,
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initializeWindowControls(window, document)
}
