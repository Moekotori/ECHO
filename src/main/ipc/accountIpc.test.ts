import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const saveCookieMock = vi.fn();
const startAccountLoginWindowMock = vi.hoisted(() => vi.fn(async (provider) => ({
  status: { provider, connected: true },
  saved: true,
  message: 'saved',
})));
const openExternalMock = vi.hoisted(() => vi.fn(async () => undefined));
const browserWindowGetAllWindowsMock = vi.hoisted(() => vi.fn((): Array<{ webContents: { send: (...args: unknown[]) => void } }> => []));
const startNeteaseQrLoginMock = vi.hoisted(() => vi.fn());
const pollNeteaseQrLoginMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: browserWindowGetAllWindowsMock,
  },
  ipcMain: {
    handle: handleMock,
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

vi.mock('../accounts/AccountService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAccountService: () => ({
      getStatuses: vi.fn(() => []),
      getStatus: vi.fn((provider) => ({ provider, connected: false })),
      saveCookie: saveCookieMock,
      clearAccount: vi.fn((provider) => ({ provider, connected: false })),
      checkAccount: vi.fn(async (provider) => ({ provider, connected: false })),
      checkAllAccounts: vi.fn(async () => []),
      getCredentials: vi.fn((provider) => ({ provider, browser: provider === 'youtube' || provider === 'soundcloud' ? 'edge' : undefined })),
      setAccountBrowser: vi.fn((provider, browser) => ({ provider, connected: browser !== 'none' })),
      setYouTubeBrowser: vi.fn((browser) => ({ provider: 'youtube', connected: browser !== 'none' })),
    }),
  };
});

vi.mock('../accounts/AccountLoginWindow', () => ({
  startAccountLoginWindow: startAccountLoginWindowMock,
}));

vi.mock('../accounts/NeteaseQrLoginService', () => ({
  getNeteaseQrLoginService: () => ({
    startLogin: startNeteaseQrLoginMock,
    pollLogin: pollNeteaseQrLoginMock,
  }),
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

describe('account IPC', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    saveCookieMock.mockReset();
    startAccountLoginWindowMock.mockClear();
    openExternalMock.mockClear();
    browserWindowGetAllWindowsMock.mockReset();
    browserWindowGetAllWindowsMock.mockReturnValue([]);
    startNeteaseQrLoginMock.mockReset();
    startNeteaseQrLoginMock.mockResolvedValue({
      key: 'qr-key',
      qrUrl: 'https://music.163.com/login?codekey=qr-key',
      expiresAt: '2026-06-30T01:00:00.000Z',
      state: 'waiting',
      message: 'waiting',
    });
    pollNeteaseQrLoginMock.mockReset();
    pollNeteaseQrLoginMock.mockResolvedValue({
      state: 'confirmed',
      saved: true,
      message: 'saved',
      code: 803,
      status: { provider: 'netease', connected: true },
    });
    vi.resetModules();
    const module = await import('./accountIpc');
    module.registerAccountIpc();
  });

  it('rejects invalid providers', () => {
    expect(() => handlers[IpcChannels.AccountGetStatus]!(null, 'bad-provider')).toThrow('provider must be a supported account provider');
  });

  it('rejects non-string cookies', () => {
    expect(() => handlers[IpcChannels.AccountSaveCookie]!(null, 'netease', 123)).toThrow('cookie must be a string');
    expect(saveCookieMock).not.toHaveBeenCalled();
  });

  it('accepts a valid provider and cookie', () => {
    saveCookieMock.mockReturnValue({ provider: 'netease', connected: true });

    expect(handlers[IpcChannels.AccountSaveCookie]!(null, 'netease', 'MUSIC_U=secret')).toEqual({
      provider: 'netease',
      connected: true,
    });
    expect(saveCookieMock).toHaveBeenCalledWith('netease', 'MUSIC_U=secret');
  });

  it('starts provider login through the account login window', async () => {
    await expect(handlers[IpcChannels.AccountStartLogin]!(null, 'netease')).resolves.toEqual({
      status: { provider: 'netease', connected: true },
      saved: true,
      message: 'saved',
    });
  });

  it('starts NetEase QR login without returning cookies to the renderer', async () => {
    await expect(handlers[IpcChannels.AccountStartNeteaseQrLogin]!(null)).resolves.toEqual({
      key: 'qr-key',
      qrUrl: 'https://music.163.com/login?codekey=qr-key',
      expiresAt: '2026-06-30T01:00:00.000Z',
      state: 'waiting',
      message: 'waiting',
    });
    expect(startNeteaseQrLoginMock).toHaveBeenCalledTimes(1);
  });

  it('polls NetEase QR login and broadcasts account status updates', async () => {
    const sendMock = vi.fn();
    browserWindowGetAllWindowsMock.mockReturnValue([{ webContents: { send: sendMock } }]);

    await expect(handlers[IpcChannels.AccountPollNeteaseQrLogin]!(null, 'qr-key')).resolves.toEqual({
      state: 'confirmed',
      saved: true,
      message: 'saved',
      code: 803,
      status: { provider: 'netease', connected: true },
    });
    expect(pollNeteaseQrLoginMock).toHaveBeenCalledWith('qr-key');
    expect(sendMock).toHaveBeenCalledWith(IpcChannels.AccountStatusesChanged, []);
  });

  it('rejects blank NetEase QR login keys', async () => {
    await expect(handlers[IpcChannels.AccountPollNeteaseQrLogin]!(null, '  ')).rejects.toThrow('NetEase QR login key is required');
    expect(pollNeteaseQrLoginMock).not.toHaveBeenCalled();
  });

  it('does not open the Electron login window for YouTube', async () => {
    await expect(handlers[IpcChannels.AccountStartLogin]!(null, 'youtube')).resolves.toMatchObject({
      status: { provider: 'youtube' },
      saved: false,
    });
    expect(openExternalMock).toHaveBeenCalledWith('microsoft-edge:https://www.youtube.com/');
    expect(startAccountLoginWindowMock).not.toHaveBeenCalled();
  });

  it('opens SoundCloud login in the system browser instead of the Electron login window', async () => {
    await expect(handlers[IpcChannels.AccountStartLogin]!(null, 'soundcloud')).resolves.toMatchObject({
      status: { provider: 'soundcloud' },
      saved: false,
    });
    expect(openExternalMock).toHaveBeenCalledWith('microsoft-edge:https://soundcloud.com/');
    expect(startAccountLoginWindowMock).not.toHaveBeenCalled();
  });

  it('saves a system browser choice for SoundCloud', () => {
    expect(handlers[IpcChannels.AccountSetBrowser]!(null, 'soundcloud', 'chrome')).toEqual({
      provider: 'soundcloud',
      connected: true,
    });
  });
});
