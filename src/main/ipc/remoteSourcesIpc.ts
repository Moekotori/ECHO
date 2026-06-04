import { ipcMain, shell } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { RemoteAlbumMergeStrategy } from '../../shared/types/appSettings';
import type {
  BaiduOAuthAuthorizeRequest,
  BaiduOAuthLoginRequest,
  BaiduOAuthTokenRequest,
  RemoteBackgroundJobKind,
  RemoteDirectoryItem,
  RemoteDirectoryPreviewOptions,
  RemoteIndexedTracksQuery,
  RemoteSourceIssueKind,
  RemoteRuntimeLimits,
  RemoteSourceInput,
  RemoteSourceProvider,
  RemoteSourceSyncMode,
  RemoteSourceUpdate,
  RemoteSyncOptions,
  RemoteVisibleHydrationOptions,
} from '../../shared/types/remoteSources';
import type { LibrarySort } from '../../shared/types/library';
import { getRemoteSourceService } from '../library/remote/RemoteSourceService';
import {
  createBaiduOAuthAuthorizeUrl,
  exchangeBaiduOAuthCode,
  extractBaiduOAuthAccessToken,
  startBaiduOAuthLogin,
} from '../library/remote/BaiduOAuth';

const providers = new Set<RemoteSourceProvider>(['webdav', 'baidu', 'jellyfin', 'emby', 'smb', 'sshfs', 'subsonic']);
const syncModes = new Set<RemoteSourceSyncMode>(['browse', 'index', 'mirror']);
const remoteAlbumMergeStrategies = new Set<RemoteAlbumMergeStrategy>(['conservative', 'standard']);
const backgroundJobKinds = new Set<RemoteBackgroundJobKind>(['metadata', 'cover', 'lyrics', 'mv', 'duration-backfill']);
const issueKinds = new Set<RemoteSourceIssueKind>(['metadata', 'cover', 'lyrics', 'mv', 'missing']);
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

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
};

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeConfig = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizeJobKinds = (value: unknown): RemoteBackgroundJobKind[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const kinds = value.filter((item): item is RemoteBackgroundJobKind => typeof item === 'string' && backgroundJobKinds.has(item as RemoteBackgroundJobKind));
  return kinds.length > 0 ? Array.from(new Set(kinds)) : undefined;
};

const normalizeBoolean = (value: unknown): boolean => value === true;

const normalizeRemoteAlbumMergeStrategy = (value: unknown): RemoteAlbumMergeStrategy | undefined =>
  remoteAlbumMergeStrategies.has(value as RemoteAlbumMergeStrategy) ? (value as RemoteAlbumMergeStrategy) : undefined;

const normalizeTrackIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))).slice(0, 40);
};

const normalizeRemotePaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))).slice(0, 200);
};

const normalizePreviewDirectoryItems = (value: unknown): RemoteDirectoryItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item): RemoteDirectoryItem => {
      const path = requireText(item.path, 'path');
      return {
        sourceId: optionalText(item.sourceId) ?? '',
        provider: providers.has(item.provider as RemoteSourceProvider) ? (item.provider as RemoteSourceProvider) : 'webdav',
        path,
        name: optionalText(item.name) ?? path,
        kind: item.kind === 'directory' ? 'directory' : 'file',
        sizeBytes: typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) ? item.sizeBytes : null,
        modifiedAt: optionalText(item.modifiedAt),
        etag: optionalText(item.etag),
        contentType: optionalText(item.contentType),
        audio: item.audio === true,
      };
    })
    .slice(0, 40);
};

const normalizeDirectoryPreviewOptions = (value: unknown): RemoteDirectoryPreviewOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    limit: typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : undefined,
    includeCover: typeof input.includeCover === 'boolean' ? input.includeCover : undefined,
  };
};

const normalizeVisibleHydrationOptions = (value: unknown): RemoteVisibleHydrationOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    metadata: typeof input.metadata === 'boolean' ? input.metadata : undefined,
    cover: typeof input.cover === 'boolean' ? input.cover : undefined,
    priority: typeof input.priority === 'number' && Number.isFinite(input.priority) ? input.priority : undefined,
    immediateCover: typeof input.immediateCover === 'boolean' ? input.immediateCover : undefined,
  };
};

