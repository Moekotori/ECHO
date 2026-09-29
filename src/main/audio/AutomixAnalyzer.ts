import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessByStdio, SpawnOptionsWithStdioTuple } from 'node:child_process';
import type { Readable } from 'node:stream';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolveFfmpegToolchainPath } from './FfmpegToolchain';
import type { AutomixAnalysisStore } from './AutomixAnalysisStore';
import {
  automixAnalysisVersion,
  type AutomixAnalysisV2,
  type AutomixKeyAnalysis,
  type AutomixPhraseBoundary,
} from '../../shared/types/automix';
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
  store?: AutomixAnalysisStore;
  persistentStore?: boolean;
};

export type AutomixAnalyzeRequest = {
  filePath: string;
  probe: AutomixProbeLike;
  headers?: Record<string, string>;
  hint?: AutomixAnalysisHint | null;
  trackId?: string | null;
  fingerprint?: string | null;
};

export type PcmTransitionSegmentAnalysis = {
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  rmsDb: number | null;
  energyCurve: number[];
};

export type PcmMusicalFeatureAnalysis = {
  key: AutomixKeyAnalysis | null;
  segmentRmsDb: number[];
  bpm: number | null;
  bpmConfidence: number | null;
  beatOffsetMs: number | null;
};

const sampleRate = 11025;
const segmentSeconds = 36;
const silenceThresholdDb = -48;
const cacheTtlMs = 24 * 60 * 60 * 1000;
const maxCacheEntries = 300;
const majorKeyProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorKeyProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const camelotMajor = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const camelotMinor = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

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
    const sample = samples[index];
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
      if (frameEnergy[frame] >= silenceThreshold) {
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
  const noiseFloor = sorted[Math.floor(sorted.length * 0.18)];
  const peak = Math.max(...rawBuckets, silenceThreshold);
  const energyCurve = rawBuckets.map((value) => clamp((value - noiseFloor) / Math.max(silenceThreshold, peak - noiseFloor), 0, 1));

  return {
    leadingSilenceSeconds: roundToMillis(leadingSilenceSeconds),
    trailingSilenceSeconds: roundToMillis(trailingSilenceSeconds),
    rmsDb: amplitudeToDb(rms),
    energyCurve,
  };
};

const goertzelPower = (
  samples: Float32Array,
  start: number,
  end: number,
  frequency: number,
  effectiveSampleRate: number,
): number => {
  const omega = (2 * Math.PI * frequency) / effectiveSampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;
  for (let index = start; index < end; index += 1) {
    const next = samples[index] + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = next;
  }
  return Math.max(0, previousPrevious ** 2 + previous ** 2 - coefficient * previous * previousPrevious);
};

const correlation = (left: number[], right: number[]): number => {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const normalizedLeft = left[index] - leftMean;
    const normalizedRight = right[index] - rightMean;
    numerator += normalizedLeft * normalizedRight;
    leftEnergy += normalizedLeft ** 2;
    rightEnergy += normalizedRight ** 2;
  }
  return numerator / Math.max(1e-12, Math.sqrt(leftEnergy * rightEnergy));
};

