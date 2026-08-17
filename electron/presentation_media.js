const fs = require('fs')
const { pathToFileURL } = require('url')
const { getStageMediaType } = require('./presentation_state')

function getMediaSignature(stats) {
  return `${stats.size}:${stats.mtimeMs}`
}

function buildStageMediaUrl(mediaPath, signature) {
  return `${pathToFileURL(mediaPath).href}?stage-media=${encodeURIComponent(signature)}`
}

function inspectStageMedia(mediaPath, options = {}) {
  const mediaType = getStageMediaType(mediaPath)
  if (!mediaType) {
    return { available: false, reason: 'unsupported' }
  }
  let stats
  try {
    stats = (options.statSync || fs.statSync)(mediaPath)
    if (!stats.isFile()) return { available: false, reason: 'missing' }
  } catch {
    return { available: false, reason: 'missing' }
  }
  const signature = getMediaSignature(stats)
  const failedMedia = options.failedMedia
  if (failedMedia?.path === mediaPath && failedMedia.signature === signature) {
    return { available: false, reason: 'decode_failed', mediaType, signature, stats }
  }
  return { available: true, mediaType, signature, stats }
}

function createStageMediaTracker(options) {
  const inspectMedia = options.inspect || inspectStageMedia
  const validateMedia = options.validate
  let approvedMedia = null
  let failedMedia = null
  let checkInProgress = false
  let revision = 0

  function createDescriptor(mediaPath, stats) {
    const signature = getMediaSignature(stats)
    return {
      path: mediaPath,
      signature,
      type: getStageMediaType(mediaPath),
      url: buildStageMediaUrl(mediaPath, signature),
    }
  }

  function inspect(mediaPath, overrides = {}) {
    return inspectMedia(mediaPath, { failedMedia, ...overrides })
  }

  function getDescriptor(mediaPath) {
    if (!approvedMedia || approvedMedia.path !== mediaPath) {
      return {
        media_available: false,
        media_type: getStageMediaType(mediaPath),
        media_url: '',
      }
    }
    return {
      media_available: true,
      media_type: approvedMedia.type,
      media_url: approvedMedia.url,
    }
  }

  async function validateCandidate(mediaPath, stats) {
    const validation = await validateMedia(mediaPath, stats)
    if (!validation?.ok) return validation
    return { ok: true, descriptor: createDescriptor(mediaPath, stats) }
  }

  function approve(descriptor) {
    approvedMedia = { ...descriptor }
    failedMedia = null
    revision += 1
  }

  function markDecodeFailure(mediaPath, signature) {
    failedMedia = { path: mediaPath, signature }
    revision += 1
  }

  function markRenderFailure(mediaUrl) {
    if (!approvedMedia || approvedMedia.url !== mediaUrl) return false
    markDecodeFailure(approvedMedia.path, approvedMedia.signature)
    approvedMedia = null
    return true
  }

  function clear() {
    approvedMedia = null
    failedMedia = null
    revision += 1
  }

  async function check(mediaPath) {
    if (checkInProgress) return { changed: false, reason: 'busy' }
    checkInProgress = true
    try {
      const inspection = inspect(mediaPath)
      if (!inspection.available) {
        if (inspection.reason === 'decode_failed') {
          return { changed: false, reason: inspection.reason }
        }
        const changed = Boolean(approvedMedia || failedMedia)
        clear()
        return { changed, reason: inspection.reason }
      }
      const { signature, stats } = inspection
      if (approvedMedia?.path === mediaPath && approvedMedia.signature === signature) {
        return { changed: false, reason: 'unchanged' }
      }
      const validationRevision = revision
      const previousApprovedMedia = approvedMedia
      const validation = await validateCandidate(mediaPath, stats)
      if (revision !== validationRevision) {
        return { changed: false, reason: 'stale' }
      }
      if (validation.ok) {
        approve(validation.descriptor)
        return { changed: true, reason: 'approved' }
      }
      approvedMedia = previousApprovedMedia?.path === mediaPath ? previousApprovedMedia : null
      markDecodeFailure(mediaPath, signature)
      return { changed: true, reason: 'decode_failed', error: validation.error }
    } finally {
      checkInProgress = false
    }
  }

  return {
    approve,
    check,
    clear,
    getApproved: () => approvedMedia ? { ...approvedMedia } : null,
    getDescriptor,
    getFailed: () => failedMedia ? { ...failedMedia } : null,
    inspect,
    markDecodeFailure,
    markRenderFailure,
    validateCandidate,
  }
}

module.exports = {
  buildStageMediaUrl,
  createStageMediaTracker,
  getMediaSignature,
  inspectStageMedia,
}
