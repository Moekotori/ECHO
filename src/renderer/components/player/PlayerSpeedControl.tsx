import { useCallback, useEffect, useRef, useState } from 'react';
import type { WheelEvent } from 'react';
import { Gauge, RotateCcw } from 'lucide-react';
import type { AudioStatus, PlaybackSpeedMode } from '../../../shared/types/audio';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type PlayerSpeedControlProps = {
  status: AudioStatus | null;
  onStatusChange: (status: AudioStatus) => void;
  onError: (message: string) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

const clampPlaybackRate = (value: number): number => Math.max(0.5, Math.min(2, value));
const formatSpeed = (value: number): string => `${clampPlaybackRate(value).toFixed(2)}x`;
const speedFromStatus = (status: AudioStatus | null): number => clampPlaybackRate(status?.playbackRate ?? 1);
const modeFromStatus = (status: AudioStatus | null): PlaybackSpeedMode => status?.playbackSpeedMode ?? 'nightcore';
const speedsMatch = (left: number, right: number): boolean => Math.abs(left - right) < 0.001;
const popoverCloseDistancePx = 150;
const popoverExitAnimationMs = 180;
const pendingCommitGuardMs = 1200;

const distanceFromRect = (x: number, y: number, rect: DOMRect): number => {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
};

export const PlayerSpeedControl = ({
  status,
  onStatusChange,
  onError,
  isOpen,
  onOpenChange,
}: PlayerSpeedControlProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [playbackRate, setPlaybackRate] = useState(speedFromStatus(status));
  const [mode, setMode] = useState<PlaybackSpeedMode>(modeFromStatus(status));
  const [shouldRenderPopover, setShouldRenderPopover] = useState(isOpen);
  const [isPopoverVisible, setIsPopoverVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const pendingCommitRef = useRef<{ playbackRate: number; mode: PlaybackSpeedMode } | null>(null);
  const pendingCommitTimeoutRef = useRef<number | null>(null);
  const interactionRevisionRef = useRef(0);

  const clearPendingCommit = useCallback((): void => {
    pendingCommitRef.current = null;
    if (pendingCommitTimeoutRef.current !== null) {
      window.clearTimeout(pendingCommitTimeoutRef.current);
      pendingCommitTimeoutRef.current = null;
    }
  }, []);

  const holdPendingCommit = useCallback((pendingCommit: { playbackRate: number; mode: PlaybackSpeedMode }): void => {
    clearPendingCommit();
    pendingCommitRef.current = pendingCommit;
    pendingCommitTimeoutRef.current = window.setTimeout(() => {
      if (
        pendingCommitRef.current &&
        speedsMatch(pendingCommitRef.current.playbackRate, pendingCommit.playbackRate) &&
        pendingCommitRef.current.mode === pendingCommit.mode
      ) {
        pendingCommitRef.current = null;
      }
      pendingCommitTimeoutRef.current = null;
    }, pendingCommitGuardMs);
  }, [clearPendingCommit]);

  const markUserInteraction = useCallback((): void => {
    interactionRevisionRef.current += 1;
  }, []);

  useEffect(() => {
    return () => clearPendingCommit();
  }, [clearPendingCommit]);

  useEffect(() => {
    if (isOpen) {
      setShouldRenderPopover(true);
      const frameId = window.requestAnimationFrame(() => setIsPopoverVisible(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsPopoverVisible(false);
    if (!shouldRenderPopover) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setShouldRenderPopover(false), popoverExitAnimationMs);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, shouldRenderPopover]);

  useEffect(() => {
    const nextPlaybackRate = speedFromStatus(status);
    const nextMode = modeFromStatus(status);
    const pendingCommit = pendingCommitRef.current;

    if (pendingCommit) {
      if (speedsMatch(nextPlaybackRate, pendingCommit.playbackRate) && nextMode === pendingCommit.mode) {
        clearPendingCommit();
      } else {
        return;
      }
    }

    if (!isDraggingRef.current) {
      setPlaybackRate(nextPlaybackRate);
    }
    setMode(nextMode);
  }, [clearPendingCommit, status]);

  useEffect(() => {
    const getSettings = window.echo?.app?.getSettings;
    const audio = window.echo?.audio;

    if (typeof getSettings !== 'function' || !audio) {
      return;
    }

    let isCancelled = false;
    const requestRevision = interactionRevisionRef.current;
    void getSettings()
      .then(async (settings) => {
        if (isCancelled || requestRevision !== interactionRevisionRef.current || isDraggingRef.current || pendingCommitRef.current) {
          return;
        }

        const nextRate = clampPlaybackRate(settings.playbackSpeed);
        const nextMode = settings.playbackSpeedMode ?? 'nightcore';
        setPlaybackRate(nextRate);
        setMode(nextMode);
        const nextStatus = await audio.setOutput({ playbackRate: nextRate, playbackSpeedMode: nextMode });
        if (!isCancelled && requestRevision === interactionRevisionRef.current && !pendingCommitRef.current) {
          onStatusChange(nextStatus);
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [onStatusChange]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (isDraggingRef.current) {
        return;
      }

      const rects = [rootRef.current?.getBoundingClientRect(), popoverRef.current?.getBoundingClientRect()].filter(
        (rect): rect is DOMRect => Boolean(rect),
      );
      const nearestDistance = Math.min(...rects.map((rect) => distanceFromRect(event.clientX, event.clientY, rect)));

      if (nearestDistance > popoverCloseDistancePx) {
        onOpenChange(false);
      }
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      onOpenChange(false);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, onOpenChange]);

  const commitSpeed = useCallback(
    async (nextPlaybackRate: number): Promise<void> => {
      const audio = window.echo?.audio;
      const safeRate = clampPlaybackRate(nextPlaybackRate);
      markUserInteraction();
      setPlaybackRate(safeRate);
      holdPendingCommit({ playbackRate: safeRate, mode });

      if (!audio) {
        onError('Desktop bridge unavailable');
        return;
      }

      try {
        const nextStatus = await audio.setOutput({ playbackRate: safeRate, playbackSpeedMode: mode });
        const setSettings = window.echo?.app?.setSettings;
        if (typeof setSettings === 'function') {
          void setSettings({ playbackSpeed: safeRate }).catch(() => undefined);
        }
        const pending = pendingCommitRef.current;
        if (pending && speedsMatch(pending.playbackRate, safeRate) && pending.mode === mode) {
          onStatusChange(nextStatus);
        }
      } catch (error) {
        clearPendingCommit();
        onError(error instanceof Error ? error.message : String(error));
      }
    },
    [clearPendingCommit, holdPendingCommit, markUserInteraction, mode, onError, onStatusChange],
  );

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onOpenChange(true);
    const direction = event.deltaY > 0 ? -1 : 1;
    void commitSpeed(playbackRate + direction * 0.05);
  };

  return (
    <div className="speed-control" ref={rootRef} onMouseEnter={() => onOpenChange(true)} onWheel={handleWheel}>
      <button
        className="icon-button"
        type="button"
        aria-label={t('playerSpeed.label')}
        title={t('playerSpeed.label')}
        onClick={() => onOpenChange(true)}
        onFocus={() => onOpenChange(true)}
      >
        <Gauge size={17} />
      </button>
      {shouldRenderPopover ? (
        <div className="speed-popover" data-open={isPopoverVisible} ref={popoverRef}>
          <div className="speed-popover-header">
            <span>{formatSpeed(playbackRate)}</span>
            <button
              className="speed-reset-button"
              type="button"
              aria-label={t('playerSpeed.reset')}
              title={t('playerSpeed.reset')}
              disabled={playbackRate === 1}
              onClick={() => void commitSpeed(1)}
            >
              <RotateCcw size={12} />
            </button>
          </div>
          <input
            aria-label={t('playerSpeed.label')}
            max={2}
            min={0.5}
            onChange={(event) => {
              markUserInteraction();
              setPlaybackRate(Number(event.currentTarget.value));
            }}
            onPointerCancel={(event) => {
              isDraggingRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerDown={(event) => {
              markUserInteraction();
              isDraggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerLeave={(event) => {
              if (isDraggingRef.current && event.buttons === 0) {
                isDraggingRef.current = false;
                void commitSpeed(Number(event.currentTarget.value));
              }
            }}
            onKeyUp={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                void commitSpeed(Number(event.currentTarget.value));
              }
            }}
            onPointerUp={(event) => {
              isDraggingRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              void commitSpeed(Number(event.currentTarget.value));
            }}
            step={0.05}
            type="range"
            value={playbackRate}
          />
        </div>
      ) : null}
    </div>
  );
};