const analyzeTempoFromOnsets = (
  samples: Float32Array,
  effectiveSampleRate: number,
): Pick<PcmMusicalFeatureAnalysis, 'bpm' | 'bpmConfidence' | 'beatOffsetMs'> => {
  const frameSize = 1024;
  const hopSize = 256;
  if (samples.length < effectiveSampleRate * 2) {
    return { bpm: null, bpmConfidence: null, beatOffsetMs: null };
  }
  const frameCount = Math.max(0, Math.floor((samples.length - frameSize) / hopSize));
  const onsets = new Array<number>(frameCount).fill(0);
  let previousEnergy = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let energy = 0;
    for (let index = start; index < start + frameSize; index += 1) {
      const sample = samples[index] ?? 0;
      energy += sample * sample;
    }
    energy = Math.sqrt(energy / frameSize);
    onsets[frame] = Math.max(0, energy - previousEnergy);
    previousEnergy = energy;
  }
  const mean = onsets.reduce((sum, value) => sum + value, 0) / Math.max(1, onsets.length);
  for (let index = 0; index < onsets.length; index += 1) {
    onsets[index] = Math.max(0, onsets[index] - mean * 0.45);
  }

  const minimumLag = Math.max(1, Math.round((60 / 200) * effectiveSampleRate / hopSize));
  const maximumLag = Math.min(
    onsets.length - 1,
    Math.round((60 / 60) * effectiveSampleRate / hopSize),
  );
  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let dot = 0;
    let leftEnergy = 1e-12;
    let rightEnergy = 1e-12;
    for (let index = lag; index < onsets.length; index += 1) {
      const left = onsets[index];
      const right = onsets[index - lag];
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const score = dot / Math.sqrt(leftEnergy * rightEnergy);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestScore < 0.08) {
    return { bpm: null, bpmConfidence: null, beatOffsetMs: null };
  }

  let bpm = (60 * effectiveSampleRate) / (bestLag * hopSize);
  while (bpm < 80) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const normalizedPeriodFrames = Math.max(
    1,
    Math.round((60 / bpm) * effectiveSampleRate / hopSize),
  );
  let offsetFrame = 0;
  for (let index = 1; index < Math.min(normalizedPeriodFrames, onsets.length); index += 1) {
    if (onsets[index] > onsets[offsetFrame]) {
      offsetFrame = index;
    }
  }
  return {
    bpm: roundToMillis(bpm),
    bpmConfidence: roundToMillis(clamp(bestScore, 0, 1)),
    beatOffsetMs: Math.round((offsetFrame * hopSize * 1000) / effectiveSampleRate),
  };
};

