import {
  channelBalanceBandIds,
  uzumeFormatPaths,
  type ActiveDsdOutputMode,
  type AudioDsdOutputMode,
  type AudioOutputMode,
  type AudioResamplerEngine,
  type ChannelBalanceState,
  type UzumeCompiledReferencePlan,
  type UzumeFormatPath,
  type UzumeFormatPathPlan,
  type UzumeReferenceAssignment,
  type UzumeReferenceEngineId,
  type UzumeReferenceMergeGroup,
  type UzumeReferenceConvolutionPartitionPlan,
  type UzumeReferenceConvolutionSource,
  type UzumeReferenceConvolutionSourceKind,
  type UzumeReferenceChannelScopeInspectReport,
  type UzumeReferenceIirEqInspectReport,
  type UzumeReferenceResamplingArtifactMetrics,
  type UzumeReferenceResamplingFilterContract,
  type UzumeReferenceResamplingReport,
  type UzumeReferenceSampleRateFamily,
  type UzumeReferenceSectionId,
  type UzumeReferenceSharedConvolutionDuplicatePlanGuardReport,
  type UzumeReferenceSharedConvolutionReport,
  type UzumeReferenceSharedConvolutionSerialNullReport,
  type UzumeReferenceStereoProceduralInspectReport,
} from '../../shared/types/audio';
import type { EqBand, EqState, RoomCorrectionState } from '../../shared/types/eq';
import type { AudioProbeResult, SampleRatePlan } from './audioTypes';

type UzumeSourceContainer = UzumeCompiledReferencePlan['sourceContainer'];
type UzumeOutputContainer = UzumeCompiledReferencePlan['outputContainer'];
type UzumeInternalDomain = UzumeCompiledReferencePlan['internalDomain'];

export type UzumeReferenceCompileInput = {
  probe: Pick<AudioProbeResult, 'filePath' | 'codec' | 'fileSampleRate' | 'channels' | 'bitDepth'> | null;
  sampleRatePlan: SampleRatePlan | null;
  outputMode: AudioOutputMode | null;
  activeDsdOutputMode: ActiveDsdOutputMode;
  requestedDsdOutputMode: AudioDsdOutputMode;
  eqState: Pick<EqState, 'enabled' | 'preampDb' | 'dspHeadroomDb' | 'dspSafetyLimiterEnabled' | 'bands'>;
  channelBalanceState: ChannelBalanceState;
  roomCorrectionState: Pick<RoomCorrectionState, 'enabled' | 'status' | 'irId' | 'sampleRate' | 'tapCount' | 'latencySamples'>;
  dspActive: boolean;
  dspModuleActive: boolean;
  replayGainActive: boolean;
  replayGainDb?: number | null;
  chainedPlaybackActive: boolean;
  gaplessActive: boolean;
  echoSrcActive: boolean;
  bitPerfectDisabledReason: string | null;
  currentResamplerEngine?: AudioResamplerEngine | null;
  nativeFormatPath?: string | null;
  nativeOutputFormat?: string | null;
  nativeBitPerfectState?: string | null;
  nativeDirectDisabledReason?: string | null;
};

export type UzumeReferencePcmInput = {
  sampleRate: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  headroomDb?: number;
  materializedGainDb?: number;
  eqBands?: ReadonlyArray<EqBand>;
  channelBalance?: Partial<ChannelBalanceState> | null;
  stereoProcedural?: UzumeReferenceStereoProceduralProfile | null;
  convolutionResponses?: ReadonlyArray<ReadonlyArray<number>>;
  safetyLimiterEnabled?: boolean;
};

export type UzumeReferenceStageMeter = {
  peak: number;
  rms: number;
};

export type UzumeReferenceSafetyStageId =
  | 'input'
  | 'after-headroom'
  | 'after-eq-iir'
  | 'after-stereo-procedural-crossfeed'
  | 'after-convolution'
  | 'pre-limiter'
  | 'post-limiter';

export type UzumeReferenceSafetyStage = UzumeReferenceStageMeter & {
  id: UzumeReferenceSafetyStageId;
  peakDbfs: number;
  rmsDbfs: number;
  truePeak: number;
  truePeakDbtp: number;
  sampleClipCount: number;
  truePeakOverCount: number;
  peakExpansionDb: number;
};

export type UzumeReferenceHeadroomRecommendation = {
  currentDb: number;
  recommendedDb: number;
  missingDb: number;
  reason: 'profile_preflight_gain' | 'post_dsp_true_peak' | 'limiter_reduction' | 'sufficient';
  sourceStage: UzumeReferenceSafetyStageId | null;
  confidence: 'measured' | 'estimated';
  targetSafetyMarginDb: number;
  autoHeadroomEnabled: false;
};

export type UzumeReferenceSafetyMeterReport = {
  state: 'safe' | 'near-limit' | 'over' | 'limiting';
  stages: UzumeReferenceSafetyStage[];
  maxSamplePeakDbfs: number;
  maxTruePeakDbtp: number;
  sampleClipCount: number;
  truePeakOverCount: number;
  stageOfMaxPeak: UzumeReferenceSafetyStageId | null;
  stageOfMaxTruePeak: UzumeReferenceSafetyStageId | null;
  historyWindowSeconds: 0;
};

export type UzumeReferenceLimiterReport = {
  enabled: boolean;
  active: boolean;
  triggerCount: number;
  currentGainReductionDb: number;
  maxGainReductionDb: number;
  limitedSamples: number;
  limitedFrames: number;
  mode: 'sample-domain-safety-limiter';
  truePeakLookahead: false;
};

export type UzumeReferencePcmTelemetry = {
  input: UzumeReferenceStageMeter;
  afterHeadroom: UzumeReferenceStageMeter;
  afterEq: UzumeReferenceStageMeter;
  afterStereoProcedural: UzumeReferenceStageMeter;
  afterConvolution: UzumeReferenceStageMeter;
  postLimiter: UzumeReferenceStageMeter;
  limitedSamples: number;
  maxGainReductionDb: number;
  safetyMeter: UzumeReferenceSafetyMeterReport;
  headroom: UzumeReferenceHeadroomRecommendation;
  limiter: UzumeReferenceLimiterReport;
};

export type UzumeReferencePcmResult = {
  channels: number[][];
  telemetry: UzumeReferencePcmTelemetry;
};

export type UzumeReferenceIirEqCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export type UzumeReferenceIirEqBandReport = {
  index: number;
  filterType: EqBand['filterType'] | 'peaking';
  requestedFrequencyHz: number;
  frequencyHz: number;
  q: number;
  gainDb: number;
  state: 'active' | 'disabled' | 'neutral-bypass';
  coefficients: UzumeReferenceIirEqCoefficients | null;
  response: {
    frequenciesHz: number[];
    magnitudeDb: number[];
    phaseRadians: number[];
  };
  reasons: string[];
};

export type UzumeReferenceIirEqInput = {
  sampleRate: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  bands: ReadonlyArray<EqBand>;
  responseFrequenciesHz?: ReadonlyArray<number>;
};

