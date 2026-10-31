import type { AudioSdmModulatorProfile, AudioSdmQualityProfile, AudioSdmTargetRate } from '../../shared/types/audio';

export const sdmBaseSampleRate = 2_822_400;
export const sdmBaseSampleRate48k = 3_072_000;

const sdmTargetMultipliers: Record<AudioSdmTargetRate, number> = {
  dsd64: 1,
  dsd128: 2,
  dsd256: 4,
  dsd512: 8,
};

const binomialCoefficient = (order: number, tap: number): number => {
  let value = 1;
  for (let index = 1; index <= tap; index += 1) {
    value *= (order - index + 1) / index;
  }
  return value;
};

const createBoundedNtf = (order: number, ntfPeakGain: number): Pick<
  AudioSdmModulatorProfile,
  'feedbackCoefficients' | 'feedbackDenominatorCoefficients' | 'ntfPeakGain' | 'poleRadius'
> => {
  const poleRadius = 2 / Math.pow(ntfPeakGain, 1 / order) - 1;
  const feedbackDenominatorCoefficients = Array.from({ length: order }, (_, index) => {
    const tap = index + 1;
    return binomialCoefficient(order, tap) * Math.pow(-poleRadius, tap);
  });
  const feedbackCoefficients = feedbackDenominatorCoefficients.map((denominator, index) => {
    const tap = index + 1;
    return denominator - binomialCoefficient(order, tap) * Math.pow(-1, tap);
  });
  return {
    feedbackCoefficients,
    feedbackDenominatorCoefficients,
    ntfPeakGain,
    poleRadius,
  };
};

const sdmModulatorProfiles: Record<AudioSdmQualityProfile, AudioSdmModulatorProfile> = {
  safe: {
    id: 'echo-sdm-ntf3-safe-v2',
    name: 'ECHO SDM NTF3 Safe v2',
    order: 3,
    noiseShaper: '3rd-order low-noise DC-zero NTF with constrained 1.45 peak gain',
    ...createBoundedNtf(3, 1.45),
    ditherAmplitude: 0.0000002,
    inputLimit: 0.96,
    stabilityLimit: 3.25,
    recommendedHeadroomDb: 10,
  },
  hifi: {
    id: 'echo-sdm-ntf6-hifi-v2',
    name: 'ECHO SDM NTF6 HiFi v2',
    order: 6,
    noiseShaper: '6th-order low-noise DC-zero NTF with constrained 1.55 peak gain',
    ...createBoundedNtf(6, 1.55),
    ditherAmplitude: 0.0000001,
    inputLimit: 0.94,
    stabilityLimit: 3.5,
    recommendedHeadroomDb: 12,
  },
  reference: {
    id: 'echo-sdm-ntf7-reference-v2',
    name: 'ECHO SDM NTF7 Reference v2',
    order: 7,
    noiseShaper: '7th-order low-noise DC-zero NTF with constrained 1.60 peak gain',
    ...createBoundedNtf(7, 1.6),
    ditherAmplitude: 0.00000005,
    inputLimit: 0.92,
    stabilityLimit: 3.75,
    recommendedHeadroomDb: 14,
  },
  insane: {
    id: 'echo-sdm-ntf8-insane-v2',
    name: 'ECHO SDM NTF8 Insane v2',
    order: 8,
    noiseShaper: '8th-order low-noise DC-zero NTF with constrained 1.65 peak gain',
    ...createBoundedNtf(8, 1.65),
    ditherAmplitude: 0.000000025,
    inputLimit: 0.90,
    stabilityLimit: 4,
    recommendedHeadroomDb: 16,
  },
};

const resolveSdmBaseSampleRate = (sourceSampleRate?: number | null): number => {
  const rounded = Math.round(Number(sourceSampleRate));
  return Number.isFinite(rounded) && rounded > 0 && rounded % 48_000 === 0
    ? sdmBaseSampleRate48k
    : sdmBaseSampleRate;
};

export const resolveSdmNativeSampleRate = (targetRate: AudioSdmTargetRate, sourceSampleRate?: number | null): number =>
  resolveSdmBaseSampleRate(sourceSampleRate) * sdmTargetMultipliers[targetRate];

export const resolveSdmDopTransportSampleRate = (targetRate: AudioSdmTargetRate, sourceSampleRate?: number | null): number =>
  Math.round(resolveSdmNativeSampleRate(targetRate, sourceSampleRate) / 16);

export const resolveSdmModulatorProfile = (qualityProfile: AudioSdmQualityProfile): AudioSdmModulatorProfile => {
  const profile = sdmModulatorProfiles[qualityProfile] ?? sdmModulatorProfiles.safe;
  return {
    ...profile,
    feedbackCoefficients: [...profile.feedbackCoefficients],
    feedbackDenominatorCoefficients: [...profile.feedbackDenominatorCoefficients],
  };
};
