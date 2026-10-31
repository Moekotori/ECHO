import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface, type Interface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
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

type NativeScannerLineHandler = (line: string) => void;

type ScannerProcessContext = {
  child: ChildProcessWithoutNullStreams;
  generation: number;
  lines: Interface;
  stderrTail: string;
  closed: boolean;
  spawnedAtMs: number;
  readyAtMs: number | null;
  lineHandler: NativeScannerLineHandler | null;
  /** Wakes the active scan's line waiter when the process dies or write fails. */
  scanWake: (() => void) | null;
  onStderr: (chunk: string) => void;
  onLine: (line: string) => void;
  onError: (error: Error) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  exitError: Error | null;
};

type NativeScanTiming = {
  reusedProcess: boolean;
  spawnOrAttachMs: number;
  readyMs: number | null;
  walkMs: number | null;
  totalMs: number;
  emittedFiles: number;
  directories: number;
  /** Host-side snapshot skips (clean directories). */
  snapshotDirsSkipped?: number;
  /** Dirty subtrees scanned via full native walk. */
  dirtyNativeSubtrees?: number;
  mode?: 'full-native' | 'incremental';
};

const nativeScannerExecutableName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const defaultNativeBatchSize = 256;
const stderrTailLimit = 4096;
const defaultIdleTimeoutMs = 45_000;

const nativeFileScannerRuntimeStats = {
  totalScans: 0,
  nativeScanOk: 0,
  fallbackToTs: 0,
  tsOnlyScans: 0,
  lastFallbackReason: null as string | null,
  processStarts: 0,
  processReuses: 0,
  processRestarts: 0,
  idleShutdowns: 0,
  activeProcess: false,
  lastTiming: null as NativeScanTiming | null,
  snapshotDirsSkipped: 0,
  dirtyNativeSubtrees: 0,
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

// Keep cancellation checks live across awaits. Reading through a function
// prevents TypeScript from treating a prior `aborted === false` observation
// as immutable while an AbortSignal can change asynchronously.
const isScanCancelled = (options: ScanOptions): boolean =>
  options.signal?.aborted === true || options.shouldCancel?.() === true;

const getProcessResourcesPath = (): string | null => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath : null;
};

const resolveIdleTimeoutMs = (overrideMs?: number): number => {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs)) {
    return Math.max(0, Math.round(overrideMs));
  }
  const fromEnv = Number(process.env.ECHO_NATIVE_SCANNER_IDLE_MS ?? defaultIdleTimeoutMs);
  return Number.isFinite(fromEnv) ? Math.max(0, Math.round(fromEnv)) : defaultIdleTimeoutMs;
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

const isUsableSnapshot = (snapshot: ScanDirectorySnapshot): boolean => {
  if (!Array.isArray(snapshot.entries)) {
    return false;
  }
  return snapshot.entries.every(
    (entry) =>
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      !entry.name.includes('/') &&
      !entry.name.includes('\\') &&
      (entry.kind === 'directory' || entry.kind === 'file'),
  );
};

/**
 * Session-resident echo-native-scanner process (idle timeout, not app-lifetime).
 * Metadata keeps a separate process pool on the same binary so long walks never
 * block tag reads.
 *
 * File items stream as NDJSON batches arrive. Directory snapshots and filesystem
 * errors are published only after a successful done so failed runs do not
 * side-effect snapshot caches.
 *
 * When `getDirectorySnapshot` is provided (library rescan), uses host-side
 * incremental walk: clean dirs replay from snapshot (like TsFileScanner);
 * dirty dirs run a full native subtree scan via the session process.
 */