const normalizeRemoteSyncOptions = (value: unknown): RemoteSyncOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    rootPath: optionalText(input.rootPath),
    markMissing: typeof input.markMissing === 'boolean' ? input.markMissing : undefined,
    includeCover: typeof input.includeCover === 'boolean' ? input.includeCover : undefined,
  };
};

const normalizeIndexedTracksQuery = (value: unknown): RemoteIndexedTracksQuery => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    rootPath: optionalText(input.rootPath),
    page: typeof input.page === 'number' && Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page)) : undefined,
    pageSize: typeof input.pageSize === 'number' && Number.isFinite(input.pageSize) ? Math.max(1, Math.min(500, Math.floor(input.pageSize))) : undefined,
    search: optionalText(input.search) ?? undefined,
    sort: sortValues.has(input.sort as LibrarySort) ? (input.sort as LibrarySort) : undefined,
  };
};

const normalizeRuntimeLimits = (value: unknown): RemoteRuntimeLimits => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const limitKeys: Array<keyof RemoteRuntimeLimits> = [
    'scanConcurrency',
    'metadataConcurrency',
    'coverConcurrency',
    'lyricsConcurrency',
    'mvConcurrency',
    'durationBackfillConcurrency',
  ];
  const output: RemoteRuntimeLimits = {};

  for (const key of limitKeys) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) {
      output[key] = input[key];
    }
  }

  return output;
};

const normalizeIssueKind = (value: unknown): RemoteSourceIssueKind => {
  if (typeof value === 'string' && issueKinds.has(value as RemoteSourceIssueKind)) {
    return value as RemoteSourceIssueKind;
  }

  return 'metadata';
};

const normalizeIssueLimit = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeBaiduOAuthAuthorizeRequest = (value: unknown): BaiduOAuthAuthorizeRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Baidu OAuth authorize request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    clientId: optionalText(input.clientId),
    redirectUri: optionalText(input.redirectUri),
    state: optionalText(input.state),
    qrcode: input.qrcode !== false,
    responseType: input.responseType === 'token' ? 'token' : 'code',
  };
};

const normalizeBaiduOAuthTokenRequest = (value: unknown): BaiduOAuthTokenRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Baidu OAuth token request must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    clientId: optionalText(input.clientId),
    clientSecret: optionalText(input.clientSecret),
    redirectUri: optionalText(input.redirectUri),
    code: requireText(input.code, 'code'),
  };
};

const normalizeBaiduOAuthLoginRequest = (value: unknown): BaiduOAuthLoginRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Baidu OAuth login input must be an object');
  }

  const input = value as Record<string, unknown>;
  return {
    clientId: optionalText(input.clientId),
    clientSecret: optionalText(input.clientSecret),
    redirectUri: optionalText(input.redirectUri),
    timeoutMs: typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) ? input.timeoutMs : null,
  };
};

const normalizeInput = (value: unknown): RemoteSourceInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('remote source input must be an object');
  }

  const input = value as Record<string, unknown>;
  const provider = providers.has(input.provider as RemoteSourceProvider) ? (input.provider as RemoteSourceProvider) : 'webdav';
  const syncMode = syncModes.has(input.syncMode as RemoteSourceSyncMode) ? (input.syncMode as RemoteSourceSyncMode) : 'index';
  const requestedAuthType = provider === 'baidu'
    ? 'token'
    : input.authType === 'none' || input.authType === 'token' || input.authType === 'apiKey'
      ? input.authType
      : 'basic';
  const username = optionalText(input.username);
  const secret = typeof input.secret === 'string' ? input.secret : null;
  const authType = provider === 'webdav' && requestedAuthType === 'basic' && !username && !secret ? 'none' : requestedAuthType;

  if (provider === 'webdav' && authType === 'basic' && !username) {
    throw new Error('WebDAV password authentication requires a username.');
  }
  if (provider === 'webdav' && (authType === 'token' || authType === 'apiKey') && !secret) {
    throw new Error('WebDAV token authentication requires a token or API key.');
  }
  const normalizedSecret = provider === 'baidu' && secret ? extractBaiduOAuthAccessToken(secret) : secret;

  if (provider === 'baidu' && !normalizedSecret) {
    throw new Error('Baidu Netdisk access token is required.');
  }

  return {
    provider,
    displayName: requireText(input.displayName, 'displayName'),
    baseUrl: provider === 'baidu' ? null : optionalText(input.baseUrl),
    username: provider === 'baidu' || authType === 'none' || authType === 'token' || authType === 'apiKey' ? null : username,
    secret: authType === 'none' ? null : normalizedSecret,
    authType,
    config: normalizeConfig(input.config),
    syncMode,
    status: input.status === 'disabled' || input.status === 'error' ? input.status : 'enabled',
  };
};

