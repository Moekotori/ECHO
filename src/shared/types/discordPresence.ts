import type { AudioPlaybackState, AudioStatus } from './audio';

export type DiscordPresencePlaybackState = AudioPlaybackState;

export type DiscordPresenceTrack = {
  trackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  durationSeconds: number;
  positionSeconds: number;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  outputMode: string | null;
};

export type DiscordPresenceStatus = {
  enabled: boolean;
  available: boolean;
  connected: boolean;
  lastError: string | null;
  lastUpdatedAt: string | null;
};

export type DiscordPresenceAudioStatus = AudioStatus;
