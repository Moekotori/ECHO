import type { AudioPlaybackState, AudioOutputMode } from './audio';

export type StageBridgeServerStatus = {
  running: boolean;
  host: string;
  port: number | null;
  url: string | null;
  obsUrl: string | null;
  eventClients: number;
  obsEnabled: boolean;
  apiEnabled: boolean;
};

export type StageBridgeLyricLine = {
  timeMs: number;
  text: string;
  translation: string | null;
  romanization: string | null;
};

export type StageBridgeSnapshot = {
  version: 1;
  app: 'ECHO';
  integration: 'stage';
  generatedAt: string;
  state: AudioPlaybackState;
  track: {
    id: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    coverUrl: string | null;
    durationSeconds: number;
    positionSeconds: number;
    progress: number;
  };
  lyrics: {
    kind: 'empty' | 'plain' | 'synced' | 'instrumental';
    provider: string | null;
    current: StageBridgeLyricLine | null;
    next: StageBridgeLyricLine | null;
    offsetMs: number;
  };
  audio: {
    outputMode: AudioOutputMode;
    outputBackend: string | null;
    visualEnergy: number;
    visualTransient: number;
    visualSpectrum: number[];
  };
};
