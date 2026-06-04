export type AudioOutputMode = 'shared' | 'exclusive' | 'asio' | 'system';
export type AudioSharedBackend = 'auto' | 'windows' | 'directsound' | 'alsa';

export type AudioPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error';

export type PlaybackSpeedMode = 'nightcore' | 'daycore' | 'speed';
export type AudioLatencyProfile = 'stable' | 'balanced' | 'lowLatency';
export type ChannelBalanceMonoMode = 'off' | 'sum' | 'left' | 'right';
export type ChannelBalanceBandId = 'low' | 'mid' | 'high';
export type SharedStabilityTier = 'standard' | 'recovery' | 'emergency';
export type AsioCompatibilityProfile = 'asio4all';
export type AudioResamplerEngine = 'default' | 'soxr';
export type FfmpegToolchainSource = 'explicit' | 'bundled' | 'dev-bundled' | 'system';
export type AudioDsdOutputMode = 'pcm' | 'dop';
export type ActiveDsdOutputMode = 'pcm' | 'dop' | 'native' | null;
export type AudioAutomixMode = 'off' | 'armed' | 'transitioning';
export const audioExportFormats = ['mp3', 'wav', 'flac', 'ogg'] as const;
export type AudioExportFormat = (typeof audioExportFormats)[number];

export type AudioExportRequest = {
  filePath: string;
  format: AudioExportFormat;
  playbackRate?: number;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
};

export type AudioExportResult = {
  filePath: string;
  format: AudioExportFormat;
  playbackRate: number;
};

export type AudioAutomixStatus = {
  enabled: boolean;
  mode: AudioAutomixMode;
  active: boolean;
  transitionSeconds: number | null;
  transitionStartedAtSeconds: number | null;
  nextTrackId: string | null;
  transitionMode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback' | null;
  fallbackReason?: string | null;
  beatAligned?: boolean;
  gapless?: boolean;
  skipIntroSilence?: boolean;
  engine?: 'nativeDualDeck' | 'ffmpegPremix' | 'nativeGapless' | 'ffmpegGapless' | 'fallback' | null;
  tempoRatio?: number | null;
  nextStartSeconds?: number | null;
  overlapSeconds?: number | null;
  advanceAtSeconds?: number | null;
  plannedTrackCount?: number;
  nextTransitionIndex?: number;
};

export type ChannelBalanceState = {
  enabled: boolean;
  balance: number;
  leftGainDb: number;
  rightGainDb: number;
  bandGains?: Record<ChannelBalanceBandId, {
    leftGainDb: number;
    rightGainDb: number;
  }>;
  leftDelayMs?: number;
  rightDelayMs?: number;
  swapLeftRight: boolean;
  monoMode: ChannelBalanceMonoMode;
  invertLeft: boolean;
  invertRight: boolean;
  constantPower: boolean;
  clippingRisk?: boolean;
};

export type AudioLevelTelemetry = {
  inputPeakDb: number | null;
  inputRmsDb: number | null;
  estimatedOutputPeakDb: number | null;
  estimatedOutputRmsDb: number | null;
  visualSpectrum?: number[];
  visualSpectrumVersion?: 2;
  visualEnergy?: number;
  visualTransient?: number;
  visualTelemetryState?: 'pcm' | 'priming' | 'fallback';
  levelMeterObserveCostMs?: number;
  visualSpectrumComputeCostMs?: number;
  headroomDb: number | null;
  clipCount: number;
  lastClipAt: string | null;
  meterSource: 'pre_native_estimated_post_dsp';
};

export const channelBalanceMinBalance = -1;
export const channelBalanceMaxBalance = 1;
export const channelBalanceMinGainDb = -12;
export const channelBalanceMaxGainDb = 6;
export const channelBalanceBandIds = ['low', 'mid', 'high'] as const;
export const channelBalanceBandMinGainDb = -6;
export const channelBalanceBandMaxGainDb = 3;
export const channelBalanceMinDelayMs = 0;
export const channelBalanceMaxDelayMs = 10;

export type AudioDeviceInfo = {
  id: string;
  index: number;
  name: string;
  outputMode: Exclude<AudioOutputMode, 'exclusive' | 'system'>;
  sampleRate: number | null;
  sharedDeviceSampleRate: number | null;
  isDefault: boolean;
  asioOutputChannels?: number;
  asioOutputChannelStart?: number;
  asioChannelNames?: string[];
};

