export type LastFmTrackPayload = {
  artist: string;
  title: string;
  album: string;
  duration: number;
  timestamp?: number;
};

export type LastFmStatus = {
  enabled: boolean;
  scrobbleEnabled: boolean;
  nowPlayingEnabled: boolean;
  connected: boolean;
  authPending: boolean;
  username: string | null;
  lastError: string | null;
  lastNowPlayingAt: string | null;
  lastScrobbleAt: string | null;
  activeTrack: {
    artist: string;
    title: string;
    album: string | null;
    playedSeconds: number;
    thresholdSeconds: number;
    scrobbled: boolean;
  } | null;
};

export type LastFmAuthStartResult = {
  ok: boolean;
  token?: string;
  url?: string;
  error?: string;
};
