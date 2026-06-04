import type { EchoDatabase } from '../database/createDatabase';
import { getLibraryDatabaseManager, type LibraryDatabaseConnection } from '../database/LibraryDatabaseManager';
import { getAppSettings } from '../app/appSettings';
import { assertProtectedLibraryAvailable } from '../app/dataProtection';
import { BPM_CONFIDENCE_THRESHOLD } from '../../shared/constants/audioAnalysis';
import type { BpmAnalysisResult } from '../../shared/types/library';
import type {
  StreamingLyricsResult,
  StreamingFavoriteCollectionDeleteResult,
  StreamingFavoriteCollectionRenameResult,
  StreamingFavoritesImportResult,
  StreamingFavoriteProviderName,
  StreamingFavoriteSetResult,
  StreamingFavoritesSnapshot,
  StreamingLikedSongsSyncProviderResult,
  StreamingLikedSongsSyncResult,
  StreamingAlbumDetail,
  StreamingArtistDetail,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylistImportResult,
  StreamingProviderDescriptor,
  StreamingProviderName,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
  StreamingTrackSourceInfo,
} from '../../shared/types/streaming';
import { defaultStreamingAudioQuality, streamingStableKey } from '../../shared/types/streaming';
import { BpmAnalyzer } from '../library/audioAnalysis/BpmAnalyzer';
import { backupPlaylistIfEnabled } from '../library/PlaylistBackup';
import { StreamingCacheStore } from './StreamingCacheStore';
import { StreamingMemoryCache } from './StreamingMemoryCache';
import { StreamingPlaybackResolver } from './StreamingPlaybackResolver';
import { StreamingFavoritesStore } from './StreamingFavoritesStore';
import type { StreamingProvider } from './StreamingProvider';
import { StreamingProviderRegistry } from './StreamingProviderRegistry';
import { StreamingRateLimiter } from './StreamingRateLimiter';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { getAccountService } from '../accounts/AccountService';
import { createDownloadAuthorizationToken, isProtectedMusicDownloadProvider, type ProtectedMusicDownloadProvider } from '../downloads/DownloadAuthorization';
import { MockStreamingProvider } from './providers/MockStreamingProvider';
import { NeteaseStreamingProvider } from './providers/NeteaseStreamingProvider';
import { QQMusicStreamingProvider } from './providers/QQMusicStreamingProvider';
import { KugouStreamingProvider } from './providers/KugouStreamingProvider';
import { BilibiliStreamingProvider } from './providers/BilibiliStreamingProvider';
import { YouTubeStreamingProvider } from './providers/YouTubeStreamingProvider';
import { SoundCloudStreamingProvider } from './providers/SoundCloudStreamingProvider';
import { SpotifyStreamingProvider } from './providers/SpotifyStreamingProvider';
import { TidalStreamingProvider } from './providers/TidalStreamingProvider';
import { M3u8StreamingProvider } from './providers/M3u8StreamingProvider';
import { PluginStreamingProvider } from './providers/PluginStreamingProvider';
import { buildM3u8StreamingPlaylistDetail } from './M3u8Playlist';

const searchTtlMs = 5 * 60 * 1000;
const trackDetailTtlMs = 30 * 60 * 1000;
const maxPlaybackTtlMs = 5 * 60 * 1000;
const fallbackPlaybackTtlMs = 2 * 60 * 1000;
const providerTimeoutMs = 10 * 1000;
const playbackProviderTimeoutMs = 30 * 1000;
const likedSongsSyncTimeoutMs = 45 * 1000;
const albumCacheWriteInitialDelayMs = 250;
const albumCacheWritePlaybackDelayMs = 1500;
const albumCacheWriteMaxDeferrals = 20;
const searchCacheVersion = 'v10';
const playbackCacheVersion = 'v2';
const lyricsCacheVersion = 'v4';
const playlistImportPageSize = 500;
const favoritesImportPageSize = 100;
const likedSongsSyncPageSize = 100;
const maxPlaylistImportTracks = 20_000;
const maxFavoritesImportTracks = 5_000;
const likedSongsSyncProviders = ['netease', 'qqmusic'] as const;
const qqShareLinkUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

type LikedSongsSyncProviderName = (typeof likedSongsSyncProviders)[number];

type StreamingTrackRequest = {
  provider: StreamingProviderName;
  providerTrackId: string;
};

type StreamingPlaybackActivityProvider = () => boolean | Promise<boolean>;

type StreamingPlaylistUrlTarget = {
  provider: Extract<StreamingProviderName, 'netease' | 'qqmusic' | 'kugou' | 'spotify'>;
  providerPlaylistId: string;
};

type StreamingFavoritePlaylistUrlTarget = {
  provider: StreamingFavoriteProviderName;
  providerPlaylistId: string;
};

const defaultPlaybackActivityProvider: StreamingPlaybackActivityProvider = async () => {
  try {
    const { getAudioSession } = await import('../audio/AudioSession');
    const state = getAudioSession().getStatus().state;
    return state === 'loading' || state === 'playing';
  } catch {
    return false;
  }
};

const canAuthorizeProtectedMusicDownload = (provider: ProtectedMusicDownloadProvider): boolean => {
  const account = getAccountService();
  const status = account.getStatus(provider);
  const cookie = account.getCredentials(provider).cookie?.trim();
  return status.connected && Boolean(cookie);
};

const expiresAtFromTtl = (ttlMs: number): string => new Date(Date.now() + ttlMs).toISOString();

const normalizePage = (value: number | undefined): number => Math.max(1, Math.floor(value ?? 1));

