import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    desktopLyricsEnabled: false,
    desktopLyricsLocked: false,
    desktopLyricsBounds: null as { x: number; y: number; width: number; height: number } | null,
    desktopLyricsTextDirection: 'horizontal' as 'horizontal' | 'vertical',
  },
  createdWindows: [] as Array<{
    visible: boolean;
    destroyed: boolean;
    bounds: { x: number; y: number; width: number; height: number };
    webContents: {
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
    destroy: ReturnType<typeof vi.fn>;
    getBounds: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    moveTop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    setAlwaysOnTop: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
    setMenuBarVisibility: ReturnType<typeof vi.fn>;
    setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>;
    showInactive: ReturnType<typeof vi.fn>;
  }>,
  makeBrowserWindow: (options: { x: number; y: number; width: number; height: number }) => {
    const listeners = new Map<string, Array<() => void>>();
    const window = {
      visible: false,
      destroyed: false,
      bounds: {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      },
      webContents: {
        on: vi.fn(),
        send: vi.fn(),
      },
      destroy: vi.fn(() => {
        window.destroyed = true;
        for (const listener of listeners.get('closed') ?? []) {
          listener();
        }
      }),
      getBounds: vi.fn(() => window.bounds),
      hide: vi.fn(() => {
        window.visible = false;
        for (const listener of listeners.get('hide') ?? []) {
          listener();
        }
      }),
      isDestroyed: vi.fn(() => window.destroyed),
      isVisible: vi.fn(() => window.visible),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      moveTop: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return window;
      }),
      once: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return window;
      }),
      setAlwaysOnTop: vi.fn(),
      setBounds: vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
        window.bounds = bounds;
      }),
      setIgnoreMouseEvents: vi.fn(),
      setMenuBarVisibility: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn(() => {
        window.visible = true;
        for (const listener of listeners.get('show') ?? []) {
          listener();
        }
      }),
    };

    return window;
  },
  displays: [
    {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 110, width: 1920, height: 970 },
    },
  ],
  setAppSettings: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: { x: number; y: number; width: number; height: number }) {
      const window = mocks.makeBrowserWindow(options);
      mocks.createdWindows.push(window);
      return window;
    }

    static getAllWindows(): unknown[] {
      return mocks.createdWindows;
    }
  },
  screen: {
    getAllDisplays: vi.fn(() => mocks.displays),
    getDisplayMatching: vi.fn(() => mocks.displays[0]),
    getPrimaryDisplay: vi.fn(() => mocks.displays[0]),
  },
}));

vi.mock('./appSettings', () => ({
  getAppSettings: () => mocks.settings,
  setAppSettings: mocks.setAppSettings,
}));

vi.mock('./createMainWindow', () => ({
  createMainWindowWebPreferences: vi.fn(() => ({})),
}));

vi.mock('./windowManager', () => ({
  getMainWindow: () => null,
}));

vi.mock('../diagnostics/DevConsoleService', () => ({
  recordMainRuntimeIssue: vi.fn(),
  recordRendererConsoleMessage: vi.fn(),
}));

describe('desktop lyrics window bounds', () => {
  beforeEach(() => {
    mocks.settings.desktopLyricsEnabled = false;
    mocks.settings.desktopLyricsLocked = false;
    mocks.settings.desktopLyricsBounds = null;
    mocks.settings.desktopLyricsTextDirection = 'horizontal';
    mocks.createdWindows.splice(0);
    mocks.displays = [
      {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 110, width: 1920, height: 970 },
      },
    ];
    mocks.setAppSettings.mockClear();
    vi.resetModules();
  });

  it('restores saved bounds at the physical top of a display with reserved top work area', async () => {
    mocks.settings.desktopLyricsBounds = {
      x: 480,
      y: 0,
      width: 760,
      height: 150,
    };
    const { resolveInitialDesktopLyricsBounds } = await import('./desktopLyricsWindow');

    expect(resolveInitialDesktopLyricsBounds()).toEqual({
      x: 480,
      y: 0,
      width: 760,
      height: 150,
    });
  });

  it('keeps default reset placement inside the usable work area', async () => {
    const { resolveInitialDesktopLyricsBounds } = await import('./desktopLyricsWindow');

    expect(resolveInitialDesktopLyricsBounds()).toEqual({
      x: 580,
      y: 846,
      width: 760,
      height: 150,
    });
  });

  it('uses a taller default window for vertical desktop lyrics', async () => {
    mocks.settings.desktopLyricsTextDirection = 'vertical';
    const { resolveInitialDesktopLyricsBounds } = await import('./desktopLyricsWindow');

    expect(resolveInitialDesktopLyricsBounds()).toEqual({
      x: 730,
      y: 356,
      width: 460,
      height: 640,
    });
  });

  it('expands short saved bounds when restoring vertical desktop lyrics', async () => {
    mocks.settings.desktopLyricsTextDirection = 'vertical';
    mocks.settings.desktopLyricsBounds = {
      x: 480,
      y: 760,
      width: 760,
      height: 150,
    };
    const { resolveInitialDesktopLyricsBounds } = await import('./desktopLyricsWindow');

    expect(resolveInitialDesktopLyricsBounds()).toEqual({
      x: 480,
      y: 440,
      width: 760,
      height: 640,
    });
  });
});

describe('desktop lyrics startup memory', () => {
  beforeEach(() => {
    mocks.settings.desktopLyricsEnabled = false;
    mocks.settings.desktopLyricsLocked = false;
    mocks.settings.desktopLyricsBounds = null;
    mocks.settings.desktopLyricsTextDirection = 'horizontal';
    mocks.createdWindows.splice(0);
    mocks.setAppSettings.mockClear();
    vi.resetModules();
  });

  it('does not restore the desktop lyrics window when it was disabled before exit', async () => {
    const { restoreDesktopLyricsWindowOnStartup } = await import('./desktopLyricsWindow');

    restoreDesktopLyricsWindowOnStartup();

    expect(mocks.createdWindows).toHaveLength(0);
    expect(mocks.setAppSettings).not.toHaveBeenCalledWith({ desktopLyricsEnabled: true });
  });

  it('restores the desktop lyrics window when it was open before exit', async () => {
    mocks.settings.desktopLyricsEnabled = true;
    const { restoreDesktopLyricsWindowOnStartup } = await import('./desktopLyricsWindow');

    restoreDesktopLyricsWindowOnStartup();

    expect(mocks.createdWindows).toHaveLength(1);
    expect(mocks.createdWindows[0].showInactive).toHaveBeenCalledTimes(1);
    expect(mocks.createdWindows[0].setAlwaysOnTop).toHaveBeenCalled();
    expect(mocks.setAppSettings).toHaveBeenCalledWith({ desktopLyricsEnabled: true });
  });

  it('keeps the desktop lyrics enabled memory when closing a visible window during quit', async () => {
    mocks.settings.desktopLyricsEnabled = true;
    const { closeDesktopLyricsWindow, showDesktopLyricsWindow } = await import('./desktopLyricsWindow');
    showDesktopLyricsWindow();
    mocks.setAppSettings.mockClear();

    closeDesktopLyricsWindow();

    expect(mocks.setAppSettings).toHaveBeenCalledWith({ desktopLyricsEnabled: true });
    expect(mocks.createdWindows[0].destroy).toHaveBeenCalledTimes(1);
  });
});
