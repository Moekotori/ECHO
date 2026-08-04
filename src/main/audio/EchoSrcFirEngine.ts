import type {
  AudioCudaRuntimeStatus,
  AudioEchoSrcComputeBackend,
  AudioEchoSrcFirPhase,
  AudioEchoSrcFirWindow,
  AudioEchoSrcFilterProfile,
} from '../../shared/types/audio';
import { resolveCudaRuntimeStatus } from './CudaRuntimeProbe';
import { resolveEchoSrcCudaWorkerStatus, type EchoSrcCudaWorkerStatus } from './EchoSrcCudaWorker';

export type EchoSrcFirWindow = AudioEchoSrcFirWindow;
export type EchoSrcFirPhase = AudioEchoSrcFirPhase;

export type EchoSrcFirProfileSpec = {
  profile: AudioEchoSrcFilterProfile;
  tapCount: number;
  window: EchoSrcFirWindow;
  phase: EchoSrcFirPhase;
  attenuationDb: number;
  transitionRatio: number;
  cutoffScale?: number;
  gaussianAlpha?: number;
  kaiserBeta?: number;
};

export type EchoSrcFirPlan = EchoSrcFirProfileSpec & {
  sourceSampleRate: number;
  targetSampleRate: number;
  normalizedCutoff: number;
};

export type EchoSrcFirStagePlan = {
  index: number;
  upsampleFactor: 1 | 2;
  plan: EchoSrcFirPlan;
};

export type EchoSrcFirStageProfileResolver = (
  stageSourceSampleRate: number,
  stageTargetSampleRate: number,
  stageIndex: number,
) => AudioEchoSrcFilterProfile;

export type EchoSrcFirState = {
  history: Float32Array;
};

export type EchoSrcFirProcessResult = {
  output: Float32Array;
  state: EchoSrcFirState;
};

export type EchoSrcFirTapsAnalysis = {
  tapCount: number;
  peakIndex: number;
  energyCentroid: number;
  preRingingEnergyRatio: number;
  postRingingEnergyRatio: number;
  dcGain: number;
  nyquistGainDb: number;
  passbandRippleDb: number;
  stopbandPeakDb: number;
};

export type EchoSrcFirBackendStatus = {
  backend: AudioEchoSrcComputeBackend;
  available: boolean;
  active: boolean;
  reason: string | null;
  cudaRuntime?: AudioCudaRuntimeStatus;
  cudaWorker?: EchoSrcCudaWorkerStatus;
};

export type WindowedSincLowpassOptions = {
  tapCount: number;
  normalizedCutoff: number;
  window: EchoSrcFirWindow;
  gaussianAlpha?: number;
  kaiserBeta?: number;
};

