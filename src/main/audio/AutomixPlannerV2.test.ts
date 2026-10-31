import { describe, expect, it } from 'vitest';
import {
  automixAnalysisVersion,
  resolveAutomixRuntimePhase,
  type AutomixAnalysisV2,
} from '../../shared/types/automix';
import { planAutomixTransitionV2 } from './AutomixPlannerV2';

const analysis = (
  overrides: Partial<AutomixAnalysisV2> = {},
): AutomixAnalysisV2 => ({
  version: automixAnalysisVersion,
  fingerprint: 'fixture',
  status: 'complete',
  durationSeconds: 180,
  bpm: 120,
  bpmConfidence: 0.95,
  beatOffsetMs: 0,
  beatGridSeconds: [],
  downbeatGridSeconds: [],
  phraseBoundaries: [
    { seconds: 160, bars: 16, confidence: 0.92 },
    { seconds: 176, bars: 8, confidence: 0.84 },
  ],
  key: {
    tonic: 9,
    mode: 'minor',
    camelot: '8A',
    confidence: 0.8,
    chroma: new Array<number>(12).fill(1 / 12),
  },
  leadingSilenceSeconds: 0.4,
  trailingSilenceSeconds: 0.2,
  integratedLufs: -14,
  segmentRmsDb: new Array<number>(18).fill(-14),
  energyCurve: new Array<number>(18).fill(0.7),
  analyzedAt: '2026-07-17T00:00:00.000Z',
  error: null,
  ...overrides,
});

const baseInput = {
  queueRevision: 12,
  fromItemId: 'queue-a',
  fromTrackId: 'track-a',
  toItemId: 'queue-b',
  toTrackId: 'track-b',
  mixSampleRate: 48_000,
  currentOutputFrame: 48_000,
  currentSourcePositionSeconds: 1,
  currentAnalysis: analysis(),
  nextAnalysis: analysis({ fingerprint: 'next', bpm: 119 }),
};

describe('AutomixPlannerV2', () => {
  it('defaults production opt-in playback to native beta while preserving the kill switch', () => {
    expect(resolveAutomixRuntimePhase(undefined)).toBe('native_beta');
    expect(resolveAutomixRuntimePhase('off')).toBe('off');
    expect(resolveAutomixRuntimePhase('unexpected', 'shadow')).toBe('shadow');
  });

  it('builds a deterministic, frame-exact beat-match plan for the exact next queue item', () => {
    const first = planAutomixTransitionV2(baseInput);
    const second = planAutomixTransitionV2(baseInput);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      mode: 'beat_match',
      queueRevision: 12,
      fromItemId: 'queue-a',
      toItemId: 'queue-b',
      mixSampleRate: 48_000,
      fallbackReason: null,
    });
    expect(first.tempoRatio).toBeGreaterThanOrEqual(0.985);
    expect(first.tempoRatio).toBeLessThanOrEqual(1.015);
    expect(first.fadeEndOutputFrame - first.fadeStartOutputFrame).toBe(first.overlapFrames);
    expect(first.commitOutputFrame).toBe(
      first.fadeStartOutputFrame + Math.floor(first.overlapFrames / 2),
    );
  });

  it('keeps queue identity but degrades to phrase crossfade for incompatible keys', () => {
    const plan = planAutomixTransitionV2({
      ...baseInput,
      nextAnalysis: analysis({
        fingerprint: 'next',
        key: {
          tonic: 1,
          mode: 'major',
          camelot: '3B',
          confidence: 0.9,
          chroma: new Array<number>(12).fill(1 / 12),
        },
      }),
    });

    expect(plan.mode).toBe('phrase_crossfade');
    expect(plan.toItemId).toBe('queue-b');
    expect(plan.tempoRatio).toBe(1);
    expect(plan.fallbackReason).toBe('beat_or_key_incompatible');
  });

  it('uses an explicit short-crossfade fallback when analysis is unavailable', () => {
    const plan = planAutomixTransitionV2({
      ...baseInput,
      nextAnalysis: analysis({ status: 'unavailable', error: 'not_analyzed' }),
    });

    expect(plan.mode).toBe('short_crossfade');
    expect(plan.fallbackReason).toBe('analysis_unavailable');
    expect(plan.overlapFrames).toBeGreaterThanOrEqual(48_000);
    expect(plan.overlapFrames).toBeLessThanOrEqual(48_000 * 3);
  });

  it('bypasses DSD without selecting a later queue item', () => {
    const plan = planAutomixTransitionV2({ ...baseInput, nextIsDsd: true });

    expect(plan.mode).toBe('gapless_fallback');
    expect(plan.fallbackReason).toBe('dsd_direct');
    expect(plan.toItemId).toBe('queue-b');
  });
});