export type UzumeReferenceIirEqResult = {
  artifact: 'iir-eq-reference';
  engine: 'iir-reference';
  orderContract: 'ui-band-order-biquad-cascade';
  sampleRate: number;
  output: number[][];
  input: UzumeReferenceStageMeter;
  outputMeter: UzumeReferenceStageMeter;
  bandReports: UzumeReferenceIirEqBandReport[];
  activeBandCount: number;
  residualVsBypass: {
    state: 'processed' | 'exact-bypass';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  reasons: string[];
};

export type UzumeReferenceGainStageId =
  | 'input'
  | 'headroom'
  | 'replaygain'
  | 'materialized-gain'
  | 'output';

export type UzumeReferenceGainStagingInput = {
  channels: ReadonlyArray<ReadonlyArray<number>>;
  headroomDb?: number;
  replayGainDb?: number | null;
  materializedGainDb?: number;
};

export type UzumeReferenceGainStagingStage = UzumeReferenceStageMeter & {
  id: UzumeReferenceGainStageId;
  gainDb: number;
  cumulativeGainDb: number;
  peakDbfs: number;
  rmsDbfs: number;
  clippingRisk: boolean;
};

export type UzumeReferenceGainStagingResult = {
  artifact: 'gain-staging-reference';
  engine: 'gain-reference';
  orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'];
  output: number[][];
  stages: UzumeReferenceGainStagingStage[];
  totalGainDb: number;
  totalGainLinear: number;
  recommendedAdditionalHeadroomDb: number;
  clipRisk: boolean;
  reasons: string[];
};

export type UzumeReferencePcmIngressGuardInput = {
  channels: ReadonlyArray<ReadonlyArray<number>>;
  expectedChannels?: number | null;
  denormalThreshold?: number;
};

export type UzumeReferencePcmIngressGuardResult = {
  artifact: 'pcm-ingress-guard-reference';
  state: 'ok' | 'silence' | 'sanitized' | 'channel-mismatch';
  expectedChannels: number | null;
  channelCount: number;
  frameCount: number;
  rectangular: boolean;
  sanitizedChannels: number[][];
  counts: {
    nonFiniteReplaced: number;
    denormalZeroed: number;
    channelMismatchCount: number;
    silenceFrames: number;
  };
  peak: number;
  reasons: string[];
};

export type UzumeReferenceMatrix2x2 = readonly [
  readonly [number, number],
  readonly [number, number],
];

export type UzumeReferenceCrossfeedProfile = {
  enabled: boolean;
  amount?: number;
  crossGainDb?: number;
  crossDelayMs?: number;
  lowPassHz?: number;
  directGainDb?: number;
  outputTrimDb?: number;
  centerPreservation?: 'normalize' | 'none';
};

export type UzumeReferenceStereoProceduralProfile = {
  trimDb?: {
    left?: number;
    right?: number;
  };
  delayMs?: {
    left?: number;
    right?: number;
  };
  invert?: {
    left?: boolean;
    right?: boolean;
  };
  swapLeftRight?: boolean;
  monoMode?: 'off' | 'sum' | 'left' | 'right';
  mute?: {
    left?: boolean;
    right?: boolean;
  };
  solo?: 'left' | 'right' | 'none';
  matrix?: UzumeReferenceMatrix2x2;
  crossfeed?: UzumeReferenceCrossfeedProfile;
};

export type UzumeReferenceStereoMatrixTelemetry = {
  input: UzumeReferenceStageMeter;
  output: UzumeReferenceStageMeter;
  matrix: UzumeReferenceMatrix2x2;
  crossfeedEnabled: boolean;
  crossDelaySamples: number;
  lowPassHz: number | null;
  centerPreservation: 'normalize' | 'none';
  delaySamples: {
    left: number;
    right: number;
  };
  invert: {
    left: boolean;
    right: boolean;
  };
  swapLeftRight: boolean;
  monoMode: 'off' | 'sum' | 'left' | 'right';
  steps: string[];
};

export type UzumeReferenceStereoMatrixFilterInput = {
  sampleRate: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  profile: UzumeReferenceStereoProceduralProfile;
};

export type UzumeReferenceStereoMatrixFilterResult = {
  channels: number[][];
  telemetry: UzumeReferenceStereoMatrixTelemetry;
};

export type UzumeReferenceChannelScope =
  | { mode: 'all' }
  | { mode: 'channels'; channels: ReadonlyArray<number> }
  | { mode: 'stereo-pair'; pairStart?: number };

export type UzumeReferenceChannelScopeOperation = {
  id: string;
  kind: 'gain' | 'mute' | 'invert' | 'mix-from';
  scope: UzumeReferenceChannelScope;
  gainDb?: number;
  sourceChannel?: number;
  mixGainDb?: number;
};

export type UzumeReferenceChannelScopeOperationReport = {
  id: string;
  kind: UzumeReferenceChannelScopeOperation['kind'];
  scope: UzumeReferenceChannelScope;
  targetChannels: number[];
  skippedChannels: number[];
  state: 'applied' | 'no-targets' | 'invalid-source' | 'noop';
  gainDb: number | null;
  sourceChannel: number | null;
  reasons: string[];
};

export type UzumeReferenceChannelScopeResidual = {
  channelIndex: number;
  state: 'processed' | 'targeted-noop' | 'out-of-scope-bypass';
  maxAbs: number;
  rms: number;
};

export type UzumeReferenceChannelScopeInput = {
  channels: ReadonlyArray<ReadonlyArray<number>>;
  operations: ReadonlyArray<UzumeReferenceChannelScopeOperation>;
};

export type UzumeReferenceChannelScopeResult = {
  artifact: 'channel-scope-reference';
  engine: 'stereo-procedural-reference';
  scopeContract: 'targeted-channels-only';
  output: number[][];
  operationReports: UzumeReferenceChannelScopeOperationReport[];
  residualByChannel: UzumeReferenceChannelScopeResidual[];
  untouchedChannelIndexes: number[];
  reasons: string[];
};

export type UzumeReferenceBlockBoundaryInput = {
  channels: ReadonlyArray<ReadonlyArray<number>>;
  blockFrames: number;
  padFinalBlock?: boolean;
};

export type UzumeReferenceBlockBoundaryBlock = {
  blockIndex: number;
  startFrame: number;
  endFrame: number;
  validFrames: number;
  committedFrames: number;
  paddedFrames: number;
  state: 'full' | 'partial-padded' | 'partial-unpadded';
};

export type UzumeReferenceBlockBoundaryReport = {
  beforeBlockIndex: number;
  afterBlockIndex: number;
  boundaryFrame: number;
  sourceJumpMaxAbs: number;
  reassembledJumpMaxAbs: number;
  introducedDiscontinuityMaxAbs: number;
};

export type UzumeReferenceBlockBoundaryResult = {
  artifact: 'block-boundary-split-reference';
  policy: 'valid-frames-committed-padding-never-output';
  blockFrames: number;
  inputFrames: number;
  channelCount: number;
  blocks: UzumeReferenceBlockBoundaryBlock[];
  reassembled: number[][];
  coverage: {
    state: 'exact' | 'broken';
    coveredFrames: number;
    missingFrames: number;
    duplicateFrames: number;
    committedFrames: number;
    paddedFrames: number;
  };
  residualVsInput: {
    state: 'exact-reassembly' | 'mismatch';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
  boundaries: UzumeReferenceBlockBoundaryReport[];
  reasons: string[];
};

export type UzumeReferenceFlushDrainIntent =
  | 'natural-eof'
  | 'manual-flush'
  | 'seek'
  | 'profile-change';

export type UzumeReferenceFlushDrainInput = {
  channels: ReadonlyArray<ReadonlyArray<number>>;
  responses: ReadonlyArray<ReadonlyArray<number>>;
  intent: UzumeReferenceFlushDrainIntent;
  generationId?: number;
  candidateGenerationId?: number;
};

export type UzumeReferenceFlushDrainResult = {
  artifact: 'flush-drain-reference';
  engine: 'direct-fir-float64-reference';
  intent: UzumeReferenceFlushDrainIntent;
  generationId: number;
  candidateGenerationId: number;
  generationAfter: number;
  generationState: 'current' | 'stale-candidate';
  state: 'drain-committed' | 'tail-dropped-and-reset' | 'stale-candidate-rejected';
  sourceFrames: number;
  tailFrames: number;
  drainFrames: number;
  referenceOutput: number[][];
  committedOutput: number[][];
  pendingDrain: number[][];
  droppedDrain: number[][];
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

export type UzumeReferencePerEarEqProfile = {
  leftGainDb?: number;
  rightGainDb?: number;
};

export type UzumeReferencePerEarEqPlacementInput = {
  sampleRate: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  perEarEq: UzumeReferencePerEarEqProfile;
  crossfeed: UzumeReferenceCrossfeedProfile;
};

export type UzumeReferencePerEarEqPlacementResult = {
  artifact: 'per-ear-eq-placement-reference';
  orderContract: ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'];
  compilerRule: 'do-not-reorder-across-crossfeed-without-null-proof';
  preCrossfeed: UzumeReferenceStereoMatrixFilterResult;
  postCrossfeed: UzumeReferenceStereoMatrixFilterResult;
  placementResidual: {
    state: 'placement-sensitive' | 'commutative-for-input';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
};

export type UzumeReferenceResampleInput = {
  sourceRate: number;
  targetRate: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  tapCount?: number;
  phaseCount?: number;
  cutoffRatio?: number;
};

export type UzumeReferenceResampleTelemetry = {
  input: UzumeReferenceStageMeter;
  output: UzumeReferenceStageMeter;
  generatedFrames: number;
  sameRateBypass: boolean;
  ratio: number;
  phaseStep: number;
  phaseResidual: number;
  phaseAccumulator: UzumeReferenceResamplingReport['phaseAccumulator'];
  groupDelaySamples: number;
  groupDelayMs: number;
  lookaheadSamples: number;
  lookaheadMs: number;
  sourceFamily: UzumeReferenceSampleRateFamily | null;
  targetFamily: UzumeReferenceSampleRateFamily | null;
  filterContract: UzumeReferenceResamplingFilterContract;
};

export type UzumeReferenceResampleResult = {
  channels: number[][];
  telemetry: UzumeReferenceResampleTelemetry;
};

export type UzumeReferenceResamplingArtifacts = {
  stimulus: {
    impulse: number[];
    sweep: number[];
    logSweep: number[];
    nearNyquist: number[];
    multiTone: number[];
    random: number[];
    silence: number[];
  };
  response: {
    impulse: number[];
    sweep: number[];
    logSweep: number[];
    nearNyquist: number[];
    multiTone: number[];
    random: number[];
    silence: number[];
  };
  impulse: number[];
  sweep: number[];
  logSweep: number[];
  nearNyquist: number[];
  multiTone: number[];
  random: number[];
  silence: number[];
  ratio: number;
  groupDelaySamples: number;
  groupDelayMs: number;
  lookaheadSamples: number;
  lookaheadMs: number;
  filterContract: UzumeReferenceResamplingFilterContract;
  phaseAccumulator: UzumeReferenceResamplingReport['phaseAccumulator'];
  phaseGroupDelay: {
    peakIndex: number | null;
    spreadSamples: number | null;
  };
  aliasRejectionDb: number | null;
  passbandRippleDb: number | null;
  cutoffRatioEstimate: number | null;
  transitionWidthRatioEstimate: number | null;
  stopbandAttenuationDb: number | null;
  realtimeBudget: UzumeReferenceResamplingArtifactMetrics['realtimeBudget'];
  nullResidual: UzumeReferenceResamplingArtifactMetrics['nullResidual'];
  silenceResidual: UzumeReferenceResamplingArtifactMetrics['silenceResidual'];
  metrics: UzumeReferenceResamplingArtifactMetrics;
};

export type UzumeReferenceOutputResamplingRiskInput = {
  sampleRatePlan: Pick<SampleRatePlan, 'requestedOutputSampleRate' | 'actualDeviceSampleRate' | 'sharedDeviceSampleRate' | 'outputMode'> | null;
  active: boolean;
  currentResamplerEngine?: AudioResamplerEngine | null;
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

export type UzumeReferenceResponseResampleInput = {
  sourceId: string;
  kind: UzumeReferenceConvolutionSourceKind | 'target-response';
  sourceRate: number;
  targetRate: number;
  responses: ReadonlyArray<ReadonlyArray<number>>;
  tapCount?: number;
  phaseCount?: number;
  cutoffRatio?: number;
};

export type UzumeReferenceResponseResampleResult = {
  artifact: 'high-precision-response-resample-reference';
  sourceId: string;
  kind: UzumeReferenceConvolutionSourceKind | 'target-response';
  sourceRate: number;
  targetRate: number;
  sourceFamily: UzumeReferenceSampleRateFamily | null;
  targetFamily: UzumeReferenceSampleRateFamily | null;
  engine: 'windowed-sinc-float64-reference';
  sameRateBypass: boolean;
  linearInterpolationRejected: boolean;
  filterContract: UzumeReferenceResamplingFilterContract;
  channels: number[][];
  linearBaseline: number[][];
  residualVsLinear: {
    state: 'same-rate-bypass' | 'measured-difference' | 'linear-matches-for-input';
    comparedFrames: number;
    maxAbs: number;
    rms: number;
  };
};

export type UzumeReferenceGaplessSegmentInput = {
  id: string;
  channels: ReadonlyArray<ReadonlyArray<number>>;
};

export type UzumeReferenceGaplessBoundaryReport = {
  beforeSegmentId: string;
  afterSegmentId: string;
  sourceFrameOffset: number;
  outputFrameOffset: number;
  concatVsNoResetMaxAbs: number;
  resetVsConcatMaxAbs: number;
  resetVsConcatRms: number;
  outputJump: number;
};

export type UzumeReferenceGaplessConcatInput = {
  sourceRate: number;
  targetRate: number;
  segments: ReadonlyArray<UzumeReferenceGaplessSegmentInput>;
  tapCount?: number;
  phaseCount?: number;
  cutoffRatio?: number;
};

export type UzumeReferenceGaplessConcatResult = {
  policy: 'source-pcm-concat-before-src';
  sourceRate: number;
  targetRate: number;
  ratio: number;
  concat: UzumeReferenceResampleResult;
  noResetSegments: number[][][];
  resetSegments: number[][][];
  boundaries: UzumeReferenceGaplessBoundaryReport[];
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
};

export type UzumeReferenceFirGaplessHistoryInput = {
  sourceId?: string;
  sampleRate: number;
  segments: ReadonlyArray<UzumeReferenceGaplessSegmentInput>;
  responses: ReadonlyArray<ReadonlyArray<number>>;
};

export type UzumeReferenceFirGaplessBoundaryReport = {
  beforeSegmentId: string;
  afterSegmentId: string;
  sourceFrameOffset: number;
  outputFrameOffset: number;
  overlapHistoryFrames: number;
  concatVsNoResetMaxAbs: number;
  resetVsConcatMaxAbs: number;
  resetVsConcatRms: number;
  outputJump: number;
};

export type UzumeReferenceFirGaplessHistoryResult = {
  artifact: 'fir-gapless-history-reference';
  policy: 'source-pcm-concat-before-fir';
  engine: 'direct-fir-float64-reference';
  sourceId: string;
  sampleRate: number;
  tailFrames: number;
  drainFrames: number;
  responseChannels: number[][];
  concat: number[][];
  noResetSegments: number[][][];
  resetSegments: number[][][];
  boundaries: UzumeReferenceFirGaplessBoundaryReport[];
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
};

export type UzumeReferenceContinuityIntent =
  | 'cold-start'
  | 'normal-playlist-boundary'
  | 'gapless-boundary'
  | 'cache-miss'
  | 'underrun-protection'
  | 'user-random-seek-or-skip';

export type UzumeReferenceContinuityPolicy =
  | 'quality-first'
  | 'gpu-wait'
  | 'predictive-cache'
  | 'random-access-short-bridge';

export type UzumeReferenceContinuityDecision =
  | 'gpu-full-profile'
  | 'cpu-full-profile'
  | 'predictive-cache'
  | 'wait-for-full-profile'
  | 'random-access-short-bridge'
  | 'reject-stale-generation';

export type UzumeReferenceContinuityStrategyInput = {
  intent: UzumeReferenceContinuityIntent;
  policy: UzumeReferenceContinuityPolicy;
  generationId: number;
  candidateGenerationId?: number | null;
  fullProfileReady?: boolean;
  cpuFullProfileReady?: boolean;
  gpuFullProfileReady?: boolean;
  predictiveCacheHit?: boolean;
  shortBridgeAvailable?: boolean;
  userAllowsShortBridge?: boolean;
  gpuPreferredForAcousticNoise?: boolean;
  playbackAlreadyStarted?: boolean;
};

export type UzumeReferenceContinuityStrategyResult = {
  artifact: 'continuity-quality-policy-reference';
  intent: UzumeReferenceContinuityIntent;
  policy: UzumeReferenceContinuityPolicy;
  generationState: 'current' | 'stale-candidate';
  selectedPath: UzumeReferenceContinuityDecision;
  callbackRule: 'read-committed-output-only';
  commitAllowed: boolean;
  shortBridgeAllowed: boolean;
  shortBridgeReason: string | null;
  mustKeepFullProfile: boolean;
  requiresEqualPowerCrossfade: boolean;
  qualityRollback: 'none' | 'short-bridge-temporary';
  waitTarget: 'none' | 'gpu-full-profile' | 'cpu-or-gpu-full-profile' | 'predictive-cache-or-full-profile';
  reasons: string[];
};

export type UzumeReferenceCallbackControlKind =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'mute'
  | 'volume'
  | 'declick'
  | 'flush'
  | 'seek'
  | 'reset'
  | 'profile-change'
  | 'device-change';

export type UzumeReferenceCallbackSafeControlInput = {
  generationId: number;
  candidateGenerationId?: number | null;
  control: UzumeReferenceCallbackControlKind;
  committedBlock: ReadonlyArray<ReadonlyArray<number>>;
  currentGain?: number | null;
  targetGain?: number | null;
  targetVolumeDb?: number | null;
  mute?: boolean;
  declickFrames?: number | null;
};

export type UzumeReferenceCallbackSafeControlResult = {
  artifact: 'callback-safe-urgent-controls-reference';
  policy: 'urgent-controls-after-committed-output';
  control: UzumeReferenceCallbackControlKind;
  classification: 'callback-safe-urgent-control' | 'render-state-boundary';
  generationId: number;
  candidateGenerationId: number;
  generationState: 'current' | 'stale-candidate';
  state: 'applied' | 'render-cache-invalidated' | 'stale-candidate-rejected';
  callbackRule: 'read-committed-output-then-apply-urgent-control' | 'read-committed-output-only';
  renderCacheAction: 'preserve' | 'invalidate-generation' | 'reject-stale-generation';
  generationAfterControl: number;
  requiresRenderGraphRebuild: boolean;
  commitAllowed: boolean;
  output: number[][];
  gainEnvelope: Array<{
    frame: number;
    gain: number;
  }>;
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

export type UzumeReferenceDsdFamilyFormatPath =
  | 'dsd_direct'
  | 'dsd_upsampling'
  | 'd2p_processed'
  | 'sdm_processed';

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

export type UzumeReferenceDsdFamilyPathInput = {
  formatPath: UzumeReferenceDsdFamilyFormatPath;
  outputContainer: UzumeOutputContainer;
  requestedControls?: ReadonlyArray<UzumeReferenceDsdControlId>;
  sourceDsdRate?: number | null;
  targetDsdRate?: number | null;
  internalPcmRate?: number | null;
  decimationProfile?: string | null;
  modulatorProfile?: string | null;
  headroomDb?: number | null;
  overloadMarginDb?: number | null;
  ultrasonicNoiseRisk?: 'normal' | 'elevated' | 'unsafe' | null;
  sdmReferenceAvailable?: boolean;
  d2pReferenceAvailable?: boolean;
};

export type UzumeReferenceDsdFamilyPathResult = {
  artifact: 'dsd-family-path-control-reference';
  formatPath: UzumeReferenceDsdFamilyFormatPath;
  sourceContainer: 'dsd';
  outputContainer: UzumeOutputContainer;
  internalDomain: Extract<UzumeInternalDomain, 'dsd-direct' | 'multibit-pcm' | 'sdm-modulator-input'>;
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

export type UzumeReferencePcmOutputQuantizationInput = {
  formatPath: UzumeFormatPath;
  outputSampleFormat: UzumeReferencePcmOutputSampleFormat;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  ditherMode?: UzumeReferencePcmDitherMode;
  seed?: number;
};

export type UzumeReferencePcmOutputQuantizationResult = {
  artifact: 'pcm-output-quantization-dither-reference';
  formatPath: UzumeFormatPath;
  outputSampleFormat: UzumeReferencePcmOutputSampleFormat;
  state: 'bypass' | 'quantized' | 'rejected';
  bitPerfectState: 'preserved' | 'disabled' | 'not-applicable';
  pcmDitherAllowed: boolean;
  sdmNoiseShapingTelemetry: boolean;
  output: number[][];
  quantizedIntegers: number[][];
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

export type UzumeReferenceBitPerfectBypassInput = {
  formatPath: UzumeFormatPath;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  requestedSections?: ReadonlyArray<UzumeReferenceSectionId>;
  bitPerfectState?: string | null;
  directDisabledReason?: string | null;
};

export type UzumeReferenceBitPerfectBypassResult = {
  artifact: 'pcm-bitperfect-bypass-reference';
  formatPath: UzumeFormatPath;
  engine: 'identity-bypass' | 'format-path-planner-reference';
  state: 'preserved' | 'rejected' | 'not-applicable';
  bitPerfectState: 'preserved' | 'disabled' | 'not-applicable';
  output: number[][];
  readOnlySections: UzumeReferenceSectionId[];
  disabledSections: UzumeReferenceSectionId[];
  activeSampleChangingSections: UzumeReferenceSectionId[];
  sampleChangingDspEntered: boolean;
  directDisabledReason: string | null;
  residual: {
    state: 'identity-null' | 'not-measured';
    comparedFrames: number;
    comparedSamples: number;
    maxAbs: number | null;
    rms: number | null;
  };
  reasons: string[];
};

export type UzumeReferencePreRollDeadlineInput = {
  currentTrackId: string;
  nextTrackId: string;
  sampleRate: number;
  currentRemainingFrames: number;
  callbackBlockFrames: number;
  outputRingDepthFrames: number;
  lookaheadFrames: number;
  groupDelayFrames: number;
  firTailFrames?: number;
  decodePrepareFrames?: number;
  renderAheadTargetFrames?: number;
  renderAheadReadyFrames?: number;
  predictiveCacheHit?: boolean;
  nextProfileReady?: boolean;
  generationId: number;
  candidateGenerationId?: number | null;
  currentSampleRate?: number | null;
  nextSampleRate?: number | null;
  currentChannelCount?: number | null;
  nextChannelCount?: number | null;
};

export type UzumeReferencePreRollDeadlineResult = {
  artifact: 'pre-roll-deadline-reference';
  policy: 'next-track-full-profile-before-boundary';
  currentTrackId: string;
  nextTrackId: string;
  sampleRate: number;
  generationState: 'current' | 'stale-candidate';
  state: 'ready' | 'deadline-safe' | 'start-pre-roll-now' | 'deadline-missed' | 'stale-candidate';
  preRollRequiredFrames: number;
  framesUntilBoundary: number;
  deadlineSlackFrames: number;
  preRollCanCompleteBeforeBoundary: boolean;
  renderAhead: {
    targetFrames: number;
    readyFrames: number;
    state: 'full-profile-ready' | 'cache-hit' | 'cache-warming' | 'cache-miss';
  };
  callbackRing: {
    callbackBlockFrames: number;
    outputRingDepthFrames: number;
    readRule: 'read-committed-output-only';
    mustNotWaitForGpu: true;
    committedBeforeBoundary: boolean;
  };
  handoff: {
    currentSampleRate: number | null;
    nextSampleRate: number | null;
    currentChannelCount: number | null;
    nextChannelCount: number | null;
    requiresDualPipeline: boolean;
    strategy: 'same-pipeline-no-reset' | 'dual-pipeline-handoff';
    declickOnly: boolean;
  };
  commitAllowed: boolean;
  shortBridgeAllowed: false;
  shortBridgeReason: 'not_user_random_seek_or_skip';
  reasons: string[];
};

export type UzumeReferenceCpuCallbackRingInput = {
  generationId: number;
  candidateGenerationId?: number | null;
  ringCapacityFrames: number;
  callbackBlockFrames: number;
  initialCommittedFrames: number;
  cpuProducedFrames: number;
  renderAheadTargetFrames?: number | null;
  cpuRealtimeFactor?: number | null;
};

export type UzumeReferenceCpuCallbackRingResult = {
  artifact: 'cpu-callback-ring-reference';
  policy: 'cpu-full-profile-committed-ring';
  generationId: number;
  candidateGenerationId: number;
  generationState: 'current' | 'stale-candidate';
  state: 'stable' | 'low-depth' | 'underrun-risk' | 'underrun';
  callbackRule: 'read-committed-output-only';
  callbackMustNotWaitForGpu: true;
  shortBridgeAllowed: false;
  shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge';
  commitAllowed: boolean;
  ring: {
    capacityFrames: number;
    beforeWriteFrames: number;
    cpuProducedFrames: number;
    committedWriteFrames: number;
    droppedFrames: number;
    beforeReadFrames: number;
    callbackReadFrames: number;
    afterReadFrames: number;
    missingFrames: number;
    renderAheadTargetFrames: number;
  };
  underrunTelemetry: {
    status: 'safe' | 'marginal' | 'unsafe';
    underrunRisk: boolean;
    cpuRealtimeFactor: number | null;
    ringDepthFrames: number;
    ringDepthBlocks: number;
  };
  reasons: string[];
};

export type UzumeReferenceRenderAheadCacheEntryKind =
  | 'current-tail'
  | 'next-head'
  | 'gapless-album-segment'
  | 'crossfade-candidate';

export type UzumeReferenceRenderAheadCacheEntryInput = {
  key: string;
  trackId: string;
  generationId: number;
  startFrame: number;
  frameCount: number;
  bytes: number;
  completedAtFrame?: number | null;
  distanceToBoundaryFrames?: number | null;
  kind: UzumeReferenceRenderAheadCacheEntryKind;
};

export type UzumeReferenceRenderAheadCacheInput = {
  generationId: number;
  requestKey: string;
  requiredStartFrame: number;
  requiredFrames: number;
  targetCallbackFrame: number;
  callbackBlockFrames: number;
  cacheBudgetBytes: number;
  entries: ReadonlyArray<UzumeReferenceRenderAheadCacheEntryInput>;
};

export type UzumeReferenceRenderAheadCacheResult = {
  artifact: 'render-ahead-cache-reference';
  policy: 'generation-safe-render-ahead-cache';
  generationId: number;
  requestKey: string;
  lookupState: 'hit' | 'miss' | 'late-hit' | 'incomplete-hit' | 'stale-hit-rejected';
  commitState:
    | 'commit-to-callback-slot'
    | 'callback-keeps-prior-committed-output'
    | 'retain-for-future-cache'
    | 'reject-stale-generation';
  commitAllowed: boolean;
  callbackRule: 'read-committed-output-only';
  callbackMustNotWaitForGpu: true;
  requestedEntry: {
    key: string;
    generationId: number;
    coversRequest: boolean;
    completedAtFrame: number | null;
    deadlineSlackFrames: number | null;
  } | null;
  cacheStats: {
    budgetBytes: number;
    bytesBeforeEvict: number;
    bytesAfterEvict: number;
    entryCountBeforeEvict: number;
    entryCountAfterEvict: number;
  };
  evictions: Array<{
    key: string;
    reason: 'stale-generation' | 'over-budget-farthest-from-boundary';
  }>;
  retainedKeys: string[];
  reasons: string[];
};

export type UzumeReferenceFallbackCandidateKind =
  | 'gpu-render-ahead'
  | 'cpu-main-chain'
  | 'prior-committed';

export type UzumeReferenceFallbackCandidateInput = {
  kind: UzumeReferenceFallbackCandidateKind;
  generationId: number;
  channels: ReadonlyArray<ReadonlyArray<number>>;
  completedAtFrame?: number | null;
};

export type UzumeReferenceFallbackInjectionInput = {
  generationId: number;
  targetCallbackFrame: number;
  callbackBlockFrames: number;
  expectedChannels: number;
  callbackRingDepthFrames?: number | null;
  renderAheadDepthFrames?: number | null;
  renderAheadTargetFrames?: number | null;
  rollingRealtimeFactor?: number | null;
  gpuCandidate?: UzumeReferenceFallbackCandidateInput | null;
  cpuCandidate?: UzumeReferenceFallbackCandidateInput | null;
  priorCommittedCandidate?: UzumeReferenceFallbackCandidateInput | null;
  allowSilenceFallback?: boolean;
};

export type UzumeReferenceFallbackInjectionResult = {
  artifact: 'fallback-injection-underrun-reference';
  policy: 'callback-never-waits-for-gpu';
  generationId: number;
  targetCallbackFrame: number;
  callbackBlockFrames: number;
  expectedChannels: number;
  state:
    | 'gpu-render-ahead-commit'
    | 'cpu-main-chain-fallback'
    | 'prior-committed-fallback'
    | 'silence-injected'
    | 'stale-candidate-rejected';
  selectedSource: UzumeReferenceFallbackCandidateKind | 'silence' | null;
  output: number[][];
  callbackMustNotWaitForGpu: true;
  shortBridgeAllowed: false;
  shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge';
  commitAllowed: boolean;
  fallbackInjected: boolean;
  qualityRollback: 'none' | 'controlled-fallback' | 'silence-underrun';
  gpuCandidate: {
    present: boolean;
    generationState: 'current' | 'stale-candidate' | 'missing';
    deadlineState: 'ready-before-callback' | 'late-for-callback' | 'incomplete' | 'missing';
    deadlineMissFrames: number | null;
    retainedForFuture: boolean;
  };
  underrunTelemetry: {
    status: 'safe' | 'marginal' | 'unsafe';
    underrunRisk: boolean;
    injectedSilenceFrames: number;
    missingOutputFrames: number;
    callbackRingDepthFrames: number;
    renderAheadDepthFrames: number;
    renderAheadTargetFrames: number;
    rollingRealtimeFactor: number | null;
  };
  peak: {
    output: number;
  };
  rejectedCandidates: Array<{
    kind: UzumeReferenceFallbackCandidateKind;
    reason: 'stale-generation' | 'late-for-callback' | 'incomplete' | 'empty-or-shape-mismatch';
  }>;
  reasons: string[];
};

export type UzumeReferenceEqualPowerCrossfadeInput = {
  intent: UzumeReferenceContinuityIntent;
  sampleRate: number;
  fadeFrames: number;
  shortBridge: ReadonlyArray<ReadonlyArray<number>>;
  fullProfile: ReadonlyArray<ReadonlyArray<number>>;
  fullProfileReady: boolean;
};

export type UzumeReferenceEqualPowerCrossfadeResult = {
  artifact: 'equal-power-crossfade-reference';
  policy: 'random-access-short-bridge-to-full-profile-only';
  intent: UzumeReferenceContinuityIntent;
  sampleRate: number;
  fadeFrames: number;
  durationMs: number;
  state: 'crossfade-rendered' | 'rejected';
  rejectionReason:
    | null
    | 'intent_not_user_random_seek_or_skip'
    | 'full_profile_not_ready'
    | 'insufficient_overlap';
  shortBridgeGainStartsAt: 1;
  fullProfileGainEndsAt: 1;
  output: number[][];
  gains: Array<{
    frame: number;
    shortBridgeGain: number;
    fullProfileGain: number;
    powerSum: number;
  }>;
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
};

export type UzumeSharedConvolutionReferenceSourceInput = {
  id: string;
  kind: UzumeReferenceConvolutionSourceKind;
  sampleRate: number;
  channels: number;
  tapCount: number;
  latencySamples?: number;
  phasePolicy?: UzumeReferenceConvolutionSource['phasePolicy'];
  routing?: UzumeReferenceConvolutionSource['routing'];
  channelLayout?: UzumeReferenceConvolutionSource['channelLayout'];
};

export type UzumeSharedConvolutionReferenceInput = {
  targetRate: number | null;
  targetChannels?: number | null;
  callbackBlockFrames?: number | null;
  latencyClass?: UzumeReferenceConvolutionPartitionPlan['latencyClass'];
  sources: ReadonlyArray<UzumeSharedConvolutionReferenceSourceInput>;
};

export type UzumeSharedConvolutionSerialReferenceSourceInput = UzumeSharedConvolutionReferenceSourceInput & {
  responses: ReadonlyArray<ReadonlyArray<number>>;
};

export type UzumeSharedConvolutionSerialReferenceInput = Omit<UzumeSharedConvolutionReferenceInput, 'sources'> & {
  signal: ReadonlyArray<ReadonlyArray<number>>;
  sources: ReadonlyArray<UzumeSharedConvolutionSerialReferenceSourceInput>;
};

export type UzumeSharedConvolutionSerialReferenceResult = {
  artifact: 'shared-convolution-serial-null-reference';
  engine: 'shared-convolution-planner-reference';
  planner: UzumeReferenceSharedConvolutionReport;
  sourceOrder: string[];
  mergedResponses: number[][];
  mergedOutput: number[][];
  serialOutput: number[][];
  residual: {
    state: 'merged-matches-serial' | 'split-or-inactive' | 'residual-over-threshold';
    comparedFrames: number;
    maxAbs: number | null;
    rms: number | null;
  };
};

export type UzumeSharedConvolutionResponsePreflightInput = {
  sourceId: string;
  kind: UzumeReferenceConvolutionSourceKind;
  sampleRate: number;
  expectedChannels: number;
  responses: ReadonlyArray<ReadonlyArray<number>>;
  dcOffsetWarnThreshold?: number | null;
};

export type UzumeSharedConvolutionResponsePreflightResult = {
  artifact: 'shared-convolution-response-preflight-reference';
  engine: 'shared-convolution-planner-reference';
  sourceId: string;
  kind: UzumeReferenceConvolutionSourceKind;
  sampleRate: number | null;
  sampleRateFamily: UzumeReferenceSampleRateFamily | null;
  state: 'ok' | 'sanitized' | 'channel-mismatch' | 'empty-response';
  expectedChannels: number;
  inputChannels: number;
  effectiveChannels: number;
  tapCount: number;
  peak: number;
  peakOverUnity: boolean;
  dcOffsetByChannel: number[];
  maxAbsDcOffset: number;
  nonFiniteSamples: number;
  sanitizedSamples: number;
  sanitizedResponses: number[][];
  reasons: Array<
    | 'response_preflight_ok'
    | 'peak_measured'
    | 'peak_over_unity'
    | 'dc_offset_measured'
    | 'dc_offset_warning'
    | 'non_finite_response_samples_zeroed'
    | 'response_channel_mismatch'
    | 'empty_response'
  >;
};

export type UzumeSharedConvolutionDuplicateGuardSourceAssignment = {
  sourceId: string;
  state: 'shared-plan' | 'split-required';
  convolverPlanId: string | null;
  fftPlanId: string | null;
  splitReason: string | null;
};

export type UzumeSharedConvolutionDuplicateGuardResult = {
  artifact: 'shared-convolution-duplicate-plan-guard-reference';
  engine: 'shared-convolution-planner-reference';
  state: 'single-shared-plan' | 'split-required' | 'inactive';
  planner: UzumeReferenceSharedConvolutionReport;
  sourceAssignments: UzumeSharedConvolutionDuplicateGuardSourceAssignment[];
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

type FormatPlannerResult = Pick<
  UzumeCompiledReferencePlan,
  'formatPath' | 'sourceContainer' | 'outputContainer' | 'internalDomain' | 'bitPerfectState' | 'directDisabledReason' | 'formatPathPlan'
>;

const formatPathSet = new Set<string>(uzumeFormatPaths);
const dsdExtensions = new Set(['.dsf', '.dff', '.dsd']);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const dbToGain = (db: number): number => 10 ** (db / 20);

const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-12));

const normalizeRate = (value: number | null | undefined): number | null =>
  isFiniteNumber(value) && value > 0 ? Math.round(value) : null;

const samplesToMilliseconds = (samples: number, sampleRate: number | null): number | null =>
  sampleRate ? Math.round((samples / sampleRate) * 1000000) / 1000 : null;

const sinc = (value: number): number => {
  if (Math.abs(value) < 1e-12) {
    return 1;
  }

  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
};

const blackmanWindow = (index: number, length: number): number => {
  if (length <= 1) {
    return 1;
  }

  const phase = (2 * Math.PI * index) / (length - 1);
  return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
};

const buildResamplingFilterContract = (
  sourceRate: number | null,
  targetRate: number | null,
  options: Pick<UzumeReferenceResampleInput, 'tapCount' | 'phaseCount' | 'cutoffRatio'> = {},
): UzumeReferenceResamplingFilterContract => {
  const sameRate = Boolean(sourceRate && targetRate && sourceRate === targetRate);
  const tapCount = sameRate ? 0 : Math.max(8, Math.round(options.tapCount ?? 64));
  const phaseCount = sameRate ? 0 : Math.max(1, Math.round(options.phaseCount ?? 1024));

  return {
    tapCount,
    phaseCount,
    cutoffRatio: sameRate ? 1 : clamp(options.cutoffRatio ?? 0.92, 0.05, 0.98),
    transitionWidthRatio: sameRate ? 0 : 0.08,
    stopbandAttenuationDb: sameRate ? 0 : 96,
    passbandRippleDb: sameRate ? 0 : 0.01,
  };
};

const emptyResamplingArtifactMetrics = (): UzumeReferenceResamplingArtifactMetrics => ({
  impulsePeakIndex: null,
  impulsePeak: 0,
  impulseEnergy: 0,
  sweepPeak: 0,
  logSweepPeak: 0,
  nearNyquistPeak: 0,
  multiTonePeak: 0,
  randomPeak: 0,
  randomSeed: 0,
  silencePeak: 0,
  silenceResidual: {
    state: 'exact-silence',
    comparedFrames: 0,
    maxAbs: 0,
    rms: 0,
  },
  aliasRejectionDb: null,
  phaseGroupDelaySpreadSamples: null,
  passbandRippleDb: null,
  cutoffRatioEstimate: null,
  transitionWidthRatioEstimate: null,
  stopbandAttenuationDb: null,
  realtimeBudget: {
    backend: 'scalar-float64-reference',
    estimatedMultiplyAdds: 0,
    estimatedRealtimeFactor: null,
    safetyClass: 'same-rate-bypass',
  },
  nullResidual: {
    state: 'not-applicable',
    comparedFrames: 0,
    maxAbs: null,
    rms: null,
  },
});

const getExtension = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
};

export const resolveUzumeSourceContainer = (
  probe: Pick<AudioProbeResult, 'filePath' | 'codec'> | null,
): UzumeSourceContainer => {
  if (!probe) {
    return 'unknown';
  }

  const codec = probe.codec?.toLowerCase() ?? '';
  if (codec.includes('dsd') || codec.includes('dsf') || codec.includes('dff') || dsdExtensions.has(getExtension(probe.filePath))) {
    return 'dsd';
  }

  return 'pcm';
};

const resolveOutputContainer = (
  plan: SampleRatePlan | null,
  activeDsdOutputMode: ActiveDsdOutputMode,
): UzumeOutputContainer => {
  const mode = activeDsdOutputMode ?? plan?.dsdOutputMode ?? 'pcm';

  if (mode === 'native') {
    return 'dsd_native';
  }

  if (mode === 'dop') {
    return 'dop';
  }

  return 'pcm';
};

const normalizeFormatPathHint = (value: string | null | undefined): UzumeFormatPath | null =>
  typeof value === 'string' && formatPathSet.has(value) ? value as UzumeFormatPath : null;

const buildBitPerfectDisabledReason = (
  input: UzumeReferenceCompileInput,
  sourceContainer: UzumeSourceContainer,
  outputContainer: UzumeOutputContainer,
): string | null => {
  if (input.bitPerfectDisabledReason) {
    return input.bitPerfectDisabledReason;
  }

  if (input.nativeBitPerfectState === 'disabled' && input.nativeDirectDisabledReason) {
    return input.nativeDirectDisabledReason;
  }

  const plan = input.sampleRatePlan;
  if (!plan) {
    return sourceContainer === 'unknown' ? 'source_plan_unavailable' : null;
  }

  if (sourceContainer === 'dsd' && outputContainer === 'pcm') {
    return 'dsd_source_decoded_to_pcm';
  }

  if (plan.echoSrcActive) {
    return 'uzume_src_enabled';
  }

  if (plan.sampleRateMismatch) {
    return 'actual_device_sample_rate_mismatch';
  }

  if (plan.resampling) {
    return plan.outputMode === 'shared'
      ? 'shared_output_resampling_or_mixer_rate_difference'
      : 'decoder_or_output_resampling_active';
  }

  if (sourceContainer === 'pcm' && !plan.bitPerfectCandidate) {
    return plan.outputMode === 'shared' ? 'shared_output_mixer_path' : 'bitperfect_conditions_not_met';
  }

  return null;
};

const resolveCurrentFormatPath = (
  input: UzumeReferenceCompileInput,
  sourceContainer: UzumeSourceContainer,
  outputContainer: UzumeOutputContainer,
): UzumeFormatPath => {
  const hint = normalizeFormatPathHint(input.nativeFormatPath);
  if (hint) {
    return hint;
  }

  if (sourceContainer === 'dsd') {
    if (outputContainer !== 'pcm' && !input.dspActive && !input.replayGainActive && !input.chainedPlaybackActive) {
      return 'dsd_direct';
    }

    return outputContainer === 'pcm' ? 'd2p_processed' : 'dsd_upsampling';
  }

  if (input.dspActive || input.echoSrcActive) {
    return 'pcm_processed';
  }

  return 'pcm_bitperfect';
};

const getInternalDomain = (path: UzumeFormatPath): UzumeInternalDomain => {
  switch (path) {
    case 'pcm_bitperfect':
      return 'pcm-bypass';
    case 'pcm_processed':
    case 'd2p_processed':
      return 'multibit-pcm';
    case 'dsd_direct':
      return 'dsd-direct';
    case 'dsd_upsampling':
    case 'sdm_processed':
      return 'sdm-modulator-input';
    default:
      return 'unknown';
  }
};

const planEntry = (
  state: NonNullable<UzumeFormatPathPlan[UzumeFormatPath]>['state'],
  reason: string | null = null,
): NonNullable<UzumeFormatPathPlan[UzumeFormatPath]> => ({ state, reason });

const buildFormatPlanner = (input: UzumeReferenceCompileInput): FormatPlannerResult => {
  const sourceContainer = resolveUzumeSourceContainer(input.probe);
  const outputContainer = resolveOutputContainer(input.sampleRatePlan, input.activeDsdOutputMode);
  const formatPath = resolveCurrentFormatPath(input, sourceContainer, outputContainer);
  const directReason = buildBitPerfectDisabledReason(input, sourceContainer, outputContainer);
  const bitPerfectState =
    formatPath === 'dsd_direct' || (formatPath === 'pcm_bitperfect' && !directReason)
      ? 'available'
      : sourceContainer === 'unknown'
        ? 'unavailable'
        : 'disabled';
  const processingReason = input.nativeDirectDisabledReason ?? directReason ?? 'uzume_processing_enabled';
  const dsdDirectDisabledReason =
    directReason ?? (outputContainer === 'pcm' ? 'dsd_direct_requires_dsd_output' : 'dsd_direct_disabled_by_processing');

  const formatPathPlan: UzumeFormatPathPlan = {
    pcm_bitperfect:
      sourceContainer === 'pcm'
        ? planEntry(formatPath === 'pcm_bitperfect' ? 'current' : 'disabled', formatPath === 'pcm_bitperfect' ? directReason : processingReason)
        : planEntry('unavailable', sourceContainer === 'dsd' ? 'requires_pcm_source' : 'source_plan_unavailable'),
    pcm_processed:
      sourceContainer === 'pcm'
        ? planEntry(formatPath === 'pcm_processed' ? 'current' : 'available')
        : planEntry(sourceContainer === 'dsd' ? 'unavailable' : 'planned', sourceContainer === 'dsd' ? 'pcm_processed_requires_pcm_source' : 'source_plan_unavailable'),
    dsd_direct:
      sourceContainer === 'dsd'
        ? planEntry(formatPath === 'dsd_direct' ? 'current' : 'disabled', formatPath === 'dsd_direct' ? null : dsdDirectDisabledReason)
        : planEntry('unavailable', sourceContainer === 'pcm' ? 'requires_dsd_source' : 'source_plan_unavailable'),
    dsd_upsampling:
      sourceContainer === 'dsd'
        ? planEntry(formatPath === 'dsd_upsampling' ? 'current' : 'unavailable', formatPath === 'dsd_upsampling' ? null : 'sdm_reference_engine_not_ready')
        : planEntry('unavailable', sourceContainer === 'pcm' ? 'requires_dsd_source' : 'source_plan_unavailable'),
    d2p_processed:
      sourceContainer === 'dsd'
        ? planEntry(formatPath === 'd2p_processed' ? 'current' : 'available')
        : planEntry('unavailable', sourceContainer === 'pcm' ? 'd2p_requires_dsd_source' : 'source_plan_unavailable'),
    sdm_processed: planEntry('unavailable', 'sdm_reference_engine_not_ready'),
  };

  return {
    formatPath,
    sourceContainer,
    outputContainer,
    internalDomain: getInternalDomain(formatPath),
    bitPerfectState,
    directDisabledReason: formatPath === 'pcm_bitperfect' || formatPath === 'dsd_direct' ? directReason : processingReason,
    formatPathPlan,
  };
};

const buildOutputDevicePolicyInspectReport = (
  input: UzumeReferenceCompileInput,
  format: FormatPlannerResult,
): UzumeCompiledReferencePlan['outputDevicePolicy'] => {
  const plan = input.sampleRatePlan;
  const outputMode = plan?.outputMode ?? input.outputMode ?? null;
  const requestedOutputRate = normalizeRate(plan?.requestedOutputSampleRate);
  const actualDeviceRate = normalizeRate(plan?.actualDeviceSampleRate);
  const sharedDeviceRate = normalizeRate(plan?.sharedDeviceSampleRate);
  const directLike = outputMode === 'exclusive' || outputMode === 'asio';
  const rateMismatch = directLike &&
    requestedOutputRate !== null &&
    actualDeviceRate !== null &&
    requestedOutputRate !== actualDeviceRate;
  const sharedLike = outputMode === 'shared' || outputMode === 'system';
  const state: UzumeCompiledReferencePlan['outputDevicePolicy']['state'] = plan === null
    ? 'unknown'
    : rateMismatch
      ? 'device-rate-mismatch-risk'
      : sharedLike
        ? 'shared-mixer-risk'
        : directLike
          ? 'direct-like-ready'
          : 'unknown';
  const deviceCapability: UzumeCompiledReferencePlan['outputDevicePolicy']['deviceCapability'] = plan === null
    ? 'unknown'
    : outputMode === 'shared'
      ? 'shared-mixer'
      : outputMode === 'system'
        ? 'system-output'
        : directLike
          ? rateMismatch ? 'direct-like-rate-mismatch' : 'direct-like-rate-match'
          : 'unknown';
  const recommendation: UzumeCompiledReferencePlan['outputDevicePolicy']['recommendation'] = state === 'device-rate-mismatch-risk'
    ? 'inspect-device-rate-mismatch'
    : state === 'shared-mixer-risk'
      ? 'prefer-exclusive-or-device-rate-match'
      : 'none';
  const reasons: string[] = [];

  if (plan === null) {
    reasons.push('sample_rate_plan_unavailable');
  } else if (rateMismatch) {
    reasons.push('actual_device_rate_differs_from_requested_output_rate');
  } else if (sharedLike) {
    reasons.push('shared_or_system_output_may_use_mixer_resampling');
  } else if (directLike) {
    reasons.push('direct_like_output_reports_actual_device_rate');
  }
  reasons.push('output_device_policy_reference_only');

  return {
    artifact: 'output-device-policy-reference',
    formatPath: format.formatPath,
    outputMode,
    deviceCapability,
    state,
    sourceContainer: format.sourceContainer,
    outputContainer: format.outputContainer,
    fileRate: normalizeRate(plan?.fileSampleRate),
    decoderOutputRate: normalizeRate(plan?.decoderOutputSampleRate),
    requestedOutputRate,
    actualDeviceRate,
    sharedDeviceRate,
    bitPerfectCandidate: plan?.bitPerfectCandidate ?? null,
    resampling: plan?.resampling ?? null,
    sampleRateMismatch: plan?.sampleRateMismatch ?? null,
    recommendation,
    reasons,
  };
};

const buildBackendSupportInspectReport = (
  format: FormatPlannerResult,
  outputDevicePolicy: UzumeCompiledReferencePlan['outputDevicePolicy'],
): UzumeCompiledReferencePlan['backendSupport'] => ({
  artifact: 'backend-support-reference',
  policy: 'reference-backend-only-no-runtime-switch',
  formatPath: format.formatPath,
  selectedBackend: 'cpu-float64-reference',
  realtimeBackend: 'not-enabled',
  outputDevicePolicyState: outputDevicePolicy.state,
  cpuReference: {
    id: 'cpu-float64-reference',
    state: 'available',
    role: 'deterministic-reference',
  },
  cpuAvx: {
    id: 'cpu-avx2-fused-macro-kernel',
    state: 'future-production-gate',
    gate: 'rpc-003-cpu-realtime-gate',
  },
  gpu: {
    id: 'gpu-render-ahead-offload',
    state: 'future-render-ahead-gate',
    gate: 'rpc-005-gpu-render-ahead-gate',
  },
  legacy: {
    id: 'legacy-dsp-chain',
    state: 'non-uzume-fallback-only',
    allowedInCompiler: false,
  },
  reasons: [
    'cpu_float64_reference_selected_for_rpc002',
    'avx2_gpu_runtime_backends_deferred_beyond_reference_gate',
    'legacy_dsp_chain_not_entered_by_uzume_compiler',
    'backend_support_reference_only',
  ],
});

const buildDsdRequestedControls = (input: UzumeReferenceCompileInput, formatPath: UzumeFormatPath): UzumeReferenceDsdControlId[] => {
  const controls = new Set<UzumeReferenceDsdControlId>(['safety-metering']);
  if (formatPath === 'dsd_direct') {
    return Array.from(controls);
  }
  if (formatPath === 'dsd_upsampling' || formatPath === 'sdm_processed') {
    controls.add('headroom');
    controls.add('overload-guard');
    controls.add('sdm-modulator');
  }
  if (Math.abs(input.eqState.dspHeadroomDb ?? 0) > 0.001) {
    controls.add('headroom');
  }
  if (input.eqState.enabled || input.eqState.bands.some((band) => band.enabled)) {
    controls.add('eq');
  }
  if (input.roomCorrectionState.enabled || input.roomCorrectionState.status === 'loaded') {
    controls.add('fir');
  }
  if (input.channelBalanceState.enabled) {
    controls.add('channel-matrix');
  }
  if (input.replayGainActive) {
    controls.add('replaygain');
  }
  if (input.echoSrcActive || input.sampleRatePlan?.resampling) {
    controls.add('pcm-src');
  }
  if (input.eqState.dspSafetyLimiterEnabled) {
    controls.add('pcm-limiter');
  }
  return Array.from(controls);
};

const buildDsdFamilyReport = (
  input: UzumeReferenceCompileInput,
  format: FormatPlannerResult,
): UzumeCompiledReferencePlan['dsdFamily'] => {
  if (
    format.sourceContainer !== 'dsd' ||
    (
      format.formatPath !== 'dsd_direct' &&
      format.formatPath !== 'dsd_upsampling' &&
      format.formatPath !== 'd2p_processed' &&
      format.formatPath !== 'sdm_processed'
    )
  ) {
    return null;
  }

  const plan = input.sampleRatePlan;
  const dsdRate = normalizeRate(plan?.fileSampleRate) ?? normalizeRate(plan?.dsdNativeSampleRate);
  const targetDsdRate = normalizeRate(plan?.requestedOutputSampleRate) ?? normalizeRate(plan?.actualDeviceSampleRate) ?? dsdRate;
  const internalPcmRate = normalizeRate(plan?.decoderOutputSampleRate) ?? normalizeRate(plan?.requestedOutputSampleRate);
  const sdmReferenceAvailable = input.nativeFormatPath === 'dsd_upsampling' || input.nativeFormatPath === 'sdm_processed';
  const d2pReferenceAvailable = format.formatPath === 'd2p_processed';

  return planUzumeDsdFamilyPathReference({
    formatPath: format.formatPath,
    outputContainer: format.outputContainer,
    requestedControls: buildDsdRequestedControls(input, format.formatPath),
    sourceDsdRate: dsdRate,
    targetDsdRate,
    internalPcmRate,
    decimationProfile: format.formatPath === 'd2p_processed' ? 'reference-low-pass-decimation' : null,
    modulatorProfile: format.formatPath === 'dsd_upsampling' || format.formatPath === 'sdm_processed' ? 'uzume-sdm-reference' : null,
    headroomDb: input.eqState.dspHeadroomDb,
    overloadMarginDb: format.formatPath === 'dsd_upsampling' || format.formatPath === 'sdm_processed' ? 6 : null,
    ultrasonicNoiseRisk: format.formatPath === 'dsd_upsampling' || format.formatPath === 'sdm_processed' ? 'normal' : null,
    sdmReferenceAvailable,
    d2pReferenceAvailable,
  });
};

const dsdUpsamplingAllowedControls = new Set<UzumeReferenceDsdControlId>([
  'headroom',
  'safety-metering',
  'overload-guard',
  'sdm-modulator',
]);

const pcmDomainDsdControls = new Set<UzumeReferenceDsdControlId>([
  'headroom',
  'safety-metering',
  'overload-guard',
  'eq',
  'fir',
  'crossfeed',
  'channel-matrix',
  'replaygain',
  'pcm-src',
  'pcm-dither',
  'pcm-limiter',
]);

const dsdOutputEncoding = (rate: number | null, container: UzumeOutputContainer): string | null => {
  if (!rate || container === 'pcm') {
    return null;
  }

  const base = rate / 44100;
  const family = Number.isInteger(base) && base >= 64 ? `dsd${base}` : `dsd@${rate}`;
  return container === 'dop' ? `dop-${family}` : family;
};

export const planUzumeDsdFamilyPathReference = (
  input: UzumeReferenceDsdFamilyPathInput,
): UzumeReferenceDsdFamilyPathResult => {
  const requestedControls = Array.from(new Set(input.requestedControls ?? []));
  const sourceDsdRate = normalizeRate(input.sourceDsdRate);
  const targetDsdRate = normalizeRate(input.targetDsdRate) ?? sourceDsdRate;
  const internalPcmRate = normalizeRate(input.internalPcmRate);
  const sdmAvailable = input.sdmReferenceAvailable === true;
  const d2pAvailable = input.d2pReferenceAvailable !== false;
  const outputContainer = input.outputContainer;
  const internalDomain = getInternalDomain(input.formatPath) as UzumeReferenceDsdFamilyPathResult['internalDomain'];
  const reasons: string[] = [];
  let directDisabledReason: string | null = null;
  let fallbackReason: UzumeReferenceDsdFamilyPathResult['fallbackReason'] = null;
  let state: UzumeReferenceDsdFamilyPathResult['state'] = 'unavailable';
  let allowedControls: UzumeReferenceDsdControlId[] = [];
  let entersPcmDsp = false;
  let pcmDomainDspAllowed = false;
  let pcmDitherAllowed = false;
  let sdmNoiseShapingTelemetry = false;
  const disabledControls: UzumeReferenceDsdFamilyPathResult['disabledControls'] = [];

  if (input.formatPath === 'dsd_direct') {
    const sampleChangingControls = requestedControls.filter((control) => control !== 'safety-metering');
    state = sampleChangingControls.length === 0 && outputContainer !== 'pcm' ? 'direct' : 'unavailable';
    directDisabledReason = state === 'direct' ? null : 'sample_changing_dsp_requires_d2p_or_sdm_processed';
    allowedControls = requestedControls.filter((control) => control === 'safety-metering');
    for (const control of sampleChangingControls) {
      disabledControls.push({ control, reason: 'dsd_direct_is_bitstream_only' });
    }
    reasons.push('dsd_direct_bypasses_pcm_dsp_src_limiter_dither');
    if (directDisabledReason) {
      reasons.push('direct_disabled_reason_reported');
    }
  } else if (input.formatPath === 'dsd_upsampling') {
    state = sdmAvailable ? 'sdm-only-reference' : 'unavailable';
    directDisabledReason = 'dsd_upsampling_enabled';
    allowedControls = sdmAvailable ? requestedControls.filter((control) => dsdUpsamplingAllowedControls.has(control)) : [];
    for (const control of requestedControls) {
      if (!sdmAvailable && dsdUpsamplingAllowedControls.has(control)) {
        disabledControls.push({ control, reason: 'sdm_reference_engine_not_ready' });
      } else if (!dsdUpsamplingAllowedControls.has(control)) {
        disabledControls.push({ control, reason: 'requires_d2p_processed_or_sdm_processed' });
      }
    }
    if (!sdmAvailable) {
      fallbackReason = 'sdm_reference_engine_not_ready';
      if (!requestedControls.includes('sdm-modulator')) {
        disabledControls.push({ control: 'sdm-modulator', reason: 'sdm_reference_engine_not_ready' });
      }
      reasons.push('sdm_reference_engine_not_ready');
    } else {
      sdmNoiseShapingTelemetry = true;
    }
    reasons.push('dsd_upsampling_is_sdm_only_not_pcm_domain_dsp');
  } else if (input.formatPath === 'd2p_processed') {
    state = d2pAvailable ? 'd2p-reference' : 'unavailable';
    directDisabledReason = 'dsd_source_decoded_to_pcm';
    if (d2pAvailable) {
      allowedControls = requestedControls.filter((control) => pcmDomainDsdControls.has(control));
      entersPcmDsp = true;
      pcmDomainDspAllowed = true;
      pcmDitherAllowed = true;
      reasons.push('d2p_reports_decimation_profile_and_internal_pcm_rate');
    } else {
      fallbackReason = 'd2p_reference_engine_not_ready';
      for (const control of requestedControls) {
        disabledControls.push({ control, reason: 'd2p_reference_engine_not_ready' });
      }
      reasons.push('d2p_reference_engine_not_ready');
    }
  } else {
    state = sdmAvailable ? 'sdm-processed-reference' : 'unavailable';
    directDisabledReason = 'sdm_processed_enabled';
    allowedControls = sdmAvailable ? requestedControls.filter((control) => control !== 'pcm-dither') : [];
    for (const control of requestedControls) {
      if (control === 'pcm-dither') {
        disabledControls.push({ control, reason: 'sdm_uses_noise_shaping_not_pcm_dither' });
      } else if (!sdmAvailable) {
        disabledControls.push({ control, reason: 'sdm_reference_engine_not_ready' });
      }
    }
    if (!sdmAvailable) {
      fallbackReason = 'sdm_reference_engine_not_ready';
      if (!requestedControls.includes('sdm-modulator')) {
        disabledControls.push({ control: 'sdm-modulator', reason: 'sdm_reference_engine_not_ready' });
      }
      reasons.push('sdm_reference_engine_not_ready');
    } else {
      entersPcmDsp = true;
      pcmDomainDspAllowed = true;
      sdmNoiseShapingTelemetry = true;
      reasons.push('sdm_reports_modulator_overload_and_ultrasonic_noise');
    }
  }

  return {
    artifact: 'dsd-family-path-control-reference',
    formatPath: input.formatPath,
    sourceContainer: 'dsd',
    outputContainer,
    internalDomain,
    state,
    directDisabledReason,
    fallbackReason,
    experimental: input.formatPath === 'dsd_upsampling' || input.formatPath === 'sdm_processed',
    pcmDomainDspAllowed,
    entersPcmDsp,
    pcmDitherAllowed,
    sdmNoiseShapingTelemetry,
    allowedControls,
    disabledControls,
    dsd: {
      sourceDsdRate,
      targetDsdRate,
      outputEncoding: dsdOutputEncoding(targetDsdRate, outputContainer),
    },
    d2p: {
      active: input.formatPath === 'd2p_processed' && d2pAvailable,
      available: d2pAvailable,
      decimationProfile: input.formatPath === 'd2p_processed'
        ? d2pAvailable ? input.decimationProfile ?? 'reference-low-pass-decimation' : null
        : null,
      internalPcmRate: input.formatPath === 'd2p_processed' && d2pAvailable ? internalPcmRate : null,
    },
    sdm: {
      active: sdmAvailable && (input.formatPath === 'dsd_upsampling' || input.formatPath === 'sdm_processed'),
      available: sdmAvailable,
      mode: input.formatPath === 'dsd_upsampling'
        ? 'dsd-upsampling'
        : input.formatPath === 'sdm_processed' ? 'sdm-processed' : 'none',
      modulatorProfile: sdmAvailable && (input.formatPath === 'dsd_upsampling' || input.formatPath === 'sdm_processed')
        ? input.modulatorProfile ?? 'uzume-sdm-reference'
        : null,
      targetDsdRate: sdmAvailable && (input.formatPath === 'dsd_upsampling' || input.formatPath === 'sdm_processed')
        ? targetDsdRate
        : null,
      headroomDb: input.headroomDb ?? null,
      overloadMarginDb: input.overloadMarginDb ?? null,
      ultrasonicNoiseRisk: input.ultrasonicNoiseRisk ?? null,
      realtimeSafetyClass: 'offline-reference-only',
    },
    reasons,
  };
};

const bitDepthForSampleFormat = (format: UzumeReferencePcmOutputSampleFormat): number | null => {
  switch (format) {
    case 'int16':
      return 16;
    case 'int24':
      return 24;
    case 'int32':
      return 32;
    default:
      return null;
  }
};

const nextUnitRandom = (state: { value: number }): number => {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value / 0xffffffff;
};

const pcmBitPerfectReadOnlySections: readonly UzumeReferenceSectionId[] = [
  'format-path',
  'safety-meter',
];

const pcmBitPerfectSampleChangingSections: readonly UzumeReferenceSectionId[] = [
  'precision-normalization',
  'headroom',
  'replaygain',
  'materialized-gain',
  'peq',
  'stereo-procedural',
  'crossfeed',
  'pcm-src',
  'shared-convolution',
  'limiter',
  'dither',
  'sdm-modulator',
];

const uniqueRequestedSections = (
  sections: ReadonlyArray<UzumeReferenceSectionId> | undefined,
): UzumeReferenceSectionId[] => {
  const requested = sections ?? [...pcmBitPerfectReadOnlySections, ...pcmBitPerfectSampleChangingSections];
  const seen = new Set<UzumeReferenceSectionId>();
  const unique: UzumeReferenceSectionId[] = [];
  for (const section of requested) {
    if (!seen.has(section)) {
      seen.add(section);
      unique.push(section);
    }
  }

  return unique;
};

const isFiniteRectangularPcm = (channels: ReadonlyArray<ReadonlyArray<number>>): boolean => {
  const length = channels[0]?.length ?? 0;
  return channels.every((channel) =>
    channel.length === length && channel.every((sample) => Number.isFinite(sample)));
};

const cloneChannelsVerbatim = (channels: ReadonlyArray<ReadonlyArray<number>>): number[][] =>
  channels.map((channel) => Array.from(channel));

const bitPerfectDirectDisabledReason = (
  input: UzumeReferenceBitPerfectBypassInput,
): string | null => {
  if (input.directDisabledReason) {
    return input.directDisabledReason;
  }

  switch (input.formatPath) {
    case 'pcm_bitperfect':
      return null;
    case 'pcm_processed':
      return 'sample_changing_pcm_dsp_enabled';
    case 'dsd_direct':
      return null;
    case 'dsd_upsampling':
      return 'dsd_upsampling_enabled';
    case 'd2p_processed':
      return 'dsd_source_decoded_to_pcm';
    case 'sdm_processed':
      return 'sdm_processed_enabled';
    default:
      return 'bitperfect_conditions_not_met';
  }
};

export const renderUzumeBitPerfectBypassReference = (
  input: UzumeReferenceBitPerfectBypassInput,
): UzumeReferenceBitPerfectBypassResult => {
  const requestedSections = uniqueRequestedSections(input.requestedSections);
  const readOnlySections = requestedSections.filter((section) => pcmBitPerfectReadOnlySections.includes(section));
  const sampleChangingSections = requestedSections.filter((section) => pcmBitPerfectSampleChangingSections.includes(section));
  const directDisabledReason = bitPerfectDirectDisabledReason(input);
  const frameCount = input.channels[0]?.length ?? 0;
  const comparedSamples = frameCount * input.channels.length;
  const nonFiniteOrMismatched = !isFiniteRectangularPcm(input.channels);
  const plannerDisabledBitPerfect =
    input.formatPath === 'pcm_bitperfect' &&
    (directDisabledReason !== null || input.bitPerfectState === 'disabled' || input.bitPerfectState === 'unavailable');

  if (input.formatPath !== 'pcm_bitperfect') {
    const dsdPath = input.formatPath !== 'pcm_processed';
    return {
      artifact: 'pcm-bitperfect-bypass-reference',
      formatPath: input.formatPath,
      engine: 'format-path-planner-reference',
      state: dsdPath ? 'not-applicable' : 'rejected',
      bitPerfectState: dsdPath ? 'not-applicable' : 'disabled',
      output: [],
      readOnlySections,
      disabledSections: [],
      activeSampleChangingSections: sampleChangingSections,
      sampleChangingDspEntered: input.formatPath !== 'dsd_direct',
      directDisabledReason,
      residual: {
        state: 'not-measured',
        comparedFrames: 0,
        comparedSamples: 0,
        maxAbs: null,
        rms: null,
      },
      reasons: dsdPath
        ? ['non_pcm_path_not_a_pcm_bitperfect_bypass_artifact', 'bitperfect_bypass_not_claimed_for_non_pcm_path']
        : ['pcm_processed_enters_sample_changing_dsp', 'bitperfect_bypass_not_claimed_for_processed_path'],
    };
  }

  if (plannerDisabledBitPerfect) {
    return {
      artifact: 'pcm-bitperfect-bypass-reference',
      formatPath: input.formatPath,
      engine: 'format-path-planner-reference',
      state: 'rejected',
      bitPerfectState: 'disabled',
      output: [],
      readOnlySections,
      disabledSections: [],
      activeSampleChangingSections: sampleChangingSections,
      sampleChangingDspEntered: false,
      directDisabledReason,
      residual: {
        state: 'not-measured',
        comparedFrames: 0,
        comparedSamples: 0,
        maxAbs: null,
        rms: null,
      },
      reasons: ['pcm_bitperfect_conditions_not_met', 'bitperfect_bypass_not_claimed_when_direct_disabled'],
    };
  }

  if (nonFiniteOrMismatched) {
    return {
      artifact: 'pcm-bitperfect-bypass-reference',
      formatPath: input.formatPath,
      engine: 'format-path-planner-reference',
      state: 'rejected',
      bitPerfectState: 'disabled',
      output: [],
      readOnlySections,
      disabledSections: [],
      activeSampleChangingSections: sampleChangingSections,
      sampleChangingDspEntered: false,
      directDisabledReason: 'pcm_ingress_guard_must_resolve_before_bitperfect_claim',
      residual: {
        state: 'not-measured',
        comparedFrames: 0,
        comparedSamples: 0,
        maxAbs: null,
        rms: null,
      },
      reasons: ['pcm_bitperfect_requires_finite_rectangular_pcm', 'bitperfect_bypass_not_claimed_for_invalid_pcm'],
    };
  }

  const output = cloneChannelsVerbatim(input.channels);
  const inputFlat = flattenChannels(input.channels);
  const outputFlat = flattenChannels(output);
  const reasons = [
    'pcm_bitperfect_bypasses_sample_changing_dsp',
    'identity_bypass_output_matches_input',
  ];
  if (readOnlySections.includes('safety-meter')) {
    reasons.push('safety_metering_is_read_only');
  }

  return {
    artifact: 'pcm-bitperfect-bypass-reference',
    formatPath: input.formatPath,
    engine: 'identity-bypass',
    state: 'preserved',
    bitPerfectState: 'preserved',
    output,
    readOnlySections,
    disabledSections: sampleChangingSections,
    activeSampleChangingSections: [],
    sampleChangingDspEntered: false,
    directDisabledReason,
    residual: {
      state: 'identity-null',
      comparedFrames: frameCount,
      comparedSamples,
      maxAbs: maxAbsDiff(inputFlat, outputFlat),
      rms: rmsError(inputFlat, outputFlat),
    },
    reasons,
  };
};

export const renderUzumePcmOutputQuantizationReference = (
  input: UzumeReferencePcmOutputQuantizationInput,
): UzumeReferencePcmOutputQuantizationResult => {
  const channels = cloneChannels(input.channels);
  const ditherMode = input.ditherMode ?? 'tpdf';
  const bitDepth = bitDepthForSampleFormat(input.outputSampleFormat);
  const maxInteger = bitDepth === null ? null : (2 ** (bitDepth - 1)) - 1;
  const lsbAmplitude = maxInteger === null ? null : 1 / maxInteger;
  const seed = input.seed ?? 0xd17e202;
  const state = { value: seed >>> 0 };
  const pcmFixedPoint = bitDepth !== null && maxInteger !== null && lsbAmplitude !== null;
  const pcmDitherAllowed =
    pcmFixedPoint &&
    input.formatPath !== 'pcm_bitperfect' &&
    input.formatPath !== 'dsd_direct' &&
    input.formatPath !== 'dsd_upsampling' &&
    input.formatPath !== 'sdm_processed';
  const sdmNoiseShapingTelemetry =
    input.outputSampleFormat === 'sdm' ||
    input.formatPath === 'dsd_upsampling' ||
    input.formatPath === 'sdm_processed';

  if (input.formatPath === 'pcm_bitperfect') {
    return {
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: input.formatPath,
      outputSampleFormat: input.outputSampleFormat,
      state: 'bypass',
      bitPerfectState: 'preserved',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      output: channels,
      quantizedIntegers: [],
      dither: {
        mode: ditherMode,
        enabled: false,
        seed: null,
        lsbAmplitude: null,
        peakDitherLsb: 0,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth,
        maxInteger,
        clippedSamples: 0,
        residualMaxAbs: 0,
        residualRms: 0,
      },
      reasons: ['bitperfect_path_bypasses_dither_and_quantization'],
    };
  }

  if (sdmNoiseShapingTelemetry) {
    return {
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: input.formatPath,
      outputSampleFormat: input.outputSampleFormat,
      state: 'rejected',
      bitPerfectState: 'not-applicable',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: true,
      output: [],
      quantizedIntegers: [],
      dither: {
        mode: ditherMode,
        enabled: false,
        seed: null,
        lsbAmplitude: null,
        peakDitherLsb: 0,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth,
        maxInteger,
        clippedSamples: 0,
        residualMaxAbs: null,
        residualRms: null,
      },
      reasons: ['pcm_to_dsd_uses_sdm_noise_shaping_not_pcm_dither'],
    };
  }

  if (!pcmFixedPoint) {
    return {
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: input.formatPath,
      outputSampleFormat: input.outputSampleFormat,
      state: 'bypass',
      bitPerfectState: 'not-applicable',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      output: channels,
      quantizedIntegers: [],
      dither: {
        mode: ditherMode,
        enabled: false,
        seed: null,
        lsbAmplitude: null,
        peakDitherLsb: 0,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth,
        maxInteger,
        clippedSamples: 0,
        residualMaxAbs: 0,
        residualRms: 0,
      },
      reasons: ['float_output_keeps_internal_precision_no_pcm_dither'],
    };
  }

  const ditherEnabled = pcmDitherAllowed && ditherMode !== 'none';
  const noiseShaping = ditherMode === 'noise-shaped-tpdf'
    ? 'first-order-error-feedback' as const
    : 'none' as const;
  let clippedSamples = 0;
  let peakDither = 0;
  const errorFeedback = Array.from({ length: channels.length }, () => 0);
  const quantizedIntegers = channels.map((channel, channelIndex) =>
    channel.map((sample) => {
      const tpdf = ditherEnabled
        ? (nextUnitRandom(state) - nextUnitRandom(state)) * lsbAmplitude
        : 0;
      peakDither = Math.max(peakDither, Math.abs(tpdf));
      const shaped = sample + tpdf + (noiseShaping === 'first-order-error-feedback' ? errorFeedback[channelIndex] * 0.5 : 0);
      const clipped = clamp(shaped, -1, 1);
      if (clipped !== shaped) {
        clippedSamples += 1;
      }
      const quantized = Math.round(clipped * maxInteger);
      const rendered = quantized / maxInteger;
      errorFeedback[channelIndex] = shaped - rendered;
      return quantized;
    }));
  const output = quantizedIntegers.map((channel) => channel.map((sample) => sample / maxInteger));
  const inputFlat = flattenChannels(channels);
  const outputFlat = flattenChannels(output);

  return {
    artifact: 'pcm-output-quantization-dither-reference',
    formatPath: input.formatPath,
    outputSampleFormat: input.outputSampleFormat,
    state: 'quantized',
    bitPerfectState: 'disabled',
    pcmDitherAllowed,
    sdmNoiseShapingTelemetry: false,
    output,
    quantizedIntegers,
    dither: {
      mode: ditherMode,
      enabled: ditherEnabled,
      seed: ditherEnabled ? seed >>> 0 : null,
      lsbAmplitude,
      peakDitherLsb: lsbAmplitude > 0 ? peakDither / lsbAmplitude : 0,
      noiseShaping,
    },
    quantization: {
      bitDepth,
      maxInteger,
      clippedSamples,
      residualMaxAbs: maxAbsDiff(inputFlat, outputFlat),
      residualRms: rmsError(inputFlat, outputFlat),
    },
    reasons: [
      'fixed_point_pcm_output_quantized',
      ditherEnabled ? 'pcm_dither_disables_bitperfect' : 'pcm_dither_disabled_for_test_only',
      noiseShaping === 'first-order-error-feedback' ? 'pcm_noise_shaping_reference' : 'pcm_tpdf_or_plain_quantization_reference',
    ],
  };
};

const resolvePcmOutputSampleFormat = (
  input: UzumeReferenceCompileInput,
  format: FormatPlannerResult,
): UzumeReferencePcmOutputSampleFormat => {
  if (
    format.outputContainer !== 'pcm' ||
    format.formatPath === 'dsd_direct' ||
    format.formatPath === 'dsd_upsampling' ||
    format.formatPath === 'sdm_processed'
  ) {
    return 'sdm';
  }

  const nativeFormat = input.nativeOutputFormat?.toLowerCase() ?? '';
  if (nativeFormat.includes('float64') || nativeFormat.includes('f64')) {
    return 'float64';
  }
  if (nativeFormat.includes('float') || nativeFormat.includes('f32')) {
    return 'float32';
  }
  if (nativeFormat.includes('16')) {
    return 'int16';
  }
  if (nativeFormat.includes('24')) {
    return 'int24';
  }
  if (nativeFormat.includes('32')) {
    return 'int32';
  }

  const sourceBitDepth = input.probe?.bitDepth;
  if (sourceBitDepth && sourceBitDepth <= 16) {
    return 'int16';
  }
  if (sourceBitDepth && sourceBitDepth <= 24) {
    return 'int24';
  }

  return 'int32';
};

const createPcmOutputQuantizationReferenceChannels = (channelCount: number): number[][] =>
  Array.from({ length: Math.max(1, Math.min(2, Math.round(channelCount) || 2)) }, (_, channelIndex) => [
    0,
    channelIndex === 0 ? 0.125 : -0.125,
    0.25,
    -0.25,
    0.5,
    -0.5,
    0.875,
    -0.875,
  ]);

const resolveReferenceSampleRate = (input: UzumeReferenceCompileInput): number =>
  normalizeRate(input.sampleRatePlan?.decoderOutputSampleRate)
  ?? normalizeRate(input.sampleRatePlan?.fileSampleRate)
  ?? normalizeRate(input.probe?.fileSampleRate)
  ?? 48000;

const buildPcmOutputQuantizationReport = (
  input: UzumeReferenceCompileInput,
  format: FormatPlannerResult,
): UzumeCompiledReferencePlan['pcmOutputQuantization'] => {
  const result = renderUzumePcmOutputQuantizationReference({
    formatPath: format.formatPath,
    outputSampleFormat: resolvePcmOutputSampleFormat(input, format),
    channels: createPcmOutputQuantizationReferenceChannels(input.probe?.channels ?? 2),
    ditherMode: 'tpdf',
    seed: 0xd17e202,
  });

  return {
    artifact: result.artifact,
    formatPath: result.formatPath,
    outputSampleFormat: result.outputSampleFormat,
    state: result.state,
    bitPerfectState: format.bitPerfectState === 'disabled'
      ? 'disabled'
      : format.bitPerfectState === 'unavailable' ? 'not-applicable' : result.bitPerfectState,
    pcmDitherAllowed: result.pcmDitherAllowed,
    sdmNoiseShapingTelemetry: result.sdmNoiseShapingTelemetry,
    dither: result.dither,
    quantization: result.quantization,
    reasons: format.bitPerfectState === 'disabled' && format.directDisabledReason
      ? [...result.reasons, format.directDisabledReason]
      : result.reasons,
  };
};

const buildGainStagingStage = (
  id: UzumeReferenceGainStageId,
  channels: ReadonlyArray<ReadonlyArray<number>>,
  gainDb: number,
  cumulativeGainDb: number,
): UzumeReferenceGainStagingStage => {
  const stage = measure(channels);
  return {
    id,
    gainDb,
    cumulativeGainDb,
    peak: stage.peak,
    rms: stage.rms,
    peakDbfs: amplitudeToDb(stage.peak),
    rmsDbfs: amplitudeToDb(stage.rms),
    clippingRisk: stage.peak > 1,
  };
};

export const renderUzumeGainStagingReference = (
  input: UzumeReferenceGainStagingInput,
): UzumeReferenceGainStagingResult => {
  const output = cloneChannels(input.channels);
  const stages: UzumeReferenceGainStagingStage[] = [
    buildGainStagingStage('input', output, 0, 0),
  ];
  const stageInputs: Array<{
    id: Exclude<UzumeReferenceGainStageId, 'input' | 'output'>;
    gainDb: number;
  }> = [
    { id: 'headroom', gainDb: input.headroomDb ?? 0 },
    { id: 'replaygain', gainDb: input.replayGainDb ?? 0 },
    { id: 'materialized-gain', gainDb: input.materializedGainDb ?? 0 },
  ];
  let cumulativeGainDb = 0;

  for (const stage of stageInputs) {
    cumulativeGainDb += stage.gainDb;
    applyGain(output, dbToGain(stage.gainDb));
    stages.push(buildGainStagingStage(stage.id, output, stage.gainDb, cumulativeGainDb));
  }

  stages.push(buildGainStagingStage('output', output, 0, cumulativeGainDb));
  const outputPeak = stages[stages.length - 1].peak;
  const clipRisk = stages.some((stage) => stage.clippingRisk);
  const recommendedAdditionalHeadroomDb = outputPeak > 1
    ? roundTenth(amplitudeToDb(outputPeak))
    : 0;

  return {
    artifact: 'gain-staging-reference',
    engine: 'gain-reference',
    orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'],
    output,
    stages,
    totalGainDb: cumulativeGainDb,
    totalGainLinear: dbToGain(cumulativeGainDb),
    recommendedAdditionalHeadroomDb,
    clipRisk,
    reasons: [
      'headroom_applied_before_replaygain_and_materialized_gain',
      'gain_stages_merge_to_single_gain_reference',
      clipRisk ? 'post_gain_clip_risk_requires_more_headroom' : 'gain_staging_within_sample_peak_budget',
    ],
  };
};

const buildGainStagingReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['gainStaging'] => {
  const result = renderUzumeGainStagingReference({
    channels: createPcmOutputQuantizationReferenceChannels(input.probe?.channels ?? 2),
    headroomDb: input.eqState.dspHeadroomDb ?? 0,
    replayGainDb: input.replayGainDb ?? 0,
    materializedGainDb: input.eqState.preampDb ?? 0,
  });

  return {
    artifact: result.artifact,
    engine: result.engine,
    orderContract: result.orderContract,
    stages: result.stages,
    totalGainDb: result.totalGainDb,
    totalGainLinear: result.totalGainLinear,
    recommendedAdditionalHeadroomDb: result.recommendedAdditionalHeadroomDb,
    clipRisk: result.clipRisk,
    reasons: result.reasons,
  };
};

const isPeqActive = (state: Pick<EqState, 'enabled' | 'bands'>): boolean =>
  state.enabled && state.bands.some((band) => band.enabled !== false && (
    Math.abs(band.gainDb) > 0.001 ||
    band.filterType === 'lowPass' ||
    band.filterType === 'highPass' ||
    band.filterType === 'notch'
  ));

const isChannelBalanceActive = (state: ChannelBalanceState): boolean => {
  if (!state.enabled) {
    return false;
  }

  return Math.abs(state.balance) > 0.001 ||
    Math.abs(state.leftGainDb) > 0.001 ||
    Math.abs(state.rightGainDb) > 0.001 ||
    Math.abs(state.leftDelayMs ?? 0) > 0.001 ||
    Math.abs(state.rightDelayMs ?? 0) > 0.001 ||
    state.swapLeftRight ||
    state.invertLeft ||
    state.invertRight ||
    state.monoMode !== 'off' ||
    channelBalanceBandIds.some((bandId) => {
      const band = state.bandGains?.[bandId];
      return Math.abs(band?.leftGainDb ?? 0) > 0.001 || Math.abs(band?.rightGainDb ?? 0) > 0.001;
    });
};

const hasChannelBandCompensation = (state: ChannelBalanceState): boolean =>
  channelBalanceBandIds.some((bandId) => {
    const band = state.bandGains?.[bandId];
    return Math.abs(band?.leftGainDb ?? 0) > 0.001 || Math.abs(band?.rightGainDb ?? 0) > 0.001;
  });

const summarizeResponsePeak = (values: ReadonlyArray<number>): number =>
  values.length ? Math.max(...values) : 0;

const summarizeResponseDip = (values: ReadonlyArray<number>): number =>
  values.length ? Math.min(...values) : 0;

const summarizePhaseSpan = (values: ReadonlyArray<number>): number =>
  values.length ? Math.max(...values) - Math.min(...values) : 0;

const buildIirEqInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeReferenceIirEqInspectReport => {
  const sampleRate = resolveReferenceSampleRate(input);
  const bands = input.eqState.enabled
    ? input.eqState.bands
    : input.eqState.bands.map((band) => ({ ...band, enabled: false }));
  const result = renderUzumeIirEqReference({
    sampleRate,
    channels: createPcmOutputQuantizationReferenceChannels(input.probe?.channels ?? 2),
    bands,
  });
  const bandsReport = result.bandReports.map((band) => ({
    index: band.index,
    filterType: band.filterType ?? 'peaking',
    frequencyHz: band.frequencyHz,
    requestedFrequencyHz: band.requestedFrequencyHz,
    q: band.q,
    gainDb: band.gainDb,
    state: band.state,
    coefficientState: band.coefficients ? 'generated' as const : 'bypassed' as const,
    responsePeakDb: summarizeResponsePeak(band.response.magnitudeDb),
    responseDipDb: summarizeResponseDip(band.response.magnitudeDb),
    phaseSpanRadians: summarizePhaseSpan(band.response.phaseRadians),
    reasons: band.reasons,
  }));
  const bypassedBandCount = bandsReport.filter((band) => band.state !== 'active').length;

  return {
    artifact: result.artifact,
    engine: result.engine,
    orderContract: result.orderContract,
    state: result.residualVsBypass.state === 'processed' ? 'active' : 'exact-bypass',
    sampleRate,
    bandCount: bandsReport.length,
    activeBandCount: result.activeBandCount,
    bypassedBandCount,
    bands: bandsReport,
    residual: result.residualVsBypass,
    reasons: result.reasons,
  };
};

const buildChannelScopeOperations = (state: ChannelBalanceState): UzumeReferenceChannelScopeOperation[] => {
  if (!state.enabled) {
    return [{
      id: 'scope-neutral-stereo-pair',
      kind: 'gain',
      scope: { mode: 'stereo-pair', pairStart: 0 },
      gainDb: 0,
    }];
  }

  const balance = clamp(state.balance, -1, 1);
  const leftBalanceGain = balance > 0 ? 1 - balance : 1;
  const rightBalanceGain = balance < 0 ? 1 + balance : 1;
  const leftGainDb = (state.leftGainDb ?? 0) + gainToDb(leftBalanceGain);
  const rightGainDb = (state.rightGainDb ?? 0) + gainToDb(rightBalanceGain);
  const operations: UzumeReferenceChannelScopeOperation[] = [];

  if (Math.abs(leftGainDb) > 0.001) {
    operations.push({
      id: 'left-trim-scope',
      kind: 'gain',
      scope: { mode: 'channels', channels: [0] },
      gainDb: leftGainDb,
    });
  }
  if (Math.abs(rightGainDb) > 0.001) {
    operations.push({
      id: 'right-trim-scope',
      kind: 'gain',
      scope: { mode: 'channels', channels: [1] },
      gainDb: rightGainDb,
    });
  }
  if (state.invertLeft) {
    operations.push({
      id: 'left-invert-scope',
      kind: 'invert',
      scope: { mode: 'channels', channels: [0] },
    });
  }
  if (state.invertRight) {
    operations.push({
      id: 'right-invert-scope',
      kind: 'invert',
      scope: { mode: 'channels', channels: [1] },
    });
  }
  if (state.monoMode === 'left') {
    operations.push({
      id: 'left-to-right-scope',
      kind: 'mix-from',
      scope: { mode: 'channels', channels: [1] },
      sourceChannel: 0,
      mixGainDb: 0,
    });
  } else if (state.monoMode === 'right') {
    operations.push({
      id: 'right-to-left-scope',
      kind: 'mix-from',
      scope: { mode: 'channels', channels: [0] },
      sourceChannel: 1,
      mixGainDb: 0,
    });
  }

  return operations.length
    ? operations
    : [{
        id: 'scope-neutral-stereo-pair',
        kind: 'gain',
        scope: { mode: 'stereo-pair', pairStart: 0 },
        gainDb: 0,
      }];
};

const buildChannelScopeInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeReferenceChannelScopeInspectReport => {
  const result = renderUzumeChannelScopeReference({
    channels: createPcmOutputQuantizationReferenceChannels(Math.max(2, input.probe?.channels ?? 2)),
    operations: buildChannelScopeOperations(input.channelBalanceState),
  });
  const appliedOperationCount = result.operationReports.filter((operation) => operation.state === 'applied').length;
  const noopOperationCount = result.operationReports.filter((operation) => operation.state === 'noop').length;
  const invalidOperationCount = result.operationReports
    .filter((operation) => operation.state === 'invalid-source' || operation.state === 'no-targets')
    .length;

  return {
    artifact: result.artifact,
    engine: result.engine,
    scopeContract: result.scopeContract,
    channelCount: result.output.length,
    operationCount: result.operationReports.length,
    appliedOperationCount,
    noopOperationCount,
    invalidOperationCount,
    untouchedChannelIndexes: result.untouchedChannelIndexes,
    operations: result.operationReports.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      targetChannels: operation.targetChannels,
      skippedChannels: operation.skippedChannels,
      state: operation.state,
      gainDb: operation.gainDb,
      sourceChannel: operation.sourceChannel,
      reasons: operation.reasons,
    })),
    residualByChannel: result.residualByChannel,
    reasons: result.reasons,
  };
};

const buildStereoProceduralProfile = (
  state: ChannelBalanceState,
): UzumeReferenceStereoProceduralProfile => {
  if (!state.enabled) {
    return {
      crossfeed: { enabled: false },
    };
  }

  const balance = clamp(state.balance, -1, 1);
  const leftBalanceGain = balance > 0 ? 1 - balance : 1;
  const rightBalanceGain = balance < 0 ? 1 + balance : 1;

  return {
    trimDb: {
      left: (state.leftGainDb ?? 0) + gainToDb(leftBalanceGain),
      right: (state.rightGainDb ?? 0) + gainToDb(rightBalanceGain),
    },
    delayMs: {
      left: state.leftDelayMs ?? 0,
      right: state.rightDelayMs ?? 0,
    },
    invert: {
      left: state.invertLeft,
      right: state.invertRight,
    },
    swapLeftRight: state.swapLeftRight,
    monoMode: state.monoMode,
    crossfeed: { enabled: false },
  };
};

const buildStereoProceduralInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeReferenceStereoProceduralInspectReport => {
  const sampleRate = resolveReferenceSampleRate(input);
  const channels = createPcmOutputQuantizationReferenceChannels(Math.max(2, input.probe?.channels ?? 2));
  const result = renderUzumeStereoMatrixFilterReference({
    sampleRate,
    channels,
    profile: buildStereoProceduralProfile(input.channelBalanceState),
  });
  const inputFlat = flattenChannels(channels);
  const outputFlat = flattenChannels(result.channels);
  const residualMaxAbs = maxAbsDiff(inputFlat, outputFlat);
  const residualRms = rmsError(inputFlat, outputFlat);
  const state = result.telemetry.steps.length ? 'active' as const : 'identity-bypass' as const;
  const reasons = [
    'stereo_procedural_reference_only',
    state === 'active' ? 'stereo_procedural_steps_applied_in_order' : 'stereo_procedural_identity_bypass',
  ];

  if (hasChannelBandCompensation(input.channelBalanceState)) {
    reasons.push('band_compensation_requires_iir_reference_split');
  }

  return {
    artifact: 'stereo-procedural-matrix-filter-reference',
    engine: 'stereo-procedural-reference',
    state,
    sampleRate,
    channelCount: result.channels.length,
    steps: result.telemetry.steps,
    matrix: [
      [result.telemetry.matrix[0][0], result.telemetry.matrix[0][1]],
      [result.telemetry.matrix[1][0], result.telemetry.matrix[1][1]],
    ],
    delaySamples: result.telemetry.delaySamples,
    routing: {
      invertLeft: result.telemetry.invert.left,
      invertRight: result.telemetry.invert.right,
      swapLeftRight: result.telemetry.swapLeftRight,
      monoMode: result.telemetry.monoMode,
    },
    crossfeed: {
      enabled: result.telemetry.crossfeedEnabled,
      crossDelaySamples: result.telemetry.crossDelaySamples,
      lowPassHz: result.telemetry.lowPassHz,
      centerPreservation: result.telemetry.centerPreservation,
    },
    input: result.telemetry.input,
    output: result.telemetry.output,
    residual: {
      state: residualMaxAbs > 0 || residualRms > 0 ? 'processed' : 'exact-bypass',
      comparedFrames: channels[0]?.length ?? 0,
      maxAbs: residualMaxAbs,
      rms: residualRms,
    },
    reasons,
  };
};

const buildPerEarEqPlacementInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['perEarEqPlacement'] => {
  const sampleRate = resolveReferenceSampleRate(input);
  const perEarEq = {
    leftGainDb: -6,
    rightGainDb: 6,
  };
  const crossfeed = {
    enabled: true,
    crossGainDb: -9,
    crossDelayMs: 0,
    lowPassHz: Math.min(24000, sampleRate / 2),
    centerPreservation: 'none' as const,
  };
  const rendered = renderUzumePerEarEqPlacementReference({
    sampleRate,
    channels: [
      [1, 0.25, 0, -0.25],
      [0, 0.1, 0.2, 0.3],
    ],
    perEarEq,
    crossfeed,
  });

  return {
    artifact: rendered.artifact,
    orderContract: rendered.orderContract,
    compilerRule: rendered.compilerRule,
    state: rendered.placementResidual.state,
    sampleRate,
    perEarEq,
    crossfeed,
    preCrossfeedSteps: rendered.preCrossfeed.telemetry.steps,
    postCrossfeedSteps: rendered.postCrossfeed.telemetry.steps,
    residual: {
      comparedFrames: rendered.placementResidual.comparedFrames,
      maxAbs: rendered.placementResidual.maxAbs,
      rms: rendered.placementResidual.rms,
    },
    reasons: [
      rendered.placementResidual.state === 'placement-sensitive'
        ? 'crossfeed_and_asymmetric_per_ear_eq_are_not_commutative'
        : 'per_ear_eq_placement_commutative_for_input',
      'do_not_reorder_across_crossfeed_without_null_proof',
      'per_ear_eq_placement_reference_only',
    ],
  };
};

const sampleRateFamily = (rate: number | null): UzumeReferenceSampleRateFamily | null => {
  if (!rate) {
    return null;
  }

  if (rate % 44100 === 0) {
    return '44.1k-family';
  }

  if (rate % 48000 === 0) {
    return '48k-family';
  }

  return 'custom-rate-family';
};

const nextPowerOfTwo = (value: number): number => {
  let next = 1;
  while (next < value) {
    next *= 2;
  }

  return next;
};

const channelLayoutForCount = (channels: number): UzumeReferenceConvolutionSource['channelLayout'] => {
  if (channels <= 1) {
    return 'mono';
  }

  return channels === 2 ? 'stereo' : 'multichannel';
};

const normalizeConvolutionSource = (
  input: UzumeSharedConvolutionReferenceSourceInput,
): UzumeReferenceConvolutionSource => {
  const sampleRate = normalizeRate(input.sampleRate);
  const channels = Math.max(1, Math.round(input.channels));
  const tapCount = Math.max(1, Math.round(input.tapCount));
  if (!sampleRate) {
    throw new Error('uzume_shared_convolution_requires_positive_source_rate');
  }
  if (!Number.isFinite(input.channels) || channels < 1) {
    throw new Error('uzume_shared_convolution_requires_positive_channel_count');
  }
  if (!Number.isFinite(input.tapCount) || tapCount < 1) {
    throw new Error('uzume_shared_convolution_requires_positive_tap_count');
  }

  const routing = input.routing ?? (input.kind === 'advanced-matrix-fir' ? 'matrix' : 'per-channel');

  return {
    id: input.id,
    kind: input.kind,
    sampleRate,
    sampleRateFamily: sampleRateFamily(sampleRate) ?? 'custom-rate-family',
    channelLayout: input.channelLayout ?? (routing === 'matrix' ? 'matrix' : channelLayoutForCount(channels)),
    channels,
    tapCount,
    latencySamples: Math.max(0, Math.round(input.latencySamples ?? Math.floor((tapCount - 1) / 2))),
    phasePolicy: input.phasePolicy ?? 'linear',
    routing,
  };
};

const buildInactiveConvolutionPartitionPlan = (
  targetRate: number | null,
  targetChannels: number | null,
  callbackBlockFrames: number,
  latencyClass: UzumeReferenceConvolutionPartitionPlan['latencyClass'],
): UzumeReferenceConvolutionPartitionPlan => ({
  sampleRateFamily: sampleRateFamily(targetRate),
  exactSampleRate: targetRate,
  channelLayout: targetChannels ? channelLayoutForCount(targetChannels) : null,
  latencyClass,
  callbackBlockFrames,
  internalBlockFrames: 0,
  outputBlockFrames: callbackBlockFrames,
  directHeadTaps: 0,
  fftHeadSize: 0,
  fftTailSizes: [],
  partitionHopSizes: [],
  partitionCount: 0,
  tailFrames: 0,
  tailSeconds: 0,
  warmupFrames: 0,
  drainFrames: 0,
  overlapStrategy: 'none',
  cpuPlanId: null,
  gpuPlanId: null,
});

const buildTailPartitionLadder = (tailTaps: number, internalBlockFrames: number): {
  fftTailSizes: number[];
  partitionHopSizes: number[];
} => {
  const fftTailSizes: number[] = [];
  const partitionHopSizes: number[] = [];
  let remaining = tailTaps;
  let hop = Math.max(128, internalBlockFrames);

  while (remaining > 0) {
    const fftSize = nextPowerOfTwo(hop * 2);
    fftTailSizes.push(fftSize);
    partitionHopSizes.push(hop);
    remaining -= hop;
    if (fftTailSizes.length % 2 === 0) {
      hop *= 2;
    }
  }

  return { fftTailSizes, partitionHopSizes };
};

const buildResponseResamplePolicyReports = (
  sources: readonly UzumeReferenceConvolutionSource[],
  targetRate: number | null,
): UzumeReferenceSharedConvolutionReport['responseResampleReports'] =>
  sources.map((source) => {
    const sourceRate = normalizeRate(source.sampleRate);
    const sameRateBypass = Boolean(sourceRate && targetRate && sourceRate === targetRate);
    if (!targetRate || !sourceRate) {
      return {
        artifact: 'high-precision-response-resample-policy-reference',
        sourceId: source.id,
        kind: source.kind,
        sourceRate,
        targetRate,
        sourceFamily: sampleRateFamily(sourceRate),
        targetFamily: sampleRateFamily(targetRate),
        state: 'target-rate-unavailable',
        engine: 'unavailable',
        sameRateBypass: false,
        linearInterpolationRejected: false,
        filterContract: null,
        reason: 'target_rate_unavailable',
      };
    }

    return {
      artifact: 'high-precision-response-resample-policy-reference',
      sourceId: source.id,
      kind: source.kind,
      sourceRate,
      targetRate,
      sourceFamily: source.sampleRateFamily,
      targetFamily: sampleRateFamily(targetRate),
      state: sameRateBypass ? 'same-rate-bypass' : 'windowed-sinc-reference-required',
      engine: sameRateBypass ? 'exact-bypass' : 'windowed-sinc-float64-reference',
      sameRateBypass,
      linearInterpolationRejected: !sameRateBypass,
      filterContract: sameRateBypass ? null : buildResamplingFilterContract(sourceRate, targetRate),
      reason: sameRateBypass
        ? 'same_rate_exact_bypass'
        : source.sampleRateFamily !== sampleRateFamily(targetRate)
          ? 'cross_family_response_resample_uses_windowed_sinc_reference'
          : 'exact_rate_mismatch_response_resample_uses_windowed_sinc_reference',
    };
  });

export const planUzumeSharedConvolutionReference = (
  input: UzumeSharedConvolutionReferenceInput,
): UzumeReferenceSharedConvolutionReport => {
  const targetRate = normalizeRate(input.targetRate);
  const targetChannels = input.targetChannels && Number.isFinite(input.targetChannels)
    ? Math.max(1, Math.round(input.targetChannels))
    : null;
  const callbackBlockFrames = input.callbackBlockFrames && Number.isFinite(input.callbackBlockFrames)
    ? Math.max(1, Math.round(input.callbackBlockFrames))
    : 512;
  const requestedLatencyClass = input.latencyClass ?? 'realtime-low';
  const sources = input.sources.map(normalizeConvolutionSource);
  const responseResampleReports = buildResponseResamplePolicyReports(sources, targetRate);
  if (!sources.length || !targetRate) {
    return {
      active: false,
      engine: 'shared-convolution-planner-reference',
      sources,
      mergedSourceIds: [],
      splitSourceIds: sources.map((source) => source.id),
      splitReasons: Object.fromEntries(sources.map((source) => [source.id, targetRate ? 'no_mergeable_sources' : 'target_rate_unavailable'])),
      partitionPlan: buildInactiveConvolutionPartitionPlan(targetRate, targetChannels, callbackBlockFrames, 'inactive'),
      responseResampleReports,
    };
  }

  const targetFamily = sampleRateFamily(targetRate) ?? 'custom-rate-family';
  const targetLayout = channelLayoutForCount(targetChannels ?? sources[0].channels);
  const basePhasePolicy = sources.find((source) => source.routing !== 'analysis-only')?.phasePolicy ?? 'linear';
  const mergedSourceIds: string[] = [];
  const splitSourceIds: string[] = [];
  const splitReasons: Record<string, string> = {};

  for (const source of sources) {
    let splitReason: string | null = null;
    if (source.routing === 'matrix' || source.channelLayout === 'matrix') {
      splitReason = 'advanced_matrix_fir_requires_dedicated_matrix_plan';
    } else if (source.sampleRateFamily !== targetFamily) {
      splitReason = 'sample_rate_family_mismatch';
    } else if (source.sampleRate !== targetRate) {
      splitReason = 'exact_sample_rate_mismatch_requires_response_resample';
    } else if (source.channelLayout !== targetLayout && source.channelLayout !== 'mono') {
      splitReason = 'channel_routing_mismatch';
    } else if (source.phasePolicy !== basePhasePolicy) {
      splitReason = 'phase_policy_mismatch';
    }

    if (splitReason) {
      splitSourceIds.push(source.id);
      splitReasons[source.id] = splitReason;
    } else {
      mergedSourceIds.push(source.id);
    }
  }

  if (!mergedSourceIds.length) {
    return {
      active: false,
      engine: 'shared-convolution-planner-reference',
      sources,
      mergedSourceIds,
      splitSourceIds,
      splitReasons,
      partitionPlan: buildInactiveConvolutionPartitionPlan(targetRate, targetChannels, callbackBlockFrames, 'inactive'),
      responseResampleReports,
    };
  }

  const mergedSources = sources.filter((source) => mergedSourceIds.includes(source.id));
  const mergedTapCount = mergedSources.reduce((sum, source) => sum + source.tapCount, 1 - mergedSources.length);
  const tailFrames = Math.max(0, mergedTapCount - 1);
  const directHeadTaps = Math.min(128, mergedTapCount);
  const internalBlockFrames = nextPowerOfTwo(Math.max(callbackBlockFrames, Math.min(2048, directHeadTaps * 2)));
  const tailTaps = Math.max(0, mergedTapCount - directHeadTaps);
  const { fftTailSizes, partitionHopSizes } = buildTailPartitionLadder(tailTaps, internalBlockFrames);
  const fftHeadSize = nextPowerOfTwo(internalBlockFrames + directHeadTaps - 1);
  const latencyClass = requestedLatencyClass === 'inactive'
    ? (tailFrames > targetRate ? 'render-ahead-extreme' : tailFrames > targetRate / 4 ? 'quality-first' : 'realtime-low')
    : requestedLatencyClass;
  const planKey = `${targetFamily}:${targetRate}:${targetLayout}:${mergedSourceIds.join('+')}:${internalBlockFrames}`;

  return {
    active: true,
    engine: 'shared-convolution-planner-reference',
    sources,
    mergedSourceIds,
    splitSourceIds,
    splitReasons,
    partitionPlan: {
      sampleRateFamily: targetFamily,
      exactSampleRate: targetRate,
      channelLayout: targetLayout,
      latencyClass,
      callbackBlockFrames,
      internalBlockFrames,
      outputBlockFrames: callbackBlockFrames,
      directHeadTaps,
      fftHeadSize,
      fftTailSizes,
      partitionHopSizes,
      partitionCount: 1 + fftTailSizes.length,
      tailFrames,
      tailSeconds: tailFrames / targetRate,
      warmupFrames: Math.max(directHeadTaps, callbackBlockFrames),
      drainFrames: tailFrames,
      overlapStrategy: fftTailSizes.length ? 'overlap-save-reference' : 'none',
      cpuPlanId: `cpu-sce-${planKey}`,
      gpuPlanId: latencyClass === 'render-ahead-extreme' || latencyClass === 'quality-first'
        ? `gpu-sce-${planKey}`
        : null,
    },
    responseResampleReports,
  };
};

export const planUzumeSharedConvolutionDuplicateGuardReference = (
  input: UzumeSharedConvolutionReferenceInput,
): UzumeSharedConvolutionDuplicateGuardResult => {
  const planner = planUzumeSharedConvolutionReference(input);
  const sharedConvolverPlanId = planner.partitionPlan.cpuPlanId;
  const sharedFftPlanId = planner.partitionPlan.fftHeadSize > 0 && planner.partitionPlan.cpuPlanId
    ? `${planner.partitionPlan.cpuPlanId}:fft:${planner.partitionPlan.fftHeadSize}`
    : null;
  const sourceAssignments: UzumeSharedConvolutionDuplicateGuardSourceAssignment[] = planner.sources.map((source) => {
    const splitReason = planner.splitReasons[source.id] ?? null;
    const shared = planner.mergedSourceIds.includes(source.id);
    return {
      sourceId: source.id,
      state: shared ? 'shared-plan' : 'split-required',
      convolverPlanId: shared ? sharedConvolverPlanId : null,
      fftPlanId: shared ? sharedFftPlanId : null,
      splitReason,
    };
  });
  const rejectedDuplicatePlans = planner.mergedSourceIds.slice(1).map((sourceId) => ({
    sourceId,
    rejectedConvolverPlanId: `per-source-convolver:${sourceId}`,
    rejectedFftPlanId: `per-source-fft:${sourceId}`,
    reason: 'compatible_source_uses_shared_convolution_plan' as const,
  }));
  const activeGpuPlanCount = planner.partitionPlan.gpuPlanId ? 1 : 0;
  const state = planner.active
    ? 'single-shared-plan'
    : planner.splitSourceIds.length > 0 ? 'split-required' : 'inactive';

  return {
    artifact: 'shared-convolution-duplicate-plan-guard-reference',
    engine: 'shared-convolution-planner-reference',
    state,
    planner,
    sourceAssignments,
    planCounts: {
      mergedSourceCount: planner.mergedSourceIds.length,
      splitSourceCount: planner.splitSourceIds.length,
      convolverPlanCount: planner.active ? 1 : 0,
      cpuFftPlanCount: planner.active && planner.partitionPlan.cpuPlanId ? 1 : 0,
      gpuFftPlanCount: activeGpuPlanCount,
      rejectedDuplicateConvolverCount: Math.max(0, planner.mergedSourceIds.length - (planner.active ? 1 : 0)),
      rejectedDuplicateFftPlanCount: Math.max(0, planner.mergedSourceIds.length - (planner.active ? 1 : 0)),
    },
    rejectedDuplicatePlans,
    reasons: planner.active
      ? ['compatible_sources_share_single_convolution_plan', 'duplicate_per_source_convolver_and_fft_plans_rejected']
      : planner.splitSourceIds.length > 0
        ? ['split_sources_require_explained_separate_sections', 'duplicate_plan_guard_deferred_to_split_reason']
        : ['no_active_convolution_plan'],
  };
};

export const analyzeUzumeSharedConvolutionResponsePreflightReference = (
  input: UzumeSharedConvolutionResponsePreflightInput,
): UzumeSharedConvolutionResponsePreflightResult => {
  const sampleRate = normalizeRate(input.sampleRate);
  const expectedChannels = Math.max(1, Math.round(Number.isFinite(input.expectedChannels) ? input.expectedChannels : 1));
  const dcOffsetWarnThreshold = Math.max(0, input.dcOffsetWarnThreshold ?? 0.02);
  const inputChannels = input.responses.length;
  const channelMismatch = inputChannels > 0 && inputChannels !== 1 && inputChannels !== expectedChannels;
  let nonFiniteSamples = 0;
  const sanitizedInput = input.responses.map((response) =>
    response.map((sample) => {
      if (Number.isFinite(sample)) {
        return sample;
      }
      nonFiniteSamples += 1;
      return 0;
    }));
  const effectiveChannels = channelMismatch
    ? inputChannels
    : expectedChannels;
  const sanitizedResponses = channelMismatch
    ? sanitizedInput.map((response) => response.slice())
    : Array.from({ length: effectiveChannels }, (_, channelIndex) =>
        (sanitizedInput[inputChannels === 1 ? 0 : channelIndex] ?? []).slice());
  const tapCount = sanitizedResponses.reduce((maxLength, response) => Math.max(maxLength, response.length), 0);
  const peak = sanitizedResponses.reduce((maxPeak, response) => Math.max(maxPeak, maxAbs(response)), 0);
  const dcOffsetByChannel = sanitizedResponses.map((response) =>
    response.length > 0 ? response.reduce((sum, sample) => sum + sample, 0) / response.length : 0);
  const maxAbsDcOffset = maxAbs(dcOffsetByChannel);
  const reasons: UzumeSharedConvolutionResponsePreflightResult['reasons'] = ['peak_measured', 'dc_offset_measured'];
  if (peak > 1) {
    reasons.push('peak_over_unity');
  }
  if (maxAbsDcOffset > dcOffsetWarnThreshold) {
    reasons.push('dc_offset_warning');
  }
  if (nonFiniteSamples > 0) {
    reasons.push('non_finite_response_samples_zeroed');
  }
  if (channelMismatch) {
    reasons.push('response_channel_mismatch');
  }
  if (!tapCount || !inputChannels) {
    reasons.push('empty_response');
  }
  if (reasons.length === 2) {
    reasons.push('response_preflight_ok');
  }

  return {
    artifact: 'shared-convolution-response-preflight-reference',
    engine: 'shared-convolution-planner-reference',
    sourceId: input.sourceId,
    kind: input.kind,
    sampleRate,
    sampleRateFamily: sampleRateFamily(sampleRate),
    state: !tapCount || !inputChannels
      ? 'empty-response'
      : channelMismatch ? 'channel-mismatch' : nonFiniteSamples > 0 ? 'sanitized' : 'ok',
    expectedChannels,
    inputChannels,
    effectiveChannels,
    tapCount,
    peak,
    peakOverUnity: peak > 1,
    dcOffsetByChannel,
    maxAbsDcOffset,
    nonFiniteSamples,
    sanitizedSamples: nonFiniteSamples,
    sanitizedResponses,
    reasons,
  };
};

const cloneResponseChannels = (
  responses: ReadonlyArray<ReadonlyArray<number>>,
  channelCount: number,
): number[][] => {
  if (!responses.length) {
    throw new Error('uzume_shared_convolution_serial_reference_requires_response');
  }
  if (responses.length !== 1 && responses.length !== channelCount) {
    throw new Error('uzume_shared_convolution_serial_reference_response_channel_mismatch');
  }

  const cloned = responses.map((response) => response.map((value) => (Number.isFinite(value) ? value : 0)));
  return Array.from({ length: channelCount }, (_, channelIndex) =>
    (cloned[responses.length === 1 ? 0 : channelIndex] ?? [1]).slice());
};

const convolveReference = (
  signal: ReadonlyArray<number>,
  response: ReadonlyArray<number>,
): number[] => {
  if (!signal.length || !response.length) {
    return [];
  }

  const output = Array.from({ length: signal.length + response.length - 1 }, () => 0);
  for (let signalIndex = 0; signalIndex < signal.length; signalIndex += 1) {
    const sample = signal[signalIndex];
    for (let responseIndex = 0; responseIndex < response.length; responseIndex += 1) {
      output[signalIndex + responseIndex] += sample * response[responseIndex];
    }
  }

  return output;
};

export const renderUzumeSharedConvolutionSerialReference = (
  input: UzumeSharedConvolutionSerialReferenceInput,
): UzumeSharedConvolutionSerialReferenceResult => {
  const signal = cloneChannels(input.signal);
  const targetChannels = input.targetChannels && Number.isFinite(input.targetChannels)
    ? Math.max(1, Math.round(input.targetChannels))
    : signal.length;
  if (signal.length !== targetChannels) {
    throw new Error('uzume_shared_convolution_serial_reference_signal_channel_mismatch');
  }

  const planner = planUzumeSharedConvolutionReference({
    targetRate: input.targetRate,
    targetChannels,
    callbackBlockFrames: input.callbackBlockFrames,
    latencyClass: input.latencyClass,
    sources: input.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      sampleRate: source.sampleRate,
      channels: source.channels,
      tapCount: source.tapCount,
      latencySamples: source.latencySamples,
      phasePolicy: source.phasePolicy,
      routing: source.routing,
      channelLayout: source.channelLayout,
    })),
  });
  const sourceOrder = planner.mergedSourceIds.slice();
  if (!planner.active || sourceOrder.length !== input.sources.length) {
    return {
      artifact: 'shared-convolution-serial-null-reference',
      engine: 'shared-convolution-planner-reference',
      planner,
      sourceOrder,
      mergedResponses: [],
      mergedOutput: [],
      serialOutput: [],
      residual: {
        state: 'split-or-inactive',
        comparedFrames: 0,
        maxAbs: null,
        rms: null,
      },
    };
  }

  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const responseBySource = sourceOrder.map((sourceId) =>
    cloneResponseChannels(sourceById.get(sourceId)?.responses ?? [], targetChannels));
  const mergedResponses = Array.from({ length: targetChannels }, (_, channelIndex) =>
    responseBySource.reduce((merged, sourceResponses) =>
      convolveReference(merged, sourceResponses[channelIndex] ?? [1]), [1]));
  const mergedOutput = signal.map((channel, channelIndex) =>
    convolveReference(channel, mergedResponses[channelIndex] ?? [1]));
  const serialOutput = signal.map((channel, channelIndex) =>
    responseBySource.reduce((rendered, sourceResponses) =>
      convolveReference(rendered, sourceResponses[channelIndex] ?? [1]), channel.slice()));
  const mergedFlat = flattenChannels(mergedOutput);
  const serialFlat = flattenChannels(serialOutput);
  const residualMaxAbs = maxAbsDiff(mergedFlat, serialFlat);

  return {
    artifact: 'shared-convolution-serial-null-reference',
    engine: 'shared-convolution-planner-reference',
    planner,
    sourceOrder,
    mergedResponses,
    mergedOutput,
    serialOutput,
    residual: {
      state: residualMaxAbs <= 1e-12 ? 'merged-matches-serial' : 'residual-over-threshold',
      comparedFrames: Math.min(mergedOutput[0]?.length ?? 0, serialOutput[0]?.length ?? 0),
      maxAbs: residualMaxAbs,
      rms: rmsError(mergedFlat, serialFlat),
    },
  };
};

