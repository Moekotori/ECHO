import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { copyFile as copyFileAsync, rm as rmAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { isScannableAudioExtension, SUPPORTED_AUDIO_DIALOG_EXTENSIONS } from '../../shared/constants/audioExtensions';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  DuplicateTrackCleanupFailure,
  DuplicateTrackCleanupResult,
  DuplicateTrackMode,
  DuplicateTrackIndexSummary,
  EditableAlbumTags,
  EditableTrackTags,
  FinishPlaybackHistoryRequest,
  ImportPathClassification,
  ImportAudioFilesResult,
  ImportPlaylistFileResult,
  LibraryFolderChildrenQuery,
  LibraryEmbeddedTagRescanOptions,
  LibraryFolderPathRequest,
  LibraryFolderTracksQuery,
  LibraryPageQuery,
  LibraryQualityIssueKind,
  LibraryQualityIssueQuery,
  LibraryInboxCreatePlaylistRequest,
  LibraryInboxFilterKind,
  LibraryInboxItemStatus,
  LibraryInboxScope,
  LibraryInboxStatusFilter,
  LibraryInboxTrackQuery,
  LibraryInboxUpdateStateRequest,
  LibraryDatabaseProtectionStatusOptions,
  LibraryHealthReport,
  LibraryPlaylist,
  LibraryPlaylistItem,
  LibraryScanOptions,
  PlaylistExportFormat,
  PlaylistSortMode,
  LibrarySort,
  LibraryTrackTagUpdateRequest,
  LibraryAlbumTagUpdateRequest,
  MissingMetadataField,
  MissingMetadataScanOptions,
  NetworkApplyOptions,
  NetworkTagCandidateSearchRequest,
  NetworkTagProvider,
  PlaybackHistoryQuery,
  StartPlaybackHistoryRequest,
  BpmAnalysisStartOptions,
  ReplayGainAnalysisStartOptions,
  LyricsBackfillStartOptions,
  AddLocalAudioFilesToPlaylistResult,
  LibraryScanMode,
  LibraryAllUserDataDeleteResult,
} from '../../shared/types/library';
import { getAppSettings } from '../app/appSettings';
import { getAppCacheInventory } from '../app/cacheInventory';
import {
  createManualLibraryDatabaseSnapshot,
  deleteProtectedLibraryDatabase,
  discardQuarantinedProblemTracks,
  getLibraryDatabaseProtectionStatus,
  LibraryDatabaseUnavailableError,
  repairProtectedLibraryDatabase,
  restoreProtectedLibraryDatabaseSnapshot,
  scrubQuarantinedLibraryDatabase,
} from '../app/dataProtection';
import { getLibraryDatabaseManager } from '../database/LibraryDatabaseManager';
import { closeDefaultLibraryService, getLibraryService } from '../library/LibraryService';
import { importOsuArchiveAsMp3Queued, isOsuArchivePath } from '../library/OsuArchiveImport';
import { closeDefaultRemoteSourceService, getRemoteSourceService } from '../library/remote/RemoteSourceService';
import { closeDefaultLyricsService } from '../lyrics/LyricsService';
import { closeDefaultMvService } from '../mv/MvService';
import { SongCardRenderer } from '../library/SongCardRenderer';
import { createLibraryHealthReportAsync, writeLibraryHealthReportMarkdown } from '../library/LibraryHealthReport';
import { closeDefaultStreamingService, getStreamingService } from '../streaming/StreamingService';
import { decodeM3u8ProviderTrackId } from '../streaming/M3u8Playlist';
import { createLibraryRecoveryRelaunchArgs } from '../app/libraryRecoveryMode';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { getDownloadService } from '../downloads/DownloadService';

const sortValues = new Set<LibrarySort>([
  'default',
  'createdAsc',
  'createdDesc',
  'titleAsc',
  'titleDesc',
  'durationAsc',
  'durationDesc',
  'fileModifiedAsc',
  'fileModifiedDesc',
  'qualityAsc',
  'qualityDesc',
  'frequent',
  'random',
  'title',
  'artist',
  'artistAlbum',
  'album',
  'recent',
]);

const runMainBackgroundTask = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
  const clearBackgroundTask = beginMainBackgroundTask(name);
  try {
    return await work();
  } finally {
    clearBackgroundTask();
  }
};
const duplicateTrackModes = new Set<DuplicateTrackMode>(['strict', 'balanced', 'aggressive']);
const sourceProviderValues = new Set(['local', 'netease', 'qqmusic', 'spotify', 'remote', 'm3u8']);
const libraryQualityIssueKinds = new Set<LibraryQualityIssueKind>([
  'missing_cover',
  'fallback_metadata',
  'unknown_artist_album',
  'embedded_read_failed',
  'network_candidate',
]);
const libraryInboxFilterKinds = new Set<LibraryInboxFilterKind>([
  'all',
  'missing_cover',
  'metadata_issue',
  'unknown_artist',
  'unknown_album',
  'suspicious_file',
]);
const libraryInboxScopes = new Set<LibraryInboxScope>(['latest', 'batch', 'all']);
const libraryInboxStatuses = new Set<LibraryInboxStatusFilter>(['all', 'pending', 'processed', 'ignored']);
const libraryInboxItemStatuses = new Set<LibraryInboxItemStatus>(['pending', 'processed', 'ignored']);
const songCardRenderer = new SongCardRenderer();

const closeLibraryDatabaseUsers = (): void => {
  closeDefaultLyricsService();
  closeDefaultMvService();
  closeDefaultStreamingService();
  closeDefaultRemoteSourceService();
  closeDefaultLibraryService();
  getLibraryDatabaseManager().closeAllUsers('manual-library-maintenance');
};

const isSameOrInside = (parentPath: string, candidatePath: string): boolean => {
  const parent = resolve(parentPath).toLowerCase();
  const candidate = resolve(candidatePath).toLowerCase();
  return candidate === parent || candidate.startsWith(`${parent}\\`) || candidate.startsWith(`${parent}/`);
};

const isSafeExternalCacheDirectory = (targetPath: string): boolean => {
  const name = basename(resolve(targetPath)).toLowerCase();
  return name.includes('echo') || name.includes('cover') || name.includes('cache');
};

const listExistingChildren = (directory: string): string[] => {
  if (!existsSync(directory)) {
    return [];
  }

  try {
    return readdirSync(directory).map((entry) => join(directory, entry));
  } catch {
    return [directory];
  }
};

const removePathForWipe = async (
  targetPath: string,
  removedPaths: string[],
  failedPaths: Array<{ path: string; error: string }>,
): Promise<void> => {
  if (!existsSync(targetPath)) {
    return;
  }

  try {
    await rmAsync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removedPaths.push(targetPath);
  } catch (error) {
    failedPaths.push({ path: targetPath, error: error instanceof Error ? error.message : String(error) });
  }
};

const resolveCoverCachePathForWipe = (): string | null => {
  try {
    return getLibraryService().getCoverCacheDir();
  } catch {
    const configuredCoverCacheDir = getAppSettings().coverCacheDir;
    return typeof configuredCoverCacheDir === 'string' && configuredCoverCacheDir.trim()
      ? resolve(configuredCoverCacheDir.trim())
      : null;
  }
};

const deleteAllUserData = async (coverCachePath: string | null): Promise<LibraryAllUserDataDeleteResult> => {
  const userDataPath = app.getPath('userData');
  const removedPaths: string[] = [];
  const failedPaths: Array<{ path: string; error: string }> = [];

  let externalCoverCacheChildren: string[] = [];
  if (coverCachePath && !isSameOrInside(userDataPath, coverCachePath)) {
    if (isSafeExternalCacheDirectory(coverCachePath)) {
      externalCoverCacheChildren = listExistingChildren(coverCachePath);
    } else {
      failedPaths.push({
        path: coverCachePath,
        error: 'Skipped external cover cache directory because its name does not look ECHO/cache-specific.',
      });
    }
  }
  const userDataChildren = listExistingChildren(userDataPath);

  for (const targetPath of [...externalCoverCacheChildren, ...userDataChildren]) {
    await removePathForWipe(targetPath, removedPaths, failedPaths);
  }

  return {
    userDataPath,
    coverCachePath,
    removedPaths,
    failedPaths,
  };
};

const scheduleLibraryRecoveryRelaunch = () => {
  app.relaunch({ args: createLibraryRecoveryRelaunchArgs() });
  setTimeout(() => {
    app.quit();
  }, 50).unref?.();

  return {
    scheduled: true,
    mode: 'startup-auto-repair' as const,
    message: 'ECHO Next 将退出并重启到恢复模式，重启时会在服务占用数据库前先运行曲库保护检查和自动修复。',
  };
};

const normalizeDatabaseProtectionStatusOptions = (value: unknown): LibraryDatabaseProtectionStatusOptions => ({
  deepCheck: typeof value === 'object' && value !== null && (value as { deepCheck?: unknown }).deepCheck === false ? false : true,
});

const getDatabaseProtectionStatusForRenderer = (options: LibraryDatabaseProtectionStatusOptions = {}) => ({
  ...getLibraryDatabaseProtectionStatus(app.getPath('userData'), isLibraryScanRunning(), options),
  managerState: getLibraryDatabaseManager().getState(),
});

const formatReportTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const createLibraryHealthReportForRenderer = (): Promise<LibraryHealthReport> =>
  createLibraryHealthReportAsync({
    getSummary: () => getLibraryService().getSummary(),
    getDiagnostics: () => getLibraryService().getDiagnostics(),
    getDatabaseProtectionStatus: getDatabaseProtectionStatusForRenderer,
    getQualityOverview: () => getLibraryService().getLibraryQualityOverview(),
    getLibraryLabState: () => getLibraryService().getLibraryLabState(),
    getCacheInventory: () => getAppCacheInventory(app.getPath('userData')),
    listRemoteSources: () => getRemoteSourceService().listSources(),
    getRemoteBackgroundGlobalStatus: () => getRemoteSourceService().getBackgroundGlobalStatus(),
  });

const isLibraryScanRunning = (): boolean => {
  try {
    return getLibraryService().hasRunningJobs();
  } catch {
    return false;
  }
};

const assertNoRunningLibraryScan = (): void => {
  if (isLibraryScanRunning()) {
    throw new Error('曲库扫描仍在运行，已拒绝恢复、重建、删除或清理重复歌曲。请等待扫描结束后再试。');
  }
};

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
};

const normalizePathList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new Error('paths must be an array');
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

export const classifyImportPaths = (paths: string[]): ImportPathClassification => {
  const classification: ImportPathClassification = {
    folders: [],
    audioFiles: [],
    osuArchives: [],
    unsupportedFiles: [],
    missingPaths: [],
  };

  for (const filePath of paths) {
    try {
      const fileStat = statSync(filePath);

      if (fileStat.isDirectory()) {
        classification.folders.push(filePath);
        continue;
      }

      if (fileStat.isFile() && isScannableAudioExtension(filePath)) {
        classification.audioFiles.push(filePath);
        continue;
      }

      if (fileStat.isFile() && isOsuArchivePath(filePath)) {
        classification.osuArchives.push(filePath);
        continue;
      }

      classification.unsupportedFiles.push(filePath);
    } catch {
      classification.missingPaths.push(filePath);
    }
  }

  return classification;
};

