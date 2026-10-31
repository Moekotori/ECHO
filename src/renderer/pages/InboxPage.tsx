import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Clock3, Disc3, Folder, FolderOpen, ListMusic, ListPlus, Moon, RefreshCw, RotateCcw, Search, SkipForward, Snowflake, Sparkles, UserRound, Waves } from 'lucide-react';
import type {
  LibraryInboxAlbumSummary,
  LibraryInboxFilterKind,
  LibraryInboxItemStatus,
  LibraryInboxIssueReason,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxTrackItem,
  LibraryInboxTrackPage,
  LibraryTrack,
  PlaybackMemoryGraph,
  PlaybackMemoryTrackInsight,
} from '../../shared/types/library';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { getLibraryBridge } from '../utils/echoBridge';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useImeAwareDebouncedSearch } from '../utils/imeInput';
import {
  coverIntelligenceSourceKey,
  readCoverIntelligenceEnabled,
  tryAnalyzeCoverImage,
  writeCoverIntelligenceEnabled,
  type CoverIntelligenceResult,
} from '../utils/coverIntelligence';

const pageSize = 60;
const smartCratePreviewLimit = 4;
const smartCrateSamplePageSize = 160;
const coverIntelligenceAnalysisLimit = 18;

type SmartCrateId = 'lateNight' | 'comeback' | 'coolCovers' | 'hifi441' | 'forgotten' | 'skipReview';
type SmartCrateTone = 'violet' | 'blue' | 'cyan' | 'mint' | 'amber' | 'rose';

type SmartCrateTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverThumb: string | null;
  detail: string;
  queueTrack: LibraryTrack | null;
};

type SmartCrate = {
  id: SmartCrateId;
  title: string;
  kicker: string;
  description: string;
  metric: string;
  tone: SmartCrateTone;
  tracks: SmartCrateTrack[];
  emptyText: string;
};

type BuildSmartCratesOptions = {
  coverIntelligenceEnabled: boolean;
  coolCoverTracks: SmartCrateTrack[];
};

const smartCrateIconMap: Record<SmartCrateId, typeof Moon> = {
  lateNight: Moon,
  comeback: RotateCcw,
  coolCovers: Snowflake,
  hifi441: Waves,
  forgotten: Archive,
  skipReview: SkipForward,
};

const normalizeComparableText = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase();

const isLosslessTrack = (track: Pick<LibraryTrack, 'codec'>): boolean => {
  const codec = normalizeComparableText(track.codec);
  return ['flac', 'wav', 'wave', 'alac', 'aiff', 'aif', 'dsf', 'dff'].includes(codec);
};

