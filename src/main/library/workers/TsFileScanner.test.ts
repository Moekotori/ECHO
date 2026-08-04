import type { Dirent, Stats } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ScanFileSystemError } from '../libraryTypes';
import { TsFileScanner } from './TsFileScanner';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-file-scanner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const collectNames = async (root: string): Promise<string[]> => {
  const scanner = new TsFileScanner();
  const files = [];

  for await (const file of scanner.scanFolder(root)) {
    files.push(file.path.split(/[\\/]/).pop() ?? file.path);
  }

  return files.sort();
};

const fakeDirent = (name: string, kind: 'directory' | 'file'): Dirent =>
  ({
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  }) as Dirent;

const fakeStats = (kind: 'directory' | 'file', size = 5, mtimeMs = 1): Stats =>
  ({
    size,
    mtimeMs,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
  }) as Stats;

describe('TsFileScanner', () => {
  it('discovers newly supported audio formats without importing cue sheets', async () => {
    const root = makeTempRoot();
    const nested = join(root, 'nested');
    mkdirSync(nested, { recursive: true });
    const supported = [
      'track.alac',
      'track.opus',
      'track.dsf',
      'track.dff',
      'track.aiff',
      'track.aif',
      'track.ape',
      'track.wv',
      'track.tta',
      'track.tak',
      'track.mka',
      'track.mkv',
      'track.mp4',
      'track.m4p',
      'track.eac3',
      'track.ec3',
      'track.dd',
      'track.ddp',
      'track.thd',
      'track.truehd',
      'track.mlp',
      'track.ac4',
    ];

    for (const fileName of ['album.cue', ...supported]) {
      writeFileSync(join(nested, fileName), 'audio');
    }

    expect(await collectNames(root)).toEqual(supported.sort());
  });

  it('ignores artwork, text, and lyric files', async () => {
    const root = makeTempRoot();
    const files = ['cover.jpg', 'cover.png', 'notes.txt', 'song.lrc', 'song.flac'];

    for (const fileName of files) {
      writeFileSync(join(root, fileName), 'file');
    }

    expect(await collectNames(root)).toEqual(['song.flac']);
  });

  it('continues when one subdirectory cannot be read', async () => {
    const root = resolve(makeTempRoot());
    const locked = join(root, 'locked');
    const ok = join(root, 'ok');
    const errors: ScanFileSystemError[] = [];
    const fileSystem = {
      readdir: vi.fn(async (directoryPath: string) => {
        if (directoryPath === root) {
          return [fakeDirent('locked', 'directory'), fakeDirent('ok', 'directory')];
        }
        if (directoryPath === locked) {
          throw new Error('EACCES: permission denied');
        }
        if (directoryPath === ok) {
          return [fakeDirent('song.flac', 'file')];
        }
        return [];
      }),
      stat: vi.fn(async (filePath: string) => {
        if (filePath === root || filePath === locked || filePath === ok) {
          return fakeStats('directory');
        }
        return fakeStats('file', 5, 10);
      }),
    };
    const scanner = new TsFileScanner(fileSystem);
    const names = [];

    for await (const file of scanner.scanFolder(root, { onFileSystemError: (error) => errors.push(error) })) {
      names.push(file.path.split(/[\\/]/).pop() ?? file.path);
    }

    expect(names).toEqual(['song.flac']);
    expect(errors).toEqual([expect.objectContaining({ kind: 'directory', path: locked })]);
  });

  it('continues when one audio file cannot be statted', async () => {
    const root = resolve(makeTempRoot());
    const broken = join(root, 'broken.flac');
    const ok = join(root, 'ok.flac');
    const errors: ScanFileSystemError[] = [];
    const fileSystem = {
      readdir: vi.fn(async () => [fakeDirent('broken.flac', 'file'), fakeDirent('ok.flac', 'file')]),
      stat: vi.fn(async (filePath: string) => {
        if (filePath === root) {
          return fakeStats('directory');
        }
        if (filePath === broken) {
          throw new Error('EPERM: file is locked');
        }
        return fakeStats('file', 8, 12);
      }),
    };
    const scanner = new TsFileScanner(fileSystem);
    const names = [];

    for await (const file of scanner.scanFolder(root, { onFileSystemError: (error) => errors.push(error) })) {
      names.push(file.path.split(/[\\/]/).pop() ?? file.path);
    }

    expect(names).toEqual(['ok.flac']);
    expect(errors).toEqual([expect.objectContaining({ kind: 'file_stat', path: broken })]);
    expect(fileSystem.stat).toHaveBeenCalledWith(ok);
  });

  it('reports a timed-out network stat without blocking the scan', async () => {
    const root = resolve(makeTempRoot());
    const slow = join(root, 'slow.flac');
    const ok = join(root, 'ok.flac');
    const errors: ScanFileSystemError[] = [];
    const fileSystem = {
      readdir: vi.fn(async () => [fakeDirent('slow.flac', 'file'), fakeDirent('ok.flac', 'file')]),
      stat: vi.fn(async (filePath: string) => {
        if (filePath === root) {
          return fakeStats('directory');
        }
        if (filePath === slow) {
          return new Promise<Stats>(() => undefined);
        }
        return fakeStats('file', 8, 12);
      }),
    };
    const scanner = new TsFileScanner(fileSystem);
    const names = [];

    for await (const file of scanner.scanFolder(root, {
      fileSystemOperationTimeoutMs: 1,
      onFileSystemError: (error) => errors.push(error),
    })) {
      names.push(file.path.split(/[\\/]/).pop() ?? file.path);
    }

    expect(names).toEqual(['ok.flac']);
    expect(errors).toEqual([expect.objectContaining({
      kind: 'file_stat',
      path: slow,
      message: expect.stringContaining('timed out'),
    })]);
  });

  it('reuses a matching directory mtime snapshot without skipping file stat', async () => {
    const root = resolve(makeTempRoot());
    const cachedFile = join(root, 'cached.flac');
    const fileSystem = {
      readdir: vi.fn(async () => {
        throw new Error('readdir should not run for a matching snapshot');
      }),
      stat: vi.fn(async (filePath: string) => (filePath === root ? fakeStats('directory', 0, 5) : fakeStats('file', 11, 15))),
    };
    const scanner = new TsFileScanner(fileSystem);
    const files = [];

    for await (const file of scanner.scanFolder(root, {
      getDirectorySnapshot: () => ({
        path: root,
        mtimeMs: 5,
        entries: [{ name: 'cached.flac', kind: 'file' }],
      }),
    })) {
      files.push(file);
    }

    expect(fileSystem.readdir).not.toHaveBeenCalled();
    expect(fileSystem.stat).toHaveBeenCalledWith(cachedFile);
    expect(files).toEqual([{ path: cachedFile, sizeBytes: 11, mtimeMs: 15 }]);
  });
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
