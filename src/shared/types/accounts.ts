export type AccountProvider = 'netease' | 'qqmusic' | 'kugou' | 'bilibili' | 'youtube' | 'soundcloud' | 'spotify' | 'tidal' | 'qobuz' | 'osu';

export type AccountStatus = {
  provider: AccountProvider;
  connected: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  lastCheckedAt: string | null;
  expiresAt: string | null;
  error: string | null;
};

export type AccountCredentials = {
  provider: AccountProvider;
  cookie?: string;
  browser?: 'edge' | 'chrome' | 'firefox' | 'none';
};

export type AccountBrowser = NonNullable<AccountCredentials['browser']>;
export type YouTubeBrowser = AccountBrowser;

export type AccountLoginStartResult = {
  status: AccountStatus;
  saved: boolean;
  message: string;
};

export type NeteaseQrLoginState = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed';

export type NeteaseQrLoginStartResult = {
  key: string;
  qrUrl: string;
  expiresAt: string;
  state: Extract<NeteaseQrLoginState, 'waiting'>;
  message: string;
};

export type NeteaseQrLoginPollResult = {
  state: NeteaseQrLoginState;
  saved: boolean;
  message: string;
  code: number | null;
  status?: AccountStatus;
};

export const accountProviders: AccountProvider[] = ['netease', 'qqmusic', 'kugou', 'bilibili', 'youtube', 'soundcloud', 'spotify', 'tidal', 'qobuz', 'osu'];

export const accountBrowsers: AccountBrowser[] = ['edge', 'chrome', 'firefox', 'none'];
export const youtubeBrowsers: YouTubeBrowser[] = accountBrowsers;
