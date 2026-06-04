// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { normalizeRemoteCoverLoadPerformanceMode, selectRemoteCoverPreloadCandidates } from './useRemoteCoverPreloader';

const track = (index: number): LibraryTrack => ({
  id: `track-${index}`,
  path: `remote://subsonic/song-${index}`,
  title: `Song ${index}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: `echo-image://subsonic-cover/track-${index}?size=512`,
  mediaType: 'remote',
  sourceId: 'subsonic-1',
  sourceDisplayName: 'Navidrome',
  provider: 'subsonic',
  remotePath: `subsonic:song:${index}`,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
});

describe('useRemoteCoverPreloader helpers', () => {
  it('normalizes remote cover load performance mode', () => {
    expect(normalizeRemoteCoverLoadPerformanceMode(undefined)).toBe('balanced');
    expect(normalizeRemoteCoverLoadPerformanceMode('low')).toBe('low');
    expect(normalizeRemoteCoverLoadPerformanceMode('aggressive')).toBe('aggressive');
    expect(normalizeRemoteCoverLoadPerformanceMode('lan')).toBe('lan');
    expect(normalizeRemoteCoverLoadPerformanceMode('turbo')).toBe('balanced');
  });

  it('selects more lead rows for aggressive preloading', () => {
    const tracks = Array.from({ length: 700 }, (_, index) => track(index));

    expect(selectRemoteCoverPreloadCandidates(tracks, ['track-10', 'track-11'], 'low').map((item) => item.id)).toEqual([
      'track-10',
      'track-11',
    ]);
    expect(selectRemoteCoverPreloadCandidates(tracks, ['track-10', 'track-11'], 'balanced')).toHaveLength(74);
    expect(selectRemoteCoverPreloadCandidates(tracks, ['track-10', 'track-11'], 'aggressive')).toHaveLength(222);
    expect(selectRemoteCoverPreloadCandidates(tracks, ['track-10', 'track-11'], 'lan')).toHaveLength(690);
  });
});
