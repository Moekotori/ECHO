import { randomUUID } from 'node:crypto';
import type { BrowserWindow, Cookie, Session } from 'electron';
import QRCode from 'qrcode';
import type {
  NeteaseQrLoginPollResult,
  NeteaseQrLoginStartResult,
  NeteaseQrLoginState,
} from '../../shared/types/accounts';
import { getAccountService, type AccountService } from './AccountService';

const neteaseQrLoginTtlMs = 5 * 60 * 1000;
const neteaseWebLoginOrigin = 'https://music.163.com';
const neteaseQrUniKeyUrl = `${neteaseWebLoginOrigin}/api/login/qrcode/unikey`;
const neteaseQrPollUrl = `${neteaseWebLoginOrigin}/api/login/qrcode/client/login`;
const neteaseQrScanLoginPath = '/st/platform/scanlogin';
const neteaseWebLoginPageUrl = `${neteaseWebLoginOrigin}/login`;
const neteaseYdDeviceAppId = '9d0ef7e0905d422cba1ecf7e73d77e67';
const neteaseLoginPartition = 'persist:echo-account-netease';
const neteaseCookieDomains = ['music.163.com', '.music.163.com', '163.com', '.163.com'];
const neteaseLoginCookieNames = new Set(['MUSIC_U']);
const neteaseLoginCookieNamesToClear = new Set([
  'MUSIC_U',
  'MUSIC_A',
  'MUSIC_R',
  '__csrf',
  '__remember_me',
]);

type NeteaseQrPageState = {
  state: NeteaseQrLoginState;
  message: string;
};

type NeteaseWebQrSession = {
  id: string;
  qrDataUrl: string;
  expiresAtMs: number;
  collectCookieHeader: () => Promise<string | null>;
  readState: () => Promise<NeteaseQrPageState>;
  dispose: () => void;
};

type NeteaseWebQrLoginHost = {
  start: (id: string) => Promise<NeteaseWebQrSession>;
};

let neteaseWebQrLoginHostForTests: NeteaseWebQrLoginHost | null | undefined;

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const qrMessage = (state: NeteaseQrLoginState, fallback: string | null): string => {
  if (fallback) {
    return fallback;
  }
  if (state === 'waiting') {
    return 'Waiting for NetEase Cloud Music web QR scan.';
  }
  if (state === 'scanned') {
    return 'Scan confirmed on phone. Tap authorize in the NetEase Cloud Music app.';
  }
  if (state === 'confirmed') {
    return 'NetEase Cloud Music web QR sign-in saved.';
  }
  if (state === 'expired') {
    return 'NetEase Cloud Music web QR code expired. Generate a new one.';
  }
  return 'NetEase Cloud Music web QR sign-in failed.';
};

const toCookieHeader = (cookies: Cookie[]): string | null => {
  const pairs = new Map<string, string>();
  for (const cookie of cookies) {
    if (!cookie.name || typeof cookie.value !== 'string') {
      continue;
    }
    pairs.set(cookie.name, `${cookie.name}=${cookie.value}`);
  }

  if (![...pairs.keys()].some((name) => neteaseLoginCookieNames.has(name))) {
    return null;
  }

  return [...pairs.values()].join('; ');
};

const collectNeteaseCookieHeader = async (loginSession: Session): Promise<string | null> => {
  const batches = await Promise.all(
    neteaseCookieDomains.map((domain) => loginSession.cookies.get({ domain }).catch(() => [] as Cookie[])),
  );
  return toCookieHeader(batches.flat());
};

const clearNeteaseSessionCookies = async (loginSession: Session): Promise<void> => {
  const batches = await Promise.all(
    neteaseCookieDomains.map((domain) => loginSession.cookies.get({ domain }).catch(() => [] as Cookie[])),
  );
  const cookies = batches.flat();
  const seen = new Set<string>();

  await Promise.all(cookies.map(async (cookie) => {
    if (!cookie.name || !cookie.domain) {
      return;
    }
    if (!neteaseLoginCookieNamesToClear.has(cookie.name)) {
      return;
    }

    const host = cookie.domain.replace(/^\./, '');
    const path = cookie.path?.startsWith('/') ? cookie.path : '/';
    const key = `${host}\n${path}\n${cookie.name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const protocol = cookie.secure === false ? 'http' : 'https';
    await loginSession.cookies.remove(`${protocol}://${host}${path}`, cookie.name).catch(() => undefined);
  }));
};

type NeteaseQrUniKeyResponse = {
  code?: number;
  unikey?: string;
  message?: string;
};

type NeteaseQrPollResponse = {
  code?: number;
  message?: string;
};

const createNeteaseWebLoginChainId = async (loginSession: Session): Promise<string> => {
  const batches = await Promise.all(
    neteaseCookieDomains.map((domain) => (
      loginSession.cookies.get({ domain, name: 'sDeviceId' }).catch(() => [] as Cookie[])
    )),
  );
  const sDeviceId = text(batches.flat().find((cookie) => cookie.name === 'sDeviceId')?.value);
  const deviceId = sDeviceId ?? `unknown-${Math.floor(Math.random() * 1_000_000)}`;

  return `v1_${deviceId}_web_login_${Date.now()}`;
};

