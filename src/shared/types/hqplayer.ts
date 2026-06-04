import type { PlaybackResolvedMediaSource } from './playback';
import type { PlayableTrack } from './remoteSources';
import type { StreamingPlaybackSource } from './streaming';

export type HqPlayerConnectionMode = 'localDesktop' | 'remote';

export type HqPlayerDefaultPlaybackBackend = 'echoNative' | 'hqplayer' | 'ask';

export type HqPlayerSettings = {
  enabled: boolean;
  connectionMode: HqPlayerConnectionMode;
  host: string;
  port: number | null;
  executablePath: string | null;
  allowLaunch: boolean;
  mediaServerEnabled: boolean;
  mediaServerPort: number | null;
  defaultPlaybackBackend: HqPlayerDefaultPlaybackBackend;
  profileName: string | null;
};

export type HqPlayerConnectionState =
  | 'disabled'
  | 'not-configured'
  | 'checking'
  | 'available'
  | 'unavailable';

export type HqPlayerEndpoint = {
  connectionMode: HqPlayerConnectionMode;
  host: string;
  port: number | null;
};

export type HqPlayerStatus = {
  enabled: boolean;
  state: HqPlayerConnectionState;
  endpoint: HqPlayerEndpoint;
  mediaServerEnabled: boolean;
  defaultPlaybackBackend: HqPlayerDefaultPlaybackBackend;
  profileName: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  controlInfo?: HqPlayerControlInfo | null;
  playbackStatus?: HqPlayerRemotePlaybackStatus | null;
};

export type HqPlayerConnectionTestResult = {
  ok: boolean;
  state: HqPlayerConnectionState;
  endpoint: HqPlayerEndpoint;
  elapsedMs: number;
  checkedAt: string;
  error: string | null;
  controlInfo?: HqPlayerControlInfo | null;
  playbackStatus?: HqPlayerRemotePlaybackStatus | null;
};

export type HqPlayerControlInfo = {
  name: string | null;
  product: string | null;
  version: string | null;
  platform: string | null;
  engine: string | null;
  receivedAt: string;
};

export type HqPlayerRemotePlaybackState = 'stopped' | 'paused' | 'playing' | 'stop-requested' | 'unknown';

export type HqPlayerRemotePlaybackMetadata = {
  uri: string | null;
  mime: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  composer: string | null;
  performer: string | null;
  genre: string | null;
  date: string | null;
  sampleRate: number | null;
  bits: number | null;
  channels: number | null;
  bitrate: number | null;
};

export type HqPlayerRemotePlaybackStatus = {
  state: HqPlayerRemotePlaybackState;
  stateCode: number | null;
  track: number | null;
  trackId: string | null;
  tracksTotal: number | null;
  queued: boolean | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  volume: number | null;
  activeMode: string | null;
  activeFilter: string | null;
  activeShaper: string | null;
  activeRate: number | null;
  activeBits: number | null;
  activeChannels: number | null;
  inputFill: number | null;
  outputFill: number | null;
  outputDelayUs: number | null;
  apodizing: number | null;
  metadata: HqPlayerRemotePlaybackMetadata | null;
  receivedAt: string;
};

export type HqPlayerPlaybackHandoffState = 'ready' | 'needs-confirmation' | 'fallback';

export type HqPlayerPlaybackHandoffReason =
  | 'hqplayer_disabled'
  | 'hqplayer_control_port_not_configured'
  | 'hqplayer_confirmation_required'
  | 'echo_native_selected'
  | 'remote_hqplayer_requires_media_server'
  | 'media_server_not_ready'
  | 'spotify_sdk_required'
  | 'streaming_item_unplayable'
  | 'streaming_proxy_required'
  | 'source_requires_headers'
  | 'source_resolution_failed'
  | 'unsupported_media_type';

export type HqPlayerPlaybackHandoffExposure = 'local-file' | 'loopback-http' | 'direct-http' | 'media-server';

