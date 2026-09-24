export type EchoLinkPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
export type EchoLinkPlaybackOrderMode = 'sequential' | 'shuffle' | 'repeat-one';

export type EchoLinkDevice = {
  id: string;
  name: string;
};

export type EchoLinkTrackPreview = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  artworkUrl: string | null;
  durationMs: number;
  sourceLabel: string;
  canPlayOnPhone: boolean;
  codec?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  bitrate?: number | null;
};

export type EchoLinkAlbumPreview = {
  id: string;
  title: string;
  albumArtist: string;
  artworkUrl: string | null;
  trackCount: number;
  durationMs: number;
  sourceLabel: string;
  year: number | null;
};

export type EchoLinkQueuePreview = {
  currentTrackId: string | null;
  items: EchoLinkTrackPreview[];
};

export type EchoLinkPlayback = {
  state: EchoLinkPlaybackState;
  track: EchoLinkTrackPreview | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  outputMode: string;
  updatedAtEpochMs: number;
  queue?: EchoLinkQueuePreview;
};

export type EchoLinkStatusResponse = {
  device: EchoLinkDevice;
  playback: EchoLinkPlayback;
};

export type EchoLinkLibraryTracksResponse = {
  tracks: EchoLinkTrackPreview[];
  totalCount: number;
};

export type EchoLinkLibraryAlbumsResponse = {
  albums: EchoLinkAlbumPreview[];
  totalCount: number;
};

export type EchoLinkLibraryAlbumTracksResponse = {
  album: EchoLinkAlbumPreview;
  tracks: EchoLinkTrackPreview[];
  totalCount: number;
};

export type EchoLinkWebBackgroundType = 'none' | 'image' | 'video';

export type EchoLinkWebBackground = {
  type: EchoLinkWebBackgroundType;
  url: string;
};

export type EchoLinkSettingsResponse = {
  webBackground: EchoLinkWebBackground;
};

export type EchoLinkStreamResponse = {
  streamUrl: string;
  expiresAtEpochMs: number;
  track: EchoLinkTrackPreview;
};

export type EchoLinkServerStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  host: string;
  addresses: string[];
  pairingUri: string | null;
  webControlUrl: string | null;
  token: string;
  deviceName: string;
  deviceId: string;
  webBackground: EchoLinkWebBackground;
  activeMediaTokens: number;
  activeArtworkTokens: number;
  mdns: {
    state: 'disabled' | 'advertising' | 'error';
    serviceName: string;
    error: string | null;
    advertisedAddresses: string[];
  };
  diagnostics: {
    selectedLanAddress: string;
    lastPhoneConnectionAt: string | null;
    lastAuthFailureAt: string | null;
    authFailureCount: number;
    lastMediaTokenServed: {
      tokenPrefix: string;
      range: string | null;
      bytes: number | null;
      servedAt: string;
    } | null;
    recentHttpErrors: Array<{
      at: string;
      path: string;
      statusCode: number;
      message: string;
    }>;
  };
  error: string | null;
  updatedAt: string;
};

export type EchoLinkPlaybackCommand =
  | { command: 'playPause' }
  | { command: 'next' }
  | { command: 'previous' }
  | { command: 'stop' }
  | { command: 'seekTo'; positionMs: number }
  | { command: 'setVolume'; volume: number }
  | { command: 'playTrack'; trackId: string; output: 'pc' }
  | { command: 'handoff'; trackId: string; positionMs: number; target: 'pc' }
  | { command: 'queueReplace'; trackIds: string[]; startTrackId?: string; output: 'pc' };

export type EchoLinkV2Scope = 'status:read' | 'events:read' | 'playback:control';

export type EchoLinkPairedClient = {
  id: string;
  name: string;
  platform: string | null;
  scopes: EchoLinkV2Scope[];
  createdAt: string;
  lastSeenAt: string | null;
};

export type EchoLinkBasicStatus = {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  addresses: string[];
  deviceId: string;
  deviceName: string;
  pairingActive: boolean;
  clients: EchoLinkPairedClient[];
  error: string | null;
  updatedAt: string;
};

export type EchoLinkPairingSession = {
  id: string;
  pairingUri: string;
  webRemoteUrl: string;
  qrDataUrl: string;
  expiresAt: string;
};

export type EchoLinkV2PlaybackSnapshot = {
  version: 1;
  revision: number;
  observedAt: string;
  state: EchoLinkPlaybackState;
  track: {
    id: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
  } | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  playbackOrder: EchoLinkPlaybackOrderMode;
  output: {
    mode: string;
    deviceName: string | null;
  };
};

export type EchoLinkV2StatusResponse = {
  apiVersion: 2;
  device: EchoLinkDevice;
  capabilities: {
    scopes: EchoLinkV2Scope[];
    playbackActions: Array<'play' | 'pause' | 'stop' | 'previous' | 'next' | 'seek' | 'setVolume' | 'setPlaybackOrder'>;
  };
  playback: EchoLinkV2PlaybackSnapshot;
};
