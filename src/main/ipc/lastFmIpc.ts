import { shell, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getLastFmService } from '../integrations/lastfm/getLastFmService';

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const registerLastFmIpc = (): void => {
  ipcMain.handle(IpcChannels.LastFmGetStatus, () => getLastFmService().getStatus());
  ipcMain.handle(IpcChannels.LastFmSetEnabled, (_event, enabled: unknown) => getLastFmService().setEnabled(enabled === true));
  ipcMain.handle(IpcChannels.LastFmSetNowPlayingEnabled, (_event, enabled: unknown) =>
    getLastFmService().setNowPlayingEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LastFmSetScrobbleEnabled, (_event, enabled: unknown) =>
    getLastFmService().setScrobbleEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.LastFmCreateAuthToken, () => getLastFmService().createAuthToken());
  ipcMain.handle(IpcChannels.LastFmOpenAuthUrl, (_event, token: unknown) => {
    const authUrl = getLastFmService().getAuthorizationUrl(normalizeString(token));
    return shell.openExternal(authUrl);
  });
  ipcMain.handle(IpcChannels.LastFmCompleteAuth, (_event, token: unknown) =>
    getLastFmService().completeAuth(normalizeString(token)),
  );
  ipcMain.handle(IpcChannels.LastFmAuthenticatePassword, (_event, username: unknown, password: unknown) =>
    getLastFmService().authenticateWithPassword(normalizeString(username), normalizeString(password)),
  );
  ipcMain.handle(IpcChannels.LastFmDisconnect, () => getLastFmService().disconnect());
};
