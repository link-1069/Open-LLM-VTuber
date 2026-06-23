(function (root, factory) {
  const api = factory(root)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createSrsStreamController = api.createSrsStreamController
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
  'use strict'

  function createSrsStreamController(options) {
    const video = options.video
    const showStatus = options.showStatus || function () {}
    const getSdkCtor = options.getSdkCtor || function () { return root.SrsRtcWhipWhepAsync }
    const setTimeoutFn = options.setTimeoutFn || root.setTimeout.bind(root)
    const clearTimeoutFn = options.clearTimeoutFn || root.clearTimeout.bind(root)
    const retryDelayMs = options.retryDelayMs || 5000
    const logger = options.logger || root.console || { log() {}, warn() {}, error() {} }

    let sdk = null
    let retryTimer = null
    let currentWhepUrl = null
    let attemptId = 0

    function clearRetryTimer() {
      if (retryTimer) {
        clearTimeoutFn(retryTimer)
        retryTimer = null
      }
    }

    function closeSdk() {
      if (!sdk) {
        return
      }
      try {
        sdk.close()
      } catch (error) {
        logger.warn('Failed to close SRS SDK:', error)
      }
      sdk = null
      if (video) {
        video.srcObject = null
      }
    }

    function scheduleRetry(whepUrl, scheduledAttemptId) {
      if (retryTimer) {
        return
      }
      retryTimer = setTimeoutFn(function () {
        retryTimer = null
        if (scheduledAttemptId === attemptId && currentWhepUrl === whepUrl) {
          start(whepUrl, true)
        }
      }, retryDelayMs)
    }

    function handleStreamDisconnected(whepUrl, activeAttemptId, reason) {
      if (activeAttemptId !== attemptId || currentWhepUrl !== whepUrl) {
        return
      }
      logger.warn('SRS stream disconnected:', reason)
      closeSdk()
      scheduleRetry(whepUrl, activeAttemptId)
    }

    function attachDisconnectHandlers(activeSdk, whepUrl, activeAttemptId) {
      const pc = activeSdk && activeSdk.pc
      const retryStates = ['failed', 'disconnected', 'closed']
      const onConnectionStateChange = function () {
        if (!pc) {
          return
        }
        if (retryStates.includes(pc.connectionState) || retryStates.includes(pc.iceConnectionState)) {
          handleStreamDisconnected(whepUrl, activeAttemptId, `pc=${pc.connectionState || 'unknown'}, ice=${pc.iceConnectionState || 'unknown'}`)
        }
      }

      if (pc) {
        pc.onconnectionstatechange = onConnectionStateChange
        pc.oniceconnectionstatechange = onConnectionStateChange
      }

      if (!activeSdk.stream || typeof activeSdk.stream.getTracks !== 'function') {
        return
      }
      activeSdk.stream.getTracks().forEach(function (track) {
        const onEnded = function () {
          handleStreamDisconnected(whepUrl, activeAttemptId, 'track ended')
        }
        if (typeof track.addEventListener === 'function') {
          track.addEventListener('ended', onEnded, { once: true })
        } else {
          track.onended = onEnded
        }
      })
    }

    async function start(whepUrl, forceRestart = false) {
      if (!whepUrl) {
        return
      }
      if (!forceRestart && currentWhepUrl === whepUrl && sdk) {
        return
      }

      clearRetryTimer()
      currentWhepUrl = whepUrl
      const thisAttemptId = ++attemptId
      closeSdk()

      try {
        const SrsRtcWhipWhepAsync = getSdkCtor()
        if (typeof SrsRtcWhipWhepAsync !== 'function') {
          showStatus('SRS SDK is not available')
          scheduleRetry(whepUrl, thisAttemptId)
          return
        }

        sdk = new SrsRtcWhipWhepAsync()
        attachDisconnectHandlers(sdk, whepUrl, thisAttemptId)
        if (video) {
          video.srcObject = sdk.stream
        }
      } catch (error) {
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.error('SRS stream initialization failed:', error)
        showStatus('SRS stream initialization failed')
        closeSdk()
        scheduleRetry(whepUrl, thisAttemptId)
        return
      }

      try {
        const session = await sdk.play(whepUrl)
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.log('SRS session:', session && session.sessionid)
        if (video && typeof video.play === 'function') {
          await video.play()
        }
      } catch (error) {
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.error('SRS stream error:', error)
        closeSdk()
        scheduleRetry(whepUrl, thisAttemptId)
      }
    }

    function close() {
      clearRetryTimer()
      attemptId += 1
      currentWhepUrl = null
      closeSdk()
    }

    return {
      start,
      close,
    }
  }

  return {
    createSrsStreamController,
  }
})
