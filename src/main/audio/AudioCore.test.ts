import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams, execFile as nodeExecFile, execFileSync as nodeExecFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as AppSettingsModule from '../app/appSettings';
import { AudioSession, type AudioSessionDependencies } from './AudioSession';
import { DecoderPipeline, classifyFfmpegDecodeError, resolveDecoderFfmpegPath } from './DecoderPipeline';
import type { DecoderPipelineDependencies } from './DecoderPipeline';
import { DeviceService } from './DeviceService';
import { clearFfmpegToolchainCache, resolveFfmpegToolchain } from './FfmpegToolchain';
import { getEqBridge } from './EqBridge';
import type { EchoSdmWorkerRequest, EchoSrcFirWorkerRequest } from './EchoSrcCudaWorker';
import { NativePcmHostProcess as NativeOutputBridge, resolveHostBinary } from './NativePcmHostProcess';
import type { HostSpawner } from './DaemonHostProcess';
import { createEstimatedAutomixAnalysis } from './AutomixPlanner';
import type {
  AudioDeviceInfo,
  AudioProbeResult,
  AudioStatus,
  DecoderRun,
  NativeBridgeReadyResult,
  NativeHostNotificationEvent,
  NativeOutputStartOptions,
  PcmAutomixDecodeRequest,
  PcmDecodeRequest,
  PcmGaplessDecodeRequest,
} from './audioTypes';

const audioCoreAppSettingsMock = vi.hoisted(() => {
  const defaultValue = {
    homeWaveformVisualizerEnabled: true,
    audioVisualSpectrumEnabled: true,
    lowLoadPlaybackModeEnabled: false,
    audioNativeDirectLocalPlaybackEnabled: false,
    audioTransportFadeEnabled: false,
    audioTransportFadeCurve: 'smooth' as 'linear' | 'smooth' | 'equalPower',
    replayGainEnabled: false,
    replayGainMode: 'track' as const,
    replayGainTargetLufs: -14,
    replayGainPreampDb: 0,
    replayGainPreventClipping: true,
  };
  return {
    defaultValue,
    current: { ...defaultValue },
  };
});
const disableAudioVisualSpectrumForDirectPlaybackTest = (): void => {
  audioCoreAppSettingsMock.current = {
    ...audioCoreAppSettingsMock.current,
    audioVisualSpectrumEnabled: false,
  };
};

vi.mock('../app/appSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof AppSettingsModule>();
  return {
    ...actual,
    getAppSettings: () => audioCoreAppSettingsMock.current,
    setAppSettings: vi.fn((patch: Record<string, unknown>) => {
      audioCoreAppSettingsMock.current = {
        ...audioCoreAppSettingsMock.current,
        ...patch,
      };
      return audioCoreAppSettingsMock.current;
    }),
  };
});

const noopLogger = (): void => undefined;
const asioMatrixSampleRates = [44100, 48000, 88200, 96000, 176400, 192000] as const;

afterEach(() => {
  audioCoreAppSettingsMock.current = { ...audioCoreAppSettingsMock.defaultValue };
  vi.useRealTimers();
  void getEqBridge().setEnabled(false);
  getEqBridge().removeAllListeners('state');
  clearFfmpegToolchainCache();
});

const probe = (filePath: string, fileSampleRate: number): AudioProbeResult => ({
  filePath,
  fileSampleRate,
  durationSeconds: 120,
  channels: 2,
  codec: 'FLAC',
  bitDepth: 24,
  bitrate: 1400000,
});

const dsdProbe = (filePath: string, fileSampleRate = 2_822_400): AudioProbeResult => ({
  filePath,
  fileSampleRate,
  durationSeconds: 120,
  channels: 2,
  codec: 'DSF',
  bitDepth: 1,
  bitrate: 5_645_000,
});

const createDsfDopFixture = (): Buffer => {
  const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const buffer = Buffer.alloc(28 + 52 + 12 + data.length);

  buffer.write('DSD ', 0, 'ascii');
  buffer.writeBigUInt64LE(28n, 4);
  buffer.writeBigUInt64LE(BigInt(buffer.length), 12);
  buffer.writeBigUInt64LE(0n, 20);

  const fmtOffset = 28;
  buffer.write('fmt ', fmtOffset, 'ascii');
  buffer.writeBigUInt64LE(52n, fmtOffset + 4);
  buffer.writeUInt32LE(1, fmtOffset + 12);
  buffer.writeUInt32LE(0, fmtOffset + 16);
  buffer.writeUInt32LE(2, fmtOffset + 20);
  buffer.writeUInt32LE(2, fmtOffset + 24);
  buffer.writeUInt32LE(2_822_400, fmtOffset + 28);
  buffer.writeUInt32LE(1, fmtOffset + 32);
  buffer.writeBigUInt64LE(32n, fmtOffset + 36);
  buffer.writeUInt32LE(4, fmtOffset + 44);

  const dataOffset = 28 + 52;
  buffer.write('data', dataOffset, 'ascii');
  buffer.writeBigUInt64LE(BigInt(12 + data.length), dataOffset + 4);
  data.copy(buffer, dataOffset + 12);

  return buffer;
};

const pcmBuffer = (samples: number[]): Buffer => {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => {
    buffer.writeFloatLE(sample, index * 4);
  });
  return buffer;
};

class FakeDecoder {
  readonly decodeRequests: PcmDecodeRequest[] = [];
  readonly probeRequests: string[] = [];

  constructor(private readonly probes: Map<string, AudioProbeResult>) {}

  async probeLocalFile(filePath: string): Promise<AudioProbeResult> {
    this.probeRequests.push(filePath);
    const result = this.probes.get(filePath);

    if (!result) {
      throw new Error(`missing probe for ${filePath}`);
    }

    return result;
  }

  decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    const stop = vi.fn(() => {
      stream.destroy();
    });

    queueMicrotask(() => {
      if (!stream.destroyed) {
        stream.end();
      }
    });

    return {
      stream,
      stop,
      done: Promise.resolve(),
    };
  }
}

class AutomixPairDecoder extends FakeDecoder {
  readonly automixRequests: PcmAutomixDecodeRequest[] = [];

  decodeAutomixPair(request: PcmAutomixDecodeRequest): DecoderRun {
    this.automixRequests.push(request);
    return this.decodeLocalFile(request.current);
  }
}

class GaplessSequenceDecoder extends FakeDecoder {
  readonly gaplessRequests: PcmGaplessDecodeRequest[] = [];

  decodeGaplessSequence(request: PcmGaplessDecodeRequest): DecoderRun {
    this.gaplessRequests.push(request);
    const stream = new PassThrough();
    const stop = vi.fn(() => {
      stream.destroy();
    });

    queueMicrotask(() => {
      if (!stream.destroyed) {
        stream.end();
      }
    });

    return {
      stream,
      stop,
      done: Promise.resolve(),
    };
  }
}

class DelayedReadyDecoder extends FakeDecoder {
  private resolveReady: (() => void) | null = null;
  private stream: PassThrough | null = null;

  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    this.stream = stream;
    const ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    return {
      stream,
      ready,
      done: new Promise(() => undefined),
      stop: vi.fn(() => {
        stream.destroy();
      }),
    };
  }

  releaseReady(): void {
    if (!this.stream || !this.resolveReady) {
      throw new Error('decoder ready was not pending');
    }

    this.stream.write(pcmBuffer([0, 0]));
    this.resolveReady();
    this.resolveReady = null;
  }
}

class PcmChunkDecoder extends FakeDecoder {
  constructor(
    probes: Map<string, AudioProbeResult>,
    private readonly chunks: Buffer[],
  ) {
    super(probes);
  }

  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    const stop = vi.fn(() => {
      stream.destroy();
    });

    queueMicrotask(() => {
      if (stream.destroyed) {
        return;
      }

      this.chunks.forEach((chunk) => stream.write(chunk));
    });

    return {
      stream,
      stop,
      done: new Promise(() => undefined),
    };
  }
}

class FailingDecoder extends FakeDecoder {
  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();

    return {
      stream,
      stop: vi.fn(() => {
        stream.destroy();
      }),
      done: Promise.reject(new Error('ffmpeg_missing')),
    };
  }
}

class ControlledFailingDecoder extends FakeDecoder {
  private rejectDone: ((error: Error) => void) | null = null;

  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();

    return {
      stream,
      stop: vi.fn(() => {
        stream.destroy();
      }),
      done: new Promise<void>((_resolve, reject) => {
        this.rejectDone = reject;
      }),
    };
  }

  fail(error: Error): void {
    this.rejectDone?.(error);
  }
}

class StreamErrorDecoder extends FakeDecoder {
  private stream: PassThrough | null = null;

  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    const stop = vi.fn(() => {
      stream.destroy();
    });
    this.stream = stream;

    return {
      stream,
      stop,
      done: new Promise(() => undefined),
    };
  }

  emitDecodeError(message: string): void {
    this.stream?.emit('error', new Error(message));
  }
}

class EarlyDoneDecoder extends FakeDecoder {
  private stream: PassThrough | null = null;
  private resolveDone: (() => void) | null = null;

  override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    this.decodeRequests.push(request);
    const stream = new PassThrough();
    const stop = vi.fn(() => {
      stream.destroy();
    });
    this.stream = stream;

    return {
      stream,
      stop,
      done: new Promise<void>((resolve) => {
        this.resolveDone = resolve;
      }),
    };
  }

  finishDecoderProcess(): void {
    this.resolveDone?.();
  }

  endPcmStream(chunk: Buffer): void {
    this.stream?.end(chunk);
  }
}

class FakeBridge extends EventEmitter {
  inputEnded = false;
  sessionBegins = 0;
  sessionEnds = 0;
  readonly sessionChunks: Array<{ sessionId: number; chunk: Buffer }> = [];
  readonly sessionBeginOptions: Array<{
    startSeconds?: number;
    playbackRate?: number;
    durationSeconds?: number;
    directFilePath?: string;
    directStartSeconds?: number;
    directSampleRate?: number;
    directChannels?: number;
    directOutputChannels?: number;
    directPlaybackRate?: number;
    directGain?: number;
  }> = [];
  readonly writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final: (callback) => {
      this.inputEnded = true;
      callback();
    },
  });
  readonly stop = vi.fn();
  readonly setVolume = vi.fn((volume: number) => {
    this.volume = Math.max(0, Math.min(1, volume));
  });
  readonly setPaused = vi.fn();
  startOptions: NativeOutputStartOptions | null = null;
  positionSeconds = 0;
  volume = 1;
  private sessionId = 0;

  constructor(
    private readonly readySampleRate?: number,
    private readonly readyDevicePatch: Partial<NativeBridgeReadyResult['device']> = {},
  ) {
    super();
  }

  async start(options: NativeOutputStartOptions) {
    this.startOptions = options;
    this.positionSeconds = options.startSeconds ?? 0;
    const actualDeviceSampleRate = this.readySampleRate ?? options.requestedOutputSampleRate;
    const requestedBufferFrames = Math.max(1, Math.round(options.bufferSizeFrames ?? 512));

    return {
      ok: true as const,
      device: {
        ready: true,
        sampleRate: actualDeviceSampleRate,
         backend: options.exclusive
            ? 'wasapi-exclusive'
            : 'wasapi-shared',
        deviceType: options.exclusive
            ? 'Windows Audio (Exclusive Mode)'
            : 'Windows Audio (Shared Mode)',
        deviceName: options.deviceName ?? 'Default output',
        deviceBufferFrames: requestedBufferFrames,
        nativeActualBufferFrames: requestedBufferFrames,
        actualBufferFrames: requestedBufferFrames,
        requestedDeviceBufferFrames: requestedBufferFrames,
        openedDeviceBufferFrames: requestedBufferFrames,
        bufferSizeFallback: false,
        ...this.readyDevicePatch,
      },
      requestedOutputSampleRate: options.requestedOutputSampleRate,
      actualDeviceSampleRate,
    };
  }

  getPositionSeconds(): number {
    return this.positionSeconds;
  }

  resetOutputClock(startSeconds = 0): void {
    this.positionSeconds = startSeconds;
  }

  rebaseOutputClock(startSeconds = 0): void {
    this.positionSeconds = startSeconds;
  }

  canReuseFor(options: NativeOutputStartOptions): boolean {
    const normalizeSampleRate = (value: unknown): number | null => {
      const numeric = Number(value);

      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
    };
    const outputMode = options.exclusive ? 'exclusive' : 'shared';
    const startOutputMode = this.startOptions?.exclusive ? 'exclusive' : 'shared';
    const sampleRate =
      outputMode === 'shared'
        ? normalizeSampleRate(options.sharedMixSampleRate) ?? normalizeSampleRate(options.requestedOutputSampleRate)
        : normalizeSampleRate(options.requestedOutputSampleRate);
    const startSampleRate =
      startOutputMode === 'shared'
        ? normalizeSampleRate(this.startOptions?.sharedMixSampleRate) ?? normalizeSampleRate(this.startOptions?.requestedOutputSampleRate)
        : normalizeSampleRate(this.startOptions?.requestedOutputSampleRate);

    return JSON.stringify({
      outputMode,
      deviceIndex: Number.isInteger(Number(options.deviceIndex)) ? Number(options.deviceIndex) : null,
      deviceName: options.deviceName ?? null,
      sharedBackend: outputMode === 'shared' ? options.sharedBackend ?? 'auto' : null,
      sampleRate,
      channels: options.channels,
      exclusive: options.exclusive === true,
      bufferSizeFrames: Number.isFinite(Number(options.bufferSizeFrames)) ? Math.round(Number(options.bufferSizeFrames)) : null,
      latencyProfile: options.latencyProfile ?? null,
      playbackSpeedMode: options.playbackSpeedMode ?? null,
      inputFormat: options.inputFormat ?? 'pcm-f32le',
      nativeDsdSampleRate: options.nativeDsdSampleRate ?? null,
    }) === JSON.stringify({
      outputMode: startOutputMode,
      deviceIndex: Number.isInteger(Number(this.startOptions?.deviceIndex)) ? Number(this.startOptions?.deviceIndex) : null,
      deviceName: this.startOptions?.deviceName ?? null,
      sharedBackend: startOutputMode === 'shared' ? this.startOptions?.sharedBackend ?? 'auto' : null,
      sampleRate: startSampleRate,
      channels: this.startOptions?.channels,
      exclusive: this.startOptions?.exclusive === true,
      bufferSizeFrames: Number.isFinite(Number(this.startOptions?.bufferSizeFrames)) ? Math.round(Number(this.startOptions?.bufferSizeFrames)) : null,
      latencyProfile: this.startOptions?.latencyProfile ?? null,
      playbackSpeedMode: this.startOptions?.playbackSpeedMode ?? null,
      inputFormat: this.startOptions?.inputFormat ?? 'pcm-f32le',
      nativeDsdSampleRate: this.startOptions?.nativeDsdSampleRate ?? null,
    });
  }

  beginSession(options: {
    startSeconds?: number;
    playbackRate?: number;
    durationSeconds?: number;
    directFilePath?: string;
    directStartSeconds?: number;
    directSampleRate?: number;
    directChannels?: number;
    directOutputChannels?: number;
    directPlaybackRate?: number;
    directGain?: number;
  } = {}): number {
    this.sessionBegins += 1;
    this.sessionBeginOptions.push(options);
    this.inputEnded = false;
    this.positionSeconds = options.startSeconds ?? 0;
    this.sessionId += 1;
    return this.sessionId;
  }

  createSessionWritable(sessionId = this.sessionId): Writable {
    return new Writable({
      write: (chunk, _encoding, callback) => {
        this.sessionChunks.push({ sessionId, chunk: Buffer.from(chunk) });
        callback();
      },
      final: (callback) => {
        this.endSession(sessionId);
        callback();
      },
    });
  }

  endSession(_sessionId?: number): void {
    void _sessionId;
    this.sessionEnds += 1;
    this.inputEnded = true;
  }
}

class NativeAutomixBridge extends FakeBridge {
  readonly prepareAutomixPlan = vi.fn();
  readonly nextChunks: Buffer[] = [];

  createAutomixNextWritable(): Writable {
    return new Writable({
      write: (chunk, _encoding, callback) => {
        this.nextChunks.push(Buffer.from(chunk));
        callback();
      },
    });
  }
}

class WritableErrorBridge extends FakeBridge {
  private sessionWritable: Writable | null = null;

  override createSessionWritable(sessionId = 1): Writable {
    this.sessionWritable = new Writable({
      write: (_chunk, _encoding, callback) => {
        this.sessionChunks.push({ sessionId, chunk: Buffer.alloc(0) });
        callback();
      },
    });
    return this.sessionWritable;
  }

  emitWritableError(message: string): void {
    this.sessionWritable?.emit('error', new Error(message));
  }
}

class GracefulFakeBridge extends FakeBridge {
  readonly stopGracefully = vi.fn(async () => undefined);
}

class ThrowingStopBridge extends FakeBridge {
  override readonly stop = vi.fn(() => {
    throw new Error('stop failed');
  });
}

class ThrowingPositionBridge extends FakeBridge {
  failPositionReads = false;

  override getPositionSeconds(): number {
    if (this.failPositionReads) {
      throw new Error('position read failed');
    }

    return super.getPositionSeconds();
  }
}

class DelayedReadyBridge extends FakeBridge {
  private resolveStarted: (() => void) | null = null;
  private resolveReady: (() => void) | null = null;

  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  releaseReady(): void {
    this.resolveReady?.();
  }

  override async start(options: NativeOutputStartOptions) {
    this.startOptions = options;
    this.positionSeconds = options.startSeconds ?? 0;
    this.resolveStarted?.();
    await new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    return super.start(options);
  }
}

class StartupFailingBridge extends EventEmitter {
  readonly writable = null;
  readonly stop = vi.fn();

  async start(): Promise<NativeBridgeReadyResult> {
    throw new Error(
      'echo-audio-host exit_code_1; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; stderr="Failed to initialize output device"',
    );
  }

  getPositionSeconds(): number {
    return 0;
  }
}

class ConfigurableStartupFailingBridge extends EventEmitter {
  readonly writable = null;
  readonly stop = vi.fn();
  startOptions: NativeOutputStartOptions | null = null;

  constructor(private readonly message: string) {
    super();
  }

  async start(options: NativeOutputStartOptions): Promise<NativeBridgeReadyResult> {
    this.startOptions = options;
    throw new Error(this.message);
  }

  getPositionSeconds(): number {
    return 0;
  }
}

const createAudioSessionForTest = (dependencies: AudioSessionDependencies): AudioSession => {
  const session = new AudioSession({
    transportFadeDurationMs: 0,
    ...dependencies,
  });

  return session;
};

const createSessionHarness = (
  probes: AudioProbeResult[],
  readySampleRates: number[] = [],
  devices: AudioDeviceInfo[] = [],
  sessionOptions: Partial<AudioSessionDependencies> = {},
) => {
  const decoder = new FakeDecoder(new Map(probes.map((item) => [item.filePath, item])));
  const bridges: FakeBridge[] = [];
  let bridgeIndex = 0;
  const session = createAudioSessionForTest({
    decoder,
    deviceService: {
      listDevices: () => devices,
    },
    createBridge: () => {
      const bridge = new FakeBridge(readySampleRates[bridgeIndex]);
      bridgeIndex += 1;
      bridges.push(bridge);
      return bridge;
    },
    logger: noopLogger,
    ...sessionOptions,
  });
  return { decoder, bridges, session };
};

const createLongRunningSessionHarness = (
  probes: AudioProbeResult[],
  readySampleRates: number[] = [],
  devices: AudioDeviceInfo[] = [],
  sessionOptions: Partial<AudioSessionDependencies> = {},
) => {
  const decoder = new PcmChunkDecoder(new Map(probes.map((item) => [item.filePath, item])), [pcmBuffer([0, 0, 0, 0])]);
  const bridges: FakeBridge[] = [];
  let bridgeIndex = 0;
  const session = createAudioSessionForTest({
    decoder,
    deviceService: {
      listDevices: () => devices,
    },
    createBridge: () => {
      const bridge = new FakeBridge(readySampleRates[bridgeIndex]);
      bridgeIndex += 1;
      bridges.push(bridge);
      return bridge;
    },
    logger: noopLogger,
    ...sessionOptions,
  });
  return { decoder, bridges, session };
};

class PendingProbeDecoder extends FakeDecoder {
  private resolveProbe: ((probe: AudioProbeResult) => void) | null = null;

  override async probeLocalFile(filePath: string): Promise<AudioProbeResult> {
    this.probeRequests.push(filePath);

    return new Promise((resolve) => {
      this.resolveProbe = resolve;
    });
  }

  finishProbe(probeResult: AudioProbeResult): void {
    this.resolveProbe?.(probeResult);
    this.resolveProbe = null;
  }
}

