import { describe, expect, it } from 'vitest';
import type { ChannelBalanceState } from '../../shared/types/audio';
import type { EqState, RoomCorrectionState } from '../../shared/types/eq';
import type { AudioProbeResult, SampleRatePlan } from './audioTypes';
import {
  analyzeUzumeSharedConvolutionResponsePreflightReference,
  analyzeUzumePcmIngressGuardReference,
  compileUzumeReferencePlan,
  createUzumeResamplingApodizingReferenceArtifact,
  createUzumeResamplingPhaseModeReferenceArtifacts,
  createUzumeResamplingReferenceArtifacts,
  planUzumeDsdFamilyPathReference,
  planUzumeCpuCallbackRingReference,
  planUzumeOutputResamplingRiskReference,
  planUzumePreRollDeadlineReference,
  planUzumeRenderAheadCacheReference,
  planUzumeResamplingQualityRollbackReference,
  planUzumeSharedConvolutionReference,
  planUzumeSharedConvolutionDuplicateGuardReference,
  planUzumeContinuityStrategyReference,
  renderUzumeBitPerfectBypassReference,
  renderUzumeBlockBoundarySplitReference,
  renderUzumeCallbackSafeControlReference,
  renderUzumeChannelScopeReference,
  renderUzumeEqualPowerCrossfadeReference,
  renderUzumeFirGaplessHistoryReference,
  renderUzumeFlushDrainReference,
  renderUzumeGaplessConcatReference,
  renderUzumeGainStagingReference,
  renderUzumeIirEqReference,
  renderUzumePcmReference,
  renderUzumePerEarEqPlacementReference,
  renderUzumePcmOutputQuantizationReference,
  renderUzumeResponseResampleReference,
  renderUzumeResamplingReference,
  renderUzumeSharedConvolutionSerialReference,
  renderUzumeStereoMatrixFilterReference,
  simulateUzumeFallbackInjectionReference,
  validateUzumeResamplingReferenceArtifacts,
} from './UzumeReferencePlan';

const pcmProbe = (overrides: Partial<AudioProbeResult> = {}): AudioProbeResult => ({
  filePath: 'track.flac',
  durationSeconds: 120,
  fileSampleRate: 44100,
  channels: 2,
  codec: 'FLAC',
  bitDepth: 24,
  bitrate: 1200000,
  ...overrides,
});

const plan = (overrides: Partial<SampleRatePlan> = {}): SampleRatePlan => ({
  fileSampleRate: 44100,
  decoderOutputSampleRate: 44100,
  requestedOutputSampleRate: 44100,
  actualDeviceSampleRate: 44100,
  sharedDeviceSampleRate: null,
  dsdOutputMode: 'pcm',
  dsdNativeSampleRate: null,
  dsdTransportSampleRate: null,
  outputMode: 'exclusive',
  resampling: false,
  echoSrcMode: 'off',
  echoSrcQualityProfile: 'transparent',
  echoSrcTargetSampleRate: null,
  echoSrcActive: false,
  bitPerfectCandidate: true,
  sampleRateMismatch: false,
  asioCompatibilityProfile: null,
  warnings: [],
  ...overrides,
});

const eqState = (overrides: Partial<EqState> = {}): EqState => ({
  enabled: false,
  preampDb: 0,
  dspHeadroomDb: 0,
  dspSafetyLimiterEnabled: true,
  bands: [
    { frequencyHz: 1000, gainDb: 0, q: 1, filterType: 'peaking', enabled: true },
  ],
  presetId: 'flat',
  presetName: 'Flat',
  clippingRisk: false,
  ...overrides,
});

const channelBalanceState = (overrides: Partial<ChannelBalanceState> = {}): ChannelBalanceState => ({
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  bandGains: {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  },
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
  ...overrides,
});

const roomCorrectionState = (overrides: Partial<RoomCorrectionState> = {}): RoomCorrectionState => ({
  enabled: false,
  status: 'empty',
  irId: null,
  irName: null,
  channelMode: 'none',
  sampleRate: null,
  tapCount: 0,
  trimDb: 0,
  latencySamples: 0,
  clippingRisk: false,
  error: null,
  ...overrides,
});

const compile = (overrides: Partial<Parameters<typeof compileUzumeReferencePlan>[0]> = {}) =>
  compileUzumeReferencePlan({
    probe: pcmProbe(),
    sampleRatePlan: plan(),
    outputMode: 'exclusive',
    activeDsdOutputMode: null,
    requestedDsdOutputMode: 'pcm',
    eqState: eqState(),
    channelBalanceState: channelBalanceState(),
    roomCorrectionState: roomCorrectionState(),
    dspActive: false,
    dspModuleActive: false,
    replayGainActive: false,
    chainedPlaybackActive: false,
    gaplessActive: false,
    echoSrcActive: false,
    bitPerfectDisabledReason: null,
    currentResamplerEngine: null,
    nativeFormatPath: null,
    nativeBitPerfectState: null,
    nativeDirectDisabledReason: null,
    ...overrides,
  });

