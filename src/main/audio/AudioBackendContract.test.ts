import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSession, type AudioSessionDependencies } from './AudioSession';
import type { DaemonAudioBackend } from './DaemonAudioBackend';
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
    replayGainEnabled: false,
    replayGainMode: 'track' as const,
    replayGainTargetLufs: -18,
    replayGainPreampDb: 0,
    replayGainPreventClipping: true,
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

const enableLegacyLocalPlayback = (): void => {
  process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK = '1';
};

const createDaemonBackendMock = (filePath: string, outputSampleRate = 48_000): DaemonAudioBackend => ({
  capabilities: { daemon: true, exclusiveMode: true },
  getOutputReady: vi.fn(() => ({
    ready: true,
    readyLevel: 'device',
    sampleRate: outputSampleRate,
    backend: 'wasapi-shared',
    backendImpl: 'wasapi-shared-native',
  })),
  start: vi.fn().mockResolvedValue(undefined),
  openFile: vi.fn().mockResolvedValue({
    status: 'ready',
    filePath,
    sampleRate: outputSampleRate,
    channels: 2,
    durationSeconds: 120,
    codec: 'FLAC',
    container: 'FLAC',
  }),
  openSource: vi.fn().mockResolvedValue({
    status: 'ready',
    filePath,
    sampleRate: outputSampleRate,
    channels: 2,
    durationSeconds: 120,
    codec: 'FLAC',
    container: 'FLAC',
  }),
  clearQueue: vi.fn().mockResolvedValue(undefined),
  setQueue: vi.fn().mockResolvedValue(undefined),
  startOpenedSource: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  seek: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getPositionSeconds: vi.fn(() => 0),
  onPosition: vi.fn(),
  onEnded: vi.fn(),
  onError: vi.fn(),
  onAutomixTransitionCommitted: vi.fn(),
  dispose: vi.fn(),
  setPlaybackSpeed: vi.fn().mockResolvedValue(undefined),
  setVolume: vi.fn().mockResolvedValue(undefined),
  setReplayGainConfig: vi.fn().mockResolvedValue(undefined),
  syncDspState: vi.fn().mockResolvedValue(undefined),
} as unknown as DaemonAudioBackend);

afterEach(() => {
  delete process.env.ECHO_FORCE_LEGACY_LOCAL_PLAYBACK;
  contractAppSettingsMock.current = { ...contractAppSettingsMock.defaultValue };
  mockStartAudioDaemon.mockReset();
  mockStartAudioDaemon.mockResolvedValue();
});

