(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.createAutoConnectController = api.createAutoConnectController
  root.AUTO_CONNECT_PHASES = api.AUTO_CONNECT_PHASES
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict'

  const AUTO_CONNECT_PHASES = Object.freeze({
    ACTIVE: 'active',
    CLEAR_ERROR: 'clear-error',
    CONNECTING: 'connecting',
    COOLDOWN: 'cooldown',
    DISCOVERING: 'discovering',
    PROBING: 'probing',
    RETRYING: 'retrying',
    SAVING: 'saving',
    WAITING_FRAME: 'waiting-frame',
  })

  function createAutoConnectController(options) {
    const discoverActiveStream = options.discoverActiveStream
    const probeConnection = options.probeConnection
    const buildWhepUrl = options.buildWhepUrl
    const clearConfig = options.clearConfig
    const saveConfig = options.saveConfig
    const streamManager = options.streamManager
    const showMain = options.showMain || async function () {}
    const showSetup = options.showSetup || async function () {}
    const onProgress = options.onProgress || function () {}
    const setIntervalFn = options.setIntervalFn || setInterval
    const clearIntervalFn = options.clearIntervalFn || clearInterval
    const setTimeoutFn = options.setTimeoutFn || setTimeout
    const clearTimeoutFn = options.clearTimeoutFn || clearTimeout
    const requestTimeoutMs = options.requestTimeoutMs || 3000
    const now = options.now || Date.now
    const cooldownMs = options.cooldownMs || 5000

    let running = false
    let roundInFlight = false
    let round = 0
    let intervalHandle = null
    let unsubscribeStream = null
    let candidate = null
    let current = null
    let readyCandidate = null
    let commitPromise = null
    let mainVisible = false
    let runGeneration = 0
    let stateQueue = Promise.resolve()
    let pendingCurrentUrlRestore = null
    let configPersistenceError = ''
    const activeRequests = new Map()
    const cooldowns = new Map()

    function report(progress) {
      const errorMessages = [configPersistenceError, progress.error]
        .filter(Boolean)
        .filter((message, index, messages) => messages.indexOf(message) === index)
      const enriched = { ...progress }
      if (errorMessages.length > 0) {
        enriched.error = errorMessages.join('；')
      } else {
        delete enriched.error
      }
      const normalized = enriched.phase === AUTO_CONNECT_PHASES.RETRYING && !enriched.deadlineAt
        ? { ...enriched, deadlineAt: now() + 1000 }
        : enriched
      onProgress({ round, ...normalized })
    }

    async function clearSavedConfig() {
      try {
        await clearConfig()
        configPersistenceError = ''
        return true
      } catch (error) {
        configPersistenceError = `旧配置清除失败：${error?.message || String(error)}`
        report({
          phase: AUTO_CONNECT_PHASES.CLEAR_ERROR,
          error: configPersistenceError,
        })
        return false
      }
    }

    async function persistSavedConfig(whepUrl, generation = runGeneration) {
      await saveConfig(whepUrl)
      if (generation === runGeneration) {
        configPersistenceError = ''
      }
    }

    async function showSetupContinuing() {
      try {
        await showSetup()
      } catch (error) {
        report({
          phase: AUTO_CONNECT_PHASES.RETRYING,
          error: error?.message || String(error),
        })
      }
    }

    function requestWithTimeout(label, request, generation) {
      const abortController = typeof AbortController === 'function'
        ? new AbortController()
        : null
      if (abortController) {
        activeRequests.set(generation, abortController)
      }

      return new Promise((resolve, reject) => {
        let settled = false
        const timeoutHandle = setTimeoutFn(() => {
          if (settled) {
            return
          }
          settled = true
          if (abortController) {
            abortController.abort()
          }
          if (activeRequests.get(generation) === abortController) {
            activeRequests.delete(generation)
          }
          reject(new Error(`${label}超过 ${requestTimeoutMs / 1000} 秒`))
        }, requestTimeoutMs)

        Promise.resolve()
          .then(() => request({ signal: abortController?.signal }))
          .then(
            (value) => {
              if (settled) {
                return
              }
              settled = true
              if (activeRequests.get(generation) === abortController) {
                activeRequests.delete(generation)
              }
              clearTimeoutFn(timeoutHandle)
              resolve(value)
            },
            (error) => {
              if (settled) {
                return
              }
              settled = true
              if (activeRequests.get(generation) === abortController) {
                activeRequests.delete(generation)
              }
              clearTimeoutFn(timeoutHandle)
              reject(error)
            }
          )
      })
    }

    function abortGeneration(generation) {
      const abortController = activeRequests.get(generation)
      activeRequests.delete(generation)
      abortController?.abort()
    }

    function enqueueStateOperation(operation) {
      const result = stateQueue.then(operation)
      stateQueue = result.catch(() => {})
      return result
    }

    function resetStreamState() {
      current = null
      candidate = null
      readyCandidate = null
      mainVisible = false
      pendingCurrentUrlRestore = null
    }

    async function restoreCurrentUrlIfNeeded(streamId) {
      if (!pendingCurrentUrlRestore || pendingCurrentUrlRestore.streamId !== streamId) {
        return
      }
      const target = pendingCurrentUrlRestore
      await persistSavedConfig(target.whepUrl)
      if (pendingCurrentUrlRestore === target) {
        pendingCurrentUrlRestore = null
      }
    }

    async function runDetectionRound() {
      if (!running || roundInFlight) {
        return
      }

      roundInFlight = true
      const generation = runGeneration
      round += 1
      const retainedStreamId = current?.streamId || candidate?.streamId || ''
      try {
        report({ phase: AUTO_CONNECT_PHASES.DISCOVERING, streamId: retainedStreamId })
        const streamId = await requestWithTimeout(
          '获取活动流 ID',
          ({ signal }) => discoverActiveStream({ signal }),
          generation
        )
        if (!running || generation !== runGeneration) {
          return
        }
        if (!streamId) {
          report({ phase: AUTO_CONNECT_PHASES.RETRYING, streamId: retainedStreamId, error: '未发现活动流 ID' })
          return
        }

        if (current?.streamId === streamId) {
          const candidateToCancel = candidate
          const currentToKeep = current
          if (candidateToCancel) {
            candidateToCancel.cancelRequested = true
          }
          await enqueueStateOperation(async () => {
            if (candidateToCancel && candidate?.streamId === candidateToCancel.streamId) {
              streamManager.cancelCandidate()
              candidate = null
              readyCandidate = null
              if (current?.streamId === currentToKeep.streamId) {
                pendingCurrentUrlRestore = currentToKeep
              }
            }
            await restoreCurrentUrlIfNeeded(streamId)
          })
          if (!mainVisible) {
            await showCurrentOrRecover(generation)
          }
          report({ phase: AUTO_CONNECT_PHASES.ACTIVE, streamId })
          return
        }

        if (candidate?.streamId === streamId) {
          if (readyCandidate?.streamId === streamId) {
            await enqueueStateOperation(() => commitReadyCandidate(generation))
            if (current?.streamId === streamId) {
              return
            }
          }
          report({
            phase: candidate.phase || AUTO_CONNECT_PHASES.CONNECTING,
            streamId,
            deadlineAt: candidate.deadlineAt,
          })
          return
        }

        const cooldownUntil = cooldowns.get(streamId) || 0
        if (cooldownUntil > now()) {
          report({ phase: AUTO_CONNECT_PHASES.COOLDOWN, streamId, deadlineAt: cooldownUntil })
          return
        }
        cooldowns.delete(streamId)

        const nextCandidate = {
          streamId,
          whepUrl: buildWhepUrl(streamId),
        }
        report({ phase: AUTO_CONNECT_PHASES.PROBING, streamId })
        const reachable = await requestWithTimeout(
          'SRS 连接测试',
          ({ signal }) => probeConnection(nextCandidate, { signal }),
          generation
        )
        if (!running || generation !== runGeneration) {
          return
        }
        if (!reachable) {
          report({ phase: AUTO_CONNECT_PHASES.RETRYING, streamId, error: 'SRS 连接测试失败' })
          return
        }

        await enqueueStateOperation(async () => {
          if (!running || generation !== runGeneration) {
            return
          }
          if (current?.streamId === streamId || candidate?.streamId === streamId) {
            return
          }
          const configSaved = !current
          if (configSaved) {
            report({ phase: AUTO_CONNECT_PHASES.SAVING, streamId })
            await persistSavedConfig(nextCandidate.whepUrl)
            if (!running || generation !== runGeneration) {
              return
            }
          }
          candidate = {
            ...nextCandidate,
            configSaved,
            phase: AUTO_CONNECT_PHASES.CONNECTING,
            deadlineAt: 0,
          }
          streamManager.prepare(nextCandidate)
          report({ phase: AUTO_CONNECT_PHASES.CONNECTING, streamId })
        })
      } catch (error) {
        if (!running || generation !== runGeneration) {
          return
        }
        report({
          phase: AUTO_CONNECT_PHASES.RETRYING,
          streamId: retainedStreamId,
          error: error?.message || String(error),
        })
      } finally {
        if (generation === runGeneration) {
          roundInFlight = false
        }
      }
    }

    async function recoverFromMainWindowFailure(error, generation) {
      if (generation !== runGeneration) {
        return
      }
      streamManager.closeAll?.()
      resetStreamState()
      await clearSavedConfig()
      await showSetupContinuing()
      report({
        phase: AUTO_CONNECT_PHASES.RETRYING,
        streamId: '',
        error: error?.message || String(error),
      })
    }

    async function showCurrentOrRecover(generation) {
      try {
        await showMain()
        if (generation === runGeneration) {
          mainVisible = true
        }
      } catch (error) {
        await recoverFromMainWindowFailure(error, generation)
        throw error
      }
    }

    async function commitReadyCandidate(generation = runGeneration) {
      if (!readyCandidate || readyCandidate.streamId !== candidate?.streamId) {
        return
      }
      if (commitPromise) {
        return commitPromise
      }

      const target = readyCandidate
      commitPromise = (async () => {
        if (!target.configSaved) {
          report({ phase: AUTO_CONNECT_PHASES.SAVING, streamId: target.streamId })
          await persistSavedConfig(target.whepUrl)
          target.configSaved = true
        }
        if (
          generation !== runGeneration ||
          target.cancelRequested ||
          target.streamId !== candidate?.streamId
        ) {
          return
        }
        if (!streamManager.activate(target.streamId)) {
          throw new Error('候选画面无法激活')
        }
        current = target
        pendingCurrentUrlRestore = null
        candidate = null
        readyCandidate = null
        if (!mainVisible) {
          await showCurrentOrRecover(generation)
        }
        report({ phase: AUTO_CONNECT_PHASES.ACTIVE, streamId: current.streamId })
      })()

      try {
        await commitPromise
      } finally {
        commitPromise = null
      }
    }

    async function handleStreamEvent(event, generation) {
      if (!event || !event.type || generation !== runGeneration) {
        return
      }
      if (event.type === 'candidate-connecting' || event.type === 'candidate-waiting-frame') {
        if (event.candidate?.streamId === candidate?.streamId) {
          candidate.phase = event.type === 'candidate-connecting'
            ? AUTO_CONNECT_PHASES.CONNECTING
            : AUTO_CONNECT_PHASES.WAITING_FRAME
          candidate.deadlineAt = event.deadlineAt || 0
        }
        report({
          phase: event.type === 'candidate-connecting'
            ? AUTO_CONNECT_PHASES.CONNECTING
            : AUTO_CONNECT_PHASES.WAITING_FRAME,
          streamId: event.candidate?.streamId || '',
          deadlineAt: event.deadlineAt,
        })
        return
      }
      if (event.type === 'candidate-failed' && event.candidate?.streamId === candidate?.streamId) {
        const failedCandidate = candidate
        cooldowns.set(failedCandidate.streamId, now() + cooldownMs)
        candidate = null
        readyCandidate = null
        if (!current) {
          await clearSavedConfig()
        }
        report({
          phase: current ? AUTO_CONNECT_PHASES.ACTIVE : AUTO_CONNECT_PHASES.RETRYING,
          streamId: failedCandidate.streamId,
          error: event.error?.message || String(event.error || 'WHEP 拉流失败'),
        })
        return
      }
      if (event.type === 'current-failed' && event.current?.streamId === current?.streamId) {
        const failedCurrent = current
        current = null
        pendingCurrentUrlRestore = null
        mainVisible = false
        cooldowns.set(failedCurrent.streamId, now() + cooldownMs)
        await clearSavedConfig()
        await showSetupContinuing()
        report({
          phase: AUTO_CONNECT_PHASES.RETRYING,
          streamId: failedCurrent.streamId,
          error: event.error?.message || String(event.error || '当前 WHEP 拉流失败'),
        })
        return
      }
      if (event.type !== 'candidate-ready' || event.candidate?.streamId !== candidate?.streamId) {
        return
      }
      readyCandidate = candidate
      await commitReadyCandidate(generation)
    }

    async function start() {
      if (running) {
        return
      }
      running = true
      unsubscribeStream = typeof streamManager.subscribe === 'function'
        ? streamManager.subscribe((event) => {
          const generation = runGeneration
          enqueueStateOperation(() => handleStreamEvent(event, generation)).catch((error) => {
            report({
              phase: AUTO_CONNECT_PHASES.RETRYING,
              error: error?.message || String(error),
            })
          })
        })
        : null
      await clearSavedConfig()
      if (!running) {
        return
      }
      intervalHandle = setIntervalFn(runDetectionRound, 1000)
      await runDetectionRound()
    }

    async function restart() {
      if (!running) {
        return start()
      }
      const previousGeneration = runGeneration
      runGeneration += 1
      const generation = runGeneration
      abortGeneration(previousGeneration)
      roundInFlight = true
      if (typeof streamManager.closeAll === 'function') {
        streamManager.closeAll()
      }
      await showSetupContinuing()
      await stateQueue
      if (!running || generation !== runGeneration) {
        return
      }
      resetStreamState()
      cooldowns.clear()
      round = 0
      await clearSavedConfig()
      if (!running || generation !== runGeneration) {
        return
      }
      roundInFlight = false
      await runDetectionRound()
    }

    function stop() {
      running = false
      const previousGeneration = runGeneration
      runGeneration += 1
      abortGeneration(previousGeneration)
      roundInFlight = false
      resetStreamState()
      if (intervalHandle) {
        clearIntervalFn(intervalHandle)
        intervalHandle = null
      }
      if (typeof unsubscribeStream === 'function') {
        unsubscribeStream()
        unsubscribeStream = null
      }
    }

    return {
      start,
      restart,
      stop,
    }
  }

  return {
    AUTO_CONNECT_PHASES,
    createAutoConnectController,
  }
})
