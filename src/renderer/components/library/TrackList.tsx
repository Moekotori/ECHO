import { memo, useCallback, useEffect, useRef } from 'react';
import type { DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LibraryTrack } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { TrackRow } from './TrackRow';

type TrackListProps = {
  tracks: LibraryTrack[];
  currentTrackId: string | null;
  loadingTrackId?: string | null;
  canLoadMore?: boolean;
  canLoadPrevious?: boolean;
  totalCount?: number;
  loadedCount?: number;
  loadedStartIndex?: number;
  isLoadingMore?: boolean;
  onEndReached?: () => void;
  onStartReached?: () => void;
  onPlay?: (track: LibraryTrack) => void;
  selectedTrackIds?: Record<string, boolean>;
  onToggleSelected?: (track: LibraryTrack) => void;
  onAddToQueue?: (track: LibraryTrack) => void;
  onAddToPlaylist?: (track: LibraryTrack) => void;
  onDownload?: (track: LibraryTrack) => void;
  onOpenArtist?: (track: LibraryTrack) => void;
  onOpenAlbum?: (track: LibraryTrack) => void;
  downloadingTrackIds?: Record<string, boolean>;
  downloadProgressByTrackId?: Record<string, number>;
  duplicateHiddenCounts?: Record<string, number>;
  onShowVersions?: (track: LibraryTrack) => void;
  likedTrackIds?: Record<string, boolean>;
  onToggleLiked?: (track: LibraryTrack) => void;
  onOpenTrackMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
  onVisibleTrackIdsChange?: (trackIds: string[]) => void;
  isTrackDraggable?: (track: LibraryTrack) => boolean;
  draggedTrackId?: string | null;
  dropTargetTrackId?: string | null;
  onTrackDragStart?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onTrackDragOver?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onTrackDrop?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onTrackDragEnd?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
};

const rowHeight = 76;
const loadAheadRows = 12;
const locateCurrentTrackEvent = 'app:locate-current-track';

