import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { extname } from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import { resolveHostBinary } from './NativeOutputBridge';
import type { DecoderRun, PcmDecodeRequest } from './audioTypes';

type JuceDecodeChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

type JuceDecodeSpawnOptions = {
  stdio: ['pipe', 'pipe', 'pipe'];
  windowsHide: boolean;
};

export type JuceDecodeSpawner = (
  file: string,
  args: string[],
  options: JuceDecodeSpawnOptions,
) => JuceDecodeChildProcess;

export type JuceDecodePipelineDependencies = {
  hostBinary?: string | null;
  spawn?: JuceDecodeSpawner;
  logger?: (message: string) => void;
  readyTimeoutMs?: number;
  firstPcmTimeoutMs?: number;
};

type ResidentDecodeRun = {
  sessionId: number;
  requestedSampleRate: number;
  requestedChannels: number;
  stream: PassThrough;
  readySettled: boolean;
  doneSettled: boolean;
  stopped: boolean;
  sawPcm: boolean;
  readyTimer: NodeJS.Timeout | null;
  firstPcmTimer: NodeJS.Timeout | null;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  resolveDone: () => void;
  rejectDone: (error: Error) => void;
};

type DecodeFrameBuffer = Buffer<ArrayBufferLike>;

const defaultLogger = (message: string): void => {
  console.warn(message);
};

const defaultReadyTimeoutMs = 5_000;
const defaultFirstPcmTimeoutMs = 2_500;
const decodeServerMagic = 'ECDS';
const decodeServerVersion = 1;
const frameTypeStart = 1;
const frameTypeCancel = 2;
const frameTypeShutdown = 3;
const frameTypeReady = 101;
const frameTypePcmF32Le = 102;
const frameTypeEnd = 103;
const frameTypeError = 104;

const getDecoderBackendImpl = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.flac') {
    return 'juce-flac';
  }

  if (extension === '.mp3') {
    return 'juce-windows-media-mp3';
  }

  if (extension === '.wav' || extension === '.wave') {
    return 'juce-wav';
  }

  return 'juce-audio-format';
};

const formatHostDetailValue = (value: string): string =>
  value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');

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

const createJuceDecodeError = (
  reason: string,
  hostBinary: string,
  args: string[],
  stderrLines: string[],
  metadata: { exitCode?: number | null; signal?: NodeJS.Signals | null; sessionId?: number | null } = {},
): Error => {
  const details = [
    `host="${formatHostDetailValue(hostBinary)}"`,
    `args="${formatHostDetailValue(args.join(' '))}"`,
  ];

  if (metadata.sessionId !== undefined && metadata.sessionId !== null) {
    details.push(`sessionId=${metadata.sessionId}`);
  }

  if (metadata.exitCode !== undefined && metadata.exitCode !== null) {
    details.push(`exitCode=${metadata.exitCode}`);
  }

  if (metadata.signal) {
    details.push(`signal="${metadata.signal}"`);
  }

  const stderr = stderrLines.join(' | ');
  if (stderr) {
    details.push(`stderrTail="${formatHostDetailValue(stderr)}"`);
  }

  return new Error(`echo-audio-host juce_decode_${reason}; ${details.join('; ')}`);
};

const createFrameHeader = (type: number, sessionId: number, payloadBytes: number): DecodeFrameBuffer => {
  const header = Buffer.alloc(16);
  header.write(decodeServerMagic, 0, 'ascii');
  header.writeUInt8(decodeServerVersion, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(sessionId >>> 0, 8);
  header.writeUInt32LE(Math.max(0, payloadBytes) >>> 0, 12);
  return header;
};

const createFrame = (type: number, sessionId: number, payload: DecodeFrameBuffer = Buffer.alloc(0)): DecodeFrameBuffer =>
  payload.length > 0
    ? Buffer.concat([createFrameHeader(type, sessionId, payload.length), payload])
    : createFrameHeader(type, sessionId, 0);

const parseErrorMessage = (payload: DecodeFrameBuffer): string => {
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as { message?: unknown };
    return typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : 'decode_server_error';
  } catch {
    return payload.toString('utf8').trim() || 'decode_server_error';
  }
};

const parseReadyMetadata = (payload: DecodeFrameBuffer): { sampleRate: number | null; channels: number | null } => {
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as { sampleRate?: unknown; channels?: unknown };
    const sampleRate = Number(parsed.sampleRate);
    const channels = Number(parsed.channels);

    return {
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : null,
      channels: Number.isFinite(channels) && channels > 0 ? Math.round(channels) : null,
    };
  } catch {
    return { sampleRate: null, channels: null };
  }
};

