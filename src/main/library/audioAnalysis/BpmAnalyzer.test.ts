import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BPM_CONFIDENCE_THRESHOLD } from '../../../shared/constants/audioAnalysis';
import { BpmAnalyzer } from './BpmAnalyzer';

const sampleRate = 11025;

const makePulseTrack = (bpm: number, seconds: number): Float32Array => {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  const beatSamples = (60 / bpm) * sampleRate;
  const decaySamples = Math.round(sampleRate * 0.07);

  for (let beat = 0; beat * beatSamples < samples.length; beat += 1) {
    const start = Math.round(beat * beatSamples);
    const accent = beat % 4 === 0 ? 0.95 : 0.72;
    for (let offset = 0; offset < decaySamples && start + offset < samples.length; offset += 1) {
      const decay = Math.exp(-offset / (sampleRate * 0.018));
      samples[start + offset] += accent * decay;
    }
  }

  return samples;
};

const makeStrongDownbeatPulseTrack = (bpm: number, seconds: number): Float32Array => {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  const beatSamples = (60 / bpm) * sampleRate;
  const decaySamples = Math.round(sampleRate * 0.065);

  for (let beat = 0; beat * beatSamples < samples.length; beat += 1) {
    const start = Math.round(beat * beatSamples);
    const accent = beat % 2 === 0 ? 0.98 : 0.54;
    for (let offset = 0; offset < decaySamples && start + offset < samples.length; offset += 1) {
      const decay = Math.exp(-offset / (sampleRate * 0.016));
      samples[start + offset] += accent * decay;
    }
  }

  return samples;
};

const makeConstantTone = (seconds: number): Float32Array => {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
  }
  return samples;
};

const pcmFromSamples = (samples: Float32Array): Buffer => {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  return buffer;
};

const analyzeSamples = async (samples: Float32Array) => {
  const pcm = pcmFromSamples(samples);
  const spawn = () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    queueMicrotask(() => {
      proc.stdout.end(pcm);
      proc.stderr.end();
      proc.emit('exit', 0, null);
    });
    return proc;
  };

  return new BpmAnalyzer({ ffmpegPath: 'ffmpeg', spawn: spawn as never, logger: () => undefined }).analyze(
    'memory.wav',
    samples.length / sampleRate,
  );
};

describe('BpmAnalyzer tempo estimation', () => {
  it('asks FFmpeg to decode only the first audio stream for analysis', async () => {
    let spawnedArgs: string[] = [];
    const pcm = pcmFromSamples(makePulseTrack(128, 40));
    const spawn = (_file: string, args: string[]) => {
      spawnedArgs = args;
      const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      queueMicrotask(() => {
        proc.stdout.end(pcm);
        proc.stderr.end();
        proc.emit('exit', 0, null);
      });
      return proc;
    };

    await new BpmAnalyzer({ ffmpegPath: 'ffmpeg', spawn: spawn as never, logger: () => undefined }).analyze('memory.wav', 40);

    expect(spawnedArgs).toEqual(expect.arrayContaining(['-nostats', '-map', '0:a:0', '-vn', '-sn', '-dn']));
  });

  it('assigns high confidence to a stable beat grid', async () => {
    const result = await analyzeSamples(makePulseTrack(128, 40));

    expect(Math.abs(result.bpm - 128)).toBeLessThan(3);
    expect(result.confidence).toBeGreaterThanOrEqual(BPM_CONFIDENCE_THRESHOLD);
  });

  it('keeps strong downbeat pulse tracks in double time instead of half time', async () => {
    const result = await analyzeSamples(makeStrongDownbeatPulseTrack(172, 40));

    expect(Math.abs(result.bpm - 172)).toBeLessThan(5);
  });

  it('does not collapse the current 86 BPM regression fixture to half time', async () => {
    const analyzer = new BpmAnalyzer({ logger: () => undefined });
    const result = await analyzer.analyze(join(process.cwd(), 'test', 'tt', '三省 - 毕竟我是一条鱼.mp3'), 90);

    expect(result.bpm < 80 || result.bpm > 95).toBe(true);
    expect(result.bpm).toBeGreaterThanOrEqual(150);
    expect(result.bpm).toBeLessThanOrEqual(190);
  });

  it('keeps confidence low when the audio has no usable onsets', async () => {
    const result = await analyzeSamples(makeConstantTone(40));

    expect(result.confidence).toBeLessThan(BPM_CONFIDENCE_THRESHOLD);
  });
});
