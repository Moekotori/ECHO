import type { EchoApi } from '../apiTypes';

export function createDiscordPresenceApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['discordPresence'] {
  return {
    getStatus: () => ipcRenderer.invoke(IpcChannels.DiscordPresenceGetStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.DiscordPresenceSetEnabled, enabled),
  };
}
