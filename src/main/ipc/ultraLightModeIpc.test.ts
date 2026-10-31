import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getStatus: vi.fn(() => ({ phase: 'inactive', active: false, restoreAccelerator: 'CommandOrControl+Shift+E', error: null })),
  enter: vi.fn(async () => ({ phase: 'active', active: true, restoreAccelerator: 'CommandOrControl+Shift+E', error: null })),
  restore: vi.fn(async () => ({ phase: 'inactive', active: false, restoreAccelerator: 'CommandOrControl+Shift+E', error: null })),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler)),
  },
}));
vi.mock('../app/UltraLightModeService', () => ({
  getUltraLightModeStatus: mocks.getStatus,
  enterUltraLightMode: mocks.enter,
  restoreUltraLightMode: mocks.restore,
}));

describe('ultraLightModeIpc', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
  });

  it('registers typed status, enter, and restore handlers', async () => {
    const { registerUltraLightModeIpc } = await import('./ultraLightModeIpc');
    registerUltraLightModeIpc();

    expect(mocks.handlers.get(IpcChannels.AppUltraLightModeGetStatus)?.()).toMatchObject({ active: false });
    await expect(mocks.handlers.get(IpcChannels.AppUltraLightModeEnter)?.()).resolves.toMatchObject({ active: true });
    await expect(mocks.handlers.get(IpcChannels.AppUltraLightModeRestore)?.()).resolves.toMatchObject({ active: false });
  });
});