const normalizeUpdate = (value: unknown): RemoteSourceUpdate => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('remote source update must be an object');
  }

  const input = value as Record<string, unknown>;
  const update: RemoteSourceUpdate = {
    id: requireText(input.id, 'id'),
  };

  if (input.provider !== undefined) {
    update.provider = providers.has(input.provider as RemoteSourceProvider) ? (input.provider as RemoteSourceProvider) : 'webdav';
  }
  if (input.displayName !== undefined) {
    update.displayName = requireText(input.displayName, 'displayName');
  }
  if (input.baseUrl !== undefined) {
    update.baseUrl = optionalText(input.baseUrl);
  }
  if (input.username !== undefined) {
    update.username = optionalText(input.username);
  }
  if (input.secret !== undefined) {
    update.secret = typeof input.secret === 'string' ? input.secret : null;
  }
  if (input.authType !== undefined) {
    update.authType = input.authType === 'none' || input.authType === 'token' || input.authType === 'apiKey' ? input.authType : 'basic';
  }
  if (input.config !== undefined) {
    update.config = normalizeConfig(input.config);
  }
  if (input.syncMode !== undefined) {
    update.syncMode = syncModes.has(input.syncMode as RemoteSourceSyncMode) ? (input.syncMode as RemoteSourceSyncMode) : 'index';
  }
  if (input.status !== undefined) {
    update.status = input.status === 'disabled' || input.status === 'error' ? input.status : 'enabled';
  }

  if (update.authType === 'none') {
    update.username = null;
    update.secret = null;
  }

  return update;
};

