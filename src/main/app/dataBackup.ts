import { createReadStream, createWriteStream, existsSync, rmSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { strToU8, Zip, ZipPassThrough } from 'fflate';
import type {
  DataBackupExportResult,
  DataBackupImportResult,
  DataBackupProgress,
  DataBackupRunReason,
  DataBackupStatus,
} from '../../shared/types/settingsBackup';
import type { AppSettings } from '../../shared/types/appSettings';
import { checkDatabaseHealth } from '../database/health';
import { getLibraryDatabaseManager } from '../database/LibraryDatabaseManager';
import { ensureCoverCacheDirectory, getDefaultCoverCacheDir } from '../library/CoverCacheManager';
import { isCoverCacheDirectorySafeToClear } from '../library/CoverCacheOwnership';
import { getLibraryService } from '../library/LibraryService';
import { getAccountService } from '../accounts/AccountService';
import {
  getAppSettings,
  getAppWallpaperDirectory,
  getLyricsWallpaperDirectory,
  normalizeSettings,
  setAppSettings,
} from './appSettings';
import { checkpointProtectedLibrary, createDataProtectionSnapshot, protectedDataEntries } from './dataProtection';
import {
  applyRestorePlan,
  extractDataBackupArchive,
  readBackupManifestJson,
  readBackupSettingsJson,
  type RestorePlanEntry,
} from './dataBackupArchive';

const dataBackupFormat = 'echo-next-user-data-backup';
const dataBackupVersion = 1;
const libraryFileName = 'echo-library.sqlite';
const libraryWalFileName = `${libraryFileName}-wal`;
const libraryShmFileName = `${libraryFileName}-shm`;
const libraryEntryNames = new Set([libraryFileName, libraryWalFileName, libraryShmFileName]);
const metadataFileNames = ['echo-download-jobs.json'];
const runtimeCacheDirectories = ['smtc-covers', 'artist-images'];
const importArchiveDirectoryName = 'data-backup-import-archives';
const initialAutoBackupDelayMs = 90_000;
const minRescheduleDelayMs = 15_000;
const maxTimerDelayMs = 2_147_000_000;
const initialFailureRetryDelayMs = 5 * 60_000;
const maxFailureRetryDelayMs = 6 * 60 * 60_000;
const dayMs = 24 * 60 * 60 * 1000;

type Manifest = {
  format: typeof dataBackupFormat;
  version: typeof dataBackupVersion;
  exportedAt: string;
  reason: DataBackupRunReason;
  appVersion: string;
  database: {
    health: ReturnType<typeof checkDatabaseHealth>;
    backupMethod: 'none' | 'sqlite-backup' | 'file-copy';
  };
  settingsFile: string;
  entries: string[];
};

type StreamingZipWriter = {
  addBytes: (entryPath: string, content: Uint8Array, onProgress?: ZipEntryProgressHandler) => Promise<string>;
  addFile: (entryPath: string, sourcePath: string, onProgress?: ZipEntryProgressHandler) => Promise<string | null>;
  close: () => Promise<number>;
  abort: () => Promise<void>;
};

type ZipEntryProgressHandler = (bytes: number, final: boolean) => void;

type ZipTask = {
  zipPath: string;
  sourcePath: string;
  sizeBytes: number;
};

type ZipCollectionProgress = {
  currentEntry: string | null;
  processedEntries: number;
  processedBytes: number;
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerNextBackupAt: string | null = null;
let runningBackup: Promise<DataBackupExportResult> | null = null;
let runningImport: Promise<DataBackupImportResult> | null = null;
let backupFailureCount = 0;
let backupRetryNotBefore = 0;
let currentDataBackupProgress: DataBackupProgress | null = null;
let lastDataBackupProgressEmitAt = 0;

const dataBackupProgressListeners = new Set<(progress: DataBackupProgress) => void>();

const timestampForPath = (date = new Date()): string => date.toISOString().replace(/[:.]/g, '-');

const yieldToEventLoop = (): Promise<void> => new Promise((resolveYield) => setTimeout(resolveYield, 0));
const yieldToMainWork = (): Promise<void> => new Promise((resolveYield) => setImmediate(resolveYield));

const toZipText = (value: unknown): Uint8Array => strToU8(`${JSON.stringify(value, null, 2)}\n`);

const clampProgressPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const notifyDataBackupProgressListener = (listener: (progress: DataBackupProgress) => void, progress: DataBackupProgress): void => {
  try {
    listener(progress);
  } catch (error) {
    console.warn('[data-backup] progress listener failed', error);
  }
};

const emitDataBackupProgress = (progress: DataBackupProgress, options: { force?: boolean } = {}): void => {
  currentDataBackupProgress = progress;
  const now = Date.now();
  if (!options.force && now - lastDataBackupProgressEmitAt < 250) {
    return;
  }

  lastDataBackupProgressEmitAt = now;
  for (const listener of dataBackupProgressListeners) {
    notifyDataBackupProgressListener(listener, progress);
  }
};

export const subscribeDataBackupProgress = (listener: (progress: DataBackupProgress) => void): (() => void) => {
  dataBackupProgressListeners.add(listener);
  if (currentDataBackupProgress) {
    notifyDataBackupProgressListener(listener, currentDataBackupProgress);
  }

  return () => {
    dataBackupProgressListeners.delete(listener);
  };
};

const startDataBackupProgress = (
  reason: DataBackupRunReason,
  outputPath: string,
  startedAt: string,
): DataBackupProgress => {
  const progress: DataBackupProgress = {
    running: true,
    reason,
    phase: 'preparing',
    percent: null,
    processedEntries: 0,
    totalEntries: null,
    processedBytes: 0,
    totalBytes: null,
    currentEntry: null,
    outputPath,
    startedAt,
    updatedAt: startedAt,
    error: null,
  };
  emitDataBackupProgress(progress, { force: true });
  return progress;
};

const updateDataBackupProgress = (
  patch: Partial<DataBackupProgress>,
  options: { force?: boolean } = {},
): DataBackupProgress => {
  const now = new Date().toISOString();
  const progress: DataBackupProgress = {
    ...(currentDataBackupProgress ?? {
      running: true,
      reason: 'manual' as DataBackupRunReason,
      phase: 'preparing' as const,
      percent: null,
      processedEntries: 0,
      totalEntries: null,
      processedBytes: 0,
      totalBytes: null,
      currentEntry: null,
      outputPath: null,
      startedAt: now,
      updatedAt: now,
      error: null,
    }),
    ...patch,
    updatedAt: now,
  };
  emitDataBackupProgress(progress, options);
  return progress;
};

const safeZipPath = (path: string): string =>
  path.split(sep).join('/').replace(/\\/g, '/').replace(/^\/+/u, '').replace(/(?:^|\/)\.\.(?=\/|$)/gu, '_');

const safeRelativeZipPath = (zipRoot: string, sourceRoot: string, sourcePath: string): string =>
  safeZipPath(`${zipRoot}/${relative(sourceRoot, sourcePath)}`);

const isInsideDirectory = (directory: string, targetPath: string): boolean => {
  const relativePath = relative(resolve(directory), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const isExcluded = (targetPath: string, excludedPaths: string[]): boolean =>
  excludedPaths.some((excludedPath) => isInsideDirectory(excludedPath, targetPath));

const createStreamingZipWriter = async (outputPath: string): Promise<StreamingZipWriter> => {
  const outputDirectory = dirname(outputPath);
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(outputDirectory, { recursive: true });

  const output = createWriteStream(tempPath);
  let pendingDrain: Promise<void> | null = null;
  let drainListener: (() => void) | null = null;
  let drainResolve: (() => void) | null = null;
  let streamError: Error | null = null;
  let zipError: Error | null = null;
  let outputClosed = false;

  const resolvePendingDrain = (): void => {
    if (drainListener) {
      output.off('drain', drainListener);
    }
    const resolveDrain = drainResolve;
    pendingDrain = null;
    drainListener = null;
    drainResolve = null;
    resolveDrain?.();
  };

  output.once('error', (error) => {
    streamError = error;
    resolvePendingDrain();
  });

  const waitForOutput = async (): Promise<void> => {
    if (pendingDrain) {
      await pendingDrain;
    }
    if (zipError) {
      throw zipError;
    }
    if (streamError) {
      throw streamError;
    }
  };

  const markBackpressure = (): void => {
    if (pendingDrain) {
      return;
    }
    pendingDrain = new Promise<void>((resolveDrain) => {
      drainResolve = resolveDrain;
      drainListener = resolvePendingDrain;
      output.once('drain', resolvePendingDrain);
    });
  };

  const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
    output.once('close', () => {
      outputClosed = true;
      resolveCompletion();
    });
    output.once('error', rejectCompletion);
  });

  const zipWriter = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      output.destroy(error);
      resolvePendingDrain();
      return;
    }

    if (chunk.length > 0 && !output.write(Buffer.from(chunk))) {
      markBackpressure();
    }
    if (final) {
      output.end();
    }
  });

  const addBytes = async (entryPath: string, content: Uint8Array, onProgress?: ZipEntryProgressHandler): Promise<string> => {
    await waitForOutput();
    const zipPath = safeZipPath(entryPath);
    const entry = new ZipPassThrough(zipPath);
    zipWriter.add(entry);
    entry.push(content, true);
    onProgress?.(content.length, true);
    await waitForOutput();
    await yieldToMainWork();
    return zipPath;
  };

  const addFile = async (entryPath: string, sourcePath: string, onProgress?: ZipEntryProgressHandler): Promise<string | null> => {
    await waitForOutput();
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      return null;
    }

    const zipPath = safeZipPath(entryPath);
    const entry = new ZipPassThrough(zipPath);
    zipWriter.add(entry);

    for await (const chunk of createReadStream(sourcePath, { highWaterMark: 64 * 1024 })) {
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      entry.push(bytes, false);
      onProgress?.(bytes.length, false);
      await waitForOutput();
      await yieldToMainWork();
    }

    entry.push(new Uint8Array(), true);
    onProgress?.(0, true);
    await waitForOutput();
    await yieldToMainWork();
    return zipPath;
  };

  const abort = async (): Promise<void> => {
    zipWriter.terminate();
    if (!outputClosed) {
      output.destroy();
      try {
        await completion;
      } catch {
        // The caller will receive the original failure; abort only cleans up the temporary file.
      }
    }
    rmSync(tempPath, { force: true, maxRetries: 3, retryDelay: 50 });
  };

  const close = async (): Promise<number> => {
    try {
      await waitForOutput();
      zipWriter.end();
      await completion;
      if (zipError) {
        throw zipError;
      }
      rmSync(outputPath, { force: true, maxRetries: 3, retryDelay: 50 });
      await rename(tempPath, outputPath);
      return statSync(outputPath).size;
    } catch (error) {
      await abort();
      throw error;
    }
  };

  return { addBytes, addFile, close, abort };
};

