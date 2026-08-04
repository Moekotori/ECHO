import { getAppSettings } from '../../app/appSettings';
import { assertProtectedLibraryAvailable } from '../../app/dataProtection';
import { createDatabase } from '../../database/createDatabase';
import type { EchoDatabase } from '../../database/createDatabase';
import { getLibraryDatabaseManager } from '../../database/LibraryDatabaseManager';
import type { AppSettings, RemoteAlbumMergeStrategy } from '../../../shared/types/appSettings';
import type { LibraryPage, LibraryTrack } from '../../../shared/types/library';
import type {
  RemoteAlbumGroupingPreview,
  RemoteDirectoryItem,
  RemoteBackgroundJobKind,
  RemoteBackgroundGlobalStatus,
  RemoteBackgroundJobStatus,
  RemoteCoverResult,
  RemoteDirectoryPreviewItem,
  RemoteDirectoryPreviewOptions,
  RemoteIndexedFolderStats,
  RemoteIndexedTracksQuery,
  RemoteLibraryTrack,
  RemoteMetadataResult,
  RemoteSourceIssueItem,
  RemoteSourceIssueKind,
  RemoteSourceOverview,
  RemoteRuntimeLimits,
  RemoteScanItem,
  RemoteSource,
  RemoteSourceInput,
  RemoteSourceProvider,
  RemoteSourceUpdate,
  RemoteStreamUrlResult,
  RemoteSyncOptions,
  RemoteSyncStatus,
  RemoteTrackLookupItem,
  RemoteVisibleHydrationOptions,
  TestRemoteSourceResult,
} from '../../../shared/types/remoteSources';
import { RemoteLibraryStore } from './RemoteLibraryStore';
import { RemoteBackgroundJobQueue } from './RemoteBackgroundJobQueue';
import { RemoteLibrarySyncService } from './RemoteLibrarySyncService';
import { RemoteStreamProxyService } from './RemoteStreamProxyService';
import type { RemoteSourceAdapter } from './remoteTypes';
import { WebDavRemoteSourceAdapter } from './adapters/WebDavRemoteSourceAdapter';
import { BaiduRemoteSourceAdapter } from './adapters/BaiduRemoteSourceAdapter';
import { EmbyRemoteSourceAdapter, JellyfinRemoteSourceAdapter } from './adapters/MediaServerRemoteSourceAdapter';
import { SubsonicRemoteSourceAdapter } from './adapters/SubsonicRemoteSourceAdapter';
import { RemoteFileSystemAdapter } from './adapters/RemoteFileSystemAdapter';
import { CoverService } from '../CoverService';
import { resolveConfiguredCoverCacheDir } from '../CoverCacheManager';
import { normalizeRemoteAlbumMergeStrategy } from './RemoteAlbumGrouping';

const maxPreviewCoverBytes = 1536 * 1024;
const sourceListCacheTtlMs = 5000;
const overviewCacheTtlMs = 5000;
const albumGroupingPreviewCacheTtlMs = 10000;

const cloneRemoteSource = (source: RemoteSource): RemoteSource => ({
  ...source,
  config: { ...source.config },
});

const cloneStatusCounts = <T extends Record<string, number>>(counts: T): T => ({ ...counts });

const cloneRemoteSourceOverview = (overview: RemoteSourceOverview): RemoteSourceOverview => ({
  ...overview,
  metadata: cloneStatusCounts(overview.metadata),
  cover: cloneStatusCounts(overview.cover),
  lyrics: cloneStatusCounts(overview.lyrics),
  mv: cloneStatusCounts(overview.mv),
  sources: overview.sources.map((source) => ({
    ...source,
    metadata: cloneStatusCounts(source.metadata),
    cover: cloneStatusCounts(source.cover),
    lyrics: cloneStatusCounts(source.lyrics),
    mv: cloneStatusCounts(source.mv),
  })),
});

const cloneRemoteAlbumGroupingPreview = (preview: RemoteAlbumGroupingPreview): RemoteAlbumGroupingPreview => ({
  ...preview,
});