class ResidentJuceDecodeServer {
  private readonly args = ['-decode-server'];
  private readonly proc: JuceDecodeChildProcess;
  private readonly stderrLines: string[] = [];
  private readonly activeRuns = new Map<number, ResidentDecodeRun>();
  private pendingStdout: DecodeFrameBuffer = Buffer.alloc(0);
  private nextSessionId = 0;
  private closed = false;
  private closing = false;
  private stdoutPaused = false;
  private stderr: readline.Interface | null = null;

  constructor(
    private readonly hostBinary: string,
    private readonly spawn: JuceDecodeSpawner,
    private readonly logger: (message: string) => void,
    private readonly readyTimeoutMs: number,
    private readonly firstPcmTimeoutMs: number,
    private readonly onClose: (server: ResidentJuceDecodeServer) => void,
  ) {
    this.logger(`[JuceDecodePipeline] spawn: ${hostBinary} ${this.args.join(' ')}`);
    this.proc = this.spawn(hostBinary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.stderr = readline.createInterface({ input: this.proc.stderr });
    this.stderr.on('line', (line) => {
      appendTailLine(this.stderrLines, line);
    });

    this.proc.stdout.on('data', (chunk: DecodeFrameBuffer) => {
      this.pendingStdout = this.pendingStdout.length > 0 ? Buffer.concat([this.pendingStdout, chunk]) : chunk;
      this.drainStdoutFrames();
    });
    this.proc.stdout.on('error', (error) => {
      this.failServer(createJuceDecodeError(`stdout_error:${error.message}`, this.hostBinary, this.args, this.stderrLines));
    });
    this.proc.stdin.on('error', (error) => {
      this.failServer(createJuceDecodeError(`stdin_error:${error.message}`, this.hostBinary, this.args, this.stderrLines));
    });
    this.proc.once('error', (error) => {
      this.failServer(createJuceDecodeError(`spawn_error:${error.message}`, this.hostBinary, this.args, this.stderrLines));
    });
    this.proc.once('close', (code, signal) => {
      this.closed = true;
      this.stderr?.close();
      this.stderr = null;
      const error = createJuceDecodeError('server_exit', this.hostBinary, this.args, this.stderrLines, {
        exitCode: code,
        signal,
      });
      for (const run of this.activeRuns.values()) {
        if (!run.stopped) {
          this.failRun(run, error);
        }
      }
      this.activeRuns.clear();
      this.onClose(this);
    });
  }

  decode(request: PcmDecodeRequest): DecoderRun {
    if (this.closed || this.closing || this.proc.stdin.destroyed || this.proc.stdin.writableEnded || !this.proc.stdin.writable) {
      throw createJuceDecodeError('server_not_writable', this.hostBinary, this.args, this.stderrLines);
    }

    this.stopActiveRunsForNextDecode();

    const sessionId = (this.nextSessionId + 1) >>> 0;
    this.nextSessionId = sessionId;
    const requestedSampleRate = Math.max(1, Math.round(request.decoderOutputSampleRate));
    const requestedChannels = Math.max(1, Math.min(8, Math.round(request.channels)));

    const stream = new PassThrough();
    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: Error) => void = () => undefined;
    let resolveDone: () => void = () => undefined;
    let rejectDone: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const run: ResidentDecodeRun = {
      sessionId,
      requestedSampleRate,
      requestedChannels,
      stream,
      readySettled: false,
      doneSettled: false,
      stopped: false,
      sawPcm: false,
      readyTimer: null,
      firstPcmTimer: null,
      resolveReady,
      rejectReady,
      resolveDone,
      rejectDone,
    };

    run.readyTimer = setTimeout(() => {
      this.failRun(
        run,
        createJuceDecodeError('timeout_waiting_for_ready', this.hostBinary, this.args, this.stderrLines, { sessionId }),
      );
      this.close();
    }, this.readyTimeoutMs);
    run.readyTimer.unref?.();
    run.firstPcmTimer = setTimeout(() => {
      this.failRun(
        run,
        createJuceDecodeError('timeout_waiting_for_first_pcm', this.hostBinary, this.args, this.stderrLines, { sessionId }),
      );
      this.close();
    }, this.firstPcmTimeoutMs);
    run.firstPcmTimer.unref?.();

    this.activeRuns.set(sessionId, run);
    const payload = Buffer.from(JSON.stringify({
      filePath: request.filePath,
      startSeconds: Math.max(0, request.startSeconds),
      sampleRate: requestedSampleRate,
      channels: requestedChannels,
    }), 'utf8');
    this.writeFrame(frameTypeStart, sessionId, payload, (error) => {
      if (error) {
        this.failRun(
          run,
          createJuceDecodeError(`write_start_error:${error.message}`, this.hostBinary, this.args, this.stderrLines, { sessionId }),
        );
      }
    });

    return {
      stream,
      ready,
      done,
      decoderBackendImpl: getDecoderBackendImpl(request.filePath),
      stop: () => this.stopRun(sessionId),
    };
  }

