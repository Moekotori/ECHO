import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashReportService } from './CrashReportService';
import { sanitizeLogPayload } from './Logger';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'downloads' ? tmpdir() : tmpdir()),
    getVersion: () => '1.0.1-test',
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: () => ({
    networkMetadataEnabled: true,
    token: 'secret-token',
    nested: { cookie: 'session-cookie' },
  }),
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => ({
      host: 'ready',
      state: 'playing',
      outputDeviceId: 'device-1',
      outputDeviceName: 'Speakers',
      outputDeviceType: null,
      outputBackend: 'native',
      outputMode: 'shared',
      volume: 1,
      playbackRate: 1,
      playbackSpeedMode: 'nightcore',
      currentFilePath: 'D:\\Music\\private-song.flac',
      currentTrackId: 'track-1',
      durationSeconds: 120,
      positionSeconds: 12,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: null,
      fileSampleRate: 44100,
      decoderOutputSampleRate: 44100,
      requestedOutputSampleRate: null,
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
    }),
  }),
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => ({
    getDiagnostics: () => ({
      foldersCount: 1,
      tracksCount: 2,
      albumsCount: 1,
      artistsCount: 1,
      coversCount: 1,
      lastScan: null,
      lastQueryMs: { getTracks: null, getAlbums: null },
      averageAlbumPayloadBytes: null,
      databasePath: 'D:\\Music\\echo.db',
      databaseSizeBytes: 1024,
      coverCachePath: 'D:\\Music\\covers',
      coverCacheSizeBytes: 2048,
      coverCacheVersion: 1,
      cpuCount: 8,
      scanPerformanceMode: 'balanced',
      metadataConcurrency: 4,
      coverConcurrency: 2,
    }),
  }),
}));

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const unzipEntries = (zipPath: string): Record<string, string> => {
  const buffer = readFileSync(zipPath);
  const entries: Record<string, string> = {};
  let offset = 0;

  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries[name] = method === 8 ? inflateRawSync(compressed).toString('utf8') : compressed.toString('utf8');
    offset = dataStart + compressedSize;
  }

  return entries;
};

const createAudioStatus = (overrides: Record<string, unknown> = {}) => ({
  host: 'starting',
  state: 'loading',
  outputDeviceId: 'shared:0',
  outputDeviceName: 'Speakers',
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  latencyProfile: 'balanced',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: 'D:\\Music\\private-song.flac',
  currentTrackId: 'track-1',
  durationSeconds: 120,
  positionSeconds: 0,
  channels: 2,
  codec: 'flac',
  bitDepth: 16,
  bitrate: null,
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  audioLevels: {
    inputPeakDb: null,
    inputRmsDb: null,
    estimatedOutputPeakDb: null,
    estimatedOutputRmsDb: null,
    headroomDb: null,
    clipCount: 0,
    lastClipAt: null,
    meterSource: 'pre_native_estimated_post_dsp',
  },
  bitPerfectDisabledReason: null,
  sharedStabilityTier: null,
  nativeDeviceBufferFrames: null,
  nativeRequestedBufferFrames: null,
  nativeActualBufferFrames: null,
  nativeOutputLatencyMs: null,
  nativePositionStalenessMs: null,
  nativeFifoCapacityFrames: null,
  nativeStartupPrebufferFrames: null,
  nativeBufferedFrames: null,
  nativeBufferedMs: null,
  nativeUnderrunCallbacks: 0,
  nativeUnderrunFrames: 0,
  lastSharedStabilityRecoveryAt: null,
  warnings: [],
  error: null,
  ...overrides,
});

