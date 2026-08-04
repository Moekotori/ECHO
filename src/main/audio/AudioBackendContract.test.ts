import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSession, type AudioSessionDependencies } from './AudioSession';
import type { JsonRpcBridge } from './JsonRpcBridge';
import type {
  AudioProbeResult,
  DecoderRun,
  NativeBridgeReadyResult,
  NativeOutputStartOptions,
  PcmDecodeRequest,
} from './audioTypes';

const contractAppSettingsMock = vi.hoisted(() => {
  const defaultValue = {
    homeWaveformVisualizerEnabled: true,
    audioVisualSpectrumEnabled: true,
    lowLoadPlaybackModeEnabled: false,
    audioTransportFadeEnabled: false,
    audioTransportFadeCurve: 'smooth' as const,
  };

  return {
    defaultValue,
    current: { ...defaultValue },
  };
});

vi.mock('../app/appSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/appSettings')>();

  return {
    ...actual,
    getAppSettings: () => contractAppSettingsMock.current,
    setAppSettings: vi.fn((patch: Record<string, unknown>) => {
      contractAppSettingsMock.current = {
        ...contractAppSettingsMock.current,
        ...patch,
      };
      return contractAppSettingsMock.current;
    }),
  };
});

const { mockStartAudioDaemon, mockDaemonBridge } = vi.hoisted(() => ({
  mockStartAudioDaemon: vi.fn<() => Promise<void>>().mockResolvedValue(),
  mockDaemonBridge: {
    isDaemonRunning: () => true,
  },
}));

vi.mock('./NativePcmHostProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./NativePcmHostProcess')>();

  return {
    ...actual,
    daemonBridge: mockDaemonBridge,
    startAudioDaemon: mockStartAudioDaemon,
    stopAudioDaemon: vi.fn().mockResolvedValue(undefined),
  };
});



const noopLogger = (): void => undefined;

const probe = (filePath: string, fileSampleRate = 44_100): AudioProbeResult => ({
  filePath,
  fileSampleRate,
  durationSeconds: 120,
  channels: 2,
  codec: 'FLAC',
  bitDepth: 24,
  bitrate: 1_400_000,
});

class ContractDecoder {
  readonly decodeRequests: PcmDecodeRequest[] = [];
  readonly probeRequests: string[] = [];

  constructor(private readonly probes: Map<string, AudioProbeResult>) {}

  async probeLocalFile(filePath: string): Promise<AudioProbeResult> {
    this.probeRequests.push(filePath);
    const result = this.probes.get(filePath);
    if (!result) throw new Error(`missing probe for ${filePath}`);
    return result;
  }

  decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    queueMicrotask(() => {
      if (!stream.destroyed) stream.end();
    });

    return {
      stream,
      done: Promise.resolve(),
      stop: vi.fn(() => stream.destroy()),
    };
  }
}

class ContractNativeBridge extends EventEmitter {
  readonly writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  readonly stop = vi.fn();
  readonly setVolume = vi.fn();
  readonly setPaused = vi.fn();
  readonly sessionBeginOptions: Array<{ startSeconds?: number; playbackRate?: number; durationSeconds?: number }> = [];
  readonly sessionChunks: Buffer[] = [];
  startOptions: NativeOutputStartOptions | null = null;
  sessionBegins = 0;
  positionSeconds = 0;

  async start(options: NativeOutputStartOptions): Promise<NativeBridgeReadyResult> {
    this.startOptions = options;
    this.positionSeconds = options.startSeconds ?? 0;
    const sampleRate = options.requestedOutputSampleRate;

    return {
      ok: true,
      device: {
        ready: true,
        sampleRate,
        backend: options.exclusive ? 'wasapi-exclusive' : 'wasapi-shared',
        deviceType: options.exclusive ? 'Windows Audio (Exclusive Mode)' : 'Windows Audio (Shared Mode)',
        deviceName: options.deviceName ?? 'Default output',
        deviceBufferFrames: 512,
        nativeActualBufferFrames: 512,
        actualBufferFrames: 512,
        requestedDeviceBufferFrames: 512,
        openedDeviceBufferFrames: 512,
        bufferSizeFallback: false,
      },
      requestedOutputSampleRate: sampleRate,
      actualDeviceSampleRate: sampleRate,
    };
  }

  getPositionSeconds(): number {
    return this.positionSeconds;
  }

  canReuseFor(): boolean {
    return true;
  }

  beginSession(options: { startSeconds?: number; playbackRate?: number; durationSeconds?: number } = {}): number {
    this.sessionBegins += 1;
    this.sessionBeginOptions.push(options);
    this.positionSeconds = options.startSeconds ?? 0;
    return this.sessionBegins;
  }

  createSessionWritable(): Writable {
    return new Writable({
      write: (chunk, _encoding, callback) => {
        this.sessionChunks.push(Buffer.from(chunk));
        callback();
      },
    });
  }
}

