import { describe, expect, it } from 'vitest';
import { NoopDiscordPresenceService } from './NoopDiscordPresenceService';
import type { AudioStatus } from '../../../shared/types/audio';

const status = {
  host: 'ready',
  state: 'playing',
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
  positionSeconds: 10,
  channels: 2,
  codec: 'flac',
  bitDepth: 24,
  bitrate: null,
  fileSampleRate: 96000,
  decoderOutputSampleRate: 96000,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
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
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
} satisfies AudioStatus;

describe('NoopDiscordPresenceService', () => {
  it('does not throw for lifecycle and playback updates', async () => {
    const service = new NoopDiscordPresenceService();

    expect(() => service.initialize()).not.toThrow();
    expect(() => service.updateFromAudioStatus(status)).not.toThrow();
    expect(() => service.clearActivity()).not.toThrow();
    expect(() => service.dispose()).not.toThrow();

    expect(service.getStatus()).toMatchObject({
      enabled: false,
      available: false,
      connected: false,
    });
  });
});
