import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, RefObject, SyntheticEvent } from 'react';
import { getPageScrollContainer } from './InfiniteScrollSentinel';

const wallImageIdleDelayMs = 180;
const maxConcurrentWallImages = 8;
const wallImageSlotLeaseMs = 1200;

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
    setCanLoad(priority);
  }, [priority, src]);

  useEffect(() => {
    if (priority || isInViewport) {
      return undefined;
    }

    const anchor = anchorRef.current;
    if (!anchor || typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          setIsInViewport(true);
          observer.disconnect();
        }
      },
      {
        root: getPageScrollContainer(anchor),
        rootMargin: '0px',
      },
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [isInViewport, priority]);

  useEffect(() => {
    if (priority || isNearViewport) {
      return undefined;
    }

    const anchor = anchorRef.current;
    if (!anchor || typeof window.IntersectionObserver !== 'function') {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      {
        root: getPageScrollContainer(anchor),
        rootMargin,
      },
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [isNearViewport, priority, rootMargin]);

  useEffect(() => {
    if (canLoad || !isNearViewport) {
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
  }, [canLoad, isInViewport, isNearViewport, paused, priority]);

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
    <span className="deferred-wall-image" data-ready={canLoad ? 'true' : 'false'} ref={anchorRef}>
      {canLoad ? <img {...imageProps} src={src} onError={handleError} onLoad={handleLoad} /> : null}
    </span>
  );
};
