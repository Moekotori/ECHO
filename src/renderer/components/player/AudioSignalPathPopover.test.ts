import { describe, expect, it } from 'vitest';
import type { AudioStatus } from '../../../shared/types/audio';
import { buildAudioSignalPathNodes, buildHeadroomMeter, signalLiveFillPercent } from './AudioSignalPathPopover';

const translateKey = (key: string): string => key;

const createStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: 'Test DAC',
  outputDeviceType: null,
  outputBackend: 'jsonrpc',
  activeOutputBackendImpl: 'native-daemon-output',
  outputMode: 'shared',
  activeDecodeBackendImpl: 'native-direct-daemon-libav',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'speed',
  currentFilePath: 'C:\\music\\01.flac',
  currentTrackId: 'track-1',
  durationSeconds: 120,
  positionSeconds: 1,
  channels: 2,
  codec: 'flac',
  bitDepth: 24,
  bitrate: null,
  fileSampleRate: 48_000,
  decoderOutputSampleRate: 48_000,
  requestedOutputSampleRate: 48_000,
  actualDeviceSampleRate: 48_000,
  sharedDeviceSampleRate: 48_000,
  resampling: false,
  ...overrides,
} as AudioStatus);

describe('buildAudioSignalPathNodes gapless visibility', () => {
  it('shows the armed gapless node when the default-off setting is enabled', () => {
    const nodes = buildAudioSignalPathNodes(createStatus({ gaplessPlaybackEnabled: true }), null, translateKey);

    expect(nodes.find((node) => node.title === 'audioSignalPath.node.transition')).toMatchObject({
      value: 'audioSignalPath.gapless.enabled',
      detail: 'audioSignalPath.gapless.pendingDetail',
      tone: 'process',
    });
  });

  it('shows the active host transition and hides the node when disabled', () => {
    const activeNodes = buildAudioSignalPathNodes(createStatus({
      gaplessPlaybackEnabled: true,
      automix: {
        enabled: false,
        active: true,
        mode: 'armed',
        transitionSeconds: null,
        transitionStartedAtSeconds: null,
        nextTrackId: 'track-2',
        gapless: true,
        engine: 'nativeGapless',
      },
    }), null, translateKey);
    const disabledNodes = buildAudioSignalPathNodes(createStatus({ gaplessPlaybackEnabled: false }), null, translateKey);

    expect(activeNodes.find((node) => node.title === 'audioSignalPath.node.transition')).toMatchObject({
      value: 'audioSignalPath.gapless.active',
      detail: 'audioSignalPath.gapless.activeDetail',
      tone: 'good',
    });
    expect(disabledNodes.some((node) => node.title === 'audioSignalPath.node.transition')).toBe(false);
  });
});

describe('signal path fallback meter', () => {
  const fallbackLevels = {
    inputPeakDb: -12,
    inputRmsDb: -18,
    estimatedOutputPeakDb: -12,
    estimatedOutputRmsDb: -18,
    visualSpectrum: [],
    visualSpectrumVersion: 2 as const,
    visualEnergy: 0,
    visualTransient: 0,
    visualTelemetryState: 'fallback' as const,
    headroomDb: 12,
    clipCount: 0,
    lastClipAt: null,
    meterSource: 'pre_native_estimated_post_dsp' as const,
  };

  it('uses the reported peak when fallback visual energy is intentionally zero', () => {
    const status = createStatus({ audioLevels: fallbackLevels });

    expect(signalLiveFillPercent(status)).toBe(81.25);
    expect(buildHeadroomMeter(status, translateKey)).toMatchObject({
      value: '-18.0 dB',
      fillPercent: 81.25,
    });
  });

  it('labels authoritative native post-DSP telemetry in the enhanced signal path', () => {
    const t = (key: string, options?: Record<string, string | number>): string =>
      options?.source ? `${key}:${options.source}` : key;
    const status = createStatus({
      audioLevels: {
        ...fallbackLevels,
        meterSource: 'native_post_dsp',
      },
    });

    expect(buildHeadroomMeter(status, t).detail).toContain('audioSignalPath.meter.sourceNative');
  });
});
