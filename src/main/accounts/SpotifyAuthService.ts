import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';
import type { AccountLoginStartResult, AccountStatus } from '../../shared/types/accounts';
import { getAccountService, type AccountService } from './AccountService';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { getAppSettings } from '../app/appSettings';

const spotifyAccountsBaseUrl = 'https://accounts.spotify.com';
const spotifyApiBaseUrl = 'https://api.spotify.com/v1';
const defaultSpotifyRedirectCallbackPath = '/spotify/callback';
const defaultSpotifyRedirectPort = Number.parseInt(process.env.ECHO_SPOTIFY_REDIRECT_PORT ?? '43879', 10);
const envSpotifyRedirectUri = process.env.ECHO_SPOTIFY_REDIRECT_URI?.trim() || null;
const fallbackSpotifyRedirectUri =
  `http://127.0.0.1:${Number.isFinite(defaultSpotifyRedirectPort) ? defaultSpotifyRedirectPort : 43879}${defaultSpotifyRedirectCallbackPath}`;
const spotifyScopes = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
];
const tokenRefreshSkewMs = 60_000;
const spotifyConnectPollIntervalMs = 1_000;
const spotifyConnectDesktopWaitMs = 8_000;
const spotifyConnectTotalWaitMs = 20_000;
const spotifyApiRequestTimeoutMs = 12_000;
const spotifyTokenRequestTimeoutMs = 12_000;
const spotifyConnectDevicePollTimeoutMs = 2_500;

let activeSpotifyLoginCleanup: (() => void) | null = null;

type SpotifyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type SpotifyProfileResponse = {
  id?: string;
  display_name?: string | null;
  email?: string | null;
  product?: string | null;
  images?: Array<{ url?: string | null }>;
};

export type SpotifyConnectDevice = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
};

export type SpotifyEnsureConnectDeviceRequest = {
  uri: string;
  webUrl: string;
  preferredDeviceId?: string | null;
};

export type SpotifyEnsureConnectDeviceResult = {
  deviceId: string;
  deviceName: string;
  launched: 'none' | 'desktop' | 'web';
  waitedMs: number;
};

type SpotifyDevicesResponse = {
  devices?: Array<{
    id?: string | null;
    name?: string | null;
    type?: string | null;
    is_active?: boolean;
    is_restricted?: boolean;
    volume_percent?: number | null;
  }>;
};

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  progressMs: number | null;
  itemUri: string | null;
  deviceId: string | null;
  deviceName: string | null;
};

type SpotifyPlaybackStateResponse = {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: { uri?: string | null } | null;
  device?: { id?: string | null; name?: string | null } | null;
};

type SpotifyFetchOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const abortSignalForTimeout = (timeoutMs: number): AbortSignal | undefined => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type SpotifyAuthConfig = {
  clientId: string;
  redirectUri: string;
};

const isValidSpotifyClientId = (value: string): boolean => /^[A-Za-z0-9]{8,128}$/u.test(value);

const normalizeSpotifyRedirectUri = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    const port = Number.parseInt(url.port, 10);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return `${url.origin}${url.pathname || '/'}`;
  } catch {
    return null;
  }
};

const getSpotifyAuthConfig = (): SpotifyAuthConfig => {
  const settings = getAppSettings();
  const configuredClientId = settings.spotifyClientId?.trim();
  if (!configuredClientId || !isValidSpotifyClientId(configuredClientId)) {
    throw new Error('请先在设置 > 集成 > Spotify OAuth 配置中填写你自己的 Spotify Client ID，然后重新登录 Spotify。');
  }

  const redirectUri =
    normalizeSpotifyRedirectUri(settings.spotifyRedirectUri ?? '') ??
    normalizeSpotifyRedirectUri(envSpotifyRedirectUri ?? '') ??
    normalizeSpotifyRedirectUri(fallbackSpotifyRedirectUri);

  if (!redirectUri) {
    throw new Error('Spotify redirect URI must be an http://127.0.0.1:PORT/... loopback URI.');
  }

  return { clientId: configuredClientId, redirectUri };
};

const isTimeoutLikeError = (error: unknown): boolean => {
  const name = typeof (error as { name?: unknown })?.name === 'string' ? (error as { name: string }).name : '';
  const message = errorMessage(error);
  return /abort|timeout|timed out/iu.test(name) || /abort|timeout|timed out/iu.test(message);
};

