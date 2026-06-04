// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AudioStatus } from '../../shared/types/audio';
import type {
  LibraryAlbum,
  LibraryArtist,
  LibrarySummary,
  LibraryTrack,
  PlaybackHistoryEntry,
  PlaybackHistorySummary,
  PlaybackStatsDashboard,
} from '../../shared/types/library';
import { albumDetailNavigationEvent } from '../utils/albumNavigation';
import { artistDetailNavigationEvent } from '../utils/artistNavigation';
import { translations, isLocale, localeOptions } from '../i18n/locales';
import { HomePage, defaultHomeHeroTitle, homeHeroTitleOptions, resetHomePageCacheForTest } from './HomePage';

const queueState = vi.hoisted(() => ({
  value: {
    currentTrack: null as LibraryTrack | null,
    lastPlayedTrack: null as LibraryTrack | null,
    playTrack: vi.fn(),
    replaceQueue: vi.fn(),
  },
}));

const sharedPlaybackState = vi.hoisted(() => ({
  value: {
    audioStatus: null as AudioStatus | null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
    version: 0,
  },
}));

vi.mock('../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueState.value,
}));

vi.mock('../stores/playbackStatusStore', () => ({
  useSharedPlaybackStatus: () => sharedPlaybackState.value,
}));

vi.mock('../i18n/I18nProvider', async () => {
  const actual = await vi.importActual<typeof import('../i18n/I18nProvider')>('../i18n/I18nProvider');
  const fallbackLocale = 'zh-CN' as const;
  const interpolate = (text: string, options?: Record<string, string | number>): string =>
    options
      ? Object.entries(options).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, String(value)), text)
      : text;
  const resolveLocale = (): keyof typeof translations => {
    const stored = window.localStorage.getItem('echo-next.locale');
    return isLocale(stored) ? stored : fallbackLocale;
  };

  return {
    ...actual,
    useI18n: () => {
      const locale = resolveLocale();
      return {
        locale,
        localeOptions,
        setLocale: vi.fn(),
        t: (key: keyof (typeof translations)[typeof fallbackLocale], options?: Record<string, string | number>) =>
          interpolate(translations[locale][key] ?? translations[fallbackLocale][key] ?? String(key), options),
      };
    },
  };
});

const summary = (overrides: Partial<LibrarySummary> = {}): LibrarySummary => ({
  songCount: 12,
  albumCount: 3,
  artistCount: 4,
  folderCount: 2,
  totalDuration: 7200,
  lastScanAt: '2026-05-25T08:00:00.000Z',
  ...overrides,
});

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  mediaType: 'local',
  path: `D:\\Music\\${id}.flac`,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
  ...overrides,
});

