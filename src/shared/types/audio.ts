export type AudioOutputMode = 'shared' | 'exclusive' | 'system';
export type AudioSharedBackend = 'auto' | 'windows' | 'directsound' | 'alsa';

export type AudioPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error';

export type PlaybackSpeedMode = 'nightcore' | 'daycore' | 'speed';
export type AudioLatencyProfile = 'stable' | 'balanced' | 'lowLatency';
export type NativeDirectLocalPlaybackFallbackReason =
  | 'disabled'
  | 'unsupported_format'
  | 'unsupported_channels'
  | 'unsupported_sample_rate'
  | 'remote_source'
  | 'cue_track'
  | 'input_headers'
  | 'libav_decode_requested'
  | 'dsd_active'
  | 'sdm_active'
  | 'echo_src_active'
  | 'dsp_active'
  | 'replaygain_active'
  | 'chained_playback'
  | 'reader_failed';
export type AudioBackendContractVersion = 2;
export type ChannelBalanceMonoMode = 'off' | 'sum' | 'left' | 'right';
export type ChannelBalanceBandId = 'low' | 'mid' | 'high';
export type SharedStabilityTier = 'standard' | 'recovery' | 'emergency';
export type AudioResamplerEngine = 'default' | 'soxr';
export const audioEchoSrcModes = ['off', 'family2x', 'family4x', 'family8x'] as const;
export type AudioEchoSrcMode = (typeof audioEchoSrcModes)[number];
export const audioEchoSrcQualityProfiles = ['transparent', 'balanced', 'lowLatency'] as const;
export type AudioEchoSrcQualityProfile = (typeof audioEchoSrcQualityProfiles)[number];
export const audioEchoSrcFilterProfiles = [
  'poly-sinc-hb',
  'poly-sinc-ext2-short',
  'poly-sinc-ext2-medium',
  'poly-sinc-ext2-long',
  'poly-sinc-ext2-xla',
  'poly-sinc-ext2-xl',
  'poly-sinc-ext2-hires-lp',
  'poly-sinc-ext2-hires-mp',
  'poly-sinc-ext3-long',
  'poly-sinc-ext3-xla',
  'poly-sinc-gauss-long',
  'poly-sinc-gauss-xla',
  'poly-sinc-gauss-xl',
  'poly-sinc-gauss-hires-lp',
  'poly-sinc-gauss-hires-mp',
  'poly-sinc-gauss-xtr-long',
  'poly-sinc-gauss-xtr-xla',
  'poly-sinc-xtr-mp',
  'poly-sinc-xtr-short-lp',
  'poly-sinc-xtr-short-mp',
  'poly-sinc-xtr-lp',
  'poly-sinc-xtr-xla',
  'minringFIR-lp',
  'minringFIR-mp',
  'minringFIR-xla',
  'minringFIR-soft',
  'minringFIR-extreme',
  'apod-fast',
  'apod-long',
  'apod-minring',
  'apod-gauss',
  'apod-xtr',
  'apod-extreme',
  'brickwall-long',
  'soft-knee-long',
  'closed-form',
  'sinc-M',
  'sinc-L',
  'sinc-long',
  'sinc-long-h',
  'sinc-xla',
] as const;
export type AudioEchoSrcFilterProfile = (typeof audioEchoSrcFilterProfiles)[number];
export const audioEchoSrcComputeBackends = ['cpu', 'cuda'] as const;
export type AudioEchoSrcComputeBackend = (typeof audioEchoSrcComputeBackends)[number];
export type AudioEchoSrcFilterSlot = '1x' | 'nx';
export type AudioEchoSrcRuntimeBackend = AudioEchoSrcComputeBackend | 'soxr' | 'default';
export type AudioEchoSrcRuntimeState = 'inactive' | 'planned' | 'active' | 'fallback' | 'bypassed' | 'unavailable';
export type AudioEchoSrcFirWindow = 'blackman-harris' | 'gaussian' | 'hann' | 'kaiser';
export type AudioEchoSrcFirPhase = 'linear' | 'minimum';
export type AudioEchoSrcFirProcessingMode = 'realtime' | 'batched' | 'ultra';
export const audioPcmDitherModes = ['off', 'tpdf', 'highpass-tpdf', 'ns-5', 'ns-9', 'ultra-shaped'] as const;
export type AudioPcmDitherMode = (typeof audioPcmDitherModes)[number];
export type AudioEchoSrcRuntimeStatus = {
  state: AudioEchoSrcRuntimeState;
  sourceSampleRate: number | null;
  targetSampleRate: number | null;
  requestedBackend: AudioEchoSrcRuntimeBackend | null;
  activeBackend: AudioEchoSrcRuntimeBackend | null;
  filterProfile: AudioEchoSrcFilterProfile | null;
  filterSlot: AudioEchoSrcFilterSlot | null;
  qualityProfile: AudioEchoSrcQualityProfile | null;
  tapCount: number | null;
  firStageCount: number | null;
  firStageTapCounts: number[] | null;
  firStageProfiles: AudioEchoSrcFilterProfile[] | null;
  firProcessingMode: AudioEchoSrcFirProcessingMode | null;
  firBatchFrames: number | null;
  firMaxBlockFrames: number | null;
  firLastInputFrames: number | null;
  firLastOutputFrames: number | null;
  firWorkerRequests: number | null;
  firWorkerAverageMs: number | null;
  firWorkerLastMs: number | null;
  firRealtimeRatio: number | null;
  window: AudioEchoSrcFirWindow | null;
  phase: AudioEchoSrcFirPhase | null;
  normalizedCutoff: number | null;
  transitionRatio: number | null;
  stopbandAttenuationDb: number | null;
  impulsePeakIndex: number | null;
  impulseEnergyCentroid: number | null;
  preRingingEnergyRatio: number | null;
  measuredStopbandPeakDb: number | null;
  measuredPassbandRippleDb: number | null;
  cudaActive: boolean;
  fallbackReason: string | null;
};
export type FfmpegToolchainSource = 'explicit' | 'bundled' | 'dev-bundled' | 'system';
export type AudioDsdOutputMode = 'pcm' | 'dop';
export type ActiveDsdOutputMode = 'pcm' | 'dop' | 'native' | null;
export const audioSdmModes = ['off', 'dsdPassthrough', 'pcmToDsd'] as const;
export type AudioSdmMode = (typeof audioSdmModes)[number];
export const audioSdmTargetRates = ['dsd64', 'dsd128', 'dsd256', 'dsd512'] as const;
export type AudioSdmTargetRate = (typeof audioSdmTargetRates)[number];
export const audioSdmQualityProfiles = ['safe', 'hifi', 'reference', 'insane'] as const;
export type AudioSdmQualityProfile = (typeof audioSdmQualityProfiles)[number];
export const audioSdmComputeBackends = ['cpu', 'cuda'] as const;
export type AudioSdmComputeBackend = (typeof audioSdmComputeBackends)[number];
export type AudioSdmRuntimeState = 'off' | 'dsd_passthrough' | 'pcm_to_sdm_active' | 'pcm_to_sdm_not_routed';
export type AudioSdmOversamplingEngine = 'soxr' | 'echo-fir' | 'default';
export type AudioSdmModulatorProfile = {
  id: string;
  name: string;
  order: number;
  noiseShaper: string;
  feedbackCoefficients: number[];
  ditherAmplitude: number;
  inputLimit: number;
  stabilityLimit: number;
  recommendedHeadroomDb: number;
};
export type AudioSdmRuntimeBackend = AudioSdmComputeBackend;
export type AudioSdmRuntimeStatus = {
  state: 'inactive' | 'active' | 'fallback' | 'bypassed' | 'unavailable';
  requestedBackend: AudioSdmRuntimeBackend | null;
  activeBackend: AudioSdmRuntimeBackend | null;
  targetRate: AudioSdmTargetRate | null;
  nativeSampleRate: number | null;
  transportSampleRate: number | null;
  oversamplingEngine: AudioSdmOversamplingEngine | null;
  oversamplingQualityProfile: AudioEchoSrcQualityProfile | null;
  oversamplingFilterProfile1x: AudioEchoSrcFilterProfile | null;
  oversamplingFilterProfileNx: AudioEchoSrcFilterProfile | null;
  oversamplingFilterSlot: AudioEchoSrcFilterSlot | null;
  oversamplingSourceSampleRate: number | null;
  oversamplingTargetSampleRate: number | null;
  oversamplingFactor: number | null;
  oversamplingPrecision: number | null;
  oversamplingRuntime: AudioEchoSrcRuntimeStatus | null;
  modulatorProfile: AudioSdmModulatorProfile | null;
  processingMode: AudioEchoSrcFirProcessingMode | null;
  batchFrames: number | null;
  maxBlockFrames: number | null;
  lastInputFrames: number | null;
  lastOutputFrames: number | null;
  cudaActive: boolean;
  fallbackReason: string | null;
  workerRequests: number | null;
  workerAverageMs: number | null;
  workerLastMs: number | null;
  realtimeRatio: number | null;
};
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

