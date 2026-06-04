export type SmtcPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error';

export type SmtcButtonCommand = 'play' | 'pause' | 'playPause' | 'previous' | 'next' | 'stop';

export type SmtcSeekCommand = {
  type: 'seek';
  positionSeconds: number;
};

export type SmtcCommand = SmtcButtonCommand | SmtcSeekCommand;

export type SmtcTrackMetadata = {
  trackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  durationSeconds: number;
  positionSeconds: number;
  coverPath: string | null;
  coverUrl: string | null;
};

export type SmtcLyricsProgress = {
  trackId: string | null;
  lineText: string | null;
  lineIndex: number | null;
  lineCount: number | null;
  lineStartMs: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
};

export type SmtcEnabledActions = {
  play: boolean;
  pause: boolean;
  previous: boolean;
  next: boolean;
  seek?: boolean;
};

export type SmtcHostState =
  | 'disabled'
  | 'unsupported'
  | 'not-initialized'
  | 'missing'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'unavailable'
  | 'error';

export type SmtcDiagnosticEvent = {
  at: string;
  source: 'service' | 'host' | 'sync' | 'command' | 'recovery';
  message: string;
};

export type SmtcDiagnostics = {
  enabled: boolean;
  platform: string;
  hostState: SmtcHostState;
  initialized: boolean;
  hostPath: string | null;
  lastMetadataAt: string | null;
  lastMetadataTrackId: string | null;
  lastMetadataTitle: string | null;
  lastMetadataArtist: string | null;
  lastPlaybackState: SmtcPlaybackState | null;
  lastPlaybackStateAt: string | null;
  lastTimelineAt: string | null;
  lastTimelinePositionSeconds: number | null;
  lastTimelineDurationSeconds: number | null;
  enabledActions: SmtcEnabledActions | null;
  lastCommand: SmtcCommand | null;
  lastCommandAt: string | null;
  lastError: SmtcDiagnosticEvent | null;
  recentErrors: SmtcDiagnosticEvent[];
  recoveryInFlight: boolean;
  recoveryAttemptsInWindow: number;
  canRecover: boolean;
  lastRecoveryAt: string | null;
  lyricsEnabled: boolean;
};
