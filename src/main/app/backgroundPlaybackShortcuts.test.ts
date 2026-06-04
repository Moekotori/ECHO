import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AppSettings } from '../../shared/types/appSettings';
import { createDefaultGlobalShortcuts } from '../../shared/types/globalShortcuts';
import { IpcChannels } from '../../shared/constants/ipcChannels';

const spawnedProcesses: Array<{
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  once: EventEmitter['once'];
}> = [];
const spawnMock = vi.fn(() => {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  emitter.stdout = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  emitter.stdout.setEncoding = vi.fn();
  emitter.stderr = new EventEmitter();
  emitter.killed = false;
  emitter.kill = vi.fn(() => {
    emitter.killed = true;
    emitter.emit('exit', 0);
    return true;
  });
  spawnedProcesses.push(emitter);
  return emitter;
});
const callbacks = new Map<string, () => void>();
const unavailableAccelerators = new Set<string>();
const registerMock = vi.fn((accelerator: string, callback: () => void) => {
  if (unavailableAccelerators.has(accelerator)) {
    return false;
  }

  callbacks.set(accelerator, callback);
  return true;
});
const unregisterMock = vi.fn((accelerator: string) => {
  callbacks.delete(accelerator);
});
const isRegisteredMock = vi.fn((accelerator: string) => callbacks.has(accelerator));
const sendMock = vi.fn();
const showMock = vi.fn();
const hideMock = vi.fn();
const focusMock = vi.fn();
const restoreMock = vi.fn();
let minimized = false;
let destroyed = false;
let currentSettings: AppSettings;
const setAppSettingsMock = vi.fn((patch: Partial<AppSettings>) => {
  currentSettings = {
    ...currentSettings,
    ...patch,
  };
  return currentSettings;
});

const createSettings = (settings: Partial<AppSettings> = {}): AppSettings =>
  ({
    globalShortcuts: createDefaultGlobalShortcuts(),
    ...settings,
  }) as AppSettings;

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        focus: focusMock,
        hide: hideMock,
        isDestroyed: () => destroyed,
        isMinimized: () => minimized,
        restore: restoreMock,
        show: showMock,
        webContents: {
          send: sendMock,
        },
      },
    ],
  },
  globalShortcut: {
    isRegistered: isRegisteredMock,
    register: registerMock,
    unregister: unregisterMock,
  },
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('./appSettings', () => ({
  getAppSettings: () => currentSettings,
  setAppSettings: setAppSettingsMock,
}));

vi.mock('./windowManager', () => ({
  getMainWindow: () => null,
}));