export type AudioCudaRuntimeStatus = {
  available: boolean;
  source: 'nvidia-smi' | 'missing' | 'error';
  deviceName: string | null;
  memoryTotalMiB?: number | null;
  driverVersion: string | null;
  cudaVersion: string | null;
  error: string | null;
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
  inputTruePeakDb?: number | null;
  estimatedOutputTruePeakDb?: number | null;
  truePeakHeadroomDb?: number | null;
  intersamplePeakDb?: number | null;
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
};

export type AudioOutputSettings = {
  backendContractVersion?: AudioBackendContractVersion;
  outputMode?: AudioOutputMode;
  sharedBackend?: AudioSharedBackend;
  deviceIndex?: number;
  deviceName?: string;
  requestedOutputSampleRate?: number;
  latencyProfile?: AudioLatencyProfile;
  bufferSizeFrames?: number | null;
  useNativeOutput?: boolean;
  useMiniaudioOutput?: boolean;
  useLibavDecode?: boolean;
  nativeDirectLocalPlaybackEnabled?: boolean;
  dsdOutputMode?: AudioDsdOutputMode;
  sdmMode?: AudioSdmMode;
  sdmTargetRate?: AudioSdmTargetRate;
  sdmQualityProfile?: AudioSdmQualityProfile;
  sdmComputeBackend?: AudioSdmComputeBackend;
  sdmOversamplingFilterProfile1x?: AudioEchoSrcFilterProfile;
  sdmOversamplingFilterProfileNx?: AudioEchoSrcFilterProfile;
  exclusiveInstabilityFallbackEnabled?: boolean;
  defaultDeviceFallbackEnabled?: boolean;
  soxrFallbackEnabled?: boolean;
  echoSrcMode?: AudioEchoSrcMode;
  echoSrcQualityProfile?: AudioEchoSrcQualityProfile;
  echoSrcAdvancedModeEnabled?: boolean;
  echoSrcFilterProfile?: AudioEchoSrcFilterProfile;
  echoSrcFilterProfile1x?: AudioEchoSrcFilterProfile;
  echoSrcFilterProfileNx?: AudioEchoSrcFilterProfile;
  echoSrcComputeBackend?: AudioEchoSrcComputeBackend;
  pcmDitherMode?: AudioPcmDitherMode;
  releaseExclusiveOnPauseExperimentalEnabled?: boolean;
  volume?: number;
  playbackRate?: number;
  playbackSpeedMode?: PlaybackSpeedMode;
};

