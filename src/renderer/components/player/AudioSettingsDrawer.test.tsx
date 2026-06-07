// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioSettingsDrawer } from './AudioSettingsDrawer';
import type { AudioDeviceInfo, AudioStatus } from '../../../shared/types/audio';

const testTranslations: Record<string, string> = {
  'audioDrawer.buffer.asio': 'ASIO buffer',
  'audioDrawer.buffer.auto': 'Auto',
  'audioDrawer.buffer.default': 'Default',
  'audioDrawer.buffer.latencyProfile': 'Latency profile',
  'audioDrawer.buffer.low': 'Low',
  'audioDrawer.buffer.profileDefault': 'Profile default',
  'audioDrawer.buffer.safer': 'Safer',
  'audioDrawer.buffer.stable': 'Stable',
  'audioDrawer.buffer.title': 'Buffer Settings',
  'audioDrawer.buffer.ultraLow': 'Ultra low',
  'audioDrawer.badge.juceFallback': 'JUCE fallback',
  'audioDrawer.badge.juceOutput': 'JUCE output',
  'audioDrawer.latency.balanced': 'Balanced',
  'audioDrawer.latency.balancedDetail': '2048 frames',
  'audioDrawer.latency.lowLatency': 'Low latency',
  'audioDrawer.latency.lowLatencyDetail': '~8 ms / adaptive',
  'audioDrawer.latency.stable': 'Stable',
  'audioDrawer.latency.stableDetail': '8192 frames',
  'audioDrawer.option.active': 'On',
  'audioDrawer.option.juceDecode': 'Resident Native Decode',
  'audioDrawer.option.juceOutput': 'JUCE Main Output',
  'audioDrawer.option.dsdDop': 'DSD DoP Direct Pilot',
  'audioDrawer.option.releaseExclusiveOnPause': 'Release Exclusive on Pause',
  'audioDrawer.note.releaseExclusiveOnPause': 'Pause releases WASAPI Exclusive.',
  'audioDrawer.guard.exclusiveInstability.title': 'Auto-switch unstable Exclusive',
  'audioDrawer.guard.exclusiveInstability.description': 'Switch unstable Exclusive to Shared.',
  'audioDrawer.option.lowLoadPlaybackMode': 'Low-Load Playback Mode',
  'audioDrawer.option.lowLoadPlaybackModeDescription': 'Disables heavy playback visuals and analysis while playing.',
  'audioDrawer.option.lowLoadPlaybackEnhancements': 'Enhanced Low-Load Protection',
  'audioDrawer.option.lowLoadPlaybackEnhancementsDescription': 'Further reduces polling, diagnostics, lyrics, and library background work while playing.',
  'audioDrawer.option.set': 'Set',
  'audioDrawer.option.showAsioPanelSettings': 'Show ASIO panel settings',
  'audioDrawer.option.showAsioPanelSettingsDescription': 'Show ASIO panel buttons',
  'audioDrawer.option.alsaShared': 'ALSA',
  'audioDrawer.option.alsaSharedDescription': 'Use Linux ALSA output',
  'audioDrawer.action.openAsioPanel': 'Open ASIO Panel',
  'audioDrawer.troubleshooting.description': 'Use this when audio is stuck.',
  'audioDrawer.troubleshooting.hardAction': 'Restart Windows Audio Service',
  'audioDrawer.troubleshooting.hardBusy': 'Restarting Windows Audio Service',
  'audioDrawer.troubleshooting.hardConfirm': 'This affects all apps. Continue?',
  'audioDrawer.troubleshooting.hardDone': 'Windows audio service recovered.',
  'audioDrawer.troubleshooting.softAction': 'Restart Audio Engine',
  'audioDrawer.troubleshooting.softBusy': 'Restarting Audio Engine',
  'audioDrawer.troubleshooting.softDone': 'Audio engine restarted.',
  'audioDrawer.troubleshooting.title': 'Audio Troubleshooting',
  'audioDrawer.badge.soxrResampler': 'SOXR',
  'audioDrawer.badge.upsampling': 'Upsampling',
  'audioDrawer.meter.chain': 'Chain',
  'audioDrawer.signal.asioSdkOutput': 'ASIO SDK output',
  'audioDrawer.signal.ffmpegDecode': 'FFmpeg decode',
  'audioDrawer.signal.juceDecode': 'JUCE decode',
  'audioDrawer.signal.juceDecodeFallback': 'JUCE decode fallback',
  'audioDrawer.signal.juceDecodeStandby': 'JUCE decode not used',
  'audioDrawer.signal.dsdDop': 'DSF bitstream -> DoP',
  'audioDrawer.signal.dsdDopFallback': 'DSD DoP fallback',
  'audioDrawer.signal.dsdDopStandby': 'DSD DoP not used',
  'audioDrawer.device.asioDriver': 'ASIO driver',
  'audioDrawer.device.systemAudio': 'Windows Direct Output',
  'audioDrawer.device.systemAudioDescription': 'Default Windows audio path for headphones, Bluetooth, and computer speakers',
  'audioDrawer.warning.highOutputSampleRate': '当前音频设备采样率过高，可能导致播放速度异常，建议改为 48 kHz。',
  'audioProfessional.action.hideDetails': 'Hide professional details',
  'audioProfessional.action.refresh': 'Refresh status',
  'audioProfessional.action.showDetails': 'Show professional details',
  'audioProfessional.badge.bitPerfect': 'Bit-perfect',
  'audioProfessional.badge.dsp': 'DSP active',
  'audioProfessional.badge.replayGain': 'ReplayGain',
  'audioProfessional.badge.resampling': 'Resampling',
  'audioProfessional.badge.sampleMismatch': 'Sample-rate mismatch',
  'audioProfessional.badge.upsampling': 'Upsampling',
  'audioProfessional.badge.warning': 'Device issue/warning',
  'audioProfessional.issue.reason': 'Reason',
  'audioProfessional.group.directDsp': 'Direct And DSP',
  'audioProfessional.group.playbackChain': 'Playback Chain',
  'audioProfessional.group.sampleRate': 'Sample-Rate Chain',
  'audioProfessional.group.stability': 'Stability',
  'audioProfessional.summary.pending': 'Waiting for audio status',
  'audioProfessional.title': 'Professional Playback Status',
  'audioProfessional.value.disabled': 'Disabled',
  'audioProfessional.value.enabled': 'Enabled',
  'audioProfessional.value.no': 'No',
  'audioProfessional.value.pending': 'Pending',
  'audioProfessional.value.ready': 'Ready',
  'audioProfessional.value.sharedMixer': 'Shared mixer',
  'audioProfessional.value.systemDefault': 'System default output',
  'audioProfessional.value.unknown': 'n/a',
  'audioProfessional.value.yes': 'Yes',
  'audioDrawer.meter.upsample': 'Upsampling',
  'audioProfessional.row.upsampling': 'Upsampling',
};

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (testTranslations[key]) {
        return testTranslations[key];
      }

      const value = key.split('.').at(-1) ?? key;

      if (value === 'value' && options?.value !== undefined) {
        return `${options.value} ms`;
      }

      if (value === 'status') {
        return `Requested ${options?.requested ?? 'Auto'} frames / opened ${options?.opened ?? 'n/a'} frames`;
      }

      return value;
    },
  }),
}));

