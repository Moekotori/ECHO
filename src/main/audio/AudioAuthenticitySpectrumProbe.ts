import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple } from 'node:child_process';
import type { Readable } from 'node:stream';
import readline from 'node:readline';
import { resolveFfmpegToolchainPath } from './FfmpegToolchain';

export type AudioAuthenticitySpectrumProbeStatus = 'ready' | 'skipped' | 'unavailable' | 'too_short' | 'too_quiet' | 'error';

export type AudioAuthenticitySpectrumProbeRequest = {
  filePath: string;
  trackDurationSeconds: number | null;
  isDsd: boolean;
  isHiRes?: boolean;
};

export type AudioAuthenticitySpectrumProbeResult = {
  status: AudioAuthenticitySpectrumProbeStatus;
  decodeSampleRate: number | null;
  analyzedDurationSeconds: number | null;
  selectedStartSeconds: number | null;
  probeWindowCount: number | null;
  rmsDb: number | null;
  upperTrebleToAudibleDb: number | null;
  lowUltrasonicToAudibleDb: number | null;
  highFrequencyToAudibleDb: number | null;
  ultrasonicToAudibleDb: number | null;
  topBandToAudibleDb: number | null;
  spectralCutoffHz: number | null;
  brickwallLikely: boolean;
  pcmBandwidthCutoffLikely: boolean;
  dsdUltrasonicNoiseLikely: boolean;
  error: string | null;
};

type SpectrumProbeProcess = ChildProcessByStdio<null, Readable, Readable>;
type SpectrumProbeSpawnOptions = SpawnOptionsWithStdioTuple<'ignore', 'pipe', 'pipe'> & {
  windowsHide: boolean;
};
type SpectrumProbeSpawner = (file: string, args: string[], options: SpectrumProbeSpawnOptions) => SpectrumProbeProcess;

export type AudioAuthenticitySpectrumProbeDependencies = {
  ffmpegPath?: string;
  spawn?: SpectrumProbeSpawner;
};

type ProbeWindow = {
  startSeconds: number;
  durationSeconds: number;
};

const decodeSampleRate = 192_000;
const maxProbeWindowSeconds = 4;
const minProbeWindowSeconds = 3;
const maxProbeWindows = 3;
const probeTimeoutMs = 7_000;
const fftBlockSize = 8192;
const maxFftBlocks = 64;
const minRmsDb = -58;
const epsilon = 1e-24;

const appendTailLine = (lines: string[], line: string): void => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  lines.push(trimmed);
  if (lines.length > 8) {
    lines.shift();
  }
};

const roundToMillis = (value: number): number => Math.round(value * 1000) / 1000;

const amplitudeToDb = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? 20 * Math.log10(value) : null;

const ratioToDb = (value: number, reference: number): number | null => {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) {
    return null;
  }

  return 10 * Math.log10((value + epsilon) / (reference + epsilon));
};

const emptyResult = (status: AudioAuthenticitySpectrumProbeStatus, error: string | null = null): AudioAuthenticitySpectrumProbeResult => ({
  status,
  decodeSampleRate: null,
  analyzedDurationSeconds: null,
  selectedStartSeconds: null,
  probeWindowCount: null,
  rmsDb: null,
  upperTrebleToAudibleDb: null,
  lowUltrasonicToAudibleDb: null,
  highFrequencyToAudibleDb: null,
  ultrasonicToAudibleDb: null,
  topBandToAudibleDb: null,
  spectralCutoffHz: null,
  brickwallLikely: false,
  pcmBandwidthCutoffLikely: false,
  dsdUltrasonicNoiseLikely: false,
  error,
});

export const readFloat32PcmSamples = (buffer: Buffer): Float32Array => {
  const sampleCount = Math.floor(buffer.length / 4);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = buffer.readFloatLE(index * 4);
    samples[index] = Number.isFinite(value) ? value : 0;
  }

  return samples;
};

const createHannWindow = (size: number): Float64Array => {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / (size - 1)));
  }

  return window;
};

const reverseBits = (value: number, bits: number): number => {
  let result = 0;
  for (let bit = 0; bit < bits; bit += 1) {
    result = (result << 1) | (value & 1);
    value >>= 1;
  }

  return result;
};

const createBitReverseTable = (size: number): Uint32Array => {
  const bits = Math.round(Math.log2(size));
  const table = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    table[index] = reverseBits(index, bits);
  }

  return table;
};

