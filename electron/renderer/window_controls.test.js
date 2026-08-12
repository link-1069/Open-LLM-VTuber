const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createTripleClickGate,
  parseBoundsInput,
} = require('./window_controls')

test('opens on the third click within five seconds', () => {
  const gate = createTripleClickGate(5000)

  assert.equal(gate.record(1000), false)
  assert.equal(gate.record(4000), false)
  assert.equal(gate.record(6000), true)
  assert.equal(gate.record(6001), false)
})

test('treats the first click after a timeout as a new sequence', () => {
  const gate = createTripleClickGate(5000)

  assert.equal(gate.record(1000), false)
  assert.equal(gate.record(6001), false)
  assert.equal(gate.record(7000), false)
  assert.equal(gate.record(8000), true)
})

test('parses integer DIP bounds and rejects invalid fields as one group', () => {
  assert.deepEqual(
    parseBoundsInput({ x: '-120', y: '40', width: '640', height: '900' }),
    { bounds: { x: -120, y: 40, width: 640, height: 900 }, errors: {} }
  )

  const invalid = parseBoundsInput({ x: '', y: '1.5', width: '319', height: 'abc' })
  assert.equal(invalid.bounds, null)
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['height', 'width', 'x', 'y'])
})