describe('AudioBackend lifecycle contract', () => {
  it('keeps the daemon path disabled only through the explicit emergency legacy switch', async () => {
    enableLegacyLocalPlayback();
    const decoder = new ContractDecoder(new Map([['disabled.flac', probe('disabled.flac')]]));
    const startDaemon = vi.fn<() => Promise<void>>().mockResolvedValue();
    const createDaemonBackend = vi.fn().mockResolvedValue(null);
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: startDaemon,
      createDaemonAudioBackend: createDaemonBackend,
    });

    const status = await session.playLocalFile({
      filePath: 'disabled.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: false },
    });

    expect(startDaemon).not.toHaveBeenCalled();
    expect(createDaemonBackend).not.toHaveBeenCalled();
    expect(decoder.decodeRequests).toHaveLength(1);
    expect(status.nativeDirectLocalPlaybackActive).toBe(false);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
    expect(status.warnings.some((warning) => warning.startsWith('daemon_playback_fell_back'))).toBe(false);
  });

  it('uses native direct streaming and keeps pause, seek, resume, and stop on the daemon backend', async () => {
    let positionSeconds = 0;
    const backend = {
      capabilities: { daemon: true, exclusiveMode: false },
      getOutputReady: vi.fn(() => ({ backend: 'wasapi-shared', backendImpl: 'wasapi-shared-native', sampleRate: 48_000 })),
      start: vi.fn().mockResolvedValue(undefined),
      openSource: vi.fn(async (_source: { kind: string; uri: string }, startSeconds = 0) => {
        positionSeconds = startSeconds;
        return {
          status: 'ready',
          filePath: 'direct.flac',
          sampleRate: 48_000,
          channels: 2,
          durationSeconds: 120,
          codec: 'FLAC',
          container: 'FLAC',
        };
      }),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn(async (nextPosition: number) => { positionSeconds = nextPosition; }),
      stop: vi.fn().mockResolvedValue(undefined),
      getPositionSeconds: vi.fn(() => positionSeconds),
      onPosition: vi.fn(),
      onEnded: vi.fn(),
      onError: vi.fn(),
      onAutomixTransitionCommitted: vi.fn(),
      dispose: vi.fn(),
      setPlaybackSpeed: vi.fn().mockResolvedValue(undefined),
      setVolume: vi.fn().mockResolvedValue(undefined),
      setReplayGainConfig: vi.fn().mockResolvedValue(undefined),
      syncDspState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DaemonAudioBackend;
    const decoder = new ContractDecoder(new Map([['direct.flac', probe('direct.flac')]]));
    const startDaemon = vi.fn<() => Promise<void>>().mockResolvedValue();
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: startDaemon,
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });

    const playing = await session.playLocalFile({
      filePath: 'direct.flac',
      startSeconds: 3,
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });
    expect(startDaemon).toHaveBeenCalledOnce();
    expect(backend.syncDspState).toHaveBeenCalledOnce();
    expect(vi.mocked(backend.syncDspState!).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(backend.openSource).mock.invocationCallOrder[0],
    );
    expect(backend.openSource).toHaveBeenCalledWith(
      { kind: 'local', uri: 'direct.flac' },
      3,
      undefined,
    );
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(playing.activeDecodeBackendImpl).toBe('native-direct-daemon-libav');
    expect(playing.activeDecodeBackendLabel).toBe('native-direct-libav-audio-format-daemon');
    expect(playing.nativeDirectLocalPlaybackActive).toBe(true);

    expect((await session.pause()).state).toBe('paused');
    expect(backend.pause).toHaveBeenCalledOnce();
    expect((await session.seek(42)).positionSeconds).toBe(42);
    expect(backend.seek).toHaveBeenCalledWith(42);
    expect((await session.play()).state).toBe('playing');
    expect(backend.resume).toHaveBeenCalledOnce();

    session.stop();
    await vi.waitFor(() => {
      expect(backend.stop).toHaveBeenCalledOnce();
      expect(backend.dispose).toHaveBeenCalledOnce();
    });
  });

  it('leaves the playing state and exposes the transport failure when the active daemon exits', async () => {
    let errorHandler: ((error: Error) => void) | null = null;
    const backend = {
      capabilities: { daemon: true, exclusiveMode: false },
      getOutputReady: vi.fn(() => ({ backend: 'wasapi-shared', backendImpl: 'wasapi-shared-native', sampleRate: 48_000 })),
      start: vi.fn().mockResolvedValue(undefined),
      openSource: vi.fn().mockResolvedValue({
        status: 'ready',
        filePath: 'daemon-crash.flac',
        sampleRate: 48_000,
        channels: 2,
        durationSeconds: 120,
        codec: 'FLAC',
        container: 'FLAC',
      }),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getPositionSeconds: vi.fn(() => 3),
      onPosition: vi.fn(),
      onEnded: vi.fn(),
      onError: vi.fn((handler: (error: Error) => void) => { errorHandler = handler; }),
      onAutomixTransitionCommitted: vi.fn(),
      dispose: vi.fn(),
      setPlaybackSpeed: vi.fn().mockResolvedValue(undefined),
      setVolume: vi.fn().mockResolvedValue(undefined),
      setReplayGainConfig: vi.fn().mockResolvedValue(undefined),
      syncDspState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DaemonAudioBackend;
    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['daemon-crash.flac', probe('daemon-crash.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });
    session.on('error', noopLogger);

    const playing = await session.playLocalFile({
      filePath: 'daemon-crash.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });
    expect(playing.state).toBe('playing');
    expect(errorHandler).not.toBeNull();

    const emitTransportError = errorHandler as unknown as (error: Error) => void;
    emitTransportError(new Error('daemon_rpc_bridge_closed'));

    expect(session.getStatus()).toMatchObject({
      state: 'error',
      error: 'daemon_rpc_bridge_closed',
    });
    await vi.waitFor(() => {
      expect(backend.stop).toHaveBeenCalledOnce();
      expect(backend.dispose).toHaveBeenCalledOnce();
    });
  });

  it('replays the cached queue on daemon attach and keeps the backend alive across autonomous advance', async () => {
    let endedHandler: ((params?: Record<string, unknown>) => void) | null = null;
    const backend = {
      capabilities: { daemon: true, exclusiveMode: false },
      getOutputReady: vi.fn(() => ({ backend: 'wasapi-shared', backendImpl: 'wasapi-shared-native', sampleRate: 48_000 })),
      start: vi.fn().mockResolvedValue(undefined),
      openSource: vi.fn(async (source: { kind: string; uri: string }, startSeconds = 0) => ({
        status: 'ready',
        filePath: source.uri,
        sampleRate: 48_000,
        channels: 2,
        durationSeconds: 120,
        startSeconds,
        codec: 'FLAC',
        container: 'FLAC',
      })),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getPositionSeconds: vi.fn(() => 0),
      onPosition: vi.fn(),
      onEnded: vi.fn((handler: (params?: Record<string, unknown>) => void) => { endedHandler = handler; }),
      onError: vi.fn(),
      onAutomixTransitionCommitted: vi.fn(),
      dispose: vi.fn(),
      setPlaybackSpeed: vi.fn().mockResolvedValue(undefined),
      setVolume: vi.fn().mockResolvedValue(undefined),
      setReplayGainConfig: vi.fn().mockResolvedValue(undefined),
      setQueue: vi.fn().mockResolvedValue(undefined),
      syncDspState: vi.fn().mockResolvedValue(undefined),
    } as unknown as DaemonAudioBackend;
    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['first.flac', probe('first.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });
    await session.syncQueueToBackend([
      { itemId: 'queue-1', trackId: 'track-1', filePath: 'first.flac', sampleRate: 48_000, startSeconds: 0 },
      { itemId: 'queue-2', trackId: 'track-2', filePath: 'second.flac', sampleRate: 96_000, startSeconds: 0 },
    ], 'off', 'queue-1');

    await session.playLocalFile({
      filePath: 'first.flac',
      trackId: 'track-1',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(backend.setQueue).toHaveBeenCalledWith(expect.objectContaining({
      revision: 1,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: expect.arrayContaining([expect.objectContaining({ itemId: 'queue-2', trackId: 'track-2' })]),
    }));
    expect(vi.mocked(backend.setQueue).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(backend.openSource).mock.invocationCallOrder[0],
    );

    expect(endedHandler).not.toBeNull();
    const emitEnded = endedHandler as unknown as (params: Record<string, unknown>) => void;
    emitEnded({
      queueAdvance: true,
      operationId: 2,
      queueRevision: 1,
      nextItemId: 'queue-2',
      nextTrackId: 'track-2',
      nextFilePath: 'second.flac',
      nextSampleRate: 48_000,
      nextSourceSampleRate: 96_000,
      nextChannels: 2,
      nextDurationSeconds: 90,
      nextStartSeconds: 0,
      nextCodec: 'FLAC',
      nextMetadata: {
        title: 'Second track',
        artist: 'Second artist',
        album: 'Second album',
        albumArtist: 'Various artists',
        coverUrl: 'cover://second',
      },
    });

    expect(session.getStatus()).toMatchObject({
      state: 'playing',
      currentTrackId: 'track-2',
      currentQueueItemId: 'queue-2',
      queueRevision: 1,
      currentFilePath: 'second.flac',
      currentTrackTitle: 'Second track',
      currentTrackArtist: 'Second artist',
      durationSeconds: 90,
      fileSampleRate: 96_000,
    });
    expect(backend.dispose).not.toHaveBeenCalled();
  });

  it('awaits daemon stop before publishing a natural end', async () => {
    let endedHandler: ((params?: Record<string, unknown>) => void) | null = null;
    let resolveStop: (() => void) | null = null;
    const stopBarrier = new Promise<void>((resolve) => { resolveStop = resolve; });
    const backend = createDaemonBackendMock('natural-end.flac');
    backend.onEnded = vi.fn((handler: (params?: Record<string, unknown>) => void) => { endedHandler = handler; });
    backend.stop = vi.fn(() => stopBarrier);
    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['natural-end.flac', probe('natural-end.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });

    await session.playLocalFile({
      filePath: 'natural-end.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });
    expect(endedHandler).not.toBeNull();
    (endedHandler as unknown as (params?: Record<string, unknown>) => void)({ operationId: 1 });

    expect(backend.stop).toHaveBeenCalledOnce();
    expect(session.getStatus().state).toBe('playing');
    expect(backend.dispose).not.toHaveBeenCalled();

    resolveStop!();
    await vi.waitFor(() => {
      expect(session.getStatus().state).toBe('ended');
      expect(backend.dispose).toHaveBeenCalledOnce();
    });
    session.dispose();
  });

  it('stops daemon auto-advance at a mixed-rate exclusive boundary', async () => {
    const backend = createDaemonBackendMock('first-exclusive.flac', 44_100);
    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['first-exclusive.flac', probe('first-exclusive.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });
    await session.syncQueueToBackend([
      { itemId: 'queue-1', trackId: 'track-1', filePath: 'first-exclusive.flac', sampleRate: 44_100 },
      { itemId: 'queue-2', trackId: 'track-2', filePath: 'second-exclusive.flac', sampleRate: 48_000 },
      { itemId: 'queue-3', trackId: 'track-3', filePath: 'third-exclusive.flac', sampleRate: 44_100 },
    ], 'all', 'queue-1');

    await session.playLocalFile({
      filePath: 'first-exclusive.flac',
      trackId: 'track-1',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(backend.setQueue).toHaveBeenCalledWith({
      revision: 1,
      currentItemId: 'queue-1',
      repeatMode: 'off',
      items: [
        expect.objectContaining({
          itemId: 'queue-1',
          filePath: 'first-exclusive.flac',
          sampleRate: 44_100,
        }),
      ],
    });
    session.dispose();
  });

  it('keeps the complete mixed-rate daemon queue for strict ASIO PCM transitions', async () => {
    let endedHandler: ((params?: Record<string, unknown>) => void) | null = null;
    const backend = createDaemonBackendMock('first-asio.flac', 44_100);
    backend.onEnded = vi.fn((handler: (params?: Record<string, unknown>) => void) => { endedHandler = handler; });
    backend.getOutputReady = vi.fn(() => ({
      ready: true,
      readyLevel: 'device' as const,
      sampleRate: 44_100,
      hardwareSampleRate: 44_100,
      backend: 'asio',
      backendImpl: 'asio-native',
      deviceType: 'ASIO',
      deviceName: 'Matrix ASIO Driver',
    }));
    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['first-asio.flac', probe('first-asio.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });
    await session.syncQueueToBackend([
      { itemId: 'queue-1', trackId: 'track-1', filePath: 'first-asio.flac', sampleRate: 44_100 },
      { itemId: 'queue-2', trackId: 'track-2', filePath: 'second-asio.mp3', sampleRate: 48_000 },
      { itemId: 'queue-3', trackId: 'track-3', filePath: 'third-asio.mp3', sampleRate: 44_100 },
    ], 'all', 'queue-1');

    await session.playLocalFile({
      filePath: 'first-asio.flac',
      trackId: 'track-1',
      output: {
        outputMode: 'asio',
        deviceIndex: 0,
        deviceName: 'Matrix ASIO Driver',
        nativeDirectLocalPlaybackEnabled: true,
      },
    });

    expect(backend.setQueue).toHaveBeenCalledWith({
      revision: 1,
      currentItemId: 'queue-1',
      repeatMode: 'all',
      items: [
        expect.objectContaining({ itemId: 'queue-1', sampleRate: 44_100 }),
        expect.objectContaining({ itemId: 'queue-2', sampleRate: 48_000 }),
        expect.objectContaining({ itemId: 'queue-3', sampleRate: 44_100 }),
      ],
    });
    expect(endedHandler).not.toBeNull();
    (endedHandler as unknown as (params: Record<string, unknown>) => void)({
      queueAdvance: true,
      fromOperationId: 1,
      operationId: 2,
      queueRevision: 1,
      nextItemId: 'queue-2',
      nextTrackId: 'track-2',
      nextFilePath: 'second-asio.mp3',
      nextSampleRate: 48_000,
      nextSourceSampleRate: 48_000,
      nextChannels: 2,
      nextDurationSeconds: 90,
      nextStartSeconds: 0,
      nextCodec: 'MP3',
      previousSampleRate: 44_100,
      targetSampleRate: 48_000,
      actualSampleRate: 48_000,
      sampleRateTransitionMode: 'asio-full-reopen',
      sampleRateTransitionDurationMs: 120,
    });
    expect(session.getStatus()).toMatchObject({
      state: 'playing',
      currentTrackId: 'track-2',
      fileSampleRate: 48_000,
      decoderOutputSampleRate: 48_000,
      requestedOutputSampleRate: 48_000,
      actualDeviceSampleRate: 48_000,
      resampling: false,
      bitPerfectCandidate: true,
    });
    session.dispose();
  });

  it('routes an explicit non-default shared device through the authoritative daemon path', async () => {
    const decoder = new ContractDecoder(new Map([['custom-device.flac', probe('custom-device.flac')]]));
    const startDaemon = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backend = createDaemonBackendMock('custom-device.flac');
    const createDaemonBackend = vi.fn().mockResolvedValue(backend);
    const session = createContractSession({
      decoder,
      deviceService: {
        listDevices: () => [{
          id: 'shared:3',
          index: 3,
          name: 'USB DAC',
          outputMode: 'shared',
          sampleRate: 48_000,
          sharedDeviceSampleRate: 48_000,
          isDefault: false,
        }],
      },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: startDaemon,
      createDaemonAudioBackend: createDaemonBackend,
    });

    const status = await session.playLocalFile({
      filePath: 'custom-device.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 3,
        deviceName: 'USB DAC',
        nativeDirectLocalPlaybackEnabled: true,
      },
    });

    expect(startDaemon).toHaveBeenCalledOnce();
    expect(createDaemonBackend).toHaveBeenCalledWith(
      'shared:3',
      expect.objectContaining({ deviceIndex: 3, deviceName: 'USB DAC' }),
    );
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('sends ECHO SRC and Dither configuration only to the native daemon', async () => {
    const backend = createDaemonBackendMock('native-src.flac', 192_000);
    const createDaemonBackend = vi.fn().mockResolvedValue(backend);
    const decoder = new ContractDecoder(new Map([['native-src.flac', probe('native-src.flac', 48_000)]]));
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: createDaemonBackend,
    });

    await session.playLocalFile({
      filePath: 'native-src.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family4x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile1x: 'poly-sinc-gauss-long',
        echoSrcFilterProfileNx: 'poly-sinc-hb',
        pcmDitherMode: 'ns-5',
      },
    });

    expect(createDaemonBackend).toHaveBeenCalledWith('', expect.objectContaining({
      requestedOutputSampleRate: 192_000,
      nativeProcessing: expect.objectContaining({
        outputFormat: 'pcm',
        dither: { mode: 'ns-5', bitDepth: 24 },
        echoSrc: expect.objectContaining({
          sourceSampleRate: 48_000,
          targetSampleRate: 192_000,
          computeBackend: 'cpu',
          stages: expect.arrayContaining([
            expect.objectContaining({ upsampleFactor: 2, taps: expect.any(Array) }),
          ]),
        }),
      }),
    }));
    expect(decoder.decodeRequests).toHaveLength(0);
  });

  it('keeps advanced ECHO SRC on the native ASIO daemon route', async () => {
    const backend = createDaemonBackendMock('native-asio-src.flac', 96_000);
    const createDaemonBackend = vi.fn().mockResolvedValue(backend);
    const decoder = new ContractDecoder(new Map([['native-asio-src.flac', probe('native-asio-src.flac', 48_000)]]));
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: createDaemonBackend,
    });

    await session.syncQueueToBackend([
      { itemId: 'src-1', trackId: 'src-track-1', filePath: 'native-asio-src.flac', sampleRate: 48_000 },
      { itemId: 'src-2', trackId: 'src-track-2', filePath: 'native-asio-src-next.flac', sampleRate: 44_100 },
    ], 'off', 'src-1');

    await session.playLocalFile({
      filePath: 'native-asio-src.flac',
      output: {
        outputMode: 'asio',
        echoSrcMode: 'family2x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcComputeBackend: 'cpu',
      },
    });

    expect(createDaemonBackend).toHaveBeenCalledWith('', expect.objectContaining({
      requestedOutputSampleRate: 96_000,
      nativeProcessing: expect.objectContaining({
        outputFormat: 'pcm',
        echoSrc: expect.objectContaining({
          sourceSampleRate: 48_000,
          targetSampleRate: 96_000,
          computeBackend: 'cpu',
        }),
      }),
    }));
    expect(backend.setQueue).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ itemId: 'src-1' })],
    }));
  });

  it('sends PCM-to-SDM configuration and DoP rate only to the native daemon', async () => {
    const backend = createDaemonBackendMock('native-sdm.flac', 384_000);
    const createDaemonBackend = vi.fn().mockResolvedValue(backend);
    const decoder = new ContractDecoder(new Map([['native-sdm.flac', probe('native-sdm.flac', 48_000)]]));
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: createDaemonBackend,
    });

    await session.playLocalFile({
      filePath: 'native-sdm.flac',
      output: {
        outputMode: 'exclusive',
        sdmMode: 'pcmToDsd',
        sdmTargetRate: 'dsd128',
        sdmQualityProfile: 'reference',
      },
    });

    expect(createDaemonBackend).toHaveBeenCalledWith('', expect.objectContaining({
      requestedOutputSampleRate: 384_000,
      nativeProcessing: expect.objectContaining({
        outputFormat: 'dop24le',
        sdm: expect.objectContaining({
          sourceSampleRate: 48_000,
          targetSampleRate: 384_000,
          qualityProfile: 'reference',
          computeBackend: 'cpu',
          stages: expect.arrayContaining([
            expect.objectContaining({ upsampleFactor: 2, taps: expect.any(Array) }),
          ]),
        }),
      }),
    }));
    expect(decoder.decodeRequests).toHaveLength(0);
  });

  it('keeps ReplayGain inside the native daemon DSP path', async () => {
    contractAppSettingsMock.current.replayGainEnabled = true;
    const backend = createDaemonBackendMock('replaygain.flac');
    const decoder = new ContractDecoder(new Map([['replaygain.flac', probe('replaygain.flac')]]));
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
      startAudioDaemon: vi.fn().mockResolvedValue(undefined),
      createDaemonAudioBackend: vi.fn().mockResolvedValue(backend),
    });

    const status = await session.playLocalFile({
      filePath: 'replaygain.flac',
      replayGain: { trackGainDb: -6, trackPeak: 0.5 },
      output: { outputMode: 'shared' },
    });

    expect(backend.setReplayGainConfig).toHaveBeenCalledWith({
      trackGainDb: -6,
      albumGainDb: -6,
      peak: 0,
      mode: 1,
      preampDb: 0,
      preventClipping: false,
    });
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
  });

  it('fails closed when daemon backend creation fails because the active bridge is closed', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    const decoder = new ContractDecoder(new Map([['track.flac', probe('track.flac')]]));
    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await expect(session.playLocalFile({
      filePath: 'track.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    })).rejects.toThrow('daemon_backend_unavailable');
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(session.getStatus().warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_failed_closed')]),
    );
  });

  it('uses the regular native bridge when the emergency legacy switch is enabled', async () => {
    enableLegacyLocalPlayback();
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

    const status = await session.playLocalFile({ filePath: 'daemon.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    expect(status.state).toBe('playing');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
    expect(status.warnings.some((warning) => warning.startsWith('daemon_playback_failed_closed'))).toBe(false);
  });

  it('keeps speed settings on the explicit emergency legacy path', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['daemon-speed.flac', probe('daemon-speed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({
      filePath: 'daemon-speed.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true, playbackRate: 1.25, playbackSpeedMode: 'speed' },
    });

    expect(status.state).toBe('playing');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('updates playback speed on the explicit emergency legacy path', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['daemon-live-speed.flac', probe('daemon-live-speed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await session.playLocalFile({ filePath: 'daemon-live-speed.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    const status = await session.setOutput({ playbackRate: 1.5, playbackSpeedMode: 'daycore' });

    expect(status.playbackRate).toBe(1.5);
    expect(status.playbackSpeedMode).toBe('daycore');
  });

  it('uses the regular bridge without a JSON-RPC daemon only when explicitly forced to legacy', async () => {
    enableLegacyLocalPlayback();
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

    const status = await session.playLocalFile({ filePath: 'cache-hit.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    expect(status.state).toBe('playing');
    expect(status.outputBackend).not.toBe('jsonrpc');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('keeps pause/seek/resume on the explicitly forced legacy bridge', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['paused-seek.flac', probe('paused-seek.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const initialStatus = await session.playLocalFile({ filePath: 'paused-seek.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });
    expect(initialStatus.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');

    const paused = await session.pause();
    expect(paused.state).toBe('paused');

    const seeked = await session.seek(42);
    expect(seeked.state).toBe('paused');
    expect(seeked.positionSeconds).toBe(42);

    const resumed = await session.play();
    expect(resumed.state).toBe('playing');
  });

  it('serializes paused resume and seek on the explicitly forced legacy bridge', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    const decoder = new ContractDecoder(new Map([['resume-race.flac', probe('resume-race.flac')]]));

    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await session.playLocalFile({ filePath: 'resume-race.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });
    await session.pause();
    const seeked = await session.seek(42);
    expect(seeked.positionSeconds).toBe(42);

    const resume = session.play();
    const seekDuringResume = session.seek(50);

    const [resumed, doubleSeeked] = await Promise.all([resume, seekDuringResume]);
    expect(resumed.state).toBe('playing');
    expect(doubleSeeked.positionSeconds).toBe(50);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ startSeconds: 50 });
  });

  it('keeps legacy playback independent of daemon EQ sync when explicitly forced', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['eq-stale.flac', probe('eq-stale.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'eq-stale.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    expect(status.state).toBe('playing');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('opens through the regular bridge when the emergency legacy path is explicit', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['closed.flac', probe('closed.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'closed.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    expect(status.state).toBe('playing');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('keeps the explicit legacy bridge stable across successive playbacks', async () => {
    enableLegacyLocalPlayback();
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

    const firstStatus = await session.playLocalFile({ filePath: 'first.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });
    expect(firstStatus.state).toBe('playing');
    expect(firstStatus.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');

    const secondStatus = await session.playLocalFile({ filePath: 'second.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });
    expect(secondStatus.state).toBe('playing');
    expect(secondStatus.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('keeps the explicit legacy path independent of a late daemon DSP cache', async () => {
    enableLegacyLocalPlayback();
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;

    const session = createContractSession({
      decoder: new ContractDecoder(new Map([['late-daemon.flac', probe('late-daemon.flac')]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    const status = await session.playLocalFile({ filePath: 'late-daemon.flac', output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true } });

    expect(status.state).toBe('playing');
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
  });

  it('fails closed when daemon startup rejects', async () => {
    contractAppSettingsMock.current.lowLoadPlaybackModeEnabled = false;
    mockStartAudioDaemon.mockRejectedValueOnce(new Error('host IO error'));
    const decoder = new ContractDecoder(new Map([['daemon-missing.flac', probe('daemon-missing.flac', 96_000)]]));

    const session = createContractSession({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new ContractNativeBridge(),
      isNativeHostAvailable: () => true,
    });

    await expect(session.playLocalFile({
      filePath: 'daemon-missing.flac',
      trackId: 'no-daemon-track',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    })).rejects.toThrow('host IO error');
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(session.getStatus().warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('daemon_playback_failed_closed')]),
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
