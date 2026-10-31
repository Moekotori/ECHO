import { describe, expect, it } from 'vitest';
import {
  createEstimatedAutomixAnalysis,
  planAutomixTransition,
  type TrackTransitionAnalysis,
} from './AutomixPlanner';

const makeAnalysis = (patch: Partial<TrackTransitionAnalysis> = {}): TrackTransitionAnalysis => {
  const durationSeconds = patch.durationSeconds ?? 180;
  return {
    status: 'complete',
    durationSeconds,
    introStartSeconds: 0,
    introEndSeconds: 12,
    outroStartSeconds: Math.max(0, durationSeconds - 24),
    outroEndSeconds: durationSeconds,
    leadingSilenceSeconds: 0,
    trailingSilenceSeconds: 0,
    rmsDb: -16,
    lufsDb: -16,
    energyCurve: [0.12, 0.35, 0.64, 0.76, 0.82, 0.78, 0.72, 0.68, 0.61, 0.55, 0.48, 0.41],
    bpm: 124,
    beatOffsetMs: 0,
    beatConfidence: 0.9,
    ...patch,
  };
};

describe('AutomixPlanner', () => {
  it('gives estimated analyses a conservative intro and outro energy shape', () => {
    const analysis = createEstimatedAutomixAnalysis({ durationSeconds: 240 });

    expect(analysis.energyCurve[0]).toBeLessThan(analysis.energyCurve[4] ?? 0);
    expect(analysis.energyCurve.at(-1)).toBeLessThan(analysis.energyCurve[8] ?? 0);
  });

  it('skips next-track intro silence and trims current trailing silence before a beat-aligned transition', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 180 },
      nextProbe: { durationSeconds: 210 },
      currentAnalysis: makeAnalysis({ trailingSilenceSeconds: 3.4, bpm: 124, beatConfidence: 0.93 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 210, leadingSilenceSeconds: 2.5, bpm: 123.5, beatConfidence: 0.91 }),
      maxTransitionSeconds: 12,
      beatAlignEnabled: true,
    });

    expect(plan).not.toBeNull();
    expect(plan?.mode).toBe('beatAligned');
    expect(plan?.beatAligned).toBe(true);
    expect(plan?.skipIntroSilence).toBe(true);
    expect(plan?.nextStartSeconds).toBeGreaterThanOrEqual(2.46);
    expect(plan?.currentEndSeconds).toBeLessThan(180);
    expect(plan?.overlapSeconds).toBeGreaterThanOrEqual(7);
    expect(plan?.curve).toBe('hsin');
  });

  it('keeps beat-aligned tempo nudges subtle enough for full-track playback', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 180 },
      nextProbe: { durationSeconds: 180 },
      currentAnalysis: makeAnalysis({ bpm: 128, beatConfidence: 0.94 }),
      nextAnalysis: makeAnalysis({ bpm: 122, beatConfidence: 0.94 }),
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('beatAligned');
    expect(plan?.tempoRatio).toBeLessThanOrEqual(1.015);
  });

  it('uses energyFade when beat confidence is weak but energy curves are available', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 160 },
      nextProbe: { durationSeconds: 170 },
      currentAnalysis: makeAnalysis({ durationSeconds: 160, bpm: 118, beatConfidence: 0.31 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 170, bpm: 146, beatConfidence: 0.2, rmsDb: -20, lufsDb: -20 }),
      maxTransitionSeconds: 10,
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.beatAligned).toBe(false);
    expect(plan?.nextGainDb).toBeGreaterThan(0);
    expect(plan?.fallbackReason).toBeNull();
  });

  it('uses a longer default overlap for full-length energy transitions', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 240 },
      nextProbe: { durationSeconds: 240 },
      currentAnalysis: makeAnalysis({ durationSeconds: 240, bpm: 102, beatConfidence: 0.3 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 240, bpm: 149, beatConfidence: 0.3 }),
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.overlapSeconds).toBeGreaterThan(12);
    expect(plan?.overlapSeconds).toBeLessThanOrEqual(16);
  });

  it('uses estimated energy shape for a first-play Automix plan before cached analysis exists', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 240 },
      nextProbe: { durationSeconds: 240 },
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.currentEndSeconds).toBeLessThan(240);
    expect(plan?.nextStartSeconds).toBeGreaterThan(0);
    expect(plan?.overlapSeconds).toBeGreaterThan(12);
  });

  it('skips a low-energy next-track intro so Automix enters on the audible section', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 180 },
      nextProbe: { durationSeconds: 180 },
      currentAnalysis: makeAnalysis({ durationSeconds: 180, bpm: 108, beatConfidence: 0.32 }),
      nextAnalysis: makeAnalysis({
        durationSeconds: 180,
        bpm: 148,
        beatConfidence: 0.28,
        introEndSeconds: 24,
        energyCurve: [0.04, 0.08, 0.16, 0.24, 0.62, 0.76, 0.82, 0.78, 0.7, 0.66, 0.6, 0.55],
      }),
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.nextStartSeconds).toBeGreaterThanOrEqual(10);
    expect(plan?.skipIntroSilence).toBe(true);
    expect(plan?.overlapSeconds).toBeGreaterThan(12);
  });

  it('sizes energy overlap from the skipped intro entry point instead of the quiet opening', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 220 },
      nextProbe: { durationSeconds: 220 },
      currentAnalysis: makeAnalysis({
        durationSeconds: 220,
        bpm: 104,
        beatConfidence: 0.24,
        energyCurve: [0.2, 0.42, 0.68, 0.76, 0.82, 0.86, 0.84, 0.82, 0.8, 0.78, 0.78, 0.76],
      }),
      nextAnalysis: makeAnalysis({
        durationSeconds: 220,
        bpm: 151,
        beatConfidence: 0.22,
        introEndSeconds: 28,
        energyCurve: [0.02, 0.04, 0.08, 0.14, 0.72, 0.84, 0.86, 0.82, 0.78, 0.74, 0.7, 0.68],
      }),
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.nextStartSeconds).toBeGreaterThanOrEqual(12);
    expect(plan?.overlapSeconds).toBe(16);
  });

  it('can skip a longer low-energy intro when the strong entry is obvious', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 240 },
      nextProbe: { durationSeconds: 240 },
      currentAnalysis: makeAnalysis({ durationSeconds: 240, bpm: 106, beatConfidence: 0.22 }),
      nextAnalysis: makeAnalysis({
        durationSeconds: 240,
        bpm: 152,
        beatConfidence: 0.2,
        introEndSeconds: 36,
        energyCurve: [0.02, 0.03, 0.05, 0.08, 0.14, 0.72, 0.84, 0.86, 0.82, 0.78, 0.72, 0.66],
      }),
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.nextStartSeconds).toBeGreaterThan(24);
    expect(plan?.nextStartSeconds).toBeLessThanOrEqual(30);
    expect(plan?.skipIntroSilence).toBe(true);
  });

  it('falls back to a short gapless fade for short tracks', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 18 },
      nextProbe: { durationSeconds: 32 },
      currentAnalysis: makeAnalysis({ durationSeconds: 18, bpm: 128, beatConfidence: 0.9 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 32, bpm: 128, beatConfidence: 0.9 }),
      maxTransitionSeconds: 12,
      beatAlignEnabled: true,
    });

    expect(plan?.mode).toBe('gaplessFallback');
    expect(plan?.fallbackReason).toBe('short_track');
    expect(plan?.overlapSeconds).toBeLessThanOrEqual(2.5);
    expect(plan?.curve).toBe('qsin');
  });

  it('moves the transition before a weak fade-out tail', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 180 },
      nextProbe: { durationSeconds: 180 },
      currentAnalysis: makeAnalysis({
        durationSeconds: 180,
        bpm: 111,
        beatConfidence: 0.25,
        energyCurve: [0.2, 0.55, 0.78, 0.86, 0.8, 0.72, 0.65, 0.5, 0.28, 0.16, 0.09, 0.04],
      }),
      nextAnalysis: makeAnalysis({ durationSeconds: 180, bpm: 142, beatConfidence: 0.25 }),
      maxTransitionSeconds: 12,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.currentEndSeconds).toBeLessThanOrEqual(168);
    expect(plan?.overlapSeconds).toBeGreaterThanOrEqual(7);
  });

  it('treats a steadily falling outro as a useful Automix handoff point before it becomes silent', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 210 },
      nextProbe: { durationSeconds: 210 },
      currentAnalysis: makeAnalysis({
        durationSeconds: 210,
        bpm: 112,
        beatConfidence: 0.24,
        energyCurve: [0.3, 0.58, 0.82, 0.86, 0.84, 0.8, 0.74, 0.68, 0.6, 0.53, 0.46, 0.39],
      }),
      nextAnalysis: makeAnalysis({ durationSeconds: 210, bpm: 145, beatConfidence: 0.25 }),
      maxTransitionSeconds: 16,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.currentEndSeconds).toBeLessThan(210);
    expect(plan?.currentEndSeconds).toBeLessThanOrEqual(204);
    expect(plan?.overlapSeconds).toBeGreaterThan(12);
  });

  it('returns null when there is not enough remaining audio to build a transition', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 120 },
      nextProbe: { durationSeconds: 120 },
      currentStartSeconds: 117,
      currentAnalysis: makeAnalysis({ durationSeconds: 120 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 120 }),
      maxTransitionSeconds: 12,
    });

    expect(plan).toBeNull();
  });

  it('clamps loudness compensation to avoid abrupt level jumps', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 140 },
      nextProbe: { durationSeconds: 140 },
      currentAnalysis: makeAnalysis({ durationSeconds: 140, rmsDb: -12, lufsDb: -12, bpm: 110, beatConfidence: 0.25 }),
      nextAnalysis: makeAnalysis({ durationSeconds: 140, rmsDb: -2, lufsDb: -2, bpm: 150, beatConfidence: 0.25 }),
      maxTransitionSeconds: 12,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.nextGainDb).toBe(-5.5);
    expect(plan?.currentGainDb).toBeLessThanOrEqual(0);
  });

  it('matches transition loudness from the current outro into the next intro', () => {
    const plan = planAutomixTransition({
      currentProbe: { durationSeconds: 180 },
      nextProbe: { durationSeconds: 180 },
      currentAnalysis: makeAnalysis({
        durationSeconds: 180,
        rmsDb: -12,
        lufsDb: -12,
        outroRmsDb: -18,
        bpm: 118,
        beatConfidence: 0.25,
      }),
      nextAnalysis: makeAnalysis({
        durationSeconds: 180,
        rmsDb: -10,
        lufsDb: -10,
        introRmsDb: -30,
        bpm: 146,
        beatConfidence: 0.25,
      }),
      maxTransitionSeconds: 12,
    });

    expect(plan?.mode).toBe('energyFade');
    expect(plan?.nextGainDb).toBeGreaterThan(0);
  });
});
