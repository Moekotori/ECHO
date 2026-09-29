import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const openExternalMock = vi.fn(async () => undefined);
const listSourcesMock = vi.fn<() => Promise<unknown[]>>(async () => []);
const createSourceMock = vi.fn(async () => ({ id: 'remote-1' }));
let accountStatus = { loggedIn: false, pro: false, status: 'anonymous', checkedAt: null as string | null };
let plugins: unknown[] = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

vi.mock('../library/remote/RemoteSourceService', () => ({
  getRemoteSourceService: () => ({
    listSources: listSourcesMock,
    createSource: createSourceMock,
  }),
}));

vi.mock('../plugins/EchoProAccountService', () => ({
  getEchoProAccountService: () => ({ getStatus: () => accountStatus }),
}));

vi.mock('../plugins/PluginService', () => ({
  getPluginService: () => ({ list: () => ({ plugins }) }),
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

describe('remote sources IPC', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    openExternalMock.mockClear();
    listSourcesMock.mockReset();
    listSourcesMock.mockResolvedValue([]);
    createSourceMock.mockReset();
    createSourceMock.mockResolvedValue({ id: 'remote-1' });
    accountStatus = { loggedIn: false, pro: false, status: 'anonymous', checkedAt: null };
    plugins = [];
    vi.resetModules();
    const module = await import('./remoteSourcesIpc');
    module.registerRemoteSourcesIpc();
    await Promise.resolve();
  });

  it('lightly blocks remote source actions for non-Pro users', async () => {
    await expect(handlers[IpcChannels.RemoteSourcesList]!(null)).resolves.toEqual([]);
    await expect(
      handlers[IpcChannels.RemoteSourcesCreate]!(null, {
        provider: 'webdav',
        displayName: 'NAS',
        baseUrl: 'https://nas.example',
        authType: 'none',
      }),
    ).rejects.toThrow('echo_authorization_required');

    expect(listSourcesMock).not.toHaveBeenCalled();
    expect(createSourceMock).not.toHaveBeenCalled();
  });

  it('routes requests without online verification for a locally known Pro account', async () => {
    accountStatus = { loggedIn: true, pro: true, status: 'active', checkedAt: '2026-07-12T00:00:00.000Z' };
    listSourcesMock.mockResolvedValue([{ id: 'remote-1', status: 'enabled' }]);

    await expect(handlers[IpcChannels.RemoteSourcesList]!(null)).resolves.toEqual([{ id: 'remote-1', status: 'enabled' }]);

    expect(listSourcesMock).toHaveBeenCalledTimes(1);
  });
});
