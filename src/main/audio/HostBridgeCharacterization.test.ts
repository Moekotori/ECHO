import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { JsonRpcBridge } from './JsonRpcBridge';
import type { NativeOutputStartOptions } from './audioTypes';
import type { HostSpawner } from './DaemonHostProcess';

const { spawnMock, existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  existsSyncMock: vi.fn(() => true),
  readFileSyncMock: vi.fn(() => Buffer.from('MZ')),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('electron', () => ({
  default: {
    app: {
      getAppPath: () => '/app',
    },
  },
}));

class CapturingWritable extends Writable {
  readonly chunks: Buffer[] = [];
  readonly endSpy = vi.fn();
  readonly destroySpy = vi.fn();

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.endSpy();
    callback();
  }

  override destroy(error?: Error): this {
    this.destroySpy(error);
    return super.destroy(error);
  }
}

class ThrowingWritable extends Writable {
  override write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    void chunk;
    void encoding;
    void callback;
    throw new Error('fd3 write failed');
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
}

class DeferredWritable extends Writable {
  readonly chunks: Buffer[] = [];
  private pendingCallbacks: Array<(error?: Error | null) => void> = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    this.pendingCallbacks.push(callback);
  }

  flush(error?: Error): void {
    const callbacks = this.pendingCallbacks.splice(0);
    callbacks.forEach((callback) => callback(error));
  }
}

class FakeChildProcess extends EventEmitter {
  static nextPid = 1000;

  readonly stdin = new CapturingWritable();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly rpcIn = new CapturingWritable();
  readonly rpcOut = new PassThrough();
  readonly stdio = [this.stdin, this.stdout, this.stderr, this.rpcIn, this.rpcOut] as const;
  readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killSignals.push(signal ?? 'SIGTERM');
    if (signal === 'SIGKILL') this.killed = true;
    return true;
  });
  readonly killSignals: Array<NodeJS.Signals | number> = [];
  killed = false;
  exitCode: number | null = null;
  pid = FakeChildProcess.nextPid++;

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }

  emitReadyLine(line = JSON.stringify({ ready: true, sampleRate: 48000, backend: 'wasapi-shared' })): void {
    this.stdout.write(`${line}\n`);
  }

  emitDaemonReady(): void {
    this.stdout.emit('data', '{"ready":true}\n');
  }
}

type NativePcmHostProcessModule = typeof import('./NativePcmHostProcess');
type BackendLifecycleModule = typeof import('./BackendLifecycle');

const importFreshNativePcmHostProcess = async (): Promise<NativePcmHostProcessModule> => {
  vi.resetModules();
  return import('./NativePcmHostProcess');
};

const importFreshBackendLifecycle = async (): Promise<BackendLifecycleModule> => {
  vi.resetModules();
  return import('./BackendLifecycle');
};

const sharedOptions = (overrides: Partial<NativeOutputStartOptions> = {}): NativeOutputStartOptions => ({
  requestedOutputSampleRate: 48000,
  channels: 2,
  sharedBackend: 'auto',
  latencyProfile: 'balanced',
  inputFormat: 'pcm-f32le',
  ...overrides,
});

const createSpawn = () => {
  const procs: FakeChildProcess[] = [];
  const spawn = vi.fn<HostSpawner>(() => {
    const proc = new FakeChildProcess();
    procs.push(proc);
    return proc as unknown as ChildProcessWithoutNullStreams;
  });
  return { spawn, procs };
};

const settleMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const settleStreamCallbacks = async (): Promise<void> => {
  await settleMicrotasks();
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const respondToSessionBegin = (proc: FakeChildProcess, chunkIndex = proc.rpcIn.chunks.length - 1): void => {
  const request = JSON.parse(proc.rpcIn.chunks[chunkIndex].toString('utf8'));
  proc.rpcOut.write(`${JSON.stringify({ jsonrpc: '2.0', result: true, id: request.id })}\n`);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
  readFileSyncMock.mockReset();
  readFileSyncMock.mockReturnValue(Buffer.from('MZ'));
});

