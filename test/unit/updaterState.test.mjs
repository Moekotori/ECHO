import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildUpdaterEventDedupeKey,
  shouldReplayUpdaterEvent,
  shouldReuseUpdaterState
} from '../../src/shared/updaterState.mjs'

test('buildUpdaterEventDedupeKey dedupes download progress by rounded percent', () => {
  const keyA = buildUpdaterEventDedupeKey('download-progress', { percent: 12.2 })
  const keyB = buildUpdaterEventDedupeKey('download-progress', { percent: 12.4 })
  const keyC = buildUpdaterEventDedupeKey('download-progress', { percent: 13.1 })

  assert.equal(keyA, keyB)
  assert.notEqual(keyA, keyC)
})

test('shouldReplayUpdaterEvent blocks duplicate checking payloads', () => {
  const previous = buildUpdaterEventDedupeKey('checking')

  assert.equal(shouldReplayUpdaterEvent(previous, 'checking'), false)
  assert.equal(shouldReplayUpdaterEvent(previous, 'update-not-available'), true)
})

test('shouldReuseUpdaterState reuses already available or downloaded states', () => {
  assert.equal(shouldReuseUpdaterState({ event: 'update-available' }), true)
  assert.equal(shouldReuseUpdaterState({ event: 'download-progress', percent: 50 }), true)
  assert.equal(shouldReuseUpdaterState({ event: 'update-downloaded' }), true)
  assert.equal(shouldReuseUpdaterState({ event: 'checking' }), false)
  assert.equal(shouldReuseUpdaterState({ event: 'update-not-available' }), false)
})
