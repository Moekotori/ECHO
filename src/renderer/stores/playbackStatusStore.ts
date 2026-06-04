import { useSyncExternalStore } from 'react';
import type { AudioPlaybackState, AudioStatus } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { ConnectSessionStatus } from '../../shared/types/connect';
import type { PlaybackStatus } from '../../shared/types/playback';
import {
  isActiveConnectPlaybackStatus,
  playbackStatusFromConnectStatus,
} from '../utils/connectPlayback';
import { logLyricsConsole } from '../diagnostics/lyricsConsole';

type PlaybackVisualIntent = {
  type: 'track-switch' | 'seek';
  state: 'playing';
  currentTrackId: string | null;
  filePath: string | null;
  expectedPositionMs: number;
  startedAtMs: number;
};

type PlaybackStatusSnapshot = {
  audioStatus: AudioStatus | null;
  playbackStatus: PlaybackStatus | null;
  playbackVisualIntent: PlaybackVisualIntent | null;
  error: string | null;
  version: number;
};

const idlePollingStates = new Set(['paused', 'stopped', 'idle', 'error']);
const activePollingIntervalMs = 500;
const enhancedLowLoadActivePollingIntervalMs = 1800;
const idlePollingIntervalMs = 2000;
const trackSwitchVisualIntentGuardMs = 2500;
const trackSwitchPositionGuardMs = 15_000;
const trackSwitchVisualIntentPositionToleranceMs = 1500;
const seekIntentSettleToleranceMs = 250;
const nonActionableAudioStatusErrorPatterns = [
  /\beq_control_(?:closed|disconnected)\b/u,
  /\beq_control_sync_skipped\b/u,
  /\baudio_session_run_cancelled\b/u,
];

let snapshot: PlaybackStatusSnapshot = {
  audioStatus: null,
  playbackStatus: null,
  playbackVisualIntent: null,
  error: null,
  version: 0,
};

const listeners = new Set<() => void>();

let pollTimer: number | null = null;
let unsubscribeAudioStatus: (() => void) | undefined;
let unsubscribeConnectStatus: (() => void) | undefined;
let activeConnectStatus: ConnectSessionStatus | null = null;
let refreshRequestId = 0;
let enhancedLowLoadPlaybackActive = false;

const getSnapshot = (): PlaybackStatusSnapshot => snapshot;

const emitChange = (): void => {
  snapshot = { ...snapshot, version: snapshot.version + 1 };
  for (const listener of listeners) {
    listener();
  }
};

const playbackMatchesIntent = (status: AudioStatus | PlaybackStatus, intent: PlaybackVisualIntent): boolean =>
  Boolean(intent.currentTrackId && status.currentTrackId === intent.currentTrackId) ||
  Boolean(intent.filePath && ('currentFilePath' in status ? status.currentFilePath : status.filePath) === intent.filePath);

const playbackHasIdentity = (status: AudioStatus | PlaybackStatus): boolean =>
  Boolean(status.currentTrackId || ('currentFilePath' in status ? status.currentFilePath : status.filePath));

const playbackStartsVisualIntent = (status: PlaybackStatus | null | undefined, intent: PlaybackVisualIntent | null | undefined): boolean =>
  Boolean(status && intent && playbackMatchesIntent(status, intent));

const isSpotifyPlaybackStatus = (status: PlaybackStatus | null | undefined): boolean =>
  typeof status?.filePath === 'string' && status.filePath.startsWith('streaming:spotify:');

const statusPositionMs = (status: AudioStatus | PlaybackStatus): number =>
  'positionSeconds' in status ? Math.round(Math.max(0, status.positionSeconds) * 1000) : Math.max(0, status.positionMs);

const statusIdentity = (status: AudioStatus | PlaybackStatus): string | null =>
  status.currentTrackId ?? ('currentFilePath' in status ? status.currentFilePath : status.filePath) ?? null;

const summarizeStatusForLyricsLog = (status: AudioStatus | PlaybackStatus): Record<string, unknown> => ({
  state: status.state,
  trackId: status.currentTrackId,
  identity: statusIdentity(status),
  positionMs: statusPositionMs(status),
});