const spotifyNetworkError = (error: unknown, context: string): Error => {
  if (isTimeoutLikeError(error)) {
    return new Error(`${context} timed out. Check Spotify connectivity or proxy settings.`);
  }

  return new Error(`${context} failed: ${errorMessage(error)}`);
};

const isSpotifyTrackUri = (value: string): boolean => /^spotify:track:[A-Za-z0-9]+$/u.test(value.trim());

const normalizeSpotifyWebUrl = (value: string, uri: string): string => {
  try {
    const url = new URL(value);
    const isSpotifyHost = url.hostname === 'open.spotify.com' || url.hostname.endsWith('.open.spotify.com');
    if (url.protocol === 'https:' && isSpotifyHost && /^\/track\/[A-Za-z0-9]+/u.test(url.pathname)) {
      return url.toString();
    }
  } catch {
    // Fall back to the URI-derived URL below.
  }

  const match = uri.trim().match(/^spotify:track:([A-Za-z0-9]+)$/u);
  if (!match) {
    throw new Error('Spotify track uri is required before launching the official player.');
  }

  return `https://open.spotify.com/track/${encodeURIComponent(match[1]!)}`;
};

const pickSpotifyDevice = (
  devices: SpotifyConnectDevice[],
  preferredDeviceId?: string | null,
): SpotifyConnectDevice | null => {
  const preferredId = preferredDeviceId?.trim();
  if (preferredId) {
    const preferred = devices.find((device) => device.id === preferredId && !device.isRestricted);
    if (preferred) {
      return preferred;
    }
  }

  return (
    devices.find((device) => device.isActive && !device.isRestricted) ??
    devices.find((device) => device.type.toLowerCase() === 'computer' && !device.isRestricted) ??
    devices.find((device) => !device.isRestricted) ??
    null
  );
};

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

const createCodeVerifier = (): string => base64Url(randomBytes(64)).slice(0, 96);

const createCodeChallenge = (verifier: string): string => base64Url(createHash('sha256').update(verifier).digest());

const expiresAtFromSeconds = (seconds: number | undefined): string =>
  new Date(Date.now() + Math.max(1, Math.floor(seconds ?? 3600)) * 1000).toISOString();

const tokenExpiredOrMissing = (expiresAt: string | null | undefined): boolean => {
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : 0;
  return !Number.isFinite(expiresAtMs) || expiresAtMs - tokenRefreshSkewMs <= Date.now();
};

const readErrorText = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    if (typeof parsed.error === 'object' && parsed.error?.message) {
      return parsed.error.message;
    }
    if (typeof parsed.error === 'string') {
      return parsed.error_description ? `${parsed.error}: ${parsed.error_description}` : parsed.error;
    }
  } catch {
    // Fall through to the raw response body.
  }

  return text.slice(0, 500);
};

const spotifyHttpErrorMessage = (status: number, detail: string): string => {
  const suffix = detail ? ` (${detail})` : '';
  if (status === 401) {
    return `Spotify login expired. Please reconnect Spotify.${suffix}`;
  }
  if (status === 403) {
    if (/not registered for this application|not registered/iu.test(detail)) {
      return `This Spotify account is not added to the Spotify Developer App allowlist. Add the user in Spotify Dashboard > Users Management, or use the user's own Client ID.${suffix}`;
    }
    return `Spotify Premium or regional permission is required for this Spotify action.${suffix}`;
  }
  if (status === 404) {
    return `Spotify content or playback device was not found.${suffix}`;
  }
  if (status === 429) {
    return `Spotify rate limit reached. Try again in a moment.${suffix}`;
  }
  if (status >= 500) {
    return `Spotify service is temporarily unavailable: HTTP ${status}${suffix}`;
  }

  return `Spotify request failed: HTTP ${status}${suffix}`;
};