const normalizeQuery = (value: unknown): LibraryPageQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const query: LibraryPageQuery = {};

  if (typeof input.page === 'number') {
    query.page = input.page;
  }

  if (typeof input.pageSize === 'number') {
    query.pageSize = input.pageSize;
  }

  if (typeof input.search === 'string') {
    query.search = input.search;
  }

  if (typeof input.sort === 'string' && sortValues.has(input.sort as LibrarySort)) {
    query.sort = input.sort as LibrarySort;
  }

  if (typeof input.sourceProvider === 'string' && sourceProviderValues.has(input.sourceProvider)) {
    query.sourceProvider = input.sourceProvider as LibraryPageQuery['sourceProvider'];
  }

  if (typeof input.sourceId === 'string' && input.sourceId.trim().length > 0) {
    query.sourceId = input.sourceId.trim();
  }

  if (typeof input.hideDuplicates === 'boolean') {
    query.hideDuplicates = input.hideDuplicates;
  }

  if (typeof input.showDuplicatesOnly === 'boolean') {
    query.showDuplicatesOnly = input.showDuplicatesOnly;
  }

  if (typeof input.duplicateMode === 'string' && duplicateTrackModes.has(input.duplicateMode as DuplicateTrackMode)) {
    query.duplicateMode = input.duplicateMode as DuplicateTrackMode;
  }

  if (typeof input.prioritizeArtistAvatars === 'boolean') {
    query.prioritizeArtistAvatars = input.prioritizeArtistAvatars;
  }

  if (Array.isArray(input.excludeTrackIds)) {
    query.excludeTrackIds = input.excludeTrackIds
      .filter((trackId): trackId is string => typeof trackId === 'string' && trackId.trim().length > 0)
      .map((trackId) => trackId.trim())
      .slice(0, 250);
  }

  if (typeof input.randomWindow === 'boolean') {
    query.randomWindow = input.randomWindow;
  }

  return query;
};

const normalizeLibraryQualityIssueQuery = (value: unknown): LibraryQualityIssueQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('library quality issue query must be an object');
  }

  const input = value as Record<string, unknown>;
  const rawKind = input.kind;
  if (typeof rawKind !== 'string' || !libraryQualityIssueKinds.has(rawKind as LibraryQualityIssueKind)) {
    throw new Error('library quality issue kind must be supported');
  }

  if (typeof input.sourceProvider === 'string' && input.sourceProvider !== 'local') {
    throw new Error('library quality dashboard currently supports local sourceProvider only');
  }

  const pageSize = Number(input.pageSize);
  const page = Number(input.page);
  return {
    kind: rawKind as LibraryQualityIssueKind,
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : undefined,
    pageSize: Number.isFinite(pageSize) ? Math.max(1, Math.min(100, Math.floor(pageSize))) : undefined,
    sourceProvider: 'local',
    search: typeof input.search === 'string' ? input.search : undefined,
  };
};

const normalizeNullableIpcText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeLibraryInboxTrackQuery = (value: unknown): LibraryInboxTrackQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const pageSize = Number(input.pageSize);
  const page = Number(input.page);
  const query: LibraryInboxTrackQuery = {
    batchId: normalizeNullableIpcText(input.batchId),
    folderId: normalizeNullableIpcText(input.folderId),
    album: normalizeNullableIpcText(input.album),
    artist: normalizeNullableIpcText(input.artist),
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : undefined,
    pageSize: Number.isFinite(pageSize) ? Math.max(1, Math.min(100, Math.floor(pageSize))) : undefined,
    search: typeof input.search === 'string' ? input.search : undefined,
  };

  if (typeof input.scope === 'string' && libraryInboxScopes.has(input.scope as LibraryInboxScope)) {
    query.scope = input.scope as LibraryInboxScope;
  }
  if (typeof input.filter === 'string' && libraryInboxFilterKinds.has(input.filter as LibraryInboxFilterKind)) {
    query.filter = input.filter as LibraryInboxFilterKind;
  }
  if (typeof input.status === 'string' && libraryInboxStatuses.has(input.status as LibraryInboxStatusFilter)) {
    query.status = input.status as LibraryInboxStatusFilter;
  }

  return query;
};

const normalizeLibraryInboxPlaylistRequest = (value: unknown): LibraryInboxCreatePlaylistRequest => {
  const query = normalizeLibraryInboxTrackQuery(value);
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    ...query,
    name: normalizeNullableIpcText(input.name),
  };
};

const normalizeLibraryInboxUpdateStateRequest = (value: unknown): LibraryInboxUpdateStateRequest => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (typeof input.status !== 'string' || !libraryInboxItemStatuses.has(input.status as LibraryInboxItemStatus)) {
    throw new Error('inbox item status must be supported');
  }
  const status = input.status as LibraryInboxItemStatus;
  const items = Array.isArray(input.items)
    ? input.items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
          batchId: normalizeNullableIpcText(item.batchId) ?? '',
          trackId: normalizeNullableIpcText(item.trackId) ?? '',
        }))
        .filter((item) => item.batchId.length > 0 && item.trackId.length > 0)
    : undefined;

  return {
    status,
    items,
    query: input.query ? normalizeLibraryInboxTrackQuery(input.query) : undefined,
  };
};

const httpUrlPattern = /^https?:\/\//iu;

const normalizeM3uLocalPath = (line: string, playlistDir: string): string | null => {
  const trimmed = line.trim().replace(/^"(.*)"$/u, '$1');
  if (!trimmed || httpUrlPattern.test(trimmed)) {
    return null;
  }

  if (/^file:\/\//iu.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }

  if (/^[a-z]:[\\/]/iu.test(trimmed) || /^\\\\/u.test(trimmed)) {
    return resolve(trimmed);
  }

  return resolve(playlistDir, trimmed);
};

const parseLocalM3uPlaylistFile = (filePath: string, content: string): { title: string; paths: string[]; hasRemoteUrls: boolean } => {
  const playlistDir = dirname(filePath);
  const paths: string[] = [];
  let title = basename(filePath).replace(/\.(m3u8?|txt)$/iu, '') || 'Imported Playlist';
  let hasRemoteUrls = false;

  for (const rawLine of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('#PLAYLIST:')) {
      title = line.slice('#PLAYLIST:'.length).trim() || title;
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (httpUrlPattern.test(line)) {
      hasRemoteUrls = true;
      continue;
    }

    const localPath = normalizeM3uLocalPath(line, playlistDir);
    if (localPath) {
      paths.push(localPath);
    }
  }

  return {
    title,
    paths: Array.from(new Set(paths)),
    hasRemoteUrls,
  };
};

type ArtistImageIpcInput = { id?: string; name?: string; artistKey?: string; artistName?: string };

const normalizeArtistImageInputs = (value: unknown): ArtistImageIpcInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const artists: ArtistImageIpcInput[] = [];

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      artists.push({ id: item.trim() });
      continue;
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const input = item as Record<string, unknown>;
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined;
    const artistKey = typeof input.artistKey === 'string' && input.artistKey.trim() ? input.artistKey.trim() : undefined;
    const artistName = typeof input.artistName === 'string' && input.artistName.trim() ? input.artistName.trim() : undefined;

    if (id || name || artistKey || artistName) {
      artists.push({ id, name, artistKey, artistName });
    }
  }

  return artists;
};

const normalizeArtistImagesEnqueueRequest = (
  value: unknown,
): { artists: ArtistImageIpcInput[]; force: boolean; limit?: number } => {
  if (Array.isArray(value)) {
    return { artists: normalizeArtistImageInputs(value), force: false };
  }

  if (!value || typeof value !== 'object') {
    return { artists: [], force: false };
  }

  const input = value as Record<string, unknown>;
  const limit = Number(input.limit);

  return {
    artists: normalizeArtistImageInputs(input.artists),
    force: input.force === true,
    limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : undefined,
  };
};

const normalizeArtistImageRefreshOneRequest = (value: unknown): { artistIdOrKey: string; force: boolean } => {
  if (typeof value === 'string') {
    return { artistIdOrKey: requireText(value, 'artistId'), force: false };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('artist image refresh request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    artistIdOrKey: requireText(input.artistId ?? input.artistKey ?? input.id, 'artistId'),
    force: input.force === true,
  };
};

const normalizeArtistImageCustomUrlRequest = (value: unknown): { artistIdOrKey: string; url: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('artist image URL request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    artistIdOrKey: requireText(input.artistId ?? input.artistKey ?? input.id, 'artistId'),
    url: requireText(input.url, 'url'),
  };
};

const normalizeArtistImageBackfillOptions = (value: unknown): { force?: boolean; limit?: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const limit = Number(input.limit);
  return {
    force: input.force === true,
    limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : undefined,
  };
};

const normalizeDuplicateMode = (value: unknown): DuplicateTrackMode =>
  typeof value === 'string' && duplicateTrackModes.has(value as DuplicateTrackMode) ? (value as DuplicateTrackMode) : 'strict';

const emptyDuplicateIndexSummary = (mode: DuplicateTrackMode): DuplicateTrackIndexSummary => ({
  mode,
  totalTracksScanned: 0,
  duplicateGroups: 0,
  duplicateMembers: 0,
  hiddenTracks: 0,
  updatedAt: '',
});

const normalizeFolderChildrenQuery = (value: unknown): LibraryFolderChildrenQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('folder children query must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    folderId: requireText(input.folderId, 'folderId'),
    parentPath: typeof input.parentPath === 'string' && input.parentPath.trim() ? input.parentPath : undefined,
  };
};

const normalizeFolderPathRequest = (value: unknown): LibraryFolderPathRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('folder path request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    folderId: requireText(input.folderId, 'folderId'),
    path: typeof input.path === 'string' && input.path.trim() ? input.path : undefined,
  };
};

const normalizeFolderTracksQuery = (value: unknown): LibraryFolderTracksQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('folder tracks query must be an object');
  }

  const input = value as Record<string, unknown>;
  const pageQuery = normalizeQuery(value);
  return {
    ...pageQuery,
    folderId: requireText(input.folderId, 'folderId'),
    path: typeof input.path === 'string' && input.path.trim() ? input.path : undefined,
    recursive: typeof input.recursive === 'boolean' ? input.recursive : true,
  };
};

const normalizePlaylistItemsQuery = (value: unknown): Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search'> => {
  const query = normalizeQuery(value);
  return {
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
  };
};

const playlistSortModes = new Set<PlaylistSortMode>(['manual', 'titleAsc', 'titleDesc', 'artistAsc', 'addedDesc']);
const playlistExportFormats = new Set<PlaylistExportFormat>(['json', 'txt', 'm3u8', 'csv']);

const normalizeCreatePlaylistRequest = (value: unknown): { name: string; description?: string | null } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { name: requireText(value, 'name') };
  }

  const input = value as Record<string, unknown>;
  return {
    name: requireText(input.name, 'name'),
    description: typeof input.description === 'string' ? input.description : null,
  };
};

