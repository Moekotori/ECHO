import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BPM_CONFIDENCE_THRESHOLD } from '../../../shared/constants/audioAnalysis';
import type { LibraryStore } from '../LibraryStore';
import type { BpmAnalysisJobStatus, BpmAnalysisStartOptions, LibraryTrack } from '../libraryTypes';
import { writeEmbeddedBpmTag } from '../TagWriter';
import { BpmAnalyzer } from './BpmAnalyzer';

type MutableJobStatus = BpmAnalysisJobStatus;

const maxStoredErrors = 100;
const defaultLimit = 100;
const defaultTagWriteRetryDelayMs = 5000;
const defaultTagWriteMaxAttempts = 120;

const nowIso = (): string => new Date().toISOString();

type BpmTagWriter = (filePath: string, bpm: number) => Promise<void>;
type BpmTagWriteDelayPredicate = (filePath: string) => Promise<boolean>;

export class BpmAnalysisJobQueue {
  private readonly analyzer: BpmAnalyzer;
  private readonly writeBpmTag: BpmTagWriter;
  private readonly shouldDelayTagWrite: BpmTagWriteDelayPredicate;
  private readonly tagWriteRetryDelayMs: number;
  private readonly tagWriteMaxAttempts: number;
  private readonly jobs = new Map<string, MutableJobStatus>();
  private runningJob: Promise<void> | null = null;

  constructor(
    private readonly store: LibraryStore,
    dependencies: {
      analyzer?: BpmAnalyzer;
      writeBpmTag?: BpmTagWriter;
      shouldDelayTagWrite?: BpmTagWriteDelayPredicate;
      tagWriteRetryDelayMs?: number;
      tagWriteMaxAttempts?: number;
    } = {},
  ) {
    this.analyzer = dependencies.analyzer ?? new BpmAnalyzer();
    this.writeBpmTag = dependencies.writeBpmTag ?? writeEmbeddedBpmTag;
    this.shouldDelayTagWrite = dependencies.shouldDelayTagWrite ?? shouldDelayBpmTagWriteForAudio;
    this.tagWriteRetryDelayMs = Math.max(10, Math.floor(dependencies.tagWriteRetryDelayMs ?? defaultTagWriteRetryDelayMs));
    this.tagWriteMaxAttempts = Math.max(1, Math.floor(dependencies.tagWriteMaxAttempts ?? defaultTagWriteMaxAttempts));
  }

  start(options: BpmAnalysisStartOptions = {}): BpmAnalysisJobStatus {
    const id = randomUUID();
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? defaultLimit)));
    const targets = this.store.findBpmAnalysisTargets(limit, options.trackIds, options.force === true);
    const job: MutableJobStatus = {
      id,
      status: 'queued',
      totalTracks: targets.length,
      processedTracks: 0,
      updatedTracks: 0,
      errorCount: 0,
      currentTrackTitle: null,
      startedAt: nowIso(),
      finishedAt: null,
      errors: [],
    };
    this.jobs.set(id, job);

    const run = async (): Promise<void> => {
      if (this.runningJob) {
        await this.runningJob.catch(() => undefined);
      }
      await this.runJob(job, targets);
    };

    this.runningJob = run().finally(() => {
      if (this.runningJob) {
        this.runningJob = null;
      }
    });

    return { ...job };
  }

  getStatus(jobId: string): BpmAnalysisJobStatus {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown BPM analysis job ${jobId}`);
    }
    return { ...job, errors: [...job.errors] };
  }

  private async runJob(job: MutableJobStatus, tracks: LibraryTrack[]): Promise<void> {
    job.status = 'running';
    try {
      for (const track of tracks) {
        job.currentTrackTitle = track.title;
        this.store.markTrackAnalyzing(track.id);
        try {
          if (!existsSync(track.path)) {
            throw new Error('track_file_missing');
          }

          const result = await this.analyzer.analyze(track.path, track.duration);
          const status = result.confidence >= BPM_CONFIDENCE_THRESHOLD ? 'complete' : 'low_confidence';
          const bpm = result.bpm > 0 && status === 'complete' ? result.bpm : null;
          const beatOffsetMs = result.beatOffsetMs >= 0 && status === 'complete' ? result.beatOffsetMs : null;
          this.store.updateTrackBpmAnalysis(track.id, {
            bpm,
            confidence: result.confidence,
            beatOffsetMs,
            status,
          });
          if (bpm) {
            this.scheduleBpmTagWrite(track.path, bpm, job);
          }
          job.updatedTracks += bpm ? 1 : 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.store.updateTrackBpmAnalysis(track.id, {
            bpm: null,
            confidence: 0,
            beatOffsetMs: null,
            status: 'error',
            error: message,
          });
          this.pushError(job, `${track.path}: ${message}`);
        } finally {
          job.processedTracks += 1;
        }
      }

      job.status = 'completed';
      job.finishedAt = nowIso();
      job.currentTrackTitle = null;
    } catch (error) {
      this.pushError(job, error instanceof Error ? error.message : String(error));
      job.status = 'failed';
      job.finishedAt = nowIso();
    }
  }

  private pushError(job: MutableJobStatus, message: string): void {
    job.errorCount += 1;
    job.errors.push(message);
    if (job.errors.length > maxStoredErrors) {
      job.errors.shift();
    }
  }

  private scheduleBpmTagWrite(filePath: string, bpm: number, job: MutableJobStatus): void {
    const attempt = async (attemptIndex: number): Promise<void> => {
      try {
        if (await this.shouldDelayTagWrite(filePath)) {
          this.retryBpmTagWrite(filePath, bpm, job, attemptIndex, null);
          return;
        }

        await this.writeBpmTag(filePath, bpm);
      } catch (error) {
        this.retryBpmTagWrite(filePath, bpm, job, attemptIndex, error);
      }
    };

    void attempt(0);
  }

  private retryBpmTagWrite(filePath: string, bpm: number, job: MutableJobStatus, attemptIndex: number, error: unknown): void {
    const nextAttempt = attemptIndex + 1;
    if (nextAttempt >= this.tagWriteMaxAttempts) {
      const reason = error instanceof Error ? error.message : error ? String(error) : 'audio_file_still_busy';
      this.pushError(job, `${filePath}: tag: ${reason}`);
      return;
    }

    const retryTimer = setTimeout(() => {
      this.scheduleBpmTagWriteAttempt(filePath, bpm, job, nextAttempt);
    }, this.tagWriteRetryDelayMs);
    retryTimer.unref?.();
  }

  private scheduleBpmTagWriteAttempt(filePath: string, bpm: number, job: MutableJobStatus, attemptIndex: number): void {
    const attempt = async (): Promise<void> => {
      try {
        if (await this.shouldDelayTagWrite(filePath)) {
          this.retryBpmTagWrite(filePath, bpm, job, attemptIndex, null);
          return;
        }

        await this.writeBpmTag(filePath, bpm);
      } catch (error) {
        this.retryBpmTagWrite(filePath, bpm, job, attemptIndex, error);
      }
    };

    void attempt();
  }
}

const shouldDelayBpmTagWriteForAudio = async (filePath: string): Promise<boolean> => {
  try {
    const { getAudioSession } = await import('../../audio/AudioSession');
    const status = getAudioSession().getStatus();
    const currentFileHeld =
      resolve(status.currentFilePath ?? '') === resolve(filePath) &&
      status.state !== 'idle' &&
      status.state !== 'stopped' &&
      status.state !== 'ended' &&
      status.state !== 'error';

    return status.state === 'loading' || status.state === 'playing' || currentFileHeld;
  } catch {
    return false;
  }
};
