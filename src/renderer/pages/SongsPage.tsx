import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, FilePlus2, FolderPlus, ListFilter, Loader2, Play, Radio, RotateCw, Search, Trash2, X } from 'lucide-react';
import type { DuplicateTrackIndexSummary, DuplicateTrackMember, EditableTrackTags, LibraryAudioFormatFilter, LibraryPlaylist, LibraryScanStatus, LibrarySort, LibraryTrack } from '../../shared/types/library';
import type { RemoteSource } from '../../shared/types/remoteSources';
import type { StreamingProviderDescriptor, StreamingProviderName, StreamingSearchResult, StreamingTrack } from '../../shared/types/streaming';
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
import { isPlaybackCancellationError, type QueueSource, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { openAlbumDetailForTrack } from '../utils/albumNavigation';
import { openArtistDetailForTrack } from '../utils/artistNavigation';
import { resolvePlaylistForTrackAdd } from '../utils/appPrompt';
import { dispatchAudioErrorNotice } from '../utils/audioErrorNotice';
import {
  getLibraryDatabaseRecoveryMessage,
  isLibraryDatabaseCorruptionError,
  openLibraryDatabaseRecoverySettings,
} from '../utils/databaseRecovery';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';
import { readStoredLibrarySourceMode, writeStoredLibrarySourceMode, type LibrarySourceMode } from '../utils/librarySourceMode';
import { getRemoteSourcesBridge, getStreamingBridge } from '../utils/echoBridge';
import { getMouseSideButtonDirection, shouldIgnoreMouseSideButtonTarget } from '../utils/mouseSideButtons';
import { summarizeLibraryScanStatuses } from '../utils/libraryScanProgress';
import { streamingTrackToLibraryTrack } from '../utils/streamingTrack';
import { formatUserFacingError } from '../utils/userFacingError';

const pageSize = 100;
const maxPreservedRefreshPageSize = 500;
const preserveScrollThresholdPx = 80;
const remoteSourcePlaybackRefreshDelayMs = 4000;
const sortMenuCloseAnimationMs = 120;
const getSongsScrollElement = (): HTMLElement | null => document.querySelector('.track-list') as HTMLElement | null;
const readSongsScrollTop = (): number => getSongsScrollElement()?.scrollTop ?? 0;
const isPreserveScrollLibraryEvent = (event: Event): boolean =>
  event instanceof CustomEvent && event.detail && typeof event.detail === 'object' && event.detail.preserveScroll === true;
const dispatchLibraryChangedPreservingScroll = (): void => {
  window.dispatchEvent(new CustomEvent('library:changed', { detail: { preserveScroll: true } }));
};
const isRemoteSourceRefreshPlaybackBusy = (state: string | null | undefined): boolean =>
  state === 'loading' || state === 'playing';
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

const audioFormatFilterOptions: Array<{ value: LibraryAudioFormatFilter; labelKey: TranslationKey }> = [
  { value: 'all', labelKey: 'songs.filter.audioFormat.all' },
  { value: 'sampleRate44100', labelKey: 'songs.filter.audioFormat.sampleRate44100' },
  { value: 'sampleRate48000', labelKey: 'songs.filter.audioFormat.sampleRate48000' },
  { value: 'sampleRate88200', labelKey: 'songs.filter.audioFormat.sampleRate88200' },
  { value: 'sampleRate96000', labelKey: 'songs.filter.audioFormat.sampleRate96000' },
  { value: 'sampleRate176400', labelKey: 'songs.filter.audioFormat.sampleRate176400' },
  { value: 'sampleRate192000', labelKey: 'songs.filter.audioFormat.sampleRate192000' },
  { value: 'sampleRate352800', labelKey: 'songs.filter.audioFormat.sampleRate352800' },
  { value: 'sampleRate384000', labelKey: 'songs.filter.audioFormat.sampleRate384000' },
  { value: 'dsd', labelKey: 'songs.filter.audioFormat.dsd' },
  { value: 'otherSampleRate', labelKey: 'songs.filter.audioFormat.otherSampleRate' },
];

const songsSortStorageKey = 'echo-next.songs.sort';
const songsHideDuplicatesStorageKey = 'echo-next.songs.hide-duplicates';
const songsOsuHiFiModeStorageKey = 'echo-next.songs.osu-hifi-mode';
const validSortValues = new Set<LibrarySort>(sortOptions.map((option) => option.value));
const scanPollIntervalMs = 500;
const finishedScanStatuses = new Set<LibraryScanStatus['status']>(['completed', 'cancelled', 'failed']);
const osuHiFiSearchPageSize = 20;
const osuHiFiProviderPriority: StreamingProviderName[] = ['netease', 'qqmusic', 'tidal', 'spotify', 'kugou', 'soundcloud', 'youtube', 'bilibili', 'plugin'];
type Translate = ReturnType<typeof useI18n>['t'];

const scanPhaseLabelKeys: Record<LibraryScanStatus['phase'], TranslationKey> = {
  queued: 'songs.scan.phase.queued',
  discovering: 'songs.scan.phase.discovering',
  checking_cache: 'songs.scan.phase.checkingCache',
  reading_metadata: 'songs.scan.phase.readingMetadata',
  extracting_covers: 'songs.scan.phase.extractingCovers',
  grouping_albums: 'songs.scan.phase.groupingAlbums',
  writing_database: 'songs.scan.phase.writingDatabase',
  finished: 'songs.scan.phase.finished',
  failed: 'songs.scan.phase.failed',
  cancelled: 'songs.scan.phase.cancelled',
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

const readStoredOsuHiFiMode = (): boolean => {
  try {
    return window.localStorage.getItem(songsOsuHiFiModeStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeStoredOsuHiFiMode = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(songsOsuHiFiModeStorageKey, enabled ? 'true' : 'false');
  } catch {
    // This is only a local playback preference.
  }
};

const uniqueIds = (ids: string[]): string[] => Array.from(new Set(ids.filter(Boolean)));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const normalizeOsuHiFiIdentityText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase();

const osuHiFiArtistCandidates = (track: StreamingTrack): string[] =>
  uniqueIds([
    track.artist,
    ...((Array.isArray(track.artists) ? track.artists : []).map((artist) => artist.name)),
  ].map(normalizeOsuHiFiIdentityText));

const streamingTrackHasLosslessSource = (track: StreamingTrack): boolean =>
  track.qualities.includes('lossless') || track.qualities.includes('hires');

const isExactOsuHiFiMatch = (candidate: StreamingTrack, target: LibraryTrack): boolean => {
  const targetTitle = normalizeOsuHiFiIdentityText(target.title);
  const targetArtist = normalizeOsuHiFiIdentityText(target.artist);
  if (!targetTitle || !targetArtist || normalizeOsuHiFiIdentityText(candidate.title) !== targetTitle) {
    return false;
  }

  return osuHiFiArtistCandidates(candidate).includes(targetArtist);
};

const isOsuHiFiPlayableTarget = (track: LibraryTrack): boolean =>
  track.unavailable !== true && track.mediaType !== 'streaming';

const getOsuBeatmapsetId = (track: LibraryTrack): string | null => {
  const text = [track.album, track.path, track.stableKey].filter(Boolean).join('\n');
  return /\bosu!\s+beatmapset\s+(\d+)\b/iu.exec(text)?.[1] ?? null;
};

const osuBeatmapsetUrl = (track: LibraryTrack): string | null => {
  const beatmapsetId = getOsuBeatmapsetId(track);
  return beatmapsetId ? `https://osu.ppy.sh/beatmapsets/${beatmapsetId}` : null;
};

const createOsuHiFiQueueSource = (provider: StreamingProviderDescriptor, t: Translate): QueueSource => ({
  type: 'streaming',
  label: t('songs.osuHiFi.queueSource', { provider: provider.displayName }),
  provider: provider.name,
});

const sortOsuHiFiProviders = (providers: StreamingProviderDescriptor[]): StreamingProviderDescriptor[] =>
  providers
    .filter((provider) =>
      provider.enabled &&
      provider.supportsSearch &&
      provider.supportsPlayback !== false &&
      provider.accountConnected === true,
    )
    .sort((left, right) => {
      const leftIndex = osuHiFiProviderPriority.indexOf(left.name);
      const rightIndex = osuHiFiProviderPriority.indexOf(right.name);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });

const findExactOsuHiFiMatch = async (
  target: LibraryTrack,
  providers: StreamingProviderDescriptor[],
  search: (request: { provider: StreamingProviderName; query: string; mediaTypes: ['track']; page: number; pageSize: number }) => Promise<StreamingSearchResult>,
): Promise<{ provider: StreamingProviderDescriptor; track: StreamingTrack } | null> => {
  const query = `${target.title} ${target.artist}`.trim();
  const results = await Promise.allSettled(providers.map(async (provider) => {
    const result = await search({
      provider: provider.name,
      query,
      mediaTypes: ['track'],
      page: 1,
      pageSize: osuHiFiSearchPageSize,
    });
    const match = result.tracks.find((candidate) =>
      candidate.playable &&
      streamingTrackHasLosslessSource(candidate) &&
      isExactOsuHiFiMatch(candidate, target),
    );
    return match ? { provider, track: match } : null;
  }));

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }

  if (results.length > 0 && results.every((result) => result.status === 'rejected')) {
    throw results[0].reason;
  }

  return null;
};

const createOsuHiFiPlaybackTrack = (target: LibraryTrack, match: StreamingTrack): LibraryTrack => {
  const resolved = streamingTrackToLibraryTrack(match, 'lossless');
  return {
    ...resolved,
    coverId: target.coverId ?? null,
    coverThumb: target.coverThumb ?? null,
  };
};

const summarizeScanJobs = (statuses: LibraryScanStatus[], t: Translate): string => {
  const active = statuses.find((status) => !finishedScanStatuses.has(status.status)) ?? statuses[statuses.length - 1];
  const totals = summarizeLibraryScanStatuses(statuses);
  const phase = active ? t(scanPhaseLabelKeys[active.phase]) : t('songs.scan.phase.incremental');
  const progress = totals.totalFiles > 0 ? `${totals.processedFiles}/${totals.totalFiles}` : `${totals.processedFiles}`;

  if (statuses.length > 0 && statuses.every((status) => finishedScanStatuses.has(status.status))) {
    return t('songs.scan.completedSummary', {
      added: totals.addedTracks,
      updated: totals.updatedTracks,
      removed: totals.removedTracks,
      skipped: totals.skippedFiles,
      covers: totals.coverCount,
      errors: totals.errorCount,
    });
  }

  return t('songs.scan.progress', {
    phase,
    progress,
    added: totals.addedTracks,
    updated: totals.updatedTracks,
    skipped: totals.skippedFiles,
    covers: totals.coverCount,
    errors: totals.errorCount,
  });
};

type InitialSongsState = {
  audioFormatFilter: LibraryAudioFormatFilter;
  hideDuplicates: boolean;
  showDuplicatesOnly: boolean;
  showOsuOnly: boolean;
  snapshot: SongsFirstPageSnapshot | null;
  sort: LibrarySort;
  sourceMode: LibrarySourceMode;
};

const readInitialSongsState = (): InitialSongsState => {
  const sort = readStoredSort();
  const audioFormatFilter: LibraryAudioFormatFilter = 'all';
  const hideDuplicates = readStoredHideDuplicates();
  const sourceMode = readStoredLibrarySourceMode();
  const query = {
    pageSize,
    search: '',
    sort,
    audioFormatFilter,
    sourceProvider: sourceMode,
    hideDuplicates,
    showDuplicatesOnly: false,
    showOsuOnly: false,
    duplicateMode: 'strict' as const,
  };
  const queryKey = createSongsFirstPageSnapshotQueryKey(query);

  return {
    audioFormatFilter,
    hideDuplicates,
    showDuplicatesOnly: false,
    showOsuOnly: false,
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
  const [audioFormatFilter, setAudioFormatFilter] = useState<LibraryAudioFormatFilter>(() => initialSongsState.audioFormatFilter);
  const [sourceMode, setSourceModeState] = useState<LibrarySourceMode>(() => initialSongsState.sourceMode);
  const [remoteSourceId, setRemoteSourceId] = useState<string | null>(null);
  const [remoteSources, setRemoteSources] = useState<RemoteSource[]>([]);
  const [remoteSourcesLoaded, setRemoteSourcesLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMaintainingLibrary, setIsMaintainingLibrary] = useState(false);
  const [hideDuplicates, setHideDuplicates] = useState(() => initialSongsState.hideDuplicates);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(() => initialSongsState.showDuplicatesOnly);
  const [showOsuOnly, setShowOsuOnly] = useState(() => initialSongsState.showOsuOnly);
  const [osuHiFiModeEnabled, setOsuHiFiModeEnabled] = useState(readStoredOsuHiFiMode);
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOsuHiFiResolving, setIsOsuHiFiResolving] = useState(false);
  const [databaseRecoveryAvailable, setDatabaseRecoveryAvailable] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isSortClosing, setIsSortClosing] = useState(false);
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
  const sortMenuCloseTimerRef = useRef<number | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const { currentTrackId, playTrack, appendToQueue, appendTracksToQueue, playTrackNext, removeTrackFromQueue } = usePlaybackQueue();
  const playbackStatusSnapshot = useSharedPlaybackStatus();
  const remoteSourceRefreshPlaybackBusy = isRemoteSourceRefreshPlaybackBusy(
    playbackStatusSnapshot.audioStatus?.state ?? playbackStatusSnapshot.playbackStatus?.state,
  );
  const visibleTrackIdsKey = useMemo(() => visibleTrackIds.join('\0'), [visibleTrackIds]);
  const loadedTrackIdsKey = useMemo(() => uniqueIds(tracks.map((track) => track.id)).join('\0'), [tracks]);
  const activeSortLabel = t(sortOptions.find((option) => option.value === sort)?.labelKey ?? 'songs.sort.default');
  const activeAudioFormatFilterLabel = t(audioFormatFilterOptions.find((option) => option.value === audioFormatFilter)?.labelKey ?? 'songs.filter.audioFormat.all');
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (showDuplicatesOnly) {
      labels.push(t('songs.duplicatesOnly'));
    }
    if (showOsuOnly) {
      labels.push(t('songs.osuOnly'));
    }
    if (audioFormatFilter !== 'all') {
      labels.push(activeAudioFormatFilterLabel);
    }
    return labels;
  }, [activeAudioFormatFilterLabel, audioFormatFilter, showDuplicatesOnly, showOsuOnly, t]);
  const activeFilterCount = activeFilterLabels.length;
  const sortButtonTitle = activeFilterCount > 0 ? `${activeSortLabel} · ${activeFilterLabels.join(' / ')}` : activeSortLabel;
  const effectiveHideDuplicates = showDuplicatesOnly ? false : hideDuplicates;
  const osuHiFiModeActive = showOsuOnly && osuHiFiModeEnabled;
  const hasRemoteSources = remoteSources.length > 0;
  const sourceLoadGate = sourceMode === 'remote' ? `${remoteSourcesLoaded}:${hasRemoteSources}` : sourceMode;
  const queueSource = useMemo(
    () => ({
      type: 'songs' as const,
      label: showDuplicatesOnly
        ? t('songs.duplicatesOnly')
        : showOsuOnly
          ? t('songs.osuOnly')
          : sourceMode === 'remote' ? t('songs.queueSource.remote') : t('songs.queueSource.local'),
      search: search || undefined,
      sort,
      hideDuplicates: effectiveHideDuplicates,
      showDuplicatesOnly,
      showOsuOnly,
      audioFormatFilter: audioFormatFilter === 'all' ? undefined : audioFormatFilter,
    }),
    [audioFormatFilter, effectiveHideDuplicates, search, showDuplicatesOnly, showOsuOnly, sort, sourceMode, t],
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

  const clearSortMenuCloseTimer = useCallback((): void => {
    if (sortMenuCloseTimerRef.current !== null) {
      window.clearTimeout(sortMenuCloseTimerRef.current);
      sortMenuCloseTimerRef.current = null;
    }
  }, []);

  const openSortMenu = useCallback((): void => {
    clearSortMenuCloseTimer();
    setIsSortClosing(false);
    setIsSortOpen(true);
  }, [clearSortMenuCloseTimer]);

  const closeSortMenu = useCallback((): void => {
    if (!isSortOpen || isSortClosing) {
      return;
    }

    clearSortMenuCloseTimer();
    setIsSortClosing(true);
    sortMenuCloseTimerRef.current = window.setTimeout(() => {
      setIsSortOpen(false);
      setIsSortClosing(false);
      sortMenuCloseTimerRef.current = null;
    }, sortMenuCloseAnimationMs);
  }, [clearSortMenuCloseTimer, isSortClosing, isSortOpen]);

  const toggleSortMenu = useCallback((): void => {
    if (isSortOpen && !isSortClosing) {
      closeSortMenu();
      return;
    }

    openSortMenu();
  }, [closeSortMenu, isSortClosing, isSortOpen, openSortMenu]);

  const handleToggleOsuHiFiMode = useCallback((): void => {
    const nextEnabled = !osuHiFiModeEnabled;
    setOsuHiFiModeEnabled(nextEnabled);
    writeStoredOsuHiFiMode(nextEnabled);
    setError(null);
    setStatusMessage(t(nextEnabled ? 'songs.osuHiFi.status.enabled' : 'songs.osuHiFi.status.disabled'));
  }, [osuHiFiModeEnabled, t]);

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
      setShowOsuOnly(false);
    }
    writeStoredLibrarySourceMode(mode);
    clearSongsFirstPageSnapshot();
  }, []);

  useEffect(() => {
    if (sourceMode !== 'remote' && remoteSourcesLoaded) {
      return undefined;
    }

    if (sourceMode === 'remote' || !remoteSourceRefreshPlaybackBusy) {
      void refreshRemoteSources();
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      void refreshRemoteSources();
    }, remoteSourcePlaybackRefreshDelayMs);

    return () => window.clearTimeout(timerId);
  }, [refreshRemoteSources, remoteSourceRefreshPlaybackBusy, remoteSourcesLoaded, sourceMode]);

  useEffect(() => {
    if (sourceMode !== 'remote') {
      return undefined;
    }

    const handleRemoteSourcesChanged = (): void => {
      void refreshRemoteSources();
    };

    window.addEventListener('library:changed', handleRemoteSourcesChanged);
    return () => {
      window.removeEventListener('library:changed', handleRemoteSourcesChanged);
    };
  }, [refreshRemoteSources, sourceMode]);

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
      setShowOsuOnly(false);
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
    if (!isSortOpen || isSortClosing) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        closeSortMenu();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [closeSortMenu, isSortClosing, isSortOpen]);

  useEffect(() => () => clearSortMenuCloseTimer(), [clearSortMenuCloseTimer]);

  const handleToggleDuplicateFilter = useCallback((): void => {
    const nextShowDuplicatesOnly = !showDuplicatesOnly;
    setShowDuplicatesOnly(nextShowDuplicatesOnly);
    closeSortMenu();
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
  }, [clearListMetadataCache, closeSortMenu, showDuplicatesOnly, sourceMode]);

  const handleToggleOsuFilter = useCallback((): void => {
    const nextShowOsuOnly = !showOsuOnly;
    setShowOsuOnly(nextShowOsuOnly);
    closeSortMenu();
    setSelectedTrackIds({});
    clearSongsFirstPageSnapshot();
    clearListMetadataCache();

    if (nextShowOsuOnly) {
      if (sourceMode !== 'local') {
        setSourceModeState('local');
        writeStoredLibrarySourceMode('local');
      }
      setRemoteSourceId(null);
      setShowDuplicatesOnly(false);
    }
  }, [clearListMetadataCache, closeSortMenu, showOsuOnly, sourceMode]);

  const handleAudioFormatFilterChange = useCallback(
    (nextAudioFormatFilter: LibraryAudioFormatFilter): void => {
      setAudioFormatFilter(nextAudioFormatFilter);
      closeSortMenu();
      setSelectedTrackIds({});
      clearSongsFirstPageSnapshot();
      clearListMetadataCache();
    },
    [clearListMetadataCache, closeSortMenu],
  );

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
          audioFormatFilter,
          sourceProvider: sourceMode,
          ...(sourceMode === 'remote' && remoteSourceId ? { sourceId: remoteSourceId } : {}),
          hideDuplicates: effectiveHideDuplicates,
          showDuplicatesOnly,
          showOsuOnly,
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
    [audioFormatFilter, clearListMetadataCache, effectiveHideDuplicates, remoteSourceId, reportSongsError, search, showDuplicatesOnly, showOsuOnly, sort, sourceMode],
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
        setDuplicateMessage(t('songs.message.needAnalyzeDuplicates'));
      }
    } catch {
      // Duplicate controls are optional around the core song list.
    }
  }, [t]);

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

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      if (getMouseSideButtonDirection(event) && !shouldIgnoreMouseSideButtonTarget(event.target)) {
        event.preventDefault();
      }
    };

    const handleMouseUp = (event: MouseEvent): void => {
      const direction = getMouseSideButtonDirection(event);
      if (!direction || event.defaultPrevented || shouldIgnoreMouseSideButtonTarget(event.target)) {
        return;
      }

      if (direction === 'previous') {
        if (loadedStartIndex <= 0 || isLoading) {
          return;
        }

        event.preventDefault();
        handleLoadPrevious();
        return;
      }

      if (!hasMore || isLoading) {
        return;
      }

      event.preventDefault();
      handleLoadMore();
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, [handleLoadMore, handleLoadPrevious, hasMore, isLoading, loadedStartIndex]);

  const handleImportFolder = (): void => {
    window.dispatchEvent(new Event('app:navigate:import-folder'));
  };

  const handleImportFile = (): void => {
    window.dispatchEvent(new Event('app:import-file'));
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
    setStatusMessage(t('songs.maintenance.scanning'));

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
        setStatusMessage(summarizeScanJobs(statuses, t));

        while (statuses.some((status) => !finishedScanStatuses.has(status.status))) {
          await sleep(scanPollIntervalMs);
          statuses = await Promise.all(statuses.map((status) => library.getScanStatus(status.id)));
          setStatusMessage(summarizeScanJobs(statuses, t));
        }

        const failedJob = statuses.find((status) => status.status === 'failed');
        if (failedJob) {
          throw new Error(t('songs.maintenance.error.incrementalFailed', { error: failedJob.errors[0] ?? 'unknown error' }));
        }
      }
      await loadTracks(1, 'replace');
      window.dispatchEvent(new Event('library:changed'));
      setStatusMessage(
        t('songs.maintenance.completed', {
          scanned: cleanup.scannedCount,
          missing: cleanup.missingRemovedCount,
          seconds: cleanup.shortDurationThresholdSeconds,
          short: cleanup.shortRemovedCount,
          folders: scanJobs.length,
        }),
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

    if (!window.confirm(t('songs.confirm.clearList', { total }))) {
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
      setStatusMessage(t('songs.message.clearedList', { count: result.removedCount }));
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setIsClearing(false);
    }
  };

  const resolveOsuHiFiPlaybackTrack = useCallback(async (target: LibraryTrack): Promise<{ track: LibraryTrack; provider: StreamingProviderDescriptor; source: QueueSource }> => {
    const streaming = getStreamingBridge();
    if (!streaming?.getProviders || !streaming.search) {
      throw new Error(t('songs.osuHiFi.error.bridgeUnavailable'));
    }

    const providers = sortOsuHiFiProviders(await streaming.getProviders());
    if (providers.length === 0) {
      throw new Error(t('songs.osuHiFi.error.noAccount'));
    }

    const match = await findExactOsuHiFiMatch(target, providers, streaming.search);
    if (!match) {
      throw new Error(t('songs.osuHiFi.error.notFound', { title: target.title, artist: target.artist }));
    }

    return {
      track: createOsuHiFiPlaybackTrack(target, match.track),
      provider: match.provider,
      source: createOsuHiFiQueueSource(match.provider, t),
    };
  }, [t]);

  const handlePlayTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      const playback = window.echo?.playback;

      if (!playback) {
        setError(t('songs.error.desktopBridgePlay'));
        return;
      }

      const shouldUseOsuHiFi = osuHiFiModeActive && isOsuHiFiPlayableTarget(track);
      if (shouldUseOsuHiFi && isOsuHiFiResolving) {
        return;
      }

      try {
        setError(null);
        setSelectedTrackIds({});

        if (shouldUseOsuHiFi) {
          setIsOsuHiFiResolving(true);
          setStatusMessage(t('songs.osuHiFi.status.matching', { title: track.title, artist: track.artist }));
          const resolved = await resolveOsuHiFiPlaybackTrack(track);
          await playTrack(resolved.track, {
            replaceQueueWithItems: tracks.map((candidate) =>
              candidate.id === track.id
                ? { track: resolved.track, source: resolved.source }
                : { track: candidate, source: queueSource },
            ),
            source: resolved.source,
          });
          setStatusMessage(t('songs.osuHiFi.status.playing', {
            title: resolved.track.title,
            artist: resolved.track.artist,
            provider: resolved.provider.displayName,
          }));
          return;
        }

        await playTrack(track, {
          replaceQueueWith: tracks,
          source: queueSource,
        });
      } catch (playError) {
        if (isPlaybackCancellationError(playError)) {
          return;
        }

        if (shouldUseOsuHiFi) {
          const hifiError = formatUserFacingError(playError, { context: 'streaming', fallback: t('songs.osuHiFi.error.playFailed') });
          setError(hifiError);
          setStatusMessage(hifiError);
          try {
            await playTrack(track, {
              replaceQueueWith: tracks,
              source: queueSource,
            });
          } catch (fallbackError) {
            if (!isPlaybackCancellationError(fallbackError)) {
              dispatchAudioErrorNotice(fallbackError);
            }
          }
          return;
        }

        dispatchAudioErrorNotice(playError);
      } finally {
        if (shouldUseOsuHiFi) {
          setIsOsuHiFiResolving(false);
        }
      }
    },
    [isOsuHiFiResolving, osuHiFiModeActive, playTrack, queueSource, resolveOsuHiFiPlaybackTrack, t, tracks],
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
      setError(t('songs.error.streamingPlaylistSeparation'));
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
      setStatusMessage(t('songs.message.addedToPlaylist', { playlist: playlist.name, count: uniqueTracks.length }));
      if (skippedStreamingCount > 0) {
        setStatusMessage(t('songs.message.addedToPlaylistSkippedStreaming', { playlist: playlist.name, count: localTrackIds.length, skipped: skippedStreamingCount }));
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }, [resolveTargetLocalPlaylist, t]);

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
        setStatusMessage(t('songs.message.likedTracks', { count: uniqueTracks.length }));
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
      setStatusMessage(t('songs.message.likedTracks', { count: uniqueTracks.length }));
    } catch (likeError) {
      mergeLikedTrackIds(previousStates);
      setError(likeError instanceof Error ? likeError.message : String(likeError));
    }
  }, [mergeLikedTrackIds, resolveTrackLikedBeforeToggle, t]);

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
          setStatusMessage(actionTracks.length > 1 ? t('songs.message.lyricsCacheClearedCount', { count: actionTracks.length }) : t('songs.message.lyricsCacheClearedTrack', { title: track.title }));
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      if (!library && action !== 'play-next' && action !== 'add-to-queue' && action !== 'remove-from-queue' && action !== 'edit-tags' && action !== 'reload-embedded-tags' && action !== 'open-osu-timing' && action !== 'open-osu-beatmapset') {
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
            action === 'open-osu-beatmapset' ||
            action === 'show-in-folder' ||
            action === 'copy-path' ||
            action === 'open-system' ||
            action === 'delete-song')
        ) {
          setError(t('songs.error.remoteFileAction'));
          return;
        }

        switch (action) {
          case 'play-next':
            for (const item of [...actionTracks].reverse()) {
              playTrackNext(item, queueSource);
            }
            if (actionTracks.length > 1) {
              setStatusMessage(t('songs.message.addedPlayNext', { count: actionTracks.length }));
            }
            return;
          case 'add-to-queue':
            if (actionTracks.length > 1) {
              appendTracksToQueue(actionTracks, queueSource);
              setStatusMessage(t('songs.message.addedToQueue', { count: actionTracks.length }));
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
                  ? t('songs.message.removedFromQueue', { count: removedCount })
                  : t('songs.message.noSelectedQueueTracks'),
              );
            }
            return;
          case 'open-osu-timing':
            setOsuTimingTrack(track);
            return;
          case 'open-osu-beatmapset':
            {
              const url = osuBeatmapsetUrl(track);
              if (!url) {
                setError(t('songs.error.osuBeatmapsetMissing'));
                return;
              }
              await window.echo?.app.openExternalUrl(url);
            }
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
              setStatusMessage(t('songs.message.reloadedEmbeddedTags', { title: result.track.title }));
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
              setError(t('songs.error.noCoverToCopy'));
            }
            return;
          case 'save-cover':
            if (!(await library?.saveTrackCover(track.id))) {
              setError(t('songs.error.noCoverSaved'));
            }
            return;
          case 'delete-song':
            if (!window.confirm(t('songs.confirm.deleteSong', { title: track.title }))) {
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
            setError(t('songs.error.playlistFeaturePending'));
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [appendToQueue, appendTracksToQueue, editingTrack, handleAddTracksToPlaylist, handleLikeTracks, handleToggleLiked, playTrackNext, queueSource, removeTrackFromQueue, t, total, trackMenu, tracks.length],
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
          <h1>{t('route.songs.label')}</h1>
          <span>{t('songs.count.tracks', { count: total })}</span>
        </div>

        <div className="songs-tools" aria-label={t('songs.tools.aria')}>
          <button className="tool-button" type="button" aria-label={t('route.importFolder.label')} title={t('route.importFolder.label')} onClick={handleImportFolder}>
            <FolderPlus size={17} />
          </button>
          <button className="tool-button" type="button" aria-label={t('route.importFile.label')} title={t('route.importFile.label')} onClick={handleImportFile}>
            <FilePlus2 size={17} />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label={t('songs.maintenance.action.aria')}
            title={t('songs.maintenance.action.title')}
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

          {showOsuOnly ? (
            <button
              className={`osu-hifi-toggle ${osuHiFiModeEnabled ? 'is-active' : ''}`}
              type="button"
              role="switch"
              aria-checked={osuHiFiModeEnabled}
              onClick={handleToggleOsuHiFiMode}
              disabled={isOsuHiFiResolving}
              title={t('songs.osuHiFi.toggle.title')}
            >
              {isOsuHiFiResolving ? <Loader2 className="spinning-icon" size={15} aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}
              <span>{isOsuHiFiResolving ? t('songs.osuHiFi.action.matching') : t('songs.osuHiFi.toggle.label')}</span>
              <span className="osu-hifi-toggle-state">{osuHiFiModeEnabled ? t('songs.osuHiFi.toggle.on') : t('songs.osuHiFi.toggle.off')}</span>
            </button>
          ) : null}

          <div className="sort-select" ref={sortMenuRef}>
            <button
              className="sort-button"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isSortOpen && !isSortClosing}
              aria-label={sortButtonTitle}
              title={sortButtonTitle}
              onClick={toggleSortMenu}
            >
              <ListFilter className={activeFilterCount > 0 ? 'sort-button-icon sort-button-icon--active' : 'sort-button-icon'} size={16} aria-hidden="true" />
              <span className="sort-button-label">{activeSortLabel}</span>
              {activeFilterCount > 0 ? <span className="sort-button-filter-count" aria-hidden="true">{activeFilterCount}</span> : null}
              <ChevronDown className="sort-button-chevron" size={15} aria-hidden="true" />
            </button>
            {isSortOpen ? (
              <div className="sort-menu" role="listbox" aria-label={t('songs.sort.menuAria')} data-state={isSortClosing ? 'closing' : 'open'}>
                <div className="sort-menu-section-title" role="presentation">{t('songs.filter.section')}</div>
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
                <button
                  className="sort-option sort-option--filter"
                  type="button"
                  role="option"
                  aria-selected={showOsuOnly}
                  onClick={handleToggleOsuFilter}
                >
                  <span>{t('songs.osuOnly')}</span>
                  {showOsuOnly ? <Check size={14} /> : null}
                </button>
                <div className="sort-menu-divider" role="presentation" />
                <div className="sort-menu-section-title" role="presentation">{t('songs.sort.section')}</div>
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    className="sort-option"
                    type="button"
                    role="option"
                    aria-selected={sort === option.value}
                    onClick={() => {
                      setSort(option.value);
                      closeSortMenu();
                    }}
                  >
                    <span>{t(option.labelKey)}</span>
                    {sort === option.value ? <Check size={14} /> : null}
                  </button>
                ))}
                <div className="sort-menu-divider" role="presentation" />
                <div className="sort-menu-section-title" role="presentation">{t('songs.filter.audioFormat')}</div>
                {audioFormatFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    className="sort-option sort-option--filter"
                    type="button"
                    role="option"
                    aria-selected={audioFormatFilter === option.value}
                    onClick={() => handleAudioFormatFilterChange(option.value)}
                  >
                    <span>{t(option.labelKey)}</span>
                    {audioFormatFilter === option.value ? <Check size={14} /> : null}
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
          <div className="songs-import-hint-actions">
            <button type="button" onClick={handleImportFolder}>
              <FolderPlus size={15} />
              {t('songs.empty.action.importFolder')}
            </button>
            <button type="button" onClick={handleImportFile}>
              <FilePlus2 size={15} />
              {t('songs.empty.action.importFile')}
            </button>
          </div>
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

      {statusMessage ? (
        <div className="songs-status-message" role="status" aria-live="polite">
          {statusMessage}
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
          showOpenOsuBeatmapset={showOsuOnly && Boolean(osuBeatmapsetUrl(trackMenu.track))}
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
          aria-label={t('songs.duplicates.dialogAria')}
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
                <p>{duplicateSummary ? t('songs.duplicates.summary', { groups: duplicateSummary.duplicateGroups, hidden: duplicateSummary.hiddenTracks }) : t('songs.duplicates.strictMode')}</p>
              </div>
              <button className="row-action" type="button" aria-label={t('songs.duplicates.action.close')} onClick={() => setVersionTrack(null)}>
                <X size={17} />
              </button>
            </header>
            {versionsBusy ? <p className="duplicate-version-empty">{t('songs.duplicates.loading')}</p> : null}
            {!versionsBusy && versionMembers.length === 0 ? <p className="duplicate-version-empty">{t('songs.duplicates.empty')}</p> : null}
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
                    {member.hidden ? <em>hidden</em> : <em>{t('songs.duplicates.currentVisible')}</em>}
                  </div>
                  <button className="row-action" type="button" title={t('songs.duplicates.action.playVersion')} onClick={() => void handlePlayTrack(member.track)}>
                    <Play size={16} />
                  </button>
                </article>
              ))}
            </div>
            <p className="duplicate-version-todo">{t('songs.duplicates.todo')}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
};
