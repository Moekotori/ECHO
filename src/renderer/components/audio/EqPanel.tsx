import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AudioWaveform, Copy, Gauge, Headphones, Plus, RadioTower, Redo2, RotateCcw, Save, ShieldCheck, Shuffle, SlidersHorizontal, Sparkles, Trash2, Undo2, Waves } from 'lucide-react';
import type { AudioStatus, ChannelBalanceMonoMode, ChannelBalanceState } from '../../../shared/types/audio';
import {
  channelBalanceMaxDelayMs,
  channelBalanceMaxGainDb,
  channelBalanceMinDelayMs,
  channelBalanceMinGainDb,
} from '../../../shared/types/audio';
import type { EqBand, EqFilterType, EqPreset, EqPresetImportMetadata, EqPresetImportPreviewResult, EqProfile, EqProfileBindingInfo, EqProfileBindingTarget, EqState, RoomCorrectionState } from '../../../shared/types/eq';
import { dspHeadroomMaxDb, dspHeadroomMinDb, eqFilterTypes, eqFrequenciesHz, eqMaxFrequencyHz, eqMaxPreampDb, eqMaxQ, eqMinFrequencyHz, eqMinPreampDb, eqMinQ, roomCorrectionMaxTrimDb, roomCorrectionMinTrimDb } from '../../../shared/types/eq';
import { parseEqualizerApoPreset } from '../../../shared/utils/equalizerApoPreset';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { getEqBridge } from '../../utils/echoBridge';
import { EqCurveView } from './EqCurveView';
import { EqPresetSelector } from './EqPresetSelector';
import {
  captureEqSnapshot,
  clampChannelBalancePatch,
  computeEffectiveChannelGains,
  computeAutoGainPreamp,
  computeEstimatedPeakGain,
  computeLoudnessMatchedPreamp,
  computeMaxBandGainDb,
  computeRecommendedPreamp,
  createEqHistorySnapshot,
  describePreset,
  formatDb,
  formatFrequencyLabel,
  isEqFilterGainEditable,
  resolveBandFrequency,
  eqAutoGainManualHoldMs,
  type EqAutoGainStatus,
  type EqAnalyzerMode,
  type EqSnapshot,
} from './eqPanelUtils';

type EqPanelProps = {
  audioStatus: AudioStatus | null;
  onAudioStatusRefresh?: () => void;
  surface?: 'full' | 'eq-only';
};

type EqUiMode = 'simple' | 'pro';
type EqSimpleToneId = 'bass' | 'vocal' | 'air' | 'warm' | 'flat';
type EqSimpleToneOption = {
  id: EqSimpleToneId;
  icon: 'waves' | 'headphones' | 'waveform' | 'gauge' | 'reset';
  labelKey: TranslationKey;
  detailKey: TranslationKey;
};
type EqSimpleZoneOption = {
  id: 'low' | 'vocal' | 'air';
  minFrequencyHz: number;
  maxFrequencyHz: number;
  toneId: Extract<EqSimpleToneId, 'bass' | 'vocal' | 'air'>;
  labelKey: TranslationKey;
  detailKey: TranslationKey;
};
type EqSimpleZoneSummary = EqSimpleZoneOption & {
  averageGainDb: number;
  levelPercent: number;
};
type EqImportPreviewSummary = {
  activeFilterCount: number;
  estimatedPeakGainDb: number;
  maxBoostDb: number;
  maxBoostFrequencyHz: number | null;
  maxCutDb: number;
  maxCutFrequencyHz: number | null;
  recommendedPreampDb: number;
  safePreampNeeded: boolean;
};
type EqImportAuditionSnapshot = {
  snapshot: EqSnapshot;
  enabled: boolean;
};

const eqUiModeStorageKey = 'echo-next.eq.uiMode';
const eqAnalyzerStorageKey = 'echo-next.eq.spectrumAnalyzer';
const eqAnalyzerModeStorageKey = 'echo-next.eq.analyzerMode';
const eqAutoGainStorageKey = 'echo-next.eq.autoGainEnabled';
const headphoneCorrectionPresetPrefix = '耳机校正 -';

const readEqUiMode = (): EqUiMode => {
  try {
    return window.localStorage.getItem(eqUiModeStorageKey) === 'pro' ? 'pro' : 'simple';
  } catch {
    return 'simple';
  }
};

const readEqAnalyzerEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(eqAnalyzerStorageKey) === 'true';
  } catch {
    return false;
  }
};

const readEqAnalyzerMode = (): EqAnalyzerMode => {
  try {
    return window.localStorage.getItem(eqAnalyzerModeStorageKey) === 'postEq' ? 'postEq' : 'input';
  } catch {
    return 'input';
  }
};

const readEqAutoGainEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(eqAutoGainStorageKey) === 'true';
  } catch {
    return false;
  }
};

const isHeadphoneCorrectionPresetName = (presetName: string): boolean =>
  presetName.trim().startsWith(headphoneCorrectionPresetPrefix);

const formatHeadphoneCorrectionPresetDetail = (presetName: string): string =>
  presetName.replace(/^耳机校正 -\s*/u, '').trim() || presetName;

const fallbackState: EqState = {
  enabled: false,
  preampDb: 0,
  presetId: 'flat',
  presetName: '原音如初',
  clippingRisk: false,
  bands: eqFrequenciesHz.map((frequencyHz) => ({
    frequencyHz,
    gainDb: 0,
    q: 1,
    filterType: 'peaking',
    enabled: true,
  })),
};

const defaultBandSlot = (index: number): EqBand => ({
  frequencyHz: eqFrequenciesHz[index] ?? 1000,
  gainDb: 0,
  q: 1,
  filterType: 'peaking',
  enabled: true,
});

const bypassedBandSlot = (index: number): EqBand => ({
  ...defaultBandSlot(index),
  enabled: false,
});

const isBandSlotAvailable = (band: EqBand | undefined, index: number): boolean => {
  if (!band || band.enabled === false) {
    return true;
  }

  return (
    Math.abs(band.gainDb) <= 0.05 &&
    (band.filterType ?? 'peaking') === 'peaking' &&
    Math.abs((band.q ?? 1) - 1) <= 0.05 &&
    Math.abs((band.frequencyHz ?? eqFrequenciesHz[index] ?? 1000) - (eqFrequenciesHz[index] ?? 1000)) <= 0.05
  );
};

const roundSimpleToneGain = (gainDb: number, intensity = 1): number =>
  Math.round(gainDb * Math.max(0.5, Math.min(1.5, intensity)) * 10) / 10;

const simpleToneGainDb = (tone: EqSimpleToneId, frequencyHz: number, intensity = 1): number => {
  if (tone === 'flat') {
    return 0;
  }

  if (tone === 'bass') {
    if (frequencyHz <= 80) {
      return roundSimpleToneGain(2.5, intensity);
    }
    if (frequencyHz <= 160) {
      return roundSimpleToneGain(1.6, intensity);
    }
    if (frequencyHz <= 315) {
      return roundSimpleToneGain(0.7, intensity);
    }
    return frequencyHz >= 10000 ? roundSimpleToneGain(-0.4, intensity) : 0;
  }

  if (tone === 'vocal') {
    if (frequencyHz >= 800 && frequencyHz <= 2500) {
      return roundSimpleToneGain(1.7, intensity);
    }
    if (frequencyHz >= 315 && frequencyHz < 800) {
      return roundSimpleToneGain(0.7, intensity);
    }
    if (frequencyHz >= 5000 && frequencyHz <= 8000) {
      return roundSimpleToneGain(-0.8, intensity);
    }
    return frequencyHz <= 80 ? roundSimpleToneGain(-0.4, intensity) : 0;
  }

  if (tone === 'air') {
    if (frequencyHz >= 10000) {
      return roundSimpleToneGain(2, intensity);
    }
    if (frequencyHz >= 5000) {
      return roundSimpleToneGain(1.1, intensity);
    }
    return frequencyHz <= 160 ? roundSimpleToneGain(-0.5, intensity) : 0;
  }

  if (frequencyHz <= 125) {
    return roundSimpleToneGain(1.4, intensity);
  }
  if (frequencyHz >= 4000) {
    return roundSimpleToneGain(-0.9, intensity);
  }
  return frequencyHz >= 250 && frequencyHz <= 1000 ? roundSimpleToneGain(0.4, intensity) : 0;
};

const fallbackChannelBalanceState: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
};

const monoModeOptions: ChannelBalanceMonoMode[] = ['off', 'sum', 'left', 'right'];
const monoModeLabelKeys: Record<ChannelBalanceMonoMode, TranslationKey> = {
  off: 'settings.eq.channel.mono.off',
  sum: 'settings.eq.channel.mono.sum',
  left: 'settings.eq.channel.mono.left',
  right: 'settings.eq.channel.mono.right',
};

const maxHistoryLength = 24;
const eqControlDebounceMs = 12;
const eqFilterLabelKeys: Record<EqFilterType, TranslationKey> = {
  peaking: 'settings.eq.filter.peaking',
  lowShelf: 'settings.eq.filter.lowShelf',
  highShelf: 'settings.eq.filter.highShelf',
  lowPass: 'settings.eq.filter.lowPass',
  highPass: 'settings.eq.filter.highPass',
  notch: 'settings.eq.filter.notch',
};

const simpleToneOptions: EqSimpleToneOption[] = [
  { id: 'bass', icon: 'waves', labelKey: 'settings.eq.simpleTone.bass', detailKey: 'settings.eq.simpleTone.bassDetail' },
  { id: 'vocal', icon: 'headphones', labelKey: 'settings.eq.simpleTone.vocal', detailKey: 'settings.eq.simpleTone.vocalDetail' },
  { id: 'air', icon: 'waveform', labelKey: 'settings.eq.simpleTone.air', detailKey: 'settings.eq.simpleTone.airDetail' },
  { id: 'warm', icon: 'gauge', labelKey: 'settings.eq.simpleTone.warm', detailKey: 'settings.eq.simpleTone.warmDetail' },
  { id: 'flat', icon: 'reset', labelKey: 'settings.eq.simpleTone.flat', detailKey: 'settings.eq.simpleTone.flatDetail' },
];
const exploratorySimpleToneIds: Exclude<EqSimpleToneId, 'flat'>[] = ['bass', 'vocal', 'air', 'warm'];
const simpleZoneOptions: EqSimpleZoneOption[] = [
  { id: 'low', minFrequencyHz: 20, maxFrequencyHz: 160, toneId: 'bass', labelKey: 'settings.eq.simpleZone.low', detailKey: 'settings.eq.simpleZone.lowDetail' },
  { id: 'vocal', minFrequencyHz: 250, maxFrequencyHz: 4000, toneId: 'vocal', labelKey: 'settings.eq.simpleZone.vocal', detailKey: 'settings.eq.simpleZone.vocalDetail' },
  { id: 'air', minFrequencyHz: 5000, maxFrequencyHz: 20000, toneId: 'air', labelKey: 'settings.eq.simpleZone.air', detailKey: 'settings.eq.simpleZone.airDetail' },
];
const eqQPresetValues: Record<EqFilterType, { wide: number; normal: number; narrow: number }> = {
  peaking: { wide: 0.7, normal: 1.4, narrow: 4 },
  lowShelf: { wide: 0.5, normal: 0.7, narrow: 1.2 },
  highShelf: { wide: 0.5, normal: 0.7, narrow: 1.2 },
  lowPass: { wide: 0.5, normal: 0.7, narrow: 1.2 },
  highPass: { wide: 0.5, normal: 0.7, narrow: 1.2 },
  notch: { wide: 3, normal: 6, narrow: 10 },
};

const fallbackRoomCorrectionState: RoomCorrectionState = {
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'none',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
};
const roomCorrectionErrorLabelKeys: Record<string, TranslationKey> = {
  invalid_impulse: 'settings.eq.room.error.invalidImpulse',
  invalid_wav: 'settings.eq.room.error.invalidWav',
  impulse_too_long: 'settings.eq.room.error.tooLong',
  missing_file: 'settings.eq.room.error.missingFile',
  missing_ir: 'settings.eq.room.error.missingIr',
};
const eqAutoGainStatusKeys: Record<EqAutoGainStatus, TranslationKey> = {
  idle: 'settings.eq.autoGain.status.idle',
  reducing: 'settings.eq.autoGain.status.reducing',
  recovering: 'settings.eq.autoGain.status.recovering',
  holding: 'settings.eq.autoGain.status.holding',
  clipping: 'settings.eq.autoGain.status.clipping',
};
type EqImportCompatibility = 'clean' | 'adjusted' | 'partial';
const eqImportCompatibilityLabelKeys: Record<EqImportCompatibility, TranslationKey> = {
  clean: 'settings.eq.import.compatibility.clean',
  adjusted: 'settings.eq.import.compatibility.adjusted',
  partial: 'settings.eq.import.compatibility.partial',
};

const formatLevelDb = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return formatDb(value);
};

