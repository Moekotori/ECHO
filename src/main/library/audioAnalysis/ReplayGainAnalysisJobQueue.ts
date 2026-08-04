import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../../../shared/constants/replayGain';
import type { LibraryStore } from '../LibraryStore';
import type { LibraryTrack, ReplayGainAnalysisJobStatus, ReplayGainAnalysisStartOptions } from '../libraryTypes';
import { ReplayGainAnalyzer } from './ReplayGainAnalyzer';

type MutableJobStatus = ReplayGainAnalysisJobStatus;

const maxStoredErrors = 100;
const defaultLimit = 100;
const nowIso = (): string => new Date().toISOString();

export class ReplayGainAnalysisJobQueue {
  private readonly analyzer: ReplayGainAnalyzer;
  private readonly jobs = new Map<string, MutableJobStatus>();
  private runningJob: Promise<void> | null = null;

  constructor(
    private readonly store: LibraryStore,
    dependencies: {
      analyzer?: ReplayGainAnalyzer;
      getTargetLufs?: () => number;
    } = {},
  ) {
    this.analyzer = dependencies.analyzer ?? new ReplayGainAnalyzer();
    this.getTargetLufs = dependencies.getTargetLufs ?? (() => DEFAULT_REPLAY_GAIN_TARGET_LUFS);
  }

  private readonly getTargetLufs: () => number;

  start(options: ReplayGainAnalysisStartOptions = {}): ReplayGainAnalysisJobStatus {
    const id = randomUUID();
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? defaultLimit)));
    const targets = this.store.findReplayGainAnalysisTargets(limit, options.trackIds, options.force === true);
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

  getStatus(jobId: string): ReplayGainAnalysisJobStatus {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown ReplayGain analysis job ${jobId}`);
    }
    return { ...job, errors: [...job.errors] };
  }

  private async runJob(job: MutableJobStatus, tracks: LibraryTrack[]): Promise<void> {
    job.status = 'running';
    try {
      for (const track of tracks) {
        job.currentTrackTitle = track.title;
        this.store.markTrackReplayGainAnalyzing(track.id);
        try {
          if (!existsSync(track.path)) {
            throw new Error('track_file_missing');
          }

          const result = await this.analyzer.analyze(track.path, track.duration, this.getTargetLufs());
          this.store.updateTrackReplayGainAnalysis(track.id, {
            trackGainDb: result.trackGainDb,
            trackPeak: result.trackPeak,
            integratedLufs: result.integratedLufs,
            status: 'complete',
          });
          job.updatedTracks += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.store.updateTrackReplayGainAnalysis(track.id, {
            trackGainDb: null,
            trackPeak: null,
            integratedLufs: null,
            status: message === 'replay_gain_loudness_unavailable' ? 'missing' : 'error',
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
}