describe('global playback shortcuts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    callbacks.clear();
    spawnedProcesses.length = 0;
    spawnMock.mockClear();
    unavailableAccelerators.clear();
    registerMock.mockClear();
    unregisterMock.mockClear();
    isRegisteredMock.mockClear();
    sendMock.mockClear();
    showMock.mockClear();
    hideMock.mockClear();
    focusMock.mockClear();
    restoreMock.mockClear();
    setAppSettingsMock.mockClear();
    minimized = false;
    destroyed = false;
    currentSettings = createSettings();
  });

  it('registers enabled shortcuts and sends renderer commands', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        playPause: { enabled: true, accelerator: 'Ctrl+Alt+Space' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    callbacks.get('Ctrl+Alt+Space')?.();

    expect(registerMock).toHaveBeenCalledWith('Ctrl+Alt+Space', expect.any(Function));
    expect(sendMock).toHaveBeenCalledWith(IpcChannels.AppGlobalShortcutCommand, 'playPause');
  });

  it('registers numpad digit accelerators without rewriting them to top-row digits', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        nextTrack: { enabled: true, accelerator: 'Ctrl+Alt+Numpad1' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();

    expect(registerMock).toHaveBeenCalledWith('Ctrl+Alt+num1', expect.any(Function));
  });

  it('disables enabled shortcuts when Electron cannot register them', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        playPause: { enabled: true, accelerator: 'Ctrl+Alt+Space' },
      },
    });
    unavailableAccelerators.add('Ctrl+Alt+Space');
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    const nextSettings = shortcuts.refreshBackgroundSpaceRegistration();

    expect(nextSettings?.globalShortcuts?.playPause.enabled).toBe(false);
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        globalShortcuts: expect.objectContaining({
          playPause: { enabled: false, accelerator: 'Ctrl+Alt+Space' },
        }),
      }),
    );
  });

  it('treats Electron accelerator parser throws as unavailable', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        nextTrack: { enabled: true, accelerator: 'Ctrl+Alt+X' },
      },
    });
    registerMock.mockImplementationOnce(() => {
      throw new Error('invalid accelerator');
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    const nextSettings = shortcuts.refreshBackgroundSpaceRegistration();

    expect(nextSettings?.globalShortcuts?.nextTrack.enabled).toBe(false);
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        globalShortcuts: expect.objectContaining({
          nextTrack: { enabled: false, accelerator: 'Ctrl+Alt+X' },
        }),
      }),
    );
  });

  it('returns unavailable when validation registration throws', async () => {
    registerMock.mockImplementationOnce(() => {
      throw new Error('invalid accelerator');
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    expect(shortcuts.validateGlobalShortcut('Ctrl+Alt+X')).toEqual({
      accelerator: 'Ctrl+Alt+X',
      available: false,
      reason: 'unavailable',
      valid: true,
    });
  });

  it('validates browser navigation keys through Electron registration', async () => {
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    expect(shortcuts.validateGlobalShortcut('browserback')).toEqual({
      accelerator: 'BrowserBack',
      available: true,
      reason: 'available',
      valid: true,
    });
    expect(registerMock).toHaveBeenCalledWith('BrowserBack', expect.any(Function));
    expect(unregisterMock).toHaveBeenCalledWith('BrowserBack');
  });

  it('routes mouse side buttons through the Windows mouse hook helper', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        nextTrack: { enabled: true, accelerator: 'MouseButton4' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    spawnedProcesses[0]?.stdout.emit('data', 'ready\r\nMouseButton4\r\n');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ECHO_MOUSE_SHORTCUT_BUTTONS: 'MouseButton4' }),
        windowsHide: true,
      }),
    );
    expect(registerMock).not.toHaveBeenCalledWith('MouseButton4', expect.any(Function));
    expect(sendMock).toHaveBeenCalledWith(IpcChannels.AppGlobalShortcutCommand, 'nextTrack');
  });

  it('routes middle mouse button shortcuts through the Windows mouse hook helper', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        playPause: { enabled: true, accelerator: 'MouseButton3' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    spawnedProcesses[0]?.stdout.emit('data', 'ready\r\nMouseButton3\r\nMouseButton5\r\n');

    expect(spawnMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ECHO_MOUSE_SHORTCUT_BUTTONS: 'MouseButton3' }),
        windowsHide: true,
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(IpcChannels.AppGlobalShortcutCommand, 'playPause');
    expect(sendMock).not.toHaveBeenCalledWith(IpcChannels.AppGlobalShortcutCommand, 'nextTrack');
  });

  it('validates mouse side buttons without Electron globalShortcut registration on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    expect(shortcuts.validateGlobalShortcut('MouseButton5')).toEqual({
      accelerator: 'MouseButton5',
      available: true,
      reason: 'available',
      valid: true,
    });
    expect(registerMock).not.toHaveBeenCalledWith('MouseButton5', expect.any(Function));
  });

  it('does not let Electron accelerator validation reject mouse buttons on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    isRegisteredMock.mockImplementationOnce(() => {
      throw new Error('invalid accelerator');
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    expect(shortcuts.validateGlobalShortcut('MouseButton4')).toEqual({
      accelerator: 'MouseButton4',
      available: true,
      reason: 'available',
      valid: true,
    });
    expect(isRegisteredMock).not.toHaveBeenCalledWith('MouseButton4');
    expect(registerMock).not.toHaveBeenCalledWith('MouseButton4', expect.any(Function));
  });

  it('shows the main window directly for showMainWindow', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        showMainWindow: { enabled: true, accelerator: 'Ctrl+Alt+E' },
      },
    });
    minimized = true;
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    callbacks.get('Ctrl+Alt+E')?.();

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('hides the main window after dispatching the boss key command', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        bossKey: { enabled: true, accelerator: 'Ctrl+Alt+B' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    callbacks.get('Ctrl+Alt+B')?.();

    expect(sendMock).toHaveBeenCalledWith(IpcChannels.AppGlobalShortcutCommand, 'bossKey');
    expect(hideMock).toHaveBeenCalledTimes(1);
  });

  it('unregisters managed shortcuts on dispose', async () => {
    currentSettings = createSettings({
      globalShortcuts: {
        ...createDefaultGlobalShortcuts(),
        nextTrack: { enabled: true, accelerator: 'Ctrl+Alt+Right' },
      },
    });
    const shortcuts = await import('./backgroundPlaybackShortcuts');

    shortcuts.refreshBackgroundSpaceRegistration();
    shortcuts.disposeBackgroundPlaybackShortcuts();

    expect(unregisterMock).toHaveBeenCalledWith('Ctrl+Alt+Right');
  });
});
