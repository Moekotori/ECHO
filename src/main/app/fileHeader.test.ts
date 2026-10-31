import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasPortableExecutableHeader, readFilePrefixSync } from './fileHeader';

const temporaryDirectories: string[] = [];

const createFixture = (contents: Buffer): string => {
  const directory = mkdtempSync(join(tmpdir(), 'echo-file-header-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'fixture.bin');
  writeFileSync(path, contents);
  return path;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('fileHeader', () => {
  it('reads only the requested prefix', () => {
    const path = createFixture(Buffer.from([0x4d, 0x5a, 0x01, 0x02, 0x03]));

    expect(readFilePrefixSync(path, 2)).toEqual(Buffer.from([0x4d, 0x5a]));
  });

  it('recognizes PE files without accepting missing or invalid files', () => {
    expect(hasPortableExecutableHeader(createFixture(Buffer.from([0x4d, 0x5a, 0x90, 0x00])))).toBe(true);
    expect(hasPortableExecutableHeader(createFixture(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))).toBe(false);
    expect(hasPortableExecutableHeader(join(tmpdir(), 'echo-file-header-missing.bin'))).toBe(false);
  });
});
