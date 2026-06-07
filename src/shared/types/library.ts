export type LibrarySummary = {
  songCount: number;
  albumCount: number;
  artistCount: number;
  folderCount: number;
  totalDuration: number;
  lastScanAt: string | null;
};

export type LibraryCleanupResult = {
  scannedCount: number;
  removedCount: number;
};

export type LibraryMaintenanceCleanupResult = LibraryCleanupResult & {
  missingRemovedCount: number;
  shortRemovedCount: number;
  shortDurationThresholdSeconds: number;
};

export type PlaybackHistoryRefreshResult = {
  scannedCount: number;
  removedCount: number;
  removedEntriesCount: number;
  removedStatsCount: number;
};

export type LibraryCacheClearResult = LibraryCleanupResult & {
  deletedCoverCacheFiles: number;
  freedCoverCacheBytes: number;
};

export type LibraryDatabaseRepairResult = {
  databasePath: string;
  archivePath: string | null;
  removedDatabaseFiles: string[];
  readyForRescan: boolean;
};

export type LibraryDatabaseDeleteResult = {
  databasePath: string;
  archivePath: string | null;
  removedDatabaseFiles: string[];
};

export type LibraryAllUserDataDeleteResult = {
  userDataPath: string;
  coverCachePath: string | null;
  removedPaths: string[];
  failedPaths: Array<{ path: string; error: string }>;
};

export type LibraryDatabaseHealthStatus = 'ok' | 'corrupt' | 'unreadable';

export type LibraryDatabaseHealthInfo = {
  status: LibraryDatabaseHealthStatus;
  databasePath: string;
  checkedAt: string;
  message?: string;
  detail?: string;
};

export type LibraryDatabaseProtectionMode = 'ok' | 'degraded' | 'quarantined' | 'needs_recovery';
export type LibraryDatabaseProtectionReason =
  | 'none'
  | 'corrupt_database'
  | 'poisoned_metadata'
  | 'oversized_payload'
  | 'startup_timeout';

export type LibraryDatabasePoisonReport = {
  status: 'ok' | 'poisoned' | 'unreadable';
  reason: LibraryDatabaseProtectionReason;
  checkedAt: string;
  databasePath: string;
  suspectCounts: Record<string, number>;
  maxFieldLengths: Record<string, number>;
  message?: string;
};

export type LibraryDatabaseScrubResult = {
  databasePath: string;
  sourceArchivePath: string;
  scrubbedDatabasePath: string;
  archivePath: string | null;
  replacedDatabaseFiles: string[];
  scrubbedRows: number;
  health: LibraryDatabaseHealthInfo;
  poisonReportBefore: LibraryDatabasePoisonReport;
  poisonReportAfter: LibraryDatabasePoisonReport;
};

export type LibraryDatabaseDiscardProblemTracksResult = {
  databasePath: string;
  sourceArchivePath: string;
  scrubbedDatabasePath: string;
  discardArchivePath: string;
  archivePath: string | null;
  replacedDatabaseFiles: string[];
  discardedTracks: number;
  discardedTrackIds: string[];
  residualScrubbedRows: number;
  health: LibraryDatabaseHealthInfo;
  poisonReportBefore: LibraryDatabasePoisonReport;
  poisonReportAfter: LibraryDatabasePoisonReport;
};

export type LibraryDatabaseSnapshotInfo = {
  id: string;
  path: string;
  createdAt: string | null;
  reason: string | null;
  copied: string[];
  skipped: string[];
  libraryHealth: LibraryDatabaseHealthInfo;
  libraryBackupMethod: 'none' | 'sqlite-backup' | 'file-copy';
  databasePath: string | null;
  databaseSizeBytes: number | null;
  databaseMtimeMs?: number | null;
  walSizeBytes?: number | null;
  walMtimeMs?: number | null;
  shmSizeBytes?: number | null;
  shmMtimeMs?: number | null;
};

export type LibraryDatabaseArchiveInfo = {
  id: string;
  path: string;
  createdAt: string | null;
  reason: string | null;
  copied: string[];
  databasePath: string | null;
  databaseSizeBytes: number | null;
};

export type LibraryDatabaseMaintenanceEventInfo = {
  createdAt: string;
  action:
    | 'manual-repair'
    | 'manual-delete'
    | 'manual-restore'
    | 'manual-scrub-quarantined'
    | 'manual-discard-quarantined'
    | 'startup-protected'
    | 'startup-poisoned'
    | 'startup-auto-repair'
    | 'scan-health-failed'
    | 'scan-auto-restore';
  databasePath: string;
  archivePath?: string | null;
  removedDatabaseFiles?: string[];
  restoredSnapshotId?: string;
  health?: LibraryDatabaseHealthInfo;
  poisonReport?: LibraryDatabasePoisonReport;
  scan?: {
    jobId: string;
    folderId: string;
    phase: string;
    totalFiles: number;
    processedFiles: number;
    skippedFiles: number;
    addedTracks: number;
    updatedTracks: number;
    removedTracks: number;
    errorCount: number;
  };
  error?: string;
};

export type LibraryDatabaseManagerStateInfo = {
  databasePath: string;
  openConnections: number;
  connectionServiceNames: string[];
  maintenanceInProgress: boolean;
  activeMaintenanceReason: string | null;
  lastCloseReason: string | null;
  lastCheckpointAt: string | null;
  lastCheckpointReason: string | null;
  lastCheckpointHealth: LibraryDatabaseHealthInfo | null;
  protected: boolean;
  protectionRecoveryAction: 'none' | 'protected' | 'archivedOnly' | 'quarantined' | 'autoRestoredFromScanGuard' | 'failed' | null;
};

