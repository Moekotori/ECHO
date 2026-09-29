import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppIconPath } from './appIcon';

const tempDirs: string[] = [];
const requestedWindowsIconPath = 'D:\\ECHODev\\build-resources\\icons\\software.ico';

const makeMainOutputDir = (): { root: string; mainDir: string } => {
  const root = mkdtempSync(join(tmpdir(), 'echo-next-icon-'));
  const mainDir = join(root, 'out', 'main');

  mkdirSync(mainDir, { recursive: true });
  tempDirs.push(root);

  return { root, mainDir };
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveAppIconPath', () => {
  it('uses the requested Windows icon path when it exists', () => {
    if (process.platform !== 'win32') {
      return;
    }

    expect(resolveAppIconPath()).toBe(requestedWindowsIconPath);
  });

  it('finds the packaged build resource icon', () => {
    if (process.platform === 'win32') {
      return;
    }

    const { root, mainDir } = makeMainOutputDir();
    const iconPath = join(root, 'build-resources', 'icons', 'software.ico');
    mkdirSync(join(root, 'build-resources', 'icons'), { recursive: true });
    writeFileSync(iconPath, '');

    expect(resolveAppIconPath(mainDir)).toBe(iconPath);
  });

  it('ignores historical root icon duplicates', () => {
    if (process.platform === 'win32') {
      return;
    }

    const { root, mainDir } = makeMainOutputDir();
    writeFileSync(join(root, 'software.ico'), '');

    expect(resolveAppIconPath(mainDir)).toBeNull();
  });
});
