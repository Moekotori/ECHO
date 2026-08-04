import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Heart, Play } from 'lucide-react';
import type { LibraryPage, LibraryTrack } from '../../../shared/types/library';
import { useLikedTrackIds } from '../../hooks/useLikedMedia';
import { useI18n } from '../../i18n/I18nProvider';

type AlbumTrackListProps = {
  albumId: string;
  currentTrackId: string | null;
  hidden?: boolean;
  onFirstTrackChange?: (track: LibraryTrack | null, isLoading: boolean) => void;
  onLoadedTracksChange?: (tracks: LibraryTrack[], total: number, isLoading: boolean) => void;
  onOpenTrackMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
  onPlayTrack: (track: LibraryTrack) => void | Promise<void>;
  onToggleTrackLiked?: (track: LibraryTrack) => void | Promise<void>;
  initialLoadBlocked?: boolean;
  initialLoadDelayMs?: number;
  summary?: {
    duration: string;
    signal: string;
    totalLabel: string;
  };
};

const pageSize = 100;

const formatDuration = (duration: number): string => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatSampleRate = (sampleRate: number | null): string | null => {
  if (!sampleRate) {
    return null;
  }

  return sampleRate >= 1000 ? `${Math.round(sampleRate / 1000)}kHz` : `${sampleRate}Hz`;
};

const technicalTags = (track: LibraryTrack): string[] =>
  [
    track.codec?.toUpperCase() ?? null,
    track.bitDepth ? `${track.bitDepth}bit` : null,
    formatSampleRate(track.sampleRate),
    track.bitrate ? (track.bitrate >= 1000000 ? `${(track.bitrate / 1000000).toFixed(1)}Mbps` : `${Math.round(track.bitrate / 1000)}kbps`) : null,
  ].filter((tag): tag is string => Boolean(tag));

const normalizeDiscNo = (discNo: number | null): number | null => (discNo && Number.isFinite(discNo) && discNo > 0 ? Math.trunc(discNo) : null);

const formatDiscLabel = (discNo: number | null): string => (discNo ? `Disc ${discNo}` : 'Disc ?');

