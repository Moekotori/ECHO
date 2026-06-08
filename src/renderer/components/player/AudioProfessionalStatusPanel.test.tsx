// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AudioStatus } from '../../../shared/types/audio';
import { I18nProvider } from '../../i18n/I18nProvider';
import { AudioProfessionalStatusPanel } from './AudioProfessionalStatusPanel';

const roomCorrectionStatus = (): AudioStatus => ({
  outputMode: 'exclusive',
  actualDeviceSampleRate: 48000,
  requestedOutputSampleRate: 48000,
  bitPerfectCandidate: false,
  bitPerfectDisabledReason: 'room_correction_enabled',
  roomCorrectionEnabled: true,
  dspActive: true,
  warnings: ['room_correction_bit_perfect_disabled', 'room_correction_clipping_risk'],
  state: 'playing',
} as unknown as AudioStatus);

const referenceStatus = (): AudioStatus => ({
  ...roomCorrectionStatus(),
  uzumeFormatPath: 'pcm_processed',
  dspClippingRisk: true,
  dspHeadroomDb: -6,
  uzumeHeadroomActive: true,
  uzumeGpuLimiterPlaybackActive: false,
  uzumeFormatPathPlan: {
    pcm_bitperfect: { state: 'disabled', reason: 'uzume_processing_enabled' },
    pcm_processed: { state: 'current', reason: null },
    dsd_direct: { state: 'unavailable', reason: 'requires_dsd_source' },
    dsd_upsampling: { state: 'unavailable', reason: 'requires_dsd_source' },
    d2p_processed: { state: 'unavailable', reason: 'd2p_requires_dsd_source' },
    sdm_processed: { state: 'unavailable', reason: 'sdm_reference_engine_not_ready' },
  },
  uzumeReferencePlan: {
    schemaVersion: 1,
    telemetrySchemaVersion: 2,
    formatPath: 'pcm_processed',
    sourceContainer: 'pcm',
    outputContainer: 'pcm',
    internalDomain: 'multibit-pcm',
    bitPerfectState: 'disabled',
    directDisabledReason: 'uzume_processing_enabled',
    backendSupport: {
      artifact: 'backend-support-reference',
      policy: 'reference-backend-only-no-runtime-switch',
      formatPath: 'pcm_processed',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      outputDevicePolicyState: 'shared-mixer-risk',
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
    },
    orderedProfileSections: ['format-path', 'headroom', 'materialized-gain', 'peq', 'stereo-procedural', 'shared-convolution', 'pcm-src', 'dither'],
    engineAssignments: [
      { sectionId: 'format-path', engineId: 'format-path-planner-reference', active: true, source: 'format-planner' },
      { sectionId: 'headroom', engineId: 'gain-reference', active: true, source: 'ui-section', mergeGroupId: 'gain-reference' },
      { sectionId: 'materialized-gain', engineId: 'gain-reference', active: false, source: 'ui-section', mergeGroupId: 'gain-reference' },
      { sectionId: 'peq', engineId: 'iir-reference', active: true, source: 'ui-section', mergeGroupId: 'iir-reference' },
      { sectionId: 'stereo-procedural', engineId: 'stereo-procedural-reference', active: false, source: 'ui-section', mergeGroupId: 'stereo-procedural-reference', splitReason: 'channel_balance_band_compensation_pending_reference' },
      { sectionId: 'shared-convolution', engineId: 'shared-convolution-planner-reference', active: true, source: 'ui-section', mergeGroupId: 'shared-convolution-reference', latencyOwner: 'room-ir-latency' },
      { sectionId: 'pcm-src', engineId: 'resampling-reference', active: true, source: 'ui-section', mergeGroupId: 'resampling-reference', splitReason: 'legacy_default_resampler_active_reference_only', latencyOwner: 'resampling-reference' },
      { sectionId: 'dither', engineId: 'dither-reference', active: false, source: 'format-planner', splitReason: 'output_bit_depth_contract_pending' },
    ],
    mergeGroups: [
      { id: 'gain-reference', engineId: 'gain-reference', sections: ['headroom', 'materialized-gain'], active: true, splitReason: null },
      { id: 'iir-reference', engineId: 'iir-reference', sections: ['peq'], active: true, splitReason: null },
      { id: 'stereo-procedural-reference', engineId: 'stereo-procedural-reference', sections: ['stereo-procedural'], active: false, splitReason: 'channel_balance_band_compensation_pending_reference' },
      { id: 'shared-convolution-reference', engineId: 'shared-convolution-planner-reference', sections: ['shared-convolution'], active: true, sampleRateFamily: '48k-family', splitReason: null },
      { id: 'resampling-reference', engineId: 'resampling-reference', sections: ['pcm-src'], active: true, sampleRateFamily: '48k-family', splitReason: 'legacy_default_resampler_active_reference_only' },
    ],
    splitReasons: {},
    latencyOwners: { 'shared-convolution': 'room-ir-latency', 'pcm-src': 'resampling-reference' },
    formatPathPlan: {
      pcm_bitperfect: { state: 'disabled', reason: 'uzume_processing_enabled' },
      pcm_processed: { state: 'current', reason: null },
      dsd_direct: { state: 'unavailable', reason: 'requires_dsd_source' },
      dsd_upsampling: { state: 'unavailable', reason: 'requires_dsd_source' },
      d2p_processed: { state: 'unavailable', reason: 'd2p_requires_dsd_source' },
      sdm_processed: { state: 'unavailable', reason: 'sdm_reference_engine_not_ready' },
    },
    outputDevicePolicy: {
      artifact: 'output-device-policy-reference',
      formatPath: 'pcm_processed',
      outputMode: 'shared',
      deviceCapability: 'shared-mixer',
      state: 'shared-mixer-risk',
      sourceContainer: 'pcm',
      outputContainer: 'pcm',
      fileRate: 44100,
      decoderOutputRate: 44100,
      requestedOutputRate: 48000,
      actualDeviceRate: 48000,
      sharedDeviceRate: 48000,
      bitPerfectCandidate: false,
      resampling: true,
      sampleRateMismatch: true,
      recommendation: 'prefer-exclusive-or-device-rate-match',
      reasons: ['shared_or_system_output_may_use_mixer_resampling', 'output_device_policy_reference_only'],
    },
    latencyBudget: {
      artifact: 'latency-budget-reference',
      policy: 'reference-budget-summary-no-runtime-scheduler',
      state: 'ready',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      outputDevicePolicyState: 'shared-mixer-risk',
      sourceRate: 44100,
      targetRate: 48000,
      srcGroupDelaySamples: 35,
      srcGroupDelayMs: 0.729,
      srcLookaheadSamples: 35,
      srcLookaheadMs: 0.729,
      convolutionLatencyClass: 'quality-first',
      convolutionLatencySamples: 1024,
      convolutionDirectHeadTaps: 128,
      convolutionWarmupFrames: 512,
      convolutionTailFrames: 2047,
      convolutionDrainFrames: 2047,
      callbackBlockFrames: 512,
      internalBlockFrames: 512,
      outputBlockFrames: 512,
      preRollRequiredFrames: 10240,
      deadlineSlackFrames: 13760,
      outputRingDepthFrames: 1024,
      callbackRingCapacityFrames: 4096,
      callbackRingDepthFrames: 2560,
      callbackRingDepthBlocks: 5,
      renderAheadState: 'cache-warming',
      renderAheadTargetFrames: 9600,
      renderAheadReadyFrames: 2400,
      cacheBudgetBytes: 384000,
      cacheBytesAfterEvict: 0,
      latencyOwners: { 'shared-convolution': 'room-ir-latency', 'pcm-src': 'resampling-reference' },
      callbackRule: 'read-committed-output-only',
      schedulerState: 'reference-only',
      reasons: [
        'latency_budget_summary_derived_from_reference_reports',
        'cpu_float64_reference_only_no_runtime_scheduler',
        'callback_reads_committed_output_only',
        'production_latency_compensation_deferred_to_realtime_gate',
      ],
    },
    readinessContract: {
      artifact: 'readiness-contract-reference',
      policy: 'main-playback-owns-timeline-uzume-reports-readiness',
      state: 'waiting-for-full-profile',
      intent: 'normal-playlist-boundary',
      playbackPolicy: 'predictive-cache',
      selectedPath: 'wait-for-full-profile',
      waitTarget: 'cpu-or-gpu-full-profile',
      fullProfileReady: false,
      gpuPrewarmReady: false,
      gpuPrewarmState: 'future-render-ahead-gate',
      cacheState: 'miss',
      cacheCommitState: 'callback-keeps-prior-committed-output',
      cacheKey: 'next-head:reference:0',
      renderAheadState: 'cache-warming',
      renderAheadReadyFrames: 2400,
      renderAheadTargetFrames: 9600,
      deadlineState: 'deadline-safe',
      deadlineSlackFrames: 13760,
      callbackRingState: 'stable',
      callbackRingTelemetryStatus: 'safe',
      shortBridgeCandidate: 'blocked',
      shortBridgeReason: 'intent_requires_full_quality_profile',
      crossfadeToFullProfile: 'blocked-by-intent',
      generationCommitRule: 'current-generation-only',
      staleGenerationCommitAllowed: false,
      handoffStrategy: 'same-pipeline-no-reset',
      productionScheduler: 'not-enabled',
      reasons: [
        'readiness_summary_derived_from_reference_reports',
        'main_playback_logic_owns_timeline_and_policy',
        'gpu_prewarm_deferred_to_render_ahead_gate',
        'stale_generation_commit_disallowed',
        'readiness_contract_reference_only',
      ],
    },
    generationCacheKey: {
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
      cacheKey: 'next-head:reference:0|generation:1|timeline:normal-next-track-head|album:none|profile:ui-ref|device:ui-ref',
      profileFingerprint: 'profile:ui-ref',
      profileComponents: ['format:pcm_processed', 'domain:multibit-pcm', 'sections:format-path+headroom+peq+shared-convolution+pcm-src', 'src:44.1k-family->48k-family', 'conv:48k-family:quality-first', 'backend:cpu-float64-reference'],
      deviceFingerprint: 'device:ui-ref',
      deviceComponents: ['mode:shared', 'capability:shared-mixer', 'requested:48000', 'actual:48000', 'shared:48000', 'output:pcm'],
      invalidatesOn: ['seek', 'manual-skip', 'profile-change', 'device-change', 'output-mode-change', 'sample-rate-plan-change'],
      preservesOn: ['pause', 'resume', 'mute', 'volume', 'declick'],
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
    },
    realtimeBudgetSummary: {
      artifact: 'realtime-budget-summary-reference',
      policy: 'reference-budget-no-measured-runtime-factor',
      state: 'offline-reference-only',
      selectedBackend: 'cpu-float64-reference',
      realtimeBackend: 'not-enabled',
      measuredRealtimeFactor: null,
      measuredRealtimeFactorState: 'not-measured-in-rpc002',
      srcBudgetBackend: 'scalar-float64-reference',
      srcEstimatedMultiplyAdds: 2048,
      srcEstimatedRealtimeFactor: null,
      srcSafetyClass: 'offline-reference-only',
      callbackRingDepthBlocks: 5,
      callbackRingTelemetryStatus: 'safe',
      renderAheadReadyFrames: 2400,
      renderAheadTargetFrames: 9600,
      renderAheadCoverageRatio: 0.25,
      cpuFullProfileFallback: 'reference-available',
      gpuRealtimeFactor: null,
      realtimeSafetyGate: 'rpc-003-cpu-realtime-gate',
      gpuRenderAheadGate: 'rpc-005-gpu-render-ahead-gate',
      thresholdSafeFactor: 2,
      thresholdMarginalFactor: 1.1,
      rendererControl: 'inspect-only',
      reasons: [
        'realtime_factor_not_measured_in_rpc002',
        'scalar_float64_budget_is_reference_only',
        'cpu_avx2_realtime_gate_deferred_to_rpc003',
        'gpu_render_ahead_realtime_gate_deferred_to_rpc005',
        'renderer_may_inspect_but_not_control_realtime_path',
      ],
    },
    resampling: {
      active: true,
      family: 'poly-sinc-reference',
      phaseMode: 'linear',
      apodizing: 'reference-windowed-sinc',
      sourceRate: 44100,
      targetRate: 48000,
      sourceFamily: '44.1k-family',
      targetFamily: '48k-family',
      ratio: 48000 / 44100,
      sameRateBypass: false,
      groupDelaySamples: 35,
      groupDelayMs: 0.729,
      lookaheadSamples: 35,
      lookaheadMs: 0.729,
      phaseAccumulator: 'rational-fixed-step',
      filterContract: {
        tapCount: 64,
        phaseCount: 1024,
        cutoffRatio: 0.92,
        transitionWidthRatio: 0.08,
        stopbandAttenuationDb: 96,
        passbandRippleDb: 0.01,
      },
      artifactMetrics: {
        impulsePeakIndex: 32,
        impulsePeak: 1,
        impulseEnergy: 1.5,
        sweepPeak: 0.9,
        logSweepPeak: 0.95,
        nearNyquistPeak: 0.1,
        silencePeak: 0,
        silenceResidual: {
          state: 'exact-silence',
          comparedFrames: 64,
          maxAbs: 0,
          rms: 0,
        },
        aliasRejectionDb: 18.5,
        passbandRippleDb: 0.01,
        stopbandAttenuationDb: 96,
        cutoffRatioEstimate: 0.92,
        transitionWidthRatioEstimate: 0.08,
        phaseGroupDelaySpreadSamples: 2.5,
        multiTonePeak: 0.75,
        randomPeak: 0.62,
        randomSeed: 99537410,
        realtimeBudget: {
          backend: 'scalar-float64-reference',
          estimatedMultiplyAdds: 2048,
          estimatedRealtimeFactor: null,
          safetyClass: 'offline-reference-only',
        },
        nullResidual: {
          state: 'not-applicable',
          comparedFrames: 64,
          maxAbs: null,
          rms: null,
        },
      },
      phaseModeArtifacts: {
        artifact: 'poly-sinc-phase-mode-reference',
        phaseModesMeasured: ['linear', 'minimum', 'intermediate'],
        modes: [
          { mode: 'linear', impulsePeakIndex: 32, groupDelaySamples: 32, groupDelaySpreadSamples: 2.5, preRingingEnergy: 0.2, postRingingEnergy: 0.2, residualVsLinearMaxAbs: 0, residualVsLinearRms: 0 },
          { mode: 'minimum', impulsePeakIndex: 8, groupDelaySamples: 8, groupDelaySpreadSamples: 1.1, preRingingEnergy: 0.01, postRingingEnergy: 0.35, residualVsLinearMaxAbs: 0.12, residualVsLinearRms: 0.03 },
          { mode: 'intermediate', impulsePeakIndex: 20, groupDelaySamples: 20, groupDelaySpreadSamples: 1.8, preRingingEnergy: 0.08, postRingingEnergy: 0.28, residualVsLinearMaxAbs: 0.06, residualVsLinearRms: 0.015 },
        ],
      },
      apodizingArtifact: {
        artifact: 'poly-sinc-apodizing-response-reference',
        mode: 'reference-windowed-sinc',
        baseline: 'rectangular-sinc-reference',
        state: 'apodizing-changes-ringing-response',
        highFrequencyRestorationClaim: false,
        apodizedRingingEnergy: 0.12,
        baselineRingingEnergy: 0.2,
        ringingReductionDb: 2.22,
        responseResidualMaxAbs: 0.04,
        responseResidualRms: 0.01,
      },
      validation: {
        artifact: 'poly-sinc-formal-validation-reference',
        overall: 'pass',
        checks: [
          { id: 'passband-ripple', state: 'pass', actual: 0.01, threshold: 0.1, reason: 'passband_ripple_threshold' },
          { id: 'stopband-attenuation', state: 'pass', actual: 96, threshold: 36, reason: 'stopband_attenuation_threshold' },
          { id: 'transition-width', state: 'pass', actual: 0.08, threshold: 0.08, reason: 'transition_width_threshold' },
          { id: 'silence-preservation', state: 'pass', actual: 0, threshold: 1e-12, reason: 'silence_must_remain_exact_zero' },
          { id: 'same-rate-null', state: 'not-applicable', actual: null, threshold: 1e-12, reason: 'sample_rate_conversion_null_not_applicable' },
          { id: 'realtime-budget', state: 'pass', actual: 2048, threshold: 20000, reason: 'scalar_float64_reference_budget_threshold' },
        ],
        thresholds: {
          passbandRippleDbMax: 0.1,
          stopbandAttenuationDbMin: 36,
          transitionWidthRatioMax: 0.08,
          silenceMaxAbs: 1e-12,
          sameRateNullMaxAbs: 1e-12,
          sameRateNullRmsMax: 1e-12,
          estimatedMultiplyAddsMax: 20000,
          requireMeasuredRealtimeFactor: false,
        },
      },
      realtimeSafetyClass: 'offline-reference-only',
      doubleResamplingRisk: 'legacy_default_resampler_active_reference_only',
      outputResamplingRisk: {
        artifact: 'output-double-resampling-risk-reference',
        state: 'legacy-resampler-active',
        reason: 'legacy_default_resampler_active_reference_only',
        requestedOutputRate: 48000,
        actualDeviceRate: 48000,
        sharedDeviceRate: null,
        currentResamplerEngine: 'default',
        signalPathTone: 'warning',
        recommendation: 'show-legacy-resampler-as-non-uzume-risk',
      },
      qualityRollback: {
        artifact: 'poly-sinc-quality-rollback-reference',
        state: 'armed',
        reason: 'realtime-budget-warning',
        primaryProfile: {
          id: 'poly-sinc-reference-linear-full',
          family: 'poly-sinc-reference',
          phaseMode: 'linear',
          apodizing: 'reference-windowed-sinc',
          tapCount: 64,
          stopbandAttenuationDb: 96,
          latencyClass: 'full',
          shortBridgeOnlyFor: null,
        },
        rollbackChain: [
          {
            id: 'poly-sinc-reference-linear-balanced',
            family: 'poly-sinc-reference',
            phaseMode: 'linear',
            apodizing: 'reference-windowed-sinc',
            tapCount: 48,
            stopbandAttenuationDb: 84,
            latencyClass: 'balanced',
            shortBridgeOnlyFor: null,
          },
          {
            id: 'poly-sinc-reference-linear-short',
            family: 'poly-sinc-reference',
            phaseMode: 'linear',
            apodizing: 'reference-windowed-sinc',
            tapCount: 32,
            stopbandAttenuationDb: 72,
            latencyClass: 'balanced',
            shortBridgeOnlyFor: null,
          },
        ],
        familyLock: 'poly-sinc-reference-only',
        legacyFallbackAllowed: false,
        legacyFallbackSignalPath: 'UZUME bypass / legacy non-UZUME path',
        shortBridgeIsRollback: false,
      },
    },
    sharedConvolution: {
      active: true,
      engine: 'shared-convolution-planner-reference',
      sources: [
        {
          id: 'room-ir',
          kind: 'room-ir',
          sampleRate: 48000,
          sampleRateFamily: '48k-family',
          channelLayout: 'stereo',
          channels: 2,
          tapCount: 2048,
          latencySamples: 1024,
          phasePolicy: 'linear',
          routing: 'per-channel',
        },
        {
          id: 'headphone-fir',
          kind: 'headphone-fir-correction',
          sampleRate: 44100,
          sampleRateFamily: '44.1k-family',
          channelLayout: 'stereo',
          channels: 2,
          tapCount: 512,
          latencySamples: 256,
          phasePolicy: 'linear',
          routing: 'per-channel',
        },
      ],
      mergedSourceIds: ['room-ir'],
      splitSourceIds: ['headphone-fir'],
      splitReasons: { 'headphone-fir': 'sample_rate_family_mismatch' },
      partitionPlan: {
        sampleRateFamily: '48k-family',
        exactSampleRate: 48000,
        channelLayout: 'stereo',
        latencyClass: 'quality-first',
        callbackBlockFrames: 512,
        internalBlockFrames: 512,
        outputBlockFrames: 512,
        directHeadTaps: 128,
        fftHeadSize: 1024,
        fftTailSizes: [1024, 1024, 2048],
        partitionHopSizes: [512, 512, 1024],
        partitionCount: 4,
        tailFrames: 2047,
        tailSeconds: 2047 / 48000,
        warmupFrames: 512,
        drainFrames: 2047,
        overlapStrategy: 'overlap-save-reference',
        cpuPlanId: 'cpu-sce-48k-family:48000:stereo:room-ir:512',
        gpuPlanId: 'gpu-sce-48k-family:48000:stereo:room-ir:512',
      },
      responseResampleReports: [
        {
          artifact: 'high-precision-response-resample-policy-reference',
          sourceId: 'room-ir',
          kind: 'room-ir',
          sourceRate: 48000,
          targetRate: 48000,
          sourceFamily: '48k-family',
          targetFamily: '48k-family',
          state: 'same-rate-bypass',
          engine: 'exact-bypass',
          sameRateBypass: true,
          linearInterpolationRejected: false,
          filterContract: null,
          reason: 'same_rate_exact_bypass',
        },
        {
          artifact: 'high-precision-response-resample-policy-reference',
          sourceId: 'headphone-fir',
          kind: 'headphone-fir-correction',
          sourceRate: 44100,
          targetRate: 48000,
          sourceFamily: '44.1k-family',
          targetFamily: '48k-family',
          state: 'windowed-sinc-reference-required',
          engine: 'windowed-sinc-float64-reference',
          sameRateBypass: false,
          linearInterpolationRejected: true,
          filterContract: {
            tapCount: 64,
            phaseCount: 1024,
            cutoffRatio: 0.92,
            transitionWidthRatio: 0.08,
            stopbandAttenuationDb: 96,
            passbandRippleDb: 0.01,
          },
          reason: 'cross_family_response_resample_uses_windowed_sinc_reference',
        },
      ],
      duplicatePlanGuard: {
        artifact: 'shared-convolution-duplicate-plan-guard-reference',
        engine: 'shared-convolution-planner-reference',
        state: 'single-shared-plan',
        sourceAssignments: [
          {
            sourceId: 'room-ir',
            state: 'shared-plan',
            convolverPlanId: 'cpu-sce-48k-family:48000:stereo:room-ir:512',
            fftPlanId: 'cpu-sce-48k-family:48000:stereo:room-ir:512:fft:1024',
            splitReason: null,
          },
          {
            sourceId: 'headphone-fir',
            state: 'split-required',
            convolverPlanId: null,
            fftPlanId: null,
            splitReason: 'sample_rate_family_mismatch',
          },
        ],
        planCounts: {
          mergedSourceCount: 1,
          splitSourceCount: 1,
          convolverPlanCount: 1,
          cpuFftPlanCount: 1,
          gpuFftPlanCount: 1,
          rejectedDuplicateConvolverCount: 0,
          rejectedDuplicateFftPlanCount: 0,
        },
        rejectedDuplicatePlans: [],
        reasons: ['compatible_sources_share_single_convolution_plan', 'duplicate_per_source_convolver_and_fft_plans_rejected'],
      },
      serialNullReference: {
        artifact: 'shared-convolution-serial-null-reference',
        engine: 'shared-convolution-planner-reference',
        state: 'split-or-inactive',
        sourceOrder: ['room-ir'],
        mergedResponseTapCounts: [],
        comparedFrames: 0,
        maxAbs: null,
        rms: null,
        reasons: ['serial_null_skipped_for_split_or_inactive_plan', 'serial_null_reference_only'],
      },
    },
    continuity: {
      artifact: 'continuity-telemetry-reference',
      policy: 'callback-read-committed-reference',
      continuity: {
        artifact: 'continuity-quality-policy-reference',
        intent: 'normal-playlist-boundary',
        policy: 'predictive-cache',
        selectedPath: 'wait-for-full-profile',
        callbackRule: 'read-committed-output-only',
        commitAllowed: false,
        shortBridgeAllowed: false,
        shortBridgeReason: 'intent_requires_full_quality_profile',
        qualityRollback: 'none',
        waitTarget: 'cpu-or-gpu-full-profile',
      },
      preRoll: {
        artifact: 'pre-roll-deadline-reference',
        state: 'deadline-safe',
        preRollRequiredFrames: 10240,
        framesUntilBoundary: 24000,
        deadlineSlackFrames: 13760,
        renderAheadState: 'cache-warming',
        renderAheadTargetFrames: 9600,
        renderAheadReadyFrames: 2400,
        callbackBlockFrames: 512,
        outputRingDepthFrames: 1024,
        readRule: 'read-committed-output-only',
        mustNotWaitForGpu: true,
        handoffStrategy: 'same-pipeline-no-reset',
        requiresDualPipeline: false,
        commitAllowed: false,
        shortBridgeAllowed: false,
      },
      callbackRing: {
        artifact: 'cpu-callback-ring-reference',
        state: 'stable',
        telemetryStatus: 'safe',
        capacityFrames: 4096,
        depthFrames: 2560,
        depthBlocks: 5,
        callbackBlockFrames: 512,
        missingFrames: 0,
        readRule: 'read-committed-output-only',
        mustNotWaitForGpu: true,
        shortBridgeAllowed: false,
        shortBridgeReason: 'cpu_only_ring_does_not_enable_short_bridge',
      },
      renderAheadCache: {
        artifact: 'render-ahead-cache-reference',
        lookupState: 'miss',
        commitState: 'callback-keeps-prior-committed-output',
        commitAllowed: false,
        callbackRule: 'read-committed-output-only',
        mustNotWaitForGpu: true,
        requestKey: 'next-head:reference:0',
        budgetBytes: 384000,
        bytesBeforeEvict: 0,
        bytesAfterEvict: 0,
        retainedKeys: [],
        evictionCount: 0,
      },
      fallback: {
        artifact: 'fallback-injection-underrun-reference',
        state: 'prior-committed-fallback',
        selectedSource: 'prior-committed',
        telemetryStatus: 'marginal',
        callbackMustNotWaitForGpu: true,
        shortBridgeAllowed: false,
        shortBridgeReason: 'underrun_protection_does_not_enable_short_bridge',
        qualityRollback: 'controlled-fallback',
        fallbackInjected: true,
        commitAllowed: true,
      },
    },
    pcmOutputQuantization: {
      artifact: 'pcm-output-quantization-dither-reference',
      formatPath: 'pcm_processed',
      outputSampleFormat: 'int32',
      state: 'quantized',
      bitPerfectState: 'disabled',
      pcmDitherAllowed: true,
      sdmNoiseShapingTelemetry: false,
      dither: {
        mode: 'tpdf',
        enabled: true,
        seed: 219668994,
        lsbAmplitude: 1 / 2147483647,
        peakDitherLsb: 0.875,
        noiseShaping: 'none',
      },
      quantization: {
        bitDepth: 32,
        maxInteger: 2147483647,
        clippedSamples: 0,
        residualMaxAbs: 2.4e-10,
        residualRms: 1.1e-10,
      },
      reasons: [
        'fixed_point_pcm_output_quantized',
        'pcm_dither_disables_bitperfect',
        'pcm_tpdf_or_plain_quantization_reference',
      ],
    },
    pcmIngressGuard: {
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
    },
    gainStaging: {
      artifact: 'gain-staging-reference',
      engine: 'gain-reference',
      orderContract: ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'],
      stages: [
        { id: 'input', gainDb: 0, cumulativeGainDb: 0, peak: 0.875, rms: 0.4, peakDbfs: -1.16, rmsDbfs: -7.96, clippingRisk: false },
        { id: 'headroom', gainDb: -6, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
        { id: 'replaygain', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
        { id: 'materialized-gain', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
        { id: 'output', gainDb: 0, cumulativeGainDb: -6, peak: 0.4385, rms: 0.2, peakDbfs: -7.16, rmsDbfs: -13.96, clippingRisk: false },
      ],
      totalGainDb: -6,
      totalGainLinear: 0.501187,
      recommendedAdditionalHeadroomDb: 0,
      clipRisk: false,
      reasons: [
        'headroom_applied_before_replaygain_and_materialized_gain',
        'gain_stages_merge_to_single_gain_reference',
        'gain_staging_within_sample_peak_budget',
      ],
    },
    iirEq: {
      artifact: 'iir-eq-reference',
      engine: 'iir-reference',
      orderContract: 'ui-band-order-biquad-cascade',
      state: 'active',
      sampleRate: 44100,
      bandCount: 1,
      activeBandCount: 1,
      bypassedBandCount: 0,
      bands: [
        {
          index: 0,
          filterType: 'peaking',
          frequencyHz: 1000,
          requestedFrequencyHz: 1000,
          q: 1,
          gainDb: 3,
          state: 'active',
          coefficientState: 'generated',
          responsePeakDb: 3,
          responseDipDb: 0,
          phaseSpanRadians: 0.25,
          reasons: ['biquad_coefficients_generated', 'frequency_response_measured'],
        },
      ],
      residual: {
        state: 'processed',
        comparedFrames: 8,
        maxAbs: 0.12,
        rms: 0.04,
      },
      reasons: ['peq_basic_iir_reference_only', 'active_biquads_applied_in_ui_order'],
    },
    channelScope: {
      artifact: 'channel-scope-reference',
      engine: 'stereo-procedural-reference',
      scopeContract: 'targeted-channels-only',
      channelCount: 2,
      operationCount: 1,
      appliedOperationCount: 1,
      noopOperationCount: 0,
      invalidOperationCount: 0,
      untouchedChannelIndexes: [1],
      operations: [
        {
          id: 'left-trim-scope',
          kind: 'gain',
          targetChannels: [0],
          skippedChannels: [1],
          state: 'applied',
          gainDb: -1,
          sourceChannel: null,
          reasons: ['operation_applied_to_target_channels_only'],
        },
      ],
      residualByChannel: [
        { channelIndex: 0, state: 'processed', maxAbs: 0.01, rms: 0.004 },
        { channelIndex: 1, state: 'out-of-scope-bypass', maxAbs: 0, rms: 0 },
      ],
      reasons: ['channel_scope_resolved_before_operation', 'out_of_scope_channels_must_remain_exact_bypass'],
    },
    stereoProcedural: {
      artifact: 'stereo-procedural-matrix-filter-reference',
      engine: 'stereo-procedural-reference',
      state: 'active',
      sampleRate: 44100,
      channelCount: 2,
      steps: ['trim', 'delay'],
      matrix: [[1, 0], [0, 1]],
      delaySamples: { left: 0, right: 44.1 },
      routing: {
        invertLeft: false,
        invertRight: false,
        swapLeftRight: false,
        monoMode: 'off',
      },
      crossfeed: {
        enabled: false,
        crossDelaySamples: 0,
        lowPassHz: null,
        centerPreservation: 'none',
      },
      input: { peak: 0.875, rms: 0.4 },
      output: { peak: 0.78, rms: 0.35 },
      residual: {
        state: 'processed',
        comparedFrames: 8,
        maxAbs: 0.1,
        rms: 0.03,
      },
      reasons: [
        'stereo_procedural_reference_only',
        'stereo_procedural_steps_applied_in_order',
        'band_compensation_requires_iir_reference_split',
      ],
    },
    perEarEqPlacement: {
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
      residual: {
        comparedFrames: 4,
        maxAbs: 0.188,
        rms: 0.052,
      },
      reasons: ['crossfeed_and_asymmetric_per_ear_eq_are_not_commutative', 'do_not_reorder_across_crossfeed_without_null_proof', 'per_ear_eq_placement_reference_only'],
    },
    blockBoundary: {
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
      reasons: [
        'block_boundaries_cover_each_source_frame_once',
        'final_block_zero_padding_not_committed',
        'reassembled_output_matches_source_without_boundary_discontinuity',
      ],
    },
    flushDrain: {
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
        residual: {
          sourceWindowMaxAbs: 0,
          sourceWindowRms: 0,
          drainMaxAbs: 0,
          drainRms: 0,
        },
        reasons: ['natural_eof_commits_drain_tail', 'drain_frames_match_filter_tail'],
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
        residual: {
          sourceWindowMaxAbs: 0,
          sourceWindowRms: 0,
          drainMaxAbs: 0,
          drainRms: 0,
        },
        reasons: ['transport_boundary_drops_pending_tail', 'generation_increment_required', 'render_state_reset_required'],
      },
    },
    gaplessConcat: {
      artifact: 'gapless-concat-reference',
      policy: 'source-pcm-concat-before-src',
      state: 'src-stateful',
      sourceRate: 44100,
      targetRate: 48000,
      ratio: 48000 / 44100,
      segmentCount: 2,
      boundaryCount: 1,
      concatNullResidual: {
        state: 'concat-matches-no-reset',
        comparedFrames: 18,
        maxAbs: 0,
        rms: 0,
      },
      resetResidual: {
        state: 'reset-vs-concat-reference',
        comparedFrames: 18,
        maxAbs: 0.125,
        rms: 0.03125,
      },
      boundaries: [
        { beforeSegmentId: 'track-a', afterSegmentId: 'track-b', sourceFrameOffset: 8, outputFrameOffset: 9, concatVsNoResetMaxAbs: 0, resetVsConcatMaxAbs: 0.125, resetVsConcatRms: 0.03125, outputJump: 0.25 },
      ],
      reasons: ['source_pcm_concat_before_src', 'src_state_must_not_reset_at_gapless_boundary', 'reset_per_track_src_compared_against_concat_reference', 'reference_artifact_generated_offline'],
    },
    firGaplessHistory: {
      artifact: 'fir-gapless-history-reference',
      policy: 'source-pcm-concat-before-fir',
      engine: 'direct-fir-float64-reference',
      state: 'history-required',
      sourceId: 'room-ir',
      sampleRate: 48000,
      segmentCount: 2,
      boundaryCount: 1,
      tailFrames: 3,
      drainFrames: 3,
      concatNullResidual: {
        state: 'concat-matches-no-reset-history',
        comparedFrames: 19,
        maxAbs: 0,
        rms: 0,
      },
      resetResidual: {
        state: 'reset-vs-concat-history-reference',
        comparedFrames: 19,
        maxAbs: 0.1875,
        rms: 0.046875,
      },
      boundaries: [
        { beforeSegmentId: 'track-a', afterSegmentId: 'track-b', sourceFrameOffset: 8, outputFrameOffset: 8, overlapHistoryFrames: 3, concatVsNoResetMaxAbs: 0, resetVsConcatMaxAbs: 0.1875, resetVsConcatRms: 0.046875, outputJump: 0.3125 },
      ],
      reasons: ['source_pcm_concat_before_fir', 'fir_history_must_cross_gapless_boundary', 'reset_per_track_fir_history_compared_against_concat_reference', 'fir_gapless_reference_only'],
    },
    callbackSafeControls: {
      artifact: 'callback-safe-urgent-controls-reference',
      policy: 'urgent-controls-after-committed-output',
      urgentControl: {
        control: 'mute',
        classification: 'callback-safe-urgent-control',
        generationState: 'current',
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
          maxStep: 1 / 3,
        },
        peak: {
          input: 0.875,
          output: 1 / 12,
        },
        reasons: ['callback_safe_urgent_control', 'render_cache_preserved', 'declick_gain_ramp', 'output_gain_zeroed'],
      },
      renderStateBoundary: {
        control: 'seek',
        classification: 'render-state-boundary',
        generationState: 'current',
        state: 'render-cache-invalidated',
        callbackRule: 'read-committed-output-only',
        renderCacheAction: 'invalidate-generation',
        generationAfterControl: 2,
        requiresRenderGraphRebuild: true,
        commitAllowed: false,
        gainEnvelopeFrames: 0,
        declick: {
          enabled: false,
          frames: 0,
          startGain: 0,
          endGain: 0,
          maxStep: 0,
        },
        peak: {
          input: 0.875,
          output: 0,
        },
        reasons: ['transport_boundary_requires_generation_increment', 'render_ahead_cache_invalidated', 'callback_keeps_prior_committed_output'],
      },
    },
    equalPowerCrossfade: {
      artifact: 'equal-power-crossfade-reference',
      policy: 'random-access-short-bridge-to-full-profile-only',
      rendered: {
        intent: 'user-random-seek-or-skip',
        sampleRate: 48000,
        fadeFrames: 5,
        durationMs: 5 / 48000 * 1000,
        state: 'crossfade-rendered',
        rejectionReason: null,
        gainLaw: {
          state: 'equal-power',
          maxPowerSumError: 0,
          midpointShortBridgeGain: Math.SQRT1_2,
          midpointFullProfileGain: Math.SQRT1_2,
        },
        residualVsHardSwitch: {
          state: 'measured-crossfade-difference',
          comparedFrames: 5,
          maxAbs: 0.20710678118654746,
          rms: 0.09578113585405947,
        },
        peak: {
          shortBridge: 1,
          fullProfile: 1,
          output: 1,
        },
        reasons: ['random_access_short_bridge_requires_equal_power_crossfade', 'full_profile_ready', 'equal_power_gain_law_reference', 'hard_switch_residual_measured'],
      },
      rejectedBoundary: {
        intent: 'gapless-boundary',
        sampleRate: 48000,
        fadeFrames: 5,
        durationMs: 5 / 48000 * 1000,
        state: 'rejected',
        rejectionReason: 'intent_not_user_random_seek_or_skip',
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
          shortBridge: 1,
          fullProfile: 1,
          output: 0,
        },
        reasons: ['only_user_random_seek_or_skip_can_use_short_bridge_crossfade', 'gapless_boundary_waits_for_full_profile', 'equal_power_crossfade_reference_only'],
      },
    },
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
      dsdFamilyPath: 'deterministic-reference',
      backendSupport: 'deterministic-reference',
      outputDevicePolicy: 'deterministic-reference',
      latencyBudget: 'deterministic-reference',
      readinessContract: 'deterministic-reference',
      generationCacheKey: 'deterministic-reference',
      realtimeBudgetSummary: 'deterministic-reference',
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
    dsdFamily: {
      artifact: 'dsd-family-path-control-reference',
      formatPath: 'd2p_processed',
      sourceContainer: 'dsd',
      outputContainer: 'pcm',
      internalDomain: 'multibit-pcm',
      state: 'd2p-reference',
      directDisabledReason: 'dsd_source_decoded_to_pcm',
      fallbackReason: null,
      experimental: false,
      pcmDomainDspAllowed: true,
      entersPcmDsp: true,
      pcmDitherAllowed: true,
      sdmNoiseShapingTelemetry: false,
      allowedControls: ['safety-metering', 'eq', 'fir', 'pcm-src', 'pcm-dither', 'pcm-limiter'],
      disabledControls: [],
      dsd: {
        sourceDsdRate: 2822400,
        targetDsdRate: 2822400,
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
        available: false,
        mode: 'none',
        modulatorProfile: null,
        targetDsdRate: null,
        headroomDb: null,
        overloadMarginDb: null,
        ultrasonicNoiseRisk: null,
        realtimeSafetyClass: 'offline-reference-only',
      },
      reasons: ['d2p_reports_decimation_profile_and_internal_pcm_rate'],
    },
  },
} as unknown as AudioStatus);

