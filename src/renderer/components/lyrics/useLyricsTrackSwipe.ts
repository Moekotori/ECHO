import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export type LyricsTrackSwipeDirection = 'previous' | 'next';

const lyricsTrackSwipeAxisLockPx = 20;
const lyricsTrackSwipeMinTriggerPx = 144;
const lyricsTrackSwipeMaxTriggerPx = 220;
const lyricsTrackSwipeSurfaceRatio = 0.18;
const lyricsTrackSwipeHorizontalDominance = 1.75;
const lyricsTrackSwipeMaxVerticalDriftPx = 64;
const lyricsTrackSwipeVisualLimitPx = 168;
const lyricsTrackSwipeCommitOffsetPx = 224;
const lyricsTrackSwipeSettleMs = 180;
const playerTrackSwipeCommitPx = 72;
const playerTrackSwipeAxisLockPx = 10;
const playerTrackSwipeDominance = 1.25;
const playerTrackSwipeMaxPreviewPx = 34;
const lyricsTrackSwipeLineHitTargetSelector = "[data-lyrics-line-hit-target='true']";
const lyricsTrackSwipeIgnoredTargetSelector = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  "[contenteditable]",
  "[role='button']",
  "[role='slider']",
  "[role='switch']",
  '.lyrics-mv-background',
  "[data-lyrics-track-swipe-ignore='true']",
].join(', ');

export const playerBarTrackSwipeIgnoredTargetSelector = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  "[role='button']",
  "[contenteditable='true']",
  '.progress-row',
  '.volume-popover',
  '.speed-popover',
  '.player-slider',
].join(', ');

type ActiveLyricsTrackSwipe = {
  pointerId: number;
  startX: number;
  startY: number;
  triggerPx: number;
  horizontalLocked: boolean;
};

type TrackSwipeProfile = 'lyrics' | 'player';

const clearLyricsTrackSwipeVisual = (surface: HTMLElement): void => {
  delete surface.dataset.lyricsTrackSwipeDirection;
  delete surface.dataset.lyricsTrackSwipePhase;
  delete surface.dataset.mouseSwipe;
  surface.style.removeProperty('--lyrics-track-swipe-offset');
  surface.style.removeProperty('--lyrics-track-swipe-progress');
  surface.style.removeProperty('--player-mouse-swipe-offset');
};

const updateLyricsTrackSwipeVisual = (
  surface: HTMLElement,
  direction: LyricsTrackSwipeDirection,
  offsetPx: number,
  progress: number,
  phase: 'dragging' | 'ready' | 'committed' | 'cancelled',
  profile: TrackSwipeProfile,
): void => {
  if (profile === 'player') {
    surface.dataset.mouseSwipe = direction;
    const preview = Math.max(-playerTrackSwipeMaxPreviewPx, Math.min(playerTrackSwipeMaxPreviewPx, offsetPx * 0.18));
    surface.style.setProperty('--player-mouse-swipe-offset', `${preview.toFixed(1)}px`);
    return;
  }

  surface.dataset.lyricsTrackSwipeDirection = direction;
  surface.dataset.lyricsTrackSwipePhase = phase;
  surface.style.setProperty('--lyrics-track-swipe-offset', `${offsetPx.toFixed(1)}px`);
  surface.style.setProperty('--lyrics-track-swipe-progress', progress.toFixed(3));
};

export const shouldIgnoreLyricsTrackSwipeTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest('.lyrics-line')) {
    return Boolean(target.closest(lyricsTrackSwipeLineHitTargetSelector));
  }

  return Boolean(target.closest(lyricsTrackSwipeIgnoredTargetSelector));
};

export const shouldIgnorePlayerBarTrackSwipeTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(playerBarTrackSwipeIgnoredTargetSelector));

export const getLyricsTrackSwipeTriggerPx = (surfaceWidth: number): number => {
  if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) {
    return lyricsTrackSwipeMinTriggerPx;
  }

  return Math.round(Math.max(
    lyricsTrackSwipeMinTriggerPx,
    Math.min(lyricsTrackSwipeMaxTriggerPx, surfaceWidth * lyricsTrackSwipeSurfaceRatio),
  ));
};

