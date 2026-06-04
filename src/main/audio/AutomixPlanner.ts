export type AutomixTransitionMode = 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
export type AutomixTransitionCurve = 'hsin' | 'qsin' | 'tri';
export type AutomixTrackAnalysisStatus = 'complete' | 'estimated' | 'unavailable';

export type AutomixProbeLike = {
  durationSeconds: number;
  filePath?: string;
  codec?: string | null;
};

export type AutomixAnalysisHint = {
  bpm?: number | null;
  bpmConfidence?: number | null;
  beatOffsetMs?: number | null;
};

export type TrackTransitionAnalysis = {
  status: AutomixTrackAnalysisStatus;
  durationSeconds: number;
  introStartSeconds: number;
  introEndSeconds: number;
  outroStartSeconds: number;
  outroEndSeconds: number;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  rmsDb: number | null;
  lufsDb: number | null;
  introRmsDb?: number | null;
  outroRmsDb?: number | null;
  energyCurve: number[];
  bpm: number | null;
  beatOffsetMs: number | null;
  beatConfidence: number | null;
  analyzedAt?: string;
};

export type AutomixTransitionPlan = {
  mode: AutomixTransitionMode;
  currentStartSeconds: number;
  currentEndSeconds: number;
  currentFadeStartSeconds: number;
  nextStartSeconds: number;
  overlapSeconds: number;
  curve: AutomixTransitionCurve;
  currentGainDb: number;
  nextGainDb: number;
  tempoRatio: number;
  advanceAtSeconds: number;
  skipIntroSilence: boolean;
  beatAligned: boolean;
  fallbackReason: string | null;
};

export type AutomixPlanInput = {
  currentProbe: AutomixProbeLike;
  nextProbe: AutomixProbeLike;
  currentStartSeconds?: number;
  currentAnalysis?: TrackTransitionAnalysis | null;
  nextAnalysis?: TrackTransitionAnalysis | null;
  currentHint?: AutomixAnalysisHint | null;
  nextHint?: AutomixAnalysisHint | null;
  maxTransitionSeconds?: number;
  beatAlignEnabled?: boolean;
};

const minUsefulAutomixSeconds = 4;
const defaultAutomixTransitionSeconds = 16;
const maxAutomixTransitionSeconds = 16;
const minAutomixTempoRatio = 0.985;
const maxAutomixTempoRatio = 1.015;
const silenceLeadInPaddingSeconds = 0.04;
const silenceTailPaddingSeconds = 0.08;
const maxLowEnergyIntroSkipSeconds = 30;
const maxLowEnergyOutroTrimSeconds = 12;

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const roundToMillis = (value: number): number => Math.round(value * 1000) / 1000;

const normalizeDuration = (value: unknown): number => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
};

const normalizeSilence = (value: unknown, durationSeconds: number, maximumRatio: number): number => {
  const seconds = finiteOrNull(value);
  if (seconds === null || seconds <= 0 || durationSeconds <= 0) {
    return 0;
  }

  return clamp(seconds, 0, Math.min(12, durationSeconds * maximumRatio));
};

const normalizeEnergyCurve = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => finiteOrNull(item))
    .filter((item): item is number => item !== null)
    .map((item) => clamp(item, 0, 1))
    .slice(0, 96);
};

const inferEnergyCurve = (
  durationSeconds: number,
  leadingSilenceSeconds: number,
  trailingSilenceSeconds: number,
  introEndSeconds: number,
  outroStartSeconds: number,
): number[] => {
  if (durationSeconds <= 0) {
    return [];
  }

  const buckets = 16;
  return Array.from({ length: buckets }, (_item, index) => {
    const bucketStart = (durationSeconds * index) / buckets;
    const bucketEnd = (durationSeconds * (index + 1)) / buckets;
    if (bucketEnd <= leadingSilenceSeconds || bucketStart >= durationSeconds - trailingSilenceSeconds) {
      return 0;
    }

    const introRatio = introEndSeconds > 0 && bucketStart < introEndSeconds
      ? clamp(bucketStart / Math.max(1, introEndSeconds), 0, 1)
      : 1;
    const outroRatio = outroStartSeconds < durationSeconds && bucketEnd > outroStartSeconds
      ? clamp((durationSeconds - ((bucketStart + bucketEnd) / 2)) / Math.max(1, durationSeconds - outroStartSeconds), 0, 1)
      : 1;
    const energyRatio = Math.min(introRatio ** 2.5, outroRatio ** 2);
    return roundToMillis(clamp(0.22 + (0.5 * energyRatio), 0.18, 0.72));
  });
};

