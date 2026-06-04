import { useCallback, useEffect, useRef, useState } from 'react';
import type { WheelEvent } from 'react';
import { Lock, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { formatPercent } from './playerFormat';

type PlayerVolumeControlProps = {
  status: AudioStatus | null;
  onStatusChange: (status: AudioStatus) => void;
  onError: (message: string) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCommitVolume?: (volume: number) => Promise<void>;
  fixedVolumeEnabled?: boolean;
  fixedVolumeAutoReason?: string | null;
  onFixedVolumeChange?: (enabled: boolean) => void;
};

const volumeFromStatus = (status: AudioStatus | null): number => {
  return Math.max(0, Math.min(1, status?.volume ?? 1));
};

const popoverCloseDistancePx = 150;
const popoverExitAnimationMs = 180;

const distanceFromRect = (x: number, y: number, rect: DOMRect): number => {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
};

export const PlayerVolumeControl = ({
  status,
  onStatusChange,
  onError,
  isOpen,
  onOpenChange,
  onCommitVolume,
  fixedVolumeEnabled = false,
  fixedVolumeAutoReason = null,
  onFixedVolumeChange,
}: PlayerVolumeControlProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [volume, setVolume] = useState(volumeFromStatus(status));
  const [shouldRenderPopover, setShouldRenderPopover] = useState(isOpen);
  const [isPopoverVisible, setIsPopoverVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pendingCommitRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const fixedVolumeToggleDisabled = Boolean(fixedVolumeAutoReason);

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
    if (fixedVolumeEnabled) {
      setVolume(1);
      return;
    }

    if (isInteractingRef.current || pendingCommitRef.current !== null) {
      return;
    }

    setVolume(volumeFromStatus(status));
  }, [fixedVolumeEnabled, status]);

  useEffect(() => {
    const getSettings = window.echo?.app?.getSettings;
    const audio = window.echo?.audio;

    if (typeof getSettings !== 'function' || !audio) {
      return;
    }

    let isCancelled = false;
    void getSettings()
      .then(async (settings) => {
        if (isCancelled) {
          return;
        }

        const fixedVolume = settings.fixedVolumeEnabled === true;
        const safeVolume = fixedVolume ? 1 : Math.max(0, Math.min(1, settings.playerVolume));
        setVolume(safeVolume);
        const nextStatus = await audio.setOutput({ volume: safeVolume });
        if (!isCancelled) {
          onFixedVolumeChange?.(fixedVolume);
          onStatusChange(nextStatus);
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [onFixedVolumeChange, onStatusChange]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (isInteractingRef.current) {
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

  const commitVolume = useCallback(
    async (nextVolume: number): Promise<void> => {
      if (fixedVolumeEnabled) {
        setVolume(1);
        return;
      }

      const audio = window.echo?.audio;
      const safeVolume = Math.max(0, Math.min(1, nextVolume));
      setVolume(safeVolume);
      pendingCommitRef.current = safeVolume;

      if (onCommitVolume) {
        try {
          await onCommitVolume(safeVolume);
          const setSettings = window.echo?.app?.setSettings;
          if (typeof setSettings === 'function') {
            void setSettings({ playerVolume: safeVolume }).catch(() => undefined);
          }
          if (pendingCommitRef.current === safeVolume) {
            pendingCommitRef.current = null;
          }
        } catch (error) {
          if (pendingCommitRef.current === safeVolume) {
            pendingCommitRef.current = null;
          }
          onError(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      if (!audio) {
        onError('Desktop bridge unavailable');
        return;
      }

      try {
        const nextStatus = await audio.setOutput({ volume: safeVolume });
        const setSettings = window.echo?.app?.setSettings;
        if (typeof setSettings === 'function') {
          void setSettings({ playerVolume: safeVolume }).catch(() => undefined);
        }
        if (pendingCommitRef.current === safeVolume) {
          pendingCommitRef.current = null;
          onStatusChange(nextStatus);
        }
      } catch (error) {
        if (pendingCommitRef.current === safeVolume) {
          pendingCommitRef.current = null;
        }
        onError(error instanceof Error ? error.message : String(error));
      }
    },
    [fixedVolumeEnabled, onCommitVolume, onError, onStatusChange],
  );

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    onOpenChange(true);
    if (fixedVolumeEnabled) {
      return;
    }
    const direction = event.deltaY > 0 ? -1 : 1;
    void commitVolume(volume + direction * 0.03);
  };

  const finishInteraction = (nextVolume: number): void => {
    isInteractingRef.current = false;
    if (fixedVolumeEnabled) {
      setVolume(1);
      return;
    }
    void commitVolume(nextVolume);
  };

  const toggleFixedVolume = async (): Promise<void> => {
    const nextFixedVolumeEnabled = !fixedVolumeEnabled;
    const setSettings = window.echo?.app?.setSettings;
    const audio = window.echo?.audio;

    onFixedVolumeChange?.(nextFixedVolumeEnabled);
    if (nextFixedVolumeEnabled) {
      setVolume(1);
    }

    try {
      const nextSettings = await setSettings?.({
        fixedVolumeEnabled: nextFixedVolumeEnabled,
        ...(nextFixedVolumeEnabled ? { playerVolume: 1 } : {}),
      });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings ?? { fixedVolumeEnabled: nextFixedVolumeEnabled } }));
      if (nextFixedVolumeEnabled && audio) {
        const nextStatus = await audio.setOutput({ volume: 1 });
        onStatusChange(nextStatus);
      }
    } catch (error) {
      onFixedVolumeChange?.(!nextFixedVolumeEnabled);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="volume-control" ref={rootRef} onMouseEnter={() => onOpenChange(true)} onWheel={handleWheel}>
      <button
        className="icon-button"
        type="button"
        aria-label="Volume"
        title="Volume"
        onClick={() => onOpenChange(true)}
        onFocus={() => onOpenChange(true)}
      >
        <Icon size={18} />
      </button>
      {shouldRenderPopover ? (
        <div className="volume-popover" data-open={isPopoverVisible} ref={popoverRef}>
          <span>{formatPercent(volume)}</span>
          <input
            aria-label="Volume level"
            disabled={fixedVolumeEnabled}
            max={1}
            min={0}
            onChange={(event) => setVolume(Number(event.currentTarget.value))}
            onBlur={(event) => {
              if (isInteractingRef.current) {
                finishInteraction(Number(event.currentTarget.value));
              }
            }}
            onKeyUp={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                void commitVolume(Number(event.currentTarget.value));
              }
            }}
            onPointerCancel={(event) => finishInteraction(Number(event.currentTarget.value))}
            onPointerDown={() => {
              isInteractingRef.current = true;
            }}
            onPointerUp={(event) => finishInteraction(Number(event.currentTarget.value))}
            step={0.01}
            type="range"
            value={volume}
          />
          <button
            className={`volume-fixed-button ${fixedVolumeEnabled ? 'volume-fixed-button--active' : ''}`}
            type="button"
            disabled={fixedVolumeToggleDisabled}
            aria-pressed={fixedVolumeEnabled}
            aria-label={fixedVolumeAutoReason ?? (fixedVolumeEnabled ? t('playerVolume.fixed.disable') : t('playerVolume.fixed.enable'))}
            title={fixedVolumeAutoReason ?? (fixedVolumeEnabled ? t('playerVolume.fixed.enabled') : t('playerVolume.fixed.title'))}
            onClick={() => void toggleFixedVolume()}
          >
            <Lock size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
