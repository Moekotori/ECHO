import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFile } from 'music-metadata';
import { DecoderPipeline, type DecoderPipelineDependencies } from './DecoderPipeline';

vi.mock('music-metadata', () => ({
  parseFile: vi.fn(),
}));

const parseFileMock = vi.mocked(parseFile);

const uint32Be = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const box = (type: string, payload: Buffer): Buffer =>
  Buffer.concat([uint32Be(8 + payload.length), Buffer.from(type, 'ascii'), payload]);

const audioSampleEntry = (codecTag: string): Buffer =>
  Buffer.concat([uint32Be(8), Buffer.from(codecTag, 'ascii')]);

const mp4WithAudioCodec = (codecTag: string): Buffer => {
  const stsd = box('stsd', Buffer.concat([Buffer.alloc(4), uint32Be(1), audioSampleEntry(codecTag)]));
  return box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));
};

const createDecoder = (): DecoderPipeline => {
  const spawn: NonNullable<DecoderPipelineDependencies['spawn']> = () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });

    queueMicrotask(() => child.emit('exit', 0, null));
    return child as unknown as ReturnType<NonNullable<DecoderPipelineDependencies['spawn']>>;
  };

  return new DecoderPipeline({
    ffmpegPath: 'test-ffmpeg',
    spawn,
    logger: () => undefined,
  });
};

describe('DecoderPipeline probe cache', () => {
  afterEach(() => {
    parseFileMock.mockReset();
  });

  it('reuses local probe metadata while the file fingerprint is unchanged', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-probe-cache-'));
    const filePath = join(tempDir, 'song.flac');
    await writeFile(filePath, Buffer.from('not real audio but stattable'));
    parseFileMock.mockResolvedValue({
      format: {
        duration: 120,
        sampleRate: 48000,
        numberOfChannels: 2,
        codec: 'FLAC',
        bitsPerSample: 24,
        bitrate: 1400000,
      },
    } as never);

    try {
      const decoder = createDecoder();
      const first = await decoder.probeLocalFile(filePath);
      first.channels = 8;
      const second = await decoder.probeLocalFile(filePath);

      expect(parseFileMock).toHaveBeenCalledTimes(1);
      expect(second).toMatchObject({
        filePath,
        durationSeconds: 120,
        fileSampleRate: 48000,
        channels: 2,
        codec: 'FLAC',
        bitDepth: 24,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('invalidates cached probe metadata after the local file changes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-probe-cache-'));
    const filePath = join(tempDir, 'song.flac');
    await writeFile(filePath, Buffer.from('first'));
    parseFileMock
      .mockResolvedValueOnce({
        format: {
          duration: 60,
          sampleRate: 44100,
          numberOfChannels: 2,
          codec: 'FLAC',
          bitsPerSample: 16,
          bitrate: 900000,
        },
      } as never)
      .mockResolvedValueOnce({
        format: {
          duration: 60,
          sampleRate: 96000,
          numberOfChannels: 2,
          codec: 'FLAC',
          bitsPerSample: 24,
          bitrate: 1800000,
        },
      } as never);

    try {
      const decoder = createDecoder();
      const first = await decoder.probeLocalFile(filePath);
      await writeFile(filePath, Buffer.from('second version with different size'));
      const second = await decoder.probeLocalFile(filePath);

      expect(parseFileMock).toHaveBeenCalledTimes(2);
      expect(first.fileSampleRate).toBe(44100);
      expect(second.fileSampleRate).toBe(96000);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the MP4 audio sample-entry codec before applying ALAC probe correction', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-probe-cache-'));
    const filePath = join(tempDir, 'dolby.m4a');
    await writeFile(filePath, mp4WithAudioCodec('ec-3'));
    parseFileMock.mockResolvedValue({
      format: {
        duration: 180,
        sampleRate: 48000,
        numberOfChannels: 6,
        codec: 'ALAC',
        bitsPerSample: 16,
        bitrate: 768000,
      },
    } as never);

    try {
      const decoder = createDecoder();
      const result = await decoder.probeLocalFile(filePath);

      expect(result.codec).toBe('E-AC-3');
      expect(result.channels).toBe(6);
      expect(parseFileMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
