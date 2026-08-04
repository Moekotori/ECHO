import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './AccountService';
import { SpotifyAuthService } from './SpotifyAuthService';

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}));
const appSettingsMock = vi.hoisted(() => ({
  current: {
    spotifyClientId: null as string | null,
    spotifyRedirectUri: null as string | null,
  },
}));
const tempDirs: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
  },
  BrowserWindow: vi.fn(),
  shell: {
    openExternal,
  },
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: () => appSettingsMock.current,
}));

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const requestLocalCallback = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('error', reject);
  });

const createSpotifyService = (overrides: Partial<Parameters<AccountService['saveSpotifyTokens']>[0]> = {}): SpotifyAuthService => {
  appSettingsMock.current = {
    spotifyClientId: appSettingsMock.current.spotifyClientId ?? 'testSpotifyClient123',
    spotifyRedirectUri: appSettingsMock.current.spotifyRedirectUri,
  };
  const dir = mkdtempSync(join(tmpdir(), 'echo-spotify-auth-'));
  tempDirs.push(dir);
  const accountService = new AccountService(join(dir, 'accounts.json'));
  accountService.saveSpotifyTokens({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    scope: 'streaming user-read-playback-state user-modify-playback-state',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    username: 'spotify-user',
    displayName: 'Spotify User',
    avatarUrl: null,
    ...overrides,
  });
  return new SpotifyAuthService(accountService);
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  appSettingsMock.current = {
    spotifyClientId: null,
    spotifyRedirectUri: null,
  };
  openExternal.mockClear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SpotifyAuthService ensureConnectDevice', () => {
  it('uses an existing Spotify Connect device without opening external players', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      devices: [
        {
          id: 'device-1',
          name: 'Spotify Desktop',
          type: 'Computer',
          is_active: true,
          is_restricted: false,
          volume_percent: 42,
        },
      ],
    })));

    const result = await createSpotifyService().ensureConnectDevice({
      uri: 'spotify:track:abc123',
      webUrl: 'https://open.spotify.com/track/abc123',
    });

    expect(result).toMatchObject({
      deviceId: 'device-1',
      deviceName: 'Spotify Desktop',
      launched: 'none',
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens desktop first, then web player, and resolves when a device appears', async () => {
    vi.useFakeTimers();
    let deviceCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      deviceCalls += 1;
      return jsonResponse({
        devices: deviceCalls >= 11
          ? [
              {
                id: 'device-web',
                name: 'Spotify Web Player',
                type: 'Computer',
                is_active: false,
                is_restricted: false,
                volume_percent: null,
              },
            ]
          : [],
      });
    }));

    const promise = createSpotifyService().ensureConnectDevice({
      uri: 'spotify:track:abc123',
      webUrl: 'https://open.spotify.com/track/abc123',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(openExternal).toHaveBeenNthCalledWith(1, 'spotify:');
    expect(openExternal).toHaveBeenNthCalledWith(2, 'https://open.spotify.com/track/abc123');
    expect(result).toMatchObject({
      deviceId: 'device-web',
      deviceName: 'Spotify Web Player',
      launched: 'web',
    });
  });

  it('keeps polling devices after a transient discovery failure', async () => {
    vi.useFakeTimers();
    const service = createSpotifyService();
    let deviceCalls = 0;
    vi.spyOn(service, 'getDevices').mockImplementation(async () => {
      deviceCalls += 1;
      if (deviceCalls === 1) {
        throw new Error('device request timed out');
      }

      return deviceCalls >= 3
        ? [
            {
              id: 'device-desktop',
              name: 'Spotify Desktop',
              type: 'Computer',
              isActive: false,
              isRestricted: false,
              volumePercent: 50,
            },
          ]
        : [];
    });

    const promise = service.ensureConnectDevice({
      uri: 'spotify:track:abc123',
      webUrl: 'https://open.spotify.com/track/abc123',
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(openExternal).toHaveBeenCalledWith('spotify:');
    expect(result).toMatchObject({
      deviceId: 'device-desktop',
      launched: 'desktop',
    });
  });
});

describe('SpotifyAuthService token refresh', () => {
  it('coalesces concurrent access-token refreshes', async () => {
    appSettingsMock.current = {
      spotifyClientId: 'customSpotifyClient123',
      spotifyRedirectUri: null,
    };
    const fetchMock = vi.fn(async () => jsonResponse({
      access_token: 'fresh-access-token',
      refresh_token: 'fresh-refresh-token',
      token_type: 'Bearer',
      scope: 'streaming',
      expires_in: 3600,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createSpotifyService({
      accessToken: 'expired-access-token',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const [left, right] = await Promise.all([service.getAccessToken(), service.getAccessToken()]);

    expect(left).toBe('fresh-access-token');
    expect(right).toBe('fresh-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('SpotifyAuthService login', () => {
  it('requires a user-provided Spotify Client ID before login', async () => {
    await expect(new SpotifyAuthService().startLoginWindow()).rejects.toThrow('Spotify Client ID');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens OAuth in the system browser with the configured Spotify app', async () => {
    appSettingsMock.current = {
      spotifyClientId: 'customSpotifyClient123',
      spotifyRedirectUri: 'http://127.0.0.1:43991/spotify/custom-callback',
    };
    const dir = mkdtempSync(join(tmpdir(), 'echo-spotify-login-'));
    tempDirs.push(dir);
    const accountService = new AccountService(join(dir, 'accounts.json'));
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (target === 'https://accounts.spotify.com/api/token') {
        const body = init?.body as URLSearchParams;
        expect(body.get('client_id')).toBe('customSpotifyClient123');
        expect(body.get('redirect_uri')).toBe('http://127.0.0.1:43991/spotify/custom-callback');
        return jsonResponse({
          access_token: 'login-access-token',
          refresh_token: 'login-refresh-token',
          token_type: 'Bearer',
          scope: 'streaming',
          expires_in: 3600,
        });
      }

      if (target === 'https://api.spotify.com/v1/me') {
        return jsonResponse({
          id: 'spotify-user',
          display_name: 'Spotify User',
          product: 'premium',
        });
      }

      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    openExternal.mockImplementationOnce(async (url: string) => {
      const authUrl = new URL(url);
      expect(authUrl.origin).toBe('https://accounts.spotify.com');
      expect(authUrl.pathname).toBe('/authorize');
      expect(authUrl.searchParams.get('client_id')).toBe('customSpotifyClient123');
      expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43991/spotify/custom-callback');
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authUrl.searchParams.get('scope')).toContain('playlist-read-collaborative');
      await requestLocalCallback(
        `${authUrl.searchParams.get('redirect_uri')}?code=authorization-code&state=${authUrl.searchParams.get('state')}`,
      );
    });

    const result = await new SpotifyAuthService(accountService).startLoginWindow();

    expect(result.saved).toBe(true);
    expect(result.status.connected).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