const trackArtworkUrl = (
  track: Pick<LibraryTrack, 'coverId' | 'coverThumb'>,
  variant: 'album' | 'large' | 'thumb' = 'thumb',
): string | null => {
  const fallback = track.coverThumb ?? null;
  if (track.coverId) {
    return `echo-cover://${variant}/${encodeURIComponent(track.coverId)}`;
  }

  return fallback?.replace(/^echo-cover:\/\/(?:thumb|album|large|original)\//u, `echo-cover://${variant}/`) ?? fallback;
};

const smartCrateTrackFromLibraryTrack = (track: LibraryTrack, detail: string): SmartCrateTrack => ({
  id: track.id,
  title: track.title,
  artist: track.artist || 'Unknown Artist',
  album: track.album || 'Unknown Album',
  coverThumb: trackArtworkUrl(track),
  detail,
  queueTrack: track,
});

const coverIntelligenceDetail = (
  result: CoverIntelligenceResult,
  t: ReturnType<typeof useI18n>['t'],
): string => t('inboxPage.coverIntelligence.coolDetail', { score: Math.round(result.coolScore * 100) });

const buildCoolCoverTracks = async (
  tracks: LibraryTrack[],
  t: ReturnType<typeof useI18n>['t'],
): Promise<SmartCrateTrack[]> => {
  const candidates = tracks
    .map((track) => ({
      track,
      artworkUrl: trackArtworkUrl(track),
      sourceKey: coverIntelligenceSourceKey(track),
    }))
    .filter((candidate): candidate is { track: LibraryTrack; artworkUrl: string; sourceKey: string } =>
      Boolean(candidate.artworkUrl && candidate.sourceKey),
    )
    .slice(0, coverIntelligenceAnalysisLimit);

  const analyzed = await Promise.all(candidates.map(async ({ track, artworkUrl, sourceKey }) => {
    const result = await tryAnalyzeCoverImage(artworkUrl, sourceKey);
    if (!result || result.temperature !== 'cool') {
      return null;
    }
    return smartCrateTrackFromLibraryTrack(track, coverIntelligenceDetail(result, t));
  }));

  return uniqueSmartCrateTracks(analyzed.filter((track): track is SmartCrateTrack => Boolean(track))).slice(0, smartCratePreviewLimit);
};

const smartCrateTrackFromInsight = (
  insight: PlaybackMemoryTrackInsight,
  resolvedTrack: LibraryTrack | null,
  detail: string,
): SmartCrateTrack => ({
  id: insight.trackId ?? insight.id,
  title: insight.title,
  artist: insight.artist || 'Unknown Artist',
  album: insight.album || 'Unknown Album',
  coverThumb: resolvedTrack ? trackArtworkUrl(resolvedTrack) : insight.coverThumb,
  detail,
  queueTrack: resolvedTrack,
});

const findTrackForInsight = (
  insight: PlaybackMemoryTrackInsight | null,
  tracks: LibraryTrack[],
): LibraryTrack | null => {
  if (!insight) {
    return null;
  }

  if (insight.trackId) {
    const exactTrack = tracks.find((track) => track.id === insight.trackId);
    if (exactTrack) {
      return exactTrack;
    }
  }

  const title = normalizeComparableText(insight.title);
  const artist = normalizeComparableText(insight.artist);
  return tracks.find((track) =>
    normalizeComparableText(track.title) === title && normalizeComparableText(track.artist) === artist,
  ) ?? tracks.find((track) => normalizeComparableText(track.title) === title) ?? null;
};

const uniqueSmartCrateTracks = (tracks: SmartCrateTrack[]): SmartCrateTrack[] => {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = track.queueTrack?.id ?? `${normalizeComparableText(track.title)}\0${normalizeComparableText(track.artist)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const buildSmartCrates = (
  memory: PlaybackMemoryGraph | null,
  recentTracks: LibraryTrack[],
  t: ReturnType<typeof useI18n>['t'],
  options: BuildSmartCratesOptions,
): SmartCrate[] => {
  const lateNightInsight = memory?.lateNightTrack ?? memory?.timeBuckets.find((bucket) => bucket.id === 'lateNight')?.topTrack ?? null;
  const comebackInsight = memory?.comebackTrack ?? null;
  const forgottenInsight = memory?.forgottenTrack ?? null;
  const skippedInsight = memory?.skippedTrack ?? null;
  const hifi441Tracks = recentTracks
    .filter((track) => track.sampleRate === 44100 && isLosslessTrack(track))
    .slice(0, smartCratePreviewLimit)
    .map((track) => smartCrateTrackFromLibraryTrack(track, `${track.bitDepth ?? 16}bit / 44.1kHz`));
  const coolCoverTracks = options.coverIntelligenceEnabled ? options.coolCoverTracks : [];

  return [
    {
      id: 'lateNight',
      title: t('inboxPage.smartCrates.lateNight.title'),
      kicker: t('inboxPage.smartCrates.memoryKicker'),
      description: t('inboxPage.smartCrates.lateNight.description'),
      metric: lateNightInsight ? t('inboxPage.smartCrates.playCountMetric', { count: lateNightInsight.playCount }) : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'violet',
      tracks: lateNightInsight
        ? [smartCrateTrackFromInsight(lateNightInsight, findTrackForInsight(lateNightInsight, recentTracks), t('inboxPage.smartCrates.lateNight.detail'))]
        : [],
      emptyText: t('inboxPage.smartCrates.lateNight.empty'),
    },
    {
      id: 'comeback',
      title: t('inboxPage.smartCrates.comeback.title'),
      kicker: t('inboxPage.smartCrates.memoryKicker'),
      description: t('inboxPage.smartCrates.comeback.description'),
      metric: comebackInsight ? t('inboxPage.smartCrates.recentMetric') : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'blue',
      tracks: comebackInsight
        ? [smartCrateTrackFromInsight(comebackInsight, findTrackForInsight(comebackInsight, recentTracks), t('inboxPage.smartCrates.comeback.detail'))]
        : [],
      emptyText: t('inboxPage.smartCrates.comeback.empty'),
    },
    {
      id: 'coolCovers',
      title: t('inboxPage.smartCrates.coolCovers.title'),
      kicker: t('inboxPage.smartCrates.visualKicker'),
      description: options.coverIntelligenceEnabled
        ? t('inboxPage.smartCrates.coolCovers.description')
        : t('inboxPage.coverIntelligence.disabledDescription'),
      metric: !options.coverIntelligenceEnabled
        ? t('inboxPage.coverIntelligence.offMetric')
        : coolCoverTracks.length > 0
          ? t('inboxPage.smartCrates.trackCountMetric', { count: coolCoverTracks.length })
          : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'cyan',
      tracks: uniqueSmartCrateTracks(coolCoverTracks),
      emptyText: options.coverIntelligenceEnabled
        ? t('inboxPage.smartCrates.coolCovers.empty')
        : t('inboxPage.coverIntelligence.disabledEmpty'),
    },
    {
      id: 'hifi441',
      title: t('inboxPage.smartCrates.hifi441.title'),
      kicker: t('inboxPage.smartCrates.qualityKicker'),
      description: t('inboxPage.smartCrates.hifi441.description'),
      metric: hifi441Tracks.length > 0 ? t('inboxPage.smartCrates.trackCountMetric', { count: hifi441Tracks.length }) : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'mint',
      tracks: uniqueSmartCrateTracks(hifi441Tracks),
      emptyText: t('inboxPage.smartCrates.hifi441.empty'),
    },
    {
      id: 'forgotten',
      title: t('inboxPage.smartCrates.forgotten.title'),
      kicker: t('inboxPage.smartCrates.memoryKicker'),
      description: t('inboxPage.smartCrates.forgotten.description'),
      metric: forgottenInsight ? t('inboxPage.smartCrates.forgottenMetric') : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'amber',
      tracks: forgottenInsight
        ? [smartCrateTrackFromInsight(forgottenInsight, findTrackForInsight(forgottenInsight, recentTracks), t('inboxPage.smartCrates.forgotten.detail'))]
        : [],
      emptyText: t('inboxPage.smartCrates.forgotten.empty'),
    },
    {
      id: 'skipReview',
      title: t('inboxPage.smartCrates.skipReview.title'),
      kicker: t('inboxPage.smartCrates.cleanKicker'),
      description: t('inboxPage.smartCrates.skipReview.description'),
      metric: skippedInsight ? t('inboxPage.smartCrates.skipCountMetric', { count: skippedInsight.skippedCount }) : t('inboxPage.smartCrates.waitingMetric'),
      tone: 'rose',
      tracks: skippedInsight
        ? [smartCrateTrackFromInsight(skippedInsight, findTrackForInsight(skippedInsight, recentTracks), t('inboxPage.smartCrates.skipReview.detail'))]
        : [],
      emptyText: t('inboxPage.smartCrates.skipReview.empty'),
    },
  ];
};

const emptyInboxPage = (scope: LibraryInboxScope, filter: LibraryInboxFilterKind): LibraryInboxTrackPage => ({
  items: [],
  page: 1,
  pageSize,
  total: 0,
  hasMore: false,
  batches: [],
  selectedBatch: null,
  scope,
  filter,
  status: 'all',
  story: {
    trackCount: 0,
    albumCount: 0,
    artistCount: 0,
    folderCount: 0,
    missingCoverCount: 0,
    metadataIssueCount: 0,
    unknownArtistCount: 0,
    unknownAlbumCount: 0,
    suspiciousCount: 0,
    pendingCount: 0,
    processedCount: 0,
    ignoredCount: 0,
    coverCompleteness: 0,
    metadataCompleteness: 0,
    totalDuration: 0,
    topFolders: [],
    topArtists: [],
  },
  albums: [],
  facets: {
    folders: [],
    albums: [],
    artists: [],
  },
});

const reasonLabelKeys: Record<LibraryInboxIssueReason, TranslationKey> = {
  missing_cover: 'inboxPage.reason.missing_cover',
  missing_title: 'inboxPage.reason.missing_title',
  missing_artist: 'inboxPage.reason.missing_artist',
  missing_album: 'inboxPage.reason.missing_album',
  missing_album_artist: 'inboxPage.reason.missing_album_artist',
  missing_track_no: 'inboxPage.reason.missing_track_no',
  missing_disc_no: 'inboxPage.reason.missing_disc_no',
  missing_year: 'inboxPage.reason.missing_year',
  missing_genre: 'inboxPage.reason.missing_genre',
  unknown_artist: 'inboxPage.reason.unknown_artist',
  filename_fallback: 'inboxPage.reason.filename_fallback',
  unknown_field: 'inboxPage.reason.unknown_field',
  metadata_fallback: 'inboxPage.reason.metadata_fallback',
  unknown_album: 'inboxPage.reason.unknown_album',
  embedded_metadata_error: 'inboxPage.reason.embedded_metadata_error',
  embedded_cover_error: 'inboxPage.reason.embedded_cover_error',
  network_metadata_candidate: 'inboxPage.reason.network_metadata_candidate',
  network_cover_candidate: 'inboxPage.reason.network_cover_candidate',
  suspicious_file: 'inboxPage.reason.suspicious_file',
};

const statusLabelKeys: Record<LibraryInboxItemStatus, TranslationKey> = {
  pending: 'inboxPage.status.pending',
  processed: 'inboxPage.status.processed',
  ignored: 'inboxPage.status.ignored',
};

const formatDateTime = (value: string | null | undefined, emptyLabel: string): string => {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
};

const batchSelectValue = (scope: LibraryInboxScope, batchId: string | null): string =>
  scope === 'all' ? '__all__' : scope === 'latest' ? '__latest__' : batchId ?? '__latest__';

const readTrackPath = (item: LibraryInboxTrackItem): string => item.track.path;

const formatDurationHours = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0h';
  }

  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
};

const buildStoryLine = (
  scopeLabel: string,
  story: LibraryInboxTrackPage['story'],
  t: ReturnType<typeof useI18n>['t'],
): string => {
  if (story.trackCount <= 0) {
    return t('inboxPage.story.empty');
  }

  const pieces = [
    t('inboxPage.story.summaryTracks', { scope: scopeLabel, count: story.trackCount }),
    t('inboxPage.story.summaryAlbums', { count: story.albumCount }),
    t('inboxPage.story.summaryArtists', { count: story.artistCount }),
  ];
  const warnings = [
    story.missingCoverCount > 0 ? t('inboxPage.story.warningMissingCover', { count: story.missingCoverCount }) : null,
    story.metadataIssueCount > 0 ? t('inboxPage.story.warningMetadataIssue', { count: story.metadataIssueCount }) : null,
  ].filter((value): value is string => Boolean(value));

  return warnings.length > 0
    ? t('inboxPage.story.withWarnings', { summary: pieces.join('、'), warnings: warnings.join('、') })
    : t('inboxPage.story.clean', { summary: pieces.join('、') });
};

const albumKey = (album: LibraryInboxAlbumSummary): string => `${album.album}\0${album.albumArtist}`;

const inboxItemKey = (item: Pick<LibraryInboxTrackItem, 'batchId' | 'track'>): string => `${item.batchId}\0${item.track.id}`;

const formatPercent = (value: number): string => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

export const InboxPage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const [scope, setScope] = useState<LibraryInboxScope>('latest');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryInboxFilterKind>('all');
  const [status, setStatus] = useState<LibraryInboxStatusFilter>('all');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [album, setAlbum] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const {
    search,
    searchInputProps,
    setSearch,
    setSearchInput,
  } = useImeAwareDebouncedSearch(220);
  const [pageData, setPageData] = useState<LibraryInboxTrackPage>(() => emptyInboxPage('latest', 'all'));
  const [items, setItems] = useState<LibraryInboxTrackItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, LibraryInboxTrackItem>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverIntelligenceEnabled, setCoverIntelligenceEnabled] = useState(() => readCoverIntelligenceEnabled());
  const [smartCrates, setSmartCrates] = useState<SmartCrate[]>(() =>
    buildSmartCrates(null, [], t, { coverIntelligenceEnabled: readCoverIntelligenceEnabled(), coolCoverTracks: [] }),
  );
  const [selectedCrateId, setSelectedCrateId] = useState<SmartCrateId>('lateNight');
  const [isLoadingSmartCrates, setIsLoadingSmartCrates] = useState(false);
  const requestIdRef = useRef(0);
  const smartCrateRequestIdRef = useRef(0);

  const localizedFilterOptions = useMemo<Array<{ value: LibraryInboxFilterKind; label: string }>>(
    () => [
      { value: 'all', label: t('inboxPage.filter.all') },
      { value: 'missing_cover', label: t('inboxPage.filter.missingCover') },
      { value: 'metadata_issue', label: t('inboxPage.filter.metadataIssue') },
      { value: 'unknown_artist', label: t('inboxPage.filter.unknownArtist') },
      { value: 'unknown_album', label: t('inboxPage.filter.unknownAlbum') },
      { value: 'suspicious_file', label: t('inboxPage.filter.suspiciousFile') },
    ],
    [t],
  );

  const localizedStatusOptions = useMemo<Array<{ value: LibraryInboxStatusFilter; label: string }>>(
    () => [
      { value: 'all', label: t('inboxPage.status.all') },
      { value: 'pending', label: t('inboxPage.status.pending') },
      { value: 'processed', label: t('inboxPage.status.processed') },
      { value: 'ignored', label: t('inboxPage.status.ignored') },
    ],
    [t],
  );

  const loadInbox = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.getLibraryInboxTracks) {
        setPageData(emptyInboxPage(scope, filter));
        setItems([]);
        setError(t('inboxPage.error.desktopBridgeRead'));
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setIsLoading(true);
      setError(null);

      try {
        const result = await library.getLibraryInboxTracks({
          scope,
          batchId: scope === 'batch' ? batchId : null,
          filter,
          status,
          folderId,
          album,
          artist,
          page: nextPage,
          pageSize,
          search,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setPageData(result);
        setItems((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          setPageData(emptyInboxPage(scope, filter));
          setItems([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [album, artist, batchId, filter, folderId, scope, search, status, t],
  );

  useEffect(() => {
    void loadInbox(1, 'replace');
  }, [loadInbox]);

  const loadSmartCrates = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    const requestId = smartCrateRequestIdRef.current + 1;
    smartCrateRequestIdRef.current = requestId;

    if (!library?.getTracks) {
      setSmartCrates(buildSmartCrates(null, [], t, { coverIntelligenceEnabled, coolCoverTracks: [] }));
      return;
    }

    setIsLoadingSmartCrates(true);
    try {
      const [trackPage, memoryGraph] = await Promise.all([
        library.getTracks({ page: 1, pageSize: smartCrateSamplePageSize, sort: 'recent' }),
        library.getPlaybackMemoryGraph?.({ page: 1, pageSize: 80, sort: 'plays' }) ?? Promise.resolve(null),
      ]);
      const coolCoverTracks = coverIntelligenceEnabled ? await buildCoolCoverTracks(trackPage.items, t) : [];

      if (smartCrateRequestIdRef.current !== requestId) {
        return;
      }

      setSmartCrates(buildSmartCrates(memoryGraph, trackPage.items, t, { coverIntelligenceEnabled, coolCoverTracks }));
    } catch {
      if (smartCrateRequestIdRef.current === requestId) {
        setSmartCrates(buildSmartCrates(null, [], t, { coverIntelligenceEnabled, coolCoverTracks: [] }));
      }
    } finally {
      if (smartCrateRequestIdRef.current === requestId) {
        setIsLoadingSmartCrates(false);
      }
    }
  }, [coverIntelligenceEnabled, t]);

  useEffect(() => {
    void loadSmartCrates();
  }, [loadSmartCrates]);

  useEffect(() => {
    setSelectedItems({});
  }, [album, artist, batchId, filter, folderId, scope, search, status]);

  useEffect(() => {
    const unsubscribe = getLibraryBridge()?.onLibraryChanged?.(() => {
      void loadInbox(1, 'replace');
      void loadSmartCrates();
    });

    return () => unsubscribe?.();
  }, [loadInbox, loadSmartCrates]);

  const selectedBatch = pageData.selectedBatch;
  const story = pageData.story;
  const albumSummaries = pageData.albums;
  const hasFilters = filter !== 'all' || status !== 'all' || Boolean(folderId || album || artist || search);
  const visibleCount = items.length;
  const selectedItemList = useMemo(() => Object.values(selectedItems), [selectedItems]);
  const selectedCount = selectedItemList.length;
  const allVisibleSelected = items.length > 0 && items.every((item) => Boolean(selectedItems[inboxItemKey(item)]));

  const currentInboxQuery = useMemo(
    () => ({
      scope,
      batchId: scope === 'batch' ? batchId : null,
      filter,
      status,
      folderId,
      album,
      artist,
      search,
    }),
    [album, artist, batchId, filter, folderId, scope, search, status],
  );

  const selectedScopeLabel = useMemo(() => {
    if (scope === 'all') {
      return t('inboxPage.batch.recentAll');
    }
    if (scope === 'latest') {
      return t('inboxPage.batch.latest');
    }
    return selectedBatch?.folderName ?? t('inboxPage.batch.selected');
  }, [scope, selectedBatch, t]);

  const storyLine = useMemo(() => buildStoryLine(selectedScopeLabel, story, t), [selectedScopeLabel, story, t]);
  const selectedSmartCrate = useMemo(
    () => smartCrates.find((crate) => crate.id === selectedCrateId) ?? smartCrates[0],
    [selectedCrateId, smartCrates],
  );
  const selectedCrateQueueTracks = useMemo(
    () => selectedSmartCrate?.tracks.map((track) => track.queueTrack).filter((track): track is LibraryTrack => Boolean(track)) ?? [],
    [selectedSmartCrate],
  );
  const SelectedSmartCrateIcon = selectedSmartCrate ? smartCrateIconMap[selectedSmartCrate.id] : Sparkles;

  const handleSelectBatch = (value: string): void => {
    setMessage(null);
    setFolderId(null);
    setAlbum(null);
    setArtist(null);

    if (value === '__all__') {
      setScope('all');
      setBatchId(null);
      return;
    }
    if (value === '__latest__') {
      setScope('latest');
      setBatchId(null);
      return;
    }

    setScope('batch');
    setBatchId(value);
  };

  const handleCoverIntelligenceToggle = (enabled: boolean): void => {
    writeCoverIntelligenceEnabled(enabled);
    setCoverIntelligenceEnabled(enabled);
    setMessage(t(enabled ? 'inboxPage.coverIntelligence.enabledMessage' : 'inboxPage.coverIntelligence.disabledMessage'));
    setError(null);
  };

  const handleCreatePlaylist = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.createPlaylistFromLibraryInbox) {
      setError(t('inboxPage.error.desktopBridgePlaylist'));
      return;
    }

    setIsCreatingPlaylist(true);
    setMessage(null);
    setError(null);

    try {
      const result = await library.createPlaylistFromLibraryInbox({
        ...currentInboxQuery,
        name: t('inboxPage.playlist.name'),
      });
      setMessage(
        result.truncated
          ? t('inboxPage.message.playlistCreatedTruncated', {
              name: result.playlist.name,
              count: result.addedCount,
              limit: result.limit,
            })
          : t('inboxPage.message.playlistCreated', {
              name: result.playlist.name,
              count: result.addedCount,
            }),
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingPlaylist(false);
    }
  }, [currentInboxQuery, t]);

  const handleAddToQueue = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    const source = { type: 'manual' as const, label: t('inboxPage.source.label') };

    setIsAddingToQueue(true);
    setMessage(null);
    setError(null);

    try {
      if (selectedItemList.length > 0) {
        queue.appendTracksToQueue(selectedItemList.map((item) => item.track), source);
        setMessage(t('inboxPage.message.queueAdded', { count: selectedItemList.length }));
        return;
      }

      if (!library?.addLibraryInboxToQueue) {
        setError(t('inboxPage.error.desktopBridgeQueue'));
        return;
      }

      const result = await library.addLibraryInboxToQueue(currentInboxQuery);
      if (result.tracks.length === 0) {
        setError(t('inboxPage.error.noLocalTracks'));
        return;
      }

      queue.appendTracksToQueue(result.tracks, source);
      setMessage(
        result.truncated
          ? t('inboxPage.message.queueAddedTruncated', { count: result.addedCount, limit: result.limit })
          : t('inboxPage.message.queueAdded', { count: result.addedCount }),
      );
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : String(queueError));
    } finally {
      setIsAddingToQueue(false);
    }
  }, [currentInboxQuery, queue, selectedItemList, t]);

  const handleAddSmartCrateToQueue = useCallback(
    (crate: SmartCrate | undefined): void => {
      const queueTracks = crate?.tracks.map((track) => track.queueTrack).filter((track): track is LibraryTrack => Boolean(track)) ?? [];
      if (!crate || queueTracks.length === 0) {
        setError(t('inboxPage.smartCrates.queueEmpty'));
        return;
      }

      queue.appendTracksToQueue(queueTracks, { type: 'manual', label: t('inboxPage.smartCrates.queueSource') });
      setMessage(t('inboxPage.smartCrates.queueAdded', { title: crate.title, count: queueTracks.length }));
      setError(null);
    },
    [queue, t],
  );

  const handleUpdateState = useCallback(
    async (nextStatus: LibraryInboxItemStatus): Promise<void> => {
      const library = getLibraryBridge();
      if (!library?.updateLibraryInboxItemState) {
        setError(t('inboxPage.error.desktopBridgeState'));
        return;
      }

      setIsUpdatingState(true);
      setMessage(null);
      setError(null);

      try {
        const result = await library.updateLibraryInboxItemState({
          status: nextStatus,
          items: selectedItemList.length > 0
            ? selectedItemList.map((item) => ({ batchId: item.batchId, trackId: item.track.id }))
            : undefined,
          query: selectedItemList.length > 0 ? undefined : currentInboxQuery,
        });
        setSelectedItems({});
        await loadInbox(1, 'replace');
        setMessage(
          result.truncated
            ? t('inboxPage.message.stateUpdatedTruncated', {
                status: t(statusLabelKeys[nextStatus]),
                count: result.updatedCount,
                limit: result.limit,
              })
            : t('inboxPage.message.stateUpdated', {
                status: t(statusLabelKeys[nextStatus]),
                count: result.updatedCount,
              }),
        );
      } catch (stateError) {
        setError(stateError instanceof Error ? stateError.message : String(stateError));
      } finally {
        setIsUpdatingState(false);
      }
    },
    [currentInboxQuery, loadInbox, selectedItemList, t],
  );

  const handleOpenTrack = useCallback(async (trackId: string): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.openTrackInFolder) {
      setError(t('inboxPage.error.desktopBridgeLocate'));
      return;
    }

    try {
      await library.openTrackInFolder(trackId);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  }, [t]);

  const clearFilters = (): void => {
    setFilter('all');
    setStatus('all');
    setFolderId(null);
    setAlbum(null);
    setArtist(null);
    setSearchInput('');
    setSearch('');
    setMessage(null);
  };

  const selectAlbumSummary = (summary: LibraryInboxAlbumSummary): void => {
    setMessage(null);
    setAlbum(summary.album === 'Unknown Album' ? null : summary.album);
    setArtist(null);
  };

  const toggleSelectedItem = (item: LibraryInboxTrackItem): void => {
    const key = inboxItemKey(item);
    setSelectedItems((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: item };
    });
  };

  const toggleVisibleSelection = (): void => {
    setSelectedItems((current) => {
      if (allVisibleSelected) {
        const next = { ...current };
        items.forEach((item) => {
          delete next[inboxItemKey(item)];
        });
        return next;
      }

      const next = { ...current };
      items.forEach((item) => {
        next[inboxItemKey(item)] = item;
      });
      return next;
    });
  };

  const openSingleSelected = async (): Promise<void> => {
    const selectedItem = selectedItemList[0];
    if (selectedItemList.length !== 1 || !selectedItem) {
      return;
    }
    await handleOpenTrack(selectedItem.track.id);
  };

  return (
    <div className="inbox-page">
      <header className="inbox-hero">
        <div className="inbox-hero-copy">
          <span className="panel-kicker">{t('inboxPage.hero.kicker')}</span>
          <h1>{t('route.inbox.label')}</h1>
          <div className="inbox-hero-meta">
            <span>{selectedScopeLabel}</span>
            <span>{formatDateTime(selectedBatch?.finishedAt ?? pageData.batches[0]?.finishedAt, t('inboxPage.date.none'))}</span>
          </div>
        </div>
        <div className="inbox-stats" aria-label={t('inboxPage.stats.aria')}>
          <span>
            <strong>{pageData.total}</strong>
            <em>{t('inboxPage.stats.currentResults')}</em>
          </span>
          <span>
            <strong>{selectedBatch?.addedCount ?? pageData.batches.reduce((sum, batch) => sum + batch.addedCount, 0)}</strong>
            <em>{t('inboxPage.stats.newSongs')}</em>
          </span>
          <span>
            <strong>{selectedBatch?.missingCoverCount ?? pageData.batches.reduce((sum, batch) => sum + batch.missingCoverCount, 0)}</strong>
            <em>{t('inboxPage.filter.missingCover')}</em>
          </span>
        </div>
      </header>

      <section className="inbox-smart-crates" aria-label={t('inboxPage.smartCrates.aria')}>
        <div className="inbox-smart-crates-head">
          <div>
            <span className="panel-kicker">{t('inboxPage.smartCrates.kicker')}</span>
            <h2>{t('inboxPage.smartCrates.title')}</h2>
            <p>{t('inboxPage.smartCrates.subtitle')}</p>
          </div>
          <div className="inbox-smart-crates-controls">
            <label className="inbox-cover-intelligence-toggle">
              <span className="inbox-cover-intelligence-copy">
                <Sparkles size={16} />
                <span>
                  <strong>{t('inboxPage.coverIntelligence.toggle')}</strong>
                  <em>
                    {coverIntelligenceEnabled
                      ? t('inboxPage.coverIntelligence.statusEnabled')
                      : t('inboxPage.coverIntelligence.statusDisabled')}
                  </em>
                </span>
              </span>
              <input
                aria-label={t('inboxPage.coverIntelligence.toggle')}
                checked={coverIntelligenceEnabled}
                onChange={(event) => handleCoverIntelligenceToggle(event.currentTarget.checked)}
                type="checkbox"
              />
              <span className="inbox-cover-intelligence-switch" />
            </label>
            <button
              className="inbox-icon-button"
              disabled={isLoadingSmartCrates}
              onClick={() => void loadSmartCrates()}
              title={t('home.recommend.refresh')}
              type="button"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>

        <div className="inbox-crate-layout">
          <article className="inbox-crate-feature" data-tone={selectedSmartCrate?.tone ?? 'violet'}>
            <div className="inbox-crate-feature-header">
              <span className="inbox-crate-feature-icon">
                <SelectedSmartCrateIcon size={24} />
              </span>
              <div>
                <span className="panel-kicker">{selectedSmartCrate?.kicker ?? t('inboxPage.smartCrates.kicker')}</span>
                <h3>{selectedSmartCrate?.title ?? t('inboxPage.smartCrates.title')}</h3>
                <p>{selectedSmartCrate?.description ?? t('inboxPage.smartCrates.subtitle')}</p>
              </div>
              <strong>{isLoadingSmartCrates ? t('inboxPage.smartCrates.loading') : selectedSmartCrate?.metric}</strong>
            </div>

            {selectedSmartCrate && selectedSmartCrate.tracks.length > 0 ? (
              <div className="inbox-crate-preview-list">
                {selectedSmartCrate.tracks.map((track) => (
                  <div className="inbox-crate-preview-track" key={`${selectedSmartCrate.id}:${track.id}`}>
                    <span className="inbox-crate-cover" data-empty={!track.coverThumb ? 'true' : undefined}>
                      {track.coverThumb ? <img alt="" loading="lazy" src={track.coverThumb} /> : <Disc3 size={18} />}
                    </span>
                    <span className="inbox-crate-preview-copy">
                      <strong>{track.title}</strong>
                      <em>{track.artist}</em>
                    </span>
                    <small>{track.detail}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inbox-crate-empty">
                <Sparkles size={18} />
                <span>{selectedSmartCrate?.emptyText ?? t('inboxPage.smartCrates.previewEmpty')}</span>
              </div>
            )}

            <div className="inbox-crate-actions">
              <button
                className="inbox-command-button"
                disabled={selectedCrateQueueTracks.length === 0}
                onClick={() => handleAddSmartCrateToQueue(selectedSmartCrate)}
                type="button"
              >
                <ListMusic size={17} />
                <span>{t('inboxPage.smartCrates.queueSelected')}</span>
              </button>
              <span>{t('inboxPage.smartCrates.queueable', { count: selectedCrateQueueTracks.length })}</span>
            </div>
          </article>

          <div className="inbox-crate-rail">
            {smartCrates.map((crate) => {
              const CrateIcon = smartCrateIconMap[crate.id];
              const queueableCount = crate.tracks.filter((track) => track.queueTrack).length;
              return (
                <button
                  className="inbox-crate-card"
                  data-active={selectedSmartCrate?.id === crate.id ? 'true' : undefined}
                  data-tone={crate.tone}
                  key={crate.id}
                  onClick={() => setSelectedCrateId(crate.id)}
                  type="button"
                >
                  <span className="inbox-crate-card-icon">
                    <CrateIcon size={18} />
                  </span>
                  <span className="inbox-crate-card-copy">
                    <strong>{crate.title}</strong>
                    <em>{crate.metric}</em>
                  </span>
                  <small>{t('inboxPage.smartCrates.queueableShort', { count: queueableCount })}</small>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="inbox-workbench" aria-label={t('inboxPage.workbench.aria')}>
        <div className="inbox-workbench-head">
          <div>
            <span className="panel-kicker">{t('inboxPage.workbench.kicker')}</span>
            <h2>{t('inboxPage.workbench.title')}</h2>
          </div>
          <p>{t('inboxPage.workbench.description')}</p>
        </div>

      <section className="inbox-story-panel" aria-label={t('inboxPage.story.aria')}>
        <div className="inbox-story-copy">
          <span className="panel-kicker">{t('inboxPage.story.kicker')}</span>
          <strong>{storyLine}</strong>
          <div className="inbox-story-tags">
            {story.topFolders.slice(0, 3).map((folder) => (
              <button key={folder.value} onClick={() => setFolderId(folder.value)} type="button">
                {folder.label} · {folder.count}
              </button>
            ))}
            {story.topArtists.slice(0, 3).map((artistFacet) => (
              <button key={artistFacet.value} onClick={() => setArtist(artistFacet.value)} type="button">
                {artistFacet.label} · {artistFacet.count}
              </button>
            ))}
          </div>
        </div>
        <div className="inbox-story-numbers">
          <span>
            <strong>{story.albumCount}</strong>
            <em>{t('inboxPage.story.newAlbums')}</em>
          </span>
          <span>
            <strong>{story.artistCount}</strong>
            <em>{t('inboxPage.story.newArtists')}</em>
          </span>
          <span>
            <strong>{formatDurationHours(story.totalDuration)}</strong>
            <em>{t('inboxPage.story.totalDuration')}</em>
          </span>
        </div>
      </section>

      <section className="inbox-processing-panel" aria-label={t('inboxPage.processing.aria')}>
        <div className="inbox-processing-cards">
          <button
            className="inbox-processing-card"
            data-active={status === 'pending' ? 'true' : undefined}
            onClick={() => {
              setFilter('all');
              setStatus('pending');
            }}
            type="button"
          >
            <Clock3 size={18} />
            <span>
              <strong>{story.pendingCount}</strong>
              <em>{t('inboxPage.processing.pending')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'missing_cover' ? 'true' : undefined}
            onClick={() => setFilter('missing_cover')}
            type="button"
          >
            <Disc3 size={18} />
            <span>
              <strong>{story.missingCoverCount}</strong>
              <em>{t('inboxPage.filter.missingCover')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'metadata_issue' ? 'true' : undefined}
            onClick={() => setFilter('metadata_issue')}
            type="button"
          >
            <CheckCircle2 size={18} />
            <span>
              <strong>{story.metadataIssueCount}</strong>
              <em>{t('inboxPage.filter.metadataIssue')}</em>
            </span>
          </button>
          <button
            className="inbox-processing-card"
            data-active={filter === 'suspicious_file' ? 'true' : undefined}
            onClick={() => setFilter('suspicious_file')}
            type="button"
          >
            <AlertTriangle size={18} />
            <span>
              <strong>{story.suspiciousCount}</strong>
              <em>{t('inboxPage.filter.suspiciousFile')}</em>
            </span>
          </button>
        </div>
        <div className="inbox-quality-summary" aria-label={t('inboxPage.quality.aria')}>
          <span>
            <strong>{formatPercent(story.coverCompleteness)}</strong>
            <em>{t('inboxPage.quality.coverCompleteness')}</em>
          </span>
          <span>
            <strong>{formatPercent(story.metadataCompleteness)}</strong>
            <em>{t('inboxPage.quality.metadataCompleteness')}</em>
          </span>
          <span>
            <strong>{story.unknownArtistCount + story.unknownAlbumCount}</strong>
            <em>{t('inboxPage.quality.unknownArtistAlbum')}</em>
          </span>
          <span>
            <strong>{story.processedCount}</strong>
            <em>{t('inboxPage.status.processed')}</em>
          </span>
        </div>
      </section>

      <section className="inbox-toolbar" aria-label={t('inboxPage.toolbar.aria')}>
        <label className="inbox-select-field">
          <span>{t('inboxPage.toolbar.batch')}</span>
          <select value={batchSelectValue(scope, batchId)} onChange={(event) => handleSelectBatch(event.target.value)}>
            <option value="__latest__">{t('inboxPage.batch.latest')}</option>
            <option value="__all__">{t('inboxPage.batch.recentAll')}</option>
            {pageData.batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.folderName} · {batch.addedCount}
              </option>
            ))}
          </select>
        </label>

        <label className="inbox-search-field">
          <Search size={16} />
          <input
            aria-label={t('inboxPage.search.aria')}
            placeholder={t('inboxPage.search.placeholder')}
            type="search"
            {...searchInputProps}
          />
        </label>

        <button className="inbox-icon-button" disabled={isLoading} onClick={() => void loadInbox(1, 'replace')} title={t('home.recommend.refresh')} type="button">
          <RefreshCw size={17} />
        </button>
        <button
          className="inbox-command-button"
          disabled={isCreatingPlaylist || pageData.total === 0}
          onClick={() => void handleCreatePlaylist()}
          type="button"
        >
          <ListPlus size={17} />
          <span>{t('inboxPage.action.generatePlaylist')}</span>
        </button>
        <button
          className="inbox-command-button"
          disabled={isAddingToQueue || pageData.total === 0}
          onClick={() => void handleAddToQueue()}
          type="button"
        >
          <ListMusic size={17} />
          <span>{t('inboxPage.action.addToQueue')}</span>
        </button>
      </section>

      <section className="inbox-filter-row" aria-label={t('inboxPage.filter.aria')}>
        {localizedFilterOptions.map((option) => (
          <button
            className="list-filter-chip"
            data-active={filter === option.value ? 'true' : undefined}
            key={option.value}
            onClick={() => {
              setMessage(null);
              setFilter(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
        {hasFilters ? (
          <button className="list-filter-chip" onClick={clearFilters} type="button">
            {t('inboxPage.filter.clear')}
          </button>
        ) : null}
      </section>

      <section className="inbox-filter-row" aria-label={t('inboxPage.status.aria')}>
        {localizedStatusOptions.map((option) => (
          <button
            className="list-filter-chip"
            data-active={status === option.value ? 'true' : undefined}
            key={option.value}
            onClick={() => {
              setMessage(null);
              setStatus(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </section>

      <section className="inbox-facet-row" aria-label={t('inboxPage.facets.aria')}>
        <label>
          <Folder size={15} />
          <select value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allFolders')}</option>
            {pageData.facets.folders.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Disc3 size={15} />
          <select value={album ?? ''} onChange={(event) => setAlbum(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allAlbums')}</option>
            {pageData.facets.albums.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <UserRound size={15} />
          <select value={artist ?? ''} onChange={(event) => setArtist(event.target.value || null)}>
            <option value="">{t('inboxPage.facets.allArtists')}</option>
            {pageData.facets.artists.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {facet.label} · {facet.count}
              </option>
            ))}
          </select>
        </label>
      </section>
      </section>

      {albumSummaries.length > 0 ? (
        <section className="inbox-album-wall" aria-label={t('inboxPage.albumWall.aria')}>
          <div className="inbox-section-heading">
            <span className="panel-kicker">New Albums</span>
            <strong>{t('inboxPage.albumWall.title')}</strong>
          </div>
          <div className="inbox-album-grid">
            {albumSummaries.map((summary) => (
              <button
                className="inbox-album-card"
                key={albumKey(summary)}
                onClick={() => selectAlbumSummary(summary)}
                type="button"
              >
                <span className="inbox-album-art" data-empty={!summary.coverThumb ? 'true' : undefined}>
                  {summary.coverThumb ? <img alt="" loading="lazy" src={summary.coverThumb} /> : <Disc3 size={24} />}
                </span>
                <span className="inbox-album-copy">
                  <strong>{summary.album}</strong>
                  <em>{summary.albumArtist}</em>
                  <small>
                    {t('inboxPage.albumWall.trackCount', {
                      count: summary.trackCount,
                      duration: formatDurationHours(summary.duration),
                    })}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {message ? <div className="inbox-notice">{message}</div> : null}
      {error ? (
        <div className="inbox-notice inbox-notice--error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section className="inbox-bulk-bar" aria-label={t('inboxPage.bulk.aria')}>
          <button className="inbox-selection-toggle" onClick={toggleVisibleSelection} type="button">
            {allVisibleSelected ? t('inboxPage.bulk.deselectPage') : t('inboxPage.bulk.selectPage')}
          </button>
          <span>
            {selectedCount > 0
              ? t('inboxPage.bulk.selectedCount', { count: selectedCount })
              : t('inboxPage.bulk.filterCount', { count: pageData.total })}
          </span>
          <button className="inbox-command-button" disabled={isAddingToQueue} onClick={() => void handleAddToQueue()} type="button">
            <ListMusic size={16} />
            <span>{t('inboxPage.action.addToQueue')}</span>
          </button>
          <button className="inbox-command-button" disabled={selectedCount !== 1} onClick={() => void openSingleSelected()} type="button">
            <FolderOpen size={16} />
            <span>{t('inboxPage.action.locateFile')}</span>
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('processed')} type="button">
            {t('inboxPage.action.markProcessed')}
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('ignored')} type="button">
            {t('inboxPage.action.ignore')}
          </button>
          <button className="inbox-command-button" disabled={isUpdatingState} onClick={() => void handleUpdateState('pending')} type="button">
            {t('inboxPage.action.setPending')}
          </button>
        </section>
      ) : null}

      <section className="inbox-list" aria-label={t('inboxPage.list.aria')} data-loading={isLoading ? 'true' : undefined}>
        {items.length === 0 ? (
          <div className="inbox-empty-state">
            <strong>{isLoading ? t('inboxPage.loading') : pageData.batches.length === 0 ? t('inboxPage.empty.title') : t('inboxPage.empty.noMatch')}</strong>
            <span>{pageData.batches.length === 0 ? t('inboxPage.empty.description') : t('inboxPage.empty.tryFilter')}</span>
          </div>
        ) : (
          items.map((item) => (
            <article className="inbox-track-row" key={`${item.batchId}:${item.track.id}`}>
              <label className="inbox-row-check">
                <input
                  checked={Boolean(selectedItems[inboxItemKey(item)])}
                  onChange={() => toggleSelectedItem(item)}
                  type="checkbox"
                />
                <span />
              </label>
              <div className="inbox-track-cover" data-empty={!item.track.coverThumb ? 'true' : undefined}>
                {item.track.coverThumb ? <img alt="" loading="lazy" src={item.track.coverThumb} /> : <Disc3 size={20} />}
              </div>
              <div className="inbox-track-main">
                <div className="inbox-track-title">
                  <strong>{item.track.title}</strong>
                  <span>{formatDateTime(item.addedAt, t('inboxPage.date.none'))}</span>
                </div>
                <div className="inbox-track-meta">
                  <span>{item.track.artist || t('inboxPage.reason.unknown_artist')}</span>
                  <span>{item.track.album || t('inboxPage.reason.unknown_album')}</span>
                </div>
                <div className="inbox-track-path">{readTrackPath(item)}</div>
                <div className="inbox-reason-row">
                  <span data-status={item.inboxStatus}>{t(statusLabelKeys[item.inboxStatus])}</span>
                  {item.reasons.slice(0, 4).map((reason) => (
                    <span key={reason}>{t(reasonLabelKeys[reason] ?? 'inboxPage.reason.unknown_field')}</span>
                  ))}
                </div>
                {item.reasons.length > 4 ? (
                  <div className="inbox-reason-row">
                    <span>{t('inboxPage.list.moreReasons', { count: item.reasons.length - 4 })}</span>
                  </div>
                ) : null}
              </div>
              <button className="inbox-icon-button" onClick={() => void handleOpenTrack(item.track.id)} title={t('inboxPage.action.locateTrack')} type="button">
                <FolderOpen size={17} />
              </button>
            </article>
          ))
        )}
      </section>

      {pageData.hasMore ? (
        <button className="inbox-load-more" disabled={isLoading} onClick={() => void loadInbox(pageData.page + 1, 'append')} type="button">
          {isLoading
            ? t('inboxPage.loadingShort')
            : t('inboxPage.loadMore', { visible: visibleCount, total: pageData.total })}
        </button>
      ) : null}
    </div>
  );
};
