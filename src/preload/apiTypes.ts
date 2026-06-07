import type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioExportRequest,
  AudioExportResult,
  AudioOutputSettings,
  AudioSessionResetEvent,
  AudioStatus,
  ChannelBalanceState,
} from '../shared/types/audio';
import type { AppSettings, NetworkProxyTestResult } from '../shared/types/appSettings';
import type { TaskbarPlaybackStatus } from '../shared/types/taskbarPlayback';
import type {
  DataBackupExportResult,
  DataBackupImportResult,
  DataBackupProgress,
  DataBackupStatus,
  DataPackageExportResult,
  SettingsImportResult,
} from '../shared/types/settingsBackup';
import type { UpdateStatus } from '../shared/types/updates';
import type { AccountBrowser, AccountLoginStartResult, AccountProvider, AccountStatus, YouTubeBrowser } from '../shared/types/accounts';
import type { AppCacheInventory, CoverCacheMigrationResult, SetCoverCacheDirectoryRequest } from '../shared/types/coverCache';
import type { AirPlayReceiverStatus, ConnectDevice, ConnectReceiverStatus, ConnectSessionStatus, ConnectStartRequest } from '../shared/types/connect';
import type {
  OpraHeadphoneCorrectionApplyRequest,
  OpraHeadphoneCorrectionApplyResult,
  OpraHeadphoneCorrectionBrowseRequest,
  OpraHeadphoneCorrectionBrowseResult,
  OpraHeadphoneCorrectionSearchRequest,
  OpraHeadphoneCorrectionSearchResult,
} from '../shared/types/opra';
import type {
  EqBindProfileRequest,
  EqPreset,
  EqPresetImportPreviewResult,
  EqPresetImportResult,
  EqProfile,
  EqProfileBindingInfo,
  EqProfileBindingTarget,
  EqSavePresetRequest,
  EqSaveProfileRequest,
  EqSetBandEnabledRequest,
  EqSetBandFilterTypeRequest,
  EqSetBandFrequencyRequest,
  EqSetBandGainRequest,
  EqSetBandQRequest,
  EqState,
  RoomCorrectionState,
} from '../shared/types/eq';
import type { GlobalShortcutAction, GlobalShortcutValidationResult } from '../shared/types/globalShortcuts';
import type { DesktopLyricsState, DesktopLyricsStylePatch } from '../shared/types/desktopLyrics';
import type { MiniPlayerHideOptions, MiniPlayerState } from '../shared/types/miniPlayer';
import type {
  AddLocalAudioFilesToPlaylistResult,
  AlbumOnlineInfo,
  AlbumOnlineInfoRequestOptions,
  EmbeddedTrackTagsLoadResult,
  ImportAudioFilesResult,
  ImportPathClassification,
  LibraryAlbum,
  LibraryAllUserDataDeleteResult,
  LibraryAlbumDetail,
  LibraryAlbumTagUpdateRequest,
  LibraryArtist,
  LibraryCacheClearResult,
  LibraryCleanupResult,
  LibraryDatabaseDeleteResult,
  LibraryDatabaseDiscardProblemTracksResult,
  LibraryDatabaseRepairResult,
  LibraryDatabaseRecoveryRelaunchResult,
  LibraryDatabaseProtectionStatus,
  LibraryDatabaseProtectionStatusOptions,
  LibraryDatabaseRestoreResult,
  LibraryDatabaseScrubResult,
  LibraryMaintenanceCleanupResult,
  LibraryDiagnostics,
  LibraryLabState,
  LibraryMoveCandidate,
  LibraryMoveCandidateOptions,
  LibraryMoveRepairResult,
  LibraryTrackTagUpdateRequest,
  LibraryFolder,
  LibraryFolderChildrenQuery,
  LibraryFolderNode,
  LibraryFolderOverview,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryEmbeddedTagRescanOptions,
  ImportPlaylistFileResult,
  LibraryHealthReport,
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
  LibraryScanOptions,
  LibraryScanStatus,
  LibraryScanMode,
  LibrarySummary,
  LibraryTrack,
  ArtistImageCacheClearResult,
  ArtistImageCacheEntry,
  ArtistImageCacheSummary,
  ArtistImageJobStatus,
  ArtistImageQueueResult,
  ArtistImageRefreshResult,
  MissingMetadataScanOptions,
  MissingMetadataScanResult,
  BpmAnalysisResult,
  BpmAnalysisJobStatus,
  BpmAnalysisStartOptions,
  ReplayGainAnalysisJobStatus,
  ReplayGainAnalysisStartOptions,
  LyricsBackfillJobStatus,
  LyricsBackfillStartOptions,
  LyricsBackgroundCoverResult,
  NetworkApplyOptions,
  NetworkApplyResult,
  NetworkCandidateList,
  NetworkMetadataScanJobStatus,
  NetworkRepairResult,
  NetworkTagCandidate,
  NetworkTagCandidateSearchRequest,
  PlaybackHistoryEntry,
  PlaybackHistoryQuery,
  PlaybackHistoryRefreshResult,
  PlaybackHistorySummary,
  PlaybackStatsDashboard,
  StartPlaybackHistoryRequest,
  StartPlaybackHistoryResult,
  FinishPlaybackHistoryRequest,
  TrackCoverSelection,
  CreatePlaylistRequest,
  DuplicateTrackCleanupApplyRequest,
  DuplicateTrackCleanupPreview,
  DuplicateTrackCleanupResult,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
  ExportPlaylistRequest,
  UpdatePlaylistRequest,
  ArtistInsights,
  ArtistInsightsOptions,
  ArtistOnlineInfoCacheClearResult,
} from '../shared/types/library';
import type {
  LocalFileResolveResult,
  PlaybackMediaStartRequest,
  PlaybackPrepareLocalFileRequest,
  PlaybackStartRequest,
  PlaybackStatus,
  PersistedPlaybackSessionV1,
  PlaybackQueueSessionSaveOptions,
} from '../shared/types/playback';
import type {
  DiagnosticConsoleEntry,
  DiagnosticConsoleSnapshot,
  DiagnosticPerformanceStallPayload,
  LastCrashSummary,
  RendererErrorPayload,
} from '../shared/types/diagnostics';
import type { DiscordPresenceStatus } from '../shared/types/discordPresence';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadSearchRequest,
  DownloadSearchResponse,
  DownloadSettings,
  DownloadToolsStatus,
} from '../shared/types/downloads';
import type { LastFmAuthStartResult, LastFmStatus } from '../shared/types/lastfm';
import type {
  HqPlayerConnectionTestResult,
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendResult,
  HqPlayerPlaybackHandoffPlan,
  HqPlayerPlaybackHandoffRequest,
  HqPlayerSettings,
  HqPlayerStatus,
} from '../shared/types/hqplayer';
import type {
  PluginCreateExampleKind,
  PluginCreateExampleResult,
  PluginCoverLookupRequest,
  PluginCoverLookupResult,
  PluginEnableRequest,
  PluginImportPackageResult,
  PluginLyricsLookupRequest,
  PluginLyricsLookupResult,
  PluginListResult,
  PluginLogEntry,
  PluginMetadataLookupRequest,
  PluginMetadataLookupResult,
  PluginRunCommandRequest,
  PluginSettingsPatch,
  PluginSettingsResult,
  PluginSourcePlaybackRequest,
  PluginSourcePlaybackResult,
  PluginSourceSearchRequest,
  PluginSourceSearchResult,
  PluginSummary,
} from '../shared/types/plugins';
import type { SmtcCommand, SmtcDiagnostics, SmtcLyricsProgress } from '../shared/types/smtc';
import type {
  LyricsEmbedToTrackRequest,
  LyricsEmbedToTrackResult,
  LyricsProviderId,
  LyricsSearchCandidate,
  LyricsTrackSnapshotRequest,
  TrackLyrics,
} from '../shared/types/lyrics';
import type { MvMatchCandidate, MvResolvedStreams, MvSettings, MvTrackSnapshotSearchRequest, TrackVideo } from '../shared/types/mv';
import type {
  BaiduOAuthAuthorizeRequest,
  BaiduOAuthLoginRequest,
  BaiduOAuthTokenRequest,
  BaiduOAuthTokenResult,
  RemoteAlbumGroupingPreview,
  RemoteDirectoryItem,
  RemoteDirectoryPreviewItem,
  RemoteDirectoryPreviewOptions,
  RemoteIndexedFolderStats,
  RemoteIndexedTracksQuery,
  RemoteBackgroundGlobalStatus,
  RemoteBackgroundJobKind,
  RemoteBackgroundJobStatus,
  RemoteRuntimeLimits,
  RemoteSource,
  RemoteSourceIssueItem,
  RemoteSourceIssueKind,
  RemoteSourceInput,
  RemoteSourceOverview,
  RemoteTrackLookupItem,
  RemoteSourceUpdate,
  RemoteStreamUrlResult,
  RemoteSyncStatus,
  RemoteSyncOptions,
  RemoteVisibleHydrationOptions,
  TestRemoteSourceResult,
} from '../shared/types/remoteSources';
import type {
  StreamingLyricsResult,
  StreamingAlbumDetail,
  StreamingArtistDetail,
  StreamingFavoriteCollectionDeleteResult,
  StreamingFavoriteCollectionRenameResult,
  StreamingFavoritesImportResult,
  StreamingFavoriteSetResult,
  StreamingFavoritesSnapshot,
  StreamingLikedSongsSyncResult,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylistImportResult,
  StreamingProviderDescriptor,
  StreamingProviderName,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
  StreamingTrackLikedResult,
  StreamingTrackSourceInfo,
} from '../shared/types/streaming';
import type { SleepTimerStartRequest, SleepTimerStatus } from '../shared/types/sleepTimer';

