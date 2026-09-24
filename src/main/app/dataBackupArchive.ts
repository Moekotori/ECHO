import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

const maxArchiveEntries = 100_000;
const maxArchiveUncompressedBytes = 64 * 1024 * 1024 * 1024;
const maxManifestBytes = 4 * 1024 * 1024;
const maxSettingsBytes = 32 * 1024 * 1024;

export type ExtractedDataBackupArchive = {
  entries: string[];
  totalBytes: number;
};

export type RestorePlanEntry = {
  kind: 'file' | 'directory';
  label: string;
  sourcePath: string | null;
  targetPath: string;
};

type PreparedRestoreEntry = RestorePlanEntry & {
  preparedPath: string | null;
  previousPath: string | null;
  previousMoved: boolean;
  replacementMoved: boolean;
};

const isInsideDirectory = (directory: string, targetPath: string): boolean => {
  const relativePath = relative(resolve(directory), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const resolveArchiveTarget = (root: string, entryPath: string): string => {
  const cleanPath = entryPath.replace(/\\/g, '/').replace(/^\/+/u, '');
  if (!cleanPath || cleanPath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`备份内路径不安全：${entryPath}`);
  }

  const targetPath = resolve(root, ...cleanPath.split('/'));
  if (!isInsideDirectory(root, targetPath)) {
    throw new Error(`备份内路径越界：${entryPath}`);
  }
  return targetPath;
};

const isSupportedEntry = (entryPath: string): boolean =>
  entryPath === 'manifest.json' ||
  entryPath === 'RESTORE.md' ||
  entryPath.startsWith('user-data/') ||
  entryPath.startsWith('cache/cover-cache/');

export const readLimitedJsonFile = async <T>(filePath: string, maxBytes: number): Promise<T> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size > maxBytes) {
    throw new Error(`备份文件条目过大：${filePath}`);
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
};

export const readBackupManifestJson = <T>(filePath: string): Promise<T> =>
  readLimitedJsonFile<T>(filePath, maxManifestBytes);

export const readBackupSettingsJson = <T>(filePath: string): Promise<T> =>
  readLimitedJsonFile<T>(filePath, maxSettingsBytes);

export const extractDataBackupArchive = async (
  archivePath: string,
  outputRoot: string,
): Promise<ExtractedDataBackupArchive> => {
  await mkdir(outputRoot, { recursive: true });
  const seenEntries = new Set<string>();
  const pendingWrites = new Set<Promise<void>>();
  const pendingDrains = new Set<Promise<void>>();
  let totalBytes = 0;
  let extractionError: Error | null = null;

  const fail = (error: unknown): void => {
    extractionError ??= error instanceof Error ? error : new Error(String(error));
  };

  const unzipper = new Unzip((file) => {
    if (extractionError) {
      file.terminate();
      return;
    }

    const entryPath = file.name.replace(/\\/g, '/').replace(/^\/+/u, '');
    try {
      if (!isSupportedEntry(entryPath)) {
        throw new Error(`备份包含不支持的条目：${file.name}`);
      }
      if (seenEntries.has(entryPath)) {
        throw new Error(`备份包含重复条目：${entryPath}`);
      }
      seenEntries.add(entryPath);
      if (seenEntries.size > maxArchiveEntries) {
        throw new Error(`备份条目过多，已超过 ${maxArchiveEntries} 个。`);
      }
      if (typeof file.originalSize === 'number' && file.originalSize > maxArchiveUncompressedBytes) {
        throw new Error(`备份条目过大：${entryPath}`);
      }

      const targetPath = resolveArchiveTarget(outputRoot, entryPath);
      mkdirSync(dirname(targetPath), { recursive: true });
      const output = createWriteStream(targetPath, { flags: 'wx' });
      const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
        output.once('close', resolveCompletion);
        output.once('error', rejectCompletion);
      });
      pendingWrites.add(completion);
      void completion.then(
        () => pendingWrites.delete(completion),
        (error) => {
          pendingWrites.delete(completion);
          fail(error);
        },
      );

      file.ondata = (error, chunk, final) => {
        if (error) {
          fail(error);
          output.destroy(error);
          return;
        }
        if (extractionError) {
          output.destroy(extractionError);
          file.terminate();
          return;
        }

        totalBytes += chunk.length;
        if (totalBytes > maxArchiveUncompressedBytes) {
          const limitError = new Error('备份解压后体积超过 64 GiB 安全限制。');
          fail(limitError);
          output.destroy(limitError);
          file.terminate();
          return;
        }

        if (chunk.length > 0 && !output.write(Buffer.from(chunk))) {
          const drain = new Promise<void>((resolveDrain, rejectDrain) => {
            output.once('drain', resolveDrain);
            output.once('close', resolveDrain);
            output.once('error', rejectDrain);
          });
          pendingDrains.add(drain);
          void drain.then(
            () => pendingDrains.delete(drain),
            (drainError) => {
              pendingDrains.delete(drain);
              fail(drainError);
            },
          );
        }
        if (final) {
          output.end();
        }
      };
      file.start();
    } catch (error) {
      fail(error);
      file.terminate();
    }
  });
  unzipper.register(UnzipPassThrough);
  unzipper.register(UnzipInflate);

  try {
    for await (const chunk of createReadStream(archivePath, { highWaterMark: 64 * 1024 })) {
      if (extractionError) {
        throw extractionError;
      }
      unzipper.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk), false);
      if (pendingDrains.size > 0) {
        await Promise.all([...pendingDrains]);
      }
    }
    unzipper.push(new Uint8Array(), true);
    await Promise.all([...pendingWrites]);
    if (extractionError) {
      throw extractionError;
    }
    return {
      entries: [...seenEntries].sort(),
      totalBytes,
    };
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    throw error;
  }
};

