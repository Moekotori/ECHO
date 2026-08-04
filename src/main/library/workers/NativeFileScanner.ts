import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { SCANNABLE_AUDIO_EXTENSION_LIST } from '../../../shared/constants/audioExtensions';
import type { NativeFileScannerDiagnostics, NativeFileScannerEnablementSource } from '../../../shared/types/library';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';
import type { ScannedFile, ScanDirectorySnapshot, ScanDirectorySnapshotEntry, ScanFileSystemError, ScanOptions } from '../libraryTypes';
import type { FileScanner } from './FileScanner';
import { lowerNativeScannerProcessPriority } from './NativeScannerProcessPriority';
import { TsFileScanner } from './TsFileScanner';

type NativeScannerMessage =
  | { type: 'ready' }
  | {
      type: 'capabilities';
      protocolVersion?: unknown;
      supportedRequests?: unknown;
      features?: unknown;
      metadataFormats?: unknown;
      metadataExtensions?: unknown;
    }
  | { type: 'started'; root?: unknown }
  | { type: 'batch'; items?: unknown }
  | { type: 'progress'; directories?: unknown; files?: unknown }
  | { type: 'error'; kind?: unknown; path?: unknown; message?: unknown }
  | { type: 'directorySnapshot'; path?: unknown; mtimeMs?: unknown; entries?: unknown }
  | { type: 'done'; files?: unknown; errors?: unknown };

type SpawnNativeScanner = (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
type NativeFileScannerEnabledProvider = () => boolean;

const nativeScannerExecutableName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const defaultNativeBatchSize = 256;
const stderrTailLimit = 4096;
const nativeFileScannerRuntimeStats = {
  totalScans: 0,
  nativeScanOk: 0,
  fallbackToTs: 0,
  tsOnlyScans: 0,
  lastFallbackReason: null as string | null,
};
const defaultNativeScannerCapabilities = {
  protocolVersion: 1,
  supportedRequests: ['scan', 'metadata'],
  features: ['batching', 'progress', 'directorySnapshots', 'persistentMetadata'],
};
let lastNativeScannerCapabilities = defaultNativeScannerCapabilities;

const getNativeFileScannerEnablement = (
  readSettingEnabled: NativeFileScannerEnabledProvider = () => false,
): { enabled: boolean; source: NativeFileScannerEnablementSource } => {
  if (process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER === '1') {
    return { enabled: false, source: 'env-disable' };
  }
  if (process.env.ECHO_NATIVE_FILE_SCANNER === '1') {
    return { enabled: true, source: 'env-enable' };
  }
  if (readSettingEnabled()) {
    return { enabled: true, source: 'setting' };
  }
  return { enabled: false, source: 'default' };
};

const getProcessResourcesPath = (): string | null => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath : null;
};

export const resolveNativeFileScannerPath = (): string | null => {
  const explicit = process.env.ECHO_NATIVE_SCANNER_PATH?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const resourcesPath = getProcessResourcesPath();
  const candidates = [
    resourcesPath ? join(resourcesPath, nativeScannerExecutableName) : null,
    resolve(process.cwd(), 'electron-app', 'build', nativeScannerExecutableName),
  ].filter((candidate): candidate is string => typeof candidate === 'string');

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

export const getNativeFileScannerDiagnostics = (
  readSettingEnabled: NativeFileScannerEnabledProvider = () => false,
): NativeFileScannerDiagnostics => {
  const enablement = getNativeFileScannerEnablement(readSettingEnabled);
  const binaryPath = resolveNativeFileScannerPath();
  const binaryFound = binaryPath !== null && existsSync(binaryPath);

  return {
    enabled: enablement.enabled,
    enablementSource: enablement.source,
    binaryFound,
    binaryPath,
    willUseNative: enablement.enabled && binaryFound,
    protocolVersion: lastNativeScannerCapabilities.protocolVersion,
    supportedRequests: lastNativeScannerCapabilities.supportedRequests,
    workerFeatures: lastNativeScannerCapabilities.features,
    ...nativeFileScannerRuntimeStats,
  };
};

const isScannedFile = (value: unknown): value is ScannedFile => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const file = value as Partial<ScannedFile>;
  return typeof file.path === 'string' && typeof file.sizeBytes === 'number' && typeof file.mtimeMs === 'number';
};

