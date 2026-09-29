import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cachedExtensions = ['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif'] as const;

const extensionForMimeType = (mimeType: string): string | null => {
  switch (mimeType.split(';')[0]?.trim().toLocaleLowerCase()) {
    case 'image/avif': return 'avif';
    case 'image/webp': return 'webp';
    case 'image/png': return 'png';
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/gif': return 'gif';
    default: return null;
  }
};

const mimeTypeForExtension = (extension: string): string => {
  switch (extension.toLocaleLowerCase()) {
    case 'avif': return 'image/avif';
    case 'webp': return 'image/webp';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    default: return 'image/jpeg';
  }
};

export const subsonicCoverDiskCacheKey = (identity: string, size: number): string =>
  createHash('sha256').update('subsonic-cover').update('\0').update(identity).update('\0').update(String(size)).digest('hex');

export type SubsonicCoverDiskCacheEntry = {
  data: Buffer;
  mimeType: string;
};

export const readSubsonicCoverDiskCache = async (
  cacheDir: string,
  identity: string,
  size: number,
): Promise<SubsonicCoverDiskCacheEntry | null> => {
  const cacheKey = subsonicCoverDiskCacheKey(identity, size);
  for (const extension of cachedExtensions) {
    try {
      return {
        data: await readFile(join(cacheDir, `${cacheKey}.${extension}`)),
        mimeType: mimeTypeForExtension(extension),
      };
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
};

export const writeSubsonicCoverDiskCache = async (
  cacheDir: string,
  identity: string,
  size: number,
  mimeType: string,
  data: Uint8Array,
): Promise<boolean> => {
  const extension = extensionForMimeType(mimeType);
  if (!extension || data.byteLength === 0) {
    return false;
  }
  const cacheKey = subsonicCoverDiskCacheKey(identity, size);
  const targetPath = join(cacheDir, `${cacheKey}.${extension}`);
  const tempPath = join(cacheDir, `${cacheKey}.${randomUUID()}.tmp`);
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(tempPath, data);
    await rename(tempPath, targetPath);
    return true;
  } catch {
    await unlink(tempPath).catch(() => undefined);
    return false;
  }
};
