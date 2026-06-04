import type {
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryDiagnostics,
  EditableAlbumTags,
  EditableTrackTags,
  LibraryFolderChildrenQuery,
  LibraryFolder,
  LibraryFolderNode,
  LibraryFolderOverview,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryPage,
  LibraryPageQuery,
  LibraryQualityIssueItem,
  LibraryQualityIssueKind,
  LibraryQualityIssuePage,
  LibraryQualityIssueQuery,
  LibraryQualityIssueReason,
  LibraryQualityIssueSeverity,
  LibraryQualityOverviewItem,
  LibraryInboxBatch,
  LibraryInboxAlbumSummary,
  LibraryInboxCreatePlaylistRequest,
  LibraryInboxFilterKind,
  LibraryInboxItemRef,
  LibraryInboxItemStatus,
  LibraryInboxIssueReason,
  LibraryInboxPlaylistResult,
  LibraryInboxQueueResult,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxStory,
  LibraryInboxTrackItem,
  LibraryInboxTrackPage,
  LibraryInboxTrackQuery,
  LibraryInboxUpdateStateRequest,
  LibraryInboxUpdateStateResult,
  LibraryPlaylist,
  LibraryPlaylistItem,
  LibraryScanStatus,
  LibrarySummary,
  LibraryTrack,
  LibraryCleanupResult,
  LibraryMaintenanceCleanupResult,
  LibraryMoveCandidate,
  LibraryMoveCandidateConfidence,
  LibraryMoveCandidateOptions,
  LibraryMoveRepairResult,
  LibraryLabState,
  ArtistImageCacheClearResult,
  ArtistImageCacheEntry,
  ArtistImageCacheSummary,
  ArtistImageCacheStatus,
  ArtistImageJobStatus,
  ArtistImageQueueResult,
  ArtistImageRefreshResult,
  LibraryTrackTagUpdateRequest,
  LibraryAlbumTagUpdateRequest,
  DuplicateTrackGroup,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
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
  ExportPlaylistRequest,
  PlaylistExportFormat,
  BpmAnalysisJobStatus,
  BpmAnalysisResult,
  BpmAnalysisStartOptions,
  ReplayGainAnalysisJobStatus,
  ReplayGainAnalysisResult,
  ReplayGainAnalysisStartOptions,
  LyricsBackfillJobStatus,
  LyricsBackfillMode,
  LyricsBackfillStartOptions,
  ArtistInsights,
  ArtistInsightsOptions,
  ArtistInsightEdge,
  ArtistInsightNode,
  ArtistOnlineInfo,
  ArtistOnlineInfoCacheClearResult,
} from '../../shared/types/library';

export type {
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtist,
  LibraryDiagnostics,
  EditableAlbumTags,
  EditableTrackTags,
  LibraryFolderChildrenQuery,
  LibraryFolder,
  LibraryFolderNode,
  LibraryFolderOverview,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryPage,
  LibraryPageQuery,
  LibraryQualityIssueItem,
  LibraryQualityIssueKind,
  LibraryQualityIssuePage,
  LibraryQualityIssueQuery,
  LibraryQualityIssueReason,
  LibraryQualityIssueSeverity,
  LibraryQualityOverviewItem,
  LibraryInboxBatch,
  LibraryInboxAlbumSummary,
  LibraryInboxCreatePlaylistRequest,
  LibraryInboxFilterKind,
  LibraryInboxItemRef,
  LibraryInboxItemStatus,
  LibraryInboxIssueReason,
  LibraryInboxPlaylistResult,
  LibraryInboxQueueResult,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxStory,
  LibraryInboxTrackItem,
  LibraryInboxTrackPage,
  LibraryInboxTrackQuery,
  LibraryInboxUpdateStateRequest,
  LibraryInboxUpdateStateResult,
  LibraryPlaylist,
  LibraryPlaylistItem,
  LibraryScanStatus,
  LibrarySummary,
  LibraryTrack,
  LibraryCleanupResult,
  LibraryMaintenanceCleanupResult,
  LibraryMoveCandidate,
  LibraryMoveCandidateConfidence,
  LibraryMoveCandidateOptions,
  LibraryMoveRepairResult,
  LibraryLabState,
  ArtistImageCacheClearResult,
  ArtistImageCacheEntry,
  ArtistImageCacheSummary,
  ArtistImageCacheStatus,
  ArtistImageJobStatus,
  ArtistImageQueueResult,
  ArtistImageRefreshResult,
  LibraryTrackTagUpdateRequest,
  LibraryAlbumTagUpdateRequest,
  DuplicateTrackGroup,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
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
  ExportPlaylistRequest,
  PlaylistExportFormat,
  BpmAnalysisJobStatus,
  BpmAnalysisResult,
  BpmAnalysisStartOptions,
  ReplayGainAnalysisJobStatus,
  ReplayGainAnalysisResult,
  ReplayGainAnalysisStartOptions,
  LyricsBackfillJobStatus,
  LyricsBackfillMode,
  LyricsBackfillStartOptions,
  ArtistInsights,
  ArtistInsightsOptions,
  ArtistInsightEdge,
  ArtistInsightNode,
  ArtistOnlineInfo,
  ArtistOnlineInfoCacheClearResult,
};

