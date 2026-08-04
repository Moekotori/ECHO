import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import type { TrackLyrics } from '../../../shared/types/lyrics';
import { StageBridgeService, createStageBridgeSnapshot } from './StageBridgeService';

class FakeAudioSession extends EventEmitter {
  private status: AudioStatus;

  constructor(status: AudioStatus) {
    super();
    this.status = status;
  }

  getStatus(): AudioStatus {
    return this.status;
  }

  setStatus(status: AudioStatus): void {
    this.status = status;
    this.emit('status', status);
  }
}

const createStatus = (patch: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  outputDeviceId: 'device-1',
  outputDeviceName: 'TEAC USB DAC',
  outputDeviceType: 'Windows Audio (Exclusive Mode)',
  outputBackend: 'wasapi-exclusive',
  activeOutputBackendImpl: 'legacy-wasapi-exclusive',
  nativeOutputFormat: 'float32',
  outputMode: 'exclusive',
  sharedBackend: 'auto',
  activeDecodeBackendImpl: 'ffmpeg',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: 'D:\\Music\\private.flac',
  currentTrackId: 'track-1',
  currentTrackTitle: 'Signal',
  currentTrackArtist: 'ECHO',
  currentTrackAlbum: 'Bridge',
  currentTrackAlbumArtist: 'ECHO',
  currentTrackCoverUrl: 'echo-cover://track-1',
  durationSeconds: 180,
  positionSeconds: 42,
  channels: 2,
  codec: 'flac',
  bitDepth: 24,
  bitrate: 1200000,
  fileSampleRate: 96000,
  decoderOutputSampleRate: 96000,
  requestedOutputSampleRate: 96000,
  actualDeviceSampleRate: 96000,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: true,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  audioLevels: {
    inputPeakDb: -4.2,
    inputRmsDb: -18.5,
    estimatedOutputPeakDb: -4.2,
    estimatedOutputRmsDb: -18.5,
    visualSpectrum: Array.from({ length: 32 }, (_, index) => index / 31),
    visualSpectrumVersion: 2,
    visualEnergy: 0.72,
    visualTransient: 0.35,
    visualTelemetryState: 'pcm',
    headroomDb: 4.2,
    clipCount: 0,
    lastClipAt: null,
    meterSource: 'pre_native_estimated_post_dsp',
  },
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...patch,
});

const lyrics: TrackLyrics = {
  id: 'lyrics-1',
  trackId: 'track-1',
  provider: 'local',
  kind: 'synced',
  title: 'Signal',
  artist: 'ECHO',
  album: 'Bridge',
  durationSeconds: 180,
  offsetMs: 0,
  score: 100,
  cachedAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  lines: [
    { timeMs: 30_000, text: 'First line' },
    { timeMs: 42_000, text: 'Current line', translation: '当前行' },
    { timeMs: 48_000, text: 'Next line' },
  ],
};

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as T;
};

describe('StageBridgeService', () => {
  let service: StageBridgeService | null = null;

  afterEach(async () => {
    await service?.stop();
    service = null;
  });

  it('builds a public Stage snapshot with current lyrics and no file path', async () => {
    const snapshot = await createStageBridgeSnapshot(createStatus(), () => ({
      getLyricsForTrack: async () => lyrics,
    }));

    expect(snapshot).toMatchObject({
      integration: 'stage',
      state: 'playing',
      track: {
        title: 'Signal',
        artist: 'ECHO',
        positionSeconds: 42,
      },
      lyrics: {
        kind: 'synced',
        current: {
          text: 'Current line',
          translation: '当前行',
        },
        next: {
          text: 'Next line',
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('private.flac');
  });

  it('serves OBS and Stage API only after the matching setting is enabled', async () => {
    const audioSession = new FakeAudioSession(createStatus());
    service = new StageBridgeService({
      port: 0,
      audioSession,
      getLyrics: () => ({ getLyricsForTrack: async () => lyrics }),
    });
    let status = await service.configure({ obsEnabled: false, apiEnabled: false });
    expect(status.running).toBe(false);

    status = await service.configure({ obsEnabled: true, apiEnabled: false });
    expect(status.running).toBe(true);
    expect(status.obsUrl).toBe(`${status.url}/obs`);
    expect((await fetch(`${status.url}/obs`)).ok).toBe(true);
    const eventsController = new AbortController();
    const eventsResponse = await fetch(`${status.url}/events`, { signal: eventsController.signal });
    expect(eventsResponse.ok).toBe(true);
    eventsController.abort();
    expect((await fetch(`${status.url}/api/stage/status`)).status).toBe(403);

    status = await service.configure({ obsEnabled: true, apiEnabled: true });
    const snapshot = await readJson<Awaited<ReturnType<typeof createStageBridgeSnapshot>>>(`${status.url}/api/stage/status`);
    expect(snapshot.lyrics.current?.text).toBe('Current line');
  });

  it('streams snapshots over SSE when Stage API is enabled', async () => {
    const audioSession = new FakeAudioSession(createStatus());
    service = new StageBridgeService({
      port: 0,
      audioSession,
      getLyrics: () => ({ getLyricsForTrack: async () => lyrics }),
    });
    const status = await service.configure({ obsEnabled: false, apiEnabled: true });

    await new Promise<void>((resolve, reject) => {
      const request = get(`${status.url}/events`, (response) => {
        response.setEncoding('utf8');
        response.once('data', (chunk) => {
          try {
            expect(String(chunk)).toContain('event: snapshot');
            expect(service?.getServerStatus().eventClients).toBe(1);
            request.destroy();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
    });
  });
});
