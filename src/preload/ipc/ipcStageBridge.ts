import type { EchoApi } from '../apiTypes';

export function createStageBridgeApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['stageBridge'] {
  return {
    getStatus: () => ipcRenderer.invoke(IpcChannels.StageBridgeGetStatus),
    setEnabled: (patch) => ipcRenderer.invoke(IpcChannels.StageBridgeSetEnabled, patch),
  };
}