const profileSpecs: Record<AudioEchoSrcFilterProfile, EchoSrcFirProfileSpec> = {
  'poly-sinc-hb': {
    profile: 'poly-sinc-hb',
    tapCount: 255,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 120,
    transitionRatio: 0.08,
    cutoffScale: 1,
    kaiserBeta: 12,
  },
  'poly-sinc-ext2-short': {
    profile: 'poly-sinc-ext2-short',
    tapCount: 511,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 135,
    transitionRatio: 0.065,
    cutoffScale: 0.99,
  },
  'poly-sinc-ext2-medium': {
    profile: 'poly-sinc-ext2-medium',
    tapCount: 767,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 142,
    transitionRatio: 0.055,
    cutoffScale: 0.995,
  },
  'poly-sinc-ext2-long': {
    profile: 'poly-sinc-ext2-long',
    tapCount: 1023,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 150,
    transitionRatio: 0.045,
    cutoffScale: 1,
  },
  'poly-sinc-ext2-xla': {
    profile: 'poly-sinc-ext2-xla',
    tapCount: 2047,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 170,
    transitionRatio: 0.032,
    cutoffScale: 1,
  },
  'poly-sinc-ext2-xl': {
    profile: 'poly-sinc-ext2-xl',
    tapCount: 3071,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 178,
    transitionRatio: 0.028,
    cutoffScale: 1,
  },
  'poly-sinc-ext2-hires-lp': {
    profile: 'poly-sinc-ext2-hires-lp',
    tapCount: 1535,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 155,
    transitionRatio: 0.04,
    cutoffScale: 0.995,
  },
  'poly-sinc-ext2-hires-mp': {
    profile: 'poly-sinc-ext2-hires-mp',
    tapCount: 1535,
    window: 'blackman-harris',
    phase: 'minimum',
    attenuationDb: 155,
    transitionRatio: 0.04,
    cutoffScale: 0.985,
  },
  'poly-sinc-ext3-long': {
    profile: 'poly-sinc-ext3-long',
    tapCount: 2047,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 175,
    transitionRatio: 0.03,
    cutoffScale: 0.998,
  },
  'poly-sinc-ext3-xla': {
    profile: 'poly-sinc-ext3-xla',
    tapCount: 4095,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 190,
    transitionRatio: 0.022,
    cutoffScale: 1,
  },
  'poly-sinc-gauss-long': {
    profile: 'poly-sinc-gauss-long',
    tapCount: 1023,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 145,
    transitionRatio: 0.05,
    cutoffScale: 0.965,
    gaussianAlpha: 3.2,
  },
  'poly-sinc-gauss-xla': {
    profile: 'poly-sinc-gauss-xla',
    tapCount: 2047,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 165,
    transitionRatio: 0.035,
    cutoffScale: 0.955,
    gaussianAlpha: 3.6,
  },
  'poly-sinc-gauss-xl': {
    profile: 'poly-sinc-gauss-xl',
    tapCount: 3071,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 172,
    transitionRatio: 0.03,
    cutoffScale: 0.95,
    gaussianAlpha: 3.9,
  },
  'poly-sinc-gauss-hires-lp': {
    profile: 'poly-sinc-gauss-hires-lp',
    tapCount: 767,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 138,
    transitionRatio: 0.06,
    cutoffScale: 0.96,
    gaussianAlpha: 2.9,
  },
  'poly-sinc-gauss-hires-mp': {
    profile: 'poly-sinc-gauss-hires-mp',
    tapCount: 1023,
    window: 'gaussian',
    phase: 'minimum',
    attenuationDb: 145,
    transitionRatio: 0.052,
    cutoffScale: 0.945,
    gaussianAlpha: 3.15,
  },
  'poly-sinc-gauss-xtr-long': {
    profile: 'poly-sinc-gauss-xtr-long',
    tapCount: 2047,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 168,
    transitionRatio: 0.032,
    cutoffScale: 0.94,
    gaussianAlpha: 4.15,
  },
  'poly-sinc-gauss-xtr-xla': {
    profile: 'poly-sinc-gauss-xtr-xla',
    tapCount: 4095,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 185,
    transitionRatio: 0.024,
    cutoffScale: 0.93,
    gaussianAlpha: 4.6,
  },
  'poly-sinc-xtr-mp': {
    profile: 'poly-sinc-xtr-mp',
    tapCount: 1535,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 160,
    transitionRatio: 0.038,
    cutoffScale: 0.965,
    kaiserBeta: 15,
  },
  'poly-sinc-xtr-short-lp': {
    profile: 'poly-sinc-xtr-short-lp',
    tapCount: 767,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 140,
    transitionRatio: 0.058,
    cutoffScale: 0.98,
    kaiserBeta: 12.5,
  },
  'poly-sinc-xtr-short-mp': {
    profile: 'poly-sinc-xtr-short-mp',
    tapCount: 767,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 140,
    transitionRatio: 0.058,
    cutoffScale: 0.955,
    kaiserBeta: 12.5,
  },
  'poly-sinc-xtr-lp': {
    profile: 'poly-sinc-xtr-lp',
    tapCount: 1535,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 160,
    transitionRatio: 0.038,
    cutoffScale: 0.99,
    kaiserBeta: 15,
  },
  'poly-sinc-xtr-xla': {
    profile: 'poly-sinc-xtr-xla',
    tapCount: 3071,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 178,
    transitionRatio: 0.028,
    cutoffScale: 0.965,
    kaiserBeta: 16.5,
  },
  'minringFIR-lp': {
    profile: 'minringFIR-lp',
    tapCount: 767,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 135,
    transitionRatio: 0.055,
    cutoffScale: 0.94,
    kaiserBeta: 11,
  },
  'minringFIR-mp': {
    profile: 'minringFIR-mp',
    tapCount: 1023,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 145,
    transitionRatio: 0.048,
    cutoffScale: 0.93,
    kaiserBeta: 12.5,
  },
  'minringFIR-xla': {
    profile: 'minringFIR-xla',
    tapCount: 2047,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 165,
    transitionRatio: 0.034,
    cutoffScale: 0.925,
    kaiserBeta: 15.5,
  },
  'minringFIR-soft': {
    profile: 'minringFIR-soft',
    tapCount: 1535,
    window: 'gaussian',
    phase: 'minimum',
    attenuationDb: 150,
    transitionRatio: 0.05,
    cutoffScale: 0.9,
    gaussianAlpha: 3.65,
  },
  'minringFIR-extreme': {
    profile: 'minringFIR-extreme',
    tapCount: 3071,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 178,
    transitionRatio: 0.026,
    cutoffScale: 0.915,
    kaiserBeta: 17,
  },
  'apod-fast': {
    profile: 'apod-fast',
    tapCount: 767,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 132,
    transitionRatio: 0.07,
    cutoffScale: 0.9,
    kaiserBeta: 11.5,
  },
  'apod-long': {
    profile: 'apod-long',
    tapCount: 2047,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 165,
    transitionRatio: 0.048,
    cutoffScale: 0.87,
  },
  'apod-minring': {
    profile: 'apod-minring',
    tapCount: 1535,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 155,
    transitionRatio: 0.052,
    cutoffScale: 0.875,
    kaiserBeta: 14,
  },
  'apod-gauss': {
    profile: 'apod-gauss',
    tapCount: 1535,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 152,
    transitionRatio: 0.058,
    cutoffScale: 0.86,
    gaussianAlpha: 3.7,
  },
  'apod-xtr': {
    profile: 'apod-xtr',
    tapCount: 3071,
    window: 'blackman-harris',
    phase: 'linear',
    attenuationDb: 178,
    transitionRatio: 0.036,
    cutoffScale: 0.84,
  },
  'apod-extreme': {
    profile: 'apod-extreme',
    tapCount: 4095,
    window: 'kaiser',
    phase: 'minimum',
    attenuationDb: 190,
    transitionRatio: 0.03,
    cutoffScale: 0.835,
    kaiserBeta: 18,
  },
  'brickwall-long': {
    profile: 'brickwall-long',
    tapCount: 2047,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 180,
    transitionRatio: 0.024,
    cutoffScale: 1,
    kaiserBeta: 17.5,
  },
  'soft-knee-long': {
    profile: 'soft-knee-long',
    tapCount: 2047,
    window: 'gaussian',
    phase: 'linear',
    attenuationDb: 158,
    transitionRatio: 0.065,
    cutoffScale: 0.9,
    gaussianAlpha: 3.1,
  },
  'closed-form': {
    profile: 'closed-form',
    tapCount: 511,
    window: 'hann',
    phase: 'linear',
    attenuationDb: 110,
    transitionRatio: 0.07,
    cutoffScale: 0.97,
  },
  'sinc-M': {
    profile: 'sinc-M',
    tapCount: 511,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 125,
    transitionRatio: 0.062,
    cutoffScale: 0.985,
    kaiserBeta: 10.5,
  },
  'sinc-L': {
    profile: 'sinc-L',
    tapCount: 767,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 136,
    transitionRatio: 0.055,
    cutoffScale: 0.99,
    kaiserBeta: 12,
  },
  'sinc-long': {
    profile: 'sinc-long',
    tapCount: 1023,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 145,
    transitionRatio: 0.048,
    cutoffScale: 0.995,
    kaiserBeta: 13,
  },
  'sinc-long-h': {
    profile: 'sinc-long-h',
    tapCount: 1535,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 155,
    transitionRatio: 0.04,
    cutoffScale: 1,
    kaiserBeta: 14,
  },
  'sinc-xla': {
    profile: 'sinc-xla',
    tapCount: 2047,
    window: 'kaiser',
    phase: 'linear',
    attenuationDb: 165,
    transitionRatio: 0.034,
    cutoffScale: 1,
    kaiserBeta: 15.5,
  },
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sinc = (value: number): number =>
  Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);

