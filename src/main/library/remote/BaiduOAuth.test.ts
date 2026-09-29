import { describe, expect, it, vi } from 'vitest';
import {
  createBaiduOAuthAuthorizeUrl,
  encodeBaiduOAuthTokenSecret,
  exchangeBaiduOAuthCode,
  extractBaiduOAuthAccessToken,
  extractBaiduOAuthCode,
  readBaiduAccessTokenFromSecret,
  refreshBaiduOAuthToken,
  shouldRefreshBaiduOAuthToken,
  startBaiduOAuthLogin,
} from './BaiduOAuth';

describe('BaiduOAuth', () => {
  it('builds an OAuth authorize URL with netdisk scope and QR login', () => {
    const url = new URL(createBaiduOAuthAuthorizeUrl({
      clientId: 'client-id',
      redirectUri: 'oob',
      state: 'state-1',
    }));

    expect(url.origin + url.pathname).toBe('https://openapi.baidu.com/oauth/2.0/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('oob');
    expect(url.searchParams.get('scope')).toBe('basic,netdisk');
    expect(url.searchParams.get('qrcode')).toBe('1');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('builds an implicit OAuth token URL for users without a secret key', () => {
    const url = new URL(createBaiduOAuthAuthorizeUrl({
      clientId: 'client-id',
      redirectUri: 'oob',
      responseType: 'token',
    }));

    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe('basic,netdisk');
  });

  it('uses the built-in ECHO Baidu app when no client id is supplied', () => {
    const url = new URL(createBaiduOAuthAuthorizeUrl({
      redirectUri: 'http://127.0.0.1:53682/baidu/oauth/callback',
    }));

    expect(url.searchParams.get('client_id')).toBe('cl0ccRUduD69wdXhiqnK6ohR0gKrrNBm');
  });

  it('exchanges an auth code and encodes the token payload as a secret', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 2592000,
        scope: 'basic netdisk',
      }),
    } as Response);

    const result = await exchangeBaiduOAuthCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
      code: 'auth-code',
    }, fetcher as unknown as typeof fetch);
    const url = new URL(fetcher.mock.calls[0][0]);

    expect(url.origin + url.pathname).toBe('https://openapi.baidu.com/oauth/2.0/token');
    expect(url.searchParams.get('grant_type')).toBe('authorization_code');
    expect(url.searchParams.get('code')).toBe('auth-code');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(readBaiduAccessTokenFromSecret(result.tokenSecret)).toBe('access-token');
  });

  it('exchanges an auth code with the built-in ECHO app credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 2592000,
        scope: 'basic netdisk',
      }),
    } as Response);

    const result = await exchangeBaiduOAuthCode({
      redirectUri: 'http://127.0.0.1:53682/baidu/oauth/callback',
      code: 'auth-code',
    }, fetcher as unknown as typeof fetch);
    const url = new URL(fetcher.mock.calls[0][0]);

    expect(url.searchParams.get('client_id')).toBe('cl0ccRUduD69wdXhiqnK6ohR0gKrrNBm');
    expect(url.searchParams.get('client_secret')).toBe('kMFrmKo7zwn4eoIBe1uLUUg5NHUZRKXE');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('extracts auth code from full callback text', () => {
    expect(extractBaiduOAuthCode('https://example.test/callback?code=auth-code&state=state-1')).toBe('auth-code');
    expect(extractBaiduOAuthCode('openapi login_success code=encoded%20code')).toBe('encoded code');
    expect(extractBaiduOAuthCode('plain-code')).toBe('plain-code');
  });

  it('extracts access token from full callback text', () => {
    expect(extractBaiduOAuthAccessToken('https://openapi.baidu.com/oauth/2.0/login_success#expires_in=2592000&access_token=token-1')).toBe('token-1');
    expect(extractBaiduOAuthAccessToken('login_success access_token=encoded%20token expires_in=1')).toBe('encoded token');
    expect(extractBaiduOAuthAccessToken('plain-token')).toBe('plain-token');
  });

  it('keeps manual access tokens compatible', () => {
    expect(readBaiduAccessTokenFromSecret('manual-token')).toBe('manual-token');
  });

  it('refreshes expired OAuth token secrets', async () => {
    const secret = {
      type: 'baidu-oauth-token' as const,
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 2592000,
        scope: 'basic netdisk',
      }),
    } as Response);

    expect(shouldRefreshBaiduOAuthToken(secret)).toBe(true);
    const result = await refreshBaiduOAuthToken(secret, fetcher as unknown as typeof fetch);
    const url = new URL(fetcher.mock.calls[0][0]);

    expect(url.searchParams.get('grant_type')).toBe('refresh_token');
    expect(url.searchParams.get('refresh_token')).toBe('refresh-token');
    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(readBaiduAccessTokenFromSecret(result.tokenSecret)).toBe('new-access-token');
  });

  it('does not refresh manual tokens', () => {
    const tokenSecret = encodeBaiduOAuthTokenSecret({
      accessToken: 'manual-like-access-token',
      expiresAt: null,
    });

    expect(readBaiduAccessTokenFromSecret(tokenSecret)).toBe('manual-like-access-token');
  });

  it('completes loopback account login and exchanges the callback code', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'login-access-token',
        refresh_token: 'login-refresh-token',
        expires_in: 2592000,
        scope: 'basic netdisk',
      }),
    } as Response);

    const result = await startBaiduOAuthLogin({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://127.0.0.1:53683/baidu/oauth/callback',
      timeoutMs: 1000,
    }, {
      fetcher: fetcher as unknown as typeof fetch,
      openUrl: async (url) => {
        const authorizeUrl = new URL(url);
        const state = authorizeUrl.searchParams.get('state');
        await fetch(`http://127.0.0.1:53683/baidu/oauth/callback?code=auth-code&state=${state}`);
      },
    });
    const tokenUrl = new URL(fetcher.mock.calls[0][0]);

    expect(tokenUrl.searchParams.get('code')).toBe('auth-code');
    expect(tokenUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53683/baidu/oauth/callback');
    expect(result.accessToken).toBe('login-access-token');
    expect(result.refreshToken).toBe('login-refresh-token');
  });

  it('rejects account login without a loopback callback URL', async () => {
    await expect(startBaiduOAuthLogin({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'oob',
      timeoutMs: 1000,
    })).rejects.toThrow('本机回调地址');
  });
});
