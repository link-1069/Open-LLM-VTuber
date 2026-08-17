const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildStageMediaUrl,
  createStageMediaTracker,
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

test('media tracker falls back while missing and restores or hot-replaces decoded versions', async () => {
  const mediaPath = 'D:\\media\\stage.mp4'
  let stats = null
  const validatedSignatures = []
  const tracker = createStageMediaTracker({
    inspect: (candidate, options) => inspectStageMedia(candidate, {
      ...options,
      statSync: () => {
        if (!stats) throw new Error('missing')
        return stats
      },
    }),
    validate: async (_candidate, candidateStats) => {
      validatedSignatures.push(`${candidateStats.size}:${candidateStats.mtimeMs}`)
      return { ok: true }
    },
  })

  assert.deepEqual(await tracker.check(mediaPath), { changed: false, reason: 'missing' })
  assert.equal(tracker.getDescriptor(mediaPath).media_available, false)

  stats = createStats({ size: 100, mtimeMs: 10 })
  assert.deepEqual(await tracker.check(mediaPath), { changed: true, reason: 'approved' })
  assert.equal(tracker.getDescriptor(mediaPath).media_available, true)

  stats = createStats({ size: 120, mtimeMs: 20 })
  assert.deepEqual(await tracker.check(mediaPath), { changed: true, reason: 'approved' })
  assert.deepEqual(validatedSignatures, ['100:10', '120:20'])

  stats = null
  assert.deepEqual(await tracker.check(mediaPath), { changed: true, reason: 'missing' })
  assert.equal(tracker.getDescriptor(mediaPath).media_available, false)
})

test('media tracker suppresses a failed version until its signature changes', async () => {
  const mediaPath = 'D:\\media\\stage.gif'
  let stats = createStats({ size: 42, mtimeMs: 100 })
  let shouldDecode = false
  let validationCount = 0
  const tracker = createStageMediaTracker({
    inspect: (candidate, options) => inspectStageMedia(candidate, {
      ...options,
      statSync: () => stats,
    }),
    validate: async () => {
      validationCount += 1
      return shouldDecode ? { ok: true } : { ok: false, error: 'decode failed' }
    },
  })

  assert.deepEqual(await tracker.check(mediaPath), {
    changed: true,
    reason: 'decode_failed',
    error: 'decode failed',
  })
  assert.equal(tracker.inspect(mediaPath).reason, 'decode_failed')
  assert.deepEqual(await tracker.check(mediaPath), { changed: false, reason: 'decode_failed' })
  assert.equal(validationCount, 1)

  shouldDecode = true
  stats = createStats({ size: 43, mtimeMs: 101 })
  assert.deepEqual(await tracker.check(mediaPath), { changed: true, reason: 'approved' })
  assert.equal(tracker.getDescriptor(mediaPath).media_available, true)
  assert.equal(validationCount, 2)
})

test('media tracker marks renderer failures and can validate candidates without committing them', async () => {
  const mediaPath = 'D:\\media\\stage.png'
  const stats = createStats()
  const tracker = createStageMediaTracker({ validate: async () => ({ ok: true }) })
  const candidate = await tracker.validateCandidate(mediaPath, stats)

  assert.equal(tracker.getDescriptor(mediaPath).media_available, false)
  tracker.approve(candidate.descriptor)
  const approved = tracker.getApproved()
  assert.equal(tracker.markRenderFailure(approved.url), true)
  assert.equal(tracker.getDescriptor(mediaPath).media_available, false)
  assert.equal(tracker.inspect(mediaPath, { statSync: () => stats }).reason, 'decode_failed')
})

test('failed hot replacement keeps the last decoded background visible', async () => {
  const mediaPath = 'D:\\media\\stage.mp4'
  let stats = createStats({ size: 100, mtimeMs: 10 })
  let shouldDecode = true
  const tracker = createStageMediaTracker({
    inspect: (candidate, options) => inspectStageMedia(candidate, {
      ...options,
      statSync: () => stats,
    }),
    validate: async () => shouldDecode
      ? { ok: true }
      : { ok: false, error: 'replacement failed' },
  })

  await tracker.check(mediaPath)
  const firstUrl = tracker.getDescriptor(mediaPath).media_url
  stats = createStats({ size: 120, mtimeMs: 20 })
  shouldDecode = false

  assert.equal((await tracker.check(mediaPath)).reason, 'decode_failed')
  assert.equal(tracker.getDescriptor(mediaPath).media_url, firstUrl)
  assert.equal(tracker.inspect(mediaPath).reason, 'decode_failed')
})

test('a stale poll result cannot overwrite a newer user-approved media choice', async () => {
  const oldPath = 'D:\\media\\old.png'
  const newPath = 'D:\\media\\new.png'
  let resolveValidation
  const tracker = createStageMediaTracker({
    inspect: (candidate, options) => inspectStageMedia(candidate, {
      ...options,
      statSync: () => createStats({ size: 10, mtimeMs: 1 }),
    }),
    validate: () => new Promise((resolve) => { resolveValidation = resolve }),
  })

  const pendingCheck = tracker.check(oldPath)
  await Promise.resolve()
  tracker.approve({
    path: newPath,
    signature: '20:2',
    type: 'image',
    url: 'file:///D:/media/new.png?stage-media=20%3A2',
  })
  resolveValidation({ ok: true })

  assert.deepEqual(await pendingCheck, { changed: false, reason: 'stale' })
  assert.equal(tracker.getDescriptor(newPath).media_available, true)
  assert.equal(tracker.getDescriptor(oldPath).media_available, false)
})
