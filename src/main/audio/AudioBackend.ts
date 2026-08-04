import type { EqProfileBindingTarget } from '../../shared/types/eq';
import type { AudioDeviceInfo, AudioOutputSettings } from '../../shared/types/audio';

export interface ProbeResult {
  status: string;
  filePath: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  startSeconds?: number;
  codec: string;
  container: string;
  bitDepth?: number;
  bitrate?: number;
}

export interface AudioBackend {
  /** Runtime capability flags — use these instead of instanceof checks. */
  readonly capabilities: {
    daemon: boolean;
    exclusiveMode: boolean;
  };

  start(): Promise<void>;

  /** Open an audio file: probe metadata + start background decode. */
  openFile(path: string, startSeconds?: number): Promise<ProbeResult>;

  /** Prefetch a file (decode initial window) for gapless/queue readiness. */
  prefetch?(filePath: string): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  seek(positionSeconds: number): Promise<void>;

  stop(): Promise<void>;

  getPositionSeconds(): number;

  onPosition(callback: (positionSeconds: number) => void): void;

  onEnded(callback: () => void): void;

  onError(callback: (error: Error) => void): void;

  dispose(): void;

  /** Sync EQ state to native host for playback start. */
  syncEqState?(): Promise<void>;

  applyBoundProfile?(target: EqProfileBindingTarget): Promise<void>;

  setPlaybackSpeed?(rate: number, mode: AudioOutputSettings['playbackSpeedMode']): Promise<void>;

  setVolume?(volume: number): Promise<void>;

  onEqStateChanged?(callback: (state: unknown) => void): void;

  onChannelBalanceChanged?(callback: (state: unknown) => void): void;

  onRoomCorrectionChanged?(callback: (state: unknown) => void): void;

  getDevices?(): Promise<AudioDeviceInfo[]>;

  /** Configure a device for playback before opening a file. */
  configureDevice?(deviceId: string, settings?: Partial<AudioOutputSettings>): Promise<void>;
}
