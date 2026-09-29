import type { AudioOutputMode, AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';

export const dacCapabilityAtlasStorageKey = 'echo-next.dac-capability-atlas.v1';

const maxAtlasProfiles = 16;
const maxRateEntries = 10;
const duplicateObservationWindowMs = 30_000;

export type DacCapabilityModeStats = {
  mode: AudioOutputMode;
  observations: number;
  successCount: number;
  failureCount: number;
  nativeSuccessCount: number;
  observedOutputRates: number[];
  lastSuccessAt: string | null;
  lastNativeAt: string | null;
  lastNativeRate: number | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
};

export type DacCapabilityAtlasProfile = {
  version: 1;
  deviceKey: string;
  deviceName: string;
  firstSeenAt: string;
  updatedAt: string;
  observations: number;
  successCount: number;
  failureCount: number;
  observedOutputRates: number[];
  nativeOutputRates: number[];
  lastNativeAt: string | null;
  lastNativeMode: AudioOutputMode | null;
  lastNativeRate: number | null;
  lastFailureAt: string | null;
  lastFailureMode: AudioOutputMode | null;
  lastFailureReason: string | null;
  sampleRateConversionCount: number;
  fortyFourToFortyEightCount: number;
  lastFortyFourToFortyEightAt: string | null;
  lastObservationKey: string | null;
  lastObservationAtMs: number;
  modes: Partial<Record<AudioOutputMode, DacCapabilityModeStats>>;
};

type DacCapabilityAtlasStore = {
  version: 1;
  profiles: Record<string, DacCapabilityAtlasProfile>;
};

const createEmptyStore = (): DacCapabilityAtlasStore => ({
  version: 1,
  profiles: {},
});

const normalizedNumber = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

const normalizedText = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const sanitizeKeyPart = (value: string): string => value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

const deviceNameForStatus = (status: AudioStatus): string =>
  normalizedText(status.outputDeviceName)
    ?? normalizedText(status.outputDeviceId)
    ?? (status.outputMode === 'system' ? 'System output' : 'System default device');

export const dacCapabilityDeviceKey = (status: AudioStatus | null | undefined): string | null => {
  if (!status) {
    return null;
  }

  const deviceId = normalizedText(status.outputDeviceId);
  if (deviceId) {
    return `id:${sanitizeKeyPart(deviceId)}`;
  }

  return `name:${sanitizeKeyPart(deviceNameForStatus(status))}`;
};

const outputRateForStatus = (status: AudioStatus): number | null =>
  normalizedNumber(
    status.actualDeviceSampleRate
    ?? status.sharedDeviceSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.decoderOutputSampleRate,
  );

const sourceRateForStatus = (status: AudioStatus, track?: LibraryTrack | null): number | null =>
  normalizedNumber(status.fileSampleRate ?? track?.sampleRate);

const rateListWith = (rates: number[], value: number | null): number[] => {
  if (!value) {
    return rates;
  }

  return [...new Set([...rates, value])]
    .sort((left, right) => left - right)
    .slice(-maxRateEntries);
};

const readAtlasStore = (): DacCapabilityAtlasStore => {
  if (typeof window === 'undefined') {
    return createEmptyStore();
  }

  try {
    const raw = window.localStorage.getItem(dacCapabilityAtlasStorageKey);
    if (!raw) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as Partial<DacCapabilityAtlasStore>;
    if (parsed.version !== 1 || !parsed.profiles || typeof parsed.profiles !== 'object') {
      return createEmptyStore();
    }

    return {
      version: 1,
      profiles: parsed.profiles as Record<string, DacCapabilityAtlasProfile>,
    };
  } catch {
    return createEmptyStore();
  }
};

const writeAtlasStore = (store: DacCapabilityAtlasStore): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const entries = Object.values(store.profiles)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, maxAtlasProfiles);
  const boundedStore: DacCapabilityAtlasStore = {
    version: 1,
    profiles: Object.fromEntries(entries.map((profile) => [profile.deviceKey, profile])),
  };

  try {
    window.localStorage.setItem(dacCapabilityAtlasStorageKey, JSON.stringify(boundedStore));
  } catch {
    // Atlas is advisory UI memory; storage failures should never affect playback.
  }
};

const createModeStats = (mode: AudioOutputMode): DacCapabilityModeStats => ({
  mode,
  observations: 0,
  successCount: 0,
  failureCount: 0,
  nativeSuccessCount: 0,
  observedOutputRates: [],
  lastSuccessAt: null,
  lastNativeAt: null,
  lastNativeRate: null,
  lastFailureAt: null,
  lastFailureReason: null,
});

const createProfile = (status: AudioStatus, nowIso: string, nowMs: number): DacCapabilityAtlasProfile => {
  const deviceKey = dacCapabilityDeviceKey(status) ?? `unknown:${status.outputMode}`;

  return {
    version: 1,
    deviceKey,
    deviceName: deviceNameForStatus(status),
    firstSeenAt: nowIso,
    updatedAt: nowIso,
    observations: 0,
    successCount: 0,
    failureCount: 0,
    observedOutputRates: [],
    nativeOutputRates: [],
    lastNativeAt: null,
    lastNativeMode: null,
    lastNativeRate: null,
    lastFailureAt: null,
    lastFailureMode: null,
    lastFailureReason: null,
    sampleRateConversionCount: 0,
    fortyFourToFortyEightCount: 0,
    lastFortyFourToFortyEightAt: null,
    lastObservationKey: null,
    lastObservationAtMs: nowMs,
    modes: {},
  };
};