const summarizeIntentForLyricsLog = (intent: PlaybackVisualIntent | null): Record<string, unknown> | null =>
  intent
    ? {
        type: intent.type,
        trackId: intent.currentTrackId,
        identity: intent.currentTrackId ?? intent.filePath,
        expectedPositionMs: intent.expectedPositionMs,
        ageMs: Date.now() - intent.startedAtMs,
      }
    : null;

const playbackExpectedPositionMs = (status: AudioStatus | PlaybackStatus, intent: PlaybackVisualIntent, now = Date.now()): number => {
  if (status.state !== 'playing' && !(intent.type === 'track-switch' && status.state === 'paused')) {
    return intent.expectedPositionMs;
  }

  const playbackRate =
    'playbackRate' in status && Number.isFinite(status.playbackRate)
      ? Math.max(0.25, Math.min(4, status.playbackRate))
      : 1;
  const elapsedMs = Math.max(0, now - intent.startedAtMs);
  return intent.expectedPositionMs + elapsedMs * playbackRate;
};

const playbackPositionMatchesIntent = (status: AudioStatus | PlaybackStatus, intent: PlaybackVisualIntent, now = Date.now()): boolean =>
  intent.type === 'seek'
    ? Math.abs(statusPositionMs(status) - playbackExpectedPositionMs(status, intent, now)) <= trackSwitchVisualIntentPositionToleranceMs
    : statusPositionMs(status) <= playbackExpectedPositionMs(status, intent, now) + trackSwitchVisualIntentPositionToleranceMs;

const seekIntentHasSettled = (status: AudioStatus | PlaybackStatus, intent: PlaybackVisualIntent, now = Date.now()): boolean => {
  if (intent.type !== 'seek' || !playbackMatchesIntent(status, intent)) {
    return false;
  }

  const positionMs = statusPositionMs(status);
  if (status.state === 'playing') {
    return positionMs >= intent.expectedPositionMs && Math.abs(positionMs - playbackExpectedPositionMs(status, intent, now)) <= seekIntentSettleToleranceMs;
  }

  return Math.abs(positionMs - intent.expectedPositionMs) <= seekIntentSettleToleranceMs;
};

const isStaleStatusForVisualIntent = (status: AudioStatus | PlaybackStatus, intent: PlaybackVisualIntent | null): boolean => {
  if (!intent || !playbackHasIdentity(status)) {
    return false;
  }

  const now = Date.now();
  return !playbackMatchesIntent(status, intent) || !playbackPositionMatchesIntent(status, intent, now);
};

const getActionableAudioStatusError = (error: string | null | undefined): string | null => {
  if (!error) {
    return null;
  }

  return nonActionableAudioStatusErrorPatterns.some((pattern) => pattern.test(error)) ? null : error;
};

const shouldIgnoreAudioStatusPatch = (audioStatus: AudioStatus): boolean =>
  audioStatus.state === 'error' && Boolean(audioStatus.error) && !getActionableAudioStatusError(audioStatus.error);

const applyConnectStatus = (connectStatus: ConnectSessionStatus): PlaybackStatusSnapshot => {
  const connectState = connectStatus.state;
  const connectIsActive = isActiveConnectPlaybackStatus(connectStatus);
  activeConnectStatus = connectIsActive ? connectStatus : null;

  if (!connectIsActive && connectState !== 'error') {
    return snapshot;
  }

  return setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: playbackStatusFromConnectStatus(connectStatus),
    error: connectStatus.error,
  });
};

const shouldClearVisualIntentForPatch = (
  patch: Partial<Omit<PlaybackStatusSnapshot, 'version'>>,
  shouldApplyPlaybackStatus: boolean,
  shouldApplyAudioStatus: boolean,
): boolean => {
  const intent = snapshot.playbackVisualIntent;
  if (!intent) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'error') && patch.error) {
    return true;
  }

  if (shouldApplyPlaybackStatus && patch.playbackStatus?.state === 'error') {
    return true;
  }

  if (
    shouldApplyAudioStatus &&
    patch.audioStatus &&
    intent.type === 'seek' &&
    seekIntentHasSettled(patch.audioStatus, intent)
  ) {
    return true;
  }

  if (
    shouldApplyPlaybackStatus &&
    patch.playbackStatus &&
    intent.type === 'seek' &&
    seekIntentHasSettled(patch.playbackStatus, intent)
  ) {
    return true;
  }

  if (
    shouldApplyAudioStatus &&
    patch.audioStatus &&
    Date.now() - intent.startedAtMs > trackSwitchPositionGuardMs &&
    playbackMatchesIntent(patch.audioStatus, intent) &&
    playbackPositionMatchesIntent(patch.audioStatus, intent)
  ) {
    return true;
  }

  return false;
};