export type HqPlayerPlaybackHandoffRequest = {
  item: PlayableTrack;
  startSeconds?: number;
  forceRefresh?: boolean;
  confirmed?: boolean;
  resolvedSource?: Pick<PlaybackResolvedMediaSource, 'filePath' | 'inputHeaders' | 'mimeType' | 'durationSeconds' | 'probe'> | null;
};

export type HqPlayerPlaybackHandoffSource = {
  trackId: string;
  mediaType: PlayableTrack['mediaType'];
  title: string;
  artist: string;
  album: string;
  url: string;
  exposure: HqPlayerPlaybackHandoffExposure;
  headers: Record<string, string>;
  mimeType: string | null;
  expiresAt: string | null;
  durationSeconds: number | null;
  startSeconds: number;
  mediaServer: {
    url: string;
    port: number | null;
    bindHost: string | null;
    publicHost: string | null;
    remoteAccess: boolean;
    publicHostCandidates: string[];
  } | null;
  streaming?: Pick<
    StreamingPlaybackSource,
    'provider' | 'providerTrackId' | 'bitrate' | 'sampleRate' | 'bitDepth' | 'codec' | 'supportsRange'
  > | null;
};

export type HqPlayerPlaybackControlPlanState = 'prepared' | 'skipped';

export type HqPlayerPlaybackControlPlanReason = 'handoff_not_ready' | 'source_missing';

export type HqPlayerPlaybackControlSendState = 'prepared' | 'sent' | 'failed' | 'skipped';

export type HqPlayerPlaybackControlSendReason =
  | 'control_plan_missing'
  | HqPlayerPlaybackControlPlanReason
  | 'source_requires_headers'
  | 'hqplayer_control_port_not_configured'
  | 'hqplayer_connection_timeout'
  | 'hqplayer_connection_refused'
  | 'hqplayer_connection_failed'
  | 'hqplayer_protocol_error'
  | 'hqplayer_response_error';

export type HqPlayerPlaybackControlSendResult = {
  state: HqPlayerPlaybackControlSendState;
  reason: HqPlayerPlaybackControlSendReason | null;
  transport: 'official-control-tcp';
  command: 'PlayNextURI+Play' | 'PlayNextURI+Play+Seek' | 'Seek' | 'Stop' | 'none';
  endpoint: HqPlayerEndpoint;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  message: string | null;
  response: string | null;
};

export type HqPlayerPlaybackControlPlan = {
  state: HqPlayerPlaybackControlPlanState;
  reason: HqPlayerPlaybackControlPlanReason | null;
  action: 'play-source' | 'none';
  transport: 'dry-run';
  endpoint: HqPlayerEndpoint;
  profileName: string | null;
  source: {
    trackId: string;
    mediaType: PlayableTrack['mediaType'];
    url: string;
    exposure: HqPlayerPlaybackHandoffExposure;
    mimeType: string | null;
    expiresAt: string | null;
    hasHeaders: boolean;
  } | null;
  metadata: {
    title: string;
    artist: string;
    album: string;
    durationSeconds: number | null;
  } | null;
  startSeconds: number | null;
  createdAt: string;
  send: HqPlayerPlaybackControlSendResult | null;
};

export type HqPlayerPlaybackHandoffFallback = {
  backend: 'echoNative';
  reason: HqPlayerPlaybackHandoffReason;
};

export type HqPlayerPlaybackHandoffPlan = {
  state: HqPlayerPlaybackHandoffState;
  reason: HqPlayerPlaybackHandoffReason | null;
  endpoint: HqPlayerEndpoint;
  defaultPlaybackBackend: HqPlayerDefaultPlaybackBackend;
  profileName: string | null;
  source: HqPlayerPlaybackHandoffSource | null;
  fallback: HqPlayerPlaybackHandoffFallback | null;
  control: HqPlayerPlaybackControlPlan;
  createdAt: string;
};
