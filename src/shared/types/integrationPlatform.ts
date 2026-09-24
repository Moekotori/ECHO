import type { AudioPlaybackState, AudioOutputMode } from './audio';
import type { PlaybackOrderMode } from './playback';

export type IntegrationTrackSnapshot = {
  id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  artworkUrl: string | null;
};

export type IntegrationOutputSnapshot = {
  mode: AudioOutputMode;
  deviceName: string | null;
  backend: string | null;
};

export type IntegrationPlaybackSnapshotV1 = {
  version: 1;
  revision: number;
  observedAt: string;
  state: AudioPlaybackState;
  track: IntegrationTrackSnapshot | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  output: IntegrationOutputSnapshot;
};

export type IntegrationEventType =
  | 'snapshot'
  | 'playback.state.changed'
  | 'playback.track.changed'
  | 'playback.progress.changed'
  | 'playback.volume.changed'
  | 'playback.output.changed';

export type IntegrationEventEnvelopeV1 = {
  version: 1;
  id: string;
  type: IntegrationEventType;
  occurredAt: string;
  snapshot: IntegrationPlaybackSnapshotV1;
};

export type IntegrationPlaybackAction =
  | { requestId: string; action: 'play' }
  | { requestId: string; action: 'pause' }
  | { requestId: string; action: 'stop' }
  | { requestId: string; action: 'previous' }
  | { requestId: string; action: 'next' }
  | { requestId: string; action: 'seek'; positionMs: number }
  | { requestId: string; action: 'setVolume'; volume: number }
  | { requestId: string; action: 'setPlaybackOrder'; mode: PlaybackOrderMode };

export type IntegrationPlaybackActionResult = {
  requestId: string;
  ok: true;
  completedAt: string;
};
