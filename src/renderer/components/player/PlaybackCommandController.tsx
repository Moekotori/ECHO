import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MainWindowPlaybackControlRequest, PlaybackStatus } from '../../../shared/types/playback';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import {
  createDefaultGlobalShortcuts,
  createDefaultLocalShortcuts,
  globalShortcutActions,
  validateGlobalShortcutAccelerator,
  type GlobalShortcutAction,
  type GlobalShortcutSettings,
  type LocalShortcutSettings,
} from '../../../shared/types/globalShortcuts';
import type { SmtcCommand } from '../../../shared/types/smtc';
import {
  isSpotifyTrack,
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
  seekSpotifyPlayback,
  setSpotifyVolume,
  stopSpotifyPlayback,
} from '../../integrations/spotify/spotifyPlayback';
import { likedChangedEvent, likedTracksChangedEvent } from '../../hooks/useLikedMedia';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { getVisualPlaybackState, refreshPlaybackStatus, setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../../stores/playbackStatusStore';
import { isActiveConnectPlaybackStatus, playbackStatusFromConnectStatus } from '../../utils/connectPlayback';
import { isImeComposingKeyEvent } from '../../utils/imeInput';
import { shouldSuppressAudioHostError } from './audioErrorFormat';
import { bindMediaSessionActions, clearMediaSession, setExternalMediaSessionAuthority } from './mediaSession';
import type { StreamingProviderName } from '../../../shared/types/streaming';

const playbackSeekedEvent = 'playback:seeked';
const clampPlaybackRate = (value: number): number => Math.max(0.5, Math.min(2, value));
const openAudioSettingsEvent = 'app:open-audio-settings';
const openMvSettingsEvent = 'app:open-mv-settings';
const openLyricsSettingsEvent = 'app:open-lyrics-settings';
const locateCurrentTrackEvent = 'app:locate-current-track';
const navigateQueueEvent = 'app:navigate:queue';
const navigateRouteEvent = 'app:navigate:route';
const localShortcutUnavailableActions = new Set<GlobalShortcutAction>(['showMainWindow']);
const shortcutRecordingFlag = 'echoShortcutRecording';

const shortcutKeyAliases = new Map<string, string>([
  [' ', 'Space'],
  ['Spacebar', 'Space'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['Escape', 'Esc'],
  ['+', 'Plus'],
  ['Add', 'Plus'],
  ['NumpadAdd', 'numadd'],
  ['Subtract', '-'],
  ['NumpadSubtract', 'numsub'],
  ['Multiply', '*'],
  ['NumpadMultiply', 'nummult'],
  ['Divide', '/'],
  ['NumpadDivide', 'numdiv'],
  ['Decimal', '.'],
  ['NumpadDecimal', 'numdec'],
  ['MediaPlayPause', 'MediaPlayPause'],
  ['MediaNextTrack', 'MediaNextTrack'],
  ['MediaPreviousTrack', 'MediaPreviousTrack'],
  ['MediaStop', 'MediaStop'],
]);

const isTextEditingElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const editableTarget = target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
  if (editableTarget) {
    return true;
  }

  return target.isContentEditable;
};

const isShortcutTextTarget = (event: KeyboardEvent): boolean => {
  const path = event.composedPath();
  if (path.some((target) => isTextEditingElement(target))) {
    return true;
  }

  return isTextEditingElement(document.activeElement);
};

const normalizeShortcutEventKey = (event: KeyboardEvent): string | null => {
  const code = event.code;
  const aliasedCode = shortcutKeyAliases.get(code);
  if (aliasedCode) {
    return aliasedCode;
  }

  if (/^Key[A-Z]$/u.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/u.test(code)) {
    return code.slice(5);
  }

  if (/^Numpad[0-9]$/u.test(code)) {
    return `num${code.slice(6)}`;
  }

  const aliased = shortcutKeyAliases.get(event.key);
  if (aliased) {
    return aliased;
  }

  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') {
    return null;
  }

  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
};

const acceleratorFromKeyboardEvent = (event: KeyboardEvent): string | null => {
  const key = normalizeShortcutEventKey(event);
  if (!key) {
    return null;
  }

  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Command' : null,
  ].filter((item): item is string => Boolean(item));

  const validation = validateGlobalShortcutAccelerator([...modifiers, key].join('+'));
  return validation.valid ? validation.accelerator : null;
};

const acceleratorFromMouseEvent = (event: MouseEvent): string | null => {
  switch (event.button) {
    case 1:
      return 'MouseButton3';
    case 3:
      return 'MouseButton4';
    case 4:
      return 'MouseButton5';
    default:
      return null;
  }
};

