import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const coverCacheOwnershipMarkerName = '.echo-cover-cache-root.json';
export const externalCoverCacheUninstallRecordName = '.echo-external-cover-cache-root.txt';

const coverCacheOwnershipMarker = {
  owner: 'app.echo.next',
  kind: 'cover-cache',
  version: 1,
} as const;

const sameResolvedPath = (leftPath: string, rightPath: string): boolean => {
  const left = resolve(leftPath);
  const right = resolve(rightPath);
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
};

const isUnredirectedDirectory = (directory: string): boolean => {
  try {
    const resolvedDirectory = resolve(directory);
    const entry = lstatSync(resolvedDirectory);
    return (
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      sameResolvedPath(resolvedDirectory, realpathSync.native(resolvedDirectory))
    );
  } catch {
    return false;
  }
};

const isSameOrInside = (parentPath: string, candidatePath: string): boolean => {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

export const getCoverCacheOwnershipMarkerPath = (directory: string): string =>
  join(resolve(directory), coverCacheOwnershipMarkerName);

export const hasCoverCacheOwnershipMarker = (directory: string): boolean => {
  if (!isUnredirectedDirectory(directory)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(getCoverCacheOwnershipMarkerPath(directory), 'utf8')) as Record<string, unknown>;
    return (
      parsed.owner === coverCacheOwnershipMarker.owner &&
      parsed.kind === coverCacheOwnershipMarker.kind &&
      parsed.version === coverCacheOwnershipMarker.version
    );
  } catch {
    return false;
  }
};

export const canClaimCoverCacheDirectory = (directory: string): boolean => {
  const resolvedDirectory = resolve(directory);
  if (!existsSync(resolvedDirectory)) {
    return true;
  }
  if (!isUnredirectedDirectory(resolvedDirectory)) {
    return false;
  }
  if (hasCoverCacheOwnershipMarker(resolvedDirectory)) {
    return true;
  }

  try {
    return readdirSync(resolvedDirectory).length === 0;
  } catch {
    return false;
  }
};

export const isCoverCacheDirectorySafeToClear = (databasePath: string, coverCachePath: string): boolean =>
  sameResolvedPath(coverCachePath, join(dirname(resolve(databasePath)), 'cover-cache')) ||
  hasCoverCacheOwnershipMarker(coverCachePath);

export const writeCoverCacheOwnershipMarker = async (directory: string): Promise<void> => {
  const resolvedDirectory = resolve(directory);
  await mkdir(resolvedDirectory, { recursive: true });
  if (!isUnredirectedDirectory(resolvedDirectory)) {
    throw new Error(`Refusing to mark a redirected cover cache directory as ECHO-owned: ${resolvedDirectory}`);
  }
  await writeFile(
    getCoverCacheOwnershipMarkerPath(resolvedDirectory),
    `${JSON.stringify(coverCacheOwnershipMarker)}\n`,
    'utf8',
  );
};

export const syncExternalCoverCacheUninstallRecord = async (
  userDataPath: string,
  coverCachePath: string,
): Promise<void> => {
  const resolvedUserDataPath = resolve(userDataPath);
  const resolvedCoverCachePath = resolve(coverCachePath);
  const recordPath = join(resolvedUserDataPath, externalCoverCacheUninstallRecordName);

  if (
    isSameOrInside(resolvedUserDataPath, resolvedCoverCachePath) ||
    !hasCoverCacheOwnershipMarker(resolvedCoverCachePath)
  ) {
    await rm(recordPath, { force: true });
    return;
  }

  await mkdir(resolvedUserDataPath, { recursive: true });
  await writeFile(recordPath, resolvedCoverCachePath, 'utf16le');
};
