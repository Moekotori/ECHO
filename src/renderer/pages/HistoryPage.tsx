import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, CalendarDays, Clock3, Disc3, ListX, Music2, Radio, RefreshCw, Search, Trash2, Trophy } from 'lucide-react';
import type {
  LibraryTrack,
  PlaybackHistoryEntry,
  PlaybackHistoryQuery,
  PlaybackHistorySummary,
  PlaybackStatsArtist,
  PlaybackStatsBreakdownItem,
  PlaybackStatsDashboard,
  PlaybackStatsDay,
  PlaybackStatsTrack,
} from '../../shared/types/library';
import { useI18n } from '../i18n/I18nProvider';
import { openAlbumDetailForTrack } from '../utils/albumNavigation';
import { openArtistDetailByName } from '../utils/artistNavigation';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';

const pageSize = 10;
const recentPlaybackPageSize = 8;
const historyPageCacheStorageKey = 'echo-next.history-page-cache.v1';
const historyPageCacheVersion = 1;
const isHistoryPageTestRuntime = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
const historyCachedRefreshDelayMs = isHistoryPageTestRuntime ? 0 : 900;
const historyStatsRefreshDelayMs = isHistoryPageTestRuntime ? 0 : 1600;
const historyStatsPlaybackDeferDelayMs = 15_000;
const historyStatsDeferredPlaybackStates = new Set(['loading', 'playing']);

type HistoryFilter = 'all' | 'today' | 'week' | 'month' | 'completed';

type HistoryPageData = {
  filter: HistoryFilter;
  hasMore: boolean;
  items: PlaybackHistoryEntry[];
  page: number;
  recentItems: PlaybackHistoryEntry[];
  search: string;
  stats: PlaybackStatsDashboard | null;
  summary: PlaybackHistorySummary | null;
  total: number;
};

type StoredHistoryPageCache = {
  data: HistoryPageData;
  savedAt: string;
  version: typeof historyPageCacheVersion;
};

type HistoryPageTranslationKey = Parameters<ReturnType<typeof useI18n>['t']>[0];

const filterLabelKeys: Record<HistoryFilter, HistoryPageTranslationKey> = {
  all: 'historyPage.filter.all',
  today: 'historyPage.filter.today',
  week: 'historyPage.filter.week',
  month: 'historyPage.filter.month',
  completed: 'historyPage.filter.completed',
};

const filterSummaryLabelKeys: Record<HistoryFilter, { count: HistoryPageTranslationKey; duration: HistoryPageTranslationKey; tracks: HistoryPageTranslationKey; latest: HistoryPageTranslationKey; group: HistoryPageTranslationKey }> = {
  all: {
    count: 'historyPage.summary.all.count',
    duration: 'historyPage.summary.all.duration',
    tracks: 'historyPage.summary.all.tracks',
    latest: 'historyPage.summary.all.latest',
    group: 'historyPage.summary.all.group',
  },
  today: {
    count: 'historyPage.summary.today.count',
    duration: 'historyPage.summary.today.duration',
    tracks: 'historyPage.summary.today.tracks',
    latest: 'historyPage.summary.today.latest',
    group: 'historyPage.summary.today.group',
  },
  week: {
    count: 'historyPage.summary.week.count',
    duration: 'historyPage.summary.week.duration',
    tracks: 'historyPage.summary.week.tracks',
    latest: 'historyPage.summary.week.latest',
    group: 'historyPage.summary.week.group',
  },
  month: {
    count: 'historyPage.summary.month.count',
    duration: 'historyPage.summary.month.duration',
    tracks: 'historyPage.summary.month.tracks',
    latest: 'historyPage.summary.month.latest',
    group: 'historyPage.summary.month.group',
  },
  completed: {
    count: 'historyPage.summary.completed.count',
    duration: 'historyPage.summary.completed.duration',
    tracks: 'historyPage.summary.completed.tracks',
    latest: 'historyPage.summary.completed.latest',
    group: 'historyPage.summary.completed.group',
  },
};

const emptyHistoryPageData: HistoryPageData = {
  filter: 'all',
  hasMore: false,
  items: [],
  page: 1,
  recentItems: [],
  search: '',
  stats: null,
  summary: null,
  total: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isHistoryFilter = (value: unknown): value is HistoryFilter =>
  value === 'all' || value === 'today' || value === 'week' || value === 'month' || value === 'completed';

const isDefaultHistoryQuery = (filter: HistoryFilter, search: string): boolean => filter === 'all' && search.trim().length === 0;

const hasHistoryPageData = (data: HistoryPageData | null): boolean =>
  Boolean(data && (data.items.length > 0 || data.recentItems.length > 0 || data.total > 0 || data.summary || data.stats));

const sortHistoryItems = (items: PlaybackHistoryEntry[]): PlaybackHistoryEntry[] =>
  [...items]
    .sort((left, right) => right.playCount - left.playCount || Date.parse(right.startedAt) - Date.parse(left.startedAt));

const sortRecentHistoryItems = (items: PlaybackHistoryEntry[]): PlaybackHistoryEntry[] =>
  [...items]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.playCount - left.playCount);

