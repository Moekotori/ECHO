import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithStdioTuple } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import electron from 'electron';
import { getEqBridge } from './EqBridge';
import type {
  NativeHostNotificationEvent,
  NativeBridgeReadyMessage,
  NativeBridgeReadyResult,
  NativeOutputTelemetry,
  NativeOutputStartOptions,
} from './audioTypes';
import type { AutomixTransitionPlan } from './AutomixPlanner';

type BridgeSpawnOptions = SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'> & {
  windowsHide: boolean;
};

export type HostSpawner = (
  file: string,
  args: string[],
  options: BridgeSpawnOptions,
) => ChildProcessWithoutNullStreams;

export type NativeOutputBridgeDependencies = {
  hostBinary?: string | null;
  platform?: NodeJS.Platform;
  spawn?: HostSpawner;
  readyTimeoutMs?: number;
  logger?: (message: string) => void;
};

export type HostBinaryResolveOptions = {
  cwd?: string;
  appPath?: string | null;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
  isExecutable?: (path: string) => boolean;
  includeMigrationFallback?: boolean;
};

const getElectronAppPath = (): string | null => {
  const electronApp = (electron as unknown as { app?: { getAppPath: () => string } }).app;

  try {
    return electronApp?.getAppPath?.() ?? null;
  } catch {
    return null;
  }
};

const defaultLogger = (message: string): void => {
  console.warn(message);
};

const verboseAudioLogsEnabled = process.env.ECHO_VERBOSE_AUDIO_LOGS === '1';

const sharedReadyTimeoutMs = 15_000;
const slowNativeModeReadyTimeoutMs = 45_000;
const sharedGracefulStopTimeoutMs = 2_500;
const exclusiveGracefulStopTimeoutMs = 4_000;
const forceKilledExitWaitMs = 1_000;
const forceKilledReleaseSettleMs = 200;
const maxPositionExtrapolationMs = 250;
const lowLatencyMaxBufferSizeFrames = 2048;
const nativeHostNotificationEvents = new Set<NativeHostNotificationEvent['event']>([
  'default_device_changed',
  'device_state_changed',
  'device_removed',
  'audio_session_disconnected',
]);

const appendTailLine = (lines: string[], line: string): void => {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  lines.push(trimmed);
  if (lines.length > 8) {
    lines.shift();
  }
};

const windowsCrashCodes: Record<number, string> = {
  0xc0000005: 'access_violation',
};

const signedExitCode = (exitCode: number): number =>
  exitCode > 0x7fffffff ? exitCode - 0x1_0000_0000 : exitCode;

const matchesExitCode = (exitCode: number | null, expected: number): boolean =>
  exitCode !== null && (exitCode === expected || signedExitCode(exitCode) === expected);