describe('AudioSession stability cleanup', () => {
  it('removes the EqBridge state listener when disposed', () => {
    const eqBridge = getEqBridge();
    const before = eqBridge.listenerCount('state');
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map()),
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    expect(eqBridge.listenerCount('state')).toBe(before + 1);
    session.dispose();
    expect(eqBridge.listenerCount('state')).toBe(before);
  });

  it('does not log decoder stop timeout when forced cleanup lets the decoder exit', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map()),
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: (message) => logs.push(message),
      disableWatchdogTimer: true,
    });
    const stream = new PassThrough();
    let resolveDone = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const stop = vi.fn(() => {
      queueMicrotask(resolveDone);
    });
    const waitForDecoderRunExit = (
      session as unknown as { waitForDecoderRunExit(run: DecoderRun): Promise<void> }
    ).waitForDecoderRunExit.bind(session);

    const waitPromise = waitForDecoderRunExit({
      stream,
      stop,
      done,
      waitForExitOnStop: true,
    });

    await vi.advanceTimersByTimeAsync(500);
    await waitPromise;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(logs).not.toContain('[AudioSession] decoder process still did not exit after forced cleanup; continuing');
    session.dispose();
  });

  it('logs once when decoder still has not exited after forced cleanup', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map()),
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: (message) => logs.push(message),
      disableWatchdogTimer: true,
    });
    const stream = new PassThrough();
    const destroy = vi.spyOn(stream, 'destroy');
    const stop = vi.fn();
    const waitForDecoderRunExit = (
      session as unknown as { waitForDecoderRunExit(run: DecoderRun): Promise<void> }
    ).waitForDecoderRunExit.bind(session);

    const waitPromise = waitForDecoderRunExit({
      stream,
      stop,
      done: new Promise<void>(() => undefined),
      waitForExitOnStop: true,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    await waitPromise;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(logs.filter((message) => message.includes('decoder process still did not exit after forced cleanup'))).toHaveLength(1);
    session.dispose();
  });

  it('replaces bridge listeners during seek instead of stacking duplicates', async () => {
    const { bridges, session } = createLongRunningSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      expect(bridges[0].listenerCount('position')).toBe(1);
      expect(bridges[0].listenerCount('ended')).toBe(1);
      expect(bridges[0].listenerCount('error')).toBe(1);

      await session.seek(12);
      await session.seek(24);

      expect(bridges[0].listenerCount('position')).toBe(1);
      expect(bridges[0].listenerCount('ended')).toBe(1);
      expect(bridges[0].listenerCount('error')).toBe(1);

      session.stop();

      expect(bridges[0].listenerCount('position')).toBe(0);
      expect(bridges[0].listenerCount('ended')).toBe(0);
      expect(bridges[0].listenerCount('error')).toBe(0);
    } finally {
      session.dispose();
    }
  });

  it('surfaces decoder stream errors in AudioSession status', async () => {
    const decoder = new StreamErrorDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      decoder.emitDecodeError('decode stream failed');

      expect(session.getStatus().state).toBe('error');
      expect(session.getStatus().error).toBe('decoder_stream_error: decode stream failed');
    } finally {
      session.dispose();
    }
  });

  it('retries once for local invalid-data decode errors before surfacing the decoder error', async () => {
    const decoder = new ControlledFailingDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const bridge = new FakeBridge();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    const invalidDataError = new Error('ffmpeg_exit_code_1; kind="input_invalid"; stderr="Invalid data found when processing input"');

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      bridge.positionSeconds = 38;
      decoder.fail(invalidDataError);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(session.getStatus().state).toBe('playing');
      expect(session.getStatus().error).toBeNull();
      expect(session.getStatus().warnings).toContain('local_decode_error_recovered');
      expect(decoder.decodeRequests).toHaveLength(2);
      expect(decoder.decodeRequests[1]).toMatchObject({ filePath: 'song.flac', startSeconds: 38 });
      expect(session.getDiagnostics().recentPlaybackEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'watchdog_recovery',
            severity: 'recovery',
            reason: 'local_decode_error_recovered',
          }),
        ]),
      );

      decoder.fail(invalidDataError);
      await Promise.resolve();

      expect(session.getStatus().state).toBe('error');
      expect(session.getStatus().error).toContain('kind="input_invalid"');
    } finally {
      session.dispose();
    }
  });

  it('retries once before treating local playback ending far before the probed duration as a possible corrupt file', async () => {
    const decoder = new PcmChunkDecoder(new Map([['broken.flac', probe('broken.flac', 44100)]]), [pcmBuffer([0, 0, 0, 0])]);
    const bridge = new FakeBridge();
    const ended = vi.fn();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    session.on('ended', ended);

    try {
      await session.playLocalFile({ filePath: 'broken.flac', output: { outputMode: 'shared' } });
      bridge.positionSeconds = 42;
      bridge.emit('ended');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ended).not.toHaveBeenCalled();
      expect(session.getStatus().state).toBe('playing');
      expect(session.getStatus().error).toBeNull();
      expect(session.getStatus().warnings).toContain('premature_local_end_recovered');
      expect(decoder.decodeRequests).toHaveLength(2);
      expect(decoder.decodeRequests[1]).toMatchObject({ filePath: 'broken.flac', startSeconds: 42 });
      expect(session.getDiagnostics().recentPlaybackEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'ended',
            severity: 'recovery',
            reason: 'premature_local_end_recovered',
          }),
        ]),
      );

      bridge.positionSeconds = 42;
      bridge.emit('ended');

      expect(session.getStatus().state).toBe('error');
      expect(session.getStatus().error).toContain('audio_file_decode_failed_or_corrupt');
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'ended',
        severity: 'suspect',
        reason: 'ended_before_duration',
      });
    } finally {
      session.dispose();
    }
  });

  it('does not treat a moderately early local end as a corrupt file', async () => {
    const decoder = new PcmChunkDecoder(new Map([['short-report.flac', probe('short-report.flac', 44100)]]), [pcmBuffer([0, 0, 0, 0])]);
    const bridge = new FakeBridge();
    const ended = vi.fn();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    session.on('ended', ended);

    try {
      await session.playLocalFile({ filePath: 'short-report.flac', output: { outputMode: 'shared' } });
      bridge.positionSeconds = 72;
      bridge.emit('ended');

      expect(ended).toHaveBeenCalledTimes(1);
      expect(session.getStatus().state).toBe('ended');
      expect(session.getStatus().error).toBeNull();
      expect(decoder.decodeRequests).toHaveLength(1);
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'ended',
        severity: 'suspect',
        reason: 'ended_before_duration',
      });
    } finally {
      session.dispose();
    }
  });

  it('does not fail playback when a local file ends near a loose reported duration', async () => {
    const looseProbe = { ...probe('loose-duration.flac', 44100), durationSeconds: 347.293 };
    const decoder = new PcmChunkDecoder(new Map([['loose-duration.flac', looseProbe]]), [pcmBuffer([0, 0, 0, 0])]);
    const bridge = new FakeBridge();
    const ended = vi.fn();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    session.on('ended', ended);

    try {
      await session.playLocalFile({ filePath: 'loose-duration.flac', output: { outputMode: 'shared' } });
      bridge.positionSeconds = 267.271;
      bridge.emit('ended');

      expect(ended).toHaveBeenCalledTimes(1);
      expect(session.getStatus().state).toBe('ended');
      expect(session.getStatus().error).toBeNull();
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'ended',
        severity: 'suspect',
        reason: 'ended_before_duration',
      });
    } finally {
      session.dispose();
    }
  });

  it('keeps gapless playback on the ffmpeg sequence path when it is available', async () => {
    const decoder = new GaplessSequenceDecoder(new Map([
      ['current.flac', { ...probe('current.flac', 44100), durationSeconds: 120 }],
      ['next.flac', { ...probe('next.flac', 44100), durationSeconds: 150 }],
    ]));
    const bridge = new NativeAutomixBridge();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        gapless: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(decoder.gaplessRequests).toHaveLength(1);
      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
      expect(session.getStatus().automix).toMatchObject({
        active: true,
        gapless: true,
        engine: 'ffmpegGapless',
      });
    } finally {
      session.dispose();
    }
  });

  it('does not label a gapless chain ending early as a corrupt local file', async () => {
    const decoder = new GaplessSequenceDecoder(new Map([
      ['current.flac', { ...probe('current.flac', 44100), durationSeconds: 120 }],
      ['next.flac', { ...probe('next.flac', 44100), durationSeconds: 150 }],
    ]));
    const bridge = new FakeBridge();
    const ended = vi.fn();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    session.on('ended', ended);

    try {
      await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        gapless: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });
      bridge.positionSeconds = 72;
      bridge.emit('ended');

      expect(ended).toHaveBeenCalledTimes(1);
      expect(session.getStatus().state).toBe('ended');
      expect(session.getStatus().error).toBeNull();
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'ended',
        severity: 'suspect',
        reason: 'ended_before_chained_duration',
      });
    } finally {
      session.dispose();
    }
  });

  it('waits for the PCM stream tail before closing native input when the decoder exits first', async () => {
    const decoder = new EarlyDoneDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const bridge = new FakeBridge();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      decoder.finishDecoderProcess();
      await Promise.resolve();
      await Promise.resolve();

      expect(bridge.sessionEnds).toBe(0);

      decoder.endPcmStream(pcmBuffer([0, 0, 0, 0]));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridge.sessionEnds).toBe(1);
      expect(bridge.inputEnded).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it('surfaces native writable errors in AudioSession status', async () => {
    const decoder = new PcmChunkDecoder(new Map([['song.flac', probe('song.flac', 44100)]]), [pcmBuffer([0, 0, 0, 0])]);
    const bridge = new WritableErrorBridge();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      bridge.emitWritableError('native write failed');

      expect(session.getStatus().state).toBe('error');
      expect(session.getStatus().error).toBe('native_writable_error: native write failed');
    } finally {
      session.dispose();
    }
  });

  it('remembers shared stability only for the same output device during the extended TTL', async () => {
    const devices: AudioDeviceInfo[] = [
      {
        id: 'speaker-a',
        index: 0,
        name: 'Speaker A',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: true,
      },
      {
        id: 'speaker-b',
        index: 7,
        name: 'Speaker B',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: false,
      },
    ];
    const { bridges, session } = createLongRunningSessionHarness(
      [probe('first.flac', 48000), probe('second.flac', 48000), probe('other.flac', 48000)],
      [],
      devices,
      { disableWatchdogTimer: true },
    );

    try {
      await session.playLocalFile({ filePath: 'first.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
      bridges[0].emit('position', 48000, {
        positionFrames: 48000,
        bufferedFrames: 0,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      bridges[0].emit('position', 48512, {
        positionFrames: 48512,
        bufferedFrames: 0,
        underrunCallbacks: 3,
        underrunFrames: 4800,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(bridges[1].startOptions).toMatchObject({
        bufferSizeFrames: 8192,
        fifoCapacityMs: 1200,
      });

      session.stop();
      await session.playLocalFile({ filePath: 'second.flac', trackId: 'track-2', output: { outputMode: 'shared' } });
      expect(bridges[2].startOptions).toMatchObject({
        bufferSizeFrames: 8192,
        fifoCapacityMs: 1200,
      });

      session.stop();
      await session.playLocalFile({
        filePath: 'other.flac',
        trackId: 'track-3',
        output: { outputMode: 'shared', deviceIndex: 7, deviceName: 'Speaker B' },
      });
      expect(bridges[3].startOptions).toMatchObject({
        bufferSizeFrames: 4096,
        fifoCapacityMs: 750,
      });
    } finally {
      session.dispose();
    }
  });
});

describe('AudioSession event listener capacity', () => {
  it('allows the shared status subscribers used by app integrations without Node leak warnings', () => {
    const { session } = createSessionHarness([]);

    try {
      expect(session.getMaxListeners()).toBeGreaterThanOrEqual(64);
    } finally {
      session.dispose();
    }
  });
});

describe('Audio Core sample-rate regression guard', () => {
  it('44.1k file + exclusive requests 44100 and never defaults to 48000', async () => {
    const { bridges, session } = createSessionHarness([probe('441.flac', 44100)]);

    const status = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'exclusive' },
    });

    expect(status.fileSampleRate).toBe(44100);
    expect(status.decoderOutputSampleRate).toBe(44100);
    expect(status.requestedOutputSampleRate).toBe(44100);
    expect(status.outputBackend).toBe('wasapi-exclusive');
    expect(status.outputDeviceType).toBe('Windows Audio (Exclusive Mode)');
    expect(status.outputDeviceName).toBe('Default output');
    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 44100,
      exclusive: true,
    });
  });

  it('48k file + exclusive requests 48000', async () => {
    const { bridges, session } = createSessionHarness([probe('48.flac', 48000)]);

    const status = await session.playLocalFile({
      filePath: '48.flac',
      output: { outputMode: 'exclusive' },
    });

    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(bridges[0].startOptions?.requestedOutputSampleRate).toBe(48000);
  });

  it('re-probes stale ALAC hints that report an impossible 1Hz sample rate', async () => {
    const { bridges, decoder, session } = createSessionHarness([{ ...probe('popipa.m4a', 96000), codec: 'ALAC' }]);
    const staleHint = { ...probe('popipa.m4a', 1), codec: 'ALAC' };

    const status = await session.playLocalFile({
      filePath: 'popipa.m4a',
      probe: staleHint,
      output: { outputMode: 'exclusive' },
    });

    expect(decoder.probeRequests).toEqual(['popipa.m4a']);
    expect(status.fileSampleRate).toBe(96000);
    expect(status.requestedOutputSampleRate).toBe(96000);
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 96000,
    });
  });

  it('closes native input when the decoder reaches EOF', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges[0].inputEnded).toBe(true);
  });

  it('raises realtime clipping risk from estimated output level and hard clip count', async () => {
    const decoder = new PcmChunkDecoder(new Map([['hot.flac', probe('hot.flac', 44100)]]), [pcmBuffer([1.05, 0.5])]);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'hot.flac', output: { outputMode: 'shared' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = session.getStatus();

    expect(status.audioLevels?.estimatedOutputPeakDb).toBeGreaterThan(0);
    expect(status.audioLevels?.clipCount).toBe(1);
    expect(status.clippingRisk).toBe(true);
    expect(status.warnings).toContain('audio_level_clipping_risk');
    expect(status.warnings).toContain('audio_level_clipped');
    session.stop();
  });

  it('debounces ECHO SRC clip telemetry using the decoder output sample rate', async () => {
    const samples = [1.08, ...Array.from({ length: 220000 }, () => 0), -1.09];
    const decoder = new PcmChunkDecoder(new Map([['src-hot.flac', probe('src-hot.flac', 44100)]]), [pcmBuffer(samples)]);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'src-hot.flac', output: { outputMode: 'exclusive', requestedOutputSampleRate: 352800 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = session.getStatus();

    expect(decoder.decodeRequests[0]?.decoderOutputSampleRate).toBe(352800);
    expect(status.audioLevels?.clipCount).toBe(1);
    session.stop();
  });

  it('flags full-scale peaks as clipping risk without a hard clip count', async () => {
    const decoder = new PcmChunkDecoder(new Map([['full-scale.flac', probe('full-scale.flac', 44100)]]), [pcmBuffer([1, 0.5])]);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'full-scale.flac', output: { outputMode: 'shared' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = session.getStatus();

    expect(status.audioLevels?.estimatedOutputPeakDb).toBe(0);
    expect(status.audioLevels?.clipCount).toBe(0);
    expect(status.clippingRisk).toBe(true);
    expect(status.warnings).toContain('audio_level_clipping_risk');
    expect(status.warnings).not.toContain('audio_level_clipped');
    session.stop();
  });

  it('flags intersample true peaks as clipping risk without a hard clip count', async () => {
    const decoder = new PcmChunkDecoder(new Map([['true-peak.flac', probe('true-peak.flac', 44100)]]), [pcmBuffer([0, 0, 0.9, 0.9, 0.9, 0.9, 0, 0])]);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'true-peak.flac', output: { outputMode: 'shared' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = session.getStatus();

    expect(status.audioLevels?.estimatedOutputPeakDb).toBeLessThan(0);
    expect(status.audioLevels?.estimatedOutputTruePeakDb).toBeGreaterThan(0);
    expect(status.audioLevels?.clipCount).toBe(0);
    expect(status.clippingRisk).toBe(true);
    expect(status.warnings).toContain('audio_level_clipping_risk');
    expect(status.warnings).not.toContain('audio_level_clipped');
    session.stop();
  });

  it('resets level telemetry on stop', async () => {
    const decoder = new PcmChunkDecoder(new Map([['reset.flac', probe('reset.flac', 44100)]]), [pcmBuffer([0.5, -0.5])]);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'reset.flac', output: { outputMode: 'shared' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.getStatus().audioLevels?.inputPeakDb).toBe(-6);

    const stopped = session.stop();

    expect(stopped.audioLevels?.inputPeakDb).toBeNull();
    expect(stopped.audioLevels?.visualSpectrum?.every((value) => value === 0)).toBe(true);
    expect(stopped.audioLevels?.visualEnergy).toBe(0);
    expect(stopped.audioLevels?.visualTransient).toBe(0);
    expect(stopped.audioLevels?.visualTelemetryState).toBe('fallback');
    expect(stopped.audioLevels?.clipCount).toBe(0);
  });

  it('stop closes resident exclusive output', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'exclusive' } });
    const status = session.stop();

    expect(status.state).toBe('stopped');
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
  });

  it('96k file + exclusive requests 96000', async () => {
    const { bridges, session } = createSessionHarness([probe('96.flac', 96000)]);

    const status = await session.playLocalFile({
      filePath: '96.flac',
      output: { outputMode: 'exclusive' },
    });

    expect(status.requestedOutputSampleRate).toBe(96000);
    expect(bridges[0].startOptions?.requestedOutputSampleRate).toBe(96000);
  });

  it('applies ECHO SRC family 4x to PCM exclusive output as a DSP path', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('441.flac', 44100)]);

    const status = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'exclusive', echoSrcMode: 'family4x' },
    });

    expect(status.requestedOutputSampleRate).toBe(176400);
    expect(status.decoderOutputSampleRate).toBe(176400);
    expect(status.echoSrcMode).toBe('family4x');
    expect(status.echoSrcQualityProfile).toBe('transparent');
    expect(status.echoSrcTargetSampleRate).toBe(176400);
    expect(status.echoSrcActive).toBe(true);
    expect(status.dspActive).toBe(true);
    expect(status.bitPerfectCandidate).toBe(false);
    expect(status.bitPerfectDisabledReason).toBe('echo_src_enabled');
    expect(status.warnings).toContain('echo_src_active:44100->176400');
    expect(status.warnings).toContain('echo_src_bit_perfect_disabled');
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 176400,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '441.flac',
      decoderOutputSampleRate: 176400,
      resamplerEngine: 'soxr',
      resamplerQualityProfile: 'transparent',
    });
  });

  it('routes advanced ECHO SRC CUDA mode through source-rate decode and worker transform', async () => {
    const processFir = vi.fn();
    const { bridges, decoder, session } = createSessionHarness([probe('441-cuda.flac', 44100)], [], [], {
      resolveEchoSrcFirBackendStatus: () => ({
        backend: 'cuda',
        available: true,
        active: true,
        reason: null,
        cudaRuntime: {
          available: true,
          source: 'nvidia-smi',
          deviceName: 'NVIDIA Test GPU',
          driverVersion: '610.47',
          cudaVersion: '13.3',
          error: null,
        },
      }),
      createEchoSrcCudaWorkerClient: () => ({
        processFir,
        dispose: vi.fn(),
      }),
    });

    const status = await session.playLocalFile({
      filePath: '441-cuda.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family4x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile: 'poly-sinc-gauss-long',
        echoSrcComputeBackend: 'cuda',
      },
    });

    expect(status.requestedOutputSampleRate).toBe(176400);
    expect(status.decoderOutputSampleRate).toBe(176400);
    expect(status.echoSrcCudaActive).toBe(true);
    expect(status.echoSrcRuntime).toMatchObject({
      state: 'active',
      requestedBackend: 'cuda',
      activeBackend: 'cuda',
      filterProfile: 'poly-sinc-gauss-long',
      filterSlot: '1x',
      tapCount: 1023,
      firStageCount: 1,
      firStageTapCounts: [1023],
      firStageProfiles: ['poly-sinc-gauss-long'],
      firProcessingMode: 'batched',
      firBatchFrames: 4096,
      firMaxBlockFrames: 8192,
      window: 'gaussian',
      phase: 'linear',
      cudaActive: true,
    });
    expect(status.warnings).toContain('echo_src_fir_processing:cuda:batched:batch=4096:block=8192');
    expect(status.warnings).toContain('echo_src_fir_active:cuda:44100->176400:poly-sinc-gauss-long:taps=1023');
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 176400,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '441-cuda.flac',
      decoderOutputSampleRate: 44100,
      resamplerEngine: 'default',
    });
    expect(processFir).not.toHaveBeenCalled();
  });

  it('uses ultra batched FIR blocks for advanced 8x CUDA SRC', async () => {
    const processFir = vi.fn();
    const { session } = createSessionHarness([probe('441-cuda-8x.flac', 44100)], [], [], {
      resolveEchoSrcFirBackendStatus: () => ({
        backend: 'cuda',
        available: true,
        active: true,
        reason: null,
        cudaRuntime: {
          available: true,
          source: 'nvidia-smi',
          deviceName: 'NVIDIA Test GPU',
          driverVersion: '610.47',
          cudaVersion: '13.3',
          error: null,
        },
      }),
      createEchoSrcCudaWorkerClient: () => ({
        processFir,
        dispose: vi.fn(),
      }),
    });

    const status = await session.playLocalFile({
      filePath: '441-cuda-8x.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family8x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile: 'poly-sinc-gauss-long',
        echoSrcComputeBackend: 'cuda',
      },
    });

    expect(status.echoSrcRuntime).toMatchObject({
      state: 'active',
      requestedBackend: 'cuda',
      activeBackend: 'cuda',
      filterProfile: 'poly-sinc-gauss-long',
      firProcessingMode: 'ultra',
      firBatchFrames: 16384,
      firMaxBlockFrames: 16384,
      cudaActive: true,
    });
    expect(status.warnings).toContain('echo_src_fir_processing:cuda:ultra:batch=16384:block=16384');
    expect(processFir).not.toHaveBeenCalled();
  });

  it('selects the Nx advanced ECHO SRC filter for hi-res PCM sources', async () => {
    const { decoder, session } = createSessionHarness([probe('96-nx.flac', 96000)]);

    const status = await session.playLocalFile({
      filePath: '96-nx.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family4x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile1x: 'poly-sinc-gauss-long',
        echoSrcFilterProfileNx: 'poly-sinc-hb',
        echoSrcComputeBackend: 'cpu',
      },
    });

    expect(status.echoSrcRuntime).toMatchObject({
      state: 'active',
      requestedBackend: 'cpu',
      activeBackend: 'cpu',
      filterProfile: 'poly-sinc-hb',
      filterSlot: 'nx',
    });
    expect(status.echoSrcFilterProfile).toBe('poly-sinc-hb');
    expect(status.echoSrcFilterProfile1x).toBe('poly-sinc-gauss-long');
    expect(status.echoSrcFilterProfileNx).toBe('poly-sinc-hb');
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '96-nx.flac',
      decoderOutputSampleRate: 96000,
      resamplerEngine: 'default',
    });
  });

  it('keeps apodizing advanced ECHO SRC filters instead of normalizing them away', async () => {
    const { session } = createSessionHarness([probe('apod.flac', 44100)]);

    const status = await session.playLocalFile({
      filePath: 'apod.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family4x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile1x: 'apod-minring',
        echoSrcFilterProfileNx: 'apod-long',
        echoSrcComputeBackend: 'cpu',
      },
    });

    expect(status.echoSrcRuntime).toMatchObject({
      state: 'active',
      requestedBackend: 'cpu',
      activeBackend: 'cpu',
      filterProfile: 'apod-minring',
      filterSlot: '1x',
    });
    expect(status.echoSrcFilterProfile).toBe('apod-minring');
    expect(status.echoSrcFilterProfile1x).toBe('apod-minring');
    expect(status.echoSrcFilterProfileNx).toBe('apod-long');
  });

  it('applies PCM dither only for integer native output formats', async () => {
    const decoder = new PcmChunkDecoder(new Map([['dither.flac', probe('dither.flac', 44100)]]), [pcmBuffer([0.1234567, -0.1234567, 0.01, -0.01])]);
    const bridge = new FakeBridge(44100, { format: 'pcm16' });
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'dither.flac',
      output: {
        outputMode: 'exclusive',
        pcmDitherMode: 'tpdf',
      },
    });
    for (let attempt = 0; attempt < 10 && bridge.sessionChunks.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const output = Buffer.concat(bridge.sessionChunks.map((item) => item.chunk));

    expect(status.pcmDitherMode).toBe('tpdf');
    expect(status.pcmDitherActive).toBe(true);
    expect(status.pcmDitherTargetBitDepth).toBe(16);
    expect(output.length).toBeGreaterThan(0);
    for (let offset = 0; offset < output.length; offset += 4) {
      const sample = output.readFloatLE(offset);
      expect(Math.abs((sample * 32767) - Math.round(sample * 32767))).toBeLessThan(0.001);
    }
    session.stop();
  });

  it('writes CUDA worker SRC output into the native bridge stream', async () => {
    const sourceFrames = 2048;
    const samples = Array.from({ length: sourceFrames * 2 }, (_, index) => {
      if (index === 0) {
        return 1;
      }
      if (index === 1) {
        return 0.5;
      }
      return 0;
    });
    const processFir = vi.fn(async (request: EchoSrcFirWorkerRequest) => ({
      backend: request.backend,
      output: request.input,
      history: request.history,
    }));
    const decoder = new PcmChunkDecoder(
      new Map([['441-cuda-pcm.flac', probe('441-cuda-pcm.flac', 44100)]]),
      [pcmBuffer(samples)],
    );
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      resolveEchoSrcFirBackendStatus: () => ({
        backend: 'cuda',
        available: true,
        active: true,
        reason: null,
        cudaRuntime: {
          available: true,
          source: 'nvidia-smi',
          deviceName: 'NVIDIA Test GPU',
          driverVersion: '610.47',
          cudaVersion: '13.3',
          error: null,
        },
      }),
      createEchoSrcCudaWorkerClient: () => ({
        processFir,
        dispose: vi.fn(),
      }),
    });

    await session.playLocalFile({
      filePath: '441-cuda-pcm.flac',
      output: {
        outputMode: 'exclusive',
        echoSrcMode: 'family2x',
        echoSrcAdvancedModeEnabled: true,
        echoSrcFilterProfile: 'poly-sinc-gauss-long',
        echoSrcComputeBackend: 'cuda',
      },
    });
    for (let attempt = 0; attempt < 20 && processFir.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const output = Buffer.concat(bridges[0].sessionChunks.map((item) => item.chunk));
    expect(processFir).toHaveBeenCalledTimes(1);
    expect(processFir.mock.calls[0]![0].input.length).toBe(sourceFrames * 2 * 2);
    expect(output.length).toBe(sourceFrames * 2 * 2 * 4);
    expect(output.readFloatLE(0)).toBeCloseTo(2);
    expect(output.readFloatLE(4)).toBeCloseTo(1);
    expect(output.readFloatLE(8)).toBeCloseTo(0);
    expect(output.readFloatLE(12)).toBeCloseTo(0);
  });

  it('applies ECHO SRC family 8x to PCM direct output as an experimental ultra path', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('441.flac', 44100), probe('48.flac', 48000)]);

    const firstStatus = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'exclusive', echoSrcMode: 'family8x' },
    });

    expect(firstStatus.requestedOutputSampleRate).toBe(352800);
    expect(firstStatus.decoderOutputSampleRate).toBe(352800);
    expect(firstStatus.echoSrcMode).toBe('family8x');
    expect(firstStatus.echoSrcTargetSampleRate).toBe(352800);
    expect(firstStatus.echoSrcActive).toBe(true);
    expect(firstStatus.warnings).toContain('echo_src_active:44100->352800');
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 352800,
      latencyProfile: 'stable',
      bufferSizeFrames: 8192,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '441.flac',
      decoderOutputSampleRate: 352800,
      resamplerEngine: 'soxr',
    });

    const secondStatus = await session.playLocalFile({
      filePath: '48.flac',
      output: { outputMode: 'exclusive', echoSrcMode: 'family8x' },
    });

    expect(secondStatus.requestedOutputSampleRate).toBe(384000);
    expect(secondStatus.decoderOutputSampleRate).toBe(384000);
    expect(secondStatus.echoSrcTargetSampleRate).toBe(384000);
    expect(secondStatus.echoSrcActive).toBe(true);
    expect(secondStatus.warnings).toContain('echo_src_active:48000->384000');
    expect(bridges[1].startOptions).toMatchObject({
      requestedOutputSampleRate: 384000,
      latencyProfile: 'stable',
      bufferSizeFrames: 8192,
    });
  });

  it('switching 48k to 44.1k exclusive reopens at the source rate', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('48.flac', 48000), probe('441.flac', 44100)]);

    await session.playLocalFile({ filePath: '48.flac', output: { outputMode: 'exclusive' } });
    const status = await session.playLocalFile({ filePath: '441.flac', output: { outputMode: 'exclusive' } });

    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(status.requestedOutputSampleRate).toBe(44100);
    expect(status.actualDeviceSampleRate).toBe(44100);
    expect(status.decoderOutputSampleRate).toBe(44100);
    expect(status.resampling).toBe(false);
    expect(status.bitPerfectCandidate).toBe(true);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '441.flac',
      decoderOutputSampleRate: 44100,
    });
  });

  it('switching 44.1k to 96k exclusive reopens at 96000', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('441.flac', 44100), probe('96.flac', 96000)]);

    await session.playLocalFile({ filePath: '441.flac', output: { outputMode: 'exclusive' } });
    const status = await session.playLocalFile({ filePath: '96.flac', output: { outputMode: 'exclusive' } });

    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(status.requestedOutputSampleRate).toBe(96000);
    expect(status.decoderOutputSampleRate).toBe(96000);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: '96.flac',
      decoderOutputSampleRate: 96000,
    });
  });

  it('keeps WASAPI exclusive playback stable across the full sample-rate switch matrix', async () => {
    for (const fromRate of asioMatrixSampleRates) {
      for (const toRate of asioMatrixSampleRates) {
        if (fromRate === toRate) {
          continue;
        }

        const fromPath = `exclusive-${fromRate}-from.flac`;
        const toPath = `exclusive-${fromRate}-to-${toRate}.flac`;
        const { bridges, decoder, session } = createLongRunningSessionHarness([
          probe(fromPath, fromRate),
          probe(toPath, toRate),
        ]);

        await session.playLocalFile({ filePath: fromPath, output: { outputMode: 'exclusive' } });
        const status = await session.playLocalFile({ filePath: toPath, output: { outputMode: 'exclusive' } });

        expect(status.state, `exclusive ${fromRate}->${toRate} state`).toBe('playing');
        expect(status.outputMode, `exclusive ${fromRate}->${toRate} mode`).toBe('exclusive');
        expect(status.requestedOutputSampleRate, `exclusive ${fromRate}->${toRate} requested`).toBe(toRate);
        expect(status.actualDeviceSampleRate, `exclusive ${fromRate}->${toRate} actual`).toBe(toRate);
        expect(status.decoderOutputSampleRate, `exclusive ${fromRate}->${toRate} decoder`).toBe(toRate);
        expect(status.resampling, `exclusive ${fromRate}->${toRate} resampling`).toBe(false);
        expect(status.sampleRateMismatch, `exclusive ${fromRate}->${toRate} mismatch`).toBe(false);
        expect(bridges, `exclusive ${fromRate}->${toRate} bridges`).toHaveLength(2);
        expect(bridges[0].stop, `exclusive ${fromRate}->${toRate} old bridge stopped`).toHaveBeenCalledTimes(1);
        expect(bridges[1].startOptions, `exclusive ${fromRate}->${toRate} start options`).toMatchObject({
          exclusive: true,
          requestedOutputSampleRate: toRate,
        });
        expect(decoder.decodeRequests.at(-1), `exclusive ${fromRate}->${toRate} decode request`).toMatchObject({
          filePath: toPath,
          decoderOutputSampleRate: toRate,
        });
      }
    }
  });

  it('falls back to stable shared playback when WASAPI exclusive refuses lower-rate switches after 192 kHz', async () => {
    for (const targetRate of asioMatrixSampleRates.filter((rate) => rate !== 192000)) {
      const firstPath = `exclusive-192000-to-${targetRate}-first.flac`;
      const targetPath = `exclusive-192000-to-${targetRate}-target.flac`;
      const { bridges, decoder, session } = createLongRunningSessionHarness(
        [probe(firstPath, 192000), probe(targetPath, targetRate)],
        [192000, 192000, 48000],
      );

      await session.playLocalFile({ filePath: firstPath, output: { outputMode: 'exclusive' } });
      const status = await session.playLocalFile({
        filePath: targetPath,
        output: { outputMode: 'exclusive', exclusiveInstabilityFallbackEnabled: true },
      });

      expect(status.state, `exclusive refused 192000->${targetRate} state`).toBe('playing');
      expect(status.outputMode, `exclusive refused 192000->${targetRate} mode`).toBe('shared');
      expect(status.requestedOutputSampleRate, `exclusive refused 192000->${targetRate} requested`).toBe(48000);
      expect(status.actualDeviceSampleRate, `exclusive refused 192000->${targetRate} actual`).toBe(48000);
      expect(status.decoderOutputSampleRate, `exclusive refused 192000->${targetRate} decoder`).toBe(48000);
      expect(status.sampleRateMismatch, `exclusive refused 192000->${targetRate} mismatch`).toBe(false);
      expect(status.warnings, `exclusive refused 192000->${targetRate} warnings`).toContain('exclusive_output_fell_back_to_shared');
      expect(bridges, `exclusive refused 192000->${targetRate} bridges`).toHaveLength(3);
      expect(bridges[1].startOptions, `exclusive refused 192000->${targetRate} exclusive start`).toMatchObject({
        exclusive: true,
        requestedOutputSampleRate: targetRate,
      });
      expect(bridges[2].startOptions, `exclusive refused 192000->${targetRate} shared fallback start`).toMatchObject({
        exclusive: false,
        requestedOutputSampleRate: 48000,
      });
      expect(decoder.decodeRequests.at(-1), `exclusive refused 192000->${targetRate} decode request`).toMatchObject({
        filePath: targetPath,
        decoderOutputSampleRate: 48000,
      });
    }
  });

  it('reuses the native bridge for consecutive tracks with the same output plan', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('first.flac', 44100), probe('second.flac', 44100)]);

    await session.playLocalFile({ filePath: 'first.flac', output: { outputMode: 'shared' } });
    await session.playLocalFile({ filePath: 'second.flac', output: { outputMode: 'shared' } });

    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].sessionBegins).toBe(2);
    expect(decoder.decodeRequests.map((request) => request.filePath)).toEqual(['first.flac', 'second.flac']);
  });

  it('reapplies EQ state before each reused native playback session', async () => {
    const syncSpy = vi.spyOn(getEqBridge(), 'syncStateToNative').mockResolvedValue();
    const { bridges, session } = createSessionHarness([probe('first.flac', 44100), probe('second.flac', 44100)]);

    try {
      await session.playLocalFile({ filePath: 'first.flac', output: { outputMode: 'shared' } });
      await session.playLocalFile({ filePath: 'second.flac', output: { outputMode: 'shared' } });

      expect(bridges).toHaveLength(1);
      expect(bridges[0].sessionBegins).toBe(2);
      expect(syncSpy).toHaveBeenCalledTimes(2);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it('resets the reported loading position when switching to a new track', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('first.flac', 44100), probe('second.flac', 44100)]);
    const loadingPositions: number[] = [];

    try {
      await session.playLocalFile({ filePath: 'first.flac', trackId: 'first', startSeconds: 8, output: { outputMode: 'shared' } });
      bridges[0].positionSeconds = 16;
      session.on('status', (status) => {
        if (status.currentTrackId === 'second' && status.state === 'loading') {
          loadingPositions.push(status.positionSeconds);
        }
      });

      const status = await session.playLocalFile({ filePath: 'second.flac', trackId: 'second', output: { outputMode: 'shared' } });

      expect(loadingPositions[0]).toBe(0);
      expect(status.positionSeconds).toBe(0);
      expect(decoder.decodeRequests.at(-1)).toMatchObject({
        filePath: 'second.flac',
        startSeconds: 0,
      });
    } finally {
      session.dispose();
    }
  });

  it('keeps playback running when the EQ control socket disconnects during sync', async () => {
    const syncSpy = vi.spyOn(getEqBridge(), 'syncStateToNative').mockRejectedValueOnce(new Error('eq_control_disconnected'));
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    try {
      const status = await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });

      expect(status.state).toBe('playing');
      expect(status.warnings).toContain('eq_control_sync_skipped');
      expect(bridges).toHaveLength(1);
      expect(bridges[0].sessionBegins).toBe(1);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it('reuses shared output across source sample-rate changes at the fixed mix rate', async () => {
    const { bridges, decoder, session } = createSessionHarness([
      probe('441.flac', 44100),
      probe('48.flac', 48000),
      probe('96.flac', 96000),
    ], [48000]);

    await session.playLocalFile({ filePath: '441.flac', output: { outputMode: 'shared' } });
    await session.playLocalFile({ filePath: '48.flac', output: { outputMode: 'shared' } });
    const status = await session.playLocalFile({ filePath: '96.flac', output: { outputMode: 'shared' } });

    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].sessionBegins).toBe(3);
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.decoderOutputSampleRate).toBe(48000);
    expect(decoder.decodeRequests.map((request) => request.decoderOutputSampleRate)).toEqual([48000, 48000, 48000]);
  });

  it('caps excessive WASAPI shared mix rates before decoding to avoid startup pressure', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:384k',
      index: 0,
      name: 'High rate speakers',
      outputMode: 'shared',
      sampleRate: 384000,
      sharedDeviceSampleRate: 384000,
      isDefault: true,
    };
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)], [384000], [sharedDevice], {
      platform: 'win32',
    });

    const status = await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });

    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 96000,
      sharedMixSampleRate: 96000,
    });
    expect(status.requestedOutputSampleRate).toBe(96000);
    expect(status.decoderOutputSampleRate).toBe(96000);
    expect(status.actualDeviceSampleRate).toBe(384000);
    expect(status.sharedDeviceSampleRate).toBe(384000);
    expect(status.sampleRateMismatch).toBe(true);
    expect(status.warnings).toContain('windows_audio_default_format_unusual:384000');
    expect(status.warnings).toContain('shared_output_sample_rate_capped:384000->96000');
    expect(status.warnings).toContain('shared_output_mix_rate_too_high:96000->384000');
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'song.flac',
      decoderOutputSampleRate: 96000,
      resamplerEngine: 'soxr',
    });
  });

  it('warns about unusual Windows shared default formats without changing 96 kHz output', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:96k',
      index: 0,
      name: 'Studio speakers',
      outputMode: 'shared',
      sampleRate: 96000,
      sharedDeviceSampleRate: 96000,
      isDefault: true,
    };
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [96000], [sharedDevice], {
      platform: 'win32',
    });

    const status = await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });

    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 96000,
      sharedMixSampleRate: 96000,
    });
    expect(status.requestedOutputSampleRate).toBe(96000);
    expect(status.actualDeviceSampleRate).toBe(96000);
    expect(status.sampleRateMismatch).toBe(false);
    expect(status.warnings).toContain('windows_audio_default_format_unusual:96000');
    expect(status.warnings).not.toContain('shared_output_sample_rate_capped:96000->96000');
  });

  it('bypasses ECHO SRC in shared output instead of forcing the Windows mixer rate', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)], [48000], [sharedDevice]);

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', echoSrcMode: 'family4x' },
    });

    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.decoderOutputSampleRate).toBe(48000);
    expect(status.echoSrcMode).toBe('family4x');
    expect(status.echoSrcQualityProfile).toBe('transparent');
    expect(status.echoSrcActive).toBe(false);
    expect(status.warnings).toContain('echo_src_bypassed_in_shared_output');
    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'song.flac',
      decoderOutputSampleRate: 48000,
    });
  });

  it('keeps WASAPI shared playback stable across the full sample-rate switch matrix', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };

    for (const fromRate of asioMatrixSampleRates) {
      for (const toRate of asioMatrixSampleRates) {
        if (fromRate === toRate) {
          continue;
        }

        const fromPath = `shared-${fromRate}-from.flac`;
        const toPath = `shared-${fromRate}-to-${toRate}.flac`;
        const { bridges, decoder, session } = createLongRunningSessionHarness(
          [probe(fromPath, fromRate), probe(toPath, toRate)],
          [48000],
          [sharedDevice],
        );

        await session.playLocalFile({ filePath: fromPath, output: { outputMode: 'shared' } });
        const status = await session.playLocalFile({ filePath: toPath, output: { outputMode: 'shared' } });

        expect(status.state, `shared ${fromRate}->${toRate} state`).toBe('playing');
        expect(status.outputMode, `shared ${fromRate}->${toRate} mode`).toBe('shared');
        expect(status.requestedOutputSampleRate, `shared ${fromRate}->${toRate} requested`).toBe(48000);
        expect(status.actualDeviceSampleRate, `shared ${fromRate}->${toRate} actual`).toBe(48000);
        expect(status.decoderOutputSampleRate, `shared ${fromRate}->${toRate} decoder`).toBe(48000);
        expect(status.sampleRateMismatch, `shared ${fromRate}->${toRate} mismatch`).toBe(false);
        expect(status.resampling, `shared ${fromRate}->${toRate} resampling`).toBe(toRate !== 48000);
        expect(bridges, `shared ${fromRate}->${toRate} bridges`).toHaveLength(1);
        expect(bridges[0].stop, `shared ${fromRate}->${toRate} bridge stop`).not.toHaveBeenCalled();
        expect(decoder.decodeRequests.at(-1), `shared ${fromRate}->${toRate} decode request`).toMatchObject({
          filePath: toPath,
          decoderOutputSampleRate: 48000,
          resamplerEngine: toRate === 48000 ? 'default' : 'soxr',
          allowResamplerFallback: true,
        });
      }
    }
  });

  it('logs shared transition diagnostics with host reuse state', async () => {
    const logs: string[] = [];
    const { bridges, session } = createSessionHarness(
      [probe('441.flac', 44100), probe('96.flac', 96000)],
      [48000],
      [],
      { logger: (message) => logs.push(message) },
    );

    await session.playLocalFile({ filePath: '441.flac', output: { outputMode: 'shared' } });
    await session.playLocalFile({ filePath: '96.flac', output: { outputMode: 'shared' } });

    const transitions = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry?.event === 'audio_transition');

    expect(bridges).toHaveLength(1);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toMatchObject({
      outputMode: 'shared',
      sourceSampleRate: 44100,
      sharedMixRate: 48000,
      decoderOutputRate: 48000,
      hostReused: false,
      hostRestartReason: 'initial_start',
    });
    expect(transitions[1]).toMatchObject({
      outputMode: 'shared',
      sourceSampleRate: 96000,
      sharedMixRate: 48000,
      decoderOutputRate: 48000,
      hostReused: true,
      hostRestartReason: null,
    });
  });

  it('logs playback diagnostics for play requests and native output readiness without startup spam', async () => {
    const logs: string[] = [];
    const { bridges, session } = createSessionHarness(
      [probe('song.flac', 44100)],
      [48000],
      [],
      { diagnosticLogger: (message) => logs.push(message) },
    );

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].emit('position', 4800, {
      positionFrames: 4800,
      bufferedFrames: 960,
      underrunCallbacks: 1,
      underrunFrames: 240,
      nativePositionStalenessMs: 3,
    });

    const prefix = '[AudioSession] playback diagnostic ';
    const diagnostics = logs
      .filter((line) => line.startsWith(prefix))
      .map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
    const playRequest = diagnostics.find((entry) => entry.event === 'play_request');
    const outputReady = diagnostics.find((entry) => entry.event === 'output_ready');
    const startupTelemetry = diagnostics.find((entry) => entry.event === 'startup_telemetry');

    expect(playRequest).toMatchObject({
      reason: 'playLocalFile',
      filePath: 'song.flac',
      outputMode: 'shared',
      nativeUnderrunCallbacks: 0,
      nativeUnderrunFrames: 0,
    });
    expect(outputReady).toMatchObject({
      reason: 'native_output_ready',
      filePath: 'song.flac',
      outputMode: 'shared',
      outputBackend: 'wasapi-shared',
      nativeUnderrunCallbacks: 0,
      nativeUnderrunFrames: 0,
      details: {
        requestedOutputSampleRate: 48000,
        actualDeviceSampleRate: 48000,
        nativeActualBufferFrames: expect.any(Number),
      },
    });
    expect(startupTelemetry).toBeUndefined();
    expect(session.getDiagnostics().recentPlaybackEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'startup_telemetry',
          reason: 'native_startup_telemetry',
          filePath: 'song.flac',
          outputMode: 'shared',
          nativeBufferedFrames: 960,
          nativeUnderrunCallbacks: 1,
          nativeUnderrunFrames: 240,
          details: expect.objectContaining({
            nativeBufferedMs: 20,
            nativeUnderrunCallbackDelta: 1,
            nativeUnderrunFrameDelta: 240,
            nativePositionStalenessMs: 3,
          }),
        }),
      ]),
    );
  });

  it('rebases accumulated startup position drift without restarting exclusive output', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T05:25:00.000Z'));
    const reportAudioError = vi.fn();
    const logs: string[] = [];
    const { bridges, decoder, session } = createLongRunningSessionHarness(
      [probe('song.flac', 48000)],
      [48000],
      [],
      {
        disableWatchdogTimer: true,
        diagnosticLogger: (message) => logs.push(message),
        reportAudioError,
      },
    );

    try {
      await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-startup', output: { outputMode: 'exclusive' } });

      await vi.advanceTimersByTimeAsync(1582);
      bridges[0].emit('position', Math.round(2.57 * 48000), {
        positionFrames: Math.round(2.57 * 48000),
        bufferedFrames: 9600,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      await Promise.resolve();

      expect(bridges).toHaveLength(1);
      expect(bridges[0].stop).not.toHaveBeenCalled();
      expect(decoder.decodeRequests).toHaveLength(1);
      expect(reportAudioError).not.toHaveBeenCalled();
      expect(bridges[0].positionSeconds).toBeGreaterThanOrEqual(1.5);
      expect(bridges[0].positionSeconds).toBeLessThanOrEqual(1.7);
      expect(session.getStatus().positionSeconds).toBeGreaterThanOrEqual(1.5);
      expect(session.getStatus().positionSeconds).toBeLessThanOrEqual(1.7);
      expect(logs.some((line) => line.includes('guarded_position_jump_ignored'))).toBe(false);
      const startupDriftEvent = session.getDiagnostics().recentPlaybackEvents?.find(
        (event) =>
          event.kind === 'position_jump_suspected' &&
          event.reason === 'guarded_position_jump_ignored' &&
          event.details?.action === 'rebase_startup_clock_drift',
      );
      const details = startupDriftEvent?.details ?? {};
      expect(Number(details.reportedPositionSeconds)).toBeCloseTo(2.57, 2);
      expect(Number(details.startupExpectedPositionSeconds)).toBeCloseTo(1.58, 1);
      expect(Number(details.startupUnexpectedAdvanceSeconds)).toBeCloseTo(0.99, 1);
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('prepareLocalFile caches a complete provided probe without probing the file', async () => {
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const { decoder, session } = createSessionHarness([probe('prepared.flac', 44100)]);

    await session.prepareLocalFile({ filePath: 'prepared.flac', trackId: 'prepared', probe: completeProbe });

    expect(decoder.probeRequests).toEqual([]);
  });

  it('prepareLocalFile can prewarm Automix analysis without probing the file', async () => {
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const analysis = createEstimatedAutomixAnalysis({ durationSeconds: 120 });
    const analyze = vi.fn().mockResolvedValue(analysis);
    const { decoder, session } = createSessionHarness([probe('automix-prepared.flac', 44100)], [], [], {
      automixAnalyzer: { analyze },
    });

    await session.prepareLocalFile({
      filePath: 'automix-prepared.flac',
      trackId: 'automix-prepared',
      probe: completeProbe,
      automixAnalyze: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(decoder.probeRequests).toEqual([]);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'automix-prepared.flac',
      probe: expect.objectContaining({
        durationSeconds: 120,
        fileSampleRate: 44100,
      }),
    }));
  });

  it('starts current-track Automix analysis after playback has started', async () => {
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const analysis = createEstimatedAutomixAnalysis({ durationSeconds: 120 });
    const analyze = vi.fn().mockResolvedValue(analysis);
    const { decoder, session } = createSessionHarness([probe('automix-current.flac', 44100)], [], [], {
      automixAnalyzer: { analyze },
    });

    const status = await session.playLocalFile({
      filePath: 'automix-current.flac',
      trackId: 'automix-current',
      probe: { ...completeProbe, bpm: 128, bpmConfidence: 0.91, beatOffsetMs: 12 },
      automixAnalyze: true,
    });

    expect(status.state).toBe('playing');
    expect(decoder.probeRequests).toEqual([]);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'automix-current.flac',
      probe: expect.objectContaining({
        durationSeconds: 120,
        fileSampleRate: 44100,
      }),
      hint: expect.objectContaining({
        bpm: 128,
        bpmConfidence: 0.91,
        beatOffsetMs: 12,
      }),
    }));
  });

  it('prepareLocalFile probes and caches when the provided probe is incomplete', async () => {
    const { decoder, session } = createSessionHarness([probe('incomplete.flac', 96000)]);

    await session.prepareLocalFile({
      filePath: 'incomplete.flac',
      trackId: 'incomplete',
      probe: { durationSeconds: 120 },
    });
    await session.playLocalFile({ filePath: 'incomplete.flac', trackId: 'incomplete' });

    expect(decoder.probeRequests).toEqual(['incomplete.flac']);
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: 'incomplete.flac',
      decoderOutputSampleRate: 48000,
    });
  });

  it('playLocalFile uses a fresh prepared local probe and reports it in transition diagnostics', async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const logs: string[] = [];
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const { decoder, session } = createSessionHarness([probe('prepared-play.flac', 44100)], [48000], [], {
      logger: (message) => logs.push(message),
    });

    await session.prepareLocalFile({ filePath: 'prepared-play.flac', trackId: 'prepared-play', probe: completeProbe });
    now += 750;
    await session.playLocalFile({ filePath: 'prepared-play.flac', trackId: 'prepared-play' });
    dateNow.mockRestore();

    const transitions = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry?.event === 'audio_transition');

    expect(decoder.probeRequests).toEqual([]);
    expect(transitions.at(-1)).toMatchObject({
      preparedLocalProbeUsed: true,
      preparedLocalProbeAgeMs: 750,
    });
  });

  it('playLocalFile falls back to probing when the local prepare cache is missing', async () => {
    const { decoder, session } = createSessionHarness([probe('miss.flac', 44100)]);

    await session.playLocalFile({ filePath: 'miss.flac', trackId: 'miss' });

    expect(decoder.probeRequests).toEqual(['miss.flac']);
  });

  it('playLocalFile does not probe HTTP remote streams as local files when metadata is missing', async () => {
    const streamUrl = 'http://127.0.0.1:51483/remote-stream/webdav-token';
    const { bridges, decoder, session } = createSessionHarness([]);

    const status = await session.playLocalFile({
      filePath: streamUrl,
      trackId: 'remote:source-1:track-1',
      output: {
        outputMode: 'shared',
        playbackRate: 1.25,
        playbackSpeedMode: 'nightcore',
      },
    });

    expect(decoder.probeRequests).toEqual([]);
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: streamUrl,
      channels: 2,
      decoderOutputSampleRate: 48000,
    });
    expect(bridges[0].startOptions).toMatchObject({
      playbackSpeedMode: 'nightcore',
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      bufferSizeFrames: 8192,
      fifoCapacityMs: 3000,
      startupPrebufferMs: 250,
      startupPrebufferTimeoutMs: 1500,
    });
    expect(status.currentFilePath).toBe(streamUrl);
    expect(status.currentTrackId).toBe('remote:source-1:track-1');
    expect(status.fileSampleRate).toBeNull();
    expect(status.warnings).toContain('file_sample_rate_unknown_using_44100_fallback');
  });

  it('keeps HTTP stream playback loading until the decoder produces PCM', async () => {
    const streamUrl = 'https://cdn.example.test/song.flac';
    const decoder = new DelayedReadyDecoder(new Map());
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const play = session.playLocalFile({
        filePath: streamUrl,
        trackId: 'streaming:netease:track',
        probe: { durationSeconds: 180, codec: 'flac', bitrate: 999000 },
        output: { outputMode: 'shared' },
      });

      await expect.poll(() => decoder.decodeRequests.length).toBe(1);
      expect(session.getStatus().state).toBe('loading');
      expect(bridges[0].startOptions).toMatchObject({
        bufferSizeFrames: 8192,
        fifoCapacityMs: 3000,
        startupPrebufferMs: 250,
        startupPrebufferTimeoutMs: 1500,
      });

      decoder.releaseReady();
      await expect(play).resolves.toMatchObject({ state: 'playing', currentTrackId: 'streaming:netease:track' });
    } finally {
      session.dispose();
    }
  });

  it('keeps HTTP stream seek loading until the decoder produces PCM', async () => {
    const streamUrl = 'https://cdn.example.test/song.flac';
    const decoder = new DelayedReadyDecoder(new Map());
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const play = session.playLocalFile({
        filePath: streamUrl,
        trackId: 'streaming:netease:track',
        probe: { durationSeconds: 180, codec: 'flac', bitrate: 999000 },
        output: { outputMode: 'shared' },
      });
      await expect.poll(() => decoder.decodeRequests.length).toBe(1);
      decoder.releaseReady();
      await expect(play).resolves.toMatchObject({ state: 'playing' });

      const seek = session.seek(42);
      await expect.poll(() => decoder.decodeRequests.length).toBe(2);
      expect(session.getStatus()).toMatchObject({ state: 'loading', positionSeconds: 42 });

      bridges[0].positionSeconds = 99;
      expect(session.getStatus()).toMatchObject({ state: 'loading', positionSeconds: 42 });

      decoder.releaseReady();
      await expect(seek).resolves.toMatchObject({ state: 'playing', positionSeconds: 42 });
      expect(bridges[0].positionSeconds).toBe(42);
    } finally {
      session.dispose();
    }
  });

  it('playLocalFile uses partial HTTP stream probe hints without local metadata probing', async () => {
    const streamUrl = 'http://127.0.0.1:51483/remote-stream/webdav-token-with-duration';
    const { decoder, session } = createSessionHarness([]);

    const status = await session.playLocalFile({
      filePath: streamUrl,
      trackId: 'remote:source-1:track-2',
      probe: { durationSeconds: 188.5 },
      output: { outputMode: 'shared' },
    });

    expect(decoder.probeRequests).toEqual([]);
    expect(decoder.decodeRequests[0]?.filePath).toBe(streamUrl);
    expect(status.durationSeconds).toBe(188.5);
    expect(status.fileSampleRate).toBeNull();
  });

  it('expires prepared local probes after the short TTL', async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const { decoder, session } = createSessionHarness([probe('expired.flac', 44100)]);

    await session.prepareLocalFile({ filePath: 'expired.flac', trackId: 'expired', probe: completeProbe });
    now += 121_000;
    await session.playLocalFile({ filePath: 'expired.flac', trackId: 'expired' });
    dateNow.mockRestore();

    expect(decoder.probeRequests).toEqual(['expired.flac']);
  });

  it('separates prepared local probes by output context', async () => {
    const completeProbe = {
      durationSeconds: 120,
      fileSampleRate: 44100,
      channels: 2,
      codec: 'flac',
      bitDepth: 16,
      bitrate: 900000,
    };
    const { decoder, session } = createSessionHarness([probe('context.flac', 44100)]);

    await session.prepareLocalFile({ filePath: 'context.flac', trackId: 'context', probe: completeProbe });
    await session.playLocalFile({ filePath: 'context.flac', trackId: 'context', output: { outputMode: 'exclusive' } });

    expect(decoder.probeRequests).toEqual(['context.flac']);
  });

  it('does not reuse exclusive output across sample-rate changes', async () => {
    const { bridges, session } = createSessionHarness([probe('48.flac', 48000), probe('441.flac', 44100)]);

    await session.playLocalFile({ filePath: '48.flac', output: { outputMode: 'exclusive' } });
    await session.playLocalFile({ filePath: '441.flac', output: { outputMode: 'exclusive' } });

    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
  });

  it('shared mode keeps file and actual device rates separate and reports resampling', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { session } = createSessionHarness([probe('441.flac', 44100)], [48000], [sharedDevice]);

    const status = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'shared', deviceIndex: 0 },
    });

    expect(status.fileSampleRate).toBe(44100);
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.actualDeviceSampleRate).toBe(48000);
    expect(status.sharedDeviceSampleRate).toBe(48000);
    expect(status.resampling).toBe(true);
    expect(status.warnings).toContain('shared_output_resampling_or_mixer_rate_difference');
  });

  it('ignores stale explicit sample-rate settings in shared mode and stays on the mixer rate', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('96.flac', 96000)], [48000]);

    const status = await session.playLocalFile({
      filePath: '96.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 6,
        deviceName: 'TEAC USB AUDIO DEVICE',
        requestedOutputSampleRate: 96000,
        sharedBackend: 'windows',
      },
    });

    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
    });
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.actualDeviceSampleRate).toBe(48000);
    expect(status.decoderOutputSampleRate).toBe(48000);
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: '96.flac',
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
    });
  });

  it('uses the system default shared mix rate without pinning the default device', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { bridges, decoder, session } = createSessionHarness([probe('441.flac', 44100)], [48000], [sharedDevice]);

    const status = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'shared' },
    });

    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.decoderOutputSampleRate).toBe(48000);
    expect(status.sharedDeviceSampleRate).toBe(48000);
    expect(status.latencyProfile).toBe('balanced');
    expect(bridges[0].startOptions?.deviceIndex).toBeUndefined();
    expect(bridges[0].startOptions?.deviceName).toBeUndefined();
    expect(bridges[0].startOptions).toMatchObject({
      requestedOutputSampleRate: 48000,
      bufferSizeFrames: 4096,
      fifoCapacityMs: 750,
      startupPrebufferMs: 180,
      startupPrebufferTimeoutMs: 650,
      latencyProfile: 'balanced',
    });
    expect(decoder.decodeRequests[0].decoderOutputSampleRate).toBe(48000);
  });

  it('includes the shared mixer rate in audio diagnostics', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { session } = createSessionHarness([probe('441.flac', 44100)], [48000], [sharedDevice]);

    await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'shared' },
    });

    expect(session.getDiagnostics().sharedDeviceSampleRate).toBe(48000);
  });

  it('prefers stored device name over stale device index after host replacement', async () => {
    const devices: AudioDeviceInfo[] = [
      {
        id: 'shared:0',
        index: 0,
        name: 'TEAC USB AUDIO DEVICE',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: true,
      },
      {
        id: 'shared:6',
        index: 6,
        name: 'VoiceMeeter Aux Input',
        outputMode: 'shared',
        sampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        isDefault: false,
      },
    ];
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [48000], devices);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', deviceIndex: 6, deviceName: 'TEAC USB AUDIO DEVICE' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      deviceIndex: 6,
      deviceName: 'TEAC USB AUDIO DEVICE',
    });
  });

  it('falls back to the system default shared device when explicitly allowed and the selected shared device fails', async () => {
    const failingBridges = [
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
    ];
    const fallbackBridge = new FakeBridge(48000);
    const bridges = [...failingBridges, fallbackBridge];
    const reportAudioError = vi.fn();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      reportAudioError,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 6,
        deviceName: 'Missing USB DAC',
        defaultDeviceFallbackEnabled: true,
      },
    });

    expect(failingBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
    ]);
    expect(fallbackBridge.startOptions?.deviceIndex).toBeUndefined();
    expect(fallbackBridge.startOptions?.deviceName).toBeUndefined();
    expect(status.state).toBe('playing');
    expect(status.warnings).toContain('shared_output_fell_back_to_default_device');
  });

  it('keeps selected shared device failures in error state when default-device fallback is disabled', async () => {
    const failingBridges = [
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
      new ConfigurableStartupFailingBridge('output open failed: device disappeared'),
    ];
    const fallbackBridge = new FakeBridge(48000);
    const bridges = [...failingBridges, fallbackBridge];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    await expect(session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', deviceIndex: 6, deviceName: 'Missing USB DAC' },
    })).rejects.toThrow('device disappeared');

    expect(failingBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
      expect.objectContaining({ deviceIndex: 6, deviceName: 'Missing USB DAC' }),
    ]);
    expect(fallbackBridge.startOptions).toBeNull();
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().outputMode).toBe('shared');
    expect(session.getStatus().warnings).toContain('shared_output_default_device_fallback_blocked');
  });

  it('lets a recovery handler claim post-start expired FFmpeg stream URLs before fatal reporting', async () => {
    const decoder = new ControlledFailingDecoder(
      new Map([['https://m801.music.126.net/token/song.mp3?auth=old', {
        ...probe('https://m801.music.126.net/token/song.mp3?auth=old', 44100),
        codec: 'mp3',
      }]]),
    );
    const reportAudioError = vi.fn();
    const recoverAudioError = vi.fn(() => true);
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(44100),
      reportAudioError,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    session.setAudioErrorRecoveryHandler(recoverAudioError);
    await session.playLocalFile({
      filePath: 'https://m801.music.126.net/token/song.mp3?auth=old',
      trackId: 'streaming:netease:1442466883',
      output: { outputMode: 'exclusive' },
    });

    const error = Object.assign(
      new Error('ffmpeg_exit_code_3436169992; kind="http_expired_or_forbidden"; stderr="Server returned 403 Forbidden"'),
      { ffmpegErrorKind: 'http_expired_or_forbidden' },
    );
    decoder.fail(error);

    await expect.poll(() => session.getStatus().state).toBe('loading');
    expect(recoverAudioError).toHaveBeenCalledWith(error, expect.objectContaining({
      state: 'playing',
      currentTrackId: 'streaming:netease:1442466883',
      currentFilePath: 'https://m801.music.126.net/token/song.mp3?auth=old',
    }));
    expect(reportAudioError).not.toHaveBeenCalled();
  });

  it('marks selected shared device timeout recovery when the default shared device starts', async () => {
    const failingBridges = [
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
    ];
    const fallbackBridge = new FakeBridge(48000);
    const bridges = [...failingBridges, fallbackBridge];
    const reportAudioError = vi.fn();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      reportAudioError,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', deviceIndex: 6, deviceName: 'Sleeping USB DAC', defaultDeviceFallbackEnabled: true },
    });

    expect(fallbackBridge.startOptions?.deviceIndex).toBeUndefined();
    expect(fallbackBridge.startOptions?.deviceName).toBeUndefined();
    expect(status.state).toBe('playing');
    expect(status.warnings).toContain('shared_output_recovered_to_default_device');
    expect(reportAudioError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('timeout_waiting_for_ready'),
      phase: 'output-start',
      severity: 'recoverable',
    }));
  });

  it('treats device_initialize_timeout as non-retryable and falls back without re-trying same device', async () => {
    const failingBridge = new ConfigurableStartupFailingBridge(
      'echo-audio-host device_initialize_timeout; host="echo-audio-host.exe"; args="-sr 44100 -ch 2 -device Sleeping USB DAC"; mode="shared"; elapsedMs=3011; stderrTail="[echo-audio-host] WASAPI Initialize timed out after 3000ms phase=initialize"',
    );
    const safeBridge = new FakeBridge(48000);
    const bridges = [failingBridge, safeBridge];
    const reportAudioError = vi.fn();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      reportAudioError,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 6,
        deviceName: 'Sleeping USB DAC',
        defaultDeviceFallbackEnabled: true,
      },
    });

    expect(failingBridge.startOptions).toMatchObject({
      deviceIndex: 6,
      deviceName: 'Sleeping USB DAC',
    });
    expect(safeBridge.startOptions?.deviceIndex).toBeUndefined();
    expect(safeBridge.startOptions?.deviceName).toBeUndefined();
    expect(safeBridge.startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      fifoCapacityMs: 1500,
      startupPrebufferMs: 300,
    });
    expect(status.state).toBe('playing');
    expect(status.warnings).toContain('device_initialize_timeout');
    expect(status.warnings).toContain('shared_output_recovered_safe_mode');
    expect(status.warnings).not.toContain('shared_output_fell_back_to_default_device');
    expect(bridges).toHaveLength(0);
    expect(reportAudioError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('device_initialize_timeout'),
      phase: 'safe-shared-fallback',
      severity: 'recoverable',
    }));
  });

  it('treats WASAPI activate timeout as the same non-retryable device_initialize_timeout path', async () => {
    const failingBridge = new ConfigurableStartupFailingBridge(
      'echo-audio-host device_initialize_timeout; host="echo-audio-host.exe"; args="-sr 44100 -ch 2 -device Sleeping USB DAC"; mode="shared"; elapsedMs=3010; stderrTail="[echo-audio-host] WASAPI Activate timed out after 3000ms phase=activate"',
    );
    const safeBridge = new FakeBridge(48000);
    const bridges = [failingBridge, safeBridge];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 6,
        deviceName: 'Sleeping USB DAC',
        defaultDeviceFallbackEnabled: true,
      },
    });

    expect(failingBridge.startOptions).toMatchObject({
      deviceIndex: 6,
      deviceName: 'Sleeping USB DAC',
    });
    expect(safeBridge.startOptions?.deviceIndex).toBeUndefined();
    expect(safeBridge.startOptions?.deviceName).toBeUndefined();
    expect(status.state).toBe('playing');
    expect(status.warnings).toContain('device_initialize_timeout');
    expect(status.warnings).toContain('shared_output_recovered_safe_mode');
    expect(bridges).toHaveLength(0);
  });

  it('uses safe shared output when the default shared device also fails', async () => {
    const defaultBridges = [
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
      new ConfigurableStartupFailingBridge(
        'echo-audio-host timeout_waiting_for_ready; host="echo-audio-host.exe"; args="-sr 44100 -ch 2"; mode="shared"; elapsedMs=15000',
      ),
    ];
    const safeBridge = new FakeBridge(48000);
    const bridges = [...defaultBridges, safeBridge];
    const reportAudioError = vi.fn();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      reportAudioError,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared' },
    });

    expect(defaultBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: false }),
      expect.objectContaining({ exclusive: false }),
      expect.objectContaining({ exclusive: false }),
    ]);
    expect(safeBridge.startOptions).not.toHaveProperty('deviceIndex');
    expect(safeBridge.startOptions).not.toHaveProperty('deviceName');
    expect(safeBridge.startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      fifoCapacityMs: 1500,
      startupPrebufferMs: 300,
    });
    expect(status.state).toBe('playing');
    expect(status.latencyProfile).toBe('stable');
    expect(status.sharedStabilityTier).toBe('emergency');
    expect(status.warnings).toContain('shared_output_recovered_safe_mode');
    expect(reportAudioError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('timeout_waiting_for_ready'),
      phase: 'safe-shared-fallback',
      severity: 'recoverable',
    }));
  });

  it('does not recover pre-ready shared access violations with DirectSound', async () => {
    const crashMessage =
      'echo-audio-host exit_code_3221225477; host="echo-audio-host.exe"; args="-sr 48000 -ch 2"; mode="shared"; elapsedMs=778; exitCodeHex=0xC0000005; nativeCrash=access_violation; stderrTail="[echo-audio-host] createDevice completed"';
    const defaultBridges = [
      new ConfigurableStartupFailingBridge(crashMessage),
      new ConfigurableStartupFailingBridge(crashMessage),
      new ConfigurableStartupFailingBridge(crashMessage),
    ];
    const safeBridge = new ConfigurableStartupFailingBridge(crashMessage);
    const bridges = [...defaultBridges, safeBridge];
    const reportAudioError = vi.fn();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      reportAudioError,
      logger: noopLogger,
    });

    await expect(session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared' },
    })).rejects.toThrow('nativeCrash=access_violation');

    expect(defaultBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: false }),
      expect.objectContaining({ exclusive: false }),
      expect.objectContaining({ exclusive: false }),
    ]);
    expect(safeBridge.stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(0);
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().warnings).toContain('shared_output_recovered_safe_mode');
    expect(session.getStatus().warnings).not.toContain('shared_output_recovered_directsound_backend');
    expect(reportAudioError).toHaveBeenCalled();
    expect(JSON.stringify(reportAudioError.mock.calls)).not.toContain('directsound');
  });

  it('uses library probe hints and avoids device enumeration on the playback hot path', async () => {
    const decoder = new FakeDecoder(new Map());
    const bridges: FakeBridge[] = [];
    let listCalls = 0;
    const session = createAudioSessionForTest({
      decoder,
      deviceService: {
        listDevices: () => {
          listCalls += 1;
          return [];
        },
      },
      createBridge: () => {
        const bridge = new FakeBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'hinted.flac',
      trackId: 'track-1',
      output: { outputMode: 'shared', deviceIndex: 6, deviceName: 'TEAC USB AUDIO DEVICE' },
      probe: {
        durationSeconds: 123,
        fileSampleRate: 44100,
        channels: 2,
        codec: 'FLAC',
        bitDepth: 24,
        bitrate: 1400000,
      },
    });

    expect(listCalls).toBe(0);
    expect(status.durationSeconds).toBe(123);
    expect(status.fileSampleRate).toBe(44100);
    expect(bridges[0].startOptions).toMatchObject({
      deviceIndex: 6,
      deviceName: 'TEAC USB AUDIO DEVICE',
    });
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: 'hinted.flac',
      decoderOutputSampleRate: 48000,
    });
  });

  it('falls back to shared output when exclusive opens at the wrong sample rate', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('441.flac', 44100)], [48000, 48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: '441.flac',
      output: { outputMode: 'exclusive', exclusiveInstabilityFallbackEnabled: true },
    });

    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges[0].startOptions).toMatchObject({ exclusive: true, requestedOutputSampleRate: 44100 });
    expect(bridges[1].startOptions).toMatchObject({ exclusive: false, requestedOutputSampleRate: 48000 });
    expect(status.outputMode).toBe('shared');
    expect(status.outputBackend).toBe('wasapi-shared');
    expect(status.actualDeviceSampleRate).toBe(48000);
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.sampleRateMismatch).toBe(false);
    expect(status.resampling).toBe(true);
    expect(status.warnings).toContain('exclusive_output_fell_back_to_shared');
    expect(status.warnings).toContain('shared_output_resampling_or_mixer_rate_difference');
    expect(status.error).toBeNull();
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: '441.flac',
      decoderOutputSampleRate: 48000,
    });
  });

  it('keeps exclusive startup failures in error state when automatic downgrade is disabled', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const failingBridges = [
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
    ];
    const fallbackBridge = new FakeBridge(48000);
    const bridges = [...failingBridges, fallbackBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    await expect(session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive' },
    })).rejects.toThrow('AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED');

    expect(failingBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
    ]);
    expect(fallbackBridge.startOptions).toBeNull();
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().outputMode).toBe('exclusive');
    expect(session.getStatus().warnings).toContain('exclusive_output_fallback_blocked');
    expect(session.getStatus().warnings).not.toContain('exclusive_output_fell_back_to_shared');
  });

  it('falls back to shared output when exclusive startup downgrade is explicitly enabled', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const failingBridges = [
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
    ];
    const fallbackBridge = new FakeBridge(48000);
    const bridges = [...failingBridges, fallbackBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive', exclusiveInstabilityFallbackEnabled: true },
    });

    expect(failingBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
    ]);
    expect(fallbackBridge.startOptions).toMatchObject({ exclusive: false });
    expect(status.state).toBe('playing');
    expect(status.outputMode).toBe('shared');
    expect(status.warnings).toContain('exclusive_output_fell_back_to_shared');
    expect(status.error).toBeNull();
  });

  it('does not recover exclusive fallback shared access violations with DirectSound', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const exclusiveBridges = [
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED'),
    ];
    const sharedCrashMessage =
      'echo-audio-host exit_code_3221225477; host="echo-audio-host.exe"; args="-sr 48000 -ch 2"; mode="shared"; elapsedMs=778; exitCodeHex=0xC0000005; nativeCrash=access_violation';
    const sharedBridge = new ConfigurableStartupFailingBridge(sharedCrashMessage);
    const safeBridge = new ConfigurableStartupFailingBridge(sharedCrashMessage);
    const bridges = [...exclusiveBridges, sharedBridge, safeBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    await expect(session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive', exclusiveInstabilityFallbackEnabled: true },
    })).rejects.toThrow('nativeCrash=access_violation');

    expect(exclusiveBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
      expect.objectContaining({ exclusive: true }),
    ]);
    expect(sharedBridge.startOptions).toMatchObject({ exclusive: false });
    expect(safeBridge.startOptions).toMatchObject({ exclusive: false });
    expect(bridges).toHaveLength(0);
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().warnings).toContain('exclusive_output_fell_back_to_shared');
    expect(session.getStatus().warnings).toContain('shared_output_recovered_safe_mode');
    expect(session.getStatus().warnings).not.toContain('shared_output_recovered_directsound_backend');
  });
  it('keeps native direct playback off by default for local FLAC', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('default-direct-off.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'default-direct-off.flac',
      output: { outputMode: 'shared' },
    });

    expect(decoder.decodeRequests).toHaveLength(1);
    expect(bridges[0].sessionBeginOptions[0]?.directFilePath).toBeUndefined();
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
  });

  it('uses opt-in native direct playback for local WAV when no resampling is required', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([{ ...probe('pilot.wav', 48000), codec: 'WAV' }], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'pilot.wav',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'pilot.wav',
      directStartSeconds: 0,
      directSampleRate: 48000,
      directChannels: 2,
    });
  });

  it('uses opt-in native direct playback for local FLAC when no resampling is required', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('pilot.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'pilot.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'pilot.flac',
      directStartSeconds: 0,
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('maps opt-in native direct mono FLAC to a stereo output session', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const monoProbe = { ...probe('mono-direct.flac', 48000), channels: 1 };
    const { bridges, decoder, session } = createSessionHarness([monoProbe], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'mono-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].startOptions).toMatchObject({ channels: 2 });
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'mono-direct.flac',
      directSampleRate: 48000,
      directChannels: 1,
      directOutputChannels: 2,
    });
    expect(status.channels).toBe(1);
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('uses opt-in native direct playback for shared FLAC when the device mix rate requires resampling', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('shared-resample.flac', 44100)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'shared-resample.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'shared-resample.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.resampling).toBe(true);
    expect(status.warnings).toContain('shared_output_resampling_or_mixer_rate_difference');
  });

  it('uses opt-in native direct playback for local FLAC with ECHO SRC sample-rate output', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('src-direct.flac', 44100)], [176400], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'src-direct.flac',
      output: {
        outputMode: 'exclusive',
        nativeDirectLocalPlaybackEnabled: true,
        echoSrcMode: 'family4x',
      },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 176400,
    });
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'src-direct.flac',
      directSampleRate: 176400,
      directChannels: 2,
    });
    expect(status.echoSrcActive).toBe(true);
    expect(status.echoSrcTargetSampleRate).toBe(176400);
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
    expect(status.warnings).toContain('echo_src_active:44100->176400');
  });

  it('uses opt-in native direct playback for local FLAC with playback speed enabled', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('speed-direct.flac', 48000)], [48000], [], {
    });

    await session.setOutput({ playbackRate: 1.25, playbackSpeedMode: 'nightcore' });

    const status = await session.playLocalFile({
      filePath: 'speed-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      playbackRate: 1.25,
      directFilePath: 'speed-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
      directPlaybackRate: 1.25,
    });
    expect(status.playbackRate).toBe(1.25);
    expect(status.playbackSpeedMode).toBe('nightcore');
  });

  it('keeps native direct playback active when playback speed changes while playing', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('live-speed-direct.flac', 48000)], [48000], [], {
    });

    await session.playLocalFile({
      filePath: 'live-speed-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });
    bridges[0].positionSeconds = 18.25;

    const status = await session.setOutput({ playbackRate: 1.25, playbackSpeedMode: 'nightcore' });

    expect(bridges).toHaveLength(1);
    expect(bridges[0].sessionBeginOptions).toHaveLength(2);
    expect(bridges[0].sessionBeginOptions[1]).toMatchObject({
      playbackRate: 1.25,
      directFilePath: 'live-speed-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
      directPlaybackRate: 1.25,
    });
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(status.positionSeconds).toBe(18.25);
    expect(status.playbackRate).toBe(1.25);
  });

  it('uses opt-in native direct playback for local FLAC with native volume control', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('volume-direct.flac', 48000)], [48000], [], {
    });

    await session.setOutput({ volume: 0.5 });

    const status = await session.playLocalFile({
      filePath: 'volume-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].startOptions).toMatchObject({ volume: 0.5 });
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'volume-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
      directPlaybackRate: 1,
    });
    expect(status.volume).toBe(0.5);
  });

  it('applies persisted native direct playback on the next local play when the playback request omits the flag', async () => {
    audioCoreAppSettingsMock.current = {
      ...audioCoreAppSettingsMock.current,
      audioNativeDirectLocalPlaybackEnabled: true,
    };
    const { bridges, decoder, session } = createSessionHarness([probe('persisted-direct.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'persisted-direct.flac',
      output: { outputMode: 'exclusive' },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'persisted-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.nativeDirectLocalPlaybackRequested).toBe(true);
  });

  it('uses opt-in native direct playback with visual spectrum enabled by reporting fallback telemetry', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('visual-direct.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'visual-direct.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'visual-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.audioLevels?.visualTelemetryState).toBe('fallback');
    expect(status.audioLevels?.visualSpectrum?.every((value) => value === 0)).toBe(true);
  });

  it('uses opt-in native direct playback when ReplayGain metadata exists but ReplayGain is disabled', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('tagged-gain.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'tagged-gain.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
      replayGain: {
        trackGainDb: -5,
        trackPeak: 0.8,
        albumGainDb: null,
        albumPeak: null,
      },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'tagged-gain.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.replayGainEnabled).toBe(false);
  });

  it('uses opt-in native direct playback for WASAPI exclusive when the file rate matches the output rate', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('exclusive-direct.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'exclusive-direct.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 48000,
    });
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'exclusive-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(decoder.decodeRequests).toHaveLength(0);
    expect(status.outputMode).toBe('exclusive');
  });
  it('pauses and resumes resident native direct playback by restarting the direct session on the same host', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('direct-pause.flac', 48000)], [48000], [], {
    });

    await session.playLocalFile({
      filePath: 'direct-pause.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });
    bridges[0].positionSeconds = 12;

    const paused = await session.pause();

    expect(paused.state).toBe('paused');
    expect(bridges[0].sessionBegins).toBe(1);
    expect(bridges[0].sessionEnds).toBe(1);
    expect(bridges[0].setPaused).not.toHaveBeenCalled();
    expect(decoder.decodeRequests).toHaveLength(0);

    const resumed = await session.play();

    expect(resumed.state).toBe('playing');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].sessionBegins).toBe(2);
    expect(bridges[0].sessionEnds).toBe(1);
    expect(bridges[0].sessionBeginOptions[1]).toMatchObject({
      startSeconds: 12,
      directFilePath: 'direct-pause.flac',
      directStartSeconds: 12,
      directChannels: 2,
      directOutputChannels: 2,
    });
    expect(decoder.decodeRequests).toHaveLength(0);
  });

  it('restarts the native direct session on seek without reopening the resident output', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('direct-seek.flac', 48000)], [48000], [], {
    });

    await session.playLocalFile({
      filePath: 'direct-seek.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });
    const seekStatus = await session.seek(42.5);

    expect(bridges).toHaveLength(1);
    expect(bridges[0].sessionBeginOptions).toHaveLength(2);
    expect(bridges[0].sessionBeginOptions[1]).toMatchObject({
      startSeconds: 42.5,
      directFilePath: 'direct-seek.flac',
      directStartSeconds: 42.5,
      directChannels: 2,
      directOutputChannels: 2,
    });
    expect(decoder.decodeRequests).toHaveLength(0);
  });

  it('uses opt-in native direct playback for local MP3 when no resampling is required', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([{ ...probe('pilot.mp3', 48000), codec: 'MP3' }], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'pilot.mp3',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'pilot.mp3',
      directStartSeconds: 0,
      directSampleRate: 48000,
      directChannels: 2,
    });
  });

  it.each([
    { filePath: 'pilot.aiff', codec: 'AIFF' },
    { filePath: 'pilot.ogg', codec: 'Ogg Vorbis' },
  ])('uses opt-in native direct playback for local $codec when no resampling is required', async ({ filePath, codec }) => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([{ ...probe(filePath, 48000), codec }], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath,
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: filePath,
      directStartSeconds: 0,
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('prefers opt-in native direct playback when resident native decode is also enabled', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('juce-and-direct.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'juce-and-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'juce-and-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('falls back to the PCM decoder once when native direct playback fails inside the host', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness([probe('direct-fail.flac', 48000)], [48000, 48000], [], {
    });

    await session.playLocalFile({
      filePath: 'direct-fail.flac',
      output: { outputMode: 'exclusive', nativeDirectLocalPlaybackEnabled: true },
    });
    bridges[0].positionSeconds = 22;
    bridges[0].emit(
      'error',
      new Error('echo-audio-host direct_pcm_reader_failed; nativeMessage="direct PCM playback failed while reading PCM"'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = session.getStatus();
    expect(status.state).toBe('playing');
    expect(status.error).toBeNull();
    expect(status.warnings).toContain('native_direct_local_playback_fell_back_to_pcm');
    expect(status.warnings).toContain('native_direct_local_playback_not_applied:reader_failed');
    expect(status.nativeDirectLocalPlaybackActive).toBe(false);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('reader_failed');
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
    expect(bridges[0].sessionBeginOptions).toHaveLength(2);
    expect(bridges[0].sessionBeginOptions[1]?.directFilePath).toBeUndefined();
    expect(decoder.decodeRequests).toHaveLength(1);
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: 'direct-fail.flac',
      startSeconds: 22,
    });
  });

  it('uses native direct playback when ReplayGain must be applied', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    audioCoreAppSettingsMock.current = {
      ...audioCoreAppSettingsMock.current,
      replayGainEnabled: true,
    };
    const { bridges, decoder, session } = createSessionHarness([probe('gain.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'gain.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
      replayGain: {
        trackGainDb: -5,
        trackPeak: 0.8,
        albumGainDb: null,
        albumPeak: null,
      },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'gain.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(bridges[0].sessionBeginOptions[0]?.directGain).toBeCloseTo(Math.pow(10, -5 / 20), 6);
    expect(status.replayGainEnabled).toBe(true);
    expect(status.replayGainAppliedDb).toBe(-5);
    expect(status.warnings).not.toContain('native_direct_local_playback_not_applied:replaygain_active');
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
  });

  it('keeps the PCM decoder path for unsupported surround channel layouts', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const surroundProbe = { ...probe('surround.flac', 48000), channels: 6 };
    const { bridges, decoder, session } = createSessionHarness([surroundProbe], [48000]);

    const status = await session.playLocalFile({
      filePath: 'surround.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(1);
    expect(decoder.decodeRequests[0]).toMatchObject({ channels: 6 });
    expect(bridges[0].startOptions).toMatchObject({ channels: 6 });
    expect(bridges[0].sessionBeginOptions[0]?.directFilePath).toBeUndefined();
    expect(status.warnings).toContain('native_direct_local_playback_not_applied:unsupported_channels');
    expect(status.nativeDirectLocalPlaybackActive).toBe(false);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('unsupported_channels');
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
  });

  it('uses native direct playback when native EQ DSP is active', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    await getEqBridge().setEnabled(true);
    const { bridges, decoder, session } = createSessionHarness([probe('eq-direct.flac', 48000)], [48000]);

    const status = await session.playLocalFile({
      filePath: 'eq-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });

    expect(decoder.decodeRequests).toHaveLength(0);
    expect(bridges[0].sessionBeginOptions[0]).toMatchObject({
      directFilePath: 'eq-direct.flac',
      directSampleRate: 48000,
      directChannels: 2,
    });
    expect(status.eqEnabled).toBe(true);
    expect(status.dspActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackActive).toBe(true);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBeNull();
    expect(status.warnings).not.toContain('native_direct_local_playback_not_applied:dsp_active');
  });

  it('keeps chained playback on the PCM decoder path when native direct is enabled', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness(
      [probe('gapless-current.flac', 48000), probe('gapless-next.flac', 48000)],
      [48000],
    );

    const status = await session.playLocalFile({
      filePath: 'gapless-current.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
      gapless: {
        enabled: true,
        next: {
          filePath: 'gapless-next.flac',
        },
      },
    });

    expect(decoder.decodeRequests.length).toBeGreaterThanOrEqual(1);
    expect(bridges[0].sessionBeginOptions[0]?.directFilePath).toBeUndefined();
    expect(status.warnings).toContain('native_direct_local_playback_not_applied:chained_playback');
    expect(status.nativeDirectLocalPlaybackActive).toBe(false);
    expect(status.nativeDirectLocalPlaybackFallbackReason).toBe('chained_playback');
  });

  it('does not retain a direct payload after local direct playback is disabled', async () => {
    disableAudioVisualSpectrumForDirectPlaybackTest();
    const { bridges, decoder, session } = createSessionHarness(
      [probe('first-direct.flac', 48000), probe('second-pcm.flac', 48000)],
      [48000],
      [],
    );

    await session.playLocalFile({
      filePath: 'first-direct.flac',
      output: { outputMode: 'shared', nativeDirectLocalPlaybackEnabled: true },
    });
    const disabledStatus = await session.setOutput({ nativeDirectLocalPlaybackEnabled: false });
    const nextStatus = await session.playLocalFile({
      filePath: 'second-pcm.flac',
      output: { outputMode: 'shared' },
    });

    expect(disabledStatus.nativeDirectLocalPlaybackRequested).toBe(false);
    expect(disabledStatus.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
    expect(decoder.decodeRequests.map((request) => request.filePath)).toEqual(['first-direct.flac', 'second-pcm.flac']);
    expect(bridges.at(-1)?.sessionBeginOptions.at(-1)?.directFilePath).toBeUndefined();
    expect(nextStatus.nativeDirectLocalPlaybackRequested).toBe(false);
    expect(nextStatus.nativeDirectLocalPlaybackFallbackReason).toBe('disabled');
    expect(nextStatus.activeDecodeBackendImpl).toBe('ffmpeg');
  });

  it('keeps FFmpeg decode when the local decode fast path is manually disabled', async () => {
    const { decoder, session } = createSessionHarness([probe('disabled.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'disabled.flac',
      output: { outputMode: 'shared' },
    });

    expect(decoder.decodeRequests).toHaveLength(1);
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
  });

  it('keeps FFmpeg SOXR decode when local playback needs resampling', async () => {
    const { decoder, session } = createSessionHarness([probe('resample.flac', 44100)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'resample.flac',
      output: { outputMode: 'shared' },
    });

    expect(decoder.decodeRequests).toHaveLength(1);
    expect(decoder.decodeRequests[0]).toMatchObject({
      filePath: 'resample.flac',
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
    });
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
  });

  it('keeps FFmpeg decode for local files that need request headers', async () => {
    const { decoder, session } = createSessionHarness([probe('headers.flac', 48000)], [48000], [], {
    });

    const status = await session.playLocalFile({
      filePath: 'headers.flac',
      inputHeaders: { Authorization: 'Bearer token' },
      output: { outputMode: 'shared' },
    });

    expect(decoder.decodeRequests).toHaveLength(1);
    expect(decoder.decodeRequests[0]?.inputHeaders).toEqual({ Authorization: 'Bearer token' });
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
  });
  it('keeps PCM output over WASAPI exclusive when PCM to SDM would require DoP', async () => {
    const filePath = 'pcm-to-sdm.flac';
    const pcmDecoder = new PcmChunkDecoder(new Map([[filePath, probe(filePath, 44100)]]), [pcmBuffer([0, 0, 0, 0])]);
    const { bridges, session } = createSessionHarness(
      [probe(filePath, 44100)],
      [],
      [],
      { decoder: pcmDecoder },
    );

    const status = await session.playLocalFile({
      filePath,
      output: {
        outputMode: 'exclusive',
        sdmMode: 'pcmToDsd',
        sdmTargetRate: 'dsd64',
        sdmQualityProfile: 'safe',
        sdmComputeBackend: 'cpu',
        echoSrcQualityProfile: 'lowLatency',
      },
    });
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      inputFormat: 'pcm-f32le',
      requestedOutputSampleRate: 44100,
    });
    expect(pcmDecoder.decodeRequests.at(-1)).toMatchObject({
      filePath,
      decoderOutputSampleRate: 44100,
      resamplerEngine: 'default',
      resamplerQualityProfile: 'lowLatency',
    });
    expect(bridges[0].sessionBeginOptions[0]?.directFilePath).toBeUndefined();
    expect(status.activeDsdOutputMode).toBeNull();
    expect(status.sdmRuntimeState).toBe('pcm_to_sdm_not_routed');
    expect(status.sdmActive).toBe(false);
    expect(status.sdmNativeSampleRate).toBeNull();
    expect(status.sdmTransportSampleRate).toBeNull();
    expect(status.sdmActualComputeBackend).toBeNull();
    expect(status.sdmModulatorProfile).toBeNull();
    expect(status.sdmRuntime?.fallbackReason).toBe('sdm_pcm_to_dsd_native_dsd_required');
    expect(status.warnings).toContain('sdm_pcm_to_dsd_native_dsd_required');
  });
  it('keeps PCM output when PCM to SDM is requested over WASAPI exclusive DoP', async () => {
    const filePath = 'exclusive-dsd256-sdm-protected.flac';
    const processSdm = vi.fn(async (request: EchoSdmWorkerRequest) => ({
      backend: 'cuda' as const,
      output: Uint8Array.from([]),
      errorHistory: request.errorHistory,
      ditherState: request.ditherState,
      dopFrameIndex: request.dopFrameIndex,
    }));
    const pcmDecoder = new PcmChunkDecoder(
      new Map([[filePath, probe(filePath, 44100)]]),
      [pcmBuffer([0, 0, 0, 0])],
    );
    const { bridges, session } = createSessionHarness(
      [probe(filePath, 44100)],
      [],
      [],
      {
        decoder: pcmDecoder,
        resolveEchoSrcFirBackendStatus: () => ({
          backend: 'cuda',
          available: true,
          active: true,
          reason: null,
          cudaRuntime: {
            available: true,
            source: 'nvidia-smi',
            deviceName: 'NVIDIA Test GPU',
            driverVersion: '610.47',
            cudaVersion: '13.3',
            error: null,
          },
        }),
        createSdmCudaWorkerClient: () => ({
          processSdm,
          dispose: vi.fn(),
        }),
      },
    );

    const status = await session.playLocalFile({
      filePath,
      output: {
        outputMode: 'exclusive',
        sdmMode: 'pcmToDsd',
        sdmTargetRate: 'dsd256',
        sdmQualityProfile: 'hifi',
        sdmComputeBackend: 'cuda',
      },
    });

    expect(status.sdmRuntimeState).toBe('pcm_to_sdm_not_routed');
    expect(status.sdmActive).toBe(false);
    expect(status.sdmActualComputeBackend).toBeNull();
    expect(status.sdmRuntime?.fallbackReason).toBe('sdm_pcm_to_dsd_native_dsd_required');
    expect(status.warnings).toContain('sdm_pcm_to_dsd_native_dsd_required');
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      inputFormat: 'pcm-f32le',
      requestedOutputSampleRate: 44100,
    });
    expect(processSdm).not.toHaveBeenCalled();
  });

  it('keeps PCM output when PCM to SDM is requested on shared output', async () => {
    const filePath = 'shared-output-sdm-request.flac';
    const processSdm = vi.fn(async (request: EchoSdmWorkerRequest) => ({
      backend: 'cuda' as const,
      output: Uint8Array.from([]),
      errorHistory: request.errorHistory,
      ditherState: request.ditherState,
      dopFrameIndex: request.dopFrameIndex,
    }));
    const pcmDecoder = new PcmChunkDecoder(
      new Map([[filePath, probe(filePath, 44100)]]),
      [pcmBuffer([0, 0, 0, 0])],
    );
    const { bridges, session } = createSessionHarness(
      [probe(filePath, 44100)],
      [],
      [],
      {
        decoder: pcmDecoder,
        resolveEchoSrcFirBackendStatus: () => ({
          backend: 'cuda',
          available: true,
          active: true,
          reason: null,
          cudaRuntime: {
            available: true,
            source: 'nvidia-smi',
            deviceName: 'NVIDIA Test GPU',
            driverVersion: '610.47',
            cudaVersion: '13.3',
            error: null,
          },
        }),
        createSdmCudaWorkerClient: () => ({
          processSdm,
          dispose: vi.fn(),
        }),
      },
    );

    const status = await session.playLocalFile({
      filePath,
      output: {
        outputMode: 'shared',
        sdmMode: 'pcmToDsd',
        sdmTargetRate: 'dsd256',
        sdmQualityProfile: 'hifi',
        sdmComputeBackend: 'cuda',
      },
    });

    expect(status.sdmRuntimeState).toBe('pcm_to_sdm_not_routed');
    expect(status.sdmActive).toBe(false);
    expect(status.sdmActualComputeBackend).toBeNull();
    expect(status.sdmRuntime?.state).toBe('unavailable');
    expect(status.sdmRuntime?.fallbackReason).toBe('sdm_pcm_to_dsd_requires_native_dsd_output');
    expect(status.warnings).toContain('sdm_pcm_to_dsd_requires_native_dsd_output');
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(bridges[0].startOptions).toMatchObject({
      exclusive: false,
      inputFormat: 'pcm-f32le',
      requestedOutputSampleRate: 48000,
    });
    expect(processSdm).not.toHaveBeenCalled();
  });
  it('uses DSF bitstream DoP over WASAPI exclusive when explicitly enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-dop-'));
    const filePath = join(tempDir, 'native-dop.dsf');
    await writeFile(filePath, createDsfDopFixture());
    const { bridges, decoder, session } = createSessionHarness([dsdProbe(filePath)]);

    try {
      const status = await session.playLocalFile({
        filePath,
        output: { outputMode: 'exclusive', dsdOutputMode: 'dop' },
      });
      for (let attempt = 0; attempt < 10 && bridges[0].sessionChunks.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      expect(bridges[0].startOptions).toMatchObject({
        exclusive: true,
        inputFormat: 'dop24le',
        requestedOutputSampleRate: 176400,
      });
      expect(decoder.decodeRequests).toHaveLength(0);
      expect(bridges[0].sessionChunks.map((item) => [...item.chunk])).toEqual([
        [1, 2, 0x05, 5, 6, 0x05, 3, 4, 0xfa, 7, 8, 0xfa],
      ]);
      expect(status.activeDecodeBackendImpl).toBe('dsf-bitstream-dop');
      expect(status.dsdOutputModeRequested).toBe('dop');
      expect(status.activeDsdOutputMode).toBe('dop');
      expect(status.dsdNativeSampleRate).toBe(2822400);
      expect(status.dsdTransportSampleRate).toBe(176400);
      expect(status.warnings).not.toContain('dsd_source_decoded_to_pcm:2822400->176400');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      session.dispose();
    }
  });

  it('keeps DSF bitstream DoP when seeking while playing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-dop-seek-'));
    const filePath = join(tempDir, 'native-dop-seek.dsf');
    await writeFile(filePath, createDsfDopFixture());
    const { bridges, decoder, session } = createSessionHarness([dsdProbe(filePath)]);

    try {
      await session.playLocalFile({
        filePath,
        output: { outputMode: 'exclusive', dsdOutputMode: 'dop' },
      });
      for (let attempt = 0; attempt < 10 && bridges[0].sessionChunks.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      const seekSeconds = 16 / 2_822_400;
      const status = await session.seek(seekSeconds);
      for (let attempt = 0; attempt < 10 && bridges[0].sessionChunks.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      expect(bridges).toHaveLength(1);
      expect(decoder.decodeRequests).toHaveLength(0);
      expect(bridges[0].startOptions).toMatchObject({
        inputFormat: 'dop24le',
        requestedOutputSampleRate: 176400,
      });
      expect(bridges[0].sessionChunks.map((item) => item.sessionId)).toEqual([1, 2]);
      const lastChunk = bridges[0].sessionChunks.at(-1)?.chunk;
      expect(lastChunk ? [...lastChunk] : []).toEqual([3, 4, 0xfa, 7, 8, 0xfa]);
      expect(status.activeDecodeBackendImpl).toBe('dsf-bitstream-dop');
      expect(status.activeDsdOutputMode).toBe('dop');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      session.dispose();
    }
  });
  it('keeps DoP disabled in shared mode and falls back to PCM with a visible warning', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { bridges, decoder, session } = createSessionHarness([dsdProbe('shared-dop-disabled.dsf')], [48000], [sharedDevice]);

    const status = await session.playLocalFile({
      filePath: 'shared-dop-disabled.dsf',
      output: { outputMode: 'shared', dsdOutputMode: 'dop' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      inputFormat: 'pcm-f32le',
      requestedOutputSampleRate: 48000,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'shared-dop-disabled.dsf',
      decoderOutputSampleRate: 48000,
    });
    expect(status.dsdOutputModeRequested).toBe('dop');
    expect(status.activeDsdOutputMode).toBeNull();
    expect(status.warnings).toContain('dsd_dop_requires_exclusive_or_asio');
    expect(status.warnings).toContain('dsd_source_decoded_to_pcm:2822400->48000');
  });

  it('falls back to FFmpeg PCM when DSF DoP preparation fails after opening the output', async () => {
    const missingPath = join(tmpdir(), `missing-dop-${Date.now()}.dsf`);
    const { bridges, decoder, session } = createSessionHarness([dsdProbe(missingPath)]);

    const status = await session.playLocalFile({
      filePath: missingPath,
      output: { outputMode: 'exclusive', dsdOutputMode: 'dop' },
    });

    expect(bridges).toHaveLength(2);
    expect(bridges[0].startOptions).toMatchObject({
      inputFormat: 'dop24le',
      requestedOutputSampleRate: 176400,
    });
    expect(bridges[1].startOptions).toMatchObject({
      inputFormat: 'pcm-f32le',
      requestedOutputSampleRate: 176400,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: missingPath,
      decoderOutputSampleRate: 176400,
    });
    expect(status.dsdOutputModeRequested).toBe('dop');
    expect(status.activeDsdOutputMode).toBeNull();
    expect(status.activeDecodeBackendImpl).toBe('ffmpeg');
    expect(status.warnings.some((warning) => warning.startsWith('dsd_dop_fell_back_to_pcm:'))).toBe(true);
  });
  it('maps DSD128 sources to a capped 352.8 kHz PCM output plan', async () => {
    const { bridges, decoder, session } = createSessionHarness([dsdProbe('dsd128.dsf', 5644800)]);

    const status = await session.playLocalFile({
      filePath: 'dsd128.dsf',
      output: { outputMode: 'exclusive' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 352800,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'dsd128.dsf',
      decoderOutputSampleRate: 352800,
    });
    expect(status.fileSampleRate).toBe(5644800);
    expect(status.requestedOutputSampleRate).toBe(352800);
    expect(status.decoderOutputSampleRate).toBe(352800);
    expect(status.warnings).toContain('dsd_source_decoded_to_pcm:5644800->352800');
  });

  it('lets the DSD PCM target override stale explicit 44.1 kHz output settings in resident modes', async () => {
    for (const outputMode of ['exclusive'] as const) {
      const filePath = `${outputMode}-explicit-dsd.dsf`;
      const { bridges, decoder, session } = createSessionHarness([dsdProbe(filePath)]);

      const status = await session.playLocalFile({
        filePath,
        output: { outputMode, requestedOutputSampleRate: 44100 },
      });

      expect(bridges[0].startOptions).toMatchObject({
        exclusive: outputMode === 'exclusive',
        requestedOutputSampleRate: 176400,
      });
      expect(decoder.decodeRequests.at(-1)).toMatchObject({
        filePath,
        decoderOutputSampleRate: 176400,
      });
      expect(status.requestedOutputSampleRate).toBe(176400);
      expect(status.decoderOutputSampleRate).toBe(176400);
      expect(status.warnings).not.toContain('explicit_resampling_requested_for_exclusive_output');
    }
  });

  it('keeps DSD in shared mode on the mixer rate and reports the resampling path', async () => {
    const sharedDevice: AudioDeviceInfo = {
      id: 'shared:0',
      index: 0,
      name: 'Speakers',
      outputMode: 'shared',
      sampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      isDefault: true,
    };
    const { bridges, decoder, session } = createSessionHarness([dsdProbe('shared-dsd.dsf')], [48000], [sharedDevice]);

    const status = await session.playLocalFile({
      filePath: 'shared-dsd.dsf',
      output: { outputMode: 'shared' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: false,
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'shared-dsd.dsf',
      decoderOutputSampleRate: 48000,
    });
    expect(status.outputMode).toBe('shared');
    expect(status.requestedOutputSampleRate).toBe(48000);
    expect(status.decoderOutputSampleRate).toBe(48000);
    expect(status.resampling).toBe(true);
    expect(status.bitPerfectCandidate).toBe(false);
    expect(status.warnings).toContain('dsd_source_decoded_to_pcm:2822400->48000');
    expect(status.warnings).toContain('shared_output_resampling_or_mixer_rate_difference');
  });
  it('uses balanced native buffering for WASAPI exclusive by default', async () => {
    const { bridges, session } = createSessionHarness([probe('exclusive.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'exclusive.flac',
      output: { outputMode: 'exclusive' },
    });

    const startOptions = bridges[0].startOptions;
    expect(startOptions).toMatchObject({
      exclusive: true,
      bufferSizeFrames: 2048,
      latencyProfile: 'balanced',
    });
    expect(startOptions?.startupPrebufferMs).toBeUndefined();
    expect(startOptions?.startupPrebufferTimeoutMs).toBeUndefined();
  });

  it('honors low-latency requests for WASAPI exclusive output', async () => {
    const { bridges, session } = createSessionHarness([probe('exclusive.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'exclusive.flac',
      output: { outputMode: 'exclusive', latencyProfile: 'lowLatency' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      bufferSizeFrames: 1024,
      latencyProfile: 'lowLatency',
    });
    expect(bridges[0].startOptions?.startupPrebufferMs).toBeUndefined();
    expect(bridges[0].startOptions?.startupPrebufferTimeoutMs).toBeUndefined();
  });

  it('adapts WASAPI exclusive low-latency buffering at high sample rates', async () => {
    const { bridges, session } = createSessionHarness([probe('exclusive.flac', 192000)]);

    await session.playLocalFile({
      filePath: 'exclusive.flac',
      output: { outputMode: 'exclusive', latencyProfile: 'lowLatency' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      requestedOutputSampleRate: 192000,
      bufferSizeFrames: 1536,
      latencyProfile: 'lowLatency',
    });
    expect(bridges[0].startOptions?.startupPrebufferMs).toBeUndefined();
    expect(bridges[0].startOptions?.startupPrebufferTimeoutMs).toBeUndefined();
  });

  it('keeps balanced buffering available for WASAPI exclusive output', async () => {
    const { bridges, session } = createSessionHarness([probe('exclusive.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'exclusive.flac',
      output: { outputMode: 'exclusive', latencyProfile: 'balanced' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      bufferSizeFrames: 2048,
      latencyProfile: 'balanced',
    });
    expect(bridges[0].startOptions?.startupPrebufferMs).toBeUndefined();
    expect(bridges[0].startOptions?.startupPrebufferTimeoutMs).toBeUndefined();
  });

  it('keeps stable buffering available for WASAPI exclusive output', async () => {
    const { bridges, session } = createSessionHarness([probe('exclusive.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'exclusive.flac',
      output: { outputMode: 'exclusive', latencyProfile: 'stable' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      exclusive: true,
      bufferSizeFrames: 8192,
      latencyProfile: 'stable',
    });
    expect(bridges[0].startOptions?.startupPrebufferMs).toBeUndefined();
    expect(bridges[0].startOptions?.startupPrebufferTimeoutMs).toBeUndefined();
  });
  it('keeps explicit stable 8192-frame output requests intact', async () => {
    const { bridges, session } = createSessionHarness([probe('stable.flac', 44100)]);

    const status = await session.playLocalFile({
      filePath: 'stable.flac',
      output: { outputMode: 'shared', latencyProfile: 'stable', bufferSizeFrames: 8192 },
    });

    expect(bridges[0].startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      latencyProfile: 'stable',
    });
    expect(status.warnings).not.toContain('low_latency_buffer_ignored');
    expect(status.warnings).not.toContain('low_latency_buffer_clamped:2048');
  });
  it('reports native buffer fallback warnings and latency from ready metadata', async () => {
    const bridge = new FakeBridge(44100, {
      deviceBufferFrames: 4096,
      nativeActualBufferFrames: 4096,
      actualBufferFrames: 4096,
      requestedDeviceBufferFrames: 512,
      openedDeviceBufferFrames: 4096,
      bufferSizeFallback: true,
    });
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['fallback.flac', probe('fallback.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
    });

    const status = await session.playLocalFile({
      filePath: 'fallback.flac',
      output: { outputMode: 'exclusive' },
    });

    expect(status.warnings).toContain('native_output_buffer_size_fell_back:512->4096');
    expect(status.nativeActualBufferFrames).toBe(4096);
    expect(status.nativeOutputLatencyMs).toBe(93);
  });
  it('exposes native output format from native ready metadata', async () => {
    const bridge = new FakeBridge(48000, { format: 'pcm16' });
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['format.flac', probe('format.flac', 48000)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    const status = await session.playLocalFile({ filePath: 'format.flac', output: { outputMode: 'exclusive' } });

    expect(status.nativeOutputFormat).toBe('pcm16');
    expect(session.getStatus().nativeOutputFormat).toBe('pcm16');
    expect(session.getDiagnostics().nativeOutputFormat).toBe('pcm16');
    await expect(session.disposeGracefully()).resolves.toBeUndefined();
  });

  it('reports null native output format when old native hosts omit ready metadata', async () => {
    const { session } = createSessionHarness([probe('missing-format.flac', 48000)], [], [], {
      disableWatchdogTimer: true,
    });

    const status = await session.playLocalFile({ filePath: 'missing-format.flac', output: { outputMode: 'exclusive' } });

    expect(status.nativeOutputFormat).toBeNull();
    expect(session.getStatus().nativeOutputFormat).toBeNull();
    expect(session.getDiagnostics().nativeOutputFormat).toBeNull();
    await expect(session.disposeGracefully()).resolves.toBeUndefined();
  });

  it('pause stops the active native host and prewarms resume output at the current position', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12.5;
    const status = await session.pause();

    expect(status.state).toBe('paused');
    expect(status.positionSeconds).toBe(12.5);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({ startSeconds: 12.5 });
  });

  it('fades native output volume down before pausing without changing the user volume', async () => {
    const fadeWait = vi.fn(async () => undefined);
    audioCoreAppSettingsMock.current = {
      ...audioCoreAppSettingsMock.current,
      audioTransportFadeEnabled: true,
      audioTransportFadeCurve: 'linear',
    };
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      transportFadeDurationMs: 30,
      transportFadeStepMs: 10,
      transportFadeWait: fadeWait,
    });

    await session.setOutput({ volume: 0.8 });
    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12.5;
    const status = await session.pause();

    const fadeCalls = bridges[0].setVolume.mock.calls.map(([volume]) => volume);
    expect(fadeCalls[0]).toBeCloseTo(0.8);
    expect(fadeCalls.at(-1)).toBe(0);
    expect(fadeCalls).toHaveLength(4);
    expect(fadeWait).toHaveBeenCalledTimes(3);
    expect(status.state).toBe('paused');
    expect(status.volume).toBe(0.8);
    expect(bridges[0].setVolume.mock.invocationCallOrder.at(-1)).toBeLessThan(bridges[0].stop.mock.invocationCallOrder[0]);
  });

  it('keeps native play/pause fade disabled by default', async () => {
    const fadeWait = vi.fn(async () => undefined);
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      transportFadeDurationMs: 30,
      transportFadeStepMs: 10,
      transportFadeWait: fadeWait,
    });

    await session.setOutput({ volume: 0.8 });
    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12.5;
    const status = await session.pause();

    expect(fadeWait).not.toHaveBeenCalled();
    expect(bridges[0].setVolume).not.toHaveBeenCalled();
    expect(status.volume).toBe(0.8);
  });

  it('pauses resident output without waiting for a stuck decoder cleanup', async () => {
    const stop = vi.fn();
    const decoder = new class extends FakeDecoder {
      override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
        this.decodeRequests.push(request);
        const stream = new PassThrough();
        queueMicrotask(() => {
          if (!stream.destroyed) {
            stream.write(pcmBuffer([0, 0]));
          }
        });

        return {
          stream,
          stop,
          done: new Promise(() => undefined),
          waitForExitOnStop: true,
        };
      }
    }(new Map([['song.flac', probe('song.flac', 44100)]]));
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge(44100);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'exclusive' } });
    bridges[0].positionSeconds = 21.5;

    let resolvedStatus: AudioStatus | null = null;
    void session.pause().then((status) => {
      resolvedStatus = status;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(resolvedStatus).toMatchObject({ state: 'paused', positionSeconds: 21.5 });
    expect(bridges[0].sessionEnds).toBeGreaterThan(0);
    expect(stop).toHaveBeenCalledTimes(1);
    const resumedStatus = await session.play();
    expect(resumedStatus.state).toBe('playing');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].sessionBegins).toBe(2);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: 'song.flac', startSeconds: 21.5 });
    session.dispose();
  });

  it('ignores native ended events while playback is paused', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12.5;
    await session.pause();
    bridges[1].positionSeconds = 12.5;
    bridges[1].emit('ended');

    expect(session.getStatus().state).toBe('paused');
    expect(session.getStatus().error).toBeNull();
    expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
      kind: 'ended',
      severity: 'info',
      reason: 'ended_ignored_while_not_playing',
    });
  });

  it('play resumes a paused file from the prewarmed output host', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 18.25;
    await session.pause();
    await Promise.resolve();
    await Promise.resolve();
    const status = await session.play();

    expect(status.state).toBe('playing');
    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges[1].positionSeconds).toBe(18.25);
    expect(decoder.probeRequests).toEqual(['song.flac']);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ startSeconds: 18.25 });
  });

  it('prewarms HTTP stream decoders from the paused position without soft-pausing native output', async () => {
    const streamUrl = 'https://cdn.example.test/song.flac';
    const decoder = new class extends FakeDecoder {
      private resumeReady: (() => void) | null = null;

      override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
        this.decodeRequests.push(request);
        const stream = new PassThrough();
        const stop = vi.fn(() => {
          stream.destroy();
        });

        if (this.decodeRequests.length === 1) {
          queueMicrotask(() => {
            if (!stream.destroyed) {
              stream.write(pcmBuffer([0, 0]));
            }
          });
          return { stream, stop, ready: Promise.resolve(), done: new Promise(() => undefined) };
        }

        return {
          stream,
          stop,
          ready: new Promise<void>((resolve) => {
            this.resumeReady = () => {
              stream.write(pcmBuffer([0, 0]));
              resolve();
              this.resumeReady = null;
            };
          }),
          done: new Promise(() => undefined),
        };
      }

      releaseResumeReady(): void {
        if (!this.resumeReady) {
          throw new Error('resume decoder ready was not pending');
        }
        this.resumeReady();
      }

      hasResumeReady(): boolean {
        return this.resumeReady !== null;
      }
    }(new Map([[streamUrl, probe(streamUrl, 44100)]]));
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge(44100);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
    });

    const initialPlay = session.playLocalFile({
      filePath: streamUrl,
      trackId: 'streaming:netease:track',
      output: { outputMode: 'shared' },
      probe: { durationSeconds: 120, fileSampleRate: 44100, channels: 2, codec: 'FLAC' },
    });
    expect(session.getStatus().state).toBe('loading');
    await initialPlay;

    bridges[0].positionSeconds = 18.25;
    const paused = await session.pause();
    expect(paused).toMatchObject({ state: 'paused', positionSeconds: 18.25 });
    expect(bridges[0].setPaused).not.toHaveBeenCalled();
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(decoder.decodeRequests).toHaveLength(1);
    await expect.poll(() => bridges.length).toBe(2);
    await expect.poll(() => decoder.decodeRequests.length).toBe(2);
    expect(decoder.hasResumeReady()).toBe(true);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: streamUrl, startSeconds: 18.25 });

    const resumeStates: string[] = [];
    session.on('status', (status) => {
      resumeStates.push(status.state);
    });

    const resumedPromise = session.play();
    await Promise.resolve();
    expect(decoder.hasResumeReady()).toBe(true);
    const resumed = await resumedPromise;
    decoder.releaseResumeReady();
    expect(resumed).toMatchObject({ state: 'playing', currentTrackId: 'streaming:netease:track' });
    expect(resumeStates).toContain('loading');
    expect(resumeStates.at(-1)).toBe('playing');
    expect(bridges).toHaveLength(2);
    expect(decoder.decodeRequests).toHaveLength(2);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: streamUrl, startSeconds: 18.25 });
    expect(bridges[1].positionSeconds).toBe(18.25);
    expect(bridges[0].setPaused).not.toHaveBeenCalled();
    expect(bridges[1].setPaused).not.toHaveBeenCalled();
  });

  it('fades native output back in when resuming from a prewarmed pause', async () => {
    const fadeWait = vi.fn(async () => undefined);
    audioCoreAppSettingsMock.current = {
      ...audioCoreAppSettingsMock.current,
      audioTransportFadeEnabled: true,
      audioTransportFadeCurve: 'linear',
    };
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      transportFadeDurationMs: 20,
      transportFadeStepMs: 10,
      transportFadeWait: fadeWait,
    });

    await session.setOutput({ volume: 0.7 });
    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 18.25;
    await session.pause();
    await Promise.resolve();
    await Promise.resolve();
    fadeWait.mockClear();

    const status = await session.play();

    const resumeFadeCalls = bridges[1].setVolume.mock.calls.map(([volume]) => volume);
    expect(status.state).toBe('playing');
    expect(status.volume).toBe(0.7);
    expect(resumeFadeCalls[0]).toBe(0);
    expect(resumeFadeCalls.at(-1)).toBeCloseTo(0.7);
    expect(resumeFadeCalls).toHaveLength(4);
    expect(fadeWait).toHaveBeenCalledTimes(2);
  });

  it('pause keeps resident exclusive output open and play resumes through the same host', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'exclusive' } });
    bridges[0].positionSeconds = 14.5;
    const pausedStatus = await session.pause();
    const resumedStatus = await session.play();

    expect(pausedStatus.state).toBe('paused');
    expect(pausedStatus.host).toBe('ready');
    expect(resumedStatus.state).toBe('playing');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].sessionBegins).toBe(2);
    expect(bridges[0].sessionEnds).toBeGreaterThanOrEqual(1);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ startSeconds: 14.5 });
  });

  it('prewarms HTTP stream decoders from the paused position while resident exclusive output stays open paused', async () => {
    const streamUrl = 'https://cdn.example.test/exclusive-song.flac';
    const decoder = new class extends FakeDecoder {
      private resumeReady: (() => void) | null = null;

      override decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
        this.decodeRequests.push(request);
        const stream = new PassThrough();
        const stop = vi.fn(() => {
          stream.destroy();
        });

        if (this.decodeRequests.length === 1) {
          queueMicrotask(() => {
            if (!stream.destroyed) {
              stream.write(pcmBuffer([0, 0]));
            }
          });
          return { stream, stop, ready: Promise.resolve(), done: new Promise(() => undefined) };
        }

        return {
          stream,
          stop,
          ready: new Promise<void>((resolve) => {
            this.resumeReady = () => {
              stream.write(pcmBuffer([0, 0]));
              resolve();
              this.resumeReady = null;
            };
          }),
          done: new Promise(() => undefined),
        };
      }

      releaseResumeReady(): void {
        if (!this.resumeReady) {
          throw new Error('exclusive resume decoder ready was not pending');
        }
        this.resumeReady();
      }

      hasResumeReady(): boolean {
        return this.resumeReady !== null;
      }
    }(new Map([[streamUrl, probe(streamUrl, 44100)]]));
    const bridges: FakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge(44100);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
    });

    await session.playLocalFile({
      filePath: streamUrl,
      trackId: 'streaming:netease:exclusive-track',
      output: { outputMode: 'exclusive' },
      probe: probe(streamUrl, 44100),
    });
    bridges[0].positionSeconds = 9.75;
    const pausedStatus = await session.pause();

    expect(pausedStatus).toMatchObject({ state: 'paused', host: 'ready', positionSeconds: 9.75 });
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    await expect.poll(() => decoder.decodeRequests.length).toBe(2);
    expect(decoder.hasResumeReady()).toBe(true);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: streamUrl, startSeconds: 9.75 });

    const resumedPromise = session.play();
    await Promise.resolve();
    expect(decoder.hasResumeReady()).toBe(true);
    await expect(resumedPromise).resolves.toMatchObject({ state: 'playing', currentTrackId: 'streaming:netease:exclusive-track' });
    decoder.releaseResumeReady();
    expect(bridges).toHaveLength(1);
    expect(bridges[0].sessionBegins).toBe(2);
    expect(decoder.decodeRequests).toHaveLength(2);
  });

  it('release-exclusive-on-pause stops resident exclusive output and reopens it on resume', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const firstBridge = new GracefulFakeBridge(44100);
    const resumedBridge = new GracefulFakeBridge(44100);
    const bridges = [firstBridge, resumedBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as GracefulFakeBridge,
      logger: noopLogger,
    });

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive', releaseExclusiveOnPauseExperimentalEnabled: true },
    });
    firstBridge.positionSeconds = 14.5;

    const pausedStatus = await session.pause();
    const resumedStatus = await session.play();

    expect(pausedStatus.state).toBe('paused');
    expect(pausedStatus.host).toBe('not-initialized');
    expect(pausedStatus.positionSeconds).toBe(14.5);
    expect(pausedStatus.warnings).toContain('exclusive_released_on_pause');
    expect(firstBridge.sessionEnds).toBeGreaterThanOrEqual(1);
    expect(firstBridge.stopGracefully).toHaveBeenCalledWith('release-exclusive-on-pause', 1500, true);
    expect(resumedStatus.state).toBe('playing');
    expect(resumedBridge.startOptions).toMatchObject({
      exclusive: true,
      startSeconds: 14.5,
    });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ startSeconds: 14.5 });
  });

  it('falls back to shared when exclusive resume after pause release cannot reclaim the device', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const firstBridge = new GracefulFakeBridge(44100);
    const refusedExclusiveBridges = [
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: exclusive_denied'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: exclusive_denied'),
      new ConfigurableStartupFailingBridge('WASAPI exclusive open failed: exclusive_denied'),
    ];
    const sharedBridge = new FakeBridge(48000);
    const bridges = [firstBridge, ...refusedExclusiveBridges, sharedBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as unknown as FakeBridge,
      logger: noopLogger,
    });

    await session.playLocalFile({
      filePath: 'song.flac',
      output: {
        outputMode: 'exclusive',
        releaseExclusiveOnPauseExperimentalEnabled: true,
        exclusiveInstabilityFallbackEnabled: true,
      },
    });
    firstBridge.positionSeconds = 22.25;
    await session.pause();

    const resumedStatus = await session.play();

    expect(resumedStatus.state).toBe('playing');
    expect(resumedStatus.outputMode).toBe('shared');
    expect(resumedStatus.warnings).toContain('exclusive_output_fell_back_to_shared');
    expect(resumedStatus.warnings).toContain('exclusive_resume_fell_back_to_shared');
    expect(refusedExclusiveBridges.map((bridge) => bridge.startOptions)).toEqual([
      expect.objectContaining({ exclusive: true, startSeconds: 22.25 }),
      expect.objectContaining({ exclusive: true, startSeconds: 22.25 }),
      expect.objectContaining({ exclusive: true, startSeconds: 22.25 }),
    ]);
    expect(sharedBridge.startOptions).toMatchObject({ exclusive: false, startSeconds: 22.25 });
  });

  it('does not resume from a paused prewarm bridge before its actual sample rate is ready', async () => {
    const decoder = new FakeDecoder(new Map([['song.flac', probe('song.flac', 192000)]]));
    const initialBridge = new FakeBridge(48000);
    const delayedPrewarmBridge = new DelayedReadyBridge(48000);
    const resumedBridge = new FakeBridge(48000);
    const bridges = [initialBridge, delayedPrewarmBridge, resumedBridge];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridges.shift() as FakeBridge,
      logger: noopLogger,
    });

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    initialBridge.positionSeconds = 18.25;
    await session.pause();
    await delayedPrewarmBridge.started;

    const status = await session.play();
    delayedPrewarmBridge.releaseReady();

    expect(status.state).toBe('playing');
    expect(delayedPrewarmBridge.stop).toHaveBeenCalledTimes(1);
    expect(resumedBridge.startOptions).toMatchObject({ startSeconds: 18.25 });
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      startSeconds: 18.25,
      decoderOutputSampleRate: 48000,
    });
    expect(decoder.decodeRequests.some((request) => request.decoderOutputSampleRate === 192000)).toBe(false);
  });

  it('seek while paused moves the stored position without starting playback', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 7;
    await session.pause();
    const pausedStatus = await session.seek(33);

    expect(pausedStatus.state).toBe('paused');
    expect(pausedStatus.positionSeconds).toBe(33);
    expect(bridges).toHaveLength(3);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges[1].stop).toHaveBeenCalledTimes(1);
    expect(bridges[2].startOptions).toMatchObject({ startSeconds: 33 });

    await Promise.resolve();
    await Promise.resolve();
    await session.play();
    expect(bridges).toHaveLength(3);
    expect(session.getStatus().positionSeconds).toBe(33);
  });

  it('seek while playing reuses the active output host', async () => {
    const { bridges, decoder, session } = createLongRunningSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12;
    const status = await session.seek(42);

    expect(status.state).toBe('playing');
    expect(status.positionSeconds).toBe(42);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(decoder.decodeRequests.at(-1)).toMatchObject({
      filePath: 'song.flac',
      startSeconds: 42,
    });
  });

  it('changing volume while playing updates status without restarting output', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 21.75;
    const status = await session.setOutput({ volume: 0.35 });

    expect(status.state).toBe('playing');
    expect(status.volume).toBe(0.35);
    expect(status.positionSeconds).toBe(21.75);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(bridges[0].setVolume).toHaveBeenCalledWith(0.35);
  });
  it('changing playback speed while playing updates the active pipeline without restarting output', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 21.75;
    const status = await session.setOutput({ playbackRate: 1.2, playbackSpeedMode: 'nightcore' });

    expect(status.state).toBe('playing');
    expect(status.playbackRate).toBe(1.2);
    expect(status.playbackSpeedMode).toBe('nightcore');
    expect(status.positionSeconds).toBe(21.75);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(decoder.decodeRequests).toHaveLength(1);
  });

  it('does not report a position jump immediately after changing playback speed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));
    const reportAudioError = vi.fn();
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [44100], [], {
      disableWatchdogTimer: true,
      reportAudioError,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-speed', output: { outputMode: 'shared' } });
      await vi.advanceTimersByTimeAsync(3000);
      bridges[0].emit('position', 12 * 44100, {
        positionFrames: 12 * 44100,
        bufferedFrames: 4410,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });

      await session.setOutput({ playbackRate: 1.2, playbackSpeedMode: 'nightcore' });
      bridges[0].emit('position', 60 * 44100, {
        positionFrames: 60 * 44100,
        bufferedFrames: 4410,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      await Promise.resolve();

      expect(reportAudioError).not.toHaveBeenCalledWith(expect.objectContaining({
        message: 'unexpected_playback_position_jump',
      }));
      expect(session.getStatus().warnings).not.toContain('unexpected_playback_position_jump_detected');
      expect(session.getStatus().warnings).not.toContain('unexpected_playback_position_jump_rebased');
      expect(bridges).toHaveLength(1);
      expect(bridges[0].stop).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('restoring the same shared output while playing does not restart at the current position', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 48000)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: {
        outputMode: 'shared',
        deviceIndex: 6,
        deviceName: 'TEAC USB AUDIO DEVICE',
        sharedBackend: 'windows',
      },
    });
    bridges[0].positionSeconds = 4.25;
    const status = await session.setOutput({
      outputMode: 'shared',
      deviceIndex: 6,
      deviceName: 'TEAC USB AUDIO DEVICE',
      sharedBackend: 'windows',
    });

    expect(status.state).toBe('playing');
    expect(status.positionSeconds).toBe(4.25);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stop).not.toHaveBeenCalled();
    expect(decoder.decodeRequests).toHaveLength(1);
  });

  it('switching output while playing restarts the current file on the new device', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', deviceIndex: 0, deviceName: 'TEAC USB AUDIO DEVICE' },
    });
    bridges[0].positionSeconds = 21.75;
    const status = await session.setOutput({
      outputMode: 'shared',
      deviceIndex: 5,
      deviceName: 'Mi Monitor (NVIDIA High Definition Audio)',
    });

    expect(status.state).toBe('playing');
    expect(status.outputDeviceId).toBe('shared:5');
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({
      startSeconds: 21.75,
      deviceIndex: 5,
      deviceName: 'Mi Monitor (NVIDIA High Definition Audio)',
    });
    expect(decoder.probeRequests).toEqual(['song.flac']);
  });

  it('switching exclusive devices stops the resident bridge and opens the new device', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive', deviceIndex: 0, deviceName: 'TEAC USB AUDIO DEVICE' },
    });
    bridges[0].positionSeconds = 12.25;
    const status = await session.setOutput({
      outputMode: 'exclusive',
      deviceIndex: 1,
      deviceName: 'RME ADI-2 DAC',
    });

    expect(status.state).toBe('playing');
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({
      exclusive: true,
      deviceIndex: 1,
      deviceName: 'RME ADI-2 DAC',
      startSeconds: 12.25,
    });
  });

  it('switching output while paused updates the resume target without starting playback', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', deviceIndex: 0, deviceName: 'TEAC USB AUDIO DEVICE' },
    });
    bridges[0].positionSeconds = 9;
    await session.pause();
    const pausedStatus = await session.setOutput({
      outputMode: 'shared',
      deviceIndex: 5,
      deviceName: 'Mi Monitor (NVIDIA High Definition Audio)',
    });

    expect(pausedStatus.state).toBe('paused');
    expect(pausedStatus.outputDeviceId).toBe('shared:5');
    expect(bridges).toHaveLength(2);
    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges[1].stop).toHaveBeenCalledTimes(1);

    await session.play();
    expect(bridges).toHaveLength(3);
    expect(bridges[2].startOptions).toMatchObject({
      startSeconds: 9,
      deviceIndex: 5,
      deviceName: 'Mi Monitor (NVIDIA High Definition Audio)',
    });
  });
});

