async function runPresentationExit(options) {
  if (!await options.confirmExit()) return false

  let saveStatus = options.flushPendingSave()
  if (!saveStatus && options.hasPendingSave()) {
    saveStatus = options.retryPendingSave()
  }
  while (saveStatus?.state === 'error') {
    const decision = await options.resolveSaveFailure(saveStatus)
    if (decision === 'exit') break
    saveStatus = options.retryPendingSave()
  }
  return true
}

module.exports = {
  runPresentationExit,
}
