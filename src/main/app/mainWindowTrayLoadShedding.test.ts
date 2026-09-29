import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: false,
  active: false,
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => undefined),
  minimize: vi.fn(async () => ({ active: true })),
  tray: vi.fn(async () => ({ active: true })),
}));
vi.mock('./appSettings', () => ({ getAppSettings: () => ({ ultraLightOnMinimizeOrTrayEnabled: mocks.enabled }) }));
vi.mock('./backgroundPauseLeases', () => ({
  configureBackgroundPauseLeaseApplier: vi.fn(),
  acquireBackgroundPauseLease: mocks.pause,
  releaseBackgroundPauseLease: mocks.resume,
}));
vi.mock('../diagnostics/SoftMemoryJanitor', () => ({ releaseSoftMemoryPressure: mocks.cleanup }));
vi.mock('../library/remote/RemoteSourceService', () => ({ setDefaultRemoteSourceBackgroundParked: vi.fn() }));
vi.mock('./UltraLightModeService', () => ({
  isUltraLightModeActive: () => mocks.active,
  enterUltraLightModeForMinimizedParking: mocks.minimize,
  enterUltraLightModeForTrayParking: mocks.tray,
}));

import { bindMainWindowTrayLoadShedding } from './mainWindowTrayLoadShedding';

class WindowStub extends EventEmitter {
  visible = true;
  minimized = false;
  destroyed = false;
  isVisible = () => this.visible;
  isMinimized = () => this.minimized;
  isDestroyed = () => this.destroyed;
}

describe('community background window binding', () => {
  let window: WindowStub;
  let dispose: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.enabled = false;
    mocks.active = false;
    window = new WindowStub();
    dispose = bindMainWindowTrayLoadShedding(window as unknown as BrowserWindow);
  });
  afterEach(async () => {
    dispose();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  it('cleans rebuildable caches after a grace period without opting into renderer unload', async () => {
    window.visible = false;
    window.emit('hide');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.pause).toHaveBeenCalledWith('tray-hidden');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.tray).not.toHaveBeenCalled();
  });

  it('uses the taskbar-preserving entry for an opted-in minimize', async () => {
    mocks.enabled = true;
    window.minimized = true;
    window.emit('minimize');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.minimize).toHaveBeenCalledTimes(1);
    expect(mocks.tray).not.toHaveBeenCalled();
  });

  it('cancels pending unload when the user immediately returns', async () => {
    mocks.enabled = true;
    window.visible = false;
    window.emit('hide');
    window.visible = true;
    window.emit('show');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.tray).not.toHaveBeenCalled();
    expect(mocks.resume).toHaveBeenCalledWith('tray-hidden');
  });

  it('keeps the pause lease across renderer destruction and detaches listeners', async () => {
    mocks.active = true;
    window.destroyed = true;
    window.emit('closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(window.listenerCount('minimize')).toBe(0);
    expect(window.listenerCount('show')).toBe(0);
  });
});
