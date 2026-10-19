import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { RouteArtworkResidency } from './RouteArtworkResidency';

export const retainedRouteResourceDelayMs = 18_000;
export const unfocusedRouteResourceDelayMs = 8_000;

/** Retain page state and DOM; park only reloadable artwork after the Steam grace. */
export const useRetainedRouteResources = (root: RefObject<HTMLElement | null>, isActive: boolean): boolean => {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus() && document.visibilityState !== 'hidden');
  const [isParked, setIsParked] = useState(false);
  const residency = useRef<RouteArtworkResidency | null>(null);

  useEffect(() => {
    const focus = (): void => setIsFocused(document.visibilityState !== 'hidden');
    const blur = (): void => setIsFocused(false);
    const visibility = (): void => setIsFocused(document.hasFocus() && document.visibilityState !== 'hidden');
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (isActive) {
      setIsParked(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setIsParked(true),
      isFocused ? retainedRouteResourceDelayMs : unfocusedRouteResourceDelayMs);
    return () => window.clearTimeout(timer);
  }, [isActive, isFocused]);

  useLayoutEffect(() => {
    if (!root.current) return undefined;
    const owner = new RouteArtworkResidency(root.current);
    residency.current = owner;
    return () => {
      owner.restore();
      residency.current = null;
    };
  }, [root]);

  // Restore in layout before a retained page becomes visible again.
  const resourcesActive = isActive || !isParked;
  useLayoutEffect(() => {
    if (resourcesActive) residency.current?.restore();
    else residency.current?.park();
  }, [resourcesActive]);

  return resourcesActive;
};
