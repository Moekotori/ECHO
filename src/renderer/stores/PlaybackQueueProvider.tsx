import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Context, PropsWithChildren } from 'react';
import type { AudioOutputSettings, AudioPlaybackState, AudioStatus, PlaybackSpeedMode } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { AirPlayReceiverStatus, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
import { hqPlayerConnectDeviceId } from '../../shared/types/connect';
import type {
  ContinuousPlayMode,
  ContinuousPlayPreference,
  ContinuousPlayPreferenceKind,
  LibraryPlaylistItem,
  LibraryTrack,
  PlaylistSourceProvider,
} from '../../shared/types/library';
import type {
  LocalFileResolveResult,
  PlaybackOrderMode,
  PlaybackStatus,
  PersistedPlaybackRepeatMode,
  PersistedPlaybackSessionResume,
  PersistedPlaybackSessionV1,
  PersistedPlaylistPlaybackSnapshot,
  PersistedPlaylistPlaybackState,
  PersistedQueueItem,
  PersistedQueueSource,
} from '../../shared/types/playback';
import type { PlayableTrack } from '../../shared/types/remoteSources';
import type { ReplayGainTrackData } from '../../shared/utils/replayGain';
import { streamingProviderNames, streamingStableKey } from '../../shared/types/streaming';
import type { StreamingProviderName } from '../../shared/types/streaming';
import { shouldAnalyzeBpm } from '../../shared/constants/audioAnalysis';
import { isSpotifyTrack, pauseSpotifyPlayback, playSpotifyTrack } from '../integrations/spotify/spotifyPlayback';
import { translateCurrentLocale } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { isActiveConnectPlaybackStatus } from '../utils/connectPlayback';
import { beginPlaybackSwitchSnapshot, setPlaybackStatusSnapshot, useSharedPlaybackStatusOnly } from './playbackStatusStore';

const tq = (key: TranslationKey, options?: Record<string, string | number>): string =>
  translateCurrentLocale(key, options);

const playbackCancellationErrorMessage = 'audio_session_run_cancelled';
const playbackHistoryChangedEvent = 'playback-history:changed';
const libraryShuffleCandidatePageSize = 128;
const libraryRandomQueueRefreshPageSize = 96;
const manualQueueFillTargetSize = 36;
const defaultShuffleAvoidRecentCount = 25;
const maxShuffleAvoidRecentCount = 200;
const activePlaybackStates = new Set<AudioStatus['state']>(['loading', 'playing', 'paused']);
const playbackPressureStates = new Set<AudioStatus['state']>(['loading', 'playing']);
const playbackPressureOutputModes = new Set<AudioStatus['outputMode']>(['exclusive']);
const automixBpmAnalysisStatusPollMs = 1500;
const enhancedLowLoadMvSearchDelayMs = 8_000;
const playbackPressureBufferedThresholdMs = 40;
const gaplessLosslessCodecs = new Set(['flac', 'wav', 'wave', 'alac', 'aiff', 'aif', 'pcm']);
const gaplessLosslessExtensions = new Set(['flac', 'wav', 'wave', 'aiff', 'aif']);
const dsdCodecs = new Set(['dsd', 'dsf', 'dff', 'sacd']);
const clampPlaybackRate = (value: number): number => Math.max(0.5, Math.min(2, value));
const normalizePlaybackSpeedMode = (value: unknown): PlaybackSpeedMode | null =>
  value === 'daycore' || value === 'speed' || value === 'nightcore' ? value : null;

const createPlaybackSpeedOutput = (
  playbackRate: unknown,
  playbackSpeedMode: unknown,
  fallbackMode: PlaybackSpeedMode | null = null,
): Pick<AudioOutputSettings, 'playbackRate' | 'playbackSpeedMode'> | null => {
  const rate = Number(playbackRate);
  if (!Number.isFinite(rate)) {
    return null;
  }

  return {
    playbackRate: clampPlaybackRate(rate),
    playbackSpeedMode: normalizePlaybackSpeedMode(playbackSpeedMode) ?? fallbackMode ?? 'nightcore',
  };
};

const resolvePlaybackSpeedOutput = async (): Promise<Pick<AudioOutputSettings, 'playbackRate' | 'playbackSpeedMode'> | undefined> => {
  const [settings, status] = await Promise.all([
    Promise.resolve(window.echo?.app?.getSettings?.() ?? null).catch(() => null),
    Promise.resolve(window.echo?.audio?.getStatus?.() ?? null).catch(() => null),
  ]);
  const settingsOutput = createPlaybackSpeedOutput(settings?.playbackSpeed, settings?.playbackSpeedMode);
  const statusOutput = createPlaybackSpeedOutput(status?.playbackRate, status?.playbackSpeedMode, settingsOutput?.playbackSpeedMode ?? null);

  if (status && activePlaybackStates.has(status.state) && statusOutput) {
    return statusOutput;
  }

  return settingsOutput ?? statusOutput ?? undefined;
};

export const isPlaybackCancellationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(playbackCancellationErrorMessage);
};

export type QueueSource = PersistedQueueSource;

export type QueueItem = PersistedQueueItem;

const playbackStateFromConnectStatus = (status: ConnectSessionStatus): AudioPlaybackState => {
  switch (status.state) {
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'loading';
  }
};

const playbackStatusFromConnectStatus = (status: ConnectSessionStatus, item: QueueItem): PlaybackStatus => ({
  state: playbackStateFromConnectStatus(status),
  currentTrackId: status.currentTrackId ?? item.track.id,
  positionMs: Math.round(Math.max(0, status.positionSeconds) * 1000),
  durationMs: Math.round(Math.max(0, status.durationSeconds || item.track.duration) * 1000),
  filePath: item.track.path,
  volume: typeof status.volume === 'number' ? Math.max(0, Math.min(1, status.volume / 100)) : null,
});

export type RepeatMode = PersistedPlaybackRepeatMode;

type BackendQueueSyncItem = {
  itemId: string;
  trackId: string;
  filePath: string;
  sampleRate?: number;
  startSeconds?: number;
  metadata?: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    albumArtist?: string | null;
    coverUrl?: string | null;
  };
};

type PlaybackModeMemory = {
  isShuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoFillQueueEnabled: boolean;
  continuousPlayMode: ContinuousPlayMode;
  continuousPlayPreferences: ContinuousPlayPreference[];
};

type PlaylistPlaybackSnapshot = {
  items: QueueItem[];
  history: QueueItem[];
  currentQueueId: string | null;
  currentTrackId: string | null;
  lastPlayedTrack: LibraryTrack | null;
  resume: PersistedPlaybackSessionResume | null;
  mode: PlaybackModeMemory;
  automixEnabled: boolean;
};

type PlaylistPlaybackState = {
  active: boolean;
  label: string | null;
  playlistId: string | null;
  snapshot: PlaylistPlaybackSnapshot | null;
};

type LibraryShuffleDeck = {
  sourceKey: string | null;
  items: QueueItem[];
};

type PlaylistPlaybackInfo = Pick<PlaylistPlaybackState, 'active' | 'label' | 'playlistId'>;

export type QueueFeedback = {
  id: number;
  message: string;
  detail: string;
  tone: 'success' | 'info';
};

const isPlaybackOutputUnderPressure = (
  status: AudioStatus | null | undefined,
  trackId?: string | null,
): boolean => {
  if (
    !status ||
    !playbackPressureStates.has(status.state) ||
    !playbackPressureOutputModes.has(status.outputMode)
  ) {
    return false;
  }

  if (trackId && status.currentTrackId && status.currentTrackId !== trackId) {
    return false;
  }

  const nativeUnderrunCallbacks = Math.max(0, Number(status.nativeUnderrunCallbacks ?? 0));
  const nativeBufferedMs = Number(status.nativeBufferedMs);
  return (
    nativeUnderrunCallbacks > 0 ||
    (Number.isFinite(nativeBufferedMs) && nativeBufferedMs <= playbackPressureBufferedThresholdMs) ||
    status.warnings?.includes('exclusive_output_unstable') === true
  );
};

const hqPlayerTakeoverStorageKey = 'echo-next.hqplayer-takeover-enabled';

const readHqPlayerTakeoverEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(hqPlayerTakeoverStorageKey) === 'true';
  } catch {
    return false;
  }
};

const writeHqPlayerTakeoverEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(hqPlayerTakeoverStorageKey, enabled ? 'true' : 'false');
  } catch {
    // UI routing preference only.
  }
};

type PlaybackQueueMemory = {
  version: 1;
  revision?: number;
  items: QueueItem[];
  currentQueueId: string | null;
  currentTrackId: string | null;
  lastPlayedTrack: LibraryTrack | null;
  history: QueueItem[];
  resume: PersistedPlaybackSessionResume | null;
};

type HydratedPlaybackSession = PlaybackQueueMemory & {
  mode: PlaybackModeMemory;
  automixEnabled: boolean;
  playlistPlayback: PlaylistPlaybackState | null;
};

type ReplaceQueueOptions = {
  startTrackId?: string;
  source?: QueueSource;
};

type PlayPlaylistSequenceOptions = {
  label?: string;
  playlistId?: string;
  source?: QueueSource;
  startTrackId?: string;
};

type PlayTrackOptions = {
  source?: QueueSource;
  replaceQueueWith?: LibraryTrack[];
  replaceQueueWithItems?: Array<{ track: LibraryTrack; source?: QueueSource }>;
  forceNewQueueItem?: boolean;
  routeToConnectOutput?: boolean;
  forceHqPlayerConnect?: boolean;
  startSeconds?: number;
  forceRefresh?: boolean;
  preservePlaylistPlayback?: boolean;
};

type PlayNextOptions = {
  autoAdvance?: boolean;
};

type FillQueueOptions = {
  targetSize?: number;
};

type RestoreQueueItemsOptions = {
  currentQueueId?: string | null;
  currentTrackId?: string | null;
  preserveHistory?: boolean;
};

type PlayLocalTrackOptions = {
  routeToConnectOutput?: boolean;
  forceHqPlayerConnect?: boolean;
  startSeconds?: number;
  forceRefresh?: boolean;
};

type PlaybackQueueContextValue = {
  items: QueueItem[];
  tracks: LibraryTrack[];
  currentItem: QueueItem | null;
  currentQueueId: string | null;
  currentTrack: LibraryTrack | null;
  currentTrackId: string | null;
  lastPlayedTrack: LibraryTrack | null;
  history: QueueItem[];
  isShuffleEnabled: boolean;
  repeatMode: RepeatMode;
  automixEnabled: boolean;
  autoFillQueueEnabled: boolean;
  continuousPlayMode: ContinuousPlayMode;
  continuousPlayPreferences: ContinuousPlayPreference[];
  isContinuousPlayFilling: boolean;
  hqPlayerTakeoverEnabled: boolean;
  gaplessPlaybackEnabled: boolean;
  playbackShuffleAvoidRecentCount: number;
  shuffleScopeLabel: string;
  currentSourceLabel: string;
  lastQueueFeedback: QueueFeedback | null;
  playlistPlayback: PlaylistPlaybackInfo;
  canGoPrevious: boolean;
  canGoNext: boolean;
  replaceQueue: (tracks: LibraryTrack[], options?: ReplaceQueueOptions) => void;
  appendToQueue: (track: LibraryTrack, source?: QueueSource) => void;
  appendTracksToQueue: (tracks: LibraryTrack[], source?: QueueSource) => void;
  fillQueue: (options?: FillQueueOptions) => Promise<number>;
  playTrackNext: (track: LibraryTrack, source?: QueueSource) => void;
  playTracksNext: (tracks: LibraryTrack[], source?: QueueSource) => void;
  removeQueueItem: (queueId: string) => void;
  removeQueueItems: (queueIds: string[]) => void;
  removeTrackFromQueue: (trackId: string) => number;
  setQueueItemsRemoveAfterPlay: (queueIds: string[], enabled: boolean) => void;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  moveQueueItemsToIndex: (queueIds: string[], toIndex: number) => void;
  moveQueueItemsAfterCurrent: (queueIds: string[]) => void;
  restoreQueueItems: (items: QueueItem[], options?: RestoreQueueItemsOptions) => void;
  playQueueItem: (queueId: string) => Promise<PlaybackStatus>;
  playTrack: (track: LibraryTrack, options?: PlayTrackOptions) => Promise<PlaybackStatus>;
  playPlaylistSequence: (tracks: LibraryTrack[], options?: PlayPlaylistSequenceOptions) => Promise<PlaybackStatus | null>;
  exitPlaylistSequence: () => Promise<PlaybackStatus | null>;
  openTemporaryLocalFiles: (paths: string[]) => Promise<LocalFileResolveResult>;
  playPrevious: () => Promise<PlaybackStatus | null>;
  playNext: (options?: PlayNextOptions) => Promise<PlaybackStatus | null>;
  activateHqPlayerTakeover: () => Promise<PlaybackStatus | null>;
  setHqPlayerTakeoverEnabled: (enabled: boolean) => void;
  setAutomixEnabled: (enabled: boolean) => void;
  setGaplessPlaybackEnabled: (enabled: boolean) => Promise<void>;
  setAutoFillQueueEnabled: (enabled: boolean) => void;
  setContinuousPlayMode: (mode: ContinuousPlayMode) => void;
  reduceContinuousPlayFrequency: (kind: ContinuousPlayPreferenceKind, value: string) => void;
  clearContinuousPlayPreferences: () => void;
  removeContinuousPlayItems: () => void;
  setCurrentTrackId: (trackId: string | null) => void;
  updateCurrentTrackSnapshot: (
    patch: Partial<
      Pick<
        LibraryTrack,
        | 'duration'
        | 'coverThumb'
        | 'title'
        | 'artist'
        | 'album'
        | 'codec'
        | 'sampleRate'
        | 'bitDepth'
        | 'bitrate'
        | 'bpm'
        | 'bpmConfidence'
        | 'beatOffsetMs'
        | 'analysisStatus'
        | 'analysisUpdatedAt'
      >
    >,
  ) => void;
  updateTrackSnapshot: (
    trackId: string,
    patch: Partial<
      Pick<
        LibraryTrack,
        | 'duration'
        | 'coverThumb'
        | 'title'
        | 'artist'
        | 'album'
        | 'codec'
        | 'sampleRate'
        | 'bitDepth'
        | 'bitrate'
        | 'bpm'
        | 'bpmConfidence'
        | 'beatOffsetMs'
        | 'analysisStatus'
        | 'analysisUpdatedAt'
      >
    >,
  ) => void;
  syncPlaybackState: (state: AudioPlaybackState) => void;
  toggleShuffle: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setPlaybackOrder: (mode: PlaybackOrderMode) => Promise<void>;
};

type PlaybackQueueDiagnosticsSnapshot = {
  itemCount: number;
  historyCount: number;
  playlistItemCount?: number;
  shuffleDeckCount?: number;
  automixAnalysisPendingCount?: number;
  automixAnalysisTimerCount?: number;
  currentSourceType?: string | null;
  queueSampleJsonBytes?: number;
  historySampleJsonBytes?: number;
  estimatedQueueJsonBytes?: number;
  estimatedHistoryJsonBytes?: number;
};

declare global {
  interface Window {
    __echoPlaybackQueueDiagnostics?: {
      snapshot: () => PlaybackQueueDiagnosticsSnapshot;
    };
  }
}

type PlaybackHistorySession = {
  historyId: string;
  track: LibraryTrack;
  startedAtMs: number;
  lastResumedAtMs: number | null;
  playedSeconds: number;
  isPlaying: boolean;
  isFinishing: boolean;
};

type PlaybackHistoryFinishRecord = {
  historyId: string;
  track: LibraryTrack;
  playedSeconds: number;
  completed: boolean;
};

const pausedSessionTimeoutMs = 30 * 60 * 1000;
const postSwitchBackgroundDelayMs = 1_500;

const playbackQueueContextGlobal = globalThis as typeof globalThis & {
  __echoPlaybackQueueContext?: Context<PlaybackQueueContextValue | null>;
};

const PlaybackQueueContext =
  playbackQueueContextGlobal.__echoPlaybackQueueContext ??
  (playbackQueueContextGlobal.__echoPlaybackQueueContext = createContext<PlaybackQueueContextValue | null>(null));

const playbackModeMemoryKey = 'echo-next:playback-mode';
const automixEnabledMemoryKey = 'echo-next:automix-enabled';
const automixExperimentOptInMemoryKey = 'echo-next:automix-experimental-opt-in';
const playbackQueueMemoryKey = 'echo-next:playback-queue';
const automixTemporarilyDisabled = false;

const defaultPlaybackModeMemory: PlaybackModeMemory = {
  isShuffleEnabled: false,
  repeatMode: 'off',
  autoFillQueueEnabled: false,
  continuousPlayMode: 'similar',
  continuousPlayPreferences: [],
};

const defaultPlaybackQueueMemory: PlaybackQueueMemory = {
  version: 1,
  revision: 0,
  items: [],
  currentQueueId: null,
  currentTrackId: null,
  lastPlayedTrack: null,
  history: [],
  resume: null,
};

const defaultHydratedPlaybackSession: HydratedPlaybackSession = {
  ...defaultPlaybackQueueMemory,
  mode: defaultPlaybackModeMemory,
  automixEnabled: false,
  playlistPlayback: null,
};

const defaultPlaylistPlaybackState: PlaylistPlaybackState = {
  active: false,
  label: null,
  playlistId: null,
  snapshot: null,
};
const slowQueuePlaybackStepWarnThresholdMs = 750;
const slowQueuePlaybackStepWarnCooldownMs = 10_000;
const lastSlowQueuePlaybackStepWarnAtByKey = new Map<string, number>();

const isRepeatMode = (value: unknown): value is RepeatMode => value === 'off' || value === 'one' || value === 'all';
const isContinuousPlayMode = (value: unknown): value is ContinuousPlayMode =>
  value === 'similar' ||
  value === 'deep-cuts' ||
  value === 'recently-added' ||
  value === 'night' ||
  value === 'headphone-test';

const normalizeContinuousPlayPreferences = (value: unknown): ContinuousPlayPreference[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const kind = item.kind as ContinuousPlayPreferenceKind;
    const preferenceValue = typeof item.value === 'string' ? item.value.trim() : '';
    if ((kind !== 'artist' && kind !== 'album' && kind !== 'genre') || !preferenceValue) {
      return [];
    }
    return [{
      kind,
      value: preferenceValue,
      weight: typeof item.weight === 'number' && Number.isFinite(item.weight)
        ? Math.max(0.1, Math.min(1, item.weight))
        : 0.35,
    }];
  }).slice(0, 200);
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const logQueuePlaybackStep = (
  operation: string,
  phase: string,
  startedAtMs: number,
  trackId?: string | null,
): void => {
  const durationMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  if (durationMs < slowQueuePlaybackStepWarnThresholdMs) {
    return;
  }

  const message = `[playback-perf] ${operation}:${phase} ${durationMs}ms${trackId ? ` ${JSON.stringify({ trackId })}` : ''}`;
  const warnKey = `${operation}:${phase}`;
  const now = Date.now();
  const lastWarnAt = lastSlowQueuePlaybackStepWarnAtByKey.get(warnKey);
  if (lastWarnAt !== undefined && now - lastWarnAt < slowQueuePlaybackStepWarnCooldownMs) {
    return;
  }

  lastSlowQueuePlaybackStepWarnAtByKey.set(warnKey, now);
  console.warn(`${message} SLOW probableCause=slow_renderer_playback_queue_phase actionHint=check renderer route, recent input, and matching main playback phase`);
};

const runQueuePlaybackStep = async <T,>(
  operation: string,
  phase: string,
  trackId: string | null | undefined,
  run: () => Promise<T>,
): Promise<T> => {
  const startedAtMs = performance.now();
  try {
    return await run();
  } finally {
    logQueuePlaybackStep(operation, phase, startedAtMs, trackId);
  }
};

const runQueuePlaybackStepSync = <T,>(
  operation: string,
  phase: string,
  trackId: string | null | undefined,
  run: () => T,
): T => {
  const startedAtMs = performance.now();
  try {
    return run();
  } finally {
    logQueuePlaybackStep(operation, phase, startedAtMs, trackId);
  }
};

