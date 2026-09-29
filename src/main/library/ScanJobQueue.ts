import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { setImmediate as yieldToMainLoop, setTimeout as delay } from 'node:timers/promises';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../shared/constants/audioExtensions';
import type { AlbumMergeStrategy, AlbumService } from './AlbumService';
import { sanitizeTrackWriteForStorage, type LibraryStore } from './LibraryStore';
import type {
  CoverResult,
  FieldSource,
  FieldSources,
  LibraryFolder,
  LibraryScanMode,
  LibraryScanOptions,
  LibraryScanStatus,
  MetadataFields,
  MetadataResult,
  ScanDirectorySnapshot,
  ScanFileSystemError,
  ScannedAudioFile,
  ScannedFile,
  ScanJobUpdate,
  StoredTrackCoverState,
} from './libraryTypes';
import { getEmbeddedCoverSourceHash, type CoverExtractor } from './workers/CoverExtractor';
import type { FileScanner } from './workers/FileScanner';
import type { MetadataReader } from './workers/MetadataReader';
import { repairMojibakeText } from './workers/TsMetadataReader';
import { getNcmConverter, isNcmFile, type NcmConverter } from './NcmConverter';
import { getKgmConverter } from './KgmConverter';
import { FileIdentityService, QUICK_HASH_VERSION, type FileIdentityObservation } from './FileIdentityService';
import { createCueTrackPath, readCueSheet, readEmbeddedCueSheet, resolveCueTrack } from '../audioLibraryPublicApi';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { preloadSearchIndexRomanizer } from './SearchIndexTokens';
import type { ScanSearchTermsBuilder } from './workers/WorkerBackedLibraryScan';
import { repairAlacTechnicalMetadataBeforeWrite } from './AlacMetadataRepair';
import {
  logLibraryScanPerf,
  setActiveLibraryScanPerfContext,
  shouldRunScanHealthCheckSynchronouslyForDiagnostics,
  type LibraryScanPerfContext,
} from '../diagnostics/LibraryScanPerfDiagnostics';

type ParsedScanItem = {
  file: ScannedAudioFile;
  metadata: MetadataResult;
  cover: CoverResult | null;
  coverUnchanged: boolean;
  existingTrackId: string | null;
  existingState: StoredTrackCoverState | null;
  identity: FileIdentityObservation | null;
};

type PreparedParsedScanItem = ParsedScanItem & {
  trackId: string;
  searchTerms: string | null;
};

type ChangedFile = {
  file: ScannedAudioFile;
  existingTrackId: string | null;
  existingState: StoredTrackCoverState | null;
};

type MetadataReadItem = ChangedFile & {
  metadata: MetadataResult;
  identity: FileIdentityObservation | null;
};

type CoverRepairItem = {
  file: ScannedAudioFile;
  state: StoredTrackCoverState;
  cover: CoverResult | null;
  identity: FileIdentityObservation | null;
};

type IdentityUpdateItem = {
  file: ScannedAudioFile;
  state: StoredTrackCoverState;
  identity: FileIdentityObservation | null;
};

type ChangedFilePipelineResult = {
  processedFiles: number;
  skippedFiles: number;
  addedTracks: number;
  updatedTracks: number;
  coverCount: number;
  addedTrackIds: string[];
  seedAlbumsDurationMs: number;
  seedAlbumsBatchCount: number;
};

export type CoverCacheCompletenessMemo = Map<string, boolean>;

const coverCacheCompletenessKey = (state: StoredTrackCoverState): string | null => {
  if (!state.coverId || !state.thumbPath || !state.albumPath || !state.largePath) {
    return null;
  }

  return `${state.thumbPath}\0${state.albumPath}\0${state.largePath}`;
};

export const hasCompleteCoverCacheForScan = (
  state: StoredTrackCoverState,
  memo: CoverCacheCompletenessMemo,
  exists: (path: string) => boolean = existsSync,
): boolean => {
  const key = coverCacheCompletenessKey(state);
  if (!key) {
    return false;
  }

  const cached = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const complete = exists(state.thumbPath!) && exists(state.albumPath!) && exists(state.largePath!);
  memo.set(key, complete);
  return complete;
};

type SidecarCueExpansion = {
  trackFiles: ScannedAudioFile[];
  audioPaths: string[];
};

type StoredTrackRescanDiscovery = {
  files: ScannedAudioFile[];
  statesByPath: Map<string, StoredTrackCoverState>;
};

type ScanJobQueueOptions = {
  coverCacheDir: string;
  metadataConcurrency?: number;
  coverConcurrency?: number;
  getAlbumMergeStrategy?: () => AlbumMergeStrategy;
  checkDatabaseHealth?: (status: LibraryScanStatus) => Promise<void> | void;
  createDatabaseScanGuard?: (status: LibraryScanStatus) => Promise<unknown | null> | unknown | null;
  createCompletedScanSnapshot?: (status: LibraryScanStatus) => Promise<void> | void;
  recoverDatabaseFromScanGuard?: (snapshot: unknown | null, status: LibraryScanStatus, error: unknown) => Promise<void> | void;
  fileIdentityService?: { observe(filePath: string): FileIdentityObservation | Promise<FileIdentityObservation> };
  shouldReduceScanPressure?: () => boolean | Promise<boolean>;
  shouldDeferGroupingRefresh?: () => boolean | Promise<boolean>;
  onScanSettled?: (status: LibraryScanStatus) => void;
  onDeferredGroupingRefresh?: () => void;
  ncmConverter?: Pick<NcmConverter, 'getAvailability' | 'convertIfNeeded'>;
  searchTermsBuilder?: ScanSearchTermsBuilder;
  getScanConcurrency?: () => { metadataConcurrency: number; coverConcurrency: number };
};

type FileIdentityObserver = NonNullable<ScanJobQueueOptions['fileIdentityService']>;

const progressFlushIntervalMs = 300;
const progressFlushFileDelta = 64;
const cacheCheckYieldFileDelta = 256;
const deferredGroupingRefreshDelayMs = 1000;
const deferredCompletedScanMaintenanceDelayMs = 1500;
const deferredCompletedScanMaintenancePlaybackDelayMs = 2000;
const largeScanFileThreshold = 2000;
const initialScanWriteBatchSize = 4;
const minScanWriteBatchSize = 1;
const maxScanWriteBatchSize = 128;
const reducedScanWriteBatchSize = 1;
const normalMainThreadSliceBudgetMs = 8;
const reducedMainThreadSliceBudgetMs = 3;
const scanWriteBatchTargetMs = 24;
const scanFileSystemOperationTimeoutMs = 10_000;
const scanDiscoveryYieldEveryEntries = 32;
const cueExpansionYieldFileDelta = 32;
const maxStoredScanErrors = 200;
const scanErrorSummaryThreshold = 20;
const maxScanErrorMessageLength = 512;
const pipelinePressurePollMs = 16;
const pipelineQueueMultiplier = 2;
const pipelineWriteCoalesceMs = 3;
const pipelineQueueClosed = Symbol('pipelineQueueClosed');
const smallScanPipelineFileThreshold = 512;

type PipelineQueueRead<T> = T | typeof pipelineQueueClosed;

export const getEffectiveScanPipelineConcurrency = (
  fileCount: number,
  configured: { metadataConcurrency: number; coverConcurrency: number },
): { metadataConcurrency: number; coverConcurrency: number } => {
  const metadataConcurrency = Math.max(1, Math.floor(configured.metadataConcurrency));
  const coverConcurrency = Math.max(1, Math.floor(configured.coverConcurrency));
  if (fileCount > smallScanPipelineFileThreshold) {
    return { metadataConcurrency, coverConcurrency };
  }
  return {
    metadataConcurrency: Math.min(metadataConcurrency, 6),
    coverConcurrency: Math.min(coverConcurrency, 4),
  };
};

class BoundedAsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly readers: Array<{
    resolve: (value: PipelineQueueRead<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly writers: Array<{
    item: T;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly bufferWaiters: Array<{
    minimumItems: number;
    resolve: () => void;
  }> = [];
  private closed = false;
  private failure: Error | null = null;

  constructor(private readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new Error(`pipeline queue capacity must be positive; got ${capacity}`);
    }
  }

  get isDrained(): boolean {
    return this.closed && this.items.length === 0;
  }

  async push(item: T): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    if (this.closed) {
      throw new Error('cannot write to a closed pipeline queue');
    }

    const reader = this.readers.shift();
    if (reader) {
      reader.resolve(item);
      return;
    }
    if (this.items.length < this.capacity) {
      this.items.push(item);
      this.notifyBufferWaiters();
      return;
    }

    await new Promise<void>((resolveWriter, rejectWriter) => {
      this.writers.push({
        item,
        resolve: resolveWriter,
        reject: rejectWriter,
      });
    });
  }

  async take(): Promise<PipelineQueueRead<T>> {
    if (this.items.length > 0) {
      const item = this.items.shift()!;
      this.releaseWaitingWriter();
      return item;
    }
    if (this.failure) {
      throw this.failure;
    }
    if (this.closed) {
      return pipelineQueueClosed;
    }

    return new Promise<PipelineQueueRead<T>>((resolveReader, rejectReader) => {
      this.readers.push({
        resolve: resolveReader,
        reject: rejectReader,
      });
    });
  }

  drainAvailable(maxItems: number): T[] {
    const drained = this.items.splice(0, Math.max(0, Math.floor(maxItems)));
    for (let index = 0; index < drained.length; index += 1) {
      this.releaseWaitingWriter();
    }
    return drained;
  }

  async waitForBufferedItems(minimumItems: number, timeoutMs: number): Promise<void> {
    const normalizedMinimum = Math.max(1, Math.floor(minimumItems));
    if (
      this.items.length >= normalizedMinimum ||
      this.closed ||
      this.failure ||
      timeoutMs <= 0
    ) {
      return;
    }

    let waiter: { minimumItems: number; resolve: () => void } | null = null;
    await Promise.race([
      new Promise<void>((resolveWaiter) => {
        waiter = {
          minimumItems: normalizedMinimum,
          resolve: resolveWaiter,
        };
        this.bufferWaiters.push(waiter);
        this.notifyBufferWaiters();
      }),
      delay(timeoutMs),
    ]);
    if (waiter) {
      const index = this.bufferWaiters.indexOf(waiter);
      if (index >= 0) {
        this.bufferWaiters.splice(index, 1);
      }
    }
  }

  close(): void {
    if (this.closed || this.failure) {
      return;
    }
    this.closed = true;
    this.notifyBufferWaiters();
    const closedError = new Error('pipeline queue closed before accepting all writes');
    for (const writer of this.writers.splice(0)) {
      writer.reject(closedError);
    }
    if (this.items.length === 0) {
      for (const reader of this.readers.splice(0)) {
        reader.resolve(pipelineQueueClosed);
      }
    }
  }

  fail(error: unknown): void {
    if (this.failure) {
      return;
    }
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.closed = true;
    this.items.length = 0;
    this.notifyBufferWaiters();
    for (const reader of this.readers.splice(0)) {
      reader.reject(this.failure);
    }
    for (const writer of this.writers.splice(0)) {
      writer.reject(this.failure);
    }
  }

  private releaseWaitingWriter(): void {
    const writer = this.writers.shift();
    if (!writer) {
      if (this.closed && this.items.length === 0) {
        for (const reader of this.readers.splice(0)) {
          reader.resolve(pipelineQueueClosed);
        }
      }
      return;
    }
    const reader = this.readers.shift();
    if (reader) {
      reader.resolve(writer.item);
    } else {
      this.items.push(writer.item);
      this.notifyBufferWaiters();
    }
    writer.resolve();
  }

  private notifyBufferWaiters(): void {
    for (let index = this.bufferWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.bufferWaiters[index]!;
      if (
        this.items.length < waiter.minimumItems &&
        !this.closed &&
        !this.failure
      ) {
        continue;
      }
      this.bufferWaiters.splice(index, 1);
      waiter.resolve();
    }
  }
}

