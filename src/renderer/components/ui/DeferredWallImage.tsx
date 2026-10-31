import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, RefObject, SyntheticEvent } from 'react';
import { useRouteActivity, useRouteResourcesActive } from './RouteActivityContext';
import { getPageScrollContainer } from './InfiniteScrollSentinel';
import { observeWallImageResidency } from './wallImageResidency';
import { observeWallImageVisibility } from './wallImageVisibility';

const wallImageIdleDelayMs = 180;
const maxConcurrentWallImages = 8;
const wallImageSlotLeaseMs = 1200;

const wallImageReleaseMarginExtraPx = 400;

const expandMarginToken = (token: string, extraPx: number): string => {
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(token);
  if (!match) {
    return token;
  }

  return `${Math.max(0, Number(match[1]) + extraPx)}px`;
};

export const expandWallImageRootMargin = (
  rootMargin: string,
  extraPx = wallImageReleaseMarginExtraPx,
): string => {
  const parts = rootMargin.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return `${Math.max(0, extraPx)}px 0px`;
  }

  if (parts.length === 1) {
    return expandMarginToken(parts[0], extraPx);
  }

  if (parts.length === 2) {
    return `${expandMarginToken(parts[0], extraPx)} ${parts[1]}`;
  }

  if (parts.length === 3) {
    return `${expandMarginToken(parts[0], extraPx)} ${parts[1]} ${expandMarginToken(parts[2], extraPx)}`;
  }

  return `${expandMarginToken(parts[0], extraPx)} ${parts[1]} ${expandMarginToken(parts[2], extraPx)} ${parts[3]}`;
};

let activeWallImageLoads = 0;
const wallImageQueue: Array<() => void> = [];

const drainWallImageQueue = (): void => {
  while (activeWallImageLoads < maxConcurrentWallImages && wallImageQueue.length > 0) {
    wallImageQueue.shift()?.();
  }
};

const requestWallImageSlot = (onGrant: (release: () => void) => void): (() => void) => {
  let queued = true;
  let granted = false;
  let released = false;
  let leaseTimer: number | null = null;

  const release = (): void => {
    if (released) {
      return;
    }

    released = true;
    if (leaseTimer !== null) {
      window.clearTimeout(leaseTimer);
      leaseTimer = null;
    }
    activeWallImageLoads = Math.max(0, activeWallImageLoads - 1);
    drainWallImageQueue();
  };

  const grant = (): void => {
    if (!queued || granted) {
      return;
    }

    queued = false;
    granted = true;
    activeWallImageLoads += 1;
    leaseTimer = window.setTimeout(release, wallImageSlotLeaseMs);
    onGrant(release);
  };

  if (activeWallImageLoads < maxConcurrentWallImages) {
    grant();
  } else {
    wallImageQueue.push(grant);
  }

  return () => {
    if (queued) {
      queued = false;
      const queueIndex = wallImageQueue.indexOf(grant);
      if (queueIndex >= 0) {
        wallImageQueue.splice(queueIndex, 1);
      }
      return;
    }

    if (granted) {
      release();
    }
  };
};

export const useScrollImagePause = (scrollRef: RefObject<HTMLElement | null>, idleDelayMs = wallImageIdleDelayMs): boolean => {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return undefined;
    }

    let idleTimer: number | null = null;

    const markScrolling = (): void => {
      setPaused(true);
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        setPaused(false);
      }, idleDelayMs);
    };

    scrollElement.addEventListener('scroll', markScrolling, { passive: true });
    return () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
      }
      scrollElement.removeEventListener('scroll', markScrolling);
    };
  }, [idleDelayMs, scrollRef]);

  return paused;
};

type DeferredWallImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  paused?: boolean;
  priority?: boolean;
  rootMargin?: string;
  src: string;
};

