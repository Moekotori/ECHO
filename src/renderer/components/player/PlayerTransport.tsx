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
}: PlayerTransportProps): JSX.Element => (
  <div className="transport">
    <button
      className={`icon-button ${isCurrentTrackLiked ? 'is-soft-active' : ''}`}
      type="button"
      aria-label={isCurrentTrackLiked ? 'Unlike current track' : 'Like current track'}
      aria-pressed={isCurrentTrackLiked}
      title={isCurrentTrackLiked ? 'Unlike' : 'Like'}
      disabled={!canLikeCurrentTrack}
      onClick={onToggleCurrentTrackLiked}
    >
      <Heart size={17} fill={isCurrentTrackLiked ? 'currentColor' : 'none'} />
    </button>
    {showQueueButton ? (
      <button className="icon-button" type="button" aria-label="Playback queue" title="Playback queue" onClick={onOpenQueue}>
        <ListMusic size={17} />
      </button>
    ) : null}
    <button
      className={`icon-button ${isShuffleEnabled ? 'is-soft-active' : ''}`}
      type="button"
      aria-label="Shuffle"
      aria-pressed={isShuffleEnabled}
      title="Shuffle"
      onClick={onToggleShuffle}
    >
      <Shuffle size={17} />
    </button>
    <button className="icon-button" type="button" aria-label="Previous" title="Previous" disabled={!canGoPrevious} onClick={onPrevious}>
      <SkipBack size={18} />
    </button>
    <button className="play-button" type="button" aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause' : 'Play'} onClick={onPlayPause}>
      {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
    </button>
    <button className="icon-button" type="button" aria-label="Next" title="Next" disabled={!canGoNext} onClick={onNext}>
      <SkipForward size={18} />
    </button>
    <button
      className={`icon-button ${repeatMode === 'one' ? 'is-soft-active' : ''}`}
      type="button"
      aria-label="Repeat"
      aria-pressed={repeatMode === 'one'}
      title={repeatMode === 'one' ? 'Repeat one' : 'Play in order'}
      onClick={onCycleRepeatMode}
    >
      {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat2 size={17} />}
    </button>
    <button className="icon-button" type="button" aria-label="Lyrics" title="Lyrics" onClick={onOpenLyrics}>
      <Mic2 size={17} />
    </button>
    <button className="icon-button" type="button" aria-label="MV" title="MV" onClick={onOpenMv}>
      <Film size={17} />
    </button>
  </div>
);