export const AlbumTrackList = ({
  albumId,
  currentTrackId,
  hidden = false,
  onFirstTrackChange,
  onLoadedTracksChange,
  onOpenTrackMenu,
  onPlayTrack,
  onToggleTrackLiked,
  initialLoadBlocked = false,
  initialLoadDelayMs = 0,
  summary,
}: AlbumTrackListProps): JSX.Element => {
  const { t } = useI18n();
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const loadTracksRef = useRef<(nextPage: number, mode: 'replace' | 'append') => Promise<void>>(async () => undefined);
  const likedTrackIds = useLikedTrackIds(tracks.map((track) => track.id));
  const shouldShowDiscHeaders = useMemo(() => {
    const discNumbers = new Set(tracks.map((track) => normalizeDiscNo(track.discNo)).filter((discNo): discNo is number => discNo !== null));
    return discNumbers.size > 1 || [...discNumbers].some((discNo) => discNo > 1);
  }, [tracks]);
  const trackSections = useMemo(() => {
    const sections: Array<{ discNo: number | null; tracks: Array<{ index: number; track: LibraryTrack }> }> = [];

    tracks.forEach((track, index) => {
      const discNo = shouldShowDiscHeaders ? normalizeDiscNo(track.discNo) : null;
      const current = sections[sections.length - 1];

      if (!current || current.discNo !== discNo) {
        sections.push({ discNo, tracks: [{ index, track }] });
        return;
      }

      current.tracks.push({ index, track });
    });

    return sections;
  }, [shouldShowDiscHeaders, tracks]);

  const loadTracks = useCallback(
    async (nextPage: number, mode: 'replace' | 'append'): Promise<void> => {
      if (mode === 'append' && isLoadingRef.current) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const library = window.echo?.library;

        if (!library) {
          setTracks([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setError(t('albumDetail.tracks.error.desktopBridgeRead'));
          return;
        }

        const result: LibraryPage<LibraryTrack> = await library.getAlbumTracks(albumId, {
          page: nextPage,
          pageSize,
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setTracks((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
        setPage(result.page);
        setTotal(result.total);
        setHasMore(result.hasMore);
      } catch (loadError) {
        if (requestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [albumId, t],
  );
  loadTracksRef.current = loadTracks;

  useEffect(() => {
    setTracks([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    setError(null);
    if (initialLoadBlocked) {
      isLoadingRef.current = true;
      setIsLoading(true);
      return () => {
        requestIdRef.current += 1;
        isLoadingRef.current = false;
      };
    }

    if (initialLoadDelayMs > 0 && typeof window !== 'undefined') {
      isLoadingRef.current = true;
      setIsLoading(true);
      const timeoutId = window.setTimeout(() => {
        isLoadingRef.current = false;
        void loadTracksRef.current(1, 'replace');
      }, initialLoadDelayMs);

      return () => {
        window.clearTimeout(timeoutId);
        requestIdRef.current += 1;
        isLoadingRef.current = false;
      };
    }

    void loadTracksRef.current(1, 'replace');
    return undefined;
  }, [albumId, initialLoadBlocked, initialLoadDelayMs]);

  useEffect(() => {
    onFirstTrackChange?.(tracks[0] ?? null, isLoading && tracks.length === 0);
    onLoadedTracksChange?.(tracks, total, isLoading);
  }, [isLoading, onFirstTrackChange, onLoadedTracksChange, total, tracks]);

  const handleLoadMore = useCallback((): void => {
    if (!isLoadingRef.current && hasMore) {
      void loadTracks(page + 1, 'append');
    }
  }, [hasMore, loadTracks, page]);

  const handleTrackContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, track: LibraryTrack): void => {
      if (!onOpenTrackMenu) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onOpenTrackMenu(track, { x: event.clientX, y: event.clientY });
    },
    [onOpenTrackMenu],
  );

  return (
    <section className="album-track-section" aria-label={t('albumDetail.tracks.aria')} hidden={hidden}>
      <div className="album-track-toolbar">
        <div className="album-track-summary" aria-label={t('albumDetail.tracks.summaryAria')}>
          <span>{summary?.totalLabel ?? (tracks.length === total ? t('albumDetail.count.tracks', { count: total }) : t('albumDetail.count.loadedTracks', { loaded: tracks.length, total }))}</span>
          <span>{summary?.duration ?? t('albumDetail.status.unknownLength')}</span>
          <span>{summary?.signal ?? t('albumDetail.status.readingSignal')}</span>
        </div>
        <span>{tracks.length === total ? t('albumDetail.count.tracks', { count: total }) : t('albumDetail.count.loadedTracks', { loaded: tracks.length, total })}</span>
      </div>

      <div className="album-track-list" role="list">
        {tracks.length > 0 ? (
          <div className="album-track-header" aria-hidden="true">
            <span>#</span>
            <span>{t('albumDetail.tracks.column.title')}</span>
            <span>{t('albumDetail.tracks.column.signal')}</span>
            <span>{t('albumDetail.tracks.column.time')}</span>
          </div>
        ) : null}
        {trackSections.map((section) => (
          <Fragment key={`disc-${section.discNo ?? 'unknown'}-${section.tracks[0]?.track.id ?? 'empty'}`}>
            {shouldShowDiscHeaders ? <div className="album-track-disc-heading">{formatDiscLabel(section.discNo)}</div> : null}
            {section.tracks.map(({ index, track }) => {
              const isPlaying = track.id === currentTrackId;
              const trackNumber = track.trackNo ?? index + 1;
              const tags = technicalTags(track);

              return (
                <button
                  className="album-track-row"
                  data-playing={isPlaying}
                  key={track.id}
                  role="listitem"
                  type="button"
                  onClick={() => void onPlayTrack(track)}
                  onContextMenu={(event) => handleTrackContextMenu(event, track)}
                >
                  <span className="album-track-number">
                    <span>{trackNumber}</span>
                    <Play className="album-track-row-play" size={13} fill="currentColor" aria-hidden="true" />
                  </span>
                  <span className="album-track-copy">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                  <span className="album-track-tags" aria-label={t('albumDetail.tracks.formatAria')}>
                    {tags.map((tag) => (
                      <em key={`${track.id}-${tag}`}>{tag}</em>
                    ))}
                  </span>
                  <span className="album-track-duration">{formatDuration(track.duration)}</span>
                  <span className="album-track-actions">
                    <span
                      className={`album-track-like ${likedTrackIds[track.id] ? 'is-liked' : ''}`}
                      role="button"
                      tabIndex={-1}
                      aria-label={likedTrackIds[track.id] ? t('albumDetail.tracks.action.unlike', { title: track.title }) : t('albumDetail.tracks.action.like', { title: track.title })}
                      aria-pressed={likedTrackIds[track.id] === true}
                      title={likedTrackIds[track.id] ? t('albumDetail.tracks.action.unlikeTitle') : t('albumDetail.tracks.action.likeTitle')}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onToggleTrackLiked?.(track);
                      }}
                    >
                      <Heart size={14} fill={likedTrackIds[track.id] ? 'currentColor' : 'none'} />
                    </span>
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {hasMore ? (
        <button className="album-load-more" type="button" disabled={isLoading} onClick={handleLoadMore}>
          {isLoading ? t('albumDetail.tracks.loading') : t('albumDetail.tracks.loadMore')}
        </button>
      ) : null}

      {error ? <p className="album-detail-error">{error}</p> : null}
      {!isLoading && tracks.length === 0 && !error ? <p className="album-detail-empty">{t('albumDetail.tracks.empty')}</p> : null}
    </section>
  );
};
