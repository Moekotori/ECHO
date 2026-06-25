import type { Readable } from 'node:stream';
import type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioEchoSrcMode,
  AudioEchoSrcQualityProfile,
  AsioCompatibilityProfile,
  ActiveDsdOutputMode,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioPlaybackState,
  AudioStatus,
} from '../../shared/types/audio';
import type { PlaybackProbeHint, PlaybackTrackMetadataHint } from '../../shared/types/playback';
import type { ReplayGainTrackData } from '../../shared/utils/replayGain';
import type { FfmpegToolchainInfo } from './DaemonClient';

export type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioEchoSrcMode,
  AudioEchoSrcQualityProfile,
  AsioCompatibilityProfile,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioPlaybackState,
  AudioStatus,
};

// ---------------------------------------------------------------------------
// Inline types formerly from AutomixPlanner (deleted; daemon handles automix)
// ---------------------------------------------------------------------------

export type TrackTransitionAnalysis = {
  status: 'complete' | 'estimated' | 'unavailable';
  durationSeconds: number;
  introStartSeconds: number;
  introEndSeconds: number;
  outroStartSeconds: number;
  outroEndSeconds: number;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  rmsDb: number | null;
  lufsDb: number | null;
  introRmsDb?: number | null;
  outroRmsDb?: number | null;
  energyCurve: number[];
  bpm: number | null;
  beatOffsetMs: number | null;
  beatConfidence: number | null;
  analyzedAt?: string;
};

export type AutomixTransitionMode = 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';

export type AutomixTransitionPlan = {
  mode: AutomixTransitionMode;
  currentStartSeconds: number;
  currentEndSeconds: number;
  currentFadeStartSeconds: number;
  nextStartSeconds: number;
  overlapSeconds: number;
  curve: 'hsin' | 'qsin' | 'tri';
  currentGainDb: number;
  nextGainDb: number;
  tempoRatio: number;
  advanceAtSeconds: number;
  skipIntroSilence: boolean;
  beatAligned: boolean;
  fallbackReason: string | null;
};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LocalAudioSource = {
  filePath: string;
  trackId?: string;
  metadata?: PlaybackTrackMetadataHint;
  inputHeaders?: Record<string, string>;
  replayGain?: ReplayGainTrackData | null;
};

export type AudioProbeResult = {
  filePath: string;
  durationSeconds: number;
  fileSampleRate: number | null;
  channels: number;
  codec: string | null;
  bitDepth: number | null;
  bitrate: number | null;
};

export type SampleRatePlan = {
  fileSampleRate: number | null;
  decoderOutputSampleRate: number;
  requestedOutputSampleRate: number;
  actualDeviceSampleRate: number | null;
  sharedDeviceSampleRate: number | null;
  dsdOutputMode: Exclude<ActiveDsdOutputMode, null>;
  dsdNativeSampleRate: number | null;
  dsdTransportSampleRate: number | null;
  outputMode: AudioOutputMode;
  resampling: boolean;
  echoSrcMode: AudioEchoSrcMode;
  echoSrcQualityProfile: AudioEchoSrcQualityProfile;
  echoSrcTargetSampleRate: number | null;
  echoSrcActive: boolean;
  bitPerfectCandidate: boolean;
  sampleRateMismatch: boolean;
  asioCompatibilityProfile: AsioCompatibilityProfile | null;
  warnings: string[];
};

export type AudioResamplerEngine = 'default' | 'soxr';

export type PcmDecodeRequest = {
  filePath: string;
  startSeconds: number;
  durationSeconds?: number;
  channels: number;
  decoderOutputSampleRate: number;
  resamplerEngine?: AudioResamplerEngine;
  resamplerQualityProfile?: AudioEchoSrcQualityProfile;
  allowResamplerFallback?: boolean;
  onResamplerFallback?: (reason: string) => void;
  inputHeaders?: Record<string, string>;
  tempoRatio?: number;
  replayGainDb?: number;
};

export type FfmpegToolchainDiagnostics = Pick<
  FfmpegToolchainInfo,
  'path' | 'source' | 'version' | 'healthy' | 'soxrAvailable' | 'aresampleAvailable' | 'manifestVersion' | 'error'
>;

