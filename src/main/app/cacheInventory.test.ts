import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCachePathStats } from './cacheInventory';

vi.mock('./appSettings', () => ({
  getAppSettings: () => ({}),
}));

vi.mock('./dataProtection', () => ({
  LibraryDatabaseUnavailableError: class LibraryDatabaseUnavailableError extends Error {},
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: vi.fn(),
}));

const tempDirectories: string[] = [];

const createTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'echo-cache-inventory-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('cacheInventory', () => {
  it('counts files recursively while yielding between chunks', async () => {
    const directory = await createTempDirectory();
    const nested = join(directory, 'nested');
    await mkdir(nested);
    await Promise.all([
      writeFile(join(directory, 'one.bin'), Buffer.alloc(3)),
      writeFile(join(directory, 'two.bin'), Buffer.alloc(5)),
      writeFile(join(directory, 'three.bin'), Buffer.alloc(7)),
      writeFile(join(nested, 'four.bin'), Buffer.alloc(11)),
      writeFile(join(nested, 'five.bin'), Buffer.alloc(13)),
    ]);
    let yieldCount = 0;

    const stats = await readCachePathStats(directory, {
      yieldEveryEntries: 2,
      yieldToEventLoop: async () => {
        yieldCount += 1;
      },
    });

    expect(stats).toMatchObject({
      fileCount: 5,
      sizeBytes: 39,
      lastError: null,
    });
    expect(yieldCount).toBeGreaterThanOrEqual(2);
  });

  it('returns empty stats for missing paths without throwing', async () => {
    const directory = await createTempDirectory();
    const stats = await readCachePathStats(join(directory, 'missing'));

    expect(stats).toEqual({
      sizeBytes: 0,
      fileCount: 0,
      lastError: null,
    });
  });
});