const collectFileForZip = async (
  tasks: ZipTask[],
  entryPath: string,
  sourcePath: string,
  warnings: string[],
  skippedEntries: string[],
  onCollected?: (task: ZipTask) => void,
): Promise<void> => {
  try {
    const fileStat = await stat(sourcePath);
    if (!fileStat.isFile()) {
      skippedEntries.push(entryPath);
      return;
    }

    const task = {
      zipPath: safeZipPath(entryPath),
      sourcePath,
      sizeBytes: fileStat.size,
    };
    tasks.push(task);
    onCollected?.(task);
  } catch (error) {
    skippedEntries.push(entryPath);
    warnings.push(`${entryPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const collectDirectoryForZip = async (
  tasks: ZipTask[],
  zipRoot: string,
  sourceRoot: string,
  warnings: string[],
  skippedEntries: string[],
  excludedPaths: string[] = [],
  onCollected?: (task: ZipTask) => void,
): Promise<void> => {
  if (!existsSync(sourceRoot)) {
    skippedEntries.push(zipRoot);
    return;
  }

  let walkedFiles = 0;
  const walk = async (directory: string): Promise<void> => {
    if (isExcluded(directory, excludedPaths)) {
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`${safeZipPath(`${zipRoot}/${relative(sourceRoot, directory)}`)}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries) {
      const sourcePath = join(directory, entry.name);
      if (isExcluded(sourcePath, excludedPaths)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(sourcePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      await collectFileForZip(tasks, safeRelativeZipPath(zipRoot, sourceRoot, sourcePath), sourcePath, warnings, skippedEntries, onCollected);
      walkedFiles += 1;
      if (walkedFiles % 80 === 0) {
        await yieldToEventLoop();
      }
    }
  };

  await walk(sourceRoot);
};

const writeZipTask = async (
  writer: StreamingZipWriter,
  task: ZipTask,
  warnings: string[],
  includedEntries: string[],
  skippedEntries: string[],
  onProgress?: ZipEntryProgressHandler,
): Promise<void> => {
  try {
    const zipPath = await writer.addFile(task.zipPath, task.sourcePath, onProgress);
    if (zipPath) {
      includedEntries.push(zipPath);
    } else {
      skippedEntries.push(task.zipPath);
    }
  } catch (error) {
    skippedEntries.push(task.zipPath);
    warnings.push(`${task.zipPath}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

const collectBackupTasks = async (
  sourceGroups: Array<{ zipRoot: string; sourceRoot: string; kind: 'file' | 'directory'; excludedPaths?: string[] }>,
  warnings: string[],
  skippedEntries: string[],
  onProgress?: (progress: ZipCollectionProgress) => void,
): Promise<ZipTask[]> => {
  const tasks: ZipTask[] = [];
  let collectedBytes = 0;
  const handleCollected = (task: ZipTask): void => {
    collectedBytes += task.sizeBytes;
    onProgress?.({
      currentEntry: task.zipPath,
      processedEntries: tasks.length,
      processedBytes: collectedBytes,
    });
  };

  for (const group of sourceGroups) {
    if (group.kind === 'directory') {
      await collectDirectoryForZip(tasks, group.zipRoot, group.sourceRoot, warnings, skippedEntries, group.excludedPaths ?? [], handleCollected);
    } else {
      await collectFileForZip(tasks, group.zipRoot, group.sourceRoot, warnings, skippedEntries, handleCollected);
    }
  }

  return tasks;
};

const createRestoreReadme = (): string => `# ECHO Next 数据备份

这个备份用于恢复 ECHO Next 的用户数据。它包含设置、曲库索引、账号本地状态、播放记忆、均衡器预设、壁纸、封面缓存和运行时缓存。

导入前 ECHO Next 会先归档当前数据；如果备份里的曲库数据库没有通过健康检查，导入会被拒绝。

备份可能包含账号令牌等敏感信息，请只保存到你信任的磁盘或同步目录。
`;

const createBackupPath = (directory: string, date = new Date()): string =>
  join(directory, `ECHO-NEXT-backup-${timestampForPath(date)}.zip`);

const getDefaultCoverCachePath = (userDataPath: string): string =>
  getDefaultCoverCacheDir(join(userDataPath, libraryFileName));

const resolveCoverCacheSource = (userDataPath: string, settings: AppSettings, warnings: string[]): string => {
  try {
    return getLibraryService().getCoverCacheDir();
  } catch (error) {
    warnings.push(`Cover cache path resolved without library service: ${error instanceof Error ? error.message : String(error)}`);
    return settings.coverCacheDir ? resolve(settings.coverCacheDir) : getDefaultCoverCachePath(userDataPath);
  }
};

const assertSnapshotIsHealthy = (snapshot: Awaited<ReturnType<typeof createDataProtectionSnapshot>>, userDataPath: string): void => {
  const activeDatabasePath = join(userDataPath, libraryFileName);
  const snapshotDatabasePath = join(snapshot.snapshotPath, libraryFileName);
  if (!existsSync(activeDatabasePath)) {
    return;
  }

  if (snapshot.libraryHealth.status !== 'ok' || !existsSync(snapshotDatabasePath)) {
    throw new Error(`曲库数据库未通过健康检查，已拒绝备份：${snapshot.libraryHealth.message ?? snapshot.libraryHealth.status}`);
  }
};

export const exportEchoUserDataBackup = async (
  outputPath: string,
  options: { reason?: DataBackupRunReason; date?: Date } = {},
): Promise<DataBackupExportResult> => {
  const exportedAtDate = options.date ?? new Date();
  const exportedAt = exportedAtDate.toISOString();
  const reason = options.reason ?? 'manual';
  const userDataPath = app.getPath('userData');
  const settings = getAppSettings();
  const warnings: string[] = [];
  const includedEntries: string[] = [];
  const skippedEntries: string[] = [];
  const backupDirectory = dirname(outputPath);
  let writer: StreamingZipWriter | null = null;
  startDataBackupProgress(reason, outputPath, exportedAt);

  try {
    updateDataBackupProgress({ phase: 'snapshot', currentEntry: libraryFileName }, { force: true });
    checkpointProtectedLibrary(userDataPath);
    const snapshot = await createDataProtectionSnapshot('manual-library-database-snapshot', userDataPath, exportedAtDate);
    assertSnapshotIsHealthy(snapshot, userDataPath);

    const sourceGroups: Array<{ zipRoot: string; sourceRoot: string; kind: 'file' | 'directory'; excludedPaths?: string[] }> = [];
    for (const entry of protectedDataEntries) {
      const sourcePath = join(snapshot.snapshotPath, entry.name);
      const entryPath = `user-data/${entry.name}`;
      sourceGroups.push({
        zipRoot: entryPath,
        sourceRoot: sourcePath,
        kind: entry.kind,
        excludedPaths: entry.kind === 'directory' ? [backupDirectory] : undefined,
      });
    }

    for (const name of metadataFileNames) {
      sourceGroups.push({ zipRoot: `user-data/${name}`, sourceRoot: join(userDataPath, name), kind: 'file' });
    }

    for (const name of runtimeCacheDirectories) {
      sourceGroups.push({ zipRoot: `user-data/${name}`, sourceRoot: join(userDataPath, name), kind: 'directory', excludedPaths: [backupDirectory] });
    }

    const coverCacheSource = resolveCoverCacheSource(userDataPath, settings, warnings);
    sourceGroups.push({ zipRoot: 'cache/cover-cache', sourceRoot: coverCacheSource, kind: 'directory', excludedPaths: [backupDirectory] });

    updateDataBackupProgress({ phase: 'scanning', currentEntry: null, percent: null, processedEntries: 0, processedBytes: 0 }, { force: true });
    const tasks = await collectBackupTasks(sourceGroups, warnings, skippedEntries, (progress) => {
      updateDataBackupProgress({
        phase: 'scanning',
        currentEntry: progress.currentEntry,
        processedEntries: progress.processedEntries,
        processedBytes: progress.processedBytes,
      });
    });

    let progressTotalBytes = tasks.reduce((total, task) => total + task.sizeBytes, 0);
    const totalEntries = tasks.length + 2;
    let processedBytes = 0;
    let processedEntries = 0;

    writer = await createStreamingZipWriter(outputPath);
    updateDataBackupProgress({
      phase: 'writing',
      currentEntry: null,
      percent: progressTotalBytes > 0 ? 0 : null,
      processedEntries,
      totalEntries,
      processedBytes,
      totalBytes: progressTotalBytes,
    }, { force: true });

    const handleWriteProgress = (entryPath: string, bytes: number, final: boolean): void => {
      processedBytes += bytes;
      if (final) {
        processedEntries += 1;
      }

      updateDataBackupProgress({
        phase: 'writing',
        currentEntry: entryPath,
        percent: progressTotalBytes > 0 ? clampProgressPercent((processedBytes / progressTotalBytes) * 100) : null,
        processedEntries,
        totalEntries,
        processedBytes,
        totalBytes: progressTotalBytes,
      });
    };

    for (const task of tasks) {
      await writeZipTask(writer, task, warnings, includedEntries, skippedEntries, (bytes, final) => {
        handleWriteProgress(task.zipPath, bytes, final);
      });
    }

    const manifestEntries = Array.from(new Set(includedEntries)).sort();
    const manifestPayload = toZipText({
      format: dataBackupFormat,
      version: dataBackupVersion,
      exportedAt,
      reason,
      appVersion: app.getVersion(),
      userDataPath,
      settingsFile: 'user-data/echo-settings.json',
      database: {
        health: snapshot.libraryHealth,
        backupMethod: snapshot.libraryBackupMethod,
      },
      coverCache: {
        sourcePath: coverCacheSource,
        restoredFrom: 'cache/cover-cache',
      },
      snapshot: {
        sourcePath: snapshot.snapshotPath,
        copied: snapshot.copied,
        skipped: snapshot.skipped,
      },
      entries: manifestEntries,
    } satisfies Manifest & Record<string, unknown>);
    const restorePayload = strToU8(createRestoreReadme());
    progressTotalBytes += manifestPayload.length + restorePayload.length;
    updateDataBackupProgress({
      phase: 'finalizing',
      currentEntry: 'manifest.json',
      percent: progressTotalBytes > 0 ? clampProgressPercent((processedBytes / progressTotalBytes) * 100) : null,
      totalBytes: progressTotalBytes,
    }, { force: true });
    includedEntries.push(await writer.addBytes('manifest.json', manifestPayload, (bytes, final) => handleWriteProgress('manifest.json', bytes, final)));
    includedEntries.push(await writer.addBytes('RESTORE.md', restorePayload, (bytes, final) => handleWriteProgress('RESTORE.md', bytes, final)));

    const sizeBytes = await writer.close();
    updateDataBackupProgress({
      running: false,
      phase: 'completed',
      currentEntry: null,
      percent: 100,
      processedEntries: Array.from(new Set(includedEntries)).length,
      totalEntries: Array.from(new Set(includedEntries)).length,
      processedBytes,
      totalBytes: progressTotalBytes,
      error: null,
    }, { force: true });
    return {
      filePath: outputPath,
      exportedAt,
      reason,
      snapshotPath: snapshot.snapshotPath,
      includedEntries: Array.from(new Set(includedEntries)).sort(),
      skippedEntries: Array.from(new Set(skippedEntries)).sort(),
      warnings,
      sizeBytes,
    };
  } catch (error) {
    updateDataBackupProgress({
      running: false,
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }, { force: true });
    await writer?.abort();
    throw error;
  }
};

const readManifest = async (stagingRoot: string): Promise<Manifest> => {
  const manifestPath = join(stagingRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('备份文件缺少 manifest.json。');
  }

  const manifest = await readBackupManifestJson<Partial<Manifest>>(manifestPath);
  if (manifest.format !== dataBackupFormat || manifest.version !== dataBackupVersion) {
    throw new Error('选中的文件不是受支持的 ECHO Next 数据备份。');
  }

  return manifest as Manifest;
};

const readSettingsFromBackup = async (stagingRoot: string): Promise<Partial<AppSettings>> => {
  const settingsPath = join(stagingRoot, 'user-data', 'echo-settings.json');
  if (!existsSync(settingsPath)) {
    throw new Error('备份文件缺少设置文件。');
  }

  const settings = await readBackupSettingsJson<unknown>(settingsPath);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Backup settings payload is invalid.');
  }

  return settings as Partial<AppSettings>;
};

const remapRestoredWallpaperPath = (
  value: unknown,
  directory: string,
  restoredSourceDirectory?: string,
): unknown => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return value;
  }

  const fileName = basename(value.trim());
  if (!fileName || fileName === '.' || fileName === '..') {
    return value;
  }

  const restoredPath = join(directory, fileName);
  const restoredSourcePath = restoredSourceDirectory ? join(restoredSourceDirectory, fileName) : null;
  return existsSync(restoredPath) || (restoredSourcePath && existsSync(restoredSourcePath)) ? restoredPath : value;
};

export const remapRestoredWallpaperPaths = (
  settings: Partial<AppSettings>,
  stagingRoot?: string,
): Partial<AppSettings> => ({
  ...settings,
  appCustomWallpaperPath: remapRestoredWallpaperPath(
    settings.appCustomWallpaperPath,
    getAppWallpaperDirectory(),
    stagingRoot ? join(stagingRoot, 'user-data', 'app-wallpapers') : undefined,
  ) as string | null | undefined,
  appPortraitWallpaperPath: remapRestoredWallpaperPath(
    settings.appPortraitWallpaperPath,
    getAppWallpaperDirectory(),
    stagingRoot ? join(stagingRoot, 'user-data', 'app-wallpapers') : undefined,
  ) as string | null | undefined,
  lyricsCustomWallpaperPath: remapRestoredWallpaperPath(
    settings.lyricsCustomWallpaperPath,
    getLyricsWallpaperDirectory(),
    stagingRoot ? join(stagingRoot, 'user-data', 'lyrics-wallpapers') : undefined,
  ) as string | null | undefined,
});

const createRollbackArchive = async (userDataPath: string, date: Date): Promise<string | null> => {
  const rollbackDirectory = join(userDataPath, 'data-protection', importArchiveDirectoryName);
  const rollbackPath = join(rollbackDirectory, `before-data-backup-import-${timestampForPath(date)}.zip`);
  const warnings: string[] = [];
  const includedEntries: string[] = [];
  const skippedEntries: string[] = [];
  let writer: StreamingZipWriter | null = null;

  try {
    const sourceGroups: Array<{ zipRoot: string; sourceRoot: string; kind: 'file' | 'directory'; excludedPaths?: string[] }> = [];
    for (const entry of protectedDataEntries) {
      const sourcePath = join(userDataPath, entry.name);
      sourceGroups.push({
        zipRoot: `user-data/${entry.name}`,
        sourceRoot: sourcePath,
        kind: entry.kind,
        excludedPaths: entry.kind === 'directory' ? [rollbackDirectory] : undefined,
      });
    }
    for (const name of metadataFileNames) {
      sourceGroups.push({ zipRoot: `user-data/${name}`, sourceRoot: join(userDataPath, name), kind: 'file' });
    }
    for (const name of runtimeCacheDirectories) {
      sourceGroups.push({ zipRoot: `user-data/${name}`, sourceRoot: join(userDataPath, name), kind: 'directory', excludedPaths: [rollbackDirectory] });
    }
    const currentSettings = getAppSettings();
    const coverCacheSource = resolveCoverCacheSource(userDataPath, currentSettings, warnings);
    sourceGroups.push({
      zipRoot: 'cache/cover-cache',
      sourceRoot: coverCacheSource,
      kind: 'directory',
      excludedPaths: [rollbackDirectory],
    });

    const tasks = await collectBackupTasks(sourceGroups, warnings, skippedEntries);
    if (tasks.length === 0) {
      return null;
    }

    writer = await createStreamingZipWriter(rollbackPath);
    for (const task of tasks) {
      await writeZipTask(writer, task, warnings, includedEntries, skippedEntries);
    }

    includedEntries.push(await writer.addBytes('manifest.json', toZipText({
      format: 'echo-next-import-rollback-archive',
      version: 1,
      exportedAt: date.toISOString(),
      note: 'Created before importing an ECHO Next data backup.',
      entries: Array.from(new Set(includedEntries)).sort(),
      warnings,
    })));

    await writer.close();
    return rollbackPath;
  } catch (error) {
    await writer?.abort();
    throw error;
  }
};

const validateBackupDatabase = (stagingRoot: string): void => {
  const databasePath = join(stagingRoot, 'user-data', libraryFileName);
  if (!existsSync(databasePath)) {
    return;
  }

  const health = checkDatabaseHealth(databasePath);
  if (health.status !== 'ok') {
    throw new Error(`备份内曲库数据库未通过健康检查：${health.message ?? health.status}`);
  }
};

const resolveCoverCacheRestoreTarget = async (
  userDataPath: string,
  settings: AppSettings,
  warnings: string[],
): Promise<{ settings: AppSettings; targetPath: string }> => {
  const defaultPath = getDefaultCoverCachePath(userDataPath);
  const preferredPath = settings.coverCacheDir ? resolve(settings.coverCacheDir) : defaultPath;

  try {
    await ensureCoverCacheDirectory(preferredPath);
    if (!isCoverCacheDirectorySafeToClear(join(userDataPath, libraryFileName), preferredPath)) {
      throw new Error('当前封面缓存目录没有 ECHO ownership marker，拒绝清空');
    }
    return { settings, targetPath: preferredPath };
  } catch (error) {
    warnings.push(`封面缓存目录不可用，已恢复到默认目录：${error instanceof Error ? error.message : String(error)}`);
    await ensureCoverCacheDirectory(defaultPath);
    return { settings: normalizeSettings({ ...settings, coverCacheDir: null }), targetPath: defaultPath };
  }
};

const buildRestoredSettings = (
  importedSettingsSource: Partial<AppSettings>,
  currentSettings: AppSettings,
  coverCacheSettings: AppSettings,
  stagingRoot: string,
): AppSettings =>
  normalizeSettings({
    ...remapRestoredWallpaperPaths(importedSettingsSource, stagingRoot),
    coverCacheDir: coverCacheSettings.coverCacheDir,
    autoDataBackupEnabled: currentSettings.autoDataBackupEnabled === true && Boolean(currentSettings.autoDataBackupDirectory),
    autoDataBackupDirectory: currentSettings.autoDataBackupDirectory ?? null,
    autoDataBackupIntervalDays: currentSettings.autoDataBackupIntervalDays ?? 7,
    autoDataBackupLastRunAt: currentSettings.autoDataBackupLastRunAt ?? null,
    autoDataBackupLastPath: currentSettings.autoDataBackupLastPath ?? null,
    autoDataBackupLastError: null,
  });

const addRestorePlanEntry = (
  plan: RestorePlanEntry[],
  skippedEntries: string[],
  stagingRoot: string,
  zipPath: string,
  targetPath: string,
  kind: RestorePlanEntry['kind'],
): void => {
  const sourcePath = join(stagingRoot, ...zipPath.split('/'));
  if (!existsSync(sourcePath)) {
    skippedEntries.push(zipPath);
    return;
  }
  plan.push({ kind, label: zipPath, sourcePath, targetPath });
};

const performDataBackupImport = async (backupPath: string, date: Date): Promise<DataBackupImportResult> => {
  const importedAt = date.toISOString();
  const userDataPath = app.getPath('userData');
  const stagingRoot = join(
    userDataPath,
    'data-protection',
    'data-backup-import-staging',
    `${timestampForPath(date)}-${randomUUID()}`,
  );
  const warnings: string[] = [];
  const restoredEntries: string[] = [];
  const skippedEntries: string[] = [];
  try {
    const extracted = await extractDataBackupArchive(backupPath, stagingRoot);
    await readManifest(stagingRoot);
    const importedSettingsSource = await readSettingsFromBackup(stagingRoot);
    const currentSettings = getAppSettings();
    const coverCache = await resolveCoverCacheRestoreTarget(userDataPath, currentSettings, warnings);
    const restoredSettings = buildRestoredSettings(importedSettingsSource, currentSettings, coverCache.settings, stagingRoot);
    validateBackupDatabase(stagingRoot);

    try {
      const libraryService = getLibraryService();
      if (libraryService.hasRunningJobs()) {
        throw new Error('曲库扫描运行中，暂时不能导入备份。');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('曲库扫描运行中')) {
        throw error;
      }
    }

    const manager = getLibraryDatabaseManager();
    const rollbackBackupPath = await manager.runExclusiveMaintenance('data-backup-import', async () => {
      const rollbackPath = await createRollbackArchive(userDataPath, date);
      const plan: RestorePlanEntry[] = [];

      for (const entry of protectedDataEntries) {
        if (libraryEntryNames.has(entry.name)) {
          continue;
        }
        addRestorePlanEntry(
          plan,
          skippedEntries,
          stagingRoot,
          `user-data/${entry.name}`,
          join(userDataPath, entry.name),
          entry.kind,
        );
      }
      for (const name of metadataFileNames) {
        addRestorePlanEntry(plan, skippedEntries, stagingRoot, `user-data/${name}`, join(userDataPath, name), 'file');
      }
      for (const name of runtimeCacheDirectories) {
        addRestorePlanEntry(plan, skippedEntries, stagingRoot, `user-data/${name}`, join(userDataPath, name), 'directory');
      }

      const stagedDatabasePath = join(stagingRoot, 'user-data', libraryFileName);
      if (existsSync(stagedDatabasePath)) {
        for (const name of [libraryFileName, libraryWalFileName, libraryShmFileName]) {
          const sourcePath = join(stagingRoot, 'user-data', name);
          plan.push({
            kind: 'file',
            label: `user-data/${name}`,
            sourcePath: existsSync(sourcePath) ? sourcePath : null,
            targetPath: join(userDataPath, name),
          });
        }
      } else {
        skippedEntries.push(`user-data/${libraryFileName}`);
      }

      addRestorePlanEntry(
        plan,
        skippedEntries,
        stagingRoot,
        'cache/cover-cache',
        coverCache.targetPath,
        'directory',
      );

      await applyRestorePlan(plan, () => {
        const restoredHealth = existsSync(stagedDatabasePath)
          ? checkDatabaseHealth(join(userDataPath, libraryFileName))
          : null;
        if (restoredHealth && restoredHealth.status !== 'ok') {
          throw new Error(`导入后的曲库数据库未通过健康检查：${restoredHealth.message ?? restoredHealth.status}`);
        }
        setAppSettings(restoredSettings);
        getAccountService().reloadFromDisk();
      });

      for (const entry of extracted.entries) {
        if (entry.startsWith('user-data/') || entry.startsWith('cache/cover-cache/')) {
          restoredEntries.push(entry);
        }
      }
      return rollbackPath;
    });

    return {
      importedAt,
      importedPath: backupPath,
      rollbackBackupPath,
      restoredEntries: Array.from(new Set(restoredEntries)).sort(),
      skippedEntries: Array.from(new Set(skippedEntries)).sort(),
      warnings,
      settings: restoredSettings,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

export const importEchoUserDataBackup = (
  backupPath: string,
  date = new Date(),
): Promise<DataBackupImportResult> => {
  if (runningBackup) {
    return Promise.reject(new Error('数据备份正在运行，完成后才能导入。'));
  }
  if (runningImport) {
    return Promise.reject(new Error('数据备份导入已经在运行。'));
  }

  const operation = performDataBackupImport(backupPath, date).finally(() => {
    if (runningImport === operation) {
      runningImport = null;
      refreshDataBackupScheduler();
    }
  });
  runningImport = operation;
  return operation;
};

const parseBackupTime = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const calculateNextBackupAt = (settings: AppSettings, fromTime = Date.now()): string | null => {
  if (settings.autoDataBackupEnabled !== true || !settings.autoDataBackupDirectory) {
    return null;
  }

  const lastRunTime = parseBackupTime(settings.autoDataBackupLastRunAt);
  if (lastRunTime === null) {
    return new Date(fromTime + initialAutoBackupDelayMs).toISOString();
  }

  return new Date(lastRunTime + (settings.autoDataBackupIntervalDays ?? 7) * dayMs).toISOString();
};

export const getDataBackupStatus = (): DataBackupStatus => {
  const settings = getAppSettings();
  return {
    enabled: settings.autoDataBackupEnabled === true,
    directory: settings.autoDataBackupDirectory ?? null,
    intervalDays: settings.autoDataBackupIntervalDays ?? 7,
    lastBackupAt: settings.autoDataBackupLastRunAt ?? null,
    lastBackupPath: settings.autoDataBackupLastPath ?? null,
    lastError: settings.autoDataBackupLastError ?? null,
    nextBackupAt: schedulerNextBackupAt ?? calculateNextBackupAt(settings),
    running: runningBackup !== null || runningImport !== null,
    progress: currentDataBackupProgress,
  };
};

export const runDataBackupNow = async (reason: DataBackupRunReason = 'manual'): Promise<DataBackupExportResult> => {
  if (runningImport) {
    refreshDataBackupScheduler();
    throw new Error('数据备份导入正在运行，完成后才能创建备份。');
  }
  if (runningBackup) {
    return runningBackup;
  }

  const settings = getAppSettings();
  if (!settings.autoDataBackupDirectory) {
    throw new Error('请先选择自动备份目录。');
  }

  const outputPath = createBackupPath(settings.autoDataBackupDirectory);
  runningBackup = exportEchoUserDataBackup(outputPath, { reason })
    .then((result) => {
      setAppSettings({
        autoDataBackupLastRunAt: result.exportedAt,
        autoDataBackupLastPath: result.filePath,
        autoDataBackupLastError: null,
      });
      backupFailureCount = 0;
      backupRetryNotBefore = 0;
      return result;
    })
    .catch((error) => {
      backupFailureCount += 1;
      backupRetryNotBefore = Date.now() + Math.min(
        maxFailureRetryDelayMs,
        initialFailureRetryDelayMs * 2 ** Math.min(backupFailureCount - 1, 8),
      );
      setAppSettings({
        autoDataBackupLastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      runningBackup = null;
      refreshDataBackupScheduler();
    });

  return runningBackup;
};

export const refreshDataBackupScheduler = (): void => {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  const settings = getAppSettings();
  const scheduledBackupAt = calculateNextBackupAt(settings);
  const nextBackupAt = scheduledBackupAt && backupRetryNotBefore > 0
    ? new Date(Math.max(new Date(scheduledBackupAt).getTime(), backupRetryNotBefore)).toISOString()
    : scheduledBackupAt;
  schedulerNextBackupAt = nextBackupAt;
  if (!nextBackupAt) {
    return;
  }

  const dueInMs = new Date(nextBackupAt).getTime() - Date.now();
  const delayMs = Math.min(maxTimerDelayMs, Math.max(minRescheduleDelayMs, dueInMs));
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    void runDataBackupNow('automatic').catch(() => undefined);
  }, delayMs);
};

export const initializeDataBackupScheduler = (): void => {
  refreshDataBackupScheduler();
};

export const disposeDataBackupScheduler = (): void => {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerNextBackupAt = null;
};
