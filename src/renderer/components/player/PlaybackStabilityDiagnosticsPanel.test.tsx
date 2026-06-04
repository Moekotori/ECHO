// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaybackStabilityDiagnosticsPanel } from './PlaybackStabilityDiagnosticsPanel';
import type { AudioDiagnostics, AudioStatus } from '../../../shared/types/audio';

const translations: Record<string, string> = {
  'settings.playback.stability.action.copied': '已复制',
  'settings.playback.stability.action.copy': '复制诊断信息',
  'settings.playback.stability.action.refresh': '刷新播放稳定性诊断',
  'settings.playback.stability.error.desktopBridgeUnavailable': '桌面桥接不可用。',
  'settings.playback.stability.field.lastWatchdogRecoveryTime': '上次 watchdog 恢复时间',
  'settings.playback.stability.field.recentWatchdogRecoveryCount': '近期 watchdog 恢复次数',
  'settings.playback.stability.field.watchdogStatus': 'watchdog 状态',
  'settings.playback.stability.title': '播放稳定性诊断',
  'settings.playback.stability.value.unknown': 'N/A',
};

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

const baseStatus: AudioStatus = {
  host: 'not-initialized',
  state: 'idle',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  nativeOutputFormat: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: 'Flat',
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
};

const diagnosticsFromStatus = (status: AudioStatus, overrides: Partial<AudioDiagnostics> = {}): AudioDiagnostics => ({
  state: status.state,
  host: status.host,
  outputMode: status.outputMode,
  outputBackend: status.outputBackend,
  activeOutputBackendImpl: status.activeOutputBackendImpl,
  nativeOutputFormat: status.nativeOutputFormat ?? null,
  useJuceOutputRequested: status.useJuceOutputRequested,
  activeDecodeBackendImpl: status.activeDecodeBackendImpl,
  useJuceDecodeRequested: status.useJuceDecodeRequested,
  outputDeviceName: status.outputDeviceName,
  currentFilePath: status.currentFilePath,
  currentTrackId: status.currentTrackId,
  durationSeconds: status.durationSeconds,
  positionSeconds: status.positionSeconds,
  playbackRate: status.playbackRate,
  fileSampleRate: status.fileSampleRate,
  decoderOutputSampleRate: status.decoderOutputSampleRate,
  requestedOutputSampleRate: status.requestedOutputSampleRate,
  actualDeviceSampleRate: status.actualDeviceSampleRate,
  sharedDeviceSampleRate: status.sharedDeviceSampleRate,
  resampling: status.resampling,
  bitPerfectCandidate: status.bitPerfectCandidate,
  sampleRateMismatch: status.sampleRateMismatch,
  warnings: status.warnings,
  error: status.error,
  watchdogStatus: status.state === 'playing' ? 'monitoring' : 'idle',
  recentWatchdogRecoveryCount: 0,
  lastWatchdogRecoveryTime: null,
  ...overrides,
});

beforeEach(() => {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).echo;
});

const expandPanel = (): void => {
  fireEvent.click(screen.getByRole('button', { expanded: false }));
};

