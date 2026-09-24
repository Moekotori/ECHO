import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
    getSettings: vi.fn(() => ({ echoLinkBasicEnabled: false })),
    setSettings: vi.fn((patch: Record<string, unknown>) => ({ ...patch })),
    sync: vi.fn(async () => undefined),
    getStatus: vi.fn(() => ({ enabled: false, running: false, clients: [] })),
    startPairing: vi.fn(async () => ({
      id: 'pair-1',
      pairingUri: 'echo://pair',
      webRemoteUrl: 'http://127.0.0.1:26789/echo-link/v2/remote#pair=echo%3A%2F%2Fpair',
      qrDataUrl: 'data:image/png;base64,AA',
      expiresAt: '2026-07-17T00:02:00.000Z',
    })),
    cancelPairing: vi.fn(() => ({ enabled: true, running: true, clients: [] })),
    revokeClient: vi.fn(() => ({ enabled: true, running: true, clients: [] })),
  };
});

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../app/appSettings', () => ({
  getAppSettings: mocks.getSettings,
  setAppSettings: mocks.setSettings,
}));
vi.mock('../connect/EchoLinkBasicIntegration', () => ({
  syncEchoLinkBasicIntegrationFromSettings: mocks.sync,
}));
vi.mock('../connect/EchoLinkService', () => ({
  getEchoLinkService: () => ({
    getBasicStatus: mocks.getStatus,
    startBasicPairing: mocks.startPairing,
    cancelBasicPairing: mocks.cancelPairing,
    revokeBasicClient: mocks.revokeClient,
  }),
}));

import { registerEchoLinkIpc } from './echoLinkIpc';

describe('registerEchoLinkIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.getSettings.mockReturnValue({ echoLinkBasicEnabled: false });
    registerEchoLinkIpc();
  });

  it('persists and applies Basic independently from Pro/v1', async () => {
    const handler = mocks.handlers.get(IpcChannels.EchoLinkBasicSetEnabled)!;
    await handler({}, true);

    expect(mocks.setSettings).toHaveBeenCalledWith({ echoLinkBasicEnabled: true });
    expect(mocks.sync).toHaveBeenCalledWith({ echoLinkBasicEnabled: true });
    expect(mocks.getStatus).toHaveBeenCalled();
  });

  it('requires Basic to be enabled before creating a pairing session', async () => {
    const handler = mocks.handlers.get(IpcChannels.EchoLinkBasicStartPairing)!;
    await expect(handler({})).rejects.toThrow('echo_link_basic_disabled');

    mocks.getSettings.mockReturnValue({ echoLinkBasicEnabled: true });
    await expect(handler({})).resolves.toMatchObject({ id: 'pair-1' });
  });

  it('validates client ids and delegates cancellation and revocation', async () => {
    const cancel = mocks.handlers.get(IpcChannels.EchoLinkBasicCancelPairing)!;
    const revoke = mocks.handlers.get(IpcChannels.EchoLinkBasicRevokeClient)!;

    expect(cancel({})).toMatchObject({ enabled: true });
    expect(() => revoke({}, ' ')).toThrow('invalid_echo_link_client_id');
    expect(revoke({}, 'client-1')).toMatchObject({ running: true });
    expect(mocks.revokeClient).toHaveBeenCalledWith('client-1');
  });
});
