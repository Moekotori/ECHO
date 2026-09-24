import type { EchoApi } from '../apiTypes';

export function createEchoLinkApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['echoLink'] {
  return {
    getStatus: () => ipcRenderer.invoke(IpcChannels.EchoLinkBasicGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EchoLinkBasicSetEnabled, enabled),
    startPairing: () => ipcRenderer.invoke(IpcChannels.EchoLinkBasicStartPairing),
    cancelPairing: () => ipcRenderer.invoke(IpcChannels.EchoLinkBasicCancelPairing),
    revokeClient: (clientId) => ipcRenderer.invoke(IpcChannels.EchoLinkBasicRevokeClient, clientId),
  };
}
