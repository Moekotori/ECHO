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
    totalCount,
    loadedCount,
    isLoadingMore,
    onEndReached,
    onToggleLiked,
  }: {
    tracks: LibraryTrack[];
    canLoadMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    isLoadingMore?: boolean;
    onEndReached?: () => void;
    onToggleLiked?: (track: LibraryTrack) => void;
  }) => (
    <section aria-label="mock-track-list">
      <span>{tracks.length} liked tracks</span>
      <span>
        loaded {loadedCount ?? tracks.length} / {totalCount ?? tracks.length} {isLoadingMore ? 'loading' : 'idle'}
      </span>
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
  getLikedSongsPlaylist: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    id: 'liked-tracks',
    name: '喜欢的歌曲',
    description: null,
    kind: 'system',
    sourceProvider: 'local',
    sourcePlaylistId: null,
    coverId: null,
    coverThumb: null,
    sortMode: 'manual',
    itemCount: 1,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
  }),
  exportPlaylist: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue('D:\\Exports\\liked.json'),
): void => {
  window.echo = {
    library: {
      getLikedTracks,
      getLikedAlbums,
      getLikedSongsPlaylist,
      exportPlaylist,
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
  it('syncs provider liked songs from the liked page', async () => {
    const neteasePage = page(
      [
        playlistItem('netease-1', {
          mediaType: 'stream_track',
          mediaId: 'streaming:netease:1',
          sourceProvider: 'netease',
          sourceItemId: '1',
          titleSnapshot: 'NetEase 1',
        }),
        playlistItem('netease-2', {
          mediaType: 'stream_track',
          mediaId: 'streaming:netease:2',
          sourceProvider: 'netease',
          sourceItemId: '2',
          titleSnapshot: 'NetEase 2',
        }),
      ],
      { total: 955, hasMore: true },
    );
    const getLikedTracks = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(neteasePage)
      .mockResolvedValue(neteasePage);
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    const syncLikedSongs = vi.fn().mockResolvedValue({
      playlistId: 'liked',
      importedCount: 2,
      addedCount: 1,
      providers: [{ provider: 'netease', success: true, importedCount: 2, addedCount: 1, total: 2 }],
      syncedAt: '2026-05-16T00:00:00.000Z',
    });
    installLibrary(getLikedTracks, getLikedAlbums, syncLikedSongs);

    renderLikedPage();

    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' }),
    );
    await waitFor(() =>
      expect(getLikedAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '网易云' }));

    await waitFor(() => expect(syncLikedSongs).toHaveBeenCalledWith('netease'));
    await waitFor(() =>
      expect(getLikedTracks).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'netease' }),
    );
    expect(screen.getByText('网易云 我喜欢已同步：2 首，新增 1 首。')).toBeTruthy();
    expect(screen.getByText('loaded 2 / 955 idle')).toBeTruthy();
    expect(screen.getByRole('button', { name: '本地' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '网易云' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'QQ音乐' })).toBeTruthy();
  });

  it('exports the selected liked source from the liked page', async () => {
    const qqPage = page([
      playlistItem('qq-1', {
        mediaType: 'stream_track',
        mediaId: 'streaming:qqmusic:1',
        sourceProvider: 'qqmusic',
        sourceItemId: '1',
        titleSnapshot: 'QQ 1',
      }),
    ]);
    const getLikedTracks = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(qqPage)
      .mockResolvedValue(qqPage);
    const getLikedAlbums = vi.fn().mockResolvedValue(page([]));
    const syncLikedSongs = vi.fn().mockResolvedValue({
      playlistId: 'liked',
      importedCount: 1,
      addedCount: 1,
      providers: [{ provider: 'qqmusic', success: true, importedCount: 1, addedCount: 1, total: 1 }],
      syncedAt: '2026-05-16T00:00:00.000Z',
    });
    const getLikedSongsPlaylist = vi.fn().mockResolvedValue({
      id: 'liked-tracks',
      name: '喜欢的歌曲',
      description: null,
      kind: 'system',
      sourceProvider: 'local',
      sourcePlaylistId: null,
      coverId: null,
      coverThumb: null,
      sortMode: 'manual',
      itemCount: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    });
    const exportPlaylist = vi.fn().mockResolvedValue('D:\\Exports\\qq-liked.json');
    installLibrary(getLikedTracks, getLikedAlbums, syncLikedSongs, vi.fn(), getLikedSongsPlaylist, exportPlaylist);

    renderLikedPage();

    await waitFor(() => expect(getLikedTracks).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', sort: 'recent', sourceProvider: 'local' }));
    fireEvent.click(screen.getByRole('button', { name: 'QQ音乐' }));

    await waitFor(() => expect(syncLikedSongs).toHaveBeenCalledWith('qqmusic'));
    await waitFor(() => expect(screen.getByText('1 liked tracks')).toBeTruthy());
    const exportButton = screen.getAllByRole('button').find((button) => button.textContent?.includes('导出'));
    expect(exportButton).toBeTruthy();
    fireEvent.click(exportButton as HTMLButtonElement);

    await waitFor(() =>
      expect(exportPlaylist).toHaveBeenCalledWith({
        playlistId: 'liked-tracks',
        format: 'json',
        sourceProvider: 'qqmusic',
      }),
    );
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
