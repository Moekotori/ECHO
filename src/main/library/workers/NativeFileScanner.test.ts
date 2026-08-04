import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScannedFile } from '../libraryTypes';
import type { FileScanner } from './FileScanner';
import { getNativeFileScannerDiagnostics, NativeFileScanner, NativeThenTsFileScanner } from './NativeFileScanner';

class StaticScanner implements FileScanner {
  calls = 0;

  constructor(private readonly files: ScannedFile[]) {}

  async *scanFolder(): AsyncIterable<ScannedFile> {
    this.calls += 1;
    yield* this.files;
  }
}

class FailingScanner implements FileScanner {
  calls = 0;

  scanFolder(): AsyncIterable<ScannedFile> {
    this.calls += 1;
    return {
      [Symbol.asyncIterator](): AsyncIterator<ScannedFile> {
        return {
          next: async () => {
            throw new Error('native crashed');
          },
        };
      },
    };
  }
}

class FakeNativeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  stdinText = '';

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string | Buffer) => {
      this.stdinText += String(chunk);
    });
  }

  kill(): boolean {
    this.killed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', null, 'SIGTERM');
    return true;
  }

  finish(code = 0): void {
    this.stdout.end();
    this.emit('exit', code, null);
  }
}

const previousNativeScannerEnv = process.env.ECHO_NATIVE_FILE_SCANNER;
const previousDisableNativeScannerEnv = process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
const previousNativeScannerPathEnv = process.env.ECHO_NATIVE_SCANNER_PATH;

const restoreEnv = (
  name: 'ECHO_NATIVE_FILE_SCANNER' | 'ECHO_DISABLE_NATIVE_FILE_SCANNER' | 'ECHO_NATIVE_SCANNER_PATH',
  value: string | undefined,
): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