const prepareRestoreEntry = async (entry: RestorePlanEntry): Promise<PreparedRestoreEntry> => {
  const token = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const preparedPath = entry.sourcePath ? `${entry.targetPath}.echo-restore-${token}` : null;
  const previousPath = existsSync(entry.targetPath) ? `${entry.targetPath}.echo-before-restore-${token}` : null;

  if (entry.sourcePath && preparedPath) {
    const sourceStat = await stat(entry.sourcePath);
    if (entry.kind === 'directory' && !sourceStat.isDirectory()) {
      throw new Error(`恢复源不是目录：${entry.label}`);
    }
    if (entry.kind === 'file' && !sourceStat.isFile()) {
      throw new Error(`恢复源不是文件：${entry.label}`);
    }

    await mkdir(dirname(preparedPath), { recursive: true });
    if (entry.kind === 'directory') {
      await cp(entry.sourcePath, preparedPath, { recursive: true, force: false, errorOnExist: true });
    } else {
      await copyFile(entry.sourcePath, preparedPath);
    }
  }

  return {
    ...entry,
    preparedPath,
    previousPath,
    previousMoved: false,
    replacementMoved: false,
  };
};

const cleanupPreparedRestoreEntries = async (entries: PreparedRestoreEntry[]): Promise<void> => {
  for (const entry of entries) {
    if (entry.preparedPath) {
      try {
        await rm(entry.preparedPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        console.warn(`[data-backup] Failed to remove restore staging path ${entry.preparedPath}:`, error);
      }
    }
  }
};

export const applyRestorePlan = async (
  plan: RestorePlanEntry[],
  beforeCommit?: () => void | Promise<void>,
): Promise<void> => {
  const prepared: PreparedRestoreEntry[] = [];
  try {
    for (const entry of plan) {
      prepared.push(await prepareRestoreEntry(entry));
    }

    for (const entry of prepared) {
      if (entry.previousPath) {
        await rename(entry.targetPath, entry.previousPath);
        entry.previousMoved = true;
      }
      if (entry.preparedPath) {
        await rename(entry.preparedPath, entry.targetPath);
        entry.replacementMoved = true;
      }
    }
    await beforeCommit?.();
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const entry of [...prepared].reverse()) {
      try {
        if (entry.replacementMoved) {
          await rm(entry.targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        }
        if (entry.previousMoved && entry.previousPath) {
          await rename(entry.previousPath, entry.targetPath);
          entry.previousMoved = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${entry.label}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    await cleanupPreparedRestoreEntries(prepared);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}；自动回滚失败：${rollbackErrors.join('；')}`,
        { cause: error },
      );
    }
    throw error;
  }

  await cleanupPreparedRestoreEntries(prepared);
  for (const entry of prepared) {
    if (entry.previousPath) {
      try {
        await rm(entry.previousPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        console.warn(`[data-backup] Failed to remove committed restore fallback ${entry.previousPath}:`, error);
      }
    }
  }
};