export const resolveLyricsTrackSwipeDirection = (
  deltaX: number,
  deltaY: number,
  triggerPx = lyricsTrackSwipeMinTriggerPx,
): LyricsTrackSwipeDirection | null => {
  if (
    Math.abs(deltaX) < triggerPx
    || Math.abs(deltaY) > lyricsTrackSwipeMaxVerticalDriftPx
    || Math.abs(deltaX) < Math.abs(deltaY) * lyricsTrackSwipeHorizontalDominance
  ) {
    return null;
  }

  return deltaX < 0 ? 'next' : 'previous';
};

const resolvePlayerTrackSwipeDirection = (deltaX: number, deltaY: number): LyricsTrackSwipeDirection | null => {
  if (Math.abs(deltaX) < playerTrackSwipeCommitPx || Math.abs(deltaX) <= Math.abs(deltaY) * playerTrackSwipeDominance) {
    return null;
  }
  return deltaX < 0 ? 'next' : 'previous';
};

const useTrackSwipe = (
  onSwipe: (direction: LyricsTrackSwipeDirection) => void,
  enabled: boolean,
  profile: TrackSwipeProfile,
): {
  handlers: {
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUpCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancelCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
} => {
  const activeSwipeRef = useRef<ActiveLyricsTrackSwipe | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const visualSettleTimerRef = useRef<number | null>(null);
  const visualSurfaceRef = useRef<HTMLElement | null>(null);
  const shouldIgnore = profile === 'player' ? shouldIgnorePlayerBarTrackSwipeTarget : shouldIgnoreLyricsTrackSwipeTarget;

  const clearSuppressClickTimer = useCallback((): void => {
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
  }, []);

  const clearVisualSettleTimer = useCallback((): void => {
    if (visualSettleTimerRef.current !== null) {
      window.clearTimeout(visualSettleTimerRef.current);
      visualSettleTimerRef.current = null;
    }
  }, []);

  const resetSwipeVisual = useCallback((): void => {
    clearVisualSettleTimer();
    if (visualSurfaceRef.current) {
      clearLyricsTrackSwipeVisual(visualSurfaceRef.current);
      visualSurfaceRef.current = null;
    }
  }, [clearVisualSettleTimer]);

  useEffect(() => () => {
    clearSuppressClickTimer();
    resetSwipeVisual();
  }, [clearSuppressClickTimer, resetSwipeVisual]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    const activeSwipe = activeSwipeRef.current;
    const activeSurface = visualSurfaceRef.current;
    if (activeSwipe && activeSurface) {
      try {
        if (activeSurface.hasPointerCapture(activeSwipe.pointerId)) {
          activeSurface.releasePointerCapture(activeSwipe.pointerId);
        }
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
    }
    activeSwipeRef.current = null;
    suppressClickRef.current = false;
    clearSuppressClickTimer();
    resetSwipeVisual();
  }, [clearSuppressClickTimer, enabled, resetSwipeVisual]);

  const finishSwipe = useCallback((event: ReactPointerEvent<HTMLElement>, shouldCommit: boolean): void => {
    const activeSwipe = activeSwipeRef.current;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) {
      return;
    }
    const surface = event.currentTarget;
    if (!enabled) {
      activeSwipeRef.current = null;
      try {
        if (surface.hasPointerCapture(event.pointerId)) {
          surface.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
      resetSwipeVisual();
      return;
    }

    const deltaX = event.clientX - activeSwipe.startX;
    const deltaY = event.clientY - activeSwipe.startY;
    const resolvedDirection = shouldCommit && activeSwipe.horizontalLocked
      ? (profile === 'player'
        ? resolvePlayerTrackSwipeDirection(deltaX, deltaY)
        : resolveLyricsTrackSwipeDirection(deltaX, deltaY, activeSwipe.triggerPx))
      : null;

    if (activeSwipe.horizontalLocked) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = true;
      clearSuppressClickTimer();
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressClickTimerRef.current = null;
      }, 0);
    }

    activeSwipeRef.current = null;
    try {
      if (surface.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture is unavailable in some test environments.
    }

    if (activeSwipe.horizontalLocked && profile === 'lyrics') {
      const fallbackDirection: LyricsTrackSwipeDirection = deltaX < 0 ? 'next' : 'previous';
      const visualDirection = resolvedDirection ?? fallbackDirection;
      const settleOffset = resolvedDirection
        ? (visualDirection === 'next' ? -lyricsTrackSwipeCommitOffsetPx : lyricsTrackSwipeCommitOffsetPx)
        : 0;
      updateLyricsTrackSwipeVisual(surface, visualDirection, settleOffset, resolvedDirection ? 1 : 0, resolvedDirection ? 'committed' : 'cancelled', profile);
      visualSurfaceRef.current = surface;
      clearVisualSettleTimer();
      visualSettleTimerRef.current = window.setTimeout(() => {
        clearLyricsTrackSwipeVisual(surface);
        if (visualSurfaceRef.current === surface) {
          visualSurfaceRef.current = null;
        }
        visualSettleTimerRef.current = null;
      }, lyricsTrackSwipeSettleMs);
    } else if (profile === 'player') {
      clearLyricsTrackSwipeVisual(surface);
    }

    if (resolvedDirection) {
      onSwipe(resolvedDirection);
    }
  }, [clearSuppressClickTimer, clearVisualSettleTimer, enabled, onSwipe, profile, resetSwipeVisual]);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (
      !enabled
      || event.button !== 0
      || event.pointerType !== 'mouse'
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || shouldIgnore(event.target)
    ) {
      return;
    }

    resetSwipeVisual();
    activeSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      triggerPx: profile === 'player' ? playerTrackSwipeCommitPx : getLyricsTrackSwipeTriggerPx(event.currentTarget.getBoundingClientRect().width),
      horizontalLocked: false,
    };
  }, [enabled, profile, resetSwipeVisual, shouldIgnore]);

  const onPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const activeSwipe = activeSwipeRef.current;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) {
      return;
    }
    if (!enabled) {
      activeSwipeRef.current = null;
      resetSwipeVisual();
      return;
    }

    const deltaX = event.clientX - activeSwipe.startX;
    const deltaY = event.clientY - activeSwipe.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const axisLockPx = profile === 'player' ? playerTrackSwipeAxisLockPx : lyricsTrackSwipeAxisLockPx;
    const dominance = profile === 'player' ? playerTrackSwipeDominance : lyricsTrackSwipeHorizontalDominance;

    if (!activeSwipe.horizontalLocked) {
      if (absY >= axisLockPx && absY > absX) {
        activeSwipeRef.current = null;
        return;
      }
      if (absX < axisLockPx || absX < absY * dominance) {
        return;
      }
      activeSwipe.horizontalLocked = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
    }

    event.preventDefault();
    event.stopPropagation();
    const direction: LyricsTrackSwipeDirection = deltaX < 0 ? 'next' : 'previous';
    const visualOffset = profile === 'player'
      ? deltaX
      : Math.max(-lyricsTrackSwipeVisualLimitPx, Math.min(lyricsTrackSwipeVisualLimitPx, deltaX));
    const progress = Math.min(1, absX / activeSwipe.triggerPx);
    const readyDirection = profile === 'player'
      ? resolvePlayerTrackSwipeDirection(deltaX, deltaY)
      : resolveLyricsTrackSwipeDirection(deltaX, deltaY, activeSwipe.triggerPx);
    visualSurfaceRef.current = event.currentTarget;
    updateLyricsTrackSwipeVisual(
      event.currentTarget,
      direction,
      visualOffset,
      progress,
      readyDirection ? 'ready' : 'dragging',
      profile,
    );
  }, [enabled, profile, resetSwipeVisual]);

  const onPointerUpCapture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    finishSwipe(event, true);
  }, [finishSwipe]);

  const onPointerCancelCapture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    finishSwipe(event, false);
  }, [finishSwipe]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    if (!suppressClickRef.current) {
      return;
    }
    suppressClickRef.current = false;
    clearSuppressClickTimer();
    event.preventDefault();
    event.stopPropagation();
  }, [clearSuppressClickTimer]);

  return {
    handlers: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
      onClickCapture,
    },
  };
};

export const useLyricsTrackSwipe = (
  onSwipe: (direction: LyricsTrackSwipeDirection) => void,
  enabled = true,
): ReturnType<typeof useTrackSwipe> => useTrackSwipe(onSwipe, enabled, 'lyrics');

export const usePlayerBarTrackSwipe = (
  onSwipe: (direction: LyricsTrackSwipeDirection) => void,
  enabled = true,
): ReturnType<typeof useTrackSwipe> => useTrackSwipe(onSwipe, enabled, 'player');
