import { memo, useCallback, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { Download, GripVertical, ListPlus, Loader2, MoreHorizontal, Music2 } from 'lucide-react';
import { isDisplayableBpmAnalysis } from '../../../shared/constants/audioAnalysis';
import type { LibraryTrack } from '../../../shared/types/library';
import { isDsdCodec, isHiResAudioSpec } from '../../../shared/utils/audioQuality';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

export type HifiTagKind = 'flac' | 'lossless' | 'depth' | 'rate' | 'bitrate' | 'bpm' | 'dsf' | 'hires';

export type HifiTag = {
  label: string;
  kind: HifiTagKind;
};

type TrackRowProps = {
  track: LibraryTrack;
  isPlaying: boolean;
  isSelected?: boolean;
  duplicateHiddenCount?: number;
  onPlay?: (track: LibraryTrack) => void;
  onToggleSelected?: (track: LibraryTrack) => void;
  onAddToQueue?: (track: LibraryTrack) => void;
  onAddToPlaylist?: (track: LibraryTrack) => void;
  onDownload?: (track: LibraryTrack) => void;
  onOpenArtist?: (track: LibraryTrack) => void;
  onOpenAlbum?: (track: LibraryTrack) => void;
  isLoading?: boolean;
  isDownloading?: boolean;
  downloadProgress?: number | null;
  onShowVersions?: (track: LibraryTrack) => void;
  onOpenMenu?: (track: LibraryTrack, position: { x: number; y: number }) => void;
  isDraggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>, track: LibraryTrack) => void;
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

const tagsFromTrack = (track: LibraryTrack): HifiTag[] => {
  const tags: HifiTag[] = [];
  const codec = track.codec?.toUpperCase();

  if (codec) {
    tags.push({
      label: codec,
      kind: codec === 'FLAC' ? 'flac' : isDsdCodec(codec) ? 'dsf' : 'lossless',
    });
  }

  if (track.bitDepth && track.sampleRate) {
    tags.push({
      label: `${track.bitDepth}bit / ${track.sampleRate >= 1000 ? `${Math.round(track.sampleRate / 1000)}kHz` : `${track.sampleRate}Hz`}`,
      kind: isHiResAudioSpec(track) ? 'hires' : 'depth',
    });
  } else if (track.sampleRate) {
    tags.push({
      label: `${Math.round(track.sampleRate / 1000)}kHz`,
      kind: 'rate',
    });
  }

  if (track.bitrate) {
    tags.push({
      label: `${Math.round(track.bitrate / 1000)}kbps`,
      kind: 'bitrate',
    });
  }

  if (isDisplayableBpmAnalysis(track.bpm, track.analysisStatus)) {
    tags.push({
      label: `${Math.round(track.bpm)} BPM`,
      kind: 'bpm',
    });
  }

  return tags.slice(0, 5);
};

const tagClassNameByKind: Record<HifiTagKind, string> = {
  flac: 'tag-flac',
  lossless: 'tag-lossless',
  depth: 'tag-depth',
  rate: 'tag-depth',
  bitrate: 'tag-depth',
  bpm: 'tag-bpm',
  dsf: 'tag-flac',
  hires: 'tag-hires',
};

export const TrackRow = memo(
  ({ track, isPlaying, isSelected = false, duplicateHiddenCount = 0, onPlay, onToggleSelected, onAddToQueue, onAddToPlaylist, onDownload, onOpenArtist, onOpenAlbum, isLoading = false, isDownloading = false, downloadProgress = null, onShowVersions, onOpenMenu, isDraggable = false, isDragging = false, isDropTarget = false, onDragStart, onDragOver, onDrop, onDragEnd }: TrackRowProps): JSX.Element => {
    const t = useOptionalI18n()?.t ?? translateFallback;
    const tags = tagsFromTrack(track);
    const isUnavailable = track.unavailable === true;
    const remoteSourceLabel = track.mediaType === 'remote' ? track.sourceDisplayName ?? track.provider ?? t('library.source.remote') : null;
    const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
    const shouldShowCover = Boolean(track.coverThumb && track.coverThumb !== failedCoverUrl);
    const coverLoading = track.coverThumb?.startsWith('echo-image://subsonic-cover/') ? 'eager' : 'lazy';
    const canAdd = Boolean(onAddToPlaylist || onAddToQueue);
    const canDownload = Boolean(onDownload) && track.provider !== 'spotify';
    const hasRowActions = canAdd || canDownload || Boolean(onOpenMenu);
    const downloadPercent =
      typeof downloadProgress === 'number' && Number.isFinite(downloadProgress)
        ? Math.max(0, Math.min(100, Math.round(downloadProgress)))
        : null;
    const handleRowClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onToggleSelected?.(track);
        return;
      }

      if (isUnavailable) {
        return;
      }

      onPlay?.(track);
    }, [isUnavailable, onPlay, onToggleSelected, track]);
    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!isUnavailable) {
            onPlay?.(track);
          }
        }
      },
      [isUnavailable, onPlay, track],
    );
    const stopActionPropagation = useCallback((event: MouseEvent): void => {
      event.stopPropagation();
    }, []);
    const handleContextMenu = useCallback(
      (event: MouseEvent<HTMLDivElement>): void => {
        if (!onOpenMenu) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(track, { x: event.clientX, y: event.clientY });
      },
      [onOpenMenu, track],
    );
    const handleMoreClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu?.(track, { x: rect.right - 12, y: rect.bottom + 8 });
      },
      [onOpenMenu, track],
    );
    const handleAddToQueue = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onAddToQueue?.(track);
      },
      [onAddToQueue, track],
    );
    const handleAddToPlaylist = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onAddToPlaylist?.(track);
      },
      [onAddToPlaylist, track],
    );
    const handleDownload = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onDownload?.(track);
      },
      [onDownload, track],
    );
    const handleOpenArtist = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onOpenArtist?.(track);
      },
      [onOpenArtist, track],
    );
    const handleOpenAlbum = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onOpenAlbum?.(track);
      },
      [onOpenAlbum, track],
    );
    const handleShowVersions = useCallback(
      (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        onShowVersions?.(track);
      },
      [onShowVersions, track],
    );
    const handleCoverError = useCallback((): void => {
      if (!track.coverThumb) {
        return;
      }

      if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.warn('Failed to load track cover', {
          url: track.coverThumb,
          trackId: track.id,
        });
      }

      setFailedCoverUrl(track.coverThumb);
    }, [track.coverThumb, track.id]);
    const handleDragStart = useCallback(
      (event: DragEvent<HTMLDivElement>): void => {
        onDragStart?.(event, track);
      },
      [onDragStart, track],
    );
    const handleDragOver = useCallback(
      (event: DragEvent<HTMLDivElement>): void => {
        onDragOver?.(event, track);
      },
      [onDragOver, track],
    );
    const handleDrop = useCallback(
      (event: DragEvent<HTMLDivElement>): void => {
        onDrop?.(event, track);
      },
      [onDrop, track],
    );
    const handleDragEnd = useCallback(
      (event: DragEvent<HTMLDivElement>): void => {
        onDragEnd?.(event, track);
      },
      [onDragEnd, track],
    );

    return (
      <div
        className="track-row"
        data-clickable={Boolean(onPlay) && !isUnavailable}
        data-draggable={isDraggable ? 'true' : undefined}
        data-dragging={isDragging ? 'true' : undefined}
        data-drop-target={isDropTarget ? 'true' : undefined}
        data-playing={isPlaying}
        data-loading={isLoading ? 'true' : undefined}
        data-selected={isSelected ? 'true' : undefined}
        data-unavailable={isUnavailable ? 'true' : undefined}
        draggable={isDraggable}
        role="listitem"
        tabIndex={onPlay && !isUnavailable ? 0 : undefined}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
      >
        {isDraggable ? (
          <span className="track-drag-handle" aria-label={`拖动调整顺序：${track.title}`} title="拖动调整顺序">
            <GripVertical size={16} />
          </span>
        ) : null}
        <div className="track-cover" data-empty={!shouldShowCover} aria-hidden="true">
          {shouldShowCover ? (
            <img alt="" decoding="async" draggable={false} height={96} loading={coverLoading} src={track.coverThumb!} width={96} onError={handleCoverError} />
          ) : (
            <Music2 size={22} />
          )}
        </div>

        <div className="track-main">
          <div className="track-title-row">
            {isLoading ? <Loader2 className="spinning-icon track-loading-icon" size={13} aria-hidden="true" /> : isPlaying ? <span className="playing-dot" aria-hidden="true" /> : null}
            <strong className="track-title">{track.title}</strong>
            {remoteSourceLabel ? <span className="remote-track-source-badge">{remoteSourceLabel}</span> : null}
            {isLoading ? <span className="playing-pill loading-pill">加载中</span> : isPlaying ? <span className="playing-pill">{t('library.trackRow.status.playing')}</span> : null}
            {isUnavailable ? <span className="playing-pill unavailable-pill">{t('library.trackRow.status.unavailable')}</span> : null}
            {duplicateHiddenCount > 0 ? (
              <button className="duplicate-version-badge" type="button" title={t('library.trackRow.duplicateVersions.title')} onClick={handleShowVersions}>
                {t('library.trackRow.duplicateVersions.count', { count: duplicateHiddenCount + 1 })}
              </button>
            ) : null}
          </div>
          <div className="track-subtitle">
            {onOpenArtist ? (
              <button className="track-subtitle-link" type="button" title={t('library.trackRow.openArtist', { artist: track.artist })} onClick={handleOpenArtist}>
                {track.artist}
              </button>
            ) : (
              <span>{track.artist}</span>
            )}
            <span className="track-subtitle-separator">-</span>
            {onOpenAlbum ? (
              <button className="track-subtitle-link" type="button" title={t('library.trackRow.openAlbum', { album: track.album })} onClick={handleOpenAlbum}>
                {track.album}
              </button>
            ) : (
              <span>{track.album}</span>
            )}
          </div>
          <div className="tag-row track-tags" aria-label={t('library.trackRow.audioSpecifications')}>
            {tags.map((tag) => (
              <span className={`hifi-tag ${tagClassNameByKind[tag.kind]}`} key={`${track.id}-${tag.label}`}>
                {tag.label}
              </span>
            ))}
            {track.mediaType === 'remote' && track.provider !== 'subsonic' && track.remotePath ? <span className="hifi-tag tag-remote-path" title={track.remotePath}>{track.remotePath}</span> : null}
          </div>
        </div>

        <div className="track-duration">{formatDuration(track.duration)}</div>

        {hasRowActions ? (
          <div className="track-actions" aria-label={t('library.trackRow.actions', { title: track.title })} onClick={stopActionPropagation} onDoubleClick={stopActionPropagation}>
            {canAdd ? (
              <button
                className="row-action"
                type="button"
                aria-label={t(onAddToPlaylist ? 'library.trackRow.action.addToPlaylistLabel' : 'library.trackRow.action.addToQueueLabel', { title: track.title })}
                title={t(onAddToPlaylist ? 'library.trackRow.action.addToPlaylist' : 'library.trackRow.action.addToQueue')}
                disabled={isUnavailable}
                onClick={onAddToPlaylist ? handleAddToPlaylist : handleAddToQueue}
              >
                <ListPlus size={16} />
              </button>
            ) : null}
            {canDownload ? (
              <button
                className="row-action"
                type="button"
                aria-label={
                  isDownloading && downloadPercent !== null
                    ? t('library.trackRow.action.downloadingLabel', { title: track.title, percent: downloadPercent })
                    : t('library.trackRow.action.downloadLabel', { title: track.title })
                }
                title={isDownloading && downloadPercent !== null ? t('library.trackRow.action.downloading', { percent: downloadPercent }) : t('library.trackRow.action.download')}
                disabled={isUnavailable || isDownloading}
                onClick={handleDownload}
              >
                {isDownloading && downloadPercent !== null ? (
                  <span className="row-action-progress" aria-hidden="true">{downloadPercent}%</span>
                ) : isDownloading ? (
                  <Loader2 className="spinning-icon" size={16} />
                ) : (
                  <Download size={16} />
                )}
              </button>
            ) : null}
            {onOpenMenu ? (
              <button className="row-action" type="button" aria-label={t('library.trackRow.action.moreLabel', { title: track.title })} title={t('library.trackRow.action.more')} onClick={handleMoreClick}>
                <MoreHorizontal size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
  (previous, next) =>
    previous.track === next.track &&
    previous.isPlaying === next.isPlaying &&
    previous.isSelected === next.isSelected &&
    previous.duplicateHiddenCount === next.duplicateHiddenCount &&
    previous.onPlay === next.onPlay &&
    previous.onToggleSelected === next.onToggleSelected &&
    previous.onAddToQueue === next.onAddToQueue &&
    previous.onAddToPlaylist === next.onAddToPlaylist &&
    previous.onDownload === next.onDownload &&
    previous.onOpenArtist === next.onOpenArtist &&
    previous.onOpenAlbum === next.onOpenAlbum &&
    previous.isLoading === next.isLoading &&
    previous.isDownloading === next.isDownloading &&
    previous.downloadProgress === next.downloadProgress &&
    previous.onShowVersions === next.onShowVersions &&
    previous.onOpenMenu === next.onOpenMenu &&
    previous.isDraggable === next.isDraggable &&
    previous.isDragging === next.isDragging &&
    previous.isDropTarget === next.isDropTarget &&
    previous.onDragStart === next.onDragStart &&
    previous.onDragOver === next.onDragOver &&
    previous.onDrop === next.onDrop &&
    previous.onDragEnd === next.onDragEnd,
);

TrackRow.displayName = 'TrackRow';
