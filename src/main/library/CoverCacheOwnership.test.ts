import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCoverCacheDirectory } from './CoverCacheManager';
import {
  externalCoverCacheUninstallRecordName,
  hasCoverCacheOwnershipMarker,
  isCoverCacheDirectorySafeToClear,
  syncExternalCoverCacheUninstallRecord,
} from './CoverCacheOwnership';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-cover-cache-owner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('cover cache ownership', () => {
  it('marks a newly created cache directory as owned by ECHO Next', async () => {
    const root = makeTempRoot();
    const cacheDir = join(root, 'new-cache');

    await ensureCoverCacheDirectory(cacheDir);

    expect(hasCoverCacheOwnershipMarker(cacheDir)).toBe(true);
  });

  it('does not claim a non-empty existing directory', async () => {
    const root = makeTempRoot();
    const cacheDir = join(root, 'shared-cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'unrelated.txt'), 'keep', 'utf8');

    await ensureCoverCacheDirectory(cacheDir);

    expect(hasCoverCacheOwnershipMarker(cacheDir)).toBe(false);
    expect(readFileSync(join(cacheDir, 'unrelated.txt'), 'utf8')).toBe('keep');
  });

  it('does not claim a redirected directory root', async () => {
    const root = makeTempRoot();
    const target = join(root, 'target-cache');
    const redirected = join(root, 'redirected-cache');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');

    await ensureCoverCacheDirectory(redirected);

    expect(hasCoverCacheOwnershipMarker(redirected)).toBe(false);
    expect(hasCoverCacheOwnershipMarker(target)).toBe(false);
  });

  it('records only an owned external cache for the uninstaller', async () => {
    const userDataPath = makeTempRoot();
    const externalCache = join(makeTempRoot(), 'cover-cache');
    await ensureCoverCacheDirectory(externalCache);

    await syncExternalCoverCacheUninstallRecord(userDataPath, externalCache);

    const recordPath = join(userDataPath, externalCoverCacheUninstallRecordName);
    expect(readFileSync(recordPath, 'utf16le')).toBe(resolve(externalCache));

    const internalCache = join(userDataPath, 'cover-cache');
    await ensureCoverCacheDirectory(internalCache);
    await syncExternalCoverCacheUninstallRecord(userDataPath, internalCache);
    expect(existsSync(recordPath)).toBe(false);
  });

  it('allows whole-cache clearing only for the default or an owned directory', async () => {
    const root = makeTempRoot();
    const databasePath = join(root, 'echo-library.sqlite');
    const defaultCache = join(root, 'cover-cache');
    const unownedCache = join(makeTempRoot(), 'shared-cache');
    const ownedCache = join(makeTempRoot(), 'owned-cache');
    mkdirSync(unownedCache, { recursive: true });
    writeFileSync(join(unownedCache, 'unrelated.txt'), 'keep', 'utf8');
    await ensureCoverCacheDirectory(ownedCache);

    expect(isCoverCacheDirectorySafeToClear(databasePath, defaultCache)).toBe(true);
    expect(isCoverCacheDirectorySafeToClear(databasePath, ownedCache)).toBe(true);
    expect(isCoverCacheDirectorySafeToClear(databasePath, unownedCache)).toBe(false);
  });
});