const baseStatus: AudioStatus = {
  host: 'ready',
  state: 'playing',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: true,
  activeDecodeBackendImpl: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: 2,
  codec: 'flac',
  bitDepth: 16,
  bitrate: 900000,
  fileSampleRate: 48000,
  decoderOutputSampleRate: 48000,
  requestedOutputSampleRate: 48000,
  actualDeviceSampleRate: 48000,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  latencyProfile: 'lowLatency',
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: 'Flat',
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  nativeRequestedBufferFrames: null,
  nativeActualBufferFrames: null,
  nativeOutputLatencyMs: null,
  warnings: [],
  error: null,
};

const soxrResamplingStatus: AudioStatus = {
  ...baseStatus,
  fileSampleRate: 192000,
  decoderOutputSampleRate: 48000,
  requestedOutputSampleRate: 48000,
  actualDeviceSampleRate: 48000,
  resampling: true,
  resamplerEngine: 'soxr',
  resamplerFallbackActive: false,
};

const echoSrcUpsamplingStatus: AudioStatus = {
  ...soxrResamplingStatus,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 176400,
  requestedOutputSampleRate: 176400,
  actualDeviceSampleRate: 176400,
  echoSrcMode: 'family4x',
  echoSrcQualityProfile: 'transparent',
  echoSrcTargetSampleRate: 176400,
  echoSrcActive: true,
  bitPerfectDisabledReason: 'echo_src_enabled',
};

const asioDevice: AudioDeviceInfo = {
  id: 'asio:0',
  index: 0,
  name: 'TEAC ASIO',
  outputMode: 'asio',
  sampleRate: null,
  sharedDeviceSampleRate: 48000,
  isDefault: true,
};

const renderDrawer = (
  status: AudioStatus,
  setOutput = vi.fn().mockResolvedValue(status),
  resetEngine = vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
  forceRestart = vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
  restartWindowsAudioService = vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
  extraProps: Partial<ComponentProps<typeof AudioSettingsDrawer>> = {},
  devices: AudioDeviceInfo[] = [asioDevice],
): void => {
  window.echo = {
    app: {
      getSettings: vi.fn().mockResolvedValue({
        rememberedAudioOutput: { enabled: false },
        audioUseJuceOutput: status.useJuceOutputRequested,
        audioUseJuceDecode: status.useJuceDecodeRequested,
        audioDsdOutputMode: status.dsdOutputModeRequested ?? 'pcm',
        audioReleaseExclusiveOnPauseExperimentalEnabled: false,
        lowLoadPlaybackModeEnabled: false,
        lowLoadPlaybackEnhancementsEnabled: false,
      }),
      setSettings: vi.fn().mockResolvedValue({}),
    },
    audio: {
      listDevices: vi.fn().mockResolvedValue(devices),
      getStatus: vi.fn().mockResolvedValue(status),
      getDiagnostics: vi.fn().mockResolvedValue(status),
      setOutput,
      resetEngine,
      forceRestart,
      restartWindowsAudioService,
    },
    connect: {
      getStatus: vi.fn().mockResolvedValue({
        deviceId: null,
        protocol: null,
        state: 'idle',
        currentTrackId: null,
        metadata: null,
        positionSeconds: 0,
        durationSeconds: 0,
        latencyMs: null,
        error: null,
        updatedAt: '2026-05-24T00:00:00.000Z',
      }),
      disconnect: vi.fn().mockResolvedValue({
        deviceId: null,
        protocol: null,
        state: 'idle',
        currentTrackId: null,
        metadata: null,
        positionSeconds: 0,
        durationSeconds: 0,
        latencyMs: null,
        error: null,
        updatedAt: '2026-05-24T00:00:00.000Z',
      }),
    },
  } as unknown as Window['echo'];

  render(
    <AudioSettingsDrawer
      isOpen
      status={status}
      onClose={vi.fn()}
      onStatusChange={vi.fn()}
      {...extraProps}
    />,
  );
};

