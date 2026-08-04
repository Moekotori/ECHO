import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, PointerEvent } from 'react';
import { ListMusic, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { AudioPlaybackState, AudioStatus } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { MiniPlayerState } from '../../shared/types/miniPlayer';
import type { PlaybackStatus } from '../../shared/types/playback';
import { isSpotifyTrack, pauseSpotifyPlayback, resumeSpotifyPlayback, seekSpotifyPlayback, setSpotifyVolume } from '../integrations/spotify/spotifyPlayback';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { beginPlaybackSeekSnapshot, getVisualPlaybackState, refreshPlaybackStatus, setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { formatPercent, formatTime, titleFromPath } from '../components/player/playerFormat';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';

type ForwardedAudioStatus = {
  status: AudioStatus;
  updatedAtMs: number;
};

type MiniPlaybackClock = {
  durationSeconds: number;
  playbackRate: number;
  positionSeconds: number;
  sourcePositionSeconds: number;
  state: AudioPlaybackState;
  trackKey: string | null;
  updatedAtMs: number;
};

type PlaybackVisualIntentSnapshot = {
  currentTrackId: string | null;
  filePath: string | null;
  expectedPositionMs: number;
  startedAtMs: number;
};

const enhancedLowLoadProgressRenderIntervalMs = 1500;
const minRealtimeProgressStepSeconds = 0.004;
const forwardedSystemStatusMaxAgeMs = 30_000;
const trackSwitchVisualIntentPositionToleranceMs = 1500;
const seekAnchorMaxAgeSeconds = 3;
const seekAnchorSettleToleranceSeconds = 0.25;
const activeStates = new Set<AudioPlaybackState>(['loading', 'playing']);
const restartStates = new Set<AudioPlaybackState>(['idle', 'stopped', 'ended']);

const defaultMiniPlayerState: MiniPlayerState = {
  visible: true,
  locked: false,
  bounds: null,
  settings: {
    miniPlayerEnabled: true,
    miniPlayerLocked: false,
    miniPlayerAutoHideMainWindow: true,
    miniPlayerBounds: null,
  },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const volumeFromStatus = (status: AudioStatus | null | undefined): number => clamp(status?.volume ?? 1, 0, 1);

const readFixedVolumeEnabled = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object') {
    return false;
  }

  return (settings as { fixedVolumeEnabled?: unknown }).fixedVolumeEnabled === true;
};

const readFixedVolumeEnabledPatch = (patch: unknown): boolean | null => {
  if (!patch || typeof patch !== 'object') {
    return null;
  }

  const value = (patch as { fixedVolumeEnabled?: unknown }).fixedVolumeEnabled;
  return typeof value === 'boolean' ? value : null;
};

const readEnhancedLowLoadPlaybackActive = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowLoadPlaybackModeEnabled === true && settings.lowLoadPlaybackEnhancementsEnabled === true;

const playbackTrackKey = (audioStatus: AudioStatus | null, playbackStatus: PlaybackStatus | null, fallbackTrackId: string | null): string | null =>
  audioStatus?.currentTrackId ?? playbackStatus?.currentTrackId ?? fallbackTrackId ?? audioStatus?.currentFilePath ?? playbackStatus?.filePath ?? null;

const lightweightArtworkUrl = (track: { coverThumb: string | null } | null, audioStatus: AudioStatus | null): string | null =>
  track?.coverThumb ?? audioStatus?.currentTrackCoverUrl ?? null;

const audioStatusMatchesPlaybackStatus = (audioStatus: AudioStatus, playbackStatus: PlaybackStatus | null): boolean => {
  if (!playbackStatus?.currentTrackId && !playbackStatus?.filePath) {
    return true;
  }

  return (
    Boolean(playbackStatus.currentTrackId && audioStatus.currentTrackId === playbackStatus.currentTrackId) ||
    Boolean(playbackStatus.filePath && audioStatus.currentFilePath === playbackStatus.filePath)
  );
};

const audioStatusMatchesVisualIntent = (status: AudioStatus, intent: PlaybackVisualIntentSnapshot | null | undefined): boolean => {
  if (!intent) {
    return true;
  }

  const matchesIntent =
    Boolean(intent.currentTrackId && status.currentTrackId === intent.currentTrackId) ||
    Boolean(intent.filePath && status.currentFilePath === intent.filePath);
  if (!matchesIntent) {
    return false;
  }

  const playbackRate = Number.isFinite(status.playbackRate) ? Math.max(0.25, Math.min(4, status.playbackRate)) : 1;
  const elapsedMs = status.state === 'playing' || status.state === 'paused' ? Math.max(0, Date.now() - intent.startedAtMs) : 0;
  const expectedPositionMs = intent.expectedPositionMs + elapsedMs * playbackRate;
  return Math.round(Math.max(0, status.positionSeconds) * 1000) <= expectedPositionMs + trackSwitchVisualIntentPositionToleranceMs;
};

const isUsableAudioStatus = (
  audioStatus: AudioStatus | null | undefined,
  playbackStatus: PlaybackStatus | null,
  playbackVisualIntent: PlaybackVisualIntentSnapshot | null | undefined,
): audioStatus is AudioStatus =>
  Boolean(
    audioStatus &&
      audioStatusMatchesPlaybackStatus(audioStatus, playbackStatus) &&
      audioStatusMatchesVisualIntent(audioStatus, playbackVisualIntent),
  );

const requestMiniPlayerQueueBounds = (open: boolean): void => {
  void window.echo?.miniPlayer?.setQueueOpen?.(open).catch(() => undefined);

  try {
    window.resizeTo(window.outerWidth || 388, open ? 324 : 74);
  } catch {
    // Electron IPC is the primary resize path; resizeTo is only a renderer fallback.
  }
};

export const MiniPlayerApp = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const queue = usePlaybackQueue();
  const setQueueCurrentTrackId = queue.setCurrentTrackId;
  const syncQueuePlaybackState = queue.syncPlaybackState;
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [, setMiniPlayerState] = useState<MiniPlayerState>(defaultMiniPlayerState);
  const [forwardedAudioStatus, setForwardedAudioStatus] = useState<ForwardedAudioStatus | null>(null);
  const [realtimePositionSeconds, setRealtimePositionSeconds] = useState(0);
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [volumePreview, setVolumePreview] = useState(1);
  const [fixedVolumeEnabled, setFixedVolumeEnabled] = useState(false);
  const [enhancedLowLoadPlaybackActive, setEnhancedLowLoadPlaybackActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const volumeInteractingRef = useRef(false);
  const pendingVolumeRef = useRef<number | null>(null);
  const seekAnchorRef = useRef<{ positionSeconds: number; trackKey: string | null; updatedAtMs: number } | null>(null);
  const clockRef = useRef<MiniPlaybackClock>({
    durationSeconds: 0,
    playbackRate: 1,
    positionSeconds: 0,
    sourcePositionSeconds: 0,
    state: 'idle',
    trackKey: null,
    updatedAtMs: performance.now(),
  });

  useEffect(() => {
    let cancelled = false;
    const miniPlayer = window.echo?.miniPlayer;
    if (!miniPlayer) {
      return undefined;
    }

    void miniPlayer.getState().then((state) => {
      if (!cancelled) {
        setMiniPlayerState(state);
      }
    }).catch(() => undefined);

    const unsubscribe = miniPlayer.onStateChanged?.((state) => {
      setMiniPlayerState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return undefined;
    }

    const getLastAudioStatus = desktopLyrics.getLastAudioStatus;
    if (getLastAudioStatus) {
      void getLastAudioStatus().then((status) => {
        if (!cancelled && status) {
          setForwardedAudioStatus({ status, updatedAtMs: Date.now() });
        }
      }).catch(() => undefined);
    }

    const unsubscribe = desktopLyrics.onAudioStatus?.((status) => {
      setForwardedAudioStatus({ status, updatedAtMs: Date.now() });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const activeAudioStatus = useMemo(() => {
    const forwarded = forwardedAudioStatus;
    const playbackVisualIntent = sharedPlaybackStatus.playbackVisualIntent;
    const sharedAudioStatus = isUsableAudioStatus(
      sharedPlaybackStatus.audioStatus,
      sharedPlaybackStatus.playbackStatus,
      playbackVisualIntent,
    )
      ? sharedPlaybackStatus.audioStatus
      : null;
    if (
      forwarded?.status.outputMode === 'system' &&
      Date.now() - forwarded.updatedAtMs <= forwardedSystemStatusMaxAgeMs &&
      (!sharedAudioStatus || sharedAudioStatus.outputMode === 'system')
    ) {
      return forwarded.status;
    }

    return sharedAudioStatus;
  }, [
    forwardedAudioStatus,
    sharedPlaybackStatus.audioStatus,
    sharedPlaybackStatus.playbackStatus,
    sharedPlaybackStatus.playbackVisualIntent,
  ]);

  const statusVolume = volumeFromStatus(activeAudioStatus);
  const playbackStatus = sharedPlaybackStatus.playbackStatus;
  const visualState = getVisualPlaybackState({
    audioStatus: activeAudioStatus,
    playbackStatus,
    playbackVisualIntent: sharedPlaybackStatus.playbackVisualIntent,
  });
  const realtimePlaybackState = activeAudioStatus?.state ?? playbackStatus?.state ?? 'idle';
  const statusTrackId = activeAudioStatus?.currentTrackId ?? playbackStatus?.currentTrackId ?? null;
  const statusFilePath = activeAudioStatus?.currentFilePath ?? playbackStatus?.filePath ?? null;
  const statusMatchedTrack =
    (statusTrackId
      ? queue.tracks.find((track) => track.id === statusTrackId) ??
        (queue.currentTrack?.id === statusTrackId ? queue.currentTrack : null) ??
        (queue.lastPlayedTrack?.id === statusTrackId ? queue.lastPlayedTrack : null)
      : null) ??
    (statusFilePath
      ? queue.tracks.find((track) => track.path === statusFilePath) ??
        (queue.currentTrack?.path === statusFilePath ? queue.currentTrack : null) ??
        (queue.lastPlayedTrack?.path === statusFilePath ? queue.lastPlayedTrack : null)
      : null);
  const trackId = statusTrackId ?? statusMatchedTrack?.id ?? queue.currentTrackId ?? null;
  const currentTrack =
    statusMatchedTrack ??
    (!statusTrackId && !statusFilePath
      ? queue.currentTrack ??
        queue.tracks.find((track) => track.id === trackId) ??
        (queue.lastPlayedTrack?.id === trackId ? queue.lastPlayedTrack : null)
      : null);
  const filePath = currentTrack?.path ?? statusFilePath;
  const title = currentTrack?.title?.trim() || activeAudioStatus?.currentTrackTitle?.trim() || titleFromPath(filePath);
  const artist =
    currentTrack?.artist?.trim() ||
    currentTrack?.albumArtist?.trim() ||
    activeAudioStatus?.currentTrackArtist?.trim() ||
    activeAudioStatus?.currentTrackAlbumArtist?.trim() ||
    (filePath ? t('miniPlayer.artist.unknown') : t('miniPlayer.status.ready'));
  const artworkUrl = lightweightArtworkUrl(currentTrack, activeAudioStatus);
  const isSpotifyCurrentTrack = isSpotifyTrack(currentTrack);
  const playbackRate = activeAudioStatus?.playbackRate ?? 1;
  const durationSeconds = Math.max(
    0,
    activeAudioStatus?.durationSeconds ??
      (playbackStatus?.durationMs ? playbackStatus.durationMs / 1000 : currentTrack?.duration ?? 0),
  );
  const sourcePositionSeconds = Math.max(0, activeAudioStatus?.positionSeconds ?? (playbackStatus?.positionMs ?? 0) / 1000);
  const progressTrackKey = playbackTrackKey(activeAudioStatus, playbackStatus, currentTrack?.id ?? trackId);
  const positionSeconds = seekPreviewSeconds ?? realtimePositionSeconds;
  const progress = durationSeconds > 0 ? clamp(positionSeconds / durationSeconds, 0, 1) : 0;
  const hasPlayableTarget = Boolean(filePath || currentTrack || playbackStatus || activeAudioStatus);
  const queueItems = queue.items;
  const activeQueueId = queue.currentQueueId ?? queueItems.find((item) => item.track.id === trackId)?.queueId ?? null;
  const hasQueuePreview = queueItems.length > 0 || Boolean(currentTrack || title);
  const displayVolume = fixedVolumeEnabled ? 1 : volumePreview;
  const VolumeIcon = displayVolume <= 0 ? VolumeX : displayVolume < 0.5 ? Volume1 : Volume2;

  useEffect(() => {
    let cancelled = false;

    const refreshMiniPlayerAudioSettings = (): void => {
      const getSettings = window.echo?.app?.getSettings;
      if (typeof getSettings !== 'function') {
        setFixedVolumeEnabled(false);
        setEnhancedLowLoadPlaybackActive(false);
        return;
      }

      void getSettings()
        .then((settings) => {
          if (!cancelled) {
            setFixedVolumeEnabled(readFixedVolumeEnabled(settings));
            setEnhancedLowLoadPlaybackActive(readEnhancedLowLoadPlaybackActive(settings));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFixedVolumeEnabled(false);
            setEnhancedLowLoadPlaybackActive(false);
          }
        });
    };

    const handleSettingsChanged = (event: Event): void => {
      if (event instanceof CustomEvent) {
        const fixedVolumePatch = readFixedVolumeEnabledPatch(event.detail);
        if (fixedVolumePatch !== null) {
          setFixedVolumeEnabled(fixedVolumePatch);
        }
      }

      refreshMiniPlayerAudioSettings();
    };

    refreshMiniPlayerAudioSettings();
    window.addEventListener('settings:changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    if (volumeInteractingRef.current || pendingVolumeRef.current !== null) {
      return;
    }

    setVolumePreview(fixedVolumeEnabled ? 1 : statusVolume);
  }, [fixedVolumeEnabled, statusVolume]);

  useEffect(() => {
    if (trackId) {
      setQueueCurrentTrackId(trackId);
    }
  }, [setQueueCurrentTrackId, trackId]);

  useEffect(() => {
    syncQueuePlaybackState(visualState);
  }, [syncQueuePlaybackState, visualState]);

  useEffect(() => {
    const now = performance.now();
    const previous = clockRef.current;
    const samePlayback = previous.trackKey === progressTrackKey;
    const boundedSourcePosition = durationSeconds > 0 ? clamp(sourcePositionSeconds, 0, durationSeconds) : Math.max(0, sourcePositionSeconds);
    let nextPositionSeconds = boundedSourcePosition;
    const seekAnchor = seekAnchorRef.current;

    if (seekAnchor) {
      if (seekAnchor.trackKey && progressTrackKey && seekAnchor.trackKey !== progressTrackKey) {
        seekAnchorRef.current = null;
      } else {
        const elapsedSeconds = Math.max(0, (now - seekAnchor.updatedAtMs) / 1000);
        const expectedSeekPosition = durationSeconds > 0
          ? clamp(seekAnchor.positionSeconds + (visualState === 'playing' ? elapsedSeconds * playbackRate : 0), 0, durationSeconds)
          : Math.max(0, seekAnchor.positionSeconds + (visualState === 'playing' ? elapsedSeconds * playbackRate : 0));
        const sourceReachedSeekTarget = boundedSourcePosition >= seekAnchor.positionSeconds;
        const isStaleStatusAfterSeek =
          elapsedSeconds < seekAnchorMaxAgeSeconds &&
          (!sourceReachedSeekTarget || Math.abs(boundedSourcePosition - expectedSeekPosition) > seekAnchorSettleToleranceSeconds);

        if (isStaleStatusAfterSeek) {
          nextPositionSeconds = expectedSeekPosition;
        } else {
          seekAnchorRef.current = null;
        }
      }
    }

    if (!seekAnchorRef.current && samePlayback && previous.state === 'playing' && visualState === 'playing') {
      const estimatedPositionSeconds = previous.positionSeconds + ((now - previous.updatedAtMs) / 1000) * previous.playbackRate;
      const boundedEstimate = durationSeconds > 0 ? clamp(estimatedPositionSeconds, 0, durationSeconds) : Math.max(0, estimatedPositionSeconds);
      if (boundedSourcePosition + 1.25 < boundedEstimate) {
        nextPositionSeconds = boundedEstimate;
      }
    }

    clockRef.current = {
      durationSeconds,
      playbackRate,
      positionSeconds: nextPositionSeconds,
      sourcePositionSeconds: boundedSourcePosition,
      state: visualState,
      trackKey: progressTrackKey,
      updatedAtMs: now,
    };
    setRealtimePositionSeconds(nextPositionSeconds);
  }, [durationSeconds, playbackRate, progressTrackKey, sourcePositionSeconds, visualState]);

  useEffect(() => {
    if (visualState !== 'playing' || realtimePlaybackState !== 'playing' || seekPreviewSeconds !== null) {
      return undefined;
    }

    const updateRealtimePosition = (): void => {
      const clock = clockRef.current;
      if (clock.state !== 'playing') {
        return;
      }
      const elapsedSeconds = ((performance.now() - clock.updatedAtMs) / 1000) * clock.playbackRate;
      const nextPosition = clock.positionSeconds + elapsedSeconds;
      const nextPositionSeconds = clock.durationSeconds > 0 ? clamp(nextPosition, 0, clock.durationSeconds) : Math.max(0, nextPosition);
      setRealtimePositionSeconds((currentPositionSeconds) =>
        Math.abs(nextPositionSeconds - currentPositionSeconds) >= minRealtimeProgressStepSeconds
          ? nextPositionSeconds
          : currentPositionSeconds,
      );
    };

    if (enhancedLowLoadPlaybackActive) {
      const timer = window.setInterval(updateRealtimePosition, enhancedLowLoadProgressRenderIntervalMs);
      return () => window.clearInterval(timer);
    }

    let frameId: number | null = null;
    let backgroundTimerId: number | null = null;
    const stopRealtimeFrame = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    };
    const stopBackgroundTimer = (): void => {
      if (backgroundTimerId !== null) {
        window.clearInterval(backgroundTimerId);
        backgroundTimerId = null;
      }
    };
    const tick = (): void => {
      updateRealtimePosition();
      frameId = window.requestAnimationFrame(tick);
    };

    const syncProgressLoop = (): void => {
      stopRealtimeFrame();
      stopBackgroundTimer();

      if (document.visibilityState === 'visible') {
        frameId = window.requestAnimationFrame(tick);
      } else {
        updateRealtimePosition();
        backgroundTimerId = window.setInterval(updateRealtimePosition, enhancedLowLoadProgressRenderIntervalMs);
      }
    };

    syncProgressLoop();
    document.addEventListener('visibilitychange', syncProgressLoop);
    return () => {
      document.removeEventListener('visibilitychange', syncProgressLoop);
      stopRealtimeFrame();
      stopBackgroundTimer();
    };
  }, [enhancedLowLoadPlaybackActive, realtimePlaybackState, seekPreviewSeconds, visualState]);

  useEffect(() => {
    requestMiniPlayerQueueBounds(isQueueOpen);

    return () => {
      if (isQueueOpen) {
        requestMiniPlayerQueueBounds(false);
      }
    };
  }, [isQueueOpen]);

  const runPlaybackAction = useCallback(async (
    action: () => Promise<PlaybackStatus | null | void>,
    options: { applyStatusSnapshot?: (status: PlaybackStatus) => void } = {},
  ): Promise<boolean> => {
    try {
      setError(null);
      const status = await action();
      if (status) {
        if (options.applyStatusSnapshot) {
          options.applyStatusSnapshot(status);
        } else {
          setPlaybackStatusSnapshot({ playbackStatus: status, error: null });
        }
      }
      void refreshPlaybackStatus();
      return true;
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      setError(message);
      setPlaybackStatusSnapshot({ error: message });
      return false;
    }
  }, []);

  const handlePlayPause = useCallback(async (): Promise<void> => {
    const playback = window.echo?.playback;

    if (queue.hqPlayerTakeoverEnabled) {
      if (activeStates.has(visualState)) {
        setError(t('miniPlayer.status.hqPlayerTakeover'));
        return;
      }

      await runPlaybackAction(queue.activateHqPlayerTakeover);
      return;
    }

    if (isSpotifyCurrentTrack && currentTrack) {
      await runPlaybackAction(() => (activeStates.has(visualState) ? pauseSpotifyPlayback(currentTrack) : resumeSpotifyPlayback(currentTrack)));
      return;
    }

    if (!playback) {
      setError('Desktop bridge unavailable');
      return;
    }

    await runPlaybackAction(async () => {
      if (activeStates.has(visualState)) {
        return playback.pause();
      }

      const latestStatus = await playback.getStatus();
      if (activeStates.has(latestStatus.state)) {
        return playback.pause();
      }
      if (restartStates.has(latestStatus.state) && queue.currentItem) {
        return queue.playQueueItem(queue.currentItem.queueId);
      }
      if (restartStates.has(latestStatus.state) && currentTrack) {
        return queue.playTrack(currentTrack);
      }
      return playback.play();
    });
  }, [currentTrack, isSpotifyCurrentTrack, queue, runPlaybackAction, t, visualState]);

  const handlePrevious = useCallback((): void => {
    void runPlaybackAction(queue.playPrevious);
  }, [queue.playPrevious, runPlaybackAction]);

  const handleNext = useCallback((): void => {
    void runPlaybackAction(queue.playNext);
  }, [queue.playNext, runPlaybackAction]);

  const commitSeek = useCallback(
    async (nextPositionSeconds: number): Promise<void> => {
      const safePositionSeconds = durationSeconds > 0 ? clamp(nextPositionSeconds, 0, durationSeconds) : Math.max(0, nextPositionSeconds);
      const previousPositionSeconds = durationSeconds > 0 ? clamp(sourcePositionSeconds, 0, durationSeconds) : Math.max(0, sourcePositionSeconds);
      const now = performance.now();
      seekAnchorRef.current = {
        positionSeconds: safePositionSeconds,
        trackKey: progressTrackKey,
        updatedAtMs: now,
      };
      clockRef.current = {
        durationSeconds,
        playbackRate,
        positionSeconds: safePositionSeconds,
        sourcePositionSeconds: safePositionSeconds,
        state: visualState,
        trackKey: progressTrackKey,
        updatedAtMs: now,
      };
      setSeekPreviewSeconds(safePositionSeconds);
      setRealtimePositionSeconds(safePositionSeconds);

      const succeeded = await runPlaybackAction(async () => {
        const targetPositionMs = Math.round(safePositionSeconds * 1000);
        if (isSpotifyCurrentTrack && currentTrack) {
          const status = await seekSpotifyPlayback(currentTrack, safePositionSeconds);
          return { ...status, positionMs: targetPositionMs };
        }

        if (queue.hqPlayerTakeoverEnabled) {
          const connectStatus = await window.echo?.connect?.seek?.(safePositionSeconds);
          if (connectStatus) {
            return {
              state: connectStatus.state === 'playing' ? 'playing' : connectStatus.state === 'paused' ? 'paused' : 'loading',
              currentTrackId: connectStatus.currentTrackId ?? trackId,
              positionMs: targetPositionMs,
              durationMs: Math.round(Math.max(0, connectStatus.durationSeconds) * 1000),
              filePath,
            };
          }
        }

        const status = await window.echo?.playback?.seek?.(safePositionSeconds);
        return status ? { ...status, positionMs: targetPositionMs } : status;
      }, { applyStatusSnapshot: beginPlaybackSeekSnapshot });
      if (!succeeded) {
        seekAnchorRef.current = null;
        clockRef.current = {
          ...clockRef.current,
          positionSeconds: previousPositionSeconds,
          sourcePositionSeconds: previousPositionSeconds,
          updatedAtMs: performance.now(),
        };
        setRealtimePositionSeconds(previousPositionSeconds);
      }
      setSeekPreviewSeconds(null);
    },
    [currentTrack, durationSeconds, filePath, isSpotifyCurrentTrack, playbackRate, progressTrackKey, queue.hqPlayerTakeoverEnabled, runPlaybackAction, sourcePositionSeconds, trackId, visualState],
  );

  const handleProgressChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSeekPreviewSeconds(Number(event.currentTarget.value));
  };

  const handleProgressPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    void commitSeek(Number(event.currentTarget.value));
  };

  const commitVolume = useCallback(
    async (nextVolume: number): Promise<void> => {
      const safeVolume = fixedVolumeEnabled ? 1 : clamp(nextVolume, 0, 1);
      pendingVolumeRef.current = safeVolume;
      setVolumePreview(safeVolume);

      try {
        setError(null);
        if (fixedVolumeEnabled) {
          const nextStatus = await window.echo?.audio?.setOutput?.({ volume: 1 });
          if (nextStatus) {
            setPlaybackStatusSnapshot({ audioStatus: nextStatus, error: null });
          }
          return;
        }

        if (isSpotifyCurrentTrack && currentTrack) {
          await setSpotifyVolume(safeVolume);
        } else {
          const audio = window.echo?.audio;
          if (!audio) {
            throw new Error('Desktop bridge unavailable');
          }

          const nextStatus = await audio.setOutput({ volume: safeVolume });
          setPlaybackStatusSnapshot({ audioStatus: nextStatus, error: null });
        }

        void window.echo?.app?.setSettings?.({ playerVolume: safeVolume }).catch(() => undefined);
        void refreshPlaybackStatus();
      } catch (volumeError) {
        const message = volumeError instanceof Error ? volumeError.message : String(volumeError);
        setError(message);
        setPlaybackStatusSnapshot({ error: message });
      } finally {
        if (pendingVolumeRef.current === safeVolume) {
          pendingVolumeRef.current = null;
        }
      }
    },
    [currentTrack, fixedVolumeEnabled, isSpotifyCurrentTrack],
  );

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setVolumePreview(Number(event.currentTarget.value));
  };

  const finishVolumeInteraction = (nextVolume: number): void => {
    volumeInteractingRef.current = false;
    void commitVolume(nextVolume);
  };

  const handleResetBounds = useCallback((): void => {
    setIsQueueOpen(false);
    void window.echo?.miniPlayer?.resetBounds?.().then(setMiniPlayerState).catch(() => undefined);
  }, []);

  const handleToggleQueue = useCallback((): void => {
    setIsQueueOpen((open) => {
      const nextOpen = !open;
      requestMiniPlayerQueueBounds(nextOpen);
      return nextOpen;
    });
  }, []);

  const handlePlayQueueItem = useCallback(
    (queueId: string): void => {
      void runPlaybackAction(() => queue.playQueueItem(queueId));
    },
    [queue, runPlaybackAction],
  );

  const style = {
    '--mini-player-progress': `${progress * 100}%`,
    '--mini-player-volume': `${displayVolume * 100}%`,
  } as CSSProperties;

  return (
    <main
      className={`mini-player-app ${isQueueOpen ? 'mini-player-app--queue-open' : ''}`}
      data-has-artwork={Boolean(artworkUrl)}
      data-playback-state={visualState}
      style={style}
    >
      <section className="mini-player-shell" aria-label={t('miniPlayer.aria.shell')}>
        <div className="mini-player-cover" data-empty={!artworkUrl}>
          {artworkUrl ? (
            <img alt="" draggable={false} src={artworkUrl} />
          ) : (
            <span className="mini-player-cover-mark" />
          )}
        </div>

        <div className="mini-player-main">
          <div className="mini-player-title-row">
            <div className="mini-player-copy">
              <strong title={title}>{title}</strong>
              <span title={artist}>{artist}</span>
            </div>
            <div className="mini-player-transport">
              <button
                aria-label={t('miniPlayer.action.previous')}
                className="mini-player-icon-button mini-player-icon-button--transport"
                disabled={!queue.canGoPrevious}
                title={t('miniPlayer.action.previous')}
                type="button"
                onClick={handlePrevious}
              >
                <SkipBack size={15} />
              </button>
              <button
                aria-label={activeStates.has(visualState) ? t('miniPlayer.action.pause') : t('miniPlayer.action.play')}
                className="mini-player-icon-button mini-player-icon-button--play"
                disabled={!hasPlayableTarget}
                title={activeStates.has(visualState) ? t('miniPlayer.action.pause') : t('miniPlayer.action.play')}
                type="button"
                onClick={() => void handlePlayPause()}
              >
                {activeStates.has(visualState) ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                aria-label={t('miniPlayer.action.next')}
                className="mini-player-icon-button mini-player-icon-button--transport"
                disabled={!queue.canGoNext}
                title={t('miniPlayer.action.next')}
                type="button"
                onClick={handleNext}
              >
                <SkipForward size={15} />
              </button>
            </div>
            <button
              aria-label={t('miniPlayer.action.volume')}
              aria-pressed={isVolumeOpen}
              className={`mini-player-icon-button mini-player-volume-toggle ${isVolumeOpen ? 'is-active' : ''}`}
              title={fixedVolumeEnabled ? t('playerVolume.fixed.enabled') : t('miniPlayer.action.volume')}
              type="button"
              onClick={() => setIsVolumeOpen((open) => !open)}
            >
              <VolumeIcon size={14} />
            </button>
            <button
              aria-label={t('miniPlayer.action.resetPosition')}
              className="mini-player-icon-button mini-player-reset-button"
              title={t('miniPlayer.action.resetPosition')}
              type="button"
              onClick={handleResetBounds}
            >
              <RotateCcw size={13} />
            </button>
            <button
              aria-label={isQueueOpen ? t('miniPlayer.action.closeQueue') : t('miniPlayer.action.openQueue')}
              aria-pressed={isQueueOpen}
              className={`mini-player-icon-button mini-player-queue-toggle ${isQueueOpen ? 'is-active' : ''}`}
              disabled={!hasQueuePreview}
              title={isQueueOpen ? t('miniPlayer.action.closeQueue') : t('miniPlayer.action.openQueue')}
              type="button"
              onClick={handleToggleQueue}
            >
              <ListMusic size={14} />
            </button>
            <button
              aria-label={t('miniPlayer.action.close')}
              className="mini-player-icon-button mini-player-close-button"
              title={t('miniPlayer.action.closeShort')}
              type="button"
              onClick={() => {
                setIsQueueOpen(false);
                void window.echo?.miniPlayer?.hide?.({ restoreMainWindow: true });
              }}
            >
              <X size={12} />
            </button>
          </div>

          {isVolumeOpen ? (
            <div className="mini-player-volume-row">
              <VolumeIcon size={13} aria-hidden="true" />
              <input
                aria-label={t('miniPlayer.aria.volume')}
                disabled={fixedVolumeEnabled}
                max={1}
                min={0}
                step={0.01}
                type="range"
                value={displayVolume}
                onBlur={(event) => {
                  if (volumeInteractingRef.current) {
                    finishVolumeInteraction(Number(event.currentTarget.value));
                  }
                }}
                onChange={handleVolumeChange}
                onKeyUp={(event) => {
                  if (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                    void commitVolume(Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={(event) => finishVolumeInteraction(Number(event.currentTarget.value))}
                onPointerDown={() => {
                  volumeInteractingRef.current = true;
                }}
                onPointerUp={(event) => finishVolumeInteraction(Number(event.currentTarget.value))}
              />
              <span>{formatPercent(displayVolume)}</span>
            </div>
          ) : (
            <div className="mini-player-progress-row">
              <span>{formatTime(positionSeconds)}</span>
              <input
                aria-label={t('miniPlayer.aria.progress')}
                disabled={!durationSeconds || !hasPlayableTarget}
                max={Math.max(1, durationSeconds)}
                min={0}
                step={0.5}
                type="range"
                value={clamp(positionSeconds, 0, Math.max(1, durationSeconds))}
                onChange={handleProgressChange}
                onPointerUp={handleProgressPointerUp}
              />
              <span>{formatTime(durationSeconds)}</span>
            </div>
          )}
          {error ? <p className="mini-player-error" title={error}>{error}</p> : null}
        </div>
        {isQueueOpen ? (
          <div className="mini-player-queue-panel" role="listbox" aria-label={t('miniPlayer.aria.queue')}>
            {queueItems.length > 0 ? (
              queueItems.map((item) => {
                const isActive = item.queueId === activeQueueId || item.track.id === trackId;
                const itemTitle = item.track.title || titleFromPath(item.track.path);
                const itemArtist = item.track.artist?.trim() || item.track.albumArtist?.trim();

                return (
                  <button
                    key={item.queueId}
                    aria-current={isActive ? 'true' : undefined}
                    className="mini-player-queue-item"
                    title={itemArtist ? `${itemTitle} - ${itemArtist}` : itemTitle}
                    type="button"
                    onClick={() => handlePlayQueueItem(item.queueId)}
                  >
                    <span className="mini-player-queue-playing" aria-hidden="true">
                      {isActive ? '||' : ''}
                    </span>
                    <span className="mini-player-queue-title">{itemTitle}</span>
                  </button>
                );
              })
            ) : currentTrack || title ? (
              <div className="mini-player-queue-item mini-player-queue-item--static" aria-current="true">
                <span className="mini-player-queue-playing" aria-hidden="true">||</span>
                <span className="mini-player-queue-title">{title}</span>
              </div>
            ) : (
              <p className="mini-player-queue-empty">{t('miniPlayer.status.queueEmpty')}</p>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
};
