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
export const audioEchoSrcModes = ['off', 'family2x', 'family4x', 'family8x'] as const;
export type AudioEchoSrcMode = (typeof audioEchoSrcModes)[number];
export const audioEchoSrcQualityProfiles = ['transparent', 'balanced', 'lowLatency'] as const;
export type AudioEchoSrcQualityProfile = (typeof audioEchoSrcQualityProfiles)[number];
export type FfmpegToolchainSource = 'explicit' | 'bundled' | 'dev-bundled' | 'system';
export type AudioDsdOutputMode = 'pcm' | 'dop';
export type ActiveDsdOutputMode = 'pcm' | 'dop' | 'native' | null;
export type AudioAutomixMode = 'off' | 'armed' | 'transitioning';
export const audioExportFormats = ['mp3', 'wav', 'flac', 'ogg'] as const;
export type AudioExportFormat = (typeof audioExportFormats)[number];
export const uzumeFormatPaths = [
  'pcm_bitperfect',
  'pcm_processed',
  'dsd_direct',
  'dsd_upsampling',
  'd2p_processed',
  'sdm_processed',
] as const;
export type UzumeFormatPath = (typeof uzumeFormatPaths)[number];
export type UzumeFormatPathPlanState = 'current' | 'available' | 'disabled' | 'unavailable' | 'planned';
export type UzumeFormatPathPlanEntry = {
  state: UzumeFormatPathPlanState;
  reason?: string | null;
};
export type UzumeFormatPathPlan = Partial<Record<UzumeFormatPath, UzumeFormatPathPlanEntry>>;
export const uzumeReferenceSectionIds = [
  'format-path',
  'dsd-ingress',
  'precision-normalization',
  'headroom',
  'replaygain',
  'materialized-gain',
  'peq',
  'stereo-procedural',
  'crossfeed',
  'pcm-src',
  'shared-convolution',
  'safety-meter',
  'limiter',
  'dither',
  'sdm-modulator',
] as const;
export type UzumeReferenceSectionId = (typeof uzumeReferenceSectionIds)[number];
export type UzumeReferenceEngineId =
  | 'format-path-planner-reference'
  | 'dsd-ingress-reference'
  | 'precision-normalization-reference'
  | 'gain-reference'
  | 'iir-reference'
  | 'stereo-procedural-reference'
  | 'stereo-matrix-filter-reference'
  | 'resampling-reference'
  | 'shared-convolution-planner-reference'
  | 'safety-metering-reference'
  | 'limiter-reference'
  | 'dither-reference'
  | 'sdm-reference'
  | 'identity-bypass';
export type UzumeReferenceAssignment = {
  sectionId: UzumeReferenceSectionId;
  engineId: UzumeReferenceEngineId;
  active: boolean;
  source: 'format-planner' | 'ui-section' | 'playback-policy' | 'compat-readout';
  mergeGroupId?: string | null;
  splitReason?: string | null;
  latencyOwner?: string | null;
};
export type UzumeReferenceMergeGroup = {
  id: string;
  engineId: UzumeReferenceEngineId;
  sections: UzumeReferenceSectionId[];
  active: boolean;
  sampleRateFamily?: string | null;
  splitReason?: string | null;
};
export type UzumeReferenceSampleRateFamily = '44.1k-family' | '48k-family' | 'custom-rate-family';
export type UzumeReferenceConvolutionSourceKind =
  | 'fir-eq'
  | 'headphone-fir-correction'
  | 'room-ir'
  | 'advanced-matrix-fir'
  | 'long-src-tail';
