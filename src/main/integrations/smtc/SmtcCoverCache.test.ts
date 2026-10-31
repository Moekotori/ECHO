import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmtcCoverCache } from './SmtcCoverCache';

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'echo-next-test-user-data'),
  },
}));

let root: string | null = null;

const makeRoot = async (): Promise<string> => {
  root = await mkdtemp(join(tmpdir(), 'echo-smtc-cover-cache-'));
  return root;
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    root = null;
  }
});

describe('SmtcCoverCache', () => {
  it('passes through png and jpeg covers', async () => {
    const directory = await makeRoot();
    const coverPath = join(directory, 'cover.jpg');
    writeFileSync(coverPath, 'jpeg-ish');

    const cache = new SmtcCoverCache(join(directory, 'cache'));

    await expect(cache.resolve(coverPath)).resolves.toBe(coverPath);
  });

  it('converts webp covers to cached png files', async () => {
    const directory = await makeRoot();
    const coverPath = join(directory, 'cover.webp');
    mkdirSync(directory, { recursive: true });
    await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: '#336699',
      },
    })
      .webp()
      .toFile(coverPath);

    const cache = new SmtcCoverCache(join(directory, 'cache'));
    const resolved = await cache.resolve(coverPath);

    expect(resolved).toMatch(/\.png$/u);
    expect(resolved && existsSync(resolved)).toBe(true);
    await expect(sharp(resolved ?? '').metadata()).resolves.toMatchObject({ format: 'png' });
  });

  it('returns null for missing or unreadable covers', async () => {
    const directory = await makeRoot();
    const cache = new SmtcCoverCache(join(directory, 'cache'));

    await expect(cache.resolve(join(directory, 'missing.webp'))).resolves.toBeNull();
  });
});
