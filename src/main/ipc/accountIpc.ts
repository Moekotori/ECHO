import { ipcMain, shell } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AccountLoginStartResult, AccountProvider, AccountStatus } from '../../shared/types/accounts';
import { getAccountService, isAccountProvider, isYouTubeBrowser } from '../accounts/AccountService';
import { startAccountLoginWindow } from '../accounts/AccountLoginWindow';
import { getSpotifyAuthService } from '../accounts/SpotifyAuthService';
import { getTidalAuthService } from '../accounts/TidalAuthService';

const requireProvider = (value: unknown): AccountProvider => {
  if (!isAccountProvider(value)) {
    throw new Error('provider must be a supported account provider');
  }

  return value;
};

const requireCookie = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('cookie must be a string');
  }

  return value;
};

export const registerAccountIpc = (): void => {
  ipcMain.handle(IpcChannels.AccountGetStatuses, (): AccountStatus[] => getAccountService().getStatuses());
  ipcMain.handle(IpcChannels.AccountGetStatus, (_event, provider: unknown): AccountStatus =>
    getAccountService().getStatus(requireProvider(provider)),
  );
  ipcMain.handle(IpcChannels.AccountSaveCookie, (_event, provider: unknown, cookie: unknown): AccountStatus =>
    getAccountService().saveCookie(requireProvider(provider), requireCookie(cookie)),
  );
  ipcMain.handle(IpcChannels.AccountStartLogin, (_event, provider: unknown): Promise<AccountLoginStartResult> => {
    const accountProvider = requireProvider(provider);
    if (accountProvider === 'spotify') {
      return getSpotifyAuthService().startLoginWindow();
    }
    if (accountProvider === 'tidal') {
      return getTidalAuthService().startLoginWindow();
    }
    if (accountProvider === 'youtube') {
      const browser = getAccountService().getCredentials('youtube').browser;
      const loginUrl = browser === 'edge' && process.platform === 'win32'
        ? 'microsoft-edge:https://www.youtube.com/'
        : 'https://www.youtube.com/';
      return shell.openExternal(loginUrl).catch(() => undefined).then(() => ({
        status: getAccountService().getStatus('youtube'),
        saved: false,
        message: 'Opened YouTube in the system browser. ECHO will not open an Electron login window for YouTube.',
      }));
    }

    return startAccountLoginWindow(accountProvider, getAccountService());
  });
  ipcMain.handle(IpcChannels.AccountClear, (_event, provider: unknown): AccountStatus =>
    getAccountService().clearAccount(requireProvider(provider)),
  );
  ipcMain.handle(IpcChannels.AccountCheck, (_event, provider: unknown): Promise<AccountStatus> => {
    const accountProvider = requireProvider(provider);
    if (accountProvider === 'spotify') {
      return getSpotifyAuthService().checkAccount();
    }
    if (accountProvider === 'tidal') {
      return getTidalAuthService().checkAccount();
    }

    return getAccountService().checkAccount(accountProvider);
  });
  ipcMain.handle(IpcChannels.AccountCheckAll, async (): Promise<AccountStatus[]> => {
    await getAccountService().checkAllAccounts();
    if (getAccountService().getStatus('spotify').connected) {
      await getSpotifyAuthService().checkAccount();
    }
    if (getAccountService().getStatus('tidal').connected) {
      await getTidalAuthService().checkAccount();
    }
    return getAccountService().getStatuses();
  });
  ipcMain.handle(IpcChannels.AccountSetYouTubeBrowser, (_event, browser: unknown): AccountStatus => {
    if (!isYouTubeBrowser(browser)) {
      throw new Error('browser must be edge, chrome, firefox, or none');
    }

    return getAccountService().setYouTubeBrowser(browser);
  });
  ipcMain.handle(IpcChannels.SpotifyGetAccessToken, (): Promise<string> => getSpotifyAuthService().getAccessToken());
  ipcMain.handle(IpcChannels.SpotifyGetDevices, () => getSpotifyAuthService().getDevices());
  ipcMain.handle(IpcChannels.SpotifyGetPlaybackState, () => getSpotifyAuthService().getPlaybackState());
  ipcMain.handle(IpcChannels.SpotifyEnsureConnectDevice, (_event, request: unknown) => {
    const input = request && typeof request === 'object' ? (request as Record<string, unknown>) : {};
    const uri = typeof input.uri === 'string' ? input.uri.trim() : '';
    const webUrl = typeof input.webUrl === 'string' ? input.webUrl.trim() : '';
    const preferredDeviceId =
      typeof input.preferredDeviceId === 'string' && input.preferredDeviceId.trim()
        ? input.preferredDeviceId.trim()
        : null;
    if (!uri || !webUrl) {
      throw new Error('Spotify uri and webUrl are required');
    }

    return getSpotifyAuthService().ensureConnectDevice({ uri, webUrl, preferredDeviceId });
  });
  ipcMain.handle(IpcChannels.SpotifyStartPlayback, (_event, request: unknown): Promise<void> => {
    const input = request && typeof request === 'object' ? (request as Record<string, unknown>) : {};
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    const uri = typeof input.uri === 'string' ? input.uri.trim() : '';
    const positionMs = typeof input.positionMs === 'number' && Number.isFinite(input.positionMs) ? input.positionMs : undefined;
    if (!deviceId || !uri) {
      throw new Error('Spotify deviceId and uri are required');
    }

    return getSpotifyAuthService().startPlayback({ deviceId, uri, positionMs });
  });
  ipcMain.handle(IpcChannels.SpotifyTransferPlayback, (_event, request: unknown): Promise<void> => {
    const input = request && typeof request === 'object' ? (request as Record<string, unknown>) : {};
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    if (!deviceId) {
      throw new Error('Spotify deviceId is required');
    }

    return getSpotifyAuthService().transferPlayback({ deviceId, play: input.play === true });
  });
  ipcMain.handle(IpcChannels.SpotifyPause, (_event, deviceId: unknown): Promise<void> =>
    getSpotifyAuthService().pause(typeof deviceId === 'string' ? deviceId : undefined),
  );
  ipcMain.handle(IpcChannels.SpotifyResume, (_event, deviceId: unknown): Promise<void> =>
    getSpotifyAuthService().resume(typeof deviceId === 'string' ? deviceId : undefined),
  );
  ipcMain.handle(IpcChannels.SpotifySeek, (_event, positionMs: unknown, deviceId: unknown): Promise<void> => {
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
      throw new Error('Spotify seek position must be a finite number');
    }

    return getSpotifyAuthService().seek(positionMs, typeof deviceId === 'string' ? deviceId : undefined);
  });
  ipcMain.handle(IpcChannels.SpotifySetVolume, (_event, volume: unknown, deviceId: unknown): Promise<void> => {
    if (typeof volume !== 'number' || !Number.isFinite(volume)) {
      throw new Error('Spotify volume must be a finite number');
    }

    return getSpotifyAuthService().setVolume(volume, typeof deviceId === 'string' ? deviceId : undefined);
  });
};
