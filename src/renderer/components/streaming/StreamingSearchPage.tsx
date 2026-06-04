import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Check, ChevronDown, Disc3, Download, Heart, Link, ListPlus, Loader2, Play, Radio, Search, UserRound } from 'lucide-react';
import type { AppSettings } from '../../../shared/types/appSettings';
import type { DownloadJob, DownloadJobStatus } from '../../../shared/types/downloads';
import type { LibraryTrack } from '../../../shared/types/library';
import type {
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingAudioQuality,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingFavoritesSnapshot,
  StreamingMediaType,
  StreamingPlaylist,
  StreamingProviderDescriptor,
  StreamingProviderName,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import { useAnimatedBackNavigation } from '../../hooks/useAnimatedBackNavigation';
import { useProgressiveRenderLimit } from '../../hooks/useProgressiveRenderLimit';
import { translateCurrentLocale, useI18n } from '../../i18n/I18nProvider';
import { isPlaybackCancellationError, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { getAccountsBridge, getAppBridge, getDownloadsBridge, getStreamingBridge } from '../../utils/echoBridge';
import { useImeAwareDebouncedSearch } from '../../utils/imeInput';
import {
  readStreamingSearchMemory,
  updateStreamingSearchMemory,
  type StreamingQualityPreference,
} from './streamingSearchMemory';

const pageSize = 30;
const streamingAlbumInitialTrackRenderCount = 24;
const streamingAlbumTrackRenderStep = 48;
const streamingAlbumTrackRenderDelayMs = 80;
const tabs: Array<{ key: StreamingMediaType; labelKey: Parameters<typeof translateCurrentLocale>[0] }> = [
  { key: 'track', labelKey: 'streaming.tab.track' },
  { key: 'album', labelKey: 'streaming.tab.album' },
  { key: 'artist', labelKey: 'streaming.tab.artist' },
  { key: 'playlist', labelKey: 'streaming.tab.playlist' },
];
type QualityPreference = StreamingQualityPreference;
type AlbumDownloadState = {
  albumId: string;
  title: string;
  total: number;
  queued: number;
  failedToQueue: number;
  jobIds: string[];
};

const qualities: Array<{ key: QualityPreference; labelKey: Parameters<typeof translateCurrentLocale>[0]; descriptionKey: Parameters<typeof translateCurrentLocale>[0] }> = [
  { key: 'lossless', labelKey: 'streaming.quality.lossless', descriptionKey: 'streaming.quality.losslessDescription' },
  { key: 'high', labelKey: 'streaming.quality.high', descriptionKey: 'streaming.quality.highDescription' },
  { key: 'standard', labelKey: 'streaming.quality.standard', descriptionKey: 'streaming.quality.standardDescription' },
  { key: 'hires', labelKey: 'streaming.quality.hires', descriptionKey: 'streaming.quality.hiresDescription' },
];

const defaultCover = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="#eaf1f8"/><circle cx="31" cy="32" r="12" fill="#9fb6cc"/><path d="M28 67c11-19 25-25 42-9" fill="none" stroke="#5f7f9d" stroke-width="8" stroke-linecap="round"/></svg>',
)}`;

const hiddenProviderTabs = new Set<StreamingProviderName>(['mock', 'm3u8', 'kugou']);
const providerPriority: StreamingProviderName[] = ['netease', 'qqmusic', 'plugin', 'soundcloud', 'youtube', 'tidal', 'spotify', 'bilibili'];
const unsupportedDownloadProviders = new Set<StreamingProviderName>(['spotify', 'tidal', 'bilibili', 'youtube', 'plugin']);
const favoriteProviders = new Set<StreamingProviderName>(['bilibili', 'youtube', 'soundcloud']);
const qualitySwitchPlaybackStates = new Set(['loading', 'playing']);
const providerCacheTtlMs = 30_000;
const albumDownloadQueueYieldMs = 90;
const emptyTracks: StreamingTrack[] = [];
const emptyAlbums: StreamingAlbum[] = [];
const emptyArtists: StreamingArtist[] = [];
const emptyPlaylists: StreamingPlaylist[] = [];

let cachedProviders: { items: StreamingProviderDescriptor[]; expiresAtMs: number } | null = null;

const streamingSearchResultKey = (provider: StreamingProviderName, query: string, activeTab: StreamingMediaType): string =>
  `${provider}:${activeTab}:${query.trim().toLocaleLowerCase()}`;

const favoriteKey = (provider: StreamingProviderName, providerTrackId: string): string => `${provider}:${providerTrackId}`;

const favoriteIdsFromSnapshot = (snapshot: StreamingFavoritesSnapshot | null | undefined): Record<string, boolean> => {
  const ids: Record<string, boolean> = {};
  if (!snapshot) {
    return ids;
  }

  for (const items of Object.values(snapshot.providers)) {
    for (const item of items) {
      ids[favoriteKey(item.provider, item.providerTrackId)] = true;
    }
  }
  for (const collection of snapshot.collections ?? []) {
    for (const item of collection.tracks) {
      ids[favoriteKey(item.provider, item.providerTrackId)] = true;
    }
  }
  return ids;
};

const readCachedProviders = (): StreamingProviderDescriptor[] | null => {
  if (!cachedProviders || cachedProviders.expiresAtMs <= Date.now()) {
    cachedProviders = null;
    return null;
  }

  return cachedProviders.items;
};

const writeCachedProviders = (items: StreamingProviderDescriptor[]): StreamingProviderDescriptor[] => {
  cachedProviders = { items, expiresAtMs: Date.now() + providerCacheTtlMs };
  return items;
};

const readStreamingDownloadActionsEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.downloadsFeatureUnlocked === true;

const formatDuration = (duration: number | null): string => {
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const statusText = (provider: StreamingProviderDescriptor): string => {
  if (!provider.enabled) {
    return translateCurrentLocale('streaming.provider.disabled');
  }
  if (provider.requiresAccount && !provider.accountConnected) {
    return translateCurrentLocale('streaming.provider.notLoggedIn');
  }
  return provider.accountDisplayName
    ? translateCurrentLocale('streaming.provider.loggedIn', { name: provider.accountDisplayName })
    : translateCurrentLocale('streaming.provider.available');
};

const qualityToPlaybackQuality = (quality: QualityPreference): StreamingAudioQuality => quality;

const activeDownloadStatuses = new Set<DownloadJobStatus>([
  'queued',
  'probing',
  'downloading',
  'extracting_audio',
  'importing',
  'binding_mv',
]);

const sleep = (delayMs: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, delayMs));

const showChromeNotice = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: message }));
};

const downloadStatusLabels: Record<DownloadJobStatus, string> = {
  queued: '排队中',
  probing: '解析链接',
  downloading: '下载中',
  extracting_audio: '提取音频',
  importing: '导入曲库',
  binding_mv: '绑定 MV',
  completed: '下载成功',
  failed: '下载失败',
  cancelled: '已取消',
};

const streamingTrackWebUrl = (track: StreamingTrack): string | null => {
  switch (track.provider) {
    case 'netease':
      return `https://music.163.com/#/song?id=${encodeURIComponent(track.providerTrackId)}`;
    case 'qqmusic':
      return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(track.providerTrackId)}`;
    case 'kugou':
      return `https://www.kugou.com/song/#hash=${encodeURIComponent(track.providerTrackId.split('.')[0] ?? track.providerTrackId)}`;
    case 'spotify':
      return `https://open.spotify.com/track/${encodeURIComponent(track.providerTrackId)}`;
    case 'tidal':
      return `https://tidal.com/track/${encodeURIComponent(track.providerTrackId)}`;
    case 'soundcloud':
      return track.providerTrackId.startsWith('http')
        ? track.providerTrackId
        : `https://soundcloud.com/search/sounds?q=${encodeURIComponent(track.title ? `${track.artist} ${track.title}` : track.providerTrackId)}`;
    case 'bilibili':
      return `https://www.bilibili.com/video/${encodeURIComponent(track.providerTrackId)}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${encodeURIComponent(track.providerTrackId)}`;
    default:
      return null;
  }
};

const streamingPlaylistWebUrl = (playlist: StreamingPlaylist): string | null => {
  switch (playlist.provider) {
    case 'netease':
      return `https://music.163.com/#/playlist?id=${encodeURIComponent(playlist.providerPlaylistId)}`;
    case 'qqmusic':
      return `https://y.qq.com/n/ryqq/playlist/${encodeURIComponent(playlist.providerPlaylistId)}`;
    case 'kugou':
      return `https://www.kugou.com/yy/special/single/${encodeURIComponent(playlist.providerPlaylistId)}.html`;
    case 'spotify':
      return `https://open.spotify.com/playlist/${encodeURIComponent(playlist.providerPlaylistId)}`;
    case 'tidal':
      return `https://tidal.com/playlist/${encodeURIComponent(playlist.providerPlaylistId)}`;
    case 'soundcloud':
      return playlist.providerPlaylistId.startsWith('http')
        ? playlist.providerPlaylistId
        : `https://soundcloud.com/search/sets?q=${encodeURIComponent(playlist.title)}`;
    default:
      return null;
  }
};

