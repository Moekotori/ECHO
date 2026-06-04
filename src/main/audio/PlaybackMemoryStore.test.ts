import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import { PlaybackMemoryStore } from './PlaybackMemoryStore';

const electronMock = vi.hoisted(() => ({
  userDataPath: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataPath,
  },
}));

const roots: string[] = [];

const memoryPath = (): string => join(electronMock.userDataPath, 'echo-playback-memory.json');

const makeStatus = (patch: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'paused',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: 'D:\\Music\\song.flac',
  currentTrackId: null,
  durationSeconds: 120,
  positionSeconds: 12,
  channels: 2,
  codec: 'flac',
  bitDepth: 16,
  bitrate: 900000,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: 44100,
  sharedDeviceSampleRate: 44100,
  resampling: false,
  bitPerfectCandidate: true,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...patch,
});

beforeEach(() => {
  electronMock.userDataPath = mkdtempSync(join(tmpdir(), 'echo-playback-memory-'));
  roots.push(electronMock.userDataPath);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('PlaybackMemoryStore', () => {
  it('keeps local file memory even when no library track id exists', () => {
    const store = new PlaybackMemoryStore();

    store.save(makeStatus());

    expect(store.load()).toMatchObject({
      filePath: 'D:\\Music\\song.flac',
      trackId: null,
      positionSeconds: 12,
    });
  });

  it('does not persist anonymous HTTP stream memory from volatile receiver playback', () => {
    const store = new PlaybackMemoryStore();
    store.save(makeStatus());

    store.save(makeStatus({
      currentFilePath: 'http://192.168.1.8/media/N8RfPgDeUPDAPIFsYKSAHFRCrcjsaWuesur',
      currentTrackId: null,
    }));

    expect(existsSync(memoryPath())).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('ignores stale anonymous HTTP stream memory written by older versions', () => {
    writeFileSync(
      memoryPath(),
      JSON.stringify({
        filePath: 'https://m701.music.126.net/stream/N8RfPgDeUPDAPIFsYKSAHFRCrcjsaWuesur',
        trackId: null,
        positionSeconds: 74,
        durationSeconds: 180,
        updatedAt: '2026-05-31T00:00:00.000Z',
      }),
      'utf8',
    );

    expect(new PlaybackMemoryStore().load()).toBeNull();
    expect(readFileSync(memoryPath(), 'utf8')).toContain('N8RfPgDeUPDAPIFsYKSAHFRCrcjsaWuesur');
  });

  it('keeps streaming provider memory when a stable track id and metadata are present', () => {
    const store = new PlaybackMemoryStore();

    store.save(makeStatus({
      currentFilePath: 'https://cdn.example.test/audio/token.mp3',
      currentTrackId: 'streaming:qqmusic:123',
      currentTrackTitle: 'Stream Song',
      currentTrackArtist: 'Stream Artist',
      currentTrackAlbum: 'Stream Album',
      currentTrackAlbumArtist: 'Stream Album Artist',
      currentTrackCoverUrl: 'https://cover.example.test/song.jpg',
      codec: 'mp3',
      bitrate: 320000,
    }));

    expect(store.load()).toMatchObject({
      filePath: 'https://cdn.example.test/audio/token.mp3',
      trackId: 'streaming:qqmusic:123',
      probe: {
        codec: 'mp3',
        bitrate: 320000,
      },
      metadata: {
        title: 'Stream Song',
        artist: 'Stream Artist',
        album: 'Stream Album',
        albumArtist: 'Stream Album Artist',
        coverUrl: 'https://cover.example.test/song.jpg',
      },
    });
  });
});