export const createEstimatedAutomixAnalysis = (
  probe: AutomixProbeLike,
  hint: AutomixAnalysisHint | null = null,
): TrackTransitionAnalysis => {
  const durationSeconds = normalizeDuration(probe.durationSeconds);
  const bpm = finiteOrNull(hint?.bpm);
  const beatConfidence = finiteOrNull(hint?.bpmConfidence);
  const beatOffsetMs = finiteOrNull(hint?.beatOffsetMs);
  const introLength = clamp(durationSeconds * 0.1, 6, Math.min(24, Math.max(6, durationSeconds * 0.22)));
  const outroLength = clamp(durationSeconds * 0.12, 8, Math.min(28, Math.max(8, durationSeconds * 0.22)));
  const introEndSeconds = Math.min(durationSeconds, introLength);
  const outroStartSeconds = Math.max(0, durationSeconds - outroLength);

  return {
    status: durationSeconds > 0 ? 'estimated' : 'unavailable',
    durationSeconds,
    introStartSeconds: 0,
    introEndSeconds: roundToMillis(introEndSeconds),
    outroStartSeconds: roundToMillis(outroStartSeconds),
    outroEndSeconds: roundToMillis(durationSeconds),
    leadingSilenceSeconds: 0,
    trailingSilenceSeconds: 0,
    rmsDb: null,
    lufsDb: null,
    introRmsDb: null,
    outroRmsDb: null,
    energyCurve: durationSeconds > 0 ? inferEnergyCurve(durationSeconds, 0, 0, introEndSeconds, outroStartSeconds) : [],
    bpm: bpm !== null && bpm >= 40 && bpm <= 260 ? bpm : null,
    beatOffsetMs: beatOffsetMs !== null && beatOffsetMs >= 0 ? beatOffsetMs : null,
    beatConfidence: beatConfidence !== null ? clamp(beatConfidence, 0, 1) : null,
  };
};

export const normalizeAutomixAnalysis = (
  analysis: TrackTransitionAnalysis | null | undefined,
  probe: AutomixProbeLike,
  hint: AutomixAnalysisHint | null = null,
): TrackTransitionAnalysis => {
  const estimated = createEstimatedAutomixAnalysis(probe, hint);
  if (!analysis) {
    return estimated;
  }

  const durationSeconds = normalizeDuration(analysis.durationSeconds || probe.durationSeconds || estimated.durationSeconds);
  if (durationSeconds <= 0) {
    return {
      ...estimated,
      status: 'unavailable',
      durationSeconds: 0,
    };
  }

  const leadingSilenceSeconds = normalizeSilence(analysis.leadingSilenceSeconds, durationSeconds, 0.2);
  const trailingSilenceSeconds = normalizeSilence(analysis.trailingSilenceSeconds, durationSeconds, 0.2);
  const introStartSeconds = clamp(finiteOrNull(analysis.introStartSeconds) ?? leadingSilenceSeconds, 0, durationSeconds);
  const introEndSeconds = clamp(
    finiteOrNull(analysis.introEndSeconds) ?? Math.max(introStartSeconds, leadingSilenceSeconds + 8),
    introStartSeconds,
    durationSeconds,
  );
  const outroEndSeconds = clamp(
    finiteOrNull(analysis.outroEndSeconds) ?? Math.max(0, durationSeconds - trailingSilenceSeconds),
    0,
    durationSeconds,
  );
  const outroStartSeconds = clamp(
    finiteOrNull(analysis.outroStartSeconds) ?? Math.max(0, outroEndSeconds - 18),
    0,
    outroEndSeconds,
  );
  const bpm = finiteOrNull(analysis.bpm) ?? estimated.bpm;
  const beatConfidence = finiteOrNull(analysis.beatConfidence) ?? estimated.beatConfidence;
  const beatOffsetMs = finiteOrNull(analysis.beatOffsetMs) ?? estimated.beatOffsetMs;
  const energyCurve = normalizeEnergyCurve(analysis.energyCurve);

  return {
    status: analysis.status ?? estimated.status,
    durationSeconds,
    introStartSeconds: roundToMillis(introStartSeconds),
    introEndSeconds: roundToMillis(introEndSeconds),
    outroStartSeconds: roundToMillis(outroStartSeconds),
    outroEndSeconds: roundToMillis(outroEndSeconds),
    leadingSilenceSeconds: roundToMillis(leadingSilenceSeconds),
    trailingSilenceSeconds: roundToMillis(trailingSilenceSeconds),
    rmsDb: finiteOrNull(analysis.rmsDb),
    lufsDb: finiteOrNull(analysis.lufsDb),
    introRmsDb: finiteOrNull(analysis.introRmsDb),
    outroRmsDb: finiteOrNull(analysis.outroRmsDb),
    energyCurve: energyCurve.length ? energyCurve : estimated.energyCurve,
    bpm: bpm !== null && bpm >= 40 && bpm <= 260 ? bpm : null,
    beatOffsetMs: beatOffsetMs !== null && beatOffsetMs >= 0 ? beatOffsetMs : null,
    beatConfidence: beatConfidence !== null ? clamp(beatConfidence, 0, 1) : null,
    analyzedAt: analysis.analyzedAt,
  };
};