const normalizePageSize = (value: number | undefined): number => Math.min(50, Math.max(1, Math.floor(value ?? 20)));

const normalizeSearchRequest = (request: StreamingSearchRequest): StreamingSearchRequest => ({
  provider: request.provider,
  query: request.query.trim(),
  mediaTypes: request.mediaTypes?.length ? request.mediaTypes : ['track'],
  page: normalizePage(request.page),
  pageSize: normalizePageSize(request.pageSize),
});

const searchCacheKey = (request: StreamingSearchRequest): string =>
  `search:${searchCacheVersion}:${request.provider}:${request.query.trim().toLocaleLowerCase()}:${(request.mediaTypes ?? ['track']).join(',')}:${normalizePage(
    request.page,
  )}:${normalizePageSize(request.pageSize)}`;

const trackCacheKey = (provider: StreamingProviderName, providerTrackId: string): string =>
  `track:${provider}:${providerTrackId}`;

const albumCacheKey = (provider: StreamingProviderName, providerAlbumId: string): string =>
  `album:${searchCacheVersion}:${provider}:${providerAlbumId}`;

const artistCacheKey = (provider: StreamingProviderName, providerArtistId: string): string =>
  `artist:${searchCacheVersion}:${provider}:${providerArtistId}`;

const normalizePlaybackRequest = (request: StreamingPlaybackRequest): StreamingPlaybackRequest => ({
  ...request,
  quality: request.quality ?? defaultStreamingAudioQuality,
});

const playbackCacheKey = (request: StreamingPlaybackRequest): string =>
  `playback:${playbackCacheVersion}:${request.provider}:${request.providerTrackId}:${request.quality ?? defaultStreamingAudioQuality}`;

const lyricsCacheKey = (provider: StreamingProviderName, providerTrackId: string): string =>
  `lyrics:${lyricsCacheVersion}:streaming:${provider}:${providerTrackId}`;

const mvCacheKey = (provider: StreamingProviderName, providerTrackId: string): string =>
  `mv:streaming:${provider}:${providerTrackId}`;

const parsePlaylistUrl = (rawUrl: string): URL => {
  const trimmed = rawUrl.trim();
  const spotifyUri = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/iu);
  if (spotifyUri) {
    return new URL(`https://open.spotify.com/playlist/${spotifyUri[1]}`);
  }

  const embeddedUrl = trimmed.match(/https?:\/\/[^\s"'<>]+/iu)?.[0]?.replace(/[),，。；;!！?？\]}）】]+$/u, '');
  try {
    return new URL(embeddedUrl ?? trimmed);
  } catch {
    throw new Error('Please enter a valid streaming playlist URL.');
  }
};

const qqPlaylistIdFromCandidate = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  const match = trimmed.match(/^\d{5,}$/u);
  return match ? match[0] : null;
};

const kugouPlaylistIdFromCandidate = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  const match = trimmed.match(/^\d{3,}$/u);
  return match ? match[0] : null;
};