export type AudioStatus = {
  host: 'not-initialized' | 'starting' | 'ready' | 'unavailable' | 'error';
  cpuModel?: string | null;
  state: AudioPlaybackState;
  outputDeviceId: string | null;
  outputDeviceName: string | null;
  outputDeviceType: string | null;
  outputBackend: string | null;
  activeOutputBackendImpl: string | null;
  nativeOutputFormat?: string | null;
  outputMode: AudioOutputMode;
  sharedBackend?: AudioSharedBackend | null;
  backendContractVersion?: AudioBackendContractVersion;
  useNativeOutputRequested?: boolean;
  useLibavDecodeRequested?: boolean;
  useMiniaudioOutputRequested?: boolean;
  activeOutputBackendLabel?: string | null;
  nativeDirectLocalPlaybackRequested?: boolean;
  nativeDirectLocalPlaybackActive?: boolean;
  nativeDirectLocalPlaybackFallbackReason?: NativeDirectLocalPlaybackFallbackReason | null;
  activeDecodeBackendLabel?: string | null;
  activeDecodeBackendImpl: string | null;
  dsdOutputModeRequested?: AudioDsdOutputMode;
  activeDsdOutputMode?: ActiveDsdOutputMode;
  dsdNativeSampleRate?: number | null;
  dsdTransportSampleRate?: number | null;
  sdmMode?: AudioSdmMode;
  sdmTargetRate?: AudioSdmTargetRate;
  sdmQualityProfile?: AudioSdmQualityProfile;
  sdmComputeBackend?: AudioSdmComputeBackend;
  sdmOversamplingFilterProfile1x?: AudioEchoSrcFilterProfile;
  sdmOversamplingFilterProfileNx?: AudioEchoSrcFilterProfile;
  sdmActualComputeBackend?: AudioSdmComputeBackend | null;
  sdmActive?: boolean;
  sdmRuntimeState?: AudioSdmRuntimeState;
  sdmNativeSampleRate?: number | null;
  sdmTransportSampleRate?: number | null;
  sdmModulatorProfile?: AudioSdmModulatorProfile | null;
  sdmCudaStatus?: AudioCudaRuntimeStatus | null;
  sdmRuntime?: AudioSdmRuntimeStatus | null;
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
  echoSrcMode?: AudioEchoSrcMode;
  echoSrcQualityProfile?: AudioEchoSrcQualityProfile;
  echoSrcAdvancedModeEnabled?: boolean;
  echoSrcFilterProfile?: AudioEchoSrcFilterProfile;
  echoSrcFilterProfile1x?: AudioEchoSrcFilterProfile;
  echoSrcFilterProfileNx?: AudioEchoSrcFilterProfile;
  echoSrcComputeBackend?: AudioEchoSrcComputeBackend;
  echoSrcCudaActive?: boolean;
  echoSrcCudaStatus?: AudioCudaRuntimeStatus;
  echoSrcTargetSampleRate?: number | null;
  echoSrcActive?: boolean;
  echoSrcRuntime?: AudioEchoSrcRuntimeStatus | null;
  pcmDitherMode?: AudioPcmDitherMode;
  pcmDitherActive?: boolean;
  pcmDitherTargetBitDepth?: 16 | 24 | null;
  pcmDitherReason?: string | null;
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
  lastSharedStabilityRecoveryAt?: string | null;
  warnings: string[];
  error: string | null;
};