describe('NativeOutputBridge module globals and daemon process lifecycle', () => {
  it('sets activeJsonRpcBridge only after daemon spawn opens fd3/fd4, clears it on bridge close and daemon exit', async () => {
    const { NativePcmHostProcess, getActiveJsonRpcBridge, clearActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.startDaemon({ hostBinary: '/bin/echo-audio-host' });
    const proc = procs[0];

    expect(getActiveJsonRpcBridge()).not.toBeNull();
    expect(spawn).toHaveBeenCalledWith('/bin/echo-audio-host', expect.arrayContaining([
      '--no-stdin', '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4',
    ]), {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    expect(spawn.mock.calls[0][1]).not.toContain('--ecnp');

    const active = getActiveJsonRpcBridge();
    proc.emitDaemonReady();
    await start;
    expect(getActiveJsonRpcBridge()).toBe(active);

    await active?.close();
    clearActiveJsonRpcBridge();
    await settleMicrotasks();
    expect(getActiveJsonRpcBridge()).toBeNull();
    proc.emitExit(0, null);

    const restart = bridge.startDaemon({ hostBinary: '/bin/echo-audio-host' });
    const restartedProc = procs[1];
    restartedProc.emitDaemonReady();
    await restart;
    expect(getActiveJsonRpcBridge()).not.toBeNull();

    restartedProc.emitExit(1, null);
    await settleMicrotasks();
    expect(getActiveJsonRpcBridge()).toBeNull();
    expect(bridge.isDaemonRunning()).toBe(false);
  });

  it('rejects daemon startup when fd3/fd4 are unavailable even if stdout reports ready', async () => {
    const { NativePcmHostProcess, getActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const proc = new FakeChildProcess();
    Object.defineProperty(proc, 'stdio', {
      value: [proc.stdin, proc.stdout, proc.stderr],
      configurable: true,
    });
    const spawn = vi.fn<HostSpawner>(() => proc as unknown as ChildProcessWithoutNullStreams);
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.startDaemon({ hostBinary: '/bin/echo-audio-host' });
    proc.emitDaemonReady();

    await expect(start).rejects.toThrow('daemon_rpc_stdio_unavailable');
    expect(getActiveJsonRpcBridge()).toBeNull();
    expect(bridge.isDaemonRunning()).toBe(false);
    expect(proc.killSignals).toContain('SIGKILL');
  });

  it('streams Automix next deck PCM over the JSON-RPC side band', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    const proc = procs[0];
    proc.emitReadyLine();
    await start;

    const sessionId = bridge.beginSession();
    bridge.prepareAutomixPlan({
      mode: 'smartCrossfade',
      currentStartSeconds: 0,
      currentEndSeconds: 0,
      currentFadeStartSeconds: 0,
      nextStartSeconds: 0,
      overlapSeconds: 3,
      curve: 'hsin',
      currentGainDb: -1,
      nextGainDb: -2,
      tempoRatio: 1,
      advanceAtSeconds: 0,
      skipIntroSilence: false,
      beatAligned: false,
      fallbackReason: null,
    }, { fadeStartSeconds: 7, sampleRate: 48000 });
    const writable = bridge.createAutomixNextWritable();
    await new Promise<void>((resolve, reject) => {
      writable.write(Buffer.from([1, 2, 3, 4]), (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      writable.end((error?: Error | null) => error ? reject(error) : resolve());
    });

    const messages = Buffer.concat(proc.rpcIn.chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(messages).toEqual([
      expect.objectContaining({
        method: 'audio.sessionBegin',
        params: [{ sessionId, sr: 48000, ch: 2 }],
      }),
      expect.objectContaining({
        method: 'audio.automixPrepare',
        params: expect.objectContaining({ sessionId, fadeStartSeconds: 7, overlapSeconds: 3 }),
      }),
      expect.objectContaining({
        method: 'audio.automixNext',
        params: { sessionId, pcmBase64: Buffer.from([1, 2, 3, 4]).toString('base64') },
      }),
      expect.objectContaining({
        method: 'audio.automixNextEnd',
        params: { sessionId },
      }),
    ]);
  });

  it('does not let stale Automix next deck writables write into a later session', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    const proc = procs[0];
    proc.emitReadyLine();
    await start;

    const firstSessionId = bridge.beginSession();
    bridge.prepareAutomixPlan({
      mode: 'smartCrossfade',
      currentStartSeconds: 0,
      currentEndSeconds: 0,
      currentFadeStartSeconds: 0,
      nextStartSeconds: 0,
      overlapSeconds: 3,
      curve: 'hsin',
      currentGainDb: -1,
      nextGainDb: -2,
      tempoRatio: 1,
      advanceAtSeconds: 0,
      skipIntroSilence: false,
      beatAligned: false,
      fallbackReason: null,
    }, { fadeStartSeconds: 7, sampleRate: 48000 });
    const staleWritable = bridge.createAutomixNextWritable();
    const secondSessionId = bridge.beginSession();

    await new Promise<void>((resolve, reject) => {
      staleWritable.write(Buffer.from([1, 2, 3, 4]), (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      staleWritable.end((error?: Error | null) => error ? reject(error) : resolve());
    });

    const messages = Buffer.concat(proc.rpcIn.chunks).toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(messages).toEqual([
      expect.objectContaining({
        method: 'audio.sessionBegin',
        params: [{ sessionId: firstSessionId, sr: 48000, ch: 2 }],
      }),
      expect.objectContaining({
        method: 'audio.automixPrepare',
        params: expect.objectContaining({ sessionId: firstSessionId }),
      }),
      expect.objectContaining({
        method: 'audio.sessionBegin',
        params: [{ sessionId: secondSessionId, sr: 48000, ch: 2 }],
      }),
    ]);
  });

  it('announces every reused raw session before second-session Automix side-band messages', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    const proc = procs[0];
    proc.emitReadyLine();
    await start;

    const firstSessionId = bridge.beginSession();
    const secondSessionId = bridge.beginSession();
    bridge.prepareAutomixPlan({
      mode: 'smartCrossfade',
      currentStartSeconds: 0,
      currentEndSeconds: 0,
      currentFadeStartSeconds: 0,
      nextStartSeconds: 0,
      overlapSeconds: 2,
      curve: 'hsin',
      currentGainDb: 0,
      nextGainDb: -3,
      tempoRatio: 1,
      advanceAtSeconds: 0,
      skipIntroSilence: false,
      beatAligned: false,
      fallbackReason: null,
    }, { fadeStartSeconds: 4, sampleRate: 48000 });
    const writable = bridge.createAutomixNextWritable();
    await new Promise<void>((resolve, reject) => {
      writable.write(Buffer.from([5, 6, 7, 8]), (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      writable.end((error?: Error | null) => error ? reject(error) : resolve());
    });

    const messages = Buffer.concat(proc.rpcIn.chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(secondSessionId).toBe(firstSessionId + 1);
    expect(messages.map((message) => message.method)).toEqual([
      'audio.sessionBegin',
      'audio.sessionBegin',
      'audio.automixPrepare',
      'audio.automixNext',
      'audio.automixNextEnd',
    ]);
    expect(messages[0].params).toEqual([{ sessionId: firstSessionId, sr: 48000, ch: 2 }]);
    expect(messages[1].params).toEqual([{ sessionId: secondSessionId, sr: 48000, ch: 2 }]);
    expect(messages.slice(2).every((message) => message.params.sessionId === secondSessionId)).toBe(true);
  });


  it('freezes ready, position, error, and ended stdout event field names', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const stdoutRef = new PassThrough();
    const proc = new FakeChildProcess();
    Object.defineProperty(proc, 'stdout', { value: stdoutRef, configurable: true });
    Object.defineProperty(proc, 'stdio', {
      value: [proc.stdin, stdoutRef, proc.stderr, proc.rpcIn, proc.rpcOut],
      configurable: true,
    });
    const spawn = vi.fn<HostSpawner>(() => proc as unknown as ChildProcessWithoutNullStreams);
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });
    const readyEvents: unknown[] = [];
    const positionEvents: unknown[] = [];
    const errors: string[] = [];
    let endedCount = 0;
    bridge.on('ready', (event) => readyEvents.push(event));
    bridge.on('position', (frames, telemetry) => positionEvents.push({ frames, telemetry }));
    bridge.on('error', (error) => errors.push(error instanceof Error ? error.message : String(error)));
    bridge.on('ended', () => { endedCount += 1; });

    const start = bridge.start(sharedOptions({ bufferSizeFrames: 512 }));
    stdoutRef.write(`${JSON.stringify({
      ready: true,
      sampleRate: 48000,
      hardwareSampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      sharedSampleRate: 48000,
      channels: 2,
      exclusive: false,
      eqControlPort: 0,
      deviceBufferFrames: 512,
      nativeActualBufferFrames: 512,
      actualBufferFrames: 512,
      requestedDeviceBufferFrames: 512,
      openedDeviceBufferFrames: 512,
      bufferSizeFallback: false,
      fifoCapacityFrames: 48000,
      startupPrebufferFrames: 0,
      startupPrebufferTimeoutMs: 0,
      dspActive: false,
      dspClippingRisk: false,
      dspLimiterProtecting: false,
      backend: 'miniaudio-shared',
      backendImpl: 'miniaudio-shared',
      deviceType: 'Windows Audio',
      deviceName: 'Default output',
    })}\n`);
    const ready = await start;
    const sessionId = bridge.beginSession();
    stdoutRef.write('{"pos":128,"bufferedFrames":256,"underrunCallbacks":1,"underrunFrames":32,"dspClippingRisk":true,"dspLimiterProtecting":false}\n');
    stdoutRef.write('{"event":"error","reason":"device_invalidated","message":"device changed"}\n');
    stdoutRef.write('{"event":"error","reason":"host_failure","message":"miniaudio backend failed"}\n');
    stdoutRef.write('{"event":"ended"}\n');
    await settleMicrotasks();

    expect(sessionId).toBe(1);
    expect(ready.device).toMatchObject({
      ready: true,
      sampleRate: 48000,
      hardwareSampleRate: 48000,
      sharedDeviceSampleRate: 48000,
      sharedSampleRate: 48000,
      channels: 2,
      exclusive: false,
      eqControlPort: 0,
      deviceBufferFrames: 512,
      nativeActualBufferFrames: 512,
      actualBufferFrames: 512,
      requestedDeviceBufferFrames: 512,
      openedDeviceBufferFrames: 512,
      bufferSizeFallback: false,
      fifoCapacityFrames: 48000,
      startupPrebufferFrames: 0,
      startupPrebufferTimeoutMs: 0,
      dspActive: false,
      dspClippingRisk: false,
      dspLimiterProtecting: false,
      backend: 'miniaudio-shared',
      backendImpl: 'miniaudio-shared',
      deviceType: 'Windows Audio',
      deviceName: 'Default output',
    });
    expect(readyEvents).toHaveLength(1);
    expect(positionEvents).toEqual([
      {
        frames: 128,
        telemetry: expect.objectContaining({
          positionFrames: 128,
          bufferedFrames: 256,
          underrunCallbacks: 1,
          underrunFrames: 32,
          dspClippingRisk: true,
          dspLimiterProtecting: false,
        }),
      },
    ]);
    expect(errors[0]).toContain('echo-audio-host host_failure');
    expect(errors[0]).toContain('nativeMessage="miniaudio backend failed"');
    expect(endedCount).toBe(1);
  });

  it('freezes fd3 JSON-RPC notification names for sessionBegin and Automix side-band', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    const proc = procs[0];
    proc.emitReadyLine();
    await start;

    const sessionId = bridge.beginSession({ startSeconds: 3, playbackRate: 1.5, durationSeconds: 90 });
    bridge.prepareAutomixPlan({
      mode: 'smartCrossfade',
      currentStartSeconds: 0,
      currentEndSeconds: 0,
      currentFadeStartSeconds: 0,
      nextStartSeconds: 0,
      overlapSeconds: 2.5,
      curve: 'hsin',
      currentGainDb: -1,
      nextGainDb: -4,
      tempoRatio: 1.125,
      advanceAtSeconds: 0,
      skipIntroSilence: false,
      beatAligned: false,
      fallbackReason: null,
    }, { fadeStartSeconds: 12, sampleRate: 48000 });
    const writable = bridge.createAutomixNextWritable();
    await new Promise<void>((resolve, reject) => {
      writable.end(Buffer.from([9, 8, 7, 6]), (error?: Error | null) => error ? reject(error) : resolve());
    });

    const messages = Buffer.concat(proc.rpcIn.chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(messages.map((message) => ({ jsonrpc: message.jsonrpc, method: message.method, hasId: Object.hasOwn(message, 'id') }))).toEqual([
      { jsonrpc: '2.0', method: 'audio.sessionBegin', hasId: false },
      { jsonrpc: '2.0', method: 'audio.automixPrepare', hasId: false },
      { jsonrpc: '2.0', method: 'audio.automixNext', hasId: false },
      { jsonrpc: '2.0', method: 'audio.automixNextEnd', hasId: false },
    ]);
    expect(messages[0].params).toEqual([{ sessionId, sr: 48000, ch: 2 }]);
    expect(messages[1].params).toEqual({
      sessionId,
      fadeStartSeconds: 12,
      overlapSeconds: 2.5,
      currentGainDb: -1,
      nextGainDb: -4,
      tempoRatio: 1.125,
      mode: 'smartCrossfade',
      sampleRate: 48000,
    });
    expect(messages[2].params).toEqual({ sessionId, pcmBase64: Buffer.from([9, 8, 7, 6]).toString('base64') });
    expect(messages[3].params).toEqual({ sessionId });
  });

  it('reports Automix JSON-RPC write errors through the writable callback', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const proc = new FakeChildProcess();
    const failingRpcIn = new ThrowingWritable();
    Object.defineProperty(proc, 'stdio', {
      value: [proc.stdin, proc.stdout, proc.stderr, failingRpcIn, proc.rpcOut],
      configurable: true,
    });
    const spawn = vi.fn<HostSpawner>(() => proc as unknown as ChildProcessWithoutNullStreams);
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    proc.emitReadyLine();
    await start;

    bridge.beginSession();
    const writable = bridge.createAutomixNextWritable();
    writable.on('error', () => undefined);

    await expect(new Promise<void>((resolve, reject) => {
      writable.write(Buffer.from([1, 2, 3, 4]), (error) => error ? reject(error) : resolve());
    })).rejects.toThrow('fd3 write failed');
  });

  it('orders raw PCM writes after the session-begin side-band notification is flushed', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const proc = new FakeChildProcess();
    const delayedRpcIn = new DeferredWritable();
    Object.defineProperty(proc, 'stdio', {
      value: [proc.stdin, proc.stdout, proc.stderr, delayedRpcIn, proc.rpcOut],
      configurable: true,
    });
    const spawn = vi.fn<HostSpawner>(() => proc as unknown as ChildProcessWithoutNullStreams);
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const start = bridge.start(sharedOptions());
    proc.emitReadyLine();
    await start;

    const sessionId = bridge.beginSession();
    const writable = bridge.createSessionWritable(sessionId);
    let writeCompleted = false;
    writable.write(Buffer.from([9, 10, 11, 12]), (error) => {
      if (error) throw error;
      writeCompleted = true;
    });
    await settleMicrotasks();

    expect(delayedRpcIn.chunks.map((chunk) => JSON.parse(chunk.toString('utf8')).method)).toEqual(['audio.sessionBegin']);
    expect(proc.stdin.chunks).toEqual([]);
    expect(writeCompleted).toBe(false);

    delayedRpcIn.flush();
    await settleStreamCallbacks();

    expect(proc.stdin.chunks).toEqual([Buffer.from([9, 10, 11, 12])]);
    expect(writeCompleted).toBe(true);
  });

  it('startAudioDaemon reuses the module daemonBridge until stopAudioDaemon clears it', async () => {
    vi.useFakeTimers();
    const { startAudioDaemon, stopAudioDaemon, getActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const procs: FakeChildProcess[] = [];
    spawnMock.mockImplementation(() => {
      const proc = new FakeChildProcess();
      procs.push(proc);
      return proc;
    });

    const firstStart = startAudioDaemon();
    procs[0].emitDaemonReady();
    await firstStart;
    const active = getActiveJsonRpcBridge();

    await startAudioDaemon();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(getActiveJsonRpcBridge()).toBe(active);

    const stopped = stopAudioDaemon();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(procs[0].killSignals).toContain('SIGTERM');
    });
    procs[0].emitExit(0, null);
    await stopped;
    expect(getActiveJsonRpcBridge()).toBeNull();

    const secondStart = startAudioDaemon();
    procs[1].emitDaemonReady();
    await secondStart;
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('stopDaemon closes JSON-RPC, clears active bridge, sends SIGTERM, then SIGKILL on timeout', async () => {
    vi.useFakeTimers();
    const { NativePcmHostProcess, getActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });
    const start = bridge.startDaemon({ hostBinary: '/bin/echo-audio-host' });
    procs[0].emitDaemonReady();
    await start;

    const stop = bridge.stopDaemon();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(procs[0].killSignals).toContain('SIGTERM');
    });
    expect(getActiveJsonRpcBridge()).toBeNull();

    await vi.advanceTimersByTimeAsync(3000);
    await stop;
    expect(procs[0].killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(bridge.isDaemonRunning()).toBe(false);
  });
});

describe('NativeOutputBridge raw PCM process lifecycle and reuse', () => {
  it('writes raw Float32 PCM to stdin, ends stdin for session EOF, and exit flips readiness', async () => {
    const { NativePcmHostProcess, getActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });
    const start = bridge.start(sharedOptions());
    procs[0].emitReadyLine();
    await start;

    expect(getActiveJsonRpcBridge()).toBeNull();
    const sessionId = bridge.beginSession({ startSeconds: 12, playbackRate: 1.25, durationSeconds: 30 });
    respondToSessionBegin(procs[0]);
    await settleMicrotasks();
    const writable = bridge.createSessionWritable(sessionId);
    const pcm = Buffer.from(new Float32Array([0, 0.25, -0.5, 1]).buffer);
    writable.write(pcm);
    await new Promise<void>((resolve) => writable.end(resolve));

    expect(Buffer.concat(procs[0].stdin.chunks)).toEqual(pcm);
    expect(procs[0].stdin.endSpy).toHaveBeenCalledTimes(1);
    procs[0].emitExit(0, null);
    expect(bridge.isReady).toBe(false);
  });

  it('does not let stale raw session writables write into a later session', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });
    const start = bridge.start(sharedOptions());
    procs[0].emitReadyLine();
    await start;

    const firstSessionId = bridge.beginSession();
    const secondSessionId = bridge.beginSession();
    respondToSessionBegin(procs[0]);
    await settleMicrotasks();
    const currentWritable = bridge.createSessionWritable(secondSessionId);

    await new Promise<void>((resolve, reject) => {
      bridge.writeSessionChunk(firstSessionId, Buffer.from([1, 2, 3, 4]), (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      currentWritable.write(Buffer.from([5, 6, 7, 8]), (error) => error ? reject(error) : resolve());
    });

    expect(Buffer.concat(procs[0].stdin.chunks)).toEqual(Buffer.from([5, 6, 7, 8]));
  });

  it('does not let raw PCM output bridges replace or clear the active daemon JSON-RPC bridge', async () => {
    const { NativePcmHostProcess, getActiveJsonRpcBridge } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const daemon = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });
    const output = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, logger: () => undefined });

    const daemonStart = daemon.startDaemon({ hostBinary: '/bin/echo-audio-host' });
    procs[0].emitDaemonReady();
    await daemonStart;
    const daemonActiveBridge = getActiveJsonRpcBridge();
    expect(daemonActiveBridge).not.toBeNull();

    const outputStart = output.start(sharedOptions());
    procs[1].emitReadyLine();
    await outputStart;
    expect(getActiveJsonRpcBridge()).toBe(daemonActiveBridge);

    output.stop();
    expect(getActiveJsonRpcBridge()).toBe(daemonActiveBridge);
  });

  it('canReuseFor locks current inputs: ready process, writable stdin, matching reuse key, no graceful stop', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, platform: 'linux', logger: () => undefined });
    const original = sharedOptions({ deviceIndex: 2, deviceName: 'DAC', bufferSizeFrames: 1024, latencyProfile: 'lowLatency' });

    expect(bridge.canReuseFor(original)).toBe(false);
    const start = bridge.start(original);
    procs[0].emitReadyLine();
    await start;

    expect(bridge.canReuseFor({ ...original })).toBe(true);
    expect(bridge.canReuseFor({ ...original, deviceIndex: 999 })).toBe(false);
    expect(bridge.canReuseFor({ ...original, deviceIndex: 3 })).toBe(false);
    procs[0].stdin.destroy();
    expect(bridge.canReuseFor({ ...original })).toBe(false);
  });

  it('does not reuse a raw stdin host after session PCM has been accepted', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const { spawn, procs } = createSpawn();
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, platform: 'linux', logger: () => undefined });
    const original = sharedOptions({ deviceIndex: 2, deviceName: 'DAC', bufferSizeFrames: 1024, latencyProfile: 'lowLatency' });

    const start = bridge.start(original);
    procs[0].emitReadyLine();
    await start;
    expect(bridge.canReuseFor({ ...original })).toBe(true);

    const sessionId = bridge.beginSession();
    respondToSessionBegin(procs[0]);
    await settleMicrotasks();
    const writable = bridge.createSessionWritable(sessionId);
    await new Promise<void>((resolve, reject) => {
      writable.write(Buffer.from([1, 2, 3, 4]), (error) => error ? reject(error) : resolve());
    });

    expect(bridge.canReuseFor({ ...original })).toBe(false);
  });

  it('does not reuse a raw stdin host while PCM is queued behind session-begin flush', async () => {
    const { NativePcmHostProcess } = await importFreshNativePcmHostProcess();
    const proc = new FakeChildProcess();
    const delayedRpcIn = new DeferredWritable();
    Object.defineProperty(proc, 'stdio', {
      value: [proc.stdin, proc.stdout, proc.stderr, delayedRpcIn, proc.rpcOut],
      configurable: true,
    });
    const spawn = vi.fn<HostSpawner>(() => proc as unknown as ChildProcessWithoutNullStreams);
    const bridge = new NativePcmHostProcess({ hostBinary: '/bin/echo-audio-host', spawn, platform: 'linux', logger: () => undefined });
    const original = sharedOptions({ deviceIndex: 2, deviceName: 'DAC', bufferSizeFrames: 1024, latencyProfile: 'lowLatency' });

    const start = bridge.start(original);
    proc.emitReadyLine();
    await start;
    expect(bridge.canReuseFor({ ...original })).toBe(true);

    const sessionId = bridge.beginSession();
    const writable = bridge.createSessionWritable(sessionId);
    writable.write(Buffer.from([1, 2, 3, 4]));
    await settleMicrotasks();

    expect(proc.stdin.chunks).toEqual([]);
    expect(bridge.canReuseFor({ ...original })).toBe(false);

    delayedRpcIn.flush();
    await settleStreamCallbacks();

    expect(proc.stdin.chunks).toEqual([Buffer.from([1, 2, 3, 4])]);
  });
});

