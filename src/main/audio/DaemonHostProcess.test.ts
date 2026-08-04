import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ===========================================================================
// Mocks — vi.hoisted state + vi.mock (MUST precede any local module import)
// ===========================================================================

const bridgeReg = vi.hoisted(() => ({
  activeRpcBridge: null as unknown,
}));

vi.mock('./HostBridgeRegistry', () => ({
  get activeJsonRpcBridge() {
    return bridgeReg.activeRpcBridge;
  },
  setActiveJsonRpcBridge: vi.fn((b: unknown) => {
    bridgeReg.activeRpcBridge = b;
  }),
  clearActiveJsonRpcBridge: vi.fn(() => {
    bridgeReg.activeRpcBridge = null;
  }),
  clearActiveJsonRpcBridgeIf: vi.fn((b: unknown) => {
    if (bridgeReg.activeRpcBridge === b) {
      bridgeReg.activeRpcBridge = null;
    }
  }),
}));

// NOTE: class extends EventEmitter inside a vi.mock factory triggers
// "Cannot access '__vi_import_0__' before initialization" in vitest.
// Use a plain constructor function instead.
vi.mock('./JsonRpcBridge', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockJsonRpcBridge(this: any) {
    this.isClosed = false;
    this.open = vi.fn();
    this.close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    this.call = vi.fn<() => Promise<unknown>>().mockResolvedValue('ok');
    this.on = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
  }

  return { JsonRpcBridge: MockJsonRpcBridge };
});

// ===========================================================================
// Local imports (resolved through the mocks above)
// ===========================================================================

import { isDaemonRunning, startDaemon, stopDaemon, DaemonHostProcess } from './DaemonHostProcess';
import type { DaemonHostProcessContext } from './DaemonHostProcess';
import { JsonRpcBridge } from './JsonRpcBridge';
import {
  setActiveJsonRpcBridge,
  clearActiveJsonRpcBridge,
  clearActiveJsonRpcBridgeIf,
} from './HostBridgeRegistry';

// ===========================================================================
// Mock ChildProcess (NOT inside a vi.mock factory — class extends is safe)
// ===========================================================================

let nextMockPid = 1000;

class MockChildProcess extends EventEmitter {
  pid: number;

  killed = false;

  exitCode: number | null = null;

  readonly stdout: PassThrough;

  readonly stderr: PassThrough;

  readonly stdin: Writable;

  readonly stdio: [Writable, PassThrough, PassThrough, Writable, PassThrough];

  constructor() {
    super();
    this.pid = nextMockPid;
    nextMockPid += 1;
    this.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    // fd 3: main → daemon (JSON-RPC requests)
    // fd 4: daemon → main (JSON-RPC responses)
    const rpcIn = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rpcOut = new PassThrough();
    this.stdio = [this.stdin, this.stdout, this.stderr, rpcIn, rpcOut];
  }

  kill(signal?: string): boolean {
    this.killed = true;
    if (signal === 'SIGTERM') {
      this.exitCode = 0;
      queueMicrotask(() => {
        this.emit('exit', 0, 'SIGTERM');
      });
    }
    return true;
  }
}

// ===========================================================================
// Helper — create a mock DaemonHostProcessContext
// ===========================================================================

