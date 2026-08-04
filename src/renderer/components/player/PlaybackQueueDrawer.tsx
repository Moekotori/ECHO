import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Disc3,
  ExternalLink,
  GripVertical,
  ListPlus,
  ListMusic,
  Music2,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { QueueItem, RepeatMode } from '../../stores/PlaybackQueueProvider';
import { usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

type PlaybackQueueDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullQueue: () => void;
};

type QueueDrawerRowProps = {
  item: QueueItem;
  isCurrent: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, item: QueueItem) => void;
  onDragStart: (event: DragEvent<HTMLElement>, item: QueueItem) => void;
  onDrop: (event: DragEvent<HTMLElement>, item: QueueItem) => void;
  onPlay: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  t: (key: TranslationKey, options?: Record<string, string | number>) => string;
};

const drawerCloseAnimationMs = 320;
const queueDrawerDragMime = 'application/x-echo-next-queue-item';

const scheduleQueueDrawerListReady = (callback: () => void): (() => void) => {
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: number | null = null;

  const frameId = window.requestAnimationFrame(() => {
    if (cancelled) {
      return;
    }

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => {
        if (!cancelled) {
          callback();
        }
      }, { timeout: 500 });
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        callback();
      }
    }, 80);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const formatDuration = (duration: number): string => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const trackArtist = (track: LibraryTrack, t: (key: TranslationKey) => string): string => track.artist || track.albumArtist || t('queue.unknownArtist');

const repeatLabel = (mode: RepeatMode, t: (key: TranslationKey) => string): string => {
  if (mode === 'one') {
    return t('queue.repeat.one');
  }

  if (mode === 'all') {
    return t('queue.repeat.all');
  }

  return t('queue.repeat.off');
};

const nextRepeatMode = (mode: RepeatMode): RepeatMode => {
  if (mode === 'off') {
    return 'all';
  }

  if (mode === 'all') {
    return 'one';
  }

  return 'off';
};

const PlaybackQueueDrawerRow = memo(
  ({
    item,
    isCurrent,
    isDragging,
    isDropTarget,
    onDragEnd,
    onDragOver,
    onDragStart,
    onDrop,
    onPlay,
    onRemove,
    t,
  }: QueueDrawerRowProps): JSX.Element => (
    <article
      className="lyrics-queue-row"
      data-current={isCurrent ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      data-drop-target={isDropTarget ? 'true' : undefined}
      draggable
      role="listitem"
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, item)}
      onDragStart={(event) => onDragStart(event, item)}
      onDrop={(event) => onDrop(event, item)}
    >
      <span className="lyrics-queue-drag-handle" aria-label={t('queue.action.dragLabel', { title: item.track.title })} title={t('queue.action.dragTitle')}>
        <GripVertical size={16} />
      </span>
      <div className="lyrics-queue-row-cover" data-empty={!item.track.coverThumb}>
        {item.track.coverThumb ? <img alt="" src={item.track.coverThumb} /> : <Music2 size={18} />}
      </div>
      <button
        className="lyrics-queue-row-main"
        type="button"
        aria-label={t('queue.action.startFromHere', { title: item.track.title })}
        title={t('queue.action.startFromHere', { title: item.track.title })}
        onClick={() => onPlay(item.queueId)}
      >
        <strong>{item.track.title}</strong>
        <span>{trackArtist(item.track, t)}</span>
      </button>
      <span className="lyrics-queue-row-source" title={item.source.label}>
        {item.source.label}
      </span>
      <span className="lyrics-queue-row-duration">{formatDuration(item.track.duration)}</span>
      <div className="lyrics-queue-row-actions" aria-label={t('queue.drawer.rowActions', { title: item.track.title })}>
        <button type="button" aria-label={t('queue.action.remove', { title: item.track.title })} title={t('queue.drawer.removeTitle')} onClick={() => onRemove(item.queueId)}>
          <X size={15} />
        </button>
      </div>
    </article>
  ),
);

PlaybackQueueDrawerRow.displayName = 'PlaybackQueueDrawerRow';

