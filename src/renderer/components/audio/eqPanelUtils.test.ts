import { describe, expect, it } from 'vitest';
import type { ChannelBalanceState } from '../../../shared/types/audio';
import type { EqState } from '../../../shared/types/eq';
import {
  captureEqSnapshot,
  clampChannelBalancePatch,
  computeAutoGainPreamp,
  computeEffectiveChannelGains,
  computeEqResponseGainDbAtFrequency,
  computeEqSpectrumBars,
  computeEqCurvePoints,
  computeEstimatedPeakGain,
  computeLoudnessMatchedPreamp,
  computeRecommendedPreamp,
  describePreset,
  formatFrequencyLabel,
  isEqFilterGainEditable,
  resolveBandFrequency,
} from './eqPanelUtils';

const eqState = (gains: number[]): EqState => ({
  enabled: true,
  preampDb: 0,
  presetId: 'custom',
  presetName: 'Custom',
  clippingRisk: false,
  bands: gains.map((gainDb, index) => ({
    frequencyHz: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][index] ?? 1000,
    gainDb,
    q: 1,
    filterType: 'peaking' as const,
    enabled: true,
  })),
});

describe('eqPanelUtils', () => {
  it('computes safe recommended preamp from positive band gain', () => {
    expect(computeRecommendedPreamp(eqState([0, 0, 0]))).toBe(0);
    expect(computeRecommendedPreamp(eqState([0, 6, -2]))).toBe(-6);
    expect(computeRecommendedPreamp(eqState([12, 4, 0]))).toBe(-12);
    expect(computeRecommendedPreamp(eqState([-4, -2, -8]))).toBe(0);
  });

  it('formats graphic EQ frequency labels', () => {
    expect(formatFrequencyLabel(1000)).toBe('1k');
    expect(formatFrequencyLabel(16000)).toBe('16k');
    expect(formatFrequencyLabel(62)).toBe('62');
  });

  it('computes bounded curve points', () => {
    const points = computeEqCurvePoints(eqState([12, 0, -12]).bands);

    expect(points.length).toBeGreaterThan(0);
    points.forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    });
  });

  it('keeps curve points finite at boundary frequencies and extreme Q values', () => {
    const points = computeEqCurvePoints([
      { frequencyHz: 20, gainDb: 12, q: 12, filterType: 'peaking', enabled: true },
      { frequencyHz: 20000, gainDb: 0, q: 0.1, filterType: 'lowPass', enabled: true },
      { frequencyHz: 20, gainDb: 0, q: 12, filterType: 'highPass', enabled: true },
      { frequencyHz: 20000, gainDb: 0, q: 12, filterType: 'notch', enabled: true },
    ]);

    expect(points.length).toBeGreaterThan(64);
    points.forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    });
  });

  it('sanitizes visual spectrum values for the EQ analyzer overlay', () => {
    expect(computeEqSpectrumBars(undefined)).toEqual([]);
    expect(computeEqSpectrumBars([0, 0.5, 2, Number.NaN])).toEqual([
      { x: 0, value: 0 },
      { x: 1 / 3, value: 0.5 },
      { x: 2 / 3, value: 1 },
      { x: 1, value: 0 },
    ]);
  });

  it('can estimate post-EQ analyzer bars from the current response', () => {
    const input = computeEqSpectrumBars([0.5, 0.5, 0.5], [], 'input');
    const postEq = computeEqSpectrumBars([
      0.5,
      0.5,
      0.5,
    ], [
      { frequencyHz: 1000, gainDb: 6, q: 1, filterType: 'peaking', enabled: true },
    ], 'postEq');

    expect(postEq.some((bar, index) => bar.value !== input[index].value)).toBe(true);
    postEq.forEach((bar) => {
      expect(bar.value).toBeGreaterThanOrEqual(0);
      expect(bar.value).toBeLessThanOrEqual(1);
    });
  });

  it('computes finite hover response readouts from the same biquad path', () => {
    const gainDb = computeEqResponseGainDbAtFrequency([
      { frequencyHz: 1000, gainDb: 6, q: 1.4, filterType: 'peaking', enabled: true },
      { frequencyHz: 8200, gainDb: 0, q: 6, filterType: 'notch', enabled: true },
    ], 1000);

    expect(Number.isFinite(gainDb)).toBe(true);
    expect(gainDb).toBeGreaterThan(0);
  });

  it('computes a flat response as the 0 dB center line', () => {
    const points = computeEqCurvePoints(eqState([0, 0, 0]).bands);

    expect(points.length).toBeGreaterThan(64);
    points.forEach((point) => expect(point.y).toBeCloseTo(0.5, 5));
  });

  it('renders high-pass and low-pass response direction correctly', () => {
    const highPassPoints = computeEqCurvePoints([
      { frequencyHz: 120, gainDb: 0, q: 0.7, filterType: 'highPass', enabled: true },
    ]);
    const lowPassPoints = computeEqCurvePoints([
      { frequencyHz: 4000, gainDb: 0, q: 0.7, filterType: 'lowPass', enabled: true },
    ]);

    expect(highPassPoints[0].y).toBeGreaterThan(highPassPoints.at(-1)?.y ?? 0);
    expect(lowPassPoints[0].y).toBeLessThan(lowPassPoints.at(-1)?.y ?? 0);
  });

  it('renders a notch as a narrow cut around its center frequency', () => {
    const points = computeEqCurvePoints([
      { frequencyHz: 1000, gainDb: 0, q: 8, filterType: 'notch', enabled: true },
    ]);

    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(0.9);
    expect(isEqFilterGainEditable('notch')).toBe(false);
    expect(isEqFilterGainEditable('peaking')).toBe(true);
  });

  it('clamps channel balance patch values before sending IPC', () => {
    const patch: Partial<ChannelBalanceState> = {
      balance: 3,
      leftGainDb: -30,
      rightGainDb: 12,
      leftDelayMs: -1,
      rightDelayMs: 80,
    };

    expect(clampChannelBalancePatch(patch)).toMatchObject({
      balance: 1,
      leftGainDb: -12,
      rightGainDb: 6,
      leftDelayMs: 0,
      rightDelayMs: 10,
    });
  });

  it('snaps dragged band frequency unless free-frequency mode is unlocked', () => {
    expect(resolveBandFrequency(117, false)).toBe(125);
    expect(resolveBandFrequency(117, true)).toBe(117);
  });

  it('captures independent A/B snapshots', () => {
    const source = eqState([0, 3, -2]);
    const snapshot = captureEqSnapshot(source);

    expect(snapshot.preampDb).toBe(0);
    snapshot.bands[1].gainDb = 9;
    expect(snapshot.bands[1].gainDb).toBe(9);
    expect(source.bands[1].gainDb).toBe(3);
  });

  it('estimates peak gain from preamp plus maximum positive boost', () => {
    expect(computeEstimatedPeakGain({ preampDb: -4, bands: eqState([0, 6, -2]).bands })).toBe(2);
    expect(computeEstimatedPeakGain({ preampDb: -3, bands: eqState([-6, -2, -1]).bands })).toBe(-3);
  });

  it('ignores bypassed PEQ bands in safety and curve estimates', () => {
    const state = eqState([12, 0, 0]);
    state.bands[0].enabled = false;

    expect(computeRecommendedPreamp(state)).toBe(0);
    expect(computeEstimatedPeakGain({ preampDb: -2, bands: state.bands })).toBe(-2);
    expect(computeEqCurvePoints(state.bands)[0].y).toBeCloseTo(0.5, 5);
  });

  it('computes loudness-matched A/B preamp within range', () => {
    const source = { preampDb: -5, bands: eqState([6, 0, 0]).bands };
    const target = { preampDb: 0, bands: eqState([12, 0, 0]).bands };

    expect(computeLoudnessMatchedPreamp(source, target)).toBe(-11);
    expect(computeLoudnessMatchedPreamp({ preampDb: -12, bands: eqState([0]).bands }, target)).toBe(-12);
  });

  it('keeps Auto Gain idle without telemetry', () => {
    expect(computeAutoGainPreamp({
      eqState: eqState([0, 6, 0]),
      audioLevels: null,
      baselinePreampDb: 0,
      nowMs: 5000,
      lastAdjustmentAtMs: 0,
    })).toMatchObject({
      status: 'idle',
      targetPreampDb: null,
      adjustmentDb: 0,
    });
  });

  it('reduces Auto Gain preamp to preserve output headroom', () => {
    const result = computeAutoGainPreamp({
      eqState: eqState([0, 6, 0]),
      audioLevels: {
        inputPeakDb: -4,
        inputRmsDb: -18,
        estimatedOutputPeakDb: 0.8,
        estimatedOutputRmsDb: -12,
        headroomDb: -0.8,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
      baselinePreampDb: 0,
      nowMs: 5000,
      lastAdjustmentAtMs: 0,
    });

    expect(result.status).toBe('reducing');
    expect(result.targetPreampDb).toBeLessThanOrEqual(-1.8);
    expect(result.adjustmentDb).toBeLessThanOrEqual(-1.8);
  });

  it('marks Auto Gain clipping risk and avoids NaN with extreme telemetry', () => {
    const result = computeAutoGainPreamp({
      eqState: { ...eqState([0]), preampDb: -11.8, clippingRisk: true },
      audioLevels: {
        inputPeakDb: Number.NaN,
        inputRmsDb: null,
        estimatedOutputPeakDb: Number.NaN,
        estimatedOutputRmsDb: null,
        headroomDb: null,
        clipCount: 2,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
      baselinePreampDb: 0,
      nowMs: 5000,
      lastAdjustmentAtMs: 0,
      clippingRisk: true,
    });

    expect(result.status).toBe('clipping');
    expect(result.targetPreampDb).toBe(-12);
    expect(Number.isFinite(result.adjustmentDb)).toBe(true);
  });

  it('recovers Auto Gain preamp slowly without exceeding the safe ceiling', () => {
    const held = computeAutoGainPreamp({
      eqState: { ...eqState([6]), preampDb: -8 },
      audioLevels: {
        inputPeakDb: -24,
        inputRmsDb: -36,
        estimatedOutputPeakDb: -18,
        estimatedOutputRmsDb: -30,
        headroomDb: 18,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
      baselinePreampDb: 0,
      nowMs: 1000,
      lastAdjustmentAtMs: 0,
    });
    const recovered = computeAutoGainPreamp({
      eqState: { ...eqState([6]), preampDb: -8 },
      audioLevels: {
        inputPeakDb: -24,
        inputRmsDb: -36,
        estimatedOutputPeakDb: -18,
        estimatedOutputRmsDb: -30,
        headroomDb: 18,
        clipCount: 0,
        lastClipAt: null,
        meterSource: 'pre_native_estimated_post_dsp',
      },
      baselinePreampDb: 0,
      nowMs: 2500,
      lastAdjustmentAtMs: 0,
    });

    expect(held).toMatchObject({ status: 'holding', targetPreampDb: null });
    expect(recovered).toMatchObject({ status: 'recovering', targetPreampDb: -7.5 });
  });

  it('describes known built-in presets and safely ignores unknown presets', () => {
    expect(describePreset('harman-target')).toMatchObject({ category: 'target', approximation: true });
    expect(describePreset('subsonic-filter')).toMatchObject({ category: 'utility', approximation: false });
    expect(describePreset('sibilance-tamer')).toMatchObject({ category: 'utility', approximation: false });
    expect(describePreset('bluetooth-speaker-cleanup')).toMatchObject({ category: 'utility', approximation: false });
    expect(describePreset('missing-preset')).toBeNull();
  });

  it('computes effective channel gain with and without constant-power balance', () => {
    expect(computeEffectiveChannelGains({ balance: 0, leftGainDb: 1, rightGainDb: -1, constantPower: true })).toEqual({
      leftDb: 1,
      rightDb: -1,
    });

    const hardRight = computeEffectiveChannelGains({ balance: 1, leftGainDb: 0, rightGainDb: 0, constantPower: false });
    expect(hardRight.leftDb).toBe(-Infinity);
    expect(hardRight.rightDb).toBe(0);
  });
});
