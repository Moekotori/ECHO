import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToMainLoop, setTimeout as delay } from 'node:timers/promises';
import type { EchoDatabase } from '../database/createDatabase';
import type { LyricsProviderId, TrackLyrics } from '../../shared/types/lyrics';
import type {
  LibraryPage,
  LibraryPageQuery,
  LibraryTrack,
  LyricsBackfillJobStatus,
  LyricsBackfillMode,
  LyricsBackfillStartOptions,
} from './libraryTypes';
import type { LyricsLookupOptions } from '../lyrics/LyricsService';

type MutableJobStatus = LyricsBackfillJobStatus;

type LyricsServiceLike = {
  hasCachedLyricsForTrack: (trackId: string) => boolean;
  hasCachedLyricsForTrackIds?: (trackIds: string[]) => Set<string>;
  getLyricsForTrack: (trackId: string, options?: LyricsLookupOptions) => Promise<TrackLyrics | null>;
};

type LyricsBackfillModeDefaults = {
  limit: number;
  concurrency: number;
  lookupOptions: LyricsLookupOptions;
  perTrackDelayMs: number;
};

type NormalizedLyricsBackfillRunOptions = Required<
  Pick<LyricsBackfillStartOptions, 'mode' | 'limit' | 'concurrency' | 'autoAcceptScore'>
> & {
  force: boolean;
};

type PersistedLyricsBackfillJob = {
  status: LyricsBackfillJobStatus;
  options: NormalizedLyricsBackfillRunOptions;
  targetIds: string[];
  attemptedTrackIds: string[];
};

type LyricsBackfillQueueDependencies = {
  getLyricsService?: () => Promise<LyricsServiceLike>;
  persistence?: LyricsBackfillJobPersistence | null;
  isPlaybackActive?: () => boolean | Promise<boolean>;
};

type LyricsBackfillJobRow = {
  id: string;
  status_json: string;
  options_json: string;
  target_ids_json: string;
};

type LyricsBackfillAttemptRow = {
  track_id: string;
};

const maxStoredErrors = 100;
const maxLimit = 20000;
const pageSize = 500;
const defaultBackfillAutoAcceptScore = 0.45;
const playbackConcurrency = 4;
const playbackSlotWaitMs = 500;
const playbackInterTrackDelayMs = 150;
const statusPersistIntervalMs = 750;
const attemptedFlushSize = 50;
const quickProviders: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic', 'amll-ttml', 'kugou', 'kuwo'];
const completeProviders: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic', 'amll-ttml', 'kugou', 'kuwo'];
const modeDefaults: Record<LyricsBackfillMode, LyricsBackfillModeDefaults> = {
  quick: {
    limit: 10000,
    concurrency: 10,
    lookupOptions: {
      enabledProviders: quickProviders,
      networkEnabled: true,
      autoSearch: true,
      deepSearchEnabled: true,
      providerTimeoutMs: 2300,
      totalMatchTimeoutMs: 4200,
      autoAcceptScore: defaultBackfillAutoAcceptScore,
      preferPrimaryProvider: false,
    },
    perTrackDelayMs: 0,
  },
  complete: {
    limit: 10000,
    concurrency: 6,
    lookupOptions: {
      enabledProviders: completeProviders,
      networkEnabled: true,
      autoSearch: true,
      deepSearchEnabled: true,
      providerTimeoutMs: 3500,
      totalMatchTimeoutMs: 7000,
      autoAcceptScore: defaultBackfillAutoAcceptScore,
      preferPrimaryProvider: false,
    },
    perTrackDelayMs: 0,
  },
};

const nowIso = (): string => new Date().toISOString();

const getDefaultLyricsService = async (): Promise<LyricsServiceLike> => {
  const lyrics = await import('../lyrics/LyricsService');
  return lyrics.getLyricsService();
};

const isDefaultPlaybackActive = async (): Promise<boolean> => {
  try {
    const { getAudioSession } = await import('../audio/AudioSession');
    const state = getAudioSession().getStatus().state;
    return state === 'loading' || state === 'playing';
  } catch {
    return false;
  }
};

const normalizeMode = (value: unknown): LyricsBackfillMode => (value === 'complete' ? 'complete' : 'quick');

const normalizeLimit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maxLimit, Math.floor(parsed))) : fallback;
};

const normalizeConcurrency = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(24, Math.floor(parsed))) : fallback;
};

