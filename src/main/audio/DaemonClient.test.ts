import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { DaemonClient } from './DaemonClient';

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

interface MockProcess extends EventEmitter {
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function createMockProcess(): MockProcess {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();

  const proc = emitter as unknown as MockProcess;
  proc.stdout = stdout;
  proc.stdin = stdin;
  proc.stderr = stderr;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.exitCode = 0;
    proc.killed = true;
    proc.emit('exit', 0, null);
  });
  proc.pid = 42_000 + Math.floor(Math.random() * 10_000);
  return proc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendLine(proc: MockProcess, obj: Record<string, unknown>): void {
  proc.stdout.write(JSON.stringify(obj) + '\n');
}

/** Return the JSON-RPC request object written to stdin (or null). */
function readRequest(proc: MockProcess): Record<string, unknown> | null {
  const buf = proc.stdin.read() as Buffer | null;
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString());
  } catch {
    return null;
  }
}

/** Spawn the client and wait for it to be ready. */
async function startClient(client: DaemonClient, proc: MockProcess): Promise<void> {
  const p = client.spawn('/fake/bin');
  sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
  await p;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DaemonClient', () => {
  let client: DaemonClient;
  let proc: MockProcess;

  beforeEach(() => {
    client = new DaemonClient();
    proc = createMockProcess();
    mockSpawn.mockClear();
    mockSpawn.mockReturnValue(proc);
  });

  const cleanupProcs: MockProcess[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    cleanupProcs.push(proc);
    for (const p of cleanupProcs) {
      try { p.stdout.destroy(); } catch {}
      try { p.stdin.destroy(); } catch {}
      try { p.stderr.destroy(); } catch {}
      p.removeAllListeners();
    }
    cleanupProcs.length = 0;
  });

  // -----------------------------------------------------------------------
  // spawn()
  // -----------------------------------------------------------------------

  it('resolves once event.ready is received from stdout', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await expect(p).resolves.toBeUndefined();
    expect(client.running).toBe(true);
  });

  it('rejects if process exits before event.ready', async () => {
    const p = client.spawn('/fake/bin');
    proc.emit('exit', 1, null);
    await expect(p).rejects.toThrow('Daemon exited before ready');
    expect(client.running).toBe(false);
  });

  it('rejects if process emits an error before event.ready', async () => {
    const p = client.spawn('/fake/bin');
    proc.emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow('ENOENT');
  });

  it('resolves after the ready timeout even without event.ready', async () => {
    vi.useFakeTimers();
    const p = client.spawn('/fake/bin');
    vi.advanceTimersByTime(5_000);
    await expect(p).resolves.toBeUndefined();
    expect(client.running).toBe(true);
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // command()
  // -----------------------------------------------------------------------

  it('sends a JSON-RPC request and resolves with the result', async () => {
    await startClient(client, proc);

    const cmd = client.command('play', { path: '/t.flac' });

    const req = readRequest(proc)!;
    expect(req).toMatchObject({
      jsonrpc: '2.0',
      method: 'play',
      params: { path: '/t.flac' },
    });
    expect(typeof req.id).toBe('number');

    sendLine(proc, {
      jsonrpc: '2.0',
      id: req.id,
      result: { status: 'playing' },
    });

    await expect(cmd).resolves.toEqual({ status: 'playing' });
  });

  it('rejects when the daemon returns an error object', async () => {
    await startClient(client, proc);

    const cmd = client.command('device.list');
    const req = readRequest(proc)!;
    sendLine(proc, {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: 'Method not found' },
    });

    await expect(cmd).rejects.toThrow('Method not found');
  });

  it('throws if the daemon is not running', async () => {
    await expect(client.command('play')).rejects.toThrow('Daemon is not running');
  });

  it('rejects pending requests when the daemon exits', async () => {
    await startClient(client, proc);

    const cmd = client.command('play');
    proc.emit('exit', 0, null);

    await expect(cmd).rejects.toThrow('Daemon process exited');
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  it('emits event notifications received from stdout', async () => {
    await startClient(client, proc);

    const events: { name: string; params: unknown }[] = [];
    client.on('event.state', (params: unknown) => events.push({ name: 'event.state', params }));

    sendLine(proc, {
      jsonrpc: '2.0',
      method: 'event.state',
      params: { state: 'playing' },
    });

    await new Promise(setImmediate);
    expect(events).toHaveLength(1);
    expect(events[0].params).toEqual({ state: 'playing' });
  });

  // -----------------------------------------------------------------------
  // shutdown()
  // -----------------------------------------------------------------------

  it('sends a shutdown command and kills the process', async () => {
    await startClient(client, proc);

    const shutdownPromise = client.shutdown();

    const req = readRequest(proc)!;
    sendLine(proc, {
      jsonrpc: '2.0',
      id: req.id,
      result: { status: 'shutdown' },
    });

    await shutdownPromise;
    expect(client.running).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Auto-reconnect
  // -----------------------------------------------------------------------

  it('auto-restarts after unexpected exit when autoRestart=true', async () => {
    const p = client.spawn('/fake/bin', ['--null-output'], true);
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    // Create a second mock process for the respawn
    const proc2 = createMockProcess();
    cleanupProcs.push(proc2);
    mockSpawn.mockReturnValue(proc2);

    // Simulate unexpected exit
    (proc.kill as () => void)();

    // Wait for reconnect delay
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Complete the second spawn
    sendLine(proc2, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await new Promise(setImmediate);
    expect(client.running).toBe(true);
  });

  it('does not auto-restart after shutdown', async () => {
    const p = client.spawn('/fake/bin', ['--null-output'], true);
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    // Shutdown
    const shutdownPromise = client.shutdown();
    const req = readRequest(proc);
    if (req) sendLine(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'shutdown' } });
    await shutdownPromise;

    // No reconnect timer should have been set — spawn count stays at 1
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