export type UzumeReferenceConvolutionSource = {
  id: string;
  kind: UzumeReferenceConvolutionSourceKind;
  sampleRate: number;
  sampleRateFamily: UzumeReferenceSampleRateFamily;
  channelLayout: 'mono' | 'stereo' | 'multichannel' | 'matrix';
  channels: number;
  tapCount: number;
  latencySamples: number;
  phasePolicy: 'linear' | 'minimum' | 'mixed' | 'unknown';
  routing: 'per-channel' | 'stereo-pair' | 'matrix' | 'analysis-only';
};
export type UzumeReferenceConvolutionPartitionPlan = {
  sampleRateFamily: UzumeReferenceSampleRateFamily | null;
  exactSampleRate: number | null;
  channelLayout: string | null;
  latencyClass: 'inactive' | 'realtime-low' | 'quality-first' | 'render-ahead-extreme';
  callbackBlockFrames: number;
  internalBlockFrames: number;
  outputBlockFrames: number;
  directHeadTaps: number;
  fftHeadSize: number;
  fftTailSizes: number[];
  partitionHopSizes: number[];
  partitionCount: number;
  tailFrames: number;
  tailSeconds: number;
  warmupFrames: number;
  drainFrames: number;
  overlapStrategy: 'none' | 'overlap-save-reference';
  cpuPlanId: string | null;
  gpuPlanId: string | null;
};
export type UzumeReferenceResponseResamplePolicyReport = {
  artifact: 'high-precision-response-resample-policy-reference';
  sourceId: string;
  kind: UzumeReferenceConvolutionSourceKind;
  sourceRate: number | null;
  targetRate: number | null;
  sourceFamily: UzumeReferenceSampleRateFamily | null;
  targetFamily: UzumeReferenceSampleRateFamily | null;
  state: 'same-rate-bypass' | 'windowed-sinc-reference-required' | 'target-rate-unavailable';
  engine: 'exact-bypass' | 'windowed-sinc-float64-reference' | 'unavailable';
  sameRateBypass: boolean;
  linearInterpolationRejected: boolean;
  filterContract: UzumeReferenceResamplingFilterContract | null;
  reason:
    | 'same_rate_exact_bypass'
    | 'cross_family_response_resample_uses_windowed_sinc_reference'
    | 'exact_rate_mismatch_response_resample_uses_windowed_sinc_reference'
    | 'target_rate_unavailable';
};
export type UzumeReferenceSharedConvolutionDuplicatePlanGuardReport = {
  artifact: 'shared-convolution-duplicate-plan-guard-reference';
  engine: 'shared-convolution-planner-reference';
  state: 'single-shared-plan' | 'split-required' | 'inactive';
  sourceAssignments: Array<{
    sourceId: string;
    state: 'shared-plan' | 'split-required';
    convolverPlanId: string | null;
    fftPlanId: string | null;
    splitReason: string | null;
  }>;
  planCounts: {
    mergedSourceCount: number;
    splitSourceCount: number;
    convolverPlanCount: number;
    cpuFftPlanCount: number;
    gpuFftPlanCount: number;
    rejectedDuplicateConvolverCount: number;
    rejectedDuplicateFftPlanCount: number;
  };
  rejectedDuplicatePlans: Array<{
    sourceId: string;
    rejectedConvolverPlanId: string;
    rejectedFftPlanId: string;
    reason: 'compatible_source_uses_shared_convolution_plan';
  }>;
  reasons: string[];
};
export type UzumeReferenceSharedConvolutionSerialNullReport = {
  artifact: 'shared-convolution-serial-null-reference';
  engine: 'shared-convolution-planner-reference';
  state: 'merged-matches-serial' | 'split-or-inactive' | 'residual-over-threshold';
  sourceOrder: string[];
  mergedResponseTapCounts: number[];
  comparedFrames: number;
  maxAbs: number | null;
  rms: number | null;
  reasons: string[];
};
export type UzumeReferenceSharedConvolutionReport = {
  active: boolean;
  engine: 'shared-convolution-planner-reference';
  sources: UzumeReferenceConvolutionSource[];
  mergedSourceIds: string[];
  splitSourceIds: string[];
  splitReasons: Record<string, string>;
  partitionPlan: UzumeReferenceConvolutionPartitionPlan;
  responseResampleReports: UzumeReferenceResponseResamplePolicyReport[];
  duplicatePlanGuard?: UzumeReferenceSharedConvolutionDuplicatePlanGuardReport | null;
  serialNullReference?: UzumeReferenceSharedConvolutionSerialNullReport | null;
};
export type UzumeReferenceResamplingFilterContract = {
  tapCount: number;
  phaseCount: number;
  cutoffRatio: number;
  transitionWidthRatio: number;
  stopbandAttenuationDb: number;
  passbandRippleDb: number;
};
export type UzumeReferenceResamplingPhaseMode = 'linear' | 'minimum' | 'intermediate';
export type UzumeReferenceResamplingApodizing = 'reference-windowed-sinc';
export type UzumeReferenceResamplingPhaseArtifact = {
  mode: UzumeReferenceResamplingPhaseMode;
  impulsePeakIndex: number | null;
  groupDelaySamples: number;
  groupDelaySpreadSamples: number | null;
  preRingingEnergy: number;
  postRingingEnergy: number;
  residualVsLinearMaxAbs: number;
  residualVsLinearRms: number;
};
export type UzumeReferenceResamplingPhaseModeArtifacts = {
  artifact: 'poly-sinc-phase-mode-reference';
  phaseModesMeasured: ['linear', 'minimum', 'intermediate'];
  modes: UzumeReferenceResamplingPhaseArtifact[];
};
export type UzumeReferenceResamplingApodizingArtifact = {
  artifact: 'poly-sinc-apodizing-response-reference';
  mode: UzumeReferenceResamplingApodizing;
  baseline: 'rectangular-sinc-reference';
  state: 'apodizing-changes-ringing-response' | 'same-rate-bypass';
  highFrequencyRestorationClaim: false;
  apodizedRingingEnergy: number;
  baselineRingingEnergy: number;
  ringingReductionDb: number | null;
  responseResidualMaxAbs: number;
  responseResidualRms: number;
};
export type UzumeReferenceResamplingQualityProfile = {
  id:
    | 'poly-sinc-reference-linear-full'
    | 'poly-sinc-reference-linear-balanced'
    | 'poly-sinc-reference-linear-short'
    | 'poly-sinc-reference-random-access-short-bridge';
  family: 'poly-sinc-reference';
  phaseMode: UzumeReferenceResamplingPhaseMode;
  apodizing: UzumeReferenceResamplingApodizing;
  tapCount: number;
  stopbandAttenuationDb: number;
  latencyClass: 'full' | 'balanced' | 'short-bridge';
  shortBridgeOnlyFor: 'user-random-seek-or-skip' | null;
};
export type UzumeReferenceResamplingQualityRollbackReport = {
  artifact: 'poly-sinc-quality-rollback-reference';
  state: 'standby' | 'armed' | 'not-applicable';
  reason: 'reference-profile-within-budget' | 'realtime-budget-warning' | 'same-rate-bypass';
  primaryProfile: UzumeReferenceResamplingQualityProfile;
  rollbackChain: UzumeReferenceResamplingQualityProfile[];
  familyLock: 'poly-sinc-reference-only';
  legacyFallbackAllowed: false;
  legacyFallbackSignalPath: 'UZUME bypass / legacy non-UZUME path';
  shortBridgeIsRollback: false;
};
export type UzumeReferenceOutputResamplingRiskReport = {
  artifact: 'output-double-resampling-risk-reference';
  state: 'none' | 'legacy-resampler-active' | 'shared-output-mixer-risk' | 'device-rate-mismatch-risk';
  reason: string | null;
  requestedOutputRate: number | null;
  actualDeviceRate: number | null;
  sharedDeviceRate: number | null;
  currentResamplerEngine: AudioResamplerEngine | null;
  signalPathTone: 'good' | 'warning';
  recommendation:
    | 'none'
    | 'show-legacy-resampler-as-non-uzume-risk'
    | 'prefer-exclusive-or-device-rate-match'
    | 'inspect-device-rate-mismatch';
};
export type UzumeReferenceResamplingArtifactMetrics = {
  impulsePeakIndex: number | null;
  impulsePeak: number;
  impulseEnergy: number;
  sweepPeak: number;
  logSweepPeak: number;
  nearNyquistPeak: number;
  multiTonePeak: number;
  randomPeak: number;
  randomSeed: number;
  silencePeak: number;
  silenceResidual: {
    state: 'exact-silence' | 'residual-over-threshold';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  aliasRejectionDb: number | null;
  phaseGroupDelaySpreadSamples: number | null;
  passbandRippleDb: number | null;
  cutoffRatioEstimate: number | null;
  transitionWidthRatioEstimate: number | null;
  stopbandAttenuationDb: number | null;
  realtimeBudget: {
    backend: 'scalar-float64-reference';
    estimatedMultiplyAdds: number;
    estimatedRealtimeFactor: number | null;
    safetyClass: 'offline-reference-only' | 'same-rate-bypass';
  };
  nullResidual: {
    state: 'exact-bypass' | 'not-applicable';
    comparedFrames: number;
    maxAbs: number | null;
    rms: number | null;
  };
};
export type UzumeReferenceResamplingValidationThresholds = {
  passbandRippleDbMax?: number;
  stopbandAttenuationDbMin?: number;
  transitionWidthRatioMax?: number;
  silenceMaxAbs?: number;
  sameRateNullMaxAbs?: number;
  sameRateNullRmsMax?: number;
  estimatedMultiplyAddsMax?: number;
  requireMeasuredRealtimeFactor?: boolean;
};
export type UzumeReferenceResamplingValidationCheck = {
  id:
    | 'passband-ripple'
    | 'stopband-attenuation'
    | 'transition-width'
    | 'silence-preservation'
    | 'same-rate-null'
    | 'realtime-budget';
  state: 'pass' | 'warn' | 'fail' | 'not-applicable';
  actual: number | null;
  threshold: number | null;
  reason: string;
};
export type UzumeReferenceResamplingValidationResult = {
  artifact: 'poly-sinc-formal-validation-reference';
  overall: 'pass' | 'warn' | 'fail';
  checks: UzumeReferenceResamplingValidationCheck[];
  thresholds: Required<Omit<UzumeReferenceResamplingValidationThresholds, 'requireMeasuredRealtimeFactor'>> & {
    requireMeasuredRealtimeFactor: boolean;
  };
};
export type UzumeReferenceResamplingReport = {
  active: boolean;
  family: 'poly-sinc-reference';
  phaseMode: UzumeReferenceResamplingPhaseMode;
  apodizing: UzumeReferenceResamplingApodizing;
  sourceRate: number | null;
  targetRate: number | null;
  sourceFamily: UzumeReferenceSampleRateFamily | null;
  targetFamily: UzumeReferenceSampleRateFamily | null;
  ratio: number | null;
  sameRateBypass: boolean;
  groupDelaySamples: number;
  groupDelayMs: number | null;
  lookaheadSamples: number;
  lookaheadMs: number | null;
  phaseAccumulator: 'rational-fixed-step' | 'same-rate-bypass' | 'unavailable';
  filterContract: UzumeReferenceResamplingFilterContract;
  artifactMetrics: UzumeReferenceResamplingArtifactMetrics;
  phaseModeArtifacts: UzumeReferenceResamplingPhaseModeArtifacts;
  apodizingArtifact: UzumeReferenceResamplingApodizingArtifact;
  validation?: UzumeReferenceResamplingValidationResult | null;
  qualityRollback: UzumeReferenceResamplingQualityRollbackReport;
  outputResamplingRisk: UzumeReferenceOutputResamplingRiskReport;
  realtimeSafetyClass: 'offline-reference-only' | 'same-rate-bypass';
  doubleResamplingRisk?: string | null;
};
export type UzumeReferenceArtifactPlan = {
  impulse: 'deterministic-reference';
  sweep: 'deterministic-reference';
  logSweep: 'deterministic-reference';
  nearNyquist: 'deterministic-reference';
  multiTone: 'deterministic-reference';
  random: 'deterministic-reference';
  silence: 'deterministic-reference';
  phaseGroupDelay: 'deterministic-reference';
  phaseMode: 'deterministic-reference';
  apodizing: 'deterministic-reference';
  aliasRejection: 'deterministic-reference' | 'planned';
  realtimeBudget: 'deterministic-reference' | 'planned';
  nullResidual: 'deterministic-reference' | 'planned';
  formalValidation: 'deterministic-reference' | 'planned';
  dsdFamilyPath: 'deterministic-reference' | 'not-applicable';
  backendSupport: 'deterministic-reference';
  outputDevicePolicy: 'deterministic-reference';
  latencyBudget: 'deterministic-reference';
  readinessContract: 'deterministic-reference';
  generationCacheKey: 'deterministic-reference';
  qualityRollback: 'deterministic-reference';
  outputResamplingRisk: 'deterministic-reference';
  pcmOutputQuantization: 'deterministic-reference';
  pcmIngressGuard: 'deterministic-reference';
  gainStaging: 'deterministic-reference';
  iirEq: 'deterministic-reference';
  channelScope: 'deterministic-reference';
  stereoProcedural: 'deterministic-reference';
  perEarEqPlacement: 'deterministic-reference';
  sharedConvolutionDuplicateGuard: 'deterministic-reference';
  sharedConvolutionSerialNull: 'deterministic-reference';
  gaplessConcat: 'deterministic-reference';
  firGaplessHistory: 'deterministic-reference';
  callbackSafeControls: 'deterministic-reference';
  equalPowerCrossfade: 'deterministic-reference';
  blockBoundary: 'deterministic-reference';
  flushDrain: 'deterministic-reference';
};
export type UzumeReferenceCallbackSafeControlCaseReport = {
  control: 'pause' | 'resume' | 'stop' | 'mute' | 'volume' | 'declick' | 'flush' | 'seek' | 'reset' | 'profile-change' | 'device-change';
  classification: 'callback-safe-urgent-control' | 'render-state-boundary';
  generationState: 'current' | 'stale-candidate';
  state: 'applied' | 'render-cache-invalidated' | 'stale-candidate-rejected';
  callbackRule: 'read-committed-output-then-apply-urgent-control' | 'read-committed-output-only';
  renderCacheAction: 'preserve' | 'invalidate-generation' | 'reject-stale-generation';
  generationAfterControl: number;
  requiresRenderGraphRebuild: boolean;
  commitAllowed: boolean;
  gainEnvelopeFrames: number;
  declick: {
    enabled: boolean;
    frames: number;
    startGain: number;
    endGain: number;
    maxStep: number;
  };
  peak: {
    input: number;
    output: number;
  };
  reasons: string[];
};
export type UzumeReferenceCallbackSafeControlsInspectReport = {
  artifact: 'callback-safe-urgent-controls-reference';
  policy: 'urgent-controls-after-committed-output';
  urgentControl: UzumeReferenceCallbackSafeControlCaseReport;
  renderStateBoundary: UzumeReferenceCallbackSafeControlCaseReport;
};
export type UzumeReferenceEqualPowerCrossfadeCaseReport = {
  intent: 'cold-start' | 'normal-playlist-boundary' | 'gapless-boundary' | 'cache-miss' | 'underrun-protection' | 'user-random-seek-or-skip';
  sampleRate: number;
  fadeFrames: number;
  durationMs: number;
  state: 'crossfade-rendered' | 'rejected';
  rejectionReason: null | 'intent_not_user_random_seek_or_skip' | 'full_profile_not_ready' | 'insufficient_overlap';
  gainLaw: {
    state: 'equal-power' | 'not-applicable';
    maxPowerSumError: number;
    midpointShortBridgeGain: number | null;
    midpointFullProfileGain: number | null;
  };
  residualVsHardSwitch: {
    state: 'measured-crossfade-difference' | 'matches-for-input' | 'not-applicable';
    comparedFrames: number;
    maxAbs: number | null;
    rms: number | null;
  };
  peak: {
    shortBridge: number;
    fullProfile: number;
    output: number;
  };
  reasons: string[];
};
export type UzumeReferenceEqualPowerCrossfadeInspectReport = {
  artifact: 'equal-power-crossfade-reference';
  policy: 'random-access-short-bridge-to-full-profile-only';
  rendered: UzumeReferenceEqualPowerCrossfadeCaseReport;
  rejectedBoundary: UzumeReferenceEqualPowerCrossfadeCaseReport;
};
export type UzumeReferencePerEarEqPlacementInspectReport = {
  artifact: 'per-ear-eq-placement-reference';
  orderContract: ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'];
  compilerRule: 'do-not-reorder-across-crossfeed-without-null-proof';
  state: 'placement-sensitive' | 'commutative-for-input';
  sampleRate: number;
  perEarEq: {
    leftGainDb: number;
    rightGainDb: number;
  };
  crossfeed: {
    enabled: boolean;
    crossGainDb: number | null;
    crossDelayMs: number | null;
    lowPassHz: number | null;
    centerPreservation: 'normalize' | 'none';
  };
  preCrossfeedSteps: string[];
  postCrossfeedSteps: string[];
  residual: {
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  reasons: string[];
};
export type UzumeReferenceGaplessConcatInspectReport = {
  artifact: 'gapless-concat-reference';
  policy: 'source-pcm-concat-before-src';
  state: 'src-stateful' | 'same-rate-bypass';
  sourceRate: number;
  targetRate: number;
  ratio: number;
  segmentCount: number;
  boundaryCount: number;
  concatNullResidual: {
    state: 'concat-matches-no-reset';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  resetResidual: {
    state: 'reset-vs-concat-reference';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  boundaries: Array<{
    beforeSegmentId: string;
    afterSegmentId: string;
    sourceFrameOffset: number;
    outputFrameOffset: number;
    concatVsNoResetMaxAbs: number;
    resetVsConcatMaxAbs: number;
    resetVsConcatRms: number;
    outputJump: number;
  }>;
  reasons: string[];
};
export type UzumeReferenceFirGaplessHistoryInspectReport = {
  artifact: 'fir-gapless-history-reference';
  policy: 'source-pcm-concat-before-fir';
  engine: 'direct-fir-float64-reference';
  state: 'history-required' | 'identity-bypass';
  sourceId: string;
  sampleRate: number;
  segmentCount: number;
  boundaryCount: number;
  tailFrames: number;
  drainFrames: number;
  concatNullResidual: {
    state: 'concat-matches-no-reset-history';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  resetResidual: {
    state: 'reset-vs-concat-history-reference';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  boundaries: Array<{
    beforeSegmentId: string;
    afterSegmentId: string;
    sourceFrameOffset: number;
    outputFrameOffset: number;
    overlapHistoryFrames: number;
    concatVsNoResetMaxAbs: number;
    resetVsConcatMaxAbs: number;
    resetVsConcatRms: number;
    outputJump: number;
  }>;
  reasons: string[];
};
export type UzumeReferenceContinuityInspectReport = {
  artifact: 'continuity-telemetry-reference';
  policy: 'callback-read-committed-reference';
  continuity: {
    artifact: 'continuity-quality-policy-reference';
    intent:
      | 'cold-start'
      | 'normal-playlist-boundary'
      | 'gapless-boundary'
      | 'cache-miss'
      | 'underrun-protection'
      | 'user-random-seek-or-skip';
    policy: 'quality-first' | 'gpu-wait' | 'predictive-cache' | 'random-access-short-bridge';
    selectedPath:
      | 'gpu-full-profile'
      | 'cpu-full-profile'
      | 'predictive-cache'
      | 'wait-for-full-profile'
      | 'random-access-short-bridge'
      | 'reject-stale-generation';
    callbackRule: 'read-committed-output-only';
    commitAllowed: boolean;
    shortBridgeAllowed: boolean;
    shortBridgeReason: string | null;
    qualityRollback: 'none' | 'short-bridge-temporary';
    waitTarget: 'none' | 'gpu-full-profile' | 'cpu-or-gpu-full-profile' | 'predictive-cache-or-full-profile';
  };
  preRoll: {
    artifact: 'pre-roll-deadline-reference';
    state: 'ready' | 'deadline-safe' | 'start-pre-roll-now' | 'deadline-missed' | 'stale-candidate';
    preRollRequiredFrames: number;
    framesUntilBoundary: number;
    deadlineSlackFrames: number;
    renderAheadState: 'full-profile-ready' | 'cache-hit' | 'cache-warming' | 'cache-miss';
    renderAheadTargetFrames: number;
    renderAheadReadyFrames: number;
    callbackBlockFrames: number;
    outputRingDepthFrames: number;
    readRule: 'read-committed-output-only';
    mustNotWaitForGpu: true;
    handoffStrategy: 'same-pipeline-no-reset' | 'dual-pipeline-handoff';
    requiresDualPipeline: boolean;
    commitAllowed: boolean;
    shortBridgeAllowed: false;
  };
  callbackRing: {
    artifact: 'cpu-callback-ring-reference';
    state: 'stable' | 'low-depth' | 'underrun-risk' | 'underrun';
    telemetryStatus: 'safe' | 'marginal' | 'unsafe';
    capacityFrames: number;
    depthFrames: number;
    depthBlocks: number;
    callbackBlockFrames: number;
    missingFrames: number;
    readRule: 'read-committed-output-only';
    mustNotWaitForGpu: true;
    shortBridgeAllowed: false;
    shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge';
  };
  renderAheadCache: {
    artifact: 'render-ahead-cache-reference';
    lookupState: 'hit' | 'miss' | 'late-hit' | 'incomplete-hit' | 'stale-hit-rejected';
    commitState:
      | 'commit-to-callback-slot'
      | 'callback-keeps-prior-committed-output'
      | 'retain-for-future-cache'
      | 'reject-stale-generation';
    commitAllowed: boolean;
    callbackRule: 'read-committed-output-only';
    mustNotWaitForGpu: true;
    requestKey: string;
    budgetBytes: number;
    bytesBeforeEvict: number;
    bytesAfterEvict: number;
    retainedKeys: string[];
    evictionCount: number;
  };
  fallback: {
    artifact: 'fallback-injection-underrun-reference';
    state:
      | 'gpu-render-ahead-commit'
      | 'cpu-main-chain-fallback'
      | 'prior-committed-fallback'
      | 'silence-injected'
      | 'stale-candidate-rejected';
    selectedSource: 'gpu-render-ahead' | 'cpu-main-chain' | 'prior-committed' | 'silence' | null;
    telemetryStatus: 'safe' | 'marginal' | 'unsafe';
    callbackMustNotWaitForGpu: true;
    shortBridgeAllowed: false;
    shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge';
    qualityRollback: 'none' | 'controlled-fallback' | 'silence-underrun';
    fallbackInjected: boolean;
    commitAllowed: boolean;
  };
};
export type UzumeReferenceDsdControlId =
  | 'headroom'
  | 'safety-metering'
  | 'overload-guard'
  | 'sdm-modulator'
  | 'eq'
  | 'fir'
  | 'crossfeed'
  | 'channel-matrix'
  | 'replaygain'
  | 'pcm-src'
  | 'pcm-dither'
  | 'pcm-limiter';
export type UzumeReferenceDsdFamilyReport = {
  artifact: 'dsd-family-path-control-reference';
  formatPath: Extract<UzumeFormatPath, 'dsd_direct' | 'dsd_upsampling' | 'd2p_processed' | 'sdm_processed'>;
  sourceContainer: 'dsd';
  outputContainer: 'pcm' | 'dop' | 'dsd_native';
  internalDomain: 'dsd-direct' | 'multibit-pcm' | 'sdm-modulator-input';
  state: 'direct' | 'sdm-only-reference' | 'd2p-reference' | 'sdm-processed-reference' | 'unavailable';
  directDisabledReason: string | null;
  fallbackReason: 'd2p_reference_engine_not_ready' | 'sdm_reference_engine_not_ready' | null;
  experimental: boolean;
  pcmDomainDspAllowed: boolean;
  entersPcmDsp: boolean;
  pcmDitherAllowed: boolean;
  sdmNoiseShapingTelemetry: boolean;
  allowedControls: UzumeReferenceDsdControlId[];
  disabledControls: Array<{
    control: UzumeReferenceDsdControlId;
    reason:
      | 'dsd_direct_is_bitstream_only'
      | 'requires_d2p_processed_or_sdm_processed'
      | 'requires_d2p_processed'
      | 'sdm_uses_noise_shaping_not_pcm_dither'
      | 'sdm_reference_engine_not_ready'
      | 'd2p_reference_engine_not_ready';
  }>;
  dsd: {
    sourceDsdRate: number | null;
    targetDsdRate: number | null;
    outputEncoding: string | null;
  };
  d2p: {
    active: boolean;
    available: boolean;
    decimationProfile: string | null;
    internalPcmRate: number | null;
  };
  sdm: {
    active: boolean;
    available: boolean;
    mode: 'none' | 'dsd-upsampling' | 'sdm-processed';
    modulatorProfile: string | null;
    targetDsdRate: number | null;
    headroomDb: number | null;
    overloadMarginDb: number | null;
    ultrasonicNoiseRisk: 'normal' | 'elevated' | 'unsafe' | null;
    realtimeSafetyClass: 'offline-reference-only';
  };
  reasons: string[];
};
export type UzumeReferencePcmOutputSampleFormat =
  | 'float32'
  | 'float64'
  | 'int16'
  | 'int24'
  | 'int32'
  | 'sdm';
export type UzumeReferencePcmDitherMode =
  | 'none'
  | 'tpdf'
  | 'noise-shaped-tpdf';
export type UzumeReferencePcmOutputQuantizationReport = {
  artifact: 'pcm-output-quantization-dither-reference';
  formatPath: UzumeFormatPath;
  outputSampleFormat: UzumeReferencePcmOutputSampleFormat;
  state: 'bypass' | 'quantized' | 'rejected';
  bitPerfectState: 'preserved' | 'disabled' | 'not-applicable';
  pcmDitherAllowed: boolean;
  sdmNoiseShapingTelemetry: boolean;
  dither: {
    mode: UzumeReferencePcmDitherMode;
    enabled: boolean;
    seed: number | null;
    lsbAmplitude: number | null;
    peakDitherLsb: number;
    noiseShaping: 'none' | 'first-order-error-feedback';
  };
  quantization: {
    bitDepth: number | null;
    maxInteger: number | null;
    clippedSamples: number;
    residualMaxAbs: number | null;
    residualRms: number | null;
  };
  reasons: string[];
};
export type UzumeReferencePcmIngressGuardReport = {
  artifact: 'pcm-ingress-guard-reference';
  state: 'ok' | 'silence' | 'sanitized' | 'channel-mismatch';
  expectedChannels: number | null;
  channelCount: number;
  frameCount: number;
  rectangular: boolean;
  counts: {
    nonFiniteReplaced: number;
    denormalZeroed: number;
    channelMismatchCount: number;
    silenceFrames: number;
  };
  peak: number;
  reasons: string[];
};
export type UzumeReferenceGainStageId =
  | 'input'
  | 'headroom'
  | 'replaygain'
  | 'materialized-gain'
  | 'output';
export type UzumeReferenceGainStagingStageReport = {
  id: UzumeReferenceGainStageId;
  gainDb: number;
  cumulativeGainDb: number;
  peak: number;
  rms: number;
  peakDbfs: number;
  rmsDbfs: number;
  clippingRisk: boolean;
};
export type UzumeReferenceGainStagingReport = {
  artifact: 'gain-staging-reference';
  engine: 'gain-reference';
  orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'];
  stages: UzumeReferenceGainStagingStageReport[];
  totalGainDb: number;
  totalGainLinear: number;
  recommendedAdditionalHeadroomDb: number;
  clipRisk: boolean;
  reasons: string[];
};
export type UzumeReferenceIirEqBandInspectReport = {
  index: number;
  filterType: string;
  frequencyHz: number;
  requestedFrequencyHz: number;
  q: number;
  gainDb: number;
  state: 'active' | 'disabled' | 'neutral-bypass';
  coefficientState: 'generated' | 'bypassed';
  responsePeakDb: number;
  responseDipDb: number;
  phaseSpanRadians: number;
  reasons: string[];
};
export type UzumeReferenceIirEqInspectReport = {
  artifact: 'iir-eq-reference';
  engine: 'iir-reference';
  orderContract: 'ui-band-order-biquad-cascade';
  state: 'active' | 'exact-bypass';
  sampleRate: number;
  bandCount: number;
  activeBandCount: number;
  bypassedBandCount: number;
  bands: UzumeReferenceIirEqBandInspectReport[];
  residual: {
    state: 'processed' | 'exact-bypass';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  reasons: string[];
};
export type UzumeReferenceChannelScopeOperationInspectReport = {
  id: string;
  kind: 'gain' | 'mute' | 'invert' | 'mix-from';
  targetChannels: number[];
  skippedChannels: number[];
  state: 'applied' | 'no-targets' | 'invalid-source' | 'noop';
  gainDb: number | null;
  sourceChannel: number | null;
  reasons: string[];
};
export type UzumeReferenceChannelScopeInspectReport = {
  artifact: 'channel-scope-reference';
  engine: 'stereo-procedural-reference';
  scopeContract: 'targeted-channels-only';
  channelCount: number;
  operationCount: number;
  appliedOperationCount: number;
  noopOperationCount: number;
  invalidOperationCount: number;
  untouchedChannelIndexes: number[];
  operations: UzumeReferenceChannelScopeOperationInspectReport[];
  residualByChannel: Array<{
    channelIndex: number;
    state: 'processed' | 'targeted-noop' | 'out-of-scope-bypass';
    maxAbs: number;
    rms: number;
  }>;
  reasons: string[];
};
export type UzumeReferenceStereoProceduralInspectReport = {
  artifact: 'stereo-procedural-matrix-filter-reference';
  engine: 'stereo-procedural-reference';
  state: 'active' | 'identity-bypass';
  sampleRate: number;
  channelCount: number;
  steps: string[];
  matrix: [[number, number], [number, number]];
  delaySamples: {
    left: number;
    right: number;
  };
  routing: {
    invertLeft: boolean;
    invertRight: boolean;
    swapLeftRight: boolean;
    monoMode: ChannelBalanceMonoMode;
  };
  crossfeed: {
    enabled: boolean;
    crossDelaySamples: number;
    lowPassHz: number | null;
    centerPreservation: 'normalize' | 'none';
  };
  input: {
    peak: number;
    rms: number;
  };
  output: {
    peak: number;
    rms: number;
  };
  residual: {
    state: 'processed' | 'exact-bypass';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  reasons: string[];
};
export type UzumeReferenceBlockBoundaryInspectReport = {
  artifact: 'block-boundary-split-reference';
  policy: 'valid-frames-committed-padding-never-output';
  blockFrames: number;
  inputFrames: number;
  channelCount: number;
  blockCount: number;
  blockStates: Array<'full' | 'partial-padded' | 'partial-unpadded'>;
  coverage: {
    state: 'exact' | 'broken';
    coveredFrames: number;
    missingFrames: number;
    duplicateFrames: number;
    committedFrames: number;
    paddedFrames: number;
  };
  residual: {
    state: 'exact-reassembly' | 'mismatch';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  boundaryCount: number;
  maxIntroducedDiscontinuity: number;
  reasons: string[];
};
export type UzumeReferenceFlushDrainIntentReport = {
  intent: 'natural-eof' | 'manual-flush';
  generationAfter: number;
  state: 'drain-committed' | 'tail-dropped-and-reset' | 'stale-candidate-rejected';
  sourceFrames: number;
  tailFrames: number;
  drainFrames: number;
  resetRequired: boolean;
  drainCommitAllowed: boolean;
  residual: {
    sourceWindowMaxAbs: number;
    sourceWindowRms: number;
    drainMaxAbs: number | null;
    drainRms: number | null;
  };
  reasons: string[];
};
export type UzumeReferenceFlushDrainInspectReport = {
  artifact: 'flush-drain-reference';
  engine: 'direct-fir-float64-reference';
  generationId: number;
  generationState: 'current';
  naturalEof: UzumeReferenceFlushDrainIntentReport;
  manualFlush: UzumeReferenceFlushDrainIntentReport;
};
export type UzumeReferenceOutputDevicePolicyInspectReport = {
  artifact: 'output-device-policy-reference';
  formatPath: UzumeFormatPath;
  outputMode: AudioOutputMode | null;
  deviceCapability:
    | 'direct-like-rate-match'
    | 'direct-like-rate-mismatch'
    | 'shared-mixer'
    | 'system-output'
    | 'unknown';
  state:
    | 'direct-like-ready'
    | 'shared-mixer-risk'
    | 'device-rate-mismatch-risk'
    | 'unknown';
  sourceContainer: 'pcm' | 'dsd' | 'unknown';
  outputContainer: 'pcm' | 'dop' | 'dsd_native';
  fileRate: number | null;
  decoderOutputRate: number | null;
  requestedOutputRate: number | null;
  actualDeviceRate: number | null;
  sharedDeviceRate: number | null;
  bitPerfectCandidate: boolean | null;
  resampling: boolean | null;
  sampleRateMismatch: boolean | null;
  recommendation:
    | 'none'
    | 'prefer-exclusive-or-device-rate-match'
    | 'inspect-device-rate-mismatch';
  reasons: string[];
};
export type UzumeReferenceBackendSupportInspectReport = {
  artifact: 'backend-support-reference';
  policy: 'reference-backend-only-no-runtime-switch';
  formatPath: UzumeFormatPath;
  selectedBackend: 'cpu-float64-reference';
  realtimeBackend: 'not-enabled';
  outputDevicePolicyState: UzumeReferenceOutputDevicePolicyInspectReport['state'];
  cpuReference: {
    id: 'cpu-float64-reference';
    state: 'available';
    role: 'deterministic-reference';
  };
  cpuAvx: {
    id: 'cpu-avx2-fused-macro-kernel';
    state: 'future-production-gate';
    gate: 'rpc-003-cpu-realtime-gate';
  };
  gpu: {
    id: 'gpu-render-ahead-offload';
    state: 'future-render-ahead-gate';
    gate: 'rpc-005-gpu-render-ahead-gate';
  };
  legacy: {
    id: 'legacy-dsp-chain';
    state: 'non-uzume-fallback-only';
    allowedInCompiler: false;
  };
  reasons: string[];
};
export type UzumeReferenceLatencyBudgetInspectReport = {
  artifact: 'latency-budget-reference';
  policy: 'reference-budget-summary-no-runtime-scheduler';
  state: 'ready';
  selectedBackend: UzumeReferenceBackendSupportInspectReport['selectedBackend'];
  realtimeBackend: UzumeReferenceBackendSupportInspectReport['realtimeBackend'];
  outputDevicePolicyState: UzumeReferenceOutputDevicePolicyInspectReport['state'];
  sourceRate: number | null;
  targetRate: number | null;
  srcGroupDelaySamples: number;
  srcGroupDelayMs: number | null;
  srcLookaheadSamples: number;
  srcLookaheadMs: number | null;
  convolutionLatencyClass: UzumeReferenceConvolutionPartitionPlan['latencyClass'];
  convolutionLatencySamples: number;
  convolutionDirectHeadTaps: number;
  convolutionWarmupFrames: number;
  convolutionTailFrames: number;
  convolutionDrainFrames: number;
  callbackBlockFrames: number;
  internalBlockFrames: number;
  outputBlockFrames: number;
  preRollRequiredFrames: number;
  deadlineSlackFrames: number;
  outputRingDepthFrames: number;
  callbackRingCapacityFrames: number;
  callbackRingDepthFrames: number;
  callbackRingDepthBlocks: number;
  renderAheadState: UzumeReferenceContinuityInspectReport['preRoll']['renderAheadState'];
  renderAheadTargetFrames: number;
  renderAheadReadyFrames: number;
  cacheBudgetBytes: number;
  cacheBytesAfterEvict: number;
  latencyOwners: Record<string, string>;
  callbackRule: 'read-committed-output-only';
  schedulerState: 'reference-only';
  reasons: string[];
};
export type UzumeReferenceReadinessContractInspectReport = {
  artifact: 'readiness-contract-reference';
  policy: 'main-playback-owns-timeline-uzume-reports-readiness';
  state:
    | 'waiting-for-full-profile'
    | 'ready-to-commit'
    | 'cache-ready'
    | 'short-bridge-reference-only'
    | 'stale-generation-rejected';
  intent: UzumeReferenceContinuityInspectReport['continuity']['intent'];
  playbackPolicy: UzumeReferenceContinuityInspectReport['continuity']['policy'];
  selectedPath: UzumeReferenceContinuityInspectReport['continuity']['selectedPath'];
  waitTarget: UzumeReferenceContinuityInspectReport['continuity']['waitTarget'];
  fullProfileReady: boolean;
  gpuPrewarmReady: boolean;
  gpuPrewarmState: 'future-render-ahead-gate' | 'not-ready';
  cacheState: UzumeReferenceContinuityInspectReport['renderAheadCache']['lookupState'];
  cacheCommitState: UzumeReferenceContinuityInspectReport['renderAheadCache']['commitState'];
  cacheKey: string;
  renderAheadState: UzumeReferenceContinuityInspectReport['preRoll']['renderAheadState'];
  renderAheadReadyFrames: number;
  renderAheadTargetFrames: number;
  deadlineState: UzumeReferenceContinuityInspectReport['preRoll']['state'];
  deadlineSlackFrames: number;
  callbackRingState: UzumeReferenceContinuityInspectReport['callbackRing']['state'];
  callbackRingTelemetryStatus: UzumeReferenceContinuityInspectReport['callbackRing']['telemetryStatus'];
  shortBridgeCandidate: 'available' | 'blocked';
  shortBridgeReason: string | null;
  crossfadeToFullProfile: 'candidate-ready' | 'blocked-by-intent';
  generationCommitRule: 'current-generation-only';
  staleGenerationCommitAllowed: false;
  handoffStrategy: UzumeReferenceContinuityInspectReport['preRoll']['handoffStrategy'];
  productionScheduler: 'not-enabled';
  reasons: string[];
};
export type UzumeReferenceGenerationCacheKeyInspectReport = {
  artifact: 'generation-cache-key-reference';
  policy: 'generation-safe-cache-key-contract-reference';
  state: 'ready';
  generationId: number;
  generationSource: 'playback-intent-reference';
  timelineScope: 'normal-next-track-head' | 'gapless-album-segment';
  trackRole: 'next-track-head' | 'gapless-segment';
  sourceIdentity: 'next-reference';
  albumSegmentKey: string | null;
  albumSegmentIndex: number | null;
  requestKey: string;
  cacheKey: string;
  profileFingerprint: string;
  profileComponents: string[];
  deviceFingerprint: string;
  deviceComponents: string[];
  invalidatesOn: Array<
    | 'seek'
    | 'manual-skip'
    | 'profile-change'
    | 'device-change'
    | 'output-mode-change'
    | 'sample-rate-plan-change'
  >;
  preservesOn: Array<'pause' | 'resume' | 'mute' | 'volume' | 'declick'>;
  staleCommitRule: 'reject-stale-generation';
  callbackSlotRule: 'late-current-generation-retain-for-future-only';
  evictionRule: 'stale-then-farthest-from-boundary';
  rendererControl: 'inspect-only';
  reasons: string[];
};
export type UzumeCompiledReferencePlan = {
  schemaVersion: 1;
  telemetrySchemaVersion: 2;
  formatPath: UzumeFormatPath;
  sourceContainer: 'pcm' | 'dsd' | 'unknown';
  outputContainer: 'pcm' | 'dop' | 'dsd_native';
  internalDomain:
    | 'pcm-bypass'
    | 'multibit-pcm'
    | 'dsd-direct'
    | 'sdm-modulator-input'
    | 'unknown';
  bitPerfectState: 'available' | 'disabled' | 'unavailable';
  directDisabledReason: string | null;
  backendSupport: UzumeReferenceBackendSupportInspectReport;
  outputDevicePolicy: UzumeReferenceOutputDevicePolicyInspectReport;
  latencyBudget: UzumeReferenceLatencyBudgetInspectReport;
  readinessContract: UzumeReferenceReadinessContractInspectReport;
  generationCacheKey: UzumeReferenceGenerationCacheKeyInspectReport;
  orderedProfileSections: UzumeReferenceSectionId[];
  engineAssignments: UzumeReferenceAssignment[];
  mergeGroups: UzumeReferenceMergeGroup[];
  splitReasons: Record<string, string>;
  latencyOwners: Record<string, string>;
  formatPathPlan: UzumeFormatPathPlan;
  resampling: UzumeReferenceResamplingReport;
  sharedConvolution: UzumeReferenceSharedConvolutionReport;
  continuity: UzumeReferenceContinuityInspectReport;
  callbackSafeControls: UzumeReferenceCallbackSafeControlsInspectReport;
  equalPowerCrossfade: UzumeReferenceEqualPowerCrossfadeInspectReport;
  dsdFamily: UzumeReferenceDsdFamilyReport | null;
  pcmOutputQuantization: UzumeReferencePcmOutputQuantizationReport;
  pcmIngressGuard: UzumeReferencePcmIngressGuardReport;
  gainStaging: UzumeReferenceGainStagingReport;
  iirEq: UzumeReferenceIirEqInspectReport;
  channelScope: UzumeReferenceChannelScopeInspectReport;
  stereoProcedural: UzumeReferenceStereoProceduralInspectReport;
  perEarEqPlacement: UzumeReferencePerEarEqPlacementInspectReport;
  gaplessConcat: UzumeReferenceGaplessConcatInspectReport;
  firGaplessHistory: UzumeReferenceFirGaplessHistoryInspectReport;
  blockBoundary: UzumeReferenceBlockBoundaryInspectReport;
  flushDrain: UzumeReferenceFlushDrainInspectReport;
  artifactPlan: UzumeReferenceArtifactPlan;
};

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
  echoSrcMode?: AudioEchoSrcMode;
  echoSrcQualityProfile?: AudioEchoSrcQualityProfile;
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
  echoSrcMode?: AudioEchoSrcMode;
  echoSrcQualityProfile?: AudioEchoSrcQualityProfile;
  echoSrcTargetSampleRate?: number | null;
  echoSrcActive?: boolean;
  bitPerfectCandidate: boolean;
  sampleRateMismatch: boolean;
  latencyProfile?: AudioLatencyProfile;
  eqEnabled: boolean;
  roomCorrectionEnabled?: boolean;
  channelBalanceEnabled: boolean;
  dspActive: boolean;
  dspClippingRisk?: boolean;
  dspLimiterProtecting?: boolean;
  uzumeActive?: boolean;
  uzumeBackend?: string | null;
  uzumeProfile?: string | null;
  uzumeRuntimeModel?: string | null;
  uzumeFallbackActive?: boolean;
  uzumeGpuCompiled?: boolean;
  uzumeGpuAvailable?: boolean;
  uzumeGpuCufftAvailable?: boolean;
  uzumeGpuLimiterPlaybackActive?: boolean;
  uzumeGpuMatrixPlaybackActive?: boolean;
  uzumeGpuFftConvolutionPrepared?: boolean;
  uzumeGpuDevice?: string | null;
  uzumeFallbackReason?: string | null;
  uzumeCufftFallbackReason?: string | null;
  uzumeCudaRuntimeVersion?: number | null;
  uzumeCufftVersion?: number | null;
  uzumeFormatPath?: string | null;
  uzumeBitPerfectState?: string | null;
  uzumeDirectDisabledReason?: string | null;
  uzumeFormatPathPlan?: UzumeFormatPathPlan | null;
  uzumeReferencePlan?: UzumeCompiledReferencePlan | null;
  uzumeHeadroomActive?: boolean;
  uzumeTransitionalConvolutionPath?: string | null;
  uzumeFusedMacroKernel?: boolean;
  uzumeBypassReason?: string | null;
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
  | 'echoSrcMode'
  | 'echoSrcQualityProfile'
  | 'echoSrcTargetSampleRate'
  | 'echoSrcActive'
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