export type AudioOutputSettings = {
  outputMode?: AudioOutputMode;
  sharedBackend?: AudioSharedBackend;
  deviceIndex?: number;
  deviceName?: string;
  asioOutputChannelStart?: number;
  requestedOutputSampleRate?: number;
  latencyProfile?: AudioLatencyProfile;
  bufferSizeFrames?: number | null;
  useJuceOutput?: boolean;
  useJuceDecode?: boolean;
  dsdOutputMode?: AudioDsdOutputMode;
  asioNativeDsdExperimentalEnabled?: boolean;
  asioUnavailableFallbackEnabled?: boolean;
  exclusiveInstabilityFallbackEnabled?: boolean;
  defaultDeviceFallbackEnabled?: boolean;
  soxrFallbackEnabled?: boolean;
  releaseExclusiveOnPauseExperimentalEnabled?: boolean;
  volume?: number;
  playbackRate?: number;
  playbackSpeedMode?: PlaybackSpeedMode;
};

export type AudioStatus = {
  host: 'not-initialized' | 'starting' | 'ready' | 'unavailable' | 'error';
  state: AudioPlaybackState;
  outputDeviceId: string | null;
  outputDeviceName: string | null;
  outputDeviceType: string | null;
  outputBackend: string | null;
  activeOutputBackendImpl: string | null;
  asioCompatibilityProfile?: AsioCompatibilityProfile | null;
  nativeOutputFormat?: string | null;
  outputMode: AudioOutputMode;
  sharedBackend?: AudioSharedBackend | null;
  useJuceOutputRequested: boolean;
  useJuceDecodeRequested: boolean;
  activeDecodeBackendImpl: string | null;
  dsdOutputModeRequested?: AudioDsdOutputMode;
  activeDsdOutputMode?: ActiveDsdOutputMode;
  dsdNativeSampleRate?: number | null;
  dsdTransportSampleRate?: number | null;
  volume: number;
  playbackRate: number;
  playbackSpeedMode: PlaybackSpeedMode;
  replayGainEnabled?: boolean;
  replayGainMode?: 'off' | 'track' | 'album';
  replayGainAppliedDb?: number;
  replayGainPreventedClipping?: boolean;
  automix?: AudioAutomixStatus;
  currentFilePath: string | null;
  currentTrackId: string | null;
  currentTrackTitle?: string | null;
  currentTrackArtist?: string | null;
  currentTrackAlbum?: string | null;
  currentTrackAlbumArtist?: string | null;
  currentTrackCoverUrl?: string | null;
  durationSeconds: number;
  positionSeconds: number;
  channels: number | null;
  codec: string | null;
  bitDepth: number | null;
  bitrate: number | null;
  fileSampleRate: number | null;
  decoderOutputSampleRate: number | null;
  requestedOutputSampleRate: number | null;
  actualDeviceSampleRate: number | null;
  sharedDeviceSampleRate: number | null;
  resampling: boolean;
  ffmpegPath?: string | null;
  ffmpegSource?: FfmpegToolchainSource | null;
  ffmpegVersion?: string | null;
  ffmpegHealthy?: boolean;
  soxrAvailable?: boolean;
  resamplerEngine?: AudioResamplerEngine;
  resamplerFallbackActive?: boolean;
  bitPerfectCandidate: boolean;
  sampleRateMismatch: boolean;
  latencyProfile?: AudioLatencyProfile;
  eqEnabled: boolean;
  roomCorrectionEnabled?: boolean;
  channelBalanceEnabled: boolean;
  dspActive: boolean;
  dspClippingRisk?: boolean;
  dspLimiterProtecting?: boolean;
  preampDb: number;
  dspHeadroomDb?: number;
  eqPresetName: string | null;
  clippingRisk: boolean;
  audioLevels?: AudioLevelTelemetry;
  bitPerfectDisabledReason: string | null;
  sharedStabilityTier?: SharedStabilityTier | null;
  nativeDeviceBufferFrames?: number | null;
  nativeRequestedBufferFrames?: number | null;
  nativeActualBufferFrames?: number | null;
  nativeOutputLatencyMs?: number | null;
  nativePositionStalenessMs?: number | null;
  nativeFifoCapacityFrames?: number | null;
  nativeStartupPrebufferFrames?: number | null;
  nativeBufferedFrames?: number | null;
  nativeBufferedMs?: number | null;
  nativeUnderrunCallbacks?: number;
  nativeUnderrunFrames?: number;
  mainEventLoopLagMs?: number;
  audioHostRestartCount?: number;
  playbackRecoveryCount?: number;
  asioOutputChannelStart?: number | null;
  lastSharedStabilityRecoveryAt?: string | null;
  warnings: string[];
  error: string | null;
};

