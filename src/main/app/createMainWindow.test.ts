import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMainWindowWebPreferences,
  defaultMainWindowSize,
  mainWindowMinimumSize,
  resolveInitialMainWindowSize,
  resolveMainWindowBackgroundOptions,
  resolvePreloadPath,
} from './createMainWindow';

const tempDirs: string[] = [];

const makeOutMainDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'echo-next-preload-'));
  const mainDir = join(root, 'main');
  const preloadDir = join(root, 'preload');

  mkdirSync(mainDir, { recursive: true });
  mkdirSync(preloadDir, { recursive: true });
  tempDirs.push(root);

  return mainDir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolvePreloadPath', () => {
  it('prefers electron-vite preload index.mjs output', () => {
    const mainDir = makeOutMainDir();
    const preloadPath = join(mainDir, '../preload/index.mjs');
    writeFileSync(preloadPath, '');

    expect(resolvePreloadPath(mainDir)).toBe(preloadPath);
  });

  it('falls back to index.js for compatibility', () => {
    const mainDir = makeOutMainDir();

    expect(resolvePreloadPath(mainDir)).toBe(join(mainDir, '../preload/index.js'));
  });
});

describe('createMainWindowWebPreferences', () => {
  it('keeps renderer timers unthrottled for background playback', () => {
    expect(createMainWindowWebPreferences()).toMatchObject({
      backgroundThrottling: false,
    });
  });

  it('sets a concrete DevTools policy on shared renderer windows', () => {
    expect(createMainWindowWebPreferences()).toHaveProperty('devTools');
  });
});

describe('mainWindowMinimumSize', () => {
  it('allows portrait-sized app windows', () => {
    expect(mainWindowMinimumSize).toEqual({
      width: 360,
      height: 620,
    });
  });
});

describe('resolveInitialMainWindowSize', () => {
  it('uses the default desktop size when no remembered size exists', () => {
    expect(resolveInitialMainWindowSize({ rememberWindowSizeEnabled: true, rememberedWindowSize: null } as never)).toEqual(defaultMainWindowSize);
  });

  it('restores a remembered size when the preference is enabled', () => {
    expect(
      resolveInitialMainWindowSize({
        rememberWindowSizeEnabled: true,
        rememberedWindowSize: { width: 900, height: 700 },
      } as never),
    ).toEqual({ width: 900, height: 700 });
  });

  it('ignores remembered size when the preference is disabled', () => {
    expect(
      resolveInitialMainWindowSize({
        rememberWindowSizeEnabled: false,
        rememberedWindowSize: { width: 900, height: 700 },
      } as never),
    ).toEqual(defaultMainWindowSize);
  });
});

describe('resolveMainWindowBackgroundOptions', () => {
  it('keeps the normal main window opaque when acrylic is off', () => {
    expect(resolveMainWindowBackgroundOptions({ appWindowAcrylicEnabled: false }, true)).toEqual({
      backgroundColor: '#f7f9fc',
      backgroundMaterial: 'none',
    });
  });

  it('uses acrylic background material only when acrylic is explicitly on', () => {
    expect(resolveMainWindowBackgroundOptions({ appWindowAcrylicEnabled: true }, true)).toEqual({
      backgroundColor: '#f7f9fc',
      backgroundMaterial: 'acrylic',
    });
  });
});
