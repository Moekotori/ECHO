import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import { SCANNABLE_AUDIO_EXTENSIONS } from '../../shared/constants/audioExtensions';
import type { AlbumMergeStrategy, AlbumService } from './AlbumService';
import type { LibraryStore } from './LibraryStore';
import type {
  CoverResult,
  FieldSources,
  LibraryFolder,
  LibraryScanMode,
  LibraryScanOptions,
  LibraryScanStatus,
  MetadataResult,
  ScanDirectorySnapshot,
  ScanFileSystemError,
  ScannedAudioFile,
  ScannedFile,
  ScanJobUpdate,
  StoredTrackCoverState,
} from './libraryTypes';
import type { CoverExtractor } from './workers/CoverExtractor';
import type { FileScanner } from './workers/FileScanner';
import type { MetadataReader } from './workers/MetadataReader';
import { getNcmConverter } from './NcmConverter';
import { getKgmConverter } from './KgmConverter';
import { FileIdentityService, QUICK_HASH_VERSION, type FileIdentityObservation } from './FileIdentityService';
import { createCueTrackPath, readCueSheet, readEmbeddedCueSheet, resolveCueTrack } from '../audio/CueSheet';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { preloadSearchIndexRomanizer } from './SearchIndexTokens';

type ParsedScanItem = {
  file: ScannedAudioFile;
  metadata: MetadataResult;
  cover: CoverResult | null;
  existingTrackId: string | null;
  identity: FileIdentityObservation | null;
};

type PreparedParsedScanItem = ParsedScanItem & {
  trackId: string;
  searchTerms: string | null;
};

type ChangedFile = {
  file: ScannedAudioFile;
  existingTrackId: string | null;
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

type SidecarCueExpansion = {
  trackFiles: ScannedAudioFile[];
  audioPaths: string[];
};

type ScanJobQueueOptions = {
  coverCacheDir: string;
  metadataConcurrency?: number;
  coverConcurrency?: number;
  getAlbumMergeStrategy?: () => AlbumMergeStrategy;
  checkDatabaseHealth?: (status: LibraryScanStatus) => void;
  createDatabaseScanGuard?: (status: LibraryScanStatus) => Promise<unknown | null> | unknown | null;
  createCompletedScanSnapshot?: (status: LibraryScanStatus) => Promise<void> | void;
  recoverDatabaseFromScanGuard?: (snapshot: unknown | null, status: LibraryScanStatus, error: unknown) => Promise<void> | void;
  fileIdentityService?: FileIdentityService;
  shouldReduceScanPressure?: () => boolean | Promise<boolean>;
  shouldDeferGroupingRefresh?: () => boolean | Promise<boolean>;
  onScanSettled?: (status: LibraryScanStatus) => void;
  onDeferredGroupingRefresh?: () => void;
};

const progressFlushIntervalMs = 300;
const progressFlushFileDelta = 64;
const cacheCheckYieldFileDelta = 256;
const deferredGroupingRefreshDelayMs = 1000;
const largeScanFileThreshold = 2000;
const largeScanWriteBatchSize = 128;
const normalScanWriteBatchSize = 512;
const scanFileSystemOperationTimeoutMs = 10_000;
const scanDiscoveryYieldEveryEntries = 32;
const maxStoredScanErrors = 200;
const scanErrorSummaryThreshold = 20;
const maxScanErrorMessageLength = 512;

const runMainBackgroundTask = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
  const clearBackgroundTask = beginMainBackgroundTask(name);
  try {
    return await work();
  } finally {
    clearBackgroundTask();
  }
};
const maxLocalScanPathCount = 1000;
const temporaryExtensions = new Set(['.tmp', '.temp', '.part', '.crdownload', '.download', '.swp']);
const ignoredTemporaryNames = new Set(['.ds_store', 'thumbs.db']);
const cueAwareScannableAudioExtensions = [...SCANNABLE_AUDIO_EXTENSIONS, '.cue'];

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

