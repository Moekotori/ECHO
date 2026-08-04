import { mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './AccountService';
import { TidalAuthService } from './TidalAuthService';

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}));
const appSettingsMock = vi.hoisted(() => ({
  current: {
    tidalClientId: 'vmtQLf79BHl9YgUT',
    tidalRedirectUri: null as string | null,
    tidalCountryCode: 'US',
  },
}));
const tempDirs: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
  },
  shell: {
    openExternal,
  },
}));

vi.mock('../app/appSettings', () => ({
  defaultTidalClientId: 'vmtQLf79BHl9YgUT',
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

const createTidalFixture = (
  overrides: Partial<Parameters<AccountService['saveTidalTokens']>[0]> = {},
): { accountService: AccountService; service: TidalAuthService } => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-tidal-auth-'));
  tempDirs.push(dir);
  const accountService = new AccountService(join(dir, 'accounts.json'));
  accountService.saveTidalTokens({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    username: 'tidal',
    displayName: 'TIDAL account',
    avatarUrl: null,
    ...overrides,
  });
  return {
    accountService,
    service: new TidalAuthService(accountService),
  };
};

const createTidalService = (overrides: Partial<Parameters<AccountService['saveTidalTokens']>[0]> = {}): TidalAuthService => {
  return createTidalFixture(overrides).service;
};

afterEach(() => {
  vi.unstubAllGlobals();
  appSettingsMock.current = {
    tidalClientId: 'vmtQLf79BHl9YgUT',
    tidalRedirectUri: null,
    tidalCountryCode: 'US',
  };
  openExternal.mockClear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('TidalAuthService', () => {
  it('refreshes expired OAuth tokens without a client secret', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-token');
      expect(body.has('client_secret')).toBe(false);
      return jsonResponse({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = createTidalService({
      accessToken: 'expired-access-token',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(service.getAccessToken()).resolves.toBe('fresh-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks saved login without probing the TIDAL catalog API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { accountService, service } = createTidalFixture();
    accountService.updateTidalCheckStatus({
      username: 'tidal-user',
      displayName: 'TIDAL User',
      avatarUrl: null,
      error: 'previous catalog check failed',
    });

    const status = await service.checkAccount();

    expect(status.connected).toBe(true);
    expect(status.error).toBeNull();
    expect(status.username).toBe('tidal-user');
    expect(status.displayName).toBe('TIDAL User');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the saved TIDAL identity when token refresh fails', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = createTidalService({
      accessToken: 'expired-access-token',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      username: 'tidal-user',
      displayName: 'TIDAL User',
    });

    const status = await service.checkAccount();

    expect(status.connected).toBe(true);
    expect(status.username).toBe('tidal-user');
    expect(status.displayName).toBe('TIDAL User');
    expect(status.error).toContain('refresh token expired');
  });

  it('opens TIDAL OAuth with PKCE and saves returned tokens', async () => {
    appSettingsMock.current = {
      tidalClientId: 'vmtQLf79BHl9YgUT',
      tidalRedirectUri: 'http://127.0.0.1:43992/tidal/custom-callback',
      tidalCountryCode: 'HK',
    };
    const dir = mkdtempSync(join(tmpdir(), 'echo-tidal-login-'));
    tempDirs.push(dir);
    const accountService = new AccountService(join(dir, 'accounts.json'));
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (target === 'https://auth.tidal.com/v1/oauth2/token') {
        const body = init?.body as URLSearchParams;
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('client_id')).toBe('vmtQLf79BHl9YgUT');
        expect(body.get('redirect_uri')).toBe('http://127.0.0.1:43992/tidal/custom-callback');
        expect(body.get('client_secret')).toBeNull();
        return jsonResponse({
          access_token: 'login-access-token',
          refresh_token: 'login-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }

      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    openExternal.mockImplementationOnce(async (url: string) => {
      const authUrl = new URL(url);
      expect(authUrl.origin).toBe('https://login.tidal.com');
      expect(authUrl.pathname).toBe('/authorize');
      expect(authUrl.searchParams.get('client_id')).toBe('vmtQLf79BHl9YgUT');
      expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43992/tidal/custom-callback');
      expect(authUrl.searchParams.get('scope')).toBe('search.read');
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
      await requestLocalCallback(
        `${authUrl.searchParams.get('redirect_uri')}?code=authorization-code&state=${authUrl.searchParams.get('state')}`,
      );
    });

    const result = await new TidalAuthService(accountService).startLoginWindow();

    expect(result.saved).toBe(true);
    expect(result.status.connected).toBe(true);
    expect(accountService.getTidalTokenRecord()?.refreshToken).toBe('login-refresh-token');
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