export type LibraryDatabaseProtectionStatus = {
  status: LibraryDatabaseProtectionMode;
  reason: LibraryDatabaseProtectionReason;
  dataProtectionPath: string;
  databasePath: string;
  databaseSizeBytes: number | null;
  archivePath?: string | null;
  poisonReport?: LibraryDatabasePoisonReport | null;
  health: LibraryDatabaseHealthInfo;
  snapshots: LibraryDatabaseSnapshotInfo[];
  latestHealthySnapshot: LibraryDatabaseSnapshotInfo | null;
  latestArchive: LibraryDatabaseArchiveInfo | null;
  maintenanceEvents: LibraryDatabaseMaintenanceEventInfo[];
  canRestoreSnapshot: boolean;
  canScrubQuarantinedDatabase?: boolean;
  hasRunningScan: boolean;
  protectionMode?: 'normal' | 'protected' | 'archivedOnly' | 'quarantined' | 'autoRestoredFromScanGuard';
  recommendedAction: 'none' | 'restore-snapshot' | 'scrub-quarantined-database' | 'rebuild-empty-database';
  unrecoverableReason?: string;
  managerState?: LibraryDatabaseManagerStateInfo;
};

export type LibraryDatabaseProtectionStatusOptions = {
  deepCheck?: boolean;
};

export type LibraryDatabaseRestoreResult = {
  databasePath: string;
  archivePath: string | null;
  restoredSnapshot: LibraryDatabaseSnapshotInfo;
  restoredDatabaseFiles: string[];
  health: LibraryDatabaseHealthInfo;
};

export type LibraryDatabaseRecoveryRelaunchResult = {
  scheduled: boolean;
  mode: 'startup-auto-repair';
  message: string;
};

export type ArtistImageCacheStatus = 'pending' | 'loading' | 'matched' | 'not_found' | 'error' | 'rate_limited';

