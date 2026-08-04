import type { AudioOutputMode, AudioStatus } from '../../shared/types/audio';
import type { LibraryTrack } from '../../shared/types/library';

export const audioRouteFlightRecorderStorageKey = 'echo-next.audio-route-flight-recorder.v1';

const maxFlightEntries = 20;
const duplicateEventWindowMs = 12_000;

export type AudioRouteFlightEventKind =
  | 'route-change'
  | 'takeover'
  | 'rate-conversion'
  | 'failure'
  | 'fallback';

export type AudioRouteFlightEventTone = 'good' | 'process' | 'warning' | 'danger' | 'muted';

export type AudioRouteFlightEntry = {
  id: string;
  at: string;
  kind: AudioRouteFlightEventKind;
  tone: AudioRouteFlightEventTone;
  deviceName: string;
  routeLabel: string;
  outputMode: AudioOutputMode;
  previousRouteLabel: string | null;
  sourceRate: number | null;
  outputRate: number | null;
  trackId: string | null;
  trackKey: string | null;
  trackTitle: string | null;
  reason: string | null;
  summaryKey: string;
};

type AudioRouteSnapshot = {
  routeKey: string;
  routeLabel: string;
  outputMode: AudioOutputMode;
  deviceName: string;
  sourceRate: number | null;
  outputRate: number | null;
  trackKey: string | null;
  trackId: string | null;
  trackTitle: string | null;
  rateConversion: boolean;
  failureReason: string | null;
};

type AudioRouteFlightStore = {
  version: 1;
  entries: AudioRouteFlightEntry[];
  lastSnapshot: AudioRouteSnapshot | null;
};

const createEmptyStore = (): AudioRouteFlightStore => ({
  version: 1,
  entries: [],
  lastSnapshot: null,
});

const normalizedText = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const normalizedNumber = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

const sanitizeKeyPart = (value: string): string => value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

const outputModeText = (mode: AudioOutputMode): string => {
  if (mode === 'exclusive') {
    return 'Exclusive';
  }
  if (mode === 'system') {
    return 'System';
  }
  return 'Shared';
};

const deviceNameForStatus = (status: AudioStatus): string =>
  normalizedText(status.outputDeviceName)
    ?? normalizedText(status.outputDeviceId)
    ?? (status.outputMode === 'system' ? 'System output' : 'System default device');

const backendNameForStatus = (status: AudioStatus): string | null =>
  normalizedText(status.activeOutputBackendImpl)
    ?? normalizedText(status.outputBackend)
    ?? normalizedText(status.outputDeviceType);

const routeLabelForStatus = (status: AudioStatus): string =>
  [outputModeText(status.outputMode), backendNameForStatus(status)]
    .filter((part): part is string => Boolean(part))
    .join(' / ');

const routeKeyForStatus = (status: AudioStatus): string =>
  [
    status.outputMode,
    sanitizeKeyPart(deviceNameForStatus(status)),
    sanitizeKeyPart(backendNameForStatus(status) ?? ''),
  ].join('|');

const sourceRateForStatus = (status: AudioStatus, track?: LibraryTrack | null): number | null =>
  normalizedNumber(status.fileSampleRate ?? track?.sampleRate);

const outputRateForStatus = (status: AudioStatus): number | null =>
  normalizedNumber(
    status.actualDeviceSampleRate
      ?? status.sharedDeviceSampleRate
      ?? status.requestedOutputSampleRate
      ?? status.decoderOutputSampleRate,
  );

const trackKeyForStatus = (status: AudioStatus, track?: LibraryTrack | null): string | null =>
  normalizedText(status.currentTrackId)
    ?? normalizedText(track?.id)
    ?? normalizedText(status.currentFilePath)
    ?? normalizedText(track?.path);

export const audioRouteFlightTrackKey = (
  status: AudioStatus | null | undefined,
  track?: LibraryTrack | null,
): string | null => {
  if (status) {
    return trackKeyForStatus(status, track);
  }

  return normalizedText(track?.id) ?? normalizedText(track?.path);
};

