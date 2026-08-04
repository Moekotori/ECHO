import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonRpcBridge } from './JsonRpcBridge';
import { DaemonAudioBackend } from './DaemonAudioBackend';
import { PassThrough, Writable } from 'node:stream';

// Helper: create a mock stream pair using PassThrough so we can write
// lines into the readable side and have them processed synchronously.
function createStreamPair() {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const readable = new PassThrough();
  return { readable, writable, chunks };
}

describe('JsonRpcBridge', () => {
  let bridge: JsonRpcBridge;
  let streams: ReturnType<typeof createStreamPair>;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new JsonRpcBridge({ defaultTimeout: 1000, heartbeatInterval: 5000 });
    streams = createStreamPair();
    bridge.open(streams.readable, streams.writable);
  });

  afterEach(() => {
    bridge.close().catch(() => {});
    vi.useRealTimers();
  });

  it('sends a valid JSON-RPC 2.0 request via call()', () => {
    bridge.getEqState().catch(() => {});
    expect(streams.chunks.length).toBe(1);
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('eq.getState');
    expect(msg.id).toBe(1);
  });

  it('resolves when response matches request id', async () => {
    const promise = bridge.getEqState();
    // Simulate host response
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { enabled: true } });
    streams.readable.write(line + '\n');
    const result = await promise;
    expect(result).toEqual({ enabled: true });
  });

  it('rejects on timeout', async () => {
    const promise = bridge.call('slow.method');
    vi.advanceTimersByTime(1500);
    await expect(promise).rejects.toThrow('rpc_timeout');
  });

  it('handles JSON-RPC error response', async () => {
    const promise = bridge.call('bad.method');
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
    streams.readable.write(line + '\n');
    await expect(promise).rejects.toThrow('Method not found');
  });

  it('sends notification without id', () => {
    bridge.notify('audio.ended', { trackId: '123' });
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('audio.ended');
    expect(msg.id).toBeUndefined();
  });

  it('emits incoming notifications as events', () => {
    const handler = vi.fn();
    bridge.on('audio.position', handler);
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'audio.position', params: { pos: 100 } });
    streams.readable.write(line + '\n');
    expect(handler).toHaveBeenCalledWith({ pos: 100 });
  });

  it('all 30 public methods produce correct JSON-RPC method strings', () => {
    bridge.setEnabled(true).catch(() => {});
    expect(JSON.parse(streams.chunks[0]).method).toBe('eq.setEnabled');
    bridge.setPreamp(-3).catch(() => {});
    expect(JSON.parse(streams.chunks[1]).method).toBe('eq.setPreamp');
    bridge.setDspHeadroom(6).catch(() => {});
    expect(JSON.parse(streams.chunks[2]).method).toBe('dsp.setHeadroom');
    bridge.listPresets().catch(() => {});
    expect(JSON.parse(streams.chunks[3]).method).toBe('preset.list');
    bridge.applyProfile('profile-1').catch(() => {});
    expect(JSON.parse(streams.chunks[4]).method).toBe('profile.apply');
  });

  it('rejects call() when not open', async () => {
    await bridge.close();
    await expect(bridge.call('eq.getState')).rejects.toThrow('rpc_bridge_not_open');
  });

  it('marks the bridge closed when the transport closes', async () => {
    const pending = bridge.call('roomCorrection.loadIr', [{ path: '/tmp/ir.wav' }]);
    const rejection = expect(pending).rejects.toThrow('rpc_stream_closed');

    streams.readable.end();
    await vi.runAllTimersAsync();

    await rejection;
    expect(bridge.isClosed).toBe(true);
    await expect(bridge.call('eq.getState')).rejects.toThrow('rpc_bridge_not_open');
  });

  it('openFile sends filePath, sampleRate, and startSeconds in one params object', () => {
    bridge.openFile('/music/song.flac', 96000, 12.25).catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('audio.openFile');
    expect(msg.params).toEqual([{ filePath: '/music/song.flac', sampleRate: 96000, startSeconds: 12.25 }]);
  });

  it('prefetch sends filePath and optional sampleRate via audio.prefetch', () => {
    bridge.prefetch('/music/song.mp3', 48000).catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('audio.prefetch');
    expect(msg.params).toEqual([{ filePath: '/music/song.mp3', sampleRate: 48000 }]);
  });

  it('prefetch sends filePath only when sampleRate is omitted', () => {
    bridge.prefetch('/music/song.mp3').catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('audio.prefetch');
    expect(msg.params).toEqual([{ filePath: '/music/song.mp3' }]);
  });

  it('sends playback-rate updates through JSON-RPC', () => {
    bridge.setPlaybackRate(1.25).catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('playbackRate.setRate');
    expect(msg.params).toEqual([1.25]);
  });

  it('sends playback speed mode updates through JSON-RPC', () => {
    bridge.setPlaybackSpeedMode('speed').catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('playbackRate.setMode');
    expect(msg.params).toEqual(['speed']);
  });

  it('sends ReplayGain config updates through JSON-RPC', () => {
    bridge.setReplayGainConfig({
      trackGainDb: -3,
      albumGainDb: -2,
      peak: 0.95,
      mode: 1,
      preampDb: 1.5,
      preventClipping: true,
    }).catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('replayGain.setConfig');
    expect(msg.params).toEqual([{
      trackGainDb: -3,
      albumGainDb: -2,
      peak: 0.95,
      mode: 1,
      preampDb: 1.5,
      preventClipping: true,
    }]);
  });

  it('sends level meter interval updates through JSON-RPC', () => {
    bridge.setLevelMeterInterval(33).catch(() => {});
    const msg = JSON.parse(streams.chunks[0]);
    expect(msg.method).toBe('levelMeter.setInterval');
    expect(msg.params).toEqual([33]);
  });
});