export type ArtistImageCacheEntry = {
  artistKey: string;
  artistName: string;
  provider: string;
  providerArtistId: string | null;
  sourceUrl: string | null;
  sourceHash: string | null;
  thumbPath: string | null;
  mediumPath: string | null;
  largePath: string | null;
  status: ArtistImageCacheStatus;
  confidence: number;
  failureReason: string | null;
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArtistImageCacheSummary = {
  total: number;
  matched: number;
  pending: number;
  loading: number;
  notFound: number;
  error: number;
  rateLimited: number;
};

export type ArtistImageJobStatus = {
  paused: boolean;
  running: boolean;
  queued: number;
  active: number;
  lastQueued: ArtistImageQueueResult;
  summary: ArtistImageCacheSummary;
};

export type ArtistImageQueueResult = {
  queued: number;
  skipped: number;
  disabled?: boolean;
};

export type ArtistImageRefreshResult = {
  queued: boolean;
  disabled?: boolean;
  entry: ArtistImageCacheEntry | null;
};

export type ArtistImageCacheClearResult = {
  removedRows: number;
  deletedFiles: number;
  freedBytes: number;
};

export type ImportPathClassification = {
  folders: string[];
  audioFiles: string[];
  osuArchives: string[];
  unsupportedFiles: string[];
  missingPaths: string[];
};

export type LibraryMoveCandidateConfidence = 'high' | 'medium' | 'low';

export type LibraryMoveCandidate = {
  candidateId: string;
  confidence: LibraryMoveCandidateConfidence;
  ambiguous: boolean;
  oldTrackId: string;
  oldPath: string;
  newTrackId: string;
  newPath: string;
  reasonCodes: string[];
  fileIdentityMatched: boolean;
  quickHashMatched: boolean;
  sizeMatched: boolean;
  durationDelta: number | null;
  metadataMatched: boolean;
  createdAt: string;
};

export type LibraryMoveCandidateOptions = {
  limit?: number;
};

export type LibraryMoveRepairResult = {
  candidateId: string;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  oldTrackId: string | null;
  newTrackId: string | null;
  playlistItemsToRelink: number;
  playbackHistoryEntriesToRelink: number;
  playbackHistoryStatsToRelink: number;
  deletedOldTrackRow: boolean;
  appliedAt: string | null;
};

export type LibraryLabWatcherEvent = {
  timestamp: string;
  folderId: string;
  eventType: 'add' | 'change' | 'unlink' | 'rename' | 'unknown';
  path: string;
  extension: string;
  sizeBytes?: number;
  mtimeMs?: number;
  stableForMs?: number;
};

export type NativeFileScannerEnablementSource = 'env-disable' | 'env-enable' | 'setting' | 'default';

export type NativeFileScannerDiagnostics = {
  enabled: boolean;
  enablementSource: NativeFileScannerEnablementSource;
  binaryFound: boolean;
  binaryPath: string | null;
  willUseNative: boolean;
};

export type NativeMetadataReaderDiagnostics = {
  enabled: boolean;
  enablementSource: NativeFileScannerEnablementSource;
  binaryFound: boolean;
  binaryPath: string | null;
  willUseNative: boolean;
  supportedFormats: string[];
};

export type LibraryLabState = {
  watcherEnabled: boolean;
  watcherRunning: boolean;
  autoRescanEnabled: boolean;
  moveCandidateEnabled: boolean;
  moveRepairLabEnabled: boolean;
  watchedFolderCount: number;
  totalEventCount: number;
  pendingPathCount: number;
  triggeredRescanCount: number;
  droppedPathCount: number;
  skippedDeleteEventCount: number;
  skippedRenameEventCount: number;
  lastTriggeredRescanAt: string | null;
  lastRescanError: string | null;
  watcherLastError: string | null;
  lastWatcherEventAt: string | null;
  lastRescanStartedAt: string | null;
  lastRescanFinishedAt: string | null;
  lastRescanPathCount: number;
  lastMetadataBackfillCount: number;
  placeholderTrackCount: number;
  lastSkippedByCacheCount: number;
  moveCandidateCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  ambiguousCount: number;
  lastMoveRepairAt: string | null;
  lastMoveRepairError: string | null;
  groupingRefreshQueued: boolean;
  lastGroupingRefreshDurationMs: number | null;
  lastGroupingRefreshAt: string | null;
  groupingRefreshDelayedForPlaybackCount: number;
  lastGroupingRefreshError: string | null;
  nativeFileScanner: NativeFileScannerDiagnostics;
  nativeMetadataReader: NativeMetadataReaderDiagnostics;
  recentWatcherEvents: LibraryLabWatcherEvent[];
};

export type LibraryDiagnostics = {
  foldersCount: number;
  tracksCount: number;
  albumsCount: number;
  artistsCount: number;
  coversCount: number;
  lastScan: {
    status: LibraryScanStatus['status'];
    phase: LibraryScanStatus['phase'];
    discoveredCount: number;
    parsedCount: number;
    skippedCount: number;
    coverCount: number;
    errorCount: number;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  lastQueryMs: {
    getTracks: number | null;
    getAlbums: number | null;
  };
  averageAlbumPayloadBytes: number | null;
  databasePath: string | null;
  databaseSizeBytes: number | null;
  coverCachePath: string | null;
  coverCacheSizeBytes: number | null;
  coverCacheVersion: number;
  cpuCount: number;
  scanPerformanceMode: 'low' | 'balanced' | 'performance';
  metadataConcurrency: number;
  coverConcurrency: number;
  nativeFileScanner?: NativeFileScannerDiagnostics;
  nativeMetadataReader?: NativeMetadataReaderDiagnostics;
  audioAnalysisEnabled?: boolean;
  tracksWithFileIdentity?: number;
  tracksWithQuickHash?: number;
  tracksIdentityUnsupported?: number;
  tracksIdentityError?: number;
  groupingRefreshQueued?: boolean;
  lastGroupingRefreshDurationMs?: number | null;
  lastGroupingRefreshAt?: string | null;
  groupingRefreshDelayedForPlaybackCount?: number;
  lastGroupingRefreshError?: string | null;
  moveCandidates?: LibraryMoveCandidate[];
};

export type LibraryFolder = {
  id: string;
  path: string;
  name: string;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type LibraryFolderMetricSnapshot = {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  totalDuration: number;
  totalSizeBytes: number;
  missingTrackCount: number;
  losslessTrackCount: number;
  hiResTrackCount: number;
  childFolderCount: number;
  coverThumbs: string[];
};

export type LibraryFolderOverview = LibraryFolder &
  LibraryFolderMetricSnapshot & {
    lastScanAt: string | null;
    recentScan: LibraryScanStatus | null;
  };

export type LibraryFolderNode = {
  folderId: string;
  path: string;
  parentPath: string;
  name: string;
  depth: number;
  trackCount: number;
  directTrackCount: number;
  childFolderCount: number;
  totalDuration: number;
  totalSizeBytes: number;
  coverThumbs: string[];
};

export type LibraryFolderChildrenQuery = {
  folderId: string;
  parentPath?: string;
};

export type LibraryFolderTracksQuery = LibraryPageQuery & {
  folderId: string;
  path?: string;
  recursive?: boolean;
};

export type LibraryFolderPathRequest = {
  folderId: string;
  path?: string;
};

export type LibraryScanStatus = {
  id: string;
  folderId: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  phase:
    | 'queued'
    | 'discovering'
    | 'checking_cache'
    | 'reading_metadata'
    | 'extracting_covers'
    | 'grouping_albums'
    | 'writing_database'
    | 'finished'
    | 'failed'
    | 'cancelled';
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  addedTracks: number;
  updatedTracks: number;
  removedTracks: number;
  coverCount?: number;
  errorCount: number;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
};

export type LibraryScanMode = 'normal' | 'embedded-tags-all' | 'embedded-tags-missing-cover';

export type LibraryScanOptions = {
  mode?: LibraryScanMode;
  changesOnly?: boolean;
  deferGroupingRefresh?: boolean;
  skipDeferredGroupingRefresh?: boolean;
  reduceScanPressure?: boolean;
  storedTrackPath?: string;
  storedTrackRecursive?: boolean;
};

export type LibraryEmbeddedTagRescanOptions = {
  folderId?: string;
  path?: string;
  recursive?: boolean;
};

export type ArtistInsightRelationKind =
  | 'same_album'
  | 'collaboration'
  | 'same_genre'
  | 'similar_bpm'
  | 'playback_adjacent'
  | 'online_similar'
  | 'member'
  | 'external_url';

export type ArtistInsightNode = {
  id: string;
  name: string;
  trackCount: number;
  albumCount: number;
  coverThumb: string | null;
  avatarUrl?: string | null;
  source: 'local' | 'musicbrainz' | 'lastfm';
};

export type ArtistInsightEdge = {
  id: string;
  sourceArtistId: string;
  targetArtistId: string;
  kind: ArtistInsightRelationKind;
  weight: number;
  evidence: string;
  source: 'local' | 'musicbrainz' | 'lastfm';
};

export type ArtistConcertEvent = {
  id: string;
  source: 'bandsintown' | 'ticketmaster' | 'seatgeek' | 'songkick' | 'eplus' | 'eventernote';
  sourceLabel?: string;
  title: string;
  startsAt: string;
  timezone?: string | null;
  timeTbd?: boolean;
  venueName: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  url: string | null;
  ticketUrl?: string | null;
  venueUrl?: string | null;
  imageUrl?: string | null;
};

export type ArtistConcertInfo = {
  status: 'not_configured' | 'loading' | 'ready' | 'unavailable';
  region: string | null;
  sources: Array<ArtistConcertEvent['source']>;
  events: ArtistConcertEvent[];
  fetchedAt: string | null;
  message?: string;
  candidateSources?: Array<{
    source: ArtistConcertEvent['source'];
    label: string;
    url: string;
  }>;
};

export type ArtistOnlineInfoExternalLink = {
  label: string;
  url: string;
  source: 'wikipedia' | 'baidu-baike' | 'moegirl' | 'musicbrainz' | 'wikidata' | 'spotify' | 'bandsintown' | 'other';
};

export type ArtistOnlineInfoBio = {
  title: string;
  description: string | null;
  extract: string;
  extractHtml?: string | null;
  url: string | null;
  language: string;
  thumbnailUrl: string | null;
};

export type ArtistOnlineRelation = {
  name: string;
  type: string | null;
  url: string | null;
  source: 'musicbrainz' | 'wikidata' | 'other';
};

export type ArtistOnlineInfo = {
  status: 'loading' | 'ready' | 'partial' | 'empty' | 'unavailable';
  bio: ArtistOnlineInfoBio | null;
  imageCredits: string[];
  externalLinks: ArtistOnlineInfoExternalLink[];
  relatedArtists?: ArtistOnlineRelation[];
  sourceLabels: string[];
  fetchedAt: string | null;
  expiresAt?: string | null;
  fromCache?: boolean;
  errors?: string[];
  message?: string;
};

export type ArtistOnlineInfoCacheClearResult = {
  removedRows: number;
};

export type ArtistInsightsOptions = {
  limit?: number;
  includeOnline?: boolean;
  forceOnline?: boolean;
  region?: string | null;
};

export type ArtistInsights = {
  artist: LibraryArtist | null;
  nodes: ArtistInsightNode[];
  edges: ArtistInsightEdge[];
  onlineInfo: ArtistOnlineInfo;
  concerts: ArtistConcertInfo;
  generatedAt: string;
};

export type LibrarySort =
  | 'default'
  | 'createdAsc'
  | 'createdDesc'
  | 'titleAsc'
  | 'titleDesc'
  | 'durationAsc'
  | 'durationDesc'
  | 'fileModifiedAsc'
  | 'fileModifiedDesc'
  | 'qualityAsc'
  | 'qualityDesc'
  | 'frequent'
  | 'random'
  | 'title'
  | 'artist'
  | 'artistAlbum'
  | 'album'
  | 'recent';

export type LibraryPageQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: LibrarySort;
  sourceProvider?: PlaylistSourceProvider;
  sourceId?: string | null;
  hideDuplicates?: boolean;
  showDuplicatesOnly?: boolean;
  duplicateMode?: DuplicateTrackMode;
  prioritizeArtistAvatars?: boolean;
  excludeTrackIds?: string[];
  randomWindow?: boolean;
};

export type PlaylistKind = 'manual' | 'smart' | 'synced' | 'system';
export type PlaylistSourceProvider = 'local' | 'netease' | 'qqmusic' | 'kugou' | 'spotify' | 'remote' | 'm3u8';
export type PlaylistSortMode = 'manual' | 'titleAsc' | 'titleDesc' | 'artistAsc' | 'addedDesc';
export type PlaylistMediaType = 'track' | 'album' | 'stream_track' | 'remote_file';
export type PlaylistExportFormat = 'json' | 'txt' | 'm3u8' | 'csv';

export type LibraryPlaylist = {
  id: string;
  name: string;
  description: string | null;
  kind: PlaylistKind;
  sourceProvider: PlaylistSourceProvider;
  sourcePlaylistId: string | null;
  coverId: string | null;
  coverThumb: string | null;
  sortMode: PlaylistSortMode;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryPlaylistItem = {
  id: string;
  playlistId: string;
  mediaType: PlaylistMediaType;
  mediaId: string | null;
  sourceProvider: PlaylistSourceProvider;
  sourceItemId: string | null;
  titleSnapshot: string | null;
  artistSnapshot: string | null;
  albumSnapshot: string | null;
  durationSnapshot: number | null;
  coverId: string | null;
  coverThumb: string | null;
  position: number;
  addedAt: string;
  addedFrom: string | null;
  unavailable: boolean;
  track: LibraryTrack | null;
  album?: LibraryAlbum | null;
};

export type CreatePlaylistRequest = {
  name: string;
  description?: string | null;
};

export type ImportStreamingPlaylistResult = {
  playlist: LibraryPlaylist;
  importedCount: number;
  provider: 'netease' | 'qqmusic' | 'kugou';
  providerPlaylistId: string;
};

export type UpdatePlaylistRequest = {
  playlistId: string;
  name?: string;
  description?: string | null;
  coverId?: string | null;
  coverPath?: string | null;
  sortMode?: PlaylistSortMode;
};

export type ExportPlaylistRequest = {
  playlistId: string;
  format: PlaylistExportFormat;
};

export type ImportPlaylistFileResult = {
  playlistId: string;
  playlistName: string;
  importedCount: number;
  filePath: string;
};

export type AddLocalAudioFilesToPlaylistResult = {
  importedCount: number;
  addedCount: number;
  skippedCount: number;
  failedCount: number;
  trackIds: string[];
  items: LibraryPlaylistItem[];
};

export type ImportAudioFilesResult = {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  trackIds: string[];
  tracks: LibraryTrack[];
};

export type PlaybackHistoryEntry = {
  id: string;
  trackId: string | null;
  trackPath: string;
  mediaType: 'local' | 'remote' | 'streaming';
  provider: string | null;
  providerTrackId: string | null;
  stableKey: string | null;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  coverId: string | null;
  coverThumb: string | null;
  startedAt: string;
  endedAt: string | null;
  playedSeconds: number;
  durationSeconds: number;
  durationSnapshot: number | null;
  coverSnapshot: string | null;
  playCount: number;
  completed: boolean;
  sourceType: string | null;
  sourceLabel: string | null;
  queueId: string | null;
};

export type PlaybackHistoryQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  from?: string;
  to?: string;
  completedOnly?: boolean;
  sort?: 'plays' | 'recent';
};

export type StartPlaybackHistoryRequest = {
  trackId: string | null;
  mediaType?: 'local' | 'remote' | 'streaming';
  sourceId?: string | null;
  provider?: string | null;
  providerTrackId?: string | null;
  stableKey?: string | null;
  remotePath?: string | null;
  trackPath?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  coverId?: string | null;
  coverSnapshot?: string | null;
  durationSeconds?: number;
  sourceType?: string | null;
  sourceLabel?: string | null;
  queueId?: string | null;
};

export type StartPlaybackHistoryResult = {
  historyId: string;
};

export type FinishPlaybackHistoryRequest = {
  historyId: string;
  playedSeconds: number;
  durationSeconds?: number;
  completed?: boolean;
  endedAt?: string;
};

export type PlaybackHistorySummary = {
  todayCount: number;
  todayPlayedSeconds: number;
  totalCount: number;
  latestPlayedAt: string | null;
  rangeCount: number;
  rangePlayedSeconds: number;
  rangeLatestPlayedAt: string | null;
};

export type PlaybackStatsTrack = {
  id: string;
  trackId: string | null;
  title: string;
  artist: string;
  album: string;
  coverThumb: string | null;
  playCount: number;
  completedCount: number;
  playedSeconds: number;
  durationSeconds: number;
  lastPlayedAt: string | null;
};

export type PlaybackStatsArtist = {
  artist: string;
  playCount: number;
  completedCount: number;
  playedSeconds: number;
};

export type PlaybackStatsAlbum = {
  id: string;
  albumId: string | null;
  mediaType?: 'local' | 'remote';
  albumKey: string | null;
  title: string;
  albumArtist: string;
  year: number | null;
  trackCount: number;
  duration: number;
  coverId: string | null;
  coverThumb: string | null;
  playCount: number;
  completedCount: number;
  playedSeconds: number;
  lastPlayedAt: string | null;
};

export type PlaybackStatsBreakdownItem = {
  id: string;
  label: string;
  playCount: number;
  playedSeconds: number;
};

export type PlaybackStatsDay = {
  date: string;
  playCount: number;
  playedSeconds: number;
};

export type PlaybackStatsDashboard = {
  generatedAt: string;
  totals: {
    playCount: number;
    completedCount: number;
    playedSeconds: number;
    uniqueTracks: number;
    uniqueArtists: number;
  };
  topTracks: PlaybackStatsTrack[];
  topArtists: PlaybackStatsArtist[];
  topAlbums?: PlaybackStatsAlbum[];
  formatBreakdown: PlaybackStatsBreakdownItem[];
  qualityBreakdown: PlaybackStatsBreakdownItem[];
  dailyActivity: PlaybackStatsDay[];
};

export type LibraryTrack = {
  id: string;
  mediaType?: 'local' | 'remote' | 'streaming';
  isTemporary?: boolean;
  path: string;
  sourceId?: string | null;
  sourceDisplayName?: string | null;
  provider?: string | null;
  providerTrackId?: string | null;
  streamingQuality?: 'standard' | 'high' | 'lossless' | 'hires';
  remotePath?: string | null;
  stableKey?: string | null;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  bpm?: number | null;
  bpmConfidence?: number | null;
  beatOffsetMs?: number | null;
  analysisStatus?: 'none' | 'pending' | 'analyzing' | 'complete' | 'low_confidence' | 'error';
  analysisUpdatedAt?: string | null;
  replayGainTrackGainDb?: number | null;
  replayGainAlbumGainDb?: number | null;
  replayGainTrackPeak?: number | null;
  replayGainAlbumPeak?: number | null;
  replayGainIntegratedLufs?: number | null;
  replayGainSource?: 'none' | 'tag' | 'analysis';
  replayGainStatus?: 'none' | 'tagged' | 'analyzing' | 'complete' | 'missing' | 'error';
  replayGainUpdatedAt?: string | null;
  coverId: string | null;
  // Small list thumbnail: echo-cover://thumb/* resolves to thumb.webp (96x96).
  coverThumb: string | null;
  metadataStatus?: string;
  embeddedMetadataStatus?: 'pending' | 'reading' | 'present' | 'missing' | 'error';
  embeddedCoverStatus?: 'pending' | 'reading' | 'present' | 'missing' | 'error';
  networkMetadataStatus?: 'none' | 'pending' | 'candidate_found' | 'applied_missing_only' | 'rejected' | 'error';
  fieldSources: Record<string, string>;
  unavailable?: boolean;
  playlistItemId?: string;
};

export type DuplicateTrackMode = 'strict' | 'balanced' | 'aggressive';

export type DuplicateTrackGroup = {
  id: string;
  mode: DuplicateTrackMode;
  duplicateKey: string;
  representativeTrackId: string;
  trackCount: number;
  hiddenCount: number;
  confidence: number;
  reasons: string[];
};

export type DuplicateTrackMember = {
  groupId: string;
  track: LibraryTrack;
  qualityScore: number;
  rank: number;
  hidden: boolean;
  reasons: string[];
};

export type DuplicateTrackIndexSummary = {
  mode: DuplicateTrackMode;
  totalTracksScanned: number;
  duplicateGroups: number;
  duplicateMembers: number;
  hiddenTracks: number;
  updatedAt: string;
};

export type DuplicateTrackCleanupMember = {
  track: LibraryTrack;
  qualityScore: number;
  rank: number;
  sizeBytes: number | null;
  reasons: string[];
};

export type DuplicateTrackCleanupGroup = {
  id: string;
  duplicateKey: string;
  confidence: number;
  trackCount: number;
  keep: DuplicateTrackCleanupMember;
  remove: DuplicateTrackCleanupMember[];
};

export type DuplicateTrackCleanupPreview = {
  summary: DuplicateTrackIndexSummary;
  groups: DuplicateTrackCleanupGroup[];
  removeTrackIds: string[];
  totalTracksToRemove: number;
  totalBytesToRemove: number;
  generatedAt: string;
};

export type DuplicateTrackCleanupApplyRequest = {
  trackIds: string[];
  mode?: DuplicateTrackMode;
};

export type DuplicateTrackCleanupFailure = {
  trackId: string;
  title: string | null;
  path: string | null;
  error: string;
};

export type DuplicateTrackCleanupResult = {
  requestedTrackIds: number;
  trashedTracks: number;
  missingFiles: number;
  removedFromLibrary: number;
  failedTracks: DuplicateTrackCleanupFailure[];
  totalBytesRequested: number;
  updatedSummary: DuplicateTrackIndexSummary;
};

export type EditableTrackTags = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  bpm?: number | null;
};

export type BpmAnalysisResult = {
  trackId: string;
  bpm: number | null;
  confidence: number;
  beatOffsetMs: number | null;
  status: 'complete' | 'low_confidence' | 'error';
  error: string | null;
  updatedAt: string;
};

export type BpmAnalysisJobStatus = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalTracks: number;
  processedTracks: number;
  updatedTracks: number;
  errorCount: number;
  currentTrackTitle: string | null;
  startedAt: string;
  finishedAt: string | null;
  errors: string[];
};