const besselI0 = (value: number): number => {
  let sum = 1;
  let term = 1;
  const squared = (value * value) / 4;

  for (let index = 1; index <= 24; index += 1) {
    term *= squared / (index * index);
    sum += term;
    if (term < 1e-14) {
      break;
    }
  }

  return sum;
};

const nextPowerOfTwo = (value: number): number => {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
};

const reverseBits = (value: number, bits: number): number => {
  let reversed = 0;
  for (let bit = 0; bit < bits; bit += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
};

const fftInPlace = (real: Float64Array, imag: Float64Array, inverse = false): void => {
  const size = real.length;
  const bits = Math.round(Math.log2(size));

  for (let index = 0; index < size; index += 1) {
    const reversed = reverseBits(index, bits);
    if (reversed > index) {
      const tempReal = real[index]!;
      const tempImag = imag[index]!;
      real[index] = real[reversed]!;
      imag[index] = imag[reversed]!;
      real[reversed] = tempReal;
      imag[reversed] = tempImag;
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let start = 0; start < size; start += length) {
      let currentReal = 1;
      let currentImag = 0;
      const half = length / 2;

      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd]! * currentReal - imag[odd]! * currentImag;
        const oddImag = real[odd]! * currentImag + imag[odd]! * currentReal;

        real[odd] = real[even]! - oddReal;
        imag[odd] = imag[even]! - oddImag;
        real[even] = real[even]! + oddReal;
        imag[even] = imag[even]! + oddImag;

        const nextReal = currentReal * stepReal - currentImag * stepImag;
        currentImag = currentReal * stepImag + currentImag * stepReal;
        currentReal = nextReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imag[index] /= size;
    }
  }
};