const normalizeBpmForMatch = (bpm: number): number => {
  let normalized = bpm;
  while (normalized < 80) {
    normalized *= 2;
  }
  while (normalized > 180) {
    normalized /= 2;
  }
  return normalized;
};

const reliableBpm = (analysis: TrackTransitionAnalysis): number | null => {
  const bpm = finiteOrNull(analysis.bpm);
  const confidence = finiteOrNull(analysis.beatConfidence);
  if (bpm === null || bpm < 60 || bpm > 220) {
    return null;
  }

  return confidence === null || confidence >= 0.68 ? bpm : null;
};

const areBpmsCompatible = (currentBpm: number, nextBpm: number): boolean => {
  const current = normalizeBpmForMatch(currentBpm);
  const next = normalizeBpmForMatch(nextBpm);
  return Math.abs(current - next) / Math.max(1, Math.max(current, next)) <= 0.055;
};

const resolveTempoRatio = (currentBpm: number | null, nextBpm: number | null, beatAligned: boolean): number => {
  if (!beatAligned || currentBpm === null || nextBpm === null) {
    return 1;
  }

  const current = normalizeBpmForMatch(currentBpm);
  const next = normalizeBpmForMatch(nextBpm);
  if (!Number.isFinite(current) || !Number.isFinite(next) || next <= 0) {
    return 1;
  }

  return roundToMillis(clamp(current / next, minAutomixTempoRatio, maxAutomixTempoRatio));
};

const hasUsableEnergyCurve = (analysis: TrackTransitionAnalysis): boolean => {
  if (analysis.status === 'unavailable' || analysis.energyCurve.length < 6) {
    return false;
  }

  const minimum = Math.min(...analysis.energyCurve);
  const maximum = Math.max(...analysis.energyCurve);
  return maximum - minimum >= 0.08 || maximum >= 0.3;
};

const quantizeOverlapToBars = (seconds: number, bpm: number, maximumSeconds: number): number => {
  const barSeconds = (60 / normalizeBpmForMatch(bpm)) * 4;
  if (!Number.isFinite(barSeconds) || barSeconds <= 0) {
    return seconds;
  }

  const bars = clamp(Math.round(seconds / barSeconds), 1, 8);
  return clamp(bars * barSeconds, 2, maximumSeconds);
};

const alignToBar = (seconds: number, bpm: number, beatOffsetMs: number | null, minimum: number, maximum: number): number => {
  const barSeconds = (60 / normalizeBpmForMatch(bpm)) * 4;
  if (!Number.isFinite(barSeconds) || barSeconds <= 0 || maximum <= minimum) {
    return clamp(seconds, minimum, maximum);
  }

  const offsetSeconds = Math.max(0, (beatOffsetMs ?? 0) / 1000);
  const barIndex = Math.round((seconds - offsetSeconds) / barSeconds);
  return clamp(offsetSeconds + barIndex * barSeconds, minimum, maximum);
};

