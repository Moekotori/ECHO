import { randomUUID } from 'node:crypto';
import type { EchoDatabase } from '../../database/createDatabase';
import type {
  MissingMetadataScanItem,
  MissingMetadataScanResult,
  MissingMetadataField,
  NetworkMetadataDiagnostics,
  NetworkMetadataScanJobStatus,
  NetworkApplyOptions,
  LyricsBackgroundCoverResult,
  NetworkTagCandidate,
  NetworkTagCandidateSearchRequest,
} from '../../../shared/types/library';
import type { NetworkMetadataProvider } from './NetworkMetadataProvider';
import { NetworkMetadataJobQueue } from './NetworkMetadataJobQueue';
import { NetworkMetadataMerge } from './NetworkMetadataMerge';
import { NetworkMetadataStore } from './NetworkMetadataStore';
import { highResolutionCoverUrl } from './HighResolutionCover';
import { matchScore, NETWORK_VISIBLE_CANDIDATE_THRESHOLD } from './matchScore';
import type { NetworkApplyResult, NetworkProviderName, StoredNetworkCoverCandidate, StoredNetworkMetadataCandidate } from './networkTypes';
import { CoverArtArchiveProvider } from './providers/CoverArtArchiveProvider';
import { MockMetadataProvider } from './providers/MockMetadataProvider';
import { MusicBrainzProvider } from './providers/MusicBrainzProvider';
import { NeteaseCloudMusicProvider } from './providers/NeteaseCloudMusicProvider';
import { QQMusicProvider } from './providers/QQMusicProvider';
import { KugouMusicProvider } from './providers/KugouMusicProvider';

export type NetworkCandidateList = {
  metadata: StoredNetworkMetadataCandidate[];
  covers: StoredNetworkCoverCandidate[];
};

export type NetworkRepairResult = NetworkCandidateList & {
  applied: NetworkApplyResult[];
  errors: string[];
  diagnostics: NetworkMetadataDiagnostics;
};

type MutableNetworkMetadataScanJobStatus = NetworkMetadataScanJobStatus;

type MissingMetadataScanProgress = {
  totalTracks?: number;
  processedTracks?: number;
  currentTrackTitle?: string | null;
  item?: MissingMetadataScanItem;
  error?: string;
};

const NETWORK_TAG_EDITOR_VISIBLE_THRESHOLD = 0.45;
const providerPriority: NetworkProviderName[] = [
  'netease-cloud-music',
  'qq-music',
  'kugou-music',
  'musicbrainz',
  'cover-art-archive',
  'mock',
];

const emptyDiagnostics = (overrides: Partial<NetworkMetadataDiagnostics> = {}): NetworkMetadataDiagnostics => ({
  targetCount: 0,
  providerErrors: 0,
  noCandidateCount: 0,
  protectedCount: 0,
  appliedCount: 0,
  ...overrides,
});

const hasCandidate = (item: MissingMetadataScanItem): boolean =>
  item.candidates.metadata.length + item.candidates.covers.length > 0;

const isProtectedApplyReason = (reason: string | undefined): boolean =>
  Boolean(
    reason === 'embedded_metadata_not_ready' ||
      reason === 'embedded_metadata_present' ||
      reason === 'no_missing_fields' ||
      reason?.startsWith('cover_source_'),
  );

const sameStringSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
};

const runWithConcurrency = async (tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> => {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await task();
    }
  });

  await Promise.all(workers);
};

export class NetworkMetadataService {
  private readonly store: NetworkMetadataStore;
  private readonly merge: NetworkMetadataMerge;
  private readonly queue = new NetworkMetadataJobQueue(2);
  private readonly providers: NetworkMetadataProvider[];
  private readonly backgroundScans = new Map<string, MutableNetworkMetadataScanJobStatus>();

  constructor(
    private readonly database: EchoDatabase,
    providers: NetworkMetadataProvider[] = [
      new MockMetadataProvider(),
      new NeteaseCloudMusicProvider(),
      new QQMusicProvider(),
      new KugouMusicProvider(),
      new MusicBrainzProvider(),
      new CoverArtArchiveProvider(),
    ],
  ) {
    this.store = new NetworkMetadataStore(database);
    this.merge = new NetworkMetadataMerge(database);
    this.providers = providers;
  }

