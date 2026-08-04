import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { Dirent, Stats } from 'node:fs';
import type { AppCacheInventory, AppCacheInventoryItem, AppCacheKind } from '../../shared/types/coverCache';
import { getAppSettings } from './appSettings';
import { LibraryDatabaseUnavailableError } from './dataProtection';
import { getLibraryService } from '../library/LibraryService';

export type CachePathStats = {
  sizeBytes: number;
  fileCount: number;
  lastError: string | null;
};

export type CacheInventoryScanOptions = {
  yieldEveryEntries?: number;
  yieldToEventLoop?: () => Promise<void>;
};

const defaultYieldEveryEntries = 200;

const emptyCacheStats = (): CachePathStats => ({
  sizeBytes: 0,
  fileCount: 0,
  lastError: null,
});

const statIfExists = async (targetPath: string): Promise<Stats | null> => {
  try {
    return await stat(targetPath);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : null;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const readCachePathStats = async (
  targetPath: string,
  options: CacheInventoryScanOptions = {},
): Promise<CachePathStats> => {
  try {
    const targetStat = await statIfExists(targetPath);
    if (!targetStat) {
      return emptyCacheStats();
    }

    if (targetStat.isFile()) {
      return {
        sizeBytes: targetStat.size,
        fileCount: 1,
        lastError: null,
      };
    }

    if (!targetStat.isDirectory()) {
      return emptyCacheStats();
    }

    let sizeBytes = 0;
    let fileCount = 0;
    let lastError: string | null = null;
    let visitedEntries = 0;
    const yieldEveryEntries = Math.max(1, Math.floor(options.yieldEveryEntries ?? defaultYieldEveryEntries));
    const yieldToEventLoop = options.yieldToEventLoop ?? (() => yieldImmediate());
    const maybeYield = async (): Promise<void> => {
      visitedEntries += 1;
      if (visitedEntries % yieldEveryEntries === 0) {
        await yieldToEventLoop();
      }
    };
    const directories = [targetPath];

    while (directories.length > 0) {
      const directory = directories.pop();
      if (!directory) {
        continue;
      }

      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        lastError = getErrorMessage(error);
        await maybeYield();
        continue;
      }

      for (const entry of entries) {
        await maybeYield();
        const entryPath = join(directory, entry.name);
        try {
          if (entry.isDirectory()) {
            directories.push(entryPath);
            continue;
          }
          if (!entry.isFile()) {
            continue;
          }

          const entryStat = await stat(entryPath);
          sizeBytes += entryStat.size;
          fileCount += 1;
        } catch (error) {
          lastError = getErrorMessage(error);
        }
      }
    }

    return {
      sizeBytes,
      fileCount,
      lastError,
    };
  } catch (error) {
    return {
      sizeBytes: 0,
      fileCount: 0,
      lastError: getErrorMessage(error),
    };
  }
};

const createCacheInventoryItem = async (
  kind: AppCacheKind,
  label: string,
  targetPath: string,
  movable: boolean,
  reason: string,
): Promise<AppCacheInventoryItem> => {
  const stats = await readCachePathStats(targetPath);
  return {
    kind,
    label,
    path: targetPath,
    sizeBytes: stats.sizeBytes,
    fileCount: stats.fileCount,
    movable,
    reason,
    lastError: stats.lastError,
  };
};

export const getAppCacheInventory = async (userDataPath: string): Promise<AppCacheInventory> => {
  let databasePath = join(userDataPath, 'echo-library.sqlite');
  const configuredCoverCacheDir = getAppSettings().coverCacheDir;
  let coverCacheDir = typeof configuredCoverCacheDir === 'string' && configuredCoverCacheDir.trim()
    ? resolve(configuredCoverCacheDir.trim())
    : resolve(join(dirname(databasePath), 'cover-cache'));

  try {
    const libraryService = getLibraryService();
    const diagnostics = libraryService.getDiagnostics();
    databasePath = diagnostics.databasePath ?? databasePath;
    coverCacheDir = libraryService.getCoverCacheDir();
  } catch (error) {
    if (!(error instanceof LibraryDatabaseUnavailableError)) {
      throw error;
    }
  }

  const databaseDirectory = dirname(databasePath);
  const cacheItems: Array<[AppCacheKind, string, string, boolean, string]> = [
    ['cover', '\u5c01\u9762\u7f13\u5b58', coverCacheDir, true, '\u53ef\u901a\u8fc7\u7f13\u5b58\u76ee\u5f55\u8fc1\u79fb'],
    ['artist-image', '\u827a\u4eba\u56fe\u7f13\u5b58', join(databaseDirectory, 'artist-images'), false, '\u7b2c\u4e00\u9636\u6bb5\u53ea\u76d8\u70b9\uff0c\u4e0d\u8fc1\u79fb\u827a\u4eba\u56fe\u76ee\u5f55'],
    ['smtc-cover', 'SMTC \u5c01\u9762\u7f13\u5b58', join(userDataPath, 'smtc-covers'), false, '\u8fd0\u884c\u65f6\u53ef\u91cd\u65b0\u751f\u6210\uff0c\u7b2c\u4e00\u9636\u6bb5\u4e0d\u8fc1\u79fb'],
    ['download', '\u4e0b\u8f7d\u4efb\u52a1\u7f13\u5b58', join(userDataPath, 'echo-download-jobs.json'), false, '\u4e0b\u8f7d\u8bb0\u5f55\u4fdd\u5b58\u5728 userData\uff0c\u7b2c\u4e00\u9636\u6bb5\u4e0d\u8fc1\u79fb'],
    ['lyrics-mv', '\u6b4c\u8bcd/MV \u8bb0\u5f55', databasePath, false, '\u6b4c\u8bcd\u4e0e MV \u8bb0\u5f55\u5728\u66f2\u5e93\u6570\u636e\u5e93\u5185\uff0c\u7b2c\u4e00\u9636\u6bb5\u4e0d\u79fb\u52a8\u4e3b\u6570\u636e\u5e93'],
  ];
  const items: AppCacheInventoryItem[] = [];

  for (const [kind, label, targetPath, movable, reason] of cacheItems) {
    items.push(await createCacheInventoryItem(kind, label, targetPath, movable, reason));
  }

  return {
    items,
    totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    generatedAt: new Date().toISOString(),
  };
};
