import {
  automixTransitionPlanVersion,
  type AutomixAnalysisV2,
  type AutomixTransitionModeV2,
  type AutomixTransitionPlanV2,
} from '../../shared/types/automix';

export type AutomixPlanV2Input = {
  queueRevision: number;
  fromItemId: string;
  fromTrackId: string;
  toItemId: string;
  toTrackId: string;
  mixSampleRate: number;
  currentOutputFrame: number;
  currentSourcePositionSeconds: number;
  currentAnalysis: AutomixAnalysisV2 | null;
  nextAnalysis: AutomixAnalysisV2 | null;
  currentIsDsd?: boolean;
  nextIsDsd?: boolean;
  playbackRate?: number;
  maxTransitionSeconds?: number;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
const roundMillis = (value: number): number => Math.round(value * 1000) / 1000;

const normalizeBpm = (value: number): number => {
  let bpm = value;
  while (bpm < 80) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return bpm;
};

const keyCompatible = (left: AutomixAnalysisV2['key'], right: AutomixAnalysisV2['key']): boolean => {
  if (!left || !right || left.confidence < 0.15 || right.confidence < 0.15) {
    return false;
  }
  const parse = (value: string): { number: number; ring: string } | null => {
    const match = /^(\d{1,2})([AB])$/u.exec(value);
    return match ? { number: Number(match[1]), ring: match[2] } : null;
  };
  const a = parse(left.camelot);
  const b = parse(right.camelot);
  if (!a || !b) return false;
  const distance = Math.min(Math.abs(a.number - b.number), 12 - Math.abs(a.number - b.number));
  return (a.ring === b.ring && distance <= 1) || (a.number === b.number && a.ring !== b.ring);
};

const selectPhraseBoundary = (
  analysis: AutomixAnalysisV2,
  earliest: number,
  preferred: number,
  latest: number,
): number => {
  const candidates = analysis.phraseBoundaries
    .filter((boundary) => boundary.seconds >= earliest && boundary.seconds <= latest)
    .sort((left, right) => {
      const distance = Math.abs(left.seconds - preferred) - Math.abs(right.seconds - preferred);
      return distance !== 0 ? distance : right.confidence - left.confidence;
    });
  return candidates[0]?.seconds ?? clamp(preferred, earliest, latest);
};

const fallbackPlan = (
  input: AutomixPlanV2Input,
  reason: string,
  mode: AutomixTransitionModeV2 = 'gapless_fallback',
): AutomixTransitionPlanV2 => {
  const sampleRate = Math.max(8000, Math.round(input.mixSampleRate));
  const currentDuration = input.currentAnalysis?.durationSeconds ?? input.currentSourcePositionSeconds;
  const remaining = Math.max(0, currentDuration - input.currentSourcePositionSeconds);
  const overlapSeconds = mode === 'short_crossfade' ? clamp(remaining * 0.2, 1, 3) : 0;
  const fadeStart = input.currentOutputFrame + Math.max(0, Math.round((remaining - overlapSeconds) * sampleRate));
  const overlapFrames = Math.max(mode === 'gapless_fallback' ? 1 : 2, Math.round(overlapSeconds * sampleRate));
  return {
    version: automixTransitionPlanVersion,
    planId: `${input.queueRevision}:${input.fromItemId}:${input.toItemId}:${fadeStart}`,
    queueRevision: input.queueRevision,
    fromItemId: input.fromItemId,
    fromTrackId: input.fromTrackId,
    toItemId: input.toItemId,
    toTrackId: input.toTrackId,
    mixSampleRate: sampleRate,
    mode,
    currentStartSeconds: roundMillis(input.currentSourcePositionSeconds),
    currentEndSeconds: roundMillis(currentDuration),
    fadeStartOutputFrame: fadeStart,
    fadeEndOutputFrame: fadeStart + overlapFrames,
    commitOutputFrame: fadeStart + Math.floor(overlapFrames / 2),
    nextStartSeconds: 0,
    overlapFrames,
    currentGainDb: 0,
    nextGainDb: 0,
    tempoRatio: 1,
    fallbackReason: reason,
  };
};

export const planAutomixTransitionV2 = (input: AutomixPlanV2Input): AutomixTransitionPlanV2 => {
  if (input.currentIsDsd || input.nextIsDsd) {
    return fallbackPlan(input, 'dsd_direct');
  }
  if (Math.abs((input.playbackRate ?? 1) - 1) > 0.0001) {
    return fallbackPlan(input, 'playback_rate_active');
  }
  const current = input.currentAnalysis;
  const next = input.nextAnalysis;
  if (!current || !next || current.status === 'error' || next.status === 'error'
      || current.status === 'unavailable' || next.status === 'unavailable') {
    return fallbackPlan(input, 'analysis_unavailable', 'short_crossfade');
  }
  const remaining = current.durationSeconds - input.currentSourcePositionSeconds;
  if (remaining < 4 || next.durationSeconds < 4) {
    return fallbackPlan(input, 'short_track', 'short_crossfade');
  }

  const sampleRate = Math.max(8000, Math.round(input.mixSampleRate));
  const maxTransition = clamp(input.maxTransitionSeconds ?? 16, 2, 16);
  const currentBpm = current.bpm !== null && (current.bpmConfidence ?? 0) >= 0.68
    ? normalizeBpm(current.bpm)
    : null;
  const nextBpm = next.bpm !== null && (next.bpmConfidence ?? 0) >= 0.68
    ? normalizeBpm(next.bpm)
    : null;
  const rawTempoRatio = currentBpm !== null && nextBpm !== null ? currentBpm / nextBpm : 1;
  const canBeatMatch = current.status === 'complete'
    && next.status === 'complete'
    && currentBpm !== null
    && nextBpm !== null
    && rawTempoRatio >= 0.985
    && rawTempoRatio <= 1.015
    && keyCompatible(current.key, next.key);
  const mode: AutomixTransitionModeV2 = canBeatMatch ? 'beat_match' : 'phrase_crossfade';
  const beatBarSeconds = currentBpm !== null ? (60 / currentBpm) * 4 : 2;
  const overlapSeconds = canBeatMatch
    ? clamp(beatBarSeconds * Math.max(1, Math.round(Math.min(maxTransition, 8 * beatBarSeconds) / beatBarSeconds)), 4, maxTransition)
    : clamp(Math.min(maxTransition, remaining * 0.22, next.durationSeconds * 0.18), 4, maxTransition);
  const preferredEnd = current.durationSeconds - Math.max(0, current.trailingSilenceSeconds - 0.08);
  const fadeEndSeconds = selectPhraseBoundary(
    current,
    input.currentSourcePositionSeconds + overlapSeconds + 0.5,
    preferredEnd,
    current.durationSeconds,
  );
  const fadeStartSourceSeconds = Math.max(input.currentSourcePositionSeconds, fadeEndSeconds - overlapSeconds);
  const fadeStartOutputFrame = input.currentOutputFrame
    + Math.round((fadeStartSourceSeconds - input.currentSourcePositionSeconds) * sampleRate);
  const overlapFrames = Math.max(2, Math.round(overlapSeconds * sampleRate));
  const nextStartSeconds = clamp(next.leadingSilenceSeconds > 0.16 ? next.leadingSilenceSeconds - 0.04 : 0, 0, 12);
  const loudnessDelta = current.integratedLufs !== null && next.integratedLufs !== null
    ? current.integratedLufs - next.integratedLufs
    : 0;
  const nextGainDb = clamp(loudnessDelta * 0.5, -5.5, 3.5);

  return {
    version: automixTransitionPlanVersion,
    planId: `${input.queueRevision}:${input.fromItemId}:${input.toItemId}:${fadeStartOutputFrame}`,
    queueRevision: input.queueRevision,
    fromItemId: input.fromItemId,
    fromTrackId: input.fromTrackId,
    toItemId: input.toItemId,
    toTrackId: input.toTrackId,
    mixSampleRate: sampleRate,
    mode,
    currentStartSeconds: roundMillis(input.currentSourcePositionSeconds),
    currentEndSeconds: roundMillis(fadeEndSeconds),
    fadeStartOutputFrame,
    fadeEndOutputFrame: fadeStartOutputFrame + overlapFrames,
    commitOutputFrame: fadeStartOutputFrame + Math.floor(overlapFrames / 2),
    nextStartSeconds: roundMillis(nextStartSeconds),
    overlapFrames,
    currentGainDb: 0,
    nextGainDb: roundMillis(nextGainDb),
    tempoRatio: canBeatMatch ? roundMillis(rawTempoRatio) : 1,
    fallbackReason: canBeatMatch ? null : 'beat_or_key_incompatible',
  };
};