describe('AudioSession playback watchdog', () => {
  it('throttles native telemetry status events while preserving immediate pause status', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T00:00:00.000Z'));
    const { bridges, session } = createLongRunningSessionHarness([probe('music.flac', 48_000)], [48_000], [], {
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'music.flac' });
      const statuses: unknown[] = [];
      session.on('status', (status) => statuses.push(status));

      bridges[0].emit('position', 480, {
        positionFrames: 480,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      bridges[0].emit('position', 960, {
        positionFrames: 960,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });

      expect(statuses).toHaveLength(1);

      vi.advanceTimersByTime(999);
      bridges[0].emit('position', 1440, {
        positionFrames: 1440,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      expect(statuses).toHaveLength(1);

      vi.advanceTimersByTime(1);
      bridges[0].emit('position', 1920, {
        positionFrames: 1920,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      expect(statuses).toHaveLength(2);

      await session.pause();
      expect(statuses).toHaveLength(3);
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('does not recover while playing position advances', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 10;
    await session.checkPlaybackWatchdog();
    bridges[0].positionSeconds = 11;
    await session.checkPlaybackWatchdog();

    expect(bridges).toHaveLength(1);
    expect(session.getDiagnostics().recentWatchdogRecoveryCount).toBe(0);
  });

  it('does not restart on startup position reports inside the discontinuity guard', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'));
    const reportAudioError = vi.fn();
    const longProbe = {
      ...probe('song.flac', 48000),
      durationSeconds: 120,
    };
    const { bridges, decoder, session } = createLongRunningSessionHarness([longProbe], [48000], [], {
      disableWatchdogTimer: true,
      reportAudioError,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });

      vi.advanceTimersByTime(1000);
      bridges[0].emit('position', 48000, {
        positionFrames: 48000,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      vi.advanceTimersByTime(200);
      bridges[0].emit('position', 6 * 48000, {
        positionFrames: 6 * 48000,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(reportAudioError).not.toHaveBeenCalled();
      expect(bridges.reduce((total, bridge) => total + bridge.sessionBegins, 0)).toBe(1);
      expect(decoder.decodeRequests).toHaveLength(1);
      const status = session.getStatus();
      expect(status.positionSeconds).toBeGreaterThanOrEqual(1.1);
      expect(status.positionSeconds).toBeLessThanOrEqual(1.3);
      expect(status.warnings).not.toContain('unexpected_playback_position_jump_recovered');
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('rebases a stale first native position report during startup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'));
    const reportAudioError = vi.fn();
    const longProbe = {
      ...probe('song.flac', 48000),
      durationSeconds: 120,
    };
    const { bridges, decoder, session } = createLongRunningSessionHarness([longProbe], [48000], [], {
      disableWatchdogTimer: true,
      reportAudioError,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });

      vi.advanceTimersByTime(200);
      bridges[0].emit('position', 8 * 48000, {
        positionFrames: 8 * 48000,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(reportAudioError).not.toHaveBeenCalled();
      expect(bridges.reduce((total, bridge) => total + bridge.sessionBegins, 0)).toBe(1);
      expect(decoder.decodeRequests).toHaveLength(1);
      const status = session.getStatus();
      expect(status.positionSeconds).toBeGreaterThanOrEqual(0);
      expect(status.positionSeconds).toBeLessThanOrEqual(0.1);
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'position_jump_suspected',
        reason: 'guarded_position_jump_ignored',
        details: expect.objectContaining({
          firstPositionSample: true,
          reportedPositionSeconds: 8,
        }),
      });
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('does not expose a stale first native position through status polling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'));
    const reportAudioError = vi.fn();
    const longProbe = {
      ...probe('song.flac', 48000),
      durationSeconds: 120,
    };
    const decoder = new PcmChunkDecoder(new Map([[longProbe.filePath, longProbe]]), [pcmBuffer([0, 0, 0, 0])]);
    class PrePlayingPositionBridge extends FakeBridge {
      override beginSession(options: Parameters<FakeBridge['beginSession']>[0] = {}): number {
        const sessionId = super.beginSession(options);
        this.positionSeconds = 4.75;
        this.emit('position', 4.75 * 48000, {
          positionFrames: 4.75 * 48000,
          bufferedFrames: 4800,
          underrunCallbacks: 0,
          underrunFrames: 0,
        });
        return sessionId;
      }
    }
    const bridges: PrePlayingPositionBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      createBridge: () => {
        const bridge = new PrePlayingPositionBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
      reportAudioError,
    });

    try {
      const status = await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });

      expect(reportAudioError).not.toHaveBeenCalled();
      expect(bridges.reduce((total, bridge) => total + bridge.sessionBegins, 0)).toBe(1);
      expect(decoder.decodeRequests).toHaveLength(1);
      expect(status.positionSeconds).toBeGreaterThanOrEqual(0);
      expect(status.positionSeconds).toBeLessThanOrEqual(0.1);
      expect(bridges[0].positionSeconds).toBeLessThanOrEqual(0.1);
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'position_jump_suspected',
        reason: 'guarded_position_jump_ignored',
        details: expect.objectContaining({
          firstPositionSample: true,
          reportedPositionSeconds: 4.75,
        }),
      });
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('guards the first playing status when the native clock starts ahead before the first position event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'));
    const reportAudioError = vi.fn();
    const longProbe = {
      ...probe('song.flac', 48000),
      durationSeconds: 120,
    };
    const decoder = new PcmChunkDecoder(new Map([[longProbe.filePath, longProbe]]), [pcmBuffer([0, 0, 0, 0])]);
    class AheadStartupClockBridge extends FakeBridge {
      override beginSession(options: Parameters<FakeBridge['beginSession']>[0] = {}): number {
        const sessionId = super.beginSession(options);
        this.positionSeconds = 4.25;
        return sessionId;
      }
    }
    const bridges: AheadStartupClockBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      createBridge: () => {
        const bridge = new AheadStartupClockBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
      reportAudioError,
    });

    try {
      const status = await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });

      expect(reportAudioError).not.toHaveBeenCalled();
      expect(status.positionSeconds).toBeGreaterThanOrEqual(0);
      expect(status.positionSeconds).toBeLessThanOrEqual(0.1);
      expect(bridges[0].positionSeconds).toBeLessThanOrEqual(0.1);
      expect(decoder.decodeRequests).toHaveLength(1);
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('does not inherit the previous track position when the reused native bridge reports a stale first position', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'));
    const firstProbe = {
      ...probe('first.flac', 48000),
      durationSeconds: 240,
    };
    const secondProbe = {
      ...probe('second.flac', 48000),
      durationSeconds: 240,
    };
    const { bridges, decoder, session } = createLongRunningSessionHarness([firstProbe, secondProbe], [48000], [], {
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({ filePath: 'first.flac', trackId: 'track-a', output: { outputMode: 'shared' } });
      vi.advanceTimersByTime(120_000);
      bridges[0].positionSeconds = 120;
      expect(session.getStatus().positionSeconds).toBeGreaterThanOrEqual(120);

      await session.playLocalFile({ filePath: 'second.flac', trackId: 'track-b', output: { outputMode: 'shared' } });
      vi.advanceTimersByTime(200);
      bridges[0].emit('position', 120 * 48000, {
        positionFrames: 120 * 48000,
        bufferedFrames: 4800,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(bridges).toHaveLength(1);
      expect(bridges[0].sessionBegins).toBe(2);
      expect(decoder.decodeRequests.at(-1)).toMatchObject({
        filePath: 'second.flac',
        startSeconds: 0,
      });
      const status = session.getStatus();
      expect(status.currentTrackId).toBe('track-b');
      expect(status.positionSeconds).toBeGreaterThanOrEqual(0);
      expect(status.positionSeconds).toBeLessThanOrEqual(0.1);
      expect(session.getDiagnostics().recentPlaybackEvents?.at(-1)).toMatchObject({
        kind: 'position_jump_suspected',
        trackId: 'track-b',
        reason: 'guarded_position_jump_ignored',
        details: expect.objectContaining({
          firstPositionSample: true,
          reportedPositionSeconds: 120,
        }),
      });
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('recovers stuck native output while playing', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });

    await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 15.5;
    await session.checkPlaybackWatchdog();
    await session.checkPlaybackWatchdog();

    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: 'song.flac', startSeconds: 15.5 });
    expect(session.getStatus().warnings).toContain('audio_watchdog_recovered_native_output:1');
    expect(session.getDiagnostics().recentWatchdogRecoveryCount).toBe(1);
  });

  it('surfaces watchdog checker failures through normal audio errors', async () => {
    const reportAudioError = vi.fn();
    const bridge = new ThrowingPositionBridge();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      reportAudioError,
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });

    try {
      await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
      bridge.failPositionReads = true;
      await expect(session.checkPlaybackWatchdog()).resolves.toBeUndefined();

      expect(session.getStatus().state).toBe('error');
      expect(session.getStatus().error).toBe('position read failed');
      expect(reportAudioError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'position read failed',
        severity: 'fatal',
      }));
    } finally {
      session.dispose();
    }
  });
  it('ignores direct superseded playback cancellation errors', () => {
    const reportAudioError = vi.fn();
    const { session } = createSessionHarness([], [], [], {
      reportAudioError,
    });

    (session as unknown as { handleError(error: Error): void }).handleError(new Error('audio_session_run_cancelled'));

    const status = session.getStatus();
    expect(status.state).not.toBe('error');
    expect(status.error).toBeNull();
    expect(reportAudioError).not.toHaveBeenCalled();
  });

  it('recovers immediately when the native host reports a session disconnect', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 10,
    });

    await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 12.25;
    bridges[0].emit('device-event', {
      event: 'audio_session_disconnected',
      reason: 'exclusive_mode_override',
      currentDevice: true,
      followsDefaultDevice: false,
    } satisfies NativeHostNotificationEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: 'song.flac', startSeconds: 12.25 });
    expect(session.getStatus().warnings).toContain('native_session_disconnected:exclusive_mode_override');
    expect(session.getStatus().warnings).toContain('shared_stability_recovered:1');
  });

  it('does not restart live AirPlay PCM streams through the file decoder during recovery or seek', async () => {
    const decoder = new FakeDecoder(new Map());
    const bridge = new FakeBridge();
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
      watchdogStallChecks: 10,
    });
    const stream = new PassThrough();

    try {
      await session.playPcmStream({
        stream,
        sourceId: 'airplay-receiver:test-session',
        trackId: 'airplay-receiver:test-session',
        sampleRate: 44100,
        channels: 2,
        output: { outputMode: 'shared' },
      });
      bridge.positionSeconds = 7.125;
      bridge.emit('device-event', {
        event: 'audio_session_disconnected',
        reason: 'device_invalidated',
        currentDevice: true,
        followsDefaultDevice: false,
      } satisfies NativeHostNotificationEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(decoder.decodeRequests).toHaveLength(0);
      expect(session.getStatus().state).toBe('playing');
      expect(session.getStatus().error).toBeNull();
      expect(session.getStatus().warnings).toContain('live_pcm_restart_skipped');

      await session.seek(12);

      expect(decoder.decodeRequests).toHaveLength(0);
      expect(session.getStatus().warnings).toContain('live_pcm_seek_skipped');
    } finally {
      stream.destroy();
      session.dispose();
    }
  });

  it('serializes burst native host notifications into a single recovery', async () => {
    const { bridges, decoder, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 10,
    });

    await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 18.5;
    bridges[0].emit('device-event', {
      event: 'device_removed',
      reason: 'removed',
      currentDevice: true,
      followsDefaultDevice: false,
    } satisfies NativeHostNotificationEvent);
    bridges[0].emit('device-event', {
      event: 'default_device_changed',
      reason: 'default_changed',
      currentDevice: true,
      followsDefaultDevice: true,
    } satisfies NativeHostNotificationEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(decoder.decodeRequests.at(-1)).toMatchObject({ filePath: 'song.flac', startSeconds: 18.5 });
    expect(session.getStatus().warnings).toContain('audio_device_removed');
  });

  it('aborts stale native host notification recovery when playback changes while stopping the old host', async () => {
    let resolveStop = (): void => undefined;
    const decoder = new FakeDecoder(new Map([
      ['first.flac', probe('first.flac', 44100)],
      ['second.flac', probe('second.flac', 44100)],
    ]));
    const firstBridge = new GracefulFakeBridge();
    firstBridge.stopGracefully.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveStop = () => resolve(undefined);
    }));
    const bridges: GracefulFakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = bridges.length === 0 ? firstBridge : new GracefulFakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'first.flac', trackId: 'first', output: { outputMode: 'shared' } });
    firstBridge.positionSeconds = 7.25;
    firstBridge.emit('device-event', {
      event: 'audio_session_disconnected',
      reason: 'device_invalidated',
      currentDevice: true,
    } satisfies NativeHostNotificationEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstBridge.stopGracefully).toHaveBeenCalledWith('replace-output', 750, true);
    expect((session as unknown as { bridge: unknown }).bridge).toBeNull();

    const secondPlay = session.playLocalFile({
      filePath: 'second.flac',
      trackId: 'second',
      output: { outputMode: 'shared' },
    });
    await Promise.resolve();
    expect(bridges).toHaveLength(1);

    resolveStop();
    await expect(secondPlay).resolves.toMatchObject({ currentTrackId: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges).toHaveLength(2);
    expect(session.getStatus().currentTrackId).toBe('second');
    expect(session.getStatus().error).toBeNull();
  });

  it('does not recover while paused, loading, or ended', async () => {
    const pausedHarness = createSessionHarness([probe('paused.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });
    await pausedHarness.session.playLocalFile({ filePath: 'paused.flac', output: { outputMode: 'shared' } });
    pausedHarness.bridges[0].positionSeconds = 5;
    await pausedHarness.session.pause();
    await pausedHarness.session.checkPlaybackWatchdog();
    await pausedHarness.session.checkPlaybackWatchdog();
    expect(pausedHarness.bridges).toHaveLength(2);

    const pendingDecoder = new PendingProbeDecoder(new Map());
    const loadingBridges: FakeBridge[] = [];
    const loadingSession = createAudioSessionForTest({
      decoder: pendingDecoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new FakeBridge();
        loadingBridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });
    const loadingPlay = loadingSession.playLocalFile({ filePath: 'loading.flac', output: { outputMode: 'shared' } });
    await Promise.resolve();
    expect(loadingSession.getStatus().state).toBe('loading');
    await loadingSession.checkPlaybackWatchdog();
    await loadingSession.checkPlaybackWatchdog();
    expect(loadingBridges).toHaveLength(0);
    pendingDecoder.finishProbe(probe('loading.flac', 44100));
    await loadingPlay;

    const endedHarness = createSessionHarness([probe('ended.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
    });
    await endedHarness.session.playLocalFile({ filePath: 'ended.flac', output: { outputMode: 'shared' } });
    endedHarness.bridges[0].positionSeconds = 120;
    endedHarness.bridges[0].emit('ended');
    await endedHarness.session.checkPlaybackWatchdog();
    await endedHarness.session.checkPlaybackWatchdog();
    expect(endedHarness.bridges).toHaveLength(1);
  });

  it('limits shared stability recovery without entering an error loop', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)], [], [], {
      disableWatchdogTimer: true,
      watchdogStallChecks: 1,
      watchdogMaxRecoveriesPerTrack: 1,
    });

    await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
    bridges[0].positionSeconds = 9;
    await session.checkPlaybackWatchdog();
    await session.checkPlaybackWatchdog();
    bridges[1].positionSeconds = 9;
    await session.checkPlaybackWatchdog();
    await session.checkPlaybackWatchdog();

    const status = session.getStatus();
    expect(status.state).toBe('playing');
    expect(status.error).toBeNull();
    expect(status.warnings).toContain('shared_stability_recovery_limited');
    expect(status.warnings).not.toContain('shared_output_recovered_directsound_backend');
    expect(bridges).toHaveLength(2);
  });

  it('starts shared output with the stable-first anti-stutter profile by default', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });

    expect(bridges[0].startOptions).toMatchObject({
      bufferSizeFrames: 4096,
      fifoCapacityMs: 750,
      startupPrebufferMs: 180,
      startupPrebufferTimeoutMs: 650,
      latencyProfile: 'balanced',
    });
  });

  it('uses a conservative low-latency profile only when shared output explicitly requests it', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 44100)]);

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'shared', latencyProfile: 'lowLatency' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      bufferSizeFrames: 2048,
      fifoCapacityMs: 420,
      startupPrebufferMs: 120,
      startupPrebufferTimeoutMs: 450,
      latencyProfile: 'lowLatency',
    });
  });

  it('upgrades shared stability after repeated native underruns', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 48000)], [], [], {
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac', trackId: 'track-1', output: { outputMode: 'shared' } });
    bridges[0].emit('position', 48000, {
      positionFrames: 48000,
      bufferedFrames: 0,
      underrunCallbacks: 0,
      underrunFrames: 0,
    });
    bridges[0].emit('position', 48512, {
      positionFrames: 48512,
      bufferedFrames: 0,
      underrunCallbacks: 3,
      underrunFrames: 4800,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges[0].stop).toHaveBeenCalledTimes(1);
    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      fifoCapacityMs: 1200,
      startupPrebufferMs: 240,
    });
    expect(session.getStatus().sharedStabilityTier).toBe('recovery');
    expect(session.getStatus().warnings).toContain('shared_output_underrun_detected');
    expect(session.getStatus().warnings).toContain('shared_stability_recovered:1');
    expect(session.getStatus().warnings).toContain('native_output_buffer_recovered:8192 frames');
  });

  it('uses stable semantics instead of low latency for shared emergency recovery', async () => {
    const { bridges, session } = createSessionHarness([probe('song.flac', 48000)], [], [], {
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({
      filePath: 'song.flac',
      trackId: 'track-1',
      output: { outputMode: 'shared', latencyProfile: 'lowLatency' },
    });

    expect(bridges[0].startOptions).toMatchObject({
      bufferSizeFrames: 2048,
      fifoCapacityMs: 420,
      startupPrebufferMs: 120,
      startupPrebufferTimeoutMs: 450,
      latencyProfile: 'lowLatency',
    });

    for (const [index, expected] of [
      { bufferSizeFrames: 8192, fifoCapacityMs: 1200, startupPrebufferMs: 240, latencyProfile: 'balanced' as const },
      { bufferSizeFrames: 8192, fifoCapacityMs: 1500, startupPrebufferMs: 300, latencyProfile: 'stable' as const },
    ].entries()) {
      bridges[index].emit('position', 48000 + index * 1000, {
        positionFrames: 48000 + index * 1000,
        bufferedFrames: 0,
        underrunCallbacks: index * 3,
        underrunFrames: index * 4800,
      });
      bridges[index].emit('position', 48512 + index * 1000, {
        positionFrames: 48512 + index * 1000,
        bufferedFrames: 0,
        underrunCallbacks: (index + 1) * 3,
        underrunFrames: (index + 1) * 4800,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridges[index + 1].startOptions).toMatchObject(expected);
    }

    expect(bridges[2].startOptions?.latencyProfile).not.toBe('lowLatency');
    expect(session.getStatus().sharedStabilityTier).toBe('emergency');
    expect(session.getStatus().warnings).toContain('shared_stability_recovered:2');
    expect(session.getStatus().warnings).toContain('native_output_buffer_recovered:stable');
  });

  it('keeps an unstable shared low-latency device on the remembered recovery profile', async () => {
    const { bridges, session } = createSessionHarness([
      probe('first.flac', 48000),
      probe('second.flac', 48000),
    ], [], [], {
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({
      filePath: 'first.flac',
      trackId: 'track-1',
      output: { outputMode: 'shared', latencyProfile: 'lowLatency' },
    });
    bridges[0].emit('position', 48000, {
      positionFrames: 48000,
      bufferedFrames: 0,
      underrunCallbacks: 0,
      underrunFrames: 0,
    });
    bridges[0].emit('position', 48512, {
      positionFrames: 48512,
      bufferedFrames: 0,
      underrunCallbacks: 3,
      underrunFrames: 4800,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridges[1].startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      fifoCapacityMs: 1200,
      startupPrebufferMs: 240,
      latencyProfile: 'balanced',
    });

    await session.playLocalFile({
      filePath: 'second.flac',
      trackId: 'track-2',
      output: { outputMode: 'shared', latencyProfile: 'lowLatency' },
    });

    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({
      bufferSizeFrames: 8192,
      fifoCapacityMs: 1200,
      startupPrebufferMs: 240,
      latencyProfile: 'balanced',
    });
    expect(session.getStatus().warnings).toContain('low_latency_buffer_ignored');
    expect(session.getStatus().sharedStabilityTier).toBe('recovery');
  });

  it('does not fall back from exclusive output during startup underrun grace', async () => {
    const exclusiveProbe = { ...probe('exclusive.flac', 48000), bitDepth: 16 };
    const decoder = new FakeDecoder(new Map([['exclusive.flac', exclusiveProbe]]));
    const bridges: FakeBridge[] = [];
    const readyBridges = [new FakeBridge(48000, { format: 'pcm16' }), new FakeBridge(48000)];
    let bridgeIndex = 0;
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = readyBridges[bridgeIndex++] ?? new FakeBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      await session.playLocalFile({ filePath: 'exclusive.flac', trackId: 'track-exclusive', output: { outputMode: 'exclusive' } });
      bridges[0].emit('position', 48000, {
        positionFrames: 48000,
        bufferedFrames: 0,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      now += 4_000;
      bridges[0].emit('position', 192000, {
        positionFrames: 192000,
        bufferedFrames: 0,
        underrunCallbacks: 3,
        underrunFrames: 512,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridges[0].stop).not.toHaveBeenCalled();
      expect(bridges).toHaveLength(1);
      expect(session.getStatus().outputMode).toBe('exclusive');
      expect(session.getStatus().warnings).not.toContain('exclusive_output_unstable');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('does not fall back from exclusive output for small underrun bursts after startup grace', async () => {
    const exclusiveProbe = { ...probe('exclusive.flac', 48000), bitDepth: 16 };
    const decoder = new FakeDecoder(new Map([['exclusive.flac', exclusiveProbe]]));
    const bridges: FakeBridge[] = [];
    const readyBridges = [new FakeBridge(48000, { format: 'pcm16' }), new FakeBridge(48000)];
    let bridgeIndex = 0;
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = readyBridges[bridgeIndex++] ?? new FakeBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      await session.playLocalFile({ filePath: 'exclusive.flac', trackId: 'track-exclusive', output: { outputMode: 'exclusive' } });
      now += 12_000;
      bridges[0].emit('position', 576000, {
        positionFrames: 576000,
        bufferedFrames: 0,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      now += 1;
      bridges[0].emit('position', 576512, {
        positionFrames: 576512,
        bufferedFrames: 0,
        underrunCallbacks: 3,
        underrunFrames: 512,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridges[0].stop).not.toHaveBeenCalled();
      expect(bridges).toHaveLength(1);
      expect(session.getStatus().outputMode).toBe('exclusive');
      expect(session.getStatus().warnings).not.toContain('exclusive_output_unstable');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('recovers unstable exclusive output in the same mode with a larger buffer', async () => {
    const exclusiveProbe = { ...probe('exclusive.flac', 48000), bitDepth: 16 };
    const decoder = new FakeDecoder(new Map([['exclusive.flac', exclusiveProbe]]));
    const bridges: FakeBridge[] = [];
    const readyBridges = [new FakeBridge(48000, { format: 'pcm16' }), new FakeBridge(48000)];
    let bridgeIndex = 0;
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = readyBridges[bridgeIndex++] ?? new FakeBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      await session.playLocalFile({ filePath: 'exclusive.flac', trackId: 'track-exclusive', output: { outputMode: 'exclusive' } });
      now += 8_001;
      bridges[0].emit('position', 432000, {
        positionFrames: 432000,
        bufferedFrames: 0,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      now += 1;
      bridges[0].emit('position', 432512, {
        positionFrames: 432512,
        bufferedFrames: 0,
        underrunCallbacks: 3,
        underrunFrames: 4800,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridges[0].stop).toHaveBeenCalledTimes(1);
      expect(bridges).toHaveLength(2);
      expect(bridges[1].startOptions).toMatchObject({
        exclusive: true,
          bufferSizeFrames: 4096,
        fifoCapacityMs: 1000,
        startupPrebufferMs: 160,
        startupPrebufferTimeoutMs: 700,
        latencyProfile: 'balanced',
      });
      expect(session.getStatus().outputMode).toBe('exclusive');
      expect(session.getStatus().warnings).toContain('exclusive_output_underrun_detected');
      expect(session.getStatus().warnings).toContain('native_output_stability_recovered:1');
      expect(session.getStatus().warnings).toContain('native_output_buffer_recovered:4096 frames');
      expect(session.getStatus().warnings).not.toContain('exclusive_output_fell_back_to_shared');
      expect(session.getDiagnostics().recentPlaybackEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'watchdog_recovery',
            reason: 'exclusive_output_underrun_detected',
            details: expect.objectContaining({
              adaptiveBufferSizeFrames: 4096,
              adaptiveFifoCapacityMs: 1000,
              adaptiveStartupPrebufferMs: 160,
              adaptiveStartupPrebufferTimeoutMs: 700,
            }),
          }),
        ]),
      );
    } finally {
      dateNow.mockRestore();
    }
  });

  it('does not switch unstable exclusive output to shared during adaptive buffer recovery', async () => {
    const exclusiveProbe = { ...probe('exclusive.flac', 48000), bitDepth: 16 };
    const decoder = new FakeDecoder(new Map([['exclusive.flac', exclusiveProbe]]));
    const bridges: FakeBridge[] = [];
    const readyBridges = [new FakeBridge(48000, { format: 'pcm16' }), new FakeBridge(48000)];
    let bridgeIndex = 0;
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = readyBridges[bridgeIndex++] ?? new FakeBridge(48000);
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      await session.playLocalFile({
        filePath: 'exclusive.flac',
        trackId: 'track-exclusive',
        output: { outputMode: 'exclusive', exclusiveInstabilityFallbackEnabled: true },
      });
      now += 8_001;
      bridges[0].emit('position', 432000, {
        positionFrames: 432000,
        bufferedFrames: 0,
        underrunCallbacks: 0,
        underrunFrames: 0,
      });
      now += 1;
      bridges[0].emit('position', 432512, {
        positionFrames: 432512,
        bufferedFrames: 0,
        underrunCallbacks: 3,
        underrunFrames: 4800,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(bridges[0].stop).toHaveBeenCalledTimes(1);
      expect(bridges).toHaveLength(2);
      expect(bridges[1].startOptions).toMatchObject({
        exclusive: true,
          bufferSizeFrames: 4096,
        fifoCapacityMs: 1000,
        startupPrebufferMs: 160,
        startupPrebufferTimeoutMs: 700,
        latencyProfile: 'balanced',
      });
      expect(bridges[1].startOptions?.startSeconds).toBeCloseTo(432512 / 48000);
      expect(session.getStatus().outputMode).toBe('exclusive');
      expect(session.getStatus().warnings).toContain('exclusive_output_underrun_detected');
      expect(session.getStatus().warnings).toContain('native_output_stability_recovered:1');
      expect(session.getStatus().warnings).toContain('native_output_buffer_recovered:4096 frames');
      expect(session.getStatus().warnings).not.toContain('exclusive_output_fell_back_to_shared');
      const recoveryEvent = session.getDiagnostics().recentPlaybackEvents?.find(
        (event) => event.kind === 'watchdog_recovery' && event.reason === 'exclusive_output_underrun_detected',
      );
      expect(recoveryEvent?.details).toMatchObject({
        recoveryCount: 1,
        targetBuffer: '4096 frames',
        adaptiveBufferSizeFrames: 4096,
        adaptiveFifoCapacityMs: 1000,
        adaptiveStartupPrebufferMs: 160,
        adaptiveStartupPrebufferTimeoutMs: 700,
      });
    } finally {
      dateNow.mockRestore();
    }
  });
});

describe('NativeOutputBridge host arguments', () => {
  it('resolves the ECHO Next electron-app build host before migration fallbacks', () => {
    const exe = process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host';
    const cwd = join('tmp', 'echo-next');
    const nextHost = join(cwd, 'electron-app', 'build', exe);

    const resolved = resolveHostBinary({
      cwd,
      appPath: null,
      resourcesPath: '',
      exists: (candidate) => candidate === nextHost,
      isExecutable: () => true,
    });

    expect(resolved).toBe(nextHost);
  });

  it('skips host candidates that exist but are not executable binaries', () => {
    const exe = process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host';
    const resourcesHost = join('tmp', 'packaged', 'resources', exe);
    const cwd = join('tmp', 'echo-next');
    const nextHost = join(cwd, 'electron-app', 'build', exe);

    const resolved = resolveHostBinary({
      cwd,
      appPath: null,
      resourcesPath: join('tmp', 'packaged', 'resources'),
      exists: (candidate) => candidate === resourcesHost || candidate === nextHost,
      isExecutable: (candidate) => candidate === nextHost,
    });

    expect(resolved).toBe(nextHost);
  });

  it('returns null when the native host is unavailable', () => {
    const resolved = resolveHostBinary({
      cwd: join('tmp', 'empty-echo-next'),
      appPath: null,
      resourcesPath: '',
      exists: () => false,
      includeMigrationFallback: false,
    });

    expect(resolved).toBeNull();
  });

  it('passes device name and index so the host can recover from stale indexes', async () => {
    const spawned: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = (file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawned.push({ file, args });
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      deviceIndex: 6,
      deviceName: 'TEAC USB AUDIO DEVICE',
    });

    expect(spawned[0].args).toEqual(
      expect.arrayContaining(['-device', 'TEAC USB AUDIO DEVICE', '-device-index', '6']),
    );
  });
  it('passes shared FIFO and startup prebuffer host arguments', async () => {
    // Daemon-only: buffer/fifo/prebuffer params are sent via JSON-RPC, not CLI args.
    // The spawn args should contain the daemon transport flags.
    const spawned: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = (file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawned.push({ file, args });
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      bufferSizeFrames: 2048,
      fifoCapacityMs: 750,
      startupPrebufferMs: 120,
      startupPrebufferTimeoutMs: 600,
    });
    bridge.stop();

    expect(spawned[0].args).toEqual(
      expect.arrayContaining(['--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4', '--no-stdin']),
    );
    expect(spawned[0].args).not.toContain('-buffer');
    expect(spawned[0].args).not.toContain('-fifo-ms');
    expect(spawned[0].args).not.toContain('-prebuffer-ms');
  });

  it('passes explicit zero startup prebuffer arguments to the native host', async () => {
    const spawned: Array<{ file: string; args: string[] }> = [];
    const fakeSpawn = (file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawned.push({ file, args });
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      exclusive: true,
      bufferSizeFrames: 512,
      startupPrebufferMs: 0,
      startupPrebufferTimeoutMs: 0,
    });
    bridge.stop();

    expect(spawned[0].args).toEqual(
      expect.arrayContaining(['-exclusive', '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4', '--no-stdin']),
    );
    expect(spawned[0].args).not.toContain('-buffer');
    expect(spawned[0].args).not.toContain('-prebuffer-ms');
  });

  it('treats framed native pos as per-session position when reusing a resident host', async () => {
    const stdoutRef = new PassThrough();
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout: stdoutRef,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdoutRef.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    bridge.beginSession({ startSeconds: 0 });
    stdoutRef.write('{"pos":48000}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(1);
    expect(bridge.getPositionSeconds()).toBeLessThan(1.1);

    bridge.beginSession({ startSeconds: 0 });
    stdoutRef.write('{"pos":24000}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(0.5);
    expect(bridge.getPositionSeconds()).toBeLessThan(0.6);
    bridge.stop();
  });

  it('adds seek start time to per-session framed native pos', async () => {
    const stdoutRef = new PassThrough();
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout: stdoutRef,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdoutRef.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    bridge.beginSession({ startSeconds: 12 });
    stdoutRef.write('{"pos":24000}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(12.5);
    expect(bridge.getPositionSeconds()).toBeLessThan(12.6);
    bridge.stop();
  });

  it('rebases native output clock without resetting host frame position', async () => {
    const stdoutRef = new PassThrough();
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout: stdoutRef,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdoutRef.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    bridge.beginSession({ startSeconds: 0 });
    stdoutRef.write('{"pos":288000}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(6);

    bridge.rebaseOutputClock(1.2);
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(1.2);
    expect(bridge.getPositionSeconds()).toBeLessThan(1.3);

    stdoutRef.write('{"pos":312000}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPositionSeconds()).toBeGreaterThanOrEqual(1.7);
    expect(bridge.getPositionSeconds()).toBeLessThan(1.8);
    bridge.stop();
  });
  it('sanitizes unsafe low-latency buffer arguments at the host boundary', async () => {
    const spawned: string[][] = [];
    const fakeSpawn = (_file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawned.push(args);
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 8192,
    });
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      channels: 2,
      latencyProfile: 'lowLatency',
    })).toBe(true);
    bridge.stop();

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      exclusive: true,
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 8192,
    });
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      channels: 2,
      exclusive: true,
      latencyProfile: 'lowLatency',
      bufferSizeFrames: 2048,
    })).toBe(true);
    bridge.stop();

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      latencyProfile: 'stable',
      bufferSizeFrames: 8192,
    });
    bridge.stop();

    expect(spawned[0]).not.toContain('-buffer');
    expect(spawned[0]).not.toEqual(expect.arrayContaining(['-buffer', '8192']));
    // Daemon-only: buffer/fifo/prebuffer params are sent via JSON-RPC, not CLI args.
    // Exclusive output spawns with -exclusive, not -asio.
    expect(spawned[1]).toEqual(expect.arrayContaining(['-exclusive', '--rpc-stdin-fd', '3']));
    expect(spawned[1]).not.toContain('-buffer');
    expect(spawned[2]).toEqual(expect.arrayContaining(['--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4', '--no-stdin']));
    expect(spawned[2]).not.toContain('-buffer');
  });
  it('accepts legacy WASAPI exclusive ready metadata', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write(
          '{"ready":true,"sampleRate":48000,"backend":"wasapi-exclusive","backendImpl":"legacy-wasapi-exclusive","format":"pcm32","deviceBufferFrames":480,"nativeActualBufferFrames":480}\n',
        );
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    const ready = await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      exclusive: true,
    });

    expect(ready.device.backendImpl).toBe('legacy-wasapi-exclusive');
    expect(ready.device.format).toBe('pcm32');
    expect(ready.device.nativeActualBufferFrames).toBe(480);
    bridge.stop();
  });

  it('accepts legacy WASAPI shared ready metadata', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write(
          '{"ready":true,"sampleRate":48000,"sharedSampleRate":48000,"backend":"wasapi-shared","backendImpl":"legacy-wasapi-shared","format":"float32","deviceBufferFrames":2048,"nativeActualBufferFrames":2048}\n',
        );
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    const ready = await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    expect(ready.device.backendImpl).toBe('legacy-wasapi-shared');
    expect(ready.device.format).toBe('float32');
    expect(ready.device.sharedSampleRate).toBe(48000);
    expect(ready.device.nativeActualBufferFrames).toBe(2048);
    bridge.stop();
  });

  it('allows slow Exclusive host startup to outlive the shared-mode ready timeout', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      setTimeout(() => {
        stdout.write(
          '{"ready":true,"sampleRate":192000,"backend":"wasapi-exclusive","deviceType":"Windows Audio (Exclusive Mode)","deviceName":"TEAC"}\n',
        );
      }, 20);

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      readyTimeoutMs: 5,
      logger: noopLogger,
    });

    const ready = await bridge.start({
      requestedOutputSampleRate: 192000,
      channels: 2,
      exclusive: true,
    });

    expect(ready.actualDeviceSampleRate).toBe(192000);
    bridge.stop();
  });

  it('extrapolates native position after pos events and stops extrapolating after clock reset', async () => {
    const stdoutRef = new PassThrough();
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = stdoutRef;
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":44100}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 44100,
      channels: 2,
      durationSeconds: 1.05,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bridge.getPositionSeconds()).toBe(0);

    stdoutRef.write('{"pos":44100}\n');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const extrapolatedPosition = bridge.getPositionSeconds();
    expect(extrapolatedPosition).toBeGreaterThan(1);
    expect(extrapolatedPosition).toBeLessThanOrEqual(1.05);

    bridge.resetOutputClock(0.5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bridge.getPositionSeconds()).toBeCloseTo(0.5, 2);
    bridge.stop();
  });

  it('daemon mode createSpawnArgs strips audio params when bridge is healthy', () => {
    const host = new NativeOutputBridge({
      hostBinary: '/fake/echo-audio-host',
      platform: 'linux',
    });
    const mockProc = { killed: false, exitCode: null } as unknown as ChildProcessWithoutNullStreams;

    const testable = host as unknown as {
      createSpawnArgs(options: NativeOutputStartOptions): string[];
      proc: ChildProcessWithoutNullStreams | null;
      isDaemonBridgeHealthy: () => boolean;
    };
    testable.proc = mockProc;
    testable.isDaemonBridgeHealthy = () => true;

    const args = testable.createSpawnArgs({
      requestedOutputSampleRate: 48000,
      channels: 2,
      bufferSizeFrames: 512,
      fifoCapacityMs: 100,
      startupPrebufferMs: 50,
      startupPrebufferTimeoutMs: 5000,
    });

    // Audio params must be stripped in daemon mode
    expect(args).not.toContain('-sr');
    expect(args).not.toContain('-ch');
    expect(args).not.toContain('-buffer');
    expect(args).not.toContain('-fifo-ms');
    expect(args).not.toContain('-prebuffer-ms');
    expect(args).not.toContain('-prebuffer-timeout-ms');

    // Daemon mode transport args must be present
    expect(args).toContain('--no-stdin');
    expect(args).toContain('--rpc-stdin-fd');
    expect(args).toContain('--rpc-stdout-fd');

    // Verify fd arguments carry correct values
    const rpcStdinIdx = args.indexOf('--rpc-stdin-fd');
    expect(rpcStdinIdx).toBeGreaterThan(-1);
    expect(args[rpcStdinIdx + 1]).toBe('3');

    const rpcStdoutIdx = args.indexOf('--rpc-stdout-fd');
    expect(rpcStdoutIdx).toBeGreaterThan(-1);
    expect(args[rpcStdoutIdx + 1]).toBe('4');
  });
});