const isShortcutRecording = (): boolean => document.body?.dataset[shortcutRecordingFlag] === 'true';

const buildLocalShortcutMap = (
  localShortcuts: LocalShortcutSettings,
  globalShortcuts: GlobalShortcutSettings,
): Map<string, GlobalShortcutAction> => {
  const defaultGlobalShortcuts = createDefaultGlobalShortcuts();
  const defaultLocalShortcuts = createDefaultLocalShortcuts();
  const globalAccelerators = new Set<string>();
  for (const action of globalShortcutActions) {
    const binding = globalShortcuts[action] ?? defaultGlobalShortcuts[action];
    if (binding.enabled && binding.accelerator) {
      const validation = validateGlobalShortcutAccelerator(binding.accelerator);
      if (validation.valid && validation.accelerator) {
        globalAccelerators.add(validation.accelerator.toLowerCase());
      }
    }
  }

  const shortcuts = new Map<string, GlobalShortcutAction>();
  for (const action of globalShortcutActions) {
    if (localShortcutUnavailableActions.has(action)) {
      continue;
    }

    const binding = localShortcuts[action] ?? defaultLocalShortcuts[action];
    if (!binding.enabled || !binding.accelerator) {
      continue;
    }

    const validation = validateGlobalShortcutAccelerator(binding.accelerator);
    if (!validation.valid || !validation.accelerator) {
      continue;
    }

    const acceleratorKey = validation.accelerator.toLowerCase();
    if (!globalAccelerators.has(acceleratorKey) && !shortcuts.has(acceleratorKey)) {
      shortcuts.set(acceleratorKey, action);
    }
  }

  return shortcuts;
};

const dispatchPlaybackSeeked = (positionSeconds: number, trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(playbackSeekedEvent, { detail: { positionSeconds, trackId } }));
};

const nativeSmtcAuthorityPollIntervalMs = 5_000;

const isProviderLikedStreamingProvider = (provider: string | null | undefined): provider is Extract<StreamingProviderName, 'netease' | 'qqmusic'> =>
  provider === 'netease' || provider === 'qqmusic';

const getActiveConnectPlaybackStatus = async (): Promise<ConnectSessionStatus | null> => {
  const status = await window.echo?.connect?.getStatus?.().catch(() => null);
  return isActiveConnectPlaybackStatus(status) ? status : null;
};