export const PlaybackQueueDrawer = ({ isOpen, onClose, onOpenFullQueue }: PlaybackQueueDrawerProps): JSX.Element | null => {
  const queue = usePlaybackQueue();
  const t = useOptionalI18n()?.t ?? translateFallback;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isListReady, setIsListReady] = useState(false);
  const [isFillingQueue, setIsFillingQueue] = useState(false);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dropTargetQueueId, setDropTargetQueueId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsListReady(false);
      return scheduleQueueDrawerListReady(() => setIsListReady(true));
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRender(false);
      setIsListReady(false);
      setDraggedQueueId(null);
      setDropTargetQueueId(null);
    }, drawerCloseAnimationMs);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  const currentIndex = useMemo(
    () => (queue.currentQueueId ? queue.items.findIndex((item) => item.queueId === queue.currentQueueId) : -1),
    [queue.currentQueueId, queue.items],
  );
  const upcomingCount = currentIndex >= 0 ? Math.max(0, queue.items.length - currentIndex - 1) : queue.items.length;
  const visibleQueueItems = isListReady ? queue.items : [];
  const rowVirtualizer = useVirtualizer({
    count: visibleQueueItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
    overscan: 6,
  });

  const playQueueItem = useCallback(
    (queueId: string): void => {
      setActionError(null);
      void queue.playQueueItem(queueId).catch((error) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
    },
    [queue],
  );

  const removeQueueItem = useCallback(
    (queueId: string): void => {
      setActionError(null);
      queue.removeQueueItem(queueId);
    },
    [queue],
  );

  const handleDragStart = useCallback((event: DragEvent<HTMLElement>, item: QueueItem): void => {
    setActionError(null);
    setDraggedQueueId(item.queueId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(queueDrawerDragMime, item.queueId);
    event.dataTransfer.setData('text/plain', item.queueId);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>, item: QueueItem): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetQueueId(item.queueId);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>, targetItem: QueueItem): void => {
      event.preventDefault();
      const sourceQueueId = draggedQueueId || event.dataTransfer.getData(queueDrawerDragMime) || event.dataTransfer.getData('text/plain');
      setDraggedQueueId(null);
      setDropTargetQueueId(null);

      if (!sourceQueueId || sourceQueueId === targetItem.queueId) {
        return;
      }

      const fromIndex = queue.items.findIndex((item) => item.queueId === sourceQueueId);
      const toIndex = queue.items.findIndex((item) => item.queueId === targetItem.queueId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return;
      }

      queue.moveQueueItem(fromIndex, toIndex);
    },
    [draggedQueueId, queue],
  );

  const handleDragEnd = useCallback((): void => {
    setDraggedQueueId(null);
    setDropTargetQueueId(null);
  }, []);

  const handleOpenFullQueue = useCallback((): void => {
    onClose();
    onOpenFullQueue();
  }, [onClose, onOpenFullQueue]);

  const handleFillQueue = useCallback((): void => {
    setActionError(null);
    setIsFillingQueue(true);
    void queue
      .fillQueue()
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setIsFillingQueue(false));
  }, [queue]);

  if (!shouldRender) {
    return null;
  }

  const nowPlaying = queue.currentTrack ?? queue.currentItem?.track ?? queue.lastPlayedTrack ?? null;

  return (
    <aside className="lyrics-queue-drawer" aria-label={t('queue.drawer.aria')} data-open={isOpen ? 'true' : 'false'}>
      <button className="lyrics-queue-drawer__scrim" type="button" aria-label={t('queue.drawer.close')} onClick={onClose} />
      <section className="lyrics-queue-drawer__panel" aria-label={t('queue.header.kicker')}>
        <header className="lyrics-queue-drawer__header">
          <div>
            <span>{t('queue.header.kicker')}</span>
            <h2>{t('queue.drawer.waitingCount', { count: upcomingCount })}</h2>
          </div>
          <button type="button" aria-label={t('queue.drawer.close')} title={t('notice.action.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="lyrics-queue-now" aria-label={t('queue.now.kicker')}>
          <div className="lyrics-queue-now__cover" data-empty={!nowPlaying?.coverThumb}>
            {nowPlaying?.coverThumb ? <img alt="" src={nowPlaying.coverThumb} /> : <Disc3 size={22} />}
          </div>
          <div className="lyrics-queue-now__copy">
            <span>{t('queue.now.kicker')}</span>
            <strong>{nowPlaying?.title ?? t('queue.now.emptyTitle')}</strong>
            <small>{nowPlaying ? trackArtist(nowPlaying, t) : t('queue.now.emptyDescription')}</small>
            {nowPlaying ? <em>{t('queue.drawer.sourcePrefix', { source: queue.currentSourceLabel })}</em> : null}
          </div>
          {queue.currentItem ? (
            <button type="button" aria-label={t('queue.action.play', { title: queue.currentItem.track.title })} title={t('queue.action.currentItem')} onClick={() => playQueueItem(queue.currentItem!.queueId)}>
              <Play size={16} fill="currentColor" />
            </button>
          ) : null}
        </section>

        <div className="lyrics-queue-toolbar" aria-label={t('queue.tools')}>
          <button
            className={queue.isShuffleEnabled ? 'is-active' : ''}
            type="button"
            aria-pressed={queue.isShuffleEnabled}
            onClick={queue.toggleShuffle}
          >
            <Shuffle size={15} />
            <span>{t('queue.action.shuffle')}</span>
          </button>
          <button type="button" aria-pressed={queue.repeatMode !== 'off'} onClick={() => queue.setRepeatMode(nextRepeatMode(queue.repeatMode))}>
            {queue.repeatMode === 'one' ? <Repeat1 size={15} /> : <Repeat2 size={15} />}
            <span>{repeatLabel(queue.repeatMode, t)}</span>
          </button>
          <button type="button" disabled={queue.items.length === 0} onClick={queue.clearQueue}>
            <Trash2 size={15} />
            <span>{t('queue.drawer.clear')}</span>
          </button>
          <button type="button" disabled={isFillingQueue} onClick={handleFillQueue}>
            <ListPlus size={15} />
            <span>{t('queue.action.autoFill')}</span>
          </button>
          <button type="button" onClick={handleOpenFullQueue}>
            <ExternalLink size={15} />
            <span>{t('queue.drawer.fullQueue')}</span>
          </button>
        </div>

        <div className="lyrics-queue-notices" aria-live="polite">
        {queue.lastQueueFeedback ? (
          <p className="lyrics-queue-feedback" role="status" aria-live="polite" data-tone={queue.lastQueueFeedback.tone}>
            <strong>{queue.lastQueueFeedback.message}</strong>
            <span>{queue.lastQueueFeedback.detail}</span>
          </p>
        ) : null}

        {queue.isShuffleEnabled ? (
          <p className="lyrics-queue-shuffle-scope" role="status">
            {t('queue.drawer.shuffleScope', { scope: queue.shuffleScopeLabel, count: queue.playbackShuffleAvoidRecentCount })}
          </p>
        ) : null}

        </div>

        {queue.items.length > 0 ? (
          <div className="lyrics-queue-list" ref={listRef} role="list" data-virtualized="true">
            <div className="lyrics-queue-virtual-spacer" style={{ height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = visibleQueueItems[virtualRow.index];
                if (!item) {
                  return null;
                }

                return (
                  <div
                    className="lyrics-queue-virtual-row"
                    data-index={virtualRow.index}
                    key={item.queueId}
                    ref={rowVirtualizer.measureElement}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <PlaybackQueueDrawerRow
                      item={item}
                      isCurrent={item.queueId === queue.currentQueueId}
                      isDragging={draggedQueueId === item.queueId}
                      isDropTarget={dropTargetQueueId === item.queueId && draggedQueueId !== item.queueId}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDragStart={handleDragStart}
                      onDrop={handleDrop}
                      onPlay={playQueueItem}
                      onRemove={removeQueueItem}
                      t={t}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="lyrics-queue-empty">
            <ListMusic size={24} />
            <strong>{t('queue.empty.title')}</strong>
            <span>{t('queue.empty.description')}</span>
          </div>
        )}

        {actionError ? <p className="lyrics-queue-error">{actionError}</p> : null}
      </section>
    </aside>
  );
};