describe('PlaybackStabilityDiagnosticsPanel', () => {
  it('renders without active playback', async () => {
    const getDiagnostics = vi.fn().mockResolvedValue(diagnosticsFromStatus(baseStatus));
    window.echo = { audio: { getDiagnostics } } as unknown as Window['echo'];

    render(<PlaybackStabilityDiagnosticsPanel />);
    expect(getDiagnostics).not.toHaveBeenCalled();
    expandPanel();

    await waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
    expect(screen.getByText('播放稳定性诊断')).toBeTruthy();
    expect(screen.getAllByText('idle').length).toBeGreaterThan(0);
    expect(screen.getByText('not-initialized')).toBeTruthy();
  });

  it('shows playing diagnostics fields', async () => {
    const playingStatus: AudioStatus = {
      ...baseStatus,
      host: 'ready',
      state: 'playing',
      outputBackend: 'wasapi-shared',
      activeOutputBackendImpl: 'legacy-wasapi-shared',
      nativeOutputFormat: 'pcm24in32',
      outputDeviceName: 'Speakers',
      currentFilePath: 'D:\\Music\\song.flac',
      currentTrackId: 'track-1',
      durationSeconds: 240,
      positionSeconds: 12.5,
      playbackRate: 1,
      fileSampleRate: 44100,
      decoderOutputSampleRate: 48000,
      requestedOutputSampleRate: 48000,
      actualDeviceSampleRate: 48000,
      resampling: true,
    };
    window.echo = {
      audio: {
        getDiagnostics: vi.fn().mockResolvedValue(diagnosticsFromStatus(playingStatus, { watchdogStatus: 'monitoring' })),
      },
    } as unknown as Window['echo'];

    render(<PlaybackStabilityDiagnosticsPanel />);
    expandPanel();

    expect(await screen.findByText('playing')).toBeTruthy();
    expect(screen.getByText('wasapi-shared')).toBeTruthy();
    expect(screen.getByText('legacy-wasapi-shared')).toBeTruthy();
    expect(screen.getByText('pcm24in32')).toBeTruthy();
    expect(screen.getByText('Speakers')).toBeTruthy();
    expect(screen.getByText('D:\\Music\\song.flac')).toBeTruthy();
    expect(screen.getByText('44100')).toBeTruthy();
    expect(screen.getAllByText('48000').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('monitoring')).toBeTruthy();
  });

  it('shows warnings and errors', async () => {
    window.echo = {
      audio: {
        getDiagnostics: vi.fn().mockResolvedValue(
          diagnosticsFromStatus(
            {
              ...baseStatus,
              state: 'error',
              warnings: ['audio_watchdog_recovered_native_output:1'],
              error: 'audio_watchdog_recovery_limit_exceeded',
            },
            { watchdogStatus: 'limited', recentWatchdogRecoveryCount: 2 },
          ),
        ),
      },
    } as unknown as Window['echo'];

    render(<PlaybackStabilityDiagnosticsPanel />);
    expandPanel();

    expect(await screen.findByText('audio_watchdog_recovered_native_output:1')).toBeTruthy();
    expect(screen.getByText('audio_watchdog_recovery_limit_exceeded')).toBeTruthy();
    expect(screen.getByText('limited')).toBeTruthy();
  });

  it('copies complete diagnostic text', async () => {
    window.echo = {
      audio: {
        getDiagnostics: vi.fn().mockResolvedValue(
          diagnosticsFromStatus(
            {
              ...baseStatus,
              state: 'playing',
              outputBackend: 'asio',
              activeOutputBackendImpl: 'legacy-asio-sdk',
              nativeOutputFormat: 'pcm16',
              currentTrackId: 'track-copy',
              warnings: ['sample_rate_mismatch'],
            },
            {
              watchdogStatus: 'recovering',
              recentWatchdogRecoveryCount: 1,
              lastWatchdogRecoveryTime: '2026-05-14T01:00:00.000Z',
              sharedStabilityTier: 'recovery',
              nativeDeviceBufferFrames: 4096,
              nativeFifoCapacityFrames: 48000,
              nativeStartupPrebufferFrames: 8640,
              nativeBufferedFrames: 12000,
              nativeBufferedMs: 250,
              nativeUnderrunCallbacks: 3,
              nativeUnderrunFrames: 512,
              lastSharedStabilityRecoveryAt: '2026-05-14T01:00:02.000Z',
            },
          ),
        ),
      },
    } as unknown as Window['echo'];

    render(<PlaybackStabilityDiagnosticsPanel />);
    expandPanel();
    await screen.findByText('track-copy');
    fireEvent.click(screen.getByRole('button', { name: /复制诊断信息/ }));

    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const copied = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied).toContain('ECHO Next Playback Stability Diagnostics');
    expect(copied).toContain('state: playing');
    expect(copied).toContain('outputBackend: asio');
    expect(copied).toContain('activeOutputBackendImpl: legacy-asio-sdk');
    expect(copied).toContain('nativeOutputFormat: pcm16');
    expect(copied).toContain('warnings: sample_rate_mismatch');
    expect(copied).toContain('watchdogStatus: recovering');
    expect(copied).toContain('recentWatchdogRecoveryCount: 1');
    expect(copied).toContain('lastWatchdogRecoveryTime: 2026-05-14T01:00:00.000Z');
    expect(copied).toContain('sharedStabilityTier: recovery');
    expect(copied).toContain('nativeDeviceBufferFrames: 4096');
    expect(copied).toContain('nativeBufferedMs: 250');
    expect(copied).toContain('nativeUnderrunCallbacks: 3');
    expect(copied).toContain('lastSharedStabilityRecoveryAt: 2026-05-14T01:00:02.000Z');
  });

  it('falls back to status and tolerates missing fields', async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: 'playing', warnings: undefined });
    window.echo = { audio: { getStatus } } as unknown as Window['echo'];

    render(<PlaybackStabilityDiagnosticsPanel />);
    expandPanel();

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText('playing')).toBeTruthy();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });
});