const normalizeAutoAcceptScore = (value: unknown, fallback = defaultBackfillAutoAcceptScore): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.3, Math.min(0.95, parsed)) : fallback;
};

const isUsableLyrics = (lyrics: TrackLyrics | null): boolean =>
  Boolean(lyrics && lyrics.kind !== 'empty');

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalizeRunOptions = (options: LyricsBackfillStartOptions = {}): NormalizedLyricsBackfillRunOptions => {
  const mode = normalizeMode(options.mode);
  const defaults = modeDefaults[mode];
  return {
    mode,
    limit: normalizeLimit(options.limit, defaults.limit),
    concurrency: normalizeConcurrency(options.concurrency, defaults.concurrency),
    autoAcceptScore: normalizeAutoAcceptScore(options.autoAcceptScore, defaults.lookupOptions.autoAcceptScore ?? defaultBackfillAutoAcceptScore),
    force: options.force === true,
  };
};

const lookupOptionsFor = (mode: LyricsBackfillMode, autoAcceptScore: number): LyricsLookupOptions => ({
  ...modeDefaults[mode].lookupOptions,
  autoAcceptScore,
  relaxedAutoAccept: true,
});

export class LyricsBackfillJobPersistence {
  constructor(private readonly database: EchoDatabase) {
    this.ensureTables();
  }

  saveJob(status: LyricsBackfillJobStatus, options: NormalizedLyricsBackfillRunOptions): void {
    const updatedAt = nowIso();
    this.database
      .prepare(
        `INSERT INTO lyrics_backfill_jobs (
          id, mode, status, phase, status_json, options_json, target_ids_json,
          created_at, updated_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          status = excluded.status,
          phase = excluded.phase,
          status_json = excluded.status_json,
          options_json = excluded.options_json,
          updated_at = excluded.updated_at,
          finished_at = excluded.finished_at`,
      )
      .run(
        status.id,
        status.mode,
        status.status,
        status.phase,
        JSON.stringify(status),
        JSON.stringify(options),
        status.startedAt,
        updatedAt,
        status.finishedAt,
      );
  }

