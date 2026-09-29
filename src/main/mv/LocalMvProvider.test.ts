import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LibraryTrack } from '../../shared/types/library';
import { LocalMvProvider } from './LocalMvProvider';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-mv-provider-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const makeTrack = (path: string): LibraryTrack => ({
  id: 'track-1',
  path,
  title: 'Echo Song',
  artist: 'Echo Artist',
  album: 'Echo Album',
  albumArtist: 'Echo Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 120,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('LocalMvProvider', () => {
  it('scores same basename mp4 highly', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'Echo Song.flac');
    writeFileSync(audioPath, 'audio');
    writeFileSync(join(root, 'Echo Song.mp4'), 'video');

    const [candidate] = new LocalMvProvider().searchCandidates(makeTrack(audioPath));

    expect(candidate.title).toBe('Echo Song');
    expect(candidate.score).toBeGreaterThanOrEqual(0.6);
    expect(candidate.playableInApp).toBe(true);
  });

  it('adds score for MV folders', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'Echo Song.flac');
    const mvFolder = join(root, 'MV');
    mkdirSync(mvFolder);
    writeFileSync(audioPath, 'audio');
    writeFileSync(join(mvFolder, 'Echo Artist - Echo Song.webm'), 'video');

    const [candidate] = new LocalMvProvider().searchCandidates(makeTrack(audioPath));

    expect(candidate.reasons).toContain('mv folder');
    expect(candidate.score).toBeGreaterThanOrEqual(0.6);
  });

  it('matches files with common MV labels in the filename', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'Echo Song.flac');
    writeFileSync(audioPath, 'audio');
    writeFileSync(join(root, 'Echo Artist - Echo Song (Official MV) [1080p].mp4'), 'video');

    const [candidate] = new LocalMvProvider().searchCandidates(makeTrack(audioPath));

    expect(candidate.title).toBe('Echo Artist - Echo Song (Official MV) [1080p]');
    expect(candidate.reasons).toContain('artist/title exact');
    expect(candidate.score).toBeGreaterThanOrEqual(0.55);
  });

  it('filters unrelated videos', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'Echo Song.flac');
    writeFileSync(audioPath, 'audio');
    writeFileSync(join(root, 'Completely Different.avi'), 'video');

    expect(new LocalMvProvider().searchCandidates(makeTrack(audioPath))).toEqual([]);
  });

  it('sorts multiple candidates by score', () => {
    const root = makeTempRoot();
    const audioPath = join(root, 'Echo Song.flac');
    const mvFolder = join(root, 'MV');
    mkdirSync(mvFolder);
    writeFileSync(audioPath, 'audio');
    writeFileSync(join(root, 'Echo Song.mp4'), 'video');
    writeFileSync(join(mvFolder, 'Echo Song live.mkv'), 'video');

    const candidates = new LocalMvProvider().searchCandidates(makeTrack(audioPath));

    expect(candidates).toHaveLength(2);
    expect(candidates[0].score).toBeGreaterThanOrEqual(candidates[1].score);
  });
});
