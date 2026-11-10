import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContinuousPlayPreference } from '../../../shared/types/library';
import type { HomeDailyTrack } from './homeDailyRecommendations';
import { loadDailyTracks } from './homeDiscoveryData';

/** One cancellable owner for daily choices; shelf/history refreshes do not rerun it. */
export function useHomeDailyTracks(active: boolean, validationRevision: number, preferences: ContinuousPlayPreference[]) {
  const [daily, setDaily] = useState<HomeDailyTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const processedRefresh = useRef(0);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const preferenceKey = JSON.stringify(preferences);

  useEffect(() => {
    if (!active) { setLoading(false); return; }
    const library = window.echo?.library;
    if (!library?.getTracks) return;
    const controller = new AbortController();
    const refresh = refreshRevision !== processedRefresh.current;
    setLoading(true);
    setError(null);
    void loadDailyTracks(library, controller.signal, refresh, preferencesRef.current).then(tracks => {
      if (!controller.signal.aborted) setDaily(tracks);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => {
      if (!controller.signal.aborted) {
        processedRefresh.current = refreshRevision;
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [active, validationRevision, preferenceKey, refreshRevision]);

  return { daily, loading, error, refreshDaily: useCallback(() => setRefreshRevision(current => current + 1), []) };
}