const compactSharedConvolutionDuplicatePlanGuardReport = (
  guarded: UzumeSharedConvolutionDuplicateGuardResult,
): UzumeReferenceSharedConvolutionDuplicatePlanGuardReport => ({
  artifact: guarded.artifact,
  engine: guarded.engine,
  state: guarded.state,
  sourceAssignments: guarded.sourceAssignments.map((assignment) => ({
    sourceId: assignment.sourceId,
    state: assignment.state,
    convolverPlanId: assignment.convolverPlanId,
    fftPlanId: assignment.fftPlanId,
    splitReason: assignment.splitReason,
  })),
  planCounts: guarded.planCounts,
  rejectedDuplicatePlans: guarded.rejectedDuplicatePlans.map((plan) => ({
    sourceId: plan.sourceId,
    rejectedConvolverPlanId: plan.rejectedConvolverPlanId,
    rejectedFftPlanId: plan.rejectedFftPlanId,
    reason: plan.reason,
  })),
  reasons: guarded.reasons,
});

const buildSerialReferenceResponse = (
  source: UzumeSharedConvolutionReferenceSourceInput,
  channelCount: number,
): number[][] => {
  const tapCount = Math.max(1, Math.min(6, Math.round(source.tapCount)));
  const base = Array.from({ length: tapCount }, (_, index) => {
    if (index === 0) {
      return 1;
    }
    const sign = index % 2 === 0 ? 1 : -1;
    return sign / (2 ** (index + 1));
  });

  return Array.from({ length: Math.max(1, channelCount) }, (_, channelIndex) =>
    base.map((tap, index) => tap * (channelIndex === 0 ? 1 : 1 - Math.min(0.25, index * 0.025))));
};

