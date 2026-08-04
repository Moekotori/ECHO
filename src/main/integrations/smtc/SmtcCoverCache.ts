import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { app } from 'electron';
import sharp from 'sharp';

const passthroughExtensions = new Set(['.jpg', '.jpeg', '.png']);

const cacheKeyForPath = async (coverPath: string): Promise<string> => {
  const stats = await stat(coverPath);
  const hash = createHash('sha256');
  hash.update(coverPath);
  hash.update(String(stats.size));
  hash.update(String(Math.round(stats.mtimeMs)));
  return hash.digest('hex').slice(0, 24);
};

export class SmtcCoverCache {
  constructor(private readonly cacheDirectory = join(app.getPath('userData'), 'smtc-covers')) {}

  async resolve(coverPath: string | null): Promise<string | null> {
    if (!coverPath || !existsSync(coverPath)) {
      return null;
    }

    const extension = extname(coverPath).toLowerCase();
    if (passthroughExtensions.has(extension)) {
      return coverPath;
    }

    try {
      await mkdir(this.cacheDirectory, { recursive: true });
      const cacheKey = await cacheKeyForPath(coverPath);
      const targetPath = join(this.cacheDirectory, `${cacheKey}-${basename(coverPath, extension)}.png`);

      if (existsSync(targetPath)) {
        return targetPath;
      }

      const coverBuffer = await readFile(coverPath);
      await sharp(coverBuffer, { animated: false })
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(targetPath);

      return targetPath;
    } catch {
      return null;
    }
  }
}
