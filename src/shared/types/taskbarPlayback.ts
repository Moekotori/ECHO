import type { AudioPlaybackState } from './audio';

export type TaskbarPlaybackStatus = {
  platform: NodeJS.Platform;
  supported: boolean;
  bound: boolean;
  windowAvailable: boolean;
  enabled: boolean;
  visible: boolean;
  playbackState: AudioPlaybackState | null;
  title: string;
  progress: number | null;
  thumbarButtons: 'playing' | 'paused' | null;
  lastSyncAt: string | null;
  lastAppliedAt: string | null;
  lastClearedAt: string | null;
  lastError: string | null;
};