const compactSharedConvolutionSerialNullReport = (
  rendered: UzumeSharedConvolutionSerialReferenceResult,
): UzumeReferenceSharedConvolutionSerialNullReport => ({
  artifact: rendered.artifact,
  engine: rendered.engine,
  state: rendered.residual.state,
  sourceOrder: rendered.sourceOrder,
  mergedResponseTapCounts: rendered.mergedResponses.map((response) => response.length),
  comparedFrames: rendered.residual.comparedFrames,
  maxAbs: rendered.residual.maxAbs,
  rms: rendered.residual.rms,
  reasons: rendered.residual.state === 'merged-matches-serial'
    ? ['merged_response_matches_serial_direct_reference', 'serial_null_reference_only']
    : rendered.residual.state === 'split-or-inactive'
      ? ['serial_null_skipped_for_split_or_inactive_plan', 'serial_null_reference_only']
      : ['serial_null_residual_over_threshold', 'serial_null_reference_only'],
});

const buildResamplingReport = (
  input: UzumeReferenceCompileInput,
): UzumeReferenceResamplingReport => {
  const plan = input.sampleRatePlan;
  const sourceRate = normalizeRate(plan?.fileSampleRate) ?? normalizeRate(plan?.decoderOutputSampleRate);
  const targetRate = normalizeRate(plan?.requestedOutputSampleRate) ?? normalizeRate(plan?.actualDeviceSampleRate);
  const active = Boolean(plan && plan.dsdOutputMode === 'pcm' && sourceRate && targetRate && sourceRate !== targetRate);
  const ratio = sourceRate && targetRate ? targetRate / sourceRate : null;
  const baseDelay = active && ratio ? Math.ceil(32 * Math.max(1, ratio)) : 0;
  const baseDelayMs = samplesToMilliseconds(baseDelay, targetRate);
  const filterContract = buildResamplingFilterContract(sourceRate, targetRate);
  const artifactRates = sourceRate && targetRate
    ? { sourceRate, targetRate }
    : { sourceRate: 48000, targetRate: 48000 };
  const artifacts = sourceRate && targetRate
    ? createUzumeResamplingReferenceArtifacts(sourceRate, targetRate, 64, filterContract)
    : null;
  const artifactMetrics = artifacts
    ? artifacts.metrics
    : emptyResamplingArtifactMetrics();
  const validation = artifacts
    ? validateUzumeResamplingReferenceArtifacts(artifacts)
    : null;
  const phaseModeArtifacts = createUzumeResamplingPhaseModeReferenceArtifacts(
    artifactRates.sourceRate,
    artifactRates.targetRate,
    64,
    filterContract,
  );
  const apodizingArtifact = createUzumeResamplingApodizingReferenceArtifact(
    artifactRates.sourceRate,
    artifactRates.targetRate,
    64,
    filterContract,
  );
  const qualityRollback = planUzumeResamplingQualityRollbackReference(active, filterContract, artifactMetrics.realtimeBudget);
  const outputResamplingRisk = planUzumeOutputResamplingRiskReference({
    sampleRatePlan: plan,
    active,
    currentResamplerEngine: input.currentResamplerEngine,
  });
  const doubleResamplingRisk = outputResamplingRisk.reason;

  return {
    active,
    family: 'poly-sinc-reference',
    phaseMode: 'linear',
    apodizing: 'reference-windowed-sinc',
    sourceRate,
    targetRate,
    sourceFamily: sampleRateFamily(sourceRate),
    targetFamily: sampleRateFamily(targetRate),
    ratio,
    sameRateBypass: Boolean(sourceRate && targetRate && sourceRate === targetRate),
    groupDelaySamples: baseDelay,
    groupDelayMs: baseDelayMs,
    lookaheadSamples: baseDelay,
    lookaheadMs: baseDelayMs,
    phaseAccumulator: !sourceRate || !targetRate ? 'unavailable' : active ? 'rational-fixed-step' : 'same-rate-bypass',
    filterContract,
    artifactMetrics,
    phaseModeArtifacts,
    apodizingArtifact,
    validation,
    qualityRollback,
    outputResamplingRisk,
    realtimeSafetyClass: active ? 'offline-reference-only' : 'same-rate-bypass',
    doubleResamplingRisk,
  };
};

const buildSharedConvolutionReport = (
  input: UzumeReferenceCompileInput,
  resampling: UzumeReferenceResamplingReport,
): UzumeReferenceSharedConvolutionReport => {
  const targetRate =
    resampling.targetRate ??
    normalizeRate(input.sampleRatePlan?.requestedOutputSampleRate) ??
    normalizeRate(input.sampleRatePlan?.actualDeviceSampleRate) ??
    normalizeRate(input.probe?.fileSampleRate);
  const sources: UzumeSharedConvolutionReferenceSourceInput[] = [];

  if (input.roomCorrectionState.enabled && input.roomCorrectionState.tapCount > 0) {
    const roomRate = normalizeRate(input.roomCorrectionState.sampleRate) ?? targetRate;
    if (roomRate) {
      sources.push({
        id: 'room-ir',
        kind: 'room-ir',
        sampleRate: roomRate,
        channels: Math.max(1, Math.round(input.probe?.channels ?? 2)),
        tapCount: input.roomCorrectionState.tapCount,
        latencySamples: input.roomCorrectionState.latencySamples,
        phasePolicy: 'linear',
        routing: 'per-channel',
      });
    }
  }

  const targetChannels = Math.max(1, Math.round(input.probe?.channels ?? 2));
  const planInput: UzumeSharedConvolutionReferenceInput = {
    targetRate,
    targetChannels,
    callbackBlockFrames: 512,
    latencyClass: input.outputMode === 'shared' ? 'quality-first' : 'realtime-low',
    sources,
  };
  const planner = planUzumeSharedConvolutionReference(planInput);
  const duplicatePlanGuard = compactSharedConvolutionDuplicatePlanGuardReport(
    planUzumeSharedConvolutionDuplicateGuardReference(planInput),
  );
  const serialNullReference = compactSharedConvolutionSerialNullReport(
    renderUzumeSharedConvolutionSerialReference({
      ...planInput,
      signal: createPcmOutputQuantizationReferenceChannels(targetChannels),
      sources: sources.map((source) => ({
        ...source,
        responses: buildSerialReferenceResponse(source, targetChannels),
      })),
    }),
  );

  return {
    ...planner,
    duplicatePlanGuard,
    serialNullReference,
  };
};

const createGaplessReferenceSegments = (channelCount: number): UzumeReferenceGaplessSegmentInput[] => {
  const resolvedChannels = Math.max(1, Math.min(2, Math.round(channelCount) || 2));
  const stereoSegments = [
    {
      id: 'track-a',
      channels: [
        [0, 0.25, 0.5, 0.75, 1, 0.25, 0, -0.25],
        [0, -0.25, -0.5, -0.75, -1, -0.25, 0, 0.25],
      ],
    },
    {
      id: 'track-b',
      channels: [
        [-0.25, 0, 0.25, 0.5, 0.25, 0, -0.25, -0.5],
        [0.25, 0, -0.25, -0.5, -0.25, 0, 0.25, 0.5],
      ],
    },
  ];

  return stereoSegments.map((segment) => ({
    id: segment.id,
    channels: segment.channels.slice(0, resolvedChannels),
  }));
};

const buildGaplessConcatInspectReport = (
  input: UzumeReferenceCompileInput,
  resampling: UzumeReferenceResamplingReport,
): UzumeCompiledReferencePlan['gaplessConcat'] => {
  const sourceRate =
    normalizeRate(input.probe?.fileSampleRate) ??
    normalizeRate(resampling.sourceRate) ??
    normalizeRate(resampling.targetRate) ??
    44100;
  const targetRate =
    normalizeRate(resampling.targetRate) ??
    normalizeRate(input.sampleRatePlan?.requestedOutputSampleRate) ??
    sourceRate;
  const segments = createGaplessReferenceSegments(input.probe?.channels ?? 2);
  const rendered = renderUzumeGaplessConcatReference({
    sourceRate,
    targetRate,
    segments,
  });
  const state = sourceRate === targetRate ? 'same-rate-bypass' : 'src-stateful';

  return {
    artifact: 'gapless-concat-reference',
    policy: rendered.policy,
    state,
    sourceRate: rendered.sourceRate,
    targetRate: rendered.targetRate,
    ratio: rendered.ratio,
    segmentCount: segments.length,
    boundaryCount: rendered.boundaries.length,
    concatNullResidual: rendered.concatNullResidual,
    resetResidual: rendered.resetResidual,
    boundaries: rendered.boundaries,
    reasons: [
      'source_pcm_concat_before_src',
      state === 'src-stateful'
        ? 'src_state_must_not_reset_at_gapless_boundary'
        : 'same_rate_gapless_src_exact_bypass',
      'reset_per_track_src_compared_against_concat_reference',
      input.gaplessActive ? 'gapless_playback_policy_active' : 'reference_artifact_generated_offline',
    ],
  };
};

const buildFirGaplessHistoryInspectReport = (
  input: UzumeReferenceCompileInput,
  resampling: UzumeReferenceResamplingReport,
  sharedConvolution: UzumeReferenceSharedConvolutionReport,
): UzumeCompiledReferencePlan['firGaplessHistory'] => {
  const source = sharedConvolution.sources.find((entry) => entry.id === 'room-ir') ?? sharedConvolution.sources[0] ?? null;
  const channelCount = Math.max(1, Math.min(2, Math.round(source?.channels ?? input.probe?.channels ?? 2) || 2));
  const responses = Array.from({ length: channelCount }, () =>
    source ? [0.5, 0.25, -0.125, 0.0625] : [1]);
  const sampleRate =
    normalizeRate(source?.sampleRate) ??
    normalizeRate(resampling.targetRate) ??
    normalizeRate(input.sampleRatePlan?.requestedOutputSampleRate) ??
    normalizeRate(input.probe?.fileSampleRate) ??
    44100;
  const segments = createGaplessReferenceSegments(channelCount);
  const rendered = renderUzumeFirGaplessHistoryReference({
    sourceId: source?.id ?? 'identity-fir-gapless-reference',
    sampleRate,
    responses,
    segments,
  });
  const state = rendered.tailFrames > 0 ? 'history-required' : 'identity-bypass';

  return {
    artifact: rendered.artifact,
    policy: rendered.policy,
    engine: rendered.engine,
    state,
    sourceId: rendered.sourceId,
    sampleRate: rendered.sampleRate,
    segmentCount: segments.length,
    boundaryCount: rendered.boundaries.length,
    tailFrames: rendered.tailFrames,
    drainFrames: rendered.drainFrames,
    concatNullResidual: rendered.concatNullResidual,
    resetResidual: rendered.resetResidual,
    boundaries: rendered.boundaries,
    reasons: [
      'source_pcm_concat_before_fir',
      state === 'history-required'
        ? 'fir_history_must_cross_gapless_boundary'
        : 'identity_fir_has_no_gapless_tail',
      'reset_per_track_fir_history_compared_against_concat_reference',
      'fir_gapless_reference_only',
    ],
  };
};

const addAssignment = (
  assignments: UzumeReferenceAssignment[],
  sectionId: UzumeReferenceSectionId,
  engineId: UzumeReferenceEngineId,
  active: boolean,
  source: UzumeReferenceAssignment['source'],
  options: Omit<UzumeReferenceAssignment, 'sectionId' | 'engineId' | 'active' | 'source'> = {},
): void => {
  assignments.push({
    sectionId,
    engineId,
    active,
    source,
    ...options,
  });
};

const buildCompilerAssignments = (
  input: UzumeReferenceCompileInput,
  format: FormatPlannerResult,
  resampling: UzumeReferenceResamplingReport,
  sharedConvolution: UzumeReferenceSharedConvolutionReport,
  pcmOutputQuantization: UzumeCompiledReferencePlan['pcmOutputQuantization'],
): {
  orderedProfileSections: UzumeReferenceSectionId[];
  engineAssignments: UzumeReferenceAssignment[];
  mergeGroups: UzumeReferenceMergeGroup[];
  splitReasons: Record<string, string>;
  latencyOwners: Record<string, string>;
} => {
  const assignments: UzumeReferenceAssignment[] = [];
  const mergeGroups: UzumeReferenceMergeGroup[] = [];
  const splitReasons: Record<string, string> = {};
  const latencyOwners: Record<string, string> = {};
  const headroomActive = Math.abs(input.eqState.dspHeadroomDb ?? 0) > 0.05;
  const peqActive = isPeqActive(input.eqState);
  const stereoProceduralActive = isChannelBalanceActive(input.channelBalanceState);
  const roomConvolutionActive = input.roomCorrectionState.enabled && input.roomCorrectionState.tapCount > 0;
  const limiterActive = format.formatPath !== 'dsd_direct' && input.eqState.dspSafetyLimiterEnabled !== false;
  const gainGroupSections: UzumeReferenceSectionId[] = [];

  addAssignment(assignments, 'format-path', 'format-path-planner-reference', true, 'format-planner');

  if (format.sourceContainer === 'dsd') {
    addAssignment(assignments, 'dsd-ingress', 'dsd-ingress-reference', format.formatPath !== 'dsd_direct', 'format-planner');
  }

  addAssignment(
    assignments,
    'precision-normalization',
    'precision-normalization-reference',
    format.formatPath === 'pcm_processed' || format.formatPath === 'd2p_processed',
    'format-planner',
  );

  if (headroomActive) {
    gainGroupSections.push('headroom');
  }
  if (input.replayGainActive) {
    gainGroupSections.push('replaygain');
  }
  if (Math.abs(input.eqState.preampDb) > 0.001) {
    gainGroupSections.push('materialized-gain');
  }

  addAssignment(assignments, 'headroom', 'gain-reference', headroomActive, 'ui-section', {
    mergeGroupId: 'gain-reference',
  });
  addAssignment(assignments, 'replaygain', 'gain-reference', input.replayGainActive, 'playback-policy', {
    mergeGroupId: 'gain-reference',
  });
  addAssignment(assignments, 'materialized-gain', 'gain-reference', Math.abs(input.eqState.preampDb) > 0.001, 'ui-section', {
    mergeGroupId: 'gain-reference',
  });

  addAssignment(assignments, 'peq', 'iir-reference', peqActive, 'ui-section', {
    mergeGroupId: 'iir-reference',
  });

  const channelSplitReason = hasChannelBandCompensation(input.channelBalanceState)
    ? 'channel_balance_band_compensation_pending_reference'
    : null;
  if (channelSplitReason) {
    splitReasons['stereo-procedural'] = channelSplitReason;
  }
  if (Math.abs(input.channelBalanceState.leftDelayMs ?? 0) > 0.001 || Math.abs(input.channelBalanceState.rightDelayMs ?? 0) > 0.001) {
    latencyOwners['stereo-procedural'] = 'delay-reference';
  }
  addAssignment(assignments, 'stereo-procedural', 'stereo-procedural-reference', stereoProceduralActive, 'ui-section', {
    mergeGroupId: 'stereo-procedural-reference',
    splitReason: channelSplitReason,
    latencyOwner: latencyOwners['stereo-procedural'] ?? null,
  });
  addAssignment(assignments, 'crossfeed', 'stereo-matrix-filter-reference', false, 'ui-section', {
    splitReason: 'crossfeed_profile_not_exposed_yet',
  });

  const convolutionSplitReason =
    input.roomCorrectionState.enabled && !roomConvolutionActive
      ? 'room_ir_not_loaded'
      : sharedConvolution.splitReasons['room-ir']
        ? sharedConvolution.splitReasons['room-ir'] === 'sample_rate_family_mismatch' ||
            sharedConvolution.splitReasons['room-ir'] === 'exact_sample_rate_mismatch_requires_response_resample'
          ? 'room_ir_sample_rate_family_mismatch'
          : sharedConvolution.splitReasons['room-ir']
        : null;
  if (convolutionSplitReason) {
    splitReasons['shared-convolution'] = convolutionSplitReason;
  }
  if (roomConvolutionActive && input.roomCorrectionState.latencySamples > 0) {
    latencyOwners['shared-convolution'] = 'room-ir-latency';
  }
  addAssignment(assignments, 'shared-convolution', 'shared-convolution-planner-reference', roomConvolutionActive, 'ui-section', {
    mergeGroupId: 'shared-convolution-reference',
    splitReason: convolutionSplitReason,
    latencyOwner: latencyOwners['shared-convolution'] ?? null,
  });

  if (resampling.active) {
    latencyOwners['pcm-src'] = 'resampling-reference';
  }
  if (resampling.doubleResamplingRisk) {
    splitReasons['pcm-src'] = resampling.doubleResamplingRisk;
  }
  addAssignment(assignments, 'pcm-src', 'resampling-reference', resampling.active, 'ui-section', {
    mergeGroupId: 'resampling-reference',
    splitReason: resampling.doubleResamplingRisk ?? null,
    latencyOwner: latencyOwners['pcm-src'] ?? null,
  });

  const ditherSplitReason = !pcmOutputQuantization.dither.enabled
    ? pcmOutputQuantization.reasons[0] ?? null
    : null;
  if (ditherSplitReason) {
    splitReasons.dither = ditherSplitReason;
  }
  addAssignment(assignments, 'safety-meter', 'safety-metering-reference', format.formatPath !== 'dsd_direct', 'playback-policy');
  addAssignment(assignments, 'limiter', 'limiter-reference', limiterActive, 'playback-policy');
  addAssignment(assignments, 'dither', 'dither-reference', pcmOutputQuantization.dither.enabled, 'format-planner', {
    mergeGroupId: 'dither-reference',
    splitReason: ditherSplitReason,
  });
  addAssignment(assignments, 'sdm-modulator', 'sdm-reference', false, 'format-planner', {
    splitReason: 'sdm_reference_engine_not_ready',
  });

  if (gainGroupSections.length > 0) {
    mergeGroups.push({
      id: 'gain-reference',
      engineId: 'gain-reference',
      sections: gainGroupSections,
      active: true,
      splitReason: null,
    });
  }

  mergeGroups.push({
    id: 'iir-reference',
    engineId: 'iir-reference',
    sections: ['peq'],
    active: peqActive,
    splitReason: null,
  });
  mergeGroups.push({
    id: 'stereo-procedural-reference',
    engineId: 'stereo-procedural-reference',
    sections: ['stereo-procedural', 'crossfeed'],
    active: stereoProceduralActive,
    splitReason: channelSplitReason,
  });
  mergeGroups.push({
    id: 'shared-convolution-reference',
    engineId: 'shared-convolution-planner-reference',
    sections: ['shared-convolution'],
    active: sharedConvolution.active,
    sampleRateFamily: sharedConvolution.partitionPlan.sampleRateFamily,
    splitReason: convolutionSplitReason,
  });
  mergeGroups.push({
    id: 'resampling-reference',
    engineId: 'resampling-reference',
    sections: ['pcm-src'],
    active: resampling.active,
    sampleRateFamily: sampleRateFamily(resampling.targetRate),
    splitReason: resampling.doubleResamplingRisk ?? null,
  });
  mergeGroups.push({
    id: 'dither-reference',
    engineId: 'dither-reference',
    sections: ['dither'],
    active: pcmOutputQuantization.dither.enabled,
    splitReason: ditherSplitReason,
  });

  return {
    orderedProfileSections: assignments.map((assignment) => assignment.sectionId),
    engineAssignments: assignments,
    mergeGroups,
    splitReasons,
    latencyOwners,
  };
};

const buildContinuityInspectReport = (
  input: UzumeReferenceCompileInput,
  resampling: UzumeReferenceResamplingReport,
  sharedConvolution: UzumeReferenceSharedConvolutionReport,
): UzumeCompiledReferencePlan['continuity'] => {
  const targetRate =
    normalizeRate(resampling.targetRate) ??
    normalizeRate(input.sampleRatePlan?.actualDeviceSampleRate) ??
    normalizeRate(input.sampleRatePlan?.requestedOutputSampleRate) ??
    normalizeRate(input.probe?.fileSampleRate) ??
    48000;
  const sourceRate = normalizeRate(input.probe?.fileSampleRate) ?? targetRate;
  const channelCount = Math.max(1, Math.round(input.probe?.channels ?? 2));
  const callbackBlockFrames = Math.max(128, normalizeFrameCount(sharedConvolution.partitionPlan.callbackBlockFrames) || 512);
  const outputRingDepthFrames = callbackBlockFrames * 2;
  const lookaheadFrames = Math.max(0, normalizeFrameCount(resampling.lookaheadSamples));
  const groupDelayFrames = Math.max(0, normalizeFrameCount(resampling.groupDelaySamples));
  const firTailFrames = Math.max(0, normalizeFrameCount(sharedConvolution.partitionPlan.tailFrames));
  const decodePrepareFrames = callbackBlockFrames * 4;
  const preRollRequiredFrames =
    lookaheadFrames + groupDelayFrames + firTailFrames + decodePrepareFrames + callbackBlockFrames + outputRingDepthFrames;
  const framesUntilBoundary = Math.max(targetRate, preRollRequiredFrames + callbackBlockFrames * 8);
  const renderAheadTargetFrames = Math.max(callbackBlockFrames * 8, Math.round(targetRate * 5));
  const generationId = 1;
  const continuity = planUzumeContinuityStrategyReference({
    intent: input.gaplessActive ? 'gapless-boundary' : 'normal-playlist-boundary',
    policy: 'predictive-cache',
    generationId,
    predictiveCacheHit: false,
    shortBridgeAvailable: false,
    userAllowsShortBridge: false,
  });
  const preRoll = planUzumePreRollDeadlineReference({
    currentTrackId: 'current-reference',
    nextTrackId: 'next-reference',
    sampleRate: targetRate,
    currentRemainingFrames: framesUntilBoundary,
    callbackBlockFrames,
    outputRingDepthFrames,
    lookaheadFrames,
    groupDelayFrames,
    firTailFrames,
    decodePrepareFrames,
    renderAheadTargetFrames,
    renderAheadReadyFrames: 0,
    generationId,
    currentSampleRate: sourceRate,
    nextSampleRate: sourceRate,
    currentChannelCount: channelCount,
    nextChannelCount: channelCount,
  });
  const callbackRing = planUzumeCpuCallbackRingReference({
    generationId,
    ringCapacityFrames: callbackBlockFrames * 8,
    callbackBlockFrames,
    initialCommittedFrames: callbackBlockFrames * 4,
    cpuProducedFrames: callbackBlockFrames * 2,
    renderAheadTargetFrames: callbackBlockFrames * 4,
    cpuRealtimeFactor: 2.5,
  });
  const renderAheadRequestKey = input.gaplessActive ? 'gapless:next-reference:0' : 'next-head:reference:0';
  const renderAheadCache = planUzumeRenderAheadCacheReference({
    generationId,
    requestKey: renderAheadRequestKey,
    requiredStartFrame: 0,
    requiredFrames: callbackBlockFrames * 4,
    targetCallbackFrame: framesUntilBoundary,
    callbackBlockFrames,
    cacheBudgetBytes: Math.max(callbackBlockFrames * channelCount * 64, targetRate * channelCount * 4),
    entries: [],
  });
  const priorCommittedBlock = Array.from({ length: channelCount }, () =>
    Array.from({ length: callbackBlockFrames }, () => 0));
  const fallback = simulateUzumeFallbackInjectionReference({
    generationId,
    targetCallbackFrame: callbackBlockFrames * 8,
    callbackBlockFrames,
    expectedChannels: channelCount,
    callbackRingDepthFrames: callbackRing.ring.afterReadFrames,
    renderAheadDepthFrames: 0,
    renderAheadTargetFrames,
    rollingRealtimeFactor: 2.5,
    priorCommittedCandidate: {
      kind: 'prior-committed',
      generationId,
      channels: priorCommittedBlock,
      completedAtFrame: 0,
    },
    allowSilenceFallback: false,
  });

  return {
    artifact: 'continuity-telemetry-reference',
    policy: 'callback-read-committed-reference',
    continuity: {
      artifact: continuity.artifact,
      intent: continuity.intent,
      policy: continuity.policy,
      selectedPath: continuity.selectedPath,
      callbackRule: continuity.callbackRule,
      commitAllowed: continuity.commitAllowed,
      shortBridgeAllowed: continuity.shortBridgeAllowed,
      shortBridgeReason: continuity.shortBridgeReason,
      qualityRollback: continuity.qualityRollback,
      waitTarget: continuity.waitTarget,
    },
    preRoll: {
      artifact: preRoll.artifact,
      state: preRoll.state,
      preRollRequiredFrames: preRoll.preRollRequiredFrames,
      framesUntilBoundary: preRoll.framesUntilBoundary,
      deadlineSlackFrames: preRoll.deadlineSlackFrames,
      renderAheadState: preRoll.renderAhead.state,
      renderAheadTargetFrames: preRoll.renderAhead.targetFrames,
      renderAheadReadyFrames: preRoll.renderAhead.readyFrames,
      callbackBlockFrames: preRoll.callbackRing.callbackBlockFrames,
      outputRingDepthFrames: preRoll.callbackRing.outputRingDepthFrames,
      readRule: preRoll.callbackRing.readRule,
      mustNotWaitForGpu: preRoll.callbackRing.mustNotWaitForGpu,
      handoffStrategy: preRoll.handoff.strategy,
      requiresDualPipeline: preRoll.handoff.requiresDualPipeline,
      commitAllowed: preRoll.commitAllowed,
      shortBridgeAllowed: preRoll.shortBridgeAllowed,
    },
    callbackRing: {
      artifact: callbackRing.artifact,
      state: callbackRing.state,
      telemetryStatus: callbackRing.underrunTelemetry.status,
      capacityFrames: callbackRing.ring.capacityFrames,
      depthFrames: callbackRing.ring.afterReadFrames,
      depthBlocks: callbackRing.underrunTelemetry.ringDepthBlocks,
      callbackBlockFrames,
      missingFrames: callbackRing.ring.missingFrames,
      readRule: callbackRing.callbackRule,
      mustNotWaitForGpu: callbackRing.callbackMustNotWaitForGpu,
      shortBridgeAllowed: callbackRing.shortBridgeAllowed,
      shortBridgeReason: callbackRing.shortBridgeReason,
    },
    renderAheadCache: {
      artifact: renderAheadCache.artifact,
      lookupState: renderAheadCache.lookupState,
      commitState: renderAheadCache.commitState,
      commitAllowed: renderAheadCache.commitAllowed,
      callbackRule: renderAheadCache.callbackRule,
      mustNotWaitForGpu: renderAheadCache.callbackMustNotWaitForGpu,
      requestKey: renderAheadCache.requestKey,
      budgetBytes: renderAheadCache.cacheStats.budgetBytes,
      bytesBeforeEvict: renderAheadCache.cacheStats.bytesBeforeEvict,
      bytesAfterEvict: renderAheadCache.cacheStats.bytesAfterEvict,
      retainedKeys: renderAheadCache.retainedKeys,
      evictionCount: renderAheadCache.evictions.length,
    },
    fallback: {
      artifact: fallback.artifact,
      state: fallback.state,
      selectedSource: fallback.selectedSource,
      telemetryStatus: fallback.underrunTelemetry.status,
      callbackMustNotWaitForGpu: fallback.callbackMustNotWaitForGpu,
      shortBridgeAllowed: fallback.shortBridgeAllowed,
      shortBridgeReason: fallback.shortBridgeReason,
      qualityRollback: fallback.qualityRollback,
      fallbackInjected: fallback.fallbackInjected,
      commitAllowed: fallback.commitAllowed,
    },
  };
};

