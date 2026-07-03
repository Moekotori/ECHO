import type { AudioPlaybackState } from './audio';

export type TaskbarThumbnailDiagnostics = {
  hasMaster: boolean;
  proxyPlacementMode?: number;
  mainSubclassed?: boolean;
  buttonsAdded?: boolean;
  buttonsVisible?: boolean;
  buttonClicks?: number;
  lastButtonsHr?: number;
};

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
  thumbnailClip: 'player-bar' | null;
  thumbnailCover: 'album-cover' | null;
  lastSyncAt: string | null;
  lastAppliedAt: string | null;
  lastClearedAt: string | null;
  lastError: string | null;
  thumbnailDiagnostics: TaskbarThumbnailDiagnostics | null;
};