export const setPlaybackStatusSnapshot = (patch: Partial<Omit<PlaybackStatusSnapshot, 'version'>>): PlaybackStatusSnapshot => {
  const hasPlaybackStatusPatch = Object.prototype.hasOwnProperty.call(patch, 'playbackStatus');
  const hasAudioStatusPatch = Object.prototype.hasOwnProperty.call(patch, 'audioStatus');
  const nativeRefreshOverSpotify =
    isSpotifyPlaybackStatus(snapshot.playbackStatus) &&
    hasPlaybackStatusPatch &&
    hasAudioStatusPatch &&
    !isSpotifyPlaybackStatus(patch.playbackStatus);
  const nativeAudioOverSpotify =
    isSpotifyPlaybackStatus(snapshot.playbackStatus) &&
    hasAudioStatusPatch &&
    !hasPlaybackStatusPatch;
  const playbackStatusStartsNewIntent =
    hasPlaybackStatusPatch && playbackStartsVisualIntent(patch.playbackStatus, patch.playbackVisualIntent);
  const shouldApplyPlaybackStatus =
    !nativeRefreshOverSpotify &&
    (playbackStatusStartsNewIntent || !patch.playbackStatus || !isStaleStatusForVisualIntent(patch.playbackStatus, snapshot.playbackVisualIntent));
  const shouldApplyAudioStatus =
    !nativeRefreshOverSpotify &&
    !nativeAudioOverSpotify &&
    (!patch.audioStatus || !isStaleStatusForVisualIntent(patch.audioStatus, snapshot.playbackVisualIntent));

  if (hasPlaybackStatusPatch) {
    refreshRequestId += 1;
  }

  const shouldClearVisualIntent = shouldClearVisualIntentForPatch(patch, shouldApplyPlaybackStatus, shouldApplyAudioStatus);
  if (hasAudioStatusPatch && !shouldApplyAudioStatus && patch.audioStatus) {
    logLyricsConsole(
      'clock.reject-stale-audio',
      {
        status: summarizeStatusForLyricsLog(patch.audioStatus),
        intent: summarizeIntentForLyricsLog(snapshot.playbackVisualIntent),
      },
      {
        level: 'warn',
        dedupeKey: `reject-audio:${statusIdentity(patch.audioStatus) ?? 'unknown'}`,
        dedupeMs: 500,
      },
    );
  }
  if (hasPlaybackStatusPatch && !shouldApplyPlaybackStatus && patch.playbackStatus) {
    logLyricsConsole(
      'clock.reject-stale-playback',
      {
        status: summarizeStatusForLyricsLog(patch.playbackStatus),
        intent: summarizeIntentForLyricsLog(snapshot.playbackVisualIntent),
      },
      {
        level: 'warn',
        dedupeKey: `reject-playback:${statusIdentity(patch.playbackStatus) ?? 'unknown'}`,
        dedupeMs: 500,
      },
    );
  }

  if (shouldClearVisualIntent) {
    logLyricsConsole(
      'clock.intent-cleared',
      {
        intent: summarizeIntentForLyricsLog(snapshot.playbackVisualIntent),
        playbackAccepted: shouldApplyPlaybackStatus && Boolean(patch.playbackStatus),
        audioAccepted: shouldApplyAudioStatus && Boolean(patch.audioStatus),
      },
      { dedupeKey: `intent-cleared:${snapshot.playbackVisualIntent?.type ?? 'none'}`, dedupeMs: 300 },
    );
    snapshot.playbackVisualIntent = null;
  }

  if (shouldApplyAudioStatus && Object.prototype.hasOwnProperty.call(patch, 'audioStatus')) {
    snapshot.audioStatus = patch.audioStatus ?? null;
  }

  if (shouldApplyPlaybackStatus && hasPlaybackStatusPatch) {
    snapshot.playbackStatus = patch.playbackStatus ?? null;
    if (isSpotifyPlaybackStatus(snapshot.playbackStatus) && !hasAudioStatusPatch) {
      snapshot.audioStatus = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
    snapshot.error = patch.error ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'playbackVisualIntent')) {
    snapshot.playbackVisualIntent = patch.playbackVisualIntent ?? null;
  }

  emitChange();
  schedulePolling();
  return snapshot;
};

