import type { AudioStatus } from '../types/audio';

export const musicReactiveVisualsFeatureEnabled = false;

export type MusicReactiveSceneMode = 'idle' | 'flow' | 'beat' | 'limit';

export type MusicReactiveScene = {
  mode: MusicReactiveSceneMode;
  state: AudioStatus['state'] | 'idle';
  energy: number;
  transient: number;
  bass: number;
  mid: number;
  treble: number;
  pressure: number;
  headroomDb: number | null;
  clippingRisk: boolean;
  visualTelemetryState: 'pcm' | 'priming' | 'fallback';
  bands: number[];
};

const reactiveBandCount = 12;
const spectrumBucketCount = 32;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const finiteNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeUnitArray = (value: unknown, length: number): number[] => {
  if (!Array.isArray(value)) {
    return Array.from({ length }, () => 0);
  }

  return Array.from({ length }, (_, index) => {
    const nextValue = Number(value[index] ?? 0);
    return Number.isFinite(nextValue) ? clampUnit(nextValue) : 0;
  });
};

const averageRange = (values: number[], start: number, end: number): number => {
  const slice = values.slice(start, end);
  if (slice.length === 0) {
    return 0;
  }

  return clampUnit(slice.reduce((sum, value) => sum + value, 0) / slice.length);
};

const compressSpectrumBands = (spectrum: number[]): number[] =>
  Array.from({ length: reactiveBandCount }, (_, index) => {
    const start = Math.floor((index / reactiveBandCount) * spectrum.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / reactiveBandCount) * spectrum.length));
    return averageRange(spectrum, start, end);
  });

const dbToEnergy = (value: number | null): number => {
  if (value === null) {
    return 0;
  }

  return clampUnit((value + 54) / 54);
};

export const createMusicReactiveScene = (status: AudioStatus | null | undefined): MusicReactiveScene => {
  const audioLevels = status?.audioLevels;
  const state = status?.state ?? 'idle';
  const isActive = state === 'playing' || state === 'loading';
  const spectrum = normalizeUnitArray(audioLevels?.visualSpectrum, spectrumBucketCount);
  const visualEnergy = finiteNumber(audioLevels?.visualEnergy);
  const visualTransient = finiteNumber(audioLevels?.visualTransient);
  const inputRmsDb = finiteNumber(audioLevels?.inputRmsDb);
  const outputRmsDb = finiteNumber(audioLevels?.estimatedOutputRmsDb);
  const inputPeakDb = finiteNumber(audioLevels?.inputPeakDb);
  const outputPeakDb = finiteNumber(audioLevels?.estimatedOutputPeakDb);
  const headroomDb = finiteNumber(audioLevels?.headroomDb);
  const peakDb = outputPeakDb ?? inputPeakDb;
  const rmsDb = outputRmsDb ?? inputRmsDb;
  const bands = compressSpectrumBands(spectrum);
  const bass = averageRange(spectrum, 0, 8);
  const mid = averageRange(spectrum, 8, 22);
  const treble = averageRange(spectrum, 22, spectrum.length);
  const fallbackEnergy = Math.max(dbToEnergy(rmsDb), averageRange(spectrum, 0, spectrum.length) * 0.92);
  const energy = isActive ? clampUnit(visualEnergy ?? fallbackEnergy) : 0;
  const transient = isActive
    ? clampUnit(visualTransient ?? Math.max(0, (peakDb ?? -96) - (rmsDb ?? -96) - 6) / 18)
    : 0;
  const clippingRisk =
    Boolean(status?.clippingRisk || status?.dspClippingRisk) ||
    Boolean(audioLevels && audioLevels.clipCount > 0) ||
    (peakDb !== null && peakDb >= -0.1);
  const pressure = isActive
    ? clippingRisk
      ? 1
      : headroomDb === null
        ? clampUnit(energy * 0.28)
        : clampUnit((6 - headroomDb) / 8)
    : 0;
  const mode: MusicReactiveSceneMode =
    !isActive || energy < 0.04
      ? 'idle'
      : clippingRisk || pressure > 0.72
        ? 'limit'
        : transient > 0.44
          ? 'beat'
          : 'flow';

  return {
    mode,
    state,
    energy,
    transient,
    bass,
    mid,
    treble,
    pressure,
    headroomDb,
    clippingRisk,
    visualTelemetryState: audioLevels?.visualTelemetryState ?? 'fallback',
    bands,
  };
};

export const musicReactiveSceneToCssVars = (
  scene: MusicReactiveScene,
  prefix: string,
): Record<string, string> => {
  const vars: Record<string, string> = {
    [`--${prefix}-energy`]: scene.energy.toFixed(3),
    [`--${prefix}-transient`]: scene.transient.toFixed(3),
    [`--${prefix}-bass`]: scene.bass.toFixed(3),
    [`--${prefix}-mid`]: scene.mid.toFixed(3),
    [`--${prefix}-treble`]: scene.treble.toFixed(3),
    [`--${prefix}-pressure`]: scene.pressure.toFixed(3),
    [`--${prefix}-headroom-db`]: scene.headroomDb === null ? '0' : scene.headroomDb.toFixed(1),
    [`--${prefix}-glow-alpha`]: (0.1 + scene.energy * 0.3 + scene.transient * 0.18).toFixed(3),
    [`--${prefix}-scale`]: (1 + scene.energy * 0.035 + scene.transient * 0.024).toFixed(4),
  };

  scene.bands.forEach((value, index) => {
    vars[`--${prefix}-band-${index}`] = value.toFixed(3);
  });

  return vars;
};
