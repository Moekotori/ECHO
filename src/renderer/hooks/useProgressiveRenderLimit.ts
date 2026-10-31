import { useEffect, useState } from 'react';

type ProgressiveRenderLimitOptions = {
  identityKey: string | null;
  itemCount: number;
  initialCount: number;
  step: number;
  delayMs: number;
};

type ProgressiveRenderLimitState = {
  identityKey: string | null;
  itemCount: number;
  limit: number;
};

export const useProgressiveRenderLimit = ({
  identityKey,
  itemCount,
  initialCount,
  step,
  delayMs,
}: ProgressiveRenderLimitOptions): number => {
  const normalizedCount = Math.max(0, itemCount);
  const firstPaintLimit = Math.min(normalizedCount, Math.max(0, initialCount));
  const [state, setState] = useState<ProgressiveRenderLimitState>(() => ({
    identityKey,
    itemCount: normalizedCount,
    limit: firstPaintLimit,
  }));
  const currentLimit = state.identityKey === identityKey && state.itemCount === normalizedCount
    ? state.limit
    : firstPaintLimit;

  useEffect(() => {
    setState({
      identityKey,
      itemCount: normalizedCount,
      limit: firstPaintLimit,
    });
  }, [firstPaintLimit, identityKey, normalizedCount]);

  useEffect(() => {
    if (currentLimit >= normalizedCount) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.identityKey !== identityKey || current.itemCount !== normalizedCount) {
          return current;
        }

        return {
          ...current,
          limit: Math.min(normalizedCount, current.limit + Math.max(1, step)),
        };
      });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [currentLimit, delayMs, identityKey, normalizedCount, step]);

  return Math.min(normalizedCount, Math.max(firstPaintLimit, currentLimit));
};
