const {
  DEFAULT_STAGE_PERSON_LAYOUT,
  PRESENTATION_MODES,
  STAGE_BACKGROUND_KINDS,
  getStageMediaType,
  normalizeConfig,
  normalizeStagePersonLayout,
} = require('./presentation_state')

function createPresentationController(options) {
  const windowAdapter = options.window
  const send = options.send || function () {}
  let config = normalizeConfig(options.readConfig())
  let desktopBounds = config.window_bounds || windowAdapter.getBounds()
  let effectiveMode = PRESENTATION_MODES.DESKTOP_PET
  let previewingStage = false
  let editingPerson = false
  let stageDisplayId = null
  let stageResizeTimer = null
  const schedule = options.setTimeout || setTimeout
  const cancelSchedule = options.clearTimeout || clearTimeout

  function clearStageResizeTimer() {
    if (stageResizeTimer !== null) {
      cancelSchedule(stageResizeTimer)
      stageResizeTimer = null
    }
  }

  function getSnapshot() {
    return {
      presentation_mode: config.presentation_mode,
      effective_mode: effectiveMode,
      previewing_stage: previewingStage,
      editing_person: editingPerson,
      stage_background: { ...config.stage_background },
      stage_person_layout: { ...config.stage_person_layout },
    }
  }

  function publish() {
    const snapshot = getSnapshot()
    send('presentation-state-changed', snapshot)
    return snapshot
  }

  function applyDesktopWindow(bounds = desktopBounds) {
    clearStageResizeTimer()
    effectiveMode = PRESENTATION_MODES.DESKTOP_PET
    previewingStage = false
    stageDisplayId = null
    windowAdapter.setResizable(true)
    windowAdapter.setAlwaysOnTop(true, 'screen-saver')
    windowAdapter.setBounds(bounds)
  }

  function applyStageWindow(targetDisplay) {
    clearStageResizeTimer()
    effectiveMode = PRESENTATION_MODES.FULLSCREEN_STAGE
    stageDisplayId = targetDisplay.id
    windowAdapter.setAlwaysOnTop(true, 'screen-saver')
    windowAdapter.setResizable(true)
    windowAdapter.setBounds(targetDisplay.bounds)
    stageResizeTimer = schedule(() => {
      stageResizeTimer = null
      if (effectiveMode !== PRESENTATION_MODES.FULLSCREEN_STAGE || stageDisplayId !== targetDisplay.id) {
        return
      }
      windowAdapter.setBounds(targetDisplay.bounds)
      windowAdapter.setResizable(false)
    }, 250)
  }

  function getStageDisplay() {
    return options.getDisplayMatching(desktopBounds) || options.getPrimaryDisplay()
  }

  async function setMode(mode) {
    if (!Object.values(PRESENTATION_MODES).includes(mode)) {
      throw new Error(`Unknown presentation mode: ${mode}`)
    }
    if (mode === config.presentation_mode && effectiveMode === mode && !previewingStage) {
      return getSnapshot()
    }

    const previousConfig = config
    const previousBounds = windowAdapter.getBounds()
    const previousEffectiveMode = effectiveMode
    const previousPreviewingStage = previewingStage
    const previousStageDisplayId = stageDisplayId

    if (effectiveMode === PRESENTATION_MODES.DESKTOP_PET) {
      desktopBounds = windowAdapter.getBounds()
    }
    const nextConfig = normalizeConfig({
      ...config,
      window_bounds: desktopBounds,
      presentation_mode: mode,
    })

    try {
      if (mode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
        applyStageWindow(getStageDisplay())
      } else {
        applyDesktopWindow(desktopBounds)
      }
      options.writeConfig(nextConfig)
      config = nextConfig
      editingPerson = false
      return publish()
    } catch (error) {
      config = previousConfig
      if (previousEffectiveMode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
        const previousDisplay = options.getAllDisplays()
          .find((display) => display.id === previousStageDisplayId) ||
          options.getDisplayMatching(previousBounds) ||
          options.getPrimaryDisplay()
        applyStageWindow(previousDisplay)
      } else {
        applyDesktopWindow(previousBounds)
      }
      effectiveMode = previousEffectiveMode
      previewingStage = previousPreviewingStage
      stageDisplayId = previousStageDisplayId
      throw error
    }
  }

  function applySavedMode() {
    if (config.presentation_mode === PRESENTATION_MODES.FULLSCREEN_STAGE) {
      applyStageWindow(getStageDisplay())
    } else {
      applyDesktopWindow(desktopBounds)
    }
    return publish()
  }

  function reloadConfig() {
    config = normalizeConfig(options.readConfig())
    desktopBounds = config.window_bounds || desktopBounds
    return getSnapshot()
  }

  function beginPersonEditing() {
    if (editingPerson) {
      return getSnapshot()
    }
    if (effectiveMode === PRESENTATION_MODES.DESKTOP_PET) {
      desktopBounds = windowAdapter.getBounds()
      previewingStage = true
      applyStageWindow(getStageDisplay())
      previewingStage = true
    }
    editingPerson = true
    return publish()
  }

  function cancelPersonEditing() {
    if (!editingPerson) {
      return getSnapshot()
    }
    editingPerson = false
    if (previewingStage) {
      applyDesktopWindow(desktopBounds)
    }
    return publish()
  }

  function savePersonLayout(layout) {
    if (!editingPerson) {
      throw new Error('Stage person layout is not being edited.')
    }
    const nextConfig = normalizeConfig({
      ...config,
      stage_person_layout: normalizeStagePersonLayout(layout),
    })
    options.writeConfig(nextConfig)
    config = nextConfig
    editingPerson = false
    if (previewingStage) {
      applyDesktopWindow(desktopBounds)
    }
    return publish()
  }

  function commitConfig(nextConfig) {
    const normalized = normalizeConfig(nextConfig)
    options.writeConfig(normalized)
    config = normalized
    return publish()
  }

  function selectMediaPath(mediaPath) {
    if (!getStageMediaType(mediaPath)) {
      throw new Error('Unsupported stage background media format.')
    }
    return commitConfig({
      ...config,
      stage_background: {
        ...config.stage_background,
        media_path: mediaPath,
      },
    })
  }

  function setBackgroundKind(kind) {
    if (!Object.values(STAGE_BACKGROUND_KINDS).includes(kind)) {
      throw new Error(`Unknown stage background kind: ${kind}`)
    }
    if (kind === STAGE_BACKGROUND_KINDS.MEDIA && !config.stage_background.media_path) {
      throw new Error('Select stage background media before enabling it.')
    }
    return commitConfig({
      ...config,
      stage_background: {
        ...config.stage_background,
        kind,
      },
    })
  }

  function clearMediaPath() {
    return commitConfig({
      ...config,
      stage_background: {
        kind: STAGE_BACKGROUND_KINDS.TRANSPARENT,
        media_path: '',
      },
    })
  }

  function resetPersonLayout() {
    return commitConfig({
      ...config,
      stage_person_layout: DEFAULT_STAGE_PERSON_LAYOUT,
    })
  }

  function updateDesktopBounds(bounds) {
    if (effectiveMode !== PRESENTATION_MODES.DESKTOP_PET || previewingStage) {
      return false
    }
    desktopBounds = { ...bounds }
    config = normalizeConfig({ ...config, window_bounds: desktopBounds })
    return true
  }

  function handleDisplayRemoved(displayId) {
    if (effectiveMode !== PRESENTATION_MODES.FULLSCREEN_STAGE || stageDisplayId !== displayId) {
      return false
    }
    applyStageWindow(options.getPrimaryDisplay())
    publish()
    return true
  }

  function refreshStageDisplay(displayId) {
    if (effectiveMode !== PRESENTATION_MODES.FULLSCREEN_STAGE || stageDisplayId !== displayId) {
      return false
    }
    const display = options.getAllDisplays().find((candidate) => candidate.id === stageDisplayId)
    applyStageWindow(display || options.getPrimaryDisplay())
    publish()
    return true
  }

  function dispose() {
    clearStageResizeTimer()
  }

  return {
    applySavedMode,
    beginPersonEditing,
    cancelPersonEditing,
    clearMediaPath,
    dispose,
    getSnapshot,
    handleDisplayRemoved,
    refreshStageDisplay,
    reloadConfig,
    resetPersonLayout,
    savePersonLayout,
    selectMediaPath,
    setBackgroundKind,
    setMode,
    updateDesktopBounds,
  }
}

module.exports = {
  createPresentationController,
}