const fft = (real: Float64Array, imaginary: Float64Array, bitReverse: Uint32Array): void => {
  const size = real.length;
  for (let index = 0; index < size; index += 1) {
    const swapIndex = bitReverse[index] ?? index;
    if (swapIndex > index) {
      const realValue = real[index] ?? 0;
      real[index] = real[swapIndex] ?? 0;
      real[swapIndex] = realValue;
      const imaginaryValue = imaginary[index] ?? 0;
      imaginary[index] = imaginary[swapIndex] ?? 0;
      imaginary[swapIndex] = imaginaryValue;
    }
  }

  for (let width = 2; width <= size; width *= 2) {
    const halfWidth = width / 2;
    const phaseStep = (-2 * Math.PI) / width;
    for (let start = 0; start < size; start += width) {
      for (let offset = 0; offset < halfWidth; offset += 1) {
        const phase = phaseStep * offset;
        const wr = Math.cos(phase);
        const wi = Math.sin(phase);
        const even = start + offset;
        const odd = even + halfWidth;
        const oddReal = real[odd] ?? 0;
        const oddImaginary = imaginary[odd] ?? 0;
        const tr = (wr * oddReal) - (wi * oddImaginary);
        const ti = (wr * oddImaginary) + (wi * oddReal);
        const evenReal = real[even] ?? 0;
        const evenImaginary = imaginary[even] ?? 0;
        real[odd] = evenReal - tr;
        imaginary[odd] = evenImaginary - ti;
        real[even] = evenReal + tr;
        imaginary[even] = evenImaginary + ti;
      }
    }
  }
};

type BandEnergy = {
  audible: number;
  upperTreble: number;
  lowUltrasonic: number;
  high: number;
  ultrasonic: number;
  top: number;
  buckets: number[];
};

const addPowerToBands = (bands: BandEnergy, frequency: number, power: number): void => {
  const bucketIndex = Math.floor(frequency / 2_000);
  bands.buckets[bucketIndex] = (bands.buckets[bucketIndex] ?? 0) + power;

  if (frequency >= 1_000 && frequency <= 18_000) {
    bands.audible += power;
  }
  if (frequency >= 18_000 && frequency <= 24_000) {
    bands.upperTreble += power;
  }
  if (frequency >= 24_000 && frequency <= 30_000) {
    bands.lowUltrasonic += power;
  }
  if (frequency >= 24_000 && frequency <= 40_000) {
    bands.high += power;
  }
  if (frequency >= 30_000 && frequency <= 80_000) {
    bands.ultrasonic += power;
  }
  if (frequency >= 40_000 && frequency <= 80_000) {
    bands.top += power;
  }
};

const estimateCutoffHz = (buckets: number[]): number | null => {
  const firstCandidate = Math.floor(18_000 / 2_000);
  const lastCandidate = Math.min(buckets.length - 4, Math.floor(46_000 / 2_000));
  for (let bucket = firstCandidate; bucket <= lastCandidate; bucket += 1) {
    const prior = Math.max(...buckets.slice(Math.max(1, bucket - 8), bucket + 1), epsilon);
    const following = Math.max(...buckets.slice(bucket + 1, bucket + 5), epsilon);
    if (following / prior < 1e-5) {
      return (bucket + 1) * 2_000;
    }
  }

  return null;
};

const analyzeRmsDb = (samples: Float32Array): number | null => {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }

  return amplitudeToDb(Math.sqrt(sum / Math.max(1, samples.length)));
};