describe('UZUME reference plan compiler', () => {
  it('explains a PCM direct reference plan without skeleton placeholder reasons', () => {
    const compiled = compile({
      sampleRatePlan: plan({
        requestedOutputSampleRate: 48000,
        actualDeviceSampleRate: 48000,
        outputMode: 'shared',
        resampling: true,
        bitPerfectCandidate: false,
      }),
      outputMode: 'shared',
      currentResamplerEngine: 'default',
    });

    expect(compiled.formatPath).toBe('pcm_bitperfect');
    expect(compiled.formatPathPlan.pcm_bitperfect).toEqual({
      state: 'current',
      reason: 'shared_output_resampling_or_mixer_rate_difference',
    });
    expect(compiled.formatPathPlan.dsd_direct?.reason).toBe('requires_dsd_source');
    expect(compiled.formatPathPlan.dsd_upsampling?.reason).toBe('requires_dsd_source');
    expect(compiled.formatPathPlan.d2p_processed?.reason).toBe('d2p_requires_dsd_source');
    expect(compiled.formatPathPlan.sdm_processed?.reason).toBe('sdm_reference_engine_not_ready');
    expect(JSON.stringify(compiled.formatPathPlan)).not.toContain('source_is_pcm');
    expect(JSON.stringify(compiled.formatPathPlan)).not.toContain('sdm_engine_not_ready');
    expect(compiled.outputDevicePolicy).toMatchObject({
      artifact: 'output-device-policy-reference',
      formatPath: 'pcm_bitperfect',
      outputMode: 'shared',
      deviceCapability: 'shared-mixer',
      state: 'shared-mixer-risk',
      sourceContainer: 'pcm',
      outputContainer: 'pcm',
      fileRate: 44100,
      decoderOutputRate: 44100,
      requestedOutputRate: 48000,
      actualDeviceRate: 48000,
      sharedDeviceRate: null,
      bitPerfectCandidate: false,
      resampling: true,
      sampleRateMismatch: false,
      recommendation: 'prefer-exclusive-or-device-rate-match',
      reasons: ['shared_or_system_output_may_use_mixer_resampling', 'output_device_policy_reference_only'],
    });
    expect(compiled.backendSupport).toMatchObject({
      artifact: 'backend-support-reference',
      policy: 'reference-backend-only-no-runtime-switch',
      formatPath: 'pcm_bitperfect',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      outputDevicePolicyState: 'shared-mixer-risk',
      cpuReference: {
        state: 'available',
        role: 'deterministic-reference',
      },
      cpuAvx: {
        state: 'future-production-gate',
        gate: 'rpc-003-cpu-realtime-gate',
      },
      gpu: {
        state: 'future-render-ahead-gate',
        gate: 'rpc-005-gpu-render-ahead-gate',
      },
      legacy: {
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
    expect(compiled.latencyBudget).toMatchObject({
      artifact: 'latency-budget-reference',
      policy: 'reference-budget-summary-no-runtime-scheduler',
      state: 'ready',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      outputDevicePolicyState: 'shared-mixer-risk',
      srcLookaheadSamples: expect.any(Number),
      convolutionLatencyClass: 'inactive',
      callbackRule: 'read-committed-output-only',
      schedulerState: 'reference-only',
      reasons: [
        'latency_budget_summary_derived_from_reference_reports',
        'cpu_float64_reference_only_no_runtime_scheduler',
        'callback_reads_committed_output_only',
        'production_latency_compensation_deferred_to_realtime_gate',
      ],
    });
    expect(compiled.readinessContract).toMatchObject({
      artifact: 'readiness-contract-reference',
      policy: 'main-playback-owns-timeline-uzume-reports-readiness',
      state: 'waiting-for-full-profile',
      intent: 'normal-playlist-boundary',
      playbackPolicy: 'predictive-cache',
      selectedPath: 'wait-for-full-profile',
      waitTarget: 'predictive-cache-or-full-profile',
      fullProfileReady: false,
      gpuPrewarmReady: false,
      gpuPrewarmState: 'future-render-ahead-gate',
      cacheState: 'miss',
      shortBridgeCandidate: 'blocked',
      generationCommitRule: 'current-generation-only',
      staleGenerationCommitAllowed: false,
      productionScheduler: 'not-enabled',
      reasons: [
        'readiness_summary_derived_from_reference_reports',
        'main_playback_logic_owns_timeline_and_policy',
        'gpu_prewarm_deferred_to_render_ahead_gate',
        'stale_generation_commit_disallowed',
        'readiness_contract_reference_only',
      ],
    });
    expect(compiled.generationCacheKey).toMatchObject({
      artifact: 'generation-cache-key-reference',
      policy: 'generation-safe-cache-key-contract-reference',
      state: 'ready',
      generationId: 1,
      generationSource: 'playback-intent-reference',
      timelineScope: 'normal-next-track-head',
      trackRole: 'next-track-head',
      sourceIdentity: 'next-reference',
      albumSegmentKey: null,
      albumSegmentIndex: null,
      requestKey: 'next-head:reference:0',
      staleCommitRule: 'reject-stale-generation',
      callbackSlotRule: 'late-current-generation-retain-for-future-only',
      evictionRule: 'stale-then-farthest-from-boundary',
      rendererControl: 'inspect-only',
      reasons: [
        'cache_key_includes_generation_profile_device_and_timeline',
        'album_segments_use_segment_index_when_gapless',
        'file_path_alone_is_not_a_valid_cache_key',
        'renderer_may_inspect_but_not_mutate_cache_keys',
        'generation_cache_key_reference_only',
      ],
    });
    expect(compiled.generationCacheKey.cacheKey).toContain('generation:1');
    expect(compiled.generationCacheKey.cacheKey).toContain('timeline:normal-next-track-head');
    expect(compiled.generationCacheKey.profileFingerprint).toMatch(/^profile:[0-9a-f]{8}$/u);
    expect(compiled.generationCacheKey.deviceFingerprint).toMatch(/^device:[0-9a-f]{8}$/u);
    expect(compiled.realtimeBudgetSummary).toMatchObject({
      artifact: 'realtime-budget-summary-reference',
      policy: 'reference-budget-no-measured-runtime-factor',
      state: 'offline-reference-only',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      measuredRealtimeFactor: null,
      measuredRealtimeFactorState: 'not-measured-in-rpc002',
      srcBudgetBackend: 'scalar-float64-reference',
      srcEstimatedRealtimeFactor: null,
      srcSafetyClass: 'offline-reference-only',
      callbackRingTelemetryStatus: 'safe',
      cpuFullProfileFallback: 'reference-available',
      gpuRealtimeFactor: null,
      realtimeSafetyGate: 'rpc-003-cpu-realtime-gate',
      gpuRenderAheadGate: 'rpc-005-gpu-render-ahead-gate',
      rendererControl: 'inspect-only',
      reasons: [
        'realtime_factor_not_measured_in_rpc002',
        'scalar_float64_budget_is_reference_only',
        'cpu_avx2_realtime_gate_deferred_to_rpc003',
        'gpu_render_ahead_realtime_gate_deferred_to_rpc005',
        'renderer_may_inspect_but_not_control_realtime_path',
      ],
    });
    expect(compiled.resampling).toMatchObject({
      active: true,
      family: 'poly-sinc-reference',
      phaseAccumulator: 'rational-fixed-step',
      filterContract: {
        tapCount: 64,
        phaseCount: 1024,
        cutoffRatio: 0.92,
      },
      doubleResamplingRisk: 'legacy_default_resampler_active_reference_only',
    });
    expect(compiled.resampling.artifactMetrics.aliasRejectionDb).not.toBe(null);
    expect(compiled.resampling.validation).toEqual(expect.objectContaining({
      artifact: 'poly-sinc-formal-validation-reference',
      overall: 'pass',
    }));
    expect(compiled.resampling.phaseModeArtifacts.phaseModesMeasured).toEqual(['linear', 'minimum', 'intermediate']);
    expect(compiled.resampling.apodizingArtifact.highFrequencyRestorationClaim).toBe(false);
    expect(compiled.resampling.qualityRollback).toMatchObject({
      familyLock: 'poly-sinc-reference-only',
      legacyFallbackAllowed: false,
      shortBridgeIsRollback: false,
    });
    expect(compiled.resampling.outputResamplingRisk).toMatchObject({
      state: 'legacy-resampler-active',
      reason: 'legacy_default_resampler_active_reference_only',
      signalPathTone: 'warning',
    });
    expect(compiled.pcmOutputQuantization).toMatchObject({
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: 'pcm_bitperfect',
      outputSampleFormat: 'int24',
      state: 'bypass',
      bitPerfectState: 'disabled',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      dither: {
        enabled: false,
      },
      quantization: {
        bitDepth: 24,
        maxInteger: 8388607,
        residualMaxAbs: 0,
      },
    });
    expect(compiled.pcmOutputQuantization.reasons).toEqual([
      'bitperfect_path_bypasses_dither_and_quantization',
      'shared_output_resampling_or_mixer_rate_difference',
    ]);
    expect(compiled.pcmIngressGuard).toMatchObject({
      artifact: 'pcm-ingress-guard-reference',
      state: 'ok',
      expectedChannels: 2,
      channelCount: 2,
      frameCount: 8,
      rectangular: true,
      counts: {
        nonFiniteReplaced: 0,
        denormalZeroed: 0,
        channelMismatchCount: 0,
        silenceFrames: 1,
      },
      peak: 0.875,
      reasons: ['pcm_ingress_ready_for_reference_processing'],
    });
    expect(compiled.gainStaging).toMatchObject({
      artifact: 'gain-staging-reference',
      engine: 'gain-reference',
      orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'],
      totalGainDb: 0,
      totalGainLinear: 1,
      recommendedAdditionalHeadroomDb: 0,
      clipRisk: false,
      reasons: [
        'headroom_applied_before_replaygain_and_materialized_gain',
        'gain_stages_merge_to_single_gain_reference',
        'gain_staging_within_sample_peak_budget',
      ],
    });
    expect(compiled.gainStaging.stages.map((stage) => stage.id)).toEqual(['input', 'headroom', 'replaygain', 'materialized-gain', 'output']);
    expect(compiled.iirEq).toMatchObject({
      artifact: 'iir-eq-reference',
      engine: 'iir-reference',
      orderContract: 'ui-band-order-biquad-cascade',
      state: 'exact-bypass',
      sampleRate: 44100,
      bandCount: 1,
      activeBandCount: 0,
      bypassedBandCount: 1,
      residual: {
        state: 'exact-bypass',
        comparedFrames: 8,
        maxAbs: 0,
        rms: 0,
      },
    });
    expect(compiled.channelScope).toMatchObject({
      artifact: 'channel-scope-reference',
      engine: 'stereo-procedural-reference',
      scopeContract: 'targeted-channels-only',
      channelCount: 2,
      operationCount: 1,
      appliedOperationCount: 0,
      noopOperationCount: 1,
      invalidOperationCount: 0,
    });
    expect(compiled.stereoProcedural).toMatchObject({
      artifact: 'stereo-procedural-matrix-filter-reference',
      engine: 'stereo-procedural-reference',
      state: 'identity-bypass',
      sampleRate: 44100,
      channelCount: 2,
      steps: [],
      residual: {
        state: 'exact-bypass',
        comparedFrames: 8,
        maxAbs: 0,
        rms: 0,
      },
    });
    expect(compiled.perEarEqPlacement).toMatchObject({
      artifact: 'per-ear-eq-placement-reference',
      orderContract: ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'],
      compilerRule: 'do-not-reorder-across-crossfeed-without-null-proof',
      state: 'placement-sensitive',
      sampleRate: 44100,
      perEarEq: {
        leftGainDb: -6,
        rightGainDb: 6,
      },
      crossfeed: {
        enabled: true,
        crossGainDb: -9,
        crossDelayMs: 0,
        lowPassHz: 22050,
        centerPreservation: 'none',
      },
      preCrossfeedSteps: ['pre-per-ear-eq', 'crossfeed'],
      postCrossfeedSteps: ['crossfeed', 'post-per-ear-eq'],
    });
    expect(compiled.perEarEqPlacement.residual.maxAbs).toBeGreaterThan(0.1);
    expect(compiled.sharedConvolution.duplicatePlanGuard).toMatchObject({
      artifact: 'shared-convolution-duplicate-plan-guard-reference',
      engine: 'shared-convolution-planner-reference',
      state: 'inactive',
      planCounts: {
        mergedSourceCount: 0,
        splitSourceCount: 0,
        convolverPlanCount: 0,
        cpuFftPlanCount: 0,
        gpuFftPlanCount: 0,
        rejectedDuplicateConvolverCount: 0,
        rejectedDuplicateFftPlanCount: 0,
      },
      rejectedDuplicatePlans: [],
      reasons: ['no_active_convolution_plan'],
    });
    expect(compiled.sharedConvolution.serialNullReference).toMatchObject({
      artifact: 'shared-convolution-serial-null-reference',
      engine: 'shared-convolution-planner-reference',
      state: 'split-or-inactive',
      sourceOrder: [],
      mergedResponseTapCounts: [],
      comparedFrames: 0,
      maxAbs: null,
      rms: null,
      reasons: ['serial_null_skipped_for_split_or_inactive_plan', 'serial_null_reference_only'],
    });
    expect(compiled.gaplessConcat).toMatchObject({
      artifact: 'gapless-concat-reference',
      policy: 'source-pcm-concat-before-src',
      state: 'src-stateful',
      sourceRate: 44100,
      targetRate: 48000,
      segmentCount: 2,
      boundaryCount: 1,
      concatNullResidual: {
        state: 'concat-matches-no-reset',
        maxAbs: 0,
        rms: 0,
      },
    });
    expect(compiled.gaplessConcat.resetResidual.maxAbs).toBeGreaterThan(0);
    expect(compiled.firGaplessHistory).toMatchObject({
      artifact: 'fir-gapless-history-reference',
      policy: 'source-pcm-concat-before-fir',
      engine: 'direct-fir-float64-reference',
      state: 'identity-bypass',
      sourceId: 'identity-fir-gapless-reference',
      tailFrames: 0,
      drainFrames: 0,
      concatNullResidual: {
        state: 'concat-matches-no-reset-history',
        maxAbs: 0,
        rms: 0,
      },
    });
    expect(compiled.callbackSafeControls).toMatchObject({
      artifact: 'callback-safe-urgent-controls-reference',
      policy: 'urgent-controls-after-committed-output',
      urgentControl: {
        control: 'mute',
        classification: 'callback-safe-urgent-control',
        state: 'applied',
        callbackRule: 'read-committed-output-then-apply-urgent-control',
        renderCacheAction: 'preserve',
        generationAfterControl: 1,
        requiresRenderGraphRebuild: false,
        commitAllowed: true,
        gainEnvelopeFrames: 8,
        declick: {
          enabled: true,
          frames: 4,
          startGain: 1,
          endGain: 0,
        },
      },
      renderStateBoundary: {
        control: 'seek',
        classification: 'render-state-boundary',
        state: 'render-cache-invalidated',
        callbackRule: 'read-committed-output-only',
        renderCacheAction: 'invalidate-generation',
        generationAfterControl: 2,
        requiresRenderGraphRebuild: true,
        commitAllowed: false,
      },
    });
    expect(compiled.equalPowerCrossfade).toMatchObject({
      artifact: 'equal-power-crossfade-reference',
      policy: 'random-access-short-bridge-to-full-profile-only',
      rendered: {
        intent: 'user-random-seek-or-skip',
        state: 'crossfade-rendered',
        rejectionReason: null,
        fadeFrames: 5,
        gainLaw: {
          state: 'equal-power',
        },
        residualVsHardSwitch: {
          state: 'measured-crossfade-difference',
          comparedFrames: 5,
        },
      },
      rejectedBoundary: {
        intent: 'gapless-boundary',
        state: 'rejected',
        rejectionReason: 'intent_not_user_random_seek_or_skip',
        gainLaw: {
          state: 'not-applicable',
        },
      },
    });
    expect(compiled.equalPowerCrossfade.rendered.gainLaw.midpointShortBridgeGain).toBeCloseTo(Math.SQRT1_2, 12);
    expect(compiled.equalPowerCrossfade.rendered.residualVsHardSwitch.maxAbs).toBeGreaterThan(0.1);
    expect(compiled.blockBoundary).toMatchObject({
      artifact: 'block-boundary-split-reference',
      policy: 'valid-frames-committed-padding-never-output',
      blockFrames: 6,
      inputFrames: 8,
      channelCount: 2,
      blockCount: 2,
      blockStates: ['full', 'partial-padded'],
      coverage: {
        state: 'exact',
        coveredFrames: 8,
        missingFrames: 0,
        duplicateFrames: 0,
        committedFrames: 8,
        paddedFrames: 4,
      },
      residual: {
        state: 'exact-reassembly',
        comparedFrames: 8,
        maxAbs: 0,
        rms: 0,
      },
      boundaryCount: 1,
      maxIntroducedDiscontinuity: 0,
    });
    expect(compiled.flushDrain).toMatchObject({
      artifact: 'flush-drain-reference',
      engine: 'direct-fir-float64-reference',
      generationId: 7,
      generationState: 'current',
      naturalEof: {
        intent: 'natural-eof',
        generationAfter: 7,
        state: 'drain-committed',
        sourceFrames: 3,
        tailFrames: 2,
        drainFrames: 2,
        resetRequired: false,
        drainCommitAllowed: true,
      },
      manualFlush: {
        intent: 'manual-flush',
        generationAfter: 8,
        state: 'tail-dropped-and-reset',
        sourceFrames: 3,
        tailFrames: 2,
        drainFrames: 0,
        resetRequired: true,
        drainCommitAllowed: false,
      },
    });
    expect(compiled.artifactPlan.aliasRejection).toBe('deterministic-reference');
    expect(compiled.artifactPlan.logSweep).toBe('deterministic-reference');
    expect(compiled.artifactPlan.multiTone).toBe('deterministic-reference');
    expect(compiled.artifactPlan.silence).toBe('deterministic-reference');
    expect(compiled.artifactPlan.formalValidation).toBe('deterministic-reference');
    expect(compiled.artifactPlan.dsdFamilyPath).toBe('not-applicable');
    expect(compiled.artifactPlan.backendSupport).toBe('deterministic-reference');
    expect(compiled.artifactPlan.outputDevicePolicy).toBe('deterministic-reference');
    expect(compiled.artifactPlan.latencyBudget).toBe('deterministic-reference');
    expect(compiled.artifactPlan.readinessContract).toBe('deterministic-reference');
    expect(compiled.artifactPlan.generationCacheKey).toBe('deterministic-reference');
    expect(compiled.artifactPlan.realtimeBudgetSummary).toBe('deterministic-reference');
    expect(compiled.artifactPlan.qualityRollback).toBe('deterministic-reference');
    expect(compiled.artifactPlan.pcmOutputQuantization).toBe('deterministic-reference');
    expect(compiled.artifactPlan.pcmIngressGuard).toBe('deterministic-reference');
    expect(compiled.artifactPlan.gainStaging).toBe('deterministic-reference');
    expect(compiled.artifactPlan.iirEq).toBe('deterministic-reference');
    expect(compiled.artifactPlan.channelScope).toBe('deterministic-reference');
    expect(compiled.artifactPlan.stereoProcedural).toBe('deterministic-reference');
    expect(compiled.artifactPlan.perEarEqPlacement).toBe('deterministic-reference');
    expect(compiled.artifactPlan.sharedConvolutionDuplicateGuard).toBe('deterministic-reference');
    expect(compiled.artifactPlan.sharedConvolutionSerialNull).toBe('deterministic-reference');
    expect(compiled.artifactPlan.gaplessConcat).toBe('deterministic-reference');
    expect(compiled.artifactPlan.firGaplessHistory).toBe('deterministic-reference');
    expect(compiled.artifactPlan.callbackSafeControls).toBe('deterministic-reference');
    expect(compiled.artifactPlan.equalPowerCrossfade).toBe('deterministic-reference');
    expect(compiled.artifactPlan.blockBoundary).toBe('deterministic-reference');
    expect(compiled.artifactPlan.flushDrain).toBe('deterministic-reference');
    expect(compiled.continuity).toMatchObject({
      artifact: 'continuity-telemetry-reference',
      policy: 'callback-read-committed-reference',
      continuity: {
        selectedPath: 'wait-for-full-profile',
        callbackRule: 'read-committed-output-only',
        shortBridgeAllowed: false,
        qualityRollback: 'none',
      },
      preRoll: {
        artifact: 'pre-roll-deadline-reference',
        readRule: 'read-committed-output-only',
        shortBridgeAllowed: false,
      },
      callbackRing: {
        artifact: 'cpu-callback-ring-reference',
        state: 'stable',
        telemetryStatus: 'safe',
        shortBridgeAllowed: false,
      },
      renderAheadCache: {
        artifact: 'render-ahead-cache-reference',
        lookupState: 'miss',
        commitState: 'callback-keeps-prior-committed-output',
        callbackRule: 'read-committed-output-only',
      },
      fallback: {
        artifact: 'fallback-injection-underrun-reference',
        state: 'prior-committed-fallback',
        callbackMustNotWaitForGpu: true,
        shortBridgeAllowed: false,
      },
    });
  });

  it('keeps all six formatPath reference reasons in a stable inspect snapshot', () => {
    const compiled = compile({
      sampleRatePlan: plan({
        requestedOutputSampleRate: 48000,
        actualDeviceSampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        outputMode: 'shared',
        resampling: true,
        bitPerfectCandidate: false,
        sampleRateMismatch: true,
      }),
      outputMode: 'shared',
      dspActive: true,
      dspModuleActive: true,
      bitPerfectDisabledReason: 'uzume_processing_enabled',
      nativeFormatPath: 'pcm_processed',
      nativeBitPerfectState: 'disabled',
      nativeDirectDisabledReason: 'uzume_processing_enabled',
    });

    expect(Object.keys(compiled.formatPathPlan)).toEqual([
      'pcm_bitperfect',
      'pcm_processed',
      'dsd_direct',
      'dsd_upsampling',
      'd2p_processed',
      'sdm_processed',
    ]);
    expect(Object.entries(compiled.formatPathPlan).map(([path, entry]) => `${path}:${entry?.state}${entry?.reason ? `/${entry.reason}` : ''}`)).toEqual([
      'pcm_bitperfect:disabled/uzume_processing_enabled',
      'pcm_processed:current',
      'dsd_direct:unavailable/requires_dsd_source',
      'dsd_upsampling:unavailable/requires_dsd_source',
      'd2p_processed:unavailable/d2p_requires_dsd_source',
      'sdm_processed:unavailable/sdm_reference_engine_not_ready',
    ]);
    expect(JSON.stringify(compiled.formatPathPlan)).not.toContain('source_is_pcm');
    expect(JSON.stringify(compiled.formatPathPlan)).not.toContain('sdm_engine_not_ready');
  });

  it('assigns active UI sections to reference engines instead of runtime processors', () => {
    const compiled = compile({
      sampleRatePlan: plan({ requestedOutputSampleRate: 48000, resampling: true }),
      eqState: eqState({
        enabled: true,
        preampDb: -2,
        dspHeadroomDb: -6,
        bands: [{ frequencyHz: 1000, gainDb: 3, q: 1, filterType: 'peaking', enabled: true }],
      }),
      channelBalanceState: channelBalanceState({
        enabled: true,
        leftGainDb: -1,
        rightDelayMs: 1,
        bandGains: {
          low: { leftGainDb: 1, rightGainDb: 0 },
          mid: { leftGainDb: 0, rightGainDb: 0 },
          high: { leftGainDb: 0, rightGainDb: 0 },
        },
      }),
      roomCorrectionState: roomCorrectionState({
        enabled: true,
        status: 'active',
        irId: 'room',
        sampleRate: 44100,
        tapCount: 2048,
        latencySamples: 1024,
      }),
      dspActive: true,
      dspModuleActive: true,
      bitPerfectDisabledReason: 'eq_enabled',
      nativeFormatPath: 'pcm_processed',
      nativeBitPerfectState: 'disabled',
      nativeDirectDisabledReason: 'uzume_processing_enabled',
    });

    expect(compiled.formatPath).toBe('pcm_processed');
    expect(compiled.formatPathPlan.pcm_processed).toEqual({ state: 'current', reason: null });
    expect(compiled.engineAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectionId: 'headroom', engineId: 'gain-reference', active: true }),
        expect.objectContaining({ sectionId: 'peq', engineId: 'iir-reference', active: true }),
        expect.objectContaining({ sectionId: 'stereo-procedural', engineId: 'stereo-procedural-reference', active: true }),
        expect.objectContaining({ sectionId: 'shared-convolution', engineId: 'shared-convolution-planner-reference', active: true }),
        expect.objectContaining({ sectionId: 'pcm-src', engineId: 'resampling-reference', active: true }),
        expect.objectContaining({ sectionId: 'dither', engineId: 'dither-reference', active: true, mergeGroupId: 'dither-reference' }),
      ]),
    );
    expect(compiled.splitReasons).toMatchObject({
      'stereo-procedural': 'channel_balance_band_compensation_pending_reference',
      'shared-convolution': 'room_ir_sample_rate_family_mismatch',
    });
    expect(compiled.latencyOwners).toMatchObject({
      'stereo-procedural': 'delay-reference',
      'shared-convolution': 'room-ir-latency',
      'pcm-src': 'resampling-reference',
    });
    expect(compiled.sharedConvolution).toMatchObject({
      active: false,
      engine: 'shared-convolution-planner-reference',
      splitReasons: {
        'room-ir': 'sample_rate_family_mismatch',
      },
      partitionPlan: {
        latencyClass: 'inactive',
        callbackBlockFrames: 512,
        internalBlockFrames: 0,
      },
    });
    expect(compiled.sharedConvolution.duplicatePlanGuard).toMatchObject({
      state: 'split-required',
      planCounts: {
        mergedSourceCount: 0,
        splitSourceCount: 1,
        convolverPlanCount: 0,
        cpuFftPlanCount: 0,
        gpuFftPlanCount: 0,
        rejectedDuplicateConvolverCount: 0,
        rejectedDuplicateFftPlanCount: 0,
      },
      sourceAssignments: [
        expect.objectContaining({
          sourceId: 'room-ir',
          state: 'split-required',
          splitReason: 'sample_rate_family_mismatch',
        }),
      ],
    });
    expect(compiled.sharedConvolution.serialNullReference).toMatchObject({
      state: 'split-or-inactive',
      sourceOrder: [],
      comparedFrames: 0,
      maxAbs: null,
      rms: null,
    });
    expect(compiled.gaplessConcat).toMatchObject({
      state: 'src-stateful',
      sourceRate: 44100,
      targetRate: 48000,
      boundaryCount: 1,
    });
    expect(compiled.gaplessConcat.resetResidual.maxAbs).toBeGreaterThan(0);
    expect(compiled.firGaplessHistory).toMatchObject({
      state: 'history-required',
      sourceId: 'room-ir',
      sampleRate: 44100,
      tailFrames: 3,
      drainFrames: 3,
      boundaryCount: 1,
    });
    expect(compiled.firGaplessHistory.resetResidual.maxAbs).toBeGreaterThan(0);
    expect(compiled.perEarEqPlacement).toMatchObject({
      state: 'placement-sensitive',
      preCrossfeedSteps: ['pre-per-ear-eq', 'crossfeed'],
      postCrossfeedSteps: ['crossfeed', 'post-per-ear-eq'],
    });
    expect(compiled.perEarEqPlacement.residual.maxAbs).toBeGreaterThan(0.1);
    expect(compiled.callbackSafeControls.urgentControl).toMatchObject({
      control: 'mute',
      state: 'applied',
      renderCacheAction: 'preserve',
    });
    expect(compiled.callbackSafeControls.renderStateBoundary).toMatchObject({
      control: 'seek',
      state: 'render-cache-invalidated',
      renderCacheAction: 'invalidate-generation',
    });
    expect(compiled.equalPowerCrossfade.rendered).toMatchObject({
      intent: 'user-random-seek-or-skip',
      state: 'crossfade-rendered',
      gainLaw: { state: 'equal-power' },
    });
    expect(compiled.equalPowerCrossfade.rejectedBoundary).toMatchObject({
      intent: 'gapless-boundary',
      state: 'rejected',
      rejectionReason: 'intent_not_user_random_seek_or_skip',
    });
    expect(compiled.pcmOutputQuantization).toMatchObject({
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: 'pcm_processed',
      outputSampleFormat: 'int24',
      state: 'quantized',
      bitPerfectState: 'disabled',
      pcmDitherAllowed: true,
      dither: {
        mode: 'tpdf',
        enabled: true,
        seed: 219668994,
      },
      quantization: {
        bitDepth: 24,
        maxInteger: 8388607,
        clippedSamples: 0,
      },
    });
    expect(compiled.mergeGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dither-reference', active: true, sections: ['dither'] }),
    ]));
    expect(compiled.pcmIngressGuard).toMatchObject({
      state: 'ok',
      expectedChannels: 2,
      channelCount: 2,
      reasons: ['pcm_ingress_ready_for_reference_processing'],
    });
    expect(compiled.gainStaging).toMatchObject({
      totalGainDb: -8,
      clipRisk: false,
      recommendedAdditionalHeadroomDb: 0,
    });
    expect(compiled.gainStaging.stages.map((stage) => stage.cumulativeGainDb)).toEqual([0, -6, -6, -8, -8]);
    expect(compiled.iirEq).toMatchObject({
      state: 'active',
      sampleRate: 44100,
      bandCount: 1,
      activeBandCount: 1,
      bypassedBandCount: 0,
      bands: [
        expect.objectContaining({
          index: 0,
          filterType: 'peaking',
          frequencyHz: 1000,
          gainDb: 3,
          state: 'active',
          coefficientState: 'generated',
        }),
      ],
      residual: expect.objectContaining({
        state: 'processed',
      }),
    });
    expect(compiled.channelScope).toMatchObject({
      operationCount: 1,
      appliedOperationCount: 1,
      invalidOperationCount: 0,
      operations: [
        expect.objectContaining({
          id: 'left-trim-scope',
          targetChannels: [0],
          state: 'applied',
        }),
      ],
    });
    expect(compiled.stereoProcedural).toMatchObject({
      state: 'active',
      steps: ['trim', 'delay'],
      delaySamples: {
        left: 0,
        right: 44.1,
      },
      reasons: expect.arrayContaining(['band_compensation_requires_iir_reference_split']),
    });
  });

  it('distinguishes DSD direct from D2P reference paths', () => {
    const dsdDirect = compile({
      probe: pcmProbe({ filePath: 'album.dsf', codec: 'DSF', fileSampleRate: 2822400, bitDepth: 1 }),
      sampleRatePlan: plan({
        fileSampleRate: 2822400,
        decoderOutputSampleRate: 2822400,
        requestedOutputSampleRate: 2822400,
        actualDeviceSampleRate: 2822400,
        dsdOutputMode: 'dop',
        dsdNativeSampleRate: 2822400,
        dsdTransportSampleRate: 176400,
        bitPerfectCandidate: true,
      }),
      activeDsdOutputMode: 'dop',
      requestedDsdOutputMode: 'dop',
    });
    const d2p = compile({
      probe: pcmProbe({ filePath: 'album.dsf', codec: 'DSF', fileSampleRate: 2822400, bitDepth: 1 }),
      sampleRatePlan: plan({
        fileSampleRate: 2822400,
        decoderOutputSampleRate: 176400,
        requestedOutputSampleRate: 176400,
        actualDeviceSampleRate: 176400,
        dsdOutputMode: 'pcm',
        resampling: true,
        bitPerfectCandidate: false,
      }),
      activeDsdOutputMode: null,
      requestedDsdOutputMode: 'pcm',
      dspActive: true,
      dspModuleActive: true,
      bitPerfectDisabledReason: 'dsd_source_decoded_to_pcm',
    });

    expect(dsdDirect.formatPath).toBe('dsd_direct');
    expect(dsdDirect.formatPathPlan.dsd_direct).toEqual({ state: 'current', reason: null });
    expect(dsdDirect.dsdFamily).toMatchObject({
      artifact: 'dsd-family-path-control-reference',
      formatPath: 'dsd_direct',
      state: 'direct',
      directDisabledReason: null,
      outputContainer: 'dop',
      internalDomain: 'dsd-direct',
      allowedControls: ['safety-metering'],
      disabledControls: [],
      dsd: {
        sourceDsdRate: 2822400,
        outputEncoding: 'dop-dsd64',
      },
    });
    expect(dsdDirect.pcmOutputQuantization).toMatchObject({
      formatPath: 'dsd_direct',
      outputSampleFormat: 'sdm',
      state: 'rejected',
      bitPerfectState: 'not-applicable',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: true,
      reasons: ['pcm_to_dsd_uses_sdm_noise_shaping_not_pcm_dither'],
    });
    expect(dsdDirect.pcmIngressGuard.state).toBe('ok');
    expect(dsdDirect.gainStaging.totalGainDb).toBe(0);
    expect(dsdDirect.artifactPlan.dsdFamilyPath).toBe('deterministic-reference');
    expect(d2p.formatPath).toBe('d2p_processed');
    expect(d2p.formatPathPlan.dsd_direct).toEqual({
      state: 'disabled',
      reason: 'dsd_source_decoded_to_pcm',
    });
    expect(d2p.formatPathPlan.d2p_processed).toEqual({ state: 'current', reason: null });
    expect(d2p.dsdFamily).toMatchObject({
      artifact: 'dsd-family-path-control-reference',
      formatPath: 'd2p_processed',
      state: 'd2p-reference',
      directDisabledReason: 'dsd_source_decoded_to_pcm',
      outputContainer: 'pcm',
      internalDomain: 'multibit-pcm',
      entersPcmDsp: true,
      pcmDomainDspAllowed: true,
      d2p: {
        active: true,
        available: true,
        decimationProfile: 'reference-low-pass-decimation',
        internalPcmRate: 176400,
      },
    });
    expect(d2p.pcmOutputQuantization).toMatchObject({
      formatPath: 'd2p_processed',
      outputSampleFormat: 'int16',
      state: 'quantized',
      bitPerfectState: 'disabled',
      pcmDitherAllowed: true,
      dither: {
        enabled: true,
      },
    });
  });
});

