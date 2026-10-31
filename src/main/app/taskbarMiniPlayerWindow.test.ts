import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskbarHostDiagnostics } from './taskbarHostProcess';

const mocks = vi.hoisted(() => ({
  enabled: true,
  ready: false,
  startResult: true,
  diagnostics: {
    state: 'stopped',
    hostPathAvailable: true,
    restartAttempts: 0,
    lastError: null,
    lastExitAt: null,
  } as TaskbarHostDiagnostics,
  hideTaskbarHost: vi.fn(),
  showTaskbarHost: vi.fn(),
  startTaskbarHost: vi.fn(),
  stopTaskbarHost: vi.fn(),
  setAppSettings: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('./appSettings', () => ({
  getAppSettings: vi.fn(() => ({
    taskbarMiniPlayerEnabled: mocks.enabled,
  })),
  setAppSettings: mocks.setAppSettings,
}));

vi.mock('./taskbarHostProcess', () => ({
  getTaskbarHostDiagnostics: vi.fn(() => mocks.diagnostics),
  hideTaskbarHost: mocks.hideTaskbarHost,
  isTaskbarHostReady: vi.fn(() => mocks.ready),
  showTaskbarHost: mocks.showTaskbarHost,
  startTaskbarHost: mocks.startTaskbarHost,
  stopTaskbarHost: mocks.stopTaskbarHost,
}));

const loadModule = async () => {
  vi.resetModules();
  return import('./taskbarMiniPlayerWindow');
};

beforeEach(() => {
  mocks.enabled = true;
  mocks.ready = false;
  mocks.startResult = true;
  mocks.diagnostics = {
    state: 'stopped',
    hostPathAvailable: true,
    restartAttempts: 0,
    lastError: null,
    lastExitAt: null,
  };
  mocks.hideTaskbarHost.mockReset();
  mocks.showTaskbarHost.mockReset();
  mocks.startTaskbarHost.mockReset().mockImplementation(() => mocks.startResult);
  mocks.stopTaskbarHost.mockReset();
  mocks.setAppSettings.mockReset();
});

describe('taskbarMiniPlayerWindow', () => {
  it('reports a missing host executable as unsupported', async () => {
    mocks.diagnostics = {
      ...mocks.diagnostics,
      state: 'missing',
      hostPathAvailable: false,
      lastError: 'echo-taskbar-host.exe not found',
    };
    const taskbarMiniPlayer = await loadModule();

    expect(taskbarMiniPlayer.getTaskbarMiniPlayerState()).toMatchObject({
      visible: false,
      supported: false,
      unsupportedReason: 'host-missing',
      hostState: 'missing',
      lastError: 'echo-taskbar-host.exe not found',
    });
  });

  it('records the visibility request before starting the host so an early crash can recover', async () => {
    const taskbarMiniPlayer = await loadModule();

    taskbarMiniPlayer.showTaskbarMiniPlayerOnly();

    expect(mocks.showTaskbarHost).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskbarHost).toHaveBeenCalledTimes(1);
    expect(mocks.showTaskbarHost.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startTaskbarHost.mock.invocationCallOrder[0],
    );
  });

  it('clears the requested visibility when the native host cannot start', async () => {
    mocks.startResult = false;
    const taskbarMiniPlayer = await loadModule();

    expect(taskbarMiniPlayer.showTaskbarMiniPlayerOnly().visible).toBe(false);
    expect(mocks.hideTaskbarHost).toHaveBeenCalledWith(true);
  });
});