const album = (id: string, overrides: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id,
  mediaType: 'local',
  albumKey: `album:${id}`,
  title: `Album ${id}`,
  albumArtist: 'Artist',
  year: null,
  trackCount: 10,
  duration: 1800,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const visualSpectrumTelemetry = (values: number[]): number[] =>
  Array.from({ length: 32 }, (_, index) => {
    const sourceIndex = Math.min(values.length - 1, Math.floor((index / 32) * values.length));
    return values[sourceIndex] ?? 0;
  });

const artist = (id: string, overrides: Partial<LibraryArtist> = {}): LibraryArtist => ({
  id,
  mediaType: 'local',
  artistKey: `artist:${id}`,
  name: `Artist ${id}`,
  sortName: `Artist ${id}`,
  role: 'both',
  albumCount: 1,
  trackCount: 1,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const historyEntry = (id: string, overrides: Partial<PlaybackHistoryEntry> = {}): PlaybackHistoryEntry => ({
  id,
  trackId: id,
  trackPath: `D:\\Music\\${id}.flac`,
  mediaType: 'local',
  provider: null,
  providerTrackId: null,
  stableKey: null,
  title: `History ${id}`,
  artist: 'History Artist',
  album: 'History Album',
  albumArtist: 'History Artist',
  coverId: null,
  coverThumb: null,
  startedAt: '2026-05-25T09:00:00.000Z',
  endedAt: '2026-05-25T09:03:00.000Z',
  playedSeconds: 180,
  durationSeconds: 180,
  durationSnapshot: 180,
  coverSnapshot: null,
  playCount: 1,
  completed: true,
  sourceType: 'manual',
  sourceLabel: 'Songs',
  queueId: null,
  ...overrides,
});

const historySummary = (overrides: Partial<PlaybackHistorySummary> = {}): PlaybackHistorySummary => ({
  todayCount: 2,
  todayPlayedSeconds: 360,
  totalCount: 10,
  latestPlayedAt: '2026-05-25T09:00:00.000Z',
  rangeCount: 5,
  rangePlayedSeconds: 900,
  rangeLatestPlayedAt: '2026-05-25T09:00:00.000Z',
  ...overrides,
});

const stats = (overrides: Partial<PlaybackStatsDashboard> = {}): PlaybackStatsDashboard => ({
  generatedAt: '2026-05-25T09:00:00.000Z',
  totals: {
    playCount: 5,
    completedCount: 4,
    playedSeconds: 900,
    uniqueTracks: 3,
    uniqueArtists: 2,
  },
  topTracks: [],
  topArtists: [
    { artist: 'Aimer', playCount: 4, completedCount: 3, playedSeconds: 720 },
    { artist: 'Moe', playCount: 2, completedCount: 2, playedSeconds: 360 },
  ],
  topAlbums: [
    {
      id: 'favorite-1',
      albumId: 'favorite-album-1',
      mediaType: 'local',
      albumKey: 'favorite:1',
      title: 'Favorite Album One',
      albumArtist: 'Moe',
      year: null,
      trackCount: 8,
      duration: 1600,
      coverId: 'favorite-cover-1',
      coverThumb: 'echo-cover://album/favorite-cover-1',
      playCount: 9,
      completedCount: 8,
      playedSeconds: 1440,
      lastPlayedAt: '2026-05-25T09:00:00.000Z',
    },
    {
      id: 'favorite-2',
      albumId: 'favorite-album-2',
      mediaType: 'local',
      albumKey: 'favorite:2',
      title: 'Favorite Album Two',
      albumArtist: 'Aimer',
      year: null,
      trackCount: 10,
      duration: 1800,
      coverId: 'favorite-cover-2',
      coverThumb: 'echo-cover://album/favorite-cover-2',
      playCount: 7,
      completedCount: 7,
      playedSeconds: 1260,
      lastPlayedAt: '2026-05-25T08:00:00.000Z',
    },
    {
      id: 'favorite-3',
      albumId: 'favorite-album-3',
      mediaType: 'local',
      albumKey: 'favorite:3',
      title: 'Favorite Album Three',
      albumArtist: 'ECHO',
      year: null,
      trackCount: 9,
      duration: 1700,
      coverId: 'favorite-cover-3',
      coverThumb: 'echo-cover://album/favorite-cover-3',
      playCount: 5,
      completedCount: 5,
      playedSeconds: 900,
      lastPlayedAt: '2026-05-25T07:00:00.000Z',
    },
    {
      id: 'favorite-4',
      albumId: 'favorite-album-4',
      mediaType: 'local',
      albumKey: 'favorite:4',
      title: 'Favorite Album Four',
      albumArtist: 'Next',
      year: null,
      trackCount: 7,
      duration: 1400,
      coverId: 'favorite-cover-4',
      coverThumb: 'echo-cover://album/favorite-cover-4',
      playCount: 4,
      completedCount: 4,
      playedSeconds: 720,
      lastPlayedAt: '2026-05-25T06:00:00.000Z',
    },
    {
      id: 'favorite-5',
      albumId: 'favorite-album-5',
      mediaType: 'local',
      albumKey: 'favorite:5',
      title: 'Favorite Album Five',
      albumArtist: 'Hidden',
      year: null,
      trackCount: 6,
      duration: 1200,
      coverId: 'favorite-cover-5',
      coverThumb: 'echo-cover://album/favorite-cover-5',
      playCount: 3,
      completedCount: 3,
      playedSeconds: 540,
      lastPlayedAt: '2026-05-25T05:00:00.000Z',
    },
  ],
  formatBreakdown: [],
  qualityBreakdown: [],
  dailyActivity: [
    { date: '2026-05-19', playCount: 1, playedSeconds: 120 },
    { date: '2026-05-20', playCount: 2, playedSeconds: 360 },
  ],
  ...overrides,
});

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: items.length,
  total: items.length,
  hasMore: false,
});

const installLibraryMock = (overrides: Partial<NonNullable<Window['echo']>['library']> = {}) => {
  const getAlbumForTrack = vi.fn(async (trackId: string) => {
    if (trackId === 'recent-1') {
      return album('recent-album', { title: 'Album' });
    }
    if (trackId.startsWith('history-')) {
      return album(`played-album-${trackId}`, {
        title: trackId === 'history-1' ? 'Night Album' : `Played Album ${trackId}`,
        albumArtist: trackId === 'history-1' ? 'Night Artist' : 'History Artist',
        coverId: trackId === 'history-1' ? 'played-album-cover' : `played-album-cover-${trackId}`,
      });
    }

    return album(`album-${trackId}`);
  });
  const library = {
    getSummary: vi.fn().mockResolvedValue(summary()),
    getTracks: vi.fn().mockResolvedValue(page([
      track('recent-1', { title: 'Breeze', artist: 'Moe', coverId: 'recent-cover', coverThumb: 'echo-cover://thumb/recent-cover' }),
      track('recent-2', { title: 'Echo Bloom', coverId: 'recent-cover-2', coverThumb: 'echo-cover://thumb/recent-cover-2' }),
      track('recent-3', { title: 'Signal Blue', coverId: 'recent-cover-3', coverThumb: 'echo-cover://thumb/recent-cover-3' }),
      track('recent-4', { title: 'Glass Tide', coverId: 'recent-cover-4', coverThumb: 'echo-cover://thumb/recent-cover-4' }),
      track('recent-5', { title: 'Fifth Cover', coverId: 'recent-cover-5', coverThumb: 'echo-cover://thumb/recent-cover-5' }),
    ])),
    getPlaybackHistory: vi.fn().mockResolvedValue(page([
      historyEntry('history-1', { title: 'Night Signal', coverId: 'played-cover', coverThumb: 'echo-cover://thumb/played-cover' }),
      historyEntry('history-2', { title: 'Played Two', coverId: 'played-cover-2', coverThumb: 'echo-cover://thumb/played-cover-2' }),
      historyEntry('history-3', { title: 'Played Three', coverId: 'played-cover-3', coverThumb: 'echo-cover://thumb/played-cover-3' }),
      historyEntry('history-4', { title: 'Played Four', coverId: 'played-cover-4', coverThumb: 'echo-cover://thumb/played-cover-4' }),
      historyEntry('history-5', { title: 'Played Five', coverId: 'played-cover-5', coverThumb: 'echo-cover://thumb/played-cover-5' }),
    ])),
    getAlbums: vi.fn().mockResolvedValue(page([
      album('daily-1', { title: 'Daily Album One', albumArtist: 'Moe', coverId: 'daily-cover-1', coverThumb: 'echo-cover://album/daily-cover-1' }),
      album('daily-2', { title: 'Daily Album Two', albumArtist: 'Aimer', coverId: 'daily-cover-2', coverThumb: 'echo-cover://album/daily-cover-2' }),
      album('daily-3', { title: 'Daily Album Three', albumArtist: 'ECHO', coverId: 'daily-cover-3', coverThumb: 'echo-cover://album/daily-cover-3' }),
      album('daily-4', { title: 'Daily Album Four', albumArtist: 'Next', coverId: 'daily-cover-4', coverThumb: 'echo-cover://album/daily-cover-4' }),
      album('daily-5', { title: 'Daily Album Five', albumArtist: 'ECHO', coverId: 'daily-cover-5', coverThumb: 'echo-cover://album/daily-cover-5' }),
      album('daily-6', { title: 'Daily Album Six', albumArtist: 'Next', coverId: 'daily-cover-6', coverThumb: 'echo-cover://album/daily-cover-6' }),
      album('daily-7', { title: 'Daily Album Seven', albumArtist: 'Moe', coverId: 'daily-cover-7', coverThumb: 'echo-cover://album/daily-cover-7' }),
    ])),
    getAlbum: vi.fn(async (albumId: string) => {
      if (albumId === 'daily-1') {
        return { ...album('daily-1', { title: 'Daily Album One', albumArtist: 'Moe', coverId: 'daily-cover-1', coverThumb: 'echo-cover://album/daily-cover-1' }), coverLarge: null };
      }
      if (albumId === 'favorite-album-1') {
        return { ...album('favorite-album-1', { title: 'Favorite Album One', albumArtist: 'Moe', coverId: 'favorite-cover-1', coverThumb: 'echo-cover://album/favorite-cover-1' }), coverLarge: null };
      }

      return null;
    }),
    getArtists: vi.fn().mockResolvedValue(page([artist('artist-moe', { name: 'Moe', sortName: 'Moe' })])),
    getAlbumForTrack,
    getPlaybackHistorySummary: vi.fn().mockResolvedValue(historySummary()),
    getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats()),
    ...overrides,
  };

  window.echo = { library } as unknown as Window['echo'];
  return library;
};

const installAppSettingsMock = (
  settings: {
    homeRandomHeroTitleEnabled?: boolean;
    homeWaveformVisualizerEnabled?: boolean;
    audioVisualSpectrumEnabled?: boolean;
    lowLoadPlaybackModeEnabled?: boolean;
  } = {},
) => {
  const effectiveSettings = {
    homeRandomHeroTitleEnabled: false,
    homeWaveformVisualizerEnabled: settings.homeWaveformVisualizerEnabled ?? true,
    audioVisualSpectrumEnabled: settings.audioVisualSpectrumEnabled ?? (settings.homeWaveformVisualizerEnabled === true ? true : false),
    lowLoadPlaybackModeEnabled: false,
    ...settings,
  };
  const app = {
    getSettings: vi.fn().mockResolvedValue(effectiveSettings),
  };
  window.echo = {
    ...(window.echo ?? {}),
    app,
  } as unknown as Window['echo'];
  return app;
};

afterEach(() => {
  cleanup();
  resetHomePageCacheForTest();
  window.localStorage.removeItem('echo-next.locale');
  vi.restoreAllMocks();
  queueState.value.currentTrack = null;
  queueState.value.lastPlayedTrack = null;
  queueState.value.playTrack.mockReset();
  queueState.value.replaceQueue.mockReset();
  sharedPlaybackState.value.audioStatus = null;
  (window as unknown as { echo?: Window['echo'] }).echo = undefined;
});

const waitForRecentPanelReady = async (): Promise<void> => {
  await waitFor(() => {
    expect(document.querySelectorAll('.home-recent-panel .home-cover-card').length).toBeGreaterThan(0);
  });
};

