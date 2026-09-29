import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import type { Readable} from 'node:stream';
import { Writable } from 'node:stream';
import electron from 'electron';
import { hasPortableExecutableHeader } from '../app/fileHeader';
import { resolveInstalledAudioRuntimeHost } from '../app/RuntimeComponentService';
import { JsonRpcBridge } from './JsonRpcBridge';
import { DaemonHostProcess } from './DaemonHostProcess';
import { syncPersistedDspStateToNative } from './DspStateSync';
import { activeJsonRpcBridge } from './HostBridgeRegistry';
import type { BridgeSpawnOptions, DaemonHostProcessContext, DaemonSpawnOptions, HostSpawner } from './DaemonHostProcess';
import {
  clearActiveJsonRpcBridgeIf,
  setActiveJsonRpcBridge,
} from './HostBridgeRegistry';
import type {
  NativeHostNotificationEvent,
  NativeBridgeReadyMessage,
  NativeBridgeReadyResult,
  NativeOutputTelemetry,
  NativeOutputStartOptions,
} from './audioTypes';
import { nativeBackendContractVersion, nativeHostProtocolVersion } from './audioTypes';
import type { AutomixTransitionPlan } from './AutomixPlanner';
import type { EqProfileBindingTarget } from '../../shared/types/eq';

export {
  activeJsonRpcBridge,
  getActiveJsonRpcBridge,
  setActiveJsonRpcBridge,
  clearActiveJsonRpcBridge,
} from './HostBridgeRegistry';

export type { BridgeSpawnOptions, DaemonSpawnOptions, HostSpawner } from './DaemonHostProcess';

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
  userDataPath?: string | null;
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

const getElectronUserDataPath = (): string | null => {
  const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;

  try {
    return electronApp?.getPath?.('userData') ?? null;
  } catch {
    return null;
  }
};

const defaultLogger = (message: string): void => {
  console.warn(message);
};

const verboseAudioLogsEnabled = process.env.ECHO_VERBOSE_AUDIO_LOGS === '1';
const maxAutomixPcmNotificationBytes = 64 * 1024;
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
  'device_sample_rate_changed',
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

let daemonBridge: NativePcmHostProcess | null = null;

export { daemonBridge };

export async function startAudioDaemon(): Promise<void> {
  if (daemonBridge?.isDaemonRunning()) {
    // A one-shot PCM/DoP bridge may temporarily own the global DSP control
    // route. Restore the persistent daemon's own bridge before callers create
    // a daemon backend. If its RPC transport is no longer usable, restart the
    // daemon instead of returning a running process with no usable bridge.
    if (daemonBridge.activateDspControl()) {
      return;
    }
    await daemonBridge.stopDaemon();
    daemonBridge = null;
  }
  const bridge = new NativePcmHostProcess({ logger: console.warn });
  daemonBridge = bridge;
  try {
    await bridge.startDaemon();
  } catch (error) {
    if (daemonBridge === bridge) {
      daemonBridge = null;
    }
    throw error;
  }
}

export async function stopAudioDaemon(): Promise<void> {
  if (!daemonBridge) return;
  await daemonBridge.stopDaemon();
  daemonBridge = null;
}

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

  if (!hasPortableExecutableHeader(path)) {
    return false;
  }

  const hostDirectory = dirname(path);
  return ['avcodec-62.dll', 'avformat-62.dll', 'avutil-60.dll', 'swresample-6.dll'].every((name) => {
    const dependencyPath = join(hostDirectory, name);
    return existsSync(dependencyPath) && hasPortableExecutableHeader(dependencyPath);
  });
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

  if (options.exclusive) {
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
  metadata: { elapsedMs: number; mode: 'shared' | 'exclusive'; nativeMessage?: string | null },
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

  const installedRuntimeHost = resolveInstalledAudioRuntimeHost(
    options.userDataPath === undefined ? getElectronUserDataPath() : options.userDataPath,
  );
  if (installedRuntimeHost) {
    candidates.push(installedRuntimeHost);
  }

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
  private readonly targetErrorListener: (error: unknown) => void;
  private readonly targetCloseListener: () => void;
  private readonly onTargetError?: (error: Error) => void;

  constructor(
    private readonly target: Writable,
    onTargetError?: (error: Error) => void,
  ) {
    super();
    this.onTargetError = onTargetError;

    this.targetErrorListener = (err) => {
      if (this.isClosed) {
        return;
      }
      this.isClosed = true;
      const error = err instanceof Error ? err : new Error(String(err));
      this.onTargetError?.(error);
      if (!this.onTargetError) {
        this.destroy(error);
      }
    };
    this.targetCloseListener = () => {
      this.isClosed = true;
    };
    target.on('error', this.targetErrorListener);
    target.on('close', this.targetCloseListener);
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
          if (!this.isClosed) {
            this.isClosed = true;
            this.onTargetError?.(error);
          }
          callback(this.onTargetError ? undefined : error);
          return;
        }

        callback();
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (!this.isClosed) {
        this.isClosed = true;
        this.onTargetError?.(normalizedError);
      }
      callback(this.onTargetError ? undefined : normalizedError);
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.isClosed = true;
    this.target.off('error', this.targetErrorListener);
    this.target.off('close', this.targetCloseListener);
    callback(error);
  }
}

