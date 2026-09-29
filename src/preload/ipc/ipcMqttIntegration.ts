import type { EchoApi } from '../apiTypes';

export function createMqttIntegrationApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['mqttIntegration'] {
  return {
    getStatus: () => ipcRenderer.invoke(IpcChannels.MqttIntegrationGetStatus),
    updateSettings: (patch) =>
      ipcRenderer.invoke(IpcChannels.MqttIntegrationUpdateSettings, patch),
  };
}

