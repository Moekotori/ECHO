import { BrowserWindow, session } from 'electron';
import type { Cookie } from 'electron';
import type { AccountLoginStartResult, AccountProvider } from '../../shared/types/accounts';
import type { AccountService } from './AccountService';

type LoginConfig = {
  url: string;
  domains: string[];
  requiredCookieNames?: string[];
};

const loginConfigs: Partial<Record<AccountProvider, LoginConfig>> = {
  netease: {
    url: 'https://music.163.com/',
    domains: ['music.163.com', '.music.163.com', '163.com', '.163.com'],
    requiredCookieNames: ['MUSIC_U', '__csrf'],
  },
  qqmusic: {
    url: 'https://y.qq.com/',
    domains: ['y.qq.com', '.y.qq.com', 'qq.com', '.qq.com'],
    requiredCookieNames: ['uin', 'qqmusic_key', 'qm_keyst'],
  },
  kugou: {
    url: 'https://www.kugou.com/',
    domains: ['www.kugou.com', '.kugou.com', 'kugou.com'],
  },
  bilibili: {
    url: 'https://www.bilibili.com/',
    domains: ['www.bilibili.com', '.bilibili.com', 'bilibili.com'],
    requiredCookieNames: ['SESSDATA', 'DedeUserID', 'bili_jct'],
  },
  soundcloud: {
    url: 'https://soundcloud.com/',
    domains: ['soundcloud.com', '.soundcloud.com'],
    requiredCookieNames: ['oauth_token', 'sc_anonymous_id'],
  },
  osu: {
    url: 'https://osu.ppy.sh/',
    domains: ['osu.ppy.sh', '.osu.ppy.sh', 'ppy.sh', '.ppy.sh'],
    requiredCookieNames: ['osu_session'],
  },
};

const toCookieHeader = (cookies: Cookie[]): string =>
  Array.from(new Map(cookies.map((cookie) => [cookie.name, cookie.value])).entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

const hasUsefulLoginCookie = (cookies: Cookie[], config: LoginConfig): boolean => {
  if (cookies.length === 0) {
    return false;
  }

  if (!config.requiredCookieNames?.length) {
    return true;
  }

  const names = new Set(cookies.map((cookie) => cookie.name));
  return config.requiredCookieNames.every((name) => names.has(name));
};

export const startAccountLoginWindow = async (
  provider: AccountProvider,
  accountService: AccountService,
): Promise<AccountLoginStartResult> => {
  const config = loginConfigs[provider];
  if (!config) {
    throw new Error('provider must use browser-cookie login');
  }

  const partition = `persist:echo-account-${provider}`;
  const loginSession = session.fromPartition(partition);

  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'ECHO Account Login',
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: loginSession,
    },
  });

  let bestCookieHeader = '';

  const collectCookies = async (): Promise<void> => {
    const batches = await Promise.all(
      config.domains.map((domain) => loginSession.cookies.get({ domain }).catch(() => [] as Cookie[])),
    );
    const cookies = batches.flat();

    if (hasUsefulLoginCookie(cookies, config)) {
      bestCookieHeader = toCookieHeader(cookies);
    }
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    void window.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });

  const poll = setInterval(() => {
    void collectCookies();
  }, 1500);

  window.webContents.on('did-navigate', () => {
    void collectCookies();
  });
  window.webContents.on('did-navigate-in-page', () => {
    void collectCookies();
  });

  const closed = new Promise<void>((resolve) => {
    window.once('closed', () => {
      clearInterval(poll);
      resolve();
    });
  });

  await collectCookies();
  await window.loadURL(config.url).catch(() => undefined);
  await closed;
  await collectCookies();

  if (!bestCookieHeader) {
    return {
      status: accountService.getStatus(provider),
      saved: false,
      message: '没有检测到登录 Cookie。请确认网页登录完成后再关闭登录窗口。',
    };
  }

  return {
    status: accountService.saveCookie(provider, bestCookieHeader),
    saved: true,
    message: '登录 Cookie 已自动同步。',
  };
};
