import { describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { sortRemotePreviewTracks } from './foldersRemotePreviewSort';

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  path: `remote://source/${id}.flac`,
  title: id,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

describe('sortRemotePreviewTracks', () => {
  it('sorts numeric album tracks and artist directions without changing its input', () => {
    const tracks = [track('1', { artist: 'Zebra', album: 'Alpha', trackNo: 10 }), track('2', { artist: 'Alpha', album: 'Alpha', trackNo: 2 }), track('3', { artist: 'Beta', album: 'Beta' })];
    expect(sortRemotePreviewTracks(tracks, 'album').map((item) => item.id)).toEqual(['2', '1', '3']);
    expect(sortRemotePreviewTracks(tracks, 'artistDesc').map((item) => item.id)).toEqual(['1', '3', '2']);
    expect(sortRemotePreviewTracks(tracks, 'albumDesc').map((item) => item.id)).toEqual(['3', '2', '1']);
    expect(tracks.map((item) => item.id)).toEqual(['1', '2', '3']);
  });
  it('keeps unknown audio specs last in either direction', () => {
    const tracks = [track('none', { sampleRate: null, bitDepth: null }), track('cd', { sampleRate: 44100, bitDepth: 16 }), track('hi', { sampleRate: 96000, bitDepth: 24 })];
    expect(sortRemotePreviewTracks(tracks, 'audioSpecAsc').map((item) => item.id)).toEqual(['cd', 'hi', 'none']);
    expect(sortRemotePreviewTracks(tracks, 'audioSpecDesc').map((item) => item.id)).toEqual(['hi', 'cd', 'none']);
  });
});
