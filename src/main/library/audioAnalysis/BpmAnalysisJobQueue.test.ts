import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../libraryTypes';
import type { LibraryStore } from '../LibraryStore';
import type { BpmAnalyzer } from './BpmAnalyzer';
import { BpmAnalysisJobQueue } from './BpmAnalysisJobQueue';

const tempRoots: string[] = [];

const makeTempAudioPath = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'echo-next-bpm-job-'));
  tempRoots.push(root);
  const filePath = join(root, 'song.flac');
  writeFileSync(filePath, 'not real audio, analyzer is mocked');
  return filePath;
};

const makeTrack = (path: string): LibraryTrack => ({
  id: 'track-1',
  path,
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'FLAC',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  bpm: null,
  bpmConfidence: null,
  beatOffsetMs: null,
  analysisStatus: 'none',
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const makeStore = (track: LibraryTrack): LibraryStore =>
  ({
    findBpmAnalysisTargets: vi.fn(() => [track]),
    markTrackAnalyzing: vi.fn(),
    updateTrackBpmAnalysis: vi.fn(),
  }) as unknown as LibraryStore;

const makeAnalyzer = (): BpmAnalyzer =>
  ({
    analyze: vi.fn().mockResolvedValue({
      bpm: 127.6,
      confidence: 0.91,
      beatOffsetMs: 32,
    }),
  }) as unknown as BpmAnalyzer;

const waitForCondition = async (predicate: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
};

describe('BpmAnalysisJobQueue', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
    vi.restoreAllMocks();
  });

  it('queues a BPM tag write after reliable analysis completes', async () => {
    const track = makeTrack(makeTempAudioPath());
    const store = makeStore(track);
    const writeBpmTag = vi.fn().mockResolvedValue(undefined);
    const queue = new BpmAnalysisJobQueue(store, {
      analyzer: makeAnalyzer(),
      writeBpmTag,
      shouldDelayTagWrite: vi.fn().mockResolvedValue(false),
    });

    const job = queue.start({ trackIds: [track.id] });

    await waitForCondition(() => queue.getStatus(job.id).status === 'completed', 'job completion');
    await waitForCondition(() => writeBpmTag.mock.calls.length === 1, 'BPM tag write');

    expect(store.markTrackAnalyzing).toHaveBeenCalledWith(track.id);
    expect(store.updateTrackBpmAnalysis).toHaveBeenCalledWith(track.id, {
      bpm: 127.6,
      confidence: 0.91,
      beatOffsetMs: 32,
      status: 'complete',
    });
    expect(writeBpmTag).toHaveBeenCalledWith(track.path, 127.6);
  });

  it('stores low-confidence analysis without writing BPM tags', async () => {
    const track = makeTrack(makeTempAudioPath());
    const store = makeStore(track);
    const writeBpmTag = vi.fn().mockResolvedValue(undefined);
    const analyzer = {
      analyze: vi.fn().mockResolvedValue({
        bpm: 128.2,
        confidence: 0.2,
        beatOffsetMs: 18,
      }),
    } as unknown as BpmAnalyzer;
    const queue = new BpmAnalysisJobQueue(store, {
      analyzer,
      writeBpmTag,
      shouldDelayTagWrite: vi.fn().mockResolvedValue(false),
    });

    const job = queue.start({ trackIds: [track.id] });

    await waitForCondition(() => queue.getStatus(job.id).status === 'completed', 'job completion');

    expect(store.updateTrackBpmAnalysis).toHaveBeenCalledWith(track.id, {
      bpm: null,
      confidence: 0.2,
      beatOffsetMs: null,
      status: 'low_confidence',
    });
    expect(queue.getStatus(job.id).updatedTracks).toBe(0);
    expect(writeBpmTag).not.toHaveBeenCalled();
  });

  it('retries BPM tag writes when the audio file is still busy', async () => {
    const track = makeTrack(makeTempAudioPath());
    const writeBpmTag = vi.fn().mockResolvedValue(undefined);
    const shouldDelayTagWrite = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const queue = new BpmAnalysisJobQueue(makeStore(track), {
      analyzer: makeAnalyzer(),
      writeBpmTag,
      shouldDelayTagWrite,
      tagWriteRetryDelayMs: 5,
    });

    const job = queue.start({ trackIds: [track.id] });

    await waitForCondition(() => queue.getStatus(job.id).status === 'completed', 'job completion');
    expect(writeBpmTag).not.toHaveBeenCalled();

    await waitForCondition(() => writeBpmTag.mock.calls.length === 1, 'delayed BPM tag write');

    expect(shouldDelayTagWrite).toHaveBeenCalledTimes(2);
    expect(writeBpmTag).toHaveBeenCalledWith(track.path, 127.6);
  });
});