const renderDrawerWithDevices = (status: AudioStatus, devices: AudioDeviceInfo[]): void => {
  renderDrawer(
    status,
    vi.fn().mockResolvedValue(status),
    vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
    vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
    vi.fn().mockResolvedValue({ ...status, state: 'stopped' }),
    {},
    devices,
  );
};

const setNavigatorUserAgent = (userAgent: string): void => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: userAgent.includes('Linux') ? 'Linux x86_64' : 'Win32',
  });
};

const openAdvancedControls = (): void => {
  const toggle = screen.getByRole('button', { name: /advancedOutput/ });

  if (toggle.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(toggle);
  }
};

const openBufferControls = (): void => {
  openAdvancedControls();

  const toggle = document.querySelector('.audio-buffer-collapse-button');

  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error('Buffer controls toggle was not rendered');
  }

  fireEvent.click(toggle);
};

beforeEach(() => {
  window.localStorage.clear();
  setNavigatorUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).echo;
});

describe('AudioSettingsDrawer ASIO buffer controls', () => {
  it('shows low latency while WASAPI exclusive mode is selected', () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'exclusive',
      outputBackend: 'wasapi-exclusive',
      latencyProfile: 'lowLatency',
    });
    openBufferControls();

    expect(screen.getByRole('button', { name: /Low latency/ }).className).toContain('active');
    expect(screen.getByRole('button', { name: /Balanced/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stable/ })).toBeTruthy();
  });

  it('shows Windows-only output controls on Windows', async () => {
    renderDrawer(baseStatus);

    await waitFor(() => expect(screen.getAllByText('TEAC ASIO').length).toBeGreaterThan(0));

    expect(screen.getByRole('heading', { name: 'asioDevices' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /wasapiExclusive/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /TEAC ASIO/ })).toBeTruthy();
  });

  it('shows advanced channel routes for ASIO4ALL devices', async () => {
    renderDrawerWithDevices(baseStatus, [{
      id: 'asio:1',
      index: 1,
      name: 'ASIO4ALL v2',
      outputMode: 'asio',
      sampleRate: null,
      sharedDeviceSampleRate: 48000,
      isDefault: false,
      asioOutputChannels: 4,
      asioOutputChannelStart: 0,
      asioChannelNames: ['Realtek 1', 'Realtek 2', 'USB 1', 'USB 2'],
    }]);

    await waitFor(() => expect(screen.getAllByText('ASIO4ALL v2').length).toBeGreaterThan(0));

    expect(screen.getByText('ASIO driver / 4 outputs')).toBeTruthy();
    expect(screen.getByRole('button', { name: /1\/2 - Realtek 1 \/ Realtek 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /3\/4 - USB 1 \/ USB 2/ })).toBeTruthy();
  });

  it('applies an explicit ASIO channel pair without changing the default route', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      outputMode: 'asio',
      outputDeviceName: 'ASIO4ALL v2',
      asioOutputChannelStart: 2,
    });
    renderDrawer(
      baseStatus,
      setOutput,
      vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' }),
      vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' }),
      vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' }),
      {},
      [{
        id: 'asio:1',
        index: 1,
        name: 'ASIO4ALL v2',
        outputMode: 'asio',
        sampleRate: null,
        sharedDeviceSampleRate: 48000,
        isDefault: false,
        asioOutputChannels: 4,
        asioOutputChannelStart: 0,
        asioChannelNames: ['Realtek 1', 'Realtek 2', 'USB 1', 'USB 2'],
      }],
    );

    await waitFor(() => expect(screen.getAllByText('ASIO4ALL v2').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /3\/4 - USB 1 \/ USB 2/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({
      outputMode: 'asio',
      deviceIndex: 1,
      deviceName: 'ASIO4ALL v2',
      asioOutputChannelStart: 2,
    })));
  });

  it('shows multichannel source layouts in the drawer meter', async () => {
    renderDrawer({
      ...baseStatus,
      channels: 6,
    });

    await waitFor(() => expect(screen.getByText(/FLAC \/ 16 bit \/ 48 kHz \/ 5\.1 \(6 ch\)/)).toBeTruthy());
  });

  it('labels system audio as Windows direct output', () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'system',
      outputBackend: 'system-audio',
    });

    expect(screen.getAllByRole('button', { name: /Windows Direct Output/ }).some((button) =>
      button.className.includes('audio-device-pill'),
    )).toBe(true);
    expect(screen.getByText('Default Windows audio path for headphones, Bluetooth, and computer speakers')).toBeTruthy();
  });

  it('lets users leave HQPlayer takeover before choosing local output devices', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      outputMode: 'asio',
      outputDeviceName: asioDevice.name,
    });
    const onHqPlayerTakeoverEnabledChange = vi.fn();

    renderDrawer(baseStatus, setOutput, undefined, undefined, undefined, {
      hqPlayerTakeoverEnabled: true,
      onHqPlayerTakeoverEnabledChange,
    });
    vi.mocked(window.echo!.connect!.getStatus).mockResolvedValue({
      deviceId: 'hqplayer:local-desktop',
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: 'track-1',
      metadata: null,
      positionSeconds: 1,
      durationSeconds: 10,
      latencyMs: null,
      error: null,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: /取消 HQPlayer 接管/ }));
    await waitFor(() => expect(window.echo?.connect?.disconnect).toHaveBeenCalled());
    expect(onHqPlayerTakeoverEnabledChange).toHaveBeenCalledWith(false);
    expect(setOutput).not.toHaveBeenCalled();

    cleanup();
    onHqPlayerTakeoverEnabledChange.mockClear();

    renderDrawer(baseStatus, setOutput, undefined, undefined, undefined, {
      hqPlayerTakeoverEnabled: true,
      onHqPlayerTakeoverEnabledChange,
    });
    vi.mocked(window.echo!.connect!.getStatus).mockResolvedValue({
      deviceId: 'hqplayer:local-desktop',
      protocol: 'hqplayer',
      state: 'playing',
      currentTrackId: 'track-1',
      metadata: null,
      positionSeconds: 1,
      durationSeconds: 10,
      latencyMs: null,
      error: null,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });

    const asioButton = await screen.findByRole('button', { name: /TEAC ASIO/ });
    fireEvent.click(asioButton);

    await waitFor(() => expect(window.echo?.connect?.disconnect).toHaveBeenCalled());
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'asio' })));
    expect(onHqPlayerTakeoverEnabledChange).toHaveBeenCalledWith(false);
  });

  it('keeps advanced output collapsed by default and remembers when opened', () => {
    renderDrawer(baseStatus);

    const advancedToggle = screen.getByRole('button', { name: /advancedOutput/ });
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('checkbox', { name: /JUCE Main Output/ })).toBeNull();

    fireEvent.click(advancedToggle);

    expect(advancedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('echo-next.audio-advanced-output-open')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /JUCE Main Output/ })).toBeTruthy();

    cleanup();
    renderDrawer(baseStatus);

    expect(screen.getByRole('button', { name: /advancedOutput/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /JUCE Main Output/ })).toBeTruthy();
  });

  it('remembers the HiFi engine meter collapse state', () => {
    renderDrawer(baseStatus);

    const engineToggle = screen.getByRole('button', { name: /HiFi Engine/ });
    expect(engineToggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.audio-engine-meter__grid')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Refresh status' }).some((button) =>
      button.className.includes('audio-engine-meter__refresh'),
    )).toBe(true);

    fireEvent.click(engineToggle);

    expect(engineToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.audio-engine-meter__grid')).toBeNull();
    expect(window.localStorage.getItem('echo-next.audio-engine-meter-open')).toBe('false');

    cleanup();
    renderDrawer(baseStatus);

    expect(screen.getByRole('button', { name: /HiFi Engine/ }).getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.audio-engine-meter__grid')).toBeNull();
  });

  it('shows professional playback status badges without opening advanced output', () => {
    renderDrawer({
      ...soxrResamplingStatus,
      bitPerfectCandidate: true,
      dspActive: true,
      eqEnabled: true,
      replayGainEnabled: true,
      replayGainMode: 'track',
      replayGainAppliedDb: -3.25,
      sampleRateMismatch: true,
      warnings: ['native_buffer_recovered'],
    });

    expect(screen.getByText('Professional Playback Status')).toBeTruthy();
    expect(screen.getByText('Bit-perfect')).toBeTruthy();
    expect(screen.getByText('Resampling')).toBeTruthy();
    expect(screen.getByText('DSP active')).toBeTruthy();
    expect(screen.getByText('ReplayGain')).toBeTruthy();
    expect(screen.getByText('Sample-rate mismatch')).toBeTruthy();
    expect(screen.getByText('Device issue/warning')).toBeTruthy();
    expect(screen.getByText('Reason')).toBeTruthy();
    expect(screen.getByText('native buffer recovered')).toBeTruthy();
    expect(screen.queryByText('Direct And DSP')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show professional details/ }));

    expect(screen.getByText('Direct And DSP')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /JUCE Main Output/ })).toBeNull();
  });

  it('shows the active FFmpeg to JUCE output chain', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      activeOutputBackendImpl: 'juce-wasapi-shared',
    });
    openAdvancedControls();

    expect(screen.getByRole('checkbox', { name: /JUCE Main Output/ })).toHaveProperty('checked', true);
    expect(screen.getByText('FFmpeg decode -> JUCE output')).toBeTruthy();
  });

  it('shows active JUCE decode only when the decode backend actually used JUCE', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      useJuceDecodeRequested: true,
      activeDecodeBackendImpl: 'juce-wav',
      activeOutputBackendImpl: 'juce-wasapi-shared',
    });
    openAdvancedControls();

    expect(screen.getByRole('checkbox', { name: /Resident Native Decode/ })).toHaveProperty('checked', true);
    expect(screen.getByText('JUCE decode -> JUCE output')).toBeTruthy();
  });

  it('shows active JUCE decode for the Windows Media MP3 backend', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      useJuceDecodeRequested: true,
      activeDecodeBackendImpl: 'juce-windows-media-mp3',
      activeOutputBackendImpl: 'juce-wasapi-shared',
      codec: 'MPEG 1 LAYER 3',
      currentFilePath: 'D:\\Music\\song.mp3',
    });

    expect(screen.getByText('JUCE decode -> JUCE output')).toBeTruthy();
    expect(screen.getByText('JUCE decode')).toBeTruthy();
  });

  it('shows JUCE decode fallback when requested decode degraded to FFmpeg', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      useJuceDecodeRequested: true,
      activeDecodeBackendImpl: 'ffmpeg',
      activeOutputBackendImpl: 'juce-wasapi-shared',
      warnings: ['juce_decode_fell_back_to_ffmpeg'],
    });

    expect(screen.getByText('JUCE decode fallback -> JUCE output')).toBeTruthy();
    expect(screen.getByText('JUCE decode fallback')).toBeTruthy();
  });

  it('shows JUCE decode not used when a remote MP3 stays on FFmpeg without a fallback warning', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      useJuceDecodeRequested: true,
      activeDecodeBackendImpl: 'ffmpeg',
      activeOutputBackendImpl: 'juce-wasapi-shared',
      codec: 'MPEG 1 LAYER 3',
      currentFilePath: 'https://cdn.example.test/song.mp3',
    });

    expect(screen.getByText('FFmpeg decode (JUCE decode not used) -> JUCE output')).toBeTruthy();
    expect(screen.getByText('JUCE decode not used')).toBeTruthy();
  });

  it('shows JUCE decode not used for other non-pilot sources without a fallback warning', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      useJuceDecodeRequested: true,
      activeDecodeBackendImpl: 'ffmpeg',
      activeOutputBackendImpl: 'juce-wasapi-shared',
      codec: 'aac',
    });

    expect(screen.getByText('FFmpeg decode (JUCE decode not used) -> JUCE output')).toBeTruthy();
    expect(screen.getByText('JUCE decode not used')).toBeTruthy();
  });

  it('shows JUCE fallback when the requested output degraded to native', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      activeOutputBackendImpl: 'legacy-wasapi-shared',
      warnings: ['juce_output_fell_back_to_native'],
    });

    expect(screen.getByText('FFmpeg decode -> JUCE fallback')).toBeTruthy();
    expect(screen.getByText('JUCE fallback')).toBeTruthy();
  });

  it('shows the active DSF DoP direct chain only when DoP is actually active', () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'exclusive',
      outputBackend: 'wasapi-exclusive',
      activeOutputBackendImpl: 'legacy-wasapi-exclusive-dop',
      codec: 'DSF',
      currentFilePath: 'D:\\Music\\native.dsf',
      fileSampleRate: 2822400,
      requestedOutputSampleRate: 176400,
      actualDeviceSampleRate: 176400,
      dsdOutputModeRequested: 'dop',
      activeDsdOutputMode: 'dop',
      dsdNativeSampleRate: 2822400,
      dsdTransportSampleRate: 176400,
    });
    openAdvancedControls();

    expect(screen.getByRole('checkbox', { name: /DSD DoP Direct Pilot/ })).toHaveProperty('checked', true);
    expect(screen.getByText('DSF bitstream -> DoP -> exclusive')).toBeTruthy();
    expect(screen.getByText('DSF bitstream -> DoP')).toBeTruthy();
    expect(screen.getAllByText('2822 kHz -> DoP 176 kHz').length).toBeGreaterThan(0);
    expect(screen.queryByText('2822 kHz -> 176 kHz')).toBeNull();
  });

  it('shows DSD DoP fallback as PCM fallback rather than direct output', () => {
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      activeOutputBackendImpl: 'juce-wasapi-shared',
      codec: 'DSF',
      currentFilePath: 'D:\\Music\\native.dsf',
      dsdOutputModeRequested: 'dop',
      activeDsdOutputMode: null,
      warnings: ['dsd_dop_fell_back_to_pcm:device_format'],
    });

    expect(screen.getByText('DSD DoP fallback -> JUCE output')).toBeTruthy();
    expect(screen.getByText('DSD DoP fallback')).toBeTruthy();
  });

  it('persists manual DSD DoP enablement', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      dsdOutputModeRequested: 'dop',
    });
    renderDrawer(baseStatus, setOutput);
    openAdvancedControls();

    fireEvent.click(screen.getByRole('checkbox', { name: /DSD DoP Direct Pilot/ }));

    await waitFor(() => expect(window.echo?.app?.setSettings).toHaveBeenCalledWith(expect.objectContaining({ audioDsdOutputMode: 'dop' })));
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith(expect.objectContaining({ dsdOutputMode: 'dop' })));
  });

  it('persists release-exclusive-on-pause experiment enablement', async () => {
    const setOutput = vi.fn().mockResolvedValue(baseStatus);
    renderDrawer(baseStatus, setOutput);
    openAdvancedControls();

    fireEvent.click(screen.getByRole('checkbox', { name: /Release Exclusive on Pause/ }));

    await waitFor(() =>
      expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ audioReleaseExclusiveOnPauseExperimentalEnabled: true }),
    );
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ releaseExclusiveOnPauseExperimentalEnabled: true }));
  });

  it('persists exclusive instability fallback enablement', async () => {
    const setOutput = vi.fn().mockResolvedValue(baseStatus);
    renderDrawer(baseStatus, setOutput);
    openAdvancedControls();

    fireEvent.click(screen.getByRole('checkbox', { name: /Auto-switch unstable Exclusive/ }));

    await waitFor(() =>
      expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ audioExclusiveInstabilityFallbackEnabled: true }),
    );
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ exclusiveInstabilityFallbackEnabled: true }));
  });

  it('persists low-load playback mode from the audio settings drawer without switching output', async () => {
    const setOutput = vi.fn().mockResolvedValue(baseStatus);
    const settingsChanged = vi.fn();
    window.addEventListener('settings:changed', settingsChanged);

    renderDrawer(baseStatus, setOutput);

    fireEvent.click(await screen.findByRole('checkbox', { name: /Low-Load Playback Mode/ }));

    await waitFor(() => expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ lowLoadPlaybackModeEnabled: true }));
    await waitFor(() => expect(settingsChanged).toHaveBeenCalled());
    expect((settingsChanged.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({ lowLoadPlaybackModeEnabled: true });
    expect(setOutput).not.toHaveBeenCalled();

    window.removeEventListener('settings:changed', settingsChanged);
  });

  it('persists enhanced low-load protection from the audio settings drawer without switching output', async () => {
    const setOutput = vi.fn().mockResolvedValue(baseStatus);
    const settingsChanged = vi.fn();
    window.addEventListener('settings:changed', settingsChanged);

    renderDrawer(baseStatus, setOutput);

    fireEvent.click(await screen.findByRole('checkbox', { name: /Enhanced Low-Load Protection/ }));

    await waitFor(() => expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ lowLoadPlaybackEnhancementsEnabled: true }));
    await waitFor(() => expect(settingsChanged).toHaveBeenCalled());
    expect((settingsChanged.mock.calls.at(-1)?.[0] as CustomEvent).detail).toMatchObject({ lowLoadPlaybackEnhancementsEnabled: true });
    expect(setOutput).not.toHaveBeenCalled();

    window.removeEventListener('settings:changed', settingsChanged);
  });

  it('persists manual JUCE output disablement', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      useJuceOutputRequested: false,
    });
    renderDrawer({
      ...baseStatus,
      useJuceOutputRequested: true,
      activeOutputBackendImpl: 'juce-wasapi-shared',
    }, setOutput);
    openAdvancedControls();

    fireEvent.click(screen.getByRole('checkbox', { name: /JUCE Main Output/ }));

    await waitFor(() => expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ audioUseJuceOutput: false }));
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ useJuceOutput: false }));
  });

  it('persists manual resident decode disablement', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      useJuceDecodeRequested: false,
    });
    renderDrawer(baseStatus, setOutput);
    openAdvancedControls();

    fireEvent.click(screen.getByRole('checkbox', { name: /Resident Native Decode/ }));

    await waitFor(() => expect(window.echo?.app?.setSettings).toHaveBeenCalledWith({ audioUseJuceDecode: false }));
    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ useJuceDecode: false }));
  });

  it('hides ASIO panel buttons until the bottom visibility setting is enabled', async () => {
    renderDrawer(baseStatus);

    await waitFor(() => expect(screen.getAllByText('TEAC ASIO').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Open ASIO Panel/ })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /Show ASIO panel settings/ }));

    expect(screen.getByRole('button', { name: /Open ASIO Panel/ })).toBeTruthy();
    expect(window.localStorage.getItem('echo-next.show-asio-panel-settings')).toBe('true');
  });

  it('does not force low latency when switching WASAPI exclusive on', async () => {
    const setOutput = vi.fn().mockResolvedValue({
      ...baseStatus,
      outputMode: 'exclusive',
      outputBackend: 'wasapi-exclusive',
      latencyProfile: 'balanced',
    });
    renderDrawer({ ...baseStatus, latencyProfile: 'balanced' }, setOutput);

    fireEvent.click(screen.getByRole('checkbox', { name: /wasapiExclusive/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ outputMode: 'exclusive', latencyProfile: 'balanced' }));
  });

  it('highlights WASAPI exclusive current output in gold', () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'exclusive',
      outputBackend: 'wasapi-exclusive',
      outputDeviceName: 'USB DAC Exclusive',
    });

    expect(document.querySelector('.audio-current-output-card--gold')).toBeTruthy();
    expect(document.querySelector('.audio-current-output-card--asio')).toBeNull();
  });

  it('warns when the current shared output sample rate is 192 kHz or higher', () => {
    const warningText = '当前音频设备采样率过高，可能导致播放速度异常，建议改为 48 kHz。';

    renderDrawer({
      ...baseStatus,
      outputMode: 'shared',
      sharedDeviceSampleRate: 384000,
      actualDeviceSampleRate: 384000,
      requestedOutputSampleRate: 384000,
    });

    expect(screen.getByRole('alert').textContent).toBe(warningText);

    cleanup();
    renderDrawer({
      ...baseStatus,
      outputMode: 'shared',
      sharedDeviceSampleRate: 192000,
      actualDeviceSampleRate: 192000,
      requestedOutputSampleRate: 192000,
    });

    expect(screen.getByRole('alert').textContent).toBe(warningText);

    cleanup();
    renderDrawer({
      ...baseStatus,
      outputMode: 'shared',
      sharedDeviceSampleRate: 176400,
      actualDeviceSampleRate: 176400,
      requestedOutputSampleRate: 176400,
    });

    expect(screen.queryByText(warningText)).toBeNull();
  });

  it('shows ASIO buffer controls only in ASIO mode', () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'asio',
      outputBackend: 'asio',
      outputDeviceName: 'TEAC ASIO',
      nativeRequestedBufferFrames: 128,
      nativeActualBufferFrames: 256,
      nativeOutputLatencyMs: 5,
    });
    openBufferControls();

    expect(screen.getByRole('heading', { name: 'ASIO buffer' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /128/ }).length).toBeGreaterThan(0);
    expect(document.querySelector('.audio-current-output-card--gold')).toBeTruthy();
    expect(document.querySelector('.audio-current-output-card--asio')).toBeTruthy();
    expect(screen.getByText('recommended')).toBeTruthy();
    expect(screen.getByText('5 ms')).toBeTruthy();

    cleanup();
    renderDrawer(baseStatus);

    expect(screen.queryByRole('heading', { name: 'ASIO buffer' })).toBeNull();
  });

  it('locks the WASAPI exclusive toggle while ASIO mode is active', async () => {
    const status = {
      ...baseStatus,
      outputMode: 'asio' as const,
      outputBackend: 'asio',
      outputDeviceName: 'TEAC ASIO',
    };
    const setOutput = vi.fn().mockResolvedValue(status);
    renderDrawer(status, setOutput);

    const exclusiveToggle = screen.getByRole('checkbox', { name: /wasapiExclusive/ });

    expect(exclusiveToggle).toHaveProperty('disabled', true);
    fireEvent.click(exclusiveToggle);

    await waitFor(() => expect(setOutput).not.toHaveBeenCalled());
  });

  it('applies an explicit ASIO buffer size', async () => {
    const status = {
      ...baseStatus,
      outputMode: 'asio' as const,
      outputBackend: 'asio',
      nativeRequestedBufferFrames: null,
    };
    const setOutput = vi.fn().mockResolvedValue({ ...status, nativeRequestedBufferFrames: 128 });
    renderDrawer(status, setOutput);
    openBufferControls();

    fireEvent.click(screen.getByRole('button', { name: /128/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ bufferSizeFrames: 128 }));
  });

  it('clears manual ASIO buffer when a latency profile is selected', async () => {
    const status = {
      ...baseStatus,
      outputMode: 'asio' as const,
      outputBackend: 'asio',
      latencyProfile: 'lowLatency' as const,
      nativeRequestedBufferFrames: 256,
      nativeActualBufferFrames: 256,
    };
    const setOutput = vi.fn().mockResolvedValue({ ...status, latencyProfile: 'balanced', nativeRequestedBufferFrames: 2048 });
    renderDrawer(status, setOutput);
    openBufferControls();

    fireEvent.click(screen.getByRole('button', { name: /Balanced/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ latencyProfile: 'balanced', bufferSizeFrames: null }));
  });

  it('recovers controls after an ASIO output switch fails', async () => {
    const sharedStatus = {
      ...baseStatus,
      outputMode: 'shared' as const,
      outputBackend: 'wasapi-shared',
    };
    const setOutput = vi
      .fn()
      .mockRejectedValueOnce(new Error('ASIO open failed'))
      .mockResolvedValueOnce(sharedStatus);
    renderDrawer(sharedStatus, setOutput);

    await waitFor(() => expect(screen.getAllByText('TEAC ASIO').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /TEAC ASIO/ }));

    await waitFor(() => expect(screen.getByText('ASIO open failed')).toBeTruthy());

    const asioButton = screen.getByRole('button', { name: /TEAC ASIO/ });
    expect(asioButton).toHaveProperty('disabled', false);
    fireEvent.click(asioButton);

    await waitFor(() => expect(setOutput).toHaveBeenCalledTimes(2));
  });

  it('clears explicit ASIO buffer size when Auto is selected', async () => {
    const status = {
      ...baseStatus,
      outputMode: 'asio' as const,
      outputBackend: 'asio',
      nativeRequestedBufferFrames: 128,
      nativeActualBufferFrames: 256,
    };
    const setOutput = vi.fn().mockResolvedValue({ ...status, nativeRequestedBufferFrames: null });
    renderDrawer(status, setOutput);
    openBufferControls();

    fireEvent.click(screen.getByRole('button', { name: /Auto/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ bufferSizeFrames: null }));
  });

  it('resets the audio engine from the drawer controls', async () => {
    const resetEngine = vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' });
    const onStatusChange = vi.fn();
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ rememberedAudioOutput: { enabled: false } }),
        setSettings: vi.fn().mockResolvedValue({}),
      },
      audio: {
        listDevices: vi.fn().mockResolvedValue([asioDevice]),
        getStatus: vi.fn().mockResolvedValue(baseStatus),
        getDiagnostics: vi.fn().mockResolvedValue(baseStatus),
        setOutput: vi.fn().mockResolvedValue(baseStatus),
        resetEngine,
      },
    } as unknown as Window['echo'];

    render(
      <AudioSettingsDrawer
        isOpen
        status={baseStatus}
        onClose={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );
    openAdvancedControls();

    fireEvent.click(screen.getByRole('button', { name: 'resetEngine' }));

    await waitFor(() => expect(resetEngine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' })));
    expect(screen.getByRole('button', { name: 'resetEngineDone' })).toBeTruthy();
  });

  it('shows professional status at the bottom and force restarts the audio engine', async () => {
    const forceRestart = vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' });
    const onStatusChange = vi.fn();
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ rememberedAudioOutput: { enabled: false } }),
        setSettings: vi.fn().mockResolvedValue({}),
      },
      audio: {
        listDevices: vi.fn().mockResolvedValue([asioDevice]),
        getStatus: vi.fn().mockResolvedValue(baseStatus),
        getDiagnostics: vi.fn().mockResolvedValue(baseStatus),
        setOutput: vi.fn().mockResolvedValue(baseStatus),
        resetEngine: vi.fn().mockResolvedValue(baseStatus),
        forceRestart,
        restartWindowsAudioService: vi.fn().mockResolvedValue(baseStatus),
      },
    } as unknown as Window['echo'];

    render(
      <AudioSettingsDrawer
        isOpen
        status={baseStatus}
        onClose={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );

    const troubleshooting = document.querySelector('.audio-drawer-scroll > .audio-drawer-troubleshooting');
    const professionalStatus = document.querySelector('.audio-drawer-scroll > .audio-professional-status--drawer:last-of-type');
    const professionalActions = document.querySelector('.audio-drawer-scroll > .audio-professional-status-actions:last-child');
    expect(troubleshooting?.nextElementSibling).toBe(professionalStatus);
    expect(professionalStatus?.nextElementSibling).toBe(professionalActions);

    fireEvent.click(screen.getByRole('button', { name: 'Restart Audio Engine' }));

    await waitFor(() => expect(forceRestart).toHaveBeenCalledWith('audio-drawer-force-restart'));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' })));
    expect(await screen.findByText('Audio engine restarted.')).toBeTruthy();
  });

  it('confirms before restarting the Windows audio service from the drawer', async () => {
    const restartWindowsAudioService = vi.fn().mockResolvedValue({ ...baseStatus, state: 'stopped' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onStatusChange = vi.fn();
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ rememberedAudioOutput: { enabled: false } }),
        setSettings: vi.fn().mockResolvedValue({}),
      },
      audio: {
        listDevices: vi.fn().mockResolvedValue([asioDevice]),
        getStatus: vi.fn().mockResolvedValue(baseStatus),
        getDiagnostics: vi.fn().mockResolvedValue(baseStatus),
        setOutput: vi.fn().mockResolvedValue(baseStatus),
        resetEngine: vi.fn().mockResolvedValue(baseStatus),
        forceRestart: vi.fn().mockResolvedValue(baseStatus),
        restartWindowsAudioService,
      },
    } as unknown as Window['echo'];

    render(
      <AudioSettingsDrawer
        isOpen
        status={baseStatus}
        onClose={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restart Windows Audio Service' }));

    expect(confirmSpy).toHaveBeenCalledWith('This affects all apps. Continue?');
    await waitFor(() => expect(restartWindowsAudioService).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' })));
    expect(await screen.findByText('Windows audio service recovered.')).toBeTruthy();
  });

  it('shows a SOXR label when SOXR resampling is active', () => {
    renderDrawer(soxrResamplingStatus);

    expect(screen.getByText('192 kHz -> 48 kHz / SOXR')).toBeTruthy();
    expect(screen.getByText('SOXR')).toBeTruthy();
  });

  it('labels ECHO SRC sample-rate changes as upsampling instead of resampling', () => {
    renderDrawer(echoSrcUpsamplingStatus);

    expect(screen.getAllByText('Upsampling').length).toBeGreaterThan(0);
    expect(screen.queryByText('Resampling')).toBeNull();
  });

  it('hides the SOXR label when resampling fell back to the default engine', () => {
    renderDrawer({
      ...soxrResamplingStatus,
      resamplerEngine: 'default',
      resamplerFallbackActive: true,
    });

    expect(screen.getAllByText('192 kHz -> 48 kHz').length).toBeGreaterThan(0);
    expect(screen.queryByText('192 kHz -> 48 kHz / SOXR')).toBeNull();
  });

  it('saves current output mode and ASIO buffer when output settings are enabled', async () => {
    renderDrawer({
      ...baseStatus,
      outputMode: 'asio',
      outputBackend: 'asio',
      outputDeviceName: 'TEAC ASIO',
      latencyProfile: 'balanced',
      nativeRequestedBufferFrames: 256,
      nativeActualBufferFrames: 256,
    });

    await waitFor(() => expect(screen.getAllByText('TEAC ASIO').length).toBeGreaterThan(0));
    openAdvancedControls();
    fireEvent.click(screen.getByRole('checkbox', { name: /rememberOutput/ }));

    const remembered = JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}');
    expect(remembered).toMatchObject({
      enabled: true,
      outputMode: 'asio',
      latencyProfile: 'balanced',
      deviceIndex: 0,
      deviceName: 'TEAC ASIO',
      bufferSizeFrames: 256,
    });
  });

  it('clears incompatible remembered buffer size when switching to shared low latency', async () => {
    window.localStorage.setItem(
      'echo-next.audio-output-memory',
      JSON.stringify({
        enabled: true,
        outputMode: 'shared',
        sharedBackend: 'auto',
        latencyProfile: 'stable',
        bufferSizeFrames: 8192,
      }),
    );
    const setOutput = vi.fn().mockResolvedValue({ ...baseStatus, latencyProfile: 'lowLatency' });
    renderDrawer({ ...baseStatus, latencyProfile: 'stable' }, setOutput);
    openBufferControls();

    fireEvent.click(screen.getByRole('button', { name: /Low latency/ }));

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({
      latencyProfile: 'lowLatency',
      bufferSizeFrames: null,
    }));
    expect(JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}')).toMatchObject({
      enabled: true,
      outputMode: 'shared',
      latencyProfile: 'lowLatency',
    });
    expect(JSON.parse(window.localStorage.getItem('echo-next.audio-output-memory') ?? '{}')).not.toHaveProperty('bufferSizeFrames');
  });

  it('hides Windows-only output controls on Linux', async () => {
    setNavigatorUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    renderDrawer(baseStatus);

    await waitFor(() => expect(window.echo?.audio?.listDevices).toHaveBeenCalled());

    expect(screen.queryByRole('heading', { name: 'asioDevices' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /wasapiExclusive/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /TEAC ASIO/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart Windows Audio Service' })).toBeNull();
    expect(screen.getByText('Linux')).toBeTruthy();

    openAdvancedControls();
    expect(screen.getByRole('button', { name: /ALSA/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /DirectSound/ })).toBeNull();
  });
});