const runMainBackgroundTask = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
  const clearBackgroundTask = beginMainBackgroundTask(name);
  try {
    return await work();
  } finally {
    clearBackgroundTask();
  }
};
const noopCheckDatabaseHealth = (): void => undefined;
const noopCreateCompletedScanSnapshot = (): void => undefined;
const maxLocalScanPathCount = 1000;
const temporaryExtensions = new Set(['.tmp', '.temp', '.part', '.crdownload', '.download', '.swp']);
const ignoredTemporaryNames = new Set(['.ds_store', 'thumbs.db']);
const cueAwareScannableAudioExtensions = [...SCANNABLE_AUDIO_EXTENSIONS, '.cue'];
const coreMetadataFieldKeys: Array<keyof MetadataFields> = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNo',
  'discNo',
  'year',
  'genre',
  'duration',
  'codec',
  'mqa',
  'sampleRate',
  'bitDepth',
  'bitrate',
];
const optionalTagMetadataFieldKeys: Array<keyof MetadataFields> = [
  'bpm',
  'replayGainTrackGainDb',
  'replayGainAlbumGainDb',
  'replayGainTrackPeak',
  'replayGainAlbumPeak',
  'replayGainIntegratedLufs',
];
const allScanMetadataFieldKeys: Array<keyof MetadataFields> = [
  ...coreMetadataFieldKeys,
  ...optionalTagMetadataFieldKeys,
];
const repairableEmbeddedTextFieldKeys = ['title', 'artist', 'album', 'albumArtist', 'genre'] as const;
const repairableEmbeddedTextSources = new Set<FieldSource>(['embedded', 'sidecar']);
const metadataSourcePriority: Record<FieldSource, number> = {
  unknown: 0,
  artist_fallback: 1,
  filename_fallback: 1,
  folder_structure: 1,
  technical: 2,
  network: 3,
  embedded: 4,
  sidecar: 5,
  osu: 5,
  manual: 6,
};

const classifyScanError = (message: string): string => {
  if (message.includes(': metadata')) {
    return 'metadata';
  }
  if (message.includes(': cover')) {
    return 'cover';
  }
  if (message.includes(': scanner')) {
    return 'scanner';
  }
  if (message.includes(': ncm')) {
    return 'ncm';
  }
  if (message.includes(' warning:')) {
    return 'warning';
  }
  return 'other';
};

const replaceControlCharacters = (value: string): string => {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += (codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  }
  return sanitized;
};