const mergeHistoryItems = (
  currentItems: PlaybackHistoryEntry[],
  nextItems: PlaybackHistoryEntry[],
  mode: 'replace' | 'append',
): PlaybackHistoryEntry[] => {
  if (mode === 'replace') {
    return sortHistoryItems(nextItems);
  }

  const itemsById = new Map<string, PlaybackHistoryEntry>();
  for (const item of currentItems) {
    itemsById.set(item.id, item);
  }
  for (const item of nextItems) {
    itemsById.set(item.id, item);
  }
  return sortHistoryItems(Array.from(itemsById.values()));
};

const normalizeStoredHistoryPageData = (value: unknown): HistoryPageData | null => {
  if (!isRecord(value)) {
    return null;
  }

  const filter = isHistoryFilter(value.filter) ? value.filter : 'all';
  const search = typeof value.search === 'string' ? value.search : '';
  const page = Number(value.page);
  const total = Number(value.total);

  if (!isDefaultHistoryQuery(filter, search)) {
    return null;
  }

  return {
    filter,
    hasMore: value.hasMore === true,
    items: Array.isArray(value.items) ? sortHistoryItems(value.items as PlaybackHistoryEntry[]) : [],
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
    recentItems: Array.isArray(value.recentItems) ? sortRecentHistoryItems(value.recentItems as PlaybackHistoryEntry[]) : [],
    search,
    stats: isRecord(value.stats) ? (value.stats as PlaybackStatsDashboard) : null,
    summary: isRecord(value.summary) ? (value.summary as PlaybackHistorySummary) : null,
    total: Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0,
  };
};

const readStoredHistoryPageData = (): HistoryPageData | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(historyPageCacheStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredHistoryPageCache>;
    if (parsed.version !== historyPageCacheVersion) {
      return null;
    }

    return normalizeStoredHistoryPageData(parsed.data);
  } catch {
    return null;
  }
};

const writeStoredHistoryPageData = (data: HistoryPageData): void => {
  if (typeof window === 'undefined' || !isDefaultHistoryQuery(data.filter, data.search)) {
    return;
  }

  try {
    window.localStorage.setItem(
      historyPageCacheStorageKey,
      JSON.stringify({
        data,
        savedAt: new Date().toISOString(),
        version: historyPageCacheVersion,
      } satisfies StoredHistoryPageCache),
    );
  } catch {
    // History cache is best-effort; it should never make navigation or playback heavier.
  }
};

let cachedHistoryPageData: HistoryPageData | null = null;

const getInitialHistoryPageData = (): HistoryPageData => {
  if (cachedHistoryPageData) {
    return cachedHistoryPageData;
  }

  const stored = readStoredHistoryPageData();
  if (stored) {
    cachedHistoryPageData = stored;
    return stored;
  }

  return emptyHistoryPageData;
};

const setCachedHistoryPageData = (data: HistoryPageData): HistoryPageData => {
  cachedHistoryPageData = data;
  writeStoredHistoryPageData(data);
  return data;
};

const mergeCachedHistoryPageData = (patch: Partial<HistoryPageData>): HistoryPageData =>
  setCachedHistoryPageData({
    ...(cachedHistoryPageData ?? emptyHistoryPageData),
    ...patch,
  });

export const resetHistoryPageCacheForTest = (): void => {
  cachedHistoryPageData = null;
  try {
    window.localStorage.removeItem(historyPageCacheStorageKey);
  } catch {
    // Ignore unavailable storage in non-browser test environments.
  }
};