const parseNativeScannerLine = (line: string): NativeScannerMessage | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as NativeScannerMessage;
  return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null;
};

const toStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;

const recordNativeScannerCapabilities = (message: NativeScannerMessage): void => {
  if (message.type !== 'capabilities') {
    return;
  }
  const protocolVersion = typeof message.protocolVersion === 'number' && Number.isFinite(message.protocolVersion)
    ? Math.max(1, Math.round(message.protocolVersion))
    : defaultNativeScannerCapabilities.protocolVersion;
  lastNativeScannerCapabilities = {
    protocolVersion,
    supportedRequests: toStringArray(message.supportedRequests) ?? defaultNativeScannerCapabilities.supportedRequests,
    features: toStringArray(message.features) ?? defaultNativeScannerCapabilities.features,
  };
};

const toFileSystemError = (message: NativeScannerMessage): ScanFileSystemError | null => {
  if (message.type !== 'error') {
    return null;
  }
  const kind = message.kind === 'file_stat' ? 'file_stat' : 'directory';
  if (typeof message.path !== 'string' || typeof message.message !== 'string') {
    return null;
  }
  return { kind, path: message.path, message: message.message };
};

const isSnapshotEntry = (value: unknown): value is ScanDirectorySnapshotEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<ScanDirectorySnapshotEntry>;
  return typeof entry.name === 'string' && (entry.kind === 'directory' || entry.kind === 'file');
};

export class NativeFileScanner implements FileScanner {
  constructor(
    private readonly options: {
      executablePath?: string | null;
      spawnProcess?: SpawnNativeScanner;
      logger?: (message: string) => void;
    } = {},
  ) {}