  saveTargetIds(jobId: string, trackIds: string[]): void {
    this.database
      .prepare('UPDATE lyrics_backfill_jobs SET target_ids_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify([...new Set(trackIds)]), nowIso(), jobId);
  }

  markTrackAttempted(jobId: string, trackId: string): void {
    this.database
      .prepare(
        `INSERT INTO lyrics_backfill_job_attempts (job_id, track_id, status, updated_at)
         VALUES (?, ?, 'processed', ?)
         ON CONFLICT(job_id, track_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(jobId, trackId, nowIso());
  }

  markTracksAttempted(jobId: string, trackIds: string[]): void {
    const uniqueIds = [...new Set(trackIds)].filter((trackId) => trackId.trim().length > 0);
    if (!uniqueIds.length) {
      return;
    }

    const updatedAt = nowIso();
    const statement = this.database.prepare(
      `INSERT INTO lyrics_backfill_job_attempts (job_id, track_id, status, updated_at)
       VALUES (?, ?, 'processed', ?)
       ON CONFLICT(job_id, track_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    );
    const insertMany = this.database.transaction((ids: string[]) => {
      for (const trackId of ids) {
        statement.run(jobId, trackId, updatedAt);
      }
    });
    insertMany(uniqueIds);
  }

  loadLatestStatus(): LyricsBackfillJobStatus | null {
    const row = this.database
      .prepare<unknown[], Pick<LyricsBackfillJobRow, 'status_json'>>(
        'SELECT status_json FROM lyrics_backfill_jobs ORDER BY updated_at DESC LIMIT 1',
      )
      .get();
    return row ? parseJson<LyricsBackfillJobStatus | null>(row.status_json, null) : null;
  }

  loadLatestResumableJob(): PersistedLyricsBackfillJob | null {
    const row = this.database
      .prepare<unknown[], LyricsBackfillJobRow>(
        `SELECT id, status_json, options_json, target_ids_json
         FROM lyrics_backfill_jobs
         WHERE status IN ('queued', 'running')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get();
    if (!row) {
      return null;
    }

    const status = parseJson<LyricsBackfillJobStatus | null>(row.status_json, null);
    if (!status) {
      return null;
    }

    const storedOptions = parseJson<LyricsBackfillStartOptions>(row.options_json, {});
    const attemptedRows = this.database
      .prepare<[string], LyricsBackfillAttemptRow>('SELECT track_id FROM lyrics_backfill_job_attempts WHERE job_id = ?')
      .all(row.id);

    return {
      status,
      options: normalizeRunOptions(storedOptions),
      targetIds: parseJson<string[]>(row.target_ids_json, []).filter((trackId): trackId is string => typeof trackId === 'string'),
      attemptedTrackIds: attemptedRows.map((attempt) => attempt.track_id),
    };
  }

  private ensureTables(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS lyrics_backfill_jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        status_json TEXT NOT NULL,
        options_json TEXT NOT NULL,
        target_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_lyrics_backfill_jobs_status_updated
        ON lyrics_backfill_jobs(status, updated_at);

      CREATE TABLE IF NOT EXISTS lyrics_backfill_job_attempts (
        job_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (job_id, track_id),
        FOREIGN KEY (job_id) REFERENCES lyrics_backfill_jobs(id) ON DELETE CASCADE
      );
    `);
  }
}

export class LyricsBackfillJobQueue {
  private readonly jobs = new Map<string, MutableJobStatus>();
  private readonly runOptions = new Map<string, NormalizedLyricsBackfillRunOptions>();
  private readonly targetTrackIds = new Map<string, string[]>();
  private readonly attemptedTrackIds = new Map<string, Set<string>>();
  private readonly cancelledJobs = new Set<string>();
  private readonly getLyricsService: () => Promise<LyricsServiceLike>;
  private readonly persistence: LyricsBackfillJobPersistence | null;
  private readonly isPlaybackActive: () => boolean | Promise<boolean>;
  private readonly lastPersistedAt = new Map<string, number>();
  private readonly pendingAttemptedTrackIds = new Map<string, Set<string>>();
  private runningJob: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly listTracks: (query?: LibraryPageQuery) => LibraryPage<LibraryTrack>,
    dependencies: LyricsBackfillQueueDependencies | (() => Promise<LyricsServiceLike>) = {},
  ) {
    if (typeof dependencies === 'function') {
      this.getLyricsService = dependencies;
      this.persistence = null;
      this.isPlaybackActive = isDefaultPlaybackActive;
      return;
    }

    this.getLyricsService = dependencies.getLyricsService ?? getDefaultLyricsService;
    this.persistence = dependencies.persistence ?? null;
    this.isPlaybackActive = dependencies.isPlaybackActive ?? isDefaultPlaybackActive;
  }

  start(options: LyricsBackfillStartOptions = {}): LyricsBackfillJobStatus {
    const activeJob = this.activeJob();
    if (activeJob) {
      return this.snapshot(activeJob);
    }

    const runOptions = normalizeRunOptions(options);
    const id = randomUUID();
    const job = this.createJob(id, runOptions);
    this.jobs.set(id, job);
    this.runOptions.set(id, runOptions);
    this.attemptedTrackIds.set(id, new Set());
    this.persistJob(job, true);
    this.enqueueRun(job, runOptions);

    return this.snapshot(job);
  }

  resumeLastIncompleteJob(): LyricsBackfillJobStatus | null {
    const activeJob = this.activeJob();
    if (activeJob) {
      return this.snapshot(activeJob);
    }

    const persisted = this.persistence?.loadLatestResumableJob();
    if (!persisted) {
      return this.getCurrentStatus();
    }

    const job: MutableJobStatus = {
      ...persisted.status,
      status: 'queued',
      phase: persisted.targetIds.length > 0 ? 'matching' : 'collecting',
      currentTrackTitle: null,
      finishedAt: null,
      autoAcceptScore: persisted.options.autoAcceptScore,
      playbackThrottled: false,
    };
    this.jobs.set(job.id, job);
    this.runOptions.set(job.id, persisted.options);
    this.targetTrackIds.set(job.id, persisted.targetIds);
    this.attemptedTrackIds.set(job.id, new Set(persisted.attemptedTrackIds));
    this.persistJob(job, true);
    this.enqueueRun(job, persisted.options);
    return this.snapshot(job);
  }

  getCurrentStatus(): LyricsBackfillJobStatus | null {
    const activeJob = this.activeJob();
    if (activeJob) {
      return this.snapshot(activeJob);
    }

    const latestMemoryJob = Array.from(this.jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return latestMemoryJob ? this.snapshot(latestMemoryJob) : this.persistence?.loadLatestStatus() ?? null;
  }

  getStatus(jobId: string): LyricsBackfillJobStatus {
    const job = this.jobs.get(jobId);
    if (job) {
      return this.snapshot(job);
    }

    const latest = this.persistence?.loadLatestStatus();
    if (latest?.id === jobId) {
      return latest;
    }

    throw new Error(`Unknown lyrics backfill job ${jobId}`);
  }

  cancel(jobId: string): LyricsBackfillJobStatus {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown lyrics backfill job ${jobId}`);
    }

    if (job.status === 'queued' || job.status === 'running') {
      this.cancelledJobs.add(jobId);
      job.status = 'cancelled';
      job.phase = 'finished';
      job.currentTrackTitle = null;
      job.playbackThrottled = false;
      job.finishedAt = nowIso();
      this.flushAttemptedTrackIds(job.id);
      this.persistJob(job, true);
    }

    return this.snapshot(job);
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'queued';
        job.currentTrackTitle = null;
        job.playbackThrottled = false;
        this.flushAttemptedTrackIds(job.id);
        this.persistJob(job, true);
      }
    }
  }

  private createJob(id: string, options: NormalizedLyricsBackfillRunOptions): MutableJobStatus {
    return {
      id,
      mode: options.mode,
      status: 'queued',
      phase: 'queued',
      autoAcceptScore: options.autoAcceptScore,
      playbackThrottled: false,
      totalTracks: 0,
      scannedTracks: 0,
      processedTracks: 0,
      matchedTracks: 0,
      alreadyCachedTracks: 0,
      notFoundTracks: 0,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: nowIso(),
      finishedAt: null,
      errors: [],
    };
  }

  private activeJob(): MutableJobStatus | null {
    return Array.from(this.jobs.values()).find((job) => job.status === 'queued' || job.status === 'running') ?? null;
  }

  private enqueueRun(job: MutableJobStatus, options: NormalizedLyricsBackfillRunOptions): void {
    const run = async (): Promise<void> => {
      if (this.runningJob) {
        await this.runningJob.catch(() => undefined);
      }
      await this.runJob(job, options);
    };

    this.runningJob = run().finally(() => {
      if (this.runningJob) {
        this.runningJob = null;
      }
    });
  }

  private async runJob(job: MutableJobStatus, options: NormalizedLyricsBackfillRunOptions): Promise<void> {
    if (this.disposed) {
      return;
    }

    job.status = 'running';
    job.phase = job.phase === 'queued' ? 'collecting' : job.phase;
    this.persistJob(job);

    try {
      const lyricsService = await this.getLyricsService();
      const targets = await this.resolveTargets(job, lyricsService, options);

      if (this.disposed) {
        return;
      }

      if (this.isCancelled(job) || targets.length === 0) {
        this.finishJob(job, this.isCancelled(job) ? 'cancelled' : 'completed');
        return;
      }

      job.phase = 'matching';
      this.persistJob(job);
      await this.runWorkers(job, targets, lyricsService, options);
      if (!this.disposed) {
        this.finishJob(job, this.isCancelled(job) ? 'cancelled' : 'completed');
      }
    } catch (error) {
      if (this.disposed) {
        return;
      }

      this.pushError(job, error instanceof Error ? error.message : String(error));
      this.finishJob(job, 'failed');
    }
  }

  private async resolveTargets(
    job: MutableJobStatus,
    lyricsService: LyricsServiceLike,
    options: NormalizedLyricsBackfillRunOptions,
  ): Promise<LibraryTrack[]> {
    const storedTargetIds = this.targetTrackIds.get(job.id) ?? [];
    if (storedTargetIds.length > 0) {
      job.totalTracks = Math.max(job.totalTracks, storedTargetIds.length);
      const targets = await this.collectStoredTargets(job, storedTargetIds);
      this.persistJob(job);
      return targets;
    }

    job.phase = 'collecting';
    this.persistJob(job);
    const targets = await this.collectTargets(job, lyricsService, options.limit, options.force);
    const targetIds = targets.map((track) => track.id);
    this.targetTrackIds.set(job.id, targetIds);
    this.persistence?.saveTargetIds(job.id, targetIds);
    job.totalTracks = targetIds.length;
    this.persistJob(job);
    return targets;
  }

  private async collectTargets(
    job: MutableJobStatus,
    lyricsService: LyricsServiceLike,
    limit: number,
    force: boolean,
  ): Promise<LibraryTrack[]> {
    const targets: LibraryTrack[] = [];
    let page = 1;

    while (!this.disposed && !this.isCancelled(job) && targets.length < limit) {
      const result = this.listTracks({ page, pageSize, sort: 'titleAsc' });
      const cachedTrackIds = force ? new Set<string>() : this.hasCachedLyricsForTracks(lyricsService, result.items);
      for (const track of result.items) {
        job.scannedTracks += 1;
        if (cachedTrackIds.has(track.id)) {
          job.alreadyCachedTracks += 1;
          continue;
        }

        targets.push(track);
        if (targets.length >= limit) {
          break;
        }
      }

      this.persistJob(job);

      if (!result.hasMore || result.items.length === 0) {
        break;
      }

      page += 1;
      await yieldToMainLoop();
    }

    return targets;
  }

  private async collectStoredTargets(job: MutableJobStatus, storedTargetIds: string[]): Promise<LibraryTrack[]> {
    const attempted = this.attemptedTrackIds.get(job.id) ?? new Set<string>();
    const remainingIds = storedTargetIds.filter((trackId) => !attempted.has(trackId));
    const remainingSet = new Set(remainingIds);
    const tracksById = new Map<string, LibraryTrack>();
    let page = 1;

    while (!this.disposed && !this.isCancelled(job) && remainingSet.size > 0) {
      const result = this.listTracks({ page, pageSize, sort: 'titleAsc' });
      for (const track of result.items) {
        if (remainingSet.has(track.id)) {
          tracksById.set(track.id, track);
          remainingSet.delete(track.id);
        }
      }

      if (!result.hasMore || result.items.length === 0) {
        break;
      }

      page += 1;
      await yieldToMainLoop();
    }

    for (const missingId of remainingIds) {
      if (!tracksById.has(missingId) && !attempted.has(missingId)) {
        attempted.add(missingId);
        job.processedTracks += 1;
        job.notFoundTracks += 1;
        this.queueAttemptedTrackId(job.id, missingId);
      }
    }

    this.attemptedTrackIds.set(job.id, attempted);
    return remainingIds.map((trackId) => tracksById.get(trackId)).filter((track): track is LibraryTrack => Boolean(track));
  }

  private async runWorkers(
    job: MutableJobStatus,
    targets: LibraryTrack[],
    lyricsService: LyricsServiceLike,
    options: NormalizedLyricsBackfillRunOptions,
  ): Promise<void> {
    const defaults = modeDefaults[options.mode];
    const lookupOptions = lookupOptionsFor(options.mode, options.autoAcceptScore);
    let nextIndex = 0;
    let activeLookups = 0;

    const acquireLookupSlot = async (): Promise<boolean> => {
      for (;;) {
        if (this.disposed || this.isCancelled(job)) {
          return false;
        }

        const playbackActive = await this.readPlaybackActive();
        this.setPlaybackThrottled(job, playbackActive);
        const limit = playbackActive ? Math.min(playbackConcurrency, options.concurrency) : options.concurrency;
        if (activeLookups < limit) {
          activeLookups += 1;
          return true;
        }

        await delay(playbackActive ? playbackSlotWaitMs : 25);
      }
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.disposed || this.isCancelled(job)) {
          return;
        }

        const index = nextIndex;
        nextIndex += 1;
        const track = targets[index];
        if (!track) {
          return;
        }

        const acquired = await acquireLookupSlot();
        if (!acquired) {
          return;
        }

        try {
          await this.processTrack(job, track, lyricsService, lookupOptions);
        } finally {
          activeLookups = Math.max(0, activeLookups - 1);
        }

        if (this.disposed || this.isCancelled(job)) {
          return;
        }

        if (job.playbackThrottled) {
          await delay(playbackInterTrackDelayMs);
        } else if (defaults.perTrackDelayMs > 0) {
          await delay(defaults.perTrackDelayMs);
        } else {
          await yieldToMainLoop();
        }
      }
    };

    const workerCount = Math.min(options.concurrency, Math.max(1, targets.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  private async processTrack(
    job: MutableJobStatus,
    track: LibraryTrack,
    lyricsService: LyricsServiceLike,
    lookupOptions: LyricsLookupOptions,
  ): Promise<void> {
    job.currentTrackTitle = track.title;
    this.persistJob(job);

    try {
      const lyrics = await lyricsService.getLyricsForTrack(track.id, lookupOptions);
      if (isUsableLyrics(lyrics)) {
        job.matchedTracks += 1;
      } else {
        job.notFoundTracks += 1;
      }
    } catch (error) {
      this.pushError(job, `${track.title || track.path}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.disposed) {
        return;
      }

      job.processedTracks += 1;
      const attempted = this.attemptedTrackIds.get(job.id) ?? new Set<string>();
      attempted.add(track.id);
      this.attemptedTrackIds.set(job.id, attempted);
      this.queueAttemptedTrackId(job.id, track.id);
      this.persistJob(job);
    }
  }