const toFormBody = (data: Record<string, string | number | boolean | null | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const fetchNeteaseQrJson = async <T>(
  loginSession: Session,
  url: string,
  data: Record<string, string | number | boolean | null | undefined>,
  headers: Record<string, string> = {},
): Promise<T> => {
  const controller = new AbortController();
  const response = await withTimeout(
    loginSession.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Origin: neteaseWebLoginOrigin,
        Referer: `${neteaseWebLoginOrigin}/`,
        'x-os': 'web',
        ...headers,
      },
      body: toFormBody(data),
      credentials: 'include',
      signal: controller.signal,
    }),
    8_000,
    'NetEase web QR request timed out.',
  ).catch((error) => {
    controller.abort();
    throw error;
  });
  const payload = await response.json().catch(() => null) as T | null;
  if (!payload) {
    throw new Error(`NetEase web QR request failed with HTTP ${response.status}.`);
  }

  return payload;
};

const isNavigationAbort = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
  return candidate?.code === 'ERR_ABORTED' || String(candidate?.message ?? error).includes('ERR_ABORTED');
};

const waitForNeteaseWebLoginPageReady = async (window: BrowserWindow): Promise<void> => {
  const readReadyState = async (): Promise<{ hasFingerprint: boolean; hasDeviceCookie: boolean } | null> =>
    window.webContents.executeJavaScript(`
      (() => ({
        hasFingerprint: typeof window.createNEFingerprint === 'function',
        hasDeviceCookie: /(?:^|;\\s*)sDeviceId=/.test(document.cookie || '')
      }))()
    `, true).catch(() => null);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    const state = await readReadyState();
    if (state?.hasFingerprint && state.hasDeviceCookie) {
      return;
    }
    await delay(250);
  }

  throw new Error('NetEase web login page did not finish device verification setup.');
};

const createNeteaseHiddenLoginWindow = async (loginSession: Session): Promise<BrowserWindow> => {
  const electron = await import('electron');
  const window = new electron.BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: loginSession,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let loadError: unknown = null;
  const loadPromise = window.loadURL(neteaseWebLoginPageUrl).catch((error) => {
    if (!isNavigationAbort(error)) {
      loadError = error;
    }
  });
  await Promise.race([loadPromise, delay(5_000)]);
  if (loadError) {
    throw loadError;
  }
  await waitForNeteaseWebLoginPageReady(window);
  return window;
};

