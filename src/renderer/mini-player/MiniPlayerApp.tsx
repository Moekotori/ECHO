import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, PointerEvent } from 'react';
import { AudioLines, ListMusic, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { AudioPlaybackState, AudioStatus } from '../../shared/types/audio';
import type { MiniPlayerState } from '../../shared/types/miniPlayer';
import type { PersistedPlaybackSessionV1, PlaybackStatus } from '../../shared/types/playback';
import { setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { formatPercent, formatTime, titleFromPath } from '../components/player/playerFormat';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';
import { translateStatic } from '../i18n/translateStatic';

type ForwardedAudioStatus = {
  status: AudioStatus;
  expiresAtMs: number | null;
};

type ForwardedPlaybackStatus = {
  status: PlaybackStatus;
  expiresAtMs: number | null;
};

const forwardedSystemStatusMaxAgeMs = 30_000;
const forwardedPlaybackStatusMaxAgeMs = 30_000;
const activeStates = new Set<AudioPlaybackState>(['loading', 'playing']);

const defaultMiniPlayerState: MiniPlayerState = {
  visible: true,
  locked: false,
  queueOpen: false,
  bounds: null,
  settings: {
    miniPlayerEnabled: true,
    miniPlayerLocked: false,
    miniPlayerAutoHideMainWindow: true,
    miniPlayerBounds: null,
  },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const volumeFromStatus = (
  audioStatus: AudioStatus | null | undefined,
  playbackStatus: PlaybackStatus | null | undefined,
): number => clamp(audioStatus?.volume ?? playbackStatus?.volume ?? 1, 0, 1);

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

const isUsableAudioStatus = (
  audioStatus: AudioStatus | null | undefined,
  playbackStatus: PlaybackStatus | null,
): audioStatus is AudioStatus =>
  Boolean(
    audioStatus &&
      audioStatusMatchesPlaybackStatus(audioStatus, playbackStatus),
  );

const audioStatusesMatch = (a: AudioStatus, b: AudioStatus): boolean =>
  Boolean(a.currentTrackId && a.currentTrackId === b.currentTrackId) ||
  Boolean(a.currentFilePath && a.currentFilePath === b.currentFilePath);

const isNewerQueueSession = (
  current: PersistedPlaybackSessionV1 | null,
  next: PersistedPlaybackSessionV1 | null,
): boolean => {
  if (!current || !next) {
    return true;
  }
  if (typeof current.revision === 'number' && typeof next.revision === 'number' && current.revision !== next.revision) {
    return next.revision > current.revision;
  }
  return Date.parse(next.updatedAt) >= Date.parse(current.updatedAt);
};

const ScrollingTrackTitle = ({ title }: { title: string }): JSX.Element => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) {
      return undefined;
    }

    const measure = (): void => {
      setIsOverflowing(text.scrollWidth > viewport.clientWidth + 1);
    };

    measure();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(text);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [title]);

  return (
    <div
      className={`mini-player-title-marquee${isOverflowing ? ' is-overflowing' : ''}`}
      ref={viewportRef}
      title={title}
    >
      <div className="mini-player-title-marquee-track">
        <strong ref={textRef}>{title}</strong>
        {isOverflowing ? <strong aria-hidden="true">{title}</strong> : null}
      </div>
    </div>
  );
};

