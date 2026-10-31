import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  BaiduOAuthAuthorizeRequest,
  BaiduOAuthLoginRequest,
  BaiduOAuthTokenRequest,
  BaiduOAuthTokenResult,
} from '../../../shared/types/remoteSources';

export const baiduOAuthAuthorizeEndpoint = 'https://openapi.baidu.com/oauth/2.0/authorize';
export const baiduOAuthTokenEndpoint = 'https://openapi.baidu.com/oauth/2.0/token';
export const defaultBaiduOAuthRedirectUri = 'oob';
export const defaultBaiduOAuthLoopbackRedirectUri = 'http://127.0.0.1:53682/baidu/oauth/callback';
export const baiduOAuthScope = 'basic,netdisk';
const baiduTokenRefreshSkewMs = 5 * 60 * 1000;
const defaultBaiduOAuthLoginTimeoutMs = 2 * 60 * 1000;

export const echoBaiduOAuthApp = {
  appId: process.env.ECHO_BAIDU_APP_ID?.trim() || '123499878',
  clientId: process.env.ECHO_BAIDU_APP_KEY?.trim() || 'cl0ccRUduD69wdXhiqnK6ohR0gKrrNBm',
  clientSecret: process.env.ECHO_BAIDU_SECRET_KEY?.trim() || 'kMFrmKo7zwn4eoIBe1uLUUg5NHUZRKXE',
  signKey: process.env.ECHO_BAIDU_SIGN_KEY?.trim() || 'Mk6xIQ0LSHvXfKlVFq0P9PVQ*^FGza+k',
};

export type BaiduOAuthTokenSecret = {
  type: 'baidu-oauth-token';
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
};

