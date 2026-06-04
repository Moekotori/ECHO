// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LikedPage } from './LikedPage';
import type { LibraryAlbum, LibraryPage, LibraryPlaylistItem, LibraryTrack } from '../../shared/types/library';
import { PlaybackQueueProvider } from '../stores/PlaybackQueueProvider';

vi.mock('../components/library/TrackList', () => ({
  TrackList: ({
    tracks,
    canLoadMore,
    onEndReached,
    onToggleLiked,
  }: {
    tracks: LibraryTrack[];
    canLoadMore?: boolean;
    onEndReached?: () => void;
    onToggleLiked?: (track: LibraryTrack) => void;
  }) => (
    <section aria-label="mock-track-list">
      <span>{tracks.length} liked tracks</span>
      {tracks.map((track) => (
        <button key={track.id} type="button" onClick={() => onToggleLiked?.(track)}>
          Unlike {track.title}
        </button>
      ))}
      <button type="button" disabled={!canLoadMore} onClick={onEndReached}>
        Load liked tracks
      </button>
    </section>
  ),
}));

const album = (id: string, overrides: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id,
  albumKey: `artist/${id}`,
  title: `Album ${id}`,
  albumArtist: 'Artist',
  year: 2026,
  trackCount: 1,
  duration: 120,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  path: `D:\\Music\\${id}.flac`,
  title: `Track ${id}`,
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

const playlistItem = (id: string, overrides: Partial<LibraryPlaylistItem> = {}): LibraryPlaylistItem => ({
  id,
  playlistId: 'liked',
  mediaType: 'track',
  mediaId: id,
  sourceProvider: 'local',
  sourceItemId: null,
  titleSnapshot: null,
  artistSnapshot: null,
  albumSnapshot: null,
  durationSnapshot: null,
  coverId: null,
  coverThumb: null,
  position: 1,
  addedAt: '2026-05-14T00:00:00.000Z',
  addedFrom: null,
  unavailable: false,
  track: null,
  album: null,
  ...overrides,
});

const page = <T,>(items: T[], overrides: Partial<LibraryPage<T>> = {}): LibraryPage<T> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (
  getLikedTracks: ReturnType<typeof vi.fn>,
  getLikedAlbums: ReturnType<typeof vi.fn>,
  syncLikedSongs: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    playlistId: 'liked',
    importedCount: 0,
    addedCount: 0,
    providers: [],
    syncedAt: '2026-05-16T00:00:00.000Z',
  }),
  setTrackLiked: ReturnType<typeof vi.fn> = vi.fn(),
): void => {
  window.echo = {
    library: {
      getLikedTracks,
      getLikedAlbums,
      unlikeTrack: vi.fn(),
      unlikeAlbum: vi.fn(),
      clearLikedTracks: vi.fn(),
      clearLikedAlbums: vi.fn(),
    },
    playback: {
      getStatus: vi.fn(),
      playLocalFile: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    streaming: {
      syncLikedSongs,
      setTrackLiked,
    },
  } as unknown as Window['echo'];
};

const renderLikedPage = (): ReturnType<typeof render> =>
  render(
    <PlaybackQueueProvider>
      <main className="page-surface">
        <LikedPage />
      </main>
    </PlaybackQueueProvider>,
  );

const setScrollablePageSurface = (element: HTMLElement): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 900 });
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LikedPage', () => {
  it('keeps liked media local-only and hides provider shortcuts', async () => {
    const getLikedTracks = vi.fn().mockResolvedValue(page([]));
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    installLibrary(getLikedTracks, getLikedAlbums);

    renderLikedPage();

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' }),
    );
    await waitFor(() =>
      expect(getLikedAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' }),
    );
    expect(screen.queryByRole('button', { name: /网易云喜欢/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /QQ 喜欢/ })).toBeNull();
  });

  it('clears only local liked tracks from the liked page', async () => {
    const getLikedTracks = vi.fn().mockResolvedValue(page([playlistItem('track-1', { mediaId: 'track-1', track: track('track-1') })]));
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    installLibrary(getLikedTracks, getLikedAlbums);

    renderLikedPage();

    await screen.findByText('1 liked tracks');
    fireEvent.click(screen.getByRole('button', { name: /清空/ }));

    await waitFor(() => expect(window.echo.library.clearLikedTracks).toHaveBeenCalledWith({ sourceProvider: 'local' }));
  });

  it('loads more liked albums from the page surface sentinel', async () => {
    const getLikedTracks = vi.fn().mockResolvedValue(page([]));
    const getLikedAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([playlistItem('album-1', { mediaType: 'album', album: album('1'), mediaId: '1' })], { page: 1, total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([playlistItem('album-2', { mediaType: 'album', album: album('2'), mediaId: '2' })], { page: 2, total: 2, hasMore: false }));
    installLibrary(getLikedTracks, getLikedAlbums);

    const { container } = renderLikedPage();

    fireEvent.click(screen.getByRole('tab', { name: '喜欢的专辑' }));
    await screen.findByText('Album 1');
    await waitFor(() => expect(getLikedAlbums).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.page-surface') as HTMLElement;
    const sentinel = container.querySelector('.infinite-scroll-sentinel') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.getBoundingClientRect = vi.fn(() => ({
      bottom: 900,
      height: 900,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    sentinel.getBoundingClientRect = vi.fn(() => ({
      bottom: 1510,
      height: 10,
      left: 0,
      right: 1000,
      top: 1500,
      width: 1000,
      x: 0,
      y: 1500,
      toJSON: () => ({}),
    }));
    pageSurface.scrollTop = 760;
    fireEvent.scroll(pageSurface);

    await waitFor(() => expect(getLikedAlbums).toHaveBeenCalledTimes(2));
    expect(getLikedAlbums).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' });
    expect(screen.getByText('Album 2')).toBeTruthy();
  });

  it('keeps liked tracks loading through TrackList onEndReached', async () => {
    const getLikedTracks = vi
      .fn()
      .mockResolvedValueOnce(page([playlistItem('track-1', { mediaId: 'track-1', track: track('track-1') })], { page: 1, total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([playlistItem('track-2', { mediaId: 'track-2', track: track('track-2') })], { page: 2, total: 2, hasMore: false }));
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    installLibrary(getLikedTracks, getLikedAlbums);

    renderLikedPage();

    await screen.findByText('1 liked tracks');
    fireEvent.click(screen.getByRole('button', { name: 'Load liked tracks' }));

    await waitFor(() => expect(getLikedTracks).toHaveBeenCalledTimes(2));
    expect(getLikedTracks).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' });
    expect(screen.getByText('2 liked tracks')).toBeTruthy();
  });
});
