import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileIdentityService, QUICK_HASH_VERSION } from './FileIdentityService';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-identity-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('FileIdentityService', () => {
  it('quick_hash reads only bounded head and tail slices', () => {
    const root = makeTempRoot();
    const filePath = join(root, 'large.flac');
    writeFileSync(filePath, Buffer.alloc(200 * 1024, 7));
    const reads: Array<{ length: number; position: number }> = [];
    const service = new FileIdentityService({
      now: () => '2026-05-18T00:00:00.000Z',
      readSlice: (_fd, buffer, offset, length, position) => {
        reads.push({ length, position });
        buffer.fill(7, offset, offset + length);
        return length;
      },
    });

    const result = service.observe(filePath);

    expect(result.quickHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.quickHashVersion).toBe(QUICK_HASH_VERSION);
    expect(reads).toEqual([
      { length: 64 * 1024, position: 0 },
      { length: 64 * 1024, position: 136 * 1024 },
    ]);
  });

  it('quick_hash handles small files with one bounded read', () => {
    const root = makeTempRoot();
    const filePath = join(root, 'small.flac');
    writeFileSync(filePath, 'small audio');
    const reads: Array<{ length: number; position: number }> = [];
    const service = new FileIdentityService({
      readSlice: (_fd, buffer, offset, length, position) => {
        reads.push({ length, position });
        buffer.fill(1, offset, offset + length);
        return length;
      },
    });

    const result = service.observe(filePath);

    expect(result.quickHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reads).toEqual([{ length: 11, position: 0 }]);
  });

  it('returns an error observation when the file cannot be read', () => {
    const service = new FileIdentityService({ now: () => '2026-05-18T00:00:00.000Z' });

    const result = service.observe(join(makeTempRoot(), 'missing.flac'));

    expect(result).toMatchObject({
      fileIdentity: null,
      fileIdentitySource: 'error',
      quickHash: null,
      quickHashVersion: QUICK_HASH_VERSION,
      identityStatus: 'error',
      identityUpdatedAt: '2026-05-18T00:00:00.000Z',
    });
    expect(result.identityError).toBeTruthy();
  });
});