  close(): void {
    if (this.closed || this.closing) {
      return;
    }

    this.closing = true;
    this.onClose(this);

    try {
      this.writeFrame(frameTypeShutdown, 0, Buffer.alloc(0), undefined, { allowWhileClosing: true });
      this.proc.stdin.end();
    } catch {
      // Best-effort shutdown; the close handler will clear active runs.
    }

    setTimeout(() => {
      if (!this.closed && !this.proc.killed) {
        this.proc.kill();
      }
    }, 250).unref?.();
  }

  private stopActiveRunsForNextDecode(): void {
    for (const run of [...this.activeRuns.values()]) {
      this.stopRun(run.sessionId);
    }
  }

  private stopRun(sessionId: number): void {
    const run = this.activeRuns.get(sessionId);
    if (!run) {
      return;
    }

    run.stopped = true;
    this.activeRuns.delete(sessionId);
    this.clearRunTimers(run);
    if (!run.readySettled) {
      run.readySettled = true;
      run.resolveReady();
    }
    if (!run.doneSettled) {
      run.doneSettled = true;
      run.resolveDone();
    }
    run.stream.destroy();
    this.writeFrame(frameTypeCancel, sessionId, Buffer.alloc(0));
  }

  private writeFrame(
    type: number,
    sessionId: number,
    payload: DecodeFrameBuffer,
    callback?: (error: Error | null) => void,
    options: { allowWhileClosing?: boolean } = {},
  ): void {
    if (
      this.closed ||
      (this.closing && options.allowWhileClosing !== true) ||
      this.proc.stdin.destroyed ||
      this.proc.stdin.writableEnded ||
      !this.proc.stdin.writable
    ) {
      callback?.(new Error('decode server stdin is closed'));
      return;
    }

    const frame = createFrame(type, sessionId, payload);
    try {
      this.proc.stdin.write(frame, (error: Error | null | undefined) => {
        callback?.(error ?? null);
      });
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private drainStdoutFrames(): void {
    if (this.stdoutPaused) {
      return;
    }

    while (this.pendingStdout.length >= 16) {
      if (this.pendingStdout.toString('ascii', 0, 4) !== decodeServerMagic) {
        this.failServer(createJuceDecodeError('invalid_server_frame_magic', this.hostBinary, this.args, this.stderrLines));
        return;
      }

      const version = this.pendingStdout.readUInt8(4);
      if (version !== decodeServerVersion) {
        this.failServer(createJuceDecodeError(`unsupported_server_frame_version:${version}`, this.hostBinary, this.args, this.stderrLines));
        return;
      }

      const type = this.pendingStdout.readUInt8(5);
      const sessionId = this.pendingStdout.readUInt32LE(8);
      const payloadBytes = this.pendingStdout.readUInt32LE(12);
      if (this.pendingStdout.length < 16 + payloadBytes) {
        return;
      }

      const payload = this.pendingStdout.subarray(16, 16 + payloadBytes);
      this.pendingStdout = this.pendingStdout.subarray(16 + payloadBytes);
      this.handleFrame(type, sessionId, payload);

      if (this.stdoutPaused) {
        return;
      }
    }
  }

  private handleFrame(type: number, sessionId: number, payload: Buffer): void {
    const run = this.activeRuns.get(sessionId);
    if (!run) {
      return;
    }

    if (type === frameTypeReady) {
      const metadata = parseReadyMetadata(payload);
      if (
        metadata.sampleRate !== null &&
        metadata.sampleRate !== run.requestedSampleRate
      ) {
        this.failRun(
          run,
          createJuceDecodeError(
            `server_ready_sample_rate_mismatch:${metadata.sampleRate}->${run.requestedSampleRate}`,
            this.hostBinary,
            this.args,
            this.stderrLines,
            { sessionId },
          ),
        );
        this.close();
        return;
      }

      if (
        metadata.channels !== null &&
        metadata.channels !== run.requestedChannels
      ) {
        this.failRun(
          run,
          createJuceDecodeError(
            `server_ready_channel_mismatch:${metadata.channels}->${run.requestedChannels}`,
            this.hostBinary,
            this.args,
            this.stderrLines,
            { sessionId },
          ),
        );
        this.close();
      }
      return;
    }

    if (type === frameTypePcmF32Le) {
      if (!run.stopped && payload.length > 0) {
        run.sawPcm = true;
        this.settleReady(run);
        const writable = run.stream.write(Buffer.from(payload));
        if (!writable) {
          this.stdoutPaused = true;
          this.proc.stdout.pause();
          run.stream.once('drain', () => {
            this.stdoutPaused = false;
            if (!this.closed) {
              this.proc.stdout.resume();
              this.drainStdoutFrames();
            }
          });
        }
      }
      return;
    }

    if (type === frameTypeEnd) {
      if (!run.sawPcm) {
        this.failRun(
          run,
          createJuceDecodeError('no_pcm_before_end', this.hostBinary, this.args, this.stderrLines, { sessionId }),
        );
        this.close();
        return;
      }

      this.settleReady(run);
      this.activeRuns.delete(sessionId);
      run.stream.end();
      this.settleDone(run);
      return;
    }

    if (type === frameTypeError) {
      const failedBeforePcm = !run.sawPcm;
      this.failRun(
        run,
        createJuceDecodeError(
          `server_error:${parseErrorMessage(payload)}`,
          this.hostBinary,
          this.args,
          this.stderrLines,
          { sessionId },
        ),
      );
      if (failedBeforePcm) {
        this.close();
      }
    }
  }

  private settleReady(run: ResidentDecodeRun): void {
    if (run.readySettled) {
      return;
    }

    run.readySettled = true;
    this.clearRunTimers(run);
    run.resolveReady();
  }

  private settleDone(run: ResidentDecodeRun): void {
    if (run.doneSettled) {
      return;
    }

    run.doneSettled = true;
    run.resolveDone();
  }

  private failRun(run: ResidentDecodeRun, error: Error): void {
    this.activeRuns.delete(run.sessionId);
    this.clearRunTimers(run);
    const failedBeforeReady = !run.readySettled;
    if (!run.readySettled) {
      run.readySettled = true;
      run.rejectReady(error);
    }
    if (!run.doneSettled) {
      run.doneSettled = true;
      if (failedBeforeReady || run.stopped) {
        run.resolveDone();
      } else {
        run.rejectDone(error);
      }
    }
    if (!failedBeforeReady && !run.stopped) {
      run.stream.destroy(error);
    } else {
      run.stream.destroy();
    }
  }

  private failServer(error: Error): void {
    for (const run of this.activeRuns.values()) {
      this.failRun(run, error);
    }
    this.activeRuns.clear();
    if (!this.closed) {
      this.closing = true;
      this.closed = true;
      if (!this.proc.killed) {
        this.proc.kill();
      }
      this.onClose(this);
    }
  }

  private clearRunTimers(run: ResidentDecodeRun): void {
    if (run.readyTimer) {
      clearTimeout(run.readyTimer);
      run.readyTimer = null;
    }
    if (run.firstPcmTimer) {
      clearTimeout(run.firstPcmTimer);
      run.firstPcmTimer = null;
    }
  }
}

export class JuceDecodePipeline {
  private readonly hostBinary: string | null;
  private readonly spawn: JuceDecodeSpawner;
  private readonly logger: (message: string) => void;
  private readonly readyTimeoutMs: number;
  private readonly firstPcmTimeoutMs: number;
  private server: ResidentJuceDecodeServer | null = null;

  constructor(dependencies: JuceDecodePipelineDependencies = {}) {
    this.hostBinary = dependencies.hostBinary ?? null;
    this.spawn = dependencies.spawn ?? (nodeSpawn as JuceDecodeSpawner);
    this.logger = dependencies.logger ?? defaultLogger;
    this.readyTimeoutMs = Math.max(250, dependencies.readyTimeoutMs ?? defaultReadyTimeoutMs);
    this.firstPcmTimeoutMs = Math.max(100, dependencies.firstPcmTimeoutMs ?? defaultFirstPcmTimeoutMs);
  }

  decodeLocalFile(request: PcmDecodeRequest): DecoderRun {
    const hostBinary = this.hostBinary ?? resolveHostBinary();
    if (!hostBinary) {
      throw new Error('echo-audio-host juce_decode_host_missing');
    }

    const server = this.ensureServer(hostBinary);
    return server.decode(request);
  }

  dispose(): void {
    this.server?.close();
    this.server = null;
  }

  private ensureServer(hostBinary: string): ResidentJuceDecodeServer {
    if (this.server) {
      return this.server;
    }

    this.server = new ResidentJuceDecodeServer(
      hostBinary,
      this.spawn,
      this.logger,
      this.readyTimeoutMs,
      this.firstPcmTimeoutMs,
      (server) => {
        if (this.server === server) {
          this.server = null;
        }
      },
    );
    return this.server;
  }
}