const playlistIdFromParsedUrl = (url: URL, depth = 0): StreamingPlaylistUrlTarget | null => {
  const host = url.hostname.toLocaleLowerCase();
  const hashUrl = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const combinedPath = `${url.pathname}${hashUrl}`;
  const hashParamSources = (() => {
    if (!hashUrl) {
      return [] as URLSearchParams[];
    }

    const sources: URLSearchParams[] = [];
    const queryIndex = hashUrl.indexOf('?');
    if (queryIndex >= 0) {
      sources.push(new URLSearchParams(hashUrl.slice(queryIndex + 1)));
    }
    if (/^[^/?#]+=/u.test(hashUrl)) {
      sources.push(new URLSearchParams(hashUrl));
    }
    return sources;
  })();
  const findParam = (...names: string[]): string | null => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value?.trim()) {
        return value.trim();
      }

      for (const hashSearch of hashParamSources) {
        const hashValue = hashSearch.get(name);
        if (hashValue?.trim()) {
          return hashValue.trim();
        }
      }
    }

    return null;
  };
  const findNestedUrl = (): URL | null => {
    if (depth >= 2) {
      return null;
    }

    for (const name of ['url', 'u', 'target', 'redirect', 'redirect_url', 'jump', 'jumpurl', 'link', 'shareUrl']) {
      const value = findParam(name);
      if (!value || !/^https?:\/\//iu.test(value)) {
        continue;
      }

      try {
        return new URL(value);
      } catch {
        continue;
      }
    }

    return null;
  };

  if (host.includes('music.163.com') || host.includes('163cn.tv')) {
    const djRadioId = findParam('id', 'radioId', 'djradioId') ?? combinedPath.match(/djradio\/(\d+)/iu)?.[1] ?? null;
    if (djRadioId && /(?:^|\/)(?:m\/)?djradio(?:[/?#]|$)/iu.test(combinedPath)) {
      return { provider: 'netease', providerPlaylistId: `djradio:${djRadioId}` };
    }

    const id = findParam('id', 'playlistId') ?? combinedPath.match(/playlist\/(\d+)/iu)?.[1] ?? null;
    if (id) {
      return { provider: 'netease', providerPlaylistId: id };
    }
  }

  if (host.includes('y.qq.com') || host.includes('qq.com')) {
    const id = qqPlaylistIdFromCandidate(
      findParam('id', 'disstid', 'dissid', 'dirid', 'dirId', 'tid', 'playlistId', 'playlistid') ??
        combinedPath.match(/(?:playlist|taoge|songlist)\/(\d{5,})(?:\.html)?(?:[/?#]|$)/iu)?.[1] ??
        null,
    );
    if (id) {
      return { provider: 'qqmusic', providerPlaylistId: id };
    }
  }

  if (host.includes('kugou.com')) {
    const id = kugouPlaylistIdFromCandidate(
      findParam('specialid', 'specialId', 'global_collection_id', 'gcid', 'id', 'playlistId', 'playlistid') ??
        combinedPath.match(/(?:special\/single|special|plist\/list)\/(\d{3,})(?:\.html)?(?:[/?#]|$)/iu)?.[1] ??
        combinedPath.match(/songlist\/(?:gcid_)?(\d{3,})(?:\.html)?(?:[/?#]|$)/iu)?.[1] ??
        combinedPath.match(/gcid_(\d{3,})/iu)?.[1] ??
        null,
    );
    if (id) {
      return { provider: 'kugou', providerPlaylistId: id };
    }
  }

  if (host === 'open.spotify.com' || host.endsWith('.spotify.com')) {
    const id = combinedPath.match(/playlist\/([A-Za-z0-9]+)/iu)?.[1] ?? null;
    if (id) {
      return { provider: 'spotify', providerPlaylistId: id };
    }
  }

  const nestedUrl = findNestedUrl();
  if (nestedUrl) {
    return playlistIdFromParsedUrl(nestedUrl, depth + 1);
  }

  return null;
};

const favoritePlaylistIdFromParsedUrl = (url: URL, depth = 0): StreamingFavoritePlaylistUrlTarget | null => {
  const host = url.hostname.toLocaleLowerCase();
  const hashUrl = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const combinedPath = `${url.pathname}${hashUrl}`;
  const findParam = (...names: string[]): string | null => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value?.trim()) {
        return value.trim();
      }
    }

    if (hashUrl) {
      const queryIndex = hashUrl.indexOf('?');
      const hashSearch = new URLSearchParams(queryIndex >= 0 ? hashUrl.slice(queryIndex + 1) : hashUrl);
      for (const name of names) {
        const value = hashSearch.get(name);
        if (value?.trim()) {
          return value.trim();
        }
      }
    }

    return null;
  };
  const findNestedUrl = (): URL | null => {
    if (depth >= 2) {
      return null;
    }

    for (const name of ['url', 'u', 'target', 'redirect', 'redirect_url', 'jump', 'jumpurl', 'link', 'shareUrl']) {
      const value = findParam(name);
      if (!value || !/^https?:\/\//iu.test(value)) {
        continue;
      }

      try {
        return new URL(value);
      } catch {
        continue;
      }
    }

    return null;
  };

  if (host.includes('bilibili.com')) {
    const id = findParam('fid', 'media_id', 'mediaId') ?? combinedPath.match(/favlist\/(\d+)/iu)?.[1] ?? null;
    if (id) {
      return { provider: 'bilibili', providerPlaylistId: url.toString() };
    }
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
    const id = findParam('list') ?? combinedPath.match(/playlist\/([A-Za-z0-9_-]+)/iu)?.[1] ?? null;
    if (id) {
      return { provider: 'youtube', providerPlaylistId: id };
    }
  }

  if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
    const path = url.pathname.toLocaleLowerCase();
    if (path.includes('/sets/') || path.includes('/discover/sets/')) {
      return { provider: 'soundcloud', providerPlaylistId: url.toString() };
    }
  }

  const nestedUrl = findNestedUrl();
  if (nestedUrl) {
    return favoritePlaylistIdFromParsedUrl(nestedUrl, depth + 1);
  }

  return null;
};

const shouldResolveQqShareLink = (url: URL): boolean => {
  const host = url.hostname.toLocaleLowerCase();
  return (host.includes('y.qq.com') || host.includes('qq.com')) && Boolean(url.searchParams.get('__'));
};

const isCancelledManualRedirectError = (error: unknown): boolean =>
  error instanceof Error && /redirect was cancelled/iu.test(error.message);

const fetchQqShareLinkRedirect = async (url: URL): Promise<Response> => {
  const init: RequestInit = {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': qqShareLinkUserAgent,
    },
  };

  try {
    return await fetchWithNetworkProxy(url.toString(), init);
  } catch (error) {
    if (!isCancelledManualRedirectError(error)) {
      throw error;
    }

    return await fetch(url.toString(), init);
  }
};

const resolveQqShareLinkTarget = async (url: URL): Promise<StreamingPlaylistUrlTarget | null> => {
  if (!shouldResolveQqShareLink(url)) {
    return null;
  }

  const response = await fetchQqShareLinkRedirect(url);
  const location = response.headers.get('location')?.trim();
  if (!location) {
    return null;
  }

  try {
    return playlistIdFromParsedUrl(new URL(location, url));
  } catch {
    return null;
  }
};

const resolvePlaylistIdFromUrl = async (rawUrl: string): Promise<StreamingPlaylistUrlTarget> => {
  const parsedUrl = parsePlaylistUrl(rawUrl);
  const target = playlistIdFromParsedUrl(parsedUrl);
  if (target) {
    return target;
  }

  const resolvedTarget = await resolveQqShareLinkTarget(parsedUrl);
  if (resolvedTarget) {
    return resolvedTarget;
  }

  throw new Error('Only NetEase Cloud Music playlists or podcasts, QQ Music, KuGou Music, and Spotify playlist links are supported.');
};

const resolveFavoritePlaylistIdFromUrl = (rawUrl: string): StreamingFavoritePlaylistUrlTarget => {
  const parsedUrl = parsePlaylistUrl(rawUrl);
  const target = favoritePlaylistIdFromParsedUrl(parsedUrl);
  if (target) {
    return target;
  }

  throw new Error('Only Bilibili favorites, YouTube playlists, and SoundCloud sets are supported for streaming favorites.');
};

const cleanError = (error: unknown, fallback: string): Error => {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message);
  }

  return new Error(fallback);
};

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const playableTtlMs = (source: StreamingPlaybackSource): number => {
  if (!source.expiresAt) {
    return fallbackPlaybackTtlMs;
  }

  const expiresAtMs = Date.parse(source.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return fallbackPlaybackTtlMs;
  }

  return Math.max(0, Math.min(maxPlaybackTtlMs, expiresAtMs - Date.now() - 30_000));
};

export class StreamingService {
  private readonly playbackResolver: StreamingPlaybackResolver;
  private readonly bpmAnalyzer = new BpmAnalyzer();
  private readonly pendingAlbumCacheWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly registry: StreamingProviderRegistry,
    private readonly cacheStore: StreamingCacheStore,
    private readonly memoryCache = new StreamingMemoryCache(),
    private readonly rateLimiter = new StreamingRateLimiter({ maxConcurrent: 2, minIntervalMs: 150 }),
    private readonly playbackActivityProvider = defaultPlaybackActivityProvider,
    private readonly favoritesStore = new StreamingFavoritesStore(),
  ) {
    this.playbackResolver = new StreamingPlaybackResolver(registry);
  }

  private scheduleAlbumCacheWrite(
    providerName: StreamingProviderName,
    key: string,
    detail: StreamingAlbumDetail,
    delayMs = albumCacheWriteInitialDelayMs,
    deferralCount = 0,
  ): void {
    const existingTimer = this.pendingAlbumCacheWriteTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingAlbumCacheWriteTimers.delete(key);
      void this.writeAlbumCacheWhenReady(providerName, key, detail, deferralCount);
    }, delayMs);
    this.pendingAlbumCacheWriteTimers.set(key, timer);
  }

  private async writeAlbumCacheWhenReady(
    providerName: StreamingProviderName,
    key: string,
    detail: StreamingAlbumDetail,
    deferralCount: number,
  ): Promise<void> {
    const playbackActive = await Promise.resolve(this.playbackActivityProvider()).catch(() => false);
    if (playbackActive) {
      if (deferralCount >= albumCacheWriteMaxDeferrals) {
        console.warn('[streaming] Skipped album cache persistence while playback stayed active.', {
          provider: providerName,
          providerAlbumId: detail.providerAlbumId,
        });
        return;
      }

      this.scheduleAlbumCacheWrite(providerName, key, detail, albumCacheWritePlaybackDelayMs, deferralCount + 1);
      return;
    }

    try {
      this.cacheStore.upsertTracks(detail.tracks);
      this.cacheStore.setApiCache(providerName, 'album', key, detail, expiresAtFromTtl(trackDetailTtlMs));
    } catch (error) {
      console.warn('[streaming] Failed to persist album cache after detail load.', error);
    }
  }

  getProviders(): StreamingProviderDescriptor[] {
    return this.registry.list();
  }

  getFavorites(): StreamingFavoritesSnapshot {
    return this.favoritesStore.getSnapshot();
  }

  setFavorite(track: StreamingTrack, favorite: boolean): StreamingFavoriteSetResult {
    return this.favoritesStore.setFavorite(this.normalizeTrack(track.provider, track), favorite);
  }

  renameFavoriteCollection(collectionId: string, name: string): StreamingFavoriteCollectionRenameResult {
    return this.favoritesStore.renameCollection(collectionId, name);
  }

  deleteFavoriteCollection(collectionId: string): StreamingFavoriteCollectionDeleteResult {
    return this.favoritesStore.deleteCollection(collectionId);
  }

  async syncFavoriteCollection(collectionId: string): Promise<StreamingFavoritesImportResult> {
    const collection = this.favoritesStore.getSnapshot().collections.find((item) => item.id === collectionId.trim());
    if (!collection) {
      throw new Error('Favorite collection was not found.');
    }

    return this.importFavoriteCollection(collection.provider, collection.providerPlaylistId);
  }

  async importFavoritesFromUrl(url: string): Promise<StreamingFavoritesImportResult> {
    const target = resolveFavoritePlaylistIdFromUrl(url);
    return this.importFavoriteCollection(target.provider, target.providerPlaylistId);
  }

  private async importFavoriteCollection(
    targetProvider: StreamingFavoriteProviderName,
    targetProviderPlaylistId: string,
  ): Promise<StreamingFavoritesImportResult> {
    const provider = this.registry.get(targetProvider);
    if (!provider.getPlaylist) {
      throw new Error('This streaming provider does not support favorites import.');
    }

    let page = 1;
    let playlistName = 'Streaming Favorites';
    let providerPlaylistId = targetProviderPlaylistId;
    const importedTracks: StreamingTrack[] = [];

    while (importedTracks.length < maxFavoritesImportTracks) {
      const detail = await this.callProviderWithTimeout(
        provider,
        () =>
          provider.getPlaylist!({
            providerPlaylistId: targetProviderPlaylistId,
            page,
            pageSize: favoritesImportPageSize,
          }),
        'Streaming favorites import',
        playbackProviderTimeoutMs,
      );
      const normalizedTracks = detail.tracks.map((track) => this.normalizeTrack(detail.provider, track));
      playlistName = detail.title;
      providerPlaylistId = detail.providerPlaylistId;
      importedTracks.push(...normalizedTracks.slice(0, Math.max(0, maxFavoritesImportTracks - importedTracks.length)));

      if (!detail.hasMore || normalizedTracks.length === 0) {
        break;
      }

      page += 1;
    }
    const result = this.favoritesStore.importCollection(targetProvider, providerPlaylistId, playlistName, importedTracks);

    return {
      provider: targetProvider,
      providerPlaylistId,
      collectionId: result.collection.id,
      playlistName,
      importedCount: result.importedCount,
      addedCount: result.addedCount,
      snapshot: result.snapshot,
    };
  }

  getFavoritesExportContent(): string {
    return this.favoritesStore.getExportContent();
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const normalized = normalizeSearchRequest(request);
    if (!normalized.query) {
      return {
        provider: normalized.provider,
        query: normalized.query,
        page: normalized.page ?? 1,
        pageSize: normalized.pageSize ?? 20,
        total: 0,
        hasMore: false,
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        mvs: [],
      };
    }

    const key = searchCacheKey(normalized);
    const memoryHit = this.memoryCache.get<StreamingSearchResult>(key);
    if (memoryHit) {
      return { ...memoryHit, cached: true };
    }

    const sqliteHit = this.cacheStore.getApiCache<StreamingSearchResult>(key);
    if (normalized.provider !== 'plugin' && sqliteHit) {
      this.memoryCache.set(key, sqliteHit, searchTtlMs);
      return { ...sqliteHit, cached: true };
    }

    const staleSqliteHit = this.cacheStore.getApiCache<StreamingSearchResult>(key, { allowExpired: true });
    if (normalized.provider !== 'plugin' && staleSqliteHit) {
      void this.refreshSearchCache(normalized, key);
      return { ...staleSqliteHit, cached: true };
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      return this.refreshSearchCache(normalized, key);
    });
  }

  async getTrack(providerName: StreamingProviderName, providerTrackId: string): Promise<StreamingTrack> {
    const key = trackCacheKey(providerName, providerTrackId);
    const memoryHit = this.memoryCache.get<StreamingTrack>(key);
    if (memoryHit) {
      return memoryHit;
    }

    const sqliteHit = this.cacheStore.getTrack(providerName, providerTrackId);
    if (sqliteHit) {
      return this.memoryCache.set(key, sqliteHit, trackDetailTtlMs);
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(providerName);
      const track = this.normalizeTrack(providerName, await this.callProvider(provider, () => provider.getTrack({ providerTrackId }), 'Streaming track'));
      this.cacheStore.upsertTrack(track);
      return this.memoryCache.set(key, track, trackDetailTtlMs);
    });
  }

  getTrackSourceInfo(request: StreamingTrackRequest): StreamingTrackSourceInfo {
    return this.cacheStore.getTrackSourceInfo(request.provider, request.providerTrackId);
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const normalizedRequest = normalizePlaybackRequest(request);
    const key = playbackCacheKey(normalizedRequest);
    const memoryHit = this.memoryCache.get<StreamingPlaybackSource>(key);
    if (memoryHit) {
      return memoryHit;
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(normalizedRequest.provider);
      const source = await this.callProviderWithTimeout(
        provider,
        () => this.playbackResolver.resolve(normalizedRequest),
        'Streaming playback',
        playbackProviderTimeoutMs,
      );
      const authorizedSource = this.attachDownloadAuthorization(normalizedRequest, source);
      const ttlMs = playableTtlMs(source);
      if (ttlMs > 0) {
        this.memoryCache.set(key, authorizedSource, ttlMs);
      }

      return authorizedSource;
    });
  }

  async analyzeBpm(request: StreamingPlaybackRequest): Promise<BpmAnalysisResult> {
    const trackId = streamingStableKey(request.provider, request.providerTrackId);
    const updatedAt = new Date().toISOString();

    try {
      const source = await this.resolvePlayback(request);
      if (source.requiresProxy) {
        throw new Error('streaming_source_requires_proxy');
      }

      const track = await this.getTrack(request.provider, request.providerTrackId).catch(() => null);
      const result = await this.bpmAnalyzer.analyze(source.url, track?.duration ?? undefined, { headers: source.headers });
      const status = result.confidence >= BPM_CONFIDENCE_THRESHOLD ? 'complete' : 'low_confidence';

      return {
        trackId,
        bpm: result.bpm > 0 && status === 'complete' ? result.bpm : null,
        confidence: result.confidence,
        beatOffsetMs: result.beatOffsetMs >= 0 && status === 'complete' ? result.beatOffsetMs : null,
        status,
        error: null,
        updatedAt,
      };
    } catch (error) {
      return {
        trackId,
        bpm: null,
        confidence: 0,
        beatOffsetMs: null,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        updatedAt,
      };
    }
  }

  invalidatePlayback(request: StreamingPlaybackRequest): void {
    this.memoryCache.delete(playbackCacheKey(normalizePlaybackRequest(request)));
  }

  async getLyrics(request: StreamingTrackRequest): Promise<StreamingLyricsResult> {
    const key = lyricsCacheKey(request.provider, request.providerTrackId);
    const memoryHit = this.memoryCache.get<StreamingLyricsResult>(key);
    if (memoryHit) {
      return memoryHit;
    }

    const sqliteHit = this.cacheStore.getApiCache<StreamingLyricsResult>(key);
    if (sqliteHit) {
      return this.memoryCache.set(key, sqliteHit, trackDetailTtlMs);
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(request.provider);
      const result = provider.getLyrics
        ? await this.callProvider(provider, () => provider.getLyrics!({ providerTrackId: request.providerTrackId }), 'Streaming lyrics')
        : {
            provider: request.provider,
            providerTrackId: request.providerTrackId,
            status: 'unknown' as const,
            plainLyrics: null,
            syncedLyrics: null,
            lines: [],
            sourceLabel: null,
          };
      this.cacheStore.setApiCache(request.provider, 'lyrics', key, result, expiresAtFromTtl(trackDetailTtlMs));
      return this.memoryCache.set(key, result, trackDetailTtlMs);
    });
  }

  async getMv(request: StreamingTrackRequest): Promise<StreamingMvResult> {
    const key = mvCacheKey(request.provider, request.providerTrackId);
    const memoryHit = this.memoryCache.get<StreamingMvResult>(key);
    if (memoryHit) {
      return memoryHit;
    }

    const sqliteHit = this.cacheStore.getApiCache<StreamingMvResult>(key);
    if (sqliteHit) {
      return this.memoryCache.set(key, sqliteHit, trackDetailTtlMs);
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(request.provider);
      const result = provider.getMv
        ? await this.callProvider(provider, () => provider.getMv!({ providerTrackId: request.providerTrackId }), 'Streaming MV')
        : {
            provider: request.provider,
            providerTrackId: request.providerTrackId,
            status: 'unknown' as const,
            items: [],
          };
      this.cacheStore.setApiCache(request.provider, 'mv', key, result, expiresAtFromTtl(trackDetailTtlMs));
      return this.memoryCache.set(key, result, trackDetailTtlMs);
    });
  }

  async importPlaylistFromUrl(url: string): Promise<StreamingPlaylistImportResult> {
    const target = await resolvePlaylistIdFromUrl(url);
    const provider = this.registry.get(target.provider);
    if (!provider.getPlaylist) {
      throw new Error('This streaming provider does not support playlist import.');
    }

    let page = 1;
    let importedCount = 0;
    let nextPosition = 0;
    let playlistName = 'Streaming Playlist';
    let playlistId: string | null = null;

    while (importedCount < maxPlaylistImportTracks) {
      const detail = await this.callProvider(
        provider,
        () =>
          provider.getPlaylist!({
            providerPlaylistId: target.providerPlaylistId,
            page,
            pageSize: playlistImportPageSize,
          }),
        'Streaming playlist import',
      );
      const normalizedTracks = detail.tracks.map((track) => this.normalizeTrack(detail.provider, track));
      const normalizedDetail = { ...detail, tracks: normalizedTracks };
      const result = this.cacheStore.importStreamingPlaylistPage(normalizedDetail, {
        reset: page === 1,
        startPosition: nextPosition,
      });
      playlistId = result.playlist.id;
      playlistName = result.playlist.name;
      nextPosition = result.nextPosition;
      importedCount += normalizedTracks.length;

      if (!detail.hasMore || normalizedTracks.length === 0) {
        break;
      }

      page += 1;
    }

    if (!playlistId) {
      const detail = await this.callProvider(
        provider,
        () => provider.getPlaylist!({ providerPlaylistId: target.providerPlaylistId, page: 1, pageSize: playlistImportPageSize }),
        'Streaming playlist import',
      );
      const result = this.cacheStore.importStreamingPlaylistPage({ ...detail, tracks: [] }, { reset: true, startPosition: 0 });
      playlistId = result.playlist.id;
      playlistName = result.playlist.name;
    }

    return {
      playlistId,
      playlistName,
      importedCount,
      provider: target.provider,
      providerPlaylistId: target.providerPlaylistId,
    };
  }

  async refreshNeteaseDailyRecommend(): Promise<StreamingPlaylistImportResult> {
    const provider = this.registry.get('netease');
    if (!provider.getDailyRecommendPlaylist) {
      throw new Error('NetEase daily recommendations are not supported.');
    }

    const detail = await this.callProvider(provider, () => provider.getDailyRecommendPlaylist!(), 'NetEase daily recommendations');
    const normalizedTracks = detail.tracks.map((track) => this.normalizeTrack(detail.provider, track));
    const normalizedDetail = { ...detail, tracks: normalizedTracks };
    const result = this.cacheStore.importStreamingPlaylistPage(normalizedDetail, {
      reset: true,
      startPosition: 0,
      kind: 'system',
      addedFrom: 'netease-daily-recommend',
    });

    return {
      playlistId: result.playlist.id,
      playlistName: result.playlist.name,
      importedCount: normalizedTracks.length,
      provider: 'netease',
      providerPlaylistId: detail.providerPlaylistId,
    };
  }

  async getAlbum(providerName: StreamingProviderName, providerAlbumId: string): Promise<StreamingAlbumDetail> {
    const key = albumCacheKey(providerName, providerAlbumId);
    const memoryHit = this.memoryCache.get<StreamingAlbumDetail>(key);
    if (memoryHit) {
      return memoryHit;
    }

    const sqliteHit = this.cacheStore.getApiCache<StreamingAlbumDetail>(key);
    if (sqliteHit) {
      this.memoryCache.set(key, sqliteHit, trackDetailTtlMs);
      return sqliteHit;
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(providerName);
      if (!provider.getAlbum) {
        throw new Error('This streaming provider does not support album details.');
      }

      const detail = await this.callProvider(provider, () => provider.getAlbum!({ providerAlbumId }), 'Streaming album');
      const normalizedDetail = {
        ...detail,
        provider: providerName,
        providerAlbumId: detail.providerAlbumId.trim() || providerAlbumId,
        id: detail.id || streamingStableKey(providerName, `album:${providerAlbumId}`),
        title: detail.title.trim() || 'Unknown Album',
        artist: detail.artist.trim() || 'Unknown Artist',
        tracks: detail.tracks.map((track) => this.normalizeTrack(providerName, track)),
      };
      this.scheduleAlbumCacheWrite(providerName, key, normalizedDetail);
      return this.memoryCache.set(key, normalizedDetail, trackDetailTtlMs);
    });
  }

  async getArtist(providerName: StreamingProviderName, providerArtistId: string): Promise<StreamingArtistDetail> {
    const key = artistCacheKey(providerName, providerArtistId);
    const memoryHit = this.memoryCache.get<StreamingArtistDetail>(key);
    if (memoryHit) {
      return memoryHit;
    }

    const sqliteHit = this.cacheStore.getApiCache<StreamingArtistDetail>(key);
    if (sqliteHit) {
      this.memoryCache.set(key, sqliteHit, trackDetailTtlMs);
      return sqliteHit;
    }

    return this.memoryCache.getOrCreateInflight(key, async () => {
      const provider = this.registry.get(providerName);
      if (!provider.getArtist) {
        throw new Error('This streaming provider does not support artist details.');
      }

      const detail = await this.callProvider(provider, () => provider.getArtist!({ providerArtistId }), 'Streaming artist');
      const normalizedDetail = {
        ...detail,
        provider: providerName,
        providerArtistId: detail.providerArtistId.trim() || providerArtistId,
        id: detail.id || streamingStableKey(providerName, `artist:${providerArtistId}`),
        name: detail.name.trim() || 'Unknown Artist',
        topTracks: detail.topTracks.map((track) => this.normalizeTrack(providerName, track)),
      };
      this.cacheStore.upsertTracks(normalizedDetail.topTracks);
      this.cacheStore.setApiCache(providerName, 'artist', key, normalizedDetail, expiresAtFromTtl(trackDetailTtlMs));
      return this.memoryCache.set(key, normalizedDetail, trackDetailTtlMs);
    });
  }

  async importM3u8PlaylistFile(filePath: string, content: string): Promise<StreamingPlaylistImportResult> {
    const detail = buildM3u8StreamingPlaylistDetail(filePath, content);
    const result = this.cacheStore.importStreamingPlaylistPage(detail, {
      reset: true,
      startPosition: 0,
      addedFrom: 'm3u8-import',
    });

    return {
      playlistId: result.playlist.id,
      playlistName: result.playlist.name,
      importedCount: detail.tracks.length,
      provider: 'm3u8',
      providerPlaylistId: detail.providerPlaylistId,
    };
  }

  async syncLikedSongs(providerName?: LikedSongsSyncProviderName): Promise<StreamingLikedSongsSyncResult> {
    const targetProviders = providerName ? [providerName] : likedSongsSyncProviders;
    const providers = await Promise.all(targetProviders.map((targetProvider) => this.syncProviderLikedSongs(targetProvider)));
    const firstPlaylistId =
      this.cacheStore.importLikedStreamingTracks([], { addedFrom: 'streaming-liked-sync' }).playlist.id;

    return {
      playlistId: firstPlaylistId,
      importedCount: providers.reduce((total, provider) => total + provider.importedCount, 0),
      addedCount: providers.reduce((total, provider) => total + provider.addedCount, 0),
      providers,
      syncedAt: new Date().toISOString(),
    };
  }

  async setTrackLiked(
    providerName: LikedSongsSyncProviderName,
    providerTrackId: string,
    liked: boolean,
  ): Promise<{ liked: boolean }> {
    const provider = this.registry.get(providerName);
    if (!provider.setTrackLiked) {
      throw new Error('This streaming provider does not support liking tracks.');
    }

    if (!liked) {
      await this.callProviderWithTimeout(
        provider,
        () => provider.setTrackLiked!({ providerTrackId, liked }),
        `${providerName} unlike track`,
        likedSongsSyncTimeoutMs,
      );
      this.cacheStore.unlikeLikedStreamingTrack(providerName, providerTrackId);
      return { liked: false };
    }

    const cachedTrack = this.cacheStore.getTrack(providerName, providerTrackId);
    const track =
      cachedTrack ??
      this.normalizeTrack(
        providerName,
        await this.callProviderWithTimeout(
          provider,
          () => provider.getTrack({ providerTrackId }),
          `${providerName} liked track lookup`,
          providerTimeoutMs,
        ),
      );

    await this.callProviderWithTimeout(
      provider,
      () => provider.setTrackLiked!({ providerTrackId, liked }),
      `${providerName} like track`,
      likedSongsSyncTimeoutMs,
    );
    this.cacheStore.importLikedStreamingTracks([track], { addedFrom: `${providerName}-liked-button` });
    return { liked: true };
  }

  normalizeTrack(provider: StreamingProviderName, raw: StreamingTrack): StreamingTrack {
    const providerTrackId = raw.providerTrackId.trim();
    return {
      ...raw,
      provider,
      providerTrackId,
      id: raw.id || streamingStableKey(provider, providerTrackId),
      stableKey: streamingStableKey(provider, providerTrackId),
      title: raw.title.trim() || 'Untitled',
      artist: raw.artist.trim() || 'Unknown Artist',
      album: raw.album.trim() || 'Unknown Album',
      artists: raw.artists ?? [],
      qualities: raw.qualities ?? [],
      playable: raw.playable !== false,
      unavailableReason: raw.playable === false ? raw.unavailableReason ?? 'This streaming track is unavailable.' : null,
      lyricsStatus: raw.lyricsStatus ?? 'unknown',
      mvStatus: raw.mvStatus ?? 'unknown',
    };
  }

  private async callProvider<T>(provider: StreamingProvider, work: () => Promise<T>, label: string): Promise<T> {
    return this.callProviderWithTimeout(provider, work, label, providerTimeoutMs);
  }

  private attachDownloadAuthorization(request: StreamingPlaybackRequest, source: StreamingPlaybackSource): StreamingPlaybackSource {
    if (!isProtectedMusicDownloadProvider(request.provider)) {
      return source;
    }
    if (!canAuthorizeProtectedMusicDownload(request.provider)) {
      return source;
    }

    return {
      ...source,
      downloadAuthorizationToken: createDownloadAuthorizationToken({
        provider: request.provider,
        providerTrackId: request.providerTrackId,
        url: source.url,
        expiresAt: source.expiresAt,
      }),
    };
  }

  private async callProviderWithTimeout<T>(provider: StreamingProvider, work: () => Promise<T>, label: string, timeoutMs: number): Promise<T> {
    try {
      return await this.rateLimiter.schedule(provider.name, () => withTimeout(work(), timeoutMs, label));
    } catch (error) {
      throw cleanError(error, `${label} failed.`);
    }
  }

  private async refreshSearchCache(request: StreamingSearchRequest, key: string): Promise<StreamingSearchResult> {
    const provider = this.registry.get(request.provider);
    const result = await this.callProvider(provider, () => provider.search(request), 'Streaming search');
    const normalizedResult = {
      ...result,
      tracks: result.tracks.map((track) => this.normalizeTrack(result.provider, track)),
    };
    if (request.provider !== 'plugin') {
      this.cacheStore.upsertTracks(normalizedResult.tracks);
      this.cacheStore.setApiCache(request.provider, 'search', key, normalizedResult, expiresAtFromTtl(searchTtlMs));
    }
    return this.memoryCache.set(key, normalizedResult, searchTtlMs);
  }

  private async syncProviderLikedSongs(
    providerName: LikedSongsSyncProviderName,
  ): Promise<StreamingLikedSongsSyncProviderResult> {
    try {
      const provider = this.registry.get(providerName);
      if (!provider.getLikedSongsPlaylist) {
        throw new Error('此平台暂不支持“我喜欢”同步。');
      }

      let page = 1;
      let importedCount = 0;
      let addedCount = 0;
      let total: number | null = null;

      while (importedCount < maxPlaylistImportTracks) {
        const detail = await this.callProviderWithTimeout(
          provider,
          () => provider.getLikedSongsPlaylist!({ page, pageSize: likedSongsSyncPageSize }),
          `${providerName} liked songs sync`,
          likedSongsSyncTimeoutMs,
        );
        const normalizedTracks = detail.tracks.map((track) => this.normalizeTrack(detail.provider, track));
        const result = this.cacheStore.importLikedStreamingTracks(normalizedTracks, {
          addedFrom: `${providerName}-liked-sync`,
        });
        importedCount += normalizedTracks.length;
        addedCount += result.addedCount;
        total = detail.total;

        if (!detail.hasMore || normalizedTracks.length === 0) {
          break;
        }

        page += 1;
      }

      return { provider: providerName, success: true, importedCount, addedCount, total };
    } catch (error) {
      return {
        provider: providerName,
        success: false,
        importedCount: 0,
        addedCount: 0,
        total: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const createStreamingProviderRegistry = (): StreamingProviderRegistry => {
  const registry = new StreamingProviderRegistry();
  registry.register(new MockStreamingProvider());
  registry.register(new NeteaseStreamingProvider());
  registry.register(new QQMusicStreamingProvider());
  registry.register(new KugouStreamingProvider());
  registry.register(new BilibiliStreamingProvider());
  registry.register(new YouTubeStreamingProvider());
  registry.register(new SoundCloudStreamingProvider());
  registry.register(new SpotifyStreamingProvider());
  registry.register(new TidalStreamingProvider());
  registry.register(new M3u8StreamingProvider());
  registry.register(new PluginStreamingProvider());
  return registry;
};

export const getStreamingProviderDescriptors = (): StreamingProviderDescriptor[] =>
  createStreamingProviderRegistry().list();

export const readDefaultStreamingFavoritesSnapshot = (): StreamingFavoritesSnapshot =>
  new StreamingFavoritesStore().getSnapshot();

export const createStreamingService = (database: EchoDatabase): StreamingService => {
  const registry = createStreamingProviderRegistry();
  return new StreamingService(
    registry,
    new StreamingCacheStore(database, (playlistId) => backupPlaylistIfEnabled(database, playlistId, 'streaming-refresh', getAppSettings)),
  );
};

let defaultStreamingService: StreamingService | null = null;
let defaultStreamingDatabaseConnection: LibraryDatabaseConnection | null = null;

export const getStreamingService = (): StreamingService => {
  assertProtectedLibraryAvailable();
  if (!defaultStreamingService) {
    defaultStreamingDatabaseConnection = getLibraryDatabaseManager().openServiceConnection('streaming');
    defaultStreamingService = createStreamingService(defaultStreamingDatabaseConnection.database);
  }

  return defaultStreamingService;
};

export const closeDefaultStreamingService = (): void => {
  defaultStreamingService = null;
  if (!defaultStreamingDatabaseConnection) {
    return;
  }

  defaultStreamingDatabaseConnection.close();
  defaultStreamingDatabaseConnection = null;
};
