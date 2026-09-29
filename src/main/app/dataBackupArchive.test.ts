import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { applyRestorePlan, extractDataBackupArchive } from './dataBackupArchive';

const roots: string[] = [];

const makeRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('data backup archive safety', () => {
  it('extracts supported entries to a staging directory', async () => {
    const root = makeRoot('echo-backup-archive-');
    const archivePath = join(root, 'backup.zip');
    const stagingRoot = join(root, 'staging');
    writeFileSync(archivePath, zipSync({
      'manifest.json': strToU8('{"format":"echo-next-user-data-backup","version":1}'),
      'user-data/echo-settings.json': strToU8('{"locale":"zh-CN"}'),
      'cache/cover-cache/cover.webp': strToU8('cover'),
    }));

    const result = await extractDataBackupArchive(archivePath, stagingRoot);

    expect(result.entries).toContain('user-data/echo-settings.json');
    expect(readFileSync(join(stagingRoot, 'cache', 'cover-cache', 'cover.webp'), 'utf8')).toBe('cover');
  });

  it('rejects archive entries outside the supported backup roots', async () => {
    const root = makeRoot('echo-backup-archive-');
    const archivePath = join(root, 'backup.zip');
    const stagingRoot = join(root, 'staging');
    writeFileSync(archivePath, zipSync({
      'manifest.json': strToU8('{}'),
      'other/escape.txt': strToU8('nope'),
    }));

    await expect(extractDataBackupArchive(archivePath, stagingRoot)).rejects.toThrow('不支持的条目');
    expect(existsSync(stagingRoot)).toBe(false);
  });

  it('restores the previous target when commit validation fails', async () => {
    const root = makeRoot('echo-backup-restore-');
    const sourcePath = join(root, 'source.txt');
    const targetPath = join(root, 'target.txt');
    writeFileSync(sourcePath, 'new');
    writeFileSync(targetPath, 'old');

    await expect(applyRestorePlan([
      {
        kind: 'file',
        label: 'user-data/target.txt',
        sourcePath,
        targetPath,
      },
    ], () => {
      throw new Error('validation failed');
    })).rejects.toThrow('validation failed');

    expect(readFileSync(targetPath, 'utf8')).toBe('old');
  });

  it('atomically replaces directories and removes obsolete files', async () => {
    const root = makeRoot('echo-backup-restore-');
    const sourceDirectory = join(root, 'source-directory');
    const targetDirectory = join(root, 'target-directory');
    const obsoletePath = join(root, 'obsolete.tmp');
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(targetDirectory, { recursive: true });
    writeFileSync(join(sourceDirectory, 'new.txt'), 'new');
    writeFileSync(join(targetDirectory, 'old.txt'), 'old');
    writeFileSync(obsoletePath, 'obsolete');

    await applyRestorePlan([
      {
        kind: 'directory',
        label: 'cache/cover-cache',
        sourcePath: sourceDirectory,
        targetPath: targetDirectory,
      },
      {
        kind: 'file',
        label: 'user-data/echo-library.sqlite-wal',
        sourcePath: null,
        targetPath: obsoletePath,
      },
    ]);

    expect(readFileSync(join(targetDirectory, 'new.txt'), 'utf8')).toBe('new');
    expect(existsSync(join(targetDirectory, 'old.txt'))).toBe(false);
    expect(existsSync(obsoletePath)).toBe(false);
  });
});
