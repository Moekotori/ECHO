import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Disc3,
  FolderOpen,
  GripVertical,
  Heart,
  History,
  ListPlus,
  MinusCircle,
  MoreHorizontal,
  Music2,
  Play,
  Repeat1,
  Repeat2,
  RotateCcw,
  Save,
  Shuffle,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { EditableTrackTags, LibraryPlaylist, LibraryTrack, PlaybackHistoryEntry } from '../../shared/types/library';
import { likedChangedEvent, likedTracksChangedEvent, useLikedTrackIds } from '../hooks/useLikedMedia';
import type { QueueItem, RepeatMode } from '../stores/PlaybackQueueProvider';
import { useI18n } from '../i18n/I18nProvider';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { openAlbumDetailForTrack } from '../utils/albumNavigation';
import { resolvePlaylistForTrackAdd } from '../utils/appPrompt';
import { OsuTimingPanel } from '../components/library/OsuTimingPanel';
import { TrackContextMenu } from '../components/library/TrackContextMenu';
import type { TrackMenuAction } from '../components/library/TrackContextMenu';
import { TrackTagEditorDrawer } from '../components/library/TrackTagEditorDrawer';
import { getPageScrollContainer } from '../components/ui/InfiniteScrollSentinel';

const automixTemporarilyDisabled = false;
const randomQueuePageSize = 96;
const locateCurrentTrackEvent = 'app:locate-current-track';
const queuePageDragItemsMime = 'application/x-echo-next-queue-items';
const queuePagePerfWarnThresholdMs = 120;
const queuePageFirstPaintWarnThresholdMs = 250;
const queuePageDeferredTaskDelayMs = 120;
const queuePageDeferredTaskTimeoutMs = 800;

type QueuePagePerfValue = string | number | boolean | null | undefined;
type QueuePageIdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const formatQueuePagePerfValue = (value: QueuePagePerfValue): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'number' ? String(Math.round(value * 10) / 10) : String(value);
};

const logQueuePagePerf = (
  phase: string,
  startedAtMs: number,
  details: Record<string, QueuePagePerfValue> = {},
  options: { always?: boolean; warnThresholdMs?: number } = {},
): void => {
  const durationMs = performance.now() - startedAtMs;
  const warnThresholdMs = options.warnThresholdMs ?? queuePagePerfWarnThresholdMs;

  if (!options.always && durationMs < warnThresholdMs) {
    return;
  }

  const fields = Object.entries({ durationMs, ...details })
    .map(([key, value]) => {
      const text = formatQueuePagePerfValue(value);
      return text === null ? null : `${key}=${text}`;
    })
    .filter((value): value is string => Boolean(value));
  const message = `[queue-page-perf] ${phase}${fields.length ? ` ${fields.join(' ')}` : ''}`;

  if (durationMs >= warnThresholdMs) {
    console.warn(message);
  } else {
    console.info(message);
  }
};

const measureQueuePageWork = <T,>(
  phase: string,
  work: () => T,
  details: (result: T) => Record<string, QueuePagePerfValue> = () => ({}),
): T => {
  const startedAtMs = performance.now();
  const result = work();
  logQueuePagePerf(phase, startedAtMs, details(result));
  return result;
};