const windowValue = (
  index: number,
  tapCount: number,
  options: Pick<WindowedSincLowpassOptions, 'window' | 'gaussianAlpha' | 'kaiserBeta'>,
): number => {
  if (tapCount <= 1) {
    return 1;
  }

  const position = index / (tapCount - 1);
  const centered = 2 * position - 1;

  switch (options.window) {
    case 'blackman-harris':
      return (
        0.35875 -
        0.48829 * Math.cos(2 * Math.PI * position) +
        0.14128 * Math.cos(4 * Math.PI * position) -
        0.01168 * Math.cos(6 * Math.PI * position)
      );
    case 'gaussian': {
      const alpha = options.gaussianAlpha ?? 3.2;
      return Math.exp(-0.5 * Math.pow(alpha * centered, 2));
    }
    case 'kaiser': {
      const beta = options.kaiserBeta ?? 12;
      return besselI0(beta * Math.sqrt(Math.max(0, 1 - centered * centered))) / besselI0(beta);
    }
    case 'hann':
    default:
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * position);
  }
};

export const getEchoSrcFirProfileSpec = (profile: AudioEchoSrcFilterProfile): EchoSrcFirProfileSpec => ({
  ...profileSpecs[profile],
});

export const createEchoSrcFirPlan = (
  profile: AudioEchoSrcFilterProfile,
  sourceSampleRate: number,
  targetSampleRate: number,
): EchoSrcFirPlan => {
  const spec = getEchoSrcFirProfileSpec(profile);
  const safeSourceRate = Math.max(1, Math.round(sourceSampleRate));
  const safeTargetRate = Math.max(1, Math.round(targetSampleRate));
  const sourceNyquistAtTargetScale = safeSourceRate / safeTargetRate / 2;
  const transitionGuard = Math.max(0.75, 1 - spec.transitionRatio);
  const cutoffScale = spec.cutoffScale ?? 1;
  const normalizedCutoff = clamp(sourceNyquistAtTargetScale * transitionGuard * cutoffScale, 0.001, 0.499);

  return {
    ...spec,
    sourceSampleRate: safeSourceRate,
    targetSampleRate: safeTargetRate,
    normalizedCutoff,
  };
};