describe('NativeOutputBridge graceful shutdown', () => {
  const createStartedBridge = async () => {
    const writes: Buffer[] = [];
    const stdoutRef = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: stdoutRef,
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcessWithoutNullStreams;
    child.stdin.on('data', (chunk) => writes.push(Buffer.from(chunk)));

    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: vi.fn(() => child) as unknown as HostSpawner,
      logger: noopLogger,
    });

    const started = bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });
    stdoutRef.write('{"ready":true,"sampleRate":48000}\n');
    await started;

    return { bridge, child, stdoutRef, writes };
  };

  it('does not reuse a ready host after stdin becomes unavailable', async () => {
    const { bridge, child } = await createStartedBridge();

    expect(bridge.canReuseFor({ requestedOutputSampleRate: 48000, channels: 2 })).toBe(true);

    child.stdin.destroy();

    expect(bridge.canReuseFor({ requestedOutputSampleRate: 48000, channels: 2 })).toBe(false);
    bridge.stop();
  });

  it('turns native stdin EOF into a bridge error instead of an uncaught stream error', async () => {
    const { bridge, child } = await createStartedBridge();
    const errors: Error[] = [];
    bridge.on('error', (error) => errors.push(error));

    child.stdin.emit('error', new Error('write EOF'));
    await Promise.resolve();

    expect(errors.at(-1)?.message).toContain('stdin_error:write EOF');
    expect(bridge.isReady).toBe(false);
    bridge.stop();
  });

  it('stopGracefully resolves when shutdown-ack is received', async () => {
    const { bridge, child, stdoutRef } = await createStartedBridge();
    const stopped = bridge.stopGracefully('test', 100);
    stdoutRef.write('{"event":"shutdown-ack"}\n');
    await stopped;

    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stopGracefully can wait for process exit after shutdown-ack', async () => {
    const { bridge, child, stdoutRef } = await createStartedBridge();
    let resolved = false;
    const stopped = bridge.stopGracefully('test', 100, true).then(() => {
      resolved = true;
    });
    stdoutRef.write('{"event":"shutdown-ack"}\n');

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    child.emit('exit', 0, null);
    await stopped;
    expect(resolved).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stopGracefully waits for process exit after force-kill when requested', async () => {
    const { bridge, child } = await createStartedBridge();
    let resolved = false;

    const stopped = bridge.stopGracefully('test', 5, true).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(resolved).toBe(false);

    child.emit('exit', 0, null);
    await stopped;
    expect(resolved).toBe(true);
  });

  it('stopGracefully resolves when the child process exits without ack', async () => {
    const { bridge, child } = await createStartedBridge();
    const stopped = bridge.stopGracefully('test', 100);
    child.emit('exit', 0, null);
    await stopped;

    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stopGracefully force-kills after timeout', async () => {
    const { bridge, child } = await createStartedBridge();
    let resolved = false;
    const stopped = bridge.stopGracefully('test', 5).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(resolved).toBe(false);

    await stopped;
    expect(resolved).toBe(true);
  });

  it('shutdown-ack does not emit ended', async () => {
    const { bridge, stdoutRef } = await createStartedBridge();
    const ended = vi.fn();
    bridge.on('ended', ended);

    stdoutRef.write('{"event":"shutdown-ack"}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ended).not.toHaveBeenCalled();
    bridge.stop();
  });

  it('shutdown-ack does not emit error', async () => {
    const { bridge, stdoutRef } = await createStartedBridge();
    const errors = vi.fn();
    bridge.on('error', errors);

    stdoutRef.write('{"event":"shutdown-ack"}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).not.toHaveBeenCalled();
    bridge.stop();
  });

  it('cleanup references are cleared after graceful stop', async () => {
    const { bridge, stdoutRef } = await createStartedBridge();
    const stopped = bridge.stopGracefully('test', 100);
    stdoutRef.write('{"event":"shutdown-ack"}\n');
    await stopped;

    expect(bridge.writable).toBeNull();
    expect(bridge.isReady).toBe(false);
    expect(bridge.deviceInfo).toBeNull();
  });

  it('stopGracefully is idempotent when called multiple times', async () => {
    const { bridge, stdoutRef } = await createStartedBridge();
    const first = bridge.stopGracefully('first', 100);
    const second = bridge.stopGracefully('second', 100);

    expect(second).toBe(first);

    stdoutRef.write('{"event":"shutdown-ack"}\n');
    await first;
  });
});

