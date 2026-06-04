import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, FolderPlus, ListFilter, Play, RotateCw, Search, Trash2, X } from 'lucide-react';
import type { DuplicateTrackIndexSummary, DuplicateTrackMember, EditableTrackTags, LibraryPlaylist, LibraryScanStatus, LibrarySort, LibraryTrack } from '../../shared/types/library';
import type { RemoteSource } from '../../shared/types/remoteSources';
import { TrackContextMenu } from '../components/library/TrackContextMenu';
import type { TrackMenuAction } from '../components/library/TrackContextMenu';
import { LibrarySourceSwitch } from '../components/library/LibrarySourceSwitch';
import { RemoteSourceFilter } from '../components/library/RemoteSourceFilter';
import { OsuTimingPanel } from '../components/library/OsuTimingPanel';
import { TrackList } from '../components/library/TrackList';
import { TrackTagEditorDrawer } from '../components/library/TrackTagEditorDrawer';
import { likedChangedEvent, likedTracksChangedEvent } from '../hooks/useLikedMedia';
import { useRemoteCoverPreloader } from '../hooks/useRemoteCoverPreloader';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import {
  beginSongsStartupLoadDiagnostics,
  canUseSongsFirstPageSnapshot,
  clearSongsFirstPageSnapshot,
  createSongsFirstPageSnapshotQueryKey,
  finishSongsStartupSqliteLoadDiagnostics,
  readSongsFirstPageSnapshot,
  writeSongsFirstPageSnapshot,
  type SongsFirstPageSnapshot,
} from '../stores/songsFirstPageSnapshot';
import { isPlaybackCancellationError, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { openAlbumDetailForTrack } from '../utils/albumNavigation';
import { openArtistDetailForTrack } from '../utils/artistNavigation';
import { resolvePlaylistForTrackAdd } from '../utils/appPrompt';
import {
  getLibraryDatabaseRecoveryMessage,
  isLibraryDatabaseCorruptionError,
  openLibraryDatabaseRecoverySettings,
} from '../utils/databaseRecovery';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';
import { readStoredLibrarySourceMode, writeStoredLibrarySourceMode, type LibrarySourceMode } from '../utils/librarySourceMode';
import { getRemoteSourcesBridge } from '../utils/echoBridge';

const pageSize = 100;
const maxPreservedRefreshPageSize = 500;
const preserveScrollThresholdPx = 80;
const getSongsScrollElement = (): HTMLElement | null => document.querySelector('.track-list') as HTMLElement | null;
const readSongsScrollTop = (): number => getSongsScrollElement()?.scrollTop ?? 0;
const isPreserveScrollLibraryEvent = (event: Event): boolean =>
  event instanceof CustomEvent && event.detail && typeof event.detail === 'object' && event.detail.preserveScroll === true;
const dispatchLibraryChangedPreservingScroll = (): void => {
  window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
};
const sortOptions: Array<{ value: LibrarySort; labelKey: TranslationKey }> = [
  { value: 'default', labelKey: 'songs.sort.default' },
  { value: 'createdAsc', labelKey: 'songs.sort.createdAsc' },
  { value: 'createdDesc', labelKey: 'songs.sort.createdDesc' },
  { value: 'titleAsc', labelKey: 'songs.sort.titleAsc' },
  { value: 'titleDesc', labelKey: 'songs.sort.titleDesc' },
  { value: 'durationAsc', labelKey: 'songs.sort.durationAsc' },
  { value: 'durationDesc', labelKey: 'songs.sort.durationDesc' },
  { value: 'fileModifiedAsc', labelKey: 'songs.sort.fileModifiedAsc' },
  { value: 'fileModifiedDesc', labelKey: 'songs.sort.fileModifiedDesc' },
  { value: 'qualityAsc', labelKey: 'songs.sort.qualityAsc' },
  { value: 'qualityDesc', labelKey: 'songs.sort.qualityDesc' },
  { value: 'frequent', labelKey: 'songs.sort.frequent' },
  { value: 'random', labelKey: 'songs.sort.random' },
  { value: 'artist', labelKey: 'songs.sort.artist' },
  { value: 'artistAlbum', labelKey: 'songs.sort.artistAlbum' },
  { value: 'album', labelKey: 'songs.sort.album' },
  { value: 'recent', labelKey: 'songs.sort.recent' },
];

const songsSortStorageKey = 'echo-next.songs.sort';
const songsHideDuplicatesStorageKey = 'echo-next.songs.hide-duplicates';
const validSortValues = new Set<LibrarySort>(sortOptions.map((option) => option.value));
const scanPollIntervalMs = 500;
const finishedScanStatuses = new Set<LibraryScanStatus['status']>(['completed', 'cancelled', 'failed']);
const streamingPlaylistSeparationMessage = '流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。';
const scanPhaseLabels: Record<LibraryScanStatus['phase'], string> = {
  queued: '排队中',
  discovering: '发现音乐文件',
  checking_cache: '检查增量缓存',
  reading_metadata: '读取新增/变更歌曲',
  extracting_covers: '修复封面缓存',
  grouping_albums: '整理专辑',
  writing_database: '写入曲库',
  finished: '完成',
  failed: '失败',
  cancelled: '已取消',
};

const readStoredSort = (): LibrarySort => {
  try {
    const stored = window.localStorage.getItem(songsSortStorageKey);
    return stored && validSortValues.has(stored as LibrarySort) ? (stored as LibrarySort) : 'default';
  } catch {
    return 'default';
  }
};

const writeStoredSort = (sort: LibrarySort): void => {
  try {
    window.localStorage.setItem(songsSortStorageKey, sort);
  } catch {
    // Sort memory should not block the song list in restricted storage environments.
  }

  void window.echo?.app.setSettings({ songsSort: sort }).catch(() => undefined);
};

const readStoredHideDuplicates = (): boolean => {
  try {
    return window.localStorage.getItem(songsHideDuplicatesStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeStoredHideDuplicates = (hideDuplicates: boolean): void => {
  try {
    window.localStorage.setItem(songsHideDuplicatesStorageKey, hideDuplicates ? 'true' : 'false');
  } catch {
    // Duplicate visibility memory is only a startup hint.
  }
};

const uniqueIds = (ids: string[]): string[] => Array.from(new Set(ids.filter(Boolean)));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const summarizeScanJobs = (statuses: LibraryScanStatus[]): string => {
  const active = statuses.find((status) => !finishedScanStatuses.has(status.status)) ?? statuses[statuses.length - 1];
  const processedFiles = statuses.reduce((sum, status) => sum + status.processedFiles, 0);
  const totalFiles = statuses.reduce((sum, status) => sum + status.totalFiles, 0);
  const addedTracks = statuses.reduce((sum, status) => sum + status.addedTracks, 0);
  const updatedTracks = statuses.reduce((sum, status) => sum + status.updatedTracks, 0);
  const skippedFiles = statuses.reduce((sum, status) => sum + status.skippedFiles, 0);
  const phase = active ? scanPhaseLabels[active.phase] : '增量扫描';
  const progress = totalFiles > 0 ? `${processedFiles}/${totalFiles}` : `${processedFiles}`;

  return `正在${phase}... ${progress} 个文件，新增 ${addedTracks}，更新 ${updatedTracks}，跳过 ${skippedFiles}`;
};

type InitialSongsState = {
  hideDuplicates: boolean;
  showDuplicatesOnly: boolean;
  snapshot: SongsFirstPageSnapshot | null;
  sort: LibrarySort;
  sourceMode: LibrarySourceMode;
};

const readInitialSongsState = (): InitialSongsState => {
  const sort = readStoredSort();
  const hideDuplicates = readStoredHideDuplicates();
  const sourceMode = readStoredLibrarySourceMode();
  const query = {
    pageSize,
    search: '',
    sort,
    sourceProvider: sourceMode,
    hideDuplicates,
    showDuplicatesOnly: false,
    duplicateMode: 'strict' as const,
  };
  const queryKey = createSongsFirstPageSnapshotQueryKey(query);

  return {
    hideDuplicates,
    showDuplicatesOnly: false,
    sourceMode,
    sort,
    snapshot: canUseSongsFirstPageSnapshot(query) ? readSongsFirstPageSnapshot(queryKey) : null,
  };
};

type TrackMenuState = {
  track: LibraryTrack;
  tracks: LibraryTrack[];
  position: { x: number; y: number };
};

export const SongsPage = (): JSX.Element => {
  const { t } = useI18n();
  const initialSongsStateRef = useRef<InitialSongsState | null>(null);
  if (!initialSongsStateRef.current) {
    initialSongsStateRef.current = readInitialSongsState();
  }

  const initialSongsState = initialSongsStateRef.current;
  const initialSnapshot = initialSongsState.snapshot;
  const [tracks, setTracks] = useState<LibraryTrack[]>(() => initialSnapshot?.items ?? []);
  const [loadedStartIndex, setLoadedStartIndex] = useState(0);
  const [total, setTotal] = useState(() => initialSnapshot?.total ?? 0);
  const [hasMore, setHasMore] = useState(() => (initialSnapshot ? initialSnapshot.items.length < initialSnapshot.total : false));
  const { search, searchInputProps } = useImeAwareDebouncedSearch(250);
  const [sort, setSort] = useState<LibrarySort>(() => initialSongsState.sort);
  const [sourceMode, setSourceModeState] = useState<LibrarySourceMode>(() => initialSongsState.sourceMode);
  const [remoteSourceId, setRemoteSourceId] = useState<string | null>(null);
  const [remoteSources, setRemoteSources] = useState<RemoteSource[]>([]);
  const [remoteSourcesLoaded, setRemoteSourcesLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMaintainingLibrary, setIsMaintainingLibrary] = useState(false);
  const [hideDuplicates, setHideDuplicates] = useState(() => initialSongsState.hideDuplicates);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(() => initialSongsState.showDuplicatesOnly);
  const [duplicateSummary, setDuplicateSummary] = useState<DuplicateTrackIndexSummary | null>(null);
  const [, setDuplicateMessage] = useState<string | null>(null);
  const [duplicateHiddenCounts, setDuplicateHiddenCounts] = useState<Record<string, number>>({});
  const [likedTrackIds, setLikedTrackIds] = useState<Record<string, boolean>>({});
  const [selectedTrackIds, setSelectedTrackIds] = useState<Record<string, boolean>>({});
  const [visibleTrackIds, setVisibleTrackIds] = useState<string[]>([]);
  const [likedRefreshVersion, setLikedRefreshVersion] = useState(0);
  const [versionMembers, setVersionMembers] = useState<DuplicateTrackMember[]>([]);
  const [versionTrack, setVersionTrack] = useState<LibraryTrack | null>(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [databaseRecoveryAvailable, setDatabaseRecoveryAvailable] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [osuTimingTrack, setOsuTimingTrack] = useState<LibraryTrack | null>(null);
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const requestIdRef = useRef(0);
  const likedRequestIdRef = useRef(0);
  const duplicateRequestIdRef = useRef(0);
  const visibleRemoteHydrationRequestIdRef = useRef(0);
  const visibleRemoteHydrationSeenAtRef = useRef<Record<string, number>>({});
  const visibleRemoteHydrationTimersRef = useRef<number[]>([]);
  const isLoadingRef = useRef(false);
  const likedTrackIdsRef = useRef<Record<string, boolean>>({});
  const duplicateHiddenCountsRef = useRef<Record<string, number>>({});
  const ignoreNextLibraryChangedRef = useRef(false);
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const { currentTrackId, playTrack, appendToQueue, appendTracksToQueue, playTrackNext, removeTrackFromQueue } = usePlaybackQueue();
  const visibleTrackIdsKey = useMemo(() => visibleTrackIds.join('\0'), [visibleTrackIds]);
  const loadedTrackIdsKey = useMemo(() => uniqueIds(tracks.map((track) => track.id)).join('\0'), [tracks]);
  const activeSortLabel = t(sortOptions.find((option) => option.value === sort)?.labelKey ?? 'songs.sort.default');
  const effectiveHideDuplicates = showDuplicatesOnly ? false : hideDuplicates;
  const hasRemoteSources = remoteSources.length > 0;
  const sourceLoadGate = sourceMode === 'remote' ? `${remoteSourcesLoaded}:${hasRemoteSources}` : 'local';
  const queueSource = useMemo(
    () => ({
      type: 'songs' as const,
      label: showDuplicatesOnly ? t('songs.duplicatesOnly') : sourceMode === 'remote' ? t('songs.queueSource.remote') : t('songs.queueSource.local'),
      search: search || undefined,
      sort,
      hideDuplicates: effectiveHideDuplicates,
      showDuplicatesOnly,
    }),
    [effectiveHideDuplicates, search, showDuplicatesOnly, sort, sourceMode, t],
  );
  const reportSongsError = useCallback((value: unknown): void => {
    if (isLibraryDatabaseCorruptionError(value)) {
      setError(getLibraryDatabaseRecoveryMessage());
      setDatabaseRecoveryAvailable(true);
      return;
    }

    setError(value instanceof Error ? value.message : String(value));
    setDatabaseRecoveryAvailable(false);
  }, []);
  const selectedTracks = useMemo(() => tracks.filter((track) => selectedTrackIds[track.id] === true), [selectedTrackIds, tracks]);
  const mergeLikedTrackIds = useCallback((patch: Record<string, boolean>): void => {
    setLikedTrackIds((current) => {
      const next = { ...current, ...patch };
      likedTrackIdsRef.current = next;
      return next;
    });
  }, []);
  const mergeDuplicateHiddenCounts = useCallback((patch: Record<string, number>): void => {
    setDuplicateHiddenCounts((current) => {
      const next = { ...current, ...patch };
      duplicateHiddenCountsRef.current = next;
      return next;
    });
  }, []);
  const clearListMetadataCache = useCallback((): void => {
    likedTrackIdsRef.current = {};
    duplicateHiddenCountsRef.current = {};
    setLikedTrackIds({});
    setDuplicateHiddenCounts({});
  }, []);

  const clearVisibleRemoteHydrationTimers = useCallback((): void => {
    for (const timer of visibleRemoteHydrationTimersRef.current) {
      window.clearTimeout(timer);
    }
    visibleRemoteHydrationTimersRef.current = [];
  }, []);

  const mergeHydratedRemoteTracks = useCallback((updatedTracks: LibraryTrack[]): void => {
    const updates = new Map(updatedTracks.filter((track) => track.mediaType === 'remote').map((track) => [track.id, track]));
    if (updates.size === 0) {
      return;
    }

    setTracks((current) => current.map((track) => updates.get(track.id) ?? track));
  }, []);

  const refreshRemoteSources = useCallback(async (): Promise<void> => {
    const remoteApi = getRemoteSourcesBridge();
    if (!remoteApi?.list) {
      setRemoteSources([]);
      setRemoteSourcesLoaded(true);
      return;
    }

    try {
      const sources = await remoteApi.list();
      setRemoteSources(sources.filter((source) => source.status !== 'disabled'));
    } catch {
      setRemoteSources([]);
    } finally {
      setRemoteSourcesLoaded(true);
    }
  }, []);

  const setSourceMode = useCallback((mode: LibrarySourceMode): void => {
    setSourceModeState(mode);
    if (mode !== 'remote') {
      setRemoteSourceId(null);
    }
    if (mode !== 'local') {
      setShowDuplicatesOnly(false);
    }
    writeStoredLibrarySourceMode(mode);
    clearSongsFirstPageSnapshot();
  }, []);

  useEffect(() => {
    void refreshRemoteSources();

    const handleRemoteSourcesChanged = (): void => {
      void refreshRemoteSources();
    };

    window.addEventListener('library:changed', handleRemoteSourcesChanged);
    return () => {
      window.removeEventListener('library:changed', handleRemoteSourcesChanged);
    };
  }, [refreshRemoteSources]);

  useEffect(() => {
    if (remoteSourcesLoaded && !hasRemoteSources && sourceMode === 'remote') {
      setSourceMode('local');
    }
  }, [hasRemoteSources, remoteSourcesLoaded, setSourceMode, sourceMode]);

  useEffect(() => {
    const handleShowRemoteSource = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const sourceId = detail && typeof detail.sourceId === 'string' ? detail.sourceId.trim() : '';
      if (!sourceId) {
        return;
      }

      setSourceMode('remote');
      setRemoteSourceId(sourceId);
      setShowDuplicatesOnly(false);
      setSelectedTrackIds({});
      void refreshRemoteSources();
    };

    window.addEventListener('library:show-remote-source', handleShowRemoteSource);
    return () => {
      window.removeEventListener('library:show-remote-source', handleShowRemoteSource);
    };
  }, [refreshRemoteSources, setSourceMode]);

  useEffect(() => {
    beginSongsStartupLoadDiagnostics({
      source: initialSnapshot ? 'renderer-snapshot' : 'sqlite',
      itemCount: initialSnapshot?.items.length ?? 0,
      total: initialSnapshot?.total ?? 0,
    });
  }, [initialSnapshot]);

  useEffect(() => {
    let isMounted = true;
    const appBridge = window.echo?.app;

    if (!appBridge) {
      return () => {
        isMounted = false;
      };
    }

    void appBridge
      .getSettings()
      .then((settings) => {
        if (!isMounted) {
          return;
        }

        const localSort = readStoredSort();
        const nextSort = (settings.appMemoryVersion ?? 0) < 1 && localSort !== 'default' ? localSort : (settings.songsSort ?? 'default');

        if (validSortValues.has(nextSort)) {
          setSort(nextSort);
          writeStoredSort(nextSort);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isSortOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isSortOpen]);

  const handleToggleDuplicateFilter = useCallback((): void => {
    const nextShowDuplicatesOnly = !showDuplicatesOnly;
    setShowDuplicatesOnly(nextShowDuplicatesOnly);
    setIsSortOpen(false);
    setSelectedTrackIds({});
    clearSongsFirstPageSnapshot();
    clearListMetadataCache();

    if (nextShowDuplicatesOnly) {
      if (sourceMode !== 'local') {
        setSourceModeState('local');
        setRemoteSourceId(null);
        writeStoredLibrarySourceMode('local');
      }

      void window.echo?.library?.getDuplicateIndexSummary('strict').then(setDuplicateSummary).catch(() => undefined);
    }
  }, [clearListMetadataCache, showDuplicatesOnly, sourceMode]);

  const loadTracks = useCallback(
    async (
      nextPage: number,
      mode: 'replace' | 'append' | 'prepend',
      options: { pageSizeOverride?: number; preserveListInstance?: boolean; restoreScrollTop?: number } = {},
    ) => {
      if (mode !== 'replace' && isLoadingRef.current) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);
      setDatabaseRecoveryAvailable(false);
      setStatusMessage(null);
      if (mode === 'replace' && !options.preserveListInstance) {
        setListVersion((current) => current + 1);
        setVisibleTrackIds([]);
        setSelectedTrackIds({});
        setLoadedStartIndex(0);
      }

      try {
        const library = window.echo?.library;

        if (!library) {
          setTracks([]);
          setLoadedStartIndex(0);
          setTotal(0);
          setHasMore(false);
          clearListMetadataCache();
          setError(t('songs.error.desktopBridgeRead'));
          setDatabaseRecoveryAvailable(false);
          return;
        }

        const query = {
          page: nextPage,
          pageSize: options.pageSizeOverride ?? pageSize,
          search,
          sort,
          sourceProvider: sourceMode,
          ...(sourceMode === 'remote' && remoteSourceId ? { sourceId: remoteSourceId } : {}),
          hideDuplicates: effectiveHideDuplicates,
          showDuplicatesOnly,
          duplicateMode: 'strict',
        } as const;
        const queryKey = createSongsFirstPageSnapshotQueryKey(query);
        const shouldUseFirstPageSnapshot = mode === 'replace' && nextPage === 1 && canUseSongsFirstPageSnapshot(query);
        const queryStartedAt = performance.now();
        const result = await library.getTracks(query);
        const queryMs = performance.now() - queryStartedAt;

        if (requestIdRef.current !== requestId) {
          return;
        }

        const nextLoadedStartIndex = (result.page - 1) * result.pageSize;
        setTracks((current) => {
          if (mode === 'append') {
            return [...current, ...result.items];
          }

          if (mode === 'prepend') {
            return [...result.items, ...current];
          }

          return result.items;
        });
        if (mode !== 'append') {
          setLoadedStartIndex(nextLoadedStartIndex);
        }
        setTotal(result.total);
        if (mode !== 'prepend') {
          setHasMore(result.hasMore);
        }
        if (shouldUseFirstPageSnapshot) {
          finishSongsStartupSqliteLoadDiagnostics({
            sqliteQueryMs: queryMs,
            itemCount: result.items.length,
            total: result.total,
          });
          writeSongsFirstPageSnapshot(queryKey, result);
        }

        if (typeof options.restoreScrollTop === 'number') {
          const restoreScrollTop = options.restoreScrollTop;
          window.setTimeout(() => {
            const scrollElement = getSongsScrollElement();

            if (scrollElement) {
              scrollElement.scrollTop = restoreScrollTop;
            }
          }, 0);
        }
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          reportSongsError(loadError);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [clearListMetadataCache, effectiveHideDuplicates, remoteSourceId, reportSongsError, search, showDuplicatesOnly, sort, sourceMode],
  );

  useEffect(() => {
    if (sourceMode === 'remote' && (!remoteSourcesLoaded || !hasRemoteSources)) {
      return;
    }

    void loadTracks(1, 'replace');
  }, [loadTracks, sourceLoadGate, sourceMode]);

  useEffect(() => {
    return () => {
      clearVisibleRemoteHydrationTimers();
    };
  }, [clearVisibleRemoteHydrationTimers]);

  useEffect(() => {
    if (sourceMode === 'remote') {
      return;
    }

    visibleRemoteHydrationRequestIdRef.current += 1;
    visibleRemoteHydrationSeenAtRef.current = {};
    clearVisibleRemoteHydrationTimers();
  }, [clearVisibleRemoteHydrationTimers, sourceMode]);

  useEffect(() => {
    writeStoredSort(sort);
  }, [sort]);

  const loadDuplicateSettings = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    const library = window.echo?.library;

    if (!app || !library) {
      return;
    }

    try {
      const [settings, summary] = await Promise.all([app.getSettings(), library.getDuplicateIndexSummary('strict')]);
      writeStoredHideDuplicates(settings.duplicateTracksEnabled);
      setHideDuplicates(settings.duplicateTracksEnabled);
      setDuplicateSummary(summary);

      if (settings.duplicateTracksEnabled && summary.duplicateGroups === 0) {
        setDuplicateMessage('需要先分析重复歌曲');
      }
    } catch {
      // Duplicate controls are optional around the core song list.
    }
  }, []);

  useEffect(() => {
    void loadDuplicateSettings();
  }, [loadDuplicateSettings]);

  useEffect(() => {
    const handleLibraryChanged = (event: Event): void => {
      if (ignoreNextLibraryChangedRef.current) {
        ignoreNextLibraryChangedRef.current = false;
        clearSongsFirstPageSnapshot();
        return;
      }

      const scrollTop = readSongsScrollTop();
      if (isPreserveScrollLibraryEvent(event) && scrollTop > preserveScrollThresholdPx) {
        clearSongsFirstPageSnapshot();
        clearListMetadataCache();
        void loadTracks(1, 'replace', {
          pageSizeOverride: Math.min(maxPreservedRefreshPageSize, Math.max(pageSize, tracks.length)),
          preserveListInstance: true,
          restoreScrollTop: scrollTop,
        });
        return;
      }

      clearSongsFirstPageSnapshot();
      clearListMetadataCache();
      void loadTracks(1, 'replace');
    };

    window.addEventListener('library:changed', handleLibraryChanged);
    return () => window.removeEventListener('library:changed', handleLibraryChanged);
  }, [clearListMetadataCache, loadTracks, tracks.length]);

  useEffect(() => {
    const handleSettingsChanged = (): void => {
      void loadDuplicateSettings();
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, [loadDuplicateSettings]);

  const handleLoadMore = useCallback((): void => {
    if (!isLoading && hasMore) {
      const nextPage = Math.floor((loadedStartIndex + tracks.length) / pageSize) + 1;
      void loadTracks(nextPage, 'append');
    }
  }, [hasMore, isLoading, loadTracks, loadedStartIndex, tracks.length]);

  const handleLoadPrevious = useCallback((): void => {
    if (!isLoading && loadedStartIndex > 0) {
      const previousPage = Math.max(1, Math.floor(loadedStartIndex / pageSize));
      void loadTracks(previousPage, 'prepend');
    }
  }, [isLoading, loadTracks, loadedStartIndex]);

  const handleImportFolder = (): void => {
    window.dispatchEvent(new Event('app:navigate:import-folder'));
  };

  const handleOpenTrackArtist = useCallback(async (track: LibraryTrack): Promise<void> => {
    try {
      setError(null);
      const artist = await openArtistDetailForTrack(track, { returnTo: 'songs' });
      if (!artist) {
        setError(t('songs.error.artistNotFound', { artist: track.artist || t('queue.unknownArtist') }));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  const handleOpenTrackArtistAction = useCallback((track: LibraryTrack): void => {
    void handleOpenTrackArtist(track);
  }, [handleOpenTrackArtist]);

  const handleOpenTrackAlbum = useCallback(async (track: LibraryTrack): Promise<void> => {
    try {
      setError(null);
      const album = await openAlbumDetailForTrack(track, { returnTo: 'songs' });
      if (!album) {
        setError(t('songs.error.albumNotFound', { album: track.album || t('queue.unknownAlbum') }));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  const handleOpenTrackAlbumAction = useCallback((track: LibraryTrack): void => {
    void handleOpenTrackAlbum(track);
  }, [handleOpenTrackAlbum]);

  const handleMaintainLibrary = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      setError(t('songs.error.desktopBridgeMaintain'));
      return;
    }

    setIsMaintainingLibrary(true);
    setError(null);
    setStatusMessage('正在扫描失效歌曲和 5 秒及以下短音频...');

    try {
      const cleanup = library.pruneInvalidTracks
        ? await library.pruneInvalidTracks()
        : {
            ...(await library.pruneMissingTracks()),
            missingRemovedCount: 0,
            shortRemovedCount: 0,
            shortDurationThresholdSeconds: 5,
          };
      const folders: Awaited<ReturnType<typeof library.getFolders>> = [];
      const activeFolders = folders.filter((folder) => folder.status === 'active');
      const scanJobs = await Promise.all(activeFolders.map((folder) => library.scanFolder(folder.id)));

      if (scanJobs.length > 0) {
        let statuses = scanJobs;
        setStatusMessage(summarizeScanJobs(statuses));

        while (statuses.some((status) => !finishedScanStatuses.has(status.status))) {
          await sleep(scanPollIntervalMs);
          statuses = await Promise.all(statuses.map((status) => library.getScanStatus(status.id)));
          setStatusMessage(summarizeScanJobs(statuses));
        }

        const failedJob = statuses.find((status) => status.status === 'failed');
        if (failedJob) {
          throw new Error(`增量扫描失败：${failedJob.errors[0] ?? 'unknown error'}`);
        }
      }
      await loadTracks(1, 'replace');
      window.dispatchEvent(new Event('library:changed'));
      setStatusMessage(
        `维护完成：检查 ${cleanup.scannedCount} 首，移除失效 ${cleanup.missingRemovedCount} 首，移除 ${cleanup.shortDurationThresholdSeconds} 秒及以下短音频 ${cleanup.shortRemovedCount} 首，增量扫描 ${scanJobs.length} 个文件夹。`,
      );
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsMaintainingLibrary(false);
    }
  };

  const handleClearTracks = async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      setError(t('songs.error.desktopBridgeClear'));
      return;
    }

    if (!window.confirm(`清空歌曲列表？\n这会从列表移除 ${total} 首歌曲，不会删除本地音乐文件。`)) {
      return;
    }

    setIsClearing(true);
    setError(null);
    setStatusMessage(null);

    try {
      const result = await library.clearTracks();
      setTracks([]);
      setLoadedStartIndex(0);
      setTotal(0);
      setHasMore(false);
      setVisibleTrackIds([]);
      clearListMetadataCache();
      window.dispatchEvent(new Event('library:changed'));
      setStatusMessage(`已清空 ${result.removedCount} 首歌曲。`);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setIsClearing(false);
    }
  };

  const handlePlayTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      const playback = window.echo?.playback;

      if (!playback) {
        setError(t('songs.error.desktopBridgePlay'));
        return;
      }

      try {
        setError(null);
        setSelectedTrackIds({});
        await playTrack(track, {
          replaceQueueWith: tracks,
          source: queueSource,
        });
      } catch (playError) {
        if (isPlaybackCancellationError(playError)) {
          return;
        }

        setError(playError instanceof Error ? playError.message : String(playError));
      }
    },
    [playTrack, queueSource, tracks],
  );

  const handleToggleTrackSelected = useCallback((track: LibraryTrack): void => {
    if (track.unavailable) {
      return;
    }

    setSelectedTrackIds((current) => {
      const next = { ...current };
      if (next[track.id]) {
        delete next[track.id];
      } else {
        next[track.id] = true;
      }

      return next;
    });
  }, []);

  useEffect(() => {
    duplicateHiddenCountsRef.current = {};
    setDuplicateHiddenCounts({});
  }, [duplicateSummary?.updatedAt]);

  useEffect(() => {
    const loadVisibleDuplicateBadges = async (): Promise<void> => {
      const library = window.echo?.library;
      const trackIds = uniqueIds(visibleTrackIds);
      const missingTrackIds = trackIds.filter((trackId) => duplicateHiddenCountsRef.current[trackId] === undefined);

      if (missingTrackIds.length === 0) {
        return;
      }

      if (!library?.getDuplicateHiddenCounts) {
        mergeDuplicateHiddenCounts(Object.fromEntries(missingTrackIds.map((trackId) => [trackId, 0])));
        return;
      }

      const requestId = duplicateRequestIdRef.current + 1;
      duplicateRequestIdRef.current = requestId;

      try {
        const result = await library.getDuplicateHiddenCounts(missingTrackIds, 'strict');
        if (duplicateRequestIdRef.current !== requestId) {
          return;
        }

        mergeDuplicateHiddenCounts(
          Object.fromEntries(missingTrackIds.map((trackId) => [trackId, Math.max(0, Number(result[trackId] ?? 0))])),
        );
      } catch {
        if (duplicateRequestIdRef.current === requestId) {
          mergeDuplicateHiddenCounts(Object.fromEntries(missingTrackIds.map((trackId) => [trackId, 0])));
        }
      }
    };

    void loadVisibleDuplicateBadges();
  }, [mergeDuplicateHiddenCounts, visibleTrackIds, visibleTrackIdsKey]);

  useEffect(() => {
    if (sourceMode !== 'remote') {
      return undefined;
    }

    const remoteApi = window.echo?.remoteSources;
    if (!remoteApi?.hydrateVisibleTracks) {
      return undefined;
    }

    const visibleIds = new Set(uniqueIds(visibleTrackIds));
    const visibleRemoteIds = tracks
      .filter((track) => visibleIds.has(track.id) && track.mediaType === 'remote')
      .map((track) => track.id);
    const now = Date.now();
    const trackIds = uniqueIds(visibleRemoteIds)
      .filter((trackId) => now - (visibleRemoteHydrationSeenAtRef.current[trackId] ?? 0) > 30_000)
      .slice(0, 24);

    if (trackIds.length === 0) {
      return undefined;
    }

    for (const trackId of trackIds) {
      visibleRemoteHydrationSeenAtRef.current[trackId] = now;
    }

    const requestId = visibleRemoteHydrationRequestIdRef.current + 1;
    visibleRemoteHydrationRequestIdRef.current = requestId;

    const refreshVisibleTracks = (delayMs: number): void => {
      const timer = window.setTimeout(() => {
        const library = window.echo?.library;
        if (!library || visibleRemoteHydrationRequestIdRef.current !== requestId) {
          return;
        }

        void Promise.all(trackIds.map((trackId) => library.getTrack(trackId).catch(() => null))).then((updatedTracks) => {
          if (visibleRemoteHydrationRequestIdRef.current !== requestId) {
            return;
          }

          mergeHydratedRemoteTracks(updatedTracks.filter((track): track is LibraryTrack => Boolean(track)));
        });
      }, delayMs);
      visibleRemoteHydrationTimersRef.current.push(timer);
    };

    const timer = window.setTimeout(() => {
      void remoteApi
        .hydrateVisibleTracks(trackIds, { metadata: true, cover: true, priority: 12 })
        .then((updatedTracks) => {
          if (visibleRemoteHydrationRequestIdRef.current !== requestId) {
            return;
          }

          mergeHydratedRemoteTracks(updatedTracks);
          refreshVisibleTracks(900);
          refreshVisibleTracks(2400);
        })
        .catch(() => undefined);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [mergeHydratedRemoteTracks, sourceMode, tracks, visibleTrackIds, visibleTrackIdsKey]);

  const hydrateRemoteMissingCovers = useCallback(
    (trackIds: string[]): void => {
      if (sourceMode !== 'remote') {
        return;
      }

      const remoteApi = window.echo?.remoteSources;
      if (!remoteApi?.hydrateVisibleTracks) {
        return;
      }

      const tracksById = new Map(tracks.map((track) => [track.id, track]));
      const now = Date.now();
      const targetIds = uniqueIds(trackIds)
        .map((trackId) => tracksById.get(trackId))
        .filter((track): track is LibraryTrack => Boolean(
          track &&
            track.mediaType === 'remote' &&
            !track.coverThumb &&
            now - (visibleRemoteHydrationSeenAtRef.current[track.id] ?? 0) > 30_000,
        ))
        .map((track) => track.id);

      if (targetIds.length === 0) {
        return;
      }

      for (const trackId of targetIds) {
        visibleRemoteHydrationSeenAtRef.current[trackId] = now;
      }

      void remoteApi
        .hydrateVisibleTracks(targetIds, { metadata: false, cover: true, immediateCover: true, priority: 18 })
        .then(mergeHydratedRemoteTracks)
        .catch(() => undefined);
    },
    [mergeHydratedRemoteTracks, sourceMode, tracks],
  );

  useRemoteCoverPreloader({
    active: sourceMode === 'remote',
    tracks,
    visibleTrackIds,
    hydrateMissingCovers: hydrateRemoteMissingCovers,
  });

  useEffect(() => {
    const loadLoadedTrackLikedStates = async (): Promise<void> => {
      const library = window.echo?.library;
      const trackIds = loadedTrackIdsKey ? loadedTrackIdsKey.split('\0') : [];
      const missingTrackIds = trackIds.filter((trackId) => likedTrackIdsRef.current[trackId] === undefined);

      if (missingTrackIds.length === 0) {
        return;
      }

      if (!library?.getLikedTrackIds) {
        mergeLikedTrackIds(Object.fromEntries(missingTrackIds.map((trackId) => [trackId, false])));
        return;
      }

      const requestId = likedRequestIdRef.current + 1;
      likedRequestIdRef.current = requestId;

      try {
        const result = await library.getLikedTrackIds(missingTrackIds);
        if (likedRequestIdRef.current !== requestId) {
          return;
        }

        mergeLikedTrackIds(Object.fromEntries(missingTrackIds.map((trackId) => [trackId, result[trackId] === true])));
      } catch {
        if (likedRequestIdRef.current === requestId) {
          mergeLikedTrackIds(Object.fromEntries(missingTrackIds.map((trackId) => [trackId, false])));
        }
      }
    };

    void loadLoadedTrackLikedStates();
  }, [likedRefreshVersion, loadedTrackIdsKey, mergeLikedTrackIds]);

  useEffect(() => {
    const handleLikedTracksChanged = (): void => {
      likedTrackIdsRef.current = {};
      setLikedTrackIds({});
      setLikedRefreshVersion((current) => current + 1);
    };

    window.addEventListener(likedTracksChangedEvent, handleLikedTracksChanged);
    return () => window.removeEventListener(likedTracksChangedEvent, handleLikedTracksChanged);
  }, []);

  const handleShowVersions = useCallback(async (track: LibraryTrack): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      setError(t('songs.error.desktopBridgeVersions'));
      return;
    }

    setVersionTrack(track);
    setVersionsBusy(true);
    setError(null);

    try {
      setVersionMembers(await library.getDuplicateTrackVersions(track.id));
    } catch (versionsError) {
      setVersionMembers([]);
      setError(versionsError instanceof Error ? versionsError.message : String(versionsError));
    } finally {
      setVersionsBusy(false);
    }
  }, []);
  const handleShowVersionsAction = useCallback((track: LibraryTrack): void => {
    void handleShowVersions(track);
  }, [handleShowVersions]);

  const handleOpenTrackMenu = useCallback((track: LibraryTrack, position: { x: number; y: number }): void => {
    const menuTracks = selectedTrackIds[track.id] && selectedTracks.length > 1 ? selectedTracks : [track];
    if (menuTracks.length === 1) {
      setSelectedTrackIds(track.unavailable ? {} : { [track.id]: true });
    }
    setTrackMenu({ track, tracks: menuTracks, position });
  }, [selectedTrackIds, selectedTracks]);

  const handleAddTrackToQueue = useCallback(
    (track: LibraryTrack): void => {
      appendToQueue(track, queueSource);
    },
    [appendToQueue, queueSource],
  );
  const handleVisibleTrackIdsChange = useCallback((trackIds: string[]): void => {
    startTransition(() => {
      setVisibleTrackIds(trackIds);
    });
  }, []);

  const resolveTargetLocalPlaylist = useCallback(async () => {
    const library = window.echo?.library;
    if (!library) {
      setError(t('songs.error.desktopBridgePlaylists'));
      return null;
    }

    return resolvePlaylistForTrackAdd(library);

  }, []);

  const handleAddTracksToPlaylist = useCallback(async (targetTracks: LibraryTrack[], playlistTarget?: LibraryPlaylist): Promise<void> => {
    const library = window.echo?.library;
    const uniqueTracks = Array.from(new Map(targetTracks.filter((item) => !item.unavailable).map((item) => [item.id, item])).values());
    if (!library || uniqueTracks.length === 0) {
      return;
    }

    const localTracks = uniqueTracks.filter((item) => item.mediaType !== 'streaming');
    const skippedStreamingCount = uniqueTracks.length - localTracks.length;
    if (localTracks.length === 0) {
      setError(streamingPlaylistSeparationMessage);
      return;
    }

    try {
      setError(null);
      const playlist = playlistTarget ?? (await resolveTargetLocalPlaylist());
      if (!playlist) {
        return;
      }

      const localTrackIds = localTracks.map((item) => item.id);

      if (localTrackIds.length > 0) {
        if (library.addTracksToPlaylist) {
          await library.addTracksToPlaylist(playlist.id, localTrackIds);
        } else {
          await Promise.all(localTrackIds.map((trackId) => library.addTrackToPlaylist(playlist.id, trackId)));
        }
      }
      window.dispatchEvent(new Event('library:playlists-changed'));
      setStatusMessage(`已加入歌单：${playlist.name}（${uniqueTracks.length} 首）`);
      if (skippedStreamingCount > 0) {
        setStatusMessage(`已加入歌单：${playlist.name}（${localTrackIds.length} 首；已跳过 ${skippedStreamingCount} 首流媒体）`);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }, [resolveTargetLocalPlaylist]);

  const handleAddTrackToPlaylist = useCallback(async (track: LibraryTrack): Promise<void> => {
    await handleAddTracksToPlaylist([track]);
  }, [handleAddTracksToPlaylist]);
  const handleAddTrackToPlaylistAction = useCallback((track: LibraryTrack): void => {
    void handleAddTrackToPlaylist(track);
  }, [handleAddTrackToPlaylist]);

  const resolveTrackLikedBeforeToggle = useCallback(async (trackId: string): Promise<boolean> => {
    const cached = likedTrackIdsRef.current[trackId];
    if (cached !== undefined) {
      return cached === true;
    }

    const result = await window.echo?.library?.getLikedTrackIds?.([trackId]);
    const liked = result?.[trackId] === true;
    mergeLikedTrackIds({ [trackId]: liked });
    return liked;
  }, [mergeLikedTrackIds]);

  const handleToggleLiked = useCallback(async (track: LibraryTrack): Promise<void> => {
    const hadCachedLikedState = likedTrackIdsRef.current[track.id] !== undefined;
    const previousLiked = await resolveTrackLikedBeforeToggle(track.id);

    if (!hadCachedLikedState && previousLiked) {
      return;
    }

    mergeLikedTrackIds({ [track.id]: !previousLiked });

    try {
      setError(null);
      const result = await window.echo?.library?.toggleTrackLiked(track.id);
      mergeLikedTrackIds({ [track.id]: result?.liked === true });
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (likeError) {
      mergeLikedTrackIds({ [track.id]: previousLiked });
      setError(likeError instanceof Error ? likeError.message : String(likeError));
    }
  }, [mergeLikedTrackIds, resolveTrackLikedBeforeToggle]);
  const handleToggleLikedAction = useCallback((track: LibraryTrack): void => {
    void handleToggleLiked(track);
  }, [handleToggleLiked]);

  const handleLikeTracks = useCallback(async (targetTracks: LibraryTrack[]): Promise<void> => {
    const library = window.echo?.library;
    const uniqueTracks = Array.from(new Map(targetTracks.filter((item) => !item.unavailable).map((item) => [item.id, item])).values());
    if (!library || uniqueTracks.length === 0) {
      return;
    }

    const previousStates: Record<string, boolean> = {};
    const optimisticPatch: Record<string, boolean> = {};

    try {
      setError(null);
      for (const item of uniqueTracks) {
        const liked = await resolveTrackLikedBeforeToggle(item.id);
        previousStates[item.id] = liked;
        if (!liked) {
          optimisticPatch[item.id] = true;
        }
      }

      if (Object.keys(optimisticPatch).length === 0) {
        setStatusMessage(`已喜欢 ${uniqueTracks.length} 首歌`);
        return;
      }

      mergeLikedTrackIds(optimisticPatch);
      await Promise.all(
        uniqueTracks
          .filter((item) => previousStates[item.id] !== true)
          .map((item) => (library.likeTrack ? library.likeTrack(item.id) : library.toggleTrackLiked(item.id))),
      );
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
      setStatusMessage(`已喜欢 ${uniqueTracks.length} 首歌`);
    } catch (likeError) {
      mergeLikedTrackIds(previousStates);
      setError(likeError instanceof Error ? likeError.message : String(likeError));
    }
  }, [mergeLikedTrackIds, resolveTrackLikedBeforeToggle]);

  const handleTrackMenuAction = useCallback(
    async (action: TrackMenuAction, track: LibraryTrack, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      const actionTracks = trackMenu?.track.id === track.id ? trackMenu.tracks.filter((item) => !item.unavailable) : [track];
      setTrackMenu(null);

      if (action === 'clear-lyrics-cache') {
        const lyricsApi = window.echo?.lyrics;
        if (!lyricsApi?.clearCache) {
          setError(t('songs.error.desktopBridgeLyricsCache'));
          return;
        }

        try {
          setError(null);
          await Promise.all(actionTracks.map((item) => lyricsApi.clearCache(item.id)));
          window.dispatchEvent(new CustomEvent('lyrics:rematch-requested', { detail: { trackId: track.id } }));
          setStatusMessage(actionTracks.length > 1 ? `已清理歌词缓存：${actionTracks.length} 首` : `已清理歌词缓存：${track.title}`);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      if (!library && action !== 'play-next' && action !== 'add-to-queue' && action !== 'remove-from-queue' && action !== 'edit-tags' && action !== 'reload-embedded-tags' && action !== 'open-osu-timing') {
        setError(t('songs.error.desktopBridgeFileActions'));
        return;
      }

      try {
        setError(null);

        if (
          track.mediaType === 'remote' &&
          (action === 'edit-tags' ||
            action === 'reload-embedded-tags' ||
            action === 'open-osu-timing' ||
            action === 'show-in-folder' ||
            action === 'copy-path' ||
            action === 'open-system' ||
            action === 'delete-song')
        ) {
          setError('远程歌曲暂不支持本地文件操作。');
          return;
        }

        switch (action) {
          case 'play-next':
            for (const item of [...actionTracks].reverse()) {
              playTrackNext(item, queueSource);
            }
            if (actionTracks.length > 1) {
              setStatusMessage(`已加入下一首播放：${actionTracks.length} 首`);
            }
            return;
          case 'add-to-queue':
            if (actionTracks.length > 1) {
              appendTracksToQueue(actionTracks, queueSource);
              setStatusMessage(`已加入队列：${actionTracks.length} 首`);
            } else {
              appendToQueue(track, queueSource);
            }
            return;
          case 'toggle-liked':
            if (actionTracks.length > 1) {
              await handleLikeTracks(actionTracks);
            } else {
              await handleToggleLiked(track);
            }
            return;
          case 'remove-from-queue':
            {
              const removedCount = actionTracks.reduce((sum, item) => sum + removeTrackFromQueue(item.id), 0);
              setStatusMessage(
                removedCount > 0
                  ? `已从播放队列移除：${removedCount} 首`
                  : `播放队列里没有选中的歌曲`,
              );
            }
            return;
          case 'open-osu-timing':
            setOsuTimingTrack(track);
            return;
          case 'edit-tags':
            setTagEditorError(null);
            if (tagEditorCloseTimerRef.current !== null) {
              window.clearTimeout(tagEditorCloseTimerRef.current);
              tagEditorCloseTimerRef.current = null;
            }
            setIsTagEditorOpen(false);
            setEditingTrack(track);
            window.requestAnimationFrame(() => setIsTagEditorOpen(true));
            return;
          case 'reload-embedded-tags':
            {
              const result = await library!.loadEmbeddedTrackTags(track.id);
              setTracks((current) => current.map((item) => (item.id === result.track.id ? result.track : item)));
              if (editingTrack?.id === result.track.id) {
                setEditingTrack(result.track);
              }
              setStatusMessage(`已从内嵌标签重新加载：${result.track.title}`);
              dispatchLibraryChangedPreservingScroll();
            }
            return;
          case 'go-to-album':
            if (!(await openAlbumDetailForTrack(track, { returnTo: 'songs' }))) {
              setError(`Album not found: ${track.album || 'Unknown Album'}`);
            }
            return;
          case 'show-in-folder':
            await library?.openTrackInFolder(track.id);
            return;
          case 'copy-path':
            await library?.copyTrackPath(track.id);
            return;
          case 'open-system':
            await library?.openTrackWithSystem(track.id);
            return;
          case 'copy-name-artist':
            await library?.copyTrackNameArtist(track.id);
            return;
          case 'copy-cover':
            if (!(await library?.copyTrackCover(track.id))) {
              setError('这首歌没有可复制的歌曲卡片图片。');
            }
            return;
          case 'save-cover':
            if (!(await library?.saveTrackCover(track.id))) {
              setError('没有保存歌曲卡片图片。');
            }
            return;
          case 'delete-song':
            if (!window.confirm(`删除歌曲文件？\n${track.title}`)) {
              return;
            }
            await library?.deleteTrackFile(track.id);
            setTracks((current) => current.filter((item) => item.id !== track.id));
            setTotal((current) => Math.max(0, current - 1));
            setHasMore((current) => current || tracks.length - 1 < total - 1);
            ignoreNextLibraryChangedRef.current = true;
            window.dispatchEvent(new Event('library:changed'));
            return;
          case 'add-to-playlist':
            if (playlistTarget) {
              await handleAddTracksToPlaylist(actionTracks, playlistTarget);
            } else {
              await handleAddTracksToPlaylist(actionTracks);
            }
            return;
          default:
            setError('歌单功能还在接入中。');
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [appendToQueue, appendTracksToQueue, editingTrack, handleAddTracksToPlaylist, handleLikeTracks, handleToggleLiked, playTrackNext, queueSource, removeTrackFromQueue, total, trackMenu, tracks.length],
  );

  const closeTagEditor = useCallback((): void => {
    setIsTagEditorOpen(false);
    if (tagEditorCloseTimerRef.current !== null) {
      window.clearTimeout(tagEditorCloseTimerRef.current);
    }
    tagEditorCloseTimerRef.current = window.setTimeout(() => {
      setEditingTrack(null);
      tagEditorCloseTimerRef.current = null;
    }, 280);
  }, []);

  const handleSaveTags = useCallback(
    async (
      track: LibraryTrack,
      tags: EditableTrackTags,
      coverPath: string | null,
      coverUrl: string | null,
      coverMimeType: string | null,
    ): Promise<void> => {
      const library = window.echo?.library;

      if (!library) {
        setTagEditorError('Desktop bridge unavailable. Open ECHO Next in Electron to edit embedded tags.');
        return;
      }

      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const updatedTrack = await library.updateTrackTags({ trackId: track.id, tags, coverPath, coverUrl, coverMimeType });
        setTracks((current) => current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item)));
        dispatchLibraryChangedPreservingScroll();
        closeTagEditor();
      } catch (saveError) {
        setTagEditorError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor],
  );

  return (
    <div className="songs-page">
      <header className="songs-header">
        <div className="songs-title-group">
          <h1>歌曲</h1>
          <span>{total} 首</span>
        </div>

        <div className="songs-tools" aria-label="歌曲工具">
          <button className="tool-button" type="button" aria-label="导入文件夹" title="导入文件夹" onClick={handleImportFolder}>
            <FolderPlus size={17} />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label="扫描失效歌曲、短音频并增量扫描"
            title="扫描失效歌曲、移除 5 秒及以下短音频，并增量扫描新增歌曲"
            onClick={() => void handleMaintainLibrary()}
            disabled={isMaintainingLibrary}
          >
            <RotateCw className={isMaintainingLibrary ? 'spinning-icon' : undefined} size={17} />
          </button>
          <button className="tool-button" type="button" aria-label={t('route.downloads.label')} title={t('route.downloads.label')}>
            <Download size={17} />
          </button>
          <button
            className="tool-button danger"
            type="button"
            aria-label={t('songs.action.clearList')}
            title={t('songs.action.clearList')}
            onClick={() => void handleClearTracks()}
            disabled={isClearing || total === 0}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </header>

      <div className="songs-control-row">
        <label className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder={t('songs.search.placeholder')}
            {...searchInputProps}
          />
        </label>

        <div className="songs-control-actions">
          {hasRemoteSources ? <LibrarySourceSwitch value={sourceMode} onChange={setSourceMode} /> : null}
          {sourceMode === 'remote' ? (
            <RemoteSourceFilter sources={remoteSources} value={remoteSourceId} onChange={setRemoteSourceId} />
          ) : null}

          <div className="sort-select" ref={sortMenuRef}>
            <button
              className="sort-button"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isSortOpen}
              onClick={() => setIsSortOpen((current) => !current)}
            >
              <ListFilter className="sort-button-icon" size={16} aria-hidden="true" />
              <span className="sort-button-label">{showDuplicatesOnly ? t('songs.duplicatesOnly') : activeSortLabel}</span>
              <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
            </button>
            {isSortOpen ? (
              <div className="sort-menu" role="listbox" aria-label={t('songs.sort.menuAria')}>
                <button
                  className="sort-option sort-option--filter"
                  type="button"
                  role="option"
                  aria-selected={showDuplicatesOnly}
                  onClick={handleToggleDuplicateFilter}
                >
                  <span>{t('songs.duplicatesOnly')}</span>
                  {showDuplicatesOnly ? <Check size={14} /> : null}
                </button>
                <div className="sort-menu-divider" role="presentation" />
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    className="sort-option"
                    type="button"
                    role="option"
                    aria-selected={sort === option.value}
                    onClick={() => {
                      setSort(option.value);
                      setIsSortOpen(false);
                    }}
                  >
                    <span>{t(option.labelKey)}</span>
                    {sort === option.value ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {total === 0 && !isLoading ? (
        <div className="songs-import-hint">
          <FolderPlus size={17} aria-hidden="true" />
          <span>{t('songs.importHint')}</span>
        </div>
      ) : null}

      {error ? (
        <div className="library-database-recovery-callout">
          <p className="audio-error">{error}</p>
          {databaseRecoveryAvailable ? (
            <button className="settings-action-button" type="button" onClick={openLibraryDatabaseRecoverySettings}>
              {t('songs.action.openRecovery')}
            </button>
          ) : null}
        </div>
      ) : null}

      <TrackList
        key={listVersion}
        tracks={tracks}
        currentTrackId={currentTrackId}
        canLoadMore={hasMore && !isLoading}
        canLoadPrevious={loadedStartIndex > 0 && !isLoading}
        totalCount={total}
        loadedCount={tracks.length}
        loadedStartIndex={loadedStartIndex}
        isLoadingMore={isLoading}
        onEndReached={handleLoadMore}
        onStartReached={handleLoadPrevious}
        onAddToQueue={handleAddTrackToQueue}
        onAddToPlaylist={handleAddTrackToPlaylistAction}
        selectedTrackIds={selectedTrackIds}
        onToggleSelected={handleToggleTrackSelected}
        onOpenArtist={handleOpenTrackArtistAction}
        onOpenAlbum={handleOpenTrackAlbumAction}
        duplicateHiddenCounts={duplicateHiddenCounts}
        onShowVersions={handleShowVersionsAction}
        likedTrackIds={likedTrackIds}
        onToggleLiked={handleToggleLikedAction}
        onOpenTrackMenu={handleOpenTrackMenu}
        onVisibleTrackIdsChange={handleVisibleTrackIdsChange}
        onPlay={handlePlayTrack}
      />

      {trackMenu ? (
        <TrackContextMenu
          track={trackMenu.track}
          position={trackMenu.position}
          liked={likedTrackIds[trackMenu.track.id] === true}
          selectionCount={trackMenu.tracks.length}
          onAction={(action, track, playlist) => void handleTrackMenuAction(action, track, playlist)}
          onClose={() => setTrackMenu(null)}
        />
      ) : null}

      <TrackTagEditorDrawer
        track={editingTrack}
        isOpen={isTagEditorOpen}
        isSaving={isSavingTags}
        error={tagEditorError}
        onClose={closeTagEditor}
        onSave={(track, tags, coverPath, coverUrl, coverMimeType) => void handleSaveTags(track, tags, coverPath, coverUrl, coverMimeType)}
        onTrackUpdated={(updatedTrack) => {
          setEditingTrack(updatedTrack);
          setTracks((current) => current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item)));
          dispatchLibraryChangedPreservingScroll();
        }}
      />

      <OsuTimingPanel
        track={osuTimingTrack}
        isOpen={Boolean(osuTimingTrack)}
        onClose={() => setOsuTimingTrack(null)}
        onTrackUpdated={(updatedTrack) => {
          setOsuTimingTrack(updatedTrack);
          setTracks((current) => current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item)));
        }}
      />

      {versionTrack ? (
        <div
          className="duplicate-version-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="重复歌曲版本"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setVersionTrack(null);
            }
          }}
        >
          <section className="duplicate-version-panel" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Duplicate Track Merge View</span>
                <h2>{versionTrack.title}</h2>
                <p>{duplicateSummary ? `${duplicateSummary.duplicateGroups} 组 / 隐藏 ${duplicateSummary.hiddenTracks} 首` : 'strict 模式'}</p>
              </div>
              <button className="row-action" type="button" aria-label="关闭版本面板" onClick={() => setVersionTrack(null)}>
                <X size={17} />
              </button>
            </header>
            {versionsBusy ? <p className="duplicate-version-empty">读取版本中...</p> : null}
            {!versionsBusy && versionMembers.length === 0 ? <p className="duplicate-version-empty">没有找到隐藏版本。需要先分析重复歌曲。</p> : null}
            <div className="duplicate-version-list">
              {versionMembers.map((member) => (
                <article className="duplicate-version-row" key={member.track.id}>
                  <div>
                    <strong>{member.track.title}</strong>
                    <span>{member.track.artist} - {member.track.album}</span>
                    <small title={member.track.path}>{member.track.path}</small>
                  </div>
                  <div className="duplicate-version-specs">
                    <span>{member.track.codec ?? 'unknown'}</span>
                    <span>{member.track.bitDepth ? `${member.track.bitDepth}bit` : '--'}</span>
                    <span>{member.track.sampleRate ? `${Math.round(member.track.sampleRate / 1000)}kHz` : '--'}</span>
                    <span>{member.track.bitrate ? `${Math.round(member.track.bitrate / 1000)}kbps` : '--'}</span>
                    <span>{Math.round(member.track.duration)}s</span>
                  </div>
                  <div className="duplicate-version-rank">
                    <span>score {Math.round(member.qualityScore)}</span>
                    <strong>#{member.rank}</strong>
                    {member.hidden ? <em>hidden</em> : <em>当前显示版本</em>}
                  </div>
                  <button className="row-action" type="button" title="播放这个版本" onClick={() => void handlePlayTrack(member.track)}>
                    <Play size={16} />
                  </button>
                </article>
              ))}
            </div>
            <p className="duplicate-version-todo">TODO: 手动指定代表版本。</p>
          </section>
        </div>
      ) : null}
    </div>
  );
};