describe('DaemonAudioBackend bridge binding and stale bridge detection', () => {
  it('binds to exactly one JsonRpcBridge and exposes closed-bridge staleness while updating backend state', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { JsonRpcBridge } = await import('./JsonRpcBridge');
    const { DaemonAudioBackend } = await import('./DaemonAudioBackend');
    const one = new JsonRpcBridge({ heartbeatInterval: 60_000 });
    const two = new JsonRpcBridge({ heartbeatInterval: 60_000 });
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    vi.spyOn(one, 'on').mockImplementation((event: string | symbol, listener: (...args: unknown[]) => void) => {
      if (typeof event === 'string') listeners.set(event, listener as (params: Record<string, unknown>) => void);
      return one;
    });
    vi.spyOn(one, 'off').mockReturnValue(one);
    vi.spyOn(one, 'openFile').mockResolvedValue({
      status: 'decoding', filePath: '/music/a.flac', sampleRate: 96000, channels: 2,
      durationSeconds: 120, startSeconds: 5, codec: 'flac', container: 'flac', operationId: 7,
    });
    vi.spyOn(one, 'play').mockResolvedValue(undefined);

    const backend = new DaemonAudioBackend(one);
    expect(backend.isBoundToBridge(one)).toBe(true);
    expect(backend.isBoundToBridge(two)).toBe(false);
    expect(backend.isBridgeClosed).toBe(false);

    const probe = await backend.openFile('/music/a.flac', 5);
    expect(probe.startSeconds).toBe(5);
    expect(backend.getPositionSeconds()).toBe(5);
    listeners.get('audio.position')?.({ framesPlayed: 48000, operationId: 7 });
    expect(backend.getPositionSeconds()).toBe(5.5);
    await one.close();
    expect(backend.isBridgeClosed).toBe(true);

    backend.dispose();
    expect(one.off).toHaveBeenCalledWith('audio.position', expect.any(Function));
    expect(one.off).toHaveBeenCalledWith('audio.ended', expect.any(Function));
  });
});