describe('HomePage', () => {
  it('shows a desktop bridge fallback instead of crashing', async () => {
    render(<HomePage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('loads lightweight library and listening summaries', async () => {
    const library = installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(screen.queryByText('鏇插簱鑴夊啿')).toBeNull();
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('本周回声')).toBeTruthy();
    expect(document.querySelectorAll('.home-recent-panel .home-cover-card')).toHaveLength(4);
    expect(document.querySelector('.home-recent-panel .home-cover-card img')?.getAttribute('src')).toBe('echo-cover://large/daily-cover-1');
    expect(document.querySelectorAll('.home-recommend-panel .home-cover-card')).toHaveLength(7);
    expect(document.querySelector('.home-recommend-panel .home-cover-card img')?.getAttribute('src')).toMatch(/^echo-cover:\/\/large\/daily-cover-/);
    expect(document.querySelectorAll('.home-favorite-album-panel .home-favorite-album-card')).toHaveLength(4);
    expect(document.querySelector('.home-favorite-album-panel .home-favorite-album-card img')?.getAttribute('src')).toBe('echo-cover://large/favorite-cover-1');
    expect(within(document.querySelector('.home-favorite-album-panel') as HTMLElement).queryByText('Favorite Album Five')).toBeNull();
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 7, sort: 'default' });
    const contentGrid = document.querySelector('.home-content-grid');
    const recommendPanel = document.querySelector('.home-recommend-panel');
    expect(contentGrid && recommendPanel ? contentGrid.compareDocumentPosition(recommendPanel) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
    expect(within(document.querySelector('.home-recent-panel') as HTMLElement).queryByText('Daily Album Five')).toBeNull();
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('button', { name: /Night Album/ })).toBeTruthy();
    expect(document.querySelectorAll('.home-recent-panel .home-cover-card')).toHaveLength(4);
    expect(document.querySelector('.home-recent-panel .home-played-rail img')?.getAttribute('src')).toBe('echo-cover://large/played-album-cover');
    expect(library.getTracks).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(library.getPlaybackHistory).toHaveBeenCalledWith({ page: 1, pageSize: 12, sort: 'recent' });
  });

  it('persists the loaded home snapshot for the next launch', async () => {
    installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    await waitFor(() => expect(window.localStorage.getItem('echo-next.home-page-cache.v1')).toBeTruthy());
    const cached = JSON.parse(window.localStorage.getItem('echo-next.home-page-cache.v1') ?? '{}') as {
      data?: { recommendedAlbums?: unknown[]; summary?: Partial<LibrarySummary> };
      version?: number;
    };

    expect(cached.version).toBe(1);
    expect(cached.data?.summary?.songCount).toBe(12);
    expect(cached.data?.recommendedAlbums).toHaveLength(7);
  });

  it('renders translated home copy when locale is English', async () => {
    window.localStorage.setItem('echo-next.locale', 'en-US');
    installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(screen.getByText('Today Echo')).toBeTruthy();
    expect(screen.getByText('Weekly Echo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View queue' })).toBeTruthy();
  });

  it('caches recent playback history before album card resolution finishes', async () => {
    const getAlbumForTrack = vi.fn(() => new Promise<LibraryAlbum | null>(() => undefined));
    installLibraryMock({
      getAlbumForTrack,
      getPlaybackHistory: vi.fn().mockResolvedValue(page([
        historyEntry('history-pending', {
          album: 'Cached History Album',
          albumArtist: 'Cached Artist',
          coverThumb: 'echo-cover://thumb/cached-history-cover',
        }),
      ])),
    });

    render(<HomePage />);

    await waitFor(() => {
      const cached = JSON.parse(window.localStorage.getItem('echo-next.home-page-cache.v1') ?? '{}') as {
        data?: {
          recentHistory?: unknown[];
          recentPlayedAlbums?: Array<{ album?: Partial<LibraryAlbum> }>;
        };
      };
      expect(cached.data?.recentHistory).toHaveLength(1);
      expect(cached.data?.recentPlayedAlbums?.[0]?.album?.title).toBe('Cached History Album');
    });
    expect(getAlbumForTrack).toHaveBeenCalledWith('history-pending');
  });

  it('picks one random hero title and keeps it stable for the home session', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeRandomHeroTitleEnabled: true });
    expect(homeHeroTitleOptions).toEqual(expect.arrayContaining(['#define int long long']));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.62);

    render(<HomePage />);

    await waitForRecentPanelReady();
    const expectedTitle = homeHeroTitleOptions[Math.floor(0.62 * homeHeroTitleOptions.length)];
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(expectedTitle);
    expect(randomSpy).toHaveBeenCalledTimes(1);
    cleanup();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(expectedTitle);
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the fixed home title when random hero titles are disabled', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeRandomHeroTitleEnabled: false });
    vi.spyOn(Math, 'random').mockReturnValue(0.62);

    render(<HomePage />);

    await waitForRecentPanelReady();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(defaultHomeHeroTitle));
  });

  it('updates the home hero title when the random setting changes', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeRandomHeroTitleEnabled: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.62);

    render(<HomePage />);

    await waitForRecentPanelReady();
    const expectedTitle = homeHeroTitleOptions[Math.floor(0.62 * homeHeroTitleOptions.length)];
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(expectedTitle);

    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { homeRandomHeroTitleEnabled: false } }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(defaultHomeHeroTitle));

    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { homeRandomHeroTitleEnabled: true } }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(expectedTitle));
  });

  it('reuses cached home data when the page mounts again', async () => {
    const library = installLibraryMock();

    render(<HomePage />);
    await waitForRecentPanelReady();

    vi.mocked(library.getSummary).mockClear();
    vi.mocked(library.getTracks).mockClear();
    vi.mocked(library.getPlaybackHistory).mockClear();
    vi.mocked(library.getPlaybackHistorySummary).mockClear();
    vi.mocked(library.getPlaybackStatsDashboard).mockClear();
    vi.mocked(library.getAlbums).mockClear();
    vi.mocked(library.getAlbumForTrack).mockClear();
    cleanup();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(library.getSummary).not.toHaveBeenCalled();
    expect(library.getTracks).not.toHaveBeenCalled();
    expect(library.getPlaybackHistory).not.toHaveBeenCalled();
    expect(library.getPlaybackHistorySummary).not.toHaveBeenCalled();
    expect(library.getPlaybackStatsDashboard).not.toHaveBeenCalled();
    expect(library.getAlbums).not.toHaveBeenCalled();
    expect(library.getAlbumForTrack).not.toHaveBeenCalled();
  });

  it('repairs an empty cached home snapshot after the library becomes available', async () => {
    const emptyLibrary = installLibraryMock({
      getSummary: vi.fn().mockResolvedValue(summary({ songCount: 0, albumCount: 0, artistCount: 0, folderCount: 0, totalDuration: 0 })),
      getTracks: vi.fn().mockResolvedValue(page([])),
      getAlbums: vi.fn().mockResolvedValue(page([])),
      getPlaybackHistory: vi.fn().mockResolvedValue(page([])),
      getPlaybackHistorySummary: vi.fn().mockResolvedValue(historySummary({ todayCount: 0, totalCount: 0, rangeCount: 0 })),
      getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats({ topAlbums: [], topArtists: [] })),
    });

    render(<HomePage />);

    await waitFor(() => expect(emptyLibrary.getSummary).toHaveBeenCalled());
    await waitFor(() => expect(window.localStorage.getItem('echo-next.home-page-cache.v1')).toBeTruthy());
    cleanup();

    const library = installLibraryMock();
    render(<HomePage />);

    expect(screen.queryByRole('button', { name: /Daily Album One/ })).toBeNull();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Daily Album One/ }).length).toBeGreaterThan(0));
    expect(library.getSummary).toHaveBeenCalled();
    expect(library.getTracks).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 7, sort: 'default' });
  });

  it('manually refreshes the lightweight home library snapshot from an empty page', async () => {
    const getSummary = vi.fn().mockResolvedValue(summary({ songCount: 0, albumCount: 0, artistCount: 0, folderCount: 0, totalDuration: 0 }));
    const getTracks = vi.fn().mockResolvedValue(page([]));
    const getAlbums = vi.fn().mockResolvedValue(page([]));
    const getPlaybackHistory = vi.fn().mockResolvedValue(page([]));
    const getPlaybackHistorySummary = vi.fn().mockResolvedValue(historySummary({ todayCount: 0, totalCount: 0, rangeCount: 0 }));
    const getPlaybackStatsDashboard = vi.fn().mockResolvedValue(stats({ topAlbums: [], topArtists: [] }));
    const library = installLibraryMock({
      getSummary,
      getTracks,
      getAlbums,
      getPlaybackHistory,
      getPlaybackHistorySummary,
      getPlaybackStatsDashboard,
    });

    render(<HomePage />);

    await waitFor(() => expect(library.getSummary).toHaveBeenCalled());
    const playbackHistoryCallsBeforeRefresh = getPlaybackHistory.mock.calls.length;
    const playbackHistorySummaryCallsBeforeRefresh = getPlaybackHistorySummary.mock.calls.length;
    const playbackStatsDashboardCallsBeforeRefresh = getPlaybackStatsDashboard.mock.calls.length;
    getSummary.mockClear();
    getTracks.mockClear();
    getAlbums.mockClear();
    getSummary.mockResolvedValue(summary());
    getTracks.mockResolvedValue(page([
      track('recent-1', { title: 'Breeze', artist: 'Moe', coverId: 'recent-cover', coverThumb: 'echo-cover://thumb/recent-cover' }),
    ]));
    getAlbums.mockImplementation(async (query?: { sort?: string }) =>
      query?.sort === 'recent'
        ? page([album('manual-added', { title: 'Manual Added Album', coverId: 'manual-added-cover' })])
        : page([album('manual-recommendation', { title: 'Manual Recommendation', coverId: 'manual-recommendation-cover' })]),
    );

    const refreshButton = document.querySelectorAll<HTMLButtonElement>('.home-hero-actions .home-secondary-action')[1];
    fireEvent.click(refreshButton);

    expect(await screen.findByRole('button', { name: /Manual Added Album/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Manual Recommendation/ })).toBeTruthy();
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getTracks).toHaveBeenLastCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 7, sort: 'default' });
    expect(getPlaybackHistory).toHaveBeenCalledTimes(playbackHistoryCallsBeforeRefresh);
    expect(getPlaybackHistorySummary).toHaveBeenCalledTimes(playbackHistorySummaryCallsBeforeRefresh);
    expect(getPlaybackStatsDashboard).toHaveBeenCalledTimes(playbackStatsDashboardCallsBeforeRefresh);
  });

  it('keeps the selected recent activity tab when returning to home', async () => {
    installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    cleanup();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('false');
    expect(document.querySelector('.home-recent-panel .home-played-rail')).toBeTruthy();
  });

  it('refreshes recommendation albums without reloading playback or library pulses', async () => {
    const library = installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    vi.mocked(library.getSummary).mockClear();
    vi.mocked(library.getTracks).mockClear();
    vi.mocked(library.getPlaybackHistory).mockClear();
    vi.mocked(library.getPlaybackHistorySummary).mockClear();
    vi.mocked(library.getPlaybackStatsDashboard).mockClear();
    vi.mocked(library.getAlbums).mockClear();
    vi.mocked(library.getAlbums).mockResolvedValue(page([
      album('random-recommendation', { title: 'Random Recommendation', coverId: 'random-recommendation-cover' }),
    ]));

    const recommendPanel = document.querySelector('.home-recommend-panel') as HTMLElement;
    fireEvent.click(recommendPanel.querySelector('.home-section-header button') as HTMLButtonElement);

    expect(await within(recommendPanel).findByRole('button', { name: /Random Recommendation/ })).toBeTruthy();
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 7, sort: 'random' });
    expect(library.getSummary).not.toHaveBeenCalled();
    expect(library.getTracks).not.toHaveBeenCalled();
    expect(library.getPlaybackHistory).not.toHaveBeenCalled();
    expect(library.getPlaybackHistorySummary).not.toHaveBeenCalled();
    expect(library.getPlaybackStatsDashboard).not.toHaveBeenCalled();
  });

  it('navigates from library metric tiles', async () => {
    installLibraryMock();
    const navigate = vi.fn<(event: Event) => void>();
    window.addEventListener('app:navigate:route', navigate);

    try {
      render(<HomePage />);

      await waitForRecentPanelReady();
      const clickMetric = (index: number): string | undefined => {
        const buttons = document.querySelectorAll<HTMLButtonElement>('.home-metric-tile');
        fireEvent.click(buttons[index]);
        return (navigate.mock.calls.at(-1)?.[0] as CustomEvent<string> | undefined)?.detail;
      };

      expect(clickMetric(0)).toBe('songs');
      expect(clickMetric(1)).toBe('albums');
      expect(clickMetric(2)).toBe('artists');
      expect(clickMetric(3)).toBe('folders');
    } finally {
      window.removeEventListener('app:navigate:route', navigate);
    }
  });

  it('opens the album detail from a recent cover without starting playback', async () => {
    installLibraryMock();
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);

    try {
      render(<HomePage />);

      fireEvent.click((await screen.findAllByRole('button', { name: /Daily Album One/ }))[0]);

      expect(queueState.value.playTrack).not.toHaveBeenCalled();
      await waitFor(() =>
        expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
          expect.objectContaining({ album: expect.objectContaining({ id: 'daily-1' }), returnTo: 'home' }),
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: /Favorite Album One/ }));

      await waitFor(() =>
        expect((navigateAlbum.mock.calls[1]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
          expect.objectContaining({ album: expect.objectContaining({ id: 'favorite-album-1' }), returnTo: 'home' }),
        ),
      );
      expect(queueState.value.playTrack).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('recovers a stale recent-added album id before opening detail', async () => {
    const staleAlbum = album('stale-added-album', {
      albumKey: 'stale-added-key',
      title: 'Daily Album One',
      albumArtist: 'Moe',
      coverId: 'daily-cover-1',
      coverThumb: 'echo-cover://album/daily-cover-1',
    });
    const freshAlbum = album('fresh-added-album', {
      albumKey: 'fresh-added-key',
      title: 'Daily Album One',
      albumArtist: 'Moe',
      coverId: 'daily-cover-1',
      coverThumb: 'echo-cover://album/daily-cover-1',
    });
    const getAlbums = vi.fn(async (query?: { search?: string; sort?: string }) => {
      if (query?.search === 'Daily Album One') {
        return page([freshAlbum]);
      }
      if (query?.sort === 'recent') {
        return page([staleAlbum]);
      }

      return page([album('daily-recommendation', { title: 'Daily Recommendation', coverId: 'daily-recommendation-cover' })]);
    });
    const library = installLibraryMock({
      getAlbum: vi.fn().mockResolvedValue(null),
      getAlbums,
    });
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);

    try {
      render(<HomePage />);

      fireEvent.click(await screen.findByRole('button', { name: /Daily Album One/ }));

      await waitFor(() =>
        expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
          expect.objectContaining({ album: expect.objectContaining({ id: 'fresh-added-album' }), returnTo: 'home' }),
        ),
      );
      expect(library.getAlbum).toHaveBeenCalledWith('stale-added-album');
      expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Daily Album One' });
      expect(queueState.value.playTrack).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('recovers a favorite album id when the stats album has no readable tracks', async () => {
    const staleAlbum = album('favorite-album-1', {
      albumKey: 'favorite:1',
      title: 'Favorite Album One',
      albumArtist: 'Moe',
      coverId: 'favorite-cover-1',
      coverThumb: 'echo-cover://album/favorite-cover-1',
      trackCount: 8,
    });
    const freshAlbum = album('fresh-favorite-album-1', {
      albumKey: 'fresh-favorite:1',
      title: 'Favorite Album One',
      albumArtist: 'Moe',
      coverId: 'favorite-cover-1',
      coverThumb: 'echo-cover://album/favorite-cover-1',
      trackCount: 8,
    });
    const getAlbums = vi.fn(async (query?: { search?: string; sort?: string }) => {
      if (query?.search === 'Favorite Album One') {
        return page([staleAlbum, freshAlbum]);
      }

      return page([album('daily-recommendation', { title: 'Daily Recommendation', coverId: 'daily-recommendation-cover' })]);
    });
    const getAlbumTracks = vi.fn(async (albumId: string) =>
      albumId === 'fresh-favorite-album-1'
        ? page([track('fresh-favorite-track')])
        : page([]),
    );
    const library = installLibraryMock({
      getAlbum: vi.fn().mockResolvedValue({ ...staleAlbum, coverLarge: null }),
      getAlbumTracks,
      getAlbums,
    });
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);

    try {
      render(<HomePage />);

      fireEvent.click(await screen.findByRole('button', { name: /Favorite Album One/ }));

      await waitFor(() =>
        expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
          expect.objectContaining({ album: expect.objectContaining({ id: 'fresh-favorite-album-1' }), returnTo: 'home' }),
        ),
      );
      expect(library.getAlbum).toHaveBeenCalledWith('favorite-album-1');
      expect(getAlbumTracks).toHaveBeenCalledWith('favorite-album-1', { page: 1, pageSize: 1 });
      expect(getAlbumTracks).toHaveBeenCalledWith('fresh-favorite-album-1', { page: 1, pageSize: 1 });
      expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Favorite Album One' });
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('opens a favorite album without a stats album id by resolving it from the current album wall', async () => {
    const resolvedAlbum = album('resolved-favorite-album', {
      title: 'Resolved Favorite',
      albumArtist: 'Roselia',
      year: 2026,
      coverId: 'resolved-favorite-cover',
      coverThumb: 'echo-cover://album/resolved-favorite-cover',
    });
    const getAlbums = vi.fn(async (query?: { search?: string; sort?: string }) => {
      if (query?.search === 'Resolved Favorite') {
        return page([resolvedAlbum]);
      }

      return page([]);
    });
    installLibraryMock({
      getAlbums,
      getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats({
        topAlbums: [{
          id: 'stats-resolved-favorite',
          albumId: null,
          mediaType: 'local',
          albumKey: null,
          title: 'Resolved Favorite',
          albumArtist: 'Roselia',
          year: 2026,
          trackCount: 9,
          duration: 1800,
          coverId: 'stats-resolved-favorite-cover',
          coverThumb: 'echo-cover://album/stats-resolved-favorite-cover',
          playCount: 12,
          completedCount: 10,
          playedSeconds: 1200,
          lastPlayedAt: '2026-05-25T09:00:00.000Z',
        }],
      })),
    });
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);

    try {
      render(<HomePage />);

      const button = await screen.findByRole('button', { name: /Resolved Favorite/ });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(button);

      await waitFor(() =>
        expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
          expect.objectContaining({ album: expect.objectContaining({ id: 'resolved-favorite-album' }), returnTo: 'home' }),
        ),
      );
      expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Resolved Favorite' });
    } finally {
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('keeps a favorite album without a stats album id clickable and reports not found when no current album matches', async () => {
    const getAlbums = vi.fn(async () => page([]));
    installLibraryMock({
      getAlbums,
      getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats({
        topAlbums: [{
          id: 'stats-missing-favorite',
          albumId: null,
          mediaType: 'local',
          albumKey: null,
          title: 'Missing Favorite',
          albumArtist: 'Roselia',
          year: 2026,
          trackCount: 9,
          duration: 1800,
          coverId: null,
          coverThumb: null,
          playCount: 12,
          completedCount: 10,
          playedSeconds: 1200,
          lastPlayedAt: '2026-05-25T09:00:00.000Z',
        }],
      })),
    });

    render(<HomePage />);

    const button = await screen.findByRole('button', { name: /Missing Favorite/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toBe('未找到专辑：Missing Favorite');
    expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Missing Favorite' });
  });

  it('refreshes favorite albums by dropping entries that no longer resolve without reloading playback stats', async () => {
    const resolvedAlbum = album('resolved-refresh-favorite', {
      title: 'Refresh Keep',
      albumArtist: 'Roselia',
      coverId: 'refresh-keep-cover',
      coverThumb: 'echo-cover://album/refresh-keep-cover',
    });
    const getAlbums = vi.fn(async (query?: { search?: string; sort?: string }) => {
      if (query?.search === 'Refresh Keep') {
        return page([resolvedAlbum]);
      }
      if (query?.search === 'Refresh Missing') {
        return page([]);
      }

      return page([]);
    });
    const getPlaybackHistory = vi.fn().mockResolvedValue(page([]));
    const getPlaybackHistorySummary = vi.fn().mockResolvedValue(historySummary({ todayCount: 0, totalCount: 0, rangeCount: 0 }));
    const getPlaybackStatsDashboard = vi.fn().mockResolvedValue(stats({
      topAlbums: [
        {
          id: 'stats-refresh-keep',
          albumId: null,
          mediaType: 'local',
          albumKey: null,
          title: 'Refresh Keep',
          albumArtist: 'Roselia',
          year: null,
          trackCount: 9,
          duration: 1800,
          coverId: null,
          coverThumb: null,
          playCount: 12,
          completedCount: 10,
          playedSeconds: 1200,
          lastPlayedAt: '2026-05-25T09:00:00.000Z',
        },
        {
          id: 'stats-refresh-missing',
          albumId: null,
          mediaType: 'local',
          albumKey: null,
          title: 'Refresh Missing',
          albumArtist: 'Roselia',
          year: null,
          trackCount: 9,
          duration: 1800,
          coverId: null,
          coverThumb: null,
          playCount: 10,
          completedCount: 8,
          playedSeconds: 1000,
          lastPlayedAt: '2026-05-25T08:00:00.000Z',
        },
      ],
    }));
    installLibraryMock({
      getAlbums,
      getPlaybackHistory,
      getPlaybackHistorySummary,
      getPlaybackStatsDashboard,
    });

    render(<HomePage />);

    const panel = await screen.findByLabelText('你喜欢的专辑');
    expect(await within(panel).findByRole('button', { name: /Refresh Keep/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /Refresh Missing/ })).toBeTruthy();
    getPlaybackHistory.mockClear();
    getPlaybackHistorySummary.mockClear();
    getPlaybackStatsDashboard.mockClear();

    fireEvent.click(within(panel.closest('.home-favorite-album-panel') as HTMLElement).getByRole('button', { name: '刷新' }));

    await waitFor(() => expect(within(panel).queryByRole('button', { name: /Refresh Missing/ })).toBeNull());
    expect(within(panel).getByRole('button', { name: /Refresh Keep/ })).toBeTruthy();
    expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Refresh Keep' });
    expect(getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Refresh Missing' });
    expect(getPlaybackHistory).not.toHaveBeenCalled();
    expect(getPlaybackHistorySummary).not.toHaveBeenCalled();
    expect(getPlaybackStatsDashboard).not.toHaveBeenCalled();
  });

  it('opens hero artist and album links with home return targets', async () => {
    const library = installLibraryMock();
    const navigateArtist = vi.fn<(event: Event) => void>();
    const navigateAlbum = vi.fn<(event: Event) => void>();
    window.addEventListener(artistDetailNavigationEvent, navigateArtist);
    window.addEventListener(albumDetailNavigationEvent, navigateAlbum);

    try {
      render(<HomePage />);

      await waitForRecentPanelReady();
      const nowCard = document.querySelector('.home-now-card') as HTMLElement;
      expect(nowCard).toBeTruthy();

      fireEvent.click(within(nowCard).getByRole('button', { name: 'Moe' }));

      await waitFor(() =>
        expect(library.getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Moe', sort: 'default' }),
      );
      expect((navigateArtist.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
        expect.objectContaining({ artist: expect.objectContaining({ id: 'artist-moe' }), returnTo: 'home' }),
      );

      vi.mocked(library.getAlbumForTrack).mockClear();
      fireEvent.click(within(nowCard).getByRole('button', { name: 'Album' }));

      await waitFor(() => expect(library.getAlbumForTrack).toHaveBeenCalledWith('recent-1'));
      expect((navigateAlbum.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
        expect.objectContaining({ album: expect.objectContaining({ id: 'recent-album' }), returnTo: 'home' }),
      );
      expect(queueState.value.playTrack).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(artistDetailNavigationEvent, navigateArtist);
      window.removeEventListener(albumDetailNavigationEvent, navigateAlbum);
    }
  });

  it('renders an artist leaderboard and opens artist detail from home', async () => {
    const getArtists = vi.fn().mockResolvedValue(page([artist('artist-aimer', { name: 'Aimer', sortName: 'Aimer' })]));
    installLibraryMock({ getArtists });
    const navigateArtist = vi.fn<(event: Event) => void>();
    window.addEventListener(artistDetailNavigationEvent, navigateArtist);

    try {
      render(<HomePage />);

      await waitForRecentPanelReady();
      const panel = document.querySelector('.home-artist-rank-panel') as HTMLElement;
      expect(panel).toBeTruthy();
      await waitFor(() => expect(panel.querySelectorAll('.home-artist-rank-row')).toHaveLength(2));
      expect(panel.querySelector('.home-artist-avatar')).toBeNull();
      expect(panel.querySelector('.home-artist-rank-row[data-rank-lead="true"]')).toBeTruthy();
      expect(panel.textContent).toContain('Aimer');
      expect(panel.textContent).toContain('01');
      expect(panel.textContent).toContain('75%');

      fireEvent.click(within(panel).getByRole('button', { name: /Aimer/ }));

      await waitFor(() => expect(getArtists).toHaveBeenCalledWith({ page: 1, pageSize: 50, search: 'Aimer', sort: 'default' }));
      expect((navigateArtist.mock.calls[0]?.[0] as CustomEvent<unknown> | undefined)?.detail).toEqual(
        expect.objectContaining({ artist: expect.objectContaining({ id: 'artist-aimer' }), returnTo: 'home' }),
      );
    } finally {
      window.removeEventListener(artistDetailNavigationEvent, navigateArtist);
    }
  });

  it('keeps the hero continue button as the explicit playback action', async () => {
    installLibraryMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    fireEvent.click(document.querySelector<HTMLButtonElement>('.home-primary-action')!);

    await waitFor(() => expect(queueState.value.playTrack).toHaveBeenCalledTimes(1));
    expect(queueState.value.playTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recent-1', title: 'Breeze' }),
      expect.objectContaining({ source: { type: 'manual', label: 'ECHO Home' } }),
    );
  });

  it('generates a random queue from the hero without starting playback', async () => {
    const library = installLibraryMock();
    const navigate = vi.fn<(event: Event) => void>();
    window.addEventListener('app:navigate:route', navigate);

    try {
      render(<HomePage />);

      await waitForRecentPanelReady();
      vi.mocked(library.getTracks).mockClear();
      vi.mocked(library.getTracks).mockResolvedValueOnce(page([
        track('random-1', { title: 'Random One' }),
        track('random-2', { title: 'Random Two' }),
      ]));

      fireEvent.click(screen.getByRole('button', { name: /生成随机队列/ }));

      await waitFor(() => expect(library.getTracks).toHaveBeenCalledWith({ page: 1, pageSize: 36, sort: 'random', randomWindow: true }));
      await waitFor(() =>
        expect(queueState.value.replaceQueue).toHaveBeenCalledWith(
          [expect.objectContaining({ id: 'random-1' }), expect.objectContaining({ id: 'random-2' })],
          { startTrackId: undefined, source: { type: 'songs', label: '随机队列', sort: 'random' } },
        ),
      );
      expect(queueState.value.playTrack).not.toHaveBeenCalled();
      expect((navigate.mock.calls.at(-1)?.[0] as CustomEvent<string> | undefined)?.detail).toBe('queue');
    } finally {
      window.removeEventListener('app:navigate:route', navigate);
    }
  });

  it('uses shared native audio levels for the hero signal visualizer', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'asio',
      audioLevels: {
        inputPeakDb: -6,
        inputRmsDb: -16,
        estimatedOutputPeakDb: -5,
        estimatedOutputRmsDb: -15,
        headroomDb: 5,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const visualizer = document.querySelector('.home-signal-visualizer');

    expect(visualizer?.getAttribute('data-active')).toBe('true');
    expect(visualizer?.getAttribute('data-meter-ready')).toBe('true');
    expect(visualizer?.textContent).not.toContain('PRE-NATIVE');
    expect(visualizer?.textContent).not.toContain('ASIO');
    expect(visualizer?.textContent).not.toContain('SHARED');
    expect(document.querySelectorAll('.home-signal-bars i')).toHaveLength(48);
  });

  it('hides the home signal visualizer when the setting is disabled', async () => {
    installLibraryMock();
    const app = installAppSettingsMock({ homeWaveformVisualizerEnabled: false });

    render(<HomePage />);

    await waitForRecentPanelReady();
    await waitFor(() => {
      expect(app.getSettings).toHaveBeenCalled();
      expect(document.querySelector('.home-signal-visualizer')).toBeNull();
    });
    expect(document.querySelector('.home-now-card')?.getAttribute('data-signal-enabled')).toBe('false');
    expect(document.querySelectorAll('.home-signal-bars i')).toHaveLength(0);
  });

  it('keeps the home signal visualizer hidden by default', async () => {
    installLibraryMock();
    installAppSettingsMock();

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(document.querySelector('.home-signal-visualizer')).toBeNull();
    expect(document.querySelector('.home-now-card')?.getAttribute('data-signal-enabled')).toBe('false');
  });

  it('updates the home signal visualizer when settings change', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });

    render(<HomePage />);

    await waitForRecentPanelReady();
    expect(document.querySelectorAll('.home-signal-bars i')).toHaveLength(48);

    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { homeWaveformVisualizerEnabled: false } }));

    await waitFor(() => {
      expect(document.querySelector('.home-signal-visualizer')).toBeNull();
    });
    expect(document.querySelector('.home-now-card')?.getAttribute('data-signal-enabled')).toBe('false');
  });

  it('maps native visual spectrum telemetry without changing the hero visualizer shape', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -14,
        estimatedOutputPeakDb: -4,
        estimatedOutputRmsDb: -14,
        visualSpectrum: visualSpectrumTelemetry([0.9, 0.75, 0.5, 0.25, 0.12, 0.08, 0.06, 0.08, 0.14, 0.24, 0.38, 0.52]),
        visualSpectrumVersion: 2,
        visualEnergy: 0.72,
        visualTransient: 0.28,
        visualTelemetryState: 'pcm',
        headroomDb: 4,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const bars = document.querySelectorAll<HTMLElement>('.home-signal-bars i');
    const firstHeight = bars[0]?.style.getPropertyValue('--home-signal-height');
    const middleHeight = bars[22]?.style.getPropertyValue('--home-signal-height');
    const firstScale = Number(bars[0]?.style.getPropertyValue('--home-signal-scale') ?? '0');
    const middleScale = Number(bars[22]?.style.getPropertyValue('--home-signal-scale') ?? '0');

    expect(bars).toHaveLength(48);
    expect(document.querySelector('.home-signal-visualizer')?.textContent).not.toContain('EXCLUSIVE');
    expect(firstHeight).not.toBe('');
    expect(middleHeight).not.toBe('');
    expect(firstHeight).not.toBe(middleHeight);
    expect(firstScale).toBeGreaterThan(middleScale);
  });

  it('uses compositor animation variables so active spectrum bars move between telemetry updates', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -14,
        estimatedOutputPeakDb: -4,
        estimatedOutputRmsDb: -14,
        visualSpectrum: visualSpectrumTelemetry([0.9, 0.75, 0.5, 0.25, 0.12, 0.08, 0.06, 0.08, 0.14, 0.24, 0.38, 0.52]),
        visualSpectrumVersion: 2,
        visualEnergy: 0.72,
        visualTransient: 0.28,
        visualTelemetryState: 'pcm',
        headroomDb: 4,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const bars = document.querySelectorAll<HTMLElement>('.home-signal-bars i');
    const firstScale = Number(bars[0]?.style.getPropertyValue('--home-signal-scale') ?? '0');
    const firstMotion = Number(bars[0]?.style.getPropertyValue('--home-signal-motion') ?? '0');
    const durations = Array.from(bars)
      .slice(0, 4)
      .map((bar) => bar.style.getPropertyValue('--home-signal-duration'));

    expect(firstScale).toBeGreaterThan(0);
    expect(firstMotion).toBeGreaterThan(0);
    expect(new Set(durations).size).toBeGreaterThan(1);
  });

  it('uses visual transient telemetry to increase active bar motion', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    const visualSpectrum = visualSpectrumTelemetry([0.62, 0.58, 0.46, 0.34, 0.24, 0.2, 0.18, 0.2, 0.26, 0.36, 0.48, 0.56]);
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      audioLevels: {
        inputPeakDb: -8,
        inputRmsDb: -18,
        estimatedOutputPeakDb: -8,
        estimatedOutputRmsDb: -18,
        visualSpectrum,
        visualSpectrumVersion: 2,
        visualEnergy: 0.48,
        visualTransient: 0.02,
        visualTelemetryState: 'pcm',
        headroomDb: 8,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    const view = render(<HomePage />);

    await waitForRecentPanelReady();
    const firstMotion = Number(document.querySelector<HTMLElement>('.home-signal-bars i')?.style.getPropertyValue('--home-signal-motion') ?? '0');
    sharedPlaybackState.value.audioStatus = {
      ...(sharedPlaybackState.value.audioStatus as AudioStatus),
      audioLevels: {
        ...(sharedPlaybackState.value.audioStatus as AudioStatus).audioLevels!,
        visualTransient: 0.72,
      },
    };

    view.rerender(<HomePage />);

    const nextMotion = Number(document.querySelector<HTMLElement>('.home-signal-bars i')?.style.getPropertyValue('--home-signal-motion') ?? '0');
    expect(nextMotion).toBeGreaterThan(firstMotion);
  });

  it('keeps high startup priming spectrum from jumping into a large fake curve', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      positionSeconds: 0.18,
      audioLevels: {
        inputPeakDb: -3,
        inputRmsDb: -11,
        estimatedOutputPeakDb: -3,
        estimatedOutputRmsDb: -11,
        visualSpectrum: visualSpectrumTelemetry([0.92, 0.9, 0.86, 0.72, 0.58, 0.5, 0.44, 0.42, 0.48, 0.54, 0.58, 0.6]),
        visualSpectrumVersion: 2,
        visualEnergy: 0.42,
        visualTransient: 0.38,
        visualTelemetryState: 'priming',
        headroomDb: 3,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const visualizer = document.querySelector<HTMLElement>('.home-signal-visualizer');
    const bars = document.querySelectorAll<HTMLElement>('.home-signal-bars i');
    const scales = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-scale') || '0'));
    const motions = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-motion') || '0'));

    expect(visualizer?.dataset.telemetryState).toBe('priming');
    expect(Math.max(...scales)).toBeLessThan(0.36);
    expect(Math.max(...motions)).toBeLessThan(0.04);
  });

  it('keeps trusted silent PCM telemetry restrained instead of drawing a fake curve', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      positionSeconds: 18,
      audioLevels: {
        inputPeakDb: null,
        inputRmsDb: null,
        estimatedOutputPeakDb: null,
        estimatedOutputRmsDb: null,
        visualSpectrum: Array.from({ length: 32 }, () => 0),
        visualSpectrumVersion: 2,
        visualEnergy: 0,
        visualTransient: 0,
        visualTelemetryState: 'pcm',
        headroomDb: null,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const bars = document.querySelectorAll<HTMLElement>('.home-signal-bars i');
    const scales = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-scale') || '0'));
    const motions = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-motion') || '0'));

    expect(Math.max(...scales)).toBeLessThan(0.18);
    expect(Math.max(...motions)).toBeLessThan(0.06);
  });

  it('keeps startup priming telemetry from drawing a fake large curve', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      positionSeconds: 0.2,
      audioLevels: {
        inputPeakDb: null,
        inputRmsDb: null,
        estimatedOutputPeakDb: null,
        estimatedOutputRmsDb: null,
        visualSpectrum: Array.from({ length: 32 }, () => 0),
        visualSpectrumVersion: 2,
        visualEnergy: 0,
        visualTransient: 0,
        visualTelemetryState: 'pcm',
        headroomDb: null,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    render(<HomePage />);

    await waitForRecentPanelReady();
    const bars = document.querySelectorAll<HTMLElement>('.home-signal-bars i');
    const scales = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-scale') || '0'));
    const motions = Array.from(bars).map((bar) => Number(bar.style.getPropertyValue('--home-signal-motion') || '0'));

    expect(Math.max(...scales)).toBeLessThan(0.18);
    expect(Math.max(...motions)).toBeLessThan(0.06);
  });

  it('keeps signal animation timing stable when spectrum telemetry changes', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      outputMode: 'exclusive',
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -14,
        estimatedOutputPeakDb: -4,
        estimatedOutputRmsDb: -14,
        visualSpectrum: visualSpectrumTelemetry([0.9, 0.75, 0.5, 0.25, 0.12, 0.08, 0.06, 0.08, 0.14, 0.24, 0.38, 0.52]),
        visualSpectrumVersion: 2,
        visualEnergy: 0.72,
        visualTransient: 0.18,
        visualTelemetryState: 'pcm',
        headroomDb: 4,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    const view = render(<HomePage />);

    await waitForRecentPanelReady();
    const firstBar = document.querySelector<HTMLElement>('.home-signal-bars i');
    const firstDuration = firstBar?.style.getPropertyValue('--home-signal-duration');
    const firstScale = firstBar?.style.getPropertyValue('--home-signal-scale');
    sharedPlaybackState.value.audioStatus = {
      ...(sharedPlaybackState.value.audioStatus as AudioStatus),
      audioLevels: {
        ...(sharedPlaybackState.value.audioStatus as AudioStatus).audioLevels!,
        visualSpectrum: visualSpectrumTelemetry([0.08, 0.12, 0.18, 0.28, 0.5, 0.8, 0.95, 0.7, 0.44, 0.24, 0.14, 0.08]),
        visualEnergy: 0.64,
        visualTransient: 0.32,
      },
    };

    view.rerender(<HomePage />);

    const nextBar = document.querySelector<HTMLElement>('.home-signal-bars i');
    expect(nextBar?.style.getPropertyValue('--home-signal-duration')).toBe(firstDuration);
    expect(nextBar?.style.getPropertyValue('--home-signal-scale')).not.toBe(firstScale);
  });

  it('keeps real spectrum bars tied to telemetry instead of the track seed', async () => {
    installLibraryMock();
    installAppSettingsMock({ homeWaveformVisualizerEnabled: true });
    const visualSpectrum = visualSpectrumTelemetry([0.9, 0.75, 0.5, 0.25, 0.12, 0.08, 0.06, 0.08, 0.14, 0.24, 0.38, 0.52]);
    sharedPlaybackState.value.audioStatus = {
      state: 'playing',
      currentTrackId: 'seed-a',
      outputMode: 'exclusive',
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -14,
        estimatedOutputPeakDb: -4,
        estimatedOutputRmsDb: -14,
        visualSpectrum,
        visualSpectrumVersion: 2,
        visualEnergy: 0.72,
        visualTransient: 0.28,
        visualTelemetryState: 'pcm',
        headroomDb: 4,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
    } as AudioStatus;

    const view = render(<HomePage />);

    await waitForRecentPanelReady();
    const firstBars = Array.from(document.querySelectorAll<HTMLElement>('.home-signal-bars i')).map((bar) => ({
      duration: bar.style.getPropertyValue('--home-signal-duration'),
      motion: bar.style.getPropertyValue('--home-signal-motion'),
      scale: bar.style.getPropertyValue('--home-signal-scale'),
    }));

    sharedPlaybackState.value.audioStatus = {
      ...(sharedPlaybackState.value.audioStatus as AudioStatus),
      currentTrackId: 'seed-b',
    };

    view.rerender(<HomePage />);

    const nextBars = Array.from(document.querySelectorAll<HTMLElement>('.home-signal-bars i')).map((bar) => ({
      duration: bar.style.getPropertyValue('--home-signal-duration'),
      motion: bar.style.getPropertyValue('--home-signal-motion'),
      scale: bar.style.getPropertyValue('--home-signal-scale'),
    }));
    expect(nextBars).toEqual(firstBars);
  });

  it('refreshes only library pulse data on library changes', async () => {
    const library = installLibraryMock();
    render(<HomePage />);

    await waitForRecentPanelReady();
    vi.mocked(library.getSummary).mockClear();
    vi.mocked(library.getTracks).mockClear();
    vi.mocked(library.getPlaybackHistory).mockClear();
    vi.mocked(library.getPlaybackHistorySummary).mockClear();
    vi.mocked(library.getPlaybackStatsDashboard).mockClear();
    vi.mocked(library.getAlbums).mockClear();
    vi.mocked(library.getSummary).mockResolvedValue(summary({ songCount: 13 }));
    vi.mocked(library.getTracks).mockResolvedValue(page([track('recent-2', { title: 'Fresh Cover' })]));
    vi.mocked(library.getAlbums).mockImplementation(async (query) =>
      query?.sort === 'recent'
        ? page([album('fresh-added-album', { title: 'Fresh Added Album', coverId: 'fresh-added-cover' })])
        : page([album('daily-refresh', { title: 'Daily Refresh Album', coverId: 'daily-refresh-cover' })]),
    );

    window.dispatchEvent(new Event('library:changed'));

    expect(await screen.findByRole('button', { name: /Fresh Added Album/ })).toBeTruthy();
    expect(library.getSummary).toHaveBeenCalledTimes(1);
    expect(library.getTracks).toHaveBeenCalledTimes(1);
    expect(library.getAlbums).toHaveBeenCalledWith({ page: 1, pageSize: 8, sort: 'recent' });
    expect(library.getPlaybackHistory).not.toHaveBeenCalled();
    expect(library.getPlaybackHistorySummary).not.toHaveBeenCalled();
    expect(library.getPlaybackStatsDashboard).not.toHaveBeenCalled();
  });

  it('refreshes recently played album cards on playback history changes', async () => {
    const library = installLibraryMock();
    vi.mocked(library.getAlbumForTrack).mockImplementation(async (trackId: string) => {
      if (trackId === 'history-new') {
        return album('played-album-new', { title: 'Fresh Played Album', albumArtist: 'Fresh Artist', coverId: 'fresh-played-cover' });
      }

      return album(`played-album-${trackId}`, { title: `Played Album ${trackId}`, coverId: `played-cover-${trackId}` });
    });

    render(<HomePage />);

    await waitForRecentPanelReady();
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(await screen.findByRole('button', { name: /Played Album history-1/ })).toBeTruthy();

    vi.mocked(library.getPlaybackHistory).mockClear();
    vi.mocked(library.getPlaybackHistorySummary).mockClear();
    vi.mocked(library.getPlaybackStatsDashboard).mockClear();
    vi.mocked(library.getPlaybackHistory).mockResolvedValue(page([
      historyEntry('history-new', { title: 'Fresh Play', coverId: 'fresh-track-cover' }),
    ]));

    window.dispatchEvent(new Event('playback-history:changed'));

    expect(await screen.findByRole('button', { name: /Fresh Played Album/ })).toBeTruthy();
    expect(document.querySelector('.home-recent-panel .home-played-rail img')?.getAttribute('src')).toBe('echo-cover://large/fresh-played-cover');
    expect(library.getPlaybackHistory).toHaveBeenCalledWith({ page: 1, pageSize: 12, sort: 'recent' });
    expect(library.getPlaybackHistorySummary).not.toHaveBeenCalled();
    expect(library.getPlaybackStatsDashboard).not.toHaveBeenCalled();
  });

  it('places the currently playing album at the front of the played rail immediately', async () => {
    const currentTrack = track('current-played', {
      title: 'Current Song',
      artist: 'Current Artist',
      album: 'Current Played Album',
      albumArtist: 'Current Artist',
      coverId: 'current-track-cover',
      coverThumb: 'echo-cover://thumb/current-track-cover',
    });
    queueState.value.currentTrack = currentTrack;
    const library = installLibraryMock({
      getAlbumForTrack: vi.fn(async (trackId: string) => {
        if (trackId === 'current-played') {
          return album('current-played-album', {
            title: 'Current Played Album',
            albumArtist: 'Current Artist',
            coverId: 'current-played-cover',
          });
        }

        return album(`played-album-${trackId}`, { title: `Played Album ${trackId}`, coverId: `played-cover-${trackId}` });
      }),
    });

    render(<HomePage />);

    await screen.findAllByText(/Current Song/);
    fireEvent.click(screen.getAllByRole('tab')[0]);

    await waitFor(() =>
      expect(document.querySelector('.home-recent-panel .home-played-rail img')?.getAttribute('src')).toBe('echo-cover://large/current-played-cover'),
    );
    expect(within(document.querySelector('.home-played-rail') as HTMLElement).getByRole('button', { name: /Current Played Album/ })).toBeTruthy();
    expect(library.getAlbumForTrack).toHaveBeenCalledWith('current-played');
  });
});
