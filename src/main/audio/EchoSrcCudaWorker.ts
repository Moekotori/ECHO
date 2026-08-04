import { execFileSync as nodeExecFileSync, spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple } from 'node:child_process';
import { existsSync as nodeExistsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type EchoSrcCudaWorkerStatus = {
  available: boolean;
  path: string | null;
  protocol: number | null;
  cudaBuilt: boolean;
  error: string | null;
};

export type EchoSrcCudaWorkerResolveOptions = {
  appPath?: string | null;
  resourcesPath?: string;
  cwd?: string;
  exists?: (path: string) => boolean;
  isExecutable?: (path: string) => boolean;
};

export type EchoSrcCudaWorkerStatusOptions = EchoSrcCudaWorkerResolveOptions & {
  execFileSync?: typeof nodeExecFileSync;
};

export type EchoSrcFirWorkerBackend = 'cpu' | 'cuda';

export type EchoSrcFirWorkerRequest = {
  backend: EchoSrcFirWorkerBackend;
  channels: number;
  input: Float32Array;
  taps: Float32Array;
  history: Float32Array;
};

export type EchoSrcFirWorkerResult = {
  backend: EchoSrcFirWorkerBackend;
  output: Float32Array;
  history: Float32Array;
};

export type EchoSdmWorkerRequest = {
  backend: EchoSrcFirWorkerBackend;
  channels: number;
  input: Float32Array;
  feedbackCoefficients: Float32Array;
  errorHistory: Float32Array;
  ditherState: Uint32Array;
  idleRunFrames?: Uint32Array;
  idleLocked?: Uint32Array;
  previousSamples?: Float32Array;
  dopFrameIndex: number;
  ditherAmplitude: number;
  inputLimit: number;
  stabilityLimit: number;
};

export type EchoSdmWorkerResult = {
  backend: EchoSrcFirWorkerBackend;
  output: Uint8Array;
  errorHistory: Float32Array;
  ditherState: Uint32Array;
  idleRunFrames?: Uint32Array;
  idleLocked?: Uint32Array;
  previousSamples?: Float32Array;
  dopFrameIndex: number;
};

type EchoSrcWorkerChild = ChildProcessByStdio<Writable, Readable, Readable>;
type EchoSrcWorkerSpawnOptions = SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'> & {
  windowsHide: boolean;
};
type EchoSrcWorkerSpawner = (file: string, args: string[], options: EchoSrcWorkerSpawnOptions) => EchoSrcWorkerChild;

export type EchoSrcCudaWorkerClientOptions = EchoSrcCudaWorkerResolveOptions & {
  workerPath?: string | null;
  spawn?: EchoSrcWorkerSpawner;
  requestTimeoutMs?: number;
  maxInputSamples?: number;
  maxTapCount?: number;
  logger?: (message: string) => void;
};

const workerProtocolVersion = 1;
const defaultWorkerRequestTimeoutMs = 5_000;
const defaultMaxInputSamples = 262_144;
const defaultMaxTapCount = 4096;
let cachedStatus: EchoSrcCudaWorkerStatus | null = null;

const getElectronAppPath = (): string | null => {
  try {
    return typeof process.versions.electron === 'string'
      ? process.resourcesPath
      : null;
  } catch {
    return null;
  }
};