export const TrackList = memo(({ tracks, currentTrackId, loadingTrackId = null, canLoadMore = false, canLoadPrevious = false, totalCount, loadedCount = tracks.length, loadedStartIndex = 0, isLoadingMore = false, onEndReached, onStartReached, onPlay, selectedTrackIds = {}, onToggleSelected, onAddToQueue, onAddToPlaylist, onDownload, onOpenArtist, onOpenAlbum, downloadingTrackIds = {}, downloadProgressByTrackId = {}, duplicateHiddenCounts = {}, onShowVersions, onOpenTrackMenu, onVisibleTrackIdsChange, isTrackDraggable, draggedTrackId = null, dropTargetTrackId = null, onTrackDragStart, onTrackDragOver, onTrackDrop, onTrackDragEnd }: TrackListProps): JSX.Element => {
  const { t } = useI18n();
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const loadRequestedRef = useRef(false);
  const loadPreviousRequestedRef = useRef(false);
  const visibleTrackIdsKeyRef = useRef('');
  const visibleTrackIdsTimerRef = useRef<number | null>(null);
  const pendingVisibleTrackIdsRef = useRef<{ key: string; trackIds: string[] } | null>(null);
  const virtualCount = Math.max(totalCount ?? tracks.length, tracks.length);
  const safeLoadedStartIndex = Math.max(0, Math.min(loadedStartIndex, Math.max(0, virtualCount - tracks.length)));
  const loadedBoundary = Math.min(virtualCount, safeLoadedStartIndex + Math.min(loadedCount, tracks.length));
  const rowVirtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  useEffect(() => {
    if (!isLoadingMore) {
      loadRequestedRef.current = false;
      loadPreviousRequestedRef.current = false;
    }
  }, [canLoadMore, canLoadPrevious, isLoadingMore, loadedBoundary, safeLoadedStartIndex]);

  const requestLoadMore = useCallback(
    (lastVisibleIndex: number): void => {
      if (!canLoadMore || isLoadingMore || !onEndReached || loadRequestedRef.current || loadedBoundary >= virtualCount) {
        return;
      }

      if (lastVisibleIndex >= Math.max(0, loadedBoundary - loadAheadRows)) {
        loadRequestedRef.current = true;
        onEndReached();
      }
    },
    [canLoadMore, isLoadingMore, loadedBoundary, onEndReached, virtualCount],
  );

  const requestLoadPrevious = useCallback(
    (firstVisibleIndex: number): void => {
      if (!canLoadPrevious || isLoadingMore || !onStartReached || loadPreviousRequestedRef.current || safeLoadedStartIndex <= 0) {
        return;
      }

      const nearLoadedWindowStart =
        firstVisibleIndex >= Math.max(0, safeLoadedStartIndex - loadAheadRows) &&
        firstVisibleIndex <= safeLoadedStartIndex + loadAheadRows;

      if (nearLoadedWindowStart) {
        loadPreviousRequestedRef.current = true;
        onStartReached();
      }
    },
    [canLoadPrevious, isLoadingMore, onStartReached, safeLoadedStartIndex],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const renderedVirtualItems =
    virtualItems.length > 0
      ? virtualItems
      : Array.from({ length: Math.min(virtualCount, 20) }, (_, index) => ({
          index,
          key: `fallback-${index}`,
          start: index * rowHeight,
        }));
  const lastVirtualIndex = renderedVirtualItems.at(-1)?.index ?? -1;
  const firstVirtualIndex = renderedVirtualItems[0]?.index ?? -1;

  useEffect(() => {
    requestLoadMore(lastVirtualIndex);
    requestLoadPrevious(firstVirtualIndex);
  }, [firstVirtualIndex, lastVirtualIndex, requestLoadMore, requestLoadPrevious]);

  useEffect(() => {
    const handleLocateCurrentTrack = (): void => {
      if (!currentTrackId) {
        return;
      }

      const loadedIndex = tracks.findIndex((track) => track.id === currentTrackId);
      if (loadedIndex < 0) {
        return;
      }

      rowVirtualizer.scrollToIndex(safeLoadedStartIndex + loadedIndex, { align: 'center' });
    };

    window.addEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
    return () => window.removeEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
  }, [currentTrackId, rowVirtualizer, safeLoadedStartIndex, tracks]);

  useEffect(() => {
    if (!onVisibleTrackIdsChange) {
      if (visibleTrackIdsTimerRef.current !== null) {
        window.clearTimeout(visibleTrackIdsTimerRef.current);
        visibleTrackIdsTimerRef.current = null;
      }
      pendingVisibleTrackIdsRef.current = null;
      return;
    }

    const visibleTrackIds = renderedVirtualItems
      .map((virtualRow) => tracks[virtualRow.index - safeLoadedStartIndex]?.id)
      .filter((trackId): trackId is string => Boolean(trackId));
    const visibleTrackIdsKey = visibleTrackIds.join('\0');

    if (visibleTrackIdsKeyRef.current === visibleTrackIdsKey) {
      return;
    }

    pendingVisibleTrackIdsRef.current = { key: visibleTrackIdsKey, trackIds: visibleTrackIds };
    if (visibleTrackIdsTimerRef.current !== null) {
      window.clearTimeout(visibleTrackIdsTimerRef.current);
    }
    visibleTrackIdsTimerRef.current = window.setTimeout(() => {
      visibleTrackIdsTimerRef.current = null;
      const pending = pendingVisibleTrackIdsRef.current;

      if (!pending || visibleTrackIdsKeyRef.current === pending.key) {
        return;
      }

      visibleTrackIdsKeyRef.current = pending.key;
      pendingVisibleTrackIdsRef.current = null;
      onVisibleTrackIdsChange(pending.trackIds);
    }, 96);
  }, [onVisibleTrackIdsChange, renderedVirtualItems, safeLoadedStartIndex, tracks]);

  useEffect(() => {
    return () => {
      if (visibleTrackIdsTimerRef.current !== null) {
        window.clearTimeout(visibleTrackIdsTimerRef.current);
      }
    };
  }, []);

  const handleScroll = (): void => {
    const scrollElement = scrollParentRef.current;

    if (!scrollElement || isLoadingMore) {
      return;
    }

    const distanceToBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;

    if (distanceToBottom < 320) {
      if (!canLoadMore || !onEndReached || loadRequestedRef.current) {
        return;
      }

      loadRequestedRef.current = true;
      onEndReached();
      return;
    }

    if (scrollElement.scrollTop < 320) {
      requestLoadPrevious(rowVirtualizer.getVirtualItems()[0]?.index ?? -1);
      return;
    }

    requestLoadMore(rowVirtualizer.getVirtualItems().at(-1)?.index ?? -1);
  };

  return (
    <section className="track-list-shell" aria-label={t('songs.trackList.aria')}>
      <div
        className="track-list"
        ref={scrollParentRef}
        role="list"
        data-virtualized="true"
        data-estimated-row-height={String(rowHeight)}
        data-total-count={virtualCount}
        data-loaded-count={Math.min(loadedCount, tracks.length)}
        data-loaded-start-index={safeLoadedStartIndex}
        onScroll={handleScroll}
      >
        {virtualCount === 0 ? (
          <div className="track-empty-state">{t('songs.trackList.empty')}</div>
        ) : (
          <div className="track-virtual-spacer" style={{ height: rowVirtualizer.getTotalSize() }}>
            {renderedVirtualItems.map((virtualRow) => {
              const track = tracks[virtualRow.index - safeLoadedStartIndex];

              return (
                <div
                  className="track-virtual-row"
                  key={track?.id ?? `track-skeleton-${virtualRow.index}`}
                  data-index={virtualRow.index}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {track ? (
                    <TrackRow
                      isPlaying={track.id === currentTrackId}
                      isLoading={track.id === loadingTrackId}
                      isSelected={selectedTrackIds[track.id] === true}
                      duplicateHiddenCount={duplicateHiddenCounts[track.id] ?? 0}
                      track={track}
                      isDraggable={isTrackDraggable?.(track) ?? false}
                      isDragging={draggedTrackId === (track.playlistItemId ?? track.id)}
                      isDropTarget={dropTargetTrackId === (track.playlistItemId ?? track.id)}
                      onPlay={onPlay}
                      onToggleSelected={onToggleSelected}
                      onAddToQueue={onAddToQueue}
                      onAddToPlaylist={onAddToPlaylist}
                      onDownload={onDownload}
                      onOpenArtist={onOpenArtist}
                      onOpenAlbum={onOpenAlbum}
                      isDownloading={downloadingTrackIds[track.id] === true}
                      downloadProgress={downloadProgressByTrackId[track.id]}
                      onShowVersions={onShowVersions}
                      onOpenMenu={onOpenTrackMenu}
                      onDragStart={onTrackDragStart}
                      onDragOver={onTrackDragOver}
                      onDrop={onTrackDrop}
                      onDragEnd={onTrackDragEnd}
                    />
                  ) : (
                    <div className="track-row track-row-skeleton" role="listitem" aria-label="Loading track" data-skeleton="true">
                      <span className="track-skeleton-cover" aria-hidden="true" />
                      <span className="track-skeleton-copy" aria-hidden="true">
                        <span />
                        <span />
                      </span>
                      <span className="track-skeleton-pill" aria-hidden="true" />
                      <span className="track-skeleton-pill" aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
});

TrackList.displayName = 'TrackList';