const deferQueuePageIdleTask = (callback: () => void): (() => void) => {
  const idleWindow = window as QueuePageIdleWindow;
  let didCancel = false;
  let idleHandle: number | null = null;
  let fallbackHandle: number | null = null;
  const delayHandle = window.setTimeout(() => {
    const run = (): void => {
      idleHandle = null;
      fallbackHandle = null;
      if (!didCancel) {
        callback();
      }
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(run, { timeout: queuePageDeferredTaskTimeoutMs });
      return;
    }

    fallbackHandle = window.setTimeout(run, 0);
  }, queuePageDeferredTaskDelayMs);

  return () => {
    didCancel = true;
    window.clearTimeout(delayHandle);
    if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === 'function') {
      idleWindow.cancelIdleCallback(idleHandle);
    }
    if (fallbackHandle !== null) {
      window.clearTimeout(fallbackHandle);
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

const formatSampleRate = (sampleRate: number | null): string | null => {
  if (!sampleRate) {
    return null;
  }

  const khz = sampleRate / 1000;
  return sampleRate >= 1000 ? `${Number.isInteger(khz) ? khz : khz.toFixed(1)}kHz` : `${sampleRate}Hz`;
};

const formatBitrate = (bitrate: number | null): string | null => {
  if (!bitrate || !Number.isFinite(bitrate)) {
    return null;
  }

  return bitrate >= 1000000 ? `${(bitrate / 1000000).toFixed(1)}Mbps` : `${Math.round(bitrate / 1000)}kbps`;
};

const qualityTags = (track: LibraryTrack | null): string[] =>
  track
    ? [
        track.codec?.toUpperCase() ?? null,
        track.bitDepth ? `${track.bitDepth}bit` : null,
        formatSampleRate(track.sampleRate),
        formatBitrate(track.bitrate),
      ].filter((tag): tag is string => Boolean(tag))
    : [];

const originalCoverUrlFromThumb = (coverUrl: string | null): string | null =>
  coverUrl?.replace(/^echo-cover:\/\/(?:thumb|album|large)\//u, 'echo-cover://original/') ?? null;

const queueNowCoverUrl = (track: Pick<LibraryTrack, 'coverId' | 'coverThumb'> | null): string | null =>
  track?.coverId ? `echo-cover://original/${encodeURIComponent(track.coverId)}` : originalCoverUrlFromThumb(track?.coverThumb ?? null);

const trackFromHistory = (entry: PlaybackHistoryEntry): LibraryTrack => ({
  id: entry.stableKey ?? entry.trackId ?? entry.id,
  mediaType: entry.mediaType,
  path: entry.mediaType === 'streaming' ? entry.stableKey ?? entry.trackPath : entry.trackPath,
  provider: entry.provider,
  providerTrackId: entry.providerTrackId,
  stableKey: entry.stableKey,
  title: entry.title,
  artist: entry.artist,
  album: entry.album,
  albumArtist: entry.albumArtist,
  trackNo: null,
  discNo: null,
  year: null,
  genre: null,
  duration: entry.durationSnapshot ?? entry.durationSeconds,
  codec: null,
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: entry.coverId,
  coverThumb: entry.coverSnapshot ?? entry.coverThumb,
  fieldSources: {},
});

type TrackMenuState = {
  track: LibraryTrack;
  position: { x: number; y: number };
};

type SavedQueueSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  currentTrackId: string | null;
  tracks: LibraryTrack[];
};

type QueueUndoSnapshot = {
  label: string;
  items: QueueItem[];
  currentQueueId: string | null;
  currentTrackId: string | null;
  selectedQueueIds: string[];
  removeAfterPlayQueueIds: string[];
};

type QueueActionNotice = {
  id: string;
  title: string;
  detail?: string;
  trackTitles?: string[];
  canUndo?: boolean;
};

const savedQueueStorageKey = 'echo-next:saved-queues';
const maxSavedQueueSnapshots = 12;
let queueActionNoticeId = 0;

const createQueueActionNotice = (
  title: string,
  options: Omit<QueueActionNotice, 'id' | 'title'> = {},
): QueueActionNotice => {
  queueActionNoticeId += 1;
  return {
    id: `queue-action-${queueActionNoticeId}`,
    title,
    ...options,
  };
};

const queueActionTrackTitles = (items: QueueItem[], limit = 4): string[] =>
  items.slice(0, limit).map((item) => item.track.title);

const queueActionTrackDetail = (items: QueueItem[], label = '首'): string | undefined => {
  const hiddenCount = Math.max(0, items.length - 4);
  return hiddenCount > 0 ? `还有 ${hiddenCount} ${label}` : undefined;
};

const isSavedQueueSnapshot = (value: unknown): value is SavedQueueSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Partial<SavedQueueSnapshot>;
  return (
    typeof snapshot.id === 'string' &&
    typeof snapshot.name === 'string' &&
    typeof snapshot.createdAt === 'string' &&
    Array.isArray(snapshot.tracks)
  );
};

const readSavedQueueSnapshots = (): SavedQueueSnapshot[] => {
  try {
    const raw = window.localStorage.getItem(savedQueueStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSavedQueueSnapshot).slice(0, maxSavedQueueSnapshots) : [];
  } catch {
    return [];
  }
};

const writeSavedQueueSnapshots = (snapshots: SavedQueueSnapshot[]): void => {
  try {
    window.localStorage.setItem(savedQueueStorageKey, JSON.stringify(snapshots.slice(0, maxSavedQueueSnapshots)));
  } catch {
    // Queue snapshots are convenience state only.
  }
};

const formatSavedQueueDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const isStreamingQueueTrack = (track: LibraryTrack): boolean =>
  track.mediaType === 'streaming' || Boolean(track.provider && track.providerTrackId);

const isRemoteQueueTrack = (track: LibraryTrack): boolean =>
  track.mediaType === 'remote' || Boolean(track.sourceId || track.remotePath || track.sourceDisplayName);

const isLocalQueueTrack = (track: LibraryTrack): boolean =>
  (track.mediaType ?? 'local') === 'local' && !isStreamingQueueTrack(track) && !isRemoteQueueTrack(track);

const buildQueuePlaylistTrackIds = (items: QueueItem[]): string[] =>
  items
    .map((item) => item.track)
    .filter((track) => track.isTemporary !== true && track.unavailable !== true && isLocalQueueTrack(track))
    .map((track) => track.id);

export const QueuePage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<QueueActionNotice | null>(null);
  const [savedQueues, setSavedQueues] = useState<SavedQueueSnapshot[]>([]);
  const [isGeneratingRandomQueue, setIsGeneratingRandomQueue] = useState(false);
  const [isGeneratingHistoryQueue, setIsGeneratingHistoryQueue] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedQueueId, setLastSelectedQueueId] = useState<string | null>(null);
  const [removeAfterPlayQueueIds, setRemoveAfterPlayQueueIds] = useState<Set<string>>(() => new Set());
  const [undoSnapshot, setUndoSnapshot] = useState<QueueUndoSnapshot | null>(null);
  const [recentQueueIds, setRecentQueueIds] = useState<Set<string>>(() => new Set());
  const [draggedQueueIds, setDraggedQueueIds] = useState<string[]>([]);
  const [dropTargetQueueId, setDropTargetQueueId] = useState<string | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [osuTimingTrack, setOsuTimingTrack] = useState<LibraryTrack | null>(null);
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const queueVirtualSpacerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const scrollMarginRef = useRef(0);
  const mountStartedAtRef = useRef(performance.now());
  const tagEditorCloseTimerRef = useRef<number | null>(null);
  const previousCurrentQueueIdRef = useRef<string | null>(null);
  const recentQueueTimerRef = useRef<number | null>(null);
  const currentIndex = useMemo(
    () =>
      measureQueuePageWork(
        'computeCurrentIndex',
        () => (queue.currentQueueId ? queue.items.findIndex((item) => item.queueId === queue.currentQueueId) : -1),
        (index) => ({ currentIndex: index, items: queue.items.length }),
      ),
    [queue.currentQueueId, queue.items],
  );
  const rows = useMemo(() => {
    return measureQueuePageWork(
      'computeRows',
      () => {
        if (queue.items.length === 0) {
          return [];
        }

        return currentIndex >= 0 ? queue.items.slice(currentIndex) : queue.items;
      },
      (computedRows) => ({ currentIndex, items: queue.items.length, rows: computedRows.length }),
    );
  }, [currentIndex, queue.items]);
  const upNextCount = currentIndex >= 0 ? Math.max(0, queue.items.length - currentIndex - 1) : queue.items.length;
  const selectedItems = useMemo(
    () => queue.items.filter((item) => selectedQueueIds.has(item.queueId)),
    [queue.items, selectedQueueIds],
  );
  const selectedCount = selectedItems.length;
  const selectedQueueIdList = useMemo(() => selectedItems.map((item) => item.queueId), [selectedItems]);
  const areAllRowsSelected = rows.length > 0 && rows.every((item) => selectedQueueIds.has(item.queueId));
  const canMoveSelectedAfterCurrent = selectedItems.some((item) => item.queueId !== queue.currentQueueId);
  const selectedRemoveAfterPlayCount = selectedItems.filter((item) => removeAfterPlayQueueIds.has(item.queueId)).length;
  const shouldUnmarkSelectedAfterPlay = selectedCount > 0 && selectedRemoveAfterPlayCount === selectedCount;
  const isRowSelectionVisible = isSelectionMode || selectedCount > 0;
  const nowPlaying = queue.currentTrack;
  const isNowPlayingTemporary = nowPlaying?.isTemporary === true;
  const nowPlayingTags = qualityTags(nowPlaying);
  const nowPlayingCoverUrl = queueNowCoverUrl(nowPlaying);
  const sourceLabel = queue.currentItem?.source.label ?? t('queue.now.sourceFallback');
  const queueMenuSource = useMemo(() => ({ type: 'manual' as const, label: t('queue.header.title') }), [t]);
  const nextQueuePreview = useMemo(() => {
    if (queue.repeatMode === 'one' && nowPlaying) {
      return {
        kind: 'repeat-one',
        title: nowPlaying.title,
        detail: t('queue.nextPreview.repeatOneDetail'),
      };
    }

    if (queue.isShuffleEnabled) {
      return {
        kind: 'shuffle',
        title: t('queue.nextPreview.shuffleTitle'),
        detail: t('queue.nextPreview.shuffleDetail', {
          scope: queue.shuffleScopeLabel,
          count: queue.playbackShuffleAvoidRecentCount,
        }),
      };
    }

    const nextItem = currentIndex >= 0
      ? queue.items[currentIndex + 1] ?? (queue.repeatMode === 'all' && queue.items.length > 1 ? queue.items[0] : null)
      : queue.items[0] ?? null;

    if (!nextItem) {
      return {
        kind: 'empty',
        title: t('queue.nextPreview.empty'),
      };
    }

    return {
      kind: 'track',
      title: nextItem.track.title,
      detail: t('queue.nextPreview.trackDetail', {
        artist: nextItem.track.artist || nextItem.track.albumArtist || t('queue.unknownArtist'),
        source: nextItem.source.label,
      }),
    };
  }, [
    currentIndex,
    nowPlaying,
    queue.isShuffleEnabled,
    queue.items,
    queue.playbackShuffleAvoidRecentCount,
    queue.repeatMode,
    queue.shuffleScopeLabel,
    t,
  ]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => getPageScrollContainer(queueVirtualSpacerRef.current),
    estimateSize: () => 64,
    overscan: 12,
    scrollMargin,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstPaintDetailsRef = useRef<Record<string, QueuePagePerfValue>>({});
  firstPaintDetailsRef.current = {
    items: queue.items.length,
    rows: rows.length,
    savedQueues: savedQueues.length,
    virtualRows: virtualRows.length,
  };
  const likedTrackIdsInput = useMemo(
    () =>
      measureQueuePageWork(
        'computeLikedTrackIdsInput',
        () => {
          const ids = new Set<string>();

          if (nowPlaying && !isNowPlayingTemporary) {
            ids.add(nowPlaying.id);
          }

          if (trackMenu && !trackMenu.track.isTemporary) {
            ids.add(trackMenu.track.id);
          }

          for (const virtualRow of virtualRows) {
            const track = rows[virtualRow.index]?.track;
            if (track && !track.isTemporary) {
              ids.add(track.id);
            }
          }

          return Array.from(ids);
        },
        (ids) => ({ ids: ids.length, rows: rows.length, virtualRows: virtualRows.length }),
      ),
    [isNowPlayingTemporary, nowPlaying, rows, trackMenu, virtualRows],
  );
  const likedTrackIds = useLikedTrackIds(likedTrackIdsInput);
  const isNowPlayingLiked = nowPlaying && !isNowPlayingTemporary ? likedTrackIds[nowPlaying.id] === true : false;

  useLayoutEffect(() => {
    const calculateScrollMargin = (): void => {
      const spacer = queueVirtualSpacerRef.current;
      const scrollContainer = getPageScrollContainer(spacer);

      if (!spacer || !scrollContainer) {
        if (scrollMarginRef.current !== 0) {
          scrollMarginRef.current = 0;
          setScrollMargin(0);
        }
        return;
      }

      const spacerRect = spacer.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const nextScrollMargin = Math.max(0, Math.round(spacerRect.top - containerRect.top + scrollContainer.scrollTop));
      if (scrollMarginRef.current !== nextScrollMargin) {
        scrollMarginRef.current = nextScrollMargin;
        setScrollMargin(nextScrollMargin);
      }
    };

    calculateScrollMargin();
    window.addEventListener('resize', calculateScrollMargin);
    return () => window.removeEventListener('resize', calculateScrollMargin);
  }, [rows.length, savedQueues.length]);

  useEffect(() => {
    return deferQueuePageIdleTask(() => {
      const startedAtMs = performance.now();
      const snapshots = readSavedQueueSnapshots();
      setSavedQueues(snapshots);
      logQueuePagePerf('loadSavedQueues', startedAtMs, { snapshots: snapshots.length }, { always: snapshots.length > 0 });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (recentQueueTimerRef.current !== null) {
        window.clearTimeout(recentQueueTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const logFirstPaint = (): void => {
      logQueuePagePerf(
        'firstPaint',
        mountStartedAtRef.current,
        firstPaintDetailsRef.current,
        { always: true, warnThresholdMs: queuePageFirstPaintWarnThresholdMs },
      );
    };

    if (typeof window.requestAnimationFrame === 'function') {
      const frameId = window.requestAnimationFrame(logFirstPaint);
      return () => window.cancelAnimationFrame(frameId);
    }

    const timeoutId = window.setTimeout(logFirstPaint, 16);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const handleLocateCurrentTrack = (): void => {
      const currentRowIndex = rows.findIndex((item) =>
        queue.currentQueueId ? item.queueId === queue.currentQueueId : item.track.id === queue.currentTrackId,
      );
      if (currentRowIndex < 0) {
        return;
      }

      rowVirtualizer.scrollToIndex(currentRowIndex, { align: 'center' });
    };

    window.addEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
    return () => window.removeEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
  }, [queue.currentQueueId, queue.currentTrackId, rowVirtualizer, rows]);

  useEffect(() => {
    const validQueueIds = new Set(queue.items.map((item) => item.queueId));

    setSelectedQueueIds((current) => {
      const next = new Set(Array.from(current).filter((queueId) => validQueueIds.has(queueId)));
      return next.size === current.size ? current : next;
    });
    setRemoveAfterPlayQueueIds((current) => {
      const next = new Set(Array.from(current).filter((queueId) => validQueueIds.has(queueId)));
      return next.size === current.size ? current : next;
    });
  }, [queue.items]);

  useEffect(() => {
    if (rows.length === 0 && isSelectionMode) {
      setIsSelectionMode(false);
    }
  }, [isSelectionMode, rows.length]);

  useEffect(() => {
    const previousQueueId = previousCurrentQueueIdRef.current;
    const currentQueueId = queue.currentQueueId;
    previousCurrentQueueIdRef.current = currentQueueId;

    if (!previousQueueId || previousQueueId === currentQueueId || !removeAfterPlayQueueIds.has(previousQueueId)) {
      return;
    }

    const removedItem = queue.items.find((item) => item.queueId === previousQueueId) ?? null;
    setRemoveAfterPlayQueueIds((current) => {
      const next = new Set(current);
      next.delete(previousQueueId);
      return next;
    });
    queue.removeQueueItem(previousQueueId);
    setActionNotice(createQueueActionNotice('已移除播放完成的队列项', {
      trackTitles: removedItem ? [removedItem.track.title] : undefined,
    }));
  }, [queue.currentQueueId, queue.items, queue.removeQueueItem, removeAfterPlayQueueIds]);

  const repeatLabels: Record<RepeatMode, string> = useMemo(
    () => ({
      off: t('queue.repeat.off'),
      one: t('queue.repeat.one'),
      all: t('queue.repeat.all'),
    }),
    [t],
  );

  const flashQueueItems = useCallback((queueIds: string[]): void => {
    if (recentQueueTimerRef.current !== null) {
      window.clearTimeout(recentQueueTimerRef.current);
      recentQueueTimerRef.current = null;
    }

    const nextIds = Array.from(new Set(queueIds));
    if (nextIds.length === 0) {
      setRecentQueueIds(new Set());
      return;
    }

    setRecentQueueIds(new Set(nextIds));
    recentQueueTimerRef.current = window.setTimeout(() => {
      setRecentQueueIds(new Set());
      recentQueueTimerRef.current = null;
    }, 1400);
  }, []);

  const runQueueAction = useCallback(async (action: () => Promise<unknown> | unknown): Promise<void> => {
    try {
      setActionError(null);
      setActionNotice(null);
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const updateSavedQueues = useCallback((updater: (current: SavedQueueSnapshot[]) => SavedQueueSnapshot[]): void => {
    setSavedQueues((current) => {
      const next = updater(current).slice(0, maxSavedQueueSnapshots);
      writeSavedQueueSnapshots(next);
      return next;
    });
  }, []);

  const handleSaveQueueSnapshot = useCallback((): void => {
    if (queue.items.length === 0) {
      setActionError('当前队列为空，暂时没有可保存的内容。');
      return;
    }

    const createdAt = new Date().toISOString();
    const name = nowPlaying?.title ? `${nowPlaying.title} 等 ${queue.items.length} 首` : `队列 ${formatSavedQueueDate(createdAt)}`;
    const snapshot: SavedQueueSnapshot = {
      id: `queue-${Date.now()}`,
      name,
      createdAt,
      currentTrackId: queue.currentTrackId,
      tracks: queue.items.map((item) => item.track),
    };

    updateSavedQueues((current) => [snapshot, ...current]);
    setActionError(null);
    setActionNotice(createQueueActionNotice('已保存队列', { detail: name }));
  }, [nowPlaying?.title, queue.currentTrackId, queue.items, updateSavedQueues]);

  const handleRestoreSavedQueue = useCallback(
    (snapshot: SavedQueueSnapshot): void => {
      if (snapshot.tracks.length === 0) {
        setActionError('这个队列快照没有可恢复的歌曲。');
        return;
      }

      setSelectedQueueIds(new Set());
      setLastSelectedQueueId(null);
      setIsSelectionMode(false);
      queue.replaceQueue(snapshot.tracks, {
        startTrackId: snapshot.currentTrackId ?? snapshot.tracks[0]?.id,
        source: { type: 'manual', label: `保存队列：${snapshot.name}` },
      });
      setActionError(null);
      setActionNotice(createQueueActionNotice('已恢复队列', { detail: snapshot.name }));
    },
    [queue],
  );

  const handleDeleteSavedQueue = useCallback(
    (snapshotId: string): void => {
      updateSavedQueues((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
      setActionError(null);
      setActionNotice(createQueueActionNotice('已删除队列快照'));
    },
    [updateSavedQueues],
  );

  const captureQueueUndo = useCallback(
    (label: string): void => {
      setUndoSnapshot({
        label,
        items: queue.items,
        currentQueueId: queue.currentQueueId,
        currentTrackId: queue.currentTrackId,
        selectedQueueIds: Array.from(selectedQueueIds),
        removeAfterPlayQueueIds: Array.from(removeAfterPlayQueueIds),
      });
    },
    [queue.currentQueueId, queue.currentTrackId, queue.items, removeAfterPlayQueueIds, selectedQueueIds],
  );

  const handleUndoQueueAction = useCallback((): void => {
    if (!undoSnapshot) {
      return;
    }

    queue.restoreQueueItems(undoSnapshot.items, {
      currentQueueId: undoSnapshot.currentQueueId,
      currentTrackId: undoSnapshot.currentTrackId,
    });
    setSelectedQueueIds(new Set(undoSnapshot.selectedQueueIds));
    setIsSelectionMode(undoSnapshot.selectedQueueIds.length > 0);
    setRemoveAfterPlayQueueIds(new Set(undoSnapshot.removeAfterPlayQueueIds));
    setUndoSnapshot(null);
    setActionError(null);
    flashQueueItems(undoSnapshot.selectedQueueIds.length > 0 ? undoSnapshot.selectedQueueIds : undoSnapshot.items.map((item) => item.queueId));
    setActionNotice(createQueueActionNotice('已撤销', { detail: undoSnapshot.label }));
  }, [flashQueueItems, queue, undoSnapshot]);

  const handleToggleVisibleSelection = useCallback((): void => {
    if (!isRowSelectionVisible) {
      setIsSelectionMode(true);
      return;
    }

    setSelectedQueueIds((current) => {
      const next = new Set(current);
      if (areAllRowsSelected) {
        rows.forEach((item) => next.delete(item.queueId));
      } else {
        rows.forEach((item) => next.add(item.queueId));
      }
      return next;
    });
    setIsSelectionMode(!areAllRowsSelected);
    setLastSelectedQueueId(null);
  }, [areAllRowsSelected, isRowSelectionVisible, rows]);

  const handleToggleQueueSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>, item: QueueItem): void => {
      const checked = event.currentTarget.checked;
      const shiftKey = (event.nativeEvent as globalThis.MouseEvent).shiftKey === true;

      setSelectedQueueIds((current) => {
        const next = new Set(current);
        const rowIds = rows.map((row) => row.queueId);
        const lastIndex = lastSelectedQueueId ? rowIds.indexOf(lastSelectedQueueId) : -1;
        const currentIndex = rowIds.indexOf(item.queueId);

        if (shiftKey && lastIndex >= 0 && currentIndex >= 0) {
          const [start, end] = lastIndex < currentIndex ? [lastIndex, currentIndex] : [currentIndex, lastIndex];
          for (const queueId of rowIds.slice(start, end + 1)) {
            if (checked) {
              next.add(queueId);
            } else {
              next.delete(queueId);
            }
          }
        } else if (checked) {
          next.add(item.queueId);
        } else {
          next.delete(item.queueId);
        }

        return next;
      });
      setLastSelectedQueueId(item.queueId);
    },
    [lastSelectedQueueId, rows],
  );

  const handleClearSelection = useCallback((): void => {
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
  }, []);

  const handleDismissActionNotice = useCallback((): void => {
    setActionNotice(null);
  }, []);

  const handleClearQueue = useCallback((): void => {
    if (queue.items.length === 0) {
      return;
    }

    if (!window.confirm(t('queue.confirm.clear', { count: queue.items.length }))) {
      return;
    }

    const removedItems = queue.items;
    captureQueueUndo(`清空 ${removedItems.length} 首`);
    queue.clearQueue();
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    setRemoveAfterPlayQueueIds(new Set());
    setActionError(null);
    setActionNotice(createQueueActionNotice(`已清空 ${removedItems.length} 首`, {
      detail: queueActionTrackDetail(removedItems) ?? '可撤销',
      trackTitles: queueActionTrackTitles(removedItems),
      canUndo: true,
    }));
  }, [captureQueueUndo, queue, t]);

  const handleRemoveQueueItem = useCallback(
    (item: QueueItem): void => {
      captureQueueUndo(`移除 ${item.track.title}`);
      queue.removeQueueItem(item.queueId);
      setSelectedQueueIds((current) => {
        const next = new Set(current);
        next.delete(item.queueId);
        if (next.size === 0) {
          setIsSelectionMode(false);
        }
        return next;
      });
      setRemoveAfterPlayQueueIds((current) => {
        const next = new Set(current);
        next.delete(item.queueId);
        return next;
      });
      setLastSelectedQueueId((current) => (current === item.queueId ? null : current));
      setActionError(null);
      setActionNotice(createQueueActionNotice('已从队列移除', {
        trackTitles: [item.track.title],
        canUndo: true,
      }));
    },
    [captureQueueUndo, queue],
  );

  const handleRemoveSelected = useCallback((): void => {
    if (selectedCount === 0) {
      return;
    }

    const removedItems = selectedItems;
    captureQueueUndo(`移除 ${selectedCount} 首`);
    queue.removeQueueItems(selectedQueueIdList);
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    setActionError(null);
    setActionNotice(createQueueActionNotice(`已移除 ${selectedCount} 首`, {
      detail: queueActionTrackDetail(removedItems) ?? '可撤销',
      trackTitles: queueActionTrackTitles(removedItems),
      canUndo: true,
    }));
  }, [captureQueueUndo, queue, selectedCount, selectedItems, selectedQueueIdList]);

  const handleMoveSelectedAfterCurrent = useCallback((): void => {
    if (selectedCount === 0 || !canMoveSelectedAfterCurrent) {
      return;
    }

    const movedItems = selectedItems;
    captureQueueUndo(`临时插播 ${selectedCount} 首`);
    queue.moveQueueItemsAfterCurrent(selectedQueueIdList);
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    flashQueueItems(selectedQueueIdList);
    setActionError(null);
    setActionNotice(createQueueActionNotice(`已临时插播 ${selectedCount} 首`, {
      detail: queueActionTrackDetail(movedItems) ?? '已经排到当前播放后面',
      trackTitles: queueActionTrackTitles(movedItems),
      canUndo: true,
    }));
  }, [canMoveSelectedAfterCurrent, captureQueueUndo, flashQueueItems, queue, selectedCount, selectedItems, selectedQueueIdList]);

  const handleToggleSelectedRemoveAfterPlay = useCallback((): void => {
    if (selectedCount === 0) {
      return;
    }

    setRemoveAfterPlayQueueIds((current) => {
      const next = new Set(current);
      for (const queueId of selectedQueueIdList) {
        if (shouldUnmarkSelectedAfterPlay) {
          next.delete(queueId);
        } else {
          next.add(queueId);
        }
      }
      return next;
    });
    flashQueueItems(selectedQueueIdList);
    setActionError(null);
    setActionNotice(createQueueActionNotice(
      shouldUnmarkSelectedAfterPlay ? '已取消播放后移除' : `已标记 ${selectedCount} 首播放后移除`,
      {
        detail: queueActionTrackDetail(selectedItems),
        trackTitles: queueActionTrackTitles(selectedItems),
      },
    ));
  }, [flashQueueItems, selectedCount, selectedItems, selectedQueueIdList, shouldUnmarkSelectedAfterPlay]);

  const handleSaveQueueAsPlaylist = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.createPlaylist || !library.addTracksToPlaylist) {
      setActionError('桌面桥接不可用，暂时不能保存为歌单。');
      return;
    }

    const trackIds = buildQueuePlaylistTrackIds(queue.items);

    if (trackIds.length === 0) {
      setActionError('当前队列没有可保存到本地歌单的已入库歌曲。');
      return;
    }

    let createdPlaylistId: string | null = null;
    try {
      setActionError(null);
      setActionNotice(null);
      const playlist = await library.createPlaylist({
        name: `队列 ${formatSavedQueueDate(new Date().toISOString())}`,
        description: '从播放队列保存。',
      });
      createdPlaylistId = playlist.id;
      const items = await library.addTracksToPlaylist(playlist.id, trackIds);
      const savedCount = items.length;

      if (savedCount === 0) {
        throw new Error('没有歌曲被写入歌单。');
      }

      window.dispatchEvent(new Event('library:playlists-changed'));
      setActionNotice(createQueueActionNotice('已保存为歌单', { detail: `${playlist.name}（${savedCount} 首）` }));
    } catch (error) {
      if (createdPlaylistId && library.deletePlaylist) {
        await library.deletePlaylist(createdPlaylistId).catch(() => undefined);
      }
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [queue.items]);

  const handleOpenCurrentFolder = useCallback((): void => {
    if (!nowPlaying) {
      return;
    }

    void runQueueAction(() =>
      nowPlaying.isTemporary
        ? window.echo?.library?.openPathInFolder?.(nowPlaying.path)
        : window.echo?.library?.openTrackInFolder(nowPlaying.id),
    );
  }, [nowPlaying, runQueueAction]);

  const handleToggleNowPlayingLiked = useCallback((): void => {
    if (!nowPlaying || nowPlaying.isTemporary) {
      return;
    }

    void runQueueAction(async () => {
      await window.echo?.library?.toggleTrackLiked(nowPlaying.id);
      window.dispatchEvent(new Event(likedTracksChangedEvent));
      window.dispatchEvent(new Event(likedChangedEvent));
    });
  }, [nowPlaying, runQueueAction]);

  const handleOpenTrackMenu = useCallback((track: LibraryTrack, position: { x: number; y: number }): void => {
    setTrackMenu({ track, position });
  }, []);

  const handleTrackContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, track: LibraryTrack): void => {
      event.preventDefault();
      event.stopPropagation();
      handleOpenTrackMenu(track, { x: event.clientX, y: event.clientY });
    },
    [handleOpenTrackMenu],
  );

  const handleNowPlayingMoreClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      if (!nowPlaying) {
        return;
      }

      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      handleOpenTrackMenu(nowPlaying, { x: rect.right - 12, y: rect.bottom + 8 });
    },
    [handleOpenTrackMenu, nowPlaying],
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
        setTagEditorError('Desktop bridge unavailable. Open ECHO Next in Electron to edit embedded tags.');
        return;
      }

      setIsSavingTags(true);
      setTagEditorError(null);

      try {
        const updatedTrack = await library.updateTrackTags({ trackId: track.id, tags, coverPath, coverUrl, coverMimeType });
        queue.updateTrackSnapshot(updatedTrack.id, updatedTrack);
        window.dispatchEvent(new Event('library:changed'));
        closeTagEditor();
      } catch (saveError) {
        setTagEditorError(saveError instanceof Error ? saveError.message : String(saveError));
      } finally {
        setIsSavingTags(false);
      }
    },
    [closeTagEditor, queue],
  );

  const handleTrackMenuAction = useCallback(
    async (action: TrackMenuAction, track: LibraryTrack, playlistTarget?: LibraryPlaylist): Promise<void> => {
      const library = window.echo?.library;
      setTrackMenu(null);

      if (action === 'clear-lyrics-cache') {
        const lyricsApi = window.echo?.lyrics;
        if (!lyricsApi?.clearCache) {
          setActionError('Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.');
          return;
        }

        try {
          setActionError(null);
          await lyricsApi.clearCache(track.id);
          window.dispatchEvent(new CustomEvent('lyrics:rematch-requested', { detail: { trackId: track.id } }));
        } catch (actionError) {
          setActionError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        return;
      }

      if (!library && action !== 'play-next' && action !== 'add-to-queue' && action !== 'remove-from-queue' && action !== 'open-osu-timing' && action !== 'reload-embedded-tags') {
        setActionError('Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.');
        return;
      }

      try {
        setActionError(null);

        if (
          (track.mediaType === 'remote' || track.isTemporary) &&
          (action === 'edit-tags' ||
            action === 'reload-embedded-tags' ||
            action === 'open-osu-timing' ||
            action === 'copy-path' ||
            action === 'open-system' ||
            action === 'copy-cover' ||
            action === 'save-cover' ||
            action === 'delete-song')
        ) {
          setActionError('This queued item does not support library file actions.');
          return;
        }

        switch (action) {
          case 'play-next':
            captureQueueUndo(t('queue.notice.addedToNext'));
            queue.playTrackNext(track, queueMenuSource);
            setActionNotice(createQueueActionNotice(t('queue.notice.addedToNext'), {
              detail: t('queue.notice.nextDetail'),
              trackTitles: [track.title],
              canUndo: true,
            }));
            return;
          case 'add-to-queue':
            captureQueueUndo(t('queue.notice.addedToTail'));
            queue.appendToQueue(track, queueMenuSource);
            setActionNotice(createQueueActionNotice(t('queue.notice.addedToTail'), {
              detail: t('queue.notice.tailDetail'),
              trackTitles: [track.title],
              canUndo: true,
            }));
            return;
          case 'toggle-liked':
            if (track.isTemporary) {
              setActionError('Temporary local files cannot be liked until they are imported.');
              return;
            }
            await library?.toggleTrackLiked(track.id);
            window.dispatchEvent(new Event(likedTracksChangedEvent));
            window.dispatchEvent(new Event(likedChangedEvent));
            return;
          case 'remove-from-queue':
            {
              const matchingItems = queue.items.filter((item) => item.track.id === track.id);
              if (matchingItems.length === 0) {
                return;
              }
              captureQueueUndo(`移除 ${track.title}`);
              const removedCount = queue.removeTrackFromQueue(track.id);
              setActionNotice(createQueueActionNotice(t('queue.notice.removedMatches', { count: removedCount }), {
                trackTitles: queueActionTrackTitles(matchingItems),
                canUndo: true,
              }));
            }
            return;
          case 'open-osu-timing':
            setOsuTimingTrack(track);
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
              queue.updateTrackSnapshot(result.track.id, result.track);
              if (editingTrack?.id === result.track.id) {
                setEditingTrack(result.track);
              }
              setActionError(null);
              window.dispatchEvent(new Event('library:changed'));
            }
            return;
          case 'go-to-album':
            if (!(await openAlbumDetailForTrack(track))) {
              setActionError(`Album not found: ${track.album || 'Unknown Album'}`);
            }
            return;
          case 'show-in-folder':
            if (track.isTemporary) {
              await library?.openPathInFolder?.(track.path);
              return;
            }
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
              setActionError('This track does not have cover art to copy.');
            }
            return;
          case 'save-cover':
            if (!(await library?.saveTrackCover(track.id))) {
              setActionError('No cover art was saved for this track.');
            }
            return;
          case 'delete-song':
            if (!window.confirm(`Delete the music file?\n${track.title}`)) {
              return;
            }
            await library?.deleteTrackFile(track.id);
            queue.removeTrackFromQueue(track.id);
            window.dispatchEvent(new Event('library:changed'));
            return;
          case 'add-to-playlist':
            {
              if (track.mediaType === 'streaming') {
                setActionError('流媒体歌曲不能加入本地歌单，请在流媒体歌单中单独管理。');
                return;
              }

              const playlist = playlistTarget ?? (await resolvePlaylistForTrackAdd(library!));
              if (!playlist) {
                return;
              }

              await library!.addTrackToPlaylist(playlist.id, track.id);
              window.dispatchEvent(new Event('library:playlists-changed'));
            }
            return;
          default:
            setActionError('This track action is not available yet.');
        }
      } catch (actionError) {
        setActionError(actionError instanceof Error ? actionError.message : String(actionError));
      }
    },
    [captureQueueUndo, editingTrack, queue, queueMenuSource, t],
  );

  const handlePlayItemNext = useCallback(
    (item: QueueItem): void => {
      const fromIndex = queue.items.findIndex((queuedItem) => queuedItem.queueId === item.queueId);
      const activeIndex = queue.currentQueueId ? queue.items.findIndex((queuedItem) => queuedItem.queueId === queue.currentQueueId) : -1;

      if (fromIndex < 0 || fromIndex === activeIndex) {
        return;
      }

      captureQueueUndo(`插播 ${item.track.title}`);
      queue.moveQueueItem(fromIndex, activeIndex >= 0 ? (fromIndex < activeIndex ? activeIndex : activeIndex + 1) : 0);
      flashQueueItems([item.queueId]);
      setActionError(null);
      setActionNotice(createQueueActionNotice('已插到下一首', {
        trackTitles: [item.track.title],
        canUndo: true,
      }));
    },
    [captureQueueUndo, flashQueueItems, queue],
  );

  const handleGenerateRandomQueue = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      setActionError(t('queue.error.desktopBridge'));
      return;
    }

    setIsGeneratingRandomQueue(true);
    setActionError(null);

    try {
      const result = await library.getTracks({
        page: 1,
        pageSize: randomQueuePageSize,
        sort: 'random',
        randomWindow: true,
      });

      if (result.items.length === 0) {
        setActionError(t('queue.error.noRandomTracks'));
        return;
      }

      setSelectedQueueIds(new Set());
      setLastSelectedQueueId(null);
      setIsSelectionMode(false);
      queue.replaceQueue(result.items, {
        source: { type: 'songs', label: t('queue.randomSource'), sort: 'random' },
      });
      queue.setRepeatMode('off');
      if (queue.isShuffleEnabled) {
        queue.toggleShuffle();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingRandomQueue(false);
    }
  }, [queue, t]);

  const handleGenerateHistoryQueue = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;

    if (!library) {
      setActionError(t('queue.error.desktopBridge'));
      return;
    }

    setIsGeneratingHistoryQueue(true);
    setActionError(null);

    try {
      const result = await library.getPlaybackHistory({
        page: 1,
        pageSize: 500,
      });
      const tracks = result.items.map(trackFromHistory);

      if (tracks.length === 0) {
        setActionError(t('queue.error.noHistoryTracks'));
        return;
      }

      setSelectedQueueIds(new Set());
      setLastSelectedQueueId(null);
      setIsSelectionMode(false);
      queue.replaceQueue(tracks, {
        source: { type: 'manual', label: t('queue.historySource') },
      });
      queue.setRepeatMode('off');
      if (queue.isShuffleEnabled) {
        queue.toggleShuffle();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingHistoryQueue(false);
    }
  }, [queue, t]);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, item: QueueItem): void => {
      const queueIds = selectedQueueIds.has(item.queueId) && selectedCount > 1
        ? selectedQueueIdList
        : [item.queueId];
      setDraggedQueueIds(queueIds);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(queuePageDragItemsMime, JSON.stringify(queueIds));
      event.dataTransfer.setData('text/plain', item.queueId);
    },
    [selectedCount, selectedQueueIdList, selectedQueueIds],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>, item: QueueItem): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetQueueId(item.queueId);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetItem: QueueItem): void => {
      event.preventDefault();
      const serializedQueueIds = event.dataTransfer.getData(queuePageDragItemsMime);
      const fallbackQueueId = event.dataTransfer.getData('text/plain');
      let sourceQueueIds: string[] = draggedQueueIds;

      if (serializedQueueIds) {
        try {
          const parsed = JSON.parse(serializedQueueIds) as unknown;
          if (Array.isArray(parsed)) {
            sourceQueueIds = parsed.filter((queueId): queueId is string => typeof queueId === 'string');
          }
        } catch {
          sourceQueueIds = [];
        }
      }

      if (sourceQueueIds.length === 0 && fallbackQueueId) {
        sourceQueueIds = [fallbackQueueId];
      }

      setDraggedQueueIds([]);
      setDropTargetQueueId(null);

      const movableQueueIds = Array.from(new Set(sourceQueueIds)).filter((queueId) =>
        queue.items.some((item) => item.queueId === queueId),
      );

      if (movableQueueIds.length === 0 || movableQueueIds.includes(targetItem.queueId)) {
        return;
      }

      const toIndex = queue.items.findIndex((item) => item.queueId === targetItem.queueId);

      if (toIndex < 0) {
        return;
      }

      const movedItems = queue.items.filter((item) => movableQueueIds.includes(item.queueId));
      captureQueueUndo(`移动 ${movableQueueIds.length} 首`);
      queue.moveQueueItemsToIndex(movableQueueIds, toIndex);
      flashQueueItems(movableQueueIds);
      setActionError(null);
      setActionNotice(createQueueActionNotice(`已移动 ${movableQueueIds.length} 首`, {
        detail: queueActionTrackDetail(movedItems),
        trackTitles: queueActionTrackTitles(movedItems),
        canUndo: true,
      }));
    },
    [captureQueueUndo, draggedQueueIds, flashQueueItems, queue],
  );

  const handleDragEnd = useCallback((): void => {
    setDraggedQueueIds([]);
    setDropTargetQueueId(null);
  }, []);

  return (
    <div className="queue-page">
      <header className="queue-page-header">
        <div>
          <span className="queue-kicker">{t('queue.header.kicker')}</span>
          <h1>{t('queue.header.title')}</h1>
        </div>
        <span className="queue-count">{t('queue.count', { count: queue.items.length })}</span>
      </header>

      <section className="queue-now-card" aria-label={t('queue.now.kicker')}>
        <div className="queue-now-cover" data-empty={!nowPlayingCoverUrl}>
          {nowPlayingCoverUrl ? <img alt="" src={nowPlayingCoverUrl} /> : <Disc3 size={54} />}
        </div>

        <div className="queue-now-main">
          <span className="queue-kicker">{t('queue.now.kicker')}</span>
          <h2>{nowPlaying?.title ?? t('queue.now.emptyTitle')}</h2>
          <p>{nowPlaying ? `${nowPlaying.artist || t('queue.unknownArtist')} - ${nowPlaying.album || t('queue.unknownAlbum')}` : t('queue.now.emptyDescription')}</p>

          <div className="queue-quality-row" aria-label={t('queue.now.quality')}>
            {nowPlayingTags.length > 0 ? nowPlayingTags.map((tag) => <span key={tag}>{tag}</span>) : <span>{t('queue.now.waitingAudio')}</span>}
          </div>

          <div className="queue-now-meta">
            <span>{nowPlaying ? formatDuration(nowPlaying.duration) : '--:--'}</span>
            <span>{sourceLabel}</span>
          </div>

          <div className="queue-next-preview" data-kind={nextQueuePreview.kind} aria-label={t('queue.nextPreview.kicker')}>
            <span>{t('queue.nextPreview.kicker')}</span>
            <strong>{nextQueuePreview.title}</strong>
            {nextQueuePreview.detail ? <small>{nextQueuePreview.detail}</small> : null}
          </div>
        </div>

        <div className="queue-now-actions" aria-label={t('queue.now.actions')}>
          <button
            className={`queue-icon-button ${isNowPlayingLiked ? 'is-liked' : ''}`}
            type="button"
            aria-label={t('queue.action.like')}
            aria-pressed={isNowPlayingLiked}
            title={t('queue.action.like')}
            disabled={!nowPlaying || isNowPlayingTemporary}
            onClick={handleToggleNowPlayingLiked}
          >
            <Heart size={17} fill={isNowPlayingLiked ? 'currentColor' : 'none'} />
          </button>
          <button
            className="queue-icon-button"
            type="button"
            aria-label={t('queue.action.openFolder')}
            title={t('queue.action.openFolder')}
            disabled={!nowPlaying}
            onClick={handleOpenCurrentFolder}
          >
            <FolderOpen size={17} />
          </button>
          <button
            className="queue-icon-button"
            type="button"
            aria-label={t('queue.action.more')}
            title={t('queue.action.more')}
            disabled={!nowPlaying}
            onClick={handleNowPlayingMoreClick}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </section>

      <section className="queue-toolbar" aria-label={t('queue.tools')}>
        <button className={`queue-tool-button ${queue.isShuffleEnabled ? 'is-active' : ''}`} type="button" aria-pressed={queue.isShuffleEnabled} onClick={queue.toggleShuffle}>
          <Shuffle size={16} />
          {t('queue.action.shuffle')}
        </button>
        <button className="queue-tool-button" type="button" disabled={isGeneratingRandomQueue} onClick={() => void handleGenerateRandomQueue()}>
          <Shuffle size={16} />
          {isGeneratingRandomQueue ? t('queue.action.generatingRandom') : t('queue.action.generateRandom')}
        </button>
        <button className="queue-tool-button" type="button" disabled={isGeneratingHistoryQueue} onClick={() => void handleGenerateHistoryQueue()}>
          <History size={16} />
          {isGeneratingHistoryQueue ? t('queue.action.generatingHistory') : t('queue.action.generateFromHistory')}
        </button>
        <button
          className={`queue-tool-button ${queue.autoFillQueueEnabled ? 'is-active' : ''}`}
          type="button"
          aria-pressed={queue.autoFillQueueEnabled}
          onClick={() => queue.setAutoFillQueueEnabled(!queue.autoFillQueueEnabled)}
        >
          <ListPlus size={16} />
          {t('queue.action.autoFill')}
        </button>
        <button
          className={`queue-tool-button ${!automixTemporarilyDisabled && queue.automixEnabled ? 'is-active' : ''}`}
          type="button"
          aria-pressed={!automixTemporarilyDisabled && queue.automixEnabled}
          disabled={automixTemporarilyDisabled}
          title={automixTemporarilyDisabled ? 'Automix 暂时禁用' : undefined}
          onClick={() => queue.setAutomixEnabled(!queue.automixEnabled)}
        >
          <Wand2 size={16} />
          Automix 实验
        </button>
        <button className="queue-tool-button" type="button" disabled={queue.items.length === 0} onClick={handleSaveQueueSnapshot}>
          <Save size={16} />
          保存队列
        </button>
        <button className="queue-tool-button" type="button" disabled={savedQueues.length === 0} onClick={() => savedQueues[0] ? handleRestoreSavedQueue(savedQueues[0]) : undefined}>
          <RotateCcw size={16} />
          恢复上次队列
        </button>
        <button className="queue-tool-button" type="button" disabled={queue.items.length === 0} onClick={() => void handleSaveQueueAsPlaylist()}>
          <Music2 size={16} />
          保存为歌单
        </button>
        <div className="queue-repeat-group" aria-label={t('queue.repeat.mode')}>
          {(['off', 'one', 'all'] as RepeatMode[]).map((mode) => (
            <button
              className={queue.repeatMode === mode ? 'is-active' : ''}
              key={mode}
              type="button"
              aria-pressed={queue.repeatMode === mode}
              onClick={() => queue.setRepeatMode(mode)}
            >
              {mode === 'off' ? <MinusCircle size={15} /> : mode === 'one' ? <Repeat1 size={15} /> : <Repeat2 size={15} />}
              {repeatLabels[mode]}
            </button>
          ))}
        </div>
        <button className="queue-tool-button danger" type="button" disabled={queue.items.length === 0} onClick={handleClearQueue}>
          <Trash2 size={16} />
          {t('queue.action.clear')}
        </button>
      </section>

      <section className="queue-selection-bar" aria-label="队列批量操作">
        <button className="queue-tool-button" type="button" disabled={rows.length === 0} onClick={handleToggleVisibleSelection}>
          {!isRowSelectionVisible ? '选择列表' : areAllRowsSelected ? '取消选择列表' : '全选列表'}
        </button>
        <span>{selectedCount > 0 ? `已选择 ${selectedCount} 首` : '未选择歌曲'}</span>
        <button className="queue-tool-button" type="button" disabled={selectedCount === 0 || !canMoveSelectedAfterCurrent} onClick={handleMoveSelectedAfterCurrent}>
          <ListPlus size={16} />
          临时插播
        </button>
        <button className="queue-tool-button" type="button" disabled={selectedCount === 0} onClick={handleToggleSelectedRemoveAfterPlay}>
          {shouldUnmarkSelectedAfterPlay ? '取消播完移除' : '播放后移除'}
        </button>
        <button className="queue-tool-button danger" type="button" disabled={selectedCount === 0} onClick={handleRemoveSelected}>
          <Trash2 size={16} />
          移除所选
        </button>
        <button className="queue-tool-button" type="button" disabled={!isRowSelectionVisible} onClick={handleClearSelection}>
          <X size={15} />
          清除选择
        </button>
        <button className="queue-tool-button queue-undo-button" type="button" disabled={!undoSnapshot} onClick={handleUndoQueueAction}>
          <RotateCcw size={16} />
          撤销
        </button>
      </section>

      {actionNotice ? (
        <section className="queue-action-receipt" aria-live="polite" key={actionNotice.id}>
          <div className="queue-action-receipt__copy">
            <span>刚刚完成</span>
            <strong>{actionNotice.title}</strong>
            {actionNotice.detail ? <p>{actionNotice.detail}</p> : null}
            {actionNotice.trackTitles && actionNotice.trackTitles.length > 0 ? (
              <div className="queue-action-receipt__tracks" aria-label="受影响歌曲">
                {actionNotice.trackTitles.map((title, index) => (
                  <em key={`${title}-${index}`}>{title}</em>
                ))}
              </div>
            ) : null}
          </div>
          <div className="queue-action-receipt__actions">
            {actionNotice.canUndo && undoSnapshot ? (
              <button className="queue-tool-button queue-undo-button" type="button" onClick={handleUndoQueueAction}>
                <RotateCcw size={16} />
                撤销这次操作
              </button>
            ) : null}
            <button className="queue-icon-button" type="button" aria-label="关闭队列操作回执" title="关闭" onClick={handleDismissActionNotice}>
              <X size={15} />
            </button>
          </div>
        </section>
      ) : null}

      {savedQueues.length > 0 ? (
        <section className="queue-saved-panel" aria-label="已保存队列">
          <div className="queue-section-heading">
            <div>
              <span className="queue-kicker">Saved Queues</span>
              <h2>已保存队列</h2>
            </div>
            <span>{savedQueues.length} 个快照</span>
          </div>
          <div className="queue-saved-list">
            {savedQueues.slice(0, 4).map((snapshot) => (
              <article className="queue-saved-item" key={snapshot.id}>
                <div>
                  <strong>{snapshot.name}</strong>
                  <span>{snapshot.tracks.length} 首 / {formatSavedQueueDate(snapshot.createdAt)}</span>
                </div>
                <button className="queue-tool-button" type="button" onClick={() => handleRestoreSavedQueue(snapshot)}>
                  <RotateCcw size={15} />
                  恢复
                </button>
                <button className="queue-icon-button danger" type="button" aria-label={`删除队列快照 ${snapshot.name}`} title="删除队列快照" onClick={() => handleDeleteSavedQueue(snapshot.id)}>
                  <X size={15} />
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="queue-list-section" aria-label={t('queue.upNext.kicker')}>
        <div className="queue-section-heading">
          <div>
            <span className="queue-kicker">{t('queue.upNext.kicker')}</span>
            <h2>{t('queue.upNext.title')}</h2>
          </div>
          <span>{t('queue.upNext.waitingCount', { count: upNextCount })}</span>
        </div>

        {rows.length > 0 ? (
          <div className="queue-list" role="list" data-virtualized="true">
            <div className="queue-virtual-spacer" ref={queueVirtualSpacerRef} style={{ height: rowVirtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const item = rows[virtualRow.index];
                const isCurrent = item.queueId === queue.currentQueueId;
                const isSelected = selectedQueueIds.has(item.queueId);
                const removeAfterPlay = removeAfterPlayQueueIds.has(item.queueId);
                const isRecent = recentQueueIds.has(item.queueId);
                const rowQualityTags = qualityTags(item.track);
                return (
                  <div
                    className="queue-virtual-row"
                    key={item.queueId}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
                  >
                    <div
                      className="queue-row"
                      data-current={isCurrent}
                      data-selection-mode={isRowSelectionVisible ? 'true' : undefined}
                      data-selected={isSelected ? 'true' : undefined}
                      data-remove-after-play={removeAfterPlay ? 'true' : undefined}
                      data-recent-change={isRecent ? 'true' : undefined}
                      data-dragging={draggedQueueIds.includes(item.queueId)}
                      data-drop-target={dropTargetQueueId === item.queueId && !draggedQueueIds.includes(item.queueId)}
                      draggable
                      role="listitem"
                      onContextMenu={(event) => handleTrackContextMenu(event, item.track)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(event) => handleDragOver(event, item)}
                      onDragStart={(event) => handleDragStart(event, item)}
                      onDrop={(event) => handleDrop(event, item)}
                      onDoubleClick={() => void runQueueAction(() => queue.playQueueItem(item.queueId))}
                    >
                      <span className="queue-drag-handle" aria-label={t('queue.action.dragLabel', { title: item.track.title })} title={t('queue.action.dragTitle')}>
                        <GripVertical size={17} />
                      </span>
                      {isRowSelectionVisible ? (
                        <label className="queue-row-select" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`选择 ${item.track.title}`}
                            onChange={(event) => handleToggleQueueSelection(event, item)}
                          />
                        </label>
                      ) : null}
                      <div className="queue-row-cover" data-empty={!item.track.coverThumb}>
                        {item.track.coverThumb ? <img alt="" src={item.track.coverThumb} /> : <Music2 size={19} />}
                      </div>
                      <div className="queue-row-copy">
                        <strong>{item.track.title}</strong>
                        <span>{item.track.artist || item.track.albumArtist || t('queue.unknownArtist')}</span>
                        {removeAfterPlay ? <em className="queue-row-chip">播完移除</em> : null}
                      </div>
                      <div className="queue-row-quality" aria-label={t('queue.now.quality')}>
                        {rowQualityTags.length > 0 ? rowQualityTags.map((tag) => <span key={`${item.queueId}-${tag}`}>{tag}</span>) : <span>{t('queue.quality.unknown')}</span>}
                      </div>
                      <span className="queue-row-source">{item.source.label}</span>
                      <span className="queue-row-duration">{formatDuration(item.track.duration)}</span>
                      <div className="queue-row-actions" onDoubleClick={(event) => event.stopPropagation()}>
                        <button
                          className="queue-row-start-button"
                          type="button"
                          aria-label={isCurrent ? t('queue.action.currentItem') : t('queue.action.startFromHere', { title: item.track.title })}
                          title={isCurrent ? t('queue.action.currentItem') : t('queue.action.startFromHere', { title: item.track.title })}
                          disabled={isCurrent}
                          onClick={() => void runQueueAction(() => queue.playQueueItem(item.queueId))}
                        >
                          <Play size={16} fill="currentColor" />
                          <span>{isCurrent ? t('queue.action.currentItem') : t('queue.action.startFromHereShort')}</span>
                        </button>
                        <button
                          className="queue-icon-button"
                          type="button"
                          aria-label={t('queue.action.playNext', { title: item.track.title })}
                          title={t('queue.action.playNext', { title: item.track.title })}
                          disabled={isCurrent}
                          onClick={() => handlePlayItemNext(item)}
                        >
                          <Shuffle size={15} />
                        </button>
                        <button
                          className="queue-icon-button danger"
                          type="button"
                          aria-label={t('queue.action.remove', { title: item.track.title })}
                          title={t('queue.action.remove', { title: item.track.title })}
                          onClick={() => handleRemoveQueueItem(item)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="queue-empty-state">
            <ListMusicFallback />
            <strong>{t('queue.empty.title')}</strong>
            <span>{t('queue.empty.description')}</span>
          </div>
        )}

        {actionError ? <p className="queue-error">{actionError}</p> : null}
      </section>

      {trackMenu ? (
        <TrackContextMenu
          track={trackMenu.track}
          position={trackMenu.position}
          liked={!trackMenu.track.isTemporary && likedTrackIds[trackMenu.track.id] === true}
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
          queue.updateTrackSnapshot(updatedTrack.id, updatedTrack);
          window.dispatchEvent(new Event('library:changed'));
        }}
      />

      <OsuTimingPanel
        track={osuTimingTrack}
        isOpen={Boolean(osuTimingTrack)}
        onClose={() => setOsuTimingTrack(null)}
        onTrackUpdated={(updatedTrack) => {
          setOsuTimingTrack(updatedTrack);
          queue.updateTrackSnapshot(updatedTrack.id, updatedTrack);
        }}
      />
    </div>
  );
};

const ListMusicFallback = (): JSX.Element => (
  <span className="queue-empty-icon" aria-hidden="true">
    <Music2 size={24} />
  </span>
);