const compactScanMessage = (message: unknown): string => {
  const normalized = String(message ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim();
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
  private readonly fileIdentityService: FileIdentityService;
  private readonly shouldReduceScanPressure: () => boolean | Promise<boolean>;
  private readonly shouldDeferGroupingRefresh: () => boolean | Promise<boolean>;
  private readonly onScanSettled: (status: LibraryScanStatus) => void;
  private readonly onDeferredGroupingRefresh: () => void;
  private readonly pendingDatabaseRecoveries = new Map<string, { snapshot: unknown | null; status: LibraryScanStatus; error: unknown }>();
  private coverCacheDir: string;
  private deferredGroupingRefreshTimer: NodeJS.Timeout | null = null;

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
    this.checkDatabaseHealth = options.checkDatabaseHealth ?? (() => undefined);
    this.createDatabaseScanGuard = options.createDatabaseScanGuard ?? (() => null);
    this.createCompletedScanSnapshot = options.createCompletedScanSnapshot ?? (() => undefined);
    this.recoverDatabaseFromScanGuard = options.recoverDatabaseFromScanGuard ?? (() => undefined);
    this.fileIdentityService = options.fileIdentityService ?? new FileIdentityService();
    this.shouldReduceScanPressure = options.shouldReduceScanPressure ?? (() => false);
    this.shouldDeferGroupingRefresh = options.shouldDeferGroupingRefresh ?? (() => false);
    this.onScanSettled = options.onScanSettled ?? (() => undefined);
    this.onDeferredGroupingRefresh = options.onDeferredGroupingRefresh ?? (() => undefined);
    this.coverCacheDir = options.coverCacheDir;
  }

  hasRunningJobs(): boolean {
    return this.runningJobs.size > 0;
  }

  updateCoverCacheDir(coverCacheDir: string): void {
    this.coverCacheDir = coverCacheDir;
  }

  dispose(): void {
    if (this.deferredGroupingRefreshTimer) {
      clearTimeout(this.deferredGroupingRefreshTimer);
      this.deferredGroupingRefreshTimer = null;
    }
  }

  scanFolder(folder: LibraryFolder, options: LibraryScanOptions = {}): LibraryScanStatus {
    const job = this.store.createScanJob(folder.id);
    this.enqueueScanJob(job.id, () => this.runJob(job.id, folder, options.mode ?? 'normal', options.deferGroupingRefresh === true));

    return job;
  }

  scanPaths(folder: LibraryFolder, paths: string[], options: LibraryScanOptions = {}): LibraryScanStatus {
    if (paths.length > maxLocalScanPathCount) {
      throw new Error(`Too many local rescan paths: ${paths.length} > ${maxLocalScanPathCount}`);
    }

    const job = this.store.createScanJob(folder.id);
    this.enqueueScanJob(job.id, () => this.runPathsJob(job.id, folder, paths, options.mode ?? 'normal', options.deferGroupingRefresh === true));

    return job;
  }

  scanStoredTracks(folder: LibraryFolder, options: LibraryScanOptions = {}): LibraryScanStatus {
    const job = this.store.createScanJob(folder.id);
    this.enqueueScanJob(job.id, () => this.runStoredTracksJob(job.id, folder, options.mode ?? 'normal', options.deferGroupingRefresh === true));

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

  async waitForIdle(jobId: string): Promise<void> {
    await this.runningJobs.get(jobId);
  }

  private enqueueScanJob(jobId: string, runJob: () => Promise<void>): void {
    const run = this.scanJobTail
      .catch(() => undefined)
      .then(async () => {
        const current = this.store.getScanJob(jobId);
        if (current?.status === 'cancelled') {
          return;
        }

        await runJob();
      })
      .finally(async () => {
        this.runningJobs.delete(jobId);
        this.notifyScanSettled(jobId);
        await this.recoverPendingDatabaseFailure(jobId);
      });

    this.runningJobs.set(jobId, run);
    this.scanJobTail = run.catch(() => undefined);
  }

  private async runJob(jobId: string, folder: LibraryFolder, mode: LibraryScanMode, deferGroupingRefresh: boolean): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });

      const discovery = await this.discoverFiles(jobId, folder, errors, progress);
      await this.runFilesJob(
        jobId,
        folder,
        discovery.files,
        mode,
        progress,
        errors,
        true,
        deferGroupingRefresh,
        discovery.inaccessibleDirectories,
        discovery.protectedPaths,
        discovery.directorySnapshots,
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
    deferGroupingRefresh: boolean,
  ): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });

      const files = this.normalizeLocalRescanPaths(folder, paths);
      progress.flushNow({
        phase: 'discovering',
        totalFiles: files.length,
        errors,
      });
      await this.runFilesJob(jobId, folder, files, mode, progress, errors, false, deferGroupingRefresh);
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
    deferGroupingRefresh: boolean,
  ): Promise<void> {
    const progress = this.createProgressReporter(jobId);
    const errors: string[] = [];

    try {
      progress.flushNow({
        status: 'running',
        phase: 'discovering',
        startedAt: new Date().toISOString(),
      });

      await yieldToMainLoop();
      const files = await this.collectStoredTrackRescanFiles(jobId, folder, mode, progress, errors);
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

      await this.runFilesJob(jobId, folder, files, mode, progress, errors, false, deferGroupingRefresh);
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
    deferGroupingRefresh = false,
    inaccessibleDirectories: readonly string[] = [],
    protectedPaths: readonly string[] = [],
    directorySnapshots: readonly ScanDirectorySnapshot[] = [],
  ): Promise<void> {
    let processedFiles = 0;
    let skippedFiles = 0;
    let addedTracks = 0;
    let updatedTracks = 0;
    let removedTracks = 0;
    let coverCount = 0;
    const addedTrackIds: string[] = [];
    const reducedScanPressure = await this.resolveBooleanOption(this.shouldReduceScanPressure);
    const scanGuard = await Promise.resolve(this.createDatabaseScanGuard(this.getScanStatus(jobId)));
    const searchIndexRomanizerReady = preloadSearchIndexRomanizer();

    try {
      progress.flushNow({
        phase: 'checking_cache',
        totalFiles: files.length,
        errors,
      });

      const changedFiles: ChangedFile[] = [];
      const coverRepairItems: CoverRepairItem[] = [];
      const identityUpdateItems: IdentityUpdateItem[] = [];
      const cacheStatesByPath = this.store.getTrackCacheStatesByFolder(folder.id);
      let checkedFiles = 0;

      for (const file of files) {
        this.throwIfCancelled(jobId);
        checkedFiles += 1;

        const existing = cacheStatesByPath.get(resolve(file.path)) ?? null;

        const unchanged = existing && existing.sizeBytes === file.sizeBytes && existing.mtimeMs === file.mtimeMs;
        const forceReadEmbeddedTags = this.shouldForceReadEmbeddedTags(mode, existing) || this.shouldBackfillPlaceholderMetadata(existing);

        if (unchanged && !forceReadEmbeddedTags) {
          if (this.hasCompleteCoverCache(existing)) {
            if (!reducedScanPressure && !this.hasIdentityObservation(existing)) {
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
            if (checkedFiles % cacheCheckYieldFileDelta === 0) {
              await yieldToMainLoop();
            }
            continue;
          }

          if (this.canRepairCoverCache(existing)) {
            coverRepairItems.push({
              file,
              state: existing,
              cover: null,
              identity: null,
            });
            continue;
          }

          changedFiles.push({
            file,
            existingTrackId: existing.id,
          });
          continue;
        }

        changedFiles.push({
          file,
          existingTrackId: existing?.id ?? null,
        });
        if (checkedFiles % cacheCheckYieldFileDelta === 0) {
          await yieldToMainLoop();
        }
      }

      progress.flushNow({
        phase: 'reading_metadata',
        processedFiles,
        skippedFiles,
        errors,
      });

      const parsedItems: ParsedScanItem[] = [];
      const coverTimestamp = new Date().toISOString();

      const largeScan = files.length >= largeScanFileThreshold;
      const reducedOrLargeScanPressure = reducedScanPressure || largeScan;
      const metadataConcurrency = reducedOrLargeScanPressure ? 1 : this.metadataConcurrency;
      const coverConcurrency = reducedOrLargeScanPressure ? 1 : this.coverConcurrency;

      await runMainBackgroundTask('library-scan:reading_metadata', () =>
        this.processWithConcurrency(changedFiles, metadataConcurrency, async (item) => {
          this.throwIfCancelled(jobId);

          let metadata: MetadataResult;
          let identity: FileIdentityObservation | null = null;

          try {
            metadata = await this.metadataReader.read(item.file.path);
            identity = reducedOrLargeScanPressure ? null : this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
            this.collectWorkerMessages(errors, item.file.path, 'metadata', metadata.warnings, metadata.errors);
          } catch (error) {
            const message = compactScanMessage(error instanceof Error ? error.message : String(error));
            errors.push(`${item.file.path}: metadata: ${message}`);
            metadata = this.createFallbackMetadata(item.file, message);
            identity = reducedOrLargeScanPressure ? null : this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
          }

          try {
            let cover: CoverResult | null = null;

            try {
              cover = await this.coverExtractor.extract(item.file.path, {
                cacheRoot: this.coverCacheDir,
                metadata,
                now: coverTimestamp,
              });
              this.collectWorkerMessages(errors, item.file.path, 'cover', cover.warnings, cover.errors);
              coverCount += 1;
            } catch (error) {
              errors.push(`${item.file.path}: cover: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
            }

            parsedItems.push({
              ...item,
              metadata: this.stripEmbeddedCoverData(metadata),
              cover,
              identity,
            });
          } catch (error) {
            errors.push(`${item.file.path}: cover: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
          }

          processedFiles += 1;
          progress.update({
            phase: 'reading_metadata',
            processedFiles,
            skippedFiles,
            coverCount,
            errors,
          });
          await yieldToMainLoop();
        }),
      );

      this.throwIfCancelled(jobId);

      progress.flushNow({
        phase: 'extracting_covers',
        processedFiles,
        skippedFiles,
        coverCount,
        errors,
      });

      await runMainBackgroundTask('library-scan:extracting_covers', () =>
        this.processWithConcurrency(coverRepairItems, coverConcurrency, async (item) => {
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

          if (!reducedOrLargeScanPressure && !this.hasIdentityObservation(item.state)) {
            item.identity = this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
          }

          processedFiles += 1;
          progress.update({
            phase: 'extracting_covers',
            processedFiles,
            skippedFiles,
            coverCount,
            errors,
          });
          await yieldToMainLoop();
        }),
      );

      await this.processWithConcurrency(identityUpdateItems, metadataConcurrency, async (item) => {
        this.throwIfCancelled(jobId);
        item.identity = this.observeFileIdentity(this.resolvePhysicalAudioPath(item.file.path));
        await yieldToMainLoop();
      });

      this.throwIfCancelled(jobId);
      const timestamp = new Date().toISOString();
      const preparedParsedItems: PreparedParsedScanItem[] = parsedItems.map((item) => ({
        ...item,
        trackId: item.existingTrackId ?? randomUUID(),
        searchTerms: null,
      }));

      await searchIndexRomanizerReady;
      await this.processWithConcurrency(preparedParsedItems, metadataConcurrency, async (item) => {
        this.throwIfCancelled(jobId);
        item.searchTerms = await this.store.prepareTrackSearchTerms({
          ...item.file,
          ...item.metadata.fields,
          id: item.trackId,
          coverId: null,
          fieldSources: item.metadata.fieldSources,
          embeddedMetadataStatus: item.metadata.embeddedMetadataStatus,
          embeddedCoverStatus: item.metadata.embeddedCoverStatus,
          metadataStatus: item.metadata.status,
          warnings: item.metadata.warnings,
          errors: item.metadata.errors,
          updatedAt: timestamp,
          ...this.toTrackIdentityWrite(item.identity),
        });
        await yieldToMainLoop();
      });

      this.throwIfCancelled(jobId);
      await yieldToMainLoop();
      const deferGroupingForPressure =
        !deferGroupingRefresh &&
        (largeScan || (await this.resolveBooleanOption(this.shouldDeferGroupingRefresh)));

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

      await runMainBackgroundTask('library-scan:writing_database', async () => {
        const coverChangedTrackIds: string[] = [];
        this.store.transaction(() => {
          this.store.upsertScanDirectorySnapshots(folder.id, directorySnapshots, timestamp);

          if (markMissing) {
            removedTracks = this.store.markTracksMissingFromFolder(
              folder.id,
              [...files.map((file) => file.path), ...protectedPaths],
              timestamp,
              { excludeDirectories: inaccessibleDirectories },
            );
          }

          for (const item of coverRepairItems) {
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

          for (const item of identityUpdateItems) {
            if (item.identity) {
              this.store.updateTrackIdentity(item.state.id, item.identity, timestamp);
            }
          }
        });
        if (coverChangedTrackIds.length > 0) {
          this.store.seedAlbumsForTracks(coverChangedTrackIds, this.albumService, timestamp, { albumMergeStrategy: this.getAlbumMergeStrategy() });
        }

        const writeBatchSize = reducedOrLargeScanPressure ? largeScanWriteBatchSize : normalScanWriteBatchSize;
        for (let index = 0; index < preparedParsedItems.length; index += writeBatchSize) {
          const batch = preparedParsedItems.slice(index, index + writeBatchSize);
          const changedTrackIds: string[] = [];
          this.store.transaction(() => {
            for (const item of batch) {
              const coverId = item.cover ? this.store.upsertCover(item.cover, timestamp) : null;
              const result = this.store.upsertTrack({
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

              if (result === 'added') {
                addedTracks += 1;
                addedTrackIds.push(item.trackId);
              } else {
                updatedTracks += 1;
              }
              changedTrackIds.push(item.trackId);
            }
          });
          this.store.seedAlbumsForTracks(changedTrackIds, this.albumService, timestamp, { albumMergeStrategy: this.getAlbumMergeStrategy() });

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
          await yieldToMainLoop();
        }
      });

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
      if (deferGroupingRefresh || deferGroupingForPressure || addedTracks > 0 || updatedTracks > 0 || removedTracks > 0) {
        this.scheduleDeferredGroupingRefresh();
      }
      try {
        const completedStatus = this.getScanStatus(jobId);
        this.checkDatabaseHealth(completedStatus);
        try {
          await Promise.resolve(this.createCompletedScanSnapshot(completedStatus));
        } catch (snapshotError) {
          console.warn('[library-scan] Failed to create completed scan recovery snapshot:', snapshotError);
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
      this.queueDatabaseRecoveryIfUnhealthy(jobId, scanGuard, status);
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

  private queueDatabaseRecoveryIfUnhealthy(
    jobId: string,
    snapshot: unknown | null,
    status: LibraryScanStatus,
  ): void {
    try {
      this.checkDatabaseHealth(status);
    } catch (healthError) {
      this.queueDatabaseRecovery(jobId, snapshot, status, healthError);
      return;
    }

  }

  private async discoverFiles(
    jobId: string,
    folder: LibraryFolder,
    errors: string[],
    progress: ScanProgressReporter,
  ): Promise<ScanDiscoveryResult> {
    const files: ScannedAudioFile[] = [];
    const inaccessibleDirectories = new Set<string>();
    const protectedPaths = new Set<string>();
    const directorySnapshots = this.store.getScanDirectorySnapshotsByFolder(folder.id);
    const updatedSnapshots: ScanDirectorySnapshot[] = [];

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
        audioExtensions: cueAwareScannableAudioExtensions,
        fileSystemOperationTimeoutMs: scanFileSystemOperationTimeoutMs,
        yieldEveryEntries: scanDiscoveryYieldEveryEntries,
        onFileSystemError,
        getDirectorySnapshot: (directoryPath) => directorySnapshots.get(this.pathCompareValue(resolve(directoryPath))) ?? null,
        onDirectorySnapshot: (snapshot) => {
          updatedSnapshots.push(snapshot);
        },
      })) {
        this.throwIfCancelled(jobId);
        try {
          files.push(await this.normalizeScannedFile(file, folder.id));
        } catch (error) {
          errors.push(`${file.path}: ncm: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
        }

        if (files.length % 100 === 0) {
          progress.update({
            phase: 'discovering',
            totalFiles: files.length,
            errors,
          });
        }
      }
    } catch (error) {
      errors.push(`${folder.path}: scanner: ${compactScanMessage(error instanceof Error ? error.message : String(error))}`);
      throw error;
    }

    return {
      files: this.expandCueTracks(files, folder, errors),
      inaccessibleDirectories: Array.from(inaccessibleDirectories),
      protectedPaths: Array.from(protectedPaths),
      directorySnapshots: updatedSnapshots,
    };
  }

  private normalizeLocalRescanPaths(folder: LibraryFolder, paths: string[]): ScannedAudioFile[] {
    const files: ScannedAudioFile[] = [];
    const seen = new Set<string>();

    for (const inputPath of paths) {
      const filePath = resolve(inputPath);
      const comparePath = this.pathCompareValue(filePath);

      if (seen.has(comparePath) || !this.isPathInsideFolder(folder.path, filePath) || !this.isLocalRescanCandidate(filePath)) {
        continue;
      }

      seen.add(comparePath);

      try {
        const fileStat = statSync(filePath);
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

    return this.expandCueTracks(files, folder, []);
  }

  private isLocalRescanCandidate(filePath: string): boolean {
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

    return SCANNABLE_AUDIO_EXTENSIONS.has(extension) || extension === '.cue';
  }

  private shouldRescanStoredTrack(mode: LibraryScanMode, state: StoredTrackCoverState): boolean {
    if (mode === 'normal') {
      return true;
    }

    if (mode === 'embedded-tags-all') {
      return true;
    }

    return this.isMissingOrDefaultCover(state);
  }

  private async collectStoredTrackRescanFiles(
    jobId: string,
    folder: LibraryFolder,
    mode: LibraryScanMode,
    progress: ScanProgressReporter,
    errors: string[],
  ): Promise<ScannedAudioFile[]> {
    const files: ScannedAudioFile[] = [];
    const states = this.store.getTrackCacheStatesByFolder(folder.id);
    let checkedFiles = 0;

    for (const [trackPath, state] of states) {
      this.throwIfCancelled(jobId);
      checkedFiles += 1;

      if (!this.shouldRescanStoredTrack(mode, state)) {
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
        const fileStat = statSync(physicalPath);
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

    return files;
  }

  private isPathInsideFolder(folderPath: string, filePath: string): boolean {
    const root = this.pathCompareValue(resolve(folderPath));
    const candidate = this.pathCompareValue(resolve(filePath));
    const relativePath = relative(root, candidate);

    return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
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
    const afterNcm = await getNcmConverter().convertIfNeeded(file.path);
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

  private expandCueTracks(files: ScannedAudioFile[], folder: LibraryFolder, errors: string[]): ScannedAudioFile[] {
    const sidecarTrackFilesByCuePath = new Map<string, ScannedAudioFile[]>();
    const suppressedAudioPaths = new Set<string>();

    for (const file of files) {
      if (extname(file.path).toLowerCase() !== '.cue') {
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
    }

    const expanded: ScannedAudioFile[] = [];
    for (const file of files) {
      const normalizedPath = resolve(file.path);
      const sidecarTracks = sidecarTrackFilesByCuePath.get(normalizedPath);
      if (sidecarTracks) {
        expanded.push(...sidecarTracks);
        continue;
      }

      if (extname(file.path).toLowerCase() === '.cue' || suppressedAudioPaths.has(this.pathCompareValue(normalizedPath))) {
        continue;
      }

      expanded.push(...this.expandEmbeddedCueTracks(file));
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

  private hasCompleteCoverCache(state: StoredTrackCoverState): boolean {
    return Boolean(
      state.coverId &&
        state.thumbPath &&
        state.albumPath &&
        state.largePath &&
        existsSync(state.thumbPath) &&
        existsSync(state.albumPath) &&
        existsSync(state.largePath),
    );
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

  private scheduleDeferredGroupingRefresh(): void {
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

    try {
      await runMainBackgroundTask('library-scan:grouping_albums', () => {
        this.store.transaction(() => {
          this.store.refreshAlbums(this.albumService, undefined, { albumMergeStrategy: this.getAlbumMergeStrategy() });
          this.store.refreshArtists();
        });
      });
      this.onDeferredGroupingRefresh();
    } catch (error) {
      console.warn(`Deferred library grouping refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleDeferredGroupingRefresh();
    }
  }

  private shouldForceReadEmbeddedTags(mode: LibraryScanMode, state: StoredTrackCoverState | null): boolean {
    if (mode === 'normal') {
      return false;
    }

    if (mode === 'embedded-tags-all') {
      return true;
    }

    return !state || this.isMissingOrDefaultCover(state);
  }

  private shouldBackfillPlaceholderMetadata(state: StoredTrackCoverState | null): boolean {
    if (!state) {
      return false;
    }

    return (
      state.metadataStatus === 'fallback' ||
      state.embeddedMetadataStatus === 'pending' ||
      state.embeddedMetadataStatus === 'reading'
    );
  }

  private isMissingOrDefaultCover(state: StoredTrackCoverState): boolean {
    return !state.coverId || state.coverSource === 'default' || !this.hasCompleteCoverCache(state);
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

  private observeFileIdentity(filePath: string): FileIdentityObservation {
    try {
      return this.fileIdentityService.observe(filePath);
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

  private async processWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          await worker(items[currentIndex]);
        }
      }),
    );
  }
}