describe('AudioSession host availability', () => {
  it('reports unavailable when echo-audio-host is missing without throwing', () => {
    const unavailableSession = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map()),
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      isNativeHostAvailable: () => false,
      logger: noopLogger,
    });

    expect(unavailableSession.getStatus().host).toBe('unavailable');
  });

  it('returns isolated status snapshots without sharing nested objects', () => {
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map()),
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      isNativeHostAvailable: () => false,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const first = session.getStatus();
      first.warnings.push('mutated-status');
      if (first.automix) {
        first.automix.enabled = true;
      }
      if (first.audioLevels) {
        first.audioLevels.clipCount = 99;
        first.audioLevels.visualSpectrum = [1];
      }

      const second = session.getStatus();

      expect(first).not.toBe(second);
      expect(first.warnings).not.toBe(second.warnings);
      expect(first.automix).not.toBe(second.automix);
      expect(first.audioLevels).not.toBe(second.audioLevels);
      expect(second.host).toBe('unavailable');
      expect(second.state).toBe('idle');
      expect(second.positionSeconds).toBe(0);
      expect(second.error).toBeNull();
      expect(second.warnings).not.toContain('mutated-status');
      expect(second.automix?.enabled).toBe(false);
      expect(second.audioLevels?.clipCount).toBe(0);
      expect(second.audioLevels?.visualSpectrum).toHaveLength(32);
    } finally {
      session.dispose();
    }
  });

  it('starts Automix from an estimated plan without waiting for background analysis', async () => {
    const decoder = new AutomixPairDecoder(new Map([
      ['current.flac', probe('current.flac', 44100)],
      ['next.flac', probe('next.flac', 44100)],
    ]));
    const analyze = vi.fn(() => new Promise<never>(() => undefined));
    const session = createAudioSessionForTest({
      decoder,
      automixAnalyzer: { analyze },
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const status = await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          maxTransitionSeconds: 12,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(status.state).toBe('playing');
      expect(analyze).toHaveBeenCalledTimes(2);
      expect(decoder.automixRequests).toHaveLength(1);
      expect(decoder.automixRequests[0]?.plan.mode).toBe('energyFade');
    } finally {
      session.dispose();
    }
  });

  it.each([
    ['WASAPI exclusive', { outputMode: 'exclusive' as const }, { exclusive: true }],
  ])('keeps ffmpeg-premix Automix on %s output from playback start', async (_label, output, expectedStartOptions) => {
    const decoder = new AutomixPairDecoder(new Map([
      ['current.flac', probe('current.flac', 44100)],
      ['next.flac', probe('next.flac', 44100)],
    ]));
    const bridge = new NativeAutomixBridge();
    const session = createAudioSessionForTest({
      decoder,
      automixAnalyzer: { analyze: vi.fn(() => Promise.resolve(createEstimatedAutomixAnalysis({ durationSeconds: 120 }))) },
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const status = await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        output,
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(status.automix?.engine).toBe('ffmpegPremix');
      expect(bridge.startOptions).toMatchObject(expectedStartOptions);
      expect(decoder.automixRequests).toHaveLength(1);
      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
    } finally {
      session.dispose();
    }
  });

  it('keeps late-arm Automix on the ffmpeg premix path instead of native dual-deck', async () => {
    const decoder = new AutomixPairDecoder(new Map([
      ['current.flac', probe('current.flac', 44100)],
      ['next.flac', probe('next.flac', 44100)],
    ]));
    const bridge = new NativeAutomixBridge();
    const session = createAudioSessionForTest({
      decoder,
      automixAnalyzer: { analyze: vi.fn(() => Promise.resolve(createEstimatedAutomixAnalysis({ durationSeconds: 120 }))) },
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    try {
      await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
      expect(session.getStatus().automix?.engine).toBe('ffmpegPremix');
      expect(decoder.automixRequests).toHaveLength(1);
      await session.stop();

      await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        startSeconds: 80,
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
      expect(session.getStatus().automix?.engine).toBe('ffmpegPremix');
      expect(bridge.sessionBeginOptions.at(-1)).toMatchObject({ startSeconds: 80 });
      expect(decoder.automixRequests).toHaveLength(2);
      const lateArmRequest = decoder.automixRequests.at(-1);
      expect(lateArmRequest?.current).toMatchObject({
        filePath: 'current.flac',
        startSeconds: 80,
        durationSeconds: expect.any(Number),
      });
      expect(lateArmRequest?.next).toMatchObject({
        filePath: 'next.flac',
        startSeconds: expect.any(Number),
        durationSeconds: expect.any(Number),
      });
    } finally {
      session.dispose();
    }
  });

  it.each([
    ['WASAPI exclusive', { outputMode: 'exclusive' as const }, { exclusive: true }],
  ])('keeps late-arm ffmpeg-premix Automix on %s output', async (_label, output, expectedStartOptions) => {
    const decoder = new AutomixPairDecoder(new Map([
      ['current.flac', probe('current.flac', 44100)],
      ['next.flac', probe('next.flac', 44100)],
    ]));
    const bridge = new NativeAutomixBridge();
    const session = createAudioSessionForTest({
      decoder,
      automixAnalyzer: { analyze: vi.fn(() => Promise.resolve(createEstimatedAutomixAnalysis({ durationSeconds: 120 }))) },
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      const status = await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        startSeconds: 80,
        output,
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
        },
      });

      expect(status.automix?.engine).toBe('ffmpegPremix');
      expect(bridge.startOptions).toMatchObject(expectedStartOptions);
      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
      expect(decoder.automixRequests).toHaveLength(1);
      expect(decoder.automixRequests[0]?.current).toMatchObject({
        filePath: 'current.flac',
        startSeconds: 80,
      });
      expect(decoder.automixRequests[0]?.next).toMatchObject({
        filePath: 'next.flac',
      });
    } finally {
      session.dispose();
    }
  });

  it('keeps multi-track Automix on the ffmpeg sequence path instead of dropping following tracks in native dual-deck', async () => {
    const decoder = new AutomixPairDecoder(new Map([
      ['current.flac', probe('current.flac', 44100)],
      ['next.flac', probe('next.flac', 44100)],
      ['third.flac', probe('third.flac', 44100)],
    ]));
    const bridge = new NativeAutomixBridge();
    const session = createAudioSessionForTest({
      decoder,
      automixAnalyzer: { analyze: vi.fn(() => Promise.resolve(createEstimatedAutomixAnalysis({ durationSeconds: 120 }))) },
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    try {
      await session.playLocalFile({
        filePath: 'current.flac',
        trackId: 'current-track',
        startSeconds: 80,
        probe: {
          durationSeconds: 120,
          fileSampleRate: 44100,
          channels: 2,
        },
        automix: {
          enabled: true,
          next: {
            filePath: 'next.flac',
            trackId: 'next-track',
            probe: {
              durationSeconds: 150,
              fileSampleRate: 44100,
              channels: 2,
            },
          },
          following: [
            {
              filePath: 'third.flac',
              trackId: 'third-track',
              probe: {
                durationSeconds: 180,
                fileSampleRate: 44100,
                channels: 2,
              },
            },
          ],
        },
      });

      expect(bridge.prepareAutomixPlan).not.toHaveBeenCalled();
      expect(decoder.automixRequests).toHaveLength(1);
      expect(decoder.automixRequests[0]?.following).toHaveLength(1);
      expect(session.getStatus().automix?.engine).toBe('ffmpegPremix');
      expect(session.getStatus().automix?.plannedTrackCount).toBe(3);
    } finally {
      session.dispose();
    }
  });

});

describe('AudioSession graceful output cleanup', () => {
  it('stopResourcesGracefully calls bridge.stopGracefully when available', async () => {
    const bridge = new GracefulFakeBridge();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac' });
    await (session as unknown as { stopResourcesGracefully(reason: string): Promise<void> }).stopResourcesGracefully('test');

    expect(bridge.stopGracefully).toHaveBeenCalledWith('test');
  });

  it('resetEngine gracefully releases the active host and clears error state', async () => {
    const bridge = new GracefulFakeBridge();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    const status = await session.resetEngine();

    expect(bridge.stopGracefully).toHaveBeenCalledWith('reset-audio-engine', undefined, true);
    expect(status.state).toBe('stopped');
    expect(status.host).toBe('not-initialized');
    expect(status.currentFilePath).toBeNull();
    expect(status.error).toBeNull();
  });

  it('forceRestart waits for host exit, refreshes devices, clears recovery caches, and emits session-reset', async () => {
    const bridge = new GracefulFakeBridge();
    const refresh = vi.fn(async () => []);
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [], refresh },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });
    const sessionReset = vi.fn();
    session.on('session-reset', sessionReset);

    await session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'shared' } });
    const internals = session as unknown as {
      sharedStabilityTier: 'standard' | 'recovery' | 'emergency';
      watchdogRecoveries: Map<string, { count: number; windowStartedAt: number }>;
    };
    internals.sharedStabilityTier = 'emergency';
    internals.watchdogRecoveries.set('track', { count: 2, windowStartedAt: Date.now() });

    const status = await session.forceRestart('settings-audio-force-restart');

    expect(bridge.stopGracefully).toHaveBeenCalledWith('settings-audio-force-restart', undefined, true);
    expect(internals.sharedStabilityTier).toBe('standard');
    expect(internals.watchdogRecoveries.size).toBe(0);
    expect(status.state).toBe('stopped');
    expect(status.currentFilePath).toBeNull();
    expect(sessionReset).toHaveBeenCalledWith({
      reason: 'settings-audio-force-restart',
      status,
    });
  });

  it('stops the old bridge gracefully before creating replacement output', async () => {
    const order: string[] = [];
    let index = 0;
    const bridges: GracefulFakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([
        ['first.flac', probe('first.flac', 44100)],
        ['second.flac', probe('second.flac', 48000)],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new GracefulFakeBridge();
        const bridgeIndex = index;
        index += 1;
        order.push(`create:${bridgeIndex}`);
        bridge.stopGracefully.mockImplementation(async () => {
          order.push(`stop:${bridgeIndex}`);
        });
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'first.flac', output: { outputMode: 'exclusive' } });
    await session.playLocalFile({ filePath: 'second.flac', output: { outputMode: 'shared' } });

    expect(bridges[0].stopGracefully).toHaveBeenCalledWith('replace-output', undefined, true);
    expect(order).toEqual(['create:0', 'stop:0', 'create:1']);
  });

  it('carries the full current output settings into the next playLocalFile when the next request only changes speed', async () => {
    const bridges: GracefulFakeBridge[] = [];
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([
        ['first.flac', probe('first.flac', 48000)],
        ['second.flac', probe('second.flac', 96000)],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new GracefulFakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({
      filePath: 'first.flac',
      output: {
        outputMode: 'exclusive',
        deviceIndex: 7,
        deviceName: 'USB DAC',
        requestedOutputSampleRate: 48000,
      },
    });
    await session.playLocalFile({
      filePath: 'second.flac',
      output: { playbackRate: 1.2, playbackSpeedMode: 'speed' },
    });

    expect(bridges[1].startOptions).toMatchObject({
      exclusive: true,
      deviceIndex: 7,
      deviceName: 'USB DAC',
      playbackRate: 1.2,
      playbackSpeedMode: 'speed',
    });
    expect(session.getStatus().outputMode).toBe('exclusive');
  });

  it('waits for WASAPI shared host shutdown before starting replacement shared output', async () => {
    const bridges: GracefulFakeBridge[] = [];
    let resolveStop = (): void => undefined;
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([
        ['first.flac', probe('first.flac', 44100)],
        ['second.flac', probe('second.flac', 48000)],
      ])),
      deviceService: { listDevices: () => [] },
      createBridge: () => {
        const bridge = new GracefulFakeBridge();
        bridges.push(bridge);
        return bridge;
      },
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({
      filePath: 'first.flac',
      output: { outputMode: 'shared', deviceIndex: 0, deviceName: 'First DAC' },
    });
    bridges[0].stopGracefully.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveStop = () => resolve(undefined);
    }));

    const playPromise = session.playLocalFile({
      filePath: 'second.flac',
      output: { outputMode: 'shared', deviceIndex: 1, deviceName: 'Second DAC' },
    }).then((status) => status.currentFilePath);

    const result = await Promise.race([
      playPromise,
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('still-waiting'), 50);
      }),
    ]);

    expect(result).toBe('still-waiting');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].stopGracefully).toHaveBeenCalledWith('replace-output', 750, true);
    resolveStop();
    await expect(playPromise).resolves.toBe('second.flac');
    expect(bridges).toHaveLength(2);
    expect(bridges[1].startOptions).toMatchObject({
      exclusive: false,
      deviceName: 'Second DAC',
    });
  });
  it('disposeGracefully clears watchdog and stops bridge', async () => {
    const bridge = new GracefulFakeBridge();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      watchdogIntervalMs: 250,
    });

    await session.playLocalFile({ filePath: 'song.flac' });
    await session.disposeGracefully();

    expect(bridge.stopGracefully).toHaveBeenCalledWith('dispose');
    expect((session as unknown as { watchdogTimer: unknown }).watchdogTimer).toBeNull();
  });

  it('dispose remains safe and sync', async () => {
    const bridge = new ThrowingStopBridge();
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac' });

    expect(() => session.dispose()).not.toThrow();
    expect(bridge.stop).toHaveBeenCalled();
  });

  it('cleanup failure does not throw out of disposeGracefully', async () => {
    const bridge = new GracefulFakeBridge();
    bridge.stopGracefully.mockRejectedValueOnce(new Error('cleanup failed'));
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => bridge,
      logger: noopLogger,
      disableWatchdogTimer: true,
    });

    await session.playLocalFile({ filePath: 'song.flac' });

    await expect(session.disposeGracefully()).resolves.toBeUndefined();
  });

});

