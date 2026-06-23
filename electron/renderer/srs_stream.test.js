const test = require('node:test')
const assert = require('node:assert/strict')

const { createSrsStreamController } = require('./srs_stream')

function createTimers() {
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

test('reports missing SRS SDK and schedules retry', async () => {
  const timers = createTimers()
  const messages = []
  const controller = createSrsStreamController({
    video: {},
    showStatus: (message) => messages.push(message),
    getSdkCtor: () => undefined,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.deepEqual(messages, ['SRS SDK is not available'])
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})

test('binds SDK stream to video and starts playback', async () => {
  const timers = createTimers()
  const stream = { id: 'stream-1' }
  let playedUrl = ''
  let videoPlayCalled = false

  class FakeSdk {
    constructor() {
      this.stream = stream
    }

    async play(url) {
      playedUrl = url
      return { sessionid: 'session-1' }
    }

    close() {}
  }

  const video = {
    async play() {
      videoPlayCalled = true
    },
  }
  const controller = createSrsStreamController({
    video,
    showStatus: () => {},
    getSdkCtor: () => FakeSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.equal(video.srcObject, stream)
  assert.equal(playedUrl, 'http://example.test/rtc/v1/whep/?app=live&stream=a')
  assert.equal(videoPlayCalled, true)
  assert.equal(timers.scheduled.length, 0)
})

test('closes failed SDK and schedules retry', async () => {
  const timers = createTimers()
  const instances = []

  class FailingSdk {
    constructor() {
      this.stream = { id: 'failed-stream' }
      this.closed = false
      instances.push(this)
    }

    async play() {
      throw new Error('play failed')
    }

    close() {
      this.closed = true
    }
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => FailingSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.equal(instances.length, 1)
  assert.equal(instances[0].closed, true)
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})

test('retries when an established peer connection fails later', async () => {
  const timers = createTimers()
  const instances = []

  class DisconnectingSdk {
    constructor() {
      this.stream = { id: 'stream-with-pc' }
      this.closed = false
      this.pc = {
        connectionState: 'connected',
        iceConnectionState: 'connected',
      }
      instances.push(this)
    }

    async play() {
      return { sessionid: 'session-with-pc' }
    }

    close() {
      this.closed = true
    }
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => DisconnectingSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  instances[0].pc.connectionState = 'failed'
  instances[0].pc.onconnectionstatechange()

  assert.equal(instances[0].closed, true)
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})

test('handles SDK constructor errors by reporting status and scheduling retry', async () => {
  const timers = createTimers()
  const messages = []
  const errors = []

  class ThrowingSdk {
    constructor() {
      throw new Error('constructor failed')
    }
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: (message) => messages.push(message),
    getSdkCtor: () => ThrowingSdk,
    logger: { log() {}, warn() {}, error(message, error) { errors.push([message, error.message]) } },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  await assert.doesNotReject(() => controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a'))

  assert.deepEqual(messages, ['SRS stream initialization failed'])
  assert.deepEqual(errors, [['SRS stream initialization failed:', 'constructor failed']])
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})
