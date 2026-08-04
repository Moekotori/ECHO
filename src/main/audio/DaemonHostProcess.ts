import type { ChildProcessWithoutNullStreams, SpawnOptionsWithStdioTuple } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Readable, Writable } from 'node:stream';
import { JsonRpcBridge } from './JsonRpcBridge';
import {
  activeJsonRpcBridge,
  clearActiveJsonRpcBridge,
  clearActiveJsonRpcBridgeIf,
  setActiveJsonRpcBridge,
} from './HostBridgeRegistry';

export type BridgeSpawnOptions = SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'> & {
  windowsHide: boolean;
};

export type HostSpawner = (
  file: string,
  args: string[],
  options: BridgeSpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface DaemonSpawnOptions {
  hostBinary?: string;
}

export type DaemonHostProcessContext = {
  getProc: () => ChildProcessWithoutNullStreams | null;
  setProc: (proc: ChildProcessWithoutNullStreams | null) => void;
  getJsonRpcBridge: () => JsonRpcBridge | null;
  setJsonRpcBridge: (bridge: JsonRpcBridge | null) => void;
  isStopRequested: () => boolean;
  spawn: HostSpawner;
  resolveHostBinary: () => string | null;
  logVerbose: (message: string) => void;
  emitDaemonLifecycle: (event: {
    reason: string;
    pid: number | undefined;
    exitCode: number | null;
    signal: string | null;
    atMs: number;
  }) => void;
};

const DEBUG_AUDIO = process.env.ECHO_DEBUG_AUDIO === '1';
const daemonLog = (...args: unknown[]) => { if (DEBUG_AUDIO) console.log('[audio:daemon:bridge]', ...args); };

const DAEMON_TRANSPORT_ARGS: readonly string[] = [
  '--no-stdin',
  '--rpc-stdin-fd', '3',
  '--rpc-stdout-fd', '4',
];

const DAEMON_READY_TIMEOUT_MS = 15_000;

export class DaemonHostProcess {
  constructor(private readonly ctx: DaemonHostProcessContext) {}

  async spawn(options: DaemonSpawnOptions = {}): Promise<void> {
    const currentProc = this.ctx.getProc();
    if (currentProc && !currentProc.killed) {
      daemonLog('spawn: already running, pid=', currentProc.pid);
      return;
    }

    const bin = options.hostBinary ?? this.ctx.resolveHostBinary();
    if (!bin) {
      daemonLog('spawn: host binary not found');
      throw new Error('echo-audio-host binary not found');
    }

    const args = this.createSpawnArgs();
    const startedAtMs = performance.now();
    daemonLog('spawn: spawning', bin, args.join(' '));
    this.ctx.logVerbose(`[NativeOutputBridge] daemon spawn: ${bin} ${args.join(' ')}`);
    const spawnedProc = this.ctx.spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    } as unknown as BridgeSpawnOptions);
    this.ctx.setProc(spawnedProc);

    const daemonPid = spawnedProc.pid;
    daemonLog('spawn: spawned pid=', daemonPid);

    spawnedProc.stderr.setEncoding('utf8');
    spawnedProc.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          daemonLog('daemon stderr [pid=', daemonPid, ']:', trimmed);
        }
      }
    });

    let daemonReadyReject: ((err: Error) => void) | null = null;
    let daemonSettled = false;

    const invalidateDaemonBridge = (reason: string, exitCode?: number | null, signal?: string | null): void => {
      daemonLog('invalidateDaemonBridge:', reason,
        exitCode != null ? `exitCode=${exitCode}` : '',
        signal ? `signal=${signal}` : '');

      const jsonRpcBridge = this.ctx.getJsonRpcBridge();

      clearActiveJsonRpcBridgeIf(jsonRpcBridge);

      jsonRpcBridge?.close().catch((err: Error) => {
        daemonLog('bridge close error during invalidation:', err.message);
      });
      this.ctx.setJsonRpcBridge(null);

      if (this.ctx.getProc() === spawnedProc) {
        this.ctx.setProc(null);
      }

      this.ctx.emitDaemonLifecycle({
        reason,
        pid: daemonPid,
        exitCode: exitCode ?? null,
        signal: signal ?? null,
        atMs: performance.now(),
      });

      if (!daemonSettled && daemonReadyReject) {
        daemonSettled = true;
        daemonReadyReject(new Error(reason));
      }
    };

    spawnedProc.on('error', (err: Error) => {
      daemonLog('daemon proc error [pid=', daemonPid, ']:', err.message);
      if (this.ctx.getProc() !== spawnedProc) return;
      invalidateDaemonBridge(`spawn_error:${err.message}`);
    });

    spawnedProc.on('exit', (code: number | null, signal: string | null) => {
      daemonLog('daemon proc exit [pid=', daemonPid, ']:',
        `code=${code}`, `signal=${signal}`,
        `uptimeMs=${Math.round(performance.now() - startedAtMs)}`);
      if (this.ctx.getProc() !== spawnedProc) return;

      const intentional = this.ctx.isStopRequested();
      const normal = code === 0 && signal === null;

      if (!intentional && !normal) {
        daemonLog('daemon unexpected exit: pid=', daemonPid,
          `exitCode=${code}`, `signal=${signal}`);
      }

      invalidateDaemonBridge(
        intentional ? 'daemon_stopped' : code === 0 ? 'daemon_exited_clean' : 'daemon_exited_error',
        code,
        signal,
      );
    });

    const rpcInput = spawnedProc.stdio?.[3];
    const rpcOutput = spawnedProc.stdio?.[4];
    if (!rpcInput || !rpcOutput) {
      daemonLog('spawn: stdio fd3/fd4 unavailable, rejecting daemon startup');
      if (this.ctx.getProc() === spawnedProc) {
        this.ctx.setProc(null);
      }
      this.ctx.emitDaemonLifecycle({
        reason: 'daemon_rpc_stdio_unavailable',
        pid: daemonPid,
        exitCode: null,
        signal: null,
        atMs: performance.now(),
      });
      spawnedProc.kill('SIGKILL');
      throw new Error('daemon_rpc_stdio_unavailable');
    }

    const rpcBridge = new JsonRpcBridge();
    rpcBridge.open(rpcOutput as Readable, rpcInput as Writable);
    rpcBridge.on('close', () => {
      daemonLog('rpcBridge close event fired [pid=', daemonPid, ']');
      if (activeJsonRpcBridge === rpcBridge) {
        daemonLog('rpcBridge closed, clearing activeJsonRpcBridge');
        clearActiveJsonRpcBridge();
      }
    });
    rpcBridge.on('error', (err: Error) => {
      daemonLog('rpcBridge error event [pid=', daemonPid, ']:', err.message);
    });
    this.ctx.setJsonRpcBridge(rpcBridge);
    setActiveJsonRpcBridge(rpcBridge);
    daemonLog('spawn: JSON-RPC bridge opened [pid=', daemonPid, ']');

    daemonLog('spawn: waiting for ready [pid=', daemonPid, ']');
    await new Promise<void>((resolve, reject) => {
      daemonReadyReject = reject;

      const timer = setTimeout(() => {
        daemonLog('spawn: ready timeout [pid=', daemonPid, ']', `elapsedMs=${Math.round(performance.now() - startedAtMs)}`);

        if (daemonSettled) return;
        daemonSettled = true;

        const jsonRpcBridge = this.ctx.getJsonRpcBridge();
        if (activeJsonRpcBridge === jsonRpcBridge) {
          clearActiveJsonRpcBridge();
        }
        jsonRpcBridge?.close().catch(() => {});
        this.ctx.setJsonRpcBridge(null);

        try {
          spawnedProc.stdout?.removeAllListeners('data');
          spawnedProc.kill('SIGKILL');
        } catch {
        }

        reject(new Error('daemon start timeout'));
      }, DAEMON_READY_TIMEOUT_MS);

      // Ready format:
      //   One-shot (legacy):     {"ready":true,"sampleRate":48000,...}
      //   Daemon process-ready:  {"ready":true,"readyLevel":"process"}
      //   Daemon device-ready:   {"ready":true,"readyLevel":"device","sampleRate":48000,...}
      // spawn resolves on ANY ready — the two-level distinction
      // is consumed later in the playback path (session.begin triggers device-ready).
      const onData = (data: string): void => {
        for (const line of data.split('\n')) {
          if (line.includes('"ready":true')) {
            if (daemonSettled) return;
            daemonSettled = true;

            const elapsedMs = Math.round(performance.now() - startedAtMs);
            const readyLevel = line.includes('"readyLevel":"process"') ? 'process-ready (deferred)' : 'full-ready';
            daemonLog('spawn: ready detected [pid=', daemonPid, ']', `elapsedMs=${elapsedMs}`, `level=${readyLevel}`, 'bridge alive=', !!this.ctx.getJsonRpcBridge());
            clearTimeout(timer);
            spawnedProc.stdout?.removeListener('data', onData);
            resolve();
          }
        }
      };
      spawnedProc.stdout?.setEncoding('utf8');
      spawnedProc.stdout?.on('data', onData);
    });
  }

  async shutdown(): Promise<void> {
    const proc = this.ctx.getProc();
    if (!proc || proc.killed) {
      daemonLog('shutdown: no proc or already killed');
      return;
    }

    const pid = proc.pid;
    const startedAtMs = performance.now();
    daemonLog('shutdown: starting shutdown [pid=', pid, ']', 'bridge alive=', !!this.ctx.getJsonRpcBridge());

    const jsonRpcBridge = this.ctx.getJsonRpcBridge();
    if (jsonRpcBridge && !jsonRpcBridge.isClosed) {
      daemonLog('shutdown: sending rpc.shutdown [pid=', pid, ']');
      try {
        await Promise.race([
          jsonRpcBridge.call<string>('rpc.shutdown'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('rpc.shutdown timeout')), 2000)),
        ]);
        daemonLog('shutdown: rpc.shutdown acknowledged [pid=', pid, ']',
          `elapsedMs=${Math.round(performance.now() - startedAtMs)}`);
      } catch (err) {
        daemonLog('shutdown: rpc.shutdown failed or timed out [pid=', pid, ']:',
          err instanceof Error ? err.message : String(err));
      }
    }

    if (this.ctx.getJsonRpcBridge()) {
      daemonLog('shutdown: closing bridge [pid=', pid, ']');
      this.ctx.getJsonRpcBridge()?.close().catch(() => {});
      this.ctx.setJsonRpcBridge(null);
    }

    if (activeJsonRpcBridge === jsonRpcBridge) {
      daemonLog('shutdown: clearing activeJsonRpcBridge [pid=', pid, ']');
      clearActiveJsonRpcBridgeIf(jsonRpcBridge);
    }

    daemonLog('shutdown: sending SIGTERM [pid=', pid, ']');
    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        daemonLog('shutdown: SIGTERM timeout, sending SIGKILL [pid=', pid, ']',
          `elapsedMs=${Math.round(performance.now() - startedAtMs)}`);
        try {
          proc.kill('SIGKILL');
        } catch {
        }
        resolve();
      }, 3000);
      proc.on('exit', () => {
        clearTimeout(timer);
        daemonLog('shutdown: process exited [pid=', pid, ']',
          `elapsedMs=${Math.round(performance.now() - startedAtMs)}`);
        resolve();
      });
    });

    this.ctx.setProc(null);
    daemonLog('shutdown: complete [pid=', pid, ']',
      `totalElapsedMs=${Math.round(performance.now() - startedAtMs)}`);
  }

  isRunning(): boolean {
    const proc = this.ctx.getProc();
    return proc !== null && !proc.killed && proc.exitCode === null;
  }

  private createSpawnArgs(): string[] {
    return [...DAEMON_TRANSPORT_ARGS];
  }
}

export async function startDaemon(
  context: DaemonHostProcessContext,
  options: DaemonSpawnOptions = {},
): Promise<void> {
  return new DaemonHostProcess(context).spawn(options);
}

export async function stopDaemon(context: DaemonHostProcessContext): Promise<void> {
  return new DaemonHostProcess(context).shutdown();
}

export function isDaemonRunning(proc: ChildProcessWithoutNullStreams | null): boolean {
  return proc !== null && !proc.killed && proc.exitCode === null;
}