export const DeferredWallImage = ({
  onError,
  onLoad,
  paused = false,
  priority = false,
  rootMargin = '720px 0px',
  src,
  ...imageProps
}: DeferredWallImageProps): JSX.Element => {
  const isRouteActive = useRouteActivity();
  const resourcesActive = useRouteResourcesActive();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const cancelSlotRef = useRef<(() => void) | null>(null);
  const releaseSlotRef = useRef<(() => void) | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(priority);
  const [isInViewport, setIsInViewport] = useState(priority);
  const [canLoad, setCanLoad] = useState(priority);

  useEffect(() => {
    cancelSlotRef.current?.();
    cancelSlotRef.current = null;
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
    setIsNearViewport(priority);
    setIsInViewport(priority);
    setCanLoad(resourcesActive && priority);
  }, [priority, resourcesActive, src]);

  useEffect(() => {
    if (!isRouteActive || !resourcesActive || priority) return undefined;
    const anchor = anchorRef.current;
    if (!anchor || typeof window.IntersectionObserver !== 'function') return undefined;

    // Keep tracking visibility so a released image can load immediately on return.
    return observeWallImageVisibility(anchor, getPageScrollContainer(anchor), '0px', (entry) => {
      setIsInViewport(entry.isIntersecting);
      if (entry.isIntersecting) setIsNearViewport(true);
    });
  }, [isRouteActive, priority, resourcesActive, src]);

  useEffect(() => {
    if (!isRouteActive || !resourcesActive || priority || isNearViewport) return undefined;
    const anchor = anchorRef.current;
    if (!anchor || typeof window.IntersectionObserver !== 'function') {
      setIsNearViewport(true);
      return undefined;
    }

    let stop = (): void => undefined;
    stop = observeWallImageVisibility(anchor, getPageScrollContainer(anchor), rootMargin, (entry) => {
      if (entry.isIntersecting) {
        setIsNearViewport(true);
        stop();
      }
    });
    return stop;
  }, [isNearViewport, isRouteActive, priority, resourcesActive, rootMargin, src]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!isRouteActive || !resourcesActive || priority || !canLoad || !anchor) return undefined;

    // A wider residency band and grace period avoid churn on short reverse scrolls.
    return observeWallImageResidency(anchor, getPageScrollContainer(anchor), expandWallImageRootMargin(rootMargin), () => {
      cancelSlotRef.current?.();
      cancelSlotRef.current = null;
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
      setIsNearViewport(false);
      setIsInViewport(false);
      setCanLoad(false);
    });
  }, [canLoad, isRouteActive, priority, resourcesActive, rootMargin, src]);

  useEffect(() => {
    if (!isRouteActive || !resourcesActive || canLoad || !isNearViewport) {
      return undefined;
    }

    if (priority || isInViewport) {
      setCanLoad(true);
      return undefined;
    }

    if (paused) {
      return undefined;
    }

    let granted = false;
    const cancelSlot = requestWallImageSlot((release) => {
      granted = true;
      cancelSlotRef.current = null;
      releaseSlotRef.current = release;
      setCanLoad(true);
    });
    cancelSlotRef.current = granted ? null : cancelSlot;

    return () => {
      if (!granted) {
        cancelSlot();
      }
      if (cancelSlotRef.current === cancelSlot) {
        cancelSlotRef.current = null;
      }
    };
  }, [canLoad, isInViewport, isNearViewport, isRouteActive, paused, priority, resourcesActive]);

  useEffect(() => {
    return () => {
      cancelSlotRef.current?.();
      cancelSlotRef.current = null;
      releaseSlotRef.current?.();
      releaseSlotRef.current = null;
    };
  }, []);

  const releaseLoadSlot = (): void => {
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  };

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    releaseLoadSlot();
    onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>): void => {
    releaseLoadSlot();
    onError?.(event);
  };

  return (
    <span className="deferred-wall-image" data-ready={resourcesActive && (canLoad || priority) ? 'true' : 'false'} ref={anchorRef}>
      {resourcesActive && (canLoad || priority) ? <img {...imageProps} src={src} onError={handleError} onLoad={handleLoad} /> : null}
    </span>
  );
};
