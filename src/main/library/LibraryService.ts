import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers';
import { setImmediate as yieldToMainLoop, setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../shared/constants/audioExtensions';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { defaultSettings, getAppSettings, setAppSettings } from '../app/appSettings';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../../shared/constants/replayGain';
import {
  assertProtectedLibraryAvailable,
  createDataProtectionSnapshot,
  createScanGuardLibraryDatabaseSnapshot,
  recordLibraryDatabaseMaintenanceEvent,
  restoreProtectedLibraryDatabaseFromScanGuard,
  type LibraryDatabaseScanGuardSnapshot,
} from '../app/dataProtection';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { getLibraryDatabaseManager, type LibraryDatabaseConnection } from '../database/LibraryDatabaseManager';
import { assertDatabaseHealthy, assertDatabaseOpenHealthy } from '../database/health';
import {
  isPlaybackActiveForMainWork,
  runMainBackgroundTask,
  runNonCriticalMainWork,
} from '../diagnostics/MainProcessWorkScheduler';
import {
  logLibraryScanPerf,
  shouldCheckpointScanHealthForDiagnostics,
  shouldDisableScanGuardForDiagnostics,
  shouldDisableScanHealthCheckForDiagnostics,
  shouldRunScanHealthCheckSynchronouslyForDiagnostics,
} from '../diagnostics/LibraryScanPerfDiagnostics';
import { AlbumService } from './AlbumService';
import type { AlbumMergeStrategy } from './AlbumService';
import { getDefaultCoverCacheDir, migrateCoverCache, resolveConfiguredCoverCacheDir, resolveCoverCacheDir } from './CoverCacheManager';
import { LibraryStore } from './LibraryStore';
import { LibraryMoveCandidateService } from './LibraryMoveCandidateService';
import { LibraryMoveRepairService } from './LibraryMoveRepairService';
import {
  LibraryWatcherService,
  isLibraryWatcherAutoRescanEnabled,
  isLibraryWatcherFeatureEnabled,
  type LibraryWatcherDiagnostics,
} from './LibraryWatcherService';
import { inflateMetadataResult } from './MetadataService';
import { getNcmConverter } from './NcmConverter';
import { getKgmConverter } from './KgmConverter';
import { getRecommendedScanConcurrency } from './ScanConcurrency';
import { ScanJobQueue } from './ScanJobQueue';
import { NetworkMetadataService, type NetworkCandidateList, type NetworkRepairResult } from './network/NetworkMetadataService';
import { AlbumOnlineInfoService } from './online/AlbumOnlineInfoService';
import { ArtistEventsService } from './online/ArtistEventsService';
import { ArtistOnlineInfoService, emptyArtistOnlineInfo } from './online/ArtistOnlineInfoService';
import { BpmAnalysisJobQueue } from './audioAnalysis/BpmAnalysisJobQueue';
import { ReplayGainAnalysisJobQueue } from './audioAnalysis/ReplayGainAnalysisJobQueue';
import { LyricsBackfillJobPersistence, LyricsBackfillJobQueue } from './LyricsBackfillJobQueue';
import { ArtistImageCacheService } from './artistImages/ArtistImageCacheService';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import type { ArtistImageLookupInput, ArtistImageProvider } from './artistImages/ArtistImageTypes';
import type { MetadataService } from './MetadataService';
import type {
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryDiagnostics,
  EditableAlbumTags,
  EditableTrackTags,
  LibraryFolder,
  LibraryEmbeddedTagRescanOptions,
  LibraryFolderChildrenQuery,
  LibraryFolderNode,
  LibraryFolderOverview,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryPage,
  LibraryPageQuery,
  LibraryQualityIssuePage,
  LibraryQualityIssueQuery,
  LibraryQualityOverviewItem,
  LibraryInboxBatch,
  LibraryInboxCreatePlaylistRequest,
  LibraryInboxPlaylistResult,
  LibraryInboxQueueResult,
  LibraryInboxTrackPage,
  LibraryInboxTrackQuery,
  LibraryInboxUpdateStateRequest,
  LibraryInboxUpdateStateResult,
  LibraryPlaylist,
  LibraryPlaylistItem,
  LibraryScanStatus,
  LibraryScanOptions,
  LibrarySummary,
  LibraryTrack,
  LibraryCleanupResult,
  LibraryMaintenanceCleanupResult,
  LibraryMoveCandidate,
  LibraryMoveCandidateOptions,
  LibraryMoveRepairResult,
  LibraryLabState,
  LibraryAlbumTagUpdateRequest,
  LibraryTrackTagUpdateRequest,
  CoverVariant,
  MetadataResult,
  PlaybackHistoryEntry,
  PlaybackHistoryQuery,
  PlaybackHistoryRefreshResult,
  PlaybackHistorySummary,
  PlaybackStatsDashboard,
  StartPlaybackHistoryRequest,
  StartPlaybackHistoryResult,
  FinishPlaybackHistoryRequest,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  DuplicateTrackCleanupPreview,
  DuplicateTrackGroup,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
  BpmAnalysisJobStatus,
  BpmAnalysisStartOptions,
  ReplayGainAnalysisJobStatus,
  ReplayGainAnalysisStartOptions,
  LyricsBackfillJobStatus,
  LyricsBackfillStartOptions,
  ArtistImageCacheClearResult,
  ArtistImageCacheEntry,
  ArtistImageCacheSummary,
  ArtistImageJobStatus,
  ArtistImageQueueResult,
  ArtistImageRefreshResult,
  FieldSources,
  ArtistInsights,
  ArtistInsightsOptions,
  ArtistOnlineInfoCacheClearResult,
} from './libraryTypes';
import type {
  EmbeddedTrackTagsLoadResult,
  LibraryCacheClearResult,
  MissingMetadataField,
  MissingMetadataScanResult,
  NetworkApplyOptions,
  LyricsBackgroundCoverResult,
  NetworkMetadataScanJobStatus,
  NetworkTagCandidate,
  NetworkTagCandidateSearchRequest,
  AlbumOnlineInfo,
  AlbumOnlineInfoRequestOptions,
} from '../../shared/types/library';
import type { AppSettings } from '../../shared/types/appSettings';
import type { CoverCacheMigrationResult } from '../../shared/types/coverCache';
import type { ScanConcurrencyRecommendation } from './ScanConcurrency';
import type { CoverExtractor } from './workers/CoverExtractor';
import type { FileScanner } from './workers/FileScanner';
import type { MetadataReader } from './workers/MetadataReader';
import { getNativeFileScannerDiagnostics, NativeThenTsFileScanner } from './workers/NativeFileScanner';
import { getNativeMetadataReaderDiagnostics, NativeThenTsMetadataReader } from './workers/NativeMetadataReader';
import { TsCoverExtractor } from './workers/TsCoverExtractor';
import { TsFileScanner } from './workers/TsFileScanner';
import { TsMetadataReader } from './workers/TsMetadataReader';
import { createWorkerBackedLibraryScanWorkers } from './workers/WorkerBackedLibraryScan';
import { getRemoteSourceService } from './remote/RemoteSourceService';
import { writeEmbeddedTrackTags } from './TagWriter';
import { backupPlaylistIfEnabled, type PlaylistBackupReason } from './PlaylistBackup';
import { NETWORK_AUTO_APPLY_THRESHOLD } from './network/matchScore';
import type { NetworkApplyResult, NetworkProviderName, StoredNetworkMetadataCandidate } from './network/networkTypes';
import type { StreamingProviderName } from '../../shared/types/streaming';

const coverBackfillProviderPriority: NetworkProviderName[] = [
  'netease-cloud-music',
  'qq-music',
  'kugou-music',
  'musicbrainz',
  'cover-art-archive',
  'mock',
];

const coverBackfillProviderScoreBoost: Partial<Record<NetworkProviderName, number>> = {
  'netease-cloud-music': 0.08,
  'qq-music': 0.08,
  'kugou-music': 0.04,
};

const coverBackfillProviderRank = (provider: string): number => {
  const rank = coverBackfillProviderPriority.indexOf(provider as NetworkProviderName);
  return rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
};

const coverBackfillAutoApplyThreshold = (provider: string): number => {
  if (provider === 'netease-cloud-music' || provider === 'qq-music') {
    return 0.45;
  }
  if (provider === 'kugou-music') {
    return 0.45;
  }
  return 0.6;
};

const compareCoverBackfillCandidates = (left: { provider: string; score: number }, right: { provider: string; score: number }): number => {
  const leftBoost = coverBackfillProviderScoreBoost[left.provider as NetworkProviderName] ?? 0;
  const rightBoost = coverBackfillProviderScoreBoost[right.provider as NetworkProviderName] ?? 0;
  const boostedScore = right.score + rightBoost - (left.score + leftBoost);
  return boostedScore || coverBackfillProviderRank(left.provider) - coverBackfillProviderRank(right.provider) || right.score - left.score;
};

const isCoverOnlyNetworkApply = (options: NetworkApplyOptions | undefined): boolean =>
  Boolean(options?.fields?.length === 1 && options.fields.includes('cover'));

type LibraryServiceDependencies = {
  fileScanner?: FileScanner;
  metadataReader?: MetadataReader;
  coverExtractor?: CoverExtractor;
  metadataService?: MetadataService;
  coverCacheDir?: string;
  appSettings?: () => AppSettings;
  metadataConcurrency?: number;
  coverConcurrency?: number;
  artistImageCacheDir?: string;
  artistImageProviders?: ArtistImageProvider[];
  databaseConnection?: LibraryDatabaseConnection;
  closeDatabaseUsersBeforeRecovery?: () => void | Promise<void>;
  runExclusiveDatabaseMaintenance?: <T>(reason: string, action: () => T | Promise<T>) => Promise<T>;
  checkpointDatabase?: (reason: string) => void;
};

const broadcastLibraryChanged = (): void => {
  const startedAtMs = performance.now();
  const windows = (electron as unknown as {
    BrowserWindow?: {
      getAllWindows: () => Array<{ webContents: { send: (channel: string, payload?: unknown) => void } }>;
    };
  }).BrowserWindow?.getAllWindows() ?? [];

  for (const window of windows) {
    window.webContents.send(IpcChannels.LibraryChanged);
  }
  logLibraryScanPerf({
    phase: 'broadcastLibraryChanged',
    durationMs: performance.now() - startedAtMs,
    batchSize: windows.length,
  });
};

const romanizedSearchPattern = /[a-z]{2,}/iu;
const playbackHistoryRefreshConcurrency = 16;

const createEmptyPlaybackStatsDashboard = (): PlaybackStatsDashboard => ({
  generatedAt: new Date().toISOString(),
  totals: {
    playCount: 0,
    completedCount: 0,
    playedSeconds: 0,
    uniqueTracks: 0,
    uniqueArtists: 0,
  },
  topTracks: [],
  topArtists: [],
  topAlbums: [],
  formatBreakdown: [],
  qualityBreakdown: [],
  dailyActivity: [],
});

const isExistingFile = async (filePath: string): Promise<boolean> => {
  try {
    return (await statFile(filePath)).isFile();
  } catch {
    return false;
  }
};

export class LibraryService {
  private artistsDirty = false;
  private groupingRefreshTimer: NodeJS.Timeout | null = null;
  private groupingRefreshQueued = false;
  private groupingRefreshRetryCount = 0;
  private lastGroupingRefreshDurationMs: number | null = null;
  private lastGroupingRefreshAt: string | null = null;
  private groupingRefreshDelayedForPlaybackCount = 0;
  private lastGroupingRefreshError: string | null = null;
  private readonly duplicateRefreshTimers = new Map<DuplicateTrackMode, NodeJS.Timeout>();
  private readonly duplicateRefreshRunning = new Set<DuplicateTrackMode>();
  private readonly playbackStatsDashboardCache = new Map<string, PlaybackStatsDashboard>();
  private artistImageStartupTimer: NodeJS.Timeout | null = null;
  private readonly moveCandidateService: LibraryMoveCandidateService;
  private readonly moveRepairService: LibraryMoveRepairService;
  private watcherService: LibraryWatcherService | null = null;
  private moveCandidateEnabled = false;
  private moveRepairLabEnabled = false;
  private lastMoveRepairAt: string | null = null;
  private lastMoveRepairError: string | null = null;
  private lastWatcherRescanStartedAt: string | null = null;
  private lastWatcherRescanFinishedAt: string | null = null;
  private lastWatcherRescanPathCount = 0;
  private lastMetadataBackfillCount = 0;
  private lastSkippedByCacheCount = 0;
  private searchIndexBackfillTimer: NodeJS.Timeout | null = null;
  private searchIndexBackfillRunning = false;
  private searchIndexBackfillAllowDuringPlayback = false;
  private artistImagePlaybackStatusUnsubscribe: (() => void) | null = null;
  private readonly missingCoverBackfillJobs = new Map<string, NetworkMetadataScanJobStatus>();
  private readonly lyricsBackfillJobQueue: LyricsBackfillJobQueue;
  private closed = false;

  constructor(
    private readonly store: LibraryStore,
    private readonly scanJobQueue: ScanJobQueue,
    private readonly albumService: AlbumService,
    private readonly database: EchoDatabase,
    private readonly closeDatabase: () => void,
    private readonly databasePath: string,
    private coverCacheDir: string,
    private readonly coverExtractor: CoverExtractor = new TsCoverExtractor(),
    private readonly metadataReader: MetadataReader = new TsMetadataReader(),
    private readonly networkMetadataService: NetworkMetadataService | null = null,
    private readonly bpmAnalysisJobQueue: BpmAnalysisJobQueue | null = null,
    private readonly replayGainAnalysisJobQueue: ReplayGainAnalysisJobQueue | null = null,
    private readonly artistImageCacheService: ArtistImageCacheService | null = null,
    private readonly readAppSettings: () => AppSettings = getAppSettingsSafe,
    private readonly scanConcurrency: ScanConcurrencyRecommendation = getRecommendedScanConcurrency(),
    private readonly albumOnlineInfoService: AlbumOnlineInfoService | null = null,
    private readonly artistOnlineInfoService: ArtistOnlineInfoService | null = null,
    private readonly artistEventsService: ArtistEventsService | null = null,
    private readonly closeWorkerResources: () => void = () => undefined,
  ) {
    this.moveCandidateService = new LibraryMoveCandidateService(this.database);
    this.moveRepairService = new LibraryMoveRepairService(this.database, this.moveCandidateService);
    this.lyricsBackfillJobQueue = new LyricsBackfillJobQueue((query) => this.store.getTracks(query), {
      persistence: new LyricsBackfillJobPersistence(this.database),
    });
    this.lyricsBackfillJobQueue.resumeLastIncompleteJob();
    this.bindArtistImagePlaybackDeferral();
    this.artistImageStartupTimer = setTimeout(() => {
      this.artistImageStartupTimer = null;
      this.syncArtistImageBackfillState();
    }, 0);
    this.artistImageStartupTimer.unref?.();
    this.scheduleSearchIndexBackfill();
  }

  addFolder(folderPath: string): LibraryFolder {
    const normalizedPath = resolve(folderPath);
    const pathStat = statSync(normalizedPath);

    if (!pathStat.isDirectory()) {
      throw new Error(`Library folder path is not a directory: ${normalizedPath}`);
    }

    const folder = this.store.addFolder(normalizedPath);
    this.syncLiveLibraryWatcherFromSettings();
    return folder;
  }

  getFolders(): LibraryFolder[] {
    return this.store.getFolders();
  }

  getFolderOverviews(): LibraryFolderOverview[] {
    return this.store.getFolderOverviews();
  }

  getFolderChildren(query: LibraryFolderChildrenQuery): LibraryFolderNode[] {
    return this.store.getFolderChildren(query);
  }

  getFolderTracks(query: LibraryFolderTracksQuery): LibraryPage<LibraryTrack> {
    return this.store.getFolderTracks(query);
  }

  resolveLibraryFolderPath(request: LibraryFolderPathRequest): string {
    return this.store.resolveLibraryFolderPath(request);
  }

  async removeFolder(folderId: string): Promise<void> {
    await this.store.removeFolder(folderId);
    this.syncLiveLibraryWatcherFromSettings();
    this.scheduleGroupingRefresh();
    this.notifyLibraryChanged();
  }

  scanFolder(folderId: string, options: LibraryScanOptions = {}): LibraryScanStatus {
    const folder = this.store.getFolder(folderId);

    if (!folder) {
      throw new Error(`Unknown library folder ${folderId}`);
    }

    const job = this.scanJobQueue.scanFolder(folder, options);
    if (this.readAppSettings().replayGainAnalyzeMissingOnScan === true) {
      void this.scanJobQueue.waitForIdle(job.id).then(() => {
        if (this.readAppSettings().replayGainAnalyzeMissingOnScan === true) {
          this.startReplayGainAnalysis({ limit: 500 });
        }
      }).catch(() => undefined);
    }

    return job;
  }

  scanFolderChanges(folderId: string): LibraryScanStatus {
    const folder = this.store.getFolder(folderId);

    if (!folder) {
      throw new Error(`Unknown library folder ${folderId}`);
    }

    return this.scanJobQueue.scanFolder(folder, {
      changesOnly: true,
      reduceScanPressure: true,
    });
  }

  rescanPaths(folderId: string, paths: string[], options: LibraryScanOptions = {}): LibraryScanStatus {
    const folder = this.store.getFolder(folderId);

    if (!folder) {
      throw new Error(`Unknown library folder ${folderId}`);
    }

    return this.scanJobQueue.scanPaths(folder, paths, options);
  }

  async rescanEmbeddedTags(
    mode: Exclude<NonNullable<LibraryScanOptions['mode']>, 'normal'>,
    options: LibraryEmbeddedTagRescanOptions = {},
  ): Promise<LibraryScanStatus[]> {
    const folders = options.folderId ? (() => {
      const folder = this.store.getFolder(options.folderId);
      if (!folder) {
        throw new Error(`Unknown library folder ${options.folderId}`);
      }
      return [folder];
    })() : this.getFolders();
    const statuses: LibraryScanStatus[] = [];

    for (const folder of folders) {
      statuses.push(this.scanJobQueue.scanStoredTracks(folder, {
        mode,
        reduceScanPressure: true,
        storedTrackPath: options.path,
        storedTrackRecursive: options.recursive !== false,
      }));
      await yieldToMainLoop();
    }

    return statuses;
  }

  getScanStatus(jobId: string): LibraryScanStatus {
    return this.scanJobQueue.getScanStatus(jobId);
  }

  cancelScan(jobId: string): LibraryScanStatus {
    return this.scanJobQueue.cancelScan(jobId);
  }

  getTracks(query?: LibraryPageQuery): LibraryPage<LibraryTrack> {
    this.maybeScheduleRomanizedSearchBackfill(query?.search);
    return this.store.getTracks(query);
  }

  getLibraryQualityOverview(): LibraryQualityOverviewItem[] {
    return this.store.getLibraryQualityOverview();
  }

  getLibraryQualityIssues(query: LibraryQualityIssueQuery): LibraryQualityIssuePage {
    return this.store.getLibraryQualityIssues(query);
  }

  getLibraryInboxBatches(): LibraryInboxBatch[] {
    return this.store.getLibraryInboxBatches();
  }

  getLibraryInboxTracks(query?: LibraryInboxTrackQuery): LibraryInboxTrackPage {
    return this.store.getLibraryInboxTracks(query);
  }

  createPlaylistFromLibraryInbox(request: LibraryInboxCreatePlaylistRequest): LibraryInboxPlaylistResult {
    return this.store.createPlaylistFromLibraryInbox(request);
  }

  getLibraryInboxQueueTracks(query?: LibraryInboxTrackQuery): LibraryInboxQueueResult {
    return this.store.getLibraryInboxQueueTracks(query);
  }

  updateLibraryInboxItemState(request: LibraryInboxUpdateStateRequest): LibraryInboxUpdateStateResult {
    return this.store.updateLibraryInboxItemState(request);
  }

  refreshDuplicateTracks(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    return this.store.refreshDuplicateTracks(mode);
  }

  refreshDuplicateTracksAsync(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackIndexSummary> {
    return this.store.refreshDuplicateTracksAsync(mode);
  }

  refreshDuplicateTracksPlaybackSafe(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackIndexSummary> {
    return runNonCriticalMainWork({
      name: `library:refresh-duplicate-tracks:${mode}`,
      work: () => this.refreshDuplicateTracksAsync(mode),
      fallback: () => {
        this.scheduleDuplicateRefresh(mode);
        return this.getDuplicateIndexSummary(mode);
      },
    });
  }

  previewDuplicateTrackCleanup(mode: DuplicateTrackMode = 'strict'): Promise<DuplicateTrackCleanupPreview> {
    return this.refreshDuplicateTracksAsync(mode).then(() => this.store.getDuplicateTrackCleanupPreview(mode));
  }

  getDuplicateTrackCleanupPreview(mode: DuplicateTrackMode = 'strict'): DuplicateTrackCleanupPreview {
    return this.store.getDuplicateTrackCleanupPreview(mode);
  }

  getDuplicateTrackGroup(trackId: string): DuplicateTrackGroup | null {
    return this.store.getDuplicateTrackGroup(trackId);
  }

  getDuplicateTrackVersions(trackId: string): DuplicateTrackMember[] {
    return this.store.getDuplicateTrackVersions(trackId);
  }

  getDuplicateHiddenCounts(trackIds: string[], mode: DuplicateTrackMode = 'strict'): Record<string, number> {
    return this.store.getDuplicateHiddenCounts(trackIds, mode);
  }

  getDuplicateIndexSummary(mode: DuplicateTrackMode = 'strict'): DuplicateTrackIndexSummary {
    return this.store.getDuplicateIndexSummary(mode);
  }

  getPlaylists(): LibraryPlaylist[] {
    return this.store.getPlaylists();
  }

  createPlaylist(request: CreatePlaylistRequest): LibraryPlaylist {
    return this.store.createPlaylist(request);
  }

  updatePlaylist(request: UpdatePlaylistRequest): LibraryPlaylist {
    return this.store.updatePlaylist(request);
  }

  async updatePlaylistArtwork(request: UpdatePlaylistRequest): Promise<LibraryPlaylist> {
    const coverPath = cleanNullableText(request.coverPath ?? null);

    if (!coverPath) {
      return this.updatePlaylist(request);
    }

    const coverData = readCoverImage(coverPath);
    const coverResult = await this.coverExtractor.extract(coverPath, {
      cacheRoot: this.coverCacheDir,
      metadata: metadataWithEmbeddedCover(coverData.data, coverData.mimeType),
    });
    const coverId = this.store.upsertCover({ ...coverResult, source: 'manual' });

    return this.store.updatePlaylist({
      ...request,
      coverId,
    });
  }

  deletePlaylist(playlistId: string): void {
    this.backupPlaylist(playlistId, 'delete');
    this.store.deletePlaylist(playlistId);
  }

  getPlaylist(playlistId: string): LibraryPlaylist | null {
    return this.store.getPlaylist(playlistId);
  }

  getPlaylistItems(playlistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search'>): LibraryPage<LibraryPlaylistItem> {
    return this.store.getPlaylistItems(playlistId, query);
  }

  addTrackToPlaylist(playlistId: string, trackId: string): LibraryPlaylistItem {
    return this.store.addTrackToPlaylist(playlistId, trackId);
  }

  addStreamingTrackToPlaylist(
    playlistId: string,
    track: Pick<LibraryTrack, 'id' | 'provider' | 'providerTrackId' | 'stableKey' | 'title' | 'artist' | 'album' | 'duration' | 'unavailable'>,
  ): LibraryPlaylistItem {
    return this.store.addStreamingTrackToPlaylist(playlistId, track);
  }

  linkDownloadedStreamingTrack(input: {
    provider: StreamingProviderName;
    providerTrackId: string;
    stableKey?: string | null;
    trackId: string;
  }): { updatedItems: number } {
    return {
      updatedItems: this.store.linkStreamingPlaylistItemsToLocalTrack(input),
    };
  }

  addTracksToPlaylist(playlistId: string, trackIds: string[]): LibraryPlaylistItem[] {
    return this.store.addTracksToPlaylist(playlistId, trackIds);
  }

  removePlaylistItem(itemId: string): void {
    const item = this.store.getPlaylistItem(itemId);
    if (item) {
      this.backupPlaylist(item.playlistId, 'remove-item');
    }
    this.store.removePlaylistItem(itemId);
  }

  movePlaylistItem(playlistId: string, itemId: string, targetPosition: number): void {
    this.store.movePlaylistItem(playlistId, itemId, targetPosition);
  }

  clearPlaylist(playlistId: string): void {
    this.backupPlaylist(playlistId, 'clear');
    this.store.clearPlaylist(playlistId);
  }

  getLikedSongsPlaylist(): LibraryPlaylist {
    return this.store.getLikedSongsPlaylist();
  }

  getLikedAlbumsPlaylist(): LibraryPlaylist {
    return this.store.getLikedAlbumsPlaylist();
  }

  getLikedTracks(query?: LibraryPageQuery): LibraryPage<LibraryPlaylistItem> {
    return this.store.getLikedTracks(query);
  }

  getLikedAlbums(query?: LibraryPageQuery): LibraryPage<LibraryPlaylistItem> {
    return this.store.getLikedAlbums(query);
  }

  isTrackLiked(trackId: string): boolean {
    return this.store.isTrackLiked(trackId);
  }

  isAlbumLiked(albumId: string): boolean {
    return this.store.isAlbumLiked(albumId);
  }

  getLikedTrackIds(trackIds: string[]): Record<string, boolean> {
    return this.store.getLikedTrackIds(trackIds);
  }

  getLikedAlbumIds(albumIds: string[]): Record<string, boolean> {
    return this.store.getLikedAlbumIds(albumIds);
  }

  likeTrack(trackId: string): LibraryPlaylistItem {
    const localTrack = this.store.getTrack(trackId);
    if (localTrack) {
      return this.store.likeTrack(trackId);
    }

    const remoteTrack = getRemoteTrackSafe(trackId);
    if (!remoteTrack) {
      throw new Error(`Unknown track ${trackId}`);
    }

    return this.store.likeRemoteTrack(remoteTrack);
  }

  unlikeTrack(trackId: string): void {
    this.store.unlikeTrack(trackId);
  }

  toggleTrackLiked(trackId: string): { liked: boolean; item?: LibraryPlaylistItem } {
    return this.store.toggleTrackLiked(trackId);
  }

  likeAlbum(albumId: string): LibraryPlaylistItem {
    return this.store.likeAlbum(albumId);
  }

  unlikeAlbum(albumId: string): void {
    this.store.unlikeAlbum(albumId);
  }

  toggleAlbumLiked(albumId: string): { liked: boolean; item?: LibraryPlaylistItem } {
    return this.store.toggleAlbumLiked(albumId);
  }

  clearLikedTracks(sourceProvider?: LibraryPageQuery['sourceProvider']): void {
    this.store.clearLikedTracks(sourceProvider);
  }

  clearLikedAlbums(sourceProvider?: LibraryPageQuery['sourceProvider']): void {
    this.store.clearLikedAlbums(sourceProvider);
  }

  getAlbums(query?: LibraryPageQuery): LibraryPage<LibraryAlbum> {
    return this.store.getAlbums(query);
  }

  getAlbum(albumId: string): LibraryAlbumDetail | null {
    return this.store.getAlbum(albumId);
  }

  getAlbumOnlineInfo(albumId: string, options: AlbumOnlineInfoRequestOptions = {}): Promise<AlbumOnlineInfo> {
    const album = this.getAlbum(albumId);
    if (!album) {
      throw new Error(`Unknown album ${albumId}`);
    }

    const tracks = this.getAllAlbumTracks(albumId);
    const service = this.albumOnlineInfoService ?? new AlbumOnlineInfoService(this.database);
    const settings = this.readAppSettings();
    return service.getAlbumOnlineInfo({ album, tracks }, { ...options, locale: settings.locale, discogsUserToken: settings.onlineAlbumInfoDiscogsUserToken });
  }

  getAlbumForTrack(trackId: string): LibraryAlbum | null {
    return this.store.getAlbumForTrack(trackId);
  }

  getArtists(query?: LibraryPageQuery): LibraryPage<LibraryArtist> {
    this.refreshArtistsIfDirty();
    return this.store.getArtists(query);
  }

  getArtist(artistId: string): LibraryArtist | null {
    return this.store.getArtist(artistId);
  }

  async getArtistInsights(artistId: string, options?: ArtistInsightsOptions): Promise<ArtistInsights> {
    const localInsights = this.store.getArtistInsights(artistId, options);
    if (options?.includeOnline !== true || !localInsights.artist) {
      return localInsights;
    }

    const settings = this.readAppSettings();
    const region = options.region ?? settings.onlineArtistInfoRegion ?? null;
    const [onlineInfo, concerts] = await Promise.all([
      this.artistOnlineInfoService
        ? this.artistOnlineInfoService.getArtistOnlineInfo(localInsights.artist, {
          force: options.forceOnline,
          locale: settings.locale,
          region,
          sources: settings.onlineArtistInfoSources,
        })
        : Promise.resolve(emptyArtistOnlineInfo('Artist online info service is unavailable.')),
      this.artistEventsService
        ? this.artistEventsService.getArtistEvents({
            artistId: localInsights.artist.id,
            artistName: localInsights.artist.name,
            bandsintownAppId: settings.onlineArtistInfoBandsintownAppId,
            ticketmasterApiKey: settings.onlineArtistInfoTicketmasterApiKey,
            seatGeekClientId: settings.onlineArtistInfoSeatGeekClientId,
            region,
            force: options.forceOnline,
          })
        : Promise.resolve(localInsights.concerts),
    ]);

    return {
      ...localInsights,
      onlineInfo,
      concerts,
    };
  }

  getArtistTracks(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryTrack> {
    return this.store.getArtistTracks(artistId, query);
  }

  getArtistAlbums(artistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'sort'>): LibraryPage<LibraryAlbum> {
    return this.store.getArtistAlbums(artistId, query);
  }

  getArtistImage(artistIdOrKey: string): ArtistImageCacheEntry | null {
    if (!this.artistImageCacheService) {
      return null;
    }

    return this.artistImageCacheService.getArtistImage(artistIdOrKey);
  }

  getArtistImageCacheSummary(): ArtistImageCacheSummary {
    if (!this.artistImageCacheService) {
      return {
        total: 0,
        matched: 0,
        pending: 0,
        loading: 0,
        notFound: 0,
        error: 0,
        rateLimited: 0,
      };
    }

    return this.artistImageCacheService.getSummary();
  }

  getArtistImageJobStatus(): ArtistImageJobStatus {
    if (!this.artistImageCacheService) {
      return {
        paused: true,
        running: false,
        queued: 0,
        active: 0,
        lastQueued: { queued: 0, skipped: 0 },
        summary: {
          total: 0,
          matched: 0,
          pending: 0,
          loading: 0,
          notFound: 0,
          error: 0,
          rateLimited: 0,
        },
      };
    }

    const settings = this.readAppSettings();
    this.artistImageCacheService.setPaused(settings.autoFetchArtistImages !== true || settings.artistImageFetchPaused === true);
    return this.artistImageCacheService.getJobStatus();
  }

  setArtistImageJobsPaused(paused: boolean): ArtistImageJobStatus {
    setAppSettings({ artistImageFetchPaused: paused });
    return this.syncArtistImageBackfillState();
  }

  kickoffArtistImageBackfill(options: { force?: boolean; limit?: number } = {}): ArtistImageJobStatus {
    if (!this.artistImagesNetworkEnabled() || !this.artistImageCacheService || this.readAppSettings().artistImageFetchPaused === true) {
      return this.getArtistImageJobStatus();
    }

    return this.artistImageCacheService.kickoffBackfill({
      force: options.force === true,
      limit: options.limit ?? 500,
    });
  }

  syncArtistImageBackfillState(): ArtistImageJobStatus {
    if (!this.artistImageCacheService) {
      return this.getArtistImageJobStatus();
    }

    const settings = this.readAppSettings();
    const paused = settings.autoFetchArtistImages !== true || settings.artistImageFetchPaused === true;
    this.artistImageCacheService.setPaused(paused);

    if (!paused) {
      return this.artistImageCacheService.kickoffBackfill({ force: false, limit: 500 });
    }

    return this.artistImageCacheService.getJobStatus();
  }

  enqueueMissingArtistImages(
    artists: ArtistImageLookupInput[] = [],
    options: { force?: boolean; limit?: number } = {},
  ): ArtistImageQueueResult {
    if (!this.artistImagesNetworkEnabled() || !this.artistImageCacheService) {
      return { queued: 0, skipped: artists.length, disabled: true };
    }

    return this.artistImageCacheService.enqueueMissingArtistImages(artists, options);
  }

  refreshVisibleArtistImages(artists: ArtistImageLookupInput[]): ArtistImageQueueResult {
    if (!this.artistImagesNetworkEnabled() || !this.artistImageCacheService) {
      return { queued: 0, skipped: artists.length, disabled: true };
    }

    return this.artistImageCacheService.refreshVisibleArtistImages(artists);
  }

  refreshArtistImage(artistIdOrKey: string, force = false): Promise<ArtistImageRefreshResult> {
    if (!this.artistImagesNetworkEnabled() || !this.artistImageCacheService) {
      return Promise.resolve({ queued: false, disabled: true, entry: this.getArtistImage(artistIdOrKey) });
    }

    return this.artistImageCacheService.refreshArtistImage(artistIdOrKey, force);
  }

  setCustomArtistImageFromFile(artistIdOrKey: string, filePath: string): Promise<ArtistImageCacheEntry | null> {
    if (!this.artistImageCacheService) {
      return Promise.resolve(null);
    }

    return this.artistImageCacheService.setCustomArtistImageFromFile(artistIdOrKey, filePath);
  }

  setCustomArtistImageFromUrl(artistIdOrKey: string, url: string): Promise<ArtistImageCacheEntry | null> {
    if (!this.artistImageCacheService) {
      return Promise.resolve(null);
    }

    return this.artistImageCacheService.setCustomArtistImageFromUrl(artistIdOrKey, url);
  }

  clearCustomArtistImage(artistIdOrKey: string): ArtistImageCacheEntry | null {
    if (!this.artistImageCacheService) {
      return null;
    }

    return this.artistImageCacheService.clearCustomArtistImage(artistIdOrKey);
  }

  clearArtistImageCache(): ArtistImageCacheClearResult {
    if (!this.artistImageCacheService) {
      return { removedRows: 0, deletedFiles: 0, freedBytes: 0 };
    }

    return this.artistImageCacheService.clearCache();
  }

  clearArtistOnlineInfoCache(): ArtistOnlineInfoCacheClearResult {
    const onlineRows = this.artistOnlineInfoService?.clearCache().removedRows ?? 0;
    const eventRows = this.artistEventsService?.clearCache().removedRows ?? 0;
    return { removedRows: onlineRows + eventRows };
  }

  getAlbumTracks(albumId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize'>): LibraryPage<LibraryTrack> {
    return this.store.getAlbumTracks(albumId, query);
  }

  getAllAlbumTracks(albumId: string): LibraryTrack[] {
    const tracks: LibraryTrack[] = [];
    let page = 1;
    const pageSize = 500;

    for (;;) {
      const result = this.store.getAlbumTracks(albumId, { page, pageSize });
      tracks.push(...result.items);
      if (!result.hasMore) {
        return tracks;
      }
      page += 1;
    }
  }

  getSummary(): LibrarySummary {
    return this.store.getSummary();
  }

  getDiagnostics(): LibraryDiagnostics {
    const nativeFileScanner = getNativeFileScannerDiagnostics(() => this.readAppSettings().nativeFileScannerEnabled === true);
    const nativeMetadataReader = getNativeMetadataReaderDiagnostics(() => this.readAppSettings().nativeMetadataReaderEnabled === true);
    return {
      ...this.store.getDiagnostics({
        databasePath: this.databasePath,
        databaseSizeBytes: pathSize(this.databasePath),
        coverCachePath: this.coverCacheDir,
        coverCacheSizeBytes: directorySize(this.coverCacheDir),
        cpuCount: this.scanConcurrency.cpuCount,
        scanPerformanceMode: this.scanConcurrency.mode === 'custom' ? 'balanced' : this.scanConcurrency.mode,
        metadataConcurrency: this.scanConcurrency.metadataConcurrency,
        coverConcurrency: this.scanConcurrency.coverConcurrency,
        audioAnalysisEnabled: this.readAppSettings().audioAnalysisEnabled,
      }),
      nativeFileScanner,
      nativeMetadataReader,
      groupingRefreshQueued: this.groupingRefreshQueued,
      lastGroupingRefreshDurationMs: this.lastGroupingRefreshDurationMs,
      lastGroupingRefreshAt: this.lastGroupingRefreshAt,
      groupingRefreshDelayedForPlaybackCount: this.groupingRefreshDelayedForPlaybackCount,
      lastGroupingRefreshError: this.lastGroupingRefreshError,
      moveCandidates: this.getMoveCandidates(),
    };
  }

  getMoveCandidates(options: LibraryMoveCandidateOptions = {}): LibraryMoveCandidate[] {
    return this.moveCandidateService.getMoveCandidates(options);
  }

  syncLiveLibraryWatcherFromSettings(): LibraryLabState {
    const settings = this.readAppSettings();
    const watcher = this.getWatcherService();
    const enabled = settings.liveLibraryUpdatesEnabled === true || isLibraryWatcherFeatureEnabled();
    const autoRescanEnabled = settings.liveLibraryUpdatesEnabled === true || isLibraryWatcherAutoRescanEnabled();

    watcher.setEnabled(enabled);
    watcher.setAutoRescanEnabled(autoRescanEnabled);

    if (enabled) {
      if (watcher.isRunning()) {
        watcher.restart();
      } else {
        watcher.start();
      }
    } else {
      watcher.stop();
    }

    return this.getLibraryLabState();
  }

  setLibraryLabWatcherEnabled(enabled: boolean): LibraryLabState {
    this.getWatcherService().setEnabled(enabled);
    return this.getLibraryLabState();
  }

  setLibraryLabAutoRescanEnabled(enabled: boolean): LibraryLabState {
    this.getWatcherService().setAutoRescanEnabled(enabled);
    return this.getLibraryLabState();
  }

  setLibraryLabMoveCandidateEnabled(enabled: boolean): LibraryLabState {
    this.moveCandidateEnabled = enabled;
    return this.getLibraryLabState();
  }

  setLibraryLabMoveRepairLabEnabled(enabled: boolean): LibraryLabState {
    this.moveRepairLabEnabled = enabled;
    return this.getLibraryLabState();
  }

  getLibraryLabState(): LibraryLabState {
    const watcher = this.getWatcherService();
    const diagnostics = watcher.getDiagnostics();
    const candidates = this.moveCandidateEnabled ? this.getMoveCandidates() : [];
    return this.composeLibraryLabState(diagnostics, candidates);
  }

  startLibraryLabWatcher(): LibraryLabState {
    this.getWatcherService().start();
    return this.getLibraryLabState();
  }

  stopLibraryLabWatcher(): LibraryLabState {
    this.getWatcherService().stop();
    return this.getLibraryLabState();
  }

  refreshLibraryLabDiagnostics(): LibraryLabState {
    return this.getLibraryLabState();
  }

  backfillLibraryLabPlaceholderMetadata(): LibraryLabState {
    const targets = this.store.getPlaceholderMetadataTrackTargets(500);
    this.lastMetadataBackfillCount = targets.length;
    this.lastWatcherRescanPathCount = targets.length;
    this.lastWatcherRescanStartedAt = targets.length > 0 ? new Date().toISOString() : this.lastWatcherRescanStartedAt;

    if (targets.length === 0) {
      return this.getLibraryLabState();
    }

    const pathsByFolder = new Map<string, string[]>();
    for (const target of targets) {
      const paths = pathsByFolder.get(target.folderId) ?? [];
      paths.push(target.path);
      pathsByFolder.set(target.folderId, paths);
    }

    const jobs = Array.from(pathsByFolder.entries()).map(([folderId, paths]) =>
      this.rescanPaths(folderId, paths, { deferGroupingRefresh: true }),
    );

    void Promise.all(
      jobs.map((job) =>
        this.scanJobQueue.waitForIdle(job.id).then(() => this.store.getScanJob(job.id)),
      ),
    )
      .then((statuses) => {
        this.lastWatcherRescanFinishedAt = new Date().toISOString();
        this.lastSkippedByCacheCount = statuses.reduce((total, status) => total + (status?.skippedFiles ?? 0), 0);
        this.scheduleGroupingRefresh();
        this.notifyLibraryChanged();
      })
      .catch((error) => {
        this.lastWatcherRescanFinishedAt = new Date().toISOString();
        this.lastGroupingRefreshError = error instanceof Error ? error.message : String(error);
      });

    return this.getLibraryLabState();
  }

  getLibraryLabMoveCandidates(options: LibraryMoveCandidateOptions = {}): LibraryMoveCandidate[] {
    if (!this.moveCandidateEnabled) {
      return [];
    }

    return this.getMoveCandidates(options);
  }

  dryRunLibraryLabMoveRepair(candidateId: string): LibraryMoveRepairResult {
    if (!this.moveRepairLabEnabled) {
      return {
        candidateId,
        ok: false,
        blockers: ['move_repair_lab_disabled'],
        warnings: [],
        oldTrackId: null,
        newTrackId: null,
        playlistItemsToRelink: 0,
        playbackHistoryEntriesToRelink: 0,
        playbackHistoryStatsToRelink: 0,
        deletedOldTrackRow: false,
        appliedAt: null,
      };
    }

    return this.moveRepairService.dryRun(candidateId);
  }

  applyLibraryLabMoveRepair(candidateId: string): LibraryMoveRepairResult {
    if (!this.moveRepairLabEnabled) {
      return this.dryRunLibraryLabMoveRepair(candidateId);
    }

    try {
      const result = this.moveRepairService.apply(candidateId);
      if (result.ok && result.appliedAt) {
        this.lastMoveRepairAt = result.appliedAt;
        this.lastMoveRepairError = null;
        this.scheduleGroupingRefresh();
        this.notifyLibraryChanged();
      } else if (result.blockers.length > 0) {
        this.lastMoveRepairError = result.blockers.join(', ');
      }

      return result;
    } catch (error) {
      this.lastMoveRepairError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  resolveCoverAsset(coverId: string, variant: CoverVariant): { filePath: string; mimeType: string | null } | null {
    return this.store.resolveCoverAsset(coverId, variant);
  }

  resolveArtistImageAsset(
    artistKey: string,
    variant: 'thumb' | 'medium' | 'large',
  ): { filePath: string; mimeType: string | null } | null {
    return this.artistImageCacheService?.resolveAsset(artistKey, variant) ?? null;
  }

  getTrack(trackId: string): LibraryTrack | null {
    const localTrack = this.store.getTrack(trackId);
    if (localTrack) {
      return localTrack;
    }

    try {
      return getRemoteSourceService().getTrackAsLibraryTrack(trackId);
    } catch {
      return null;
    }
  }

  getTrackByPath(filePath: string): LibraryTrack | null {
    return this.store.getTrackByPath(filePath);
  }

  async importAudioFile(
    filePath: string,
    options: {
      folderPath?: string;
      metadata?: Partial<Pick<EditableTrackTags, 'title' | 'artist' | 'album' | 'albumArtist'>>;
      coverUrl?: string | null;
      deferGroupingRefresh?: boolean;
    } = {},
  ): Promise<LibraryTrack> {
    return runMainBackgroundTask('library-import-files', async () => {
      const afterNcm = await getNcmConverter().convertIfNeeded(resolve(filePath));
      const normalizedPath = await getKgmConverter().convertIfNeeded(afterNcm);

      if (!existsSync(normalizedPath)) {
        throw new Error(`Track file is missing: ${normalizedPath}`);
      }

      const initialFileStat = statSync(normalizedPath);
      if (!initialFileStat.isFile()) {
        throw new Error(`Track path is not a file: ${normalizedPath}`);
      }

      const folder = this.store.addFolder(resolve(options.folderPath ?? dirname(normalizedPath)));
      const metadata = await this.metadataReader.read(normalizedPath);
      const metadataOverrides = {
        title: cleanNullableText(options.metadata?.title ?? null) ?? undefined,
        artist: cleanNullableText(options.metadata?.artist ?? null) ?? undefined,
        album: cleanNullableText(options.metadata?.album ?? null) ?? undefined,
        albumArtist: cleanNullableText(options.metadata?.albumArtist ?? null) ?? undefined,
      };
      const metadataFields = {
        ...metadata.fields,
        ...Object.fromEntries(Object.entries(metadataOverrides).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      };
      const fieldSources: MetadataResult['fieldSources'] = {
        ...metadata.fieldSources,
        ...Object.fromEntries(Object.keys(metadataOverrides).filter((key) => metadataOverrides[key as keyof typeof metadataOverrides]).map((key) => [key, 'technical'])),
      };
      let coverId: string | null = null;
      let coverErrors: string[] = [];
      const coverUrl = cleanNullableText(options.coverUrl ?? null);
      const coverData = coverUrl ? await readCoverImageFromUrl(coverUrl, null).catch(() => null) : null;
      const hasMetadataOverrides = hasImportMetadataOverrides(metadataOverrides);
      const embeddedWriteErrors = await writeImportedEmbeddedTags(normalizedPath, metadataFields, coverData, hasMetadataOverrides || Boolean(coverData));
      const fileStat = statSync(normalizedPath);

      try {
        const cover = await this.coverExtractor.extract(normalizedPath, {
          cacheRoot: this.coverCacheDir,
          metadata: coverData ? metadataWithEmbeddedCover(coverData.data, coverData.mimeType) : metadata,
        });
        coverId = this.store.upsertCover(cover);
        coverErrors = cover.errors;
      } catch (error) {
        coverErrors = [error instanceof Error ? error.message : String(error)];
      }

      const timestamp = new Date().toISOString();
      const trackId = randomUUID();
      const trackWrite = {
        path: normalizedPath,
        folderId: folder.id,
        sizeBytes: fileStat.size,
        mtimeMs: Math.round(fileStat.mtimeMs),
        ...metadataFields,
        id: trackId,
        coverId,
        fieldSources,
        embeddedMetadataStatus: hasMetadataOverrides ? 'present' : metadata.embeddedMetadataStatus,
        embeddedCoverStatus: coverData ? 'present' : metadata.embeddedCoverStatus,
        metadataStatus: metadata.status,
        warnings: metadata.warnings,
        errors: [...metadata.errors, ...embeddedWriteErrors, ...coverErrors],
        updatedAt: timestamp,
      };
      const searchTerms = await this.store.prepareTrackSearchTerms(trackWrite);

      const track = this.store.transaction(() => {
        this.store.upsertTrack(trackWrite, searchTerms);
        const track = this.store.getTrack(trackId) ?? this.store.getTrackByPath(normalizedPath);
        if (!track) {
          throw new Error(`Failed to import audio file: ${normalizedPath}`);
        }

        if (this.readAppSettings().replayGainAnalyzeMissingOnScan === true) {
          this.startReplayGainAnalysis({ trackIds: [track.id], force: false });
        }

        if (options.deferGroupingRefresh === true) {
          this.store.seedAlbumsForTracks([track.id], this.albumService, timestamp, this.albumRefreshOptions());
        } else {
          this.store.refreshAlbums(this.albumService, undefined, this.albumRefreshOptions());
          this.store.refreshArtists();
        }

        return track;
      });
      this.scheduleGroupingRefresh();
      return track;
    });
  }

  recordTrackPlayback(trackId: string): void {
    this.store.recordTrackPlayback(trackId);
  }

  startPlaybackHistory(request: StartPlaybackHistoryRequest): StartPlaybackHistoryResult {
    const track = request.trackId ? this.store.getTrack(request.trackId) : null;

    if (!track) {
      const remoteTrack = request.trackId ? getRemoteTrackSafe(request.trackId) : null;
      if (!remoteTrack) {
        if (!request.trackPath || !request.title || !request.artist) {
          throw new Error(`Unknown track ${request.trackId ?? 'snapshot'}`);
        }

        const entry = this.store.createPlaybackHistoryEntry({
          trackId: request.trackId ?? null,
          trackPath: request.trackPath,
          mediaType: request.mediaType ?? 'local',
          provider: request.provider,
          providerTrackId: request.providerTrackId,
          stableKey: request.stableKey,
          title: request.title,
          artist: request.artist,
          album: request.album ?? '',
          albumArtist: request.albumArtist ?? request.artist,
          coverId: request.coverId ?? null,
          coverSnapshot: request.mediaType === 'streaming' ? request.coverSnapshot ?? null : null,
          durationSeconds: request.durationSeconds ?? 0,
          durationSnapshot: request.durationSeconds ?? null,
          sourceType: request.sourceType ?? request.mediaType ?? null,
          sourceLabel: request.sourceLabel,
          queueId: request.queueId,
        });

        return { historyId: entry.id };
      }

      const entry = this.store.createPlaybackHistoryEntry({
        trackId: remoteTrack.id,
        trackPath: remoteTrack.path,
        mediaType: 'remote',
        provider: remoteTrack.provider,
        stableKey: remoteTrack.stableKey,
        title: remoteTrack.title,
        artist: remoteTrack.artist,
        album: remoteTrack.album,
        albumArtist: remoteTrack.albumArtist,
        coverId: remoteTrack.coverId,
        durationSeconds: remoteTrack.duration,
        sourceType: request.sourceType ?? 'remote',
        sourceLabel: request.sourceLabel,
        queueId: request.queueId,
      });

      return { historyId: entry.id };
    }

    if (!track) {
      throw new Error(`Unknown track ${request.trackId}`);
    }

    const entry = this.store.createPlaybackHistoryEntry({
      trackId: track.id,
      trackPath: track.path,
      mediaType: track.mediaType ?? 'local',
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      stableKey: track.stableKey,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      coverId: track.coverId,
      durationSeconds: track.duration,
      sourceType: request.sourceType,
      sourceLabel: request.sourceLabel,
      queueId: request.queueId,
    });

    return { historyId: entry.id };
  }

  finishPlaybackHistory(request: FinishPlaybackHistoryRequest): PlaybackHistoryEntry | null {
    return this.store.finishPlaybackHistoryEntry(request.historyId, {
      playedSeconds: request.playedSeconds,
      durationSeconds: request.durationSeconds,
      completed: request.completed,
      endedAt: request.endedAt,
    });
  }

  getPlaybackHistory(query?: PlaybackHistoryQuery): LibraryPage<PlaybackHistoryEntry> {
    return this.store.getPlaybackHistory(query);
  }

  getPlaybackHistorySummary(query?: PlaybackHistoryQuery): PlaybackHistorySummary {
    return this.store.getPlaybackHistorySummary(query);
  }

  getPlaybackStatsDashboard(query?: PlaybackHistoryQuery): PlaybackStatsDashboard {
    const dashboard = this.store.getPlaybackStatsDashboard(query);
    this.rememberPlaybackStatsDashboard(query, dashboard);
    return dashboard;
  }

  async getPlaybackStatsDashboardPlaybackSafe(query?: PlaybackHistoryQuery): Promise<PlaybackStatsDashboard> {
    const cached = this.playbackStatsDashboardCache.get(this.playbackStatsDashboardCacheKey(query));
    if (await isPlaybackActiveForMainWork()) {
      return cached ?? this.store.getPlaybackStatsDashboardActivity(query);
    }

    return runMainBackgroundTask('library:get-playback-stats-dashboard', () => this.getPlaybackStatsDashboard(query));
  }

  async refreshInvalidPlaybackHistory(): Promise<PlaybackHistoryRefreshResult> {
    const candidates = this.store.getLocalPlaybackHistoryValidationCandidates();
    const pathsByHistoryKey = new Map<string, Set<string>>();

    for (const candidate of candidates) {
      const paths = pathsByHistoryKey.get(candidate.historyKey) ?? new Set<string>();
      paths.add(candidate.trackPath);
      pathsByHistoryKey.set(candidate.historyKey, paths);
    }

    const groupedCandidates = Array.from(pathsByHistoryKey.entries());
    const invalidHistoryKeys: string[] = [];

    for (let index = 0; index < groupedCandidates.length; index += playbackHistoryRefreshConcurrency) {
      const batch = groupedCandidates.slice(index, index + playbackHistoryRefreshConcurrency);
      const batchResults = await Promise.all(
        batch.map(async ([historyKey, paths]) => {
          for (const filePath of paths) {
            if (await isExistingFile(filePath)) {
              return null;
            }
          }

          return historyKey;
        }),
      );

      invalidHistoryKeys.push(...batchResults.filter((historyKey): historyKey is string => typeof historyKey === 'string'));
      await yieldToMainLoop();
    }

    const pruneResult = this.store.prunePlaybackHistoryByKeys(invalidHistoryKeys);

    return {
      scannedCount: groupedCandidates.length,
      removedCount: invalidHistoryKeys.length,
      removedEntriesCount: pruneResult.removedEntriesCount,
      removedStatsCount: pruneResult.removedStatsCount,
    };
  }

  deletePlaybackHistoryEntry(id: string): void {
    this.store.deletePlaybackHistoryEntry(id);
  }

  clearPlaybackHistory(): void {
    this.store.clearPlaybackHistory();
  }

  refreshAlbumGrouping(): LibrarySummary {
    if (this.hasRunningJobs()) {
      throw new Error('Cannot refresh album grouping while a library scan is running.');
    }

    const startedAtMs = Date.now();
    try {
      const summary = this.store.transaction(() => {
        this.store.refreshAlbums(this.albumService, new Date().toISOString(), this.albumRefreshOptions());
        this.store.refreshArtists();
        return this.store.getSummary();
      });
      this.groupingRefreshQueued = false;
      this.groupingRefreshRetryCount = 0;
      this.lastGroupingRefreshDurationMs = Date.now() - startedAtMs;
      this.lastGroupingRefreshAt = new Date().toISOString();
      this.lastGroupingRefreshError = null;
      return summary;
    } catch (error) {
      this.lastGroupingRefreshDurationMs = Date.now() - startedAtMs;
      this.lastGroupingRefreshAt = new Date().toISOString();
      this.lastGroupingRefreshError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  refreshAlbumGroupingPlaybackSafe(): Promise<LibrarySummary> {
    if (this.hasRunningJobs()) {
      throw new Error('Cannot refresh album grouping while a library scan is running.');
    }

    return runNonCriticalMainWork({
      name: 'library:refresh-album-grouping',
      work: () => this.refreshAlbumGrouping(),
      fallback: () => {
        this.groupingRefreshDelayedForPlaybackCount += 1;
        this.scheduleGroupingRefresh(3000);
        return this.store.getSummary();
      },
    });
  }

  async loadEmbeddedTrackTags(trackId: string): Promise<EmbeddedTrackTagsLoadResult> {
    const currentTrack = this.store.getTrack(trackId);

    if (!currentTrack) {
      throw new Error(`Unknown track ${trackId}`);
    }

    if (!existsSync(currentTrack.path)) {
      throw new Error(`Track file is missing: ${currentTrack.path}`);
    }

    const metadata = await this.metadataReader.read(currentTrack.path);
    const fileStat = await statFile(currentTrack.path);
    let coverId = currentTrack.coverId;

    if (metadata.embeddedCover) {
      const coverResult = await this.coverExtractor.extract(currentTrack.path, {
        cacheRoot: this.coverCacheDir,
        metadata,
      });
      coverId = this.store.upsertCover({ ...coverResult, source: 'embedded' });
    }

    const tagUpdate = {
      title: metadata.fields.title,
      artist: metadata.fields.artist,
      album: metadata.fields.album,
      albumArtist: metadata.fields.albumArtist,
      trackNo: metadata.fields.trackNo,
      discNo: metadata.fields.discNo,
      year: metadata.fields.year,
      genre: metadata.fields.genre,
      bpm: metadata.fields.bpm ?? null,
      sizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fieldSources: {
        ...currentTrack.fieldSources,
        ...metadata.fieldSources,
      },
      embeddedMetadataStatus: metadata.embeddedMetadataStatus,
      embeddedCoverStatus: metadata.embeddedCover ? 'present' : currentTrack.embeddedCoverStatus,
      metadataStatus: metadata.status,
    };
    const searchTerms = await this.store.prepareTrackTagSearchTerms(trackId, tagUpdate);

    const updatedTrack = this.store.transaction(() => {
      const updated = this.store.updateTrackTags(trackId, tagUpdate, undefined, searchTerms);
      if (coverId !== currentTrack.coverId) {
        this.store.updateTrackCover(trackId, coverId);
      }
      return this.store.getTrack(trackId) ?? updated;
    });
    this.scheduleGroupingRefresh();

    return {
      tags: {
        title: metadata.fields.title,
        artist: metadata.fields.artist,
        album: metadata.fields.album,
        albumArtist: metadata.fields.albumArtist,
        trackNo: metadata.fields.trackNo,
        discNo: metadata.fields.discNo,
        year: metadata.fields.year,
        genre: metadata.fields.genre,
      },
      coverId,
      coverThumb: coverId ? `echo-cover://thumb/${encodeURIComponent(coverId)}` : null,
      track: updatedTrack,
    };
  }

  async updateTrackTags(request: LibraryTrackTagUpdateRequest): Promise<LibraryTrack> {
    const currentTrack = this.store.getTrack(request.trackId);

    if (!currentTrack) {
      throw new Error(`Unknown track ${request.trackId}`);
    }

    if (!existsSync(currentTrack.path)) {
      throw new Error(`Track file is missing: ${currentTrack.path}`);
    }

    const tags = normalizeEditableTags(request.tags, currentTrack);
    const coverPath = cleanNullableText(request.coverPath ?? null);
    const coverUrl = cleanNullableText(request.coverUrl ?? null);
    let coverData: { data: Uint8Array; mimeType: string } | null = null;
    if (coverPath) {
      coverData = readCoverImage(coverPath);
    } else if (coverUrl) {
      // Network cover failures should not block confirmed text tag edits.
      coverData = await readCoverImageFromUrl(coverUrl, request.coverMimeType ?? null).catch(() => null);
    }

    const fileStat = await statFile(currentTrack.path);
    const fieldSources = {
      ...currentTrack.fieldSources,
      title: 'manual',
      artist: 'manual',
      album: 'manual',
      albumArtist: 'manual',
      trackNo: 'manual',
      discNo: 'manual',
      year: 'manual',
      genre: 'manual',
    };

    let manualCoverId: string | null | undefined;
    if (coverData) {
      const coverResult = await this.coverExtractor.extract(currentTrack.path, {
        cacheRoot: this.coverCacheDir,
        metadata: metadataWithEmbeddedCover(coverData.data, coverData.mimeType),
      });
      manualCoverId = this.store.upsertCover({ ...coverResult, source: coverUrl && !coverPath ? 'network' : 'manual' });
    }

    const tagUpdate = {
      ...tags,
      sizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fieldSources,
    };
    const searchTerms = await this.store.prepareTrackTagSearchTerms(request.trackId, tagUpdate);

    const updatedTrack = this.store.transaction(() => {
      const updated = this.store.updateTrackTags(request.trackId, tagUpdate, undefined, searchTerms);
      if (manualCoverId !== undefined) {
        this.store.updateTrackCover(request.trackId, manualCoverId);
      }
      return manualCoverId !== undefined ? this.store.getTrack(request.trackId) ?? updated : updated;
    });

    this.scheduleEmbeddedTagWrite({
      trackId: request.trackId,
      filePath: currentTrack.path,
      tags,
      coverData,
      errorPrefix: 'Failed to write embedded tags',
    });
    this.scheduleGroupingRefresh();

    return updatedTrack;
  }

  async updateAlbumTags(request: LibraryAlbumTagUpdateRequest): Promise<LibraryAlbum> {
    const album = this.store.getAlbum(request.albumId);

    if (!album) {
      throw new Error(`Unknown album ${request.albumId}`);
    }

    const tracks = this.getAllAlbumTracks(request.albumId);
    if (tracks.length === 0) {
      throw new Error(`Album has no active tracks: ${album.title}`);
    }

    const missingTrack = tracks.find((track) => !existsSync(track.path));
    if (missingTrack) {
      throw new Error(`Track file is missing: ${missingTrack.path}`);
    }

    const tags = normalizeEditableAlbumTags(request.tags, album);
    const coverPath = cleanNullableText(request.coverPath ?? null);
    const coverUrl = cleanNullableText(request.coverUrl ?? null);
    let coverData: { data: Uint8Array; mimeType: string } | null = null;
    if (coverPath) {
      coverData = readCoverImage(coverPath);
    } else if (coverUrl) {
      // Network cover failures should not block confirmed text tag edits.
      coverData = await readCoverImageFromUrl(coverUrl, request.coverMimeType ?? null).catch(() => null);
    }

    const updates: Array<{
      track: LibraryTrack;
      sizeBytes: number;
      mtimeMs: number;
      fieldSources: Record<string, string>;
      coverId?: string | null;
      searchTerms: string;
    }> = [];

    for (const track of tracks) {
      const fileStat = await statFile(track.path);
      const fieldSources = {
        ...track.fieldSources,
        album: 'manual',
        albumArtist: 'manual',
        year: 'manual',
        genre: 'manual',
      };

      let coverId: string | null | undefined;
      if (coverData) {
        const coverResult = await this.coverExtractor.extract(track.path, {
          cacheRoot: this.coverCacheDir,
          metadata: metadataWithEmbeddedCover(coverData.data, coverData.mimeType),
        });
        coverId = this.store.upsertCover({ ...coverResult, source: coverUrl && !coverPath ? 'network' : 'manual' });
      }

      const tagUpdate = {
        title: track.title,
        artist: track.artist,
        album: tags.album,
        albumArtist: tags.albumArtist,
        trackNo: track.trackNo,
        discNo: track.discNo,
        year: tags.year,
        genre: tags.genre,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        fieldSources,
      };

      updates.push({
        track,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        fieldSources,
        coverId,
        searchTerms: await this.store.prepareTrackTagSearchTerms(track.id, tagUpdate),
      });
    }

    const nextCoverId = updates.find((update) => update.coverId !== undefined)?.coverId ?? album.coverId;
    const updatedAlbum = this.store.transaction(() => {
      for (const update of updates) {
        this.store.updateTrackTags(update.track.id, {
          title: update.track.title,
          artist: update.track.artist,
          album: tags.album,
          albumArtist: tags.albumArtist,
          trackNo: update.track.trackNo,
          discNo: update.track.discNo,
          year: tags.year,
          genre: tags.genre,
          sizeBytes: update.sizeBytes,
          mtimeMs: update.mtimeMs,
          fieldSources: update.fieldSources,
        }, undefined, update.searchTerms);
        if (update.coverId !== undefined) {
          this.store.updateTrackCover(update.track.id, update.coverId);
        }
      }

      const nextAlbum = this.store.updateAlbumSummary(album.id, {
        title: tags.album,
        albumArtist: tags.albumArtist,
        year: tags.year,
        coverId: nextCoverId,
      }) ?? this.store.getAlbumForTrack(tracks[0]!.id);
      if (!nextAlbum) {
        throw new Error(`Album update completed but refreshed album could not be found for ${album.title}`);
      }
      return nextAlbum;
    });

    for (const update of updates) {
      this.scheduleEmbeddedTagWrite({
        trackId: update.track.id,
        filePath: update.track.path,
        coverData,
        tags: {
          title: update.track.title,
          artist: update.track.artist,
          album: tags.album,
          albumArtist: tags.albumArtist,
          trackNo: update.track.trackNo,
          discNo: update.track.discNo,
          year: tags.year,
          genre: tags.genre,
        },
        errorPrefix: 'Failed to write album tags',
      });
    }

    return updatedAlbum;
  }

  async repairMissingMetadata(trackId: string, providerNames?: AppSettings['networkMetadataProviders']): Promise<NetworkRepairResult> {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    const result = await this.networkMetadataService.repairMissingMetadata(trackId, providerNames);
    const coverApplications: NetworkApplyResult[] = [];

    for (const candidate of result.metadata) {
      const coverResult = await this.applyNetworkCandidateCover(candidate, { status: 'candidate_found', appliedFields: {} }, undefined, false);
      if (Object.keys(coverResult.appliedFields).length > 0) {
        coverApplications.push(coverResult);
      }
    }

    const applied = [...result.applied, ...coverApplications];
    return {
      ...result,
      applied,
      diagnostics: {
        ...result.diagnostics,
        appliedCount: applied.length,
      },
    };
  }

  async scanMissingMetadata(
    limit: number,
    providerNames?: AppSettings['networkMetadataProviders'],
    fields?: MissingMetadataField[],
  ): Promise<MissingMetadataScanResult> {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.scanMissingMetadata(limit, providerNames, fields);
  }

  startMissingMetadataScan(
    limit: number,
    providerNames?: AppSettings['networkMetadataProviders'],
    fields?: MissingMetadataField[],
  ): NetworkMetadataScanJobStatus {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.startMissingMetadataScan(limit, providerNames, fields);
  }

  getMissingMetadataScanStatus(jobId: string): NetworkMetadataScanJobStatus {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.getMissingMetadataScanStatus(jobId);
  }

  startMissingCoverBackfill(
    limit: number,
    providerNames?: AppSettings['networkMetadataProviders'],
  ): NetworkMetadataScanJobStatus {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    const activeJob = [...this.missingCoverBackfillJobs.values()].find((job) => job.status === 'queued' || job.status === 'running');
    if (activeJob) {
      return this.cloneMissingCoverBackfillJob(activeJob);
    }

    const timestamp = new Date().toISOString();
    const job: NetworkMetadataScanJobStatus = {
      id: randomUUID(),
      status: 'queued',
      fields: ['cover'],
      totalTracks: 0,
      processedTracks: 0,
      scannedCount: 0,
      candidateCount: 0,
      items: [],
      errors: [],
      diagnostics: {
        targetCount: 0,
        providerErrors: 0,
        noCandidateCount: 0,
        protectedCount: 0,
        appliedCount: 0,
      },
      startedAt: timestamp,
      finishedAt: null,
      currentTrackTitle: null,
    };

    this.missingCoverBackfillJobs.set(job.id, job);
    void this.runMissingCoverBackfillJob(job, limit, providerNames);
    return this.cloneMissingCoverBackfillJob(job);
  }

  getMissingCoverBackfillStatus(jobId: string): NetworkMetadataScanJobStatus {
    const job = this.missingCoverBackfillJobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown missing cover backfill job ${jobId}`);
    }

    return this.cloneMissingCoverBackfillJob(job);
  }

  getActiveMissingCoverBackfillStatus(): NetworkMetadataScanJobStatus | null {
    const activeJob = [...this.missingCoverBackfillJobs.values()].find((job) => job.status === 'queued' || job.status === 'running');
    return activeJob ? this.cloneMissingCoverBackfillJob(activeJob) : null;
  }

  showNetworkCandidates(trackId: string): NetworkCandidateList {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.showCandidates(trackId);
  }

  getBestNetworkCoverUrlForTrack(trackId: string): string | null {
    if (!this.networkMetadataService) {
      return null;
    }

    return this.networkMetadataService.getBestCoverUrlForTrack(trackId);
  }

  async searchNetworkTagCandidates(request: NetworkTagCandidateSearchRequest): Promise<NetworkTagCandidate[]> {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.searchNetworkTagCandidates(request);
  }

  async resolveLyricsBackgroundCover(
    trackId: string,
    providerNames?: AppSettings['networkMetadataProviders'],
  ): Promise<LyricsBackgroundCoverResult | null> {
    if (!this.networkMetadataService) {
      return null;
    }

    return this.networkMetadataService.resolveLyricsBackgroundCover(trackId, providerNames);
  }

  async applyNetworkMissingOnly(candidateId: string, options?: NetworkApplyOptions): Promise<NetworkApplyResult> {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    const candidate = this.networkMetadataService.getMetadataCandidate(candidateId);
    const result = this.networkMetadataService.applyMissingOnly(candidateId, options);
    return this.applyNetworkCandidateCover(candidate, result, options, false);
  }

  async applyNetworkSelected(candidateId: string, options?: NetworkApplyOptions): Promise<NetworkApplyResult> {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    const candidate = this.networkMetadataService.getMetadataCandidate(candidateId);
    const result = this.networkMetadataService.applySelected(candidateId, options);
    return this.applyNetworkCandidateCover(candidate, result, options, true);
  }

  rejectNetworkCandidate(candidateId: string): NetworkApplyResult {
    if (!this.networkMetadataService) {
      throw new Error('Network metadata service is unavailable');
    }

    return this.networkMetadataService.reject(candidateId);
  }

  private async applyNetworkCandidateCover(
    candidate: StoredNetworkMetadataCandidate | null,
    result: NetworkApplyResult,
    options: NetworkApplyOptions | undefined,
    force: boolean,
  ): Promise<NetworkApplyResult> {
    const shouldApplyCover = !options?.fields?.length || options.fields.includes('cover');
    const withCoverSkipReason = (reason: string): NetworkApplyResult => {
      if (Object.keys(result.appliedFields).length > 0) {
        return result;
      }

      return {
        ...result,
        status: 'candidate_found',
        reason,
      };
    };

    if (
      !this.networkMetadataService ||
      !candidate?.coverUrl ||
      result.status === 'rejected' ||
      result.status === 'error' ||
      !shouldApplyCover
    ) {
      return result;
    }

    const autoApplyThreshold = isCoverOnlyNetworkApply(options)
      ? coverBackfillAutoApplyThreshold(candidate.provider)
      : NETWORK_AUTO_APPLY_THRESHOLD;
    if (!force && candidate.score < autoApplyThreshold) {
      return withCoverSkipReason('score_below_auto_apply_threshold');
    }

    const row = this.database
      .prepare<
        [string],
        {
          id: string;
          path: string;
          cover_id: string | null;
          embedded_cover_status: string | null;
          source_type: string | null;
        }
      >(
        `SELECT tracks.id, tracks.path, tracks.cover_id, tracks.embedded_cover_status, covers.source_type
         FROM tracks
         LEFT JOIN covers ON covers.id = tracks.cover_id
         WHERE tracks.id = ? AND tracks.missing = 0`,
      )
      .get(candidate.trackId);

    if (!row) {
      return withCoverSkipReason('track_missing');
    }

    const embeddedCoverStatus = row.embedded_cover_status ?? 'pending';
    if (embeddedCoverStatus === 'pending' || embeddedCoverStatus === 'reading') {
      return withCoverSkipReason('embedded_cover_not_ready');
    }
    if (embeddedCoverStatus === 'present') {
      return withCoverSkipReason('cover_source_embedded_protected');
    }

    const sourceType = row.source_type ?? (row.cover_id ? 'default' : null);
    if (sourceType && sourceType !== 'default') {
      return withCoverSkipReason(`cover_source_${sourceType}_protected`);
    }

    const coverData = await readCoverImageFromUrl(candidate.coverUrl, null).catch(() => null);
    if (!coverData) {
      return withCoverSkipReason('cover_download_failed');
    }

    const coverResult = await this.coverExtractor.extract(row.path, {
      cacheRoot: this.coverCacheDir,
      metadata: metadataWithEmbeddedCover(coverData.data, coverData.mimeType),
    });
    const coverId = this.store.transaction(() => {
      const nextCoverId = this.store.upsertCover({ ...coverResult, source: 'network' });
      this.store.updateTrackCover(row.id, nextCoverId);
      return nextCoverId;
    });
    this.scheduleGroupingRefresh();
    if (!coverId) {
      return result;
    }
    const appliedCoverId: string = coverId;

    const appliedFields = {
      ...result.appliedFields,
      coverId: appliedCoverId,
    };
    if (Object.keys(result.appliedFields).length === 0) {
      this.networkMetadataService.recordAccepted(candidate.id, { coverId: appliedCoverId });
    }

    return {
      ...result,
      status: 'applied_missing_only',
      appliedFields,
    };
  }

  private async runMissingCoverBackfillJob(
    job: NetworkMetadataScanJobStatus,
    limit: number,
    providerNames?: AppSettings['networkMetadataProviders'],
  ): Promise<void> {
    job.status = 'running';
    job.currentTrackTitle = '正在搜索网络封面候选';

    try {
      if (!this.networkMetadataService) {
        throw new Error('Network metadata service is unavailable');
      }

      const scanJob = this.networkMetadataService.startMissingMetadataScan(limit, providerNames, ['cover']);
      let result: NetworkMetadataScanJobStatus = scanJob;
      for (;;) {
        result = this.networkMetadataService.getMissingMetadataScanStatus(scanJob.id);
        const scanTotal = result.totalTracks || result.diagnostics.targetCount || result.scannedCount;
        job.items = [...result.items];
        job.scannedCount = result.scannedCount;
        job.candidateCount = result.candidateCount;
        job.errors = [...result.errors];
        job.diagnostics = { ...result.diagnostics };
        job.totalTracks = scanTotal > 0 ? scanTotal * 2 : 0;
        job.processedTracks = Math.min(scanTotal, result.processedTracks || result.scannedCount);
        job.currentTrackTitle = result.currentTrackTitle ?? '正在搜索网络封面候选';

        if (result.status === 'completed') {
          break;
        }
        if (result.status === 'failed') {
          throw new Error(result.errors.at(-1) ?? 'Network cover scan failed');
        }

        await delay(900);
      }

      job.items = result.items;
      job.scannedCount = result.scannedCount;
      job.candidateCount = result.candidateCount;
      job.errors = [...result.errors];
      job.diagnostics = { ...result.diagnostics };
      job.totalTracks = result.scannedCount > 0 ? result.scannedCount * 2 : 0;
      job.processedTracks = result.scannedCount;

      let appliedCount = 0;
      let protectedCount = result.diagnostics.protectedCount;
      for (const item of result.items) {
        job.currentTrackTitle = item.track.title || item.track.path;
        const candidates = item.candidates.metadata
          .filter((entry) => Boolean(entry.coverUrl))
          .filter((entry) => entry.score >= coverBackfillAutoApplyThreshold(entry.provider))
          .sort(compareCoverBackfillCandidates);
        if (!candidates.length) {
          job.processedTracks += 1;
          continue;
        }

        try {
          for (const candidate of candidates) {
            const applied = await this.applyNetworkMissingOnly(candidate.id, { fields: ['cover'] });
            if (applied.appliedFields.coverId) {
              appliedCount += 1;
              break;
            }

            if (applied.reason?.startsWith('cover_source_') || applied.reason === 'embedded_cover_not_ready') {
              protectedCount += 1;
              break;
            }
          }
        } catch (error) {
          job.errors.push(`${item.track.title || item.track.path}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          job.processedTracks += 1;
        }
      }

      job.diagnostics = {
        ...job.diagnostics,
        providerErrors: job.errors.length,
        protectedCount,
        appliedCount,
      };
      job.status = 'completed';
      job.currentTrackTitle = null;
      job.finishedAt = new Date().toISOString();
      if (appliedCount > 0) {
        broadcastLibraryChanged();
      }
    } catch (error) {
      job.status = 'failed';
      job.currentTrackTitle = null;
      job.finishedAt = new Date().toISOString();
      job.errors.push(error instanceof Error ? error.message : String(error));
      job.diagnostics = {
        ...job.diagnostics,
        providerErrors: job.errors.length,
      };
    }
  }

  private cloneMissingCoverBackfillJob(job: NetworkMetadataScanJobStatus): NetworkMetadataScanJobStatus {
    return {
      ...job,
      fields: [...job.fields],
      items: [...job.items],
      errors: [...job.errors],
      diagnostics: { ...job.diagnostics },
    };
  }

  deleteTrack(trackId: string): void {
    this.store.transaction(() => {
      this.store.deleteTrackAndCompactAlbums(trackId);
    });
    this.scheduleGroupingRefresh();
  }

  deleteTracks(trackIds: string[]): number {
    if (trackIds.length === 0) {
      return 0;
    }

    return this.store.transaction(() => {
      const changed = this.store.deleteTracks(Array.from(new Set(trackIds)));
      if (changed > 0) {
        this.scheduleGroupingRefresh();
      }
      return changed;
    });
  }

  deleteAlbumTracks(albumId: string): number {
    const tracks = this.getAllAlbumTracks(albumId);
    const trackIds = tracks.map((track) => track.id);

    if (trackIds.length === 0) {
      return 0;
    }

    return this.store.transaction(() => {
      const changed = this.store.deleteTracks(trackIds);
      if (changed > 0) {
        this.scheduleGroupingRefresh();
      }
      return changed;
    });
  }

  pruneMissingTracks(): LibraryCleanupResult {
    const tracks = this.store.getActiveTracks();
    const missingTrackIds = tracks.filter((track) => !existsSync(track.path)).map((track) => track.id);

    const removedCount = this.store.transaction(() => {
      const changed = this.store.deleteTracks(missingTrackIds);
      if (changed > 0) {
        this.scheduleGroupingRefresh();
      }
      return changed;
    });

    return {
      scannedCount: tracks.length,
      removedCount,
    };
  }

  async pruneInvalidTracks(shortDurationThresholdSeconds = 5): Promise<LibraryMaintenanceCleanupResult> {
    const tracks = this.store.getActiveTracks();
    const missingTrackIds: string[] = [];
    const shortTrackIds: string[] = [];
    const normalizedShortDurationThresholdSeconds = Math.max(0, shortDurationThresholdSeconds);

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];

      if (!existsSync(track.path)) {
        missingTrackIds.push(track.id);
      } else if (track.duration > 0 && track.duration <= normalizedShortDurationThresholdSeconds) {
        shortTrackIds.push(track.id);
      }

      if (index % 100 === 99) {
        await yieldToMainLoop();
      }
    }

    const trackIds = Array.from(new Set([...missingTrackIds, ...shortTrackIds]));
    const removedCount = this.store.transaction(() => {
      const changed = this.store.deleteTracks(trackIds);
      if (changed > 0) {
        this.scheduleGroupingRefresh();
      }
      return changed;
    });

    return {
      scannedCount: tracks.length,
      removedCount,
      missingRemovedCount: missingTrackIds.length,
      shortRemovedCount: shortTrackIds.length,
      shortDurationThresholdSeconds: normalizedShortDurationThresholdSeconds,
    };
  }

  clearTracks(): LibraryCleanupResult {
    const scannedCount = this.store.getTracks({ pageSize: 1 }).total;
    const removedCount = this.store.transaction(() => this.store.deleteAllTracks());

    return {
      scannedCount,
      removedCount,
    };
  }

  clearCache(): LibraryCacheClearResult {
    if (this.hasRunningJobs()) {
      throw new Error('Cannot clear library cache while a library scan is running.');
    }

    const scannedCount = this.store.getTracks({ pageSize: 1 }).total;
    const cacheStats = directoryStats(this.coverCacheDir);
    const removedCount = this.store.deleteLibraryCache();
    clearDirectoryContents(this.coverCacheDir);

    return {
      scannedCount,
      removedCount,
      deletedCoverCacheFiles: cacheStats.fileCount,
      freedCoverCacheBytes: cacheStats.sizeBytes,
    };
  }

  async waitForScan(jobId: string): Promise<void> {
    await this.scanJobQueue.waitForIdle(jobId);
  }

  hasRunningJobs(): boolean {
    return this.scanJobQueue.hasRunningJobs();
  }

  getCoverCacheDir(): string {
    return this.coverCacheDir;
  }

  startBpmAnalysis(options: BpmAnalysisStartOptions = {}): BpmAnalysisJobStatus {
    if (!this.bpmAnalysisJobQueue) {
      throw new Error('BPM analysis service is unavailable');
    }
    return this.bpmAnalysisJobQueue.start(options);
  }

  getBpmAnalysisStatus(jobId: string): BpmAnalysisJobStatus {
    if (!this.bpmAnalysisJobQueue) {
      throw new Error('BPM analysis service is unavailable');
    }
    return this.bpmAnalysisJobQueue.getStatus(jobId);
  }

  startReplayGainAnalysis(options: ReplayGainAnalysisStartOptions = {}): ReplayGainAnalysisJobStatus {
    if (!this.replayGainAnalysisJobQueue) {
      throw new Error('ReplayGain analysis service is unavailable');
    }
    return this.replayGainAnalysisJobQueue.start(options);
  }

  getReplayGainAnalysisStatus(jobId: string): ReplayGainAnalysisJobStatus {
    if (!this.replayGainAnalysisJobQueue) {
      throw new Error('ReplayGain analysis service is unavailable');
    }
    return this.replayGainAnalysisJobQueue.getStatus(jobId);
  }

  startLyricsBackfill(options: LyricsBackfillStartOptions = {}): LyricsBackfillJobStatus {
    return this.lyricsBackfillJobQueue.start(options);
  }

  getLyricsBackfillStatus(jobId: string): LyricsBackfillJobStatus {
    return this.lyricsBackfillJobQueue.getStatus(jobId);
  }

  getCurrentLyricsBackfillStatus(): LyricsBackfillJobStatus | null {
    return this.lyricsBackfillJobQueue.getCurrentStatus();
  }

  cancelLyricsBackfill(jobId: string): LyricsBackfillJobStatus {
    return this.lyricsBackfillJobQueue.cancel(jobId);
  }

  getDefaultCoverCacheDir(): string {
    return getDefaultCoverCacheDir(this.databasePath);
  }

  setCoverCacheDir(coverCacheDir: string): void {
    this.coverCacheDir = resolve(coverCacheDir);
    this.scanJobQueue.updateCoverCacheDir(this.coverCacheDir);
  }

  async migrateCoverCacheDir(newDir: string): Promise<CoverCacheMigrationResult> {
    return migrateCoverCache({
      oldDir: this.coverCacheDir,
      newDir,
      updateCoverPaths: (oldDir, targetDir, warnings) => this.store.updateCoverCachePaths(oldDir, targetDir, warnings),
    });
  }

  close(): void {
    this.closed = true;
    this.lyricsBackfillJobQueue.dispose();
    this.watcherService?.stop();
    for (const timer of this.duplicateRefreshTimers.values()) {
      clearTimeout(timer);
    }
    this.duplicateRefreshTimers.clear();
    this.duplicateRefreshRunning.clear();
    this.artistImagePlaybackStatusUnsubscribe?.();
    this.artistImagePlaybackStatusUnsubscribe = null;
    if (this.artistImageStartupTimer) {
      clearTimeout(this.artistImageStartupTimer);
      this.artistImageStartupTimer = null;
    }
    if (this.searchIndexBackfillTimer) {
      clearTimeout(this.searchIndexBackfillTimer);
      this.searchIndexBackfillTimer = null;
    }
    if (this.groupingRefreshTimer) {
      clearTimeout(this.groupingRefreshTimer);
      this.groupingRefreshTimer = null;
    }
    if (this.searchIndexBackfillTimer) {
      clearTimeout(this.searchIndexBackfillTimer);
      this.searchIndexBackfillTimer = null;
    }
    (this.scanJobQueue as { dispose?: () => void }).dispose?.();
    this.closeWorkerResources();

    this.closeDatabase();
  }

  private bindArtistImagePlaybackDeferral(): void {
    if (!this.artistImageCacheService) {
      return;
    }

    void import('../audio/AudioSession')
      .then(({ getAudioSession }) => {
        if (this.closed || !this.artistImageCacheService) {
          return;
        }

        const audioSession = getAudioSession();
        const applyStatus = (status: { state?: string }): void => {
          const playbackActive = status.state === 'loading' || status.state === 'playing';
          this.artistImageCacheService?.setPlaybackActive(playbackActive);
        };

        applyStatus(audioSession.getStatus());
        audioSession.on('status', applyStatus);
        this.artistImagePlaybackStatusUnsubscribe = () => {
          audioSession.off?.('status', applyStatus);
        };
      })
      .catch(() => undefined);
  }

  private albumRefreshOptions(): { albumMergeStrategy: AlbumMergeStrategy } {
    return { albumMergeStrategy: this.readAppSettings().albumMergeStrategy };
  }

  private notifyLibraryChanged(): void {
    broadcastLibraryChanged();
  }

  private playbackStatsDashboardCacheKey(query?: PlaybackHistoryQuery): string {
    return JSON.stringify({
      page: query?.page ?? null,
      pageSize: query?.pageSize ?? null,
      search: query?.search ?? null,
      from: query?.from ?? null,
      to: query?.to ?? null,
      completedOnly: query?.completedOnly ?? null,
      sort: query?.sort ?? null,
    });
  }

  private rememberPlaybackStatsDashboard(query: PlaybackHistoryQuery | undefined, dashboard: PlaybackStatsDashboard): void {
    this.playbackStatsDashboardCache.set(this.playbackStatsDashboardCacheKey(query), dashboard);
    if (this.playbackStatsDashboardCache.size <= 20) {
      return;
    }

    const oldestKey = this.playbackStatsDashboardCache.keys().next().value;
    if (oldestKey) {
      this.playbackStatsDashboardCache.delete(oldestKey);
    }
  }

  private scheduleDuplicateRefresh(mode: DuplicateTrackMode, delayMs = 5000): void {
    if (this.closed || this.duplicateRefreshTimers.has(mode) || this.duplicateRefreshRunning.has(mode)) {
      return;
    }

    const timer = setTimeout(() => {
      this.duplicateRefreshTimers.delete(mode);
      void this.runScheduledDuplicateRefresh(mode);
    }, Math.max(0, delayMs));
    this.duplicateRefreshTimers.set(mode, timer);
    timer.unref?.();
  }

  private async runScheduledDuplicateRefresh(mode: DuplicateTrackMode): Promise<void> {
    if (this.closed || this.duplicateRefreshRunning.has(mode)) {
      return;
    }

    if (await shouldDelayGroupingRefreshForAudio()) {
      this.scheduleDuplicateRefresh(mode, 10_000);
      return;
    }

    this.duplicateRefreshRunning.add(mode);
    try {
      await runMainBackgroundTask(`library:refresh-duplicate-tracks:${mode}`, () => this.refreshDuplicateTracksAsync(mode));
      this.notifyLibraryChanged();
    } catch (error) {
      console.warn(`[library] Deferred duplicate refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.duplicateRefreshRunning.delete(mode);
    }
  }

  private scheduleSearchIndexBackfill(delayMs = 10_000, options: { allowDuringPlayback?: boolean } = {}): void {
    if (this.closed || this.searchIndexBackfillRunning) {
      return;
    }

    const shouldAccelerate = delayMs <= 0 || options.allowDuringPlayback === true;
    this.searchIndexBackfillAllowDuringPlayback =
      this.searchIndexBackfillAllowDuringPlayback || options.allowDuringPlayback === true;

    if (this.searchIndexBackfillTimer) {
      if (!shouldAccelerate) {
        return;
      }
      clearTimeout(this.searchIndexBackfillTimer);
      this.searchIndexBackfillTimer = null;
    }

    this.searchIndexBackfillTimer = setTimeout(() => {
      void this.runSearchIndexBackfill();
    }, Math.max(0, delayMs));
    this.searchIndexBackfillTimer.unref?.();
  }

  private async runSearchIndexBackfill(): Promise<void> {
    this.searchIndexBackfillTimer = null;
    if (this.closed) {
      return;
    }

    const allowDuringPlayback = this.searchIndexBackfillAllowDuringPlayback;
    this.searchIndexBackfillAllowDuringPlayback = false;
    this.searchIndexBackfillRunning = true;
    try {
      if (!allowDuringPlayback && await shouldDelayGroupingRefreshForAudio()) {
        this.searchIndexBackfillRunning = false;
        this.scheduleSearchIndexBackfill();
        return;
      }

      const changed = await this.store.rebuildJapaneseRomanizedSearchTerms();
      if (!this.closed && changed > 0) {
        this.notifyLibraryChanged();
      }
    } catch {
      // Search backfill is best-effort; scanning and direct edits keep writing fresh terms.
    } finally {
      this.searchIndexBackfillRunning = false;
    }
  }

  private maybeScheduleRomanizedSearchBackfill(search: string | undefined): void {
    if (!search || !romanizedSearchPattern.test(search) || this.store.isJapaneseRomanizedSearchReady()) {
      return;
    }

    this.scheduleSearchIndexBackfill(0, { allowDuringPlayback: true });
  }

  private async previewRescanPathsFromWatcher(folderId: string, paths: string[]): Promise<number> {
    const folder = this.store.getFolder(folderId);
    if (!folder) {
      return 0;
    }

    const timestamp = new Date().toISOString();
    const previewTracks: Array<{
      normalizedPath: string;
      extension: string;
      sizeBytes: number;
      mtimeMs: number;
    }> = [];

    for (const filePath of paths) {
      const normalizedPath = resolve(filePath);
      const extension = extname(normalizedPath).toLocaleLowerCase();
      if (!SCANNABLE_AUDIO_EXTENSIONS.has(extension) || this.store.getTrackByPath(normalizedPath)) {
        continue;
      }

      try {
        const fileStat = await statFile(normalizedPath);
        if (!fileStat.isFile()) {
          continue;
        }

        previewTracks.push({
          normalizedPath,
          extension,
          sizeBytes: fileStat.size,
          mtimeMs: Math.round(fileStat.mtimeMs),
        });
      } catch {
        continue;
      }

      await yieldToMainLoop();
    }

    let changed = 0;
    const changedTrackIds: string[] = [];

    this.store.transaction(() => {
      for (const { normalizedPath, extension, sizeBytes, mtimeMs } of previewTracks) {
        const title = basename(normalizedPath, extension) || basename(normalizedPath);
        const artist = 'Unknown Artist';
        const fieldSources: FieldSources = {
          title: 'filename_fallback',
          artist: 'unknown',
          album: 'unknown',
          albumArtist: 'artist_fallback',
          trackNo: 'unknown',
          discNo: 'unknown',
          year: 'unknown',
          genre: 'unknown',
          duration: 'unknown',
          codec: 'unknown',
          sampleRate: 'unknown',
          bitDepth: 'unknown',
          bitrate: 'unknown',
        };

        this.store.upsertTrack({
          path: normalizedPath,
          folderId: folder.id,
          sizeBytes,
          mtimeMs,
          title,
          artist,
          album: 'Unknown Album',
          albumArtist: artist,
          trackNo: null,
          discNo: null,
          year: null,
          genre: null,
          duration: 0,
          codec: null,
          sampleRate: null,
          bitDepth: null,
          bitrate: null,
          id: randomUUID(),
          coverId: null,
          fieldSources,
          embeddedMetadataStatus: 'pending',
          embeddedCoverStatus: 'pending',
          metadataStatus: 'fallback',
          warnings: [],
          errors: [],
          updatedAt: timestamp,
        });
        const track = this.store.getTrackByPath(normalizedPath);
        if (track) {
          changedTrackIds.push(track.id);
        }
        changed += 1;
      }
    });

    if (changed > 0) {
      this.store.seedAlbumsForTracks(changedTrackIds, this.albumService, timestamp, this.albumRefreshOptions());
      this.notifyLibraryChanged();
    }

    return changed;
  }

  private getWatcherService(): LibraryWatcherService {
    if (!this.watcherService) {
      this.watcherService = new LibraryWatcherService({
        enabled: this.readAppSettings().liveLibraryUpdatesEnabled === true || isLibraryWatcherFeatureEnabled(),
        autoRescanEnabled: this.readAppSettings().liveLibraryUpdatesEnabled === true || isLibraryWatcherAutoRescanEnabled(),
        readFolders: () =>
          this.getFolders().map((folder) => ({
            id: folder.id,
            path: folder.path,
            enabled: folder.status === 'active',
          })),
        rescanCoordinator: {
          rescanPaths: (folderId, paths) => {
            const startedAt = new Date().toISOString();
            const metadataBackfillCount = this.store.countPlaceholderMetadataTracksByPaths(paths);
            this.lastWatcherRescanStartedAt = startedAt;
            this.lastWatcherRescanFinishedAt = null;
            this.lastWatcherRescanPathCount = paths.length;
            this.lastMetadataBackfillCount = metadataBackfillCount;
            const job = this.rescanPaths(folderId, paths, {
              deferGroupingRefresh: true,
              skipDeferredGroupingRefresh: true,
              reduceScanPressure: true,
            });
            void this.scanJobQueue.waitForIdle(job.id)
              .then(() => {
                const status = this.store.getScanJob(job.id);
                this.lastWatcherRescanFinishedAt = new Date().toISOString();
                this.lastSkippedByCacheCount = status?.skippedFiles ?? 0;
                this.notifyLibraryChanged();
              })
              .catch((error) => {
                this.lastWatcherRescanFinishedAt = new Date().toISOString();
                console.warn(`Library watcher rescan did not complete cleanly: ${error instanceof Error ? error.message : String(error)}`);
              });
            return job;
          },
          markMissingPaths: (folderId, paths) => {
            const changed = this.store.markTracksMissingByPaths(folderId, paths);
            if (changed > 0) {
              this.notifyLibraryChanged();
            }
            return changed;
          },
          previewRescanPaths: (folderId, paths) => this.previewRescanPathsFromWatcher(folderId, paths),
          hasRunningJobs: () => this.scanJobQueue.hasRunningJobs(),
          shouldDelayRescan: () => this.shouldDelayWatcherRescanForLowLoadPlayback(),
        },
      });
    }

    return this.watcherService;
  }

  private async shouldDelayWatcherRescanForLowLoadPlayback(): Promise<boolean> {
    try {
      const { getAudioSession } = await import('../audio/AudioSession');
      const state = getAudioSession().getStatus().state;
      return state === 'loading' || state === 'playing';
    } catch {
      return false;
    }
  }

  private composeLibraryLabState(
    watcherDiagnostics: LibraryWatcherDiagnostics,
    candidates: LibraryMoveCandidate[],
  ): LibraryLabState {
    const lastWatcherEventAt = watcherDiagnostics.recentEvents.at(-1)?.timestamp ?? null;
    const nativeFileScanner = getNativeFileScannerDiagnostics(() => this.readAppSettings().nativeFileScannerEnabled === true);
    const nativeMetadataReader = getNativeMetadataReaderDiagnostics(() => this.readAppSettings().nativeMetadataReaderEnabled === true);

    return {
      watcherEnabled: watcherDiagnostics.enabled,
      watcherRunning: this.watcherService?.isRunning() ?? false,
      autoRescanEnabled: watcherDiagnostics.autoRescanEnabled,
      moveCandidateEnabled: this.moveCandidateEnabled,
      moveRepairLabEnabled: this.moveRepairLabEnabled,
      watchedFolderCount: watcherDiagnostics.watchedFolderCount,
      totalEventCount: watcherDiagnostics.totalEventCount,
      pendingPathCount: watcherDiagnostics.pendingPathCount,
      triggeredRescanCount: watcherDiagnostics.triggeredRescanCount,
      droppedPathCount: watcherDiagnostics.droppedPathCount,
      skippedDeleteEventCount: watcherDiagnostics.skippedDeleteEventCount,
      skippedRenameEventCount: watcherDiagnostics.skippedRenameEventCount,
      lastTriggeredRescanAt: watcherDiagnostics.lastTriggeredRescanAt,
      lastRescanError: watcherDiagnostics.lastRescanError,
      watcherLastError: watcherDiagnostics.lastError,
      lastWatcherEventAt,
      lastRescanStartedAt: this.lastWatcherRescanStartedAt,
      lastRescanFinishedAt: this.lastWatcherRescanFinishedAt,
      lastRescanPathCount: this.lastWatcherRescanPathCount,
      lastMetadataBackfillCount: this.lastMetadataBackfillCount,
      placeholderTrackCount: this.store.getPlaceholderMetadataTrackCount(),
      lastSkippedByCacheCount: this.lastSkippedByCacheCount,
      moveCandidateCount: candidates.length,
      highConfidenceCount: candidates.filter((candidate) => candidate.confidence === 'high').length,
      mediumConfidenceCount: candidates.filter((candidate) => candidate.confidence === 'medium').length,
      lowConfidenceCount: candidates.filter((candidate) => candidate.confidence === 'low').length,
      ambiguousCount: candidates.filter((candidate) => candidate.ambiguous).length,
      lastMoveRepairAt: this.lastMoveRepairAt,
      lastMoveRepairError: this.lastMoveRepairError,
      groupingRefreshQueued: this.groupingRefreshQueued,
      lastGroupingRefreshDurationMs: this.lastGroupingRefreshDurationMs,
      lastGroupingRefreshAt: this.lastGroupingRefreshAt,
      groupingRefreshDelayedForPlaybackCount: this.groupingRefreshDelayedForPlaybackCount,
      lastGroupingRefreshError: this.lastGroupingRefreshError,
      nativeFileScanner,
      nativeMetadataReader,
      recentWatcherEvents: watcherDiagnostics.recentEvents.slice(-20).reverse(),
    };
  }

  private refreshArtistsIfDirty(): void {
    if (!this.artistsDirty) {
      return;
    }

    if (this.groupingRefreshQueued || this.groupingRefreshTimer) {
      return;
    }

    this.store.refreshArtists();
    this.artistsDirty = false;
  }

  private artistImagesNetworkEnabled(): boolean {
    return this.readAppSettings().autoFetchArtistImages === true;
  }

  private backupPlaylist(playlistId: string, reason: PlaylistBackupReason): void {
    backupPlaylistIfEnabled(this.database, playlistId, reason, this.readAppSettings);
  }

  private scheduleGroupingRefresh(delayMs = 1000): void {
    this.groupingRefreshQueued = true;
    this.artistsDirty = true;

    if (this.groupingRefreshTimer) {
      return;
    }

    this.groupingRefreshTimer = setTimeout(() => {
      void this.runScheduledGroupingRefresh();
    }, delayMs);
    this.groupingRefreshTimer.unref?.();
  }

  private async runScheduledGroupingRefresh(): Promise<void> {
    this.groupingRefreshTimer = null;
    if (!this.groupingRefreshQueued) {
      return;
    }

    if (await shouldDelayGroupingRefreshForAudio()) {
      this.groupingRefreshRetryCount += 1;
      this.groupingRefreshDelayedForPlaybackCount += 1;
      this.scheduleGroupingRefresh(Math.min(15000, 3000 + this.groupingRefreshRetryCount * 1000));
      return;
    }

    this.groupingRefreshQueued = false;
    this.groupingRefreshRetryCount = 0;
    const startedAtMs = Date.now();
    try {
      await runMainBackgroundTask('library-scan:grouping_albums', () => {
        this.store.transaction(() => {
          this.store.refreshAlbums(this.albumService, undefined, this.albumRefreshOptions());
          this.store.refreshArtists();
        });
      });
      this.artistsDirty = false;
      this.lastGroupingRefreshDurationMs = Date.now() - startedAtMs;
      this.lastGroupingRefreshAt = new Date().toISOString();
      this.lastGroupingRefreshError = null;
      this.notifyLibraryChanged();
    } catch (error) {
      this.artistsDirty = true;
      this.lastGroupingRefreshDurationMs = Date.now() - startedAtMs;
      this.lastGroupingRefreshAt = new Date().toISOString();
      this.lastGroupingRefreshError = error instanceof Error ? error.message : String(error);
    }
  }

  private scheduleEmbeddedTagWrite(request: {
    trackId: string;
    filePath: string;
    tags: EditableTrackTags;
    coverData: { data: Uint8Array; mimeType: string } | null;
    errorPrefix: string;
  }): void {
    const attemptWrite = async (): Promise<void> => {
      if (await shouldDelayEmbeddedTagWriteForAudio(request.filePath)) {
        const retryTimer = setTimeout(() => {
          void attemptWrite();
        }, 5000);
        retryTimer.unref?.();
        return;
      }

      try {
        await writeEmbeddedTrackTags({
          filePath: request.filePath,
          tags: request.tags,
          coverData: request.coverData,
        });
        await this.syncTrackFileStat(request.trackId);
      } catch (error) {
        console.warn(`${request.errorPrefix} for ${request.filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    const startTimer = setTimeout(() => {
      void attemptWrite();
    }, 250);
    startTimer.unref?.();
  }

  private async syncTrackFileStat(trackId: string): Promise<void> {
    const track = this.store.getTrack(trackId);
    if (!track || !existsSync(track.path)) {
      return;
    }

    const fileStat = await statFile(track.path);
    const tagUpdate = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      trackNo: track.trackNo,
      discNo: track.discNo,
      year: track.year,
      genre: track.genre,
      sizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      fieldSources: track.fieldSources,
    };
    this.store.updateTrackTags(track.id, tagUpdate, undefined, await this.store.prepareTrackTagSearchTerms(track.id, tagUpdate));
  }
}

const shouldDelayEmbeddedTagWriteForAudio = async (filePath: string): Promise<boolean> => {
  try {
    const { getAudioSession } = await import('../audio/AudioSession');
    const status = getAudioSession().getStatus();
    const audioPipelineBusy = status.state === 'loading' || status.state === 'playing';
    const currentFileHeld =
      resolve(status.currentFilePath ?? '') === resolve(filePath) &&
      status.state !== 'idle' &&
      status.state !== 'stopped' &&
      status.state !== 'ended' &&
      status.state !== 'error';

    return audioPipelineBusy || currentFileHeld;
  } catch {
    return false;
  }
};

const shouldDelayGroupingRefreshForAudio = async (): Promise<boolean> => {
  return isPlaybackActiveForMainWork();
};

const completedScanSnapshotPlaybackDelayMs = 2_000;
const completedScanSnapshotMaxPlaybackDeferrals = 30;

const waitForCompletedScanSnapshotSlot = async (
  scanStatus: LibraryScanStatus,
  phase: string,
): Promise<void> => {
  await yieldToMainLoop();
  for (let attempt = 0; attempt < completedScanSnapshotMaxPlaybackDeferrals; attempt += 1) {
    if (!(await shouldDelayGroupingRefreshForAudio())) {
      return;
    }
    logLibraryScanPerf({
      jobId: scanStatus.id,
      folderId: scanStatus.folderId,
      phase: 'createCompletedScanSnapshot',
      detail: `deferred_for_playback;dataProtectionPhase=${phase};attempt=${attempt + 1}`,
    });
    await delay(completedScanSnapshotPlaybackDelayMs);
  }
};

export const createLibraryService = (
  databasePath: string,
  dependencies: LibraryServiceDependencies = {},
): LibraryService => {
  const databaseConnection = dependencies.databaseConnection;
  const database = databaseConnection?.database ?? createDatabase(databasePath);
  let databaseOpen = true;
  const closeDatabase = (): void => {
    if (!databaseOpen) {
      return;
    }
    databaseOpen = false;
    if (databaseConnection) {
      databaseConnection.close();
      return;
    }
    database.close();
  };
  const readSettings = dependencies.appSettings ?? getAppSettingsSafe;
  const store = new LibraryStore(database, () => ({
    chineseCrossScriptSearchEnabled: readSettings().chineseCrossScriptSearchEnabled !== false,
    artistMergeStrategy: readSettings().artistMergeStrategy ?? 'standard',
    remoteAlbumMergeStrategy: readSettings().remoteAlbumMergeStrategy ?? 'conservative',
  }));
  const fileScanner = dependencies.fileScanner ?? new NativeThenTsFileScanner(
    undefined,
    new TsFileScanner(),
    console.warn,
    () => getAppSettings().nativeFileScannerEnabled === true,
  );
  const coverCacheDir = dependencies.coverCacheDir
    ? resolveCoverCacheDir(databasePath, dependencies.coverCacheDir)
    : resolveConfiguredCoverCacheDir(databasePath, (dependencies.appSettings ?? getAppSettingsSafe)());
  const albumService = new AlbumService();
  const appSettings = readSettings();
  const recommendedScanConcurrency = getRecommendedScanConcurrency({
    mode: appSettings.scanPerformanceMode ?? 'balanced',
  });
  const scanConcurrency: ScanConcurrencyRecommendation = {
    ...recommendedScanConcurrency,
    metadataConcurrency: dependencies.metadataConcurrency ?? recommendedScanConcurrency.metadataConcurrency,
    coverConcurrency: dependencies.coverConcurrency ?? recommendedScanConcurrency.coverConcurrency,
  };
  const workerBackedScanWorkers =
    dependencies.metadataReader || dependencies.coverExtractor || dependencies.metadataService
      ? null
      : createWorkerBackedLibraryScanWorkers({
          workerCount: Math.max(scanConcurrency.metadataConcurrency, scanConcurrency.coverConcurrency),
        });
  const tsMetadataReader =
    dependencies.metadataService
      ? {
          read: async (filePath: string) =>
            inflateMetadataResult(
              await dependencies.metadataService!.read({
                path: filePath,
                folderId: '',
                sizeBytes: 0,
                mtimeMs: 0,
              }),
            ),
        }
      : workerBackedScanWorkers?.metadataReader ?? new TsMetadataReader();
  const metadataReader =
    dependencies.metadataReader ??
    new NativeThenTsMetadataReader(
      undefined,
      tsMetadataReader,
      console.warn,
      () => getAppSettings().nativeMetadataReaderEnabled === true,
    );
  const coverExtractor = dependencies.coverExtractor ?? workerBackedScanWorkers?.coverExtractor ?? new TsCoverExtractor();
  const scanJobQueue = new ScanJobQueue(store, fileScanner, metadataReader, coverExtractor, albumService, {
    coverCacheDir,
    metadataConcurrency: scanConcurrency.metadataConcurrency,
    coverConcurrency: scanConcurrency.coverConcurrency,
    fileIdentityService: workerBackedScanWorkers?.fileIdentityService,
    getAlbumMergeStrategy: () => readSettings().albumMergeStrategy,
    shouldReduceScanPressure: shouldDelayGroupingRefreshForAudio,
    shouldDeferGroupingRefresh: shouldDelayGroupingRefreshForAudio,
    onScanSettled: (scanStatus) => {
      if (scanStatus.status === 'completed') {
        broadcastLibraryChanged();
      }
    },
    onDeferredGroupingRefresh: broadcastLibraryChanged,
    createDatabaseScanGuard: (scanStatus) =>
      shouldDisableScanGuardForDiagnostics()
        ? (logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'createDatabaseScanGuard',
            detail: 'scan guard disabled for diagnostics',
          }), null)
        : readSettings().dataProtectionDisabled === true
        ? null
        : createScanGuardLibraryDatabaseSnapshot(scanStatus, dirname(databasePath)),
    createCompletedScanSnapshot: async (scanStatus) => {
      if (shouldDisableScanGuardForDiagnostics()) {
        logLibraryScanPerf({
          jobId: scanStatus.id,
          folderId: scanStatus.folderId,
          phase: 'createCompletedScanSnapshot',
          detail: 'scan guard disabled for diagnostics',
        });
        return;
      }

      if (
        scanStatus.addedTracks === 0 &&
        scanStatus.updatedTracks === 0 &&
        scanStatus.removedTracks === 0 &&
        (scanStatus.coverCount ?? 0) === 0
      ) {
        return;
      }

      if (readSettings().dataProtectionDisabled === true) {
        return;
      }

      await createDataProtectionSnapshot('scan-completed-library-snapshot', dirname(databasePath), new Date(), {
        scope: 'background',
        beforePhase: (phase) => waitForCompletedScanSnapshotSlot(scanStatus, phase),
      });
    },
    recoverDatabaseFromScanGuard: async (snapshot, scanStatus, error) => {
      if (!snapshot) {
        return;
      }
      const restore = async (): Promise<void> => {
        await Promise.resolve(dependencies.closeDatabaseUsersBeforeRecovery?.() ?? closeDatabase());
        restoreProtectedLibraryDatabaseFromScanGuard(
          snapshot as LibraryDatabaseScanGuardSnapshot,
          scanStatus,
          error,
          dirname(databasePath),
        );
      };

      if (dependencies.runExclusiveDatabaseMaintenance) {
        await dependencies.runExclusiveDatabaseMaintenance('scan-guard-restore', restore);
        return;
      }

      await restore();
    },
    checkDatabaseHealth: async (scanStatus) => {
      if (shouldDisableScanHealthCheckForDiagnostics()) {
        logLibraryScanPerf({
          jobId: scanStatus.id,
          folderId: scanStatus.folderId,
          phase: 'checkDatabaseHealth',
          detail: 'scan health check disabled for diagnostics',
        });
        return;
      }

      try {
        if (!shouldRunScanHealthCheckSynchronouslyForDiagnostics() && (await shouldDelayGroupingRefreshForAudio())) {
          const openHealthStartedAtMs = performance.now();
          assertDatabaseOpenHealthy(databasePath);
          logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'checkDatabaseHealth.assert_open_for_playback',
            durationMs: performance.now() - openHealthStartedAtMs,
          });
          logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'checkDatabaseHealth.assert_cached',
            detail: 'skipped_full_quick_check_during_playback',
          });
          logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'checkDatabaseHealth.checkpoint',
            detail: 'skipped_during_playback',
          });
          return;
        }

        const healthStartedAtMs = performance.now();
        assertDatabaseHealthy(databasePath, { cache: true });
        logLibraryScanPerf({
          jobId: scanStatus.id,
          folderId: scanStatus.folderId,
          phase: 'checkDatabaseHealth.assert_cached',
          durationMs: performance.now() - healthStartedAtMs,
        });
        if (shouldCheckpointScanHealthForDiagnostics()) {
          const checkpointStartedAtMs = performance.now();
          if (dependencies.checkpointDatabase) {
            dependencies.checkpointDatabase('scan-health-check');
          } else {
            database.pragma('wal_checkpoint(PASSIVE)');
          }
          logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'checkDatabaseHealth.checkpoint',
            durationMs: performance.now() - checkpointStartedAtMs,
          });
        } else {
          logLibraryScanPerf({
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: 'checkDatabaseHealth.checkpoint',
            detail: 'skipped_by_default',
          });
        }
      } catch (error) {
        recordLibraryDatabaseMaintenanceEvent({
          action: 'scan-health-failed',
          databasePath,
          scan: {
            jobId: scanStatus.id,
            folderId: scanStatus.folderId,
            phase: scanStatus.phase,
            totalFiles: scanStatus.totalFiles,
            processedFiles: scanStatus.processedFiles,
            skippedFiles: scanStatus.skippedFiles,
            addedTracks: scanStatus.addedTracks,
            updatedTracks: scanStatus.updatedTracks,
            removedTracks: scanStatus.removedTracks,
            errorCount: scanStatus.errors.length,
          },
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  const networkMetadataService = new NetworkMetadataService(database);
  const albumOnlineInfoService = new AlbumOnlineInfoService(database);
  const artistOnlineInfoService = new ArtistOnlineInfoService(database);
  const artistEventsService = new ArtistEventsService(undefined, database);
  const bpmAnalysisJobQueue = new BpmAnalysisJobQueue(store);
  const replayGainAnalysisJobQueue = new ReplayGainAnalysisJobQueue(store, {
    getTargetLufs: () => readSettings().replayGainTargetLufs ?? DEFAULT_REPLAY_GAIN_TARGET_LUFS,
  });
  const artistImageCacheDir = resolve(dependencies.artistImageCacheDir ?? join(dirname(databasePath), 'artist-images'));
  const artistImageCacheService = new ArtistImageCacheService(database, {
    cacheRoot: artistImageCacheDir,
    providers: dependencies.artistImageProviders,
    onUpdated: (payload) => {
      const windows = (electron as unknown as {
        BrowserWindow?: {
          getAllWindows: () => Array<{ webContents: { send: (channel: string, payload: unknown) => void } }>;
        };
      }).BrowserWindow?.getAllWindows() ?? [];

      for (const window of windows) {
        window.webContents.send(IpcChannels.LibraryArtistImagesUpdated, payload);
      }
    },
  });

  return new LibraryService(
    store,
    scanJobQueue,
    albumService,
    database,
    closeDatabase,
    databasePath,
    coverCacheDir,
    coverExtractor,
    metadataReader,
    networkMetadataService,
    bpmAnalysisJobQueue,
    replayGainAnalysisJobQueue,
    artistImageCacheService,
    readSettings,
    scanConcurrency,
    albumOnlineInfoService,
    artistOnlineInfoService,
    artistEventsService,
    () => workerBackedScanWorkers?.close(),
  );
};

let defaultLibraryService: LibraryService | null = null;

const closeDefaultDatabaseUsersBeforeRecovery = async (): Promise<void> => {
  const manager = getLibraryDatabaseManager();
  const [lyrics, mv, streaming, remote] = await Promise.all([
    import('../lyrics/LyricsService'),
    import('../mv/MvService'),
    import('../streaming/StreamingService'),
    import('./remote/RemoteSourceService'),
  ]);
  lyrics.closeDefaultLyricsService();
  mv.closeDefaultMvService();
  streaming.closeDefaultStreamingService();
  remote.closeDefaultRemoteSourceService();
  closeDefaultLibraryService();
  manager.closeAllUsers('scan-recovery');
};

export const getLibraryService = (): LibraryService => {
  assertProtectedLibraryAvailable();
  if (!defaultLibraryService) {
    const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

    if (!electronApp) {
      throw new Error('Electron app module is unavailable outside the Electron main process');
    }

    const databasePath = join(electronApp.getPath('userData'), 'echo-library.sqlite');
    const manager = getLibraryDatabaseManager();
    defaultLibraryService = createLibraryService(databasePath, {
      databaseConnection: manager.openServiceConnection('library'),
      closeDatabaseUsersBeforeRecovery: closeDefaultDatabaseUsersBeforeRecovery,
      runExclusiveDatabaseMaintenance: (reason, action) => manager.runExclusiveMaintenance(reason, action),
      checkpointDatabase: (reason) => {
        const health = manager.checkpoint(reason);
        if (health.status !== 'ok') {
          throw new Error(health.message ?? `Library database checkpoint failed: ${health.status}`);
        }
      },
    });
    defaultLibraryService.syncLiveLibraryWatcherFromSettings();
  }

  return defaultLibraryService;
};

export const closeDefaultLibraryService = (): void => {
  if (!defaultLibraryService) {
    return;
  }

  defaultLibraryService.close();
  defaultLibraryService = null;
};

const pathSize = (targetPath: string): number | null => {
  try {
    return existsSync(targetPath) ? statSync(targetPath).size : null;
  } catch {
    return null;
  }
};

const cleanText = (value: string, fallback = ''): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const cleanNullableText = (value: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const mimeTypeForImagePath = (filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLocaleLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      throw new Error(`Unsupported cover image type: ${filePath}`);
  }
};

const readCoverImage = (filePath: string): { data: Uint8Array; mimeType: string } => {
  const normalizedPath = resolve(filePath);

  if (!existsSync(normalizedPath)) {
    throw new Error(`Cover image is missing: ${normalizedPath}`);
  }

  return {
    data: readFileSync(normalizedPath),
    mimeType: mimeTypeForImagePath(normalizedPath),
  };
};

const hasImportMetadataOverrides = (metadata: {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
}): boolean => Object.values(metadata).some((value) => typeof value === 'string' && value.trim().length > 0);

const writeImportedEmbeddedTags = async (
  filePath: string,
  fields: MetadataResult['fields'],
  coverData: { data: Uint8Array; mimeType: string } | null,
  shouldWrite: boolean,
): Promise<string[]> => {
  if (!shouldWrite) {
    return [];
  }

  try {
    await writeEmbeddedTrackTags({
      filePath,
      coverData,
      tags: {
        title: fields.title,
        artist: fields.artist,
        album: fields.album,
        albumArtist: fields.albumArtist,
        trackNo: fields.trackNo,
        discNo: fields.discNo,
        year: fields.year,
        genre: fields.genre,
      },
    });
    return [];
  } catch (error) {
    return [`Failed to write imported embedded tags for ${filePath}: ${error instanceof Error ? error.message : String(error)}`];
  }
};

const supportedImageMimeType = (value: string | null | undefined): string | null => {
  const normalized = value?.split(';')[0]?.trim().toLocaleLowerCase();
  return normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp' ? normalized : null;
};

const coverDownloadTimeoutMs = 6000;
const maxNetworkCoverBytes = 12 * 1024 * 1024;

const mimeTypeForImageUrl = (url: string): string => {
  const path = new URL(url).pathname;
  return mimeTypeForImagePath(path);
};

const refererForImageUrl = (url: string): string => {
  try {
    const hostname = new URL(url).hostname.toLocaleLowerCase();
    if (hostname.endsWith('music.126.net') || hostname.endsWith('music.163.com')) {
      return 'https://music.163.com/';
    }
    if (hostname.endsWith('gtimg.cn') || hostname.endsWith('qq.com')) {
      return 'https://y.qq.com/';
    }
    if (hostname.endsWith('kugou.com') || hostname.endsWith('kgimg.com')) {
      return 'https://www.kugou.com/';
    }
    if (hostname.endsWith('bilibili.com') || hostname.endsWith('hdslb.com')) {
      return 'https://www.bilibili.com/';
    }
  } catch {
    // Fall back to the previous generic referer for malformed or proxy-only URLs.
  }
  return 'https://www.bilibili.com/';
};

const readCoverImageFromUrl = async (url: string, mimeTypeHint: string | null): Promise<{ data: Uint8Array; mimeType: string }> => {
  let coverUrl = url;
  let referer: string | null = null;
  if (url.startsWith('echo-image://remote/')) {
    const proxied = new URL(url);
    coverUrl = decodeURIComponent(proxied.pathname.replace(/^\/+/u, ''));
    referer = proxied.searchParams.get('referer');
  }
  referer ??= refererForImageUrl(coverUrl);

  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), coverDownloadTimeoutMs);
  try {
    response = await fetchWithNetworkProxy(coverUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw new Error(`封面下载失败，但标签信息仍可应用。${error instanceof Error ? ` ${error.message}` : ''}`);
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    throw new Error('封面下载失败，但标签信息仍可应用。');
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxNetworkCoverBytes) {
    clearTimeout(timeoutId);
    throw new Error('Network cover is too large; metadata can still be applied.');
  }

  const contentType = response.headers.get('content-type');
  const mimeType = supportedImageMimeType(mimeTypeHint) ?? supportedImageMimeType(contentType) ?? mimeTypeForImageUrl(coverUrl);
  let data: Uint8Array;
  try {
    data = new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }

  if (data.byteLength > maxNetworkCoverBytes) {
    throw new Error('Network cover is too large; metadata can still be applied.');
  }

  return {
    data,
    mimeType,
  };
};

const getAppSettingsSafe = (): AppSettings => {
  try {
    return getAppSettings();
  } catch {
    return { ...defaultSettings };
  }
};

const getRemoteTrackSafe = (trackId: string): LibraryTrack | null => {
  try {
    return getRemoteSourceService().getTrackAsLibraryTrack(trackId);
  } catch {
    return null;
  }
};

const metadataWithEmbeddedCover = (data: Uint8Array, mimeType: string): MetadataResult =>
  ({
    fields: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 0,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      bpm: null,
    },
    fieldSources: {},
    embeddedCover: { data, mimeType },
    embeddedMetadataStatus: 'missing',
    embeddedCoverStatus: 'present',
    warnings: [],
    errors: [],
    status: 'ok',
  }) satisfies MetadataResult;

