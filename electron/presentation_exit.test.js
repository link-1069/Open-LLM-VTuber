const test = require('node:test')
const assert = require('node:assert/strict')

const { runPresentationExit } = require('./presentation_exit')

function createHarness(options = {}) {
  const calls = []
  const retryResults = [...(options.retryResults || [])]
  return {
    calls,
    ports: {
      confirmExit: async () => options.confirmed !== false,
      flushPendingSave: () => options.flushResult || null,
      hasPendingSave: () => Boolean(options.hasPendingSave),
      retryPendingSave: () => {
        calls.push('retry')
        return retryResults.shift() || { state: 'saved' }
      },
      resolveSaveFailure: async (status) => {
        calls.push(['failure', status.message])
        return options.failureDecision || 'retry'
      },
    },
  }
}

test('exit cancellation leaves pending state untouched', async () => {
  const harness = createHarness({ confirmed: false, hasPendingSave: true })
  assert.equal(await runPresentationExit(harness.ports), false)
  assert.deepEqual(harness.calls, [])
})

test('a pending save is retried before exit', async () => {
  const harness = createHarness({ hasPendingSave: true })
  assert.equal(await runPresentationExit(harness.ports), true)
  assert.deepEqual(harness.calls, ['retry'])
})

test('save failure supports retry and explicit exit anyway', async () => {
  const retry = createHarness({
    flushResult: { state: 'error', message: 'disk full' },
    retryResults: [{ state: 'saved' }],
  })
  assert.equal(await runPresentationExit(retry.ports), true)
  assert.deepEqual(retry.calls, [['failure', 'disk full'], 'retry'])

  const exitAnyway = createHarness({
    flushResult: { state: 'error', message: 'disk full' },
    failureDecision: 'exit',
  })
  assert.equal(await runPresentationExit(exitAnyway.ports), true)
  assert.deepEqual(exitAnyway.calls, [['failure', 'disk full']])
})
