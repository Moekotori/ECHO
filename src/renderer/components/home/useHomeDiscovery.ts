import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContinuousPlayPreference, LibraryAlbum } from '../../../shared/types/library';
import { discoveryDay, loadDiscoveryAlbums, loadUnplayedAlbums, loadYearAlbums } from './homeDiscoveryData';
import { useRouteActivity } from '../ui/RouteActivityContext';
import { useHomeDailyTracks } from './useHomeDailyTracks';
import { useSharedPlaybackActivityState } from '../../stores/playbackStatusStore';

const emptyPreferences: ContinuousPlayPreference[] = [];

export function useHomeDiscovery(enabled: boolean, preferences: ContinuousPlayPreference[] = emptyPreferences) {
  const active = useRouteActivity() && enabled;
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [unplayed, setUnplayed] = useState<LibraryAlbum[]>([]);
  const [yearAlbums, setYearAlbums] = useState<LibraryAlbum[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [shelvesLoading, setShelvesLoading] = useState(false);
  const [unplayedLoading, setUnplayedLoading] = useState(false);
  const [yearLoading, setYearLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const playbackState = useSharedPlaybackActivityState();
  const playbackBusy = playbackState === 'playing' || playbackState === 'loading';
  const pendingRefresh = useRef({ library: false, history: false });
  const [dailyValidationRevision, setDailyValidationRevision] = useState(0);
  const dailyChoices = useHomeDailyTracks(active, dailyValidationRevision, preferences);
  const loading = shelvesLoading || unplayedLoading || dailyChoices.loading || yearLoading;
  const dayRef = useRef(discoveryDay());

  useEffect(() => {
    if (!active) {
      setShelvesLoading(false);
      return;
    }
    dayRef.current = discoveryDay();
    const library = window.echo?.library;
    if (!library?.getTracks || !library.getAlbums) return;
    const controller = new AbortController();
    const { signal } = controller;
    setShelvesLoading(true);
    setError(null);
    void loadDiscoveryAlbums(library, signal).then(candidates => {
      if (signal.aborted) return;
      setAlbums(candidates);
      const years = [...new Set(candidates.flatMap(album => album.year ? [album.year] : []))].sort((a, b) => a - b);
      setYear(current => current ?? years[years.length ? Math.floor(years.length / 2) : 0] ?? null);
    }).catch(failure => {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => { if (!signal.aborted) setShelvesLoading(false); });
    return () => controller.abort();
  }, [active, revision]);

  useEffect(() => {
    if (!active) { setUnplayedLoading(false); return; }
    const library = window.echo?.library;
    if (!library?.getAlbums) return;
    const controller = new AbortController();
    setUnplayedLoading(true);
    setError(null);
    void loadUnplayedAlbums(library, controller.signal).then(albums => {
      if (!controller.signal.aborted) setUnplayed(albums);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => { if (!controller.signal.aborted) setUnplayedLoading(false); });
    return () => controller.abort();
  }, [active, revision, historyRevision]);

  useEffect(() => {
    if (!active || year === null) {
      setYearLoading(false);
      return;
    }
    const library = window.echo?.library;
    if (!library?.getAlbums) return;
    const controller = new AbortController();
    setYearLoading(true);
    setYearAlbums([]);
    void loadYearAlbums(library, year, controller.signal).then(albums => {
      if (!controller.signal.aborted) setYearAlbums(albums);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setYearLoading(false);
    });
    return () => controller.abort();
  }, [active, year, revision]);

  useEffect(() => {
    if (!active) {
      // Re-entry already revalidates every shelf.
      pendingRefresh.current = { library: false, history: false };
      return;
    }
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearTimeout(timer);
      if (document.hidden || playbackBusy) return;
      const pending = pendingRefresh.current;
      if (!pending.library && !pending.history) return;
      timer = window.setTimeout(() => {
        if (pending.library) {
          setDailyValidationRevision(current => current + 1);
          setRevision(current => current + 1);
        } else if (pending.history) {
          setHistoryRevision(current => current + 1);
        }
        pending.library = false;
        pending.history = false;
      }, 500);
    };
    const libraryChanged = (): void => { pendingRefresh.current.library = true; schedule(); };
    const historyChanged = (): void => { pendingRefresh.current.history = true; schedule(); };
    const focus = (): void => {
      const day = discoveryDay();
      if (day !== dayRef.current) {
        dayRef.current = day;
        pendingRefresh.current.library = true;
      }
      schedule();
    };
    const visible = (): void => {
      if (document.hidden) window.clearTimeout(timer);
      else focus();
    };
    schedule();
    window.addEventListener('library:changed', libraryChanged);
    window.addEventListener('playback-history:changed', historyChanged);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('library:changed', libraryChanged);
      window.removeEventListener('playback-history:changed', historyChanged);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, playbackBusy]);

  return { daily: dailyChoices.daily, albums, unplayed, yearAlbums, year, setYear, loading,
    error: error ?? dailyChoices.error, refreshDaily: dailyChoices.refreshDaily,
    retry: useCallback(() => {
      setDailyValidationRevision(current => current + 1);
      setRevision(current => current + 1);
    }, []) };
}
