import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';
import type { AccountLoginStartResult, AccountStatus } from '../../shared/types/accounts';
import { defaultTidalClientId, getAppSettings } from '../app/appSettings';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { getAccountService, type AccountService } from './AccountService';

const tidalLoginBaseUrl = 'https://login.tidal.com';
const tidalAuthUrl = 'https://auth.tidal.com/v1/oauth2/token';
const tidalOAuthScope = 'search.read';
const defaultTidalRedirectCallbackPath = '/tidal/callback';
const defaultTidalRedirectPort = Number.parseInt(process.env.ECHO_TIDAL_REDIRECT_PORT ?? '43880', 10);
const envTidalRedirectUri = process.env.ECHO_TIDAL_REDIRECT_URI?.trim() || null;
const fallbackTidalRedirectUri =
  `http://127.0.0.1:${Number.isFinite(defaultTidalRedirectPort) ? defaultTidalRedirectPort : 43880}${defaultTidalRedirectCallbackPath}`;
const tokenRefreshSkewMs = 60_000;
const tidalTokenRequestTimeoutMs = 12_000;

let activeTidalLoginCleanup: (() => void) | null = null;

type TidalAuthConfig = {
  clientId: string;
  redirectUri: string;
  countryCode: string;
};

type TidalTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
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

const abortSignalForTimeout = (timeoutMs: number): AbortSignal | undefined => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isTimeoutLikeError = (error: unknown): boolean => {
  const name = typeof (error as { name?: unknown })?.name === 'string' ? (error as { name: string }).name : '';
  const message = errorMessage(error);
  return /abort|timeout|timed out/iu.test(name) || /abort|timeout|timed out/iu.test(message);
};

const tidalNetworkError = (error: unknown, context: string): Error => {
  if (isTimeoutLikeError(error)) {
    return new Error(`${context} timed out. Check TIDAL connectivity or proxy settings.`);
  }

  return new Error(`${context} failed: ${errorMessage(error)}`);
};

const isValidTidalClientId = (value: string): boolean => /^[A-Za-z0-9_-]{8,128}$/u.test(value);

const normalizeLoopbackRedirectUri = (value: string): string | null => {
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

const normalizeCountryCode = (value: string | null | undefined): string =>
  /^[A-Z]{2}$/u.test(value?.trim().toUpperCase() ?? '') ? value!.trim().toUpperCase() : 'US';

const tidalStatusIdentity = (
  record: ReturnType<AccountService['getTidalTokenRecord']>,
): Pick<AccountStatus, 'username' | 'displayName' | 'avatarUrl'> => {
  if (!record?.accessToken && !record?.refreshToken) {
    return {
      username: null,
      displayName: null,
      avatarUrl: null,
    };
  }

  return {
    username: record.username ?? 'tidal',
    displayName: record.displayName ?? record.username ?? 'TIDAL account',
    avatarUrl: record.avatarUrl ?? null,
  };
};

const getTidalAuthConfig = (): TidalAuthConfig => {
  const settings = getAppSettings();
  const configuredClientId = settings.tidalClientId?.trim() || defaultTidalClientId;
  if (!isValidTidalClientId(configuredClientId)) {
    throw new Error('Please configure a valid TIDAL Client ID in Settings > Integrations.');
  }

  const redirectUri =
    normalizeLoopbackRedirectUri(settings.tidalRedirectUri ?? '') ??
    normalizeLoopbackRedirectUri(envTidalRedirectUri ?? '') ??
    normalizeLoopbackRedirectUri(fallbackTidalRedirectUri);

  if (!redirectUri) {
    throw new Error('TIDAL redirect URI must be an http://127.0.0.1:PORT/... loopback URI.');
  }

  return {
    clientId: configuredClientId,
    redirectUri,
    countryCode: normalizeCountryCode(settings.tidalCountryCode),
  };
};

const exchangeToken = async (body: URLSearchParams): Promise<TidalTokenResponse> => {
  let response: Response;
  try {
    response = await fetchWithNetworkProxy(tidalAuthUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ECHO-Next/0.1',
      },
      body,
      signal: abortSignalForTimeout(tidalTokenRequestTimeoutMs),
    });
  } catch (error) {
    throw tidalNetworkError(error, 'TIDAL token request');
  }

  const payload = (await response.json().catch(() => ({}))) as TidalTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? `TIDAL token request failed with HTTP ${response.status}`);
  }

  return payload;
};

export class TidalAuthService {
  private refreshAccessTokenPromise: Promise<string> | null = null;

  constructor(private readonly accountService: AccountService = getAccountService()) {}