const buildLatencyBudgetInspectReport = (
  backendSupport: UzumeCompiledReferencePlan['backendSupport'],
  resampling: UzumeReferenceResamplingReport,
  sharedConvolution: UzumeReferenceSharedConvolutionReport,
  continuity: UzumeCompiledReferencePlan['continuity'],
  latencyOwners: Record<string, string>,
): UzumeCompiledReferencePlan['latencyBudget'] => {
  const mergedSourceIds = new Set(sharedConvolution.mergedSourceIds);
  const convolutionLatencySamples = sharedConvolution.active
    ? sharedConvolution.sources.reduce((maxLatency, source) => (
      mergedSourceIds.has(source.id)
        ? Math.max(maxLatency, normalizeFrameCount(source.latencySamples))
        : maxLatency
    ), 0)
    : 0;

  return {
    artifact: 'latency-budget-reference',
    policy: 'reference-budget-summary-no-runtime-scheduler',
    state: 'ready',
    selectedBackend: backendSupport.selectedBackend,
    realtimeBackend: backendSupport.realtimeBackend,
    outputDevicePolicyState: backendSupport.outputDevicePolicyState,
    sourceRate: resampling.sourceRate,
    targetRate: resampling.targetRate,
    srcGroupDelaySamples: resampling.groupDelaySamples,
    srcGroupDelayMs: resampling.groupDelayMs,
    srcLookaheadSamples: resampling.lookaheadSamples,
    srcLookaheadMs: resampling.lookaheadMs,
    convolutionLatencyClass: sharedConvolution.partitionPlan.latencyClass,
    convolutionLatencySamples,
    convolutionDirectHeadTaps: sharedConvolution.partitionPlan.directHeadTaps,
    convolutionWarmupFrames: sharedConvolution.partitionPlan.warmupFrames,
    convolutionTailFrames: sharedConvolution.partitionPlan.tailFrames,
    convolutionDrainFrames: sharedConvolution.partitionPlan.drainFrames,
    callbackBlockFrames: continuity.preRoll.callbackBlockFrames,
    internalBlockFrames: sharedConvolution.partitionPlan.internalBlockFrames,
    outputBlockFrames: sharedConvolution.partitionPlan.outputBlockFrames,
    preRollRequiredFrames: continuity.preRoll.preRollRequiredFrames,
    deadlineSlackFrames: continuity.preRoll.deadlineSlackFrames,
    outputRingDepthFrames: continuity.preRoll.outputRingDepthFrames,
    callbackRingCapacityFrames: continuity.callbackRing.capacityFrames,
    callbackRingDepthFrames: continuity.callbackRing.depthFrames,
    callbackRingDepthBlocks: continuity.callbackRing.depthBlocks,
    renderAheadState: continuity.preRoll.renderAheadState,
    renderAheadTargetFrames: continuity.preRoll.renderAheadTargetFrames,
    renderAheadReadyFrames: continuity.preRoll.renderAheadReadyFrames,
    cacheBudgetBytes: continuity.renderAheadCache.budgetBytes,
    cacheBytesAfterEvict: continuity.renderAheadCache.bytesAfterEvict,
    latencyOwners: { ...latencyOwners },
    callbackRule: continuity.continuity.callbackRule,
    schedulerState: 'reference-only',
    reasons: [
      'latency_budget_summary_derived_from_reference_reports',
      'cpu_float64_reference_only_no_runtime_scheduler',
      'callback_reads_committed_output_only',
      'production_latency_compensation_deferred_to_realtime_gate',
    ],
  };
};

const compactCallbackSafeControlCaseReport = (
  result: UzumeReferenceCallbackSafeControlResult,
): UzumeCompiledReferencePlan['callbackSafeControls']['urgentControl'] => ({
  control: result.control,
  classification: result.classification,
  generationState: result.generationState,
  state: result.state,
  callbackRule: result.callbackRule,
  renderCacheAction: result.renderCacheAction,
  generationAfterControl: result.generationAfterControl,
  requiresRenderGraphRebuild: result.requiresRenderGraphRebuild,
  commitAllowed: result.commitAllowed,
  gainEnvelopeFrames: result.gainEnvelope.length,
  declick: result.declick,
  peak: result.peak,
  reasons: result.reasons,
});

const buildCallbackSafeControlsInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['callbackSafeControls'] => {
  const channelCount = Math.max(1, Math.min(2, Math.round(input.probe?.channels ?? 2) || 2));
  const committedBlock = createPcmOutputQuantizationReferenceChannels(channelCount);
  const urgentControl = renderUzumeCallbackSafeControlReference({
    generationId: 1,
    control: 'mute',
    committedBlock,
    currentGain: 1,
    mute: true,
    declickFrames: Math.min(4, committedBlock[0]?.length ?? 4),
  });
  const renderStateBoundary = renderUzumeCallbackSafeControlReference({
    generationId: 1,
    control: 'seek',
    committedBlock,
  });

  return {
    artifact: urgentControl.artifact,
    policy: urgentControl.policy,
    urgentControl: compactCallbackSafeControlCaseReport(urgentControl),
    renderStateBoundary: compactCallbackSafeControlCaseReport(renderStateBoundary),
  };
};

const compactEqualPowerCrossfadeCaseReport = (
  result: UzumeReferenceEqualPowerCrossfadeResult,
  reasons: string[],
): UzumeCompiledReferencePlan['equalPowerCrossfade']['rendered'] => ({
  intent: result.intent,
  sampleRate: result.sampleRate,
  fadeFrames: result.fadeFrames,
  durationMs: result.durationMs,
  state: result.state,
  rejectionReason: result.rejectionReason,
  gainLaw: result.gainLaw,
  residualVsHardSwitch: result.residualVsHardSwitch,
  peak: result.peak,
  reasons,
});

const buildEqualPowerCrossfadeInspectReport = (
  input: UzumeReferenceCompileInput,
  resampling: UzumeReferenceResamplingReport,
): UzumeCompiledReferencePlan['equalPowerCrossfade'] => {
  const sampleRate =
    normalizeRate(resampling.targetRate) ??
    normalizeRate(input.sampleRatePlan?.requestedOutputSampleRate) ??
    normalizeRate(input.probe?.fileSampleRate) ??
    48000;
  const shortBridge = [[1, 0.75, 0.5, 0.25, 0]];
  const fullProfile = [[0, 0.25, 0.5, 0.75, 1]];
  const rendered = renderUzumeEqualPowerCrossfadeReference({
    intent: 'user-random-seek-or-skip',
    sampleRate,
    fadeFrames: 5,
    fullProfileReady: true,
    shortBridge,
    fullProfile,
  });
  const rejectedBoundary = renderUzumeEqualPowerCrossfadeReference({
    intent: 'gapless-boundary',
    sampleRate,
    fadeFrames: 5,
    fullProfileReady: true,
    shortBridge,
    fullProfile,
  });

  return {
    artifact: rendered.artifact,
    policy: rendered.policy,
    rendered: compactEqualPowerCrossfadeCaseReport(rendered, [
      'random_access_short_bridge_requires_equal_power_crossfade',
      'full_profile_ready',
      'equal_power_gain_law_reference',
      'hard_switch_residual_measured',
    ]),
    rejectedBoundary: compactEqualPowerCrossfadeCaseReport(rejectedBoundary, [
      'only_user_random_seek_or_skip_can_use_short_bridge_crossfade',
      'gapless_boundary_waits_for_full_profile',
      'equal_power_crossfade_reference_only',
    ]),
  };
};

export const compileUzumeReferencePlan = (input: UzumeReferenceCompileInput): UzumeCompiledReferencePlan => {
  const format = buildFormatPlanner(input);
  const outputDevicePolicy = buildOutputDevicePolicyInspectReport(input, format);
  const backendSupport = buildBackendSupportInspectReport(format, outputDevicePolicy);
  const resampling = buildResamplingReport(input);
  const sharedConvolution = buildSharedConvolutionReport(input, resampling);
  const pcmOutputQuantization = buildPcmOutputQuantizationReport(input, format);
  const pcmIngressGuard = buildPcmIngressGuardReport(input);
  const gainStaging = buildGainStagingReport(input);
  const iirEq = buildIirEqInspectReport(input);
  const channelScope = buildChannelScopeInspectReport(input);
  const stereoProcedural = buildStereoProceduralInspectReport(input);
  const perEarEqPlacement = buildPerEarEqPlacementInspectReport(input);
  const gaplessConcat = buildGaplessConcatInspectReport(input, resampling);
  const firGaplessHistory = buildFirGaplessHistoryInspectReport(input, resampling, sharedConvolution);
  const blockBoundary = buildBlockBoundaryInspectReport(input);
  const flushDrain = buildFlushDrainInspectReport(input);
  const compiler = buildCompilerAssignments(input, format, resampling, sharedConvolution, pcmOutputQuantization);
  const continuity = buildContinuityInspectReport(input, resampling, sharedConvolution);
  const latencyBudget = buildLatencyBudgetInspectReport(backendSupport, resampling, sharedConvolution, continuity, compiler.latencyOwners);
  const callbackSafeControls = buildCallbackSafeControlsInspectReport(input);
  const equalPowerCrossfade = buildEqualPowerCrossfadeInspectReport(input, resampling);
  const dsdFamily = buildDsdFamilyReport(input, format);

  return {
    schemaVersion: 1,
    telemetrySchemaVersion: 2,
    ...format,
    backendSupport,
    outputDevicePolicy,
    latencyBudget,
    ...compiler,
    resampling,
    sharedConvolution,
    continuity,
    callbackSafeControls,
    equalPowerCrossfade,
    dsdFamily,
    pcmOutputQuantization,
    pcmIngressGuard,
    gainStaging,
    iirEq,
    channelScope,
    stereoProcedural,
    perEarEqPlacement,
    gaplessConcat,
    firGaplessHistory,
    blockBoundary,
    flushDrain,
    artifactPlan: {
      impulse: 'deterministic-reference',
      sweep: 'deterministic-reference',
      logSweep: 'deterministic-reference',
      nearNyquist: 'deterministic-reference',
      multiTone: 'deterministic-reference',
      random: 'deterministic-reference',
      silence: 'deterministic-reference',
      phaseGroupDelay: 'deterministic-reference',
      phaseMode: 'deterministic-reference',
      apodizing: 'deterministic-reference',
      aliasRejection: 'deterministic-reference',
      realtimeBudget: 'deterministic-reference',
      nullResidual: 'deterministic-reference',
      formalValidation: 'deterministic-reference',
      dsdFamilyPath: dsdFamily ? 'deterministic-reference' : 'not-applicable',
      backendSupport: 'deterministic-reference',
      outputDevicePolicy: 'deterministic-reference',
      latencyBudget: 'deterministic-reference',
      qualityRollback: 'deterministic-reference',
      outputResamplingRisk: 'deterministic-reference',
      pcmOutputQuantization: 'deterministic-reference',
      pcmIngressGuard: 'deterministic-reference',
      gainStaging: 'deterministic-reference',
      iirEq: 'deterministic-reference',
      channelScope: 'deterministic-reference',
      stereoProcedural: 'deterministic-reference',
      perEarEqPlacement: 'deterministic-reference',
      sharedConvolutionDuplicateGuard: 'deterministic-reference',
      sharedConvolutionSerialNull: 'deterministic-reference',
      gaplessConcat: 'deterministic-reference',
      firGaplessHistory: 'deterministic-reference',
      callbackSafeControls: 'deterministic-reference',
      equalPowerCrossfade: 'deterministic-reference',
      blockBoundary: 'deterministic-reference',
      flushDrain: 'deterministic-reference',
    },
  };
};

const cloneChannels = (channels: ReadonlyArray<ReadonlyArray<number>>): number[][] => {
  const length = channels[0]?.length ?? 0;
  return channels.map((channel) => {
    if (channel.length !== length) {
      throw new Error('uzume_reference_requires_rectangular_channels');
    }

    return Array.from(channel, (sample) => Number.isFinite(sample) ? sample : 0);
  });
};

const measure = (channels: ReadonlyArray<ReadonlyArray<number>>): UzumeReferenceStageMeter => {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;

  for (const channel of channels) {
    for (const sample of channel) {
      const sanitized = Number.isFinite(sample) ? sample : 0;
      peak = Math.max(peak, Math.abs(sanitized));
      sumSquares += sanitized * sanitized;
      count += 1;
    }
  }

  return {
    peak,
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
  };
};

const amplitudeToDb = (value: number): number =>
  value > 0 ? 20 * Math.log10(value) : -120;

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

const estimateTruePeak = (channels: ReadonlyArray<ReadonlyArray<number>>): {
  truePeak: number;
  truePeakOverCount: number;
} => {
  let truePeak = 0;
  let truePeakOverCount = 0;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Number.isFinite(channel[i]) ? channel[i] : 0;
      const abs = Math.abs(sample);
      truePeak = Math.max(truePeak, abs);
      if (abs > 1) {
        truePeakOverCount += 1;
      }

      if (i > 0) {
        const previous = Number.isFinite(channel[i - 1]) ? channel[i - 1] : 0;
        const midpoint = (previous + sample) * 0.5;
        const midpointAbs = Math.abs(midpoint);
        truePeak = Math.max(truePeak, midpointAbs);
        if (midpointAbs > 1) {
          truePeakOverCount += 1;
        }
      }
    }
  }

  return { truePeak, truePeakOverCount };
};

const countSampleClips = (channels: ReadonlyArray<ReadonlyArray<number>>): number => {
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      if (Math.abs(Number.isFinite(sample) ? sample : 0) > 1) {
        count += 1;
      }
    }
  }

  return count;
};

const buildSafetyStage = (
  id: UzumeReferenceSafetyStageId,
  channels: ReadonlyArray<ReadonlyArray<number>>,
  inputPeakDbfs: number,
): UzumeReferenceSafetyStage => {
  const meter = measure(channels);
  const truePeak = estimateTruePeak(channels);
  const peakDbfs = amplitudeToDb(meter.peak);
  const rmsDbfs = amplitudeToDb(meter.rms);

  return {
    id,
    ...meter,
    peakDbfs,
    rmsDbfs,
    truePeak: truePeak.truePeak,
    truePeakDbtp: amplitudeToDb(truePeak.truePeak),
    sampleClipCount: countSampleClips(channels),
    truePeakOverCount: truePeak.truePeakOverCount,
    peakExpansionDb: roundTenth(peakDbfs - inputPeakDbfs),
  };
};

const maxStageBy = (
  stages: readonly UzumeReferenceSafetyStage[],
  pick: (stage: UzumeReferenceSafetyStage) => number,
): UzumeReferenceSafetyStage | null =>
  stages.reduce<UzumeReferenceSafetyStage | null>((best, stage) =>
    !best || pick(stage) > pick(best) ? stage : best, null);

const buildHeadroomRecommendation = (
  stages: readonly UzumeReferenceSafetyStage[],
  currentHeadroomDb: number,
  limiter: UzumeReferenceLimiterReport,
): UzumeReferenceHeadroomRecommendation => {
  const inputStage = stages.find((stage) => stage.id === 'input');
  const preLimiter = stages.find((stage) => stage.id === 'pre-limiter');
  const targetSafetyMarginDb = 1;
  const recoveryMarginDb = 1;
  const predictedDspBoostDb = Math.max(0, (preLimiter?.peakDbfs ?? -120) - (inputStage?.peakDbfs ?? -120));
  const livePreLimiterTruePeakOverDb = Math.max(0, preLimiter?.truePeakDbtp ?? -120);
  const limiterReductionDb = limiter.active ? Math.abs(limiter.maxGainReductionDb) : 0;
  const candidates = [
    {
      reason: 'profile_preflight_gain' as const,
      requiredDb: predictedDspBoostDb,
      sourceStage: preLimiter?.id ?? null,
    },
    {
      reason: 'post_dsp_true_peak' as const,
      requiredDb: livePreLimiterTruePeakOverDb > 0 ? livePreLimiterTruePeakOverDb + targetSafetyMarginDb : 0,
      sourceStage: preLimiter?.id ?? null,
    },
    {
      reason: 'limiter_reduction' as const,
      requiredDb: limiterReductionDb > 0 ? limiterReductionDb + recoveryMarginDb : 0,
      sourceStage: limiter.active ? 'post-limiter' as const : null,
    },
  ];
  const strongest = candidates.reduce((best, candidate) =>
    candidate.requiredDb > best.requiredDb ? candidate : best, candidates[0]);
  const recommendedDb = strongest.requiredDb > 0
    ? Math.min(currentHeadroomDb, -roundTenth(strongest.requiredDb))
    : currentHeadroomDb;

  return {
    currentDb: roundTenth(currentHeadroomDb),
    recommendedDb,
    missingDb: roundTenth(Math.max(0, currentHeadroomDb - recommendedDb)),
    reason: strongest.requiredDb > 0 ? strongest.reason : 'sufficient',
    sourceStage: strongest.requiredDb > 0 ? strongest.sourceStage : null,
    confidence: 'measured',
    targetSafetyMarginDb,
    autoHeadroomEnabled: false,
  };
};

const buildSafetyMeterReport = (
  stages: readonly UzumeReferenceSafetyStage[],
  limiter: UzumeReferenceLimiterReport,
): UzumeReferenceSafetyMeterReport => {
  const maxPeakStage = maxStageBy(stages, (stage) => stage.peakDbfs);
  const maxTruePeakStage = maxStageBy(stages, (stage) => stage.truePeakDbtp);
  const sampleClipCount = stages.reduce((sum, stage) => sum + stage.sampleClipCount, 0);
  const truePeakOverCount = stages.reduce((sum, stage) => sum + stage.truePeakOverCount, 0);
  const maxTruePeakDbtp = maxTruePeakStage?.truePeakDbtp ?? -120;
  const state = limiter.active
    ? 'limiting'
    : sampleClipCount > 0 || truePeakOverCount > 0
      ? 'over'
      : maxTruePeakDbtp > -1
        ? 'near-limit'
        : 'safe';

  return {
    state,
    stages: stages.map((stage) => ({ ...stage })),
    maxSamplePeakDbfs: maxPeakStage?.peakDbfs ?? -120,
    maxTruePeakDbtp,
    sampleClipCount,
    truePeakOverCount,
    stageOfMaxPeak: maxPeakStage?.id ?? null,
    stageOfMaxTruePeak: maxTruePeakStage?.id ?? null,
    historyWindowSeconds: 0,
  };
};

const maxAbs = (samples: ReadonlyArray<number>): number =>
  samples.reduce((peak, sample) => Math.max(peak, Math.abs(Number.isFinite(sample) ? sample : 0)), 0);

const energy = (samples: ReadonlyArray<number>): number =>
  samples.reduce((sum, sample) => {
    const sanitized = Number.isFinite(sample) ? sample : 0;
    return sum + sanitized * sanitized;
  }, 0);

const rmsError = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): number => {
  const length = Math.min(left.length, right.length);
  if (length <= 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = (Number.isFinite(left[i]) ? left[i] : 0) - (Number.isFinite(right[i]) ? right[i] : 0);
    sumSquares += diff * diff;
  }

  return Math.sqrt(sumSquares / length);
};

const maxAbsDiff = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): number => {
  const length = Math.min(left.length, right.length);
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = (Number.isFinite(left[i]) ? left[i] : 0) - (Number.isFinite(right[i]) ? right[i] : 0);
    peak = Math.max(peak, Math.abs(diff));
  }

  return peak;
};

const flattenChannels = (channels: ReadonlyArray<ReadonlyArray<number>>): number[] => {
  const flattened: number[] = [];
  const length = channels[0]?.length ?? 0;
  for (let frame = 0; frame < length; frame += 1) {
    for (const channel of channels) {
      flattened.push(Number.isFinite(channel[frame]) ? channel[frame] : 0);
    }
  }

  return flattened;
};

export const analyzeUzumePcmIngressGuardReference = (
  input: UzumeReferencePcmIngressGuardInput,
): UzumeReferencePcmIngressGuardResult => {
  const expectedChannels = input.expectedChannels == null
    ? null
    : Math.max(1, Math.round(input.expectedChannels));
  const denormalThreshold = Number.isFinite(input.denormalThreshold) && input.denormalThreshold !== undefined
    ? Math.max(0, input.denormalThreshold)
    : 1e-300;
  const channelCount = input.channels.length;
  const frameCount = input.channels.reduce((length, channel) => Math.max(length, channel.length), 0);
  const rectangular = input.channels.every((channel) => channel.length === frameCount) &&
    (expectedChannels === null || expectedChannels === channelCount);
  let nonFiniteReplaced = 0;
  let denormalZeroed = 0;
  let channelMismatchCount = expectedChannels !== null && expectedChannels !== channelCount ? 1 : 0;
  let silenceFrames = 0;

  const sanitizedChannels = Array.from({ length: channelCount }, (_, channelIndex) => {
    const channel = input.channels[channelIndex] ?? [];
    if (channel.length !== frameCount) {
      channelMismatchCount += 1;
    }

    return Array.from({ length: frameCount }, (_, frame) => {
      const raw = channel[frame] ?? 0;
      if (!Number.isFinite(raw)) {
        nonFiniteReplaced += 1;
        return 0;
      }
      if (raw !== 0 && Math.abs(raw) <= denormalThreshold) {
        denormalZeroed += 1;
        return 0;
      }

      return raw;
    });
  });

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (sanitizedChannels.every((channel) => Math.abs(channel[frame] ?? 0) <= 1e-12)) {
      silenceFrames += 1;
    }
  }

  const peak = maxAbs(flattenChannels(sanitizedChannels));
  const reasons: string[] = [];
  if (!rectangular) {
    reasons.push('channel_layout_or_frame_count_mismatch');
  }
  if (nonFiniteReplaced > 0) {
    reasons.push('non_finite_samples_replaced_with_zero');
  }
  if (denormalZeroed > 0) {
    reasons.push('denormal_samples_zeroed');
  }
  if (frameCount > 0 && silenceFrames === frameCount) {
    reasons.push('silence_preserved_as_zero');
  }

  return {
    artifact: 'pcm-ingress-guard-reference',
    state: !rectangular
      ? 'channel-mismatch'
      : nonFiniteReplaced > 0 || denormalZeroed > 0
        ? 'sanitized'
        : frameCount > 0 && silenceFrames === frameCount ? 'silence' : 'ok',
    expectedChannels,
    channelCount,
    frameCount,
    rectangular,
    sanitizedChannels,
    counts: {
      nonFiniteReplaced,
      denormalZeroed,
      channelMismatchCount,
      silenceFrames,
    },
    peak,
    reasons,
  };
};

const buildPcmIngressGuardReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['pcmIngressGuard'] => {
  const result = analyzeUzumePcmIngressGuardReference({
    channels: createPcmOutputQuantizationReferenceChannels(input.probe?.channels ?? 2),
    expectedChannels: input.probe?.channels ?? null,
    denormalThreshold: 1e-12,
  });

  return {
    artifact: result.artifact,
    state: result.state,
    expectedChannels: result.expectedChannels,
    channelCount: result.channelCount,
    frameCount: result.frameCount,
    rectangular: result.rectangular,
    counts: result.counts,
    peak: result.peak,
    reasons: result.reasons.length ? result.reasons : ['pcm_ingress_ready_for_reference_processing'],
  };
};

const concatenateChannelBlocks = (blocks: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>): number[][] => {
  const channelCount = blocks[0]?.length ?? 0;
  const output = Array.from({ length: channelCount }, () => [] as number[]);

  for (const block of blocks) {
    if (block.length !== channelCount) {
      throw new Error('uzume_gapless_reference_requires_matching_channel_count');
    }
    const rectangular = cloneChannels(block);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      output[channelIndex].push(...rectangular[channelIndex]);
    }
  }

  return output;
};

const analyzeFrequencyResponse = (
  samples: ReadonlyArray<number>,
  sourceRate: number,
  targetRate: number,
  contract: UzumeReferenceResamplingFilterContract,
): Pick<
  UzumeReferenceResamplingArtifactMetrics,
  'passbandRippleDb' | 'cutoffRatioEstimate' | 'transitionWidthRatioEstimate' | 'stopbandAttenuationDb'
> => {
  if (!samples.length || contract.tapCount <= 0) {
    return {
      passbandRippleDb: 0,
      cutoffRatioEstimate: 1,
      transitionWidthRatioEstimate: 0,
      stopbandAttenuationDb: 0,
    };
  }

  const fftLength = nextPowerOfTwo(Math.max(64, samples.length * 2));
  const magnitudes: number[] = [];
  for (let bin = 0; bin <= fftLength / 2; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const angle = (-2 * Math.PI * bin * index) / fftLength;
      const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
      real += sample * Math.cos(angle);
      imaginary += sample * Math.sin(angle);
    }
    magnitudes.push(Math.sqrt(real * real + imaginary * imaginary));
  }

  const targetNyquistRatio = Math.min(1, sourceRate / targetRate) * contract.cutoffRatio;
  const passbandEnd = Math.max(0.01, targetNyquistRatio * 0.8);
  const stopbandStart = Math.min(1, targetNyquistRatio + contract.transitionWidthRatio);
  const passband = magnitudes.filter((_, index) => index / (magnitudes.length - 1) <= passbandEnd);
  const stopband = magnitudes.filter((_, index) => index / (magnitudes.length - 1) >= stopbandStart);
  const passbandMax = Math.max(...passband, 1e-12);
  const passbandMin = Math.max(Math.min(...passband.filter((value) => value > 1e-12)), 1e-12);
  const stopbandMax = Math.max(...stopband, 1e-12);
  const threshold = passbandMax / Math.SQRT2;
  const cutoffBin = magnitudes.findIndex((value, index) =>
    index > 0 && index / (magnitudes.length - 1) >= passbandEnd && value <= threshold);
  const stopbandThreshold = passbandMax * 0.01;
  const stopbandBin = magnitudes.findIndex((value, index) =>
    index > 0 && index / (magnitudes.length - 1) >= passbandEnd && value <= stopbandThreshold);
  const cutoffRatioEstimate = cutoffBin >= 0 ? cutoffBin / (magnitudes.length - 1) : null;
  const transitionWidthRatioEstimate = cutoffRatioEstimate !== null && stopbandBin >= 0
    ? Math.max(0, stopbandBin / (magnitudes.length - 1) - cutoffRatioEstimate)
    : null;

  return {
    passbandRippleDb: 20 * Math.log10(passbandMax / passbandMin),
    cutoffRatioEstimate,
    transitionWidthRatioEstimate,
    stopbandAttenuationDb: Math.max(0, -20 * Math.log10(stopbandMax / passbandMax)),
  };
};

const phaseSpread = (samples: ReadonlyArray<number>): { peakIndex: number | null; spreadSamples: number | null } => {
  let peak = 0;
  let peakIndex: number | null = null;
  let totalEnergy = 0;
  let weightedIndex = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sanitized = Number.isFinite(samples[index]) ? samples[index] : 0;
    const sampleEnergy = sanitized * sanitized;
    totalEnergy += sampleEnergy;
    weightedIndex += index * sampleEnergy;
    if (Math.abs(sanitized) > peak) {
      peak = Math.abs(sanitized);
      peakIndex = index;
    }
  }

  if (totalEnergy <= 0) {
    return { peakIndex, spreadSamples: null };
  }

  const center = weightedIndex / totalEnergy;
  let variance = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sanitized = Number.isFinite(samples[index]) ? samples[index] : 0;
    variance += ((index - center) ** 2) * sanitized * sanitized;
  }

  return {
    peakIndex,
    spreadSamples: Math.sqrt(variance / totalEnergy),
  };
};

const splitRingingEnergy = (
  samples: ReadonlyArray<number>,
  peakIndex: number | null,
): { preRingingEnergy: number; postRingingEnergy: number } => {
  if (peakIndex === null) {
    return { preRingingEnergy: 0, postRingingEnergy: 0 };
  }

  return {
    preRingingEnergy: energy(samples.slice(0, peakIndex)),
    postRingingEnergy: energy(samples.slice(peakIndex + 1)),
  };
};

const shiftSamplesEarlier = (samples: ReadonlyArray<number>, shift: number): number[] => {
  const safeShift = Math.max(0, Math.round(shift));
  return Array.from({ length: samples.length }, (_, index) => {
    const sourceIndex = index + safeShift;
    return sourceIndex < samples.length && Number.isFinite(samples[sourceIndex]) ? samples[sourceIndex] : 0;
  });
};

const scaleToPeak = (samples: number[], targetPeak: number): number[] => {
  const peak = maxAbs(samples);
  if (peak <= 1e-12 || targetPeak <= 1e-12) {
    return samples;
  }

  const gain = targetPeak / peak;
  return samples.map((sample) => sample * gain);
};

const shapePhaseModeImpulse = (
  linear: ReadonlyArray<number>,
  mode: UzumeReferenceResamplingReport['phaseMode'],
): number[] => {
  if (mode === 'linear') {
    return linear.map((sample) => (Number.isFinite(sample) ? sample : 0));
  }

  const linearPhase = phaseSpread(linear);
  const peakIndex = linearPhase.peakIndex ?? Math.floor(linear.length / 2);
  const targetPeak = maxAbs(linear);
  const shift = mode === 'minimum'
    ? Math.max(1, Math.floor(peakIndex * 0.72))
    : Math.max(1, Math.floor(peakIndex * 0.36));
  const shifted = shiftSamplesEarlier(linear, shift);

  if (mode === 'intermediate') {
    return scaleToPeak(shifted.map((sample, index) =>
      sample * 0.7 + (Number.isFinite(linear[index]) ? linear[index] : 0) * 0.3), targetPeak);
  }

  const causal = shifted.slice();
  for (let index = 1; index < causal.length; index += 1) {
    causal[index] += causal[index - 1] * 0.14;
  }

  return scaleToPeak(causal, targetPeak);
};

const buildPhaseArtifact = (
  linear: ReadonlyArray<number>,
  mode: UzumeReferenceResamplingReport['phaseMode'],
): UzumeReferenceResamplingReport['phaseModeArtifacts']['modes'][number] => {
  const response = shapePhaseModeImpulse(linear, mode);
  const spread = phaseSpread(response);
  const ringing = splitRingingEnergy(response, spread.peakIndex);

  return {
    mode,
    impulsePeakIndex: spread.peakIndex,
    groupDelaySamples: spread.peakIndex ?? 0,
    groupDelaySpreadSamples: spread.spreadSamples,
    ...ringing,
    residualVsLinearMaxAbs: mode === 'linear' ? 0 : maxAbsDiff(linear, response),
    residualVsLinearRms: mode === 'linear' ? 0 : rmsError(linear, response),
  };
};

const resampleChannelWindowedSinc = (
  channel: ReadonlyArray<number>,
  sourceRate: number,
  targetRate: number,
  contract: UzumeReferenceResamplingFilterContract,
  windowMode: 'blackman' | 'rectangular' = 'blackman',
): number[] => {
  const ratio = targetRate / sourceRate;
  const outputLength = Math.max(1, Math.round(channel.length * ratio));
  const output = new Array<number>(outputLength);
  const halfTaps = Math.floor(contract.tapCount / 2);
  const nyquistScale = Math.min(1, targetRate / sourceRate);
  const cutoffCycles = 0.5 * nyquistScale * contract.cutoffRatio;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = outputIndex / ratio;
    const center = Math.floor(sourcePosition);
    let sum = 0;
    let weightSum = 0;

    for (let tap = 0; tap < contract.tapCount; tap += 1) {
      const sourceIndex = center + tap - halfTaps + 1;
      if (sourceIndex < 0 || sourceIndex >= channel.length) {
        continue;
      }

      const distance = sourcePosition - sourceIndex;
      const window = windowMode === 'blackman' ? blackmanWindow(tap, contract.tapCount) : 1;
      const weight = 2 * cutoffCycles * sinc(2 * cutoffCycles * distance) * window;
      const sample = Number.isFinite(channel[sourceIndex]) ? channel[sourceIndex] : 0;
      sum += sample * weight;
      weightSum += weight;
    }

    output[outputIndex] = Math.abs(weightSum) > 1e-12 ? sum / weightSum : 0;
  }

  return output;
};

const resampleChannelLinearReference = (
  channel: ReadonlyArray<number>,
  sourceRate: number,
  targetRate: number,
): number[] => {
  if (sourceRate === targetRate) {
    return channel.map((sample) => (Number.isFinite(sample) ? sample : 0));
  }

  const ratio = targetRate / sourceRate;
  const outputLength = Math.max(1, Math.round(channel.length * ratio));
  return Array.from({ length: outputLength }, (_, outputIndex) => {
    const sourcePosition = outputIndex / ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(channel.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const left = Number.isFinite(channel[leftIndex]) ? channel[leftIndex] : 0;
    const right = Number.isFinite(channel[rightIndex]) ? channel[rightIndex] : left;
    return left + (right - left) * fraction;
  });
};

export const renderUzumeResamplingReference = (input: UzumeReferenceResampleInput): UzumeReferenceResampleResult => {
  const sourceRate = normalizeRate(input.sourceRate);
  const targetRate = normalizeRate(input.targetRate);
  if (!sourceRate || !targetRate) {
    throw new Error('uzume_reference_resampler_requires_positive_rates');
  }

  const channels = cloneChannels(input.channels);
  const inputMeter = measure(channels);
  const sameRateBypass = sourceRate === targetRate;
  const ratio = targetRate / sourceRate;
  const filterContract = buildResamplingFilterContract(sourceRate, targetRate, input);
  const outputChannels = sameRateBypass
    ? channels.map((channel) => channel.slice())
    : channels.map((channel) => resampleChannelWindowedSinc(channel, sourceRate, targetRate, filterContract));
  const generatedFrames = outputChannels[0]?.length ?? 0;
  const phaseResidual = sameRateBypass || generatedFrames === 0
    ? 0
    : ((generatedFrames - 1) / ratio) % 1;
  const delay = sameRateBypass ? 0 : Math.ceil((filterContract.tapCount / 2) * Math.max(1, ratio));
  const delayMs = samplesToMilliseconds(delay, targetRate) ?? 0;

  return {
    channels: outputChannels,
    telemetry: {
      input: inputMeter,
      output: measure(outputChannels),
      generatedFrames,
      sameRateBypass,
      ratio,
      phaseStep: sourceRate / targetRate,
      phaseResidual,
      phaseAccumulator: sameRateBypass ? 'same-rate-bypass' : 'rational-fixed-step',
      groupDelaySamples: delay,
      groupDelayMs: delayMs,
      lookaheadSamples: delay,
      lookaheadMs: delayMs,
      sourceFamily: sampleRateFamily(sourceRate),
      targetFamily: sampleRateFamily(targetRate),
      filterContract,
    },
  };
};

export const renderUzumeResponseResampleReference = (
  input: UzumeReferenceResponseResampleInput,
): UzumeReferenceResponseResampleResult => {
  const sourceRate = normalizeRate(input.sourceRate);
  const targetRate = normalizeRate(input.targetRate);
  if (!sourceRate || !targetRate) {
    throw new Error('uzume_response_resample_reference_requires_positive_rates');
  }

  const responses = cloneChannels(input.responses);
  const rendered = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: responses,
    tapCount: input.tapCount,
    phaseCount: input.phaseCount,
    cutoffRatio: input.cutoffRatio,
  });
  const linearBaseline = responses.map((response) =>
    resampleChannelLinearReference(response, sourceRate, targetRate));
  const renderedFlat = flattenChannels(rendered.channels);
  const linearFlat = flattenChannels(linearBaseline);
  const residualMaxAbs = maxAbsDiff(renderedFlat, linearFlat);
  const sameRateBypass = sourceRate === targetRate;

  return {
    artifact: 'high-precision-response-resample-reference',
    sourceId: input.sourceId,
    kind: input.kind,
    sourceRate,
    targetRate,
    sourceFamily: sampleRateFamily(sourceRate),
    targetFamily: sampleRateFamily(targetRate),
    engine: 'windowed-sinc-float64-reference',
    sameRateBypass,
    linearInterpolationRejected: !sameRateBypass,
    filterContract: rendered.telemetry.filterContract,
    channels: rendered.channels,
    linearBaseline,
    residualVsLinear: {
      state: sameRateBypass
        ? 'same-rate-bypass'
        : residualMaxAbs > 1e-12 ? 'measured-difference' : 'linear-matches-for-input',
      comparedFrames: Math.min(rendered.channels[0]?.length ?? 0, linearBaseline[0]?.length ?? 0),
      maxAbs: residualMaxAbs,
      rms: rmsError(renderedFlat, linearFlat),
    },
  };
};

export const createUzumeResamplingPhaseModeReferenceArtifacts = (
  sourceRate: number,
  targetRate: number,
  length = 64,
  filterContract?: UzumeReferenceResamplingFilterContract,
): UzumeReferenceResamplingReport['phaseModeArtifacts'] => {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('uzume_phase_mode_reference_requires_positive_rates');
  }

  const safeLength = Math.max(8, Math.round(length));
  const impulseIndex = Math.floor(safeLength / 2);
  const impulse = Array.from({ length: safeLength }, (_, index) => (index === impulseIndex ? 1 : 0));
  const contract = filterContract ?? buildResamplingFilterContract(sourceRate, targetRate);
  const rendered = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [impulse],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const linear = rendered.channels[0] ?? [];

  return {
    artifact: 'poly-sinc-phase-mode-reference',
    phaseModesMeasured: ['linear', 'minimum', 'intermediate'],
    modes: [
      buildPhaseArtifact(linear, 'linear'),
      buildPhaseArtifact(linear, 'minimum'),
      buildPhaseArtifact(linear, 'intermediate'),
    ],
  };
};

