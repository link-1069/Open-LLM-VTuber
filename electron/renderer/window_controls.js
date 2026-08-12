const WINDOW_CONTROL_MIN_WIDTH = 320
const WINDOW_CONTROL_MIN_HEIGHT = 240

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

function parseBoundsInput(values) {
  const bounds = {}
  const errors = {}

  for (const field of ['x', 'y', 'width', 'height']) {
    const rawValue = String(values[field] ?? '').trim()
    if (!/^-?\d+$/.test(rawValue)) {
      errors[field] = '请输入整数'
      continue
    }

    const numericValue = Number(rawValue)
    if (!Number.isSafeInteger(numericValue)) {
      errors[field] = '数值超出有效范围'
      continue
    }
    bounds[field] = numericValue
  }

  if (!errors.width && bounds.width < WINDOW_CONTROL_MIN_WIDTH) {
    errors.width = `最小 ${WINDOW_CONTROL_MIN_WIDTH}px`
  }
  if (!errors.height && bounds.height < WINDOW_CONTROL_MIN_HEIGHT) {
    errors.height = `最小 ${WINDOW_CONTROL_MIN_HEIGHT}px`
  }

  if (Object.keys(errors).length > 0) {
    return { bounds: null, errors }
  }
  return { bounds, errors: {} }
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
      setStatus('error', `保存失败：${saveStatus.message || '未知错误'}`)
      return
    }
    if (saveStatus?.state === 'saving') {
      setStatus('saving', '正在自动保存…')
      return
    }
    setStatus('saved', '已自动保存')
  }

  async function refreshState() {
    try {
      const state = await electronAPI.getMainWindowState()
      updateFields(state.bounds)
      applySaveStatus(state.saveStatus)
    } catch (error) {
      setStatus('error', `读取窗口状态失败：${error.message}`)
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
      setStatus('error', result?.message || '窗口位置或尺寸无效')
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
      setStatus('error', '请修正标记的字段')
      return
    }

    setStatus('saving', '正在自动保存…')
    try {
      const result = await electronAPI.setMainWindowBounds(parsed.bounds)
      applyBoundsResult(result)
    } catch (error) {
      setStatus('error', `设置失败：${error.message}`)
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
    setStatus('saving', '正在自动保存…')
    try {
      const result = await electronAPI.resetMainWindowBounds()
      applyBoundsResult(result)
    } catch (error) {
      setStatus('error', `恢复默认失败：${error.message}`)
    }
  })

  const unsubscribeBounds = electronAPI.onMainWindowBoundsChanged((bounds) => {
    updateFields(bounds, true)
  })
  const unsubscribeSaveStatus = electronAPI.onMainWindowSaveStatus(applySaveStatus)
  windowObject.addEventListener('beforeunload', () => {
    unsubscribeBounds()
    unsubscribeSaveStatus()
  })

  refreshState()
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createTripleClickGate,
    parseBoundsInput,
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initializeWindowControls(window, document)
}
