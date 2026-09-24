import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    petEnabled: false,
    petBounds: null as { x: number; y: number; width: number; height: number } | null,
    petScalePercent: 100,
  },
  allWindows: [] as unknown[],
  createdWindows: [] as Array<{
    destroyed: boolean;
    visible: boolean;
    destroy: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    destroyed = false;
    visible = false;
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly webContents = {
      on: vi.fn(),
      send: vi.fn(),
      setZoomFactor: vi.fn(),
    };
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
      for (const listener of this.listeners.get('closed') ?? []) {
        listener();
      }
    });
    readonly loadFile = vi.fn();
    readonly loadURL = vi.fn();

    constructor() {
      mocks.createdWindows.push(this);
      mocks.allWindows.push(this);
    }

    static getAllWindows(): unknown[] {
      return mocks.allWindows;
    }

    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 1696, y: 856, width: 196, height: 196 };
    }

    getTitle(): string {
      return 'ECHO Pet';
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isVisible(): boolean {
      return this.visible;
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    once(event: string, listener: (...args: unknown[]) => void): this {
      return this.on(event, listener);
    }

    setAlwaysOnTop(): void {}
    setBounds(): void {}
    setMenuBarVisibility(): void {}
    setVisibleOnAllWorkspaces(): void {}
    showInactive(): void {
      this.visible = true;
    }
  },
  screen: {
    getAllDisplays: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
}));

vi.mock('./appSettings', () => ({
  getAppSettings: () => mocks.settings,
  setAppSettings: vi.fn(),
}));

vi.mock('./createMainWindow', () => ({
  createMainWindowWebPreferences: vi.fn(() => ({})),
}));

vi.mock('../diagnostics/DevConsoleService', () => ({
  recordMainRuntimeIssue: vi.fn(),
  recordRendererConsoleMessage: vi.fn(),
}));

describe('pet window bounds', () => {
  beforeEach(() => {
    mocks.settings.petBounds = null;
    mocks.settings.petScalePercent = 100;
    mocks.allWindows = [];
    mocks.createdWindows = [];
    vi.resetModules();
  });

  it('starts near the bottom-right of the primary display', async () => {
    const { resolveInitialPetBounds } = await import('./petWindow');

    expect(resolveInitialPetBounds()).toEqual({
      x: 1696,
      y: 856,
      width: 196,
      height: 196,
    });
  });

  it('keeps a visible saved position and repairs the fixed window size', async () => {
    mocks.settings.petBounds = { x: 120, y: 240, width: 800, height: 900 };
    const { resolveInitialPetBounds } = await import('./petWindow');

    expect(resolveInitialPetBounds()).toEqual({
      x: 120,
      y: 240,
      width: 196,
      height: 196,
    });
  });

  it('falls back when the saved position is off screen', async () => {
    mocks.settings.petBounds = { x: 9000, y: 9000, width: 196, height: 196 };
    const { resolveInitialPetBounds } = await import('./petWindow');

    expect(resolveInitialPetBounds()).toEqual({
      x: 1696,
      y: 856,
      width: 196,
      height: 196,
    });
  });

  it('uses the saved pet scale for the window size', async () => {
    mocks.settings.petScalePercent = 150;
    mocks.settings.petBounds = { x: 120, y: 240, width: 196, height: 196 };
    const { resolveInitialPetBounds } = await import('./petWindow');

    expect(resolveInitialPetBounds()).toEqual({
      x: 120,
      y: 240,
      width: 294,
      height: 294,
    });
  });

  it('destroys the renderer window when the pet is hidden', async () => {
    const { hidePetWindow, showPetWindow } = await import('./petWindow');

    showPetWindow();
    expect(mocks.createdWindows).toHaveLength(1);

    hidePetWindow();

    expect(mocks.createdWindows[0].destroy).toHaveBeenCalledTimes(1);
    expect(mocks.createdWindows[0].destroyed).toBe(true);
  });

  it('loads the pet from the startup-art-free auxiliary entry', async () => {
    const { showPetWindow } = await import('./petWindow');

    showPetWindow();

    expect(mocks.createdWindows[0].loadFile).toHaveBeenCalledWith(
      expect.stringContaining('auxiliary.html'),
      { query: { pet: '1' } },
    );
  });
});