export class RemoteSourceService {
  private readonly store: RemoteLibraryStore;
  private readonly webdavAdapter = new WebDavRemoteSourceAdapter();
  private readonly baiduAdapter = new BaiduRemoteSourceAdapter();
  private readonly jellyfinAdapter = new JellyfinRemoteSourceAdapter();
  private readonly embyAdapter = new EmbyRemoteSourceAdapter();
  private readonly subsonicAdapter = new SubsonicRemoteSourceAdapter();
  private readonly smbAdapter = new RemoteFileSystemAdapter('smb');
  private readonly sshfsAdapter = new RemoteFileSystemAdapter('sshfs');
  private readonly proxy: RemoteStreamProxyService;
  private readonly backgroundQueue: RemoteBackgroundJobQueue;
  private readonly syncService: RemoteLibrarySyncService;
  private readonly coverService: CoverService | null;
  private sourceListCache: { at: number; sources: RemoteSource[] } | null = null;
  private overviewCache: { at: number; key: string; overview: RemoteSourceOverview } | null = null;
  private albumGroupingPreviewCache: {
    at: number;
    key: string;
    preview: RemoteAlbumGroupingPreview;
  } | null = null;

  constructor(
    private readonly database: EchoDatabase,
    private readonly closeDatabase: () => void = () => undefined,
    coverCacheDir: string | null = null,
  ) {
    this.store = new RemoteLibraryStore(database);
    this.proxy = new RemoteStreamProxyService((provider) => this.getAdapter(provider));
    this.coverService = coverCacheDir ? new CoverService(database, coverCacheDir) : null;
    for (const adapter of [this.webdavAdapter, this.baiduAdapter, this.jellyfinAdapter, this.embyAdapter, this.subsonicAdapter, this.smbAdapter, this.sshfsAdapter]) {
      adapter.setStreamUrlResolver((input) =>
        this.proxy.createStreamUrl(input.source, input.remotePath, input.stableKey, input.expiresInSeconds),
      );
    }
    this.baiduAdapter.setTokenRefreshHandler((sourceId, tokenSecret) => {
      if (!this.store.getSource(sourceId)) {
        return;
      }
      this.store.updateSource({ id: sourceId, secret: tokenSecret, authType: 'token' });
    });
    this.backgroundQueue = new RemoteBackgroundJobQueue(
      this.store,
      (provider) => this.getAdapter(provider),
      this.coverService,
      getRemoteBackgroundRuntimeLimits,
    );
    this.syncService = new RemoteLibrarySyncService(this.store, (provider) => this.getAdapter(provider), () => this.invalidateSourceListCache(), (sourceId, status, options) => {
      this.invalidateSourceListCache();
      this.backgroundQueue.setSourceSyncActive(sourceId, false);
      if (status.status === 'completed') {
        const source = this.store.getSource(sourceId);
        const shouldDeferProviderCovers = source?.provider === 'subsonic';
        const kinds: RemoteBackgroundJobKind[] = options.includeCover === false || shouldDeferProviderCovers
          ? ['metadata', 'duration-backfill']
          : ['metadata', 'duration-backfill', 'cover'];
        this.backgroundQueue.enqueueSource(sourceId, kinds, { priority: 3 });
      }
    });
  }

  listSources(): RemoteSource[] {
    const now = Date.now();
    if (this.sourceListCache && now - this.sourceListCache.at < sourceListCacheTtlMs) {
      return this.sourceListCache.sources.map(cloneRemoteSource);
    }

    const sources = this.store.listSources();
    this.sourceListCache = { at: now, sources: sources.map(cloneRemoteSource) };
    return sources;
  }

  getOverview(sourceId?: string | null): RemoteSourceOverview {
    const key = sourceId ?? '__all__';
    const now = Date.now();
    if (this.overviewCache?.key === key && now - this.overviewCache.at < overviewCacheTtlMs) {
      return cloneRemoteSourceOverview(this.overviewCache.overview);
    }

    const overview = this.store.getOverview(sourceId);
    this.overviewCache = { at: now, key, overview: cloneRemoteSourceOverview(overview) };
    return overview;
  }

  previewAlbumGrouping(targetStrategy?: RemoteAlbumMergeStrategy, sourceId?: string | null): RemoteAlbumGroupingPreview {
    const currentStrategy = normalizeRemoteAlbumMergeStrategy(getAppSettingsSafe().remoteAlbumMergeStrategy);
    const normalizedTarget = normalizeRemoteAlbumMergeStrategy(targetStrategy ?? currentStrategy);
    const key = `${currentStrategy}:${normalizedTarget}:${sourceId ?? '__all__'}`;
    const now = Date.now();
    if (this.albumGroupingPreviewCache?.key === key && now - this.albumGroupingPreviewCache.at < albumGroupingPreviewCacheTtlMs) {
      return cloneRemoteAlbumGroupingPreview(this.albumGroupingPreviewCache.preview);
    }

    const preview = this.store.previewAlbumGrouping(currentStrategy, normalizedTarget, sourceId);
    this.albumGroupingPreviewCache = { at: now, key, preview: cloneRemoteAlbumGroupingPreview(preview) };
    return preview;
  }

