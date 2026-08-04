import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createStreamingApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['streaming'] {
  return {
    search: (request) => ipcRenderer.invoke(IpcChannels.StreamingSearch, request),
    getTrack: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrack, request),
    getTrackSourceInfo: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetTrackSourceInfo, request),
    getAlbum: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetAlbum, request),
    getArtist: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetArtist, request),
    resolvePlayback: (request) => ipcRenderer.invoke(IpcChannels.StreamingResolvePlayback, request),
    analyzeBpm: (request) => ipcRenderer.invoke(IpcChannels.StreamingAnalyzeBpm, request),
    getLyrics: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetLyrics, request),
    getMv: (request) => ipcRenderer.invoke(IpcChannels.StreamingGetMv, request),
    getProviders: () => ipcRenderer.invoke(IpcChannels.StreamingGetProviders),
    importPlaylistFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportPlaylistFromUrl, url),
    importFavoritesFromUrl: (url) => ipcRenderer.invoke(IpcChannels.StreamingImportFavoritesFromUrl, url),
    exportFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingExportFavorites),
    syncLikedSongs: (provider) => ipcRenderer.invoke(IpcChannels.StreamingSyncLikedSongs, provider),
    setTrackLiked: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetTrackLiked, request),
    getFavorites: () => ipcRenderer.invoke(IpcChannels.StreamingGetFavorites),
    setFavorite: (request) => ipcRenderer.invoke(IpcChannels.StreamingSetFavorite, request),
    renameFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingRenameFavoriteCollection, request),
    syncFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingSyncFavoriteCollection, request),
    deleteFavoriteCollection: (request) => ipcRenderer.invoke(IpcChannels.StreamingDeleteFavoriteCollection, request),
    refreshNeteaseDailyRecommend: () => ipcRenderer.invoke(IpcChannels.StreamingRefreshNeteaseDailyRecommend),
  };
}