export const analyzeAudioSpectrumSamples = (
  samples: Float32Array,
  sampleRate = decodeSampleRate,
): AudioAuthenticitySpectrumProbeResult => {
  if (samples.length < fftBlockSize * 2) {
    return emptyResult('too_short');
  }

  const rmsDb = analyzeRmsDb(samples);
  if (rmsDb !== null && rmsDb < minRmsDb) {
    return {
      ...emptyResult('too_quiet'),
      decodeSampleRate: sampleRate,
      analyzedDurationSeconds: samples.length / sampleRate,
      rmsDb,
    };
  }

  const real = new Float64Array(fftBlockSize);
  const imaginary = new Float64Array(fftBlockSize);
  const window = createHannWindow(fftBlockSize);
  const bitReverse = createBitReverseTable(fftBlockSize);
  const availableBlocks = Math.floor(samples.length / fftBlockSize);
  const stride = Math.max(1, Math.floor(availableBlocks / maxFftBlocks));
  const bands: BandEnergy = {
    audible: 0,
    upperTreble: 0,
    lowUltrasonic: 0,
    high: 0,
    ultrasonic: 0,
    top: 0,
    buckets: new Array(Math.ceil((sampleRate / 2) / 2_000)).fill(0) as number[],
  };
  let analyzedBlocks = 0;

  for (let block = 0; block < availableBlocks && analyzedBlocks < maxFftBlocks; block += stride) {
    const offset = block * fftBlockSize;
    for (let index = 0; index < fftBlockSize; index += 1) {
      real[index] = (samples[offset + index] ?? 0) * (window[index] ?? 0);
      imaginary[index] = 0;
    }
    fft(real, imaginary, bitReverse);
    for (let bin = 1; bin <= fftBlockSize / 2; bin += 1) {
      const frequency = (bin * sampleRate) / fftBlockSize;
      const realValue = real[bin] ?? 0;
      const imaginaryValue = imaginary[bin] ?? 0;
      addPowerToBands(bands, frequency, (realValue * realValue) + (imaginaryValue * imaginaryValue));
    }
    analyzedBlocks += 1;
  }

  const upperTrebleToAudibleDb = ratioToDb(bands.upperTreble, bands.audible);
  const lowUltrasonicToAudibleDb = ratioToDb(bands.lowUltrasonic, bands.audible);
  const highFrequencyToAudibleDb = ratioToDb(bands.high, bands.audible);
  const ultrasonicToAudibleDb = ratioToDb(bands.ultrasonic, bands.audible);
  const topBandToAudibleDb = ratioToDb(bands.top, bands.audible);
  const spectralCutoffHz = estimateCutoffHz(bands.buckets);
  const brickwallLikely =
    highFrequencyToAudibleDb !== null &&
    topBandToAudibleDb !== null &&
    highFrequencyToAudibleDb < -58 &&
    topBandToAudibleDb < -64 &&
    spectralCutoffHz !== null &&
    spectralCutoffHz <= 26_000;
  const dsdUltrasonicNoiseLikely =
    ultrasonicToAudibleDb !== null &&
    topBandToAudibleDb !== null &&
    ultrasonicToAudibleDb > -38 &&
    topBandToAudibleDb > -46;
  const pcmBandwidthCutoffLikely =
    upperTrebleToAudibleDb !== null &&
    lowUltrasonicToAudibleDb !== null &&
    topBandToAudibleDb !== null &&
    lowUltrasonicToAudibleDb < -52 &&
    topBandToAudibleDb > -48 &&
    (upperTrebleToAudibleDb < -50 ||
      (lowUltrasonicToAudibleDb < -58 &&
        spectralCutoffHz !== null &&
        spectralCutoffHz <= 30_000));

  return {
    status: 'ready',
    decodeSampleRate: sampleRate,
    analyzedDurationSeconds: samples.length / sampleRate,
    selectedStartSeconds: null,
    probeWindowCount: null,
    rmsDb,
    upperTrebleToAudibleDb,
    lowUltrasonicToAudibleDb,
    highFrequencyToAudibleDb,
    ultrasonicToAudibleDb,
    topBandToAudibleDb,
    spectralCutoffHz,
    brickwallLikely,
    pcmBandwidthCutoffLikely,
    dsdUltrasonicNoiseLikely,
    error: null,
  };
};

const chooseProbeDurationSeconds = (trackDurationSeconds: number | null): number => {
  if (trackDurationSeconds === null) {
    return maxProbeWindowSeconds;
  }

  return Math.max(minProbeWindowSeconds, Math.min(maxProbeWindowSeconds, trackDurationSeconds * 0.18));
};

const chooseProbeWindows = (trackDurationSeconds: number | null): ProbeWindow[] => {
  const durationSeconds = chooseProbeDurationSeconds(trackDurationSeconds);
  if (trackDurationSeconds === null || trackDurationSeconds <= durationSeconds + 3) {
    return [{ startSeconds: 0, durationSeconds }];
  }

  const maxStart = Math.max(0, trackDurationSeconds - durationSeconds);
  const candidates = [0.18, 0.48, 0.78]
    .map((ratio) => Math.min(maxStart, Math.max(0, (trackDurationSeconds * ratio) - (durationSeconds / 2))))
    .map(roundToMillis);
  const starts = [...new Set(candidates)].slice(0, maxProbeWindows);
  return starts.map((startSeconds) => ({ startSeconds, durationSeconds }));
};

const probeResultScore = (result: AudioAuthenticitySpectrumProbeResult, isDsd: boolean, isHiRes = false): number => {
  if (result.status !== 'ready') {
    if (result.status === 'too_quiet') {
      return 40;
    }
    if (result.status === 'too_short') {
      return 20;
    }
    return 0;
  }

  let score = 1000 + (result.rmsDb ?? -120);
  if (isDsd) {
    if (result.brickwallLikely) {
      score += 10_000;
    }
    if (result.pcmBandwidthCutoffLikely) {
      score += 9_000;
    }
    if (result.dsdUltrasonicNoiseLikely) {
      score += 3_000;
    }
  } else if (isHiRes && result.brickwallLikely) {
    score += 10_000;
  } else if (isHiRes && result.highFrequencyToAudibleDb !== null && result.highFrequencyToAudibleDb > -55) {
    score += 2_000;
  } else if (!isHiRes && result.upperTrebleToAudibleDb !== null && result.upperTrebleToAudibleDb > -45) {
    score += 2_000;
  } else if (
    !isHiRes &&
    result.spectralCutoffHz !== null &&
    result.spectralCutoffHz <= 20_000 &&
    result.upperTrebleToAudibleDb !== null &&
    result.upperTrebleToAudibleDb < -58
  ) {
    score += 1_000;
  }

  return score;
};

