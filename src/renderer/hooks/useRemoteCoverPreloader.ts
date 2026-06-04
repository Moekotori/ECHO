import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteCoverLoadPerformanceMode, AppSettings } from '../../shared/types/appSettings';
import type { LibraryTrack } from '../../shared/types/library';
import { getAppBridge } from '../utils/echoBridge';

type RemoteCoverLoadPlan = {
  leadRows: number;
  maxPreloadUrls: number;
  maxHydrateTracks: number;
  concurrency: number;
  delayMs: number;
};

type RemoteCoverPreloaderOptions = {
  active: boolean;
  tracks: LibraryTrack[];
  visibleTrackIds: string[];
  hydrateMissingCovers?: (trackIds: string[]) => void;
};

const defaultRemoteCoverLoadPerformanceMode: RemoteCoverLoadPerformanceMode = 'balanced';
const maxRememberedPreloadedUrls = 2400;
const preloadedRemoteCoverUrls = new Set<string>();

export const remoteCoverLoadPlans: Record<RemoteCoverLoadPerformanceMode, RemoteCoverLoadPlan> = {
  low: {
    leadRows: 0,
    maxPreloadUrls: 12,
    maxHydrateTracks: 8,
    concurrency: 1,
    delayMs: 240,
  },
  balanced: {
    leadRows: 72,
    maxPreloadUrls: 80,
    maxHydrateTracks: 32,
    concurrency: 3,
    delayMs: 80,
  },
  aggressive: {
    leadRows: 220,
    maxPreloadUrls: 240,
    maxHydrateTracks: 96,
    concurrency: 8,
    delayMs: 30,
  },
  lan: {
    leadRows: 1400,
    maxPreloadUrls: 1600,
    maxHydrateTracks: 900,
    concurrency: 32,
    delayMs: 0,
  },
};

const isRemoteCoverLoadPerformanceMode = (value: unknown): value is RemoteCoverLoadPerformanceMode =>
  value === 'low' || value === 'balanced' || value === 'aggressive' || value === 'lan';

export const normalizeRemoteCoverLoadPerformanceMode = (value: unknown): RemoteCoverLoadPerformanceMode =>
  isRemoteCoverLoadPerformanceMode(value) ? value : defaultRemoteCoverLoadPerformanceMode;

const rememberPreloadedUrl = (url: string): void => {
  preloadedRemoteCoverUrls.add(url);
  while (preloadedRemoteCoverUrls.size > maxRememberedPreloadedUrls) {
    const oldest = preloadedRemoteCoverUrls.values().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    preloadedRemoteCoverUrls.delete(oldest);
  }
};

export const selectRemoteCoverPreloadCandidates = (
  tracks: LibraryTrack[],
  visibleTrackIds: string[],
  mode: RemoteCoverLoadPerformanceMode,
): LibraryTrack[] => {
  const plan = remoteCoverLoadPlans[mode];
  const visibleIndexByTrackId = new Map<string, number>();
  tracks.forEach((track, index) => {
    visibleIndexByTrackId.set(track.id, index);
  });

  const visibleIndexes = visibleTrackIds
    .map((trackId) => visibleIndexByTrackId.get(trackId))
    .filter((index): index is number => typeof index === 'number');

  if (visibleIndexes.length === 0) {
    return tracks.slice(0, Math.min(tracks.length, plan.maxPreloadUrls));
  }

  const firstVisibleIndex = Math.min(...visibleIndexes);
  const lastVisibleIndex = Math.max(...visibleIndexes);
  const endIndex = Math.min(tracks.length, lastVisibleIndex + 1 + plan.leadRows);

  return tracks.slice(firstVisibleIndex, endIndex);
};

const uniqueRemoteCoverUrls = (tracks: LibraryTrack[], limit: number): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const track of tracks) {
    const url = track.mediaType === 'remote' ? track.coverThumb : null;
    if (!url || seen.has(url) || preloadedRemoteCoverUrls.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
    if (urls.length >= limit) {
      break;
    }
  }

  return urls;
};

const missingRemoteCoverTrackIds = (tracks: LibraryTrack[], limit: number): string[] => {
  const ids: string[] = [];
  for (const track of tracks) {
    if (track.mediaType !== 'remote' || track.coverThumb) {
      continue;
    }
    ids.push(track.id);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
};

export const useRemoteCoverLoadPerformanceMode = (): RemoteCoverLoadPerformanceMode => {
  const [mode, setMode] = useState<RemoteCoverLoadPerformanceMode>(defaultRemoteCoverLoadPerformanceMode);

  useEffect(() => {
    let disposed = false;

    const loadMode = (): void => {
      void getAppBridge()?.getSettings?.()
        .then((settings) => {
          if (!disposed) {
            setMode(normalizeRemoteCoverLoadPerformanceMode(settings?.remoteCoverLoadPerformanceMode));
          }
        })
        .catch(() => undefined);
    };

    const handleSettingsChanged = (event: Event): void => {
      const detail = event instanceof CustomEvent ? (event.detail as Partial<AppSettings> | null | undefined) : null;
      if (detail && 'remoteCoverLoadPerformanceMode' in detail) {
        setMode(normalizeRemoteCoverLoadPerformanceMode(detail.remoteCoverLoadPerformanceMode));
        return;
      }
      loadMode();
    };

    loadMode();
    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      disposed = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  return mode;
};

export const useRemoteCoverPreloader = ({
  active,
  tracks,
  visibleTrackIds,
  hydrateMissingCovers,
}: RemoteCoverPreloaderOptions): RemoteCoverLoadPerformanceMode => {
  const mode = useRemoteCoverLoadPerformanceMode();
  const visibleTrackIdsKey = useMemo(() => visibleTrackIds.join('\0'), [visibleTrackIds]);
  const previousModeRef = useRef(mode);

  useEffect(() => {
    if (previousModeRef.current !== mode) {
      previousModeRef.current = mode;
      preloadedRemoteCoverUrls.clear();
    }
  }, [mode]);

  useEffect(() => {
    if (!active || tracks.length === 0) {
      return undefined;
    }

    const plan = remoteCoverLoadPlans[mode];
    const candidates = selectRemoteCoverPreloadCandidates(tracks, visibleTrackIds, mode);
    const urls = uniqueRemoteCoverUrls(candidates, plan.maxPreloadUrls);
    const missingCoverIds = hydrateMissingCovers
      ? missingRemoteCoverTrackIds(candidates, plan.maxHydrateTracks)
      : [];
    const imageRefs: HTMLImageElement[] = [];
    let cancelled = false;

    const runPreload = (): void => {
      if (cancelled) {
        return;
      }

      if (missingCoverIds.length > 0) {
        hydrateMissingCovers?.(missingCoverIds);
      }

      if (typeof Image === 'undefined' || urls.length === 0) {
        return;
      }

      let nextIndex = 0;
      let activeCount = 0;
      const pump = (): void => {
        if (cancelled) {
          return;
        }

        while (activeCount < plan.concurrency && nextIndex < urls.length) {
          const url = urls[nextIndex];
          nextIndex += 1;
          activeCount += 1;

          const image = new Image();
          imageRefs.push(image);
          const finish = (): void => {
            activeCount -= 1;
            pump();
          };
          image.onload = (): void => {
            rememberPreloadedUrl(url);
            finish();
          };
          image.onerror = finish;
          image.decoding = 'async';
          image.src = url;
        }
      };

      pump();
    };

    const timer = window.setTimeout(runPreload, plan.delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const image of imageRefs) {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
    };
  }, [active, hydrateMissingCovers, mode, tracks, visibleTrackIds, visibleTrackIdsKey]);

  return mode;
};