export type BpmAnalysisStartOptions = {
  limit?: number;
  trackIds?: string[];
  force?: boolean;
};

export type ReplayGainAnalysisResult = {
  trackId: string;
  trackGainDb: number | null;
  trackPeak: number | null;
  integratedLufs: number | null;
  status: 'complete' | 'missing' | 'error';
  error: string | null;
  updatedAt: string;
};

export type ReplayGainAnalysisJobStatus = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalTracks: number;
  processedTracks: number;
  updatedTracks: number;
  errorCount: number;
  currentTrackTitle: string | null;
  startedAt: string;
  finishedAt: string | null;
  errors: string[];
};

export type ReplayGainAnalysisStartOptions = {
  limit?: number;
  trackIds?: string[];
  force?: boolean;
};

export type LyricsBackfillMode = 'quick' | 'complete';

export type LyricsBackfillJobStatus = {
  id: string;
  mode: LyricsBackfillMode;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  phase: 'queued' | 'collecting' | 'matching' | 'finished';
  autoAcceptScore?: number;
  playbackThrottled?: boolean;
  totalTracks: number;
  scannedTracks: number;
  processedTracks: number;
  matchedTracks: number;
  alreadyCachedTracks: number;
  notFoundTracks: number;
  errorCount: number;
  currentTrackTitle: string | null;
  startedAt: string;
  finishedAt: string | null;
  errors: string[];
};

