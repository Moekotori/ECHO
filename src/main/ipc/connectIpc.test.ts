import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers[channel] = handler;
  });
  const showOpenDialog = vi.fn();
  const connectService = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn(),
    listDevices: vi.fn(),
    on: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    refreshDevices: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    stop: vi.fn(),
  };
  const receiverService = {
    getStatus: vi.fn(),
    on: vi.fn(),
    setEnabled: vi.fn(async () => ({})),
    stopPlayback: vi.fn(),
  };
  const echoLinkService = {
    getServerStatus: vi.fn(() => ({})),
    setEnabled: vi.fn(async () => ({})),
    rotateToken: vi.fn(() => ({})),
    setWebBackground: vi.fn(() => ({})),
    setLocalWebBackgroundImage: vi.fn(() => ({ webBackground: { type: 'image', url: '/echo-link/v1/background/bg-token' } })),
  };
  const airPlayReceiverService = {
    getStatus: vi.fn(),
    on: vi.fn(),
    setEnabled: vi.fn(async () => ({})),
    stopPlayback: vi.fn(),
  };
  const unlockService = {
    assertUnlocked: vi.fn(),
    getStatus: vi.fn(() => ({ unlocked: true })),
    refreshStatus: vi.fn(async () => ({ unlocked: true })),
  };
  const settings = {
    current: {
      connectAutoStartReceiversEnabled: false,
    },
  };

  return {
    airPlayReceiverService,
    connectService,
    echoLinkService,
    handle,
    handlers,
    receiverService,
    settings,
    showOpenDialog,
    unlockService,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
  },
  ipcMain: {
    handle: mocks.handle,
  },
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: () => mocks.settings.current,
}));

vi.mock('../connect/ConnectService', () => ({
  getConnectService: () => mocks.connectService,
  normalizeConnectStartRequest: (request: unknown) => request,
}));

vi.mock('../connect/ConnectReceiverService', () => ({
  getConnectReceiverService: () => mocks.receiverService,
}));

vi.mock('../connect/AirPlayReceiverSpikeService', () => ({
  getAirPlayReceiverSpikeService: () => mocks.airPlayReceiverService,
}));

vi.mock('../connect/EchoLinkService', () => ({
  getEchoLinkService: () => mocks.echoLinkService,
}));

vi.mock('../plugins/ConnectDonatorUnlockService', () => ({
  getConnectDonatorUnlockService: () => mocks.unlockService,
}));

describe('connect IPC receiver autostart', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.handlers)) {
      delete mocks.handlers[key];
    }
    vi.clearAllMocks();
    mocks.settings.current = {
      connectAutoStartReceiversEnabled: false,
    };
    mocks.unlockService.assertUnlocked.mockImplementation(() => undefined);
    mocks.unlockService.getStatus.mockReturnValue({ unlocked: true });
    mocks.unlockService.refreshStatus.mockResolvedValue({ unlocked: true });
    mocks.showOpenDialog.mockReset();
  });

  it('leaves receivers off when startup autostart is disabled', async () => {
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();

    expect(mocks.handle).toHaveBeenCalledWith(IpcChannels.ConnectReceiverSetEnabled, expect.any(Function));
    expect(mocks.receiverService.setEnabled).not.toHaveBeenCalled();
    expect(mocks.airPlayReceiverService.setEnabled).not.toHaveBeenCalled();
  });

  it('starts DLNA and AirPlay receivers when startup autostart is enabled', async () => {
    mocks.settings.current = {
      connectAutoStartReceiversEnabled: true,
    };
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.receiverService.setEnabled).toHaveBeenCalledWith(true);
    expect(mocks.airPlayReceiverService.setEnabled).toHaveBeenCalledWith(true);
  });

  it('blocks active connect handlers when the donator unlock is missing', async () => {
    mocks.unlockService.assertUnlocked.mockImplementation(() => {
      throw new Error('connect_donator_unlock_required');
    });
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();

    expect(mocks.handlers[IpcChannels.ConnectGetDonatorUnlockStatus]!(null)).toEqual({ unlocked: true });
    expect(() => mocks.handlers[IpcChannels.ConnectListDevices]!(null)).toThrow('echo_authorization_required');
    expect(mocks.connectService.listDevices).not.toHaveBeenCalled();
  });

  it('returns lightweight receiver statuses when the donator unlock is missing', async () => {
    mocks.unlockService.getStatus.mockReturnValue({ unlocked: false });
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();

    expect(mocks.handlers[IpcChannels.ConnectReceiverGetStatus]!(null)).toEqual(expect.objectContaining({
      enabled: false,
      state: 'disabled',
      currentUri: null,
      error: null,
    }));
    expect(mocks.handlers[IpcChannels.ConnectAirPlayReceiverGetStatus]!(null)).toEqual(expect.objectContaining({
      enabled: false,
      state: 'disabled',
      nativeAvailable: false,
      error: null,
    }));
    expect(mocks.receiverService.getStatus).not.toHaveBeenCalled();
    expect(mocks.airPlayReceiverService.getStatus).not.toHaveBeenCalled();
  });

  it('keeps receiver mutations gated when the donator unlock is missing', async () => {
    mocks.unlockService.assertUnlocked.mockImplementation(() => {
      throw new Error('connect_donator_unlock_required');
    });
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();

    expect(() => mocks.handlers[IpcChannels.ConnectReceiverSetEnabled]!(null, true)).toThrow('echo_authorization_required');
    expect(() => mocks.handlers[IpcChannels.ConnectAirPlayReceiverSetEnabled]!(null, true)).toThrow('echo_authorization_required');
    expect(mocks.receiverService.setEnabled).not.toHaveBeenCalled();
    expect(mocks.airPlayReceiverService.setEnabled).not.toHaveBeenCalled();
  });

  it('routes Echo Link web background changes through the main service', async () => {
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();
    const background = { type: 'video', url: 'https://example.test/background.webm' };
    const result = mocks.handlers[IpcChannels.EchoLinkSetWebBackground]!(null, background);

    expect(result).toEqual({});
    expect(mocks.unlockService.assertUnlocked).toHaveBeenCalled();
    expect(mocks.echoLinkService.setWebBackground).toHaveBeenCalledWith(background);
  });

  it('chooses a local Echo Link web background image through the main service', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\Pictures\\album-sea.png'] });
    const { registerConnectIpc } = await import('./connectIpc');

    registerConnectIpc();
    const result = await mocks.handlers[IpcChannels.EchoLinkChooseWebBackgroundImage]!(null);

    expect(result).toEqual({ webBackground: { type: 'image', url: '/echo-link/v1/background/bg-token' } });
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ name: 'Images', extensions: ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'] }],
      properties: ['openFile'],
    }));
    expect(mocks.echoLinkService.setLocalWebBackgroundImage).toHaveBeenCalledWith('D:\\Pictures\\album-sea.png');
  });
});
