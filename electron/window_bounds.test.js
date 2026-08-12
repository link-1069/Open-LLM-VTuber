const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  validateBounds,
} = require('./window_bounds')

test('normalizes only complete integer bounds that satisfy the minimum size', () => {
  assert.deepEqual(
    normalizeStoredBounds({ x: -200, y: 40, width: 480, height: 800 }),
    { x: -200, y: 40, width: 480, height: 800 }
  )
  assert.equal(normalizeStoredBounds({ x: 0, y: 0, width: 319, height: 800 }), null)
  assert.equal(normalizeStoredBounds({ x: 0.5, y: 0, width: 480, height: 800 }), null)
})

test('reports field-level validation errors', () => {
  const errors = validateBounds({ x: '0', y: 0, width: MIN_WINDOW_WIDTH - 1, height: MIN_WINDOW_HEIGHT - 1 })

  assert.deepEqual(Object.keys(errors).sort(), ['height', 'width', 'x'])
})

test('accepts negative coordinates when at least 50px remains visible', () => {
  const workAreas = [{ x: -1920, y: 0, width: 1920, height: 1040 }]

  assert.equal(
    hasMinimumVisibleArea(
      { x: -1920 - 480 + MIN_VISIBLE_SIZE, y: 20, width: 480, height: 800 },
      workAreas
    ),
    true
  )
  assert.equal(
    hasMinimumVisibleArea(
      { x: -1920 - 480 + MIN_VISIBLE_SIZE - 1, y: 20, width: 480, height: 800 },
      workAreas
    ),
    false
  )
})

test('pulls off-screen bounds back to the nearest visible edge', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

  assert.deepEqual(
    constrainBoundsToWorkArea({ x: 3000, y: -2000, width: 480, height: 800 }, workArea),
    { x: 1870, y: -750, width: 480, height: 800 }
  )
})

test('centers the default window size in a display work area', () => {
  assert.deepEqual(
    centerBoundsInWorkArea(DEFAULT_WINDOW_SIZE, { x: 1920, y: 0, width: 2560, height: 1400 }),
    { x: 2960, y: 300, width: 480, height: 800 }
  )
})