const deferQueueBackgroundTask = (
  callback: () => void,
  options: { delayMs?: number } = {},
): (() => void) => {
  let cancelled = false;
  let timeoutId: number | null = null;
  const requestIdleCallback = window.requestIdleCallback;
  const cancelIdleCallback = window.cancelIdleCallback;
  let idleId: number | null = null;

  const run = (): void => {
    if (cancelled) {
      return;
    }

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        if (!cancelled) {
          callback();
        }
      }, { timeout: 1200 });
      return;
    }

    callback();
  };

  timeoutId = window.setTimeout(run, options.delayMs ?? 160);

  return () => {
    cancelled = true;
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const isLibraryTrackSnapshot = (value: unknown): value is LibraryTrack =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.path === 'string' &&
  typeof value.title === 'string' &&
  typeof value.artist === 'string' &&
  typeof value.album === 'string' &&
  typeof value.albumArtist === 'string' &&
  typeof value.duration === 'number' &&
  isRecord(value.fieldSources);

const isQueueSource = (value: unknown): value is QueueSource =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  typeof value.label === 'string' &&
  ['songs', 'album', 'artist', 'folder', 'liked', 'streaming', 'local-file', 'continuous-play', 'manual'].includes(value.type);

const isQueueItemSnapshot = (value: unknown): value is QueueItem =>
  isRecord(value) &&
  typeof value.queueId === 'string' &&
  typeof value.addedAt === 'string' &&
  isQueueSource(value.source) &&
  isLibraryTrackSnapshot(value.track);

const readPlaybackModeMemory = (): PlaybackModeMemory => {
  if (typeof window === 'undefined') {
    return defaultPlaybackModeMemory;
  }

  try {
    const raw = window.localStorage.getItem(playbackModeMemoryKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<PlaybackModeMemory>) : {};

    return {
      isShuffleEnabled: parsed.isShuffleEnabled === true,
      repeatMode: isRepeatMode(parsed.repeatMode) ? parsed.repeatMode : 'off',
      autoFillQueueEnabled: parsed.autoFillQueueEnabled === true,
      continuousPlayMode: isContinuousPlayMode(parsed.continuousPlayMode) ? parsed.continuousPlayMode : 'similar',
      continuousPlayPreferences: normalizeContinuousPlayPreferences(parsed.continuousPlayPreferences),
    };
  } catch {
    return defaultPlaybackModeMemory;
  }
};

const writePlaybackModeMemory = (memory: PlaybackModeMemory): void => {
  try {
    window.localStorage.setItem(playbackModeMemoryKey, JSON.stringify(memory));
  } catch {
    // Playback controls should keep working even when browser storage is unavailable.
  }
};

const readAutomixEnabledMemory = (): boolean => {
  if (automixTemporarilyDisabled) {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(automixExperimentOptInMemoryKey) === 'true' &&
      window.localStorage.getItem(automixEnabledMemoryKey) === 'true';
  } catch {
    return false;
  }
};

const writeAutomixEnabledMemory = (enabled: boolean): void => {
  try {
    const nextValue = enabled && !automixTemporarilyDisabled ? 'true' : 'false';
    window.localStorage.setItem(automixExperimentOptInMemoryKey, nextValue);
    window.localStorage.setItem(automixEnabledMemoryKey, nextValue);
  } catch {
    // Automix is optional; storage failures should not block playback.
  }
};

const canRestoreAutomixEnabled = (enabled: boolean | null | undefined): boolean =>
  !automixTemporarilyDisabled && enabled === true && readAutomixEnabledMemory();

const readPlaybackQueueMemory = (): PlaybackQueueMemory => {
  if (typeof window === 'undefined') {
    return defaultPlaybackQueueMemory;
  }

  try {
    const raw = window.localStorage.getItem(playbackQueueMemoryKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<PlaybackQueueMemory>) : {};
    const items = Array.isArray(parsed.items) ? parsed.items.filter(isQueueItemSnapshot) : [];
    const queueIds = new Set(items.map((item) => item.queueId));
    const currentQueueId = typeof parsed.currentQueueId === 'string' && queueIds.has(parsed.currentQueueId) ? parsed.currentQueueId : null;
    const currentTrackId = typeof parsed.currentTrackId === 'string' ? parsed.currentTrackId : currentQueueId ? items.find((item) => item.queueId === currentQueueId)?.track.id ?? null : null;
    const lastPlayedTrack = isLibraryTrackSnapshot(parsed.lastPlayedTrack) ? parsed.lastPlayedTrack : null;
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((item): item is QueueItem => isQueueItemSnapshot(item) && queueIds.has(item.queueId))
      : [];

    return {
      version: 1,
      revision: Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0,
      items,
      currentQueueId,
      currentTrackId,
      lastPlayedTrack,
      history,
      resume: null,
    };
  } catch {
    return defaultPlaybackQueueMemory;
  }
};

const writePlaybackQueueMemory = (memory: PlaybackQueueMemory): void => {
  try {
    const legacyMemory = {
      version: memory.version,
      items: memory.items,
      currentQueueId: memory.currentQueueId,
      currentTrackId: memory.currentTrackId,
      lastPlayedTrack: memory.lastPlayedTrack,
      history: memory.history,
    };
    window.localStorage.setItem(playbackQueueMemoryKey, JSON.stringify(legacyMemory));
  } catch {
    // Queue state is a convenience snapshot; playback should continue if storage is full or unavailable.
  }
};

const hasPlaybackSessionPersistence = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.echo?.playback?.getQueueSession === 'function' &&
  typeof window.echo.playback.saveQueueSession === 'function';

const shouldUseLegacyPlaybackStorage = (): boolean => !hasPlaybackSessionPersistence();

const clearLegacyPlaybackMemory = (): void => {
  try {
    const keepAutomixExperimentOptIn = window.localStorage.getItem(automixExperimentOptInMemoryKey) === 'true';
    window.localStorage.removeItem(playbackQueueMemoryKey);
    window.localStorage.removeItem(playbackModeMemoryKey);
    if (!keepAutomixExperimentOptIn) {
      window.localStorage.removeItem(automixEnabledMemoryKey);
      window.localStorage.removeItem(automixExperimentOptInMemoryKey);
    }
  } catch {
    // Legacy migration cleanup is best-effort.
  }
};

const readLegacyPlaybackSession = (): HydratedPlaybackSession => ({
  ...readPlaybackQueueMemory(),
  mode: readPlaybackModeMemory(),
  automixEnabled: readAutomixEnabledMemory(),
  playlistPlayback: null,
});

const hasLegacyPlaybackSession = (session: HydratedPlaybackSession): boolean =>
  session.items.length > 0 ||
  session.history.length > 0 ||
  Boolean(session.currentTrackId) ||
  Boolean(session.lastPlayedTrack) ||
  session.mode.isShuffleEnabled ||
  session.mode.repeatMode !== 'off' ||
  session.mode.autoFillQueueEnabled ||
  canRestoreAutomixEnabled(session.automixEnabled);

const isResumeMemory = (
  value: unknown,
  items: QueueItem[],
): value is PersistedPlaybackSessionResume => {
  if (!isRecord(value) || typeof value.filePath !== 'string') {
    return false;
  }

  const queueId = typeof value.queueId === 'string' ? value.queueId : null;
  const trackId = typeof value.trackId === 'string' ? value.trackId : null;

  return items.some((item) =>
    (queueId && item.queueId === queueId) ||
    (trackId && item.track.id === trackId) ||
    item.track.path === value.filePath,
  );
};

const playlistSnapshotFromPersisted = (
  snapshot: PersistedPlaylistPlaybackSnapshot | null | undefined,
): PlaylistPlaybackSnapshot | null => {
  if (!snapshot) {
    return null;
  }

  const items = Array.isArray(snapshot.items) ? snapshot.items.filter(isQueueItemSnapshot) : [];
  const queueIds = new Set(items.map((item) => item.queueId));
  const currentQueueId = snapshot.currentQueueId && queueIds.has(snapshot.currentQueueId) ? snapshot.currentQueueId : null;
  const currentTrackId =
    typeof snapshot.currentTrackId === 'string'
      ? snapshot.currentTrackId
      : currentQueueId
        ? items.find((item) => item.queueId === currentQueueId)?.track.id ?? null
        : null;
  const history = Array.isArray(snapshot.history)
    ? snapshot.history.filter((item): item is QueueItem => isQueueItemSnapshot(item) && queueIds.has(item.queueId))
    : [];

  return {
    items,
    currentQueueId,
    currentTrackId,
    lastPlayedTrack: isLibraryTrackSnapshot(snapshot.lastPlayedTrack) ? snapshot.lastPlayedTrack : null,
    history,
    resume: isResumeMemory(snapshot.resume, items) ? snapshot.resume : null,
    mode: {
      isShuffleEnabled: snapshot.mode?.isShuffleEnabled === true,
      repeatMode: isRepeatMode(snapshot.mode?.repeatMode) ? snapshot.mode.repeatMode : 'off',
      autoFillQueueEnabled: snapshot.mode?.autoFillQueueEnabled === true,
      continuousPlayMode: isContinuousPlayMode(snapshot.mode?.continuousPlayMode) ? snapshot.mode.continuousPlayMode : 'similar',
      continuousPlayPreferences: normalizeContinuousPlayPreferences(snapshot.mode?.continuousPlayPreferences),
    },
    automixEnabled: canRestoreAutomixEnabled(snapshot.mode?.automixEnabled),
  };
};

const playlistPlaybackFromPersisted = (
  playlistPlayback: PersistedPlaylistPlaybackState | null | undefined,
): PlaylistPlaybackState | null => {
  if (!playlistPlayback?.active) {
    return null;
  }

  const snapshot = playlistSnapshotFromPersisted(playlistPlayback.snapshot);
  if (!snapshot) {
    return null;
  }

  return {
    active: true,
    label: typeof playlistPlayback.label === 'string' ? playlistPlayback.label : null,
    playlistId: typeof playlistPlayback.playlistId === 'string' ? playlistPlayback.playlistId : null,
    snapshot,
  };
};

const playbackSessionFromPersisted = (session: PersistedPlaybackSessionV1 | null): HydratedPlaybackSession => {
  if (!session) {
    return defaultHydratedPlaybackSession;
  }

  const items = Array.isArray(session.items) ? session.items.filter(isQueueItemSnapshot) : [];
  const queueIds = new Set(items.map((item) => item.queueId));
  const currentQueueId = session.currentQueueId && queueIds.has(session.currentQueueId) ? session.currentQueueId : null;
  const currentTrackId =
    typeof session.currentTrackId === 'string'
      ? session.currentTrackId
      : currentQueueId
        ? items.find((item) => item.queueId === currentQueueId)?.track.id ?? null
        : null;
  const history = Array.isArray(session.history)
    ? session.history.filter((item): item is QueueItem => isQueueItemSnapshot(item) && queueIds.has(item.queueId))
    : [];

  return {
    version: 1,
    revision: Number.isSafeInteger(session.revision) && Number(session.revision) >= 0 ? Number(session.revision) : 0,
    items,
    currentQueueId,
    currentTrackId,
    lastPlayedTrack: isLibraryTrackSnapshot(session.lastPlayedTrack) ? session.lastPlayedTrack : null,
    history,
    resume: isResumeMemory(session.resume, items) ? session.resume : null,
    mode: {
      isShuffleEnabled: session.mode?.isShuffleEnabled === true,
      repeatMode: isRepeatMode(session.mode?.repeatMode) ? session.mode.repeatMode : 'off',
      autoFillQueueEnabled: session.mode?.autoFillQueueEnabled === true,
      continuousPlayMode: isContinuousPlayMode(session.mode?.continuousPlayMode) ? session.mode.continuousPlayMode : 'similar',
      continuousPlayPreferences: normalizeContinuousPlayPreferences(session.mode?.continuousPlayPreferences),
    },
    automixEnabled: canRestoreAutomixEnabled(session.mode?.automixEnabled),
    playlistPlayback: playlistPlaybackFromPersisted(session.playlistPlayback),
  };
};

const createPersistedPlaylistSnapshot = (snapshot: PlaylistPlaybackSnapshot): PersistedPlaylistPlaybackSnapshot => ({
  items: snapshot.items,
  currentQueueId: snapshot.currentQueueId,
  currentTrackId: snapshot.currentTrackId,
  lastPlayedTrack: snapshot.lastPlayedTrack,
  history: snapshot.history,
  mode: {
    isShuffleEnabled: snapshot.mode.isShuffleEnabled,
    repeatMode: snapshot.mode.repeatMode,
    automixEnabled: snapshot.automixEnabled,
    autoFillQueueEnabled: snapshot.mode.autoFillQueueEnabled,
    continuousPlayMode: snapshot.mode.continuousPlayMode,
    continuousPlayPreferences: snapshot.mode.continuousPlayPreferences,
  },
  resume: isResumeMemory(snapshot.resume, snapshot.items) ? snapshot.resume : null,
});

const createPersistedSessionSnapshot = (session: HydratedPlaybackSession): PersistedPlaybackSessionV1 => ({
  version: 1,
  revision: session.revision ?? 0,
  items: session.items,
  currentQueueId: session.currentQueueId,
  currentTrackId: session.currentTrackId,
  lastPlayedTrack: session.lastPlayedTrack,
  history: session.history,
  mode: {
    isShuffleEnabled: session.mode.isShuffleEnabled,
    repeatMode: session.mode.repeatMode,
    automixEnabled: session.automixEnabled,
    autoFillQueueEnabled: session.mode.autoFillQueueEnabled,
    continuousPlayMode: session.mode.continuousPlayMode,
    continuousPlayPreferences: session.mode.continuousPlayPreferences,
  },
  resume: isResumeMemory(session.resume, session.items) ? session.resume : null,
  updatedAt: new Date().toISOString(),
  playlistPlayback: session.playlistPlayback?.active && session.playlistPlayback.snapshot
    ? {
        active: true,
        label: session.playlistPlayback.label,
        playlistId: session.playlistPlayback.playlistId,
        snapshot: createPersistedPlaylistSnapshot(session.playlistPlayback.snapshot),
      }
    : null,
});

const isStreamingProviderName = (provider: string | null | undefined): provider is StreamingProviderName =>
  streamingProviderNames.includes(provider as StreamingProviderName);

const replayGainFromTrack = (track: LibraryTrack): ReplayGainTrackData | null => {
  const replayGain: ReplayGainTrackData = {
    trackGainDb: track.replayGainTrackGainDb ?? null,
    albumGainDb: track.replayGainAlbumGainDb ?? null,
    trackPeak: track.replayGainTrackPeak ?? null,
    albumPeak: track.replayGainAlbumPeak ?? null,
    integratedLufs: track.replayGainIntegratedLufs ?? null,
  };
  return Object.values(replayGain).some((value) => typeof value === 'number' && Number.isFinite(value)) ? replayGain : null;
};

const toPlayableTrack = (track: LibraryTrack): PlayableTrack => {
  const replayGain = replayGainFromTrack(track);
  if (track.mediaType === 'streaming') {
    const provider = isStreamingProviderName(track.provider) ? track.provider : 'mock';
    const providerTrackId = track.providerTrackId ?? track.id;
    const stableKey = track.stableKey ?? streamingStableKey(provider, providerTrackId);

    return {
      mediaType: 'streaming',
      trackId: track.id,
      provider,
      providerTrackId,
      quality: track.streamingQuality,
      stableKey,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      coverThumb: track.coverThumb,
      replayGain,
      playable: track.unavailable !== true,
      unavailableReason: track.unavailable ? 'This streaming track is unavailable.' : null,
    };
  }

  if (track.mediaType === 'remote') {
    return {
      mediaType: 'remote',
      trackId: track.id,
      sourceId: track.sourceId ?? null,
      stableKey: track.stableKey ?? null,
      remotePath: track.remotePath ?? null,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      duration: track.duration,
      codec: track.codec,
      sampleRate: track.sampleRate,
      bitDepth: track.bitDepth,
      bitrate: track.bitrate,
      coverThumb: track.coverThumb,
      replayGain,
    };
  }

  return {
    mediaType: 'local',
    trackId: track.id,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    duration: track.duration,
    coverThumb: track.coverThumb,
    replayGain,
  };
};

const shouldReplaceExistingQueueTrack = (existingTrack: LibraryTrack, requestedTrack: LibraryTrack): boolean =>
  existingTrack.mediaType === 'streaming' &&
  requestedTrack.mediaType === 'streaming' &&
  (
    existingTrack.streamingQuality !== requestedTrack.streamingQuality ||
    existingTrack.provider !== requestedTrack.provider ||
    existingTrack.providerTrackId !== requestedTrack.providerTrackId ||
    (
      (existingTrack.isTemporary === true || requestedTrack.isTemporary === true || existingTrack.isLiveStream === true || requestedTrack.isLiveStream === true) &&
      (
        existingTrack.title !== requestedTrack.title ||
        existingTrack.artist !== requestedTrack.artist ||
        existingTrack.album !== requestedTrack.album ||
        existingTrack.coverThumb !== requestedTrack.coverThumb ||
        existingTrack.liveVideoUrl !== requestedTrack.liveVideoUrl
      )
    )
  );

const manualSource: QueueSource = { type: 'manual', label: 'Manual queue' };

const receiverTrackIdPrefix = 'dlna-receiver:';
const airPlayReceiverTrackIdPrefix = 'airplay-receiver:';

const isActiveReceiverStatus = (status: ConnectReceiverStatus): boolean =>
  Boolean(status.currentUri && ['ready', 'loading', 'playing', 'paused'].includes(status.state));

const isActiveAirPlayReceiverStatus = (status: AirPlayReceiverStatus): boolean =>
  Boolean(status.metadata && ['ready', 'playing', 'paused'].includes(status.state));

const receiverStatusToPlaybackState = (status: ConnectReceiverStatus): AudioPlaybackState => {
  switch (status.state) {
    case 'loading':
    case 'playing':
    case 'paused':
    case 'stopped':
    case 'error':
      return status.state;
    default:
      return 'stopped';
  }
};

const airPlayStatusToPlaybackState = (status: AirPlayReceiverStatus): AudioPlaybackState => {
  switch (status.state) {
    case 'playing':
    case 'paused':
    case 'stopped':
    case 'error':
      return status.state;
    case 'ready':
    case 'starting':
      return 'loading';
    default:
      return 'stopped';
  }
};

const hashSnapshotText = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

const receiverSnapshotIdentity = (metadata: { title?: string | null; artist?: string | null; album?: string | null } | null, durationSeconds: number): string =>
  hashSnapshotText([
    metadata?.title?.trim().toLocaleLowerCase() ?? '',
    metadata?.artist?.trim().toLocaleLowerCase() ?? '',
    metadata?.album?.trim().toLocaleLowerCase() ?? '',
    durationSeconds > 0 ? Math.round(durationSeconds).toString() : '',
  ].join('|'));

const createReceiverTrackSnapshot = (status: ConnectReceiverStatus): LibraryTrack | null => {
  if (!status.currentUri || !status.metadata) {
    return null;
  }

  return {
    id: `${receiverTrackIdPrefix}${status.currentUri}`,
    mediaType: 'remote',
    isTemporary: true,
    path: status.currentUri,
    sourceId: null,
    remotePath: status.currentUri,
    stableKey: status.currentUri,
    title: status.metadata.title,
    artist: status.metadata.artist,
    album: status.metadata.album ?? '',
    albumArtist: status.metadata.albumArtist ?? status.metadata.artist,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: status.durationSeconds || status.metadata.durationSeconds || 0,
    codec: null,
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: null,
    coverThumb: status.metadata.coverHttpUrl || null,
    fieldSources: {
      title: 'dlna',
      artist: 'dlna',
      album: 'dlna',
      albumArtist: 'dlna',
      cover: 'dlna',
    },
  };
};

const createAirPlayTrackSnapshot = (status: AirPlayReceiverStatus): LibraryTrack | null => {
  if (!status.metadata) {
    return null;
  }

  const sourceId = status.currentSourceId ?? `${airPlayReceiverTrackIdPrefix}${status.updatedAt}`;
  const duration = status.durationSeconds || status.metadata.durationSeconds || 0;
  const snapshotId = `${sourceId}:${receiverSnapshotIdentity(status.metadata, duration)}`;
  const path = sourceId;
  return {
    id: snapshotId,
    mediaType: 'remote',
    isTemporary: true,
    path,
    sourceId: null,
    remotePath: path,
    stableKey: path,
    title: status.metadata.title,
    artist: status.metadata.artist,
    album: status.metadata.album ?? '',
    albumArtist: status.metadata.albumArtist ?? status.metadata.artist,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration,
    codec: null,
    sampleRate: null,
    bitDepth: null,
    bitrate: null,
    coverId: null,
    coverThumb: status.artworkUrl || status.metadata.coverHttpUrl || null,
    fieldSources: {
      title: 'airplay',
      artist: 'airplay',
      album: 'airplay',
      albumArtist: 'airplay',
      cover: 'airplay',
    },
  };
};

const isSameReceiverTrackSnapshot = (left: LibraryTrack | null, right: LibraryTrack): boolean =>
  Boolean(
    left &&
      left.id === right.id &&
      left.path === right.path &&
      left.title === right.title &&
      left.artist === right.artist &&
      left.album === right.album &&
      left.albumArtist === right.albumArtist &&
      left.duration === right.duration &&
      left.coverThumb === right.coverThumb,
  );

const isDirectLocalTrack = (track: LibraryTrack | null | undefined): track is LibraryTrack =>
  Boolean(track && !track.isTemporary && (track.mediaType ?? 'local') === 'local');

const localTrackMatchesReceiverIdentity = (track: LibraryTrack | null | undefined, identity: string | null | undefined): boolean => {
  const normalizedIdentity = identity?.trim();
  if (!isDirectLocalTrack(track) || !normalizedIdentity) {
    return false;
  }

  return track.id === normalizedIdentity || track.path === normalizedIdentity || track.stableKey?.trim() === normalizedIdentity;
};

let queueIdCounter = 0;

const createQueueId = (trackId: string): string => {
  queueIdCounter += 1;
  return `${Date.now().toString(36)}-${queueIdCounter.toString(36)}-${trackId}`;
};

const createProbeFromTrack = (track: LibraryTrack, options: { durationSeconds?: number } = {}) => ({
  durationSeconds:
    typeof options.durationSeconds === 'number' && Number.isFinite(options.durationSeconds) && options.durationSeconds > 0
      ? options.durationSeconds
      : track.duration,
  fileSampleRate: track.sampleRate,
  channels: 2,
  codec: track.codec,
  bitDepth: track.bitDepth,
  bitrate: track.bitrate,
  bpm: track.bpm,
  bpmConfidence: track.bpmConfidence,
  beatOffsetMs: track.beatOffsetMs,
});

const normalizeGaplessText = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase();

const getFileExtension = (filePath: string | null | undefined): string => {
  const match = (filePath ?? '').toLocaleLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return match?.[1] ?? '';
};

const isDsdTrack = (track: LibraryTrack): boolean => {
  const codec = normalizeGaplessText(track.codec);
  const extension = getFileExtension(track.path);
  return dsdCodecs.has(codec) || dsdCodecs.has(extension);
};

const isGaplessLosslessTrack = (track: LibraryTrack): boolean => {
  const codec = normalizeGaplessText(track.codec);
  const extension = getFileExtension(track.path);
  return gaplessLosslessCodecs.has(codec) || gaplessLosslessExtensions.has(extension);
};

const isLocalGaplessCandidate = (track: LibraryTrack): boolean =>
  !isSpotifyTrack(track) &&
  track.unavailable !== true &&
  (track.mediaType === undefined || track.mediaType === 'local') &&
  Boolean(track.path) &&
  !isDsdTrack(track) &&
  isGaplessLosslessTrack(track);

const isGaplessAlbumAdjacent = (current: LibraryTrack, next: LibraryTrack): boolean => {
  const currentAlbum = normalizeGaplessText(current.album);
  const nextAlbum = normalizeGaplessText(next.album);
  const currentAlbumArtist = normalizeGaplessText(current.albumArtist || current.artist);
  const nextAlbumArtist = normalizeGaplessText(next.albumArtist || next.artist);
  if (!currentAlbum || !nextAlbum || currentAlbum !== nextAlbum || currentAlbumArtist !== nextAlbumArtist) {
    return false;
  }

  const currentTrackNo = Number(current.trackNo);
  const nextTrackNo = Number(next.trackNo);
  if (!Number.isInteger(currentTrackNo) || !Number.isInteger(nextTrackNo) || currentTrackNo <= 0 || nextTrackNo <= 0) {
    return false;
  }

  const currentDiscNo = Number.isInteger(Number(current.discNo)) && Number(current.discNo) > 0 ? Number(current.discNo) : 1;
  const nextDiscNo = Number.isInteger(Number(next.discNo)) && Number(next.discNo) > 0 ? Number(next.discNo) : 1;
  return currentDiscNo === nextDiscNo && nextTrackNo === currentTrackNo + 1;
};

const statusForPlaybackFailure = (track: LibraryTrack): PlaybackStatus => ({
  state: 'error',
  currentTrackId: track.id,
  positionMs: 0,
  durationMs: Math.round(Math.max(0, track.duration) * 1000),
  filePath: track.stableKey ?? track.path,
});

const playbackStatusForItem = (status: PlaybackStatus, item: QueueItem, expectedStartSeconds?: number): PlaybackStatus => {
  const hasExpectedStart = typeof expectedStartSeconds === 'number' && Number.isFinite(expectedStartSeconds);

  return {
    ...status,
    currentTrackId: item.track.id,
    durationMs: status.durationMs > 0 ? status.durationMs : Math.round(Math.max(0, item.track.duration) * 1000),
    positionMs: hasExpectedStart ? Math.round(Math.max(0, expectedStartSeconds) * 1000) : status.positionMs,
  };
};

const createQueueItem = (track: LibraryTrack, source: QueueSource = manualSource): QueueItem => ({
  queueId: createQueueId(track.id),
  track,
  source,
  addedAt: new Date().toISOString(),
});

const playlistItemToTrack = (item: LibraryPlaylistItem): LibraryTrack | null => {
  if (item.track) {
    return { ...item.track, unavailable: item.unavailable, playlistItemId: item.id };
  }

  if (item.mediaType === 'stream_track' && item.mediaId && item.sourceItemId && item.unavailable !== true) {
    return {
      id: item.mediaId,
      mediaType: 'streaming',
      path: item.mediaId,
      provider: item.sourceProvider,
      providerTrackId: item.sourceItemId,
      stableKey: item.mediaId,
      title: item.titleSnapshot ?? 'Streaming track',
      artist: item.artistSnapshot ?? 'Unknown Artist',
      album: item.albumSnapshot ?? '',
      albumArtist: item.artistSnapshot ?? '',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: item.durationSnapshot ?? 0,
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
      coverId: item.coverId,
      coverThumb: item.coverThumb,
      fieldSources: {
        title: item.sourceProvider,
        artist: item.sourceProvider,
        album: item.sourceProvider,
      },
      unavailable: false,
      playlistItemId: item.id,
    };
  }

  return null;
};

const isLocalAutomixCandidate = (track: LibraryTrack): boolean =>
  !isSpotifyTrack(track) && (track.mediaType === undefined || track.mediaType === 'local');

const isAutomixQueueCandidate = (track: LibraryTrack): boolean =>
  !isSpotifyTrack(track) && track.unavailable !== true;

const shouldAnalyzeAutomixBpmCandidate = (track: LibraryTrack): boolean =>
  isLocalAutomixCandidate(track) &&
  !track.isTemporary &&
  Boolean(track.path) &&
  shouldAnalyzeBpm(track);

const findItemByQueueId = (items: QueueItem[], queueId: string | null): QueueItem | null =>
  queueId ? items.find((item) => item.queueId === queueId) ?? null : null;

const findCurrentIndex = (items: QueueItem[], currentQueueId: string | null, currentTrackId: string | null): number => {
  const queueIndex = currentQueueId ? items.findIndex((item) => item.queueId === currentQueueId) : -1;

  if (queueIndex >= 0) {
    return queueIndex;
  }

  return currentTrackId ? items.findIndex((item) => item.track.id === currentTrackId) : -1;
};

const findAutomixAdvanceItem = (
  items: QueueItem[],
  currentQueueId: string | null,
  currentTrackId: string | null,
  toTrackId: string | null | undefined,
): QueueItem | null => {
  if (!toTrackId) {
    return null;
  }

  const currentIndex = findCurrentIndex(items, currentQueueId, currentTrackId);
  const nextInPlaybackOrder = currentIndex >= 0
    ? items.slice(currentIndex + 1).find((candidate) => candidate.track.id === toTrackId) ?? null
    : null;

  return nextInPlaybackOrder ?? items.find((candidate, index) => index > currentIndex && candidate.track.id === toTrackId) ?? null;
};

const resolveSequentialNextItem = (items: QueueItem[], item: QueueItem, repeatMode: RepeatMode): QueueItem | null => {
  const index = items.findIndex((candidate) => candidate.queueId === item.queueId);
  if (index < 0) {
    return null;
  }

  const afterCurrent = items.slice(index + 1).find((candidate) => candidate.track.unavailable !== true) ?? null;
  if (afterCurrent) {
    return afterCurrent;
  }

  return repeatMode === 'all'
    ? items.slice(0, index).find((candidate) => candidate.track.unavailable !== true) ?? null
    : null;
};

const resolveSnapshotResumeItem = (snapshot: PlaylistPlaybackSnapshot, mode: 'current' | 'next'): QueueItem | null => {
  if (snapshot.items.length === 0) {
    return null;
  }

  const currentIndex = findCurrentIndex(snapshot.items, snapshot.currentQueueId, snapshot.currentTrackId);
  if (mode === 'current') {
    const current = currentIndex >= 0 ? snapshot.items[currentIndex] ?? null : null;
    return current?.track.unavailable !== true
      ? current
      : snapshot.items.find((item) => item.track.unavailable !== true) ?? null;
  }

  if (currentIndex < 0) {
    return snapshot.items.find((item) => item.track.unavailable !== true) ?? null;
  }

  const afterCurrent = snapshot.items.slice(currentIndex + 1).find((item) => item.track.unavailable !== true) ?? null;
  if (afterCurrent) {
    return afterCurrent;
  }

  return snapshot.mode.repeatMode === 'all'
    ? snapshot.items.slice(0, currentIndex).find((item) => item.track.unavailable !== true) ?? null
    : null;
};

const resolveSequentialAutomixNextItem = (items: QueueItem[], item: QueueItem, repeatMode: RepeatMode): QueueItem | null => {
  const index = items.findIndex((candidate) => candidate.queueId === item.queueId);
  if (index < 0) {
    return null;
  }

  const afterCurrent = items.slice(index + 1).find((candidate) => isAutomixQueueCandidate(candidate.track)) ?? null;
  if (afterCurrent) {
    return afterCurrent;
  }

  if (repeatMode !== 'all' || items.length <= 1) {
    return null;
  }

  return items.slice(0, index).find((candidate) => isAutomixQueueCandidate(candidate.track)) ?? null;
};

const resolveShuffleAutomixNextItem = (items: QueueItem[], item: QueueItem, history: QueueItem[], repeatMode: RepeatMode, avoidRecentCount: number): QueueItem | null => {
  const candidates = getShuffleCandidates(items, item, history, avoidRecentCount).filter((candidate) => isAutomixQueueCandidate(candidate.track));
  const freshCandidate = pickRandom(candidates);
  if (freshCandidate) {
    return freshCandidate;
  }

  if (repeatMode !== 'all') {
    return null;
  }

  const repeatCandidates = items.filter((candidate) => candidate.queueId !== item.queueId && isAutomixQueueCandidate(candidate.track));
  return pickRandom(repeatCandidates);
};

const getShuffleCandidates = (items: QueueItem[], activeItem: QueueItem | null, history: QueueItem[], avoidRecentCount: number): QueueItem[] => {
  const recentHistory = avoidRecentCount > 0 ? history.slice(-avoidRecentCount) : [];
  const excludedQueueIds = new Set(recentHistory.map((item) => item.queueId));

  if (activeItem) {
    excludedQueueIds.add(activeItem.queueId);
  }

  return items.filter((item) => item.track.unavailable !== true && !excludedQueueIds.has(item.queueId));
};

const getLibraryShuffleExcludedTrackIds = (activeItem: QueueItem | null, history: QueueItem[], avoidRecentCount: number): string[] => {
  const excludedTrackIds: string[] = [];
  const seen = new Set<string>();
  const addTrackId = (trackId: string | null | undefined): void => {
    if (!trackId || seen.has(trackId)) {
      return;
    }

    seen.add(trackId);
    excludedTrackIds.push(trackId);
  };

  addTrackId(activeItem?.track.id);
  for (const item of (avoidRecentCount > 0 ? history.slice(-avoidRecentCount) : []).reverse()) {
    addTrackId(item.track.id);
  }

  return excludedTrackIds;
};

const isLibraryRandomSource = (source: QueueSource | null | undefined): source is Extract<QueueSource, { type: 'songs' }> =>
  source?.type === 'songs';

const isSongsRandomSortSource = (source: QueueSource | null | undefined): source is Extract<QueueSource, { type: 'songs' }> =>
  source?.type === 'songs' && source.sort === 'random';

const isFolderSource = (source: QueueSource | null | undefined): source is Extract<QueueSource, { type: 'folder' }> =>
  source?.type === 'folder';

const isFolderRandomSortSource = (source: QueueSource | null | undefined): source is Extract<QueueSource, { type: 'folder' }> =>
  source?.type === 'folder' && source.sort === 'random';

const likedQueueSourceProviders = new Set<PlaylistSourceProvider>(['local', 'netease', 'qqmusic']);

const isLikedSource = (source: QueueSource | null | undefined): source is Extract<QueueSource, { type: 'liked' }> =>
  source?.type === 'liked' && likedQueueSourceProviders.has(source.sourceProvider);

const libraryShuffleSource: Extract<QueueSource, { type: 'songs' }> = {
  type: 'songs',
  label: 'Library shuffle',
  sort: 'random',
};

type ShuffleDeckSource =
  | Extract<QueueSource, { type: 'songs' }>
  | Extract<QueueSource, { type: 'folder' }>
  | Extract<QueueSource, { type: 'liked' }>;

const shuffleDeckKeyForSource = (source: ShuffleDeckSource): string => {
  if (source.type === 'folder') {
    return ['folder', source.folderId, source.path, source.recursive ? 'recursive' : 'direct', source.search ?? ''].join('\0');
  }

  if (source.type === 'liked') {
    return ['liked', source.sourceProvider, source.search ?? '', source.sort ?? ''].join('\0');
  }

  return [
    'songs',
    source.search ?? '',
    source.sort ?? '',
    source.hideDuplicates === true ? 'hide-duplicates' : '',
    source.showDuplicatesOnly === true ? 'duplicates-only' : '',
    source.showOsuOnly === true ? 'osu-only' : '',
    source.audioFormatFilter ?? '',
  ].join('\0');
};

const pickRandom = <Item,>(items: Item[]): Item | null => items[Math.floor(Math.random() * items.length)] ?? null;

const clampMoveIndex = (index: number, length: number): number => Math.max(0, Math.min(index, length - 1));

const isCompletedPlayback = (playedSeconds: number, durationSeconds: number): boolean =>
  durationSeconds > 0 ? playedSeconds >= 30 || playedSeconds >= durationSeconds * 0.5 : playedSeconds >= 30;

const normalizeShuffleAvoidRecentCount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultShuffleAvoidRecentCount;
  }

  return Math.max(0, Math.min(maxShuffleAvoidRecentCount, Math.round(numeric)));
};

