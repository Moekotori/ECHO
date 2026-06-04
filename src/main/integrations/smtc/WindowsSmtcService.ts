import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { app } from 'electron';
import type {
  SmtcCommand,
  SmtcDiagnosticEvent,
  SmtcDiagnostics,
  SmtcEnabledActions,
  SmtcHostState,
  SmtcPlaybackState,
  SmtcService,
  SmtcTrackMetadata,
} from './SmtcService';
import { SmtcCoverCache } from './SmtcCoverCache';

type SmtcLogger = {
  warn: (message: string, payload?: unknown) => void;
  info: (message: string, payload?: unknown) => void;
};

const defaultLogger: SmtcLogger = {
  warn: (message, payload) => console.warn(message, payload ?? ''),
  info: () => undefined,
};

type SmtcHostProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'on' | 'once' | 'kill' | 'killed' | 'exitCode'>;
type SpawnSmtcHost = (command: string, args?: readonly string[], options?: SpawnOptionsWithoutStdio) => SmtcHostProcess;
type CoverCacheLike = Pick<SmtcCoverCache, 'resolve'>;

export type WindowsSmtcServiceOptions = {
  logger?: SmtcLogger;
  spawnHost?: SpawnSmtcHost;
  resolveHostPath?: () => string;
  hostExists?: (hostPath: string) => boolean;
  coverCache?: CoverCacheLike;
};

const helperName = 'echo-smtc-host.exe';
const maxRecentDiagnosticErrors = 8;

export const resolveDefaultSmtcHostPath = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, helperName);
  }

  return join(app.getAppPath(), 'electron-app', 'build', helperName);
};

export class WindowsSmtcService implements SmtcService {
  private readonly commands = new EventEmitter();
  private readonly logger: SmtcLogger;
  private readonly spawnHost: SpawnSmtcHost;
  private readonly resolveHostPath: () => string;
  private readonly hostExists: (hostPath: string) => boolean;
  private readonly coverCache: CoverCacheLike;
  private host: SmtcHostProcess | null = null;
  private initialized = false;
  private disposed = false;
  private unavailable = false;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private pendingGracefulStop: Promise<void> | null = null;
  private stoppingGracefully = false;
  private currentHostPath: string | null = null;
  private hostState: SmtcHostState = 'not-initialized';
  private lastMetadataAt: string | null = null;
  private lastMetadataTrackId: string | null = null;
  private lastMetadataTitle: string | null = null;
  private lastMetadataArtist: string | null = null;
  private lastPlaybackState: SmtcPlaybackState | null = null;
  private lastPlaybackStateAt: string | null = null;
  private lastTimelineAt: string | null = null;
  private lastTimelinePositionSeconds: number | null = null;
  private lastTimelineDurationSeconds: number | null = null;
  private enabledActions: SmtcEnabledActions | null = null;
  private lastCommand: SmtcCommand | null = null;
  private lastCommandAt: string | null = null;
  private lastError: SmtcDiagnosticEvent | null = null;
  private readonly recentErrors: SmtcDiagnosticEvent[] = [];

  constructor(options: WindowsSmtcServiceOptions | SmtcLogger = {}) {
    if ('info' in options && 'warn' in options) {
      this.logger = options;
      this.spawnHost = spawn;
      this.resolveHostPath = resolveDefaultSmtcHostPath;
      this.hostExists = existsSync;
      this.coverCache = new SmtcCoverCache();
      return;
    }

    this.logger = options.logger ?? defaultLogger;
    this.spawnHost = options.spawnHost ?? spawn;
    this.resolveHostPath = options.resolveHostPath ?? resolveDefaultSmtcHostPath;
    this.hostExists = options.hostExists ?? existsSync;
    this.coverCache = options.coverCache ?? new SmtcCoverCache();
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.unavailable || this.disposed) {
      return;
    }

    const hostPath = this.resolveHostPath();
    this.currentHostPath = hostPath;
    if (!this.hostExists(hostPath)) {
      this.unavailable = true;
      this.hostState = 'missing';
      this.logger.warn('[SMTC] Windows SMTC host binary is missing; using no-op bridge mode', { hostPath });
      this.recordError('service', 'Windows SMTC host binary is missing');
      return;
    }