export const audioBackendContractVersion: AudioBackendContractVersion = 2;

export const normalizeAudioBackendLabel = (label: string | null | undefined): string | null => {
  if (!label) {
    return label ?? null;
  }

  return label;
};

export const normalizeAudioBackendWarning = (warning: string): string => {
  if (warning === 'juce_decode_fell_back_to_ffmpeg') {
    return 'libav_decode_fell_back_to_ffmpeg';
  }
  if (warning === 'juce_shared_output_skipped_same_device_native_retry') {
    return 'native_shared_output_skipped_same_device_native_retry';
  }
  if (warning === 'juce_output_fell_back_to_native') {
    return 'native_output_fell_back_to_standard';
  }
  if (warning.startsWith('juce_') && warning.endsWith('_output_fell_back_to_native')) {
    return `native_${warning.slice('juce_'.length, -'_output_fell_back_to_native'.length)}_output_fell_back_to_standard`;
  }
  if (warning === 'juce_exclusive_startup_position_runaway') {
    return 'native_exclusive_startup_position_runaway';
  }
  if (warning === 'juce_exclusive_fell_back_to_native') {
    return 'native_exclusive_fell_back_to_standard';
  }

  return warning;
};

export const withAudioBackendCompatibilityWarnings = (warnings: readonly string[]): string[] => {
  const next: string[] = [];
  for (const warning of warnings) {
    if (!next.includes(warning)) {
      next.push(warning);
    }
    const normalized = normalizeAudioBackendWarning(warning);
    if (normalized !== warning && !next.includes(normalized)) {
      next.push(normalized);
    }
  }
  return next;
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
  | 'backendContractVersion'
  | 'useNativeOutputRequested'
  | 'useMiniaudioOutputRequested'
  | 'useLibavDecodeRequested'
  | 'activeOutputBackendLabel'
  | 'nativeDirectLocalPlaybackRequested'
  | 'nativeDirectLocalPlaybackActive'
  | 'nativeDirectLocalPlaybackFallbackReason'
  | 'activeDecodeBackendLabel'
  | 'activeDecodeBackendImpl'
  | 'dsdOutputModeRequested'
  | 'activeDsdOutputMode'
  | 'dsdNativeSampleRate'
  | 'dsdTransportSampleRate'
  | 'outputDeviceName'
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
  | 'echoSrcMode'
  | 'echoSrcQualityProfile'
  | 'echoSrcAdvancedModeEnabled'
  | 'echoSrcFilterProfile'
  | 'echoSrcFilterProfile1x'
  | 'echoSrcFilterProfileNx'
  | 'echoSrcComputeBackend'
  | 'echoSrcCudaActive'
  | 'echoSrcCudaStatus'
  | 'echoSrcTargetSampleRate'
  | 'echoSrcActive'
  | 'echoSrcRuntime'
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