export const createUzumeResamplingApodizingReferenceArtifact = (
  sourceRate: number,
  targetRate: number,
  length = 64,
  filterContract?: UzumeReferenceResamplingFilterContract,
): UzumeReferenceResamplingReport['apodizingArtifact'] => {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('uzume_apodizing_reference_requires_positive_rates');
  }

  const safeLength = Math.max(8, Math.round(length));
  const impulseIndex = Math.floor(safeLength / 2);
  const impulse = Array.from({ length: safeLength }, (_, index) => (index === impulseIndex ? 1 : 0));
  const contract = filterContract ?? buildResamplingFilterContract(sourceRate, targetRate);
  const sameRateBypass = sourceRate === targetRate;
  const apodized = sameRateBypass
    ? impulse.slice()
    : resampleChannelWindowedSinc(impulse, sourceRate, targetRate, contract, 'blackman');
  const rectangular = sameRateBypass
    ? impulse.slice()
    : resampleChannelWindowedSinc(impulse, sourceRate, targetRate, contract, 'rectangular');
  const apodizedSpread = phaseSpread(apodized);
  const rectangularSpread = phaseSpread(rectangular);
  const apodizedRinging = splitRingingEnergy(apodized, apodizedSpread.peakIndex);
  const rectangularRinging = splitRingingEnergy(rectangular, rectangularSpread.peakIndex);
  const apodizedRingingEnergy = apodizedRinging.preRingingEnergy + apodizedRinging.postRingingEnergy;
  const baselineRingingEnergy = rectangularRinging.preRingingEnergy + rectangularRinging.postRingingEnergy;

  return {
    artifact: 'poly-sinc-apodizing-response-reference',
    mode: 'reference-windowed-sinc',
    baseline: 'rectangular-sinc-reference',
    state: sameRateBypass ? 'same-rate-bypass' : 'apodizing-changes-ringing-response',
    highFrequencyRestorationClaim: false,
    apodizedRingingEnergy,
    baselineRingingEnergy,
    ringingReductionDb: baselineRingingEnergy > 0 && apodizedRingingEnergy > 0
      ? 10 * Math.log10(baselineRingingEnergy / apodizedRingingEnergy)
      : null,
    responseResidualMaxAbs: maxAbsDiff(apodized, rectangular),
    responseResidualRms: rmsError(apodized, rectangular),
  };
};

export const planUzumeResamplingQualityRollbackReference = (
  active: boolean,
  filterContract: UzumeReferenceResamplingFilterContract,
  realtimeBudget: UzumeReferenceResamplingArtifactMetrics['realtimeBudget'],
  estimatedMultiplyAddsMax = 20000,
): UzumeReferenceResamplingReport['qualityRollback'] => {
  const primaryProfile: UzumeReferenceResamplingReport['qualityRollback']['primaryProfile'] = {
    id: 'poly-sinc-reference-linear-full',
    family: 'poly-sinc-reference',
    phaseMode: 'linear',
    apodizing: 'reference-windowed-sinc',
    tapCount: filterContract.tapCount,
    stopbandAttenuationDb: filterContract.stopbandAttenuationDb,
    latencyClass: 'full',
    shortBridgeOnlyFor: null,
  };
  const rollbackChain: UzumeReferenceResamplingReport['qualityRollback']['rollbackChain'] = [
    {
      id: 'poly-sinc-reference-linear-balanced',
      family: 'poly-sinc-reference',
      phaseMode: 'linear',
      apodizing: 'reference-windowed-sinc',
      tapCount: Math.max(16, Math.min(48, filterContract.tapCount || 48)),
      stopbandAttenuationDb: 84,
      latencyClass: 'balanced',
      shortBridgeOnlyFor: null,
    },
    {
      id: 'poly-sinc-reference-linear-short',
      family: 'poly-sinc-reference',
      phaseMode: 'linear',
      apodizing: 'reference-windowed-sinc',
      tapCount: Math.max(8, Math.min(32, filterContract.tapCount || 32)),
      stopbandAttenuationDb: 72,
      latencyClass: 'balanced',
      shortBridgeOnlyFor: null,
    },
  ];

  return {
    artifact: 'poly-sinc-quality-rollback-reference',
    state: !active
      ? 'not-applicable'
      : realtimeBudget.estimatedMultiplyAdds > estimatedMultiplyAddsMax ? 'armed' : 'standby',
    reason: !active
      ? 'same-rate-bypass'
      : realtimeBudget.estimatedMultiplyAdds > estimatedMultiplyAddsMax ? 'realtime-budget-warning' : 'reference-profile-within-budget',
    primaryProfile,
    rollbackChain,
    familyLock: 'poly-sinc-reference-only',
    legacyFallbackAllowed: false,
    legacyFallbackSignalPath: 'UZUME bypass / legacy non-UZUME path',
    shortBridgeIsRollback: false,
  };
};

export const planUzumeOutputResamplingRiskReference = (
  input: UzumeReferenceOutputResamplingRiskInput,
): UzumeReferenceResamplingReport['outputResamplingRisk'] => {
  const plan = input.sampleRatePlan;
  const requestedOutputRate = normalizeRate(plan?.requestedOutputSampleRate);
  const actualDeviceRate = normalizeRate(plan?.actualDeviceSampleRate);
  const sharedDeviceRate = normalizeRate(plan?.sharedDeviceSampleRate);
  const currentResamplerEngine = input.currentResamplerEngine ?? null;
  let state: UzumeReferenceResamplingReport['outputResamplingRisk']['state'] = 'none';
  let reason: string | null = null;
  let recommendation: UzumeReferenceResamplingReport['outputResamplingRisk']['recommendation'] = 'none';

  if (input.active && currentResamplerEngine) {
    state = 'legacy-resampler-active';
    reason = `legacy_${currentResamplerEngine}_resampler_active_reference_only`;
    recommendation = 'show-legacy-resampler-as-non-uzume-risk';
  } else if (input.active && plan?.outputMode === 'shared') {
    state = 'shared-output-mixer-risk';
    reason = 'shared_output_mixer_reference_only';
    recommendation = 'prefer-exclusive-or-device-rate-match';
  } else if (
    input.active &&
    requestedOutputRate !== null &&
    actualDeviceRate !== null &&
    requestedOutputRate !== actualDeviceRate
  ) {
    state = 'device-rate-mismatch-risk';
    reason = 'actual_device_rate_mismatch_reference_only';
    recommendation = 'inspect-device-rate-mismatch';
  }

  return {
    artifact: 'output-double-resampling-risk-reference',
    state,
    reason,
    requestedOutputRate,
    actualDeviceRate,
    sharedDeviceRate,
    currentResamplerEngine,
    signalPathTone: state === 'none' ? 'good' : 'warning',
    recommendation,
  };
};

const applyGain = (channels: number[][], gain: number): void => {
  if (Math.abs(gain - 1) < 1e-12) {
    return;
  }

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] *= gain;
    }
  }
};

type Biquad = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

const createBiquad = (band: EqBand, sampleRate: number): Biquad | null => {
  if (band.enabled === false || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  const frequency = clamp(band.frequencyHz, 10, sampleRate / 2 - 1);
  const gainDb = Number.isFinite(band.gainDb) ? band.gainDb : 0;
  const q = clamp(Number.isFinite(band.q) ? band.q : 1, 0.1, 24);
  const type = band.filterType ?? 'peaking';
  if (Math.abs(gainDb) < 1e-9 && (type === 'peaking' || type === 'lowShelf' || type === 'highShelf')) {
    return null;
  }

  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const a = 10 ** (gainDb / 40);
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  if (type === 'lowPass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'highPass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'notch') {
    b0 = 1;
    b1 = -2 * cos;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === 'lowShelf') {
    const shelfAlpha = sin / 2 * Math.sqrt(2);
    b0 = a * ((a + 1) - (a - 1) * cos + 2 * Math.sqrt(a) * shelfAlpha);
    b1 = 2 * a * ((a - 1) - (a + 1) * cos);
    b2 = a * ((a + 1) - (a - 1) * cos - 2 * Math.sqrt(a) * shelfAlpha);
    a0 = (a + 1) + (a - 1) * cos + 2 * Math.sqrt(a) * shelfAlpha;
    a1 = -2 * ((a - 1) + (a + 1) * cos);
    a2 = (a + 1) + (a - 1) * cos - 2 * Math.sqrt(a) * shelfAlpha;
  } else if (type === 'highShelf') {
    const shelfAlpha = sin / 2 * Math.sqrt(2);
    b0 = a * ((a + 1) + (a - 1) * cos + 2 * Math.sqrt(a) * shelfAlpha);
    b1 = -2 * a * ((a - 1) + (a + 1) * cos);
    b2 = a * ((a + 1) + (a - 1) * cos - 2 * Math.sqrt(a) * shelfAlpha);
    a0 = (a + 1) - (a - 1) * cos + 2 * Math.sqrt(a) * shelfAlpha;
    a1 = 2 * ((a - 1) - (a + 1) * cos);
    a2 = (a + 1) - (a - 1) * cos - 2 * Math.sqrt(a) * shelfAlpha;
  } else {
    b0 = 1 + alpha * a;
    b1 = -2 * cos;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cos;
    a2 = 1 - alpha / a;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
};

const applyBiquad = (channel: number[], biquad: Biquad): void => {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < channel.length; i += 1) {
    const x0 = channel[i];
    const y0 = biquad.b0 * x0 + biquad.b1 * x1 + biquad.b2 * x2 - biquad.a1 * y1 - biquad.a2 * y2;
    channel[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = channel[i];
  }
};

const applyEq = (channels: number[][], bands: ReadonlyArray<EqBand>, sampleRate: number): void => {
  const biquads = bands
    .map((band) => createBiquad(band, sampleRate))
    .filter((biquad): biquad is Biquad => biquad !== null);

  for (const biquad of biquads) {
    for (const channel of channels) {
      applyBiquad(channel, biquad);
    }
  }
};

const responseFrequenciesForRate = (
  sampleRate: number,
  requested?: ReadonlyArray<number>,
): number[] => {
  const nyquist = sampleRate / 2;
  const candidates = requested ?? [20, 100, 1000, 5000, 10000, nyquist * 0.9];
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate) || candidate <= 0 || candidate >= nyquist) {
      continue;
    }
    const rounded = Math.round(candidate * 1000000) / 1000000;
    if (!seen.has(rounded)) {
      seen.add(rounded);
      normalized.push(rounded);
    }
  }

  return normalized.length > 0 ? normalized : [nyquist * 0.25];
};

const biquadResponseAt = (biquad: Biquad, sampleRate: number, frequencyHz: number): {
  magnitudeDb: number;
  phaseRadians: number;
} => {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const z1r = Math.cos(omega);
  const z1i = -Math.sin(omega);
  const z2r = Math.cos(2 * omega);
  const z2i = -Math.sin(2 * omega);
  const numeratorR = biquad.b0 + biquad.b1 * z1r + biquad.b2 * z2r;
  const numeratorI = biquad.b1 * z1i + biquad.b2 * z2i;
  const denominatorR = 1 + biquad.a1 * z1r + biquad.a2 * z2r;
  const denominatorI = biquad.a1 * z1i + biquad.a2 * z2i;
  const numeratorMagnitude = Math.hypot(numeratorR, numeratorI);
  const denominatorMagnitude = Math.max(Math.hypot(denominatorR, denominatorI), 1e-24);
  const magnitude = numeratorMagnitude / denominatorMagnitude;
  const phaseRadians = Math.atan2(numeratorI, numeratorR) - Math.atan2(denominatorI, denominatorR);

  return {
    magnitudeDb: 20 * Math.log10(Math.max(magnitude, 1e-24)),
    phaseRadians,
  };
};

const buildIirEqBandReport = (
  band: EqBand,
  index: number,
  sampleRate: number,
  responseFrequenciesHz: ReadonlyArray<number>,
): UzumeReferenceIirEqBandReport => {
  const filterType = band.filterType ?? 'peaking';
  const requestedFrequencyHz = Number.isFinite(band.frequencyHz) ? band.frequencyHz : 1000;
  const frequencyHz = clamp(requestedFrequencyHz, 10, sampleRate / 2 - 1);
  const q = clamp(Number.isFinite(band.q) ? band.q : 1, 0.1, 24);
  const gainDb = Number.isFinite(band.gainDb) ? band.gainDb : 0;
  const biquad = createBiquad(band, sampleRate);
  const disabled = band.enabled === false;
  const state = biquad ? 'active' : disabled ? 'disabled' : 'neutral-bypass';
  const response = biquad
    ? responseFrequenciesHz.map((responseFrequency) => biquadResponseAt(biquad, sampleRate, responseFrequency))
    : responseFrequenciesHz.map(() => ({ magnitudeDb: 0, phaseRadians: 0 }));
  const reasons = biquad
    ? ['biquad_coefficients_generated', 'frequency_response_measured']
    : disabled
      ? ['eq_band_disabled']
      : ['eq_band_neutral_gain_bypassed'];

  return {
    index,
    filterType,
    requestedFrequencyHz,
    frequencyHz,
    q,
    gainDb,
    state,
    coefficients: biquad ? { ...biquad } : null,
    response: {
      frequenciesHz: [...responseFrequenciesHz],
      magnitudeDb: response.map((entry) => entry.magnitudeDb),
      phaseRadians: response.map((entry) => entry.phaseRadians),
    },
    reasons,
  };
};

export const renderUzumeIirEqReference = (
  input: UzumeReferenceIirEqInput,
): UzumeReferenceIirEqResult => {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('uzume_iir_reference_requires_positive_sample_rate');
  }

  const bypass = cloneChannels(input.channels);
  const output = cloneChannels(input.channels);
  const responseFrequenciesHz = responseFrequenciesForRate(input.sampleRate, input.responseFrequenciesHz);
  const bandReports = input.bands.map((band, index) =>
    buildIirEqBandReport(band, index, input.sampleRate, responseFrequenciesHz));
  const activeBiquads = bandReports
    .map((report, index) => ({ report, band: input.bands[index] }))
    .filter((entry) => entry.report.state === 'active')
    .map((entry) => createBiquad(entry.band, input.sampleRate))
    .filter((biquad): biquad is Biquad => biquad !== null);

  for (const biquad of activeBiquads) {
    for (const channel of output) {
      applyBiquad(channel, biquad);
    }
  }

  const inputFlat = flattenChannels(bypass);
  const outputFlat = flattenChannels(output);
  const maxAbs = maxAbsDiff(inputFlat, outputFlat);
  const rms = rmsError(inputFlat, outputFlat);
  const bypassed = activeBiquads.length === 0 || (maxAbs === 0 && rms === 0);

  return {
    artifact: 'iir-eq-reference',
    engine: 'iir-reference',
    orderContract: 'ui-band-order-biquad-cascade',
    sampleRate: input.sampleRate,
    output,
    input: measure(bypass),
    outputMeter: measure(output),
    bandReports,
    activeBandCount: activeBiquads.length,
    residualVsBypass: {
      state: bypassed ? 'exact-bypass' : 'processed',
      comparedFrames: bypass[0]?.length ?? 0,
      maxAbs,
      rms,
    },
    reasons: [
      'peq_basic_iir_reference_only',
      activeBiquads.length > 0 ? 'active_biquads_applied_in_ui_order' : 'no_active_biquads_identity_bypass',
    ],
  };
};

const getDelayed = (channel: ReadonlyArray<number>, index: number, delaySamples: number): number => {
  const sourceIndex = index - delaySamples;
  return sourceIndex >= 0 && sourceIndex < channel.length ? channel[sourceIndex] : 0;
};

const getFractionallyDelayed = (channel: ReadonlyArray<number>, index: number, delaySamples: number): number => {
  const sourceIndex = index - delaySamples;
  if (sourceIndex < 0 || sourceIndex >= channel.length) {
    return 0;
  }

  const lowIndex = Math.floor(sourceIndex);
  const highIndex = lowIndex + 1;
  const fraction = sourceIndex - lowIndex;
  const low = channel[lowIndex] ?? 0;
  const high = highIndex < channel.length ? channel[highIndex] ?? 0 : 0;
  return low * (1 - fraction) + high * fraction;
};

const identityMatrix: UzumeReferenceMatrix2x2 = [
  [1, 0],
  [0, 1],
];

const sanitizeMatrix = (matrix: UzumeReferenceMatrix2x2 | undefined): UzumeReferenceMatrix2x2 =>
  matrix
    ? [
        [
          Number.isFinite(matrix[0]?.[0]) ? matrix[0][0] : 1,
          Number.isFinite(matrix[0]?.[1]) ? matrix[0][1] : 0,
        ],
        [
          Number.isFinite(matrix[1]?.[0]) ? matrix[1][0] : 0,
          Number.isFinite(matrix[1]?.[1]) ? matrix[1][1] : 1,
        ],
      ]
    : identityMatrix;

const applyStereoTrimMuteSolo = (
  left: number[],
  right: number[],
  profile: UzumeReferenceStereoProceduralProfile,
  steps: string[],
): void => {
  const leftTrim = dbToGain(profile.trimDb?.left ?? 0);
  const rightTrim = dbToGain(profile.trimDb?.right ?? 0);
  const muteLeft = profile.mute?.left === true || profile.solo === 'right';
  const muteRight = profile.mute?.right === true || profile.solo === 'left';

  if (Math.abs(leftTrim - 1) > 1e-12 || Math.abs(rightTrim - 1) > 1e-12) {
    steps.push('trim');
  }
  if (muteLeft || muteRight) {
    steps.push(profile.solo && profile.solo !== 'none' ? 'solo' : 'mute');
  }

  for (let i = 0; i < left.length; i += 1) {
    left[i] = muteLeft ? 0 : left[i] * leftTrim;
    right[i] = muteRight ? 0 : right[i] * rightTrim;
  }
};

const applyStereoDelay = (
  left: number[],
  right: number[],
  sampleRate: number,
  profile: UzumeReferenceStereoProceduralProfile,
  steps: string[],
): { left: number; right: number } => {
  const leftDelaySamples = Math.max(0, ((profile.delayMs?.left ?? 0) * sampleRate) / 1000);
  const rightDelaySamples = Math.max(0, ((profile.delayMs?.right ?? 0) * sampleRate) / 1000);
  if (leftDelaySamples <= 1e-12 && rightDelaySamples <= 1e-12) {
    return { left: 0, right: 0 };
  }

  steps.push('delay');
  const sourceLeft = left.slice();
  const sourceRight = right.slice();
  for (let i = 0; i < left.length; i += 1) {
    left[i] = getFractionallyDelayed(sourceLeft, i, leftDelaySamples);
    right[i] = getFractionallyDelayed(sourceRight, i, rightDelaySamples);
  }

  return {
    left: leftDelaySamples,
    right: rightDelaySamples,
  };
};

const applyStereoPolarityRouting = (
  left: number[],
  right: number[],
  profile: UzumeReferenceStereoProceduralProfile,
  steps: string[],
): void => {
  const invertLeft = profile.invert?.left === true;
  const invertRight = profile.invert?.right === true;
  if (invertLeft || invertRight) {
    steps.push('invert');
    for (let i = 0; i < left.length; i += 1) {
      if (invertLeft) {
        left[i] *= -1;
      }
      if (invertRight) {
        right[i] *= -1;
      }
    }
  }

  if (profile.swapLeftRight === true) {
    steps.push('swap');
    for (let i = 0; i < left.length; i += 1) {
      const nextLeft = right[i];
      right[i] = left[i];
      left[i] = nextLeft;
    }
  }

  const monoMode = profile.monoMode ?? 'off';
  if (monoMode !== 'off') {
    steps.push('mono');
    for (let i = 0; i < left.length; i += 1) {
      if (monoMode === 'sum') {
        const mono = (left[i] + right[i]) * 0.5;
        left[i] = mono;
        right[i] = mono;
      } else if (monoMode === 'left') {
        right[i] = left[i];
      } else if (monoMode === 'right') {
        left[i] = right[i];
      }
    }
  }
};

const applyStereoMatrix = (
  left: number[],
  right: number[],
  matrix: UzumeReferenceMatrix2x2,
  steps: string[],
): void => {
  if (
    Math.abs(matrix[0][0] - 1) < 1e-12 &&
    Math.abs(matrix[0][1]) < 1e-12 &&
    Math.abs(matrix[1][0]) < 1e-12 &&
    Math.abs(matrix[1][1] - 1) < 1e-12
  ) {
    return;
  }

  steps.push('matrix');
  const sourceLeft = left.slice();
  const sourceRight = right.slice();
  for (let i = 0; i < left.length; i += 1) {
    left[i] = matrix[0][0] * sourceLeft[i] + matrix[0][1] * sourceRight[i];
    right[i] = matrix[1][0] * sourceLeft[i] + matrix[1][1] * sourceRight[i];
  }
};

const lowPassReference = (samples: ReadonlyArray<number>, sampleRate: number, cutoffHz: number): number[] => {
  const cutoff = clamp(cutoffHz, 10, sampleRate / 2 - 1);
  if (cutoff >= sampleRate / 2 - 1) {
    return Array.from(samples, (sample) => Number.isFinite(sample) ? sample : 0);
  }

  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const output = new Array<number>(samples.length);
  let state = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Number.isFinite(samples[i]) ? samples[i] : 0;
    state += alpha * (sample - state);
    output[i] = state;
  }

  return output;
};

const applyCrossfeedMatrixFilter = (
  left: number[],
  right: number[],
  sampleRate: number,
  profile: UzumeReferenceCrossfeedProfile | undefined,
  steps: string[],
): {
  crossDelaySamples: number;
  lowPassHz: number | null;
  centerPreservation: 'normalize' | 'none';
} => {
  if (!profile?.enabled) {
    return {
      crossDelaySamples: 0,
      lowPassHz: null,
      centerPreservation: 'none',
    };
  }

  const amount = clamp(profile.amount ?? 1, 0, 1);
  const directGain = dbToGain(profile.directGainDb ?? 0);
  const crossGain = dbToGain(profile.crossGainDb ?? -9.5) * amount;
  const outputTrim = dbToGain(profile.outputTrimDb ?? 0);
  const lowPassHz = clamp(profile.lowPassHz ?? 700, 10, sampleRate / 2 - 1);
  const crossDelaySamples = Math.max(0, Math.round(((profile.crossDelayMs ?? 0.25) * sampleRate) / 1000));
  const centerPreservation = profile.centerPreservation ?? 'normalize';
  const normalization = centerPreservation === 'normalize'
    ? 1 / Math.max(1, Math.abs(directGain) + Math.abs(crossGain))
    : 1;
  const filteredLeft = lowPassReference(left, sampleRate, lowPassHz);
  const filteredRight = lowPassReference(right, sampleRate, lowPassHz);
  const sourceLeft = left.slice();
  const sourceRight = right.slice();

  steps.push('crossfeed');
  for (let i = 0; i < left.length; i += 1) {
    const crossToLeft = getDelayed(filteredRight, i, crossDelaySamples);
    const crossToRight = getDelayed(filteredLeft, i, crossDelaySamples);
    left[i] = (sourceLeft[i] * directGain + crossToLeft * crossGain) * normalization * outputTrim;
    right[i] = (sourceRight[i] * directGain + crossToRight * crossGain) * normalization * outputTrim;
  }

  return {
    crossDelaySamples,
    lowPassHz,
    centerPreservation,
  };
};

const applyStereoMatrixFilterReference = (
  channels: number[][],
  sampleRate: number,
  profile: UzumeReferenceStereoProceduralProfile,
): UzumeReferenceStereoMatrixTelemetry => {
  if (channels.length < 2) {
    throw new Error('uzume_stereo_matrix_filter_requires_stereo_channels');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('uzume_stereo_matrix_filter_requires_positive_sample_rate');
  }

  const input = measure(channels);
  const steps: string[] = [];
  const matrix = sanitizeMatrix(profile.matrix);
  const left = channels[0].slice();
  const right = channels[1].slice();

  applyStereoTrimMuteSolo(left, right, profile, steps);
  const delaySamples = applyStereoDelay(left, right, sampleRate, profile, steps);
  applyStereoPolarityRouting(left, right, profile, steps);
  applyStereoMatrix(left, right, matrix, steps);
  const crossfeed = applyCrossfeedMatrixFilter(left, right, sampleRate, profile.crossfeed, steps);

  channels[0] = left;
  channels[1] = right;

  return {
    input,
    output: measure(channels),
    matrix,
    crossfeedEnabled: profile.crossfeed?.enabled === true,
    crossDelaySamples: crossfeed.crossDelaySamples,
    lowPassHz: crossfeed.lowPassHz,
    centerPreservation: crossfeed.centerPreservation,
    delaySamples,
    invert: {
      left: profile.invert?.left === true,
      right: profile.invert?.right === true,
    },
    swapLeftRight: profile.swapLeftRight === true,
    monoMode: profile.monoMode ?? 'off',
    steps,
  };
};

export const renderUzumeStereoMatrixFilterReference = (
  input: UzumeReferenceStereoMatrixFilterInput,
): UzumeReferenceStereoMatrixFilterResult => {
  const channels = cloneChannels(input.channels);
  const telemetry = applyStereoMatrixFilterReference(channels, input.sampleRate, input.profile);

  return {
    channels,
    telemetry,
  };
};

const applyPerEarEqGainReference = (
  channels: number[][],
  profile: UzumeReferencePerEarEqProfile,
): void => {
  if (channels.length < 2) {
    throw new Error('uzume_per_ear_eq_placement_requires_stereo_channels');
  }

  const leftGain = dbToGain(profile.leftGainDb ?? 0);
  const rightGain = dbToGain(profile.rightGainDb ?? 0);
  for (let i = 0; i < channels[0].length; i += 1) {
    channels[0][i] *= leftGain;
    channels[1][i] *= rightGain;
  }
};

export const renderUzumePerEarEqPlacementReference = (
  input: UzumeReferencePerEarEqPlacementInput,
): UzumeReferencePerEarEqPlacementResult => {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('uzume_per_ear_eq_placement_requires_positive_sample_rate');
  }

  const preChannels = cloneChannels(input.channels);
  applyPerEarEqGainReference(preChannels, input.perEarEq);
  const preTelemetry = applyStereoMatrixFilterReference(preChannels, input.sampleRate, {
    crossfeed: input.crossfeed,
  });

  const postChannels = cloneChannels(input.channels);
  const postTelemetry = applyStereoMatrixFilterReference(postChannels, input.sampleRate, {
    crossfeed: input.crossfeed,
  });
  applyPerEarEqGainReference(postChannels, input.perEarEq);
  postTelemetry.steps.push('post-per-ear-eq');
  postTelemetry.output = measure(postChannels);

  const preFlat = flattenChannels(preChannels);
  const postFlat = flattenChannels(postChannels);
  const residualMaxAbs = maxAbsDiff(preFlat, postFlat);

  return {
    artifact: 'per-ear-eq-placement-reference',
    orderContract: ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'],
    compilerRule: 'do-not-reorder-across-crossfeed-without-null-proof',
    preCrossfeed: {
      channels: preChannels,
      telemetry: {
        ...preTelemetry,
        steps: ['pre-per-ear-eq', ...preTelemetry.steps],
      },
    },
    postCrossfeed: {
      channels: postChannels,
      telemetry: postTelemetry,
    },
    placementResidual: {
      state: residualMaxAbs > 1e-12 ? 'placement-sensitive' : 'commutative-for-input',
      comparedFrames: Math.min(preChannels[0]?.length ?? 0, postChannels[0]?.length ?? 0),
      maxAbs: residualMaxAbs,
      rms: rmsError(preFlat, postFlat),
    },
  };
};

const applyStereoProcedural = (
  channels: number[][],
  sampleRate: number,
  state: Partial<ChannelBalanceState> | null | undefined,
): void => {
  if (!state?.enabled || channels.length < 2) {
    return;
  }

  const left = channels[0].slice();
  const right = channels[1].slice();
  const leftDelaySamples = Math.max(0, Math.round(((state.leftDelayMs ?? 0) * sampleRate) / 1000));
  const rightDelaySamples = Math.max(0, Math.round(((state.rightDelayMs ?? 0) * sampleRate) / 1000));
  const leftGain = dbToGain(state.leftGainDb ?? 0);
  const rightGain = dbToGain(state.rightGainDb ?? 0);
  const balance = clamp(state.balance ?? 0, -1, 1);
  const balanceLeftGain = balance > 0 ? 1 - balance : 1;
  const balanceRightGain = balance < 0 ? 1 + balance : 1;

  for (let i = 0; i < channels[0].length; i += 1) {
    let leftSample = getDelayed(left, i, leftDelaySamples);
    let rightSample = getDelayed(right, i, rightDelaySamples);

    if (state.swapLeftRight) {
      const nextLeft = rightSample;
      rightSample = leftSample;
      leftSample = nextLeft;
    }

    if (state.monoMode === 'sum') {
      const mono = (leftSample + rightSample) * 0.5;
      leftSample = mono;
      rightSample = mono;
    } else if (state.monoMode === 'left') {
      rightSample = leftSample;
    } else if (state.monoMode === 'right') {
      leftSample = rightSample;
    }

    if (state.invertLeft) {
      leftSample *= -1;
    }
    if (state.invertRight) {
      rightSample *= -1;
    }

    channels[0][i] = leftSample * leftGain * balanceLeftGain;
    channels[1][i] = rightSample * rightGain * balanceRightGain;
  }
};

const resolveChannelScopeTargets = (
  scope: UzumeReferenceChannelScope,
  channelCount: number,
): number[] => {
  const valid = (channel: number): number | null => {
    if (!Number.isFinite(channel)) {
      return null;
    }
    const normalized = Math.trunc(channel);
    return normalized >= 0 && normalized < channelCount ? normalized : null;
  };
  const targets = new Set<number>();

  if (scope.mode === 'all') {
    for (let channel = 0; channel < channelCount; channel += 1) {
      targets.add(channel);
    }
  } else if (scope.mode === 'channels') {
    for (const channel of scope.channels) {
      const normalized = valid(channel);
      if (normalized !== null) {
        targets.add(normalized);
      }
    }
  } else {
    const pairStart = valid(scope.pairStart ?? 0);
    if (pairStart !== null) {
      targets.add(pairStart);
      const right = valid(pairStart + 1);
      if (right !== null) {
        targets.add(right);
      }
    }
  }

  return [...targets].sort((left, right) => left - right);
};

const applyChannelScopeOperation = (
  output: number[][],
  operation: UzumeReferenceChannelScopeOperation,
  targets: ReadonlyArray<number>,
): UzumeReferenceChannelScopeOperationReport['state'] => {
  if (targets.length === 0) {
    return 'no-targets';
  }

  const gainDb = Number.isFinite(operation.gainDb) ? operation.gainDb ?? 0 : 0;
  const gain = dbToGain(gainDb);
  if (operation.kind === 'gain') {
    if (Math.abs(gain - 1) < 1e-12) {
      return 'noop';
    }
    for (const channelIndex of targets) {
      for (let frame = 0; frame < output[channelIndex].length; frame += 1) {
        output[channelIndex][frame] *= gain;
      }
    }
    return 'applied';
  }

  if (operation.kind === 'mute') {
    for (const channelIndex of targets) {
      output[channelIndex].fill(0);
    }
    return 'applied';
  }

  if (operation.kind === 'invert') {
    for (const channelIndex of targets) {
      for (let frame = 0; frame < output[channelIndex].length; frame += 1) {
        output[channelIndex][frame] *= -1;
      }
    }
    return 'applied';
  }

  const sourceChannel = operation.sourceChannel == null ? null : Math.trunc(operation.sourceChannel);
  if (
    sourceChannel === null ||
    sourceChannel < 0 ||
    sourceChannel >= output.length ||
    !Number.isFinite(operation.sourceChannel)
  ) {
    return 'invalid-source';
  }

  const mixGain = dbToGain(Number.isFinite(operation.mixGainDb) ? operation.mixGainDb ?? 0 : 0);
  const source = output[sourceChannel].slice();
  for (const channelIndex of targets) {
    for (let frame = 0; frame < output[channelIndex].length; frame += 1) {
      output[channelIndex][frame] += source[frame] * mixGain;
    }
  }
  return 'applied';
};

export const renderUzumeChannelScopeReference = (
  input: UzumeReferenceChannelScopeInput,
): UzumeReferenceChannelScopeResult => {
  const original = cloneChannels(input.channels);
  const output = cloneChannels(input.channels);
  const touchedChannels = new Set<number>();
  const operationReports: UzumeReferenceChannelScopeOperationReport[] = input.operations.map((operation) => {
    const targets = resolveChannelScopeTargets(operation.scope, output.length);
    const skippedChannels = Array.from({ length: output.length }, (_, index) => index)
      .filter((channelIndex) => !targets.includes(channelIndex));
    const state = applyChannelScopeOperation(output, operation, targets);
    if (state === 'applied' || state === 'noop') {
      targets.forEach((target) => touchedChannels.add(target));
    }

    return {
      id: operation.id,
      kind: operation.kind,
      scope: operation.scope,
      targetChannels: targets,
      skippedChannels,
      state,
      gainDb: operation.kind === 'gain'
        ? Number.isFinite(operation.gainDb) ? operation.gainDb ?? 0 : 0
        : operation.kind === 'mix-from'
          ? Number.isFinite(operation.mixGainDb) ? operation.mixGainDb ?? 0 : 0
          : null,
      sourceChannel: operation.kind === 'mix-from' && operation.sourceChannel != null
        ? Math.trunc(operation.sourceChannel)
        : null,
      reasons: state === 'applied'
        ? ['operation_applied_to_target_channels_only']
        : state === 'noop'
          ? ['targeted_operation_is_neutral_noop']
          : state === 'invalid-source'
            ? ['mix_source_channel_invalid']
            : ['channel_scope_resolved_no_targets'],
    };
  });

  const residualByChannel = original.map((channel, channelIndex) => {
    const maxAbs = maxAbsDiff(channel, output[channelIndex]);
    const rms = rmsError(channel, output[channelIndex]);
    const touched = touchedChannels.has(channelIndex);
    return {
      channelIndex,
      state: touched
        ? maxAbs > 0 || rms > 0 ? 'processed' as const : 'targeted-noop' as const
        : 'out-of-scope-bypass' as const,
      maxAbs,
      rms,
    };
  });
  const untouchedChannelIndexes = residualByChannel
    .filter((residual) => residual.state === 'out-of-scope-bypass' && residual.maxAbs === 0 && residual.rms === 0)
    .map((residual) => residual.channelIndex);

  return {
    artifact: 'channel-scope-reference',
    engine: 'stereo-procedural-reference',
    scopeContract: 'targeted-channels-only',
    output,
    operationReports,
    residualByChannel,
    untouchedChannelIndexes,
    reasons: [
      'channel_scope_resolved_before_operation',
      'out_of_scope_channels_must_remain_exact_bypass',
    ],
  };
};

export const renderUzumeBlockBoundarySplitReference = (
  input: UzumeReferenceBlockBoundaryInput,
): UzumeReferenceBlockBoundaryResult => {
  const channels = cloneChannels(input.channels);
  const frameCount = channels[0]?.length ?? 0;
  const blockFrames = Math.max(1, Math.round(Number.isFinite(input.blockFrames) ? input.blockFrames : 1));
  const padFinalBlock = input.padFinalBlock !== false;
  const blocks: UzumeReferenceBlockBoundaryBlock[] = [];
  const reassembled = Array.from({ length: channels.length }, () => [] as number[]);
  const frameCoverage = Array.from({ length: frameCount }, () => 0);
  let paddedFrames = 0;

  for (let startFrame = 0, blockIndex = 0; startFrame < frameCount; startFrame += blockFrames, blockIndex += 1) {
    const validFrames = Math.min(blockFrames, frameCount - startFrame);
    const blockPadding = padFinalBlock ? blockFrames - validFrames : 0;
    paddedFrames += blockPadding;
    for (let frame = 0; frame < validFrames; frame += 1) {
      const sourceFrame = startFrame + frame;
      frameCoverage[sourceFrame] += 1;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        reassembled[channelIndex].push(channels[channelIndex][sourceFrame]);
      }
    }
    blocks.push({
      blockIndex,
      startFrame,
      endFrame: startFrame + validFrames,
      validFrames,
      committedFrames: validFrames,
      paddedFrames: blockPadding,
      state: validFrames === blockFrames
        ? 'full'
        : blockPadding > 0 ? 'partial-padded' : 'partial-unpadded',
    });
  }

  const boundaries: UzumeReferenceBlockBoundaryReport[] = [];
  for (let blockIndex = 1; blockIndex < blocks.length; blockIndex += 1) {
    const boundaryFrame = blocks[blockIndex].startFrame;
    let sourceJumpMaxAbs = 0;
    let reassembledJumpMaxAbs = 0;
    let introducedDiscontinuityMaxAbs = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sourceJump = channels[channelIndex][boundaryFrame] - channels[channelIndex][boundaryFrame - 1];
      const reassembledJump =
        reassembled[channelIndex][boundaryFrame] - reassembled[channelIndex][boundaryFrame - 1];
      sourceJumpMaxAbs = Math.max(sourceJumpMaxAbs, Math.abs(sourceJump));
      reassembledJumpMaxAbs = Math.max(reassembledJumpMaxAbs, Math.abs(reassembledJump));
      introducedDiscontinuityMaxAbs = Math.max(
        introducedDiscontinuityMaxAbs,
        Math.abs(reassembledJump - sourceJump),
      );
    }
    boundaries.push({
      beforeBlockIndex: blockIndex - 1,
      afterBlockIndex: blockIndex,
      boundaryFrame,
      sourceJumpMaxAbs,
      reassembledJumpMaxAbs,
      introducedDiscontinuityMaxAbs,
    });
  }

  const missingFrames = frameCoverage.filter((count) => count === 0).length;
  const duplicateFrames = frameCoverage.filter((count) => count > 1).length;
  const coveredFrames = frameCoverage.filter((count) => count === 1).length;
  const inputFlat = flattenChannels(channels);
  const outputFlat = flattenChannels(reassembled);
  const residualMaxAbs = maxAbsDiff(inputFlat, outputFlat);
  const residualRms = rmsError(inputFlat, outputFlat);
  const coverageExact = missingFrames === 0 && duplicateFrames === 0 && residualMaxAbs === 0 && residualRms === 0;

  return {
    artifact: 'block-boundary-split-reference',
    policy: 'valid-frames-committed-padding-never-output',
    blockFrames,
    inputFrames: frameCount,
    channelCount: channels.length,
    blocks,
    reassembled,
    coverage: {
      state: coverageExact ? 'exact' : 'broken',
      coveredFrames,
      missingFrames,
      duplicateFrames,
      committedFrames: blocks.reduce((sum, block) => sum + block.committedFrames, 0),
      paddedFrames,
    },
    residualVsInput: {
      state: coverageExact ? 'exact-reassembly' : 'mismatch',
      comparedFrames: frameCount,
      maxAbs: residualMaxAbs,
      rms: residualRms,
    },
    boundaries,
    reasons: [
      'block_boundaries_cover_each_source_frame_once',
      padFinalBlock ? 'final_block_zero_padding_not_committed' : 'final_block_unpadded_reference',
      'reassembled_output_matches_source_without_boundary_discontinuity',
    ],
  };
};