    this.initialized = true;
    this.hostState = 'starting';
    try {
      this.host = this.spawnHost(hostPath, [], {
        windowsHide: true,
        stdio: 'pipe',
      });
      this.currentHostPath = hostPath;
      this.hostState = 'running';
      this.bindHostProcess(this.host, hostPath);
      this.logger.info('[SMTC] Windows SMTC host initialized', { hostPath });
    } catch (error) {
      this.initialized = false;
      this.unavailable = true;
      this.hostState = 'error';
      this.logger.warn('[SMTC] Failed to start Windows SMTC host; using no-op bridge mode', {
        hostPath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.recordError('service', `Failed to start Windows SMTC host: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopGracefullyImpl();
    this.commands.removeAllListeners();
    this.initialized = false;
    this.hostState = 'stopped';
  }

  async stopGracefullyImpl(timeoutMs = 1000): Promise<void> {
    if (this.pendingGracefulStop) {
      return this.pendingGracefulStop;
    }

    const host = this.host;
    if (!host || host.killed || host.exitCode !== null) {
      this.host = null;
      return;
    }

    this.stoppingGracefully = true;
    this.hostState = 'stopping';
    this.pendingGracefulStop = this.stopHostProcess(host, timeoutMs).finally(() => {
      if (this.host === host) {
        this.host = null;
      }
      this.stoppingGracefully = false;
      this.pendingGracefulStop = null;
      if (!this.disposed && this.hostState === 'stopping') {
        this.hostState = 'stopped';
      }
    });

    return this.pendingGracefulStop;
  }

  private async stopHostProcess(host: SmtcHostProcess, timeoutMs: number): Promise<void> {
    try {
      this.writeRawToHost(host, { type: 'dispose' });
    } catch {
      // Best-effort child cleanup.
    }

    try {
      if (!host.stdin.destroyed && !host.stdin.writableEnded) {
        host.stdin.end();
      }
    } catch {
      // ignore process teardown races
    }

    const exited = await Promise.race([
      new Promise<boolean>((resolve) => host.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
        timer.unref?.();
      }),
    ]);

    if (!exited && !host.killed && host.exitCode === null) {
      this.logger.warn('[SMTC] graceful shutdown timed out, force killing');
      this.recordError('service', 'Graceful shutdown timed out, force killing');
      try {
        host.kill('SIGKILL');
      } catch {
        // Best-effort emergency cleanup.
      }
    }
  }

  async setPlaybackState(state: SmtcPlaybackState): Promise<void> {
    this.lastPlaybackState = state;
    this.lastPlaybackStateAt = new Date().toISOString();
    await this.writeMessage({ type: 'setPlaybackState', state });
  }

  async setMetadata(metadata: SmtcTrackMetadata): Promise<void> {
    const coverPath = await this.coverCache.resolve(metadata.coverPath);
    this.lastMetadataAt = new Date().toISOString();
    this.lastMetadataTrackId = metadata.trackId;
    this.lastMetadataTitle = metadata.title;
    this.lastMetadataArtist = metadata.artist;
    await this.writeMessage({
      type: 'setMetadata',
      ...metadata,
      coverPath,
    });
  }

  async setTimeline(positionSeconds: number, durationSeconds: number): Promise<void> {
    this.lastTimelineAt = new Date().toISOString();
    this.lastTimelinePositionSeconds = this.safeNumber(positionSeconds);
    this.lastTimelineDurationSeconds = this.safeNumber(durationSeconds);
    await this.writeMessage({
      type: 'setTimeline',
      positionSeconds: this.safeNumber(positionSeconds),
      durationSeconds: this.safeNumber(durationSeconds),
    });
  }

  async setEnabledActions(actions: SmtcEnabledActions): Promise<void> {
    this.enabledActions = { ...actions };
    await this.writeMessage({
      type: 'setEnabledActions',
      play: actions.play,
      pause: actions.pause,
      previous: actions.previous,
      next: actions.next,
      seek: actions.seek === true,
    });
  }

  onCommand(handler: (command: SmtcCommand) => void): () => void {
    this.commands.on('command', handler);
    return () => this.commands.off('command', handler);
  }

  protected emitCommand(command: SmtcCommand): void {
    this.lastCommand = command;
    this.lastCommandAt = new Date().toISOString();
    this.commands.emit('command', command);
  }

  getDiagnostics(): SmtcDiagnostics {
    return {
      enabled: true,
      platform: process.platform,
      hostState: this.hostState,
      initialized: this.initialized,
      hostPath: this.currentHostPath,
      lastMetadataAt: this.lastMetadataAt,
      lastMetadataTrackId: this.lastMetadataTrackId,
      lastMetadataTitle: this.lastMetadataTitle,
      lastMetadataArtist: this.lastMetadataArtist,
      lastPlaybackState: this.lastPlaybackState,
      lastPlaybackStateAt: this.lastPlaybackStateAt,
      lastTimelineAt: this.lastTimelineAt,
      lastTimelinePositionSeconds: this.lastTimelinePositionSeconds,
      lastTimelineDurationSeconds: this.lastTimelineDurationSeconds,
      enabledActions: this.enabledActions ? { ...this.enabledActions } : null,
      lastCommand: this.lastCommand,
      lastCommandAt: this.lastCommandAt,
      lastError: this.lastError ? { ...this.lastError } : null,
      recentErrors: this.recentErrors.map((event) => ({ ...event })),
      recoveryInFlight: false,
      recoveryAttemptsInWindow: 0,
      canRecover: false,
      lastRecoveryAt: null,
      lyricsEnabled: false,
    };
  }

  private bindHostProcess(host: SmtcHostProcess, hostPath: string): void {
    host.stdin.on('error', (error: Error) => {
      this.handleHostWriteFailure(host, hostPath, error);
    });

    host.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer = this.consumeLines(this.stdoutBuffer + chunk.toString(), (line) => this.handleStdoutLine(line));
    });

    host.stderr.on('data', (chunk: Buffer | string) => {
      this.stderrBuffer = this.consumeLines(this.stderrBuffer + chunk.toString(), (line) => {
        if (line.trim()) {
          this.logger.warn('[SMTC] Windows SMTC host stderr', { line });
        }
      });
    });

    host.on('error', (error: Error) => {
      this.unavailable = true;
      this.hostState = 'error';
      this.logger.warn('[SMTC] Windows SMTC host process error', {
        hostPath,
        error: error.message,
      });
      this.recordError('host', error.message);
    });

    host.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.host === host) {
        this.host = null;
        this.currentHostPath = null;
        this.initialized = false;
      }
      if (!this.disposed && !this.stoppingGracefully) {
        this.unavailable = true;
        this.hostState = 'unavailable';
        this.logger.warn('[SMTC] Windows SMTC host exited unexpectedly', { hostPath, code, signal });
        this.recordError('host', `Windows SMTC host exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      } else if (this.hostState === 'stopping') {
        this.hostState = 'stopped';
      }
    });
  }

