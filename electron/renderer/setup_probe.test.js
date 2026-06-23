const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getSrsApiUrlFromWhepUrl,
  isReachableWhepProbeResponse,
} = require('./setup_probe')

test('derives SRS API URL from WHEP URL', () => {
  assert.equal(
    getSrsApiUrlFromWhepUrl('http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=1782211996791800259'),
    'http://127.0.0.1:1985/api/v1'
  )
})

test('derives HTTPS SRS API URL from WHEP URL', () => {
  assert.equal(
    getSrsApiUrlFromWhepUrl('https://example.com:1990/rtc/v1/whep/?app=live&stream=avatar'),
    'https://example.com:1990/api/v1'
  )
})

test('treats SRS invalid SDP negotiation response as reachable', () => {
  const body = [
    'serve error code=5018(RtcSdpNegotiate)(RTC do SDP negotiate failed)',
    'remote sdp check failed : now only support BUNDLE, group policy=',
  ].join('\n')

  assert.equal(isReachableWhepProbeResponse(500, body), true)
})

test('rejects unrelated server errors', () => {
  assert.equal(isReachableWhepProbeResponse(500, 'internal server error'), false)
})

test('keeps existing reachable status behavior', () => {
  for (const status of [200, 201, 400, 404]) {
    assert.equal(isReachableWhepProbeResponse(status, ''), true)
  }
})