const normalizeUpdatePlaylistRequest = (
  value: unknown,
): { playlistId: string; name?: string; description?: string | null; coverId?: string | null; coverPath?: string | null; sortMode?: PlaylistSortMode } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playlist update request must be an object');
  }

  const input = value as Record<string, unknown>;
  const sortMode = typeof input.sortMode === 'string' && playlistSortModes.has(input.sortMode as PlaylistSortMode)
    ? (input.sortMode as PlaylistSortMode)
    : undefined;

  return {
    playlistId: requireText(input.playlistId, 'playlistId'),
    name: typeof input.name === 'string' ? input.name : undefined,
    description: typeof input.description === 'string' || input.description === null ? (input.description as string | null) : undefined,
    coverId: typeof input.coverId === 'string' || input.coverId === null ? (input.coverId as string | null) : undefined,
    coverPath: typeof input.coverPath === 'string' || input.coverPath === null ? (input.coverPath as string | null) : undefined,
    sortMode,
  };
};

const normalizeExportPlaylistRequest = (value: unknown): { playlistId: string; format: PlaylistExportFormat; sourceProvider?: LibraryPageQuery['sourceProvider'] } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playlist export request must be an object');
  }

  const input = value as Record<string, unknown>;
  const format = typeof input.format === 'string' && playlistExportFormats.has(input.format as PlaylistExportFormat)
    ? (input.format as PlaylistExportFormat)
    : null;

  if (!format) {
    throw new Error('playlist export format must be json, txt, m3u8, or csv');
  }

  const sourceProvider =
    typeof input.sourceProvider === 'string' && sourceProviderValues.has(input.sourceProvider)
      ? (input.sourceProvider as LibraryPageQuery['sourceProvider'])
      : undefined;

  return {
    playlistId: requireText(input.playlistId, 'playlistId'),
    format,
    sourceProvider,
  };
};

const normalizeTrackIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new Error('trackIds must be an array');
  }

  return value.map((item) => requireText(item, 'trackId'));
};

const normalizeDuplicateTrackCleanupRequest = (value: unknown): { trackIds: string[]; mode: DuplicateTrackMode } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('duplicate cleanup request must be an object');
  }

  const input = value as Record<string, unknown>;
  const trackIds = Array.from(new Set(normalizeTrackIds(input.trackIds)));
  if (trackIds.length === 0) {
    throw new Error('trackIds must include at least one duplicate track');
  }

  return {
    trackIds,
    mode: normalizeDuplicateMode(input.mode),
  };
};

const normalizeStreamingPlaylistTrack = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('streaming track must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    id: typeof input.id === 'string' ? input.id : '',
    provider: requireText(input.provider, 'provider'),
    providerTrackId: requireText(input.providerTrackId, 'providerTrackId'),
    stableKey: typeof input.stableKey === 'string' ? input.stableKey : null,
    title: requireText(input.title, 'title'),
    artist: typeof input.artist === 'string' && input.artist.trim() ? input.artist : 'Unknown Artist',
    album: typeof input.album === 'string' ? input.album : '',
    duration: typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : 0,
    unavailable: input.unavailable === true,
  };
};

const normalizeAlbumIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new Error('albumIds must be an array');
  }

  return value.map((item) => requireText(item, 'albumId'));
};

const normalizeTargetPosition = (value: unknown): number => {
  const position = Number(value);
  if (!Number.isFinite(position)) {
    throw new Error('targetPosition must be a number');
  }

  return Math.max(0, Math.floor(position));
};

const normalizePlaybackHistoryQuery = (value: unknown): PlaybackHistoryQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const query: PlaybackHistoryQuery = {};

  if (typeof input.page === 'number') {
    query.page = input.page;
  }

  if (typeof input.pageSize === 'number') {
    query.pageSize = input.pageSize;
  }

  if (typeof input.search === 'string') {
    query.search = input.search;
  }

  if (typeof input.from === 'string') {
    query.from = input.from;
  }

  if (typeof input.to === 'string') {
    query.to = input.to;
  }

  if (typeof input.completedOnly === 'boolean') {
    query.completedOnly = input.completedOnly;
  }

  if (input.sort === 'plays' || input.sort === 'recent') {
    query.sort = input.sort;
  }

  return query;
};

const normalizeStartPlaybackHistoryRequest = (value: unknown): StartPlaybackHistoryRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playback history start request must be an object');
  }

  const input = value as Record<string, unknown>;
  const trackId = input.trackId === null ? null : requireText(input.trackId, 'trackId');
  const durationSeconds = typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : undefined;

  return {
    trackId,
    mediaType:
      input.mediaType === 'local' || input.mediaType === 'remote' || input.mediaType === 'streaming'
        ? input.mediaType
        : undefined,
    sourceId: typeof input.sourceId === 'string' && input.sourceId.trim() ? input.sourceId : null,
    provider: typeof input.provider === 'string' && input.provider.trim() ? input.provider : null,
    providerTrackId: typeof input.providerTrackId === 'string' && input.providerTrackId.trim() ? input.providerTrackId : null,
    stableKey: typeof input.stableKey === 'string' && input.stableKey.trim() ? input.stableKey : null,
    remotePath: typeof input.remotePath === 'string' && input.remotePath.trim() ? input.remotePath : null,
    trackPath: typeof input.trackPath === 'string' && input.trackPath.trim() ? input.trackPath : undefined,
    title: typeof input.title === 'string' ? input.title : undefined,
    artist: typeof input.artist === 'string' ? input.artist : undefined,
    album: typeof input.album === 'string' ? input.album : undefined,
    albumArtist: typeof input.albumArtist === 'string' ? input.albumArtist : undefined,
    coverId: typeof input.coverId === 'string' || input.coverId === null ? (input.coverId as string | null) : undefined,
    coverSnapshot: typeof input.coverSnapshot === 'string' && input.coverSnapshot.trim() ? input.coverSnapshot : null,
    durationSeconds,
    sourceType: typeof input.sourceType === 'string' && input.sourceType.trim() ? input.sourceType : null,
    sourceLabel: typeof input.sourceLabel === 'string' && input.sourceLabel.trim() ? input.sourceLabel : null,
    queueId: typeof input.queueId === 'string' && input.queueId.trim() ? input.queueId : null,
  };
};

const normalizeFinishPlaybackHistoryRequest = (value: unknown): FinishPlaybackHistoryRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('playback history finish request must be an object');
  }

  const input = value as Record<string, unknown>;
  const playedSeconds = Number(input.playedSeconds);

  if (!Number.isFinite(playedSeconds) || playedSeconds < 0) {
    throw new Error('playedSeconds must be a non-negative number');
  }

  return {
    historyId: requireText(input.historyId, 'historyId'),
    playedSeconds,
    durationSeconds:
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
        ? input.durationSeconds
        : undefined,
    completed: typeof input.completed === 'boolean' ? input.completed : undefined,
    endedAt: typeof input.endedAt === 'string' && input.endedAt.trim() ? input.endedAt : undefined,
  };
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const optionalLimit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : fallback;
};

const optionalLargeLimit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20000, Math.floor(parsed))) : fallback;
};

const networkTagProviders = new Set<NetworkTagProvider>(['mock', 'musicbrainz', 'cover-art-archive', 'netease-cloud-music', 'qq-music', 'kugou-music']);
const missingMetadataFields = new Set<MissingMetadataField>([
  'cover',
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNo',
  'discNo',
  'year',
  'genre',
]);

const normalizeMissingMetadataScanOptions = (value: unknown, fallback: number): Required<MissingMetadataScanOptions> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { limit: optionalLimit(value, fallback), fields: [] };
  }

  const input = value as Record<string, unknown>;
  const fields = Array.isArray(input.fields)
    ? input.fields.filter((field): field is MissingMetadataField => typeof field === 'string' && missingMetadataFields.has(field as MissingMetadataField))
    : [];

  return {
    limit: optionalLimit(input.limit, fallback),
    fields: [...new Set(fields)],
  };
};

const normalizeNetworkApplyRequest = (value: unknown): { candidateId: string; options: NetworkApplyOptions } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { candidateId: requireText(value, 'candidateId'), options: {} };
  }

  const input = value as Record<string, unknown>;
  const fields = Array.isArray(input.fields)
    ? input.fields.filter((field): field is MissingMetadataField => typeof field === 'string' && missingMetadataFields.has(field as MissingMetadataField))
    : [];

  return {
    candidateId: requireText(input.candidateId, 'candidateId'),
    options: { fields: [...new Set(fields)] },
  };
};

const normalizeTagUpdateRequest = (value: unknown): LibraryTrackTagUpdateRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tag update request must be an object');
  }

  const input = value as Record<string, unknown>;
  const tagsInput = input.tags;

  if (!tagsInput || typeof tagsInput !== 'object' || Array.isArray(tagsInput)) {
    throw new Error('tags must be an object');
  }

  const tagsRecord = tagsInput as Record<string, unknown>;
  const readText = (key: keyof EditableTrackTags): string => {
    const fieldValue = tagsRecord[key];
    return typeof fieldValue === 'string' ? fieldValue : '';
  };

  return {
    trackId: requireText(input.trackId, 'trackId'),
    tags: {
      title: readText('title'),
      artist: readText('artist'),
      album: readText('album'),
      albumArtist: readText('albumArtist'),
      trackNo: optionalNumber(tagsRecord.trackNo),
      discNo: optionalNumber(tagsRecord.discNo),
      year: optionalNumber(tagsRecord.year),
      genre: typeof tagsRecord.genre === 'string' && tagsRecord.genre.trim().length > 0 ? tagsRecord.genre : null,
    },
    coverPath: typeof input.coverPath === 'string' && input.coverPath.trim().length > 0 ? input.coverPath : null,
    coverUrl: typeof input.coverUrl === 'string' && input.coverUrl.trim().length > 0 ? input.coverUrl : null,
    coverMimeType: typeof input.coverMimeType === 'string' && input.coverMimeType.trim().length > 0 ? input.coverMimeType : null,
  };
};

const normalizeAlbumTagUpdateRequest = (value: unknown): LibraryAlbumTagUpdateRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('album tag update request must be an object');
  }

  const input = value as Record<string, unknown>;
  const tagsInput = input.tags;

  if (!tagsInput || typeof tagsInput !== 'object' || Array.isArray(tagsInput)) {
    throw new Error('album tags must be an object');
  }

  const tagsRecord = tagsInput as Record<string, unknown>;
  const readText = (key: keyof EditableAlbumTags): string => {
    const fieldValue = tagsRecord[key];
    return typeof fieldValue === 'string' ? fieldValue : '';
  };

  return {
    albumId: requireText(input.albumId, 'albumId'),
    tags: {
      album: readText('album'),
      albumArtist: readText('albumArtist'),
      year: optionalNumber(tagsRecord.year),
      genre: typeof tagsRecord.genre === 'string' && tagsRecord.genre.trim().length > 0 ? tagsRecord.genre : null,
    },
    coverPath: typeof input.coverPath === 'string' && input.coverPath.trim().length > 0 ? input.coverPath : null,
    coverUrl: typeof input.coverUrl === 'string' && input.coverUrl.trim().length > 0 ? input.coverUrl : null,
    coverMimeType: typeof input.coverMimeType === 'string' && input.coverMimeType.trim().length > 0 ? input.coverMimeType : null,
  };
};

