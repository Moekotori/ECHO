// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAlbum, LibraryTrack } from '../../shared/types/library';
import { albumDetailNavigationEvent, consumePendingAlbumDetailNavigation, openAlbumDetail, openAlbumDetailForTrack } from './albumNavigation';

const album = (id: string, overrides: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id,
  mediaType: 'local',
  albumKey: id,
  title: '1,000,000 TIMES',
  albumArtist: 'MY FIRST STORY',
  year: 2020,
  trackCount: 2,
  duration: 612,
  coverId: 'cover-1',
  coverThumb: 'echo-cover://album/cover-1',
  ...overrides,
});

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\track-1.flac',
  title: 'MINORS',
  artist: 'MY FIRST STORY',
  album: '1,000,000 TIMES',
  albumArtist: 'MY FIRST STORY',
  trackNo: 1,
  discNo: 1,
  year: 2020,
  genre: null,
  duration: 252,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 1000000,
  coverId: 'cover-1',
  coverThumb: 'echo-cover://album/cover-1',
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'present',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

afterEach(() => {
  consumePendingAlbumDetailNavigation();
  vi.restoreAllMocks();
  window.echo = undefined as unknown as Window['echo'];
});

describe('album navigation', () => {
  it('recovers a stale album id when the current readable album has expanded artist credits and matching artwork', async () => {
    const staleAlbum = album('stale-album', { albumArtist: 'MY FIRST STORY' });
    const readableAlbum = album('readable-album', {
      albumArtist: 'MY FIRST STORY / chelly',
      albumKey: 'fresh-key',
    });
    const getAlbumTracks = vi.fn(async (albumId: string) => ({
      items: albumId === readableAlbum.id ? [track()] : [],
      page: 1,
      pageSize: 1,
      total: albumId === readableAlbum.id ? 2 : 0,
      hasMore: false,
    }));
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);
    window.echo = {
      library: {
        getAlbum: vi.fn().mockResolvedValue(null),
        getAlbums: vi.fn().mockResolvedValue({
          items: [staleAlbum, readableAlbum],
          page: 1,
          pageSize: 50,
          total: 2,
          hasMore: false,
        }),
        getAlbumTracks,
      },
    } as unknown as Window['echo'];

    try {
      const openedAlbum = await openAlbumDetail(staleAlbum, { returnTo: 'home' });

      expect(openedAlbum.id).toBe(readableAlbum.id);
      expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        expect.objectContaining({ album: expect.objectContaining({ id: readableAlbum.id }), returnTo: 'home' }),
      );
      expect(getAlbumTracks).toHaveBeenCalledWith(readableAlbum.id, { page: 1, pageSize: 1 });
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('resolves the album returned for a track before dispatching album detail navigation', async () => {
    const staleAlbum = album('stale-track-album');
    const readableAlbum = album('readable-track-album', {
      albumArtist: 'MY FIRST STORY / chelly',
      albumKey: 'fresh-track-key',
    });
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);
    window.echo = {
      library: {
        getAlbumForTrack: vi.fn().mockResolvedValue(staleAlbum),
        getAlbum: vi.fn().mockResolvedValue(null),
        getAlbums: vi.fn().mockResolvedValue({
          items: [readableAlbum],
          page: 1,
          pageSize: 50,
          total: 1,
          hasMore: false,
        }),
        getAlbumTracks: vi.fn(async (albumId: string) => ({
          items: albumId === readableAlbum.id ? [track()] : [],
          page: 1,
          pageSize: 1,
          total: albumId === readableAlbum.id ? 1 : 0,
          hasMore: false,
        })),
      },
    } as unknown as Window['echo'];

    try {
      const openedAlbum = await openAlbumDetailForTrack(track(), { returnTo: 'songs' });

      expect(openedAlbum?.id).toBe(readableAlbum.id);
      expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        expect.objectContaining({ album: expect.objectContaining({ id: readableAlbum.id }), returnTo: 'songs' }),
      );
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('recovers a history fallback album when one readable title match has a different album artist', async () => {
    const historyAlbum = album('history:local:track-artist:shared-title', {
      albumKey: 'local:track-artist:shared-title',
      title: 'Shared Title',
      albumArtist: 'Track Artist',
      coverId: null,
      coverThumb: null,
    });
    const readableAlbum = album('readable-shared-title', {
      albumKey: 'fresh-shared-title',
      title: 'Shared Title',
      albumArtist: 'Various Artists',
      coverId: 'fresh-cover',
      coverThumb: 'echo-cover://album/fresh-cover',
    });
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);
    window.echo = {
      library: {
        getAlbum: vi.fn().mockResolvedValue(null),
        getAlbums: vi.fn().mockResolvedValue({
          items: [readableAlbum],
          page: 1,
          pageSize: 50,
          total: 1,
          hasMore: false,
        }),
        getAlbumTracks: vi.fn(async (albumId: string) => ({
          items: albumId === readableAlbum.id ? [track()] : [],
          page: 1,
          pageSize: 1,
          total: albumId === readableAlbum.id ? 1 : 0,
          hasMore: false,
        })),
      },
    } as unknown as Window['echo'];

    try {
      const openedAlbum = await openAlbumDetail(historyAlbum, { returnTo: 'home' });

      expect(openedAlbum.id).toBe(readableAlbum.id);
      expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        expect.objectContaining({ album: expect.objectContaining({ id: readableAlbum.id }), returnTo: 'home' }),
      );
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });
});
