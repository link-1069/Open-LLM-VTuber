function getSrsApiUrlFromWhepUrl(whepUrl) {
  try {
    const url = new URL(whepUrl)
    return `${url.origin}/api/v1`
  } catch {
    return ''
  }
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
    isReachableWhepProbeResponse,
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    getSrsApiUrlFromWhepUrl,
    isReachableWhepProbeResponse,
  }
}
