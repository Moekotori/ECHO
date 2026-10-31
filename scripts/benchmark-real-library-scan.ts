import { appendFileSync, mkdirSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { setInterval } from 'node:timers';
import { clearInterval } from 'node:timers';
import { AlbumService } from '../src/main/library/AlbumService';
import { LibraryStore } from '../src/main/library/LibraryStore';
import { ScanJobQueue } from '../src/main/library/ScanJobQueue';
import { createDatabase } from '../src/main/database/createDatabase';
import {
  getNativeFileScannerDiagnostics,
  NativeThenTsFileScanner,
} from '../src/main/library/workers/NativeFileScanner';
import {
  getNativeMetadataReaderDiagnostics,
  NativeMetadataReaderPool,
  NativeThenTsMetadataReader,
} from '../src/main/library/workers/NativeMetadataReader';
import { TsFileScanner } from '../src/main/library/workers/TsFileScanner';
import { createWorkerBackedLibraryScanWorkers } from '../src/main/library/workers/WorkerBackedLibraryScan';
import type { LibraryFolder, LibraryScanStatus } from '../src/main/library/libraryTypes';

type ScanMode = 'normal' | 'incremental' | 'embedded-tags-all';
type ScanEngine = 'native' | 'hybrid' | 'ts';

type RoundResult = {
  mode: ScanMode;
  round: number;
  durationMs: number;
  tracksPerSecond: number;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  addedTracks: number;
  updatedTracks: number;
  removedTracks: number;
  errors: number;
  errorSamples: string[];
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  rssPeakMiB: number;
  statuses: Array<{
    status: LibraryScanStatus['status'];
    totalFiles: number;
    processedFiles: number;
    skippedFiles: number;
    addedTracks: number;
    updatedTracks: number;
    removedTracks: number;
    errorCount: number;
  }>;
};

const readRequiredArgument = (name: string): string => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`Missing required argument ${prefix}<value>`);
  }
  return resolve(value);
};

const readOptionalPathArgument = (name: string): string | null => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  return value ? resolve(value) : null;
};

const readPositiveInteger = (name: string, fallback: number): number => {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
};

const readScanEngine = (): ScanEngine => {
  const prefix = '--engine=';
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim().toLowerCase();
  if (!value || value === 'native') {
    return 'native';
  }
  if (value === 'ts') {
    return 'ts';
  }
  if (value === 'hybrid') {
    return 'hybrid';
  }
  throw new Error(`Invalid ${prefix}${value}; expected native, hybrid, or ts`);
};

const sum = (statuses: LibraryScanStatus[], field: keyof LibraryScanStatus): number =>
  statuses.reduce((total, status) => total + Number(status[field] ?? 0), 0);

const roundMillis = (value: number): number => Math.round(value * 10) / 10;