export const createEchoSrcFirStagePlans = (
  profile: AudioEchoSrcFilterProfile,
  sourceSampleRate: number,
  targetSampleRate: number,
  options: { resolveProfile?: EchoSrcFirStageProfileResolver } = {},
): EchoSrcFirStagePlan[] => {
  const safeSourceRate = Math.max(1, Math.round(sourceSampleRate));
  const safeTargetRate = Math.max(1, Math.round(targetSampleRate));
  const factor = safeTargetRate / safeSourceRate;
  if (factor !== 2 && factor !== 4 && factor !== 8) {
    return [];
  }

  const stages: EchoSrcFirStagePlan[] = [];
  let stageSourceRate = safeSourceRate;
  for (let index = 0; index < Math.log2(factor); index += 1) {
    const stageTargetRate = stageSourceRate * 2;
    const stageProfile = options.resolveProfile?.(stageSourceRate, stageTargetRate, index) ?? profile;
    stages.push({
      index,
      upsampleFactor: 2,
      plan: createEchoSrcFirPlan(stageProfile, stageSourceRate, stageTargetRate),
    });
    stageSourceRate = stageTargetRate;
  }

  return stages;
};

export const createWindowedSincLowpassTaps = (options: WindowedSincLowpassOptions): Float32Array => {
  const tapCount = Math.max(3, Math.round(options.tapCount) | 1);
  const cutoff = clamp(options.normalizedCutoff, 0.001, 0.499);
  const center = (tapCount - 1) / 2;
  const taps = new Float32Array(tapCount);
  let sum = 0;

  for (let index = 0; index < tapCount; index += 1) {
    const offset = index - center;
    const value = 2 * cutoff * sinc(2 * cutoff * offset) * windowValue(index, tapCount, options);
    taps[index] = value;
    sum += value;
  }

  if (Math.abs(sum) > 1e-12) {
    for (let index = 0; index < taps.length; index += 1) {
      taps[index] /= sum;
    }
  }

  return taps;
};

export const createMinimumPhaseTaps = (linearPhaseTaps: Float32Array): Float32Array => {
  const tapCount = linearPhaseTaps.length;
  const fftSize = nextPowerOfTwo(Math.max(8, tapCount * 4));
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  for (let index = 0; index < tapCount; index += 1) {
    real[index] = linearPhaseTaps[index]!;
  }

  fftInPlace(real, imag);
  for (let index = 0; index < fftSize; index += 1) {
    real[index] = Math.log(Math.max(1e-12, Math.hypot(real[index]!, imag[index]!)));
    imag[index] = 0;
  }

  fftInPlace(real, imag, true);
  for (let index = 1; index < fftSize / 2; index += 1) {
    real[index] *= 2;
  }
  real[fftSize / 2] = 0;
  for (let index = (fftSize / 2) + 1; index < fftSize; index += 1) {
    real[index] = 0;
  }
  imag.fill(0);

  fftInPlace(real, imag);
  for (let index = 0; index < fftSize; index += 1) {
    const magnitude = Math.exp(real[index]!);
    const phase = imag[index]!;
    real[index] = magnitude * Math.cos(phase);
    imag[index] = magnitude * Math.sin(phase);
  }

  fftInPlace(real, imag, true);
  const taps = new Float32Array(tapCount);
  let sum = 0;
  for (let index = 0; index < tapCount; index += 1) {
    taps[index] = real[index]!;
    sum += taps[index]!;
  }

  if (Math.abs(sum) > 1e-12) {
    for (let index = 0; index < taps.length; index += 1) {
      taps[index] /= sum;
    }
  }

  return taps;
};

