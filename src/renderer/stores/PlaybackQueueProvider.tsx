import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { AudioOutputSettings, AudioPlaybackState, AudioStatus, PlaybackSpeedMode } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { AirPlayReceiverStatus, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
import { hqPlayerConnectDeviceId } from '../../shared/types/connect';
import type { LibraryPlaylistItem, LibraryTrack, PlaylistSourceProvider } from '../../shared/types/library';
import type {
  LocalFileResolveResult,
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
import { isReliableBpmAnalysis } from '../../shared/constants/audioAnalysis';
import { isSpotifyTrack, pauseSpotifyPlayback, playSpotifyTrack } from '../integrations/spotify/spotifyPlayback';
import { isActiveConnectPlaybackStatus } from '../utils/connectPlayback';
import { beginPlaybackSwitchSnapshot, setPlaybackStatusSnapshot } from './playbackStatusStore';

const playbackCancellationErrorMessage = 'audio_session_run_cancelled';
const playbackHistoryChangedEvent = 'playback-history:changed';
const libraryShuffleCandidatePageSize = 128;
const libraryRandomQueueRefreshPageSize = 96;
const libraryShuffleExcludeHistoryLimit = 200;
const activePlaybackStates = new Set<AudioStatus['state']>(['loading', 'playing', 'paused']);
const automixLateArmWindowSeconds = 60;
const automixShortTrackArmRatio = 0.35;
const automixBpmAnalysisStatusPollMs = 1500;
const enhancedLowLoadMvSearchDelayMs = 8_000;
const gaplessLosslessCodecs = new Set(['flac', 'wav', 'wave', 'alac', 'aiff', 'aif', 'pcm']);
const gaplessLosslessExtensions = new Set(['flac', 'wav', 'wave', 'aiff', 'aif']);
const dsdCodecs = new Set(['dsd', 'dsf', 'dff', 'sacd']);
const clampPlaybackRate = (value: number): number => Math.max(0.5, Math.min(2, value));
const normalizePlaybackSpeedMode = (value: unknown): PlaybackSpeedMode | null =>
  value === 'daycore' || value === 'speed' || value === 'nightcore' ? value : null;

const hasPendingAutomixTransition = (automix: AudioStatus['automix']): boolean => {
  if (!automix?.active) {
    return false;
  }

  if (automix.mode === 'armed') {
    return true;
  }

  const plannedTrackCount = Number.isFinite(automix.plannedTrackCount) ? automix.plannedTrackCount ?? 0 : 0;
  const nextTransitionIndex = Number.isFinite(automix.nextTransitionIndex) ? automix.nextTransitionIndex ?? 0 : 0;
  if (plannedTrackCount <= 1) {
    return true;
  }

  return nextTransitionIndex < plannedTrackCount - 1;
};

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
});

export type RepeatMode = PersistedPlaybackRepeatMode;

type PlaybackModeMemory = {
  isShuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoFillQueueEnabled: boolean;
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

type PlayLocalTrackOptions = {
  routeToConnectOutput?: boolean;
  forceHqPlayerConnect?: boolean;
  startSeconds?: number;
  forceRefresh?: boolean;
  forceAutomix?: boolean;
  automixIncludeUpcoming?: boolean;
  automixProbeDurationSeconds?: number;
  silentRearm?: boolean;
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
  hqPlayerTakeoverEnabled: boolean;
  gaplessPlaybackEnabled: boolean;
  playlistPlayback: PlaylistPlaybackInfo;
  canGoPrevious: boolean;
  canGoNext: boolean;
  replaceQueue: (tracks: LibraryTrack[], options?: ReplaceQueueOptions) => void;
  appendToQueue: (track: LibraryTrack, source?: QueueSource) => void;
  appendTracksToQueue: (tracks: LibraryTrack[], source?: QueueSource) => void;
  playTrackNext: (track: LibraryTrack, source?: QueueSource) => void;
  removeQueueItem: (queueId: string) => void;
  removeTrackFromQueue: (trackId: string) => number;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
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
  setAutoFillQueueEnabled: (enabled: boolean) => void;
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
};

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

const PlaybackQueueContext = createContext<PlaybackQueueContextValue | null>(null);

const playbackModeMemoryKey = 'echo-next:playback-mode';
const automixEnabledMemoryKey = 'echo-next:automix-enabled';
const playbackQueueMemoryKey = 'echo-next:playback-queue';
const automixTemporarilyDisabled = true;

const defaultPlaybackModeMemory: PlaybackModeMemory = {
  isShuffleEnabled: false,
  repeatMode: 'off',
  autoFillQueueEnabled: false,
};

const defaultPlaybackQueueMemory: PlaybackQueueMemory = {
  version: 1,
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

const isRepeatMode = (value: unknown): value is RepeatMode => value === 'off' || value === 'one' || value === 'all';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const logQueuePlaybackStep = (
  operation: string,
  phase: string,
  startedAtMs: number,
  trackId?: string | null,
): void => {
  const durationMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  const message = `[playback-perf] ${operation}:${phase} ${durationMs}ms${trackId ? ` ${JSON.stringify({ trackId })}` : ''}`;
  if (durationMs >= slowQueuePlaybackStepWarnThresholdMs) {
    console.warn(`${message} SLOW probableCause=slow_renderer_playback_queue_phase actionHint=check renderer route, recent input, and matching main playback phase`);
    return;
  }

  console.info(message);
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
  ['songs', 'album', 'artist', 'folder', 'liked', 'streaming', 'local-file', 'manual'].includes(value.type);

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
    return window.localStorage.getItem(automixEnabledMemoryKey) === 'true';
  } catch {
    return false;
  }
};

const writeAutomixEnabledMemory = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(automixEnabledMemoryKey, enabled && !automixTemporarilyDisabled ? 'true' : 'false');
  } catch {
    // Automix is optional; storage failures should not block playback.
  }
};

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
    window.localStorage.removeItem(playbackQueueMemoryKey);
    window.localStorage.removeItem(playbackModeMemoryKey);
    window.localStorage.removeItem(automixEnabledMemoryKey);
  } catch {
    // Legacy migration cleanup is best-effort.
  }
};