function createMockContext(
  overrides?: Partial<DaemonHostProcessContext>,
): DaemonHostProcessContext {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let bridge: JsonRpcBridge | null = null;

  return {
    getProc: vi.fn(() => proc),
    setProc: vi.fn((p: ChildProcessWithoutNullStreams | null) => {
      proc = p;
    }),
    getJsonRpcBridge: vi.fn(() => bridge),
    setJsonRpcBridge: vi.fn((b: JsonRpcBridge | null) => {
      bridge = b;
    }),
    isStopRequested: () => false,
    spawn: vi.fn(),
    resolveHostBinary: () => '/usr/bin/echo-audio-host',
    logVerbose: vi.fn(),
    emitDaemonLifecycle: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('DaemonHostProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeReg.activeRpcBridge = null;
  });

  // -----------------------------------------------------------------------
  // startDaemon
  // -----------------------------------------------------------------------

  describe('startDaemon', () => {
    it('(a) spawns process and resolves on ready event', async () => {
      const context = createMockContext();
      const mockProc = new MockChildProcess();
      vi.mocked(context.spawn).mockReturnValue(
        mockProc as unknown as ChildProcessWithoutNullStreams,
      );

      const startPromise = startDaemon(context);

      // Let listeners attach
      await new Promise((r) => {
        setTimeout(r, 0);
      });
      // Daemon writes ready signal to stdout
      mockProc.stdout.write('{"ready":true}\n');

      await startPromise;

      // spawn called with correct binary & transport-only args
      expect(context.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = vi.mocked(context.spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('/usr/bin/echo-audio-host');
      expect(spawnCall[1]).toEqual([
        '--no-stdin',
        '--rpc-stdin-fd',
        '3',
        '--rpc-stdout-fd',
        '4',
      ]);

      // proc registered on context
      expect(context.setProc).toHaveBeenCalledWith(mockProc);

      // bridge registered in host-bridge registry
      expect(setActiveJsonRpcBridge).toHaveBeenCalled();
    });

    it('(b) rejects on spawn failure (process error event)', async () => {
      const context = createMockContext();
      const mockProc = new MockChildProcess();
      vi.mocked(context.spawn).mockReturnValue(
        mockProc as unknown as ChildProcessWithoutNullStreams,
      );

      const startPromise = startDaemon(context);

      await new Promise((r) => {
        setTimeout(r, 0);
      });
      // Simulate a spawn-time error (e.g. binary not found / not executable)
      mockProc.emit('error', new Error('spawn ENOENT'));

      await expect(startPromise).rejects.toThrow(
        'spawn_error:spawn ENOENT',
      );

      // cleanup runs: bridge cleared, lifecycle emitted
      expect(context.setJsonRpcBridge).toHaveBeenCalledWith(null);
      expect(context.emitDaemonLifecycle).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // stopDaemon
  // -----------------------------------------------------------------------

  describe('stopDaemon', () => {
    it('(c) kills process and cleans up JSON-RPC bridge', async () => {
      const context = createMockContext();
      const mockProc = new MockChildProcess();
      const mockBridge = new JsonRpcBridge();

      // Set up state as if startDaemon ran
      context.setProc(mockProc as unknown as ChildProcessWithoutNullStreams);
      context.setJsonRpcBridge(mockBridge);
      bridgeReg.activeRpcBridge = mockBridge;

      await stopDaemon(context);

      // attempted graceful shutdown via RPC
      expect(mockBridge.call).toHaveBeenCalledWith('rpc.shutdown');

      // bridge closed
      expect(mockBridge.close).toHaveBeenCalled();

      // bridge removed from context
      expect(context.setJsonRpcBridge).toHaveBeenCalledWith(null);

      // registry entry cleared
      expect(clearActiveJsonRpcBridgeIf).toHaveBeenCalled();

      // process killed with SIGTERM
      expect(mockProc.killed).toBe(true);

      // proc removed from context
      expect(context.setProc).toHaveBeenCalledWith(null);
    });
  });

  // -----------------------------------------------------------------------
  // isDaemonRunning
  // -----------------------------------------------------------------------

  describe('isDaemonRunning', () => {
    it('(d) returns true when proc is non-null and not exited', () => {
      const proc = new MockChildProcess();
      expect(
        isDaemonRunning(proc as unknown as ChildProcessWithoutNullStreams),
      ).toBe(true);
    });

    it('(e) returns false when proc is null', () => {
      expect(isDaemonRunning(null)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // createDaemonSpawnArgs
  // -----------------------------------------------------------------------

  describe('createDaemonSpawnArgs', () => {
    it('(f) returns only transport-level args (no audio params)', async () => {
      const context = createMockContext();
      const mockProc = new MockChildProcess();
      vi.mocked(context.spawn).mockReturnValue(
        mockProc as unknown as ChildProcessWithoutNullStreams,
      );

      const startPromise = startDaemon(context);
      await new Promise((r) => {
        setTimeout(r, 0);
      });
      mockProc.stdout.write('{"ready":true}\n');
      await startPromise;

      const spawnArgs = vi.mocked(context.spawn).mock.calls[0][1] as string[];

      // Exactly the documented transport-level args
      expect(spawnArgs).toEqual([
        '--no-stdin',
        '--rpc-stdin-fd',
        '3',
        '--rpc-stdout-fd',
        '4',
      ]);

      // Sanity: zero audio params slipped in
      const audioParamPrefixes = [
        '-sr',
        '--sample-rate',
        '-ch',
        '--channels',
        '--buffer',
        '-b',
        '--format',
        '--device',
        '-d',
        '--backend',
        '--fifo',
      ];
      const hasAudioParams = spawnArgs.some((arg) =>
        audioParamPrefixes.some((prefix) => arg.startsWith(prefix)),
      );
      expect(hasAudioParams).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // DaemonHostProcess class
  // -----------------------------------------------------------------------

  describe('DaemonHostProcess class', () => {
    describe('spawn()', () => {
      it('spawns process and resolves on ready event', async () => {
        const context = createMockContext();
        const mockProc = new MockChildProcess();
        vi.mocked(context.spawn).mockReturnValue(
          mockProc as unknown as ChildProcessWithoutNullStreams,
        );

        const host = new DaemonHostProcess(context);
        const spawnPromise = host.spawn();

        await new Promise((r) => {
          setTimeout(r, 0);
        });
        mockProc.stdout.write('{"ready":true}\n');

        await spawnPromise;

        expect(context.spawn).toHaveBeenCalledTimes(1);
        const spawnCall = vi.mocked(context.spawn).mock.calls[0];
        expect(spawnCall[0]).toBe('/usr/bin/echo-audio-host');
        expect(spawnCall[1]).toEqual([
          '--no-stdin',
          '--rpc-stdin-fd',
          '3',
          '--rpc-stdout-fd',
          '4',
        ]);

        expect(context.setProc).toHaveBeenCalledWith(mockProc);
        expect(setActiveJsonRpcBridge).toHaveBeenCalled();
      });

      it('rejects on spawn failure (process error event)', async () => {
        const context = createMockContext();
        const mockProc = new MockChildProcess();
        vi.mocked(context.spawn).mockReturnValue(
          mockProc as unknown as ChildProcessWithoutNullStreams,
        );

        const host = new DaemonHostProcess(context);
        const spawnPromise = host.spawn();

        await new Promise((r) => {
          setTimeout(r, 0);
        });
        mockProc.emit('error', new Error('spawn ENOENT'));

        await expect(spawnPromise).rejects.toThrow(
          'spawn_error:spawn ENOENT',
        );

        expect(context.setJsonRpcBridge).toHaveBeenCalledWith(null);
        expect(context.emitDaemonLifecycle).toHaveBeenCalled();
      });
    });

    describe('shutdown()', () => {
      it('kills process and cleans up JSON-RPC bridge', async () => {
        const context = createMockContext();
        const mockProc = new MockChildProcess();
        const mockBridge = new JsonRpcBridge();

        context.setProc(mockProc as unknown as ChildProcessWithoutNullStreams);
        context.setJsonRpcBridge(mockBridge);
        bridgeReg.activeRpcBridge = mockBridge;

        const host = new DaemonHostProcess(context);
        await host.shutdown();

        expect(mockBridge.call).toHaveBeenCalledWith('rpc.shutdown');
        expect(mockBridge.close).toHaveBeenCalled();
        expect(context.setJsonRpcBridge).toHaveBeenCalledWith(null);
        expect(clearActiveJsonRpcBridgeIf).toHaveBeenCalled();
        expect(mockProc.killed).toBe(true);
        expect(context.setProc).toHaveBeenCalledWith(null);
      });
    });

    describe('isRunning()', () => {
      it('returns true when proc is non-null and not exited', () => {
        const proc = new MockChildProcess();
        const context = createMockContext();
        context.setProc(proc as unknown as ChildProcessWithoutNullStreams);

        const host = new DaemonHostProcess(context);
        expect(host.isRunning()).toBe(true);
      });

      it('returns false when proc is null', () => {
        const context = createMockContext();
        const host = new DaemonHostProcess(context);
        expect(host.isRunning()).toBe(false);
      });
    });
  });
});