const normalizeNetworkTagCandidateSearchRequest = (value: unknown): NetworkTagCandidateSearchRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { trackId: requireText(value, 'trackId') };
  }

  const input = value as Record<string, unknown>;
  const providers = Array.isArray(input.providers)
    ? input.providers.filter((provider): provider is NetworkTagProvider => typeof provider === 'string' && networkTagProviders.has(provider as NetworkTagProvider))
    : undefined;

  return {
    trackId: requireText(input.trackId, 'trackId'),
    query: typeof input.query === 'string' && input.query.trim().length > 0 ? input.query.trim() : undefined,
    providers,
  };
};

const normalizeBpmAnalysisStartOptions = (value: unknown): BpmAnalysisStartOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { limit: optionalLimit(value, 100) };
  }

  const input = value as Record<string, unknown>;
  const trackIds = Array.isArray(input.trackIds)
    ? input.trackIds.filter((trackId): trackId is string => typeof trackId === 'string' && trackId.trim().length > 0)
    : undefined;
  return {
    limit: optionalLimit(input.limit, 100),
    trackIds: trackIds?.length ? [...new Set(trackIds)] : undefined,
    force: input.force === true,
  };
};

const normalizeReplayGainAnalysisStartOptions = (value: unknown): ReplayGainAnalysisStartOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { limit: optionalLimit(value, 100) };
  }

  const input = value as Record<string, unknown>;
  const trackIds = Array.isArray(input.trackIds)
    ? input.trackIds.filter((trackId): trackId is string => typeof trackId === 'string' && trackId.trim().length > 0)
    : undefined;
  return {
    limit: optionalLimit(input.limit, 100),
    trackIds: trackIds?.length ? [...new Set(trackIds)] : undefined,
    force: input.force === true,
  };
};

const normalizeLyricsBackfillStartOptions = (value: unknown): LyricsBackfillStartOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { limit: optionalLargeLimit(value, 10000) };
  }

  const input = value as Record<string, unknown>;
  const concurrency = Number(input.concurrency);
  const autoAcceptScore = Number(input.autoAcceptScore);
  const mode = input.mode === 'complete' ? 'complete' : 'quick';
  return {
    mode,
    limit: optionalLargeLimit(input.limit, 10000),
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(24, Math.floor(concurrency))) : undefined,
    autoAcceptScore: Number.isFinite(autoAcceptScore) ? Math.max(0.3, Math.min(0.95, autoAcceptScore)) : undefined,
    force: input.force === true,
  };
};

type DroppedFilePayload = {
  name: string;
  type: string;
  path: string | null;
  bytes: Uint8Array | null;
};

const sanitizeFileName = (value: string): string => {
  const safeName = basename(value || 'dropped-audio')
    .replace(/[<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '');

  return safeName || 'dropped-audio';
};

const uniqueOutputPath = (directory: string, fileName: string): string => {
  const extension = extname(fileName);
  const baseName = fileName.slice(0, fileName.length - extension.length) || 'dropped-audio';
  let candidate = join(directory, fileName);
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = join(directory, `${baseName} (${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
};

const getImportOutputDirectory = (): string => {
  const configuredDirectory = getDownloadService().getSettings().outputDirectory;
  if (configuredDirectory && existsSync(configuredDirectory)) {
    try {
      if (statSync(configuredDirectory).isDirectory()) {
        return configuredDirectory;
      }
    } catch {
      // Fall back to the OS downloads folder below.
    }
  }

  return app.getPath('downloads');
};

const importOsuArchiveFile = async (
  service: ReturnType<typeof getLibraryService>,
  archivePath: string,
  outputDirectory: string,
  options: { deferGroupingRefresh?: boolean } = {},
): Promise<ImportAudioFilesResult['tracks'][number]> => {
  const imported = await importOsuArchiveAsMp3Queued({
    archivePath,
    outputDirectory,
  });

  return service.importAudioFile(imported.outputPath, {
    folderPath: outputDirectory,
    deferGroupingRefresh: options.deferGroupingRefresh,
    metadata: {
      title: imported.tags.title,
      artist: imported.tags.artist,
      album: imported.tags.album,
      albumArtist: imported.tags.albumArtist,
    },
  });
};

const chooseImportFiles = async (): Promise<string[] | null> => {
  const result = await dialog.showOpenDialog({
    title: '导入音乐或 osu! 谱面',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Audio and osu! beatmaps',
        extensions: [...SUPPORTED_AUDIO_DIALOG_EXTENSIONS, 'osz'],
      },
    ],
  });

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
};

const normalizeDroppedFiles = (value: unknown): DroppedFilePayload[] => {
  if (!Array.isArray(value)) {
    throw new Error('files must be an array');
  }

  return value.flatMap((item): DroppedFilePayload[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const input = item as Record<string, unknown>;
    const bytes = input.bytes;
    const path = typeof input.path === 'string' && input.path.trim() ? resolve(input.path.trim()) : null;
    const hasBytes = bytes instanceof Uint8Array && bytes.byteLength > 0;
    if (typeof input.name !== 'string' || (!path && !hasBytes)) {
      return [];
    }

    return [{
      name: input.name,
      type: typeof input.type === 'string' ? input.type : '',
      path,
      bytes: hasBytes ? bytes : null,
    }];
  });
};

const importDroppedFiles = async (value: unknown): Promise<{
  importedCount: number;
  ignoredCount: number;
  failedCount: number;
  importedTrackIds: string[];
  outputDirectory: string;
}> => {
  return runMainBackgroundTask('library-import-files', async () => {
    const outputDirectory = getImportOutputDirectory();
    const service = getLibraryService();
    const files = normalizeDroppedFiles(value);
    const importedTrackIds: string[] = [];
    let ignoredCount = 0;
    let failedCount = 0;

    mkdirSync(outputDirectory, { recursive: true });

    for (const file of files) {
      const fileName = sanitizeFileName(file.name);
      const inputPath = file.path;
      const pathForExtension = inputPath ?? fileName;
      if (isOsuArchivePath(pathForExtension)) {
        let temporaryArchivePath: string | null = null;
        try {
          const archivePath = inputPath ?? uniqueOutputPath(outputDirectory, fileName.toLowerCase().endsWith('.osz') ? fileName : `${fileName}.osz`);
          if (!inputPath) {
            temporaryArchivePath = archivePath;
            await writeFileAsync(archivePath, Buffer.from(file.bytes ?? new Uint8Array()));
          }
          const track = await importOsuArchiveFile(service, archivePath, outputDirectory, { deferGroupingRefresh: true });
          importedTrackIds.push(track.id);
        } catch {
          failedCount += 1;
        } finally {
          if (temporaryArchivePath) {
            await rmAsync(temporaryArchivePath, { force: true, maxRetries: 3, retryDelay: 50 });
          }
        }
        continue;
      }

      if (!isScannableAudioExtension(pathForExtension)) {
        ignoredCount += 1;
        continue;
      }

      const outputPath = uniqueOutputPath(outputDirectory, fileName);
      try {
        if (inputPath) {
          await copyFileAsync(inputPath, outputPath);
        } else {
          await writeFileAsync(outputPath, Buffer.from(file.bytes ?? new Uint8Array()));
        }
        const track = await service.importAudioFile(outputPath, { folderPath: outputDirectory, deferGroupingRefresh: true });
        importedTrackIds.push(track.id);
      } catch {
        failedCount += 1;
      }
    }

    return {
      importedCount: importedTrackIds.length,
      ignoredCount,
      failedCount,
      importedTrackIds,
      outputDirectory,
    };
  });
};

const addLocalAudioFilesToPlaylist = async (playlistId: string, paths: string[]): Promise<AddLocalAudioFilesToPlaylistResult> => {
  const service = getLibraryService();
  const classification = classifyImportPaths(paths);
  const osuOutputDirectory = getImportOutputDirectory();
  const trackIds: string[] = [];
  let failedCount = 0;

  for (const filePath of classification.audioFiles) {
    try {
      const track = await service.importAudioFile(filePath, { deferGroupingRefresh: true });
      trackIds.push(track.id);
    } catch {
      failedCount += 1;
    }
  }

  for (const filePath of classification.osuArchives) {
    try {
      const track = await importOsuArchiveFile(service, filePath, osuOutputDirectory, { deferGroupingRefresh: true });
      trackIds.push(track.id);
    } catch {
      failedCount += 1;
    }
  }

  const items = trackIds.length > 0 ? service.addTracksToPlaylist(playlistId, trackIds) : [];

  return {
    importedCount: trackIds.length,
    addedCount: items.length,
    skippedCount: classification.folders.length + classification.unsupportedFiles.length + classification.missingPaths.length,
    failedCount,
    trackIds,
    items,
  };
};

const importAudioFiles = async (paths: string[]): Promise<ImportAudioFilesResult> => {
  return runMainBackgroundTask('library-import-files', async () => {
    const service = getLibraryService();
    const classification = classifyImportPaths(paths);
    const osuOutputDirectory = getImportOutputDirectory();
    const tracks: ImportAudioFilesResult['tracks'] = [];
    let failedCount = 0;

    for (const filePath of classification.audioFiles) {
      try {
        tracks.push(await service.importAudioFile(filePath, { deferGroupingRefresh: true }));
      } catch {
        failedCount += 1;
      }
    }

    for (const filePath of classification.osuArchives) {
      try {
        tracks.push(await importOsuArchiveFile(service, filePath, osuOutputDirectory, { deferGroupingRefresh: true }));
      } catch {
        failedCount += 1;
      }
    }

    return {
      importedCount: tracks.length,
      skippedCount: classification.folders.length + classification.unsupportedFiles.length + classification.missingPaths.length,
      failedCount,
      trackIds: tracks.map((track) => track.id),
      tracks,
    };
  });
};

const normalizeEmbeddedTagRescanMode = (value: unknown): Exclude<LibraryScanMode, 'normal'> => {
  if (value === 'embedded-tags-all' || value === 'embedded-tags-missing-cover') {
    return value;
  }

  throw new Error('embedded tag rescan mode must be embedded-tags-all or embedded-tags-missing-cover');
};

const normalizeEmbeddedTagRescanOptions = (value: unknown): LibraryEmbeddedTagRescanOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as { folderId?: unknown; path?: unknown; recursive?: unknown };
  const options: LibraryEmbeddedTagRescanOptions = {};
  if (typeof input.folderId === 'string' && input.folderId.trim()) {
    options.folderId = input.folderId.trim();
  }
  if (typeof input.path === 'string' && input.path.trim()) {
    options.path = input.path;
  }
  if (typeof input.recursive === 'boolean') {
    options.recursive = input.recursive;
  }

  return options;
};

const normalizeScanFolderOptions = (value: unknown): Pick<LibraryScanOptions, 'reduceScanPressure'> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return (value as { reduceScanPressure?: unknown }).reduceScanPressure === true
    ? { reduceScanPressure: true }
    : {};
};

const coverMimeType = (filePath: string): string => {
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

const getExistingTrack = (trackId: unknown) => {
  const id = requireText(trackId, 'trackId');
  const track = getLibraryService().getTrack(id);

  if (!track) {
    throw new Error(`Unknown track ${id}`);
  }

  return track;
};

const renderTrackCard = async (trackId: unknown) => {
  const track = getExistingTrack(trackId);
  const asset = track.coverId ? getLibraryService().resolveCoverAsset(track.coverId, 'large') : null;

  return songCardRenderer.render({
    track,
    coverPath: asset?.filePath && existsSync(asset.filePath) ? asset.filePath : null,
    coverMimeType: asset?.mimeType ?? null,
  });
};

const getTrackOriginalCoverImage = (trackId: unknown): Electron.NativeImage | null => {
  const track = getExistingTrack(trackId);
  const asset = track.coverId ? getLibraryService().resolveCoverAsset(track.coverId, 'original') : null;

  if (!asset?.filePath || !existsSync(asset.filePath)) {
    return null;
  }

  const image = nativeImage.createFromPath(asset.filePath);
  return image.isEmpty() ? null : image;
};

const getExistingAlbum = (albumId: unknown) => {
  const id = requireText(albumId, 'albumId');
  const album = getLibraryService().getAlbum(id);

  if (!album) {
    throw new Error(`Unknown album ${id}`);
  }

  return album;
};

const getAlbumCoverImage = (albumId: unknown): { image: Electron.NativeImage; suggestedFileName: string } | null => {
  const album = getExistingAlbum(albumId);
  const asset = album.coverId ? getLibraryService().resolveCoverAsset(album.coverId, 'large') ?? getLibraryService().resolveCoverAsset(album.coverId, 'album') : null;

  if (!asset?.filePath || !existsSync(asset.filePath)) {
    return null;
  }

  const image = nativeImage.createFromPath(asset.filePath);
  if (image.isEmpty()) {
    return null;
  }

  return {
    image,
    suggestedFileName: `${safeExportFileName(`${album.title} - ${album.albumArtist}`)}.png`,
  };
};

const getAlbumOriginalCoverImage = (albumId: unknown): Electron.NativeImage | null => {
  const album = getExistingAlbum(albumId);
  const asset = album.coverId ? getLibraryService().resolveCoverAsset(album.coverId, 'original') : null;

  if (!asset?.filePath || !existsSync(asset.filePath)) {
    return null;
  }

  const image = nativeImage.createFromPath(asset.filePath);
  return image.isEmpty() ? null : image;
};

const safeExportFileName = (name: string): string => {
  const cleaned = Array.from(name, (character) =>
    /[<>:"/\\|?*]/u.test(character) || character.charCodeAt(0) <= 0x1f ? ' ' : character,
  )
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return (cleaned || 'Playlist').slice(0, 120);
};

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

const playlistTrackExportRow = (item: LibraryPlaylistItem) => {
  const track = item.track;
  const streamUrl = item.sourceProvider === 'm3u8' && item.sourceItemId ? decodeM3u8ProviderTrackId(item.sourceItemId) : '';
  return {
    title: item.titleSnapshot ?? track?.title ?? item.album?.title ?? 'Unavailable track',
    artist: item.artistSnapshot ?? track?.artist ?? item.album?.albumArtist ?? 'Unknown artist',
    album: item.albumSnapshot ?? track?.album ?? item.album?.title ?? '',
    duration: item.durationSnapshot ?? track?.duration ?? item.album?.duration ?? 0,
    path: item.mediaType === 'track' && track && !item.unavailable ? track.path : streamUrl,
    provider: item.sourceProvider,
    sourceItemId: item.sourceItemId,
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    unavailable: item.unavailable,
  };
};

const buildPlaylistExportContent = (
  playlist: LibraryPlaylist,
  items: LibraryPlaylistItem[],
  format: PlaylistExportFormat,
): string => {
  const exportedAt = new Date().toISOString();
  const tracks = items.map(playlistTrackExportRow);

  switch (format) {
    case 'json':
      return `${JSON.stringify(
        {
          playlist: {
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            sourceProvider: playlist.sourceProvider,
            sourcePlaylistId: playlist.sourcePlaylistId,
            sortMode: playlist.sortMode,
            itemCount: playlist.itemCount,
            createdAt: playlist.createdAt,
            updatedAt: playlist.updatedAt,
          },
          exportedAt,
          tracks,
        },
        null,
        2,
      )}\n`;
    case 'txt':
      return [
        playlist.name,
        `${tracks.length} tracks`,
        `Exported at ${exportedAt}`,
        '',
        ...tracks.map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`),
      ].join('\n') + '\n';
    case 'm3u8':
      return [
        '#EXTM3U',
        `#PLAYLIST:${playlist.name}`,
        ...tracks.flatMap((track) => {
          const title = `${track.title} - ${track.artist}`;
          if (track.path && !track.unavailable) {
            return [`#EXTINF:${Math.round(track.duration || -1)},${title}`, track.path];
          }

          return [`# ${title} (${track.provider}${track.sourceItemId ? `:${track.sourceItemId}` : ''})`];
        }),
      ].join('\n') + '\n';
    case 'csv':
      return [
        ['title', 'artist', 'album', 'duration', 'path', 'provider', 'sourceItemId', 'unavailable'].join(','),
        ...tracks.map((track) =>
          [
            track.title,
            track.artist,
            track.album,
            track.duration,
            track.path,
            track.provider,
            track.sourceItemId,
            track.unavailable,
          ].map(csvCell).join(','),
        ),
      ].join('\n') + '\n';
    default:
      return '';
  }
};