export type NativeOutputStartOptions = {
  requestedOutputSampleRate: number;
  sharedMixSampleRate?: number | null;
  channels: number;
  deviceIndex?: number;
  deviceName?: string;
  asioOutputChannelStart?: number;
  sharedBackend?: AudioSharedBackend;
  asio?: boolean;
  exclusive?: boolean;
  useJuceOutput?: boolean;
  latencyProfile?: AudioOutputSettings['latencyProfile'];
  bufferSizeFrames?: number;
  fifoCapacityMs?: number;
  startupPrebufferMs?: number;
  startupPrebufferTimeoutMs?: number;
  volume?: number;
  startSeconds?: number;
  playbackRate?: number;
  playbackSpeedMode?: AudioOutputSettings['playbackSpeedMode'];
  durationSeconds?: number;
  inputFormat?: 'pcm-f32le' | 'dop24le' | 'dsd-native-raw';
  asioNativeDsdOutput?: boolean;
  nativeDsdSampleRate?: number | null;
  asioCompatibilityProfile?: AsioCompatibilityProfile | null;
};

export type NativeOutputTelemetry = {
  positionFrames: number;
  bufferedFrames: number | null;
  underrunCallbacks: number;
  underrunFrames: number;
  dspClippingRisk?: boolean;
  dspLimiterProtecting?: boolean;
  reportedAtMs?: number | null;
  nativePositionStalenessMs?: number | null;
};

export type NativeHostNotificationEvent = {
  event: 'default_device_changed' | 'device_state_changed' | 'device_removed' | 'audio_session_disconnected';
  deviceId?: string;
  reason?: string;
  code?: number;
  currentDevice?: boolean;
  followsDefaultDevice?: boolean;
};

export type NativeBridgeReadyMessage = Record<string, unknown> & {
  ready?: boolean;
  sampleRate?: number;
  sharedSampleRate?: number;
  sharedDeviceSampleRate?: number;
  hardwareSampleRate?: number;
  exclusive?: boolean;
  backend?: string;
  backendImpl?: string;
  format?: string;
  deviceType?: string;
  deviceName?: string;
  eqControlPort?: number;
  deviceBufferFrames?: number;
  nativeActualBufferFrames?: number;
  actualBufferFrames?: number;
  requestedDeviceBufferFrames?: number;
  openedDeviceBufferFrames?: number;
  bufferSizeFallback?: boolean;
  fifoCapacityFrames?: number;
  startupPrebufferFrames?: number;
  startupPrebufferTimeoutMs?: number;
  asioInputChannels?: number;
  asioOutputChannels?: number;
  asioPreferredBufferFrames?: number;
  asioMinBufferFrames?: number;
  asioMaxBufferFrames?: number;
  asioGranularity?: number;
  asioOutputChannelStart?: number;
  nativeDsd?: boolean;
};

export type NativeBridgeReadyResult = {
  ok: true;
  device: NativeBridgeReadyMessage;
  requestedOutputSampleRate: number;
  actualDeviceSampleRate: number | null;
};

export type AudioSessionPlayRequest = LocalAudioSource & {
  startSeconds?: number;
  output?: AudioOutputSettings;
  probe?: PlaybackProbeHint;
  automix?: AudioSessionAutomixRequest;
  gapless?: AudioSessionGaplessRequest;
  automixAnalyze?: boolean;
};

export type AudioSessionPlayPcmStreamRequest = {
  stream: Readable;
  sourceId: string;
  trackId?: string | null;
  sampleRate: number;
  channels: number;
  durationSeconds?: number;
  output?: AudioOutputSettings;
};

export type AudioSessionPrepareLocalFileRequest = LocalAudioSource & {
  probe?: PlaybackProbeHint;
  automixAnalyze?: boolean;
};

export type AudioSessionAutomixNextTrack = LocalAudioSource & {
  probe?: PlaybackProbeHint;
};

export type AudioSessionGaplessNextTrack = LocalAudioSource & {
  probe?: PlaybackProbeHint;
};

export type AudioSessionAutomixRequest = {
  enabled?: boolean;
  maxTransitionSeconds?: number;
  beatAlignEnabled?: boolean;
  currentAnalysis?: TrackTransitionAnalysis | null;
  nextAnalysis?: TrackTransitionAnalysis | null;
  next?: AudioSessionAutomixNextTrack | null;
  following?: AudioSessionAutomixNextTrack[];
};

export type AudioSessionGaplessRequest = {
  enabled?: boolean;
  next?: AudioSessionGaplessNextTrack | null;
  following?: AudioSessionGaplessNextTrack[];
};

export type AudioAutomixAdvanceEvent = {
  fromTrackId: string | null;
  toTrackId: string;
  transitionSeconds: number;
  mode?: AutomixTransitionMode;
  fallbackReason?: string | null;
  beatAligned?: boolean;
  skipIntroSilence?: boolean;
  nextStartSeconds?: number;
};

export type AudioCoreEventMap = {
  status: [AudioStatus];
  ended: [AudioStatus];
  'automix-advance': [AudioAutomixAdvanceEvent];
  error: [Error, AudioStatus];
  'session-reset': [{ reason: string; status: AudioStatus }];
};
