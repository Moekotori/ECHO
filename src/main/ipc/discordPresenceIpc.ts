import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { DiscordPresenceStatus } from '../../shared/types/discordPresence';
import { getDiscordPresenceService, setDiscordPresenceEnabled } from '../integrations/discord/getDiscordPresenceService';

export const registerDiscordPresenceIpc = (): void => {
  ipcMain.handle(IpcChannels.DiscordPresenceGetStatus, (): DiscordPresenceStatus => getDiscordPresenceService().getStatus());
  ipcMain.handle(IpcChannels.DiscordPresenceSetEnabled, async (_event, enabled: unknown): Promise<DiscordPresenceStatus> =>
    setDiscordPresenceEnabled(enabled === true),
  );
};