const readLegacyPlaybackSession = (): HydratedPlaybackSession => ({
  ...readPlaybackQueueMemory(),
  mode: readPlaybackModeMemory(),
  automixEnabled: automixTemporarilyDisabled ? false : readAutomixEnabledMemory(),
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
  (!automixTemporarilyDisabled && session.automixEnabled);

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
    },
    automixEnabled: !automixTemporarilyDisabled && snapshot.mode?.automixEnabled === true,
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
    },
    automixEnabled: !automixTemporarilyDisabled && session.mode?.automixEnabled === true,
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
  },
  resume: isResumeMemory(snapshot.resume, snapshot.items) ? snapshot.resume : null,
});

const createPersistedSessionSnapshot = (session: HydratedPlaybackSession): PersistedPlaybackSessionV1 => ({
  version: 1,
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
    existingTrack.providerTrackId !== requestedTrack.providerTrackId
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
  track.analysisStatus !== 'analyzing' &&
  !isReliableBpmAnalysis(track.bpm, track.bpmConfidence, track.analysisStatus);

const resolveAutomixArmStartSeconds = (durationSeconds: number): number => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  if (durationSeconds > automixLateArmWindowSeconds) {
    return Math.max(0, durationSeconds - automixLateArmWindowSeconds);
  }

  return Math.max(1, Math.min(Math.max(1, durationSeconds - 4.5), durationSeconds * automixShortTrackArmRatio));
};

const shouldArmAutomixForPlaybackStart = (track: LibraryTrack, startSeconds: number | undefined, forceAutomix: boolean): boolean => {
  if (forceAutomix) {
    return true;
  }

  const durationSeconds = Number(track.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }

  return Math.max(0, startSeconds ?? 0) >= resolveAutomixArmStartSeconds(durationSeconds);
};

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

  return nextInPlaybackOrder ?? items.find((candidate, index) => index !== currentIndex && candidate.track.id === toTrackId) ?? null;
};

const resolveSequentialNextItem = (items: QueueItem[], item: QueueItem, repeatMode: RepeatMode): QueueItem | null => {
  const index = items.findIndex((candidate) => candidate.queueId === item.queueId);
  if (index >= 0 && index < items.length - 1) {
    return items[index + 1] ?? null;
  }

  return index === items.length - 1 && repeatMode === 'all' && items.length > 1 ? items[0] ?? null : null;
};