export type LyricsBackfillStartOptions = {
  mode?: LyricsBackfillMode;
  limit?: number;
  concurrency?: number;
  autoAcceptScore?: number;
  force?: boolean;
};

export type TrackCoverSelection = {
  path: string;
  mimeType: string;
  dataUrl: string;
};

export type EmbeddedTrackTagsLoadResult = {
  tags: EditableTrackTags;
  coverId: string | null;
  coverThumb: string | null;
  track: LibraryTrack;
};

export type LibraryTrackTagUpdateRequest = {
  trackId: string;
  tags: EditableTrackTags;
  coverPath?: string | null;
  coverUrl?: string | null;
  coverMimeType?: string | null;
};

export type EditableAlbumTags = {
  album: string;
  albumArtist: string;
  year: number | null;
  genre: string | null;
};

export type LibraryAlbumTagUpdateRequest = {
  albumId: string;
  tags: EditableAlbumTags;
  coverPath?: string | null;
  coverUrl?: string | null;
  coverMimeType?: string | null;
};

export type NetworkTagProvider = 'netease-cloud-music' | 'qq-music' | 'kugou-music' | 'musicbrainz' | 'cover-art-archive' | 'mock';

export type NetworkTagCandidate = {
  id: string;
  provider: NetworkTagProvider;
  confidence: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  coverUrl?: string | null;
  coverMimeType?: string | null;
  coverPreviewUrl?: string | null;
  raw?: unknown;
};

