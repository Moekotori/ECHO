import type { AudioPlaybackState } from '../../../shared/types/audio';

type MediaSessionCommandHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onStop: () => void;
  onSeek: (positionSeconds: number) => void;
  getPositionSeconds: () => number;
};

export type MediaSessionSnapshot = {
  enabled: boolean;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  state: AudioPlaybackState;
  positionSeconds: number;
  durationSeconds: number;
  playbackRate: number;
};

const mediaSessionActions: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'stop',
  'seekto',
  'seekbackward',
  'seekforward',
];

const getMediaSession = (): MediaSession | null => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return null;
  }

  return navigator.mediaSession;
};

const inferArtworkType = (url: string): string | undefined => {
  const extension = url.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase();

  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }

  if (extension === 'png') {
    return 'image/png';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  return undefined;
};

const isSupportedMediaSessionArtworkUrl = (url: string): boolean =>
  /^(?:https?|data|blob):/iu.test(url);

const clampPosition = (positionSeconds: number, durationSeconds: number): number =>
  Math.max(0, Math.min(durationSeconds, Number.isFinite(positionSeconds) ? positionSeconds : 0));

export const clearMediaSession = (): void => {
  const session = getMediaSession();

  if (!session) {
    return;
  }

  try {
    session.metadata = null;
    session.playbackState = 'none';
  } catch {
    // Some Chromium builds can throw while tearing down the media session.
  }
};

export const applyMediaSessionSnapshot = (snapshot: MediaSessionSnapshot): void => {
  const session = getMediaSession();

  if (!session) {
    return;
  }

  if (!snapshot.enabled) {
    clearMediaSession();
    return;
  }

  if (typeof MediaMetadata !== 'undefined') {
    const artwork = snapshot.artworkUrl && isSupportedMediaSessionArtworkUrl(snapshot.artworkUrl)
      ? [
          {
            src: snapshot.artworkUrl,
            sizes: '512x512',
            type: inferArtworkType(snapshot.artworkUrl),
          },
        ]
      : undefined;

    session.metadata = new MediaMetadata({
      title: snapshot.title,
      artist: snapshot.artist,
      album: snapshot.album ?? '',
      artwork,
    });
  }

  session.playbackState = snapshot.state === 'playing' || snapshot.state === 'loading' ? 'playing' : 'paused';

  if (snapshot.durationSeconds > 0 && typeof session.setPositionState === 'function') {
    try {
      session.setPositionState({
        duration: snapshot.durationSeconds,
        playbackRate: snapshot.playbackRate > 0 ? snapshot.playbackRate : 1,
        position: clampPosition(snapshot.positionSeconds, snapshot.durationSeconds),
      });
    } catch {
      // Chromium validates this strictly; metadata and actions should still work if position is rejected.
    }
  }
};

export const bindMediaSessionActions = (handlers: MediaSessionCommandHandlers): (() => void) => {
  const session = getMediaSession();

  if (!session) {
    return () => undefined;
  }

  const setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Older Chromium builds may not support every action.
    }
  };

  setActionHandler('play', handlers.onPlay);
  setActionHandler('pause', handlers.onPause);
  setActionHandler('previoustrack', handlers.onPrevious);
  setActionHandler('nexttrack', handlers.onNext);
  setActionHandler('stop', handlers.onStop);
  setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') {
      handlers.onSeek(details.seekTime);
    }
  });
  setActionHandler('seekbackward', (details) => {
    handlers.onSeek(Math.max(0, handlers.getPositionSeconds() - (details.seekOffset ?? 10)));
  });
  setActionHandler('seekforward', (details) => {
    handlers.onSeek(handlers.getPositionSeconds() + (details.seekOffset ?? 10));
  });

  return () => {
    for (const action of mediaSessionActions) {
      setActionHandler(action, null);
    }
  };
};