export const renderUzumeFlushDrainReference = (
  input: UzumeReferenceFlushDrainInput,
): UzumeReferenceFlushDrainResult => {
  const channels = cloneChannels(input.channels);
  const channelCount = channels.length;
  const sourceFrames = channels[0]?.length ?? 0;
  if (channelCount <= 0) {
    throw new Error('uzume_flush_drain_reference_requires_channels');
  }
  const responseChannels = cloneResponseChannels(input.responses, channelCount);
  const tailFrames = Math.max(0, Math.max(...responseChannels.map((response) => response.length)) - 1);
  const generationId = input.generationId == null ? 0 : normalizeGenerationId(input.generationId);
  const candidateGenerationId = input.candidateGenerationId == null
    ? generationId
    : normalizeGenerationId(input.candidateGenerationId);
  const generationState = candidateGenerationId === generationId ? 'current' as const : 'stale-candidate' as const;
  const referenceOutput = channels.map((channel, channelIndex) =>
    convolveReference(channel, responseChannels[channelIndex] ?? [1]));
  const sourceWindow = referenceOutput.map((channel) => channel.slice(0, sourceFrames));
  const pendingDrain = referenceOutput.map((channel) => channel.slice(sourceFrames));
  const stale = generationState === 'stale-candidate';
  const naturalEof = input.intent === 'natural-eof';
  const resetRequired = !naturalEof;
  const drainCommitAllowed = naturalEof && !stale;
  const committedOutput = drainCommitAllowed
    ? referenceOutput.map((channel) => channel.slice())
    : stale ? [] : sourceWindow.map((channel) => channel.slice());
  const droppedDrain = drainCommitAllowed || stale ? [] : pendingDrain.map((channel) => channel.slice());
  const sourceFlat = flattenChannels(sourceWindow);
  const committedSourceFlat = flattenChannels(
    committedOutput.length > 0
      ? committedOutput.map((channel) => channel.slice(0, sourceFrames))
      : Array.from({ length: channelCount }, () => [] as number[]),
  );
  const pendingDrainFlat = flattenChannels(pendingDrain);
  const referenceDrainFlat = flattenChannels(referenceOutput.map((channel) => channel.slice(sourceFrames)));

  return {
    artifact: 'flush-drain-reference',
    engine: 'direct-fir-float64-reference',
    intent: input.intent,
    generationId,
    candidateGenerationId,
    generationAfter: stale ? generationId : resetRequired ? generationId + 1 : generationId,
    generationState,
    state: stale
      ? 'stale-candidate-rejected'
      : drainCommitAllowed ? 'drain-committed' : 'tail-dropped-and-reset',
    sourceFrames,
    tailFrames,
    drainFrames: drainCommitAllowed ? tailFrames : 0,
    referenceOutput,
    committedOutput,
    pendingDrain,
    droppedDrain,
    resetRequired,
    drainCommitAllowed,
    residual: {
      sourceWindowMaxAbs: stale ? 0 : maxAbsDiff(sourceFlat, committedSourceFlat),
      sourceWindowRms: stale ? 0 : rmsError(sourceFlat, committedSourceFlat),
      drainMaxAbs: pendingDrainFlat.length > 0 ? maxAbsDiff(pendingDrainFlat, referenceDrainFlat) : null,
      drainRms: pendingDrainFlat.length > 0 ? rmsError(pendingDrainFlat, referenceDrainFlat) : null,
    },
    reasons: stale
      ? ['stale_generation_rejected', 'callback_keeps_prior_committed_output']
      : drainCommitAllowed
        ? ['natural_eof_commits_drain_tail', 'drain_frames_match_filter_tail']
        : ['transport_boundary_drops_pending_tail', 'generation_increment_required', 'render_state_reset_required'],
  };
};

const buildBlockBoundaryInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['blockBoundary'] => {
  const result = renderUzumeBlockBoundarySplitReference({
    channels: createPcmOutputQuantizationReferenceChannels(input.probe?.channels ?? 2),
    blockFrames: 6,
    padFinalBlock: true,
  });

  return {
    artifact: result.artifact,
    policy: result.policy,
    blockFrames: result.blockFrames,
    inputFrames: result.inputFrames,
    channelCount: result.channelCount,
    blockCount: result.blocks.length,
    blockStates: result.blocks.map((block) => block.state),
    coverage: result.coverage,
    residual: result.residualVsInput,
    boundaryCount: result.boundaries.length,
    maxIntroducedDiscontinuity: result.boundaries.reduce(
      (maxValue, boundary) => Math.max(maxValue, boundary.introducedDiscontinuityMaxAbs),
      0,
    ),
    reasons: result.reasons,
  };
};

const compactFlushDrainIntentReport = (
  result: UzumeReferenceFlushDrainResult,
): UzumeCompiledReferencePlan['flushDrain']['naturalEof'] => ({
  intent: result.intent === 'natural-eof' ? 'natural-eof' : 'manual-flush',
  generationAfter: result.generationAfter,
  state: result.state,
  sourceFrames: result.sourceFrames,
  tailFrames: result.tailFrames,
  drainFrames: result.drainFrames,
  resetRequired: result.resetRequired,
  drainCommitAllowed: result.drainCommitAllowed,
  residual: result.residual,
  reasons: result.reasons,
});

const buildFlushDrainInspectReport = (
  input: UzumeReferenceCompileInput,
): UzumeCompiledReferencePlan['flushDrain'] => {
  const channelCount = Math.max(1, Math.min(2, Math.round(input.probe?.channels ?? 2) || 2));
  const channels = Array.from({ length: channelCount }, (_, channelIndex) =>
    channelIndex === 0 ? [1, 0, 0.25] : [-0.5, 0.25, 0]);
  const responses = Array.from({ length: channelCount }, () => [1, 0.5, 0.25]);
  const generationId = 7;
  const naturalEof = renderUzumeFlushDrainReference({
    generationId,
    intent: 'natural-eof',
    channels,
    responses,
  });
  const manualFlush = renderUzumeFlushDrainReference({
    generationId,
    intent: 'manual-flush',
    channels,
    responses,
  });

  return {
    artifact: 'flush-drain-reference',
    engine: 'direct-fir-float64-reference',
    generationId,
    generationState: 'current',
    naturalEof: compactFlushDrainIntentReport(naturalEof),
    manualFlush: compactFlushDrainIntentReport(manualFlush),
  };
};

const applySafetyLimiter = (channels: number[][]): UzumeReferenceLimiterReport => {
  let limitedSamples = 0;
  let limitedFrames = 0;
  let minGain = 1;

  const length = channels[0]?.length ?? 0;
  for (let i = 0; i < length; i += 1) {
    let frameLimited = false;
    for (const channel of channels) {
      const sample = Number.isFinite(channel[i]) ? channel[i] : 0;
      const abs = Math.abs(sample);
      if (abs <= 1) {
        channel[i] = sample;
        continue;
      }

      const limited = Math.sign(sample);
      const gain = Math.abs(limited / sample);
      minGain = Math.min(minGain, gain);
      channel[i] = limited;
      limitedSamples += 1;
      frameLimited = true;
    }
    if (frameLimited) {
      limitedFrames += 1;
    }
  }

  const maxGainReductionDb = minGain < 1 ? 20 * Math.log10(minGain) : 0;

  return {
    enabled: true,
    active: limitedSamples > 0,
    triggerCount: limitedFrames,
    currentGainReductionDb: maxGainReductionDb,
    maxGainReductionDb,
    limitedSamples,
    limitedFrames,
    mode: 'sample-domain-safety-limiter',
    truePeakLookahead: false,
  };
};

export const renderUzumePcmReference = (input: UzumeReferencePcmInput): UzumeReferencePcmResult => {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('uzume_reference_requires_positive_sample_rate');
  }

  const channels = cloneChannels(input.channels);
  const inputMeter = measure(channels);
  const inputPeakDbfs = amplitudeToDb(inputMeter.peak);
  const stageSnapshots: Array<{
    id: UzumeReferenceSafetyStageId;
    channels: number[][];
  }> = [{ id: 'input', channels: channels.map((channel) => channel.slice()) }];
  applyGain(channels, dbToGain((input.headroomDb ?? 0) + (input.materializedGainDb ?? 0)));
  const afterHeadroom = measure(channels);
  stageSnapshots.push({ id: 'after-headroom', channels: channels.map((channel) => channel.slice()) });

  if (input.eqBands?.length) {
    applyEq(channels, input.eqBands, input.sampleRate);
  }
  const afterEq = measure(channels);
  stageSnapshots.push({ id: 'after-eq-iir', channels: channels.map((channel) => channel.slice()) });

  applyStereoProcedural(channels, input.sampleRate, input.channelBalance);
  if (input.stereoProcedural && channels.length >= 2) {
    applyStereoMatrixFilterReference(channels, input.sampleRate, input.stereoProcedural);
  }
  const afterStereoProcedural = measure(channels);
  stageSnapshots.push({ id: 'after-stereo-procedural-crossfeed', channels: channels.map((channel) => channel.slice()) });

  if (input.convolutionResponses?.length) {
    const responseChannels = cloneResponseChannels(input.convolutionResponses, channels.length);
    const convolvedChannels = channels.map((channel, channelIndex) =>
      convolveReference(channel, responseChannels[channelIndex] ?? [1]));
    channels.splice(0, channels.length, ...convolvedChannels);
  }
  const afterConvolution = measure(channels);
  stageSnapshots.push(
    { id: 'after-convolution', channels: channels.map((channel) => channel.slice()) },
    { id: 'pre-limiter', channels: channels.map((channel) => channel.slice()) },
  );
  const limiter = input.safetyLimiterEnabled === false
    ? {
        enabled: false,
        active: false,
        triggerCount: 0,
        currentGainReductionDb: 0,
        maxGainReductionDb: 0,
        limitedSamples: 0,
        limitedFrames: 0,
        mode: 'sample-domain-safety-limiter' as const,
        truePeakLookahead: false as const,
      }
    : applySafetyLimiter(channels);
  const postLimiter = measure(channels);
  stageSnapshots.push({ id: 'post-limiter', channels: channels.map((channel) => channel.slice()) });
  const safetyStages = stageSnapshots.map((stage) =>
    buildSafetyStage(stage.id, stage.channels, inputPeakDbfs));
  const safetyMeter = buildSafetyMeterReport(safetyStages, limiter);
  const headroom = buildHeadroomRecommendation(safetyStages, input.headroomDb ?? 0, limiter);

  return {
    channels,
    telemetry: {
      input: inputMeter,
      afterHeadroom,
      afterEq,
      afterStereoProcedural,
      afterConvolution,
      postLimiter,
      limitedSamples: limiter.limitedSamples,
      maxGainReductionDb: limiter.maxGainReductionDb,
      safetyMeter,
      headroom,
      limiter,
    },
  };
};

export const createUzumeResamplingReferenceArtifacts = (
  sourceRate: number,
  targetRate: number,
  length = 64,
  filterContract?: UzumeReferenceResamplingFilterContract,
): UzumeReferenceResamplingArtifacts => {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('uzume_reference_artifacts_require_positive_rates');
  }

  const safeLength = Math.max(8, Math.round(length));
  const ratio = targetRate / sourceRate;
  const impulseIndex = Math.floor(safeLength / 2);
  const nearNyquistHz = sourceRate * 0.49;
  const randomSeed = 0x5eed202;
  let randomState = randomSeed;
  const nextRandom = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return (randomState / 0xffffffff) * 2 - 1;
  };
  const contract = filterContract ?? buildResamplingFilterContract(sourceRate, targetRate);
  const impulse = Array.from({ length: safeLength }, (_, index) => (index === impulseIndex ? 1 : 0));
  const sweep = Array.from({ length: safeLength }, (_, index) => {
    const t = index / Math.max(1, safeLength - 1);
    const phase = 2 * Math.PI * (20 * t + (sourceRate * 0.45 - 20) * t * t * 0.5) / sourceRate * safeLength;
    return Math.sin(phase);
  });
  const logSweepStartHz = Math.max(1, Math.min(20, sourceRate * 0.01));
  const logSweepEndHz = Math.max(logSweepStartHz * 1.01, sourceRate * 0.45);
  const logSweepRatio = Math.log(logSweepEndHz / logSweepStartHz);
  const logSweep = Array.from({ length: safeLength }, (_, index) => {
    const t = index / Math.max(1, safeLength - 1);
    const phase = (2 * Math.PI * logSweepStartHz * safeLength * (Math.exp(logSweepRatio * t) - 1)) /
      (sourceRate * logSweepRatio);
    return Math.sin(phase);
  });
  const nearNyquist = Array.from({ length: safeLength }, (_, index) => Math.sin((2 * Math.PI * nearNyquistHz * index) / sourceRate));
  const multiToneFrequencies = [sourceRate * 0.03125, sourceRate * 0.125, sourceRate * 0.37];
  const multiTone = Array.from({ length: safeLength }, (_, index) =>
    multiToneFrequencies.reduce((sum, frequency, toneIndex) =>
      sum + Math.sin((2 * Math.PI * frequency * index) / sourceRate + toneIndex * 0.37) / multiToneFrequencies.length, 0));
  const random = Array.from({ length: safeLength }, () => nextRandom() * 0.5);
  const silence = Array.from({ length: safeLength }, () => 0);
  const impulseResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [impulse],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const sweepResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [sweep],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const logSweepResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [logSweep],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const nearNyquistResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [nearNyquist],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const multiToneResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [multiTone],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const randomResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [random],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const silenceResponse = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: [silence],
    tapCount: contract.tapCount,
    phaseCount: contract.phaseCount,
    cutoffRatio: contract.cutoffRatio,
  });
  const renderedImpulse = impulseResponse.channels[0] ?? [];
  const renderedSweep = sweepResponse.channels[0] ?? [];
  const renderedLogSweep = logSweepResponse.channels[0] ?? [];
  const renderedNearNyquist = nearNyquistResponse.channels[0] ?? [];
  const renderedMultiTone = multiToneResponse.channels[0] ?? [];
  const renderedRandom = randomResponse.channels[0] ?? [];
  const renderedSilence = silenceResponse.channels[0] ?? [];
  const expectedSilence = Array.from({ length: renderedSilence.length }, () => 0);
  const phaseGroupDelay = phaseSpread(renderedImpulse);
  const frequencyResponse = analyzeFrequencyResponse(renderedImpulse, sourceRate, targetRate, contract);
  const stimulusNearNyquistPeak = maxAbs(nearNyquist);
  const responseNearNyquistPeak = maxAbs(renderedNearNyquist);
  const aliasRejectionDb = stimulusNearNyquistPeak > 0 && responseNearNyquistPeak > 0
    ? Math.max(0, -20 * Math.log10(responseNearNyquistPeak / stimulusNearNyquistPeak))
    : null;
  const realtimeBudget: UzumeReferenceResamplingArtifactMetrics['realtimeBudget'] = {
    backend: 'scalar-float64-reference',
    estimatedMultiplyAdds: renderedImpulse.length * Math.max(1, contract.tapCount),
    estimatedRealtimeFactor: null,
    safetyClass: sourceRate === targetRate ? 'same-rate-bypass' : 'offline-reference-only',
  };
  const nullResidual: UzumeReferenceResamplingArtifactMetrics['nullResidual'] = sourceRate === targetRate
    ? {
        state: 'exact-bypass',
        comparedFrames: Math.min(impulse.length, renderedImpulse.length),
        maxAbs: maxAbsDiff(impulse, renderedImpulse),
        rms: rmsError(impulse, renderedImpulse),
      }
    : {
        state: 'not-applicable',
        comparedFrames: 0,
        maxAbs: null,
        rms: null,
      };
  const silenceResidual: UzumeReferenceResamplingArtifactMetrics['silenceResidual'] = {
    state: maxAbs(renderedSilence) <= 1e-12 ? 'exact-silence' : 'residual-over-threshold',
    comparedFrames: renderedSilence.length,
    maxAbs: maxAbs(renderedSilence),
    rms: rmsError(renderedSilence, expectedSilence),
  };
  const metrics: UzumeReferenceResamplingArtifactMetrics = {
    impulsePeakIndex: phaseGroupDelay.peakIndex,
    impulsePeak: maxAbs(renderedImpulse),
    impulseEnergy: energy(renderedImpulse),
    sweepPeak: maxAbs(renderedSweep),
    logSweepPeak: maxAbs(renderedLogSweep),
    nearNyquistPeak: responseNearNyquistPeak,
    multiTonePeak: maxAbs(renderedMultiTone),
    randomPeak: maxAbs(renderedRandom),
    randomSeed,
    silencePeak: maxAbs(renderedSilence),
    silenceResidual,
    aliasRejectionDb,
    phaseGroupDelaySpreadSamples: phaseGroupDelay.spreadSamples,
    ...frequencyResponse,
    realtimeBudget,
    nullResidual,
  };

  return {
    stimulus: {
      impulse,
      sweep,
      logSweep,
      nearNyquist,
      multiTone,
      random,
      silence,
    },
    response: {
      impulse: renderedImpulse,
      sweep: renderedSweep,
      logSweep: renderedLogSweep,
      nearNyquist: renderedNearNyquist,
      multiTone: renderedMultiTone,
      random: renderedRandom,
      silence: renderedSilence,
    },
    impulse: renderedImpulse,
    sweep: renderedSweep,
    logSweep: renderedLogSweep,
    nearNyquist: renderedNearNyquist,
    multiTone: renderedMultiTone,
    random: renderedRandom,
    silence: renderedSilence,
    ratio,
    groupDelaySamples: impulseResponse.telemetry.groupDelaySamples,
    groupDelayMs: impulseResponse.telemetry.groupDelayMs,
    lookaheadSamples: impulseResponse.telemetry.lookaheadSamples,
    lookaheadMs: impulseResponse.telemetry.lookaheadMs,
    filterContract: contract,
    phaseAccumulator: impulseResponse.telemetry.phaseAccumulator,
    phaseGroupDelay,
    aliasRejectionDb,
    ...frequencyResponse,
    realtimeBudget,
    nullResidual,
    silenceResidual,
    metrics,
  };
};

export const validateUzumeResamplingReferenceArtifacts = (
  artifacts: UzumeReferenceResamplingArtifacts,
  thresholds: UzumeReferenceResamplingValidationThresholds = {},
): UzumeReferenceResamplingValidationResult => {
  const resolvedThresholds: UzumeReferenceResamplingValidationResult['thresholds'] = {
    passbandRippleDbMax: thresholds.passbandRippleDbMax ?? 0.1,
    stopbandAttenuationDbMin: thresholds.stopbandAttenuationDbMin ?? 36,
    transitionWidthRatioMax: thresholds.transitionWidthRatioMax ?? 0.08,
    silenceMaxAbs: thresholds.silenceMaxAbs ?? 1e-12,
    sameRateNullMaxAbs: thresholds.sameRateNullMaxAbs ?? 1e-12,
    sameRateNullRmsMax: thresholds.sameRateNullRmsMax ?? 1e-12,
    estimatedMultiplyAddsMax: thresholds.estimatedMultiplyAddsMax ?? 20000,
    requireMeasuredRealtimeFactor: thresholds.requireMeasuredRealtimeFactor ?? false,
  };
  const checks: UzumeReferenceResamplingValidationCheck[] = [];
  const sameRateBypass = artifacts.phaseAccumulator === 'same-rate-bypass';

  checks.push({
    id: 'passband-ripple',
    state: artifacts.passbandRippleDb == null
      ? 'fail'
      : artifacts.passbandRippleDb <= resolvedThresholds.passbandRippleDbMax ? 'pass' : 'fail',
    actual: artifacts.passbandRippleDb,
    threshold: resolvedThresholds.passbandRippleDbMax,
    reason: artifacts.passbandRippleDb == null
      ? 'passband_ripple_missing'
      : 'passband_ripple_threshold',
  });
  checks.push({
    id: 'stopband-attenuation',
    state: sameRateBypass
      ? 'not-applicable'
      : artifacts.stopbandAttenuationDb == null
        ? 'fail'
        : artifacts.stopbandAttenuationDb >= resolvedThresholds.stopbandAttenuationDbMin ? 'pass' : 'fail',
    actual: artifacts.stopbandAttenuationDb,
    threshold: resolvedThresholds.stopbandAttenuationDbMin,
    reason: sameRateBypass
      ? 'same_rate_bypass_has_no_stopband'
      : artifacts.stopbandAttenuationDb == null
        ? 'stopband_attenuation_missing'
        : 'stopband_attenuation_threshold',
  });
  checks.push({
    id: 'transition-width',
    state: sameRateBypass
      ? 'not-applicable'
      : artifacts.transitionWidthRatioEstimate == null
        ? 'fail'
        : artifacts.transitionWidthRatioEstimate <= resolvedThresholds.transitionWidthRatioMax ? 'pass' : 'fail',
    actual: artifacts.transitionWidthRatioEstimate,
    threshold: resolvedThresholds.transitionWidthRatioMax,
    reason: sameRateBypass
      ? 'same_rate_bypass_has_no_transition_band'
      : artifacts.transitionWidthRatioEstimate == null
        ? 'transition_width_missing'
        : 'transition_width_threshold',
  });
  checks.push({
    id: 'silence-preservation',
    state: artifacts.silenceResidual.maxAbs <= resolvedThresholds.silenceMaxAbs ? 'pass' : 'fail',
    actual: artifacts.silenceResidual.maxAbs,
    threshold: resolvedThresholds.silenceMaxAbs,
    reason: 'silence_must_remain_exact_zero',
  });
  const nullMaxAbs = artifacts.nullResidual.maxAbs;
  const nullRms = artifacts.nullResidual.rms;
  const nullPass = artifacts.nullResidual.state === 'exact-bypass' &&
    nullMaxAbs != null &&
    nullRms != null &&
    nullMaxAbs <= resolvedThresholds.sameRateNullMaxAbs &&
    nullRms <= resolvedThresholds.sameRateNullRmsMax;
  checks.push({
    id: 'same-rate-null',
    state: artifacts.nullResidual.state === 'not-applicable'
      ? 'not-applicable'
      : nullPass ? 'pass' : 'fail',
    actual: nullMaxAbs,
    threshold: resolvedThresholds.sameRateNullMaxAbs,
    reason: artifacts.nullResidual.state === 'not-applicable'
      ? 'sample_rate_conversion_null_not_applicable'
      : 'same_rate_exact_bypass_null_threshold',
  });
  checks.push({
    id: 'realtime-budget',
    state: thresholds.requireMeasuredRealtimeFactor === true && artifacts.realtimeBudget.estimatedRealtimeFactor == null
      ? 'fail'
      : artifacts.realtimeBudget.estimatedMultiplyAdds <= resolvedThresholds.estimatedMultiplyAddsMax ? 'pass' : 'warn',
    actual: artifacts.realtimeBudget.estimatedMultiplyAdds,
    threshold: resolvedThresholds.estimatedMultiplyAddsMax,
    reason: thresholds.requireMeasuredRealtimeFactor === true && artifacts.realtimeBudget.estimatedRealtimeFactor == null
      ? 'measured_realtime_factor_required'
      : 'scalar_float64_reference_budget_threshold',
  });

  const overall = checks.some((check) => check.state === 'fail')
    ? 'fail'
    : checks.some((check) => check.state === 'warn') ? 'warn' : 'pass';

  return {
    artifact: 'poly-sinc-formal-validation-reference',
    overall,
    checks,
    thresholds: resolvedThresholds,
  };
};

export const renderUzumeGaplessConcatReference = (
  input: UzumeReferenceGaplessConcatInput,
): UzumeReferenceGaplessConcatResult => {
  const sourceRate = normalizeRate(input.sourceRate);
  const targetRate = normalizeRate(input.targetRate);
  if (!sourceRate || !targetRate) {
    throw new Error('uzume_gapless_reference_requires_positive_rates');
  }
  if (input.segments.length < 2) {
    throw new Error('uzume_gapless_reference_requires_multiple_segments');
  }

  const segmentBlocks = input.segments.map((segment) => cloneChannels(segment.channels));
  const sourceConcat = concatenateChannelBlocks(segmentBlocks);
  const concat = renderUzumeResamplingReference({
    sourceRate,
    targetRate,
    channels: sourceConcat,
    tapCount: input.tapCount,
    phaseCount: input.phaseCount,
    cutoffRatio: input.cutoffRatio,
  });
  const ratio = targetRate / sourceRate;
  const noResetSegments: number[][][] = [];
  const resetSegments = segmentBlocks.map((segment) =>
    renderUzumeResamplingReference({
      sourceRate,
      targetRate,
      channels: segment,
      tapCount: input.tapCount,
      phaseCount: input.phaseCount,
      cutoffRatio: input.cutoffRatio,
    }).channels);
  let sourceFrameOffset = 0;
  let outputFrameOffset = 0;
  const boundaries: UzumeReferenceGaplessBoundaryReport[] = [];
  const totalOutputLength = concat.channels[0]?.length ?? 0;

  for (let segmentIndex = 0; segmentIndex < segmentBlocks.length; segmentIndex += 1) {
    const segmentLength = segmentBlocks[segmentIndex][0]?.length ?? 0;
    const nextSourceFrameOffset = sourceFrameOffset + segmentLength;
    const nextOutputFrameOffset = segmentIndex === segmentBlocks.length - 1
      ? totalOutputLength
      : Math.min(totalOutputLength, Math.max(outputFrameOffset, Math.round(nextSourceFrameOffset * ratio)));
    const expectedOutputLength = nextOutputFrameOffset - outputFrameOffset;
    const segmentOutput = concat.channels.map((channel) =>
      channel.slice(outputFrameOffset, outputFrameOffset + expectedOutputLength));
    noResetSegments.push(segmentOutput);

    if (segmentIndex > 0) {
      const boundaryWindowStart = Math.max(0, outputFrameOffset - 8);
      const boundaryWindowEnd = Math.min(concat.channels[0]?.length ?? 0, outputFrameOffset + 8);
      const concatWindow = concat.channels.map((channel) => channel.slice(boundaryWindowStart, boundaryWindowEnd));
      const noResetWindow = concatenateChannelBlocks([
        noResetSegments[segmentIndex - 1].map((channel) => channel.slice(Math.max(0, channel.length - (outputFrameOffset - boundaryWindowStart)))),
        segmentOutput.map((channel) => channel.slice(0, Math.max(0, boundaryWindowEnd - outputFrameOffset))),
      ]);
      const resetWindow = concatenateChannelBlocks([
        resetSegments[segmentIndex - 1].map((channel) => channel.slice(Math.max(0, channel.length - (outputFrameOffset - boundaryWindowStart)))),
        resetSegments[segmentIndex].map((channel) => channel.slice(0, Math.max(0, boundaryWindowEnd - outputFrameOffset))),
      ]);
      const concatFlat = flattenChannels(concatWindow);
      const noResetFlat = flattenChannels(noResetWindow);
      const resetFlat = flattenChannels(resetWindow);
      const leftBefore = concat.channels[0]?.[outputFrameOffset - 1] ?? 0;
      const leftAfter = concat.channels[0]?.[outputFrameOffset] ?? leftBefore;

      boundaries.push({
        beforeSegmentId: input.segments[segmentIndex - 1].id,
        afterSegmentId: input.segments[segmentIndex].id,
        sourceFrameOffset,
        outputFrameOffset,
        concatVsNoResetMaxAbs: maxAbsDiff(concatFlat, noResetFlat),
        resetVsConcatMaxAbs: maxAbsDiff(resetFlat, concatFlat),
        resetVsConcatRms: rmsError(resetFlat, concatFlat),
        outputJump: Math.abs(leftAfter - leftBefore),
      });
    }

    sourceFrameOffset = nextSourceFrameOffset;
    outputFrameOffset = nextOutputFrameOffset;
  }

  const noResetConcat = concatenateChannelBlocks(noResetSegments);
  const resetConcat = concatenateChannelBlocks(resetSegments);
  const concatFlat = flattenChannels(concat.channels);
  const noResetFlat = flattenChannels(noResetConcat);
  const resetFlat = flattenChannels(resetConcat);

  return {
    policy: 'source-pcm-concat-before-src',
    sourceRate,
    targetRate,
    ratio,
    concat,
    noResetSegments,
    resetSegments,
    boundaries,
    concatNullResidual: {
      state: 'concat-matches-no-reset',
      comparedFrames: Math.min(concat.channels[0]?.length ?? 0, noResetConcat[0]?.length ?? 0),
      maxAbs: maxAbsDiff(concatFlat, noResetFlat),
      rms: rmsError(concatFlat, noResetFlat),
    },
    resetResidual: {
      state: 'reset-vs-concat-reference',
      comparedFrames: Math.min(concat.channels[0]?.length ?? 0, resetConcat[0]?.length ?? 0),
      maxAbs: maxAbsDiff(resetFlat, concatFlat),
      rms: rmsError(resetFlat, concatFlat),
    },
  };
};

export const renderUzumeFirGaplessHistoryReference = (
  input: UzumeReferenceFirGaplessHistoryInput,
): UzumeReferenceFirGaplessHistoryResult => {
  const sampleRate = normalizeRate(input.sampleRate);
  if (!sampleRate) {
    throw new Error('uzume_fir_gapless_reference_requires_positive_rate');
  }
  if (input.segments.length < 2) {
    throw new Error('uzume_fir_gapless_reference_requires_multiple_segments');
  }

  const segmentBlocks = input.segments.map((segment) => cloneChannels(segment.channels));
  const channelCount = segmentBlocks[0]?.length ?? 0;
  if (channelCount <= 0) {
    throw new Error('uzume_fir_gapless_reference_requires_channels');
  }
  for (const block of segmentBlocks) {
    if (block.length !== channelCount) {
      throw new Error('uzume_fir_gapless_reference_requires_matching_channels');
    }
  }

  const responseChannels = cloneResponseChannels(input.responses, channelCount);
  const tailFrames = Math.max(0, Math.max(...responseChannels.map((response) => response.length)) - 1);
  const sourceConcat = concatenateChannelBlocks(segmentBlocks);
  const concat = sourceConcat.map((channel, channelIndex) =>
    convolveReference(channel, responseChannels[channelIndex] ?? [1]));
  const noResetSegments: number[][][] = [];
  const resetSegments: number[][][] = [];
  const boundaries: UzumeReferenceFirGaplessBoundaryReport[] = [];
  let sourceFrameOffset = 0;
  let outputFrameOffset = 0;

  for (let segmentIndex = 0; segmentIndex < segmentBlocks.length; segmentIndex += 1) {
    const segment = segmentBlocks[segmentIndex];
    const segmentLength = segment[0]?.length ?? 0;
    const isLastSegment = segmentIndex === segmentBlocks.length - 1;
    const outputLength = segmentLength + (isLastSegment ? tailFrames : 0);
    const segmentOutput = concat.map((channel) => channel.slice(outputFrameOffset, outputFrameOffset + outputLength));
    noResetSegments.push(segmentOutput);

    const resetRendered = segment.map((channel, channelIndex) =>
      convolveReference(channel, responseChannels[channelIndex] ?? [1]));
    resetSegments.push(resetRendered.map((channel) => channel.slice(0, outputLength)));

    if (segmentIndex > 0) {
      const boundaryWindowStart = Math.max(0, outputFrameOffset - Math.max(1, tailFrames));
      const boundaryWindowEnd = Math.min(concat[0]?.length ?? 0, outputFrameOffset + Math.max(1, tailFrames));
      const concatWindow = concat.map((channel) => channel.slice(boundaryWindowStart, boundaryWindowEnd));
      const noResetWindow = concatenateChannelBlocks([
        noResetSegments[segmentIndex - 1].map((channel) =>
          channel.slice(Math.max(0, channel.length - (outputFrameOffset - boundaryWindowStart)))),
        segmentOutput.map((channel) => channel.slice(0, Math.max(0, boundaryWindowEnd - outputFrameOffset))),
      ]);
      const resetWindow = concatenateChannelBlocks([
        resetSegments[segmentIndex - 1].map((channel) =>
          channel.slice(Math.max(0, channel.length - (outputFrameOffset - boundaryWindowStart)))),
        resetSegments[segmentIndex].map((channel) => channel.slice(0, Math.max(0, boundaryWindowEnd - outputFrameOffset))),
      ]);
      const concatFlat = flattenChannels(concatWindow);
      const noResetFlat = flattenChannels(noResetWindow);
      const resetFlat = flattenChannels(resetWindow);
      const leftBefore = concat[0]?.[outputFrameOffset - 1] ?? 0;
      const leftAfter = concat[0]?.[outputFrameOffset] ?? leftBefore;

      boundaries.push({
        beforeSegmentId: input.segments[segmentIndex - 1].id,
        afterSegmentId: input.segments[segmentIndex].id,
        sourceFrameOffset,
        outputFrameOffset,
        overlapHistoryFrames: tailFrames,
        concatVsNoResetMaxAbs: maxAbsDiff(concatFlat, noResetFlat),
        resetVsConcatMaxAbs: maxAbsDiff(resetFlat, concatFlat),
        resetVsConcatRms: rmsError(resetFlat, concatFlat),
        outputJump: Math.abs(leftAfter - leftBefore),
      });
    }

    sourceFrameOffset += segmentLength;
    outputFrameOffset += outputLength;
  }

  const noResetConcat = concatenateChannelBlocks(noResetSegments);
  const resetConcat = concatenateChannelBlocks(resetSegments);
  const concatFlat = flattenChannels(concat);
  const noResetFlat = flattenChannels(noResetConcat);
  const resetFlat = flattenChannels(resetConcat);

  return {
    artifact: 'fir-gapless-history-reference',
    policy: 'source-pcm-concat-before-fir',
    engine: 'direct-fir-float64-reference',
    sourceId: input.sourceId ?? 'direct-fir-gapless-reference',
    sampleRate,
    tailFrames,
    drainFrames: tailFrames,
    responseChannels,
    concat,
    noResetSegments,
    resetSegments,
    boundaries,
    concatNullResidual: {
      state: 'concat-matches-no-reset-history',
      comparedFrames: Math.min(concat[0]?.length ?? 0, noResetConcat[0]?.length ?? 0),
      maxAbs: maxAbsDiff(concatFlat, noResetFlat),
      rms: rmsError(concatFlat, noResetFlat),
    },
    resetResidual: {
      state: 'reset-vs-concat-history-reference',
      comparedFrames: Math.min(concat[0]?.length ?? 0, resetConcat[0]?.length ?? 0),
      maxAbs: maxAbsDiff(resetFlat, concatFlat),
      rms: rmsError(resetFlat, concatFlat),
    },
  };
};

const shortBridgeBlockReason = (
  input: UzumeReferenceContinuityStrategyInput,
  staleGeneration: boolean,
  fullProfileReady: boolean,
): string | null => {
  if (staleGeneration) {
    return 'stale_generation_rejected';
  }
  if (input.intent !== 'user-random-seek-or-skip') {
    return 'intent_requires_full_quality_profile';
  }
  if (input.policy !== 'random-access-short-bridge') {
    return 'policy_does_not_request_short_bridge';
  }
  if (input.userAllowsShortBridge !== true) {
    return 'user_policy_disallows_short_bridge';
  }
  if (input.shortBridgeAvailable !== true) {
    return 'short_bridge_candidate_unavailable';
  }
  if (fullProfileReady) {
    return 'full_profile_ready';
  }

  return null;
};

const normalizeFrameCount = (value: number | null | undefined): number =>
  isFiniteNumber(value) && value > 0 ? Math.round(value) : 0;

