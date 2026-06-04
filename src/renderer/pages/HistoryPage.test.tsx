// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  LibraryPage,
  PlaybackHistoryEntry,
  PlaybackHistorySummary,
  PlaybackStatsDashboard,
} from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { HistoryPage, resetHistoryPageCacheForTest } from './HistoryPage';

const playbackQueueMock = vi.hoisted(() => ({
  appendToQueue: vi.fn(),
  playTrack: vi.fn().mockResolvedValue({}),
}));

vi.mock('../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => playbackQueueMock,
}));

vi.mock('../utils/albumNavigation', () => ({
  openAlbumDetailForTrack: vi.fn(),
}));

vi.mock('../utils/artistNavigation', () => ({
  openArtistDetailByName: vi.fn(),
}));

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

const historyPage = (
  items: PlaybackHistoryEntry[],
  overrides: Partial<LibraryPage<PlaybackHistoryEntry>> = {},
): LibraryPage<PlaybackHistoryEntry> => ({
  hasMore: overrides.hasMore ?? false,
  items,
  page: overrides.page ?? 1,
  pageSize: overrides.pageSize ?? 10,
  total: overrides.total ?? items.length,
});

const historySummary = (overrides: Partial<PlaybackHistorySummary> = {}): PlaybackHistorySummary => ({
  latestPlayedAt: '2026-05-25T09:00:00.000Z',
  rangeCount: 1,
  rangeLatestPlayedAt: '2026-05-25T09:00:00.000Z',
  rangePlayedSeconds: 180,
  todayCount: 1,
  todayPlayedSeconds: 180,
  totalCount: 1,
  ...overrides,
});

const stats = (): PlaybackStatsDashboard => ({
  dailyActivity: [
    {
      date: '2026-05-25',
      playCount: 3,
      playedSeconds: 540,
    },
  ],
  formatBreakdown: [{ id: 'flac', label: 'FLAC', playCount: 2, playedSeconds: 360 }],
  generatedAt: '2026-05-25T09:00:00.000Z',
  qualityBreakdown: [{ id: 'lossless', label: 'Lossless', playCount: 2, playedSeconds: 360 }],
  topAlbums: [],
  topArtists: [{ artist: 'History Artist', completedCount: 2, playCount: 3, playedSeconds: 540 }],
  topTracks: [
    {
      album: 'History Album',
      artist: 'History Artist',
      completedCount: 2,
      coverThumb: null,
      durationSeconds: 180,
      id: 'top-track',
      lastPlayedAt: '2026-05-25T09:00:00.000Z',
      playCount: 3,
      playedSeconds: 540,
      title: 'Top History Song',
      trackId: 'top-track',
    },
  ],
  totals: {
    completedCount: 2,
    playCount: 3,
    playedSeconds: 540,
    uniqueArtists: 1,
    uniqueTracks: 1,
  },
});

const installLibraryMock = (overrides: Partial<NonNullable<typeof window.echo>['library']> = {}) => {
  const library = {
    clearPlaybackHistory: vi.fn().mockResolvedValue(undefined),
    deletePlaybackHistoryEntry: vi.fn().mockResolvedValue(undefined),
    getPlaybackHistory: vi.fn().mockResolvedValue(historyPage([historyEntry('fresh')])),
    getPlaybackHistorySummary: vi.fn().mockResolvedValue(historySummary()),
    getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats()),
    refreshInvalidPlaybackHistory: vi.fn().mockResolvedValue({
      removedCount: 0,
      removedEntriesCount: 0,
      removedStatsCount: 0,
      scannedCount: 0,
    }),
    ...overrides,
  };

  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: { library },
  });

  return library;
};

const renderHistoryPage = () => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
  return render(
    <I18nProvider>
      <HistoryPage />
    </I18nProvider>,
  );
};