export class NativeFileScanner implements FileScanner {
  private context: ScannerProcessContext | null = null;
  private generation = 0;
  private scanChain: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly options: {
      executablePath?: string | null;
      spawnProcess?: SpawnNativeScanner;
      logger?: (message: string) => void;
      /** Idle process shutdown; 0 disables idle kill. Default 45s / ECHO_NATIVE_SCANNER_IDLE_MS. */
      idleTimeoutMs?: number;
    } = {},
  ) {
    this.idleTimeoutMs = resolveIdleTimeoutMs(options.idleTimeoutMs);
  }

  async *scanFolder(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    if (this.disposed) {
      throw new Error('native file scanner disposed');
    }

    const gate = this.acquireScanGate();
    await gate.waitTurn;
    this.clearIdleTimer();

    try {
      if (typeof options.getDirectorySnapshot === 'function') {
        yield* this.scanFolderIncremental(folderPath, options);
      } else {
        yield* this.scanFolderFullNativeLocked(folderPath, options);
      }
    } finally {
      gate.release();
      this.scheduleIdleShutdown();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearIdleTimer();
    if (this.context) {
      this.retireContext(this.context, new Error('native file scanner disposed'), true);
    }
  }

  suspend(): void {
    this.clearIdleTimer();
    if (this.context) {
      this.retireContext(this.context, new Error('native file scanner suspended'), true);
    }
  }

  private acquireScanGate(): { waitTurn: Promise<void>; release: () => void } {
    let release!: () => void;
    const released = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const previous = this.scanChain;
    this.scanChain = previous.then(
      () => released,
      () => released,
    );
    return {
      waitTurn: previous.then(
        () => undefined,
        () => undefined,
      ),
      release,
    };
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    if (this.disposed || this.idleTimeoutMs <= 0 || !this.context || this.context.closed) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.disposed || !this.context || this.context.closed) {
        return;
      }
      nativeFileScannerRuntimeStats.idleShutdowns += 1;
      logLibraryScanPerf({
        phase: 'nativeFileScanner',
        detail: `idle_shutdown;generation=${this.context.generation};timeoutMs=${this.idleTimeoutMs}`,
      });
      this.retireContext(this.context, new Error('native file scanner idle timeout'), true);
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private ensureProcess(backgroundPriority: boolean): ScannerProcessContext {
    if (this.context && !this.context.closed) {
      nativeFileScannerRuntimeStats.processReuses += 1;
      nativeFileScannerRuntimeStats.activeProcess = true;
      return this.context;
    }

    const executablePath = this.options.executablePath ?? resolveNativeFileScannerPath();
    if (!executablePath) {
      throw new Error('native scanner binary not found');
    }

    const spawnedAtMs = performance.now();
    const child = (this.options.spawnProcess ?? spawn)(executablePath, []);
    if (backgroundPriority) {
      lowerNativeScannerProcessPriority(child, 'nativeFileScanner');
    }

    const generation = ++this.generation;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const context = {} as ScannerProcessContext;
    context.child = child;
    context.generation = generation;
    context.lines = lines;
    context.stderrTail = '';
    context.closed = false;
    context.spawnedAtMs = spawnedAtMs;
    context.readyAtMs = null;
    context.lineHandler = null;
    context.scanWake = null;
    context.exitError = null;
    context.onStderr = (chunk: string) => {
      context.stderrTail = `${context.stderrTail}${chunk}`.slice(-stderrTailLimit);
    };
    context.onLine = (line: string) => {
      try {
        const message = parseNativeScannerLine(line);
        if (message?.type === 'capabilities') {
          recordNativeScannerCapabilities(message);
        }
        if (message?.type === 'ready' && context.readyAtMs == null) {
          context.readyAtMs = performance.now();
        }
      } catch {
        // Line parse for capabilities is best-effort; active scan handles hard failures.
      }
      context.lineHandler?.(line);
    };
    context.onError = (error: Error) => {
      context.exitError = error;
      context.scanWake?.();
      this.retireContext(context, error, false);
    };
    context.onExit = (code, signal) => {
      const detail = [
        `exitCode=${code ?? 'null'}`,
        `signal=${signal ?? 'null'}`,
        context.stderrTail.trim() ? `stderrTail=${JSON.stringify(context.stderrTail.trim())}` : null,
      ].filter(Boolean).join(' ');
      const error = new Error(`native scanner process exited; ${detail}`);
      context.exitError = error;
      context.scanWake?.();
      this.retireContext(context, error, false);
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', context.onStderr);
    lines.on('line', context.onLine);
    child.once('error', context.onError);
    child.once('exit', context.onExit);

    this.context = context;
    nativeFileScannerRuntimeStats.processStarts += 1;
    if (generation > 1) {
      nativeFileScannerRuntimeStats.processRestarts += 1;
    }
    nativeFileScannerRuntimeStats.activeProcess = true;
    logLibraryScanPerf({
      phase: 'nativeFileScanner',
      detail: `process_start;generation=${generation}`,
    });
    return context;
  }

  private retireContext(context: ScannerProcessContext, _error: Error, kill: boolean): void {
    if (context.closed) {
      return;
    }
    context.closed = true;
    context.lineHandler = null;
    context.scanWake = null;
    if (this.context === context) {
      this.context = null;
    }
    nativeFileScannerRuntimeStats.activeProcess = this.context !== null && !this.context.closed;
    context.lines.removeListener('line', context.onLine);
    context.lines.close();
    context.child.stderr.removeListener('data', context.onStderr);
    context.child.removeListener('error', context.onError);
    context.child.removeListener('exit', context.onExit);
    if (kill && !context.child.killed) {
      context.child.kill();
    }
  }

  private async *scanFolderIncremental(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    const startedAtMs = performance.now();
    const root = resolve(folderPath);
    const counters = { emittedFileCount: 0, snapshotDirsSkipped: 0, dirtyNativeSubtrees: 0 };
    yield* this.incrementalWalk(root, options, counters);

    const totalMs = performance.now() - startedAtMs;
    const timing: NativeScanTiming = {
      reusedProcess: this.context !== null && !this.context.closed,
      spawnOrAttachMs: 0,
      readyMs: null,
      walkMs: totalMs,
      totalMs,
      emittedFiles: counters.emittedFileCount,
      directories: counters.snapshotDirsSkipped + counters.dirtyNativeSubtrees,
      snapshotDirsSkipped: counters.snapshotDirsSkipped,
      dirtyNativeSubtrees: counters.dirtyNativeSubtrees,
      mode: 'incremental',
    };
    nativeFileScannerRuntimeStats.lastTiming = timing;
    logLibraryScanPerf({
      phase: 'nativeFileScanner',
      durationMs: totalMs,
      fileCount: counters.emittedFileCount,
      detail: [
        'mode=incremental',
        `snapshotSkipped=${counters.snapshotDirsSkipped}`,
        `dirtyNative=${counters.dirtyNativeSubtrees}`,
        `emitted=${counters.emittedFileCount}`,
      ].join(';'),
    });
  }

  private async *incrementalWalk(
    directoryPath: string,
    options: ScanOptions,
    counters: { emittedFileCount: number; snapshotDirsSkipped: number; dirtyNativeSubtrees: number },
  ): AsyncIterable<ScannedFile> {
    if (options.signal?.aborted === true || options.shouldCancel?.() === true) {
      return;
    }

    let directoryStat: Stats;
    try {
      directoryStat = await stat(directoryPath);
    } catch (error) {
      options.onFileSystemError?.({
        kind: 'directory',
        path: directoryPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!directoryStat.isDirectory()) {
      return;
    }

    const directoryMtimeMs = Math.round(directoryStat.mtimeMs);
    const snapshot = options.getDirectorySnapshot?.(directoryPath) ?? null;
    if (snapshot && snapshot.mtimeMs === directoryMtimeMs && isUsableSnapshot(snapshot)) {
      const replay = await this.prepareSnapshotReplay(directoryPath, snapshot, options);
      if (replay) {
        counters.snapshotDirsSkipped += 1;
        nativeFileScannerRuntimeStats.snapshotDirsSkipped += 1;
        options.onDirectorySnapshot?.({
          path: directoryPath,
          mtimeMs: directoryMtimeMs,
          entries: replay.entries,
        });
        for (const file of replay.files) {
          if (isScanCancelled(options)) {
            return;
          }
          counters.emittedFileCount += 1;
          options.onScannerProgress?.({ files: counters.emittedFileCount });
          yield file;
        }
        for (const childDirectory of replay.directories) {
          if (isScanCancelled(options)) {
            return;
          }
          yield* this.incrementalWalk(childDirectory, options, counters);
        }
        return;
      }
    }

    counters.dirtyNativeSubtrees += 1;
    nativeFileScannerRuntimeStats.dirtyNativeSubtrees += 1;
    for await (const file of this.scanFolderFullNativeLocked(directoryPath, {
      ...options,
      // Nested full scans must not re-enter incremental.
      getDirectorySnapshot: undefined,
      onScannerProgress: undefined,
    })) {
      counters.emittedFileCount += 1;
      options.onScannerProgress?.({ files: counters.emittedFileCount });
      yield file;
    }
  }

  private async prepareSnapshotReplay(
    directoryPath: string,
    snapshot: ScanDirectorySnapshot,
    options: ScanOptions,
  ): Promise<{ files: ScannedFile[]; directories: string[]; entries: ScanDirectorySnapshotEntry[] } | null> {
    const files: ScannedFile[] = [];
    const directories: string[] = [];
    const entries: ScanDirectorySnapshotEntry[] = [];

    for (const entry of snapshot.entries) {
      if (options.signal?.aborted === true || options.shouldCancel?.() === true) {
        return null;
      }
      const entryPath = join(directoryPath, entry.name);
      if (entry.kind === 'directory') {
        directories.push(entryPath);
        entries.push({ name: entry.name, kind: 'directory' });
        continue;
      }
      let entryStat: Stats;
      try {
        entryStat = await stat(entryPath);
      } catch {
        return null;
      }
      if (!entryStat.isFile()) {
        return null;
      }
      const sizeBytes = entryStat.size;
      const mtimeMs = Math.round(entryStat.mtimeMs);
      files.push({
        path: resolve(entryPath),
        sizeBytes,
        mtimeMs,
      });
      entries.push({ name: entry.name, kind: 'file', sizeBytes, mtimeMs });
    }

    return { files, directories, entries };
  }

  private async *scanFolderFullNativeLocked(folderPath: string, options: ScanOptions = {}): AsyncIterable<ScannedFile> {
    const startedAtMs = performance.now();
    const batchSize = defaultNativeBatchSize;
    const processWasWarm = this.context !== null && !this.context.closed;
    const context = this.ensureProcess(options.backgroundPriority === true);
    const attachMs = performance.now() - startedAtMs;

    const fileSystemErrors: ScanFileSystemError[] = [];
    const directorySnapshots: ScanDirectorySnapshot[] = [];
    const emittedFilesForSnapshotEnrichment: ScannedFile[] = [];
    let completed = false;
    let emittedFileCount = 0;
    let nativeFileCount = 0;
    let nativeDirectoryCount = 0;
    let doneFileCount: number | null = null;
    let cancelled = false;
    let walkStartedAtMs: number | null = null;
    let walkEndedAtMs: number | null = null;
    let requestWriteError: Error | null = null;

    const abort = (): void => {
      cancelled = true;
      this.retireContext(context, new Error('native scanner cancelled'), true);
    };
    const isCancelled = (): boolean => options.signal?.aborted === true || options.shouldCancel?.() === true;
    options.signal?.addEventListener('abort', abort, { once: true });
    const cancelTimer = setInterval(() => {
      if (isCancelled()) {
        abort();
      }
    }, 100);
    cancelTimer.unref?.();

    const lineBuffer: string[] = [];
    let lineNotify: (() => void) | null = null;
    let linesClosed = false;
    const wake = (): void => {
      const notify = lineNotify;
      lineNotify = null;
      notify?.();
    };

    context.lineHandler = (line: string) => {
      lineBuffer.push(line);
      wake();
    };
    context.scanWake = () => {
      linesClosed = true;
      wake();
    };

    const waitForLine = async (): Promise<string | null> => {
      while (lineBuffer.length === 0) {
        if (cancelled || isCancelled()) {
          return null;
        }
        if (context.closed || context.exitError) {
          return null;
        }
        if (linesClosed) {
          return null;
        }
        await new Promise<void>((resolveWait) => {
          lineNotify = resolveWait;
        });
      }
      return lineBuffer.shift() ?? null;
    };

    walkStartedAtMs = performance.now();
    context.child.stdin.write(
      `${JSON.stringify({
        type: 'scan',
        root: resolve(folderPath),
        extensions: options.audioExtensions ?? SCANNABLE_AUDIO_EXTENSION_LIST,
        batchSize,
      })}\n`,
      (error) => {
        if (error) {
          requestWriteError = error instanceof Error ? error : new Error(String(error));
          linesClosed = true;
          wake();
        }
      },
    );

    try {
      while (!completed) {
        if (requestWriteError) {
          throw requestWriteError;
        }
        if (cancelled || isCancelled()) {
          throw new Error('native scanner cancelled');
        }

        // Drain any buffered protocol lines before treating process exit as failure.
        // Exit can race ahead of line delivery (stdout end + exit in one tick).
        const line = await waitForLine();
        if (line == null) {
          if (cancelled || isCancelled()) {
            throw new Error('native scanner cancelled');
          }
          if (context.exitError) {
            throw context.exitError;
          }
          throw new Error(
            `native scanner ended before done; stderrTail=${JSON.stringify(context.stderrTail.trim() || '')}`,
          );
        }

        let message: NativeScannerMessage | null = null;
        try {
          message = parseNativeScannerLine(line);
        } catch (error) {
          this.retireContext(context, error instanceof Error ? error : new Error(String(error)), true);
          throw new Error(
            `native scanner returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!message) {
          continue;
        }

        if (message.type === 'capabilities') {
          recordNativeScannerCapabilities(message);
          continue;
        }
        if (message.type === 'ready') {
          if (context.readyAtMs == null) {
            context.readyAtMs = performance.now();
          }
          continue;
        }
        if (message.type === 'started') {
          walkStartedAtMs = performance.now();
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
            if (!isScannedFile(item)) {
              continue;
            }
            emittedFileCount += 1;
            nativeFileCount = Math.max(nativeFileCount, emittedFileCount);
            options.onScannerProgress?.({ files: emittedFileCount });
            const scanned: ScannedFile = {
              path: resolve(item.path),
              sizeBytes: item.sizeBytes,
              mtimeMs: Math.round(item.mtimeMs),
            };
            emittedFilesForSnapshotEnrichment.push(scanned);
            yield scanned;
          }
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
          walkEndedAtMs = performance.now();
          doneFileCount = typeof message.files === 'number' ? message.files : null;
          options.onScannerProgress?.({ files: doneFileCount ?? emittedFileCount });
        }
      }

      if (cancelled || isCancelled()) {
        throw new Error('native scanner cancelled');
      }
      if (!completed) {
        throw new Error('native scanner exited before done');
      }
    } catch (error) {
      if (!context.closed && (cancelled || isCancelled())) {
        this.retireContext(context, error instanceof Error ? error : new Error(String(error)), true);
      } else if (!context.closed && context.exitError) {
        // already retired on exit
      } else if (!context.closed) {
        // Protocol/write failures: restart next scan on a clean process.
        this.retireContext(context, error instanceof Error ? error : new Error(String(error)), true);
      }
      throw error;
    } finally {
      context.lineHandler = null;
      context.scanWake = null;
      clearInterval(cancelTimer);
      options.signal?.removeEventListener('abort', abort);
    }

    const totalMs = performance.now() - startedAtMs;
    const readyMs =
      context.readyAtMs != null
        ? Math.max(0, context.readyAtMs - context.spawnedAtMs)
        : null;
    const walkMs =
      walkStartedAtMs != null && walkEndedAtMs != null
        ? Math.max(0, walkEndedAtMs - walkStartedAtMs)
        : null;
    const timing: NativeScanTiming = {
      reusedProcess: processWasWarm,
      spawnOrAttachMs: attachMs,
      readyMs,
      walkMs,
      totalMs,
      emittedFiles: doneFileCount ?? emittedFileCount,
      directories: nativeDirectoryCount,
      mode: 'full-native',
    };
    // Prefer outer incremental timing when nested; still record full-native for cold scans.
    if (options.getDirectorySnapshot === undefined) {
      nativeFileScannerRuntimeStats.lastTiming = timing;
    }

    logLibraryScanPerf({
      phase: 'nativeFileScanner',
      durationMs: totalMs,
      fileCount: timing.emittedFiles,
      batchSize,
      detail: [
        'mode=full-native',
        `reused=${processWasWarm ? 1 : 0}`,
        `generation=${context.generation}`,
        `attachMs=${attachMs.toFixed(1)}`,
        `readyMs=${readyMs?.toFixed(1) ?? 'n/a'}`,
        `walkMs=${walkMs?.toFixed(1) ?? 'n/a'}`,
        `directories=${nativeDirectoryCount}`,
        `progressFiles=${nativeFileCount}`,
        `emitted=${emittedFileCount}`,
      ].join(';'),
    });

    // Success-only side effects: failed runs must not publish snapshots or FS errors.
    for (const error of fileSystemErrors) {
      options.onFileSystemError?.(error);
    }
    // Enrich file entries with size/mtime and re-stat directory mtimes with Node so
    // incremental host compares use one clock and clean replay can skip per-file stat.
    const filesByDirAndName = new Map<string, ScannedFile>();
    for (const file of emittedFilesForSnapshotEnrichment) {
      const parent = resolve(dirname(file.path));
      const name = basename(file.path);
      filesByDirAndName.set(`${parent.toLocaleLowerCase()}\0${name}`, file);
    }

    for (const snapshot of directorySnapshots) {
      let mtimeMs = snapshot.mtimeMs;
      try {
        const directoryStat = await stat(snapshot.path);
        if (directoryStat.isDirectory()) {
          mtimeMs = Math.round(directoryStat.mtimeMs);
        }
      } catch {
        // Keep native mtime if the path vanished between walk and publish.
      }
      const dirKey = resolve(snapshot.path).toLocaleLowerCase();
      const entries = snapshot.entries.map((entry) => {
        if (entry.kind !== 'file') {
          return entry;
        }
        const file = filesByDirAndName.get(`${dirKey}\0${entry.name}`);
        if (!file) {
          return entry;
        }
        return {
          ...entry,
          sizeBytes: file.sizeBytes,
          mtimeMs: file.mtimeMs,
        };
      });
      options.onDirectorySnapshot?.({
        ...snapshot,
        mtimeMs,
        entries,
      });
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

    let emittedFromNative = 0;
    try {
      nativeFileScannerRuntimeStats.totalScans += 1;
      logLibraryScanPerf({
        phase: 'fileScanner',
        detail: `mode=native; source=${enablement.source}`,
      });
      for await (const file of this.nativeScanner.scanFolder(folderPath, options)) {
        emittedFromNative += 1;
        yield file;
      }
      nativeFileScannerRuntimeStats.nativeScanOk += 1;
    } catch (error) {
      if (options.signal?.aborted === true || options.shouldCancel?.() === true) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);

      // Streaming may have already delivered files. Falling back to a full TS walk
      // would duplicate paths for the consumer — only fallback when nothing was emitted.
      if (emittedFromNative > 0) {
        nativeFileScannerRuntimeStats.lastFallbackReason = `partial_native_then_fail: ${message}`;
        this.logger(
          `[library-scan] Native file scanner failed after emitting ${emittedFromNative} file(s); not falling back to TS to avoid duplicates: ${message}`,
        );
        logLibraryScanPerf({
          phase: 'nativeFileScanner',
          detail: `no_fallback_partial;emitted=${emittedFromNative};error=${message}`,
        });
        throw error;
      }

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

  dispose(): void {
    (this.nativeScanner as FileScanner & { dispose?: () => void }).dispose?.();
  }

  suspend(): void {
    (this.nativeScanner as FileScanner & { suspend?: () => void }).suspend?.();
  }
}
