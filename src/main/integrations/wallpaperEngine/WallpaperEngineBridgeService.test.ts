import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import {
  WallpaperEngineBridgeService,
  createWallpaperEngineBridgeSnapshot,
} from './WallpaperEngineBridgeService';
import {
  getWallpaperEngineBridgeClientCount,
  isWallpaperEngineBridgeVisualTelemetryActive,
  resetWallpaperEngineBridgeRuntimeForTests,
} from './WallpaperEngineBridgeRuntime';

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
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: 'ffmpeg',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: 'D:\\Music\\secret.flac',
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

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json() as T;
};

describe('WallpaperEngineBridgeService', () => {
  afterEach(() => {
    resetWallpaperEngineBridgeRuntimeForTests();
  });

  it('builds a Wallpaper Engine snapshot from pre-native telemetry without exposing file paths', () => {
    const snapshot = createWallpaperEngineBridgeSnapshot(createStatus());

    expect(snapshot).toMatchObject({
      integration: 'wallpaper-engine',
      outputMode: 'exclusive',
      outputBackend: 'wasapi-exclusive',
      track: {
        title: 'Signal',
        artist: 'ECHO',
        positionSeconds: 42,
      },
      capabilities: {
        preNativeAudioTelemetry: true,
        supportsWasapiExclusive: true,
        supportsAsio: true,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret.flac');
    expect(snapshot.audio.visualSpectrum).toHaveLength(32);
    expect(snapshot.audio.visualTelemetryState).toBe('pcm');
  });

  it('serves snapshots for WASAPI exclusive and ASIO output modes', async () => {
    const audioSession = new FakeAudioSession(createStatus());
    const service = new WallpaperEngineBridgeService({ port: 0, audioSession });
    const status = await service.start();

    try {
      const exclusive = await readJson<ReturnType<typeof createWallpaperEngineBridgeSnapshot>>(`${status.url}/snapshot`);
      expect(exclusive.outputMode).toBe('exclusive');
      expect(exclusive.outputBackend).toBe('wasapi-exclusive');

      audioSession.setStatus(createStatus({
        outputMode: 'asio',
        outputBackend: 'asio',
        outputDeviceType: 'ASIO',
        activeOutputBackendImpl: 'legacy-asio-sdk',
        outputDeviceName: 'TEAC ASIO USB DRIVER',
      }));
      const asio = await readJson<ReturnType<typeof createWallpaperEngineBridgeSnapshot>>(`${status.url}/snapshot`);
      expect(asio.outputMode).toBe('asio');
      expect(asio.outputBackend).toBe('asio');
      expect(asio.capabilities.supportsAsio).toBe(true);
    } finally {
      await service.stop();
    }
  });

  it('activates visual telemetry only while a Wallpaper Engine event client is connected', async () => {
    const audioSession = new FakeAudioSession(createStatus());
    const service = new WallpaperEngineBridgeService({ port: 0, audioSession });
    const status = await service.start();

    await new Promise<void>((resolve, reject) => {
      const request = get(`${status.url}/events`, (response) => {
        response.setEncoding('utf8');
        response.once('data', (chunk) => {
          try {
            expect(String(chunk)).toContain('event: snapshot');
            expect(getWallpaperEngineBridgeClientCount()).toBe(1);
            expect(isWallpaperEngineBridgeVisualTelemetryActive()).toBe(true);
            request.destroy();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getWallpaperEngineBridgeClientCount()).toBe(0);
    expect(isWallpaperEngineBridgeVisualTelemetryActive()).toBe(false);
    await service.stop();
  });
});