const compactScanMessage = (message: unknown): string => {
  const normalized = replaceControlCharacters(String(message ?? '')).replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxScanErrorMessageLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxScanErrorMessageLength)}... [truncated]`;
};

const summarizeScanErrors = (errors: string[]): { errors: string[]; errorCount: number } => {
  const errorCount = errors.length;
  if (errorCount <= maxStoredScanErrors && errorCount < scanErrorSummaryThreshold) {
    return { errors, errorCount };
  }

  const counts = new Map<string, number>();
  for (const error of errors) {
    const key = classifyScanError(error);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const summaries = Array.from(counts.entries())
    .filter(([, count]) => count >= scanErrorSummaryThreshold)
    .sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => `[summary] ${kind}: ${count} issue(s)`);

  if (summaries.length === 0) {
    return {
      errors: errors.slice(0, maxStoredScanErrors),
      errorCount,
    };
  }

  return {
    errors: [...summaries, ...errors.slice(0, Math.max(0, maxStoredScanErrors - summaries.length))],
    errorCount,
  };
};

type ScanProgressReporter = {
  update: (patch: ScanJobUpdate) => LibraryScanStatus | null;
  flushNow: (patch?: ScanJobUpdate) => LibraryScanStatus;
};

type ScanDiscoveryResult = {
  files: ScannedAudioFile[];
  normalizationFailureCount: number;
  inaccessibleDirectories: string[];
  protectedPaths: string[];
  directorySnapshots: ScanDirectorySnapshot[];
};

class ScanCancelledError extends Error {
  constructor() {
    super('scan_cancelled');
  }
}

export class ScanJobQueue {
  private readonly runningJobs = new Map<string, Promise<void>>();
  private scanJobTail: Promise<void> = Promise.resolve();
  private readonly metadataConcurrency: number;
  private readonly coverConcurrency: number;
  private readonly getAlbumMergeStrategy: () => AlbumMergeStrategy;
  private readonly checkDatabaseHealth: (status: LibraryScanStatus) => void;
  private readonly createDatabaseScanGuard: (status: LibraryScanStatus) => Promise<unknown | null> | unknown | null;
  private readonly createCompletedScanSnapshot: (status: LibraryScanStatus) => Promise<void> | void;
  private readonly recoverDatabaseFromScanGuard: (snapshot: unknown | null, status: LibraryScanStatus, error: unknown) => Promise<void> | void;
  private readonly fileIdentityService: FileIdentityObserver;
  private readonly shouldReduceScanPressure: () => boolean | Promise<boolean>;
  private readonly shouldDeferGroupingRefresh: () => boolean | Promise<boolean>;
  private readonly onScanSettled: (status: LibraryScanStatus) => void;
  private readonly onDeferredGroupingRefresh: () => void;
  private readonly ncmConverter: Pick<NcmConverter, 'getAvailability' | 'convertIfNeeded'>;
  private readonly searchTermsBuilder: ScanSearchTermsBuilder | null;
  private readonly getScanConcurrency: () => { metadataConcurrency: number; coverConcurrency: number };
  private readonly reportedUnavailableNcmSignatures = new Set<string>();
  private readonly pendingDatabaseRecoveries = new Map<string, { snapshot: unknown | null; status: LibraryScanStatus; error: unknown }>();
  private coverCacheDir: string;
  private deferredGroupingRefreshTimer: NodeJS.Timeout | null = null;
  private deferredGroupingNeedsAlbumRefresh = false;
  private disposed = false;

  constructor(
    private readonly store: LibraryStore,
    private readonly fileScanner: FileScanner,
    private readonly metadataReader: MetadataReader,
    private readonly coverExtractor: CoverExtractor,
    private readonly albumService: AlbumService,
    options: ScanJobQueueOptions,
  ) {
    this.metadataConcurrency = options.metadataConcurrency ?? 2;
    this.coverConcurrency = options.coverConcurrency ?? 2;
    this.getAlbumMergeStrategy = options.getAlbumMergeStrategy ?? (() => 'standard');
    this.checkDatabaseHealth = options.checkDatabaseHealth ?? noopCheckDatabaseHealth;
    this.createDatabaseScanGuard = options.createDatabaseScanGuard ?? (() => null);
    this.createCompletedScanSnapshot = options.createCompletedScanSnapshot ?? noopCreateCompletedScanSnapshot;
    this.recoverDatabaseFromScanGuard = options.recoverDatabaseFromScanGuard ?? (() => undefined);
    this.fileIdentityService = options.fileIdentityService ?? new FileIdentityService();
    this.shouldReduceScanPressure = options.shouldReduceScanPressure ?? (() => false);
    this.shouldDeferGroupingRefresh = options.shouldDeferGroupingRefresh ?? (() => false);
    this.onScanSettled = options.onScanSettled ?? (() => undefined);
    this.onDeferredGroupingRefresh = options.onDeferredGroupingRefresh ?? (() => undefined);
    this.ncmConverter = options.ncmConverter ?? getNcmConverter();
    this.searchTermsBuilder = options.searchTermsBuilder ?? null;
    this.getScanConcurrency = options.getScanConcurrency ?? (() => ({
      metadataConcurrency: this.metadataConcurrency,
      coverConcurrency: this.coverConcurrency,
    }));
    this.coverCacheDir = options.coverCacheDir;
  }

  hasRunningJobs(): boolean {
    return this.runningJobs.size > 0;
  }

  getConfiguredConcurrency(): { metadataConcurrency: number; coverConcurrency: number } {
    const configured = this.getScanConcurrency();
    return {
      metadataConcurrency: Math.max(1, Math.floor(configured.metadataConcurrency)),
      coverConcurrency: Math.max(1, Math.floor(configured.coverConcurrency)),
    };
  }

  updateCoverCacheDir(coverCacheDir: string): void {
    this.coverCacheDir = coverCacheDir;
  }

  dispose(): void {
    this.disposed = true;
    if (this.deferredGroupingRefreshTimer) {
      clearTimeout(this.deferredGroupingRefreshTimer);
      this.deferredGroupingRefreshTimer = null;
    }
  }

  scanFolder(folder: LibraryFolder, options: LibraryScanOptions = {}): LibraryScanStatus {
    const startedAtMs = performance.now();
    const job = this.store.createScanJob(folder.id);
    this.logPerf({
      jobId: job.id,
      folderId: folder.id,
      phase: 'scanFolder_createScanJob',
      durationMs: performance.now() - startedAtMs,
    });
    this.enqueueScanJob(job.id, () =>
      this.runJob(
        job.id,
        folder,
        options.mode ?? 'normal',
        options.changesOnly === true,
        options.markMissing !== false,
        options.skipDeferredGroupingRefresh === true,
        options.reduceScanPressure === true,
        options.audioExtensions,
        options.osuImport === true,
      ),
    );

    return job;
  }

  scanPaths(folder: LibraryFolder, paths: string[], options: LibraryScanOptions = {}): LibraryScanStatus {
    if (paths.length > maxLocalScanPathCount) {
      throw new Error(`Too many local rescan paths: ${paths.length} > ${maxLocalScanPathCount}`);
    }

    const startedAtMs = performance.now();
    const job = this.store.createScanJob(folder.id);
    this.logPerf({
      jobId: job.id,
      folderId: folder.id,
      phase: 'scanPaths_createScanJob',
      durationMs: performance.now() - startedAtMs,
      fileCount: paths.length,
    });
    this.enqueueScanJob(job.id, () =>
      this.runPathsJob(
        job.id,
        folder,
        paths,
        options.mode ?? 'normal',
        options.skipDeferredGroupingRefresh === true,
        options.reduceScanPressure === true,
        options.audioExtensions,
        options.osuImport === true,
      ),
    );

    return job;
  }

  scanStoredTracks(folder: LibraryFolder, options: LibraryScanOptions = {}): LibraryScanStatus {
    const startedAtMs = performance.now();
    const job = this.store.createScanJob(folder.id);
    this.logPerf({
      jobId: job.id,
      folderId: folder.id,
      phase: 'scanStoredTracks_createScanJob',
      durationMs: performance.now() - startedAtMs,
    });
    this.enqueueScanJob(job.id, () =>
      this.runStoredTracksJob(
        job.id,
        folder,
        options.mode ?? 'normal',
        options.skipDeferredGroupingRefresh === true,
        options.reduceScanPressure === true,
        options.storedTrackPath,
        options.storedTrackRecursive !== false,
      ),
    );

    return job;
  }

  getScanStatus(jobId: string): LibraryScanStatus {
    const job = this.store.getScanJob(jobId);

    if (!job) {
      throw new Error(`Unknown scan job ${jobId}`);
    }

    return job;
  }

  cancelScan(jobId: string): LibraryScanStatus {
    const current = this.getScanStatus(jobId);

    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      return current;
    }

    return this.store.updateScanJob(jobId, {
      cancelRequested: true,
      status: current.status === 'queued' ? 'cancelled' : current.status,
      phase: current.status === 'queued' ? 'cancelled' : current.phase,
      finishedAt: current.status === 'queued' ? new Date().toISOString() : current.finishedAt,
    });
  }

  cancelScansForFolder(folderId: string): LibraryScanStatus[] {
    return this.store.getActiveScanJobsForFolder(folderId).map((job) => this.cancelScan(job.id));
  }

  async waitForIdle(jobId: string): Promise<void> {
    await this.runningJobs.get(jobId);
  }

  private enqueueScanJob(jobId: string, runJob: () => Promise<void>): void {
    const enqueuedAtMs = performance.now();
    const run = this.scanJobTail
      .catch(() => undefined)
      .then(async () => {
        const current = this.store.getScanJob(jobId);
        if (current?.status === 'cancelled') {
          return;
        }

        this.logPerf({
          jobId,
          folderId: current?.folderId,
          phase: 'enqueueScanJob_first_tick',
          durationMs: performance.now() - enqueuedAtMs,
        });
        await yieldToMainLoop();
        await runJob();
      })
      .finally(async () => {
        this.runningJobs.delete(jobId);
        this.notifyScanSettled(jobId);
        await this.recoverPendingDatabaseFailure(jobId);
        setActiveLibraryScanPerfContext(null);
      });

    this.runningJobs.set(jobId, run);
    this.scanJobTail = run.catch(() => undefined);
  }

  private async runJob(
    jobId: string,
    folder: LibraryFolder,
    mode: LibraryScanMode,
    changesOnly: boolean,
    markMissing: boolean,
    skipDeferredGroupingRefresh: boolean,
    forceReducedScanPressure: boolean,
    audioExtensions?: readonly string[],
    osuImport = false,
  ): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];
    const coverCacheCompletenessMemo: CoverCacheCompletenessMemo = new Map();

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });
      this.setPerfPhase(jobId, folder, 'discovering');
      await yieldToMainLoop();

      const discoverBackgroundPriority =
        forceReducedScanPressure ||
        changesOnly ||
        (await this.resolveBooleanOption(this.shouldReduceScanPressure));
      const discovery = await this.measureScanPhase(
        { jobId, folderId: folder.id, phase: 'discoverFiles' },
        () => this.discoverFiles(jobId, folder, errors, progress, {
          backgroundPriority: discoverBackgroundPriority,
          suppressDiscoveredTotal: changesOnly,
          audioExtensions,
        }),
      );
      const cacheStatesByPath = changesOnly
        ? await this.measureScanPhase(
            { jobId, folderId: folder.id, phase: 'getTrackCacheStatesByFolder', fileCount: discovery.files.length },
            () => this.store.getTrackCacheStatesByFolder(folder.id),
          )
        : undefined;
      const files = changesOnly && cacheStatesByPath
        ? this.filterAddedOrModifiedFiles(discovery.files, cacheStatesByPath)
        : discovery.files;
      const discoveredPathsForMissing = changesOnly ? discovery.files.map((file) => file.path) : undefined;
      await this.runFilesJob(
        jobId,
        folder,
        files,
        mode,
        progress,
        errors,
        markMissing,
        discovery.inaccessibleDirectories,
        discovery.protectedPaths,
        discovery.directorySnapshots,
        skipDeferredGroupingRefresh,
        forceReducedScanPressure,
        cacheStatesByPath,
        discoveredPathsForMissing,
        coverCacheCompletenessMemo,
        osuImport,
        discovery.normalizationFailureCount,
        files.length + discovery.normalizationFailureCount,
      );
    } catch (error) {
      this.finishFailedOrCancelledJob(jobId, progress, errors, error, {
        processedFiles: 0,
        skippedFiles: 0,
        addedTracks: 0,
        updatedTracks: 0,
        removedTracks: 0,
        coverCount: 0,
      });
    }
  }

  private async runPathsJob(
    jobId: string,
    folder: LibraryFolder,
    paths: string[],
    mode: LibraryScanMode,
    skipDeferredGroupingRefresh: boolean,
    forceReducedScanPressure: boolean,
    audioExtensions?: readonly string[],
    osuImport = false,
  ): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];
    const coverCacheCompletenessMemo: CoverCacheCompletenessMemo = new Map();

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });
      this.setPerfPhase(jobId, folder, 'discovering', paths.length);
      await yieldToMainLoop();

      const files = await this.measureScanPhase(
        { jobId, folderId: folder.id, phase: 'normalizeLocalRescanPaths', fileCount: paths.length },
        () => this.normalizeLocalRescanPaths(folder, paths, audioExtensions),
      );
      progress.flushNow({
        phase: 'discovering',
        totalFiles: files.length,
        errors,
      });
      await this.runFilesJob(
        jobId,
        folder,
        files,
        mode,
        progress,
        errors,
        false,
        [],
        [],
        [],
        skipDeferredGroupingRefresh,
        forceReducedScanPressure,
        undefined,
        undefined,
        coverCacheCompletenessMemo,
        osuImport,
      );
    } catch (error) {
      this.finishFailedOrCancelledJob(jobId, progress, errors, error, {
        processedFiles: 0,
        skippedFiles: 0,
        addedTracks: 0,
        updatedTracks: 0,
        removedTracks: 0,
        coverCount: 0,
      });
    }
  }

  private async runStoredTracksJob(
    jobId: string,
    folder: LibraryFolder,
    mode: LibraryScanMode,
    skipDeferredGroupingRefresh: boolean,
    forceReducedScanPressure: boolean,
    storedTrackPath?: string,
    storedTrackRecursive = true,
  ): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];
    const coverCacheCompletenessMemo: CoverCacheCompletenessMemo = new Map();

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });

      this.setPerfPhase(jobId, folder, 'discovering');
      await yieldToMainLoop();
      const discovery = await this.measureScanPhase(
        { jobId, folderId: folder.id, phase: 'collectStoredTrackRescanFiles' },
        () => this.collectStoredTrackRescanFiles(jobId, folder, mode, progress, errors, {
          path: storedTrackPath,
          recursive: storedTrackRecursive,
        }, coverCacheCompletenessMemo),
      );
      const files = discovery.files;
      progress.flushNow({
        phase: 'discovering',
        totalFiles: files.length,
        errors,
      });
      if (files.length === 0) {
        progress.flushNow({
          status: 'completed',
          phase: 'finished',
          totalFiles: 0,
          processedFiles: 0,
          skippedFiles: 0,
          addedTracks: 0,
          updatedTracks: 0,
          removedTracks: 0,
          coverCount: 0,
          errors,
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      await this.runFilesJob(
        jobId,
        folder,
        files,
        mode,
        progress,
        errors,
        false,
        [],
        [],
        [],
        skipDeferredGroupingRefresh,
        forceReducedScanPressure,
        discovery.statesByPath,
        undefined,
        coverCacheCompletenessMemo,
      );
    } catch (error) {
      this.finishFailedOrCancelledJob(jobId, progress, errors, error, {
        processedFiles: 0,
        skippedFiles: 0,
        addedTracks: 0,
        updatedTracks: 0,
        removedTracks: 0,
        coverCount: 0,
      });
    }
  }

  private async runFilesJob(
    jobId: string,
    folder: LibraryFolder,
    files: ScannedAudioFile[],
    mode: LibraryScanMode,
    progress: ScanProgressReporter,
    errors: string[],
    markMissing: boolean,
    inaccessibleDirectories: readonly string[] = [],
    protectedPaths: readonly string[] = [],
    directorySnapshots: readonly ScanDirectorySnapshot[] = [],
    skipDeferredGroupingRefresh = false,
    forceReducedScanPressure = false,
    cacheStatesOverride?: Map<string, StoredTrackCoverState>,
    markMissingDiscoveredPaths?: readonly string[],
    coverCacheCompletenessMemo: CoverCacheCompletenessMemo = new Map(),
    osuImport = false,
    initialProcessedFiles = 0,
    totalFileCount = files.length,
  ): Promise<void> {
    let processedFiles = initialProcessedFiles;
    let skippedFiles = 0;
    let addedTracks = 0;
    let updatedTracks = 0;
    let removedTracks = 0;
    let coverCount = 0;
    const addedTrackIds: string[] = [];
    const scanPressureReducedAtStart =
      forceReducedScanPressure || (await this.resolveBooleanOption(this.shouldReduceScanPressure));
    const scanGuard = await this.measureScanPhase(
      { jobId, folderId: folder.id, phase: 'createDatabaseScanGuard', fileCount: files.length },
      () => Promise.resolve(this.createDatabaseScanGuard(this.getScanStatus(jobId))),
    );
    const searchIndexRomanizerReady = this.searchTermsBuilder?.preload() ?? preloadSearchIndexRomanizer();

    try {
      progress.flushNow({
        phase: 'checking_cache',
        totalFiles: totalFileCount,
        processedFiles,
        errors,
      });
      this.setPerfPhase(jobId, folder, 'checking_cache', files.length);

      const changedFiles: ChangedFile[] = [];
      const coverRepairItems: CoverRepairItem[] = [];
      const identityUpdateItems: IdentityUpdateItem[] = [];
      const cacheStatesByPath = cacheStatesOverride ?? (await this.getTrackCacheStatesForFiles(jobId, folder, files));
      let checkedFiles = 0;
      const cacheYieldFileDelta = scanPressureReducedAtStart ? 64 : cacheCheckYieldFileDelta;
      const cacheSliceBudgetMs = scanPressureReducedAtStart
        ? reducedMainThreadSliceBudgetMs
        : normalMainThreadSliceBudgetMs;
      let cacheSliceStartedAtMs = performance.now();
      const yieldCacheCheckIfNeeded = async (): Promise<void> => {
        if (
          checkedFiles % cacheYieldFileDelta !== 0 &&
          performance.now() - cacheSliceStartedAtMs < cacheSliceBudgetMs
        ) {
          return;
        }
        await yieldToMainLoop();
        cacheSliceStartedAtMs = performance.now();
      };

      await this.measureScanPhase({ jobId, folderId: folder.id, phase: 'checking_cache', fileCount: files.length }, async () => {
        for (const file of files) {
          this.throwIfCancelled(jobId);
          checkedFiles += 1;

          const existing = cacheStatesByPath.get(resolve(file.path)) ?? null;

          const unchanged = existing && existing.sizeBytes === file.sizeBytes && existing.mtimeMs === file.mtimeMs;
          const forceReadEmbeddedTags =
            this.shouldForceReadEmbeddedTags(mode, existing, coverCacheCompletenessMemo) ||
            this.shouldBackfillPlaceholderMetadata(existing) ||
            this.shouldRepairStoredMojibakeMetadata(existing);

          if (unchanged && !forceReadEmbeddedTags) {
            if (
              this.hasCompleteCoverCache(existing, coverCacheCompletenessMemo) ||
              this.canReuseTerminalNoCoverState(mode, existing)
            ) {
              if (!scanPressureReducedAtStart && !this.hasIdentityObservation(existing)) {
                identityUpdateItems.push({
                  file,
                  state: existing,
                  identity: null,
                });
              }
              processedFiles += 1;
              skippedFiles += 1;
              progress.update({
                processedFiles,
                skippedFiles,
              });
              await yieldCacheCheckIfNeeded();
              continue;
            }

            if (this.canRepairCoverCache(existing)) {
              coverRepairItems.push({
                file,
                state: existing,
                cover: null,
                identity: null,
              });
              await yieldCacheCheckIfNeeded();
              continue;
            }

            changedFiles.push({
              file,
              existingTrackId: existing.id,
              existingState: existing,
            });
            await yieldCacheCheckIfNeeded();
            continue;
          }

          changedFiles.push({
            file,
            existingTrackId: existing?.id ?? null,
            existingState: existing,
          });
          await yieldCacheCheckIfNeeded();
        }
      });

      progress.flushNow({
        phase: 'reading_metadata',
        processedFiles,
        skippedFiles,
        errors,
      });

      const timestamp = new Date().toISOString();
      const coverTimestamp = timestamp;

      const largeScan = files.length >= largeScanFileThreshold;
      const skipIdentityObservation = scanPressureReducedAtStart || largeScan;
      const { metadataConcurrency, coverConcurrency } = this.getConfiguredConcurrency();
      const pipelineResult = await this.runChangedFilePipeline({
        jobId,
        folder,
        changedFiles,
        mode,
        forceReducedScanPressure,
        skipIdentityObservation,
        coverCacheCompletenessMemo,
        timestamp,
        searchIndexRomanizerReady,
        metadataConcurrency,
        coverConcurrency,
        progress,
        errors,
        osuImport,
        initialProcessedFiles: processedFiles,
        initialSkippedFiles: skippedFiles,
      });
      processedFiles += pipelineResult.processedFiles;
      skippedFiles += pipelineResult.skippedFiles;
      addedTracks += pipelineResult.addedTracks;
      updatedTracks += pipelineResult.updatedTracks;
      coverCount += pipelineResult.coverCount;
      addedTrackIds.push(...pipelineResult.addedTrackIds);

      this.throwIfCancelled(jobId);
      progress.flushNow({
        phase: 'extracting_covers',
        processedFiles,
        skippedFiles,
        coverCount,
        errors,
      });

      await this.measureScanPhase(
        { jobId, folderId: folder.id, phase: 'cover_repair', fileCount: coverRepairItems.length, batchSize: coverConcurrency },
        () => runMainBackgroundTask('library-scan:extracting_covers', () =>
          this.processWithAdaptiveConcurrency(coverRepairItems, coverConcurrency, forceReducedScanPressure, async (item) => {
          this.throwIfCancelled(jobId);

          try {
            if (!this.coverExtractor.repairCachedCover) {
              throw new Error('cover extractor does not support cached cover repair');
            }

            const cover = await this.coverExtractor.repairCachedCover({
              cacheRoot: this.coverCacheDir,
              source: item.state.coverSource!,
              sourceHash: item.state.sourceHash!,
              mimeType: item.state.mimeType,
              originalRef: item.state.originalRef!,
              thumbPath: item.state.thumbPath,
              albumPath: item.state.albumPath,
              largePath: item.state.largePath,
              now: coverTimestamp,
            });
            this.collectWorkerMessages(errors, item.file.path, 'cover', cover.warnings, cover.errors);
            item.cover = cover;
            coverCount += 1;
          } catch (error) {
            errors.push(`${item.file.path}: cover: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
          }

          if (!skipIdentityObservation && !this.hasIdentityObservation(item.state)) {
            item.identity = await this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
          }

          processedFiles += 1;
          progress.update({
            phase: 'extracting_covers',
            processedFiles,
            skippedFiles,
            coverCount,
            errors,
          });
          }),
        ),
      );

      await this.measureScanPhase(
        { jobId, folderId: folder.id, phase: 'identity_update', fileCount: identityUpdateItems.length, batchSize: metadataConcurrency },
        () => this.processWithAdaptiveConcurrency(identityUpdateItems, metadataConcurrency, forceReducedScanPressure, async (item) => {
          this.throwIfCancelled(jobId);
          item.identity = await this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
        }),
      );

      this.throwIfCancelled(jobId);
      await yieldToMainLoop();

      progress.flushNow({
        phase: 'writing_database',
        processedFiles,
        skippedFiles,
        addedTracks,
        updatedTracks,
        removedTracks,
        coverCount,
        errors,
      });

      const initialWriteBatchSize = scanPressureReducedAtStart
        ? reducedScanWriteBatchSize
        : initialScanWriteBatchSize;
      let seedAlbumsDurationMs = pipelineResult.seedAlbumsDurationMs;
      let seedAlbumsBatchCount = pipelineResult.seedAlbumsBatchCount;
      await this.measureScanPhase(
        {
          jobId,
          folderId: folder.id,
          phase: 'writing_database_transaction',
          fileCount: coverRepairItems.length + identityUpdateItems.length,
          batchSize: initialWriteBatchSize,
        },
        () => runMainBackgroundTask('library-scan:writing_database', async () => {
        let adaptiveWriteBatchSize = initialScanWriteBatchSize;
        const nextWriteBatchPlan = async (): Promise<{ batchSize: number; reduced: boolean }> => {
          const reduced =
            forceReducedScanPressure || (await this.resolveBooleanOption(this.shouldReduceScanPressure));
          return {
            batchSize: reduced ? reducedScanWriteBatchSize : adaptiveWriteBatchSize,
            reduced,
          };
        };
        const finishWriteBatch = async (
          startedAtMs: number,
          reduced: boolean,
          batchSize: number,
        ): Promise<void> => {
          const durationMs = performance.now() - startedAtMs;
          if (!reduced) {
            adaptiveWriteBatchSize = this.adjustScanWriteBatchSize(
              adaptiveWriteBatchSize,
              durationMs,
            );
          }
          if (durationMs > scanWriteBatchTargetMs * 1.5) {
            this.logPerf({
              jobId,
              folderId: folder.id,
              phase: 'writing_database_batch_slow',
              durationMs,
              fileCount: batchSize,
              batchSize,
              detail: `nextBatchSize=${reduced ? reducedScanWriteBatchSize : adaptiveWriteBatchSize};reduced=${reduced}`,
            });
          }
          await yieldToMainLoop();
        };

        this.store.transaction(() => {
          this.store.upsertScanDirectorySnapshots(folder.id, directorySnapshots, timestamp);

          if (markMissing) {
            removedTracks = this.store.markTracksMissingFromFolder(
              folder.id,
              [...(markMissingDiscoveredPaths ?? files.map((file) => file.path)), ...protectedPaths],
              timestamp,
              { excludeDirectories: inaccessibleDirectories },
            );
          }
        });
        await yieldToMainLoop();

        for (let index = 0; index < coverRepairItems.length;) {
          const plan = await nextWriteBatchPlan();
          const batch = coverRepairItems.slice(index, index + plan.batchSize);
          const coverChangedTrackIds: string[] = [];
          const batchStartedAtMs = performance.now();
          this.store.transaction(() => {
            for (const item of batch) {
              if (item.cover) {
                const repairedCoverId = this.store.upsertCover(item.cover, timestamp);

                if (repairedCoverId && repairedCoverId !== item.state.coverId) {
                  this.store.updateTrackCover(item.state.id, repairedCoverId, timestamp);
                  coverChangedTrackIds.push(item.state.id);
                  updatedTracks += 1;
                }
              }
              if (item.identity) {
                this.store.updateTrackIdentity(item.state.id, item.identity, timestamp);
              }
            }
          });
          if (coverChangedTrackIds.length > 0) {
            const seedStartedAtMs = performance.now();
            this.store.seedAlbumsForTracks(coverChangedTrackIds, this.albumService, timestamp, { albumMergeStrategy: this.getAlbumMergeStrategy() });
            seedAlbumsDurationMs += performance.now() - seedStartedAtMs;
            seedAlbumsBatchCount += 1;
          }
          index += batch.length;
          await finishWriteBatch(batchStartedAtMs, plan.reduced, batch.length);
        }

        for (let index = 0; index < identityUpdateItems.length;) {
          const plan = await nextWriteBatchPlan();
          const batch = identityUpdateItems.slice(index, index + plan.batchSize);
          const batchStartedAtMs = performance.now();
          this.store.transaction(() => {
            for (const item of batch) {
              if (item.identity) {
                this.store.updateTrackIdentity(item.state.id, item.identity, timestamp);
              }
            }
          });
          index += batch.length;
          await finishWriteBatch(batchStartedAtMs, plan.reduced, batch.length);
        }

        progress.flushNow({
          phase: 'writing_database',
          processedFiles,
          skippedFiles,
          addedTracks,
          updatedTracks,
          removedTracks,
          coverCount,
          errors,
        });
        }),
      );
      this.logPerf({
        jobId,
        folderId: folder.id,
        phase: 'seedAlbumsForTracks',
        durationMs: seedAlbumsDurationMs,
        fileCount: changedFiles.length + coverRepairItems.length,
        batchSize: seedAlbumsBatchCount,
      });

      let shouldScheduleGroupingRefresh = false;
      await this.measureScanPhase({ jobId, folderId: folder.id, phase: 'finish_scan_transaction', fileCount: files.length }, () => {
        this.store.transaction(() => {
        progress.flushNow({
          phase: 'grouping_albums',
          processedFiles,
          skippedFiles,
          addedTracks,
          updatedTracks,
          removedTracks,
          coverCount,
          errors,
        });
        progress.flushNow({
          phase: 'writing_database',
          processedFiles,
          skippedFiles,
          addedTracks,
          updatedTracks,
          removedTracks,
          coverCount,
          errors,
        });
        if (markMissing) {
          this.store.finishFolderScan(folder.id, timestamp);
        }
        const hasGroupingChanges = addedTracks > 0 || updatedTracks > 0 || removedTracks > 0;
        shouldScheduleGroupingRefresh = hasGroupingChanges;
        if (addedTrackIds.length > 0) {
          this.store.recordLibraryInboxBatch({
            scanJobId: jobId,
            folder,
            trackIds: addedTrackIds,
            createdAt: timestamp,
            finishedAt: timestamp,
          });
        }
        progress.flushNow({
          status: 'completed',
          phase: 'finished',
          processedFiles,
          skippedFiles,
          addedTracks,
          updatedTracks,
          removedTracks,
          coverCount,
          errors,
          finishedAt: new Date().toISOString(),
        });
        });
      });
      if (!skipDeferredGroupingRefresh && shouldScheduleGroupingRefresh) {
        this.scheduleDeferredGroupingRefresh(removedTracks > 0);
      }
      try {
        const completedStatus = this.getScanStatus(jobId);
        if (!this.hasCompletedScanMaintenanceHandlers()) {
          this.logPerf({
            jobId,
            folderId: folder.id,
            phase: 'checkDatabaseHealth',
            fileCount: files.length,
            detail: 'skipped_no_maintenance_handlers',
          });
          this.logPerf({
            jobId,
            folderId: folder.id,
            phase: 'createCompletedScanSnapshot',
            fileCount: files.length,
            detail: 'skipped_no_maintenance_handlers',
          });
        } else if (!this.hasCompletedScanMaintenanceChanges(completedStatus)) {
          this.logPerf({
            jobId,
            folderId: folder.id,
            phase: 'checkDatabaseHealth',
            fileCount: files.length,
            detail: 'skipped_no_library_changes',
          });
          this.logPerf({
            jobId,
            folderId: folder.id,
            phase: 'createCompletedScanSnapshot',
            fileCount: files.length,
            detail: 'skipped_no_library_changes',
          });
        } else if (shouldRunScanHealthCheckSynchronouslyForDiagnostics()) {
          await this.runCompletedScanMaintenance(jobId, folder.id, files.length, completedStatus);
        } else {
          this.scheduleDeferredCompletedScanMaintenance(jobId, folder.id, files.length, scanGuard, completedStatus);
        }
      } catch (error) {
        const status = this.finishFailedOrCancelledJob(jobId, progress, errors, error, {
          processedFiles,
          skippedFiles,
          addedTracks,
          updatedTracks,
          removedTracks,
          coverCount,
        });
        this.queueDatabaseRecovery(jobId, scanGuard, status, error);
      }
    } catch (error) {
      const status = this.finishFailedOrCancelledJob(jobId, progress, errors, error, {
        processedFiles,
        skippedFiles,
        addedTracks,
        updatedTracks,
        removedTracks,
        coverCount,
      });
      await this.queueDatabaseRecoveryIfUnhealthy(jobId, scanGuard, status);
    }
  }

  private finishFailedOrCancelledJob(
    _jobId: string,
    progress: ScanProgressReporter,
    errors: string[],
    error: unknown,
    counts: {
      processedFiles: number;
      skippedFiles: number;
      addedTracks: number;
      updatedTracks: number;
      removedTracks: number;
      coverCount: number;
    },
  ): LibraryScanStatus {
    if (error instanceof ScanCancelledError) {
      return progress.flushNow({
        status: 'cancelled',
        phase: 'cancelled',
        ...counts,
        errors,
        finishedAt: new Date().toISOString(),
      });
    }

    errors.push(compactScanMessage(error instanceof Error ? error.message : String(error)));
    return progress.flushNow({
      status: 'failed',
      phase: 'failed',
      ...counts,
      errors,
      finishedAt: new Date().toISOString(),
    });
  }

  private queueDatabaseRecovery(
    jobId: string,
    snapshot: unknown | null,
    status: LibraryScanStatus,
    error: unknown,
  ): void {
    this.pendingDatabaseRecoveries.set(jobId, { snapshot, status, error });
  }

  private async queueDatabaseRecoveryIfUnhealthy(
    jobId: string,
    snapshot: unknown | null,
    status: LibraryScanStatus,
  ): Promise<void> {
    try {
      await this.checkDatabaseHealth(status);
    } catch (healthError) {
      this.queueDatabaseRecovery(jobId, snapshot, status, healthError);
      return;
    }

  }

  private async runCompletedScanMaintenance(
    jobId: string,
    folderId: string,
    fileCount: number,
    completedStatus: LibraryScanStatus,
    options: { deferForPlayback?: boolean } = {},
  ): Promise<void> {
    await this.runCompletedScanMaintenancePhase(
      jobId,
      folderId,
      fileCount,
      'checkDatabaseHealth',
      () => this.checkDatabaseHealth(completedStatus),
      options,
    );
    try {
      await this.runCompletedScanMaintenancePhase(
        jobId,
        folderId,
        fileCount,
        'createCompletedScanSnapshot',
        () => Promise.resolve(this.createCompletedScanSnapshot(completedStatus)),
        options,
      );
    } catch (snapshotError) {
      console.warn('[library-scan] Failed to create completed scan recovery snapshot:', snapshotError);
    }
  }

  private async runCompletedScanMaintenancePhase<T>(
    jobId: string,
    folderId: string,
    fileCount: number,
    phase: 'checkDatabaseHealth' | 'createCompletedScanSnapshot',
    work: () => Promise<T> | T,
    options: { deferForPlayback?: boolean },
  ): Promise<T> {
    if (options.deferForPlayback === true) {
      await this.waitForCompletedScanMaintenanceSlot(jobId, folderId, phase, fileCount);
    }

    return runMainBackgroundTask(`library-scan:${phase}`, () =>
      this.measureScanPhase({ jobId, folderId, phase, fileCount }, work),
    );
  }

  private async waitForCompletedScanMaintenanceSlot(
    jobId: string,
    folderId: string,
    phase: 'checkDatabaseHealth' | 'createCompletedScanSnapshot',
    fileCount: number,
  ): Promise<void> {
    let attempt = 0;
    while (!this.disposed && (await this.resolveBooleanOption(this.shouldReduceScanPressure))) {
      attempt += 1;
      this.logPerf({
        jobId,
        folderId,
        phase,
        fileCount,
        detail: `deferred_for_playback;attempt=${attempt}`,
      });
      await delay(deferredCompletedScanMaintenancePlaybackDelayMs);
    }

    await yieldToMainLoop();
  }

  private scheduleDeferredCompletedScanMaintenance(
    jobId: string,
    folderId: string,
    fileCount: number,
    scanGuard: unknown | null,
    completedStatus: LibraryScanStatus,
  ): void {
    this.logPerf({
      jobId,
      folderId,
      phase: 'checkDatabaseHealth',
      fileCount,
      detail: 'deferred_after_scan_completed',
    });
    this.logPerf({
      jobId,
      folderId,
      phase: 'createCompletedScanSnapshot',
      fileCount,
      detail: 'deferred_after_scan_completed',
    });

    void this.runDeferredCompletedScanMaintenance(jobId, folderId, fileCount, scanGuard, completedStatus);
  }

  private async runDeferredCompletedScanMaintenance(
    jobId: string,
    folderId: string,
    fileCount: number,
    scanGuard: unknown | null,
    completedStatus: LibraryScanStatus,
  ): Promise<void> {
    try {
      await delay(deferredCompletedScanMaintenanceDelayMs);
      await this.scanJobTail.catch(() => undefined);

      if (this.disposed) {
        return;
      }

      await this.runCompletedScanMaintenance(jobId, folderId, fileCount, completedStatus, { deferForPlayback: true });
    } catch (error) {
      this.queueDatabaseRecovery(jobId, scanGuard, completedStatus, error);
      await this.recoverPendingDatabaseFailure(jobId);
    }
  }

  private async discoverFiles(
    jobId: string,
    folder: LibraryFolder,
    errors: string[],
    progress: ScanProgressReporter,
    options: { backgroundPriority?: boolean; suppressDiscoveredTotal?: boolean; audioExtensions?: readonly string[] } = {},
  ): Promise<ScanDiscoveryResult> {
    const files: ScannedAudioFile[] = [];
    const inaccessibleDirectories = new Set<string>();
    const protectedPaths = new Set<string>();
    const directorySnapshots = this.store.getScanDirectorySnapshotsByFolder(folder.id);
    const updatedSnapshots: ScanDirectorySnapshot[] = [];
    let lastScannerProgressFiles = 0;
    let discoveredFileCount = 0;
    let normalizationFailureCount = 0;
    let unavailableNcmCount = 0;
    const ncmAvailability = this.ncmConverter.getAvailability();
    const nestedFolderRoots = this.getNestedConfiguredFolderRoots(folder);

    const onFileSystemError = (error: ScanFileSystemError): void => {
      errors.push(`${error.path}: scanner: ${error.kind}: ${compactScanMessage(error.message)}`);
      if (error.kind === 'directory') {
        inaccessibleDirectories.add(resolve(error.path));
      } else {
        protectedPaths.add(resolve(error.path));
      }
    };

    try {
      for await (const file of this.fileScanner.scanFolder(folder.path, {
        audioExtensions: options.audioExtensions ?? cueAwareScannableAudioExtensions,
        backgroundPriority: options.backgroundPriority === true,
        fileSystemOperationTimeoutMs: scanFileSystemOperationTimeoutMs,
        yieldEveryEntries: scanDiscoveryYieldEveryEntries,
        shouldCancel: () => this.store.isScanCancelled(jobId),
        onFileSystemError,
        onScannerProgress: (scannerProgress) => {
          if (typeof scannerProgress.files !== 'number' || scannerProgress.files < lastScannerProgressFiles + 100) {
            return;
          }
          lastScannerProgressFiles = scannerProgress.files;
          progress.update(options.suppressDiscoveredTotal === true
            ? { phase: 'discovering', errors }
            : {
                phase: 'discovering',
                totalFiles: scannerProgress.files,
                errors,
              });
        },
        getDirectorySnapshot: (directoryPath) => directorySnapshots.get(this.pathCompareValue(resolve(directoryPath))) ?? null,
        onDirectorySnapshot: (snapshot) => {
          updatedSnapshots.push(snapshot);
        },
      })) {
        this.throwIfCancelled(jobId);
        if (nestedFolderRoots.some((nestedRoot) => this.isPathInsideOrEqual(nestedRoot, file.path))) {
          continue;
        }
        discoveredFileCount += 1;
        if (isNcmFile(file.path) && !ncmAvailability.available) {
          unavailableNcmCount += 1;
          protectedPaths.add(resolve(file.path));
        } else {
          try {
            files.push(await this.normalizeScannedFile(file, folder.id));
          } catch (error) {
            normalizationFailureCount += 1;
            protectedPaths.add(resolve(file.path));
            errors.push(`${file.path}: ncm: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
          }
        }

        if (discoveredFileCount % 100 === 0) {
          progress.update(options.suppressDiscoveredTotal === true
            ? { phase: 'discovering', errors }
            : {
                phase: 'discovering',
                totalFiles: discoveredFileCount,
                errors,
              });
        }
      }
    } catch (error) {
      if (this.store.isScanCancelled(jobId)) {
        throw new ScanCancelledError();
      }
      errors.push(`${folder.path}: scanner: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
      throw error;
    }

    if (unavailableNcmCount > 0 && !ncmAvailability.available) {
      const signature = `${folder.id}\0${ncmAvailability.error}`;
      if (!this.reportedUnavailableNcmSignatures.has(signature)) {
        this.reportedUnavailableNcmSignatures.add(signature);
        errors.push(
          `${folder.path}: ncm: ${unavailableNcmCount} file(s) skipped: ${compactScanMessage(ncmAvailability.error)}`,
        );
      }
    }

    const expandedFiles = await this.measureScanPhase(
      { jobId, folderId: folder.id, phase: 'expandCueTracks', fileCount: files.length },
      () => this.expandCueTracks(files, folder, errors, jobId),
    );

    return {
      files: expandedFiles,
      normalizationFailureCount,
      inaccessibleDirectories: [...inaccessibleDirectories, ...nestedFolderRoots],
      protectedPaths: Array.from(protectedPaths),
      directorySnapshots: updatedSnapshots,
    };
  }

  private filterAddedOrModifiedFiles(
    files: ScannedAudioFile[],
    cacheStatesByPath: Map<string, StoredTrackCoverState>,
  ): ScannedAudioFile[] {
    if (cacheStatesByPath.size === 0 || files.length === 0) {
      return files;
    }

    const existingByPath = new Map<string, StoredTrackCoverState>();
    for (const [filePath, state] of cacheStatesByPath) {
      existingByPath.set(this.pathCompareValue(resolve(filePath)), state);
    }

    return files.filter((file) => {
      const existing = existingByPath.get(this.pathCompareValue(resolve(file.path)));
      return !existing || existing.sizeBytes !== file.sizeBytes || existing.mtimeMs !== file.mtimeMs;
    });
  }

  private async getTrackCacheStatesForFiles(
    jobId: string,
    folder: LibraryFolder,
    files: readonly ScannedAudioFile[],
  ): Promise<Map<string, StoredTrackCoverState>> {
    if (files.length === 0) {
      return new Map();
    }

    return this.measureScanPhase(
      { jobId, folderId: folder.id, phase: 'getTrackCacheStatesByPaths', fileCount: files.length, batchSize: 400 },
      () => this.store.getTrackCacheStatesByPaths(folder.id, files.map((file) => file.path), { batchSize: 400 }),
    );
  }

  private async normalizeLocalRescanPaths(folder: LibraryFolder, paths: string[], audioExtensions?: readonly string[]): Promise<ScannedAudioFile[]> {
    const files: ScannedAudioFile[] = [];
    const seen = new Set<string>();
    const allowedAudioExtensions = audioExtensions
      ? new Set(audioExtensions.map((extension) => extension.toLowerCase()))
      : null;
    const nestedFolderRoots = this.getNestedConfiguredFolderRoots(folder);

    for (const inputPath of paths) {
      const filePath = resolve(inputPath);
      const comparePath = this.pathCompareValue(filePath);

      if (
        seen.has(comparePath) ||
        !this.isPathInsideFolder(folder.path, filePath) ||
        nestedFolderRoots.some((nestedRoot) => this.isPathInsideOrEqual(nestedRoot, filePath)) ||
        !this.isLocalRescanCandidate(filePath, allowedAudioExtensions)
      ) {
        continue;
      }

      seen.add(comparePath);

      try {
        const fileStat = await statFile(filePath);
        if (!fileStat.isFile()) {
          continue;
        }

        files.push({
          path: filePath,
          folderId: folder.id,
          sizeBytes: fileStat.size,
          mtimeMs: Math.round(fileStat.mtimeMs),
        });
      } catch {
        continue;
      }
    }

    return this.expandCueTracks(files, folder, [], undefined);
  }

  private isLocalRescanCandidate(filePath: string, audioExtensions: ReadonlySet<string> | null = null): boolean {
    const fileName = basename(filePath).toLowerCase();
    const extension = extname(fileName);

    if (
      !fileName ||
      fileName.startsWith('.') ||
      fileName.startsWith('~') ||
      ignoredTemporaryNames.has(fileName) ||
      temporaryExtensions.has(extension)
    ) {
      return false;
    }

    if (audioExtensions) {
      return audioExtensions.has(extension);
    }

    return SCANNABLE_AUDIO_EXTENSIONS.has(extension) || extension === '.cue';
  }

  private shouldRescanStoredTrack(
    mode: LibraryScanMode,
    state: StoredTrackCoverState,
    coverCacheCompletenessMemo: CoverCacheCompletenessMemo,
  ): boolean {
    if (mode === 'normal') {
      return true;
    }

    if (mode === 'embedded-tags-all') {
      return true;
    }

    return this.needsMissingCoverOrDurationRepair(state, coverCacheCompletenessMemo);
  }

  private async collectStoredTrackRescanFiles(
    jobId: string,
    folder: LibraryFolder,
    mode: LibraryScanMode,
    progress: ScanProgressReporter,
    errors: string[],
    scope: { path?: string; recursive?: boolean } = {},
    coverCacheCompletenessMemo: CoverCacheCompletenessMemo = new Map(),
  ): Promise<StoredTrackRescanDiscovery> {
    const files: ScannedAudioFile[] = [];
    const states = scope.path
      ? this.store.getTrackCacheStatesByFolderScope(folder.id, scope.path, scope.recursive !== false)
      : this.store.getTrackCacheStatesByFolder(folder.id);
    let checkedFiles = 0;

    for (const [trackPath, state] of states) {
      this.throwIfCancelled(jobId);
      checkedFiles += 1;

      if (!this.shouldRescanStoredTrack(mode, state, coverCacheCompletenessMemo)) {
        if (checkedFiles % cacheCheckYieldFileDelta === 0) {
          await yieldToMainLoop();
        }
        continue;
      }

      const normalizedTrackPath = resolve(trackPath);
      const physicalPath = resolve(this.resolvePhysicalAudioPath(normalizedTrackPath));
      if (!this.isPathInsideFolder(folder.path, physicalPath) || !this.isLocalRescanCandidate(physicalPath)) {
        continue;
      }

      try {
        const fileStat = await statFile(physicalPath);
        if (fileStat.isFile()) {
          files.push({
            path: normalizedTrackPath,
            folderId: folder.id,
            sizeBytes: fileStat.size,
            mtimeMs: Math.round(fileStat.mtimeMs),
          });
        }
      } catch (error) {
        errors.push(`${normalizedTrackPath}: scanner: file_stat: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
      }

      if (checkedFiles % cacheCheckYieldFileDelta === 0) {
        progress.update({
          phase: 'discovering',
          totalFiles: files.length,
          errors,
        });
        await yieldToMainLoop();
      }
    }

    return { files, statesByPath: states };
  }

  private isPathInsideFolder(folderPath: string, filePath: string): boolean {
    const root = this.pathCompareValue(resolve(folderPath));
    const candidate = this.pathCompareValue(resolve(filePath));
    const relativePath = relative(root, candidate);

    return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
  }

  private isPathInsideOrEqual(rootPath: string, filePath: string): boolean {
    const root = this.pathCompareValue(resolve(rootPath));
    const candidate = this.pathCompareValue(resolve(filePath));
    const relativePath = relative(root, candidate);
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
  }

  private getNestedConfiguredFolderRoots(folder: LibraryFolder): string[] {
    const getFolders = (this.store as LibraryStore & { getFolders?: () => LibraryFolder[] }).getFolders;
    if (typeof getFolders !== 'function') {
      return [];
    }

    return getFolders.call(this.store)
      .filter((candidate) =>
        candidate.id !== folder.id &&
        candidate.status === 'active' &&
        this.isPathInsideFolder(folder.path, candidate.path),
      )
      .map((candidate) => resolve(candidate.path));
  }

  private pathCompareValue(filePath: string): string {
    return process.platform === 'win32' ? filePath.toLocaleLowerCase() : filePath;
  }

  private createProgressReporter(jobId: string): ScanProgressReporter {
    let pending: ScanJobUpdate = {};
    let lastFlushAt = 0;
    let lastProcessedFiles = 0;
    let lastCoverCount = 0;
    let lastTotalFiles = 0;

    const mergePatch = (patch?: ScanJobUpdate): void => {
      if (!patch) {
        return;
      }

      pending = {
        ...pending,
        ...patch,
        errors: patch.errors ?? pending.errors,
      };
    };

    const sanitizePatch = (patch: ScanJobUpdate): ScanJobUpdate => {
      if (!patch.errors) {
        return patch;
      }
      const summarized = summarizeScanErrors(patch.errors);

      return {
        ...patch,
        errorCount: patch.errorCount ?? summarized.errorCount,
        errors: summarized.errors,
      };
    };

    const flush = (): LibraryScanStatus => {
      const patch = sanitizePatch(pending);
      pending = {};
      const status = this.store.updateScanJob(jobId, patch);
      lastFlushAt = Date.now();
      lastProcessedFiles = status.processedFiles;
      lastCoverCount = status.coverCount ?? lastCoverCount;
      lastTotalFiles = status.totalFiles;
      return status;
    };

    return {
      update: (patch: ScanJobUpdate): LibraryScanStatus | null => {
        mergePatch(patch);

        const now = Date.now();
        const nextProcessedFiles = pending.processedFiles ?? lastProcessedFiles;
        const nextCoverCount = pending.coverCount ?? lastCoverCount;
        const nextTotalFiles = pending.totalFiles ?? lastTotalFiles;
        const shouldFlush =
          now - lastFlushAt >= progressFlushIntervalMs ||
          nextProcessedFiles - lastProcessedFiles >= progressFlushFileDelta ||
          nextCoverCount - lastCoverCount >= progressFlushFileDelta ||
          nextTotalFiles - lastTotalFiles >= progressFlushFileDelta;

        return shouldFlush ? flush() : null;
      },
      flushNow: (patch?: ScanJobUpdate): LibraryScanStatus => {
        mergePatch(patch);
        return flush();
      },
    };
  }

  private stripEmbeddedCoverData(metadata: MetadataResult): MetadataResult {
    if (!metadata.embeddedCover) {
      return metadata;
    }

    const lightweightMetadata = { ...metadata };
    delete lightweightMetadata.embeddedCover;
    return lightweightMetadata;
  }

  private withScanFieldSourceMarkers(metadata: MetadataResult, options: { osuImport: boolean }): MetadataResult {
    if (!options.osuImport) {
      return metadata;
    }

    return {
      ...metadata,
      fieldSources: {
        ...metadata.fieldSources,
        ...(typeof metadata.fields.bpm === 'number' && Number.isFinite(metadata.fields.bpm) && metadata.fields.bpm > 0
          ? { bpm: 'osu' as const }
          : {}),
        osu: 'osu',
      },
    };
  }

  private createFallbackMetadata(file: ScannedAudioFile, message: string): MetadataResult {
    const extension = extname(file.path).toLowerCase();
    const title = basename(file.path, extension).replace(/[_-]+/gu, ' ').trim() || basename(file.path) || 'Unknown Title';
    const albumFromFolder = basename(dirname(file.path)).trim();
    const fieldSources: FieldSources = {
      title: 'filename_fallback',
      artist: 'unknown',
      album: albumFromFolder ? 'folder_structure' : 'unknown',
      albumArtist: 'artist_fallback',
      trackNo: 'unknown',
      discNo: 'unknown',
      year: 'unknown',
      genre: 'unknown',
      duration: 'unknown',
      codec: extension ? 'technical' : 'unknown',
      sampleRate: 'unknown',
      bitDepth: 'unknown',
      bitrate: 'unknown',
    };

    return {
      fields: {
        title,
        artist: 'Unknown Artist',
        album: albumFromFolder || 'Unknown Album',
        albumArtist: 'Unknown Artist',
        trackNo: null,
        discNo: null,
        year: null,
        genre: null,
        duration: 0,
        codec: extension ? extension.slice(1).toUpperCase() : null,
        sampleRate: null,
        bitDepth: null,
        bitrate: null,
      },
      fieldSources,
      embeddedMetadataStatus: 'error',
      embeddedCoverStatus: 'missing',
      warnings: [],
      errors: [message],
      status: 'fallback',
    };
  }

  private withFolderId(file: ScannedFile, folderId: string): ScannedAudioFile {
    return {
      ...file,
      folderId,
    };
  }

  private async normalizeScannedFile(file: ScannedFile, folderId: string): Promise<ScannedAudioFile> {
    const afterNcm = await this.ncmConverter.convertIfNeeded(file.path);
    const decodedPath = await getKgmConverter().convertIfNeeded(afterNcm);
    if (decodedPath === file.path) {
      return this.withFolderId(file, folderId);
    }

    const fileStat = statSync(decodedPath);
    return {
      path: resolve(decodedPath),
      folderId,
      sizeBytes: fileStat.size,
      mtimeMs: Math.round(fileStat.mtimeMs),
    };
  }

  private expandEmbeddedCueTracks(file: ScannedAudioFile): ScannedAudioFile[] {
    const sheet = readEmbeddedCueSheet(file.path);
    if (!sheet || sheet.tracks.length <= 1) {
      return [file];
    }

    return sheet.tracks.map((track) => ({
      ...file,
      path: createCueTrackPath(file.path, track.trackNumber),
    }));
  }

  private async expandCueTracks(
    files: ScannedAudioFile[],
    folder: LibraryFolder,
    errors: string[],
    jobId: string | undefined,
  ): Promise<ScannedAudioFile[]> {
    const sidecarTrackFilesByCuePath = new Map<string, ScannedAudioFile[]>();
    const suppressedAudioPaths = new Set<string>();
    let checkedFiles = 0;

    for (const file of files) {
      if (jobId) {
        this.throwIfCancelled(jobId);
      }
      checkedFiles += 1;
      if (extname(file.path).toLowerCase() !== '.cue') {
        if (checkedFiles % cueExpansionYieldFileDelta === 0) {
          await yieldToMainLoop();
        }
        continue;
      }

      try {
        const expansion = this.expandSidecarCueTracks(file, folder);
        if (expansion.trackFiles.length <= 1) {
          continue;
        }

        sidecarTrackFilesByCuePath.set(resolve(file.path), expansion.trackFiles);
        for (const audioPath of expansion.audioPaths) {
          suppressedAudioPaths.add(this.pathCompareValue(resolve(audioPath)));
        }
      } catch (error) {
        errors.push(`${file.path}: cue: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
      }
      if (checkedFiles % cueExpansionYieldFileDelta === 0) {
        await yieldToMainLoop();
      }
    }

    const expanded: ScannedAudioFile[] = [];
    for (const file of files) {
      if (jobId) {
        this.throwIfCancelled(jobId);
      }
      checkedFiles += 1;
      const normalizedPath = resolve(file.path);
      const sidecarTracks = sidecarTrackFilesByCuePath.get(normalizedPath);
      if (sidecarTracks) {
        expanded.push(...sidecarTracks);
        if (checkedFiles % cueExpansionYieldFileDelta === 0) {
          await yieldToMainLoop();
        }
        continue;
      }

      if (extname(file.path).toLowerCase() === '.cue' || suppressedAudioPaths.has(this.pathCompareValue(normalizedPath))) {
        if (checkedFiles % cueExpansionYieldFileDelta === 0) {
          await yieldToMainLoop();
        }
        continue;
      }

      expanded.push(...this.expandEmbeddedCueTracks(file));
      if (checkedFiles % cueExpansionYieldFileDelta === 0) {
        await yieldToMainLoop();
      }
    }

    return expanded;
  }

  private expandSidecarCueTracks(cueFile: ScannedAudioFile, folder: LibraryFolder): SidecarCueExpansion {
    const sheet = readCueSheet(cueFile.path);
    const audioPaths = new Set<string>();
    const trackFiles = sheet.tracks.flatMap((track) => {
      const audioPath = resolve(track.audioPath);
      if (!this.isPathInsideFolder(folder.path, audioPath)) {
        return [];
      }

      try {
        const audioStat = statSync(audioPath);
        if (!audioStat.isFile()) {
          return [];
        }

        audioPaths.add(audioPath);
        return [{
          path: createCueTrackPath(cueFile.path, track.trackNumber),
          folderId: cueFile.folderId,
          sizeBytes: cueFile.sizeBytes + audioStat.size,
          mtimeMs: Math.max(cueFile.mtimeMs, Math.round(audioStat.mtimeMs)),
        }];
      } catch {
        return [];
      }
    });

    return {
      trackFiles,
      audioPaths: Array.from(audioPaths),
    };
  }

  private resolvePhysicalAudioPath(filePath: string): string {
    try {
      return resolveCueTrack(filePath)?.audioPath ?? filePath;
    } catch {
      return filePath;
    }
  }

  private throwIfCancelled(jobId: string): void {
    if (this.store.isScanCancelled(jobId)) {
      throw new ScanCancelledError();
    }
  }

  private collectWorkerMessages(
    errors: string[],
    filePath: string,
    workerName: string,
    warnings: string[],
    workerErrors: string[],
  ): void {
    for (const warning of warnings) {
      errors.push(`${filePath}: ${workerName} warning: ${compactScanMessage(warning)}`);
    }

    for (const error of workerErrors) {
      errors.push(`${filePath}: ${workerName}: ${compactScanMessage(error)}`);
    }
  }

  private hasCompleteCoverCache(state: StoredTrackCoverState, memo: CoverCacheCompletenessMemo): boolean {
    return hasCompleteCoverCacheForScan(state, memo);
  }

  private notifyScanSettled(jobId: string): void {
    try {
      const status = this.store.getScanJob(jobId);
      if (!status) {
        return;
      }

      this.onScanSettled(status);
    } catch {
      // Scan completion notifications are best-effort; the persisted status is the source of truth.
    }
  }

  private async recoverPendingDatabaseFailure(jobId: string): Promise<void> {
    const recovery = this.pendingDatabaseRecoveries.get(jobId);
    if (!recovery) {
      return;
    }

    this.pendingDatabaseRecoveries.delete(jobId);
    try {
      await this.recoverDatabaseFromScanGuard(recovery.snapshot, recovery.status, recovery.error);
    } catch {
      // The recovery layer records its own maintenance breadcrumb; scan completion must not crash the app.
    }
  }

  private async resolveBooleanOption(option: () => boolean | Promise<boolean>): Promise<boolean> {
    try {
      return (await option()) === true;
    } catch {
      return false;
    }
  }

  private adjustScanWriteBatchSize(currentBatchSize: number, durationMs: number): number {
    if (durationMs > scanWriteBatchTargetMs * 1.5) {
      return Math.max(minScanWriteBatchSize, Math.floor(currentBatchSize / 2));
    }
    if (durationMs < scanWriteBatchTargetMs * 0.5) {
      return Math.min(maxScanWriteBatchSize, currentBatchSize * 2);
    }
    return currentBatchSize;
  }

  private hasCompletedScanMaintenanceChanges(status: LibraryScanStatus): boolean {
    return (
      status.addedTracks > 0 ||
      status.updatedTracks > 0 ||
      status.removedTracks > 0 ||
      (status.coverCount ?? 0) > 0
    );
  }

  private hasCompletedScanMaintenanceHandlers(): boolean {
    return this.checkDatabaseHealth !== noopCheckDatabaseHealth || this.createCompletedScanSnapshot !== noopCreateCompletedScanSnapshot;
  }

  private setPerfPhase(
    jobId: string,
    folder: Pick<LibraryFolder, 'id'>,
    phase: string,
    fileCount?: number,
    batchSize?: number,
  ): void {
    setActiveLibraryScanPerfContext({
      jobId,
      folderId: folder.id,
      phase,
      fileCount,
      batchSize,
    });
  }

  private logPerf(payload: Parameters<typeof logLibraryScanPerf>[0]): void {
    logLibraryScanPerf(payload);
  }

  private async measureScanPhase<T>(context: LibraryScanPerfContext, work: () => Promise<T> | T): Promise<T> {
    setActiveLibraryScanPerfContext(context);
    const startedAtMs = performance.now();
    try {
      return await work();
    } finally {
      this.logPerf({
        ...context,
        durationMs: performance.now() - startedAtMs,
      });
    }
  }

  private scheduleDeferredGroupingRefresh(needsAlbumRefresh = false): void {
    this.deferredGroupingNeedsAlbumRefresh ||= needsAlbumRefresh;
    if (this.deferredGroupingRefreshTimer) {
      return;
    }

    this.deferredGroupingRefreshTimer = setTimeout(() => {
      this.deferredGroupingRefreshTimer = null;
      void this.runDeferredGroupingRefresh();
    }, deferredGroupingRefreshDelayMs);
    this.deferredGroupingRefreshTimer.unref?.();
  }

  private async runDeferredGroupingRefresh(): Promise<void> {
    if (this.hasRunningJobs() || (await this.resolveBooleanOption(this.shouldDeferGroupingRefresh))) {
      this.scheduleDeferredGroupingRefresh();
      return;
    }

    const needsAlbumRefresh = this.deferredGroupingNeedsAlbumRefresh;
    this.deferredGroupingNeedsAlbumRefresh = false;
    try {
      await this.measureScanPhase(
        { phase: 'refreshAlbums_refreshArtists' },
        () => runMainBackgroundTask('library-scan:grouping_albums', () => {
          if (needsAlbumRefresh) {
            this.store.refreshAlbums(this.albumService, undefined, { albumMergeStrategy: this.getAlbumMergeStrategy() });
          }
          return this.store.refreshArtistsCooperatively();
        }),
      );
      this.onDeferredGroupingRefresh();
    } catch (error) {
      console.warn(`Deferred library grouping refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleDeferredGroupingRefresh();
    }
  }

  private canReuseEmbeddedCover(
    mode: LibraryScanMode,
    state: StoredTrackCoverState | null,
    metadata: MetadataResult,
    memo: CoverCacheCompletenessMemo,
  ): boolean {
    if (
      mode === 'normal' ||
      !state ||
      state.coverSource !== 'embedded' ||
      !state.sourceHash ||
      !metadata.embeddedCover ||
      !this.hasCompleteCoverCache(state, memo)
    ) {
      return false;
    }

    return getEmbeddedCoverSourceHash(metadata.embeddedCover.data) === state.sourceHash;
  }

  private canReuseFingerprintMatchedEmbeddedCover(
    file: ScannedAudioFile,
    state: StoredTrackCoverState | null,
    memo: CoverCacheCompletenessMemo,
  ): boolean {
    return Boolean(
      state &&
        state.sizeBytes === file.sizeBytes &&
        state.mtimeMs === file.mtimeMs &&
        state.coverSource === 'embedded' &&
        state.sourceHash &&
        this.hasCompleteCoverCache(state, memo),
    );
  }

  private shouldSkipEmbeddedRescanWrite(
    mode: LibraryScanMode,
    item: ParsedScanItem,
    metadata: MetadataResult,
  ): boolean {
    const state = item.existingState;
    return (
      mode !== 'normal' &&
      Boolean(state?.scanMetadata) &&
      state?.sizeBytes === item.file.sizeBytes &&
      state.mtimeMs === item.file.mtimeMs &&
      item.coverUnchanged &&
      this.metadataSemanticallyMatches(state, item.file, metadata)
    );
  }

  private preserveStoredHigherQualityMetadata(
    mode: LibraryScanMode,
    item: ParsedScanItem,
    metadata: MetadataResult,
  ): MetadataResult {
    const stored = item.existingState?.scanMetadata;
    if (
      mode === 'normal' ||
      !stored ||
      item.existingState?.sizeBytes !== item.file.sizeBytes ||
      item.existingState.mtimeMs !== item.file.mtimeMs
    ) {
      return metadata;
    }

    const fields: MetadataFields = { ...metadata.fields };
    const fieldSources: FieldSources = { ...metadata.fieldSources };
    for (const key of allScanMetadataFieldKeys) {
      const storedSource = stored.fieldSources[key] ?? 'unknown';
      const incomingSource = fieldSources[key] ?? 'unknown';
      const storedValue = stored.fields[key];
      const incomingValue = fields[key];
      const storedHasValue = storedValue !== null && storedValue !== undefined && storedValue !== '';
      const storedPriority = metadataSourcePriority[storedSource];
      const incomingPriority = metadataSourcePriority[incomingSource];
      if (
        !storedHasValue ||
        (
          storedPriority <= incomingPriority &&
          !(storedPriority === incomingPriority && this.metadataValueEquals(key, storedValue, incomingValue))
        )
      ) {
        continue;
      }
      (fields as Record<keyof MetadataFields, unknown>)[key] = storedValue;
      fieldSources[key] = storedSource;
    }

    return {
      ...metadata,
      fields,
      fieldSources,
    };
  }

  private metadataSemanticallyMatches(
    state: StoredTrackCoverState,
    file: ScannedAudioFile,
    metadata: MetadataResult,
  ): boolean {
    const stored = state.scanMetadata;
    const normalized = sanitizeTrackWriteForStorage({
      ...file,
      ...metadata.fields,
      id: state.id,
      coverId: state.coverId,
      fieldSources: metadata.fieldSources,
      embeddedMetadataStatus: metadata.embeddedMetadataStatus,
      embeddedCoverStatus: metadata.embeddedCoverStatus,
      metadataStatus: metadata.status,
      warnings: metadata.warnings,
      errors: metadata.errors,
      updatedAt: '',
    });
    if (
      !stored ||
      stored.metadataStatus !== normalized.metadataStatus ||
      stored.embeddedMetadataStatus !== normalized.embeddedMetadataStatus ||
      stored.embeddedCoverStatus !== normalized.embeddedCoverStatus
    ) {
      return false;
    }

    for (const key of coreMetadataFieldKeys) {
      if (
        !this.metadataValueEquals(key, stored.fields[key], normalized[key]) ||
        stored.fieldSources[key] !== normalized.fieldSources[key]
      ) {
        return false;
      }
    }

    for (const key of optionalTagMetadataFieldKeys) {
      const storedSource = stored.fieldSources[key];
      const incomingSource = normalized.fieldSources[key];
      if (storedSource !== 'embedded' && incomingSource !== 'embedded') {
        continue;
      }
      if (
        !this.metadataValueEquals(key, stored.fields[key], normalized[key]) ||
        storedSource !== incomingSource
      ) {
        return false;
      }
    }

    return true;
  }

  private metadataValueEquals(key: keyof MetadataFields, left: unknown, right: unknown): boolean {
    if (typeof left === 'number' && typeof right === 'number') {
      return Math.abs(left - right) <= (key === 'duration' ? 0.01 : 1e-6);
    }
    if (key === 'codec' && typeof left === 'string' && typeof right === 'string') {
      const normalizeCodec = (value: string): string => {
        const compact = value.normalize('NFKC').replace(/[\s._-]+/gu, '').toUpperCase();
        return compact === 'MP3' || /^MPEG(?:1|2|25)?LAYER(?:3|III)$/u.test(compact)
          ? 'MP3'
          : compact;
      };
      return normalizeCodec(left) === normalizeCodec(right);
    }
    return left === right;
  }

  private shouldForceReadEmbeddedTags(
    mode: LibraryScanMode,
    state: StoredTrackCoverState | null,
    coverCacheCompletenessMemo: CoverCacheCompletenessMemo,
  ): boolean {
    if (mode === 'normal') {
      return false;
    }

    if (mode === 'embedded-tags-all') {
      return true;
    }

    return !state || this.needsMissingCoverOrDurationRepair(state, coverCacheCompletenessMemo);
  }

  private shouldBackfillPlaceholderMetadata(state: StoredTrackCoverState | null): boolean {
    if (!state) {
      return false;
    }

    return state.embeddedMetadataStatus === 'pending' || state.embeddedMetadataStatus === 'reading';
  }

  private shouldRepairStoredMojibakeMetadata(state: StoredTrackCoverState | null): boolean {
    const metadata = state?.scanMetadata;
    if (!metadata) {
      return false;
    }

    return repairableEmbeddedTextFieldKeys.some((field) => {
      const value = metadata.fields[field];
      return (
        typeof value === 'string' &&
        value.length > 0 &&
        repairableEmbeddedTextSources.has(metadata.fieldSources[field]) &&
        repairMojibakeText(value) !== value
      );
    });
  }

  private canReuseTerminalNoCoverState(
    mode: LibraryScanMode,
    state: StoredTrackCoverState,
  ): boolean {
    return (
      mode === 'normal' &&
      state.coverSource === 'default' &&
      (state.embeddedCoverStatus === 'missing' || state.embeddedCoverStatus === 'error') &&
      state.embeddedMetadataStatus !== 'pending' &&
      state.embeddedMetadataStatus !== 'reading'
    );
  }

  private isMissingOrDefaultCover(state: StoredTrackCoverState, memo: CoverCacheCompletenessMemo): boolean {
    return !state.coverId || state.coverSource === 'default' || !this.hasCompleteCoverCache(state, memo);
  }

  private needsMissingCoverOrDurationRepair(state: StoredTrackCoverState, memo: CoverCacheCompletenessMemo): boolean {
    return this.isMissingOrDefaultCover(state, memo) || (typeof state.duration === 'number' && state.duration <= 0);
  }

  private canRepairCoverCache(state: StoredTrackCoverState): boolean {
    return Boolean(
      state.coverId &&
        state.coverSource &&
        state.sourceHash &&
        state.originalRef &&
        existsSync(state.originalRef),
    );
  }

  private hasIdentityObservation(state: StoredTrackCoverState): boolean {
    return Boolean(state.identityStatus && (state.quickHash || state.fileIdentity || state.identityStatus === 'unsupported' || state.identityStatus === 'error'));
  }

  private async observeFileIdentity(filePath: string): Promise<FileIdentityObservation> {
    try {
      return await this.fileIdentityService.observe(filePath);
    } catch (error) {
      return {
        fileIdentity: null,
        fileIdentitySource: 'error',
        quickHash: null,
        quickHashVersion: QUICK_HASH_VERSION,
        identityStatus: 'error',
        identityUpdatedAt: new Date().toISOString(),
        identityError: compactScanMessage(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  private toTrackIdentityWrite(identity: FileIdentityObservation | null): {
    fileIdentity?: string | null;
    fileIdentitySource?: FileIdentityObservation['fileIdentitySource'];
    quickHash?: string | null;
    quickHashVersion?: number;
    identityStatus?: FileIdentityObservation['identityStatus'];
    identityUpdatedAt?: string;
    identityError?: string | null;
  } {
    if (!identity) {
      return {};
    }

    return {
      fileIdentity: identity.fileIdentity,
      fileIdentitySource: identity.fileIdentitySource,
      quickHash: identity.quickHash,
      quickHashVersion: identity.quickHashVersion,
      identityStatus: identity.identityStatus,
      identityUpdatedAt: identity.identityUpdatedAt,
      identityError: identity.identityError,
    };
  }

  private async runChangedFilePipeline(input: {
    jobId: string;
    folder: LibraryFolder;
    changedFiles: ChangedFile[];
    mode: LibraryScanMode;
    forceReducedScanPressure: boolean;
    skipIdentityObservation: boolean;
    coverCacheCompletenessMemo: CoverCacheCompletenessMemo;
    timestamp: string;
    searchIndexRomanizerReady: Promise<unknown>;
    metadataConcurrency: number;
    coverConcurrency: number;
    progress: ScanProgressReporter;
    errors: string[];
    osuImport: boolean;
    initialProcessedFiles: number;
    initialSkippedFiles: number;
  }): Promise<ChangedFilePipelineResult> {
    const {
      jobId,
      folder,
      changedFiles,
      mode,
      forceReducedScanPressure,
      skipIdentityObservation,
      coverCacheCompletenessMemo,
      timestamp,
      searchIndexRomanizerReady,
      metadataConcurrency: configuredMetadataConcurrency,
      coverConcurrency: configuredCoverConcurrency,
      progress,
      errors,
      osuImport,
      initialProcessedFiles,
      initialSkippedFiles,
    } = input;
    const result: ChangedFilePipelineResult = {
      processedFiles: 0,
      skippedFiles: 0,
      addedTracks: 0,
      updatedTracks: 0,
      coverCount: 0,
      addedTrackIds: [],
      seedAlbumsDurationMs: 0,
      seedAlbumsBatchCount: 0,
    };
    if (changedFiles.length === 0) {
      return result;
    }
    const { metadataConcurrency, coverConcurrency } = getEffectiveScanPipelineConcurrency(
      changedFiles.length,
      {
        metadataConcurrency: configuredMetadataConcurrency,
        coverConcurrency: configuredCoverConcurrency,
      },
    );

    const metadataQueue = new BoundedAsyncQueue<MetadataReadItem>(
      Math.max(4, coverConcurrency * pipelineQueueMultiplier),
    );
    const parsedQueue = new BoundedAsyncQueue<ParsedScanItem>(
      Math.max(8, metadataConcurrency * pipelineQueueMultiplier),
    );
    const preparedQueue = new BoundedAsyncQueue<PreparedParsedScanItem>(
      Math.max(8, metadataConcurrency * pipelineQueueMultiplier),
    );
    let adaptiveWriteBatchSize = initialScanWriteBatchSize;

    const nextWriteBatchPlan = async (): Promise<{ batchSize: number; reduced: boolean }> => {
      const reduced =
        forceReducedScanPressure || (await this.resolveBooleanOption(this.shouldReduceScanPressure));
      return {
        batchSize: reduced ? reducedScanWriteBatchSize : adaptiveWriteBatchSize,
        reduced,
      };
    };
    const finishWriteBatch = async (
      startedAtMs: number,
      reduced: boolean,
      batchSize: number,
      plannedBatchSize: number,
      queueDrained: boolean,
    ): Promise<void> => {
      const durationMs = performance.now() - startedAtMs;
      if (!reduced && (batchSize >= plannedBatchSize || queueDrained)) {
        adaptiveWriteBatchSize = this.adjustScanWriteBatchSize(adaptiveWriteBatchSize, durationMs);
      }
      if (durationMs > scanWriteBatchTargetMs * 1.5) {
        this.logPerf({
          jobId,
          folderId: folder.id,
          phase: 'writing_database_batch_slow',
          durationMs,
          fileCount: batchSize,
          batchSize,
          detail: `pipeline=true;nextBatchSize=${reduced ? reducedScanWriteBatchSize : adaptiveWriteBatchSize};reduced=${reduced}`,
        });
      }
      await yieldToMainLoop();
    };

    const metadataStartedAtMs = performance.now();
    const metadataStage = runMainBackgroundTask('library-scan:reading_metadata', async () => {
      await this.processWithAdaptiveConcurrency(
        changedFiles,
        metadataConcurrency,
        forceReducedScanPressure,
        async (item) => {
          this.throwIfCancelled(jobId);
          let metadata: MetadataResult;
          let identity: FileIdentityObservation | null = null;
          const reuseFingerprintMatchedCover = this.canReuseFingerprintMatchedEmbeddedCover(
            item.file,
            item.existingState,
            coverCacheCompletenessMemo,
          );
          try {
            metadata = await repairAlacTechnicalMetadataBeforeWrite(
              item.file.path,
              await this.metadataReader.read(item.file.path, {
                readCover: !reuseFingerprintMatchedCover,
              }),
            );
            const storedCoverStatus = item.existingState?.embeddedCoverStatus;
            if (
              reuseFingerprintMatchedCover &&
              (storedCoverStatus === 'present' || storedCoverStatus === 'missing' || storedCoverStatus === 'error') &&
              metadata.embeddedCoverStatus !== storedCoverStatus
            ) {
              metadata = {
                ...metadata,
                embeddedCoverStatus: storedCoverStatus,
              };
            }
            identity = skipIdentityObservation
              ? null
              : await this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
            this.collectWorkerMessages(errors, item.file.path, 'metadata', metadata.warnings, metadata.errors);
          } catch (error) {
            const message = compactScanMessage(error instanceof Error ? error.message : String(error));
            errors.push(`${item.file.path}: metadata: ${message}`);
            metadata = this.createFallbackMetadata(item.file, message);
            identity = skipIdentityObservation
              ? null
              : await this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
          }
          await metadataQueue.push({
            ...item,
            metadata,
            identity,
          });
          progress.update({
            phase: 'reading_metadata',
            errors,
          });
        },
      );
      metadataQueue.close();
    }).finally(() => {
      this.logPerf({
        jobId,
        folderId: folder.id,
        phase: 'metadata_pipeline_stage',
        durationMs: performance.now() - metadataStartedAtMs,
        fileCount: changedFiles.length,
        batchSize: metadataConcurrency,
      });
    });

    const coverStartedAtMs = performance.now();
    const coverStage = runMainBackgroundTask('library-scan:extracting_covers', async () => {
      await this.consumePipelineQueue(
        metadataQueue,
        coverConcurrency,
        forceReducedScanPressure,
        async (item) => {
          this.throwIfCancelled(jobId);
          let cover: CoverResult | null = null;
          let coverUnchanged = false;
          try {
            if (
              this.canReuseFingerprintMatchedEmbeddedCover(
                item.file,
                item.existingState,
                coverCacheCompletenessMemo,
              ) ||
              this.canReuseEmbeddedCover(mode, item.existingState, item.metadata, coverCacheCompletenessMemo)
            ) {
              coverUnchanged = true;
            } else {
              cover = await this.coverExtractor.extract(item.file.path, {
                cacheRoot: this.coverCacheDir,
                metadata: item.metadata,
                now: timestamp,
              });
              this.collectWorkerMessages(errors, item.file.path, 'cover', cover.warnings, cover.errors);
              if (
                item.existingState &&
                cover.sourceHash === item.existingState.sourceHash &&
                this.hasCompleteCoverCache(item.existingState, coverCacheCompletenessMemo)
              ) {
                cover = null;
                coverUnchanged = true;
              }
              if (cover) {
                result.coverCount += 1;
              }
            }
          } catch (error) {
            errors.push(`${item.file.path}: cover: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
          }

          await parsedQueue.push({
            file: item.file,
            existingTrackId: item.existingTrackId,
            existingState: item.existingState,
            metadata: this.stripEmbeddedCoverData(item.metadata),
            cover,
            coverUnchanged,
            identity: item.identity,
          });
          result.processedFiles += 1;
          progress.update({
            phase: 'extracting_covers',
            processedFiles: initialProcessedFiles + result.processedFiles,
            skippedFiles: initialSkippedFiles + result.skippedFiles,
            coverCount: result.coverCount,
            errors,
          });
        },
      );
      parsedQueue.close();
    }).finally(() => {
      this.logPerf({
        jobId,
        folderId: folder.id,
        phase: 'cover_pipeline_stage',
        durationMs: performance.now() - coverStartedAtMs,
        fileCount: changedFiles.length,
        batchSize: coverConcurrency,
      });
    });

    const searchStartedAtMs = performance.now();
    const searchStage = runMainBackgroundTask('library-scan:preparing_search_terms', async () => {
      await searchIndexRomanizerReady;
      await this.consumePipelineQueue(
        parsedQueue,
        metadataConcurrency,
        forceReducedScanPressure,
        async (item) => {
          this.throwIfCancelled(jobId);
          const metadata = this.preserveStoredHigherQualityMetadata(
            mode,
            item,
            this.withScanFieldSourceMarkers(item.metadata, { osuImport }),
          );
          if (this.shouldSkipEmbeddedRescanWrite(mode, item, metadata)) {
            result.skippedFiles += 1;
            progress.update({
              skippedFiles: initialSkippedFiles + result.skippedFiles,
            });
            return;
          }
          const trackId = item.existingTrackId ?? randomUUID();
          const trackWrite = {
            ...item.file,
            ...metadata.fields,
            id: trackId,
            coverId: null,
            fieldSources: metadata.fieldSources,
            embeddedMetadataStatus: metadata.embeddedMetadataStatus,
            embeddedCoverStatus: metadata.embeddedCoverStatus,
            metadataStatus: metadata.status,
            warnings: metadata.warnings,
            errors: metadata.errors,
            updatedAt: timestamp,
            ...this.toTrackIdentityWrite(item.identity),
          };
          const searchTerms = this.searchTermsBuilder
            ? await this.searchTermsBuilder.prepare(this.store.prepareTrackSearchFields(trackWrite))
            : await this.store.prepareTrackSearchTerms(trackWrite);
          await preparedQueue.push({
            ...item,
            metadata,
            trackId,
            searchTerms,
          });
        },
      );
      preparedQueue.close();
    }).finally(() => {
      this.logPerf({
        jobId,
        folderId: folder.id,
        phase: 'search_pipeline_stage',
        durationMs: performance.now() - searchStartedAtMs,
        fileCount: changedFiles.length,
        batchSize: metadataConcurrency,
      });
    });

    const writerStartedAtMs = performance.now();
    const writerStage = runMainBackgroundTask('library-scan:writing_database', async () => {
      for (;;) {
        this.throwIfCancelled(jobId);
        const first = await preparedQueue.take();
        if (first === pipelineQueueClosed) {
          break;
        }
        const plan = await nextWriteBatchPlan();
        await yieldToMainLoop();
        if (plan.batchSize > 1 && !preparedQueue.isDrained) {
          await preparedQueue.waitForBufferedItems(plan.batchSize - 1, pipelineWriteCoalesceMs);
        }
        const batch = [first, ...preparedQueue.drainAvailable(plan.batchSize - 1)];
        const changedTrackIds: string[] = [];
        const batchStartedAtMs = performance.now();
        this.store.transaction(() => {
          for (const item of batch) {
            const coverId = item.cover
              ? this.store.upsertCover(item.cover, timestamp)
              : item.existingState?.coverId ?? null;
            const upsertResult = this.store.upsertTrack({
              ...item.file,
              ...item.metadata.fields,
              id: item.trackId,
              coverId,
              fieldSources: item.metadata.fieldSources,
              embeddedMetadataStatus: item.metadata.embeddedMetadataStatus,
              embeddedCoverStatus: item.metadata.embeddedCoverStatus,
              metadataStatus: item.metadata.status,
              warnings: item.metadata.warnings,
              errors: item.metadata.errors,
              updatedAt: timestamp,
              ...this.toTrackIdentityWrite(item.identity),
            }, item.searchTerms ?? undefined);
            if (upsertResult === 'added') {
              result.addedTracks += 1;
              result.addedTrackIds.push(item.trackId);
            } else {
              result.updatedTracks += 1;
            }
            changedTrackIds.push(item.trackId);
          }
        });
        if (changedTrackIds.length > 0) {
          const seedStartedAtMs = performance.now();
          this.store.seedAlbumsForTracks(changedTrackIds, this.albumService, timestamp, {
            albumMergeStrategy: this.getAlbumMergeStrategy(),
          });
          result.seedAlbumsDurationMs += performance.now() - seedStartedAtMs;
          result.seedAlbumsBatchCount += 1;
        }
        progress.update({
          phase: 'writing_database',
          processedFiles: initialProcessedFiles + result.processedFiles,
          skippedFiles: initialSkippedFiles + result.skippedFiles,
          addedTracks: result.addedTracks,
          updatedTracks: result.updatedTracks,
          coverCount: result.coverCount,
          errors,
        });
        await finishWriteBatch(
          batchStartedAtMs,
          plan.reduced,
          batch.length,
          plan.batchSize,
          preparedQueue.isDrained,
        );
      }
    }).finally(() => {
      this.logPerf({
        jobId,
        folderId: folder.id,
        phase: 'write_pipeline_stage',
        durationMs: performance.now() - writerStartedAtMs,
        fileCount: changedFiles.length,
      });
    });

    const stages = [metadataStage, coverStage, searchStage, writerStage];
    try {
      await Promise.all(stages);
    } catch (error) {
      metadataQueue.fail(error);
      parsedQueue.fail(error);
      preparedQueue.fail(error);
      await Promise.allSettled(stages);
      throw error;
    }
    return result;
  }

  private async consumePipelineQueue<T>(
    queue: BoundedAsyncQueue<T>,
    maxConcurrency: number,
    forceReducedScanPressure: boolean,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    const normalizedMaxConcurrency = Math.max(1, Math.floor(maxConcurrency));
    const workers = Array.from({ length: normalizedMaxConcurrency }, (_, workerIndex) => (async () => {
      for (;;) {
        while (!queue.isDrained) {
          const playbackPressure =
            !forceReducedScanPressure && (await this.resolveBooleanOption(this.shouldReduceScanPressure));
          const concurrency = forceReducedScanPressure
            ? Math.min(normalizedMaxConcurrency, 2)
            : playbackPressure
              ? Math.max(1, Math.ceil(normalizedMaxConcurrency / 2))
              : normalizedMaxConcurrency;
          if (workerIndex < concurrency) {
            break;
          }
          await delay(pipelinePressurePollMs);
        }
        if (queue.isDrained) {
          return;
        }
        const item = await queue.take();
        if (item === pipelineQueueClosed) {
          return;
        }
        await worker(item);
      }
    })());
    await Promise.all(workers);
  }

  private async processWithAdaptiveConcurrency<T>(
    items: T[],
    maxConcurrency: number,
    forceReducedScanPressure: boolean,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const normalizedMaxConcurrency = Math.max(1, Math.floor(maxConcurrency));
    const running = new Set<Promise<void>>();
    let sliceStartedAtMs = performance.now();

    const launch = (item: T): void => {
      let task: Promise<void>;
      task = Promise.resolve()
        .then(() => worker(item))
        .finally(() => {
          running.delete(task);
        });
      running.add(task);
    };

    try {
      while (nextIndex < items.length || running.size > 0) {
        const playbackPressure =
          !forceReducedScanPressure && (await this.resolveBooleanOption(this.shouldReduceScanPressure));
        const concurrency = forceReducedScanPressure
          ? Math.min(normalizedMaxConcurrency, 2)
          : playbackPressure
            ? Math.max(1, Math.ceil(normalizedMaxConcurrency / 2))
            : normalizedMaxConcurrency;

        while (nextIndex < items.length && running.size < concurrency) {
          launch(items[nextIndex]);
          nextIndex += 1;
        }

        if (running.size === 0) {
          continue;
        }

        await Promise.race(running);
        const sliceBudgetMs = forceReducedScanPressure || playbackPressure
          ? reducedMainThreadSliceBudgetMs
          : normalMainThreadSliceBudgetMs;
        if (performance.now() - sliceStartedAtMs >= sliceBudgetMs) {
          await yieldToMainLoop();
          sliceStartedAtMs = performance.now();
        }
      }
    } catch (error) {
      await Promise.allSettled(running);
      throw error;
    }
  }
}
