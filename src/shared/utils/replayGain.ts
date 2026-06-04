import type { ReplayGainMode } from '../types/appSettings';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../constants/replayGain';

export type ReplayGainTrackData = {
  trackGainDb?: number | null;
  albumGainDb?: number | null;
  trackPeak?: number | null;
  albumPeak?: number | null;
  integratedLufs?: number | null;
};

export type ReplayGainCalculationInput = ReplayGainTrackData & {
  enabled: boolean;
  mode: ReplayGainMode;
  targetLufs?: number | null;
  preampDb: number;
  preventClipping: boolean;
};

export type ReplayGainCalculation = {
  appliedDb: number;
  selectedGainDb: number | null;
  selectedPeak: number | null;
  preventedClipping: boolean;
  active: boolean;
};

const roundDb = (value: number): number => Math.round(value * 1000) / 1000;

export const dbToLinearGain = (db: number): number => Math.pow(10, db / 20);

export const linearPeakToDb = (peak: number): number | null => {
  if (!Number.isFinite(peak) || peak <= 0) {
    return null;
  }
  return 20 * Math.log10(peak);
};

const finiteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const calculateReplayGain = (input: ReplayGainCalculationInput): ReplayGainCalculation => {
  if (!input.enabled || input.mode === 'off') {
    return {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak: null,
      preventedClipping: false,
      active: false,
    };
  }

  const trackGainDb = finiteNumberOrNull(input.trackGainDb);
  const albumGainDb = finiteNumberOrNull(input.albumGainDb);
  const integratedLufs = finiteNumberOrNull(input.integratedLufs);
  const targetLufs = finiteNumberOrNull(input.targetLufs) ?? DEFAULT_REPLAY_GAIN_TARGET_LUFS;
  const targetDerivedTrackGainDb = integratedLufs === null ? null : targetLufs - integratedLufs;
  const selectedGainDb = input.mode === 'album' ? albumGainDb ?? targetDerivedTrackGainDb ?? trackGainDb : targetDerivedTrackGainDb ?? trackGainDb;
  const trackPeak = finiteNumberOrNull(input.trackPeak);
  const albumPeak = finiteNumberOrNull(input.albumPeak);
  const selectedPeak = input.mode === 'album' ? albumPeak ?? trackPeak : trackPeak;

  if (selectedGainDb === null) {
    return {
      appliedDb: 0,
      selectedGainDb: null,
      selectedPeak,
      preventedClipping: false,
      active: false,
    };
  }

  let appliedDb = selectedGainDb + input.preampDb;
  let preventedClipping = false;

  if (input.preventClipping && selectedPeak !== null && selectedPeak > 0) {
    const maxGainDb = -20 * Math.log10(selectedPeak);
    if (appliedDb > maxGainDb) {
      appliedDb = maxGainDb;
      preventedClipping = true;
    }
  }

  return {
    appliedDb: roundDb(appliedDb),
    selectedGainDb: roundDb(selectedGainDb),
    selectedPeak,
    preventedClipping,
    active: true,
  };
};