type ToneEntry = {
  label: string;
  value?: string;
  tone: string | null;
};

const referenceArtifactManifestText = 'artifact-manifest-reference / deterministic 38/38 / planned none / not-applicable none / source impulse+sweep+log-sweep+near-nyquist+multi-tone+random+silence+phase-group-delay+phase-mode+apodizing+alias-rejection+realtime-budget+null-residual+formal-validation / reports dsd-family-path+backend-support+output-device-policy+latency-budget+readiness-contract+generation-cache-key+realtime-budget-summary+quality-rollback+output-resampling-risk+pcm-output-quantization+pcm-ingress-guard+gain-staging+iir-eq+channel-scope+stereo-procedural+per-ear-eq-placement+shared-convolution-duplicate-guard+shared-convolution-serial-null+gapless-concat+fir-gapless-history+callback-safe-controls+equal-power-crossfade+block-boundary+flush-drain';

const readProfessionalVisualState = (): {
  badges: ToneEntry[];
  signal: ToneEntry[];
  rows: ToneEntry[];
} => {
  const panel = screen.getByLabelText('Professional Playback Status');
  const badges = Array.from(panel.querySelectorAll('.audio-professional-status__badges em')).map((node) => ({
    label: node.textContent ?? '',
    tone: node.getAttribute('data-tone'),
  }));
  const signal = Array.from(panel.querySelectorAll('.audio-professional-status__signal span')).map((node) => ({
    label: node.querySelector('em')?.textContent ?? '',
    value: node.querySelector('strong')?.textContent ?? '',
    tone: node.getAttribute('data-tone'),
  }));
  const rows = Array.from(panel.querySelectorAll('.audio-professional-status__grid span')).map((node) => ({
    label: node.querySelector('em')?.textContent ?? '',
    value: node.querySelector('strong')?.textContent ?? '',
    tone: node.getAttribute('data-tone'),
  }));

  return { badges, signal, rows };
};

