import { setImmediate as yieldToMainLoop } from 'node:timers/promises';
import type { RemoteSyncOptions, RemoteSyncStatus } from '../../../shared/types/remoteSources';
import type { RemoteLibraryStore } from './RemoteLibraryStore';
import type { RemoteSourceAdapter, RemoteTrackWrite } from './remoteTypes';
import { remoteTrackIdFor } from './remoteIdentity';

const batchSize = 150;
const statusFlushIntervalMs = 300;
const statusFlushItemDelta = 64;
const scanYieldItemDelta = 100;
const nowIso = (): string => new Date().toISOString();

const initialStatus = (sourceId: string): RemoteSyncStatus => ({
  sourceId,
  status: 'idle',
  phase: 'idle',
  discoveredCount: 0,
  parsedCount: 0,
  writtenCount: 0,
  skippedCount: 0,
  missingCount: 0,
  failedCount: 0,
  currentPath: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
});

export class RemoteLibrarySyncService {
  private readonly statuses = new Map<string, RemoteSyncStatus>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly store: RemoteLibraryStore,
    private readonly getAdapter: (provider: string) => RemoteSourceAdapter,
    private readonly onTracksIndexed: (sourceId: string, tracks: RemoteTrackWrite[]) => void = () => undefined,
    private readonly onSyncSettled: (sourceId: string, status: RemoteSyncStatus, options: RemoteSyncOptions) => void = () => undefined,
  ) {}

  syncSource(sourceId: string, options: RemoteSyncOptions = {}): RemoteSyncStatus {
    if (this.controllers.has(sourceId)) {
      return this.getSyncStatus(sourceId);
    }

    const controller = new AbortController();
    this.controllers.set(sourceId, controller);
    this.setStatus(sourceId, {
      ...initialStatus(sourceId),
      status: 'running',
      phase: 'testing',
      startedAt: nowIso(),
    });

    void this.runSync(sourceId, controller, options).finally(() => {
      this.controllers.delete(sourceId);
    });

    return this.getSyncStatus(sourceId);
  }

  cancelSync(sourceId: string): RemoteSyncStatus {
    this.controllers.get(sourceId)?.abort();
    return this.getSyncStatus(sourceId);
  }

  getSyncStatus(sourceId: string): RemoteSyncStatus {
    return this.statuses.get(sourceId) ?? initialStatus(sourceId);
  }

  rescanChanged(sourceId: string): RemoteSyncStatus {
    return this.syncSource(sourceId);
  }

  removeMissingTracks(sourceId: string): number {
    return this.store.removeMissingTracks(sourceId);
  }

  private async runSync(sourceId: string, controller: AbortController, options: RemoteSyncOptions): Promise<void> {
    const source = this.store.getSourceWithSecret(sourceId);
    if (!source) {
      this.fail(sourceId, `Unknown remote source ${sourceId}`);
      return;
    }

    const adapter = this.getAdapter(source.provider);
    const errors: string[] = [];
    const seenPaths = new Set<string>();
    const fingerprints = this.store.getComparableFingerprints(sourceId);
    let batch: RemoteTrackWrite[] = [];
    let discoveredCount = 0;
    let parsedCount = 0;
    let writtenCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let lastStatusFlushAt = 0;
    let lastDiscoveredCount = 0;
    let lastWrittenCount = 0;
    let itemsSinceYield = 0;

    const publishProgress = (force = false, patch: Partial<RemoteSyncStatus> = {}): void => {
      const now = Date.now();
      const shouldFlush =
        force ||
        now - lastStatusFlushAt >= statusFlushIntervalMs ||
        discoveredCount - lastDiscoveredCount >= statusFlushItemDelta ||
        writtenCount - lastWrittenCount >= statusFlushItemDelta;

      if (!shouldFlush) {
        return;
      }

      lastStatusFlushAt = now;
      lastDiscoveredCount = discoveredCount;
      lastWrittenCount = writtenCount;
      this.patchStatus(sourceId, {
        discoveredCount,
        parsedCount,
        writtenCount,
        skippedCount,
        failedCount,
        errors: errors.slice(-20),
        ...patch,
      });
    };

    try {
      const test = await adapter.testConnection({ source, signal: controller.signal });
      this.store.updateSourceTestResult(sourceId, test.ok, test.message, test.testedAt);
      if (!test.ok) {
        this.fail(sourceId, test.message);
        return;
      }

      publishProgress(true, { phase: 'scanning' });

      for await (const item of adapter.scan({
        source,
        signal: controller.signal,
        rootPath: options.rootPath ?? null,
        onProgress: (entry) => {
          publishProgress(false, { currentPath: entry.path });
        },
        onError: (path, error) => {
          const message = `${path}: ${error.message}`;
          errors.push(message);
          failedCount += 1;
          publishProgress(false, { currentPath: path });
        },
      })) {
        if (controller.signal.aborted) {
          this.cancelled(sourceId, options);
          return;
        }

        seenPaths.add(item.path);
        discoveredCount += 1;
        itemsSinceYield += 1;
        publishProgress(false, { currentPath: item.path });

        const existing = fingerprints.get(item.path);
        const unchanged =
          existing &&
          existing.etag === item.etag &&
          existing.modifiedAt === item.modifiedAt &&
          existing.sizeBytes === item.sizeBytes;

        if (unchanged && existing.coverId) {
          skippedCount += 1;
          publishProgress();
          if (itemsSinceYield >= scanYieldItemDelta) {
            await yieldToMainLoop();
            itemsSinceYield = 0;
          }
          continue;
        }

        const metadata = item.metadata ?? this.createLayeredIndexMetadata(item.name);
        parsedCount += 1;
        batch.push({
          id: remoteTrackIdFor(sourceId, item.stableKey),
          sourceId,
          provider: source.provider,
          remotePath: item.path,
          remoteUrlHash: item.remoteUrlHash,
          stableKey: item.stableKey,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          albumArtist: metadata.albumArtist,
          trackNo: metadata.trackNo,
          discNo: metadata.discNo,
          year: metadata.year,
          genre: metadata.genre,
          duration: metadata.duration,
          codec: metadata.codec,
          sampleRate: metadata.sampleRate,
          bitDepth: metadata.bitDepth,
          bitrate: metadata.bitrate,
          sizeBytes: item.sizeBytes,
          modifiedAt: item.modifiedAt,
          etag: item.etag,
          coverId: null,
          coverStatus: 'pending',
          metadataStatus: metadata.status,
          lyricsStatus: 'pending',
          mvStatus: 'pending',
          availability: 'available',
          fieldSources: metadata.fieldSources,
        });

        if (batch.length >= batchSize) {
          publishProgress(true, { phase: 'writing_database' });
          writtenCount += await this.flush(sourceId, batch);
          batch = [];
          publishProgress(true, { phase: 'scanning' });
          await yieldToMainLoop();
          itemsSinceYield = 0;
        } else if (itemsSinceYield >= scanYieldItemDelta) {
          await yieldToMainLoop();
          itemsSinceYield = 0;
        }
      }

      publishProgress(true, { phase: 'writing_database' });
      writtenCount += await this.flush(sourceId, batch);
      await yieldToMainLoop();
      publishProgress(true, { phase: 'marking_missing' });
      const shouldMarkMissing = options.markMissing !== false && !options.rootPath;
      const missingCount = shouldMarkMissing ? this.store.markMissingExcept(sourceId, seenPaths) : 0;
      const finishedAt = nowIso();
      this.patchStatus(sourceId, {
        status: 'completed',
        phase: 'finished',
        discoveredCount,
        parsedCount,
        writtenCount,
        skippedCount,
        missingCount,
        failedCount,
        errors: errors.slice(-20),
        currentPath: null,
        finishedAt,
      });
      this.store.updateSourceSyncResult(sourceId, failedCount === 0, errors[0] ?? null, finishedAt);
      this.notifySyncSettled(sourceId, options);
    } catch (error) {
      if (controller.signal.aborted) {
        this.cancelled(sourceId, options);
        return;
      }

      this.fail(sourceId, error instanceof Error ? error.message : String(error), options);
    }
  }

  private async flush(sourceId: string, batch: RemoteTrackWrite[]): Promise<number> {
    if (batch.length === 0) {
      return 0;
    }

    this.store.upsertTracks(batch, await this.store.prepareSearchTermsForTracks(batch));
    this.onTracksIndexed(sourceId, batch);
    return batch.length;
  }

  private createLayeredIndexMetadata(fileName: string): {
    status: 'pending';
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    trackNo: null;
    discNo: null;
    year: null;
    genre: null;
    duration: null;
    codec: null;
    sampleRate: null;
    bitDepth: null;
    bitrate: null;
    fieldSources: Record<string, string>;
  } {
    const title = fileName.replace(/\.[^.]+$/u, '').replace(/[_-]+/g, ' ').trim() || fileName;

    return {
      status: 'pending',
      title,
      artist: 'Unknown Artist',
      album: '',
      albumArtist: 'Unknown Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: null,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      fieldSources: {
        title: 'filename_fallback',
        artist: 'filename_fallback',
        album: 'filename_fallback',
        albumArtist: 'filename_fallback',
      },
    };
  }

  private fail(sourceId: string, message: string, options: RemoteSyncOptions = {}): void {
    const finishedAt = nowIso();
    this.patchStatus(sourceId, {
      status: 'failed',
      phase: 'failed',
      failedCount: this.getSyncStatus(sourceId).failedCount + 1,
      errors: [...this.getSyncStatus(sourceId).errors, message].slice(-20),
      currentPath: null,
      finishedAt,
    });
    this.store.updateSourceSyncResult(sourceId, false, message, finishedAt);
    this.notifySyncSettled(sourceId, options);
  }

  private cancelled(sourceId: string, options: RemoteSyncOptions = {}): void {
    this.patchStatus(sourceId, {
      status: 'cancelled',
      phase: 'cancelled',
      currentPath: null,
      finishedAt: nowIso(),
    });
    this.notifySyncSettled(sourceId, options);
  }

  private notifySyncSettled(sourceId: string, options: RemoteSyncOptions): void {
    try {
      this.onSyncSettled(sourceId, this.getSyncStatus(sourceId), options);
    } catch {
      // Status cleanup is best-effort; sync completion itself has already been recorded.
    }
  }

  private patchStatus(sourceId: string, patch: Partial<RemoteSyncStatus>): void {
    this.setStatus(sourceId, {
      ...this.getSyncStatus(sourceId),
      ...patch,
    });
  }

  private setStatus(sourceId: string, status: RemoteSyncStatus): void {
    this.statuses.set(sourceId, status);
  }
}
