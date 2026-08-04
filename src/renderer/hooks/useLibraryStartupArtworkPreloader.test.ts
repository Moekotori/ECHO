import { describe, expect, it } from 'vitest';
import type { LibraryAlbum, LibraryArtist, LibraryTrack } from '../../shared/types/library';
import { collectStartupArtworkUrls, selectStartupArtworkUrls } from './useLibraryStartupArtworkPreloader';

const track = (id: string, coverThumb: string | null): LibraryTrack => ({
  id,
  path: `G:/Music/${id}.flac`,
  title: id,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: coverThumb ? id : null,
  coverThumb,
  fieldSources: {},
});

const album = (id: string, coverThumb: string | null): LibraryAlbum => ({
  id,
  albumKey: id,
  title: id,
  albumArtist: 'Album Artist',
  year: 2026,
  trackCount: 12,
  duration: 2400,
  coverId: coverThumb ? id : null,
  coverThumb,
});

const artist = (
  id: string,
  patch: Pick<LibraryArtist, 'coverThumb' | 'coverSource' | 'avatarThumbUrl' | 'avatarUrl'>,
): LibraryArtist => ({
  id,
  artistKey: id,
  name: id,
  sortName: id,
  role: 'both',
  trackCount: 10,
  albumCount: 2,
  coverId: patch.coverThumb ? id : null,
  coverThumb: patch.coverThumb,
  coverSource: patch.coverSource,
  avatarThumbUrl: patch.avatarThumbUrl,
  avatarUrl: patch.avatarUrl,
});

describe('library startup artwork preloader helpers', () => {
  it('interleaves page artwork so one surface cannot consume the startup budget', () => {
    expect(
      selectStartupArtworkUrls(
        [
          ['track-1', 'track-2', 'track-3'],
          ['album-1', 'album-2'],
          ['artist-1', 'artist-2'],
        ],
        5,
      ),
    ).toEqual(['track-1', 'album-1', 'artist-1', 'track-2', 'album-2']);
  });

  it('deduplicates, skips remembered urls, and ignores default artist covers', () => {
    expect(
      collectStartupArtworkUrls(
        {
          tracks: [track('track-1', 'cover-a'), track('track-2', 'cover-b')],
          albums: [album('album-1', 'cover-a'), album('album-2', 'album-cover')],
          artists: [
            artist('artist-1', {
              avatarThumbUrl: 'artist-thumb',
              avatarUrl: 'artist-large',
              coverSource: 'default',
              coverThumb: 'default-cover',
            }),
            artist('artist-2', {
              avatarThumbUrl: null,
              avatarUrl: null,
              coverSource: 'embedded',
              coverThumb: 'artist-cover',
            }),
          ],
        },
        10,
        new Set(['cover-b']),
      ),
    ).toEqual(['cover-a', 'artist-thumb', 'album-cover', 'artist-cover']);
  });
});