const resolveSnapshotResumeItem = (snapshot: PlaylistPlaybackSnapshot, mode: 'current' | 'next'): QueueItem | null => {
  if (snapshot.items.length === 0) {
    return null;
  }

  const currentIndex = findCurrentIndex(snapshot.items, snapshot.currentQueueId, snapshot.currentTrackId);
  if (mode === 'current') {
    return currentIndex >= 0 ? snapshot.items[currentIndex] ?? null : snapshot.items[0] ?? null;
  }

  if (currentIndex < 0) {
    return snapshot.items[0] ?? null;
  }

  if (currentIndex < snapshot.items.length - 1) {
    return snapshot.items[currentIndex + 1] ?? null;
  }

  return snapshot.mode.repeatMode === 'all' && snapshot.items.length > 1 ? snapshot.items[0] ?? null : null;
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

const resolveShuffleAutomixNextItem = (items: QueueItem[], item: QueueItem, history: QueueItem[], repeatMode: RepeatMode): QueueItem | null => {
  const candidates = getShuffleCandidates(items, item, history).filter((candidate) => isAutomixQueueCandidate(candidate.track));
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

const getShuffleCandidates = (items: QueueItem[], activeItem: QueueItem | null, history: QueueItem[]): QueueItem[] => {
  const excludedQueueIds = new Set(history.map((item) => item.queueId));

  if (activeItem) {
    excludedQueueIds.add(activeItem.queueId);
  }

  return items.filter((item) => !excludedQueueIds.has(item.queueId));
};

const getLibraryShuffleExcludedTrackIds = (activeItem: QueueItem | null, history: QueueItem[]): string[] => {
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
  for (const item of history.slice(-libraryShuffleExcludeHistoryLimit).reverse()) {
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

  return ['songs', source.search ?? '', source.sort ?? '', source.hideDuplicates === true ? 'hide-duplicates' : '', source.showDuplicatesOnly === true ? 'duplicates-only' : ''].join('\0');
};

const pickRandom = <Item,>(items: Item[]): Item | null => items[Math.floor(Math.random() * items.length)] ?? null;

const clampMoveIndex = (index: number, length: number): number => Math.max(0, Math.min(index, length - 1));

const isCompletedPlayback = (playedSeconds: number, durationSeconds: number): boolean =>
  durationSeconds > 0 ? playedSeconds >= 30 || playedSeconds >= durationSeconds * 0.5 : playedSeconds >= 30;

export const PlaybackQueueProvider = ({ children }: PropsWithChildren): JSX.Element => {
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
  const [hqPlayerTakeoverEnabled, setHqPlayerTakeoverEnabledState] = useState(readHqPlayerTakeoverEnabled);
  const [gaplessPlaybackEnabled, setGaplessPlaybackEnabledState] = useState(false);
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
  const hqPlayerTakeoverEnabledRef = useRef(hqPlayerTakeoverEnabled);
  const gaplessPlaybackEnabledRef = useRef(gaplessPlaybackEnabled);
  const audioAnalysisEnabledRef = useRef<boolean | null>(null);
  const lowLoadPlaybackModeEnabledRef = useRef(false);
  const lowLoadPlaybackEnhancementsEnabledRef = useRef(false);
  const enhancedLowLoadPlaybackActiveRef = useRef(false);
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
  const automixLateArmRef = useRef<{ queueId: string; trackId: string } | null>(null);
  const automixShuffleNextQueueIdRef = useRef<Map<string, string>>(new Map());
  const cancelPlaybackSessionPersistRef = useRef<(() => void) | null>(null);
  const updateTrackSnapshotRef = useRef<PlaybackQueueContextValue['updateTrackSnapshot']>(() => undefined);
  const sessionHydratedRef = useRef(sessionHydrated);
  const suppressNextSessionPersistenceRef = useRef(false);

  const setItems = useCallback((nextItems: QueueItem[] | ((current: QueueItem[]) => QueueItem[])): void => {
    const resolved = typeof nextItems === 'function' ? nextItems(itemsRef.current) : nextItems;
    itemsRef.current = resolved;
    setItemsState(resolved);
  }, []);

  const setCurrentQueueId = useCallback((queueId: string | null): void => {
    currentQueueIdRef.current = queueId;
    setCurrentQueueIdState(queueId);
  }, []);

  const setCurrentTrackIdInternal = useCallback((trackId: string | null): void => {
    currentTrackIdRef.current = trackId;
    setCurrentTrackIdState(trackId);
  }, []);

  const setLastPlayedTrack = useCallback((track: LibraryTrack | null): void => {
    lastPlayedTrackRef.current = track;
    setLastPlayedTrackState(track);
  }, []);

  const setHistory = useCallback((nextHistory: QueueItem[] | ((current: QueueItem[]) => QueueItem[])): void => {
    const resolved = typeof nextHistory === 'function' ? nextHistory(historyRef.current) : nextHistory;
    historyRef.current = resolved;
    setHistoryState(resolved);
  }, []);

  const setPlaylistPlaybackStateInternal = useCallback((state: PlaylistPlaybackState): void => {
    playlistPlaybackStateRef.current = state;
    setPlaylistPlaybackState(state);
  }, []);

  const setResumeMemory = useCallback((resume: PersistedPlaybackSessionResume | null): void => {
    resumeMemoryRef.current = resume;
    setResumeMemoryState(resume);
  }, []);

  const setHqPlayerTakeoverEnabled = useCallback((enabled: boolean): void => {
    hqPlayerTakeoverEnabledRef.current = enabled;
    setHqPlayerTakeoverEnabledState(enabled);
    writeHqPlayerTakeoverEnabled(enabled);
  }, []);

  const setRepeatModeInternal = useCallback((mode: RepeatMode): void => {
    repeatModeRef.current = mode;
    setRepeatMode(mode);
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: mode,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
      });
    }
  }, []);

  const clearLibraryShuffleDeck = useCallback((): void => {
    libraryShuffleDeckRef.current = { sourceKey: null, items: [] };
  }, []);

  const toggleShuffle = useCallback((): void => {
    const next = !isShuffleEnabledRef.current;
    clearLibraryShuffleDeck();
    isShuffleEnabledRef.current = next;
    setIsShuffleEnabled(next);
    if (next && repeatModeRef.current === 'all') {
      setRepeatModeInternal('off');
    } else if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: next,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: autoFillQueueEnabledRef.current,
      });
    }
  }, [clearLibraryShuffleDeck, setRepeatModeInternal]);

  const setAutoFillQueueEnabled = useCallback((enabled: boolean): void => {
    autoFillQueueEnabledRef.current = enabled;
    setAutoFillQueueEnabledState(enabled);
    if (shouldUseLegacyPlaybackStorage()) {
      writePlaybackModeMemory({
        isShuffleEnabled: isShuffleEnabledRef.current,
        repeatMode: repeatModeRef.current,
        autoFillQueueEnabled: enabled,
      });
    }
  }, []);

  const setAutomixEnabled = useCallback((enabled: boolean): void => {
    automixEnabledRef.current = enabled;
    setAutomixEnabledState(enabled);
    if (shouldUseLegacyPlaybackStorage()) {
      writeAutomixEnabledMemory(enabled);
    }
    if (enabled) {
      const currentItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
      if (currentItem) {
        prepareNextMediaItemRef.current(currentItem);
      }
    }
  }, []);

  const applyHydratedPlaybackSession = useCallback(
    (session: HydratedPlaybackSession): void => {
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
      const hydratedAutomixEnabled = automixTemporarilyDisabled ? false : session.automixEnabled;
      automixEnabledRef.current = hydratedAutomixEnabled;
      setAutomixEnabledState(hydratedAutomixEnabled);
      setPlaylistPlaybackStateInternal(session.playlistPlayback ?? defaultPlaylistPlaybackState);
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
      const nextAutomixEnabled = automixTemporarilyDisabled ? false : snapshot.automixEnabled;
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
      },
      automixEnabled: automixTemporarilyDisabled ? false : automixEnabledRef.current,
      playlistPlayback: playlistState.active && playlistState.snapshot ? playlistState : null,
    });
  }, []);

  const persistPlaybackSessionNow = useCallback(async (): Promise<void> => {
    if (!sessionHydratedRef.current) {
      return;
    }

    const snapshot = createCurrentPersistedSession();
    const broadcastSnapshot = createCurrentBroadcastSession();
    const playback = window.echo?.playback;
    if (playback?.saveQueueSession) {
      try {
        const saved = await playback.saveQueueSession(snapshot, { broadcastSnapshot });
        const savedResume = playbackSessionFromPersisted(saved).resume;
        if (resumeMemoryRef.current && !savedResume) {
          setResumeMemory(null);
        }
      } catch {
        // Persistence failures should not interrupt playback controls.
      }
      return;
    }

    writePlaybackQueueMemory(snapshot);
    writePlaybackModeMemory({
      isShuffleEnabled: snapshot.mode.isShuffleEnabled,
      repeatMode: snapshot.mode.repeatMode,
      autoFillQueueEnabled: snapshot.mode.autoFillQueueEnabled === true,
    });
    writeAutomixEnabledMemory(snapshot.mode.automixEnabled);
  }, [createCurrentBroadcastSession, createCurrentPersistedSession, setResumeMemory]);

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
  }, []);

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
          await playback.saveQueueSession?.(createPersistedSessionSnapshot(legacySession)).catch(() => null);
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
      suppressNextSessionPersistenceRef.current = true;
      applyHydratedPlaybackSession(playbackSessionFromPersisted(snapshot));
      sessionHydratedRef.current = true;
      setSessionHydrated(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, [applyHydratedPlaybackSession]);

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

      try {
        await finishPlaybackHistoryRecord(record);
      } catch {
        // History writes should never interrupt playback controls.
      }
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

    const next = resolveShuffleAutomixNextItem(current, item, historyRef.current, repeatModeRef.current);
    if (next) {
      automixShuffleNextQueueIdRef.current.set(item.queueId, next.queueId);
    } else {
      automixShuffleNextQueueIdRef.current.delete(item.queueId);
    }

    return next;
  }, []);

  const createAutomixOptions = useCallback((item: QueueItem, options: { startSeconds?: number; force?: boolean; includeUpcoming?: boolean } = {}): {
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
    if (!shouldArmAutomixForPlaybackStart(item.track, options.startSeconds, options.force === true)) {
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
    const includeUpcoming = options.includeUpcoming !== false;

    return {
      enabled: true,
      maxTransitionSeconds: 16,
      beatAlignEnabled: true,
      nextItem: toPlayableTrack(next.track),
      nextProbe: createProbeFromTrack(next.track),
      ...(includeUpcoming && upcoming.length > 0
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

    return {
      enabled: true,
      nextItem: toPlayableTrack(next.track),
      nextProbe: createProbeFromTrack(next.track),
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
    const requestToken = playRequestTokenRef.current + 1;
    playRequestTokenRef.current = requestToken;

    const previousItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);
    const shouldPausePreviousSpotify = Boolean(previousItem && isSpotifyTrack(previousItem.track) && !isSpotifyTrack(track));
    const requestedStartSeconds =
      typeof options.startSeconds === 'number' && Number.isFinite(options.startSeconds)
        ? Math.max(0, options.startSeconds)
        : undefined;
    const resumeStartSeconds = requestedStartSeconds ?? getResumeStartSecondsForItem(item);
    if (options.forceAutomix !== true) {
      automixLateArmRef.current = null;
    }
    const automix = runQueuePlaybackStepSync(operation, 'resolve automix', track.id, () => createAutomixOptions(item, {
      startSeconds: resumeStartSeconds,
      force: options.forceAutomix === true,
      includeUpcoming: options.automixIncludeUpcoming !== false,
    }));
    const silentRearm = options.silentRearm === true && options.forceAutomix === true;
    if (!silentRearm) {
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
    }
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
                    ...(automixEnabledRef.current === true && !silentRearm ? { automixAnalyze: true } : {}),
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
                    probe: createProbeFromTrack(track, { durationSeconds: options.automixProbeDurationSeconds }),
                    replayGain: replayGainFromTrack(track),
                    ...(automixEnabledRef.current === true && !silentRearm ? { automixAnalyze: true } : {}),
                    automix,
                    gapless,
                  }),
              );
            })();
      } catch (error) {
        if (playRequestTokenRef.current !== requestToken) {
          throw new Error(playbackCancellationErrorMessage);
        }

        if (!silentRearm) {
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
        }
        throw error;
      }
    })();
    if (!silentRearm && resumeMemoryRef.current) {
      setResumeMemory(null);
    }
    const status = playbackStatusForItem(rawStatus, item, resumeStartSeconds ?? 0);
    playbackStatusTokensRef.current.set(status, requestToken);
    playbackStatusPreviousItemRef.current.set(status, previousItem);
    if (!silentRearm && playRequestTokenRef.current === requestToken) {
      schedulePlaybackHistoryStart(item);
    }
    return status;
  }, [createAutomixOptions, createGaplessOptions, getResumeStartSecondsForItem, playConnectOutputTrack, schedulePlaybackHistoryFinish, schedulePlaybackHistoryStart, setCurrentQueueId, setCurrentTrackIdInternal, setLastPlayedTrack, setResumeMemory]);

  useEffect(() => {
    const audio = window.echo?.audio;
    if (!audio?.onStatus) {
      return undefined;
    }

    let arming = false;
    const maybeArmAutomix = (status: AudioStatus): void => {
      if (
        arming ||
        !automixEnabledRef.current ||
        status.state !== 'playing' ||
        hasPendingAutomixTransition(status.automix)
      ) {
        return;
      }

      const item =
        findItemByQueueId(itemsRef.current, currentQueueIdRef.current) ??
        itemsRef.current.find((candidate) => candidate.track.id === status.currentTrackId) ??
        null;
      if (!item || isSpotifyTrack(item.track) || item.track.id !== status.currentTrackId) {
        return;
      }

      const durationSeconds = status.durationSeconds > 0 ? status.durationSeconds : item.track.duration;
      const positionSeconds = Math.max(0, status.positionSeconds);
      if (
        positionSeconds < resolveAutomixArmStartSeconds(durationSeconds) ||
        positionSeconds >= durationSeconds - 4
      ) {
        return;
      }

      const armKey = { queueId: item.queueId, trackId: item.track.id };
      const previousArm = automixLateArmRef.current;
      if (previousArm?.queueId === armKey.queueId && previousArm.trackId === armKey.trackId) {
        return;
      }
      if (!createAutomixOptions(item, { startSeconds: positionSeconds, force: true })) {
        return;
      }

      const itemForAutomix =
        durationSeconds > 0 && item.track.duration <= 0
          ? { ...item, track: { ...item.track, duration: durationSeconds } }
          : item;
      if (itemForAutomix !== item) {
        setItems((current) => current.map((candidate) => (candidate.queueId === item.queueId ? itemForAutomix : candidate)));
      }

      automixLateArmRef.current = armKey;
      arming = true;
      void playLocalTrack(itemForAutomix, {
        routeToConnectOutput: false,
        startSeconds: positionSeconds,
        forceAutomix: true,
        automixIncludeUpcoming: false,
        automixProbeDurationSeconds: durationSeconds,
        silentRearm: true,
      })
        .then((nextStatus) => {
          setPlaybackStatusSnapshot({
            playbackStatus: playbackStatusForItem(nextStatus, item, positionSeconds),
            error: null,
          });
        })
        .catch(() => {
          automixLateArmRef.current = null;
        })
        .finally(() => {
          arming = false;
        });
    };

    const unsubscribe = audio.onStatus(maybeArmAutomix);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [createAutomixOptions, playLocalTrack]);

  const autoSearchMv = useCallback((trackId: string): void => {
    const mvApi = window.echo?.mv;
    if (!mvApi?.getSelected) {
      return;
    }

    cancelAutoSearchMvRef.current?.();
    const enhancedLowLoadActive = enhancedLowLoadPlaybackActiveRef.current;
    cancelAutoSearchMvRef.current = deferQueueBackgroundTask(() => {
      cancelAutoSearchMvRef.current = null;
      void runQueuePlaybackStep('playLocalTrack', 'autoSearchMv', trackId, async () => {
        const settings = await mvApi.getSettings?.();
        if (!enhancedLowLoadActive) {
          const candidates = settings?.enabled !== false && settings?.autoSearch && mvApi.searchNetworkCandidates ? await mvApi.searchNetworkCandidates(trackId) : [];
          window.dispatchEvent(new CustomEvent('mv:candidatesChanged', { detail: { trackId, candidates } }));
        }
        await mvApi.getSelected(trackId);
        window.dispatchEvent(new CustomEvent('mv:changed', { detail: { trackId } }));
      }).catch(() => undefined);
    }, { delayMs: enhancedLowLoadActive ? enhancedLowLoadMvSearchDelayMs : postSwitchBackgroundDelayMs });
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
    const index = current.findIndex((candidate) => candidate.queueId === item.queueId);
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
    const unsubscribe = window.echo?.playback?.onAutomixAdvance?.((event) => {
      const next = findAutomixAdvanceItem(itemsRef.current, currentQueueIdRef.current, currentTrackIdRef.current, event.toTrackId);
      if (!next) {
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
      setItems((current) => [...current, createQueueItem(track, source)]);
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
  );

  const appendTracksToQueue = useCallback(
    (tracks: LibraryTrack[], source: QueueSource = manualSource): void => {
      if (tracks.length === 0) {
        return;
      }

      restorePlaylistPlaybackSnapshotOnly();
      setItems((current) => [...current, ...tracks.map((track) => createQueueItem(track, source))]);
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
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
    },
    [restorePlaylistPlaybackSnapshotOnly, setItems],
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

  const removeTrackFromQueue = useCallback(
    (trackId: string): number => {
      restorePlaylistPlaybackSnapshotOnly();
      const queuedCount = itemsRef.current.filter((item) => item.track.id === trackId).length;
      if (queuedCount === 0) {
        return 0;
      }

      const wasCurrentTrack = findItemByQueueId(itemsRef.current, currentQueueIdRef.current)?.track.id === trackId;
      setItems((current) => current.filter((item) => item.track.id !== trackId));
      setHistory((current) => current.filter((item) => item.track.id !== trackId));

      if (wasCurrentTrack) {
        setCurrentQueueId(null);
      }

      return queuedCount;
    },
    [restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setHistory, setItems],
  );

  const clearQueue = useCallback((): void => {
    restorePlaylistPlaybackSnapshotOnly();
    clearLibraryShuffleDeck();
    setItems([]);
    setHistory([]);
    setCurrentQueueId(null);
  }, [clearLibraryShuffleDeck, restorePlaylistPlaybackSnapshotOnly, setCurrentQueueId, setHistory, setItems]);

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
        const excludedTrackIds = new Set(getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current));
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
        const libraryExcludeTrackIds = getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current);
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
        const excludedTrackIds = new Set(getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current));
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
        const folderExcludeTrackIds = getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current);
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
        const excludedTrackIds = new Set(getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current));
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
        const excludedTrackIds = new Set(getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current));
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
    async (source: Extract<QueueSource, { type: 'songs' }>, activeItem: QueueItem | null, pageSize: number): Promise<QueueItem[]> => {
      const library = window.echo?.library;

      if (!library?.getTracks) {
        return [];
      }

      try {
        const excludeTrackIds = getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current);
        const result = await library.getTracks({
          page: 1,
          pageSize: Math.max(2, Math.min(pageSize, libraryRandomQueueRefreshPageSize)),
          search: undefined,
          sort: 'random',
          hideDuplicates: undefined,
          showDuplicatesOnly: undefined,
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
        const excludeTrackIds = getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current);
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
        const excludeTrackIds = new Set(getLibraryShuffleExcludedTrackIds(activeItem, historyRef.current));
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

  const playTrack = useCallback(
    async (track: LibraryTrack, options: PlayTrackOptions = {}): Promise<PlaybackStatus> => {
      if (options.preservePlaylistPlayback !== true) {
        restorePlaylistPlaybackSnapshotOnly();
      }
      const source = options.source ?? manualSource;
      const replacementTracks = options.replaceQueueWith;
      const previousItem = findItemByQueueId(itemsRef.current, currentQueueIdRef.current);

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
    const previousFromHistory = historyRef.current[historyRef.current.length - 1];

    if (previousFromHistory) {
      const status = await playLocalTrack(previousFromHistory, { routeToConnectOutput: true });
      setHistory((current) => current.slice(0, -1));
      commitPlayedItem(previousFromHistory, status, { recordHistory: false });
      return status;
    }

    const current = itemsRef.current;
    if (current.length === 0) {
      return null;
    }

    const currentIndex = findCurrentIndex(current, currentQueueIdRef.current, currentTrackIdRef.current);
    const targetIndex =
      currentIndex > 0
        ? currentIndex - 1
        : repeatModeRef.current === 'all' && current.length > 1
          ? current.length - 1
          : -1;
    const target = targetIndex >= 0 ? current[targetIndex] : null;

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
      return activeRepeatMode === 'one' ? repeatCurrentItem() : null;
    }

    const navigationRepeatMode = activeRepeatMode === 'one' ? 'off' : activeRepeatMode;
    let target: QueueItem | null = null;
    let refreshedRandomQueue: QueueItem[] | null = null;

    if (isShuffleEnabledRef.current) {
      let candidates: QueueItem[] = [];

      if (playlistPlaybackStateRef.current.active) {
        candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current);
        target = pickRandom(candidates);

        if (!target && navigationRepeatMode === 'all') {
          candidates = activeItem ? current.filter((item) => item.queueId !== activeItem.queueId) : current;
          target = pickRandom(candidates);
        }

        if (!target && navigationRepeatMode === 'all') {
          target = activeItem ?? current[0] ?? null;
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
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current);
            target = pickRandom(candidates);
          }

          if (!target && !folderShuffleAvailable && navigationRepeatMode === 'all') {
            candidates = activeItem ? current.filter((item) => item.queueId !== activeItem.queueId) : current;
            target = pickRandom(candidates);
          }

          if (!target && !folderShuffleAvailable && navigationRepeatMode === 'all') {
            target = activeItem ?? current[0] ?? null;
          }
        } else if (isLikedSource(source)) {
          target = await fetchLikedShuffleTarget(source, activeItem ?? null);
          if (!target) {
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current);
            target = pickRandom(candidates);
          }

          if (!target && navigationRepeatMode === 'all') {
            candidates = activeItem ? current.filter((item) => item.queueId !== activeItem.queueId) : current;
            target = pickRandom(candidates);
          }

          if (!target && navigationRepeatMode === 'all') {
            target = activeItem ?? current[0] ?? null;
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
            candidates = getShuffleCandidates(current, activeItem ?? null, historyRef.current);
            target = pickRandom(candidates);
          }

          if (!target && !libraryShuffleAvailable && navigationRepeatMode === 'all') {
            candidates = activeItem ? current.filter((item) => item.queueId !== activeItem.queueId) : current;
            target = pickRandom(candidates);
          }

          if (!target && !libraryShuffleAvailable && navigationRepeatMode === 'all') {
            target = activeItem ?? current[0] ?? null;
          }
        }
      }
    } else if (currentIndex >= 0 && currentIndex < current.length - 1) {
      target = current[currentIndex + 1] ?? null;
    } else if (currentIndex < 0) {
      target = current[0] ?? null;
    } else if (isFolderRandomSortSource(activeItem?.source)) {
      refreshedRandomQueue = await fetchFolderRandomQueueRefresh(activeItem.source, activeItem, current.length || 100);
      target = refreshedRandomQueue[0] ?? null;
    } else if (isSongsRandomSortSource(activeItem?.source)) {
      refreshedRandomQueue = await fetchLibraryRandomQueueRefresh(activeItem.source, activeItem, current.length || 100);
      target = refreshedRandomQueue[0] ?? null;
    } else if (navigationRepeatMode === 'all') {
      target = current[0] ?? null;
    }

    if (!target) {
      if (playlistPlaybackStateRef.current.active) {
        logQueuePlaybackStep('playNext', 'resolve target', resolveStartedAtMs, null);
        return finishPlaylistSequence('next');
      }

      if (options.autoAdvance === true && autoFillQueueEnabledRef.current) {
        if (isFolderRandomSortSource(activeItem?.source)) {
          refreshedRandomQueue = await fetchFolderRandomQueueRefresh(activeItem.source, activeItem ?? null, libraryRandomQueueRefreshPageSize);
        } else if (isLikedSource(activeItem?.source)) {
          refreshedRandomQueue = await fetchLikedRandomQueueRefresh(activeItem.source, activeItem ?? null, libraryRandomQueueRefreshPageSize);
        } else {
          const source = isLibraryRandomSource(activeItem?.source) ? activeItem.source : libraryShuffleSource;
          refreshedRandomQueue = await fetchLibraryRandomQueueRefresh(source, activeItem ?? null, libraryRandomQueueRefreshPageSize);
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
  }, [commitPlayedItem, fetchFolderRandomQueueRefresh, fetchFolderShuffleTarget, fetchLibraryRandomQueueRefresh, fetchLibraryShuffleTarget, fetchLikedRandomQueueRefresh, fetchLikedShuffleTarget, finishPlaylistSequence, isConnectOutputActive, playLocalTrack, playTrack, setHistory, setItems]);

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
      throw new Error('没有可交给 HQPlayer 的当前歌曲。');
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
    if (history.length > 0) {
      return true;
    }

    const currentIndex = findCurrentIndex(items, currentQueueId, currentTrackId);
    return currentIndex > 0 || (repeatMode === 'all' && items.length > 1);
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
      return getShuffleCandidates(items, activeItem ?? null, history).length > 0 || repeatMode === 'all';
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

    return currentIndex < 0 || currentIndex < items.length - 1 || repeatMode === 'all';
  }, [autoFillQueueEnabled, currentItem, currentQueueId, currentTrackId, currentTrack, history, isShuffleEnabled, items, lastPlayedTrack, playlistPlaybackState, repeatMode]);

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
      hqPlayerTakeoverEnabled,
      gaplessPlaybackEnabled,
      playlistPlayback: {
        active: playlistPlaybackState.active,
        label: playlistPlaybackState.label,
        playlistId: playlistPlaybackState.playlistId,
      },
      canGoPrevious,
      canGoNext,
      replaceQueue,
      appendToQueue,
      appendTracksToQueue,
      playTrackNext,
      removeQueueItem,
      removeTrackFromQueue,
      clearQueue,
      moveQueueItem,
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
      setAutoFillQueueEnabled,
      setCurrentTrackId,
      updateCurrentTrackSnapshot,
      updateTrackSnapshot,
      syncPlaybackState,
      toggleShuffle,
      setRepeatMode: setRepeatModeInternal,
    }),
    [
      appendToQueue,
      appendTracksToQueue,
      canGoNext,
      canGoPrevious,
      clearQueue,
      currentItem,
      currentQueueId,
      currentTrack,
      currentTrackId,
      exitPlaylistSequence,
      history,
      activateHqPlayerTakeover,
      automixEnabled,
      autoFillQueueEnabled,
      hqPlayerTakeoverEnabled,
      gaplessPlaybackEnabled,
      isShuffleEnabled,
      items,
      lastPlayedTrack,
      moveQueueItem,
      playNext,
      playPlaylistSequence,
      playPrevious,
      playQueueItem,
      playTrack,
      playlistPlaybackState,
      setHqPlayerTakeoverEnabled,
      openTemporaryLocalFiles,
      playTrackNext,
      removeQueueItem,
      removeTrackFromQueue,
      repeatMode,
      replaceQueue,
      setAutomixEnabled,
      setAutoFillQueueEnabled,
      setCurrentTrackId,
      updateCurrentTrackSnapshot,
      updateTrackSnapshot,
      setRepeatModeInternal,
      syncPlaybackState,
      toggleShuffle,
    ],
  );

  return <PlaybackQueueContext.Provider value={value}>{children}</PlaybackQueueContext.Provider>;
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