export type FontFileAsset = {
  path: string;
  family: string;
  dataUrl: string;
};

export type DroppedFileImportResult = {
  importedCount: number;
  ignoredCount: number;
  failedCount: number;
  importedTrackIds: string[];
  outputDirectory: string;
};

export type EchoApi = {
  app: {
    getVersion: () => Promise<string>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (handler: (isMaximized: boolean) => void) => () => void;
    toggleFullscreen: () => Promise<void>;
    triggerFullscreenShortcut: () => Promise<void>;
    isFullscreen: () => Promise<boolean>;
    onFullscreenChange: (handler: (isFullscreen: boolean) => void) => () => void;
    close: () => Promise<void>;
    quit: () => Promise<void>;
    getSystemUserName: () => Promise<string | null>;
    getSettings: () => Promise<AppSettings>;
    setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    getTaskbarPlaybackStatus: () => Promise<TaskbarPlaybackStatus>;
    resetSettings: () => Promise<AppSettings>;
    exportSettings: () => Promise<string | null>;
    importSettings: () => Promise<SettingsImportResult | null>;
    exportDataPackage: () => Promise<DataPackageExportResult | null>;
    chooseDataBackupDirectory: () => Promise<string | null>;
    getDataBackupStatus: () => Promise<DataBackupStatus>;
    onDataBackupProgress: (handler: (progress: DataBackupProgress) => void) => () => void;
    runDataBackupNow: () => Promise<DataBackupExportResult>;
    importDataBackup: () => Promise<DataBackupImportResult | null>;
    openDataBackupDirectory: () => Promise<void>;
    chooseFontFile: () => Promise<FontFileAsset | null>;
    chooseLyricsWallpaper: () => Promise<string | null>;
    chooseAppWallpaper: () => Promise<string | null>;
    loadFontFile: (path: string) => Promise<FontFileAsset>;
    chooseCacheDirectory: () => Promise<string | null>;
    getDefaultCacheDirectory: () => Promise<string>;
    getCacheInventory: () => Promise<AppCacheInventory>;
    setCoverCacheDirectory: (request: SetCoverCacheDirectoryRequest) => Promise<CoverCacheMigrationResult | null>;
    getUpdateStatus: () => Promise<UpdateStatus>;
    checkForUpdates: () => Promise<UpdateStatus>;
    onUpdateStatus: (handler: (status: UpdateStatus) => void) => () => void;
    openRepository: () => Promise<void>;
    openExternalUrl: (url: string) => Promise<void>;
    showTouchKeyboard: () => Promise<boolean>;
    testNetworkProxy: (patch?: Partial<AppSettings>) => Promise<NetworkProxyTestResult>;
    validateGlobalShortcut: (accelerator: string) => Promise<GlobalShortcutValidationResult>;
    onGlobalShortcutCommand: (handler: (action: GlobalShortcutAction) => void) => () => void;
  };
  desktopLyrics: {
    show: () => Promise<DesktopLyricsState>;
    hide: () => Promise<DesktopLyricsState>;
    getState: () => Promise<DesktopLyricsState>;
    setLocked: (locked: boolean) => Promise<DesktopLyricsState>;
    setStyle: (patch: DesktopLyricsStylePatch) => Promise<DesktopLyricsState>;
    resetBounds: () => Promise<DesktopLyricsState>;
    setMousePassthrough: (passthrough: boolean) => void;
    publishAudioStatus: (status: AudioStatus) => void;
    publishPlaybackStatus: (status: PlaybackStatus) => void;
    getLastAudioStatus: () => Promise<AudioStatus | null>;
    getLastPlaybackStatus: () => Promise<PlaybackStatus | null>;
    onStateChanged: (handler: (state: DesktopLyricsState) => void) => () => void;
    onAudioStatus: (handler: (status: AudioStatus) => void) => () => void;
    onPlaybackStatus: (handler: (status: PlaybackStatus) => void) => () => void;
  };
  miniPlayer: {
    show: () => Promise<MiniPlayerState>;
    hide: (options?: MiniPlayerHideOptions) => Promise<MiniPlayerState>;
    getState: () => Promise<MiniPlayerState>;
    setLocked: (locked: boolean) => Promise<MiniPlayerState>;
    setQueueOpen: (open: boolean) => Promise<MiniPlayerState>;
    resetBounds: () => Promise<MiniPlayerState>;
    onStateChanged: (handler: (state: MiniPlayerState) => void) => () => void;
  };
  library: {
    chooseFolder: () => Promise<string | null>;
    chooseImportFiles: () => Promise<string[] | null>;
    addFolder: (path: string) => Promise<LibraryFolder>;
    classifyImportPaths: (paths: string[]) => Promise<ImportPathClassification>;
    importDroppedFiles: (files: File[]) => Promise<DroppedFileImportResult>;
    importAudioFiles: (paths: string[]) => Promise<ImportAudioFilesResult>;
    getFolders: () => Promise<LibraryFolder[]>;
    getFolderOverviews: () => Promise<LibraryFolderOverview[]>;
    getFolderChildren: (query: LibraryFolderChildrenQuery) => Promise<LibraryFolderNode[]>;
    getFolderTracks: (query: LibraryFolderTracksQuery) => Promise<LibraryPage<LibraryTrack>>;
    openLibraryFolderPath: (request: LibraryFolderPathRequest) => Promise<void>;
    removeFolder: (folderId: string) => Promise<void>;
    scanFolder: (folderId: string, options?: Pick<LibraryScanOptions, 'reduceScanPressure'>) => Promise<LibraryScanStatus>;
    scanFolderChanges: (folderId: string) => Promise<LibraryScanStatus>;
    rescanEmbeddedTags: (mode: Exclude<LibraryScanMode, 'normal'>, options?: LibraryEmbeddedTagRescanOptions) => Promise<LibraryScanStatus[]>;
    getScanStatus: (jobId: string) => Promise<LibraryScanStatus>;
    cancelScan: (jobId: string) => Promise<LibraryScanStatus>;
    getTrack: (trackId: string) => Promise<LibraryTrack | null>;
    getTracks: (query?: LibraryPageQuery) => Promise<LibraryPage<LibraryTrack>>;
    getLibraryQualityOverview: () => Promise<LibraryQualityOverviewItem[]>;
    getLibraryQualityIssues: (query: LibraryQualityIssueQuery) => Promise<LibraryQualityIssuePage>;
    getLibraryInboxBatches: () => Promise<LibraryInboxBatch[]>;
    getLibraryInboxTracks: (query?: LibraryInboxTrackQuery) => Promise<LibraryInboxTrackPage>;
    createPlaylistFromLibraryInbox: (request: LibraryInboxCreatePlaylistRequest) => Promise<LibraryInboxPlaylistResult>;
    addLibraryInboxToQueue: (query?: LibraryInboxTrackQuery) => Promise<LibraryInboxQueueResult>;
    updateLibraryInboxItemState: (request: LibraryInboxUpdateStateRequest) => Promise<LibraryInboxUpdateStateResult>;
    getHealthReport: () => Promise<LibraryHealthReport>;
    exportHealthReport: () => Promise<string | null>;
    refreshDuplicateTracks: (mode?: DuplicateTrackMode) => Promise<DuplicateTrackIndexSummary>;
    getDuplicateTrackVersions: (trackId: string) => Promise<DuplicateTrackMember[]>;
    getDuplicateHiddenCounts: (trackIds: string[], mode?: DuplicateTrackMode) => Promise<Record<string, number>>;
    getDuplicateIndexSummary: (mode?: DuplicateTrackMode) => Promise<DuplicateTrackIndexSummary>;
    previewDuplicateTrackCleanup: (mode?: DuplicateTrackMode) => Promise<DuplicateTrackCleanupPreview>;
    applyDuplicateTrackCleanup: (request: DuplicateTrackCleanupApplyRequest) => Promise<DuplicateTrackCleanupResult>;
    getPlaylists: () => Promise<LibraryPlaylist[]>;
    createPlaylist: (request: CreatePlaylistRequest) => Promise<LibraryPlaylist>;
    updatePlaylist: (request: UpdatePlaylistRequest) => Promise<LibraryPlaylist>;
    deletePlaylist: (playlistId: string) => Promise<void>;
    getPlaylist: (playlistId: string) => Promise<LibraryPlaylist | null>;
    getPlaylistItems: (playlistId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search'>) => Promise<LibraryPage<LibraryPlaylistItem>>;
    importPlaylistFile: () => Promise<ImportPlaylistFileResult | null>;
    exportPlaylist: (request: ExportPlaylistRequest) => Promise<string | null>;
    addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<LibraryPlaylistItem>;
    addStreamingTrackToPlaylist: (playlistId: string, track: LibraryTrack) => Promise<LibraryPlaylistItem>;
    addTracksToPlaylist: (playlistId: string, trackIds: string[]) => Promise<LibraryPlaylistItem[]>;
    addLocalAudioFilesToPlaylist: (playlistId: string, paths: string[]) => Promise<AddLocalAudioFilesToPlaylistResult>;
    removePlaylistItem: (itemId: string) => Promise<void>;
    movePlaylistItem: (playlistId: string, itemId: string, targetPosition: number) => Promise<void>;
    clearPlaylist: (playlistId: string) => Promise<void>;
    getLikedSongsPlaylist: () => Promise<LibraryPlaylist>;
    getLikedAlbumsPlaylist: () => Promise<LibraryPlaylist>;
    getLikedTracks: (query?: LibraryPageQuery) => Promise<LibraryPage<LibraryPlaylistItem>>;
    getLikedAlbums: (query?: LibraryPageQuery) => Promise<LibraryPage<LibraryPlaylistItem>>;
    isTrackLiked: (trackId: string) => Promise<boolean>;
    isAlbumLiked: (albumId: string) => Promise<boolean>;
    getLikedTrackIds: (trackIds: string[]) => Promise<Record<string, boolean>>;
    getLikedAlbumIds: (albumIds: string[]) => Promise<Record<string, boolean>>;
    likeTrack: (trackId: string) => Promise<LibraryPlaylistItem>;
    unlikeTrack: (trackId: string) => Promise<void>;
    toggleTrackLiked: (trackId: string) => Promise<{ liked: boolean; item?: LibraryPlaylistItem }>;
    likeAlbum: (albumId: string) => Promise<LibraryPlaylistItem>;
    unlikeAlbum: (albumId: string) => Promise<void>;
    toggleAlbumLiked: (albumId: string) => Promise<{ liked: boolean; item?: LibraryPlaylistItem }>;
    clearLikedTracks: (query?: Pick<LibraryPageQuery, 'sourceProvider'>) => Promise<void>;
    clearLikedAlbums: (query?: Pick<LibraryPageQuery, 'sourceProvider'>) => Promise<void>;
    getAlbums: (query?: LibraryPageQuery) => Promise<LibraryPage<LibraryAlbum>>;
    getAlbum: (albumId: string) => Promise<LibraryAlbumDetail | null>;
    getAlbumOnlineInfo: (albumId: string, options?: AlbumOnlineInfoRequestOptions) => Promise<AlbumOnlineInfo>;
    getAlbumForTrack: (trackId: string) => Promise<LibraryAlbum | null>;
    getArtists: (query?: LibraryPageQuery) => Promise<LibraryPage<LibraryArtist>>;
    getArtist: (artistId: string) => Promise<LibraryArtist | null>;
    getArtistInsights: (artistId: string, options?: ArtistInsightsOptions) => Promise<ArtistInsights>;
    getArtistTracks: (artistId: string, query?: LibraryPageQuery) => Promise<LibraryPage<LibraryTrack>>;
    getArtistAlbums: (artistId: string, query?: LibraryPageQuery) => Promise<LibraryPage<LibraryAlbum>>;
    clearArtistOnlineInfoCache: () => Promise<ArtistOnlineInfoCacheClearResult>;
    enqueueMissingArtistImages: (
      request?: { artists?: Array<Pick<LibraryArtist, 'id' | 'name'>>; force?: boolean; limit?: number } | Array<Pick<LibraryArtist, 'id' | 'name'>>,
    ) => Promise<ArtistImageQueueResult>;
    refreshArtistImage: (artistId: string, force?: boolean) => Promise<ArtistImageRefreshResult>;
    refreshVisibleArtistImages: (artists: Array<Pick<LibraryArtist, 'id' | 'name'>>) => Promise<ArtistImageQueueResult>;
    getArtistImageStatus: (artistId: string) => Promise<ArtistImageCacheEntry | null>;
    getArtistImageCacheSummary: () => Promise<ArtistImageCacheSummary>;
    getArtistImageJobStatus: () => Promise<ArtistImageJobStatus>;
    setArtistImageJobsPaused: (paused: boolean) => Promise<ArtistImageJobStatus>;
    kickoffArtistImageBackfill: (options?: { force?: boolean; limit?: number }) => Promise<ArtistImageJobStatus>;
    clearArtistImageCache: () => Promise<ArtistImageCacheClearResult>;
    chooseArtistAvatar: (artistId: string) => Promise<ArtistImageCacheEntry | null>;
    setArtistAvatarFromUrl: (artistId: string, url: string) => Promise<ArtistImageCacheEntry | null>;
    clearCustomArtistAvatar: (artistId: string) => Promise<ArtistImageCacheEntry | null>;
    onArtistImagesUpdated: (handler: (payload: { artistId: string | null; artistKey: string; status: string }) => void) => () => void;
    onLibraryChanged?: (handler: () => void) => () => void;
    onLikedTracksChanged?: (handler: () => void) => () => void;
    getAlbumTracks: (
      albumId: string,
      query?: Pick<LibraryPageQuery, 'page' | 'pageSize'>,
    ) => Promise<LibraryPage<LibraryTrack>>;
    getSummary: () => Promise<LibrarySummary>;
    refreshAlbumGrouping: () => Promise<LibrarySummary>;
    getDiagnostics: () => Promise<LibraryDiagnostics>;
    getMoveCandidates: (options?: LibraryMoveCandidateOptions) => Promise<LibraryMoveCandidate[]>;
    chooseTrackCover: () => Promise<TrackCoverSelection | null>;
    loadEmbeddedTrackTags: (trackId: string) => Promise<EmbeddedTrackTagsLoadResult>;
    updateTrackTags: (request: LibraryTrackTagUpdateRequest) => Promise<LibraryTrack>;
    updateAlbumTags: (request: LibraryAlbumTagUpdateRequest) => Promise<LibraryAlbum>;
    recordTrackPlayback: (trackId: string) => Promise<void>;
    getPlaybackHistory: (query?: PlaybackHistoryQuery) => Promise<LibraryPage<PlaybackHistoryEntry>>;
    getPlaybackHistorySummary: (query?: PlaybackHistoryQuery) => Promise<PlaybackHistorySummary>;
    getPlaybackStatsDashboard: (query?: PlaybackHistoryQuery) => Promise<PlaybackStatsDashboard>;
    refreshInvalidPlaybackHistory: () => Promise<PlaybackHistoryRefreshResult>;
    deletePlaybackHistoryEntry: (id: string) => Promise<void>;
    clearPlaybackHistory: () => Promise<void>;
    startPlaybackHistory: (request: StartPlaybackHistoryRequest) => Promise<StartPlaybackHistoryResult>;
    finishPlaybackHistory: (request: FinishPlaybackHistoryRequest) => Promise<PlaybackHistoryEntry | null>;
    openTrackInFolder: (trackId: string) => Promise<void>;
    openPathInFolder: (path: string) => Promise<void>;
    openTrackWithSystem: (trackId: string) => Promise<void>;
    copyTrackPath: (trackId: string) => Promise<void>;
    copyTrackNameArtist: (trackId: string) => Promise<void>;
    copyTrackCover: (trackId: string) => Promise<boolean>;
    copyTrackOriginalCover: (trackId: string) => Promise<boolean>;
    saveTrackCover: (trackId: string) => Promise<string | null>;
    deleteTrackFile: (trackId: string) => Promise<void>;
    copyAlbumInfo: (albumId: string) => Promise<void>;
    copyAlbumCover: (albumId: string) => Promise<boolean>;
    saveAlbumCover: (albumId: string) => Promise<string | null>;
    deleteAlbumFiles: (albumId: string) => Promise<void>;
    pruneMissingTracks: () => Promise<LibraryCleanupResult>;
    pruneInvalidTracks: () => Promise<LibraryMaintenanceCleanupResult>;
    clearTracks: () => Promise<LibraryCleanupResult>;
    clearCache: () => Promise<LibraryCacheClearResult>;
    repairDatabase: () => Promise<LibraryDatabaseRepairResult>;
    deleteDatabase: () => Promise<LibraryDatabaseDeleteResult>;
    deleteAllUserData: () => Promise<LibraryAllUserDataDeleteResult>;
    getDatabaseProtectionStatus: (options?: LibraryDatabaseProtectionStatusOptions) => Promise<LibraryDatabaseProtectionStatus>;
    createDatabaseSnapshot: () => Promise<LibraryDatabaseProtectionStatus>;
    restoreDatabaseSnapshot: (snapshotId: string) => Promise<LibraryDatabaseRestoreResult>;
    scrubQuarantinedDatabase: () => Promise<LibraryDatabaseScrubResult>;
    discardQuarantinedProblemTracks: () => Promise<LibraryDatabaseDiscardProblemTracksResult>;
    relaunchRecoveryMode: () => Promise<LibraryDatabaseRecoveryRelaunchResult>;
    openDataProtectionFolder: () => Promise<void>;
    repairMissingMetadata: (trackId: string) => Promise<NetworkRepairResult>;
    scanMissingMetadata: (options?: number | MissingMetadataScanOptions) => Promise<MissingMetadataScanResult>;
    startMissingMetadataScan: (options?: number | MissingMetadataScanOptions) => Promise<NetworkMetadataScanJobStatus>;
    getMissingMetadataScanStatus: (jobId: string) => Promise<NetworkMetadataScanJobStatus>;
    startMissingCoverBackfill: (options?: number | MissingMetadataScanOptions) => Promise<NetworkMetadataScanJobStatus>;
    getMissingCoverBackfillStatus: (jobId: string) => Promise<NetworkMetadataScanJobStatus>;
    getActiveMissingCoverBackfillStatus?: () => Promise<NetworkMetadataScanJobStatus | null>;
    showNetworkCandidates: (trackId: string) => Promise<NetworkCandidateList>;
    searchNetworkTagCandidates: (
      trackId: string,
      options?: Omit<NetworkTagCandidateSearchRequest, 'trackId'>,
    ) => Promise<NetworkTagCandidate[]>;
    resolveLyricsBackgroundCover: (trackId: string) => Promise<LyricsBackgroundCoverResult | null>;
    applyNetworkMissingOnly: (candidateId: string, options?: NetworkApplyOptions) => Promise<NetworkApplyResult>;
    applyNetworkSelected: (candidateId: string, options?: NetworkApplyOptions) => Promise<NetworkApplyResult>;
    rejectNetworkCandidate: (candidateId: string) => Promise<NetworkApplyResult>;
    startBpmAnalysis: (options?: BpmAnalysisStartOptions) => Promise<BpmAnalysisJobStatus>;
    getBpmAnalysisStatus: (jobId: string) => Promise<BpmAnalysisJobStatus>;
    startReplayGainAnalysis: (options?: ReplayGainAnalysisStartOptions) => Promise<ReplayGainAnalysisJobStatus>;
    getReplayGainAnalysisStatus: (jobId: string) => Promise<ReplayGainAnalysisJobStatus>;
    startLyricsBackfill: (options?: LyricsBackfillStartOptions) => Promise<LyricsBackfillJobStatus>;
    getLyricsBackfillStatus: (jobId: string) => Promise<LyricsBackfillJobStatus>;
    getCurrentLyricsBackfillStatus: () => Promise<LyricsBackfillJobStatus | null>;
    cancelLyricsBackfill: (jobId: string) => Promise<LyricsBackfillJobStatus>;
  };
  libraryLab: {
    setWatcherEnabled: (enabled: boolean) => Promise<LibraryLabState>;
    setAutoRescanEnabled: (enabled: boolean) => Promise<LibraryLabState>;
    setMoveCandidateEnabled: (enabled: boolean) => Promise<LibraryLabState>;
    setMoveRepairLabEnabled: (enabled: boolean) => Promise<LibraryLabState>;
    getState: () => Promise<LibraryLabState>;
    startWatcher: () => Promise<LibraryLabState>;
    stopWatcher: () => Promise<LibraryLabState>;
    refreshDiagnostics: () => Promise<LibraryLabState>;
    backfillPlaceholderMetadata: () => Promise<LibraryLabState>;
    getMoveCandidates: (options?: LibraryMoveCandidateOptions) => Promise<LibraryMoveCandidate[]>;
    dryRunMoveRepair: (candidateId: string) => Promise<LibraryMoveRepairResult>;
    applyMoveRepair: (candidateId: string) => Promise<LibraryMoveRepairResult>;
  };
  playback: {
    getStatus: () => Promise<PlaybackStatus>;
    playLocalFile: (request: PlaybackStartRequest) => Promise<PlaybackStatus>;
    prepareLocalFile: (request: PlaybackPrepareLocalFileRequest) => Promise<void>;
    playMediaItem: (request: PlaybackMediaStartRequest) => Promise<PlaybackStatus>;
    prepareMediaItem: (request: PlaybackMediaStartRequest) => Promise<void>;
    play: () => Promise<PlaybackStatus>;
    pause: () => Promise<PlaybackStatus>;
    stop: () => Promise<PlaybackStatus>;
    seek: (positionSeconds: number) => Promise<PlaybackStatus>;
    openLocalAudioFile: () => Promise<string | null>;
    openLocalAudioFiles: () => Promise<string[] | null>;
    resolveLocalAudioFiles: (paths: string[]) => Promise<LocalFileResolveResult>;
    getQueueSession: () => Promise<PersistedPlaybackSessionV1 | null>;
    saveQueueSession: (snapshot: PersistedPlaybackSessionV1, options?: PlaybackQueueSessionSaveOptions) => Promise<PersistedPlaybackSessionV1>;
    clearQueueSession: () => Promise<void>;
    onQueueSessionChanged?: (handler: (snapshot: PersistedPlaybackSessionV1 | null) => void) => () => void;
    onLocalAudioFilesOpened: (handler: (paths: string[]) => void) => () => void;
    onAutomixAdvance?: (handler: (event: {
      fromTrackId: string | null;
      toTrackId: string;
      transitionSeconds: number;
      mode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
      fallbackReason?: string | null;
      beatAligned?: boolean;
      skipIntroSilence?: boolean;
      nextStartSeconds?: number;
    }) => void) => () => void;
  };
  remoteSources: {
    list: () => Promise<RemoteSource[]>;
    getOverview: (sourceId?: string | null) => Promise<RemoteSourceOverview>;
    previewAlbumGrouping: (strategy?: AppSettings['remoteAlbumMergeStrategy'], sourceId?: string | null) => Promise<RemoteAlbumGroupingPreview>;
    listIssues: (sourceId: string, kind: RemoteSourceIssueKind, limit?: number) => Promise<RemoteSourceIssueItem[]>;
    create: (input: RemoteSourceInput) => Promise<RemoteSource>;
    update: (input: RemoteSourceUpdate) => Promise<RemoteSource>;
    disconnect: (sourceId: string) => Promise<void>;
    delete: (sourceId: string) => Promise<void>;
    test: (sourceIdOrInput: string | RemoteSourceInput) => Promise<TestRemoteSourceResult>;
    browse: (sourceId: string, path?: string | null) => Promise<RemoteDirectoryItem[]>;
    sync: (sourceId: string, options?: RemoteSyncOptions) => Promise<RemoteSyncStatus>;
    cancelSync: (sourceId: string) => Promise<RemoteSyncStatus>;
    getSyncStatus: (sourceId: string) => Promise<RemoteSyncStatus>;
    createStreamUrl: (input: { trackId?: string; sourceId?: string; remotePath?: string; stableKey?: string }) => Promise<RemoteStreamUrlResult>;
    hydrateVisibleTracks: (trackIds: string[], options?: RemoteVisibleHydrationOptions) => Promise<LibraryTrack[]>;
    lookupTracks: (sourceId: string, remotePaths: string[]) => Promise<RemoteTrackLookupItem[]>;
    listIndexedTracks: (sourceId: string, rootPath?: string | null) => Promise<LibraryTrack[]>;
    listIndexedTracksPage: (sourceId: string, query?: RemoteIndexedTracksQuery) => Promise<LibraryPage<LibraryTrack>>;
    getIndexedFolderStats: (sourceId: string, rootPath?: string | null) => Promise<RemoteIndexedFolderStats>;
    previewDirectoryItems?: (sourceId: string, items: RemoteDirectoryItem[], options?: RemoteDirectoryPreviewOptions) => Promise<RemoteDirectoryPreviewItem[]>;
    startBackgroundJobs: (sourceId: string, kinds?: RemoteBackgroundJobKind[]) => Promise<RemoteBackgroundJobStatus>;
    pauseBackgroundJobs: (sourceId: string) => Promise<RemoteBackgroundJobStatus>;
    resumeBackgroundJobs: (sourceId: string) => Promise<RemoteBackgroundJobStatus>;
    getJobStatus: (sourceId: string) => Promise<RemoteBackgroundJobStatus>;
    retryFailedJobs: (sourceId: string, kinds?: RemoteBackgroundJobKind[]) => Promise<RemoteBackgroundJobStatus>;
    setBackgroundPaused: (paused: boolean) => Promise<RemoteBackgroundGlobalStatus>;
    getBackgroundGlobalStatus: () => Promise<RemoteBackgroundGlobalStatus>;
    updateRuntimeLimits: (sourceId: string, limits: RemoteRuntimeLimits) => Promise<RemoteBackgroundJobStatus>;
    createBaiduAuthUrl: (input: BaiduOAuthAuthorizeRequest) => Promise<string>;
    exchangeBaiduAuthCode: (input: BaiduOAuthTokenRequest) => Promise<BaiduOAuthTokenResult>;
    startBaiduOAuthLogin: (input: BaiduOAuthLoginRequest) => Promise<BaiduOAuthTokenResult>;
  };
  connect: {
    listDevices: () => Promise<ConnectDevice[]>;
    refresh: () => Promise<ConnectDevice[]>;
    getStatus: () => Promise<ConnectSessionStatus>;
    connect: (request: ConnectStartRequest) => Promise<ConnectSessionStatus>;
    disconnect: () => Promise<ConnectSessionStatus>;
    play: () => Promise<ConnectSessionStatus>;
    pause: () => Promise<ConnectSessionStatus>;
    stop: () => Promise<ConnectSessionStatus>;
    seek: (positionSeconds: number) => Promise<ConnectSessionStatus>;
    setVolume: (volumePercent: number) => Promise<ConnectSessionStatus>;
    onStatus: (handler: (status: ConnectSessionStatus) => void) => () => void;
    getReceiverStatus: () => Promise<ConnectReceiverStatus>;
    setReceiverEnabled: (enabled: boolean) => Promise<ConnectReceiverStatus>;
    stopReceiverPlayback: () => Promise<ConnectReceiverStatus>;
    onReceiverStatus: (handler: (status: ConnectReceiverStatus) => void) => () => void;
    getAirPlayReceiverStatus: () => Promise<AirPlayReceiverStatus>;
    setAirPlayReceiverEnabled: (enabled: boolean) => Promise<AirPlayReceiverStatus>;
    stopAirPlayReceiverPlayback: () => Promise<AirPlayReceiverStatus>;
    onAirPlayReceiverStatus: (handler: (status: AirPlayReceiverStatus) => void) => () => void;
  };
  streaming: {
    search: (request: StreamingSearchRequest) => Promise<StreamingSearchResult>;
    getTrack: (request: { provider: StreamingProviderName; providerTrackId: string }) => Promise<StreamingTrack>;
    getTrackSourceInfo?: (request: { provider: StreamingProviderName; providerTrackId: string }) => Promise<StreamingTrackSourceInfo>;
    getAlbum: (request: { provider: StreamingProviderName; providerAlbumId: string }) => Promise<StreamingAlbumDetail>;
    getArtist: (request: { provider: StreamingProviderName; providerArtistId: string }) => Promise<StreamingArtistDetail>;
    resolvePlayback: (request: StreamingPlaybackRequest) => Promise<StreamingPlaybackSource>;
    analyzeBpm: (request: StreamingPlaybackRequest) => Promise<BpmAnalysisResult>;
    getLyrics: (request: { provider: StreamingProviderName; providerTrackId: string }) => Promise<StreamingLyricsResult>;
    getMv: (request: { provider: StreamingProviderName; providerTrackId: string }) => Promise<StreamingMvResult>;
    getProviders: () => Promise<StreamingProviderDescriptor[]>;
    importPlaylistFromUrl: (url: string) => Promise<StreamingPlaylistImportResult>;
    importFavoritesFromUrl: (url: string) => Promise<StreamingFavoritesImportResult>;
    exportFavorites: () => Promise<string | null>;
    syncLikedSongs: (provider?: Extract<StreamingProviderName, 'netease' | 'qqmusic'>) => Promise<StreamingLikedSongsSyncResult>;
    setTrackLiked: (request: { provider: Extract<StreamingProviderName, 'netease' | 'qqmusic'>; providerTrackId: string; liked: boolean }) => Promise<StreamingTrackLikedResult>;
    getFavorites: () => Promise<StreamingFavoritesSnapshot>;
    setFavorite: (request: { track: StreamingTrack; favorite: boolean }) => Promise<StreamingFavoriteSetResult>;
    renameFavoriteCollection: (request: { collectionId: string; name: string }) => Promise<StreamingFavoriteCollectionRenameResult>;
    syncFavoriteCollection: (request: { collectionId: string }) => Promise<StreamingFavoritesImportResult>;
    deleteFavoriteCollection: (request: { collectionId: string }) => Promise<StreamingFavoriteCollectionDeleteResult>;
    refreshNeteaseDailyRecommend: () => Promise<StreamingPlaylistImportResult>;
  };
  lyrics: {
    getForTrack: (trackId: string) => Promise<TrackLyrics | null>;
    getForSnapshot?: (request: LyricsTrackSnapshotRequest) => Promise<TrackLyrics | null>;
    searchCandidates: (trackId: string, searchText?: string, providerId?: LyricsProviderId) => Promise<LyricsSearchCandidate[]>;
    searchCandidatesForSnapshot?: (
      request: LyricsTrackSnapshotRequest,
      searchText?: string,
      providerId?: LyricsProviderId,
    ) => Promise<LyricsSearchCandidate[]>;
    previewCandidate?: (trackId: string, candidateId: string) => Promise<TrackLyrics>;
    applyCandidate: (trackId: string, candidateId: string) => Promise<TrackLyrics>;
    applyCandidateForSnapshot?: (request: LyricsTrackSnapshotRequest, candidateId: string) => Promise<TrackLyrics>;
    embedToTrack?: (trackId: string, request?: LyricsEmbedToTrackRequest) => Promise<LyricsEmbedToTrackResult>;
    applyCustomLrc?: (trackId: string, lrcText: string, fileName?: string) => Promise<TrackLyrics>;
    markInstrumental: (trackId: string) => Promise<TrackLyrics>;
    rejectCandidate: (candidateId: string) => Promise<void>;
    setOffset: (trackId: string, offsetMs: number) => Promise<TrackLyrics | null>;
    clearCache: (trackId: string) => Promise<void>;
    onChanged?: (handler: (trackId: string) => void) => () => void;
  };
  mv: {
    getSelected: (trackId: string) => Promise<TrackVideo | null>;
    getSettings: () => Promise<MvSettings>;
    setSettings: (patch: Partial<MvSettings>) => Promise<MvSettings>;
    findLocalCandidates: (trackId: string) => Promise<MvMatchCandidate[]>;
    searchNetworkCandidates: (trackId: string, query?: string) => Promise<MvMatchCandidate[]>;
    searchNetworkCandidatesForSnapshot: (request: MvTrackSnapshotSearchRequest) => Promise<MvMatchCandidate[]>;
    getTemporaryPlayableForSnapshot: (request: MvTrackSnapshotSearchRequest) => Promise<TrackVideo | null>;
    getCandidates: (trackId: string) => Promise<TrackVideo[]>;
    resolveStreams: (videoId: string) => Promise<MvResolvedStreams>;
    setQuality: (videoId: string, qualityId: string) => Promise<TrackVideo>;
    setOffset: (trackId: string, offsetMs: number) => Promise<TrackVideo | null>;
    chooseLocalVideo: (trackId: string) => Promise<TrackVideo | null>;
    bindLocalVideo: (trackId: string, filePath: string) => Promise<TrackVideo>;
    bindUrl: (trackId: string, url: string) => Promise<TrackVideo>;
    selectVideo: (trackId: string, videoId: string) => Promise<TrackVideo>;
    clearSelected: (trackId: string) => Promise<void>;
    openExternal: (videoId: string) => Promise<void>;
  };
  smtc: {
    getDiagnostics: () => Promise<SmtcDiagnostics>;
    restart: () => Promise<SmtcDiagnostics>;
    setLyricsProgress: (progress: SmtcLyricsProgress | null) => Promise<void>;
    onCommand: (handler: (command: SmtcCommand) => void) => () => void;
  };
  discordPresence: {
    getStatus: () => Promise<DiscordPresenceStatus>;
    setEnabled: (enabled: boolean) => Promise<DiscordPresenceStatus>;
  };
  lastfm: {
    getStatus: () => Promise<LastFmStatus>;
    setEnabled: (enabled: boolean) => Promise<LastFmStatus>;
    setNowPlayingEnabled: (enabled: boolean) => Promise<LastFmStatus>;
    setScrobbleEnabled: (enabled: boolean) => Promise<LastFmStatus>;
    createAuthToken: () => Promise<LastFmAuthStartResult>;
    openAuthUrl: (token: string) => Promise<void>;
    completeAuth: (token: string) => Promise<LastFmStatus>;
    authenticatePassword: (username: string, password: string) => Promise<LastFmStatus>;
    disconnect: () => Promise<LastFmStatus>;
  };
  hqPlayer: {
    getSettings: () => Promise<HqPlayerSettings>;
    setSettings: (patch: Partial<HqPlayerSettings>) => Promise<HqPlayerSettings>;
    getStatus: () => Promise<HqPlayerStatus>;
    testConnection: (patch?: Partial<HqPlayerSettings>) => Promise<HqPlayerConnectionTestResult>;
    createPlaybackHandoff: (request: HqPlayerPlaybackHandoffRequest) => Promise<HqPlayerPlaybackHandoffPlan>;
    sendLastPlaybackControl: () => Promise<HqPlayerPlaybackControlSendResult>;
    getLastPlaybackHandoff: () => Promise<HqPlayerPlaybackHandoffPlan | null>;
    getLastPlaybackControl: () => Promise<HqPlayerPlaybackControlPlan | null>;
  };
  audio: {
    getStatus: () => Promise<AudioStatus>;
    getDiagnostics: () => Promise<AudioDiagnostics>;
    onStatus: (handler: (status: AudioStatus) => void) => () => void;
    onSessionReset: (handler: (event: AudioSessionResetEvent) => void) => () => void;
    listDevices: () => Promise<AudioDeviceInfo[]>;
    setOutput: (settings: AudioOutputSettings) => Promise<AudioStatus>;
    exportFile: (request: AudioExportRequest) => Promise<AudioExportResult | null>;
    openAsioControlPanel?: (settings: Pick<AudioOutputSettings, 'deviceIndex' | 'deviceName'>) => Promise<void>;
    resetEngine: () => Promise<AudioStatus>;
    forceRestart: (reason?: string) => Promise<AudioStatus>;
    restartWindowsAudioService: () => Promise<AudioStatus>;
  };
  diagnostics: {
    getLastCrashSummary: () => Promise<LastCrashSummary | null>;
    clearLastCrashSummary: () => Promise<void>;
    exportDiagnostics: () => Promise<string>;
    exportDiagnosticsZip: () => Promise<string>;
    openDiagnosticsFolder: () => Promise<string>;
    openCrashReport: () => Promise<string>;
    openAudioCrashReport: () => Promise<string>;
    relaunchApp: () => Promise<void>;
    openDevConsole: () => Promise<void>;
    getDevConsoleSnapshot?: () => Promise<DiagnosticConsoleSnapshot>;
    onDevConsoleEntry?: (handler: (entry: DiagnosticConsoleEntry) => void) => () => void;
    reportRendererError: (payload: RendererErrorPayload) => Promise<void>;
    reportPerformanceStall: (payload: DiagnosticPerformanceStallPayload) => Promise<void>;
  };
  downloads: {
    getJobs: () => Promise<DownloadJob[]>;
    createUrlJob: (url: string, options?: CreateDownloadUrlJobOptions) => Promise<DownloadJob>;
    cancelJob: (jobId: string) => Promise<DownloadJob | null>;
    clearCompleted: () => Promise<DownloadJob[]>;
    getSettings: () => Promise<DownloadSettings>;
    setSettings: (patch: Partial<DownloadSettings>) => Promise<DownloadSettings>;
    chooseOutputDirectory: () => Promise<DownloadSettings | null>;
    search: (request: string | DownloadSearchRequest) => Promise<DownloadSearchResponse>;
    checkTools: () => Promise<DownloadToolsStatus>;
    onJobsUpdated: (handler: (jobs: DownloadJob[]) => void) => () => void;
  };
  plugins: {
    list: () => Promise<PluginListResult>;
    createExample: (kind: PluginCreateExampleKind) => Promise<PluginCreateExampleResult>;
    enable: (request: PluginEnableRequest) => Promise<PluginSummary>;
    disable: (pluginId: string) => Promise<PluginSummary>;
    reload: (pluginId: string) => Promise<PluginSummary>;
    openDirectory: (pluginId?: string) => Promise<void>;
    exportPackage: (pluginId: string) => Promise<string | null>;
    importPackage: (source?: string | File) => Promise<PluginImportPackageResult | null>;
    runCommand: (request: PluginRunCommandRequest) => Promise<unknown>;
    queryMetadata: (request: PluginMetadataLookupRequest) => Promise<PluginMetadataLookupResult>;
    querySources: (request: PluginSourceSearchRequest) => Promise<PluginSourceSearchResult>;
    resolveSourcePlayback: (request: PluginSourcePlaybackRequest) => Promise<PluginSourcePlaybackResult>;
    queryLyrics: (request: PluginLyricsLookupRequest) => Promise<PluginLyricsLookupResult>;
    queryCovers: (request: PluginCoverLookupRequest) => Promise<PluginCoverLookupResult>;
    getSettings: (pluginId: string) => Promise<PluginSettingsResult>;
    setSettings: (pluginId: string, patch: PluginSettingsPatch) => Promise<PluginSettingsResult>;
    getLogs: (pluginId?: string) => Promise<PluginLogEntry[]>;
  };
  accounts: {
    getStatuses: () => Promise<AccountStatus[]>;
    getStatus: (provider: AccountProvider) => Promise<AccountStatus>;
    saveCookie: (provider: AccountProvider, cookie: string) => Promise<AccountStatus>;
    startLogin?: (provider: AccountProvider) => Promise<AccountLoginStartResult>;
    clear: (provider: AccountProvider) => Promise<AccountStatus>;
    check: (provider: AccountProvider) => Promise<AccountStatus>;
    checkAll: () => Promise<AccountStatus[]>;
    setBrowser: (provider: AccountProvider, browser: AccountBrowser) => Promise<AccountStatus>;
    setYouTubeBrowser: (browser: YouTubeBrowser) => Promise<AccountStatus>;
    onStatusesChanged: (handler: (statuses: AccountStatus[]) => void) => () => void;
  };
  spotify: {
    getAccessToken: () => Promise<string>;
    getDevices: () => Promise<Array<{ id: string; name: string; type: string; isActive: boolean; isRestricted: boolean; volumePercent: number | null }>>;
    getPlaybackState: () => Promise<{ isPlaying: boolean; progressMs: number | null; itemUri: string | null; deviceId: string | null; deviceName: string | null }>;
    ensureConnectDevice: (request: { uri: string; webUrl: string; preferredDeviceId?: string | null }) => Promise<{ deviceId: string; deviceName: string; launched: 'none' | 'desktop' | 'web'; waitedMs: number }>;
    startPlayback: (request: { deviceId: string; uri: string; positionMs?: number }) => Promise<void>;
    transferPlayback: (request: { deviceId: string; play?: boolean }) => Promise<void>;
    pause: (deviceId?: string | null) => Promise<void>;
    resume: (deviceId?: string | null) => Promise<void>;
    seek: (positionMs: number, deviceId?: string | null) => Promise<void>;
    setVolume: (volume: number, deviceId?: string | null) => Promise<void>;
  };
  eq: {
    getState: () => Promise<EqState>;
    setEnabled: (enabled: boolean) => Promise<EqState>;
    setBandGain: (request: EqSetBandGainRequest) => Promise<EqState>;
    setBandFrequency: (request: EqSetBandFrequencyRequest) => Promise<EqState>;
    setBandQ: (request: EqSetBandQRequest) => Promise<EqState>;
    setBandFilterType: (request: EqSetBandFilterTypeRequest) => Promise<EqState>;
    setBandEnabled: (request: EqSetBandEnabledRequest) => Promise<EqState>;
    setPreamp: (preampDb: number) => Promise<EqState>;
    setDspHeadroom: (headroomDb: number) => Promise<EqState>;
    setDspSafetyLimiterEnabled: (enabled: boolean) => Promise<EqState>;
    setPreset: (presetId: string) => Promise<EqState>;
    reset: () => Promise<EqState>;
    listPresets: () => Promise<EqPreset[]>;
    savePreset: (request: EqSavePresetRequest) => Promise<EqPreset>;
    exportPreset: (request: EqSavePresetRequest) => Promise<string | null>;
    exportApoPreset: (request: EqSavePresetRequest) => Promise<string | null>;
    exportApoGraphicEqPreset: (request: EqSavePresetRequest) => Promise<string | null>;
    previewImportPreset: () => Promise<EqPresetImportPreviewResult | null>;
    importPreset: () => Promise<EqPresetImportResult | null>;
    deletePreset: (presetId: string) => Promise<EqPreset[]>;
    browseHeadphoneCorrections: (request: OpraHeadphoneCorrectionBrowseRequest) => Promise<OpraHeadphoneCorrectionBrowseResult>;
    searchHeadphoneCorrections: (request: OpraHeadphoneCorrectionSearchRequest) => Promise<OpraHeadphoneCorrectionSearchResult>;
    applyHeadphoneCorrection: (request: OpraHeadphoneCorrectionApplyRequest) => Promise<OpraHeadphoneCorrectionApplyResult>;
    listProfiles: () => Promise<EqProfile[]>;
    saveProfile: (request: EqSaveProfileRequest) => Promise<EqProfile>;
    applyProfile: (profileId: string) => Promise<EqState>;
    deleteProfile: (profileId: string) => Promise<EqProfile[]>;
    bindProfileToOutput: (request: EqBindProfileRequest) => Promise<EqProfileBindingInfo>;
    getProfileBinding: (target: EqProfileBindingTarget) => Promise<EqProfileBindingInfo>;
    getChannelBalanceState: () => Promise<ChannelBalanceState>;
    setChannelBalanceState: (patch: Partial<ChannelBalanceState>) => Promise<ChannelBalanceState>;
    resetChannelBalance: () => Promise<ChannelBalanceState>;
    getRoomCorrectionState: () => Promise<RoomCorrectionState>;
    importRoomCorrectionIr: () => Promise<RoomCorrectionState | null>;
    setRoomCorrectionEnabled: (enabled: boolean) => Promise<RoomCorrectionState>;
    setRoomCorrectionTrim: (trimDb: number) => Promise<RoomCorrectionState>;
    clearRoomCorrection: () => Promise<RoomCorrectionState>;
  };
  sleepTimer: {
    start: (request: SleepTimerStartRequest) => Promise<SleepTimerStatus>;
    cancel: () => Promise<SleepTimerStatus>;
    getStatus: () => Promise<SleepTimerStatus>;
    onTick: (handler: (remainingMs: number) => void) => () => void;
  };
};

declare global {
  interface Window {
    echo: EchoApi;
  }
}
