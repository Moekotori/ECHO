import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlaybackStatus } from '../../../shared/types/playback';
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
  stopSpotifyPlayback,
} from '../../integrations/spotify/spotifyPlayback';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { getVisualPlaybackState, refreshPlaybackStatus, setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../../stores/playbackStatusStore';
import { isActiveConnectPlaybackStatus, playbackStatusFromConnectStatus } from '../../utils/connectPlayback';
import { isImeComposingKeyEvent } from '../../utils/imeInput';
import { shouldSuppressAudioHostError } from './audioErrorFormat';
import { bindMediaSessionActions, clearMediaSession } from './mediaSession';

const playbackSeekedEvent = 'playback:seeked';
const clampPlaybackRate = (value: number): number => Math.max(0.5, Math.min(2, value));
const openAudioSettingsEvent = 'app:open-audio-settings';
const openMvSettingsEvent = 'app:open-mv-settings';
const openLyricsSettingsEvent = 'app:open-lyrics-settings';
const locateCurrentTrackEvent = 'app:locate-current-track';
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

const getActiveConnectPlaybackStatus = async (): Promise<ConnectSessionStatus | null> => {
  const status = await window.echo?.connect?.getStatus?.().catch(() => null);
  return isActiveConnectPlaybackStatus(status) ? status : null;
};

export const PlaybackCommandController = (): null => {
  const queue = usePlaybackQueue();
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [smtcEnabled, setSmtcEnabled] = useState(true);
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

  const runPlaybackAction = useCallback(async (action: () => Promise<PlaybackStatus | null>): Promise<void> => {
    try {
      const status = await action();
      if (status) {
        setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
      }
      await refreshPlaybackStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlaybackStatusSnapshot({ error: shouldSuppressAudioHostError(message) ? null : message });
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
  }, [applyConnectPlaybackStatus, isSpotifyCurrentTrack, publishOptimisticPause, queue, refreshPlaybackStatus, runPlaybackAction, visualState]);

  const handlePrevious = useCallback((): void => {
    void runPlaybackAction(queue.playPrevious);
  }, [queue.playPrevious, runPlaybackAction]);

  const handleNext = useCallback((): void => {
    void runPlaybackAction(queue.playNext);
  }, [queue.playNext, runPlaybackAction]);

  const handleStop = useCallback((): void => {
    if (queue.hqPlayerTakeoverEnabled) {
      return;
    }

    void (async () => {
      const activeConnectStatus = await getActiveConnectPlaybackStatus();
      const connect = window.echo?.connect;
      if (activeConnectStatus && connect?.stop) {
        const nextStatus = await connect.stop();
        applyConnectPlaybackStatus(nextStatus);
        await refreshPlaybackStatus();
        return;
      }

      if (isSpotifyCurrentTrack && queue.currentTrack) {
        await runPlaybackAction(() => stopSpotifyPlayback(queue.currentTrack!));
        return;
      }

      const playback = window.echo?.playback;
      if (!playback) {
        return;
      }

      await runPlaybackAction(() => playback.stop());
    })();
  }, [applyConnectPlaybackStatus, isSpotifyCurrentTrack, queue.currentTrack, queue.hqPlayerTakeoverEnabled, runPlaybackAction]);

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
    async (nextPositionSeconds: number): Promise<void> => {
      const playback = window.echo?.playback;

      if (durationSeconds <= 0) {
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
        const connectStatus = await window.echo?.connect?.seek?.(safePositionSeconds);
        if (!connectStatus) {
          return;
        }

        const nextStatus = applyConnectPlaybackStatus(connectStatus, safePositionSeconds);
        dispatchPlaybackSeeked(safePositionSeconds, nextStatus.currentTrackId ?? queue.currentTrackId ?? null);
        return;
      }

      if (!playback) {
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
      const playback = window.echo?.playback;

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
        if (!isPlaying) {
          void (async () => {
            const activeConnectStatus = await getActiveConnectPlaybackStatus();
            const connect = window.echo?.connect;
            if (activeConnectStatus && connect?.play) {
              applyConnectPlaybackStatus(await connect.play());
              await refreshPlaybackStatus();
              return;
            }

            if (!playback && !queue.hqPlayerTakeoverEnabled) {
              return;
            }

            if (queue.hqPlayerTakeoverEnabled) {
              await runPlaybackAction(queue.activateHqPlayerTakeover);
              return;
            }

            if (isSpotifyCurrentTrack && queue.currentTrack) {
              await runPlaybackAction(() => resumeSpotifyPlayback(queue.currentTrack!));
              return;
            }

            await runPlaybackAction(() =>
              (state === 'idle' || state === 'stopped') && queue.currentTrack ? queue.playTrack(queue.currentTrack) : playback!.play(),
            );
          })();
        }
        return;
      }

      if (command === 'pause') {
        void (async () => {
          const activeConnectStatus = await getActiveConnectPlaybackStatus();
          const connect = window.echo?.connect;
          if (activeConnectStatus && connect?.pause) {
            applyConnectPlaybackStatus(await connect.pause());
            await refreshPlaybackStatus();
            return;
          }

          if (queue.hqPlayerTakeoverEnabled) {
            return;
          }

          if (isSpotifyCurrentTrack && queue.currentTrack) {
            await runPlaybackAction(() => pauseSpotifyPlayback(queue.currentTrack!));
            return;
          }

          if (playback) {
            publishOptimisticPause();
            await runPlaybackAction(() => playback.pause());
          }
        })();
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
        handleStop();
      }
    },
    [applyConnectPlaybackStatus, commitSeek, handleNext, handlePlayPause, handlePrevious, handleStop, isPlaying, isSpotifyCurrentTrack, publishOptimisticPause, queue, runPlaybackAction, state],
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
        handleStop();
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
    [commitSeek, handleBossKey, handleNext, handlePlayPause, handlePrevious, handleSpeedStep, handleStop, handleVolumeStep, positionSeconds, toggleDesktopLyrics, toggleDesktopLyricsLock],
  );

  useEffect(() => {
    let cancelled = false;
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
    };

    refreshSmtcSetting();
    window.addEventListener('settings:changed', refreshSmtcSetting);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', refreshSmtcSetting);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.echo?.smtc?.onCommand(handleSmtcCommand);
    return () => unsubscribe?.();
  }, [handleSmtcCommand]);

  useEffect(() => {
    const unsubscribe = window.echo?.app?.onGlobalShortcutCommand?.(handleGlobalShortcutCommand);
    return () => unsubscribe?.();
  }, [handleGlobalShortcutCommand]);

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
    if (!smtcEnabled) {
      clearMediaSession();
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
  }, [commitSeek, handleSmtcCommand, positionSeconds, smtcEnabled]);

  return null;
};