const formatExitCodeHex = (exitCode: number): string => `0x${(exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

const getNativeCrashDetails = (reason: string): string[] => {
  const match = /^exit_code_(-?\d+)$/.exec(reason);

  if (!match) {
    return [];
  }

  const exitCode = Number(match[1]);
  if (!Number.isInteger(exitCode)) {
    return [];
  }

  const unsignedExitCode = exitCode >>> 0;
  const crashName = windowsCrashCodes[unsignedExitCode];

  return crashName ? [`exitCodeHex=${formatExitCodeHex(exitCode)}`, `nativeCrash=${crashName}`] : [];
};

const isLikelyExecutableHostBinary = (path: string): boolean => {
  if (process.platform !== 'win32') {
    return true;
  }

  try {
    const header = readFileSync(path).subarray(0, 2);
    return header.length === 2 && header[0] === 0x4d && header[1] === 0x5a;
  } catch {
    return false;
  }
};

const isNativeHostNotificationEvent = (event: unknown): event is NativeHostNotificationEvent['event'] =>
  typeof event === 'string' && nativeHostNotificationEvents.has(event as NativeHostNotificationEvent['event']);

const parseNativeHostNotification = (
  message: Record<string, unknown> & { event?: unknown },
): NativeHostNotificationEvent | null => {
  if (!isNativeHostNotificationEvent(message.event)) {
    return null;
  }

  const notification: NativeHostNotificationEvent = {
    event: message.event,
  };

  if (typeof message.deviceId === 'string') {
    notification.deviceId = message.deviceId;
  }
  if (typeof message.reason === 'string') {
    notification.reason = message.reason;
  }
  if (typeof message.code === 'number' && Number.isFinite(message.code)) {
    notification.code = Math.max(0, Math.round(message.code));
  }
  if (typeof message.currentDevice === 'boolean') {
    notification.currentDevice = message.currentDevice;
  }
  if (typeof message.followsDefaultDevice === 'boolean') {
    notification.followsDefaultDevice = message.followsDefaultDevice;
  }

  return notification;
};

const sanitizeHostBufferSizeFrames = (
  options: NativeOutputStartOptions,
  bufferSizeFrames: number,
): number | null => {
  if (options.latencyProfile !== 'lowLatency' || bufferSizeFrames <= lowLatencyMaxBufferSizeFrames) {
    return bufferSizeFrames;
  }

  if (options.asio || options.exclusive) {
    return lowLatencyMaxBufferSizeFrames;
  }

  return null;
};

const formatHostDetailValue = (value: string): string =>
  value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');

const createHostError = (
  reason: string,
  hostBinary: string,
  args: string[],
  stderrLines: string[],
  metadata: { elapsedMs: number; mode: 'shared' | 'exclusive' | 'asio'; nativeMessage?: string | null },
): Error => {
  const stderr = stderrLines.join(' | ');
  const details = [
    `host="${formatHostDetailValue(hostBinary)}"`,
    `args="${formatHostDetailValue(args.join(' '))}"`,
    `mode="${metadata.mode}"`,
    `elapsedMs=${Math.max(0, Math.round(metadata.elapsedMs))}`,
    ...getNativeCrashDetails(reason),
  ];

  if (metadata.nativeMessage) {
    details.push(`nativeMessage="${formatHostDetailValue(metadata.nativeMessage)}"`);
  }

  if (stderr) {
    details.push(`stderrTail="${formatHostDetailValue(stderr)}"`);
  }

  return new Error(`echo-audio-host ${reason}; ${details.join('; ')}`);
};

export const resolveHostBinary = (options: HostBinaryResolveOptions = {}): string | null => {
  const exe = process.platform === 'win32' ? 'echo-audio-host.exe' : 'echo-audio-host';
  const appPath = options.appPath === undefined ? getElectronAppPath() : options.appPath;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const isExecutable = options.isExecutable ?? isLikelyExecutableHostBinary;
  const includeMigrationFallback = options.includeMigrationFallback ?? true;
  const candidates: string[] = [];

  if (resourcesPath) {
    candidates.push(join(resourcesPath, exe));
  }

  if (appPath) {
    candidates.push(join(appPath, '..', exe));
    candidates.push(join(appPath, '..', '..', 'electron-app', 'build', exe));
    candidates.push(join(appPath, 'electron-app', 'build', exe));
  }

  candidates.push(join(cwd, 'electron-app', 'build', exe));
  candidates.push(join(cwd, 'build', exe));

  if (includeMigrationFallback) {
    // Local migration fallback only. Dev and production should use ECHO Next's
    // own electron-app/build copy or the packaged resourcesPath binary.
    candidates.push(join(cwd, '..', 'ECHO', 'electron-app', 'build', exe));
  }

  return candidates.find((candidate) => exists(candidate) && isExecutable(candidate)) ?? null;
};

export const isNativeOutputBridgeAvailable = (): boolean => resolveHostBinary() !== null;

class BridgeWritable extends Writable {
  private isClosed = false;

  constructor(
    private readonly target: Writable,
    onTargetError?: (error: Error) => void,
  ) {
    super();

    target.on('error', (err) => {
      this.isClosed = true;
      const error = err instanceof Error ? err : new Error(String(err));
      onTargetError?.(error);
      this.destroy(onTargetError ? undefined : error);
    });
    target.on('close', () => {
      this.isClosed = true;
    });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isClosed || this.target.destroyed || this.target.writableEnded || !this.target.writable) {
      this.isClosed = true;
      callback();
      return;
    }

    try {
      this.target.write(chunk, (error: Error | null | undefined) => {
        if (error) {
          this.isClosed = true;
          callback(error);
          return;
        }

        callback();
      });
    } catch (error) {
      this.isClosed = true;
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.isClosed || this.target.destroyed || this.target.writableEnded || !this.target.writable) {
      callback();
      return;
    }

    try {
      this.target.end(callback);
    } catch (error) {
      this.isClosed = true;
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

const framedMagic = 'ECNP';
const framedVersion = 1;
const frameTypeBeginSession = 1;
const frameTypePcmF32Le = 2;
const frameTypeEndSession = 3;
const frameTypeShutdown = 4;
const frameTypeSetVolume = 5;
const frameTypeDop24Le = 6;
const frameTypeNativeDsdRaw = 7;
const frameTypeAutomixPrepare = 8;
const frameTypeAutomixNextPcmF32Le = 9;
const frameTypeAutomixNextEnd = 10;
const frameTypeAutomixCancel = 11;
const frameTypeSetPaused = 12;

const createFrameHeader = (type: number, sessionId: number, payloadBytes: number): Buffer => {
  const header = Buffer.alloc(16);
  header.write(framedMagic, 0, 'ascii');
  header.writeUInt8(framedVersion, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(sessionId >>> 0, 8);
  header.writeUInt32LE(Math.max(0, payloadBytes) >>> 0, 12);
  return header;
};

const normalizeOutputMode = (options: NativeOutputStartOptions): 'shared' | 'exclusive' | 'asio' =>
  options.asio ? 'asio' : options.exclusive ? 'exclusive' : 'shared';

type NativeOutputMode = ReturnType<typeof normalizeOutputMode>;

export const normalizeSharedBackendForHost = (
  sharedBackend: NativeOutputStartOptions['sharedBackend'],
  platform: NodeJS.Platform = process.platform,
): 'auto' | 'windows' | 'directsound' | 'alsa' => {
  if (platform === 'win32') {
    return sharedBackend === 'windows' || sharedBackend === 'directsound' ? sharedBackend : 'auto';
  }

  if (platform === 'linux') {
    return sharedBackend === 'alsa' ? 'alsa' : 'auto';
  }

  return 'auto';
};

type PendingGracefulStop = {
  promise: Promise<void>;
  resolve: () => void;
  proc: ChildProcessWithoutNullStreams;
  timeout: NodeJS.Timeout | null;
  waitForExit: boolean;
  forceKilledAtMs: number | null;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

const createReuseKey = (options: NativeOutputStartOptions, platform: NodeJS.Platform = process.platform): string => {
  const outputMode = normalizeOutputMode(options);
  const sampleRate =
    outputMode === 'shared'
      ? normalizePositiveInteger(options.sharedMixSampleRate) ?? normalizePositiveInteger(options.requestedOutputSampleRate)
      : normalizePositiveInteger(options.requestedOutputSampleRate);
  const rawBufferSizeFrames = normalizePositiveInteger(options.bufferSizeFrames);
  const bufferSizeFrames = rawBufferSizeFrames !== null
    ? sanitizeHostBufferSizeFrames(options, rawBufferSizeFrames)
    : null;

  return JSON.stringify({
    outputMode: options.asio ? 'asio' : options.exclusive ? 'exclusive' : 'shared',
    deviceIndex: Number.isInteger(Number(options.deviceIndex)) ? Number(options.deviceIndex) : null,
    deviceName: options.deviceName ?? null,
    asioOutputChannelStart: outputMode === 'asio' && Number.isInteger(Number(options.asioOutputChannelStart))
      ? Number(options.asioOutputChannelStart)
      : null,
    sharedBackend: outputMode === 'shared' ? normalizeSharedBackendForHost(options.sharedBackend, platform) : null,
    sampleRate,
    channels: options.channels,
    asio: options.asio === true,
    exclusive: options.exclusive === true,
    useJuceOutput: options.useJuceOutput === true,
    bufferSizeFrames,
    latencyProfile: options.latencyProfile ?? null,
    playbackSpeedMode: options.playbackSpeedMode ?? null,
    inputFormat: options.inputFormat ?? 'pcm-f32le',
    asioNativeDsdOutput: options.asioNativeDsdOutput === true,
    nativeDsdSampleRate: options.nativeDsdSampleRate ?? null,
  });
};

class FramedSessionWritable extends Writable {
  private sessionClosed = false;

  constructor(
    private readonly owner: NativeOutputBridge,
    private readonly sessionId: number,
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.sessionClosed) {
      callback(new Error('native output session is already closed'));
      return;
    }

    if (this.owner.inputFormat === 'dsd-native-raw') {
      this.owner.writeNativeDsdFrame(this.sessionId, chunk, callback);
      return;
    }

    if (this.owner.inputFormat === 'dop24le') {
      this.owner.writeDopFrame(this.sessionId, chunk, callback);
      return;
    }

    this.owner.writePcmFrame(this.sessionId, chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.sessionClosed) {
      callback();
      return;
    }

    this.owner.endSession(this.sessionId, (error) => {
      this.sessionClosed = true;
      callback(error);
    });
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.sessionClosed = true;
    callback(error);
  }
}

class AutomixNextDeckWritable extends Writable {
  private isClosed = false;

  constructor(private readonly owner: NativeOutputBridge) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback(new Error('native automix next deck is already closed'));
      return;
    }

    this.owner.writeAutomixNextPcmFrame(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback();
      return;
    }

    this.owner.endAutomixNextDeck(callback);
    this.isClosed = true;
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.isClosed = true;
    callback(error);
  }
}

export class NativeOutputBridge extends EventEmitter {
  private readonly spawn: HostSpawner;
  private readonly platform: NodeJS.Platform;
  private readonly readyTimeoutMs: number;
  private readonly logger: (message: string) => void;
  private hostBinary: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private bridgeWritable: BridgeWritable | null = null;
  private sessionWritable: FramedSessionWritable | null = null;
  private sessionIdCounter = 0;
  private currentSessionId = 0;
  private currentSessionHasPcm = false;
  private reuseKey: string | null = null;
  private framesConsumed = 0;
  private frameOffset = 0;
  private requestedOutputSampleRate = 44100;
  private actualDeviceSampleRate: number | null = null;
  private durationSeconds: number | null = null;
  private lastPositionReportedAtMs: number | null = null;
  private telemetry: NativeOutputTelemetry = {
    positionFrames: 0,
    bufferedFrames: null,
    underrunCallbacks: 0,
    underrunFrames: 0,
    dspClippingRisk: false,
    dspLimiterProtecting: false,
    reportedAtMs: null,
    nativePositionStalenessMs: null,
  };
  private startSeconds = 0;
  private playbackRate = 1;
  private ready = false;
  private ended = false;
  private stopRequested = false;
  private readyTimer: NodeJS.Timeout | null = null;
  private readyMessage: NativeBridgeReadyMessage | null = null;
  private eqControlPort: number | null = null;
  private pendingGracefulStop: PendingGracefulStop | null = null;
  private stdoutReadline: readline.Interface | null = null;
  private stderrReadline: readline.Interface | null = null;
  private shutdownAckReceived = false;
  private lastOutputMode: NativeOutputMode | null = null;
  inputFormat: NativeOutputStartOptions['inputFormat'] = 'pcm-f32le';

  constructor(dependencies: NativeOutputBridgeDependencies = {}) {
    super();
    this.hostBinary = dependencies.hostBinary ?? null;
    this.platform = dependencies.platform ?? process.platform;
    this.spawn = dependencies.spawn ?? nodeSpawn;
    this.readyTimeoutMs = dependencies.readyTimeoutMs ?? sharedReadyTimeoutMs;
    this.logger = dependencies.logger ?? defaultLogger;
    this.on('error', () => undefined);
  }

  get writable(): Writable | null {
    return this.bridgeWritable;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get deviceInfo(): NativeBridgeReadyMessage | null {
    return this.readyMessage;
  }

  get requestedSampleRate(): number {
    return this.requestedOutputSampleRate;
  }

  get actualSampleRate(): number | null {
    return this.actualDeviceSampleRate;
  }

  private logVerbose(message: string): void {
    if (!verboseAudioLogsEnabled) {
      return;
    }

    this.logger(message);
  }

  async start(options: NativeOutputStartOptions): Promise<NativeBridgeReadyResult> {
    return new Promise((resolve, reject) => {
      const bin = this.hostBinary ?? resolveHostBinary();

      if (!bin) {
        reject(new Error('echo-audio-host binary not found'));
        return;
      }

      this.hostBinary = bin;
      this.requestedOutputSampleRate = options.requestedOutputSampleRate;
      this.actualDeviceSampleRate = null;
      this.durationSeconds =
        typeof options.durationSeconds === 'number' && Number.isFinite(options.durationSeconds) && options.durationSeconds > 0
          ? options.durationSeconds
          : null;
      this.lastPositionReportedAtMs = null;
      this.telemetry = {
        positionFrames: 0,
        bufferedFrames: null,
        underrunCallbacks: 0,
        underrunFrames: 0,
        reportedAtMs: null,
        nativePositionStalenessMs: null,
      };
      this.startSeconds = options.startSeconds ?? 0;
      this.playbackRate = options.playbackRate ?? 1;
      this.framesConsumed = 0;
      this.frameOffset = 0;
      this.sessionIdCounter = 0;
      this.currentSessionId = 0;
      this.currentSessionHasPcm = false;
      this.reuseKey = createReuseKey(options, this.platform);
      this.ready = false;
      this.ended = false;
      this.stopRequested = false;
      this.readyMessage = null;
      this.eqControlPort = getEqBridge().reserveControlPort();
      this.shutdownAckReceived = false;
      this.inputFormat = options.inputFormat ?? 'pcm-f32le';

      const args = this.createSpawnArgs(options);
      const stderrLines: string[] = [];
      const startedAtMs = performance.now();
      const mode = options.asio ? 'asio' : options.exclusive ? 'exclusive' : 'shared';
      this.lastOutputMode = mode;
      const createError = (reason: string, nativeMessage?: string | null): Error =>
        createHostError(reason, bin, args, stderrLines, {
          elapsedMs: performance.now() - startedAtMs,
          mode,
          nativeMessage,
        });
      let settled = false;
      const settleResolve = (value: NativeBridgeReadyResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };
      const settleReject = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      this.logVerbose(`[NativeOutputBridge] spawn: ${bin} ${args.join(' ')}`);
      this.proc = this.spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const spawnedProc = this.proc;
      const handleStdinFailure = (error: Error) => {
        if (this.proc !== spawnedProc && this.pendingGracefulStop?.proc !== spawnedProc) {
          return;
        }

        const wasReady = this.ready;
        const intentional = this.stopRequested;
        const hostError = createError(
          `stdin_error:${error instanceof Error ? error.message : String(error)}`,
        );
        this.ready = false;
        this.clearReadyTimer();

        if (intentional || this.ended) {
          return;
        }

        if (!wasReady) {
          settleReject(hostError);
          return;
        }

        this.emit('error', hostError);
      };
      this.bridgeWritable = new BridgeWritable(this.proc.stdin, handleStdinFailure);
      this.bridgeWritable.on('error', handleStdinFailure);

      this.stdoutReadline = readline.createInterface({ input: this.proc.stdout });
      const stdout = this.stdoutReadline;
      stdout.on('line', (line) => {
        this.handleStdoutLine(line, settleResolve, settleReject, spawnedProc, createError);
      });

      this.stderrReadline = readline.createInterface({ input: this.proc.stderr });
      const stderr = this.stderrReadline;
      stderr.on('line', (line) => {
        appendTailLine(stderrLines, line);
        this.logVerbose(`[echo-audio-host] ${line}`);
      });

      this.proc.on('error', (error) => {
        const hostError = createError(`spawn_error:${error.message}`);
        this.clearReadyTimer();
        settleReject(hostError);
        if (this.ready) {
          this.emit('error', hostError);
        }
      });

      this.proc.on('exit', (code, signal) => {
        if (this.proc !== spawnedProc && this.pendingGracefulStop?.proc !== spawnedProc) {
          return;
        }

        const wasReady = this.ready;
        const intentional = this.stopRequested;
        this.ready = false;
        this.stopRequested = false;
        this.clearReadyTimer();
        this.closeReadlineInterfaces();

        if (this.pendingGracefulStop?.proc === spawnedProc) {
          this.logVerbose('[NativeOutputBridge] process exited during graceful shutdown');
          this.resolvePendingGracefulStop();
          return;
        }

        if (intentional || this.ended || code === 0) {
          return;
        }

        const reason =
          matchesExitCode(code, -2)
            ? 'exclusive_denied'
            : matchesExitCode(code, -3)
              ? 'device_initialize_timeout'
            : code != null ? `exit_code_${code}` : `exit_signal_${signal ?? '?'}`;
        const error = createError(reason);

        if (!wasReady) {
          settleReject(error);
          return;
        }

        this.emit('error', error);
      });

      this.clearReadyTimer();
      const readyTimeoutMs =
        options.exclusive || options.asio
          ? Math.max(this.readyTimeoutMs, slowNativeModeReadyTimeoutMs)
          : this.readyTimeoutMs;
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (!this.ready) {
          this.stop();
          settleReject(createError('timeout_waiting_for_ready'));
        }
      }, readyTimeoutMs);
    });
  }

  getPositionSeconds(): number {
    const sampleRate = this.actualDeviceSampleRate ?? this.requestedOutputSampleRate;

    if (sampleRate <= 0) {
      return this.startSeconds;
    }

    const localFrames = Math.max(0, this.framesConsumed - this.frameOffset);
    let positionSeconds = this.startSeconds + (localFrames / sampleRate) * this.playbackRate;

    if (this.ready && !this.ended && this.lastPositionReportedAtMs !== null) {
      const elapsedMs = Math.max(0, performance.now() - this.lastPositionReportedAtMs);
      const extrapolatedMs = Math.min(elapsedMs, maxPositionExtrapolationMs);
      positionSeconds += (extrapolatedMs / 1000) * this.playbackRate;
    }

    return this.durationSeconds !== null ? Math.min(positionSeconds, this.durationSeconds) : positionSeconds;
  }

  getPositionStalenessMs(): number | null {
    if (this.lastPositionReportedAtMs === null) {
      return null;
    }

    return Math.max(0, Math.round(performance.now() - this.lastPositionReportedAtMs));
  }

  resetOutputClock(startSeconds = 0, playbackRate = 1): void {
    this.framesConsumed = 0;
    this.frameOffset = 0;
    this.startSeconds = startSeconds;
    this.playbackRate = playbackRate;
    this.lastPositionReportedAtMs = null;
    this.ended = false;
  }

  rebaseOutputClock(startSeconds = 0, playbackRate = this.playbackRate): void {
    this.frameOffset = this.framesConsumed;
    this.startSeconds = Math.max(0, startSeconds);
    this.playbackRate = playbackRate;
    this.ended = false;
  }

  canReuseFor(options: NativeOutputStartOptions): boolean {
    if (this.pendingGracefulStop) {
      return false;
    }

    const stdin = this.proc?.stdin;
    if (normalizeOutputMode(options) === 'asio') {
      return false;
    }

    return Boolean(
      this.ready &&
      this.proc &&
      stdin &&
      !stdin.destroyed &&
      !stdin.writableEnded &&
      stdin.writable &&
      this.reuseKey === createReuseKey(options, this.platform),
    );
  }

  beginSession(options: { startSeconds?: number; playbackRate?: number; durationSeconds?: number } = {}): number {
    if (!this.proc || this.proc.stdin.destroyed || this.proc.stdin.writableEnded || !this.proc.stdin.writable) {
      throw new Error('native output bridge is not writable');
    }

    const sessionId = (this.sessionIdCounter + 1) >>> 0;
    this.sessionIdCounter = sessionId;
    this.currentSessionId = sessionId;
    this.currentSessionHasPcm = false;
    this.sessionWritable?.destroy();
    this.sessionWritable = null;
    this.durationSeconds =
      typeof options.durationSeconds === 'number' && Number.isFinite(options.durationSeconds) && options.durationSeconds > 0
        ? options.durationSeconds
        : null;
    this.resetOutputClock(options.startSeconds ?? 0, options.playbackRate ?? 1);
    this.telemetry = {
      positionFrames: 0,
      bufferedFrames: null,
      underrunCallbacks: 0,
      underrunFrames: 0,
      reportedAtMs: null,
      nativePositionStalenessMs: null,
    };
    this.writeFrame(frameTypeBeginSession, sessionId, Buffer.alloc(0));
    return sessionId;
  }

  createSessionWritable(sessionId = this.currentSessionId): Writable {
    if (!sessionId) {
      throw new Error('native output bridge session has not begun');
    }

    const writable = new FramedSessionWritable(this, sessionId);
    this.sessionWritable = writable;
    return writable;
  }

  prepareAutomixPlan(plan: AutomixTransitionPlan, options: { fadeStartSeconds: number; sampleRate?: number | null }): void {
    if (!this.currentSessionId) {
      return;
    }

    const payload = Buffer.from(JSON.stringify({
      fadeStartSeconds: Math.max(0, Number(options.fadeStartSeconds) || 0),
      overlapSeconds: Math.max(0.001, Number(plan.overlapSeconds) || 0.001),
      currentGainDb: Number.isFinite(plan.currentGainDb) ? plan.currentGainDb : 0,
      nextGainDb: Number.isFinite(plan.nextGainDb) ? plan.nextGainDb : 0,
      tempoRatio: Number.isFinite((plan as { tempoRatio?: number }).tempoRatio)
        ? (plan as { tempoRatio?: number }).tempoRatio
        : 1,
      mode: plan.mode,
      sampleRate: Number.isFinite(options.sampleRate) ? options.sampleRate : null,
    }), 'utf8');
    this.writeFrame(frameTypeAutomixPrepare, this.currentSessionId, payload);
  }

  createAutomixNextWritable(): Writable {
    if (!this.currentSessionId) {
      throw new Error('native output bridge session has not begun');
    }

    return new AutomixNextDeckWritable(this);
  }

  cancelAutomix(): void {
    this.writeFrame(frameTypeAutomixCancel, this.currentSessionId, Buffer.alloc(0));
  }

  endSession(sessionId = this.currentSessionId, callback?: (error?: Error | null) => void): void {
    if (!sessionId || !this.proc || this.proc.stdin.destroyed || this.proc.stdin.writableEnded || !this.proc.stdin.writable) {
      callback?.();
      return;
    }

    this.writeFrame(frameTypeEndSession, sessionId, Buffer.alloc(0), callback);
  }

  setVolume(volume: number): void {
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    const payload = Buffer.alloc(4);
    payload.writeFloatLE(safeVolume, 0);
    this.writeFrame(frameTypeSetVolume, 0, payload);
  }

  setPaused(paused: boolean): void {
    if (!this.currentSessionId) {
      return;
    }

    this.writeFrame(frameTypeSetPaused, this.currentSessionId, Buffer.from([paused ? 1 : 0]));
  }

  writePcmFrame(sessionId: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    if (sessionId === this.currentSessionId) {
      this.currentSessionHasPcm = true;
    }

    this.writeFrame(frameTypePcmF32Le, sessionId, chunk, callback);
  }

  writeDopFrame(sessionId: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    if (sessionId === this.currentSessionId) {
      this.currentSessionHasPcm = true;
    }

    this.writeFrame(frameTypeDop24Le, sessionId, chunk, callback);
  }

  writeNativeDsdFrame(sessionId: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    if (sessionId === this.currentSessionId) {
      this.currentSessionHasPcm = true;
    }

    this.writeFrame(frameTypeNativeDsdRaw, sessionId, chunk, callback);
  }

  writeAutomixNextPcmFrame(chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    this.writeFrame(frameTypeAutomixNextPcmF32Le, this.currentSessionId, chunk, callback);
  }

  endAutomixNextDeck(callback?: (error?: Error | null) => void): void {
    this.writeFrame(frameTypeAutomixNextEnd, this.currentSessionId, Buffer.alloc(0), callback);
  }

  stop(): void {
    this.clearReadyTimer();
    this.stopRequested = true;

    const pendingGracefulStop = this.pendingGracefulStop;
    if (pendingGracefulStop) {
      if (pendingGracefulStop.timeout) {
        clearTimeout(pendingGracefulStop.timeout);
      }
      this.pendingGracefulStop = null;
      pendingGracefulStop.resolve();
    }

    if (this.bridgeWritable) {
      try {
        this.bridgeWritable.destroy();
      } catch {
        // Best-effort child cleanup.
      }
      this.bridgeWritable = null;
    }

    if (this.sessionWritable) {
      try {
        this.sessionWritable.destroy();
      } catch {
        // Best-effort child cleanup.
      }
      this.sessionWritable = null;
    }

    if (this.proc) {
      try {
        this.writeFrame(frameTypeShutdown, 0, Buffer.alloc(0));
      } catch {
        // Best-effort child cleanup.
      }

      try {
        this.proc.stdin.destroy();
      } catch {
        // Best-effort child cleanup.
      }

      try {
        this.proc.kill('SIGKILL');
      } catch {
        // Best-effort child cleanup.
      }

      this.proc = null;
    }

    this.cleanupBridgeReferences();
  }

  stopGracefully(reason = 'stop', timeoutMs?: number, waitForExit = false): Promise<void> {
    if (this.pendingGracefulStop) {
      return this.pendingGracefulStop.promise;
    }

    this.logVerbose(`[NativeOutputBridge] graceful shutdown requested: ${reason}`);
    this.clearReadyTimer();
    this.stopRequested = true;

    const proc = this.proc;
    if (!proc) {
      this.cleanupBridgeReferences();
      return Promise.resolve();
    }

    if (this.sessionWritable) {
      try {
        this.sessionWritable.destroy();
      } catch {
        // Best-effort graceful child cleanup.
      }
      this.sessionWritable = null;
    }

    if (this.bridgeWritable) {
      try {
        this.bridgeWritable.destroy();
      } catch {
        // Best-effort graceful child cleanup.
      }
      this.bridgeWritable = null;
    }

    const selectedTimeoutMs =
      timeoutMs ?? (this.lastOutputMode === 'exclusive' || this.lastOutputMode === 'asio'
        ? exclusiveGracefulStopTimeoutMs
        : sharedGracefulStopTimeoutMs);

    let resolveStop = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });

    const pendingGracefulStop: PendingGracefulStop = {
      promise,
      resolve: resolveStop,
      proc,
      timeout: null,
      waitForExit,
      forceKilledAtMs: null,
    };
    this.pendingGracefulStop = pendingGracefulStop;

    try {
      this.writeFrame(frameTypeShutdown, 0, Buffer.alloc(0));
    } catch {
      // Best-effort graceful child cleanup.
    }

    try {
      if (!proc.stdin.destroyed && !proc.stdin.writableEnded) {
        proc.stdin.end();
      }
    } catch {
      // The host may already have exited or closed stdin.
    }

    if (this.pendingGracefulStop?.proc === proc) {
      pendingGracefulStop.timeout = setTimeout(() => {
        if (this.pendingGracefulStop?.proc !== proc) {
          return;
        }

        this.logVerbose('[NativeOutputBridge] graceful shutdown timed out; killing host');
        try {
          proc.kill('SIGKILL');
        } catch {
          // Best-effort emergency cleanup.
        }
        pendingGracefulStop.forceKilledAtMs = performance.now();
        if (pendingGracefulStop.waitForExit) {
          pendingGracefulStop.timeout = setTimeout(() => {
            if (this.pendingGracefulStop?.proc !== proc) {
              return;
            }

            this.logVerbose('[NativeOutputBridge] killed host did not report exit; continuing shutdown');
            this.resolvePendingGracefulStop();
          }, forceKilledExitWaitMs);
          pendingGracefulStop.timeout?.unref?.();
          return;
        }
        this.resolvePendingGracefulStop();
      }, Math.max(1, selectedTimeoutMs));
      pendingGracefulStop.timeout?.unref?.();
    }

    return promise;
  }

  private createSpawnArgs(options: NativeOutputStartOptions): string[] {
    const args = ['-sr', String(options.requestedOutputSampleRate), '-ch', String(options.channels)];
    const deviceIndex = Number(options.deviceIndex ?? -1);

    if (options.deviceName) {
      args.push('-device', options.deviceName);
    }

    if (Number.isInteger(deviceIndex) && deviceIndex >= 0) {
      args.push('-device-index', String(deviceIndex));
    }

    if (options.asio) {
      args.push('-asio');
      const asioOutputChannelStart = Number(options.asioOutputChannelStart);
      if (Number.isInteger(asioOutputChannelStart) && asioOutputChannelStart > 0) {
        args.push('-asio-output-channel-start', String(asioOutputChannelStart));
      }
    }

    if (options.exclusive && !options.asio) {
      args.push('-exclusive');
    }

    if (options.useJuceOutput === true) {
      args.push('-juce-output');
    }

    if (options.inputFormat === 'dop24le') {
      args.push('-dop-output');
    }

    if (options.inputFormat === 'dsd-native-raw' || options.asioNativeDsdOutput === true) {
      args.push('-dop-output', '-asio-native-dsd-output');
      const nativeDsdSampleRate = Number(options.nativeDsdSampleRate);
      if (Number.isFinite(nativeDsdSampleRate) && nativeDsdSampleRate > 0) {
        args.push('-native-dsd-sr', String(Math.round(nativeDsdSampleRate)));
      }
    }

    const sharedBackend = normalizeSharedBackendForHost(options.sharedBackend, this.platform);
    if (!options.exclusive && !options.asio && sharedBackend !== 'auto') {
      args.push('-shared-backend', sharedBackend);
    }

    const volume = Number(options.volume ?? 1);
    if (Number.isFinite(volume) && Math.abs(volume - 1) > 1e-6) {
      args.push('-vol', String(Math.max(0, Math.min(1, volume))));
    }

    const bufferSizeFrames = Number(options.bufferSizeFrames);
    if (Number.isFinite(bufferSizeFrames) && bufferSizeFrames > 0) {
      const sanitizedBufferSizeFrames = sanitizeHostBufferSizeFrames(options, Math.round(bufferSizeFrames));
      if (sanitizedBufferSizeFrames !== null) {
        args.push('-buffer', String(sanitizedBufferSizeFrames));
      } else {
        this.logger(
          `[NativeOutputBridge] low_latency_buffer_ignored; requestedBuffer=${Math.round(bufferSizeFrames)}`,
        );
      }
    }

    const fifoCapacityMs = Number(options.fifoCapacityMs);
    if (!options.exclusive && !options.asio && Number.isFinite(fifoCapacityMs) && fifoCapacityMs > 0) {
      args.push('-fifo-ms', String(Math.round(fifoCapacityMs)));
    }

    const startupPrebufferMs = Number(options.startupPrebufferMs);
    if (Number.isFinite(startupPrebufferMs) && startupPrebufferMs >= 0) {
      args.push('-prebuffer-ms', String(Math.round(startupPrebufferMs)));
    }

    const startupPrebufferTimeoutMs = Number(options.startupPrebufferTimeoutMs);
    if (Number.isFinite(startupPrebufferTimeoutMs) && startupPrebufferTimeoutMs >= 0) {
      args.push('-prebuffer-timeout-ms', String(Math.round(startupPrebufferTimeoutMs)));
    }

    if (this.eqControlPort) {
      args.push('-eq-port', String(this.eqControlPort));
    }

    args.push('-framed-stdin');

    return args;
  }

  private writeFrame(
    type: number,
    sessionId: number,
    payload: Buffer,
    callback?: (error?: Error | null) => void,
  ): void {
    const target = this.proc?.stdin;

    if (!target || target.destroyed || target.writableEnded || !target.writable) {
      callback?.();
      return;
    }

    const frame = payload.length > 0
      ? Buffer.concat([createFrameHeader(type, sessionId, payload.length), payload])
      : createFrameHeader(type, sessionId, 0);

    try {
      target.write(frame, (error: Error | null | undefined) => {
        callback?.(error ?? null);
      });
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleStdoutLine(
    line: string,
    resolveReady: (value: NativeBridgeReadyResult) => void,
    rejectReady: (error: Error) => void,
    sourceProc?: ChildProcessWithoutNullStreams,
    createError?: (reason: string, nativeMessage?: string | null) => Error,
  ): void {
    let message: NativeBridgeReadyMessage & { pos?: unknown; event?: unknown; message?: unknown; error?: unknown; reason?: unknown };

    try {
      message = JSON.parse(line) as NativeBridgeReadyMessage & { pos?: unknown; event?: unknown };
    } catch {
      return;
    }

    if (message.event === 'shutdown-ack') {
      if (this.pendingGracefulStop && (!sourceProc || this.pendingGracefulStop.proc === sourceProc)) {
        this.shutdownAckReceived = true;
        this.logger('[NativeOutputBridge] shutdown-ack received');
        if (this.pendingGracefulStop.waitForExit) {
          return;
        }
        this.resolvePendingGracefulStop();
      }
      return;
    }

    if (sourceProc && this.proc !== sourceProc) {
      return;
    }

    const nativeNotification = parseNativeHostNotification(message);
    if (nativeNotification) {
      if (sourceProc && this.proc !== sourceProc) return;
      this.emit('device-event', nativeNotification);
      return;
    }

    if (message.ready) {
      this.ready = true;
      this.readyMessage = message;
      this.clearReadyTimer();

      if (typeof message.sampleRate === 'number' && message.sampleRate > 0) {
        this.actualDeviceSampleRate = message.sampleRate;
      }

      const eqControlPort =
        typeof message.eqControlPort === 'number' && message.eqControlPort > 0
          ? message.eqControlPort
          : this.eqControlPort;
      if (eqControlPort) {
        getEqBridge().connect(eqControlPort);
      }

      const result: NativeBridgeReadyResult = {
        ok: true,
        device: message,
        requestedOutputSampleRate: this.requestedOutputSampleRate,
        actualDeviceSampleRate: this.actualDeviceSampleRate,
      };
      this.emit('ready', result);
      resolveReady(result);
    }

    if (typeof message.pos === 'number') {
      const reportedAtMs = performance.now();
      this.framesConsumed = Math.max(0, message.pos);
      this.lastPositionReportedAtMs = reportedAtMs;
      this.telemetry = {
        positionFrames: this.framesConsumed,
        bufferedFrames:
          typeof message.bufferedFrames === 'number' && Number.isFinite(message.bufferedFrames)
            ? Math.max(0, Math.round(message.bufferedFrames))
            : this.telemetry.bufferedFrames,
        underrunCallbacks:
          typeof message.underrunCallbacks === 'number' && Number.isFinite(message.underrunCallbacks)
            ? Math.max(0, Math.round(message.underrunCallbacks))
            : this.telemetry.underrunCallbacks,
        underrunFrames:
          typeof message.underrunFrames === 'number' && Number.isFinite(message.underrunFrames)
            ? Math.max(0, Math.round(message.underrunFrames))
            : this.telemetry.underrunFrames,
        dspClippingRisk:
          typeof message.dspClippingRisk === 'boolean'
            ? message.dspClippingRisk
            : this.telemetry.dspClippingRisk,
        dspLimiterProtecting:
          typeof message.dspLimiterProtecting === 'boolean'
            ? message.dspLimiterProtecting
            : this.telemetry.dspLimiterProtecting,
        reportedAtMs,
        nativePositionStalenessMs: 0,
      };
      this.emit('position', this.framesConsumed, this.telemetry);
    }

    if (message.event === 'ended') {
      if (this.stopRequested || this.ended) {
        return;
      }

      if (!this.currentSessionId) {
        return;
      }

      this.ended = true;
      this.emit('ended');
    }

    if (message.event === 'error') {
      const nativeMessage =
        typeof message.message === 'string'
          ? message.message
          : typeof message.error === 'string'
            ? message.error
            : null;
      const nativeReason =
        typeof message.reason === 'string' && /^[a-z0-9_.:-]+$/iu.test(message.reason)
          ? message.reason
          : 'error_event';
      if (nativeReason === 'device_invalidated') {
        this.emit('device-event', {
          event: 'audio_session_disconnected',
          reason: nativeReason,
          currentDevice: true,
          followsDefaultDevice: true,
        } satisfies NativeHostNotificationEvent);
        return;
      }

      const error = createError?.(nativeReason, nativeMessage) ?? new Error('echo-audio-host error event');
      if (!this.ready) {
        this.clearReadyTimer();
        rejectReady(error);
        return;
      }

      this.emit('error', error);
    }
  }

  private resolvePendingGracefulStop(): void {
    const pendingGracefulStop = this.pendingGracefulStop;
    if (!pendingGracefulStop) {
      return;
    }

    if (pendingGracefulStop.forceKilledAtMs !== null) {
      const elapsedSinceKillMs = performance.now() - pendingGracefulStop.forceKilledAtMs;
      const remainingSettleMs = Math.ceil(forceKilledReleaseSettleMs - elapsedSinceKillMs);
      if (remainingSettleMs > 0) {
        if (pendingGracefulStop.timeout) {
          clearTimeout(pendingGracefulStop.timeout);
        }
        pendingGracefulStop.timeout = setTimeout(() => {
          if (this.pendingGracefulStop === pendingGracefulStop) {
            this.resolvePendingGracefulStop();
          }
        }, remainingSettleMs);
        pendingGracefulStop.timeout?.unref?.();
        return;
      }
    }

    if (pendingGracefulStop.timeout) {
      clearTimeout(pendingGracefulStop.timeout);
    }
    this.pendingGracefulStop = null;
    this.cleanupBridgeReferences();
    pendingGracefulStop.resolve();
  }

  private cleanupBridgeReferences(): void {
    const eqControlPort = this.eqControlPort;
    this.clearReadyTimer();
    this.closeReadlineInterfaces();
    this.proc = null;
    this.bridgeWritable = null;
    this.sessionWritable = null;
    this.ready = false;
    this.ended = false;
    this.readyMessage = null;
    this.lastPositionReportedAtMs = null;
    this.eqControlPort = null;
    this.currentSessionId = 0;
    this.currentSessionHasPcm = false;
    getEqBridge().disconnect(eqControlPort);
  }

  private closeReadlineInterfaces(): void {
    this.stdoutReadline?.close();
    this.stdoutReadline = null;
    this.stderrReadline?.close();
    this.stderrReadline = null;
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) {
      return;
    }

    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }
}