afterEach(() => {
  cleanup();
  resetHistoryPageCacheForTest();
  window.localStorage.removeItem('echo-next.locale');
  vi.restoreAllMocks();
  playbackQueueMock.appendToQueue.mockReset();
  playbackQueueMock.playTrack.mockReset();
  playbackQueueMock.playTrack.mockResolvedValue({});
  Object.defineProperty(window, 'echo', {
    configurable: true,
    value: undefined,
  });
});

describe('HistoryPage', () => {
  it('shows the stored history snapshot immediately on cold launch', () => {
    window.localStorage.setItem(
      'echo-next.history-page-cache.v1',
      JSON.stringify({
        data: {
          filter: 'all',
          hasMore: false,
          items: [historyEntry('cached', { title: 'Cached History Track' })],
          page: 1,
          recentItems: [historyEntry('recent-cached', { title: 'Cached Recent Track' })],
          search: '',
          stats: null,
          summary: historySummary(),
          total: 1,
        },
        savedAt: '2026-05-25T10:00:00.000Z',
        version: 1,
      }),
    );
    installLibraryMock({
      getPlaybackHistory: vi.fn(() => new Promise<LibraryPage<PlaybackHistoryEntry>>(() => undefined)),
    });

    renderHistoryPage();

    expect(screen.getByText('Cached History Track')).toBeTruthy();
    expect(screen.getByText('Cached Recent Track')).toBeTruthy();
  });

  it('persists the first history page after refresh', async () => {
    installLibraryMock({
      getPlaybackHistory: vi.fn().mockResolvedValue(historyPage([historyEntry('cached-before-stats')])),
    });

    renderHistoryPage();

    await screen.findAllByText('History cached-before-stats');
    await waitFor(() => {
      const cached = JSON.parse(window.localStorage.getItem('echo-next.history-page-cache.v1') ?? '{}') as {
        data?: { items?: Array<{ title?: string }>; recentItems?: Array<{ title?: string }> };
      };
      expect(cached.data?.items?.[0]?.title).toBe('History cached-before-stats');
      expect(cached.data?.recentItems?.[0]?.title).toBe('History cached-before-stats');
    });
  });

  it('loads a compact recently played list sorted by recency', async () => {
    const entries = [
      historyEntry('popular-old', { playCount: 8, startedAt: '2026-05-20T09:00:00.000Z' }),
      historyEntry('fresh-now', { playCount: 1, startedAt: '2026-05-25T11:00:00.000Z' }),
    ];
    const getPlaybackHistory = vi.fn((query?: { sort?: string }) =>
      Promise.resolve(query?.sort === 'recent'
        ? historyPage([entries[1], entries[0]])
        : historyPage([entries[0], entries[1]])),
    );
    const library = installLibraryMock({ getPlaybackHistory });

    renderHistoryPage();

    expect(await screen.findByText('Recently played')).toBeTruthy();
    expect((await screen.findAllByText('History fresh-now')).length).toBeGreaterThan(0);
    expect(library.getPlaybackHistory).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 8,
      sort: 'recent',
    }));
  });

  it('restores the stats dashboard after the first history page renders', async () => {
    const library = installLibraryMock({
      getPlaybackHistory: vi.fn().mockResolvedValue(historyPage([historyEntry('pretty')])),
    });

    renderHistoryPage();

    await screen.findAllByText('History pretty');
    await waitFor(() => expect(library.getPlaybackStatsDashboard).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('播放统计仪表盘')).toBeTruthy();
    expect(screen.getByText('Top History Song')).toBeTruthy();
  });

  it('defers the stats dashboard refresh while playback is active', async () => {
    const library = installLibraryMock({
      getPlaybackHistory: vi.fn().mockResolvedValue(historyPage([historyEntry('active-playback')])),
      getPlaybackStatsDashboard: vi.fn().mockResolvedValue(stats()),
    });
    const getAudioStatus = vi.fn().mockResolvedValue({ state: 'playing' });
    const getPlaybackStatus = vi.fn().mockResolvedValue({ state: 'playing' });
    Object.defineProperty(window, 'echo', {
      configurable: true,
      value: {
        audio: { getStatus: getAudioStatus },
        library,
        playback: { getStatus: getPlaybackStatus },
      },
    });

    renderHistoryPage();

    await screen.findAllByText('History active-playback');
    await waitFor(() => expect(getAudioStatus).toHaveBeenCalled());
    expect(getPlaybackStatus).toHaveBeenCalled();
    expect(library.getPlaybackStatsDashboard).not.toHaveBeenCalled();
  });

  it('refreshes invalid history entries without clearing the whole history', async () => {
    const library = installLibraryMock({
      getPlaybackHistory: vi.fn()
        .mockResolvedValueOnce(historyPage([historyEntry('missing')]))
        .mockResolvedValue(historyPage([])),
      refreshInvalidPlaybackHistory: vi.fn().mockResolvedValue({
        removedCount: 1,
        removedEntriesCount: 2,
        removedStatsCount: 1,
        scannedCount: 1,
      }),
    });

    renderHistoryPage();

    await screen.findByText('History missing');
    fireEvent.click(screen.getByRole('button', { name: /Refresh invalid songs/i }));

    await waitFor(() => expect(library.refreshInvalidPlaybackHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(library.getPlaybackHistory).toHaveBeenCalledTimes(4));
    expect(library.clearPlaybackHistory).not.toHaveBeenCalled();
    expect(await screen.findByText('Removed 1 invalid history songs.')).toBeTruthy();
  });

  it('loads more history manually without playback controls', async () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      historyEntry(`rank-${index}`, {
        playCount: 20 - index,
        startedAt: `2026-05-25T09:${String(index).padStart(2, '0')}:00.000Z`,
      }),
    );
    const library = installLibraryMock({
      getPlaybackHistory: vi.fn((query?: { page?: number; sort?: string }) => {
        if (query?.sort === 'recent') {
          return Promise.resolve(historyPage(entries.slice(0, 8), { hasMore: true, page: 1, total: 12 }));
        }
        if (query?.page === 2) {
          return Promise.resolve(historyPage(entries.slice(10), { hasMore: false, page: 2, total: 12 }));
        }
        return Promise.resolve(historyPage(entries.slice(0, 10), { hasMore: true, page: 1, total: 12 }));
      }),
    });

    renderHistoryPage();

    await screen.findAllByText('History rank-0');
    expect(screen.queryByText('History rank-10')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByRole('button', { name: /Play History/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add to queue/i })).toBeNull();
    expect(playbackQueueMock.playTrack).not.toHaveBeenCalled();
    expect(playbackQueueMock.appendToQueue).not.toHaveBeenCalled();
    expect(library.getPlaybackHistory).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10, sort: 'plays' }));

    fireEvent.click(screen.getByRole('button', { name: /Load more/i }));

    await screen.findByText('History rank-11');
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(library.getPlaybackHistory).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10, sort: 'plays' }));
  });

  it('removes a single history entry without touching playback', async () => {
    const library = installLibraryMock({
      getPlaybackHistory: vi.fn().mockResolvedValue(historyPage([historyEntry('delete-me'), historyEntry('keep')])),
    });

    renderHistoryPage();

    await screen.findAllByText('History delete-me');
    fireEvent.click(screen.getByRole('button', { name: '从历史移除 History delete-me' }));

    await waitFor(() => expect(library.deletePlaybackHistoryEntry).toHaveBeenCalledWith('delete-me'));
    expect(screen.queryByText('History delete-me')).toBeNull();
    expect(screen.getAllByText('History keep').length).toBeGreaterThan(0);
    expect(playbackQueueMock.playTrack).not.toHaveBeenCalled();
    expect(playbackQueueMock.appendToQueue).not.toHaveBeenCalled();
  });
});
