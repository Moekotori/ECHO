import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { app } from 'electron';
import sharp from 'sharp';
import { fetchWithNetworkProxy } from '../../network/networkFetch';
import { readResponseBodyLimited } from '../../network/readResponseBodyLimited';

const passthroughExtensions = new Set(['.jpg', '.jpeg', '.png']);
const maxRemoteCoverBytes = 8 * 1024 * 1024;
const remoteCoverTimeoutMs = 8_000;
type FetchCover = typeof fetchWithNetworkProxy;

const cacheKeyForPath = async (coverPath: string): Promise<string> => {
  const stats = await stat(coverPath);
  const hash = createHash('sha256');
  hash.update(coverPath);
  hash.update(String(stats.size));
  hash.update(String(Math.round(stats.mtimeMs)));
  return hash.digest('hex').slice(0, 24);
};

export class SmtcCoverCache {
  private readonly pendingRemoteCovers = new Map<string, Promise<string | null>>();

  constructor(
    private readonly cacheDirectory = join(app.getPath('userData'), 'smtc-covers'),
    private readonly fetchCover: FetchCover = fetchWithNetworkProxy,
  ) {}

  async resolve(coverPath: string | null, coverUrl: string | null = null): Promise<string | null> {
    if (coverPath && existsSync(coverPath)) {
      return this.resolveLocalCover(coverPath);
    }

    return this.resolveRemoteCover(coverUrl);
  }

  private async resolveLocalCover(coverPath: string): Promise<string | null> {
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

  private resolveRemoteCover(coverUrl: string | null): Promise<string | null> {
    const normalizedUrl = this.normalizeRemoteCoverUrl(coverUrl);
    if (!normalizedUrl) {
      return Promise.resolve(null);
    }

    const existing = this.pendingRemoteCovers.get(normalizedUrl);
    if (existing) {
      return existing;
    }

    const pending = this.materializeRemoteCover(normalizedUrl).finally(() => {
      this.pendingRemoteCovers.delete(normalizedUrl);
    });
    this.pendingRemoteCovers.set(normalizedUrl, pending);
    return pending;
  }

  private async materializeRemoteCover(coverUrl: string): Promise<string | null> {
    const cacheKey = createHash('sha256').update(coverUrl).digest('hex').slice(0, 24);
    const targetPath = join(this.cacheDirectory, `${cacheKey}-remote.png`);
    if (existsSync(targetPath)) {
      return targetPath;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remoteCoverTimeoutMs);
    timeout.unref?.();
    try {
      const response = await this.fetchCover(coverUrl, {
        signal: controller.signal,
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
      });
      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.startsWith('image/')) {
        return null;
      }

      const coverBuffer = Buffer.from(await readResponseBodyLimited(response, maxRemoteCoverBytes, { signal: controller.signal }));
      if (coverBuffer.length === 0) {
        return null;
      }

      await mkdir(this.cacheDirectory, { recursive: true });
      await sharp(coverBuffer, { animated: false, limitInputPixels: 40_000_000 })
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(targetPath);
      return targetPath;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeRemoteCoverUrl(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
      return null;
    }
  }
}