export type AudioSessionResetEvent = {
  reason: string;
  status: AudioStatus;
};

export type AudioPlaybackDiagnosticSeverity = 'info' | 'suspect' | 'recovery' | 'error';

export type AudioPlaybackDiagnosticEvent = {
  at: string;
  kind:
    | 'play_request'
    | 'seek_request'
    | 'pause_request'
    | 'stop_request'
    | 'output_ready'
    | 'startup_telemetry'
    | 'ended'
    | 'position_jump_suspected'
    | 'position_jump_recovered'
    | 'watchdog_recovery'
    | 'live_restart_skipped';
  severity: AudioPlaybackDiagnosticSeverity;
  reason: string;
  state: AudioPlaybackState;
  trackId: string | null;
  filePath: string | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  outputMode: AudioOutputMode | null;
  outputBackend: string | null;
  outputBackendImpl: string | null;
  nativeBufferedFrames?: number | null;
  nativeUnderrunCallbacks?: number;
  nativeUnderrunFrames?: number;
  warnings?: string[];
  details?: Record<string, unknown>;
};

export type AudioPlaybackIssueSummary = {
  eventCount: number;
  suspectEventCount: number;
  recoveryEventCount: number;
  lastSuspectEventAt: string | null;
  lastRecoveryEventAt: string | null;
  lastCommandAt: string | null;
};

export type AudioDiagnostics = Pick<
  AudioStatus,
  | 'state'
  | 'host'
  | 'outputMode'
  | 'sharedBackend'
  | 'outputBackend'
  | 'activeOutputBackendImpl'
  | 'nativeOutputFormat'
  | 'useJuceOutputRequested'
  | 'useJuceDecodeRequested'
  | 'activeDecodeBackendImpl'
  | 'dsdOutputModeRequested'
  | 'activeDsdOutputMode'
  | 'dsdNativeSampleRate'
  | 'dsdTransportSampleRate'
  | 'outputDeviceName'
  | 'asioCompatibilityProfile'
  | 'currentFilePath'
  | 'currentTrackId'
  | 'durationSeconds'
  | 'positionSeconds'
  | 'playbackRate'
  | 'fileSampleRate'
  | 'decoderOutputSampleRate'
  | 'requestedOutputSampleRate'
  | 'actualDeviceSampleRate'
  | 'sharedDeviceSampleRate'
  | 'resampling'
  | 'ffmpegPath'
  | 'ffmpegSource'
  | 'ffmpegVersion'
  | 'ffmpegHealthy'
  | 'soxrAvailable'
  | 'resamplerEngine'
  | 'resamplerFallbackActive'
  | 'bitPerfectCandidate'
  | 'sampleRateMismatch'
  | 'latencyProfile'
  | 'sharedStabilityTier'
  | 'nativeDeviceBufferFrames'
  | 'nativeRequestedBufferFrames'
  | 'nativeActualBufferFrames'
  | 'nativeOutputLatencyMs'
  | 'nativePositionStalenessMs'
  | 'nativeFifoCapacityFrames'
  | 'nativeStartupPrebufferFrames'
  | 'nativeBufferedFrames'
  | 'nativeBufferedMs'
  | 'nativeUnderrunCallbacks'
  | 'nativeUnderrunFrames'
  | 'mainEventLoopLagMs'
  | 'audioHostRestartCount'
  | 'playbackRecoveryCount'
  | 'lastSharedStabilityRecoveryAt'
  | 'warnings'
  | 'error'
> & {
  watchdogStatus: 'idle' | 'monitoring' | 'recovering' | 'limited';
  recentWatchdogRecoveryCount: number;
  lastWatchdogRecoveryTime: string | null;
  recentPlaybackEvents?: AudioPlaybackDiagnosticEvent[];
  playbackIssueSummary?: AudioPlaybackIssueSummary;
};
