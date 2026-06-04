import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { CalendarDays, Check, ChevronDown, Download, ExternalLink, FilePlus2, GripVertical, Heart, ImagePlus, Link, ListPlus, Loader2, MoreHorizontal, Music2, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, Share2, SlidersHorizontal, Trash2, Upload, WifiOff, X } from 'lucide-react';
import type { AppSettings } from '../../shared/types/appSettings';
import type { DownloadJob, DownloadJobStatus } from '../../shared/types/downloads';
import type { LibraryPage, LibraryPlaylist, LibraryPlaylistItem, LibraryTrack, PlaylistExportFormat, PlaylistSortMode } from '../../shared/types/library';
import type { StreamingAudioQuality, StreamingFavoriteCollection, StreamingFavoriteProviderName, StreamingFavoritesSnapshot, StreamingFavoriteTrack, StreamingProviderName } from '../../shared/types/streaming';
import { TrackList } from '../components/library/TrackList';
import { TrackContextMenu, type TrackMenuAction } from '../components/library/TrackContextMenu';
import { likedChangedEvent, likedTracksChangedEvent, useLikedTrackIds } from '../hooks/useLikedMedia';
import { useI18n } from '../i18n/I18nProvider';
import { readStreamingQualityPreference, writeStreamingQualityPreference } from '../preferences/streamingQualityPreference';
import { isPlaybackCancellationError, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { resolvePlaylistForTrackAdd } from '../utils/appPrompt';
import { getDownloadsBridge, getStreamingBridge } from '../utils/echoBridge';

const pageSize = 100;
const playlistSortOptions: Array<{ value: PlaylistSortMode; label: string }> = [
  { value: 'manual', label: '手动排序' },
  { value: 'addedDesc', label: '最近添加' },
  { value: 'titleAsc', label: '歌名 A-Z' },
  { value: 'titleDesc', label: '歌名 Z-A' },
  { value: 'artistAsc', label: '艺术家 A-Z' },
];
const playlistExportOptions: Array<{ value: PlaylistExportFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'txt', label: 'TXT' },
  { value: 'm3u8', label: 'M3U8' },
  { value: 'csv', label: 'CSV' },
];
const streamingQualityOptions: Array<{ value: StreamingAudioQuality; label: string }> = [
  { value: 'lossless', label: 'Lossless' },
  { value: 'high', label: 'High' },
  { value: 'standard', label: 'Standard' },
  { value: 'hires', label: 'Hi-Res' },
];
const streamingFavoriteProviders: Array<{ value: StreamingFavoriteProviderName; label: string }> = [
  { value: 'bilibili', label: 'Bilibili' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'soundcloud', label: 'SoundCloud' },
];
const emptyStreamingFavoritesSnapshot = (): StreamingFavoritesSnapshot => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  providers: {
    bilibili: [],
    youtube: [],
    soundcloud: [],
  },
  collections: [],
});
const neteaseDailyRecommendSourcePlaylistId = 'daily-recommend';
const playlistItemDragMime = 'application/x-echo-playlist-item-id';
const playlistListDragMime = 'application/x-echo-playlist-id';
const favoriteListDragMime = 'application/x-echo-favorite-list-id';
const playlistListOrderMemoryKey = 'echo-next.playlist-list-order.v1';
const favoriteListOrderMemoryKey = 'echo-next.streaming-favorite-list-order.v1';
const runningDownloadStatuses = new Set<DownloadJobStatus>(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);
const failedDownloadStatuses = new Set<DownloadJobStatus>(['failed', 'cancelled']);
const qualitySwitchPlaybackStates = new Set(['loading', 'playing']);
const playlistSourceProviderLabels: Record<Exclude<LibraryPlaylist['sourceProvider'], 'local'>, string> = {
  netease: '网易云',
  qqmusic: 'QQ',
  kugou: '酷狗',
  spotify: 'Spotify',
  remote: '远程',
  m3u8: 'M3U8',
};
const spotifyPlaylistOwnerImportMessage =
  'Spotify 限制了非创建者/协作者歌单的曲目读取。请在系统浏览器打开这个歌单，在 Spotify 里复制到你的账号后，再粘贴新歌单链接导入。';

type PlaylistDownloadSession = {
  runId: number;
  playlistId: string;
  playlistName: string;
  total: number;
  enqueued: number;
  failedToQueue: number;
  jobIds: string[];
  active: boolean;
};

type CreateTrackDownloadOptions = {
  outputSubdirectory?: string | null;
};

type PlaylistDownloadMemory = {
  session: PlaylistDownloadSession | null;
  downloadJobIdsByTrackId: Record<string, string>;
};

type StreamingFavoriteListEntry =
  | { type: 'provider'; id: string; provider: StreamingFavoriteProviderName; label: string; count: number }
  | { type: 'collection'; id: string; collection: StreamingFavoriteCollection; providerLabel: string; count: number };

const yieldToUi = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));
const playlistDownloadMemoryKey = 'echo-next.playlist-download-session.v1';

const emptyPlaylistDownloadMemory = (): PlaylistDownloadMemory => ({
  session: null,
  downloadJobIdsByTrackId: {},
});

const readPlaylistDownloadMemory = (): PlaylistDownloadMemory => {
  try {
    const raw = window.localStorage.getItem(playlistDownloadMemoryKey);
    if (!raw) {
      return emptyPlaylistDownloadMemory();
    }

    const parsed = JSON.parse(raw) as PlaylistDownloadMemory;
    const session = parsed.session;
    const downloadJobIdsByTrackId =
      parsed.downloadJobIdsByTrackId && typeof parsed.downloadJobIdsByTrackId === 'object' ? parsed.downloadJobIdsByTrackId : {};
    const jobIds = Array.isArray(session?.jobIds) ? session.jobIds.filter((jobId): jobId is string => typeof jobId === 'string') : [];
    const sessionEnqueued = session?.enqueued;
    const sessionFailedToQueue = session?.failedToQueue;
    const sessionTotal = session?.total;
    const enqueued = typeof sessionEnqueued === 'number' && Number.isFinite(sessionEnqueued) ? sessionEnqueued : jobIds.length;
    const failedToQueue =
      typeof sessionFailedToQueue === 'number' && Number.isFinite(sessionFailedToQueue) ? sessionFailedToQueue : 0;
    const queuedTotal = Math.max(jobIds.length + failedToQueue, enqueued + failedToQueue);
    const storedTotal = typeof sessionTotal === 'number' && Number.isFinite(sessionTotal) ? sessionTotal : queuedTotal;
    return {
      session:
        session &&
        typeof session.playlistId === 'string' &&
        typeof session.playlistName === 'string' &&
        Array.isArray(session.jobIds)
          ? {
              runId: Number.isFinite(session.runId) ? session.runId : 0,
              playlistId: session.playlistId,
              playlistName: session.playlistName,
              total: session.active ? queuedTotal : storedTotal,
              enqueued,
              failedToQueue,
              jobIds,
              active: false,
            }
          : null,
      downloadJobIdsByTrackId,
    };
  } catch {
    return emptyPlaylistDownloadMemory();
  }
};

const writePlaylistDownloadMemory = (memory: PlaylistDownloadMemory): void => {
  try {
    window.localStorage.setItem(playlistDownloadMemoryKey, JSON.stringify(memory));
  } catch {
    // The download service is the source of truth; this only keeps the playlist page UI warm across navigation.
  }
};

const uniquePlaylistIds = (ids: unknown): string[] => {
  if (!Array.isArray(ids)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
};

const readPlaylistListOrderMemory = (): string[] => {
  try {
    const raw = window.localStorage.getItem(playlistListOrderMemoryKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { orderedIds?: unknown } | unknown[];
    return Array.isArray(parsed) ? uniquePlaylistIds(parsed) : uniquePlaylistIds(parsed.orderedIds);
  } catch {
    return [];
  }
};

const writePlaylistListOrderMemory = (orderedIds: string[]): void => {
  try {
    window.localStorage.setItem(
      playlistListOrderMemoryKey,
      JSON.stringify({
        version: 1,
        orderedIds: uniquePlaylistIds(orderedIds),
      }),
    );
  } catch {
    // Playlist order memory is a UI convenience; database order remains the fallback.
  }
};

const orderPlaylists = (items: LibraryPlaylist[], orderedIds: string[]): LibraryPlaylist[] => {
  if (items.length <= 1 || orderedIds.length === 0) {
    return items;
  }

  const orderById = new Map(orderedIds.map((id, index) => [id, index] as const));
  return [...items].sort((left, right) => {
    const leftOrder = orderById.get(left.id);
    const rightOrder = orderById.get(right.id);
    if (leftOrder === undefined && rightOrder === undefined) {
      return 0;
    }
    if (leftOrder === undefined) {
      return 1;
    }
    if (rightOrder === undefined) {
      return -1;
    }
    return leftOrder - rightOrder;
  });
};

const movePlaylistId = (items: LibraryPlaylist[], sourceId: string, targetId: string): string[] | null => {
  const fromIndex = items.findIndex((playlist) => playlist.id === sourceId);
  const toIndex = items.findIndex((playlist) => playlist.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return null;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) {
    return null;
  }

  nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, movedItem);
  return nextItems.map((playlist) => playlist.id);
};

const readFavoriteListOrderMemory = (): string[] => {
  try {
    const raw = window.localStorage.getItem(favoriteListOrderMemoryKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { orderedIds?: unknown } | unknown[];
    return Array.isArray(parsed) ? uniquePlaylistIds(parsed) : uniquePlaylistIds(parsed.orderedIds);
  } catch {
    return [];
  }
};

const writeFavoriteListOrderMemory = (orderedIds: string[]): void => {
  try {
    window.localStorage.setItem(
      favoriteListOrderMemoryKey,
      JSON.stringify({
        version: 1,
        orderedIds: uniquePlaylistIds(orderedIds),
      }),
    );
  } catch {
    // Favorite list order memory is only a sidebar preference.
  }
};

const orderFavoriteListEntries = (items: StreamingFavoriteListEntry[], orderedIds: string[]): StreamingFavoriteListEntry[] => {
  if (items.length <= 1 || orderedIds.length === 0) {
    return items;
  }

  const orderById = new Map(orderedIds.map((id, index) => [id, index] as const));
  return [...items].sort((left, right) => {
    const leftOrder = orderById.get(left.id);
    const rightOrder = orderById.get(right.id);
    if (leftOrder === undefined && rightOrder === undefined) {
      return 0;
    }
    if (leftOrder === undefined) {
      return 1;
    }
    if (rightOrder === undefined) {
      return -1;
    }
    return leftOrder - rightOrder;
  });
};

const moveFavoriteListEntryId = (items: StreamingFavoriteListEntry[], sourceId: string, targetId: string): string[] | null => {
  const fromIndex = items.findIndex((item) => item.id === sourceId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return null;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) {
    return null;
  }

  nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, movedItem);
  return nextItems.map((item) => item.id);
};

const isLikedStreamingProvider = (provider: string | null | undefined): provider is Extract<StreamingProviderName, 'netease' | 'qqmusic'> =>
  provider === 'netease' || provider === 'qqmusic';

const isSpotifyPlaylistUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && /^\/playlist\/[A-Za-z0-9]+/u.test(url.pathname);
  } catch {
    return /^spotify:playlist:[A-Za-z0-9]+$/iu.test(value.trim());
  }
};

const isSpotifyPlaylistOwnerImportError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Spotify only allows this playlist's owner or collaborators to read its track list/iu.test(message);
};

const playlistSourceProviderLabel = (playlist: LibraryPlaylist): string | null =>
  playlist.sourceProvider === 'local' ? null : (playlistSourceProviderLabels[playlist.sourceProvider] ?? '网络');

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

const streamingPlaylistUrl = (playlist: LibraryPlaylist): string | null => {
  if (!playlist.sourcePlaylistId) {
    return null;
  }

  if (playlist.sourceProvider === 'netease' && playlist.sourcePlaylistId === neteaseDailyRecommendSourcePlaylistId) {
    return null;
  }

  if (playlist.sourceProvider === 'netease') {
    return `https://music.163.com/#/playlist?id=${encodeURIComponent(playlist.sourcePlaylistId)}`;
  }

  if (playlist.sourceProvider === 'qqmusic') {
    return `https://y.qq.com/n/ryqq/playlist/${encodeURIComponent(playlist.sourcePlaylistId)}`;
  }

  if (playlist.sourceProvider === 'kugou') {
    return `https://www.kugou.com/yy/special/single/${encodeURIComponent(playlist.sourcePlaylistId)}.html`;
  }

  if (playlist.sourceProvider === 'spotify') {
    return `https://open.spotify.com/playlist/${encodeURIComponent(playlist.sourcePlaylistId)}`;
  }

  return null;
};

