import { describe, expect, it } from 'vitest';
import {
  canStrictMergeTracks,
  createStrictDuplicateBucketKey,
  hasVersionMarkerConflict,
  normalizeDuplicateArtist,
  normalizeDuplicateTitle,
} from './DuplicateTrackIdentity';
import type { TrackLikeForDuplicate } from './DuplicateTrackTypes';

const track = (overrides: Partial<TrackLikeForDuplicate> = {}): TrackLikeForDuplicate => ({
  id: 'track-1',
  title: 'Song',
  artist: 'Artist',
  duration: 180,
  ...overrides,
});

describe('DuplicateTrackIdentity', () => {
  it('normalizes title source prefixes, spacing, case, and NFKC characters', () => {
    expect(normalizeDuplicateTitle('【转载】Acquaintance')).toBe('acquaintance');
    expect(normalizeDuplicateTitle('  Ａｃｑｕａｉｎｔａｎｃｅ   Test  ')).toBe('acquaintance test');
    expect(normalizeDuplicateTitle('"  Song Title  "')).toBe('song title');
  });

  it('normalizes primary artist and falls back to album artist when artist is missing', () => {
    expect(normalizeDuplicateArtist(track({ artist: '  Ａｒｔｉｓｔ   Name  ' }))).toBe('artist name');
    expect(normalizeDuplicateArtist(track({ artist: ' ', albumArtist: 'Album Artist' }))).toBe('album artist');
  });

  it('allows strict duplicates with same title and artist within two seconds', () => {
    expect(canStrictMergeTracks(track({ duration: 180 }), track({ id: 'track-2', duration: 182 }))).toEqual({
      duplicate: true,
      confidence: 1,
      reasons: ['strict_title_artist_duration_match'],
    });
  });

  it('rejects tracks when duration differs by more than two seconds', () => {
    expect(canStrictMergeTracks(track({ duration: 180 }), track({ id: 'track-2', duration: 183 }))).toMatchObject({
      duplicate: false,
      reasons: ['duration_mismatch'],
    });
  });

  it('rejects tracks with missing or zero duration', () => {
    expect(canStrictMergeTracks(track({ duration: 0 }), track({ id: 'track-2', duration: 180 }))).toMatchObject({
      duplicate: false,
      reasons: ['invalid_duration'],
    });
  });

  it.each([
    ['Song Live'],
    ['Song Remix'],
    ['Song Cover'],
    ['Song Instrumental'],
    ['Song TV Size'],
  ])('rejects version marker conflicts for %s', (title) => {
    expect(canStrictMergeTracks(track(), track({ id: 'track-2', title }))).toMatchObject({
      duplicate: false,
    });
    expect(hasVersionMarkerConflict('Song', title)).toBe(true);
  });

  it('rejects same title with different artist', () => {
    expect(canStrictMergeTracks(track(), track({ id: 'track-2', artist: 'Other Artist' }))).toMatchObject({
      duplicate: false,
      reasons: ['artist_mismatch'],
    });
  });

  it('keeps different durations in the same strict bucket key', () => {
    expect(createStrictDuplicateBucketKey(track({ duration: 180 }))).toBe(
      createStrictDuplicateBucketKey(track({ id: 'track-2', duration: 240 })),
    );
  });
});
