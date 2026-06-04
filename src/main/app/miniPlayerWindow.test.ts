import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    miniPlayerEnabled: false,
    miniPlayerLocked: false,
    miniPlayerAutoHideMainWindow: true,
    miniPlayerBounds: null as { x: number; y: number; width: number; height: number } | null,
  },
  mainWindow: null as null | {
    focus: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    moveTop: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  },
  miniWindows: [] as Array<{
    bounds: { x: number; y: number; width: number; height: number };
    getBounds: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
  }>,
  makeMainWindow: (minimized = false) => ({
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => minimized),
    moveTop: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
  }),
  setAppSettings: vi.fn(),
  createMainWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    bounds: { x: number; y: number; width: number; height: number };
    webContents: { on: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };

    constructor(options: { x: number; y: number; width: number; height: number }) {
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      this.webContents = {
        on: vi.fn(),
        send: vi.fn(),
      };
      mocks.miniWindows.push(this as unknown as (typeof mocks.miniWindows)[number]);
    }

    static getAllWindows(): unknown[] {
      return [];
    }

    destroy = vi.fn();
    getBounds = vi.fn(() => this.bounds);
    hide = vi.fn();
    isDestroyed = vi.fn(() => false);
    isVisible = vi.fn(() => true);
    once = vi.fn();
    setAlwaysOnTop = vi.fn();
    setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
      this.bounds = bounds;
    });
    setIgnoreMouseEvents = vi.fn();
    setMenuBarVisibility = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    showInactive = vi.fn();
    on = vi.fn();
    loadFile = vi.fn();
    loadURL = vi.fn();
  },
  screen: {
    getAllDisplays: vi.fn(() => [
      {
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ]),
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

vi.mock('./appSettings', () => ({
  getAppSettings: () => mocks.settings,
  setAppSettings: mocks.setAppSettings,
}));

vi.mock('./createMainWindow', () => ({
  createMainWindow: mocks.createMainWindow,
  createMainWindowWebPreferences: vi.fn(() => ({})),
}));

vi.mock('./windowManager', () => ({
  getMainWindow: () => mocks.mainWindow,
}));

vi.mock('../diagnostics/DevConsoleService', () => ({
  recordMainRuntimeIssue: vi.fn(),
  recordRendererConsoleMessage: vi.fn(),
}));

describe('mini player window bounds', () => {
  beforeEach(() => {
    mocks.settings.miniPlayerBounds = null;
    mocks.mainWindow = null;
    mocks.miniWindows = [];
    mocks.setAppSettings.mockClear();
    mocks.createMainWindow.mockReset();
    vi.resetModules();
  });

  it('defaults to the primary display top-right corner', async () => {
    const { resolveInitialMiniPlayerBounds } = await import('./miniPlayerWindow');

    expect(resolveInitialMiniPlayerBounds()).toEqual({
      x: 1504,
      y: 44,
      width: 388,
      height: 74,
    });
  });

  it('compacts saved bounds from previous default sizes', async () => {
    mocks.settings.miniPlayerBounds = {
      x: 1548,
      y: 44,
      width: 344,
      height: 96,
    };
    const { resolveInitialMiniPlayerBounds } = await import('./miniPlayerWindow');

    expect(resolveInitialMiniPlayerBounds()).toEqual({
      x: 1504,
      y: 44,
      width: 388,
      height: 74,
    });
  });

  it('compacts saved bounds from the oversized mini player', async () => {
    mocks.settings.miniPlayerBounds = {
      x: 1604,
      y: 44,
      width: 288,
      height: 84,
    };
    const { resolveInitialMiniPlayerBounds } = await import('./miniPlayerWindow');

    expect(resolveInitialMiniPlayerBounds()).toEqual({
      x: 1504,
      y: 44,
      width: 388,
      height: 74,
    });
  });

  it('compacts oversized visible bounds back to the clickable player chrome', async () => {
    mocks.settings.miniPlayerBounds = {
      x: -80,
      y: 24,
      width: 520,
      height: 116,
    };
    const { resolveInitialMiniPlayerBounds } = await import('./miniPlayerWindow');

    expect(resolveInitialMiniPlayerBounds()).toEqual({
      x: 0,
      y: 24,
      width: 388,
      height: 74,
    });
  });

  it('does not rewrite window bounds while reading state', async () => {
    const { createMiniPlayerWindow, getMiniPlayerState } = await import('./miniPlayerWindow');

    createMiniPlayerWindow();
    const window = mocks.miniWindows[0];
    window.bounds = { x: 320, y: 120, width: 520, height: 116 };
    window.setBounds.mockClear();

    expect(getMiniPlayerState().bounds).toEqual({ x: 320, y: 120, width: 520, height: 116 });
    expect(window.setBounds).not.toHaveBeenCalled();
  });
});

describe('mini player window hide behavior', () => {
  beforeEach(() => {
    mocks.settings.miniPlayerBounds = null;
    mocks.mainWindow = null;
    mocks.miniWindows = [];
    mocks.setAppSettings.mockClear();
    mocks.createMainWindow.mockReset();
    vi.resetModules();
  });

  it('restores the existing main window when requested', async () => {
    const mainWindow = mocks.makeMainWindow(true);
    mocks.mainWindow = mainWindow;
    const { hideMiniPlayerWindow } = await import('./miniPlayerWindow');

    hideMiniPlayerWindow({ restoreMainWindow: true });

    expect(mocks.setAppSettings).toHaveBeenCalledWith({ miniPlayerEnabled: false });
    expect(mainWindow.restore).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.moveTop).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
    expect(mainWindow.restore.mock.invocationCallOrder[0]).toBeLessThan(mainWindow.show.mock.invocationCallOrder[0]);
  });

  it('recreates the main window before restoring when no main window is registered', async () => {
    const mainWindow = mocks.makeMainWindow(false);
    mocks.createMainWindow.mockReturnValue(mainWindow);
    const { hideMiniPlayerWindow } = await import('./miniPlayerWindow');

    hideMiniPlayerWindow({ restoreMainWindow: true });

    expect(mocks.createMainWindow).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.moveTop).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });
});