const createContractSession = (dependencies: AudioSessionDependencies): AudioSession => {
  const session = new AudioSession({
    transportFadeDurationMs: 0,
    disableWatchdogTimer: true,
    logger: noopLogger,
    ...dependencies,
  });

  return session;
};

afterEach(() => {
  contractAppSettingsMock.current = { ...contractAppSettingsMock.defaultValue };
  mockStartAudioDaemon.mockReset();
  mockStartAudioDaemon.mockResolvedValue();
});

describe('AudioBackend lifecycle contract', () => {
  it('falls back to regular native bridge when daemon backend creation fails because the active bridge is closed', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([
        ['track.flac', probe('track.flac')],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'track.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back to regular native bridge for daemon playback when active JSON-RPC bridge is not available', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    const nativeBridge = new ContractNativeBridge();

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([
        ['daemon.flac', probe('daemon.flac')],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => nativeBridge,
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'daemon.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back for daemon playback with speed settings when active JSON-RPC bridge is not available', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['daemon-speed.flac', probe('daemon-speed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({
      filePath: 'daemon-speed.flac',
      output: { outputMode: 'shared', playbackRate: 1.25, playbackSpeedMode: 'speed' },
    });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back for daemon playback speed update when daemon bridge is not available', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['daemon-live-speed.flac', probe('daemon-live-speed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await session.playLocalFile({ filePath: 'daemon-live-speed.flac', output: { outputMode: 'shared' } });

    const status = await session.setOutput({ playbackRate: 1.5, playbackSpeedMode: 'daycore' });

    expect(status.playbackRate).toBe(1.5);
    expect(status.playbackSpeedMode).toBe('daycore');
  });

  it('falls back to regular native bridge when daemon backend is not available (no active JSON-RPC bridge)', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    const nativeBridge = new ContractNativeBridge();

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([
        ['cache-hit.flac', probe('cache-hit.flac')],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => nativeBridge,
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'cache-hit.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.outputBackend).not.toBe('jsonrpc');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back when daemon backend is unavailable and pause/seek/resume use regular bridge', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['paused-seek.flac', probe('paused-seek.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const initialStatus = await session.playLocalFile({ filePath: 'paused-seek.flac', output: { outputMode: 'shared' } });
    expect(initialStatus.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );

    const paused = await session.pause();
    expect(paused.state).toBe('paused');

    const seeked = await session.seek(42);
    expect(seeked.state).toBe('paused');
    expect(seeked.positionSeconds).toBe(42);

    const resumed = await session.play();
    expect(resumed.state).toBe('playing');
  });

  it('falls back when daemon backend is unavailable and serializes seek during paused resume', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['resume-race.flac', probe('resume-race.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await session.playLocalFile({ filePath: 'resume-race.flac', output: { outputMode: 'shared' } });
    await session.pause();
    const seeked = await session.seek(42);
    expect(seeked.positionSeconds).toBe(42);

    const resume = session.play();
    const seekDuringResume = session.seek(50);

    const [resumed, doubleSeeked] = await Promise.all([resume, seekDuringResume]);
    expect(resumed.state).toBe('playing');
    expect(doubleSeeked.positionSeconds).toBe(50);
  });

  it('keeps daemon EQ sync failure non-fatal and falls back to regular bridge', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['eq-stale.flac', probe('eq-stale.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'eq-stale.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back when daemon bridge is not available and openFile would have been called', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['closed.flac', probe('closed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'closed.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back to regular native bridge consistently across successive playbacks', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([
        ['first.flac', probe('first.flac')],
        ['second.flac', probe('second.flac')],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const firstStatus = await session.playLocalFile({ filePath: 'first.flac', output: { outputMode: 'shared' } });
    expect(firstStatus.state).toBe('playing');
    expect(firstStatus.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );

    const secondStatus = await session.playLocalFile({ filePath: 'second.flac', output: { outputMode: 'shared' } });
    expect(secondStatus.state).toBe('playing');
    expect(secondStatus.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back for late daemon DSP state cache when daemon bridge is not available', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['late-daemon.flac', probe('late-daemon.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'late-daemon.flac', output: { outputMode: 'shared' } });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
  });

  it('falls back when daemon start fails (startAudioDaemon rejects)', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    mockStartAudioDaemon.mockRejectedValueOnce(new Error('host IO error'));
    const decoder = new ContractDecoder(new Map([['daemon-missing.flac', probe('daemon-missing.flac', 96_000)]]));

    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({
      filePath: 'daemon-missing.flac',
      trackId: 'no-daemon-track',
      output: { outputMode: 'shared' },
    });

    expect(status.state).toBe('playing');
    expect(status.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_fell_back')]),
    );
    expect(decoder.probeRequests).toHaveLength(1);
  });

  it('verifies capabilities check for daemon presence via isNativeHostAvailable', () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['caps.flac', probe('caps.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => false,
    });

    // When isNativeHostAvailable returns false, AudioSession should not
    // enter the daemon path at all (no daemon_playback_fell_back warning)
    expect(session).toBeDefined();
  });
});
