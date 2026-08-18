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

test('mutes video audio before binding SDK stream', async () => {
  const timers = createTimers()
  const stream = { id: 'muted-stream' }

  class FakeSdk {
    constructor() {
      this.stream = stream
    }

    async play() {
      return { sessionid: 'muted-session' }
    }

    close() {}
  }

  const video = {
    muted: false,
    volume: 1,
    async play() {},
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

  assert.equal(video.muted, true)
  assert.equal(video.volume, 0)
  assert.equal(video.srcObject, stream)
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

test('notifies connection failure when WHEP play fails', async () => {
  const timers = createTimers()
  const failures = []

  class FailingSdk {
    constructor() {
      this.stream = { id: 'failed-stream' }
    }

    async play() {
      throw new Error('play failed')
    }

    close() {}
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => FailingSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onConnectionFailed: ({ whepUrl, error }) => {
      failures.push({ whepUrl, message: error.message })
    },
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.deepEqual(failures, [
    {
      whepUrl: 'http://example.test/rtc/v1/whep/?app=live&stream=a',
      message: 'play failed',
    },
  ])
})

test('notifies connection failure when WHEP play times out', async () => {
  const timers = createTimers()
  const failures = []
  const instances = []

  class HangingSdk {
    constructor() {
      this.stream = { id: 'hanging-stream' }
      this.closed = false
      instances.push(this)
    }

    play() {
      return new Promise(() => {})
    }

    close() {
      this.closed = true
    }
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => HangingSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    playTimeoutMs: 1000,
    onConnectionFailed: ({ whepUrl, error }) => {
      failures.push({ whepUrl, message: error.message })
    },
  })

  const startPromise = controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 1000)

  timers.scheduled[0].fn()
  await startPromise

  assert.equal(instances[0].closed, true)
  assert.deepEqual(failures, [
    {
      whepUrl: 'http://example.test/rtc/v1/whep/?app=live&stream=a',
      message: 'SRS stream play timed out after 1000 ms',
    },
  ])
  assert.equal(timers.scheduled.at(-1).delay, 5000)
})

test('notifies connection failure when video never becomes ready', async () => {
  const timers = createTimers()
  const failures = []
  const instances = []

  class SilentVideoSdk {
    constructor() {
      this.stream = { id: 'silent-video-stream' }
      this.closed = false
      instances.push(this)
    }

    async play() {
      return { sessionid: 'silent-video-session' }
    }

    close() {
      this.closed = true
    }
  }

  const video = {
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    play: async () => {},
  }
  const controller = createSrsStreamController({
    video,
    showStatus: () => {},
    getSdkCtor: () => SilentVideoSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    mediaReadyTimeoutMs: 1000,
    onConnectionFailed: ({ whepUrl, error }) => {
      failures.push({ whepUrl, message: error.message })
    },
  })

  const startPromise = controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 1000)

  timers.scheduled[0].fn()
  await startPromise

  assert.equal(instances[0].closed, true)
  assert.deepEqual(failures, [
    {
      whepUrl: 'http://example.test/rtc/v1/whep/?app=live&stream=a',
      message: 'SRS stream video did not become ready after 1000 ms',
    },
  ])
  assert.equal(timers.scheduled.at(-1).delay, 5000)
})

test('notifies connection failure when video playback never settles', async () => {
  const timers = createTimers()
  const failures = []
  const instances = []

  class PendingVideoSdk {
    constructor() {
      this.stream = { id: 'pending-video-stream' }
      this.closed = false
      instances.push(this)
    }

    async play() {
      return { sessionid: 'pending-video-session' }
    }

    close() {
      this.closed = true
    }
  }

  const video = {
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    play: () => new Promise(() => {}),
  }
  const controller = createSrsStreamController({
    video,
    showStatus: () => {},
    getSdkCtor: () => PendingVideoSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    mediaReadyTimeoutMs: 1000,
    onConnectionFailed: ({ whepUrl, error }) => {
      failures.push({ whepUrl, message: error.message })
    },
  })

  const startPromise = controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 1000)

  timers.scheduled[0].fn()
  await startPromise

  assert.equal(instances[0].closed, true)
  assert.deepEqual(failures, [
    {
      whepUrl: 'http://example.test/rtc/v1/whep/?app=live&stream=a',
      message: 'SRS stream video did not become ready after 1000 ms',
    },
  ])
  assert.equal(timers.scheduled.at(-1).delay, 5000)
})

