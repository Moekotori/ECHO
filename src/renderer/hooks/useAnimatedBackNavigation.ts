import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const defaultBackAnimationMs = 180;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
};

type AnimatedBackNavigationOptions = {
  durationMs?: number;
  rootRef?: RefObject<HTMLElement | null>;
  onEscapeBack?: () => void;
};

const isVisibleRouteSurface = (
  element: HTMLElement | null | undefined,
  isRootScoped: boolean,
): boolean => {
  if (!element) {
    return !isRootScoped;
  }

  return !element.closest('[hidden], [aria-hidden="true"]');
};

export const useAnimatedBackNavigation = (
  onBack: () => void,
  enabled = true,
  options: AnimatedBackNavigationOptions = {},
) => {
  const [isReturning, setIsReturning] = useState(false);
  const onBackRef = useRef({ onBack, onEscapeBack: options.onEscapeBack });
  const timeoutRef = useRef<number | null>(null);
  const durationMs = options.durationMs ?? defaultBackAnimationMs;
  const rootRef = options.rootRef;

  useEffect(() => {
    onBackRef.current = { onBack, onEscapeBack: options.onEscapeBack };
  }, [onBack, options.onEscapeBack]);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsReturning(false);
    }
  }, [enabled]);

  const animateBack = useCallback((source: 'back' | 'escape'): void => {
    if (!enabled) {
      return;
    }

    const completeBack = (): void => {
      const { onBack, onEscapeBack } = onBackRef.current;
      (source === 'escape' ? onEscapeBack ?? onBack : onBack)();
    };

    if (durationMs <= 0) {
      completeBack();
      return;
    }

    setIsReturning((current) => {
      if (current) {
        return current;
      }

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        completeBack();
      }, durationMs);

      return true;
    });
  }, [durationMs, enabled]);

  const returnBack = useCallback(() => animateBack('back'), [animateBack]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!enabled || !isVisibleRouteSurface(rootRef?.current, Boolean(rootRef))) {
        return;
      }

      if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      animateBack('escape');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [animateBack, enabled, rootRef]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  return { isReturning, returnBack };
};