const streamingFavoriteCollectionUrl = (collection: StreamingFavoriteCollection): string | null => {
  const providerPlaylistId = collection.providerPlaylistId.trim();
  if (!providerPlaylistId) {
    return null;
  }

  if (isHttpUrl(providerPlaylistId)) {
    return providerPlaylistId;
  }

  if (collection.provider === 'youtube') {
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(providerPlaylistId)}`;
  }

  if (collection.provider === 'bilibili') {
    return `https://www.bilibili.com/medialist/detail/ml${encodeURIComponent(providerPlaylistId)}`;
  }

  return null;
};

const streamingTrackWebUrl = (track: LibraryTrack): string | null => {
  if (!track.providerTrackId) {
    return null;
  }

  if (track.provider === 'netease') {
    return `https://music.163.com/#/song?id=${encodeURIComponent(track.providerTrackId)}`;
  }

  if (track.provider === 'qqmusic') {
    return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(track.providerTrackId)}`;
  }

  if (track.provider === 'kugou') {
    return `https://www.kugou.com/song/#hash=${encodeURIComponent(track.providerTrackId.split('.')[0] ?? track.providerTrackId)}`;
  }

  if (track.provider === 'spotify') {
    return `https://open.spotify.com/track/${encodeURIComponent(track.providerTrackId)}`;
  }

  return null;
};

const streamingProviderFromTrack = (track: LibraryTrack): StreamingProviderName | null =>
  track.provider === 'netease' ||
  track.provider === 'qqmusic' ||
  track.provider === 'kugou' ||
  track.provider === 'mock' ||
  track.provider === 'bilibili' ||
  track.provider === 'spotify'
    ? track.provider
    : null;

const defaultFavoriteSelectionId = 'provider:youtube';
const favoriteProviderSelectionId = (provider: StreamingFavoriteProviderName): string => `provider:${provider}`;
const favoriteCollectionSelectionId = (collectionId: string): string => `collection:${collectionId}`;
const favoriteProviderFromSelectionId = (selectionId: string): StreamingFavoriteProviderName =>
  streamingFavoriteProviders.find((item) => favoriteProviderSelectionId(item.value) === selectionId)?.value ?? 'youtube';
const playlistTrackMenuActions: readonly TrackMenuAction[] = [
  'add-to-playlist',
  'play-next',
  'add-to-queue',
  'toggle-liked',
  'remove-from-queue',
  'remove-from-playlist',
  'reload-embedded-tags',
  'clear-lyrics-cache',
  'show-in-folder',
  'copy-path',
  'open-system',
];

const emptyItemsPage = (): LibraryPage<LibraryPlaylistItem> => ({
  items: [],
  page: 1,
  pageSize,
  total: 0,
  hasMore: false,
});

const itemToTrack = (item: LibraryPlaylistItem, streamingQuality?: StreamingAudioQuality): LibraryTrack => {
  if (item.mediaType === 'stream_track' && item.mediaId && item.sourceItemId && !item.unavailable) {
    const cachedTrack = item.track ?? null;
    return {
      id: item.mediaId,
      mediaType: 'streaming',
      path: item.mediaId,
      provider: item.sourceProvider,
      providerTrackId: item.sourceItemId,
      streamingQuality: cachedTrack?.streamingQuality ?? streamingQuality,
      stableKey: cachedTrack?.stableKey ?? item.mediaId,
      title: cachedTrack?.title ?? item.titleSnapshot ?? 'Streaming track',
      artist: cachedTrack?.artist ?? item.artistSnapshot ?? 'Unknown artist',
      album: cachedTrack?.album ?? item.albumSnapshot ?? '',
      albumArtist: cachedTrack?.albumArtist ?? item.artistSnapshot ?? '',
      trackNo: cachedTrack?.trackNo ?? null,
      discNo: cachedTrack?.discNo ?? null,
      year: cachedTrack?.year ?? null,
      genre: cachedTrack?.genre ?? null,
      duration: cachedTrack?.duration ?? item.durationSnapshot ?? 0,
      codec: cachedTrack?.codec ?? null,
      sampleRate: cachedTrack?.sampleRate ?? null,
      bitDepth: cachedTrack?.bitDepth ?? null,
      bitrate: cachedTrack?.bitrate ?? null,
      coverId: cachedTrack?.coverId ?? item.coverId,
      coverThumb: cachedTrack?.coverThumb ?? item.coverThumb,
      fieldSources: {
        title: item.sourceProvider,
        artist: item.sourceProvider,
        album: item.sourceProvider,
      },
      playlistItemId: item.id,
      unavailable: false,
    };
  }

  if (item.track && !item.unavailable) {
    return {
      ...item.track,
      streamingQuality: item.track.mediaType === 'streaming' ? (item.track.streamingQuality ?? streamingQuality) : item.track.streamingQuality,
      playlistItemId: item.id,
      unavailable: false,
    };
  }

  return {
    id: item.mediaId ?? item.id,
    path: '',
    title: item.titleSnapshot ?? 'Unavailable track',
    artist: item.artistSnapshot ?? 'Unknown artist',
    album: item.albumSnapshot ?? '',
    albumArtist: item.artistSnapshot ?? '',
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: item.durationSnapshot ?? 0,
    codec: null,
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: item.coverId,
    coverThumb: item.coverThumb,
    fieldSources: {},
    playlistItemId: item.id,
    unavailable: true,
  };
};

const favoriteToTrack = (item: StreamingFavoriteTrack, streamingQuality: StreamingAudioQuality): LibraryTrack => ({
  id: item.stableKey,
  mediaType: 'streaming',
  path: item.stableKey,
  provider: item.provider,
  providerTrackId: item.providerTrackId,
  streamingQuality,
  stableKey: item.stableKey,
  title: item.title,
  artist: item.artist,
  album: item.album,
  albumArtist: item.albumArtist ?? item.artist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: item.duration ?? 0,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: item.coverThumb ?? item.coverUrl,
  fieldSources: {
    title: item.provider,
    artist: item.provider,
    album: item.provider,
  },
  unavailable: !item.playable,
});

const playableTailFromTrack = (tracks: LibraryTrack[], track: LibraryTrack): LibraryTrack[] => {
  const startIndex = tracks.findIndex((candidate) =>
    (track.playlistItemId && candidate.playlistItemId === track.playlistItemId) || candidate.id === track.id,
  );
  const tail = (startIndex >= 0 ? tracks.slice(startIndex) : tracks).filter((candidate) => !candidate.unavailable);
  return tail.length > 0 ? tail : track.unavailable ? [] : [track];
};