const playlistExportFilter = (format: PlaylistExportFormat): Electron.FileFilter[] => {
  switch (format) {
    case 'json':
      return [{ name: 'JSON Playlist', extensions: ['json'] }];
    case 'txt':
      return [{ name: 'Text Playlist', extensions: ['txt'] }];
    case 'm3u8':
      return [{ name: 'M3U8 Playlist', extensions: ['m3u8'] }];
    case 'csv':
      return [{ name: 'CSV Playlist', extensions: ['csv'] }];
    default:
      return [];
  }
};

const likedExportSourceLabels: Partial<Record<NonNullable<LibraryPageQuery['sourceProvider']>, string>> = {
  local: '本地',
  netease: '网易云',
  qqmusic: 'QQ音乐',
};

const exportPlaylist = async (request: unknown): Promise<string | null> => {
  const { playlistId, format, sourceProvider } = normalizeExportPlaylistRequest(request);
  const service = getLibraryService();
  const playlist = service.getPlaylist(playlistId);

  if (!playlist) {
    throw new Error(`Unknown playlist ${playlistId}`);
  }

  if (sourceProvider) {
    const likedSongsPlaylistId = service.getLikedSongsPlaylist().id;
    if (playlistId !== likedSongsPlaylistId) {
      throw new Error('sourceProvider export filtering is only supported for liked songs');
    }
  }

  const items: LibraryPlaylistItem[] = [];
  let page = 1;
  const pageSize = 500;
  for (;;) {
    const result = sourceProvider
      ? service.getLikedTracks({ page, pageSize, sourceProvider })
      : service.getPlaylistItems(playlistId, { page, pageSize });
    items.push(...result.items);
    if (!result.hasMore) {
      break;
    }
    page += 1;
  }

  const result = await dialog.showSaveDialog({
    title: '导出歌单',
    defaultPath: `${safeExportFileName(sourceProvider ? `${playlist.name} - ${likedExportSourceLabels[sourceProvider] ?? sourceProvider}` : playlist.name)}.${format}`,
    filters: playlistExportFilter(format),
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  writeFileSync(result.filePath, buildPlaylistExportContent(playlist, items, format), 'utf8');
  return result.filePath;
};

const importPlaylistFile = async (): Promise<ImportPlaylistFileResult | null> => {
  const result = await dialog.showOpenDialog({
    title: '导入 M3U8 歌单',
    properties: ['openFile'],
    filters: [{ name: 'M3U/M3U8 Playlist', extensions: ['m3u8', 'm3u'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const filePath = result.filePaths[0];
  const content = readFileSync(filePath, 'utf8');
  const localPlaylist = parseLocalM3uPlaylistFile(filePath, content);
  const localClassification = classifyImportPaths(localPlaylist.paths);

  if (localClassification.audioFiles.length > 0 || localClassification.osuArchives.length > 0) {
    const service = getLibraryService();
    const playlist = service.createPlaylist({ name: localPlaylist.title });
    const imported = await addLocalAudioFilesToPlaylist(playlist.id, localPlaylist.paths);
    return {
      playlistId: playlist.id,
      playlistName: playlist.name,
      importedCount: imported.addedCount,
      filePath,
    };
  }

  if (localPlaylist.paths.length > 0 && !localPlaylist.hasRemoteUrls) {
    throw new Error('The selected playlist did not contain any existing supported audio files.');
  }

  const imported = await getStreamingService().importM3u8PlaylistFile(filePath, content);
  return {
    playlistId: imported.playlistId,
    playlistName: imported.playlistName,
    importedCount: imported.importedCount,
    filePath,
  };
};

export const registerLibraryIpc = (): void => {
  ipcMain.handle(IpcChannels.LibraryChooseFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择音乐文件夹',
      properties: ['openDirectory'],
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IpcChannels.LibraryAddFolder, (_event, folderPath: unknown) =>
    getLibraryService().addFolder(requireText(folderPath, 'folderPath')),
  );
  ipcMain.handle(IpcChannels.LibraryClassifyImportPaths, (_event, paths: unknown) =>
    classifyImportPaths(normalizePathList(paths)),
  );
  ipcMain.handle(IpcChannels.LibraryChooseImportFiles, () => chooseImportFiles());
  ipcMain.handle(IpcChannels.LibraryImportDroppedFiles, (_event, files: unknown) => importDroppedFiles(files));
  ipcMain.handle(IpcChannels.LibraryImportAudioFiles, (_event, paths: unknown) => importAudioFiles(normalizePathList(paths)));
  ipcMain.handle(IpcChannels.LibraryGetFolders, () => getLibraryService().getFolders());
  ipcMain.handle(IpcChannels.LibraryGetFolderOverviews, () => getLibraryService().getFolderOverviews());
  ipcMain.handle(IpcChannels.LibraryGetFolderChildren, (_event, query: unknown) =>
    getLibraryService().getFolderChildren(normalizeFolderChildrenQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetFolderTracks, (_event, query: unknown) =>
    getLibraryService().getFolderTracks(normalizeFolderTracksQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryOpenLibraryFolderPath, async (_event, request: unknown): Promise<void> => {
    const result = await shell.openPath(getLibraryService().resolveLibraryFolderPath(normalizeFolderPathRequest(request)));

    if (result) {
      throw new Error(result);
    }
  });
  ipcMain.handle(IpcChannels.LibraryRemoveFolder, (_event, folderId: unknown) =>
    getLibraryService().removeFolder(requireText(folderId, 'folderId')),
  );
  ipcMain.handle(IpcChannels.LibraryScanFolder, (_event, folderId: unknown, options: unknown) =>
    getLibraryService().scanFolder(requireText(folderId, 'folderId'), normalizeScanFolderOptions(options)),
  );
  ipcMain.handle(IpcChannels.LibraryScanFolderChanges, (_event, folderId: unknown) =>
    getLibraryService().scanFolderChanges(requireText(folderId, 'folderId')),
  );
  ipcMain.handle(IpcChannels.LibraryRescanEmbeddedTags, (_event, mode: unknown, options: unknown) =>
    getLibraryService().rescanEmbeddedTags(normalizeEmbeddedTagRescanMode(mode), normalizeEmbeddedTagRescanOptions(options)),
  );
  ipcMain.handle(IpcChannels.LibraryGetScanStatus, (_event, jobId: unknown) =>
    getLibraryService().getScanStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryCancelScan, (_event, jobId: unknown) =>
    getLibraryService().cancelScan(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetTrack, (_event, trackId: unknown) =>
    getLibraryService().getTrack(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetTracks, (_event, query: unknown) =>
    getLibraryService().getTracks(normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetQualityOverview, () =>
    getLibraryService().getLibraryQualityOverview(),
  );
  ipcMain.handle(IpcChannels.LibraryGetQualityIssues, (_event, query: unknown) =>
    getLibraryService().getLibraryQualityIssues(normalizeLibraryQualityIssueQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetInboxBatches, () => getLibraryService().getLibraryInboxBatches());
  ipcMain.handle(IpcChannels.LibraryGetInboxTracks, (_event, query: unknown) =>
    getLibraryService().getLibraryInboxTracks(normalizeLibraryInboxTrackQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryCreateInboxPlaylist, (_event, request: unknown) =>
    getLibraryService().createPlaylistFromLibraryInbox(normalizeLibraryInboxPlaylistRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryAddInboxToQueue, (_event, query: unknown) =>
    getLibraryService().getLibraryInboxQueueTracks(normalizeLibraryInboxTrackQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryUpdateInboxItemState, (_event, request: unknown) =>
    getLibraryService().updateLibraryInboxItemState(normalizeLibraryInboxUpdateStateRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryGetHealthReport, () => createLibraryHealthReportForRenderer());
  ipcMain.handle(IpcChannels.LibraryExportHealthReport, async (): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: '导出曲库体检报告',
      defaultPath: join(app.getPath('downloads'), `echo-library-health-${formatReportTimestamp()}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return writeLibraryHealthReportMarkdown(await createLibraryHealthReportForRenderer(), result.filePath);
  });
  ipcMain.handle(IpcChannels.LibraryRefreshDuplicateTracks, (_event, mode: unknown) =>
    getLibraryService().refreshDuplicateTracksPlaybackSafe(normalizeDuplicateMode(mode)),
  );
  ipcMain.handle(IpcChannels.LibraryGetDuplicateTrackVersions, (_event, trackId: unknown) =>
    getLibraryService().getDuplicateTrackVersions(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetDuplicateHiddenCounts, (_event, trackIds: unknown, mode: unknown) => {
    const normalizedTrackIds = normalizeTrackIds(trackIds);
    try {
      return getLibraryService().getDuplicateHiddenCounts(normalizedTrackIds, normalizeDuplicateMode(mode));
    } catch (error) {
      if (error instanceof LibraryDatabaseUnavailableError) {
        return Object.fromEntries(normalizedTrackIds.map((trackId) => [trackId, 0]));
      }
      throw error;
    }
  });
  ipcMain.handle(IpcChannels.LibraryGetDuplicateIndexSummary, (_event, mode: unknown) => {
    const duplicateMode = normalizeDuplicateMode(mode);
    try {
      return getLibraryService().getDuplicateIndexSummary(duplicateMode);
    } catch (error) {
      if (error instanceof LibraryDatabaseUnavailableError) {
        return emptyDuplicateIndexSummary(duplicateMode);
      }
      throw error;
    }
  });
  ipcMain.handle(IpcChannels.LibraryPreviewDuplicateTrackCleanup, (_event, mode: unknown) => {
    assertNoRunningLibraryScan();
    return getLibraryService().previewDuplicateTrackCleanup(normalizeDuplicateMode(mode));
  });
  ipcMain.handle(IpcChannels.LibraryApplyDuplicateTrackCleanup, async (_event, request: unknown): Promise<DuplicateTrackCleanupResult> => {
    assertNoRunningLibraryScan();
    const { trackIds, mode } = normalizeDuplicateTrackCleanupRequest(request);
    const service = getLibraryService();
    const preview = service.getDuplicateTrackCleanupPreview(mode);
    const candidates = new Map(
      preview.groups.flatMap((group) => group.remove.map((member) => [member.track.id, member] as const)),
    );
    const invalidIds = trackIds.filter((trackId) => !candidates.has(trackId));

    if (invalidIds.length > 0) {
      throw new Error(`重复歌曲清理请求已过期或包含保留曲目，请重新扫描后再清理：${invalidIds.slice(0, 5).join(', ')}`);
    }

    const removedTrackIds: string[] = [];
    const failedTracks: DuplicateTrackCleanupFailure[] = [];
    let trashedTracks = 0;
    let missingFiles = 0;
    let totalBytesRequested = 0;

    for (const trackId of trackIds) {
      const member = candidates.get(trackId)!;
      totalBytesRequested += member.sizeBytes ?? 0;

      try {
        if (existsSync(member.track.path)) {
          await shell.trashItem(member.track.path);
          trashedTracks += 1;
        } else {
          missingFiles += 1;
        }
        removedTrackIds.push(trackId);
      } catch (error) {
        failedTracks.push({
          trackId,
          title: member.track.title,
          path: member.track.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const removedFromLibrary = service.deleteTracks(removedTrackIds);
    const updatedSummary = await service.refreshDuplicateTracksAsync(mode);

    return {
      requestedTrackIds: trackIds.length,
      trashedTracks,
      missingFiles,
      removedFromLibrary,
      failedTracks,
      totalBytesRequested,
      updatedSummary,
    };
  });
  ipcMain.handle(IpcChannels.LibraryGetPlaylists, () => getLibraryService().getPlaylists());
  ipcMain.handle(IpcChannels.LibraryCreatePlaylist, (_event, request: unknown) =>
    getLibraryService().createPlaylist(normalizeCreatePlaylistRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryUpdatePlaylist, (_event, request: unknown) =>
    getLibraryService().updatePlaylistArtwork(normalizeUpdatePlaylistRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryDeletePlaylist, (_event, playlistId: unknown) =>
    getLibraryService().deletePlaylist(requireText(playlistId, 'playlistId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetPlaylist, (_event, playlistId: unknown) =>
    getLibraryService().getPlaylist(requireText(playlistId, 'playlistId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetPlaylistItems, (_event, playlistId: unknown, query: unknown) =>
    getLibraryService().getPlaylistItems(requireText(playlistId, 'playlistId'), normalizePlaylistItemsQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryImportPlaylistFile, () => importPlaylistFile());
  ipcMain.handle(IpcChannels.LibraryExportPlaylist, (_event, request: unknown) => exportPlaylist(request));
  ipcMain.handle(IpcChannels.LibraryAddTrackToPlaylist, (_event, playlistId: unknown, trackId: unknown) =>
    getLibraryService().addTrackToPlaylist(requireText(playlistId, 'playlistId'), requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryAddStreamingTrackToPlaylist, (_event, playlistId: unknown, track: unknown) =>
    getLibraryService().addStreamingTrackToPlaylist(requireText(playlistId, 'playlistId'), normalizeStreamingPlaylistTrack(track)),
  );
  ipcMain.handle(IpcChannels.LibraryAddTracksToPlaylist, (_event, playlistId: unknown, trackIds: unknown) =>
    getLibraryService().addTracksToPlaylist(requireText(playlistId, 'playlistId'), normalizeTrackIds(trackIds)),
  );
  ipcMain.handle(IpcChannels.LibraryAddLocalAudioFilesToPlaylist, (_event, playlistId: unknown, paths: unknown) =>
    addLocalAudioFilesToPlaylist(requireText(playlistId, 'playlistId'), normalizePathList(paths)),
  );
  ipcMain.handle(IpcChannels.LibraryRemovePlaylistItem, (_event, itemId: unknown) =>
    getLibraryService().removePlaylistItem(requireText(itemId, 'itemId')),
  );
  ipcMain.handle(IpcChannels.LibraryMovePlaylistItem, (_event, playlistId: unknown, itemId: unknown, targetPosition: unknown) =>
    getLibraryService().movePlaylistItem(
      requireText(playlistId, 'playlistId'),
      requireText(itemId, 'itemId'),
      normalizeTargetPosition(targetPosition),
    ),
  );
  ipcMain.handle(IpcChannels.LibraryClearPlaylist, (_event, playlistId: unknown) =>
    getLibraryService().clearPlaylist(requireText(playlistId, 'playlistId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetLikedSongsPlaylist, () => getLibraryService().getLikedSongsPlaylist());
  ipcMain.handle(IpcChannels.LibraryGetLikedAlbumsPlaylist, () => getLibraryService().getLikedAlbumsPlaylist());
  ipcMain.handle(IpcChannels.LibraryGetLikedTracks, (_event, query: unknown) =>
    getLibraryService().getLikedTracks(normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetLikedAlbums, (_event, query: unknown) =>
    getLibraryService().getLikedAlbums(normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryIsTrackLiked, (_event, trackId: unknown) =>
    getLibraryService().isTrackLiked(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryIsAlbumLiked, (_event, albumId: unknown) =>
    getLibraryService().isAlbumLiked(requireText(albumId, 'albumId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetLikedTrackIds, (_event, trackIds: unknown) =>
    getLibraryService().getLikedTrackIds(normalizeTrackIds(trackIds)),
  );
  ipcMain.handle(IpcChannels.LibraryGetLikedAlbumIds, (_event, albumIds: unknown) =>
    getLibraryService().getLikedAlbumIds(normalizeAlbumIds(albumIds)),
  );
  ipcMain.handle(IpcChannels.LibraryLikeTrack, (_event, trackId: unknown) =>
    getLibraryService().likeTrack(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryUnlikeTrack, (_event, trackId: unknown) =>
    getLibraryService().unlikeTrack(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryToggleTrackLiked, (_event, trackId: unknown) =>
    getLibraryService().toggleTrackLiked(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryLikeAlbum, (_event, albumId: unknown) =>
    getLibraryService().likeAlbum(requireText(albumId, 'albumId')),
  );
  ipcMain.handle(IpcChannels.LibraryUnlikeAlbum, (_event, albumId: unknown) =>
    getLibraryService().unlikeAlbum(requireText(albumId, 'albumId')),
  );
  ipcMain.handle(IpcChannels.LibraryToggleAlbumLiked, (_event, albumId: unknown) =>
    getLibraryService().toggleAlbumLiked(requireText(albumId, 'albumId')),
  );
  ipcMain.handle(IpcChannels.LibraryClearLikedTracks, (_event, query: unknown) =>
    getLibraryService().clearLikedTracks(normalizeQuery(query).sourceProvider),
  );
  ipcMain.handle(IpcChannels.LibraryClearLikedAlbums, (_event, query: unknown) =>
    getLibraryService().clearLikedAlbums(normalizeQuery(query).sourceProvider),
  );
  ipcMain.handle(IpcChannels.LibraryGetAlbums, (_event, query: unknown) =>
    getLibraryService().getAlbums(normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetAlbum, (_event, albumId: unknown) =>
    getLibraryService().getAlbum(requireText(albumId, 'albumId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetAlbumOnlineInfo, (_event, albumId: unknown, options: unknown) =>
    getLibraryService().getAlbumOnlineInfo(requireText(albumId, 'albumId'), {
      force: Boolean(options && typeof options === 'object' && (options as { force?: unknown }).force === true),
      provider:
        options && typeof options === 'object' &&
        ((options as { provider?: unknown }).provider === 'musicbrainz' || (options as { provider?: unknown }).provider === 'wikipedia')
          ? (options as { provider: 'musicbrainz' | 'wikipedia' }).provider
          : undefined,
    }),
  );
  ipcMain.handle(IpcChannels.LibraryGetAlbumForTrack, (_event, trackId: unknown) =>
    getLibraryService().getAlbumForTrack(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetArtists, (_event, query: unknown) =>
    getLibraryService().getArtists(normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetArtist, (_event, artistId: unknown) =>
    getLibraryService().getArtist(requireText(artistId, 'artistId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetArtistInsights, (_event, artistId: unknown, options: unknown) =>
    getLibraryService().getArtistInsights(requireText(artistId, 'artistId'), {
      limit: options && typeof options === 'object' && typeof (options as { limit?: unknown }).limit === 'number'
        ? (options as { limit: number }).limit
        : undefined,
      includeOnline: Boolean(options && typeof options === 'object' && (options as { includeOnline?: unknown }).includeOnline === true),
      forceOnline: Boolean(options && typeof options === 'object' && (options as { forceOnline?: unknown }).forceOnline === true),
      region: options && typeof options === 'object' && typeof (options as { region?: unknown }).region === 'string'
        ? (options as { region: string }).region
        : null,
    }),
  );
  ipcMain.handle(IpcChannels.LibraryGetArtistTracks, (_event, artistId: unknown, query: unknown) =>
    getLibraryService().getArtistTracks(requireText(artistId, 'artistId'), normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetArtistAlbums, (_event, artistId: unknown, query: unknown) =>
    getLibraryService().getArtistAlbums(requireText(artistId, 'artistId'), normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryArtistImagesEnqueueMissing, (_event, request: unknown) => {
    const normalized = normalizeArtistImagesEnqueueRequest(request);
    return getLibraryService().enqueueMissingArtistImages(normalized.artists, {
      force: normalized.force,
      limit: normalized.limit,
    });
  });
  ipcMain.handle(IpcChannels.LibraryArtistImagesRefreshOne, (_event, request: unknown) => {
    const normalized = normalizeArtistImageRefreshOneRequest(request);
    return getLibraryService().refreshArtistImage(normalized.artistIdOrKey, normalized.force);
  });
  ipcMain.handle(IpcChannels.LibraryArtistImagesRefreshVisible, (_event, artists: unknown) =>
    getLibraryService().refreshVisibleArtistImages(normalizeArtistImageInputs(artists)),
  );
  ipcMain.handle(IpcChannels.LibraryArtistImagesGetStatus, (_event, artistIdOrKey: unknown) =>
    getLibraryService().getArtistImage(requireText(artistIdOrKey, 'artistId')),
  );
  ipcMain.handle(IpcChannels.LibraryArtistImagesGetSummary, () => getLibraryService().getArtistImageCacheSummary());
  ipcMain.handle(IpcChannels.LibraryArtistImagesGetJobStatus, () => getLibraryService().getArtistImageJobStatus());
  ipcMain.handle(IpcChannels.LibraryArtistImagesSetPaused, (_event, paused: unknown) =>
    getLibraryService().setArtistImageJobsPaused(paused === true),
  );
  ipcMain.handle(IpcChannels.LibraryArtistImagesKickoff, (_event, options: unknown) =>
    getLibraryService().kickoffArtistImageBackfill(normalizeArtistImageBackfillOptions(options)),
  );
  ipcMain.handle(IpcChannels.LibraryArtistImagesClearCache, () => getLibraryService().clearArtistImageCache());
  ipcMain.handle(IpcChannels.LibraryArtistImagesChooseCustom, async (_event, artistIdOrKey: unknown) => {
    const result = await dialog.showOpenDialog({
      title: '设置艺术家头像',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'webp'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getLibraryService().setCustomArtistImageFromFile(requireText(artistIdOrKey, 'artistId'), result.filePaths[0]);
  });
  ipcMain.handle(IpcChannels.LibraryArtistImagesSetCustomUrl, (_event, request: unknown) => {
    const normalized = normalizeArtistImageCustomUrlRequest(request);
    return getLibraryService().setCustomArtistImageFromUrl(normalized.artistIdOrKey, normalized.url);
  });
  ipcMain.handle(IpcChannels.LibraryArtistImagesClearCustom, (_event, artistIdOrKey: unknown) =>
    getLibraryService().clearCustomArtistImage(requireText(artistIdOrKey, 'artistId')),
  );
  ipcMain.handle(IpcChannels.LibraryArtistOnlineInfoClearCache, () => getLibraryService().clearArtistOnlineInfoCache());
  ipcMain.handle(IpcChannels.LibraryGetAlbumTracks, (_event, albumId: unknown, query: unknown) =>
    getLibraryService().getAlbumTracks(requireText(albumId, 'albumId'), normalizeQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetSummary, () => getLibraryService().getSummary());
  ipcMain.handle(IpcChannels.LibraryRefreshAlbumGrouping, () => getLibraryService().refreshAlbumGrouping());
  ipcMain.handle(IpcChannels.LibraryGetDiagnostics, () => getLibraryService().getDiagnostics());
  ipcMain.handle(IpcChannels.LibraryGetMoveCandidates, (_event, options: unknown) =>
    getLibraryService().getMoveCandidates(
      options && typeof options === 'object' && !Array.isArray(options)
        ? { limit: typeof (options as { limit?: unknown }).limit === 'number' ? (options as { limit: number }).limit : undefined }
        : {},
    ),
  );
  ipcMain.handle(IpcChannels.LibraryLabGetState, () => getLibraryService().getLibraryLabState());
  ipcMain.handle(IpcChannels.LibraryLabSetWatcherEnabled, (_event, enabled: unknown) =>
    getLibraryService().setLibraryLabWatcherEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LibraryLabSetAutoRescanEnabled, (_event, enabled: unknown) =>
    getLibraryService().setLibraryLabAutoRescanEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LibraryLabSetMoveCandidateEnabled, (_event, enabled: unknown) =>
    getLibraryService().setLibraryLabMoveCandidateEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LibraryLabSetMoveRepairLabEnabled, (_event, enabled: unknown) =>
    getLibraryService().setLibraryLabMoveRepairLabEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LibraryLabStartWatcher, () => getLibraryService().startLibraryLabWatcher());
  ipcMain.handle(IpcChannels.LibraryLabStopWatcher, () => getLibraryService().stopLibraryLabWatcher());
  ipcMain.handle(IpcChannels.LibraryLabRefreshDiagnostics, () => getLibraryService().refreshLibraryLabDiagnostics());
  ipcMain.handle(IpcChannels.LibraryLabBackfillPlaceholderMetadata, () => getLibraryService().backfillLibraryLabPlaceholderMetadata());
  ipcMain.handle(IpcChannels.LibraryLabGetMoveCandidates, (_event, options: unknown) =>
    getLibraryService().getLibraryLabMoveCandidates(
      options && typeof options === 'object' && !Array.isArray(options)
        ? { limit: typeof (options as { limit?: unknown }).limit === 'number' ? (options as { limit: number }).limit : undefined }
        : {},
    ),
  );
  ipcMain.handle(IpcChannels.LibraryLabDryRunMoveRepair, (_event, candidateId: unknown) =>
    getLibraryService().dryRunLibraryLabMoveRepair(requireText(candidateId, 'candidateId')),
  );
  ipcMain.handle(IpcChannels.LibraryLabApplyMoveRepair, (_event, candidateId: unknown) =>
    getLibraryService().applyLibraryLabMoveRepair(requireText(candidateId, 'candidateId')),
  );
  ipcMain.handle(IpcChannels.LibraryChooseTrackCover, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择封面',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });

    if (result.canceled) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!filePath) {
      return null;
    }

    const mimeType = coverMimeType(filePath);
    const dataUrl = `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}`;
    return { path: filePath, mimeType, dataUrl };
  });
  ipcMain.handle(IpcChannels.LibraryLoadEmbeddedTrackTags, (_event, trackId: unknown) =>
    getLibraryService().loadEmbeddedTrackTags(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryUpdateTrackTags, (_event, request: unknown) =>
    getLibraryService().updateTrackTags(normalizeTagUpdateRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryUpdateAlbumTags, (_event, request: unknown) =>
    getLibraryService().updateAlbumTags(normalizeAlbumTagUpdateRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryRecordTrackPlayback, (_event, trackId: unknown) =>
    getLibraryService().recordTrackPlayback(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetPlaybackHistory, (_event, query: unknown) =>
    getLibraryService().getPlaybackHistory(normalizePlaybackHistoryQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetPlaybackHistorySummary, (_event, query: unknown) =>
    getLibraryService().getPlaybackHistorySummary(normalizePlaybackHistoryQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryGetPlaybackStatsDashboard, (_event, query: unknown) =>
    getLibraryService().getPlaybackStatsDashboardPlaybackSafe(normalizePlaybackHistoryQuery(query)),
  );
  ipcMain.handle(IpcChannels.LibraryRefreshInvalidPlaybackHistory, () =>
    getLibraryService().refreshInvalidPlaybackHistory(),
  );
  ipcMain.handle(IpcChannels.LibraryDeletePlaybackHistoryEntry, (_event, id: unknown) =>
    getLibraryService().deletePlaybackHistoryEntry(requireText(id, 'historyId')),
  );
  ipcMain.handle(IpcChannels.LibraryClearPlaybackHistory, () => getLibraryService().clearPlaybackHistory());
  ipcMain.handle(IpcChannels.LibraryStartPlaybackHistory, (_event, request: unknown) =>
    getLibraryService().startPlaybackHistory(normalizeStartPlaybackHistoryRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryFinishPlaybackHistory, (_event, request: unknown) =>
    getLibraryService().finishPlaybackHistory(normalizeFinishPlaybackHistoryRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryOpenTrackInFolder, (_event, trackId: unknown): void => {
    shell.showItemInFolder(getExistingTrack(trackId).path);
  });
  ipcMain.handle(IpcChannels.LibraryOpenPathInFolder, (_event, filePath: unknown): void => {
    shell.showItemInFolder(resolve(requireText(filePath, 'filePath')));
  });
  ipcMain.handle(IpcChannels.LibraryOpenTrackWithSystem, async (_event, trackId: unknown): Promise<void> => {
    const result = await shell.openPath(getExistingTrack(trackId).path);

    if (result) {
      throw new Error(result);
    }
  });
  ipcMain.handle(IpcChannels.LibraryCopyTrackPath, (_event, trackId: unknown): void => {
    clipboard.writeText(getExistingTrack(trackId).path);
  });
  ipcMain.handle(IpcChannels.LibraryCopyTrackNameArtist, (_event, trackId: unknown): void => {
    const track = getExistingTrack(trackId);
    clipboard.writeText(`${track.title} - ${track.artist}`);
  });
  ipcMain.handle(IpcChannels.LibraryCopyTrackCover, async (_event, trackId: unknown): Promise<boolean> => {
    const card = await renderTrackCard(trackId);
    const image = nativeImage.createFromBuffer(card.pngBuffer);
    if (image.isEmpty()) {
      return false;
    }

    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle(IpcChannels.LibraryCopyTrackOriginalCover, (_event, trackId: unknown): boolean => {
    const image = getTrackOriginalCoverImage(trackId);
    if (!image) {
      return false;
    }

    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle(IpcChannels.LibrarySaveTrackCover, async (_event, trackId: unknown): Promise<string | null> => {
    const card = await renderTrackCard(trackId);
    const result = await dialog.showSaveDialog({
      title: '保存歌曲卡片图片',
      defaultPath: card.suggestedFileName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    writeFileSync(result.filePath, card.pngBuffer);
    return result.filePath;
  });
  ipcMain.handle(IpcChannels.LibraryDeleteTrackFile, async (_event, trackId: unknown): Promise<void> => {
    const track = getExistingTrack(trackId);

    if (existsSync(track.path)) {
      await shell.trashItem(track.path);
    }

    getLibraryService().deleteTrack(track.id);
  });
  ipcMain.handle(IpcChannels.LibraryCopyAlbumInfo, (_event, albumId: unknown): void => {
    const album = getExistingAlbum(albumId);
    clipboard.writeText(`${album.title} - ${album.albumArtist}`);
  });
  ipcMain.handle(IpcChannels.LibraryCopyAlbumCover, (_event, albumId: unknown): boolean => {
    const image = getAlbumOriginalCoverImage(albumId);
    if (!image) {
      return false;
    }

    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle(IpcChannels.LibrarySaveAlbumCover, async (_event, albumId: unknown): Promise<string | null> => {
    const cover = getAlbumCoverImage(albumId);
    if (!cover) {
      return null;
    }

    const result = await dialog.showSaveDialog({
      title: '保存专辑封面',
      defaultPath: cover.suggestedFileName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    writeFileSync(result.filePath, cover.image.toPNG());
    return result.filePath;
  });
  ipcMain.handle(IpcChannels.LibraryDeleteAlbumFiles, async (_event, albumId: unknown): Promise<void> => {
    const id = requireText(albumId, 'albumId');
    getExistingAlbum(id);
    const tracks = getLibraryService().getAllAlbumTracks(id);

    for (const track of tracks) {
      if (existsSync(track.path)) {
        await shell.trashItem(track.path);
      }
    }

    getLibraryService().deleteAlbumTracks(id);
  });
  ipcMain.handle(IpcChannels.LibraryPruneMissingTracks, () => getLibraryService().pruneMissingTracks());
  ipcMain.handle(IpcChannels.LibraryPruneInvalidTracks, () => getLibraryService().pruneInvalidTracks());
  ipcMain.handle(IpcChannels.LibraryClearTracks, () => getLibraryService().clearTracks());
  ipcMain.handle(IpcChannels.LibraryClearCache, () => getLibraryService().clearCache());
  ipcMain.handle(IpcChannels.LibraryGetDatabaseProtectionStatus, (_event, options: unknown) =>
    getDatabaseProtectionStatusForRenderer(normalizeDatabaseProtectionStatusOptions(options)),
  );
  ipcMain.handle(IpcChannels.LibraryCreateDatabaseSnapshot, async () => {
    assertNoRunningLibraryScan();
    if (getAppSettings().dataProtectionDisabled === true) {
      throw new Error('data-protection is disabled in Settings');
    }
    const manager = getLibraryDatabaseManager();
    const status = await manager.runExclusiveMaintenance('manual-library-database-snapshot', async () => {
      closeLibraryDatabaseUsers();
      return createManualLibraryDatabaseSnapshot(app.getPath('userData'));
    });
    return {
      ...status,
      managerState: manager.getState(),
    };
  });
  ipcMain.handle(IpcChannels.LibraryRestoreDatabaseSnapshot, (_event, snapshotId: unknown) => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-restore', () => {
      closeLibraryDatabaseUsers();
      return restoreProtectedLibraryDatabaseSnapshot(requireText(snapshotId, 'snapshotId'), app.getPath('userData'));
    });
  });
  ipcMain.handle(IpcChannels.LibraryScrubQuarantinedDatabase, () => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-scrub-quarantined', () => {
      closeLibraryDatabaseUsers();
      return scrubQuarantinedLibraryDatabase(app.getPath('userData'));
    });
  });
  ipcMain.handle(IpcChannels.LibraryDiscardQuarantinedProblemTracks, () => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-discard-quarantined-problem-tracks', () => {
      closeLibraryDatabaseUsers();
      return discardQuarantinedProblemTracks(app.getPath('userData'));
    });
  });
  ipcMain.handle(IpcChannels.LibraryRelaunchRecoveryMode, () =>
    getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-relaunch-recovery-mode', () => {
      closeLibraryDatabaseUsers();
      return scheduleLibraryRecoveryRelaunch();
    }),
  );
  ipcMain.handle(IpcChannels.LibraryOpenDataProtectionFolder, async () => {
    const status = getDatabaseProtectionStatusForRenderer();
    mkdirSync(status.dataProtectionPath, { recursive: true });
    const errorMessage = await shell.openPath(status.dataProtectionPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
  ipcMain.handle(IpcChannels.LibraryRepairDatabase, () => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-repair', () => {
      closeLibraryDatabaseUsers();
      return repairProtectedLibraryDatabase(app.getPath('userData'));
    });
  });
  ipcMain.handle(IpcChannels.LibraryDeleteDatabase, () => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-library-database-delete', () => {
      closeLibraryDatabaseUsers();
      return deleteProtectedLibraryDatabase(app.getPath('userData'));
    });
  });
  ipcMain.handle(IpcChannels.LibraryDeleteAllUserData, () => {
    assertNoRunningLibraryScan();
    return getLibraryDatabaseManager().runExclusiveMaintenance('manual-delete-all-user-data', async () => {
      const coverCachePath = resolveCoverCachePathForWipe();
      closeLibraryDatabaseUsers();
      getDownloadService().dispose();
      return deleteAllUserData(coverCachePath);
    });
  });
  ipcMain.handle(IpcChannels.LibraryNetworkRepairMissingMetadata, (_event, trackId: unknown) =>
    {
      const settings = getAppSettings();
      if (!settings.networkMetadataEnabled) {
        throw new Error('Network metadata completion is disabled in Settings');
      }

      return getLibraryService().repairMissingMetadata(requireText(trackId, 'trackId'), settings.networkMetadataProviders);
    },
  );
  ipcMain.handle(IpcChannels.LibraryNetworkScanMissingMetadata, (_event, request: unknown) =>
    {
      const settings = getAppSettings();
      if (!settings.networkMetadataEnabled) {
        throw new Error('Network metadata completion is disabled in Settings');
      }

      const options = normalizeMissingMetadataScanOptions(request, 25);
      return getLibraryService().scanMissingMetadata(options.limit, settings.networkMetadataProviders, options.fields);
    },
  );
  ipcMain.handle(IpcChannels.LibraryNetworkStartMissingMetadataScan, (_event, request: unknown) =>
    {
      const settings = getAppSettings();
      if (!settings.networkMetadataEnabled) {
        throw new Error('Network metadata completion is disabled in Settings');
      }

      const options = normalizeMissingMetadataScanOptions(request, 25);
      return getLibraryService().startMissingMetadataScan(options.limit, settings.networkMetadataProviders, options.fields);
    },
  );
  ipcMain.handle(IpcChannels.LibraryNetworkGetMissingMetadataScanStatus, (_event, jobId: unknown) =>
    getLibraryService().getMissingMetadataScanStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryNetworkStartMissingCoverBackfill, (_event, request: unknown) =>
    {
      const settings = getAppSettings();
      if (!settings.networkMetadataEnabled) {
        throw new Error('Network metadata completion is disabled in Settings');
      }

      const options = normalizeMissingMetadataScanOptions(request, 500);
      return getLibraryService().startMissingCoverBackfill(options.limit, settings.networkMetadataProviders);
    },
  );
  ipcMain.handle(IpcChannels.LibraryNetworkGetMissingCoverBackfillStatus, (_event, jobId: unknown) =>
    getLibraryService().getMissingCoverBackfillStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryNetworkGetActiveMissingCoverBackfillStatus, () =>
    getLibraryService().getActiveMissingCoverBackfillStatus(),
  );
  ipcMain.handle(IpcChannels.LibraryNetworkShowCandidates, (_event, trackId: unknown) =>
    getLibraryService().showNetworkCandidates(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.LibrarySearchNetworkTagCandidates, (_event, request: unknown) =>
    {
      const settings = getAppSettings();
      const normalized = normalizeNetworkTagCandidateSearchRequest(request);
      return getLibraryService().searchNetworkTagCandidates({
        ...normalized,
        providers: normalized.providers?.length ? normalized.providers : settings.networkMetadataProviders,
      });
    },
  );
  ipcMain.handle(IpcChannels.LibraryResolveLyricsBackgroundCover, (_event, trackId: unknown) =>
    {
      const settings = getAppSettings();
      return getLibraryService().resolveLyricsBackgroundCover(
        requireText(trackId, 'trackId'),
        settings.networkMetadataProviders,
      );
    },
  );
  ipcMain.handle(IpcChannels.LibraryNetworkApplyMissingOnly, (_event, request: unknown) => {
    const { candidateId, options } = normalizeNetworkApplyRequest(request);
    return getLibraryService().applyNetworkMissingOnly(candidateId, options);
  });
  ipcMain.handle(IpcChannels.LibraryNetworkApplySelected, (_event, request: unknown) => {
    const { candidateId, options } = normalizeNetworkApplyRequest(request);
    return getLibraryService().applyNetworkSelected(candidateId, options);
  });
  ipcMain.handle(IpcChannels.LibraryNetworkRejectCandidate, (_event, candidateId: unknown) =>
    getLibraryService().rejectNetworkCandidate(requireText(candidateId, 'candidateId')),
  );
  ipcMain.handle(IpcChannels.LibraryStartBpmAnalysis, (_event, request: unknown) => {
    const settings = getAppSettings();
    if (!settings.audioAnalysisEnabled) {
      throw new Error('BPM analysis is disabled in Settings');
    }
    return getLibraryService().startBpmAnalysis(normalizeBpmAnalysisStartOptions(request));
  });
  ipcMain.handle(IpcChannels.LibraryGetBpmAnalysisStatus, (_event, jobId: unknown) =>
    getLibraryService().getBpmAnalysisStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryStartReplayGainAnalysis, (_event, request: unknown) => {
    return getLibraryService().startReplayGainAnalysis(normalizeReplayGainAnalysisStartOptions(request));
  });
  ipcMain.handle(IpcChannels.LibraryGetReplayGainAnalysisStatus, (_event, jobId: unknown) =>
    getLibraryService().getReplayGainAnalysisStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryStartLyricsBackfill, (_event, request: unknown) =>
    getLibraryService().startLyricsBackfill(normalizeLyricsBackfillStartOptions(request)),
  );
  ipcMain.handle(IpcChannels.LibraryGetLyricsBackfillStatus, (_event, jobId: unknown) =>
    getLibraryService().getLyricsBackfillStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryGetCurrentLyricsBackfillStatus, () =>
    getLibraryService().getCurrentLyricsBackfillStatus(),
  );
  ipcMain.handle(IpcChannels.LibraryCancelLyricsBackfill, (_event, jobId: unknown) =>
    getLibraryService().cancelLyricsBackfill(requireText(jobId, 'jobId')),
  );
};
