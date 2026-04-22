import test from 'node:test'
import assert from 'node:assert/strict'

import {
  containsLegacyPlaybackHistoryEntries,
  normalizePlaybackHistory,
  normalizePlaybackSession,
  pickInitialPersistedValue,
  remapPlaybackHistoryEntries
} from '../../src/shared/playbackPersistence.mjs'
import {
  invalidPlaybackSessionsFixture,
  legacyPlaybackHistoryFixture,
  modernPlaybackHistoryFixture,
  validPlaybackSessionFixture
} from './fixtures/persistedStateFixtures.mjs'

test('normalizePlaybackHistory upgrades legacy string[] entries', () => {
  const normalized = normalizePlaybackHistory(legacyPlaybackHistoryFixture)

  assert.equal(normalized.length, 2)
  assert.deepEqual(normalized[0], {
    path: 'C:\\Music\\alpha.flac',
    title: '',
    artist: '',
    album: '',
    playedAt: 0
  })
  assert.equal(containsLegacyPlaybackHistoryEntries(legacyPlaybackHistoryFixture), true)
})

test('normalizePlaybackHistory preserves modern entry metadata', () => {
  const normalized = normalizePlaybackHistory(modernPlaybackHistoryFixture)

  assert.deepEqual(normalized, modernPlaybackHistoryFixture)
  assert.equal(containsLegacyPlaybackHistoryEntries(modernPlaybackHistoryFixture), false)
})

test('remapPlaybackHistoryEntries remaps paths and drops removed items', () => {
  const remapped = remapPlaybackHistoryEntries(
    modernPlaybackHistoryFixture,
    { 'C:\\Music\\alpha.flac': 'D:\\Library\\alpha.flac' },
    new Set(['C:\\Music\\beta.flac'])
  )

  assert.deepEqual(remapped, [
    {
      path: 'D:\\Library\\alpha.flac',
      title: 'Alpha',
      artist: 'Artist A',
      album: 'Album A',
      playedAt: 1710000000000
    }
  ])
})

test('normalizePlaybackSession accepts valid session and sanitizes context', () => {
  const normalized = normalizePlaybackSession(validPlaybackSessionFixture)

  assert.equal(normalized.trackPath, validPlaybackSessionFixture.trackPath)
  assert.equal(normalized.currentTimeSec, 83.25)
  assert.deepEqual(normalized.playbackContext, validPlaybackSessionFixture.playbackContext)
})

test('normalizePlaybackSession safely rejects invalid payloads', () => {
  for (const fixture of invalidPlaybackSessionsFixture) {
    if (fixture?.trackPath === 'C:\\Music\\gamma.flac') {
      const normalized = normalizePlaybackSession(fixture)
      assert.equal(normalized.trackPath, 'C:\\Music\\gamma.flac')
      assert.equal(normalized.currentTimeSec, 0)
      assert.deepEqual(normalized.playbackContext, {
        kind: 'library',
        key: 'library',
        trackPaths: []
      })
      continue
    }
    assert.equal(normalizePlaybackSession(fixture), null)
  }
})

test('pickInitialPersistedValue prefers appState snapshot over local fallback', () => {
  const picked = pickInitialPersistedValue({
    snapshotValue: modernPlaybackHistoryFixture,
    localValue: legacyPlaybackHistoryFixture,
    normalize: (value) => normalizePlaybackHistory(value),
    fallback: []
  })

  assert.deepEqual(picked, modernPlaybackHistoryFixture)
})

test('pickInitialPersistedValue falls back to local storage when snapshot is missing', () => {
  const picked = pickInitialPersistedValue({
    snapshotValue: null,
    localValue: legacyPlaybackHistoryFixture,
    normalize: (value) => normalizePlaybackHistory(value),
    fallback: []
  })

  assert.equal(picked.length, 2)
  assert.equal(picked[0].path, 'C:\\Music\\alpha.flac')
})

test('pickInitialPersistedValue falls back when snapshot payload is invalid', () => {
  const picked = pickInitialPersistedValue({
    snapshotValue: { bad: true },
    localValue: modernPlaybackHistoryFixture,
    normalize: (value) => (Array.isArray(value) ? normalizePlaybackHistory(value) : undefined),
    fallback: []
  })

  assert.deepEqual(picked, modernPlaybackHistoryFixture)
})