beforeEach(() => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
});

afterEach(() => {
  cleanup();
});

describe('AudioProfessionalStatusPanel', () => {
  it('renders friendly Room Correction UZUME warnings', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={roomCorrectionStatus()} />
      </I18nProvider>,
    );

    expect(screen.getByText('UZUME skeleton')).toBeTruthy();
    expect(screen.getByText(/Room correction disables bit-perfect output/u)).toBeTruthy();
    expect(screen.getByText(/Room correction output has clipping risk/u)).toBeTruthy();
  });

  it('keeps RPC-002 reference rows muted when no compiled reference plan is present', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={roomCorrectionStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    const visualState = readProfessionalVisualState();
    const referenceRows = visualState.rows.filter((row) => row.label.toLowerCase().includes('reference'));

    expect(referenceRows.length).toBeGreaterThan(20);
    expect(referenceRows.filter((row) => row.tone !== 'muted')).toEqual([]);
    expect(referenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'UZUME reference compiler', tone: 'muted' }),
        expect.objectContaining({ label: 'UZUME artifact manifest reference', tone: 'muted' }),
        expect.objectContaining({ label: 'UZUME realtime budget summary reference', tone: 'muted' }),
        expect.objectContaining({ label: 'UZUME render-ahead cache reference', tone: 'muted' }),
      ]),
    );
  });

  it('renders UZUME reference compiler assignments in details', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(screen.getByText('UZUME reference compiler')).toBeTruthy();
    expect(screen.getByText(/schema v1 \/ telemetry v2 \/ multibit-pcm/u)).toBeTruthy();
    expect(screen.getByText(/format-path->format path planner ref \(active\)/u)).toBeTruthy();
    expect(screen.getByText(/materialized-gain->gain ref \(inactive, merge gain-reference\)/u)).toBeTruthy();
    expect(screen.getByText(/stereo-procedural->stereo procedural ref \(inactive, merge stereo-procedural-reference, split channel balance band compensation pending reference\)/u)).toBeTruthy();
    expect(screen.getByText(/shared-convolution-reference->shared convolution planner ref \(active, 48k-family, sections shared-convolution\)/u)).toBeTruthy();
    expect(screen.getAllByText(/pcm-src->resampling-reference/u).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(referenceArtifactManifestText)).toBeTruthy();
    expect(screen.getByText(/disabled \/ direct disabled uzume processing enabled \/ pcm->pcm \/ multibit-pcm \/ pcm_processed/u)).toBeTruthy();
    expect(screen.getByText(/backend-support-reference \/ reference-backend-only-no-runtime-switch \/ selected cpu-float64-reference \/ realtime not-enabled/u)).toBeTruthy();
    expect(screen.getByText(/output-device-policy-reference \/ pcm_processed \/ shared \/ shared-mixer \/ shared-mixer-risk \/ file 44.1 kHz \/ decoder 44.1 kHz \/ requested 48 kHz \/ actual 48 kHz \/ shared 48 kHz/u)).toBeTruthy();
    expect(screen.getByText(/latency-budget-reference \/ cpu-float64-reference \/ realtime not-enabled \/ src 35 samples\/0.73 ms lookahead 35 samples\/0.73 ms/u)).toBeTruthy();
    expect(screen.getByText(/conv quality-first latency 1024 frames direct-head 128 taps warmup 512 frames tail 2047 frames drain 2047 frames/u)).toBeTruthy();
    expect(screen.getByText(/readiness-contract-reference \/ main-playback-owns-timeline-uzume-reports-readiness \/ waiting-for-full-profile \/ normal-playlist-boundary->wait-for-full-profile/u)).toBeTruthy();
    expect(screen.getByText(/generation-cache-key-reference \/ generation-safe-cache-key-contract-reference \/ gen 1 \/ normal-next-track-head \/ next-track-head/u)).toBeTruthy();
    expect(screen.getByText(/realtime-budget-summary-reference \/ reference-budget-no-measured-runtime-factor \/ offline-reference-only \/ selected cpu-float64-reference \/ realtime not-enabled \/ measured not-measured-in-rpc002/u)).toBeTruthy();
    expect(screen.getByText(/poly-sinc-reference 44.1 kHz->48 kHz/u)).toBeTruthy();
    expect(screen.getByText(/35 samples \/ 0.73 ms/u)).toBeTruthy();
    expect(screen.getByText(/64 taps \/ cutoff 92% \/ alias 18.5 dB/u)).toBeTruthy();
    expect(screen.getByText(/armed \/ realtime budget warning \/ poly-sinc-reference-only \/ poly-sinc-reference-linear-full 64 taps 96 dB full -> poly-sinc-reference-linear-balanced 48 taps 84 dB balanced/u)).toBeTruthy();
    expect(screen.getByText(/legacy blocked UZUME bypass \/ legacy non-UZUME path \/ short bridge not rollback/u)).toBeTruthy();
    expect(screen.getByText(/scalar-float64-reference \/ 2048 multiply-adds \/ realtime factor unmeasured \/ offline-reference-only \/ null not-applicable/u)).toBeTruthy();
    expect(screen.getByText(/shared-convolution-planner-reference \/ room-ir \/ 48k-family \/ block 512->512 \/ tail 2047 \/ drain 2047/u)).toBeTruthy();
    expect(screen.getByText(/shared-convolution-duplicate-plan-guard-reference \/ shared-convolution-planner-reference \/ single-shared-plan \/ merged 1 \/ split 1 \/ convolver plans 1/u)).toBeTruthy();
    expect(screen.getByText(/shared-convolution-serial-null-reference \/ shared-convolution-planner-reference \/ split-or-inactive \/ order room-ir \/ merged taps none \/ frames 0 \/ residual n\/a/u)).toBeTruthy();
    expect(screen.getByText(/predictive-cache \/ normal-playlist-boundary->wait-for-full-profile \/ read-committed-output-only \/ wait cpu-or-gpu-full-profile/u)).toBeTruthy();
    expect(screen.getByText(/deadline-safe \/ required 10240 frames \/ slack 13760 frames \/ render-ahead cache-warming 2400\/9600/u)).toBeTruthy();
    expect(screen.getByText(/stable \/ safe \/ depth 2560 frames \/ 5.0 blocks \/ block 512 frames \/ missing 0 frames \/ read-committed-output-only \/ no GPU wait/u)).toBeTruthy();
    expect(screen.getByText(/miss->callback-keeps-prior-committed-output \/ key next-head:reference:0 \/ cache 0\/384000 bytes \/ retained none \/ evictions 0/u)).toBeTruthy();
    expect(screen.getByText(/prior-committed-fallback \/ source prior-committed \/ marginal \/ rollback controlled-fallback \/ fallback injected \/ no GPU wait/u)).toBeTruthy();
    expect(screen.getByText(/pcm-output-quantization-dither-reference \/ pcm_processed->int32 \/ quantized \/ bit-perfect disabled \/ pcm dither allowed \/ dither tpdf enabled \/ seed 219668994 \/ lsb 4.66e-10 \/ peak 0.8750 lsb/u)).toBeTruthy();
    expect(screen.getByText(/pcm-ingress-guard-reference \/ ok \/ expected 2 \/ channels 2 \/ frames 8 \/ rectangular \/ peak 0.8750 \/ non-finite 0 \/ denormal 0 \/ mismatch 0 \/ silence 1/u)).toBeTruthy();
    expect(screen.getByText(/gain-staging-reference \/ order input->headroom->replaygain->materialized-gain->output \/ total -6.00 dB \/ linear 0.5012 \/ clip safe \/ extra headroom 0.00 dB/u)).toBeTruthy();
    expect(screen.getByText(/iir-eq-reference \/ iir-reference \/ active \/ sample 44.1 kHz \/ bands 1\/1 active \/ bypassed 0/u)).toBeTruthy();
    expect(screen.getByText(/channel-scope-reference \/ stereo-procedural-reference \/ targeted-channels-only \/ channels 2 \/ ops 1 \/ applied 1 \/ noop 0 \/ invalid 0/u)).toBeTruthy();
    expect(screen.getByText(/stereo-procedural-matrix-filter-reference \/ stereo-procedural-reference \/ active \/ sample 44.1 kHz \/ channels 2 \/ steps trim->delay/u)).toBeTruthy();
    expect(screen.getByText(/per-ear-eq-placement-reference \/ do-not-reorder-across-crossfeed-without-null-proof \/ placement-sensitive/u)).toBeTruthy();
    expect(screen.getByText(/block-boundary-split-reference \/ valid-frames-committed-padding-never-output \/ block 6 \/ input 8 \/ channels 2 \/ blocks 2 \/ states full\+partial-padded/u)).toBeTruthy();
    expect(screen.getByText(/flush-drain-reference \/ direct-fir-float64-reference \/ generation 7\/current \/ natural-eof:drain-committed/u)).toBeTruthy();
    expect(screen.getByText(/gapless-concat-reference \/ source-pcm-concat-before-src \/ src-stateful \/ 44.1 kHz->48 kHz/u)).toBeTruthy();
    expect(screen.getByText(/fir-gapless-history-reference \/ source-pcm-concat-before-fir \/ direct-fir-float64-reference \/ history-required \/ room-ir/u)).toBeTruthy();
    expect(screen.getByText(/callback-safe-urgent-controls-reference \/ urgent-controls-after-committed-output \/ urgent:mute:applied/u)).toBeTruthy();
    expect(screen.getByText(/equal-power-crossfade-reference \/ random-access-short-bridge-to-full-profile-only \/ rendered:user-random-seek-or-skip:crossfade-rendered/u)).toBeTruthy();
  });

  it('analyzes visual tone state for the UZUME reference UI', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    let visualState = readProfessionalVisualState();
    expect(visualState.badges).toEqual(
      expect.arrayContaining([
        { label: 'UZUME skeleton', tone: 'warning' },
        { label: 'Device issue/warning', tone: 'warning' },
      ]),
    );
    expect(visualState.signal).toEqual([
      expect.objectContaining({ label: 'Source', tone: 'good' }),
      expect.objectContaining({ label: 'Decode', tone: 'good' }),
      expect.objectContaining({ label: 'UZUME', value: 'UZUME Path: Headroom -6.00 dB -> FIR', tone: 'warning' }),
      expect.objectContaining({ label: 'Output', tone: 'good' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    visualState = readProfessionalVisualState();
    expect(visualState.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Signal path', value: 'UZUME Path: Headroom -6.00 dB -> FIR', tone: 'warning' }),
        expect.objectContaining({ label: 'UZUME format path', value: 'PCM processed / UZUME skeleton', tone: 'warning' }),
        expect.objectContaining({ label: 'UZUME reference compiler', value: 'schema v1 / telemetry v2 / multibit-pcm', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME reference assignment', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME reference merge groups', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME reference latency owners', value: 'shared-convolution->room-ir-latency | pcm-src->resampling-reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME artifact manifest reference', value: referenceArtifactManifestText, tone: 'good' }),
        expect.objectContaining({ label: 'UZUME reference bit-perfect', value: 'disabled / direct disabled uzume processing enabled / pcm->pcm / multibit-pcm / pcm_processed', tone: 'warning' }),
        expect.objectContaining({
          label: 'UZUME backend support reference',
          value: 'backend-support-reference / reference-backend-only-no-runtime-switch / selected cpu-float64-reference / realtime not-enabled / cpu available deterministic-reference / avx future-production-gate rpc-003-cpu-realtime-gate / gpu future-render-ahead-gate rpc-005-gpu-render-ahead-gate / legacy non-uzume-fallback-only compiler blocked / output shared-mixer-risk / reasons cpu float64 reference selected for rpc002 | avx2 gpu runtime backends deferred beyond reference gate | legacy dsp chain not entered by uzume compiler | backend support reference only',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME output device policy reference',
          value: 'output-device-policy-reference / pcm_processed / shared / shared-mixer / shared-mixer-risk / file 44.1 kHz / decoder 44.1 kHz / requested 48 kHz / actual 48 kHz / shared 48 kHz / output pcm / bit-perfect candidate no / resampling yes / mismatch yes / recommend prefer-exclusive-or-device-rate-match / reasons shared or system output may use mixer resampling | output device policy reference only',
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME latency budget reference',
          value: 'latency-budget-reference / cpu-float64-reference / realtime not-enabled / src 35 samples/0.73 ms lookahead 35 samples/0.73 ms / conv quality-first latency 1024 frames direct-head 128 taps warmup 512 frames tail 2047 frames drain 2047 frames / blocks 512 frames->512 frames->512 frames / pre-roll 10240 frames slack 13760 frames / ring 2560 frames/4096 frames 5.0 blocks / render-ahead cache-warming 2400/9600 frames / cache 0/384000 bytes / owners shared-convolution->room-ir-latency | pcm-src->resampling-reference / read-committed-output-only / reference-only / reasons latency budget summary derived from reference reports | cpu float64 reference only no runtime scheduler | callback reads committed output only | production latency compensation deferred to realtime gate',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: 'readiness-contract-reference / main-playback-owns-timeline-uzume-reports-readiness / waiting-for-full-profile / normal-playlist-boundary->wait-for-full-profile / wait cpu-or-gpu-full-profile / full-profile not-ready / gpu-prewarm future-render-ahead-gate / cache miss->callback-keeps-prior-committed-output key next-head:reference:0 / render-ahead cache-warming 2400/9600 / deadline deadline-safe slack 13760 frames / ring stable/safe / short-bridge blocked intent requires full quality profile / crossfade blocked-by-intent / generation current-generation-only stale blocked / same-pipeline-no-reset / scheduler not-enabled / reasons readiness summary derived from reference reports | main playback logic owns timeline and policy | gpu prewarm deferred to render ahead gate | stale generation commit disallowed | readiness contract reference only',
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: 'generation-cache-key-reference / generation-safe-cache-key-contract-reference / gen 1 / normal-next-track-head / next-track-head / request next-head:reference:0 / cache next-head:reference:0|generation:1|timeline:normal-next-track-head|album:none|profile:ui-ref|device:ui-ref / profile:ui-ref / device:ui-ref / profile format:pcm_processed + domain:multibit-pcm + sections:format-path+headroom+peq+shared-convolution+pcm-src + src:44.1k-family->48k-family + conv:48k-family:quality-first + backend:cpu-float64-reference / device mode:shared + capability:shared-mixer + requested:48000 + actual:48000 + shared:48000 + output:pcm / album none index n/a / invalidate seek+manual-skip+profile-change+device-change+output-mode-change+sample-rate-plan-change / preserve pause+resume+mute+volume+declick / reject-stale-generation / late-current-generation-retain-for-future-only / stale-then-farthest-from-boundary / renderer inspect-only / reasons cache key includes generation profile device and timeline | album segments use segment index when gapless | file path alone is not a valid cache key | renderer may inspect but not mutate cache keys | generation cache key reference only',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME realtime budget summary reference',
          value: 'realtime-budget-summary-reference / reference-budget-no-measured-runtime-factor / offline-reference-only / selected cpu-float64-reference / realtime not-enabled / measured not-measured-in-rpc002 / src scalar-float64-reference 2048 multiply-adds factor unmeasured offline-reference-only / ring 5.0 blocks safe / render-ahead 2400/9600 25% / cpu reference-available / gpu factor unmeasured / thresholds safe 2.0x marginal 1.1x / rpc-003-cpu-realtime-gate / rpc-005-gpu-render-ahead-gate / renderer inspect-only / reasons realtime factor not measured in rpc002 | scalar float64 budget is reference only | cpu avx2 realtime gate deferred to rpc003 | gpu render ahead realtime gate deferred to rpc005 | renderer may inspect but not control realtime path',
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME PCM ingress guard reference',
          value: 'pcm-ingress-guard-reference / ok / expected 2 / channels 2 / frames 8 / rectangular / peak 0.8750 / non-finite 0 / denormal 0 / mismatch 0 / silence 1 / reasons pcm ingress ready for reference processing',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME gain staging reference',
          value: 'gain-staging-reference / order input->headroom->replaygain->materialized-gain->output / total -6.00 dB / linear 0.5012 / clip safe / extra headroom 0.00 dB / input:gain 0.00 dB/cum 0.00 dB/peak 0.8750 | headroom:gain -6.00 dB/cum -6.00 dB/peak 0.4385 | replaygain:gain 0.00 dB/cum -6.00 dB/peak 0.4385 | materialized-gain:gain 0.00 dB/cum -6.00 dB/peak 0.4385 | output:gain 0.00 dB/cum -6.00 dB/peak 0.4385 / reasons headroom applied before replaygain and materialized gain | gain stages merge to single gain reference | gain staging within sample peak budget',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME PEQ/IIR reference',
          value: 'iir-eq-reference / iir-reference / active / sample 44.1 kHz / bands 1/1 active / bypassed 0 / order ui-band-order-biquad-cascade / band0 peaking 1 kHz 3.00 dB q 1.00 active coeff generated resp 3.00/0.00 dB phase 0.2500 / residual processed 0.120000/0.040000 / reasons peq basic iir reference only | active biquads applied in ui order',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME channel scope reference',
          value: 'channel-scope-reference / stereo-procedural-reference / targeted-channels-only / channels 2 / ops 1 / applied 1 / noop 0 / invalid 0 / untouched 1 / left-trim-scope:applied->0 skip 1 gain -1.00 dB / ch0:processed 0.010000/0.004000 | ch1:out-of-scope-bypass 0.000000/0.000000 / reasons channel scope resolved before operation | out of scope channels must remain exact bypass',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME stereo procedural reference',
          value: 'stereo-procedural-matrix-filter-reference / stereo-procedural-reference / active / sample 44.1 kHz / channels 2 / steps trim->delay / delay 0.000/44.100 samples / matrix [1.000,0.000;0.000,1.000] / routing identity / crossfeed disabled / input peak 0.8750 output peak 0.7800 / residual processed 0.100000/0.030000 / reasons stereo procedural reference only | stereo procedural steps applied in order | band compensation requires iir reference split',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME per-ear EQ placement reference',
          value: 'per-ear-eq-placement-reference / do-not-reorder-across-crossfeed-without-null-proof / placement-sensitive / sample 44.1 kHz / order pre-crossfeed-eq->crossfeed-matrix-filter->post-crossfeed-eq / per-ear -6.00/6.00 dB / crossfeed -9.00 dB delay 0.000 ms lowpass 22050 center none / pre pre-per-ear-eq->crossfeed / post crossfeed->post-per-ear-eq / residual 4 frames 0.188000/0.052000 / reasons crossfeed and asymmetric per ear eq are not commutative | do not reorder across crossfeed without null proof | per ear eq placement reference only',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME block boundary reference',
          value: 'block-boundary-split-reference / valid-frames-committed-padding-never-output / block 6 / input 8 / channels 2 / blocks 2 / states full+partial-padded / coverage exact covered 8 missing 0 duplicate 0 committed 8 padded 4 / residual exact-reassembly 0.000000/0.000000 / boundaries 1 / introduced 0.000000 / reasons block boundaries cover each source frame once | final block zero padding not committed | reassembled output matches source without boundary discontinuity',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME flush/drain reference',
          value: 'flush-drain-reference / direct-fir-float64-reference / generation 7/current / natural-eof:drain-committed / gen 7 / tail 2 / drain 2 / no reset / drain committed / source residual 0.000000/0.000000 / drain residual 0.000000/0.000000 / reasons natural eof commits drain tail | drain frames match filter tail / manual-flush:tail-dropped-and-reset / gen 8 / tail 2 / drain 0 / reset required / drain blocked / source residual 0.000000/0.000000 / drain residual 0.000000/0.000000 / reasons transport boundary drops pending tail | generation increment required | render state reset required',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME gapless SRC reference',
          value: 'gapless-concat-reference / source-pcm-concat-before-src / src-stateful / 44.1 kHz->48 kHz / ratio 1.088435 / segments 2 / boundaries 1 / concat concat-matches-no-reset 0.000000/0.000000 / reset reset-vs-concat-reference 0.125000/0.031250 / boundary track-a->track-b out 9 reset 0.125000 jump 0.250000 / reasons source pcm concat before src | src state must not reset at gapless boundary | reset per track src compared against concat reference | reference artifact generated offline',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME FIR gapless reference',
          value: 'fir-gapless-history-reference / source-pcm-concat-before-fir / direct-fir-float64-reference / history-required / room-ir / sample 48 kHz / segments 2 / boundaries 1 / tail 3 / drain 3 / concat concat-matches-no-reset-history 0.000000/0.000000 / reset reset-vs-concat-history-reference 0.187500/0.046875 / boundary track-a->track-b out 8 overlap 3 reset 0.187500 jump 0.312500 / reasons source pcm concat before fir | fir history must cross gapless boundary | reset per track fir history compared against concat reference | fir gapless reference only',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME urgent controls reference',
          value: 'callback-safe-urgent-controls-reference / urgent-controls-after-committed-output / urgent:mute:applied / callback-safe-urgent-control / read-committed-output-then-apply-urgent-control / cache preserve / gen 1 / no rebuild / commit allowed / declick enabled 4 frames 1.000->0.000 step 0.333333 / envelope 8 / peak 0.875000->0.083333 / reasons callback safe urgent control | render cache preserved | declick gain ramp | output gain zeroed / boundary:seek:render-cache-invalidated / render-state-boundary / read-committed-output-only / cache invalidate-generation / gen 2 / rebuild required / commit blocked / declick off 0 frames 0.000->0.000 step 0.000000 / envelope 0 / peak 0.875000->0.000000 / reasons transport boundary requires generation increment | render ahead cache invalidated | callback keeps prior committed output',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME equal-power crossfade reference',
          value: 'equal-power-crossfade-reference / random-access-short-bridge-to-full-profile-only / rendered:user-random-seek-or-skip:crossfade-rendered / accepted / sample 48 kHz / fade 5 frames/0.104 ms / gain equal-power / mid 0.707107/0.707107 / power error 0.000000 / residual measured-crossfade-difference 0.207107/0.095781 / peak 1.000000/1.000000/1.000000 / reasons random access short bridge requires equal power crossfade | full profile ready | equal power gain law reference | hard switch residual measured / rejected-boundary:gapless-boundary:rejected / reject intent not user random seek or skip / sample 48 kHz / fade 5 frames/0.104 ms / gain not-applicable / mid n/a / power error 0.000000 / residual not-applicable / peak 1.000000/1.000000/0.000000 / reasons only user random seek or skip can use short bridge crossfade | gapless boundary waits for full profile | equal power crossfade reference only',
          tone: 'good',
        }),
        expect.objectContaining({ label: 'UZUME SRC reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME SRC rollback reference', tone: 'warning' }),
        expect.objectContaining({ label: 'UZUME SRC budget reference', tone: 'warning' }),
        expect.objectContaining({
          label: 'UZUME SRC artifact reference',
          value: 'passband 0.01 dB / stopband 96.00 dB / cutoff 0.9200 / transition 0.0800 / phase spread 2.5000 samples / silence exact-silence max 0.000000 / multi-tone peak 0.7500 / seeded-random peak 0.6200 / random seed 99537410',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC validation reference',
          value: 'poly-sinc-formal-validation-reference / overall pass / passband-ripple:pass / stopband-attenuation:pass / transition-width:pass / silence-preservation:pass / same-rate-null:not-applicable / realtime-budget:pass',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC output risk reference',
          value: 'output-double-resampling-risk-reference / legacy-resampler-active / legacy default resampler active reference only / requested 48 kHz / actual 48 kHz / current default / tone warning / recommend show legacy resampler as non uzume risk',
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME SRC phase/apodizing reference',
          value: 'poly-sinc-phase-mode-reference / modes linear+minimum+intermediate / linear gd 32.00 spread 2.50 residual 0.0000/0.0000 | minimum gd 8.00 spread 1.10 residual 0.1200/0.0300 | intermediate gd 20.00 spread 1.80 residual 0.0600/0.0150 / poly-sinc-apodizing-response-reference / apodizing-changes-ringing-response / reference-windowed-sinc vs rectangular-sinc-reference / ringing reduction 2.22 dB / response residual 0.0400/0.0100 / no hf restoration claim',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME DSD family reference',
          value: 'dsd-family-path-control-reference / d2p_processed:d2p-reference / dsd->pcm / multibit-pcm / direct disabled dsd source decoded to pcm / allowed safety-metering+eq+fir+pcm-src+pcm-dither+pcm-limiter / disabled none / pcm dsp allowed / pcm dither allowed / sdm noise none / d2p dsd64-to-176k4-reference-low-pass @ 176400 Hz / sdm unavailable / reasons d2p reports decimation profile and internal pcm rate',
          tone: 'good',
        }),
        expect.objectContaining({ label: 'UZUME convolution reference', tone: 'good' }),
        expect.objectContaining({
          label: 'UZUME response resample reference',
          value: 'room-ir:same-rate-bypass / 48 kHz->48 kHz / 48k-family->48k-family / exact-bypass / linear interpolation not used / same rate exact bypass | headphone-fir:windowed-sinc-reference-required / 44.1 kHz->48 kHz / 44.1k-family->48k-family / windowed-sinc-float64-reference / linear interpolation rejected / 64 taps/0.9200 cutoff/96 dB / cross family response resample uses windowed sinc reference',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME convolution duplicate guard',
          value: 'shared-convolution-duplicate-plan-guard-reference / shared-convolution-planner-reference / single-shared-plan / merged 1 / split 1 / convolver plans 1 / cpu fft 1 / gpu fft 1 / rejected conv 0 / rejected fft 0 / room-ir:shared-plan conv cpu-sce-48k-family:48000:stereo:room-ir:512 fft cpu-sce-48k-family:48000:stereo:room-ir:512:fft:1024 | headphone-fir:split-required split sample rate family mismatch / rejected none / reasons compatible sources share single convolution plan | duplicate per source convolver and fft plans rejected',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME convolution serial null reference',
          value: 'shared-convolution-serial-null-reference / shared-convolution-planner-reference / split-or-inactive / order room-ir / merged taps none / frames 0 / residual n/a / reasons serial null skipped for split or inactive plan | serial null reference only',
          tone: 'muted',
        }),
        expect.objectContaining({
          label: 'UZUME PCM output quantization reference',
          value: 'pcm-output-quantization-dither-reference / pcm_processed->int32 / quantized / bit-perfect disabled / pcm dither allowed / dither tpdf enabled / seed 219668994 / lsb 4.66e-10 / peak 0.8750 lsb / noise none / 32 bit / max 2147483647 / clips 0 / residual 2.40e-10/1.10e-10 / sdm noise none / reasons fixed point pcm output quantized | pcm dither disables bitperfect | pcm tpdf or plain quantization reference',
          tone: 'good',
        }),
        expect.objectContaining({ label: 'UZUME continuity reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME pre-roll reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME callback ring reference', value: 'stable / safe / depth 2560 frames / 5.0 blocks / block 512 frames / missing 0 frames / read-committed-output-only / no GPU wait', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME render-ahead cache reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME underrun fallback reference', tone: 'good' }),
        expect.objectContaining({ label: 'UZUME headroom', value: '-6.00 dB / gain-reference / Enabled', tone: 'warning' }),
        expect.objectContaining({ label: 'UZUME safety meter', value: 'near-limit / clipping risk / stage telemetry separate from limiter', tone: 'warning' }),
        expect.objectContaining({ label: 'UZUME limiter reference', value: 'sample-domain safety limiter / standby / GPU limiter Planned / not implemented', tone: 'warning' }),
        expect.objectContaining({ label: 'Sample-rate mismatch', value: 'No', tone: 'good' }),
      ]),
    );
    expect(visualState.rows.filter((row) => row.tone === 'danger')).toEqual([]);
  });

  it('marks expected flush/drain reference contract as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME flush/drain reference',
          value: expect.stringContaining('natural-eof:drain-committed'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME flush/drain reference',
          value: expect.stringContaining('manual-flush:tail-dropped-and-reset'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected gapless reference contracts as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME gapless SRC reference',
          value: expect.stringContaining('concat concat-matches-no-reset 0.000000/0.000000'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME FIR gapless reference',
          value: expect.stringContaining('concat concat-matches-no-reset-history 0.000000/0.000000'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected callback-safe controls and crossfade reference contracts as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME urgent controls reference',
          value: expect.stringContaining('urgent:mute:applied'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME urgent controls reference',
          value: expect.stringContaining('boundary:seek:render-cache-invalidated'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME equal-power crossfade reference',
          value: expect.stringContaining('rendered:user-random-seek-or-skip:crossfade-rendered'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME equal-power crossfade reference',
          value: expect.stringContaining('rejected-boundary:gapless-boundary:rejected'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected continuity and cache reference contracts as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME continuity reference',
          value: expect.stringContaining('predictive-cache / normal-playlist-boundary->wait-for-full-profile'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME pre-roll reference',
          value: expect.stringContaining('deadline-safe / required 10240 frames / slack 13760 frames'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME callback ring reference',
          value: expect.stringContaining('read-committed-output-only / no GPU wait'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME render-ahead cache reference',
          value: expect.stringContaining('miss->callback-keeps-prior-committed-output'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME underrun fallback reference',
          value: expect.stringContaining('prior-committed-fallback / source prior-committed / marginal'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected compiler assignment references as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME reference compiler',
          value: 'schema v1 / telemetry v2 / multibit-pcm',
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME reference assignment',
          value: expect.stringContaining('shared-convolution->shared convolution planner ref (active, merge shared-convolution-reference, latency room-ir-latency)'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME reference merge groups',
          value: expect.stringContaining('resampling-reference->resampling ref (active, 48k-family, sections pcm-src, split legacy default resampler active reference only)'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME reference latency owners',
          value: 'shared-convolution->room-ir-latency | pcm-src->resampling-reference',
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected backend support reference contract as good', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME backend support reference',
          value: expect.stringContaining('reference-backend-only-no-runtime-switch'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME backend support reference',
          value: expect.stringContaining('legacy non-uzume-fallback-only compiler blocked'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    const driftedBackend = driftedStatus.uzumeReferencePlan!.backendSupport as unknown as {
      legacy: { allowedInCompiler: boolean };
    };
    driftedBackend.legacy.allowedInCompiler = true;

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME backend support reference',
          value: expect.stringContaining('compiler allowed'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks latency budget runtime drift as warning', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME latency budget reference',
          value: expect.stringContaining('realtime not-enabled'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    const driftedLatencyBudget = driftedStatus.uzumeReferencePlan!.latencyBudget as unknown as {
      realtimeBackend: string;
      schedulerState: string;
      reasons: string[];
    };
    driftedLatencyBudget.realtimeBackend = 'production-enabled';
    driftedLatencyBudget.schedulerState = 'production-scheduler';
    driftedLatencyBudget.reasons = driftedLatencyBudget.reasons.filter(
      (reason) => reason !== 'cpu_float64_reference_only_no_runtime_scheduler',
    );

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME latency budget reference',
          value: expect.stringContaining('realtime production-enabled'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME latency budget reference',
          value: expect.stringContaining('production-scheduler'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks expected DSP reference contracts as good', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME gain staging reference',
          value: expect.stringContaining('clip safe'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME PEQ/IIR reference',
          value: expect.stringContaining('active biquads applied in ui order'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME channel scope reference',
          value: expect.stringContaining('ch1:out-of-scope-bypass 0.000000/0.000000'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME stereo procedural reference',
          value: expect.stringContaining('stereo procedural steps applied in order'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME per-ear EQ placement reference',
          value: expect.stringContaining('do not reorder across crossfeed without null proof'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const invalidScopeStatus = referenceStatus();
    invalidScopeStatus.uzumeReferencePlan!.channelScope.invalidOperationCount = 1;

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={invalidScopeStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME channel scope reference',
          value: expect.stringContaining('invalid 1'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks expected shared convolution duplicate guard reference contract as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME convolution duplicate guard',
          value: expect.stringContaining('single-shared-plan / merged 1 / split 1 / convolver plans 1'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME convolution duplicate guard',
          value: expect.stringContaining('headphone-fir:split-required split sample rate family mismatch'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected shared convolution planner reference contract as good', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME convolution reference',
          value: expect.stringContaining('shared-convolution-planner-reference / room-ir / 48k-family / block 512->512 / tail 2047 / drain 2047'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME convolution reference',
          value: expect.stringContaining('split headphone-fir:sample rate family mismatch'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    driftedStatus.uzumeReferencePlan!.sharedConvolution.splitReasons = {};

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME convolution reference',
          value: expect.not.stringContaining('split headphone-fir:sample rate family mismatch'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks expected response resample reference contract as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME response resample reference',
          value: expect.stringContaining('room-ir:same-rate-bypass'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME response resample reference',
          value: expect.stringContaining('headphone-fir:windowed-sinc-reference-required'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected PCM output quantization reference contract as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME PCM output quantization reference',
          value: expect.stringContaining('quantized / bit-perfect disabled / pcm dither allowed / dither tpdf enabled'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME PCM output quantization reference',
          value: expect.stringContaining('clips 0 / residual 2.40e-10/1.10e-10'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks expected SRC artifact and phase/apodizing reference contracts as good', () => {
    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={referenceStatus()} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME SRC artifact reference',
          value: expect.stringContaining('silence exact-silence max 0.000000'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC artifact reference',
          value: expect.stringContaining('seeded-random peak 0.6200 / random seed 99537410'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC phase/apodizing reference',
          value: expect.stringContaining('modes linear+minimum+intermediate'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC phase/apodizing reference',
          value: expect.stringContaining('no hf restoration claim'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC budget reference',
          value: expect.stringContaining('offline-reference-only'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks expected core SRC reference contract as good', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME SRC reference',
          value: expect.stringContaining('poly-sinc-reference 44.1 kHz->48 kHz / linear / 35 samples / 0.73 ms'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    driftedStatus.uzumeReferencePlan!.resampling.phaseAccumulator = 'unavailable';

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME SRC reference',
          value: expect.stringContaining('poly-sinc-reference 44.1 kHz->48 kHz'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks expected D2P DSD family reference contract as good', () => {
    const status = referenceStatus();

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME DSD family reference',
          value: expect.stringContaining('d2p dsd64-to-176k4-reference-low-pass @ 176400 Hz'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    driftedStatus.uzumeReferencePlan!.dsdFamily!.fallbackReason = 'd2p_reference_engine_not_ready';
    driftedStatus.uzumeReferencePlan!.dsdFamily!.d2p.available = false;

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME DSD family reference',
          value: expect.stringContaining('fallback d2p reference engine not ready'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks same-rate bypass SRC budget reference state as good', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.realtimeBudgetSummary.state = 'same-rate-bypass-reference';
    plan.realtimeBudgetSummary.srcEstimatedMultiplyAdds = 8;
    plan.realtimeBudgetSummary.srcSafetyClass = 'same-rate-bypass';
    plan.resampling.active = false;
    plan.resampling.sourceRate = 48000;
    plan.resampling.targetRate = 48000;
    plan.resampling.sourceFamily = '48k-family';
    plan.resampling.targetFamily = '48k-family';
    plan.resampling.ratio = 1;
    plan.resampling.sameRateBypass = true;
    plan.resampling.groupDelaySamples = 0;
    plan.resampling.groupDelayMs = 0;
    plan.resampling.lookaheadSamples = 0;
    plan.resampling.lookaheadMs = 0;
    plan.resampling.phaseAccumulator = 'same-rate-bypass';
    plan.resampling.realtimeSafetyClass = 'same-rate-bypass';
    plan.resampling.artifactMetrics.realtimeBudget.estimatedMultiplyAdds = 8;
    plan.resampling.artifactMetrics.realtimeBudget.safetyClass = 'same-rate-bypass';
    plan.resampling.artifactMetrics.nullResidual = {
      state: 'exact-bypass',
      comparedFrames: 8,
      maxAbs: 0,
      rms: 0,
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    const visualState = readProfessionalVisualState();
    expect(visualState.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME realtime budget summary reference',
          value: expect.stringContaining('same-rate-bypass-reference'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME SRC budget reference',
          value: expect.stringContaining('scalar-float64-reference / 8 multiply-adds / realtime factor unmeasured / same-rate-bypass / null exact-bypass max 0.000000 rms 0.000000'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks PCM bit-perfect reference bypass state as good', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.formatPath = 'pcm_bitperfect';
    plan.internalDomain = 'pcm-bypass';
    plan.bitPerfectState = 'available';
    plan.directDisabledReason = null;
    plan.formatPathPlan.pcm_bitperfect = { state: 'current', reason: null };
    plan.formatPathPlan.pcm_processed = { state: 'available', reason: null };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME reference bit-perfect',
          value: 'available / direct path available / pcm->pcm / pcm-bypass / pcm_bitperfect',
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks merged shared-convolution serial-null reference state as good', () => {
    const status = referenceStatus();
    const sharedConvolution = status.uzumeReferencePlan!.sharedConvolution;
    sharedConvolution.serialNullReference = {
      ...sharedConvolution.serialNullReference!,
      state: 'merged-matches-serial',
      sourceOrder: ['fir-eq', 'headphone-fir', 'room-ir'],
      mergedResponseTapCounts: [3, 4, 5],
      comparedFrames: 128,
      maxAbs: 0,
      rms: 0,
      reasons: ['merged_response_matches_serial_direct_fir_reference', 'serial_null_reference_only'],
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME convolution serial null reference',
          value: 'shared-convolution-serial-null-reference / shared-convolution-planner-reference / merged-matches-serial / order fir-eq->headphone-fir->room-ir / merged taps 3+4+5 / frames 128 / residual 0.000000/0.000000 / reasons merged response matches serial direct fir reference | serial null reference only',
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks direct-like output policy and ready reference contract as good', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.outputDevicePolicy = {
      ...plan.outputDevicePolicy,
      outputMode: 'exclusive',
      deviceCapability: 'direct-like-rate-match',
      state: 'direct-like-ready',
      fileRate: 48000,
      decoderOutputRate: 48000,
      requestedOutputRate: 48000,
      actualDeviceRate: 48000,
      sharedDeviceRate: null,
      bitPerfectCandidate: true,
      resampling: false,
      sampleRateMismatch: false,
      recommendation: 'none',
      reasons: ['direct_like_output_rate_matches_requested_reference', 'output_policy_reference_only'],
    };
    plan.backendSupport.outputDevicePolicyState = 'direct-like-ready';
    plan.latencyBudget.outputDevicePolicyState = 'direct-like-ready';
    plan.readinessContract = {
      ...plan.readinessContract,
      state: 'ready-to-commit',
      selectedPath: 'cpu-full-profile',
      waitTarget: 'none',
      fullProfileReady: true,
      cacheState: 'hit',
      cacheCommitState: 'commit-to-callback-slot',
      renderAheadState: 'full-profile-ready',
      renderAheadReadyFrames: 9600,
      renderAheadTargetFrames: 9600,
      deadlineState: 'ready',
      deadlineSlackFrames: 24000,
      shortBridgeReason: 'full_profile_ready',
      reasons: [
        'readiness_summary_derived_from_reference_reports',
        'main_playback_logic_owns_timeline_and_policy',
        'gpu_prewarm_deferred_to_render_ahead_gate',
        'stale_generation_commit_disallowed',
        'readiness_contract_reference_only',
        'cpu_full_profile_ready',
      ],
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME output device policy reference',
          value: expect.stringContaining('direct-like-ready'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('ready-to-commit'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('scheduler not-enabled'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks readiness contract production scheduler drift as warning', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.readinessContract = {
      ...plan.readinessContract,
      state: 'ready-to-commit',
      selectedPath: 'cpu-full-profile',
      waitTarget: 'none',
      fullProfileReady: true,
      cacheState: 'hit',
      cacheCommitState: 'commit-to-callback-slot',
      renderAheadState: 'full-profile-ready',
      renderAheadReadyFrames: 9600,
      renderAheadTargetFrames: 9600,
      deadlineState: 'ready',
      deadlineSlackFrames: 24000,
      shortBridgeReason: 'full_profile_ready',
      reasons: [
        'readiness_summary_derived_from_reference_reports',
        'main_playback_logic_owns_timeline_and_policy',
        'gpu_prewarm_deferred_to_render_ahead_gate',
        'stale_generation_commit_disallowed',
        'readiness_contract_reference_only',
      ],
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('scheduler not-enabled'),
          tone: 'good',
        }),
      ]),
    );

    cleanup();

    const driftedStatus = referenceStatus();
    const driftedReadiness = driftedStatus.uzumeReferencePlan!.readinessContract as unknown as {
      state: string;
      selectedPath: string;
      waitTarget: string;
      fullProfileReady: boolean;
      cacheState: string;
      cacheCommitState: string;
      renderAheadState: string;
      renderAheadReadyFrames: number;
      renderAheadTargetFrames: number;
      deadlineState: string;
      deadlineSlackFrames: number;
      shortBridgeReason: string;
      productionScheduler: string;
      reasons: string[];
    };
    driftedReadiness.state = 'ready-to-commit';
    driftedReadiness.selectedPath = 'cpu-full-profile';
    driftedReadiness.waitTarget = 'none';
    driftedReadiness.fullProfileReady = true;
    driftedReadiness.cacheState = 'hit';
    driftedReadiness.cacheCommitState = 'commit-to-callback-slot';
    driftedReadiness.renderAheadState = 'full-profile-ready';
    driftedReadiness.renderAheadReadyFrames = 9600;
    driftedReadiness.renderAheadTargetFrames = 9600;
    driftedReadiness.deadlineState = 'ready';
    driftedReadiness.deadlineSlackFrames = 24000;
    driftedReadiness.shortBridgeReason = 'full_profile_ready';
    driftedReadiness.productionScheduler = 'production-enabled';
    driftedReadiness.reasons = driftedReadiness.reasons.filter(
      (reason) => reason !== 'main_playback_logic_owns_timeline_and_policy',
    );

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={driftedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('ready-to-commit'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('scheduler production-enabled'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks direct-like output device mismatch as warning without enabling scheduler', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.outputDevicePolicy = {
      ...plan.outputDevicePolicy,
      outputMode: 'exclusive',
      deviceCapability: 'direct-like-rate-mismatch',
      state: 'device-rate-mismatch-risk',
      fileRate: 44100,
      decoderOutputRate: 44100,
      requestedOutputRate: 96000,
      actualDeviceRate: 48000,
      sharedDeviceRate: null,
      bitPerfectCandidate: false,
      resampling: false,
      sampleRateMismatch: true,
      recommendation: 'inspect-device-rate-mismatch',
      reasons: ['actual_device_rate_differs_from_requested_output_rate', 'output_device_policy_reference_only'],
    };
    plan.backendSupport.outputDevicePolicyState = 'device-rate-mismatch-risk';
    plan.latencyBudget.outputDevicePolicyState = 'device-rate-mismatch-risk';

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME output device policy reference',
          value: expect.stringContaining('exclusive / direct-like-rate-mismatch / device-rate-mismatch-risk'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME output device policy reference',
          value: expect.stringContaining('requested 96 kHz / actual 48 kHz'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME output device policy reference',
          value: expect.stringContaining('recommend inspect-device-rate-mismatch'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME readiness contract reference',
          value: expect.stringContaining('scheduler not-enabled'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks gapless album-segment generation cache keys as inspect-only good', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.generationCacheKey = {
      ...plan.generationCacheKey,
      timelineScope: 'gapless-album-segment',
      trackRole: 'gapless-segment',
      requestKey: 'gapless:next-reference:0',
      cacheKey: 'gapless:next-reference:0|generation:1|timeline:gapless-album-segment|album:album-reference:segment-0:index-1|profile:ui-ref|device:ui-ref',
      albumSegmentKey: 'album-reference:segment-0:index-1',
      albumSegmentIndex: 1,
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: expect.stringContaining('gapless-album-segment / gapless-segment / request gapless:next-reference:0'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: expect.stringContaining('album album-reference:segment-0:index-1 index 1'),
          tone: 'good',
        }),
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: expect.stringContaining('renderer inspect-only'),
          tone: 'good',
        }),
      ]),
    );
  });

  it('marks generation cache key writer drift as warning', () => {
    const status = referenceStatus();
    const driftedCacheKey = status.uzumeReferencePlan!.generationCacheKey as unknown as {
      staleCommitRule: string;
      rendererControl: string;
      reasons: string[];
    };
    driftedCacheKey.staleCommitRule = 'allow-stale-generation';
    driftedCacheKey.rendererControl = 'production-cache-writer';
    driftedCacheKey.reasons = driftedCacheKey.reasons.filter(
      (reason) => reason !== 'renderer_may_inspect_but_not_mutate_cache_keys',
    );

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: expect.stringContaining('allow-stale-generation'),
          tone: 'warning',
        }),
        expect.objectContaining({
          label: 'UZUME generation cache key reference',
          value: expect.stringContaining('renderer production-cache-writer'),
          tone: 'warning',
        }),
      ]),
    );
  });

  it('marks DSD direct positive bypass reference state as good', () => {
    const status = referenceStatus();
    const plan = status.uzumeReferencePlan!;
    plan.formatPath = 'dsd_direct';
    plan.sourceContainer = 'dsd';
    plan.outputContainer = 'dop';
    plan.internalDomain = 'dsd-direct';
    plan.formatPathPlan.dsd_direct = { state: 'current', reason: null };
    plan.formatPathPlan.d2p_processed = { state: 'available', reason: null };
    plan.dsdFamily = {
      ...plan.dsdFamily!,
      formatPath: 'dsd_direct',
      outputContainer: 'dop',
      internalDomain: 'dsd-direct',
      state: 'direct',
      directDisabledReason: null,
      pcmDomainDspAllowed: false,
      entersPcmDsp: false,
      pcmDitherAllowed: false,
      allowedControls: ['safety-metering'],
      disabledControls: [],
      dsd: {
        sourceDsdRate: 2822400,
        targetDsdRate: 2822400,
        outputEncoding: 'dop-dsd64',
      },
      d2p: {
        active: false,
        available: false,
        decimationProfile: null,
        internalPcmRate: null,
      },
      reasons: ['dsd_direct_bypasses_pcm_dsp_src_limiter_dither'],
    };

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={status} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    expect(readProfessionalVisualState().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'UZUME DSD family reference',
          value: 'dsd-family-path-control-reference / dsd_direct:direct / dsd->dop / dsd-direct / direct allowed / allowed safety-metering / disabled none / pcm dsp blocked / pcm dither blocked / sdm noise none / output dop-dsd64 / d2p unavailable / sdm unavailable / reasons dsd direct bypasses pcm dsp src limiter dither',
          tone: 'good',
        }),
      ]),
    );
  });

  it('keeps not-applicable artifact manifest entries non-blocking while planned entries warn', () => {
    const notApplicableStatus = referenceStatus();
    notApplicableStatus.uzumeReferencePlan!.artifactPlan.dsdFamilyPath = 'not-applicable';

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={notApplicableStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    let manifestRow = readProfessionalVisualState().rows.find((row) => row.label === 'UZUME artifact manifest reference');
    expect(manifestRow).toEqual(expect.objectContaining({
      value: expect.stringContaining('deterministic 37/38 / planned none / not-applicable dsd-family-path'),
      tone: 'good',
    }));

    cleanup();

    const plannedStatus = referenceStatus();
    plannedStatus.uzumeReferencePlan!.artifactPlan.aliasRejection = 'planned';
    plannedStatus.uzumeReferencePlan!.artifactPlan.dsdFamilyPath = 'not-applicable';

    render(
      <I18nProvider>
        <AudioProfessionalStatusPanel status={plannedStatus} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show professional details/iu }));

    manifestRow = readProfessionalVisualState().rows.find((row) => row.label === 'UZUME artifact manifest reference');
    expect(manifestRow).toEqual(expect.objectContaining({
      value: expect.stringContaining('deterministic 36/38 / planned alias-rejection / not-applicable dsd-family-path'),
      tone: 'warning',
    }));
  });
});
