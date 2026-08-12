const test = require('node:test')
const assert = require('node:assert/strict')

const { createAutoConnectController } = require('./auto_connect')

function createIntervalHarness() {
  const scheduled = []
  const cleared = []
  return {
    scheduled,
    cleared,
    setIntervalFn(fn, delay) {
      const handle = { fn, delay }
      scheduled.push(handle)
      return handle
    },
    clearIntervalFn(handle) {
      cleared.push(handle)
    },
  }
}

function createTimeoutHarness() {
  const scheduled = []
  const cleared = []
  return {
    scheduled,
    cleared,
    setTimeoutFn(fn, delay) {
      const handle = { fn, delay }
      scheduled.push(handle)
      return handle
    },
    clearTimeoutFn(handle) {
      cleared.push(handle)
    },
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('starts automatic access with an immediate complete detection round', async () => {
  const calls = []
  const intervals = createIntervalHarness()
  const streamManager = {
    subscribe() { return () => {} },
    prepare(candidate) { calls.push(['prepare', candidate]) },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => {
      calls.push(['discover'])
      return 'stream-42'
    },
    probeConnection: async (candidate) => {
      calls.push(['probe', candidate])
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear-config']) },
    saveConfig: async (whepUrl) => { calls.push(['save-config', whepUrl]) },
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()

  assert.deepEqual(calls, [
    ['clear-config'],
    ['discover'],
    ['probe', { streamId: 'stream-42', whepUrl: 'whep://stream-42' }],
    ['save-config', 'whep://stream-42'],
    ['prepare', { streamId: 'stream-42', whepUrl: 'whep://stream-42' }],
  ])
  assert.equal(intervals.scheduled.length, 1)
  assert.equal(intervals.scheduled[0].delay, 1000)
})

test('continues detection when clearing a stale saved URL fails', async () => {
  const intervals = createIntervalHarness()
  const calls = []
  const progress = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { throw new Error('disk locked') },
    saveConfig: async () => {},
    streamManager: {
      subscribe() { return () => {} },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: (snapshot) => progress.push(snapshot),
  })

  await controller.start()

  assert.deepEqual(calls, [['prepare', 'stream-a']])
  assert.equal(progress.some((snapshot) => snapshot.phase === 'clear-error'), true)
})

test('skips interval ticks while the previous detection round is still running', async () => {
  const intervals = createIntervalHarness()
  let resolveDiscovery
  let discoveryCalls = 0
  const firstDiscovery = new Promise((resolve) => { resolveDiscovery = resolve })
  const controller = createAutoConnectController({
    discoverActiveStream: async () => {
      discoveryCalls += 1
      if (discoveryCalls === 1) {
        return firstDiscovery
      }
      return ''
    },
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => {},
    streamManager: { subscribe() { return () => {} }, prepare() {} },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  const startPromise = controller.start()
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()

  assert.equal(discoveryCalls, 1)

  resolveDiscovery('')
  await startPromise
  await intervals.scheduled[0].fn()

  assert.equal(discoveryCalls, 2)
})

test('fails an activity discovery request after three seconds', async () => {
  const intervals = createIntervalHarness()
  const timeouts = createTimeoutHarness()
  const progress = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => new Promise(() => {}),
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => {},
    streamManager: { subscribe() { return () => {} }, prepare() {} },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    setTimeoutFn: timeouts.setTimeoutFn,
    clearTimeoutFn: timeouts.clearTimeoutFn,
    onProgress: (snapshot) => progress.push(snapshot),
  })

  const startPromise = controller.start()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(timeouts.scheduled.length, 1)
  assert.equal(timeouts.scheduled[0].delay, 3000)

  timeouts.scheduled[0].fn()
  await startPromise

  assert.equal(progress.at(-1).phase, 'retrying')
  assert.match(progress.at(-1).error, /3 秒/)
  assert.equal(Number.isFinite(progress.at(-1).deadlineAt), true)
})

test('does not reprobe or rebuild the same candidate while it waits for a frame', async () => {
  const intervals = createIntervalHarness()
  let probeCalls = 0
  let saveCalls = 0
  let prepareCalls = 0
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => {
      probeCalls += 1
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => { saveCalls += 1 },
    streamManager: {
      subscribe() { return () => {} },
      prepare() { prepareCalls += 1 },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  await intervals.scheduled[0].fn()

  assert.equal(probeCalls, 1)
  assert.equal(saveCalls, 1)
  assert.equal(prepareCalls, 1)
})

test('shows the main window only after the first candidate is ready', async () => {
  const intervals = createIntervalHarness()
  let streamListener
  const calls = []
  const streamManager = {
    subscribe(listener) {
      streamListener = listener
      return () => {}
    },
    prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    activate(streamId) {
      calls.push(['activate', streamId])
      return true
    },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => { calls.push(['save']) },
    showMain: async () => { calls.push(['show-main']) },
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  assert.deepEqual(calls, [['save'], ['prepare', 'stream-a']])

  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, [
    ['save'],
    ['prepare', 'stream-a'],
    ['activate', 'stream-a'],
    ['show-main'],
  ])
})

test('clears the stream and repeats full detection when the initial window switch fails', async () => {
  const intervals = createIntervalHarness()
  let streamListener
  let showAttempts = 0
  let probeCalls = 0
  let prepareCalls = 0
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => {
      probeCalls += 1
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => {},
    showMain: async () => {
      showAttempts += 1
      if (showAttempts === 1) {
        throw new Error('window switch failed')
      }
    },
    streamManager: {
      subscribe(listener) {
        streamListener = listener
        return () => {}
      },
      prepare() { prepareCalls += 1 },
      activate() { return true },
      closeAll() {},
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()

  assert.equal(showAttempts, 1)
  assert.equal(probeCalls, 2)
  assert.equal(prepareCalls, 2)

  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(showAttempts, 2)
})

test('saves a replacement only after its frame is ready and before activation', async () => {
  const intervals = createIntervalHarness()
  const discovered = ['stream-a', 'stream-b']
  let streamListener
  const calls = []
  const streamManager = {
    subscribe(listener) {
      streamListener = listener
      return () => {}
    },
    prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    activate(streamId) {
      calls.push(['activate', streamId])
      return true
    },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async (candidate) => {
      calls.push(['probe', candidate.streamId])
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async (whepUrl) => { calls.push(['save', whepUrl]) },
    showMain: async () => { calls.push(['show-main']) },
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  calls.length = 0

  await intervals.scheduled[0].fn()
  assert.deepEqual(calls, [
    ['probe', 'stream-b'],
    ['prepare', 'stream-b'],
  ])

  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, [
    ['probe', 'stream-b'],
    ['prepare', 'stream-b'],
    ['save', 'whep://stream-b'],
    ['activate', 'stream-b'],
  ])
})

test('retries saving a ready replacement without rebuilding it', async () => {
  const intervals = createIntervalHarness()
  const discovered = ['stream-a', 'stream-b', 'stream-b']
  let streamListener
  let replacementSaveAttempts = 0
  const calls = []
  const streamManager = {
    subscribe(listener) {
      streamListener = listener
      return () => {}
    },
    prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    activate(streamId) {
      calls.push(['activate', streamId])
      return true
    },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async (candidate) => {
      calls.push(['probe', candidate.streamId])
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b' && replacementSaveAttempts++ === 0) {
        throw new Error('disk busy')
      }
    },
    showMain: async () => {},
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.filter((call) => call[0] === 'activate' && call[1] === 'stream-b').length, 0)

  await intervals.scheduled[0].fn()

  assert.equal(calls.filter((call) => call[0] === 'probe' && call[1] === 'stream-b').length, 1)
  assert.equal(calls.filter((call) => call[0] === 'prepare' && call[1] === 'stream-b').length, 1)
  assert.equal(calls.filter((call) => call[0] === 'save' && call[1] === 'whep://stream-b').length, 2)
  assert.equal(calls.filter((call) => call[0] === 'activate' && call[1] === 'stream-b').length, 1)
})

test('cancels a candidate when discovery returns to the current stream', async () => {
  const intervals = createIntervalHarness()
  const discovered = ['stream-a', 'stream-b', 'stream-a']
  let streamListener
  const calls = []
  const streamManager = {
    subscribe(listener) {
      streamListener = listener
      return () => {}
    },
    prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    activate() { return true },
    cancelCandidate() { calls.push(['cancel-candidate']) },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-a',
    probeConnection: async (candidate) => {
      calls.push(['probe', candidate.streamId])
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => {},
    showMain: async () => {},
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  calls.length = 0

  await intervals.scheduled[0].fn()

  assert.deepEqual(calls, [['cancel-candidate']])
})

test('clears configuration and cools a failed candidate for five seconds', async () => {
  const intervals = createIntervalHarness()
  let streamListener
  let now = 1000
  let clearCalls = 0
  let probeCalls = 0
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => {
      probeCalls += 1
      return true
    },
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { clearCalls += 1 },
    saveConfig: async () => {},
    streamManager: {
      subscribe(listener) {
        streamListener = listener
        return () => {}
      },
      prepare() {},
    },
    now: () => now,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-failed',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    error: new Error('play failed'),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(clearCalls, 2)
  await intervals.scheduled[0].fn()
  assert.equal(probeCalls, 1)

  now = 6001
  await intervals.scheduled[0].fn()
  assert.equal(probeCalls, 2)
})

test('keeps an existing candidate when the current stream fails', async () => {
  const intervals = createIntervalHarness()
  const discovered = ['stream-a', 'stream-b']
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear']) },
    saveConfig: async (whepUrl) => { calls.push(['save', whepUrl]) },
    showSetup: async () => { calls.push(['show-setup']) },
    showMain: async () => { calls.push(['show-main']) },
    streamManager: {
      subscribe(listener) {
        streamListener = listener
        return () => {}
      },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
      activate(streamId) {
        calls.push(['activate', streamId])
        return true
      },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  calls.length = 0

  streamListener({
    type: 'current-failed',
    current: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    error: new Error('track ended'),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, [['clear'], ['show-setup']])

  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, [
    ['clear'],
    ['show-setup'],
    ['save', 'whep://stream-b'],
    ['activate', 'stream-b'],
    ['show-main'],
  ])
})

test('shows automatic access after current failure even if clearing config fails', async () => {
  const intervals = createIntervalHarness()
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {
      if (calls.some((call) => call[0] === 'activate')) {
        throw new Error('disk locked')
      }
    },
    saveConfig: async () => {},
    showMain: async () => {},
    showSetup: async () => { calls.push(['show-setup']) },
    streamManager: {
      subscribe(listener) {
        streamListener = listener
        return () => {}
      },
      prepare() {},
      activate(streamId) {
        calls.push(['activate', streamId])
        return true
      },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({
    type: 'candidate-ready',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
  })
  await new Promise((resolve) => setImmediate(resolve))
  streamListener({
    type: 'current-failed',
    current: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    error: new Error('track ended'),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some((call) => call[0] === 'show-setup'), true)
})

test('restarts automatic access without creating another interval', async () => {
  const intervals = createIntervalHarness()
  const discovered = ['stream-a', 'stream-b']
  const calls = []
  const streamManager = {
    subscribe() { return () => {} },
    prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    closeAll() { calls.push(['close-all']) },
  }
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear']) },
    saveConfig: async () => {},
    showSetup: async () => { calls.push(['show-setup']) },
    streamManager,
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  calls.length = 0
  await controller.restart()

  assert.deepEqual(calls, [
    ['close-all'],
    ['show-setup'],
    ['clear'],
    ['prepare', 'stream-b'],
  ])
  assert.equal(intervals.scheduled.length, 1)
})

test('aborts an in-flight round and starts a fresh round immediately on restart', async () => {
  const intervals = createIntervalHarness()
  const calls = []
  let discoveryCalls = 0
  const controller = createAutoConnectController({
    discoverActiveStream: ({ signal }) => {
      discoveryCalls += 1
      if (discoveryCalls === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            calls.push(['aborted'])
            reject(new Error('aborted'))
          }, { once: true })
        })
      }
      return Promise.resolve('stream-b')
    },
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear']) },
    saveConfig: async () => {},
    showSetup: async () => { calls.push(['show-setup']) },
    streamManager: {
      subscribe() { return () => {} },
      closeAll() { calls.push(['close-all']) },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  const startPromise = controller.start()
  await new Promise((resolve) => setImmediate(resolve))
  await controller.restart()
  await startPromise

  assert.equal(discoveryCalls, 2)
  assert.deepEqual(calls.slice(-5), [
    ['aborted'],
    ['close-all'],
    ['show-setup'],
    ['clear'],
    ['prepare', 'stream-b'],
  ])
})

test('preserves the current WHEP phase and countdown on same-candidate detection rounds', async () => {
  const intervals = createIntervalHarness()
  let streamListener
  const progress = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async () => {},
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare() {},
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: (snapshot) => progress.push(snapshot),
  })

  await controller.start()
  streamListener({
    type: 'candidate-connecting',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    deadlineAt: 11000,
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()

  assert.equal(progress.at(-1).phase, 'connecting')
  assert.equal(progress.at(-1).deadlineAt, 11000)

  streamListener({
    type: 'candidate-waiting-frame',
    candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    deadlineAt: 121000,
  })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()

  assert.equal(progress.at(-1).phase, 'waiting-frame')
  assert.equal(progress.at(-1).deadlineAt, 121000)
})

test('does not activate or retain a candidate whose save completes after restart', async () => {
  const intervals = createIntervalHarness()
  const replacementSave = createDeferred()
  const discovered = ['stream-a', 'stream-b', '']
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || '',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear']) },
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b') await replacementSave.promise
    },
    showMain: async () => {},
    showSetup: async () => { calls.push(['show-setup']) },
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
      activate(streamId) { calls.push(['activate', streamId]); return true },
      closeAll() { calls.push(['close-all']) },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' } })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' } })
  await new Promise((resolve) => setImmediate(resolve))

  const restartPromise = controller.restart()
  await new Promise((resolve) => setImmediate(resolve))
  replacementSave.resolve()
  await restartPromise
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some((call) => call[0] === 'activate' && call[1] === 'stream-b'), false)
  assert.deepEqual(calls.slice(-2), [['show-setup'], ['clear']])
})

test('serializes candidate commit ahead of a later failure from the old current stream', async () => {
  const intervals = createIntervalHarness()
  const replacementSave = createDeferred()
  const discovered = ['stream-a', 'stream-b']
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => { calls.push(['clear']) },
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b') await replacementSave.promise
    },
    showMain: async () => {},
    showSetup: async () => { calls.push(['show-setup']) },
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare() {},
      activate(streamId) { calls.push(['activate', streamId]); return true },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' } })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' } })
  streamListener({
    type: 'current-failed',
    current: { streamId: 'stream-a', whepUrl: 'whep://stream-a' },
    error: new Error('track ended'),
  })
  replacementSave.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some((call) => call[0] === 'activate' && call[1] === 'stream-b'), true)
  assert.equal(calls.some((call) => call[0] === 'show-setup'), false)
})

test('keeps an old candidate from activating after a newer probed ID starts committing', async () => {
  const intervals = createIntervalHarness()
  const newerSave = createDeferred()
  const discovered = ['stream-a', 'stream-b']
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-b',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b') await newerSave.promise
    },
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
      activate(streamId) { calls.push(['activate', streamId]); return true },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  const newerRound = intervals.scheduled[0].fn()
  await new Promise((resolve) => setImmediate(resolve))
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' } })
  newerSave.resolve()
  await newerRound
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some((call) => call[0] === 'activate' && call[1] === 'stream-a'), false)
  assert.equal(calls.some((call) => call[0] === 'prepare' && call[1] === 'stream-b'), true)
})

