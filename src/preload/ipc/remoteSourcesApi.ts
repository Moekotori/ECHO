import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createRemoteSourcesApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['remoteSources'] {
  return {
    list: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesList),
    getOverview: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetOverview, sourceId),
    previewAlbumGrouping: (strategy, sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewAlbumGrouping, strategy, sourceId),
    listIssues: (sourceId, kind, limit) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIssues, sourceId, kind, limit),
    create: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreate, input),
    update: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdate, input),
    disconnect: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDisconnect, sourceId),
    delete: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesDelete, sourceId),
    test: (sourceIdOrInput) => ipcRenderer.invoke(IpcChannels.RemoteSourcesTest, sourceIdOrInput),
    browse: (sourceId, path) => ipcRenderer.invoke(IpcChannels.RemoteSourcesBrowse, sourceId, path),
    sync: (sourceId, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSync, sourceId, options),
    cancelSync: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCancelSync, sourceId),
    getSyncStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetSyncStatus, sourceId),
    createStreamUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateStreamUrl, input),
    hydrateVisibleTracks: (trackIds, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesHydrateVisibleTracks, trackIds, options),
    lookupTracks: (sourceId, remotePaths) => ipcRenderer.invoke(IpcChannels.RemoteSourcesLookupTracks, sourceId, remotePaths),
    listIndexedTracks: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracks, sourceId, rootPath),
    listIndexedTracksPage: (sourceId, query) => ipcRenderer.invoke(IpcChannels.RemoteSourcesListIndexedTracksPage, sourceId, query),
    getIndexedFolderStats: (sourceId, rootPath) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetIndexedFolderStats, sourceId, rootPath),
    previewDirectoryItems: (sourceId, items, options) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPreviewDirectoryItems, sourceId, items, options),
    startBackgroundJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBackgroundJobs, sourceId, kinds),
    pauseBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesPauseBackgroundJobs, sourceId),
    resumeBackgroundJobs: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesResumeBackgroundJobs, sourceId),
    getJobStatus: (sourceId) => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetJobStatus, sourceId),
    retryFailedJobs: (sourceId, kinds) => ipcRenderer.invoke(IpcChannels.RemoteSourcesRetryFailedJobs, sourceId, kinds),
    setBackgroundPaused: (paused) => ipcRenderer.invoke(IpcChannels.RemoteSourcesSetBackgroundPaused, paused),
    getBackgroundGlobalStatus: () => ipcRenderer.invoke(IpcChannels.RemoteSourcesGetBackgroundGlobalStatus),
    updateRuntimeLimits: (sourceId, limits) => ipcRenderer.invoke(IpcChannels.RemoteSourcesUpdateRuntimeLimits, sourceId, limits),
    createBaiduAuthUrl: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesCreateBaiduAuthUrl, input),
    exchangeBaiduAuthCode: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesExchangeBaiduAuthCode, input),
    startBaiduOAuthLogin: (input) => ipcRenderer.invoke(IpcChannels.RemoteSourcesStartBaiduOAuthLogin, input),
  };
}
