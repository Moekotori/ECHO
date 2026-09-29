import type { EqProfileBindingTarget } from '../../shared/types/eq';
import type { AudioDeviceInfo, AudioOutputSettings } from '../../shared/types/audio';
import type { NativeLevelMeterSnapshot } from './JsonRpcBridge';
import type { PlaybackTrackMetadataHint } from '../../shared/types/playback';
import type {
  AutomixPrepareRequestV2,
  AutomixPrepareResultV2,
  AutomixStateV2,
  AutomixTransitionCommittedEventV2,
} from '../../shared/types/automix';

export type AudioInputSource = {
  kind: 'local' | 'http';
  uri: string;
  headers?: Record<string, string>;
  mimeType?: string | null;
};

const allowedHttpInputHeaders = new Map([
  ['authorization', 'Authorization'],
  ['cookie', 'Cookie'],
  ['referer', 'Referer'],
  ['origin', 'Origin'],
  ['user-agent', 'User-Agent'],
  ['accept', 'Accept'],
]);
const maxHttpInputHeaderCount = 12;
const maxHttpInputHeaderValueLength = 16 * 1024;
const maxHttpInputHeadersLength = 32 * 1024;

export const normalizeAudioInputSource = (source: AudioInputSource): AudioInputSource => {
  const uri = source.uri.trim();
  const isHttp = /^https?:\/\//iu.test(uri);
  if (!uri || (source.kind === 'http') !== isHttp) {
    throw new Error('invalid_audio_input_source');
  }
  if (source.kind === 'local') {
    return { kind: 'local', uri, mimeType: source.mimeType ?? null };
  }

  const entries = Object.entries(source.headers ?? {});
  if (entries.length > maxHttpInputHeaderCount) {
    throw new Error('audio_input_headers_exceed_limit');
  }
  let totalLength = 0;
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = allowedHttpInputHeaders.get(rawName.trim().toLocaleLowerCase());
    const value = String(rawValue);
    if (!name || /[\r\n]/u.test(value) || value.length > maxHttpInputHeaderValueLength) {
      throw new Error('invalid_audio_input_header');
    }
    totalLength += name.length + value.length;
    if (totalLength > maxHttpInputHeadersLength) {
      throw new Error('audio_input_headers_exceed_limit');
    }
    headers[name] = value;
  }

  return {
    kind: 'http',
    uri,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    mimeType: source.mimeType ?? null,
  };
};

export type AudioBackendQueueItem = {
  itemId: string;
  trackId: string;
  filePath: string;
  sampleRate?: number;
  startSeconds?: number;
  metadata?: PlaybackTrackMetadataHint;
};

export type AudioBackendQueueSnapshot = {
  revision: number;
  currentItemId: string | null;
  repeatMode: 'off' | 'one' | 'all';
  items: AudioBackendQueueItem[];
};

export interface ProbeResult {
  status: string;
  filePath: string;
  sampleRate: number;
  sourceSampleRate?: number;
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

  /** Open a local or HTTP source through the backend-owned decoder. */
  openSource?(source: AudioInputSource, startSeconds?: number): Promise<ProbeResult>;

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

  onStarted?(callback: () => void): void;

  onLevelMeter?(callback: (snapshot: NativeLevelMeterSnapshot) => void): void;

  dispose(): void;

  /** Sync EQ state to native host for playback start. */
  syncEqState?(): Promise<void>;

  /** Rehydrate the complete persisted DSP graph before PCM can start. */
  syncDspState?(target?: EqProfileBindingTarget): Promise<void>;

  applyBoundProfile?(target: EqProfileBindingTarget): Promise<void>;

  setPlaybackSpeed?(rate: number, mode: AudioOutputSettings['playbackSpeedMode']): Promise<void>;

  setVolume?(volume: number): Promise<void>;

  onEqStateChanged?(callback: (state: unknown) => void): void;

  onChannelBalanceChanged?(callback: (state: unknown) => void): void;

  onRoomCorrectionChanged?(callback: (state: unknown) => void): void;

  getDevices?(): Promise<AudioDeviceInfo[]>;

  /** Configure a device for playback before opening a file. */
  configureDevice?(deviceId: string, settings?: Partial<AudioOutputSettings>): Promise<void>;

  prepareAutomixV2?(request: AutomixPrepareRequestV2): Promise<AutomixPrepareResultV2>;
  cancelAutomixV2?(planId: string): Promise<void>;
  getAutomixStateV2?(): Promise<AutomixStateV2>;
  onAutomixTransitionCommitted?(callback: (event: AutomixTransitionCommittedEventV2) => void): void;
}