  private hasCachedLyrics(lyricsService: LyricsServiceLike, track: LibraryTrack): boolean {
    try {
      return lyricsService.hasCachedLyricsForTrack(track.id);
    } catch {
      return false;
    }
  }

  private hasCachedLyricsForTracks(lyricsService: LyricsServiceLike, tracks: LibraryTrack[]): Set<string> {
    const trackIds = tracks.map((track) => track.id).filter(Boolean);
    if (!trackIds.length) {
      return new Set();
    }

    try {
      if (lyricsService.hasCachedLyricsForTrackIds) {
        return lyricsService.hasCachedLyricsForTrackIds(trackIds);
      }
    } catch {
      return new Set();
    }

    return new Set(tracks.filter((track) => this.hasCachedLyrics(lyricsService, track)).map((track) => track.id));
  }

  private queueAttemptedTrackId(jobId: string, trackId: string): void {
    const pending = this.pendingAttemptedTrackIds.get(jobId) ?? new Set<string>();
    pending.add(trackId);
    this.pendingAttemptedTrackIds.set(jobId, pending);
    if (pending.size >= attemptedFlushSize) {
      this.flushAttemptedTrackIds(jobId);
    }
  }

  private flushAttemptedTrackIds(jobId: string): void {
    const pending = this.pendingAttemptedTrackIds.get(jobId);
    if (!pending?.size || !this.persistence) {
      return;
    }

    const trackIds = [...pending];
    pending.clear();
    const batchPersistence = this.persistence as LyricsBackfillJobPersistence & {
      markTracksAttempted?: (persistedJobId: string, persistedTrackIds: string[]) => void;
    };
    if (batchPersistence.markTracksAttempted) {
      batchPersistence.markTracksAttempted(jobId, trackIds);
      return;
    }

    for (const trackId of trackIds) {
      this.persistence.markTrackAttempted(jobId, trackId);
    }
  }

