import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Disc3 } from 'lucide-react';
import type { LibraryAlbum, LibraryPage } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { InfiniteScrollSentinel } from '../ui/InfiniteScrollSentinel';
import { MediaWallScrollSpacer, useMediaWallScrollSpacer } from '../ui/MediaWallScrollSpacer';

type ArtistAlbumGridProps = {
  artistId: string;
  artistName: string;
  albumCount?: number;
  onAlbumSelect: (album: LibraryAlbum) => void;
};

const pageSize = 12;
const initialSkeletonCount = 6;

const albumOriginalCoverUrl = (album: LibraryAlbum): string | null =>
  album.coverId ? `echo-cover://original/${encodeURIComponent(album.coverId)}` : null;

const coverFailureKey = (album: LibraryAlbum, coverUrl: string): string => `${album.id}\n${coverUrl}`;

export const ArtistAlbumGrid = ({ artistId, artistName, albumCount, onAlbumSelect }: ArtistAlbumGridProps): JSX.Element => {
  const { t } = useI18n();
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, true>>({});
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(true);
  const { wallRef: albumWallRef, spacerHeight } = useMediaWallScrollSpacer<HTMLDivElement>({
    itemCount: albums.length,
    totalCount: total,
    minColumnWidth: 144,
    columnGap: 14,
    rowGap: 14,
    estimatedItemHeight: 214,
  });

  const loadAlbums = useCallback(
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

        if (!library?.getArtistAlbums) {
          setAlbums([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setError(t('artistDetail.albums.error.desktopBridge'));
          return;
        }

        const result: LibraryPage<LibraryAlbum> = await library.getArtistAlbums(artistId, {
          page: nextPage,
          pageSize,
          sort: 'recent',
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        setAlbums((current) => (mode === 'append' ? [...current, ...result.items] : result.items));
        setPage(result.page);
        setTotal(result.total);
        setHasMore(result.hasMore);
        if (mode === 'replace') {
          setFailedCoverUrls({});
        }
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
    [artistId, t],
  );

  useEffect(() => {
    isLoadingRef.current = true;
    setAlbums([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    setIsLoading(true);
    void loadAlbums(1, 'replace');
  }, [loadAlbums]);

  const handleCoverError = useCallback((album: LibraryAlbum, coverUrl: string): void => {
    setFailedCoverUrls((current) => ({ ...current, [coverFailureKey(album, coverUrl)]: true }));
  }, []);

  const handleLoadMore = useCallback((): void => {
    if (!isLoadingRef.current && hasMore) {
      void loadAlbums(page + 1, 'append');
    }
  }, [hasMore, loadAlbums, page]);

  const handleAlbumKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, album: LibraryAlbum): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onAlbumSelect(album);
      }
    },
    [onAlbumSelect],
  );

  const showInitialLoading = isLoading && albums.length === 0 && !error;
  const expectedSkeletonCount = typeof albumCount === 'number' && Number.isFinite(albumCount) ? Math.ceil(albumCount) : initialSkeletonCount;
  const skeletonCount = Math.min(pageSize, Math.max(1, expectedSkeletonCount));

  if (!isLoading && albums.length === 0 && !error) {
    return (
      <section className="artist-section artist-section-muted" aria-label={t('artistDetail.albums.aria', { artist: artistName })}>
        <header>
          <div>
            <span>{t('artistDetail.tab.albums')}</span>
            <h2>{t('artistDetail.albums.heading', { artist: artistName })}</h2>
          </div>
        </header>
        <p className="artist-detail-empty">{t('artistDetail.albums.empty')}</p>
      </section>
    );
  }

  return (
    <section className="artist-section" aria-label={t('artistDetail.albums.aria', { artist: artistName })}>
      <header>
        <div>
          <span>{t('artistDetail.tab.albums')}</span>
          <h2>{t('artistDetail.albums.heading', { artist: artistName })}</h2>
        </div>
        <small>{albums.length === total ? t('artistDetail.albums.count', { count: total }) : t('artistDetail.albums.loadedCount', { loaded: albums.length, total })}</small>
      </header>

      <div className="artist-album-strip" ref={albumWallRef} data-loading={showInitialLoading ? 'true' : undefined}>
        {showInitialLoading ? Array.from({ length: skeletonCount }, (_, index) => (
          <article className="artist-album-card artist-album-card-skeleton" key={`artist-album-skeleton-${index}`} aria-hidden="true">
            <div className="artist-album-cover" />
            <div className="artist-album-copy">
              <strong />
              <span />
            </div>
          </article>
        )) : albums.map((album) => {
          const originalCover = albumOriginalCoverUrl(album);
          const coverUrl = originalCover && !failedCoverUrls[coverFailureKey(album, originalCover)]
            ? originalCover
            : album.coverThumb && !failedCoverUrls[coverFailureKey(album, album.coverThumb)]
              ? album.coverThumb
              : null;
          const shouldShowCover = Boolean(coverUrl);

          return (
            <article
              className="artist-album-card"
              key={album.id}
              role="button"
              tabIndex={0}
              onClick={() => onAlbumSelect(album)}
              onKeyDown={(event) => handleAlbumKeyDown(event, album)}
            >
              <div className="artist-album-cover" data-empty={!shouldShowCover} aria-hidden="true">
                {shouldShowCover ? (
                  <img
                    alt=""
                    decoding="async"
                    draggable={false}
                    height={320}
                    loading="lazy"
                    src={coverUrl!}
                    width={320}
                    onError={() => handleCoverError(album, coverUrl!)}
                  />
                ) : (
                  <Disc3 size={24} />
                )}
              </div>
              <div className="artist-album-copy">
                <strong>{album.title}</strong>
                <span>{[album.year ? String(album.year) : null, t('artistDetail.meta.tracks', { count: album.trackCount })].filter(Boolean).join(' / ')}</span>
              </div>
            </article>
          );
        })}
      </div>

      {showInitialLoading ? <p className="artist-detail-status">{t('library.albums.loading')}</p> : null}
      <InfiniteScrollSentinel canLoadMore={hasMore} isLoading={isLoading} onLoadMore={handleLoadMore} />
      <MediaWallScrollSpacer height={spacerHeight} />
      {error ? <p className="artist-detail-error">{error}</p> : null}
    </section>
  );
};
