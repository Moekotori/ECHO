import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createMvApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['mv'] {
  return {
    getSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetSelected, trackId),
    getSettings: () => ipcRenderer.invoke(IpcChannels.MvGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.MvSetSettings, patch),
    findLocalCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvFindLocalCandidates, trackId),
    searchNetworkCandidates: (trackId, query) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidates, trackId, query),
    searchNetworkCandidatesForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvSearchNetworkCandidatesForSnapshot, request),
    getTemporaryPlayableForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.MvGetTemporaryPlayableForSnapshot, request),
    getCandidates: (trackId) => ipcRenderer.invoke(IpcChannels.MvGetCandidates, trackId),
    resolveStreams: (videoId) => ipcRenderer.invoke(IpcChannels.MvResolveStreams, videoId),
    setQuality: (videoId, qualityId) => ipcRenderer.invoke(IpcChannels.MvSetQuality, videoId, qualityId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.MvSetOffset, trackId, offsetMs),
    chooseLocalVideo: (trackId) => ipcRenderer.invoke(IpcChannels.MvChooseLocalVideo, trackId),
    bindLocalVideo: (trackId, filePath) => ipcRenderer.invoke(IpcChannels.MvBindLocalVideo, trackId, filePath),
    bindUrl: (trackId, url) => ipcRenderer.invoke(IpcChannels.MvBindUrl, trackId, url),
    selectVideo: (trackId, videoId) => ipcRenderer.invoke(IpcChannels.MvSelectVideo, trackId, videoId),
    clearSelected: (trackId) => ipcRenderer.invoke(IpcChannels.MvClearSelected, trackId),
    openExternal: (videoId) => ipcRenderer.invoke(IpcChannels.MvOpenExternal, videoId),
  };
}