export type BaiduOAuthLoginDependencies = {
  fetcher?: typeof fetch;
  openUrl?: (url: string) => Promise<void>;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const requireText = (value: unknown, name: string): string => {
  const normalized = text(value);
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
};

const resolveClientId = (value: unknown): string =>
  text(value) ?? requireText(echoBaiduOAuthApp.clientId, 'Baidu OAuth clientId');

const resolveClientSecret = (value: unknown): string =>
  text(value) ?? requireText(echoBaiduOAuthApp.clientSecret, 'Baidu OAuth clientSecret');

const numberOrNull = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const expiresAtFromSeconds = (expiresIn: number | null): string | null =>
  expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

const sendOAuthCallbackPage = (response: ServerResponse, title: string, body: string): void => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p>可以回到 ECHO 继续操作。</p></body>`);
};

const requestUrlFor = (request: IncomingMessage, fallbackOrigin: string): URL =>
  new URL(request.url ?? '/', fallbackOrigin);

export const extractBaiduOAuthCode = (value: string): string => {
  const normalized = requireText(value, 'Baidu OAuth code');
  try {
    const url = new URL(normalized);
    const code = text(url.searchParams.get('code'));
    if (code) {
      return code;
    }
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashCode = text(new URLSearchParams(hash).get('code'));
    if (hashCode) {
      return hashCode;
    }
  } catch {
    // Fall through to loose text parsing.
  }

  const match = normalized.match(/(?:^|[?#&\s])code=([^&#\s]+)/iu);
  if (match?.[1]) {
    return decodeURIComponent(match[1].replace(/\+/gu, '%20')).trim();
  }

  return normalized;
};

export const extractBaiduOAuthAccessToken = (value: string): string => {
  const normalized = requireText(value, 'Baidu OAuth access token');
  try {
    const url = new URL(normalized);
    const token = text(url.searchParams.get('access_token'));
    if (token) {
      return token;
    }
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashToken = text(new URLSearchParams(hash).get('access_token'));
    if (hashToken) {
      return hashToken;
    }
  } catch {
    // Fall through to loose text parsing.
  }

  const match = normalized.match(/(?:^|[?#&\s])access_token=([^&#\s]+)/iu);
  if (match?.[1]) {
    return decodeURIComponent(match[1].replace(/\+/gu, '%20')).trim();
  }

  return normalized;
};

const createTokenResult = (input: {
  payload: Record<string, unknown>;
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
  existingRefreshToken?: string | null;
}): BaiduOAuthTokenResult => {
  const accessToken = requireText(input.payload.access_token, 'Baidu OAuth access_token');
  const refreshToken = text(input.payload.refresh_token) ?? text(input.existingRefreshToken);
  const expiresIn = numberOrNull(input.payload.expires_in);
  const expiresAt = expiresAtFromSeconds(expiresIn);
  const scope = text(input.payload.scope);
  const tokenSecret = encodeBaiduOAuthTokenSecret({
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn,
    expiresAt,
    scope,
    tokenSecret,
  };
};

export const createBaiduOAuthAuthorizeUrl = (request: BaiduOAuthAuthorizeRequest): string => {
  const clientId = resolveClientId(request.clientId);
  const redirectUri = text(request.redirectUri) ?? defaultBaiduOAuthRedirectUri;
  const url = new URL(baiduOAuthAuthorizeEndpoint);
  url.searchParams.set('response_type', request.responseType === 'token' ? 'token' : 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', baiduOAuthScope);
  url.searchParams.set('display', 'popup');
  if (request.qrcode !== false) {
    url.searchParams.set('qrcode', '1');
  }
  const state = text(request.state);
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
};

export const encodeBaiduOAuthTokenSecret = (input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
}): string => JSON.stringify({
  type: 'baidu-oauth-token',
  accessToken: requireText(input.accessToken, 'Baidu OAuth accessToken'),
  refreshToken: text(input.refreshToken),
  expiresAt: text(input.expiresAt),
  scope: text(input.scope),
  clientId: text(input.clientId),
  clientSecret: text(input.clientSecret),
  redirectUri: text(input.redirectUri),
} satisfies BaiduOAuthTokenSecret);

export const readBaiduOAuthTokenSecret = (secret: string | null | undefined): BaiduOAuthTokenSecret | null => {
  const normalized = text(secret);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as Partial<BaiduOAuthTokenSecret>;
    const accessToken = parsed.type === 'baidu-oauth-token' ? text(parsed.accessToken) : null;
    if (!accessToken) {
      return null;
    }
    return {
      type: 'baidu-oauth-token',
      accessToken,
      refreshToken: text(parsed.refreshToken),
      expiresAt: text(parsed.expiresAt),
      scope: text(parsed.scope),
      clientId: text(parsed.clientId),
      clientSecret: text(parsed.clientSecret),
      redirectUri: text(parsed.redirectUri),
    };
  } catch {
    return null;
  }
};

export const readBaiduAccessTokenFromSecret = (secret: string | null | undefined): string | null => {
  const normalized = text(secret);
  if (!normalized) {
    return null;
  }

  return readBaiduOAuthTokenSecret(normalized)?.accessToken ?? normalized;
};

export const shouldRefreshBaiduOAuthToken = (
  secret: BaiduOAuthTokenSecret,
  nowMs = Date.now(),
): boolean => {
  const expiresAt = text(secret.expiresAt);
  if (!expiresAt || !secret.refreshToken || !secret.clientId || !secret.clientSecret) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs + baiduTokenRefreshSkewMs;
};

export const exchangeBaiduOAuthCode = async (
  request: BaiduOAuthTokenRequest,
  fetcher: typeof fetch = fetch,
): Promise<BaiduOAuthTokenResult> => {
  const clientId = resolveClientId(request.clientId);
  const clientSecret = resolveClientSecret(request.clientSecret);
  const redirectUri = text(request.redirectUri) ?? defaultBaiduOAuthRedirectUri;
  const code = extractBaiduOAuthCode(request.code);
  const url = new URL(baiduOAuthTokenEndpoint);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('code', code);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('redirect_uri', redirectUri);

  const response = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    const description = text(payload.error_description) ?? text(payload.error) ?? `HTTP ${response.status}`;
    throw new Error(`百度授权失败：${description}`);
  }

  return createTokenResult({
    payload,
    clientId,
    clientSecret,
    redirectUri,
  });
};

export const startBaiduOAuthLogin = async (
  request: BaiduOAuthLoginRequest,
  dependencies: BaiduOAuthLoginDependencies = {},
): Promise<BaiduOAuthTokenResult> => {
  const clientId = resolveClientId(request.clientId);
  const clientSecret = resolveClientSecret(request.clientSecret);
  const redirectUri = text(request.redirectUri) ?? defaultBaiduOAuthLoopbackRedirectUri;
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    throw new Error('百度账号登录需要使用本机回调地址，例如 http://127.0.0.1:53682/baidu/oauth/callback。');
  }
  const isLoopbackHost = redirectUrl.hostname === '127.0.0.1' || redirectUrl.hostname === 'localhost';
  if (redirectUrl.protocol !== 'http:' || !isLoopbackHost || !redirectUrl.port) {
    throw new Error('百度账号登录需要使用本机回调地址，例如 http://127.0.0.1:53682/baidu/oauth/callback。');
  }

  const timeoutMs = Math.max(10_000, Math.min(Number(request.timeoutMs ?? defaultBaiduOAuthLoginTimeoutMs), 10 * 60 * 1000));
  const state = randomUUID();
  const authorizeUrl = createBaiduOAuthAuthorizeUrl({
    clientId,
    redirectUri,
    qrcode: true,
    responseType: 'code',
    state,
  });
  const fetcher = dependencies.fetcher ?? fetch;
  const openUrl = dependencies.openUrl ?? (async () => undefined);

  return await new Promise<BaiduOAuthTokenResult>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const server = createServer((incoming, response) => {
      const url = requestUrlFor(incoming, redirectUrl.origin);
      if (url.pathname !== redirectUrl.pathname) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const error = text(url.searchParams.get('error'));
      if (error) {
        const description = text(url.searchParams.get('error_description')) ?? error;
        sendOAuthCallbackPage(response, '百度授权失败', description);
        if (!settled) {
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          server.close();
          reject(new Error(`百度授权失败：${description}`));
        }
        return;
      }

      const callbackState = text(url.searchParams.get('state'));
      const code = text(url.searchParams.get('code'));
      if (!code) {
        sendOAuthCallbackPage(response, '百度授权失败', '回调里没有授权码。');
        if (!settled) {
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          server.close();
          reject(new Error('百度授权失败：回调里没有授权码。'));
        }
        return;
      }

      if (callbackState !== state) {
        sendOAuthCallbackPage(response, '百度授权失败', '授权状态校验失败。');
        if (!settled) {
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          server.close();
          reject(new Error('百度授权失败：授权状态校验失败。'));
        }
        return;
      }

      sendOAuthCallbackPage(response, '百度授权完成', 'ECHO 已收到授权结果，正在换取 Token。');
      if (!settled) {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        server.close();
        void exchangeBaiduOAuthCode({
          clientId,
          clientSecret,
          redirectUri,
          code,
        }, fetcher).then(resolve, reject);
      }
    });

    server.once('error', (error) => {
      if (!settled) {
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        reject(error);
      }
    });

    server.listen(Number(redirectUrl.port), redirectUrl.hostname, () => {
      timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error('百度账号登录超时，请重新点击登录。'));
        }
      }, timeoutMs);
      void openUrl(authorizeUrl).catch((error) => {
        if (!settled) {
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          server.close();
          reject(error);
        }
      });
    });
  });
};

export const refreshBaiduOAuthToken = async (
  secret: BaiduOAuthTokenSecret,
  fetcher: typeof fetch = fetch,
): Promise<BaiduOAuthTokenResult> => {
  const refreshToken = requireText(secret.refreshToken, 'Baidu OAuth refreshToken');
  const clientId = requireText(secret.clientId, 'Baidu OAuth clientId');
  const clientSecret = requireText(secret.clientSecret, 'Baidu OAuth clientSecret');
  const url = new URL(baiduOAuthTokenEndpoint);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('refresh_token', refreshToken);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);

  const response = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    const description = text(payload.error_description) ?? text(payload.error) ?? `HTTP ${response.status}`;
    throw new Error(`百度 Token 刷新失败：${description}`);
  }

  return createTokenResult({
    payload,
    clientId,
    clientSecret,
    redirectUri: secret.redirectUri,
    existingRefreshToken: refreshToken,
  });
};