  listIssues(sourceId: string, kind: RemoteSourceIssueKind, limit?: number): RemoteSourceIssueItem[] {
    return this.store.listIssues(sourceId, kind, limit);
  }

  createSource(input: RemoteSourceInput): RemoteSource {
    const source = this.store.createSource(input);
    this.invalidateSourceListCache();
    return source;
  }

  updateSource(input: RemoteSourceUpdate): RemoteSource {
    const source = this.store.updateSource(input);
    this.invalidateSourceListCache();
    return source;
  }

  deleteSource(id: string): void {
    this.proxy.clearSourceTokens(id);
    this.store.deleteSource(id);
    this.invalidateSourceListCache();
  }

  disconnectSource(id: string): void {
    this.proxy.clearSourceTokens(id);
    this.store.disconnectSource(id);
    this.invalidateSourceListCache();
  }

  async testSource(sourceIdOrInput: string | RemoteSourceInput): Promise<TestRemoteSourceResult> {
    const source = typeof sourceIdOrInput === 'string' ? this.store.getSourceWithSecret(sourceIdOrInput) : this.inputToTransientSource(sourceIdOrInput);
    if (!source) {
      throw new Error(`Unknown remote source ${sourceIdOrInput}`);
    }

    const adapter = this.getAdapter(source.provider);
    const result = await adapter.testConnection({ source });
    if (typeof sourceIdOrInput === 'string') {
      this.store.updateSourceTestResult(source.id, result.ok, result.message, result.testedAt);
      this.invalidateSourceListCache();
    }
    return result;
  }

  async browse(sourceId: string, path?: string | null): Promise<RemoteDirectoryItem[]> {
    const source = this.requireSource(sourceId);
    return this.getAdapter(source.provider).browse({ source, path });
  }

  syncSource(sourceId: string, options: RemoteSyncOptions = {}): RemoteSyncStatus {
    this.backgroundQueue.setSourceSyncActive(sourceId, true);
    this.invalidateSourceListCache();
    return this.syncService.syncSource(sourceId, options);
  }

  cancelSync(sourceId: string): RemoteSyncStatus {
    this.backgroundQueue.setSourceSyncActive(sourceId, false);
    return this.syncService.cancelSync(sourceId);
  }

  getSyncStatus(sourceId: string): RemoteSyncStatus {
    return this.syncService.getSyncStatus(sourceId);
  }

  rescanChanged(sourceId: string): RemoteSyncStatus {
    return this.syncService.rescanChanged(sourceId);
  }

  removeMissingTracks(sourceId: string): number {
    const changes = this.syncService.removeMissingTracks(sourceId);
    if (changes > 0) {
      this.invalidateSourceListCache();
    }
    return changes;
  }

  startBackgroundJobs(sourceId: string, kinds?: RemoteBackgroundJobKind[]): RemoteBackgroundJobStatus {
    this.requireSource(sourceId);
    this.invalidateOverviewCache();
    return this.backgroundQueue.enqueueSource(sourceId, kinds);
  }

  pauseBackgroundJobs(sourceId: string): RemoteBackgroundJobStatus {
    this.requireSource(sourceId);
    return this.backgroundQueue.pause(sourceId);
  }

  resumeBackgroundJobs(sourceId: string): RemoteBackgroundJobStatus {
    this.requireSource(sourceId);
    return this.backgroundQueue.resume(sourceId);
  }

  getJobStatus(sourceId: string): RemoteBackgroundJobStatus {
    this.requireExistingSource(sourceId);
    return this.backgroundQueue.getStatus(sourceId);
  }

  retryFailedJobs(sourceId: string, kinds?: RemoteBackgroundJobKind[]): RemoteBackgroundJobStatus {
    this.requireSource(sourceId);
    this.invalidateOverviewCache();
    return this.backgroundQueue.retryFailed(sourceId, kinds);
  }