const readNeteaseYdDeviceToken = async (window: BrowserWindow): Promise<string | null> => {
  if (window.isDestroyed()) {
    return null;
  }

  const token = await withTimeout(
    window.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.createNEFingerprint !== 'function') {
          return '';
        }
        const fingerprint = window.createNEFingerprint({
          appId: '${neteaseYdDeviceAppId}',
          timeout: 6000
        });
        const result = await fingerprint.getToken();
        return result && typeof result.token === 'string' ? result.token : '';
      })()
    `, true),
    8_000,
    'NetEase web device token request timed out.',
  ).catch(() => '');

  return text(token);
};

const createNeteaseWebQrDataUrl = async (unikey: string, chainId: string): Promise<string> => {
  const loginUrl = new URL(neteaseQrScanLoginPath, neteaseWebLoginOrigin);
  loginUrl.searchParams.set('codekey', unikey);
  loginUrl.searchParams.set('chainId', chainId);
  loginUrl.searchParams.set('hdw_device', 'web');
  loginUrl.searchParams.set('hdw_appid', 'web');
  loginUrl.searchParams.set('hitExp', '1');

  return QRCode.toDataURL(loginUrl.toString(), {
    errorCorrectionLevel: 'medium',
    margin: 2,
    width: 260,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
};

const requestNeteaseQrUniKey = async (loginSession: Session): Promise<string> => {
  const response = await fetchNeteaseQrJson<NeteaseQrUniKeyResponse>(loginSession, neteaseQrUniKeyUrl, {
    type: 1,
    noCheckToken: true,
  });

  const unikey = text(response.unikey);
  if (response.code !== 200 || !unikey) {
    throw new Error(text(response.message) ?? 'NetEase web QR key request failed.');
  }

  return unikey;
};

const pollNeteaseQrState = async (
  loginSession: Session,
  key: string,
  chainId: string,
  ydDeviceToken: string,
): Promise<NeteaseQrPageState> => {
  const response = await fetchNeteaseQrJson<NeteaseQrPollResponse>(
    loginSession,
    neteaseQrPollUrl,
    {
      type: 1,
      noCheckToken: true,
      key,
      ydDeviceToken,
    },
    {
      'X-loginMethod': 'QrCode',
      'x-login-chain-id': chainId,
    },
  );

  switch (response.code) {
    case 803:
      return { state: 'confirmed', message: qrMessage('confirmed', null) };
    case 802:
      return { state: 'scanned', message: qrMessage('scanned', text(response.message)) };
    case 801:
      return { state: 'waiting', message: qrMessage('waiting', text(response.message)) };
    case 800:
      return { state: 'expired', message: qrMessage('expired', text(response.message)) };
    default:
      return { state: 'failed', message: qrMessage('failed', text(response.message)) };
  }
};

const createDefaultWebQrLoginHost = (): NeteaseWebQrLoginHost => ({
  start: async (id: string): Promise<NeteaseWebQrSession> => {
    const electron = await import('electron');
    const loginSession = electron.session.fromPartition(neteaseLoginPartition);
    let loginWindow: BrowserWindow | null = null;
    let lastYdDeviceToken: string | null = null;
    let disposed = false;

    const dispose = (): void => {
      disposed = true;
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.destroy();
      }
      loginWindow = null;
    };

    try {
      await clearNeteaseSessionCookies(loginSession);
      loginWindow = await createNeteaseHiddenLoginWindow(loginSession);
      lastYdDeviceToken = await readNeteaseYdDeviceToken(loginWindow);
      if (!lastYdDeviceToken) {
        throw new Error('NetEase web device token is unavailable.');
      }
      const key = await requestNeteaseQrUniKey(loginSession);
      const chainId = await createNeteaseWebLoginChainId(loginSession);
      const qrDataUrl = await createNeteaseWebQrDataUrl(key, chainId);
      return {
        id,
        qrDataUrl,
        expiresAtMs: Date.now() + neteaseQrLoginTtlMs,
        collectCookieHeader: () => collectNeteaseCookieHeader(loginSession),
        readState: async () => {
          if (disposed) {
            return { state: 'failed', message: qrMessage('failed', null) };
          }

          const currentYdDeviceToken = loginWindow && !loginWindow.isDestroyed()
            ? await readNeteaseYdDeviceToken(loginWindow)
            : null;
          if (currentYdDeviceToken) {
            lastYdDeviceToken = currentYdDeviceToken;
          }
          if (!lastYdDeviceToken) {
            return {
              state: 'failed',
              message: 'NetEase web device token is unavailable. Generate a new QR code and try again.',
            };
          }

          return pollNeteaseQrState(loginSession, key, chainId, lastYdDeviceToken);
        },
        dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});

const getNeteaseWebQrLoginHost = (): NeteaseWebQrLoginHost => {
  if (neteaseWebQrLoginHostForTests !== undefined) {
    return neteaseWebQrLoginHostForTests ?? createDefaultWebQrLoginHost();
  }

  return createDefaultWebQrLoginHost();
};

export class NeteaseQrLoginService {
  private readonly sessions = new Map<string, NeteaseWebQrSession>();

  constructor(private readonly accountService: AccountService = getAccountService()) {}

  async startLogin(): Promise<NeteaseQrLoginStartResult> {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();

    const key = randomUUID();
    const session = await getNeteaseWebQrLoginHost().start(key);
    this.sessions.set(key, session);

    return {
      key,
      qrUrl: session.qrDataUrl,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      state: 'waiting',
      message: qrMessage('waiting', null),
    };
  }

  async pollLogin(key: string): Promise<NeteaseQrLoginPollResult> {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new Error('NetEase QR login key is required.');
    }

    const session = this.sessions.get(trimmedKey);
    if (!session) {
      return {
        state: 'expired',
        saved: false,
        message: qrMessage('expired', null),
        code: null,
      };
    }

    const cookie = await session.collectCookieHeader();
    if (cookie) {
      const status = this.accountService.saveCookie('netease', cookie);
      session.dispose();
      this.sessions.delete(trimmedKey);
      return {
        state: 'confirmed',
        saved: true,
        message: qrMessage('confirmed', null),
        code: null,
        status,
      };
    }

    if (Date.now() > session.expiresAtMs) {
      session.dispose();
      this.sessions.delete(trimmedKey);
      return {
        state: 'expired',
        saved: false,
        message: qrMessage('expired', null),
        code: null,
      };
    }

    const pageState = await session.readState();
    if (pageState.state === 'confirmed') {
      const confirmedCookie = await session.collectCookieHeader();
      if (confirmedCookie) {
        const status = this.accountService.saveCookie('netease', confirmedCookie);
        session.dispose();
        this.sessions.delete(trimmedKey);
        return {
          state: 'confirmed',
          saved: true,
          message: pageState.message,
          code: null,
          status,
        };
      }

      session.dispose();
      this.sessions.delete(trimmedKey);
      return {
        state: 'failed',
        saved: false,
        message: 'NetEase Cloud Music web QR sign-in succeeded, but no session cookie was returned.',
        code: null,
      };
    }

    if (pageState.state === 'expired' || pageState.state === 'failed') {
      session.dispose();
      this.sessions.delete(trimmedKey);
    }

    return {
      state: pageState.state,
      saved: false,
      message: pageState.message,
      code: null,
    };
  }
}

let neteaseQrLoginService: NeteaseQrLoginService | null = null;

export const getNeteaseQrLoginService = (): NeteaseQrLoginService => {
  neteaseQrLoginService ??= new NeteaseQrLoginService();
  return neteaseQrLoginService;
};

export const setNeteaseQrLoginWebHostForTests = (host: NeteaseWebQrLoginHost | null | undefined): void => {
  neteaseWebQrLoginHostForTests = host;
  neteaseQrLoginService = null;
};