describe('DeviceService diagnostics', () => {
  it('uses async native host enumeration for UI device lists', async () => {
    const execFileSyncMock = vi.fn(() => {
      throw new Error('sync enumeration should not run');
    });
    const execFileMock = vi.fn((_bin, args, _options, callback) => {
      const output = Array.isArray(args) && args.includes('-asio')
        ? ''
        : '0\tSpeakers\t48000\t1\t48000\n';
      queueMicrotask(() => callback(null, output, ''));
      return {} as ReturnType<typeof nodeExecFile>;
    });
    const service = new DeviceService({
      hostBinary: 'echo-audio-host.exe',
      execFileSync: execFileSyncMock as unknown as typeof nodeExecFileSync,
      execFile: execFileMock as unknown as typeof nodeExecFile,
      logger: noopLogger,
    });

    await expect(service.listDevicesAsync()).resolves.toMatchObject([
      {
        id: 'shared:0',
        name: 'Speakers',
        outputMode: 'shared',
        sharedDeviceSampleRate: 48000,
      },
    ]);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('returns an empty Linux device list when no native host is bundled', async () => {
    const execFileSyncMock = vi.fn(() => {
      throw new Error('sync enumeration should not run');
    });
    const execFileMock = vi.fn();
    const logs: string[] = [];
    const service = new DeviceService({
      hostBinary: null,
      platform: 'linux',
      execFileSync: execFileSyncMock as unknown as typeof nodeExecFileSync,
      execFile: execFileMock as unknown as typeof nodeExecFile,
      logger: (message) => logs.push(message),
    });

    expect(service.listDevices()).toEqual([]);
    await expect(service.listDevicesAsync()).resolves.toEqual([]);
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(logs.some((message) => message.includes('echo-audio-host binary not found for shared device enumeration'))).toBe(true);
  });

  it('lists only shared devices on Linux', async () => {
    const execFileMock = vi.fn((_bin, args, _options, callback) => {
      queueMicrotask(() => callback(null, '0\tPipeWire Output\t48000\t1\t48000\n', ''));
      return {} as ReturnType<typeof nodeExecFile>;
    });
    const service = new DeviceService({
      hostBinary: 'echo-audio-host',
      platform: 'linux',
      execFile: execFileMock as unknown as typeof nodeExecFile,
      logger: noopLogger,
    });

    await expect(service.listDevicesAsync()).resolves.toMatchObject([
      {
        id: 'shared:0',
        name: 'PipeWire Output',
        outputMode: 'shared',
        sharedDeviceSampleRate: 48000,
      },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][1]).toEqual(['-list']);
  });
});

describe('DecoderPipeline ffmpeg resolution', () => {
  it('prefers explicit ffmpegPath over env and bundled ffmpeg', () => {
    expect(
      resolveDecoderFfmpegPath({
        ffmpegPath: 'explicit-ffmpeg',
        env: { ECHO_FFMPEG_PATH: 'env-ffmpeg' },
      }),
    ).toBe('explicit-ffmpeg');
  });

  it('prefers ECHO_FFMPEG_PATH over bundled ffmpeg', () => {
    expect(
      resolveDecoderFfmpegPath({
        env: { ECHO_FFMPEG_PATH: 'env-ffmpeg' },
      }),
    ).toBe('env-ffmpeg');
  });

  it('falls back to dev-bundled ffmpeg before system ffmpeg', () => {
    expect(
      resolveDecoderFfmpegPath({
        env: {},
        resourcesPath: null,
        cwd: join('C:', 'Project', 'ECHO-Next'),
        systemFfmpegPath: 'system-ffmpeg',
        existsSync: (path) => path === join('C:', 'Project', 'ECHO-Next', 'electron-app', 'tools', 'ffmpeg.exe'),
      }),
    ).toBe(join('C:', 'Project', 'ECHO-Next', 'electron-app', 'tools', 'ffmpeg.exe'));
  });

  it('uses app.asar.unpacked for explicit ffmpeg paths', () => {
    const explicitPath = join('C:', 'App', 'resources', 'app.asar', 'tools', 'ffmpeg.exe');
    expect(
      resolveDecoderFfmpegPath({
        ffmpegPath: explicitPath,
        env: {},
        resourcesPath: null,
      }),
    ).toBe(join('C:', 'App', 'resources', 'app.asar.unpacked', 'tools', 'ffmpeg.exe'));
  });

  it('prefers packaged tools ffmpeg before dev-bundled ffmpeg', () => {
    expect(
      resolveDecoderFfmpegPath({
        env: {},
        resourcesPath: join('C:', 'App', 'resources'),
        cwd: join('C:', 'Project', 'ECHO-Next'),
        existsSync: (path) =>
          path === join('C:', 'App', 'resources', 'tools', 'ffmpeg.exe') ||
          path === join('C:', 'Project', 'ECHO-Next', 'electron-app', 'tools', 'ffmpeg.exe'),
      }),
    ).toBe(join('C:', 'App', 'resources', 'tools', 'ffmpeg.exe'));
  });

  it('prefers Linux dev-bundled ffmpeg from tools-linux before legacy tools', () => {
    const cwd = join('C:', 'Project', 'ECHO-Next');
    const linuxTool = join(cwd, 'electron-app', 'tools-linux', 'ffmpeg');
    const legacyTool = join(cwd, 'electron-app', 'tools', 'ffmpeg');

    const info = resolveFfmpegToolchain({
      env: {},
      platform: 'linux',
      resourcesPath: null,
      cwd,
      existsSync: (path) => path === linuxTool || path === legacyTool,
      requireHealthy: false,
    });

    expect(info.path).toBe(linuxTool);
    expect(info.source).toBe('dev-bundled');
  });

  it('detects healthy SOXR-capable ffmpeg builds', () => {
    const execFileSync = vi.fn((_file: string, args: string[]) => {
      if (args.includes('-version')) {
        return 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-gpl --enable-libsoxr\n';
      }

      return ' .. aresample         A->A       Resample audio data.\n';
    });

    const info = resolveFfmpegToolchain({
      env: {},
      resourcesPath: join('C:', 'App', 'resources'),
      existsSync: (path) => path === join('C:', 'App', 'resources', 'tools', 'ffmpeg.exe'),
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
    });

    expect(info).toMatchObject({
      path: join('C:', 'App', 'resources', 'tools', 'ffmpeg.exe'),
      version: '8.1.1-full_build-www.gyan.dev',
      healthy: true,
      soxrAvailable: true,
      aresampleAvailable: true,
    });
  });

  it('classifies ffmpeg stderr for stable fallback decisions', () => {
    expect(classifyFfmpegDecodeError(['No such filter: soxr'], 'ffmpeg_exit_code_1')).toBe('soxr_or_filter_error');
    expect(classifyFfmpegDecodeError(['Server returned 403 Forbidden'], 'ffmpeg_exit_code_1')).toBe('http_expired_or_forbidden');
    expect(classifyFfmpegDecodeError(['Connection reset by peer'], 'ffmpeg_exit_code_1')).toBe('network_error');
    expect(classifyFfmpegDecodeError(['Invalid data found when processing input'], 'ffmpeg_exit_code_1')).toBe('input_invalid');
    expect(classifyFfmpegDecodeError(['Unknown decoder flac_test'], 'ffmpeg_exit_code_1')).toBe('unsupported_codec');
    expect(classifyFfmpegDecodeError([], 'ffmpeg_pcm_start_timeout')).toBe('pcm_start_timeout');
    expect(classifyFfmpegDecodeError([], 'ffmpeg_missing')).toBe('process_missing');
  });

  it('normalizes missing spawn errors to ffmpeg_missing', async () => {
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT' }));
      });

      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'missing-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    await expect(run.done).rejects.toThrow('ffmpeg_missing');
  });

  it('surfaces decoder errors in AudioSession status', async () => {
    const decoder = new FailingDecoder(new Map([['song.flac', probe('song.flac', 44100)]]));
    const session = createAudioSessionForTest({
      decoder,
      deviceService: { listDevices: () => [] },
      createBridge: () => new FakeBridge(),
      isNativeHostAvailable: () => true,
      logger: noopLogger,
    });

    await session.playLocalFile({
      filePath: 'song.flac',
      output: { outputMode: 'exclusive' },
    });
    await Promise.resolve();

    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().error).toBe('ffmpeg_missing');
  });

  it('includes ffmpeg stderr and spawn details when decoding exits non-zero', async () => {
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => {
        child.stderr.write('Invalid data found when processing input\n');
        child.emit('exit', 1, null);
      });

      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'broken.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    await expect(run.done).rejects.toThrow(
      'ffmpeg_exit_code_1; ffmpeg="test-ffmpeg"; args="-hide_banner -loglevel error -nostdin -nostats -ss 0 -i broken.flac -map 0:a:0 -vn -sn -dn -f f32le -ac 2 -ar 44100 pipe:1"; kind="input_invalid"; stderr="Invalid data found when processing input"',
    );
  });

  it('does not add remote reconnect args for local files', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).not.toContain('-reconnect');
    expect(spawnedArgs).not.toContain('-rw_timeout');
    expect(spawnedArgs).toContain('-nostats');
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-map', '0:a:0', '-vn', '-sn', '-dn']));
  });

  it('limits ffmpeg decode duration when requested by native Automix', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 80,
      durationSeconds: 24.5,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-ss', '80', '-t', '24.5']));
  });

  it('builds Automix ffmpeg filters that skip next-track leading silence and use smooth curves', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeAutomixPair({
      current: {
        filePath: 'current.flac',
        startSeconds: 12,
        durationSeconds: 120,
        channels: 2,
        decoderOutputSampleRate: 44100,
      },
      next: {
        filePath: 'next.flac',
        startSeconds: 0,
        durationSeconds: 180,
        channels: 2,
        decoderOutputSampleRate: 44100,
      },
      plan: {
        mode: 'smartCrossfade',
        currentStartSeconds: 12,
        currentEndSeconds: 110,
        currentFadeStartSeconds: 94,
        nextStartSeconds: 2.5,
        overlapSeconds: 16,
        curve: 'hsin',
        currentGainDb: -1,
        nextGainDb: 2,
        tempoRatio: 1,
        advanceAtSeconds: 94,
        skipIntroSilence: false,
        beatAligned: false,
        fallbackReason: null,
      },
    });

    await expect(run.done).resolves.toBeUndefined();
    const filter = spawnedArgs[spawnedArgs.indexOf('-filter_complex') + 1];
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-map', '[aout]', '-vn', '-sn', '-dn']));
    expect(filter).toContain('atrim=0:98.000');
    expect(filter).toContain('areverse,silenceremove=start_periods=1:start_duration=0.180:start_threshold=-42dB,areverse');
    expect(filter).toContain('silenceremove=start_periods=1:start_duration=0.035:start_threshold=-48dB');
    expect(filter).toContain("volume='if(lt(t\\,82.000)\\,1\\,if(lt(t\\,98.000)\\,1+(0.891251-1)*((t-82.000)/16.000)\\,0.891251))':eval=frame");
    expect(filter).toContain("volume='if(lt(t\\,16.000)\\,1.258925\\,if(lt(t\\,20.000)\\,1.258925+(1-1.258925)*((t-16.000)/4.000)\\,1))':eval=frame");
    expect(filter).toContain('acrossfade=d=16.000:c1=hsin:c2=hsin');
    const secondSeekIndex = spawnedArgs.lastIndexOf('-ss');
    expect(spawnedArgs[secondSeekIndex + 1]).toBe('2.5');
  });

  it('builds a chained Automix ffmpeg graph for multiple upcoming tracks', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const firstPlan = {
      mode: 'beatAligned' as const,
      currentStartSeconds: 0,
      currentEndSeconds: 118,
      currentFadeStartSeconds: 108,
      nextStartSeconds: 1,
      overlapSeconds: 10,
      curve: 'hsin' as const,
      currentGainDb: 0,
      nextGainDb: 0,
      tempoRatio: 1.018,
      advanceAtSeconds: 108,
      skipIntroSilence: true,
      beatAligned: true,
      fallbackReason: null,
    };
    const secondPlan = {
      ...firstPlan,
      mode: 'energyFade' as const,
      currentEndSeconds: 150,
      currentFadeStartSeconds: 141,
      nextStartSeconds: 0.75,
      overlapSeconds: 9,
      beatAligned: false,
    };
    const run = decoder.decodeAutomixPair({
      current: {
        filePath: 'one.flac',
        startSeconds: 0,
        durationSeconds: 120,
        channels: 2,
        decoderOutputSampleRate: 44100,
      },
      next: {
        filePath: 'two.flac',
        startSeconds: 0,
        durationSeconds: 160,
        channels: 2,
        decoderOutputSampleRate: 44100,
      },
      plan: firstPlan,
      following: [
        {
          track: {
            filePath: 'three.flac',
            startSeconds: 0,
            durationSeconds: 180,
            channels: 2,
            decoderOutputSampleRate: 44100,
          },
          plan: secondPlan,
        },
      ],
    });

    await expect(run.done).resolves.toBeUndefined();
    const filter = spawnedArgs[spawnedArgs.indexOf('-filter_complex') + 1];
    expect(spawnedArgs.filter((arg) => arg === '-i')).toHaveLength(3);
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-map', '[aout]', '-vn', '-sn', '-dn']));
    expect(filter).toContain('[s0][s1]acrossfade=d=10.000:c1=hsin:c2=hsin[m1]');
    expect(filter).toContain('[m1][s2]acrossfade=d=9.000:c1=hsin:c2=hsin[aout]');
    expect(filter).toContain('[1:a]atrim=0:149.000');
    expect(filter).toContain('[1:a]atrim=0:149.000,areverse,silenceremove=start_periods=1:start_duration=0.180:start_threshold=-42dB,areverse,atempo=1.015000');
  });

  it('builds a gapless ffmpeg concat graph without crossfade and applies in-stream ReplayGain', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeGaplessSequence({
      current: {
        filePath: 'one.flac',
        startSeconds: 10,
        durationSeconds: 120,
        channels: 2,
        decoderOutputSampleRate: 44100,
        replayGainDb: -3,
      },
      next: {
        filePath: 'two.flac',
        startSeconds: 0,
        durationSeconds: 160,
        channels: 2,
        decoderOutputSampleRate: 44100,
        replayGainDb: 1.5,
      },
      following: [
        {
          filePath: 'three.flac',
          startSeconds: 0,
          durationSeconds: 180,
          channels: 2,
          decoderOutputSampleRate: 44100,
          replayGainDb: -1,
        },
      ],
    });

    await expect(run.done).resolves.toBeUndefined();
    const filter = spawnedArgs[spawnedArgs.indexOf('-filter_complex') + 1];
    expect(run.replayGainAppliedInStream).toBe(true);
    expect(spawnedArgs.filter((arg) => arg === '-i')).toHaveLength(3);
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-map', '[aout]', '-vn', '-sn', '-dn']));
    expect(spawnedArgs[spawnedArgs.indexOf('-ss') + 1]).toBe('10');
    expect(filter).toContain('[g0][g1][g2]concat=n=3:v=0:a=1[aout]');
    expect(filter).toContain('[0:a]atrim=0:110.000,asetpts=PTS-STARTPTS,volume=-3.000dB[g0]');
    expect(filter).toContain('[1:a]atrim=0:160.000,asetpts=PTS-STARTPTS,volume=1.500dB[g1]');
    expect(filter).toContain('[2:a]atrim=0:180.000,asetpts=PTS-STARTPTS,volume=-1.000dB[g2]');
    expect(filter).not.toContain('acrossfade');
  });

  it('adds conservative reconnect args before remote HTTP inputs', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'https://example.test/song.flac?token=secret',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    await expect(run.done).resolves.toBeUndefined();
    const inputIndex = spawnedArgs.indexOf('-i');
    for (const flag of ['-reconnect', '-reconnect_streamed', '-reconnect_at_eof', '-reconnect_on_network_error', '-reconnect_delay_max', '-rw_timeout']) {
      expect(spawnedArgs.indexOf(flag)).toBeGreaterThanOrEqual(0);
      expect(spawnedArgs.indexOf(flag)).toBeLessThan(inputIndex);
    }
    expect(spawnedArgs[spawnedArgs.indexOf('-rw_timeout') + 1]).toBe('30000000');
  });

  it('passes HTTP input headers to ffmpeg while redacting secrets from diagnostics', async () => {
    let spawnedArgs: string[] = [];
    const logs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => {
        child.stderr.write('Server returned 403 Forbidden\n');
        child.emit('exit', 1, null);
      });

      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: (message) => logs.push(message),
    });
    const run = decoder.decodeLocalFile({
      filePath: 'https://m701.music.126.net/token/song.flac?auth=secret',
      inputHeaders: {
        Referer: 'https://music.163.com/',
        Cookie: 'MUSIC_U=secret',
        'User-Agent': 'ECHO-Test',
      },
      startSeconds: 170,
      channels: 2,
      decoderOutputSampleRate: 48000,
    });

    expect(spawnedArgs).toContain('-headers');
    expect(spawnedArgs[spawnedArgs.indexOf('-headers') + 1]).toBe(
      'Referer: https://music.163.com/\r\nCookie: MUSIC_U=secret\r\nUser-Agent: ECHO-Test\r\n',
    );
    await expect(run.done).rejects.toThrow('Cookie: <redacted>');
    await expect(run.done).rejects.not.toThrow('MUSIC_U=secret');
    expect(logs.join('\n')).not.toContain('Cookie: MUSIC_U=secret');
    expect(logs.join('\n')).not.toContain('MUSIC_U=secret');
  });

  it('passes Automix tempo matching into the PCM decode filter chain', async () => {
    let spawnedArgs: string[] = [];
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'next.flac',
      startSeconds: 1.25,
      channels: 2,
      decoderOutputSampleRate: 48000,
      tempoRatio: 1.018,
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-af', 'atempo=1.018000']));
  });

  it('times out remote HTTP decodes that produce no PCM startup data', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => true);
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill,
      });

      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'https://example.test/slow.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });
    const rejection = expect(run.done).rejects.toThrow('ffmpeg_pcm_start_timeout');

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not time out a remote HTTP decode after PCM starts', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = () => {
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'https://example.test/song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 44100,
    });

    child.stdout.write(Buffer.alloc(4));
    await vi.advanceTimersByTimeAsync(30_000);
    child.emit('exit', 0, null);
    await expect(run.done).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses SOXR filter args when requested and supported', async () => {
    let spawnedArgs: string[] = [];
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-libsoxr\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      requireHealthyFfmpeg: true,
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
      allowResamplerFallback: true,
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).toEqual(expect.arrayContaining(['-af', 'aresample=resampler=soxr:precision=28', '-ar', '48000']));
  });

  it('maps SOXR quality profiles to distinct filter precision', async () => {
    const spawnedArgsByProfile: string[][] = [];
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-libsoxr\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgsByProfile.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        kill: vi.fn(),
      });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };

    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      spawn,
      requireHealthyFfmpeg: true,
    });

    for (const profile of ['balanced', 'lowLatency'] as const) {
      const run = decoder.decodeLocalFile({
        filePath: `${profile}.flac`,
        startSeconds: 0,
        channels: 2,
        decoderOutputSampleRate: 48000,
        resamplerEngine: 'soxr',
        resamplerQualityProfile: profile,
        allowResamplerFallback: true,
      });
      await expect(run.done).resolves.toBeUndefined();
    }

    expect(spawnedArgsByProfile[0]).toContain('aresample=resampler=soxr:precision=20');
    expect(spawnedArgsByProfile[1]).toContain('aresample=resampler=soxr:precision=16');
  });

  it('falls back to default resampling when SOXR is unavailable and fallback is enabled', async () => {
    let spawnedArgs: string[] = [];
    const fallbacks: string[] = [];
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1\nconfiguration: --enable-gpl\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs = args;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => child.emit('exit', 0, null));
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      requireHealthyFfmpeg: true,
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
      allowResamplerFallback: true,
      onResamplerFallback: (warning) => fallbacks.push(warning),
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).not.toContain('aresample=resampler=soxr:precision=28');
    expect(fallbacks).toEqual(['soxr_unavailable_fallback_to_default']);
  });

  it('surfaces SOXR unavailable when fallback is disabled', () => {
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1\nconfiguration: --enable-gpl\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      requireHealthyFfmpeg: true,
      spawn: vi.fn() as unknown as NonNullable<DecoderPipelineDependencies['spawn']>,
      logger: noopLogger,
    });

    expect(() =>
      decoder.decodeLocalFile({
        filePath: 'song.flac',
        startSeconds: 0,
        channels: 2,
        decoderOutputSampleRate: 48000,
        resamplerEngine: 'soxr',
        allowResamplerFallback: false,
      }),
    ).toThrow('soxr_unavailable');
  });

  it('retries once with default resampling when SOXR fails before PCM output', async () => {
    const spawnedArgs: string[][] = [];
    const fallbacks: string[] = [];
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-libsoxr\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => {
        if (spawnedArgs.length === 1) {
          child.stderr.write('No such filter: soxr\n');
          child.emit('exit', 1, null);
        } else {
          child.emit('exit', 0, null);
        }
      });
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      requireHealthyFfmpeg: true,
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'song.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
      allowResamplerFallback: true,
      onResamplerFallback: (warning) => fallbacks.push(warning),
    });

    await expect(run.done).resolves.toBeUndefined();
    expect(spawnedArgs).toHaveLength(2);
    expect(spawnedArgs[0]).toContain('aresample=resampler=soxr:precision=28');
    expect(spawnedArgs[1]).not.toContain('aresample=resampler=soxr:precision=28');
    expect(fallbacks).toEqual(['soxr_decode_failed_fallback_to_default']);
  });

  it('does not treat generic input failures as SOXR fallback triggers', async () => {
    const spawnedArgs: string[][] = [];
    const fallbacks: string[] = [];
    const execFileSync = vi.fn((_file: string, args: string[]) =>
      args.includes('-version')
        ? 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-libsoxr\n'
        : ' .. aresample         A->A       Resample audio data.\n',
    );
    const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
      spawnedArgs.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true),
      });

      queueMicrotask(() => {
        child.stderr.write('Invalid data found when processing input\n');
        child.emit('exit', 1, null);
      });
      return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
    };
    const decoder = new DecoderPipeline({
      ffmpegPath: 'test-ffmpeg',
      execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
      requireHealthyFfmpeg: true,
      spawn,
      logger: noopLogger,
    });
    const run = decoder.decodeLocalFile({
      filePath: 'broken.flac',
      startSeconds: 0,
      channels: 2,
      decoderOutputSampleRate: 48000,
      resamplerEngine: 'soxr',
      allowResamplerFallback: true,
      onResamplerFallback: (warning) => fallbacks.push(warning),
    });

    await expect(run.done).rejects.toThrow('Invalid data found when processing input');
    expect(spawnedArgs).toHaveLength(1);
    expect(spawnedArgs[0]).toContain('aresample=resampler=soxr:precision=28');
    expect(fallbacks).toEqual([]);
  });

  it('does not treat HTTP, network, or codec errors as SOXR fallback triggers', async () => {
    const cases = [
      ['Server returned 403 Forbidden', 'http_expired_or_forbidden'],
      ['Connection reset by peer', 'network_error'],
      ['Unknown decoder flac_test', 'unsupported_codec'],
    ] as const;

    for (const [stderrLine, expectedKind] of cases) {
      const spawnedArgs: string[][] = [];
      const fallbacks: string[] = [];
      const execFileSync = vi.fn((_file: string, args: string[]) =>
        args.includes('-version')
          ? 'ffmpeg version 8.1.1-full_build-www.gyan.dev\nconfiguration: --enable-libsoxr\n'
          : ' .. aresample         A->A       Resample audio data.\n',
      );
      const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = (_file, args) => {
        spawnedArgs.push(args);
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(() => true),
        });

        queueMicrotask(() => {
          child.stderr.write(`${stderrLine}\n`);
          child.emit('exit', 1, null);
        });
        return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
      };
      const decoder = new DecoderPipeline({
        ffmpegPath: 'test-ffmpeg',
        execFileSync: execFileSync as unknown as typeof nodeExecFileSync,
        requireHealthyFfmpeg: true,
        spawn,
        logger: noopLogger,
      });
      const run = decoder.decodeLocalFile({
        filePath: 'https://example.test/song.flac',
        startSeconds: 0,
        channels: 2,
        decoderOutputSampleRate: 48000,
        resamplerEngine: 'soxr',
        allowResamplerFallback: true,
        onResamplerFallback: (warning) => fallbacks.push(warning),
      });

      await expect(run.done).rejects.toThrow(`kind="${expectedKind}"`);
      expect(spawnedArgs).toHaveLength(1);
      expect(spawnedArgs[0]).toContain('aresample=resampler=soxr:precision=28');
      expect(fallbacks).toEqual([]);
    }
  });
});

