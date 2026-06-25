import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JMsg {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveBinary(): string {
  return join(process.cwd(), 'build', 'src', 'echo-audio-daemon');
}

interface DaemonContext {
  proc: ChildProcessWithoutNullStreams;
  rl: ReturnType<typeof createInterface>;
  nextId: number;
  responses: Map<number, JMsg>;
}

async function spawnDaemon(): Promise<DaemonContext> {
  const binary = resolveBinary();
  const proc = spawn(binary, ['--null-output'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  proc.stderr.resume();

  const rl = createInterface({ input: proc.stdout });
  const responses = new Map<number, JMsg>();

  rl.on('line', (line: string) => {
    let msg: JMsg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    // Store responses by id
    if (msg.id != null && msg.method == null) {
      responses.set(Number(msg.id), msg);
    }
  });

  // Wait for event.ready
  await new Promise<void>((resolve, reject) => {
    const onLine = (line: string) => {
      let msg: JMsg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.method === 'event.ready') {
        rl.off('line', onLine);
        resolve();
      }
    };
    rl.on('line', onLine);

    proc.on('error', reject);
    proc.on('exit', (code, signal) => {
      reject(new Error(`Daemon exited before ready (code=${code} signal=${signal})`));
    });

    // Timeout fallback
    setTimeout(() => {
      rl.off('line', onLine);
      resolve();
    }, 5000);
  });

  return { proc, rl, nextId: 0, responses };
}

async function command(
  ctx: DaemonContext,
  method: string,
  params?: unknown,
  timeoutMs = 10_000,
): Promise<unknown> {
  const id = ++ctx.nextId;

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.responses.delete(id);
      reject(new Error(`Timeout: ${method} (${timeoutMs}ms)`));
    }, timeoutMs);

    // Watch for the response
    const checkInterval = setInterval(() => {
      const msg = ctx.responses.get(id);
      if (msg) {
        ctx.responses.delete(id);
        clearTimeout(timer);
        clearInterval(checkInterval);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    }, 10);

    // Send the command
    const req: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) req.params = params;
    ctx.proc.stdin.write(JSON.stringify(req) + '\n');
  });
}