  setBackgroundPaused(paused: boolean): RemoteBackgroundGlobalStatus {
    return this.backgroundQueue.setGlobalPaused(paused);
  }

  getBackgroundGlobalStatus(): RemoteBackgroundGlobalStatus {
    return this.backgroundQueue.getGlobalStatus();
  }

  updateRuntimeLimits(sourceId: string, limits: RemoteRuntimeLimits): RemoteBackgroundJobStatus {
    this.requireExistingSource(sourceId);
    return this.backgroundQueue.updateRuntimeLimits(sourceId, limits);
  }

  setPlaybackActive(active: boolean, options: { lowLoadEnhanced?: boolean } = {}): RemoteBackgroundGlobalStatus {
    return this.backgroundQueue.setPlaybackActive(active, options);
  }

  refreshTrackMetadata(trackId: string): Promise<RemoteLibraryTrack | null> {
    return this.backgroundQueue.runTrackMetadataNow(trackId);
  }

  backfillDuration(trackId: string, durationSeconds: number): RemoteLibraryTrack | null {
    this.store.updateTrackDuration(trackId, durationSeconds);
    this.invalidateOverviewCache();
    return this.store.getTrack(trackId);
  }

  async createStreamUrl(input: { trackId?: string; sourceId?: string; remotePath?: string; stableKey?: string }): Promise<RemoteStreamUrlResult> {
    const track = input.trackId ? this.store.getTrack(input.trackId) : input.sourceId && input.remotePath ? this.store.getTrackBySourcePath(input.sourceId, input.remotePath) : null;
    const sourceId = track?.sourceId ?? input.sourceId;
    const remotePath = track?.remotePath ?? input.remotePath;
    if (!sourceId || !remotePath) {
      throw new Error('sourceId and remotePath are required');
    }

    const source = this.requireSource(sourceId);
    return this.getAdapter(source.provider).createStreamUrl({ source, remotePath, stableKey: track?.stableKey ?? input.stableKey ?? null });
  }

  getTrack(trackId: string): RemoteLibraryTrack | null {
    return this.store.getTrack(trackId);
  }

  getTrackAsLibraryTrack(trackId: string): LibraryTrack | null {
    const track = this.store.getTrack(trackId);
    return track ? this.store.toLibraryTrack(track) : null;
  }

  lookupTracks(sourceId: string, remotePaths: string[]): RemoteTrackLookupItem[] {
    this.requireSource(sourceId);
    return this.store.lookupTracksBySourcePaths(sourceId, remotePaths);
  }

  listIndexedTracks(sourceId: string, rootPath?: string | null): LibraryTrack[] {
    this.requireSource(sourceId);
    return this.store.listTracksBySourceFolder(sourceId, rootPath).map((track) => this.store.toLibraryTrack(track));
  }

  listIndexedTracksPage(sourceId: string, query: RemoteIndexedTracksQuery = {}): LibraryPage<LibraryTrack> {
    this.requireSource(sourceId);
    const page = this.store.listTracksBySourceFolderPage(sourceId, query);
    return {
      ...page,
      items: page.items.map((track) => this.store.toLibraryTrack(track)),
    };
  }

  getIndexedFolderStats(sourceId: string, rootPath?: string | null): RemoteIndexedFolderStats {
    this.requireSource(sourceId);
    return this.store.getIndexedFolderStats(sourceId, rootPath);
  }

