import type { EchoApi } from '../apiTypes';

export function createLastFmApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['lastfm'] {
  return {
    getStatus: () => ipcRenderer.invoke(IpcChannels.LastFmGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetEnabled, enabled),
    setNowPlayingEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetNowPlayingEnabled, enabled),
    setScrobbleEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LastFmSetScrobbleEnabled, enabled),
    createAuthToken: () => ipcRenderer.invoke(IpcChannels.LastFmCreateAuthToken),
    openAuthUrl: (token) => ipcRenderer.invoke(IpcChannels.LastFmOpenAuthUrl, token),
    completeAuth: (token) => ipcRenderer.invoke(IpcChannels.LastFmCompleteAuth, token),
    authenticatePassword: (username, password) => ipcRenderer.invoke(IpcChannels.LastFmAuthenticatePassword, username, password),
    disconnect: () => ipcRenderer.invoke(IpcChannels.LastFmDisconnect),
  };
}