  async startLoginWindow(): Promise<AccountLoginStartResult> {
    const verifier = createCodeVerifier();
    const challenge = createCodeChallenge(verifier);
    const state = base64Url(randomBytes(24));
    const authConfig = getTidalAuthConfig();
    const code = await this.requestAuthorizationCode(challenge, state, authConfig);
    const token = await exchangeToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code.code,
        redirect_uri: code.redirectUri,
        client_id: authConfig.clientId,
        code_verifier: verifier,
      }),
    );
    const status = this.accountService.saveTidalTokens({
      accessToken: token.access_token!,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope,
      expiresAt: expiresAtFromSeconds(token.expires_in),
      username: 'tidal',
      displayName: 'TIDAL account',
      avatarUrl: null,
    });

    return {
      status,
      saved: true,
      message: 'TIDAL sign-in saved. ECHO will use TIDAL metadata only; playback stays on official TIDAL surfaces.',
    };
  }

  async getAccessToken(): Promise<string> {
    const record = this.accountService.getTidalTokenRecord();
    if (!record?.accessToken && !record?.refreshToken) {
      throw new Error('TIDAL is not signed in. Open Settings > Integrations and sign in first.');
    }

    getTidalAuthConfig();

    if (record.accessToken && !tokenExpiredOrMissing(record.expiresAt)) {
      return record.accessToken;
    }

    if (!record.refreshToken) {
      throw new Error('TIDAL session expired. Sign in again from Settings.');
    }

    this.refreshAccessTokenPromise ??= this.refreshAccessToken(record.refreshToken).finally(() => {
      this.refreshAccessTokenPromise = null;
    });

    return this.refreshAccessTokenPromise;
  }

  async checkAccount(): Promise<AccountStatus> {
    const previousRecord = this.accountService.getTidalTokenRecord();
    try {
      await this.getAccessToken();
      const currentRecord = this.accountService.getTidalTokenRecord();

      return this.accountService.updateTidalCheckStatus({
        ...tidalStatusIdentity(currentRecord),
        error: null,
      });
    } catch (error) {
      return this.accountService.updateTidalCheckStatus({
        ...tidalStatusIdentity(previousRecord),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getCountryCode(): string {
    return getTidalAuthConfig().countryCode;
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const token = await exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );

    this.accountService.saveTidalTokens({
      accessToken: token.access_token!,
      refreshToken: token.refresh_token ?? refreshToken,
      tokenType: token.token_type,
      scope: token.scope,
      expiresAt: expiresAtFromSeconds(token.expires_in),
    });

    return token.access_token!;
  }

  private async requestAuthorizationCode(
    challenge: string,
    state: string,
    authConfig: TidalAuthConfig,
  ): Promise<{ code: string; redirectUri: string }> {
    activeTidalLoginCleanup?.();
    activeTidalLoginCleanup = null;

    const server = createServer();
    const redirectUri = authConfig.redirectUri;
    const redirectUrl = new URL(redirectUri);
    const redirectPort = Number.parseInt(redirectUrl.port, 10);
    const redirectPath = redirectUrl.pathname || '/';
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`TIDAL callback port is already in use. Close the app using ${redirectUri}, or set a different TIDAL redirect URI.`));
          return;
        }

        reject(error);
      });
      server.listen(redirectPort, '127.0.0.1', () => resolve());
    });

    const authUrl = new URL(`${tidalLoginBaseUrl}/authorize`);
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: authConfig.clientId,
      redirect_uri: redirectUri,
      scope: tidalOAuthScope,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();

    const codePromise = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        if (activeTidalLoginCleanup === cleanup) {
          activeTidalLoginCleanup = null;
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

      activeTidalLoginCleanup = cleanup;
      timeout = setTimeout(() => fail(new Error('TIDAL sign-in timed out.')), 5 * 60 * 1000);

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
        const returnedErrorDescription = requestUrl.searchParams.get('error_description');

        response.writeHead(returnedCode ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>ECHO TIDAL</title><p>You can close this window and return to ECHO Next.</p>');

        if (returnedState !== state) {
          fail(new Error('TIDAL sign-in state mismatch. Please try again.'));
          return;
        }
        if (returnedError) {
          fail(new Error(`TIDAL sign-in failed: ${returnedErrorDescription ?? returnedError}`));
          return;
        }
        if (!returnedCode) {
          fail(new Error('TIDAL sign-in did not return an authorization code.'));
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
        fail(new Error(`Failed to open TIDAL login in the system browser: ${errorMessage(error)}`));
      });
    });

    return codePromise;
  }
}

let tidalAuthService: TidalAuthService | null = null;

export const getTidalAuthService = (): TidalAuthService => {
  tidalAuthService ??= new TidalAuthService();
  return tidalAuthService;
};