  async previewDirectoryItems(
    sourceId: string,
    items: RemoteDirectoryItem[],
    options: RemoteDirectoryPreviewOptions = {},
  ): Promise<RemoteDirectoryPreviewItem[]> {
    const source = this.requireSource(sourceId);
    const adapter = this.getAdapter(source.provider);
    const limit = Math.min(Math.max(1, Math.round(options.limit ?? 12)), 24);
    const includeCover = options.includeCover !== false;
    const audioItems = items
      .filter((item) => item.kind === 'file' && item.audio && typeof item.path === 'string' && item.path.length > 0)
      .slice(0, limit);

    const results: RemoteDirectoryPreviewItem[] = [];
    let cursor = 0;
    const concurrency = Math.min(2, audioItems.length);
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < audioItems.length) {
        const item = audioItems[cursor++];
        const scanItem = {
          ...item,
          sourceId: source.id,
          provider: source.provider,
          remoteUrlHash: '',
          stableKey: `${source.id}:${item.path}:${item.etag ?? item.modifiedAt ?? item.sizeBytes ?? 'unknown'}`,
        };

        const metadata = await adapter.readMetadata({ source, item: scanItem });
        const cover = includeCover && adapter.readCover ? await adapter.readCover({ source, item: { ...scanItem, metadata } }) : null;
        results.push(this.toDirectoryPreviewItem(scanItem.path, metadata, cover?.status ?? 'pending', cover?.data ?? null, cover?.mimeType ?? null));
      }
    });

    await Promise.all(workers);
    const order = new Map(audioItems.map((item, index) => [item.path, index]));
    return results.sort((left, right) => (order.get(left.remotePath) ?? 0) - (order.get(right.remotePath) ?? 0));
  }

  async hydrateVisibleTracks(trackIds: string[], options: RemoteVisibleHydrationOptions = {}): Promise<LibraryTrack[]> {
    const uniqueTrackIds = Array.from(new Set(trackIds.filter((trackId) => typeof trackId === 'string' && trackId.length > 0))).slice(0, 40);
    const tracks = this.store.getTracksByIds(uniqueTrackIds);
    const kinds: RemoteBackgroundJobKind[] = [];

    if (options.metadata !== false) {
      kinds.push('metadata', 'duration-backfill');
    }
    const shouldHydrateCoverImmediately = options.immediateCover === true && options.cover !== false;
    if (options.cover !== false && !shouldHydrateCoverImmediately) {
      kinds.push('cover');
    }

    if (kinds.length > 0) {
      const priority = typeof options.priority === 'number' && Number.isFinite(options.priority) ? Math.round(options.priority) : 10;
      for (const track of tracks) {
        const trackKinds = track.provider === 'subsonic' ? kinds.filter((kind) => kind !== 'cover') : kinds;
        if (trackKinds.length > 0) {
          this.backgroundQueue.enqueueTrack(track, trackKinds, priority);
        }
      }
    }

    return this.store.getTracksByIds(uniqueTrackIds).map((track) => this.store.toLibraryTrack(track));
  }

  async readRemoteCover(trackId: string, size = 512): Promise<RemoteCoverResult> {
    const track = this.store.getTrack(trackId);
    if (!track || track.provider !== 'subsonic') {
      return this.emptyRemoteCover('cover_not_found');
    }

    const source = this.requireSource(track.sourceId);
    const adapter = this.getAdapter(track.provider);
    if (!adapter.readCover) {
      return this.emptyRemoteCover('cover_not_found');
    }

    const item: RemoteScanItem = {
      sourceId: track.sourceId,
      provider: track.provider,
      path: track.remotePath,
      name: track.title,
      kind: 'file',
      sizeBytes: track.sizeBytes,
      modifiedAt: track.modifiedAt,
      etag: track.etag,
      contentType: null,
      audio: true,
      remoteUrlHash: '',
      stableKey: track.stableKey,
      metadata: {
        status: track.metadataStatus,
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtist: track.albumArtist,
        trackNo: track.trackNo,
        discNo: track.discNo,
        year: track.year,
        genre: track.genre,
        duration: track.duration,
        codec: track.codec,
        sampleRate: track.sampleRate,
        bitDepth: track.bitDepth,
        bitrate: track.bitrate,
        fieldSources: track.fieldSources,
        warnings: [],
        errors: [],
      },
    };

    return adapter.readCover({ source, item, size });
  }

  toLibraryTrack(track: RemoteLibraryTrack): LibraryTrack {
    return this.store.toLibraryTrack(track);
  }

  close(): void {
    this.invalidateSourceListCache();
    this.invalidateOverviewCache();
    this.coverService?.close();
    void this.proxy.close();
    this.closeDatabase();
  }

  private invalidateSourceListCache(): void {
    this.sourceListCache = null;
    this.invalidateOverviewCache();
  }

  private invalidateOverviewCache(): void {
    this.overviewCache = null;
    this.albumGroupingPreviewCache = null;
  }

  private toDirectoryPreviewItem(
    remotePath: string,
    metadata: RemoteMetadataResult,
    coverStatus: RemoteDirectoryPreviewItem['coverStatus'],
    coverData: Uint8Array | null,
    coverMimeType: string | null,
  ): RemoteDirectoryPreviewItem {
    const coverThumb = coverData?.byteLength && coverData.byteLength <= maxPreviewCoverBytes
      ? `data:${coverMimeType || 'image/jpeg'};base64,${Buffer.from(coverData).toString('base64')}`
      : null;

    return {
      remotePath,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      albumArtist: metadata.albumArtist,
      trackNo: metadata.trackNo,
      discNo: metadata.discNo,
      year: metadata.year,
      genre: metadata.genre,
      duration: metadata.duration,
      codec: metadata.codec,
      sampleRate: metadata.sampleRate,
      bitDepth: metadata.bitDepth,
      bitrate: metadata.bitrate,
      coverThumb,
      metadataStatus: metadata.status,
      coverStatus,
      fieldSources: metadata.fieldSources,
    };
  }

  private requireSource(sourceId: string) {
    const source = this.store.getSourceWithSecret(sourceId);
    if (!source) {
      throw new Error(`Unknown remote source ${sourceId}`);
    }
    return source;
  }

  private requireExistingSource(sourceId: string): void {
    if (!this.store.hasSource(sourceId)) {
      throw new Error(`Unknown remote source ${sourceId}`);
    }
  }

  private emptyRemoteCover(reason: string): RemoteCoverResult {
    return {
      status: reason === 'cover_not_found' ? 'not_found' : 'partial',
      data: null,
      mimeType: null,
      fieldSources: {},
      warnings: [reason],
      errors: [],
    };
  }

  private getAdapter(provider: string): RemoteSourceAdapter {
    if (provider === 'webdav') {
      return this.webdavAdapter;
    }
    if (provider === 'baidu') {
      return this.baiduAdapter;
    }
    if (provider === 'jellyfin') {
      return this.jellyfinAdapter;
    }
    if (provider === 'emby') {
      return this.embyAdapter;
    }
    if (provider === 'subsonic') {
      return this.subsonicAdapter;
    }
    if (provider === 'smb') {
      return this.smbAdapter;
    }
    if (provider === 'sshfs') {
      return this.sshfsAdapter;
    }

    throw new Error(`Remote source provider ${provider} is not supported yet`);
  }

  private inputToTransientSource(input: RemoteSourceInput) {
    return {
      id: '__test__',
      provider: input.provider as RemoteSourceProvider,
      displayName: input.displayName || 'Remote source',
      status: input.status ?? 'enabled',
      baseUrl: input.baseUrl ?? null,
      username: input.username ?? null,
      authType: input.authType ?? 'basic',
      config: input.config ?? {},
      syncMode: input.syncMode ?? 'index',
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      indexedTrackCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      secret: input.secret ?? null,
    };
  }
}

