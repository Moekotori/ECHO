import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple } from 'node:child_process';
import type { Readable } from 'node:stream';
import readline from 'node:readline';
import { resolveFfmpegToolchainPath } from './FfmpegToolchain';
import {
  createEstimatedAutomixAnalysis,
  type AutomixAnalysisHint,
  type AutomixProbeLike,
  type TrackTransitionAnalysis,
} from './AutomixPlanner';

type AutomixAnalyzerProcess = ChildProcessByStdio<null, Readable, Readable>;
type AutomixAnalyzerSpawnOptions = SpawnOptionsWithStdioTuple<'ignore', 'pipe', 'pipe'> & {
  windowsHide: boolean;
};
type AutomixAnalyzerSpawner = (file: string, args: string[], options: AutomixAnalyzerSpawnOptions) => AutomixAnalyzerProcess;

export type AutomixAnalyzerDependencies = {
  ffmpegPath?: string;
  spawn?: AutomixAnalyzerSpawner;
  logger?: (message: string) => void;
  now?: () => Date;
};

export type AutomixAnalyzeRequest = {
  filePath: string;
  probe: AutomixProbeLike;
  headers?: Record<string, string>;
  hint?: AutomixAnalysisHint | null;
};

export type PcmTransitionSegmentAnalysis = {
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  rmsDb: number | null;
  energyCurve: number[];
};

const sampleRate = 11025;
const segmentSeconds = 36;
const silenceThresholdDb = -48;
const cacheTtlMs = 24 * 60 * 60 * 1000;
const maxCacheEntries = 300;

const defaultLogger = (message: string): void => {
  console.warn(message);
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

const roundToMillis = (value: number): number => Math.round(value * 1000) / 1000;

const dbToAmplitude = (db: number): number => 10 ** (db / 20);

const amplitudeToDb = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return 20 * Math.log10(value);
};

const isHttpInputPath = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

const createRemoteInputArgs = (decodePath: string): string[] =>
  isHttpInputPath(decodePath)
    ? [
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_at_eof',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-reconnect_delay_max',
        '2',
        '-rw_timeout',
        '30000000',
      ]
    : [];

const normalizeInputHeaders = (headers: Record<string, string> | undefined): string | null => {
  if (!headers) {
    return null;
  }

  const lines = Object.entries(headers)
    .map(([name, value]) => [name.trim(), String(value).trim()] as const)
    .filter(([name, value]) => name.length > 0 && value.length > 0 && !/[\r\n:]/u.test(name) && !/[\r\n]/u.test(value))
    .map(([name, value]) => `${name}: ${value}`);

  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : null;
};

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

export const readInt16PcmSamples = (buffer: Buffer): Float32Array => {
  const sampleCount = Math.floor(buffer.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2) / 32768;
  }

  return samples;
};

const frameRms = (samples: Float32Array, start: number, end: number): number => {
  let sum = 0;
  const safeEnd = Math.max(start, Math.min(samples.length, end));
  for (let index = start; index < safeEnd; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }

  return safeEnd > start ? Math.sqrt(sum / (safeEnd - start)) : 0;
};

export const analyzePcmTransitionSegment = (
  samples: Float32Array,
  options: { segmentStartSeconds?: number; sampleRate?: number; buckets?: number } = {},
): PcmTransitionSegmentAnalysis => {
  const effectiveSampleRate = Math.max(1, Math.round(options.sampleRate ?? sampleRate));
  const frameSize = Math.max(1, Math.round(effectiveSampleRate * 0.1));
  const silenceThreshold = dbToAmplitude(silenceThresholdDb);
  const durationSeconds = samples.length / effectiveSampleRate;
  const frameCount = Math.max(1, Math.ceil(samples.length / frameSize));
  const frameEnergy = new Array<number>(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    frameEnergy[frame] = frameRms(samples, frame * frameSize, (frame + 1) * frameSize);
  }

  const firstAudibleFrame = frameEnergy.findIndex((value) => value >= silenceThreshold);
  const lastAudibleFrame = (() => {
    for (let frame = frameEnergy.length - 1; frame >= 0; frame -= 1) {
      if ((frameEnergy[frame] ?? 0) >= silenceThreshold) {
        return frame;
      }
    }

    return -1;
  })();
  const leadingSilenceSeconds = firstAudibleFrame < 0 ? durationSeconds : (firstAudibleFrame * frameSize) / effectiveSampleRate;
  const trailingSilenceSeconds = lastAudibleFrame < 0
    ? durationSeconds
    : Math.max(0, durationSeconds - (((lastAudibleFrame + 1) * frameSize) / effectiveSampleRate));
  const rms = frameRms(samples, 0, samples.length);
  const bucketCount = Math.max(1, Math.round(options.buckets ?? 18));
  const rawBuckets = Array.from({ length: bucketCount }, (_item, bucket) => {
    const start = Math.floor((samples.length * bucket) / bucketCount);
    const end = Math.floor((samples.length * (bucket + 1)) / bucketCount);
    return frameRms(samples, start, end);
  });
  const sorted = [...rawBuckets].sort((left, right) => left - right);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.18)] ?? 0;
  const peak = Math.max(...rawBuckets, silenceThreshold);
  const energyCurve = rawBuckets.map((value) => clamp((value - noiseFloor) / Math.max(silenceThreshold, peak - noiseFloor), 0, 1));

  return {
    leadingSilenceSeconds: roundToMillis(leadingSilenceSeconds),
    trailingSilenceSeconds: roundToMillis(trailingSilenceSeconds),
    rmsDb: amplitudeToDb(rms),
    energyCurve,
  };
};

