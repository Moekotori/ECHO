import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AutomixAnalyzer, analyzePcmTransitionSegment } from './AutomixAnalyzer';

const samplesForSeconds = (seconds: number, sampleRate: number, value: number): Float32Array =>
  new Float32Array(Math.max(0, Math.round(seconds * sampleRate))).fill(value);

const concatSamples = (...segments: Float32Array[]): Float32Array => {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.length;
  }
  return output;
};

describe('AutomixAnalyzer PCM helpers', () => {
  it('detects leading and trailing silence and returns a normalized energy curve', () => {
    const sampleRate = 1000;
    const samples = concatSamples(
      samplesForSeconds(1.2, sampleRate, 0),
      samplesForSeconds(2.4, sampleRate, 0.35),
      samplesForSeconds(0.8, sampleRate, 0),
    );

    const analysis = analyzePcmTransitionSegment(samples, { sampleRate, buckets: 8 });

    expect(analysis.leadingSilenceSeconds).toBeCloseTo(1.2, 1);
    expect(analysis.trailingSilenceSeconds).toBeCloseTo(0.8, 1);
    expect(analysis.rmsDb).toBeLessThan(0);
    expect(analysis.energyCurve).toHaveLength(8);
    expect(Math.max(...analysis.energyCurve)).toBeCloseTo(1, 1);
    expect(analysis.energyCurve[0]).toBe(0);
  });

  it('exposes completed analysis from the in-memory cache', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const buffer = Buffer.alloc(22050 * 2 * 2);
      for (let index = 0; index < buffer.length / 2; index += 1) {
        buffer.writeInt16LE(index % 64 < 32 ? 12000 : -12000, index * 2);
      }

      queueMicrotask(() => {
        child.stdout.end(buffer);
        child.stderr.end();
        child.emit('exit', 0, null);
      });
      return child;
    });
    const analyzer = new AutomixAnalyzer({
      ffmpegPath: 'ffmpeg-test',
      spawn: spawn as never,
      logger: () => undefined,
    });
    const request = {
      filePath: 'song.flac',
      probe: {
        durationSeconds: 120,
      },
    };

    expect(analyzer.getCachedAnalysis(request)).toBeNull();
    const analysis = await analyzer.analyze(request);

    expect(analysis.status).toBe('complete');
    expect(analysis.introRmsDb).toBeLessThan(0);
    expect(analysis.outroRmsDb).toBeLessThan(0);
    expect(analyzer.getCachedAnalysis(request)).toBe(analysis);
  });

  it('keeps separate cached analyses for different beat offsets', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const buffer = Buffer.alloc(22050 * 2 * 2);
      for (let index = 0; index < buffer.length / 2; index += 1) {
        buffer.writeInt16LE(index % 64 < 32 ? 12000 : -12000, index * 2);
      }

      queueMicrotask(() => {
        child.stdout.end(buffer);
        child.stderr.end();
        child.emit('exit', 0, null);
      });
      return child;
    });
    const analyzer = new AutomixAnalyzer({
      ffmpegPath: 'ffmpeg-test',
      spawn: spawn as never,
      logger: () => undefined,
    });
    const baseRequest = {
      filePath: 'song.flac',
      probe: {
        durationSeconds: 120,
      },
    };

    await analyzer.analyze({ ...baseRequest, hint: { bpm: 128, bpmConfidence: 0.9, beatOffsetMs: 12 } });
    await analyzer.analyze({ ...baseRequest, hint: { bpm: 128, bpmConfidence: 0.9, beatOffsetMs: 48 } });

    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it('keeps separate cached analyses for different input header values', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const buffer = Buffer.alloc(22050 * 2 * 2);
      for (let index = 0; index < buffer.length / 2; index += 1) {
        buffer.writeInt16LE(index % 64 < 32 ? 12000 : -12000, index * 2);
      }

      queueMicrotask(() => {
        child.stdout.end(buffer);
        child.stderr.end();
        child.emit('exit', 0, null);
      });
      return child;
    });
    const analyzer = new AutomixAnalyzer({
      ffmpegPath: 'ffmpeg-test',
      spawn: spawn as never,
      logger: () => undefined,
    });
    const baseRequest = {
      filePath: 'https://example.test/song.flac',
      probe: {
        durationSeconds: 120,
      },
    };

    await analyzer.analyze({ ...baseRequest, headers: { Authorization: 'Bearer one' } });
    await analyzer.analyze({ ...baseRequest, headers: { Authorization: 'Bearer two' } });

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('keeps an estimated outro shape for HTTP inputs without decoding a remote tail segment', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      const buffer = Buffer.alloc(22050 * 2 * 2);
      for (let index = 0; index < buffer.length / 2; index += 1) {
        buffer.writeInt16LE(index % 64 < 32 ? 12000 : -12000, index * 2);
      }

      queueMicrotask(() => {
        child.stdout.end(buffer);
        child.stderr.end();
        child.emit('exit', 0, null);
      });
      return child;
    });
    const analyzer = new AutomixAnalyzer({
      ffmpegPath: 'ffmpeg-test',
      spawn: spawn as never,
      logger: () => undefined,
    });

    const analysis = await analyzer.analyze({
      filePath: 'https://example.test/song.flac',
      probe: { durationSeconds: 180 },
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(analysis.status).toBe('estimated');
    expect(analysis.energyCurve).toHaveLength(18);
    expect(analysis.energyCurve.at(-1)).toBeLessThan(analysis.energyCurve.at(-5) ?? 0);
  });
});