const normalizeOutputMode = (options: NativeOutputStartOptions): 'shared' | 'exclusive' | 'asio' =>
  options.asio ? 'asio' : options.exclusive ? 'exclusive' : 'shared';

type NativeOutputMode = ReturnType<typeof normalizeOutputMode>;

export const normalizeSharedBackendForHost = (
  sharedBackend: NativeOutputStartOptions['sharedBackend'],
  platform: NodeJS.Platform = process.platform,
): 'auto' | 'windows' | 'directsound' | 'alsa' | 'miniaudio' => {
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

const createReuseKey = (
  options: NativeOutputStartOptions,
  platform: NodeJS.Platform = process.platform,
  platformExplicitlySet = true,
): string => {
  const outputMode = normalizeOutputMode(options);
  const sampleRate =
    outputMode === 'shared'
      ? normalizePositiveInteger(options.sharedMixSampleRate) ?? normalizePositiveInteger(options.requestedOutputSampleRate)
      : normalizePositiveInteger(options.requestedOutputSampleRate);
  const rawBufferSizeFrames = normalizePositiveInteger(options.bufferSizeFrames);
  const bufferSizeFrames = rawBufferSizeFrames !== null
    ? sanitizeHostBufferSizeFrames(options, rawBufferSizeFrames)
    : null;

  const sharedBackend = outputMode === 'shared'
    ? options.useMiniaudioOutput === true
      ? 'miniaudio'
      : platformExplicitlySet
        ? normalizeSharedBackendForHost(options.sharedBackend, platform)
        : (options.sharedBackend === 'windows' || options.sharedBackend === 'directsound' || options.sharedBackend === 'alsa'
            ? options.sharedBackend
            : 'auto')
    : null;

  return JSON.stringify({
    outputMode,
    deviceIndex: Number.isInteger(Number(options.deviceIndex)) ? Number(options.deviceIndex) : null,
    deviceName: options.deviceName ?? null,
    sharedBackend,
    sampleRate,
    channels: options.channels,
    exclusive: options.exclusive === true,
    asio: options.asio === true,
    bufferSizeFrames,
    latencyProfile: options.latencyProfile ?? null,
    playbackSpeedMode: options.playbackSpeedMode ?? null,
    inputFormat: options.inputFormat ?? 'pcm-f32le',
    nativeDsdSampleRate: options.nativeDsdSampleRate ?? null,
  });
};

class NativeSessionWritable extends Writable {
  private sessionClosed = false;

  constructor(
    private readonly owner: NativePcmHostProcess,
    private readonly sessionId: number,
  ) {
    super();
    // A target pipe can fail after AudioSession has detached its pipeline
    // listener during replacement. Keep teardown races from becoming an
    // uncaught stream error; active pipeline listeners still receive it.
    this.on('error', () => undefined);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.sessionClosed) {
      callback(new Error('native output session is already closed'));
      return;
    }

    this.owner.writeSessionChunk(this.sessionId, chunk, callback);
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

  constructor(
    private readonly owner: NativePcmHostProcess,
    private readonly sessionId: number,
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback(new Error('native automix next deck is already closed'));
      return;
    }

    this.owner.writeAutomixNextPcmChunk(this.sessionId, chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.isClosed) {
      callback();
      return;
    }

    this.owner.finishAutomixNextDeck(this.sessionId, callback);
    this.isClosed = true;
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.isClosed = true;
    callback(error);
  }
}