export type NetworkTagCandidateSearchRequest = {
  trackId: string;
  query?: string;
  providers?: NetworkTagProvider[];
};

export type LyricsBackgroundCoverResult = {
  coverUrl: string;
  provider: NetworkTagProvider;
  confidence: number;
};

export type LibraryAlbum = {
  id: string;
  mediaType?: 'local' | 'remote' | 'streaming';
  sourceId?: string | null;
  sourceDisplayName?: string | null;
  provider?: string | null;
  albumKey: string;
  title: string;
  albumArtist: string;
  year: number | null;
  trackCount: number;
  duration: number;
  coverId: string | null;
  // Album wall thumbnail: echo-cover://album/* resolves to album.webp (320x320).
  coverThumb: string | null;
};

export type LibraryAlbumDetail = LibraryAlbum & {
  // Detail hero artwork: echo-cover://large/* resolves to large.webp when available.
  coverLarge: string | null;
};

export type AlbumOnlineInfoStatus = 'ready' | 'partial' | 'empty' | 'error';

export type AlbumOnlineInfoSource = {
  provider: 'musicbrainz' | 'wikipedia';
  label: string;
};

export type AlbumSourceLink = {
  provider:
    | 'musicbrainz'
    | 'wikipedia'
    | 'wikidata'
    | 'vgmdb'
    | 'discogs'
    | 'rateYourMusic'
    | 'spotify'
    | 'appleMusic'
    | 'youtubeMusic'
    | 'bandcamp'
    | 'official'
    | 'other';
  label: string;
  url: string;
  kind: 'database' | 'streaming' | 'official' | 'reference' | 'other';
};

export type AlbumExternalRating = {
  provider: 'rateYourMusic' | 'musicbrainz' | 'discogs';
  score: number;
  maxScore: number;
  ratingCount: number | null;
  rankText: string | null;
  url: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  confidence: number;
};

export type AlbumOnlineInfoMatch = {
  provider: 'musicbrainz';
  providerItemId: string;
  title: string;
  artist: string;
  year: number | null;
  confidence: number;
  url: string | null;
  possible: boolean;
};

export type AlbumCreditPerson = {
  name: string;
  detail: string | null;
  trackTitle: string | null;
  source: 'release' | 'recording' | 'work' | 'label';
};

export type AlbumCreditGroup = {
  role: string;
  people: AlbumCreditPerson[];
};

export type AlbumInformationSummary = {
  title: string;
  description: string | null;
  extract: string;
  url: string | null;
  language: string;
  thumbnailUrl: string | null;
  externalLinks?: Array<{
    label: string;
    url: string;
  }>;
};

export type AlbumReleaseLabel = {
  name: string;
  catalogNumber: string | null;
};

export type AlbumReleaseDetails = {
  title: string;
  date: string | null;
  country: string | null;
  barcode: string | null;
  status: string | null;
  labels: AlbumReleaseLabel[];
  mediaFormats: string[];
  copyrights: string[];
};

export type AlbumReleaseVersion = {
  providerItemId: string;
  title: string;
  artist: string;
  year: number | null;
  date: string | null;
  country: string | null;
  barcode: string | null;
  status: string | null;
  disambiguation: string | null;
  mediaFormats: string[];
  trackCount: number | null;
  catalogNumbers: string[];
  labels: string[];
  url: string;
  confidence: number;
  isMatched: boolean;
};

