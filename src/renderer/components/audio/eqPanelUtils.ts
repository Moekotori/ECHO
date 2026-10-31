import type { AudioLevelTelemetry, ChannelBalanceState } from '../../../shared/types/audio';
import {
  channelBalanceMaxBalance,
  channelBalanceMaxDelayMs,
  channelBalanceMaxGainDb,
  channelBalanceMinBalance,
  channelBalanceMinDelayMs,
  channelBalanceMinGainDb,
} from '../../../shared/types/audio';
import type { EqBand, EqFilterType, EqState } from '../../../shared/types/eq';
import {
  eqFrequenciesHz,
  eqMaxFrequencyHz,
  eqMaxGainDb,
  eqMaxPreampDb,
  eqMinFrequencyHz,
  eqMinGainDb,
  eqMinPreampDb,
} from '../../../shared/types/eq';

export type EqCurvePoint = {
  x: number;
  y: number;
};

export type EqSpectrumBar = {
  x: number;
  value: number;
};

export type EqAnalyzerMode = 'input' | 'postEq';
export type EqAutoGainStatus = 'idle' | 'reducing' | 'recovering' | 'holding' | 'clipping';

export type EqAutoGainResult = {
  status: EqAutoGainStatus;
  targetPreampDb: number | null;
  adjustmentDb: number;
};

const curveMinFrequencyHz = 20;
const curveMaxFrequencyHz = 20000;
const curveSampleRate = 48000;
const responsePointCount = 192;
const gainEditableFilterTypes = new Set<EqFilterType>(['peaking', 'lowShelf', 'highShelf']);
export const eqAutoGainTargetHeadroomDb = 1;
export const eqAutoGainRecoveryIntervalMs = 2000;
export const eqAutoGainRecoveryStepDb = 0.5;
export const eqAutoGainManualHoldMs = 1200;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const formatDb = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;

