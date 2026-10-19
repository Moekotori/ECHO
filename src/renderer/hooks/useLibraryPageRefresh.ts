import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouteActivity } from '../components/ui/RouteActivityContext';

const preservesScroll = (event: Event): boolean =>
  event instanceof CustomEvent && event.detail?.preserveScroll === true;

/** Coalesce bursts; hidden retained walls refresh once when they become active. */
export function useLibraryPageRefresh(refresh: (event: Event) => void): void {
  const active = useRouteActivity();
  const activeRef = useRef(active);
  const refreshRef = useRef(refresh);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Event | null>(null);
  // Suspended/aborted navigation must not publish an uncommitted route or callback.
  useLayoutEffect(() => {
    activeRef.current = active;
    refreshRef.current = refresh;
  });

  const flush = useCallback((): void => {
    timer.current = null;
    if (!activeRef.current) return;
    const next = pending.current;
    pending.current = null;
    if (next) refreshRef.current(next);
  }, []);

  useLayoutEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (active && pending.current) flush();
  }, [active, flush]);

  useEffect(() => {
    const handleChange = (event: Event): void => {
      // Structural changes must win even across a long hidden interval.
      if (!pending.current || preservesScroll(pending.current)) pending.current = event;
      if (!activeRef.current || timer.current !== null) return;
      timer.current = setTimeout(flush, 120);
    };
    window.addEventListener('library:changed', handleChange);
    return () => {
      window.removeEventListener('library:changed', handleChange);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
    };
  }, [flush]);
}