describe('NativeThenTsFileScanner', () => {
  afterEach(() => {
    restoreEnv('ECHO_NATIVE_FILE_SCANNER', previousNativeScannerEnv);
    restoreEnv('ECHO_DISABLE_NATIVE_FILE_SCANNER', previousDisableNativeScannerEnv);
    restoreEnv('ECHO_NATIVE_SCANNER_PATH', previousNativeScannerPathEnv);
  });

  it('uses the TS scanner by default', async () => {
    delete process.env.ECHO_NATIVE_FILE_SCANNER;
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nativeScanner = new StaticScanner([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
    const tsScanner = new StaticScanner([{ path: 'ts.flac', sizeBytes: 2, mtimeMs: 2 }]);
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner);

    try {
      const files: ScannedFile[] = [];
      for await (const file of scanner.scanFolder('D:\\Music')) {
        files.push(file);
      }

      expect(files).toEqual([{ path: 'ts.flac', sizeBytes: 2, mtimeMs: 2 }]);
      expect(nativeScanner.calls).toBe(0);
      expect(tsScanner.calls).toBe(1);
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('phase=fileScanner'));
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('mode=ts; native disabled; source=default'));
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('uses the native scanner when the app setting enables it', async () => {
    delete process.env.ECHO_NATIVE_FILE_SCANNER;
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nativeScanner = new StaticScanner([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
    const tsScanner = new StaticScanner([{ path: 'ts.flac', sizeBytes: 2, mtimeMs: 2 }]);
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner, console.warn, () => true);

    try {
      const files: ScannedFile[] = [];
      for await (const file of scanner.scanFolder('D:\\Music')) {
        files.push(file);
      }

      expect(files).toEqual([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
      expect(nativeScanner.calls).toBe(1);
      expect(tsScanner.calls).toBe(0);
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('mode=native; source=setting'));
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('lets the disable env override the app setting', async () => {
    delete process.env.ECHO_NATIVE_FILE_SCANNER;
    process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER = '1';
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nativeScanner = new StaticScanner([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
    const tsScanner = new StaticScanner([{ path: 'ts.flac', sizeBytes: 2, mtimeMs: 2 }]);
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner, console.warn, () => true);

    try {
      const files: ScannedFile[] = [];
      for await (const file of scanner.scanFolder('D:\\Music')) {
        files.push(file);
      }

      expect(files).toEqual([{ path: 'ts.flac', sizeBytes: 2, mtimeMs: 2 }]);
      expect(nativeScanner.calls).toBe(0);
      expect(tsScanner.calls).toBe(1);
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('mode=ts; native disabled; source=env-disable'));
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('falls back to TS when the native scanner fails', async () => {
    process.env.ECHO_NATIVE_FILE_SCANNER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    const nativeScanner = new FailingScanner();
    const tsScanner = new StaticScanner([{ path: 'fallback.flac', sizeBytes: 3, mtimeMs: 4 }]);
    const logger = vi.fn();
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner, logger);

    const files: ScannedFile[] = [];
    for await (const file of scanner.scanFolder('D:\\Music')) {
      files.push(file);
    }

    expect(files).toEqual([{ path: 'fallback.flac', sizeBytes: 3, mtimeMs: 4 }]);
    expect(nativeScanner.calls).toBe(1);
    expect(tsScanner.calls).toBe(1);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('falling back to TS scanner'));
  });

  it('does not fall back to TS when the scan is cancelled', async () => {
    process.env.ECHO_NATIVE_FILE_SCANNER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    const nativeScanner = new FailingScanner();
    const tsScanner = new StaticScanner([{ path: 'fallback.flac', sizeBytes: 3, mtimeMs: 4 }]);
    const logger = vi.fn();
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner, logger);

    const files: ScannedFile[] = [];
    await expect(async () => {
      for await (const file of scanner.scanFolder('D:\\Music', { shouldCancel: () => true })) {
        files.push(file);
      }
    }).rejects.toThrow('native crashed');

    expect(files).toEqual([]);
    expect(nativeScanner.calls).toBe(1);
    expect(tsScanner.calls).toBe(0);
    expect(logger).not.toHaveBeenCalled();
  });

  it('uses the native scanner even when directory snapshot callbacks are present', async () => {
    process.env.ECHO_NATIVE_FILE_SCANNER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const nativeScanner = new StaticScanner([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
    const tsScanner = new StaticScanner([{ path: 'snapshot.flac', sizeBytes: 5, mtimeMs: 6 }]);
    const scanner = new NativeThenTsFileScanner(nativeScanner, tsScanner);

    try {
      const files: ScannedFile[] = [];
      for await (const file of scanner.scanFolder('D:\\Music', {
        getDirectorySnapshot: () => null,
        onDirectorySnapshot: () => undefined,
      })) {
        files.push(file);
      }

      expect(files).toEqual([{ path: 'native.flac', sizeBytes: 1, mtimeMs: 1 }]);
      expect(nativeScanner.calls).toBe(1);
      expect(tsScanner.calls).toBe(0);
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('phase=fileScanner'));
      expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('mode=native; source=env-enable'));
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

describe('getNativeFileScannerDiagnostics', () => {
  afterEach(() => {
    restoreEnv('ECHO_NATIVE_FILE_SCANNER', previousNativeScannerEnv);
    restoreEnv('ECHO_DISABLE_NATIVE_FILE_SCANNER', previousDisableNativeScannerEnv);
    restoreEnv('ECHO_NATIVE_SCANNER_PATH', previousNativeScannerPathEnv);
  });

  it('reports default TS mode when neither env nor setting enables native scanning', () => {
    delete process.env.ECHO_NATIVE_FILE_SCANNER;
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    delete process.env.ECHO_NATIVE_SCANNER_PATH;

    expect(getNativeFileScannerDiagnostics(() => false)).toMatchObject({
      enabled: false,
      enablementSource: 'default',
      willUseNative: false,
    });
  });

  it('reports setting enablement but marks a missing native binary as unavailable', () => {
    delete process.env.ECHO_NATIVE_FILE_SCANNER;
    delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;
    process.env.ECHO_NATIVE_SCANNER_PATH = 'Z:\\definitely-missing\\echo-native-scanner.exe';

    expect(getNativeFileScannerDiagnostics(() => true)).toMatchObject({
      enabled: true,
      enablementSource: 'setting',
      binaryFound: false,
      willUseNative: false,
    });
  });

  it('lets the disable env override both env enablement and the setting', () => {
    process.env.ECHO_NATIVE_FILE_SCANNER = '1';
    process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER = '1';

    expect(getNativeFileScannerDiagnostics(() => true)).toMatchObject({
      enabled: false,
      enablementSource: 'env-disable',
      willUseNative: false,
    });
  });
});

describe('NativeFileScanner', () => {
  it('parses native scanner NDJSON batches, progress, and directory snapshots', async () => {
    const child = new FakeNativeProcess();
    const progressUpdates: unknown[] = [];
    const snapshots: unknown[] = [];
    const scanner = new NativeFileScanner({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    queueMicrotask(() => {
      child.stdout.write(
        '{"type":"capabilities","protocolVersion":2,"supportedRequests":["scan","metadata"],"features":["batching","progress","testFeature"]}\n',
      );
      child.stdout.write('{"type":"ready"}\n');
      child.stdout.write('{"type":"started","root":"D:/Music"}\n');
      child.stdout.write('{"type":"progress","directories":2,"files":128}\n');
      child.stdout.write(
        '{"type":"directorySnapshot","path":"D:/Music","mtimeMs":10,"entries":[{"name":"album","kind":"directory"},{"name":"song.flac","kind":"file"}]}\n',
      );
      child.stdout.write(
        '{"type":"batch","items":[{"path":"D:/Music/song.flac","sizeBytes":123,"mtimeMs":456}]}\n',
      );
      child.stdout.write('{"type":"done","files":1,"errors":[]}\n');
      child.finish();
    });

    const files: ScannedFile[] = [];
    for await (const file of scanner.scanFolder('D:/Music', {
      audioExtensions: ['.flac'],
      onScannerProgress: (progress) => progressUpdates.push(progress),
      onDirectorySnapshot: (snapshot) => snapshots.push(snapshot),
    })) {
      files.push(file);
    }

    expect(JSON.parse(child.stdinText)).toMatchObject({
      type: 'scan',
      extensions: ['.flac'],
      batchSize: 256,
    });
    expect(files).toEqual([{ path: expect.stringMatching(/song\.flac$/), sizeBytes: 123, mtimeMs: 456 }]);
    expect(getNativeFileScannerDiagnostics(() => false)).toMatchObject({
      protocolVersion: 2,
      workerFeatures: ['batching', 'progress', 'testFeature'],
      supportedRequests: ['scan', 'metadata'],
    });
    expect(progressUpdates).toEqual([
      { directories: 2, files: 128 },
      { files: 1 },
      { files: 1 },
    ]);
    expect(snapshots).toEqual([
      {
        path: expect.stringMatching(/Music$/),
        mtimeMs: 10,
        entries: [
          { name: 'album', kind: 'directory' },
          { name: 'song.flac', kind: 'file' },
        ],
      },
    ]);
  });

  it('does not publish native snapshots or file-system errors when the native process fails', async () => {
    const child = new FakeNativeProcess();
    const fileSystemErrors: unknown[] = [];
    const snapshots: unknown[] = [];
    const scanner = new NativeFileScanner({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    queueMicrotask(() => {
      child.stdout.write('{"type":"ready"}\n');
      child.stdout.write('{"type":"started","root":"D:/Music"}\n');
      child.stdout.write(
        '{"type":"directorySnapshot","path":"D:/Music","mtimeMs":10,"entries":[{"name":"song.flac","kind":"file"}]}\n',
      );
      child.stdout.write('{"type":"error","kind":"directory","path":"D:/Music/locked","message":"access denied"}\n');
      child.finish(1);
    });

    const files: ScannedFile[] = [];
    await expect(async () => {
      for await (const file of scanner.scanFolder('D:/Music', {
        onFileSystemError: (error) => fileSystemErrors.push(error),
        onDirectorySnapshot: (snapshot) => snapshots.push(snapshot),
      })) {
        files.push(file);
      }
    }).rejects.toThrow('native scanner exited before done');

    expect(files).toEqual([]);
    expect(fileSystemErrors).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  it('kills the native process when the scan is cancelled', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeNativeProcess();
      const scanner = new NativeFileScanner({
        executablePath: 'echo-native-scanner.exe',
        spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
      });
      let cancelled = false;
      const collect = (async (): Promise<ScannedFile[]> => {
        const files: ScannedFile[] = [];
        for await (const file of scanner.scanFolder('D:/Music', { shouldCancel: () => cancelled })) {
          files.push(file);
        }
        return files;
      })();
      const collectExpectation = expect(collect).rejects.toThrow('native scanner cancelled');

      cancelled = true;
      await vi.advanceTimersByTimeAsync(100);

      await collectExpectation;
      expect(child.killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
