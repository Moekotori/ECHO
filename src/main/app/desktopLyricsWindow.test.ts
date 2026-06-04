import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    desktopLyricsBounds: null as { x: number; y: number; width: number; height: number } | null,
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
    static getAllWindows(): unknown[] {
      return [];
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
    mocks.settings.desktopLyricsBounds = null;
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
});
