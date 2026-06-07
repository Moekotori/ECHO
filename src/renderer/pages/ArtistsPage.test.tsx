// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArtistsPage } from './ArtistsPage';
import type { LibraryArtist, LibraryPage } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { requestArtistDetailNavigation } from '../utils/artistNavigation';

vi.mock('../components/artist/ArtistDetailView', () => ({
  ArtistDetailView: ({ artist, onBack }: { artist: LibraryArtist; onBack: () => void }) => (
    <div>
      <h1>Detail: {artist.name}</h1>
      <button type="button" onClick={onBack}>
        Back to artists
      </button>
    </div>
  ),
}));

const artist = (id: string, overrides: Partial<LibraryArtist> = {}): LibraryArtist => ({
  id,
  name: `Artist ${id}`,
  sortName: `artist ${id}`,
  role: 'track',
  trackCount: 4,
  albumCount: 1,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const page = (items: LibraryArtist[], overrides: Partial<LibraryPage<LibraryArtist>> = {}): LibraryPage<LibraryArtist> => ({
  items,
  page: 1,
  pageSize: 96,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (
  getArtists: ReturnType<typeof vi.fn>,
  getSettings: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ artistWallAlbumArtwork: false }),
): void => {
  window.echo = {
    app: {
      getSettings,
    },
    library: {
      getArtists,
      enqueueMissingArtistImages: vi.fn(),
      refreshAlbumGrouping: vi.fn(),
      refreshArtistImage: vi.fn(),
      refreshVisibleArtistImages: vi.fn(),
      getArtistImageStatus: vi.fn(),
      clearArtistImageCache: vi.fn(),
      onArtistImagesUpdated: vi.fn(() => () => undefined),
      getAlbums: vi.fn(),
      getTracks: vi.fn(),
      getAlbumTracks: vi.fn(),
      getArtist: vi.fn(),
      getArtistTracks: vi.fn(),
      getArtistAlbums: vi.fn(),
      getSummary: vi.fn(),
      chooseFolder: vi.fn(),
      addFolder: vi.fn(),
      getFolders: vi.fn(),
      removeFolder: vi.fn(),
      scanFolder: vi.fn(),
      getScanStatus: vi.fn(),
      cancelScan: vi.fn(),
      getDiagnostics: vi.fn(),
    },
  } as unknown as Window['echo'];
};

const renderArtistsPage = (): ReturnType<typeof render> =>
  render(
    <I18nProvider>
      <main className="page-surface">
        <ArtistsPage />
      </main>
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

describe('ArtistsPage', () => {
  it('loads artists from the desktop bridge', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1', { name: '安田レイ' })], { total: 12 }));
    installLibrary(getArtists);

    renderArtistsPage();

    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));
    expect(getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });
    expect(screen.getByText('安田レイ')).toBeTruthy();
    expect(screen.getByText('4 tracks / 1 albums')).toBeTruthy();
    expect(screen.getByText('安田')).toBeTruthy();
  });

  it('opens an artist detail from a cross-page navigation event', async () => {
    const targetArtist = artist('target', { name: 'BURTON' });
    const getArtists = vi.fn().mockResolvedValue(page([targetArtist]));
    installLibrary(getArtists);

    renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent('app:navigate:artist-detail', { detail: { artist: targetArtist } }));

    expect(await screen.findByText('Detail: BURTON')).toBeTruthy();
  });

  it('returns to songs when an artist detail was opened from the song list', async () => {
    const targetArtist = artist('target', { name: 'BURTON' });
    const navigateSongs = vi.fn();
    const getArtists = vi.fn().mockResolvedValue(page([targetArtist]));
    installLibrary(getArtists);
    window.addEventListener('app:navigate:songs', navigateSongs);

    renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new CustomEvent('app:navigate:artist-detail', { detail: { artist: targetArtist, returnTo: 'songs' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to artists' }));

    expect(navigateSongs).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Detail: BURTON')).toBeNull());
    window.removeEventListener('app:navigate:songs', navigateSongs);
  });

  it('returns to the album detail route when opened from an album detail artist link', async () => {
    const targetArtist = artist('target', { name: 'BURTON' });
    const navigateRoute = vi.fn<(event: Event) => void>();
    const getArtists = vi.fn().mockResolvedValue(page([targetArtist]));
    installLibrary(getArtists);
    window.addEventListener('app:navigate:route', navigateRoute);

    renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new CustomEvent('app:navigate:artist-detail', { detail: { artist: targetArtist, returnTo: 'albums' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to artists' }));

    expect(navigateRoute).toHaveBeenCalledWith(expect.objectContaining({ detail: 'albums' }));
    await waitFor(() => expect(screen.queryByText('Detail: BURTON')).toBeNull());
    window.removeEventListener('app:navigate:route', navigateRoute);
  });

  it('returns to home when an artist detail was opened from home', async () => {
    const targetArtist = artist('target', { name: 'BURTON' });
    const navigateRoute = vi.fn<(event: Event) => void>();
    const getArtists = vi.fn().mockResolvedValue(page([targetArtist]));
    installLibrary(getArtists);
    window.addEventListener('app:navigate:route', navigateRoute);

    renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new CustomEvent('app:navigate:artist-detail', { detail: { artist: targetArtist, returnTo: 'home' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to artists' }));

    expect(navigateRoute).toHaveBeenCalledWith(expect.objectContaining({ detail: 'home' }));
    window.removeEventListener('app:navigate:route', navigateRoute);
  });

  it('opens pending home artist detail on first paint without exposing the artist wall', () => {
    const targetArtist = artist('target', { name: 'BURTON' });
    const getArtists = vi.fn().mockResolvedValue(page([targetArtist]));
    installLibrary(getArtists);

    requestArtistDetailNavigation(targetArtist, { returnTo: 'home' });
    const { container } = renderArtistsPage();

    expect(screen.getByText('Detail: BURTON')).toBeTruthy();
    expect(container.querySelector('.artists-page')?.getAttribute('data-detail-open')).toBe('true');
  });

  it('loads the next artist page when the artist wall scrolls to the spacer bottom', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('1')], { page: 1, total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([artist('2')], { page: 2, total: 2, hasMore: false }));
    installLibrary(getArtists);

    const { container } = renderArtistsPage();

    await screen.findByLabelText('Artist list');
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    const sentinel = container.querySelector('.infinite-scroll-sentinel')!;
    setScrollablePageSurface(pageSurface);
    setSentinelReach(pageSurface, sentinel);
    pageSurface.scrollTop = 2000;
    fireEvent.scroll(pageSurface);

    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(getArtists).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });
    expect(screen.getByText('Artist 1')).toBeTruthy();
    expect(screen.getByText('Artist 2')).toBeTruthy();
  });

  it('search and sort reset artist loading to page 1', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('1')], { total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([artist('search', { name: '2hollis / Nate Sib' })], { total: 1 }))
      .mockResolvedValueOnce(page([artist('popular')], { total: 1 }));
    installLibrary(getArtists);

    renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Search artists'), { target: { value: '2hollis' } });
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(getArtists).toHaveBeenNthCalledWith(2, { page: 1, pageSize: 96, search: '2hollis', sort: 'default', sourceProvider: 'local' });

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('option', { name: 'Most Tracks' }));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(3));
    expect(getArtists).toHaveBeenNthCalledWith(3, { page: 1, pageSize: 96, search: '2hollis', sort: 'frequent', sourceProvider: 'local' });
  });

  it('can prioritize artists with avatars above the selected sort', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('1')], { total: 2 }))
      .mockResolvedValueOnce(page([artist('2', { avatarThumbUrl: 'echo-artist-image://thumb/artist-2', avatarStatus: 'matched' })], { total: 2 }))
      .mockResolvedValueOnce(page([artist('1')], { total: 2 }));
    installLibrary(getArtists);

    renderArtistsPage();

    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));
    expect(getArtists).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });

    fireEvent.click(screen.getByRole('button', { name: 'Avatar First' }));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(getArtists).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 96,
      search: '',
      sort: 'default',
      sourceProvider: 'local',
      prioritizeArtistAvatars: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Avatar First' }));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(3));
    expect(getArtists).toHaveBeenNthCalledWith(3, { page: 1, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });
  });

  it('search and sort reset the artist wall scroll position', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('1')], { total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([artist('search', { name: '2hollis / Nate Sib' })], { total: 1 }))
      .mockResolvedValueOnce(page([artist('popular')], { total: 1 }));
    installLibrary(getArtists);

    const { container } = renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 640;

    fireEvent.change(screen.getByPlaceholderText('Search artists'), { target: { value: '2hollis' } });
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(pageSurface.scrollTop).toBe(0);

    pageSurface.scrollTop = 520;
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    fireEvent.click(screen.getByRole('option', { name: 'Most Tracks' }));
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(3));
    expect(pageSurface.scrollTop).toBe(0);
  });

  it('preserved library:changed refreshes a scrolled artist wall without pulling it back to the top', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('1')], { total: 120, hasMore: true }))
      .mockResolvedValueOnce(page([artist('fresh')], { total: 120, hasMore: true }));
    installLibrary(getArtists);

    const { container } = renderArtistsPage();
    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(1));

    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 640;

    window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));

    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(getArtists).toHaveBeenNthCalledWith(2, { page: 1, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });
    expect(screen.getByText('Artist fresh')).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(pageSurface.scrollTop).toBe(640);
  });

  it('refresh button reloads page 1 without rebuilding album grouping', async () => {
    const getArtists = vi
      .fn()
      .mockResolvedValueOnce(page([artist('stale')], { page: 1, total: 1, hasMore: false }))
      .mockResolvedValueOnce(page([artist('fresh')], { page: 1, total: 1, hasMore: false }));
    const refreshAlbumGrouping = vi.fn();
    installLibrary(getArtists);
    window.echo!.library.refreshAlbumGrouping = refreshAlbumGrouping;

    renderArtistsPage();
    await screen.findByText('Artist stale');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getArtists).toHaveBeenCalledTimes(2));
    expect(refreshAlbumGrouping).not.toHaveBeenCalled();
    expect(getArtists).toHaveBeenNthCalledWith(2, { page: 1, pageSize: 96, search: '', sort: 'default', sourceProvider: 'local' });
    expect(screen.getByText('Artist fresh')).toBeTruthy();
  });

  it('opens artist detail on click and returns with Back', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1')]));
    installLibrary(getArtists);

    const { container } = renderArtistsPage();

    await screen.findByText('Artist 1');
    const pageSurface = container.querySelector('.media-wall-scroll-shell') as HTMLElement;
    setScrollablePageSurface(pageSurface);
    pageSurface.scrollTop = 580;
    fireEvent.click(screen.getByText('Artist 1').closest('[role="button"]')!);

    expect(screen.getByText('Detail: Artist 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to artists' }));

    expect(pageSurface.scrollTop).toBe(580);
    expect(screen.getByText('Artist 1')).toBeTruthy();
  });

  it('opens artist detail from Enter and Space keys', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1'), artist('2')]));
    installLibrary(getArtists);

    renderArtistsPage();

    await screen.findByText('Artist 1');
    fireEvent.keyDown(screen.getByText('Artist 1').closest('[role="button"]')!, { key: 'Enter' });
    expect(screen.getByText('Detail: Artist 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to artists' }));
    fireEvent.keyDown(screen.getByText('Artist 2').closest('[role="button"]')!, { key: ' ' });
    expect(screen.getByText('Detail: Artist 2')).toBeTruthy();
  });

  it('keeps the letter avatar when album artwork setting is disabled', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1', { coverId: 'cover-1', coverThumb: 'echo-cover://album/cover-1' })]));
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: false }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    expect(screen.getByText('AR')).toBeTruthy();
    expect(document.querySelector('.artist-avatar img')).toBeNull();
  });

  it('renders cached artist avatar before album artwork', async () => {
    const getArtists = vi.fn().mockResolvedValue(
      page([
        artist('1', {
          coverId: 'cover-1',
          coverThumb: 'echo-cover://album/cover-1',
          avatarThumbUrl: 'echo-artist-image://thumb/artist-1',
          avatarStatus: 'matched',
        }),
      ]),
    );
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: false, autoFetchArtistImages: false }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    const image = document.querySelector('.artist-avatar img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('echo-artist-image://thumb/artist-1');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(screen.queryByText('AR')).toBeNull();
  });

  it('refreshes the artist wall avatar after an artist image update reuses the same local URL', async () => {
    let emitArtistImagesUpdated: (payload: { artistId: string | null; artistKey: string; status: string }) => void = () => undefined;
    const getArtists = vi.fn().mockResolvedValue(
      page([
        artist('1', {
          avatarUrl: 'echo-artist-image://large/artist-1',
          avatarStatus: 'matched',
        }),
      ]),
    );
    const getArtist = vi.fn().mockResolvedValue(
      artist('1', {
        avatarThumbUrl: 'echo-artist-image://thumb/artist-1',
        avatarUrl: 'echo-artist-image://large/artist-1',
        avatarStatus: 'matched',
      }),
    );
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: false, autoFetchArtistImages: false }));
    window.echo!.library.getArtist = getArtist;
    window.echo!.library.onArtistImagesUpdated = vi.fn((callback: (payload: { artistId: string | null; artistKey: string; status: string }) => void) => {
      emitArtistImagesUpdated = callback;
      return vi.fn();
    });

    renderArtistsPage();

    await screen.findByText('Artist 1');
    const staleImage = document.querySelector('.artist-avatar img') as HTMLImageElement | null;
    expect(staleImage?.getAttribute('src')).toBe('echo-artist-image://large/artist-1');
    fireEvent.error(staleImage!);
    expect(document.querySelector('.artist-avatar img')).toBeNull();
    expect(screen.getByText('AR')).toBeTruthy();

    emitArtistImagesUpdated({ artistId: '1', artistKey: 'artist-1', status: 'matched' });

    await waitFor(() => expect(getArtist).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(document.querySelector('.artist-avatar img')?.getAttribute('src')).toBe('echo-artist-image://large/artist-1?v=1'));
    expect((document.querySelector('.artist-avatar img') as HTMLImageElement | null)?.getAttribute('srcset')).toBe(
      'echo-artist-image://thumb/artist-1?v=1 192w, echo-artist-image://large/artist-1?v=1 1024w',
    );
    expect(screen.queryByText('AR')).toBeNull();
  });

  it('queues current page artist avatars only when automatic fetching is enabled', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1'), artist('2')]));
    const refreshVisibleArtistImages = vi.fn().mockResolvedValue({ queued: 2, skipped: 0 });
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: false, autoFetchArtistImages: true }));
    window.echo!.library.refreshVisibleArtistImages = refreshVisibleArtistImages;

    renderArtistsPage();

    await waitFor(() => expect(refreshVisibleArtistImages).toHaveBeenCalledTimes(1));
    expect(refreshVisibleArtistImages).toHaveBeenCalledWith([
      { id: '1', name: 'Artist 1' },
      { id: '2', name: 'Artist 2' },
    ]);
  });

  it('renders album artwork when the artist wall artwork setting is enabled', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1', { coverId: 'cover-1', coverThumb: 'echo-cover://album/cover-1', coverSource: 'embedded' })]));
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: true }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    await waitFor(() => expect(document.querySelector('.artist-avatar img')).toBeTruthy());
    const image = document.querySelector('.artist-avatar img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('echo-cover://album/cover-1');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(screen.queryByText('AR')).toBeNull();
  });

  it('keeps the letter avatar when artist wall artwork only has the default cover', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1', {
      coverId: 'cover-1',
      coverThumb: 'echo-cover://album/cover-1',
      coverSource: 'default',
    })]));
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: true }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    expect(screen.getByText('AR')).toBeTruthy();
    expect(document.querySelector('.artist-avatar img')).toBeNull();
  });

  it('uses album artwork only for artists whose avatar lookup failed when fallback is enabled', async () => {
    const getArtists = vi.fn().mockResolvedValue(
      page([
        artist('1', {
          coverId: 'cover-1',
          coverThumb: 'echo-cover://album/cover-1',
          coverSource: 'embedded',
          avatarStatus: 'not_found',
        }),
        artist('2', {
          coverId: 'cover-2',
          coverThumb: 'echo-cover://album/cover-2',
          coverSource: 'embedded',
          avatarStatus: null,
        }),
        artist('3', {
          coverId: 'cover-3',
          coverThumb: 'echo-cover://album/cover-3',
          avatarThumbUrl: 'echo-artist-image://thumb/artist-3',
          avatarUrl: 'echo-artist-image://large/artist-3',
          avatarStatus: 'matched',
        }),
      ]),
    );
    installLibrary(getArtists, vi.fn().mockResolvedValue({
      artistWallAlbumArtwork: false,
      artistWallAlbumFallbackForMissingAvatars: true,
      autoFetchArtistImages: false,
    }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    const images = [...document.querySelectorAll('.artist-avatar img')] as HTMLImageElement[];
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'echo-cover://album/cover-1',
      'echo-artist-image://large/artist-3',
    ]);
    expect(screen.getByText('AR')).toBeTruthy();
  });

  it('falls back to the letter avatar when artist artwork fails to load', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('1', { coverId: 'cover-1', coverThumb: 'echo-cover://album/cover-1' })]));
    installLibrary(getArtists, vi.fn().mockResolvedValue({ artistWallAlbumArtwork: true }));

    renderArtistsPage();

    await screen.findByText('Artist 1');
    await waitFor(() => expect(document.querySelector('.artist-avatar img')).toBeTruthy());
    fireEvent.error(document.querySelector('.artist-avatar img')!);

    expect(screen.getByText('AR')).toBeTruthy();
    expect(document.querySelector('.artist-avatar img')).toBeNull();
  });
});
