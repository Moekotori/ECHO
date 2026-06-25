/**
 * Daemon Integration Test
 *
 * Spawns echo-audio-daemon as a child process in --null-output mode and
 * communicates via JSON-RPC 2.0 over stdin/stdout.
 *
 * Null-output mode registers these handlers:
 *   test.echo, test.play, device.list, test.getStatus,
 *   pause, resume, stop, setVolume, shutdown,
 *   eq.*, convolution.*, channelBalance.*, levelMeter.*
 *
 * Methods that require real audio processing (probe, seek, play) are
 * NOT registered in null-output mode -- the tests verify they return
 * the standard JSON-RPC -32601 (Method not found) error.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the daemon binary path relative to the project root. */
function daemonBinary(): string {
  // Allow ECHO_DAEMON_BIN env override (useful in CI)
  if (process.env.ECHO_DAEMON_BIN) return process.env.ECHO_DAEMON_BIN;
  return resolve(__dirname, '../../../../native/echo-audio-daemon/build/src/echo-audio-daemon');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ECHO Audio Daemon Integration', () => {
  let daemon: ChildProcessWithoutNullStreams;
  let nextId = 1;
  let daemonExited = false;

  // -----------------------------------------------------------------------
  // Async line reader
  // -----------------------------------------------------------------------
  const lineBuffer: string[] = [];
  const lineWaiters: Array<(line: string) => void> = [];

  function pushLine(line: string): void {
    if (lineWaiters.length > 0) {
      lineWaiters.shift()!(line);
    } else {
      lineBuffer.push(line);
    }
  }

  function readLine(timeoutMs = 5_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (lineBuffer.length > 0) {
        return resolve(lineBuffer.shift()!);
      }

      const timer = setTimeout(() => {
        const idx = lineWaiters.indexOf(resolve);
        if (idx >= 0) lineWaiters.splice(idx, 1);
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for daemon response`));
      }, timeoutMs);

      lineWaiters.push((line: string) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  /** Send a JSON-RPC request and await its matching response. */
  async function send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const id = nextId++;
    const request: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) request.params = params;

    daemon.stdin.write(JSON.stringify(request) + '\n');

    // Consume lines until we get a response matching our id
    while (!daemonExited) {
      const line = await readLine(timeoutMs);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // malformed line, skip
      }

      // Notifications have no id — skip
      if (msg.id === undefined || msg.id === null) {
        continue;
      }

      // Response matching our id
      if (msg.id === id) return msg;
    }

    throw new Error('Daemon exited before response');
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  beforeAll(async () => {
    const binary = daemonBinary();
    daemon = spawn(binary, ['--null-output'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Stderr → console for diagnostics
    daemon.stderr.resume();
    daemon.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[daemon:err] ${chunk.toString().trim()}\n`);
    });

    daemon.on('exit', (code, signal) => {
      daemonExited = true;
      // Signal any pending waiters
      for (const w of lineWaiters.splice(0)) {
        w('');
      }
    });

    // Wire up stdout reader
    const rl = createInterface({ input: daemon.stdout });
    rl.on('line', (line: string) => pushLine(line));
    rl.on('close', () => {
      // If reading and daemon closes, wake waiters
      for (const w of lineWaiters.splice(0)) {
        w('');
      }
    });

    // null-output mode doesn't emit event.ready — it starts silently.
    await new Promise((r) => setTimeout(r, 300));

    if (daemon.exitCode !== null) {
      throw new Error(
        `Daemon exited before startup (code=${daemon.exitCode}). ` +
        'Try building the daemon first: cd native/echo-audio-daemon && cmake --build build',
      );
    }
  });

  afterAll(() => {
    // Graceful shutdown
    if (!daemonExited && daemon.exitCode === null) {
      try {
        const id = nextId++;
        daemon.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', id, method: 'shutdown', params: {} }) + '\n',
        );
      } catch {
        // Process may already be gone
      }
    }

    // Force kill after 2 seconds
    const killTimer = setTimeout(() => {
      if (!daemonExited && daemon.exitCode === null) {
        daemon.kill('SIGKILL');
      }
    }, 2_000);

    // Give it a moment, then clean up
    daemon.on('exit', () => {
      clearTimeout(killTimer);
    });

    // If still alive after the timer, SIGKILL will have fired
  });

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  describe('device methods', () => {
    it('device.list returns at least the null device', async () => {
      const resp = await send('device.list');
      expect(resp).toHaveProperty('result');
      const result = resp.result as Record<string, unknown>;
      expect(result).toHaveProperty('devices');
      expect(Array.isArray(result.devices)).toBe(true);
      expect((result.devices as unknown[]).length).toBeGreaterThanOrEqual(1);

      const device = (result.devices as Record<string, unknown>[])[0];
      expect(device).toHaveProperty('id');
      expect(device).toHaveProperty('name');
      expect(device).toHaveProperty('outputMode');
      expect(device).toHaveProperty('isDefault');
      expect(device.name).toContain('Null');
    });
  });

  describe('playback methods', () => {
    const testFilePath = '/tmp/test_tone.flac';

    it('test.play starts null-output playback', async () => {
      const resp = await send('test.play', { path: testFilePath });
      expect(resp).toHaveProperty('result');
      const result = resp.result as Record<string, unknown>;
      expect(result.status).toBe('playing');
      expect(result.path).toBe(testFilePath);
      expect(typeof result.framesWritten).toBe('number');
      expect(typeof result.writeCount).toBe('number');
    });

    it('pause pauses playback', async () => {
      // Ensure we're playing first
      await send('test.play', { path: testFilePath });
      const resp = await send('pause');
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).status).toBe('paused');
    });

    it('resume resumes playback', async () => {
      // Ensure we're paused
      await send('test.play', { path: testFilePath });
      await send('pause');
      const resp = await send('resume');
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).status).toBe('playing');
    });

    it('stop stops playback', async () => {
      await send('test.play', { path: testFilePath });
      const resp = await send('stop');
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).status).toBe('stopped');
    });

    it('full play → pause → resume → stop cycle', async () => {
      // Play
      let resp = await send('test.play', { path: testFilePath });
      expect((resp.result as Record<string, unknown>).status).toBe('playing');

      // Pause
      resp = await send('pause');
      expect((resp.result as Record<string, unknown>).status).toBe('paused');

      // Resume
      resp = await send('resume');
      expect((resp.result as Record<string, unknown>).status).toBe('playing');

      // Stop
      resp = await send('stop');
      expect((resp.result as Record<string, unknown>).status).toBe('stopped');
    });
  });

  describe('volume control', () => {
    it('setVolume sets the volume level', async () => {
      const resp = await send('setVolume', { volume: 0.75 });
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).volume).toBe(0.75);
    });

    it('setVolume accepts 0.0 (silent)', async () => {
      const resp = await send('setVolume', { volume: 0.0 });
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).volume).toBe(0.0);
    });

    it('setVolume accepts 1.0 (full)', async () => {
      const resp = await send('setVolume', { volume: 1.0 });
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).volume).toBe(1.0);
    });
  });

  describe('test helpers', () => {
    it('test.echo returns the same params', async () => {
      const params = { msg: 'hello', num: 42 };
      const resp = await send('test.echo', params);
      expect(resp).toHaveProperty('result');
      expect(resp.result).toEqual(params);
    });

    it('test.getStatus reports current daemon state', async () => {
      const resp = await send('test.getStatus');
      expect(resp).toHaveProperty('result');
      const result = resp.result as Record<string, unknown>;
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('volume');
      expect(result).toHaveProperty('isOpen');
      expect(result).toHaveProperty('framesWritten');
      expect(result).toHaveProperty('writeCount');
    });
  });

  describe('error handling', () => {
    it('returns -32601 error for unknown methods (play in null-output)', async () => {
      // In null-output mode, "play" is not registered (only "test.play" is)
      const resp = await send('play', { path: '/tmp/test_tone.flac' });
      expect(resp).toHaveProperty('error');
      expect(resp).not.toHaveProperty('result');
      const err = resp.error as Record<string, unknown>;
      expect(err.code).toBe(-32601);
      expect(typeof err.message).toBe('string');
    });

    it('returns -32601 error for probe in null-output mode', async () => {
      const resp = await send('probe', { path: '/tmp/test_tone.flac' });
      expect(resp).toHaveProperty('error');
      const err = resp.error as Record<string, unknown>;
      expect(err.code).toBe(-32601);
    });

    it('returns -32601 error for seek in null-output mode', async () => {
      const resp = await send('seek', { seconds: 1.0 });
      expect(resp).toHaveProperty('error');
      const err = resp.error as Record<string, unknown>;
      expect(err.code).toBe(-32601);
    });

  });

  describe('shutdown', () => {
    it('shutdown returns success and daemon exits', async () => {
      const resp = await send('shutdown');
      expect(resp).toHaveProperty('result');
      expect((resp.result as Record<string, unknown>).status).toBe('shutdown');

      // Wait for the daemon process to exit
      await new Promise<void>((resolve) => {
        if (daemon.exitCode !== null) {
          resolve();
        } else {
          daemon.on('exit', () => resolve());
        }
      });
      expect(daemon.exitCode).toBe(0);
    });
  });
});