export const registerRemoteSourcesIpc = (): void => {
  ipcMain.handle(IpcChannels.RemoteSourcesList, () => getRemoteSourceService().listSources());
  ipcMain.handle(IpcChannels.RemoteSourcesGetOverview, (_event, sourceId?: unknown) =>
    getRemoteSourceService().getOverview(optionalText(sourceId)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesPreviewAlbumGrouping, (_event, strategy?: unknown, sourceId?: unknown) =>
    getRemoteSourceService().previewAlbumGrouping(normalizeRemoteAlbumMergeStrategy(strategy), optionalText(sourceId)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesListIssues, (_event, sourceId: unknown, kind: unknown, limit?: unknown) =>
    getRemoteSourceService().listIssues(requireText(sourceId, 'sourceId'), normalizeIssueKind(kind), normalizeIssueLimit(limit)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesCreate, (_event, input: unknown) => getRemoteSourceService().createSource(normalizeInput(input)));
  ipcMain.handle(IpcChannels.RemoteSourcesUpdate, (_event, input: unknown) => getRemoteSourceService().updateSource(normalizeUpdate(input)));
  ipcMain.handle(IpcChannels.RemoteSourcesDisconnect, (_event, sourceId: unknown) => getRemoteSourceService().disconnectSource(requireText(sourceId, 'sourceId')));
  ipcMain.handle(IpcChannels.RemoteSourcesDelete, (_event, sourceId: unknown) => getRemoteSourceService().deleteSource(requireText(sourceId, 'sourceId')));
  ipcMain.handle(IpcChannels.RemoteSourcesTest, (_event, input: unknown) =>
    typeof input === 'string' ? getRemoteSourceService().testSource(requireText(input, 'sourceId')) : getRemoteSourceService().testSource(normalizeInput(input)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesBrowse, (_event, sourceId: unknown, path?: unknown) =>
    getRemoteSourceService().browse(requireText(sourceId, 'sourceId'), optionalText(path)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesSync, (_event, sourceId: unknown, options?: unknown) =>
    getRemoteSourceService().syncSource(requireText(sourceId, 'sourceId'), normalizeRemoteSyncOptions(options)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesCancelSync, (_event, sourceId: unknown) => getRemoteSourceService().cancelSync(requireText(sourceId, 'sourceId')));
  ipcMain.handle(IpcChannels.RemoteSourcesGetSyncStatus, (_event, sourceId: unknown) =>
    getRemoteSourceService().getSyncStatus(requireText(sourceId, 'sourceId')),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesCreateStreamUrl, (_event, input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('stream URL input must be an object');
    }

    const request = input as Record<string, unknown>;
    return getRemoteSourceService().createStreamUrl({
      trackId: optionalText(request.trackId) ?? undefined,
      sourceId: optionalText(request.sourceId) ?? undefined,
      remotePath: optionalText(request.remotePath) ?? undefined,
      stableKey: optionalText(request.stableKey) ?? undefined,
    });
  });
  ipcMain.handle(IpcChannels.RemoteSourcesHydrateVisibleTracks, (_event, trackIds: unknown, options: unknown) =>
    getRemoteSourceService().hydrateVisibleTracks(normalizeTrackIds(trackIds), normalizeVisibleHydrationOptions(options)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesLookupTracks, (_event, sourceId: unknown, remotePaths: unknown) =>
    getRemoteSourceService().lookupTracks(requireText(sourceId, 'sourceId'), normalizeRemotePaths(remotePaths)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesListIndexedTracks, (_event, sourceId: unknown, rootPath: unknown) =>
    getRemoteSourceService().listIndexedTracks(requireText(sourceId, 'sourceId'), optionalText(rootPath)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesListIndexedTracksPage, (_event, sourceId: unknown, query: unknown) =>
    getRemoteSourceService().listIndexedTracksPage(requireText(sourceId, 'sourceId'), normalizeIndexedTracksQuery(query)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesGetIndexedFolderStats, (_event, sourceId: unknown, rootPath: unknown) =>
    getRemoteSourceService().getIndexedFolderStats(requireText(sourceId, 'sourceId'), optionalText(rootPath)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesPreviewDirectoryItems, (_event, sourceId: unknown, items: unknown, options: unknown) =>
    getRemoteSourceService().previewDirectoryItems(
      requireText(sourceId, 'sourceId'),
      normalizePreviewDirectoryItems(items),
      normalizeDirectoryPreviewOptions(options),
    ),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesStartBackgroundJobs, (_event, sourceId: unknown, kinds?: unknown) =>
    getRemoteSourceService().startBackgroundJobs(requireText(sourceId, 'sourceId'), normalizeJobKinds(kinds)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesPauseBackgroundJobs, (_event, sourceId: unknown) =>
    getRemoteSourceService().pauseBackgroundJobs(requireText(sourceId, 'sourceId')),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesResumeBackgroundJobs, (_event, sourceId: unknown) =>
    getRemoteSourceService().resumeBackgroundJobs(requireText(sourceId, 'sourceId')),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesGetJobStatus, (_event, sourceId: unknown) =>
    getRemoteSourceService().getJobStatus(requireText(sourceId, 'sourceId')),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesRetryFailedJobs, (_event, sourceId: unknown, kinds?: unknown) =>
    getRemoteSourceService().retryFailedJobs(requireText(sourceId, 'sourceId'), normalizeJobKinds(kinds)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesSetBackgroundPaused, (_event, paused: unknown) =>
    getRemoteSourceService().setBackgroundPaused(normalizeBoolean(paused)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesGetBackgroundGlobalStatus, () => getRemoteSourceService().getBackgroundGlobalStatus());
  ipcMain.handle(IpcChannels.RemoteSourcesUpdateRuntimeLimits, (_event, sourceId: unknown, limits: unknown) =>
    getRemoteSourceService().updateRuntimeLimits(requireText(sourceId, 'sourceId'), normalizeRuntimeLimits(limits)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesCreateBaiduAuthUrl, async (_event, input: unknown) => {
    const url = createBaiduOAuthAuthorizeUrl(normalizeBaiduOAuthAuthorizeRequest(input));
    await shell.openExternal(url);
    return url;
  });
  ipcMain.handle(IpcChannels.RemoteSourcesExchangeBaiduAuthCode, (_event, input: unknown) =>
    exchangeBaiduOAuthCode(normalizeBaiduOAuthTokenRequest(input)),
  );
  ipcMain.handle(IpcChannels.RemoteSourcesStartBaiduOAuthLogin, (_event, input: unknown) =>
    startBaiduOAuthLogin(normalizeBaiduOAuthLoginRequest(input), {
      openUrl: (url) => shell.openExternal(url),
    }),
  );
};