const selectNextEntryEnergyBuckets = (analysis: TrackTransitionAnalysis, nextStartSeconds: number): number[] => {
  if (nextStartSeconds <= 0 || analysis.energyCurve.length < 8 || analysis.durationSeconds <= 0) {
    return analysis.energyCurve.slice(0, 4);
  }

  const headBucketCount = Math.max(4, Math.min(analysis.energyCurve.length, Math.ceil(analysis.energyCurve.length * 0.42)));
  const introWindowSeconds = clamp(
    analysis.introEndSeconds > analysis.introStartSeconds
      ? analysis.introEndSeconds - analysis.introStartSeconds
      : analysis.durationSeconds * 0.12,
    4,
    Math.min(36, analysis.durationSeconds * 0.25),
  );
  const rawIndex = Math.floor((nextStartSeconds / Math.max(1, introWindowSeconds)) * headBucketCount);
  const startIndex = clamp(rawIndex, 0, Math.max(0, headBucketCount - 1));
  return analysis.energyCurve.slice(startIndex, Math.min(headBucketCount, startIndex + 4));
};

const selectEnergyOverlap = (
  baseSeconds: number,
  currentAnalysis: TrackTransitionAnalysis,
  nextAnalysis: TrackTransitionAnalysis,
  nextStartSeconds: number,
): number => {
  const currentTail = currentAnalysis.energyCurve.slice(Math.max(0, currentAnalysis.energyCurve.length - 4));
  const nextHead = selectNextEntryEnergyBuckets(nextAnalysis, nextStartSeconds);
  const currentEnergy = currentTail.length ? currentTail.reduce((sum, value) => sum + value, 0) / currentTail.length : 0.5;
  const nextEnergy = nextHead.length ? nextHead.reduce((sum, value) => sum + value, 0) / nextHead.length : 0.5;
  const energyDelta = Math.abs(currentEnergy - nextEnergy);
  const deltaAdjustment = energyDelta > 0.35 ? -1.5 : energyDelta < 0.16 ? 1.2 : 0;

  return baseSeconds + deltaAdjustment;
};

const estimateLowEnergyIntroSkipSeconds = (analysis: TrackTransitionAnalysis): number => {
  if (analysis.status === 'unavailable' || analysis.energyCurve.length < 8 || analysis.durationSeconds <= 0) {
    return 0;
  }

  const headBucketCount = Math.max(4, Math.min(analysis.energyCurve.length, Math.ceil(analysis.energyCurve.length * 0.42)));
  const headBuckets = analysis.energyCurve.slice(0, headBucketCount);
  const minimum = Math.min(...headBuckets);
  const peak = Math.max(...headBuckets);
  if (peak < 0.44 || peak - minimum < 0.18) {
    return 0;
  }

  const threshold = Math.max(0.4, peak * 0.58);
  const firstStrongBucket = headBuckets.findIndex((value) => value >= threshold);
  if (firstStrongBucket < 2) {
    return 0;
  }

  const introWindowSeconds = clamp(
    analysis.introEndSeconds > analysis.introStartSeconds
      ? analysis.introEndSeconds - analysis.introStartSeconds
      : analysis.durationSeconds * 0.12,
    4,
    Math.min(36, analysis.durationSeconds * 0.25),
  );
  const rawSkipSeconds = (firstStrongBucket / headBucketCount) * introWindowSeconds - 0.25;
  return roundToMillis(clamp(rawSkipSeconds, 0, Math.min(maxLowEnergyIntroSkipSeconds, introWindowSeconds - 0.4, analysis.durationSeconds * 0.18)));
};