const main = async (): Promise<void> => {
  const databasePath = readRequiredArgument('database');
  const coverCacheDir = readRequiredArgument('cover-cache');
  const rounds = readPositiveInteger('rounds', 3);
  const metadataConcurrency = readPositiveInteger('metadata-concurrency', 4);
  const coverConcurrency = readPositiveInteger('cover-concurrency', 3);
  const engine = readScanEngine();
  const logPath = readOptionalPathArgument('log');

  process.env.ECHO_NATIVE_FILE_SCANNER = engine === 'ts' ? '0' : '1';
  process.env.ECHO_NATIVE_METADATA_READER = engine === 'native' ? '1' : '0';
  process.env.ECHO_SCAN_PERF_LOGS = '1';
  mkdirSync(coverCacheDir, { recursive: true });

  const perfLines: string[] = [];
  const consoleInfo = console.info.bind(console);
  const originalConsoleInfo = (...values: unknown[]): void => {
    if (logPath) {
      appendFileSync(logPath, `${values.map((value) => String(value)).join(' ')}\n`);
      return;
    }
    consoleInfo(...values);
  };
  console.info = (...values: unknown[]): void => {
    const message = values.map((value) => String(value)).join(' ');
    if (message.startsWith('[library-scan-perf]')) {
      perfLines.push(message);
      return;
    }
    originalConsoleInfo(...values);
  };

  const database = createDatabase(databasePath, { durabilityMode: 'balanced' });
  const store = new LibraryStore(database);
  const fileScanner = engine !== 'ts'
    ? new NativeThenTsFileScanner(
        undefined,
        new TsFileScanner(),
        (message) => console.warn(message),
        () => true,
      )
    : new TsFileScanner();
  const nativeMetadataReader = engine === 'native'
    ? new NativeMetadataReaderPool({
        poolSize: Math.min(6, metadataConcurrency),
        getProcessPriorityMode: () =>
          metadataConcurrency >= 10
            ? 'ultra'
            : metadataConcurrency >= 6
              ? 'performance'
              : metadataConcurrency >= 4
                ? 'balanced'
                : 'low',
      })
    : null;
  const workerBackedScanWorkers = createWorkerBackedLibraryScanWorkers({ workerCount: metadataConcurrency });
  const metadataReader = nativeMetadataReader
    ? new NativeThenTsMetadataReader(
        nativeMetadataReader,
        workerBackedScanWorkers.metadataReader,
        (message) => console.warn(message),
        () => true,
      )
    : workerBackedScanWorkers.metadataReader;
  const queue = new ScanJobQueue(
    store,
    fileScanner,
    metadataReader,
    workerBackedScanWorkers.coverExtractor,
    new AlbumService(),
    {
      coverCacheDir,
      metadataConcurrency,
      coverConcurrency,
      shouldReduceScanPressure: () => false,
      shouldDeferGroupingRefresh: () => false,
      createDatabaseScanGuard: () => null,
      createCompletedScanSnapshot: () => undefined,
      checkDatabaseHealth: () => undefined,
      searchTermsBuilder: workerBackedScanWorkers.searchTermsBuilder,
    },
  );

  const folders = store.getFolders().filter((folder) => folder.status === 'active');
  const results: RoundResult[] = [];

  const runRound = async (mode: ScanMode, round: number): Promise<void> => {
    const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
    eventLoopDelay.enable();
    let rssPeak = process.memoryUsage().rss;
    const rssSampler = setInterval(() => {
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    }, 20);
    rssSampler.unref();
    const startedAt = performance.now();
    const statuses: LibraryScanStatus[] = [];

    try {
      for (const folder of folders) {
        const created = mode === 'normal'
          ? queue.scanFolder(folder)
          : mode === 'incremental'
            ? queue.scanFolder(folder, { changesOnly: true })
            : queue.scanStoredTracks(folder, { mode: 'embedded-tags-all' });
        await queue.waitForIdle(created.id);
        statuses.push(queue.getScanStatus(created.id));
      }
    } finally {
      clearInterval(rssSampler);
      eventLoopDelay.disable();
    }

    const durationMs = performance.now() - startedAt;
    const totalFiles = sum(statuses, 'totalFiles');
    const processedFiles = sum(statuses, 'processedFiles');
    const result: RoundResult = {
      mode,
      round,
      durationMs: roundMillis(durationMs),
      tracksPerSecond: roundMillis(totalFiles / Math.max(0.001, durationMs / 1000)),
      totalFiles,
      processedFiles,
      skippedFiles: sum(statuses, 'skippedFiles'),
      addedTracks: sum(statuses, 'addedTracks'),
      updatedTracks: sum(statuses, 'updatedTracks'),
      removedTracks: sum(statuses, 'removedTracks'),
      errors: sum(statuses, 'errorCount'),
      errorSamples: statuses.flatMap((status) => status.errors).slice(0, 20),
      eventLoopP99Ms: roundMillis(eventLoopDelay.percentile(99) / 1_000_000),
      eventLoopMaxMs: roundMillis(eventLoopDelay.max / 1_000_000),
      rssPeakMiB: roundMillis(rssPeak / 1024 / 1024),
      statuses: statuses.map((status) => ({
        status: status.status,
        totalFiles: status.totalFiles,
        processedFiles: status.processedFiles,
        skippedFiles: status.skippedFiles,
        addedTracks: status.addedTracks,
        updatedTracks: status.updatedTracks,
        removedTracks: status.removedTracks,
        errorCount: status.errorCount,
      })),
    };
    results.push(result);
    originalConsoleInfo('[real-scan-benchmark] ROUND', JSON.stringify(result));
  };

  try {
    originalConsoleInfo('[real-scan-benchmark] CONFIG', JSON.stringify({
      folderCount: folders.length,
      engine,
      storedTrackCount: database.prepare('SELECT COUNT(*) AS count FROM tracks WHERE missing = 0').get(),
      rounds,
      metadataConcurrency,
      coverConcurrency,
      nativeFileScanner: getNativeFileScannerDiagnostics(() => engine !== 'ts'),
      nativeMetadataReader: getNativeMetadataReaderDiagnostics(() => engine === 'native'),
    }));

    for (const mode of ['normal', 'incremental', 'embedded-tags-all'] as const) {
      for (let round = 1; round <= rounds; round += 1) {
        await runRound(mode, round);
      }
    }

    originalConsoleInfo('[real-scan-benchmark] SUMMARY', JSON.stringify({
      results,
      nativeFileScanner: getNativeFileScannerDiagnostics(() => engine !== 'ts'),
      nativeMetadataReader: getNativeMetadataReaderDiagnostics(() => engine === 'native'),
      slowWriteBatches: perfLines.filter((line) => line.includes('phase=writing_database_batch_slow')),
      failedJobs: results.flatMap((result) => result.statuses).filter((status) => status.status !== 'completed').length,
    }));
  } finally {
    queue.dispose();
    (fileScanner as typeof fileScanner & { dispose?: () => void }).dispose?.();
    (metadataReader as typeof metadataReader & { dispose?: () => void }).dispose?.();
    workerBackedScanWorkers.close();
    database.close();
    console.info = originalConsoleInfo;
  }
};

main().catch((error) => {
  console.error('[real-scan-benchmark] FATAL', error);
  process.exitCode = 1;
});