const scheduleHistoryWork = (callback: () => void, delayMs = 0): (() => void) => {
  if (typeof window === 'undefined') {
    callback();
    return () => undefined;
  }

  let frameId: number | null = null;
  let timeoutId: number | null = null;
  const run = (): void => {
    frameId = null;
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      callback();
    }, delayMs);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    frameId = window.requestAnimationFrame(run);
  } else {
    run();
  }

  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const shouldDeferHistoryStatsForPlayback = async (): Promise<boolean> => {
  const echo = window.echo;
  if (!echo) {
    return false;
  }

  try {
    const [audioStatus, playbackStatus] = await Promise.all([
      echo.audio?.getStatus?.().catch(() => null) ?? Promise.resolve(null),
      echo.playback?.getStatus?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    const state = audioStatus?.state ?? playbackStatus?.state ?? 'idle';
    return historyStatsDeferredPlaybackStates.has(state);
  } catch {
    return false;
  }
};

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const compareDay = (left: Date, right: Date): number =>
  startOfDay(left).getTime() - startOfDay(right).getTime();

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfWeek = (date: Date): Date => {
  const next = startOfDay(date);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
};

const historyFilterRange = (filter: HistoryFilter): Pick<PlaybackHistoryQuery, 'from' | 'to' | 'completedOnly'> => {
  const now = new Date();
  const today = startOfDay(now);

  if (filter === 'today') {
    return { from: today.toISOString(), to: addDays(today, 1).toISOString() };
  }

  if (filter === 'week') {
    const week = startOfWeek(today);
    return { from: week.toISOString(), to: addDays(week, 7).toISOString() };
  }

  if (filter === 'month') {
    const month = new Date(today);
    month.setDate(1);
    const nextMonth = new Date(month);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return { from: month.toISOString(), to: nextMonth.toISOString() };
  }

  if (filter === 'completed') {
    return { completedOnly: true };
  }

  return {};
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

const formatLongDuration = (seconds: number, t?: ReturnType<typeof useI18n>['t']): string => {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (t) {
    return hours > 0
      ? t('historyPage.duration.hoursMinutes', { hours, minutes })
      : t('historyPage.duration.minutes', { count: minutes });
  }

  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
};

const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const formatPlayCount = (count: number): string => {
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 0));
  return `播放 ${safeCount.toLocaleString()} 次`;
};

const formatCompactCount = (count: number): string => Math.max(0, Math.round(count)).toLocaleString();

const formatDate = (iso: string | null, t?: ReturnType<typeof useI18n>['t']): string => {
  if (!iso) {
    return t ? t('historyPage.date.none') : '暂无';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
};

const formatDayLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(parsed);
};

const formatMonthLabel = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);

const trackFromStatsTrack = (track: PlaybackStatsTrack): LibraryTrack => ({
  id: track.trackId ?? track.id,
  path: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.artist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: track.durationSeconds,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: track.coverThumb,
  fieldSources: {},
});

