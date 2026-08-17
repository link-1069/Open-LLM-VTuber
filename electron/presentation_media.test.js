const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildStageMediaUrl,
  inspectStageMedia,
} = require('./presentation_media')

function createStats({ file = true, size = 42, mtimeMs = 100 } = {}) {
  return { isFile: () => file, size, mtimeMs }
}

test('media inspection distinguishes missing, unsupported, and failed decoded versions', () => {
  const mediaPath = 'D:\\media\\stage.png'
  const statSync = () => createStats()

  assert.deepEqual(inspectStageMedia('D:\\media\\stage.webm', { statSync }), {
    available: false,
    reason: 'unsupported',
  })
  assert.deepEqual(inspectStageMedia(mediaPath, {
    statSync: () => { throw new Error('missing') },
  }), {
    available: false,
    reason: 'missing',
  })
  assert.equal(inspectStageMedia(mediaPath, { statSync }).available, true)
  assert.equal(inspectStageMedia(mediaPath, {
    statSync,
    failedMedia: { path: mediaPath, signature: '42:100' },
  }).reason, 'decode_failed')
})

test('media URL carries a cache-busting version without changing the source path', () => {
  assert.equal(
    buildStageMediaUrl('D:\\media\\stage image.png', '42:100'),
    'file:///D:/media/stage%20image.png?stage-media=42%3A100'
  )
})
