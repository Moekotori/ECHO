import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { DaemonClient } from '../src/main/audio/DaemonClient';

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
  proc.kill = vi.fn();
  proc.pid = 42000 + Math.floor(Math.random() * 10000);
  return proc;
}

function sendLine(proc: MockProcess, obj: Record<string, unknown>): void {
  proc.stdout.write(JSON.stringify(obj) + '\n');
}

describe('DaemonClient', () => {
  let client: DaemonClient;
  let proc: MockProcess;

  beforeEach(() => {
    client = new DaemonClient();
    proc = createMockProcess();
    mockSpawn.mockClear();
    mockSpawn.mockReturnValue(proc);
  });

  afterEach(() => {
    // cleanup via fresh client+mock in beforeEach
  });

  // --- spawn() ---

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

  it('resolves after the ready timeout even without event.ready', { timeout: 10_000 }, async () => {
    vi.useFakeTimers();
    const p = client.spawn('/fake/bin');
    vi.advanceTimersByTime(5_000);
    await expect(p).resolves.toBeUndefined();
    expect(client.running).toBe(true);
    vi.useRealTimers();
  });

  // --- command() ---

  it('sends a JSON-RPC request and resolves with the result', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const cmd = client.command('play', { path: '/t.flac' });

    const written = proc.stdin.read()?.toString() ?? '';
    const req = JSON.parse(written);
    expect(req).toMatchObject({ jsonrpc: '2.0', method: 'play', params: { path: '/t.flac' } });
    expect(typeof req.id).toBe('number');

    sendLine(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'playing' } });
    await expect(cmd).resolves.toEqual({ status: 'playing' });
  });

  it('rejects when the daemon returns an error object', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const cmd = client.command('device.list');
    const req = JSON.parse(proc.stdin.read()?.toString() ?? '');
    sendLine(proc, { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } });
    await expect(cmd).rejects.toThrow('Method not found');
  });

  it('throws if the daemon is not running', async () => {
    await expect(client.command('play')).rejects.toThrow('Daemon is not running');
  });

  it('rejects pending requests when the daemon exits', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const cmd = client.command('play');
    proc.exitCode = 0;
    proc.emit('exit', 0, null);

    await expect(cmd).rejects.toThrow('Daemon process exited');
  });

  // --- Events ---

  it('emits event notifications received from stdout', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const events: { name: string; params: unknown }[] = [];
    client.on('event.state', (params: unknown) => events.push({ name: 'event.state', params }));

    sendLine(proc, { jsonrpc: '2.0', method: 'event.state', params: { state: 'playing' } });
    await new Promise(setImmediate);

    expect(events).toHaveLength(1);
    expect(events[0].params).toEqual({ state: 'playing' });
  });

  // --- shutdown() ---

  it('sends a shutdown command and kills the process', async () => {
    const p = client.spawn('/fake/bin');
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const shutdownPromise = client.shutdown();

    const written = proc.stdin.read()?.toString() ?? '';
    const req = JSON.parse(written);
    sendLine(proc, { jsonrpc: '2.0', id: req.id, result: { status: 'shutdown' } });

    await shutdownPromise;
    expect(proc.kill).toHaveBeenCalled();
    expect(client.running).toBe(false);
  });

  // --- Auto-reconnect (real timers) ---

  it('auto-restarts after unexpected exit when autoRestart=true', { timeout: 10_000 }, async () => {
    const p = client.spawn('/fake/bin', ['--null-output'], true);
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;

    const proc2 = createMockProcess();
    mockSpawn.mockReturnValue(proc2);

    proc.exitCode = 0;
    proc.emit('exit', 0, null);

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    sendLine(proc2, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await new Promise(setImmediate);
    expect(client.running).toBe(true);
  });

  it('does not auto-restart after shutdown', { timeout: 10_000 }, async () => {
    const p = client.spawn('/fake/bin', ['--null-output'], true);
    sendLine(proc, { jsonrpc: '2.0', method: 'event.ready', params: {} });
    await p;
    expect(client.running).toBe(true);

    // shutdown calls command('shutdown') then forceKill().
    // Respond to the command so it resolves quickly.
    const shutdownPromise = client.shutdown();
    const written = proc.stdin.read()?.toString() ?? '';
    if (written) {
      const req = JSON.parse(written);
      sendLine(proc, { jsonrpc: '2.0', id: req.id, result: {} });
    }
    await shutdownPromise;

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(client.running).toBe(false);
  });
});
