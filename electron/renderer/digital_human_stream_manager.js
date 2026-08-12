(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createDigitalHumanStreamManager = api.createDigitalHumanStreamManager
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict'

  function createDigitalHumanStreamManager(options) {
    const createStage = options.createStage
    const createStreamController = options.createStreamController
    const now = options.now || Date.now
    const connectTimeoutMs = options.connectTimeoutMs || 10000
    const frameTimeoutMs = options.frameTimeoutMs || 120000
    const setTimeoutFn = options.setTimeoutFn || setTimeout
    const clearTimeoutFn = options.clearTimeoutFn || clearTimeout
    const listeners = new Set()
    let currentIndex = null
    let candidateIndex = null

    function publish(event) {
      listeners.forEach((listener) => listener(event))
    }

    function maybePublishReady(state) {
      if (
        candidateIndex !== state.index ||
        !state.item ||
        !state.playbackReady ||
        !state.frameRendered ||
        state.readyPublished
      ) {
        return
      }
      clearFrameTimer(state)
      state.readyPublished = true
      publish({ type: 'candidate-ready', candidate: state.item })
    }

    function handleConnected(state) {
      if (candidateIndex !== state.index || !state.item) {
        return
      }
      clearFrameTimer(state)
      state.frameTimer = setTimeoutFn(() => {
        state.frameTimer = null
        if (candidateIndex === state.index && state.item && !state.readyPublished) {
          handleConnectionFailed(state, new Error(`Three.js first frame timed out after ${frameTimeoutMs} ms`))
        }
      }, frameTimeoutMs)
      publish({
        type: 'candidate-waiting-frame',
        candidate: state.item,
        deadlineAt: now() + frameTimeoutMs,
      })
    }

    function clearFrameTimer(state) {
      if (!state.frameTimer) {
        return
      }
      clearTimeoutFn(state.frameTimer)
      state.frameTimer = null
    }

    function handleFrameRendered(state) {
      if (candidateIndex !== state.index || !state.item || !state.playbackReady) {
        return
      }
      state.frameRendered = true
      maybePublishReady(state)
    }

    function handleConnectionFailed(state, failure) {
      if (currentIndex === state.index && state.item) {
        const current = state.item
        currentIndex = null
        closeState(state)
        publish({
          type: 'current-failed',
          current,
          error: failure?.error || failure,
        })
        return
      }
      if (candidateIndex !== state.index || !state.item) {
        return
      }
      const candidate = state.item
      candidateIndex = null
      closeState(state)
      publish({
        type: 'candidate-failed',
        candidate,
        error: failure?.error || failure,
      })
    }

    const states = options.slots.map((slot, index) => {
      const state = {
        index,
        slot,
        item: null,
        attempt: 0,
        playbackReady: false,
        frameRendered: false,
        readyPublished: false,
        frameTimer: null,
        controller: null,
        stage: null,
      }
      state.stage = createStage({
        video: slot.video,
        mount: slot.mount,
        onFrameRendered: () => handleFrameRendered(state),
      })
      state.controller = createStreamController({
        video: slot.video,
        playTimeoutMs: connectTimeoutMs,
        mediaReadyTimeoutMs: frameTimeoutMs,
        disconnectGraceMs: options.disconnectGraceMs || 3000,
        autoRetry: false,
        onConnected: () => handleConnected(state),
        onConnectionFailed: (failure) => handleConnectionFailed(state, failure),
      })
      slot.layer.hidden = true
      return state
    })

    function closeState(state) {
      state.attempt += 1
      clearFrameTimer(state)
      state.controller.close()
      state.item = null
      state.playbackReady = false
      state.frameRendered = false
      state.readyPublished = false
      state.slot.layer.hidden = true
    }

    function cancelCandidate() {
      if (candidateIndex === null) {
        return
      }
      const state = states[candidateIndex]
      closeState(state)
      candidateIndex = null
    }

    function closeAll() {
      currentIndex = null
      candidateIndex = null
      states.forEach(closeState)
    }

    function dispose() {
      closeAll()
      states.forEach((state) => state.stage.dispose())
      listeners.clear()
    }

    function prepare(candidate) {
      cancelCandidate()
      const nextIndex = currentIndex === 0 ? 1 : 0
      const state = states[nextIndex]
      closeState(state)
      candidateIndex = nextIndex
      state.item = candidate
      state.playbackReady = false
      state.frameRendered = false
      state.readyPublished = false
      const attempt = ++state.attempt

      publish({
        type: 'candidate-connecting',
        candidate,
        deadlineAt: now() + connectTimeoutMs,
      })

      let startResult
      try {
        startResult = state.controller.start(candidate.whepUrl)
      } catch (error) {
        handleConnectionFailed(state, { error })
        return
      }

      Promise.resolve(startResult)
        .then(
          () => {
            if (candidateIndex !== state.index || state.attempt !== attempt) {
              return
            }
            state.playbackReady = true
            maybePublishReady(state)
          },
          (error) => {
            if (candidateIndex !== state.index || state.attempt !== attempt) {
              return
            }
            handleConnectionFailed(state, { error })
          }
        )
    }

    function activate(streamId) {
      if (candidateIndex === null) {
        return false
      }
      const state = states[candidateIndex]
      if (!state.item || state.item.streamId !== streamId || !state.readyPublished) {
        return false
      }

      if (currentIndex !== null && currentIndex !== candidateIndex) {
        closeState(states[currentIndex])
      }
      currentIndex = candidateIndex
      candidateIndex = null
      state.slot.layer.hidden = false
      publish({ type: 'current-activated', current: state.item })
      return true
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    return {
      prepare,
      activate,
      cancelCandidate,
      closeAll,
      dispose,
      subscribe,
    }
  }

  return {
    createDigitalHumanStreamManager,
  }
})
