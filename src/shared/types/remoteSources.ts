import type { StreamingAudioQuality, StreamingProviderName } from './streaming';
import type { ReplayGainTrackData } from '../utils/replayGain';
import type { LibraryPageQuery } from './library';
import type { RemoteAlbumMergeStrategy } from './appSettings';

export type RemoteSourceProvider = 'webdav' | 'baidu' | 'jellyfin' | 'emby' | 'smb' | 'sshfs' | 'subsonic';

export type RemoteSourceStatus = 'enabled' | 'disabled' | 'error';
export type RemoteSourceAuthType = 'none' | 'basic' | 'token' | 'apiKey';
export type RemoteSourceSyncMode = 'browse' | 'index' | 'mirror';
export type RemoteTrackStatus = 'pending' | 'searching' | 'partial' | 'ok' | 'not_found' | 'error';
export type RemoteTrackAvailability = 'available' | 'missing' | 'unknown';
export type RemoteBackgroundJobKind = 'metadata' | 'cover' | 'lyrics' | 'mv' | 'duration-backfill';

export type RemoteVisibleHydrationOptions = {
  metadata?: boolean;
  cover?: boolean;
  priority?: number;
  immediateCover?: boolean;
};

export type RemoteRuntimeLimits = {
  scanConcurrency?: number;
  metadataConcurrency?: number;
  coverConcurrency?: number;
  lyricsConcurrency?: number;
  mvConcurrency?: number;
  durationBackfillConcurrency?: number;
};

export type RemoteSyncOptions = {
  rootPath?: string | null;
  markMissing?: boolean;
  includeCover?: boolean;
};

export type RemoteIndexedTracksQuery = Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search' | 'sort'> & {
  rootPath?: string | null;
};

export type RemoteIndexedFolderStats = {
  sourceId: string;
  rootPath: string;
  trackCount: number;
  totalSizeBytes: number;
  albumCount: number;
  artistCount: number;
};

export type RemoteAlbumGroupingPreview = {
  sourceId: string | null;
  sourceCount: number;
  trackCount: number;
  currentStrategy: RemoteAlbumMergeStrategy;
  targetStrategy: RemoteAlbumMergeStrategy;
  currentAlbumCount: number;
  targetAlbumCount: number;
};

export type RemoteSource = {
  id: string;
  provider: RemoteSourceProvider;
  displayName: string;
  status: RemoteSourceStatus;
  baseUrl: string | null;
  username: string | null;
  authType: RemoteSourceAuthType;
  config: Record<string, unknown>;
  syncMode: RemoteSourceSyncMode;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  indexedTrackCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RemoteSourceInput = {
  provider: RemoteSourceProvider;
  displayName: string;
  baseUrl?: string | null;
  username?: string | null;
  secret?: string | null;
  authType?: RemoteSourceAuthType;
  config?: Record<string, unknown>;
  syncMode?: RemoteSourceSyncMode;
  status?: RemoteSourceStatus;
};

export type BaiduOAuthAuthorizeRequest = {
  clientId?: string | null;
  redirectUri?: string | null;
  state?: string | null;
  qrcode?: boolean;
  responseType?: 'code' | 'token';
};

export type BaiduOAuthTokenRequest = {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  code: string;
};

export type BaiduOAuthLoginRequest = {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  timeoutMs?: number | null;
};

export type BaiduOAuthTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  expiresAt: string | null;
  scope: string | null;
  tokenSecret: string;
};

export type RemoteSourceUpdate = Partial<RemoteSourceInput> & {
  id: string;
};