const statusFailureReason = (status: AudioStatus): string | null =>
  normalizedText(status.error)
    ?? (status.host === 'error' ? 'audio_host_error' : null);

const isSuccessfulStatus = (status: AudioStatus): boolean =>
  status.host === 'ready' && status.state !== 'error' && !status.error;

const isNativeRateSuccess = (
  status: AudioStatus,
  sourceRate: number | null,
  outputRate: number | null,
): boolean =>
  isSuccessfulStatus(status)
  && Boolean(sourceRate && outputRate)
  && !status.resampling
  && !status.echoSrcActive
  && !status.sampleRateMismatch
  && Math.round(sourceRate ?? 0) === Math.round(outputRate ?? 0);

const isFortyFourToFortyEight = (sourceRate: number | null, outputRate: number | null): boolean =>
  Math.round(sourceRate ?? 0) === 44100 && Math.round(outputRate ?? 0) === 48000;

const isRateConverted = (status: AudioStatus, sourceRate: number | null, outputRate: number | null): boolean =>
  Boolean(status.resampling || status.echoSrcActive || (sourceRate && outputRate && Math.round(sourceRate) !== Math.round(outputRate)));

export const recordDacCapabilityObservation = (
  status: AudioStatus | null | undefined,
  track?: LibraryTrack | null,
): DacCapabilityAtlasProfile | null => {
  const deviceKey = dacCapabilityDeviceKey(status);
  if (!status || !deviceKey) {
    return null;
  }

  const sourceRate = sourceRateForStatus(status, track);
  const outputRate = outputRateForStatus(status);
  const failureReason = statusFailureReason(status);
  const hasPlaybackIdentity = Boolean(status.currentTrackId || status.currentFilePath || status.state !== 'idle');
  if (!hasPlaybackIdentity && !failureReason) {
    return getDacCapabilityAtlasProfile(status);
  }

  if (!sourceRate && !outputRate && !failureReason) {
    return getDacCapabilityAtlasProfile(status);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const observationKey = [
    status.outputMode,
    status.outputBackend ?? '',
    status.activeOutputBackendImpl ?? '',
    sourceRate ?? '',
    outputRate ?? '',
    status.resampling ? 'src' : 'native',
    status.echoSrcActive ? 'echo-src' : '',
    status.bitPerfectCandidate ? 'bp' : '',
    failureReason ?? '',
    status.currentTrackId ?? status.currentFilePath ?? '',
  ].join('|');

  const store = readAtlasStore();
  const profile = store.profiles[deviceKey] ?? createProfile(status, nowIso, nowMs);
  const isDuplicate =
    profile.lastObservationKey === observationKey
    && nowMs - profile.lastObservationAtMs < duplicateObservationWindowMs;

  profile.deviceName = deviceNameForStatus(status);
  profile.updatedAt = nowIso;
  profile.lastObservationAtMs = nowMs;

  if (isDuplicate) {
    store.profiles[deviceKey] = profile;
    writeAtlasStore(store);
    return profile;
  }

  const modeStats = profile.modes[status.outputMode] ?? createModeStats(status.outputMode);
  const success = isSuccessfulStatus(status);
  const nativeSuccess = isNativeRateSuccess(status, sourceRate, outputRate);
  const rateConverted = isRateConverted(status, sourceRate, outputRate);

  profile.observations += 1;
  modeStats.observations += 1;
  profile.lastObservationKey = observationKey;

  if (success) {
    profile.successCount += 1;
    modeStats.successCount += 1;
    modeStats.lastSuccessAt = nowIso;
    profile.observedOutputRates = rateListWith(profile.observedOutputRates, outputRate);
    modeStats.observedOutputRates = rateListWith(modeStats.observedOutputRates, outputRate);
  }

  if (failureReason) {
    profile.failureCount += 1;
    profile.lastFailureAt = nowIso;
    profile.lastFailureMode = status.outputMode;
    profile.lastFailureReason = failureReason;
    modeStats.failureCount += 1;
    modeStats.lastFailureAt = nowIso;
    modeStats.lastFailureReason = failureReason;
  }

  if (nativeSuccess) {
    profile.nativeOutputRates = rateListWith(profile.nativeOutputRates, outputRate);
    profile.lastNativeAt = nowIso;
    profile.lastNativeMode = status.outputMode;
    profile.lastNativeRate = outputRate;
    modeStats.nativeSuccessCount += 1;
    modeStats.lastNativeAt = nowIso;
    modeStats.lastNativeRate = outputRate;
  }

  if (rateConverted) {
    profile.sampleRateConversionCount += 1;
  }

  if (isFortyFourToFortyEight(sourceRate, outputRate) && rateConverted) {
    profile.fortyFourToFortyEightCount += 1;
    profile.lastFortyFourToFortyEightAt = nowIso;
  }

  profile.modes[status.outputMode] = modeStats;
  store.profiles[deviceKey] = profile;
  writeAtlasStore(store);

  return profile;
};

export const getDacCapabilityAtlasProfile = (
  status: AudioStatus | null | undefined,
): DacCapabilityAtlasProfile | null => {
  const deviceKey = dacCapabilityDeviceKey(status);
  if (!deviceKey) {
    return null;
  }

  return readAtlasStore().profiles[deviceKey] ?? null;
};

export const clearDacCapabilityAtlas = (): void => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(dacCapabilityAtlasStorageKey);
  }
};