export type AlbumOnlineInfo = {
  albumId: string;
  status: AlbumOnlineInfoStatus;
  sources: AlbumOnlineInfoSource[];
  match: AlbumOnlineInfoMatch | null;
  sourceLinks: AlbumSourceLink[];
  externalRatings: AlbumExternalRating[];
  releaseDetails: AlbumReleaseDetails | null;
  releaseVersions: AlbumReleaseVersion[];
  credits: AlbumCreditGroup[];
  information: AlbumInformationSummary | null;
  artistInformation: AlbumInformationSummary | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  fromCache: boolean;
  errors: string[];
};

export type AlbumOnlineInfoRequestOptions = {
  force?: boolean;
  provider?: 'all' | 'musicbrainz' | 'wikipedia';
};

export type LibraryArtist = {
  id: string;
  mediaType?: 'local' | 'remote';
  sourceId?: string | null;
  sourceDisplayName?: string | null;
  provider?: string | null;
  artistKey?: string;
  name: string;
  sortName: string;
  role: 'track' | 'album' | 'both';
  trackCount: number;
  albumCount: number;
  coverId: string | null;
  coverThumb: string | null;
  coverSource?: 'manual' | 'embedded' | 'folder' | 'network' | 'default' | null;
  avatarThumbUrl?: string | null;
  avatarUrl?: string | null;
  avatarStatus?: ArtistImageCacheStatus | null;
  avatarProvider?: string | null;
};

export type LibraryPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type LibraryQualityIssueKind =
  | 'missing_cover'
  | 'fallback_metadata'
  | 'unknown_artist_album'
  | 'embedded_read_failed'
  | 'network_candidate';

export type LibraryQualityIssueSeverity = 'info' | 'warning' | 'danger';

export type LibraryQualityIssueReason =
  | MissingMetadataReason
  | 'metadata_fallback'
  | 'missing_album_artist'
  | 'unknown_album'
  | 'embedded_metadata_error'
  | 'embedded_cover_error'
  | 'network_metadata_candidate'
  | 'network_cover_candidate';

export type LibraryQualityOverviewItem = {
  kind: LibraryQualityIssueKind;
  label: string;
  count: number;
  severity: LibraryQualityIssueSeverity;
  description: string;
  actionAvailable: boolean;
  lastError?: string | null;
};

export type LibraryQualityIssueQuery = {
  kind: LibraryQualityIssueKind;
  page?: number;
  pageSize?: number;
  sourceProvider?: PlaylistSourceProvider;
  search?: string;
};

export type LibraryQualityIssueItem = {
  track: LibraryTrack;
  reasons: LibraryQualityIssueReason[];
  candidateCount?: number;
};

export type LibraryQualityIssuePage = {
  items: LibraryQualityIssueItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  kind: LibraryQualityIssueKind;
};

export type LibraryInboxFilterKind =
  | 'all'
  | 'missing_cover'
  | 'metadata_issue'
  | 'unknown_artist'
  | 'unknown_album'
  | 'suspicious_file';

export type LibraryInboxScope = 'latest' | 'batch' | 'all';
export type LibraryInboxItemStatus = 'pending' | 'processed' | 'ignored';
export type LibraryInboxStatusFilter = 'all' | LibraryInboxItemStatus;

export type LibraryInboxBatch = {
  id: string;
  scanJobId: string;
  folderId: string;
  folderName: string;
  folderPath: string;
  addedCount: number;
  missingCoverCount: number;
  metadataIssueCount: number;
  createdAt: string;
  finishedAt: string;
};

export type LibraryInboxFacetOption = {
  value: string;
  label: string;
  count: number;
};

export type LibraryInboxIssueReason = LibraryQualityIssueReason | 'suspicious_file';

export type LibraryInboxTrackItem = {
  batchId: string;
  addedAt: string;
  track: LibraryTrack;
  reasons: LibraryInboxIssueReason[];
  inboxStatus: LibraryInboxItemStatus;
};

export type LibraryInboxAlbumSummary = {
  album: string;
  albumArtist: string;
  coverId: string | null;
  coverThumb: string | null;
  trackCount: number;
  missingCoverCount: number;
  metadataIssueCount: number;
  duration: number;
};

export type LibraryInboxStory = {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  folderCount: number;
  missingCoverCount: number;
  metadataIssueCount: number;
  unknownArtistCount: number;
  unknownAlbumCount: number;
  suspiciousCount: number;
  pendingCount: number;
  processedCount: number;
  ignoredCount: number;
  coverCompleteness: number;
  metadataCompleteness: number;
  totalDuration: number;
  topFolders: LibraryInboxFacetOption[];
  topArtists: LibraryInboxFacetOption[];
};

export type LibraryInboxTrackQuery = {
  batchId?: string | null;
  scope?: LibraryInboxScope;
  filter?: LibraryInboxFilterKind;
  status?: LibraryInboxStatusFilter;
  folderId?: string | null;
  album?: string | null;
  artist?: string | null;
  page?: number;
  pageSize?: number;
  search?: string;
};

export type LibraryInboxTrackPage = LibraryPage<LibraryInboxTrackItem> & {
  batches: LibraryInboxBatch[];
  selectedBatch: LibraryInboxBatch | null;
  scope: LibraryInboxScope;
  filter: LibraryInboxFilterKind;
  status: LibraryInboxStatusFilter;
  story: LibraryInboxStory;
  albums: LibraryInboxAlbumSummary[];
  facets: {
    folders: LibraryInboxFacetOption[];
    albums: LibraryInboxFacetOption[];
    artists: LibraryInboxFacetOption[];
  };
};

export type LibraryInboxCreatePlaylistRequest = Omit<LibraryInboxTrackQuery, 'page' | 'pageSize'> & {
  name?: string | null;
};

export type LibraryInboxItemRef = {
  batchId: string;
  trackId: string;
};

export type LibraryInboxUpdateStateRequest = {
  status: LibraryInboxItemStatus;
  items?: LibraryInboxItemRef[];
  query?: LibraryInboxTrackQuery;
};

export type LibraryInboxUpdateStateResult = {
  updatedCount: number;
  matchedCount: number;
  skippedCount: number;
  truncated: boolean;
  limit: number;
};