export const createEchoSrcFirTaps = (plan: EchoSrcFirPlan): Float32Array => {
  const linearPhaseTaps = createWindowedSincLowpassTaps({
    tapCount: plan.tapCount,
    normalizedCutoff: plan.normalizedCutoff,
    window: plan.window,
    gaussianAlpha: plan.gaussianAlpha,
    kaiserBeta: plan.kaiserBeta,
  });

  return plan.phase === 'minimum' ? createMinimumPhaseTaps(linearPhaseTaps) : linearPhaseTaps;
};

const upsampleMono = (input: Float32Array, factor: 1 | 2): Float32Array => {
  if (factor === 1) {
    return input;
  }

  const output = new Float32Array(input.length * factor);
  for (let index = 0; index < input.length; index += 1) {
    output[index * factor] = input[index]! * factor;
  }
  return output;
};

export const createEchoSrcFirCompositeTaps = (
  stages: Array<{ taps: Float32Array; upsampleFactor: 1 | 2 }>,
): Float32Array => {
  if (stages.length === 0) {
    return new Float32Array([1]);
  }

  let impulse = new Float32Array([1]);
  for (const stage of stages) {
    const upsampled = upsampleMono(impulse, stage.upsampleFactor);
    const padded = new Float32Array(upsampled.length + Math.max(0, stage.taps.length - 1));
    padded.set(upsampled);
    impulse = new Float32Array(processFirInterleavedFloat32Cpu(padded, 1, stage.taps).output);
  }

  const sum = impulse.reduce((total, value) => total + value, 0);
  if (Math.abs(sum) > 1e-12) {
    for (let index = 0; index < impulse.length; index += 1) {
      impulse[index] /= sum;
    }
  }

  return impulse;
};

const magnitudeAt = (taps: Float32Array, normalizedFrequency: number): number => {
  const frequency = clamp(normalizedFrequency, 0, 0.5);
  let real = 0;
  let imag = 0;
  for (let index = 0; index < taps.length; index += 1) {
    const angle = -2 * Math.PI * frequency * index;
    const tap = taps[index]!;
    real += tap * Math.cos(angle);
    imag += tap * Math.sin(angle);
  }
  return Math.hypot(real, imag);
};

const magnitudeDb = (magnitude: number): number =>
  20 * Math.log10(Math.max(1e-12, magnitude));

export const analyzeEchoSrcFirTaps = (
  plan: EchoSrcFirPlan,
  taps: Float32Array = createEchoSrcFirTaps(plan),
): EchoSrcFirTapsAnalysis => {
  let peakIndex = 0;
  let peakMagnitude = 0;
  let totalEnergy = 0;
  let weightedEnergy = 0;

  for (let index = 0; index < taps.length; index += 1) {
    const tap = taps[index]!;
    const magnitude = Math.abs(tap);
    const energy = tap * tap;
    if (magnitude > peakMagnitude) {
      peakMagnitude = magnitude;
      peakIndex = index;
    }
    totalEnergy += energy;
    weightedEnergy += energy * index;
  }

  let preEnergy = 0;
  let postEnergy = 0;
  for (let index = 0; index < taps.length; index += 1) {
    const energy = taps[index]! * taps[index]!;
    if (index < peakIndex) {
      preEnergy += energy;
    } else if (index > peakIndex) {
      postEnergy += energy;
    }
  }

  const passbandEnd = Math.max(0.001, plan.normalizedCutoff * 0.8);
  let passbandMin = Number.POSITIVE_INFINITY;
  let passbandMax = 0;
  for (let sample = 0; sample <= 16; sample += 1) {
    const magnitude = magnitudeAt(taps, (passbandEnd * sample) / 16);
    passbandMin = Math.min(passbandMin, magnitude);
    passbandMax = Math.max(passbandMax, magnitude);
  }

  const stopbandStart = clamp(plan.normalizedCutoff + Math.max(0.002, plan.transitionRatio / 2), 0.001, 0.499);
  let stopbandPeak = 0;
  for (let sample = 0; sample <= 64; sample += 1) {
    const frequency = stopbandStart + ((0.5 - stopbandStart) * sample) / 64;
    stopbandPeak = Math.max(stopbandPeak, magnitudeAt(taps, frequency));
  }

  return {
    tapCount: taps.length,
    peakIndex,
    energyCentroid: totalEnergy > 0 ? weightedEnergy / totalEnergy : 0,
    preRingingEnergyRatio: totalEnergy > 0 ? preEnergy / totalEnergy : 0,
    postRingingEnergyRatio: totalEnergy > 0 ? postEnergy / totalEnergy : 0,
    dcGain: magnitudeAt(taps, 0),
    nyquistGainDb: magnitudeDb(magnitudeAt(taps, 0.5)),
    passbandRippleDb: magnitudeDb(passbandMax) - magnitudeDb(passbandMin),
    stopbandPeakDb: magnitudeDb(stopbandPeak),
  };
};