async function shutdownDaemon(ctx: DaemonContext): Promise<void> {
  if (ctx.proc.exitCode !== null) {
    ctx.rl.close();
    return; // already exited
  }
  try {
    await command(ctx, 'shutdown', {}, 3000);
  } catch {
    // ignore
  }
  ctx.rl.close();
  ctx.proc.stdin.end();
  if (ctx.proc.exitCode === null) {
    ctx.proc.kill();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('daemon EQ integration', () => {
  let ctx: DaemonContext;

  beforeAll(async () => {
    ctx = await spawnDaemon();
  }, 15_000);

  afterAll(async () => {
    await shutdownDaemon(ctx);
  }, 5_000);

  // ── 1. eq.setBand ──────────────────────────────────────────────────────

  it('eq.setBand: sets band gain and returns confirmation', async () => {
    const result = await command(ctx, 'eq.setBand', {
      index: 3,
      gainDb: 3.0,
      frequency: 1000,
      q: 1.0,
      enabled: true,
      type: 'peaking',
    });
    expect(result).toMatchObject({
      band: 3,
      gainDb: 3.0,
      enabled: true,
    });
  });

  // ── 2. eq.setEnabled ──────────────────────────────────────────────────

  it('eq.setEnabled: toggle true returns enabled:true', async () => {
    const result = await command(ctx, 'eq.setEnabled', { enabled: true });
    expect(result).toMatchObject({ enabled: true });
  });

  it('eq.setEnabled: toggle false returns enabled:false', async () => {
    const result = await command(ctx, 'eq.setEnabled', { enabled: false });
    expect(result).toMatchObject({ enabled: false });
  });

  // ── 3. eq.reset ───────────────────────────────────────────────────────

  it('eq.reset: returns reset:true', async () => {
    const result = await command(ctx, 'eq.reset', {});
    expect(result).toMatchObject({ reset: true });
  });

  // ── 4. eq.setPreset ───────────────────────────────────────────────────

  it('eq.setPreset: applies bands from a preset array', async () => {
    const bands = [
      { index: 0, gainDb: -2.0, frequency: 31.5, q: 0.707, enabled: true, type: 'lowshelf' },
      { index: 1, gainDb: 1.5, frequency: 63, q: 1.0, enabled: true, type: 'peaking' },
      { index: 2, gainDb: 3.0, frequency: 125, q: 1.0, enabled: true, type: 'peaking' },
    ];
    const result = await command(ctx, 'eq.setPreset', { bands });
    expect(result).toMatchObject({ bandsApplied: 3 });
  });

  // ── 5. convolution.loadIr ─────────────────────────────────────────────

  it('convolution.loadIr: fails with error for nonexistent file', async () => {
    await expect(
      command(ctx, 'convolution.loadIr', { path: '/nonexistent/file.wav' }),
    ).rejects.toThrow(/Failed to load IR/);
  });

  // ── 6. convolution.setEnabled ─────────────────────────────────────────

  it('convolution.setEnabled: toggle true returns enabled:true', async () => {
    const result = await command(ctx, 'convolution.setEnabled', { enabled: true });
    expect(result).toMatchObject({ enabled: true });
  });

  it('convolution.setEnabled: toggle false returns enabled:false', async () => {
    const result = await command(ctx, 'convolution.setEnabled', { enabled: false });
    expect(result).toMatchObject({ enabled: false });
  });

  // ── 7. channelBalance.setState ────────────────────────────────────────

  it('channelBalance.setState: sets left gain', async () => {
    const result = await command(ctx, 'channelBalance.setState', {
      leftGainDb: 0.5,
    });
    expect(result).toMatchObject({ applied: true, leftGainDb: 0.5 });
  });

  it('channelBalance.setState: sets balance', async () => {
    const result = await command(ctx, 'channelBalance.setState', {
      balance: -0.5,
    });
    expect(result).toMatchObject({ applied: true, balance: -0.5 });
  });

  it('channelBalance.setState: sets both channels', async () => {
    const result = await command(ctx, 'channelBalance.setState', {
      leftGainDb: -2.0,
      rightGainDb: 1.0,
    });
    expect(result).toMatchObject({ applied: true, leftGainDb: -2.0, rightGainDb: 1.0 });
  });

  // ── 8. levelMeter.subscribe / unsubscribe ─────────────────────────────

  it('levelMeter.subscribe: returns subscribed:true', async () => {
    const result = await command(ctx, 'levelMeter.subscribe', {
      intervalMs: 100,
    });
    expect(result).toMatchObject({ subscribed: true });
  });

  it('levelMeter.unsubscribe: returns subscribed:false', async () => {
    const result = await command(ctx, 'levelMeter.unsubscribe', {});
    expect(result).toMatchObject({ subscribed: false });
  });

  // ── Idempotency / edge cases ──────────────────────────────────────────

  it('eq.setBand with minimal params uses defaults', async () => {
    const result = await command(ctx, 'eq.setBand', { index: 0, gainDb: 0.0 });
    expect(result).toMatchObject({ band: 0, gainDb: 0.0, enabled: true });
  });

  it('eq.setPreset with empty bands array returns 0', async () => {
    const result = await command(ctx, 'eq.setPreset', { bands: [] });
    expect(result).toMatchObject({ bandsApplied: 0 });
  });

  it('unrecognized method returns MethodNotFound error', async () => {
    await expect(
      command(ctx, 'nonexistent.method', {}),
    ).rejects.toThrow('Method not found');
  });

  // shutdown must be the LAST test since it terminates the daemon
  it('shutdown returns cleanly and daemon exits', async () => {
    const result = await command(ctx, 'shutdown', {}, 3000);
    expect(result).toMatchObject({ status: 'shutdown' });

    // Wait for the daemon process to exit
    await new Promise<void>((resolve) => {
      if (ctx.proc.exitCode !== null) {
        resolve();
      } else {
        ctx.proc.on('exit', () => resolve());
      }
    });
    expect(ctx.proc.exitCode).toBe(0);
  });
});