  private consumeLines(buffer: string, onLine: (line: string) => void): string {
    const lines = buffer.split(/\r?\n/u);
    const nextBuffer = lines.pop() ?? '';

    for (const line of lines) {
      onLine(line);
    }

    return nextBuffer;
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line) as { type?: unknown; command?: unknown; message?: unknown; positionSeconds?: unknown };
      const command = this.parseCommandMessage(message);
      if (message.type === 'command' && command) {
        this.emitCommand(command);
      } else if (message.type === 'error') {
        this.logger.warn('[SMTC] Windows SMTC host reported an error', { message: String(message.message ?? '') });
        this.recordError('host', String(message.message ?? 'Windows SMTC host reported an error'));
      }
    } catch (error) {
      this.logger.warn('[SMTC] Failed to parse Windows SMTC host output', {
        line,
        error: error instanceof Error ? error.message : String(error),
      });
      this.recordError('host', `Failed to parse Windows SMTC host output: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeMessage(message: Record<string, unknown>): Promise<void> {
    await this.initialize();
    this.writeRaw(message);
  }

  private writeRaw(message: Record<string, unknown>): void {
    if (!this.host || this.disposed || this.unavailable || this.host.stdin.destroyed || !this.host.stdin.writable) {
      return;
    }

    this.writeRawToHost(this.host, message);
  }

  private writeRawToHost(host: SmtcHostProcess, message: Record<string, unknown>): void {
    if (host.stdin.destroyed || !host.stdin.writable) {
      return;
    }

    try {
      host.stdin.write(`${JSON.stringify(message)}\n`, (error: Error | null | undefined) => {
        if (error) {
          this.handleHostWriteFailure(host, this.currentHostPath ?? 'unknown', error);
        }
      });
    } catch (error) {
      this.handleHostWriteFailure(host, this.currentHostPath ?? 'unknown', error);
    }
  }

  private handleHostWriteFailure(host: SmtcHostProcess, hostPath: string, error: unknown): void {
    if (this.host !== host || this.disposed || this.stoppingGracefully) {
      return;
    }

    this.host = null;
    this.currentHostPath = null;
    this.initialized = false;
    this.unavailable = true;
    this.hostState = 'unavailable';
    this.logger.warn('[SMTC] Windows SMTC host stdin closed; using no-op bridge mode', {
      hostPath,
      error: error instanceof Error ? error.message : String(error),
    });
    this.recordError('service', `Windows SMTC host stdin closed: ${error instanceof Error ? error.message : String(error)}`);
  }

  private safeNumber(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private parseCommandMessage(message: { command?: unknown; positionSeconds?: unknown }): SmtcCommand | null {
    if (this.isButtonCommand(message.command)) {
      return message.command;
    }

    if (message.command === 'seek' && typeof message.positionSeconds === 'number' && Number.isFinite(message.positionSeconds)) {
      return {
        type: 'seek',
        positionSeconds: Math.max(0, message.positionSeconds),
      };
    }

    return null;
  }

  private recordError(source: SmtcDiagnosticEvent['source'], message: string): void {
    const event: SmtcDiagnosticEvent = {
      at: new Date().toISOString(),
      source,
      message,
    };
    this.lastError = event;
    this.recentErrors.push(event);
    if (this.recentErrors.length > maxRecentDiagnosticErrors) {
      this.recentErrors.splice(0, this.recentErrors.length - maxRecentDiagnosticErrors);
    }
  }

  private isButtonCommand(value: unknown): value is Exclude<SmtcCommand, { type: 'seek' }> {
    return value === 'play' || value === 'pause' || value === 'playPause' || value === 'previous' || value === 'next' || value === 'stop';
  }
}
