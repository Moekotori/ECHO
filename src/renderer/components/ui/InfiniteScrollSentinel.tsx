import { useCallback, useEffect, useRef } from 'react';

type InfiniteScrollSentinelProps = {
  canLoadMore: boolean;
  isLoading?: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
  fallbackDistance?: number;
};

export const getPageScrollContainer = (element: Element | null): HTMLElement | null =>
  (element?.closest('.page-scroll-container') as HTMLElement | null) ??
  (element?.closest('.page-surface') as HTMLElement | null) ??
  null;

export const readPageScrollTop = (element: Element | null): number => getPageScrollContainer(element)?.scrollTop ?? 0;

export const writePageScrollTop = (element: Element | null, top: number): void => {
  const container = getPageScrollContainer(element);

  if (container) {
    container.scrollTop = top;
  }
};

export const InfiniteScrollSentinel = ({
  canLoadMore,
  isLoading = false,
  onLoadMore,
  rootMargin = '900px 0px',
  fallbackDistance = 900,
}: InfiniteScrollSentinelProps): JSX.Element => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    requestedRef.current = false;
  }, [canLoadMore, isLoading, onLoadMore]);

  const requestLoadMore = useCallback((): void => {
    if (!canLoadMore || isLoading || requestedRef.current) {
      return;
    }

    requestedRef.current = true;
    onLoadMore();
  }, [canLoadMore, isLoading, onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || !canLoadMore || isLoading || typeof window.IntersectionObserver !== 'function') {
      return undefined;
    }

    const root = getPageScrollContainer(sentinel);
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestLoadMore();
        }
      },
      { root, rootMargin },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, isLoading, requestLoadMore, rootMargin]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || !canLoadMore || isLoading) {
      return undefined;
    }

    const root = getPageScrollContainer(sentinel);

    if (!root) {
      return undefined;
    }

    let frameId: number | null = null;

    const checkReach = (): void => {
      frameId = null;
      const sentinelRect = sentinel.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const rootBottom = rootRect.height > 0 ? rootRect.bottom : root.clientHeight;

      if (rootBottom <= 0) {
        return;
      }

      if (sentinelRect.top === 0 && sentinelRect.bottom === 0 && sentinelRect.height === 0) {
        return;
      }

      if (sentinelRect.top <= rootBottom + fallbackDistance) {
        requestLoadMore();
      }
    };

    const scheduleReachCheck = (): void => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(checkReach);
    };

    scheduleReachCheck();
    root.addEventListener('scroll', scheduleReachCheck, { passive: true });
    window.addEventListener('resize', scheduleReachCheck);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      root.removeEventListener('scroll', scheduleReachCheck);
      window.removeEventListener('resize', scheduleReachCheck);
    };
  }, [canLoadMore, fallbackDistance, isLoading, requestLoadMore]);

  return <div className="infinite-scroll-sentinel" ref={sentinelRef} aria-hidden="true" />;
};
