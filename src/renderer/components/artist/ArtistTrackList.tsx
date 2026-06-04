import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Disc3, ListPlus, MoreHorizontal, Play, SkipForward } from 'lucide-react';
import type { EditableTrackTags, LibraryAlbum, LibraryPage, LibraryPlaylist, LibraryTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { TrackContextMenu } from '../library/TrackContextMenu';
import type { TrackMenuAction } from '../library/TrackContextMenu';
import { TrackTagEditorDrawer } from '../library/TrackTagEditorDrawer';
import { getPageScrollContainer } from '../ui/InfiniteScrollSentinel';
import { openAlbumDetailForTrack } from '../../utils/albumNavigation';
import { resolvePlaylistForTrackAdd } from '../../utils/appPrompt';

type ArtistTrackListProps = {
  artistId: string;
  artistName: string;
  currentTrackId: string | null;
  onAppendToQueue: (track: LibraryTrack) => void;
  onLoadedTracksChange?: (tracks: LibraryTrack[], total: number, isLoading: boolean) => void;
  onOpenAlbum: (album: LibraryAlbum) => void;
  onPlayNext: (track: LibraryTrack) => void;
  onPlayTrack: (track: LibraryTrack) => void | Promise<void>;
};

type TrackMenuState = {
  track: LibraryTrack;
  position: { x: number; y: number };
};

const pageSize = 50;
const artistTrackRowHeight = 80;
const artistTrackCompactRowHeight = 120;
const artistTrackLoadAheadRows = 10;

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

  const khz = sampleRate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}kHz`;
};

const technicalTags = (track: LibraryTrack): string[] =>
  [track.codec?.toUpperCase() ?? null, track.bitDepth ? `${track.bitDepth}bit` : null, formatSampleRate(track.sampleRate)].filter(
    (tag): tag is string => Boolean(tag),
  );

export const ArtistTrackList = ({
  artistId,
  artistName,
  currentTrackId,
  onAppendToQueue,
  onLoadedTracksChange,
  onPlayNext,
  onPlayTrack,
}: ArtistTrackListProps): JSX.Element => {
  const { t } = useI18n();
  const { removeTrackFromQueue } = usePlaybackQueue();
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);
  const loadRequestedRef = useRef(false);
  const virtualSpacerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [estimatedRowHeight, setEstimatedRowHeight] = useState(artistTrackRowHeight);
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const virtualCount = Math.max(total, tracks.length);
  const loadedBoundary = tracks.length;
  const rowVirtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => getPageScrollContainer(virtualSpacerRef.current),
    estimateSize: () => estimatedRowHeight,
    overscan: 8,
    scrollMargin,
  });

  useLayoutEffect(() => {
    const calculateScrollMargin = (): void => {
      const spacer = virtualSpacerRef.current;
      const scrollContainer = getPageScrollContainer(spacer);

      if (!spacer || !scrollContainer) {
        setScrollMargin(0);
        return;
      }

      const spacerRect = spacer.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const nextScrollMargin = Math.max(0, Math.round(spacerRect.top - containerRect.top + scrollContainer.scrollTop));
      setScrollMargin((current) => (current === nextScrollMargin ? current : nextScrollMargin));
    };

    calculateScrollMargin();
    window.addEventListener('resize', calculateScrollMargin);
    return () => window.removeEventListener('resize', calculateScrollMargin);
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 820px)');

    if (!mediaQuery) {
      return undefined;
    }

    const updateEstimate = (): void => {
      setEstimatedRowHeight(mediaQuery.matches ? artistTrackCompactRowHeight : artistTrackRowHeight);
    };

    updateEstimate();
    mediaQuery.addEventListener('change', updateEstimate);
    return () => mediaQuery.removeEventListener('change', updateEstimate);
  }, []);

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
      setStatusMessage(null);

      try {
        const library = window.echo?.library;

        if (!library?.getArtistTracks) {
          setTracks([]);
          setPage(1);
          setTotal(0);
          setHasMore(false);
          setError(t('artistDetail.tracks.error.desktopBridgeRead'));
          return;
        }

        const result: LibraryPage<LibraryTrack> = await library.getArtistTracks(artistId, {
          page: nextPage,
          pageSize,
          sort: 'default',
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
    [artistId, t],
  );

  useEffect(() => {
    setTracks([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    void loadTracks(1, 'replace');
  }, [loadTracks]);

  useEffect(() => {
    onLoadedTracksChange?.(tracks, total, isLoading);
  }, [isLoading, onLoadedTracksChange, total, tracks]);

  useEffect(() => {
    if (!isLoading) {
      loadRequestedRef.current = false;
    }
  }, [isLoading, loadedBoundary]);

  const handleLoadMore = useCallback((): void => {
    if (!isLoadingRef.current && hasMore) {
      void loadTracks(page + 1, 'append');
    }
  }, [hasMore, loadTracks, page]);

  const requestLoadMore = useCallback(
    (lastVisibleIndex: number): void => {
      if (!hasMore || isLoading || loadRequestedRef.current || loadedBoundary >= virtualCount) {
        return;
      }

      if (lastVisibleIndex >= Math.max(0, loadedBoundary - artistTrackLoadAheadRows)) {
        loadRequestedRef.current = true;
        handleLoadMore();
      }
    },
    [handleLoadMore, hasMore, isLoading, loadedBoundary, virtualCount],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const renderedVirtualItems =
    virtualItems.length > 0
      ? virtualItems
      : tracks.slice(0, Math.min(tracks.length, 20)).map((_, index) => ({
          index,
          key: `fallback-${index}`,
          start: index * estimatedRowHeight + scrollMargin,
        }));
  const lastVirtualIndex = renderedVirtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    requestLoadMore(lastVirtualIndex);
  }, [lastVirtualIndex, requestLoadMore]);

  const handleOpenTrackMenu = useCallback((track: LibraryTrack, position: { x: number; y: number }): void => {
    setTrackMenu({ track, position });
  }, []);

  const handleTrackContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>, track: LibraryTrack): void => {
      event.preventDefault();
      event.stopPropagation();
      handleOpenTrackMenu(track, { x: event.clientX, y: event.clientY });
    },
    [handleOpenTrackMenu],
  );

  const handleMoreClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, track: LibraryTrack): void => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      handleOpenTrackMenu(track, { x: rect.right - 12, y: rect.bottom + 8 });
    },
    [handleOpenTrackMenu],
  );

  const closeTagEditor = useCallback((): void => {
    setIsTagEditorOpen(false);
    if (tagEditorCloseTimerRef.current !== null) {
      window.clearTimeout(tagEditorCloseTimerRef.current);
    }
    tagEditorCloseTimerRef.current = window.setTimeout(() => {
      setEditingTrack(null);
      tagEditorCloseTimerRef.current = null;
    }, 280);
  }, []);

  const handleSaveTags = useCallback(
    async (
      track: LibraryTrack,
      tags: EditableTrackTags,
      coverPath: string | null,
      coverUrl: string | null,
      coverMimeType: string | null,
    ): Promise<void> => {
      const library = window.echo?.library;

      if (!library?.updateTrackTags) {
        setTagEditorError(t('artistDetail.tracks.error.desktopBridgeEdit'));
        return;
      }

      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const updatedTrack = await library.updateTrackTags({ trackId: track.id, tags, coverPath, coverUrl, coverMimeType });
        setTracks((current) => current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item)));
        window.dispatchEvent(new Event('library:changed'));
        closeTagEditor();
      } catch (saveError) {
        setTagEditorError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor, t],
  );

  const handleGoToAlbum = useCallback(
    async (track: LibraryTrack): Promise<void> => {
      if (await openAlbumDetailForTrack(track)) {
        return;
      }

      setStatusMessage(t('artistDetail.tracks.status.albumNotFound', { album: track.album || t('artistDetail.tracks.unknownAlbum') }));
    },
    [t],
  );

  const handleTrackMenuAction = useCallback(
    async (action: TrackMenuAction, track: LibraryTrack, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      setTrackMenu(null);

      if (action === 'clear-lyrics-cache') {
        const lyricsApi = window.echo?.lyrics;
        if (!lyricsApi?.clearCache) {
          setError('Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.');
          return;
        }

        try {
          setError(null);
          setStatusMessage(null);
          await lyricsApi.clearCache(track.id);
          window.dispatchEvent(new CustomEvent('lyrics:rematch-requested', { detail: { trackId: track.id } }));
          setStatusMessage(`已清理歌词缓存：${track.title}`);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      if (!library && action !== 'play-next' && action !== 'add-to-queue' && action !== 'remove-from-queue' && action !== 'edit-tags' && action !== 'reload-embedded-tags') {
        setError(t('artistDetail.tracks.error.desktopBridgeActions'));
        return;
      }

      try {
        setError(null);
        setStatusMessage(null);

        if (
          track.mediaType === 'remote' &&
          (action === 'edit-tags' ||
            action === 'reload-embedded-tags' ||
            action === 'open-osu-timing' ||
            action === 'show-in-folder' ||
            action === 'copy-path' ||
            action === 'open-system' ||
            action === 'delete-song')
        ) {
          setError(t('artistDetail.tracks.error.remoteFileAction'));
          return;
        }

        switch (action) {
          case 'play-next':
            onPlayNext(track);
            return;
          case 'add-to-queue':
            onAppendToQueue(track);
            return;
          case 'toggle-liked':
            await library?.toggleTrackLiked(track.id);
            window.dispatchEvent(new Event('liked:tracks-changed'));
            window.dispatchEvent(new Event('liked:changed'));
            return;
          case 'remove-from-queue':
            {
              const removedCount = removeTrackFromQueue(track.id);
              setStatusMessage(
                removedCount > 0
                  ? t('artistDetail.tracks.status.removedFromQueue', { title: track.title })
                  : t('artistDetail.tracks.status.notInQueue', { title: track.title }),
              );
            }
            return;
          case 'edit-tags':
            setTagEditorError(null);
            if (tagEditorCloseTimerRef.current !== null) {
              window.clearTimeout(tagEditorCloseTimerRef.current);
              tagEditorCloseTimerRef.current = null;
            }
            setIsTagEditorOpen(false);
            setEditingTrack(track);
            window.requestAnimationFrame(() => setIsTagEditorOpen(true));
            return;
          case 'reload-embedded-tags':
            {
              const result = await library!.loadEmbeddedTrackTags(track.id);
              setTracks((current) => current.map((item) => (item.id === result.track.id ? result.track : item)));
              if (editingTrack?.id === result.track.id) {
                setEditingTrack(result.track);
              }
              setStatusMessage(t('artistDetail.tracks.status.reloadedTags', { title: result.track.title }));
              window.dispatchEvent(new Event('library:changed'));
            }
            return;
          case 'go-to-album':
            await handleGoToAlbum(track);
            return;
          case 'show-in-folder':
            await library?.openTrackInFolder(track.id);
            return;
          case 'copy-path':
            await library?.copyTrackPath(track.id);
            return;
          case 'open-system':
            await library?.openTrackWithSystem(track.id);
            return;
          case 'copy-name-artist':
            await library?.copyTrackNameArtist(track.id);
            return;
          case 'copy-cover':
            if (!(await library?.copyTrackCover(track.id))) {
              setError(t('artistDetail.tracks.error.noCoverToCopy'));
            }
            return;
          case 'save-cover':
            if (!(await library?.saveTrackCover(track.id))) {
              setError(t('artistDetail.tracks.error.noCoverSaved'));
            }
            return;
          case 'delete-song':
            if (!window.confirm(t('artistDetail.tracks.confirm.delete', { title: track.title }))) {
              return;
            }
            await library?.deleteTrackFile(track.id);
            setTracks((current) => current.filter((item) => item.id !== track.id));
            window.dispatchEvent(new Event('library:changed'));
            return;
          case 'add-to-playlist':
            {
              if (track.mediaType === 'streaming') {
                setError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
                return;
              }

              const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library!));
              if (!playlist) {
                return;
              }

              await library!.addTrackToPlaylist(playlist.id, track.id);
              window.dispatchEvent(new Event('library:playlists-changed'));
              setStatusMessage(t('artistDetail.tracks.status.addedToPlaylist', { playlist: playlist.name }));
            }
            return;
          default:
            setError(t('artistDetail.tracks.error.actionUnavailable'));
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [editingTrack, handleGoToAlbum, onAppendToQueue, onPlayNext, removeTrackFromQueue, t],
  );

  return (
    <section className="artist-section artist-track-section" aria-label={t('artistDetail.tracks.aria', { artist: artistName })}>
      <header>
        <div>
          <span>{t('artistDetail.tab.songs')}</span>
          <h2>{t('artistDetail.tracks.heading', { artist: artistName })}</h2>
        </div>
        <small>{tracks.length === total ? t('artistDetail.meta.tracks', { count: total }) : t('artistDetail.tracks.loadedCount', { loaded: tracks.length, total })}</small>
      </header>

      <div className="artist-track-list" role="list" data-virtualized="true" data-total-count={virtualCount} data-loaded-count={loadedBoundary}>
        {virtualCount > 0 ? (
          <div className="artist-track-header" aria-hidden="true">
            <span>{t('artistDetail.tracks.column.title')}</span>
            <span>{t('artistDetail.tracks.column.album')}</span>
            <span>{t('artistDetail.tracks.column.signal')}</span>
            <span>{t('artistDetail.tracks.column.time')}</span>
            <span>{t('artistDetail.tracks.column.actions')}</span>
          </div>
        ) : null}

        <div className="artist-track-virtual-spacer" ref={virtualSpacerRef} style={{ height: rowVirtualizer.getTotalSize() }}>
          {renderedVirtualItems.map((virtualRow) => {
            const track = tracks[virtualRow.index];

            if (!track) {
              return (
                <div
                  className="artist-track-virtual-row"
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
                >
                  <div className="artist-track-row artist-track-row-skeleton" role="listitem" aria-label={t('artistDetail.tracks.loadingTrack')} data-skeleton="true">
                    <span className="artist-track-skeleton-cover" aria-hidden="true" />
                    <span className="artist-track-skeleton-copy" aria-hidden="true">
                      <span />
                      <span />
                    </span>
                    <span className="artist-track-skeleton-pill" aria-hidden="true" />
                    <span className="artist-track-skeleton-pill" aria-hidden="true" />
                    <span className="artist-track-skeleton-actions" aria-hidden="true" />
                  </div>
                </div>
              );
            }

            const isPlaying = track.id === currentTrackId;
            const tags = technicalTags(track);

            return (
              <div
                className="artist-track-virtual-row"
                key={track.id}
                data-index={virtualRow.index}
                style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
                onContextMenu={(event) => handleTrackContextMenu(event, track)}
              >
                <div
                  className="artist-track-row"
                  data-playing={isPlaying}
                  role="listitem"
                  onContextMenu={(event) => handleTrackContextMenu(event, track)}
                >
                  <button className="artist-track-main" type="button" onClick={() => void onPlayTrack(track)}>
                    <span className="artist-track-cover" data-empty={!track.coverThumb} aria-hidden="true">
                      {track.coverThumb ? (
                        <img alt="" decoding="async" draggable={false} height={48} loading="lazy" src={track.coverThumb} width={48} />
                      ) : (
                        <Disc3 size={17} />
                      )}
                      <Play className="artist-track-play" size={13} fill="currentColor" aria-hidden="true" />
                    </span>
                    <span className="artist-track-copy">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                  </button>
                  <span className="artist-track-album">{track.album || t('artistDetail.tracks.unknownAlbum')}</span>
                  <span className="artist-track-tags" aria-label={t('artistDetail.tracks.formatAria')}>
                    {tags.length > 0 ? tags.map((tag) => <em key={`${track.id}-${tag}`}>{tag}</em>) : <em>{t('artistDetail.status.localLibrary')}</em>}
                  </span>
                  <span className="artist-track-duration">{formatDuration(track.duration)}</span>
                  <span className="artist-track-actions">
                    <button type="button" aria-label={t('artistDetail.tracks.action.playNextAria', { title: track.title })} title={t('artistDetail.tracks.action.playNext')} onClick={() => onPlayNext(track)}>
                      <SkipForward size={15} />
                    </button>
                    <button type="button" aria-label={t('artistDetail.tracks.action.addToQueueAria', { title: track.title })} title={t('artistDetail.action.addToQueue')} onClick={() => onAppendToQueue(track)}>
                      <ListPlus size={15} />
                    </button>
                    <button type="button" aria-label={t('artistDetail.tracks.action.moreAria', { title: track.title })} title={t('artistDetail.tracks.action.more')} onClick={(event) => handleMoreClick(event, track)}>
                      <MoreHorizontal size={15} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error ? <p className="artist-detail-error">{error}</p> : null}
      {statusMessage ? <p className="artist-detail-status">{statusMessage}</p> : null}
      {!isLoading && tracks.length === 0 && !error ? <p className="artist-detail-empty">{t('artistDetail.tracks.empty')}</p> : null}
      {isLoading && tracks.length === 0 ? <p className="artist-detail-loading">{t('artistDetail.tracks.loading')}</p> : null}

      {trackMenu ? (
        <TrackContextMenu
          track={trackMenu.track}
          position={trackMenu.position}
          onAction={(action, track, playlist) => void handleTrackMenuAction(action, track, playlist)}
          onClose={() => setTrackMenu(null)}
        />
      ) : null}

      <TrackTagEditorDrawer
        track={editingTrack}
        isOpen={isTagEditorOpen}
        isSaving={isSavingTags}
        error={tagEditorError}
        onClose={closeTagEditor}
        onSave={(track, tags, coverPath, coverUrl, coverMimeType) => void handleSaveTags(track, tags, coverPath, coverUrl, coverMimeType)}
        onTrackUpdated={(updatedTrack) => {
          setEditingTrack(updatedTrack);
          setTracks((current) => current.map((item) => (item.id === updatedTrack.id ? updatedTrack : item)));
          window.dispatchEvent(new Event('library:changed'));
        }}
      />
    </section>
  );
};