export const beginPlaybackSwitchSnapshot = (playbackStatus: PlaybackStatus): PlaybackStatusSnapshot => {
  const shouldTrackSwitchIntent =
    (playbackStatus.state === 'loading' || playbackStatus.state === 'playing') &&
    Boolean(playbackStatus.currentTrackId || playbackStatus.filePath);

  return setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus,
    playbackVisualIntent: shouldTrackSwitchIntent
      ? {
          type: 'track-switch',
          state: 'playing',
          currentTrackId: playbackStatus.currentTrackId,
          filePath: playbackStatus.filePath,
          expectedPositionMs: Math.max(0, playbackStatus.positionMs),
          startedAtMs: Date.now(),
        }
      : null,
    error: null,
  });
};

export const beginPlaybackSeekSnapshot = (playbackStatus: PlaybackStatus): PlaybackStatusSnapshot => {
  const shouldTrackSeekIntent =
    (playbackStatus.state === 'loading' || playbackStatus.state === 'playing' || playbackStatus.state === 'paused') &&
    Boolean(playbackStatus.currentTrackId || playbackStatus.filePath);

  logLyricsConsole('clock.seek-intent', {
    trackId: playbackStatus.currentTrackId,
    identity: playbackStatus.currentTrackId ?? playbackStatus.filePath,
    state: playbackStatus.state,
    positionMs: Math.max(0, playbackStatus.positionMs),
    durationMs: playbackStatus.durationMs,
    tracked: shouldTrackSeekIntent,
  });

  return setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus,
    playbackVisualIntent: shouldTrackSeekIntent
      ? {
          type: 'seek',
          state: 'playing',
          currentTrackId: playbackStatus.currentTrackId,
          filePath: playbackStatus.filePath,
          expectedPositionMs: Math.max(0, playbackStatus.positionMs),
          startedAtMs: Date.now(),
        }
      : null,
    error: null,
  });
};

export const getVisualPlaybackState = (
  statusSnapshot: Pick<PlaybackStatusSnapshot, 'audioStatus' | 'playbackStatus' | 'playbackVisualIntent'>,
): AudioPlaybackState =>
  statusSnapshot.playbackVisualIntent && Date.now() - statusSnapshot.playbackVisualIntent.startedAtMs <= trackSwitchVisualIntentGuardMs
    ? statusSnapshot.playbackVisualIntent.state
    : statusSnapshot.audioStatus?.state ?? statusSnapshot.playbackStatus?.state ?? 'idle';