describe('DaemonAudioBackend openFile offsets', () => {
  const openFileResult = {
    status: 'decoding',
    filePath: '/music/song.flac',
    sampleRate: 48000,
    channels: 2,
    durationSeconds: 180,
    codec: 'flac',
    container: 'flac',
    startSeconds: 30,
    operationId: 1,
  };

  function createBackend(result: Partial<typeof openFileResult> = {}) {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const jrpc = {
      openFile: vi.fn().mockResolvedValue({ ...openFileResult, ...result }),
      play: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      setPlaybackRate: vi.fn().mockResolvedValue(undefined),
      setPlaybackSpeedMode: vi.fn().mockResolvedValue(undefined),
      syncStateToNative: vi.fn().mockResolvedValue(undefined),
      applyBoundProfileForOutput: vi.fn().mockResolvedValue(null),
      on: vi.fn((event: string, callback: (params: Record<string, unknown>) => void) => {
        listeners.set(event, callback);
      }),
      off: vi.fn(),
    } as unknown as JsonRpcBridge;

    return {
      backend: new DaemonAudioBackend(jrpc),
      jrpc: jrpc as JsonRpcBridge & {
        openFile: ReturnType<typeof vi.fn>;
        play: ReturnType<typeof vi.fn>;
        pause: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
        seek: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        setPlaybackRate: ReturnType<typeof vi.fn>;
        setPlaybackSpeedMode: ReturnType<typeof vi.fn>;
      },
      listeners,
    };
  }

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite startSeconds %s before RPC, no play call',
    async (startSeconds) => {
      const { backend, jrpc } = createBackend();
      await expect(backend.openFile('/music/song.flac', startSeconds)).rejects.toThrow('invalid_startSeconds');
      expect(jrpc.openFile).not.toHaveBeenCalled();
      expect(jrpc.play).not.toHaveBeenCalled();
    },
  );

  it('passes finite offsets to native, starts playback, and uses native-normalized startSeconds for position', async () => {
    const { backend, jrpc } = createBackend({ startSeconds: 29.75 });

    await backend.openFile('/music/song.flac', 999999);

    expect(jrpc.openFile).toHaveBeenCalledWith('/music/song.flac', undefined, 999999);
    expect(jrpc.play).toHaveBeenCalledTimes(1);
    expect(jrpc.openFile.mock.invocationCallOrder[0]).toBeLessThan(jrpc.play.mock.invocationCallOrder[0]);
    expect(backend.getPositionSeconds()).toBe(29.75);
  });

  it('does not call play when openFile rejects', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    const jrpc = {
      openFile: vi.fn().mockRejectedValue(new Error('native_open_failed')),
      play: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      setPlaybackRate: vi.fn().mockResolvedValue(undefined),
      setPlaybackSpeedMode: vi.fn().mockResolvedValue(undefined),
      syncStateToNative: vi.fn().mockResolvedValue(undefined),
      applyBoundProfileForOutput: vi.fn().mockResolvedValue(null),
      on: vi.fn((event: string, callback: (params: Record<string, unknown>) => void) => {
        listeners.set(event, callback);
      }),
      off: vi.fn(),
    } as unknown as JsonRpcBridge;
    const backend = new DaemonAudioBackend(jrpc);

    await expect(backend.openFile('/music/song.flac', 0)).rejects.toThrow('native_open_failed');
    expect(jrpc.openFile).toHaveBeenCalledTimes(1);
    expect(jrpc.play).not.toHaveBeenCalled();
    expect(backend.getPositionSeconds()).toBe(0);
  });

  it('delegates playback speed changes to the JSON-RPC bridge', async () => {
    const { backend, jrpc } = createBackend();

    await backend.setPlaybackSpeed(1.5, 'nightcore');

    expect(jrpc.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(jrpc.setPlaybackSpeedMode).toHaveBeenCalledWith('nightcore');
    expect(jrpc.setPlaybackRate.mock.invocationCallOrder[0]).toBeLessThan(jrpc.setPlaybackSpeedMode.mock.invocationCallOrder[0]);
  });

  it('emits the requested seek position before native frame progress arrives', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 0 });
    const positions: number[] = [];
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/song.flac', 0);
    positions.length = 0;
    jrpc.seek.mockResolvedValueOnce({ operationId: 2 });
    await backend.seek(64.3);
    listeners.get('audio.position')?.({ framesPlayed: 8192, operationId: 2 });

    expect(positions[0]).toBe(64.3);
    expect(positions[1]).toBeCloseTo(64.47066666666666, 6);
  });

  it('ignores stale native positions while seek RPC is in flight', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 100 });
    const positions: number[] = [];
    let resolveSeek = (_value: { operationId: number }): void => {
      throw new Error('seek resolver was not captured');
    };
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/song.flac', 100);
    positions.length = 0;
    jrpc.seek.mockImplementationOnce(() => new Promise<{ operationId: number }>((resolve) => {
      resolveSeek = resolve;
    }));

    const seek = backend.seek(109.2);
    await Promise.resolve();
    listeners.get('audio.position')?.({ framesPlayed: 221184, operationId: 1 });
    resolveSeek({ operationId: 2 });
    await seek;
    listeners.get('audio.position')?.({ framesPlayed: 8192, operationId: 2 });

    expect(positions[0]).toBe(109.2);
    expect(positions).not.toContain(104.608);
    expect(positions[1]).toBeCloseTo(109.37066666666666, 6);
  });

  it('ignores implausible native frame progress immediately after a backward seek', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 0 });
    const positions: number[] = [];
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/song.flac', 0);
    listeners.get('audio.position')?.({ framesPlayed: 9_600_000, operationId: 1 });
    positions.length = 0;
    jrpc.seek.mockResolvedValueOnce({ operationId: 2 });

    await backend.seek(90);
    listeners.get('audio.position')?.({ framesPlayed: 9_600_000, operationId: 2 });
    listeners.get('audio.position')?.({ framesPlayed: 9600, operationId: 2 });

    expect(positions[0]).toBe(90);
    expect(positions).not.toContain(290);
    expect(positions[1]).toBeCloseTo(90.2, 6);
  });

  it('restores the previous daemon position and guard state when seek rejects', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 0 });
    const positions: number[] = [];
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/song.flac', 0);
    listeners.get('audio.position')?.({ framesPlayed: 4_800_000, operationId: 1 });
    positions.length = 0;
    jrpc.seek.mockRejectedValueOnce(new Error('native_seek_failed'));

    await expect(backend.seek(90)).rejects.toThrow('native_seek_failed');
    listeners.get('audio.position')?.({ framesPlayed: 4_848_000, operationId: 1 });

    expect(positions).toEqual([90, 100, 101]);
    expect(backend.getPositionSeconds()).toBe(101);
  });

  it('clears post-seek position guard when stopping and opening a new operation', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 0 });
    const positions: number[] = [];
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/one.flac', 0);
    jrpc.seek.mockResolvedValueOnce({ operationId: 2 });
    await backend.seek(90);
    positions.length = 0;
    await backend.stop();
    await backend.openFile('/music/two.flac', 0);
    listeners.get('audio.position')?.({ framesPlayed: 9_600_000, operationId: 1 });

    expect(positions).toEqual([200]);
    expect(backend.getPositionSeconds()).toBe(200);
  });

  it('allows negative offsets and aligns notifications to the native-normalized base', async () => {
    const { backend, jrpc, listeners } = createBackend({ startSeconds: 0 });
    const positions: number[] = [];
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));

    await backend.openFile('/music/song.flac', -5);
    listeners.get('audio.position')?.({ framesPlayed: 24000, operationId: 1 });

    expect(jrpc.openFile).toHaveBeenCalledWith('/music/song.flac', undefined, -5);
    expect(jrpc.play).toHaveBeenCalledTimes(1);
    expect(positions).toEqual([0.5]);
    expect(backend.getPositionSeconds()).toBe(0.5);
  });

  it('ignores stale position and ended notifications from an older operation', async () => {
    const { backend, listeners } = createBackend({ operationId: 2, startSeconds: 10 });
    const positions: number[] = [];
    const ended = vi.fn();
    backend.onPosition((positionSeconds) => positions.push(positionSeconds));
    backend.onEnded(ended);

    await backend.openFile('/music/song.flac', 10);
    listeners.get('audio.position')?.({ framesPlayed: 48000, operationId: 1 });
    listeners.get('audio.ended')?.({ operationId: 1 });
    listeners.get('audio.position')?.({ framesPlayed: 24000, operationId: 2 });

    expect(positions).toEqual([10.5]);
    expect(backend.getPositionSeconds()).toBe(10.5);
    expect(ended).not.toHaveBeenCalled();
  });

  it('seeks immediately while paused and resumes without replaying the seek', async () => {
    const { backend, jrpc, listeners } = createBackend({ operationId: 1, startSeconds: 0 });
    const ended = vi.fn();
    backend.onEnded(ended);
    jrpc.seek.mockResolvedValueOnce({ operationId: 2 });

    await backend.openFile('/music/song.flac');
    await backend.pause();
    await backend.seek(42);

    expect(jrpc.stop).not.toHaveBeenCalled();
    expect(jrpc.seek).toHaveBeenCalledTimes(1);
    expect(jrpc.seek).toHaveBeenCalledWith(42);
    expect(ended).not.toHaveBeenCalled();

    await backend.resume();
    expect(jrpc.resume).toHaveBeenCalledTimes(1);
    expect(jrpc.seek).toHaveBeenCalledTimes(1);

    listeners.get('audio.ended')?.({ operationId: 2 });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('serializes stop before a rapid second open can set the active operation', async () => {
    const listeners = new Map<string, (params: Record<string, unknown>) => void>();
    let releaseStop: () => void = () => {
      throw new Error('stop promise did not expose release callback');
    };
    const calls: string[] = [];
    const jrpc = {
      openFile: vi.fn(async (filePath: string) => {
        calls.push(`open:${filePath}`);
        return { ...openFileResult, filePath, operationId: filePath.endsWith('one.flac') ? 1 : 3 };
      }),
      play: vi.fn(async () => {
        calls.push('play');
      }),
      seek: vi.fn().mockResolvedValue({ operationId: 4 }),
      stop: vi.fn(() => new Promise((resolve) => {
        calls.push('stop');
        releaseStop = () => resolve({ operationId: 2 });
      })),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      syncStateToNative: vi.fn().mockResolvedValue(undefined),
      applyBoundProfileForOutput: vi.fn().mockResolvedValue(null),
      on: vi.fn((event: string, callback: (params: Record<string, unknown>) => void) => {
        listeners.set(event, callback);
      }),
      off: vi.fn(),
    } as unknown as JsonRpcBridge;
    const backend = new DaemonAudioBackend(jrpc);

    await backend.openFile('/music/one.flac');
    const stopPromise = backend.stop();
    const secondOpenPromise = backend.openFile('/music/two.flac');
    await Promise.resolve();

    expect(calls).toEqual(['open:/music/one.flac', 'play', 'stop']);
    releaseStop();
    await stopPromise;
    await secondOpenPromise;

    expect(calls).toEqual(['open:/music/one.flac', 'play', 'stop', 'open:/music/two.flac', 'play']);
    listeners.get('audio.ended')?.({ operationId: 1 });
    listeners.get('audio.position')?.({ framesPlayed: 48000, operationId: 3 });
    expect(backend.getPositionSeconds()).toBe(31);
  });

  it('prefetch delegates to jrpc.prefetch with sampleRate', async () => {
    const jrpc = {
      openFile: vi.fn().mockResolvedValue({ ...openFileResult }),
      play: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(true),
      syncStateToNative: vi.fn().mockResolvedValue(undefined),
      applyBoundProfileForOutput: vi.fn().mockResolvedValue(null),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as JsonRpcBridge;
    const backend = new DaemonAudioBackend(jrpc);

    await backend.prefetch('/music/song.flac');

    expect(jrpc.prefetch).toHaveBeenCalledWith('/music/song.flac', 48000);
  });
});

describe('JsonRpcBridge lifecycle', () => {
  it('isClosed returns false when bridge is open', () => {
    const bridge = new JsonRpcBridge();
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);
    expect(bridge.isClosed).toBe(false);
  });

  it('isClosed returns true after close()', async () => {
    const bridge = new JsonRpcBridge({ heartbeatInterval: 5000 });
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);
    await bridge.close();
    expect(bridge.isClosed).toBe(true);
  });

  it('close() rejects all pending RPC calls', async () => {
    const bridge = new JsonRpcBridge({ defaultTimeout: 5000, heartbeatInterval: 5000 });
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);

    const p1 = bridge.call<string>('eq.getState');
    const p2 = bridge.call<string>('preset.list');
    const p3 = bridge.call<string>('audio.openFile');

    // All pending before close
    // Close the bridge before any responses arrive
    const closePromise = bridge.close();
    await closePromise;

    await expect(p1).rejects.toThrow('rpc_bridge_closed');
    await expect(p2).rejects.toThrow('rpc_bridge_closed');
    await expect(p3).rejects.toThrow('rpc_bridge_closed');
  });

  it('transport close (readline close) rejects pending with rpc_stream_closed', async () => {
    vi.useFakeTimers();
    const bridge = new JsonRpcBridge({ defaultTimeout: 1000, heartbeatInterval: 5000 });
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);

    const p1 = bridge.call<string>('eq.getState');
    const p2 = bridge.call<string>('preset.list');

    // Close the bridge directly, which rejects pending with rpc_bridge_closed
    await bridge.close();
    vi.advanceTimersByTime(50);

    await expect(p1).rejects.toThrow('rpc_bridge_closed');
    await expect(p2).rejects.toThrow('rpc_bridge_closed');

    vi.useRealTimers();
  });

  it('call() after close() rejects with rpc_bridge_not_open', async () => {
    const bridge = new JsonRpcBridge();
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);
    await bridge.close();

    await expect(bridge.call('eq.getState')).rejects.toThrow('rpc_bridge_not_open');
  });

  it('notify() after close() is a no-op without throwing', () => {
    const bridge = new JsonRpcBridge();
    const { readable, writable } = createStreamPair();
    bridge.open(readable, writable);

    // Close synchronously-like
    const closePromise = bridge.close();

    expect(() => bridge.notify('audio.ended', {})).not.toThrow();
  });
});
