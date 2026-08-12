const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 480, height: 800 })
const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 240
const MIN_VISIBLE_SIZE = 50

function validateBounds(bounds) {
  const errors = {}
  const value = bounds && typeof bounds === 'object' ? bounds : {}

  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isSafeInteger(value[field])) {
      errors[field] = '请输入有效整数'
    }
  }

  if (!errors.width && value.width < MIN_WINDOW_WIDTH) {
    errors.width = `宽度不能小于 ${MIN_WINDOW_WIDTH}px`
  }
  if (!errors.height && value.height < MIN_WINDOW_HEIGHT) {
    errors.height = `高度不能小于 ${MIN_WINDOW_HEIGHT}px`
  }

  return errors
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

module.exports = {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  validateBounds,
}