export const HistoryPage = (): JSX.Element => {
  const { t } = useI18n();
  const initialHistoryDataRef = useRef<HistoryPageData | null>(null);
  if (initialHistoryDataRef.current === null) {
    initialHistoryDataRef.current = getInitialHistoryPageData();
  }
  const initialHistoryData = initialHistoryDataRef.current;
  const [items, setItems] = useState<PlaybackHistoryEntry[]>(initialHistoryData.items);
  const [recentItems, setRecentItems] = useState<PlaybackHistoryEntry[]>(initialHistoryData.recentItems);
  const [summary, setSummary] = useState<PlaybackHistorySummary | null>(initialHistoryData.summary);
  const [stats, setStats] = useState<PlaybackStatsDashboard | null>(initialHistoryData.stats);
  const [page, setPage] = useState(initialHistoryData.page);
  const [total, setTotal] = useState(initialHistoryData.total);
  const [hasMore, setHasMore] = useState(initialHistoryData.hasMore);
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingInvalid, setIsRefreshingInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshResultMessage, setRefreshResultMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const statsRequestIdRef = useRef(0);
  const statsRefreshTimerRef = useRef<number | null>(null);

  const clearStatsRefreshTimer = useCallback((): void => {
    if (statsRefreshTimerRef.current !== null) {
      window.clearTimeout(statsRefreshTimerRef.current);
      statsRefreshTimerRef.current = null;
    }
  }, []);

  const invalidateStatsRefresh = useCallback((): void => {
    statsRequestIdRef.current += 1;
    clearStatsRefreshTimer();
  }, [clearStatsRefreshTimer]);

  useEffect(() => clearStatsRefreshTimer, [clearStatsRefreshTimer]);

  useEffect(() => {
    setRefreshResultMessage(null);
  }, [filter, search]);

  const scheduleStatsRefresh = useCallback(
    (historyQuery: PlaybackHistoryQuery, shouldCacheSnapshot: boolean): void => {
      clearStatsRefreshTimer();
      const statsRequestId = statsRequestIdRef.current + 1;
      statsRequestIdRef.current = statsRequestId;

      const queueStatsRefresh = (delayMs: number): void => {
        statsRefreshTimerRef.current = window.setTimeout(refreshStats, delayMs);
      };

      const refreshStats = (): void => {
        statsRefreshTimerRef.current = null;
        const library = window.echo?.library;

        if (!library?.getPlaybackStatsDashboard) {
          if (statsRequestIdRef.current === statsRequestId) {
            setStats(null);
            if (shouldCacheSnapshot) {
              mergeCachedHistoryPageData({ stats: null });
            }
          }
          return;
        }

        void shouldDeferHistoryStatsForPlayback()
          .then((shouldDefer) => {
            if (statsRequestIdRef.current !== statsRequestId) {
              return;
            }

            if (shouldDefer) {
              queueStatsRefresh(historyStatsPlaybackDeferDelayMs);
              return;
            }

            return library.getPlaybackStatsDashboard(historyQuery)
              .then((nextStats) => {
                if (statsRequestIdRef.current !== statsRequestId) {
                  return;
                }

                setStats(nextStats);
                if (shouldCacheSnapshot) {
                  mergeCachedHistoryPageData({ stats: nextStats });
                }
              });
          })
          .catch((statsError) => {
            if (statsRequestIdRef.current === statsRequestId) {
              setError(statsError instanceof Error ? statsError.message : String(statsError));
            }
          });
      };

      queueStatsRefresh(historyStatsRefreshDelayMs);
    },
    [clearStatsRefreshTimer],
  );

  const loadHistory = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
      const library = window.echo?.library;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (mode === 'replace') {
        invalidateStatsRefresh();
      }
      const shouldCacheSnapshot = mode === 'replace' && nextPage === 1 && isDefaultHistoryQuery(filter, search);
      const hasVisibleCachedSnapshot = shouldCacheSnapshot && hasHistoryPageData(cachedHistoryPageData);
      setIsLoading(!hasVisibleCachedSnapshot);
      setError(null);
      if (mode === 'replace' && !hasVisibleCachedSnapshot) {
        setStats(null);
      }

      if (!library) {
        setItems([]);
        setRecentItems([]);
        setSummary(null);
        setStats(null);
        setPage(1);
        setHasMore(false);
        setError(t('historyPage.error.desktopBridgeRead'));
        setIsLoading(false);
        return;
      }

      try {
        const rangeQuery = historyFilterRange(filter);
        const historyQuery = {
          page: nextPage,
          pageSize,
          sort: 'plays' as const,
          search,
          ...rangeQuery,
        };
        const recentHistoryQuery = {
          ...historyQuery,
          page: 1,
          pageSize: recentPlaybackPageSize,
          sort: 'recent' as const,
        };
        const [historyResult, nextSummary, recentHistoryResult] = await Promise.all([
          library.getPlaybackHistory(historyQuery),
          mode === 'replace' ? library.getPlaybackHistorySummary(historyQuery) : Promise.resolve(null),
          mode === 'replace' ? library.getPlaybackHistory(recentHistoryQuery) : Promise.resolve(null),
        ]);

        if (requestIdRef.current !== requestId) {
          return;
        }

        setItems((currentItems) => mergeHistoryItems(currentItems, historyResult.items, mode));
        setPage(historyResult.page);
        setTotal(historyResult.total);
        setHasMore(historyResult.hasMore);
        if (mode === 'replace') {
          setSummary(nextSummary);
          setRecentItems(sortRecentHistoryItems(recentHistoryResult?.items ?? []));
        }
        if (shouldCacheSnapshot) {
          setCachedHistoryPageData({
            filter,
            hasMore: historyResult.hasMore,
            items: sortHistoryItems(historyResult.items),
            page: historyResult.page,
            recentItems: sortRecentHistoryItems(recentHistoryResult?.items ?? []),
            search,
            stats: cachedHistoryPageData?.stats ?? null,
            summary: nextSummary,
            total: historyResult.total,
          });
        }
        if (mode === 'replace') {
          scheduleStatsRefresh(historyQuery, shouldCacheSnapshot);
        }
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [filter, invalidateStatsRefresh, scheduleStatsRefresh, search, t],
  );

  useEffect(() => {
    const delayMs =
      isDefaultHistoryQuery(filter, search) && hasHistoryPageData(cachedHistoryPageData) ? historyCachedRefreshDelayMs : 0;

    return scheduleHistoryWork(() => void loadHistory(1, 'replace'), delayMs);
  }, [filter, loadHistory, search]);

  const summaryLabels = useMemo(() => {
    const keys = filterSummaryLabelKeys[filter];
    return {
      count: t(keys.count),
      duration: t(keys.duration),
      tracks: t(keys.tracks),
      latest: t(keys.latest),
    };
  }, [filter, t]);

  const groupedItems = useMemo(() => {
    if (items.length === 0) {
      return [];
    }

    return [[t(filterSummaryLabelKeys[filter].group), sortHistoryItems(items)] as const];
  }, [filter, items, t]);

  const handleDeleteEntry = useCallback(
    async (entry: PlaybackHistoryEntry): Promise<void> => {
      const library = window.echo?.library;
      if (!library?.deletePlaybackHistoryEntry) {
        setError(t('historyPage.error.desktopBridgeRead'));
        return;
      }

      try {
        setError(null);
        await library.deletePlaybackHistoryEntry(entry.id);
        const shouldCacheSnapshot = isDefaultHistoryQuery(filter, search);
        const nextTotal = Math.max(0, total - 1);
        setItems((currentItems) => {
          const nextItems = currentItems.filter((item) => item.id !== entry.id);
          if (shouldCacheSnapshot) {
            mergeCachedHistoryPageData({
              items: nextItems,
              total: nextTotal,
            });
          }
          return nextItems;
        });
        setRecentItems((currentItems) => {
          const nextItems = currentItems.filter((item) => item.id !== entry.id);
          if (shouldCacheSnapshot) {
            mergeCachedHistoryPageData({ recentItems: nextItems });
          }
          return nextItems;
        });
        setTotal(nextTotal);
        const historyQuery = { search, ...historyFilterRange(filter) };
        const nextSummary = await (library.getPlaybackHistorySummary?.(historyQuery) ?? Promise.resolve(null));
        setSummary(nextSummary);
        if (shouldCacheSnapshot) {
          mergeCachedHistoryPageData({ summary: nextSummary });
        }
        scheduleStatsRefresh(historyQuery, shouldCacheSnapshot);
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    },
    [filter, scheduleStatsRefresh, search, t, total],
  );

  const handleClearHistory = useCallback(async (): Promise<void> => {
    if (!window.confirm(t('historyPage.confirm.clear'))) {
      return;
    }

    try {
      await window.echo?.library?.clearPlaybackHistory();
      const shouldCacheSnapshot = isDefaultHistoryQuery(filter, search);
      setItems([]);
      setRecentItems([]);
      setPage(1);
      setTotal(0);
      setHasMore(false);
      invalidateStatsRefresh();
      setStats(null);
      const historyQuery = { search, ...historyFilterRange(filter) };
      const nextSummary = await (window.echo?.library?.getPlaybackHistorySummary?.(historyQuery) ?? Promise.resolve(null));
      setSummary(nextSummary);
      if (shouldCacheSnapshot) {
        setCachedHistoryPageData({
          filter,
          hasMore: false,
          items: [],
          page: 1,
          recentItems: [],
          search,
          stats: null,
          summary: nextSummary,
          total: 0,
        });
      }
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    }
  }, [filter, invalidateStatsRefresh, search, t]);

  const handleRefreshInvalidHistory = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.refreshInvalidPlaybackHistory) {
      setError(t('historyPage.error.desktopBridgeRead'));
      return;
    }

    setIsRefreshingInvalid(true);
    setRefreshResultMessage(null);
    setError(null);

    try {
      const result = await library.refreshInvalidPlaybackHistory();
      await loadHistory(1, 'replace');
      setRefreshResultMessage(
        result.removedCount > 0
          ? t('historyPage.refresh.removed', { count: result.removedCount })
          : t('historyPage.refresh.none'),
      );
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsRefreshingInvalid(false);
    }
  }, [loadHistory, t]);

  const handleOpenTopTrack = useCallback(async (track: PlaybackStatsTrack): Promise<void> => {
    try {
      setError(null);
      const album = await openAlbumDetailForTrack(trackFromStatsTrack(track), { returnTo: 'history' });
      if (!album) {
        setError(`未找到专辑：${track.album || 'Unknown Album'}`);
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    }
  }, []);

  const handleOpenTopArtist = useCallback(async (artistName: string): Promise<void> => {
    try {
      setError(null);
      const artist = await openArtistDetailByName(artistName, { returnTo: 'history' });
      if (!artist) {
        setError(`未找到艺术家：${artistName || 'Unknown Artist'}`);
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    }
  }, []);

  return (
    <div className="history-page">
      <header className="history-header">
        <div>
          <span className="section-kicker">{t('historyPage.header.kicker')}</span>
          <h1>{t('historyPage.header.title')}</h1>
        </div>
        <div className="history-header-actions">
          <button className="history-action-button" type="button" disabled={isRefreshingInvalid} onClick={() => void handleRefreshInvalidHistory()}>
            <RefreshCw className={isRefreshingInvalid ? 'history-spin-icon' : undefined} size={16} />
            {isRefreshingInvalid ? t('historyPage.refresh.running') : t('historyPage.action.refreshInvalid')}
          </button>
          <button className="history-danger-button" type="button" disabled={total === 0} onClick={() => void handleClearHistory()}>
            <ListX size={16} />
            {t('historyPage.action.clear')}
          </button>
        </div>
      </header>

      <section className="history-toolbar" aria-label={t('historyPage.toolbar.aria')}>
        <label className="history-search">
          <Search size={17} />
          <input type="search" placeholder={t('historyPage.search.placeholder')} {...searchInputProps} />
        </label>
        <div className="history-filter-tabs">
          {(Object.keys(filterLabelKeys) as HistoryFilter[]).map((value) => (
            <button key={value} className={filter === value ? 'active' : ''} type="button" onClick={() => setFilter(value)}>
              {t(filterLabelKeys[value])}
            </button>
          ))}
        </div>
      </section>

      <section className="history-summary-grid" aria-label={t('historyPage.summary.aria')}>
        <HistoryMetric icon={<CalendarDays size={18} />} label={summaryLabels.count} value={t('historyPage.metric.plays', { count: summary?.rangeCount ?? 0 })} />
        <HistoryMetric icon={<Clock3 size={18} />} label={summaryLabels.duration} value={formatLongDuration(summary?.rangePlayedSeconds ?? 0, t)} />
        <HistoryMetric icon={<Music2 size={18} />} label={summaryLabels.tracks} value={t('historyPage.metric.tracks', { count: total.toLocaleString() })} />
        <HistoryMetric icon={<Clock3 size={18} />} label={summaryLabels.latest} value={formatDate(summary?.rangeLatestPlayedAt ?? null, t)} />
      </section>

      <section className="history-recent-section" aria-label={t('historyPage.recent.aria')}>
        <header className="history-recent-header">
          <div>
            <span className="section-kicker">{t('historyPage.recent.kicker')}</span>
            <h2>{t('historyPage.recent.title')}</h2>
          </div>
          <span>{t('historyPage.recent.count', { count: recentItems.length })}</span>
        </header>
        {recentItems.length > 0 ? (
          <div className="history-recent-list">
            {recentItems.map((entry) => (
              <article className="history-recent-row" key={entry.id}>
                <div className="history-recent-cover" data-empty={!entry.coverThumb}>
                  {entry.coverThumb ? <img alt="" src={entry.coverThumb} /> : <Music2 size={17} />}
                </div>
                <div className="history-recent-copy">
                  <strong>{entry.title}</strong>
                  <span>{entry.artist || t('historyPage.list.unknownArtist')}</span>
                </div>
                <time dateTime={entry.startedAt}>{formatDate(entry.startedAt, t)}</time>
              </article>
            ))}
          </div>
        ) : (
          <p className="history-recent-empty">{t('historyPage.recent.empty')}</p>
        )}
      </section>

      <PlaybackStatsDashboardView stats={stats} onOpenArtist={handleOpenTopArtist} onOpenTrack={handleOpenTopTrack} />

      <section className="history-list-section" aria-label={t('historyPage.list.aria')}>
        {groupedItems.length > 0 ? (
          groupedItems.map(([label, entries]) => (
            <div className="history-day-group" key={label}>
              <h2>{label}</h2>
              <div className="history-list" role="list">
                {entries.map((entry) => (
                  <article
                    className="history-row"
                    key={entry.id}
                    role="listitem"
                  >
                    <div className="history-cover" data-empty={!entry.coverThumb}>
                      {entry.coverThumb ? <img alt="" src={entry.coverThumb} /> : <Music2 size={20} />}
                    </div>
                    <div className="history-copy">
                      <strong>{entry.title}</strong>
                      <span>{entry.artist || t('historyPage.list.unknownArtist')} - {entry.album || t('historyPage.list.unknownAlbum')}</span>
                    </div>
                    <span className="history-time">{formatTime(entry.startedAt)}</span>
                    <span className="history-duration">{formatDuration(entry.playedSeconds)} / {formatDuration(entry.durationSeconds)}</span>
                    <span className="history-play-count">{formatPlayCount(entry.playCount)}</span>
                    <span className="history-source">
                      {entry.sourceLabel ? t('historyPage.list.source', { source: entry.sourceLabel }) : t('historyPage.list.unknownSource')}
                    </span>
                    <div className="history-actions">
                      <button className="danger" type="button" aria-label={`从历史移除 ${entry.title}`} title="从历史移除" onClick={() => void handleDeleteEntry(entry)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="history-empty">
            <Music2 size={28} />
            <strong>{t('historyPage.empty.title')}</strong>
            <span>{t('historyPage.empty.description')}</span>
          </div>
        )}
      </section>

      {hasMore ? (
        <div className="history-load-more-sentinel">
          <button className="history-load-more" type="button" disabled={isLoading} onClick={() => void loadHistory(page + 1, 'append')}>
            {isLoading ? t('historyPage.loadingMore') : t('historyPage.loadMore')}
          </button>
        </div>
      ) : null}

      {error || isLoading || refreshResultMessage ? (
        <p className="history-footer">{error ?? (isLoading ? t('historyPage.loading') : refreshResultMessage)}</p>
      ) : null}
    </div>
  );
};

const HistoryMetric = ({ icon, label, value }: { icon: JSX.Element; label: string; value: string }): JSX.Element => (
  <div className="history-metric">
    {icon}
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const PlaybackStatsDashboardView = ({
  onOpenArtist,
  onOpenTrack,
  stats,
}: {
  onOpenArtist: (artistName: string) => Promise<void>;
  onOpenTrack: (track: PlaybackStatsTrack) => Promise<void>;
  stats: PlaybackStatsDashboard | null;
}): JSX.Element | null => {
  if (!stats || stats.totals.playCount <= 0) {
    return null;
  }

  return (
    <section className="history-stats-dashboard" aria-label="播放统计仪表盘">
      <header className="history-stats-header">
        <div>
          <span className="section-kicker">Listening analytics</span>
          <h2>播放统计仪表盘</h2>
        </div>
        <span>{`生成于 ${formatDate(stats.generatedAt)}`}</span>
      </header>

      <div className="history-stats-hero">
        <HistoryMetric icon={<BarChart3 size={18} />} label="统计播放" value={`${formatCompactCount(stats.totals.playCount)} 次`} />
        <HistoryMetric icon={<Trophy size={18} />} label="完整播放" value={`${formatCompactCount(stats.totals.completedCount)} 次`} />
        <HistoryMetric icon={<Clock3 size={18} />} label="累计时长" value={formatLongDuration(stats.totals.playedSeconds)} />
        <HistoryMetric icon={<Disc3 size={18} />} label="曲目 / 艺人" value={`${stats.totals.uniqueTracks} / ${stats.totals.uniqueArtists}`} />
      </div>

      <div className="history-stats-panels">
        <StatsPanel title="最常听曲目" icon={<Music2 size={16} />}>
          <TopTrackList tracks={stats.topTracks} onOpenTrack={onOpenTrack} />
        </StatsPanel>
        <StatsPanel title="最常听艺人" icon={<Radio size={16} />}>
          <TopArtistList artists={stats.topArtists} onOpenArtist={onOpenArtist} />
        </StatsPanel>
        <StatsPanel title="音质使用" icon={<Trophy size={16} />}>
          <BreakdownBars items={stats.qualityBreakdown} />
        </StatsPanel>
        <StatsPanel title="格式分布" icon={<Disc3 size={16} />}>
          <BreakdownBars items={stats.formatBreakdown} />
        </StatsPanel>
      </div>

      <StatsPanel className="history-stats-activity-panel" title="近一年播放墙" icon={<CalendarDays size={16} />}>
        <DailyActivityWall days={stats.dailyActivity} />
      </StatsPanel>
    </section>
  );
};

const StatsPanel = ({
  children,
  className,
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  icon: JSX.Element;
  title: string;
}): JSX.Element => (
  <section className={`history-stats-panel ${className ?? ''}`.trim()}>
    <header>
      {icon}
      <h3>{title}</h3>
    </header>
    {children}
  </section>
);

const TopTrackList = ({
  onOpenTrack,
  tracks,
}: {
  onOpenTrack: (track: PlaybackStatsTrack) => Promise<void>;
  tracks: PlaybackStatsTrack[];
}): JSX.Element => {
  if (tracks.length === 0) {
    return <p className="history-stats-empty">暂无曲目统计</p>;
  }

  return (
    <div className="history-stats-list">
      {tracks.slice(0, 5).map((track, index) => (
        <button className="history-stats-track" key={track.id} type="button" onClick={() => void onOpenTrack(track)}>
          <span>{index + 1}</span>
          <div className="history-stats-cover" data-empty={!track.coverThumb}>
            {track.coverThumb ? <img alt="" src={track.coverThumb} /> : <Music2 size={16} />}
          </div>
          <div>
            <strong>{track.title}</strong>
            <small>{track.artist || 'Unknown artist'}</small>
          </div>
          <em>{`${track.playCount} 次`}</em>
        </button>
      ))}
    </div>
  );
};

const TopArtistList = ({
  artists,
  onOpenArtist,
}: {
  artists: PlaybackStatsArtist[];
  onOpenArtist: (artistName: string) => Promise<void>;
}): JSX.Element => {
  if (artists.length === 0) {
    return <p className="history-stats-empty">暂无艺人统计</p>;
  }

  const maxCount = Math.max(...artists.map((artist) => artist.playCount), 1);
  return (
    <div className="history-stats-bars">
      {artists.slice(0, 6).map((artist) => (
        <button className="history-stats-bar-row history-stats-bar-row--link" key={artist.artist} type="button" onClick={() => void onOpenArtist(artist.artist)}>
          <span>{artist.artist || 'Unknown artist'}</span>
          <div className="history-stats-bar-track">
            <i style={{ width: `${Math.max(6, (artist.playCount / maxCount) * 100)}%` }} />
          </div>
          <em>{artist.playCount}</em>
        </button>
      ))}
    </div>
  );
};

const BreakdownBars = ({ items }: { items: PlaybackStatsBreakdownItem[] }): JSX.Element => {
  if (items.length === 0) {
    return <p className="history-stats-empty">暂无分布数据</p>;
  }

  const maxCount = Math.max(...items.map((item) => item.playCount), 1);
  return (
    <div className="history-stats-bars">
      {items.slice(0, 6).map((item) => (
        <div className="history-stats-bar-row" key={item.id}>
          <span>{item.label}</span>
          <div className="history-stats-bar-track">
            <i style={{ width: `${Math.max(6, (item.playCount / maxCount) * 100)}%` }} />
          </div>
          <em>{item.playCount}</em>
        </div>
      ))}
    </div>
  );
};

const DailyActivityWall = ({ days }: { days: PlaybackStatsDay[] }): JSX.Element => {
  if (days.length === 0) {
    return <p className="history-stats-empty">暂无近期播放</p>;
  }

  const today = startOfDay(new Date());
  const firstDay = addDays(today, -370);
  const gridStart = startOfWeek(firstDay);
  const gridEnd = addDays(startOfWeek(today), 6);
  const activityByDate = new Map(days.map((day) => [day.date, day]));
  const cells: Array<{
    date: Date;
    dateKey: string;
    isOutside: boolean;
    playCount: number;
    playedSeconds: number;
  }> = [];

  for (let day = gridStart; compareDay(day, gridEnd) <= 0; day = addDays(day, 1)) {
    const date = startOfDay(day);
    const dateKey = formatDateKey(date);
    const activity = activityByDate.get(dateKey);
    cells.push({
      date,
      dateKey,
      isOutside: compareDay(date, firstDay) < 0 || compareDay(date, today) > 0,
      playCount: activity?.playCount ?? 0,
      playedSeconds: activity?.playedSeconds ?? 0,
    });
  }

  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const monthStarts = weeks.reduce<Array<{ label: string; month: number; week: number; year: number }>>((labels, week, weekIndex) => {
    const visibleDay = week.find((cell) => !cell.isOutside);

    if (!visibleDay) {
      return labels;
    }

    const lastLabel = labels.at(-1);
    if (!lastLabel || visibleDay.date.getMonth() !== lastLabel.month || visibleDay.date.getFullYear() !== lastLabel.year) {
      labels.push({
        label: formatMonthLabel(visibleDay.date),
        month: visibleDay.date.getMonth(),
        week: weekIndex,
        year: visibleDay.date.getFullYear(),
      });
    }

    return labels;
  }, []);
  const monthLabels = monthStarts.map((label, index) => ({
    ...label,
    span: Math.max(1, (monthStarts[index + 1]?.week ?? weeks.length) - label.week),
  }));
  const maxCount = Math.max(...cells.map((day) => day.playCount), 1);
  const totalCount = cells.reduce((sum, day) => (day.isOutside ? sum : sum + day.playCount), 0);
  const visibleCells = cells.filter((day) => !day.isOutside);
  const activeCells = visibleCells.filter((day) => day.playCount > 0);
  const peakDay = activeCells.reduce<(typeof activeCells)[number] | null>(
    (best, day) => (!best || day.playCount > best.playCount ? day : best),
    null,
  );
  const longestStreak = visibleCells.reduce(
    (streak, day) => {
      const current = day.playCount > 0 ? streak.current + 1 : 0;
      return {
        current,
        longest: Math.max(streak.longest, current),
      };
    },
    { current: 0, longest: 0 },
  ).longest;
  const insightItems = [
    {
      label: '最热一天',
      value: peakDay ? `${formatDayLabel(peakDay.dateKey)} · ${formatCompactCount(peakDay.playCount)} 次` : '暂无',
    },
    {
      label: '最长连续',
      value: `${longestStreak} 天`,
    },
    {
      label: '活跃天数',
      value: `${activeCells.length} / ${visibleCells.length}`,
    },
    {
      label: '活跃日均',
      value: `${activeCells.length > 0 ? Math.round(totalCount / activeCells.length) : 0} 次`,
    },
  ];
  const getLevel = (count: number): number => {
    if (count <= 0) {
      return 0;
    }

    const ratio = count / maxCount;
    if (ratio >= 0.8) {
      return 4;
    }
    if (ratio >= 0.55) {
      return 3;
    }
    if (ratio >= 0.25) {
      return 2;
    }
    return 1;
  };

  return (
    <div className="history-activity-wall">
      <div className="history-activity-summary">
        <strong>{`${formatCompactCount(totalCount)} 次播放`}</strong>
        <span>近一年</span>
      </div>
      <div className="history-activity-body">
        <div className="history-activity-scroll">
          <div className="history-activity-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--history-activity-cell))` }}>
            {monthLabels.map((month) => (
              <span key={`${month.label}-${month.week}`} style={{ gridColumn: `${month.week + 1} / span ${month.span}` }}>
                {month.label}
              </span>
            ))}
          </div>
          <div className="history-activity-grid-shell">
            <div className="history-activity-weekdays" aria-hidden="true">
              <span>一</span>
              <span />
              <span>三</span>
              <span />
              <span>五</span>
              <span />
              <span />
            </div>
            <div className="history-activity-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--history-activity-cell))` }}>
              {cells.map((day) => (
                <span
                  aria-label={`${formatDayLabel(day.dateKey)}，${day.playCount} 次播放`}
                  className="history-activity-cell"
                  data-level={day.isOutside ? 0 : getLevel(day.playCount)}
                  data-outside={day.isOutside ? 'true' : undefined}
                  key={day.dateKey}
                  title={`${day.dateKey} · ${day.playCount} 次 · ${formatLongDuration(day.playedSeconds)}`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="history-activity-insights" aria-label="年度播放摘要">
          {insightItems.map((item) => (
            <div className="history-activity-insight" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="history-activity-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i data-level={level} key={level} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
};
