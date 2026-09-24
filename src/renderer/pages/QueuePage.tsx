import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import '../styles/queue.css';
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Disc3,
  FolderOpen,
  GripVertical,
  Heart,
  History,
  LocateFixed,
  MinusCircle,
  MoreHorizontal,
  Music2,
  Play,
  Repeat1,
  Repeat2,
  RotateCcw,
  Save,
  Search,
  Shuffle,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ContinuousPlayReason,
  EditableTrackTags,
  LibraryPlaylist,
  LibraryTrack,
  PlaybackHistoryEntry,
} from '../../shared/types/library';
import { likedChangedEvent, likedTracksChangedEvent, useLikedTrackIds } from '../hooks/useLikedMedia';
import type { QueueItem, RepeatMode } from '../stores/PlaybackQueueProvider';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import { openAlbumDetailForTrack } from '../utils/albumNavigation';
import { resolvePlaylistForTrackAdd } from '../utils/appPrompt';
import { localCoverDisplayUrl } from '../utils/coverDisplayUrl';
import { OsuTimingPanel } from '../components/library/OsuTimingPanel';
import { TrackContextMenu } from '../components/library/TrackContextMenu';
import type { TrackMenuAction } from '../components/library/TrackContextMenu';
import { TrackTagEditorDrawer } from '../components/library/TrackTagEditorDrawer';
import { getPageScrollContainer } from '../components/ui/InfiniteScrollSentinel';
import {
  EchoContinueIcon,
  EchoGaplessIcon,
  EchoSequenceIcon,
  EchoShuffleIcon,
  EchoSmartTransitionIcon,
} from '../components/player/QueueControlIcons';

const automixTemporarilyDisabled = false;
const randomQueuePageSize = 96;
const locateCurrentTrackEvent = 'app:locate-current-track';
const queuePageDragItemsMime = 'application/x-echo-next-queue-items';
const queuePagePerfWarnThresholdMs = 120;
const queuePageFirstPaintWarnThresholdMs = 250;
const queuePageDeferredTaskDelayMs = 120;
const recommendationReasonLabel = (
  reason: ContinuousPlayReason,
  t: (key: TranslationKey, options?: Record<string, string | number>) => string,
): string => t(`queue.continuousPlay.reason.${reason.code}` as TranslationKey, { value: reason.value ?? '' });
const queuePageDeferredTaskTimeoutMs = 800;

type QueuePagePerfValue = string | number | boolean | null | undefined;
type QueueTransitionMode = 'normal' | 'gapless' | 'smart';
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

const queueNowCoverUrl = (track: Pick<LibraryTrack, 'coverId' | 'coverThumb'> | null): string | null =>
  localCoverDisplayUrl(track?.coverId, track?.coverThumb);

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

