import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JuceDecodePipeline, type JuceDecodeSpawner } from './JuceDecodePipeline';
import type { PcmDecodeRequest } from './audioTypes';

const decodeServerMagic = 'ECDS';
const decodeServerVersion = 1;
const frameTypeStart = 1;
const frameTypeShutdown = 3;
const frameTypeReady = 101;
const frameTypePcmF32Le = 102;
const frameTypeEnd = 103;

const createFrameHeader = (type: number, sessionId: number, payloadBytes: number): Buffer => {
  const header = Buffer.alloc(16);
  header.write(decodeServerMagic, 0, 'ascii');
  header.writeUInt8(decodeServerVersion, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32LE(sessionId >>> 0, 8);
  header.writeUInt32LE(Math.max(0, payloadBytes) >>> 0, 12);
  return header;
};

const createFrame = (type: number, sessionId: number, payload = Buffer.alloc(0)): Buffer =>
  payload.length > 0
    ? Buffer.concat([createFrameHeader(type, sessionId, payload.length), payload])
    : createFrameHeader(type, sessionId, 0);

const createReadyFrame = (sessionId: number, sampleRate = 48000, channels = 2): Buffer =>
  createFrame(frameTypeReady, sessionId, Buffer.from(JSON.stringify({ backend: 'juce-flac', sampleRate, channels }), 'utf8'));

type ClientFrame = {
  type: number;
  sessionId: number;
  payload: Buffer;
};

class FakeDecodeServerProcess extends EventEmitter {
  readonly stdinWrites: Buffer[] = [];
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinWrites.push(Buffer.from(chunk));
      callback();
    },
  });
  killed = false;
  readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true;
    this.emit('close', null, typeof signal === 'string' ? signal : null);
    return true;
  });
}

const createFakeSpawner = (): { children: FakeDecodeServerProcess[]; spawn: JuceDecodeSpawner } => {
  const children: FakeDecodeServerProcess[] = [];
  const spawn: JuceDecodeSpawner = vi.fn((_file, args, options) => {
    expect(args).toEqual(['-decode-server']);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    const child = new FakeDecodeServerProcess();
    children.push(child);
    return child as unknown as ReturnType<JuceDecodeSpawner>;
  });

  return { children, spawn };
};

const decodeRequest = (filePath: string, startSeconds = 0): PcmDecodeRequest => ({
  filePath,
  startSeconds,
  channels: 2,
  decoderOutputSampleRate: 48000,
});

const parseClientFrames = (child: FakeDecodeServerProcess): ClientFrame[] => {
  const buffer = Buffer.concat(child.stdinWrites);
  const frames: ClientFrame[] = [];
  let offset = 0;

  while (offset + 16 <= buffer.length) {
    expect(buffer.toString('ascii', offset, offset + 4)).toBe(decodeServerMagic);
    expect(buffer.readUInt8(offset + 4)).toBe(decodeServerVersion);
    const type = buffer.readUInt8(offset + 5);
    const sessionId = buffer.readUInt32LE(offset + 8);
    const payloadBytes = buffer.readUInt32LE(offset + 12);
    const payloadStart = offset + 16;
    const payloadEnd = payloadStart + payloadBytes;
    frames.push({ type, sessionId, payload: buffer.subarray(payloadStart, payloadEnd) });
    offset = payloadEnd;
  }

  return frames;
};

