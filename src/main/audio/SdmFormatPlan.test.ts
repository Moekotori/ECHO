import { describe, expect, it } from 'vitest';
import { resolveSdmDopTransportSampleRate, resolveSdmModulatorProfile, resolveSdmNativeSampleRate } from './SdmFormatPlan';

describe('SdmFormatPlan', () => {
  it('keeps 44.1 kHz and 48 kHz DSD rate families distinct', () => {
    expect(resolveSdmNativeSampleRate('dsd128', 44_100)).toBe(5_644_800);
    expect(resolveSdmNativeSampleRate('dsd128', 48_000)).toBe(6_144_000);
    expect(resolveSdmDopTransportSampleRate('dsd128', 48_000)).toBe(384_000);
  });

  it('returns isolated modulator coefficient arrays', () => {
    const first = resolveSdmModulatorProfile('reference');
    const second = resolveSdmModulatorProfile('reference');
    first.feedbackCoefficients[0] = 0;
    first.feedbackDenominatorCoefficients[0] = 0;
    expect(second.feedbackCoefficients[0]).not.toBe(0);
    expect(second.feedbackDenominatorCoefficients[0]).not.toBe(0);
  });

  it.each(['safe', 'hifi', 'reference', 'insane'] as const)(
    'keeps the %s bounded NTF profile DC-normalized',
    (profile) => {
      const plan = resolveSdmModulatorProfile(profile);
      const numeratorDc = plan.feedbackCoefficients.reduce((sum, coefficient) => sum + coefficient, 0);
      const denominatorDc = 1 + plan.feedbackDenominatorCoefficients.reduce(
        (sum, coefficient) => sum + coefficient,
        0,
      );
      expect(numeratorDc).toBeCloseTo(denominatorDc, 12);
    },
  );

  it('uses progressively higher orders without exceeding the constrained NTF peak envelope', () => {
    expect(resolveSdmModulatorProfile('safe')).toMatchObject({ order: 3, ntfPeakGain: 1.45 });
    expect(resolveSdmModulatorProfile('hifi')).toMatchObject({ order: 6, ntfPeakGain: 1.55 });
    expect(resolveSdmModulatorProfile('reference')).toMatchObject({ order: 7, ntfPeakGain: 1.6 });
    expect(resolveSdmModulatorProfile('insane')).toMatchObject({ order: 8, ntfPeakGain: 1.65 });
  });

  it.each(['safe', 'hifi', 'reference', 'insane'] as const)(
    'keeps the %s NTF stable and within its declared peak gain',
    (profile) => {
      const plan = resolveSdmModulatorProfile(profile);
      expect(plan.poleRadius).toBeGreaterThanOrEqual(0);
      expect(plan.poleRadius).toBeLessThan(1);
      let measuredPeak = 0;
      for (let sample = 0; sample <= 4_096; sample += 1) {
        const frequency = Math.PI * sample / 4_096;
        let denominatorReal = 1;
        let denominatorImaginary = 0;
        let feedbackReal = 0;
        let feedbackImaginary = 0;
        for (let tap = 0; tap < plan.order; tap += 1) {
          const phase = frequency * (tap + 1);
          const real = Math.cos(phase);
          const imaginary = -Math.sin(phase);
          denominatorReal += plan.feedbackDenominatorCoefficients[tap]! * real;
          denominatorImaginary += plan.feedbackDenominatorCoefficients[tap]! * imaginary;
          feedbackReal += plan.feedbackCoefficients[tap]! * real;
          feedbackImaginary += plan.feedbackCoefficients[tap]! * imaginary;
        }
        const ntfNumeratorReal = denominatorReal - feedbackReal;
        const ntfNumeratorImaginary = denominatorImaginary - feedbackImaginary;
        const magnitude = Math.hypot(ntfNumeratorReal, ntfNumeratorImaginary)
          / Math.hypot(denominatorReal, denominatorImaginary);
        measuredPeak = Math.max(measuredPeak, magnitude);
      }
      expect(measuredPeak).toBeCloseTo(plan.ntfPeakGain, 10);
    },
  );

  it('retains conservative profile headroom metadata', () => {
    expect(resolveSdmModulatorProfile('safe').recommendedHeadroomDb).toBe(10);
    expect(resolveSdmModulatorProfile('hifi').recommendedHeadroomDb).toBe(12);
    expect(resolveSdmModulatorProfile('reference').recommendedHeadroomDb).toBe(14);
    expect(resolveSdmModulatorProfile('insane').recommendedHeadroomDb).toBe(16);
  });
});
