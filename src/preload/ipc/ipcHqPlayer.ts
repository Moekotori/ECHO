import type { EchoApi } from '../apiTypes';

export function createHqPlayerApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['hqPlayer'] {
  return {
    getSettings: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerSetSettings, patch),
    getStatus: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetStatus),
    testConnection: (patch) => ipcRenderer.invoke(IpcChannels.HqPlayerTestConnection, patch),
    createPlaybackHandoff: (request) => ipcRenderer.invoke(IpcChannels.HqPlayerCreatePlaybackHandoff, request),
    sendLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerSendLastPlaybackControl),
    getLastPlaybackHandoff: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackHandoff),
    getLastPlaybackControl: () => ipcRenderer.invoke(IpcChannels.HqPlayerGetLastPlaybackControl),
  };
}
