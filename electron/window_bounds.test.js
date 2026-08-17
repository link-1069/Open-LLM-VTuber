const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_WINDOW_SIZE,
  MIN_VISIBLE_SIZE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  NATIVE_INT_MAX,
  centerBoundsInWorkArea,
  constrainBoundsToWorkArea,
  hasMinimumVisibleArea,
  normalizeStoredBounds,
  parseBoundsInput,
  selectLatestDesktopBounds,
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

test('reports native integer overflow on the corresponding field', () => {
  const errors = validateBounds({
    x: 0,
    y: 0,
    width: NATIVE_INT_MAX + 1,
    height: 800,
  })

  assert.deepEqual(Object.keys(errors), ['width'])
  assert.match(errors.width, /32-bit integer/)
})

test('parses input and delegates all bounds rules to the shared validator', () => {
  assert.deepEqual(
    parseBoundsInput({ x: '-120', y: '40', width: '640', height: '900' }),
    { bounds: { x: -120, y: 40, width: 640, height: 900 }, errors: {} }
  )

  const invalid = parseBoundsInput({
    x: '',
    y: '1.5',
    width: String(MIN_WINDOW_WIDTH - 1),
    height: String(NATIVE_INT_MAX + 1),
  })
  assert.equal(invalid.bounds, null)
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['height', 'width', 'x', 'y'])
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

test('display recovery prefers pending desktop bounds over controller and stored values', () => {
  const pending = { x: 3000, y: 20, width: 480, height: 800 }
  const controller = { x: 2000, y: 20, width: 480, height: 800 }
  const stored = { x: 100, y: 20, width: 480, height: 800 }

  assert.equal(selectLatestDesktopBounds(pending, controller, stored), pending)
  assert.equal(selectLatestDesktopBounds(null, controller, stored), controller)
  assert.equal(selectLatestDesktopBounds(null, null, stored), stored)
})