const estimateLowEnergyOutroTrimSeconds = (analysis: TrackTransitionAnalysis): number => {
  if (analysis.status === 'unavailable' || analysis.energyCurve.length < 8 || analysis.durationSeconds <= 0) {
    return 0;
  }

  const tailBucketCount = Math.max(4, Math.min(analysis.energyCurve.length, Math.ceil(analysis.energyCurve.length * 0.5)));
  const tailBuckets = analysis.energyCurve.slice(-tailBucketCount);
  const tailPeak = Math.max(...tailBuckets);
  const tailEnd = tailBuckets.at(-1) ?? tailPeak;
  const fallingTailThreshold =
    tailPeak - tailEnd >= 0.18
      ? Math.max(0.34, Math.min(0.52, tailPeak * 0.64))
      : 0.34;
  const outroWindowSeconds = clamp(
    analysis.outroEndSeconds > analysis.outroStartSeconds
      ? analysis.outroEndSeconds - analysis.outroStartSeconds
      : analysis.durationSeconds * 0.12,
    4,
    Math.min(36, analysis.durationSeconds * 0.25),
  );
  const bucketSeconds = outroWindowSeconds / tailBucketCount;
  let quietTailBuckets = 0;
  for (let index = tailBuckets.length - 1; index >= 0; index -= 1) {
    const energy = tailBuckets[index] ?? 0;
    if (energy > fallingTailThreshold) {
      break;
    }
    quietTailBuckets += 1;
  }

  if (quietTailBuckets === 0) {
    return 0;
  }

  const tailSeconds = quietTailBuckets * bucketSeconds;
  return clamp(tailSeconds - 1.5, 0, maxLowEnergyOutroTrimSeconds);
};

const resolveGainCompensation = (
  currentAnalysis: TrackTransitionAnalysis,
  nextAnalysis: TrackTransitionAnalysis,
): Pick<AutomixTransitionPlan, 'currentGainDb' | 'nextGainDb'> => {
  const currentLoudness =
    finiteOrNull(currentAnalysis.outroRmsDb) ??
    finiteOrNull(currentAnalysis.lufsDb) ??
    finiteOrNull(currentAnalysis.rmsDb);
  const nextLoudness =
    finiteOrNull(nextAnalysis.introRmsDb) ??
    finiteOrNull(nextAnalysis.lufsDb) ??
    finiteOrNull(nextAnalysis.rmsDb);
  if (currentLoudness === null || nextLoudness === null) {
    return {
      currentGainDb: 0,
      nextGainDb: 0,
    };
  }

  const delta = currentLoudness - nextLoudness;
  return {
    currentGainDb: roundToMillis(clamp(-Math.max(0, -delta) * 0.22, -3, 0)),
    nextGainDb: roundToMillis(clamp(delta * 0.62, -5.5, 3.5)),
  };
};

