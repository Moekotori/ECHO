import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), send: vi.fn(),
  login: vi.fn(), clearAuth: vi.fn(), save: vi.fn(), clear: vi.fn(),
  oauth: vi.fn().mockResolvedValue({ saved: true, status: { provider: 'spotify', connected: true } }),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) }, BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] }, shell: {} }));
vi.mock('../accounts/AccountService', () => ({
  isAccountProvider: (value: unknown) => typeof value === 'string' && ['spotify', 'tidal', 'qobuz'].includes(value),
  isAccountBrowser: vi.fn(), isYouTubeBrowser: vi.fn(),
  getAccountService: () => ({ getStatuses: () => [], saveQobuzCredentials: mocks.save, clearAccount: mocks.clear }),
}));
vi.mock('../accounts/AccountLoginWindow', () => ({ startAccountLoginWindow: vi.fn() }));
vi.mock('../accounts/NeteaseQrLoginService', () => ({ getNeteaseQrLoginService: vi.fn() }));
vi.mock('../accounts/SpotifyAuthService', () => ({ getSpotifyAuthService: () => ({ startLoginWindow: mocks.oauth }) }));
vi.mock('../accounts/TidalAuthService', () => ({ getTidalAuthService: () => ({ startLoginWindow: mocks.oauth }) }));
vi.mock('../qobuz/QobuzAuthService', () => ({ QobuzAuthService: { clearInstanceState: mocks.clearAuth, getInstance: () => ({ loginWithToken: mocks.login, toStoredRecord: () => ({ accessToken: 'test-token' }) }) } }));
import { registerAccountIpc } from './accountIpc';
describe('restored account login', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); registerAccountIpc(); });
  it.each(['spotify', 'tidal'])('broadcasts a successful %s login', async (provider) => {
    await mocks.handlers.get(IpcChannels.AccountStartLogin)!(null, provider);
    expect(mocks.send).toHaveBeenCalledWith(IpcChannels.AccountStatusesChanged, []);
  });
  it('validates and persists Qobuz login, then clears the live session on logout', async () => {
    mocks.login.mockResolvedValue({ success: true });
    await mocks.handlers.get(IpcChannels.AccountLoginQobuz)!(null, { userAuthToken: ' test-token ' });
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ userAuthToken: 'test-token' }));
    expect(mocks.save).toHaveBeenCalledWith({ accessToken: 'test-token' });
    await mocks.handlers.get(IpcChannels.AccountClear)!(null, 'qobuz');
    expect(mocks.clearAuth).toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith('qobuz');
  });
  it('rejects missing Qobuz tokens without starting login', async () => {
    await expect(mocks.handlers.get(IpcChannels.AccountLoginQobuz)!(null, {})).rejects.toThrow('user_auth_token');
    expect(mocks.login).not.toHaveBeenCalled();
  });
});