const queueActionTrackDetail = (
  items: QueueItem[],
  unitLabel: string,
  formatHidden?: (count: number, unit: string) => string,
): string | undefined => {
  const hiddenCount = Math.max(0, items.length - 4);
  if (hiddenCount <= 0) {
    return undefined;
  }
  return formatHidden
    ? formatHidden(hiddenCount, unitLabel)
    : `还有 ${hiddenCount} ${unitLabel}`;
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
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<QueueActionNotice | null>(null);
  const [savedQueues, setSavedQueues] = useState<SavedQueueSnapshot[]>([]);
  const [isGeneratingRandomQueue, setIsGeneratingRandomQueue] = useState(false);
  const [isGeneratingHistoryQueue, setIsGeneratingHistoryQueue] = useState(false);
  const [isTransitionSettingPending, setIsTransitionSettingPending] = useState(false);
  const [isQueueActionsMenuOpen, setIsQueueActionsMenuOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [queueSearchQuery, setQueueSearchQuery] = useState('');
  const [shouldLocateCurrentTrack, setShouldLocateCurrentTrack] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedQueueId, setLastSelectedQueueId] = useState<string | null>(null);
  const removeAfterPlayQueueIds = useMemo(
    () => new Set(queue.items.filter((item) => item.removeAfterPlay === true).map((item) => item.queueId)),
    [queue.items],
  );
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
  const queueActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const scrollMarginRef = useRef(0);
  const mountStartedAtRef = useRef(performance.now());
  const tagEditorCloseTimerRef = useRef<number | null>(null);
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
  const unfilteredRows = useMemo(() => {
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
  const rows = useMemo(() => {
    const query = queueSearchQuery.trim().toLocaleLowerCase();
    if (!query) {
      return unfilteredRows;
    }

    return unfilteredRows.filter((item) =>
      [
        item.track.title,
        item.track.artist,
        item.track.album,
        item.track.albumArtist,
        item.source.label,
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n')
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [queueSearchQuery, unfilteredRows]);
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
  const isRowSelectionVisible = isSelectionMode && rows.length > 0;
  const isSelectionBarVisible = selectedCount > 0;
  const nowPlaying = queue.currentTrack;
  const isNowPlayingTemporary = nowPlaying?.isTemporary === true;
  const nowPlayingTags = qualityTags(nowPlaying);
  const nowPlayingCoverUrl = queueNowCoverUrl(nowPlaying);
  const sourceLabel = queue.currentItem?.source.label ?? t('queue.now.sourceFallback');
  const playbackAudioStatus = sharedPlaybackStatus.audioStatus;
  const playbackStatus = sharedPlaybackStatus.playbackStatus;
  const playbackIdentityMatches =
    !nowPlaying ||
    playbackAudioStatus?.currentTrackId === nowPlaying.id ||
    playbackStatus?.currentTrackId === nowPlaying.id;
  const playbackPositionSeconds = playbackIdentityMatches
    ? Math.max(0, playbackAudioStatus?.positionSeconds ?? (playbackStatus?.positionMs ?? 0) / 1000)
    : 0;
  const playbackDurationSeconds = playbackIdentityMatches
      ? Math.max(
        0,
        playbackAudioStatus?.durationSeconds ??
          (playbackStatus?.durationMs != null
            ? playbackStatus.durationMs / 1000
            : nowPlaying?.duration ?? 0),
      )
    : Math.max(0, nowPlaying?.duration ?? 0);
  const playbackProgress =
    playbackDurationSeconds > 0
      ? Math.min(1, playbackPositionSeconds / playbackDurationSeconds)
      : 0;
  const queueMenuSource = useMemo(() => ({ type: 'manual' as const, label: t('queue.header.title') }), [t]);
  const nextQueuePreview = useMemo(() => {
    if (queue.repeatMode === 'one' && nowPlaying) {
      return {
        kind: 'repeat-one',
        title: nowPlaying.title,
        detail: t('queue.nextPreview.repeatOneDetail'),
        track: nowPlaying,
        queueItemId: queue.currentQueueId,
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
        track: null,
        queueItemId: null,
      };
    }

    const nextItem = currentIndex >= 0
      ? queue.items[currentIndex + 1] ?? (queue.repeatMode === 'all' && queue.items.length > 1 ? queue.items[0] : null)
      : queue.items[0] ?? null;

    if (!nextItem) {
      return {
        kind: 'empty',
        title: t('queue.nextPreview.empty'),
        track: null,
        queueItemId: null,
      };
    }

    return {
      kind: 'track',
      title: nextItem.track.title,
      detail: t('queue.nextPreview.trackDetail', {
        artist: nextItem.track.artist || nextItem.track.albumArtist || t('queue.unknownArtist'),
        source: nextItem.source.label,
      }),
      track: nextItem.track,
      queueItemId: nextItem.queueId,
    };
  }, [
    currentIndex,
    nowPlaying,
    queue.currentQueueId,
    queue.isShuffleEnabled,
    queue.items,
    queue.playbackShuffleAvoidRecentCount,
    queue.repeatMode,
    queue.shuffleScopeLabel,
    t,
  ]);
  const nextQueueCoverUrl = queueNowCoverUrl(nextQueuePreview.track);
  const transitionMode: QueueTransitionMode = queue.automixEnabled
    ? 'smart'
    : queue.gaplessPlaybackEnabled
      ? 'gapless'
      : 'normal';

  useEffect(() => {
    if (!isQueueActionsMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!queueActionsMenuRef.current?.contains(event.target as Node)) {
        setIsQueueActionsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsQueueActionsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isQueueActionsMenuOpen]);
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
      setQueueSearchQuery('');
      setShouldLocateCurrentTrack(true);
    };

    window.addEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
    return () => window.removeEventListener(locateCurrentTrackEvent, handleLocateCurrentTrack);
  }, []);

  useEffect(() => {
    if (!shouldLocateCurrentTrack) {
      return;
    }

    const currentRowIndex = rows.findIndex((item) =>
      queue.currentQueueId ? item.queueId === queue.currentQueueId : item.track.id === queue.currentTrackId,
    );
    if (currentRowIndex < 0) {
      setShouldLocateCurrentTrack(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      rowVirtualizer.scrollToIndex(currentRowIndex, { align: 'center' });
      setShouldLocateCurrentTrack(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [queue.currentQueueId, queue.currentTrackId, rowVirtualizer, rows, shouldLocateCurrentTrack]);

  useEffect(() => {
    const validQueueIds = new Set(queue.items.map((item) => item.queueId));

    setSelectedQueueIds((current) => {
      const next = new Set(Array.from(current).filter((queueId) => validQueueIds.has(queueId)));
      return next.size === current.size ? current : next;
    });
  }, [queue.items]);

  useEffect(() => {
    if (rows.length === 0 && isSelectionMode) {
      setIsSelectionMode(false);
    }
  }, [isSelectionMode, rows.length]);

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

  const handleSetTransitionMode = useCallback((mode: QueueTransitionMode): void => {
    if (mode === transitionMode || isTransitionSettingPending) {
      return;
    }

    setActionError(null);
    setIsTransitionSettingPending(true);
    void (async () => {
      if (mode === 'normal') {
        if (queue.gaplessPlaybackEnabled) {
          await queue.setGaplessPlaybackEnabled(false);
        }
        if (queue.automixEnabled) {
          queue.setAutomixEnabled(false);
        }
        return;
      }

      if (mode === 'gapless') {
        if (!queue.gaplessPlaybackEnabled) {
          await queue.setGaplessPlaybackEnabled(true);
        }
        if (queue.automixEnabled) {
          queue.setAutomixEnabled(false);
        }
        return;
      }

      if (queue.gaplessPlaybackEnabled) {
        await queue.setGaplessPlaybackEnabled(false);
      }
      if (!queue.automixEnabled) {
        queue.setAutomixEnabled(true);
      }
    })()
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setIsTransitionSettingPending(false);
      });
  }, [isTransitionSettingPending, queue, transitionMode]);

  const handleSaveQueueSnapshot = useCallback((): void => {
    if (queue.items.length === 0) {
      setActionError(t('queue.page.error.emptySave'));
      return;
    }

    const createdAt = new Date().toISOString();
    const name = nowPlaying?.title
      ? t('queue.page.saved.nameWithTitle', { title: nowPlaying.title, count: queue.items.length })
      : t('queue.page.saved.nameQueue', { date: formatSavedQueueDate(createdAt) });
    const snapshot: SavedQueueSnapshot = {
      id: `queue-${Date.now()}`,
      name,
      createdAt,
      currentTrackId: queue.currentTrackId,
      tracks: queue.items.map((item) => item.track),
    };

    updateSavedQueues((current) => [snapshot, ...current]);
    setActionError(null);
    setActionNotice(createQueueActionNotice(t('queue.page.notice.savedQueue'), { detail: name }));
  }, [nowPlaying?.title, queue.currentTrackId, queue.items, t, updateSavedQueues]);

  const handleRestoreSavedQueue = useCallback(
    (snapshot: SavedQueueSnapshot): void => {
      if (snapshot.tracks.length === 0) {
        setActionError(t('queue.page.error.emptySnapshot'));
        return;
      }

      setSelectedQueueIds(new Set());
      setLastSelectedQueueId(null);
      setIsSelectionMode(false);
      queue.replaceQueue(snapshot.tracks, {
        startTrackId: snapshot.currentTrackId ?? snapshot.tracks[0]?.id,
        source: { type: 'manual', label: t('queue.page.saved.sourceLabel', { name: snapshot.name }) },
      });
      setActionError(null);
      setActionNotice(createQueueActionNotice(t('queue.page.notice.restoredQueue'), { detail: snapshot.name }));
    },
    [queue, t],
  );

  const handleDeleteSavedQueue = useCallback(
    (snapshotId: string): void => {
      updateSavedQueues((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
      setActionError(null);
      setActionNotice(createQueueActionNotice(t('queue.page.notice.deletedSnapshot')));
    },
    [t, updateSavedQueues],
  );

  const captureQueueUndo = useCallback(
    (label: string): void => {
      setUndoSnapshot({
        label,
        items: queue.items,
        currentQueueId: queue.currentQueueId,
        currentTrackId: queue.currentTrackId,
        selectedQueueIds: Array.from(selectedQueueIds),
      });
    },
    [queue.currentQueueId, queue.currentTrackId, queue.items, selectedQueueIds],
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
    setUndoSnapshot(null);
    setActionError(null);
    flashQueueItems(undoSnapshot.selectedQueueIds.length > 0 ? undoSnapshot.selectedQueueIds : undoSnapshot.items.map((item) => item.queueId));
    setActionNotice(createQueueActionNotice(t('queue.page.notice.undone'), { detail: undoSnapshot.label }));
  }, [flashQueueItems, queue, t, undoSnapshot]);

  const handleToggleVisibleSelection = useCallback((): void => {
    if (!isRowSelectionVisible) {
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
    setLastSelectedQueueId(null);
  }, [areAllRowsSelected, isRowSelectionVisible, rows]);

  const handleToggleSelectionMode = useCallback((): void => {
    if (isSelectionMode) {
      setSelectedQueueIds(new Set());
      setLastSelectedQueueId(null);
      setIsSelectionMode(false);
      return;
    }

    setIsSelectionMode(true);
  }, [isSelectionMode]);

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

  const handleQueueRowSelect = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, item: QueueItem): void => {
      if (!isRowSelectionVisible) {
        return;
      }

      const target = event.target as HTMLElement;
      if (target.closest('button, input, label, a')) {
        return;
      }

      const checked = !selectedQueueIds.has(item.queueId);
      const rowIds = rows.map((row) => row.queueId);
      setSelectedQueueIds((current) => {
        const next = new Set(current);
        const lastIndex = lastSelectedQueueId ? rowIds.indexOf(lastSelectedQueueId) : -1;
        const currentIndex = rowIds.indexOf(item.queueId);

        if (event.shiftKey && lastIndex >= 0 && currentIndex >= 0) {
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
    [isRowSelectionVisible, lastSelectedQueueId, rows, selectedQueueIds],
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
    const hiddenDetail = queueActionTrackDetail(removedItems, t('queue.page.unit.tracks'), (count, unit) =>
      t('queue.page.notice.hiddenMore', { count, unit }),
    );
    captureQueueUndo(t('queue.page.undo.clear', { count: removedItems.length }));
    queue.clearQueue();
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    setActionError(null);
    setActionNotice(createQueueActionNotice(t('queue.page.notice.clearedCount', { count: removedItems.length }), {
      detail: hiddenDetail ?? t('queue.page.notice.canUndo'),
      trackTitles: queueActionTrackTitles(removedItems),
      canUndo: true,
    }));
  }, [captureQueueUndo, queue, t]);

  const handleRemoveSelected = useCallback((): void => {
    if (selectedCount === 0) {
      return;
    }

    const removedItems = selectedItems;
    const hiddenDetail = queueActionTrackDetail(removedItems, t('queue.page.unit.tracks'), (count, unit) =>
      t('queue.page.notice.hiddenMore', { count, unit }),
    );
    captureQueueUndo(t('queue.page.undo.removeCount', { count: selectedCount }));
    queue.removeQueueItems(selectedQueueIdList);
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    setActionError(null);
    setActionNotice(createQueueActionNotice(t('queue.page.notice.removedCount', { count: selectedCount }), {
      detail: hiddenDetail ?? t('queue.page.notice.canUndo'),
      trackTitles: queueActionTrackTitles(removedItems),
      canUndo: true,
    }));
  }, [captureQueueUndo, queue, selectedCount, selectedItems, selectedQueueIdList, t]);

  const handlePlaySelectedNow = useCallback((): void => {
    const firstSelected = selectedItems[0];
    if (!firstSelected) {
      return;
    }

    void runQueueAction(() => queue.playQueueItem(firstSelected.queueId));
  }, [queue, runQueueAction, selectedItems]);

  const handleToggleSelectedRemoveAfterPlay = useCallback((): void => {
    if (selectedCount === 0) {
      return;
    }

    queue.setQueueItemsRemoveAfterPlay(selectedQueueIdList, !shouldUnmarkSelectedAfterPlay);
    flashQueueItems(selectedQueueIdList);
    setActionError(null);
    setActionNotice(createQueueActionNotice(
      shouldUnmarkSelectedAfterPlay
        ? t('queue.page.notice.unmarkedAfterPlay')
        : t('queue.page.notice.markedAfterPlay', { count: selectedCount }),
      {
        detail: queueActionTrackDetail(selectedItems, t('queue.page.unit.tracks'), (count, unit) =>
          t('queue.page.notice.hiddenMore', { count, unit }),
        ),
        trackTitles: queueActionTrackTitles(selectedItems),
      },
    ));
  }, [flashQueueItems, queue, selectedCount, selectedItems, selectedQueueIdList, shouldUnmarkSelectedAfterPlay, t]);

  const handleMoveSelectedAfterCurrent = useCallback((): void => {
    if (selectedCount === 0 || !canMoveSelectedAfterCurrent) {
      return;
    }

    const movedItems = selectedItems;
    const hiddenDetail = queueActionTrackDetail(movedItems, t('queue.page.unit.tracks'), (count, unit) =>
      t('queue.page.notice.hiddenMore', { count, unit }),
    );
    captureQueueUndo(t('queue.page.undo.moveCount', { count: selectedCount }));
    queue.moveQueueItemsAfterCurrent(selectedQueueIdList);
    setSelectedQueueIds(new Set());
    setLastSelectedQueueId(null);
    setIsSelectionMode(false);
    flashQueueItems(selectedQueueIdList);
    setActionError(null);
    setActionNotice(createQueueActionNotice(t('queue.page.notice.movedCount', { count: selectedCount }), {
      detail: hiddenDetail ?? t('queue.page.notice.movedAfterCurrent'),
      trackTitles: queueActionTrackTitles(movedItems),
      canUndo: true,
    }));
  }, [canMoveSelectedAfterCurrent, captureQueueUndo, flashQueueItems, queue, selectedCount, selectedItems, selectedQueueIdList, t]);

  const handleSaveQueueAsPlaylist = useCallback(async (): Promise<void> => {
    const library = window.echo?.library;
    if (!library?.createPlaylist || !library.addTracksToPlaylist) {
      setActionError(t('queue.page.error.bridgePlaylist'));
      return;
    }

    const trackIds = buildQueuePlaylistTrackIds(queue.items);

    if (trackIds.length === 0) {
      setActionError(t('queue.page.error.noLibraryTracks'));
      return;
    }

    let createdPlaylistId: string | null = null;
    try {
      setActionError(null);
      setActionNotice(null);
      const playlist = await library.createPlaylist({
        name: t('queue.page.saved.nameQueue', { date: formatSavedQueueDate(new Date().toISOString()) }),
        description: t('queue.page.playlist.description'),
      });
      createdPlaylistId = playlist.id;
      const items = await library.addTracksToPlaylist(playlist.id, trackIds);
      const savedCount = items.length;

      if (savedCount === 0) {
        throw new Error(t('queue.page.error.noneWritten'));
      }

      window.dispatchEvent(new Event('library:playlists-changed'));
      setActionNotice(createQueueActionNotice(t('queue.page.notice.savedPlaylist'), {
        detail: t('queue.page.notice.savedPlaylistDetail', { name: playlist.name, count: savedCount }),
      }));
    } catch (error) {
      if (createdPlaylistId && library.deletePlaylist) {
        await library.deletePlaylist(createdPlaylistId).catch(() => undefined);
      }
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [queue.items, t]);

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
          case 'delete-song': {
              if (!window.confirm(`Delete the music file?\n${track.title}`)) {
                return;
              }
              const result = await library?.deleteTrackFile(track.id);
              for (const removedTrackId of result?.removedTrackIds ?? [track.id]) {
                queue.removeTrackFromQueue(removedTrackId);
              }
              window.dispatchEvent(new Event('library:changed'));
              return;
            }
          case 'add-to-playlist':
            {
              if (track.mediaType === 'streaming') {
                setActionError(t('queue.page.error.streamingPlaylist'));
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
    (event: DragEvent<HTMLElement>, item: QueueItem): void => {
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
      captureQueueUndo(t('queue.page.undo.moveCount', { count: movableQueueIds.length }));
      queue.moveQueueItemsToIndex(movableQueueIds, toIndex);
      flashQueueItems(movableQueueIds);
      setActionError(null);
      setActionNotice(createQueueActionNotice(t('queue.page.notice.movedCount', { count: movableQueueIds.length }), {
        detail: queueActionTrackDetail(movedItems, t('queue.page.unit.tracks'), (count, unit) =>
          t('queue.page.notice.hiddenMore', { count, unit }),
        ),
        trackTitles: queueActionTrackTitles(movedItems),
        canUndo: true,
      }));
    },
    [captureQueueUndo, draggedQueueIds, flashQueueItems, queue, t],
  );

  const handleDragEnd = useCallback((): void => {
    setDraggedQueueIds([]);
    setDropTargetQueueId(null);
  }, []);

  const handleKeyboardQueueMove = useCallback(
    (item: QueueItem, direction: 'up' | 'down' | 'next'): void => {
      const fromIndex = queue.items.findIndex((candidate) => candidate.queueId === item.queueId);
      if (fromIndex < 0) {
        return;
      }

      if (direction === 'up' && fromIndex === 0) {
        return;
      }
      if (direction === 'down' && fromIndex === queue.items.length - 1) {
        return;
      }
      if (direction === 'next' && item.queueId === queue.currentQueueId) {
        return;
      }

      captureQueueUndo(t('queue.page.undo.moveCount', { count: 1 }));
      if (direction === 'next') {
        queue.moveQueueItemsAfterCurrent([item.queueId]);
      } else {
        queue.moveQueueItem(fromIndex, direction === 'up' ? fromIndex - 1 : fromIndex + 1);
      }
      flashQueueItems([item.queueId]);
      setActionError(null);
      setActionNotice(createQueueActionNotice('已调整队列顺序', {
        detail: direction === 'up'
          ? `已上移《${item.track.title}》`
          : direction === 'down'
            ? `已下移《${item.track.title}》`
            : t('queue.page.notice.movedAfterCurrent'),
        trackTitles: [item.track.title],
        canUndo: true,
      }));
    },
    [captureQueueUndo, flashQueueItems, queue, t],
  );

  const handleQueueMoveKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, item: QueueItem): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      const direction = key === 'arrowup'
        ? 'up'
        : key === 'arrowdown'
          ? 'down'
          : key === 'n'
            ? 'next'
            : null;
      if (!direction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleKeyboardQueueMove(item, direction);
    },
    [handleKeyboardQueueMove],
  );

  return (
    <div className="queue-page">
      <section className="queue-session-hero">
        {nowPlayingCoverUrl || nextQueueCoverUrl ? (
          <div className="queue-session-backdrop" aria-hidden="true">
            <div className="queue-session-backdrop-pane queue-session-backdrop-current">
              {nowPlayingCoverUrl ? <img alt="" src={nowPlayingCoverUrl} /> : null}
            </div>
            <div className="queue-session-backdrop-pane queue-session-backdrop-next">
              {nextQueueCoverUrl ? <img alt="" src={nextQueueCoverUrl} /> : null}
            </div>
          </div>
        ) : null}

        <header className="queue-page-header">
          <h1>{t('queue.header.title')}</h1>
          <span className="queue-count">{t('queue.count', { count: queue.items.length })}</span>
        </header>

        <section className="queue-now-card" aria-label={t('queue.now.kicker')}>
          <div className="queue-now-cover" data-empty={!nowPlayingCoverUrl}>
            {nowPlayingCoverUrl ? <img alt="" src={nowPlayingCoverUrl} /> : <Disc3 size={54} />}
          </div>

          <div className="queue-now-main">
            <span className="queue-kicker">{t('queue.now.kicker')}</span>
            <h2>{nowPlaying?.title ?? t('queue.now.emptyTitle')}</h2>
            <p>{nowPlaying ? nowPlaying.artist || t('queue.unknownArtist') : t('queue.now.emptyDescription')}</p>

            <div className="queue-quality-row" aria-label={t('queue.now.quality')}>
              {nowPlayingTags.length > 0 ? nowPlayingTags.map((tag) => <span key={tag}>{tag}</span>) : <span>{t('queue.now.waitingAudio')}</span>}
              <span>{sourceLabel}</span>
            </div>

            <div className="queue-progress">
              <span>{formatDuration(playbackPositionSeconds)}</span>
              <div className="queue-progress-track" aria-hidden="true">
                <i style={{ width: `${playbackProgress * 100}%` }} />
              </div>
              <span>{nowPlaying ? formatDuration(playbackDurationSeconds || nowPlaying.duration) : '--:--'}</span>
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
              <button className="queue-icon-button" type="button" aria-label={t('queue.action.openFolder')} title={t('queue.action.openFolder')} disabled={!nowPlaying} onClick={handleOpenCurrentFolder}>
                <FolderOpen size={17} />
              </button>
              <button className="queue-icon-button" type="button" aria-label={t('queue.action.more')} title={t('queue.action.more')} disabled={!nowPlaying} onClick={handleNowPlayingMoreClick}>
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>

          <div className="queue-next-preview" data-kind={nextQueuePreview.kind} aria-label={t('queue.nextPreview.kicker')}>
            <span className="queue-next-arrow" aria-hidden="true"><ArrowRight size={18} strokeWidth={1.8} /></span>
            <div className="queue-next-cover" data-empty={!nextQueueCoverUrl}>
              {nextQueueCoverUrl ? <img alt="" src={nextQueueCoverUrl} /> : <Disc3 size={28} />}
            </div>
            <div className="queue-next-copy">
              <span>{t('queue.nextPreview.kicker')}</span>
              <strong>{nextQueuePreview.title}</strong>
              {nextQueuePreview.detail ? <small>{nextQueuePreview.detail}</small> : null}
              {nextQueuePreview.track ? <small>{formatDuration(nextQueuePreview.track.duration)}</small> : null}
            </div>
          </div>

        </section>
      </section>

      <section className="queue-control-dock" aria-label={t('queue.tools')}>
        <div className="queue-playback-strategy">
          <span className="queue-control-label">播放策略</span>
          <div className="queue-strategy-groups">
            <div className="queue-order-segment" role="group" aria-label="播放顺序">
              <button className={!queue.isShuffleEnabled ? 'is-active' : ''} type="button" aria-pressed={!queue.isShuffleEnabled} onClick={() => queue.isShuffleEnabled && queue.toggleShuffle()}>
                <EchoSequenceIcon size={17} />
                顺序
              </button>
              <button className={queue.isShuffleEnabled ? 'is-active' : ''} type="button" aria-pressed={queue.isShuffleEnabled} onClick={() => !queue.isShuffleEnabled && queue.toggleShuffle()}>
                <EchoShuffleIcon size={17} />
                随机
              </button>
            </div>
            <span className="queue-strategy-separator" aria-hidden="true" />
            <div className="queue-order-segment queue-repeat-segment" role="group" aria-label={t('queue.repeat.mode')}>
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
          </div>
        </div>

        <span className="queue-control-divider" aria-hidden="true" />

        <div className="queue-continuous-control">
          <span className="queue-control-label">队列补充</span>
          <button
            className="queue-feature-switch"
            type="button"
            role="switch"
            aria-checked={queue.autoFillQueueEnabled}
            onClick={() => queue.setAutoFillQueueEnabled(!queue.autoFillQueueEnabled)}
          >
            <span className="queue-feature-icon"><EchoContinueIcon size={20} /></span>
            <span className="queue-feature-copy">
              <strong>{t('queue.continuousPlay.toggle')}</strong>
              <small>{queue.isContinuousPlayFilling ? t('queue.continuousPlay.filling') : '基于本机音乐库继续推荐'}</small>
            </span>
            <span className="queue-switch-track" data-enabled={queue.autoFillQueueEnabled}><i /></span>
          </button>
        </div>

        <div className="queue-transition-control">
          <span className="queue-control-label">衔接方式</span>
          <div className="queue-transition-segment" role="radiogroup" aria-label="歌曲衔接方式" aria-busy={isTransitionSettingPending}>
            <button
              className={transitionMode === 'normal' ? 'is-active' : ''}
              type="button"
              role="radio"
              aria-checked={transitionMode === 'normal'}
              disabled={isTransitionSettingPending || (queue.gaplessPlaybackEnabled && !window.echo?.app?.setSettings)}
              onClick={() => handleSetTransitionMode('normal')}
            >
              <AudioLines size={17} />
              普通
            </button>
            <button
              className={transitionMode === 'gapless' ? 'is-active' : ''}
              type="button"
              role="radio"
              aria-checked={transitionMode === 'gapless'}
              aria-description="符合条件的本地同专辑相邻曲目将在 1 倍速下无缝衔接"
              disabled={isTransitionSettingPending || !window.echo?.app?.setSettings}
              onClick={() => handleSetTransitionMode('gapless')}
            >
              <EchoGaplessIcon size={17} />
              无缝
            </button>
            <button
              className={transitionMode === 'smart' ? 'is-active' : ''}
              type="button"
              role="radio"
              aria-checked={transitionMode === 'smart'}
              disabled={automixTemporarilyDisabled || isTransitionSettingPending || (queue.gaplessPlaybackEnabled && !window.echo?.app?.setSettings)}
              onClick={() => handleSetTransitionMode('smart')}
            >
              <EchoSmartTransitionIcon size={17} />
              智能
            </button>
          </div>
        </div>

        <div className="queue-actions-menu queue-management-menu" ref={queueActionsMenuRef}>
          <button
            className={`queue-tool-button ${isQueueActionsMenuOpen ? 'is-active' : ''}`}
            type="button"
            aria-expanded={isQueueActionsMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsQueueActionsMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={17} />
            队列管理
          </button>
          {isQueueActionsMenuOpen ? (
            <div className="queue-actions-popover" role="menu">
              <button type="button" role="menuitem" disabled={queue.items.length === 0} onClick={() => { setIsQueueActionsMenuOpen(false); handleSaveQueueSnapshot(); }}>
                <Save size={16} />
                保存当前队列
              </button>
              <button type="button" role="menuitem" disabled={savedQueues.length === 0} onClick={() => { setIsQueueActionsMenuOpen(false); if (savedQueues[0]) handleRestoreSavedQueue(savedQueues[0]); }}>
                <RotateCcw size={16} />
                恢复最近队列
              </button>
              <button type="button" role="menuitem" disabled={isGeneratingRandomQueue} onClick={() => { setIsQueueActionsMenuOpen(false); void handleGenerateRandomQueue(); }}>
                <Shuffle size={16} />
                {isGeneratingRandomQueue ? t('queue.action.generatingRandom') : t('queue.action.generateRandom')}
              </button>
              <button type="button" role="menuitem" disabled={isGeneratingHistoryQueue} onClick={() => { setIsQueueActionsMenuOpen(false); void handleGenerateHistoryQueue(); }}>
                <History size={16} />
                {isGeneratingHistoryQueue ? t('queue.action.generatingHistory') : t('queue.action.generateFromHistory')}
              </button>
              <button type="button" role="menuitem" disabled={queue.items.length === 0} onClick={() => { setIsQueueActionsMenuOpen(false); void handleSaveQueueAsPlaylist(); }}>
                <Music2 size={16} />
                保存为歌单
              </button>
              {selectedCount > 0 ? (
                <button type="button" role="menuitem" onClick={() => { setIsQueueActionsMenuOpen(false); handleToggleSelectedRemoveAfterPlay(); }}>
                  <Trash2 size={16} />
                  {shouldUnmarkSelectedAfterPlay ? t('queue.page.selection.clearAfterPlay') : t('queue.page.selection.markAfterPlay')}
                </button>
              ) : null}
              <button className="danger" type="button" role="menuitem" disabled={queue.items.length === 0} onClick={() => { setIsQueueActionsMenuOpen(false); handleClearQueue(); }}>
                <Trash2 size={16} />
                {t('queue.action.clear')}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {actionNotice ? (
        <section className="queue-action-receipt" aria-live="polite" key={actionNotice.id}>
          <div className="queue-action-receipt__copy">
            <span>{t('queue.page.receipt.justDone')}</span>
            <strong>{actionNotice.title}</strong>
            {actionNotice.detail ? <p>{actionNotice.detail}</p> : null}
            {actionNotice.trackTitles && actionNotice.trackTitles.length > 0 ? (
              <div className="queue-action-receipt__tracks" aria-label={t('queue.page.receipt.affectedTracks')}>
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
                {t('queue.page.receipt.undoThis')}
              </button>
            ) : null}
            <button className="queue-icon-button" type="button" aria-label={t('queue.page.receipt.closeAria')} title={t('queue.page.receipt.close')} onClick={handleDismissActionNotice}>
              <X size={15} />
            </button>
          </div>
        </section>
      ) : null}

      {savedQueues.length > 0 ? (
        <section className="queue-saved-panel" aria-label={t('queue.page.saved.aria')}>
          <div className="queue-section-heading">
            <div>
              <span className="queue-kicker">Saved Queues</span>
              <h2>{t('queue.page.saved.heading')}</h2>
            </div>
            <span>{t('queue.page.saved.snapshotCount', { count: savedQueues.length })}</span>
          </div>
          <div className="queue-saved-list">
            {savedQueues.slice(0, 4).map((snapshot) => (
              <article className="queue-saved-item" key={snapshot.id}>
                <div>
                  <strong>{snapshot.name}</strong>
                  <span>{t('queue.page.saved.trackMeta', { count: snapshot.tracks.length, date: formatSavedQueueDate(snapshot.createdAt) })}</span>
                </div>
                <button className="queue-tool-button" type="button" onClick={() => handleRestoreSavedQueue(snapshot)}>
                  <RotateCcw size={15} />
                  {t('queue.page.saved.restore')}
                </button>
                <button className="queue-icon-button danger" type="button" aria-label={t('queue.page.saved.deleteAria', { name: snapshot.name })} title={t('queue.page.saved.deleteTitle')} onClick={() => handleDeleteSavedQueue(snapshot.id)}>
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
            <h2>{t('queue.upNext.title')}</h2>
            <span aria-live="polite">
              {queueSearchQuery
                ? `${rows.length} / ${unfilteredRows.length} 首`
                : t('queue.count', { count: queue.items.length })}
            </span>
          </div>
          <div className="queue-list-heading-actions">
            <div className="queue-list-query-tools">
              <label className="queue-search-field">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={queueSearchQuery}
                  aria-label="搜索队列"
                  placeholder={t('songs.search.placeholder')}
                  onChange={(event) => setQueueSearchQuery(event.target.value)}
                />
                {queueSearchQuery ? (
                  <button type="button" aria-label="清除队列搜索" onClick={() => setQueueSearchQuery('')}>
                    <X size={14} />
                  </button>
                ) : null}
              </label>
              <button
                className="queue-tool-button queue-locate-button"
                type="button"
                disabled={!queue.currentQueueId && !queue.currentTrackId}
                onClick={() => {
                  setQueueSearchQuery('');
                  setShouldLocateCurrentTrack(true);
                }}
              >
                <LocateFixed size={15} />
                定位当前播放
              </button>
              <span className="queue-keyboard-hint">Alt+↑/↓ 调整顺序，Alt+N 移到下一首</span>
            </div>
            <section className="queue-selection-bar" data-visible={isSelectionBarVisible ? 'true' : 'false'} aria-label={t('queue.page.selection.aria')}>
              <strong>{t('queue.page.selection.selectedCount', { count: selectedCount })}</strong>
              <button className="queue-tool-button queue-selection-primary" type="button" disabled={selectedCount === 0} onClick={handlePlaySelectedNow}>
                <Play size={15} fill="currentColor" />
                立即播放
              </button>
              <button className="queue-tool-button" type="button" disabled={selectedCount === 0 || !canMoveSelectedAfterCurrent} onClick={handleMoveSelectedAfterCurrent}>
                <SkipForward size={15} />
                下一首播放
              </button>
              <button className="queue-tool-button danger" type="button" disabled={selectedCount === 0} onClick={handleRemoveSelected}>
                <Trash2 size={15} />
                移出队列
              </button>
              <button className="queue-icon-button" type="button" aria-label={t('queue.page.action.clearSelection')} onClick={handleClearSelection}>
                <X size={15} />
              </button>
            </section>
            {isSelectionMode ? (
              <button className="queue-tool-button queue-select-trigger" type="button" disabled={rows.length === 0} onClick={handleToggleVisibleSelection}>
                {areAllRowsSelected ? t('queue.page.selection.deselectList') : t('queue.page.selection.selectAll')}
              </button>
            ) : null}
            <button className="queue-tool-button queue-select-trigger" type="button" disabled={rows.length === 0} onClick={handleToggleSelectionMode}>
              {isSelectionMode ? t('queue.page.selection.done') : t('queue.page.selection.select')}
            </button>
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="queue-list" role="list" data-virtualized="true" aria-label={t('queue.upNext.title')}>
            <div
              className="queue-list-columns"
              data-selection-mode={isRowSelectionVisible ? 'true' : undefined}
              aria-hidden="true"
            >
              <span className="queue-list-column-title">标题 / 艺术家</span>
              <span className="queue-list-column-quality">音质</span>
              <span className="queue-list-column-source">来源</span>
              <span className="queue-list-column-duration">时长</span>
            </div>
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
                      role="listitem"
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-posinset={virtualRow.index + 1}
                      aria-setsize={rows.length}
                      onContextMenu={(event) => handleTrackContextMenu(event, item.track)}
                      onDragOver={(event) => handleDragOver(event, item)}
                      onDrop={(event) => handleDrop(event, item)}
                      onClick={(event) => handleQueueRowSelect(event, item)}
                      onDoubleClick={() => void runQueueAction(() => queue.playQueueItem(item.queueId))}
                    >
                      <button
                        className="queue-drag-handle"
                        type="button"
                        draggable
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+N"
                        aria-label={`调整 ${item.track.title} 的位置`}
                        title="拖动排序；Alt+↑ 上移；Alt+↓ 下移；Alt+N 移到下一首"
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onDragEnd={handleDragEnd}
                        onDragStart={(event) => handleDragStart(event, item)}
                        onKeyDown={(event) => handleQueueMoveKeyDown(event, item)}
                      >
                        <GripVertical size={17} />
                      </button>
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
                      <span className="queue-row-index" aria-hidden="true">
                        {isCurrent ? <AudioLines size={15} strokeWidth={2.2} /> : virtualRow.index + 1}
                      </span>
                      <div className="queue-row-cover" data-empty={!item.track.coverThumb}>
                        {item.track.coverThumb ? <img alt="" src={item.track.coverThumb} /> : <Music2 size={19} />}
                      </div>
                      <div className="queue-row-copy">
                        <strong>{item.track.title}</strong>
                        <span>{item.track.artist || item.track.albumArtist || t('queue.unknownArtist')}</span>
                        {item.recommendation ? (
                          <small className="queue-row-reason">
                            {item.recommendation.reasons.map((reason) => recommendationReasonLabel(reason, t)).join(' · ')}
                          </small>
                        ) : null}
                        {removeAfterPlay ? <em className="queue-row-chip">{t('queue.page.selection.markAfterPlay')}</em> : null}
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
                          aria-label={t('queue.action.startFromHere', { title: item.track.title })}
                          title={t('queue.action.startFromHereShort')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runQueueAction(() => queue.playQueueItem(item.queueId));
                          }}
                        >
                          <Play size={15} fill="currentColor" />
                          <span>{t('queue.action.startFromHereShort')}</span>
                        </button>
                        <button
                          className="queue-icon-button queue-row-more-button"
                          type="button"
                          aria-label={`${t('queue.action.more')} ${item.track.title}`}
                          title={t('queue.action.more')}
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            handleOpenTrackMenu(item.track, { x: rect.right - 8, y: rect.bottom + 6 });
                          }}
                        >
                          <MoreHorizontal size={18} />
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
            {queueSearchQuery ? <Search size={28} /> : <ListMusicFallback />}
            <strong>{queueSearchQuery ? '没有匹配的队列曲目' : t('queue.empty.title')}</strong>
            <span>{queueSearchQuery ? '换一个曲名、艺人或专辑关键词试试。' : t('queue.empty.description')}</span>
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
