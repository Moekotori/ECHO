import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteLibraryTrack, RemoteMetadataResult } from '../../../shared/types/remoteSources';
import type { RemoteSourceSecret } from './remoteTypes';
import { RemoteBackgroundJobQueue } from './RemoteBackgroundJobQueue';

const serviceMocks = vi.hoisted(() => ({
  getLyricsForTrack: vi.fn(),
  searchNetworkCandidates: vi.fn(),
}));

vi.mock('../../lyrics/LyricsService', () => ({
  getLyricsService: () => ({
    getLyricsForTrack: serviceMocks.getLyricsForTrack,
  }),
}));

vi.mock('../../mv/MvService', () => ({
  getMvService: () => ({
    searchNetworkCandidates: serviceMocks.searchNetworkCandidates,
  }),
}));

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for queue');
};

const makeSource = (): RemoteSourceSecret => ({
  id: 'source-1',
  provider: 'webdav',
  displayName: 'WebDAV',
  status: 'enabled',
  baseUrl: 'https://example.test/dav',
  username: null,
  authType: 'none',
  config: {},
  syncMode: 'index',
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  indexedTrackCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret: null,
});

const makeTrack = (): RemoteLibraryTrack => ({
  id: 'remote-track-1',
  sourceId: 'source-1',
  provider: 'webdav',
  remotePath: '/music/track.flac',
  stableKey: 'stable-1',
  title: 'track',
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
  sizeBytes: 1024,
  modifiedAt: '2026-01-01T00:00:00.000Z',
  etag: '"abc"',
  coverId: null,
  coverThumb: null,
  coverStatus: 'pending',
  metadataStatus: 'pending',
  lyricsStatus: 'pending',
  mvStatus: 'pending',
  availability: 'available',
  fieldSources: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const makeMetadata = (): RemoteMetadataResult => ({
  status: 'partial',
  title: 'track',
  artist: 'Unknown Artist',
  album: '',
  albumArtist: 'Unknown Artist',
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: 123.4,
  codec: 'flac',
  sampleRate: 48000,
  bitDepth: 24,
  bitrate: null,
  fieldSources: { duration: 'range' },
  warnings: [],
  errors: [],
});

describe('RemoteBackgroundJobQueue', () => {
  beforeEach(() => {
    serviceMocks.getLyricsForTrack.mockReset().mockResolvedValue(null);
    serviceMocks.searchNetworkCandidates.mockReset().mockResolvedValue([]);
  });

  it('runs metadata jobs with bounded queue status and updates indexed tracks', async () => {
    const source = makeSource();
    const track = makeTrack();
    const readMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const updates: string[] = [];
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn((_trackId: string, _kind: string, status: string) => {
        updates.push(status);
        track.metadataStatus = status as RemoteLibraryTrack['metadataStatus'];
      }),
      updateTrackMetadata: vi.fn((_trackId: string, update: Partial<RemoteLibraryTrack>) => {
        Object.assign(track, update);
        return track;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    const initial = queue.enqueueSource(source.id, ['metadata']);
    expect(initial.pending.metadata).toBe(0);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);

    expect(readMetadata).toHaveBeenCalledTimes(1);
    expect(store.updateTrackMetadata).toHaveBeenCalledWith(
      track.id,
      expect.objectContaining({
        duration: 123.4,
        codec: 'flac',
        metadataStatus: 'partial',
      }),
      undefined,
    );
    expect(updates).toContain('searching');
    expect(queue.getStatus(source.id).pending.metadata).toBe(0);
  });

  it('continues source metadata enqueue in later batches instead of stopping after the first batch', async () => {
    const source = makeSource();
    const firstTrack = makeTrack();
    const secondTrack = { ...makeTrack(), id: 'remote-track-2', stableKey: 'stable-2', remotePath: '/music/track-2.flac' };
    const tracks = new Map([
      [firstTrack.id, firstTrack],
      [secondTrack.id, secondTrack],
    ]);
    const getTrackIdsForBackgroundJobs = vi
      .fn()
      .mockReturnValueOnce([firstTrack.id])
      .mockReturnValueOnce([secondTrack.id])
      .mockReturnValue([]);
    const readMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const store = {
      getTrackIdsForBackgroundJobs,
      getTracksByIds: vi.fn((trackIds: string[]) => trackIds.map((trackId) => tracks.get(trackId)).filter(Boolean)),
      getTrack: vi.fn((trackId: string) => tracks.get(trackId) ?? null),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn((trackId: string, _kind: string, status: string) => {
        const track = tracks.get(trackId);
        if (track) {
          track.metadataStatus = status as RemoteLibraryTrack['metadataStatus'];
        }
      }),
      updateTrackMetadata: vi.fn((trackId: string, update: Partial<RemoteLibraryTrack>) => {
        const track = tracks.get(trackId);
        if (track) {
          Object.assign(track, update);
        }
        return track ?? null;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.enqueueSource(source.id, ['metadata']);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 2);
    await waitFor(() => getTrackIdsForBackgroundJobs.mock.calls.length >= 3);

    expect(readMetadata).toHaveBeenCalledTimes(2);
    expect(getTrackIdsForBackgroundJobs).toHaveBeenNthCalledWith(1, source.id, ['metadata'], { failedOnly: undefined, limit: 1000 });
  });

  it('does not duplicate a remote metadata read when metadata and duration backfill are queued together', async () => {
    const source = makeSource();
    const track = makeTrack();
    const readMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn((_trackId: string, _kind: string, status: string) => {
        track.metadataStatus = status as RemoteLibraryTrack['metadataStatus'];
      }),
      updateTrackMetadata: vi.fn((_trackId: string, update: Partial<RemoteLibraryTrack>) => {
        Object.assign(track, update);
        return track;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    const initial = queue.enqueueSource(source.id, ['metadata', 'duration-backfill']);
    expect(initial.pending.metadata).toBe(0);
    expect(initial.pending['duration-backfill']).toBe(0);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);

    expect(readMetadata).toHaveBeenCalledTimes(1);
    expect(queue.getStatus(source.id).completed['duration-backfill']).toBe(0);
  });

  it('does not start cover follow-up work after a metadata-only source job', async () => {
    const source = { ...makeSource(), provider: 'subsonic' as const };
    const track = {
      ...makeTrack(),
      provider: 'subsonic' as const,
    };
    const readMetadata = vi.fn().mockResolvedValue({
      ...makeMetadata(),
      status: 'ok',
      fieldSources: { coverArt: 'server-cover-1' },
    } satisfies RemoteMetadataResult);
    const readCover = vi.fn();
    const coverService = {
      ensureCover: vi.fn(),
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn((_trackId: string, kind: string, status: string) => {
        if (kind === 'metadata' || kind === 'duration-backfill') {
          track.metadataStatus = status as RemoteLibraryTrack['metadataStatus'];
        }
      }),
      updateTrackMetadata: vi.fn((_trackId: string, update: Partial<RemoteLibraryTrack>) => {
        Object.assign(track, update);
        return track;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata, readCover } as never), coverService as never);

    queue.enqueueSource(source.id, ['metadata']);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readCover).not.toHaveBeenCalled();
    expect(coverService.ensureCover).not.toHaveBeenCalled();
    expect(queue.getStatus(source.id).pending.cover).toBe(0);
  });

  it('honors global pause and playback-aware concurrency limits', async () => {
    const source = { ...makeSource(), config: { metadataConcurrency: 8 } };
    const track = makeTrack();
    const readMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn(),
      updateTrackMetadata: vi.fn((_trackId: string, update: Partial<RemoteLibraryTrack>) => {
        Object.assign(track, update);
        return track;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.setPlaybackActive(true);
    expect(queue.getStatus(source.id).concurrency.metadata).toBe(1);
    expect(queue.getStatus(source.id).concurrency['duration-backfill']).toBe(1);
    expect(queue.getStatus(source.id).concurrency.cover).toBe(0);
    expect(queue.getStatus(source.id).concurrency.lyrics).toBe(0);
    expect(queue.getStatus(source.id).concurrency.mv).toBe(0);
    queue.setPlaybackActive(false);
    expect(queue.getStatus(source.id).concurrency.cover).toBe(2);
    expect(queue.getStatus(source.id).concurrency.metadata).toBe(8);
    queue.setPlaybackActive(true);

    queue.setGlobalPaused(true);
    queue.enqueueSource(source.id, ['metadata']);
    await waitFor(() => queue.getStatus(source.id).pending.metadata === 1);
    expect(readMetadata).not.toHaveBeenCalled();
    expect(queue.getStatus(source.id).pending.metadata).toBe(1);

    queue.setGlobalPaused(false);
    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);
    expect(readMetadata).toHaveBeenCalledTimes(1);
  });

  it('uses user-configured default background concurrency while preserving playback limits', () => {
    const source = {
      ...makeSource(),
      config: {
        metadataConcurrency: 2,
        coverConcurrency: 2,
        lyricsConcurrency: 1,
        mvConcurrency: 1,
        durationBackfillConcurrency: 1,
      },
    };
    const store = {
      getSource: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(
      store as never,
      () => ({} as never),
      null,
      () => ({
        metadataConcurrency: 6,
        coverConcurrency: 12,
        lyricsConcurrency: 3,
        mvConcurrency: 2,
        durationBackfillConcurrency: 4,
      }),
    );

    expect(queue.getGlobalStatus().concurrency).toEqual({
      metadata: 6,
      cover: 12,
      lyrics: 3,
      mv: 2,
      'duration-backfill': 4,
    });
    expect(queue.getStatus(source.id).concurrency).toMatchObject({
      metadata: 6,
      cover: 12,
      lyrics: 3,
      mv: 2,
      'duration-backfill': 4,
    });

    queue.setPlaybackActive(true);
    expect(queue.getStatus(source.id).concurrency).toMatchObject({
      metadata: 1,
      cover: 0,
      lyrics: 0,
      mv: 0,
      'duration-backfill': 1,
    });
  });

  it('runs metadata jobs with the user-configured default concurrency', async () => {
    const source = {
      ...makeSource(),
      config: {
        metadataConcurrency: 1,
        coverConcurrency: 1,
        lyricsConcurrency: 1,
        mvConcurrency: 1,
        durationBackfillConcurrency: 1,
      },
    };
    const tracks = Array.from({ length: 8 }, (_value, index) => ({
      ...makeTrack(),
      id: `remote-track-user-concurrency-${index}`,
      remotePath: `/music/user-concurrency-${index}.flac`,
      stableKey: `user-concurrency-${index}`,
    }));
    let activeReads = 0;
    let maxActiveReads = 0;
    const readMetadata = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return makeMetadata();
    });
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue(tracks),
      getTrack: vi.fn((trackId: string) => tracks.find((track) => track.id === trackId) ?? null),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn(),
      updateTrackMetadata: vi.fn((trackId: string, update: Partial<RemoteLibraryTrack>) => {
        const track = tracks.find((candidate) => candidate.id === trackId);
        if (track) {
          Object.assign(track, update);
        }
        return track ?? null;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(
      store as never,
      () => ({ readMetadata } as never),
      null,
      () => ({ metadataConcurrency: 4 }),
    );

    queue.enqueueSource(source.id, ['metadata']);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === tracks.length);

    expect(readMetadata).toHaveBeenCalledTimes(tracks.length);
    expect(maxActiveReads).toBe(4);
  });

  it('keeps cover jobs queued while playback or source sync is active', async () => {
    const source = makeSource();
    const track = {
      ...makeTrack(),
      metadataStatus: 'ok' as const,
    };
    const readCover = vi.fn().mockResolvedValue({
      status: 'ok',
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      fieldSources: { cover: 'subsonic' },
      warnings: [],
      errors: [],
    });
    const coverService = {
      ensureCover: vi.fn().mockResolvedValue('cached-cover-1'),
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      updateTrackJobStatus: vi.fn((_trackId: string, kind: string, status: string) => {
        if (kind === 'cover') {
          (track as RemoteLibraryTrack).coverStatus = status as RemoteLibraryTrack['coverStatus'];
        }
      }),
      updateTrackCover: vi.fn((_trackId: string, coverId: string | null) => {
        (track as RemoteLibraryTrack).coverId = coverId;
        (track as RemoteLibraryTrack).coverStatus = coverId ? 'ok' : 'pending';
        return track;
      }),
      updateTrackCoversByCoverArt: vi.fn(),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readCover } as never), coverService as never);

    queue.setPlaybackActive(true);
    queue.enqueueSource(source.id, ['cover']);
    await waitFor(() => queue.getStatus(source.id).pending.cover === 1);
    expect(readCover).not.toHaveBeenCalled();

    queue.setPlaybackActive(false);
    queue.setSourceSyncActive(source.id, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.getStatus(source.id).pending.cover).toBe(1);
    expect(readCover).not.toHaveBeenCalled();

    queue.setSourceSyncActive(source.id, false);
    await waitFor(() => queue.getStatus(source.id).completed.cover === 1);
    expect(readCover).toHaveBeenCalledTimes(1);
  });

  it('keeps duration backfill running at single concurrency during playback', async () => {
    const source = { ...makeSource(), config: { metadataConcurrency: 8 } };
    const tracks = Array.from({ length: 2 }, (_value, index) => ({
      ...makeTrack(),
      id: `remote-track-${index}`,
      remotePath: `/music/track-${index}.flac`,
      stableKey: `stable-${index}`,
      metadataStatus: 'ok' as const,
      duration: null,
    }));
    let activeReads = 0;
    let maxActiveReads = 0;
    const readMetadata = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return makeMetadata();
    });
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue(tracks),
      getTrack: vi.fn((trackId: string) => tracks.find((track) => track.id === trackId) ?? null),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn(),
      updateTrackMetadata: vi.fn((trackId: string, update: Partial<RemoteLibraryTrack>) => {
        const track = tracks.find((candidate) => candidate.id === trackId);
        if (track) {
          Object.assign(track, update);
        }
        return track ?? null;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.setPlaybackActive(true);
    queue.enqueueSource(source.id, ['duration-backfill']);

    await waitFor(() => queue.getStatus(source.id).completed['duration-backfill'] === tracks.length);

    expect(readMetadata).toHaveBeenCalledTimes(tracks.length);
    expect(maxActiveReads).toBe(1);
  });

  it('keeps metadata and duration jobs queued during enhanced low-load playback', async () => {
    const source = makeSource();
    const tracks = [
      makeTrack(),
      {
        ...makeTrack(),
        id: 'remote-track-duration',
        remotePath: '/music/duration.flac',
        stableKey: 'stable-duration',
        metadataStatus: 'ok' as const,
        duration: null,
      },
    ];
    const readMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const store = {
      getTrack: vi.fn((trackId: string) => tracks.find((track) => track.id === trackId) ?? null),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn(),
      updateTrackMetadata: vi.fn((trackId: string, update: Partial<RemoteLibraryTrack>) => {
        const track = tracks.find((candidate) => candidate.id === trackId);
        if (track) {
          Object.assign(track, update);
        }
        return track ?? null;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.setPlaybackActive(true, { lowLoadEnhanced: true });
    queue.enqueueTrack(tracks[0]!, ['metadata']);
    queue.enqueueTrack(tracks[1]!, ['duration-backfill']);

    expect(queue.getStatus(source.id).concurrency.metadata).toBe(0);
    expect(queue.getStatus(source.id).concurrency['duration-backfill']).toBe(0);
    expect(queue.getStatus(source.id).pending.metadata).toBe(1);
    expect(queue.getStatus(source.id).pending['duration-backfill']).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(readMetadata).not.toHaveBeenCalled();

    queue.setPlaybackActive(false);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);
    await waitFor(() => queue.getStatus(source.id).completed['duration-backfill'] === 1);
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });

  it('keeps lyrics jobs queued during playback and resumes them when playback stops', async () => {
    const source = makeSource();
    const track = {
      ...makeTrack(),
      title: 'Echo Song',
      artist: 'Echo Artist',
      albumArtist: 'Echo Artist',
      metadataStatus: 'ok' as const,
    };
    serviceMocks.getLyricsForTrack.mockResolvedValue({ id: 'lyrics-1' });
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      updateTrackJobStatus: vi.fn((_trackId: string, kind: string, status: string) => {
        if (kind === 'lyrics') {
          track.lyricsStatus = status as RemoteLibraryTrack['lyricsStatus'];
        }
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({} as never));

    queue.setPlaybackActive(true);
    queue.enqueueSource(source.id, ['lyrics']);
    await waitFor(() => queue.getStatus(source.id).pending.lyrics === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(serviceMocks.getLyricsForTrack).not.toHaveBeenCalled();

    queue.setPlaybackActive(false);
    await waitFor(() => queue.getStatus(source.id).completed.lyrics === 1);

    expect(serviceMocks.getLyricsForTrack).toHaveBeenCalledWith(track.id);
    expect(track.lyricsStatus).toBe('ok');
  });

  it('caps remote background metadata work globally even when several sources request high concurrency', async () => {
    const sources = [
      { ...makeSource(), id: 'source-1', config: { metadataConcurrency: 8 } },
      { ...makeSource(), id: 'source-2', config: { metadataConcurrency: 8 } },
    ];
    const tracks = Array.from({ length: 12 }, (_value, index) => ({
      ...makeTrack(),
      id: `remote-track-${index}`,
      sourceId: index < 6 ? 'source-1' : 'source-2',
      remotePath: `/music/track-${index}.flac`,
      stableKey: `stable-${index}`,
    }));
    let activeReads = 0;
    let maxActiveReads = 0;
    const readMetadata = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return makeMetadata();
    });
    const store = {
      getTracksForBackgroundJobs: vi.fn((sourceId: string) => tracks.filter((track) => track.sourceId === sourceId)),
      getTrack: vi.fn((trackId: string) => tracks.find((track) => track.id === trackId) ?? null),
      getSource: vi.fn((sourceId: string) => sources.find((source) => source.id === sourceId) ?? null),
      getSourceWithSecret: vi.fn((sourceId: string) => sources.find((source) => source.id === sourceId) ?? null),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn(() => undefined),
      updateTrackMetadata: vi.fn((trackId: string, update: Partial<RemoteLibraryTrack>) => {
        const track = tracks.find((candidate) => candidate.id === trackId);
        if (track) {
          Object.assign(track, update);
        }
        return track ?? null;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.enqueueSource('source-1', ['metadata']);
    queue.enqueueSource('source-2', ['metadata']);

    await waitFor(() => queue.getStatus('source-1').completed.metadata + queue.getStatus('source-2').completed.metadata === tracks.length);

    expect(readMetadata).toHaveBeenCalledTimes(tracks.length);
    expect(maxActiveReads).toBeLessThanOrEqual(8);
  });

  it('runs lyrics but not MV jobs after metadata is matchable', async () => {
    const source = makeSource();
    const track = makeTrack();
    const metadata = {
      ...makeMetadata(),
      status: 'ok',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      albumArtist: 'Echo Artist',
      duration: 188,
    } satisfies RemoteMetadataResult;
    const readMetadata = vi.fn().mockResolvedValue(metadata);
    serviceMocks.getLyricsForTrack.mockResolvedValue({ id: 'lyrics-1' });
    serviceMocks.searchNetworkCandidates.mockResolvedValue([{ id: 'mv-1' }]);
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      prepareMetadataUpdateSearchTerms: vi.fn().mockResolvedValue(undefined),
      updateTrackJobStatus: vi.fn((_trackId: string, kind: string, status: string) => {
        if (kind === 'metadata' || kind === 'duration-backfill') {
          track.metadataStatus = status as RemoteLibraryTrack['metadataStatus'];
        } else if (kind === 'lyrics') {
          track.lyricsStatus = status as RemoteLibraryTrack['lyricsStatus'];
        } else if (kind === 'mv') {
          track.mvStatus = status as RemoteLibraryTrack['mvStatus'];
        }
      }),
      updateTrackMetadata: vi.fn((_trackId: string, update: Partial<RemoteLibraryTrack>) => {
        Object.assign(track, update);
        return track;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata } as never));

    queue.enqueueSource(source.id, ['metadata']);

    await waitFor(() => queue.getStatus(source.id).completed.metadata === 1);
    await waitFor(() => queue.getStatus(source.id).completed.lyrics === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(serviceMocks.getLyricsForTrack).toHaveBeenCalledWith(track.id);
    expect(serviceMocks.searchNetworkCandidates).not.toHaveBeenCalled();
    expect(track.lyricsStatus).toBe('ok');
    expect(track.mvStatus).toBe('pending');
    expect(queue.getStatus(source.id).completed.mv).toBe(0);
    expect(queue.getStatus(source.id).pending.mv).toBe(0);
  });

  it('does not enqueue lyrics or MV matching for filename-only fallback metadata', async () => {
    const source = makeSource();
    const track = makeTrack();
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      updateTrackJobStatus: vi.fn(),
      updateTrackMetadata: vi.fn(),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    const status = queue.enqueueSource(source.id, ['lyrics', 'mv']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(status.pending.lyrics).toBe(0);
    expect(status.pending.mv).toBe(0);
    expect(serviceMocks.getLyricsForTrack).not.toHaveBeenCalled();
    expect(serviceMocks.searchNetworkCandidates).not.toHaveBeenCalled();
  });

  it('ignores explicit remote MV background jobs', async () => {
    const source = makeSource();
    const track = {
      ...makeTrack(),
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      metadataStatus: 'ok' as const,
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      updateTrackJobStatus: vi.fn(),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    const status = queue.enqueueSource(source.id, ['mv']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(status.pending.mv).toBe(0);
    expect(queue.getStatus(source.id).pending.mv).toBe(0);
    expect(queue.getStatus(source.id).completed.mv).toBe(0);
    expect(serviceMocks.searchNetworkCandidates).not.toHaveBeenCalled();
  });

  it('uses a small source batch when enqueueing cover-only work', async () => {
    const source = makeSource();
    const getTrackIdsForBackgroundJobs = vi.fn().mockReturnValue([]);
    const store = {
      getTrackIdsForBackgroundJobs,
      getTracksByIds: vi.fn().mockReturnValue([]),
      getTrack: vi.fn(),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    queue.enqueueSource(source.id, ['cover']);

    await waitFor(() => getTrackIdsForBackgroundJobs.mock.calls.length > 0);
    expect(getTrackIdsForBackgroundJobs).toHaveBeenCalledWith(source.id, ['cover'], { failedOnly: undefined, limit: 2400 });
  });

  it('uses a bounded source batch when enqueueing lyrics-only work', async () => {
    const source = makeSource();
    const getTrackIdsForBackgroundJobs = vi.fn().mockReturnValue([]);
    const store = {
      getTrackIdsForBackgroundJobs,
      getTracksByIds: vi.fn().mockReturnValue([]),
      getTrack: vi.fn(),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    queue.enqueueSource(source.id, ['lyrics']);

    await waitFor(() => getTrackIdsForBackgroundJobs.mock.calls.length > 0);
    expect(getTrackIdsForBackgroundJobs).toHaveBeenCalledWith(source.id, ['lyrics'], { failedOnly: undefined, limit: 50 });
  });

  it('does not enqueue cover jobs that were already marked not found', async () => {
    const source = makeSource();
    const track = {
      ...makeTrack(),
      metadataStatus: 'ok' as const,
      coverStatus: 'not_found' as const,
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    const status = queue.enqueueSource(source.id, ['cover']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(status.pending.cover).toBe(0);
    expect(queue.getStatus(source.id).pending.cover).toBe(0);
  });

  it('skips media-server cover jobs when the track has no server cover id', async () => {
    const source = { ...makeSource(), provider: 'jellyfin' as const };
    const withoutCoverArt = {
      ...makeTrack(),
      provider: 'jellyfin' as const,
      metadataStatus: 'ok' as const,
      fieldSources: {},
    };
    const withCoverArt = {
      ...makeTrack(),
      id: 'remote-track-2',
      provider: 'jellyfin' as const,
      metadataStatus: 'ok' as const,
      fieldSources: { coverArt: 'primary-cover' },
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([withoutCoverArt, withCoverArt]),
      getTrack: vi.fn((trackId: string) => trackId === withCoverArt.id ? withCoverArt : withoutCoverArt),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    queue.setGlobalPaused(true);
    const status = queue.enqueueSource(source.id, ['cover']);
    await waitFor(() => queue.getStatus(source.id).pending.cover === 1);

    expect(status.pending.cover).toBe(0);
    expect(queue.getStatus(source.id).pending.cover).toBe(1);
  });

  it('queues only one cover job per shared remote cover id', async () => {
    const source = { ...makeSource(), provider: 'subsonic' as const };
    const firstTrack = {
      ...makeTrack(),
      provider: 'subsonic' as const,
      metadataStatus: 'ok' as const,
      fieldSources: { coverArt: 'album-cover-1' },
    };
    const secondTrack = {
      ...makeTrack(),
      id: 'remote-track-2',
      remotePath: '/music/track-2.flac',
      stableKey: 'stable-2',
      provider: 'subsonic' as const,
      metadataStatus: 'ok' as const,
      fieldSources: { coverArt: 'album-cover-1' },
    };
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([firstTrack, secondTrack]),
      getTrack: vi.fn((trackId: string) => trackId === secondTrack.id ? secondTrack : firstTrack),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readMetadata: vi.fn() } as never));

    queue.setGlobalPaused(true);
    const status = queue.enqueueSource(source.id, ['cover']);
    await waitFor(() => queue.getStatus(source.id).pending.cover === 1);

    expect(status.pending.cover).toBe(0);
    expect(queue.getStatus(source.id).pending.cover).toBe(1);
    expect(queue.getStatus(source.id).skipped.cover).toBe(1);
  });

  it('reuses a persisted remote cover alias before reading the remote cover again', async () => {
    const source = { ...makeSource(), provider: 'subsonic' as const };
    const track = {
      ...makeTrack(),
      provider: 'subsonic' as const,
      metadataStatus: 'ok' as const,
      fieldSources: { coverArt: 'album-cover-1' },
    };
    const readCover = vi.fn();
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      getCachedRemoteCoverIdForTrack: vi.fn(() => 'cached-cover-id'),
      upsertRemoteCoverCacheForTrack: vi.fn(),
      updateTrackJobStatus: vi.fn(),
      updateTrackCover: vi.fn(),
      updateTrackCoversByCoverArt: vi.fn((_sourceId: string, _coverArt: string, coverId: string) => {
        (track as RemoteLibraryTrack).coverId = coverId;
        (track as RemoteLibraryTrack).coverStatus = 'ok';
        return 1;
      }),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readCover } as never), {} as never);

    queue.enqueueSource(source.id, ['cover']);
    await waitFor(() => queue.getStatus(source.id).completed.cover === 1);

    expect(store.getCachedRemoteCoverIdForTrack).toHaveBeenCalledWith(track);
    expect(store.updateTrackCoversByCoverArt).toHaveBeenCalledWith(source.id, 'album-cover-1', 'cached-cover-id');
    expect(readCover).not.toHaveBeenCalled();
  });

  it('aborts running cover work when a source is paused', async () => {
    const source = { ...makeSource(), config: { coverConcurrency: 1 } };
    const track = {
      ...makeTrack(),
      metadataStatus: 'ok' as const,
    };
    let capturedSignal: AbortSignal | null = null;
    const readCover = vi.fn(({ signal }) => {
      capturedSignal = signal ?? null;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('Request aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });
    const store = {
      getTracksForBackgroundJobs: vi.fn().mockReturnValue([track]),
      getTrack: vi.fn(() => track),
      getSource: vi.fn(() => source),
      getSourceWithSecret: vi.fn(() => source),
      updateTrackJobStatus: vi.fn(),
    };
    const coverService = {
      ensureCover: vi.fn(),
    };
    const queue = new RemoteBackgroundJobQueue(store as never, () => ({ readCover } as never), coverService as never);

    queue.enqueueSource(source.id, ['cover']);
    await waitFor(() => queue.getStatus(source.id).running.cover === 1);

    queue.pause(source.id);

    await waitFor(() => capturedSignal?.aborted === true);
    expect(queue.getStatus(source.id).paused).toBe(true);
  });
});
