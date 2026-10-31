import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';

// Keep the stable function in its own scope. Capturing a component's render
// scope can link differently memoized callbacks to previous render snapshots.
const createCallback = <Args extends unknown[], Result>(
  current: MutableRefObject<(...args: Args) => Result>,
): ((...args: Args) => Result) => (...args) => current.current(...args);

/** For event/animation callbacks only: always read the latest committed render. */
export const useCommittedCallback = <Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): ((...args: Args) => Result) => {
  const current = useRef(callback);
  useLayoutEffect(() => {
    current.current = callback;
  });
  return useMemo(() => createCallback(current), []);
};