export const planUzumeCpuCallbackRingReference = (
  input: UzumeReferenceCpuCallbackRingInput,
): UzumeReferenceCpuCallbackRingResult => {
  const generationId = normalizeGenerationId(input.generationId);
  const candidateGenerationId = input.candidateGenerationId == null
    ? generationId
    : normalizeGenerationId(input.candidateGenerationId);
  const generationState = candidateGenerationId === generationId ? 'current' as const : 'stale-candidate' as const;
  const capacityFrames = Math.max(1, normalizeFrameCount(input.ringCapacityFrames));
  const callbackBlockFrames = Math.max(1, normalizeFrameCount(input.callbackBlockFrames));
  const beforeWriteFrames = Math.min(capacityFrames, normalizeFrameCount(input.initialCommittedFrames));
  const requestedProducedFrames = normalizeFrameCount(input.cpuProducedFrames);
  const commitAllowed = generationState === 'current';
  const writableFrames = Math.max(0, capacityFrames - beforeWriteFrames);
  const committedWriteFrames = commitAllowed ? Math.min(writableFrames, requestedProducedFrames) : 0;
  const droppedFrames = commitAllowed ? Math.max(0, requestedProducedFrames - committedWriteFrames) : requestedProducedFrames;
  const beforeReadFrames = beforeWriteFrames + committedWriteFrames;
  const callbackReadFrames = Math.min(callbackBlockFrames, beforeReadFrames);
  const missingFrames = Math.max(0, callbackBlockFrames - beforeReadFrames);
  const afterReadFrames = Math.max(0, beforeReadFrames - callbackBlockFrames);
  const renderAheadTargetFrames = normalizeFrameCount(input.renderAheadTargetFrames) || callbackBlockFrames * 2;
  const cpuRealtimeFactor = isFiniteNumber(input.cpuRealtimeFactor)
    ? Math.max(0, input.cpuRealtimeFactor)
    : null;
  const lowDepth = afterReadFrames < callbackBlockFrames;
  const belowTarget = afterReadFrames < renderAheadTargetFrames;
  const slowCpu = cpuRealtimeFactor !== null && cpuRealtimeFactor < 1.1;
  const marginalCpu = cpuRealtimeFactor !== null && cpuRealtimeFactor < 2;
  const state: UzumeReferenceCpuCallbackRingResult['state'] = missingFrames > 0
    ? 'underrun'
    : generationState === 'stale-candidate' || lowDepth || slowCpu
      ? 'underrun-risk'
      : belowTarget || marginalCpu ? 'low-depth' : 'stable';
  const status: UzumeReferenceCpuCallbackRingResult['underrunTelemetry']['status'] =
    state === 'stable' ? 'safe' : state === 'low-depth' ? 'marginal' : 'unsafe';
  const reasons: string[] = ['callback_reads_committed_cpu_full_profile'];

  if (generationState === 'stale-candidate') {
    reasons.push('stale_cpu_producer_rejected');
  } else {
    reasons.push('cpu_full_profile_write_committed');
  }
  if (droppedFrames > 0) {
    reasons.push(commitAllowed ? 'ring_capacity_limited_write' : 'stale_generation_write_dropped');
  }
  if (missingFrames > 0) {
    reasons.push('callback_ring_underrun_reported');
  } else if (state !== 'stable') {
    reasons.push('callback_ring_low_depth_warning');
  } else {
    reasons.push('callback_ring_depth_stable');
  }
  reasons.push('short_bridge_rejected_for_cpu_only_ring');

  return {
    artifact: 'cpu-callback-ring-reference',
    policy: 'cpu-full-profile-committed-ring',
    generationId,
    candidateGenerationId,
    generationState,
    state,
    callbackRule: 'read-committed-output-only',
    callbackMustNotWaitForGpu: true,
    shortBridgeAllowed: false,
    shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge',
    commitAllowed,
    ring: {
      capacityFrames,
      beforeWriteFrames,
      cpuProducedFrames: requestedProducedFrames,
      committedWriteFrames,
      droppedFrames,
      beforeReadFrames,
      callbackReadFrames,
      afterReadFrames,
      missingFrames,
      renderAheadTargetFrames,
    },
    underrunTelemetry: {
      status,
      underrunRisk: status !== 'safe',
      cpuRealtimeFactor,
      ringDepthFrames: afterReadFrames,
      ringDepthBlocks: afterReadFrames / callbackBlockFrames,
    },
    reasons,
  };
};

const callbackSafeUrgentControls = new Set<UzumeReferenceCallbackControlKind>([
  'pause',
  'resume',
  'stop',
  'mute',
  'volume',
  'declick',
]);

const normalizeLinearGain = (value: number | null | undefined, fallback: number): number =>
  isFiniteNumber(value) ? clamp(value, 0, 8) : fallback;

const targetGainForCallbackControl = (input: UzumeReferenceCallbackSafeControlInput): number => {
  const volumeGain = input.targetGain == null
    ? dbToGain(clamp(input.targetVolumeDb ?? 0, -120, 24))
    : normalizeLinearGain(input.targetGain, 1);

  if (input.control === 'pause' || input.control === 'stop') {
    return 0;
  }
  if (input.control === 'mute') {
    return input.mute === false ? volumeGain : 0;
  }

  return volumeGain;
};

export const renderUzumeCallbackSafeControlReference = (
  input: UzumeReferenceCallbackSafeControlInput,
): UzumeReferenceCallbackSafeControlResult => {
  const generationId = normalizeGenerationId(input.generationId);
  const candidateGenerationId = input.candidateGenerationId == null
    ? generationId
    : normalizeGenerationId(input.candidateGenerationId);
  const generationState = candidateGenerationId === generationId ? 'current' as const : 'stale-candidate' as const;
  const classification = callbackSafeUrgentControls.has(input.control)
    ? 'callback-safe-urgent-control' as const
    : 'render-state-boundary' as const;
  const committedBlock = cloneChannels(input.committedBlock);
  const inputPeak = maxAbs(flattenChannels(committedBlock));

  if (generationState === 'stale-candidate') {
    return {
      artifact: 'callback-safe-urgent-controls-reference',
      policy: 'urgent-controls-after-committed-output',
      control: input.control,
      classification,
      generationId,
      candidateGenerationId,
      generationState,
      state: 'stale-candidate-rejected',
      callbackRule: 'read-committed-output-only',
      renderCacheAction: 'reject-stale-generation',
      generationAfterControl: generationId,
      requiresRenderGraphRebuild: false,
      commitAllowed: false,
      output: [],
      gainEnvelope: [],
      declick: {
        enabled: false,
        frames: 0,
        startGain: 0,
        endGain: 0,
        maxStep: 0,
      },
      peak: {
        input: inputPeak,
        output: 0,
      },
      reasons: ['stale_generation_rejected', 'callback_keeps_prior_committed_output'],
    };
  }

  if (classification === 'render-state-boundary') {
    return {
      artifact: 'callback-safe-urgent-controls-reference',
      policy: 'urgent-controls-after-committed-output',
      control: input.control,
      classification,
      generationId,
      candidateGenerationId,
      generationState,
      state: 'render-cache-invalidated',
      callbackRule: 'read-committed-output-only',
      renderCacheAction: 'invalidate-generation',
      generationAfterControl: generationId + 1,
      requiresRenderGraphRebuild: true,
      commitAllowed: false,
      output: [],
      gainEnvelope: [],
      declick: {
        enabled: false,
        frames: 0,
        startGain: 0,
        endGain: 0,
        maxStep: 0,
      },
      peak: {
        input: inputPeak,
        output: 0,
      },
      reasons: [
        'transport_boundary_requires_generation_increment',
        'render_ahead_cache_invalidated',
        'callback_keeps_prior_committed_output',
      ],
    };
  }

  const frameCount = committedBlock[0]?.length ?? 0;
  const currentGain = normalizeLinearGain(
    input.currentGain,
    input.control === 'resume' ? 0 : 1,
  );
  const targetGain = targetGainForCallbackControl(input);
  const requestedDeclickFrames = normalizeFrameCount(input.declickFrames);
  const declickFrames = Math.min(frameCount, requestedDeclickFrames);
  const shouldRamp = declickFrames > 0 && Math.abs(targetGain - currentGain) > 1e-12;
  const gainEnvelope = Array.from({ length: frameCount }, (_, frame) => {
    if (!shouldRamp || frame >= declickFrames) {
      return {
        frame,
        gain: targetGain,
      };
    }

    const progress = declickFrames <= 1 ? 1 : frame / (declickFrames - 1);
    return {
      frame,
      gain: currentGain + (targetGain - currentGain) * progress,
    };
  });
  const output = committedBlock.map((channel) =>
    channel.map((sample, frame) => sample * (gainEnvelope[frame]?.gain ?? targetGain)));
  const maxStep = gainEnvelope.reduce((peak, gain, index) => {
    if (index === 0) {
      return peak;
    }

    return Math.max(peak, Math.abs(gain.gain - gainEnvelope[index - 1].gain));
  }, 0);
  const reasons = ['callback_safe_urgent_control', 'render_cache_preserved'];
  reasons.push(shouldRamp ? 'declick_gain_ramp' : 'constant_gain_applied');
  if (targetGain === 0) {
    reasons.push('output_gain_zeroed');
  }

  return {
    artifact: 'callback-safe-urgent-controls-reference',
    policy: 'urgent-controls-after-committed-output',
    control: input.control,
    classification,
    generationId,
    candidateGenerationId,
    generationState,
    state: 'applied',
    callbackRule: 'read-committed-output-then-apply-urgent-control',
    renderCacheAction: 'preserve',
    generationAfterControl: generationId,
    requiresRenderGraphRebuild: false,
    commitAllowed: true,
    output,
    gainEnvelope,
    declick: {
      enabled: shouldRamp,
      frames: shouldRamp ? declickFrames : 0,
      startGain: shouldRamp ? currentGain : targetGain,
      endGain: targetGain,
      maxStep,
    },
    peak: {
      input: inputPeak,
      output: maxAbs(flattenChannels(output)),
    },
    reasons,
  };
};

export const planUzumePreRollDeadlineReference = (
  input: UzumeReferencePreRollDeadlineInput,
): UzumeReferencePreRollDeadlineResult => {
  const sampleRate = normalizeRate(input.sampleRate);
  if (!sampleRate) {
    throw new Error('uzume_pre_roll_reference_requires_positive_rate');
  }

  const generationId = Math.max(0, Math.round(input.generationId));
  const candidateGenerationId = input.candidateGenerationId == null
    ? generationId
    : Math.max(0, Math.round(input.candidateGenerationId));
  const generationState = candidateGenerationId === generationId ? 'current' as const : 'stale-candidate' as const;
  const callbackBlockFrames = Math.max(1, normalizeFrameCount(input.callbackBlockFrames));
  const outputRingDepthFrames = normalizeFrameCount(input.outputRingDepthFrames);
  const lookaheadFrames = normalizeFrameCount(input.lookaheadFrames);
  const groupDelayFrames = normalizeFrameCount(input.groupDelayFrames);
  const firTailFrames = normalizeFrameCount(input.firTailFrames);
  const decodePrepareFrames = normalizeFrameCount(input.decodePrepareFrames);
  const framesUntilBoundary = normalizeFrameCount(input.currentRemainingFrames);
  const renderAheadTargetFrames = normalizeFrameCount(input.renderAheadTargetFrames);
  const renderAheadReadyFrames = normalizeFrameCount(input.renderAheadReadyFrames);
  const preRollRequiredFrames =
    lookaheadFrames + groupDelayFrames + firTailFrames + decodePrepareFrames + callbackBlockFrames + outputRingDepthFrames;
  const deadlineSlackFrames = framesUntilBoundary - preRollRequiredFrames;
  const preRollCanCompleteBeforeBoundary = deadlineSlackFrames >= 0;
  const fullProfileReady = input.nextProfileReady === true;
  const cacheHit = input.predictiveCacheHit === true ||
    (renderAheadTargetFrames > 0 && renderAheadReadyFrames >= renderAheadTargetFrames);
  const renderAheadState: UzumeReferencePreRollDeadlineResult['renderAhead']['state'] = fullProfileReady
    ? 'full-profile-ready'
    : cacheHit
      ? 'cache-hit'
      : renderAheadReadyFrames > 0 ? 'cache-warming' : 'cache-miss';
  const profileReadyBeforeBoundary = fullProfileReady || cacheHit;
  const currentSampleRate = normalizeRate(input.currentSampleRate) ?? sampleRate;
  const nextSampleRate = normalizeRate(input.nextSampleRate) ?? sampleRate;
  const currentChannelCount = input.currentChannelCount == null ? null : Math.max(1, Math.round(input.currentChannelCount));
  const nextChannelCount = input.nextChannelCount == null ? null : Math.max(1, Math.round(input.nextChannelCount));
  const requiresDualPipeline = currentSampleRate !== nextSampleRate ||
    (currentChannelCount !== null && nextChannelCount !== null && currentChannelCount !== nextChannelCount);
  const state: UzumeReferencePreRollDeadlineResult['state'] = generationState === 'stale-candidate'
    ? 'stale-candidate'
    : profileReadyBeforeBoundary
      ? 'ready'
      : deadlineSlackFrames < 0
        ? 'deadline-missed'
        : deadlineSlackFrames <= callbackBlockFrames ? 'start-pre-roll-now' : 'deadline-safe';
  const reasons: string[] = [];

  if (generationState === 'stale-candidate') {
    reasons.push('stale_generation_rejected', 'callback_keeps_prior_committed_output');
  } else if (profileReadyBeforeBoundary) {
    reasons.push(fullProfileReady ? 'full_profile_ready_before_boundary' : 'predictive_cache_generation_valid');
  } else if (deadlineSlackFrames < 0) {
    reasons.push('pre_roll_deadline_missed', 'wait_for_full_profile_no_short_bridge');
  } else if (deadlineSlackFrames <= callbackBlockFrames) {
    reasons.push('pre_roll_deadline_entered', 'start_n_plus_one_decode_prepare');
  } else {
    reasons.push('pre_roll_window_available', 'start_n_plus_one_decode_prepare');
  }
  reasons.push(requiresDualPipeline ? 'dual_pipeline_handoff_required' : 'same_pipeline_gapless_no_reset_possible');

  return {
    artifact: 'pre-roll-deadline-reference',
    policy: 'next-track-full-profile-before-boundary',
    currentTrackId: input.currentTrackId,
    nextTrackId: input.nextTrackId,
    sampleRate,
    generationState,
    state,
    preRollRequiredFrames,
    framesUntilBoundary,
    deadlineSlackFrames,
    preRollCanCompleteBeforeBoundary,
    renderAhead: {
      targetFrames: renderAheadTargetFrames,
      readyFrames: renderAheadReadyFrames,
      state: renderAheadState,
    },
    callbackRing: {
      callbackBlockFrames,
      outputRingDepthFrames,
      readRule: 'read-committed-output-only',
      mustNotWaitForGpu: true,
      committedBeforeBoundary: generationState === 'current' && profileReadyBeforeBoundary,
    },
    handoff: {
      currentSampleRate,
      nextSampleRate,
      currentChannelCount,
      nextChannelCount,
      requiresDualPipeline,
      strategy: requiresDualPipeline ? 'dual-pipeline-handoff' : 'same-pipeline-no-reset',
      declickOnly: requiresDualPipeline,
    },
    commitAllowed: generationState === 'current' && profileReadyBeforeBoundary,
    shortBridgeAllowed: false,
    shortBridgeReason: 'not_user_random_seek_or_skip',
    reasons,
  };
};

const normalizeGenerationId = (value: number): number => Math.max(0, Math.round(value));

const renderAheadEntryCovers = (
  entry: UzumeReferenceRenderAheadCacheEntryInput,
  requiredStartFrame: number,
  requiredFrames: number,
): boolean => {
  const startFrame = normalizeFrameCount(entry.startFrame);
  const frameCount = normalizeFrameCount(entry.frameCount);
  return startFrame <= requiredStartFrame && startFrame + frameCount >= requiredStartFrame + requiredFrames;
};

export const planUzumeRenderAheadCacheReference = (
  input: UzumeReferenceRenderAheadCacheInput,
): UzumeReferenceRenderAheadCacheResult => {
  const generationId = normalizeGenerationId(input.generationId);
  const requiredStartFrame = normalizeFrameCount(input.requiredStartFrame);
  const requiredFrames = Math.max(1, normalizeFrameCount(input.requiredFrames));
  const targetCallbackFrame = normalizeFrameCount(input.targetCallbackFrame);
  const callbackBlockFrames = Math.max(1, normalizeFrameCount(input.callbackBlockFrames));
  const budgetBytes = Math.max(0, normalizeFrameCount(input.cacheBudgetBytes));
  const entries = input.entries.map((entry) => ({
    ...entry,
    generationId: normalizeGenerationId(entry.generationId),
    startFrame: normalizeFrameCount(entry.startFrame),
    frameCount: normalizeFrameCount(entry.frameCount),
    bytes: normalizeFrameCount(entry.bytes),
    completedAtFrame: entry.completedAtFrame == null ? null : normalizeFrameCount(entry.completedAtFrame),
    distanceToBoundaryFrames: entry.distanceToBoundaryFrames == null
      ? Number.MAX_SAFE_INTEGER
      : normalizeFrameCount(entry.distanceToBoundaryFrames),
  }));
  const matching = entries.filter((entry) => entry.key === input.requestKey);
  const staleMatch = matching.find((entry) => entry.generationId !== generationId);
  const currentMatch = matching.find((entry) => entry.generationId === generationId);
  const coversRequest = currentMatch
    ? renderAheadEntryCovers(currentMatch, requiredStartFrame, requiredFrames)
    : false;
  const completedAtFrame = currentMatch?.completedAtFrame ?? null;
  const deadlineSlackFrames = completedAtFrame === null ? null : targetCallbackFrame - completedAtFrame;
  const readyBeforeCallback = completedAtFrame !== null && completedAtFrame <= targetCallbackFrame;
  let lookupState: UzumeReferenceRenderAheadCacheResult['lookupState'] = 'miss';
  let commitState: UzumeReferenceRenderAheadCacheResult['commitState'] = 'callback-keeps-prior-committed-output';
  const reasons: string[] = [];

  if (!currentMatch && staleMatch) {
    lookupState = 'stale-hit-rejected';
    commitState = 'reject-stale-generation';
    reasons.push('stale_generation_rejected', 'callback_keeps_prior_committed_output');
  } else if (currentMatch && !coversRequest) {
    lookupState = 'miss';
    reasons.push('cache_entry_does_not_cover_requested_range', 'callback_keeps_prior_committed_output');
  } else if (currentMatch && completedAtFrame === null) {
    lookupState = 'incomplete-hit';
    reasons.push('render_ahead_entry_not_complete', 'callback_keeps_prior_committed_output');
  } else if (currentMatch && !readyBeforeCallback) {
    lookupState = 'late-hit';
    commitState = 'retain-for-future-cache';
    reasons.push('generation_valid_but_late_for_callback_slot', 'retain_for_future_boundary_or_crossfade');
  } else if (currentMatch) {
    lookupState = 'hit';
    commitState = 'commit-to-callback-slot';
    reasons.push('cache_hit_generation_valid', 'completed_before_callback_slot');
  } else {
    reasons.push('cache_miss', 'callback_keeps_prior_committed_output');
  }

  const bytesBeforeEvict = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const evictions: UzumeReferenceRenderAheadCacheResult['evictions'] = [];
  const retained = entries.filter((entry) => {
    if (entry.generationId !== generationId) {
      evictions.push({ key: entry.key, reason: 'stale-generation' });
      return false;
    }

    return true;
  });
  retained.sort((left, right) =>
    (right.distanceToBoundaryFrames ?? Number.MAX_SAFE_INTEGER) - (left.distanceToBoundaryFrames ?? Number.MAX_SAFE_INTEGER) ||
    right.bytes - left.bytes ||
    left.key.localeCompare(right.key));

  let bytesAfterEvict = retained.reduce((sum, entry) => sum + entry.bytes, 0);
  const finalEntries = retained.slice();
  for (const entry of retained) {
    if (bytesAfterEvict <= budgetBytes) {
      break;
    }
    if (entry.key === input.requestKey && lookupState === 'hit') {
      continue;
    }

    const index = finalEntries.findIndex((candidate) => candidate.key === entry.key);
    if (index >= 0) {
      finalEntries.splice(index, 1);
      bytesAfterEvict -= entry.bytes;
      evictions.push({ key: entry.key, reason: 'over-budget-farthest-from-boundary' });
    }
  }

  const commitAllowed = lookupState === 'hit' && finalEntries.some((entry) => entry.key === input.requestKey);
  if (!commitAllowed && commitState === 'commit-to-callback-slot') {
    commitState = 'callback-keeps-prior-committed-output';
    reasons.push('requested_entry_evicted_before_commit');
  }
  if (evictions.some((eviction) => eviction.reason === 'over-budget-farthest-from-boundary')) {
    reasons.push('cache_budget_evicted_farthest_future_entries');
  }

  return {
    artifact: 'render-ahead-cache-reference',
    policy: 'generation-safe-render-ahead-cache',
    generationId,
    requestKey: input.requestKey,
    lookupState,
    commitState,
    commitAllowed,
    callbackRule: 'read-committed-output-only',
    callbackMustNotWaitForGpu: true,
    requestedEntry: currentMatch
      ? {
          key: currentMatch.key,
          generationId: currentMatch.generationId,
          coversRequest,
          completedAtFrame,
          deadlineSlackFrames,
        }
      : null,
    cacheStats: {
      budgetBytes,
      bytesBeforeEvict,
      bytesAfterEvict,
      entryCountBeforeEvict: entries.length,
      entryCountAfterEvict: finalEntries.length,
    },
    evictions,
    retainedKeys: finalEntries.map((entry) => entry.key).sort(),
    reasons,
  };
};

type NormalizedFallbackCandidate = {
  kind: UzumeReferenceFallbackCandidateKind;
  generationId: number;
  channels: number[][];
  completedAtFrame: number | null;
  frameCount: number;
  channelCount: number;
};

const normalizeFallbackCandidate = (
  candidate: UzumeReferenceFallbackCandidateInput | null | undefined,
): NormalizedFallbackCandidate | null => {
  if (!candidate) {
    return null;
  }

  const channels = cloneChannels(candidate.channels);
  return {
    kind: candidate.kind,
    generationId: normalizeGenerationId(candidate.generationId),
    channels,
    completedAtFrame: candidate.completedAtFrame == null ? null : normalizeFrameCount(candidate.completedAtFrame),
    frameCount: channels[0]?.length ?? 0,
    channelCount: channels.length,
  };
};

const candidateHasExpectedShape = (
  candidate: NormalizedFallbackCandidate | null,
  expectedChannels: number,
  callbackBlockFrames: number,
): boolean =>
  candidate !== null &&
  candidate.channelCount === expectedChannels &&
  candidate.frameCount >= callbackBlockFrames;

const sliceFallbackCandidate = (
  candidate: NormalizedFallbackCandidate,
  callbackBlockFrames: number,
): number[][] =>
  candidate.channels.map((channel) => channel.slice(0, callbackBlockFrames));

const createSilenceBlock = (channels: number, frames: number): number[][] =>
  Array.from({ length: channels }, () => Array.from({ length: frames }, () => 0));

export const simulateUzumeFallbackInjectionReference = (
  input: UzumeReferenceFallbackInjectionInput,
): UzumeReferenceFallbackInjectionResult => {
  const generationId = normalizeGenerationId(input.generationId);
  const targetCallbackFrame = normalizeFrameCount(input.targetCallbackFrame);
  const callbackBlockFrames = Math.max(1, normalizeFrameCount(input.callbackBlockFrames));
  const expectedChannels = Math.max(1, Math.round(input.expectedChannels));
  const callbackRingDepthFrames = normalizeFrameCount(input.callbackRingDepthFrames);
  const renderAheadDepthFrames = normalizeFrameCount(input.renderAheadDepthFrames);
  const renderAheadTargetFrames = normalizeFrameCount(input.renderAheadTargetFrames);
  const rollingRealtimeFactor = isFiniteNumber(input.rollingRealtimeFactor)
    ? Math.max(0, input.rollingRealtimeFactor)
    : null;
  const gpu = normalizeFallbackCandidate(input.gpuCandidate);
  const cpu = normalizeFallbackCandidate(input.cpuCandidate);
  const prior = normalizeFallbackCandidate(input.priorCommittedCandidate);
  const rejectedCandidates: UzumeReferenceFallbackInjectionResult['rejectedCandidates'] = [];
  const reasons: string[] = ['callback_does_not_wait_for_gpu'];

  const rejectIfInvalid = (candidate: NormalizedFallbackCandidate | null): boolean => {
    if (!candidate) {
      return false;
    }
    if (candidate.generationId !== generationId) {
      rejectedCandidates.push({ kind: candidate.kind, reason: 'stale-generation' });
      return true;
    }
    if (!candidateHasExpectedShape(candidate, expectedChannels, callbackBlockFrames)) {
      rejectedCandidates.push({ kind: candidate.kind, reason: 'empty-or-shape-mismatch' });
      return true;
    }
    if (candidate.completedAtFrame === null && candidate.kind !== 'prior-committed') {
      rejectedCandidates.push({ kind: candidate.kind, reason: 'incomplete' });
      return true;
    }
    if (candidate.completedAtFrame !== null && candidate.completedAtFrame > targetCallbackFrame) {
      rejectedCandidates.push({ kind: candidate.kind, reason: 'late-for-callback' });
      return true;
    }

    return false;
  };

  const gpuRejected = rejectIfInvalid(gpu);
  const cpuRejected = rejectIfInvalid(cpu);
  const priorRejected = rejectIfInvalid(prior);
  const gpuReady = gpu !== null && !gpuRejected;
  const cpuReady = cpu !== null && !cpuRejected;
  const priorReady = prior !== null && !priorRejected;
  const gpuDeadlineState: UzumeReferenceFallbackInjectionResult['gpuCandidate']['deadlineState'] =
    !gpu
      ? 'missing'
      : gpu.completedAtFrame === null
        ? 'incomplete'
        : gpu.completedAtFrame > targetCallbackFrame ? 'late-for-callback' : 'ready-before-callback';
  const gpuGenerationState: UzumeReferenceFallbackInjectionResult['gpuCandidate']['generationState'] =
    !gpu ? 'missing' : gpu.generationId === generationId ? 'current' : 'stale-candidate';
  const gpuDeadlineMissFrames = gpu?.completedAtFrame == null ? null : Math.max(0, gpu.completedAtFrame - targetCallbackFrame);
  let selectedSource: UzumeReferenceFallbackInjectionResult['selectedSource'] = null;
  let state: UzumeReferenceFallbackInjectionResult['state'] = 'silence-injected';
  let output: number[][] = [];

  if (gpuReady && gpu) {
    selectedSource = 'gpu-render-ahead';
    state = 'gpu-render-ahead-commit';
    output = sliceFallbackCandidate(gpu, callbackBlockFrames);
    reasons.push('gpu_render_ahead_ready_before_callback');
  } else if (cpuReady && cpu) {
    selectedSource = 'cpu-main-chain';
    state = 'cpu-main-chain-fallback';
    output = sliceFallbackCandidate(cpu, callbackBlockFrames);
    reasons.push('cpu_full_profile_fallback_used');
  } else if (priorReady && prior) {
    selectedSource = 'prior-committed';
    state = 'prior-committed-fallback';
    output = sliceFallbackCandidate(prior, callbackBlockFrames);
    reasons.push('prior_committed_output_reused');
  } else if (input.allowSilenceFallback !== false) {
    selectedSource = 'silence';
    state = 'silence-injected';
    output = createSilenceBlock(expectedChannels, callbackBlockFrames);
    reasons.push('controlled_silence_injected', 'underrun_telemetry_reported');
  } else {
    state = 'stale-candidate-rejected';
    reasons.push('no_generation_valid_output_available');
  }

  if (gpu && gpu.generationId !== generationId) {
    reasons.push('stale_gpu_candidate_rejected');
  } else if (gpuDeadlineState === 'late-for-callback') {
    reasons.push('late_gpu_candidate_retained_for_future');
  } else if (gpuDeadlineState === 'incomplete') {
    reasons.push('incomplete_gpu_candidate_not_committed');
  }

  const missingOutputFrames = selectedSource === null ? callbackBlockFrames : 0;
  const injectedSilenceFrames = selectedSource === 'silence' ? callbackBlockFrames : 0;
  const lowRing = callbackRingDepthFrames > 0 && callbackRingDepthFrames < callbackBlockFrames;
  const renderAheadBelowTarget = renderAheadTargetFrames > 0 && renderAheadDepthFrames < renderAheadTargetFrames;
  const realtimeUnsafe = rollingRealtimeFactor !== null && rollingRealtimeFactor < 1.1;
  const realtimeMarginal = rollingRealtimeFactor !== null && rollingRealtimeFactor < 2;
  const status: UzumeReferenceFallbackInjectionResult['underrunTelemetry']['status'] =
    injectedSilenceFrames > 0 || missingOutputFrames > 0 || lowRing || realtimeUnsafe
      ? 'unsafe'
      : renderAheadBelowTarget || realtimeMarginal || state !== 'gpu-render-ahead-commit'
        ? 'marginal'
        : 'safe';
  const commitAllowed = selectedSource !== null;
  const fallbackInjected = selectedSource === 'cpu-main-chain' || selectedSource === 'prior-committed' || selectedSource === 'silence';
  if (fallbackInjected && selectedSource !== 'silence') {
    reasons.push('controlled_fallback_injected');
  }
  reasons.push('short_bridge_rejected_for_underrun_protection');

  return {
    artifact: 'fallback-injection-underrun-reference',
    policy: 'callback-never-waits-for-gpu',
    generationId,
    targetCallbackFrame,
    callbackBlockFrames,
    expectedChannels,
    state,
    selectedSource,
    output,
    callbackMustNotWaitForGpu: true,
    shortBridgeAllowed: false,
    shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge',
    commitAllowed,
    fallbackInjected,
    qualityRollback: selectedSource === 'silence'
      ? 'silence-underrun'
      : fallbackInjected ? 'controlled-fallback' : 'none',
    gpuCandidate: {
      present: gpu !== null,
      generationState: gpuGenerationState,
      deadlineState: gpuDeadlineState,
      deadlineMissFrames: gpuDeadlineMissFrames,
      retainedForFuture: gpuGenerationState === 'current' && gpuDeadlineState === 'late-for-callback',
    },
    underrunTelemetry: {
      status,
      underrunRisk: status !== 'safe',
      injectedSilenceFrames,
      missingOutputFrames,
      callbackRingDepthFrames,
      renderAheadDepthFrames,
      renderAheadTargetFrames,
      rollingRealtimeFactor,
    },
    peak: {
      output: maxAbs(flattenChannels(output)),
    },
    rejectedCandidates,
    reasons,
  };
};

export const renderUzumeEqualPowerCrossfadeReference = (
  input: UzumeReferenceEqualPowerCrossfadeInput,
): UzumeReferenceEqualPowerCrossfadeResult => {
  const sampleRate = normalizeRate(input.sampleRate);
  if (!sampleRate) {
    throw new Error('uzume_equal_power_crossfade_reference_requires_positive_rate');
  }

  const shortBridge = cloneChannels(input.shortBridge);
  const fullProfile = cloneChannels(input.fullProfile);
  const fadeFrames = Math.max(1, Math.round(input.fadeFrames));
  const comparedFrames = Math.min(fadeFrames, shortBridge[0]?.length ?? 0, fullProfile[0]?.length ?? 0);
  const rejectedReason: UzumeReferenceEqualPowerCrossfadeResult['rejectionReason'] =
    input.intent !== 'user-random-seek-or-skip'
      ? 'intent_not_user_random_seek_or_skip'
      : input.fullProfileReady !== true
        ? 'full_profile_not_ready'
        : comparedFrames < fadeFrames ? 'insufficient_overlap' : null;

  if (rejectedReason !== null) {
    return {
      artifact: 'equal-power-crossfade-reference',
      policy: 'random-access-short-bridge-to-full-profile-only',
      intent: input.intent,
      sampleRate,
      fadeFrames,
      durationMs: (fadeFrames / sampleRate) * 1000,
      state: 'rejected',
      rejectionReason: rejectedReason,
      shortBridgeGainStartsAt: 1,
      fullProfileGainEndsAt: 1,
      output: [],
      gains: [],
      gainLaw: {
        state: 'not-applicable',
        maxPowerSumError: 0,
        midpointShortBridgeGain: null,
        midpointFullProfileGain: null,
      },
      residualVsHardSwitch: {
        state: 'not-applicable',
        comparedFrames: 0,
        maxAbs: null,
        rms: null,
      },
      peak: {
        shortBridge: maxAbs(flattenChannels(shortBridge)),
        fullProfile: maxAbs(flattenChannels(fullProfile)),
        output: 0,
      },
    };
  }

  const gains = Array.from({ length: fadeFrames }, (_, frame) => {
    const progress = fadeFrames <= 1 ? 1 : frame / (fadeFrames - 1);
    const angle = progress * Math.PI * 0.5;
    const shortBridgeGain = Math.cos(angle);
    const fullProfileGain = Math.sin(angle);
    return {
      frame,
      shortBridgeGain,
      fullProfileGain,
      powerSum: shortBridgeGain * shortBridgeGain + fullProfileGain * fullProfileGain,
    };
  });
  const output = shortBridge.map((channel, channelIndex) =>
    Array.from({ length: fadeFrames }, (_, frame) =>
      (channel[frame] ?? 0) * gains[frame].shortBridgeGain +
      (fullProfile[channelIndex]?.[frame] ?? 0) * gains[frame].fullProfileGain));
  const hardSwitchFrame = Math.floor(fadeFrames / 2);
  const hardSwitch = shortBridge.map((channel, channelIndex) =>
    Array.from({ length: fadeFrames }, (_, frame) =>
      frame < hardSwitchFrame ? (channel[frame] ?? 0) : (fullProfile[channelIndex]?.[frame] ?? 0)));
  const outputFlat = flattenChannels(output);
  const hardSwitchFlat = flattenChannels(hardSwitch);
  const residualMaxAbs = maxAbsDiff(outputFlat, hardSwitchFlat);
  const midpoint = gains[Math.floor(fadeFrames / 2)] ?? null;

  return {
    artifact: 'equal-power-crossfade-reference',
    policy: 'random-access-short-bridge-to-full-profile-only',
    intent: input.intent,
    sampleRate,
    fadeFrames,
    durationMs: (fadeFrames / sampleRate) * 1000,
    state: 'crossfade-rendered',
    rejectionReason: null,
    shortBridgeGainStartsAt: 1,
    fullProfileGainEndsAt: 1,
    output,
    gains,
    gainLaw: {
      state: 'equal-power',
      maxPowerSumError: gains.reduce((peak, gain) => Math.max(peak, Math.abs(gain.powerSum - 1)), 0),
      midpointShortBridgeGain: midpoint?.shortBridgeGain ?? null,
      midpointFullProfileGain: midpoint?.fullProfileGain ?? null,
    },
    residualVsHardSwitch: {
      state: residualMaxAbs > 1e-12 ? 'measured-crossfade-difference' : 'matches-for-input',
      comparedFrames: fadeFrames,
      maxAbs: residualMaxAbs,
      rms: rmsError(outputFlat, hardSwitchFlat),
    },
    peak: {
      shortBridge: maxAbs(flattenChannels(shortBridge)),
      fullProfile: maxAbs(flattenChannels(fullProfile)),
      output: maxAbs(outputFlat),
    },
  };
};

export const planUzumeContinuityStrategyReference = (
  input: UzumeReferenceContinuityStrategyInput,
): UzumeReferenceContinuityStrategyResult => {
  const generationId = Math.max(0, Math.round(input.generationId));
  const candidateGenerationId = input.candidateGenerationId == null
    ? generationId
    : Math.max(0, Math.round(input.candidateGenerationId));
  const staleGeneration = candidateGenerationId !== generationId;
  const callbackRule = 'read-committed-output-only' as const;
  const gpuReady = input.gpuFullProfileReady === true;
  const cpuReady = input.cpuFullProfileReady === true || (input.fullProfileReady === true && !gpuReady);
  const fullReady = input.fullProfileReady === true || cpuReady || gpuReady;
  const shortBridgeReason = shortBridgeBlockReason(input, staleGeneration, fullReady);
  const shortBridgeAllowed = shortBridgeReason === null;
  const predictiveCacheHit = input.predictiveCacheHit === true;
  const gpuWaitPreferred =
    input.policy === 'gpu-wait' ||
    (input.gpuPreferredForAcousticNoise === true && input.playbackAlreadyStarted !== true);
  const waitTarget = (): UzumeReferenceContinuityStrategyResult['waitTarget'] => {
    if (gpuWaitPreferred && input.playbackAlreadyStarted !== true) {
      return 'gpu-full-profile';
    }
    if (input.policy === 'predictive-cache' || input.intent === 'cache-miss') {
      return 'predictive-cache-or-full-profile';
    }

    return 'cpu-or-gpu-full-profile';
  };
  const base = {
    artifact: 'continuity-quality-policy-reference' as const,
    intent: input.intent,
    policy: input.policy,
    generationState: staleGeneration ? 'stale-candidate' as const : 'current' as const,
    callbackRule,
    shortBridgeAllowed,
    shortBridgeReason,
  };

  if (staleGeneration) {
    return {
      ...base,
      selectedPath: 'reject-stale-generation',
      commitAllowed: false,
      mustKeepFullProfile: false,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'none',
      reasons: ['stale_generation_rejected', 'callback_keeps_prior_committed_output'],
    };
  }

  if (predictiveCacheHit) {
    return {
      ...base,
      selectedPath: 'predictive-cache',
      commitAllowed: true,
      mustKeepFullProfile: false,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'none',
      reasons: ['predictive_cache_generation_valid', 'full_quality_cache_preferred_over_short_bridge'],
    };
  }

  if (gpuWaitPreferred && !gpuReady && input.playbackAlreadyStarted !== true) {
    return {
      ...base,
      selectedPath: 'wait-for-full-profile',
      commitAllowed: false,
      mustKeepFullProfile: true,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'gpu-full-profile',
      reasons: ['controlled_gpu_wait_before_callback', shortBridgeReason ?? 'short_bridge_not_considered'],
    };
  }

  if (fullReady) {
    return {
      ...base,
      selectedPath: gpuReady ? 'gpu-full-profile' : 'cpu-full-profile',
      commitAllowed: true,
      mustKeepFullProfile: false,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'none',
      reasons: [gpuReady ? 'gpu_full_profile_ready' : 'cpu_full_profile_ready'],
    };
  }

  if (shortBridgeAllowed) {
    return {
      ...base,
      selectedPath: 'random-access-short-bridge',
      commitAllowed: true,
      mustKeepFullProfile: true,
      requiresEqualPowerCrossfade: true,
      qualityRollback: 'short-bridge-temporary',
      waitTarget: 'cpu-or-gpu-full-profile',
      reasons: ['user_random_seek_or_skip', 'temporary_short_bridge_until_full_profile_ready'],
    };
  }

  return {
    ...base,
    selectedPath: 'wait-for-full-profile',
    commitAllowed: false,
    mustKeepFullProfile: true,
    requiresEqualPowerCrossfade: false,
    qualityRollback: 'none',
    waitTarget: waitTarget(),
    reasons: [shortBridgeReason ?? 'full_profile_not_ready'],
  };
};