type CachedAutomixAnalysis = {
  expiresAt: number;
  value: Promise<TrackTransitionAnalysis>;
  resolved?: TrackTransitionAnalysis;
};

export class AutomixAnalyzer {
  private ffmpegPath: string | null;
  private readonly spawn: AutomixAnalyzerSpawner;
  private readonly logger: (message: string) => void;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedAutomixAnalysis>();

  constructor(dependencies: AutomixAnalyzerDependencies = {}) {
    this.ffmpegPath = dependencies.ffmpegPath ?? null;
    this.spawn = dependencies.spawn ?? (nodeSpawn as AutomixAnalyzerSpawner);
    this.logger = dependencies.logger ?? defaultLogger;
    this.now = dependencies.now ?? (() => new Date());
  }

  async analyze(request: AutomixAnalyzeRequest): Promise<TrackTransitionAnalysis> {
    const key = this.createCacheKey(request);
    const nowMs = this.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > nowMs) {
      return cached.value;
    }

    const value = this.analyzeUncached(request).catch((error) => {
      this.logger(`[AutomixAnalyzer] fallback analysis for "${request.filePath}": ${error instanceof Error ? error.message : String(error)}`);
      return createEstimatedAutomixAnalysis(request.probe, request.hint);
    });
    const entry: CachedAutomixAnalysis = {
      expiresAt: nowMs + cacheTtlMs,
      value,
    };
    value.then((analysis) => {
      entry.resolved = analysis;
    }).catch(() => undefined);
    this.cache.set(key, entry);
    this.pruneCache();
    return value;
  }

  getCachedAnalysis(request: AutomixAnalyzeRequest): TrackTransitionAnalysis | null {
    const key = this.createCacheKey(request);
    const nowMs = this.now().getTime();
    const cached = this.cache.get(key);
    if (!cached || cached.expiresAt <= nowMs || !cached.resolved) {
      return null;
    }

    return cached.resolved;
  }

  private createCacheKey(request: AutomixAnalyzeRequest): string {
    const duration = Number.isFinite(request.probe.durationSeconds) ? Math.round(request.probe.durationSeconds * 1000) : 0;
    const bpm = Number.isFinite(Number(request.hint?.bpm)) ? Math.round(Number(request.hint?.bpm) * 100) : 'n';
    const bpmConfidence = Number.isFinite(Number(request.hint?.bpmConfidence)) ? Math.round(Number(request.hint?.bpmConfidence) * 1000) : 'n';
    const beatOffsetMs = Number.isFinite(Number(request.hint?.beatOffsetMs)) ? Math.round(Number(request.hint?.beatOffsetMs)) : 'n';
    const headersKey = Object.entries(request.headers ?? {})
      .map(([name, value]) => `${name.trim().toLowerCase()}:${String(value).trim()}`)
      .sort()
      .join(',');
    return `${request.filePath}|${duration}|${bpm}|${bpmConfidence}|${beatOffsetMs}|${headersKey}`;
  }

  private pruneCache(): void {
    if (this.cache.size <= maxCacheEntries) {
      return;
    }

    const nowMs = this.now().getTime();
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= nowMs || this.cache.size > maxCacheEntries) {
        this.cache.delete(key);
      }
    }
  }

  private async analyzeUncached(request: AutomixAnalyzeRequest): Promise<TrackTransitionAnalysis> {
    const estimated = createEstimatedAutomixAnalysis(request.probe, request.hint);
    if (estimated.durationSeconds <= 0) {
      return estimated;
    }

    const headSeconds = Math.min(segmentSeconds, estimated.durationSeconds);
    const headSamples = await this.decodeSegment(request.filePath, 0, headSeconds, request.headers);
    const head = analyzePcmTransitionSegment(headSamples, { sampleRate, buckets: 18 });
    let tail: PcmTransitionSegmentAnalysis | null = null;
    if (!isHttpInputPath(request.filePath) && estimated.durationSeconds > segmentSeconds + 6) {
      const tailStart = Math.max(0, estimated.durationSeconds - segmentSeconds);
      const tailSamples = await this.decodeSegment(request.filePath, tailStart, segmentSeconds, request.headers);
      tail = analyzePcmTransitionSegment(tailSamples, { sampleRate, buckets: 18 });
    }

    const leadingSilenceSeconds = Math.min(head.leadingSilenceSeconds, Math.min(12, estimated.durationSeconds * 0.2));
    const trailingSilenceSeconds = tail
      ? Math.min(tail.trailingSilenceSeconds, Math.min(12, estimated.durationSeconds * 0.2))
      : 0;
    const introEndSeconds = Math.min(estimated.durationSeconds, Math.max(leadingSilenceSeconds + 8, estimated.introEndSeconds));
    const outroEndSeconds = Math.max(0, estimated.durationSeconds - trailingSilenceSeconds);
    const outroStartSeconds = Math.max(0, Math.min(estimated.outroStartSeconds, outroEndSeconds - 8));
    const introRmsDb = head.rmsDb;
    const outroRmsDb = tail?.rmsDb ?? head.rmsDb;
    const rmsDb = outroRmsDb;
    const estimatedTailEnergy = estimated.energyCurve.slice(Math.max(0, estimated.energyCurve.length - 9));
    const energyCurve = tail
      ? [...head.energyCurve.slice(0, 9), ...tail.energyCurve.slice(-9)]
      : [...head.energyCurve.slice(0, 9), ...estimatedTailEnergy];

    return {
      ...estimated,
      status: tail ? 'complete' : 'estimated',
      introStartSeconds: roundToMillis(leadingSilenceSeconds),
      introEndSeconds: roundToMillis(introEndSeconds),
      outroStartSeconds: roundToMillis(outroStartSeconds),
      outroEndSeconds: roundToMillis(outroEndSeconds),
      leadingSilenceSeconds: roundToMillis(leadingSilenceSeconds),
      trailingSilenceSeconds: roundToMillis(trailingSilenceSeconds),
      rmsDb,
      lufsDb: rmsDb,
      introRmsDb,
      outroRmsDb,
      energyCurve,
      analyzedAt: this.now().toISOString(),
    };
  }

  private async decodeSegment(
    filePath: string,
    startSeconds: number,
    durationSeconds: number,
    headers: Record<string, string> | undefined,
  ): Promise<Float32Array> {
    const inputHeaders = normalizeInputHeaders(headers);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      ...(startSeconds > 0 ? ['-ss', String(roundToMillis(startSeconds))] : []),
      ...(inputHeaders ? ['-headers', inputHeaders] : []),
      ...createRemoteInputArgs(filePath),
      '-i',
      filePath,
      '-vn',
      '-t',
      String(roundToMillis(durationSeconds)),
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      'pipe:1',
    ];
    const stderrLines: string[] = [];
    const chunks: Buffer[] = [];
    const proc = this.spawn(this.resolveFfmpegPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stderr = readline.createInterface({ input: proc.stderr });
    stderr.on('line', (line) => appendTailLine(stderrLines, line));
    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`ffmpeg_exit_${code ?? signal ?? 'unknown'}: ${stderrLines.join(' | ')}`));
      });
    });

    const samples = readInt16PcmSamples(Buffer.concat(chunks));
    if (samples.length < sampleRate) {
      throw new Error('automix_analysis_too_short');
    }

    return samples;
  }

  private resolveFfmpegPath(): string {
    this.ffmpegPath ??= resolveFfmpegToolchainPath();
    return this.ffmpegPath;
  }
}
