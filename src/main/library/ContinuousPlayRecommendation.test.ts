import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from './libraryTypes';
import { rankContinuousPlayCandidates, type ContinuousPlayCandidate } from './ContinuousPlayRecommendation';

const nowMs = Date.parse('2026-07-22T12:00:00.000Z');

const track = (id: string, patch: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  mediaType: 'local',
  path: `D:\\Music\\${id}.flac`,
  title: id,
  artist: 'Artist A',
  album: 'Album A',
  albumArtist: 'Artist A',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: 'Electronic',
  duration: 240,
  codec: 'FLAC',
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: 900_000,
  bpm: 120,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...patch,
});

const candidate = (
  id: string,
  patch: Partial<ContinuousPlayCandidate> & { track?: LibraryTrack } = {},
): ContinuousPlayCandidate => ({
  track: patch.track ?? track(id),
  createdAt: '2026-06-01T00:00:00.000Z',
  playCount: 4,
  completedCount: 3,
  playedSeconds: 720,
  lastPlayedAt: '2026-06-15T00:00:00.000Z',
  nightPlayCount: 0,
  isLiked: false,
  ...patch,
});

describe('rankContinuousPlayCandidates', () => {
  it('uses local metadata to rank similar tracks and explain the result', () => {
    const seed = track('seed', { artist: 'Seed Artist', album: 'Seed Album', genre: 'Jazz', bpm: 96 });
    const result = rankContinuousPlayCandidates([
      candidate('unrelated', { track: track('unrelated', { artist: 'Other', album: 'Other', genre: 'Rock', bpm: 150 }), isLiked: true }),
      candidate('similar', { track: track('similar', { artist: 'Seed Artist', album: 'Different', genre: 'Jazz', bpm: 99 }) }),
    ], { mode: 'similar', seed, limit: 2, nowMs });

    expect(result[0]?.track.id).toBe('similar');
    expect(result[0]?.reasons.map((reason) => reason.code)).toContain('same-artist');
  });

  it('finds liked deep cuts that have barely been played', () => {
    const result = rankContinuousPlayCandidates([
      candidate('favorite', { isLiked: true, playCount: 18, completedCount: 17 }),
      candidate('deep-cut', { isLiked: true, playCount: 1, completedCount: 1, lastPlayedAt: '2025-01-01T00:00:00.000Z' }),
    ], { mode: 'deep-cuts', seed: null, limit: 1, nowMs });

    expect(result[0]?.track.id).toBe('deep-cut');
    expect(result[0]?.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['liked', 'rarely-played']));
  });

  it('supports recently added, night, and headphone-test modes without cloud features', () => {
    const recent = candidate('recent', { createdAt: '2026-07-21T00:00:00.000Z', playCount: 0, completedCount: 0 });
    const night = candidate('night', { nightPlayCount: 6, track: track('night', { bpm: 90 }) });
    const hires = candidate('hires', { track: track('hires', { codec: 'FLAC', sampleRate: 192_000, bitDepth: 24 }) });
    const ordinary = candidate('ordinary', { track: track('ordinary', { codec: 'MP3', sampleRate: 44_100, bitDepth: 16, bitrate: 320_000 }) });

    expect(rankContinuousPlayCandidates([ordinary, recent], { mode: 'recently-added', seed: null, limit: 1, nowMs })[0]?.track.id).toBe('recent');
    expect(rankContinuousPlayCandidates([ordinary, night], { mode: 'night', seed: null, limit: 1, nowMs })[0]?.track.id).toBe('night');
    expect(rankContinuousPlayCandidates([ordinary, hires], { mode: 'headphone-test', seed: null, limit: 1, nowMs })[0]?.track.id).toBe('hires');
  });

  it('applies artist frequency reduction before final selection', () => {
    const preferred = candidate('preferred', {
      track: track('preferred', { artist: 'Frequent Artist' }),
      isLiked: true,
      playCount: 1,
      completedCount: 1,
    });
    const alternative = candidate('alternative', {
      track: track('alternative', { artist: 'Alternative Artist' }),
      isLiked: true,
      playCount: 2,
      completedCount: 2,
    });

    const result = rankContinuousPlayCandidates([preferred, alternative], {
      mode: 'deep-cuts',
      seed: null,
      limit: 1,
      nowMs,
      preferences: [{ kind: 'artist', value: 'Frequent Artist', weight: 0.1 }],
    });

    expect(result[0]?.track.id).toBe('alternative');
  });
});
