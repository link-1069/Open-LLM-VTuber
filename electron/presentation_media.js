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

module.exports = {
  buildStageMediaUrl,
  getMediaSignature,
  inspectStageMedia,
}