describe('JuceDecodePipeline resident decode server', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses one decode server and resolves ready only after the first PCM frame', async () => {
    const { children, spawn } = createFakeSpawner();
    const pipeline = new JuceDecodePipeline({ hostBinary: 'echo-audio-host.exe', spawn, logger: () => undefined });

    const firstRun = pipeline.decodeLocalFile(decodeRequest('first.flac'));
    let readyResolved = false;
    firstRun.ready?.then(() => {
      readyResolved = true;
    });

    expect(children).toHaveLength(1);
    children[0].stdout.write(createReadyFrame(1));
    await Promise.resolve();
    expect(readyResolved).toBe(false);

    const firstPcm = Buffer.alloc(2 * Float32Array.BYTES_PER_ELEMENT);
    const firstData = once(firstRun.stream, 'data');
    children[0].stdout.write(createFrame(frameTypePcmF32Le, 1, firstPcm));
    await firstRun.ready;
    const [firstChunk] = await firstData;
    expect(Buffer.isBuffer(firstChunk)).toBe(true);
    expect(firstChunk).toEqual(firstPcm);
    children[0].stdout.write(createFrame(frameTypeEnd, 1));
    await firstRun.done;

    const secondRun = pipeline.decodeLocalFile(decodeRequest('second.flac', 8));
    expect(children).toHaveLength(1);
    children[0].stdout.write(createReadyFrame(2));
    children[0].stdout.write(createFrame(frameTypePcmF32Le, 2, firstPcm));
    children[0].stdout.write(createFrame(frameTypeEnd, 2));
    await secondRun.ready;
    await secondRun.done;

    const startFrames = parseClientFrames(children[0]).filter((frame) => frame.type === frameTypeStart);
    expect(startFrames).toHaveLength(2);
    expect(JSON.parse(startFrames[0].payload.toString('utf8'))).toMatchObject({ filePath: 'first.flac', startSeconds: 0 });
    expect(JSON.parse(startFrames[1].payload.toString('utf8'))).toMatchObject({ filePath: 'second.flac', startSeconds: 8 });
    pipeline.dispose();
  });

  it('falls back quickly and rebuilds the server when first PCM is too slow', async () => {
    vi.useFakeTimers();
    const { children, spawn } = createFakeSpawner();
    const pipeline = new JuceDecodePipeline({
      hostBinary: 'echo-audio-host.exe',
      spawn,
      logger: () => undefined,
      firstPcmTimeoutMs: 250,
    });

    const run = pipeline.decodeLocalFile(decodeRequest('slow.mp3'));
    const readyResult = run.ready?.then(
      () => null,
      (error: unknown) => error,
    );

    expect(children).toHaveLength(1);
    children[0].stdout.write(createReadyFrame(1));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);

    const error = await readyResult;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('timeout_waiting_for_first_pcm');
    await expect(run.done).resolves.toBeUndefined();
    expect(parseClientFrames(children[0]).some((frame) => frame.type === frameTypeShutdown)).toBe(true);

    const nextRun = pipeline.decodeLocalFile(decodeRequest('next.flac'));
    expect(children).toHaveLength(2);
    children[1].stdout.write(createReadyFrame(1));
    children[1].stdout.write(createFrame(frameTypePcmF32Le, 1, Buffer.alloc(8)));
    children[1].stdout.write(createFrame(frameTypeEnd, 1));
    await nextRun.ready;
    await nextRun.done;
    pipeline.dispose();
    await vi.advanceTimersByTimeAsync(250);
  });

  it('rejects the fast path and rebuilds the server when a run ends before PCM', async () => {
    const { children, spawn } = createFakeSpawner();
    const pipeline = new JuceDecodePipeline({ hostBinary: 'echo-audio-host.exe', spawn, logger: () => undefined });

    const run = pipeline.decodeLocalFile(decodeRequest('empty.flac'));
    const readyResult = run.ready?.then(
      () => null,
      (error: unknown) => error,
    );

    children[0].stdout.write(createReadyFrame(1));
    children[0].stdout.write(createFrame(frameTypeEnd, 1));

    const error = await readyResult;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('no_pcm_before_end');
    await expect(run.done).resolves.toBeUndefined();
    expect(parseClientFrames(children[0]).some((frame) => frame.type === frameTypeShutdown)).toBe(true);

    const nextRun = pipeline.decodeLocalFile(decodeRequest('next.flac'));
    expect(children).toHaveLength(2);
    children[1].stdout.write(createReadyFrame(1));
    children[1].stdout.write(createFrame(frameTypePcmF32Le, 1, Buffer.alloc(8)));
    children[1].stdout.write(createFrame(frameTypeEnd, 1));
    await nextRun.ready;
    await nextRun.done;
    pipeline.dispose();
  });
});