export type ScannedAudioFile = {
  path: string;
  folderId: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type ScannedFile = Omit<ScannedAudioFile, 'folderId'>;

export type FieldSource =
  | 'manual'
  | 'embedded'
  | 'sidecar'
  | 'folder_structure'
  | 'network'
  | 'technical'
  | 'artist_fallback'
  | 'filename_fallback'
  | 'unknown';

export type FieldSources = Record<string, FieldSource>;

export type EmbeddedReadinessStatus = 'pending' | 'reading' | 'present' | 'missing' | 'error';
export type NetworkMetadataStatus = 'none' | 'pending' | 'candidate_found' | 'applied_missing_only' | 'rejected' | 'error';

export type EmbeddedCoverData = {
  data: Uint8Array;
  mimeType: string | null;
};

export type MetadataFields = {
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
  replayGainTrackGainDb?: number | null;
  replayGainAlbumGainDb?: number | null;
  replayGainTrackPeak?: number | null;
  replayGainAlbumPeak?: number | null;
  replayGainIntegratedLufs?: number | null;
};

export type MetadataStatus = 'ok' | 'fallback' | 'error';

export type MetadataResult = {
  fields: MetadataFields;
  fieldSources: FieldSources;
  embeddedCover?: EmbeddedCoverData;
  embeddedMetadataStatus: EmbeddedReadinessStatus;
  embeddedCoverStatus: EmbeddedReadinessStatus;
  warnings: string[];
  errors: string[];
  status: MetadataStatus;
  raw?: unknown;
};

export type ParsedTrackMetadata = MetadataFields & {
  fieldSources: FieldSources;
  embeddedCover?: EmbeddedCoverData;
  embeddedMetadataStatus?: EmbeddedReadinessStatus;
  embeddedCoverStatus?: EmbeddedReadinessStatus;
  warnings?: string[];
  errors?: string[];
  metadataStatus?: MetadataStatus;
};

export type TrackWrite = Omit<ParsedTrackMetadata, 'embeddedCover'> &
  ScannedAudioFile & {
    id: string;
    coverId: string | null;
    createdAt?: string;
    updatedAt: string;
    fileIdentity?: string | null;
    fileIdentitySource?: 'win32-file-id' | 'posix-dev-ino' | 'unsupported' | 'error' | null;
    quickHash?: string | null;
    quickHashVersion?: number | null;
    identityStatus?: 'ok' | 'partial' | 'unsupported' | 'error' | null;
    identityUpdatedAt?: string | null;
    identityError?: string | null;
  };

export type CoverSource = 'manual' | 'embedded' | 'folder' | 'network' | 'default';
export const COVER_CACHE_VERSION = 1;

export type CoverResult = {
  source: CoverSource;
  thumbPath: string;
  albumPath: string;
  largePath: string;
  originalRef: string;
  sourceHash: string;
  mimeType: string | null;
  warnings: string[];
  errors: string[];
};

export type CoverVariant = 'thumb' | 'album' | 'large' | 'original';

export type CoverExtractOptions = {
  cacheRoot: string;
  metadata?: MetadataResult | ParsedTrackMetadata;
  now?: string;
};

export type CoverCacheRepairOptions = {
  cacheRoot: string;
  source: CoverSource;
  sourceHash: string;
  mimeType: string | null;
  originalRef: string;
  thumbPath?: string | null;
  albumPath?: string | null;
  largePath?: string | null;
  now?: string;
};

export type StoredTrackCoverState = StoredTrackFingerprint & {
  coverId: string | null;
  metadataStatus?: MetadataStatus | string | null;
  embeddedMetadataStatus?: EmbeddedReadinessStatus | string | null;
  embeddedCoverStatus?: EmbeddedReadinessStatus | string | null;
  coverSource: CoverSource | null;
  sourceHash: string | null;
  mimeType: string | null;
  thumbPath: string | null;
  albumPath: string | null;
  largePath: string | null;
  originalRef: string | null;
  cacheVersion: number | null;
  fileIdentity?: string | null;
  fileIdentitySource?: string | null;
  quickHash?: string | null;
  quickHashVersion?: number | null;
  identityStatus?: string | null;
  identityUpdatedAt?: string | null;
  identityError?: string | null;
};

export type ScanDirectorySnapshotEntry = {
  name: string;
  kind: 'directory' | 'file';
};

export type ScanDirectorySnapshot = {
  path: string;
  mtimeMs: number;
  entries: ScanDirectorySnapshotEntry[];
};

export type ScanFileSystemError = {
  kind: 'directory' | 'file_stat';
  path: string;
  message: string;
};

export type ScanOptions = {
  signal?: AbortSignal;
  audioExtensions?: readonly string[];
  fileSystemOperationTimeoutMs?: number;
  yieldEveryEntries?: number;
  onFileSystemError?: (error: ScanFileSystemError) => void;
  getDirectorySnapshot?: (directoryPath: string) => ScanDirectorySnapshot | null;
  onDirectorySnapshot?: (snapshot: ScanDirectorySnapshot) => void;
};

export type StoredTrackFingerprint = {
  id: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type ScanJobUpdate = Partial<
  Pick<
    LibraryScanStatus,
    | 'status'
    | 'totalFiles'
    | 'processedFiles'
    | 'skippedFiles'
    | 'addedTracks'
    | 'updatedTracks'
    | 'removedTracks'
    | 'coverCount'
    | 'errorCount'
    | 'errors'
    | 'phase'
    | 'startedAt'
    | 'finishedAt'
  >
> & {
  cancelRequested?: boolean;
};

export type LibraryScanMode = 'normal' | 'embedded-tags-all' | 'embedded-tags-missing-cover';

export type LibraryScanOptions = {
  mode?: LibraryScanMode;
  deferGroupingRefresh?: boolean;
};

export type ScanResultCounts = {
  processedFiles: number;
  skippedFiles: number;
  addedTracks: number;
  updatedTracks: number;
  removedTracks: number;
  errors: string[];
};