test('retries when an established peer connection fails later', async () => {
  const timers = createTimers()
  const instances = []
  const failures = []

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
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  instances[0].pc.connectionState = 'failed'
  instances[0].pc.onconnectionstatechange()

  assert.equal(instances[0].closed, true)
  assert.match(failures[0], /pc=failed/)
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})

test('waits three seconds before reporting a persistent disconnected state', async () => {
  const timers = createTimers()
  const failures = []
  let instance

  class DisconnectingSdk {
    constructor() {
      this.stream = { getTracks: () => [] }
      this.pc = {
        connectionState: 'connected',
        iceConnectionState: 'connected',
      }
      instance = this
    }

    async play() { return { sessionid: 'session-a' } }
    close() {}
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => DisconnectingSdk,
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    disconnectGraceMs: 3000,
    autoRetry: false,
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  instance.pc.connectionState = 'disconnected'
  instance.pc.onconnectionstatechange()

  assert.equal(failures.length, 0)
  assert.equal(timers.scheduled.at(-1).delay, 3000)

  timers.scheduled.at(-1).fn()

  assert.match(failures[0], /pc=disconnected/)
})

test('reports an ended media track immediately', async () => {
  const failures = []
  let endTrack

  class TrackEndingSdk {
    constructor() {
      this.stream = {
        getTracks: () => [{
          addEventListener(event, callback) {
            if (event === 'ended') endTrack = callback
          },
        }],
      }
    }

    async play() { return { sessionid: 'session-a' } }
    close() {}
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => TrackEndingSdk,
    logger: { log() {}, warn() {}, error() {} },
    autoRetry: false,
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  endTrack()

  assert.deepEqual(failures, ['track ended'])
})

test('reports a media track that arrives after WHEP setup ending immediately', async () => {
  const failures = []
  let endTrack
  let instance

  class LateTrackSdk {
    constructor() {
      this.stream = { getTracks: () => [] }
      this.pc = {
        connectionState: 'connected',
        iceConnectionState: 'connected',
        addEventListener(event, callback) {
          if (event === 'track') this.onLateTrack = callback
        },
      }
      instance = this
    }

    async play() {
      this.pc.onLateTrack({
        track: {
          addEventListener(event, callback) {
            if (event === 'ended') endTrack = callback
          },
        },
      })
      return { sessionid: 'session-with-late-track' }
    }

    close() {}
  }

  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => LateTrackSdk,
    logger: { log() {}, warn() {}, error() {} },
    autoRetry: false,
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')
  assert.equal(typeof instance.pc.onLateTrack, 'function')
  assert.equal(typeof endTrack, 'function')

  endTrack()

  assert.deepEqual(failures, ['track ended'])
})

test('handles SDK constructor errors by reporting status and scheduling retry', async () => {
  const timers = createTimers()
  const messages = []
  const errors = []
  const failures = []

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
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await assert.doesNotReject(() => controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a'))

  assert.deepEqual(messages, ['SRS stream initialization failed'])
  assert.deepEqual(errors, [['SRS stream initialization failed:', 'constructor failed']])
  assert.deepEqual(failures, ['constructor failed'])
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 5000)
})

test('reports a connection failure when the SRS SDK is unavailable', async () => {
  const failures = []
  const controller = createSrsStreamController({
    video: { play: async () => {} },
    showStatus: () => {},
    getSdkCtor: () => undefined,
    logger: { log() {}, warn() {}, error() {} },
    autoRetry: false,
    onConnectionFailed: ({ error }) => failures.push(error.message),
  })

  await controller.start('http://example.test/rtc/v1/whep/?app=live&stream=a')

  assert.deepEqual(failures, ['SRS SDK is not available'])
})