  async *scanFolder(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    const executablePath = this.options.executablePath ?? resolveNativeFileScannerPath();
    if (!executablePath) {
      throw new Error('native scanner binary not found');
    }

    const startedAtMs = performance.now();
    const batchSize = defaultNativeBatchSize;
    const child = (this.options.spawnProcess ?? spawn)(executablePath, []);
    if (options.backgroundPriority === true) {
      lowerNativeScannerProcessPriority(child, 'nativeFileScanner');
    }
    const files: ScannedFile[] = [];
    const fileSystemErrors: ScanFileSystemError[] = [];
    const directorySnapshots: ScanDirectorySnapshot[] = [];
    let stderrTail = '';
    let completed = false;
    let nativeFileCount = 0;
    let nativeDirectoryCount = 0;
    let doneFileCount: number | null = null;
    let cancelled = false;

    const abort = (): void => {
      cancelled = true;
      if (!child.killed) {
        child.kill();
      }
    };
    const isCancelled = (): boolean => options.signal?.aborted === true || options.shouldCancel?.() === true;
    options.signal?.addEventListener('abort', abort, { once: true });
    const cancelTimer = setInterval(() => {
      if (isCancelled()) {
        abort();
      }
    }, 100);
    cancelTimer.unref?.();

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-stderrTailLimit);
    });

    child.stdin.end(`${JSON.stringify({
      type: 'scan',
      root: resolve(folderPath),
      extensions: options.audioExtensions ?? SCANNABLE_AUDIO_EXTENSION_LIST,
      batchSize,
    })}\n`);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (code, signal) => {
        options.signal?.removeEventListener('abort', abort);
        resolveExit({ code, signal });
      });
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (isCancelled()) {
          abort();
          break;
        }

        const message = parseNativeScannerLine(line);
        if (!message) {
          continue;
        }

        if (message.type === 'capabilities') {
          recordNativeScannerCapabilities(message);
          continue;
        }

        if (message.type === 'progress') {
          nativeFileCount = typeof message.files === 'number' ? message.files : nativeFileCount;
          nativeDirectoryCount = typeof message.directories === 'number' ? message.directories : nativeDirectoryCount;
          options.onScannerProgress?.({
            directories: nativeDirectoryCount,
            files: nativeFileCount,
          });
          continue;
        }

        const fileSystemError = toFileSystemError(message);
        if (fileSystemError) {
          fileSystemErrors.push(fileSystemError);
          continue;
        }

        if (message.type === 'batch' && Array.isArray(message.items)) {
          for (const item of message.items) {
            if (isScannedFile(item)) {
              files.push({
                path: resolve(item.path),
                sizeBytes: item.sizeBytes,
                mtimeMs: Math.round(item.mtimeMs),
              });
            }
          }
          nativeFileCount = Math.max(nativeFileCount, files.length);
          options.onScannerProgress?.({ files: files.length });
          continue;
        }

        if (
          message.type === 'directorySnapshot' &&
          typeof message.path === 'string' &&
          typeof message.mtimeMs === 'number' &&
          Array.isArray(message.entries) &&
          message.entries.every(isSnapshotEntry)
        ) {
          directorySnapshots.push({
            path: resolve(message.path),
            mtimeMs: Math.round(message.mtimeMs),
            entries: message.entries.map((entry) => ({ name: entry.name, kind: entry.kind })),
          });
          continue;
        }

        if (message.type === 'done') {
          completed = true;
          doneFileCount = typeof message.files === 'number' ? message.files : null;
          options.onScannerProgress?.({ files: doneFileCount ?? files.length });
        }
      }

      const exitStatus = await exitPromise;
      if (cancelled || isCancelled()) {
        throw new Error('native scanner cancelled');
      }
      if (!completed || exitStatus.code !== 0) {
        const details = [
          `exitCode=${exitStatus.code ?? 'null'}`,
          `signal=${exitStatus.signal ?? 'null'}`,
          stderrTail.trim() ? `stderrTail=${JSON.stringify(stderrTail.trim())}` : null,
        ].filter(Boolean);
        throw new Error(`native scanner exited before done; ${details.join(' ')}`);
      }
    } finally {
      clearInterval(cancelTimer);
      options.signal?.removeEventListener('abort', abort);
    }

    logLibraryScanPerf({
      phase: 'nativeFileScanner',
      durationMs: performance.now() - startedAtMs,
      fileCount: doneFileCount ?? files.length,
      batchSize,
      detail: `directories=${nativeDirectoryCount};progressFiles=${nativeFileCount}`,
    });

    for (const error of fileSystemErrors) {
      options.onFileSystemError?.(error);
    }
    for (const snapshot of directorySnapshots) {
      options.onDirectorySnapshot?.(snapshot);
    }
    for (const file of files) {
      yield file;
    }
  }
}

export class NativeThenTsFileScanner implements FileScanner {
  constructor(
    private readonly nativeScanner: FileScanner = new NativeFileScanner(),
    private readonly tsScanner: FileScanner = new TsFileScanner(),
    private readonly logger: (message: string) => void = console.warn,
    private readonly readSettingEnabled: NativeFileScannerEnabledProvider = () => false,
  ) {}

  async *scanFolder(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    const enablement = getNativeFileScannerEnablement(this.readSettingEnabled);
    if (!enablement.enabled) {
      nativeFileScannerRuntimeStats.tsOnlyScans += 1;
      logLibraryScanPerf({
        phase: 'fileScanner',
        detail: `mode=ts; native disabled; source=${enablement.source}`,
      });
      yield* this.tsScanner.scanFolder(folderPath, options);
      return;
    }

    try {
      nativeFileScannerRuntimeStats.totalScans += 1;
      logLibraryScanPerf({
        phase: 'fileScanner',
        detail: `mode=native; source=${enablement.source}`,
      });
      yield* this.nativeScanner.scanFolder(folderPath, options);
      nativeFileScannerRuntimeStats.nativeScanOk += 1;
    } catch (error) {
      if (options.signal?.aborted === true || options.shouldCancel?.() === true) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      nativeFileScannerRuntimeStats.fallbackToTs += 1;
      nativeFileScannerRuntimeStats.lastFallbackReason = message;
      this.logger(`[library-scan] Native file scanner failed; falling back to TS scanner: ${message}`);
      logLibraryScanPerf({
        phase: 'nativeFileScanner',
        detail: `fallback_to_ts: ${message}`,
      });
      yield* this.tsScanner.scanFolder(folderPath, options);
      return;
    }
  }
}
