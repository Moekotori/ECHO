import { randomUUID } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { access, copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { EchoDatabase } from '../database/createDatabase';
import type { AppSettings } from '../../shared/types/appSettings';
import type { CoverCacheMigrationResult } from '../../shared/types/coverCache';

type CoverRow = {
  id: string;
  thumb_path: string | null;
  album_path: string | null;
  large_path: string | null;
  original_ref: string | null;
  cover_thumb: string | null;
  cover_large: string | null;
  cover_original: string | null;
};

export type CoverCacheMigrationOptions = {
  oldDir: string;
  newDir: string;
  updateCoverPaths?: (oldDir: string, newDir: string, warnings: string[]) => number | Promise<number>;
};

const pathFields = [
  'thumb_path',
  'album_path',
  'large_path',
  'original_ref',
  'cover_thumb',
  'cover_large',
  'cover_original',
] as const;

const samePath = (left: string, right: string): boolean => {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);

  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase() === resolvedRight.toLocaleLowerCase()
    : resolvedLeft === resolvedRight;
};

const isInsideDir = (targetPath: string, directory: string): boolean => {
  const relativePath = relative(resolve(directory), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const remapCachePath = (targetPath: string | null, oldDir: string, newDir: string): string | null => {
  if (!targetPath || !isInsideDir(targetPath, oldDir)) {
    return null;
  }

  const relativePath = relative(resolve(oldDir), resolve(targetPath));
  return resolve(join(newDir, relativePath));
};

const ensureWritableDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await access(directory, fsConstants.W_OK);

  const probePath = join(directory, `.echo-cover-cache-write-test-${randomUUID()}`);
  await writeFile(probePath, '');
  await rm(probePath, { force: true });
};

export const ensureCoverCacheDirectory = async (directory: string): Promise<void> => {
  await ensureWritableDirectory(resolve(directory));
};

const copyCacheTree = async (
  oldDir: string,
  newDir: string,
  currentOldDir: string,
  result: CoverCacheMigrationResult,
): Promise<void> => {
  let entries;

  try {
    entries = await readdir(currentOldDir, { withFileTypes: true });
  } catch (error) {
    result.errors.push(`${currentOldDir}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  for (const entry of entries) {
    const sourcePath = join(currentOldDir, entry.name);
    const relativePath = relative(resolve(oldDir), resolve(sourcePath));
    const targetPath = join(newDir, relativePath);

    try {
      if (entry.isDirectory()) {
        await mkdir(targetPath, { recursive: true });
        await copyCacheTree(oldDir, newDir, sourcePath, result);
        continue;
      }

      if (!entry.isFile()) {
        result.warnings.push(`${sourcePath}: skipped non-file cache entry`);
        continue;
      }

      const sourceStat = await stat(sourcePath);

      try {
        const targetStat = await stat(targetPath);
        if (targetStat.isFile() && targetStat.size === sourceStat.size) {
          result.skippedFiles += 1;
          continue;
        }

        result.warnings.push(`${targetPath}: target exists with different content; kept existing file`);
        continue;
      } catch {
        await mkdir(dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath);
        result.copiedFiles += 1;
      }
    } catch (error) {
      result.errors.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

export const getDefaultCoverCacheDir = (databasePath: string): string => resolve(join(dirname(databasePath), 'cover-cache'));

export const resolveCoverCacheDir = (databasePath: string, override?: string | null): string => {
  if (typeof override === 'string' && override.trim().length > 0) {
    return resolve(override.trim());
  }

  return getDefaultCoverCacheDir(databasePath);
};

export const resolveConfiguredCoverCacheDir = (databasePath: string, settings: Pick<AppSettings, 'coverCacheDir'>): string =>
  resolveCoverCacheDir(databasePath, settings.coverCacheDir);

export const updateCoverPathsInDatabase = (
  database: EchoDatabase,
  oldDir: string,
  newDir: string,
  warnings: string[] = [],
): number => {
  if (samePath(oldDir, newDir)) {
    return 0;
  }

  const rows = database
    .prepare<unknown[], CoverRow>(
      `SELECT id, thumb_path, album_path, large_path, original_ref, cover_thumb, cover_large, cover_original
       FROM covers`,
    )
    .all();
  const update = database.prepare(
    `UPDATE covers SET
      thumb_path = ?,
      album_path = ?,
      large_path = ?,
      original_ref = ?,
      cover_thumb = ?,
      cover_large = ?,
      cover_original = ?,
      updated_at = ?
     WHERE id = ?`,
  );
  let updatedRows = 0;

  for (const row of rows) {
    const nextRow: CoverRow = { ...row };
    let changed = false;

    for (const field of pathFields) {
      const currentPath = row[field];

      if (!currentPath) {
        continue;
      }

      const nextPath = remapCachePath(currentPath, oldDir, newDir);

      if (!nextPath) {
        continue;
      }

      if (!existsSync(currentPath)) {
        warnings.push(`${currentPath}: cache path is missing; database path was left unchanged`);
        continue;
      }

      nextRow[field] = nextPath;
      changed = true;
    }

    if (!changed) {
      continue;
    }

    update.run(
      nextRow.thumb_path,
      nextRow.album_path,
      nextRow.large_path,
      nextRow.original_ref,
      nextRow.cover_thumb,
      nextRow.cover_large,
      nextRow.cover_original,
      new Date().toISOString(),
      row.id,
    );
    updatedRows += 1;
  }

  return updatedRows;
};

export const migrateCoverCache = async (options: CoverCacheMigrationOptions): Promise<CoverCacheMigrationResult> => {
  const oldDir = resolve(options.oldDir);
  const newDir = resolve(options.newDir);
  const result: CoverCacheMigrationResult = {
    oldDir,
    newDir,
    copiedFiles: 0,
    skippedFiles: 0,
    updatedCoverRows: 0,
    warnings: [],
    errors: [],
  };

  if (samePath(oldDir, newDir)) {
    await ensureWritableDirectory(newDir);
    return result;
  }

  try {
    await ensureWritableDirectory(newDir);
  } catch (error) {
    result.errors.push(`${newDir}: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  try {
    const oldStat = await stat(oldDir);
    if (!oldStat.isDirectory()) {
      result.errors.push(`${oldDir}: source cache path is not a directory`);
      return result;
    }
  } catch {
    return result;
  }

  await copyCacheTree(oldDir, newDir, oldDir, result);

  if (result.errors.length === 0 && options.updateCoverPaths) {
    result.updatedCoverRows = await options.updateCoverPaths(oldDir, newDir, result.warnings);
  }

  return result;
};