const queueSourceDisplayLabel = (source: QueueSource | null | undefined, playlistPlayback: PlaylistPlaybackInfo): string => {
  if (playlistPlayback.active) {
    return tq('queue.source.playlist.current', {
      label: playlistPlayback.label ?? tq('queue.source.playlist.default'),
    });
  }

  if (!source) {
    return tq('queue.source.manual');
  }

  if (source.type === 'songs') {
    return source.sort === 'random'
      ? tq('queue.source.songs.random')
      : tq('queue.source.songs.list', { label: source.label });
  }
  if (source.type === 'folder') {
    return source.sort === 'random'
      ? tq('queue.source.folder.random', { label: source.label })
      : tq('queue.source.folder.list', { label: source.label });
  }
  if (source.type === 'liked') {
    return tq('queue.source.liked', { label: source.label });
  }
  if (source.type === 'album') {
    return tq('queue.source.album', { label: source.label });
  }
  if (source.type === 'artist') {
    return tq('queue.source.artist', { label: source.label });
  }
  if (source.type === 'streaming') {
    return tq('queue.source.streaming', { label: source.label });
  }
  if (source.type === 'local-file') {
    return tq('queue.source.localFile', { label: source.label });
  }

  return source.label || tq('queue.source.manual');
};

const queueChromeNoticeEvent = 'app:show-chrome-notice';