const isRiskResult = (result: AudioAuthenticitySpectrumProbeResult, isDsd: boolean, isHiRes = false): boolean =>
  result.status === 'ready' &&
  (isDsd ? result.brickwallLikely || result.pcmBandwidthCutoffLikely : isHiRes && result.brickwallLikely);

export const selectBestAudioSpectrumProbeResult = (
  results: AudioAuthenticitySpectrumProbeResult[],
  isDsd: boolean,
  isHiRes = false,
): AudioAuthenticitySpectrumProbeResult =>
  results
    .slice()
    .sort((left, right) => probeResultScore(right, isDsd, isHiRes) - probeResultScore(left, isDsd, isHiRes))[0] ??
  emptyResult('unavailable');

const maxProbeBytesForDuration = (durationSeconds: number): number =>
  Math.ceil(decodeSampleRate * durationSeconds * 4) + 64 * 1024;

export class AudioAuthenticitySpectrumProbe {
  private readonly ffmpegPath: string;
  private readonly spawn: SpectrumProbeSpawner;

  constructor(dependencies: AudioAuthenticitySpectrumProbeDependencies = {}) {
    this.ffmpegPath = dependencies.ffmpegPath ?? resolveFfmpegToolchainPath();
    this.spawn = dependencies.spawn ?? (nodeSpawn as SpectrumProbeSpawner);
  }

  async probe(request: AudioAuthenticitySpectrumProbeRequest): Promise<AudioAuthenticitySpectrumProbeResult> {
    const isHiRes = request.isHiRes === true;
    const windows = chooseProbeWindows(request.trackDurationSeconds);
    const results: AudioAuthenticitySpectrumProbeResult[] = [];
    for (const window of windows) {
      const result = await this.probeWindow(request.filePath, window);
      const windowResult = {
        ...result,
        selectedStartSeconds: window.startSeconds,
        probeWindowCount: windows.length,
      };
      results.push(windowResult);
      if (isRiskResult(windowResult, request.isDsd, isHiRes)) {
        return windowResult;
      }
    }

    return selectBestAudioSpectrumProbeResult(results, request.isDsd, isHiRes);
  }

  private async probeWindow(filePath: string, window: ProbeWindow): Promise<AudioAuthenticitySpectrumProbeResult> {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-nostats',
      ...(window.startSeconds > 0 ? ['-ss', String(roundToMillis(window.startSeconds))] : []),
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-t',
      String(roundToMillis(window.durationSeconds)),
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      String(decodeSampleRate),
      'pipe:1',
    ];
    const stderrLines: string[] = [];
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let outputTooLarge = false;
    const maxProbeBytes = maxProbeBytesForDuration(window.durationSeconds);

    try {
      const proc = this.spawn(this.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stderr = readline.createInterface({ input: proc.stderr });
      stderr.on('line', (line) => appendTailLine(stderrLines, line));
      proc.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxProbeBytes) {
          outputTooLarge = true;
          proc.kill();
          return;
        }
        chunks.push(chunk);
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error: Error | null): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          stderr.close();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        const timer = setTimeout(() => {
          proc.kill();
          settle(new Error('spectrum_probe_timeout'));
        }, probeTimeoutMs);
        proc.on('error', (error) => settle(error instanceof Error ? error : new Error(String(error))));
        proc.on('exit', (code, signal) => {
          if (outputTooLarge) {
            settle(new Error('spectrum_probe_output_too_large'));
            return;
          }
          if (code === 0) {
            settle(null);
            return;
          }
          settle(new Error(`ffmpeg_exit_${code ?? signal ?? 'unknown'}: ${stderrLines.join(' | ')}`));
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return emptyResult(/ENOENT|ffmpeg_missing/iu.test(message) ? 'unavailable' : 'error', message);
    }

    const samples = readFloat32PcmSamples(Buffer.concat(chunks));
    const result = analyzeAudioSpectrumSamples(samples, decodeSampleRate);
    return {
      ...result,
      analyzedDurationSeconds: result.analyzedDurationSeconds ?? samples.length / decodeSampleRate,
      decodeSampleRate,
      selectedStartSeconds: window.startSeconds,
    };
  }
}