export const PlaybackCommandController = (): null => {
  const queue = usePlaybackQueue();
  const playQueueItem = queue.playQueueItem;
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [smtcEnabled, setSmtcEnabled] = useState(true);
  const [nativeSmtcAuthority, setNativeSmtcAuthority] = useState(false);
  const [localShortcuts, setLocalShortcuts] = useState<LocalShortcutSettings>(() => createDefaultLocalShortcuts());
  const [globalShortcuts, setGlobalShortcuts] = useState<GlobalShortcutSettings>(() => createDefaultGlobalShortcuts());
  const playbackStatus = sharedPlaybackStatus.playbackStatus;
  const audioStatus = sharedPlaybackStatus.audioStatus;
  const state = audioStatus?.state ?? playbackStatus?.state ?? 'idle';
  const visualState = getVisualPlaybackState(sharedPlaybackStatus);
  const isPlaying = visualState === 'playing' || visualState === 'loading';
  const positionSeconds = audioStatus?.positionSeconds ?? (playbackStatus?.positionMs ?? 0) / 1000;
  const durationSeconds = audioStatus?.durationSeconds ?? (playbackStatus?.durationMs ?? 0) / 1000;
  const isSpotifyCurrentTrack = isSpotifyTrack(queue.currentTrack);
  const currentTrack = queue.currentTrack ?? null;
  const currentTrackId = queue.currentTrackId ?? currentTrack?.id ?? playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? null;
  const hasCurrentMedia = Boolean(currentTrackId || currentTrack?.path || playbackStatus?.filePath || audioStatus?.currentFilePath);
  const isLibraryCurrentTrack = Boolean(currentTrack && !currentTrack.isTemporary && currentTrack.mediaType !== 'streaming');
  const isProviderLikedStreamingTrack =
    currentTrack?.mediaType === 'streaming' &&
    isProviderLikedStreamingProvider(currentTrack.provider) &&
    Boolean(currentTrack.providerTrackId);

  const runPlaybackAction = useCallback(async (
    action: () => Promise<PlaybackStatus | null>,
    options: { rethrow?: boolean } = {},
  ): Promise<void> => {
    try {
      const status = await action();
      if (status) {
        setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
      }
      await refreshPlaybackStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlaybackStatusSnapshot({ error: shouldSuppressAudioHostError(message) ? null : message });
      if (options.rethrow) {
        throw error;
      }
    }
  }, []);

  const applyConnectPlaybackStatus = useCallback(
    (connectStatus: ConnectSessionStatus, fallbackPositionSeconds?: number): PlaybackStatus => {
      const nextStatus = playbackStatusFromConnectStatus(connectStatus, {
        currentTrackId: connectStatus.currentTrackId ?? queue.currentTrackId,
        durationMs: Math.round(Math.max(0, durationSeconds) * 1000),
        filePath: queue.currentTrack?.path ?? null,
      });
      const normalizedStatus =
        fallbackPositionSeconds === undefined
          ? nextStatus
          : {
              ...nextStatus,
              positionMs: Math.round(Math.max(0, fallbackPositionSeconds) * 1000),
            };
      setPlaybackStatusSnapshot({ audioStatus: null, playbackStatus: normalizedStatus, playbackVisualIntent: null, error: null });
      return normalizedStatus;
    },
    [durationSeconds, queue.currentTrack?.path, queue.currentTrackId],
  );

  const publishOptimisticPause = useCallback((): void => {
    setPlaybackStatusSnapshot({
      audioStatus: audioStatus
        ? {
            ...audioStatus,
            state: 'paused',
            positionSeconds,
            durationSeconds,
          }
        : null,
      playbackStatus: {
        state: 'paused',
        currentTrackId: playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? queue.currentTrackId,
        positionMs: Math.round(Math.max(0, positionSeconds) * 1000),
        durationMs: Math.round(Math.max(0, durationSeconds) * 1000),
        filePath: playbackStatus?.filePath ?? audioStatus?.currentFilePath ?? queue.currentTrack?.path ?? null,
      },
      playbackVisualIntent: null,
      error: null,
    });
  }, [audioStatus, durationSeconds, playbackStatus?.currentTrackId, playbackStatus?.filePath, positionSeconds, queue.currentTrack?.path, queue.currentTrackId]);

  const handlePlayPause = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;
    const connect = window.echo?.connect;

    const activeConnectStatus = await getActiveConnectPlaybackStatus();
    if (activeConnectStatus && connect?.play && connect.pause) {
      const nextStatus =
        visualState === 'playing' || visualState === 'loading'
          ? await connect.pause()
          : await connect.play();
      applyConnectPlaybackStatus(nextStatus);
      await refreshPlaybackStatus();
      return;
    }

    if (queue.hqPlayerTakeoverEnabled) {
      if (visualState === 'playing' || visualState === 'loading') {
        return;
      }

      await runPlaybackAction(queue.activateHqPlayerTakeover);
      return;
    }

    if (isSpotifyCurrentTrack && queue.currentTrack) {
      await runPlaybackAction(() =>
        visualState === 'playing' || visualState === 'loading'
          ? pauseSpotifyPlayback(queue.currentTrack!)
          : resumeSpotifyPlayback(queue.currentTrack!),
      );
      return;
    }

    if (!playback) {
      return;
    }

    await runPlaybackAction(async () => {
      if (visualState === 'playing' || visualState === 'loading') {
        publishOptimisticPause();
        return playback.pause();
      }

      const latestStatus = await playback.getStatus();
      return latestStatus.state === 'playing' || latestStatus.state === 'loading' ? playback.pause() : playback.play();
    });
  }, [applyConnectPlaybackStatus, isSpotifyCurrentTrack, publishOptimisticPause, queue, runPlaybackAction, visualState]);

  const handlePlay = useCallback(async (): Promise<void> => {
    const activeConnectStatus = await getActiveConnectPlaybackStatus();
    const connect = window.echo?.connect;
    if (activeConnectStatus) {
      if (!connect?.play) {
        throw new Error('main_window_playback_controller_unavailable');
      }
      applyConnectPlaybackStatus(await connect.play());
      await refreshPlaybackStatus();
      return;
    }

    if (!hasCurrentMedia && !queue.hqPlayerTakeoverEnabled) {
      throw new Error('playback_action_unavailable');
    }
    if (visualState === 'playing' || visualState === 'loading') {
      return;
    }
    if (queue.hqPlayerTakeoverEnabled) {
      await runPlaybackAction(queue.activateHqPlayerTakeover, { rethrow: true });
      return;
    }
    if (isSpotifyCurrentTrack && queue.currentTrack) {
      await runPlaybackAction(() => resumeSpotifyPlayback(queue.currentTrack!), { rethrow: true });
      return;
    }

    const playback = window.echo?.playback;
    if (!playback) {
      throw new Error('main_window_playback_controller_unavailable');
    }
    await runPlaybackAction(
      () => (state === 'idle' || state === 'stopped') && queue.currentTrack
        ? queue.playTrack(queue.currentTrack)
        : playback.play(),
      { rethrow: true },
    );
  }, [applyConnectPlaybackStatus, hasCurrentMedia, isSpotifyCurrentTrack, queue, runPlaybackAction, state, visualState]);

  const handlePause = useCallback(async (): Promise<void> => {
    const activeConnectStatus = await getActiveConnectPlaybackStatus();
    const connect = window.echo?.connect;
    if (activeConnectStatus) {
      if (!connect?.pause) {
        throw new Error('main_window_playback_controller_unavailable');
      }
      applyConnectPlaybackStatus(await connect.pause());
      await refreshPlaybackStatus();
      return;
    }

    if (!hasCurrentMedia) {
      throw new Error('playback_action_unavailable');
    }
    if (visualState === 'paused' || visualState === 'stopped' || visualState === 'idle') {
      return;
    }
    if (queue.hqPlayerTakeoverEnabled) {
      throw new Error('playback_action_unavailable');
    }
    if (isSpotifyCurrentTrack && queue.currentTrack) {
      await runPlaybackAction(() => pauseSpotifyPlayback(queue.currentTrack!), { rethrow: true });
      return;
    }

    const playback = window.echo?.playback;
    if (!playback) {
      throw new Error('main_window_playback_controller_unavailable');
    }
    publishOptimisticPause();
    await runPlaybackAction(() => playback.pause(), { rethrow: true });
  }, [applyConnectPlaybackStatus, hasCurrentMedia, isSpotifyCurrentTrack, publishOptimisticPause, queue, runPlaybackAction, visualState]);

  const handlePrevious = useCallback(async (): Promise<void> => {
    await runPlaybackAction(queue.playPrevious);
  }, [queue.playPrevious, runPlaybackAction]);

  const handleNext = useCallback(async (): Promise<void> => {
    await runPlaybackAction(queue.playNext);
  }, [queue.playNext, runPlaybackAction]);

  const handleStop = useCallback(async (): Promise<void> => {
    const activeConnectStatus = await getActiveConnectPlaybackStatus();
    const connect = window.echo?.connect;
    if (activeConnectStatus) {
      if (!connect?.stop) {
        throw new Error('main_window_playback_controller_unavailable');
      }
      const nextStatus = await connect.stop();
      applyConnectPlaybackStatus(nextStatus);
      await refreshPlaybackStatus();
      return;
    }
    if (!hasCurrentMedia) {
      throw new Error('playback_action_unavailable');
    }
    if (queue.hqPlayerTakeoverEnabled) {
      throw new Error('playback_action_unavailable');
    }
    if (isSpotifyCurrentTrack && queue.currentTrack) {
      await runPlaybackAction(() => stopSpotifyPlayback(queue.currentTrack!), { rethrow: true });
      return;
    }

    const playback = window.echo?.playback;
    if (!playback) {
      throw new Error('main_window_playback_controller_unavailable');
    }
    await runPlaybackAction(() => playback.stop(), { rethrow: true });
  }, [applyConnectPlaybackStatus, hasCurrentMedia, isSpotifyCurrentTrack, queue.currentTrack, queue.hqPlayerTakeoverEnabled, runPlaybackAction]);

  const handleVolumeStep = useCallback(
    async (delta: number): Promise<void> => {
      const audio = window.echo?.audio;
      if (!audio) {
        return;
      }

      const getSettings = window.echo?.app?.getSettings;
      const settings = typeof getSettings === 'function' ? await getSettings().catch(() => null) : null;
      if (settings?.fixedVolumeEnabled === true) {
        await audio.setOutput({ volume: 1 });
        await refreshPlaybackStatus();
        return;
      }

      const latestStatus = audioStatus ?? (await audio.getStatus());
      const nextVolume = Math.max(0, Math.min(1, (latestStatus.volume ?? 1) + delta));
      await audio.setOutput({ volume: nextVolume });
      await refreshPlaybackStatus();
    },
    [audioStatus],
  );

  const commitVolume = useCallback(
    async (volume: number): Promise<void> => {
      const safeVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
      const settings = await window.echo?.app?.getSettings?.().catch(() => null);
      if (settings?.fixedVolumeEnabled === true) {
        await window.echo?.audio?.setOutput?.({ volume: 1 });
        await refreshPlaybackStatus();
        return;
      }

      const activeConnectStatus = await getActiveConnectPlaybackStatus();
      if (activeConnectStatus) {
        const setConnectVolume = window.echo?.connect?.setVolume;
        if (!setConnectVolume) {
          throw new Error('main_window_playback_controller_unavailable');
        }
        await setConnectVolume(Math.round(safeVolume * 100));
      } else if (isSpotifyCurrentTrack) {
        await setSpotifyVolume(safeVolume);
      } else {
        const audio = window.echo?.audio;
        if (!audio) {
          throw new Error('main_window_playback_controller_unavailable');
        }
        await audio.setOutput({ volume: safeVolume });
      }

      await window.echo?.app?.setSettings?.({ playerVolume: safeVolume }).catch(() => undefined);
      await refreshPlaybackStatus();
    },
    [isSpotifyCurrentTrack],
  );

  const handleSpeedStep = useCallback(
    async (delta: number): Promise<void> => {
      const audio = window.echo?.audio;
      if (!audio) {
        return;
      }

      const latestStatus = audioStatus ?? (await audio.getStatus());
      const nextRate = clampPlaybackRate(Math.round(((latestStatus.playbackRate ?? 1) + delta) * 10) / 10);
      const playbackSpeedMode = latestStatus.playbackSpeedMode ?? 'nightcore';
      await audio.setOutput({ playbackRate: nextRate, playbackSpeedMode });
      await window.echo?.app?.setSettings?.({ playbackSpeed: nextRate, playbackSpeedMode }).catch(() => undefined);
      await refreshPlaybackStatus();
    },
    [audioStatus],
  );

  const handleToggleMute = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;
    if (!audio) {
      return;
    }

    const getSettings = window.echo?.app?.getSettings;
    const settings = typeof getSettings === 'function' ? await getSettings().catch(() => null) : null;
    if (settings?.fixedVolumeEnabled === true) {
      await audio.setOutput({ volume: 1 });
      await refreshPlaybackStatus();
      return;
    }

    const latestStatus = audioStatus ?? (await audio.getStatus());
    await audio.setOutput({ volume: (latestStatus.volume ?? 1) > 0 ? 0 : 1 });
    await refreshPlaybackStatus();
  }, [audioStatus]);

  const handleToggleCurrentTrackLiked = useCallback(async (): Promise<void> => {
    if (!currentTrackId || (!isLibraryCurrentTrack && !isProviderLikedStreamingTrack) || !window.echo?.library) {
      return;
    }

    if (isProviderLikedStreamingTrack && currentTrack?.providerTrackId && isProviderLikedStreamingProvider(currentTrack.provider)) {
      const likedMap = await window.echo.library.getLikedTrackIds([currentTrackId]).catch((): Record<string, boolean> => ({}));
      await window.echo.streaming?.setTrackLiked?.({
        provider: currentTrack.provider,
        providerTrackId: currentTrack.providerTrackId,
        liked: likedMap[currentTrackId] !== true,
      });
    } else {
      await window.echo.library.toggleTrackLiked(currentTrackId);
    }

    window.dispatchEvent(new Event(likedTracksChangedEvent));
    window.dispatchEvent(new Event(likedChangedEvent));
  }, [currentTrack, currentTrackId, isLibraryCurrentTrack, isProviderLikedStreamingTrack]);

  const handleToggleMiniPlayer = useCallback(async (): Promise<void> => {
    const miniPlayer = window.echo?.miniPlayer;
    if (!miniPlayer) {
      return;
    }

    const state = await miniPlayer.getState();
    if (state.visible) {
      await miniPlayer.hide({ restoreMainWindow: true });
    } else {
      await miniPlayer.show();
    }
  }, []);

  const handleBossKey = useCallback(async (): Promise<void> => {
    const audio = window.echo?.audio;
    if (!audio) {
      return;
    }

    const getSettings = window.echo?.app?.getSettings;
    const settings = typeof getSettings === 'function' ? await getSettings().catch(() => null) : null;
    if (settings?.fixedVolumeEnabled !== true) {
      await audio.setOutput({ volume: 0 });
    }
    void window.echo?.app?.minimize?.();
    await refreshPlaybackStatus();
  }, []);

  const toggleDesktopLyricsLock = useCallback(async (): Promise<void> => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return;
    }

    try {
      const state = await desktopLyrics.getState();
      await desktopLyrics.setLocked(state.locked !== true);
    } catch {
      // Best effort: shortcut failures should not affect playback commands.
    }
  }, []);

  const toggleDesktopLyrics = useCallback(async (): Promise<void> => {
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return;
    }

    try {
      const state = await desktopLyrics.getState();
      if (state.visible) {
        await desktopLyrics.hide();
      } else {
        await desktopLyrics.show();
      }
    } catch {
      // Best effort: shortcut failures should not affect playback commands.
    }
  }, []);

  const commitSeek = useCallback(
    async (nextPositionSeconds: number, options: { rethrowUnavailable?: boolean } = {}): Promise<void> => {
      const playback = window.echo?.playback;

      if (durationSeconds <= 0) {
        if (options.rethrowUnavailable) {
          throw new Error('playback_action_unavailable');
        }
        return;
      }

      const safePositionSeconds = Math.min(durationSeconds, Math.max(0, nextPositionSeconds));
      if (isSpotifyCurrentTrack && queue.currentTrack) {
        const status = await seekSpotifyPlayback(queue.currentTrack, safePositionSeconds);
        setPlaybackStatusSnapshot({ playbackStatus: status, playbackVisualIntent: null, error: null });
        dispatchPlaybackSeeked(safePositionSeconds, status.currentTrackId ?? queue.currentTrackId ?? null);
        return;
      }

      const activeConnectStatus = await getActiveConnectPlaybackStatus();
      if (activeConnectStatus) {
        const connectSeek = window.echo?.connect?.seek;
        if (!connectSeek) {
          if (options.rethrowUnavailable) {
            throw new Error('main_window_playback_controller_unavailable');
          }
          return;
        }
        const connectStatus = await connectSeek(safePositionSeconds);
        if (!connectStatus) {
          if (options.rethrowUnavailable) {
            throw new Error('playback_action_unavailable');
          }
          return;
        }

        const nextStatus = applyConnectPlaybackStatus(connectStatus, safePositionSeconds);
        dispatchPlaybackSeeked(safePositionSeconds, nextStatus.currentTrackId ?? queue.currentTrackId ?? null);
        return;
      }

      if (!playback) {
        if (options.rethrowUnavailable) {
          throw new Error('main_window_playback_controller_unavailable');
        }
        return;
      }

      const status = await playback.seek(safePositionSeconds);
      setPlaybackStatusSnapshot({
        playbackStatus: {
          ...status,
          positionMs: Math.round(safePositionSeconds * 1000),
        },
        playbackVisualIntent: null,
        error: null,
      });
      dispatchPlaybackSeeked(safePositionSeconds, status.currentTrackId ?? queue.currentTrackId ?? null);
      await refreshPlaybackStatus();
    },
    [applyConnectPlaybackStatus, durationSeconds, isSpotifyCurrentTrack, queue.currentTrack, queue.currentTrackId],
  );

  const handleSmtcCommand = useCallback(
    (command: SmtcCommand): void => {
      if (typeof command !== 'string') {
        if (command.type === 'seek') {
          void commitSeek(command.positionSeconds);
        }
        return;
      }

      if (command === 'playPause') {
        void handlePlayPause();
        return;
      }

      if (command === 'play') {
        void handlePlay().catch(() => undefined);
        return;
      }

      if (command === 'pause') {
        void handlePause().catch(() => undefined);
        return;
      }

      if (command === 'previous') {
        handlePrevious();
        return;
      }

      if (command === 'next') {
        handleNext();
        return;
      }

      if (command === 'stop') {
        void handleStop().catch(() => undefined);
      }
    },
    [commitSeek, handleNext, handlePause, handlePlay, handlePlayPause, handlePrevious, handleStop],
  );

  const handleGlobalShortcutCommand = useCallback(
    (action: GlobalShortcutAction): void => {
      if (action === 'playPause') {
        void handlePlayPause();
        return;
      }

      if (action === 'previousTrack') {
        handlePrevious();
        return;
      }

      if (action === 'nextTrack') {
        handleNext();
        return;
      }

      if (action === 'stop') {
        void handleStop().catch(() => undefined);
        return;
      }

      if (action === 'volumeUp') {
        void handleVolumeStep(0.05);
        return;
      }

      if (action === 'volumeDown') {
        void handleVolumeStep(-0.05);
        return;
      }

      if (action === 'toggleMute') {
        void handleToggleMute();
        return;
      }

      if (action === 'speedUp') {
        void handleSpeedStep(0.1);
        return;
      }

      if (action === 'speedDown') {
        void handleSpeedStep(-0.1);
        return;
      }

      if (action === 'bossKey') {
        void handleBossKey();
        return;
      }

      if (action === 'openAudioSettings') {
        window.dispatchEvent(new Event(openAudioSettingsEvent));
        return;
      }

      if (action === 'toggleCurrentTrackLiked') {
        void handleToggleCurrentTrackLiked();
        return;
      }

      if (action === 'openPlaybackQueue') {
        window.dispatchEvent(new Event(navigateQueueEvent));
        return;
      }

      if (action === 'openSearch') {
        window.dispatchEvent(new CustomEvent(navigateRouteEvent, { detail: 'search' }));
        return;
      }

      if (action === 'toggleShuffle') {
        queue.toggleShuffle();
        return;
      }

      if (action === 'cycleRepeatMode') {
        queue.setRepeatMode(queue.repeatMode === 'one' ? 'off' : 'one');
        return;
      }

      if (action === 'toggleMiniPlayer') {
        void handleToggleMiniPlayer();
        return;
      }

      if (action === 'openMvSettings') {
        window.dispatchEvent(new Event(openMvSettingsEvent));
        return;
      }

      if (action === 'openLyricsSettings') {
        window.dispatchEvent(new Event(openLyricsSettingsEvent));
        return;
      }

      if (action === 'locateCurrentTrack') {
        window.dispatchEvent(new Event(locateCurrentTrackEvent));
        return;
      }

      if (action === 'toggleDesktopLyrics') {
        void toggleDesktopLyrics();
        return;
      }

      if (action === 'toggleDesktopLyricsLock') {
        void toggleDesktopLyricsLock();
        return;
      }

      if (action === 'seekBackward') {
        void commitSeek(positionSeconds - 10);
        return;
      }

      if (action === 'seekForward') {
        void commitSeek(positionSeconds + 10);
      }
    },
    [commitSeek, handleBossKey, handleNext, handlePlayPause, handlePrevious, handleSpeedStep, handleStop, handleToggleCurrentTrackLiked, handleToggleMiniPlayer, handleToggleMute, handleVolumeStep, positionSeconds, queue, toggleDesktopLyrics, toggleDesktopLyricsLock],
  );

  useEffect(() => {
    let cancelled = false;
    let diagnosticsInFlight = false;
    const refreshNativeSmtcAuthority = (): void => {
      if (diagnosticsInFlight) {
        return;
      }

      const getDiagnostics = window.echo?.smtc?.getDiagnostics;
      if (!getDiagnostics) {
        setNativeSmtcAuthority(false);
        return;
      }

      diagnosticsInFlight = true;
      void getDiagnostics()
        .then((diagnostics) => {
          if (!cancelled) {
            setNativeSmtcAuthority(
              diagnostics.enabled &&
                diagnostics.platform === 'win32' &&
                (diagnostics.hostState === 'starting' || diagnostics.hostState === 'running'),
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNativeSmtcAuthority(false);
          }
        })
        .finally(() => {
          diagnosticsInFlight = false;
        });
    };

    const refreshSmtcSetting = (): void => {
      void window.echo?.app
        ?.getSettings?.()
        .then((settings) => {
          if (!cancelled) {
            setSmtcEnabled(settings.smtcEnabled !== false);
            setLocalShortcuts(settings.localShortcuts ?? createDefaultLocalShortcuts());
            setGlobalShortcuts(settings.globalShortcuts ?? createDefaultGlobalShortcuts());
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSmtcEnabled(true);
            setLocalShortcuts(createDefaultLocalShortcuts());
            setGlobalShortcuts(createDefaultGlobalShortcuts());
          }
        });

      refreshNativeSmtcAuthority();
    };

    refreshSmtcSetting();
    const authorityPollTimer = window.setInterval(refreshNativeSmtcAuthority, nativeSmtcAuthorityPollIntervalMs);
    window.addEventListener('settings:changed', refreshSmtcSetting);

    return () => {
      cancelled = true;
      window.clearInterval(authorityPollTimer);
      window.removeEventListener('settings:changed', refreshSmtcSetting);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.echo?.smtc?.onCommand(handleSmtcCommand);
    return () => unsubscribe?.();
  }, [handleSmtcCommand]);

  useEffect(() => {
    if (!smtcEnabled || !window.echo?.smtc?.setEnabledActions) {
      return;
    }

    void window.echo.smtc
      .setEnabledActions({
        play: hasCurrentMedia && !isPlaying,
        pause: hasCurrentMedia && isPlaying,
        previous: hasCurrentMedia && queue.canGoPrevious,
        next: hasCurrentMedia && queue.canGoNext,
        seek: hasCurrentMedia && durationSeconds > 0,
      })
      .catch(() => undefined);
  }, [durationSeconds, hasCurrentMedia, isPlaying, queue.canGoNext, queue.canGoPrevious, smtcEnabled]);

  useEffect(() => {
    const unsubscribe = window.echo?.app?.onGlobalShortcutCommand?.(handleGlobalShortcutCommand);
    return () => unsubscribe?.();
  }, [handleGlobalShortcutCommand]);

  useEffect(() => {
    const handleMainWindowControl = async (request: MainWindowPlaybackControlRequest): Promise<void> => {
      switch (request.type) {
        case 'play':
          await handlePlay();
          return;
        case 'pause':
          await handlePause();
          return;
        case 'stop':
          await handleStop();
          return;
        case 'playPause':
          await handlePlayPause();
          return;
        case 'previous':
          if (!queue.canGoPrevious) {
            throw new Error('playback_action_unavailable');
          }
          await runPlaybackAction(queue.playPrevious, { rethrow: true });
          return;
        case 'next':
          if (!queue.canGoNext) {
            throw new Error('playback_action_unavailable');
          }
          await runPlaybackAction(queue.playNext, { rethrow: true });
          return;
        case 'seek':
          if (!hasCurrentMedia || durationSeconds <= 0) {
            throw new Error('playback_action_unavailable');
          }
          await commitSeek(request.positionSeconds, { rethrowUnavailable: true });
          return;
        case 'setVolume':
          await commitVolume(request.volume);
          return;
        case 'setPlaybackOrder':
          await queue.setPlaybackOrder(request.mode);
          return;
        case 'playQueueItem':
          await runPlaybackAction(() => playQueueItem(request.queueId), { rethrow: true });
          return;
      }
    };

    const unsubscribe = window.echo?.playback?.onMainWindowControl?.(handleMainWindowControl);
    return () => unsubscribe?.();
  }, [commitSeek, commitVolume, durationSeconds, handlePause, handlePlay, handlePlayPause, handleStop, hasCurrentMedia, playQueueItem, queue.canGoNext, queue.canGoPrevious, queue.playNext, queue.playPrevious, queue.setPlaybackOrder, runPlaybackAction]);

  const localShortcutMap = useMemo(
    () => buildLocalShortcutMap(localShortcuts, globalShortcuts),
    [globalShortcuts, localShortcuts],
  );

  useEffect(() => {
    const handleLocalShortcutAccelerator = (accelerator: string | null, event: Event): void => {
      if (!accelerator || isShortcutRecording()) {
        return;
      }

      const action = localShortcutMap.get(accelerator.toLowerCase());
      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleGlobalShortcutCommand(action);
    };

    const handleLocalShortcutKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || isImeComposingKeyEvent(event) || isShortcutTextTarget(event)) {
        return;
      }

      handleLocalShortcutAccelerator(acceleratorFromKeyboardEvent(event), event);
    };

    const handleLocalShortcutMouseDown = (event: MouseEvent): void => {
      handleLocalShortcutAccelerator(acceleratorFromMouseEvent(event), event);
    };

    window.addEventListener('keydown', handleLocalShortcutKeyDown, true);
    window.addEventListener('mousedown', handleLocalShortcutMouseDown, true);

    return () => {
      window.removeEventListener('keydown', handleLocalShortcutKeyDown, true);
      window.removeEventListener('mousedown', handleLocalShortcutMouseDown, true);
    };
  }, [handleGlobalShortcutCommand, localShortcutMap]);

  useEffect(() => {
    const externalAuthority = !smtcEnabled || nativeSmtcAuthority;
    setExternalMediaSessionAuthority(externalAuthority);
    if (externalAuthority) {
      return () => undefined;
    }

    return bindMediaSessionActions({
      onPlay: () => handleSmtcCommand('play'),
      onPause: () => handleSmtcCommand('pause'),
      onPrevious: () => handleSmtcCommand('previous'),
      onNext: () => handleSmtcCommand('next'),
      onStop: () => handleSmtcCommand('stop'),
      onSeek: (nextPositionSeconds) => void commitSeek(nextPositionSeconds),
      getPositionSeconds: () => positionSeconds,
    });
  }, [commitSeek, handleSmtcCommand, nativeSmtcAuthority, positionSeconds, smtcEnabled]);

  useEffect(() => () => {
    setExternalMediaSessionAuthority(false);
    clearMediaSession();
  }, []);

  return null;
};
