import { shell, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { LastFmAuthStartResult, LastFmStatus } from '../../shared/types/lastfm';
import { getLastFmService } from '../integrations/lastfm/getLastFmService';

export const registerLastFmIpc = (): void => {
  ipcMain.handle(IpcChannels.LastFmGetStatus, (): LastFmStatus => getLastFmService().getStatus());
  ipcMain.handle(IpcChannels.LastFmSetEnabled, (_event, enabled: unknown): LastFmStatus => getLastFmService().setEnabled(enabled === true));
  ipcMain.handle(IpcChannels.LastFmSetNowPlayingEnabled, (_event, enabled: unknown): LastFmStatus =>
    getLastFmService().setNowPlayingEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LastFmSetScrobbleEnabled, (_event, enabled: unknown): LastFmStatus =>
    getLastFmService().setScrobbleEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LastFmCreateAuthToken, (): Promise<LastFmAuthStartResult> => getLastFmService().createAuthToken());
  ipcMain.handle(IpcChannels.LastFmOpenAuthUrl, async (_event, token: unknown): Promise<void> => {
    const url = getLastFmService().getAuthorizationUrl(String(token ?? ''));
    await shell.openExternal(url);
  });
  ipcMain.handle(IpcChannels.LastFmCompleteAuth, (_event, token: unknown): Promise<LastFmStatus> =>
    getLastFmService().completeAuth(String(token ?? '')),
  );
  ipcMain.handle(IpcChannels.LastFmAuthenticatePassword, (_event, username: unknown, password: unknown): Promise<LastFmStatus> =>
    getLastFmService().authenticateWithPassword(String(username ?? ''), String(password ?? '')),
  );
  ipcMain.handle(IpcChannels.LastFmDisconnect, (): LastFmStatus => getLastFmService().disconnect());
};