describe('CrashReportService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'echo-diagnostics-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a running session', () => {
    const service = new CrashReportService(tempDir);

    service.initialize();

    const sessionPath = join(service.getSessionDir()!, 'session.json');
    const session = readJson<{ status: string; appVersion: string }>(sessionPath);
    expect(session.status).toBe('running');
    expect(session.appVersion).toBe('1.0.1-test');
  });

  it('marks the session closed on normal shutdown', () => {
    const service = new CrashReportService(tempDir);

    service.initialize();
    service.closeSession();

    const session = readJson<{ status: string; endedAt?: string }>(join(service.getSessionDir()!, 'session.json'));
    expect(session.status).toBe('closed');
    expect(session.endedAt).toBeTruthy();
  });

  it('records when app shutdown has started', () => {
    const service = new CrashReportService(tempDir);

    service.initialize();
    service.markShutdownRequested();

    const session = readJson<{ status: string; shutdownRequestedAt?: string }>(join(service.getSessionDir()!, 'session.json'));
    expect(session.status).toBe('running');
    expect(session.shutdownRequestedAt).toBeTruthy();
  });

  it('detects a previous running session as an abnormal exit', () => {
    const sessionsDir = join(tempDir, 'crash-reports', 'sessions');
    const previousDir = join(sessionsDir, '0001');
    mkdirSync(previousDir, { recursive: true });
    writeFileSync(
      join(previousDir, 'session.json'),
      JSON.stringify({
        sessionId: '0001',
        appVersion: '1.0.1-test',
        electronVersion: 'test',
        chromeVersion: 'test',
        nodeVersion: 'test',
        platform: 'win32',
        arch: 'x64',
        startedAt: '2026-05-13T00:00:00.000Z',
        status: 'running',
      }),
    );

    const service = new CrashReportService(tempDir);
    service.initialize();

    expect(service.getLastCrashSummary()).toEqual(expect.objectContaining({ sessionId: '0001', reason: 'abnormalExit' }));
    expect(readJson<{ status: string }>(join(previousDir, 'session.json')).status).toBe('abnormalExit');
  });

  it('keeps user-requested shutdown timeouts out of the startup crash notice', () => {
    const sessionsDir = join(tempDir, 'crash-reports', 'sessions');
    const previousDir = join(sessionsDir, '0001');
    mkdirSync(previousDir, { recursive: true });
    writeFileSync(
      join(previousDir, 'session.json'),
      JSON.stringify({
        sessionId: '0001',
        appVersion: '1.0.1-test',
        electronVersion: 'test',
        chromeVersion: 'test',
        nodeVersion: 'test',
        platform: 'win32',
        arch: 'x64',
        startedAt: '2026-05-13T00:00:00.000Z',
        shutdownRequestedAt: '2026-05-13T00:01:00.000Z',
        status: 'running',
      }),
    );

    const service = new CrashReportService(tempDir);
    service.initialize();

    const session = readJson<{ status: string; endedAt?: string }>(join(previousDir, 'session.json'));
    expect(service.getLastCrashSummary()).toBeNull();
    expect(session.status).toBe('abnormalExit');
    expect(session.endedAt).toBeTruthy();
  });

  it('opens a markdown report for the previous abnormal session', async () => {
    const sessionsDir = join(tempDir, 'crash-reports', 'sessions');
    const previousDir = join(sessionsDir, '0001');
    mkdirSync(previousDir, { recursive: true });
    writeFileSync(
      join(previousDir, 'session.json'),
      JSON.stringify({
        sessionId: '0001',
        appVersion: '1.0.1-test',
        electronVersion: 'test',
        chromeVersion: 'test',
        nodeVersion: 'test',
        platform: 'win32',
        arch: 'x64',
        startedAt: '2026-05-13T00:00:00.000Z',
        status: 'running',
      }),
    );
    writeFileSync(join(previousDir, 'main.log'), 'previous session log tail\n');

    const service = new CrashReportService(tempDir);
    service.initialize();
    const reportPath = await service.openCrashReportFile({ preferLastAbnormal: true });

    expect(reportPath).toBe(join(previousDir, 'crash-report.md'));
    const report = readFileSync(reportPath, 'utf8');
    expect(report).toContain('Previous ECHO Next session did not close normally.');
    expect(report).toContain('previous session log tail');
  });

  it('writes renderer errors to renderer and crash logs', () => {
    const service = new CrashReportService(tempDir);
    service.initialize();

    service.reportRendererError({
      message: 'White screen',
      stack: 'stack',
      filename: 'D:\\Project\\secret.tsx',
      lineno: 10,
      colno: 2,
      source: 'error',
      timestamp: '2026-05-13T00:00:00.000Z',
    });

    expect(readFileSync(join(service.getSessionDir()!, 'renderer.log'), 'utf8')).toContain('White screen');
    expect(readFileSync(join(service.getSessionDir()!, 'crash.log'), 'utf8')).toContain('White screen');
  });

  it('deduplicates renderer error bursts and keeps empty audio reports audio-only', async () => {
    const service = new CrashReportService(tempDir);
    service.initialize();

    const rendererError = {
      message: 'usePlaybackQueue must be used inside PlaybackQueueProvider',
      stack: 'stack',
      filename: 'D:\\Project\\PlaybackQueueProvider.tsx',
      lineno: 962,
      colno: 11,
      source: 'error' as const,
      timestamp: '2026-05-17T05:11:03.788Z',
    };

    service.reportRendererError(rendererError);
    service.reportRendererError({
      ...rendererError,
      timestamp: '2026-05-17T05:11:03.792Z',
    });

    const rendererLog = readFileSync(join(service.getSessionDir()!, 'renderer.log'), 'utf8');
    expect(rendererLog.trim().split(/\r?\n/)).toHaveLength(1);

    const reportPath = await service.openAudioCrashReportFile();
    const report = readFileSync(reportPath, 'utf8');
    expect(report).toContain('No audio crash has been recorded in this session.');
    expect(report).toContain('renderer and crash logs are omitted from this audio-only report');
    expect(report).not.toContain('### crash.log');
    expect(report).not.toContain('usePlaybackQueue must be used inside PlaybackQueueProvider');
  });

  it('writes audio crash reports with safe audio status snapshots', async () => {
    const service = new CrashReportService(tempDir);
    const outputPath = join(tempDir, 'diagnostics.zip');
    service.initialize();

    service.reportAudioError({
      message: 'echo-audio-host timeout_waiting_for_ready; host="D:\\Program Files\\ECHO Next\\echo-audio-host.exe"',
      phase: 'output-start',
      severity: 'recoverable',
      details: {
        selectedDevicePath: 'D:\\Devices\\private-device.json',
      },
      audioStatus: {
        host: 'error',
        state: 'error',
        outputDeviceId: 'device-1',
        outputDeviceName: 'Speakers',
        outputDeviceType: null,
        outputBackend: 'native',
        activeOutputBackendImpl: null,
        outputMode: 'shared',
        useJuceOutputRequested: false,
        useJuceDecodeRequested: false,
        activeDecodeBackendImpl: null,
        volume: 1,
        playbackRate: 1,
        playbackSpeedMode: 'nightcore',
        currentFilePath: 'D:\\Music\\private-song.flac',
        currentTrackId: 'track-1',
        durationSeconds: 120,
        positionSeconds: 12,
        channels: 2,
        codec: 'flac',
        bitDepth: 16,
        bitrate: null,
        fileSampleRate: 44100,
        decoderOutputSampleRate: 44100,
        requestedOutputSampleRate: null,
        actualDeviceSampleRate: 44100,
        sharedDeviceSampleRate: 44100,
        resampling: false,
        bitPerfectCandidate: false,
        sampleRateMismatch: false,
        eqEnabled: false,
        channelBalanceEnabled: false,
        dspActive: false,
        preampDb: 0,
        eqPresetName: null,
        clippingRisk: false,
        bitPerfectDisabledReason: null,
        warnings: ['shared_output_recovered_to_default_device'],
        error: 'echo-audio-host timeout_waiting_for_ready',
      },
    });

    await service.exportDiagnosticsZip(outputPath);

    const latest = readJson<{ type: string; severity: string; audioStatus: { currentFilePath: unknown } }>(
      join(service.getSessionDir()!, 'audio-crash.latest.json'),
    );
    const readableReport = readFileSync(join(service.getSessionDir()!, 'audio-crash-report.md'), 'utf8');
    expect(latest.type).toBe('audio');
    expect(latest.severity).toBe('recoverable');
    expect(latest.audioStatus.currentFilePath).toEqual({
      basename: 'private-song.flac',
      pathHash: expect.any(String),
    });
    expect(readableReport).toContain('# ECHO Next Audio Crash Report');
    expect(readableReport).toContain('## Why This Error Happened');
    expect(readableReport).toContain('the native audio host was launched, but it did not send its ready event');
    expect(readableReport).toContain('shared_output_recovered_to_default_device');

    const entries = unzipEntries(outputPath);
    expect(Object.keys(entries)).toContain('audio-crash.latest.json');
    expect(Object.keys(entries)).toContain('audio-crash-report.md');
    expect(Object.keys(entries).some((name) => name.startsWith('audio-crashes/audio-crash-'))).toBe(true);
    expect(Object.values(entries).join('\n')).not.toContain('D:\\Music\\private-song.flac');
  });

  it('summarizes related audio crash records as one incident timeline', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-15T15:45:47.418Z'));
      const service = new CrashReportService(tempDir);
      service.initialize();

      service.reportAudioError({
        message: 'echo-audio-host exit_code_1; mode="asio"; stderrTail="Device didn\'t start correctly"',
        phase: 'output-start',
        severity: 'recoverable',
        details: {
          outputMode: 'asio',
          candidate: { index: 2, name: 'MOONDROP USB AUDIO ASIO4', outputMode: 'asio' },
          requestedOutputSampleRate: 352800,
        },
        audioStatus: createAudioStatus({
          outputMode: 'asio',
          outputDeviceId: 'asio:2',
          outputDeviceName: 'MOONDROP USB AUDIO ASIO4',
          codec: 'DSF',
          fileSampleRate: 11289600,
          decoderOutputSampleRate: 352800,
          requestedOutputSampleRate: 352800,
          warnings: ['dsd_source_decoded_to_pcm:11289600->352800'],
        }) as never,
      });

      vi.setSystemTime(new Date('2026-05-15T15:47:14.621Z'));
      service.reportAudioError({
        message: 'audio_session_run_cancelled',
        phase: 'play-local-file-ipc',
        severity: 'fatal',
        details: {
          request: { trackId: 'track-2' },
        },
        audioStatus: createAudioStatus({
          outputMode: 'shared',
          outputDeviceId: 'shared:11',
          outputDeviceName: 'MOONDROP Dawn Pro',
          warnings: ['shared_output_resampling_or_mixer_rate_difference'],
        }) as never,
      });

      vi.setSystemTime(new Date('2026-05-15T15:47:26.192Z'));
      service.reportAudioError({
        message: 'echo-audio-host timeout_waiting_for_ready; mode="shared"; stderrTail="Couldn\'t open the output device!"',
        phase: 'output-start',
        severity: 'recoverable',
        details: {
          outputMode: 'shared',
          candidate: { index: 11, name: 'MOONDROP Dawn Pro', outputMode: 'shared' },
          requestedOutputSampleRate: 48000,
        },
        audioStatus: createAudioStatus({
          outputMode: 'shared',
          outputDeviceId: 'shared:11',
          outputDeviceName: 'MOONDROP Dawn Pro',
          requestedOutputSampleRate: 48000,
          warnings: [
            'shared_output_resampling_or_mixer_rate_difference',
            'juce_output_fell_back_to_native',
            'juce_shared_output_fell_back_to_native',
          ],
        }) as never,
      });

      const report = readFileSync(join(service.getSessionDir()!, 'audio-crash-report.md'), 'utf8');

      expect(report).toContain('## Related Audio Events In This Session');
      expect(report).toContain('## Correlation Analysis');
      expect(report).toContain('- Events included: 3');
      expect(report).toContain('- Likely one chained incident: yes');
      expect(report).toContain('driver_start_refused');
      expect(report).toContain('superseded_playback_run');
      expect(report).toContain('host_ready_timeout');
      expect(report).toContain('MOONDROP USB AUDIO ASIO4');
      expect(report).toContain('MOONDROP Dawn Pro');
      expect(report).toContain('ASIO failed first and Shared/WASAPI also failed later');
      expect(report).toContain('DSD source was decoded to high-rate PCM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains ASIO NotPresent failures as device unavailable instead of generic pipeline errors', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-17T02:25:57.363Z'));
      const service = new CrashReportService(tempDir);
      service.initialize();

      service.reportAudioError({
        message: 'echo-audio-host runtime_error; mode="asio"; nativeMessage="ASIO open failed: ASIOInit failed driver=\\"TEAC ASIO USB DRIVER\\" error=ASE_NotPresent(-1000) driverMessage=\\"No device found.\\""',
        phase: 'output-start',
        severity: 'recoverable',
        details: {
          outputMode: 'asio',
          candidate: { index: 2, name: 'TEAC ASIO USB DRIVER', outputMode: 'asio' },
          requestedOutputSampleRate: 44100,
        },
        audioStatus: createAudioStatus({
          outputMode: 'asio',
          outputDeviceId: 'asio:2',
          outputDeviceName: 'TEAC ASIO USB DRIVER',
          requestedOutputSampleRate: 44100,
          warnings: ['file_sample_rate_unknown_using_44100_fallback'],
        }) as never,
      });

      const report = readFileSync(join(service.getSessionDir()!, 'audio-crash-report.md'), 'utf8');

      expect(report).toContain('asio_device_not_present');
      expect(report).toContain('the selected ASIO driver loaded, but the driver reported that its hardware device is not currently present');
      expect(report).toContain('enable ASIO unavailable guard');
      expect(report).not.toContain('does not match a specialized diagnosis rule yet');
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies streaming provider no-URL failures separately from audio pipeline errors', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-07T10:09:00.382Z'));
      const service = new CrashReportService(tempDir);
      service.initialize();

      service.reportAudioError({
        message: 'KuGou Music did not return a playable URL for this track.',
        phase: 'play-media-item-ipc',
        severity: 'fatal',
        details: {
          request: {
            item: {
              mediaType: 'streaming',
              provider: 'kugou',
              providerTrackId: '47c05e140aef49a214c6edb17f9db35c.26482909.191403760',
            },
          },
        },
        audioStatus: createAudioStatus({
          state: 'paused',
          outputMode: 'shared',
          outputDeviceName: null,
          error: null,
        }) as never,
      });

      const report = readFileSync(join(service.getSessionDir()!, 'audio-crash-report.md'), 'utf8');

      expect(report).toContain('streaming_playback_unavailable');
      expect(report).not.toContain('audio_pipeline_error');
      expect(report).toContain('KuGou Music did not return a playable URL for this track.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the dedicated audio crash report file', async () => {
    const service = new CrashReportService(tempDir);
    service.initialize();

    const reportPath = await service.openAudioCrashReportFile();

    expect(reportPath).toBe(join(service.getSessionDir()!, 'audio-crash-report.md'));
    expect(existsSync(reportPath)).toBe(true);
    expect(readFileSync(reportPath, 'utf8')).toContain('# ECHO Next Audio Crash Report');
    const { shell } = await import('electron');
    expect(shell.openPath).toHaveBeenCalledWith(reportPath);
  });

  it('opens the dedicated normal crash report file', async () => {
    const service = new CrashReportService(tempDir);
    service.initialize();
    service.reportCrash({ type: 'test', message: 'Synthetic crash', details: { outputPath: 'D:\\Music\\secret.flac' } });

    const reportPath = await service.openCrashReportFile();

    const report = readFileSync(reportPath, 'utf8');
    expect(reportPath).toBe(join(service.getSessionDir()!, 'crash-report.md'));
    expect(report).toContain('# ECHO Next Crash Report');
    expect(report).toContain('Synthetic crash');
    expect(report).not.toContain('D:\\Music\\private-song.flac');
    const { shell } = await import('electron');
    expect(shell.openPath).toHaveBeenCalledWith(reportPath);
  });

  it('exports markdown diagnostics by default', async () => {
    const service = new CrashReportService(tempDir);
    const outputPath = join(tempDir, 'diagnostics.md');
    service.initialize();
    service.reportCrash({ type: 'test', message: 'Synthetic crash' });

    const exportedPath = await service.exportDiagnosticsMarkdown(outputPath);

    expect(exportedPath).toBe(outputPath);
    const report = readFileSync(outputPath, 'utf8');
    expect(report).toContain('# ECHO Next Crash Report');
    expect(report).toContain('Synthetic crash');
    expect(report.startsWith('PK')).toBe(false);
  });

  it('redacts sensitive log payload fields', () => {
    const sanitized = sanitizeLogPayload({
      token: 'abc',
      cookie: 'def',
      password: 'ghi',
      authorization: 'Bearer secret',
      nested: { normal: 'ok' },
    });

    expect(sanitized).toEqual({
      token: '[redacted]',
      cookie: '[redacted]',
      password: '[redacted]',
      authorization: '[redacted]',
      nested: { normal: 'ok' },
    });
  });

  it('exports a safe diagnostics zip without media files, cover binaries, lyrics, or secrets', async () => {
    const service = new CrashReportService(tempDir);
    const outputPath = join(tempDir, 'diagnostics.zip');
    service.initialize();
    service.reportCrash({ type: 'test', message: 'Synthetic crash' });

    await service.exportDiagnosticsZip(outputPath);

    const entries = unzipEntries(outputPath);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'session.json',
        'crash.json',
        'main.log',
        'crash.log',
        'app-settings.safe.json',
        'startup-timeline.safe.json',
        'exception-summary.safe.json',
        'exceptions.safe.json',
        'library-diagnostics.safe.json',
        'playback-status.safe.json',
        'audio-status.safe.json',
        'package-version-info.json',
      ]),
    );
    expect(Object.keys(entries).some((name) => /\.(flac|mp3|jpg|jpeg|png|lrc)$/i.test(name))).toBe(false);
    const combined = Object.values(entries).join('\n');
    expect(combined).not.toContain('secret-token');
    expect(combined).not.toContain('session-cookie');
    expect(combined).not.toContain('D:\\Music\\private-song.flac');
    expect(combined).not.toContain('full lyrics');
  });
});
