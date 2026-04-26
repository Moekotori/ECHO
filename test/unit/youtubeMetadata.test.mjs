import assert from 'node:assert/strict'
import test from 'node:test'

import { inferYoutubeMusicMetadataFromTitle } from '../../src/main/MediaDownloader.js'

test('inferYoutubeMusicMetadataFromTitle parses title slash artist format', () => {
  assert.deepEqual(inferYoutubeMusicMetadataFromTitle('【#BOFXV】 Boxel Adventure / 7mai'), {
    title: 'Boxel Adventure',
    artist: '7mai'
  })
})

test('inferYoutubeMusicMetadataFromTitle parses artist dash title format', () => {
  assert.deepEqual(inferYoutubeMusicMetadataFromTitle('7mai - Boxel Adventure'), {
    title: 'Boxel Adventure',
    artist: '7mai'
  })
})
