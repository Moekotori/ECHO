import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getDiscordPresenceService, setDiscordPresenceEnabled } from '../integrations/discord/getDiscordPresenceService';

export const registerDiscordPresenceIpc = (): void => {
  ipcMain.handle(IpcChannels.DiscordPresenceGetStatus, () => getDiscordPresenceService().getStatus());
  ipcMain.handle(IpcChannels.DiscordPresenceSetEnabled, (_event, enabled: unknown) => setDiscordPresenceEnabled(enabled === true));
};
