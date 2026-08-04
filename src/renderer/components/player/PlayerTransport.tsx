import {
  Heart,
  Film,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { RepeatMode } from '../../stores/PlaybackQueueProvider';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

type PlayerTransportProps = {
  isPlaying: boolean;
  isShuffleEnabled: boolean;
  repeatMode: RepeatMode;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  onOpenQueue?: () => void;
  onOpenLyrics: () => void;
  onOpenMv: () => void;
  showQueueButton?: boolean;
  isCurrentTrackLiked?: boolean;
  canLikeCurrentTrack?: boolean;
  onToggleCurrentTrackLiked?: () => void;
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
  onToggleShuffle,
  onCycleRepeatMode,
  onOpenQueue,
  onOpenLyrics,
  onOpenMv,
  showQueueButton = false,
  isCurrentTrackLiked = false,
  canLikeCurrentTrack = false,
  onToggleCurrentTrackLiked,
}: PlayerTransportProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const likeAriaLabel = t(isCurrentTrackLiked ? 'playerTransport.action.unlikeCurrent' : 'playerTransport.action.likeCurrent');
  const likeTitle = t(isCurrentTrackLiked ? 'playerTransport.action.unlike' : 'playerTransport.action.like');
  const playPauseLabel = t(isPlaying ? 'playerTransport.action.pause' : 'playerTransport.action.play');
  const repeatTitle = t(repeatMode === 'one' ? 'playerTransport.action.repeatOne' : 'playerTransport.action.playInOrder');

  return (
    <div className="transport">
      <button
        className={`icon-button transport-like-button ${isCurrentTrackLiked ? 'is-soft-active' : ''}`}
        type="button"
        aria-label={likeAriaLabel}
        aria-pressed={isCurrentTrackLiked}
        title={likeTitle}
        disabled={!canLikeCurrentTrack}
        onClick={onToggleCurrentTrackLiked}
      >
        <Heart size={17} fill={isCurrentTrackLiked ? 'currentColor' : 'none'} />
      </button>
      {showQueueButton ? (
        <button className="icon-button" type="button" aria-label={t('playerTransport.action.queue')} title={t('playerTransport.action.queue')} onClick={onOpenQueue}>
          <ListMusic size={17} />
        </button>
      ) : null}
      <button
        className={`icon-button ${isShuffleEnabled ? 'is-soft-active' : ''}`}
        type="button"
        aria-label={t('playerTransport.action.shuffle')}
        aria-pressed={isShuffleEnabled}
        title={t('playerTransport.action.shuffle')}
        onClick={onToggleShuffle}
      >
        <Shuffle size={17} />
      </button>
      <button className="icon-button transport-skip-button" type="button" aria-label={t('playerTransport.action.previous')} title={t('playerTransport.action.previous')} disabled={!canGoPrevious} onClick={onPrevious}>
        <SkipBack size={18} />
      </button>
      <button className="play-button" type="button" aria-label={playPauseLabel} title={playPauseLabel} onClick={onPlayPause}>
        {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>
      <button className="icon-button transport-skip-button" type="button" aria-label={t('playerTransport.action.next')} title={t('playerTransport.action.next')} disabled={!canGoNext} onClick={onNext}>
        <SkipForward size={18} />
      </button>
      <button
        className={`icon-button ${repeatMode === 'one' ? 'is-soft-active' : ''}`}
        type="button"
        aria-label={t('playerTransport.action.repeat')}
        aria-pressed={repeatMode === 'one'}
        title={repeatTitle}
        onClick={onCycleRepeatMode}
      >
        {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat2 size={17} />}
      </button>
      <button className="icon-button" type="button" aria-label={t('playerTransport.action.lyrics')} title={t('playerTransport.action.lyrics')} onClick={onOpenLyrics}>
        <Mic2 size={17} />
      </button>
      <button className="icon-button" type="button" aria-label={t('playerTransport.action.mv')} title={t('playerTransport.action.mv')} onClick={onOpenMv}>
        <Film size={17} />
      </button>
    </div>
  );
};