export const createEchoSrcFirState = (channels: number, taps: Float32Array): EchoSrcFirState => ({
  history: new Float32Array(Math.max(0, taps.length - 1) * Math.max(1, Math.round(channels))),
});

export const processFirInterleavedFloat32Cpu = (
  input: Float32Array,
  channels: number,
  taps: Float32Array,
  state?: EchoSrcFirState,
): EchoSrcFirProcessResult => {
  const channelCount = Math.max(1, Math.round(channels));
  if (input.length % channelCount !== 0) {
    throw new Error('echo_src_fir_input_channel_mismatch');
  }
  if (taps.length === 0) {
    throw new Error('echo_src_fir_empty_taps');
  }

  const historyLength = (taps.length - 1) * channelCount;
  const previous = state?.history.length === historyLength ? state.history : new Float32Array(historyLength);
  const combined = new Float32Array(previous.length + input.length);
  combined.set(previous, 0);
  combined.set(input, previous.length);

  const output = new Float32Array(input.length);
  const frameCount = input.length / channelCount;
  const historyFrames = taps.length - 1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const combinedFrame = historyFrames + frame;
    for (let channel = 0; channel < channelCount; channel += 1) {
      let sample = 0;
      for (let tapIndex = 0; tapIndex < taps.length; tapIndex += 1) {
        const sourceFrame = combinedFrame - tapIndex;
        sample += taps[tapIndex] * combined[sourceFrame * channelCount + channel];
      }
      output[frame * channelCount + channel] = sample;
    }
  }

  const nextHistory = new Float32Array(historyLength);
  if (historyLength > 0) {
    nextHistory.set(combined.subarray(combined.length - historyLength));
  }

  return {
    output,
    state: { history: nextHistory },
  };
};

export const resolveEchoSrcFirBackendStatus = (
  backend: AudioEchoSrcComputeBackend,
  cudaRuntime: AudioCudaRuntimeStatus = resolveCudaRuntimeStatus(),
  cudaWorker: EchoSrcCudaWorkerStatus = resolveEchoSrcCudaWorkerStatus(),
): EchoSrcFirBackendStatus => {
  if (backend === 'cpu') {
    return {
      backend,
      available: true,
      active: true,
      reason: null,
    };
  }

  if (!cudaRuntime.available) {
    return {
      backend,
      available: false,
      active: false,
      reason: cudaRuntime.error ?? 'cuda_runtime_unavailable',
      cudaRuntime,
      cudaWorker,
    };
  }

  if (!cudaWorker.available) {
    return {
      backend,
      available: false,
      active: false,
      reason: cudaWorker.error ?? 'src_cuda_worker_unavailable',
      cudaRuntime,
      cudaWorker,
    };
  }

  return {
    backend,
    available: true,
    active: true,
    reason: null,
    cudaRuntime,
    cudaWorker,
  };
};