export type LibraryInboxPlaylistResult = {
  playlist: LibraryPlaylist;
  addedCount: number;
  matchedCount: number;
  skippedCount: number;
  truncated: boolean;
  limit: number;
};

export type LibraryInboxQueueResult = {
  tracks: LibraryTrack[];
  matchedCount: number;
  addedCount: number;
  skippedCount: number;
  truncated: boolean;
  limit: number;
};

export type LibraryHealthSafePath = {
  basename: string;
  pathHash: string;
};

export type LibraryHealthReportSummary = LibrarySummary & {
  warningCount: number;
};

export type LibraryHealthReportDatabase = {
  status: LibraryDatabaseProtectionMode | 'unknown';
  healthStatus: LibraryDatabaseHealthStatus | 'unknown';
  recommendedAction: LibraryDatabaseProtectionStatus['recommendedAction'];
  unrecoverableReason: string | null;
  canRestoreSnapshot: boolean;
  hasRunningScan: boolean;
  databaseSizeBytes: number | null;
  databasePath: LibraryHealthSafePath | null;
  latestHealthySnapshotId: string | null;
  managerProtected: boolean | null;
  managerOpenConnections: number | null;
  maintenanceInProgress: boolean;
};

export type LibraryHealthReportScan = {
  status: LibraryScanStatus['status'] | 'idle' | 'unknown';
  phase: LibraryScanStatus['phase'] | 'idle' | 'unknown';
  startedAt: string | null;
  finishedAt: string | null;
  discoveredCount: number;
  parsedCount: number;
  skippedCount: number;
  coverCount: number;
  errorCount: number;
  performanceMode: LibraryDiagnostics['scanPerformanceMode'] | 'unknown';
  metadataConcurrency: number | null;
  coverConcurrency: number | null;
  groupingRefreshQueued: boolean;
  lastGroupingRefreshError: string | null;
};

export type LibraryHealthReportCacheItem = {
  kind: string;
  label: string;
  path: LibraryHealthSafePath | null;
  sizeBytes: number;
  fileCount: number;
  movable: boolean;
  reason: string;
  lastError: string | null;
};

export type LibraryHealthReportCache = {
  generatedAt: string | null;
  totalSizeBytes: number;
  items: LibraryHealthReportCacheItem[];
  lastError: string | null;
};

export type LibraryHealthReportWatcher = {
  enabled: boolean;
  running: boolean;
  autoRescanEnabled: boolean;
  watchedFolderCount: number;
  pendingPathCount: number;
  triggeredRescanCount: number;
  skippedDeleteEventCount: number;
  skippedRenameEventCount: number;
  lastError: string | null;
  lastRescanError: string | null;
  lastTriggeredRescanAt: string | null;
};

export type LibraryHealthReportRemoteSource = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  syncMode: string;
  indexedTrackCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type LibraryHealthReportRemoteSources = {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  indexedTrackCount: number;
  backgroundPaused: boolean;
  backgroundPlaybackActive: boolean;
  backgroundUpdatedAt: string | null;
  lastError: string | null;
  sources: LibraryHealthReportRemoteSource[];
};

export type LibraryHealthReport = {
  generatedAt: string;
  summary: LibraryHealthReportSummary;
  database: LibraryHealthReportDatabase;
  scan: LibraryHealthReportScan;
  quality: LibraryQualityOverviewItem[];
  cache: LibraryHealthReportCache;
  watcher: LibraryHealthReportWatcher;
  remoteSources: LibraryHealthReportRemoteSources;
  warnings: string[];
};

export type NetworkMetadataCandidate = {
  id: string;
  trackId: string;
  albumId: string | null;
  provider: string;
  providerItemId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  trackNo: number | null;
  discNo: number | null;
  coverUrl: string | null;
  score: number;
  createdAt: string;
};

export type NetworkCoverCandidate = {
  id: string;
  trackId: string | null;
  albumId: string | null;
  provider: string;
  coverUrl: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  score: number;
  cachedThumbPath: string | null;
  cachedLargePath: string | null;
  createdAt: string;
};

export type NetworkCandidateList = {
  metadata: NetworkMetadataCandidate[];
  covers: NetworkCoverCandidate[];
};

export type NetworkApplyResult = {
  status: 'none' | 'pending' | 'candidate_found' | 'applied_missing_only' | 'rejected' | 'error';
  appliedFields: Record<string, string | number | null>;
  reason?: string;
};

export type NetworkApplyOptions = {
  fields?: MissingMetadataField[];
};

export type NetworkMetadataDiagnostics = {
  targetCount: number;
  providerErrors: number;
  noCandidateCount: number;
  protectedCount: number;
  appliedCount: number;
};

export type NetworkRepairResult = NetworkCandidateList & {
  applied: NetworkApplyResult[];
  errors: string[];
  diagnostics: NetworkMetadataDiagnostics;
};

export type MissingMetadataField =
  | 'cover'
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'trackNo'
  | 'discNo'
  | 'year'
  | 'genre';

export type MissingMetadataScanOptions = {
  limit?: number;
  fields?: MissingMetadataField[];
};

export type MissingMetadataReason =
  | 'missing_cover'
  | 'missing_title'
  | 'missing_artist'
  | 'missing_album'
  | 'missing_album_artist'
  | 'missing_track_no'
  | 'missing_disc_no'
  | 'missing_year'
  | 'missing_genre'
  | 'unknown_artist'
  | 'filename_fallback'
  | 'unknown_field';

export type MissingMetadataScanItem = {
  track: LibraryTrack;
  reasons: MissingMetadataReason[];
  candidates: NetworkCandidateList;
};

export type MissingMetadataScanResult = {
  items: MissingMetadataScanItem[];
  scannedCount: number;
  candidateCount: number;
  errors: string[];
  diagnostics: NetworkMetadataDiagnostics;
};

export type NetworkMetadataScanJobStatus = MissingMetadataScanResult & {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  fields: MissingMetadataField[];
  totalTracks: number;
  processedTracks: number;
  startedAt: string;
  finishedAt: string | null;
  currentTrackTitle: string | null;
};