export const PlaylistsPage = (): JSX.Element => {
  const { t } = useI18n();
  const [playlistPanelView, setPlaylistPanelView] = useState<'local' | 'streamingFavorites'>('local');
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [playlistOrderIds, setPlaylistOrderIds] = useState<string[]>(() => readPlaylistListOrderMemory());
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [streamingFavorites, setStreamingFavorites] = useState<StreamingFavoritesSnapshot>(() => emptyStreamingFavoritesSnapshot());
  const [favoriteListOrderIds, setFavoriteListOrderIds] = useState<string[]>(() => readFavoriteListOrderMemory());
  const [selectedFavoriteListId, setSelectedFavoriteListId] = useState<string>(defaultFavoriteSelectionId);
  const [itemsPage, setItemsPage] = useState<LibraryPage<LibraryPlaylistItem>>(emptyItemsPage());
  const [isLoading, setIsLoading] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistSearchInput, setPlaylistSearchInput] = useState('');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylistForm, setShowNewPlaylistForm] = useState(false);
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);
  const [favoriteImportUrl, setFavoriteImportUrl] = useState('');
  const [isImportingFavorites, setIsImportingFavorites] = useState(false);
  const [isExportingFavorites, setIsExportingFavorites] = useState(false);
  const [syncingFavoriteCollectionId, setSyncingFavoriteCollectionId] = useState<string | null>(null);
  const [deletingFavoriteCollectionId, setDeletingFavoriteCollectionId] = useState<string | null>(null);
  const [isImportingPlaylistFile, setIsImportingPlaylistFile] = useState(false);
  const [isAddingLocalFiles, setIsAddingLocalFiles] = useState(false);
  const [isRefreshingStreamingPlaylist, setIsRefreshingStreamingPlaylist] = useState(false);
  const [downloadsFeatureUnlocked, setDownloadsFeatureUnlocked] = useState(false);
  const [downloadingTrackId, setDownloadingTrackId] = useState<string | null>(null);
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [downloadJobIdsByTrackId, setDownloadJobIdsByTrackId] = useState<Record<string, string>>(() => readPlaylistDownloadMemory().downloadJobIdsByTrackId);
  const [playlistDownloadSession, setPlaylistDownloadSession] = useState<PlaylistDownloadSession | null>(() => readPlaylistDownloadMemory().session);
  const [streamingQuality, setStreamingQuality] = useState<StreamingAudioQuality>(() => readStreamingQualityPreference());
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spotifyPlaylistHelpUrl, setSpotifyPlaylistHelpUrl] = useState<string | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ track: LibraryTrack; position: { x: number; y: number } } | null>(null);
  const [draggedPlaylistId, setDraggedPlaylistId] = useState<string | null>(null);
  const [dropTargetPlaylistId, setDropTargetPlaylistId] = useState<string | null>(null);
  const [draggedFavoriteListId, setDraggedFavoriteListId] = useState<string | null>(null);
  const [dropTargetFavoriteListId, setDropTargetFavoriteListId] = useState<string | null>(null);
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<string | null>(null);
  const [dropTargetPlaylistItemId, setDropTargetPlaylistItemId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const playlistDownloadRunIdRef = useRef(0);
  const notifiedDownloadJobIdsRef = useRef<Set<string>>(new Set());
  const newPlaylistInputRef = useRef<HTMLInputElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const playlistMenuRef = useRef<HTMLDivElement | null>(null);
  const { currentTrack, currentTrackId, playlistPlayback, playPlaylistSequence, exitPlaylistSequence, playTrack, appendToQueue, appendTracksToQueue, playTrackNext, removeTrackFromQueue } = usePlaybackQueue();
  const orderedPlaylists = useMemo(() => orderPlaylists(playlists, playlistOrderIds), [playlistOrderIds, playlists]);
  const favoriteListEntries = useMemo<StreamingFavoriteListEntry[]>(() => {
    const providerEntries = streamingFavoriteProviders.map((providerItem) => ({
      type: 'provider' as const,
      id: favoriteProviderSelectionId(providerItem.value),
      provider: providerItem.value,
      label: providerItem.label,
      count: streamingFavorites.providers[providerItem.value]?.length ?? 0,
    }));
    const collectionEntries = (streamingFavorites.collections ?? []).map((collection) => ({
      type: 'collection' as const,
      id: favoriteCollectionSelectionId(collection.id),
      collection,
      providerLabel: streamingFavoriteProviders.find((item) => item.value === collection.provider)?.label ?? collection.provider,
      count: collection.tracks.length,
    }));
    return [...providerEntries, ...collectionEntries];
  }, [streamingFavorites]);
  const orderedFavoriteListEntries = useMemo(
    () => orderFavoriteListEntries(favoriteListEntries, favoriteListOrderIds),
    [favoriteListEntries, favoriteListOrderIds],
  );
  const selectedPlaylist = useMemo(
    () => orderedPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? orderedPlaylists[0] ?? null,
    [orderedPlaylists, selectedPlaylistId],
  );
  const canReorderPlaylistList = playlistPanelView === 'local' && orderedPlaylists.length > 1;
  const canReorderFavoriteList = playlistPanelView === 'streamingFavorites' && orderedFavoriteListEntries.length > 1;
  const isSelectedPlaylistNeteaseDailyRecommend =
    selectedPlaylist?.sourceProvider === 'netease' && selectedPlaylist.sourcePlaylistId === neteaseDailyRecommendSourcePlaylistId;
  const isSelectedPlaylistProtected = selectedPlaylist?.kind === 'system';
  const isSelectedPlaylistRemote = Boolean(selectedPlaylist && selectedPlaylist.sourceProvider !== 'local');
  const canReorderSelectedPlaylist =
    Boolean(selectedPlaylist) &&
    !isSelectedPlaylistProtected &&
    !isSelectedPlaylistRemote &&
    selectedPlaylist?.sortMode === 'manual' &&
    playlistSearch.length === 0 &&
    playlistSearchInput.trim().length === 0;
  const selectedStreamingPlaylistUrl = selectedPlaylist ? streamingPlaylistUrl(selectedPlaylist) : null;
  const currentStreamingQuality = streamingQualityOptions.find((option) => option.value === streamingQuality) ?? streamingQualityOptions[0];
  const canDownloadSelectedPlaylist =
    downloadsFeatureUnlocked &&
    (selectedPlaylist?.sourceProvider === 'netease' || selectedPlaylist?.sourceProvider === 'qqmusic' || selectedPlaylist?.sourceProvider === 'kugou');
  const isSelectedPlaylistPlaybackActive =
    playlistPlayback.active && Boolean(selectedPlaylist) && playlistPlayback.playlistId === selectedPlaylist?.id;
  const displayTracks = useMemo(
    () => itemsPage.items.map((item) => itemToTrack(item, isSelectedPlaylistRemote ? streamingQuality : undefined)),
    [isSelectedPlaylistRemote, itemsPage.items, streamingQuality],
  );
  const selectedFavoriteCollection = useMemo(
    () =>
      (streamingFavorites.collections ?? []).find((collection) => favoriteCollectionSelectionId(collection.id) === selectedFavoriteListId) ?? null,
    [selectedFavoriteListId, streamingFavorites.collections],
  );
  const selectedFavoriteShareUrl = selectedFavoriteCollection ? streamingFavoriteCollectionUrl(selectedFavoriteCollection) : null;
  const selectedFavoriteProvider = selectedFavoriteCollection?.provider ?? favoriteProviderFromSelectionId(selectedFavoriteListId);
  const selectedFavoriteProviderLabel = streamingFavoriteProviders.find((item) => item.value === selectedFavoriteProvider)?.label ?? selectedFavoriteProvider;
  const selectedFavoriteListName = selectedFavoriteCollection?.name ?? `${selectedFavoriteProviderLabel} 收藏`;
  const favoriteItems = selectedFavoriteCollection?.tracks ?? streamingFavorites.providers[selectedFavoriteProvider] ?? [];
  const favoriteDisplayTracks = useMemo(
    () => favoriteItems.map((item) => favoriteToTrack(item, streamingQuality)),
    [favoriteItems, streamingQuality],
  );
  const activeDisplayTracks = playlistPanelView === 'streamingFavorites' ? favoriteDisplayTracks : displayTracks;
  const playableTracks = useMemo(() => activeDisplayTracks.filter((track) => !track.unavailable), [activeDisplayTracks]);
  const localPlayableTracks = useMemo(() => displayTracks.filter((track) => !track.unavailable), [displayTracks]);
  const favoriteLikedTrackIds = useMemo(
    () => Object.fromEntries(favoriteDisplayTracks.map((track) => [track.id, true])),
    [favoriteDisplayTracks],
  );
  const likedTrackIds = useLikedTrackIds(playlistPanelView === 'streamingFavorites' ? [] : localPlayableTracks.map((track) => track.id));
  const visibleLikedTrackIds = playlistPanelView === 'streamingFavorites' ? favoriteLikedTrackIds : likedTrackIds;
  const downloadingTrackIds = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const track of displayTracks) {
      const jobId = downloadJobIdsByTrackId[track.id];
      const job = jobId ? downloadJobs.find((item) => item.id === jobId) : null;
      result[track.id] = downloadingTrackId === track.id || (job ? runningDownloadStatuses.has(job.status) : false);
    }
    return result;
  }, [displayTracks, downloadJobIdsByTrackId, downloadJobs, downloadingTrackId]);
  const downloadProgressByTrackId = useMemo(() => {
    const result: Record<string, number> = {};
    for (const track of displayTracks) {
      const jobId = downloadJobIdsByTrackId[track.id];
      const job = jobId ? downloadJobs.find((item) => item.id === jobId) : null;
      if (downloadingTrackId === track.id && !job) {
        result[track.id] = 0;
      } else if (job) {
        result[track.id] = Math.max(0, Math.min(100, job.progress));
      }
    }
    return result;
  }, [displayTracks, downloadJobIdsByTrackId, downloadJobs, downloadingTrackId]);
  const playlistDownloadSummary = useMemo(() => {
    if (!playlistDownloadSession || playlistDownloadSession.playlistId !== selectedPlaylist?.id) {
      return null;
    }

    const jobsById = new Map(downloadJobs.map((job) => [job.id, job]));
    const sessionJobs = playlistDownloadSession.jobIds.map((jobId) => jobsById.get(jobId)).filter((job): job is DownloadJob => Boolean(job));
    if (!playlistDownloadSession.active && sessionJobs.length === 0) {
      return null;
    }

    const completed = sessionJobs.filter((job) => job.status === 'completed').length;
    const failed = sessionJobs.filter((job) => failedDownloadStatuses.has(job.status)).length + playlistDownloadSession.failedToQueue;
    const running = sessionJobs.some((job) => runningDownloadStatuses.has(job.status));
    const progressTotal = sessionJobs.reduce((total, job) => total + Math.max(0, Math.min(100, job.progress)), playlistDownloadSession.failedToQueue * 100);
    const total = Math.max(playlistDownloadSession.total, 1);
    const progress = Math.max(0, Math.min(100, Math.round(progressTotal / total)));
    const finished = completed + failed;
    const hasKnownWork = sessionJobs.length > 0 || failed > 0;
    const isActive = playlistDownloadSession.active || running || (hasKnownWork && finished < playlistDownloadSession.total);

    return {
      completed,
      enqueued: playlistDownloadSession.enqueued,
      failed,
      finished,
      isActive,
      playlistName: playlistDownloadSession.playlistName,
      progress,
      total: playlistDownloadSession.total,
    };
  }, [downloadJobs, playlistDownloadSession, selectedPlaylist?.id]);
  const queueSource = useMemo(
    () => ({
      type: 'manual' as const,
      label: playlistPanelView === 'streamingFavorites'
        ? `Streaming Favorites: ${selectedFavoriteListName}`
        : selectedPlaylist ? `Playlist: ${selectedPlaylist.name}` : 'Playlist',
    }),
    [playlistPanelView, selectedFavoriteListName, selectedPlaylist],
  );

  const handleStreamingQualityChange = useCallback(
    (nextQuality: StreamingAudioQuality): void => {
      writeStreamingQualityPreference(nextQuality);
      setStreamingQuality(nextQuality);
      setQualityMenuOpen(false);

      if (
        !currentTrack ||
        currentTrack.mediaType !== 'streaming' ||
        currentTrack.provider !== (playlistPanelView === 'streamingFavorites' ? selectedFavoriteProvider : selectedPlaylist?.sourceProvider) ||
        currentTrack.streamingQuality === nextQuality
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

        await playTrack(
          { ...currentTrack, streamingQuality: nextQuality },
          {
            source: queueSource,
            startSeconds: Math.max(0, status.positionMs / 1000),
            forceRefresh: true,
            preservePlaylistPlayback: true,
          },
        );
        setError(null);
        setStatusMessage(`已切换音质：${streamingQualityOptions.find((option) => option.value === nextQuality)?.label ?? nextQuality}`);
      })().catch((qualityError) => {
        if (isPlaybackCancellationError(qualityError)) {
          return;
        }

        setError(qualityError instanceof Error ? qualityError.message : '切换音质失败');
        setStatusMessage(null);
      });
    },
    [currentTrack, playTrack, playlistPanelView, queueSource, selectedFavoriteProvider, selectedPlaylist?.sourceProvider],
  );

  const loadPlaylists = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.');
      return;
    }

    try {
      const result = await library.getPlaylists();
      setPlaylists(result);
      setSelectedPlaylistId((current) => current ?? orderPlaylists(result, readPlaylistListOrderMemory())[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  const loadItems = useCallback(async (playlistId: string, nextPage = 1, mode: 'replace' | 'append' = 'replace', searchText = playlistSearch): Promise<void> => {
    const library = window.echo?.library;
    if (!library) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const result = await library.getPlaylistItems(playlistId, { page: nextPage, pageSize, search: searchText });
      if (requestIdRef.current !== requestId) {
        return;
      }

      setItemsPage((current) => (mode === 'append' ? { ...result, items: [...current.items, ...result.items] } : result));
    } catch (loadError) {
      if (requestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [playlistSearch]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'downloadsFeatureUnlocked')) {
        return;
      }

      setDownloadsFeatureUnlocked(settings.downloadsFeatureUnlocked === true);
    };

    const refreshSettings = (): void => {
      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applySettings(settings);
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        applySettings(event.detail as Partial<AppSettings> | null | undefined);
        return;
      }

      if (!cancelled) {
        refreshSettings();
      }
    };

    refreshSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    const handleChanged = (): void => {
      void loadPlaylists();
    };

    window.addEventListener('library:playlists-changed', handleChanged);
    return () => window.removeEventListener('library:playlists-changed', handleChanged);
  }, [loadPlaylists]);

  useEffect(() => {
    const streaming = getStreamingBridge();
    const refreshFavorites = (): void => {
      void streaming?.getFavorites?.()
        .then((snapshot) => setStreamingFavorites(snapshot))
        .catch(() => undefined);
    };
    const handleFavoritesChanged = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail) {
        setStreamingFavorites(event.detail as StreamingFavoritesSnapshot);
        return;
      }

      refreshFavorites();
    };

    refreshFavorites();
    window.addEventListener('streaming:favorites-changed', handleFavoritesChanged);
    return () => window.removeEventListener('streaming:favorites-changed', handleFavoritesChanged);
  }, []);

  useEffect(() => {
    if (!selectedFavoriteListId.startsWith('collection:')) {
      return;
    }

    if (!(streamingFavorites.collections ?? []).some((collection) => favoriteCollectionSelectionId(collection.id) === selectedFavoriteListId)) {
      setSelectedFavoriteListId(defaultFavoriteSelectionId);
    }
  }, [selectedFavoriteListId, streamingFavorites.collections]);

  useEffect(() => {
    if (selectedPlaylist) {
      void loadItems(selectedPlaylist.id);
    } else {
      setItemsPage(emptyItemsPage());
    }
  }, [loadItems, selectedPlaylist]);

  useEffect(() => {
    setDraggedPlaylistItemId(null);
    setDropTargetPlaylistItemId(null);
  }, [selectedPlaylist?.id, playlistSearch]);

  useEffect(() => {
    const downloads = getDownloadsBridge();
    if (!downloads) {
      return undefined;
    }

    void downloads.getJobs?.()
      .then((nextJobs) => setDownloadJobs(nextJobs))
      .catch(() => undefined);

    if (!downloads.onJobsUpdated) {
      return undefined;
    }

    return downloads.onJobsUpdated((nextJobs) => {
      setDownloadJobs(nextJobs);
      const trackedEntries = Object.entries(downloadJobIdsByTrackId);
      for (const job of nextJobs) {
        if (job.status !== 'completed' || notifiedDownloadJobIdsRef.current.has(job.id)) {
          continue;
        }

        const matchedTrackId = trackedEntries.find(([, jobId]) => jobId === job.id)?.[0];
        if (matchedTrackId) {
          notifiedDownloadJobIdsRef.current.add(job.id);
          const matchedTrack = displayTracks.find((track) => track.id === matchedTrackId);
          setError(null);
          setStatusMessage(`下载完成：${job.title ?? matchedTrack?.title ?? job.sourceUrl}`);
          break;
        }
      }
    });
  }, [displayTracks, downloadJobIdsByTrackId]);

  useEffect(() => {
    writePlaylistDownloadMemory({
      session: playlistDownloadSession,
      downloadJobIdsByTrackId,
    });
  }, [downloadJobIdsByTrackId, playlistDownloadSession]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPlaylistSearch(playlistSearchInput.trim());
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [playlistSearchInput]);

  useEffect(() => {
    if (showNewPlaylistForm) {
      window.setTimeout(() => newPlaylistInputRef.current?.focus(), 0);
    }
  }, [showNewPlaylistForm]);

  useEffect(() => {
    if (!qualityMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!qualityMenuRef.current?.contains(event.target as Node)) {
        setQualityMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setQualityMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [qualityMenuOpen]);

  useEffect(() => {
    if (!playlistMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!playlistMenuRef.current?.contains(event.target as Node)) {
        setPlaylistMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPlaylistMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playlistMenuOpen]);

  const refreshSelected = useCallback(async (): Promise<void> => {
    await loadPlaylists();
    if (selectedPlaylist) {
      await loadItems(selectedPlaylist.id);
    }
  }, [loadItems, loadPlaylists, selectedPlaylist]);

  const handleRefreshStreamingPlaylist = async (): Promise<void> => {
    if (isSelectedPlaylistNeteaseDailyRecommend) {
      await handleRefreshNeteaseDailyRecommend();
      return;
    }

    const streaming = window.echo?.streaming;
    if (!streaming?.importPlaylistFromUrl || !selectedPlaylist || !selectedStreamingPlaylistUrl) {
      await refreshSelected();
      return;
    }

    setIsRefreshingStreamingPlaylist(true);
    setError(null);
    setStatusMessage('正在刷新网络歌单...');
    try {
      const result = await streaming.importPlaylistFromUrl(selectedStreamingPlaylistUrl);
      await loadPlaylists();
      setSelectedPlaylistId(result.playlistId);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(result.playlistId, 1, 'replace', '');
      setStatusMessage(`已刷新歌单：${result.playlistName}，共 ${result.importedCount} 首`);
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      setStatusMessage(null);
    } finally {
      setIsRefreshingStreamingPlaylist(false);
    }
  };

  const handleRefreshNeteaseDailyRecommend = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    if (!streaming?.refreshNeteaseDailyRecommend) {
      setError(t('playlistsPage.error.desktopBridgeDailyRecommend'));
      return;
    }

    setIsRefreshingStreamingPlaylist(true);
    setError(null);
    setStatusMessage(t('playlistsPage.status.refreshingDaily'));
    try {
      const result = await streaming.refreshNeteaseDailyRecommend();
      await loadPlaylists();
      setSelectedPlaylistId(result.playlistId);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(result.playlistId, 1, 'replace', '');
      setStatusMessage(t('playlistsPage.status.refreshedDaily', { count: result.importedCount }));
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      setStatusMessage(null);
    } finally {
      setIsRefreshingStreamingPlaylist(false);
    }
  };

  const handleCreatePlaylist = async (nameInput?: string): Promise<void> => {
    const library = window.echo?.library;
    const name = nameInput ?? window.prompt(t('playlistsPage.prompt.newLocalName'));
    if (!library || !name?.trim()) {
      return;
    }

    try {
      const playlist = await library.createPlaylist({ name });
      await loadPlaylists();
      setSelectedPlaylistId(playlist.id);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      setNewPlaylistName('');
      setShowNewPlaylistForm(false);
      setStatusMessage(t('playlistsPage.status.createdLocal'));
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const handleShowNewPlaylistForm = (): void => {
    setShowNewPlaylistForm(true);
  };

  const handleDeletePlaylist = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library || !selectedPlaylist || !window.confirm(`删除歌单 "${selectedPlaylist.name}"?`)) {
      return;
    }

    try {
      await library.deletePlaylist(selectedPlaylist.id);
      setSelectedPlaylistId(null);
      await loadPlaylists();
      setStatusMessage('歌单已删除');
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const handleRenamePlaylist = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library || !selectedPlaylist) {
      return;
    }

    const name = window.prompt('重命名歌单', selectedPlaylist.name);
    if (!name?.trim() || name.trim() === selectedPlaylist.name) {
      return;
    }

    try {
      setPlaylistMenuOpen(false);
      const updated = await library.updatePlaylist({ playlistId: selectedPlaylist.id, name: name.trim() });
      await loadPlaylists();
      setSelectedPlaylistId(updated.id);
      setStatusMessage('歌单已重命名');
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  };

  const handleUpdatePlaylistSort = async (sortMode: PlaylistSortMode): Promise<void> => {
    const library = window.echo?.library;
    if (!library || !selectedPlaylist) {
      return;
    }

    if (sortMode === selectedPlaylist.sortMode) {
      setPlaylistMenuOpen(false);
      return;
    }

    try {
      setPlaylistMenuOpen(false);
      const updated = await library.updatePlaylist({ playlistId: selectedPlaylist.id, sortMode });
      await loadPlaylists();
      setSelectedPlaylistId(updated.id);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(updated.id, 1, 'replace', '');
      setStatusMessage('排序方式已更新');
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (sortError) {
      setError(sortError instanceof Error ? sortError.message : String(sortError));
    }
  };

  const handleExportPlaylist = async (format: PlaylistExportFormat): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.exportPlaylist || !selectedPlaylist) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to export playlists.');
      return;
    }

    try {
      setPlaylistMenuOpen(false);
      const exportedPath = await library.exportPlaylist({ playlistId: selectedPlaylist.id, format });
      if (exportedPath) {
        setStatusMessage(`歌单已导出：${exportedPath}`);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  const handlePlayAll = async (): Promise<void> => {
    if (playlistPanelView === 'local' && isSelectedPlaylistPlaybackActive) {
      await exitPlaylistSequence();
      setStatusMessage('已退出歌单播放，恢复原队列');
      return;
    }

    if (playableTracks.length === 0) {
      setError(playlistPanelView === 'streamingFavorites' ? '这个收藏列表没有可播放的歌曲。' : '这个歌单没有可播放的歌曲。');
      return;
    }

    try {
      await playPlaylistSequence(playableTracks, {
        label: queueSource.label,
        playlistId: playlistPanelView === 'local' ? selectedPlaylist?.id : undefined,
        source: queueSource,
      });
      setStatusMessage(playlistPanelView === 'streamingFavorites' ? `正在播放收藏：${queueSource.label}` : `正在按歌单顺序播放：${selectedPlaylist?.name ?? '当前歌单'}`);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : String(playError));
    }
  };

  const handleAddAllToQueue = (): void => {
    appendTracksToQueue(playableTracks, queueSource);
    setStatusMessage(`已添加 ${playableTracks.length} 首可用歌曲到队列`);
  };

  const createDownloadJobForTrack = useCallback(
    async (track: LibraryTrack, options: CreateTrackDownloadOptions = {}): Promise<DownloadJob> => {
      const provider = streamingProviderFromTrack(track);
      if (track.mediaType !== 'streaming' || !provider || !track.providerTrackId) {
        throw new Error('只有网络歌单中的流媒体歌曲可以直接下载。');
      }

      if (provider === 'spotify') {
        throw new Error('Spotify 由官方播放器播放，下载功能不适用于 Spotify。');
      }

      const webpageUrl = streamingTrackWebUrl(track);
      if (!webpageUrl) {
        throw new Error('这个平台暂不支持从网络歌单直接下载。');
      }

      const downloads = getDownloadsBridge();
      if (!downloads?.createUrlJob) {
        throw new Error('桌面下载服务不可用。');
      }

      const streaming = getStreamingBridge();
      if (!streaming?.resolvePlayback) {
        throw new Error('桌面流媒体服务不可用，无法解析下载地址。');
      }

      const [source, detailTrack] = await Promise.all([
        streaming.resolvePlayback({
          provider,
          providerTrackId: track.providerTrackId,
          quality: track.streamingQuality ?? streamingQuality,
        }),
        streaming.getTrack
          ? streaming.getTrack({ provider, providerTrackId: track.providerTrackId }).catch(() => null)
          : Promise.resolve(null),
      ]);
      return downloads.createUrlJob(source.url, {
        title: detailTrack?.title ?? track.title,
        artist: detailTrack?.artist ?? track.artist,
        album: detailTrack?.album ?? track.album,
        albumArtist: (detailTrack?.albumArtist ?? track.albumArtist) || track.artist,
        coverUrl: detailTrack?.coverUrl ?? detailTrack?.coverThumb ?? track.coverThumb,
        webpageUrl,
        outputSubdirectory: options.outputSubdirectory,
        bindMvAfterImport: false,
        requestHeaders: source.headers,
        directAudio: true,
        directAudioMimeType: source.mimeType,
        directAudioExtension: source.codec,
        streamingProvider: provider,
        streamingProviderTrackId: track.providerTrackId,
        streamingStableKey: track.stableKey ?? undefined,
        downloadAuthorizationToken: source.downloadAuthorizationToken,
      });
    },
    [streamingQuality],
  );

  const handleDownloadTrack = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      setDownloadingTrackId(track.id);
      setError(null);
      setStatusMessage(null);
      try {
        const job = await createDownloadJobForTrack(track);
        setDownloadJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
        setDownloadJobIdsByTrackId((current) => ({ ...current, [track.id]: job.id }));
        setStatusMessage(`已加入下载队列：${track.title}`);
      } catch (downloadError) {
        setError(downloadError instanceof Error ? downloadError.message : '添加下载任务失败');
        setStatusMessage(null);
      } finally {
        setDownloadingTrackId((current) => (current === track.id ? null : current));
      }
    },
    [createDownloadJobForTrack],
  );

  const loadTracksForPlaylistDownload = useCallback(
    async (playlistId: string): Promise<LibraryTrack[]> => {
      const library = window.echo?.library;
      if (!library?.getPlaylistItems) {
        throw new Error('桌面歌单服务不可用。');
      }

      const tracks: LibraryTrack[] = [];
      let nextPage = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await library.getPlaylistItems(playlistId, { page: nextPage, pageSize, search: '' });
        tracks.push(...result.items.map((item) => itemToTrack(item, streamingQuality)).filter((track) => !track.unavailable));
        hasMore = result.hasMore;
        nextPage += 1;
        await yieldToUi();
      }

      return tracks;
    },
    [streamingQuality],
  );

  const handleDownloadPlaylist = useCallback(async (): Promise<void> => {
    if (!selectedPlaylist) {
      return;
    }

    if (!canDownloadSelectedPlaylist) {
      setError('只有可下载的网络歌单支持整歌单下载。');
      setStatusMessage(null);
      return;
    }

    const downloads = getDownloadsBridge();
    if (!downloads?.createUrlJob) {
      setError('桌面下载服务不可用。');
      setStatusMessage(null);
      return;
    }

    try {
      const settings = downloads.getSettings ? await downloads.getSettings() : null;
      if (!settings?.outputDirectory) {
        setError('请先在下载页选择下载文件夹。');
        setStatusMessage(null);
        return;
      }

      const runId = Date.now();
      playlistDownloadRunIdRef.current = runId;
      setError(null);
      setStatusMessage(`正在按歌单顺序加入下载队列：${selectedPlaylist.name}`);
      setPlaylistDownloadSession({
        runId,
        playlistId: selectedPlaylist.id,
        playlistName: selectedPlaylist.name,
        total: Math.max(itemsPage.total, playableTracks.length),
        enqueued: 0,
        failedToQueue: 0,
        jobIds: [],
        active: true,
      });

      const tracks = (await loadTracksForPlaylistDownload(selectedPlaylist.id)).filter((track) => streamingProviderFromTrack(track) !== null);
      if (playlistDownloadRunIdRef.current !== runId) {
        return;
      }

      if (tracks.length === 0) {
        setPlaylistDownloadSession((current) => current && current.runId === runId ? { ...current, total: 0, active: false } : current);
        setStatusMessage(null);
        setError('这个歌单里没有可下载的网络歌曲。');
        return;
      }

      setPlaylistDownloadSession((current) => current && current.runId === runId ? { ...current, total: tracks.length } : current);

      let enqueued = 0;
      let failedToQueue = 0;
      for (const track of tracks) {
        if (playlistDownloadRunIdRef.current !== runId) {
          break;
        }

        setDownloadingTrackId(track.id);
        try {
          const job = await createDownloadJobForTrack(track, { outputSubdirectory: selectedPlaylist.name });
          enqueued += 1;
          setDownloadJobs((current) => (current.some((item) => item.id === job.id) ? current : [job, ...current]));
          setDownloadJobIdsByTrackId((current) => ({ ...current, [track.id]: job.id }));
          setPlaylistDownloadSession((current) =>
            current && current.runId === runId
              ? {
                  ...current,
                  enqueued,
                  jobIds: current.jobIds.includes(job.id) ? current.jobIds : [...current.jobIds, job.id],
                }
              : current,
          );
        } catch {
          failedToQueue += 1;
          setPlaylistDownloadSession((current) =>
            current && current.runId === runId
              ? {
                  ...current,
                  failedToQueue,
                }
              : current,
          );
        } finally {
          setDownloadingTrackId((current) => (current === track.id ? null : current));
        }

        await yieldToUi();
      }

      setPlaylistDownloadSession((current) => current && current.runId === runId ? { ...current, active: false } : current);
      setStatusMessage(
        failedToQueue > 0
          ? `已按歌单顺序加入下载队列：${enqueued} 首，${failedToQueue} 首未能解析。`
          : `已按歌单顺序加入下载队列：${enqueued} 首`,
      );
    } catch (downloadPlaylistError) {
      setPlaylistDownloadSession((current) => current ? { ...current, active: false } : current);
      setError(downloadPlaylistError instanceof Error ? downloadPlaylistError.message : '添加歌单下载任务失败');
      setStatusMessage(null);
    } finally {
      setDownloadingTrackId(null);
    }
  }, [
    createDownloadJobForTrack,
    canDownloadSelectedPlaylist,
    itemsPage.total,
    loadTracksForPlaylistDownload,
    playableTracks.length,
    selectedPlaylist,
  ]);

  const handleImportStreamingPlaylist = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    const url = playlistUrl.trim();
    if (!streaming?.importPlaylistFromUrl || !url) {
      return;
    }

    setIsImportingPlaylist(true);
    setError(null);
    setSpotifyPlaylistHelpUrl(null);
    setStatusMessage(t('playlistsPage.status.importingStreamingPlaylist'));
    try {
      const result = await streaming.importPlaylistFromUrl(url);
      setPlaylistUrl('');
      await loadPlaylists();
      setSelectedPlaylistId(result.playlistId);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(result.playlistId, 1, 'replace', '');
      setStatusMessage(t('playlistsPage.status.importedStreamingPlaylist', { name: result.playlistName, count: result.importedCount }));
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (importError) {
      if (isSpotifyPlaylistUrl(url) && isSpotifyPlaylistOwnerImportError(importError)) {
        setError(spotifyPlaylistOwnerImportMessage);
        setSpotifyPlaylistHelpUrl(url);
      } else {
        setError(importError instanceof Error ? importError.message : String(importError));
      }
      setStatusMessage(null);
    } finally {
      setIsImportingPlaylist(false);
    }
  };

  const handleImportStreamingFavorites = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    const url = favoriteImportUrl.trim();
    if (!streaming?.importFavoritesFromUrl || !url) {
      return;
    }

    setIsImportingFavorites(true);
    setError(null);
    setStatusMessage('正在导入流媒体收藏...');
    try {
      const result = await streaming.importFavoritesFromUrl(url);
      setFavoriteImportUrl('');
      setStreamingFavorites(result.snapshot);
      setSelectedFavoriteListId(favoriteCollectionSelectionId(result.collectionId));
      setStatusMessage(`已导入收藏表：${result.playlistName}，新增 ${result.addedCount} / 读取 ${result.importedCount} 首`);
      window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
      setStatusMessage(null);
    } finally {
      setIsImportingFavorites(false);
    }
  };

  const handleExportStreamingFavorites = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    if (!streaming?.exportFavorites) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to export streaming favorites.');
      setStatusMessage(null);
      return;
    }

    setIsExportingFavorites(true);
    setError(null);
    try {
      const exportedPath = await streaming.exportFavorites();
      if (exportedPath) {
        setStatusMessage(`已导出流媒体收藏：${exportedPath}`);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
      setStatusMessage(null);
    } finally {
      setIsExportingFavorites(false);
    }
  };

  const handleRenameFavoriteCollection = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    const collection = selectedFavoriteCollection;
    if (!streaming?.renameFavoriteCollection || !collection) {
      return;
    }

    const name = window.prompt('重命名收藏表', collection.name);
    if (!name?.trim() || name.trim() === collection.name) {
      return;
    }

    try {
      setError(null);
      const result = await streaming.renameFavoriteCollection({ collectionId: collection.id, name: name.trim() });
      setStreamingFavorites(result.snapshot);
      setSelectedFavoriteListId(favoriteCollectionSelectionId(result.collection.id));
      setStatusMessage('收藏表已重命名');
      window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
      setStatusMessage(null);
    }
  };

  const handleSyncFavoriteCollection = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    const collection = selectedFavoriteCollection;
    if (!streaming?.syncFavoriteCollection || !collection) {
      return;
    }

    setSyncingFavoriteCollectionId(collection.id);
    setError(null);
    setStatusMessage(`正在同步收藏表：${collection.name}`);
    try {
      const result = await streaming.syncFavoriteCollection({ collectionId: collection.id });
      setStreamingFavorites(result.snapshot);
      setSelectedFavoriteListId(favoriteCollectionSelectionId(result.collectionId));
      setStatusMessage(`已同步收藏表：${result.playlistName}，新增 ${result.addedCount} / 读取 ${result.importedCount} 首`);
      window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
      setStatusMessage(null);
    } finally {
      setSyncingFavoriteCollectionId((current) => (current === collection.id ? null : current));
    }
  };

  const handleDeleteFavoriteCollection = async (): Promise<void> => {
    const streaming = window.echo?.streaming;
    const collection = selectedFavoriteCollection;
    if (!streaming?.deleteFavoriteCollection || !collection) {
      return;
    }

    const confirmed = window.confirm(`删除流媒体收藏表“${collection.name}”？默认的 Bilibili / YouTube / SoundCloud 收藏不会受影响。`);
    if (!confirmed) {
      return;
    }

    setDeletingFavoriteCollectionId(collection.id);
    setError(null);
    try {
      const result = await streaming.deleteFavoriteCollection({ collectionId: collection.id });
      setStreamingFavorites(result.snapshot);
      setSelectedFavoriteListId(favoriteProviderSelectionId(collection.provider));
      setStatusMessage(`已删除收藏表：${collection.name}`);
      window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      setStatusMessage(null);
    } finally {
      setDeletingFavoriteCollectionId((current) => (current === collection.id ? null : current));
    }
  };

  const handleOpenSpotifyPlaylistForCopy = async (): Promise<void> => {
    const url = spotifyPlaylistHelpUrl ?? playlistUrl.trim();
    if (!url) {
      return;
    }

    const app = window.echo?.app;
    if (app?.openExternalUrl) {
      await app.openExternalUrl(url);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyPlaylistShareLink = async (url: string | null): Promise<void> => {
    if (!url) {
      return;
    }

    try {
      if (!window.navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }

      await window.navigator.clipboard.writeText(url);
      setError(null);
      setStatusMessage('歌单链接已复制');
    } catch {
      setError('无法复制歌单链接');
      setStatusMessage(null);
    }
  };

  const handleImportPlaylistFile = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.importPlaylistFile) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to import playlist files.');
      setStatusMessage(null);
      return;
    }

    setIsImportingPlaylistFile(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await library.importPlaylistFile();
      if (!result) {
        return;
      }

      await loadPlaylists();
      setSelectedPlaylistId(result.playlistId);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(result.playlistId, 1, 'replace', '');
      setStatusMessage(`已导入歌单：${result.playlistName}，共 ${result.importedCount} 首`);
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
      setStatusMessage(null);
    } finally {
      setIsImportingPlaylistFile(false);
    }
  };

  const handleAddLocalFilesToPlaylist = async (): Promise<void> => {
    const library = window.echo?.library;
    const playback = window.echo?.playback;
    if (!library?.addLocalAudioFilesToPlaylist || (!library.chooseImportFiles && !playback) || !selectedPlaylist) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to add local songs.');
      setStatusMessage(null);
      return;
    }

    if (isSelectedPlaylistProtected || isSelectedPlaylistRemote) {
      setError('只能向本地手动歌单添加本地歌曲。');
      setStatusMessage(null);
      return;
    }

    setIsAddingLocalFiles(true);
    setError(null);
    setStatusMessage(null);
    try {
      const filePaths = library.chooseImportFiles
        ? await library.chooseImportFiles()
        : playback?.openLocalAudioFiles
          ? await playback.openLocalAudioFiles()
          : await playback?.openLocalAudioFile().then((path) => (path ? [path] : null));

      if (!filePaths?.length) {
        return;
      }

      setStatusMessage('正在添加本地歌曲...');
      const result = await library.addLocalAudioFilesToPlaylist(selectedPlaylist.id, filePaths);
      await loadPlaylists();
      setSelectedPlaylistId(selectedPlaylist.id);
      setPlaylistSearchInput('');
      setPlaylistSearch('');
      await loadItems(selectedPlaylist.id, 1, 'replace', '');
      window.dispatchEvent(new Event('library:changed'));
      window.dispatchEvent(new Event('library:playlists-changed'));

      if (result.addedCount > 0) {
        const skippedSuffix = result.skippedCount || result.failedCount ? `，跳过 ${result.skippedCount + result.failedCount} 个文件` : '';
        setStatusMessage(`已添加 ${result.addedCount} 首本地歌曲${skippedSuffix}`);
      } else {
        setStatusMessage('没有可添加的本地歌曲。');
      }
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
      setStatusMessage(null);
    } finally {
      setIsAddingLocalFiles(false);
    }
  };

  const handleChoosePlaylistCover = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library || !selectedPlaylist) {
      return;
    }

    try {
      const selection = await library.chooseTrackCover();
      if (!selection) {
        return;
      }

      await library.updatePlaylist({ playlistId: selectedPlaylist.id, coverPath: selection.path });
      await refreshSelected();
      setStatusMessage('歌单封面已更新');
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (coverError) {
      setError(coverError instanceof Error ? coverError.message : String(coverError));
    }
  };

  const handleClearPlaylistCover = async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library || !selectedPlaylist) {
      return;
    }

    try {
      await library.updatePlaylist({ playlistId: selectedPlaylist.id, coverId: null });
      await refreshSelected();
      setStatusMessage('已恢复为第一首歌的专辑封面');
      window.dispatchEvent(new Event('library:playlists-changed'));
    } catch (coverError) {
      setError(coverError instanceof Error ? coverError.message : String(coverError));
    }
  };

  const handleLoadMore = (): void => {
    if (selectedPlaylist && itemsPage.hasMore && !isLoading) {
      void loadItems(selectedPlaylist.id, itemsPage.page + 1, 'append');
    }
  };

  const handlePlaylistListDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, playlist: LibraryPlaylist): void => {
      if (!canReorderPlaylistList) {
        event.preventDefault();
        return;
      }

      setDraggedPlaylistId(playlist.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(playlistListDragMime, playlist.id);
      event.dataTransfer.setData('text/plain', playlist.id);
    },
    [canReorderPlaylistList],
  );

  const handlePlaylistListDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>, playlist: LibraryPlaylist): void => {
      if (!canReorderPlaylistList || !draggedPlaylistId || draggedPlaylistId === playlist.id) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetPlaylistId((current) => (current === playlist.id ? current : playlist.id));
    },
    [canReorderPlaylistList, draggedPlaylistId],
  );

  const handlePlaylistListDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>, targetPlaylist: LibraryPlaylist): void => {
      event.preventDefault();
      const sourcePlaylistId =
        draggedPlaylistId ||
        event.dataTransfer.getData(playlistListDragMime) ||
        event.dataTransfer.getData('text/plain');

      setDraggedPlaylistId(null);
      setDropTargetPlaylistId(null);

      if (!canReorderPlaylistList || !sourcePlaylistId || sourcePlaylistId === targetPlaylist.id) {
        return;
      }

      const nextOrderIds = movePlaylistId(orderedPlaylists, sourcePlaylistId, targetPlaylist.id);
      if (!nextOrderIds) {
        return;
      }

      setPlaylistOrderIds(nextOrderIds);
      writePlaylistListOrderMemory(nextOrderIds);
      setError(null);
      setStatusMessage('歌单顺序已保存');
    },
    [canReorderPlaylistList, draggedPlaylistId, orderedPlaylists],
  );

  const handlePlaylistListDragEnd = useCallback((): void => {
    setDraggedPlaylistId(null);
    setDropTargetPlaylistId(null);
  }, []);

  const handleFavoriteListDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, entry: StreamingFavoriteListEntry): void => {
      if (!canReorderFavoriteList) {
        event.preventDefault();
        return;
      }

      setDraggedFavoriteListId(entry.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(favoriteListDragMime, entry.id);
      event.dataTransfer.setData('text/plain', entry.id);
    },
    [canReorderFavoriteList],
  );

  const handleFavoriteListDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>, entry: StreamingFavoriteListEntry): void => {
      if (!canReorderFavoriteList || !draggedFavoriteListId || draggedFavoriteListId === entry.id) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetFavoriteListId((current) => (current === entry.id ? current : entry.id));
    },
    [canReorderFavoriteList, draggedFavoriteListId],
  );

  const handleFavoriteListDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>, targetEntry: StreamingFavoriteListEntry): void => {
      event.preventDefault();
      const sourceEntryId =
        draggedFavoriteListId ||
        event.dataTransfer.getData(favoriteListDragMime) ||
        event.dataTransfer.getData('text/plain');

      setDraggedFavoriteListId(null);
      setDropTargetFavoriteListId(null);

      if (!canReorderFavoriteList || !sourceEntryId || sourceEntryId === targetEntry.id) {
        return;
      }

      const nextOrderIds = moveFavoriteListEntryId(orderedFavoriteListEntries, sourceEntryId, targetEntry.id);
      if (!nextOrderIds) {
        return;
      }

      setFavoriteListOrderIds(nextOrderIds);
      writeFavoriteListOrderMemory(nextOrderIds);
      setError(null);
      setStatusMessage('流媒体收藏顺序已保存');
    },
    [canReorderFavoriteList, draggedFavoriteListId, orderedFavoriteListEntries],
  );

  const handleFavoriteListDragEnd = useCallback((): void => {
    setDraggedFavoriteListId(null);
    setDropTargetFavoriteListId(null);
  }, []);

  const isTrackReorderable = useCallback(
    (track: LibraryTrack): boolean => canReorderSelectedPlaylist && Boolean(track.playlistItemId),
    [canReorderSelectedPlaylist],
  );

  const handlePlaylistItemDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, track: LibraryTrack): void => {
      if (!canReorderSelectedPlaylist || !track.playlistItemId) {
        event.preventDefault();
        return;
      }

      setDraggedPlaylistItemId(track.playlistItemId);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(playlistItemDragMime, track.playlistItemId);
      event.dataTransfer.setData('text/plain', track.playlistItemId);
    },
    [canReorderSelectedPlaylist],
  );

  const handlePlaylistItemDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, track: LibraryTrack): void => {
      if (!canReorderSelectedPlaylist || !track.playlistItemId || draggedPlaylistItemId === track.playlistItemId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetPlaylistItemId(track.playlistItemId);
    },
    [canReorderSelectedPlaylist, draggedPlaylistItemId],
  );

  const handlePlaylistItemDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetTrack: LibraryTrack): void => {
      event.preventDefault();
      const library = window.echo?.library;
      const selectedPlaylistForDrop = selectedPlaylist;
      const sourceItemId =
        draggedPlaylistItemId ||
        event.dataTransfer.getData(playlistItemDragMime) ||
        event.dataTransfer.getData('text/plain');
      const targetItemId = targetTrack.playlistItemId ?? '';

      setDraggedPlaylistItemId(null);
      setDropTargetPlaylistItemId(null);

      if (!canReorderSelectedPlaylist || !library?.movePlaylistItem || !selectedPlaylistForDrop || !sourceItemId || !targetItemId || sourceItemId === targetItemId) {
        return;
      }

      const fromIndex = itemsPage.items.findIndex((item) => item.id === sourceItemId);
      const toIndex = itemsPage.items.findIndex((item) => item.id === targetItemId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return;
      }

      setError(null);
      setStatusMessage('正在保存歌单顺序...');
      setItemsPage((current) => {
        const currentFromIndex = current.items.findIndex((item) => item.id === sourceItemId);
        const currentToIndex = current.items.findIndex((item) => item.id === targetItemId);
        if (currentFromIndex < 0 || currentToIndex < 0 || currentFromIndex === currentToIndex) {
          return current;
        }

        const nextItems = [...current.items];
        const [movedItem] = nextItems.splice(currentFromIndex, 1);
        nextItems.splice(Math.max(0, Math.min(currentToIndex, nextItems.length)), 0, movedItem);
        return {
          ...current,
          items: nextItems.map((item, index) => ({ ...item, position: index })),
        };
      });

      void (async () => {
        try {
          await library.movePlaylistItem(selectedPlaylistForDrop.id, sourceItemId, toIndex);
          await loadItems(selectedPlaylistForDrop.id);
          setStatusMessage('歌单顺序已保存');
          window.dispatchEvent(new Event('library:playlists-changed'));
        } catch (moveError) {
          setError(moveError instanceof Error ? moveError.message : String(moveError));
          setStatusMessage(null);
          await loadItems(selectedPlaylistForDrop.id);
        }
      })();
    },
    [canReorderSelectedPlaylist, draggedPlaylistItemId, itemsPage.items, loadItems, selectedPlaylist],
  );

  const handlePlaylistItemDragEnd = useCallback((): void => {
    setDraggedPlaylistItemId(null);
    setDropTargetPlaylistItemId(null);
  }, []);

  const handleTrackPlay = async (track: LibraryTrack): Promise<void> => {
    if (playlistPanelView === 'streamingFavorites') {
      if (track.unavailable) {
        return;
      }

      const sequenceTracks = playableTailFromTrack(favoriteDisplayTracks, track);
      try {
        await playPlaylistSequence(sequenceTracks, {
          label: queueSource.label,
          source: queueSource,
          startTrackId: track.id,
        });
      } catch (playError) {
        setError(playError instanceof Error ? playError.message : String(playError));
      }
      return;
    }

    const item = itemsPage.items.find((candidate) => candidate.id === track.playlistItemId);
    const playableTrack = item ? itemToTrack(item, isSelectedPlaylistRemote ? streamingQuality : undefined) : null;
    if (!playableTrack || playableTrack.unavailable) {
      return;
    }

    const sequenceTracks = playableTailFromTrack(displayTracks, playableTrack);
    try {
      await playPlaylistSequence(sequenceTracks, {
        label: selectedPlaylist?.name,
        playlistId: selectedPlaylist?.id,
        source: queueSource,
        startTrackId: playableTrack.id,
      });
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : String(playError));
    }
  };

  const handleToggleLiked = useCallback(async (track: LibraryTrack): Promise<void> => {
    if (playlistPanelView === 'streamingFavorites') {
      const favorite = favoriteItems.find((item) => item.stableKey === track.stableKey || item.providerTrackId === track.providerTrackId);
      const streaming = window.echo?.streaming;
      if (!favorite || !streaming?.setFavorite) {
        return;
      }

      try {
        const result = await streaming.setFavorite({
          track: {
            id: favorite.id,
            provider: favorite.provider,
            providerTrackId: favorite.providerTrackId,
            stableKey: favorite.stableKey,
            title: favorite.title,
            artist: favorite.artist,
            artists: [],
            album: favorite.album,
            albumId: null,
            albumArtist: favorite.albumArtist,
            duration: favorite.duration,
            coverUrl: favorite.coverUrl,
            coverThumb: favorite.coverThumb,
            qualities: favorite.qualities,
            explicit: false,
            playable: favorite.playable,
            unavailableReason: favorite.unavailableReason,
            lyricsStatus: favorite.lyricsStatus,
            mvStatus: favorite.mvStatus,
          },
          favorite: false,
        });
        setStreamingFavorites(result.snapshot);
        window.dispatchEvent(new CustomEvent('streaming:favorites-changed', { detail: result.snapshot }));
        setStatusMessage(`已取消收藏：${favorite.title}`);
      } catch (favoriteError) {
        setError(favoriteError instanceof Error ? favoriteError.message : String(favoriteError));
      }
      return;
    }

    const library = window.echo?.library;
    if (!library || track.unavailable) {
      return;
    }

    try {
      setError(null);
      if (track.mediaType === 'streaming' && isLikedStreamingProvider(track.provider) && track.providerTrackId) {
        const streaming = window.echo?.streaming;
        if (!streaming?.setTrackLiked) {
          throw new Error('Streaming liked tracks are unavailable.');
        }

        await streaming.setTrackLiked({
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          liked: likedTrackIds[track.id] !== true,
        });
      } else {
        await library.toggleTrackLiked(track.id);
      }
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : String(likeError));
    }
  }, [favoriteItems, likedTrackIds, playlistPanelView]);

  const handleOpenTrackMenu = useCallback((track: LibraryTrack, position: { x: number; y: number }): void => {
    setTrackMenu({ track, position });
  }, []);

  const handleTrackMenuAction = useCallback(
    async (action: TrackMenuAction, track: LibraryTrack, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      setTrackMenu(null);

      if (track.unavailable && action !== 'remove-from-playlist') {
        return;
      }

      if (action === 'clear-lyrics-cache') {
        const lyricsApi = window.echo?.lyrics;
        if (!lyricsApi?.clearCache) {
          setError('Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.');
          return;
        }

        try {
          setError(null);
          await lyricsApi.clearCache(track.id);
          window.dispatchEvent(new CustomEvent('lyrics:rematch-requested', { detail: { trackId: track.id } }));
          setStatusMessage(`已清理歌词缓存：${track.title}`);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      try {
        setError(null);

        if (
          track.mediaType === 'remote' &&
          (action === 'reload-embedded-tags' ||
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
            playTrackNext(track, queueSource);
            return;
          case 'add-to-queue':
            appendToQueue(track, queueSource);
            setStatusMessage(`已添加到队列：${track.title}`);
            return;
          case 'toggle-liked':
            await handleToggleLiked(track);
            return;
          case 'remove-from-queue':
            {
              const removedCount = removeTrackFromQueue(track.id);
              setStatusMessage(
                removedCount > 0
                  ? `已从播放队列移除：${track.title}`
                  : `播放队列里没有这首歌：${track.title}`,
              );
            }
            return;
          case 'remove-from-playlist':
            {
              const playlistId = selectedPlaylist?.id;
              const itemId = track.playlistItemId;
              if (!library?.removePlaylistItem || !playlistId || !itemId) {
                setError('Desktop bridge unavailable. Open ECHO Next in Electron to remove playlist songs.');
                return;
              }

              await library.removePlaylistItem(itemId);
              setItemsPage((current) => {
                const removed = current.items.some((item) => item.id === itemId);
                return {
                  ...current,
                  total: removed ? Math.max(0, current.total - 1) : current.total,
                  items: current.items.filter((item) => item.id !== itemId),
                };
              });
              setPlaylists((current) =>
                current.map((playlist) =>
                  playlist.id === playlistId ? { ...playlist, itemCount: Math.max(0, playlist.itemCount - 1) } : playlist,
                ),
              );
              await loadItems(playlistId, 1, 'replace');
              await loadPlaylists();
              setSelectedPlaylistId(playlistId);
              window.dispatchEvent(new Event('library:playlists-changed'));
              setStatusMessage(`已从歌单移除：${track.title}`);
            }
            return;
          case 'reload-embedded-tags':
            {
              if (!library || track.mediaType === 'streaming' || track.mediaType === 'remote' || track.isTemporary) {
                setError('这首歌不支持重新加载嵌入标签。');
                return;
              }

              const result = await library.loadEmbeddedTrackTags(track.id);
              setItemsPage((current) => ({
                ...current,
                items: current.items.map((item) =>
                  item.track?.id === result.track.id
                    ? {
                        ...item,
                        track: result.track,
                        titleSnapshot: result.track.title,
                        artistSnapshot: result.track.artist,
                        albumSnapshot: result.track.album,
                        durationSnapshot: result.track.duration,
                        coverId: result.track.coverId,
                        coverThumb: result.track.coverThumb,
                      }
                    : item,
                ),
              }));
              setStatusMessage(`已从内嵌标签重新加载：${result.track.title}`);
              window.dispatchEvent(new Event('library:changed'));
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
          case 'add-to-playlist':
            {
              if (!library) {
                setError('Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.');
                return;
              }

              if (track.mediaType === 'streaming') {
                setError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
                return;
              }

              const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library));
              if (!playlist) {
                return;
              }

              await library.addTrackToPlaylist(playlist.id, track.id);
              window.dispatchEvent(new Event('library:playlists-changed'));
              setStatusMessage(`已加入歌单：${playlist.name}`);
            }
            return;
          default:
            setError('这个歌单操作还没有接入。');
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [appendToQueue, handleToggleLiked, loadItems, loadPlaylists, playTrackNext, queueSource, removeTrackFromQueue, selectedPlaylist?.id],
  );

  return (
    <div className="playlists-page">
      <aside className="playlist-sidebar" aria-label={t('route.playlists.label')}>
        <div className="playlist-sidebar-header">
          <h1>{t('route.playlists.label')}</h1>
          <button className="tool-button" type="button" aria-label={t('playlistsPage.action.importFile')} title={t('playlistsPage.action.importFile')} disabled={isImportingPlaylistFile} onClick={() => void handleImportPlaylistFile()}>
            {isImportingPlaylistFile ? <Loader2 className="spinning-icon" size={17} /> : <Upload size={17} />}
          </button>
          <button className="tool-button" type="button" aria-label={t('playlistsPage.action.newLocal')} title={t('playlistsPage.action.newLocal')} onClick={handleShowNewPlaylistForm}>
            <Plus size={17} />
          </button>
        </div>

        {showNewPlaylistForm ? (
          <form
            className="playlist-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreatePlaylist(newPlaylistName);
            }}
          >
            <input
              ref={newPlaylistInputRef}
              value={newPlaylistName}
              aria-label={t('playlistsPage.form.nameAria')}
              placeholder={t('playlistsPage.form.placeholder')}
              onChange={(event) => setNewPlaylistName(event.target.value)}
            />
            <button className="secondary-action" type="submit" disabled={!newPlaylistName.trim()}>
              <Plus size={15} />
              <span>{t('playlistsPage.form.create')}</span>
            </button>
            <button
              className="tool-button"
              type="button"
              aria-label={t('playlistsPage.form.cancel')}
              title={t('playlistsPage.form.cancel')}
              onClick={() => {
                setShowNewPlaylistForm(false);
                setNewPlaylistName('');
              }}
            >
              <X size={15} />
            </button>
          </form>
        ) : null}

        <div className="playlist-view-switch" role="tablist" aria-label={t('playlistsPage.view.aria')}>
          <button type="button" role="tab" aria-selected={playlistPanelView === 'local'} data-active={playlistPanelView === 'local'} onClick={() => setPlaylistPanelView('local')}>
            {t('playlistsPage.view.local')}
          </button>
          <button type="button" role="tab" aria-selected={playlistPanelView === 'streamingFavorites'} data-active={playlistPanelView === 'streamingFavorites'} onClick={() => setPlaylistPanelView('streamingFavorites')}>
            {t('playlistsPage.view.streamingFavorites')}
          </button>
        </div>

        {playlistPanelView === 'local' ? (
          <>
            <button
              className="playlist-daily-recommend"
              type="button"
              disabled={isRefreshingStreamingPlaylist}
              onClick={() => void handleRefreshNeteaseDailyRecommend()}
            >
              {isRefreshingStreamingPlaylist ? <Loader2 className="spinning-icon" size={16} /> : <CalendarDays size={16} />}
              <span>
                <strong>{t('playlistsPage.daily.title')}</strong>
                <small>{t('playlistsPage.daily.subtitle')}</small>
              </span>
            </button>

            <div className="playlist-list">
              {orderedPlaylists.map((playlist) => {
                const sourceLabel = playlistSourceProviderLabel(playlist);

                return (
                  <button
                    className="playlist-list-item"
                    data-active={playlist.id === selectedPlaylist?.id ? 'true' : undefined}
                    data-dragging={draggedPlaylistId === playlist.id ? 'true' : undefined}
                    data-drop-target={dropTargetPlaylistId === playlist.id ? 'true' : undefined}
                    data-reorderable={canReorderPlaylistList ? 'true' : undefined}
                    draggable={canReorderPlaylistList}
                    key={playlist.id}
                    type="button"
                    onDragEnd={handlePlaylistListDragEnd}
                    onDragOver={(event) => handlePlaylistListDragOver(event, playlist)}
                    onDragStart={(event) => handlePlaylistListDragStart(event, playlist)}
                    onDrop={(event) => handlePlaylistListDrop(event, playlist)}
                    onClick={() => setSelectedPlaylistId(playlist.id)}
                  >
                    <GripVertical className="playlist-list-drag-handle" size={15} aria-hidden="true" />
                    <span>
                      <strong>
                        <span>{playlist.name}</span>
                        {sourceLabel ? <em>{sourceLabel}</em> : null}
                      </strong>
                      <small>{t('albumMenu.playlistSubmenu.itemCount', { count: playlist.itemCount })}</small>
                    </span>
                  </button>
                );
              })}
              {orderedPlaylists.length === 0 ? <p className="playlist-empty">{t('playlistsPage.empty.local')}</p> : null}
            </div>

            <form
              className="streaming-section playlist-import-box"
              onSubmit={(event) => {
                event.preventDefault();
                void handleImportStreamingPlaylist();
              }}
            >
              <h2>{t('playlistsPage.importStreaming.title')}</h2>
              <label>
                <Link size={14} />
                <input
                  value={playlistUrl}
                  onChange={(event) => {
                    setPlaylistUrl(event.target.value);
                    setSpotifyPlaylistHelpUrl(null);
                  }}
                  placeholder={t('playlistsPage.importStreaming.placeholder')}
                  disabled={isImportingPlaylist}
                />
              </label>
              <button className="secondary-action" type="submit" disabled={!playlistUrl.trim() || isImportingPlaylist}>
                {isImportingPlaylist ? <Loader2 className="spinning-icon" size={15} /> : <Plus size={15} />}
                <span>{isImportingPlaylist ? t('playlistsPage.importStreaming.adding') : t('playlistsPage.importStreaming.add')}</span>
              </button>
            </form>

            <div className="streaming-section">
              <h2>流媒体歌单</h2>
              <div>
                <span><WifiOff size={14} /> 网易云音乐</span>
                <em>未连接</em>
              </div>
              <div>
                <span><WifiOff size={14} /> QQ 音乐</span>
                <em>未连接</em>
              </div>
              <div>
                <span><WifiOff size={14} /> Spotify</span>
                <em>需登录</em>
              </div>
            </div>
          </>
        ) : (
          <>
            <form
              className="streaming-section playlist-import-box"
              onSubmit={(event) => {
                event.preventDefault();
                void handleImportStreamingFavorites();
              }}
            >
              <h2>导入收藏</h2>
              <label>
                <Link size={14} />
                <input
                  value={favoriteImportUrl}
                  onChange={(event) => setFavoriteImportUrl(event.target.value)}
                  placeholder="粘贴 Bilibili 收藏 / YouTube 播放列表 / SoundCloud sets"
                  disabled={isImportingFavorites}
                />
              </label>
              <button className="secondary-action" type="submit" disabled={!favoriteImportUrl.trim() || isImportingFavorites}>
                {isImportingFavorites ? <Loader2 className="spinning-icon" size={15} /> : <Upload size={15} />}
                <span>{isImportingFavorites ? '导入中' : '导入收藏'}</span>
              </button>
            </form>

            <div className="playlist-list playlist-list--favorites">
              {orderedFavoriteListEntries.map((entry) => {
                return (
                  <button
                    className="playlist-list-item"
                    data-active={entry.id === selectedFavoriteListId ? 'true' : undefined}
                    data-dragging={draggedFavoriteListId === entry.id ? 'true' : undefined}
                    data-drop-target={dropTargetFavoriteListId === entry.id ? 'true' : undefined}
                    data-reorderable={canReorderFavoriteList ? 'true' : undefined}
                    draggable={canReorderFavoriteList}
                    key={entry.id}
                    type="button"
                    onDragEnd={handleFavoriteListDragEnd}
                    onDragOver={(event) => handleFavoriteListDragOver(event, entry)}
                    onDragStart={(event) => handleFavoriteListDragStart(event, entry)}
                    onDrop={(event) => handleFavoriteListDrop(event, entry)}
                    onClick={() => setSelectedFavoriteListId(entry.id)}
                  >
                    <GripVertical className="playlist-list-drag-handle" size={15} aria-hidden="true" />
                    <span>
                      <strong>
                        <span>{entry.type === 'provider' ? entry.label : entry.collection.name}</span>
                        {entry.type === 'collection' ? <em>{entry.providerLabel}</em> : null}
                      </strong>
                      <small>{entry.count} favorites</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </aside>

      <section className="playlist-detail">
        {playlistPanelView === 'streamingFavorites' ? (
          <>
            <header className="playlist-detail-header">
              <div className="playlist-cover" data-empty={favoriteDisplayTracks.length === 0}>
                {favoriteDisplayTracks[0]?.coverThumb ? <img alt="" src={favoriteDisplayTracks[0].coverThumb} /> : <Heart size={34} />}
              </div>
              <div className="playlist-detail-copy">
                <h2>{selectedFavoriteListName}</h2>
                <p>{selectedFavoriteCollection ? `${selectedFavoriteProviderLabel} · ${selectedFavoriteCollection.sourceName ?? selectedFavoriteCollection.providerPlaylistId}` : '保存到本地 streaming-favorites.json，包含可迁移的视频/音频页面链接。'}</p>
                <small>{favoriteItems.length} tracks · {new Date(streamingFavorites.updatedAt).toLocaleString()}</small>
              </div>
              <div className="playlist-actions">
                <div className="playlist-quality-control" ref={qualityMenuRef} title="Streaming quality">
                  <SlidersHorizontal size={15} />
                  <span>音质</span>
                  <button
                    type="button"
                    aria-label="Streaming quality"
                    aria-haspopup="listbox"
                    aria-expanded={qualityMenuOpen}
                    onClick={() => setQualityMenuOpen((open) => !open)}
                  >
                    <strong>{currentStreamingQuality.label}</strong>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {qualityMenuOpen ? (
                    <div className="playlist-quality-menu" role="listbox" aria-label="Streaming quality">
                      {streamingQualityOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={option.value === streamingQuality}
                          onClick={() => handleStreamingQualityChange(option.value)}
                        >
                          <span>{option.label}</span>
                          {option.value === streamingQuality ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="primary-action" type="button" disabled={playableTracks.length === 0} onClick={() => void handlePlayAll()}>
                  <Play size={16} />
                  <span>播放收藏</span>
                </button>
                <button className="secondary-action" type="button" disabled={playableTracks.length === 0} onClick={handleAddAllToQueue}>
                  <ListPlus size={16} />
                  <span>添加到队列</span>
                </button>
                {selectedFavoriteShareUrl ? (
                  <button className="secondary-action" type="button" onClick={() => void handleCopyPlaylistShareLink(selectedFavoriteShareUrl)}>
                    <Share2 size={16} />
                    <span>分享</span>
                  </button>
                ) : null}
                {selectedFavoriteCollection ? (
                  <button className="secondary-action" type="button" disabled={syncingFavoriteCollectionId === selectedFavoriteCollection.id} onClick={() => void handleSyncFavoriteCollection()}>
                    {syncingFavoriteCollectionId === selectedFavoriteCollection.id ? <Loader2 className="spinning-icon" size={16} /> : <RefreshCw size={16} />}
                    <span>{syncingFavoriteCollectionId === selectedFavoriteCollection.id ? '同步中' : '同步'}</span>
                  </button>
                ) : null}
                {selectedFavoriteCollection ? (
                  <button className="secondary-action" type="button" onClick={() => void handleRenameFavoriteCollection()}>
                    <Pencil size={16} />
                    <span>重命名</span>
                  </button>
                ) : null}
                {selectedFavoriteCollection ? (
                  <button className="secondary-action danger" type="button" disabled={deletingFavoriteCollectionId === selectedFavoriteCollection.id} onClick={() => void handleDeleteFavoriteCollection()}>
                    {deletingFavoriteCollectionId === selectedFavoriteCollection.id ? <Loader2 className="spinning-icon" size={16} /> : <Trash2 size={16} />}
                    <span>{deletingFavoriteCollectionId === selectedFavoriteCollection.id ? '删除中' : '删除'}</span>
                  </button>
                ) : null}
                <button className="secondary-action" type="button" disabled={isExportingFavorites} onClick={() => void handleExportStreamingFavorites()}>
                  {isExportingFavorites ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
                  <span>{isExportingFavorites ? '导出中' : '导出收藏'}</span>
                </button>
              </div>
            </header>

            <TrackList
              tracks={favoriteDisplayTracks}
              currentTrackId={currentTrackId}
              canLoadMore={false}
              onEndReached={() => undefined}
              likedTrackIds={visibleLikedTrackIds}
              onToggleLiked={(track) => void handleToggleLiked(track)}
              isTrackDraggable={() => false}
              draggedTrackId={null}
              dropTargetTrackId={null}
              onTrackDragStart={(event) => event.preventDefault()}
              onTrackDragOver={() => undefined}
              onTrackDrop={(event) => event.preventDefault()}
              onTrackDragEnd={() => undefined}
              onPlay={handleTrackPlay}
            />
          </>
        ) : selectedPlaylist ? (
          <>
            <header className="playlist-detail-header">
              <div className="playlist-cover" data-empty={!selectedPlaylist.coverThumb}>
                {selectedPlaylist.coverThumb ? <img alt="" src={selectedPlaylist.coverThumb} /> : <Music2 size={34} />}
                <button
                  className="playlist-cover-button"
                  type="button"
                  aria-label="自定义歌单封面"
                  title="自定义歌单封面"
                  onClick={() => void handleChoosePlaylistCover()}
                >
                  <ImagePlus size={17} />
                </button>
                {selectedPlaylist.coverId ? (
                  <button
                    className="playlist-cover-reset"
                    type="button"
                    aria-label="使用第一首歌封面"
                    title="使用第一首歌封面"
                    onClick={() => void handleClearPlaylistCover()}
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : null}
              </div>
              <div className="playlist-detail-copy">
                <h2>{selectedPlaylist.name}</h2>
                <p>{selectedPlaylist.description || 'Manual local playlist'}</p>
                <small>{itemsPage.total} tracks · {playlistSortOptions.find((option) => option.value === selectedPlaylist.sortMode)?.label ?? '手动排序'}</small>
              </div>
              <div className="playlist-actions">
                <form
                  className="playlist-search"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPlaylistSearch(playlistSearchInput.trim());
                  }}
                >
                  <Search size={15} />
                  <input
                    aria-label="搜索歌单歌曲"
                    placeholder="搜索歌单歌曲"
                    value={playlistSearchInput}
                    onChange={(event) => setPlaylistSearchInput(event.target.value)}
                  />
                  {playlistSearchInput ? (
                    <button
                      type="button"
                      aria-label="清除搜索"
                      title="清除搜索"
                      onClick={() => {
                        setPlaylistSearchInput('');
                        setPlaylistSearch('');
                      }}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </form>
                {isSelectedPlaylistRemote ? (
                  <div className="playlist-quality-control" ref={qualityMenuRef} title="Streaming quality">
                    <SlidersHorizontal size={15} />
                    <span>音质</span>
                    <button
                      type="button"
                      aria-label="Streaming quality"
                      aria-haspopup="listbox"
                      aria-expanded={qualityMenuOpen}
                      onClick={() => setQualityMenuOpen((open) => !open)}
                    >
                      <strong>{currentStreamingQuality.label}</strong>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    {qualityMenuOpen ? (
                      <div className="playlist-quality-menu" role="listbox" aria-label="Streaming quality">
                        {streamingQualityOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === streamingQuality}
                            onClick={() => handleStreamingQualityChange(option.value)}
                          >
                            <span>{option.label}</span>
                            {option.value === streamingQuality ? <Check size={14} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button className="primary-action" type="button" disabled={playableTracks.length === 0 && !isSelectedPlaylistPlaybackActive} onClick={() => void handlePlayAll()}>
                  <Play size={16} />
                  <span>{isSelectedPlaylistPlaybackActive ? '退出歌单播放' : '播放歌单'}</span>
                </button>
                <button className="secondary-action" type="button" disabled={playableTracks.length === 0} onClick={handleAddAllToQueue}>
                  <ListPlus size={16} />
                  <span>添加到队列</span>
                </button>
                {canDownloadSelectedPlaylist ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={itemsPage.total === 0 || playlistDownloadSummary?.isActive === true}
                    onClick={() => void handleDownloadPlaylist()}
                  >
                    {playlistDownloadSummary?.isActive ? <Loader2 className="spinning-icon" size={16} /> : <Download size={16} />}
                    <span>{playlistDownloadSummary?.isActive ? '下载中' : '下载歌单'}</span>
                  </button>
                ) : null}
                {selectedStreamingPlaylistUrl ? (
                  <button className="secondary-action" type="button" onClick={() => void handleCopyPlaylistShareLink(selectedStreamingPlaylistUrl)}>
                    <Share2 size={16} />
                    <span>分享</span>
                  </button>
                ) : null}
                {!isSelectedPlaylistProtected && !isSelectedPlaylistRemote ? (
                  <button className="secondary-action" type="button" disabled={isAddingLocalFiles} onClick={() => void handleAddLocalFilesToPlaylist()}>
                    {isAddingLocalFiles ? <Loader2 className="spinning-icon" size={16} /> : <FilePlus2 size={16} />}
                    <span>{isAddingLocalFiles ? '添加中' : '添加本地歌曲'}</span>
                  </button>
                ) : null}
                <button className="secondary-action" type="button" onClick={() => void handleChoosePlaylistCover()}>
                  <ImagePlus size={16} />
                  <span>更换封面</span>
                </button>
                {selectedStreamingPlaylistUrl || isSelectedPlaylistNeteaseDailyRecommend ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={isRefreshingStreamingPlaylist}
                    onClick={() => void handleRefreshStreamingPlaylist()}
                  >
                    {isRefreshingStreamingPlaylist ? <Loader2 className="spinning-icon" size={16} /> : <RefreshCw size={16} />}
                    <span>{isSelectedPlaylistNeteaseDailyRecommend ? '刷新推荐' : '刷新歌单'}</span>
                  </button>
                ) : null}
                {selectedPlaylist.coverId ? (
                  <button className="tool-button" type="button" aria-label="恢复默认封面" title="恢复默认封面" onClick={() => void handleClearPlaylistCover()}>
                    <RotateCcw size={17} />
                  </button>
                ) : null}
                <div className="playlist-menu-wrap" ref={playlistMenuRef}>
                  <button
                    className="tool-button"
                    type="button"
                    aria-label="更多歌单操作"
                    aria-haspopup="menu"
                    aria-expanded={playlistMenuOpen}
                    title="更多歌单操作"
                    onClick={() => setPlaylistMenuOpen((current) => !current)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  {playlistMenuOpen ? (
                    <div className="playlist-action-menu" role="menu" aria-label="歌单操作">
                      {!isSelectedPlaylistProtected ? (
                        <button className="playlist-action-menu-item" type="button" role="menuitem" onClick={() => void handleRenamePlaylist()}>
                          <Pencil size={14} />
                          <span>重命名歌单</span>
                        </button>
                      ) : null}
                      <div className="playlist-action-menu-section" role="presentation">
                        <span>排序方式</span>
                        {playlistSortOptions.map((option) => (
                          <button
                            className="playlist-action-menu-item playlist-action-menu-item--checkable"
                            type="button"
                            role="menuitemradio"
                            aria-checked={selectedPlaylist.sortMode === option.value}
                            key={option.value}
                            onClick={() => void handleUpdatePlaylistSort(option.value)}
                          >
                            <span>{option.label}</span>
                            {selectedPlaylist.sortMode === option.value ? <Check size={14} /> : null}
                          </button>
                        ))}
                      </div>
                      <div className="playlist-action-menu-section" role="presentation">
                        <span>导出歌单</span>
                        {playlistExportOptions.map((option) => (
                          <button
                            className="playlist-action-menu-item"
                            type="button"
                            role="menuitem"
                            key={option.value}
                            onClick={() => void handleExportPlaylist(option.value)}
                          >
                            <Download size={14} />
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                {!isSelectedPlaylistProtected ? (
                  <button className="tool-button danger" type="button" aria-label="删除歌单" title="删除歌单" onClick={() => void handleDeletePlaylist()}>
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            </header>

            {playlistDownloadSummary ? (
              <div className="playlist-download-progress" role="status" data-active={playlistDownloadSummary.isActive ? 'true' : undefined}>
                <div className="playlist-download-progress-copy">
                  <Download size={15} />
                  <span title={playlistDownloadSummary.playlistName}>下载歌单：{playlistDownloadSummary.playlistName}</span>
                  <strong>
                    {playlistDownloadSession?.active && playlistDownloadSummary.enqueued < playlistDownloadSummary.total
                      ? `加入队列 ${playlistDownloadSummary.enqueued}/${playlistDownloadSummary.total}`
                      : `完成 ${playlistDownloadSummary.completed}/${playlistDownloadSummary.total}`}
                  </strong>
                </div>
                <div
                  className="playlist-download-progress-track"
                  role="progressbar"
                  aria-label="歌单下载进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={playlistDownloadSummary.progress}
                >
                  <span style={{ width: `${playlistDownloadSummary.progress}%` }} />
                </div>
                <small>
                  {playlistDownloadSummary.failed > 0
                    ? `${playlistDownloadSummary.failed} 首失败或跳过`
                    : playlistDownloadSummary.isActive
                      ? '后台下载中，播放不受影响'
                      : '歌单下载任务已完成'}
                </small>
              </div>
            ) : null}

            <TrackList
              tracks={displayTracks}
              currentTrackId={currentTrackId}
              canLoadMore={itemsPage.hasMore && !isLoading}
              onEndReached={handleLoadMore}
              onDownload={canDownloadSelectedPlaylist ? handleDownloadTrack : undefined}
              downloadingTrackIds={downloadingTrackIds}
              downloadProgressByTrackId={downloadProgressByTrackId}
              likedTrackIds={visibleLikedTrackIds}
              onToggleLiked={(track) => void handleToggleLiked(track)}
              isTrackDraggable={isTrackReorderable}
              draggedTrackId={draggedPlaylistItemId}
              dropTargetTrackId={dropTargetPlaylistItemId}
              onTrackDragStart={handlePlaylistItemDragStart}
              onTrackDragOver={handlePlaylistItemDragOver}
              onTrackDrop={handlePlaylistItemDrop}
              onTrackDragEnd={handlePlaylistItemDragEnd}
              onOpenTrackMenu={handleOpenTrackMenu}
              onPlay={handleTrackPlay}
            />
          </>
        ) : (
          <div className="playlist-start">
            <Music2 size={36} />
            <strong>{t('playlistsPage.empty.createFirst')}</strong>
            <button className="primary-action" type="button" onClick={() => void handleCreatePlaylist()}>
              <Plus size={16} />
              <span>{t('playlistsPage.empty.create')}</span>
            </button>
          </div>
        )}

        {error || statusMessage || isLoading ? (
          <div className="list-footer">
            <span>{error ?? statusMessage ?? t('playlistsPage.status.loading')}</span>
            {spotifyPlaylistHelpUrl ? (
              <button className="text-action" type="button" onClick={() => void handleOpenSpotifyPlaylistForCopy()}>
                <ExternalLink size={13} />
                打开 Spotify 复制歌单
              </button>
            ) : null}
            {selectedPlaylist && !isLoading ? (
              <button
                className="text-action"
                type="button"
                disabled={isRefreshingStreamingPlaylist}
                onClick={() =>
                  void (selectedStreamingPlaylistUrl || isSelectedPlaylistNeteaseDailyRecommend ? handleRefreshStreamingPlaylist() : refreshSelected())
                }
              >
                刷新
              </button>
            ) : null}
          </div>
        ) : null}

        {trackMenu && playlistPanelView === 'local' ? (
          <TrackContextMenu
            track={trackMenu.track}
            position={trackMenu.position}
            liked={likedTrackIds[trackMenu.track.id] === true}
            enabledActions={playlistTrackMenuActions}
            showRemoveFromPlaylist={!isSelectedPlaylistProtected && Boolean(trackMenu.track.playlistItemId)}
            onAction={(action, track, playlist) => void handleTrackMenuAction(action, track, playlist)}
            onClose={() => setTrackMenu(null)}
          />
        ) : null}
      </section>
    </div>
  );
};
