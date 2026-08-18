function createDesktopPetEditController(options) {
  let originalBounds = null

  function isEditing() {
    return Boolean(originalBounds)
  }

  function getSnapshot() {
    return {
      editing_desktop_pet: isEditing(),
      desktop_bounds: options.window.getBounds(),
    }
  }

  function publish() {
    const snapshot = getSnapshot()
    options.onStateChange?.(snapshot)
    return snapshot
  }

  function begin() {
    if (isEditing()) return getSnapshot()
    originalBounds = options.window.getBounds()
    return publish()
  }

  function preview(bounds) {
    if (!isEditing()) return { ok: false, message: '桌面宠物未处于编辑状态。' }
    const fieldErrors = options.validateBounds(bounds)
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, fieldErrors, message: '桌宠宽高超出允许范围。' }
    }
    if (!options.isVisible(bounds)) {
      return { ok: false, message: '桌宠窗口必须在显示区域中保留可见部分。' }
    }
    options.window.setBounds(bounds)
    return { ok: true, bounds: options.window.getBounds() }
  }

  function restore() {
    if (!isEditing()) return null
    const bounds = { ...originalBounds }
    options.window.setBounds(bounds)
    options.onRestore?.(bounds)
    originalBounds = null
    publish()
    return bounds
  }

  function save() {
    if (!isEditing()) return { ok: false, message: '桌面宠物未处于编辑状态。' }
    const bounds = options.window.getBounds()
    try {
      options.persist(bounds)
      options.onCommit?.(bounds)
      originalBounds = null
      publish()
      return { ok: true, bounds }
    } catch (error) {
      restore()
      throw error
    }
  }

  function cancel() {
    if (!isEditing()) return false
    restore()
    return true
  }

  return {
    begin,
    cancel,
    getSnapshot,
    isEditing,
    preview,
    save,
  }
}

module.exports = {
  createDesktopPetEditController,
}
