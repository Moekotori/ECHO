import { describe, expect, it, vi } from 'vitest';
import type { TrackLyrics } from '../../shared/types/lyrics';
import type { LibraryPage, LibraryPageQuery, LibraryTrack, LyricsBackfillJobStatus } from './libraryTypes';
import { LyricsBackfillJobPersistence, LyricsBackfillJobQueue } from './LyricsBackfillJobQueue';

const track = (id: string, title = id): LibraryTrack => ({
  id,
  path: `C:\\Music\\${id}.mp3`,
  title,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 180,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const pageFor = (tracks: LibraryTrack[], query?: LibraryPageQuery): LibraryPage<LibraryTrack> => {
  const page = Math.max(1, Math.floor(Number(query?.page ?? 1)));
  const pageSize = Math.max(1, Math.floor(Number(query?.pageSize ?? (tracks.length || 1))));
  const offset = (page - 1) * pageSize;
  const items = tracks.slice(offset, offset + pageSize);
  return {
    items,
    page,
    pageSize,
    total: tracks.length,
    hasMore: offset + items.length < tracks.length,
  };
};

const syncedLyrics = (trackId: string): TrackLyrics => ({
  id: `lyrics-${trackId}`,
  trackId,
  provider: 'lrclib',
  providerLyricsId: trackId,
  kind: 'synced',
  title: trackId,
  artist: 'Artist',
  album: 'Album',
  durationSeconds: 180,
  lines: [{ timeMs: 0, text: 'hello' }],
  plainText: 'hello',
  syncedText: '[00:00.00]hello',
  offsetMs: 0,
  score: 1,
  cachedAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

const waitForTerminalStatus = async (queue: LyricsBackfillJobQueue, jobId: string): Promise<LyricsBackfillJobStatus> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = queue.getStatus(jobId);
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
      return status;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('lyrics backfill job did not finish');
};

describe('LyricsBackfillJobQueue', () => {
  it('skips cached tracks and reports backfill progress', async () => {
    const tracks = [track('cached'), track('hit'), track('miss')];
    const cachedTrackIds = new Set(['cached']);
    const hasCachedLyricsForTrack = vi.fn((trackId: string) => cachedTrackIds.has(trackId));
    const hasCachedLyricsForTrackIds = vi.fn((trackIds: string[]) => new Set(trackIds.filter((trackId) => cachedTrackIds.has(trackId))));
    const getLyricsForTrack = vi.fn(async (trackId: string) => (trackId === 'hit' ? syncedLyrics(trackId) : null));
    const queue = new LyricsBackfillJobQueue(
      (query) => pageFor(tracks, query),
      async () => ({
        hasCachedLyricsForTrack,
        hasCachedLyricsForTrackIds,
        getLyricsForTrack,
      }),
    );

    const started = queue.start({ mode: 'quick', limit: 10, concurrency: 2, autoAcceptScore: 0.62 });
    const finished = await waitForTerminalStatus(queue, started.id);

    expect(finished.status).toBe('completed');
    expect(finished.autoAcceptScore).toBe(0.62);
    expect(finished.scannedTracks).toBe(3);
    expect(finished.totalTracks).toBe(2);
    expect(finished.processedTracks).toBe(2);
    expect(finished.alreadyCachedTracks).toBe(1);
    expect(finished.matchedTracks).toBe(1);
    expect(finished.notFoundTracks).toBe(1);
    expect(hasCachedLyricsForTrackIds).toHaveBeenCalledWith(['cached', 'hit', 'miss']);
    expect(getLyricsForTrack).toHaveBeenCalledTimes(2);
    expect(getLyricsForTrack).toHaveBeenCalledWith('hit', expect.objectContaining({
      enabledProviders: ['local', 'lrclib', 'netease', 'qqmusic', 'amll-ttml', 'kugou', 'kuwo'],
      networkEnabled: true,
      deepSearchEnabled: true,
      providerTimeoutMs: 2300,
      totalMatchTimeoutMs: 4200,
      autoAcceptScore: 0.62,
      preferPrimaryProvider: false,
      relaxedAutoAccept: true,
    }));
  });

  it('resumes a persisted in-progress job without replaying attempted tracks', async () => {
    const tracks = [track('done'), track('todo')];
    const getLyricsForTrack = vi.fn(async (trackId: string) => syncedLyrics(trackId));
    let latestStatus: LyricsBackfillJobStatus = {
      id: 'job-resume',
      mode: 'quick',
      status: 'running',
      phase: 'matching',
      autoAcceptScore: 0.58,
      playbackThrottled: false,
      totalTracks: 2,
      scannedTracks: 2,
      processedTracks: 1,
      matchedTracks: 1,
      alreadyCachedTracks: 0,
      notFoundTracks: 0,
      errorCount: 0,
      currentTrackTitle: 'done',
      startedAt: new Date(0).toISOString(),
      finishedAt: null,
      errors: [],
    };
    const attemptedTrackIds = new Set(['done']);
    const persistence = {
      saveJob: vi.fn((status: LyricsBackfillJobStatus) => {
        latestStatus = status;
      }),
      saveTargetIds: vi.fn(),
      markTrackAttempted: vi.fn((_jobId: string, trackId: string) => {
        attemptedTrackIds.add(trackId);
      }),
      loadLatestStatus: vi.fn(() => latestStatus),
      loadLatestResumableJob: vi.fn(() => ({
        status: latestStatus,
        options: { mode: 'quick', limit: 10, concurrency: 2, autoAcceptScore: 0.58, force: false },
        targetIds: ['done', 'todo'],
        attemptedTrackIds: [...attemptedTrackIds],
      })),
    } as unknown as LyricsBackfillJobPersistence;
    const queue = new LyricsBackfillJobQueue(
      (query) => pageFor(tracks, query),
      {
        getLyricsService: async () => ({
          hasCachedLyricsForTrack: () => false,
          getLyricsForTrack,
        }),
        persistence,
        isPlaybackActive: () => false,
      },
    );

    const resumed = queue.resumeLastIncompleteJob();
    expect(resumed?.id).toBe('job-resume');
    const finished = await waitForTerminalStatus(queue, 'job-resume');

    expect(finished.status).toBe('completed');
    expect(finished.processedTracks).toBe(2);
    expect(finished.matchedTracks).toBe(2);
    expect(getLyricsForTrack).toHaveBeenCalledTimes(1);
    expect(getLyricsForTrack).toHaveBeenCalledWith('todo', expect.objectContaining({ autoAcceptScore: 0.58 }));
    expect(attemptedTrackIds).toEqual(new Set(['done', 'todo']));
  });
});
