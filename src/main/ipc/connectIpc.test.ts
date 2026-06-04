import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers[channel] = handler;
  });
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
  const airPlayReceiverService = {
    getStatus: vi.fn(),
    on: vi.fn(),
    setEnabled: vi.fn(async () => ({})),
    stopPlayback: vi.fn(),
  };
  const settings = {
    current: {
      connectAutoStartReceiversEnabled: false,
    },
  };

  return {
    airPlayReceiverService,
    connectService,
    handle,
    handlers,
    receiverService,
    settings,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
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

describe('connect IPC receiver autostart', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.handlers)) {
      delete mocks.handlers[key];
    }
    vi.clearAllMocks();
    mocks.settings.current = {
      connectAutoStartReceiversEnabled: false,
    };
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

    expect(mocks.receiverService.setEnabled).toHaveBeenCalledWith(true);
    expect(mocks.airPlayReceiverService.setEnabled).toHaveBeenCalledWith(true);
  });
});
