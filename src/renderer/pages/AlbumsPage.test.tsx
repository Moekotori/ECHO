// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlbumsPage } from './AlbumsPage';
import type { LibraryAlbum, LibraryPage, LibraryTrack } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';

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

const page = (items: LibraryAlbum[], overrides: Partial<LibraryPage<LibraryAlbum>> = {}): LibraryPage<LibraryAlbum> => ({
  items,
  page: 1,
  pageSize: 60,
  total: items.length,
  hasMore: false,
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
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const trackPage = (items: LibraryTrack[], overrides: Partial<LibraryPage<LibraryTrack>> = {}): LibraryPage<LibraryTrack> => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (
  getAlbums: ReturnType<typeof vi.fn>,
  getTracks = vi.fn(),
  getAlbumTracks = vi.fn().mockResolvedValue(trackPage([])),
  getAlbum = vi.fn().mockResolvedValue(null),
): void => {
  window.echo = {
    library: {
      getAlbums,
      getAlbum,
      getTracks,
      getAlbumTracks,
      getSummary: vi.fn(),
      chooseFolder: vi.fn(),
      addFolder: vi.fn(),
      getFolders: vi.fn(),
      removeFolder: vi.fn(),
      scanFolder: vi.fn(),
      getScanStatus: vi.fn(),
      cancelScan: vi.fn(),
      getDiagnostics: vi.fn(),
      openTrackInFolder: vi.fn(),
      openPathInFolder: vi.fn(),
      loadEmbeddedTrackTags: vi.fn(),
      updateAlbumTags: vi.fn(),
      deleteAlbumFiles: vi.fn(),
      searchNetworkTagCandidates: vi.fn(),
    },
    playback: {
      getStatus: vi.fn(),
      playLocalFile: vi.fn().mockResolvedValue({
        state: 'playing',
        currentTrackId: 'track-1',
        filePath: 'D:\\Music\\track-1.flac',
        positionMs: 0,
        durationMs: 180000,
        error: null,
      }),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    audio: {
      getStatus: vi.fn(),
      listDevices: vi.fn(),
      setOutput: vi.fn(),
    },
  } as unknown as Window['echo'];
};

const renderAlbumsPage = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <main className="page-surface">
          <AlbumsPage />
        </main>
      </PlaybackQueueProvider>
    </I18nProvider>,
  );

const QueueProbe = (): JSX.Element => {
  const { currentTrackId, tracks } = usePlaybackQueue();

  return <output aria-label="queue-state">{`${tracks.length}:${currentTrackId ?? ''}`}</output>;
};

const renderAlbumsPageWithQueueProbe = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <main className="page-surface">
          <AlbumsPage />
        </main>
        <QueueProbe />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );

const setScrollablePageSurface = (element: HTMLElement): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 900 });
};