export const PlaybackQueueProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const sharedPlaybackStatus = useSharedPlaybackStatusOnly();
  const initialSession = useMemo(
    () => (shouldUseLegacyPlaybackStorage() ? readLegacyPlaybackSession() : defaultHydratedPlaybackSession),
    [],
  );
  const [sessionHydrated, setSessionHydrated] = useState(shouldUseLegacyPlaybackStorage);
  const [items, setItemsState] = useState<QueueItem[]>(initialSession.items);
  const [currentQueueId, setCurrentQueueIdState] = useState<string | null>(initialSession.currentQueueId);
  const [currentTrackId, setCurrentTrackIdState] = useState<string | null>(initialSession.currentTrackId);
  const [lastPlayedTrack, setLastPlayedTrackState] = useState<LibraryTrack | null>(initialSession.lastPlayedTrack);
  const [history, setHistoryState] = useState<QueueItem[]>(initialSession.history);
  const [resumeMemory, setResumeMemoryState] = useState<PersistedPlaybackSessionResume | null>(initialSession.resume);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(initialSession.mode.isShuffleEnabled);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialSession.mode.repeatMode);
  const [automixEnabled, setAutomixEnabledState] = useState(initialSession.automixEnabled);
  const [autoFillQueueEnabled, setAutoFillQueueEnabledState] = useState(initialSession.mode.autoFillQueueEnabled);
  const [continuousPlayMode, setContinuousPlayModeState] = useState<ContinuousPlayMode>(initialSession.mode.continuousPlayMode);
  const [continuousPlayPreferences, setContinuousPlayPreferencesState] = useState<ContinuousPlayPreference[]>(initialSession.mode.continuousPlayPreferences);
  const [isContinuousPlayFilling, setIsContinuousPlayFilling] = useState(false);
  const [hqPlayerTakeoverEnabled, setHqPlayerTakeoverEnabledState] = useState(readHqPlayerTakeoverEnabled);
  const [gaplessPlaybackEnabled, setGaplessPlaybackEnabledState] = useState(false);
  const [autoPlayOnStartupEnabled, setAutoPlayOnStartupEnabled] = useState<boolean | null>(null);
  const [playbackShuffleAvoidRecentCount, setPlaybackShuffleAvoidRecentCount] = useState(defaultShuffleAvoidRecentCount);
  const [lastQueueFeedback, setLastQueueFeedback] = useState<QueueFeedback | null>(null);
  const [playlistPlaybackState, setPlaylistPlaybackState] = useState<PlaylistPlaybackState>(defaultPlaylistPlaybackState);

  const itemsRef = useRef(items);
  const currentQueueIdRef = useRef(currentQueueId);
  const currentTrackIdRef = useRef(currentTrackId);
  const lastPlayedTrackRef = useRef(lastPlayedTrack);
  const historyRef = useRef(history);
  const resumeMemoryRef = useRef(resumeMemory);
  const repeatModeRef = useRef(repeatMode);
  const automixEnabledRef = useRef(automixEnabled);
  const autoFillQueueEnabledRef = useRef(autoFillQueueEnabled);
  const continuousPlayModeRef = useRef(continuousPlayMode);
  const continuousPlayPreferencesRef = useRef(continuousPlayPreferences);
  const continuousPlayFillInFlightRef = useRef(false);
  const hqPlayerTakeoverEnabledRef = useRef(hqPlayerTakeoverEnabled);
  const gaplessPlaybackEnabledRef = useRef(gaplessPlaybackEnabled);
  const playbackShuffleAvoidRecentCountRef = useRef(playbackShuffleAvoidRecentCount);
  const queueFeedbackIdRef = useRef(0);
  const audioAnalysisEnabledRef = useRef<boolean | null>(null);
  const lowLoadPlaybackModeEnabledRef = useRef(false);
  const lowLoadPlaybackEnhancementsEnabledRef = useRef(false);
  const enhancedLowLoadPlaybackActiveRef = useRef(false);
  const latestAudioStatusRef = useRef<AudioStatus | null>(null);
  const startupAutoPlayAttemptedRef = useRef(false);
  const isShuffleEnabledRef = useRef(isShuffleEnabled);
  const playlistPlaybackStateRef = useRef(playlistPlaybackState);
  const playbackHistorySessionRef = useRef<PlaybackHistorySession | null>(null);
  const libraryShuffleDeckRef = useRef<LibraryShuffleDeck>({ sourceKey: null, items: [] });
  const pausedSessionTimerRef = useRef<number | null>(null);
  const playRequestTokenRef = useRef(0);
  const playbackStatusTokensRef = useRef<WeakMap<PlaybackStatus, number>>(new WeakMap());
  const playbackStatusPreviousItemRef = useRef<WeakMap<PlaybackStatus, QueueItem | null>>(new WeakMap());
  const cancelLocalPrepareRef = useRef<(() => void) | null>(null);
  const prepareNextMediaItemRef = useRef<(item: QueueItem) => void>(() => undefined);
  const cancelAutoSearchMvRef = useRef<(() => void) | null>(null);
  const cancelPlaybackHistoryFinishRef = useRef<(() => void) | null>(null);
  const cancelPlaybackHistoryStartRef = useRef<(() => void) | null>(null);
  const cancelAutomixBpmAnalysisPrepareRef = useRef<(() => void) | null>(null);
  const pendingAutomixBpmAnalysisTrackRef = useRef<LibraryTrack | null>(null);
  const automixBpmAnalysisJobIdsRef = useRef<Map<string, string | 'done'>>(new Map());
  const automixBpmAnalysisPollTimersRef = useRef<Map<string, number>>(new Map());
  const scheduleAutomixBpmAnalysisRef = useRef<(track: LibraryTrack) => void>(() => undefined);
  const automixShuffleNextQueueIdRef = useRef<Map<string, string>>(new Map());
  const cancelPlaybackSessionPersistRef = useRef<(() => void) | null>(null);
  const updateTrackSnapshotRef = useRef<PlaybackQueueContextValue['updateTrackSnapshot']>(() => undefined);
  const sessionHydratedRef = useRef(sessionHydrated);
  const sessionRevisionRef = useRef(initialSession.revision ?? 0);
  const applyingSessionSnapshotRef = useRef(false);
  const localSessionDirtyRef = useRef(false);
  const localMutationGenerationRef = useRef(0);
  const persistenceChainRef = useRef<Promise<void>>(Promise.resolve());
  const suppressNextSessionPersistenceRef = useRef(false);
  const lastHostQueueCommitRef = useRef<string | null>(null);
  const lastFallbackEndedIdentityRef = useRef<string | null>(null);
  const previousRemoveAfterPlayQueueIdRef = useRef(currentQueueId);
  const backendQueueSyncRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const lastBackendQueueSyncKeyRef = useRef<string | null>(null);

  const setItems = useCallback((nextItems: QueueItem[] | ((current: QueueItem[]) => QueueItem[])): void => {
    const resolved = typeof nextItems === 'function' ? nextItems(itemsRef.current) : nextItems;
    itemsRef.current = resolved;
    setItemsState(resolved);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const syncQueueSnapshotToBackend = useCallback(
    async (queueItems: BackendQueueSyncItem[], nextRepeatMode: RepeatMode, nextCurrentQueueId: string | null): Promise<void> => {
      const syncQueue = window.echo?.playback?.syncQueueToBackend;
      if (!syncQueue) {
        return;
      }

      const key = JSON.stringify([nextRepeatMode, nextCurrentQueueId, queueItems]);
      if (lastBackendQueueSyncKeyRef.current === key) {
        return;
      }

      const activeSync = backendQueueSyncRef.current;
      if (activeSync?.key === key) {
        return activeSync.promise;
      }

      const previousSync = activeSync?.promise.catch(() => undefined) ?? Promise.resolve();
      const promise = previousSync
        .then(() => syncQueue(queueItems, nextRepeatMode, nextCurrentQueueId))
        .then(() => {
          lastBackendQueueSyncKeyRef.current = key;
        })
        .finally(() => {
          if (backendQueueSyncRef.current?.promise === promise) {
            backendQueueSyncRef.current = null;
          }
        });
      backendQueueSyncRef.current = { key, promise };
      return promise;
    },
    [],
  );

  const setCurrentQueueId = useCallback((queueId: string | null): void => {
    currentQueueIdRef.current = queueId;
    setCurrentQueueIdState(queueId);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const setCurrentTrackIdInternal = useCallback((trackId: string | null): void => {
    currentTrackIdRef.current = trackId;
    setCurrentTrackIdState(trackId);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const setLastPlayedTrack = useCallback((track: LibraryTrack | null): void => {
    lastPlayedTrackRef.current = track;
    setLastPlayedTrackState(track);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.echo?.audio?.getStatus?.()
      .then((status) => {
        if (!cancelled) {
          latestAudioStatusRef.current = status;
        }
      })
      .catch(() => undefined);

    const unsubscribe = window.echo?.audio?.onStatus?.((status) => {
      latestAudioStatusRef.current = status;
    });

    return () => {
      cancelled = true;
      latestAudioStatusRef.current = null;
      unsubscribe?.();
    };
  }, []);

  const setHistory = useCallback((nextHistory: QueueItem[] | ((current: QueueItem[]) => QueueItem[])): void => {
    const resolved = typeof nextHistory === 'function' ? nextHistory(historyRef.current) : nextHistory;
    historyRef.current = resolved;
    setHistoryState(resolved);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const setPlaylistPlaybackStateInternal = useCallback((state: PlaylistPlaybackState): void => {
    playlistPlaybackStateRef.current = state;
    setPlaylistPlaybackState(state);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const setResumeMemory = useCallback((resume: PersistedPlaybackSessionResume | null): void => {
    resumeMemoryRef.current = resume;
    setResumeMemoryState(resume);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
  }, []);

  const setHqPlayerTakeoverEnabled = useCallback((enabled: boolean): void => {
    hqPlayerTakeoverEnabledRef.current = enabled;
    setHqPlayerTakeoverEnabledState(enabled);
    writeHqPlayerTakeoverEnabled(enabled);
  }, []);

  const setRepeatModeInternal = useCallback((mode: RepeatMode): void => {
    repeatModeRef.current = mode;
    setRepeatMode(mode);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: mode,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: continuousPlayPreferencesRef.current,
      });
    }
  }, []);

  const clearLibraryShuffleDeck = useCallback((): void => {
    libraryShuffleDeckRef.current = { sourceKey: null, items: [] };
  }, []);

  const publishQueueFeedback = useCallback((message: string, detail: string, tone: QueueFeedback['tone'] = 'success'): void => {
    const feedback: QueueFeedback = {
      id: queueFeedbackIdRef.current + 1,
      message,
      detail,
      tone,
    };
    queueFeedbackIdRef.current = feedback.id;
    setLastQueueFeedback(feedback);
    window.dispatchEvent(new CustomEvent(queueChromeNoticeEvent, { detail: detail ? `${message} · ${detail}` : message }));
  }, []);

  useEffect(() => {
    const estimateJsonBytes = (itemsToEstimate: QueueItem[]): { sampleBytes: number; estimatedBytes: number } => {
      if (itemsToEstimate.length === 0) {
        return { sampleBytes: 0, estimatedBytes: 0 };
      }

      const sample = itemsToEstimate.slice(0, 50);
      let sampleBytes = 0;
      try {
        sampleBytes = new Blob([JSON.stringify(sample)]).size;
      } catch {
        sampleBytes = 0;
      }

      return {
        sampleBytes,
        estimatedBytes: sampleBytes > 0 ? Math.round((sampleBytes / sample.length) * itemsToEstimate.length) : 0,
      };
    };

    window.__echoPlaybackQueueDiagnostics = {
      snapshot: () => {
        const queueSize = estimateJsonBytes(itemsRef.current);
        const historySize = estimateJsonBytes(historyRef.current);
        const currentItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);

        return {
          itemCount: itemsRef.current.length,
          historyCount: historyRef.current.length,
          playlistItemCount: playlistPlaybackStateRef.current.snapshot?.items.length,
          shuffleDeckCount: libraryShuffleDeckRef.current.items.length,
          automixAnalysisPendingCount: automixBpmAnalysisJobIdsRef.current.size,
          automixAnalysisTimerCount: automixBpmAnalysisPollTimersRef.current.size,
          currentSourceType: currentItem?.source.type ?? null,
          queueSampleJsonBytes: queueSize.sampleBytes,
          historySampleJsonBytes: historySize.sampleBytes,
          estimatedQueueJsonBytes: queueSize.estimatedBytes,
          estimatedHistoryJsonBytes: historySize.estimatedBytes,
        };
      },
    };

    return () => {
      delete window.__echoPlaybackQueueDiagnostics;
    };
  }, []);

  const toggleShuffle = useCallback((): void => {
    const next = !isShuffleEnabledRef.current;
    clearLibraryShuffleDeck();
    isShuffleEnabledRef.current = next;
    setIsShuffleEnabled(next);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (next) {
      const activeItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      const scope = queueSourceDisplayLabel(activeItem?.source, playlistPlaybackStateRef.current);
      publishQueueFeedback(
        tq('queue.feedback.shuffleOn', { scope }),
        tq('queue.feedback.avoidRecent', { count: playbackShuffleAvoidRecentCountRef.current }),
        'info',
      );
    }
    if (next && repeatModeRef.current === 'all') {
      setRepeatModeInternal('off');
    } else if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: next,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: continuousPlayPreferencesRef.current,
      });
    }
  }, [clearLibraryShuffleDeck, publishQueueFeedback, setRepeatModeInternal]);

  const setAutoFillQueueEnabled = useCallback((enabled: boolean): void => {
    autoFillQueueEnabledRef.current = enabled;
    setAutoFillQueueEnabledState(enabled);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: enabled,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: continuousPlayPreferencesRef.current,
      });
    }
  }, []);

  const setContinuousPlayMode = useCallback((mode: ContinuousPlayMode): void => {
    continuousPlayModeRef.current = mode;
    setContinuousPlayModeState(mode);
    setItems((current) => current.filter((item) =>
      item.source.type !== 'continuous-play' || item.queueId === currentQueueIdRef.current));
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: mode,
        continuousPlayPreferences: continuousPlayPreferencesRef.current,
      });
    }
  }, [setItems]);

  const reduceContinuousPlayFrequency = useCallback((kind: ContinuousPlayPreferenceKind, value: string): void => {
    const normalizedValue = value.normalize('NFKC').trim();
    if (!normalizedValue) {
      return;
    }
    const next = [
      ...continuousPlayPreferencesRef.current.filter((item) =>
        item.kind !== kind || item.value.normalize('NFKC').trim().toLocaleLowerCase() !== normalizedValue.toLocaleLowerCase()),
      { kind, value: normalizedValue, weight: 0.35 },
    ].slice(-200);
    continuousPlayPreferencesRef.current = next;
    setContinuousPlayPreferencesState(next);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: next,
      });
    }
  }, []);

  const clearContinuousPlayPreferences = useCallback((): void => {
    continuousPlayPreferencesRef.current = [];
    setContinuousPlayPreferencesState([]);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: [],
      });
    }
  }, []);

  const setAutomixEnabled = useCallback((enabled: boolean): void => {
    automixEnabledRef.current = enabled;
    setAutomixEnabledState(enabled);
    if (sessionHydratedRef.current && !applyingSessionSnapshotRef.current) {
      localSessionDirtyRef.current = true;
      localMutationGenerationRef.current += 1;
    }
    writeAutomixEnabledMemory(enabled);
    if (enabled) {
      const currentItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      if (currentItem) {
        prepareNextMediaItemRef.current(currentItem);
      }
    }
  }, []);

  const applyHydratedPlaybackSession = useCallback(
    (session: HydratedPlaybackSession): void => {
      applyingSessionSnapshotRef.current = true;
      try {
        sessionRevisionRef.current = session.revision ?? 0;
        setItems(session.items);
        setHistory(session.history);
        setCurrentQueueId(session.currentQueueId);
        setCurrentTrackIdInternal(session.currentTrackId);
        setLastPlayedTrack(session.lastPlayedTrack);
        setResumeMemory(session.resume);
        isShuffleEnabledRef.current = session.mode.isShuffleEnabled;
        setIsShuffleEnabled(session.mode.isShuffleEnabled);
        repeatModeRef.current = session.mode.repeatMode;
        setRepeatMode(session.mode.repeatMode);
        autoFillQueueEnabledRef.current = session.mode.autoFillQueueEnabled;
        setAutoFillQueueEnabledState(session.mode.autoFillQueueEnabled);
        continuousPlayModeRef.current = session.mode.continuousPlayMode;
        setContinuousPlayModeState(session.mode.continuousPlayMode);
        continuousPlayPreferencesRef.current = session.mode.continuousPlayPreferences;
        setContinuousPlayPreferencesState(session.mode.continuousPlayPreferences);
        const hydratedAutomixEnabled = canRestoreAutomixEnabled(session.automixEnabled);
        automixEnabledRef.current = hydratedAutomixEnabled;
        setAutomixEnabledState(hydratedAutomixEnabled);
        setPlaylistPlaybackStateInternal(session.playlistPlayback ?? defaultPlaylistPlaybackState);
        localSessionDirtyRef.current = false;
      } finally {
        applyingSessionSnapshotRef.current = false;
      }
    },
    [setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setItems, setLastPlayedTrack, setPlaylistPlaybackStateInternal, setResumeMemory],
  );

  const createPlaylistPlaybackSnapshot = useCallback((): PlaylistPlaybackSnapshot => ({
    items: itemsRef.current,
    history: historyRef.current,
    currentQueueId: currentQueueIdRef.current,
    currentTrackId: currentTrackIdRef.current,
    lastPlayedTrack: lastPlayedTrackRef.current,
    resume: resumeMemoryRef.current,
    mode: {
      isShuffleEnabled: isShuffleEnabledRef.current,
      repeatMode: repeatModeRef.current,
      autoFillQueueEnabled: autoFillQueueEnabledRef.current,
      continuousPlayMode: continuousPlayModeRef.current,
      continuousPlayPreferences: continuousPlayPreferencesRef.current,
    },
    automixEnabled: automixTemporarilyDisabled ? false : automixEnabledRef.current,
  }), []);

  const applyPlaylistPlaybackSnapshot = useCallback(
    (snapshot: PlaylistPlaybackSnapshot): void => {
      setItems(snapshot.items);
      setHistory(snapshot.history);
      setCurrentQueueId(snapshot.currentQueueId);
      setCurrentTrackIdInternal(snapshot.currentTrackId);
      setLastPlayedTrack(snapshot.lastPlayedTrack);
      setResumeMemory(snapshot.resume);
      isShuffleEnabledRef.current = snapshot.mode.isShuffleEnabled;
      setIsShuffleEnabled(snapshot.mode.isShuffleEnabled);
      repeatModeRef.current = snapshot.mode.repeatMode;
      setRepeatMode(snapshot.mode.repeatMode);
      autoFillQueueEnabledRef.current = snapshot.mode.autoFillQueueEnabled;
      setAutoFillQueueEnabledState(snapshot.mode.autoFillQueueEnabled);
      continuousPlayModeRef.current = snapshot.mode.continuousPlayMode;
      setContinuousPlayModeState(snapshot.mode.continuousPlayMode);
      continuousPlayPreferencesRef.current = snapshot.mode.continuousPlayPreferences;
      setContinuousPlayPreferencesState(snapshot.mode.continuousPlayPreferences);
      const nextAutomixEnabled = canRestoreAutomixEnabled(snapshot.automixEnabled);
      automixEnabledRef.current = nextAutomixEnabled;
      setAutomixEnabledState(nextAutomixEnabled);
    },
    [setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setItems, setLastPlayedTrack, setResumeMemory],
  );

  const restorePlaylistPlaybackSnapshotOnly = useCallback((): PlaylistPlaybackSnapshot | null => {
    const playlistState = playlistPlaybackStateRef.current;
    if (!playlistState.active || !playlistState.snapshot) {
      return null;
    }

    setPlaylistPlaybackStateInternal(defaultPlaylistPlaybackState);
    applyPlaylistPlaybackSnapshot(playlistState.snapshot);
    return playlistState.snapshot;
  }, [applyPlaylistPlaybackSnapshot, setPlaylistPlaybackStateInternal]);

  const createCurrentPersistedSession = useCallback((): PersistedPlaybackSessionV1 => {
    const playlistSnapshot = playlistPlaybackStateRef.current.active ? playlistPlaybackStateRef.current.snapshot : null;
    const session: HydratedPlaybackSession = playlistSnapshot
      ? {
          version: 1,
          revision: sessionRevisionRef.current,
          items: playlistSnapshot.items,
          currentQueueId: playlistSnapshot.currentQueueId,
          currentTrackId: playlistSnapshot.currentTrackId,
          lastPlayedTrack: playlistSnapshot.lastPlayedTrack,
          history: playlistSnapshot.history,
          resume: playlistSnapshot.resume,
          mode: playlistSnapshot.mode,
          automixEnabled: playlistSnapshot.automixEnabled,
          playlistPlayback: null,
        }
      : {
          version: 1,
          revision: sessionRevisionRef.current,
          items: itemsRef.current,
          currentQueueId: currentQueueIdRef.current,
          currentTrackId: currentTrackIdRef.current,
          lastPlayedTrack: lastPlayedTrackRef.current,
          history: historyRef.current,
          resume: resumeMemoryRef.current,
          mode: {
            isShuffleEnabled: isShuffleEnabledRef.current,
            repeatMode: repeatModeRef.current,
            autoFillQueueEnabled: autoFillQueueEnabledRef.current,
            continuousPlayMode: continuousPlayModeRef.current,
            continuousPlayPreferences: continuousPlayPreferencesRef.current,
          },
          automixEnabled: automixTemporarilyDisabled ? false : automixEnabledRef.current,
          playlistPlayback: null,
        };

    return createPersistedSessionSnapshot(session);
  }, []);

  const createCurrentBroadcastSession = useCallback((): PersistedPlaybackSessionV1 => {
    const playlistState = playlistPlaybackStateRef.current;
    return createPersistedSessionSnapshot({
      version: 1,
      revision: sessionRevisionRef.current,
      items: itemsRef.current,
      currentQueueId: currentQueueIdRef.current,
      currentTrackId: currentTrackIdRef.current,
      lastPlayedTrack: lastPlayedTrackRef.current,
      history: historyRef.current,
      resume: resumeMemoryRef.current,
      mode: {
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
        continuousPlayMode: continuousPlayModeRef.current,
        continuousPlayPreferences: continuousPlayPreferencesRef.current,
      },
      automixEnabled: automixTemporarilyDisabled ? false : automixEnabledRef.current,
      playlistPlayback: playlistState.active && playlistState.snapshot ? playlistState : null,
    });
  }, []);

  const persistPlaybackSessionNow = useCallback(async (): Promise<void> => {
    if (!sessionHydratedRef.current) {
      return;
    }

    const playback = window.echo?.playback;
    if (!playback?.saveQueueSession) {
      const snapshot = createCurrentPersistedSession();
      writePlaybackQueueMemory(snapshot);
      writePlaybackModeMemory({
        isShuffleEnabled: snapshot.mode.isShuffleEnabled,
        repeatMode: snapshot.mode.repeatMode,
        autoFillQueueEnabled: snapshot.mode.autoFillQueueEnabled === true,
        continuousPlayMode: isContinuousPlayMode(snapshot.mode.continuousPlayMode) ? snapshot.mode.continuousPlayMode : 'similar',
        continuousPlayPreferences: normalizeContinuousPlayPreferences(snapshot.mode.continuousPlayPreferences),
      });
      writeAutomixEnabledMemory(snapshot.mode.automixEnabled);
      localSessionDirtyRef.current = false;
      return;
    }

    const runPersistence = async (): Promise<void> => {
      const snapshot = createCurrentPersistedSession();
      const broadcastSnapshot = createCurrentBroadcastSession();
      const expectedRevision = sessionRevisionRef.current;
      const mutationGeneration = localMutationGenerationRef.current;
      try {
        const saved = await playback.saveQueueSession(snapshot, {
          broadcastSnapshot,
          expectedRevision,
        });
        sessionRevisionRef.current = saved.revision ?? expectedRevision + 1;
        if (localMutationGenerationRef.current === mutationGeneration) {
          localSessionDirtyRef.current = false;
        }
        const savedResume = playbackSessionFromPersisted(saved).resume;
        if (resumeMemoryRef.current && !savedResume) {
          setResumeMemory(null);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('playback_queue_session_conflict')) {
          const authoritative = await playback.getQueueSession?.().catch(() => null);
          if (authoritative) {
            applyHydratedPlaybackSession(playbackSessionFromPersisted(authoritative));
            publishQueueFeedback(
              '队列已从另一播放窗口更新',
              '当前窗口的过期修改未覆盖最新队列',
              'info',
            );
          }
        }
        // Persistence failures should not interrupt playback controls.
      }
    };

    const queued = persistenceChainRef.current.then(runPersistence, runPersistence);
    persistenceChainRef.current = queued.catch(() => undefined);
    await queued;
  }, [applyHydratedPlaybackSession, createCurrentBroadcastSession, createCurrentPersistedSession, publishQueueFeedback, setResumeMemory]);

  const setPlaybackOrder = useCallback(async (mode: PlaybackOrderMode): Promise<void> => {
    const nextRepeatMode: RepeatMode = mode === 'repeat-one' ? 'one' : 'off';
    const nextShuffleEnabled = mode === 'shuffle';

    if (repeatModeRef.current !== nextRepeatMode) {
      setRepeatModeInternal(nextRepeatMode);
    }
    if (isShuffleEnabledRef.current !== nextShuffleEnabled) {
      toggleShuffle();
    }

    await persistPlaybackSessionNow();
  }, [persistPlaybackSessionNow, setRepeatModeInternal, toggleShuffle]);

  const cancelScheduledPlaybackSessionPersistence = useCallback((): void => {
    cancelPlaybackSessionPersistRef.current?.();
    cancelPlaybackSessionPersistRef.current = null;
  }, []);

  const schedulePlaybackSessionPersistence = useCallback((): void => {
    if (!sessionHydratedRef.current) {
      return;
    }

    cancelScheduledPlaybackSessionPersistence();
    cancelPlaybackSessionPersistRef.current = deferQueueBackgroundTask(() => {
      cancelPlaybackSessionPersistRef.current = null;
      void runQueuePlaybackStep('playLocalTrack', 'saveQueueSession', currentTrackIdRef.current, () => persistPlaybackSessionNow());
    }, { delayMs: postSwitchBackgroundDelayMs });
  }, [cancelScheduledPlaybackSessionPersistence, persistPlaybackSessionNow]);

  const applyPlaybackSettings = useCallback((settings: Partial<AppSettings> | null | undefined): void => {
    if (!settings) {
      return;
    }

    if ('gaplessPlaybackEnabled' in settings) {
      const enabled = settings.gaplessPlaybackEnabled === true;
      gaplessPlaybackEnabledRef.current = enabled;
      setGaplessPlaybackEnabledState(enabled);
    }

    if ('autoPlayOnStartup' in settings) {
      setAutoPlayOnStartupEnabled(settings.autoPlayOnStartup === true);
    }

    if ('playbackShuffleAvoidRecentCount' in settings) {
      const nextCount = normalizeShuffleAvoidRecentCount(settings.playbackShuffleAvoidRecentCount);
      playbackShuffleAvoidRecentCountRef.current = nextCount;
      setPlaybackShuffleAvoidRecentCount(nextCount);
      clearLibraryShuffleDeck();
    }

    if ('audioAnalysisEnabled' in settings) {
      audioAnalysisEnabledRef.current = settings.audioAnalysisEnabled !== false;
      if (!audioAnalysisEnabledRef.current) {
        pendingAutomixBpmAnalysisTrackRef.current = null;
      } else {
        const pendingTrack = pendingAutomixBpmAnalysisTrackRef.current;
        pendingAutomixBpmAnalysisTrackRef.current = null;
        if (pendingTrack) {
          scheduleAutomixBpmAnalysisRef.current(pendingTrack);
        }
      }
    }

    if ('lowLoadPlaybackModeEnabled' in settings) {
      lowLoadPlaybackModeEnabledRef.current = settings.lowLoadPlaybackModeEnabled === true;
    }

    if ('lowLoadPlaybackEnhancementsEnabled' in settings) {
      lowLoadPlaybackEnhancementsEnabledRef.current = settings.lowLoadPlaybackEnhancementsEnabled === true;
    }

    if ('lowLoadPlaybackModeEnabled' in settings || 'lowLoadPlaybackEnhancementsEnabled' in settings) {
      enhancedLowLoadPlaybackActiveRef.current =
        lowLoadPlaybackModeEnabledRef.current && lowLoadPlaybackEnhancementsEnabledRef.current;
      if (enhancedLowLoadPlaybackActiveRef.current) {
        cancelLocalPrepareRef.current?.();
        cancelLocalPrepareRef.current = null;
        cancelAutoSearchMvRef.current?.();
        cancelAutoSearchMvRef.current = null;
      }
    }
  }, [clearLibraryShuffleDeck]);

  const setGaplessPlaybackEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.setSettings) {
      throw new Error('Desktop bridge unavailable.');
    }

    const settings = await app.setSettings({ gaplessPlaybackEnabled: enabled });
    applyPlaybackSettings(settings);
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings }));
  }, [applyPlaybackSettings]);

  useEffect(() => {
    let cancelled = false;
    void window.echo?.app?.getSettings?.()
      .then((settings) => {
        if (!cancelled) {
          applyPlaybackSettings(settings);
        }
      })
      .catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      if (
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail === 'object' &&
        (
          'gaplessPlaybackEnabled' in event.detail ||
          'autoPlayOnStartup' in event.detail ||
          'playbackShuffleAvoidRecentCount' in event.detail ||
          'audioAnalysisEnabled' in event.detail ||
          'lowLoadPlaybackModeEnabled' in event.detail ||
          'lowLoadPlaybackEnhancementsEnabled' in event.detail
        )
      ) {
        applyPlaybackSettings(event.detail as Partial<AppSettings>);
        return;
      }

      void window.echo?.app?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            applyPlaybackSettings(settings);
          }
        })
        .catch(() => undefined);
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, [applyPlaybackSettings]);

  useEffect(() => () => {
    cancelAutomixBpmAnalysisPrepareRef.current?.();
    cancelAutomixBpmAnalysisPrepareRef.current = null;
    pendingAutomixBpmAnalysisTrackRef.current = null;
    for (const timer of automixBpmAnalysisPollTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    automixBpmAnalysisPollTimersRef.current.clear();
  }, []);

  useEffect(() => {
    sessionHydratedRef.current = sessionHydrated;
  }, [sessionHydrated]);

  useEffect(() => {
    const playback = window.echo?.playback;
    if (!playback?.getQueueSession || !playback.saveQueueSession) {
      sessionHydratedRef.current = true;
      setSessionHydrated(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      const persistedSession = await playback.getQueueSession?.().catch(() => null);
      if (cancelled) {
        return;
      }

      if (persistedSession) {
        applyHydratedPlaybackSession(playbackSessionFromPersisted(persistedSession));
      } else {
        const legacySession = readLegacyPlaybackSession();
        if (hasLegacyPlaybackSession(legacySession)) {
          applyHydratedPlaybackSession(legacySession);
          const migrated = await playback.saveQueueSession?.(createPersistedSessionSnapshot(legacySession)).catch(() => null);
          if (migrated) {
            sessionRevisionRef.current = migrated.revision ?? sessionRevisionRef.current;
          }
          clearLegacyPlaybackMemory();
        }
      }

      if (!cancelled) {
        sessionHydratedRef.current = true;
        setSessionHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyHydratedPlaybackSession]);

  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }

    if (suppressNextSessionPersistenceRef.current) {
      suppressNextSessionPersistenceRef.current = false;
      return;
    }

    schedulePlaybackSessionPersistence();

    return () => {
      cancelScheduledPlaybackSessionPersistence();
    };
  }, [
    autoFillQueueEnabled,
    automixEnabled,
    cancelScheduledPlaybackSessionPersistence,
    continuousPlayMode,
    continuousPlayPreferences,
    currentQueueId,
    currentTrackId,
    history,
    items,
    lastPlayedTrack,
    repeatMode,
    resumeMemory,
    schedulePlaybackSessionPersistence,
    sessionHydrated,
    isShuffleEnabled,
  ]);

  useEffect(() => {
    const unsubscribe = window.echo?.playback?.onQueueSessionChanged?.((snapshot) => {
      const incomingRevision = snapshot?.revision ?? 0;
      if (snapshot?.revision !== undefined && incomingRevision <= sessionRevisionRef.current) {
        return;
      }
      if (snapshot && localSessionDirtyRef.current) {
        void persistPlaybackSessionNow();
        return;
      }
      suppressNextSessionPersistenceRef.current = true;
      applyHydratedPlaybackSession(playbackSessionFromPersisted(snapshot));
      sessionHydratedRef.current = true;
      setSessionHydrated(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, [applyHydratedPlaybackSession, persistPlaybackSessionNow]);

  useEffect(() => {
    const flush = (): void => {
      cancelScheduledPlaybackSessionPersistence();
      void persistPlaybackSessionNow();
    };

    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [cancelScheduledPlaybackSessionPersistence, persistPlaybackSessionNow]);

  useEffect(() => {
    const unsubscribe = window.echo?.connect?.onReceiverStatus?.((status) => {
      if (status.enabled && isActiveReceiverStatus(status)) {
        const currentTrack =
          findItemByQueueId(itemsRef.current, currentQueueIdRef.current)?.track ??
          (currentTrackIdRef.current ? itemsRef.current.find((item) => item.track.id === currentTrackIdRef.current)?.track ?? null : null) ??
          (lastPlayedTrackRef.current?.id === currentTrackIdRef.current ? lastPlayedTrackRef.current : null);
        if (localTrackMatchesReceiverIdentity(currentTrack, status.currentUri)) {
          return;
        }

        const receiverTrack = createReceiverTrackSnapshot(status);
        if (!receiverTrack) {
          return;
        }
        if (currentQueueIdRef.current !== null) {
          setCurrentQueueId(null);
        }
        if (!isSameReceiverTrackSnapshot(lastPlayedTrackRef.current, receiverTrack)) {
          setLastPlayedTrack(receiverTrack);
        }
        if (currentTrackIdRef.current !== receiverTrack.id) {
          setCurrentTrackIdInternal(receiverTrack.id);
        }
        setPlaybackStatusSnapshot({
          playbackStatus: {
            state: receiverStatusToPlaybackState(status),
            currentTrackId: receiverTrack.id,
            positionMs: Math.round(status.positionSeconds * 1000),
            durationMs: Math.round((status.durationSeconds || receiverTrack.duration) * 1000),
            filePath: receiverTrack.path,
          },
          error: status.error,
        });
        return;
      }

      if (currentTrackIdRef.current?.startsWith(receiverTrackIdPrefix)) {
        setCurrentQueueId(null);
        setCurrentTrackIdInternal(null);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [setCurrentQueueId, setCurrentTrackIdInternal, setLastPlayedTrack]);

  useEffect(() => {
    const unsubscribe = window.echo?.connect?.onAirPlayReceiverStatus?.((status) => {
      if (status.enabled && isActiveAirPlayReceiverStatus(status)) {
        const currentTrack =
          findItemByQueueId(itemsRef.current, currentQueueIdRef.current)?.track ??
          (currentTrackIdRef.current ? itemsRef.current.find((item) => item.track.id === currentTrackIdRef.current)?.track ?? null : null) ??
          (lastPlayedTrackRef.current?.id === currentTrackIdRef.current ? lastPlayedTrackRef.current : null);
        if (localTrackMatchesReceiverIdentity(currentTrack, status.currentSourceId)) {
          return;
        }

        const airPlayTrack = createAirPlayTrackSnapshot(status);
        if (!airPlayTrack) {
          return;
        }
        if (currentQueueIdRef.current !== null) {
          setCurrentQueueId(null);
        }
        if (!isSameReceiverTrackSnapshot(lastPlayedTrackRef.current, airPlayTrack)) {
          setLastPlayedTrack(airPlayTrack);
        }
        if (currentTrackIdRef.current !== airPlayTrack.id) {
          setCurrentTrackIdInternal(airPlayTrack.id);
        }
        setPlaybackStatusSnapshot({
          playbackStatus: {
            state: airPlayStatusToPlaybackState(status),
            currentTrackId: airPlayTrack.id,
            positionMs: Math.round(status.positionSeconds * 1000),
            durationMs: Math.round((status.durationSeconds || airPlayTrack.duration) * 1000),
            filePath: airPlayTrack.path,
          },
          error: status.error,
        });
        return;
      }

      if (currentTrackIdRef.current?.startsWith(airPlayReceiverTrackIdPrefix)) {
        setCurrentQueueId(null);
        setCurrentTrackIdInternal(null);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [setCurrentQueueId, setCurrentTrackIdInternal, setLastPlayedTrack]);

  useEffect(() => {
    const unsubscribe = window.echo?.connect?.onStatus?.((status) => {
      if (!isActiveConnectPlaybackStatus(status) || !status.currentTrackId) {
        return;
      }

      const item = itemsRef.current.find((candidate) => candidate.track.id === status.currentTrackId);
      if (!item) {
        if (currentTrackIdRef.current !== status.currentTrackId) {
          setCurrentQueueId(null);
          setCurrentTrackIdInternal(status.currentTrackId);
        }
        return;
      }

      if (currentQueueIdRef.current !== item.queueId) {
        setCurrentQueueId(item.queueId);
      }
      if (currentTrackIdRef.current !== item.track.id) {
        setCurrentTrackIdInternal(item.track.id);
      }
      if (lastPlayedTrackRef.current?.id !== item.track.id) {
        setLastPlayedTrack(item.track);
      }
      setPlaybackStatusSnapshot({
        audioStatus: null,
        playbackStatus: playbackStatusFromConnectStatus(status, item),
        playbackVisualIntent: null,
        error: status.error,
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [setCurrentQueueId, setCurrentTrackIdInternal, setLastPlayedTrack]);

  const currentItem = useMemo(() => findItemByQueueId(items, currentQueueId), [currentQueueId, items]);
  const currentTrack = useMemo(() => {
    if (currentItem) {
      return currentItem.track;
    }

    const queuedTrack = currentTrackId ? items.find((item) => item.track.id === currentTrackId)?.track : null;

    return queuedTrack ?? (lastPlayedTrack?.id === currentTrackId ? lastPlayedTrack : null);
  }, [currentItem, currentTrackId, items, lastPlayedTrack]);

  useEffect(() => {
    const previousQueueId = previousRemoveAfterPlayQueueIdRef.current;
    previousRemoveAfterPlayQueueIdRef.current = currentQueueId;
    if (!previousQueueId || previousQueueId === currentQueueId) {
      return;
    }

    const previousItem = itemsRef.current.find((item) => item.queueId === previousQueueId);
    if (previousItem?.removeAfterPlay !== true) {
      return;
    }

    setItems((current) => current.filter((item) => item.queueId !== previousQueueId));
    setHistory((current) => current.filter((item) => item.queueId !== previousQueueId));
  }, [currentQueueId, setHistory, setItems]);
  const playlistPlaybackSummary = useMemo<PlaylistPlaybackInfo>(
    () => ({
      active: playlistPlaybackState.active,
      label: playlistPlaybackState.label,
      playlistId: playlistPlaybackState.playlistId,
    }),
    [playlistPlaybackState.active, playlistPlaybackState.label, playlistPlaybackState.playlistId],
  );
  const currentSourceLabel = useMemo(
    () => queueSourceDisplayLabel(currentItem?.source, playlistPlaybackSummary),
    [currentItem?.source, playlistPlaybackSummary],
  );
  const shuffleScopeLabel = currentSourceLabel;

  const clearPausedSessionTimer = useCallback((): void => {
    if (pausedSessionTimerRef.current !== null) {
      window.clearTimeout(pausedSessionTimerRef.current);
      pausedSessionTimerRef.current = null;
    }
  }, []);

  const accumulatePlaybackSeconds = useCallback((session: PlaybackHistorySession, nowMs = Date.now()): number => {
    if (session.isPlaying && session.lastResumedAtMs !== null) {
      session.playedSeconds += Math.max(0, (nowMs - session.lastResumedAtMs) / 1000);
      session.lastResumedAtMs = nowMs;
    }

    return session.playedSeconds;
  }, []);

  const takePlaybackHistoryFinishRecord = useCallback(
    (completedOverride?: boolean): PlaybackHistoryFinishRecord | null => {
      const session = playbackHistorySessionRef.current;

      if (!session || session.isFinishing) {
        return null;
      }

      clearPausedSessionTimer();
      session.isFinishing = true;
      const playedSeconds = accumulatePlaybackSeconds(session);
      const completed = completedOverride ?? isCompletedPlayback(playedSeconds, session.track.duration);
      playbackHistorySessionRef.current = null;

      return {
        historyId: session.historyId,
        track: session.track,
        playedSeconds,
        completed,
      };
    },
    [accumulatePlaybackSeconds, clearPausedSessionTimer],
  );

  const finishPlaybackHistoryRecord = useCallback(async (record: PlaybackHistoryFinishRecord): Promise<void> => {
    try {
      await window.echo?.library?.finishPlaybackHistory?.({
        historyId: record.historyId,
        playedSeconds: record.playedSeconds,
        durationSeconds: record.track.duration > 0 ? record.track.duration : undefined,
        completed: record.completed,
      });
      window.dispatchEvent(new Event(playbackHistoryChangedEvent));
    } catch {
      // History writes should never interrupt playback controls.
    }
  }, []);

  const finishPlaybackHistorySession = useCallback(
    async (completedOverride?: boolean): Promise<void> => {
      const record = takePlaybackHistoryFinishRecord(completedOverride);
      if (!record) {
        return;
      }

      await finishPlaybackHistoryRecord(record);
    },
    [finishPlaybackHistoryRecord, takePlaybackHistoryFinishRecord],
  );

  const startPlaybackHistorySession = useCallback(async (item: QueueItem): Promise<void> => {
    const library = window.echo?.library;

    if (!library?.startPlaybackHistory) {
      return;
    }

    try {
      const isStreamingTrack = item.track.mediaType === 'streaming';
      const result = await library.startPlaybackHistory(
        isStreamingTrack
          ? {
              trackId: null,
              mediaType: 'streaming',
              provider: item.track.provider,
              providerTrackId: item.track.providerTrackId,
              stableKey: item.track.stableKey,
              trackPath: item.track.stableKey ?? item.track.id,
              title: item.track.title,
              artist: item.track.artist,
              album: item.track.album,
              albumArtist: item.track.albumArtist,
              coverId: item.track.coverId,
              coverSnapshot: item.track.coverThumb,
              durationSeconds: item.track.duration,
              sourceType: 'streaming',
              sourceLabel: item.source.label,
              queueId: item.queueId,
            }
          : item.track.isTemporary
          ? {
              trackId: null,
              trackPath: item.track.path,
              title: item.track.title,
              artist: item.track.artist,
              album: item.track.album,
              albumArtist: item.track.albumArtist,
              coverId: item.track.coverId,
              durationSeconds: item.track.duration,
              sourceType: item.source.type,
              sourceLabel: item.source.label,
              queueId: item.queueId,
            }
          : {
              trackId: item.track.id,
              mediaType: item.track.mediaType,
              sourceId: item.track.sourceId,
              stableKey: item.track.stableKey,
              remotePath: item.track.remotePath,
              sourceType: item.source.type,
              sourceLabel: item.source.label,
              queueId: item.queueId,
            },
      );
      const nowMs = Date.now();
      playbackHistorySessionRef.current = {
        historyId: result.historyId,
        track: item.track,
        startedAtMs: nowMs,
        lastResumedAtMs: nowMs,
        playedSeconds: 0,
        isPlaying: true,
        isFinishing: false,
      };
      window.dispatchEvent(new Event(playbackHistoryChangedEvent));
    } catch {
      playbackHistorySessionRef.current = null;
    }
  }, []);

  const schedulePlaybackHistoryFinish = useCallback(
    (completedOverride?: boolean): void => {
      const record = takePlaybackHistoryFinishRecord(completedOverride);
      if (!record) {
        return;
      }

      cancelPlaybackHistoryFinishRef.current = deferQueueBackgroundTask(() => {
        cancelPlaybackHistoryFinishRef.current = null;
        void runQueuePlaybackStep('playLocalTrack', 'finishPlaybackHistorySession', record.track.id, () =>
          finishPlaybackHistoryRecord(record),
        );
      }, { delayMs: postSwitchBackgroundDelayMs });
    },
    [finishPlaybackHistoryRecord, takePlaybackHistoryFinishRecord],
  );

  const schedulePlaybackHistoryStart = useCallback((item: QueueItem): void => {
    cancelPlaybackHistoryStartRef.current?.();
    cancelPlaybackHistoryStartRef.current = deferQueueBackgroundTask(() => {
      cancelPlaybackHistoryStartRef.current = null;
      void runQueuePlaybackStep('playLocalTrack', 'startPlaybackHistorySession', item.track.id, () =>
        startPlaybackHistorySession(item),
      );
    }, { delayMs: postSwitchBackgroundDelayMs });
  }, [startPlaybackHistorySession]);

  const syncPlaybackState = useCallback(
    (state: AudioPlaybackState): void => {
      const session = playbackHistorySessionRef.current;

      if (!session) {
        return;
      }

      if (state === 'playing') {
        clearPausedSessionTimer();
        if (!session.isPlaying) {
          session.isPlaying = true;
          session.lastResumedAtMs = Date.now();
        }
        return;
      }

      if (state === 'paused' || state === 'loading') {
        accumulatePlaybackSeconds(session);
        session.isPlaying = false;
        session.lastResumedAtMs = null;
        clearPausedSessionTimer();
        pausedSessionTimerRef.current = window.setTimeout(() => {
          void finishPlaybackHistorySession();
        }, pausedSessionTimeoutMs);
        return;
      }

      if (state === 'idle' || state === 'stopped' || state === 'ended' || state === 'error') {
        void finishPlaybackHistorySession(state === 'ended' ? true : undefined);
      }
    },
    [accumulatePlaybackSeconds, clearPausedSessionTimer, finishPlaybackHistorySession],
  );

  useEffect(() => {
    const flushCurrentSession = (): void => {
      void finishPlaybackHistorySession();
    };

    window.addEventListener('beforeunload', flushCurrentSession);
    return () => {
      window.removeEventListener('beforeunload', flushCurrentSession);
      flushCurrentSession();
    };
  }, [finishPlaybackHistorySession]);

  useEffect(() => () => {
    cancelLocalPrepareRef.current?.();
    cancelLocalPrepareRef.current = null;
    cancelAutoSearchMvRef.current?.();
    cancelAutoSearchMvRef.current = null;
    cancelPlaybackHistoryFinishRef.current?.();
    cancelPlaybackHistoryFinishRef.current = null;
    cancelPlaybackHistoryStartRef.current?.();
    cancelPlaybackHistoryStartRef.current = null;
  }, []);

  const getStableShuffleAutomixNextItem = useCallback((item: QueueItem): QueueItem | null => {
    const current = itemsRef.current;
    const cachedQueueId = automixShuffleNextQueueIdRef.current.get(item.queueId) ?? null;
    const cached = cachedQueueId ? findItemByQueueId(current, cachedQueueId) : null;
    const historyQueueIds = new Set(historyRef.current.map((historyItem) => historyItem.queueId));
    if (
      cached &&
      cached.queueId !== item.queueId &&
      !historyQueueIds.has(cached.queueId) &&
      isLocalAutomixCandidate(cached.track)
    ) {
      return cached;
    }

    const next = resolveShuffleAutomixNextItem(
      current,
      item,
      historyRef.current,
      repeatModeRef.current,
      playbackShuffleAvoidRecentCountRef.current,
    );
    if (next) {
      automixShuffleNextQueueIdRef.current.set(item.queueId, next.queueId);
    } else {
      automixShuffleNextQueueIdRef.current.delete(item.queueId);
    }

    return next;
  }, []);

  const createAutomixOptions = useCallback((item: QueueItem): {
    enabled: boolean;
    maxTransitionSeconds: number;
    beatAlignEnabled: boolean;
    nextItem: PlayableTrack | null;
    nextProbe?: ReturnType<typeof createProbeFromTrack>;
    upcomingItems?: PlayableTrack[];
    upcomingProbes?: ReturnType<typeof createProbeFromTrack>[];
  } | undefined => {
    if (!automixEnabledRef.current || repeatModeRef.current === 'one') {
      return undefined;
    }
    const current = itemsRef.current;
    const index = current.findIndex((candidate) => candidate.queueId === item.queueId);
    const next = isShuffleEnabledRef.current
      ? getStableShuffleAutomixNextItem(item)
      : resolveSequentialAutomixNextItem(current, item, repeatModeRef.current);
    if (!next || isSpotifyTrack(item.track) || !isAutomixQueueCandidate(next.track)) {
      return undefined;
    }
    const upcoming = isShuffleEnabledRef.current
      ? []
      : current
          .slice(index + 2)
          .filter((candidate) => isAutomixQueueCandidate(candidate.track))
          .slice(0, 2);
    return {
      enabled: true,
      maxTransitionSeconds: 16,
      beatAlignEnabled: true,
      nextItem: toPlayableTrack(next.track),
      nextProbe: createProbeFromTrack(next.track),
      ...(upcoming.length > 0
        ? {
            upcomingItems: upcoming.map((candidate) => toPlayableTrack(candidate.track)),
            upcomingProbes: upcoming.map((candidate) => createProbeFromTrack(candidate.track)),
          }
        : {}),
    };
  }, [getStableShuffleAutomixNextItem]);

  const createGaplessOptions = useCallback((item: QueueItem, output?: Pick<AudioOutputSettings, 'playbackRate'>): {
    enabled: boolean;
    nextItem: PlayableTrack | null;
    nextProbe?: ReturnType<typeof createProbeFromTrack>;
    upcomingItems?: PlayableTrack[];
    upcomingProbes?: ReturnType<typeof createProbeFromTrack>[];
  } | undefined => {
    const playbackRate = typeof output?.playbackRate === 'number' && Number.isFinite(output.playbackRate) ? output.playbackRate : 1;
    if (
      !gaplessPlaybackEnabledRef.current ||
      automixEnabledRef.current ||
      repeatModeRef.current === 'one' ||
      isShuffleEnabledRef.current ||
      Math.abs(playbackRate - 1) > 1e-6 ||
      !isLocalGaplessCandidate(item.track)
    ) {
      return undefined;
    }

    const current = itemsRef.current;
    const index = current.findIndex((candidate) => candidate.queueId === item.queueId);
    const next =
      index >= 0 && index < current.length - 1
        ? current[index + 1]
        : index === current.length - 1 && repeatModeRef.current === 'all' && current.length > 1
          ? current[0]
          : null;
    if (!next || !isLocalGaplessCandidate(next.track) || !isGaplessAlbumAdjacent(item.track, next.track)) {
      return undefined;
    }

    const following: QueueItem[] = [];
    let previous = next;
    for (let candidateIndex = index + 2; candidateIndex < current.length && following.length < 30; candidateIndex += 1) {
      const candidate = current[candidateIndex];
      if (!candidate || !isLocalGaplessCandidate(candidate.track) || !isGaplessAlbumAdjacent(previous.track, candidate.track)) {
        break;
      }
      following.push(candidate);
      previous = candidate;
    }

    return {
      enabled: true,
      nextItem: toPlayableTrack(next.track),
      nextProbe: createProbeFromTrack(next.track),
      ...(following.length > 0
        ? {
            upcomingItems: following.map((candidate) => toPlayableTrack(candidate.track)),
            upcomingProbes: following.map((candidate) => createProbeFromTrack(candidate.track)),
          }
        : {}),
    };
  }, []);

  const getResumeStartSecondsForItem = useCallback((item: QueueItem): number | undefined => {
    const resume = resumeMemoryRef.current;
    if (!resume) {
      return undefined;
    }

    const matches =
      (resume.queueId !== null && resume.queueId === item.queueId) ||
      (resume.trackId !== null && resume.trackId === item.track.id) ||
      resume.filePath === item.track.path;

    if (!matches) {
      return undefined;
    }

    const positionSeconds = Math.max(0, resume.positionMs / 1000);
    const durationSeconds = resume.durationMs > 0 ? resume.durationMs / 1000 : item.track.duration;
    if (positionSeconds < 1 || (durationSeconds > 0 && positionSeconds >= durationSeconds - 1)) {
      return undefined;
    }

    return positionSeconds;
  }, []);

  const isConnectOutputActive = useCallback(async (): Promise<boolean> => {
    const connect = window.echo?.connect;
    if (!connect?.getStatus) {
      return false;
    }

    const status = await connect.getStatus().catch(() => null);
    return isActiveConnectPlaybackStatus(status);
  }, []);

  const playConnectOutputTrack = useCallback(async (item: QueueItem, requestToken: number, startSeconds = 0, forceHqPlayerConnect = false): Promise<PlaybackStatus | null> => {
    const connect = window.echo?.connect;
    if (!connect?.getStatus || !connect.connect) {
      return null;
    }

    const status = await connect.getStatus().catch(() => null);
    if (playRequestTokenRef.current !== requestToken) {
      throw new Error(playbackCancellationErrorMessage);
    }

    const deviceId =
      forceHqPlayerConnect || (status?.protocol === 'hqplayer' && status.deviceId === hqPlayerConnectDeviceId)
        ? hqPlayerConnectDeviceId
        : isActiveConnectPlaybackStatus(status)
          ? status.deviceId
          : null;

    if (!deviceId) {
      return null;
    }

    const nextStatus = await connect.connect({
      deviceId,
      track: item.track,
      filePath: item.track.path,
      positionSeconds: startSeconds,
    });
    return playbackStatusFromConnectStatus(nextStatus, item);
  }, []);

  const playLocalTrack = useCallback(async (item: QueueItem, options: PlayLocalTrackOptions = {}): Promise<PlaybackStatus> => {
    const operation = 'playLocalTrack';
    const playback = window.echo?.playback;
    const track = item.track;
    if (track.unavailable === true) {
      throw new Error('Queue item is unavailable.');
    }
    const requestToken = playRequestTokenRef.current + 1;
    playRequestTokenRef.current = requestToken;

    const previousItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
    const shouldPausePreviousSpotify = Boolean(previousItem && isSpotifyTrack(previousItem.track) && !isSpotifyTrack(track));
    const requestedStartSeconds =
      typeof options.startSeconds === 'number' && Number.isFinite(options.startSeconds)
        ? Math.max(0, options.startSeconds)
        : undefined;
    const resumeStartSeconds = requestedStartSeconds ?? getResumeStartSecondsForItem(item);
    let automix = runQueuePlaybackStepSync(operation, 'resolve automix', track.id, () => createAutomixOptions(item));
    schedulePlaybackHistoryFinish();
    runQueuePlaybackStepSync(operation, 'set queue/current track', track.id, () => {
      setCurrentQueueId(item.queueId);
      setCurrentTrackIdInternal(item.track.id);
      setLastPlayedTrack(item.track);
      beginPlaybackSwitchSnapshot({
        state: 'loading',
        currentTrackId: item.track.id,
        positionMs: Math.round((resumeStartSeconds ?? 0) * 1000),
        durationMs: Math.round(Math.max(0, item.track.duration) * 1000),
        filePath: track.path,
      });
    });
    const rawStatus = await (async () => {
      try {
        if (shouldPausePreviousSpotify && previousItem) {
          await pauseSpotifyPlayback(previousItem.track).catch(() => undefined);
        }

        const shouldForceHqPlayerConnect = options.forceHqPlayerConnect === true || hqPlayerTakeoverEnabledRef.current;
        const shouldRouteToConnectOutput =
          options.routeToConnectOutput === true || (options.routeToConnectOutput !== false && shouldForceHqPlayerConnect);
        const connectOutputStatus = shouldRouteToConnectOutput
          ? await playConnectOutputTrack(item, requestToken, resumeStartSeconds ?? 0, shouldForceHqPlayerConnect)
          : null;
        if (connectOutputStatus) {
          return connectOutputStatus;
        }
        if (shouldForceHqPlayerConnect) {
          throw new Error('HQPlayer 接管不可用：没有可用的 HQPlayer Connect 通道。');
        }

        if (automix) {
          const queueItems: BackendQueueSyncItem[] = itemsRef.current
            .map((candidate) => ({
              itemId: candidate.queueId,
              trackId: candidate.track.id,
              filePath: candidate.track.path ?? '',
              sampleRate: candidate.track.sampleRate ?? undefined,
              startSeconds: 0,
              metadata: {
                title: candidate.track.title,
                artist: candidate.track.artist,
                album: candidate.track.album,
                albumArtist: candidate.track.albumArtist,
                coverUrl: candidate.track.coverThumb,
              },
            }))
            .filter((candidate) => candidate.filePath);
          try {
            await runQueuePlaybackStep(operation, 'sync automix queue', track.id, () =>
              syncQueueSnapshotToBackend(queueItems, repeatModeRef.current, item.queueId));
          } catch (error) {
            automix = undefined;
            console.warn('[智能过渡] 队列同步失败，本次播放安全降级为普通切歌:', error);
          }
        }

        const output = await runQueuePlaybackStep(operation, 'resolvePlaybackSpeedOutput', track.id, resolvePlaybackSpeedOutput);
        const gapless = automix ? undefined : runQueuePlaybackStepSync(operation, 'resolve gapless', track.id, () => createGaplessOptions(item, output));
        if (playRequestTokenRef.current !== requestToken) {
          throw new Error(playbackCancellationErrorMessage);
        }
        return isSpotifyTrack(track)
          ? await (async () => {
              await playback?.stop?.().catch(() => undefined);
              return playSpotifyTrack(track, resumeStartSeconds ?? 0);
            })()
          : await (() => {
              if (!playback) {
                throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to play local files.');
              }

              return runQueuePlaybackStep(operation, 'playback.playLocalFile IPC', track.id, () =>
                (track.mediaType === 'remote' || track.mediaType === 'streaming') && playback.playMediaItem
                  ? playback.playMediaItem({
                    item: toPlayableTrack(track),
                    startSeconds: resumeStartSeconds,
                    output,
                    automix,
                    gapless,
                    ...(automixEnabledRef.current === true ? { automixAnalyze: true } : {}),
                    forceRefresh: options.forceRefresh === true,
                  })
                  : playback.playLocalFile({
                    filePath: track.path,
                    trackId: track.id,
                    metadata: {
                      title: track.title,
                      artist: track.artist,
                      album: track.album,
                      albumArtist: track.albumArtist,
                      coverUrl: track.coverThumb,
                    },
                    startSeconds: resumeStartSeconds,
                    output,
                    probe: createProbeFromTrack(track),
                    replayGain: replayGainFromTrack(track),
                    ...(automixEnabledRef.current === true ? { automixAnalyze: true } : {}),
                    automix,
                    gapless,
                  }),
              );
            })();
      } catch (error) {
        if (playRequestTokenRef.current !== requestToken) {
          throw new Error(playbackCancellationErrorMessage);
        }

        if (previousItem && currentQueueIdRef.current === item.queueId) {
          setCurrentQueueId(previousItem.queueId);
          setCurrentTrackIdInternal(previousItem.track.id);
          setLastPlayedTrack(previousItem.track);
        }
        setPlaybackStatusSnapshot({
          playbackStatus: statusForPlaybackFailure(item.track),
          error: error instanceof Error ? error.message : String(error),
          playbackVisualIntent: null,
        });
        throw error;
      }
    })();
    if (resumeMemoryRef.current) {
      setResumeMemory(null);
    }
    const status = playbackStatusForItem(rawStatus, item, resumeStartSeconds ?? 0);
    playbackStatusTokensRef.current.set(status, requestToken);
    playbackStatusPreviousItemRef.current.set(status, previousItem);
    if (playRequestTokenRef.current === requestToken) {
      schedulePlaybackHistoryStart(item);
    }
    return status;
  }, [createAutomixOptions, createGaplessOptions, getResumeStartSecondsForItem, playConnectOutputTrack, schedulePlaybackHistoryFinish, schedulePlaybackHistoryStart, setCurrentQueueId, setCurrentTrackIdInternal, setLastPlayedTrack, setResumeMemory, syncQueueSnapshotToBackend]);

  const autoSearchMv = useCallback((trackId: string): void => {
    const mvApi = window.echo?.mv;
    if (!mvApi?.getSelected) {
      return;
    }

    cancelAutoSearchMvRef.current?.();
    const enhancedLowLoadActive = enhancedLowLoadPlaybackActiveRef.current;
    const playbackPressureActive = isPlaybackOutputUnderPressure(latestAudioStatusRef.current, trackId);
    cancelAutoSearchMvRef.current = deferQueueBackgroundTask(() => {
      cancelAutoSearchMvRef.current = null;
      void runQueuePlaybackStep('playLocalTrack', 'autoSearchMv', trackId, async () => {
        const settings = await mvApi.getSettings?.();
        const skipNetworkSearch =
          enhancedLowLoadActive || isPlaybackOutputUnderPressure(latestAudioStatusRef.current, trackId);
        if (!skipNetworkSearch) {
          const candidates = settings?.enabled !== false && settings?.autoSearch && mvApi.searchNetworkCandidates ? await mvApi.searchNetworkCandidates(trackId) : [];
          window.dispatchEvent(new CustomEvent('mv:candidatesChanged', { detail: { trackId, candidates } }));
        }
        await mvApi.getSelected(trackId);
        window.dispatchEvent(new CustomEvent('mv:changed', { detail: { trackId } }));
      }).catch(() => undefined);
    }, { delayMs: enhancedLowLoadActive || playbackPressureActive ? enhancedLowLoadMvSearchDelayMs : postSwitchBackgroundDelayMs });
  }, []);

  const refreshAutomixBpmAnalysisTrack = useCallback(async (trackId: string): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.getTrack) {
      return;
    }

    const refreshed = await library.getTrack(trackId);
    if (!refreshed || refreshed.id !== trackId) {
      return;
    }

    updateTrackSnapshotRef.current(trackId, {
      bpm: refreshed.bpm,
      bpmConfidence: refreshed.bpmConfidence,
      beatOffsetMs: refreshed.beatOffsetMs,
      analysisStatus: refreshed.analysisStatus,
      analysisUpdatedAt: refreshed.analysisUpdatedAt,
    });
  }, []);

  const pollAutomixBpmAnalysisJob = useCallback((trackId: string, jobId: string): void => {
    if (automixBpmAnalysisPollTimersRef.current.has(trackId)) {
      return;
    }

    const pollTimer = window.setTimeout(() => {
      automixBpmAnalysisPollTimersRef.current.delete(trackId);
      void (async () => {
        try {
          const status = await window.echo?.library?.getBpmAnalysisStatus?.(jobId);
          if (status?.status === 'queued' || status?.status === 'running') {
            pollAutomixBpmAnalysisJob(trackId, jobId);
            return;
          }

          await refreshAutomixBpmAnalysisTrack(trackId);
          automixBpmAnalysisJobIdsRef.current.set(trackId, 'done');
        } catch {
          automixBpmAnalysisJobIdsRef.current.delete(trackId);
        }
      })();
    }, automixBpmAnalysisStatusPollMs);
    automixBpmAnalysisPollTimersRef.current.set(trackId, pollTimer);
  }, [refreshAutomixBpmAnalysisTrack]);

  const scheduleAutomixBpmAnalysis = useCallback((track: LibraryTrack): void => {
    const library = window.echo?.library;
    if (audioAnalysisEnabledRef.current === null) {
      pendingAutomixBpmAnalysisTrackRef.current = track;
      return;
    }

    if (
      !automixEnabledRef.current ||
      audioAnalysisEnabledRef.current !== true ||
      !shouldAnalyzeAutomixBpmCandidate(track) ||
      !library?.startBpmAnalysis ||
      !library.getBpmAnalysisStatus ||
      !library.getTrack
    ) {
      return;
    }

    const existingJobId = automixBpmAnalysisJobIdsRef.current.get(track.id);
    if (existingJobId === 'done') {
      return;
    }

    if (existingJobId) {
      pollAutomixBpmAnalysisJob(track.id, existingJobId);
      return;
    }

    cancelAutomixBpmAnalysisPrepareRef.current?.();
    cancelAutomixBpmAnalysisPrepareRef.current = deferQueueBackgroundTask(() => {
      cancelAutomixBpmAnalysisPrepareRef.current = null;
      void runQueuePlaybackStep('playLocalTrack', 'BPM analysis schedule', track.id, async () => {
        try {
          const job = await library.startBpmAnalysis({ trackIds: [track.id] });
          updateTrackSnapshotRef.current(track.id, { analysisStatus: 'analyzing' });

          if (job.status === 'queued' || job.status === 'running') {
            automixBpmAnalysisJobIdsRef.current.set(track.id, job.id);
            pollAutomixBpmAnalysisJob(track.id, job.id);
            return;
          }

          await refreshAutomixBpmAnalysisTrack(track.id);
          automixBpmAnalysisJobIdsRef.current.set(track.id, 'done');
        } catch {
          automixBpmAnalysisJobIdsRef.current.delete(track.id);
        }
      });
    }, { delayMs: postSwitchBackgroundDelayMs });
  }, [pollAutomixBpmAnalysisJob, refreshAutomixBpmAnalysisTrack]);
  scheduleAutomixBpmAnalysisRef.current = scheduleAutomixBpmAnalysis;

  const prepareNextMediaItem = useCallback((item: QueueItem): void => {
    const playback = window.echo?.playback;
    cancelLocalPrepareRef.current?.();
    cancelLocalPrepareRef.current = null;
    cancelAutomixBpmAnalysisPrepareRef.current?.();
    cancelAutomixBpmAnalysisPrepareRef.current = null;

    if (!playback?.prepareMediaItem && !playback?.prepareLocalFile) {
      return;
    }

    const current = itemsRef.current;
    const next = automixEnabledRef.current && isShuffleEnabledRef.current
      ? getStableShuffleAutomixNextItem(item)
      : resolveSequentialNextItem(current, item, repeatModeRef.current);
    if (!next) {
      return;
    }

    scheduleAutomixBpmAnalysis(next.track);

    if (isSpotifyTrack(next.track)) {
      return;
    }

    const expectedCurrentQueueId = item.queueId;
    const expectedNextQueueId = next.queueId;
    const isExpectedNextStillCurrent = (): boolean => {
      const latestItems = itemsRef.current;
      const latestIndex = latestItems.findIndex((candidate) => candidate.queueId === expectedCurrentQueueId);
      const latestItem = latestIndex >= 0 ? latestItems[latestIndex] : null;
      const stillCurrent = currentQueueIdRef.current === expectedCurrentQueueId;
      const stillNext = automixEnabledRef.current && isShuffleEnabledRef.current
        ? automixShuffleNextQueueIdRef.current.get(expectedCurrentQueueId) === expectedNextQueueId &&
          latestItems.some((candidate) => candidate.queueId === expectedNextQueueId)
        : latestItem
          ? resolveSequentialNextItem(latestItems, latestItem, repeatModeRef.current)?.queueId === expectedNextQueueId
          : false;

      return stillCurrent && stillNext;
    };

    if (next.track.mediaType === 'remote' || next.track.mediaType === 'streaming') {
      if (enhancedLowLoadPlaybackActiveRef.current) {
        return;
      }

      if (playback.prepareMediaItem) {
        cancelLocalPrepareRef.current = deferQueueBackgroundTask(() => {
          cancelLocalPrepareRef.current = null;
          if (!isExpectedNextStillCurrent()) {
            return;
          }

          void runQueuePlaybackStep('playLocalTrack', 'prepareNextMediaItem', next.track.id, () =>
            playback.prepareMediaItem!({
              item: toPlayableTrack(next.track),
              ...(automixEnabledRef.current === true ? { automixAnalyze: true } : {}),
            }),
          ).catch(() => undefined);
        }, { delayMs: postSwitchBackgroundDelayMs });
      }
      return;
    }

    if (!playback.prepareLocalFile) {
      return;
    }

    cancelLocalPrepareRef.current = deferQueueBackgroundTask(() => {
      cancelLocalPrepareRef.current = null;
      if (!isExpectedNextStillCurrent()) {
        return;
      }

      void runQueuePlaybackStep('playLocalTrack', 'prepareNextMediaItem', next.track.id, () =>
        playback.prepareLocalFile!({
          filePath: next.track.path,
          trackId: next.track.id,
          probe: createProbeFromTrack(next.track),
          replayGain: replayGainFromTrack(next.track),
          ...(automixEnabledRef.current === true ? { automixAnalyze: true } : {}),
        }),
      ).catch(() => undefined);
    }, { delayMs: postSwitchBackgroundDelayMs });
  }, [getStableShuffleAutomixNextItem, scheduleAutomixBpmAnalysis]);
  prepareNextMediaItemRef.current = prepareNextMediaItem;

  const commitPlayedItem = useCallback(
    (item: QueueItem, status: PlaybackStatus, options: { recordHistory?: boolean; previousItem?: QueueItem | null } = {}): void => {
      const requestToken = playbackStatusTokensRef.current.get(status);
      if (requestToken && requestToken !== playRequestTokenRef.current) {
        return;
      }

      const previousItem =
        options.previousItem ??
        playbackStatusPreviousItemRef.current.get(status) ??
        findItemByQueueId(itemsRef.current, currentQueueIdRef.current);

      if (options.recordHistory !== false && previousItem && previousItem.queueId !== item.queueId) {
        setHistory((current) => [...current, previousItem]);
      }

      runQueuePlaybackStepSync('playLocalTrack', 'commitPlayedItem', item.track.id, () => {
        setLastPlayedTrack(item.track);
        setCurrentQueueId(item.queueId);
        setCurrentTrackIdInternal(status.currentTrackId ?? item.track.id);
        setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
      });
      if (item.track.mediaType !== 'streaming') {
        autoSearchMv(item.track.id);
      }
      prepareNextMediaItem(item);
      schedulePlaybackSessionPersistence();
    },
    [autoSearchMv, prepareNextMediaItem, schedulePlaybackSessionPersistence, setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setLastPlayedTrack],
  );

  useEffect(() => {
    const audio = window.echo?.audio;
    if (!audio?.onStatus) {
      return undefined;
    }

    const commitHostQueueAdvance = (status: AudioStatus): void => {
      const queueItemId = status.currentQueueItemId;
      const queueRevision = Number(status.queueRevision);
      if (
        status.state !== 'playing' ||
        status.nativeDirectLocalPlaybackActive !== true ||
        !queueItemId ||
        !Number.isSafeInteger(queueRevision) ||
        queueRevision <= 0
      ) {
        return;
      }

      const commitKey = `${queueRevision}:${queueItemId}`;
      if (lastHostQueueCommitRef.current === commitKey) {
        return;
      }

      const next = findItemByQueueId(itemsRef.current, queueItemId);
      if (!next || (status.currentTrackId && next.track.id !== status.currentTrackId)) {
        console.error('[Queue] host advance target does not match the renderer snapshot:', {
          queueRevision,
          queueItemId,
          trackId: status.currentTrackId,
        });
        return;
      }

      lastHostQueueCommitRef.current = commitKey;
      if (currentQueueIdRef.current === next.queueId) {
        setPlaybackStatusSnapshot({ audioStatus: status, error: null });
        return;
      }

      const previous = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      schedulePlaybackHistoryFinish(true);
      commitPlayedItem(next, {
        state: 'playing',
        currentTrackId: next.track.id,
        positionMs: Math.round(Math.max(0, status.positionSeconds) * 1000),
        durationMs: Math.round(Math.max(0, status.durationSeconds || next.track.duration) * 1000),
        filePath: next.track.path,
      }, { previousItem: previous });
      setPlaybackStatusSnapshot({ audioStatus: status, error: null });
      schedulePlaybackHistoryStart(next);
    };

    const unsubscribe = audio.onStatus(commitHostQueueAdvance);
    return () => {
      unsubscribe?.();
    };
  }, [commitPlayedItem, schedulePlaybackHistoryFinish, schedulePlaybackHistoryStart]);

  useEffect(() => {
    const unsubscribe = window.echo?.playback?.onAutomixAdvance?.((event) => {
      if (event.fallbackReason || event.mode === 'gaplessFallback') {
        console.warn('[Automix] fallback transition triggered:', {
          mode: event.mode,
          reason: event.fallbackReason ?? 'none',
          fromTrackId: event.fromTrackId,
          toTrackId: event.toTrackId,
        });
      }

      const next = findAutomixAdvanceItem(itemsRef.current, currentQueueIdRef.current, currentTrackIdRef.current, event.toTrackId);
      if (!next) {
        console.error('[Automix] advance target not found in queue:', {
          toTrackId: event.toTrackId,
          mode: event.mode,
          reason: event.fallbackReason,
        });

        const currentItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
        const fallbackNext = currentItem
          ? resolveSequentialNextItem(itemsRef.current, currentItem, repeatModeRef.current)
          : null;
        if (fallbackNext) {
          console.warn('[Automix] using sequential next as fallback:', fallbackNext.track.id);
          const previous = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
          if (previous && previous.queueId !== fallbackNext.queueId) {
            setHistory((current) => [...current, previous]);
          }
          schedulePlaybackHistoryFinish(true);
          setCurrentQueueId(fallbackNext.queueId);
          setCurrentTrackIdInternal(fallbackNext.track.id);
          setLastPlayedTrack(fallbackNext.track);
          beginPlaybackSwitchSnapshot({
            state: 'playing',
            currentTrackId: fallbackNext.track.id,
            positionMs: Math.round(Math.max(0, event.nextStartSeconds ?? 0) * 1000),
            durationMs: Math.round(Math.max(0, fallbackNext.track.duration) * 1000),
            filePath: fallbackNext.track.path,
          });
          schedulePlaybackHistoryStart(fallbackNext);
          prepareNextMediaItem(fallbackNext);
          schedulePlaybackSessionPersistence();
        } else {
          console.error('[Automix] no sequential next available, automix advance aborted');
        }
        return;
      }

      const previous = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      if (previous && previous.queueId !== next.queueId) {
        setHistory((current) => [...current, previous]);
      }

      schedulePlaybackHistoryFinish(true);
      setCurrentQueueId(next.queueId);
      setCurrentTrackIdInternal(next.track.id);
      setLastPlayedTrack(next.track);
      beginPlaybackSwitchSnapshot({
        state: 'playing',
        currentTrackId: next.track.id,
        positionMs: Math.round(Math.max(0, event.nextStartSeconds ?? 0) * 1000),
        durationMs: Math.round(Math.max(0, next.track.duration) * 1000),
        filePath: next.track.path,
      });
      schedulePlaybackHistoryStart(next);
      prepareNextMediaItem(next);
      schedulePlaybackSessionPersistence();
    });

    return () => {
      unsubscribe?.();
    };
  }, [prepareNextMediaItem, schedulePlaybackHistoryFinish, schedulePlaybackHistoryStart, schedulePlaybackSessionPersistence, setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setLastPlayedTrack]);

  const finishPlaylistSequence = useCallback(
    async (resumeMode: 'current' | 'next'): Promise<PlaybackStatus | null> => {
      const playlistState = playlistPlaybackStateRef.current;
      if (!playlistState.active || !playlistState.snapshot) {
        return null;
      }

      const snapshot = playlistState.snapshot;
      const target = resolveSnapshotResumeItem(snapshot, resumeMode);
      applyPlaylistPlaybackSnapshot(snapshot);
      setPlaylistPlaybackStateInternal(defaultPlaylistPlaybackState);

      if (!target) {
        schedulePlaybackSessionPersistence();
        return null;
      }

      const status = await playLocalTrack(target, { routeToConnectOutput: true });
      commitPlayedItem(target, status, { recordHistory: false, previousItem: null });
      return status;
    },
    [applyPlaylistPlaybackSnapshot, commitPlayedItem, playLocalTrack, schedulePlaybackSessionPersistence, setPlaylistPlaybackStateInternal],
  );

  const exitPlaylistSequence = useCallback((): Promise<PlaybackStatus | null> => finishPlaylistSequence('current'), [finishPlaylistSequence]);

  const playPlaylistSequence = useCallback(
    async (tracks: LibraryTrack[], options: PlayPlaylistSequenceOptions = {}): Promise<PlaybackStatus | null> => {
      const playableTracks = tracks.filter((track) => track.unavailable !== true);
      if (playableTracks.length === 0) {
        return null;
      }

      const source = options.source ?? manualSource;
      const currentPlaylistState = playlistPlaybackStateRef.current;
      const snapshot = currentPlaylistState.active && currentPlaylistState.snapshot
        ? currentPlaylistState.snapshot
        : createPlaylistPlaybackSnapshot();
      const nextItems = playableTracks.map((track) => createQueueItem(track, source));
      const itemToPlay =
        (options.startTrackId ? nextItems.find((item) => item.track.id === options.startTrackId) : null) ??
        nextItems[0] ??
        null;

      if (!itemToPlay) {
        return null;
      }

      setPlaylistPlaybackStateInternal({
        active: true,
        label: options.label ?? source.label,
        playlistId: options.playlistId ?? null,
        snapshot,
      });
      isShuffleEnabledRef.current = false;
      setIsShuffleEnabled(false);
      repeatModeRef.current = 'off';
      setRepeatMode('off');

      try {
        const status = await playLocalTrack(itemToPlay, { routeToConnectOutput: true });
        setItems(nextItems);
        setHistory([]);
        commitPlayedItem(itemToPlay, status, { recordHistory: false, previousItem: null });
        return status;
      } catch (error) {
        const latestPlaylistState = playlistPlaybackStateRef.current;
        if (latestPlaylistState.active && latestPlaylistState.snapshot === snapshot) {
          setPlaylistPlaybackStateInternal(defaultPlaylistPlaybackState);
          applyPlaylistPlaybackSnapshot(snapshot);
        }
        throw error;
      }
    },
    [applyPlaylistPlaybackSnapshot, commitPlayedItem, createPlaylistPlaybackSnapshot, playLocalTrack, setHistory, setItems, setPlaylistPlaybackStateInternal],
  );

  const replaceQueue = useCallback(
    (tracks: LibraryTrack[], options: ReplaceQueueOptions = {}): void => {
      restorePlaylistPlaybackSnapshotOnly();
      clearLibraryShuffleDeck();
      const nextItems = tracks.map((track) => createQueueItem(track, options.source ?? manualSource));
      const startItem = options.startTrackId ? nextItems.find((item) => item.track.id === options.startTrackId) ?? null : null;

      setItems(nextItems);
      setHistory([]);
      setCurrentQueueId(startItem?.queueId ?? null);
      if (startItem) {
        setCurrentTrackIdInternal(startItem.track.id);
      }
    },
    [clearLibraryShuffleDeck, restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setItems],
  );

  const appendToQueue = useCallback(
    (track: LibraryTrack, source: QueueSource = manualSource): void => {
      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        const item = createQueueItem(track, source);
        if (source.type === 'continuous-play') {
          return [...current, item];
        }
        const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
        const recommendedTailIndex = current.findIndex((candidate, index) =>
          index > currentIndex && candidate.source.type === 'continuous-play');
        const insertIndex = recommendedTailIndex >= 0 ? recommendedTailIndex : current.length;
        return [...current.slice(0, insertIndex), item, ...current.slice(insertIndex)];
      });
      publishQueueFeedback(
        tq('queue.feedback.addedToTail'),
        tq('queue.feedback.trackDetail', {
          title: track.title,
          source: queueSourceDisplayLabel(source, playlistPlaybackStateRef.current),
        }),
      );
    },
    [publishQueueFeedback, restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const appendTracksToQueue = useCallback(
    (tracks: LibraryTrack[], source: QueueSource = manualSource): void => {
      if (tracks.length === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        const nextItems = tracks.map((track) => createQueueItem(track, source));
        if (source.type === 'continuous-play') {
          return [...current, ...nextItems];
        }
        const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
        const recommendedTailIndex = current.findIndex((candidate, index) =>
          index > currentIndex && candidate.source.type === 'continuous-play');
        const insertIndex = recommendedTailIndex >= 0 ? recommendedTailIndex : current.length;
        return [...current.slice(0, insertIndex), ...nextItems, ...current.slice(insertIndex)];
      });
      publishQueueFeedback(
        tq('queue.feedback.addedCount', { count: tracks.length }),
        tq('queue.feedback.sourceTail', {
          source: queueSourceDisplayLabel(source, playlistPlaybackStateRef.current),
        }),
      );
    },
    [publishQueueFeedback, restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const playTrackNext = useCallback(
    (track: LibraryTrack, source: QueueSource = manualSource): void => {
      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
        const insertIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
        const nextItem = createQueueItem(track, source);
        return [...current.slice(0, insertIndex), nextItem, ...current.slice(insertIndex)];
      });
      publishQueueFeedback(
        tq('queue.feedback.addedNext'),
        tq('queue.feedback.trackDetail', {
          title: track.title,
          source: queueSourceDisplayLabel(source, playlistPlaybackStateRef.current),
        }),
      );
    },
    [publishQueueFeedback, restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const playTracksNext = useCallback(
    (tracks: LibraryTrack[], source: QueueSource = manualSource): void => {
      if (tracks.length === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
        const insertIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
        const nextItems = tracks.map((track) => createQueueItem(track, source));
        return [...current.slice(0, insertIndex), ...nextItems, ...current.slice(insertIndex)];
      });
      publishQueueFeedback(
        tq('queue.feedback.addedNextCount', { count: tracks.length }),
        queueSourceDisplayLabel(source, playlistPlaybackStateRef.current),
      );
    },
    [publishQueueFeedback, restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const removeQueueItem = useCallback(
    (queueId: string): void => {
      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => current.filter((item) => item.queueId !== queueId));
      setHistory((current) => current.filter((item) => item.queueId !== queueId));

      if (currentQueueIdRef.current === queueId) {
        setCurrentQueueId(null);
      }
    },
    [restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setHistory, setItems],
  );

  const removeQueueItems = useCallback(
    (queueIds: string[]): void => {
      const queueIdSet = new Set(queueIds);
      if (queueIdSet.size === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => current.filter((item) => !queueIdSet.has(item.queueId)));
      setHistory((current) => current.filter((item) => !queueIdSet.has(item.queueId)));

      if (currentQueueIdRef.current && queueIdSet.has(currentQueueIdRef.current)) {
        setCurrentQueueId(null);
      }
    },
    [restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setHistory, setItems],
  );

  const removeTrackFromQueue = useCallback(
    (trackId: string): number => {
      restorePlaylistPlaybackSnapshotOnly();
      const queuedCount = itemsRef.current.filter((item) => item.track.id === trackId).length;
      const currentItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      const wasCurrentTrack = currentTrackIdRef.current === trackId || currentItem?.track.id === trackId;
      const wasLastPlayedTrack = lastPlayedTrackRef.current?.id === trackId;
      const hasResumeMemory = resumeMemoryRef.current?.trackId === trackId;
      if (queuedCount === 0 && !wasCurrentTrack && !wasLastPlayedTrack && !hasResumeMemory) {
        return 0;
      }

      setItems((current) => current.filter((item) => item.track.id !== trackId));
      setHistory((current) => current.filter((item) => item.track.id !== trackId));

      if (currentItem?.track.id === trackId) {
        setCurrentQueueId(null);
      }
      if (wasCurrentTrack) {
        setCurrentTrackIdInternal(null);
      }
      if (wasLastPlayedTrack) {
        setLastPlayedTrack(null);
      }
      if (hasResumeMemory) {
        setResumeMemory(null);
      }

      return queuedCount;
    },
    [
      restorePlaylistPlaybackSnapshotOnly,
      setCurrentQueueId,
      setCurrentTrackIdInternal,
      setHistory,
      setItems,
      setLastPlayedTrack,
      setResumeMemory,
    ],
  );

  const setQueueItemsRemoveAfterPlay = useCallback(
    (queueIds: string[], enabled: boolean): void => {
      const queueIdSet = new Set(queueIds);
      if (queueIdSet.size === 0) {
        return;
      }

      setItems((current) =>
        current.map((item) =>
          queueIdSet.has(item.queueId)
            ? { ...item, removeAfterPlay: enabled || undefined }
            : item,
        ),
      );
    },
    [setItems],
  );

  const clearQueue = useCallback((): void => {
    restorePlaylistPlaybackSnapshotOnly();
    clearLibraryShuffleDeck();
    setAutoFillQueueEnabled(false);
    setItems([]);
    setHistory([]);
    setCurrentQueueId(null);
  }, [clearLibraryShuffleDeck, restorePlaylistPlaybackSnapshotOnly, setAutoFillQueueEnabled, setCurrentQueueId, setHistory, setItems]);

  const removeContinuousPlayItems = useCallback((): void => {
    setItems((current) => current.filter((item) => item.source.type !== 'continuous-play' || item.queueId === currentQueueIdRef.current));
  }, [setItems]);

  const moveQueueItem = useCallback(
    (fromIndex: number, toIndex: number): void => {
      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        if (current.length === 0 || fromIndex < 0 || fromIndex >= current.length) {
          return current;
        }

        const next = [...current];
        const [movedItem] = next.splice(fromIndex, 1);
        next.splice(clampMoveIndex(toIndex, next.length + 1), 0, movedItem);
        return next;
      });
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const moveQueueItemsToIndex = useCallback(
    (queueIds: string[], toIndex: number): void => {
      const queueIdSet = new Set(queueIds);
      if (queueIdSet.size === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        if (current.length === 0) {
          return current;
        }

        const moving = current.filter((item) => queueIdSet.has(item.queueId));
        if (moving.length === 0) {
          return current;
        }

        const remaining = current.filter((item) => !queueIdSet.has(item.queueId));
        if (remaining.length === 0) {
          return current;
        }

        const targetQueueId = current[clampMoveIndex(toIndex, current.length)]?.queueId ?? null;
        const insertIndex = targetQueueId && !queueIdSet.has(targetQueueId)
          ? Math.max(0, remaining.findIndex((item) => item.queueId === targetQueueId))
          : clampMoveIndex(toIndex, remaining.length + 1);

        return [
          ...remaining.slice(0, insertIndex),
          ...moving,
          ...remaining.slice(insertIndex),
        ];
      });
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const moveQueueItemsAfterCurrent = useCallback(
    (queueIds: string[]): void => {
      const queueIdSet = new Set(queueIds);
      if (queueIdSet.size === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => {
        if (current.length === 0) {
          return current;
        }

        const activeQueueId = currentQueueIdRef.current;
        const moving = current.filter((item) => item.queueId !== activeQueueId && queueIdSet.has(item.queueId));
        if (moving.length === 0) {
          return current;
        }

        const remaining = current.filter((item) => item.queueId === activeQueueId || !queueIdSet.has(item.queueId));
        const activeIndex = activeQueueId ? remaining.findIndex((item) => item.queueId === activeQueueId) : -1;
        const insertIndex = activeIndex >= 0 ? activeIndex + 1 : 0;

        return [
          ...remaining.slice(0, insertIndex),
          ...moving,
          ...remaining.slice(insertIndex),
        ];
      });
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const restoreQueueItems = useCallback(
    (nextItems: QueueItem[], options: RestoreQueueItemsOptions = {}): void => {
      restorePlaylistPlaybackSnapshotOnly();
      clearLibraryShuffleDeck();
      const queueIds = new Set(nextItems.map((item) => item.queueId));
      const nextCurrentQueueId = options.currentQueueId && queueIds.has(options.currentQueueId)
        ? options.currentQueueId
        : null;
      const nextCurrentTrackId =
        typeof options.currentTrackId === 'string'
          ? options.currentTrackId
          : nextCurrentQueueId
            ? nextItems.find((item) => item.queueId === nextCurrentQueueId)?.track.id ?? null
            : currentTrackIdRef.current;

      setItems(nextItems);
      setHistory((current) =>
        options.preserveHistory === true
          ? current.filter((item) => queueIds.has(item.queueId))
          : [],
      );
      setCurrentQueueId(nextCurrentQueueId);
      setCurrentTrackIdInternal(nextCurrentTrackId);
    },
    [clearLibraryShuffleDeck, restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setCurrentTrackIdInternal, setHistory, setItems],
  );

  const playQueueItem = useCallback(
    async (queueId: string): Promise<PlaybackStatus> => {
      const item = findItemByQueueId(itemsRef.current, queueId);

      if (!item) {
        throw new Error('Queue item is no longer available.');
      }

      const status = await playLocalTrack(item, { routeToConnectOutput: true });
      commitPlayedItem(item, status);
      return status;
    },
    [commitPlayedItem, playLocalTrack],
  );

  useEffect(() => {
    if (startupAutoPlayAttemptedRef.current || !sessionHydrated || autoPlayOnStartupEnabled === null) {
      return;
    }

    startupAutoPlayAttemptedRef.current = true;
    if (!autoPlayOnStartupEnabled) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const currentStatus = await window.echo?.audio?.getStatus?.().catch(() => null);
      if (cancelled || currentStatus?.state === 'loading' || currentStatus?.state === 'playing') {
        return;
      }

      const current = itemsRef.current;
      const startupItem =
        findItemByQueueId(current, currentQueueIdRef.current) ??
        (currentTrackIdRef.current ? current.find((item) => item.track.id === currentTrackIdRef.current) ?? null : null) ??
        current.find((item) => item.track.unavailable !== true) ??
        null;
      if (!startupItem || startupItem.track.unavailable === true) {
        return;
      }

      await playQueueItem(startupItem.queueId).catch((error) => {
        console.warn('[playback] Startup auto-play failed:', error);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [autoPlayOnStartupEnabled, playQueueItem, sessionHydrated]);

  const fetchLibraryShuffleTarget = useCallback(
    async (activeItem: QueueItem | null): Promise<QueueItem | null> => {
      const library = window.echo?.library;
      const sourceKey = shuffleDeckKeyForSource(libraryShuffleSource);

      if (!library?.getTracks) {
        return null;
      }

      if (libraryShuffleDeckRef.current.sourceKey !== sourceKey) {
        libraryShuffleDeckRef.current = { sourceKey, items: [] };
      }

      const dequeueFreshDeckItem = (): QueueItem | null => {
        const excludedTrackIds = new Set(
          getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current, playbackShuffleAvoidRecentCountRef.current),
        );
        const remainingItems: QueueItem[] = [];
        let target: QueueItem | null = null;

        for (const item of libraryShuffleDeckRef.current.items) {
          if (excludedTrackIds.has(item.track.id)) {
            continue;
          }
          if (!target) {
            target = itemsRef.current.find((candidate) => candidate.track.id === item.track.id) ?? item;
            excludedTrackIds.add(item.track.id);
            continue;
          }
          remainingItems.push(item);
        }

        libraryShuffleDeckRef.current = { sourceKey, items: remainingItems };
        return target;
      };

      const deckTarget = dequeueFreshDeckItem();
      if (deckTarget) {
        return deckTarget;
      }

      try {
        const libraryExcludeTrackIds = getLibraryShuffleExcludedTrackIds(
          activeItem,
          historyRef.current,
          playbackShuffleAvoidRecentCountRef.current,
        );
        const result = await library.getTracks({
          page: 1,
          pageSize: libraryShuffleCandidatePageSize,
          search: undefined,
          sort: 'random',
          hideDuplicates: undefined,
          showDuplicatesOnly: undefined,
          duplicateMode: 'strict',
          excludeTrackIds: libraryExcludeTrackIds,
          randomWindow: true,
        });
        const excludedTrackIds = new Set(libraryExcludeTrackIds);
        libraryShuffleDeckRef.current = {
          sourceKey,
          items: result.items
            .filter((track) => track.unavailable !== true && !excludedTrackIds.has(track.id))
            .map((track) => createQueueItem(track, libraryShuffleSource)),
        };

        return dequeueFreshDeckItem();
      } catch {
        clearLibraryShuffleDeck();
        return null;
      }
    },
    [clearLibraryShuffleDeck],
  );

  const fetchFolderShuffleTarget = useCallback(
    async (source: Extract<QueueSource, { type: 'folder' }>, activeItem: QueueItem | null): Promise<QueueItem | null> => {
      const library = window.echo?.library;
      const sourceKey = shuffleDeckKeyForSource(source);

      if (!library?.getFolderTracks) {
        return null;
      }

      if (libraryShuffleDeckRef.current.sourceKey !== sourceKey) {
        libraryShuffleDeckRef.current = { sourceKey, items: [] };
      }

      const dequeueFreshDeckItem = (): QueueItem | null => {
        const excludedTrackIds = new Set(
          getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current, playbackShuffleAvoidRecentCountRef.current),
        );
        const remainingItems: QueueItem[] = [];
        let target: QueueItem | null = null;

        for (const item of libraryShuffleDeckRef.current.items) {
          if (excludedTrackIds.has(item.track.id)) {
            continue;
          }
          if (!target) {
            target = itemsRef.current.find((candidate) => candidate.track.id === item.track.id) ?? item;
            excludedTrackIds.add(item.track.id);
            continue;
          }
          remainingItems.push(item);
        }

        libraryShuffleDeckRef.current = { sourceKey, items: remainingItems };
        return target;
      };

      const deckTarget = dequeueFreshDeckItem();
      if (deckTarget) {
        return deckTarget;
      }

      try {
        const folderExcludeTrackIds = getLibraryShuffleExcludedTrackIds(
          activeItem,
          historyRef.current,
          playbackShuffleAvoidRecentCountRef.current,
        );
        const result = await library.getFolderTracks({
          folderId: source.folderId,
          path: source.path,
          recursive: source.recursive,
          page: 1,
          pageSize: libraryShuffleCandidatePageSize,
          search: source.search,
          sort: 'random',
          excludeTrackIds: folderExcludeTrackIds,
          randomWindow: true,
        });
        const excludedTrackIds = new Set(folderExcludeTrackIds);
        libraryShuffleDeckRef.current = {
          sourceKey,
          items: result.items
            .filter((track) => track.unavailable !== true && !excludedTrackIds.has(track.id))
            .map((track) => createQueueItem(track, source)),
        };

        return dequeueFreshDeckItem();
      } catch {
        clearLibraryShuffleDeck();
        return null;
      }
    },
    [clearLibraryShuffleDeck],
  );

  const fetchLikedShuffleTarget = useCallback(
    async (source: Extract<QueueSource, { type: 'liked' }>, activeItem: QueueItem | null): Promise<QueueItem | null> => {
      const library = window.echo?.library;
      const sourceKey = shuffleDeckKeyForSource(source);

      if (!library?.getLikedTracks) {
        return null;
      }

      if (libraryShuffleDeckRef.current.sourceKey !== sourceKey) {
        libraryShuffleDeckRef.current = { sourceKey, items: [] };
      }

      const dequeueFreshDeckItem = (): QueueItem | null => {
        const excludedTrackIds = new Set(
          getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current, playbackShuffleAvoidRecentCountRef.current),
        );
        const remainingItems: QueueItem[] = [];
        let target: QueueItem | null = null;

        for (const item of libraryShuffleDeckRef.current.items) {
          if (excludedTrackIds.has(item.track.id)) {
            continue;
          }
          if (!target) {
            target = itemsRef.current.find((candidate) => candidate.track.id === item.track.id) ?? item;
            excludedTrackIds.add(item.track.id);
            continue;
          }
          remainingItems.push(item);
        }

        libraryShuffleDeckRef.current = { sourceKey, items: remainingItems };
        return target;
      };

      const deckTarget = dequeueFreshDeckItem();
      if (deckTarget) {
        return deckTarget;
      }

      try {
        const excludedTrackIds = new Set(
          getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current, playbackShuffleAvoidRecentCountRef.current),
        );
        const result = await library.getLikedTracks({
          page: 1,
          pageSize: libraryShuffleCandidatePageSize,
          search: source.search,
          sort: 'random',
          sourceProvider: source.sourceProvider,
          randomWindow: true,
        });

        libraryShuffleDeckRef.current = {
          sourceKey,
          items: result.items
            .map(playlistItemToTrack)
            .filter((track): track is LibraryTrack => track !== null && track.unavailable !== true && Boolean(track.path) && !excludedTrackIds.has(track.id))
            .map((track) => createQueueItem(track, source)),
        };

        return dequeueFreshDeckItem();
      } catch {
        clearLibraryShuffleDeck();
        return null;
      }
    },
    [clearLibraryShuffleDeck],
  );

  const fetchLibraryRandomQueueRefresh = useCallback(
    async (
      source: Extract<QueueSource, { type: 'songs' }>,
      activeItem: QueueItem | null,
      pageSize: number,
      relaxRecentHistory = false,
    ): Promise<QueueItem[]> => {
      const library = window.echo?.library;

      if (!library?.getTracks) {
        return [];
      }

      try {
        const excludeTrackIds = relaxRecentHistory
          ? activeItem ? [activeItem.track.id] : []
          : getLibraryShuffleExcludedTrackIds(
            activeItem,
            historyRef.current,
            playbackShuffleAvoidRecentCountRef.current,
          );
        const result = await library.getTracks({
          page: 1,
          pageSize: Math.max(2, Math.min(pageSize, libraryRandomQueueRefreshPageSize)),
          search: source.search,
          sort: 'random',
          hideDuplicates: source.hideDuplicates,
          showDuplicatesOnly: source.showDuplicatesOnly,
          showOsuOnly: source.showOsuOnly,
          audioFormatFilter: source.audioFormatFilter,
          duplicateMode: 'strict',
          excludeTrackIds,
          randomWindow: true,
        });
        const activeTrackId = activeItem?.track.id ?? null;

        return result.items
          .filter((track) => track.id !== activeTrackId)
          .map((track) => createQueueItem(track, source));
      } catch {
        return [];
      }
    },
    [],
  );

  const fetchFolderRandomQueueRefresh = useCallback(
    async (source: Extract<QueueSource, { type: 'folder' }>, activeItem: QueueItem | null, pageSize: number): Promise<QueueItem[]> => {
      const library = window.echo?.library;

      if (!library?.getFolderTracks) {
        return [];
      }

      try {
        const excludeTrackIds = getLibraryShuffleExcludedTrackIds(
          activeItem,
          historyRef.current,
          playbackShuffleAvoidRecentCountRef.current,
        );
        const result = await library.getFolderTracks({
          folderId: source.folderId,
          path: source.path,
          recursive: source.recursive,
          page: 1,
          pageSize: Math.max(2, Math.min(pageSize, libraryRandomQueueRefreshPageSize)),
          search: source.search,
          sort: 'random',
          excludeTrackIds,
          randomWindow: true,
        });
        const activeTrackId = activeItem?.track.id ?? null;

        return result.items
          .filter((track) => track.id !== activeTrackId)
          .map((track) => createQueueItem(track, source));
      } catch {
        return [];
      }
    },
    [],
  );

  const fetchLikedRandomQueueRefresh = useCallback(
    async (source: Extract<QueueSource, { type: 'liked' }>, activeItem: QueueItem | null, pageSize: number): Promise<QueueItem[]> => {
      const library = window.echo?.library;

      if (!library?.getLikedTracks) {
        return [];
      }

      try {
        const excludeTrackIds = new Set(
          getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current, playbackShuffleAvoidRecentCountRef.current),
        );
        const result = await library.getLikedTracks({
          page: 1,
          pageSize: Math.max(2, Math.min(pageSize, libraryRandomQueueRefreshPageSize)),
          search: source.search,
          sort: 'random',
          sourceProvider: source.sourceProvider,
          randomWindow: true,
        });
        const activeTrackId = activeItem?.track.id ?? null;

        return result.items
          .map(playlistItemToTrack)
          .filter((track): track is LibraryTrack => track !== null && track.id !== activeTrackId && track.unavailable !== true && Boolean(track.path) && !excludeTrackIds.has(track.id))
          .map((track) => createQueueItem(track, source));
      } catch {
        return [];
      }
    },
    [],
  );

  const fillQueue = useCallback(
    async (options: FillQueueOptions = {}): Promise<number> => {
      const current = itemsRef.current;
      const targetSize = Math.max(2, Math.min(options.targetSize ?? manualQueueFillTargetSize, libraryRandomQueueRefreshPageSize));
      const missingCount = Math.max(0, targetSize - current.length);

      if (missingCount === 0) {
        publishQueueFeedback(
          tq('queue.feedback.fillEnough'),
          tq('queue.feedback.fillEnoughDetail', { count: current.length }),
        );
        return 0;
      }

      const activeItem =
        findItemByQueueId(current, currentQueueIdRef.current) ??
        (currentTrackIdRef.current ? current.find((item) => item.track.id === currentTrackIdRef.current) ?? null : null) ??
        current[0] ??
        null;
      const activeSource = activeItem?.source ?? null;
      let filledItems: QueueItem[] = [];

      if (isFolderRandomSortSource(activeSource)) {
        filledItems = await fetchFolderRandomQueueRefresh(activeSource, activeItem, missingCount + current.length);
      } else if (isLikedSource(activeSource)) {
        filledItems = await fetchLikedRandomQueueRefresh(activeSource, activeItem, missingCount + current.length);
      } else {
        const source = isLibraryRandomSource(activeSource) ? activeSource : libraryShuffleSource;
        filledItems = await fetchLibraryRandomQueueRefresh(source, activeItem, missingCount + current.length);
      }

      const existingTrackIds = new Set(current.map((item) => item.track.id));
      const nextItems: QueueItem[] = [];
      for (const item of filledItems) {
        if (existingTrackIds.has(item.track.id)) {
          continue;
        }

        existingTrackIds.add(item.track.id);
        nextItems.push(item);
        if (nextItems.length >= missingCount) {
          break;
        }
      }

      if (nextItems.length === 0) {
        publishQueueFeedback(
          tq('queue.feedback.fillEmpty'),
          tq('queue.feedback.fillEmptyDetail', { count: playbackShuffleAvoidRecentCountRef.current }),
          'info',
        );
        return 0;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((items) => [...items, ...nextItems]);
      publishQueueFeedback(
        tq('queue.feedback.filledCount', { count: nextItems.length }),
        tq('queue.feedback.sourceTail', {
          source: queueSourceDisplayLabel(nextItems[0]?.source, playlistPlaybackStateRef.current),
        }),
      );
      return nextItems.length;
    },
    [
      fetchFolderRandomQueueRefresh,
      fetchLibraryRandomQueueRefresh,
      fetchLikedRandomQueueRefresh,
      publishQueueFeedback,
      restorePlaylistPlaybackSnapshotOnly,
      setItems,
    ],
  );

  const fillContinuousPlayQueue = useCallback(async (targetAhead = 5): Promise<number> => {
    if (!autoFillQueueEnabledRef.current || continuousPlayFillInFlightRef.current) {
      return 0;
    }

    const library = window.echo?.library;
    if (!library?.getContinuousPlayRecommendations) {
      return 0;
    }

    const current = itemsRef.current;
    const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
    const upcomingCount = currentIndex >= 0 ? current.length - currentIndex - 1 : current.length;
    const missingCount = Math.max(0, Math.min(8, targetAhead - upcomingCount));
    if (missingCount === 0) {
      return 0;
    }

    const seedTrack = currentIndex >= 0
      ? current[currentIndex]?.track ?? null
      : findItemByQueueId(current, currentQueueIdRef.current)?.track ?? lastPlayedTrackRef.current;
    continuousPlayFillInFlightRef.current = true;
    setIsContinuousPlayFilling(true);
    try {
      const excludeTrackIds = Array.from(new Set([
        ...current.map((item) => item.track.id),
        ...historyRef.current.slice(-100).map((item) => item.track.id),
      ]));
      const result = await library.getContinuousPlayRecommendations({
        mode: continuousPlayModeRef.current,
        seedTrackId: seedTrack?.id ?? null,
        excludeTrackIds,
        limit: missingCount,
        preferences: continuousPlayPreferencesRef.current,
      });
      if (!autoFillQueueEnabledRef.current || result.mode !== continuousPlayModeRef.current) {
        return 0;
      }

      const existingTrackIds = new Set(itemsRef.current.map((item) => item.track.id));
      const nextItems: QueueItem[] = result.items.flatMap((recommendation) => {
        if (existingTrackIds.has(recommendation.track.id)) {
          return [];
        }
        existingTrackIds.add(recommendation.track.id);
        const source: QueueSource = {
          type: 'continuous-play',
          label: tq('queue.continuousPlay.source'),
          mode: result.mode,
        };
        return [{
          ...createQueueItem(recommendation.track, source),
          recommendation: {
            mode: result.mode,
            reasons: recommendation.reasons,
            generatedAt: result.generatedAt,
          },
        }];
      });
      if (nextItems.length > 0) {
        setItems((items) => [...items, ...nextItems]);
      }
      return nextItems.length;
    } catch (error) {
      console.warn('[Queue] continuous play recommendation failed:', error);
      return 0;
    } finally {
      continuousPlayFillInFlightRef.current = false;
      setIsContinuousPlayFilling(false);
    }
  }, [setItems]);

  useEffect(() => {
    if (!sessionHydrated || !autoFillQueueEnabled) {
      return;
    }
    const ensureRecommendationBuffer = (): void => {
      const current = itemsRef.current;
      const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
      const upcomingCount = currentIndex >= 0 ? current.length - currentIndex - 1 : current.length;
      if (upcomingCount <= 2) {
        void fillContinuousPlayQueue();
      }
    };
    ensureRecommendationBuffer();
    const retryTimer = window.setInterval(ensureRecommendationBuffer, 7_500);
    return () => window.clearInterval(retryTimer);
  }, [autoFillQueueEnabled, continuousPlayMode, continuousPlayPreferences, currentQueueId, currentTrackId, fillContinuousPlayQueue, items, sessionHydrated]);

  const playTrack = useCallback(
    async (track: LibraryTrack, options: PlayTrackOptions = {}): Promise<PlaybackStatus> => {
      if (options.preservePlaylistPlayback !== true) {
        restorePlaylistPlaybackSnapshotOnly();
      }
      const source = options.source ?? manualSource;
      const replacementItems = options.replaceQueueWithItems;
      const replacementTracks = options.replaceQueueWith;
      const previousItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);

      if (replacementItems) {
        clearLibraryShuffleDeck();
        const contextItems = replacementItems.some((item) => item.track.id === track.id)
          ? replacementItems
          : [{ track, source }, ...replacementItems];
        const nextItems = contextItems.map((item) => createQueueItem(item.track, item.source ?? source));
        const itemToPlay = nextItems.find((item) => item.track.id === track.id) ?? nextItems[0] ?? createQueueItem(track, source);
        const status = await playLocalTrack(itemToPlay, {
          routeToConnectOutput: options.routeToConnectOutput !== false,
          forceHqPlayerConnect: options.forceHqPlayerConnect,
          startSeconds: options.startSeconds,
          forceRefresh: options.forceRefresh,
        });

        setItems(nextItems);
        setHistory([]);
        commitPlayedItem(itemToPlay, status, { previousItem });
        return status;
      }

      if (replacementTracks) {
        clearLibraryShuffleDeck();
        const contextTracks = replacementTracks.some((item) => item.id === track.id)
          ? replacementTracks
          : [track, ...replacementTracks];
        const nextItems = contextTracks.map((item) => createQueueItem(item, source));
        const itemToPlay = nextItems.find((item) => item.track.id === track.id) ?? nextItems[0] ?? createQueueItem(track, source);
        const status = await playLocalTrack(itemToPlay, {
          routeToConnectOutput: options.routeToConnectOutput !== false,
          forceHqPlayerConnect: options.forceHqPlayerConnect,
          startSeconds: options.startSeconds,
          forceRefresh: options.forceRefresh,
        });

        setItems(nextItems);
        setHistory([]);
        commitPlayedItem(itemToPlay, status, { previousItem });
        return status;
      }

      const existingItem = options.forceNewQueueItem ? null : itemsRef.current.find((item) => item.track.id === track.id);
      const itemToPlay =
        existingItem && shouldReplaceExistingQueueTrack(existingItem.track, track)
          ? { ...existingItem, track: { ...existingItem.track, ...track } }
          : existingItem ?? createQueueItem(track, source);
      const status = await playLocalTrack(itemToPlay, {
        routeToConnectOutput: options.routeToConnectOutput !== false,
        forceHqPlayerConnect: options.forceHqPlayerConnect,
        startSeconds: options.startSeconds,
        forceRefresh: options.forceRefresh,
      });

      if (existingItem && itemToPlay !== existingItem) {
        setItems((current) => current.map((item) => (item.queueId === existingItem.queueId ? itemToPlay : item)));
      } else if (!existingItem) {
        setItems((current) => [...current, itemToPlay]);
      }

      commitPlayedItem(itemToPlay, status, { previousItem });
      return status;
    },
    [clearLibraryShuffleDeck, commitPlayedItem, playLocalTrack, restorePlaylistPlaybackSnapshotOnly, setHistory, setItems],
  );

  const openTemporaryLocalFiles = useCallback(
    async (paths: string[]): Promise<LocalFileResolveResult> => {
      const playback = window.echo?.playback;

      if (!playback?.resolveLocalAudioFiles) {
        throw new Error('Desktop bridge unavailable. Open ECHO Next in Electron to open local files.');
      }

      const result = await playback.resolveLocalAudioFiles(paths);
      if (result.tracks.length === 0) {
        return result;
      }

      const source: QueueSource = { type: 'local-file', label: 'Local files' };
      const nextItems = result.tracks.map((track) => createQueueItem(track, source));
      const firstItem = nextItems[0];
      restorePlaylistPlaybackSnapshotOnly();
      const previousItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      const status = await playLocalTrack(firstItem, { routeToConnectOutput: true });

      setItems((current) => [...current, ...nextItems]);
      commitPlayedItem(firstItem, status, { previousItem });

      return result;
    },
    [commitPlayedItem, playLocalTrack, restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const playPrevious = useCallback(async (): Promise<PlaybackStatus | null> => {
    let previousHistoryIndex = historyRef.current.length - 1;
    while (previousHistoryIndex >= 0 && historyRef.current[previousHistoryIndex]?.track.unavailable === true) {
      previousHistoryIndex -= 1;
    }
    const previousFromHistory = previousHistoryIndex >= 0 ? historyRef.current[previousHistoryIndex] : null;

    if (previousFromHistory) {
      const status = await playLocalTrack(previousFromHistory, { routeToConnectOutput: true });
      setHistory((current) => current.slice(0, previousHistoryIndex));
      commitPlayedItem(previousFromHistory, status, { recordHistory: false });
      return status;
    }

    const current = itemsRef.current;
    if (current.length === 0) {
      return null;
    }

    const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
    const beforeCurrent = currentIndex > 0
      ? [...current.slice(0, currentIndex)].reverse().find((item) => item.track.unavailable !== true) ?? null
      : null;
    const target = beforeCurrent ?? (
      repeatModeRef.current === 'all'
        ? [...current.slice(currentIndex + 1)].reverse().find((item) => item.track.unavailable !== true) ?? null
        : null
    );

    if (!target) {
      return null;
    }

    const status = await playLocalTrack(target, { routeToConnectOutput: true });
    commitPlayedItem(target, status, { recordHistory: false });
    return status;
  }, [commitPlayedItem, playLocalTrack, setHistory]);

  const playNext = useCallback(async (options: PlayNextOptions = {}): Promise<PlaybackStatus | null> => {
    const resolveStartedAtMs = performance.now();
    const current = itemsRef.current;
    const activeRepeatMode = repeatModeRef.current;
    const activeCurrentQueueId = currentQueueIdRef.current;
    const currentIndex = findCurrentIndex(current, activeCurrentQueueId, currentTrackIdRef.current);
    const activeItem = currentIndex >= 0 ? current[currentIndex] : findItemByQueueId(current, activeCurrentQueueId);
    const routeToConnectOutput =
      options.autoAdvance !== true ||
      hqPlayerTakeoverEnabledRef.current ||
      (await isConnectOutputActive());

    const repeatCurrentItem = async (): Promise<PlaybackStatus | null> => {
      if (activeItem) {
        logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, activeItem.track.id);
        const status = await playLocalTrack(activeItem, { routeToConnectOutput });
        commitPlayedItem(activeItem, status, { recordHistory: false });
        return status;
      }

      const fallbackTrack = lastPlayedTrackRef.current;
      logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, fallbackTrack?.id ?? null);
      return fallbackTrack ? playTrack(fallbackTrack, { routeToConnectOutput }) : null;
    };

    if (activeRepeatMode === 'one' && options.autoAdvance === true) {
      return repeatCurrentItem();
    }

    if (current.length === 0) {
      if (activeRepeatMode === 'one') {
        return repeatCurrentItem();
      }
      if (autoFillQueueEnabledRef.current) {
        await fillContinuousPlayQueue();
        let target = itemsRef.current.find((item) => item.track.unavailable !== true) ?? null;
        if (!target) {
          const fallbackItems = await fetchLibraryRandomQueueRefresh(libraryShuffleSource, null, 5, true);
          if (fallbackItems.length > 0) {
            setItems(fallbackItems);
            setHistory([]);
            target = fallbackItems[0] ?? null;
          }
        }
        if (target) {
          const status = await playLocalTrack(target, { routeToConnectOutput });
          commitPlayedItem(target, status);
          return status;
        }
      }
      return null;
    }

    const navigationRepeatMode = activeRepeatMode === 'one' ? 'off' : activeRepeatMode;
    let target: QueueItem | null = null;
    let refreshedRandomQueue: QueueItem[] | null = null;

    if (isShuffleEnabledRef.current) {
      let candidates: QueueItem[] = [];

      if (playlistPlaybackStateRef.current.active) {
        candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current, playbackShuffleAvoidRecentCountRef.current);
        target = pickRandom(candidates);

        if (!target && navigationRepeatMode === 'all') {
          candidates = current.filter((item) => item.track.unavailable !== true && item.queueId !== activeItem?.queueId);
          target = pickRandom(candidates);
        }

        if (!target && navigationRepeatMode === 'all') {
          target = activeItem && activeItem.track.unavailable !== true
            ? activeItem
            : current.find((item) => item.track.unavailable !== true) ?? null;
        }
      } else {
        const source = activeItem?.source ?? null;
        if (isFolderSource(source)) {
          const folderShuffleAvailable = Boolean(window.echo?.library?.getFolderTracks);
          target = await fetchFolderShuffleTarget(source, activeItem ?? null);
          if (!target && !folderShuffleAvailable && isFolderRandomSortSource(source)) {
            const refreshedItems = await fetchFolderRandomQueueRefresh(source, activeItem ?? null, current.length || 100);
            if (refreshedItems.length > 0) {
              refreshedRandomQueue = refreshedItems;
              target = refreshedItems[0] ?? null;
            }
          }

          if (!target && !folderShuffleAvailable) {
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current, playbackShuffleAvoidRecentCountRef.current);
            target = pickRandom(candidates);
          }

          if (!target && !folderShuffleAvailable && navigationRepeatMode === 'all') {
            candidates = current.filter((item) => item.track.unavailable !== true && item.queueId !== activeItem?.queueId);
            target = pickRandom(candidates);
          }

          if (!target && !folderShuffleAvailable && navigationRepeatMode === 'all') {
            target = activeItem && activeItem.track.unavailable !== true
              ? activeItem
              : current.find((item) => item.track.unavailable !== true) ?? null;
          }
        } else if (isLikedSource(source)) {
          target = await fetchLikedShuffleTarget(source, activeItem ?? null);
          if (!target) {
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current, playbackShuffleAvoidRecentCountRef.current);
            target = pickRandom(candidates);
          }

          if (!target && navigationRepeatMode === 'all') {
            candidates = current.filter((item) => item.track.unavailable !== true && item.queueId !== activeItem?.queueId);
            target = pickRandom(candidates);
          }

          if (!target && navigationRepeatMode === 'all') {
            target = activeItem && activeItem.track.unavailable !== true
              ? activeItem
              : current.find((item) => item.track.unavailable !== true) ?? null;
          }
        } else {
          const librarySource = isLibraryRandomSource(source) ? source : libraryShuffleSource;
          const libraryShuffleAvailable = Boolean(window.echo?.library?.getTracks);
          target = await fetchLibraryShuffleTarget(activeItem ?? null);
          if (!target && !libraryShuffleAvailable && isSongsRandomSortSource(librarySource)) {
            const refreshedItems = await fetchLibraryRandomQueueRefresh(librarySource, activeItem ?? null, current.length || 100);
            if (refreshedItems.length > 0) {
              refreshedRandomQueue = refreshedItems;
              target = refreshedItems[0] ?? null;
            }
          }

          if (!target && !libraryShuffleAvailable) {
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current, playbackShuffleAvoidRecentCountRef.current);
            target = pickRandom(candidates);
          }

          if (!target && !libraryShuffleAvailable && navigationRepeatMode === 'all') {
            candidates = current.filter((item) => item.track.unavailable !== true && item.queueId !== activeItem?.queueId);
            target = pickRandom(candidates);
          }

          if (!target && !libraryShuffleAvailable && navigationRepeatMode === 'all') {
            target = activeItem && activeItem.track.unavailable !== true
              ? activeItem
              : current.find((item) => item.track.unavailable !== true) ?? null;
          }
        }
      }
    } else if (currentIndex >= 0) {
      target = current.slice(currentIndex + 1).find((item) => item.track.unavailable !== true) ?? null;
      if (!target && isFolderRandomSortSource(activeItem?.source)) {
        refreshedRandomQueue = await fetchFolderRandomQueueRefresh(activeItem.source, activeItem, current.length || 100);
        target = refreshedRandomQueue[0] ?? null;
      } else if (!target && isSongsRandomSortSource(activeItem?.source)) {
        refreshedRandomQueue = await fetchLibraryRandomQueueRefresh(activeItem.source, activeItem, current.length || 100);
        target = refreshedRandomQueue[0] ?? null;
      } else if (!target && navigationRepeatMode === 'all' && activeItem) {
        target = resolveSequentialNextItem(current, activeItem, navigationRepeatMode);
      }
    } else if (currentIndex < 0) {
      target = current.find((item) => item.track.unavailable !== true) ?? null;
    }

    if (!target) {
      if (playlistPlaybackStateRef.current.active) {
        logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, null);
        return finishPlaylistSequence('next');
      }

      if (autoFillQueueEnabledRef.current) {
        await fillContinuousPlayQueue();
        const continuousCurrent = itemsRef.current;
        const continuousCurrentIndex = findCurrentIndex(
          continuousCurrent,
          currentQueueIdRef.current,
          currentTrackIdRef.current,
        );
        const continuousTarget = continuousCurrentIndex >= 0
          ? continuousCurrent.slice(continuousCurrentIndex + 1).find((item) => item.track.unavailable !== true) ?? null
          : continuousCurrent.find((item) => item.track.unavailable !== true) ?? null;
        if (continuousTarget) {
          logQueuePlaybackStep('playNext', 'resolve continuous play target', resolveStartedAtMs, continuousTarget.track.id);
          const status = await playLocalTrack(continuousTarget, { routeToConnectOutput });
          commitPlayedItem(continuousTarget, status);
          return status;
        }

        if (isFolderRandomSortSource(activeItem?.source)) {
          refreshedRandomQueue = await fetchFolderRandomQueueRefresh(activeItem.source, activeItem ?? null, libraryRandomQueueRefreshPageSize);
        } else if (isLikedSource(activeItem?.source)) {
          refreshedRandomQueue = await fetchLikedRandomQueueRefresh(activeItem.source, activeItem ?? null, libraryRandomQueueRefreshPageSize);
        } else {
          const source = isLibraryRandomSource(activeItem?.source) ? activeItem.source : libraryShuffleSource;
          refreshedRandomQueue = await fetchLibraryRandomQueueRefresh(
            source,
            activeItem ?? null,
            libraryRandomQueueRefreshPageSize,
            true,
          );
        }
        target = refreshedRandomQueue[0] ?? null;
        if (target) {
          logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, target.track.id);
          setItems(refreshedRandomQueue);
          setHistory([]);
          const status = await playLocalTrack(target, { routeToConnectOutput });
          commitPlayedItem(target, status);
          return status;
        }

        if (activeItem && activeItem.track.unavailable !== true) {
          logQueuePlaybackStep('playNext', 'repeat sole local radio track', resolveStartedAtMs, activeItem.track.id);
          const status = await playLocalTrack(activeItem, { routeToConnectOutput });
          commitPlayedItem(activeItem, status, { recordHistory: false });
          return status;
        }
      }

      logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, null);
      return activeRepeatMode === 'one' ? repeatCurrentItem() : null;
    }

    logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, target.track.id);

    if (refreshedRandomQueue) {
      setItems(refreshedRandomQueue);
      setHistory([]);
    }

    const status = await playLocalTrack(target, { routeToConnectOutput });
    if (!itemsRef.current.some((item) => item.queueId === target.queueId)) {
      setItems((items) => [...items, target]);
    }
    commitPlayedItem(target, status);
    return status;
  }, [commitPlayedItem, fetchFolderRandomQueueRefresh, fetchFolderShuffleTarget, fetchLibraryRandomQueueRefresh, fetchLibraryShuffleTarget, fetchLikedRandomQueueRefresh, fetchLikedShuffleTarget, fillContinuousPlayQueue, finishPlaylistSequence, isConnectOutputActive, playLocalTrack, playTrack, setHistory, setItems]);

  useEffect(() => {
    const audio = window.echo?.audio;
    if (!audio?.onStatus) {
      return undefined;
    }

    const handlePlaybackEnded = (status: AudioStatus): void => {
      if (status.state !== 'ended') {
        if (status.state === 'playing' || status.state === 'loading') {
          lastFallbackEndedIdentityRef.current = null;
        }
        return;
      }

      const activeTrackId = currentTrackIdRef.current;
      if (status.currentTrackId && activeTrackId && status.currentTrackId !== activeTrackId) {
        return;
      }

      const endedIdentity = status.currentTrackId ?? status.currentFilePath ?? currentQueueIdRef.current;
      if (!endedIdentity || lastFallbackEndedIdentityRef.current === endedIdentity) {
        return;
      }

      // A successful daemon queue advance remains in `playing` and is committed by
      // commitHostQueueAdvance above. Reaching a real `ended` state means that path
      // could not advance autonomously (for example a bridge/streaming backend), so
      // the renderer control plane must issue exactly one queue command.
      lastFallbackEndedIdentityRef.current = endedIdentity;
      void playNext({ autoAdvance: true }).catch((error) => {
        console.error('[Queue] failed to advance after playback ended:', error);
      });
    };

    const unsubscribe = audio.onStatus(handlePlaybackEnded);
    return () => {
      unsubscribe?.();
    };
  }, [playNext]);

  useEffect(() => {
    const status = sharedPlaybackStatus;
    if (!status) {
      return;
    }

    if (status.state !== 'ended') {
      if (status.state === 'playing' || status.state === 'loading') {
        lastFallbackEndedIdentityRef.current = null;
      }
      return;
    }

    const activeTrackId = currentTrackIdRef.current;
    if (status.currentTrackId && activeTrackId && status.currentTrackId !== activeTrackId) {
      return;
    }

    const endedIdentity = status.currentTrackId ?? status.filePath ?? currentQueueIdRef.current;
    if (!endedIdentity || lastFallbackEndedIdentityRef.current === endedIdentity) {
      return;
    }

    // Renderer-owned playback sources (notably Spotify and Connect) publish a
    // PlaybackStatus instead of an AudioStatus, but use the same queue policy.
    lastFallbackEndedIdentityRef.current = endedIdentity;
    void playNext({ autoAdvance: true }).catch((error) => {
      console.error('[Queue] failed to advance renderer playback after ended:', error);
    });
  }, [playNext, sharedPlaybackStatus]);

  useEffect(() => {
    window.echo?.playback?.setRepeatMode?.(repeatMode);
  }, [repeatMode]);

  // Sync queue items to the daemon backend for autonomous advancement
  useEffect(() => {
    if (!sessionHydrated) {
      return;
    }

    const queueItems: BackendQueueSyncItem[] = items.map((item) => ({
      itemId: item.queueId,
      trackId: item.track.id,
      filePath: item.track.path ?? '',
      sampleRate: item.track.sampleRate ?? undefined,
      startSeconds: 0,
      metadata: {
        title: item.track.title,
        artist: item.track.artist,
        album: item.track.album,
        albumArtist: item.track.albumArtist,
        coverUrl: item.track.coverThumb,
      },
    })).filter((item, index) => item.filePath && items[index]?.track.unavailable !== true);
    const backendCurrentQueueId = currentQueueId && queueItems.some((item) => item.itemId === currentQueueId)
      ? currentQueueId
      : null;

    void syncQueueSnapshotToBackend(queueItems, repeatMode, backendCurrentQueueId).catch((error) => {
      console.warn('[Queue] failed to sync queue snapshot to audio backend:', error);
    });
  }, [currentQueueId, items, repeatMode, sessionHydrated, syncQueueSnapshotToBackend]);

  const activateHqPlayerTakeover = useCallback(async (): Promise<PlaybackStatus | null> => {
    const activeItem =
      findItemByQueueId(itemsRef.current, currentQueueIdRef.current) ??
      (currentTrackIdRef.current
        ? itemsRef.current.find((item) => item.track.id === currentTrackIdRef.current) ?? null
        : null);

    if (activeItem) {
      const status = await playLocalTrack(activeItem, { routeToConnectOutput: true, forceHqPlayerConnect: true });
      commitPlayedItem(activeItem, status, { recordHistory: false });
      setHqPlayerTakeoverEnabled(true);
      return status;
    }

    const fallbackTrack = lastPlayedTrackRef.current;
    if (!fallbackTrack) {
      throw new Error(tq('queue.feedback.noHqPlayerTrack'));
    }

    const status = await playTrack(fallbackTrack, { routeToConnectOutput: true, forceHqPlayerConnect: true });
    setHqPlayerTakeoverEnabled(true);
    return status;
  }, [commitPlayedItem, playLocalTrack, playTrack, setHqPlayerTakeoverEnabled]);

  const setCurrentTrackId = useCallback(
    (trackId: string | null): void => {
      setCurrentTrackIdInternal(trackId);

      if (!trackId) {
        setCurrentQueueId(null);
        return;
      }

      const activeItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      if (activeItem?.track.id === trackId) {
        return;
      }

      setCurrentQueueId(itemsRef.current.find((item) => item.track.id === trackId)?.queueId ?? null);
    },
    [setCurrentQueueId, setCurrentTrackIdInternal],
  );

  const updateCurrentTrackSnapshot = useCallback(
    (
      patch: Partial<
        Pick<
          LibraryTrack,
          | 'duration'
          | 'coverThumb'
          | 'title'
          | 'artist'
          | 'album'
          | 'codec'
          | 'sampleRate'
          | 'bitDepth'
          | 'bitrate'
          | 'bpm'
          | 'bpmConfidence'
          | 'beatOffsetMs'
          | 'analysisStatus'
          | 'analysisUpdatedAt'
        >
      >,
    ): void => {
      const queueId = currentQueueIdRef.current;
      const trackId = currentTrackIdRef.current;
      setItems((current) =>
        current.map((item) =>
          (queueId && item.queueId === queueId) || (!queueId && trackId && item.track.id === trackId)
            ? { ...item, track: { ...item.track, ...patch } }
            : item,
        ),
      );
      if (lastPlayedTrackRef.current && trackId && lastPlayedTrackRef.current.id === trackId) {
        setLastPlayedTrack({ ...lastPlayedTrackRef.current, ...patch });
      }
      if (playbackHistorySessionRef.current && trackId && playbackHistorySessionRef.current.track.id === trackId) {
        playbackHistorySessionRef.current.track = {
          ...playbackHistorySessionRef.current.track,
          ...patch,
        };
      }
    },
    [setItems, setLastPlayedTrack],
  );

  const updateTrackSnapshot = useCallback(
    (
      trackId: string,
      patch: Partial<
        Pick<
          LibraryTrack,
          | 'duration'
          | 'coverThumb'
          | 'title'
          | 'artist'
          | 'album'
          | 'codec'
          | 'sampleRate'
          | 'bitDepth'
          | 'bitrate'
          | 'bpm'
          | 'bpmConfidence'
          | 'beatOffsetMs'
          | 'analysisStatus'
          | 'analysisUpdatedAt'
        >
      >,
    ): void => {
      setItems((current) =>
        current.map((item) => (item.track.id === trackId ? { ...item, track: { ...item.track, ...patch } } : item)),
      );
      if (lastPlayedTrackRef.current?.id === trackId) {
        setLastPlayedTrack({ ...lastPlayedTrackRef.current, ...patch });
      }
      if (playbackHistorySessionRef.current?.track.id === trackId) {
        playbackHistorySessionRef.current.track = {
          ...playbackHistorySessionRef.current.track,
          ...patch,
        };
      }
    },
    [setItems, setLastPlayedTrack],
  );
  updateTrackSnapshotRef.current = updateTrackSnapshot;

  const canGoPrevious = useMemo(() => {
    if (history.some((item) => item.track.unavailable !== true)) {
      return true;
    }

    const currentIndex = findCurrentIndex(items, currentQueueId, currentTrackId);
    const hasPlayableBefore = currentIndex > 0 && items.slice(0, currentIndex).some((item) => item.track.unavailable !== true);
    const hasOtherPlayable = items.some((item, index) => index !== currentIndex && item.track.unavailable !== true);
    return hasPlayableBefore || (repeatMode === 'all' && hasOtherPlayable);
  }, [currentQueueId, currentTrackId, history.length, items, repeatMode]);

  const canGoNext = useMemo(() => {
    if (repeatMode === 'one' && (currentItem || lastPlayedTrack)) {
      return true;
    }

    if (items.length === 0) {
      return autoFillQueueEnabled && Boolean(currentTrack || lastPlayedTrack);
    }

    const currentIndex = findCurrentIndex(items, currentQueueId, currentTrackId);

    if (isShuffleEnabled) {
      const activeItem = currentIndex >= 0 ? items[currentIndex] : findItemByQueueId(items, currentQueueId);
      if (isLibraryRandomSource(activeItem?.source)) {
        return true;
      }
      if (activeItem || currentTrack || lastPlayedTrack) {
        return true;
      }
      return getShuffleCandidates(items, activeItem ?? null, history, playbackShuffleAvoidRecentCount).length > 0 || repeatMode === 'all';
    }

    const activeItem = currentIndex >= 0 ? items[currentIndex] : findItemByQueueId(items, currentQueueId);
    if (autoFillQueueEnabled && (activeItem || currentTrack || lastPlayedTrack)) {
      return true;
    }
    if (currentIndex >= items.length - 1 && isSongsRandomSortSource(activeItem?.source)) {
      return true;
    }

    if (playlistPlaybackState.active && currentIndex >= items.length - 1 && playlistPlaybackState.snapshot) {
      return Boolean(resolveSnapshotResumeItem(playlistPlaybackState.snapshot, 'next'));
    }

    const hasPlayableAfter = currentIndex >= 0 &&
      items.slice(currentIndex + 1).some((item) => item.track.unavailable !== true);
    const hasAnyPlayable = items.some((item) => item.track.unavailable !== true);
    const hasOtherPlayable = items.some((item, index) => index !== currentIndex && item.track.unavailable !== true);
    return (currentIndex < 0 && hasAnyPlayable) || hasPlayableAfter || (repeatMode === 'all' && hasOtherPlayable);
  }, [autoFillQueueEnabled, currentItem, currentQueueId, currentTrackId, currentTrack, history, isShuffleEnabled, items, lastPlayedTrack, playbackShuffleAvoidRecentCount, playlistPlaybackState, repeatMode]);

  const value = useMemo<PlaybackQueueContextValue>(
    () => ({
      items,
      tracks: items.map((item) => item.track),
      currentItem,
      currentQueueId,
      currentTrack,
      currentTrackId,
      lastPlayedTrack,
      history,
      isShuffleEnabled,
      repeatMode,
      automixEnabled,
      autoFillQueueEnabled,
      continuousPlayMode,
      continuousPlayPreferences,
      isContinuousPlayFilling,
      hqPlayerTakeoverEnabled,
      gaplessPlaybackEnabled,
      playbackShuffleAvoidRecentCount,
      shuffleScopeLabel,
      currentSourceLabel,
      lastQueueFeedback,
      playlistPlayback: playlistPlaybackSummary,
      canGoPrevious,
      canGoNext,
      replaceQueue,
      appendToQueue,
      appendTracksToQueue,
      fillQueue,
      playTrackNext,
      playTracksNext,
      removeQueueItem,
      removeQueueItems,
      removeTrackFromQueue,
      setQueueItemsRemoveAfterPlay,
      clearQueue,
      removeContinuousPlayItems,
      moveQueueItem,
      moveQueueItemsToIndex,
      moveQueueItemsAfterCurrent,
      restoreQueueItems,
      playQueueItem,
      playTrack,
      playPlaylistSequence,
      exitPlaylistSequence,
      openTemporaryLocalFiles,
      playPrevious,
      playNext,
      activateHqPlayerTakeover,
      setHqPlayerTakeoverEnabled,
      setAutomixEnabled,
      setGaplessPlaybackEnabled,
      setAutoFillQueueEnabled,
      setContinuousPlayMode,
      reduceContinuousPlayFrequency,
      clearContinuousPlayPreferences,
      setCurrentTrackId,
      updateCurrentTrackSnapshot,
      updateTrackSnapshot,
      syncPlaybackState,
      toggleShuffle,
      setRepeatMode: setRepeatModeInternal,
      setPlaybackOrder,
    }),
    [
      appendToQueue,
      appendTracksToQueue,
      canGoNext,
      canGoPrevious,
      clearQueue,
      clearContinuousPlayPreferences,
      continuousPlayMode,
      continuousPlayPreferences,
      currentItem,
      currentQueueId,
      currentSourceLabel,
      currentTrack,
      currentTrackId,
      exitPlaylistSequence,
      fillQueue,
      history,
      activateHqPlayerTakeover,
      automixEnabled,
      autoFillQueueEnabled,
      isContinuousPlayFilling,
      hqPlayerTakeoverEnabled,
      gaplessPlaybackEnabled,
      isShuffleEnabled,
      items,
      lastPlayedTrack,
      lastQueueFeedback,
      moveQueueItem,
      moveQueueItemsAfterCurrent,
      moveQueueItemsToIndex,
      playNext,
      playPlaylistSequence,
      playPrevious,
      playQueueItem,
      playTrack,
      playbackShuffleAvoidRecentCount,
      playlistPlaybackSummary,
      setHqPlayerTakeoverEnabled,
      openTemporaryLocalFiles,
      playTrackNext,
      playTracksNext,
      removeQueueItem,
      removeQueueItems,
      removeTrackFromQueue,
      removeContinuousPlayItems,
      reduceContinuousPlayFrequency,
      setQueueItemsRemoveAfterPlay,
      repeatMode,
      restoreQueueItems,
      replaceQueue,
      setAutomixEnabled,
      setGaplessPlaybackEnabled,
      setAutoFillQueueEnabled,
      setContinuousPlayMode,
      setCurrentTrackId,
      updateCurrentTrackSnapshot,
      updateTrackSnapshot,
      setRepeatModeInternal,
      setPlaybackOrder,
      syncPlaybackState,
      shuffleScopeLabel,
      toggleShuffle,
    ],
  );

  return <PlaybackQueueContext.Provider value={value}>{sessionHydrated ? children : null}</PlaybackQueueContext.Provider>;
};

export const usePlaybackQueue = (): PlaybackQueueContextValue => {
  const context = useContext(PlaybackQueueContext);

  if (!context) {
    throw new Error('usePlaybackQueue must be used inside PlaybackQueueProvider');
  }

  return context;
};

export const useOptionalPlaybackQueue = (): PlaybackQueueContextValue | null =>
  useContext(PlaybackQueueContext);
