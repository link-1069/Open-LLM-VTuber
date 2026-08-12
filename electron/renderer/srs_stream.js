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
    const playTimeoutMs = Number.isFinite(options.playTimeoutMs) && options.playTimeoutMs > 0
      ? options.playTimeoutMs
      : 0
    const mediaReadyTimeoutMs = Number.isFinite(options.mediaReadyTimeoutMs) && options.mediaReadyTimeoutMs > 0
      ? options.mediaReadyTimeoutMs
      : 0
    const disconnectGraceMs = Number.isFinite(options.disconnectGraceMs) && options.disconnectGraceMs > 0
      ? options.disconnectGraceMs
      : 0
    const autoRetry = options.autoRetry !== false
    const onConnected = options.onConnected || function () {}
    const onConnectionFailed = options.onConnectionFailed || function () {}
    const logger = options.logger || root.console || { log() {}, warn() {}, error() {} }

    let sdk = null
    let retryTimer = null
    let currentWhepUrl = null
    let attemptId = 0
    let disconnectTimer = null

    function clearDisconnectTimer() {
      if (!disconnectTimer) {
        return
      }
      clearTimeoutFn(disconnectTimer)
      disconnectTimer = null
    }

    function clearRetryTimer() {
      if (retryTimer) {
        clearTimeoutFn(retryTimer)
        retryTimer = null
      }
    }

    function closeSdk() {
      clearDisconnectTimer()
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

    function muteVideoAudio() {
      if (!video) {
        return
      }
      video.muted = true
      video.volume = 0
    }

    function scheduleRetry(whepUrl, scheduledAttemptId) {
      if (!autoRetry) {
        return
      }
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
      notifyConnectionFailed(whepUrl, new Error(reason))
      closeSdk()
      scheduleRetry(whepUrl, activeAttemptId)
    }

    function notifyConnectionFailed(whepUrl, error) {
      try {
        onConnectionFailed({ whepUrl, error })
      } catch (callbackError) {
        logger.warn('SRS connection failure handler failed:', callbackError)
      }
    }

    function playWithTimeout(activeSdk, whepUrl) {
      const playPromise = activeSdk.play(whepUrl)
      if (!playTimeoutMs) {
        return playPromise
      }

      let timeoutHandle = null
      const timeoutPromise = new Promise(function (_, reject) {
        timeoutHandle = setTimeoutFn(function () {
          reject(new Error(`SRS stream play timed out after ${playTimeoutMs} ms`))
        }, playTimeoutMs)
      })

      return Promise.race([playPromise, timeoutPromise]).finally(function () {
        if (timeoutHandle) {
          clearTimeoutFn(timeoutHandle)
        }
      })
    }

    function isVideoReady() {
      if (!video) {
        return true
      }
      const readyState = typeof video.readyState === 'number' ? video.readyState : 0
      const videoWidth = typeof video.videoWidth === 'number' ? video.videoWidth : 0
      const videoHeight = typeof video.videoHeight === 'number' ? video.videoHeight : 0
      return readyState >= 2 && videoWidth > 0 && videoHeight > 0
    }

    function waitForVideoPlayback() {
      if (!video) {
        return Promise.resolve()
      }
      if (!mediaReadyTimeoutMs) {
        return typeof video.play === 'function' ? video.play() : Promise.resolve()
      }

      return new Promise(function (resolve, reject) {
        let settled = false
        let timeoutHandle = null

        function settle(error) {
          if (settled) {
            return
          }
          settled = true
          if (timeoutHandle) {
            clearTimeoutFn(timeoutHandle)
            timeoutHandle = null
          }
          if (video && typeof video.removeEventListener === 'function') {
            video.removeEventListener('loadeddata', onMaybeReady)
            video.removeEventListener('canplay', onMaybeReady)
            video.removeEventListener('playing', onMaybeReady)
            video.removeEventListener('resize', onMaybeReady)
          }
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        }

        function onMaybeReady() {
          if (!settled && isVideoReady()) {
            settle()
          }
        }

        timeoutHandle = setTimeoutFn(function () {
          settle(new Error(`SRS stream video did not become ready after ${mediaReadyTimeoutMs} ms`))
        }, mediaReadyTimeoutMs)

        if (video && typeof video.addEventListener === 'function') {
          video.addEventListener('loadeddata', onMaybeReady)
          video.addEventListener('canplay', onMaybeReady)
          video.addEventListener('playing', onMaybeReady)
          video.addEventListener('resize', onMaybeReady)
        }

        try {
          const playResult = typeof video.play === 'function' ? video.play() : null
          if (playResult && typeof playResult.then === 'function') {
            playResult.then(onMaybeReady, settle)
          } else {
            onMaybeReady()
          }
        } catch (error) {
          settle(error)
        }

        onMaybeReady()
      })
    }

    function attachDisconnectHandlers(activeSdk, whepUrl, activeAttemptId) {
      const pc = activeSdk && activeSdk.pc
      const onConnectionStateChange = function () {
        if (!pc) {
          return
        }
        const states = [pc.connectionState, pc.iceConnectionState]
        if (states.includes('failed') || states.includes('closed')) {
          clearDisconnectTimer()
          handleStreamDisconnected(whepUrl, activeAttemptId, `pc=${pc.connectionState || 'unknown'}, ice=${pc.iceConnectionState || 'unknown'}`)
          return
        }
        if (states.includes('disconnected')) {
          if (!disconnectGraceMs) {
            handleStreamDisconnected(whepUrl, activeAttemptId, `pc=${pc.connectionState || 'unknown'}, ice=${pc.iceConnectionState || 'unknown'}`)
            return
          }
          if (!disconnectTimer) {
            disconnectTimer = setTimeoutFn(function () {
              disconnectTimer = null
              const latestStates = [pc.connectionState, pc.iceConnectionState]
              if (latestStates.includes('disconnected')) {
                handleStreamDisconnected(whepUrl, activeAttemptId, `pc=${pc.connectionState || 'unknown'}, ice=${pc.iceConnectionState || 'unknown'}`)
              }
            }, disconnectGraceMs)
          }
          return
        }
        clearDisconnectTimer()
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
          const error = new Error('SRS SDK is not available')
          showStatus(error.message)
          notifyConnectionFailed(whepUrl, error)
          scheduleRetry(whepUrl, thisAttemptId)
          return
        }

        sdk = new SrsRtcWhipWhepAsync()
        attachDisconnectHandlers(sdk, whepUrl, thisAttemptId)
        if (video) {
          muteVideoAudio()
          video.srcObject = sdk.stream
        }
      } catch (error) {
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.error('SRS stream initialization failed:', error)
        showStatus('SRS stream initialization failed')
        notifyConnectionFailed(whepUrl, error)
        closeSdk()
        scheduleRetry(whepUrl, thisAttemptId)
        return
      }

      try {
        const session = await playWithTimeout(sdk, whepUrl)
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.log('SRS session:', session && session.sessionid)
        onConnected({ whepUrl, session })
        await waitForVideoPlayback()
      } catch (error) {
        if (thisAttemptId !== attemptId) {
          return
        }
        logger.error('SRS stream error:', error)
        notifyConnectionFailed(whepUrl, error)
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