const setSentinelReach = (pageSurface: HTMLElement, sentinel: Element): void => {
  vi.spyOn(pageSurface, 'getBoundingClientRect').mockReturnValue({
    bottom: 900,
    height: 900,
    left: 0,
    right: 1200,
    top: 0,
    width: 1200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(sentinel, 'getBoundingClientRect').mockReturnValue({
    bottom: 1200,
    height: 1,
    left: 0,
    right: 1200,
    top: 1200,
    width: 1200,
    x: 0,
    y: 1200,
    toJSON: () => ({}),
  });
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
  window.localStorage.clear();
  window.localStorage.setItem('echo-next.locale', 'en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AlbumsPage', () => {
  it('initially reads only getAlbums page 1 without grouping tracks in the renderer', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([], { total: 120, hasMore: true }));
    const getTracks = vi.fn();
    installLibrary(getAlbums, getTracks);

    renderAlbumsPage();

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));
    expect(getAlbums).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 60, search: '', sort: 'default' }));
    expect(getTracks).not.toHaveBeenCalled();
  });

  it('returns to songs when an album detail was opened from the song list', async () => {
    const targetAlbum = album('1', { title: 'Dream within a dream' });
    const navigateSongs = vi.fn();
    installLibrary(
      vi.fn().mockResolvedValue(page([targetAlbum])),
      vi.fn(),
      vi.fn().mockResolvedValue(trackPage([])),
      vi.fn().mockResolvedValue(null),
    );
    window.addEventListener('app:navigate:songs', navigateSongs);

    const { container } = renderAlbumsPage();
    await screen.findByText('Dream within a dream');
    window.dispatchEvent(new CustomEvent('app:navigate:album-detail', { detail: { album: targetAlbum, returnTo: 'songs' } }));
    fireEvent.click(await screen.findByRole('button', { name: /Albums/ }));

    await waitFor(() => expect(navigateSongs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('Dream within a dream album details')).toBeNull());
    expect(container.querySelector('.albums-page')?.getAttribute('data-detail-open')).toBe('false');
    expect(screen.getByText('Dream within a dream')).toBeTruthy();
    window.removeEventListener('app:navigate:songs', navigateSongs);
  });

  it('returns to home when an album detail was opened from the home page', async () => {
    const targetAlbum = album('1', { title: 'Dream within a dream' });
    const navigateRoute = vi.fn();
    installLibrary(
      vi.fn().mockResolvedValue(page([targetAlbum])),
      vi.fn(),
      vi.fn().mockResolvedValue(trackPage([])),
      vi.fn().mockResolvedValue(null),
    );
    window.addEventListener('app:navigate:route', navigateRoute);

    renderAlbumsPage();
    await screen.findByText('Dream within a dream');
    window.dispatchEvent(new CustomEvent('app:navigate:album-detail', { detail: { album: targetAlbum, returnTo: 'home' } }));
    await screen.findByLabelText('Dream within a dream album details');
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(navigateRoute).toHaveBeenCalledWith(expect.objectContaining({ detail: 'home' })));
    window.removeEventListener('app:navigate:route', navigateRoute);
  });

  it('loads page 2 when the album wall scrolls to the spacer bottom', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([album('2')], { page: 2, total: 2, hasMore: false }));
    installLibrary(getAlbums);

    const { container } = renderAlbumsPage();

    await screen.findByLabelText('Album list');
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    const sentinel = container.querySelector('.infinite-scroll-sentinel')!;
    setScrollablePageSurface(pageSurface);
    setSentinelReach(pageSurface, sentinel);
    pageSurface.scrollTop = 2000;
    fireEvent.scroll(pageSurface);

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(getAlbums).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, pageSize: 60, search: '', sort: 'default' }));
    expect(screen.getByText('Album 1')).toBeTruthy();
    expect(screen.getByText('Album 2')).toBeTruthy();
  });

  it('search and sort changes reset loading to page 1', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([album('search')], { page: 1, total: 1, hasMore: false }))
      .mockResolvedValueOnce(page([album('artist-sort')], { page: 1, total: 1, hasMore: false }));
    installLibrary(getAlbums);

    renderAlbumsPage();
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Search albums / artists'), { target: { value: 'search' } });
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(getAlbums).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1, pageSize: 60, search: 'search', sort: 'default' }));

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('option', { name: 'Artist' }));
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(3));
    expect(getAlbums).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 1, pageSize: 60, search: 'search', sort: 'artist' }));
  });

  it('search and sort reset the album wall scroll position', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([album('search')], { page: 1, total: 1, hasMore: false }))
      .mockResolvedValueOnce(page([album('artist-sort')], { page: 1, total: 1, hasMore: false }));
    installLibrary(getAlbums);

    const { container } = renderAlbumsPage();
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 640;

    fireEvent.change(screen.getByPlaceholderText('Search albums / artists'), { target: { value: 'search' } });
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(pageSurface.scrollTop).toBe(0);

    pageSurface.scrollTop = 520;
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('option', { name: 'Artist' }));
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(3));
    expect(pageSurface.scrollTop).toBe(0);
  });

  it('library:changed reloads page 1', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([album('fresh')], { page: 1, total: 1, hasMore: false }));
    installLibrary(getAlbums);

    renderAlbumsPage();
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('library:changed'));

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(getAlbums).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1, pageSize: 60, search: '', sort: 'default' }));
  });

  it('refresh button reloads page 1 without rebuilding album grouping', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('stale')], { page: 1, total: 1, hasMore: false }))
      .mockResolvedValueOnce(page([], { page: 1, total: 0, hasMore: false }));
    const refreshAlbumGrouping = vi.fn();
    installLibrary(getAlbums);
    window.echo!.library.refreshAlbumGrouping = refreshAlbumGrouping;

    renderAlbumsPage();
    await screen.findByText('Album stale');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(refreshAlbumGrouping).not.toHaveBeenCalled();
    expect(getAlbums).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1, pageSize: 60, search: '', sort: 'default' }));
  });

  it('preserved library:changed refreshes a scrolled album wall without pulling it back to the top', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([album('fresh')], { page: 1, total: 120, hasMore: true }));
    installLibrary(getAlbums);

    const { container } = renderAlbumsPage();
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 640;

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(getAlbums).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 1, pageSize: 60, search: '', sort: 'default' }));
    expect(screen.getByText('Album fresh')).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(pageSurface.scrollTop).toBe(640);
  });

  it('preserved library:changed refreshes when the outer page surface is the scrolled element', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1')], { page: 1, total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([album('fresh')], { page: 1, total: 120, hasMore: true }));
    installLibrary(getAlbums);

    const { container } = renderAlbumsPage();
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(1));

    const outerPageSurface = container.querySelector('.page-surface') as HTMLElement;
    const albumWall = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(outerPageSurface);
    setScrollablePageSurface(albumWall);
    outerPageSurface.scrollTop = 640;
    albumWall.scrollTop = 0;

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));

    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Album fresh')).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(outerPageSurface.scrollTop).toBe(640);
  });

  it('retries transient album coverThumb errors before falling back', async () => {
    const getAlbums = vi.fn().mockResolvedValue(
      page([
        album('1', {
          title: 'Album',
          coverId: 'cover-1',
          coverThumb: 'echo-cover://album/cover-1',
        }),
      ]),
    );
    installLibrary(getAlbums);

    const { container } = renderAlbumsPage();

    await waitFor(() => expect(container.querySelector('.album-cover img')).toBeTruthy());
    const img = container.querySelector('.album-cover img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('echo-cover://album/cover-1');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('320');
    expect(img.getAttribute('height')).toBe('320');
    expect(img.draggable).toBe(false);

    vi.useFakeTimers();
    fireEvent.error(img);
    expect(container.querySelector('.album-cover img')).toBeTruthy();
    expect(container.querySelector('.album-cover')?.getAttribute('data-empty')).toBe('false');

    for (const retryDelay of [600, 1800, 3600]) {
      await act(async () => {
        vi.advanceTimersByTime(retryDelay);
      });
      const retryImg = container.querySelector('.album-cover img') as HTMLImageElement;
      expect(retryImg).toBeTruthy();
      expect(retryImg.getAttribute('src')).toBe('echo-cover://album/cover-1');
      fireEvent.error(retryImg);
    }

    expect(container.querySelector('.album-cover img')).toBeNull();
    expect(container.querySelector('.album-cover')?.getAttribute('data-empty')).toBe('true');
  });

  it('opens an album-specific context menu without opening the detail view', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([album('1')]));
    installLibrary(getAlbums);

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));

    expect(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /删除专辑|Delete album/u })).toBeTruthy();
    expect(screen.queryByLabelText('Album 1 album details')).toBeNull();
  });

  it('opens the album tag editor from the context menu and submits album-level fields', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([album('1')]));
    const updateAlbumTags = vi.fn().mockResolvedValue(album('1', { title: 'Renamed Album', albumArtist: 'New Artist', year: 2025 }));
    installLibrary(getAlbums);
    window.echo.library.updateAlbumTags = updateAlbumTags;

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u }));

    fireEvent.change(screen.getByLabelText(/^(专辑|Album)$/u), { target: { value: 'Renamed Album' } });
    fireEvent.change(screen.getByLabelText(/^(专辑艺术家|Album artist)$/u), { target: { value: 'New Artist' } });
    fireEvent.change(screen.getByLabelText(/^(年份|Year)$/u), { target: { value: '2025' } });
    fireEvent.change(screen.getByLabelText(/^(流派|Genre)$/u), { target: { value: 'Ambient' } });
    fireEvent.click(screen.getByRole('button', { name: /保存标签|Save tags/u }));

    await waitFor(() => expect(updateAlbumTags).toHaveBeenCalledWith({
      albumId: '1',
      tags: {
        album: 'Renamed Album',
        albumArtist: 'New Artist',
        year: 2025,
        genre: 'Ambient',
      },
      coverPath: null,
      coverUrl: null,
      coverMimeType: null,
    }));
    await screen.findByText('Renamed Album');
    expect(getAlbums).toHaveBeenCalledTimes(1);
  });

  it('loads album fields from embedded tags through a representative album track', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([album('1')]));
    const getAlbumTracks = vi.fn().mockResolvedValue(trackPage([track('track-1')]));
    const loadEmbeddedTrackTags = vi.fn().mockResolvedValue({
      tags: {
        title: 'Ignored Track Title',
        artist: 'Ignored Artist',
        album: 'Embedded Album',
        albumArtist: 'Embedded Album Artist',
        trackNo: 9,
        discNo: 1,
        year: 2024,
        genre: 'Jazz',
      },
      coverId: 'cover-embedded',
      coverThumb: 'echo-cover://thumb/cover-embedded',
      track: track('track-1', {
        album: 'Embedded Album',
        albumArtist: 'Embedded Album Artist',
        year: 2024,
        genre: 'Jazz',
        coverId: 'cover-embedded',
        coverThumb: 'echo-cover://thumb/cover-embedded',
      }),
    });
    installLibrary(getAlbums, vi.fn(), getAlbumTracks);
    window.echo.library.loadEmbeddedTrackTags = loadEmbeddedTrackTags;

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u }));
    fireEvent.click(screen.getByRole('button', { name: /嵌入|embedded/u }));

    await waitFor(() => expect(loadEmbeddedTrackTags).toHaveBeenCalledWith('track-1'));
    expect((screen.getByLabelText(/^(专辑|Album)$/u) as HTMLInputElement).value).toBe('Embedded Album');
    expect((screen.getByLabelText(/^(专辑艺术家|Album artist)$/u) as HTMLInputElement).value).toBe('Embedded Album Artist');
    expect((screen.getByLabelText(/^(年份|Year)$/u) as HTMLInputElement).value).toBe('2024');
    expect((screen.getByLabelText(/^(流派|Genre)$/u) as HTMLInputElement).value).toBe('Jazz');
  });

  it('opens the album tag editor representative track in Explorer', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([album('1')]));
    const getAlbumTracks = vi.fn().mockResolvedValue(trackPage([track('track-1')]));
    const openTrackInFolder = vi.fn().mockResolvedValue(undefined);
    installLibrary(getAlbums, vi.fn(), getAlbumTracks);
    window.echo.library.openTrackInFolder = openTrackInFolder;

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u }));
    fireEvent.click(screen.getByRole('button', { name: /资源管理器|Explorer|folder/u }));

    await waitFor(() => expect(getAlbumTracks).toHaveBeenCalledWith('1', { page: 1, pageSize: 1 }));
    expect(openTrackInFolder).toHaveBeenCalledWith('track-1');
  });

  it('applies network album candidates and submits the network cover url', async () => {
    const getAlbums = vi.fn().mockResolvedValue(page([album('1')]));
    const getAlbumTracks = vi.fn().mockResolvedValue(trackPage([track('track-1')]));
    const updateAlbumTags = vi.fn().mockResolvedValue(album('1', { title: 'Network Album', albumArtist: 'Network Artist', year: 2023 }));
    const searchNetworkTagCandidates = vi.fn().mockResolvedValue([
      {
        id: 'candidate-1',
        provider: 'mock',
        confidence: 0.6,
        title: 'Ignored Track Title',
        artist: 'Ignored Artist',
        album: 'Network Album',
        albumArtist: 'Network Artist',
        trackNo: 1,
        discNo: 1,
        year: 2023,
        genre: 'Electronic',
        duration: 180,
        coverUrl: 'https://example.test/cover.jpg',
        coverMimeType: 'image/jpeg',
        coverPreviewUrl: 'https://example.test/preview.jpg',
      },
    ]);
    installLibrary(getAlbums, vi.fn(), getAlbumTracks);
    window.echo.library.searchNetworkTagCandidates = searchNetworkTagCandidates;
    window.echo.library.updateAlbumTags = updateAlbumTags;

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u }));
    fireEvent.click(screen.getByRole('button', { name: /从网络加载|Load from network/u }));

    await waitFor(() => expect(searchNetworkTagCandidates).toHaveBeenCalledWith('track-1'));
    await waitFor(() => expect((screen.getByLabelText(/^(专辑|Album)$/u) as HTMLInputElement).value).toBe('Network Album'));
    fireEvent.click(screen.getByRole('button', { name: /保存标签|Save tags/u }));

    await waitFor(() => expect(updateAlbumTags).toHaveBeenCalledWith({
      albumId: '1',
      tags: {
        album: 'Network Album',
        albumArtist: 'Network Artist',
        year: 2023,
        genre: 'Electronic',
      },
      coverPath: null,
      coverUrl: 'https://example.test/cover.jpg',
      coverMimeType: 'image/jpeg',
    }));
  });

  it('deletes an album from the context menu after confirmation and reloads the wall', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1', { trackCount: 2 })]))
      .mockResolvedValueOnce(page([]));
    const deleteAlbumFiles = vi.fn().mockResolvedValue(undefined);
    installLibrary(getAlbums);
    window.echo.library.deleteAlbumFiles = deleteAlbumFiles;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /删除专辑|Delete album/u }));

    await waitFor(() => expect(deleteAlbumFiles).toHaveBeenCalledWith('1'));
    expect(String(confirm.mock.calls[0]?.[0] ?? '')).toMatch(/2 首歌曲|2 tracks/u);
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
  });

  it('deletes an album from the tag editor after confirmation and reloads the wall', async () => {
    const getAlbums = vi
      .fn()
      .mockResolvedValueOnce(page([album('1', { trackCount: 2 })]))
      .mockResolvedValueOnce(page([]));
    const deleteAlbumFiles = vi.fn().mockResolvedValue(undefined);
    installLibrary(getAlbums);
    window.echo.library.deleteAlbumFiles = deleteAlbumFiles;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.contextMenu(screen.getByText('Album 1'));
    fireEvent.click(screen.getByRole('menuitem', { name: /编辑标签|Edit tags/u }));
    fireEvent.click(screen.getByRole('button', { name: /删除专辑|Delete album/u }));

    await waitFor(() => expect(deleteAlbumFiles).toHaveBeenCalledWith('1'));
    expect(String(confirm.mock.calls[0]?.[0] ?? '')).toMatch(/2 首歌曲|2 tracks/u);
    await waitFor(() => expect(getAlbums).toHaveBeenCalledTimes(2));
  });

  it('clicking an album opens detail view and Back restores the album wall state', async () => {
    const getAlbums = vi.fn().mockResolvedValue(
      page([album('1', { coverId: 'cover-1', coverThumb: 'echo-cover://album/cover-1' })], { page: 1, total: 1, hasMore: false }),
    );
    const getAlbumTracks = vi.fn().mockResolvedValue(trackPage([track('track-1')]));
    installLibrary(getAlbums, vi.fn(), getAlbumTracks);

    const { container } = renderAlbumsPage();

    await screen.findByText('Album 1');
    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    const wallImage = container.querySelector('.album-cover img') as HTMLImageElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 640;
    fireEvent.click(screen.getByText('Album 1'));

    await screen.findByLabelText('Album 1 album details');
    expect(container.querySelector('.album-cover img')).toBe(wallImage);
    expect(getAlbumTracks).toHaveBeenCalledWith('1', { page: 1, pageSize: 100 });
    expect(container.querySelector('.album-detail-cover img')?.getAttribute('src')).toBe('echo-cover://original/cover-1');

    fireEvent.click(screen.getByRole('listitem'));
    await waitFor(() => expect(window.echo.playback.playLocalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'track-1',
        filePath: 'D:\\Music\\track-1.flac',
      }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    await waitFor(() => expect(screen.queryByLabelText('Album 1 album details')).toBeNull());
    expect(pageSurface.scrollTop).toBe(640);
    expect(container.querySelector('.album-cover img')).toBe(wallImage);
    expect(getAlbums).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Album 1')).toBeTruthy();
  });

  it('loads large cover for the album detail hero without changing the album wall thumbnail', async () => {
    const getAlbums = vi.fn().mockResolvedValue(
      page([album('1', { coverThumb: 'echo-cover://album/cover-1' })], { page: 1, total: 1, hasMore: false }),
    );
    const getAlbum = vi.fn().mockResolvedValue({
      ...album('1', { coverThumb: 'echo-cover://album/cover-1' }),
      coverLarge: 'echo-cover://large/cover-1',
    });
    installLibrary(getAlbums, vi.fn(), vi.fn().mockResolvedValue(trackPage([])), getAlbum);

    const { container } = renderAlbumsPage();

    await screen.findByText('Album 1');
    const wallImage = container.querySelector('.album-cover img') as HTMLImageElement;
    expect(wallImage.getAttribute('src')).toBe('echo-cover://album/cover-1');
    expect(wallImage.getAttribute('loading')).toBe('lazy');

    fireEvent.click(screen.getByText('Album 1'));

    const detailImage = await waitFor(() => {
      const image = container.querySelector('.album-detail-cover img') as HTMLImageElement | null;
      expect(image?.getAttribute('src')).toBe('echo-cover://large/cover-1');
      return image!;
    });
    expect(getAlbum).toHaveBeenCalledWith('1');
    expect(detailImage.getAttribute('loading')).toBeNull();
    expect(detailImage.getAttribute('decoding')).toBe('async');
    expect(detailImage.draggable).toBe(false);
  });

  it('falls back from a failed large cover to the album thumbnail in the detail hero', async () => {
    const getAlbums = vi.fn().mockResolvedValue(
      page([album('1', { coverThumb: 'echo-cover://album/cover-1' })], { page: 1, total: 1, hasMore: false }),
    );
    const getAlbum = vi.fn().mockResolvedValue({
      ...album('1', { coverThumb: 'echo-cover://album/cover-1' }),
      coverLarge: 'echo-cover://large/cover-1',
    });
    installLibrary(getAlbums, vi.fn(), vi.fn().mockResolvedValue(trackPage([])), getAlbum);

    const { container } = renderAlbumsPage();

    await screen.findByText('Album 1');
    fireEvent.click(screen.getByText('Album 1'));

    const largeImage = await waitFor(() => {
      const image = container.querySelector('.album-detail-cover img') as HTMLImageElement | null;
      expect(image?.getAttribute('src')).toBe('echo-cover://large/cover-1');
      return image!;
    });

    fireEvent.error(largeImage);

    await waitFor(() => {
      expect(container.querySelector('.album-detail-cover img')?.getAttribute('src')).toBe('echo-cover://album/cover-1');
    });
  });

  it('shows the album detail placeholder when there is no cover or when thumb fallback fails', async () => {
    const getAlbums = vi.fn().mockResolvedValueOnce(page([album('empty')], { page: 1, total: 1, hasMore: false }));
    installLibrary(getAlbums);

    const { container, unmount } = renderAlbumsPage();

    await screen.findByText('Album empty');
    fireEvent.click(screen.getByText('Album empty'));

    await screen.findByLabelText('Album empty album details');
    expect(container.querySelector('.album-detail-cover img')).toBeNull();
    expect(container.querySelector('.album-detail-cover')?.getAttribute('data-empty')).toBe('true');

    unmount();

    const getAlbumsWithThumb = vi.fn().mockResolvedValue(
      page([album('thumb', { coverThumb: 'echo-cover://album/cover-1' })], { page: 1, total: 1, hasMore: false }),
    );
    installLibrary(getAlbumsWithThumb);
    const rendered = renderAlbumsPage();

    await screen.findByText('Album thumb');
    fireEvent.click(screen.getByText('Album thumb'));

    const thumbImage = await waitFor(() => {
      const image = rendered.container.querySelector('.album-detail-cover img') as HTMLImageElement | null;
      expect(image?.getAttribute('src')).toBe('echo-cover://album/cover-1');
      return image!;
    });
    fireEvent.error(thumbImage);

    expect(rendered.container.querySelector('.album-detail-cover img')).toBeNull();
    expect(rendered.container.querySelector('.album-detail-cover')?.getAttribute('data-empty')).toBe('true');
  });

  it('playing the album starts the first loaded track and queues the loaded album tracks', async () => {
    const getAlbums = vi.fn().mockResolvedValue(
      page([album('1', { coverId: 'cover-1', coverThumb: 'echo-cover://album/cover-1' })], { page: 1, total: 1, hasMore: false }),
    );
    const first = track('track-1', { coverThumb: null });
    const second = track('track-2', { trackNo: 2 });
    const getAlbumTracks = vi.fn().mockResolvedValue(trackPage([first, second], { total: 2 }));
    installLibrary(getAlbums, vi.fn(), getAlbumTracks);

    renderAlbumsPageWithQueueProbe();

    await screen.findByText('Album 1');
    fireEvent.click(screen.getByText('Album 1'));

    const playButton = await screen.findByRole('button', { name: 'Play Now' });
    await waitFor(() => expect(playButton.hasAttribute('disabled')).toBe(false));
    expect(screen.getByLabelText('Album info').textContent).toContain('FLAC / 24bit / 96kHz / 900kbps');
    expect(screen.getByLabelText('Track summary').textContent).toContain('2 tracks');
    expect(screen.getByLabelText('Track summary').textContent).toContain('FLAC / 24bit / 96kHz');
    fireEvent.click(playButton);

    await waitFor(() => expect(window.echo.playback.playLocalFile).toHaveBeenCalledTimes(1));
    expect(window.echo.playback.playLocalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'track-1',
        filePath: 'D:\\Music\\track-1.flac',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('queue-state').textContent).toBe('2:track-1'));
  });
});
