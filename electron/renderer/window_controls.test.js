const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createTripleClickGate,
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
