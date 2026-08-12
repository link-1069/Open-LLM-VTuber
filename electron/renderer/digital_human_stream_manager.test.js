const test = require('node:test')
const assert = require('node:assert/strict')

const { createDigitalHumanStreamManager } = require('./digital_human_stream_manager')

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('marks a candidate ready only after video playback and one rendered frame', async () => {
  const events = []
  const stageOptions = []
  const controllerOptions = []
  const controllers = []
  const starts = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: (options) => {
      stageOptions.push(options)
      return { dispose() {} }
    },
    createStreamController: (options) => {
      controllerOptions.push(options)
      const controller = {
        close() {},
        start(whepUrl) {
          const deferred = createDeferred()
          starts.push({ whepUrl, deferred })
          return deferred.promise
        },
      }
      controllers.push(controller)
      return controller
    },
    now: () => 1000,
  })
  manager.subscribe((event) => events.push(event))

  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })
  assert.equal(starts[0].whepUrl, 'whep://stream-a')
  assert.equal(events[0].type, 'candidate-connecting')
  assert.equal(events[0].deadlineAt, 11000)

  controllerOptions[0].onConnected()
  assert.equal(events.at(-1).type, 'candidate-waiting-frame')
  assert.equal(events.at(-1).deadlineAt, 121000)

  starts[0].deferred.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(events.some((event) => event.type === 'candidate-ready'), false)

  stageOptions[0].onFrameRendered()
  assert.equal(events.at(-1).type, 'candidate-ready')

  assert.equal(manager.activate('stream-a'), true)
  assert.equal(slots[0].layer.hidden, false)
  assert.equal(slots[1].layer.hidden, true)
  assert.equal(events.at(-1).type, 'current-activated')
})

test('ignores frames rendered before the candidate playback becomes ready', async () => {
  const events = []
  const stageOptions = []
  const starts = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: (options) => {
      stageOptions.push(options)
      return { dispose() {} }
    },
    createStreamController: () => ({
      close() {},
      start() {
        const deferred = createDeferred()
        starts.push(deferred)
        return deferred.promise
      },
    }),
  })
  manager.subscribe((event) => events.push(event))

  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })
  stageOptions[0].onFrameRendered()
  starts[0].resolve()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(events.some((event) => event.type === 'candidate-ready'), false)

  stageOptions[0].onFrameRendered()
  assert.equal(events.at(-1).type, 'candidate-ready')
})

test('keeps a candidate running when the current stream fails', async () => {
  const events = []
  const stageOptions = []
  const controllerOptions = []
  const controllers = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: (options) => {
      stageOptions.push(options)
      return { dispose() {} }
    },
    createStreamController: (options) => {
      controllerOptions.push(options)
      const controller = {
        closed: false,
        close() { this.closed = true },
        async start() { this.closed = false },
      }
      controllers.push(controller)
      return controller
    },
    now: () => 1000,
  })
  manager.subscribe((event) => events.push(event))

  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })
  await new Promise((resolve) => setImmediate(resolve))
  stageOptions[0].onFrameRendered()
  manager.activate('stream-a')

  manager.prepare({ streamId: 'stream-b', whepUrl: 'whep://stream-b' })
  controllerOptions[0].onConnectionFailed({ error: new Error('track ended') })

  assert.equal(events.at(-1).type, 'current-failed')
  assert.equal(events.at(-1).current.streamId, 'stream-a')
  assert.equal(slots[0].layer.hidden, true)
  assert.equal(controllers[1].closed, false)

  await new Promise((resolve) => setImmediate(resolve))
  stageOptions[1].onFrameRendered()
  assert.equal(events.at(-1).type, 'candidate-ready')
  assert.equal(manager.activate('stream-b'), true)
  assert.equal(slots[1].layer.hidden, false)
})

test('closes every stream and ignores stale candidate completion', async () => {
  const events = []
  const stageOptions = []
  const controllers = []
  const starts = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: (options) => {
      stageOptions.push(options)
      return { dispose() {} }
    },
    createStreamController: () => {
      const controller = {
        closeCalls: 0,
        close() { this.closeCalls += 1 },
        start() {
          const deferred = createDeferred()
          starts.push(deferred)
          return deferred.promise
        },
      }
      controllers.push(controller)
      return controller
    },
  })
  manager.subscribe((event) => events.push(event))

  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })
  manager.closeAll()
  starts[0].resolve()
  stageOptions[0].onFrameRendered()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(controllers[0].closeCalls >= 1, true)
  assert.equal(controllers[1].closeCalls >= 1, true)
  assert.equal(slots[0].layer.hidden, true)
  assert.equal(slots[1].layer.hidden, true)
  assert.equal(events.some((event) => event.type === 'candidate-ready'), false)
})

test('closes a failed candidate controller before publishing failure', () => {
  const events = []
  const controllerOptions = []
  const controllers = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: () => ({ dispose() {} }),
    createStreamController: (options) => {
      controllerOptions.push(options)
      const controller = {
        closeCalls: 0,
        close() { this.closeCalls += 1 },
        start() { return new Promise(() => {}) },
      }
      controllers.push(controller)
      return controller
    },
  })
  manager.subscribe((event) => events.push(event))
  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })

  const closesBeforeFailure = controllers[0].closeCalls
  controllerOptions[0].onConnectionFailed({ error: new Error('play failed') })

  assert.equal(controllers[0].closeCalls, closesBeforeFailure + 1)
  assert.equal(events.at(-1).type, 'candidate-failed')
})

test('fails a candidate when Three.js does not render its first frame within two minutes', () => {
  const events = []
  const controllerOptions = []
  const timers = []
  const controllers = []
  const slots = [0, 1].map(() => ({
    video: {},
    mount: {},
    layer: { hidden: true },
  }))
  const manager = createDigitalHumanStreamManager({
    slots,
    createStage: () => ({ dispose() {} }),
    createStreamController: (options) => {
      controllerOptions.push(options)
      const controller = {
        closeCalls: 0,
        close() { this.closeCalls += 1 },
        start() { return new Promise(() => {}) },
      }
      controllers.push(controller)
      return controller
    },
    setTimeoutFn(fn, delay) {
      const timer = { fn, delay }
      timers.push(timer)
      return timer
    },
    clearTimeoutFn() {},
  })
  manager.subscribe((event) => events.push(event))
  manager.prepare({ streamId: 'stream-a', whepUrl: 'whep://stream-a' })

  controllerOptions[0].onConnected()

  assert.equal(timers.at(-1).delay, 120000)
  timers.at(-1).fn()
  assert.equal(events.at(-1).type, 'candidate-failed')
  assert.match(events.at(-1).error.message, /first frame/i)
  assert.equal(controllers[0].closeCalls >= 2, true)
})
