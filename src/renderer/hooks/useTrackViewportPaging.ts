import { useCallback, useEffect, useReducer, useRef } from 'react';

export type TrackViewportRange = { firstIndex: number; lastIndex: number };
export type TrackViewportLoadMode = 'append' | 'prepend' | 'window';

type Options = {
  queryKey: string;
  pageSize: number;
  loadedStartIndex: number;
  loadedCount: number;
  isLoading: boolean;
  onLoadPage: (page: number, mode: TrackViewportLoadMode) => Promise<void | boolean>;
};

/** Keep at most one viewport request active; scrolling only updates its successor. */
export const useTrackViewportPaging = (options: Options): ((range: TrackViewportRange) => void) => {
  const desired = useRef<TrackViewportRange | null>(null);
  const active = useRef<object | null>(null);
  const lastRequest = useRef('');
  const queryKey = useRef(options.queryKey);
  const mounted = useRef(true);
  const [revision, update] = useReducer((value: number) => value + 1, 0);

  if (queryKey.current !== options.queryKey) {
    queryKey.current = options.queryKey;
    desired.current = null;
    active.current = null;
    lastRequest.current = '';
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestRange = useCallback((range: TrackViewportRange): void => {
    const previous = desired.current;
    desired.current = range;
    // Wheel events within a page need no extra parent render or query.
    if (!previous || Math.floor(previous.firstIndex / options.pageSize) !== Math.floor(range.firstIndex / options.pageSize)
      || Math.floor(previous.lastIndex / options.pageSize) !== Math.floor(range.lastIndex / options.pageSize)) update();
  }, [options.pageSize]);

  useEffect(() => {
    const range = desired.current;
    if (!range || options.isLoading || active.current) return;
    const start = options.loadedStartIndex;
    const end = start + options.loadedCount;
    if (range.firstIndex >= start && range.lastIndex < end) {
      lastRequest.current = '';
      return;
    }
    const index = range.firstIndex < start || range.firstIndex >= end ? range.firstIndex : range.lastIndex;
    const page = Math.floor(Math.max(0, index) / options.pageSize) + 1;
    const pageStart = (page - 1) * options.pageSize;
    const mode: TrackViewportLoadMode = pageStart === end ? 'append'
      : pageStart + options.pageSize === start ? 'prepend' : 'window';
    const key = JSON.stringify([options.queryKey, page, mode, start, options.loadedCount]);
    if (lastRequest.current === key) return;
    lastRequest.current = key;
    const task = {};
    active.current = task;
    const completed = (attempted?: void | boolean): void => {
      if (active.current !== task) return;
      active.current = null;
      // Another list refresh can take the read slot before React commits its
      // loading prop. A skipped request must not be remembered as a failure.
      if (attempted === false && lastRequest.current === key) lastRequest.current = '';
      if (mounted.current) update();
    };
    void options.onLoadPage(page, mode).then(completed, () => completed());
  }, [options.isLoading, options.loadedCount, options.loadedStartIndex, options.onLoadPage, options.pageSize, options.queryKey, revision]);

  return requestRange;
};
