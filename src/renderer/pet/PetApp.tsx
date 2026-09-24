import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import type { PetBounds } from '../../shared/types/pet';
import { translateFallback, useOptionalI18n } from '../i18n/I18nProvider';

const petArtworkUrl = new URL('../assets/echo-pet.gif', import.meta.url).href;
const petIdleArtworkUrl = new URL('../assets/echo-pet-idle.png', import.meta.url).href;
const petPartsArtworkUrl = new URL('../assets/echo-pet-parts.png', import.meta.url).href;
const petAnimationDurationMs = 3_600;
const petDragThresholdPx = 4;

type PetDragGesture = {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  moved: boolean;
};

export const PetApp = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [pendingAction, setPendingAction] = useState<'previous' | 'next' | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationTimerRef = useRef<number | null>(null);
  const dragGestureRef = useRef<PetDragGesture | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<Pick<PetBounds, 'x' | 'y'> | null>(null);
  const petBoundsRef = useRef<PetBounds | null>(null);
  const suppressCharacterClickRef = useRef(false);

  const triggerAnimation = useCallback((): void => {
    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }
    setIsAnimating(true);
    animationTimerRef.current = window.setTimeout(() => {
      animationTimerRef.current = null;
      setIsAnimating(false);
    }, petAnimationDurationMs);
  }, []);

  useEffect(() => () => {
    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const stopHiddenAnimation = (): void => {
      if (document.visibilityState !== 'hidden') {
        return;
      }
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
      setIsAnimating(false);
    };

    document.addEventListener('visibilitychange', stopHiddenAnimation);
    return () => document.removeEventListener('visibilitychange', stopHiddenAnimation);
  }, []);

  useEffect(() => {
    const pet = window.echo?.pet;
    if (!pet) {
      return;
    }

    let active = true;
    void pet.getState().then((state) => {
      if (active) {
        petBoundsRef.current = state.bounds;
      }
    }).catch(() => undefined);
    const dispose = pet.onStateChanged((state) => {
      petBoundsRef.current = state.bounds;
    });
    return () => {
      active = false;
      dispose();
    };
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
    }
  }, []);

  const flushPetDrag = useCallback((): void => {
    dragFrameRef.current = null;
    const position = pendingDragPositionRef.current;
    pendingDragPositionRef.current = null;
    if (position) {
      void window.echo?.pet?.moveTo(position);
    }
  }, []);

  const schedulePetDrag = useCallback((position: Pick<PetBounds, 'x' | 'y'>): void => {
    pendingDragPositionRef.current = position;
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(flushPetDrag);
    }
  }, [flushPetDrag]);

  const handleCharacterPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || !petBoundsRef.current) {
      return;
    }
    const bounds = petBoundsRef.current;
    dragGestureRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startWindowX: bounds.x,
      startWindowY: bounds.y,
      moved: false,
    };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, []);

  const handleCharacterPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.screenX - gesture.startScreenX;
    const deltaY = event.screenY - gesture.startScreenY;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) < petDragThresholdPx) {
      return;
    }
    gesture.moved = true;
    schedulePetDrag({ x: gesture.startWindowX + deltaX, y: gesture.startWindowY + deltaY });
  }, [schedulePetDrag]);

  const finishCharacterDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    dragGestureRef.current = null;
    suppressCharacterClickRef.current = gesture.moved;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      flushPetDrag();
    }
    if (typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [flushPetDrag]);

  const handleCharacterClick = useCallback((): void => {
    if (suppressCharacterClickRef.current) {
      suppressCharacterClickRef.current = false;
      return;
    }
    triggerAnimation();
  }, [triggerAnimation]);

  const changeTrack = useCallback(async (type: 'previous' | 'next'): Promise<void> => {
    const controlMainWindow = window.echo?.playback?.controlMainWindow;
    if (!controlMainWindow || pendingAction !== null) {
      return;
    }

    setPendingAction(type);
    setTransportError(null);
    triggerAnimation();
    try {
      await controlMainWindow({ type });
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, triggerAnimation]);

  return (
    <main className="echo-pet-app" aria-label={t('pet.aria.window')}>
      <div className="echo-pet-stage">
        <img
          alt={t('pet.aria.character')}
          className="echo-pet-character"
          draggable={false}
          src={isAnimating ? petArtworkUrl : petIdleArtworkUrl}
        />
        <button
          aria-label={t('pet.aria.character')}
          className="echo-pet-character-trigger"
          title={t('pet.aria.character')}
          type="button"
          onClick={handleCharacterClick}
          onPointerCancel={finishCharacterDrag}
          onPointerDown={handleCharacterPointerDown}
          onPointerMove={handleCharacterPointerMove}
          onPointerUp={finishCharacterDrag}
        />
        <div className="echo-pet-track-controls">
          <button
            aria-label={t('miniPlayer.action.previous')}
            className="echo-pet-track-control echo-pet-track-control--previous"
            disabled={pendingAction !== null}
            title={transportError ?? t('miniPlayer.action.previous')}
            type="button"
            onClick={() => void changeTrack('previous')}
          >
            <span className="echo-pet-part echo-pet-part--previous" aria-hidden="true">
              <img alt="" draggable={false} src={petPartsArtworkUrl} />
            </span>
            <SkipBack className="echo-pet-track-icon" size={15} strokeWidth={2.8} aria-hidden="true" />
          </button>
          <button
            aria-label={t('miniPlayer.action.next')}
            className="echo-pet-track-control echo-pet-track-control--next"
            disabled={pendingAction !== null}
            title={transportError ?? t('miniPlayer.action.next')}
            type="button"
            onClick={() => void changeTrack('next')}
          >
            <span className="echo-pet-part echo-pet-part--next" aria-hidden="true">
              <img alt="" draggable={false} src={petPartsArtworkUrl} />
            </span>
            <SkipForward className="echo-pet-track-icon" size={15} strokeWidth={2.8} aria-hidden="true" />
          </button>
        </div>
        {transportError ? <span className="echo-pet-status" role="status">{transportError}</span> : null}
        <div className="echo-pet-controls">
          <button
            aria-label={t('pet.action.resetPosition')}
            className="echo-pet-control"
            title={t('pet.action.resetPosition')}
            type="button"
            onClick={() => void window.echo?.pet?.resetBounds?.()}
          >
            <RotateCcw size={13} strokeWidth={2.4} />
          </button>
          <button
            aria-label={t('pet.action.hide')}
            className="echo-pet-control"
            title={t('pet.action.hide')}
            type="button"
            onClick={() => void window.echo?.pet?.hide?.()}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </main>
  );
};
