import {
  Clapperboard,
  Heart,
  ListMusic,
  Captions,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { RepeatMode } from '../../stores/PlaybackQueueProvider';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { PlayerControlIcon } from './PlayerControlIcon';
import { getPlaybackModePresentation } from './playbackModePresentation';

type PlayerTransportProps = {
  isPlaying: boolean;
  isShuffleEnabled: boolean;
  repeatMode: RepeatMode;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onCyclePlaybackMode?: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onOpenMv: () => void;
  onOpenShuffleMenu?: (anchor: HTMLButtonElement) => void;
  onOpenQueue?: () => void;
  onOpenLyrics: () => void;
  onPreloadLyrics?: () => void;
  showQueueButton?: boolean;
  isCurrentTrackLiked?: boolean;
  canLikeCurrentTrack?: boolean;
  onToggleCurrentTrackLiked?: () => void;
  useLegacyIcons?: boolean;
};

export const PlayerTransport = ({
  isPlaying,
  isShuffleEnabled,
  repeatMode,
  canGoPrevious,
  canGoNext,
  onPlayPause,
  onPrevious,
  onNext,
  onCyclePlaybackMode,
  onToggleShuffle,
  onCycleRepeatMode,
  onOpenMv,
  onOpenShuffleMenu,
  onOpenQueue,
  onOpenLyrics,
  onPreloadLyrics,
  showQueueButton = false,
  isCurrentTrackLiked = false,
  canLikeCurrentTrack = false,
  onToggleCurrentTrackLiked,
  useLegacyIcons = false,
}: PlayerTransportProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const likeAriaLabel = t(isCurrentTrackLiked ? 'playerTransport.action.unlikeCurrent' : 'playerTransport.action.likeCurrent');
  const likeTitle = t(isCurrentTrackLiked ? 'playerTransport.action.unlike' : 'playerTransport.action.like');
  const playPauseLabel = t(isPlaying ? 'playerTransport.action.pause' : 'playerTransport.action.play');
  const playbackMode = getPlaybackModePresentation({ isShuffleEnabled, repeatMode });
  const playbackModeTitle = t(playbackMode.titleKey);
  const PlaybackModeIcon = playbackMode.Icon;
  const isSpecialMode = playbackMode.id !== 'sequential';
  const isShuffleMode = playbackMode.id === 'shuffle';

  return (
    <div className="transport">
      <button
        className={`icon-button transport-tool-button transport-like-button ${isCurrentTrackLiked ? 'is-soft-active' : ''}`}
        data-workshop-icon="transport-like"
        type="button"
        aria-label={likeAriaLabel}
        aria-pressed={isCurrentTrackLiked}
        title={likeTitle}
        disabled={!canLikeCurrentTrack}
        onClick={onToggleCurrentTrackLiked}
      >
        {useLegacyIcons ? (
          <Heart size={18} strokeWidth={1.8} fill={isCurrentTrackLiked ? 'currentColor' : 'none'} />
        ) : isCurrentTrackLiked ? (
          <Heart className="transport-like-filled-icon" size={23} strokeWidth={0} fill="currentColor" aria-hidden="true" />
        ) : (
          <Heart className="transport-like-outline-icon" size={23} strokeWidth={1.8} fill="none" aria-hidden="true" />
        )}
      </button>
      <button className="icon-button transport-skip-button" data-workshop-icon="transport-previous" type="button" aria-label={t('playerTransport.action.previous')} title={t('playerTransport.action.previous')} disabled={!canGoPrevious} onClick={onPrevious}>
        {useLegacyIcons ? <SkipBack size={20} strokeWidth={1.9} /> : <PlayerControlIcon name="previous" />}
      </button>
      <button className={useLegacyIcons ? 'play-button' : 'player-primary-control'} data-workshop-icon={isPlaying ? 'transport-pause' : 'transport-play'} type="button" aria-label={playPauseLabel} title={playPauseLabel} onClick={onPlayPause}>
        {useLegacyIcons ? (
          isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />
        ) : (
          <PlayerControlIcon key={isPlaying ? 'pause' : 'play'} name={isPlaying ? 'pause' : 'play'} motion="primary-change" />
        )}
      </button>
      <button className="icon-button transport-skip-button" data-workshop-icon="transport-next" type="button" aria-label={t('playerTransport.action.next')} title={t('playerTransport.action.next')} disabled={!canGoNext} onClick={onNext}>
        {useLegacyIcons ? <SkipForward size={20} strokeWidth={1.9} /> : <PlayerControlIcon name="next" />}
      </button>
      <button
        className={`icon-button transport-mode-button transport-shuffle-button transport-repeat-button ${isSpecialMode ? 'is-soft-active' : ''}`}
        data-workshop-icon={playbackMode.workshopIcon}
        type="button"
        aria-label={playbackModeTitle}
        aria-pressed={isSpecialMode}
        aria-haspopup={isShuffleMode && onOpenShuffleMenu ? 'dialog' : undefined}
        title={playbackModeTitle}
        onClick={onCyclePlaybackMode ?? onCycleRepeatMode}
        onContextMenu={(event) => {
          if (!onOpenShuffleMenu) {
            event.preventDefault();
            onToggleShuffle();
          } else if (isShuffleMode) {
            event.preventDefault();
            onOpenShuffleMenu(event.currentTarget);
          }
        }}
      >
        <PlaybackModeIcon size={useLegacyIcons ? 18 : 22} strokeWidth={1.8} />
      </button>
      {showQueueButton ? (
        <button
          className="icon-button transport-tool-button transport-queue-button"
          data-playback-queue-toggle=""
          data-workshop-icon="transport-queue"
          type="button"
          aria-label={t('playerTransport.action.queue')}
          title={t('playerTransport.action.queue')}
          onClick={onOpenQueue}
        >
          <ListMusic size={18} strokeWidth={1.8} />
        </button>
      ) : null}
      <button
        className="icon-button transport-media-button transport-lyrics-button"
        data-workshop-icon="transport-lyrics"
        type="button"
        aria-label={t('playerTransport.action.lyrics')}
        title={t('playerTransport.action.lyrics')}
        onClick={onOpenLyrics}
        onPointerEnter={() => onPreloadLyrics?.()}
        onFocus={() => onPreloadLyrics?.()}
      >
        {useLegacyIcons ? <Captions size={18} strokeWidth={1.8} /> : <PlayerControlIcon name="lyrics" size={20} />}
      </button>
      <button className="icon-button transport-media-button transport-mv-button" type="button"
        aria-label={t('playerTransport.action.mv')} title={t('playerTransport.action.mv')} onClick={onOpenMv}>
        <Clapperboard size={18} strokeWidth={1.8} />
      </button>
    </div>
  );
};