const trackTitleForStatus = (status: AudioStatus, track?: LibraryTrack | null): string | null =>
  normalizedText(status.currentTrackTitle)
    ?? normalizedText(track?.title)
    ?? normalizedText(status.currentFilePath)
    ?? normalizedText(track?.path);

const failureReasonForStatus = (status: AudioStatus): string | null =>
  normalizedText(status.error)
    ?? (status.host === 'error' ? 'audio_host_error' : null);

const isSuccessfulStatus = (status: AudioStatus): boolean =>
  status.host === 'ready' && status.state !== 'error' && !status.error;

const isRateConversion = (status: AudioStatus, sourceRate: number | null, outputRate: number | null): boolean =>
  Boolean(status.resampling || status.echoSrcActive || status.sampleRateMismatch || (sourceRate && outputRate && sourceRate !== outputRate));

const snapshotFromStatus = (status: AudioStatus, track?: LibraryTrack | null): AudioRouteSnapshot => {
  const sourceRate = sourceRateForStatus(status, track);
  const outputRate = outputRateForStatus(status);

  return {
    routeKey: routeKeyForStatus(status),
    routeLabel: routeLabelForStatus(status),
    outputMode: status.outputMode,
    deviceName: deviceNameForStatus(status),
    sourceRate,
    outputRate,
    trackKey: trackKeyForStatus(status, track),
    trackId: normalizedText(status.currentTrackId) ?? normalizedText(track?.id),
    trackTitle: trackTitleForStatus(status, track),
    rateConversion: isRateConversion(status, sourceRate, outputRate),
    failureReason: failureReasonForStatus(status),
  };
};

const readStore = (): AudioRouteFlightStore => {
  if (typeof window === 'undefined') {
    return createEmptyStore();
  }

  try {
    const raw = window.localStorage.getItem(audioRouteFlightRecorderStorageKey);
    if (!raw) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as Partial<AudioRouteFlightStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return createEmptyStore();
    }

    return {
      version: 1,
      entries: parsed.entries as AudioRouteFlightEntry[],
      lastSnapshot: parsed.lastSnapshot ?? null,
    };
  } catch {
    return createEmptyStore();
  }
};

const writeStore = (store: AudioRouteFlightStore): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(audioRouteFlightRecorderStorageKey, JSON.stringify({
      version: 1,
      entries: store.entries.slice(0, maxFlightEntries),
      lastSnapshot: store.lastSnapshot,
    } satisfies AudioRouteFlightStore));
  } catch {
    // Flight Recorder is diagnostic UI memory; storage failures must never affect playback.
  }
};

const eventId = (nowMs: number, kind: AudioRouteFlightEventKind, summaryKey: string): string =>
  `${nowMs}:${kind}:${summaryKey}`;

const makeEntry = (
  kind: AudioRouteFlightEventKind,
  snapshot: AudioRouteSnapshot,
  previousSnapshot: AudioRouteSnapshot | null,
  nowIso: string,
  nowMs: number,
  summaryKey: string,
  tone: AudioRouteFlightEventTone,
  reason: string | null = null,
): AudioRouteFlightEntry => ({
  id: eventId(nowMs, kind, summaryKey),
  at: nowIso,
  kind,
  tone,
  deviceName: snapshot.deviceName,
  routeLabel: snapshot.routeLabel,
  outputMode: snapshot.outputMode,
  previousRouteLabel: previousSnapshot?.routeLabel ?? null,
  sourceRate: snapshot.sourceRate,
  outputRate: snapshot.outputRate,
  trackId: snapshot.trackId,
  trackKey: snapshot.trackKey,
  trackTitle: snapshot.trackTitle,
  reason,
  summaryKey,
});

