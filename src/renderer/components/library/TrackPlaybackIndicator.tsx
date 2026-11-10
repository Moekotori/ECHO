import { useSharedPlaybackStatus } from '../../stores/playbackStatusStore';

export const TrackPlaybackIndicator = ({ trackId }: { trackId: string }): JSX.Element => {
  const { audioStatus, playbackStatus } = useSharedPlaybackStatus();
  const status = audioStatus ?? playbackStatus;
  const isAnimating = status?.currentTrackId === trackId && status.state === 'playing';

  return (
    <svg className="track-playback-indicator" data-animating={isAnimating} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="2" width="2" height="12" rx="1" />
      <rect x="5" y="2" width="2" height="12" rx="1" />
      <rect x="9" y="2" width="2" height="12" rx="1" />
      <rect x="13" y="2" width="2" height="12" rx="1" />
    </svg>
  );
};
