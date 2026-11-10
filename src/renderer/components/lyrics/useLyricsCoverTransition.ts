import { useLayoutEffect, useRef, useState } from 'react';

const loadTimeoutMs = 4000;
const transitionMs = 760;
type CoverFrame = { current: string | null; previous: string | null; revision: number };

/** One displayed cover plus one pending/previous cover; no asset cache or queued skips. */
export const useLyricsCoverTransition = (url: string | null, enabled: boolean): CoverFrame => {
  const [frame, setFrame] = useState<CoverFrame>({ current: url, previous: null, revision: 0 });
  const currentRef = useRef(url);
  useLayoutEffect(() => {
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const release = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (image) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        image = null;
      }
    };
    // Drop the outgoing transition before requesting another image. Rapid skips
    // discard the preceding transition instead of accumulating outgoing layers.
    if (!enabled || !url || !currentRef.current || currentRef.current === url) {
      currentRef.current = url;
      // Initial artwork already belongs to this frame. Avoid a synchronous
      // layout-effect render before the lyrics page can paint.
      setFrame(old => old.current === url && old.previous === null
        ? old : { current: url, previous: null, revision: old.revision });
      return release;
    }
    setFrame(old => old.previous === null ? old : { ...old, previous: null });
    const complete = (success: boolean): void => {
      if (cancelled || !image) return;
      release();
      const previous = success ? currentRef.current : null;
      const current = success ? url : null;
      currentRef.current = current;
      setFrame(old => ({ current, previous, revision: old.revision + 1 }));
      if (previous) {
        timer = setTimeout(() => {
          timer = null;
          setFrame(old => ({ ...old, previous: null }));
        }, transitionMs);
      }
    };
    image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const decoding = image?.decode?.();
      if (decoding) void decoding.then(() => complete(true), () => complete(false));
      else complete(true);
    };
    image.onerror = () => complete(false);
    timer = setTimeout(() => complete(false), loadTimeoutMs);
    image.src = url;
    return () => {
      cancelled = true;
      release();
    };
  }, [enabled, url]);
  return enabled ? frame : { current: url, previous: null, revision: frame.revision };
};