export const planAutomixTransition = (input: AutomixPlanInput): AutomixTransitionPlan | null => {
  const currentStartSeconds = Math.max(0, finiteOrNull(input.currentStartSeconds) ?? 0);
  const maxTransitionSeconds = clamp(
    finiteOrNull(input.maxTransitionSeconds) ?? defaultAutomixTransitionSeconds,
    2,
    maxAutomixTransitionSeconds,
  );
  const currentAnalysis = normalizeAutomixAnalysis(input.currentAnalysis, input.currentProbe, input.currentHint);
  const nextAnalysis = normalizeAutomixAnalysis(input.nextAnalysis, input.nextProbe, input.nextHint);
  const currentDuration = currentAnalysis.durationSeconds;
  const nextDuration = nextAnalysis.durationSeconds;
  if (currentDuration <= 0 || nextDuration <= 0) {
    return null;
  }

  const currentRemainingSeconds = currentDuration - currentStartSeconds;
  if (currentRemainingSeconds < minUsefulAutomixSeconds || nextDuration < minUsefulAutomixSeconds) {
    return null;
  }

  const currentTailTrim = Math.max(
    0,
    currentAnalysis.trailingSilenceSeconds - silenceTailPaddingSeconds,
    estimateLowEnergyOutroTrimSeconds(currentAnalysis),
  );
  const rawCurrentEndSeconds = currentDuration - currentTailTrim;
  let currentEndSeconds = clamp(rawCurrentEndSeconds, currentStartSeconds + 1.2, currentDuration);
  let nextStartSeconds = nextAnalysis.leadingSilenceSeconds > 0.16
    ? Math.max(0, nextAnalysis.leadingSilenceSeconds - silenceLeadInPaddingSeconds)
    : 0;
  nextStartSeconds = Math.max(nextStartSeconds, estimateLowEnergyIntroSkipSeconds(nextAnalysis));
  nextStartSeconds = clamp(nextStartSeconds, 0, Math.max(0, nextDuration - 1.2));

  const availableCurrentSeconds = Math.max(0, currentEndSeconds - currentStartSeconds);
  const availableNextSeconds = Math.max(0, nextDuration - nextStartSeconds);
  const shortTrackFallback = availableCurrentSeconds < 24 || availableNextSeconds < 24;
  const unavailableAnalysis = currentAnalysis.status === 'unavailable' || nextAnalysis.status === 'unavailable';
  const currentBpm = reliableBpm(currentAnalysis);
  const nextBpm = reliableBpm(nextAnalysis);
  const beatAligned =
    input.beatAlignEnabled !== false &&
    currentBpm !== null &&
    nextBpm !== null &&
    areBpmsCompatible(currentBpm, nextBpm) &&
    availableCurrentSeconds >= 8 &&
    availableNextSeconds >= 8;
  const energyReady = hasUsableEnergyCurve(currentAnalysis) && hasUsableEnergyCurve(nextAnalysis);
  let mode: AutomixTransitionMode = 'smartCrossfade';
  let fallbackReason: string | null = null;
  if (shortTrackFallback || unavailableAnalysis) {
    mode = 'gaplessFallback';
    fallbackReason = shortTrackFallback ? 'short_track' : 'analysis_unavailable';
  } else if (beatAligned) {
    mode = 'beatAligned';
  } else if (energyReady) {
    mode = 'energyFade';
  }

  const nominalOverlap = shortTrackFallback || unavailableAnalysis
    ? Math.min(2.5, Math.max(1.1, Math.min(availableCurrentSeconds, availableNextSeconds) * 0.28))
    : Math.min(
        maxTransitionSeconds,
        clamp(availableCurrentSeconds * 0.34, 7, maxTransitionSeconds),
        clamp(availableNextSeconds * 0.24, 7, maxTransitionSeconds),
      );
  let overlapSeconds = nominalOverlap;
  if (mode === 'beatAligned' && currentBpm !== null) {
    overlapSeconds = quantizeOverlapToBars(nominalOverlap, currentBpm, maxTransitionSeconds);
  } else if (mode === 'energyFade') {
    overlapSeconds = selectEnergyOverlap(nominalOverlap, currentAnalysis, nextAnalysis, nextStartSeconds);
  }
  overlapSeconds = clamp(overlapSeconds, shortTrackFallback || unavailableAnalysis ? 0.8 : 2, Math.min(maxTransitionSeconds, availableCurrentSeconds - 0.4, availableNextSeconds - 0.4));
  if (!Number.isFinite(overlapSeconds) || overlapSeconds <= 0) {
    return null;
  }

  let currentFadeStartSeconds = currentEndSeconds - overlapSeconds;
  if (mode === 'beatAligned' && currentBpm !== null) {
    const alignedFadeStart = alignToBar(
      currentFadeStartSeconds,
      currentBpm,
      currentAnalysis.beatOffsetMs,
      currentStartSeconds,
      Math.max(currentStartSeconds, currentEndSeconds - overlapSeconds),
    );
    currentFadeStartSeconds = alignedFadeStart;
    currentEndSeconds = Math.min(currentDuration, currentFadeStartSeconds + overlapSeconds);
    if (nextBpm !== null) {
      nextStartSeconds = alignToBar(
        nextStartSeconds,
        nextBpm,
        nextAnalysis.beatOffsetMs,
        nextStartSeconds,
        Math.max(0, Math.min(nextDuration - overlapSeconds - 0.4, nextStartSeconds + (60 / normalizeBpmForMatch(nextBpm)) * 4)),
      );
    }
  }

  const skipIntroSilence = nextStartSeconds > 0.12;
  const gains = resolveGainCompensation(currentAnalysis, nextAnalysis);
  const tempoRatio = resolveTempoRatio(currentBpm, nextBpm, mode === 'beatAligned');

  return {
    mode,
    currentStartSeconds: roundToMillis(currentStartSeconds),
    currentEndSeconds: roundToMillis(currentEndSeconds),
    currentFadeStartSeconds: roundToMillis(currentFadeStartSeconds),
    nextStartSeconds: roundToMillis(nextStartSeconds),
    overlapSeconds: roundToMillis(overlapSeconds),
    curve: mode === 'gaplessFallback' ? 'qsin' : 'hsin',
    currentGainDb: gains.currentGainDb,
    nextGainDb: gains.nextGainDb,
    tempoRatio,
    advanceAtSeconds: roundToMillis(currentFadeStartSeconds),
    skipIntroSilence,
    beatAligned: mode === 'beatAligned',
    fallbackReason,
  };
};