export const createRemoteSourceService = (databasePath: string): RemoteSourceService => {
  const database = createDatabase(databasePath);
  const coverCacheDir = databasePath === ':memory:' ? null : resolveConfiguredCoverCacheDir(databasePath, getAppSettingsSafe());
  return new RemoteSourceService(database, () => database.close(), coverCacheDir);
};

const getAppSettingsSafe = (): Pick<AppSettings, 'coverCacheDir'> & Partial<AppSettings> => {
  try {
    return getAppSettings();
  } catch {
    return { coverCacheDir: null };
  }
};

const getRemoteBackgroundRuntimeLimits = (): RemoteRuntimeLimits => {
  const concurrency = getAppSettingsSafe().remoteBackgroundConcurrency;
  if (!concurrency) {
    return {};
  }

  return {
    metadataConcurrency: concurrency.metadata,
    coverConcurrency: concurrency.cover,
    lyricsConcurrency: concurrency.lyrics,
    mvConcurrency: concurrency.mv,
    durationBackfillConcurrency: concurrency.durationBackfill,
  };
};

let defaultRemoteSourceService: RemoteSourceService | null = null;

export const getRemoteSourceService = (): RemoteSourceService => {
  assertProtectedLibraryAvailable();
  if (!defaultRemoteSourceService) {
    const databaseConnection = getLibraryDatabaseManager().openServiceConnection('remote-source');
    const coverCacheDir = resolveConfiguredCoverCacheDir(databaseConnection.databasePath, getAppSettingsSafe());
    defaultRemoteSourceService = new RemoteSourceService(databaseConnection.database, databaseConnection.close, coverCacheDir);
  }

  return defaultRemoteSourceService;
};

export const closeDefaultRemoteSourceService = (): void => {
  if (!defaultRemoteSourceService) {
    return;
  }

  defaultRemoteSourceService.close();
  defaultRemoteSourceService = null;
};