describe('UZUME PCM bit-perfect bypass reference', () => {
  it('preserves PCM samples exactly and keeps sample-changing sections out of the path', () => {
    const input = [
      [0, 0.25, -0.5, 0.75],
      [1, -1, 0.125, -0.125],
    ];
    const rendered = renderUzumeBitPerfectBypassReference({
      formatPath: 'pcm_bitperfect',
      channels: input,
      requestedSections: ['format-path', 'peq', 'pcm-src', 'dither', 'safety-meter', 'shared-convolution', 'limiter'],
    });

    expect(rendered).toMatchObject({
      artifact: 'pcm-bitperfect-bypass-reference',
      formatPath: 'pcm_bitperfect',
      engine: 'identity-bypass',
      state: 'preserved',
      bitPerfectState: 'preserved',
      output: input,
      readOnlySections: ['format-path', 'safety-meter'],
      disabledSections: ['peq', 'pcm-src', 'dither', 'shared-convolution', 'limiter'],
      activeSampleChangingSections: [],
      sampleChangingDspEntered: false,
      directDisabledReason: null,
      residual: {
        state: 'identity-null',
        comparedFrames: 4,
        comparedSamples: 8,
        maxAbs: 0,
        rms: 0,
      },
      reasons: [
        'pcm_bitperfect_bypasses_sample_changing_dsp',
        'identity_bypass_output_matches_input',
        'safety_metering_is_read_only',
      ],
    });
    expect(rendered.output[0]).not.toBe(input[0]);
  });

  it('rejects PCM processed paths instead of claiming a bit-perfect null', () => {
    const rendered = renderUzumeBitPerfectBypassReference({
      formatPath: 'pcm_processed',
      channels: [[0, 0.25, -0.25]],
      requestedSections: ['format-path', 'headroom', 'peq', 'pcm-src', 'dither'],
      directDisabledReason: 'eq_enabled',
    });

    expect(rendered).toMatchObject({
      state: 'rejected',
      bitPerfectState: 'disabled',
      output: [],
      readOnlySections: ['format-path'],
      disabledSections: [],
      activeSampleChangingSections: ['headroom', 'peq', 'pcm-src', 'dither'],
      sampleChangingDspEntered: true,
      directDisabledReason: 'eq_enabled',
      residual: {
        state: 'not-measured',
        maxAbs: null,
        rms: null,
      },
      reasons: ['pcm_processed_enters_sample_changing_dsp', 'bitperfect_bypass_not_claimed_for_processed_path'],
    });
  });

  it('rejects PCM bit-perfect labels when the planner reports disabled direct conditions', () => {
    const rendered = renderUzumeBitPerfectBypassReference({
      formatPath: 'pcm_bitperfect',
      channels: [[0, 0.25, -0.25]],
      requestedSections: ['format-path', 'safety-meter'],
      bitPerfectState: 'disabled',
      directDisabledReason: 'shared_output_mixer_path',
    });

    expect(rendered).toMatchObject({
      state: 'rejected',
      bitPerfectState: 'disabled',
      engine: 'format-path-planner-reference',
      output: [],
      readOnlySections: ['format-path', 'safety-meter'],
      disabledSections: [],
      activeSampleChangingSections: [],
      sampleChangingDspEntered: false,
      directDisabledReason: 'shared_output_mixer_path',
      residual: {
        state: 'not-measured',
        maxAbs: null,
        rms: null,
      },
      reasons: ['pcm_bitperfect_conditions_not_met', 'bitperfect_bypass_not_claimed_when_direct_disabled'],
    });
  });

  it('keeps DSD direct outside the PCM bit-perfect bypass artifact', () => {
    const rendered = renderUzumeBitPerfectBypassReference({
      formatPath: 'dsd_direct',
      channels: [],
      requestedSections: ['format-path', 'dsd-ingress', 'safety-meter'],
    });

    expect(rendered).toMatchObject({
      state: 'not-applicable',
      bitPerfectState: 'not-applicable',
      engine: 'format-path-planner-reference',
      output: [],
      readOnlySections: ['format-path', 'safety-meter'],
      activeSampleChangingSections: [],
      sampleChangingDspEntered: false,
      directDisabledReason: null,
      residual: {
        state: 'not-measured',
        maxAbs: null,
        rms: null,
      },
      reasons: ['non_pcm_path_not_a_pcm_bitperfect_bypass_artifact', 'bitperfect_bypass_not_claimed_for_non_pcm_path'],
    });
  });
});

describe('UZUME DSD family path/control reference', () => {
  it('keeps DSD direct as a positive bypass when only safety metering is requested', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'dsd_direct',
      outputContainer: 'dop',
      sourceDsdRate: 2822400,
      requestedControls: ['safety-metering'],
    });

    expect(planned).toMatchObject({
      artifact: 'dsd-family-path-control-reference',
      formatPath: 'dsd_direct',
      sourceContainer: 'dsd',
      outputContainer: 'dop',
      internalDomain: 'dsd-direct',
      state: 'direct',
      directDisabledReason: null,
      fallbackReason: null,
      experimental: false,
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      allowedControls: ['safety-metering'],
      disabledControls: [],
      dsd: {
        sourceDsdRate: 2822400,
        targetDsdRate: 2822400,
        outputEncoding: 'dop-dsd64',
      },
      d2p: {
        active: false,
        decimationProfile: null,
        internalPcmRate: null,
      },
      sdm: {
        active: false,
        mode: 'none',
        modulatorProfile: null,
        targetDsdRate: null,
      },
      reasons: ['dsd_direct_bypasses_pcm_dsp_src_limiter_dither'],
    });
  });

  it('keeps DSD direct bitstream-only and reports why sample-changing DSP disables direct mode', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'dsd_direct',
      outputContainer: 'dop',
      sourceDsdRate: 2822400,
      requestedControls: ['safety-metering', 'eq', 'fir', 'pcm-src', 'pcm-dither'],
    });

    expect(planned).toMatchObject({
      artifact: 'dsd-family-path-control-reference',
      formatPath: 'dsd_direct',
      sourceContainer: 'dsd',
      outputContainer: 'dop',
      internalDomain: 'dsd-direct',
      state: 'unavailable',
      directDisabledReason: 'sample_changing_dsp_requires_d2p_or_sdm_processed',
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      allowedControls: ['safety-metering'],
      disabledControls: [
        { control: 'eq', reason: 'dsd_direct_is_bitstream_only' },
        { control: 'fir', reason: 'dsd_direct_is_bitstream_only' },
        { control: 'pcm-src', reason: 'dsd_direct_is_bitstream_only' },
        { control: 'pcm-dither', reason: 'dsd_direct_is_bitstream_only' },
      ],
      dsd: {
        sourceDsdRate: 2822400,
        targetDsdRate: 2822400,
        outputEncoding: 'dop-dsd64',
      },
      d2p: {
        active: false,
        decimationProfile: null,
        internalPcmRate: null,
      },
      reasons: ['dsd_direct_bypasses_pcm_dsp_src_limiter_dither', 'direct_disabled_reason_reported'],
    });
  });

  it('keeps DSD upsampling SDM-only and disables PCM-domain controls with reasons', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'dsd_upsampling',
      outputContainer: 'dop',
      sourceDsdRate: 2822400,
      targetDsdRate: 11289600,
      modulatorProfile: 'uzume-sdm-5th-order-reference',
      headroomDb: -3,
      overloadMarginDb: 6,
      ultrasonicNoiseRisk: 'normal',
      sdmReferenceAvailable: true,
      requestedControls: ['sdm-modulator', 'headroom', 'safety-metering', 'overload-guard', 'eq', 'crossfeed', 'pcm-src', 'pcm-dither'],
    });

    expect(planned).toMatchObject({
      formatPath: 'dsd_upsampling',
      internalDomain: 'sdm-modulator-input',
      state: 'sdm-only-reference',
      directDisabledReason: 'dsd_upsampling_enabled',
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: true,
      allowedControls: ['sdm-modulator', 'headroom', 'safety-metering', 'overload-guard'],
      disabledControls: [
        { control: 'eq', reason: 'requires_d2p_processed_or_sdm_processed' },
        { control: 'crossfeed', reason: 'requires_d2p_processed_or_sdm_processed' },
        { control: 'pcm-src', reason: 'requires_d2p_processed_or_sdm_processed' },
        { control: 'pcm-dither', reason: 'requires_d2p_processed_or_sdm_processed' },
      ],
      dsd: {
        sourceDsdRate: 2822400,
        targetDsdRate: 11289600,
        outputEncoding: 'dop-dsd256',
      },
      sdm: {
        active: true,
        available: true,
        mode: 'dsd-upsampling',
        modulatorProfile: 'uzume-sdm-5th-order-reference',
        targetDsdRate: 11289600,
        headroomDb: -3,
        overloadMarginDb: 6,
        ultrasonicNoiseRisk: 'normal',
        realtimeSafetyClass: 'offline-reference-only',
      },
      reasons: ['dsd_upsampling_is_sdm_only_not_pcm_domain_dsp'],
    });
  });

  it('reports DSD upsampling as unavailable when the SDM reference engine is not ready', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'dsd_upsampling',
      outputContainer: 'dop',
      sourceDsdRate: 2822400,
      targetDsdRate: 11289600,
      sdmReferenceAvailable: false,
      requestedControls: ['sdm-modulator', 'headroom', 'safety-metering', 'eq', 'pcm-src'],
    });

    expect(planned).toMatchObject({
      state: 'unavailable',
      directDisabledReason: 'dsd_upsampling_enabled',
      fallbackReason: 'sdm_reference_engine_not_ready',
      experimental: true,
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      allowedControls: [],
      disabledControls: [
        { control: 'sdm-modulator', reason: 'sdm_reference_engine_not_ready' },
        { control: 'headroom', reason: 'sdm_reference_engine_not_ready' },
        { control: 'safety-metering', reason: 'sdm_reference_engine_not_ready' },
        { control: 'eq', reason: 'requires_d2p_processed_or_sdm_processed' },
        { control: 'pcm-src', reason: 'requires_d2p_processed_or_sdm_processed' },
      ],
      sdm: {
        active: false,
        available: false,
        mode: 'dsd-upsampling',
        modulatorProfile: null,
        targetDsdRate: null,
      },
      reasons: ['sdm_reference_engine_not_ready', 'dsd_upsampling_is_sdm_only_not_pcm_domain_dsp'],
    });
  });

  it('reports D2P decimation and internal PCM rate while enabling PCM-domain controls', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'd2p_processed',
      outputContainer: 'pcm',
      sourceDsdRate: 2822400,
      internalPcmRate: 176400,
      decimationProfile: 'dsd64-to-176k4-reference-low-pass',
      requestedControls: ['eq', 'fir', 'crossfeed', 'pcm-src', 'pcm-dither', 'pcm-limiter'],
    });

    expect(planned).toMatchObject({
      formatPath: 'd2p_processed',
      outputContainer: 'pcm',
      internalDomain: 'multibit-pcm',
      state: 'd2p-reference',
      directDisabledReason: 'dsd_source_decoded_to_pcm',
      pcmDomainDspAllowed: true,
      entersPcmDsp: true,
      pcmDitherAllowed: true,
      sdmNoiseShapingTelemetry: false,
      allowedControls: ['eq', 'fir', 'crossfeed', 'pcm-src', 'pcm-dither', 'pcm-limiter'],
      disabledControls: [],
      dsd: {
        outputEncoding: null,
      },
      d2p: {
        active: true,
        available: true,
        decimationProfile: 'dsd64-to-176k4-reference-low-pass',
        internalPcmRate: 176400,
      },
      sdm: {
        active: false,
        mode: 'none',
        modulatorProfile: null,
      },
      reasons: ['d2p_reports_decimation_profile_and_internal_pcm_rate'],
    });
  });

  it('reports D2P unavailable with fallback reason instead of entering PCM DSP', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'd2p_processed',
      outputContainer: 'pcm',
      sourceDsdRate: 2822400,
      internalPcmRate: 176400,
      decimationProfile: 'dsd64-to-176k4-reference-low-pass',
      d2pReferenceAvailable: false,
      requestedControls: ['eq', 'fir', 'crossfeed', 'pcm-src', 'pcm-dither', 'pcm-limiter'],
    });

    expect(planned).toMatchObject({
      formatPath: 'd2p_processed',
      internalDomain: 'multibit-pcm',
      state: 'unavailable',
      directDisabledReason: 'dsd_source_decoded_to_pcm',
      fallbackReason: 'd2p_reference_engine_not_ready',
      experimental: false,
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      allowedControls: [],
      disabledControls: [
        { control: 'eq', reason: 'd2p_reference_engine_not_ready' },
        { control: 'fir', reason: 'd2p_reference_engine_not_ready' },
        { control: 'crossfeed', reason: 'd2p_reference_engine_not_ready' },
        { control: 'pcm-src', reason: 'd2p_reference_engine_not_ready' },
        { control: 'pcm-dither', reason: 'd2p_reference_engine_not_ready' },
        { control: 'pcm-limiter', reason: 'd2p_reference_engine_not_ready' },
      ],
      d2p: {
        active: false,
        available: false,
        decimationProfile: null,
        internalPcmRate: null,
      },
      reasons: ['d2p_reference_engine_not_ready'],
    });
  });

  it('keeps SDM processed telemetry separate from PCM dither', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'sdm_processed',
      outputContainer: 'dsd_native',
      sourceDsdRate: 2822400,
      targetDsdRate: 11289600,
      modulatorProfile: 'uzume-sdm-5th-order-reference',
      overloadMarginDb: 4.5,
      ultrasonicNoiseRisk: 'elevated',
      sdmReferenceAvailable: true,
      requestedControls: ['eq', 'pcm-src', 'pcm-dither', 'sdm-modulator', 'overload-guard'],
    });

    expect(planned).toMatchObject({
      formatPath: 'sdm_processed',
      outputContainer: 'dsd_native',
      internalDomain: 'sdm-modulator-input',
      state: 'sdm-processed-reference',
      directDisabledReason: 'sdm_processed_enabled',
      pcmDomainDspAllowed: true,
      entersPcmDsp: true,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: true,
      allowedControls: ['eq', 'pcm-src', 'sdm-modulator', 'overload-guard'],
      disabledControls: [
        { control: 'pcm-dither', reason: 'sdm_uses_noise_shaping_not_pcm_dither' },
      ],
      dsd: {
        outputEncoding: 'dsd256',
      },
      sdm: {
        active: true,
        available: true,
        mode: 'sdm-processed',
        modulatorProfile: 'uzume-sdm-5th-order-reference',
        targetDsdRate: 11289600,
        overloadMarginDb: 4.5,
        ultrasonicNoiseRisk: 'elevated',
      },
      reasons: ['sdm_reports_modulator_overload_and_ultrasonic_noise'],
    });
  });

  it('reports SDM processed as experimental unavailable with fallback reason', () => {
    const planned = planUzumeDsdFamilyPathReference({
      formatPath: 'sdm_processed',
      outputContainer: 'dsd_native',
      sourceDsdRate: 2822400,
      targetDsdRate: 11289600,
      sdmReferenceAvailable: false,
      requestedControls: ['eq', 'pcm-src', 'pcm-dither', 'sdm-modulator', 'overload-guard'],
    });

    expect(planned).toMatchObject({
      formatPath: 'sdm_processed',
      internalDomain: 'sdm-modulator-input',
      state: 'unavailable',
      directDisabledReason: 'sdm_processed_enabled',
      fallbackReason: 'sdm_reference_engine_not_ready',
      experimental: true,
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      allowedControls: [],
      disabledControls: [
        { control: 'eq', reason: 'sdm_reference_engine_not_ready' },
        { control: 'pcm-src', reason: 'sdm_reference_engine_not_ready' },
        { control: 'pcm-dither', reason: 'sdm_uses_noise_shaping_not_pcm_dither' },
        { control: 'sdm-modulator', reason: 'sdm_reference_engine_not_ready' },
        { control: 'overload-guard', reason: 'sdm_reference_engine_not_ready' },
      ],
      sdm: {
        active: false,
        available: false,
        mode: 'sdm-processed',
        modulatorProfile: null,
        targetDsdRate: null,
      },
      reasons: ['sdm_reference_engine_not_ready'],
    });
  });
});

