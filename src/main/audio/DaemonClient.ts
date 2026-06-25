import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JMsg {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: unknown;
}

const READY_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;
const GRACEFUL_SHUTDOWN_MS = 3_000;
const RECONNECT_DELAY_MS = 1_000;

/** JSON-RPC 2.0 client for the echo-audio-daemon subprocess. */
export class DaemonClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private shuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnect = false;

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * Spawn the daemon binary.
   * @param binaryPath  - Explicit path (omit for auto-resolution).
   * @param args        - CLI arguments (default `['--null-output']` in dev).
   * @param autoRestart - If true, respawn on unexpected exit (default false).
   */
  async spawn(
    binaryPath?: string,
    args?: string[],
    autoRestart?: boolean,
  ): Promise<void> {
    this.autoReconnect = autoRestart ?? false;
    const bin = binaryPath ?? resolveBinary();
    const argv = args ?? (binaryPath ? [] : ['--null-output']);

    return new Promise<void>((resolveReady, rejectReady) => {
      try {
        const proc = nodeSpawn(bin, argv, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.proc = proc;
        proc.stderr.resume();

        const rl = createInterface({ input: proc.stdout });
        let ready = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        rl.on('line', (line: string) => {
          let msg: JMsg;
          try { msg = JSON.parse(line); } catch { return; }
          this.handleMessage(msg);
          if (msg.method === 'event.ready' && !ready) {
            ready = true;
            if (timeout) clearTimeout(timeout);
            resolveReady();
          }
        });

        proc.on('error', (err) => {
          if (!ready) { ready = true; if (timeout) clearTimeout(timeout); rejectReady(err); }
          this.onExit();
        });

        proc.on('exit', (code, signal) => {
          if (!ready) {
            ready = true;
            if (timeout) clearTimeout(timeout);
            rejectReady(new Error(`Daemon exited before ready (code=${code} signal=${signal})`));
          }
          this.onExit();
        });

        timeout = setTimeout(() => {
          if (!ready) { ready = true; resolveReady(); }
        }, READY_TIMEOUT_MS);
      } catch (err) {
        rejectReady(err);
      }
    });
  }

  async command(method: string, params?: unknown): Promise<unknown> {
    if (!this.running) throw new Error('Daemon is not running');

    const id = ++this.nextId;
    const req: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.proc!.stdin.write(JSON.stringify(req) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /** Gracefully shut down the daemon (RPC + SIGKILL fallback). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (!this.proc || this.proc.exitCode !== null) return;

    try { await this.command('shutdown'); } catch { /* process may have already exited */ }

    await this.forceKill();
    this.proc = null;
  }

  private handleMessage(msg: JMsg): void {
    if (msg.id != null) {
      const pr = this.pending.get(Number(msg.id));
      if (!pr) return;
      clearTimeout(pr.timer);
      this.pending.delete(Number(msg.id));

      if (msg.error) {
        const err = new Error(msg.error.message) as Error & { code?: number; data?: unknown };
        err.code = msg.error.code;
        err.data = msg.error.data;
        pr.reject(err);
      } else {
        pr.resolve(msg.result);
      }
      return;
    }

    if (msg.method) {
      this.emit(msg.method, msg.params ?? {});
    }
  }

  private onExit(): void {
    this.proc = null;
    for (const [, pr] of this.pending) { clearTimeout(pr.timer); pr.reject(new Error('Daemon process exited')); }
    this.pending.clear();
    if (!this.shuttingDown && this.autoReconnect) {
      this.reconnectTimer = setTimeout(() => { this.spawn().catch(() => {}); }, RECONNECT_DELAY_MS);
    }
  }

  private forceKill(): Promise<void> {
    const p = this.proc;
    if (!p || p.exitCode !== null || p.killed) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(); }, GRACEFUL_SHUTDOWN_MS);
      p.on('exit', () => { clearTimeout(timer); resolve(); });
      p.stdin.end();
      p.kill();
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (matches AudioSession.getAudioSession pattern)
// ---------------------------------------------------------------------------

let defaultDaemonClient: DaemonClient | null = null;

export const getDaemonClient = (): DaemonClient => {
  defaultDaemonClient ??= new DaemonClient();
  return defaultDaemonClient;
};

/** Resolve the daemon binary path (prod: resourcesPath, dev: cwd/build/...). */
function resolveBinary(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { isPackaged?: boolean } };
    if (electron?.app?.isPackaged) {
      return join(process.resourcesPath, 'echo-audio-daemon');
    }
  } catch { /* not in electron */ }
  return join(process.cwd(), 'build', 'src', 'echo-audio-daemon');
}