export class NativePcmHostProcess extends EventEmitter {
  private readonly spawn: HostSpawner;
  private readonly platform: NodeJS.Platform;
  private readonly platformExplicitlySet: boolean;
  private readonly readyTimeoutMs: number;
  private readonly logger: (message: string) => void;
  private hostBinary: string | null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pcmInput: Writable | null = null;
  private bridgeWritable: BridgeWritable | null = null;
  private sessionWritable: NativeSessionWritable | null = null;
  private sessionIdCounter = 0;
  private currentSessionId = 0;
  private currentSessionHasPcm = false;
  private currentSessionPcmBytes = 0;
  private sessionBeginWrites = new Map<number, Promise<void>>();
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
  private jsonRpcBridge: JsonRpcBridge | null = null;
  private pendingGracefulStop: PendingGracefulStop | null = null;
  private stdoutReadline: readline.Interface | null = null;
  private stderrReadline: readline.Interface | null = null;
  private lastOutputMode: NativeOutputMode | null = null;
  private currentStartOptions: NativeOutputStartOptions | null = null;
  inputFormat: NativeOutputStartOptions['inputFormat'] = 'pcm-f32le';

  constructor(dependencies: NativeOutputBridgeDependencies = {}) {
    super();
    this.hostBinary = dependencies.hostBinary ?? null;
    this.platform = dependencies.platform ?? process.platform;
    this.platformExplicitlySet = dependencies.platform !== undefined;
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

  private createDaemonHostContext(): DaemonHostProcessContext {
    return {
      getProc: () => this.proc,
      setProc: (proc) => {
        this.proc = proc;
      },
      getJsonRpcBridge: () => this.jsonRpcBridge,
      setJsonRpcBridge: (bridge) => {
        this.jsonRpcBridge = bridge;
      },
      isStopRequested: () => this.stopRequested,
      spawn: this.spawn,
      resolveHostBinary,
      logVerbose: (message) => this.logVerbose(message),
      emitDaemonLifecycle: (event) => {
        this.emit('daemon-lifecycle', event);
      },
    };
  }

  async start(options: NativeOutputStartOptions): Promise<NativeBridgeReadyResult> {
    if (this.isDaemonRunning()) {
      throw new Error(
        'NativeOutputBridge: daemon is already running. Use JSON-RPC for playback commands.',
      );
    }

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
      this.currentSessionPcmBytes = 0;
      this.sessionBeginWrites.clear();
      this.reuseKey = createReuseKey(options, this.platform, this.platformExplicitlySet);
      this.ready = false;
      this.ended = false;
      this.stopRequested = false;
      this.readyMessage = null;
      this.inputFormat = options.inputFormat ?? 'pcm-f32le';
      this.currentStartOptions = options;

      const args = this.createSpawnArgs(options);
      const stderrLines: string[] = [];
      const startedAtMs = performance.now();
      const mode = options.exclusive ? 'exclusive' : 'shared';
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
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      } as unknown as BridgeSpawnOptions);
      const spawnedProc = this.proc;
      const handlePcmInputFailure = (error: Error) => {
        if (this.proc !== spawnedProc && this.pendingGracefulStop?.proc !== spawnedProc) {
          return;
        }

        const wasReady = this.ready;
        const intentional = this.stopRequested;
        const hostError = createError(
          `pcm_input_error:${error instanceof Error ? error.message : String(error)}`,
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
      const childStdio = this.proc.stdio as unknown as Array<Readable | Writable | null | undefined> | undefined;
      // A real Node child always exposes the requested fd5. Some injected
      // HostSpawner test doubles predate extra stdio descriptors and expose
      // only stdin/stdout/stderr, so retain their in-memory sink explicitly.
      const pcmInput = (childStdio ? childStdio[5] : this.proc.stdin) as Writable | undefined;
      if (!pcmInput) {
        this.proc.kill('SIGKILL');
        this.proc = null;
        settleReject(createError('pcm_input_pipe_unavailable'));
        return;
      }
      this.pcmInput = pcmInput;
      this.bridgeWritable = new BridgeWritable(pcmInput, handlePcmInputFailure);

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
        options.exclusive
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

  async startDaemon(options: DaemonSpawnOptions = {}): Promise<void> {
    await new DaemonHostProcess(this.createDaemonHostContext()).spawn(options);
  }

  async stopDaemon(): Promise<void> {
    await new DaemonHostProcess(this.createDaemonHostContext()).shutdown();
  }

  isDaemonRunning(): boolean {
    return new DaemonHostProcess(this.createDaemonHostContext()).isRunning();
  }

  getPositionSeconds(): number {
    const sampleRate = this.actualDeviceSampleRate ?? this.requestedOutputSampleRate;

    if (sampleRate <= 0) {
      return this.startSeconds;
    }

    const localFrames = Math.max(0, this.framesConsumed - this.frameOffset);
    let positionSeconds = this.startSeconds + (localFrames / sampleRate);

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

    const pcmInput = this.pcmInput;

    return Boolean(
      this.ready &&
      this.proc &&
      pcmInput &&
      !pcmInput.destroyed &&
      !pcmInput.writableEnded &&
      pcmInput.writable &&
      !this.currentSessionHasPcm &&
      this.reuseKey === createReuseKey(options, this.platform, this.platformExplicitlySet),
    );
  }

  beginSession(options: { startSeconds?: number; playbackRate?: number; durationSeconds?: number; startPaused?: boolean } = {}): number {
    if (!this.proc || !this.pcmInput || this.pcmInput.destroyed || this.pcmInput.writableEnded || !this.pcmInput.writable) {
      throw new Error('native output bridge is not writable');
    }

    const sessionId = (this.sessionIdCounter + 1) >>> 0;
    this.sessionIdCounter = sessionId;
    this.currentSessionId = sessionId;
    this.currentSessionHasPcm = false;
    this.currentSessionPcmBytes = 0;
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
    if (this.jsonRpcBridge) {
      const sessionBeginWrite = this.beginNativeSession(sessionId, options.startPaused === true);
      sessionBeginWrite.catch((error: Error) => this.emit('error', error));
      this.sessionBeginWrites.set(sessionId, sessionBeginWrite);
    }
    return sessionId;
  }

  createSessionWritable(sessionId = this.currentSessionId): Writable {
    if (!sessionId) {
      throw new Error('native output bridge session has not begun');
    }

    const writable = new NativeSessionWritable(this, sessionId);
    this.sessionWritable = writable;
    return writable;
  }

  prepareAutomixPlan(plan: AutomixTransitionPlan, options: { fadeStartSeconds: number; sampleRate?: number | null }): void {
    if (!this.currentSessionId) {
      return;
    }

    const payload = {
      fadeStartSeconds: Math.max(0, Number(options.fadeStartSeconds) || 0),
      overlapSeconds: Math.max(0.001, Number(plan.overlapSeconds) || 0.001),
      currentGainDb: Number.isFinite(plan.currentGainDb) ? plan.currentGainDb : 0,
      nextGainDb: Number.isFinite(plan.nextGainDb) ? plan.nextGainDb : 0,
      tempoRatio: Number.isFinite((plan as { tempoRatio?: number }).tempoRatio)
        ? (plan as { tempoRatio?: number }).tempoRatio
        : 1,
      mode: plan.mode,
      sampleRate: Number.isFinite(options.sampleRate) ? options.sampleRate : null,
    };
    this.notifyNativeControl('audio.automixPrepare', { sessionId: this.currentSessionId, ...payload });
  }

  createAutomixNextWritable(): Writable {
    if (!this.currentSessionId) {
      throw new Error('native output bridge session has not begun');
    }

    return new AutomixNextDeckWritable(this, this.currentSessionId);
  }

  cancelAutomix(): void {
    this.notifyNativeControl('audio.automixCancel', { sessionId: this.currentSessionId });
  }

  endSession(sessionId = this.currentSessionId, callback?: (error?: Error | null) => void): void {
    if (
      !sessionId ||
      sessionId !== this.currentSessionId ||
      !this.proc ||
      !this.jsonRpcBridge
    ) {
      callback?.();
      return;
    }

    const sessionBeginWrite = this.sessionBeginWrites.get(sessionId) ?? Promise.resolve();
    const pcmBytes = this.currentSessionPcmBytes;
    sessionBeginWrite
      .then(() => this.jsonRpcBridge?.call<boolean>('audio.inputEnd', {
        sessionId,
        pcmBytes,
      }))
      .then((accepted) => {
        this.sessionBeginWrites.delete(sessionId);
        if (accepted !== true) {
          callback?.(new Error(`native host rejected audio.inputEnd for session ${sessionId}`));
          return;
        }
        callback?.();
      }, (error: Error) => callback?.(error));
  }

  async abortSession(sessionId = this.currentSessionId): Promise<void> {
    if (
      !sessionId ||
      sessionId !== this.currentSessionId ||
      !this.proc ||
      !this.jsonRpcBridge
    ) {
      return;
    }

    // Synchronously close the per-session writable before taking the byte
    // boundary. This drops queued Node writes and prevents the old decoder
    // from submitting PCM after audio.sessionAbort has established its
    // discard target. The one active _write, if any, was already counted by
    // writeSessionChunk before it was handed to the raw PCM pipe.
    this.sessionWritable?.destroy();
    this.sessionWritable = null;
    const sessionBeginWrite = this.sessionBeginWrites.get(sessionId) ?? Promise.resolve();
    await sessionBeginWrite;
    const pcmBytes = this.currentSessionPcmBytes;
    const accepted = await this.jsonRpcBridge.call<boolean>('audio.sessionAbort', {
      sessionId,
      pcmBytes,
    });
    this.sessionBeginWrites.delete(sessionId);
    if (accepted !== true) {
      throw new Error(`native host rejected audio.sessionAbort for session ${sessionId}`);
    }
  }

  setVolume(volume: number): void {
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    this.jsonRpcBridge?.setVolume(safeVolume).catch((error: Error) => this.emit('error', error));
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.currentSessionId) {
      return;
    }

    const bridge = this.jsonRpcBridge;
    if (!bridge) {
      return;
    }

    const accepted = await bridge.call<boolean>(paused ? 'audio.pause' : 'audio.resume', {
      sessionId: this.currentSessionId,
    });
    if (accepted !== true) {
      throw new Error(`native host rejected ${paused ? 'audio.pause' : 'audio.resume'} for session ${this.currentSessionId}`);
    }
  }

  async syncDspState(profileTarget?: EqProfileBindingTarget): Promise<void> {
    const bridge = this.jsonRpcBridge;
    if (!bridge || bridge.isClosed) {
      throw new Error('native json-rpc bridge is not open');
    }
    await syncPersistedDspStateToNative(bridge, profileTarget);
  }

  activateDspControl(): boolean {
    const bridge = this.jsonRpcBridge;
    if (bridge && !bridge.isClosed) {
      setActiveJsonRpcBridge(bridge);
      return true;
    }
    return false;
  }

  writeReplayGainFrame(
    sessionId: number,
    trackGainDb: number,
    albumGainDb: number,
    peak: number,
    mode: number,
    preampDb: number,
    preventClipping: boolean,
  ): void {
    if (!this.currentSessionId) {
      return;
    }

    // ReplayGain is not applicable in DSD passthrough modes
    if (this.inputFormat === 'dsd-native-raw' || this.inputFormat === 'dop24le') {
      return;
    }

    this.jsonRpcBridge?.setReplayGainConfig({
      trackGainDb: Number.isFinite(trackGainDb) ? trackGainDb : 0,
      albumGainDb: Number.isFinite(albumGainDb) ? albumGainDb : 0,
      peak: Number.isFinite(peak) ? peak : 0,
      mode: Math.max(0, Math.min(2, mode)),
      preampDb: Number.isFinite(preampDb) ? preampDb : 0,
      preventClipping,
    }).catch((error: Error) => this.emit('error', error));
  }

  writePlaybackRateFrame(sessionId: number, rate: number): void {
    if (!this.currentSessionId) {
      return;
    }

    const clampedRate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2.0, rate)) : 1.0;
    this.jsonRpcBridge?.setPlaybackRate(clampedRate).catch((error: Error) => this.emit('error', error));
  }

  writeSpeedModeFrame(sessionId: number, mode: number): void {
    if (!this.currentSessionId) {
      return;
    }

    const clampedMode = Math.max(0, Math.min(2, mode));
    const speedMode = clampedMode === 1 ? 'daycore' : clampedMode === 2 ? 'speed' : 'nightcore';
    this.jsonRpcBridge?.setPlaybackSpeedMode(speedMode).catch((error: Error) => this.emit('error', error));
  }

  writeLevelMeterConfigFrame(sessionId: number, intervalMs: number): void {
    if (!this.currentSessionId) {
      return;
    }

    const clampedIntervalMs = Math.max(0, Math.min(5000, Math.round(intervalMs)));
    this.jsonRpcBridge?.setLevelMeterInterval(clampedIntervalMs).catch((error: Error) => this.emit('error', error));
  }

  writeDspConfigFrame(sessionId: number, configJson: string): void {
    this.notifyNativeControl('audio.setDspConfig', { sessionId, configJson });
  }

  writeSessionChunk(sessionId: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    if (sessionId !== this.currentSessionId) {
      callback();
      return;
    }

    const bridgeWritable = this.bridgeWritable;
    if (!bridgeWritable) {
      callback(new Error('native output bridge is not writable'));
      return;
    }

    this.currentSessionHasPcm = true;
    // _write is serialized by NativeSessionWritable. Count the active chunk
    // before waiting for sessionBegin so abortSession can capture the complete
    // submitted boundary even when JSON-RPC and PCM pipe scheduling cross.
    this.currentSessionPcmBytes += chunk.length;
    const sessionBeginWrite = this.sessionBeginWrites.get(sessionId) ?? Promise.resolve();
    sessionBeginWrite.then(
      () => {
        if (sessionId !== this.currentSessionId) {
          callback();
          return;
        }

        // Count the chunk before submitting it. A session abort runs over the
        // JSON-RPC pipe while PCM uses a separate pipe, so counting only in
        // the write callback leaves an untracked in-flight tail that can land
        // in the next session.
        bridgeWritable.write(chunk, (error) => {
          if (
            error &&
            (
              !this.ready ||
              this.stopRequested ||
              this.ended ||
              sessionId !== this.currentSessionId ||
              bridgeWritable !== this.bridgeWritable
            )
          ) {
            // The bridge/process lifecycle owns the primary failure. A queued
            // PCM write can receive the same closed-pipe error afterwards;
            // surfacing it again would replace the more useful host error.
            callback();
            return;
          }
          callback(error);
        });
      },
      (error: Error) => callback(error),
    );
  }

  writeAutomixNextPcmChunk(sessionId: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (!chunk.length) {
      callback();
      return;
    }

    if (sessionId !== this.currentSessionId) {
      callback();
      return;
    }

    this.writeAutomixNextPcmChunks(sessionId, chunk, 0, callback);
  }

  private writeAutomixNextPcmChunks(
    sessionId: number,
    chunk: Buffer,
    offset: number,
    callback: (error?: Error | null) => void,
  ): void {
    if (sessionId !== this.currentSessionId) {
      callback();
      return;
    }

    if (offset >= chunk.length) {
      callback();
      return;
    }

    const end = Math.min(offset + maxAutomixPcmNotificationBytes, chunk.length);
    const slice = chunk.subarray(offset, end);
    this.notifyNativeControlAsync('audio.automixNext', {
      sessionId,
      pcmBase64: slice.toString('base64'),
    }).then(
      () => this.writeAutomixNextPcmChunks(sessionId, chunk, end, callback),
      (error: Error) => callback(error),
    );
  }

  finishAutomixNextDeck(sessionId: number, callback?: (error?: Error | null) => void): void {
    if (sessionId !== this.currentSessionId) {
      callback?.();
      return;
    }

    this.notifyNativeControlAsync('audio.automixNextEnd', { sessionId }).then(
      () => callback?.(),
      (error: Error) => callback?.(error),
    );
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
      } catch { /* empty */ }
      this.bridgeWritable = null;
    }

    if (this.pcmInput) {
      try {
        this.pcmInput.destroy();
      } catch { /* empty */ }
      this.pcmInput = null;
    }

    if (this.sessionWritable) {
      try {
        this.sessionWritable.destroy();
      } catch { /* empty */ }
      this.sessionWritable = null;
    }

    if (this.proc) {
      try {
        this.notifyNativeControl('rpc.shutdown');
      } catch { /* empty */ }

      try {
        this.proc.stdin.destroy();
      } catch { /* empty */ }

      try {
        this.proc.kill('SIGKILL');
      } catch { /* empty */ }

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
      } catch { /* empty */ }
      this.sessionWritable = null;
    }

    if (this.bridgeWritable) {
      try {
        this.bridgeWritable.destroy();
      } catch { /* empty */ }
      this.bridgeWritable = null;
    }

    if (this.pcmInput) {
      try {
        this.pcmInput.destroy();
      } catch { /* empty */ }
      this.pcmInput = null;
    }

    const selectedTimeoutMs =
      timeoutMs ?? (this.lastOutputMode === 'exclusive'
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
      this.notifyNativeControl('rpc.shutdown');
    } catch { /* empty */ }

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
        } catch { /* empty */ }
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

  private isDaemonBridgeHealthy(): boolean {
    return this.isDaemonRunning() && activeJsonRpcBridge !== null && !activeJsonRpcBridge.isClosed;
  }

  private createSpawnArgs(options: NativeOutputStartOptions): string[] {
    // PcmRingAudioSource is allocated before session.begin, so per-play hosts
    // still need their fixed source format and capacity at process startup.
    const daemonMode = this.isDaemonBridgeHealthy();
    const args: string[] = daemonMode ? [] : [
      '-sr', String(Math.max(1, Math.round(options.requestedOutputSampleRate || 48000))),
      '-ch', String(Math.max(1, Math.min(8, Math.round(options.channels || 2)))),
    ];

    const bufferSizeFrames = Number(options.bufferSizeFrames);
    if (!daemonMode && Number.isFinite(bufferSizeFrames) && bufferSizeFrames > 0) {
      const sanitizedBufferSizeFrames = sanitizeHostBufferSizeFrames(options, Math.round(bufferSizeFrames));
      if (sanitizedBufferSizeFrames !== null) {
        args.push('-buffer', String(sanitizedBufferSizeFrames));
      }
    }

    const fifoCapacityMs = Number(options.fifoCapacityMs);
    if (!daemonMode && Number.isFinite(fifoCapacityMs) && fifoCapacityMs > 0) {
      args.push('-fifo-ms', String(Math.round(fifoCapacityMs)));
    }

    const startupPrebufferMs = Number(options.startupPrebufferMs);
    if (!daemonMode && Number.isFinite(startupPrebufferMs) && startupPrebufferMs >= 0) {
      args.push('-prebuffer-ms', String(Math.round(startupPrebufferMs)));
    }

    // Deprecated: -eq-port kept for backward-compat test expectations.
    // The host binary still accepts it but JSON-RPC on stdio is the active transport.
    args.push('-eq-port', '0');

    const deviceIndex = Number(options.deviceIndex ?? -1);

    if (options.deviceName) {
      args.push('-device', options.deviceName);
    }

    if (Number.isInteger(deviceIndex) && deviceIndex >= 0) {
      args.push('-device-index', String(deviceIndex));
    }

    if (options.exclusive) {
      args.push('-exclusive');
    }

    if (options.asio) {
      args.push('-asio');
    }

    if (options.inputFormat === 'dop24le') {
      args.push('-dop-output');
    }

    if (options.inputFormat === 'dsd-native-raw') {
      args.push('-dop-output');
      args.push('-asio-native-dsd-output');
    }

    // When the caller doesn't explicitly set a platform, pass the shared
    // backend through unnormalised so tests that don't set platform work
    // on any host machine.  When a platform IS explicitly set (Linux/Windows),
    // apply the normal filtering.
    const sharedBackend = options.useMiniaudioOutput === true
      ? 'miniaudio'
      : this.platformExplicitlySet
        ? normalizeSharedBackendForHost(options.sharedBackend, this.platform)
        : (options.sharedBackend === 'windows' || options.sharedBackend === 'directsound' || options.sharedBackend === 'alsa'
            ? options.sharedBackend
            : 'auto');
    if (!options.exclusive && !options.asio && sharedBackend !== 'auto') {
      args.push('-shared-backend', sharedBackend);
    }

    const volume = Number(options.volume ?? 1);
    if (Number.isFinite(volume) && Math.abs(volume - 1) > 1e-6) {
      args.push('-vol', String(Math.max(0, Math.min(1, volume))));
    }

    // JSON-RPC: use fd 3 for stdin, fd 4 for stdout (persistent connection)
    args.push('--rpc-stdin-fd', '3');
    args.push('--rpc-stdout-fd', '4');
    args.push('--pcm-input-fd', '5');
    args.push('--no-stdin');

    return args;
  }

  private notifyNativeControl(method: string, params?: unknown): void {
    this.jsonRpcBridge?.notify(method, params);
  }

  private notifyNativeControlAsync(method: string, params?: unknown): Promise<void> {
    if (!this.jsonRpcBridge) {
      return Promise.reject(new Error('native json-rpc bridge is not open'));
    }

    return this.jsonRpcBridge.writeNotification(method, params);
  }

  private beginNativeSession(sessionId: number, startPaused = false): Promise<void> {
    const params: Record<string, unknown> = { sessionId, startPaused };
    const opts = this.currentStartOptions;
    if (opts) {
      params.sr = opts.requestedOutputSampleRate ?? 48000;
      params.ch = opts.channels ?? 2;
      const buf = Number(opts.bufferSizeFrames);
      if (Number.isFinite(buf) && buf > 0) params.buffer = Math.round(buf);
      const fifo = Number(opts.fifoCapacityMs);
      if (Number.isFinite(fifo) && fifo > 0) params.fifoMs = Math.round(fifo);
      const prebuf = Number(opts.startupPrebufferMs);
      if (Number.isFinite(prebuf) && prebuf >= 0) params.prebufferMs = Math.round(prebuf);
    }
    if (!this.jsonRpcBridge) {
      return Promise.reject(new Error('native json-rpc bridge is not open'));
    }

    return this.jsonRpcBridge.call<boolean>('audio.sessionBegin', params).then((accepted) => {
      if (accepted !== true) {
        throw new Error(`native host rejected audio.sessionBegin for session ${sessionId}`);
      }
    });
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
      this.emit('device-event', nativeNotification);
      return;
    }

    if (message.ready) {
      // Initialize JSON-RPC bridge on fd 3 (stdin) / fd 4 (stdout)
      if ((!this.jsonRpcBridge || this.jsonRpcBridge.isClosed) && this.proc?.stdio?.[3] && this.proc?.stdio?.[4]) {
        const rpcBridge = new JsonRpcBridge();
        rpcBridge.on('error', (error: Error) => this.emit('error', error));
        rpcBridge.open(this.proc.stdio[4] as Readable, this.proc.stdio[3] as Writable);
        this.jsonRpcBridge = rpcBridge;
      }

      if (message.readyLevel === 'process') {
        if (
          message.protocolVersion !== nativeHostProtocolVersion ||
          message.backendContractVersion !== nativeBackendContractVersion ||
          message.capabilities?.deviceReadyV2 !== true
        ) {
          this.clearReadyTimer();
          this.stop();
          rejectReady(createError?.(
            `native_host_contract_mismatch: protocol=${String(message.protocolVersion)} backendContract=${String(message.backendContractVersion)}`,
          ) ?? new Error('native_host_contract_mismatch'));
        }
        return;
      }

      if (message.readyLevel === 'device' && (
        message.protocolVersion !== nativeHostProtocolVersion ||
        message.backendContractVersion !== nativeBackendContractVersion ||
        message.capabilities?.deviceReadyV2 !== true
      )) {
        this.clearReadyTimer();
        this.stop();
        rejectReady(createError?.(
          `native_host_contract_mismatch: protocol=${String(message.protocolVersion)} backendContract=${String(message.backendContractVersion)}`,
        ) ?? new Error('native_host_contract_mismatch'));
        return;
      }

      this.ready = true;
      this.readyMessage = message;
      this.clearReadyTimer();

      if (typeof message.sampleRate === 'number' && message.sampleRate > 0) {
        this.actualDeviceSampleRate = message.sampleRate;
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
    this.clearReadyTimer();
    this.closeReadlineInterfaces();
    this.proc = null;
    this.bridgeWritable = null;
    this.sessionWritable = null;
    this.ready = false;
    this.ended = false;
    this.readyMessage = null;
    this.lastPositionReportedAtMs = null;
    this.currentSessionId = 0;
    this.currentSessionHasPcm = false;
    const jsonRpcBridge = this.jsonRpcBridge;
    jsonRpcBridge?.close().catch(() => {});
    this.jsonRpcBridge = null;
    clearActiveJsonRpcBridgeIf(jsonRpcBridge);
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