export const refreshPlaybackStatus = async (): Promise<PlaybackStatusSnapshot> => {
  const echo = window.echo;

  if (!echo) {
    return setPlaybackStatusSnapshot({ error: 'Desktop bridge unavailable' });
  }

  const requestId = refreshRequestId + 1;
  refreshRequestId = requestId;

  try {
    const [playbackStatus, audioStatus, connectStatus] = await Promise.all([
      echo.playback.getStatus(),
      echo.audio.getStatus(),
      echo.connect?.getStatus?.().catch(() => null) ?? Promise.resolve(null),
    ]);

    if (refreshRequestId !== requestId) {
      return snapshot;
    }

    if (connectStatus && isActiveConnectPlaybackStatus(connectStatus)) {
      return applyConnectStatus(connectStatus);
    }

    return setPlaybackStatusSnapshot({
      audioStatus: shouldIgnoreAudioStatusPatch(audioStatus) ? null : audioStatus,
      playbackStatus,
      error: getActionableAudioStatusError(audioStatus.error),
    });
  } catch (error) {
    if (refreshRequestId !== requestId) {
      return snapshot;
    }

    return setPlaybackStatusSnapshot({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const clearPolling = (): void => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

function getPollingIntervalMs(): number {
  const state = snapshot.playbackStatus?.state ?? snapshot.audioStatus?.state ?? 'idle';
  if (document.visibilityState === 'hidden' || idlePollingStates.has(state)) {
    return idlePollingIntervalMs;
  }

  return enhancedLowLoadPlaybackActive ? enhancedLowLoadActivePollingIntervalMs : activePollingIntervalMs;
}

function shouldPollStatus(): boolean {
  const state = snapshot.playbackStatus?.state ?? snapshot.audioStatus?.state ?? 'idle';
  return document.visibilityState === 'hidden' || idlePollingStates.has(state) || !unsubscribeAudioStatus;
}

function schedulePolling(): void {
  if (listeners.size === 0) {
    return;
  }

  clearPolling();
  if (!shouldPollStatus()) {
    return;
  }

  pollTimer = window.setInterval(() => {
    void refreshPlaybackStatus();
  }, getPollingIntervalMs());
}

const handleVisibilityChange = (): void => {
  schedulePolling();
  if (document.visibilityState !== 'hidden') {
    void refreshPlaybackStatus();
  }
};

const readEnhancedLowLoadPlaybackActive = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowLoadPlaybackModeEnabled === true && settings.lowLoadPlaybackEnhancementsEnabled === true;

const applyLowLoadPlaybackSettings = (settings: Partial<AppSettings> | null | undefined): void => {
  const next = readEnhancedLowLoadPlaybackActive(settings);
  if (enhancedLowLoadPlaybackActive === next) {
    return;
  }

  enhancedLowLoadPlaybackActive = next;
  schedulePolling();
};

const refreshLowLoadPlaybackSettings = (): void => {
  void window.echo?.app?.getSettings?.().then(applyLowLoadPlaybackSettings).catch(() => undefined);
};

const handleSettingsChanged = (event: Event): void => {
  const detail = (event as CustomEvent<Partial<AppSettings> | null | undefined>).detail;
  if (
    !detail ||
    (
      !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackModeEnabled') &&
      !Object.prototype.hasOwnProperty.call(detail, 'lowLoadPlaybackEnhancementsEnabled')
    )
  ) {
    return;
  }

  refreshLowLoadPlaybackSettings();
};

const ensureStarted = (): void => {
  if (listeners.size !== 1) {
    return;
  }

  unsubscribeAudioStatus = window.echo?.audio?.onStatus?.((audioStatus) => {
    if (isActiveConnectPlaybackStatus(activeConnectStatus)) {
      return;
    }

    refreshRequestId += 1;
    setPlaybackStatusSnapshot({
      audioStatus: shouldIgnoreAudioStatusPatch(audioStatus) ? null : audioStatus,
      error: getActionableAudioStatusError(audioStatus.error),
    });
  });
  unsubscribeConnectStatus = window.echo?.connect?.onStatus?.((connectStatus) => {
    refreshRequestId += 1;
    applyConnectStatus(connectStatus);
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('settings:changed', handleSettingsChanged);
  refreshLowLoadPlaybackSettings();
  void refreshPlaybackStatus();
  schedulePolling();
};

const stopIfUnused = (): void => {
  if (listeners.size > 0) {
    return;
  }

  clearPolling();
  unsubscribeAudioStatus?.();
  unsubscribeAudioStatus = undefined;
  unsubscribeConnectStatus?.();
  unsubscribeConnectStatus = undefined;
  activeConnectStatus = null;
  snapshot = {
    audioStatus: null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
    version: snapshot.version + 1,
  };
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('settings:changed', handleSettingsChanged);
  enhancedLowLoadPlaybackActive = false;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  ensureStarted();

  return () => {
    listeners.delete(listener);
    stopIfUnused();
  };
};

export const useSharedPlaybackStatus = (): PlaybackStatusSnapshot => {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