describe('BackendLifecycle decision helpers from bridge state', () => {
  it('receives current bridge identity/closed state and returns the documented freshness decisions', async () => {
    const { isBridgeUsable, isDaemonBackendFresh } = await importFreshBackendLifecycle();
    const { JsonRpcBridge } = await import('./JsonRpcBridge');
    const { DaemonAudioBackend } = await import('./DaemonAudioBackend');
    const current = new JsonRpcBridge({ heartbeatInterval: 60_000 });
    const replacement = new JsonRpcBridge({ heartbeatInterval: 60_000 });
    const backend = new DaemonAudioBackend(current);

    expect(isBridgeUsable(null)).toBe(false);
    expect(isBridgeUsable(current)).toBe(true);
    expect(isDaemonBackendFresh(current, backend)).toEqual({
      reason: 'daemon_freshness.bridge_matching_current',
      reusable: true,
      shouldDisposeCachedDaemon: false,
    });
    expect(isDaemonBackendFresh(replacement, backend)).toEqual({
      reason: 'daemon_freshness.bridge_identity_changed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    });

    await current.close();
    expect(isBridgeUsable(current)).toBe(false);
    expect(isDaemonBackendFresh(current, backend)).toEqual({
      reason: 'daemon_freshness.bridge_closed',
      reusable: false,
      shouldDisposeCachedDaemon: true,
    });
  });
});