export const MiniPlayerApp = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [, setMiniPlayerState] = useState<MiniPlayerState>(defaultMiniPlayerState);
  const [queueSession, setQueueSession] = useState<PersistedPlaybackSessionV1 | null>(null);
  const [forwardedAudioStatus, setForwardedAudioStatus] = useState<ForwardedAudioStatus | null>(null);
  const [forwardedPlaybackStatus, setForwardedPlaybackStatus] = useState<ForwardedPlaybackStatus | null>(null);
  const [forwardedStatusClockMs, setForwardedStatusClockMs] = useState(() => Date.now());
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [volumePreview, setVolumePreview] = useState(1);
  const [fixedVolumeEnabled, setFixedVolumeEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const volumeInteractingRef = useRef(false);
  const pendingVolumeRef = useRef<number | null>(null);
  const seekCommittingRef = useRef(false);
  const pendingSeekTargetRef = useRef<number | null>(null);
  const transportPendingRef = useRef(false);
  const latestStatusVolumeRef = useRef(1);
  const activeQueueItemRef = useRef<HTMLButtonElement | null>(null);
  const [transportPending, setTransportPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let receivedLiveState = false;
    const miniPlayer = window.echo?.miniPlayer;
    if (!miniPlayer) {
      return undefined;
    }

    const applyMiniPlayerState = (state: MiniPlayerState): void => {
      if (cancelled) {
        return;
      }
      setMiniPlayerState(state);
      if (typeof state.queueOpen === 'boolean') {
        setIsQueueOpen(state.queueOpen);
      }
    };

    const unsubscribe = miniPlayer.onStateChanged?.((state) => {
      receivedLiveState = true;
      applyMiniPlayerState(state);
    });
    void miniPlayer.getState().then((state) => {
      if (!receivedLiveState) {
        applyMiniPlayerState(state);
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let receivedLiveQueueSession = false;
    const playback = window.echo?.playback;
    if (!playback) {
      return undefined;
    }

    const applyQueueSession = (next: PersistedPlaybackSessionV1 | null): void => {
      if (cancelled) {
        return;
      }
      setQueueSession((current) => (isNewerQueueSession(current, next) ? next : current));
    };

    const unsubscribe = playback.onQueueSessionChanged?.((next) => {
      receivedLiveQueueSession = true;
      applyQueueSession(next);
    });
    void playback.getQueueSession().then((next) => {
      if (!receivedLiveQueueSession) {
        applyQueueSession(next);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let receivedLiveAudioStatus = false;
    let receivedLivePlaybackStatus = false;
    const desktopLyrics = window.echo?.desktopLyrics;
    if (!desktopLyrics) {
      return undefined;
    }

    const applyForwardedAudioStatus = (status: AudioStatus, expiresAtMs: number | null = null): void => {
      setForwardedAudioStatus({ status, expiresAtMs });
      if (expiresAtMs !== null) {
        setForwardedStatusClockMs(Date.now());
      }
    };
    const applyForwardedPlaybackStatus = (status: PlaybackStatus, expiresAtMs: number | null = null): void => {
      setForwardedPlaybackStatus({ status, expiresAtMs });
      if (expiresAtMs !== null) {
        setForwardedStatusClockMs(Date.now());
      }
    };

    const unsubscribeAudio = desktopLyrics.onAudioStatus?.((status) => {
      if (cancelled) {
        return;
      }
      receivedLiveAudioStatus = true;
      applyForwardedAudioStatus(status);
    });
    const unsubscribePlayback = desktopLyrics.onPlaybackStatus?.((status) => {
      if (cancelled) {
        return;
      }
      receivedLivePlaybackStatus = true;
      applyForwardedPlaybackStatus(status);
    });

    const getLastAudioStatus = desktopLyrics.getLastAudioStatus;
    if (getLastAudioStatus) {
      void getLastAudioStatus().then((status) => {
        if (!cancelled && !receivedLiveAudioStatus && status) {
          applyForwardedAudioStatus(status, Date.now() + forwardedSystemStatusMaxAgeMs);
        }
      }).catch(() => undefined);
    }

    const getLastPlaybackStatus = desktopLyrics.getLastPlaybackStatus;
    if (getLastPlaybackStatus) {
      void getLastPlaybackStatus().then((status) => {
        if (!cancelled && !receivedLivePlaybackStatus && status) {
          applyForwardedPlaybackStatus(status, Date.now() + forwardedPlaybackStatusMaxAgeMs);
        }
      }).catch(() => undefined);
    }

    return () => {
      cancelled = true;
      unsubscribeAudio?.();
      unsubscribePlayback?.();
    };
  }, []);

  useEffect(() => {
    const expiryTimes = [
      forwardedAudioStatus?.expiresAtMs ?? null,
      forwardedPlaybackStatus?.expiresAtMs ?? null,
    ].filter((value): value is number => value !== null && value > forwardedStatusClockMs);
    if (expiryTimes.length === 0) {
      return undefined;
    }

    const nextExpiryMs = Math.min(...expiryTimes);
    const timer = window.setTimeout(
      () => setForwardedStatusClockMs(Date.now()),
      Math.max(1, nextExpiryMs - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [forwardedAudioStatus, forwardedPlaybackStatus, forwardedStatusClockMs]);

  const forwardedPlaybackCandidate =
    forwardedPlaybackStatus &&
    (forwardedPlaybackStatus.expiresAtMs === null || forwardedStatusClockMs <= forwardedPlaybackStatus.expiresAtMs)
      ? forwardedPlaybackStatus.status
      : null;
  const identifiedActiveSharedAudio =
    sharedPlaybackStatus.audioStatus &&
    (activeStates.has(sharedPlaybackStatus.audioStatus.state) || sharedPlaybackStatus.audioStatus.state === 'paused') &&
    (sharedPlaybackStatus.audioStatus.currentTrackId || sharedPlaybackStatus.audioStatus.currentFilePath)
      ? sharedPlaybackStatus.audioStatus
      : null;
  const playbackStatus =
    forwardedPlaybackCandidate &&
    (!identifiedActiveSharedAudio || audioStatusMatchesPlaybackStatus(identifiedActiveSharedAudio, forwardedPlaybackCandidate))
      ? forwardedPlaybackCandidate
      : sharedPlaybackStatus.playbackStatus;
  const queueItems = queueSession?.items ?? [];
  const queueTracks = queueItems.map((item) => item.track);
  const activeAudioStatus = useMemo(() => {
    const forwarded = forwardedAudioStatus;
    const sharedAudioStatus = isUsableAudioStatus(
      sharedPlaybackStatus.audioStatus,
      playbackStatus,
    )
      ? sharedPlaybackStatus.audioStatus
      : null;
    if (
      forwarded?.status.outputMode === 'system' &&
      (forwarded.expiresAtMs === null || forwardedStatusClockMs <= forwarded.expiresAtMs) &&
      isUsableAudioStatus(forwarded.status, playbackStatus) &&
      (
        !sharedAudioStatus ||
        (
          sharedAudioStatus.outputMode === 'system' &&
          (
            (!sharedAudioStatus.currentTrackId && !sharedAudioStatus.currentFilePath) ||
            audioStatusesMatch(forwarded.status, sharedAudioStatus)
          )
        )
      )
    ) {
      return forwarded.status;
    }

    return sharedAudioStatus;
  }, [
    forwardedAudioStatus,
    forwardedStatusClockMs,
    playbackStatus,
    sharedPlaybackStatus.audioStatus,
  ]);

  const statusVolume = volumeFromStatus(activeAudioStatus, playbackStatus);
  latestStatusVolumeRef.current = statusVolume;
  const visualState = activeAudioStatus?.state ?? playbackStatus?.state ?? 'idle';
  const statusTrackId = activeAudioStatus?.currentTrackId ?? playbackStatus?.currentTrackId ?? null;
  const statusFilePath = activeAudioStatus?.currentFilePath ?? playbackStatus?.filePath ?? null;
  const statusMatchedTrack =
    (statusTrackId
      ? queueTracks.find((track) => track.id === statusTrackId) ??
        (queueSession?.lastPlayedTrack?.id === statusTrackId ? queueSession.lastPlayedTrack : null)
      : null) ??
    (statusFilePath
      ? queueTracks.find((track) => track.path === statusFilePath) ??
        (queueSession?.lastPlayedTrack?.path === statusFilePath ? queueSession.lastPlayedTrack : null)
      : null);
  const trackId = statusTrackId ?? statusMatchedTrack?.id ?? queueSession?.currentTrackId ?? null;
  const currentTrack =
    statusMatchedTrack ??
    (!statusTrackId && !statusFilePath
      ? queueTracks.find((track) => track.id === trackId) ??
        (queueSession?.lastPlayedTrack?.id === trackId ? queueSession.lastPlayedTrack : null)
      : null);
  const filePath = currentTrack?.path ?? statusFilePath;
  const title =
    currentTrack?.title?.trim() ||
    activeAudioStatus?.currentTrackTitle?.trim() ||
    (filePath ? titleFromPath(filePath) : t('miniPlayer.status.ready'));
  const artist =
    currentTrack?.artist?.trim() ||
    currentTrack?.albumArtist?.trim() ||
    activeAudioStatus?.currentTrackArtist?.trim() ||
    activeAudioStatus?.currentTrackAlbumArtist?.trim() ||
    (filePath ? t('miniPlayer.artist.unknown') : '');
  const artworkUrl = lightweightArtworkUrl(currentTrack, activeAudioStatus);
  const durationSeconds = Math.max(
    0,
    activeAudioStatus?.durationSeconds ??
      (playbackStatus?.durationMs ? playbackStatus.durationMs / 1000 : currentTrack?.duration ?? 0),
  );
  const sourcePositionSeconds = Math.max(0, activeAudioStatus?.positionSeconds ?? (playbackStatus?.positionMs ?? 0) / 1000);
  const positionSeconds = seekPreviewSeconds ?? sourcePositionSeconds;
  const progress = durationSeconds > 0 ? clamp(positionSeconds / durationSeconds, 0, 1) : 0;
  const hasPlayableTarget = Boolean(filePath || currentTrack || statusTrackId || statusFilePath);
  const statusMatchedQueueItems = queueItems.filter((item) =>
    Boolean(statusTrackId && item.track.id === statusTrackId) ||
    Boolean(statusFilePath && item.track.path === statusFilePath),
  );
  const statusMatchedQueueId =
    statusMatchedQueueItems.find((item) => item.queueId === queueSession?.currentQueueId)?.queueId ??
    statusMatchedQueueItems[0]?.queueId ??
    null;
  const activeQueueId = statusTrackId || statusFilePath
    ? statusMatchedQueueId
    : queueSession?.currentQueueId ?? queueItems.find((item) => item.track.id === trackId)?.queueId ?? null;
  const hasQueuePreview = queueItems.length > 0 || Boolean(currentTrack || statusTrackId || statusFilePath);
  const currentQueueIndex = activeQueueId ? queueItems.findIndex((item) => item.queueId === activeQueueId) : -1;
  const canGoPrevious = Boolean(
    queueSession?.history.length ||
    currentQueueIndex > 0 ||
    (queueSession?.mode.repeatMode === 'all' && queueItems.length > 1),
  );
  const canGoNext = Boolean(
    queueItems.length > 0 &&
    (
      currentQueueIndex < 0 ||
      currentQueueIndex < queueItems.length - 1 ||
      queueSession?.mode.repeatMode === 'all' ||
      queueSession?.mode.repeatMode === 'one' ||
      queueSession?.mode.isShuffleEnabled ||
      queueSession?.mode.autoFillQueueEnabled === true
    ),
  );
  const displayVolume = fixedVolumeEnabled ? 1 : volumePreview;
  const VolumeIcon = displayVolume <= 0 ? VolumeX : displayVolume < 0.5 ? Volume1 : Volume2;

  useEffect(() => {
    let cancelled = false;

    const refreshMiniPlayerAudioSettings = (): void => {
      const getSettings = window.echo?.app?.getSettings;
      if (typeof getSettings !== 'function') {
        setFixedVolumeEnabled(false);
        return;
      }

      void getSettings()
        .then((settings) => {
          if (!cancelled) {
            setFixedVolumeEnabled(readFixedVolumeEnabled(settings));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFixedVolumeEnabled(false);
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
    document.addEventListener('visibilitychange', refreshMiniPlayerAudioSettings);

    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
      document.removeEventListener('visibilitychange', refreshMiniPlayerAudioSettings);
    };
  }, []);

  useEffect(() => {
    if (volumeInteractingRef.current || pendingVolumeRef.current !== null) {
      return;
    }

    setVolumePreview(fixedVolumeEnabled ? 1 : statusVolume);
  }, [fixedVolumeEnabled, statusVolume]);

  useEffect(() => {
    if (isQueueOpen) {
      activeQueueItemRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeQueueId, isQueueOpen]);

  const runPlaybackAction = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    try {
      setError(null);
      await action();
      return true;
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      setError(message);
      setPlaybackStatusSnapshot({ error: message });
      return false;
    }
  }, []);

  const handlePlayPause = useCallback(async (): Promise<void> => {
    const controlMainWindow = window.echo?.playback?.controlMainWindow;
    if (!controlMainWindow) {
      setError(translateStatic('error.bridge.desktopShort'));
      return;
    }
    await runPlaybackAction(() => controlMainWindow({ type: 'playPause' }));
  }, [runPlaybackAction]);

  const runTransportAction = useCallback(async (type: 'previous' | 'next'): Promise<void> => {
    if (transportPendingRef.current) {
      return;
    }

    const controlMainWindow = window.echo?.playback?.controlMainWindow;
    if (!controlMainWindow) {
      setError(translateStatic('error.bridge.desktopShort'));
      return;
    }

    transportPendingRef.current = true;
    setTransportPending(true);
    try {
      await runPlaybackAction(() => controlMainWindow({ type }));
    } finally {
      transportPendingRef.current = false;
      setTransportPending(false);
    }
  }, [runPlaybackAction]);

  const handlePrevious = useCallback((): void => {
    void runTransportAction('previous');
  }, [runTransportAction]);

  const handleNext = useCallback((): void => {
    void runTransportAction('next');
  }, [runTransportAction]);

  const commitSeek = useCallback(
    async (nextPositionSeconds: number): Promise<void> => {
      const safePositionSeconds = durationSeconds > 0 ? clamp(nextPositionSeconds, 0, durationSeconds) : Math.max(0, nextPositionSeconds);
      pendingSeekTargetRef.current = safePositionSeconds;
      setSeekPreviewSeconds(safePositionSeconds);
      if (seekCommittingRef.current) {
        return;
      }

      const controlMainWindow = window.echo?.playback?.controlMainWindow;
      if (!controlMainWindow) {
        setError(translateStatic('error.bridge.desktopShort'));
        pendingSeekTargetRef.current = null;
        setSeekPreviewSeconds(null);
        return;
      }

      seekCommittingRef.current = true;
      try {
        while (pendingSeekTargetRef.current !== null) {
          const targetPositionSeconds = pendingSeekTargetRef.current;
          pendingSeekTargetRef.current = null;
          await runPlaybackAction(() => controlMainWindow({ type: 'seek', positionSeconds: targetPositionSeconds }));
        }
      } finally {
        seekCommittingRef.current = false;
        if (pendingSeekTargetRef.current === null) {
          setSeekPreviewSeconds(null);
        }
      }
    },
    [durationSeconds, runPlaybackAction],
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
        const controlMainWindow = window.echo?.playback?.controlMainWindow;
        if (!controlMainWindow) {
          throw new Error(translateStatic('error.bridge.desktopShort'));
        }
        await controlMainWindow({ type: 'setVolume', volume: safeVolume });
      } catch (volumeError) {
        const message = volumeError instanceof Error ? volumeError.message : String(volumeError);
        setError(message);
        setPlaybackStatusSnapshot({ error: message });
      } finally {
        if (pendingVolumeRef.current === safeVolume) {
          pendingVolumeRef.current = null;
          setVolumePreview(fixedVolumeEnabled ? 1 : latestStatusVolumeRef.current);
        }
      }
    },
    [fixedVolumeEnabled],
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
    const setQueueOpen = window.echo?.miniPlayer?.setQueueOpen;
    const nextOpen = !isQueueOpen;
    if (!setQueueOpen) {
      setError(translateStatic('error.bridge.desktopShort'));
      return;
    }

    setIsQueueOpen(nextOpen);
    setError(null);
    void setQueueOpen(nextOpen)
      .then((state) => {
        setMiniPlayerState(state);
        if (typeof state.queueOpen === 'boolean') {
          setIsQueueOpen(state.queueOpen);
        }
      })
      .catch((queueError) => {
        setIsQueueOpen(!nextOpen);
        setError(queueError instanceof Error ? queueError.message : String(queueError));
      });
  }, [isQueueOpen]);

  const handlePlayQueueItem = useCallback(
    (queueId: string): void => {
      const controlMainWindow = window.echo?.playback?.controlMainWindow;
      if (controlMainWindow) {
        void runPlaybackAction(() => controlMainWindow({ type: 'playQueueItem', queueId }));
      }
    },
    [runPlaybackAction],
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
              <ScrollingTrackTitle title={title} />
              <span title={artist}>{artist}</span>
            </div>
            <div className="mini-player-transport">
              <button
                aria-label={t('miniPlayer.action.previous')}
                className="mini-player-icon-button mini-player-icon-button--transport"
                disabled={!canGoPrevious || transportPending}
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
                disabled={!canGoNext || transportPending}
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
                onBlur={(event) => {
                  if (seekPreviewSeconds !== null && !seekCommittingRef.current) {
                    void commitSeek(Number(event.currentTarget.value));
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key === 'Enter' || event.key === ' ') {
                    void commitSeek(Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={() => setSeekPreviewSeconds(null)}
                onPointerUp={handleProgressPointerUp}
              />
              <span>{formatTime(durationSeconds)}</span>
            </div>
          )}
          {error ? <p className="mini-player-error" title={error}>{error}</p> : null}
        </div>
        {isQueueOpen ? (
          <div className="mini-player-queue-panel" role="group" aria-label={t('miniPlayer.aria.queue')}>
            <div className="mini-player-queue-header" aria-hidden="true">
              <strong>{t('miniPlayer.aria.queue')}</strong>
              <span>{queueItems.length}</span>
            </div>
            {queueItems.length > 0 ? (
              queueItems.map((item, index) => {
                const isActive = activeQueueId ? item.queueId === activeQueueId : item.track.id === trackId;
                const itemTitle = item.track.title || titleFromPath(item.track.path);
                const itemArtist = item.track.artist?.trim() || item.track.albumArtist?.trim();

                return (
                  <button
                    key={item.queueId}
                    aria-current={isActive ? 'true' : undefined}
                    className="mini-player-queue-item"
                    ref={isActive ? activeQueueItemRef : undefined}
                    title={itemArtist ? `${itemTitle} - ${itemArtist}` : itemTitle}
                    type="button"
                    onClick={() => handlePlayQueueItem(item.queueId)}
                  >
                    <span className="mini-player-queue-playing" aria-hidden="true">
                      {isActive ? <AudioLines size={13} /> : index + 1}
                    </span>
                    <span className="mini-player-queue-title">{itemTitle}</span>
                    <span className="mini-player-queue-duration">{formatTime(item.track.duration ?? 0)}</span>
                  </button>
                );
              })
            ) : currentTrack || title ? (
              <div className="mini-player-queue-item mini-player-queue-item--static" aria-current="true">
                <span className="mini-player-queue-playing" aria-hidden="true"><AudioLines size={13} /></span>
                <span className="mini-player-queue-title">{title}</span>
                <span className="mini-player-queue-duration">{formatTime(durationSeconds)}</span>
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
