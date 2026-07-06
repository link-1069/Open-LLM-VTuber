function getSrsApiUrlFromWhepUrl(whepUrl) {
  try {
    const url = new URL(whepUrl)
    return `${url.origin}/api/v1`
  } catch {
    return ''
  }
}

function getWhepUrlFromStreamId(streamId) {
  const normalizedStreamId = String(streamId ?? '').trim()
  if (!normalizedStreamId) {
    return ''
  }
  return `http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=${encodeURIComponent(normalizedStreamId)}`
}

function isReachableWhepProbeResponse(status, body) {
  if ([200, 201, 400, 404].includes(status)) {
    return true
  }

  if (status !== 500) {
    return false
  }

  const text = String(body || '')
  return (
    text.includes('code=5018') ||
    text.includes('RtcSdpNegotiate') ||
    text.includes('now only support BUNDLE')
  )
}

if (typeof window !== 'undefined') {
  window.setupProbe = {
    getSrsApiUrlFromWhepUrl,
    getWhepUrlFromStreamId,
    isReachableWhepProbeResponse,
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    getSrsApiUrlFromWhepUrl,
    getWhepUrlFromStreamId,
    isReachableWhepProbeResponse,
  }
}
