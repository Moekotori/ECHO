type RemoteCoverPreloadOptions = {
  concurrency: number;
  rememberUrl: (url: string) => void;
  timeoutMs?: number;
};

/** Detached preloads warm the browser cache without retaining decoded images. */
export const preloadRemoteCoverUrls = (urls: string[], options: RemoteCoverPreloadOptions): (() => void) => {
  if (typeof Image === 'undefined' || urls.length === 0) return () => undefined;
  const activeImages = new Map<HTMLImageElement, number>();
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  let cancelled = false;
  let nextIndex = 0;

  const pump = (): void => {
    if (cancelled) return;
    while (activeImages.size < concurrency && nextIndex < urls.length) {
      const url = urls[nextIndex++];
      const image = new Image();
      let settled = false;
      const finish = (loaded: boolean): void => {
        if (settled || cancelled) return;
        settled = true;
        window.clearTimeout(activeImages.get(image));
        activeImages.delete(image);
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        if (loaded) options.rememberUrl(url);
        pump();
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.decoding = 'async';
      activeImages.set(image, window.setTimeout(() => finish(false), options.timeoutMs ?? 12_000));
      image.src = url;
    }
  };

  pump();
  return () => {
    cancelled = true;
    for (const [image, timer] of activeImages) {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    activeImages.clear();
  };
};