export const analyzePcmMusicalFeatures = (
  samples: Float32Array,
  effectiveSampleRate = sampleRate,
): PcmMusicalFeatureAnalysis => {
  const tempo = analyzeTempoFromOnsets(samples, effectiveSampleRate);
  if (samples.length < Math.max(1, effectiveSampleRate)) {
    return { key: null, segmentRmsDb: [], ...tempo };
  }

  const analysisStart = Math.min(samples.length, Math.round(effectiveSampleRate * 0.5));
  const analysisEnd = Math.max(analysisStart, samples.length - Math.round(effectiveSampleRate * 0.5));
  const chroma = new Array<number>(12).fill(0);
  for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
    for (let midi = 36 + pitchClass; midi <= 84; midi += 12) {
      const frequency = 440 * (2 ** ((midi - 69) / 12));
      chroma[pitchClass] += goertzelPower(samples, analysisStart, analysisEnd, frequency, effectiveSampleRate);
    }
  }
  const chromaTotal = chroma.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(chromaTotal) || chromaTotal <= 1e-9) {
    return { key: null, segmentRmsDb: [], ...tempo };
  }
  const normalizedChroma = chroma.map((value) => value / chromaTotal);
  const candidates: Array<{ tonic: number; mode: 'major' | 'minor'; score: number }> = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotate = (profile: number[]): number[] =>
      Array.from({ length: 12 }, (_item, index) => profile[(index - tonic + 12) % 12]);
    candidates.push({ tonic, mode: 'major', score: correlation(normalizedChroma, rotate(majorKeyProfile)) });
    candidates.push({ tonic, mode: 'minor', score: correlation(normalizedChroma, rotate(minorKeyProfile)) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const confidence = clamp(((best?.score ?? 0) - (runnerUp?.score ?? 0)) * 3.5, 0, 1);
  const bucketCount = 18;
  const segmentRmsDb = Array.from({ length: bucketCount }, (_item, index) => {
    const start = Math.floor((samples.length * index) / bucketCount);
    const end = Math.floor((samples.length * (index + 1)) / bucketCount);
    return amplitudeToDb(frameRms(samples, start, end)) ?? -120;
  });

  return {
    key: best && confidence >= 0.08
      ? {
          tonic: best.tonic,
          mode: best.mode,
          camelot: best.mode === 'major' ? camelotMajor[best.tonic] : camelotMinor[best.tonic],
          confidence: roundToMillis(confidence),
          chroma: normalizedChroma.map(roundToMillis),
        }
      : null,
    segmentRmsDb,
    ...tempo,
  };
};

const buildBeatGrid = (
  durationSeconds: number,
  bpm: number | null,
  beatOffsetMs: number | null,
  energyCurve: number[] = [],
): { beats: number[]; downbeats: number[]; phrases: AutomixPhraseBoundary[] } => {
  if (bpm === null || bpm < 40 || bpm > 260 || durationSeconds <= 0) {
    return { beats: [], downbeats: [], phrases: [] };
  }
  const beatSeconds = 60 / bpm;
  const offsetSeconds = Math.max(0, (beatOffsetMs ?? 0) / 1000);
  const beats: number[] = [];
  for (let seconds = offsetSeconds; seconds <= durationSeconds && beats.length < 8192; seconds += beatSeconds) {
    beats.push(roundToMillis(seconds));
  }
  const downbeats = beats.filter((_value, index) => index % 4 === 0);
  const phrases: AutomixPhraseBoundary[] = [];
  for (const bars of [4, 8, 16] as const) {
    const stride = bars * 4;
    for (let index = stride; index < beats.length; index += stride) {
      phrases.push({
        seconds: beats[index],
        bars,
        confidence: bars === 16 ? 0.9 : bars === 8 ? 0.78 : 0.64,
      });
    }
  }
  if (energyCurve.length > 2 && downbeats.length > 0) {
    for (let index = 1; index < energyCurve.length; index += 1) {
      const delta = Math.abs((energyCurve[index] ?? 0) - (energyCurve[index - 1] ?? 0));
      if (delta < 0.14) continue;
      const targetSeconds = (index / (energyCurve.length - 1)) * durationSeconds;
      const boundarySeconds = downbeats.reduce((best, value) =>
        Math.abs(value - targetSeconds) < Math.abs(best - targetSeconds) ? value : best,
      downbeats[0]);
      phrases.push({
        seconds: boundarySeconds,
        bars: 4,
        confidence: roundToMillis(clamp(0.62 + delta * 0.8, 0, 0.96)),
      });
    }
  }
  phrases.sort((left, right) => left.seconds - right.seconds || right.bars - left.bars);
  const uniquePhrases = phrases.filter((phrase, index) =>
    index === 0
    || phrase.seconds !== phrases[index - 1]?.seconds
    || phrase.bars !== phrases[index - 1]?.bars,
  );
  return { beats, downbeats, phrases: uniquePhrases };
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
  private store: AutomixAnalysisStore | null;
  private readonly persistentStore: boolean;
  private storeResolutionAttempted = false;
  private readonly cache = new Map<string, CachedAutomixAnalysis>();

  constructor(dependencies: AutomixAnalyzerDependencies = {}) {
    this.ffmpegPath = dependencies.ffmpegPath ?? null;
    this.spawn = dependencies.spawn ?? (nodeSpawn as AutomixAnalyzerSpawner);
    this.logger = dependencies.logger ?? defaultLogger;
    this.now = dependencies.now ?? (() => new Date());
    this.store = dependencies.store ?? null;
    this.persistentStore = dependencies.persistentStore === true;
  }

  async analyzeV2(request: AutomixAnalyzeRequest): Promise<AutomixAnalysisV2> {
    const store = await this.resolveStore();
    const fingerprint = await this.createV2Fingerprint(request);
    if (request.trackId && store) {
      const stored = store.get(request.trackId, fingerprint);
      if (stored) {
        return stored;
      }
    }

    try {
      const legacy = await this.analyze(request);
      const headSeconds = Math.min(segmentSeconds, Math.max(0, legacy.durationSeconds));
      const headSamples = headSeconds > 0
        ? await this.decodeSegment(request.filePath, 0, headSeconds, request.headers)
        : new Float32Array();
      const musical = analyzePcmMusicalFeatures(headSamples, sampleRate);
      const legacyBpmConfidence = Number.isFinite(legacy.beatConfidence) ? legacy.beatConfidence : null;
      const useMusicalTempo = musical.bpm !== null
        && (musical.bpmConfidence ?? 0) > (legacyBpmConfidence ?? 0);
      const bpm = useMusicalTempo
        ? musical.bpm
        : Number.isFinite(legacy.bpm) ? legacy.bpm : musical.bpm;
      const bpmConfidence = useMusicalTempo ? musical.bpmConfidence : legacyBpmConfidence;
      const beatOffsetMs = useMusicalTempo ? musical.beatOffsetMs : legacy.beatOffsetMs;
      const grid = buildBeatGrid(legacy.durationSeconds, bpm, beatOffsetMs, legacy.energyCurve);
      const analysis: AutomixAnalysisV2 = {
        version: automixAnalysisVersion,
        fingerprint,
        status: legacy.status === 'complete' ? 'complete' : legacy.status === 'unavailable' ? 'unavailable' : 'partial',
        durationSeconds: legacy.durationSeconds,
        bpm,
        bpmConfidence,
        beatOffsetMs,
        beatGridSeconds: grid.beats,
        downbeatGridSeconds: grid.downbeats,
        phraseBoundaries: grid.phrases,
        key: musical.key,
        leadingSilenceSeconds: legacy.leadingSilenceSeconds,
        trailingSilenceSeconds: legacy.trailingSilenceSeconds,
        integratedLufs: legacy.lufsDb,
        segmentRmsDb: musical.segmentRmsDb,
        energyCurve: legacy.energyCurve,
        analyzedAt: legacy.analyzedAt ?? this.now().toISOString(),
        error: null,
      };
      if (request.trackId && store) {
        store.deleteStale(request.trackId, fingerprint);
        store.put(request.trackId, analysis);
      }
      return analysis;
    } catch (error) {
      const failed: AutomixAnalysisV2 = {
        version: automixAnalysisVersion,
        fingerprint,
        status: 'error',
        durationSeconds: Math.max(0, Number(request.probe.durationSeconds) || 0),
        bpm: null,
        bpmConfidence: null,
        beatOffsetMs: null,
        beatGridSeconds: [],
        downbeatGridSeconds: [],
        phraseBoundaries: [],
        key: null,
        leadingSilenceSeconds: 0,
        trailingSilenceSeconds: 0,
        integratedLufs: null,
        segmentRmsDb: [],
        energyCurve: [],
        analyzedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      if (request.trackId && store) {
        store.put(request.trackId, failed);
      }
      return failed;
    }
  }

  private async resolveStore(): Promise<AutomixAnalysisStore | null> {
    if (this.store || !this.persistentStore || this.storeResolutionAttempted) {
      return this.store;
    }
    this.storeResolutionAttempted = true;
    try {
      const [{ AutomixAnalysisStore }, { getLibraryDatabaseManager }] = await Promise.all([
        import('./AutomixAnalysisStore'),
        import('../database/LibraryDatabaseManager'),
      ]);
      this.store = new AutomixAnalysisStore(getLibraryDatabaseManager().getDatabase());
    } catch (error) {
      this.logger(`[AutomixAnalyzer] persistent V2 cache unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
    return this.store;
  }

  private async createV2Fingerprint(request: AutomixAnalyzeRequest): Promise<string> {
    const supplied = request.fingerprint?.trim();
    if (supplied) {
      return supplied;
    }
    let identity = this.createCacheKey(request);
    if (!isHttpInputPath(request.filePath)) {
      try {
        const file = await stat(request.filePath);
        identity = `${request.filePath}|${file.size}|${file.mtimeMs}`;
      } catch {
        // A missing file remains an explicit analysis error later. The stable
        // request identity still prevents accidental reuse from another item.
      }
    }
    return createHash('sha256').update(identity).digest('hex');
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
      // Evict cache entry so subsequent calls retry instead of returning stale fallback
      const cacheKey = this.createCacheKey(request);
      if (this.cache.get(cacheKey)?.value === value) {
        this.cache.delete(cacheKey);
      }
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
        } else {
          reject(new Error(`ffmpeg_exit_${code ?? signal ?? 'unknown'}: ${stderrLines.join(' | ')}`));
        }
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
