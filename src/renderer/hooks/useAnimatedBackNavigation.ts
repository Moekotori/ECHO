import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const backAnimationMs = 180;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
};

type AnimatedBackNavigationOptions = {
  rootRef?: RefObject<HTMLElement | null>;
};

const isVisibleRouteSurface = (element: HTMLElement | null | undefined): boolean => {
  if (!element) {
    return true;
  }

  return !element.closest('[hidden], [aria-hidden="true"]');
};

export const useAnimatedBackNavigation = (
  onBack: () => void,
  enabled = true,
  options: AnimatedBackNavigationOptions = {},
) => {
  const [isReturning, setIsReturning] = useState(false);
  const onBackRef = useRef(onBack);
  const timeoutRef = useRef<number | null>(null);
  const rootRef = options.rootRef;

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled) {
      setIsReturning(false);
    }
  }, [enabled]);

  const returnBack = useCallback((): void => {
    if (!enabled) {
      return;
    }

    setIsReturning((current) => {
      if (current) {
        return current;
      }

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        onBackRef.current();
      }, backAnimationMs);

      return true;
    });
  }, [enabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!enabled || !isVisibleRouteSurface(rootRef?.current)) {
        return;
      }

      if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      returnBack();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, returnBack, rootRef]);

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