test('restores the current URL when discovery cancels a candidate during its save', async () => {
  const intervals = createIntervalHarness()
  const replacementSave = createDeferred()
  const discovered = ['stream-a', 'stream-b', 'stream-a']
  let streamListener
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b') await replacementSave.promise
    },
    showMain: async () => {},
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare(candidate) { calls.push(['prepare', candidate.streamId]) },
      activate(streamId) { calls.push(['activate', streamId]); return true },
      cancelCandidate() { calls.push(['cancel-candidate']) },
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' } })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' } })
  await new Promise((resolve) => setImmediate(resolve))

  const returnToCurrentRound = intervals.scheduled[0].fn()
  await new Promise((resolve) => setImmediate(resolve))
  replacementSave.resolve()
  await returnToCurrentRound
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some((call) => call[0] === 'activate' && call[1] === 'stream-b'), false)
  assert.equal(calls.some((call) => call[0] === 'cancel-candidate'), true)
  assert.deepEqual(calls.filter((call) => call[0] === 'save').at(-1), ['save', 'whep://stream-a'])
})

test('retries restoring the current URL after a canceled-candidate restore save fails', async () => {
  const intervals = createIntervalHarness()
  const replacementSave = createDeferred()
  const discovered = ['stream-a', 'stream-b', 'stream-a', 'stream-a']
  let streamListener
  let currentRestoreAttempts = 0
  const calls = []
  const controller = createAutoConnectController({
    discoverActiveStream: async () => discovered.shift() || 'stream-a',
    probeConnection: async () => true,
    buildWhepUrl: (streamId) => `whep://${streamId}`,
    clearConfig: async () => {},
    saveConfig: async (whepUrl) => {
      calls.push(['save', whepUrl])
      if (whepUrl === 'whep://stream-b') await replacementSave.promise
      if (whepUrl === 'whep://stream-a' && calls.some((call) => call[1] === 'whep://stream-b')) {
        currentRestoreAttempts += 1
        if (currentRestoreAttempts === 1) throw new Error('disk busy')
      }
    },
    showMain: async () => {},
    streamManager: {
      subscribe(listener) { streamListener = listener; return () => {} },
      prepare() {},
      activate() { return true },
      cancelCandidate() {},
    },
    setIntervalFn: intervals.setIntervalFn,
    clearIntervalFn: intervals.clearIntervalFn,
    onProgress: () => {},
  })

  await controller.start()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-a', whepUrl: 'whep://stream-a' } })
  await new Promise((resolve) => setImmediate(resolve))
  await intervals.scheduled[0].fn()
  streamListener({ type: 'candidate-ready', candidate: { streamId: 'stream-b', whepUrl: 'whep://stream-b' } })
  await new Promise((resolve) => setImmediate(resolve))

  const returnToCurrentRound = intervals.scheduled[0].fn()
  await new Promise((resolve) => setImmediate(resolve))
  replacementSave.resolve()
  await returnToCurrentRound
  await intervals.scheduled[0].fn()

  assert.equal(currentRestoreAttempts, 2)
  assert.deepEqual(calls.filter((call) => call[0] === 'save').at(-1), ['save', 'whep://stream-a'])
})