export const formatFrequencyLabel = (frequencyHz: number): string => {
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}k`;
  }

  return String(frequencyHz);
};

export const isEqFilterGainEditable = (filterType: EqFilterType | undefined): boolean =>
  gainEditableFilterTypes.has(filterType ?? 'peaking');

export const computeRecommendedPreamp = (eqState: Pick<EqState, 'bands'>): number => {
  const maxBandGainDb = computeMaxBandGainDb(eqState.bands);
  return maxBandGainDb === 0 ? 0 : clamp(-maxBandGainDb, eqMinPreampDb, 0);
};

export const computeMaxBandGainDb = (bands: EqBand[]): number =>
  Math.max(0, ...bands.map((band) => (band.enabled === false || !isEqFilterGainEditable(band.filterType) ? 0 : band.gainDb)));

export const computeEstimatedPeakGain = (eqState: Pick<EqState, 'preampDb' | 'bands'>): number =>
  Math.round((eqState.preampDb + computeMaxBandGainDb(eqState.bands)) * 10) / 10;

export const computeLoudnessMatchedPreamp = (
  source: Pick<EqState, 'preampDb' | 'bands'>,
  target: Pick<EqState, 'preampDb' | 'bands'>,
): number => {
  const desiredPeakGain = computeEstimatedPeakGain(source);
  const targetMaxBandGain = computeMaxBandGainDb(target.bands);
  return Math.round(clamp(desiredPeakGain - targetMaxBandGain, eqMinPreampDb, eqMaxPreampDb) * 10) / 10;
};

const finiteNumberOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value) ? null : value;

const roundDb = (value: number): number => Math.round(value * 10) / 10;

export const computeAutoGainPreamp = ({
  eqState,
  audioLevels,
  baselinePreampDb,
  nowMs,
  lastAdjustmentAtMs,
  clippingRisk = false,
  targetHeadroomDb = eqAutoGainTargetHeadroomDb,
  recoveryIntervalMs = eqAutoGainRecoveryIntervalMs,
  recoveryStepDb = eqAutoGainRecoveryStepDb,
}: {
  eqState: Pick<EqState, 'preampDb' | 'bands' | 'clippingRisk'>;
  audioLevels: AudioLevelTelemetry | null | undefined;
  baselinePreampDb: number;
  nowMs: number;
  lastAdjustmentAtMs: number;
  clippingRisk?: boolean;
  targetHeadroomDb?: number;
  recoveryIntervalMs?: number;
  recoveryStepDb?: number;
}): EqAutoGainResult => {
  const currentPreampDb = clamp(Number.isFinite(eqState.preampDb) ? eqState.preampDb : 0, eqMinPreampDb, eqMaxPreampDb);
  const safeBaselineDb = clamp(Number.isFinite(baselinePreampDb) ? baselinePreampDb : currentPreampDb, eqMinPreampDb, eqMaxPreampDb);
  const safeTargetHeadroomDb = Math.max(0, Number.isFinite(targetHeadroomDb) ? targetHeadroomDb : eqAutoGainTargetHeadroomDb);
  const estimatedOutputPeakDb = finiteNumberOrNull(audioLevels?.estimatedOutputPeakDb);
  const headroomDb = finiteNumberOrNull(audioLevels?.headroomDb);
  const clipCount = Number.isFinite(audioLevels?.clipCount) ? Math.max(0, Number(audioLevels?.clipCount)) : 0;

  if (!audioLevels) {
    return { status: 'idle', targetPreampDb: null, adjustmentDb: roundDb(currentPreampDb - safeBaselineDb) };
  }

  const realtimeRisk =
    clippingRisk ||
    eqState.clippingRisk ||
    clipCount > 0 ||
    (estimatedOutputPeakDb !== null && estimatedOutputPeakDb >= -safeTargetHeadroomDb) ||
    (headroomDb !== null && headroomDb <= safeTargetHeadroomDb);

  if (realtimeRisk) {
    const reductionFromPeak = estimatedOutputPeakDb === null ? null : estimatedOutputPeakDb + safeTargetHeadroomDb;
    const reductionFromHeadroom = headroomDb === null ? null : safeTargetHeadroomDb - headroomDb;
    const requiredReductionDb = Math.max(
      clipCount > 0 || clippingRisk || eqState.clippingRisk ? 1 : 0,
      reductionFromPeak ?? 0,
      reductionFromHeadroom ?? 0,
      0.5,
    );
    const targetPreampDb = roundDb(clamp(currentPreampDb - requiredReductionDb, eqMinPreampDb, eqMaxPreampDb));

    if (targetPreampDb < currentPreampDb - 0.05) {
      return {
        status: clipCount > 0 || clippingRisk || eqState.clippingRisk ? 'clipping' : 'reducing',
        targetPreampDb,
        adjustmentDb: roundDb(targetPreampDb - safeBaselineDb),
      };
    }

    return { status: 'holding', targetPreampDb: null, adjustmentDb: roundDb(currentPreampDb - safeBaselineDb) };
  }

  const recoveryCeilingDb = Math.min(safeBaselineDb, computeRecommendedPreamp(eqState));
  if (currentPreampDb < recoveryCeilingDb - 0.05) {
    if (nowMs - lastAdjustmentAtMs < recoveryIntervalMs) {
      return { status: 'holding', targetPreampDb: null, adjustmentDb: roundDb(currentPreampDb - safeBaselineDb) };
    }

    const targetPreampDb = roundDb(clamp(Math.min(currentPreampDb + recoveryStepDb, recoveryCeilingDb), eqMinPreampDb, eqMaxPreampDb));
    return {
      status: 'recovering',
      targetPreampDb,
      adjustmentDb: roundDb(targetPreampDb - safeBaselineDb),
    };
  }

  return { status: 'idle', targetPreampDb: null, adjustmentDb: roundDb(currentPreampDb - safeBaselineDb) };
};

export const snapBandFrequency = (frequencyHz: number): number => {
  const safeFrequencyHz = clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz);
  return eqFrequenciesHz.reduce((nearest, candidate) => {
    const currentDistance = Math.abs(Math.log2(safeFrequencyHz / nearest));
    const nextDistance = Math.abs(Math.log2(safeFrequencyHz / candidate));
    return nextDistance < currentDistance ? candidate : nearest;
  }, eqFrequenciesHz[0]);
};

export const resolveBandFrequency = (frequencyHz: number, unlocked: boolean): number => {
  const safeFrequencyHz = clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz);
  return unlocked ? Math.round(safeFrequencyHz) : snapBandFrequency(safeFrequencyHz);
};

export type EqSnapshot = {
  preampDb: number;
  bands: EqBand[];
  presetId: string;
  presetName: string;
  clippingRisk: boolean;
};

export const captureEqSnapshot = (state: Pick<EqState, 'preampDb' | 'bands'> & Partial<Pick<EqState, 'presetId' | 'presetName' | 'clippingRisk'>>): EqSnapshot => ({
  preampDb: state.preampDb,
  bands: state.bands.map((band) => ({ ...band })),
  presetId: state.presetId ?? 'custom',
  presetName: state.presetName ?? 'Custom',
  clippingRisk: Boolean(state.clippingRisk),
});

export const createEqHistorySnapshot = captureEqSnapshot;

export type PresetCategory = 'target' | 'genre' | 'utility' | 'user';

export type PresetMetadata = {
  category: PresetCategory;
  targetTypeKey: string;
  purposeKey: string;
  scenarioKey: string;
  cautionKey: string;
  approximation: boolean;
};

const targetMetadata = (targetTypeKey: string): PresetMetadata => ({
  category: 'target',
  targetTypeKey,
  purposeKey: 'settings.eq.preset.meta.targetPurpose',
  scenarioKey: 'settings.eq.preset.meta.targetScenario',
  cautionKey: 'settings.eq.preset.meta.approximationCaution',
  approximation: true,
});

const genreMetadata = (targetTypeKey: string): PresetMetadata => ({
  category: 'genre',
  targetTypeKey,
  purposeKey: 'settings.eq.preset.meta.genrePurpose',
  scenarioKey: 'settings.eq.preset.meta.genreScenario',
  cautionKey: 'settings.eq.preset.meta.tasteCaution',
  approximation: false,
});

const utilityMetadata = (targetTypeKey: string): PresetMetadata => ({
  category: 'utility',
  targetTypeKey,
  purposeKey: 'settings.eq.preset.meta.utilityPurpose',
  scenarioKey: 'settings.eq.preset.meta.utilityScenario',
  cautionKey: 'settings.eq.preset.meta.utilityCaution',
  approximation: false,
});

const presetMetadataMap: Record<string, PresetMetadata> = {
  flat: utilityMetadata('settings.eq.preset.meta.type.flat'),
  'bass-boost': genreMetadata('settings.eq.preset.meta.type.bassBoost'),
  'vocal-clear': utilityMetadata('settings.eq.preset.meta.type.vocalClear'),
  'treble-sparkle': genreMetadata('settings.eq.preset.meta.type.trebleSparkle'),
  loudness: utilityMetadata('settings.eq.preset.meta.type.loudness'),
  night: utilityMetadata('settings.eq.preset.meta.type.night'),
  'headphone-warm': genreMetadata('settings.eq.preset.meta.type.headphoneWarm'),
  'anime-jpop': genreMetadata('settings.eq.preset.meta.type.animeJpop'),
  rock: genreMetadata('settings.eq.preset.meta.type.rock'),
  classical: genreMetadata('settings.eq.preset.meta.type.classical'),
  'harman-target': targetMetadata('settings.eq.preset.meta.type.harmanTarget'),
  'harman-in-ear': targetMetadata('settings.eq.preset.meta.type.harmanInEar'),
  'diffuse-field': targetMetadata('settings.eq.preset.meta.type.diffuseField'),
  'bk-room-curve': targetMetadata('settings.eq.preset.meta.type.bkRoomCurve'),
  'harman-over-ear-2013': targetMetadata('settings.eq.preset.meta.type.harmanTarget'),
  'harman-over-ear-2015': targetMetadata('settings.eq.preset.meta.type.harmanTarget'),
  'harman-over-ear-2018-no-bass': targetMetadata('settings.eq.preset.meta.type.harmanTarget'),
  'harman-in-ear-2016': targetMetadata('settings.eq.preset.meta.type.harmanInEar'),
  'harman-in-ear-2017': targetMetadata('settings.eq.preset.meta.type.harmanInEar'),
  'harman-in-ear-2019-no-bass': targetMetadata('settings.eq.preset.meta.type.harmanInEar'),
  'harman-speaker-room-2013': targetMetadata('settings.eq.preset.meta.type.bkRoomCurve'),
  'diffuse-field-iso-11904-1': targetMetadata('settings.eq.preset.meta.type.diffuseField'),
  'diffuse-field-gras-kemar': targetMetadata('settings.eq.preset.meta.type.diffuseField'),
  'diffuse-field-5128': targetMetadata('settings.eq.preset.meta.type.diffuseField'),
  'studio-neutral': utilityMetadata('settings.eq.preset.meta.type.studioNeutral'),
  'classic-smiley': genreMetadata('settings.eq.preset.meta.type.classicSmiley'),
  'vinyl-warmth': genreMetadata('settings.eq.preset.meta.type.vinylWarmth'),
  'broadcast-voice': utilityMetadata('settings.eq.preset.meta.type.broadcastVoice'),
  'city-pop': genreMetadata('settings.eq.preset.meta.type.cityPop'),
  'acoustic-silk': genreMetadata('settings.eq.preset.meta.type.acousticSilk'),
  'piano-room': genreMetadata('settings.eq.preset.meta.type.pianoRoom'),
  'lofi-dusk': genreMetadata('settings.eq.preset.meta.type.lofiDusk'),
  'cinema-orchestra': genreMetadata('settings.eq.preset.meta.type.cinemaOrchestra'),
  'live-house': genreMetadata('settings.eq.preset.meta.type.liveHouse'),
  'female-vocal-air': genreMetadata('settings.eq.preset.meta.type.femaleVocalAir'),
  'sub-cleanup': utilityMetadata('settings.eq.preset.meta.type.subCleanup'),
  'vocal-de-ess': utilityMetadata('settings.eq.preset.meta.type.vocalDeEss'),
  'headphone-notch': utilityMetadata('settings.eq.preset.meta.type.headphoneNotch'),
  'subsonic-filter': utilityMetadata('settings.eq.preset.meta.type.subsonicFilter'),
  'sibilance-tamer': utilityMetadata('settings.eq.preset.meta.type.sibilanceTamer'),
  'bluetooth-speaker-cleanup': utilityMetadata('settings.eq.preset.meta.type.bluetoothSpeakerCleanup'),
};

export const describePreset = (presetId: string): PresetMetadata | null => presetMetadataMap[presetId] ?? null;

const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

export const computeEffectiveChannelGains = (
  channelBalance: Pick<ChannelBalanceState, 'balance' | 'leftGainDb' | 'rightGainDb' | 'constantPower'>,
): { leftDb: number; rightDb: number } => {
  const safeBalance = clamp(channelBalance.balance, channelBalanceMinBalance, channelBalanceMaxBalance);

  if (!channelBalance.constantPower) {
    return {
      leftDb: channelBalance.leftGainDb + gainToDb(safeBalance > 0 ? 1 - safeBalance : 1),
      rightDb: channelBalance.rightGainDb + gainToDb(safeBalance < 0 ? 1 + safeBalance : 1),
    };
  }

  const pan = (safeBalance + 1) * Math.PI * 0.25;
  const compensation = Math.sqrt(2);
  return {
    leftDb: channelBalance.leftGainDb + gainToDb(Math.min(1, Math.cos(pan) * compensation)),
    rightDb: channelBalance.rightGainDb + gainToDb(Math.min(1, Math.sin(pan) * compensation)),
  };
};

const gainToCurveY = (gainDb: number): number => {
  const normalized = (clamp(gainDb, eqMinGainDb, eqMaxGainDb) - eqMinGainDb) / (eqMaxGainDb - eqMinGainDb);
  return clamp(1 - normalized, 0, 1);
};

const frequencyToCurveX = (frequencyHz: number): number => {
  const minLog = Math.log10(curveMinFrequencyHz);
  const maxLog = Math.log10(curveMaxFrequencyHz);
  const currentLog = Math.log10(clamp(frequencyHz, curveMinFrequencyHz, curveMaxFrequencyHz));
  return clamp((currentLog - minLog) / (maxLog - minLog), 0, 1);
};

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

const identityCoefficients: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

const makeNormalizedCoefficients = (
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): BiquadCoefficients => {
  if (!Number.isFinite(a0) || Math.abs(a0) < 1e-12) {
    return identityCoefficients;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
};

export const makeEqBiquadCoefficients = (band: EqBand): BiquadCoefficients => {
  if (band.enabled === false) {
    return identityCoefficients;
  }

  const frequencyHz = clamp(band.frequencyHz, curveMinFrequencyHz, curveSampleRate * 0.45);
  const q = clamp(Number.isFinite(band.q) ? band.q : 1, 0.1, 12);
  const gainDb = Number.isFinite(band.gainDb) ? band.gainDb : 0;
  const omega = 2 * Math.PI * frequencyHz / curveSampleRate;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const alpha = sinOmega / (2 * q);
  const filterType = band.filterType ?? 'peaking';

  if (filterType === 'lowPass') {
    return makeNormalizedCoefficients(
      (1 - cosOmega) / 2,
      1 - cosOmega,
      (1 - cosOmega) / 2,
      1 + alpha,
      -2 * cosOmega,
      1 - alpha,
    );
  }

  if (filterType === 'highPass') {
    return makeNormalizedCoefficients(
      (1 + cosOmega) / 2,
      -(1 + cosOmega),
      (1 + cosOmega) / 2,
      1 + alpha,
      -2 * cosOmega,
      1 - alpha,
    );
  }

  if (filterType === 'notch') {
    return makeNormalizedCoefficients(1, -2 * cosOmega, 1, 1 + alpha, -2 * cosOmega, 1 - alpha);
  }

  if (Math.abs(gainDb) < 0.0001) {
    return identityCoefficients;
  }

  const a = 10 ** (gainDb / 40);

  if (filterType === 'lowShelf' || filterType === 'highShelf') {
    const shelfSlope = Math.max(0.1, q);
    const sqrtA = Math.sqrt(a);
    const shelfAlpha = sinOmega / 2 * Math.sqrt(Math.max(0, (a + 1 / a) * (1 / shelfSlope - 1) + 2));
    const twoSqrtAAlpha = 2 * sqrtA * shelfAlpha;

    if (filterType === 'lowShelf') {
      return makeNormalizedCoefficients(
        a * ((a + 1) - (a - 1) * cosOmega + twoSqrtAAlpha),
        2 * a * ((a - 1) - (a + 1) * cosOmega),
        a * ((a + 1) - (a - 1) * cosOmega - twoSqrtAAlpha),
        (a + 1) + (a - 1) * cosOmega + twoSqrtAAlpha,
        -2 * ((a - 1) + (a + 1) * cosOmega),
        (a + 1) + (a - 1) * cosOmega - twoSqrtAAlpha,
      );
    }

    return makeNormalizedCoefficients(
      a * ((a + 1) + (a - 1) * cosOmega + twoSqrtAAlpha),
      -2 * a * ((a - 1) + (a + 1) * cosOmega),
      a * ((a + 1) + (a - 1) * cosOmega - twoSqrtAAlpha),
      (a + 1) - (a - 1) * cosOmega + twoSqrtAAlpha,
      2 * ((a - 1) - (a + 1) * cosOmega),
      (a + 1) - (a - 1) * cosOmega - twoSqrtAAlpha,
    );
  }

  return makeNormalizedCoefficients(
    1 + alpha * a,
    -2 * cosOmega,
    1 - alpha * a,
    1 + alpha / a,
    -2 * cosOmega,
    1 - alpha / a,
  );
};

export const computeBiquadGainDbAtFrequency = (coefficients: BiquadCoefficients, frequencyHz: number): number => {
  const omega = 2 * Math.PI * frequencyHz / curveSampleRate;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  const numeratorReal = coefficients.b0 + coefficients.b1 * cos1 + coefficients.b2 * cos2;
  const numeratorImag = -(coefficients.b1 * sin1 + coefficients.b2 * sin2);
  const denominatorReal = 1 + coefficients.a1 * cos1 + coefficients.a2 * cos2;
  const denominatorImag = -(coefficients.a1 * sin1 + coefficients.a2 * sin2);
  const numeratorMagnitude = Math.hypot(numeratorReal, numeratorImag);
  const denominatorMagnitude = Math.max(1e-12, Math.hypot(denominatorReal, denominatorImag));
  const gainDb = 20 * Math.log10(Math.max(1e-9, numeratorMagnitude / denominatorMagnitude));
  return Number.isFinite(gainDb) ? gainDb : 0;
};

export const computeEqResponseGainDbAtFrequency = (bands: EqBand[], frequencyHz: number): number => {
  const safeFrequencyHz = clamp(frequencyHz, curveMinFrequencyHz, curveMaxFrequencyHz);
  const gainDb = bands.reduce((sum, band) => sum + computeBiquadGainDbAtFrequency(makeEqBiquadCoefficients(band), safeFrequencyHz), 0);
  return Number.isFinite(gainDb) ? Math.round(gainDb * 10) / 10 : 0;
};

export const computeEqBandGainDbAtFrequency = (band: EqBand | undefined, frequencyHz: number): number =>
  band ? computeEqResponseGainDbAtFrequency([band], frequencyHz) : 0;

const curveXToFrequency = (x: number): number =>
  10 ** (Math.log10(curveMinFrequencyHz) + clamp(x, 0, 1) * (Math.log10(curveMaxFrequencyHz) - Math.log10(curveMinFrequencyHz)));

export const computeEqSpectrumBars = (
  spectrum: number[] | undefined,
  bands: EqBand[] = [],
  mode: EqAnalyzerMode = 'input',
): EqSpectrumBar[] => {
  if (!Array.isArray(spectrum) || spectrum.length === 0) {
    return [];
  }

  return spectrum.map((value, index) => {
    const x = spectrum.length === 1 ? 0.5 : index / (spectrum.length - 1);
    const safeValue = clamp(Number.isFinite(value) ? value : 0, 0, 1);
    const responseGainDb = mode === 'postEq' ? computeEqResponseGainDbAtFrequency(bands, curveXToFrequency(x)) : 0;
    return {
      x,
      value: clamp(safeValue + responseGainDb / 24, 0, 1),
    };
  });
};

export const computeEqBandNodePoint = (band: EqBand): EqCurvePoint => ({
  x: frequencyToCurveX(band.frequencyHz),
  y: gainToCurveY(band.enabled === false || !isEqFilterGainEditable(band.filterType) ? 0 : band.gainDb),
});

export const computeEqCurvePoints = (bands: EqBand[]): EqCurvePoint[] => {
  const coefficients = bands.map(makeEqBiquadCoefficients);

  return Array.from({ length: responsePointCount }, (_unused, index) => {
    const normalized = index / (responsePointCount - 1);
    const frequencyHz = 10 ** (Math.log10(curveMinFrequencyHz) + normalized * (Math.log10(curveMaxFrequencyHz) - Math.log10(curveMinFrequencyHz)));
    const gainDb = coefficients.reduce(
      (sum, coefficient) => sum + computeBiquadGainDbAtFrequency(coefficient, frequencyHz),
      0,
    );
    return {
      x: normalized,
      y: gainToCurveY(gainDb),
    };
  });
};

export const clampChannelBalancePatch = (patch: Partial<ChannelBalanceState>): Partial<ChannelBalanceState> => {
  const nextPatch = { ...patch };

  if (typeof nextPatch.balance === 'number') {
    nextPatch.balance = clamp(nextPatch.balance, channelBalanceMinBalance, channelBalanceMaxBalance);
  }

  if (typeof nextPatch.leftGainDb === 'number') {
    nextPatch.leftGainDb = clamp(nextPatch.leftGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb);
  }

  if (typeof nextPatch.rightGainDb === 'number') {
    nextPatch.rightGainDb = clamp(nextPatch.rightGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb);
  }
  if (typeof nextPatch.leftDelayMs === 'number') {
    nextPatch.leftDelayMs = clamp(nextPatch.leftDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs);
  }
  if (typeof nextPatch.rightDelayMs === 'number') {
    nextPatch.rightDelayMs = clamp(nextPatch.rightDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs);
  }

  return nextPatch;
};
