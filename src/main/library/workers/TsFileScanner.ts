import type { Dirent, Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../../shared/constants/audioExtensions';
import type { ScannedFile, ScanDirectorySnapshot, ScanDirectorySnapshotEntry, ScanFileSystemError, ScanOptions } from '../libraryTypes';
import type { FileScanner } from './FileScanner';

type SnapshotReplayResult = {
  files: ScannedFile[];
  directories: string[];
};

type FileScannerFileSystem = {
  readdir: (directoryPath: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
  stat: (filePath: string) => Promise<Stats>;
};

const nodeFileSystem: FileScannerFileSystem = {
  readdir,
  stat,
};

const defaultYieldEveryEntries = 64;

export class TsFileScanner implements FileScanner {
  constructor(private readonly fileSystem: FileScannerFileSystem = nodeFileSystem) {}

  async *scanFolder(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    const extensions = new Set(options.audioExtensions?.map((extension) => extension.toLocaleLowerCase()) ?? SCANNABLE_AUDIO_EXTENSIONS);
    yield* this.walk(resolve(folderPath), extensions, options);
  }

  private async *walk(directoryPath: string, audioExtensions: Set<string>, options: ScanOptions): AsyncIterable<ScannedFile> {
    if (options.signal?.aborted) {
      return;
    }

    const directoryStat = await this.safeStat(directoryPath, 'directory', options);
    if (!directoryStat || !directoryStat.isDirectory()) {
      return;
    }

    const directoryMtimeMs = Math.round(directoryStat.mtimeMs);
    const snapshot = options.getDirectorySnapshot?.(directoryPath);
    if (snapshot && snapshot.mtimeMs === directoryMtimeMs && this.isUsableSnapshot(snapshot)) {
      const replay = await this.prepareSnapshotReplay(directoryPath, snapshot, options);
      if (options.signal?.aborted) {
        return;
      }
      if (replay) {
        for (const file of replay.files) {
          if (options.signal?.aborted) {
            return;
          }
          yield file;
        }

        for (const childDirectory of replay.directories) {
          if (options.signal?.aborted) {
            return;
          }
          yield* this.walk(childDirectory, audioExtensions, options);
        }
        return;
      }
    }

    let entries;
    try {
      entries = await this.withTimeout(
        this.fileSystem.readdir(directoryPath, { withFileTypes: true }),
        options.fileSystemOperationTimeoutMs,
        `directory read timed out after ${options.fileSystemOperationTimeoutMs}ms`,
      );
    } catch (error) {
      this.reportFileSystemError(options, {
        kind: 'directory',
        path: directoryPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const snapshotEntries = entries
      .map((entry): ScanDirectorySnapshotEntry | null => {
        if (entry.isDirectory()) {
          return { name: entry.name, kind: 'directory' };
        }
        if (entry.isFile() && audioExtensions.has(this.getExtension(entry.name))) {
          return { name: entry.name, kind: 'file' };
        }
        return null;
      })
      .filter((entry): entry is ScanDirectorySnapshotEntry => entry !== null);

    options.onDirectorySnapshot?.({
      path: directoryPath,
      mtimeMs: directoryMtimeMs,
      entries: snapshotEntries,
    });

    let scannedEntries = 0;
    for (const entry of snapshotEntries) {
      if (options.signal?.aborted) {
        return;
      }
      scannedEntries += 1;

      const entryPath = join(directoryPath, entry.name);

      if (entry.kind === 'directory') {
        yield* this.walk(entryPath, audioExtensions, options);
        continue;
      }

      const fileStat = await this.safeStat(entryPath, 'file_stat', options);
      if (!fileStat || !fileStat.isFile()) {
        continue;
      }

      yield {
        path: resolve(entryPath),
        sizeBytes: fileStat.size,
        mtimeMs: Math.round(fileStat.mtimeMs),
      };

      if (scannedEntries % (options.yieldEveryEntries ?? defaultYieldEveryEntries) === 0) {
        await yieldToMainLoop();
      }
    }
  }

  private getExtension(fileName: string): string {
    const index = fileName.lastIndexOf('.');
    return index >= 0 ? fileName.slice(index).toLocaleLowerCase() : '';
  }

  private async prepareSnapshotReplay(
    directoryPath: string,
    snapshot: ScanDirectorySnapshot,
    options: ScanOptions,
  ): Promise<SnapshotReplayResult | null> {
    const files: ScannedFile[] = [];
    const directories: string[] = [];

    for (const entry of snapshot.entries) {
      if (options.signal?.aborted) {
        return null;
      }

      const entryPath = join(directoryPath, entry.name);
      let entryStat: Stats;
      try {
        entryStat = await this.withTimeout(
          this.fileSystem.stat(entryPath),
          options.fileSystemOperationTimeoutMs,
          `file system stat timed out after ${options.fileSystemOperationTimeoutMs}ms`,
        );
      } catch {
        return null;
      }

      if (entry.kind === 'directory') {
        if (!entryStat.isDirectory()) {
          return null;
        }
        directories.push(entryPath);
        continue;
      }

      if (!entryStat.isFile()) {
        return null;
      }
      files.push({
        path: resolve(entryPath),
        sizeBytes: entryStat.size,
        mtimeMs: Math.round(entryStat.mtimeMs),
      });
    }

    return { files, directories };
  }

  private async safeStat(filePath: string, kind: ScanFileSystemError['kind'], options: ScanOptions): Promise<Stats | null> {
    try {
      return await this.withTimeout(
        this.fileSystem.stat(filePath),
        options.fileSystemOperationTimeoutMs,
        `file system stat timed out after ${options.fileSystemOperationTimeoutMs}ms`,
      );
    } catch (error) {
      this.reportFileSystemError(options, {
        kind,
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private reportFileSystemError(options: ScanOptions, error: ScanFileSystemError): void {
    options.onFileSystemError?.(error);
  }

  private isUsableSnapshot(snapshot: ScanDirectorySnapshot): boolean {
    if (!Array.isArray(snapshot.entries)) {
      return false;
    }

    return snapshot.entries.every((entry) =>
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      !entry.name.includes('/') &&
      !entry.name.includes('\\') &&
      (entry.kind === 'directory' || entry.kind === 'file'),
    );
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined, timeoutMessage: string): Promise<T> {
    if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return operation;
    }

    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