  async repairMissingMetadata(trackId: string, providerNames?: NetworkProviderName[]): Promise<NetworkRepairResult> {
    return this.queue.run(async () => {
      const track = this.store.getTrackLookup(trackId);
      const applied: NetworkApplyResult[] = [];
      const errors: string[] = [];
      let protectedCount = 0;

      if (!track) {
        return {
          metadata: [],
          covers: [],
          applied,
          errors: [`Unknown track ${trackId}`],
          diagnostics: emptyDiagnostics({ providerErrors: 1 }),
        };
      }

      const providers = this.selectProviders(providerNames);
      this.database.prepare("UPDATE tracks SET network_metadata_status = 'pending', updated_at = ? WHERE id = ?").run(new Date().toISOString(), trackId);

      const tasks = providers.map((provider) => async () => {
        try {
          const candidates = await provider.findMetadata(track);
          for (const candidate of candidates) {
            const score = matchScore(track, candidate);
            if (score < NETWORK_TAG_EDITOR_VISIBLE_THRESHOLD) {
              continue;
            }

            const stored = this.store.upsertMetadataCandidate(trackId, null, candidate, score);
            const result = this.merge.applyMissingOnly(stored.id);
            if (result.status === 'applied_missing_only') {
              applied.push(result);
            } else if (isProtectedApplyReason(result.reason)) {
              protectedCount += 1;
            }
          }
        } catch (error) {
          errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
          this.database.prepare("UPDATE tracks SET network_metadata_status = 'error', updated_at = ? WHERE id = ?").run(new Date().toISOString(), trackId);
        }
      });
      await runWithConcurrency(tasks, Math.min(4, providers.length));

      const metadata = this.store.listTrackMetadataCandidates(trackId);
      const covers = this.store.listTrackCoverCandidates(trackId);
      const candidateCount = metadata.length + covers.length;
      return {
        metadata,
        covers,
        applied,
        errors,
        diagnostics: emptyDiagnostics({
          targetCount: 1,
          providerErrors: errors.length,
          noCandidateCount: candidateCount > 0 ? 0 : 1,
          protectedCount,
          appliedCount: applied.length,
        }),
      };
    });
  }

  async scanMissingMetadata(
    limit = 25,
    providerNames?: NetworkProviderName[],
    fields?: MissingMetadataField[],
  ): Promise<MissingMetadataScanResult> {
    return this.queue.run(async () => {
      return this.runMissingMetadataScan(limit, providerNames, fields);
    });
  }

  startMissingMetadataScan(
    limit = 25,
    providerNames?: NetworkProviderName[],
    fields?: MissingMetadataField[],
  ): NetworkMetadataScanJobStatus {
    const requestedFields = fields ?? [];
    const activeJob = [...this.backgroundScans.values()].find((job) => job.status === 'queued' || job.status === 'running');
    if (activeJob && sameStringSet(activeJob.fields, requestedFields)) {
      return this.cloneScanJob(activeJob);
    }

    const timestamp = new Date().toISOString();
    const job: MutableNetworkMetadataScanJobStatus = {
      id: randomUUID(),
      status: 'queued',
      fields: requestedFields,
      totalTracks: 0,
      processedTracks: 0,
      scannedCount: 0,
      candidateCount: 0,
      items: [],
      errors: [],
      diagnostics: emptyDiagnostics(),
      startedAt: timestamp,
      finishedAt: null,
      currentTrackTitle: null,
    };

    this.backgroundScans.set(job.id, job);
    void this.queue
      .run(async () => {
        job.status = 'running';
        const result = await this.runMissingMetadataScan(limit, providerNames, fields, (progress) => {
          this.updateScanJob(job, progress);
        });
        job.items = result.items;
        job.scannedCount = result.scannedCount;
        job.candidateCount = result.candidateCount;
        job.errors = result.errors;
        job.diagnostics = result.diagnostics;
        job.totalTracks = result.diagnostics.targetCount;
        job.processedTracks = result.scannedCount;
        job.status = 'completed';
        job.currentTrackTitle = null;
        job.finishedAt = new Date().toISOString();
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.currentTrackTitle = null;
        job.finishedAt = new Date().toISOString();
        job.errors.push(error instanceof Error ? error.message : String(error));
      });

    return this.cloneScanJob(job);
  }

  getMissingMetadataScanStatus(jobId: string): NetworkMetadataScanJobStatus {
    const job = this.backgroundScans.get(jobId);
    if (!job) {
      throw new Error(`Unknown network metadata scan job ${jobId}`);
    }

    return this.cloneScanJob(job);
  }

  showCandidates(trackId: string): NetworkCandidateList {
    return {
      metadata: this.store.listTrackMetadataCandidates(trackId),
      covers: this.store.listTrackCoverCandidates(trackId),
    };
  }