  private async readPlaybackActive(): Promise<boolean> {
    try {
      return Boolean(await this.isPlaybackActive());
    } catch {
      return false;
    }
  }

  private setPlaybackThrottled(job: MutableJobStatus, playbackThrottled: boolean): void {
    if (job.playbackThrottled === playbackThrottled) {
      return;
    }

    job.playbackThrottled = playbackThrottled;
    this.persistJob(job);
  }

  private isCancelled(job: MutableJobStatus): boolean {
    return this.cancelledJobs.has(job.id) || job.status === 'cancelled';
  }

  private finishJob(job: MutableJobStatus, status: MutableJobStatus['status']): void {
    job.status = status;
    job.phase = 'finished';
    job.currentTrackTitle = null;
    job.playbackThrottled = false;
    job.finishedAt = nowIso();
    this.cancelledJobs.delete(job.id);
    this.flushAttemptedTrackIds(job.id);
    this.persistJob(job, true);
  }

  private pushError(job: MutableJobStatus, message: string): void {
    job.errorCount += 1;
    job.errors.push(message);
    if (job.errors.length > maxStoredErrors) {
      job.errors.shift();
    }
  }

  private persistJob(job: MutableJobStatus, force = false): void {
    const options = this.runOptions.get(job.id);
    if (!options) {
      return;
    }

    const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    const now = Date.now();
    const lastPersistedAt = this.lastPersistedAt.get(job.id) ?? 0;
    if (!force && !terminal && now - lastPersistedAt < statusPersistIntervalMs) {
      return;
    }

    this.persistence?.saveJob(this.snapshot(job), options);
    this.lastPersistedAt.set(job.id, now);
  }

  private snapshot(job: MutableJobStatus): LyricsBackfillJobStatus {
    return {
      ...job,
      errors: [...job.errors],
    };
  }
}