describe('UZUME PCM output quantization and dither reference', () => {
  it('keeps bit-perfect paths out of PCM dither and quantization', () => {
    const rendered = renderUzumePcmOutputQuantizationReference({
      formatPath: 'pcm_bitperfect',
      outputSampleFormat: 'int16',
      ditherMode: 'tpdf',
      channels: [[0, 0.25, -0.25, 0.5]],
    });

    expect(rendered).toMatchObject({
      artifact: 'pcm-output-quantization-dither-reference',
      state: 'bypass',
      bitPerfectState: 'preserved',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      output: [[0, 0.25, -0.25, 0.5]],
      quantizedIntegers: [],
      dither: {
        mode: 'tpdf',
        enabled: false,
        seed: null,
        lsbAmplitude: null,
        peakDitherLsb: 0,
      },
      quantization: {
        bitDepth: 16,
        maxInteger: 32767,
        residualMaxAbs: 0,
        residualRms: 0,
      },
      reasons: ['bitperfect_path_bypasses_dither_and_quantization'],
    });
  });

  it('renders deterministic TPDF dither before fixed-point PCM quantization', () => {
    const input = {
      formatPath: 'pcm_processed' as const,
      outputSampleFormat: 'int16' as const,
      ditherMode: 'tpdf' as const,
      seed: 1234,
      channels: [[0, 0.1, -0.1, 0.99999]],
    };
    const rendered = renderUzumePcmOutputQuantizationReference(input);
    const repeated = renderUzumePcmOutputQuantizationReference(input);

    expect(rendered).toMatchObject({
      state: 'quantized',
      bitPerfectState: 'disabled',
      pcmDitherAllowed: true,
      sdmNoiseShapingTelemetry: false,
      dither: {
        mode: 'tpdf',
        enabled: true,
        seed: 1234,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth: 16,
        maxInteger: 32767,
        clippedSamples: 0,
      },
      reasons: [
        'fixed_point_pcm_output_quantized',
        'pcm_dither_disables_bitperfect',
        'pcm_tpdf_or_plain_quantization_reference',
      ],
    });
    expect(rendered.dither.lsbAmplitude).toBeCloseTo(1 / 32767, 16);
    expect(rendered.dither.peakDitherLsb).toBeGreaterThan(0);
    expect(rendered.dither.peakDitherLsb).toBeLessThanOrEqual(1);
    expect(rendered.quantizedIntegers).toEqual(repeated.quantizedIntegers);
    expect(rendered.output).toEqual(repeated.output);
    expect(rendered.quantization.residualMaxAbs).toBeGreaterThan(0);
  });

  it('bypasses PCM dither for floating-point PCM output', () => {
    const rendered = renderUzumePcmOutputQuantizationReference({
      formatPath: 'pcm_processed',
      outputSampleFormat: 'float32',
      ditherMode: 'noise-shaped-tpdf',
      channels: [[0.125, -0.125]],
    });

    expect(rendered).toMatchObject({
      state: 'bypass',
      bitPerfectState: 'not-applicable',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: false,
      output: [[0.125, -0.125]],
      quantizedIntegers: [],
      dither: {
        enabled: false,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth: null,
        maxInteger: null,
        residualMaxAbs: 0,
        residualRms: 0,
      },
      reasons: ['float_output_keeps_internal_precision_no_pcm_dither'],
    });
  });

  it('rejects PCM dither for SDM output and points to SDM noise shaping telemetry', () => {
    const rendered = renderUzumePcmOutputQuantizationReference({
      formatPath: 'sdm_processed',
      outputSampleFormat: 'sdm',
      ditherMode: 'noise-shaped-tpdf',
      channels: [[0, 0.5, -0.5]],
    });

    expect(rendered).toMatchObject({
      state: 'rejected',
      bitPerfectState: 'not-applicable',
      pcmDitherAllowed: false,
      sdmNoiseShapingTelemetry: true,
      output: [],
      quantizedIntegers: [],
      dither: {
        enabled: false,
        seed: null,
        lsbAmplitude: null,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth: null,
        maxInteger: null,
        residualMaxAbs: null,
        residualRms: null,
      },
      reasons: ['pcm_to_dsd_uses_sdm_noise_shaping_not_pcm_dither'],
    });
  });
});

describe('UZUME gain staging reference', () => {
  it('orders headroom before ReplayGain and materialized gain with cumulative telemetry', () => {
    const rendered = renderUzumeGainStagingReference({
      channels: [[0.5, -0.25]],
      headroomDb: -6,
      replayGainDb: -3,
      materializedGainDb: 12,
    });

    expect(rendered).toMatchObject({
      artifact: 'gain-staging-reference',
      engine: 'gain-reference',
      orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'],
      totalGainDb: 3,
      clipRisk: false,
      recommendedAdditionalHeadroomDb: 0,
      reasons: [
        'headroom_applied_before_replaygain_and_materialized_gain',
        'gain_stages_merge_to_single_gain_reference',
        'gain_staging_within_sample_peak_budget',
      ],
    });
    expect(rendered.totalGainLinear).toBeCloseTo(10 ** (3 / 20), 12);
    expect(rendered.stages.map((stage) => stage.id)).toEqual(['input', 'headroom', 'replaygain', 'materialized-gain', 'output']);
    expect(rendered.stages.map((stage) => stage.cumulativeGainDb)).toEqual([0, -6, -9, 3, 3]);
    expect(rendered.stages[1].peak).toBeLessThan(rendered.stages[0].peak);
    expect(rendered.stages[2].peak).toBeLessThan(rendered.stages[1].peak);
    expect(rendered.stages[3].peak).toBeCloseTo(0.5 * 10 ** (3 / 20), 12);
    expect(rendered.output[0][0]).toBeCloseTo(0.5 * 10 ** (3 / 20), 12);
  });

  it('reports extra headroom when materialized gain would exceed sample peak budget', () => {
    const rendered = renderUzumeGainStagingReference({
      channels: [[0.9, -0.9]],
      materializedGainDb: 6,
    });

    expect(rendered.clipRisk).toBe(true);
    expect(rendered.stages.find((stage) => stage.id === 'materialized-gain')?.clippingRisk).toBe(true);
    expect(rendered.recommendedAdditionalHeadroomDb).toBeGreaterThan(5);
    expect(rendered.reasons).toEqual([
      'headroom_applied_before_replaygain_and_materialized_gain',
      'gain_stages_merge_to_single_gain_reference',
      'post_gain_clip_risk_requires_more_headroom',
    ]);
  });
});

describe('UZUME PCM ingress guard reference', () => {
  it('sanitizes NaN, Infinity, and denormal samples without altering finite program material', () => {
    const analyzed = analyzeUzumePcmIngressGuardReference({
      expectedChannels: 2,
      denormalThreshold: 1e-12,
      channels: [
        [0, Number.NaN, 0.25, Number.POSITIVE_INFINITY, -1e-13],
        [0, Number.NEGATIVE_INFINITY, -0.5, 1e-14, 0.75],
      ],
    });

    expect(analyzed).toMatchObject({
      artifact: 'pcm-ingress-guard-reference',
      state: 'sanitized',
      expectedChannels: 2,
      channelCount: 2,
      frameCount: 5,
      rectangular: true,
      counts: {
        nonFiniteReplaced: 3,
        denormalZeroed: 2,
        channelMismatchCount: 0,
        silenceFrames: 3,
      },
      reasons: ['non_finite_samples_replaced_with_zero', 'denormal_samples_zeroed'],
    });
    expect(analyzed.sanitizedChannels).toEqual([
      [0, 0, 0.25, 0, 0],
      [0, 0, -0.5, 0, 0.75],
    ]);
    expect(analyzed.peak).toBe(0.75);
  });

  it('keeps all-silence ingress as an explicit silence artifact', () => {
    const analyzed = analyzeUzumePcmIngressGuardReference({
      expectedChannels: 2,
      channels: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    });

    expect(analyzed).toMatchObject({
      state: 'silence',
      rectangular: true,
      sanitizedChannels: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      counts: {
        nonFiniteReplaced: 0,
        denormalZeroed: 0,
        channelMismatchCount: 0,
        silenceFrames: 3,
      },
      peak: 0,
      reasons: ['silence_preserved_as_zero'],
    });
  });

  it('reports channel mismatch without throwing so compiler preflight can explain it', () => {
    const analyzed = analyzeUzumePcmIngressGuardReference({
      expectedChannels: 2,
      channels: [
        [0, 0.5, 1],
        [0, -0.5],
        [0.25, 0.125, 0],
      ],
    });

    expect(analyzed).toMatchObject({
      state: 'channel-mismatch',
      expectedChannels: 2,
      channelCount: 3,
      frameCount: 3,
      rectangular: false,
      counts: {
        nonFiniteReplaced: 0,
        denormalZeroed: 0,
        channelMismatchCount: 2,
        silenceFrames: 0,
      },
      reasons: ['channel_layout_or_frame_count_mismatch'],
    });
    expect(analyzed.sanitizedChannels[1]).toEqual([0, -0.5, 0]);
  });
});