const formatAlbumDuration = (tracks: StreamingTrack[]): string | null => {
  const totalSeconds = tracks.reduce((total, track) => total + (track.duration ?? 0), 0);
  if (totalSeconds <= 0) {
    return null;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} hr ${minutes} min` : `${totalMinutes} min`;
};

const formatTrackCount = (count: number | null): string => `${count ?? 0} ${(count ?? 0) === 1 ? 'track' : 'tracks'}`;

const safeStreamingArtistName = (artist: Pick<StreamingArtist, 'name' | 'providerArtistId'>): string => {
  const name = typeof artist.name === 'string' ? artist.name.trim() : '';
  const fallback = typeof artist.providerArtistId === 'string' ? artist.providerArtistId.trim() : '';
  return name || fallback || 'Unknown Artist';
};

const isUsefulStreamingArtistName = (value: string | null | undefined, providerArtistId: string): value is string => {
  const candidate = value?.trim();
  if (!candidate || candidate === 'Unknown Artist') {
    return false;
  }

  return candidate.normalize('NFKC').toLocaleLowerCase() !== providerArtistId.trim().normalize('NFKC').toLocaleLowerCase();
};

const safeStreamingArtistDetailName = (artist: StreamingArtist | StreamingArtistDetail): string => {
  const providerArtistId = typeof artist.providerArtistId === 'string' ? artist.providerArtistId.trim() : '';
  if (isUsefulStreamingArtistName(artist.name, providerArtistId)) {
    return artist.name.trim();
  }

  const detail = artist as Partial<StreamingArtistDetail>;
  const topTracks = Array.isArray(detail.topTracks) ? detail.topTracks : [];
  const albums = Array.isArray(detail.albums) ? detail.albums : [];
  const matchingTrackArtist = topTracks
    .flatMap((track) => streamingTrackArtists(track))
    .find((trackArtist) => trackArtist.providerArtistId === providerArtistId);
  const candidates = [
    matchingTrackArtist?.name,
    ...albums.map((album) => album.artist),
    ...topTracks.flatMap((track) => streamingTrackArtists(track).map((trackArtist) => trackArtist.name)),
    ...topTracks.map((track) => track.artist),
  ];
  const inferredName = candidates.find((candidate): candidate is string => isUsefulStreamingArtistName(candidate, providerArtistId));
  return inferredName ?? safeStreamingArtistName(artist);
};

const streamingArtistInitial = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

const streamingTrackArtists = (track: StreamingTrack): StreamingTrack['artists'] =>
  Array.isArray(track.artists) ? track.artists : [];

const streamingTrackToLibraryTrack = (track: StreamingTrack, quality: QualityPreference): LibraryTrack => ({
  id: track.stableKey || streamingStableKey(track.provider, track.providerTrackId),
  mediaType: 'streaming',
  path: track.stableKey,
  provider: track.provider,
  providerTrackId: track.providerTrackId,
  streamingQuality: qualityToPlaybackQuality(quality),
  stableKey: track.stableKey,
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.albumArtist ?? track.artist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: track.duration ?? 0,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: track.coverThumb ?? defaultCover,
  fieldSources: {
    title: track.provider,
    artist: track.provider,
    album: track.provider,
  },
  unavailable: !track.playable,
});

export const StreamingSearchPage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const initialMemory = readStreamingSearchMemory();
  const initialProvider = hiddenProviderTabs.has(initialMemory.provider) ? 'netease' : initialMemory.provider;
  const initialResult = initialMemory.result && !hiddenProviderTabs.has(initialMemory.result.provider) ? initialMemory.result : null;
  const [providers, setProviders] = useState<StreamingProviderDescriptor[]>(() => readCachedProviders() ?? []);
  const [provider, setProvider] = useState<StreamingProviderName>(initialProvider);
  const [quality, setQuality] = useState<QualityPreference>(initialMemory.quality);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [streamingDownloadActionsEnabled, setStreamingDownloadActionsEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<StreamingMediaType>(initialMemory.activeTab);
  const {
    searchInput: input,
    search: query,
    searchInputProps,
  } = useImeAwareDebouncedSearch(300, initialMemory.input || initialMemory.query);
  const [result, setResult] = useState<StreamingSearchResult | null>(initialResult);
  const [selectedAlbum, setSelectedAlbum] = useState<StreamingAlbum | null>(null);
  const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<StreamingAlbumDetail | null>(null);
  const [isAlbumDetailLoading, setIsAlbumDetailLoading] = useState(false);
  const [albumDetailError, setAlbumDetailError] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<StreamingArtist | null>(null);
  const [selectedArtistDetail, setSelectedArtistDetail] = useState<StreamingArtistDetail | null>(null);
  const [isArtistDetailLoading, setIsArtistDetailLoading] = useState(false);
  const [artistDetailError, setArtistDetailError] = useState<string | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);
  const [importingPlaylistKey, setImportingPlaylistKey] = useState<string | null>(null);
  const [resolvingTrackKey, setResolvingTrackKey] = useState<string | null>(null);
  const [queuedTrackKey, setQueuedTrackKey] = useState<string | null>(null);
  const [downloadingTrackKey, setDownloadingTrackKey] = useState<string | null>(null);
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [downloadJobIdsByTrackKey, setDownloadJobIdsByTrackKey] = useState<Record<string, string>>({});
  const [albumDownload, setAlbumDownload] = useState<AlbumDownloadState | null>(null);
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Record<string, boolean>>({});
  const [favoriteTrackKey, setFavoriteTrackKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, string>>(initialMemory.failedCoverUrls);
  const { isReturning: isAlbumReturning, returnBack: returnFromAlbum } = useAnimatedBackNavigation(() => setSelectedAlbum(null), Boolean(selectedAlbum));
  const { isReturning: isArtistReturning, returnBack: returnFromArtist } = useAnimatedBackNavigation(() => setSelectedArtist(null), Boolean(selectedArtist) && !selectedAlbum);
  const requestIdRef = useRef(0);
  const playActionIdRef = useRef(0);
  const resultRef = useRef<StreamingSearchResult | null>(initialResult);
  const listRef = useRef<HTMLDivElement | null>(null);
  const notifiedDownloadJobIdsRef = useRef<Set<string>>(new Set());
  const albumDownloadRunIdRef = useRef(0);
  const lastAlbumDownloadNoticeRef = useRef<string | null>(null);
  const restoredResultKeyRef = useRef<string | null>(
    initialResult && initialResult.provider === initialProvider && initialResult.query.trim() === initialMemory.query.trim()
      ? streamingSearchResultKey(initialProvider, initialMemory.query, initialMemory.activeTab)
      : null,
  );

  const providerOptions = useMemo(
    () => {
      const visibleProviders = providers.filter((item) => !hiddenProviderTabs.has(item.name));
      return visibleProviders.length > 0
        ? visibleProviders
        : [{
            name: 'netease' as const,
            displayName: 'NetEase Cloud Music',
            enabled: true,
            supportsSearch: true,
            supportsLyrics: true,
            supportsMv: true,
            requiresAccount: false,
          }];
    },
    [providers],
  );
  const currentProvider = providerOptions.find((item) => item.name === provider) ?? providerOptions[0];
  const currentQuality = qualities.find((item) => item.key === quality) ?? qualities[0];
  const source = useMemo(() => ({ type: 'streaming' as const, label: `Streaming / ${currentProvider?.displayName ?? provider}`, provider }), [currentProvider?.displayName, provider]);
  const tracks = result?.tracks ?? emptyTracks;
  const albums = result?.albums ?? emptyAlbums;
  const artists = result?.artists ?? emptyArtists;
  const playlists = result?.playlists ?? emptyPlaylists;
  const visibleKnownTracks = useMemo(() => [...tracks, ...(selectedAlbumDetail?.tracks ?? emptyTracks)], [selectedAlbumDetail?.tracks, tracks]);
  const resultCount = activeTab === 'album' ? albums.length : activeTab === 'artist' ? artists.length : activeTab === 'playlist' ? playlists.length : tracks.length;
  const activeTabLabel = t(tabs.find((tab) => tab.key === activeTab)?.labelKey ?? 'streaming.tab.track');
  const resultSummary = query
    ? isLoading && resultCount === 0
      ? t('streaming.result.searching')
      : t('streaming.result.count', { count: resultCount })
    : t('streaming.hero.preparingSearch');
  const searchStateMessage =
    isLoading && resultCount === 0
      ? t('streaming.result.searchingEllipsis')
      : !isLoading && query && resultCount === 0 && !error
        ? t(
            activeTab === 'album'
              ? 'streaming.empty.notFoundAlbum'
              : activeTab === 'artist'
                ? 'streaming.empty.notFoundArtist'
                : activeTab === 'playlist'
                  ? 'streaming.empty.notFoundPlaylist'
                  : 'streaming.empty.notFoundTrack',
          )
        : !query && activeTab !== 'playlist'
          ? t('streaming.empty.searchHint')
          : null;
  const currentStableKey = queue.currentTrack?.mediaType === 'streaming' ? queue.currentTrack.stableKey ?? queue.currentTrack.id : null;
  const selectedAlbumTrackRenderLimit = useProgressiveRenderLimit({
    identityKey: selectedAlbumDetail?.id ?? selectedAlbum?.id ?? null,
    itemCount: selectedAlbumDetail?.tracks.length ?? 0,
    initialCount: streamingAlbumInitialTrackRenderCount,
    step: streamingAlbumTrackRenderStep,
    delayMs: streamingAlbumTrackRenderDelayMs,
  });
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 86,
    overscan: 8,
  });

  useEffect(() => {
    if (activeTab === 'mv') {
      setActiveTab('track');
    }
  }, [activeTab]);

  useEffect(() => {
    if (provider === 'plugin' && activeTab !== 'track') {
      setActiveTab('track');
    }
  }, [activeTab, provider]);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    updateStreamingSearchMemory({
      provider,
      quality,
      activeTab,
      input,
      query,
      resultKey: result ? streamingSearchResultKey(provider, query, activeTab) : null,
      result,
      failedCoverUrls,
    });
  }, [activeTab, failedCoverUrls, input, provider, quality, query, result]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return undefined;
    }

    const memory = readStreamingSearchMemory();
    if (memory.scrollTop > 0) {
      element.scrollTop = memory.scrollTop;
    }

    const handleScroll = (): void => {
      updateStreamingSearchMemory({ scrollTop: element.scrollTop });
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, [tracks.length]);

  useEffect(() => {
    const app = getAppBridge();
    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (
        !settings ||
        (
          !Object.prototype.hasOwnProperty.call(settings, 'downloadsFeatureUnlocked') &&
          !Object.prototype.hasOwnProperty.call(settings, 'streamingDownloadActionsEnabled')
        )
      ) {
        return;
      }

      setStreamingDownloadActionsEnabled(readStreamingDownloadActionsEnabled(settings));
    };

    void app?.getSettings?.().then(applySettings).catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
        applySettings(event.detail as Partial<AppSettings>);
        return;
      }

      void app?.getSettings?.().then(applySettings).catch(() => undefined);
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, []);

  useEffect(() => {
    const streaming = getStreamingBridge();
    if (!streaming?.getProviders) {
      return undefined;
    }

    let disposed = false;
    const applyProviders = (items: StreamingProviderDescriptor[]): void => {
      if (disposed) {
        return;
      }

      setProviders(items);
      const visibleItems = items.filter((item) => !hiddenProviderTabs.has(item.name));
      setProvider((current) => {
        const currentEnabled = visibleItems.some((item) => item.name === current && item.enabled);
        return currentEnabled
          ? current
          : providerPriority.find((name) => visibleItems.some((item) => item.name === name && item.enabled)) ?? visibleItems.find((item) => item.enabled)?.name ?? 'netease';
      });
    };
    const loadProviders = (forceRefresh = false): void => {
      const cached = forceRefresh ? null : readCachedProviders();
      if (cached) {
        applyProviders(cached);
        return;
      }

      void streaming
        .getProviders()
        .then((items) => applyProviders(writeCachedProviders(items)))
        .catch(() => undefined);
    };

    loadProviders();
    const unsubscribe = getAccountsBridge()?.onStatusesChanged?.(() => loadProviders(true));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const runSearch = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
      const streaming = getStreamingBridge();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setActionError(null);
      setActionMessage(null);
      if (!streaming) {
        setResult(null);
        setError('桌面桥接不可用，请在 ECHO Next 客户端中使用流媒体。');
        return;
      }

      if (!query) {
        setResult(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      const nextResultKey = streamingSearchResultKey(provider, query, activeTab);
      const canRefreshSilently =
        mode === 'replace' &&
        nextPage === 1 &&
        Boolean(resultRef.current) &&
        readStreamingSearchMemory().resultKey === nextResultKey;

      if (!canRefreshSilently) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const nextResult = await streaming.search({
          provider,
          query,
          mediaTypes: [activeTab],
          page: nextPage,
          pageSize,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setResult((current) =>
          mode === 'append' && current
            ? {
                ...nextResult,
                tracks: [...current.tracks, ...nextResult.tracks],
                albums: [...current.albums, ...nextResult.albums],
                artists: [...current.artists, ...nextResult.artists],
                playlists: [...current.playlists, ...nextResult.playlists],
                mvs: [...current.mvs, ...nextResult.mvs],
              }
            : nextResult,
        );
      } catch (searchError) {
        if (requestIdRef.current === requestId) {
          if (canRefreshSilently) {
            setError(null);
            return;
          }

          setError(searchError instanceof Error ? searchError.message : '流媒体服务暂时不可用');
          setResult(null);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [activeTab, provider, query],
  );

  useEffect(() => {
    const restoredResultKey = restoredResultKeyRef.current;
    if (restoredResultKey && resultRef.current && restoredResultKey === streamingSearchResultKey(provider, query, activeTab)) {
      restoredResultKeyRef.current = null;
      return;
    }

    restoredResultKeyRef.current = null;
    void runSearch(1, 'replace');
  }, [activeTab, provider, query, runSearch]);

  useEffect(() => {
    const streaming = getStreamingBridge();
    if (!streaming?.getFavorites) {
      return undefined;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      void streaming
        .getFavorites()
        .then((snapshot) => {
          if (!disposed) {
            setFavoriteTrackIds(favoriteIdsFromSnapshot(snapshot));
          }
        })
        .catch(() => undefined);
    }, 500);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setFailedCoverUrls({});
  }, [provider, query]);

  useEffect(() => {
    if (!selectedAlbum) {
      setSelectedAlbumDetail(null);
      setAlbumDetailError(null);
      setIsAlbumDetailLoading(false);
      return undefined;
    }

    const streaming = getStreamingBridge();
    if (!streaming?.getAlbum) {
      setSelectedAlbumDetail(null);
      setAlbumDetailError('Desktop bridge unavailable. Open ECHO Next in Electron to read streaming albums.');
      setIsAlbumDetailLoading(false);
      return undefined;
    }

    let isMounted = true;
    setSelectedAlbumDetail(null);
    setAlbumDetailError(null);
    setIsAlbumDetailLoading(true);

    void streaming
      .getAlbum({
        provider: selectedAlbum.provider,
        providerAlbumId: selectedAlbum.providerAlbumId,
      })
      .then((detail) => {
        if (isMounted) {
          setSelectedAlbumDetail(detail);
        }
      })
      .catch((detailError) => {
        if (isMounted) {
          setAlbumDetailError(detailError instanceof Error ? detailError.message : String(detailError));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsAlbumDetailLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedAlbum]);

  useEffect(() => {
    if (!selectedArtist) {
      setSelectedArtistDetail(null);
      setArtistDetailError(null);
      setIsArtistDetailLoading(false);
      return undefined;
    }

    const streaming = getStreamingBridge();
    if (!streaming?.getArtist) {
      setSelectedArtistDetail(null);
      setArtistDetailError('Desktop bridge unavailable. Open ECHO Next in Electron to read streaming artists.');
      setIsArtistDetailLoading(false);
      return undefined;
    }

    let isMounted = true;
    setSelectedArtistDetail(null);
    setArtistDetailError(null);
    setIsArtistDetailLoading(true);

    void streaming
      .getArtist({
        provider: selectedArtist.provider,
        providerArtistId: selectedArtist.providerArtistId,
      })
      .then((detail) => {
        if (isMounted) {
          setSelectedArtistDetail(detail);
        }
      })
      .catch((detailError) => {
        if (isMounted) {
          setArtistDetailError(detailError instanceof Error ? detailError.message : String(detailError));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsArtistDetailLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedArtist]);

  useEffect(() => {
    const downloads = getDownloadsBridge();
    if (!downloads?.onJobsUpdated) {
      return undefined;
    }

    return downloads.onJobsUpdated((nextJobs) => {
      setDownloadJobs(nextJobs);
      const trackedEntries = Object.entries(downloadJobIdsByTrackKey);
      for (const job of nextJobs) {
        if (job.status !== 'completed' || notifiedDownloadJobIdsRef.current.has(job.id)) {
          continue;
        }

        const matchedTrackKey = trackedEntries.find(([, jobId]) => jobId === job.id)?.[0];
        if (matchedTrackKey) {
          notifiedDownloadJobIdsRef.current.add(job.id);
          const matchedTrack = visibleKnownTracks.find((track) => track.stableKey === matchedTrackKey);
          setActionError(null);
          setActionMessage(`下载成功：${job.title ?? matchedTrack?.title ?? job.sourceUrl}`);
          break;
        }
      }

      if (albumDownload?.jobIds.length) {
        const albumJobs = albumDownload.jobIds
          .map((jobId) => nextJobs.find((job) => job.id === jobId) ?? null)
          .filter((job): job is DownloadJob => Boolean(job));
        const completedCount = albumJobs.filter((job) => job.status === 'completed').length;
        const failedCount = albumDownload.failedToQueue + albumJobs.filter((job) => job.status === 'failed' || job.status === 'cancelled').length;
        const terminalCount = completedCount + failedCount;
        const activeJob = albumJobs.find((job) => activeDownloadStatuses.has(job.status)) ?? null;
        const activeProgress = activeJob ? Math.max(0, Math.min(100, activeJob.progress)) / 100 : 0;
        const progress = Math.round(Math.max(0, Math.min(100, ((completedCount + activeProgress) / albumDownload.total) * 100)));
        const notice =
          terminalCount >= albumDownload.total
            ? failedCount > 0
              ? `专辑下载结束：${albumDownload.title}，完成 ${completedCount}/${albumDownload.total}，失败 ${failedCount}`
              : `专辑下载完成：${albumDownload.title}（${albumDownload.total}/${albumDownload.total}）`
            : `专辑下载中：${albumDownload.title}，${completedCount}/${albumDownload.total} · ${progress}%`;

        if (lastAlbumDownloadNoticeRef.current !== notice) {
          lastAlbumDownloadNoticeRef.current = notice;
          showChromeNotice(notice);
        }

        if (terminalCount >= albumDownload.total && albumDownload.queued + albumDownload.failedToQueue >= albumDownload.total) {
          setAlbumDownload(null);
        }
      }
    });
  }, [albumDownload, downloadJobIdsByTrackKey, visibleKnownTracks]);

  const handleCoverError = useCallback((stableKey: string, coverUrl: string): void => {
    if (coverUrl === defaultCover) {
      return;
    }

    setFailedCoverUrls((current) => (current[stableKey] === coverUrl ? current : { ...current, [stableKey]: coverUrl }));
  }, []);

  const handleQualityChange = useCallback(
    (nextQuality: QualityPreference): void => {
      setQuality(nextQuality);
      setQualityMenuOpen(false);

      const currentTrack = queue.currentTrack;
      const playbackQuality = qualityToPlaybackQuality(nextQuality);
      if (
        !currentTrack ||
        currentTrack.mediaType !== 'streaming' ||
        currentTrack.provider !== provider ||
        currentTrack.streamingQuality === playbackQuality
      ) {
        return;
      }

      const playback = window.echo?.playback;
      if (!playback?.getStatus) {
        return;
      }

      void (async () => {
        const status = await playback.getStatus();
        if (
          status.currentTrackId !== currentTrack.id ||
          !qualitySwitchPlaybackStates.has(status.state)
        ) {
          return;
        }

        await queue.playTrack(
          { ...currentTrack, streamingQuality: playbackQuality },
          {
            source,
            startSeconds: Math.max(0, status.positionMs / 1000),
            forceRefresh: true,
          },
        );
        setActionError(null);
        setActionMessage(t('streaming.quality.switched', { quality: t(qualities.find((item) => item.key === nextQuality)?.labelKey ?? 'streaming.quality.lossless') }));
      })().catch((qualityError) => {
        if (isPlaybackCancellationError(qualityError)) {
          return;
        }

        setActionError(qualityError instanceof Error ? qualityError.message : t('streaming.quality.switchFailed'));
        setActionMessage(null);
      });
    },
    [provider, queue, source, t],
  );

  const handlePlay = useCallback(
    async (track: StreamingTrack): Promise<void> => {
      if (resolvingTrackKey === track.stableKey) {
        return;
      }

      if (!track.playable) {
      setActionError(track.unavailableReason ?? '这首歌暂时不可播放');
        setActionMessage(null);
        return;
      }

      setActionError(null);
      setActionMessage(null);
      const playActionId = playActionIdRef.current + 1;
      playActionIdRef.current = playActionId;
      setResolvingTrackKey(track.stableKey);
      try {
        await queue.playTrack(streamingTrackToLibraryTrack(track, quality), {
          source,
          forceNewQueueItem: true,
        });
      } catch (playError) {
        if (isPlaybackCancellationError(playError) || playActionIdRef.current !== playActionId) {
          return;
        }

        setActionError(playError instanceof Error ? playError.message : '流媒体服务暂时不可用');
      } finally {
        if (playActionIdRef.current === playActionId) {
          setResolvingTrackKey(null);
        }
      }
    },
    [quality, queue, resolvingTrackKey, source],
  );

  const handleAddToQueue = useCallback(
    (track: StreamingTrack): void => {
      if (!track.playable) {
        setActionError(track.unavailableReason ?? '这首歌暂时不可播放');
        setActionMessage(null);
        return;
      }

      setActionError(null);
      setActionMessage('已加入队列');
      queue.appendToQueue(streamingTrackToLibraryTrack(track, quality), source);
      setQueuedTrackKey(track.stableKey);
      window.setTimeout(() => setQueuedTrackKey((current) => (current === track.stableKey ? null : current)), 1400);
    },
    [quality, queue, source],
  );

  const handleToggleFavorite = useCallback(async (track: StreamingTrack): Promise<void> => {
    if (!favoriteProviders.has(track.provider)) {
      return;
    }

    const streaming = getStreamingBridge();
    if (!streaming?.setFavorite) {
      setActionError('Streaming favorites are unavailable.');
      setActionMessage(null);
      return;
    }

    const key = favoriteKey(track.provider, track.providerTrackId);
    const nextFavorite = favoriteTrackIds[key] !== true;
    setFavoriteTrackKey(track.stableKey);
    try {
      const result = await streaming.setFavorite({ track, favorite: nextFavorite });
      setFavoriteTrackIds(favoriteIdsFromSnapshot(result.snapshot));
      window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
      setActionError(null);
      setActionMessage(result.favorite ? `已收藏：${track.title}` : `已取消收藏：${track.title}`);
    } catch (favoriteError) {
      setActionError(favoriteError instanceof Error ? favoriteError.message : String(favoriteError));
      setActionMessage(null);
    } finally {
      setFavoriteTrackKey((current) => (current === track.stableKey ? null : current));
    }
  }, [favoriteTrackIds]);

  const handleDownload = useCallback(async (track: StreamingTrack): Promise<void> => {
    if (unsupportedDownloadProviders.has(track.provider)) {
      setActionError('这个平台在 ECHO Next 中仅支持流播放，不提供下载任务。');
      setActionMessage(null);
      return;
    }

    const sourceUrl = streamingTrackWebUrl(track);
    if (!sourceUrl) {
      setActionError('这个平台暂不支持从流媒体结果直接下载。');
      setActionMessage(null);
      return;
    }

    const downloads = getDownloadsBridge();
    if (!downloads?.createUrlJob) {
      setActionError('桌面下载服务不可用。');
      setActionMessage(null);
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setDownloadingTrackKey(track.stableKey);
    try {
      const streaming = getStreamingBridge();
      if (!streaming?.resolvePlayback) {
        throw new Error('桌面桥接不可用，无法解析流媒体下载地址。');
      }
      const source = await streaming.resolvePlayback({
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        quality: qualityToPlaybackQuality(quality),
      });
      const job = await downloads.createUrlJob(source.url, {
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtist: track.albumArtist ?? track.artist,
        coverUrl: track.coverUrl ?? track.coverThumb ?? null,
        webpageUrl: sourceUrl,
        bindMvAfterImport: false,
        requestHeaders: source.headers,
        directAudio: true,
        directAudioMimeType: source.mimeType,
        directAudioExtension: source.codec,
        streamingProvider: track.provider,
        streamingProviderTrackId: track.providerTrackId,
        streamingStableKey: track.stableKey,
        downloadAuthorizationToken: source.downloadAuthorizationToken,
      });
      setDownloadJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
      setDownloadJobIdsByTrackKey((current) => ({ ...current, [track.stableKey]: job.id }));
      setActionMessage(`已加入下载队列：${track.title}`);
    } catch (downloadError) {
      setActionError(downloadError instanceof Error ? downloadError.message : '添加下载任务失败');
      setActionMessage(null);
    } finally {
      setDownloadingTrackKey((current) => (current === track.stableKey ? null : current));
    }
  }, [quality]);

  const handleDownloadAlbum = useCallback(async (): Promise<void> => {
    const detail = selectedAlbumDetail;
    if (!detail || albumDownload) {
      return;
    }

    const downloads = getDownloadsBridge();
    const streaming = getStreamingBridge();
    if (!downloads?.createUrlJob || !streaming?.resolvePlayback) {
      setAlbumDetailError('Desktop download bridge unavailable. Open ECHO Next in Electron to download streaming albums.');
      showChromeNotice('下载服务不可用：请在 ECHO Next 桌面端使用。');
      return;
    }

    const downloadableTracks = detail.tracks.filter((track) =>
      track.playable &&
      !unsupportedDownloadProviders.has(track.provider) &&
      Boolean(streamingTrackWebUrl(track)),
    );

    if (downloadableTracks.length === 0) {
      setAlbumDetailError('这张流媒体专辑没有可下载的歌曲。');
      showChromeNotice(`无法下载专辑：${detail.title}`);
      return;
    }

    const runId = albumDownloadRunIdRef.current + 1;
    albumDownloadRunIdRef.current = runId;
    lastAlbumDownloadNoticeRef.current = null;
    const albumSubdirectory = [detail.artist, detail.title].filter(Boolean).join(' - ') || detail.title;
    let queuedCount = 0;
    let failedToQueueCount = 0;

    setAlbumDetailError(null);
    setActionError(null);
    setActionMessage(null);
    setAlbumDownload({
      albumId: detail.id,
      title: detail.title,
      total: downloadableTracks.length,
      queued: 0,
      failedToQueue: 0,
      jobIds: [],
    });
    showChromeNotice(`准备下载专辑：${detail.title}（0/${downloadableTracks.length}）`);

    for (let index = 0; index < downloadableTracks.length; index += 1) {
      if (albumDownloadRunIdRef.current !== runId) {
        return;
      }

      const track = downloadableTracks[index];
      const webpageUrl = streamingTrackWebUrl(track);
      if (!webpageUrl) {
        failedToQueueCount += 1;
        setAlbumDownload((current) =>
          current?.albumId === detail.id
            ? { ...current, failedToQueue: failedToQueueCount }
            : current,
        );
        continue;
      }

      setDownloadingTrackKey(track.stableKey);
      showChromeNotice(`解析专辑：${detail.title}，${index + 1}/${downloadableTracks.length} · ${track.title}`);

      try {
        const source = await streaming.resolvePlayback({
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          quality: qualityToPlaybackQuality(quality),
        });
        const job = await downloads.createUrlJob(source.url, {
          title: track.title,
          artist: track.artist,
          album: track.album || detail.title,
          albumArtist: track.albumArtist ?? detail.artist ?? track.artist,
          coverUrl: track.coverUrl ?? track.coverThumb ?? detail.coverUrl ?? detail.coverThumb ?? null,
          webpageUrl,
          outputSubdirectory: albumSubdirectory,
          bindMvAfterImport: false,
          deferImportToLibrary: true,
          requestHeaders: source.headers,
          directAudio: true,
          directAudioMimeType: source.mimeType,
          directAudioExtension: source.codec,
          streamingProvider: track.provider,
          streamingProviderTrackId: track.providerTrackId,
          streamingStableKey: track.stableKey,
          downloadAuthorizationToken: source.downloadAuthorizationToken,
        });

        queuedCount += 1;
        setDownloadJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
        setDownloadJobIdsByTrackKey((current) => ({ ...current, [track.stableKey]: job.id }));
        setAlbumDownload((current) =>
          current?.albumId === detail.id
            ? {
                ...current,
                queued: queuedCount,
                jobIds: current.jobIds.includes(job.id) ? current.jobIds : [...current.jobIds, job.id],
              }
            : current,
        );
      } catch (downloadError) {
        failedToQueueCount += 1;
        setAlbumDownload((current) =>
          current?.albumId === detail.id
            ? { ...current, failedToQueue: failedToQueueCount }
            : current,
        );
        setActionError(downloadError instanceof Error ? downloadError.message : '添加专辑下载任务失败');
      } finally {
        setDownloadingTrackKey((current) => (current === track.stableKey ? null : current));
      }

      await sleep(albumDownloadQueueYieldMs);
    }

    if (albumDownloadRunIdRef.current !== runId) {
      return;
    }

    const finalNotice = failedToQueueCount > 0
      ? `专辑已加入下载队列：${detail.title}，成功 ${queuedCount}/${downloadableTracks.length}，失败 ${failedToQueueCount}`
      : `专辑已加入下载队列：${detail.title}（${queuedCount}/${downloadableTracks.length}）`;
    showChromeNotice(finalNotice);
    setActionMessage(finalNotice);
    if (queuedCount === 0) {
      setAlbumDownload(null);
    }
  }, [albumDownload, quality, selectedAlbumDetail]);

  const handleImportPlaylist = useCallback(async (): Promise<void> => {
    const streaming = getStreamingBridge();
    const url = playlistUrl.trim();
    if (!url || isImportingPlaylist) {
      return;
    }

    if (!streaming?.importPlaylistFromUrl) {
      setActionError('桌面桥接不可用，请在 ECHO Next 客户端窗口中添加流媒体歌单。');
      setActionMessage(null);
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setIsImportingPlaylist(true);
    try {
      const imported = await streaming.importPlaylistFromUrl(url);
      setPlaylistUrl('');
      setActionMessage(`已添加歌单：${imported.playlistName}，共 ${imported.importedCount} 首。可在播放列表页播放。`);
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (importError) {
      setActionError(importError instanceof Error ? importError.message : '添加流媒体歌单失败');
      setActionMessage(null);
    } finally {
      setIsImportingPlaylist(false);
    }
  }, [isImportingPlaylist, playlistUrl]);

  const handleImportStreamingPlaylist = useCallback(async (playlist: StreamingPlaylist): Promise<void> => {
    const streaming = getStreamingBridge();
    const playlistWebUrl = streamingPlaylistWebUrl(playlist);
    if (!playlistWebUrl || importingPlaylistKey) {
      return;
    }

    if (!streaming?.importPlaylistFromUrl) {
      setActionError('桌面桥接不可用，请在 ECHO Next 客户端窗口中添加流媒体歌单。');
      setActionMessage(null);
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setImportingPlaylistKey(playlist.id);
    try {
      const imported = await streaming.importPlaylistFromUrl(playlistWebUrl);
      setActionMessage(`已添加歌单：${imported.playlistName}，共 ${imported.importedCount} 首。可在播放列表页播放。`);
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (importError) {
      setActionError(importError instanceof Error ? importError.message : '添加流媒体歌单失败');
      setActionMessage(null);
    } finally {
      setImportingPlaylistKey((current) => (current === playlist.id ? null : current));
    }
  }, [importingPlaylistKey]);

  const handleOpenAlbum = useCallback((album: StreamingAlbum): void => {
    setSelectedAlbum(album);
    setActionError(null);
    setActionMessage(null);
  }, []);

  const handleAlbumKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, album: StreamingAlbum): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenAlbum(album);
    }
  }, [handleOpenAlbum]);

  const handleOpenArtist = useCallback((artist: StreamingArtist): void => {
    setSelectedArtist(artist);
    setActionError(null);
    setActionMessage(null);
  }, []);

  const handleArtistKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, artist: StreamingArtist): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenArtist(artist);
    }
  }, [handleOpenArtist]);

  const handleOpenTrackArtist = useCallback((artistRef: StreamingTrack['artists'][number]): void => {
    handleOpenArtist({
      id: artistRef.id,
      provider: artistRef.provider,
      providerArtistId: artistRef.providerArtistId,
      name: artistRef.name,
      avatarUrl: null,
      coverUrl: null,
    });
  }, [handleOpenArtist]);

  const handleOpenTrackAlbum = useCallback((track: StreamingTrack): void => {
    if (!track.albumId) {
      return;
    }

    handleOpenAlbum({
      id: streamingStableKey(track.provider, `album:${track.albumId}`),
      provider: track.provider,
      providerAlbumId: track.albumId,
      title: track.album,
      artist: track.albumArtist ?? track.artist,
      artists: track.artists,
      coverUrl: track.coverUrl,
      coverThumb: track.coverThumb,
      releaseDate: null,
      trackCount: null,
    });
  }, [handleOpenAlbum]);

  const handlePlayAlbum = useCallback(async (): Promise<void> => {
    const detail = selectedAlbumDetail;
    const firstTrack = detail?.tracks.find((track) => track.playable) ?? null;
    if (!detail || !firstTrack) {
      setAlbumDetailError('这张流媒体专辑暂时没有可播放的歌曲。');
      return;
    }

    const detailSource = { type: 'streaming' as const, label: `${detail.title} / ${detail.provider}`, provider: detail.provider };
    const playableTracks = detail.tracks.filter((track) => track.playable).map((track) => streamingTrackToLibraryTrack(track, quality));
    const firstPlayable = playableTracks[0];
    if (!firstPlayable) {
      setAlbumDetailError('这张流媒体专辑暂时没有可播放的歌曲。');
      return;
    }

    try {
      setAlbumDetailError(null);
      await queue.playTrack(firstPlayable, {
        replaceQueueWith: playableTracks,
        source: detailSource,
      });
    } catch (playError) {
      if (isPlaybackCancellationError(playError)) {
        return;
      }

      setAlbumDetailError(playError instanceof Error ? playError.message : String(playError));
    }
  }, [quality, queue, selectedAlbumDetail]);

  const renderFavoriteButton = (track: StreamingTrack): JSX.Element | null => {
    if (!favoriteProviders.has(track.provider)) {
      return null;
    }

    const isFavorite = favoriteTrackIds[favoriteKey(track.provider, track.providerTrackId)] === true;
    const isUpdating = favoriteTrackKey === track.stableKey;
    return (
      <button
        type="button"
        title={isFavorite ? '取消收藏' : '收藏'}
        aria-label={isFavorite ? '取消收藏' : '收藏'}
        data-active={isFavorite}
        onClick={() => void handleToggleFavorite(track)}
        disabled={isUpdating}
      >
        {isUpdating ? <Loader2 className="spinning-icon" size={16} /> : <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />}
      </button>
    );
  };

  const renderStreamingAlbumDetail = (): JSX.Element | null => {
    const album = selectedAlbumDetail ?? selectedAlbum;
    if (!album) {
      return null;
    }

    const detailTracks = selectedAlbumDetail?.tracks ?? [];
    const visibleDetailTracks = detailTracks.slice(0, selectedAlbumTrackRenderLimit);
    const coverSrc = selectedAlbumDetail?.coverThumb ?? selectedAlbum?.coverThumb ?? defaultCover;
    const duration = formatAlbumDuration(detailTracks);
    const albumMetadata = [
      album.releaseDate,
      formatTrackCount(selectedAlbumDetail?.tracks.length ?? album.trackCount),
      duration,
      album.provider,
    ].filter((item): item is string => Boolean(item));
    const firstTrack = detailTracks[0] ?? null;
    const qualitySummary = firstTrack?.qualities.join(' / ') || 'Reading signal';
    const currentDetailStableKey = queue.currentTrack?.mediaType === 'streaming' ? queue.currentTrack.stableKey ?? queue.currentTrack.id : null;
    const downloadableDetailTrackCount = detailTracks.filter((track) =>
      track.playable &&
      !unsupportedDownloadProviders.has(track.provider) &&
      Boolean(streamingTrackWebUrl(track)),
    ).length;
    const isAlbumDownloadBusy = Boolean(albumDownload && albumDownload.albumId === album.id);

    return (
      <div className={`album-detail-page ${isAlbumReturning ? 'is-returning' : ''}`}>
        <button className="album-back-button" type="button" onClick={returnFromAlbum}>
          <ArrowLeft size={17} />
          Streaming
        </button>

        <section className="album-detail-hero" aria-label={`${album.title} streaming album details`}>
          <div className="album-detail-cover" data-empty={!coverSrc || coverSrc === defaultCover}>
            {coverSrc ? <img alt="" decoding="async" draggable={false} height={320} src={coverSrc} width={320} /> : <Disc3 size={58} />}
          </div>

          <div className="album-detail-console">
            <div className="album-detail-copy">
              <span className="album-detail-kicker">Streaming Album</span>
              <h1>{album.title}</h1>
              <p>{album.artist}</p>

              <div className="album-detail-meta" aria-label="Streaming album metadata">
                {albumMetadata.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>

            <div className="album-detail-actions">
              <button className="album-primary-action" type="button" disabled={isAlbumDetailLoading || detailTracks.length === 0} onClick={() => void handlePlayAlbum()}>
                {isAlbumDetailLoading ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} fill="currentColor" />}
                {isAlbumDetailLoading ? 'Reading album' : 'Play Now'}
              </button>
              {streamingDownloadActionsEnabled ? (
                <button
                  className="album-secondary-action"
                  type="button"
                  disabled={isAlbumDetailLoading || downloadableDetailTrackCount === 0 || isAlbumDownloadBusy}
                  onClick={() => void handleDownloadAlbum()}
                >
                  {isAlbumDownloadBusy ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
                  {isAlbumDownloadBusy ? 'Downloading' : '下载专辑'}
                </button>
              ) : null}
            </div>

            {albumDetailError ? <p className="album-detail-error">{albumDetailError}</p> : null}
          </div>

          <aside className="album-detail-facts" aria-label="Streaming album info">
            <div className="album-fact">
              <span>Provider</span>
              <strong>{album.provider}</strong>
            </div>
            <div className="album-fact">
              <span>Tracks</span>
              <strong>{formatTrackCount(selectedAlbumDetail?.tracks.length ?? album.trackCount)}</strong>
            </div>
            <div className="album-fact">
              <span>Released</span>
              <strong>{album.releaseDate ?? 'Unknown'}</strong>
            </div>
            <div className="album-fact">
              <span>Quality</span>
              <strong>{qualitySummary}</strong>
            </div>
          </aside>
        </section>

        <section className="album-detail-track-console" aria-label={`${album.title} streaming track console`}>
          <header className="album-detail-tabs" aria-label="Streaming album sections">
            <button className="album-detail-tab" type="button" aria-current="page">
              Tracks
            </button>
          </header>

          {isAlbumDetailLoading && detailTracks.length === 0 ? <div className="streaming-state">正在读取专辑...</div> : null}
          {!isAlbumDetailLoading && detailTracks.length === 0 && !albumDetailError ? <div className="streaming-state">这张专辑没有可显示的歌曲。</div> : null}
          {detailTracks.length > 0 ? (
            <div className="streaming-album-track-list">
              {visibleDetailTracks.map((track) => {
                const isPlaying = currentDetailStableKey === track.stableKey;
                const isResolving = resolvingTrackKey === track.stableKey;
                const isQueued = queuedTrackKey === track.stableKey;
                const downloadJobId = downloadJobIdsByTrackKey[track.stableKey];
                const downloadJob = downloadJobId ? downloadJobs.find((job) => job.id === downloadJobId) : null;
                const isDownloading = downloadingTrackKey === track.stableKey || Boolean(downloadJob && activeDownloadStatuses.has(downloadJob.status));
                const disabled = !track.playable || Boolean(resolvingTrackKey);
                const downloadProgress = downloadJob ? Math.max(0, Math.min(100, downloadJob.progress)) : 0;
                const rawCoverSrc = track.coverThumb ?? coverSrc ?? defaultCover;
                const trackCoverSrc = failedCoverUrls[track.stableKey] === rawCoverSrc ? defaultCover : rawCoverSrc;

                return (
                  <article className="streaming-row" data-playing={isPlaying} data-unavailable={!track.playable} key={track.stableKey} onDoubleClick={() => void handlePlay(track)}>
                    <div className="streaming-cover" data-empty={trackCoverSrc === defaultCover}>
                      <img
                        src={trackCoverSrc}
                        alt=""
                        decoding="async"
                        draggable={false}
                        height={56}
                        loading="lazy"
                        width={56}
                        onError={() => handleCoverError(track.stableKey, trackCoverSrc)}
                      />
                    </div>
                    <div className="streaming-main">
                      <div className="streaming-title-line">
                        {isPlaying ? <span className="playing-dot" /> : null}
                        <strong>{track.title}</strong>
                        {isPlaying ? <em>正在播放</em> : null}
                      </div>
                      {renderTrackCredits(track)}
                      <small>{track.playable ? `${track.provider} · ${track.qualities.join(' / ') || 'standard'}` : (track.unavailableReason ?? '这首歌暂时不可播放')}</small>
                    </div>
                    <span className="streaming-duration">{formatDuration(track.duration)}</span>
                    <div className="streaming-actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button type="button" title="播放" onClick={() => void handlePlay(track)} disabled={disabled}>
                        {isResolving ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} />}
                      </button>
                      <button type="button" title="加入队列" onClick={() => handleAddToQueue(track)} disabled={!track.playable}>
                        {isQueued ? <Check size={16} /> : <ListPlus size={16} />}
                      </button>
                      {renderFavoriteButton(track)}
                      {streamingDownloadActionsEnabled && !unsupportedDownloadProviders.has(track.provider) ? (
                        <button type="button" title="下载" onClick={() => void handleDownload(track)} disabled={isDownloading}>
                          {isDownloading ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
                        </button>
                      ) : null}
                    </div>
                    {isResolving ? <div className="streaming-resolving">正在解析播放地址...</div> : null}
                    {downloadJob ? (
                      <div className="streaming-download-progress" data-status={downloadJob.status}>
                        <div
                          className="streaming-download-progress-track"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(downloadProgress)}
                          aria-label="下载进度"
                        >
                          <span style={{ width: `${downloadProgress}%` }} />
                        </div>
                        <small>
                          {downloadStatusLabels[downloadJob.status]} · {Math.round(downloadProgress)}%
                        </small>
                        {downloadJob.status === 'failed' && downloadJob.error ? <small>{downloadJob.error}</small> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    );
  };

  const handlePlayArtist = useCallback(async (): Promise<void> => {
    const detail = selectedArtistDetail;
    const topTracks = Array.isArray(detail?.topTracks) ? detail.topTracks : [];
    const playableTracks = topTracks.filter((track) => track.playable).map((track) => streamingTrackToLibraryTrack(track, quality));
    const firstTrack = playableTracks[0];
    if (!detail || !firstTrack) {
      setArtistDetailError('这个流媒体歌手暂时没有可播放的歌曲。');
      return;
    }

    try {
      setArtistDetailError(null);
      const detailName = safeStreamingArtistDetailName(detail);
      await queue.playTrack(firstTrack, {
        replaceQueueWith: playableTracks,
        source: { type: 'streaming' as const, label: `${detailName} / ${detail.provider}`, provider: detail.provider },
      });
    } catch (playError) {
      if (isPlaybackCancellationError(playError)) {
        return;
      }

      setArtistDetailError(playError instanceof Error ? playError.message : String(playError));
    }
  }, [quality, queue, selectedArtistDetail]);

  const handleQueueArtist = useCallback((): void => {
    if (!selectedArtistDetail) {
      return;
    }

    const artistSource = {
      type: 'streaming' as const,
      label: `${safeStreamingArtistDetailName(selectedArtistDetail)} / ${selectedArtistDetail.provider}`,
      provider: selectedArtistDetail.provider,
    };
    const topTracks = Array.isArray(selectedArtistDetail.topTracks) ? selectedArtistDetail.topTracks : [];
    topTracks
      .filter((track) => track.playable)
      .forEach((track) => queue.appendToQueue(streamingTrackToLibraryTrack(track, quality), artistSource));
  }, [quality, queue, selectedArtistDetail]);

  const renderStreamingArtistDetail = (): JSX.Element | null => {
    const artist = selectedArtistDetail ?? selectedArtist;
    if (!artist) {
      return null;
    }

    const artistName = safeStreamingArtistDetailName(artist);
    const artistProvider = artist.provider ?? provider;
    const topTracks = Array.isArray(selectedArtistDetail?.topTracks) ? selectedArtistDetail.topTracks : [];
    const artistAlbums = Array.isArray(selectedArtistDetail?.albums) ? selectedArtistDetail.albums : [];
    const heroImageUrl = artist.coverUrl ?? artist.avatarUrl ?? null;
    const currentDetailStableKey = queue.currentTrack?.mediaType === 'streaming' ? queue.currentTrack.stableKey ?? queue.currentTrack.id : null;
    const canPlay = topTracks.some((track) => track.playable);

    return (
      <div className={`streaming-artist-page ${isArtistReturning ? 'is-returning' : ''}`}>
        <button className="streaming-artist-back" type="button" onClick={returnFromArtist}>
          <ArrowLeft size={17} />
          Streaming
        </button>

        <section className="streaming-artist-hero" data-has-image={Boolean(heroImageUrl)} aria-label={`${artistName} streaming artist details`}>
          <div className="streaming-artist-avatar" data-cover={Boolean(heroImageUrl)} aria-hidden="true">
            {heroImageUrl ? <img alt="" decoding="async" draggable={false} height={512} loading="lazy" src={heroImageUrl} width={512} /> : <span>{streamingArtistInitial(artistName)}</span>}
          </div>

          <div className="streaming-artist-copy">
            <span className="streaming-artist-kicker">Streaming Artist</span>
            <h1>{artistName}</h1>
            <div className="streaming-artist-meta" aria-label="Streaming artist metadata">
              <span>{artistProvider}</span>
              <span>{formatTrackCount(topTracks.length)}</span>
              <span>{artistAlbums.length} albums</span>
            </div>
            <p>Streaming catalog from {artistProvider}.</p>

            <div className="streaming-artist-actions">
              <button className="streaming-artist-primary-action" type="button" disabled={isArtistDetailLoading || !canPlay} onClick={() => void handlePlayArtist()}>
                {isArtistDetailLoading ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} fill="currentColor" />}
                {isArtistDetailLoading ? 'Reading Artist' : 'Play Artist'}
              </button>
              <button className="streaming-artist-secondary-action" type="button" disabled={!canPlay} onClick={handleQueueArtist}>
                <ListPlus size={16} />
                Add to Queue
              </button>
            </div>

            {artistDetailError ? <p className="streaming-artist-error">{artistDetailError}</p> : null}
          </div>

          <div className="streaming-artist-stats" aria-label="Streaming artist summary">
            <div>
              <span>Source</span>
              <strong>{artistProvider}</strong>
            </div>
            <div>
              <span>Tracks</span>
              <strong>{topTracks.length}</strong>
            </div>
            <div>
              <span>Albums</span>
              <strong>{artistAlbums.length}</strong>
            </div>
          </div>
        </section>

        <section className="streaming-artist-section" aria-label={`${artistName} streaming top tracks`}>
          <div className="streaming-artist-section-heading">
            <div>
              <span>Top Tracks</span>
              <h2>Songs</h2>
            </div>
          </div>
          {isArtistDetailLoading && topTracks.length === 0 ? <div className="streaming-state">正在读取歌手...</div> : null}
          {!isArtistDetailLoading && topTracks.length === 0 && !artistDetailError ? <div className="streaming-state">这个歌手没有可显示的歌曲。</div> : null}
          {topTracks.length > 0 ? (
            <div className="streaming-artist-track-list">
              {topTracks.map((track) => {
                const isPlaying = currentDetailStableKey === track.stableKey;
                const isResolving = resolvingTrackKey === track.stableKey;
                const isQueued = queuedTrackKey === track.stableKey;
                const disabled = !track.playable || Boolean(resolvingTrackKey);
                const rawCoverSrc = track.coverThumb ?? defaultCover;
                const trackCoverSrc = failedCoverUrls[track.stableKey] === rawCoverSrc ? defaultCover : rawCoverSrc;

                return (
                  <article className="streaming-row" data-playing={isPlaying} data-unavailable={!track.playable} key={track.stableKey} onDoubleClick={() => void handlePlay(track)}>
                    <div className="streaming-cover" data-empty={trackCoverSrc === defaultCover}>
                      <img src={trackCoverSrc} alt="" decoding="async" draggable={false} height={56} loading="lazy" width={56} onError={() => handleCoverError(track.stableKey, trackCoverSrc)} />
                    </div>
                    <div className="streaming-main">
                      <div className="streaming-title-line">
                        {isPlaying ? <span className="playing-dot" /> : null}
                        <strong>{track.title}</strong>
                        {isPlaying ? <em>正在播放</em> : null}
                      </div>
                      {renderTrackCredits(track)}
                      <small>{track.playable ? `${track.provider} · ${track.album}` : (track.unavailableReason ?? '这首歌暂时不可播放')}</small>
                    </div>
                    <span className="streaming-duration">{formatDuration(track.duration)}</span>
                    <div className="streaming-actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button type="button" title="播放" onClick={() => void handlePlay(track)} disabled={disabled}>
                        {isResolving ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} />}
                      </button>
                      <button type="button" title="加入队列" onClick={() => handleAddToQueue(track)} disabled={!track.playable}>
                        {isQueued ? <Check size={16} /> : <ListPlus size={16} />}
                      </button>
                      {renderFavoriteButton(track)}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>

        {artistAlbums.length > 0 ? (
          <section className="streaming-artist-section" aria-label={`${artistName} streaming albums`}>
            <div className="streaming-artist-section-heading">
              <div>
                <span>Albums</span>
                <h2>Discography</h2>
              </div>
            </div>
            <div className="streaming-artist-album-list">
              {artistAlbums.map(renderAlbumCard)}
            </div>
          </section>
        ) : null}
      </div>
    );
  };

  const renderTrackCredits = (track: StreamingTrack): JSX.Element => {
    const artists = streamingTrackArtists(track);
    const displayArtists = artists.length > 0 ? artists : null;
    const canOpenAlbum = Boolean(track.albumId);

    return (
      <span className="streaming-credit-links">
        {displayArtists
          ? displayArtists.map((artist, index) => (
              <span className="streaming-credit-part" key={artist.id}>
                {index > 0 ? <span className="streaming-credit-separator">,</span> : null}
                <button
                  type="button"
                  className="streaming-inline-link"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenTrackArtist(artist);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {artist.name}
                </button>
              </span>
            ))
          : <span>{track.artist}</span>}
        <span className="streaming-credit-separator">/</span>
        {canOpenAlbum ? (
          <button
            type="button"
            className="streaming-inline-link"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenTrackAlbum(track);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {track.album}
          </button>
        ) : (
          <span>{track.album}</span>
        )}
      </span>
    );
  };

  const renderAlbumCard = (album: StreamingAlbum): JSX.Element => {
    const rawCoverSrc = album.coverThumb ?? defaultCover;
    const coverSrc = failedCoverUrls[album.id] === rawCoverSrc ? defaultCover : rawCoverSrc;

    return (
      <article
        key={album.id}
        className="streaming-discovery-card"
        role="button"
        tabIndex={0}
        onClick={() => handleOpenAlbum(album)}
        onKeyDown={(event) => handleAlbumKeyDown(event, album)}
      >
        <div className="streaming-cover" data-empty={coverSrc === defaultCover}>
          <img
            src={coverSrc}
            alt=""
            decoding="async"
            draggable={false}
            height={56}
            loading="lazy"
            width={56}
            onError={() => handleCoverError(album.id, coverSrc)}
          />
        </div>
        <div className="streaming-main">
          <div className="streaming-title-line">
            <Disc3 size={15} />
            <strong>{album.title}</strong>
          </div>
          <span>{album.artist}</span>
          <small>
            {album.provider} · {album.trackCount ? `${album.trackCount} 首` : '曲目数未知'}
            {album.releaseDate ? ` · ${album.releaseDate}` : ''}
          </small>
        </div>
      </article>
    );
  };

  const renderArtistCard = (artist: StreamingArtist): JSX.Element => {
    const rawCoverSrc = artist.avatarUrl ?? artist.coverUrl ?? defaultCover;
    const coverSrc = failedCoverUrls[artist.id] === rawCoverSrc ? defaultCover : rawCoverSrc;

    return (
      <article
        key={artist.id}
        className="streaming-discovery-card"
        role="button"
        tabIndex={0}
        onClick={() => handleOpenArtist(artist)}
        onKeyDown={(event) => handleArtistKeyDown(event, artist)}
      >
        <div className="streaming-cover streaming-cover--avatar" data-empty={coverSrc === defaultCover}>
          <img
            src={coverSrc}
            alt=""
            decoding="async"
            draggable={false}
            height={56}
            loading="lazy"
            width={56}
            onError={() => handleCoverError(artist.id, coverSrc)}
          />
        </div>
        <div className="streaming-main">
          <div className="streaming-title-line">
            <UserRound size={15} />
            <strong>{artist.name}</strong>
          </div>
          <span>{artist.provider}</span>
          <small>歌手 ID · {artist.providerArtistId}</small>
        </div>
      </article>
    );
  };

  const renderPlaylistCard = (playlist: StreamingPlaylist): JSX.Element => {
    const rawCoverSrc = playlist.coverThumb ?? defaultCover;
    const coverSrc = failedCoverUrls[playlist.id] === rawCoverSrc ? defaultCover : rawCoverSrc;
    const isImporting = importingPlaylistKey === playlist.id;

    return (
      <article key={playlist.id} className="streaming-discovery-card streaming-playlist-card">
        <div className="streaming-cover" data-empty={coverSrc === defaultCover}>
          <img
            src={coverSrc}
            alt=""
            decoding="async"
            draggable={false}
            height={56}
            loading="lazy"
            width={56}
            onError={() => handleCoverError(playlist.id, coverSrc)}
          />
        </div>
        <div className="streaming-main">
          <div className="streaming-title-line">
            <ListPlus size={15} />
            <strong>{playlist.title}</strong>
          </div>
          <span>{playlist.creator ?? playlist.provider}</span>
          <small>
            {playlist.provider} · {formatTrackCount(playlist.trackCount)}
          </small>
        </div>
        <button type="button" className="streaming-playlist-add" disabled={Boolean(importingPlaylistKey)} onClick={() => void handleImportStreamingPlaylist(playlist)}>
          {isImporting ? <Loader2 className="spinning-icon" size={15} /> : <ListPlus size={15} />}
          <span>{isImporting ? '添加中' : '添加歌单'}</span>
        </button>
      </article>
    );
  };

  if (selectedAlbum) {
    return renderStreamingAlbumDetail() ?? <div className="streaming-page streaming-hub" />;
  }

  if (selectedArtist) {
    return renderStreamingArtistDetail() ?? <div className="streaming-page streaming-hub" />;
  }

  return (
    <div className="streaming-page streaming-hub">
      <header className="streaming-hero">
        <div className="streaming-hero-copy">
          <span className="streaming-kicker">
            <Radio size={16} />
            {t('route.streaming.label')}
          </span>
          <h1>{t('streaming.hero.title')}</h1>
          <p>{t('streaming.hero.description')}</p>
        </div>
        <div className="streaming-hero-meter" aria-label={t('streaming.hero.meterAria')}>
          <span>{t('streaming.hero.currentProvider')}</span>
          <strong>{currentProvider?.displayName ?? provider}</strong>
          <small>{activeTabLabel} · {resultSummary}</small>
        </div>
      </header>

      <section className="streaming-command-panel">
        <label className="search-box streaming-search-box">
          <Search size={19} />
          <input {...searchInputProps} placeholder={t('streaming.search.placeholder')} />
        </label>
        <div className="streaming-provider-tabs" aria-label={t('streaming.providers.aria')}>
          {providerOptions.map((item) => (
            <button key={item.name} type="button" data-active={item.name === provider} disabled={!item.enabled} onClick={() => setProvider(item.name)}>
              <span>{item.displayName}</span>
              <small>{statusText(item)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="streaming-toolbar">
        <nav className="streaming-result-tabs" aria-label={t('streaming.tabs.aria')}>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" data-active={tab.key === activeTab} onClick={() => setActiveTab(tab.key)}>
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>
        <div className="streaming-quality-select">
          <button type="button" aria-expanded={qualityMenuOpen} onClick={() => setQualityMenuOpen((open) => !open)}>
            <span>{t('streaming.quality.label')}</span>
            <strong>{t(currentQuality.labelKey)}</strong>
            <ChevronDown size={15} />
          </button>
          {qualityMenuOpen ? (
            <div className="streaming-quality-menu" role="listbox" aria-label={t('streaming.quality.menuAria')}>
              {qualities.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={item.key === quality}
                  onClick={() => handleQualityChange(item.key)}
                >
                  <span>
                    <strong>{t(item.labelKey)}</strong>
                    <small>{t(item.descriptionKey)}</small>
                  </span>
                  {item.key === quality ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="streaming-state-stack">
        {error ? <div className="streaming-state streaming-state--error">{error}</div> : null}
        {actionError ? <div className="streaming-state streaming-state--error">{actionError}</div> : null}
        {actionMessage ? <div className="streaming-state streaming-state--success">{actionMessage}</div> : null}
      </div>

      <div className="streaming-results-shell">
        {searchStateMessage ? (
          <div className="streaming-results-empty">{searchStateMessage}</div>
        ) : activeTab === 'playlist' ? (
          <div className="streaming-playlist-panel">
            <form
              className="streaming-playlist-import"
              onSubmit={(event) => {
                event.preventDefault();
                void handleImportPlaylist();
              }}
            >
              <div className="streaming-playlist-import-copy">
                <span>
                  <Link size={18} />
                  添加流媒体歌单
                </span>
                <p>粘贴网易云音乐、QQ 音乐或酷狗音乐歌单链接，导入后会保存到本地播放列表，重开软件也不会消失。</p>
              </div>
              <label>
                <Link size={18} />
                <input
                  value={playlistUrl}
                  onChange={(event) => setPlaylistUrl(event.target.value)}
                  placeholder="粘贴歌单链接，例如 https://music.163.com/#/playlist?id=..."
                  disabled={isImportingPlaylist}
                />
              </label>
              <button type="submit" disabled={!playlistUrl.trim() || isImportingPlaylist}>
                {isImportingPlaylist ? <Loader2 className="spinning-icon" size={16} /> : <ListPlus size={16} />}
                <span>{isImportingPlaylist ? '正在添加' : '添加歌单'}</span>
              </button>
            </form>
            {playlists.length > 0 ? (
              <div className="streaming-discovery-list" aria-label="歌单搜索结果">
                {playlists.map(renderPlaylistCard)}
              </div>
            ) : null}
          </div>
        ) : activeTab === 'album' ? (
          <div className="streaming-discovery-list" aria-label="专辑搜索结果">
            {albums.map(renderAlbumCard)}
          </div>
        ) : activeTab === 'artist' ? (
          <div className="streaming-discovery-list" aria-label="歌手搜索结果">
            {artists.map(renderArtistCard)}
          </div>
        ) : (
          <div ref={listRef} className="streaming-results" aria-busy={isLoading}>
            <div className="streaming-virtual-spacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const track = tracks[virtualItem.index];
                const isPlaying = currentStableKey === track.stableKey;
                const isResolving = resolvingTrackKey === track.stableKey;
                const isQueued = queuedTrackKey === track.stableKey;
                const downloadJobId = downloadJobIdsByTrackKey[track.stableKey];
                const downloadJob = downloadJobId ? downloadJobs.find((job) => job.id === downloadJobId) : null;
                const isDownloading =
                  downloadingTrackKey === track.stableKey ||
                  downloadJob?.status === 'queued' ||
                  downloadJob?.status === 'probing' ||
                  downloadJob?.status === 'downloading' ||
                  downloadJob?.status === 'extracting_audio' ||
                  downloadJob?.status === 'importing' ||
                  downloadJob?.status === 'binding_mv';
                const disabled = !track.playable || Boolean(resolvingTrackKey);
                const downloadProgress = downloadJob ? Math.max(0, Math.min(100, downloadJob.progress)) : 0;
                const rawCoverSrc = track.coverThumb ?? defaultCover;
                const coverSrc = failedCoverUrls[track.stableKey] === rawCoverSrc ? defaultCover : rawCoverSrc;

                return (
                  <div
                    key={track.stableKey}
                    ref={virtualizer.measureElement}
                    className="streaming-virtual-row"
                    data-index={virtualItem.index}
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <article className="streaming-row" data-playing={isPlaying} data-unavailable={!track.playable} onDoubleClick={() => void handlePlay(track)}>
                      <div className="streaming-cover" data-empty={coverSrc === defaultCover}>
                        <img
                          src={coverSrc}
                          alt=""
                          decoding="async"
                          draggable={false}
                          height={56}
                          loading="lazy"
                          width={56}
                          onError={() => handleCoverError(track.stableKey, coverSrc)}
                        />
                      </div>
                      <div className="streaming-main">
                        <div className="streaming-title-line">
                          {isPlaying ? <span className="playing-dot" /> : null}
                          <strong>{track.title}</strong>
                          {isPlaying ? <em>正在播放</em> : null}
                        </div>
                        {renderTrackCredits(track)}
                        <small>{track.playable ? `${track.provider} · ${track.qualities.join(' / ') || 'standard'}` : (track.unavailableReason ?? '这首歌暂时不可播放')}</small>
                      </div>
                      <span className="streaming-duration">{formatDuration(track.duration)}</span>
                      <div className="streaming-actions" onDoubleClick={(event) => event.stopPropagation()}>
                        <button type="button" title="播放" onClick={() => void handlePlay(track)} disabled={disabled}>
                          {isResolving ? <Loader2 className="spinning-icon" size={16} /> : <Play size={16} />}
                        </button>
                        <button type="button" title="加入队列" onClick={() => handleAddToQueue(track)} disabled={!track.playable}>
                          {isQueued ? <Check size={16} /> : <ListPlus size={16} />}
                        </button>
                        {renderFavoriteButton(track)}
                        {streamingDownloadActionsEnabled && !unsupportedDownloadProviders.has(track.provider) ? (
                          <button type="button" title="下载" onClick={() => void handleDownload(track)} disabled={isDownloading}>
                            {isDownloading ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
                          </button>
                        ) : null}
                      </div>
                      {isResolving ? <div className="streaming-resolving">正在解析播放地址...</div> : null}
                      {downloadJob ? (
                        <div className="streaming-download-progress" data-status={downloadJob.status}>
                          <div
                            className="streaming-download-progress-track"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(downloadProgress)}
                            aria-label="下载进度"
                          >
                            <span style={{ width: `${downloadProgress}%` }} />
                          </div>
                          <small>
                            {downloadStatusLabels[downloadJob.status]} · {Math.round(downloadProgress)}%
                          </small>
                          {downloadJob.status === 'failed' && downloadJob.error ? <small>{downloadJob.error}</small> : null}
                        </div>
                      ) : null}
                    </article>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {activeTab !== 'playlist' && result?.hasMore ? (
        <button className="streaming-load-more" type="button" onClick={() => void runSearch((result.page ?? 1) + 1, 'append')} disabled={isLoading}>
          {isLoading ? '加载中...' : '加载更多'}
        </button>
      ) : null}
    </div>
  );
};