const formatDelayMs = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(2)} ms`;
};

const parseOptionalNumber = (value: string): number | null => {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundCalibrationDelayMs = (value: number): number =>
  Math.round(Math.max(channelBalanceMinDelayMs, Math.min(channelBalanceMaxDelayMs, value)) * 100) / 100;

const roundCalibrationGainDb = (value: number): number =>
  Math.round(Math.max(channelBalanceMinGainDb, Math.min(channelBalanceMaxGainDb, value)) * 10) / 10;

const speedOfSoundCmPerMs = 34.3;
const spatialDelayNudgeMs = 0.05;
const spatialGainNudgeDb = 0.2;

const estimateSlotOutputPeak = (slot: EqSnapshot, inputPeakDb: number | null | undefined): number | null => {
  if (inputPeakDb === null || inputPeakDb === undefined || !Number.isFinite(inputPeakDb)) {
    return null;
  }

  return Math.round((inputPeakDb + computeEstimatedPeakGain(slot)) * 10) / 10;
};

const formatApoDirectiveSummary = (summary: Record<string, number> | undefined): string => {
  const entries = Object.entries(summary ?? {}).filter(([, count]) => count > 0);
  return entries.map(([name, count]) => `${name} x${count}`).join(' / ');
};

const sanitizeImportedPresetId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || `apo-${Date.now()}`;

const uniqueImportedPresetId = (name: string, presets: EqPreset[]): string => {
  const existingIds = new Set(presets.map((preset) => preset.id));
  const baseId = sanitizeImportedPresetId(name);
  let candidate = baseId;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const summarizeSimpleZones = (bands: EqBand[]): EqSimpleZoneSummary[] =>
  simpleZoneOptions.map((zone) => {
    const zoneBands = bands.filter((band) =>
      band.enabled !== false &&
      isEqFilterGainEditable(band.filterType) &&
      band.frequencyHz >= zone.minFrequencyHz &&
      band.frequencyHz <= zone.maxFrequencyHz,
    );
    const averageGainDb = zoneBands.length
      ? Math.round((zoneBands.reduce((total, band) => total + band.gainDb, 0) / zoneBands.length) * 10) / 10
      : 0;

    return {
      ...zone,
      averageGainDb,
      levelPercent: Math.min(100, Math.round((Math.abs(averageGainDb) / 6) * 100)),
    };
  });

const summarizeImportPreview = (preview: EqPresetImportPreviewResult | null): EqImportPreviewSummary | null => {
  if (!preview) {
    return null;
  }

  const activeEditableBands = preview.request.bands.filter((band) => band.enabled !== false && isEqFilterGainEditable(band.filterType));
  const maxBoostBand = activeEditableBands.reduce<EqBand | null>((current, band) => (
    !current || band.gainDb > current.gainDb ? band : current
  ), null);
  const maxCutBand = activeEditableBands.reduce<EqBand | null>((current, band) => (
    !current || band.gainDb < current.gainDb ? band : current
  ), null);
  const recommendedPreampDb = computeRecommendedPreamp({ bands: preview.request.bands });

  return {
    activeFilterCount: preview.request.bands.filter((band) => band.enabled !== false).length,
    estimatedPeakGainDb: computeEstimatedPeakGain({
      preampDb: preview.request.preampDb,
      bands: preview.request.bands,
    }),
    maxBoostDb: Math.max(0, maxBoostBand?.gainDb ?? 0),
    maxBoostFrequencyHz: maxBoostBand && maxBoostBand.gainDb > 0 ? maxBoostBand.frequencyHz : null,
    maxCutDb: Math.min(0, maxCutBand?.gainDb ?? 0),
    maxCutFrequencyHz: maxCutBand && maxCutBand.gainDb < 0 ? maxCutBand.frequencyHz : null,
    recommendedPreampDb,
    safePreampNeeded: preview.request.preampDb > recommendedPreampDb + 0.05,
  };
};

const resolveImportCompatibility = (metadata: EqPresetImportMetadata): EqImportCompatibility => {
  if (
    metadata.skippedFilterCount > 0 ||
    metadata.skippedIncludeCount > 0 ||
    metadata.channelScopedFilterCount > 0 ||
    metadata.unsupportedDirectiveCount > 0
  ) {
    return 'partial';
  }

  if (metadata.graphicEqPointCount > 0 || metadata.bandwidthFilterCount > 0 || metadata.includedFileCount > 0) {
    return 'adjusted';
  }

  return 'clean';
};

export const EqPanel = ({ audioStatus, onAudioStatusRefresh, surface = 'full' }: EqPanelProps): JSX.Element => {
  const { t } = useI18n();
  const [state, setState] = useState<EqState>(fallbackState);
  const [channelBalance, setChannelBalance] = useState<ChannelBalanceState>(fallbackChannelBalanceState);
  const [roomCorrection, setRoomCorrection] = useState<RoomCorrectionState>(fallbackRoomCorrectionState);
  const [presets, setPresets] = useState<EqPreset[]>([]);
  const [profiles, setProfiles] = useState<EqProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileBinding, setProfileBinding] = useState<EqProfileBindingInfo>(null);
  const [saveName, setSaveName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<EqPresetImportPreviewResult | null>(null);
  const [importReport, setImportReport] = useState<{ presetName: string; preampDb: number; metadata: EqPresetImportMetadata } | null>(null);
  const [importAuditionSnapshot, setImportAuditionSnapshot] = useState<EqImportAuditionSnapshot | null>(null);
  const [apoPasteOpen, setApoPasteOpen] = useState(false);
  const [apoPasteText, setApoPasteText] = useState('');
  const [selectedBandIndex, setSelectedBandIndex] = useState(0);
  const [bypassSnapshot, setBypassSnapshot] = useState<boolean | null>(null);
  const [frequencyUnlocked, setFrequencyUnlocked] = useState(false);
  const [abSlots, setAbSlots] = useState<{ a: EqSnapshot | null; b: EqSnapshot | null }>({ a: null, b: null });
  const [undoStack, setUndoStack] = useState<EqSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EqSnapshot[]>([]);
  const [loudnessMatchedAb, setLoudnessMatchedAb] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationLeftDistanceCm, setCalibrationLeftDistanceCm] = useState('');
  const [calibrationRightDistanceCm, setCalibrationRightDistanceCm] = useState('');
  const [calibrationLeftSplDb, setCalibrationLeftSplDb] = useState('');
  const [calibrationRightSplDb, setCalibrationRightSplDb] = useState('');
  const [eqUiMode, setEqUiMode] = useState<EqUiMode>(readEqUiMode);
  const [spectrumAnalyzerEnabled, setSpectrumAnalyzerEnabled] = useState(readEqAnalyzerEnabled);
  const [analyzerMode, setAnalyzerMode] = useState<EqAnalyzerMode>(readEqAnalyzerMode);
  const [autoGainEnabled, setAutoGainEnabled] = useState(readEqAutoGainEnabled);
  const [autoGainStatus, setAutoGainStatus] = useState<EqAutoGainStatus>('idle');
  const [autoGainAdjustmentDb, setAutoGainAdjustmentDb] = useState(0);
  const [simpleToneIntensity, setSimpleToneIntensity] = useState(1);
  const debounceTimers = useRef<Record<number, number>>({});
  const frequencyDebounceTimers = useRef<Record<number, number>>({});
  const editStartSnapshot = useRef<EqSnapshot | null>(null);
  const autoGainBaselinePreampDb = useRef<number | null>(null);
  const autoGainLastAdjustmentAtMs = useRef(0);
  const autoGainManualHoldUntilMs = useRef(0);
  const autoGainApplying = useRef(false);
  const showAdvancedTools = eqUiMode === 'pro';
  const showEmbeddedDspModules = surface !== 'eq-only';

  const selectedPreset = presets.find((preset) => preset.id === state.presetId);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedPresetReadonly = selectedPreset?.readonly ?? true;
  const canOverwritePreset = Boolean(selectedPreset && !selectedPreset.readonly);
  const headphoneCorrectionPresetActive = isHeadphoneCorrectionPresetName(state.presetName);
  const headphoneCorrectionManaged = headphoneCorrectionPresetActive && state.presetId !== 'custom';
  const headphoneCorrectionDetail = headphoneCorrectionPresetActive ? formatHeadphoneCorrectionPresetDetail(state.presetName) : '';
  const frequencyEditUnlocked = showAdvancedTools && frequencyUnlocked && !headphoneCorrectionManaged;
  const audioLevels = audioStatus?.audioLevels ?? null;
  const visualSpectrumBins = Array.isArray(audioLevels?.visualSpectrum) ? audioLevels.visualSpectrum : [];
  const visualSpectrumHasSignal = visualSpectrumBins.some((value) => Number.isFinite(value) && value > 0.01);
  const visualSpectrumReady = visualSpectrumBins.length > 0 && audioLevels?.visualTelemetryState !== 'fallback' && visualSpectrumHasSignal;
  const analyzerStatusState = !spectrumAnalyzerEnabled
    ? 'off'
    : audioLevels?.visualTelemetryState === 'priming'
      ? 'priming'
      : visualSpectrumReady
        ? 'live'
        : 'noSignal';
  const analyzerStatusKey: TranslationKey = analyzerStatusState === 'live'
    ? 'settings.eq.analyzer.status.live'
    : analyzerStatusState === 'priming'
      ? 'settings.eq.analyzer.status.priming'
      : analyzerStatusState === 'noSignal'
        ? 'settings.eq.analyzer.status.noSignal'
        : 'settings.eq.analyzer.status.off';
  const estimatedOutputPeakDb = audioLevels?.estimatedOutputPeakDb ?? null;
  const realtimeLevelClippingRisk = estimatedOutputPeakDb !== null && estimatedOutputPeakDb >= 0;
  const realtimeLevelClipped = (audioLevels?.clipCount ?? 0) > 0;
  const dspLimiterProtecting = audioStatus?.dspLimiterProtecting === true;
  const clippingRisk = Boolean(state.clippingRisk || roomCorrection.clippingRisk || channelBalance.clippingRisk || audioStatus?.clippingRisk || audioStatus?.dspClippingRisk || dspLimiterProtecting || realtimeLevelClippingRisk || realtimeLevelClipped);
  const eqOrBalanceEnabled = state.enabled || roomCorrection.enabled || channelBalance.enabled;
  const dspActive = Boolean(audioStatus?.dspActive || eqOrBalanceEnabled);
  const surfaceDspActive = showEmbeddedDspModules ? dspActive : state.enabled;
  const surfaceClippingRisk = showEmbeddedDspModules ? clippingRisk : Boolean(state.clippingRisk || audioStatus?.clippingRisk || audioStatus?.dspClippingRisk || dspLimiterProtecting || realtimeLevelClippingRisk || realtimeLevelClipped);
  const dspHeadroomArmed = Math.abs(state.dspHeadroomDb ?? 0) > 0.05;
  const dspHeadroomActive = dspActive && dspHeadroomArmed;
  const recommendedPreampDb = computeRecommendedPreamp(state);
  const maxBandGainDb = computeMaxBandGainDb(state.bands);
  const estimatedPeakGainDb = computeEstimatedPeakGain(state);
  const canAutoPreamp = Math.abs(state.preampDb - recommendedPreampDb) > 0.05;
  const selectedBand = state.bands[selectedBandIndex] ?? state.bands[0];
  const selectedBandFilterType = selectedBand?.filterType ?? 'peaking';
  const selectedBandGainEditable = isEqFilterGainEditable(selectedBandFilterType);
  const selectedBandQPresets = eqQPresetValues[selectedBandFilterType];
  const selectedBandEnabled = selectedBand?.enabled !== false;
  const activeBandCount = state.bands.filter((band) => band.enabled !== false).length;
  const configuredBandCount = state.bands.filter((band, index) => !isBandSlotAvailable(band, index)).length;
  const hasCustomEqShape = Math.abs(state.preampDb) > 0.05 || state.bands.some((band) => (
    band.enabled !== false &&
    isEqFilterGainEditable(band.filterType) &&
    Math.abs(band.gainDb) > 0.05
  ));
  const selectedBandMode = frequencyEditUnlocked ? t('settings.eq.band.modeFree') : t('settings.eq.band.modeStandard');
  const selectedPresetMetadata = describePreset(state.presetId);
  const simpleToneNames = simpleToneOptions.map((option) => ({ id: option.id, name: t(option.labelKey) }));
  const activeSimpleTone = state.presetId === 'custom'
    ? simpleToneNames.find((option) => option.name === state.presetName)?.id ?? null
    : null;
  const simpleZoneSummaries = summarizeSimpleZones(state.bands);
  const simpleDominantZone = simpleZoneSummaries.reduce<EqSimpleZoneSummary | null>((strongest, zone) => (
    !strongest || Math.abs(zone.averageGainDb) > Math.abs(strongest.averageGainDb) ? zone : strongest
  ), null);
  const displayPresetName = state.presetId === 'custom'
    ? activeSimpleTone
      ? state.presetName
      : t('settings.eq.preset.modified')
    : state.presetName;
  const displayPresetLabel = headphoneCorrectionManaged ? t('settings.eq.headphoneCorrection.managed') : displayPresetName;
  const canSaveSimplePreset = state.presetId === 'custom' && hasCustomEqShape;
  const needsSafePreamp = estimatedPeakGainDb > 0 || surfaceClippingRisk;
  const simpleInsightVibe = activeSimpleTone
    ? state.presetName
    : hasCustomEqShape
      ? t('settings.eq.simpleInsight.custom')
      : t('settings.eq.simpleZone.neutral');
  const simpleInsightMainChange = simpleDominantZone && Math.abs(simpleDominantZone.averageGainDb) > 0.05
    ? `${t(simpleDominantZone.labelKey)} ${formatDb(simpleDominantZone.averageGainDb)}`
    : t('settings.eq.simpleZone.neutral');
  const simpleInsightAmount = activeSimpleTone && activeSimpleTone !== 'flat'
    ? `${Math.round(simpleToneIntensity * 100)}%`
    : t('settings.eq.simpleInsight.ready');
  const simpleSafetyTitle = needsSafePreamp ? t('settings.eq.simpleSafety.risk') : t('settings.eq.simpleSafety.safe');
  const simpleSafetyDetail = needsSafePreamp
    ? t('settings.eq.simpleSafety.riskDetail', { peak: formatDb(estimatedPeakGainDb), preamp: formatDb(recommendedPreampDb) })
    : t('settings.eq.simpleSafety.safeDetail', { peak: formatDb(estimatedPeakGainDb), preamp: formatDb(state.preampDb) });
  const autoGainActive = autoGainEnabled && (autoGainStatus === 'reducing' || autoGainStatus === 'recovering' || autoGainStatus === 'clipping');
  const roomCorrectionStatusLabel = roomCorrection.error
    ? t(roomCorrectionErrorLabelKeys[roomCorrection.error] ?? 'settings.eq.room.error')
    : roomCorrection.status === 'active'
      ? t('settings.eq.room.active')
      : roomCorrection.status === 'loaded'
        ? t('settings.eq.room.loaded')
        : roomCorrection.status === 'error'
          ? t('settings.eq.room.error')
          : t('settings.eq.room.empty');
  const currentOutputTarget: EqProfileBindingTarget = {
    outputMode: audioStatus?.outputMode ?? 'shared',
    outputBackend: audioStatus?.outputBackend ?? null,
    sharedBackend: audioStatus?.sharedBackend ?? null,
    outputDeviceId: audioStatus?.outputDeviceId ?? null,
    outputDeviceName: audioStatus?.outputDeviceName ?? null,
    outputDeviceType: audioStatus?.outputDeviceType ?? null,
  };
  const currentOutputLabel = profileBinding?.label ?? `${(currentOutputTarget.outputMode ?? 'shared').toUpperCase()} / ${currentOutputTarget.outputDeviceName ?? t('settings.eq.profile.noOutput')}`;
  const importPreviewRelevantBands = importPreview
    ? importPreview.request.bands
      .map((band, index) => ({ band, index }))
      .filter(({ band, index }) => {
        if (importPreview.metadata.source === 'equalizer-apo' && importPreview.metadata.importedFilterCount > 0) {
          return index < importPreview.metadata.importedFilterCount;
        }

        const standardFrequency = eqFrequenciesHz[index] ?? band.frequencyHz;
        return band.enabled !== false && (
          Math.abs(band.gainDb) > 0.05 ||
          (band.filterType ?? 'peaking') !== 'peaking' ||
          Math.abs((band.q ?? 1) - 1) > 0.05 ||
          Math.abs((band.frequencyHz ?? standardFrequency) - standardFrequency) > 0.05
        );
      })
    : [];
  const importPreviewDisplayBands = importPreviewRelevantBands;
  const importPreviewHiddenBandCount = Math.max(0, importPreviewRelevantBands.length - importPreviewDisplayBands.length);
  const importPreviewDirectiveSummary = formatApoDirectiveSummary(importPreview?.metadata.unsupportedDirectiveSummary);
  const importReportDirectiveSummary = formatApoDirectiveSummary(importReport?.metadata.unsupportedDirectiveSummary);
  const importPreviewCompatibility = importPreview ? resolveImportCompatibility(importPreview.metadata) : null;
  const importReportCompatibility = importReport ? resolveImportCompatibility(importReport.metadata) : null;
  const importPreviewSummary = summarizeImportPreview(importPreview);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const eq = getEqBridge();

      if (!eq) {
        setPresets([]);
        setProfiles([]);
        setError(t('settings.eq.error.bridgeControlEq'));
        return;
      }

      const [nextState, nextPresets, nextProfiles, nextBinding, nextChannelBalance, nextRoomCorrection] = await Promise.all([
        eq.getState(),
        eq.listPresets(),
        eq.listProfiles(),
        eq.getProfileBinding(currentOutputTarget),
        eq.getChannelBalanceState(),
        eq.getRoomCorrectionState?.() ?? Promise.resolve(fallbackRoomCorrectionState),
      ]);
      setState(nextState);
      setPresets(nextPresets);
      setProfiles(nextProfiles);
      setProfileBinding(nextBinding);
      if (!selectedProfileId && nextProfiles[0]) {
        setSelectedProfileId(nextProfiles[0].id);
      }
      setChannelBalance(nextChannelBalance);
      setRoomCorrection(nextRoomCorrection);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [currentOutputTarget.outputBackend, currentOutputTarget.outputDeviceId, currentOutputTarget.outputDeviceName, currentOutputTarget.outputDeviceType, currentOutputTarget.outputMode, currentOutputTarget.sharedBackend, selectedProfileId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!showAdvancedTools && frequencyUnlocked) {
      setFrequencyUnlocked(false);
    }
  }, [frequencyUnlocked, showAdvancedTools]);

  useEffect(() => {
    try {
      window.localStorage.setItem(eqUiModeStorageKey, eqUiMode);
    } catch {
      // UI mode persistence is best-effort; EQ state and audio processing are unaffected.
    }
  }, [eqUiMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(eqAnalyzerStorageKey, spectrumAnalyzerEnabled ? 'true' : 'false');
    } catch {
      // Analyzer visibility is UI-only; audio telemetry continues independently.
    }
  }, [spectrumAnalyzerEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(eqAnalyzerModeStorageKey, analyzerMode);
    } catch {
      // Analyzer mode is UI-only and can fall back to Input at any time.
    }
  }, [analyzerMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(eqAutoGainStorageKey, autoGainEnabled ? 'true' : 'false');
    } catch {
      // Auto Gain is UI-driven safety automation; persistence can fall back to off.
    }
  }, [autoGainEnabled]);

  useEffect(() => {
    const profile = profiles.find((item) => item.id === selectedProfileId);
    if (profile && !profileName) {
      setProfileName(profile.name);
    }
  }, [profileName, profiles, selectedProfileId]);

  const commitState = useCallback(
    (nextState: EqState): void => {
      setState(nextState);
      onAudioStatusRefresh?.();
    },
    [onAudioStatusRefresh],
  );

  const commitChannelBalance = useCallback(
    (nextState: ChannelBalanceState): void => {
      setChannelBalance(nextState);
      onAudioStatusRefresh?.();
    },
    [onAudioStatusRefresh],
  );

  const commitRoomCorrection = useCallback(
    (nextState: RoomCorrectionState): void => {
      setRoomCorrection(nextState);
      onAudioStatusRefresh?.();
    },
    [onAudioStatusRefresh],
  );

  useEffect(() => {
    if (!autoGainEnabled) {
      autoGainBaselinePreampDb.current = null;
      autoGainLastAdjustmentAtMs.current = 0;
      setAutoGainStatus('idle');
      setAutoGainAdjustmentDb(0);
      return;
    }

    if (autoGainBaselinePreampDb.current === null) {
      autoGainBaselinePreampDb.current = state.preampDb;
    }

    if (autoGainApplying.current) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs < autoGainManualHoldUntilMs.current) {
      setAutoGainStatus('holding');
      setAutoGainAdjustmentDb(Math.round((state.preampDb - (autoGainBaselinePreampDb.current ?? state.preampDb)) * 10) / 10);
      return;
    }

    const result = computeAutoGainPreamp({
      eqState: state,
      audioLevels,
      baselinePreampDb: autoGainBaselinePreampDb.current,
      nowMs,
      lastAdjustmentAtMs: autoGainLastAdjustmentAtMs.current,
      clippingRisk,
    });

    setAutoGainStatus(result.status);
    setAutoGainAdjustmentDb(result.adjustmentDb);

    if (result.targetPreampDb === null || Math.abs(result.targetPreampDb - state.preampDb) <= 0.05) {
      return;
    }

    const eq = getEqBridge();
    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    autoGainApplying.current = true;
    autoGainLastAdjustmentAtMs.current = nowMs;
    setState((current) => ({
      ...current,
      preampDb: result.targetPreampDb ?? current.preampDb,
      presetId: 'custom',
      presetName: 'Custom',
    }));

    void eq.setPreamp(result.targetPreampDb).then((nextState) => {
      autoGainApplying.current = false;
      commitState(nextState);
      setError(null);
    }).catch((autoGainError: unknown) => {
      autoGainApplying.current = false;
      setError(autoGainError instanceof Error ? autoGainError.message : String(autoGainError));
    });
  }, [audioLevels, autoGainEnabled, clippingRisk, commitState, state, t]);

  const pushUndoSnapshot = useCallback((snapshot: EqSnapshot): void => {
    setUndoStack((current) => [...current, snapshot].slice(-maxHistoryLength));
    setRedoStack([]);
  }, []);

  const clearGainDebounce = (band: number): void => {
    window.clearTimeout(debounceTimers.current[band]);
    delete debounceTimers.current[band];
  };

  const clearFrequencyDebounce = (band: number): void => {
    window.clearTimeout(frequencyDebounceTimers.current[band]);
    delete frequencyDebounceTimers.current[band];
  };

  const clearAllGainDebounces = (): void => {
    Object.keys(debounceTimers.current).forEach((band) => clearGainDebounce(Number(band)));
  };

  const clearAllFrequencyDebounces = (): void => {
    Object.keys(frequencyDebounceTimers.current).forEach((band) => clearFrequencyDebounce(Number(band)));
  };

  const beginEqEdit = (): void => {
    if (!editStartSnapshot.current) {
      editStartSnapshot.current = createEqHistorySnapshot(state);
    }
  };

  const commitEqEdit = (): void => {
    if (editStartSnapshot.current) {
      pushUndoSnapshot(editStartSnapshot.current);
      editStartSnapshot.current = null;
    }
  };

  const requireCustomHeadphoneCorrection = (): boolean => {
    if (!headphoneCorrectionManaged) {
      return true;
    }

    setError(t('settings.eq.headphoneCorrection.lockedError'));
    return false;
  };

  const convertHeadphoneCorrectionToCustom = async (): Promise<void> => {
    if (!headphoneCorrectionManaged) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const saved = await eq.savePreset({
        id: `custom-${state.presetId}-${Date.now()}`,
        name: t('settings.eq.headphoneCorrection.customName', { name: headphoneCorrectionDetail }),
        preampDb: state.preampDb,
        bands: state.bands,
      });
      setPresets(await eq.listPresets());
      pushUndoSnapshot(createEqHistorySnapshot(state));
      commitState({
        ...state,
        presetId: saved.id,
        presetName: saved.name,
        preampDb: saved.preampDb,
        bands: saved.bands.map((band) => ({ ...band })),
        clippingRisk: false,
      });
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const toggleHeadphoneCorrectionCompare = (): void => {
    if (!headphoneCorrectionPresetActive) {
      return;
    }

    setEnabled(!state.enabled);
  };

  const setEnabled = (enabled: boolean): void => {
    const eq = getEqBridge();
    setState((current) => ({ ...current, enabled }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.setEnabled(enabled).then(commitState).catch((toggleError: unknown) => {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    });
  };

  const toggleAutoGain = (): void => {
    const enabled = !autoGainEnabled;
    autoGainBaselinePreampDb.current = enabled ? state.preampDb : null;
    autoGainLastAdjustmentAtMs.current = 0;
    autoGainManualHoldUntilMs.current = 0;
    setAutoGainStatus('idle');
    setAutoGainAdjustmentDb(0);
    setAutoGainEnabled(enabled);
  };

  const sendBandGain = useCallback(
    (band: number, gainDb: number): void => {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeControlEq'));
        return;
      }

      void eq.setBandGain({ band, gainDb }).then(commitState).catch((bandError: unknown) => {
        setError(bandError instanceof Error ? bandError.message : String(bandError));
      });
    },
    [commitState, t],
  );

  const handleBandChange = (band: number, gainDb: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    if (!isEqFilterGainEditable(state.bands[band]?.filterType)) {
      return;
    }

    beginEqEdit();
    setSelectedBandIndex(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, gainDb } : item)),
    }));

    clearGainDebounce(band);
    debounceTimers.current[band] = window.setTimeout(() => sendBandGain(band, gainDb), eqControlDebounceMs);
  };

  const handleBandCommit = (band: number, gainDb: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    if (!isEqFilterGainEditable(state.bands[band]?.filterType)) {
      return;
    }

    commitEqEdit();
    setSelectedBandIndex(band);
    clearGainDebounce(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, gainDb } : item)),
    }));
    sendBandGain(band, gainDb);
  };

  const sendBandFrequency = useCallback(
    (band: number, frequencyHz: number): void => {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeControlEq'));
        return;
      }

      void eq.setBandFrequency({ band, frequencyHz }).then(commitState).catch((bandError: unknown) => {
        setError(bandError instanceof Error ? bandError.message : String(bandError));
      });
    },
    [commitState, t],
  );

  const handleBandFrequencyChange = (band: number, frequencyHz: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    beginEqEdit();
    const safeFrequencyHz = resolveBandFrequency(frequencyHz, frequencyEditUnlocked);
    setSelectedBandIndex(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, frequencyHz: safeFrequencyHz } : item)),
    }));

    clearFrequencyDebounce(band);
    frequencyDebounceTimers.current[band] = window.setTimeout(() => sendBandFrequency(band, safeFrequencyHz), eqControlDebounceMs);
  };

  const handleBandFrequencyCommit = (band: number, frequencyHz: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    commitEqEdit();
    const safeFrequencyHz = resolveBandFrequency(frequencyHz, frequencyEditUnlocked);
    setSelectedBandIndex(band);
    clearFrequencyDebounce(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, frequencyHz: safeFrequencyHz } : item)),
    }));
    sendBandFrequency(band, safeFrequencyHz);
  };

  const sendBandQ = useCallback(
    (band: number, q: number): void => {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeControlEq'));
        return;
      }

      void eq.setBandQ({ band, q }).then(commitState).catch((bandError: unknown) => {
        setError(bandError instanceof Error ? bandError.message : String(bandError));
      });
    },
    [commitState, t],
  );

  const handleBandQCommit = (band: number, q: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const safeQ = Math.round(Math.max(eqMinQ, Math.min(eqMaxQ, Number.isFinite(q) ? q : 1)) * 10) / 10;
    pushUndoSnapshot(createEqHistorySnapshot(state));
    setSelectedBandIndex(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, q: safeQ } : item)),
    }));
    sendBandQ(band, safeQ);
  };

  const handleBandQPresetCommit = (band: number, q: number): void => {
    handleBandQCommit(band, q);
  };

  const handleBandFilterTypeChange = (band: number, filterType: EqFilterType): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    const gainEditable = isEqFilterGainEditable(filterType);
    pushUndoSnapshot(createEqHistorySnapshot(state));
    setSelectedBandIndex(band);
    const nextState: EqState = {
      ...state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: state.bands.map((item, index) => (index === band ? { ...item, filterType, gainDb: gainEditable ? item.gainDb : 0 } : item)),
    };
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, filterType, gainDb: gainEditable ? item.gainDb : 0 } : item)),
    }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void Promise.all([
      eq.setBandFilterType({ band, filterType }),
      ...(gainEditable ? [] : [eq.setBandGain({ band, gainDb: 0 })]),
    ])
      .then(() => commitState(nextState))
      .catch((bandError: unknown) => {
        setError(bandError instanceof Error ? bandError.message : String(bandError));
      });
  };

  const toggleBandEnabled = (band: number, enabled: boolean): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    pushUndoSnapshot(createEqHistorySnapshot(state));
    setSelectedBandIndex(band);
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (index === band ? { ...item, enabled } : item)),
    }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.setBandEnabled({ band, enabled }).then(commitState).catch((bandError: unknown) => {
      setError(bandError instanceof Error ? bandError.message : String(bandError));
    });
  };

  const commitBandSlot = (band: number, nextBand: EqBand): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    const safeBand: EqBand = {
      frequencyHz: Math.max(eqMinFrequencyHz, Math.min(eqMaxFrequencyHz, Math.round(nextBand.frequencyHz * 10) / 10)),
      gainDb: isEqFilterGainEditable(nextBand.filterType) ? Math.max(-12, Math.min(12, Math.round(nextBand.gainDb * 10) / 10)) : 0,
      q: Math.max(eqMinQ, Math.min(eqMaxQ, Math.round((nextBand.q ?? 1) * 10) / 10)),
      filterType: nextBand.filterType ?? 'peaking',
      enabled: nextBand.enabled !== false,
    };
    const nextState: EqState = {
      ...state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: state.bands.map((item, index) => (index === band ? safeBand : item)),
    };

    pushUndoSnapshot(createEqHistorySnapshot(state));
    clearGainDebounce(band);
    clearFrequencyDebounce(band);
    setSelectedBandIndex(band);
    setState(nextState);

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void Promise.all([
      eq.setBandFrequency({ band, frequencyHz: safeBand.frequencyHz }),
      eq.setBandGain({ band, gainDb: safeBand.gainDb }),
      eq.setBandQ({ band, q: safeBand.q }),
      eq.setBandFilterType({ band, filterType: safeBand.filterType ?? 'peaking' }),
      eq.setBandEnabled({ band, enabled: safeBand.enabled !== false }),
    ])
      .then(() => commitState(nextState))
      .catch((bandError: unknown) => {
        setError(bandError instanceof Error ? bandError.message : String(bandError));
      });
  };

  const addFilterSlot = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const bandCount = state.bands.length;
    const orderedIndexes = Array.from({ length: bandCount }, (_, offset) => (selectedBandIndex + 1 + offset) % bandCount);
    const targetBand = orderedIndexes.find((index) => isBandSlotAvailable(state.bands[index], index)) ?? selectedBandIndex;
    commitBandSlot(targetBand, defaultBandSlot(targetBand));
  };

  const deleteSelectedFilter = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    if (!selectedBand) {
      return;
    }

    commitBandSlot(selectedBandIndex, bypassedBandSlot(selectedBandIndex));
  };

  const markAutoGainUserBaseline = (preampDb: number): void => {
    autoGainBaselinePreampDb.current = preampDb;
    autoGainManualHoldUntilMs.current = Date.now() + eqAutoGainManualHoldMs;
    autoGainLastAdjustmentAtMs.current = 0;
    if (autoGainEnabled) {
      setAutoGainStatus('holding');
      setAutoGainAdjustmentDb(0);
    }
  };

  const handlePreampChange = (preampDb: number): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    pushUndoSnapshot(createEqHistorySnapshot(state));
    markAutoGainUserBaseline(preampDb);
    setState((current) => ({ ...current, preampDb, presetId: 'custom', presetName: 'Custom' }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.setPreamp(preampDb).then(commitState).catch((preampError: unknown) => {
      setError(preampError instanceof Error ? preampError.message : String(preampError));
    });
  };

  const handleDspHeadroomChange = (headroomDb: number): void => {
    const eq = getEqBridge();
    const safeHeadroomDb = Math.max(dspHeadroomMinDb, Math.min(dspHeadroomMaxDb, Math.round(headroomDb * 10) / 10));
    setState((current) => ({ ...current, dspHeadroomDb: safeHeadroomDb }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.setDspHeadroom(safeHeadroomDb).then(commitState).catch((headroomError: unknown) => {
      setError(headroomError instanceof Error ? headroomError.message : String(headroomError));
    });
  };

  const handleNativeDirect = (): void => {
    const eq = getEqBridge();

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    setState((current) => ({ ...current, enabled: false }));
    setRoomCorrection((current) => ({
      ...current,
      enabled: false,
      status: current.irId ? 'loaded' : 'empty',
    }));
    setChannelBalance((current) => ({ ...current, enabled: false }));

    void Promise.all([
      eq.setEnabled(false),
      eq.setRoomCorrectionEnabled(false),
      eq.setChannelBalanceState({ enabled: false }),
    ]).then(([nextEqState, nextRoomCorrection, nextChannelBalance]) => {
      commitState(nextEqState);
      setRoomCorrection(nextRoomCorrection);
      setChannelBalance(nextChannelBalance);
    }).catch((bypassError: unknown) => {
      setError(bypassError instanceof Error ? bypassError.message : String(bypassError));
    });
  };

  const applyEqSnapshot = async (
    snapshot: EqSnapshot,
    options: { enabled?: boolean; recordHistory?: boolean; loudnessMatch?: boolean } = {},
  ): Promise<void> => {
    const eq = getEqBridge();

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    const nextBands = snapshot.bands.map((band): EqBand => ({ ...band }));
    const nextPreampDb = options.loudnessMatch ? computeLoudnessMatchedPreamp(state, snapshot) : snapshot.preampDb;
    const nextState: EqState = {
      ...state,
      enabled: options.enabled ?? state.enabled,
      preampDb: nextPreampDb,
      presetId: options.loudnessMatch ? 'custom' : snapshot.presetId,
      presetName: options.loudnessMatch ? 'Custom' : snapshot.presetName,
      clippingRisk: snapshot.clippingRisk,
      bands: nextBands,
    };

    if (options.recordHistory !== false) {
      pushUndoSnapshot(createEqHistorySnapshot(state));
    }
    setState(nextState);

    try {
      await Promise.all([
        ...(options.enabled === undefined ? [] : [eq.setEnabled(options.enabled)]),
        eq.setPreamp(nextPreampDb),
        ...nextBands.flatMap((nextBand, band) => [
          eq.setBandFrequency({ band, frequencyHz: nextBand.frequencyHz }),
          eq.setBandGain({ band, gainDb: nextBand.gainDb }),
          eq.setBandQ({ band, q: nextBand.q }),
          eq.setBandFilterType({ band, filterType: nextBand.filterType ?? 'peaking' }),
          eq.setBandEnabled({ band, enabled: nextBand.enabled !== false }),
        ]),
      ]);
      commitState(nextState);
      setError(null);
    } catch (snapshotError) {
      setError(snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
    }
  };

  const storeAbSlot = (slot: 'a' | 'b'): void => {
    setAbSlots((current) => ({ ...current, [slot]: captureEqSnapshot(state) }));
  };

  const restoreAbSlot = (slot: 'a' | 'b'): void => {
    const snapshot = abSlots[slot];

    if (!snapshot) {
      return;
    }

    void applyEqSnapshot(snapshot, { loudnessMatch: loudnessMatchedAb });
  };

  const undoEq = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const snapshot = undoStack.at(-1);

    if (!snapshot) {
      return;
    }

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, createEqHistorySnapshot(state)].slice(-maxHistoryLength));
    void applyEqSnapshot(snapshot, { recordHistory: false });
  };

  const redoEq = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const snapshot = redoStack.at(-1);

    if (!snapshot) {
      return;
    }

    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, createEqHistorySnapshot(state)].slice(-maxHistoryLength));
    void applyEqSnapshot(snapshot, { recordHistory: false });
  };

  const resetSelectedBand = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    pushUndoSnapshot(createEqHistorySnapshot(state));
    clearGainDebounce(selectedBandIndex);
    const standardFrequency = eqFrequenciesHz[selectedBandIndex] ?? selectedBand?.frequencyHz ?? 1000;
    setState((current) => ({
      ...current,
      presetId: 'custom',
      presetName: 'Custom',
      bands: current.bands.map((item, index) => (
        index === selectedBandIndex
          ? { ...item, frequencyHz: standardFrequency, gainDb: 0, q: 1, filterType: 'peaking', enabled: true }
          : item
      )),
    }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void Promise.all([
      eq.setBandFrequency({ band: selectedBandIndex, frequencyHz: standardFrequency }),
      eq.setBandGain({ band: selectedBandIndex, gainDb: 0 }),
      eq.setBandQ({ band: selectedBandIndex, q: 1 }),
      eq.setBandFilterType({ band: selectedBandIndex, filterType: 'peaking' }),
      eq.setBandEnabled({ band: selectedBandIndex, enabled: true }),
    ]).then(() => commitState({
      ...state,
      presetId: 'custom',
      presetName: 'Custom',
      bands: state.bands.map((item, index) => (
        index === selectedBandIndex
          ? { ...item, frequencyHz: standardFrequency, gainDb: 0, q: 1, filterType: 'peaking', enabled: true }
          : item
      )),
    })).catch((resetError: unknown) => setError(resetError instanceof Error ? resetError.message : String(resetError)));
  };

  const resetAllGains = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    const nextBands = state.bands.map((band) => ({ ...band, gainDb: 0 }));
    const nextState = { ...state, presetId: 'custom', presetName: 'Custom', bands: nextBands };
    pushUndoSnapshot(createEqHistorySnapshot(state));
    clearAllGainDebounces();
    setState(nextState);

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void Promise.all(nextBands.map((_band, band) => eq.setBandGain({ band, gainDb: 0 })))
      .then(() => commitState(nextState))
      .catch((resetError: unknown) => setError(resetError instanceof Error ? resetError.message : String(resetError)));
  };

  const resetStandardFrequencies = (): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const eq = getEqBridge();
    const nextBands = state.bands.map((band, index) => ({ ...band, frequencyHz: eqFrequenciesHz[index] ?? band.frequencyHz }));
    const nextState = { ...state, presetId: 'custom', presetName: 'Custom', bands: nextBands };
    pushUndoSnapshot(createEqHistorySnapshot(state));
    clearAllFrequencyDebounces();
    setState(nextState);

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void Promise.all(nextBands.map((band, index) => eq.setBandFrequency({ band: index, frequencyHz: band.frequencyHz })))
      .then(() => commitState(nextState))
      .catch((resetError: unknown) => setError(resetError instanceof Error ? resetError.message : String(resetError)));
  };

  const adjustSelectedGain = (deltaDb: number): void => {
    if (!selectedBandGainEditable) {
      return;
    }

    const nextGainDb = Math.round(Math.max(-12, Math.min(12, (selectedBand?.gainDb ?? 0) + deltaDb)) * 10) / 10;
    pushUndoSnapshot(createEqHistorySnapshot(state));
    handleBandCommit(selectedBandIndex, nextGainDb);
  };

  const adjustSelectedFrequency = (direction: -1 | 1, fine: boolean): void => {
    if (!selectedBand || !frequencyEditUnlocked) {
      return;
    }

    const ratio = fine ? 2 ** (1 / 24) : 2 ** (1 / 12);
    const nextFrequencyHz = Math.round(direction > 0 ? selectedBand.frequencyHz * ratio : selectedBand.frequencyHz / ratio);
    pushUndoSnapshot(createEqHistorySnapshot(state));
    handleBandFrequencyCommit(selectedBandIndex, nextFrequencyHz);
  };

  const applySimpleTone = (tone: EqSimpleToneId, intensity = simpleToneIntensity): void => {
    if (!requireCustomHeadphoneCorrection()) {
      return;
    }

    const toneOption = simpleToneOptions.find((option) => option.id === tone);
    const safeIntensity = tone === 'flat' ? 1 : Math.max(0.5, Math.min(1.5, Math.round(intensity * 100) / 100));
    setSimpleToneIntensity(safeIntensity);
    const nextBands = eqFrequenciesHz.map((frequencyHz, index): EqBand => ({
      ...(state.bands[index] ?? defaultBandSlot(index)),
      frequencyHz,
      gainDb: simpleToneGainDb(tone, frequencyHz, safeIntensity),
      q: 1,
      filterType: 'peaking',
      enabled: true,
    }));
    const nextPreampDb = tone === 'flat' ? 0 : computeRecommendedPreamp({ bands: nextBands });
    markAutoGainUserBaseline(nextPreampDb);

    void applyEqSnapshot({
      preampDb: nextPreampDb,
      bands: nextBands,
      presetId: 'custom',
      presetName: toneOption ? t(toneOption.labelKey) : 'Custom',
      clippingRisk: false,
    }).then(() => {
      if (!state.enabled) {
        const eq = getEqBridge();
        setState((current) => ({ ...current, enabled: true }));

        if (!eq) {
          setError(t('settings.eq.error.bridgeControlEq'));
          return;
        }

        void eq.setEnabled(true).catch((toggleError: unknown) => {
          setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
        });
      }
    });
  };

  const applyNextSimpleTone = (): void => {
    const currentIndex = activeSimpleTone && activeSimpleTone !== 'flat'
      ? exploratorySimpleToneIds.indexOf(activeSimpleTone)
      : -1;
    const nextTone = exploratorySimpleToneIds[(currentIndex + 1) % exploratorySimpleToneIds.length] ?? 'bass';
    applySimpleTone(nextTone);
  };

  const adjustSimpleToneIntensity = (intensity: number): void => {
    if (!activeSimpleTone || activeSimpleTone === 'flat') {
      return;
    }

    applySimpleTone(activeSimpleTone, intensity);
  };

  const nudgeSimpleToneIntensity = (delta: number): void => {
    adjustSimpleToneIntensity(Math.round((simpleToneIntensity + delta) * 100) / 100);
  };

  const setPreset = (presetId: string): void => {
    const eq = getEqBridge();

    if (!eq) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    pushUndoSnapshot(createEqHistorySnapshot(state));
    const preset = presets.find((item) => item.id === presetId);
    if (preset) {
      markAutoGainUserBaseline(preset.preampDb);
      setState((current) => ({
        ...current,
        preampDb: preset.preampDb,
        bands: preset.bands.map((band) => ({ ...band })),
        presetId: preset.id,
        presetName: preset.name,
        clippingRisk: false,
      }));
    }
    void eq.setPreset(presetId).then(commitState).catch((presetError: unknown) => {
      setError(presetError instanceof Error ? presetError.message : String(presetError));
    });
  };

  const reset = (): void => {
    const eq = getEqBridge();

    if (!eq) {
      setState(fallbackState);
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    pushUndoSnapshot(createEqHistorySnapshot(state));
    clearAllGainDebounces();
    clearAllFrequencyDebounces();
    markAutoGainUserBaseline(fallbackState.preampDb);
    setState({
      ...fallbackState,
      enabled: state.enabled,
      bands: fallbackState.bands.map((band) => ({ ...band })),
    });
    void eq.reset().then(commitState).catch((resetError: unknown) => {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    });
  };

  const exportPreset = async (): Promise<void> => {
    if (!saveName.trim()) {
      setError(t('settings.eq.error.presetName'));
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const exportedPath = await eq.exportPreset({
        name: saveName,
        preampDb: state.preampDb,
        bands: state.bands,
      });
      if (exportedPath) {
        setSaveName('');
        setExportNotice(t('settings.eq.export.successPreset', { path: exportedPath }));
      }
      setError(null);
    } catch (saveError) {
      setExportNotice(null);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const previewImportPreset = async (): Promise<void> => {
    const eq = getEqBridge();

    if (!eq?.previewImportPreset) {
      setError(t('settings.eq.error.bridgeSavePreset'));
      return;
    }

    try {
      const preview = await eq.previewImportPreset();
      if (!preview) {
        return;
      }
      setImportPreview(preview);
      setImportReport(null);
      setImportAuditionSnapshot(null);
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  const previewPastedApoPreset = (): void => {
    const rawContent = apoPasteText.trim();
    if (!rawContent) {
      setError(t('settings.eq.import.pasteEmpty'));
      return;
    }

    try {
      const pastedPreset = parseEqualizerApoPreset(rawContent, { name: t('settings.eq.import.pasteDefaultName') });
      const skippedIncludeCount = (rawContent.match(/^\s*Include\s*:/gim) ?? []).length;
      const includeWarning = skippedIncludeCount > 0 ? [t('settings.eq.import.pasteIncludeWarning')] : [];
      setImportPreview({
        request: {
          id: uniqueImportedPresetId(pastedPreset.name, presets),
          name: pastedPreset.name,
          preampDb: pastedPreset.preampDb,
          bands: pastedPreset.bands,
        },
        metadata: {
          source: 'equalizer-apo',
          importedFilterCount: pastedPreset.importedFilterCount,
          skippedFilterCount: pastedPreset.skippedFilterCount,
          graphicEqPointCount: pastedPreset.graphicEqPointCount,
          includedFileCount: 0,
          skippedIncludeCount,
          unsupportedDirectiveCount: pastedPreset.unsupportedDirectiveCount,
          unsupportedDirectiveSummary: pastedPreset.unsupportedDirectiveSummary,
          channelScopedFilterCount: pastedPreset.channelScopedFilterCount,
          bandwidthFilterCount: pastedPreset.bandwidthFilterCount,
          warnings: [...includeWarning, ...pastedPreset.warnings],
        },
        fileName: t('settings.eq.import.pasteFileName'),
      });
      setImportReport(null);
      setImportAuditionSnapshot(null);
      setError(null);
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : String(pasteError));
    }
  };

  const exportApoPreset = async (): Promise<void> => {
    if (!saveName.trim()) {
      setError(t('settings.eq.error.presetName'));
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq?.exportApoPreset) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const exportedPath = await eq.exportApoPreset({
        name: saveName,
        preampDb: state.preampDb,
        bands: state.bands,
      });
      if (exportedPath) {
        setExportNotice(t('settings.eq.export.successApo', { path: exportedPath }));
      }
      setError(null);
    } catch (saveError) {
      setExportNotice(null);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const exportApoGraphicEqPreset = async (): Promise<void> => {
    if (!saveName.trim()) {
      setError(t('settings.eq.error.presetName'));
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq?.exportApoGraphicEqPreset) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const exportedPath = await eq.exportApoGraphicEqPreset({
        name: saveName,
        preampDb: state.preampDb,
        bands: state.bands,
      });
      if (exportedPath) {
        setExportNotice(t('settings.eq.export.successGraphicEq', { path: exportedPath }));
      }
      setError(null);
    } catch (saveError) {
      setExportNotice(null);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const applyImportPreview = async (): Promise<void> => {
    const eq = getEqBridge();

    if (!eq || !importPreview) {
      setError(t('settings.eq.error.bridgeSavePreset'));
      return;
    }

    try {
      const imported = await eq.savePreset(importPreview.request);
      setPresets(await eq.listPresets());
      setSaveName(imported.name);
      setImportReport({
        presetName: imported.name,
        preampDb: imported.preampDb,
        metadata: importPreview.metadata,
      });
      setImportPreview(null);
      setImportAuditionSnapshot(null);
      await setPreset(imported.id);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  const auditionImportPreview = async (): Promise<void> => {
    if (!importPreview) {
      return;
    }

    const original = importAuditionSnapshot ?? {
      snapshot: captureEqSnapshot(state),
      enabled: state.enabled,
    };
    setImportAuditionSnapshot(original);
    await applyEqSnapshot({
      preampDb: importPreview.request.preampDb,
      bands: importPreview.request.bands,
      presetId: 'custom',
      presetName: t('settings.eq.import.auditionPresetName', { name: importPreview.request.name }),
      clippingRisk: importPreviewSummary?.estimatedPeakGainDb ? importPreviewSummary.estimatedPeakGainDb > 0.05 : false,
    }, { enabled: true, recordHistory: false });
  };

  const restoreImportAudition = async (): Promise<void> => {
    if (!importAuditionSnapshot) {
      return;
    }

    await applyEqSnapshot(importAuditionSnapshot.snapshot, {
      enabled: importAuditionSnapshot.enabled,
      recordHistory: false,
    });
    setImportAuditionSnapshot(null);
  };

  const cancelImportPreview = async (): Promise<void> => {
    if (importAuditionSnapshot) {
      await restoreImportAudition();
    }
    setImportPreview(null);
  };

  const updateImportPreviewPreamp = (preampDb: number): void => {
    const safePreampDb = Math.max(eqMinPreampDb, Math.min(eqMaxPreampDb, Math.round((Number.isFinite(preampDb) ? preampDb : 0) * 10) / 10));
    setImportPreview((current) => (
      current
        ? {
          ...current,
          request: {
            ...current.request,
            preampDb: safePreampDb,
          },
        }
        : current
    ));
  };

  const updateImportPreviewBand = (bandIndex: number, patch: Partial<EqBand>): void => {
    setImportPreview((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        request: {
          ...current.request,
          bands: current.request.bands.map((band, index) => {
            if (index !== bandIndex) {
              return band;
            }

            const filterType = patch.filterType ?? band.filterType ?? 'peaking';
            const gainEditable = isEqFilterGainEditable(filterType);
            const nextFrequencyHz = patch.frequencyHz ?? band.frequencyHz;
            const nextGainDb = patch.gainDb ?? band.gainDb;
            const nextQ = patch.q ?? band.q ?? 1;

            return {
              ...band,
              ...patch,
              frequencyHz: Math.max(eqMinFrequencyHz, Math.min(eqMaxFrequencyHz, Math.round((Number.isFinite(nextFrequencyHz) ? nextFrequencyHz : band.frequencyHz) * 10) / 10)),
              gainDb: gainEditable ? Math.max(-12, Math.min(12, Math.round((Number.isFinite(nextGainDb) ? nextGainDb : 0) * 10) / 10)) : 0,
              q: Math.max(eqMinQ, Math.min(eqMaxQ, Math.round((Number.isFinite(nextQ) ? nextQ : 1) * 10) / 10)),
              filterType,
              enabled: patch.enabled ?? band.enabled ?? true,
            };
          }),
        },
      };
    });
  };

  const importRoomCorrectionIr = async (): Promise<void> => {
    const eq = getEqBridge();

    if (!eq?.importRoomCorrectionIr) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    try {
      const imported = await eq.importRoomCorrectionIr();
      if (imported) {
        commitRoomCorrection(imported);
      }
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  const toggleRoomCorrection = (): void => {
    const eq = getEqBridge();

    if (!eq?.setRoomCorrectionEnabled) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.setRoomCorrectionEnabled(!roomCorrection.enabled)
      .then((nextState) => {
        commitRoomCorrection(nextState);
        setError(null);
      })
      .catch((toggleError: unknown) => setError(toggleError instanceof Error ? toggleError.message : String(toggleError)));
  };

  const setRoomCorrectionTrim = (trimDb: number): void => {
    const eq = getEqBridge();

    if (!eq?.setRoomCorrectionTrim) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    setRoomCorrection((current) => ({ ...current, trimDb }));
    void eq.setRoomCorrectionTrim(trimDb)
      .then((nextState) => {
        commitRoomCorrection(nextState);
        setError(null);
      })
      .catch((trimError: unknown) => setError(trimError instanceof Error ? trimError.message : String(trimError)));
  };

  const clearRoomCorrection = (): void => {
    const eq = getEqBridge();

    if (!eq?.clearRoomCorrection) {
      setError(t('settings.eq.error.bridgeControlEq'));
      return;
    }

    void eq.clearRoomCorrection()
      .then((nextState) => {
        commitRoomCorrection(nextState);
        setError(null);
      })
      .catch((clearError: unknown) => setError(clearError instanceof Error ? clearError.message : String(clearError)));
  };

  const overwritePreset = async (): Promise<void> => {
    if (!canOverwritePreset || !selectedPreset) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      await eq.savePreset({
        id: selectedPreset.id,
        name: selectedPreset.name,
        preampDb: state.preampDb,
        bands: state.bands,
      });
      setPresets(await eq.listPresets());
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const duplicateCurrentPreset = async (): Promise<void> => {
    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const duplicated = await eq.savePreset({
        name: t('settings.eq.preset.copyName', { name: state.presetName }),
        preampDb: state.preampDb,
        bands: state.bands,
      });
      setPresets(await eq.listPresets());
      setSaveName('');
      commitState({
        ...state,
        presetId: duplicated.id,
        presetName: duplicated.name,
        preampDb: duplicated.preampDb,
        bands: duplicated.bands.map((band) => ({ ...band })),
      });
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const saveSimplePreset = async (): Promise<void> => {
    if (!canSaveSimplePreset) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const presetName = activeSimpleTone && activeSimpleTone !== 'flat'
        ? t('settings.eq.simpleAction.savedPresetName', {
          amount: String(Math.round(simpleToneIntensity * 100)),
          name: state.presetName,
        })
        : t('settings.eq.simpleAction.customPresetName');
      const saved = await eq.savePreset({
        name: presetName,
        preampDb: state.preampDb,
        bands: state.bands,
      });
      setPresets(await eq.listPresets());
      commitState({
        ...state,
        presetId: saved.id,
        presetName: saved.name,
        preampDb: saved.preampDb,
        bands: saved.bands.map((band) => ({ ...band })),
      });
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const revertCurrentUserPreset = (): void => {
    if (!canOverwritePreset) {
      return;
    }

    setPreset(state.presetId);
  };

  const deletePreset = async (): Promise<void> => {
    if (selectedPresetReadonly) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeDeletePreset'));
        return;
      }

      setPresets(await eq.deletePreset(state.presetId));
      reset();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const saveCurrentProfile = async (): Promise<void> => {
    if (!profileName.trim()) {
      setError(t('settings.eq.error.profileName'));
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const profile = await eq.saveProfile({
        id: selectedProfile?.id,
        name: profileName,
        state,
      });
      setProfiles(await eq.listProfiles());
      setSelectedProfileId(profile.id);
      setProfileName(profile.name);
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : String(profileError));
    }
  };

  const applySelectedProfile = async (): Promise<void> => {
    if (!selectedProfileId) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeControlEq'));
        return;
      }

      pushUndoSnapshot(createEqHistorySnapshot(state));
      commitState(await eq.applyProfile(selectedProfileId));
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : String(profileError));
    }
  };

  const bindSelectedProfileToOutput = async (): Promise<void> => {
    if (!selectedProfileId) {
      setError(t('settings.eq.error.profileTarget'));
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeSavePreset'));
        return;
      }

      const binding = await eq.bindProfileToOutput({ profileId: selectedProfileId, target: currentOutputTarget });
      setProfiles(await eq.listProfiles());
      setProfileBinding(binding);
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : String(profileError));
    }
  };

  const deleteSelectedProfile = async (): Promise<void> => {
    if (!selectedProfileId) {
      return;
    }

    try {
      const eq = getEqBridge();

      if (!eq) {
        setError(t('settings.eq.error.bridgeDeletePreset'));
        return;
      }

      const nextProfiles = await eq.deleteProfile(selectedProfileId);
      setProfiles(nextProfiles);
      setSelectedProfileId(nextProfiles[0]?.id ?? '');
      setProfileName(nextProfiles[0]?.name ?? '');
      setProfileBinding(await eq.getProfileBinding(currentOutputTarget));
      setError(null);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : String(profileError));
    }
  };

  const patchChannelBalance = (patch: Partial<ChannelBalanceState>): void => {
    const safePatch = clampChannelBalancePatch(patch);
    const eq = getEqBridge();
    setChannelBalance((current) => ({ ...current, ...safePatch }));

    if (!eq) {
      setError(t('settings.eq.error.bridgeChannelBalance'));
      return;
    }

    void eq.setChannelBalanceState(safePatch).then(commitChannelBalance).catch((balanceError: unknown) => {
      setError(balanceError instanceof Error ? balanceError.message : String(balanceError));
    });
  };

  const resetChannelBalance = (): void => {
    const eq = getEqBridge();

    if (!eq) {
      setChannelBalance(fallbackChannelBalanceState);
      setError(t('settings.eq.error.bridgeChannelBalance'));
      return;
    }

    void eq.resetChannelBalance().then(commitChannelBalance).catch((balanceError: unknown) => {
      setError(balanceError instanceof Error ? balanceError.message : String(balanceError));
    });
  };

  const resetMonitorTools = (): void => {
    patchChannelBalance({
      monoMode: 'off',
      swapLeftRight: false,
      invertLeft: false,
      invertRight: false,
      constantPower: true,
    });
  };

  const resetTrimsOnly = (): void => {
    patchChannelBalance({
      balance: 0,
      leftGainDb: 0,
      rightGainDb: 0,
    });
  };

  const applyMonitorTool = (tool: 'mono' | 'left' | 'right' | 'swap' | 'phase'): void => {
    if (tool === 'mono') {
      patchChannelBalance({ monoMode: 'sum' });
      return;
    }

    if (tool === 'left' || tool === 'right') {
      patchChannelBalance({ monoMode: tool });
      return;
    }

    if (tool === 'swap') {
      patchChannelBalance({ swapLeftRight: !channelBalance.swapLeftRight });
      return;
    }

    patchChannelBalance({ invertRight: !channelBalance.invertRight });
  };

  const holdBypass = (): void => {
    if (bypassSnapshot !== null) {
      return;
    }

    setBypassSnapshot(state.enabled);
    setEnabled(false);
  };

  const releaseBypass = (): void => {
    if (bypassSnapshot === null) {
      return;
    }

    setEnabled(bypassSnapshot);
    setBypassSnapshot(null);
  };

  const { leftDb: leftTotalDb, rightDb: rightTotalDb } = computeEffectiveChannelGains(channelBalance);
  const leftDelayMs = channelBalance.leftDelayMs ?? 0;
  const rightDelayMs = channelBalance.rightDelayMs ?? 0;
  const measuredLeftDistanceCm = parseOptionalNumber(calibrationLeftDistanceCm);
  const measuredRightDistanceCm = parseOptionalNumber(calibrationRightDistanceCm);
  const measuredLeftSplDb = parseOptionalNumber(calibrationLeftSplDb);
  const measuredRightSplDb = parseOptionalNumber(calibrationRightSplDb);
  const hasDistanceMeasurement = measuredLeftDistanceCm !== null && measuredRightDistanceCm !== null && measuredLeftDistanceCm > 0 && measuredRightDistanceCm > 0;
  const hasSplMeasurement = measuredLeftSplDb !== null && measuredRightSplDb !== null;
  const distanceDifferenceCm = hasDistanceMeasurement ? measuredRightDistanceCm - measuredLeftDistanceCm : 0;
  const calculatedLeftDelayMs = hasDistanceMeasurement
    ? (distanceDifferenceCm > 0 ? roundCalibrationDelayMs(distanceDifferenceCm / speedOfSoundCmPerMs) : 0)
    : leftDelayMs;
  const calculatedRightDelayMs = hasDistanceMeasurement
    ? (distanceDifferenceCm < 0 ? roundCalibrationDelayMs(Math.abs(distanceDifferenceCm) / speedOfSoundCmPerMs) : 0)
    : rightDelayMs;
  const splDifferenceDb = hasSplMeasurement ? measuredLeftSplDb - measuredRightSplDb : 0;
  const calculatedLeftGainDb = hasSplMeasurement
    ? (splDifferenceDb > 0 ? roundCalibrationGainDb(-splDifferenceDb) : 0)
    : channelBalance.leftGainDb;
  const calculatedRightGainDb = hasSplMeasurement
    ? (splDifferenceDb < 0 ? roundCalibrationGainDb(splDifferenceDb) : 0)
    : channelBalance.rightGainDb;
  const calibrationReady = hasDistanceMeasurement || hasSplMeasurement;
  const channelBalanceRisk = leftTotalDb > 0 || rightTotalDb > 0 || Boolean(channelBalance.clippingRisk);
  const activeDspSourceLabels = [
    state.enabled ? t('settings.eq.bitPerfect.sourceEq') : null,
    roomCorrection.enabled ? t('settings.eq.bitPerfect.sourceRoom') : null,
    channelBalance.enabled ? t('settings.eq.bitPerfect.sourceChannel') : null,
  ].filter((label): label is string => Boolean(label));
  const dspSource = activeDspSourceLabels.length
    ? activeDspSourceLabels.join(' + ')
    : audioStatus?.bitPerfectDisabledReason?.replaceAll('_', ' ') ?? '';
  const bitPerfectText = dspActive
    ? t('settings.eq.bitPerfect.disabled', { reason: dspSource ? ` (${dspSource})` : '' })
    : t('settings.eq.bitPerfect.readyPath');
  const activeDspModuleCount = [
    state.enabled,
    roomCorrection.enabled,
    channelBalance.enabled,
  ].filter(Boolean).length;
  const displayedDspModuleCount = dspActive ? Math.max(1, activeDspModuleCount) : 0;
  const dspGuardMode = clippingRisk ? 'risk' : dspActive ? 'active' : 'bypass';
  const dspGuardTitle = dspActive ? t('settings.eq.signal.dspActive') : t('settings.eq.signal.bitPerfectOutput');
  const dspGuardDetail = dspActive
    ? bitPerfectText
    : t('settings.eq.routing.nativeBypassComfort');
  const dspGuardModules = dspActive
    ? activeDspSourceLabels.join(' / ')
    : t('settings.eq.routing.modulesBypassedDetail');
  const dspComfortMode = clippingRisk ? 'risk' : dspActive ? 'tuned' : 'direct';
  const dspComfortLabel = clippingRisk
    ? t('settings.eq.comfort.risk')
    : dspActive
      ? t('settings.eq.comfort.tuned')
      : t('settings.eq.comfort.direct');
  const dspComfortDetail = clippingRisk
    ? t('settings.eq.comfort.riskDetail')
    : dspActive
      ? t('settings.eq.comfort.tunedDetail')
      : t('settings.eq.comfort.directDetail');
  const balanceReadout = channelBalance.balance === 0
    ? t('settings.eq.channel.center')
    : `${channelBalance.balance < 0 ? 'L' : 'R'} ${Math.round(Math.abs(channelBalance.balance) * 100)}%`;

  const applySpatialCalibrationMeasurements = (): void => {
    if (!calibrationReady) {
      return;
    }

    patchChannelBalance({
      enabled: true,
      balance: hasSplMeasurement ? 0 : channelBalance.balance,
      leftGainDb: calculatedLeftGainDb,
      rightGainDb: calculatedRightGainDb,
      leftDelayMs: calculatedLeftDelayMs,
      rightDelayMs: calculatedRightDelayMs,
      monoMode: 'off',
      swapLeftRight: false,
      invertLeft: false,
      invertRight: false,
    });
  };

  const resetSpatialCalibrationMeasurements = (): void => {
    setCalibrationLeftDistanceCm('');
    setCalibrationRightDistanceCm('');
    setCalibrationLeftSplDb('');
    setCalibrationRightSplDb('');
  };

  const nudgeSpatialDelay = (side: 'left' | 'right'): void => {
    patchChannelBalance({
      enabled: true,
      monoMode: 'off',
      leftDelayMs: side === 'left' ? roundCalibrationDelayMs(leftDelayMs + spatialDelayNudgeMs) : leftDelayMs,
      rightDelayMs: side === 'right' ? roundCalibrationDelayMs(rightDelayMs + spatialDelayNudgeMs) : rightDelayMs,
    });
  };

  const nudgeSpatialGain = (side: 'left' | 'right'): void => {
    patchChannelBalance({
      enabled: true,
      monoMode: 'off',
      leftGainDb: side === 'left' ? roundCalibrationGainDb(channelBalance.leftGainDb - spatialGainNudgeDb) : channelBalance.leftGainDb,
      rightGainDb: side === 'right' ? roundCalibrationGainDb(channelBalance.rightGainDb - spatialGainNudgeDb) : channelBalance.rightGainDb,
    });
  };

  return (
    <section className="eq-panel" aria-label="ECHO Next EQ panel" data-enabled={state.enabled} data-mode={eqUiMode}>
      <header className="eq-header">
        <div className="eq-title-block">
          <span className="eq-title-icon">
            <AudioWaveform size={18} />
          </span>
          <div>
            <h2>{t('settings.eq.title')}</h2>
            <p>{t('settings.eq.subtitle')}</p>
          </div>
        </div>

        <div className="eq-header-actions">
          <label className="eq-enable-pill">
            <input type="checkbox" checked={state.enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
            <span>{state.enabled ? t('settings.eq.state.eqEnabled') : t('settings.eq.state.eqDisabled')}</span>
          </label>
          <div className="eq-mode-toggle" role="group" aria-label={t('settings.eq.mode.aria')}>
            <button type="button" data-active={eqUiMode === 'simple'} onClick={() => setEqUiMode('simple')}>
              {t('settings.eq.mode.simple')}
            </button>
            <button type="button" data-active={eqUiMode === 'pro'} onClick={() => setEqUiMode('pro')}>
              {t('settings.eq.mode.pro')}
            </button>
          </div>
          <EqPresetSelector presets={presets} value={state.presetId} onChange={setPreset} />
          {showAdvancedTools ? (
            <>
              <button className="eq-icon-action" type="button" aria-label={t('settings.eq.action.undo')} title={t('settings.eq.action.undo')} disabled={undoStack.length === 0 || headphoneCorrectionManaged} onClick={undoEq}>
                <Undo2 size={15} />
              </button>
              <button className="eq-icon-action" type="button" aria-label={t('settings.eq.action.redo')} title={t('settings.eq.action.redo')} disabled={redoStack.length === 0 || headphoneCorrectionManaged} onClick={redoEq}>
                <Redo2 size={15} />
              </button>
            </>
          ) : null}
          <button className="eq-icon-action" type="button" aria-label={t('settings.eq.action.resetEq')} title={t('settings.eq.action.resetEq')} onClick={reset}>
            <RotateCcw size={15} />
          </button>
        </div>
      </header>

      <div className="eq-quick-strip" data-risk={surfaceClippingRisk} data-active={surfaceDspActive}>
        <button
          className="eq-quick-action eq-quick-action--primary"
          data-active={state.enabled}
          type="button"
          onClick={() => setEnabled(!state.enabled)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>{t('settings.eq.status.eq')}</span>
          <strong>{state.enabled ? t('common.enabled') : t('common.disabled')}</strong>
        </button>
        <button
          aria-label={t('settings.eq.action.holdOriginal')}
          className="eq-quick-action"
          disabled={!state.enabled}
          type="button"
          onPointerDown={holdBypass}
          onPointerUp={releaseBypass}
          onPointerCancel={releaseBypass}
          onBlur={releaseBypass}
        >
          <Shuffle size={15} aria-hidden="true" />
          <span>{t('settings.eq.action.holdOriginal')}</span>
          <strong>{t('settings.eq.signal.bitPerfectOutput')}</strong>
        </button>
        <div className="eq-quick-metric">
          <span>{t('settings.eq.status.preset')}</span>
          <strong>{displayPresetLabel}</strong>
        </div>
        {headphoneCorrectionPresetActive ? (
          <button
            aria-label={state.enabled ? t('settings.eq.headphoneCorrection.compareOriginal') : t('settings.eq.headphoneCorrection.compareCorrected')}
            className="eq-quick-action"
            data-active={!state.enabled}
            type="button"
            onClick={toggleHeadphoneCorrectionCompare}
          >
            <Headphones size={15} aria-hidden="true" />
            <span>{t('settings.eq.headphoneCorrection.ab')}</span>
            <strong>{state.enabled ? t('settings.eq.headphoneCorrection.compareOriginal') : t('settings.eq.headphoneCorrection.compareCorrected')}</strong>
          </button>
        ) : null}
        <label className="eq-quick-slider">
          <span>{t('settings.eq.status.preamp')}</span>
          <input
            aria-label="Quick EQ preamp"
            type="range"
            min={eqMinPreampDb}
            max={eqMaxPreampDb}
            step="0.1"
            value={state.preampDb}
            disabled={headphoneCorrectionManaged}
            onChange={(event) => handlePreampChange(Number(event.currentTarget.value))}
          />
          <strong>{formatDb(state.preampDb)}</strong>
        </label>
        <button
          aria-label="Quick Auto Gain"
          className="eq-quick-action"
          data-active={autoGainEnabled}
          data-state={autoGainStatus}
          type="button"
          onClick={toggleAutoGain}
        >
          <Gauge size={15} aria-hidden="true" />
          <span>{t('settings.eq.autoGain.toggle')}</span>
          <strong>{formatDb(autoGainAdjustmentDb)}</strong>
        </button>
        {showEmbeddedDspModules ? (
          <button
            aria-label="Quick -6 dB headroom"
            className="eq-quick-action"
            data-active={Math.abs((state.dspHeadroomDb ?? 0) + 6) <= 0.05}
            type="button"
            onClick={() => handleDspHeadroomChange(-6)}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            <span>{t('settings.eq.status.headroom')}</span>
            <strong>-6 dB</strong>
          </button>
        ) : null}
        {showEmbeddedDspModules ? (
          <button
            aria-label="Quick native direct"
            className="eq-quick-action"
            disabled={!eqOrBalanceEnabled}
            type="button"
            onClick={handleNativeDirect}
          >
            <RadioTower size={15} aria-hidden="true" />
            <span>{t('settings.eq.routing.playbackPath')}</span>
            <strong>{t('settings.eq.routing.nativeDirect')}</strong>
          </button>
        ) : null}
      </div>

      {headphoneCorrectionManaged ? (
        <section className="eq-headphone-lock" aria-label={t('settings.eq.headphoneCorrection.lockAria')}>
          <span className="eq-headphone-lock__icon">
            <Headphones size={16} aria-hidden="true" />
          </span>
          <div>
            <strong>{t('settings.eq.headphoneCorrection.managed')}</strong>
            <small>{t('settings.eq.headphoneCorrection.lockDetail', { name: headphoneCorrectionDetail })}</small>
          </div>
          <button className="eq-soft-button" type="button" onClick={() => void convertHeadphoneCorrectionToCustom()}>
            {t('settings.eq.headphoneCorrection.convert')}
          </button>
        </section>
      ) : null}

      {!showAdvancedTools ? (
        <>
          <section className="eq-simple-tones" aria-label={t('settings.eq.simpleTone.aria')}>
            {simpleToneOptions.map((option) => (
              <button type="button" data-active={activeSimpleTone === option.id} disabled={headphoneCorrectionManaged} key={option.id} onClick={() => applySimpleTone(option.id)}>
                {option.icon === 'waves' ? <Waves size={15} aria-hidden="true" /> : null}
                {option.icon === 'headphones' ? <Headphones size={15} aria-hidden="true" /> : null}
                {option.icon === 'waveform' ? <AudioWaveform size={15} aria-hidden="true" /> : null}
                {option.icon === 'gauge' ? <Gauge size={15} aria-hidden="true" /> : null}
                {option.icon === 'reset' ? <RotateCcw size={15} aria-hidden="true" /> : null}
                <span>{t(option.labelKey)}</span>
                <strong>{t(option.detailKey)}</strong>
              </button>
            ))}
            {activeSimpleTone && activeSimpleTone !== 'flat' ? (
              <div className="eq-simple-tone-amount">
                <span>{t('settings.eq.simpleTone.amount')}</span>
                <button type="button" aria-label={t('settings.eq.simpleTone.less')} disabled={simpleToneIntensity <= 0.5 || headphoneCorrectionManaged} onClick={() => nudgeSimpleToneIntensity(-0.1)}>
                  {t('settings.eq.simpleTone.less')}
                </button>
                <input
                  aria-label={t('settings.eq.simpleTone.amountAria')}
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={simpleToneIntensity}
                  disabled={headphoneCorrectionManaged}
                  onInput={(event) => adjustSimpleToneIntensity(Number(event.currentTarget.value))}
                  onChange={(event) => adjustSimpleToneIntensity(Number(event.currentTarget.value))}
                />
                <button type="button" aria-label={t('settings.eq.simpleTone.more')} disabled={simpleToneIntensity >= 1.5 || headphoneCorrectionManaged} onClick={() => nudgeSimpleToneIntensity(0.1)}>
                  {t('settings.eq.simpleTone.more')}
                </button>
                <strong>{`${Math.round(simpleToneIntensity * 100)}%`}</strong>
              </div>
            ) : null}
          </section>
          <section className="eq-simple-insight" aria-label={t('settings.eq.simpleInsight.aria')}>
            <span>
              <em>{t('settings.eq.simpleInsight.vibe')}</em>
              <strong>{simpleInsightVibe}</strong>
            </span>
            <span>
              <em>{t('settings.eq.simpleInsight.mainChange')}</em>
              <strong>{simpleInsightMainChange}</strong>
            </span>
            <span>
              <em>{t('settings.eq.simpleInsight.amount')}</em>
              <strong>{simpleInsightAmount}</strong>
            </span>
          </section>
          <section className="eq-simple-zones" aria-label={t('settings.eq.simpleZone.aria')}>
            {simpleZoneSummaries.map((zone) => {
              const zoneLabel = t(zone.labelKey);
              const zoneDetail = t(zone.detailKey);
              const isNeutral = Math.abs(zone.averageGainDb) <= 0.05;
              const zoneValue = isNeutral ? t('settings.eq.simpleZone.neutral') : formatDb(zone.averageGainDb);
              return (
                <button
                  aria-label={t('settings.eq.simpleZone.applyAria', { value: zoneValue, zone: zoneLabel })}
                  data-direction={isNeutral ? 'neutral' : zone.averageGainDb > 0 ? 'boost' : 'cut'}
                  disabled={headphoneCorrectionManaged}
                  key={zone.id}
                  type="button"
                  onClick={() => applySimpleTone(zone.toneId)}
                >
                  <div>
                    <span>{zoneLabel}</span>
                    <strong>{zoneValue}</strong>
                  </div>
                  <div className="eq-simple-zone-bar" aria-hidden="true">
                    <span style={{ width: `${zone.levelPercent}%` } as CSSProperties} />
                  </div>
                  <small>{zoneDetail}</small>
                </button>
              );
            })}
          </section>
          <section className="eq-simple-safety" data-risk={needsSafePreamp} aria-label={t('settings.eq.simpleSafety.aria')}>
            <span className="eq-simple-safety__icon">
              <ShieldCheck size={15} aria-hidden="true" />
            </span>
            <div>
              <strong>{simpleSafetyTitle}</strong>
              <small>{simpleSafetyDetail}</small>
            </div>
            <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || (!canAutoPreamp && !needsSafePreamp)} onClick={() => handlePreampChange(recommendedPreampDb)}>
              <span>{t('settings.eq.simpleSafety.action')}</span>
              <strong>{formatDb(recommendedPreampDb)}</strong>
            </button>
          </section>
          <div className="eq-simple-actions">
            <button className="eq-soft-button" type="button" aria-label={t('settings.eq.simpleAction.nextVibe')} disabled={headphoneCorrectionManaged} onClick={applyNextSimpleTone}>
              <Sparkles size={14} aria-hidden="true" />
              <span>{t('settings.eq.simpleAction.nextVibe')}</span>
              <strong>{t('settings.eq.simpleAction.nextVibeDetail')}</strong>
            </button>
            <button className="eq-soft-button" type="button" aria-label={t('settings.eq.simpleAction.saveVibe')} disabled={headphoneCorrectionManaged || !canSaveSimplePreset} onClick={() => void saveSimplePreset()}>
              <Save size={14} aria-hidden="true" />
              <span>{t('settings.eq.simpleAction.saveVibe')}</span>
              <strong>{t('settings.eq.simpleAction.saveVibeDetail')}</strong>
            </button>
            <button className="eq-soft-button" type="button" disabled={undoStack.length === 0 || headphoneCorrectionManaged} onClick={undoEq}>
              <Undo2 size={14} aria-hidden="true" />
              <span>{t('settings.eq.action.undo')}</span>
              <strong>{t('settings.eq.simpleAction.lastTweak')}</strong>
            </button>
          </div>
        </>
      ) : null}

      {showEmbeddedDspModules ? (
      <div className="eq-dsp-guard" data-mode={dspGuardMode}>
        <div className="eq-dsp-guard__main">
          <span className="eq-dsp-guard__icon">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
          <span>
            <em>{dspActive ? `DSP x${displayedDspModuleCount}` : 'Native path'}</em>
            <strong>{dspGuardTitle}</strong>
          </span>
        </div>
        <p>{dspGuardDetail}</p>
        <div className="eq-dsp-guard__comfort" data-mode={dspComfortMode}>
          <strong>{dspComfortLabel}</strong>
          <span>{dspComfortDetail}</span>
          <small>{dspGuardModules}</small>
        </div>
      </div>
      ) : null}

      {showEmbeddedDspModules ? (
      <div className="eq-routing-summary" data-active={dspActive} data-risk={clippingRisk}>
        <span>
          <em>{t('settings.eq.routing.playbackPath')}</em>
          <strong>{dspActive ? t('settings.eq.routing.dspPath') : t('settings.eq.routing.nativeDirect')}</strong>
          <small>{dspActive ? t('settings.eq.routing.dspPathDetail') : t('settings.eq.routing.nativeDirectDetail')}</small>
        </span>
        <span>
          <em>{t('settings.eq.routing.safety')}</em>
          <strong>{dspLimiterProtecting ? t('settings.eq.routing.protectActive') : dspHeadroomActive ? `${t('settings.eq.status.headroom')} ${formatDb(state.dspHeadroomDb ?? 0)}` : dspHeadroomArmed ? t('settings.eq.routing.headroomStandby') : t('settings.eq.routing.armed')}</strong>
          <small>{dspLimiterProtecting ? t('settings.eq.routing.protectActiveDetail') : dspHeadroomActive ? t('settings.eq.routing.headroomActiveDetail') : dspHeadroomArmed ? t('settings.eq.routing.headroomStandbyDetail') : t('settings.eq.routing.nativeNoGainDetail')}</small>
        </span>
        <span>
          <em>{t('settings.eq.routing.modules')}</em>
          <strong>
            {[
              state.enabled ? t('settings.eq.status.eq') : null,
              roomCorrection.enabled ? 'FIR' : null,
              channelBalance.enabled ? t('settings.eq.channel.group.balance') : null,
            ].filter(Boolean).join(' / ') || t('settings.eq.routing.modulesBypassed')}
          </strong>
          <small>{eqOrBalanceEnabled ? t('settings.eq.routing.modulesActiveDetail') : t('settings.eq.routing.modulesBypassedDetail')}</small>
        </span>
        <div className="eq-routing-actions">
          <button className="eq-soft-button" type="button" disabled={!eqOrBalanceEnabled} onClick={handleNativeDirect}>
            {t('settings.eq.routing.action.nativeDirect')}
          </button>
          <button className="eq-soft-button" data-active={Math.abs((state.dspHeadroomDb ?? 0) + 6) <= 0.05} type="button" onClick={() => handleDspHeadroomChange(-6)}>
            {t('settings.eq.routing.action.armHeadroom6')}
          </button>
        </div>
      </div>
      ) : null}

      <div className="eq-simple-summary" data-risk={surfaceClippingRisk} data-mode={eqUiMode}>
        <span>
          <em>{t('settings.eq.status.preset')}</em>
          <strong>{displayPresetLabel}</strong>
        </span>
        <span>
          <em>{t('settings.eq.status.headroom')}</em>
          <strong>{formatLevelDb(audioLevels?.headroomDb)}</strong>
        </span>
        <span>
          <em>{t('settings.eq.status.bitPerfect')}</em>
          <strong>{surfaceDspActive ? t('settings.eq.signal.dspActive') : t('settings.eq.signal.bitPerfectOutput')}</strong>
        </span>
        {showEmbeddedDspModules ? (
          <span>
            <em>{t('settings.eq.room.short')}</em>
            <strong>{roomCorrectionStatusLabel}</strong>
          </span>
        ) : null}
        <span>
          <em>{t('settings.eq.mode.current')}</em>
          <strong>{eqUiMode === 'pro' ? t('settings.eq.mode.pro') : t('settings.eq.mode.simple')}</strong>
        </span>
      </div>

      <div className="eq-signal-strip" aria-label={t('settings.eq.signal.title')}>
        <div className="eq-signal-heading">
          <Activity size={16} aria-hidden="true" />
          <span>{t('settings.eq.signal.title')}</span>
          <strong>{surfaceDspActive ? t('settings.eq.signal.dspActive') : t('settings.eq.signal.bitPerfectOutput')}</strong>
        </div>
        <div className="eq-signal-chain">
          <span className="eq-signal-node" data-active="true">
            <RadioTower size={14} aria-hidden="true" />
            <em>{t('settings.eq.signal.input')}</em>
            <strong>{formatLevelDb(audioLevels?.inputPeakDb)}</strong>
          </span>
          <span className="eq-signal-node" data-active={state.preampDb !== 0}>
            <Gauge size={14} aria-hidden="true" />
            <em>{t('settings.eq.signal.preamp')}</em>
            <strong>{formatDb(state.preampDb)}</strong>
          </span>
          {showEmbeddedDspModules ? (
            <span className="eq-signal-node" data-active={dspHeadroomActive} data-standby={dspHeadroomArmed && !dspHeadroomActive}>
              <ShieldCheck size={14} aria-hidden="true" />
              <em>{t('settings.eq.status.headroom')}</em>
              <strong>{dspHeadroomArmed ? formatDb(state.dspHeadroomDb ?? 0) : t('settings.eq.channel.bypassed')}</strong>
            </span>
          ) : null}
          <span className="eq-signal-node" data-active={state.enabled}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            <em>{t('settings.eq.signal.peq')}</em>
            <strong>{state.enabled ? `${activeBandCount}/${state.bands.length}` : t('settings.eq.channel.bypassed')}</strong>
          </span>
          {showEmbeddedDspModules ? (
            <span className="eq-signal-node" data-active={roomCorrection.enabled} data-risk={roomCorrection.clippingRisk}>
              <Waves size={14} aria-hidden="true" />
              <em>{t('settings.eq.room.short')}</em>
              <strong>{roomCorrection.enabled ? formatDb(roomCorrection.trimDb) : roomCorrectionStatusLabel}</strong>
            </span>
          ) : null}
          <span className="eq-signal-node" data-active={showEmbeddedDspModules ? state.enabled || roomCorrection.enabled || channelBalance.enabled : state.enabled} data-risk={surfaceClippingRisk}>
            <ShieldCheck size={14} aria-hidden="true" />
            <em>{t('settings.eq.signal.limiter')}</em>
            <strong>{dspLimiterProtecting ? t('settings.eq.signal.protecting') : surfaceClippingRisk ? t('settings.eq.status.warning') : t('settings.eq.signal.armed')}</strong>
          </span>
          <span className="eq-signal-node" data-active={surfaceDspActive}>
            <Waves size={14} aria-hidden="true" />
            <em>{t('settings.eq.signal.output')}</em>
            <strong>{surfaceDspActive ? t('settings.eq.signal.dspOutput') : t('settings.eq.status.bitPerfect')}</strong>
          </span>
        </div>
      </div>

      {showAdvancedTools ? (
      <div className="eq-status-cards">
        <div className="eq-status-card">
          <span>{t('settings.eq.status.eq')}</span>
          <strong>{state.enabled ? t('common.enabled') : t('common.disabled')}</strong>
        </div>
        <div className="eq-status-card">
          <span>{t('settings.eq.status.preset')}</span>
          <strong>{displayPresetLabel}</strong>
        </div>
        <div className="eq-status-card">
          <span>{t('settings.eq.status.estimatedPeak')}</span>
          <strong>{formatDb(estimatedPeakGainDb)}</strong>
        </div>
        <div className="eq-status-card">
          <span>{t('settings.eq.status.processor')}</span>
          <strong>{t('settings.eq.status.realtimeIir')}</strong>
        </div>
        {showEmbeddedDspModules ? (
          <div className="eq-status-card" data-active={roomCorrection.enabled} data-risk={roomCorrection.clippingRisk || roomCorrection.status === 'error'}>
            <span>{t('settings.eq.room.title')}</span>
            <strong>{roomCorrectionStatusLabel}</strong>
          </div>
        ) : null}
        <div className="eq-status-card" data-risk={surfaceClippingRisk}>
          <span>{surfaceClippingRisk ? t('settings.eq.status.clippingRisk') : t('settings.eq.status.headroom')}</span>
          <strong>{surfaceClippingRisk ? t('settings.eq.status.warning') : t('settings.eq.status.safe')}</strong>
        </div>
        <div className="eq-status-card" data-active={surfaceDspActive}>
          <span>{t('settings.eq.status.bitPerfect')}</span>
          <strong>{surfaceDspActive ? t('common.disabled') : t('common.ready')}</strong>
        </div>
      </div>
      ) : null}

      {selectedPresetMetadata && showAdvancedTools ? (
        <aside className="eq-preset-metadata" data-category={selectedPresetMetadata.category}>
          <span>{t(selectedPresetMetadata.targetTypeKey as TranslationKey)}</span>
          {selectedPresetMetadata.approximation ? <strong>{t('settings.eq.preset.approximation')}</strong> : null}
          <p>{t(selectedPresetMetadata.purposeKey as TranslationKey)}</p>
          <p>{t(selectedPresetMetadata.scenarioKey as TranslationKey)}</p>
          <em>{t(selectedPresetMetadata.cautionKey as TranslationKey)}</em>
        </aside>
      ) : null}

      <div className="eq-workbench" data-managed={headphoneCorrectionManaged}>
        <div className="eq-curve-column">
          <div className="eq-preamp-bar" data-auto-gain={autoGainActive}>
            <div>
              <span>{t('settings.eq.preamp.inputSafety')}</span>
              <strong>{formatDb(state.preampDb)}</strong>
            </div>
            <div className="eq-preamp-metrics" aria-label={t('settings.eq.preamp.metricsAria')}>
              <span>{t('settings.eq.preamp.recommended')}</span>
              <strong>{formatDb(recommendedPreampDb)}</strong>
              <span>{t('settings.eq.preamp.maxBoost')}</span>
              <strong>{formatDb(maxBandGainDb)}</strong>
              <span>{t('settings.eq.status.estimatedPeak')}</span>
              <strong>{formatDb(estimatedPeakGainDb)}</strong>
            </div>
            <div className="eq-level-meter" data-risk={surfaceClippingRisk}>
              <span>
                <em>{t('settings.eq.level.inputPeak')}</em>
                <strong>{formatLevelDb(audioLevels?.inputPeakDb)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.level.inputRms')}</em>
                <strong>{formatLevelDb(audioLevels?.inputRmsDb)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.level.estimatedOutputPeak')}</em>
                <strong>{formatLevelDb(audioLevels?.estimatedOutputPeakDb)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.level.headroom')}</em>
                <strong>{formatLevelDb(audioLevels?.headroomDb)}</strong>
              </span>
              <p>
                {t('settings.eq.level.sourceEstimate')}
                {(audioLevels?.clipCount ?? 0) > 0 ? ` / ${t('settings.eq.level.clips', { count: String(audioLevels?.clipCount ?? 0) })}` : ''}
              </p>
            </div>
            <input
              aria-label={t('settings.eq.preamp.aria')}
              type="range"
              min={eqMinPreampDb}
              max={eqMaxPreampDb}
              step="0.1"
              value={state.preampDb}
              disabled={headphoneCorrectionManaged}
              onChange={(event) => handlePreampChange(Number(event.currentTarget.value))}
            />
            <button className="eq-soft-button" data-risk={needsSafePreamp} type="button" disabled={headphoneCorrectionManaged || (!canAutoPreamp && !needsSafePreamp)} onClick={() => handlePreampChange(recommendedPreampDb)}>
              {needsSafePreamp ? t('settings.eq.action.applySafePreamp') : t('settings.eq.action.autoPreamp', { value: formatDb(recommendedPreampDb) })}
            </button>
            {showEmbeddedDspModules ? (
            <div className="eq-dsp-headroom-control" data-active={dspHeadroomActive}>
              <div>
                <span>{t('settings.eq.headroom.dsp')}</span>
                <strong>{formatDb(state.dspHeadroomDb ?? 0)}</strong>
              </div>
              <input
                aria-label={t('settings.eq.headroom.dsp')}
                type="range"
                min={dspHeadroomMinDb}
                max={dspHeadroomMaxDb}
                step="0.1"
                value={state.dspHeadroomDb ?? 0}
                onChange={(event) => handleDspHeadroomChange(Number(event.currentTarget.value))}
              />
              <div className="eq-dsp-headroom-presets" role="group" aria-label={t('settings.eq.headroom.presetsAria')}>
                {[0, -3, -6].map((headroomDb) => (
                  <button
                    className="eq-soft-button"
                    data-active={Math.abs((state.dspHeadroomDb ?? 0) - headroomDb) <= 0.05}
                    key={headroomDb}
                    type="button"
                    onClick={() => handleDspHeadroomChange(headroomDb)}
                  >
                    {formatDb(headroomDb)}
                  </button>
                ))}
              </div>
              <p>{t('settings.eq.headroom.nativeBypassNote')}</p>
            </div>
            ) : null}
            <div className="eq-auto-gain-controls">
              <button
                className="eq-soft-button eq-auto-gain-toggle"
                data-active={autoGainEnabled}
                data-state={autoGainStatus}
                type="button"
                onClick={toggleAutoGain}
              >
                <Gauge size={14} aria-hidden="true" />
                {t('settings.eq.autoGain.toggle')}
              </button>
              <span className="eq-auto-gain-status" data-state={autoGainStatus}>
                <span>{t('settings.eq.autoGain.status')}</span>
                <strong>{t(eqAutoGainStatusKeys[autoGainStatus])}</strong>
                <em>{t('settings.eq.autoGain.adjustment', { value: formatDb(autoGainAdjustmentDb) })}</em>
              </span>
            </div>
            {showAdvancedTools ? (
              <div className="eq-analyzer-controls">
                <button
                  className="eq-soft-button eq-analyzer-toggle"
                  data-active={spectrumAnalyzerEnabled}
                  data-live={visualSpectrumReady}
                  type="button"
                  onClick={() => setSpectrumAnalyzerEnabled((current) => !current)}
                >
                  <Activity size={14} aria-hidden="true" />
                  {t('settings.eq.analyzer.toggle')}
                </button>
                <div className="eq-analyzer-mode" role="group" aria-label={t('settings.eq.analyzer.mode')}>
                  <button className="eq-soft-button" data-active={analyzerMode === 'input'} type="button" onClick={() => setAnalyzerMode('input')}>
                    {t('settings.eq.analyzer.input')}
                  </button>
                  <button className="eq-soft-button" data-active={analyzerMode === 'postEq'} type="button" onClick={() => setAnalyzerMode('postEq')}>
                    {t('settings.eq.analyzer.postEq')}
                  </button>
                </div>
                <span className="eq-analyzer-status" data-state={analyzerStatusState}>
                  <span>{t('settings.eq.analyzer.status')}</span>
                  <strong>{t(analyzerStatusKey)}</strong>
                </span>
              </div>
            ) : null}
            {showAdvancedTools && showEmbeddedDspModules ? (
              <section className="eq-room-correction" data-enabled={roomCorrection.enabled} data-risk={roomCorrection.clippingRisk || roomCorrection.status === 'error'}>
                <div className="eq-room-correction-header">
                  <span>
                    <Waves size={15} aria-hidden="true" />
                    {t('settings.eq.room.title')}
                  </span>
                  <strong>{roomCorrectionStatusLabel}</strong>
                </div>
                <div className="eq-room-correction-actions">
                  <button className="eq-soft-button" type="button" onClick={importRoomCorrectionIr}>
                    {t('settings.eq.room.import')}
                  </button>
                  <button className="eq-soft-button" data-active={roomCorrection.enabled} type="button" disabled={!roomCorrection.irId} onClick={toggleRoomCorrection}>
                    {roomCorrection.enabled ? t('settings.eq.room.disable') : t('settings.eq.room.enable')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!roomCorrection.irId} onClick={clearRoomCorrection}>
                    {t('settings.eq.room.clear')}
                  </button>
                </div>
                <label className="eq-room-correction-trim">
                  <span>{t('settings.eq.room.trim')}</span>
                  <input
                    type="range"
                    min={roomCorrectionMinTrimDb}
                    max={roomCorrectionMaxTrimDb}
                    step="0.1"
                    value={roomCorrection.trimDb}
                    disabled={!roomCorrection.irId}
                    onChange={(event) => setRoomCorrectionTrim(Number(event.currentTarget.value))}
                  />
                  <strong>{formatDb(roomCorrection.trimDb)}</strong>
                </label>
                <div className="eq-room-correction-details">
                  <span>
                    <em>{t('settings.eq.room.ir')}</em>
                    <strong>{roomCorrection.irName ?? t('settings.eq.room.empty')}</strong>
                  </span>
                  <span>
                    <em>{t('settings.eq.room.channelMode')}</em>
                    <strong>{roomCorrection.channelMode}</strong>
                  </span>
                  <span>
                    <em>{t('settings.eq.room.sampleRate')}</em>
                    <strong>{roomCorrection.sampleRate ? `${Math.round(roomCorrection.sampleRate)} Hz` : '--'}</strong>
                  </span>
                  <span>
                    <em>{t('settings.eq.room.tapCount')}</em>
                    <strong>{roomCorrection.tapCount > 0 ? String(roomCorrection.tapCount) : '--'}</strong>
                  </span>
                </div>
              </section>
            ) : null}
          </div>
          <EqCurveView
            bands={state.bands}
            enabled={state.enabled}
            frequencyUnlocked={frequencyEditUnlocked}
            selectedBandIndex={selectedBandIndex}
            spectrumEnabled={showAdvancedTools && spectrumAnalyzerEnabled}
            analyzerMode={analyzerMode}
            visualSpectrum={audioLevels?.visualSpectrum}
            visualTelemetryState={audioLevels?.visualTelemetryState}
            onBandSelect={setSelectedBandIndex}
            onBandChange={headphoneCorrectionManaged ? () => setError(t('settings.eq.headphoneCorrection.lockedError')) : handleBandChange}
            onBandCommit={headphoneCorrectionManaged ? () => setError(t('settings.eq.headphoneCorrection.lockedError')) : handleBandCommit}
            onBandFrequencyChange={headphoneCorrectionManaged ? () => setError(t('settings.eq.headphoneCorrection.lockedError')) : handleBandFrequencyChange}
            onBandFrequencyCommit={headphoneCorrectionManaged ? () => setError(t('settings.eq.headphoneCorrection.lockedError')) : handleBandFrequencyCommit}
          />
          {showAdvancedTools ? (
          <div className="eq-band-console" aria-label={t('settings.eq.band.console')} data-bypassed={!selectedBandEnabled}>
            <div className="eq-band-console-heading">
              <span>
                <Waves size={15} aria-hidden="true" />
                {t('settings.eq.band.console')}
              </span>
              <strong>{selectedBand ? `${selectedBandIndex + 1} / ${formatFrequencyLabel(selectedBand.frequencyHz)}` : t('settings.eq.band.fallback')}</strong>
            </div>
            <div className="eq-band-console-grid">
              <span>
                <em>{t('settings.eq.band.filterType')}</em>
                <strong>{t(eqFilterLabelKeys[selectedBandFilterType])}</strong>
              </span>
              <span>
                <em>{t('settings.eq.band.frequency')}</em>
                <strong>{selectedBand ? formatFrequencyLabel(selectedBand.frequencyHz) : '--'}</strong>
              </span>
              <span>
                <em>{t('settings.eq.band.gain')}</em>
                <strong>{formatDb(selectedBandGainEditable ? selectedBand?.gainDb ?? 0 : 0)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.band.q')}</em>
                <strong>{(selectedBand?.q ?? 1).toFixed(1)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.channel.dsp')}</em>
                <strong>{selectedBandEnabled ? t('settings.eq.band.enabled') : t('settings.eq.band.bypassed')}</strong>
              </span>
              <span>
                <em>{t('settings.eq.curve.snapped')}</em>
                <strong>{selectedBandMode}</strong>
              </span>
            </div>
          </div>
          ) : null}
          {showAdvancedTools ? (
            <div className="eq-advanced-grid">
              <section className="eq-advanced-section eq-inspector" aria-label={t('settings.eq.band.inspector')}>
                <div className="eq-inspector-title">
                  <span>{t('settings.eq.band.inspector')}</span>
                  <strong>{selectedBand ? formatFrequencyLabel(selectedBand.frequencyHz) : t('settings.eq.band.fallback')}</strong>
                </div>
                <div className="eq-inspector-fields">
                  <label>
                    <span>{t('settings.eq.band.frequency')}</span>
                    <input
                      aria-label={t('settings.eq.band.frequency')}
                      type="number"
                      min={eqMinFrequencyHz}
                      max={eqMaxFrequencyHz}
                      step={frequencyEditUnlocked ? 1 : undefined}
                      value={Math.round(selectedBand?.frequencyHz ?? eqFrequenciesHz[selectedBandIndex] ?? 1000)}
                      disabled={headphoneCorrectionManaged}
                      onChange={(event) => handleBandFrequencyChange(selectedBandIndex, Number(event.currentTarget.value))}
                      onBlur={(event) => handleBandFrequencyCommit(selectedBandIndex, Number(event.currentTarget.value))}
                    />
                    <em>{frequencyEditUnlocked ? t('settings.eq.band.frequencyUnlocked') : t('settings.eq.band.frequencySnapped')}</em>
                  </label>
                  <label>
                    <span>{t('settings.eq.band.gain')}</span>
                    <input
                      aria-label={t('settings.eq.band.gain')}
                      type="number"
                      min="-12"
                      max="12"
                      step="0.1"
                      value={selectedBandGainEditable ? selectedBand?.gainDb ?? 0 : 0}
                      disabled={headphoneCorrectionManaged || !selectedBandGainEditable}
                      onChange={(event) => handleBandChange(selectedBandIndex, Number(event.currentTarget.value))}
                      onBlur={(event) => handleBandCommit(selectedBandIndex, Number(event.currentTarget.value))}
                    />
                    {!selectedBandGainEditable ? <em>{t('settings.eq.band.gainFixed')}</em> : null}
                  </label>
                  <label>
                    <span>{t('settings.eq.band.q')}</span>
                    <input
                      aria-label={t('settings.eq.band.q')}
                      type="number"
                      min={eqMinQ}
                      max={eqMaxQ}
                      step="0.1"
                      value={selectedBand?.q ?? 1}
                      disabled={headphoneCorrectionManaged}
                      onChange={(event) => {
                        if (headphoneCorrectionManaged) {
                          setError(t('settings.eq.headphoneCorrection.lockedError'));
                          return;
                        }
                        const q = Number(event.currentTarget.value);
                        setState((current) => ({
                          ...current,
                          presetId: 'custom',
                          presetName: 'Custom',
                          bands: current.bands.map((item, index) => (index === selectedBandIndex ? { ...item, q } : item)),
                        }));
                      }}
                      onBlur={(event) => handleBandQCommit(selectedBandIndex, Number(event.currentTarget.value))}
                    />
                  </label>
                  <label>
                    <span>{t('settings.eq.band.filterType')}</span>
                    <select
                      aria-label={t('settings.eq.band.filterType')}
                      value={selectedBand?.filterType ?? 'peaking'}
                      disabled={headphoneCorrectionManaged}
                      onChange={(event) => handleBandFilterTypeChange(selectedBandIndex, event.currentTarget.value as EqFilterType)}
                    >
                      {eqFilterTypes.map((filterType) => (
                        <option value={filterType} key={filterType}>
                          {t(eqFilterLabelKeys[filterType])}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="eq-inspector-actions">
                  <label className="eq-inspector-toggle">
                    <input
                      type="checkbox"
                      checked={selectedBand?.enabled !== false}
                      disabled={headphoneCorrectionManaged}
                      onChange={(event) => toggleBandEnabled(selectedBandIndex, event.currentTarget.checked)}
                    />
                    <span>{selectedBand?.enabled === false ? t('settings.eq.band.bypassed') : t('settings.eq.band.enabled')}</span>
                  </label>
                  <label className="eq-inspector-toggle">
                    <input type="checkbox" checked={frequencyUnlocked} disabled={headphoneCorrectionManaged} onChange={(event) => setFrequencyUnlocked(event.currentTarget.checked)} />
                    <span>{t('settings.eq.action.unlockFrequency')}</span>
                  </label>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={resetSelectedBand}>
                    {t('settings.eq.action.resetBand', { frequency: selectedBand ? formatFrequencyLabel(selectedBand.frequencyHz) : t('settings.eq.band.fallback') })}
                  </button>
                </div>
                <div className="eq-stepper-group" aria-label={t('settings.eq.band.gainStepper')}>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || !selectedBandGainEditable} onClick={() => adjustSelectedGain(-0.5)}>-0.5</button>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || !selectedBandGainEditable} onClick={() => adjustSelectedGain(-0.1)}>-0.1</button>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || !selectedBandGainEditable} onClick={() => adjustSelectedGain(0.1)}>+0.1</button>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || !selectedBandGainEditable} onClick={() => adjustSelectedGain(0.5)}>+0.5</button>
                </div>
                <div className="eq-stepper-group eq-q-preset-group" aria-label={t('settings.eq.band.qPresets')}>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={() => handleBandQPresetCommit(selectedBandIndex, selectedBandQPresets.wide)}>
                    {t('settings.eq.band.qPresetWide')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={() => handleBandQPresetCommit(selectedBandIndex, selectedBandQPresets.normal)}>
                    {t('settings.eq.band.qPresetNormal')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={() => handleBandQPresetCommit(selectedBandIndex, selectedBandQPresets.narrow)}>
                    {t('settings.eq.band.qPresetNarrow')}
                  </button>
                </div>
                <div className="eq-stepper-group" aria-label={t('settings.eq.band.frequencyStepper')}>
                  <button className="eq-soft-button" type="button" disabled={!frequencyEditUnlocked} onClick={() => adjustSelectedFrequency(-1, false)}>
                    {t('settings.eq.action.freqDown')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!frequencyEditUnlocked} onClick={() => adjustSelectedFrequency(-1, true)}>
                    {t('settings.eq.action.freqFineDown')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!frequencyEditUnlocked} onClick={() => adjustSelectedFrequency(1, true)}>
                    {t('settings.eq.action.freqFineUp')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!frequencyEditUnlocked} onClick={() => adjustSelectedFrequency(1, false)}>
                    {t('settings.eq.action.freqUp')}
                  </button>
                </div>
              </section>

              <section className="eq-advanced-section eq-profile-panel" aria-label={t('settings.eq.profile.title')}>
                <div className="eq-section-heading">
                  <span>{t('settings.eq.profile.title')}</span>
                  <strong>{profileBinding ? profileBinding.profileName : t('settings.eq.profile.empty')}</strong>
                </div>
                <div className="eq-profile-row">
                  <select
                    aria-label={t('settings.eq.profile.selectorAria')}
                    value={selectedProfileId}
                    onChange={(event) => {
                      const nextId = event.currentTarget.value;
                      setSelectedProfileId(nextId);
                      setProfileName(profiles.find((profile) => profile.id === nextId)?.name ?? '');
                    }}
                  >
                    <option value="">{t('settings.eq.profile.empty')}</option>
                    {profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t('settings.eq.profile.nameAria')}
                    value={profileName}
                    placeholder={t('settings.eq.profile.namePlaceholder')}
                    onChange={(event) => setProfileName(event.currentTarget.value)}
                  />
                </div>
                <div className="eq-profile-actions">
                  <button className="eq-soft-button" type="button" onClick={() => void saveCurrentProfile()}>
                    <Save size={14} />
                    {t('settings.eq.action.saveProfile')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!selectedProfileId} onClick={() => void applySelectedProfile()}>
                    {t('settings.eq.action.applyProfile')}
                  </button>
                  <button className="eq-soft-button" type="button" disabled={!selectedProfileId} onClick={() => void bindSelectedProfileToOutput()}>
                    {t('settings.eq.action.bindProfile')}
                  </button>
                  <button className="eq-icon-action" type="button" aria-label={t('settings.eq.action.deleteProfile')} title={t('settings.eq.action.deleteProfile')} disabled={!selectedProfileId} onClick={() => void deleteSelectedProfile()}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <span className="eq-profile-status">
                  {profileBinding
                    ? t('settings.eq.profile.bound', { profile: profileBinding.profileName, output: currentOutputLabel })
                    : t('settings.eq.profile.unbound', { output: currentOutputLabel })}
                </span>
              </section>
            </div>
          ) : null}
          {showAdvancedTools ? (
          <div className="eq-band-strip" aria-label={t('settings.eq.band.readoutsAria')}>
            <div className="eq-band-strip-heading">
              <span>{t('settings.eq.band.filterStack')}</span>
              <strong>{`${configuredBandCount}/${state.bands.length} ${t('settings.eq.band.filters')}`}</strong>
            </div>
            <div className="eq-band-list">
              {state.bands.map((band, index) => (
                <button
                  className="eq-band-chip"
                  data-selected={selectedBandIndex === index}
                  data-bypassed={band.enabled === false}
                  data-empty={isBandSlotAvailable(band, index)}
                  type="button"
                  key={`${band.frequencyHz}-${index}`}
                  onClick={() => setSelectedBandIndex(index)}
                  onDoubleClick={() => handleBandCommit(index, 0)}
                >
                  <span className="eq-band-chip-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="eq-band-chip-type">{t(eqFilterLabelKeys[band.filterType ?? 'peaking'])}</span>
                  <span className="eq-band-chip-frequency">{formatFrequencyLabel(band.frequencyHz)}</span>
                  <strong>{band.enabled === false ? t('settings.eq.band.bypassed') : formatDb(isEqFilterGainEditable(band.filterType) ? band.gainDb : 0)}</strong>
                  <span className="eq-band-chip-q">{`Q ${Number(band.q ?? 1).toFixed(1)}`}</span>
                </button>
              ))}
            </div>
            <div className="eq-band-actions">
              <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={addFilterSlot}>
                <Plus size={14} />
                {t('settings.eq.action.addFilter')}
              </button>
              <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged || !selectedBand} onClick={deleteSelectedFilter}>
                <Trash2 size={14} />
                {t('settings.eq.action.deleteFilter')}
              </button>
              <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={resetSelectedBand}>
                {t('settings.eq.action.resetSelected')}
              </button>
              <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={resetAllGains}>
                {t('settings.eq.action.resetAllGains')}
              </button>
              {showAdvancedTools ? (
                <button className="eq-soft-button" type="button" disabled={headphoneCorrectionManaged} onClick={resetStandardFrequencies}>
                  {t('settings.eq.action.resetFrequencies')}
                </button>
              ) : null}
            </div>
          </div>
          ) : null}
        </div>
      </div>

      {showAdvancedTools ? (
        <details className="eq-pro-section" open>
          <summary>{t('settings.eq.section.compare')}</summary>
        <div className="eq-compare-panel">
          <div className="eq-compare-heading">
            <div>
              <span className="eq-compare-label">{t('settings.eq.ab.title')}</span>
              <p>{bitPerfectText}</p>
            </div>
            <label className="eq-compare-toggle">
              <input type="checkbox" checked={loudnessMatchedAb} onChange={(event) => setLoudnessMatchedAb(event.currentTarget.checked)} />
              <span>{t('settings.eq.ab.loudnessMatched')}</span>
            </label>
          </div>
          <div className="eq-ab-slots">
            <section className="eq-ab-slot" data-filled={Boolean(abSlots.a)}>
              <div className="eq-ab-slot-header">
                <span>A</span>
                <strong>{abSlots.a ? abSlots.a.presetName : t('settings.eq.ab.emptySlot')}</strong>
              </div>
              <p className="eq-ab-summary">{abSlots.a ? t('settings.eq.ab.summary', {
                output: formatLevelDb(estimateSlotOutputPeak(abSlots.a, audioLevels?.inputPeakDb)),
                peak: formatDb(computeEstimatedPeakGain(abSlots.a)),
                preamp: formatDb(abSlots.a.preampDb),
                preset: abSlots.a.presetName,
              }) : t('settings.eq.ab.emptySlot')}</p>
              <div className="eq-ab-slot-actions">
                <button className="eq-soft-button" type="button" onClick={() => storeAbSlot('a')}>
                  {t('settings.eq.action.storeA')}
                </button>
                <button className="eq-soft-button" type="button" disabled={!abSlots.a} onClick={() => restoreAbSlot('a')}>
                  {t('settings.eq.action.applyA')}
                </button>
              </div>
            </section>
            <section className="eq-ab-slot" data-filled={Boolean(abSlots.b)}>
              <div className="eq-ab-slot-header">
                <span>B</span>
                <strong>{abSlots.b ? abSlots.b.presetName : t('settings.eq.ab.emptySlot')}</strong>
              </div>
              <p className="eq-ab-summary">{abSlots.b ? t('settings.eq.ab.summary', {
                output: formatLevelDb(estimateSlotOutputPeak(abSlots.b, audioLevels?.inputPeakDb)),
                peak: formatDb(computeEstimatedPeakGain(abSlots.b)),
                preamp: formatDb(abSlots.b.preampDb),
                preset: abSlots.b.presetName,
              }) : t('settings.eq.ab.emptySlot')}</p>
              <div className="eq-ab-slot-actions">
                <button className="eq-soft-button" type="button" onClick={() => storeAbSlot('b')}>
                  {t('settings.eq.action.storeB')}
                </button>
                <button className="eq-soft-button" type="button" disabled={!abSlots.b} onClick={() => restoreAbSlot('b')}>
                  {t('settings.eq.action.applyB')}
                </button>
              </div>
            </section>
          </div>
          <div className="eq-compare-actions">
            <button
              className="eq-soft-button"
              type="button"
              onPointerDown={holdBypass}
              onPointerUp={releaseBypass}
              onPointerCancel={releaseBypass}
              onBlur={releaseBypass}
            >
              {t('settings.eq.action.holdBypass')}
            </button>
            <button className="eq-soft-button" type="button" onClick={() => setEnabled(!state.enabled)}>
              {state.enabled ? t('settings.eq.action.toggleBypassOn') : t('settings.eq.action.toggleBypassOff')}
            </button>
            <span className="eq-compare-health" data-risk={surfaceClippingRisk}>
              {surfaceClippingRisk ? t('settings.eq.warning.lowerPreamp') : <><ShieldCheck size={14} /> {t('settings.eq.status.safeHeadroomShort')}</>}
            </span>
          </div>
        </div>
        </details>
      ) : null}

      {showEmbeddedDspModules ? (
      <details className="eq-pro-section" open>
        <summary>{t('settings.eq.section.channel')}</summary>
      <section className="channel-balance-panel" aria-label="Channel balance panel" data-enabled={channelBalance.enabled}>
        <header className="channel-balance-header">
          <div className="eq-title-block">
            <span className="eq-title-icon">
              <Headphones size={18} />
            </span>
            <div>
              <h3>{t('settings.eq.channel.title')}</h3>
              <p>{t('settings.eq.channel.description')}</p>
            </div>
          </div>
          <div className="channel-balance-actions">
            <label className="eq-enable-pill">
              <input
                type="checkbox"
                checked={calibrationMode}
                onChange={(event) => setCalibrationMode(event.currentTarget.checked)}
              />
              <span>{t('settings.eq.channel.calibrationMode')}</span>
            </label>
            <label className="eq-enable-pill">
              <input
                type="checkbox"
                checked={channelBalance.enabled}
                onChange={(event) => patchChannelBalance({ enabled: event.currentTarget.checked })}
              />
              <span>{channelBalance.enabled ? t('common.enabled') : t('settings.eq.action.bypass')}</span>
            </label>
            <button className="eq-icon-action" type="button" aria-label={t('settings.eq.action.resetChannelBalance')} title={t('settings.eq.action.resetChannelBalance')} onClick={resetChannelBalance}>
              <RotateCcw size={15} />
            </button>
          </div>
        </header>

        <div className="channel-balance-status-strip" data-risk={channelBalanceRisk || clippingRisk}>
          <span>
            <em>{t('settings.eq.channel.group.balance')}</em>
            <strong>{balanceReadout}</strong>
          </span>
          <span>
            <em>{t('settings.eq.channel.group.gainTrim')}</em>
            <strong>{formatDb(Math.max(leftTotalDb, rightTotalDb))}</strong>
          </span>
          <span>
            <em>{t('settings.eq.channel.group.timing')}</em>
            <strong>{`${formatDelayMs(leftDelayMs)} / ${formatDelayMs(rightDelayMs)}`}</strong>
          </span>
          <span>
            <em>{t('settings.eq.channel.dsp')}</em>
            <strong>{channelBalance.enabled ? t('settings.eq.channel.active') : t('settings.eq.channel.bypassed')}</strong>
          </span>
          <span>
            <em>{t('settings.eq.level.headroom')}</em>
            <strong>{formatLevelDb(audioLevels?.headroomDb)}</strong>
          </span>
        </div>

        <div className="channel-console-grid">
          <section className="channel-tool-group channel-control-desk">
            <header>
              <span>{t('settings.eq.channel.group.balance')} / {t('settings.eq.channel.group.gainTrim')}</span>
              <strong>{balanceReadout}</strong>
            </header>
            <div className="channel-control-main">
              <div className="channel-balance-lane">
                <div className="channel-balance-meter" aria-hidden="true">
                  <span style={{ left: `${50 + channelBalance.balance * 50}%` }} />
                </div>
                <label>
                  <em>L</em>
                  <input
                    aria-label={t('settings.eq.channel.balance')}
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={Math.round(channelBalance.balance * 100)}
                    onChange={(event) => patchChannelBalance({ balance: Number(event.currentTarget.value) / 100 })}
                  />
                  <em>R</em>
                </label>
              </div>
              <div className="channel-trim-lane">
                <label>
                  <span>{t('settings.eq.channel.leftGain')}</span>
                  <input
                    aria-label={t('settings.eq.channel.leftGain')}
                    type="range"
                    min={channelBalanceMinGainDb}
                    max={channelBalanceMaxGainDb}
                    step="0.1"
                    value={channelBalance.leftGainDb}
                    onChange={(event) => patchChannelBalance({ leftGainDb: Number(event.currentTarget.value) })}
                  />
                  <strong>{formatDb(channelBalance.leftGainDb)}</strong>
                </label>
                <label>
                  <span>{t('settings.eq.channel.rightGain')}</span>
                  <input
                    aria-label={t('settings.eq.channel.rightGain')}
                    type="range"
                    min={channelBalanceMinGainDb}
                    max={channelBalanceMaxGainDb}
                    step="0.1"
                    value={channelBalance.rightGainDb}
                    onChange={(event) => patchChannelBalance({ rightGainDb: Number(event.currentTarget.value) })}
                  />
                  <strong>{formatDb(channelBalance.rightGainDb)}</strong>
                </label>
                <button className="eq-soft-button" type="button" onClick={resetTrimsOnly}>
                  {t('settings.eq.action.resetTrimsOnly')}
                </button>
              </div>
              <div className="channel-trim-lane channel-delay-lane">
                <label>
                  <span>{t('settings.eq.channel.leftDelay')}</span>
                  <input
                    aria-label={t('settings.eq.channel.leftDelay')}
                    type="range"
                    min={channelBalanceMinDelayMs}
                    max={channelBalanceMaxDelayMs}
                    step="0.01"
                    value={leftDelayMs}
                    onChange={(event) => patchChannelBalance({ leftDelayMs: Number(event.currentTarget.value) })}
                  />
                  <strong>{formatDelayMs(leftDelayMs)}</strong>
                </label>
                <label>
                  <span>{t('settings.eq.channel.rightDelay')}</span>
                  <input
                    aria-label={t('settings.eq.channel.rightDelay')}
                    type="range"
                    min={channelBalanceMinDelayMs}
                    max={channelBalanceMaxDelayMs}
                    step="0.01"
                    value={rightDelayMs}
                    onChange={(event) => patchChannelBalance({ rightDelayMs: Number(event.currentTarget.value) })}
                  />
                  <strong>{formatDelayMs(rightDelayMs)}</strong>
                </label>
                <button className="eq-soft-button" type="button" onClick={() => patchChannelBalance({ leftDelayMs: 0, rightDelayMs: 0 })}>
                  {t('settings.eq.action.resetDelaysOnly')}
                </button>
              </div>
            </div>
            {calibrationMode ? (
              <div className="channel-calibration-readout">
                <span>
                  <em>{t('settings.eq.channel.effectiveLeft')}</em>
                  <strong>{Number.isFinite(leftTotalDb) ? formatDb(leftTotalDb) : '-inf dB'}</strong>
                </span>
                <span>
                  <em>{t('settings.eq.channel.effectiveRight')}</em>
                  <strong>{Number.isFinite(rightTotalDb) ? formatDb(rightTotalDb) : '-inf dB'}</strong>
                </span>
                <span>
                  <em>{t('settings.eq.level.headroom')}</em>
                  <strong>{formatLevelDb(audioLevels?.headroomDb)}</strong>
                </span>
                <span>
                  <em>{t('settings.eq.channel.group.timing')}</em>
                  <strong>{`L ${formatDelayMs(leftDelayMs)} / R ${formatDelayMs(rightDelayMs)}`}</strong>
                </span>
              </div>
            ) : null}
          </section>

          <section className="channel-tool-group channel-monitor-desk">
            <header>
              <span>{t('settings.eq.channel.group.monitorTools')}</span>
              <button className="eq-soft-button" type="button" onClick={resetMonitorTools}>
                {t('settings.eq.action.resetMonitorTools')}
              </button>
            </header>
            <div className="channel-balance-segmented" role="group" aria-label={t('settings.eq.channel.monoMode')}>
              {monoModeOptions.map((option) => (
                <button
                  className="eq-soft-button"
                  data-active={channelBalance.monoMode === option}
                  type="button"
                  key={option}
                  onClick={() => patchChannelBalance({ monoMode: option })}
                >
                  {t(monoModeLabelKeys[option])}
                </button>
              ))}
            </div>
            <div className="channel-tool-matrix" role="group" aria-label={t('settings.eq.channel.quickTools')}>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('mono')}>
                {t('settings.eq.channel.quick.monoCheck')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('left')}>
                {t('settings.eq.channel.quick.leftSolo')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('right')}>
                {t('settings.eq.channel.quick.rightSolo')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('swap')}>
                {t('settings.eq.channel.quick.swapCheck')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('phase')}>
                {t('settings.eq.channel.quick.phaseCheck')}
              </button>
              <button className="eq-soft-button" data-active={channelBalance.swapLeftRight} type="button" onClick={() => patchChannelBalance({ swapLeftRight: !channelBalance.swapLeftRight })}>
                <Shuffle size={14} />
                {t('settings.eq.channel.swap')}
              </button>
            </div>
          </section>

          <section className="channel-tool-group channel-phase-desk">
            <header>
              <span>{t('settings.eq.channel.group.phaseTools')}</span>
            </header>
            <div className="channel-tool-matrix">
              <button className="eq-soft-button" data-active={channelBalance.invertLeft} type="button" onClick={() => patchChannelBalance({ invertLeft: !channelBalance.invertLeft })}>
                {t('settings.eq.channel.invertLeft')}
              </button>
              <button className="eq-soft-button" data-active={channelBalance.invertRight} type="button" onClick={() => patchChannelBalance({ invertRight: !channelBalance.invertRight })}>
                {t('settings.eq.channel.invertRight')}
              </button>
              <button className="eq-soft-button" data-active={channelBalance.constantPower} type="button" onClick={() => patchChannelBalance({ constantPower: !channelBalance.constantPower })}>
                {t('settings.eq.channel.constantPower')}
              </button>
            </div>
          </section>

          <section className="channel-tool-group channel-calibration-wizard">
            <header>
              <span>{t('settings.eq.channel.wizard.title')}</span>
              <strong>{calibrationReady ? t('settings.eq.channel.wizard.ready') : t('settings.eq.channel.wizard.empty')}</strong>
            </header>
            <div className="channel-wizard-monitor" role="group" aria-label={t('settings.eq.channel.wizard.monitor')}>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('mono')}>
                {t('settings.eq.channel.wizard.previewCenter')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('left')}>
                {t('settings.eq.channel.wizard.previewLeft')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => applyMonitorTool('right')}>
                {t('settings.eq.channel.wizard.previewRight')}
              </button>
            </div>
            <div className="channel-wizard-nudges" role="group" aria-label={t('settings.eq.channel.wizard.nudge')}>
              <button className="eq-soft-button" type="button" onClick={() => nudgeSpatialDelay('left')}>
                {t('settings.eq.channel.wizard.imageLeft')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => nudgeSpatialDelay('right')}>
                {t('settings.eq.channel.wizard.imageRight')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => nudgeSpatialGain('left')}>
                {t('settings.eq.channel.wizard.leftLouder')}
              </button>
              <button className="eq-soft-button" type="button" onClick={() => nudgeSpatialGain('right')}>
                {t('settings.eq.channel.wizard.rightLouder')}
              </button>
            </div>
            <div className="channel-wizard-fields">
              <label>
                <span>{t('settings.eq.channel.wizard.leftDistance')}</span>
                <input
                  aria-label={t('settings.eq.channel.wizard.leftDistance')}
                  inputMode="decimal"
                  min="1"
                  type="number"
                  value={calibrationLeftDistanceCm}
                  onChange={(event) => setCalibrationLeftDistanceCm(event.currentTarget.value)}
                />
                <em>cm</em>
              </label>
              <label>
                <span>{t('settings.eq.channel.wizard.rightDistance')}</span>
                <input
                  aria-label={t('settings.eq.channel.wizard.rightDistance')}
                  inputMode="decimal"
                  min="1"
                  type="number"
                  value={calibrationRightDistanceCm}
                  onChange={(event) => setCalibrationRightDistanceCm(event.currentTarget.value)}
                />
                <em>cm</em>
              </label>
              <label>
                <span>{t('settings.eq.channel.wizard.leftSpl')}</span>
                <input
                  aria-label={t('settings.eq.channel.wizard.leftSpl')}
                  inputMode="decimal"
                  type="number"
                  value={calibrationLeftSplDb}
                  onChange={(event) => setCalibrationLeftSplDb(event.currentTarget.value)}
                />
                <em>dB</em>
              </label>
              <label>
                <span>{t('settings.eq.channel.wizard.rightSpl')}</span>
                <input
                  aria-label={t('settings.eq.channel.wizard.rightSpl')}
                  inputMode="decimal"
                  type="number"
                  value={calibrationRightSplDb}
                  onChange={(event) => setCalibrationRightSplDb(event.currentTarget.value)}
                />
                <em>dB</em>
              </label>
            </div>
            <div className="channel-calibration-readout channel-wizard-readout">
              <span>
                <em>{t('settings.eq.channel.leftDelay')}</em>
                <strong>{formatDelayMs(calculatedLeftDelayMs)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.channel.rightDelay')}</em>
                <strong>{formatDelayMs(calculatedRightDelayMs)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.channel.leftGain')}</em>
                <strong>{formatDb(calculatedLeftGainDb)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.channel.rightGain')}</em>
                <strong>{formatDb(calculatedRightGainDb)}</strong>
              </span>
            </div>
            <div className="channel-wizard-actions">
              <button className="eq-soft-button" type="button" disabled={!calibrationReady} onClick={applySpatialCalibrationMeasurements}>
                {t('settings.eq.channel.wizard.apply')}
              </button>
              <button className="eq-soft-button" type="button" disabled={!calibrationReady} onClick={resetSpatialCalibrationMeasurements}>
                {t('settings.eq.channel.wizard.clear')}
              </button>
            </div>
          </section>
        </div>

        <div className="channel-balance-readout" data-risk={channelBalanceRisk || clippingRisk}>
          <span>
            <em>{t('settings.eq.channel.leftTotal')}</em>
            <strong>{Number.isFinite(leftTotalDb) ? formatDb(leftTotalDb) : '-inf dB'}</strong>
          </span>
          <span>
            <em>{t('settings.eq.channel.rightTotal')}</em>
            <strong>{Number.isFinite(rightTotalDb) ? formatDb(rightTotalDb) : '-inf dB'}</strong>
          </span>
          <span>
            <em>{t('settings.eq.channel.dsp')}</em>
            <strong>{channelBalance.enabled ? t('settings.eq.channel.active') : t('settings.eq.channel.bypassed')}</strong>
          </span>
          <span>
            <em>{t('settings.eq.level.headroom')}</em>
            <strong>{formatLevelDb(audioLevels?.headroomDb)}</strong>
          </span>
          {channelBalanceRisk || clippingRisk ? <p>{t('settings.eq.warning.channelClipping')}</p> : null}
          {channelBalance.enabled ? <p>{t('settings.eq.bitPerfect.channelDisabled')}</p> : null}
        </div>
      </section>
      </details>
      ) : null}

      <footer className="eq-preset-tools eq-preset-console">
        <div className="eq-preset-console-main">
          <label className="eq-preset-save-field">
            <span>{t('settings.eq.preset.nameAria')}</span>
            <input aria-label={t('settings.eq.preset.nameAria')} value={saveName} onChange={(event) => setSaveName(event.currentTarget.value)} placeholder={t('settings.eq.preset.savePlaceholder')} />
          </label>
          <div className="eq-preset-actions">
            <button type="button" onClick={() => void exportPreset()}>
              <Save size={15} />
              {t('settings.eq.action.saveAs')}
            </button>
            <button type="button" onClick={() => void exportApoPreset()}>
              {t('settings.eq.action.exportApoPreset')}
            </button>
            <button type="button" onClick={() => void exportApoGraphicEqPreset()}>
              {t('settings.eq.action.exportApoGraphicEqPreset')}
            </button>
            <button type="button" onClick={() => void duplicateCurrentPreset()}>
              <Copy size={15} />
              {t('settings.eq.action.duplicatePreset')}
            </button>
            <button type="button" onClick={() => void previewImportPreset()}>
              {t('settings.eq.action.importPreset')}
            </button>
            <button type="button" aria-expanded={apoPasteOpen} onClick={() => setApoPasteOpen((current) => !current)}>
              <Copy size={15} />
              {t('settings.eq.action.pasteApoPreset')}
            </button>
            <button type="button" disabled={!canOverwritePreset} onClick={() => void overwritePreset()}>
              <Save size={15} />
              {t('settings.eq.action.overwrite')}
            </button>
            <button type="button" disabled={!canOverwritePreset} onClick={revertCurrentUserPreset}>
              <RotateCcw size={15} />
              {t('settings.eq.action.revertUserPreset')}
            </button>
            <button type="button" disabled={selectedPresetReadonly} onClick={() => void deletePreset()}>
              <Trash2 size={15} />
              {t('settings.eq.action.delete')}
            </button>
          </div>
        </div>
        <span className="eq-preset-state-badge" data-readonly={selectedPresetReadonly}>
          {selectedPresetReadonly ? t('settings.eq.preset.readonly') : state.presetName}
        </span>
      </footer>

      {error ? <p className="eq-panel-error">{error}</p> : null}
      {!error && exportNotice ? <p className="eq-panel-success" role="status">{exportNotice}</p> : null}
      {apoPasteOpen ? (
        <section className="eq-apo-paste">
          <label>
            <span>{t('settings.eq.import.pasteTitle')}</span>
            <textarea
              aria-label={t('settings.eq.import.pasteTitle')}
              value={apoPasteText}
              placeholder={'Preamp: -6 dB\nFilter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1'}
              onChange={(event) => setApoPasteText(event.currentTarget.value)}
            />
          </label>
          <div>
            <button className="eq-soft-button" type="button" onClick={previewPastedApoPreset}>
              {t('settings.eq.import.previewPaste')}
            </button>
            <button className="eq-soft-button" type="button" onClick={() => setApoPasteText('')}>
              {t('settings.eq.import.clearPaste')}
            </button>
          </div>
        </section>
      ) : null}
      {importPreview ? (
        <section className="eq-import-preview" data-warning={importPreview.metadata.warnings.length > 0 || importPreview.metadata.skippedFilterCount > 0}>
          <div>
            <span>{t('settings.eq.import.previewTitle')}</span>
            <strong>{importPreview.request.name}</strong>
            <small>{importPreview.fileName}</small>
          </div>
          <span>
            <em>{t('settings.eq.import.source')}</em>
            <strong>{importPreview.metadata.source === 'equalizer-apo' ? t('settings.eq.import.sourceApo') : t('settings.eq.import.sourceEcho')}</strong>
          </span>
          {importPreviewCompatibility ? (
            <span className="eq-import-compatibility" data-compatibility={importPreviewCompatibility}>
              <em>{t('settings.eq.import.compatibility')}</em>
              <strong>{t(eqImportCompatibilityLabelKeys[importPreviewCompatibility])}</strong>
            </span>
          ) : null}
          {importPreview.metadata.includedFileCount > 0 || importPreview.metadata.skippedIncludeCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.includes')}</em>
              <strong>{t('settings.eq.import.includesValue', {
                count: String(importPreview.metadata.includedFileCount),
                skipped: String(importPreview.metadata.skippedIncludeCount),
              })}</strong>
            </span>
          ) : null}
          {importPreview.metadata.unsupportedDirectiveCount > 0 || importPreview.metadata.channelScopedFilterCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.apoDirectives')}</em>
              <strong>{t('settings.eq.import.apoDirectivesValue', {
                count: String(importPreview.metadata.unsupportedDirectiveCount),
                skipped: String(importPreview.metadata.channelScopedFilterCount),
              })}</strong>
            </span>
          ) : null}
          {importPreviewDirectiveSummary ? (
            <span>
              <em>{t('settings.eq.import.apoDirectiveDetails')}</em>
              <strong>{importPreviewDirectiveSummary}</strong>
            </span>
          ) : null}
          {importPreview.metadata.bandwidthFilterCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.bandwidthFilters')}</em>
              <strong>{t('settings.eq.import.bandwidthFiltersValue', { count: String(importPreview.metadata.bandwidthFilterCount) })}</strong>
            </span>
          ) : null}
          <span>
            <em>{t('settings.eq.import.preamp')}</em>
            <input
              className="eq-import-preview-number"
              aria-label={t('settings.eq.import.preampAria')}
              type="number"
              min={eqMinPreampDb}
              max={eqMaxPreampDb}
              step="0.1"
              value={importPreview.request.preampDb}
              onChange={(event) => updateImportPreviewPreamp(Number(event.currentTarget.value))}
            />
          </span>
          <span>
            <em>{t('settings.eq.import.filters')}</em>
            <strong>{importPreview.metadata.source === 'equalizer-apo'
              ? t('settings.eq.import.filtersValue', {
                count: String(importPreview.metadata.importedFilterCount),
                skipped: String(importPreview.metadata.skippedFilterCount),
              })
              : String(importPreview.metadata.importedFilterCount)}</strong>
          </span>
          <span>
            <em>{t('settings.eq.band.enabledShort')}</em>
            <strong>{`${importPreview.request.bands.filter((band) => band.enabled !== false).length}/${importPreview.request.bands.length}`}</strong>
          </span>
          {importPreview.metadata.graphicEqPointCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.graphicEq')}</em>
              <strong>{String(importPreview.metadata.graphicEqPointCount)}</strong>
            </span>
          ) : null}
          {importPreviewSummary ? (
            <section className="eq-import-safety" data-risk={importPreviewSummary.safePreampNeeded || importPreviewSummary.estimatedPeakGainDb > 0.05}>
              <div>
                <span>{t('settings.eq.import.safetyTitle')}</span>
                <strong>{importPreviewSummary.safePreampNeeded ? t('settings.eq.import.safetyNeedsHeadroom') : t('settings.eq.import.safetyOk')}</strong>
                <small>{t('settings.eq.import.safetyDetail')}</small>
              </div>
              <span>
                <em>{t('settings.eq.import.estimatedPeak')}</em>
                <strong>{formatDb(importPreviewSummary.estimatedPeakGainDb)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.import.maxBoost')}</em>
                <strong>{importPreviewSummary.maxBoostFrequencyHz
                  ? `${formatDb(importPreviewSummary.maxBoostDb)} @ ${formatFrequencyLabel(importPreviewSummary.maxBoostFrequencyHz)}`
                  : formatDb(0)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.import.maxCut')}</em>
                <strong>{importPreviewSummary.maxCutFrequencyHz
                  ? `${formatDb(importPreviewSummary.maxCutDb)} @ ${formatFrequencyLabel(importPreviewSummary.maxCutFrequencyHz)}`
                  : formatDb(0)}</strong>
              </span>
              <span>
                <em>{t('settings.eq.import.safePreamp')}</em>
                <strong>{formatDb(importPreviewSummary.recommendedPreampDb)}</strong>
              </span>
              <button
                className="eq-soft-button"
                type="button"
                disabled={!importPreviewSummary.safePreampNeeded}
                onClick={() => updateImportPreviewPreamp(importPreviewSummary.recommendedPreampDb)}
              >
                {t('settings.eq.import.useSafePreamp')}
              </button>
            </section>
          ) : null}
          <div className="eq-import-preview-bands">
            <span>{t('settings.eq.import.filterPreview')}</span>
            {importPreviewDisplayBands.length > 0 ? (
              <div className="eq-import-preview-band-list">
                {importPreviewDisplayBands.map(({ band, index }) => {
                  const filterType = band.filterType ?? 'peaking';
                  const gainEditable = isEqFilterGainEditable(filterType);
                  return (
                    <div className="eq-import-preview-band" data-bypassed={band.enabled === false} key={`${index}-${band.frequencyHz}-${filterType}`}>
                      <em>{String(index + 1).padStart(2, '0')}</em>
                      <label className="eq-import-preview-toggle">
                        <input
                          aria-label={t('settings.eq.import.filterEnabledAria', { index: String(index + 1) })}
                          type="checkbox"
                          checked={band.enabled !== false}
                          onChange={(event) => updateImportPreviewBand(index, { enabled: event.currentTarget.checked })}
                        />
                        <small data-state={band.enabled === false ? 'off' : 'on'}>{band.enabled === false ? t('settings.eq.band.bypassed') : t('settings.eq.band.enabledShort')}</small>
                      </label>
                      <input
                        aria-label={t('settings.eq.import.filterFrequencyAria', { index: String(index + 1) })}
                        type="number"
                        min={eqMinFrequencyHz}
                        max={eqMaxFrequencyHz}
                        step="0.1"
                        value={band.frequencyHz}
                        onChange={(event) => updateImportPreviewBand(index, { frequencyHz: Number(event.currentTarget.value) })}
                      />
                      <select
                        aria-label={t('settings.eq.import.filterTypeAria', { index: String(index + 1) })}
                        value={filterType}
                        onChange={(event) => updateImportPreviewBand(index, { filterType: event.currentTarget.value as EqFilterType })}
                      >
                        {eqFilterTypes.map((type) => (
                          <option value={type} key={type}>
                            {t(eqFilterLabelKeys[type])}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={t('settings.eq.import.filterGainAria', { index: String(index + 1) })}
                        type="number"
                        min="-12"
                        max="12"
                        step="0.1"
                        value={gainEditable ? band.gainDb : 0}
                        disabled={!gainEditable}
                        onChange={(event) => updateImportPreviewBand(index, { gainDb: Number(event.currentTarget.value) })}
                      />
                      <input
                        aria-label={t('settings.eq.import.filterQAria', { index: String(index + 1) })}
                        type="number"
                        min={eqMinQ}
                        max={eqMaxQ}
                        step="0.1"
                        value={band.q ?? 1}
                        onChange={(event) => updateImportPreviewBand(index, { q: Number(event.currentTarget.value) })}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>{t('settings.eq.import.noFilters')}</p>
            )}
            {importPreviewHiddenBandCount > 0 ? <p>{t('settings.eq.import.moreFilters', { count: String(importPreviewHiddenBandCount) })}</p> : null}
          </div>
          {importPreview.metadata.warnings.length > 0 ? <p>{importPreview.metadata.warnings.join(' ')}</p> : null}
          <div className="eq-import-preview-actions">
            <button className="eq-soft-button" type="button" onClick={() => void auditionImportPreview()}>
              {importAuditionSnapshot ? t('settings.eq.import.updateAudition') : t('settings.eq.import.audition')}
            </button>
            <button className="eq-soft-button" type="button" disabled={!importAuditionSnapshot} onClick={() => void restoreImportAudition()}>
              {t('settings.eq.import.restoreAudition')}
            </button>
            <button className="eq-soft-button eq-import-apply" type="button" onClick={() => void applyImportPreview()}>
              {t('settings.eq.import.applyPreview')}
            </button>
            <button className="eq-soft-button" type="button" onClick={() => void cancelImportPreview()}>
              {t('settings.eq.import.cancelPreview')}
            </button>
          </div>
        </section>
      ) : null}
      {importReport ? (
        <section className="eq-import-report" data-warning={importReport.metadata.warnings.length > 0 || importReport.metadata.skippedFilterCount > 0}>
          <div>
            <span>{t('settings.eq.import.reportTitle')}</span>
            <strong>{importReport.presetName}</strong>
          </div>
          <span>
            <em>{t('settings.eq.import.source')}</em>
            <strong>{importReport.metadata.source === 'equalizer-apo' ? t('settings.eq.import.sourceApo') : t('settings.eq.import.sourceEcho')}</strong>
          </span>
          {importReportCompatibility ? (
            <span className="eq-import-compatibility" data-compatibility={importReportCompatibility}>
              <em>{t('settings.eq.import.compatibility')}</em>
              <strong>{t(eqImportCompatibilityLabelKeys[importReportCompatibility])}</strong>
            </span>
          ) : null}
          {importReport.metadata.includedFileCount > 0 || importReport.metadata.skippedIncludeCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.includes')}</em>
              <strong>{t('settings.eq.import.includesValue', {
                count: String(importReport.metadata.includedFileCount),
                skipped: String(importReport.metadata.skippedIncludeCount),
              })}</strong>
            </span>
          ) : null}
          {importReport.metadata.unsupportedDirectiveCount > 0 || importReport.metadata.channelScopedFilterCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.apoDirectives')}</em>
              <strong>{t('settings.eq.import.apoDirectivesValue', {
                count: String(importReport.metadata.unsupportedDirectiveCount),
                skipped: String(importReport.metadata.channelScopedFilterCount),
              })}</strong>
            </span>
          ) : null}
          {importReportDirectiveSummary ? (
            <span>
              <em>{t('settings.eq.import.apoDirectiveDetails')}</em>
              <strong>{importReportDirectiveSummary}</strong>
            </span>
          ) : null}
          {importReport.metadata.bandwidthFilterCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.bandwidthFilters')}</em>
              <strong>{t('settings.eq.import.bandwidthFiltersValue', { count: String(importReport.metadata.bandwidthFilterCount) })}</strong>
            </span>
          ) : null}
          <span>
            <em>{t('settings.eq.import.preamp')}</em>
            <strong>{formatDb(importReport.preampDb)}</strong>
          </span>
          <span>
            <em>{t('settings.eq.import.filters')}</em>
            <strong>{importReport.metadata.source === 'equalizer-apo'
              ? t('settings.eq.import.filtersValue', {
                count: String(importReport.metadata.importedFilterCount),
                skipped: String(importReport.metadata.skippedFilterCount),
              })
              : String(importReport.metadata.importedFilterCount)}</strong>
          </span>
          {importReport.metadata.graphicEqPointCount > 0 ? (
            <span>
              <em>{t('settings.eq.import.graphicEq')}</em>
              <strong>{String(importReport.metadata.graphicEqPointCount)}</strong>
            </span>
          ) : null}
          {importReport.metadata.warnings.length > 0 ? <p>{importReport.metadata.warnings.join(' ')}</p> : null}
        </section>
      ) : null}
    </section>
  );
};