describe('UZUME continuity strategy reference planner', () => {
  it('applies mute as a callback-safe declick gain ramp over committed output', () => {
    const rendered = renderUzumeCallbackSafeControlReference({
      generationId: 100,
      control: 'mute',
      committedBlock: [
        [1, 1, 1, 1],
        [-1, -1, -1, -1],
      ],
      currentGain: 1,
      mute: true,
      declickFrames: 4,
    });

    expect(rendered).toMatchObject({
      artifact: 'callback-safe-urgent-controls-reference',
      policy: 'urgent-controls-after-committed-output',
      control: 'mute',
      classification: 'callback-safe-urgent-control',
      generationState: 'current',
      state: 'applied',
      callbackRule: 'read-committed-output-then-apply-urgent-control',
      renderCacheAction: 'preserve',
      generationAfterControl: 100,
      requiresRenderGraphRebuild: false,
      commitAllowed: true,
      declick: {
        enabled: true,
        frames: 4,
        startGain: 1,
        endGain: 0,
      },
      reasons: ['callback_safe_urgent_control', 'render_cache_preserved', 'declick_gain_ramp', 'output_gain_zeroed'],
    });
    rendered.gainEnvelope.forEach((gain, index) => {
      expect(gain.gain).toBeCloseTo([1, 2 / 3, 1 / 3, 0][index], 12);
    });
    rendered.output[0].forEach((sample, index) => {
      expect(sample).toBeCloseTo([1, 2 / 3, 1 / 3, 0][index], 12);
    });
    rendered.output[1].forEach((sample, index) => {
      expect(sample).toBeCloseTo([-1, -2 / 3, -1 / 3, 0][index], 12);
    });
    expect(rendered.peak.output).toBe(1);
  });

  it('keeps volume-only urgent controls out of render cache invalidation', () => {
    const rendered = renderUzumeCallbackSafeControlReference({
      generationId: 101,
      control: 'volume',
      committedBlock: [[0.5, -0.5]],
      targetVolumeDb: -6,
    });

    expect(rendered).toMatchObject({
      state: 'applied',
      classification: 'callback-safe-urgent-control',
      renderCacheAction: 'preserve',
      generationAfterControl: 101,
      requiresRenderGraphRebuild: false,
      declick: {
        enabled: false,
        frames: 0,
      },
      reasons: ['callback_safe_urgent_control', 'render_cache_preserved', 'constant_gain_applied'],
    });
    expect(rendered.gainEnvelope[0].gain).toBeCloseTo(10 ** (-6 / 20), 12);
    expect(rendered.output[0][0]).toBeCloseTo(0.5 * 10 ** (-6 / 20), 12);
  });

  it('treats seek, flush, and reset as generation boundaries instead of urgent controls', () => {
    const planned = renderUzumeCallbackSafeControlReference({
      generationId: 44,
      control: 'seek',
      committedBlock: [[1, 0, -1]],
    });

    expect(planned).toMatchObject({
      control: 'seek',
      classification: 'render-state-boundary',
      generationState: 'current',
      state: 'render-cache-invalidated',
      callbackRule: 'read-committed-output-only',
      renderCacheAction: 'invalidate-generation',
      generationAfterControl: 45,
      requiresRenderGraphRebuild: true,
      commitAllowed: false,
      output: [],
      gainEnvelope: [],
      reasons: [
        'transport_boundary_requires_generation_increment',
        'render_ahead_cache_invalidated',
        'callback_keeps_prior_committed_output',
      ],
    });
  });

  it('rejects stale callback-control candidates before applying a gain envelope', () => {
    const planned = renderUzumeCallbackSafeControlReference({
      generationId: 51,
      candidateGenerationId: 50,
      control: 'volume',
      committedBlock: [[1, 1]],
      targetVolumeDb: -12,
      declickFrames: 2,
    });

    expect(planned).toMatchObject({
      generationState: 'stale-candidate',
      state: 'stale-candidate-rejected',
      callbackRule: 'read-committed-output-only',
      renderCacheAction: 'reject-stale-generation',
      generationAfterControl: 51,
      commitAllowed: false,
      output: [],
      gainEnvelope: [],
      reasons: ['stale_generation_rejected', 'callback_keeps_prior_committed_output'],
    });
  });

  it('keeps gapless boundaries on full-quality paths and rejects short bridge fallback', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'gapless-boundary',
      policy: 'random-access-short-bridge',
      generationId: 42,
      shortBridgeAvailable: true,
      userAllowsShortBridge: true,
    });

    expect(planned).toMatchObject({
      artifact: 'continuity-quality-policy-reference',
      selectedPath: 'wait-for-full-profile',
      commitAllowed: false,
      shortBridgeAllowed: false,
      shortBridgeReason: 'intent_requires_full_quality_profile',
      mustKeepFullProfile: true,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'cpu-or-gpu-full-profile',
      callbackRule: 'read-committed-output-only',
    });
  });

  it('prefers generation-valid predictive cache over a short bridge at playlist boundaries', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'normal-playlist-boundary',
      policy: 'predictive-cache',
      generationId: 7,
      predictiveCacheHit: true,
      shortBridgeAvailable: true,
      userAllowsShortBridge: true,
    });

    expect(planned).toMatchObject({
      selectedPath: 'predictive-cache',
      commitAllowed: true,
      shortBridgeAllowed: false,
      shortBridgeReason: 'intent_requires_full_quality_profile',
      qualityRollback: 'none',
      waitTarget: 'none',
      reasons: ['predictive_cache_generation_valid', 'full_quality_cache_preferred_over_short_bridge'],
    });
  });

  it('allows random-access short bridge only for explicit user seek or skip intent', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'user-random-seek-or-skip',
      policy: 'random-access-short-bridge',
      generationId: 9,
      shortBridgeAvailable: true,
      userAllowsShortBridge: true,
    });

    expect(planned).toMatchObject({
      selectedPath: 'random-access-short-bridge',
      commitAllowed: true,
      shortBridgeAllowed: true,
      shortBridgeReason: null,
      mustKeepFullProfile: true,
      requiresEqualPowerCrossfade: true,
      qualityRollback: 'short-bridge-temporary',
      waitTarget: 'cpu-or-gpu-full-profile',
      reasons: ['user_random_seek_or_skip', 'temporary_short_bridge_until_full_profile_ready'],
    });
  });

  it('uses the full profile instead of a short bridge when full-quality output is already ready', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'user-random-seek-or-skip',
      policy: 'random-access-short-bridge',
      generationId: 10,
      cpuFullProfileReady: true,
      shortBridgeAvailable: true,
      userAllowsShortBridge: true,
    });

    expect(planned).toMatchObject({
      selectedPath: 'cpu-full-profile',
      commitAllowed: true,
      shortBridgeAllowed: false,
      shortBridgeReason: 'full_profile_ready',
      mustKeepFullProfile: false,
      requiresEqualPowerCrossfade: false,
      qualityRollback: 'none',
      waitTarget: 'none',
      reasons: ['cpu_full_profile_ready'],
    });
  });

  it('rejects stale generation cache or GPU candidates before commit', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'cache-miss',
      policy: 'gpu-wait',
      generationId: 11,
      candidateGenerationId: 10,
      gpuFullProfileReady: true,
      predictiveCacheHit: true,
    });

    expect(planned).toMatchObject({
      generationState: 'stale-candidate',
      selectedPath: 'reject-stale-generation',
      commitAllowed: false,
      shortBridgeAllowed: false,
      shortBridgeReason: 'stale_generation_rejected',
      waitTarget: 'none',
      reasons: ['stale_generation_rejected', 'callback_keeps_prior_committed_output'],
    });
  });

  it('waits for GPU full profile before callback when acoustic-noise preference requests it', () => {
    const planned = planUzumeContinuityStrategyReference({
      intent: 'cold-start',
      policy: 'gpu-wait',
      generationId: 12,
      cpuFullProfileReady: true,
      gpuFullProfileReady: false,
      gpuPreferredForAcousticNoise: true,
      playbackAlreadyStarted: false,
    });

    expect(planned).toMatchObject({
      selectedPath: 'wait-for-full-profile',
      commitAllowed: false,
      mustKeepFullProfile: true,
      waitTarget: 'gpu-full-profile',
      reasons: ['controlled_gpu_wait_before_callback', 'intent_requires_full_quality_profile'],
    });
  });

  it('keeps CPU-only callback ring stable when full-profile production stays ahead', () => {
    const planned = planUzumeCpuCallbackRingReference({
      generationId: 70,
      ringCapacityFrames: 4096,
      callbackBlockFrames: 512,
      initialCommittedFrames: 2048,
      cpuProducedFrames: 1024,
      renderAheadTargetFrames: 1024,
      cpuRealtimeFactor: 2.4,
    });

    expect(planned).toMatchObject({
      artifact: 'cpu-callback-ring-reference',
      policy: 'cpu-full-profile-committed-ring',
      generationState: 'current',
      state: 'stable',
      callbackRule: 'read-committed-output-only',
      callbackMustNotWaitForGpu: true,
      shortBridgeAllowed: false,
      shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge',
      commitAllowed: true,
      ring: {
        capacityFrames: 4096,
        beforeWriteFrames: 2048,
        cpuProducedFrames: 1024,
        committedWriteFrames: 1024,
        droppedFrames: 0,
        beforeReadFrames: 3072,
        callbackReadFrames: 512,
        afterReadFrames: 2560,
        missingFrames: 0,
        renderAheadTargetFrames: 1024,
      },
      underrunTelemetry: {
        status: 'safe',
        underrunRisk: false,
        ringDepthFrames: 2560,
        ringDepthBlocks: 5,
      },
      reasons: [
        'callback_reads_committed_cpu_full_profile',
        'cpu_full_profile_write_committed',
        'callback_ring_depth_stable',
        'short_bridge_rejected_for_cpu_only_ring',
      ],
    });
  });

  it('reports callback ring underrun risk without enabling short bridge', () => {
    const planned = planUzumeCpuCallbackRingReference({
      generationId: 71,
      ringCapacityFrames: 1024,
      callbackBlockFrames: 512,
      initialCommittedFrames: 128,
      cpuProducedFrames: 256,
      renderAheadTargetFrames: 1024,
      cpuRealtimeFactor: 0.9,
    });

    expect(planned).toMatchObject({
      state: 'underrun',
      shortBridgeAllowed: false,
      commitAllowed: true,
      ring: {
        beforeReadFrames: 384,
        callbackReadFrames: 384,
        afterReadFrames: 0,
        missingFrames: 128,
      },
      underrunTelemetry: {
        status: 'unsafe',
        underrunRisk: true,
        cpuRealtimeFactor: 0.9,
      },
      reasons: [
        'callback_reads_committed_cpu_full_profile',
        'cpu_full_profile_write_committed',
        'callback_ring_underrun_reported',
        'short_bridge_rejected_for_cpu_only_ring',
      ],
    });
  });

  it('rejects stale CPU producer writes and only reads prior committed ring frames', () => {
    const planned = planUzumeCpuCallbackRingReference({
      generationId: 72,
      candidateGenerationId: 71,
      ringCapacityFrames: 1024,
      callbackBlockFrames: 256,
      initialCommittedFrames: 512,
      cpuProducedFrames: 512,
      renderAheadTargetFrames: 512,
    });

    expect(planned).toMatchObject({
      generationState: 'stale-candidate',
      state: 'underrun-risk',
      commitAllowed: false,
      ring: {
        beforeWriteFrames: 512,
        cpuProducedFrames: 512,
        committedWriteFrames: 0,
        droppedFrames: 512,
        beforeReadFrames: 512,
        callbackReadFrames: 256,
        afterReadFrames: 256,
        missingFrames: 0,
      },
      underrunTelemetry: {
        status: 'unsafe',
        underrunRisk: true,
        ringDepthBlocks: 1,
      },
      reasons: [
        'callback_reads_committed_cpu_full_profile',
        'stale_cpu_producer_rejected',
        'stale_generation_write_dropped',
        'callback_ring_low_depth_warning',
        'short_bridge_rejected_for_cpu_only_ring',
      ],
    });
  });

  it('reports next-track pre-roll deadline and keeps callback reads committed-only', () => {
    const planned = planUzumePreRollDeadlineReference({
      currentTrackId: 'track-a',
      nextTrackId: 'track-b',
      sampleRate: 48000,
      currentRemainingFrames: 24000,
      callbackBlockFrames: 512,
      outputRingDepthFrames: 1024,
      lookaheadFrames: 2048,
      groupDelayFrames: 512,
      firTailFrames: 2048,
      decodePrepareFrames: 4096,
      renderAheadTargetFrames: 9600,
      renderAheadReadyFrames: 2400,
      generationId: 20,
    });

    expect(planned).toMatchObject({
      artifact: 'pre-roll-deadline-reference',
      policy: 'next-track-full-profile-before-boundary',
      state: 'deadline-safe',
      generationState: 'current',
      preRollRequiredFrames: 10240,
      framesUntilBoundary: 24000,
      deadlineSlackFrames: 13760,
      preRollCanCompleteBeforeBoundary: true,
      renderAhead: {
        targetFrames: 9600,
        readyFrames: 2400,
        state: 'cache-warming',
      },
      callbackRing: {
        callbackBlockFrames: 512,
        outputRingDepthFrames: 1024,
        readRule: 'read-committed-output-only',
        mustNotWaitForGpu: true,
        committedBeforeBoundary: false,
      },
      commitAllowed: false,
      shortBridgeAllowed: false,
      shortBridgeReason: 'not_user_random_seek_or_skip',
      reasons: ['pre_roll_window_available', 'start_n_plus_one_decode_prepare', 'same_pipeline_gapless_no_reset_possible'],
    });
  });

  it('rejects stale pre-roll candidates even when the render-ahead cache is ready', () => {
    const planned = planUzumePreRollDeadlineReference({
      currentTrackId: 'track-a',
      nextTrackId: 'track-b',
      sampleRate: 48000,
      currentRemainingFrames: 12000,
      callbackBlockFrames: 512,
      outputRingDepthFrames: 1024,
      lookaheadFrames: 1024,
      groupDelayFrames: 256,
      renderAheadTargetFrames: 4096,
      renderAheadReadyFrames: 4096,
      generationId: 21,
      candidateGenerationId: 20,
    });

    expect(planned).toMatchObject({
      state: 'stale-candidate',
      generationState: 'stale-candidate',
      commitAllowed: false,
      renderAhead: {
        state: 'cache-hit',
      },
      callbackRing: {
        readRule: 'read-committed-output-only',
        mustNotWaitForGpu: true,
        committedBeforeBoundary: false,
      },
      reasons: ['stale_generation_rejected', 'callback_keeps_prior_committed_output', 'same_pipeline_gapless_no_reset_possible'],
    });
  });

  it('marks different-rate next tracks as dual-pipeline handoff instead of filter-state reuse', () => {
    const planned = planUzumePreRollDeadlineReference({
      currentTrackId: 'track-44k',
      nextTrackId: 'track-48k',
      sampleRate: 48000,
      currentRemainingFrames: 8192,
      callbackBlockFrames: 512,
      outputRingDepthFrames: 512,
      lookaheadFrames: 1024,
      groupDelayFrames: 256,
      nextProfileReady: true,
      generationId: 22,
      currentSampleRate: 44100,
      nextSampleRate: 48000,
      currentChannelCount: 2,
      nextChannelCount: 2,
    });

    expect(planned).toMatchObject({
      state: 'ready',
      commitAllowed: true,
      renderAhead: {
        state: 'full-profile-ready',
      },
      handoff: {
        currentSampleRate: 44100,
        nextSampleRate: 48000,
        requiresDualPipeline: true,
        strategy: 'dual-pipeline-handoff',
        declickOnly: true,
      },
      reasons: ['full_profile_ready_before_boundary', 'dual_pipeline_handoff_required'],
    });
  });

  it('commits a generation-valid render-ahead cache hit before the callback slot', () => {
    const planned = planUzumeRenderAheadCacheReference({
      generationId: 30,
      requestKey: 'next-head:track-b:0',
      requiredStartFrame: 0,
      requiredFrames: 4096,
      targetCallbackFrame: 12000,
      callbackBlockFrames: 512,
      cacheBudgetBytes: 24_000,
      entries: [
        {
          key: 'next-head:track-b:0',
          trackId: 'track-b',
          generationId: 30,
          startFrame: 0,
          frameCount: 8192,
          bytes: 16_000,
          completedAtFrame: 11000,
          distanceToBoundaryFrames: 2048,
          kind: 'next-head',
        },
      ],
    });

    expect(planned).toMatchObject({
      artifact: 'render-ahead-cache-reference',
      policy: 'generation-safe-render-ahead-cache',
      lookupState: 'hit',
      commitState: 'commit-to-callback-slot',
      commitAllowed: true,
      callbackRule: 'read-committed-output-only',
      callbackMustNotWaitForGpu: true,
      requestedEntry: {
        coversRequest: true,
        completedAtFrame: 11000,
        deadlineSlackFrames: 1000,
      },
      retainedKeys: ['next-head:track-b:0'],
      reasons: ['cache_hit_generation_valid', 'completed_before_callback_slot'],
    });
  });

  it('retains late generation-valid render-ahead blocks for future cache without blocking callback', () => {
    const planned = planUzumeRenderAheadCacheReference({
      generationId: 31,
      requestKey: 'tail:track-a:98304',
      requiredStartFrame: 98304,
      requiredFrames: 4096,
      targetCallbackFrame: 99000,
      callbackBlockFrames: 512,
      cacheBudgetBytes: 24_000,
      entries: [
        {
          key: 'tail:track-a:98304',
          trackId: 'track-a',
          generationId: 31,
          startFrame: 98304,
          frameCount: 4096,
          bytes: 12_000,
          completedAtFrame: 99500,
          distanceToBoundaryFrames: 512,
          kind: 'current-tail',
        },
      ],
    });

    expect(planned).toMatchObject({
      lookupState: 'late-hit',
      commitState: 'retain-for-future-cache',
      commitAllowed: false,
      callbackMustNotWaitForGpu: true,
      requestedEntry: {
        coversRequest: true,
        completedAtFrame: 99500,
        deadlineSlackFrames: -500,
      },
      retainedKeys: ['tail:track-a:98304'],
      reasons: ['generation_valid_but_late_for_callback_slot', 'retain_for_future_boundary_or_crossfade'],
    });
  });

  it('rejects stale cache hits and evicts over-budget far-future entries first', () => {
    const planned = planUzumeRenderAheadCacheReference({
      generationId: 32,
      requestKey: 'next-head:track-c:0',
      requiredStartFrame: 0,
      requiredFrames: 2048,
      targetCallbackFrame: 48000,
      callbackBlockFrames: 512,
      cacheBudgetBytes: 18_000,
      entries: [
        {
          key: 'next-head:track-c:0',
          trackId: 'track-c',
          generationId: 31,
          startFrame: 0,
          frameCount: 4096,
          bytes: 8000,
          completedAtFrame: 47000,
          distanceToBoundaryFrames: 1024,
          kind: 'next-head',
        },
        {
          key: 'gapless:album:segment-1',
          trackId: 'track-d',
          generationId: 32,
          startFrame: 0,
          frameCount: 8192,
          bytes: 14_000,
          completedAtFrame: 46000,
          distanceToBoundaryFrames: 32000,
          kind: 'gapless-album-segment',
        },
        {
          key: 'tail:track-b:65536',
          trackId: 'track-b',
          generationId: 32,
          startFrame: 65536,
          frameCount: 4096,
          bytes: 10_000,
          completedAtFrame: 45500,
          distanceToBoundaryFrames: 2048,
          kind: 'current-tail',
        },
      ],
    });

    expect(planned).toMatchObject({
      lookupState: 'stale-hit-rejected',
      commitState: 'reject-stale-generation',
      commitAllowed: false,
      callbackMustNotWaitForGpu: true,
      cacheStats: {
        budgetBytes: 18_000,
        bytesBeforeEvict: 32_000,
        bytesAfterEvict: 10_000,
        entryCountBeforeEvict: 3,
        entryCountAfterEvict: 1,
      },
      evictions: [
        { key: 'next-head:track-c:0', reason: 'stale-generation' },
        { key: 'gapless:album:segment-1', reason: 'over-budget-farthest-from-boundary' },
      ],
      retainedKeys: ['tail:track-b:65536'],
      reasons: [
        'stale_generation_rejected',
        'callback_keeps_prior_committed_output',
        'cache_budget_evicted_farthest_future_entries',
      ],
    });
  });

  it('commits a generation-valid GPU render-ahead block when it is ready before callback', () => {
    const simulated = simulateUzumeFallbackInjectionReference({
      generationId: 60,
      targetCallbackFrame: 48000,
      callbackBlockFrames: 4,
      expectedChannels: 2,
      callbackRingDepthFrames: 16,
      renderAheadDepthFrames: 32,
      renderAheadTargetFrames: 16,
      rollingRealtimeFactor: 2.5,
      gpuCandidate: {
        kind: 'gpu-render-ahead',
        generationId: 60,
        completedAtFrame: 47900,
        channels: [
          [0.1, 0.2, 0.3, 0.4],
          [-0.1, -0.2, -0.3, -0.4],
        ],
      },
      cpuCandidate: {
        kind: 'cpu-main-chain',
        generationId: 60,
        completedAtFrame: 47950,
        channels: [
          [0.5, 0.5, 0.5, 0.5],
          [-0.5, -0.5, -0.5, -0.5],
        ],
      },
    });

    expect(simulated).toMatchObject({
      artifact: 'fallback-injection-underrun-reference',
      policy: 'callback-never-waits-for-gpu',
      state: 'gpu-render-ahead-commit',
      selectedSource: 'gpu-render-ahead',
      callbackMustNotWaitForGpu: true,
      shortBridgeAllowed: false,
      shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge',
      commitAllowed: true,
      fallbackInjected: false,
      qualityRollback: 'none',
      gpuCandidate: {
        present: true,
        generationState: 'current',
        deadlineState: 'ready-before-callback',
        deadlineMissFrames: 0,
        retainedForFuture: false,
      },
      underrunTelemetry: {
        status: 'safe',
        underrunRisk: false,
        injectedSilenceFrames: 0,
        missingOutputFrames: 0,
      },
      reasons: [
        'callback_does_not_wait_for_gpu',
        'gpu_render_ahead_ready_before_callback',
        'short_bridge_rejected_for_underrun_protection',
      ],
    });
    expect(simulated.output[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('uses CPU full-profile fallback when GPU misses the callback deadline', () => {
    const simulated = simulateUzumeFallbackInjectionReference({
      generationId: 61,
      targetCallbackFrame: 24000,
      callbackBlockFrames: 4,
      expectedChannels: 1,
      callbackRingDepthFrames: 8,
      renderAheadDepthFrames: 2,
      renderAheadTargetFrames: 16,
      rollingRealtimeFactor: 1.5,
      gpuCandidate: {
        kind: 'gpu-render-ahead',
        generationId: 61,
        completedAtFrame: 24020,
        channels: [[1, 1, 1, 1]],
      },
      cpuCandidate: {
        kind: 'cpu-main-chain',
        generationId: 61,
        completedAtFrame: 23980,
        channels: [[0.25, 0.5, 0.25, 0]],
      },
    });

    expect(simulated).toMatchObject({
      state: 'cpu-main-chain-fallback',
      selectedSource: 'cpu-main-chain',
      commitAllowed: true,
      fallbackInjected: true,
      qualityRollback: 'controlled-fallback',
      gpuCandidate: {
        deadlineState: 'late-for-callback',
        deadlineMissFrames: 20,
        retainedForFuture: true,
      },
      underrunTelemetry: {
        status: 'marginal',
        underrunRisk: true,
        injectedSilenceFrames: 0,
      },
      rejectedCandidates: [
        { kind: 'gpu-render-ahead', reason: 'late-for-callback' },
      ],
      reasons: [
        'callback_does_not_wait_for_gpu',
        'cpu_full_profile_fallback_used',
        'late_gpu_candidate_retained_for_future',
        'controlled_fallback_injected',
        'short_bridge_rejected_for_underrun_protection',
      ],
    });
    expect(simulated.output).toEqual([[0.25, 0.5, 0.25, 0]]);
  });

  it('injects controlled silence and underrun telemetry only when no full-profile output exists', () => {
    const simulated = simulateUzumeFallbackInjectionReference({
      generationId: 62,
      targetCallbackFrame: 12000,
      callbackBlockFrames: 3,
      expectedChannels: 2,
      callbackRingDepthFrames: 0,
      renderAheadDepthFrames: 0,
      renderAheadTargetFrames: 12,
      rollingRealtimeFactor: 0.8,
    });

    expect(simulated).toMatchObject({
      state: 'silence-injected',
      selectedSource: 'silence',
      commitAllowed: true,
      fallbackInjected: true,
      qualityRollback: 'silence-underrun',
      output: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      underrunTelemetry: {
        status: 'unsafe',
        underrunRisk: true,
        injectedSilenceFrames: 3,
        missingOutputFrames: 0,
        callbackRingDepthFrames: 0,
        renderAheadDepthFrames: 0,
        renderAheadTargetFrames: 12,
        rollingRealtimeFactor: 0.8,
      },
      reasons: [
        'callback_does_not_wait_for_gpu',
        'controlled_silence_injected',
        'underrun_telemetry_reported',
        'short_bridge_rejected_for_underrun_protection',
      ],
    });
  });

  it('rejects stale fallback candidates rather than committing output from an old generation', () => {
    const simulated = simulateUzumeFallbackInjectionReference({
      generationId: 63,
      targetCallbackFrame: 32000,
      callbackBlockFrames: 2,
      expectedChannels: 1,
      allowSilenceFallback: false,
      gpuCandidate: {
        kind: 'gpu-render-ahead',
        generationId: 62,
        completedAtFrame: 31900,
        channels: [[0.5, 0.5]],
      },
      cpuCandidate: {
        kind: 'cpu-main-chain',
        generationId: 62,
        completedAtFrame: 31800,
        channels: [[0.25, 0.25]],
      },
    });

    expect(simulated).toMatchObject({
      state: 'stale-candidate-rejected',
      selectedSource: null,
      commitAllowed: false,
      fallbackInjected: false,
      qualityRollback: 'none',
      output: [],
      gpuCandidate: {
        generationState: 'stale-candidate',
      },
      underrunTelemetry: {
        status: 'unsafe',
        underrunRisk: true,
        missingOutputFrames: 2,
      },
      rejectedCandidates: [
        { kind: 'gpu-render-ahead', reason: 'stale-generation' },
        { kind: 'cpu-main-chain', reason: 'stale-generation' },
      ],
      reasons: [
        'callback_does_not_wait_for_gpu',
        'no_generation_valid_output_available',
        'stale_gpu_candidate_rejected',
        'short_bridge_rejected_for_underrun_protection',
      ],
    });
  });

  it('renders an equal-power crossfade from random-access short bridge to the full profile', () => {
    const rendered = renderUzumeEqualPowerCrossfadeReference({
      intent: 'user-random-seek-or-skip',
      sampleRate: 48000,
      fadeFrames: 5,
      fullProfileReady: true,
      shortBridge: [[1, 0.75, 0.5, 0.25, 0]],
      fullProfile: [[0, 0.25, 0.5, 0.75, 1]],
    });

    expect(rendered).toMatchObject({
      artifact: 'equal-power-crossfade-reference',
      policy: 'random-access-short-bridge-to-full-profile-only',
      state: 'crossfade-rendered',
      rejectionReason: null,
      shortBridgeGainStartsAt: 1,
      fullProfileGainEndsAt: 1,
      fadeFrames: 5,
    });
    expect(rendered.gains[0]).toMatchObject({
      frame: 0,
      shortBridgeGain: 1,
      fullProfileGain: 0,
      powerSum: 1,
    });
    expect(rendered.gains[4].shortBridgeGain).toBeCloseTo(0, 12);
    expect(rendered.gains[4].fullProfileGain).toBeCloseTo(1, 12);
    expect(rendered.gainLaw).toMatchObject({
      state: 'equal-power',
      maxPowerSumError: 0,
    });
    expect(rendered.gainLaw.midpointShortBridgeGain).toBeCloseTo(Math.SQRT1_2, 12);
    expect(rendered.gainLaw.midpointFullProfileGain).toBeCloseTo(Math.SQRT1_2, 12);
    expect(rendered.residualVsHardSwitch).toMatchObject({
      state: 'measured-crossfade-difference',
      comparedFrames: 5,
    });
    expect(rendered.residualVsHardSwitch.maxAbs).toBeGreaterThan(0.1);
    expect(rendered.peak.output).toBeLessThanOrEqual(Math.max(rendered.peak.shortBridge, rendered.peak.fullProfile));
  });

  it('rejects equal-power crossfade outside explicit user seek or skip intent', () => {
    const rendered = renderUzumeEqualPowerCrossfadeReference({
      intent: 'gapless-boundary',
      sampleRate: 48000,
      fadeFrames: 4,
      fullProfileReady: true,
      shortBridge: [[1, 0.5, 0.25, 0]],
      fullProfile: [[0, 0.25, 0.5, 1]],
    });

    expect(rendered).toMatchObject({
      state: 'rejected',
      rejectionReason: 'intent_not_user_random_seek_or_skip',
      output: [],
      gains: [],
      gainLaw: {
        state: 'not-applicable',
      },
      residualVsHardSwitch: {
        state: 'not-applicable',
      },
    });
  });

  it('waits for the full profile before rendering a short-bridge crossfade', () => {
    const rendered = renderUzumeEqualPowerCrossfadeReference({
      intent: 'user-random-seek-or-skip',
      sampleRate: 48000,
      fadeFrames: 4,
      fullProfileReady: false,
      shortBridge: [[1, 0.5, 0.25, 0]],
      fullProfile: [[0, 0.25, 0.5, 1]],
    });

    expect(rendered.state).toBe('rejected');
    expect(rendered.rejectionReason).toBe('full_profile_not_ready');
  });
});

describe('UZUME shared convolution reference planner', () => {
  it('merges compatible FIR EQ, headphone FIR, and room IR sources into one partition plan', () => {
    const planned = planUzumeSharedConvolutionReference({
      targetRate: 48000,
      targetChannels: 2,
      callbackBlockFrames: 256,
      latencyClass: 'quality-first',
      sources: [
        { id: 'fir-eq', kind: 'fir-eq', sampleRate: 48000, channels: 2, tapCount: 257, phasePolicy: 'linear' },
        { id: 'headphone-fir', kind: 'headphone-fir-correction', sampleRate: 48000, channels: 2, tapCount: 1024, phasePolicy: 'linear' },
        { id: 'room-ir', kind: 'room-ir', sampleRate: 48000, channels: 2, tapCount: 2048, phasePolicy: 'linear' },
      ],
    });

    expect(planned.active).toBe(true);
    expect(planned.mergedSourceIds).toEqual(['fir-eq', 'headphone-fir', 'room-ir']);
    expect(planned.splitReasons).toEqual({});
    expect(planned.partitionPlan).toMatchObject({
      sampleRateFamily: '48k-family',
      exactSampleRate: 48000,
      channelLayout: 'stereo',
      latencyClass: 'quality-first',
      callbackBlockFrames: 256,
      outputBlockFrames: 256,
      directHeadTaps: 128,
      fftHeadSize: 512,
      overlapStrategy: 'overlap-save-reference',
    });
    expect(planned.partitionPlan.internalBlockFrames).toBeGreaterThan(planned.partitionPlan.callbackBlockFrames - 1);
    expect(planned.partitionPlan.partitionCount).toBeGreaterThan(1);
    expect(planned.partitionPlan.tailFrames).toBe(3326);
    expect(planned.partitionPlan.drainFrames).toBe(planned.partitionPlan.tailFrames);
    expect(planned.partitionPlan.cpuPlanId).toContain('fir-eq+headphone-fir+room-ir');
    expect(planned.partitionPlan.gpuPlanId).toContain('gpu-sce-48k-family');
    expect(planned.responseResampleReports).toEqual([
      expect.objectContaining({ sourceId: 'fir-eq', state: 'same-rate-bypass', linearInterpolationRejected: false, reason: 'same_rate_exact_bypass' }),
      expect.objectContaining({ sourceId: 'headphone-fir', state: 'same-rate-bypass', linearInterpolationRejected: false, reason: 'same_rate_exact_bypass' }),
      expect.objectContaining({ sourceId: 'room-ir', state: 'same-rate-bypass', linearInterpolationRejected: false, reason: 'same_rate_exact_bypass' }),
    ]);
  });

  it('keeps incompatible convolution sources as explained split sections', () => {
    const planned = planUzumeSharedConvolutionReference({
      targetRate: 48000,
      targetChannels: 2,
      callbackBlockFrames: 512,
      sources: [
        { id: 'room-ir', kind: 'room-ir', sampleRate: 44100, channels: 2, tapCount: 2048, phasePolicy: 'linear' },
        { id: 'advanced-matrix', kind: 'advanced-matrix-fir', sampleRate: 48000, channels: 2, tapCount: 512, routing: 'matrix' },
      ],
    });

    expect(planned.active).toBe(false);
    expect(planned.mergedSourceIds).toEqual([]);
    expect(planned.splitReasons).toEqual({
      'advanced-matrix': 'advanced_matrix_fir_requires_dedicated_matrix_plan',
      'room-ir': 'sample_rate_family_mismatch',
    });
    expect(planned.responseResampleReports).toEqual([
      expect.objectContaining({
        sourceId: 'room-ir',
        state: 'windowed-sinc-reference-required',
        engine: 'windowed-sinc-float64-reference',
        linearInterpolationRejected: true,
        reason: 'cross_family_response_resample_uses_windowed_sinc_reference',
      }),
      expect.objectContaining({
        sourceId: 'advanced-matrix',
        state: 'same-rate-bypass',
        engine: 'exact-bypass',
        linearInterpolationRejected: false,
      }),
    ]);
    expect(planned.partitionPlan).toMatchObject({
      latencyClass: 'inactive',
      internalBlockFrames: 0,
      partitionCount: 0,
      drainFrames: 0,
    });
  });

  it('rejects duplicate convolver and FFT plans for compatible merged sources', () => {
    const guarded = planUzumeSharedConvolutionDuplicateGuardReference({
      targetRate: 48000,
      targetChannels: 2,
      callbackBlockFrames: 256,
      latencyClass: 'quality-first',
      sources: [
        { id: 'fir-eq', kind: 'fir-eq', sampleRate: 48000, channels: 2, tapCount: 257, phasePolicy: 'linear' },
        { id: 'headphone-fir', kind: 'headphone-fir-correction', sampleRate: 48000, channels: 2, tapCount: 1024, phasePolicy: 'linear' },
        { id: 'room-ir', kind: 'room-ir', sampleRate: 48000, channels: 2, tapCount: 2048, phasePolicy: 'linear' },
      ],
    });

    expect(guarded).toMatchObject({
      artifact: 'shared-convolution-duplicate-plan-guard-reference',
      engine: 'shared-convolution-planner-reference',
      state: 'single-shared-plan',
      planCounts: {
        mergedSourceCount: 3,
        splitSourceCount: 0,
        convolverPlanCount: 1,
        cpuFftPlanCount: 1,
        gpuFftPlanCount: 1,
        rejectedDuplicateConvolverCount: 2,
        rejectedDuplicateFftPlanCount: 2,
      },
      rejectedDuplicatePlans: [
        {
          sourceId: 'headphone-fir',
          rejectedConvolverPlanId: 'per-source-convolver:headphone-fir',
          rejectedFftPlanId: 'per-source-fft:headphone-fir',
          reason: 'compatible_source_uses_shared_convolution_plan',
        },
        {
          sourceId: 'room-ir',
          rejectedConvolverPlanId: 'per-source-convolver:room-ir',
          rejectedFftPlanId: 'per-source-fft:room-ir',
          reason: 'compatible_source_uses_shared_convolution_plan',
        },
      ],
      reasons: [
        'compatible_sources_share_single_convolution_plan',
        'duplicate_per_source_convolver_and_fft_plans_rejected',
      ],
    });
    const convolverPlanIds = new Set(guarded.sourceAssignments.map((assignment) => assignment.convolverPlanId));
    const fftPlanIds = new Set(guarded.sourceAssignments.map((assignment) => assignment.fftPlanId));
    expect(convolverPlanIds.size).toBe(1);
    expect(fftPlanIds.size).toBe(1);
    expect(guarded.sourceAssignments).toEqual([
      expect.objectContaining({ sourceId: 'fir-eq', state: 'shared-plan', splitReason: null }),
      expect.objectContaining({ sourceId: 'headphone-fir', state: 'shared-plan', splitReason: null }),
      expect.objectContaining({ sourceId: 'room-ir', state: 'shared-plan', splitReason: null }),
    ]);
  });

  it('allows split sections only when an explicit split reason exists', () => {
    const guarded = planUzumeSharedConvolutionDuplicateGuardReference({
      targetRate: 48000,
      targetChannels: 2,
      callbackBlockFrames: 512,
      sources: [
        { id: 'room-ir', kind: 'room-ir', sampleRate: 44100, channels: 2, tapCount: 2048, phasePolicy: 'linear' },
        { id: 'advanced-matrix', kind: 'advanced-matrix-fir', sampleRate: 48000, channels: 2, tapCount: 512, routing: 'matrix' },
      ],
    });

    expect(guarded).toMatchObject({
      state: 'split-required',
      planCounts: {
        mergedSourceCount: 0,
        splitSourceCount: 2,
        convolverPlanCount: 0,
        cpuFftPlanCount: 0,
        gpuFftPlanCount: 0,
        rejectedDuplicateConvolverCount: 0,
        rejectedDuplicateFftPlanCount: 0,
      },
      rejectedDuplicatePlans: [],
      reasons: ['split_sources_require_explained_separate_sections', 'duplicate_plan_guard_deferred_to_split_reason'],
    });
    expect(guarded.sourceAssignments).toEqual([
      expect.objectContaining({
        sourceId: 'room-ir',
        state: 'split-required',
        convolverPlanId: null,
        splitReason: 'sample_rate_family_mismatch',
      }),
      expect.objectContaining({
        sourceId: 'advanced-matrix',
        state: 'split-required',
        convolverPlanId: null,
        splitReason: 'advanced_matrix_fir_requires_dedicated_matrix_plan',
      }),
    ]);
  });

  it('preflights convolution responses for peak, DC offset, and non-finite samples', () => {
    const preflight = analyzeUzumeSharedConvolutionResponsePreflightReference({
      sourceId: 'room-ir',
      kind: 'room-ir',
      sampleRate: 48000,
      expectedChannels: 2,
      responses: [[1.25, Number.NaN, -0.25, Number.POSITIVE_INFINITY, 0.25]],
    });

    expect(preflight).toMatchObject({
      artifact: 'shared-convolution-response-preflight-reference',
      engine: 'shared-convolution-planner-reference',
      sourceId: 'room-ir',
      kind: 'room-ir',
      sampleRate: 48000,
      sampleRateFamily: '48k-family',
      state: 'sanitized',
      expectedChannels: 2,
      inputChannels: 1,
      effectiveChannels: 2,
      tapCount: 5,
      peak: 1.25,
      peakOverUnity: true,
      dcOffsetByChannel: [0.25, 0.25],
      maxAbsDcOffset: 0.25,
      nonFiniteSamples: 2,
      sanitizedSamples: 2,
      sanitizedResponses: [
        [1.25, 0, -0.25, 0, 0.25],
        [1.25, 0, -0.25, 0, 0.25],
      ],
      reasons: [
        'peak_measured',
        'dc_offset_measured',
        'peak_over_unity',
        'dc_offset_warning',
        'non_finite_response_samples_zeroed',
      ],
    });
  });

  it('reports convolution response channel mismatch without building a silent merge input', () => {
    const preflight = analyzeUzumeSharedConvolutionResponsePreflightReference({
      sourceId: 'matrix-ir',
      kind: 'advanced-matrix-fir',
      sampleRate: 48000,
      expectedChannels: 2,
      responses: [[1, -1], [1, -1], [0.5, -0.5]],
    });

    expect(preflight).toMatchObject({
      state: 'channel-mismatch',
      expectedChannels: 2,
      inputChannels: 3,
      effectiveChannels: 3,
      tapCount: 2,
      nonFiniteSamples: 0,
      reasons: [
        'peak_measured',
        'dc_offset_measured',
        'response_channel_mismatch',
      ],
    });
    expect(preflight.sanitizedResponses).toHaveLength(3);
  });

  it('matches compatible merged FIR response against serial direct reference', () => {
    const rendered = renderUzumeSharedConvolutionSerialReference({
      targetRate: 48000,
      targetChannels: 2,
      callbackBlockFrames: 128,
      signal: [
        [1, 0.25, -0.5, 0, 0.125],
        [0.5, -0.25, 0, 0.25, -0.125],
      ],
      sources: [
        {
          id: 'fir-eq',
          kind: 'fir-eq',
          sampleRate: 48000,
          channels: 2,
          tapCount: 3,
          phasePolicy: 'linear',
          responses: [
            [0.5, 0.25, 0.125],
            [0.25, 0.5, 0.125],
          ],
        },
        {
          id: 'headphone-fir',
          kind: 'headphone-fir-correction',
          sampleRate: 48000,
          channels: 2,
          tapCount: 2,
          phasePolicy: 'linear',
          responses: [[1, -0.25]],
        },
        {
          id: 'room-ir',
          kind: 'room-ir',
          sampleRate: 48000,
          channels: 2,
          tapCount: 3,
          phasePolicy: 'linear',
          responses: [[0.75, 0.125, -0.0625]],
        },
      ],
    });

    expect(rendered.artifact).toBe('shared-convolution-serial-null-reference');
    expect(rendered.sourceOrder).toEqual(['fir-eq', 'headphone-fir', 'room-ir']);
    expect(rendered.planner.active).toBe(true);
    expect(rendered.planner.partitionPlan.tailFrames).toBe(5);
    expect(rendered.mergedResponses[0]).toHaveLength(6);
    expect(rendered.mergedOutput[0]).toEqual(rendered.serialOutput[0]);
    expect(rendered.residual).toEqual({
      state: 'merged-matches-serial',
      comparedFrames: 10,
      maxAbs: 0,
      rms: 0,
    });
  });

  it('does not produce a serial null artifact for split convolution sources', () => {
    const rendered = renderUzumeSharedConvolutionSerialReference({
      targetRate: 48000,
      targetChannels: 2,
      signal: [[1, 0], [0, 1]],
      sources: [
        {
          id: 'room-ir',
          kind: 'room-ir',
          sampleRate: 44100,
          channels: 2,
          tapCount: 2,
          responses: [[1, 0.5]],
        },
      ],
    });

    expect(rendered.planner.active).toBe(false);
    expect(rendered.planner.splitReasons).toEqual({
      'room-ir': 'sample_rate_family_mismatch',
    });
    expect(rendered.residual).toEqual({
      state: 'split-or-inactive',
      comparedFrames: 0,
      maxAbs: null,
      rms: null,
    });
  });
});

describe('UZUME PEQ/basic IIR reference', () => {
  it('renders ordered biquad coefficients, response, and processed residual', () => {
    const rendered = renderUzumeIirEqReference({
      sampleRate: 48000,
      responseFrequenciesHz: [100, 1000, 10000],
      channels: [[1, 0, 0, 0, 0, 0, 0, 0]],
      bands: [
        { frequencyHz: 1000, gainDb: 6, q: 1, filterType: 'peaking', enabled: true },
        { frequencyHz: 2000, gainDb: 0, q: 0.707, filterType: 'lowPass', enabled: true },
      ],
    });

    expect(rendered).toMatchObject({
      artifact: 'iir-eq-reference',
      engine: 'iir-reference',
      orderContract: 'ui-band-order-biquad-cascade',
      sampleRate: 48000,
      activeBandCount: 2,
      residualVsBypass: {
        state: 'processed',
        comparedFrames: 8,
      },
      reasons: ['peq_basic_iir_reference_only', 'active_biquads_applied_in_ui_order'],
    });
    expect(rendered.bandReports.map((band) => band.state)).toEqual(['active', 'active']);
    expect(rendered.bandReports[0].coefficients?.b0).toBeGreaterThan(1);
    expect(rendered.bandReports[0].response.frequenciesHz).toEqual([100, 1000, 10000]);
    expect(rendered.bandReports[0].response.magnitudeDb[1]).toBeGreaterThan(rendered.bandReports[0].response.magnitudeDb[0]);
    expect(rendered.bandReports[1].response.magnitudeDb[2]).toBeLessThan(rendered.bandReports[1].response.magnitudeDb[0]);
    expect(rendered.residualVsBypass.maxAbs).toBeGreaterThan(0.5);
    expect(rendered.residualVsBypass.rms).toBeGreaterThan(0.1);
  });

  it('treats disabled and neutral gain PEQ bands as an exact bypass artifact', () => {
    const input = [[0.5, -0.5, 0.25, -0.25]];
    const rendered = renderUzumeIirEqReference({
      sampleRate: 44100,
      channels: input,
      bands: [
        { frequencyHz: 1000, gainDb: 6, q: 1, filterType: 'peaking', enabled: false },
        { frequencyHz: 4000, gainDb: 0, q: 1, filterType: 'peaking', enabled: true },
      ],
    });

    expect(rendered.output).toEqual(input);
    expect(rendered.activeBandCount).toBe(0);
    expect(rendered.bandReports.map((band) => band.state)).toEqual(['disabled', 'neutral-bypass']);
    expect(rendered.bandReports[0].reasons).toEqual(['eq_band_disabled']);
    expect(rendered.bandReports[1].reasons).toEqual(['eq_band_neutral_gain_bypassed']);
    expect(rendered.residualVsBypass).toEqual({
      state: 'exact-bypass',
      comparedFrames: 4,
      maxAbs: 0,
      rms: 0,
    });
    expect(rendered.reasons).toEqual(['peq_basic_iir_reference_only', 'no_active_biquads_identity_bypass']);
  });
});

describe('UZUME PCM reference helpers', () => {
  it('renders deterministic float64 reference output with limiter telemetry', () => {
    const rendered = renderUzumePcmReference({
      sampleRate: 48000,
      channels: [
        [0.25, 0.5, 1.2, -1.4],
        [0.1, -0.2, 0.3, -0.4],
      ],
      headroomDb: -3,
      materializedGainDb: 6,
      eqBands: [{ frequencyHz: 1000, gainDb: 0, q: 1, filterType: 'peaking', enabled: true }],
      channelBalance: {
        enabled: true,
        swapLeftRight: true,
        invertRight: true,
        monoMode: 'off',
        leftGainDb: 0,
        rightGainDb: 0,
        balance: 0,
      },
      safetyLimiterEnabled: true,
    });

    expect(rendered.channels).toHaveLength(2);
    expect(rendered.channels[0][0]).toBeCloseTo(0.141253754462, 9);
    expect(rendered.channels[1][2]).toBeCloseTo(-1, 9);
    expect(rendered.telemetry.input.peak).toBeCloseTo(1.4, 9);
    expect(rendered.telemetry.afterHeadroom.peak).toBeGreaterThan(1.9);
    expect(rendered.telemetry.limitedSamples).toBeGreaterThan(0);
    expect(rendered.telemetry.maxGainReductionDb).toBeLessThan(0);
    expect(rendered.telemetry.postLimiter.peak).toBeLessThanOrEqual(1);
    expect(rendered.telemetry.safetyMeter.state).toBe('limiting');
    expect(rendered.telemetry.safetyMeter.stages.map((stage) => stage.id)).toEqual([
      'input',
      'after-headroom',
      'after-eq-iir',
      'after-stereo-procedural-crossfeed',
      'after-convolution',
      'pre-limiter',
      'post-limiter',
    ]);
    expect(rendered.telemetry.safetyMeter.stageOfMaxTruePeak).toBe('after-headroom');
    expect(rendered.telemetry.limiter).toMatchObject({
      enabled: true,
      active: true,
      mode: 'sample-domain-safety-limiter',
      truePeakLookahead: false,
    });
    expect(rendered.telemetry.limiter.limitedFrames).toBeGreaterThan(0);
    expect(rendered.telemetry.headroom.currentDb).toBe(-3);
    expect(rendered.telemetry.headroom.recommendedDb).toBeLessThan(-3);
    expect(rendered.telemetry.headroom.missingDb).toBeGreaterThan(0);
    expect(['post_dsp_true_peak', 'limiter_reduction']).toContain(rendered.telemetry.headroom.reason);
  });

  it('attributes convolution peak expansion to after-convolution and recommends headroom', () => {
    const rendered = renderUzumePcmReference({
      sampleRate: 48000,
      channels: [[0.45, -0.45, 0.25, -0.25]],
      convolutionResponses: [[1.5, -0.75]],
      safetyLimiterEnabled: false,
    });

    const afterConvolution = rendered.telemetry.safetyMeter.stages.find((stage) => stage.id === 'after-convolution');
    expect(rendered.telemetry.afterConvolution.peak).toBeCloseTo(1.0125, 9);
    expect(afterConvolution?.peakExpansionDb).toBeGreaterThan(6);
    expect(rendered.telemetry.safetyMeter.stageOfMaxPeak).toBe('after-convolution');
    expect(rendered.telemetry.safetyMeter.stageOfMaxTruePeak).toBe('after-convolution');
    expect(rendered.telemetry.safetyMeter.state).toBe('over');
    expect(rendered.telemetry.headroom).toMatchObject({
      reason: 'profile_preflight_gain',
      sourceStage: 'pre-limiter',
      confidence: 'measured',
      autoHeadroomEnabled: false,
    });
    expect(rendered.telemetry.headroom.missingDb).toBeGreaterThan(1);
  });

  it('separates near-limit safety metering from disabled sample-domain limiter', () => {
    const rendered = renderUzumePcmReference({
      sampleRate: 48000,
      channels: [
        [0.95, -0.95],
        [0.9, -0.9],
      ],
      safetyLimiterEnabled: false,
    });

    expect(rendered.telemetry.safetyMeter.state).toBe('near-limit');
    expect(rendered.telemetry.safetyMeter.sampleClipCount).toBe(0);
    expect(rendered.telemetry.safetyMeter.truePeakOverCount).toBe(0);
    expect(rendered.telemetry.limitedSamples).toBe(0);
    expect(rendered.telemetry.limiter).toMatchObject({
      enabled: false,
      active: false,
      limitedFrames: 0,
      mode: 'sample-domain-safety-limiter',
      truePeakLookahead: false,
    });
    expect(rendered.telemetry.headroom).toMatchObject({
      currentDb: 0,
      recommendedDb: 0,
      missingDb: 0,
      reason: 'sufficient',
    });
  });

  it('applies channel-scoped operations without touching out-of-scope channels', () => {
    const rendered = renderUzumeChannelScopeReference({
      channels: [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
      operations: [
        {
          id: 'front-pair-trim',
          kind: 'gain',
          scope: { mode: 'stereo-pair', pairStart: 0 },
          gainDb: -6.020599913279624,
        },
        {
          id: 'center-invert',
          kind: 'invert',
          scope: { mode: 'channels', channels: [2] },
        },
      ],
    });

    expect(rendered).toMatchObject({
      artifact: 'channel-scope-reference',
      engine: 'stereo-procedural-reference',
      scopeContract: 'targeted-channels-only',
      output: [
        [0.5, 0.5],
        [1, 1],
        [-3, -3],
        [4, 4],
      ],
      untouchedChannelIndexes: [3],
      reasons: [
        'channel_scope_resolved_before_operation',
        'out_of_scope_channels_must_remain_exact_bypass',
      ],
    });
    expect(rendered.operationReports).toEqual([
      expect.objectContaining({
        id: 'front-pair-trim',
        targetChannels: [0, 1],
        skippedChannels: [2, 3],
        state: 'applied',
        reasons: ['operation_applied_to_target_channels_only'],
      }),
      expect.objectContaining({
        id: 'center-invert',
        targetChannels: [2],
        skippedChannels: [0, 1, 3],
        state: 'applied',
      }),
    ]);
    expect(rendered.residualByChannel).toEqual([
      expect.objectContaining({ channelIndex: 0, state: 'processed' }),
      expect.objectContaining({ channelIndex: 1, state: 'processed' }),
      expect.objectContaining({ channelIndex: 2, state: 'processed' }),
      { channelIndex: 3, state: 'out-of-scope-bypass', maxAbs: 0, rms: 0 },
    ]);
  });

  it('reports invalid channel scopes and mix sources as no-op reference decisions', () => {
    const input = [
      [0.25, -0.25],
      [0.5, -0.5],
    ];
    const rendered = renderUzumeChannelScopeReference({
      channels: input,
      operations: [
        {
          id: 'missing-surround',
          kind: 'mute',
          scope: { mode: 'channels', channels: [5] },
        },
        {
          id: 'invalid-mix-source',
          kind: 'mix-from',
          scope: { mode: 'channels', channels: [1] },
          sourceChannel: 9,
          mixGainDb: -3,
        },
      ],
    });

    expect(rendered.output).toEqual(input);
    expect(rendered.operationReports).toEqual([
      expect.objectContaining({
        id: 'missing-surround',
        targetChannels: [],
        skippedChannels: [0, 1],
        state: 'no-targets',
        reasons: ['channel_scope_resolved_no_targets'],
      }),
      expect.objectContaining({
        id: 'invalid-mix-source',
        targetChannels: [1],
        skippedChannels: [0],
        state: 'invalid-source',
        sourceChannel: 9,
        reasons: ['mix_source_channel_invalid'],
      }),
    ]);
    expect(rendered.residualByChannel).toEqual([
      { channelIndex: 0, state: 'out-of-scope-bypass', maxAbs: 0, rms: 0 },
      { channelIndex: 1, state: 'out-of-scope-bypass', maxAbs: 0, rms: 0 },
    ]);
    expect(rendered.untouchedChannelIndexes).toEqual([0, 1]);
  });

  it('splits PCM into callback-sized blocks and reassembles without boundary discontinuity', () => {
    const rendered = renderUzumeBlockBoundarySplitReference({
      blockFrames: 2,
      channels: [
        [1, 2, 3, 4, 5],
        [10, 20, 30, 40, 50],
      ],
    });

    expect(rendered).toMatchObject({
      artifact: 'block-boundary-split-reference',
      policy: 'valid-frames-committed-padding-never-output',
      blockFrames: 2,
      inputFrames: 5,
      channelCount: 2,
      reassembled: [
        [1, 2, 3, 4, 5],
        [10, 20, 30, 40, 50],
      ],
      coverage: {
        state: 'exact',
        coveredFrames: 5,
        missingFrames: 0,
        duplicateFrames: 0,
        committedFrames: 5,
        paddedFrames: 1,
      },
      residualVsInput: {
        state: 'exact-reassembly',
        comparedFrames: 5,
        maxAbs: 0,
        rms: 0,
      },
      reasons: [
        'block_boundaries_cover_each_source_frame_once',
        'final_block_zero_padding_not_committed',
        'reassembled_output_matches_source_without_boundary_discontinuity',
      ],
    });
    expect(rendered.blocks).toEqual([
      { blockIndex: 0, startFrame: 0, endFrame: 2, validFrames: 2, committedFrames: 2, paddedFrames: 0, state: 'full' },
      { blockIndex: 1, startFrame: 2, endFrame: 4, validFrames: 2, committedFrames: 2, paddedFrames: 0, state: 'full' },
      { blockIndex: 2, startFrame: 4, endFrame: 5, validFrames: 1, committedFrames: 1, paddedFrames: 1, state: 'partial-padded' },
    ]);
    expect(rendered.boundaries).toEqual([
      {
        beforeBlockIndex: 0,
        afterBlockIndex: 1,
        boundaryFrame: 2,
        sourceJumpMaxAbs: 10,
        reassembledJumpMaxAbs: 10,
        introducedDiscontinuityMaxAbs: 0,
      },
      {
        beforeBlockIndex: 1,
        afterBlockIndex: 2,
        boundaryFrame: 4,
        sourceJumpMaxAbs: 10,
        reassembledJumpMaxAbs: 10,
        introducedDiscontinuityMaxAbs: 0,
      },
    ]);
  });

  it('supports unpadded final block references while preserving exact frame coverage', () => {
    const rendered = renderUzumeBlockBoundarySplitReference({
      blockFrames: 4,
      padFinalBlock: false,
      channels: [[0.1, 0.2, 0.3]],
    });

    expect(rendered.blocks).toEqual([
      {
        blockIndex: 0,
        startFrame: 0,
        endFrame: 3,
        validFrames: 3,
        committedFrames: 3,
        paddedFrames: 0,
        state: 'partial-unpadded',
      },
    ]);
    expect(rendered.coverage).toEqual({
      state: 'exact',
      coveredFrames: 3,
      missingFrames: 0,
      duplicateFrames: 0,
      committedFrames: 3,
      paddedFrames: 0,
    });
    expect(rendered.boundaries).toEqual([]);
    expect(rendered.residualVsInput.maxAbs).toBe(0);
    expect(rendered.reasons).toEqual([
      'block_boundaries_cover_each_source_frame_once',
      'final_block_unpadded_reference',
      'reassembled_output_matches_source_without_boundary_discontinuity',
    ]);
  });

  it('commits FIR drain tail at natural EOF without incrementing generation', () => {
    const rendered = renderUzumeFlushDrainReference({
      generationId: 7,
      intent: 'natural-eof',
      channels: [[1, 0]],
      responses: [[1, 0.5, 0.25]],
    });

    expect(rendered).toMatchObject({
      artifact: 'flush-drain-reference',
      engine: 'direct-fir-float64-reference',
      intent: 'natural-eof',
      generationId: 7,
      candidateGenerationId: 7,
      generationAfter: 7,
      generationState: 'current',
      state: 'drain-committed',
      sourceFrames: 2,
      tailFrames: 2,
      drainFrames: 2,
      referenceOutput: [[1, 0.5, 0.25, 0]],
      committedOutput: [[1, 0.5, 0.25, 0]],
      pendingDrain: [[0.25, 0]],
      droppedDrain: [],
      resetRequired: false,
      drainCommitAllowed: true,
      residual: {
        sourceWindowMaxAbs: 0,
        sourceWindowRms: 0,
        drainMaxAbs: 0,
        drainRms: 0,
      },
      reasons: ['natural_eof_commits_drain_tail', 'drain_frames_match_filter_tail'],
    });
  });

  it('drops pending FIR drain tail and increments generation on manual flush', () => {
    const rendered = renderUzumeFlushDrainReference({
      generationId: 7,
      intent: 'manual-flush',
      channels: [[1, 0]],
      responses: [[1, 0.5, 0.25]],
    });

    expect(rendered).toMatchObject({
      intent: 'manual-flush',
      generationAfter: 8,
      generationState: 'current',
      state: 'tail-dropped-and-reset',
      sourceFrames: 2,
      tailFrames: 2,
      drainFrames: 0,
      referenceOutput: [[1, 0.5, 0.25, 0]],
      committedOutput: [[1, 0.5]],
      pendingDrain: [[0.25, 0]],
      droppedDrain: [[0.25, 0]],
      resetRequired: true,
      drainCommitAllowed: false,
      residual: {
        sourceWindowMaxAbs: 0,
        sourceWindowRms: 0,
        drainMaxAbs: 0,
        drainRms: 0,
      },
      reasons: ['transport_boundary_drops_pending_tail', 'generation_increment_required', 'render_state_reset_required'],
    });
  });

  it('applies trim, mute, solo, and matrix mix in stereo procedural order', () => {
    const rendered = renderUzumeStereoMatrixFilterReference({
      sampleRate: 48000,
      channels: [
        [1, -1],
        [0.25, 0.5],
      ],
      profile: {
        trimDb: { left: -6.020599913279624, right: 0 },
        mute: { right: true },
        matrix: [
          [0.5, 0.5],
          [1, -1],
        ],
      },
    });

    expect(rendered.telemetry.steps).toEqual(['trim', 'mute', 'matrix']);
    expect(rendered.telemetry.crossfeedEnabled).toBe(false);
    expect(rendered.channels[0]).toEqual([0.25, -0.25]);
    expect(rendered.channels[1]).toEqual([0.5, -0.5]);
  });

  it('applies L/R delay, invert, and swap before matrix/crossfeed stages', () => {
    const rendered = renderUzumeStereoMatrixFilterReference({
      sampleRate: 4000,
      channels: [
        [1, 2, 3, 4],
        [10, 20, 30, 40],
      ],
      profile: {
        delayMs: { left: 0.25 },
        invert: { right: true },
        swapLeftRight: true,
      },
    });

    expect(rendered.telemetry.steps).toEqual(['delay', 'invert', 'swap']);
    expect(rendered.telemetry.delaySamples).toEqual({ left: 1, right: 0 });
    expect(rendered.telemetry.invert).toEqual({ left: false, right: true });
    expect(rendered.telemetry.swapLeftRight).toBe(true);
    expect(rendered.channels[0]).toEqual([-10, -20, -30, -40]);
    expect(rendered.channels[1]).toEqual([0, 1, 2, 3]);
  });

  it('uses fractional L/R delay before mono fold-down', () => {
    const rendered = renderUzumeStereoMatrixFilterReference({
      sampleRate: 4000,
      channels: [
        [0, 1, 2, 3],
        [0, 0, 0, 0],
      ],
      profile: {
        delayMs: { left: 0.125 },
        monoMode: 'sum',
      },
    });

    expect(rendered.telemetry.steps).toEqual(['delay', 'mono']);
    expect(rendered.telemetry.delaySamples.left).toBeCloseTo(0.5, 12);
    expect(rendered.telemetry.monoMode).toBe('sum');
    expect(rendered.channels[0]).toEqual([0, 0.25, 0.75, 1.25]);
    expect(rendered.channels[1]).toEqual([0, 0.25, 0.75, 1.25]);
  });

  it('renders a deterministic 2x2 crossfeed matrix-filter with delay telemetry', () => {
    const rendered = renderUzumeStereoMatrixFilterReference({
      sampleRate: 48000,
      channels: [
        [1, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      profile: {
        matrix: [
          [1, 0],
          [0, 1],
        ],
        crossfeed: {
          enabled: true,
          crossGainDb: -6,
          crossDelayMs: 1,
          lowPassHz: 1200,
          centerPreservation: 'none',
        },
      },
    });

    expect(rendered.telemetry.steps).toEqual(['crossfeed']);
    expect(rendered.telemetry.crossDelaySamples).toBe(48);
    expect(rendered.telemetry.lowPassHz).toBe(1200);
    expect(rendered.channels[0][0]).toBeCloseTo(1, 9);
    expect(rendered.channels[1].slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('preserves mono center level while crossfeeding hard-panned stereo', () => {
    const mono = renderUzumeStereoMatrixFilterReference({
      sampleRate: 48000,
      channels: [
        [0.5, 0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5, 0.5],
      ],
      profile: {
        crossfeed: {
          enabled: true,
          crossGainDb: -6,
          crossDelayMs: 0,
          lowPassHz: 24000,
          centerPreservation: 'normalize',
        },
      },
    });
    const hardPan = renderUzumeStereoMatrixFilterReference({
      sampleRate: 48000,
      channels: [
        [1, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      profile: {
        crossfeed: {
          enabled: true,
          crossGainDb: -6,
          crossDelayMs: 0,
          lowPassHz: 24000,
          centerPreservation: 'normalize',
        },
      },
    });

    expect(mono.telemetry.centerPreservation).toBe('normalize');
    expect(mono.channels[0][3]).toBeCloseTo(mono.channels[1][3], 9);
    expect(mono.channels[0][3]).toBeCloseTo(0.5, 2);
    expect(hardPan.channels[1][0]).toBeGreaterThan(0);
    expect(hardPan.channels[1][0]).toBeLessThan(hardPan.channels[0][0]);
  });

  it('proves per-ear EQ placement around crossfeed is not freely reorderable', () => {
    const rendered = renderUzumePerEarEqPlacementReference({
      sampleRate: 48000,
      channels: [
        [1, 0.25, 0, -0.25],
        [0, 0.1, 0.2, 0.3],
      ],
      perEarEq: {
        leftGainDb: -6,
        rightGainDb: 6,
      },
      crossfeed: {
        enabled: true,
        crossGainDb: -9,
        crossDelayMs: 0,
        lowPassHz: 24000,
        centerPreservation: 'none',
      },
    });

    expect(rendered.artifact).toBe('per-ear-eq-placement-reference');
    expect(rendered.orderContract).toEqual(['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq']);
    expect(rendered.compilerRule).toBe('do-not-reorder-across-crossfeed-without-null-proof');
    expect(rendered.preCrossfeed.telemetry.steps).toEqual(['pre-per-ear-eq', 'crossfeed']);
    expect(rendered.postCrossfeed.telemetry.steps).toEqual(['crossfeed', 'post-per-ear-eq']);
    expect(rendered.placementResidual.state).toBe('placement-sensitive');
    expect(rendered.placementResidual.maxAbs).toBeGreaterThan(0.1);
    expect(rendered.preCrossfeed.channels[1][0]).not.toBeCloseTo(rendered.postCrossfeed.channels[1][0], 9);
  });

  it('reports commutative placement only when crossfeed and asymmetric per-ear EQ are inactive', () => {
    const rendered = renderUzumePerEarEqPlacementReference({
      sampleRate: 48000,
      channels: [
        [1, 0.5],
        [0.25, -0.25],
      ],
      perEarEq: {
        leftGainDb: 0,
        rightGainDb: 0,
      },
      crossfeed: {
        enabled: false,
      },
    });

    expect(rendered.placementResidual).toEqual({
      state: 'commutative-for-input',
      comparedFrames: 2,
      maxAbs: 0,
      rms: 0,
    });
  });

  it('keeps same-rate SRC as an exact sample-grid bypass', () => {
    const rendered = renderUzumeResamplingReference({
      sourceRate: 48000,
      targetRate: 48000,
      channels: [
        [0, 0.5, -0.25, 0.125],
        [1, -1, 0.25, -0.125],
      ],
    });

    expect(rendered.channels).toEqual([
      [0, 0.5, -0.25, 0.125],
      [1, -1, 0.25, -0.125],
    ]);
    expect(rendered.telemetry.sameRateBypass).toBe(true);
    expect(rendered.telemetry.phaseAccumulator).toBe('same-rate-bypass');
    expect(rendered.telemetry.filterContract.tapCount).toBe(0);
    expect(rendered.telemetry.groupDelaySamples).toBe(0);
    expect(rendered.telemetry.groupDelayMs).toBe(0);
    expect(rendered.telemetry.lookaheadMs).toBe(0);
  });

  it('renders deterministic windowed-sinc SRC with phase accumulator telemetry', () => {
    const rendered = renderUzumeResamplingReference({
      sourceRate: 44100,
      targetRate: 88200,
      channels: [[0, 1, 0, -1, 0, 0.5, 0]],
    });

    expect(rendered.channels[0]).toHaveLength(14);
    expect(rendered.telemetry.ratio).toBe(2);
    expect(rendered.telemetry.phaseStep).toBeCloseTo(0.5, 9);
    expect(rendered.telemetry.phaseAccumulator).toBe('rational-fixed-step');
    expect(rendered.telemetry.filterContract).toMatchObject({
      tapCount: 64,
      phaseCount: 1024,
      cutoffRatio: 0.92,
      stopbandAttenuationDb: 96,
    });
    expect(rendered.telemetry.groupDelaySamples).toBe(64);
    expect(rendered.telemetry.groupDelayMs).toBeCloseTo(0.726, 3);
    expect(rendered.telemetry.lookaheadSamples).toBe(64);
    expect(rendered.telemetry.lookaheadMs).toBeCloseTo(0.726, 3);
    expect(rendered.telemetry.output.peak).toBeGreaterThan(0.5);
  });

  it('reports SRC group delay and lookahead in both samples and milliseconds', () => {
    const rendered = renderUzumeResamplingReference({
      sourceRate: 48000,
      targetRate: 96000,
      tapCount: 96,
      channels: [[1, 0, -1, 0, 0.5, 0]],
    });

    expect(rendered.telemetry.groupDelaySamples).toBe(96);
    expect(rendered.telemetry.groupDelayMs).toBe(1);
    expect(rendered.telemetry.lookaheadSamples).toBe(96);
    expect(rendered.telemetry.lookaheadMs).toBe(1);
  });

  it('resamples FIR or IR responses with the high-precision windowed-sinc reference instead of linear interpolation', () => {
    const rendered = renderUzumeResponseResampleReference({
      sourceId: 'room-ir',
      kind: 'room-ir',
      sourceRate: 44100,
      targetRate: 48000,
      responses: [
        [0, 0.8, -0.2, 0.1, 0.05, -0.025, 0.0125],
        [0, 0.6, -0.1, 0.05, 0.025, -0.0125, 0.00625],
      ],
    });

    expect(rendered.artifact).toBe('high-precision-response-resample-reference');
    expect(rendered.engine).toBe('windowed-sinc-float64-reference');
    expect(rendered.sameRateBypass).toBe(false);
    expect(rendered.linearInterpolationRejected).toBe(true);
    expect(rendered.sourceFamily).toBe('44.1k-family');
    expect(rendered.targetFamily).toBe('48k-family');
    expect(rendered.filterContract.tapCount).toBe(64);
    expect(rendered.channels[0]).toHaveLength(8);
    expect(rendered.linearBaseline[0]).toHaveLength(8);
    expect(rendered.residualVsLinear.state).toBe('measured-difference');
    expect(rendered.residualVsLinear.maxAbs).toBeGreaterThan(0.01);
  });

  it('keeps same-rate response resampling as an exact bypass', () => {
    const rendered = renderUzumeResponseResampleReference({
      sourceId: 'headphone-fir',
      kind: 'headphone-fir-correction',
      sourceRate: 48000,
      targetRate: 48000,
      responses: [[1, -0.25, 0.125]],
    });

    expect(rendered.sameRateBypass).toBe(true);
    expect(rendered.linearInterpolationRejected).toBe(false);
    expect(rendered.channels).toEqual([[1, -0.25, 0.125]]);
    expect(rendered.residualVsLinear).toEqual({
      state: 'same-rate-bypass',
      comparedFrames: 3,
      maxAbs: 0,
      rms: 0,
    });
  });

  it('creates stable resampling reference artifacts', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(44100, 88200, 16);

    expect(artifacts.ratio).toBe(2);
    expect(artifacts.groupDelaySamples).toBe(64);
    expect(artifacts.groupDelayMs).toBeCloseTo(0.726, 3);
    expect(artifacts.lookaheadSamples).toBe(64);
    expect(artifacts.lookaheadMs).toBeCloseTo(0.726, 3);
    expect(artifacts.filterContract.tapCount).toBe(64);
    expect(artifacts.phaseAccumulator).toBe('rational-fixed-step');
    expect(artifacts.stimulus.impulse[8]).toBe(1);
    expect(artifacts.impulse).toHaveLength(32);
    expect(artifacts.sweep).toHaveLength(32);
    expect(artifacts.logSweep).toHaveLength(32);
    expect(artifacts.nearNyquist).toHaveLength(32);
    expect(artifacts.multiTone).toHaveLength(32);
    expect(artifacts.random).toHaveLength(32);
    expect(artifacts.silence).toHaveLength(32);
    expect(artifacts.phaseGroupDelay.peakIndex).toBeGreaterThanOrEqual(16);
    expect(artifacts.metrics.impulseEnergy).toBeGreaterThan(0);
    expect(artifacts.metrics.phaseGroupDelaySpreadSamples).toBeGreaterThan(0);
    expect(artifacts.metrics.logSweepPeak).toBeGreaterThan(0);
    expect(artifacts.metrics.multiTonePeak).toBeGreaterThan(0);
    expect(artifacts.metrics.randomPeak).toBeGreaterThan(0);
    expect(artifacts.metrics.randomSeed).toBe(0x5eed202);
    expect(artifacts.metrics.silencePeak).toBe(0);
    expect(artifacts.aliasRejectionDb).not.toBe(null);
    expect(artifacts.passbandRippleDb).not.toBe(null);
    expect(artifacts.stopbandAttenuationDb).not.toBe(null);
    expect(artifacts.cutoffRatioEstimate).not.toBe(null);
    expect(artifacts.realtimeBudget).toEqual({
      backend: 'scalar-float64-reference',
      estimatedMultiplyAdds: 2048,
      estimatedRealtimeFactor: null,
      safetyClass: 'offline-reference-only',
    });
    expect(artifacts.nullResidual).toEqual({
      state: 'not-applicable',
      comparedFrames: 0,
      maxAbs: null,
      rms: null,
    });
    expect(artifacts.metrics.realtimeBudget).toEqual(artifacts.realtimeBudget);
  });

  it('keeps the SRC silence artifact exact zero through sample-rate conversion', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(44100, 48000, 15);

    expect(artifacts.stimulus.silence.every((sample) => sample === 0)).toBe(true);
    expect(artifacts.response.silence).toEqual(artifacts.silence);
    expect(artifacts.silenceResidual).toEqual({
      state: 'exact-silence',
      comparedFrames: artifacts.silence.length,
      maxAbs: 0,
      rms: 0,
    });
    expect(artifacts.metrics.silenceResidual).toEqual(artifacts.silenceResidual);
  });

  it('generates a deterministic logarithmic sweep artifact separately from the linear sweep', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(48000, 96000, 32);

    expect(artifacts.stimulus.logSweep).toHaveLength(32);
    expect(artifacts.response.logSweep).toEqual(artifacts.logSweep);
    expect(artifacts.metrics.logSweepPeak).toBeGreaterThan(0.25);
    const sweepResidual = Math.max(...artifacts.stimulus.logSweep.map((sample, index) =>
      Math.abs(sample - (artifacts.stimulus.sweep[index] ?? 0))));
    expect(sweepResidual).toBeGreaterThan(0.1);
  });

  it('measures linear, minimum, and intermediate phase-mode differences', () => {
    const artifacts = createUzumeResamplingPhaseModeReferenceArtifacts(44100, 48000, 64);
    const byMode = Object.fromEntries(artifacts.modes.map((mode) => [mode.mode, mode]));

    expect(artifacts.phaseModesMeasured).toEqual(['linear', 'minimum', 'intermediate']);
    expect(byMode.linear.groupDelaySamples).toBeGreaterThan(byMode.intermediate.groupDelaySamples);
    expect(byMode.intermediate.groupDelaySamples).toBeGreaterThan(byMode.minimum.groupDelaySamples);
    expect(byMode.linear.residualVsLinearMaxAbs).toBe(0);
    expect(byMode.minimum.residualVsLinearMaxAbs).toBeGreaterThan(0.01);
    expect(byMode.intermediate.residualVsLinearRms).toBeGreaterThan(0.001);
  });

  it('measures apodizing as a ringing/response change, not bandwidth restoration copy', () => {
    const artifact = createUzumeResamplingApodizingReferenceArtifact(44100, 48000, 64);

    expect(artifact.artifact).toBe('poly-sinc-apodizing-response-reference');
    expect(artifact.state).toBe('apodizing-changes-ringing-response');
    expect(artifact.highFrequencyRestorationClaim).toBe(false);
    expect(artifact.responseResidualMaxAbs).toBeGreaterThan(0.001);
    expect(artifact.responseResidualRms).toBeGreaterThan(0.0001);
    expect(artifact.apodizedRingingEnergy).not.toBeCloseTo(artifact.baselineRingingEnergy, 8);
  });

  it('reports output double-resampling risk as a formal reference artifact', () => {
    const risk = planUzumeOutputResamplingRiskReference({
      sampleRatePlan: plan({
        requestedOutputSampleRate: 192000,
        actualDeviceSampleRate: 48000,
        sharedDeviceSampleRate: 48000,
        outputMode: 'shared',
        resampling: true,
      }),
      active: true,
      currentResamplerEngine: null,
    });

    expect(risk).toMatchObject({
      artifact: 'output-double-resampling-risk-reference',
      state: 'shared-output-mixer-risk',
      reason: 'shared_output_mixer_reference_only',
      requestedOutputRate: 192000,
      actualDeviceRate: 48000,
      sharedDeviceRate: 48000,
      signalPathTone: 'warning',
      recommendation: 'prefer-exclusive-or-device-rate-match',
    });
  });

  it('keeps SRC quality rollback inside the UZUME Poly-Sinc family', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(44100, 48000, 64);
    const rollback = planUzumeResamplingQualityRollbackReference(
      true,
      artifacts.filterContract,
      artifacts.realtimeBudget,
      1000,
    );
    const profileIds = [rollback.primaryProfile, ...rollback.rollbackChain].map((profile) => profile.id).join(' ');

    expect(rollback.state).toBe('armed');
    expect(rollback.reason).toBe('realtime-budget-warning');
    expect(rollback.familyLock).toBe('poly-sinc-reference-only');
    expect(rollback.legacyFallbackAllowed).toBe(false);
    expect(rollback.legacyFallbackSignalPath).toBe('UZUME bypass / legacy non-UZUME path');
    expect(rollback.shortBridgeIsRollback).toBe(false);
    expect([rollback.primaryProfile, ...rollback.rollbackChain].every((profile) => profile.family === 'poly-sinc-reference')).toBe(true);
    expect(profileIds).not.toMatch(/soxr|default|legacy|short-bridge/iu);
  });

  it('reports exact same-rate null residual and realtime bypass budget', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(48000, 48000, 12);

    expect(artifacts.phaseAccumulator).toBe('same-rate-bypass');
    expect(artifacts.filterContract.tapCount).toBe(0);
    expect(artifacts.nullResidual).toEqual({
      state: 'exact-bypass',
      comparedFrames: 12,
      maxAbs: 0,
      rms: 0,
    });
    expect(artifacts.realtimeBudget).toEqual({
      backend: 'scalar-float64-reference',
      estimatedMultiplyAdds: 12,
      estimatedRealtimeFactor: null,
      safetyClass: 'same-rate-bypass',
    });
    expect(artifacts.passbandRippleDb).toBe(0);
    expect(artifacts.stopbandAttenuationDb).toBe(0);
  });

  it('validates Poly-Sinc passband, stopband, transition, and budget artifacts against thresholds', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(44100, 88200, 64);
    const validation = validateUzumeResamplingReferenceArtifacts(artifacts);

    expect(validation.artifact).toBe('poly-sinc-formal-validation-reference');
    expect(validation.overall).toBe('pass');
    expect(validation.checks).toEqual([
      expect.objectContaining({ id: 'passband-ripple', state: 'pass' }),
      expect.objectContaining({ id: 'stopband-attenuation', state: 'pass' }),
      expect.objectContaining({ id: 'transition-width', state: 'pass' }),
      expect.objectContaining({ id: 'silence-preservation', state: 'pass', actual: 0 }),
      expect.objectContaining({ id: 'same-rate-null', state: 'not-applicable' }),
      expect.objectContaining({ id: 'realtime-budget', state: 'pass' }),
    ]);
    expect(validation.thresholds).toMatchObject({
      passbandRippleDbMax: 0.1,
      stopbandAttenuationDbMin: 36,
      transitionWidthRatioMax: 0.08,
      silenceMaxAbs: 1e-12,
      estimatedMultiplyAddsMax: 20000,
    });
  });

  it('validates same-rate bypass null residual as the formal null gate', () => {
    const artifacts = createUzumeResamplingReferenceArtifacts(48000, 48000, 12);
    const validation = validateUzumeResamplingReferenceArtifacts(artifacts);

    expect(validation.overall).toBe('pass');
    expect(validation.checks).toEqual([
      expect.objectContaining({ id: 'passband-ripple', state: 'pass' }),
      expect.objectContaining({ id: 'stopband-attenuation', state: 'not-applicable' }),
      expect.objectContaining({ id: 'transition-width', state: 'not-applicable' }),
      expect.objectContaining({ id: 'silence-preservation', state: 'pass', actual: 0 }),
      expect.objectContaining({ id: 'same-rate-null', state: 'pass', actual: 0 }),
      expect.objectContaining({ id: 'realtime-budget', state: 'pass' }),
    ]);
  });

  it('compares source PCM concat against reset-per-track gapless SRC rendering', () => {
    const rendered = renderUzumeGaplessConcatReference({
      sourceRate: 44100,
      targetRate: 88200,
      segments: [
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
      ],
    });

    expect(rendered.policy).toBe('source-pcm-concat-before-src');
    expect(rendered.noResetSegments).toHaveLength(2);
    expect(rendered.boundaries).toEqual([
      expect.objectContaining({
        beforeSegmentId: 'track-a',
        afterSegmentId: 'track-b',
        concatVsNoResetMaxAbs: 0,
      }),
    ]);
    expect(rendered.concatNullResidual).toEqual({
      state: 'concat-matches-no-reset',
      comparedFrames: rendered.concat.channels[0].length,
      maxAbs: 0,
      rms: 0,
    });
    expect(rendered.resetResidual.maxAbs).toBeGreaterThan(0);
    expect(rendered.boundaries[0].resetVsConcatMaxAbs).toBeGreaterThan(0);
  });

  it('uses cumulative output offsets for non-integer gapless SRC ratios', () => {
    const rendered = renderUzumeGaplessConcatReference({
      sourceRate: 44100,
      targetRate: 48000,
      segments: [
        { id: 'track-a', channels: [[0, 0.25, 0.5, 0.25, 0]] },
        { id: 'track-b', channels: [[0, -0.25, -0.5, -0.25, 0]] },
        { id: 'track-c', channels: [[0, 0.5, 0, -0.5, 0]] },
      ],
    });

    expect(rendered.concat.channels[0]).toHaveLength(16);
    expect(rendered.noResetSegments.map((segment) => segment[0].length)).toEqual([5, 6, 5]);
    expect(rendered.boundaries.map((boundary) => boundary.outputFrameOffset)).toEqual([5, 11]);
    expect(rendered.concatNullResidual).toMatchObject({
      comparedFrames: 16,
      maxAbs: 0,
      rms: 0,
    });
  });

  it('compares source PCM concat against reset-per-track FIR history', () => {
    const rendered = renderUzumeFirGaplessHistoryReference({
      sourceId: 'room-ir-direct-reference',
      sampleRate: 48000,
      responses: [[0.5, 0.25, -0.125, 0.0625]],
      segments: [
        {
          id: 'track-a',
          channels: [[0, 0.75, 0.5, -0.25]],
        },
        {
          id: 'track-b',
          channels: [[0.25, 0, -0.25, 0]],
        },
      ],
    });

    expect(rendered).toMatchObject({
      artifact: 'fir-gapless-history-reference',
      policy: 'source-pcm-concat-before-fir',
      engine: 'direct-fir-float64-reference',
      sourceId: 'room-ir-direct-reference',
      tailFrames: 3,
      drainFrames: 3,
    });
    expect(rendered.noResetSegments.map((segment) => segment[0].length)).toEqual([4, 7]);
    expect(rendered.concatNullResidual).toEqual({
      state: 'concat-matches-no-reset-history',
      comparedFrames: rendered.concat[0].length,
      maxAbs: 0,
      rms: 0,
    });
    expect(rendered.boundaries).toEqual([
      expect.objectContaining({
        beforeSegmentId: 'track-a',
        afterSegmentId: 'track-b',
        sourceFrameOffset: 4,
        outputFrameOffset: 4,
        overlapHistoryFrames: 3,
        concatVsNoResetMaxAbs: 0,
      }),
    ]);
    expect(rendered.resetResidual.maxAbs).toBeGreaterThan(0.01);
    expect(rendered.boundaries[0].resetVsConcatMaxAbs).toBeGreaterThan(0.01);
  });
});
