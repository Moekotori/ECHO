// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioDeviceInfo, AudioDiagnostics } from '../../../shared/types/audio';
import type { SmtcDiagnostics } from '../../../shared/types/smtc';
import { DiagnosticsAssistantPanel } from './DiagnosticsAssistantPanel';

const baseDiagnostics: AudioDiagnostics = {
  state: 'playing',
  host: 'ready',
  outputMode: 'shared',
  sharedBackend: 'windows',
  outputBackend: 'wasapi-shared',
  activeOutputBackendImpl: 'juce',
  useJuceOutputRequested: true,
  useJuceDecodeRequested: true,
  activeDecodeBackendImpl: 'ffmpeg',
  outputDeviceName: 'Speakers',
  currentFilePath: 'D:\\Music\\Private\\song.flac',
  currentTrackId: 'track-1',
  durationSeconds: 240,
  positionSeconds: 12,
  playbackRate: 1,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 48000,
  actualDeviceSampleRate: 48000,
  sharedDeviceSampleRate: 48000,
  resampling: true,
  ffmpegPath: 'D:\\ECHO\\tools\\ffmpeg.exe',
  ffmpegSource: 'bundled',
  ffmpegVersion: '6.1',
  ffmpegHealthy: true,
  soxrAvailable: true,
  resamplerEngine: 'soxr',
  resamplerFallbackActive: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  latencyProfile: 'balanced',
  sharedStabilityTier: 'standard',
  nativeDeviceBufferFrames: 480,
  nativeRequestedBufferFrames: 1024,
  nativeActualBufferFrames: 1024,
  nativeOutputLatencyMs: 21,
  nativePositionStalenessMs: 4,
  nativeFifoCapacityFrames: 48000,
  nativeStartupPrebufferFrames: 4800,
  nativeBufferedFrames: 9600,
  nativeBufferedMs: 200,
  nativeUnderrunCallbacks: 0,
  nativeUnderrunFrames: 0,
  lastSharedStabilityRecoveryAt: null,
  warnings: [],
  error: null,
  watchdogStatus: 'monitoring',
  recentWatchdogRecoveryCount: 0,
  lastWatchdogRecoveryTime: null,
};

const baseDevices: AudioDeviceInfo[] = [
  {
    id: 'shared:0',
    index: 0,
    name: 'Speakers',
    outputMode: 'shared',
    sampleRate: 48000,
    sharedDeviceSampleRate: 48000,
    isDefault: true,
  },
  {
    id: 'asio:1',
    index: 1,
    name: 'USB ASIO',
    outputMode: 'asio',
    sampleRate: 96000,
    sharedDeviceSampleRate: null,
    isDefault: false,
    asioOutputChannels: 2,
  },
];

const baseSmtcDiagnostics: SmtcDiagnostics = {
  enabled: true,
  platform: 'win32',
  hostState: 'running',
  initialized: true,
  hostPath: 'D:\\ECHO\\electron-app\\build\\echo-smtc-host.exe',
  lastMetadataAt: '2026-05-21T12:00:00.000Z',
  lastMetadataTrackId: 'track-1',
  lastMetadataTitle: 'SMTC Song',
  lastMetadataArtist: 'SMTC Artist',
  lastPlaybackState: 'playing',
  lastPlaybackStateAt: '2026-05-21T12:00:01.000Z',
  lastTimelineAt: '2026-05-21T12:00:02.000Z',
  lastTimelinePositionSeconds: 12,
  lastTimelineDurationSeconds: 240,
  enabledActions: { play: true, pause: true, previous: true, next: true, seek: true },
  lastCommand: 'next',
  lastCommandAt: '2026-05-21T12:00:03.000Z',
  lastError: null,
  recentErrors: [],
  recoveryInFlight: false,
  recoveryAttemptsInWindow: 0,
  canRecover: false,
  lastRecoveryAt: null,
  lyricsEnabled: false,
};

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

describe('DiagnosticsAssistantPanel', () => {
  it('loads audio diagnostics only after the assistant is expanded', async () => {
    const getDiagnostics = vi.fn().mockResolvedValue(baseDiagnostics);
    const getSmtcDiagnostics = vi.fn().mockResolvedValue(baseSmtcDiagnostics);
    const listDevices = vi.fn().mockResolvedValue(baseDevices);
    window.echo = { audio: { getDiagnostics, listDevices }, smtc: { getDiagnostics: getSmtcDiagnostics } } as unknown as Window['echo'];

    render(<DiagnosticsAssistantPanel lastCrashSummary={null} />);

    expect(getDiagnostics).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /诊断助手/ }));

    await waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSmtcDiagnostics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listDevices).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('wasapi-shared')).toBeTruthy();
    expect(screen.getAllByText('SMTC Song').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Speakers').length).toBeGreaterThan(0);
    expect(screen.getByText(/shared #0/)).toBeTruthy();
    expect(screen.getByText('USB ASIO')).toBeTruthy();
  });

  it('copies a safe audio summary without full local media paths', async () => {
    const getDiagnostics = vi.fn().mockResolvedValue({
      ...baseDiagnostics,
      nativeUnderrunCallbacks: 2,
      nativeUnderrunFrames: 512,
      warnings: ['sample_rate_mismatch'],
    });
    window.echo = { audio: { getDiagnostics, listDevices: vi.fn().mockResolvedValue(baseDevices) } } as unknown as Window['echo'];

    render(<DiagnosticsAssistantPanel lastCrashSummary={null} />);
    fireEvent.click(screen.getByRole('button', { name: /诊断助手/ }));
    await screen.findByText('检测到 underrun');

    fireEvent.click(screen.getByRole('button', { name: /复制安全摘要/ }));

    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const copied = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied).toContain('ECHO Next Diagnostics Assistant');
    expect(copied).toContain('Audio Pipeline');
    expect(copied).toContain('Recommendations');
    expect(copied).toContain('Output Devices');
    expect(copied).toContain('SMTC');
    expect(copied).toContain('shared#0: Speakers');
    expect(copied).toContain('currentFileBasename: song.flac');
    expect(copied).not.toContain('D:\\Music\\Private\\song.flac');
  });

  it('exports the safe diagnostics package through the desktop bridge', async () => {
    const exportDiagnosticsZip = vi.fn().mockResolvedValue('D:\\Downloads\\echo-diagnostics.zip');
    window.echo = {
      audio: { getDiagnostics: vi.fn().mockResolvedValue(baseDiagnostics), listDevices: vi.fn().mockResolvedValue(baseDevices) },
      diagnostics: { exportDiagnosticsZip },
    } as unknown as Window['echo'];

    render(<DiagnosticsAssistantPanel lastCrashSummary={null} />);
    fireEvent.click(screen.getByRole('button', { name: /诊断助手/ }));
    await screen.findByText('wasapi-shared');

    fireEvent.click(screen.getByRole('button', { name: /导出安全诊断包/ }));

    await waitFor(() => expect(exportDiagnosticsZip).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/echo-diagnostics\.zip/)).toBeTruthy();
  });
});