export type RemoteLibraryTrack = {
  id: string;
  sourceId: string;
  provider: RemoteSourceProvider;
  remotePath: string;
  stableKey: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  etag: string | null;
  coverId: string | null;
  coverThumb: string | null;
  coverStatus: RemoteTrackStatus;
  metadataStatus: RemoteTrackStatus;
  lyricsStatus: RemoteTrackStatus;
  mvStatus: RemoteTrackStatus;
  availability: RemoteTrackAvailability;
  fieldSources: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type RemoteTrackIdentity = {
  sourceId: string;
  provider: RemoteSourceProvider;
  remotePath: string;
  stableKey: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  duration: number | null;
};

export type RemoteTrackLookupItem = {
  trackId: string;
  sourceId: string;
  remotePath: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  codec: string | null;
  coverThumb: string | null;
  metadataStatus: RemoteTrackStatus;
  coverStatus: RemoteTrackStatus;
  lyricsStatus: RemoteTrackStatus;
  mvStatus: RemoteTrackStatus;
  availability: RemoteTrackAvailability;
};

export type LocalMediaItem = {
  mediaType: 'local';
  trackId: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: number | null;
  coverThumb?: string | null;
};

export type RemoteMediaItem = {
  mediaType: 'remote';
  trackId: string;
  sourceId?: string | null;
  stableKey?: string | null;
  remotePath?: string | null;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: number | null;
  codec?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  bitrate?: number | null;
  coverThumb?: string | null;
};

export type StreamingMediaItem = {
  mediaType: 'streaming';
  trackId: string;
  provider: StreamingProviderName;
  providerTrackId: string;
  quality?: StreamingAudioQuality;
  stableKey: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: number | null;
  coverThumb?: string | null;
  playable: boolean;
  unavailableReason?: string | null;
};

export type MediaItem = LocalMediaItem | RemoteMediaItem | StreamingMediaItem;

export type PlayableTrack = MediaItem & {
  replayGain?: ReplayGainTrackData | null;
  streamUrl?: string | null;
};

export type RemoteDirectoryItem = {
  sourceId: string;
  provider: RemoteSourceProvider;
  path: string;
  name: string;
  kind: 'directory' | 'file';
  sizeBytes: number | null;
  modifiedAt: string | null;
  etag: string | null;
  contentType: string | null;
  audio: boolean;
};

export type RemoteScanItem = RemoteDirectoryItem & {
  remoteUrlHash: string;
  stableKey: string;
  metadata?: RemoteMetadataResult;
};

export type RemoteMetadataResult = {
  status: RemoteTrackStatus;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  fieldSources: Record<string, string>;
  warnings: string[];
  errors: string[];
};

export type RemoteCoverResult = {
  status: RemoteTrackStatus;
  data: Uint8Array | null;
  mimeType: string | null;
  fieldSources: Record<string, string>;
  warnings: string[];
  errors: string[];
};

export type RemoteDirectoryPreviewOptions = {
  limit?: number;
  includeCover?: boolean;
};

export type RemoteDirectoryPreviewItem = {
  remotePath: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  coverThumb: string | null;
  metadataStatus: RemoteTrackStatus;
  coverStatus: RemoteTrackStatus;
  fieldSources: Record<string, string>;
};

export type RemoteStreamUrlResult = {
  url: string;
  expiresAt: string;
};

export type TestRemoteSourceResult = {
  ok: boolean;
  status: RemoteSourceStatus;
  message: string;
  testedAt: string;
};

export type RemoteSyncPhase =
  | 'idle'
  | 'testing'
  | 'scanning'
  | 'reading_metadata'
  | 'writing_database'
  | 'marking_missing'
  | 'finished'
  | 'cancelled'
  | 'failed';

export type RemoteSyncStatus = {
  sourceId: string;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  phase: RemoteSyncPhase;
  discoveredCount: number;
  parsedCount: number;
  writtenCount: number;
  skippedCount: number;
  missingCount: number;
  failedCount: number;
  currentPath: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
};

export type RemoteBackgroundJobStatus = {
  sourceId: string;
  paused: boolean;
  concurrency: Record<RemoteBackgroundJobKind, number>;
  pending: Record<RemoteBackgroundJobKind, number>;
  running: Record<RemoteBackgroundJobKind, number>;
  completed: Record<RemoteBackgroundJobKind, number>;
  failed: Record<RemoteBackgroundJobKind, number>;
  skipped: Record<RemoteBackgroundJobKind, number>;
  current: Array<{
    kind: RemoteBackgroundJobKind;
    trackId: string;
    title: string;
    remotePath: string;
    startedAt: string;
  }>;
  lastError: string | null;
  updatedAt: string | null;
};

export type RemoteBackgroundGlobalStatus = {
  paused: boolean;
  playbackActive: boolean;
  concurrency: Record<RemoteBackgroundJobKind, number>;
  updatedAt: string | null;
};

export type RemoteSourceTrackStatusCounts = Record<RemoteTrackStatus, number>;

export type RemoteSourceOverviewItem = {
  sourceId: string;
  provider: RemoteSourceProvider;
  displayName: string;
  status: RemoteSourceStatus;
  syncMode: RemoteSourceSyncMode;
  trackCount: number;
  albumCount: number;
  artistCount: number;
  totalSizeBytes: number;
  missingTrackCount: number;
  metadata: RemoteSourceTrackStatusCounts;
  cover: RemoteSourceTrackStatusCounts;
  lyrics: RemoteSourceTrackStatusCounts;
  mv: RemoteSourceTrackStatusCounts;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type RemoteSourceOverview = {
  totalSources: number;
  enabledSources: number;
  disabledSources: number;
  errorSources: number;
  trackCount: number;
  albumCount: number;
  artistCount: number;
  totalSizeBytes: number;
  missingTrackCount: number;
  metadata: RemoteSourceTrackStatusCounts;
  cover: RemoteSourceTrackStatusCounts;
  lyrics: RemoteSourceTrackStatusCounts;
  mv: RemoteSourceTrackStatusCounts;
  sources: RemoteSourceOverviewItem[];
};

export type RemoteSourceIssueKind = 'metadata' | 'cover' | 'lyrics' | 'mv' | 'missing';

export type RemoteSourceIssueItem = {
  id: string;
  sourceId: string;
  provider: RemoteSourceProvider;
  kind: RemoteSourceIssueKind;
  status: RemoteTrackStatus | RemoteTrackAvailability;
  title: string;
  artist: string;
  album: string;
  remotePath: string;
  sizeBytes: number | null;
  updatedAt: string;
};
