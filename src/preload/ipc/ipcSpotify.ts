import type { EchoApi } from '../apiTypes';

export function createSpotifyApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['spotify'] {
  return {
    getAccessToken: () => ipcRenderer.invoke(IpcChannels.SpotifyGetAccessToken),
    getDevices: () => ipcRenderer.invoke(IpcChannels.SpotifyGetDevices),
    getPlaybackState: () => ipcRenderer.invoke(IpcChannels.SpotifyGetPlaybackState),
    ensureConnectDevice: (request) => ipcRenderer.invoke(IpcChannels.SpotifyEnsureConnectDevice, request),
    startPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyStartPlayback, request),
    transferPlayback: (request) => ipcRenderer.invoke(IpcChannels.SpotifyTransferPlayback, request),
    pause: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyPause, deviceId),
    resume: (deviceId) => ipcRenderer.invoke(IpcChannels.SpotifyResume, deviceId),
    seek: (positionMs, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySeek, positionMs, deviceId),
    setVolume: (volume, deviceId) => ipcRenderer.invoke(IpcChannels.SpotifySetVolume, volume, deviceId),
  };
}
