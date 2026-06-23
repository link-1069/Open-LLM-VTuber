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

      const SrsRtcWhipWhepAsync = getSdkCtor()
      if (typeof SrsRtcWhipWhepAsync !== 'function') {
        showStatus('SRS SDK is not available')
        scheduleRetry(whepUrl, thisAttemptId)
        return
      }

      sdk = new SrsRtcWhipWhepAsync()
      if (video) {
        video.srcObject = sdk.stream
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