const buildEntries = (
  status: AudioStatus,
  snapshot: AudioRouteSnapshot,
  previousSnapshot: AudioRouteSnapshot | null,
  nowIso: string,
  nowMs: number,
): AudioRouteFlightEntry[] => {
  const entries: AudioRouteFlightEntry[] = [];
  const routeChanged = Boolean(previousSnapshot && previousSnapshot.routeKey !== snapshot.routeKey);
  const movedToShared =
    previousSnapshot
    && ['exclusive'].includes(previousSnapshot.outputMode)
    && ['shared', 'system'].includes(snapshot.outputMode);
  const movedToNativeOutput =
    isSuccessfulStatus(status)
    && ['exclusive'].includes(snapshot.outputMode)
    && (!previousSnapshot || previousSnapshot.routeKey !== snapshot.routeKey);

  if (snapshot.failureReason && (!previousSnapshot || previousSnapshot.failureReason !== snapshot.failureReason || routeChanged)) {
    entries.push(makeEntry(
      'failure',
      snapshot,
      previousSnapshot,
      nowIso,
      nowMs,
      `failure:${snapshot.routeKey}:${snapshot.failureReason}`,
      'danger',
      snapshot.failureReason,
    ));
  }

  if (movedToShared) {
    const fallbackReason = status.warnings?.find((warning) => /fallback|回退|降级|退回|切共享/iu.test(warning)) ?? null;
    entries.push(makeEntry(
      'fallback',
      snapshot,
      previousSnapshot,
      nowIso,
      nowMs,
      `fallback:${previousSnapshot.routeKey}->${snapshot.routeKey}`,
      'warning',
      fallbackReason,
    ));
  } else if (movedToNativeOutput) {
    entries.push(makeEntry(
      'takeover',
      snapshot,
      previousSnapshot,
      nowIso,
      nowMs,
      `takeover:${snapshot.routeKey}:${snapshot.outputRate ?? ''}`,
      'good',
    ));
  } else if (routeChanged) {
    entries.push(makeEntry(
      'route-change',
      snapshot,
      previousSnapshot,
      nowIso,
      nowMs,
      `route:${previousSnapshot?.routeKey ?? 'none'}->${snapshot.routeKey}`,
      'process',
    ));
  }

  if (
    snapshot.rateConversion
    && snapshot.sourceRate
    && snapshot.outputRate
    && (!previousSnapshot
      || !previousSnapshot.rateConversion
      || previousSnapshot.sourceRate !== snapshot.sourceRate
      || previousSnapshot.outputRate !== snapshot.outputRate
      || previousSnapshot.trackKey !== snapshot.trackKey)
  ) {
    entries.push(makeEntry(
      'rate-conversion',
      snapshot,
      previousSnapshot,
      nowIso,
      nowMs,
      `rate:${snapshot.trackKey ?? 'no-track'}:${snapshot.sourceRate}->${snapshot.outputRate}`,
      'warning',
    ));
  }

  return entries;
};

const mergeEntries = (
  currentEntries: AudioRouteFlightEntry[],
  nextEntries: AudioRouteFlightEntry[],
  nowMs: number,
): AudioRouteFlightEntry[] => {
  const accepted = nextEntries.filter((entry) => {
    const previous = currentEntries.find((candidate) => candidate.summaryKey === entry.summaryKey);
    return !previous || nowMs - Date.parse(previous.at) > duplicateEventWindowMs;
  });

  return [...accepted, ...currentEntries]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, maxFlightEntries);
};

export const recordAudioRouteFlightObservation = (
  status: AudioStatus | null | undefined,
  track?: LibraryTrack | null,
): AudioRouteFlightEntry[] => {
  if (!status) {
    return getAudioRouteFlightEntries();
  }

  const snapshot = snapshotFromStatus(status, track);
  const hasUsefulSignal =
    Boolean(snapshot.failureReason)
    || Boolean(snapshot.sourceRate)
    || Boolean(snapshot.outputRate)
    || Boolean(snapshot.trackKey)
    || status.state !== 'idle';
  if (!hasUsefulSignal) {
    return getAudioRouteFlightEntries();
  }

  const store = readStore();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const nextEntries = buildEntries(status, snapshot, store.lastSnapshot, nowIso, nowMs);

  store.entries = mergeEntries(store.entries, nextEntries, nowMs);
  store.lastSnapshot = snapshot;
  writeStore(store);

  return store.entries;
};

export const getAudioRouteFlightEntries = (): AudioRouteFlightEntry[] => readStore().entries;

export const clearAudioRouteFlightRecorder = (): void => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(audioRouteFlightRecorderStorageKey);
  }
};