describe('NativeOutputBridge diagnostics', () => {
  it('passes DirectSound shared backend through to the host and reuse key', async () => {
    let spawnedArgs: string[] = [];
    const fakeSpawn = (_file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawnedArgs = args;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"directsound-shared","backendImpl":"juce-directsound-shared","deviceType":"DirectSound","deviceName":"Default output"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
      sharedBackend: 'directsound',
    });

    expect(spawnedArgs).toContain('-shared-backend');
    expect(spawnedArgs).toContain('directsound');
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
      sharedBackend: 'directsound',
    })).toBe(true);
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
    })).toBe(false);
  });

  it('normalizes Windows shared backends to auto on Linux hosts', async () => {
    let spawnedArgs: string[] = [];
    const fakeSpawn = (_file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawnedArgs = args;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"shared","backendImpl":"juce-shared","deviceType":"ALSA","deviceName":"Default output"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host',
      platform: 'linux',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
      sharedBackend: 'directsound',
    });

    expect(spawnedArgs).not.toContain('-shared-backend');
    expect(spawnedArgs).not.toContain('directsound');
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
    })).toBe(true);
  });

  it('passes ALSA shared backend through on Linux hosts', async () => {
    let spawnedArgs: string[] = [];
    const fakeSpawn = (_file: string, args: string[]): ChildProcessWithoutNullStreams => {
      spawnedArgs = args;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"alsa-shared","backendImpl":"juce-alsa-shared","deviceType":"ALSA","deviceName":"Default output"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host',
      platform: 'linux',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
      sharedBackend: 'alsa',
    });

    expect(spawnedArgs).toContain('-shared-backend');
    expect(spawnedArgs).toContain('alsa');
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
      sharedBackend: 'alsa',
    })).toBe(true);
    expect(bridge.canReuseFor({
      requestedOutputSampleRate: 48000,
      sharedMixSampleRate: 48000,
      channels: 2,
    })).toBe(false);
  });

  it('formats Windows access violations with hex crash metadata', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stderr.write('[echo-audio-host] createDevice completed\n');
        child.emit('exit', 3221225477, null);
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await expect(
      bridge.start({
        requestedOutputSampleRate: 48000,
        channels: 2,
      }),
    ).rejects.toThrow('exitCodeHex=0xC0000005; nativeCrash=access_violation');
  });

  it('includes elapsed time, output mode, and stderr tail when ready times out', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stderr.write('[echo-audio-host] createDevice is still waiting\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      readyTimeoutMs: 5,
      logger: noopLogger,
    });

    let message = '';
    try {
      await bridge.start({
        requestedOutputSampleRate: 44100,
        channels: 2,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('echo-audio-host timeout_waiting_for_ready');
    expect(message).toContain('mode="shared"');
    expect(message).toMatch(/elapsedMs=\d+/);
    expect(message).toContain('stderrTail="[echo-audio-host] createDevice is still waiting"');
  });

  it('includes host stderr and spawn details when the native host exits before ready', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stderr.write('[echo-audio-host] Failed to initialize output device\n');
        child.emit('exit', 1, null);
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await expect(
      bridge.start({
        requestedOutputSampleRate: 44100,
        channels: 2,
      }),
    ).rejects.toThrow(
      'echo-audio-host exit_code_1; host="echo-audio-host.exe"; args="-eq-port 0 --rpc-stdin-fd 3 --rpc-stdout-fd 4 --no-stdin"; mode="shared"; elapsedMs=0',
    );
  });

  it.each([
    ['initialize', '[echo-audio-host] WASAPI Initialize timed out after 3000ms phase=initialize'],
    ['activate', '[echo-audio-host] WASAPI Activate timed out after 3000ms phase=activate'],
  ])('maps WASAPI %s timeout exit codes to device_initialize_timeout', async (_phase, stderrLine) => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stderr.write(`${stderrLine}\n`);
        child.emit('exit', 4294967293, null);
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await expect(
      bridge.start({
        requestedOutputSampleRate: 44100,
        channels: 2,
      }),
    ).rejects.toThrow('echo-audio-host device_initialize_timeout');
  });

  it('rejects startup error events without emitting a runtime bridge error before ready', async () => {
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stderr.write('[echo-audio-host] Backend WASAPI exclusive failed for Test Device: No device found.\n');
        stdout.write('{"event":"error","reason":"runtime_error","message":"WASAPI exclusive open failed: failed to open output device \\"Test Device\\": No device found."}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });
    const runtimeError = vi.fn();
    bridge.on('error', runtimeError);

    await expect(
      bridge.start({
        requestedOutputSampleRate: 44100,
        channels: 2,
        exclusive: true,
        deviceIndex: 2,
        deviceName: 'Test Device',
      }),
    ).rejects.toThrow('nativeMessage="WASAPI exclusive open failed: failed to open output device \\"Test Device\\": No device found."');
    expect(runtimeError).not.toHaveBeenCalled();
  });

  it('emits native host notification events from stdout', async () => {
    let hostStdout!: PassThrough;
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      hostStdout = stdout;
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"wasapi-shared","deviceName":"TEAC USB"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    const notification = new Promise<NativeHostNotificationEvent>((resolve) => {
      bridge.once('device-event', (event) => resolve(event as NativeHostNotificationEvent));
    });
    hostStdout.write(
      '{"event":"audio_session_disconnected","reason":"exclusive_mode_override","code":5,"currentDevice":true,"followsDefaultDevice":false}\n',
    );

    await expect(notification).resolves.toMatchObject({
      event: 'audio_session_disconnected',
      reason: 'exclusive_mode_override',
      code: 5,
      currentDevice: true,
      followsDefaultDevice: false,
    });
    bridge.stop();
  });

  it('routes device_invalidated host errors as device events after ready', async () => {
    let hostStdout!: PassThrough;
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      hostStdout = stdout;
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"wasapi-exclusive","deviceName":"TEAC USB"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });
    const runtimeError = vi.fn();
    bridge.on('error', runtimeError);

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
      exclusive: true,
    });

    const notification = new Promise<NativeHostNotificationEvent>((resolve) => {
      bridge.once('device-event', (event) => resolve(event as NativeHostNotificationEvent));
    });
    hostStdout.write('{"event":"error","reason":"device_invalidated","message":"WASAPI device invalidated"}\n');

    await expect(notification).resolves.toMatchObject({
      event: 'audio_session_disconnected',
      reason: 'device_invalidated',
      currentDevice: true,
      followsDefaultDevice: true,
    });
    expect(runtimeError).not.toHaveBeenCalled();
    bridge.stop();
  });

  it('includes native error event messages and stderr tail after the host is ready', async () => {
    let hostStdout!: PassThrough;
    let hostStderr!: PassThrough;
    const fakeSpawn = (): ChildProcessWithoutNullStreams => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      hostStdout = stdout;
      hostStderr = stderr;
      const child = Object.assign(new EventEmitter(), {
        stdin,
        stdout,
        stderr,
        kill: vi.fn(() => true),
      }) as unknown as ChildProcessWithoutNullStreams;

      queueMicrotask(() => {
        stdout.write('{"ready":true,"sampleRate":48000,"backend":"wasapi-shared","deviceName":"TEAC USB"}\n');
      });

      return child;
    };
    const bridge = new NativeOutputBridge({
      hostBinary: 'echo-audio-host.exe',
      spawn: fakeSpawn as HostSpawner,
      logger: noopLogger,
    });
    const errorPromise = new Promise<Error>((resolve) => {
      bridge.once('error', (error) => resolve(error instanceof Error ? error : new Error(String(error))));
    });

    await bridge.start({
      requestedOutputSampleRate: 48000,
      channels: 2,
    });

    hostStderr.write('[echo-audio-host] WASAPI shared Initialize failed hr=0x8889000A\n');
    hostStdout.write('{"event":"error","reason":"wasapi_shared_initialize_failed","message":"WASAPI shared open failed: Failed to initialize WASAPI shared client (hr=0x8889000a)"}\n');

    const error = await errorPromise;
    expect(error.message).toContain('echo-audio-host wasapi_shared_initialize_failed');
    expect(error.message).toContain('nativeMessage="WASAPI shared open failed: Failed to initialize WASAPI shared client (hr=0x8889000a)"');
    expect(error.message).toContain('stderrTail="[echo-audio-host] WASAPI shared Initialize failed hr=0x8889000A"');
  });

  it('propagates native host startup failures into AudioSession status', async () => {
    const session = createAudioSessionForTest({
      decoder: new FakeDecoder(new Map([['song.flac', probe('song.flac', 44100)]])),
      deviceService: { listDevices: () => [] },
      createBridge: () => new StartupFailingBridge(),
      isNativeHostAvailable: () => true,
      logger: noopLogger,
    });

    await expect(
      session.playLocalFile({ filePath: 'song.flac', output: { outputMode: 'exclusive' } }),
    ).rejects.toThrow('Failed to initialize output device');
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().error).toContain('Failed to initialize output device');
  });
});
