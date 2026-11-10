import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Music2 } from 'lucide-react';
import { useRouteActivity } from '../ui/RouteActivityContext';
import { homeArtworkRefreshEvent } from './homeArtworkRefresh';

export const homeArtworkUrl = (
  source: {
    coverId?: string | null;
    coverThumb?: string | null;
    coverSnapshot?: string | null;
  },
  variant: 'album' | 'large' | 'thumb' = 'album',
): string | null => {
  const fallback = source.coverThumb ?? source.coverSnapshot ?? null;
  return source.coverId
    ? `echo-cover://${variant}/${encodeURIComponent(source.coverId)}`
    : fallback?.replace(/^echo-cover:\/\/(?:thumb|album|large|original)\//u, `echo-cover://${variant}/`) ?? fallback;
};

export const HomeArtwork = memo(({
  coverThumb,
  fetchPriority = 'low',
  size = 92,
  title,
}: {
  coverThumb: string | null;
  fetchPriority?: 'high' | 'low';
  size?: number;
  title: string;
}): JSX.Element => {
  const isRouteActive = useRouteActivity();
  const [failedCoverThumb, setFailedCoverThumb] = useState<string | null>(null);
  const visibleCoverThumb = coverThumb && coverThumb !== failedCoverThumb ? coverThumb : null;

  useEffect(() => {
    if (!isRouteActive || !failedCoverThumb?.startsWith('echo-image://subsonic-cover/')) return;
    const retry = (): void => setFailedCoverThumb(null);
    window.addEventListener(homeArtworkRefreshEvent, retry);
    return () => window.removeEventListener(homeArtworkRefreshEvent, retry);
  }, [failedCoverThumb, isRouteActive]);

  return (
    <div className="home-artwork" data-empty={!visibleCoverThumb} style={{ '--home-artwork-size': `${size}px` } as CSSProperties}>
      {isRouteActive && visibleCoverThumb ? (
        <img
          alt=""
          src={visibleCoverThumb}
          width={size}
          height={size}
          loading={fetchPriority === 'high' ? 'eager' : 'lazy'}
          decoding="async"
          {...{ fetchpriority: fetchPriority }}
          draggable={false}
          onError={() => setFailedCoverThumb(visibleCoverThumb)}
        />
      ) : (
        <Music2 size={Math.max(22, Math.round(size * 0.28))} />
      )}
      <span className="sr-only">{title}</span>
    </div>
  );
});