const cleanNullableNumber = (value: number | null): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
};

const normalizeEditableTags = (tags: EditableTrackTags, previous: LibraryTrack): EditableTrackTags => {
  const title = cleanText(tags.title, previous.title || 'Untitled');
  const artist = cleanText(tags.artist, previous.artist || 'Unknown Artist');

  return {
    title,
    artist,
    album: cleanText(tags.album),
    albumArtist: cleanText(tags.albumArtist, artist),
    trackNo: cleanNullableNumber(tags.trackNo),
    discNo: cleanNullableNumber(tags.discNo),
    year: cleanNullableNumber(tags.year),
    genre: cleanNullableText(tags.genre),
  };
};

const normalizeEditableAlbumTags = (tags: EditableAlbumTags, previous: LibraryAlbum): EditableAlbumTags => ({
  album: cleanText(tags.album, previous.title || 'Untitled Album'),
  albumArtist: cleanText(tags.albumArtist, previous.albumArtist || 'Unknown Artist'),
  year: cleanNullableNumber(tags.year),
  genre: cleanNullableText(tags.genre),
});

const directorySize = (targetPath: string): number | null => {
  if (!existsSync(targetPath)) {
    return null;
  }

  let total = 0;
  const pending = [targetPath];

  try {
    while (pending.length) {
      const current = pending.pop()!;
      const stat = statSync(current);

      if (stat.isDirectory()) {
        for (const entry of readdirSync(current)) {
          pending.push(join(current, entry));
        }
      } else {
        total += stat.size;
      }
    }
  } catch {
    return null;
  }

  return total;
};

const directoryStats = (targetPath: string): { fileCount: number; sizeBytes: number } => {
  if (!existsSync(targetPath)) {
    return { fileCount: 0, sizeBytes: 0 };
  }

  let fileCount = 0;
  let sizeBytes = 0;
  const pending = [targetPath];

  while (pending.length) {
    const current = pending.pop()!;
    const stat = statSync(current);

    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        pending.push(join(current, entry));
      }
    } else {
      fileCount += 1;
      sizeBytes += stat.size;
    }
  }

  return { fileCount, sizeBytes };
};

const clearDirectoryContents = (targetPath: string): void => {
  mkdirSync(targetPath, { recursive: true });

  for (const entry of readdirSync(targetPath)) {
    rmSync(join(targetPath, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};
