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

vi.mock('electron', () => ({
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
      getCredentials: vi.fn((provider) => ({ provider, browser: provider === 'youtube' ? 'edge' : undefined })),
      setYouTubeBrowser: vi.fn((browser) => ({ provider: 'youtube', connected: browser !== 'none' })),
    }),
  };
});

vi.mock('../accounts/AccountLoginWindow', () => ({
  startAccountLoginWindow: startAccountLoginWindowMock,
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

  it('does not open the Electron login window for YouTube', async () => {
    await expect(handlers[IpcChannels.AccountStartLogin]!(null, 'youtube')).resolves.toMatchObject({
      status: { provider: 'youtube' },
      saved: false,
    });
    expect(openExternalMock).toHaveBeenCalledWith('microsoft-edge:https://www.youtube.com/');
    expect(startAccountLoginWindowMock).not.toHaveBeenCalled();
  });
});