  getBestCoverUrlForTrack(trackId: string): string | null {
    return (
      this.store.listTrackCoverCandidates(trackId).find((candidate) => candidate.coverUrl.trim().startsWith('https://'))?.coverUrl ??
      this.store.listTrackMetadataCandidates(trackId).find((candidate) => candidate.coverUrl?.trim().startsWith('https://'))?.coverUrl ??
      null
    );
  }

  async searchNetworkTagCandidates(request: NetworkTagCandidateSearchRequest): Promise<NetworkTagCandidate[]> {
    return this.queue.run(async () => {
      const track = this.store.getTrackLookup(request.trackId);
      const errors: string[] = [];

      if (!track) {
        throw new Error(`Unknown track ${request.trackId}`);
      }

      const searchTrack = request.query?.trim()
        ? {
            ...track,
            title: request.query.trim(),
            artist: '',
            filename: request.query.trim(),
          }
        : track;
      const providers = this.selectProviders(request.providers);

      if (!providers.length) {
        throw new Error('Network metadata provider is unavailable');
      }

      await Promise.all(
        providers.map(async (provider) => {
          try {
            const metadataCandidates = await provider.findMetadata(searchTrack);
            for (const candidate of metadataCandidates) {
              const score = matchScore(track, candidate);
              if (score >= NETWORK_TAG_EDITOR_VISIBLE_THRESHOLD) {
                this.store.upsertMetadataCandidate(track.trackId, null, candidate, score);
              }
            }

            if (provider.findCovers) {
              const coverCandidates = await provider.findCovers(searchTrack);
              for (const cover of coverCandidates) {
                this.store.upsertCoverCandidate(track.trackId, null, cover);
              }
            }
          } catch (error) {
            errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
      );

      const candidates = this.store
        .listTrackMetadataCandidates(track.trackId)
        .map(
          (candidate): NetworkTagCandidate => ({
            id: candidate.id,
            provider: candidate.provider,
            confidence: candidate.score,
            title: candidate.title ?? '',
            artist: candidate.artist ?? '',
            album: candidate.album ?? '',
            albumArtist: candidate.albumArtist ?? '',
            trackNo: candidate.trackNo,
            discNo: candidate.discNo,
            year: candidate.year,
            genre: candidate.genre,
            duration: candidate.duration,
            coverUrl: candidate.coverUrl,
            coverMimeType: null,
            coverPreviewUrl: candidate.coverUrl,
            raw: candidate.raw,
          }),
        )
        .sort((left, right) => right.confidence - left.confidence);

      if (!candidates.length && errors.length) {
        throw new Error('网络来源暂时不可用，请稍后再试。');
      }

      return candidates;
    });
  }

  async resolveLyricsBackgroundCover(
    trackId: string,
    providerNames?: NetworkProviderName[],
  ): Promise<LyricsBackgroundCoverResult | null> {
    return this.queue.run(async () => {
      const track = this.store.getTrackLookup(trackId);
      if (!track) {
        return null;
      }

      const providers = this.selectProviders(providerNames).filter((provider) => provider.name !== 'mock');
      const candidates: LyricsBackgroundCoverResult[] = [];

      await Promise.all(
        providers.map(async (provider) => {
          try {
            const metadataCandidates = await provider.findMetadata(track);
            for (const candidate of metadataCandidates) {
              const confidence = matchScore(track, candidate);
              const coverUrl = highResolutionCoverUrl(candidate.provider, candidate.coverUrl);
              if (coverUrl && confidence >= NETWORK_VISIBLE_CANDIDATE_THRESHOLD) {
                candidates.push({
                  coverUrl,
                  provider: candidate.provider,
                  confidence,
                });
              }
            }
          } catch {
            // Background artwork is best-effort; local cover fallback remains in place.
          }
        }),
      );

      return candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    });
  }

  applyMissingOnly(candidateId: string, options?: NetworkApplyOptions): NetworkApplyResult {
    return this.merge.applyMissingOnly(candidateId, false, options?.fields);
  }

  applySelected(candidateId: string, options?: NetworkApplyOptions): NetworkApplyResult {
    return this.merge.applyMissingOnly(candidateId, true, options?.fields);
  }

  getMetadataCandidate(candidateId: string): StoredNetworkMetadataCandidate | null {
    return this.store.getMetadataCandidate(candidateId);
  }

  reject(candidateId: string): NetworkApplyResult {
    return this.merge.reject(candidateId);
  }

  recordAccepted(candidateId: string, appliedFields: NetworkApplyResult['appliedFields']): void {
    const candidate = this.store.getMetadataCandidate(candidateId);
    if (!candidate) {
      return;
    }

    this.store.recordDecision(candidate.trackId, candidate.id, 'accepted', appliedFields);
    this.database
      .prepare("UPDATE tracks SET network_metadata_status = 'applied_missing_only', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), candidate.trackId);
  }

  recordIgnored(candidateId: string): void {
    const candidate = this.store.getMetadataCandidate(candidateId);
    if (!candidate) {
      return;
    }

    this.store.recordDecision(candidate.trackId, candidate.id, 'ignored', {});
  }

  private async runMissingMetadataScan(
    limit = 25,
    providerNames?: NetworkProviderName[],
    fields?: MissingMetadataField[],
    onProgress?: (progress: MissingMetadataScanProgress) => void,
  ): Promise<MissingMetadataScanResult> {
    const targets = this.store.findMissingMetadataTargets(limit, { includeCoverOnly: true, fields });
    const providers = this.selectProviders(providerNames);
    const items: MissingMetadataScanItem[] = [];
    const errors: string[] = [];
    let protectedCount = 0;

    onProgress?.({ totalTracks: targets.length, processedTracks: 0 });

    const tasks = targets.map((target) => async () => {
      onProgress?.({ currentTrackTitle: target.track.title || target.track.path });

      if (target.embeddedMetadataStatus !== 'pending' && target.embeddedMetadataStatus !== 'reading') {
        await Promise.all(
          providers.map(async (provider) => {
            try {
              const candidates = await provider.findMetadata(target);
              for (const candidate of candidates) {
                const score = matchScore(target, candidate);
                const missingArtistCandidate = target.reasons.includes('unknown_artist') && Boolean(candidate.artist);
                const missingCoverCandidate = target.reasons.includes('missing_cover') && Boolean(candidate.coverUrl);
                if (score >= NETWORK_TAG_EDITOR_VISIBLE_THRESHOLD || missingCoverCandidate || (missingArtistCandidate && score >= 0.6)) {
                  this.store.upsertMetadataCandidate(target.trackId, null, candidate, score);
                }
              }
            } catch (error) {
              const message = `${target.track.title || target.track.path}: ${provider.name}: ${error instanceof Error ? error.message : String(error)}`;
              errors.push(message);
              onProgress?.({ error: message });
            }
          }),
        );
      } else {
        protectedCount += 1;
      }

      const item = {
        track: target.track,
        reasons: target.reasons,
        candidates: this.showCandidates(target.trackId),
      };
      items.push(item);
      onProgress?.({ item, processedTracks: items.length });
    });

    const concurrency = Math.min(12, Math.max(4, providers.length * 2));
    await runWithConcurrency(tasks, concurrency);

    return {
      items,
      scannedCount: targets.length,
      candidateCount: items.reduce((total, item) => total + item.candidates.metadata.length + item.candidates.covers.length, 0),
      errors,
      diagnostics: emptyDiagnostics({
        targetCount: targets.length,
        providerErrors: errors.length,
        noCandidateCount: items.filter((item) => !hasCandidate(item)).length,
        protectedCount,
        appliedCount: 0,
      }),
    };
  }

  private updateScanJob(job: MutableNetworkMetadataScanJobStatus, progress: MissingMetadataScanProgress): void {
    if (typeof progress.totalTracks === 'number') {
      job.totalTracks = progress.totalTracks;
      job.diagnostics = { ...job.diagnostics, targetCount: progress.totalTracks };
    }

    if (typeof progress.processedTracks === 'number') {
      job.processedTracks = progress.processedTracks;
      job.scannedCount = progress.processedTracks;
    }

    if (progress.currentTrackTitle !== undefined) {
      job.currentTrackTitle = progress.currentTrackTitle;
    }

    if (progress.item) {
      job.items = [...job.items, progress.item];
      job.candidateCount += progress.item.candidates.metadata.length + progress.item.candidates.covers.length;
      job.diagnostics = {
        ...job.diagnostics,
        noCandidateCount: job.diagnostics.noCandidateCount + (hasCandidate(progress.item) ? 0 : 1),
      };
    }

    if (progress.error) {
      job.errors = [...job.errors, progress.error];
      job.diagnostics = { ...job.diagnostics, providerErrors: job.errors.length };
    }
  }

  private selectProviders(providerNames?: NetworkProviderName[]): NetworkMetadataProvider[] {
    const enabledNames = providerNames?.length ? new Set(providerNames) : null;
    return this.providers
      .filter((provider) => !enabledNames || enabledNames.has(provider.name))
      .sort((left, right) => providerPriority.indexOf(left.name) - providerPriority.indexOf(right.name));
  }

  private cloneScanJob(job: MutableNetworkMetadataScanJobStatus): NetworkMetadataScanJobStatus {
    return {
      ...job,
      items: [...job.items],
      errors: [...job.errors],
    };
  }
}
