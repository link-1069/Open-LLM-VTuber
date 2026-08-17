;(function initializeWindowBounds(globalObject) {
const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 480, height: 800 })
const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 240
const MIN_VISIBLE_SIZE = 50
const NATIVE_INT_MIN = -2147483648
const NATIVE_INT_MAX = 2147483647

function isNativeInteger(value) {
  return Number.isInteger(value) && value >= NATIVE_INT_MIN && value <= NATIVE_INT_MAX
}

function validateBounds(bounds) {
  const errors = {}
  const value = bounds && typeof bounds === 'object' ? bounds : {}

  for (const field of ['x', 'y', 'width', 'height']) {
    if (!isNativeInteger(value[field])) {
      errors[field] = 'Value must be a signed 32-bit integer.'
    }
  }

  if (!errors.width && value.width < MIN_WINDOW_WIDTH) {
    errors.width = `Width must be at least ${MIN_WINDOW_WIDTH}px.`
  }
  if (!errors.height && value.height < MIN_WINDOW_HEIGHT) {
    errors.height = `Height must be at least ${MIN_WINDOW_HEIGHT}px.`
  }

  return errors
}

function parseBoundsInput(values) {
  const bounds = {}
  const parseErrors = {}

  for (const field of ['x', 'y', 'width', 'height']) {
    const rawValue = String(values[field] ?? '').trim()
    if (!/^-?\d+$/.test(rawValue)) {
      parseErrors[field] = 'Enter an integer.'
      continue
    }
    bounds[field] = Number(rawValue)
  }

  const errors = { ...validateBounds(bounds), ...parseErrors }
  if (Object.keys(errors).length > 0) {
    return { bounds: null, errors }
  }
  return { bounds, errors: {} }
}

function normalizeStoredBounds(bounds) {
  if (Object.keys(validateBounds(bounds)).length > 0) {
    return null
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

function getIntersection(bounds, workArea) {
  const left = Math.max(bounds.x, workArea.x)
  const top = Math.max(bounds.y, workArea.y)
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)

  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function hasMinimumVisibleArea(bounds, workAreas, minimum = MIN_VISIBLE_SIZE) {
  return workAreas.some((workArea) => {
    const intersection = getIntersection(bounds, workArea)
    return intersection.width >= minimum && intersection.height >= minimum
  })
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function constrainBoundsToWorkArea(bounds, workArea, minimum = MIN_VISIBLE_SIZE) {
  const minimumX = workArea.x + minimum - bounds.width
  const maximumX = workArea.x + workArea.width - minimum
  const minimumY = workArea.y + minimum - bounds.height
  const maximumY = workArea.y + workArea.height - minimum

  return {
    x: clamp(bounds.x, minimumX, maximumX),
    y: clamp(bounds.y, minimumY, maximumY),
    width: bounds.width,
    height: bounds.height,
  }
}

function centerBoundsInWorkArea(size, workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
    width: size.width,
    height: size.height,
  }
}

function selectLatestDesktopBounds(pendingBounds, controllerBounds, storedBounds) {
  return pendingBounds || controllerBounds || storedBounds || null
}

const windowBoundsAPI = {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  NATIVE_INT_MAX,
  NATIVE_INT_MIN,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  parseBoundsInput,
  selectLatestDesktopBounds,
  validateBounds,
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = windowBoundsAPI
}

if (globalObject) {
  globalObject.windowBounds = windowBoundsAPI
}
})(typeof window !== 'undefined' ? window : null)
