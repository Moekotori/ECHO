import type { Readable } from 'node:stream';
import type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioCudaRuntimeStatus,
  AudioEchoSrcComputeBackend,
  AudioEchoSrcFirProcessingMode,
  AudioEchoSrcFilterProfile,
  AudioEchoSrcFilterSlot,
  AudioEchoSrcMode,
  AudioEchoSrcQualityProfile,
  AudioEchoSrcRuntimeStatus,
  AudioSdmComputeBackend,
  AudioSdmModulatorProfile,
  AudioSdmRuntimeStatus,
  ActiveDsdOutputMode,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioPlaybackState,
  AudioStatus,
  AudioBackendContractVersion,
  NativeDirectLocalPlaybackFallbackReason,
} from '../../shared/types/audio';
import type { PlaybackProbeHint, PlaybackTrackMetadataHint } from '../../shared/types/playback';
import type { ReplayGainTrackData } from '../../shared/utils/replayGain';
import type { FfmpegToolchainInfo } from './FfmpegToolchain';
import type { AutomixTransitionPlan, AutomixTransitionMode, TrackTransitionAnalysis } from './AutomixPlanner';

export const nativeHostProtocolVersion = 1;
export const nativeBackendContractVersion: AudioBackendContractVersion = 2;

export type {
  AudioDeviceInfo,
  AudioDiagnostics,
  AudioEchoSrcComputeBackend,
  AudioEchoSrcFirProcessingMode,
  AudioEchoSrcFilterProfile,
  AudioEchoSrcFilterSlot,
  AudioEchoSrcMode,
  AudioEchoSrcQualityProfile,
  AudioEchoSrcRuntimeStatus,
  AudioLatencyProfile,
  AudioOutputMode,
  AudioOutputSettings,
  AudioPlaybackState,
  AudioSharedBackend,
  AudioStatus,
  NativeDirectLocalPlaybackFallbackReason,
};

export type LocalAudioSource = {
  filePath: string;
  trackId?: string;
  metadata?: PlaybackTrackMetadataHint;
  inputHeaders?: Record<string, string>;
  mimeType?: string | null;
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
  outputChannels: number;
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
  echoSrcAdvancedModeEnabled: boolean;
  /** True only when ECHO SRC is routed through the host-owned FIR processor. */
  echoSrcFirActive: boolean;
  echoSrcFilterProfile: AudioEchoSrcFilterProfile;
  echoSrcFilterProfile1x: AudioEchoSrcFilterProfile;
  echoSrcFilterProfileNx: AudioEchoSrcFilterProfile;
  echoSrcFilterSlot: AudioEchoSrcFilterSlot | null;
  echoSrcComputeBackend: AudioEchoSrcComputeBackend;
  echoSrcCudaActive: boolean;
  echoSrcCudaStatus?: AudioCudaRuntimeStatus;
  echoSrcTargetSampleRate: number | null;
  echoSrcActive: boolean;
  echoSrcRuntime: AudioEchoSrcRuntimeStatus | null;
  sdmPcmToDsdActive: boolean;
  sdmOutputFormat: 'dop24le' | 'dsd-native-raw' | null;
  sdmNativeSampleRate: number | null;
  sdmTransportSampleRate: number | null;
  sdmComputeBackend: AudioSdmComputeBackend;
  sdmActualComputeBackend: AudioSdmComputeBackend | null;
  sdmModulatorProfile: AudioSdmModulatorProfile | null;
  sdmProcessingMode: AudioEchoSrcFirProcessingMode | null;
  sdmBatchFrames: number | null;
  sdmMaxBlockFrames: number | null;
  sdmOversamplingFilterProfile: AudioEchoSrcFilterProfile;
  sdmOversamplingFilterProfile1x: AudioEchoSrcFilterProfile;
  sdmOversamplingFilterProfileNx: AudioEchoSrcFilterProfile;
  sdmOversamplingFirActive: boolean;
  sdmCudaStatus?: AudioCudaRuntimeStatus;
  sdmRuntime: AudioSdmRuntimeStatus | null;
  bitPerfectCandidate: boolean;
  sampleRateMismatch: boolean;
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

export type PcmAutomixDecodeRequest = {
  current: PcmDecodeRequest & {
    durationSeconds: number;
  };
  next: PcmDecodeRequest & {
    durationSeconds: number;
  };
  plan: AutomixTransitionPlan;
  following?: Array<{
    track: PcmDecodeRequest & {
      durationSeconds: number;
    };
    plan: AutomixTransitionPlan;
  }>;
};

export type PcmGaplessDecodeRequest = {
  current: PcmDecodeRequest & {
    durationSeconds: number;
  };
  next: PcmDecodeRequest & {
    durationSeconds: number;
  };
  following?: Array<PcmDecodeRequest & {
    durationSeconds: number;
  }>;
};

export type DecoderRun = {
  stream: Readable;
  stop: () => void;
  done: Promise<void>;
  waitForExitOnStop?: boolean;
  ready?: Promise<void>;
  decoderBackendImpl?: string;
  resamplerEngine?: AudioResamplerEngine;
  resamplerFallbackActive?: boolean;
  replayGainAppliedInStream?: boolean;
};

export type FfmpegToolchainDiagnostics = Pick<
  FfmpegToolchainInfo,
  'path' | 'source' | 'version' | 'healthy' | 'soxrAvailable' | 'aresampleAvailable' | 'manifestVersion' | 'error'
>;

export type NativeOutputStartOptions = {
  backendContractVersion?: AudioBackendContractVersion;
  requestedOutputSampleRate: number;
  sharedMixSampleRate?: number | null;
  channels: number;
  deviceIndex?: number;
  deviceName?: string;
  sharedBackend?: AudioSharedBackend;
  exclusive?: boolean;
  asio?: boolean;
  useNativeOutput?: boolean;
  useMiniaudioOutput?: boolean;
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
  nativeDsdSampleRate?: number | null;
  readyTimeoutMs?: number;
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
  event: 'default_device_changed' | 'device_state_changed' | 'device_removed' | 'device_sample_rate_changed' | 'audio_session_disconnected';
  deviceId?: string;
  reason?: string;
  code?: number;
  currentDevice?: boolean;
  followsDefaultDevice?: boolean;
};

export type NativeBridgeReadyMessage = Record<string, unknown> & {
  ready?: boolean;
  readyLevel?: 'process' | 'device';
  protocolVersion?: number;
  backendContractVersion?: number;
  capabilities?: {
    deviceReadyV2?: boolean;
    runtimeDeviceConfigureV1?: boolean;
    hostOwnedLocalPlaybackV1?: boolean;
    nativeDspV1?: boolean;
    nativeCudaDspV1?: boolean;
    wasapiExclusive?: boolean;
    coreAudioExclusive?: boolean;
    asio?: boolean;
  };
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
  /** Main-process-only guard for one corrective daemon reopen after probing a remote source rate. */
  remoteSampleRateCorrectionAttempt?: boolean;
  /** Main-process-only guard that keeps a runtime daemon recovery on the legacy remote PCM path. */
  remoteDaemonPlaybackFallbackAttempt?: boolean;
};

export type AudioSessionPlayPcmStreamRequest = {
  stream: Readable;
  sourceId: string;
  trackId?: string | null;
  metadata?: PlaybackTrackMetadataHint | null;
  decoderBackendImpl?: string;
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