const spotifyFetch = async <T>(path: string, options: SpotifyFetchOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetchWithNetworkProxy(`${spotifyApiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abortSignalForTimeout(options.timeoutMs ?? spotifyApiRequestTimeoutMs),
    });
  } catch (error) {
    throw spotifyNetworkError(error, 'Spotify API request');
  }

  if (!response.ok) {
    throw new Error(spotifyHttpErrorMessage(response.status, await readErrorText(response)));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const exchangeToken = async (body: URLSearchParams): Promise<SpotifyTokenResponse> => {
  let response: Response;
  try {
    response = await fetchWithNetworkProxy(`${spotifyAccountsBaseUrl}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: abortSignalForTimeout(spotifyTokenRequestTimeoutMs),
    });
  } catch (error) {
    throw spotifyNetworkError(error, 'Spotify token request');
  }
  const payload = (await response.json().catch(() => ({}))) as SpotifyTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? `Spotify token request failed with HTTP ${response.status}`);
  }

  return payload;
};

export class SpotifyAuthService {
  private refreshAccessTokenPromise: Promise<string> | null = null;

  constructor(private readonly accountService: AccountService = getAccountService()) {}

  async startLoginWindow(): Promise<AccountLoginStartResult> {
    const verifier = createCodeVerifier();
    const challenge = createCodeChallenge(verifier);
    const state = base64Url(randomBytes(24));
    const authConfig = getSpotifyAuthConfig();
    const code = await this.requestAuthorizationCode(challenge, state, authConfig);
    const redirectUri = code.redirectUri;
    const token = await exchangeToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code.code,
        redirect_uri: redirectUri,
        client_id: authConfig.clientId,
        code_verifier: verifier,
      }),
    );
    const profile = await this.fetchProfile(token.access_token!);
    const status = this.accountService.saveSpotifyTokens({
      accessToken: token.access_token!,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      username: profile.id ?? profile.email ?? null,
      displayName: profile.display_name ?? profile.email ?? profile.id ?? null,
      avatarUrl: profile.images?.find((image) => image.url)?.url ?? null,
    });

    return {
      status,
      saved: true,
      message: 'Spotify sign-in saved. Spotify streaming uses the official Web Playback SDK and is not available for downloads.',
    };
  }

  async getAccessToken(): Promise<string> {
    const record = this.accountService.getSpotifyTokenRecord();
    if (!record?.accessToken && !record?.refreshToken) {
      throw new Error('Spotify is not signed in. Open Settings > Integrations and sign in first.');
    }

    getSpotifyAuthConfig();

    if (record.accessToken && !tokenExpiredOrMissing(record.expiresAt)) {
      return record.accessToken;
    }

    if (!record.refreshToken) {
      throw new Error('Spotify session expired. Sign in again from Settings.');
    }

    this.refreshAccessTokenPromise ??= this.refreshAccessToken({
      refreshToken: record.refreshToken,
      scope: record.scope,
    }).finally(() => {
      this.refreshAccessTokenPromise = null;
    });

    return this.refreshAccessTokenPromise;
  }

  async checkAccount(): Promise<AccountStatus> {
    try {
      const profile = await this.fetchProfile(await this.getAccessToken());
      return this.accountService.updateSpotifyCheckStatus({
        username: profile.id ?? profile.email ?? null,
        displayName: profile.display_name ?? profile.email ?? profile.id ?? null,
        avatarUrl: profile.images?.find((image) => image.url)?.url ?? null,
        error: profile.product === 'premium' ? null : 'Spotify Premium is required for Web Playback SDK streaming.',
      });
    } catch (error) {
      return this.accountService.updateSpotifyCheckStatus({
        username: null,
        displayName: null,
        avatarUrl: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async startPlayback(input: { deviceId: string; uri: string; positionMs?: number }): Promise<void> {
    await spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(input.deviceId)}`, {
      method: 'PUT',
      token: await this.getAccessToken(),
      body: {
        uris: [input.uri],
        position_ms: Math.max(0, Math.round(input.positionMs ?? 0)),
      },
    });
  }

  async getDevices(options: { timeoutMs?: number } = {}): Promise<SpotifyConnectDevice[]> {
    const data = await spotifyFetch<SpotifyDevicesResponse>('/me/player/devices', {
      token: await this.getAccessToken(),
      timeoutMs: options.timeoutMs,
    });
    return (data.devices ?? [])
      .filter((device): device is NonNullable<SpotifyDevicesResponse['devices']>[number] & { id: string } =>
        typeof device.id === 'string' && device.id.trim().length > 0,
      )
      .map((device) => ({
        id: device.id.trim(),
        name: device.name?.trim() || 'Spotify Connect',
        type: device.type?.trim() || 'Unknown',
        isActive: device.is_active === true,
        isRestricted: device.is_restricted === true,
        volumePercent: typeof device.volume_percent === 'number' && Number.isFinite(device.volume_percent) ? device.volume_percent : null,
      }));
  }

  async ensureConnectDevice(input: SpotifyEnsureConnectDeviceRequest): Promise<SpotifyEnsureConnectDeviceResult> {
    const uri = input.uri.trim();
    if (!isSpotifyTrackUri(uri)) {
      throw new Error('Spotify track uri is required before launching the official player.');
    }

    const webUrl = normalizeSpotifyWebUrl(input.webUrl, uri);
    const startedAt = Date.now();
    let launched: SpotifyEnsureConnectDeviceResult['launched'] = 'none';
    let lastDeviceError: string | null = null;
    const readDevices = async (): Promise<SpotifyConnectDevice[]> => {
      try {
        return await this.getDevices({ timeoutMs: spotifyConnectDevicePollTimeoutMs });
      } catch (error) {
        lastDeviceError = errorMessage(error);
        return [];
      }
    };
    const waitForDevice = async (deadlineMs: number): Promise<SpotifyConnectDevice | null> => {
      while (Date.now() - startedAt < deadlineMs) {
        await delay(spotifyConnectPollIntervalMs);
        const nextDevice = pickSpotifyDevice(await readDevices(), input.preferredDeviceId);
        if (nextDevice) {
          return nextDevice;
        }
      }

      return null;
    };

    let device = pickSpotifyDevice(await readDevices(), input.preferredDeviceId);
    if (device) {
      return {
        deviceId: device.id,
        deviceName: device.name,
        launched,
        waitedMs: Date.now() - startedAt,
      };
    }

    launched = 'desktop';
    await shell.openExternal('spotify:').catch(() => undefined);

    device = await waitForDevice(spotifyConnectDesktopWaitMs);
    if (device) {
      return {
        deviceId: device.id,
        deviceName: device.name,
        launched,
        waitedMs: Date.now() - startedAt,
      };
    }

    launched = 'web';
    await shell.openExternal(webUrl).catch(() => undefined);

    device = await waitForDevice(spotifyConnectTotalWaitMs);
    if (device) {
      return {
        deviceId: device.id,
        deviceName: device.name,
        launched,
        waitedMs: Date.now() - startedAt,
      };
    }

    const diagnostic = lastDeviceError ? ` 最近一次设备检查失败：${lastDeviceError}` : '';
    throw new Error(`请在打开的 Spotify 桌面端或网页中点击一次播放，然后回到 ECHO 再点播放，ECHO 会接管 Spotify Connect 控制。${diagnostic}`);
  }

  async getPlaybackState(): Promise<SpotifyPlaybackState> {
    const data = await spotifyFetch<SpotifyPlaybackStateResponse>('/me/player', { token: await this.getAccessToken() });
    if (!data) {
      return {
        isPlaying: false,
        progressMs: null,
        itemUri: null,
        deviceId: null,
        deviceName: null,
      };
    }

    return {
      isPlaying: data.is_playing === true,
      progressMs: typeof data.progress_ms === 'number' && Number.isFinite(data.progress_ms) ? data.progress_ms : null,
      itemUri: data.item?.uri?.trim() || null,
      deviceId: data.device?.id?.trim() || null,
      deviceName: data.device?.name?.trim() || null,
    };
  }

  async transferPlayback(input: { deviceId: string; play?: boolean }): Promise<void> {
    await spotifyFetch<void>('/me/player', {
      method: 'PUT',
      token: await this.getAccessToken(),
      body: {
        device_ids: [input.deviceId],
        play: input.play === true,
      },
    });
  }

  async pause(deviceId?: string | null): Promise<void> {
    const suffix = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    await spotifyFetch<void>(`/me/player/pause${suffix}`, { method: 'PUT', token: await this.getAccessToken() });
  }

  async resume(deviceId?: string | null): Promise<void> {
    const suffix = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    await spotifyFetch<void>(`/me/player/play${suffix}`, { method: 'PUT', token: await this.getAccessToken() });
  }

  async seek(positionMs: number, deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ position_ms: String(Math.max(0, Math.round(positionMs))) });
    if (deviceId) {
      params.set('device_id', deviceId);
    }
    await spotifyFetch<void>(`/me/player/seek?${params.toString()}`, { method: 'PUT', token: await this.getAccessToken() });
  }

  async setVolume(volume: number, deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ volume_percent: String(Math.max(0, Math.min(100, Math.round(volume * 100)))) });
    if (deviceId) {
      params.set('device_id', deviceId);
    }
    await spotifyFetch<void>(`/me/player/volume?${params.toString()}`, { method: 'PUT', token: await this.getAccessToken() });
  }

  private async fetchProfile(accessToken: string): Promise<SpotifyProfileResponse> {
    return spotifyFetch<SpotifyProfileResponse>('/me', { token: accessToken });
  }

  private async refreshAccessToken(record: { refreshToken?: string | null; scope?: string | null }): Promise<string> {
    const authConfig = getSpotifyAuthConfig();
    const token = await exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: record.refreshToken ?? '',
        client_id: authConfig.clientId,
      }),
    );

    this.accountService.saveSpotifyTokens({
      accessToken: token.access_token!,
      refreshToken: token.refresh_token ?? record.refreshToken,
      tokenType: token.token_type,
      scope: token.scope ?? record.scope,
      expiresAt: expiresAtFromSeconds(token.expires_in),
    });

    return token.access_token!;
  }

  private async requestAuthorizationCode(
    challenge: string,
    state: string,
    authConfig: SpotifyAuthConfig,
  ): Promise<{ code: string; redirectUri: string }> {
    activeSpotifyLoginCleanup?.();
    activeSpotifyLoginCleanup = null;

    const server = createServer();
    const redirectUri = authConfig.redirectUri;
    const redirectUrl = new URL(redirectUri);
    const redirectPort = Number.parseInt(redirectUrl.port, 10);
    const redirectPath = redirectUrl.pathname || '/';
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Spotify callback port is already in use. Close the app using ${redirectUri}, or set a different Spotify redirect URI.`));
          return;
        }

        reject(error);
      });
      server.listen(redirectPort, '127.0.0.1', () => {
        resolve();
      });
    });
    const authUrl = new URL(`${spotifyAccountsBaseUrl}/authorize`);
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: authConfig.clientId,
      scope: spotifyScopes.join(' '),
      redirect_uri: redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();

    const codePromise = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        if (activeSpotifyLoginCleanup === cleanup) {
          activeSpotifyLoginCleanup = null;
        }
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        server.close(() => undefined);
      };

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      activeSpotifyLoginCleanup = cleanup;
      timeout = setTimeout(() => fail(new Error('Spotify sign-in timed out.')), 5 * 60 * 1000);

      server.on('request', (request, response) => {
        const requestUrl = new URL(request.url ?? '/', redirectUri);
        if (requestUrl.pathname !== redirectPath) {
          response.writeHead(404);
          response.end();
          return;
        }

        const returnedState = requestUrl.searchParams.get('state');
        const returnedCode = requestUrl.searchParams.get('code');
        const returnedError = requestUrl.searchParams.get('error');

        response.writeHead(returnedCode ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>ECHO Spotify</title><p>You can close this window and return to ECHO Next.</p>');

        if (returnedState !== state) {
          fail(new Error('Spotify sign-in state mismatch. Please try again.'));
          return;
        }
        if (returnedError) {
          fail(new Error(`Spotify sign-in failed: ${returnedError}`));
          return;
        }
        if (!returnedCode) {
          fail(new Error('Spotify sign-in did not return an authorization code.'));
          return;
        }

        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({ code: returnedCode, redirectUri });
      });

      void shell.openExternal(authUrl.toString()).catch((error) => {
        fail(new Error(`Failed to open Spotify login in the system browser: ${errorMessage(error)}`));
      });
    });

    return codePromise;
  }
}

export const getSpotifyRedirectUri = (): string => getSpotifyAuthConfig().redirectUri;

let spotifyAuthService: SpotifyAuthService | null = null;

export const getSpotifyAuthService = (): SpotifyAuthService => {
  spotifyAuthService ??= new SpotifyAuthService();
  return spotifyAuthService;
};