const isLikelyExecutableWorkerBinary = (path: string): boolean => {
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

export const resolveEchoSrcCudaWorkerBinary = (options: EchoSrcCudaWorkerResolveOptions = {}): string | null => {
  const exe = process.platform === 'win32' ? 'echo-src-cuda-worker.exe' : 'echo-src-cuda-worker';
  const appPath = options.appPath === undefined ? getElectronAppPath() : options.appPath;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? nodeExistsSync;
  const isExecutable = options.isExecutable ?? isLikelyExecutableWorkerBinary;
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

  return candidates.find((candidate) => exists(candidate) && isExecutable(candidate)) ?? null;
};

const unavailableStatus = (error: string): EchoSrcCudaWorkerStatus => ({
  available: false,
  path: null,
  protocol: null,
  cudaBuilt: false,
  error,
});

export const resolveEchoSrcCudaWorkerStatus = (
  options: EchoSrcCudaWorkerStatusOptions = {},
): EchoSrcCudaWorkerStatus => {
  if (cachedStatus && !options.execFileSync) {
    return cachedStatus;
  }

  const workerPath = resolveEchoSrcCudaWorkerBinary(options);
  if (!workerPath) {
    cachedStatus = unavailableStatus('src_cuda_worker_missing');
    return cachedStatus;
  }

  try {
    const execFileSync = options.execFileSync ?? nodeExecFileSync;
    const output = execFileSync(workerPath, ['--status'], {
      encoding: 'utf8',
      timeout: 2_000,
      windowsHide: true,
    }) as string;
    const status = JSON.parse(output.trim()) as Record<string, unknown>;
    const protocol = typeof status.protocol === 'number' && Number.isFinite(status.protocol)
      ? Math.round(status.protocol)
      : null;
    const cudaBuilt = status.cudaBuilt === true;

    cachedStatus = {
      available: status.ok === true && protocol === workerProtocolVersion && cudaBuilt,
      path: workerPath,
      protocol,
      cudaBuilt,
      error:
        status.ok === true && protocol === workerProtocolVersion
          ? cudaBuilt ? null : 'src_cuda_worker_built_without_cuda'
          : 'src_cuda_worker_protocol_mismatch',
    };
    return cachedStatus;
  } catch (error) {
    cachedStatus = {
      available: false,
      path: workerPath,
      protocol: null,
      cudaBuilt: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return cachedStatus;
  }
};

export const clearEchoSrcCudaWorkerStatusCache = (): void => {
  cachedStatus = null;
};

type PendingWorkerRequest = {
  kind: 'fir' | 'sdm';
  request: EchoSrcFirWorkerRequest | EchoSdmWorkerRequest;
  resolve: (result: EchoSrcFirWorkerResult | EchoSdmWorkerResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
};

const floatArrayToJson = (values: Float32Array): number[] =>
  Array.from(values, (value) => Number(value.toPrecision(9)));

const parseFloatArray = (value: unknown, field: string): Float32Array => {
  if (!Array.isArray(value)) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  const samples = value.map((item) => Number(item));
  if (samples.some((item) => !Number.isFinite(item))) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  return Float32Array.from(samples);
};

const parseUint8Array = (value: unknown, field: string): Uint8Array => {
  if (!Array.isArray(value)) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  const samples = value.map((item) => Number(item));
  if (samples.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  return Uint8Array.from(samples);
};

const parseUint32Array = (value: unknown, field: string): Uint32Array => {
  if (!Array.isArray(value)) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  const samples = value.map((item) => Number(item));
  if (samples.some((item) => !Number.isInteger(item) || item < 0 || item > 0xffffffff)) {
    throw new Error(`src_cuda_worker_invalid_${field}`);
  }

  return Uint32Array.from(samples);
};

const createWorkerError = (message: string): Error =>
  new Error(message || 'src_cuda_worker_error');

export class EchoSrcCudaWorkerClient {
  private worker: EchoSrcWorkerChild | null = null;
  private lines: readline.Interface | null = null;
  private active: PendingWorkerRequest | null = null;
  private readonly queue: PendingWorkerRequest[] = [];

  constructor(private readonly options: EchoSrcCudaWorkerClientOptions = {}) {}

  async processFir(request: EchoSrcFirWorkerRequest): Promise<EchoSrcFirWorkerResult> {
    this.validateRequest(request);

    return new Promise<EchoSrcFirWorkerResult>((resolve, reject) => {
      this.queue.push({
        kind: 'fir',
        request,
        resolve: resolve as (result: EchoSrcFirWorkerResult | EchoSdmWorkerResult) => void,
        reject,
        timer: null,
      });
      this.pump();
    });
  }

  async processSdm(request: EchoSdmWorkerRequest): Promise<EchoSdmWorkerResult> {
    this.validateSdmRequest(request);

    return new Promise<EchoSdmWorkerResult>((resolve, reject) => {
      this.queue.push({
        kind: 'sdm',
        request,
        resolve: resolve as (result: EchoSrcFirWorkerResult | EchoSdmWorkerResult) => void,
        reject,
        timer: null,
      });
      this.pump();
    });
  }

  dispose(): void {
    this.failAll(createWorkerError('src_cuda_worker_disposed'));
    this.lines?.close();
    this.lines = null;
    this.worker?.kill();
    this.worker = null;
  }

  private validateRequest(request: EchoSrcFirWorkerRequest): void {
    const channels = Math.max(1, Math.round(request.channels));
    if (request.channels !== channels || request.input.length % channels !== 0) {
      throw createWorkerError('src_cuda_worker_invalid_channels');
    }
    if (request.taps.length <= 0 || request.taps.length > (this.options.maxTapCount ?? defaultMaxTapCount)) {
      throw createWorkerError('src_cuda_worker_invalid_taps');
    }
    if (request.input.length <= 0 || request.input.length > (this.options.maxInputSamples ?? defaultMaxInputSamples)) {
      throw createWorkerError('src_cuda_worker_invalid_input_size');
    }
    if (request.history.length !== (request.taps.length - 1) * channels) {
      throw createWorkerError('src_cuda_worker_invalid_history');
    }
  }

  private validateSdmRequest(request: EchoSdmWorkerRequest): void {
    const channels = Math.max(1, Math.round(request.channels));
    if (request.channels !== channels || request.input.length % channels !== 0) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_channels');
    }
    if (request.input.length <= 0 || request.input.length > (this.options.maxInputSamples ?? defaultMaxInputSamples)) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_input_size');
    }
    if (request.feedbackCoefficients.length <= 0 || request.feedbackCoefficients.length > 8) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_coefficients');
    }
    if (request.errorHistory.length !== request.feedbackCoefficients.length * channels) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_error_history');
    }
    if (request.ditherState.length !== channels) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_dither_state');
    }
    if (request.idleRunFrames && request.idleRunFrames.length !== channels) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_idle_state');
    }
    if (request.idleLocked && request.idleLocked.length !== channels) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_idle_state');
    }
    if (request.previousSamples && request.previousSamples.length !== channels) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_previous_samples');
    }
    if (!Number.isInteger(request.dopFrameIndex) || request.dopFrameIndex < 0) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_dop_index');
    }
    if (
      !Number.isFinite(request.ditherAmplitude) ||
      !Number.isFinite(request.inputLimit) ||
      !Number.isFinite(request.stabilityLimit) ||
      request.inputLimit <= 0 ||
      request.stabilityLimit <= 0
    ) {
      throw createWorkerError('src_cuda_worker_invalid_sdm_limits');
    }
  }

  private ensureWorker(): EchoSrcWorkerChild {
    if (this.worker && !this.worker.killed && this.worker.stdin.writable) {
      return this.worker;
    }

    const workerPath = this.options.workerPath ?? resolveEchoSrcCudaWorkerBinary(this.options);
    if (!workerPath) {
      throw createWorkerError('src_cuda_worker_missing');
    }

    const spawn = this.options.spawn ?? nodeSpawn;
    const worker = spawn(workerPath, [], {
      cwd: this.options.cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.worker = worker;
    this.lines = readline.createInterface({ input: worker.stdout });
    this.lines.on('line', (line) => this.handleLine(line));
    worker.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.options.logger?.(`[EchoSrcCudaWorker] ${text}`);
      }
    });
    worker.once('error', (error) => this.handleWorkerFailure(error));
    worker.once('exit', (code, signal) => {
      this.handleWorkerFailure(createWorkerError(`src_cuda_worker_exit:${code ?? signal ?? 'unknown'}`));
    });

    return worker;
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) {
      return;
    }

    let worker: EchoSrcWorkerChild;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      const pending = this.queue.shift();
      pending?.reject(error instanceof Error ? error : createWorkerError(String(error)));
      this.pump();
      return;
    }

    const pending = this.queue.shift();
    if (!pending) {
      return;
    }

    this.active = pending;
    pending.timer = setTimeout(() => {
      if (this.active === pending) {
        this.active = null;
        pending.reject(createWorkerError('src_cuda_worker_request_timeout'));
        this.resetWorker();
        this.pump();
      }
    }, this.options.requestTimeoutMs ?? defaultWorkerRequestTimeoutMs);

    const line = `${JSON.stringify(this.serializeRequest(pending))}\n`;

    if (!worker.stdin.write(line, 'utf8')) {
      worker.stdin.once('drain', () => undefined);
    }
  }

  private handleLine(line: string): void {
    const pending = this.active;
    if (!pending) {
      return;
    }

    this.active = null;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    try {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.ok !== true) {
        const code = typeof message.code === 'string' ? message.code : 'src_cuda_worker_error';
        const detail = typeof message.detail === 'string' && message.detail ? `:${message.detail}` : '';
        pending.reject(createWorkerError(`${code}${detail}`));
      } else if (pending.kind === 'sdm') {
        pending.resolve({
          backend: message.backend === 'cpu' ? 'cpu' : 'cuda',
          output: parseUint8Array(message.output, 'sdm_output'),
          errorHistory: parseFloatArray(message.errorHistory, 'sdm_error_history'),
          ditherState: parseUint32Array(message.ditherState, 'sdm_dither_state'),
          idleRunFrames: Array.isArray(message.idleRunFrames)
            ? parseUint32Array(message.idleRunFrames, 'sdm_idle_run_frames')
            : undefined,
          idleLocked: Array.isArray(message.idleLocked)
            ? parseUint32Array(message.idleLocked, 'sdm_idle_locked')
            : undefined,
          previousSamples: Array.isArray(message.previousSamples)
            ? parseFloatArray(message.previousSamples, 'sdm_previous_samples')
            : undefined,
          dopFrameIndex: typeof message.dopFrameIndex === 'number' && Number.isFinite(message.dopFrameIndex)
            ? Math.max(0, Math.round(message.dopFrameIndex))
            : 0,
        });
      } else {
        pending.resolve({
          backend: message.backend === 'cpu' ? 'cpu' : 'cuda',
          output: parseFloatArray(message.output, 'output'),
          history: parseFloatArray(message.history, 'history'),
        });
      }
    } catch (error) {
      pending.reject(error instanceof Error ? error : createWorkerError(String(error)));
    } finally {
      this.pump();
    }
  }

  private serializeRequest(pending: PendingWorkerRequest): Record<string, unknown> {
    if (pending.kind === 'sdm') {
      const request = pending.request as EchoSdmWorkerRequest;
      return {
        type: 'sdm',
        backend: request.backend,
        channels: request.channels,
        input: floatArrayToJson(request.input),
        feedbackCoefficients: floatArrayToJson(request.feedbackCoefficients),
        errorHistory: floatArrayToJson(request.errorHistory),
        ditherState: Array.from(request.ditherState),
        idleRunFrames: Array.from(request.idleRunFrames ?? new Uint32Array(request.channels)),
        idleLocked: Array.from(request.idleLocked ?? new Uint32Array(request.channels)),
        previousSamples: floatArrayToJson(request.previousSamples ?? new Float32Array(request.channels)),
        dopFrameIndex: request.dopFrameIndex,
        ditherAmplitude: request.ditherAmplitude,
        inputLimit: request.inputLimit,
        stabilityLimit: request.stabilityLimit,
      };
    }

    const request = pending.request as EchoSrcFirWorkerRequest;
    return {
      type: 'fir',
      backend: request.backend,
      channels: request.channels,
      input: floatArrayToJson(request.input),
      taps: floatArrayToJson(request.taps),
      history: floatArrayToJson(request.history),
    };
  }

  private resetWorker(): void {
    this.lines?.close();
    this.lines = null;
    this.worker?.kill();
    this.worker = null;
  }

  private handleWorkerFailure(error: Error): void {
    this.resetWorker();
    const active = this.active;
    this.active = null;
    if (active?.timer) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    active?.reject(error);
    this.failAll(error);
  }

  private failAll(error: Error): void {
    const pending = [this.active, ...this.queue].filter((item): item is PendingWorkerRequest => Boolean(item));
    this.active = null;
    this.queue.length = 0;
    for (const item of pending) {
      if (item.timer) {
        clearTimeout(item.timer);
        item.timer = null;
      }
      item.reject(error);
    }
  }
}
