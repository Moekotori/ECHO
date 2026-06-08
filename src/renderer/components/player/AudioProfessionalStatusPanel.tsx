import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge, RadioTower, SlidersHorizontal, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import { formatAudioChannelLayout } from '../../../shared/utils/audioChannels';
import { useI18n } from '../../i18n/I18nProvider';
import { buildUzumeReferenceArtifactManifestSummary } from './uzumeReferenceArtifactManifest';

type AudioProfessionalStatusPanelProps = {
  status: AudioStatus | null;
  variant?: 'drawer' | 'settings';
};

type ProfessionalStatusRow = {
  label: string;
  value: string;
  tone?: 'good' | 'warning' | 'danger' | 'muted';
};

type ProfessionalStatusSection = {
  title: string;
  icon: LucideIcon;
  rows: ProfessionalStatusRow[];
};

type ProfessionalStatusBadge = {
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'neutral';
};

type SignalPathNode = {
  eyebrow: string;
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'muted';
};

const trimTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

const normalizeReason = (value: string | null | undefined, fallback: string): string =>
  value ? value.replaceAll('_', ' ') : fallback;

const formatBitPerfectReason = (value: string | null | undefined, fallback: string): string => {
  if (value === 'echo_src_enabled') {
    return 'ECHO/SOXR SRC (compat)';
  }
  if (value === 'uzume_processing_enabled') {
    return 'UZUME skeleton processing';
  }
  if (value === 'dsp_headroom_enabled') {
    return 'Headroom enters PCM processed skeleton path';
  }

  return normalizeReason(value, fallback);
};

const formatUzumeFormatPath = (status: AudioStatus | null, unknown: string): string => {
  switch (status?.uzumeFormatPath) {
    case 'pcm_bitperfect':
      return 'PCM bit-perfect';
    case 'pcm_processed':
      return 'PCM processed / UZUME skeleton';
    case 'dsd_direct':
      return status.activeDsdOutputMode === 'native' ? 'DSD direct / Native' : 'DSD direct / DoP';
    case 'dsd_upsampling':
      return 'DSD upsampling / SDM-only';
    case 'd2p_processed':
      return 'DSD -> PCM processed';
    case 'sdm_processed':
      return 'SDM processed';
    default:
      if (status?.activeDsdOutputMode === 'native') {
        return 'DSD direct / Native';
      }
      if (status?.activeDsdOutputMode === 'dop') {
        return 'DSD direct / DoP';
      }
      return status?.dspActive ? 'PCM processed / UZUME skeleton' : unknown;
  }
};

const formatUzumePathPlan = (status: AudioStatus | null, fallback: string): string => {
  const plan = status?.uzumeFormatPathPlan;
  if (!plan) {
    return fallback;
  }

  return ['pcm_bitperfect', 'pcm_processed', 'dsd_direct', 'dsd_upsampling', 'd2p_processed', 'sdm_processed']
    .map((path) => {
      const entry = plan[path as keyof typeof plan];
      if (!entry) {
        return null;
      }

      return `${path}:${entry.state}${entry.reason ? `/${normalizeReason(entry.reason, fallback)}` : ''}`;
    })
    .filter((part): part is string => Boolean(part))
    .join(' | ') || fallback;
};

const formatReferenceEngineId = (value: string): string =>
  value.replace(/-reference$/u, ' ref').replaceAll('-', ' ');

const formatUzumeReferenceCompiler = (status: AudioStatus | null, fallback: string): string => {
  const plan = status?.uzumeReferencePlan;
  if (!plan) {
    return fallback;
  }

  return `schema v${plan.schemaVersion} / telemetry v${plan.telemetrySchemaVersion} / ${plan.internalDomain}`;
};

const formatUzumeReferenceArtifactManifest = (status: AudioStatus | null, fallback: string): string => {
  return buildUzumeReferenceArtifactManifestSummary(status?.uzumeReferencePlan?.artifactPlan)?.text ?? fallback;
};

const formatUzumeReferenceAssignments = (status: AudioStatus | null, fallback: string): string => {
  const plan = status?.uzumeReferencePlan;
  const assignments = plan?.engineAssignments ?? [];
  if (!assignments.length) {
    return fallback;
  }

  const assignmentsBySection = new Map(assignments.map((assignment) => [assignment.sectionId, assignment]));
  const orderedSections = plan?.orderedProfileSections.length ? plan.orderedProfileSections : assignments.map((assignment) => assignment.sectionId);

  return orderedSections
    .map((sectionId) => {
      const assignment = assignmentsBySection.get(sectionId);
      if (!assignment) {
        return `${sectionId}->missing assignment`;
      }

      const details = [
        assignment.active ? 'active' : 'inactive',
        assignment.mergeGroupId ? `merge ${assignment.mergeGroupId}` : null,
        assignment.latencyOwner ? `latency ${assignment.latencyOwner}` : null,
        assignment.splitReason ? `split ${normalizeReason(assignment.splitReason, fallback)}` : null,
      ].filter((part): part is string => Boolean(part));

      return `${assignment.sectionId}->${formatReferenceEngineId(assignment.engineId)} (${details.join(', ')})`;
    })
    .join(' | ');
};

const formatUzumeReferenceMergeGroups = (status: AudioStatus | null, fallback: string): string => {
  const groups = status?.uzumeReferencePlan?.mergeGroups ?? [];
  if (!groups.length) {
    return fallback;
  }

  return groups
    .map((group) => {
      const details = [
        group.active ? 'active' : 'inactive',
        group.sampleRateFamily ?? null,
        group.sections.length ? `sections ${group.sections.join('+')}` : null,
        group.splitReason ? `split ${normalizeReason(group.splitReason, fallback)}` : null,
      ].filter((part): part is string => Boolean(part));

      return `${group.id}->${formatReferenceEngineId(group.engineId)} (${details.join(', ')})`;
    })
    .join(' | ');
};

const formatUzumeReferenceLatencyOwners = (status: AudioStatus | null, fallback: string): string => {
  const owners = Object.entries(status?.uzumeReferencePlan?.latencyOwners ?? {});
  if (!owners.length) {
    return fallback;
  }

  return owners
    .map(([sectionId, owner]) => `${sectionId}->${owner}`)
    .join(' | ');
};

const isExpectedUzumeReferenceCompiler = (plan: AudioStatus['uzumeReferencePlan'] | null | undefined): boolean => {
  if (!plan || plan.schemaVersion !== 1 || plan.telemetrySchemaVersion !== 2 || plan.internalDomain === 'unknown') {
    return false;
  }

  const orderedSections = plan.orderedProfileSections;
  const assignments = plan.engineAssignments;
  if (!orderedSections.length || assignments.length < orderedSections.length) {
    return false;
  }

  const orderedSet = new Set(orderedSections);
  const assignmentsBySection = new Map(assignments.map((assignment) => [assignment.sectionId, assignment]));
  const mergeGroupsById = new Map(plan.mergeGroups.map((group) => [group.id, group]));
  const latencyOwners = Object.entries(plan.latencyOwners);
  const orderedSectionsAreCovered = orderedSections.every((sectionId) => assignmentsBySection.has(sectionId));
  const assignmentsAreValid = assignments.every((assignment) => {
    const mergeGroup = assignment.mergeGroupId ? mergeGroupsById.get(assignment.mergeGroupId) : null;
    const latencyOwner = assignment.latencyOwner ? plan.latencyOwners[assignment.sectionId] : null;

    return orderedSet.has(assignment.sectionId) &&
      assignment.engineId.length > 0 &&
      (!assignment.mergeGroupId || (mergeGroup !== null && mergeGroup !== undefined && mergeGroup.sections.includes(assignment.sectionId))) &&
      (!assignment.latencyOwner || latencyOwner === assignment.latencyOwner);
  });
  const mergeGroupsAreValid = plan.mergeGroups.length > 0 &&
    plan.mergeGroups.every((group) =>
      group.id.length > 0 &&
      group.engineId.length > 0 &&
      group.sections.length > 0 &&
      group.sections.every((sectionId) => {
        const assignment = assignmentsBySection.get(sectionId);
        return assignment !== undefined &&
          assignment.engineId === group.engineId &&
          assignment.mergeGroupId === group.id;
      }));
  const latencyOwnersAreValid = latencyOwners.length > 0 &&
    latencyOwners.every(([sectionId, owner]) => {
      const assignment = assignmentsBySection.get(sectionId as NonNullable<AudioStatus['uzumeReferencePlan']>['orderedProfileSections'][number]);
      return owner.length > 0 &&
        assignment?.latencyOwner === owner &&
        plan.latencyBudget.latencyOwners[sectionId] === owner;
    });

  return orderedSectionsAreCovered && assignmentsAreValid && mergeGroupsAreValid && latencyOwnersAreValid;
};

const isExpectedUzumeReferenceBackendSupport = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['backendSupport'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedReasons = [
    'cpu_float64_reference_selected_for_rpc002',
    'avx2_gpu_runtime_backends_deferred_beyond_reference_gate',
    'legacy_dsp_chain_not_entered_by_uzume_compiler',
    'backend_support_reference_only',
  ];

  return report.artifact === 'backend-support-reference' &&
    report.policy === 'reference-backend-only-no-runtime-switch' &&
    report.selectedBackend === 'cpu-float64-reference' &&
    report.realtimeBackend === 'not-enabled' &&
    report.cpuReference.id === 'cpu-float64-reference' &&
    report.cpuReference.state === 'available' &&
    report.cpuReference.role === 'deterministic-reference' &&
    report.cpuAvx.id === 'cpu-avx2-fused-macro-kernel' &&
    report.cpuAvx.state === 'future-production-gate' &&
    report.cpuAvx.gate === 'rpc-003-cpu-realtime-gate' &&
    report.gpu.id === 'gpu-render-ahead-offload' &&
    report.gpu.state === 'future-render-ahead-gate' &&
    report.gpu.gate === 'rpc-005-gpu-render-ahead-gate' &&
    report.legacy.id === 'legacy-dsp-chain' &&
    report.legacy.state === 'non-uzume-fallback-only' &&
    report.legacy.allowedInCompiler === false &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const isExpectedUzumeReferenceOutputDevicePolicy = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['outputDevicePolicy'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedReasons = [
    'direct_like_output_reports_actual_device_rate',
    'output_device_policy_reference_only',
  ];

  return report.artifact === 'output-device-policy-reference' &&
    report.state === 'direct-like-ready' &&
    (report.outputMode === 'exclusive' || report.outputMode === 'asio') &&
    report.deviceCapability === 'direct-like-rate-match' &&
    report.requestedOutputRate !== null &&
    report.actualDeviceRate === report.requestedOutputRate &&
    report.sharedDeviceRate === null &&
    report.bitPerfectCandidate === true &&
    report.resampling === false &&
    report.sampleRateMismatch === false &&
    report.recommendation === 'none' &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const isExpectedUzumeReferenceLatencyBudget = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['latencyBudget'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedReasons = [
    'latency_budget_summary_derived_from_reference_reports',
    'cpu_float64_reference_only_no_runtime_scheduler',
    'callback_reads_committed_output_only',
    'production_latency_compensation_deferred_to_realtime_gate',
  ];

  return report.artifact === 'latency-budget-reference' &&
    report.policy === 'reference-budget-summary-no-runtime-scheduler' &&
    report.state === 'ready' &&
    report.selectedBackend === 'cpu-float64-reference' &&
    report.realtimeBackend === 'not-enabled' &&
    report.callbackRule === 'read-committed-output-only' &&
    report.schedulerState === 'reference-only' &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const isExpectedUzumeReferenceReadinessContract = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['readinessContract'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedReasons = [
    'readiness_summary_derived_from_reference_reports',
    'main_playback_logic_owns_timeline_and_policy',
    'gpu_prewarm_deferred_to_render_ahead_gate',
    'stale_generation_commit_disallowed',
    'readiness_contract_reference_only',
  ];

  return report.artifact === 'readiness-contract-reference' &&
    report.policy === 'main-playback-owns-timeline-uzume-reports-readiness' &&
    (report.state === 'ready-to-commit' || report.state === 'cache-ready') &&
    report.gpuPrewarmReady === false &&
    report.gpuPrewarmState === 'future-render-ahead-gate' &&
    report.generationCommitRule === 'current-generation-only' &&
    report.staleGenerationCommitAllowed === false &&
    report.productionScheduler === 'not-enabled' &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const isExpectedUzumeReferenceGenerationCacheKey = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['generationCacheKey'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedInvalidates = ['seek', 'manual-skip', 'profile-change', 'device-change', 'output-mode-change', 'sample-rate-plan-change'];
  const expectedPreserves = ['pause', 'resume', 'mute', 'volume', 'declick'];
  const expectedReasons = [
    'cache_key_includes_generation_profile_device_and_timeline',
    'album_segments_use_segment_index_when_gapless',
    'file_path_alone_is_not_a_valid_cache_key',
    'renderer_may_inspect_but_not_mutate_cache_keys',
    'generation_cache_key_reference_only',
  ];
  const albumSegmentScopeMatches =
    report.timelineScope === 'gapless-album-segment'
      ? report.trackRole === 'gapless-segment' && report.albumSegmentKey !== null && report.albumSegmentIndex !== null
      : report.trackRole === 'next-track-head' && report.albumSegmentKey === null && report.albumSegmentIndex === null;

  return report.artifact === 'generation-cache-key-reference' &&
    report.policy === 'generation-safe-cache-key-contract-reference' &&
    report.state === 'ready' &&
    report.generationSource === 'playback-intent-reference' &&
    report.sourceIdentity === 'next-reference' &&
    report.generationId > 0 &&
    report.requestKey.length > 0 &&
    report.cacheKey.includes(`generation:${report.generationId}`) &&
    report.cacheKey.includes(`timeline:${report.timelineScope}`) &&
    report.profileFingerprint.length > 0 &&
    report.profileComponents.length > 0 &&
    report.deviceFingerprint.length > 0 &&
    report.deviceComponents.length > 0 &&
    albumSegmentScopeMatches &&
    expectedInvalidates.every((rule) => report.invalidatesOn.includes(rule as (typeof report.invalidatesOn)[number])) &&
    expectedPreserves.every((rule) => report.preservesOn.includes(rule as (typeof report.preservesOn)[number])) &&
    report.staleCommitRule === 'reject-stale-generation' &&
    report.callbackSlotRule === 'late-current-generation-retain-for-future-only' &&
    report.evictionRule === 'stale-then-farthest-from-boundary' &&
    report.rendererControl === 'inspect-only' &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const isExpectedUzumeReferenceRealtimeBudgetSummary = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['realtimeBudgetSummary'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedReasons = [
    'realtime_factor_not_measured_in_rpc002',
    'scalar_float64_budget_is_reference_only',
    'cpu_avx2_realtime_gate_deferred_to_rpc003',
    'gpu_render_ahead_realtime_gate_deferred_to_rpc005',
    'renderer_may_inspect_but_not_control_realtime_path',
  ];

  return report.artifact === 'realtime-budget-summary-reference' &&
    report.policy === 'reference-budget-no-measured-runtime-factor' &&
    report.state === 'same-rate-bypass-reference' &&
    report.selectedBackend === 'cpu-float64-reference' &&
    report.realtimeBackend === 'not-enabled' &&
    report.measuredRealtimeFactor === null &&
    report.measuredRealtimeFactorState === 'not-measured-in-rpc002' &&
    report.srcBudgetBackend === 'scalar-float64-reference' &&
    report.srcEstimatedMultiplyAdds > 0 &&
    report.srcEstimatedRealtimeFactor === null &&
    report.srcSafetyClass === 'same-rate-bypass' &&
    report.callbackRingDepthBlocks > 0 &&
    report.callbackRingTelemetryStatus !== 'unsafe' &&
    report.renderAheadTargetFrames >= report.renderAheadReadyFrames &&
    report.cpuFullProfileFallback === 'reference-available' &&
    report.gpuRealtimeFactor === null &&
    report.realtimeSafetyGate === 'rpc-003-cpu-realtime-gate' &&
    report.gpuRenderAheadGate === 'rpc-005-gpu-render-ahead-gate' &&
    report.thresholdSafeFactor > report.thresholdMarginalFactor &&
    report.rendererControl === 'inspect-only' &&
    expectedReasons.every((reason) => report.reasons.includes(reason));
};

const formatUzumeReferenceBitPerfect = (status: AudioStatus | null, fallback: string): string => {
  const plan = status?.uzumeReferencePlan;
  if (!plan) {
    return fallback;
  }

  const direct = plan.directDisabledReason
    ? `direct disabled ${normalizeReason(plan.directDisabledReason, fallback)}`
    : 'direct path available';

  return `${plan.bitPerfectState} / ${direct} / ${plan.sourceContainer}->${plan.outputContainer} / ${plan.internalDomain} / ${plan.formatPath}`;
};

const formatUzumeReferenceBackendSupport = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.backendSupport;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.policy,
    `selected ${report.selectedBackend}`,
    `realtime ${report.realtimeBackend}`,
    `cpu ${report.cpuReference.state} ${report.cpuReference.role}`,
    `avx ${report.cpuAvx.state} ${report.cpuAvx.gate}`,
    `gpu ${report.gpu.state} ${report.gpu.gate}`,
    `legacy ${report.legacy.state} compiler ${report.legacy.allowedInCompiler ? 'allowed' : 'blocked'}`,
    `output ${report.outputDevicePolicyState}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceOutputDevicePolicy = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.outputDevicePolicy;
  if (!report) {
    return fallback;
  }

  const reasons = report.reasons.length
    ? ` / reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}`
    : '';

  return [
    report.artifact,
    report.formatPath,
    report.outputMode ?? fallback,
    report.deviceCapability,
    report.state,
    `file ${formatRate(report.fileRate, fallback)}`,
    `decoder ${formatRate(report.decoderOutputRate, fallback)}`,
    `requested ${formatRate(report.requestedOutputRate, fallback)}`,
    `actual ${formatRate(report.actualDeviceRate, fallback)}`,
    `shared ${formatRate(report.sharedDeviceRate, fallback)}`,
    `output ${report.outputContainer}`,
    `bit-perfect candidate ${report.bitPerfectCandidate === null ? fallback : report.bitPerfectCandidate ? 'yes' : 'no'}`,
    `resampling ${report.resampling === null ? fallback : report.resampling ? 'yes' : 'no'}`,
    `mismatch ${report.sampleRateMismatch === null ? fallback : report.sampleRateMismatch ? 'yes' : 'no'}`,
    `recommend ${normalizeReason(report.recommendation, fallback)}`,
  ].join(' / ') + reasons;
};

const formatUzumeReferenceLatencyBudget = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.latencyBudget;
  if (!report) {
    return fallback;
  }

  const owners = Object.entries(report.latencyOwners)
    .map(([sectionId, owner]) => `${sectionId}->${owner}`)
    .join(' | ') || 'none';
  const reasons = report.reasons.length
    ? ` / reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}`
    : '';

  return [
    report.artifact,
    report.selectedBackend,
    `realtime ${report.realtimeBackend}`,
    `src ${Math.round(report.srcGroupDelaySamples)} samples/${formatFractionalMs(report.srcGroupDelayMs, fallback)} lookahead ${Math.round(report.srcLookaheadSamples)} samples/${formatFractionalMs(report.srcLookaheadMs, fallback)}`,
    `conv ${report.convolutionLatencyClass} latency ${formatFrames(report.convolutionLatencySamples, fallback)} direct-head ${Math.round(report.convolutionDirectHeadTaps)} taps warmup ${formatFrames(report.convolutionWarmupFrames, fallback)} tail ${formatFrames(report.convolutionTailFrames, fallback)} drain ${formatFrames(report.convolutionDrainFrames, fallback)}`,
    `blocks ${formatFrames(report.callbackBlockFrames, fallback)}->${formatFrames(report.internalBlockFrames, fallback)}->${formatFrames(report.outputBlockFrames, fallback)}`,
    `pre-roll ${formatFrames(report.preRollRequiredFrames, fallback)} slack ${formatFrames(report.deadlineSlackFrames, fallback)}`,
    `ring ${formatFrames(report.callbackRingDepthFrames, fallback)}/${formatFrames(report.callbackRingCapacityFrames, fallback)} ${report.callbackRingDepthBlocks.toFixed(1)} blocks`,
    `render-ahead ${report.renderAheadState} ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames} frames`,
    `cache ${Math.round(report.cacheBytesAfterEvict)}/${Math.round(report.cacheBudgetBytes)} bytes`,
    `owners ${owners}`,
    report.callbackRule,
    report.schedulerState,
  ].join(' / ') + reasons;
};

const formatUzumeReferenceReadinessContract = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.readinessContract;
  if (!report) {
    return fallback;
  }

  const reasons = report.reasons.length
    ? ` / reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}`
    : '';

  return [
    report.artifact,
    report.policy,
    report.state,
    `${report.intent}->${report.selectedPath}`,
    `wait ${report.waitTarget}`,
    `full-profile ${report.fullProfileReady ? 'ready' : 'not-ready'}`,
    `gpu-prewarm ${report.gpuPrewarmReady ? 'ready' : report.gpuPrewarmState}`,
    `cache ${report.cacheState}->${report.cacheCommitState} key ${report.cacheKey}`,
    `render-ahead ${report.renderAheadState} ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames}`,
    `deadline ${report.deadlineState} slack ${formatFrames(report.deadlineSlackFrames, fallback)}`,
    `ring ${report.callbackRingState}/${report.callbackRingTelemetryStatus}`,
    `short-bridge ${report.shortBridgeCandidate}${report.shortBridgeReason ? ` ${normalizeReason(report.shortBridgeReason, fallback)}` : ''}`,
    `crossfade ${report.crossfadeToFullProfile}`,
    `generation ${report.generationCommitRule} stale ${report.staleGenerationCommitAllowed ? 'allowed' : 'blocked'}`,
    report.handoffStrategy,
    `scheduler ${report.productionScheduler}`,
  ].join(' / ') + reasons;
};

const formatUzumeReferenceGenerationCacheKey = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.generationCacheKey;
  if (!report) {
    return fallback;
  }

  const reasons = report.reasons.length
    ? ` / reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}`
    : '';

  return [
    report.artifact,
    report.policy,
    `gen ${report.generationId}`,
    report.timelineScope,
    report.trackRole,
    `request ${report.requestKey}`,
    `cache ${report.cacheKey}`,
    report.profileFingerprint,
    report.deviceFingerprint,
    `profile ${report.profileComponents.join(' + ')}`,
    `device ${report.deviceComponents.join(' + ')}`,
    `album ${report.albumSegmentKey ?? 'none'} index ${report.albumSegmentIndex ?? 'n/a'}`,
    `invalidate ${report.invalidatesOn.map((reason) => normalizeReason(reason, fallback)).join('+')}`,
    `preserve ${report.preservesOn.join('+')}`,
    report.staleCommitRule,
    report.callbackSlotRule,
    report.evictionRule,
    `renderer ${report.rendererControl}`,
  ].join(' / ') + reasons;
};

const formatUzumeReferenceRealtimeBudgetSummary = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.realtimeBudgetSummary;
  if (!report) {
    return fallback;
  }

  const measured = report.measuredRealtimeFactor === null
    ? report.measuredRealtimeFactorState
    : `${report.measuredRealtimeFactor.toFixed(2)}x`;
  const srcRealtime = report.srcEstimatedRealtimeFactor === null
    ? 'unmeasured'
    : `${report.srcEstimatedRealtimeFactor.toFixed(2)}x`;
  const reasons = report.reasons.length
    ? ` / reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}`
    : '';

  return [
    report.artifact,
    report.policy,
    report.state,
    `selected ${report.selectedBackend}`,
    `realtime ${report.realtimeBackend}`,
    `measured ${measured}`,
    `src ${report.srcBudgetBackend} ${report.srcEstimatedMultiplyAdds} multiply-adds factor ${srcRealtime} ${report.srcSafetyClass}`,
    `ring ${report.callbackRingDepthBlocks.toFixed(1)} blocks ${report.callbackRingTelemetryStatus}`,
    `render-ahead ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames} ${Math.round(report.renderAheadCoverageRatio * 100)}%`,
    `cpu ${report.cpuFullProfileFallback}`,
    `gpu factor ${report.gpuRealtimeFactor === null ? 'unmeasured' : `${report.gpuRealtimeFactor.toFixed(2)}x`}`,
    `thresholds safe ${report.thresholdSafeFactor.toFixed(1)}x marginal ${report.thresholdMarginalFactor.toFixed(1)}x`,
    report.realtimeSafetyGate,
    report.gpuRenderAheadGate,
    `renderer ${report.rendererControl}`,
  ].join(' / ') + reasons;
};

const formatUzumeReferenceResampling = (status: AudioStatus | null, fallback: string): string => {
  const resampling = status?.uzumeReferencePlan?.resampling;
  if (!resampling) {
    return fallback;
  }

  const source = formatRate(resampling.sourceRate, fallback);
  const target = formatRate(resampling.targetRate, fallback);
  const delayMs = resampling.groupDelayMs !== null && resampling.groupDelayMs !== undefined
    ? ` / ${formatFractionalMs(resampling.groupDelayMs, fallback)}`
    : '';
  const delay = `${resampling.groupDelaySamples} samples${delayMs}`;
  const taps = resampling.filterContract?.tapCount ? ` / ${resampling.filterContract.tapCount} taps` : '';
  const cutoff = resampling.filterContract?.tapCount
    ? ` / cutoff ${Math.round(resampling.filterContract.cutoffRatio * 100)}%`
    : '';
  const alias = resampling.artifactMetrics?.aliasRejectionDb !== null && resampling.artifactMetrics?.aliasRejectionDb !== undefined
    ? ` / alias ${resampling.artifactMetrics.aliasRejectionDb.toFixed(1)} dB`
    : '';
  const risk = resampling.doubleResamplingRisk ? ` / ${normalizeReason(resampling.doubleResamplingRisk, fallback)}` : '';

  return resampling.active
    ? `${resampling.family} ${source}->${target} / ${resampling.phaseMode} / ${delay}${taps}${cutoff}${alias}${risk}`
    : `${resampling.family} / same-rate bypass`;
};

const formatUzumeReferenceSrcRollback = (status: AudioStatus | null, fallback: string): string => {
  const rollback = status?.uzumeReferencePlan?.resampling?.qualityRollback;
  if (!rollback) {
    return fallback;
  }

  const profiles = [rollback.primaryProfile, ...rollback.rollbackChain]
    .map((profile) => `${profile.id} ${profile.tapCount} taps ${profile.stopbandAttenuationDb} dB ${profile.latencyClass}`)
    .join(' -> ');

  return `${rollback.state} / ${rollback.reason.replaceAll('-', ' ')} / ${rollback.familyLock} / ${profiles} / ${rollback.legacyFallbackAllowed ? 'legacy fallback allowed' : `legacy blocked ${rollback.legacyFallbackSignalPath}`} / ${rollback.shortBridgeIsRollback ? 'short bridge rollback' : 'short bridge not rollback'}`;
};

const isExpectedUzumeReferenceSrcRollback = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling']['qualityRollback'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const stateReasonMatches =
    (report.state === 'armed' && report.reason === 'realtime-budget-warning') ||
    (report.state === 'standby' && report.reason === 'reference-profile-within-budget') ||
    (report.state === 'not-applicable' && report.reason === 'same-rate-bypass');
  const profiles = [report.primaryProfile, ...report.rollbackChain];

  return report.artifact === 'poly-sinc-quality-rollback-reference' &&
    stateReasonMatches &&
    report.familyLock === 'poly-sinc-reference-only' &&
    !report.legacyFallbackAllowed &&
    report.legacyFallbackSignalPath === 'UZUME bypass / legacy non-UZUME path' &&
    !report.shortBridgeIsRollback &&
    profiles.length >= 2 &&
    profiles.every((profile) =>
      profile.family === 'poly-sinc-reference' &&
      profile.phaseMode === 'linear' &&
      profile.apodizing === 'reference-windowed-sinc' &&
      profile.tapCount > 0 &&
      profile.stopbandAttenuationDb > 0 &&
      profile.shortBridgeOnlyFor === null);
};

const formatUzumeReferenceSrcBudget = (status: AudioStatus | null, fallback: string): string => {
  const metrics = status?.uzumeReferencePlan?.resampling?.artifactMetrics;
  const budget = metrics?.realtimeBudget;
  const nullResidual = metrics?.nullResidual;
  if (!budget) {
    return fallback;
  }

  const realtimeFactor = budget.estimatedRealtimeFactor === null
    ? 'realtime factor unmeasured'
    : `realtime factor ${budget.estimatedRealtimeFactor.toFixed(2)}x`;
  const nullText = nullResidual
    ? `null ${nullResidual.state}${nullResidual.maxAbs !== null && nullResidual.maxAbs !== undefined ? ` max ${nullResidual.maxAbs.toFixed(6)}` : ''}${nullResidual.rms !== null && nullResidual.rms !== undefined ? ` rms ${nullResidual.rms.toFixed(6)}` : ''}`
    : fallback;

  return `${budget.backend} / ${budget.estimatedMultiplyAdds} multiply-adds / ${realtimeFactor} / ${budget.safetyClass} / ${nullText}`;
};

const formatMetricDb = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)} dB` : null;

const formatMetricRatio = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value.toFixed(4) : null;

const formatMetricScalar = (value: number | null | undefined): string | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) > 0 && Math.abs(value) < 0.000001) {
    return value.toExponential(2);
  }
  return value.toFixed(6);
};

const isFiniteNonNegativeMetric = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value) && value >= 0;

const formatUzumeReferenceSrcArtifacts = (status: AudioStatus | null, fallback: string): string => {
  const metrics = status?.uzumeReferencePlan?.resampling?.artifactMetrics;
  if (!metrics) {
    return fallback;
  }

  const passbandRipple = formatMetricDb(metrics.passbandRippleDb);
  const stopbandAttenuation = formatMetricDb(metrics.stopbandAttenuationDb);
  const cutoffRatio = formatMetricRatio(metrics.cutoffRatioEstimate);
  const transitionWidth = formatMetricRatio(metrics.transitionWidthRatioEstimate);
  const phaseSpread = formatMetricRatio(metrics.phaseGroupDelaySpreadSamples);
  const multiTonePeak = formatMetricRatio(metrics.multiTonePeak);
  const randomPeak = formatMetricRatio(metrics.randomPeak);
  const randomSeed = Number.isFinite(metrics.randomSeed) ? `random seed ${metrics.randomSeed}` : null;

  return [
    passbandRipple ? `passband ${passbandRipple}` : null,
    stopbandAttenuation ? `stopband ${stopbandAttenuation}` : null,
    cutoffRatio ? `cutoff ${cutoffRatio}` : null,
    transitionWidth ? `transition ${transitionWidth}` : null,
    phaseSpread ? `phase spread ${phaseSpread} samples` : null,
    `silence ${metrics.silenceResidual.state} max ${metrics.silenceResidual.maxAbs.toFixed(6)}`,
    multiTonePeak ? `multi-tone peak ${multiTonePeak}` : null,
    randomPeak ? `seeded-random peak ${randomPeak}` : null,
    randomSeed,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceSrcArtifacts = (
  resampling: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling'] | null | undefined,
): boolean => {
  const metrics = resampling?.artifactMetrics;
  if (!resampling || !metrics || resampling.validation?.overall !== 'pass') {
    return false;
  }

  const silenceResidualIsExact = metrics.silencePeak === 0 &&
    metrics.silenceResidual.state === 'exact-silence' &&
    metrics.silenceResidual.maxAbs <= 1e-12 &&
    metrics.silenceResidual.rms <= 1e-12;
  const commonArtifactShape = resampling.family === 'poly-sinc-reference' &&
    metrics.realtimeBudget.backend === 'scalar-float64-reference' &&
    metrics.realtimeBudget.estimatedMultiplyAdds > 0 &&
    metrics.realtimeBudget.estimatedRealtimeFactor === null &&
    Number.isInteger(metrics.randomSeed) &&
    metrics.randomSeed > 0 &&
    isFiniteNonNegativeMetric(metrics.impulsePeak) &&
    metrics.impulsePeak > 0 &&
    isFiniteNonNegativeMetric(metrics.impulseEnergy) &&
    metrics.impulseEnergy > 0 &&
    isFiniteNonNegativeMetric(metrics.sweepPeak) &&
    metrics.sweepPeak > 0 &&
    isFiniteNonNegativeMetric(metrics.logSweepPeak) &&
    metrics.logSweepPeak > 0 &&
    isFiniteNonNegativeMetric(metrics.nearNyquistPeak) &&
    isFiniteNonNegativeMetric(metrics.multiTonePeak) &&
    metrics.multiTonePeak > 0 &&
    isFiniteNonNegativeMetric(metrics.randomPeak) &&
    metrics.randomPeak > 0 &&
    silenceResidualIsExact;

  if (!commonArtifactShape) {
    return false;
  }

  if (resampling.sameRateBypass) {
    return !resampling.active &&
      resampling.phaseAccumulator === 'same-rate-bypass' &&
      metrics.realtimeBudget.safetyClass === 'same-rate-bypass' &&
      metrics.nullResidual.state === 'exact-bypass' &&
      metrics.nullResidual.maxAbs !== null &&
      metrics.nullResidual.maxAbs <= 1e-12 &&
      metrics.nullResidual.rms !== null &&
      metrics.nullResidual.rms <= 1e-12 &&
      metrics.passbandRippleDb === 0 &&
      metrics.stopbandAttenuationDb === 0;
  }

  return resampling.active &&
    resampling.phaseAccumulator === 'rational-fixed-step' &&
    metrics.realtimeBudget.safetyClass === 'offline-reference-only' &&
    metrics.nullResidual.state === 'not-applicable' &&
    metrics.aliasRejectionDb !== null &&
    metrics.aliasRejectionDb >= 0 &&
    metrics.phaseGroupDelaySpreadSamples !== null &&
    metrics.phaseGroupDelaySpreadSamples > 0 &&
    metrics.passbandRippleDb !== null &&
    metrics.passbandRippleDb >= 0 &&
    metrics.stopbandAttenuationDb !== null &&
    metrics.stopbandAttenuationDb > 0 &&
    metrics.cutoffRatioEstimate !== null &&
    metrics.cutoffRatioEstimate > 0 &&
    metrics.cutoffRatioEstimate < 1 &&
    metrics.transitionWidthRatioEstimate !== null &&
    metrics.transitionWidthRatioEstimate > 0 &&
    metrics.transitionWidthRatioEstimate <= 1;
};

const isExpectedUzumeReferenceSrcBudget = (
  resampling: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling'] | null | undefined,
): boolean => {
  const metrics = resampling?.artifactMetrics;
  if (!resampling || !metrics || !resampling.sameRateBypass) {
    return false;
  }

  return !resampling.active &&
    resampling.phaseAccumulator === 'same-rate-bypass' &&
    resampling.realtimeSafetyClass === 'same-rate-bypass' &&
    metrics.realtimeBudget.backend === 'scalar-float64-reference' &&
    metrics.realtimeBudget.estimatedMultiplyAdds > 0 &&
    metrics.realtimeBudget.estimatedRealtimeFactor === null &&
    metrics.realtimeBudget.safetyClass === 'same-rate-bypass' &&
    metrics.nullResidual.state === 'exact-bypass' &&
    metrics.nullResidual.maxAbs !== null &&
    metrics.nullResidual.maxAbs <= 1e-12 &&
    metrics.nullResidual.rms !== null &&
    metrics.nullResidual.rms <= 1e-12;
};

const formatUzumeReferenceSrcValidation = (status: AudioStatus | null, fallback: string): string => {
  const validation = status?.uzumeReferencePlan?.resampling?.validation;
  if (!validation) {
    return fallback;
  }

  const checks = validation.checks.map((check) => `${check.id}:${check.state}`).join(' / ');
  return [
    validation.artifact,
    `overall ${validation.overall}`,
    checks,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceSrcValidation = (
  validation: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling']['validation'] | null | undefined,
): boolean => {
  if (!validation) {
    return false;
  }

  const expectedChecks = [
    'passband-ripple',
    'stopband-attenuation',
    'transition-width',
    'silence-preservation',
    'same-rate-null',
    'realtime-budget',
  ] as const;
  const checksById = new Map(validation.checks.map((check) => [check.id, check.state]));

  return validation.artifact === 'poly-sinc-formal-validation-reference' &&
    validation.overall === 'pass' &&
    expectedChecks.every((id) => {
      const state = checksById.get(id);
      return state === 'pass' || state === 'not-applicable';
    });
};

const formatUzumeReferenceSrcOutputRisk = (status: AudioStatus | null, fallback: string): string => {
  const risk = status?.uzumeReferencePlan?.resampling?.outputResamplingRisk;
  if (!risk) {
    return fallback;
  }

  return [
    risk.artifact,
    risk.state,
    risk.reason ? normalizeReason(risk.reason, fallback) : 'no double-resampling risk',
    `requested ${formatRate(risk.requestedOutputRate, fallback)}`,
    `actual ${formatRate(risk.actualDeviceRate, fallback)}`,
    risk.sharedDeviceRate !== null && risk.sharedDeviceRate !== undefined ? `shared ${formatRate(risk.sharedDeviceRate, fallback)}` : null,
    `current ${risk.currentResamplerEngine ?? 'none'}`,
    `tone ${risk.signalPathTone}`,
    `recommend ${risk.recommendation?.replaceAll('-', ' ') ?? 'none'}`,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceSrcOutputRisk = (
  risk: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling']['outputResamplingRisk'] | null | undefined,
): boolean => {
  if (!risk || risk.artifact !== 'output-double-resampling-risk-reference') {
    return false;
  }

  if (risk.state === 'none') {
    return risk.reason === null &&
      risk.currentResamplerEngine === null &&
      risk.signalPathTone === 'good' &&
      risk.recommendation === 'none';
  }

  if (risk.signalPathTone !== 'warning') {
    return false;
  }

  if (risk.state === 'legacy-resampler-active') {
    return risk.currentResamplerEngine !== null &&
      risk.reason === `legacy_${risk.currentResamplerEngine}_resampler_active_reference_only` &&
      risk.recommendation === 'show-legacy-resampler-as-non-uzume-risk';
  }

  if (risk.state === 'shared-output-mixer-risk') {
    return risk.reason === 'shared_output_mixer_reference_only' &&
      risk.recommendation === 'prefer-exclusive-or-device-rate-match';
  }

  return risk.state === 'device-rate-mismatch-risk' &&
    risk.requestedOutputRate !== null &&
    risk.actualDeviceRate !== null &&
    risk.requestedOutputRate !== risk.actualDeviceRate &&
    risk.reason === 'actual_device_rate_mismatch_reference_only' &&
    risk.recommendation === 'inspect-device-rate-mismatch';
};

const formatUzumeReferenceSrcPhaseApodizing = (status: AudioStatus | null, fallback: string): string => {
  const resampling = status?.uzumeReferencePlan?.resampling;
  if (!resampling) {
    return fallback;
  }

  const phase = resampling.phaseModeArtifacts;
  const apodizing = resampling.apodizingArtifact;
  const phaseModes = phase.modes
    .map((mode) => `${mode.mode} gd ${mode.groupDelaySamples.toFixed(2)} spread ${(mode.groupDelaySpreadSamples ?? 0).toFixed(2)} residual ${mode.residualVsLinearMaxAbs.toFixed(4)}/${mode.residualVsLinearRms.toFixed(4)}`)
    .join(' | ');

  return [
    phase.artifact,
    `modes ${phase.phaseModesMeasured.join('+')}`,
    phaseModes,
    apodizing.artifact,
    apodizing.state,
    `${apodizing.mode} vs ${apodizing.baseline}`,
    apodizing.ringingReductionDb !== null ? `ringing reduction ${apodizing.ringingReductionDb.toFixed(2)} dB` : null,
    `response residual ${apodizing.responseResidualMaxAbs.toFixed(4)}/${apodizing.responseResidualRms.toFixed(4)}`,
    apodizing.highFrequencyRestorationClaim ? 'hf restoration claimed' : 'no hf restoration claim',
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceSrcPhaseApodizing = (
  resampling: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling'] | null | undefined,
): boolean => {
  const phase = resampling?.phaseModeArtifacts;
  const apodizing = resampling?.apodizingArtifact;
  if (!resampling || !phase || !apodizing) {
    return false;
  }

  const phaseModes = phase.modes;
  const modesById = new Map(phaseModes.map((mode) => [mode.mode, mode]));
  const linear = modesById.get('linear');
  const minimum = modesById.get('minimum');
  const intermediate = modesById.get('intermediate');
  const modeShapeIsValid = phase.artifact === 'poly-sinc-phase-mode-reference' &&
    phase.phaseModesMeasured.join('|') === 'linear|minimum|intermediate' &&
    phaseModes.length === 3 &&
    [linear, minimum, intermediate].every((mode) =>
      Boolean(mode) &&
      (mode!.impulsePeakIndex === null || isFiniteNonNegativeMetric(mode!.impulsePeakIndex)) &&
      isFiniteNonNegativeMetric(mode!.groupDelaySamples) &&
      (mode!.groupDelaySpreadSamples === null || isFiniteNonNegativeMetric(mode!.groupDelaySpreadSamples)) &&
      isFiniteNonNegativeMetric(mode!.preRingingEnergy) &&
      isFiniteNonNegativeMetric(mode!.postRingingEnergy) &&
      isFiniteNonNegativeMetric(mode!.residualVsLinearMaxAbs) &&
      isFiniteNonNegativeMetric(mode!.residualVsLinearRms));

  if (!modeShapeIsValid || !linear || !minimum || !intermediate) {
    return false;
  }

  const phaseContractIsExpected = linear.groupDelaySamples > intermediate.groupDelaySamples &&
    intermediate.groupDelaySamples > minimum.groupDelaySamples &&
    linear.residualVsLinearMaxAbs === 0 &&
    linear.residualVsLinearRms === 0 &&
    minimum.residualVsLinearMaxAbs > 0 &&
    intermediate.residualVsLinearRms > 0;
  const apodizingShapeIsValid = apodizing.artifact === 'poly-sinc-apodizing-response-reference' &&
    apodizing.mode === 'reference-windowed-sinc' &&
    apodizing.baseline === 'rectangular-sinc-reference' &&
    !apodizing.highFrequencyRestorationClaim &&
    isFiniteNonNegativeMetric(apodizing.apodizedRingingEnergy) &&
    isFiniteNonNegativeMetric(apodizing.baselineRingingEnergy) &&
    isFiniteNonNegativeMetric(apodizing.responseResidualMaxAbs) &&
    isFiniteNonNegativeMetric(apodizing.responseResidualRms);

  if (!phaseContractIsExpected || !apodizingShapeIsValid) {
    return false;
  }

  if (resampling.sameRateBypass) {
    return apodizing.state === 'same-rate-bypass' &&
      apodizing.responseResidualMaxAbs <= 1e-12 &&
      apodizing.responseResidualRms <= 1e-12;
  }

  return resampling.active &&
    apodizing.state === 'apodizing-changes-ringing-response' &&
    apodizing.ringingReductionDb !== null &&
    Number.isFinite(apodizing.ringingReductionDb) &&
    apodizing.responseResidualMaxAbs > 0 &&
    apodizing.responseResidualRms > 0;
};

const isExpectedUzumeReferenceResampling = (
  resampling: NonNullable<AudioStatus['uzumeReferencePlan']>['resampling'] | null | undefined,
): boolean => {
  if (!resampling || resampling.family !== 'poly-sinc-reference') {
    return false;
  }

  const contract = resampling.filterContract;
  const validationChecks = resampling.validation?.checks ?? [];
  const filterContractIsValid = Boolean(contract) &&
    contract.tapCount > 0 &&
    contract.phaseCount > 0 &&
    contract.cutoffRatio > 0 &&
    contract.cutoffRatio < 1 &&
    contract.transitionWidthRatio > 0 &&
    contract.transitionWidthRatio <= 1 &&
    contract.stopbandAttenuationDb > 0 &&
    contract.passbandRippleDb >= 0;
  const validationIsPass = resampling.validation?.artifact === 'poly-sinc-formal-validation-reference' &&
    resampling.validation.overall === 'pass' &&
    validationChecks.length > 0 &&
    validationChecks.every((check) => check.state === 'pass' || check.state === 'not-applicable');
  const ratesAreValid = resampling.sourceRate !== null &&
    resampling.targetRate !== null &&
    resampling.sourceRate > 0 &&
    resampling.targetRate > 0 &&
    resampling.sourceFamily !== null &&
    resampling.targetFamily !== null &&
    resampling.ratio !== null &&
    resampling.ratio > 0;
  const telemetryIsFinite = isFiniteNonNegativeMetric(resampling.groupDelaySamples) &&
    isFiniteNonNegativeMetric(resampling.lookaheadSamples) &&
    (resampling.groupDelayMs === null || isFiniteNonNegativeMetric(resampling.groupDelayMs)) &&
    (resampling.lookaheadMs === null || isFiniteNonNegativeMetric(resampling.lookaheadMs));
  const commonContract = resampling.apodizing === 'reference-windowed-sinc' &&
    filterContractIsValid &&
    validationIsPass &&
    ratesAreValid &&
    telemetryIsFinite &&
    isExpectedUzumeReferenceSrcArtifacts(resampling) &&
    isExpectedUzumeReferenceSrcPhaseApodizing(resampling);

  if (!commonContract) {
    return false;
  }

  if (resampling.sameRateBypass) {
    return !resampling.active &&
      resampling.sourceRate === resampling.targetRate &&
      resampling.sourceFamily === resampling.targetFamily &&
      resampling.ratio === 1 &&
      resampling.phaseAccumulator === 'same-rate-bypass' &&
      resampling.realtimeSafetyClass === 'same-rate-bypass' &&
      resampling.groupDelaySamples === 0 &&
      resampling.lookaheadSamples === 0;
  }

  return resampling.active &&
    resampling.sourceRate !== resampling.targetRate &&
    resampling.phaseAccumulator === 'rational-fixed-step' &&
    resampling.realtimeSafetyClass === 'offline-reference-only' &&
    resampling.groupDelaySamples > 0 &&
    resampling.lookaheadSamples > 0 &&
    resampling.groupDelayMs !== null &&
    resampling.lookaheadMs !== null;
};

const formatUzumeReferenceDsdFamily = (status: AudioStatus | null, fallback: string): string => {
  const dsd = status?.uzumeReferencePlan?.dsdFamily;
  if (!dsd) {
    return fallback;
  }

  const disabled = dsd.disabledControls.length
    ? dsd.disabledControls.map((control) => `${control.control}:${normalizeReason(control.reason, fallback)}`).join(' | ')
    : 'disabled none';
  const d2p = dsd.d2p.active
    ? `d2p ${dsd.d2p.decimationProfile ?? fallback} @ ${dsd.d2p.internalPcmRate ?? fallback} Hz`
    : dsd.d2p.available ? 'd2p available' : 'd2p unavailable';
  const sdm = dsd.sdm.active
    ? `sdm ${dsd.sdm.mode} / ${dsd.sdm.modulatorProfile ?? fallback} / target ${dsd.sdm.targetDsdRate ?? fallback} / overload ${dsd.sdm.overloadMarginDb ?? fallback} dB / noise ${dsd.sdm.ultrasonicNoiseRisk ?? fallback} / ${dsd.sdm.realtimeSafetyClass}`
    : dsd.sdm.available ? 'sdm available' : 'sdm unavailable';

  return [
    dsd.artifact,
    `${dsd.formatPath}:${dsd.state}`,
    `${dsd.sourceContainer}->${dsd.outputContainer}`,
    dsd.internalDomain,
    dsd.directDisabledReason ? `direct disabled ${normalizeReason(dsd.directDisabledReason, fallback)}` : 'direct allowed',
    dsd.fallbackReason ? `fallback ${normalizeReason(dsd.fallbackReason, fallback)}` : null,
    `allowed ${dsd.allowedControls.join('+') || 'none'}`,
    disabled,
    `pcm dsp ${dsd.pcmDomainDspAllowed ? 'allowed' : 'blocked'}`,
    `pcm dither ${dsd.pcmDitherAllowed ? 'allowed' : 'blocked'}`,
    `sdm noise ${dsd.sdmNoiseShapingTelemetry ? 'telemetry' : 'none'}`,
    dsd.dsd.outputEncoding ? `output ${dsd.dsd.outputEncoding}` : null,
    d2p,
    sdm,
    dsd.reasons.length ? `reasons ${dsd.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceDsdFamily = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['dsdFamily'] | null | undefined,
): boolean => {
  if (!report || report.artifact !== 'dsd-family-path-control-reference' || report.sourceContainer !== 'dsd') {
    return false;
  }

  const hasDsdIngressRate = report.dsd.sourceDsdRate !== null &&
    report.dsd.targetDsdRate !== null &&
    report.dsd.sourceDsdRate > 0 &&
    report.dsd.targetDsdRate > 0;
  const disabledControlsHaveReasons = report.disabledControls.every((control) => Boolean(control.control) && Boolean(control.reason));

  if (!hasDsdIngressRate || !disabledControlsHaveReasons) {
    return false;
  }

  if (report.state === 'direct') {
    return report.formatPath === 'dsd_direct' &&
      report.internalDomain === 'dsd-direct' &&
      (report.outputContainer === 'dop' || report.outputContainer === 'dsd_native') &&
      report.directDisabledReason === null &&
      report.fallbackReason === null &&
      !report.experimental &&
      !report.pcmDomainDspAllowed &&
      !report.entersPcmDsp &&
      !report.pcmDitherAllowed &&
      !report.sdmNoiseShapingTelemetry &&
      report.allowedControls.includes('safety-metering') &&
      !report.d2p.active &&
      !report.d2p.available &&
      !report.sdm.active &&
      !report.sdm.available &&
      report.dsd.outputEncoding !== null;
  }

  if (report.state === 'd2p-reference') {
    return report.formatPath === 'd2p_processed' &&
      report.outputContainer === 'pcm' &&
      report.internalDomain === 'multibit-pcm' &&
      Boolean(report.directDisabledReason) &&
      report.fallbackReason === null &&
      !report.experimental &&
      report.pcmDomainDspAllowed &&
      report.entersPcmDsp &&
      report.pcmDitherAllowed &&
      !report.sdmNoiseShapingTelemetry &&
      report.allowedControls.includes('pcm-src') &&
      report.allowedControls.includes('pcm-dither') &&
      report.d2p.active &&
      report.d2p.available &&
      Boolean(report.d2p.decimationProfile) &&
      report.d2p.internalPcmRate !== null &&
      report.d2p.internalPcmRate > 0 &&
      !report.sdm.active &&
      !report.sdm.available &&
      report.reasons.includes('d2p_reports_decimation_profile_and_internal_pcm_rate');
  }

  if (report.state === 'sdm-only-reference') {
    return report.formatPath === 'dsd_upsampling' &&
      report.internalDomain === 'sdm-modulator-input' &&
      (report.outputContainer === 'dop' || report.outputContainer === 'dsd_native') &&
      Boolean(report.directDisabledReason) &&
      report.fallbackReason === null &&
      report.experimental &&
      !report.pcmDomainDspAllowed &&
      !report.entersPcmDsp &&
      !report.pcmDitherAllowed &&
      report.sdmNoiseShapingTelemetry &&
      report.allowedControls.includes('sdm-modulator') &&
      report.disabledControls.some((control) => control.reason === 'requires_d2p_processed_or_sdm_processed') &&
      !report.d2p.active &&
      !report.d2p.available &&
      report.sdm.active &&
      report.sdm.available &&
      report.sdm.mode === 'dsd-upsampling' &&
      Boolean(report.sdm.modulatorProfile) &&
      report.sdm.targetDsdRate !== null &&
      report.sdm.targetDsdRate > 0 &&
      report.sdm.overloadMarginDb !== null &&
      report.sdm.ultrasonicNoiseRisk !== null &&
      report.sdm.realtimeSafetyClass === 'offline-reference-only' &&
      report.reasons.includes('dsd_upsampling_is_sdm_only_not_pcm_domain_dsp');
  }

  if (report.state === 'sdm-processed-reference') {
    return report.formatPath === 'sdm_processed' &&
      report.internalDomain === 'sdm-modulator-input' &&
      (report.outputContainer === 'dop' || report.outputContainer === 'dsd_native') &&
      report.directDisabledReason === 'sdm_processed_enabled' &&
      report.fallbackReason === null &&
      report.experimental &&
      report.pcmDomainDspAllowed &&
      report.entersPcmDsp &&
      !report.pcmDitherAllowed &&
      report.sdmNoiseShapingTelemetry &&
      report.allowedControls.includes('sdm-modulator') &&
      report.disabledControls.some((control) => control.control === 'pcm-dither' && control.reason === 'sdm_uses_noise_shaping_not_pcm_dither') &&
      !report.d2p.active &&
      !report.d2p.available &&
      report.sdm.active &&
      report.sdm.available &&
      report.sdm.mode === 'sdm-processed' &&
      Boolean(report.sdm.modulatorProfile) &&
      report.sdm.targetDsdRate !== null &&
      report.sdm.targetDsdRate > 0 &&
      report.sdm.overloadMarginDb !== null &&
      report.sdm.ultrasonicNoiseRisk !== null &&
      report.sdm.realtimeSafetyClass === 'offline-reference-only' &&
      report.reasons.includes('sdm_reports_modulator_overload_and_ultrasonic_noise');
  }

  return false;
};

const formatUzumeReferenceConvolution = (status: AudioStatus | null, fallback: string): string => {
  const convolution = status?.uzumeReferencePlan?.sharedConvolution;
  if (!convolution) {
    return fallback;
  }

  const plan = convolution.partitionPlan;
  const sourceText = convolution.mergedSourceIds.length
    ? convolution.mergedSourceIds.join('+')
    : convolution.sources.map((source) => source.id).join('+') || fallback;
  const blockText = plan.internalBlockFrames
    ? `${plan.callbackBlockFrames}->${plan.internalBlockFrames}`
    : `${plan.callbackBlockFrames}->inactive`;
  const splitText = Object.entries(convolution.splitReasons)
    .map(([sourceId, reason]) => `${sourceId}:${normalizeReason(reason, fallback)}`)
    .join(' | ');
  const splitSuffix = splitText ? ` / split ${splitText}` : '';

  return convolution.active
    ? `${convolution.engine} / ${sourceText} / ${plan.sampleRateFamily ?? fallback} / block ${blockText} / tail ${plan.tailFrames} / drain ${plan.drainFrames}${splitSuffix}`
    : `${convolution.engine} / inactive / ${sourceText}${splitSuffix}`;
};

const formatUzumeReferenceResponseResample = (status: AudioStatus | null, fallback: string): string => {
  const reports = status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports ?? [];
  if (!reports.length) {
    return fallback;
  }

  return reports.map((report) => [
    `${report.sourceId}:${report.state}`,
    `${formatRate(report.sourceRate, fallback)}->${formatRate(report.targetRate, fallback)}`,
    `${report.sourceFamily ?? fallback}->${report.targetFamily ?? fallback}`,
    report.engine,
    report.linearInterpolationRejected ? 'linear interpolation rejected' : 'linear interpolation not used',
    report.filterContract ? `${report.filterContract.tapCount} taps/${report.filterContract.cutoffRatio.toFixed(4)} cutoff/${report.filterContract.stopbandAttenuationDb} dB` : null,
    normalizeReason(report.reason, fallback),
  ].filter((part): part is string => Boolean(part)).join(' / ')).join(' | ');
};

const isExpectedUzumeReferenceConvolution = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['sharedConvolution'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  if (!report.active) {
    return report.sources.length === 0 &&
      report.mergedSourceIds.length === 0 &&
      report.splitSourceIds.length === 0 &&
      report.partitionPlan.latencyClass === 'inactive';
  }

  const plan = report.partitionPlan;
  const sourceIds = new Set(report.sources.map((source) => source.id));
  const mergedIds = new Set(report.mergedSourceIds);
  const splitIds = new Set(report.splitSourceIds);
  const responseReportIds = new Set(report.responseResampleReports.map((resampleReport) => resampleReport.sourceId));
  const mergedAndSplitCoverSources = report.sources.length > 0 &&
    report.sources.every((source) => (mergedIds.has(source.id) || splitIds.has(source.id)) && !(mergedIds.has(source.id) && splitIds.has(source.id)));
  const splitReasonsMatch = report.splitSourceIds.every((sourceId) => Boolean(report.splitReasons[sourceId])) &&
    Object.keys(report.splitReasons).every((sourceId) => splitIds.has(sourceId));
  const sourcesAreValid = report.sources.every((source) =>
    source.id.length > 0 &&
    source.sampleRate > 0 &&
    source.channels > 0 &&
    source.tapCount > 0 &&
    source.latencySamples >= 0 &&
    Number.isFinite(source.sampleRate) &&
    Number.isFinite(source.latencySamples));
  const mergedSourcesMatchPlan = report.mergedSourceIds.length > 0 &&
    report.mergedSourceIds.every((sourceId) => {
      const source = report.sources.find((candidate) => candidate.id === sourceId);
      return source !== undefined &&
        source.sampleRateFamily === plan.sampleRateFamily &&
        (plan.exactSampleRate === null || plan.exactSampleRate === undefined || source.sampleRate === plan.exactSampleRate) &&
        (plan.channelLayout === null || plan.channelLayout === undefined || source.channelLayout === plan.channelLayout);
    });
  const partitionPlanIsValid = plan.sampleRateFamily !== null &&
    plan.sampleRateFamily !== undefined &&
    (plan.exactSampleRate === null || plan.exactSampleRate === undefined || plan.exactSampleRate > 0) &&
    (plan.channelLayout === null || plan.channelLayout === undefined || plan.channelLayout.length > 0) &&
    plan.latencyClass !== 'inactive' &&
    plan.callbackBlockFrames > 0 &&
    plan.internalBlockFrames > 0 &&
    (plan.outputBlockFrames === undefined || plan.outputBlockFrames > 0) &&
    (plan.directHeadTaps === undefined || plan.directHeadTaps >= 0) &&
    plan.fftHeadSize > 0 &&
    (plan.fftTailSizes === undefined || (plan.fftTailSizes.length > 0 && plan.fftTailSizes.every((size) => size > 0))) &&
    (plan.partitionHopSizes === undefined || (plan.partitionHopSizes.length > 0 && plan.partitionHopSizes.every((size) => size > 0))) &&
    (plan.partitionCount === undefined || plan.fftTailSizes === undefined || plan.partitionCount >= plan.fftTailSizes.length) &&
    plan.tailFrames >= 0 &&
    (plan.tailSeconds === undefined || plan.tailSeconds >= 0) &&
    (plan.warmupFrames === undefined || plan.warmupFrames >= 0) &&
    plan.drainFrames >= 0 &&
    (plan.overlapStrategy === undefined || plan.overlapStrategy === 'overlap-save-reference') &&
    (plan.cpuPlanId === undefined || plan.cpuPlanId === null || plan.cpuPlanId.length > 0) &&
    (plan.gpuPlanId === undefined || plan.gpuPlanId === null || plan.gpuPlanId.length > 0);
  const responseReportsCoverSources = report.responseResampleReports.length === report.sources.length &&
    report.sources.every((source) => responseReportIds.has(source.id));

  return report.engine === 'shared-convolution-planner-reference' &&
    sourceIds.size === report.sources.length &&
    [...mergedIds].every((sourceId) => sourceIds.has(sourceId)) &&
    [...splitIds].every((sourceId) => sourceIds.has(sourceId)) &&
    sourcesAreValid &&
    mergedAndSplitCoverSources &&
    splitReasonsMatch &&
    mergedSourcesMatchPlan &&
    partitionPlanIsValid &&
    responseReportsCoverSources;
};

const isExpectedUzumeReferenceResponseResample = (
  reports: NonNullable<AudioStatus['uzumeReferencePlan']>['sharedConvolution']['responseResampleReports'] | null | undefined,
): boolean => {
  if (!reports?.length) {
    return false;
  }

  return reports.every((report) => {
    if (report.state === 'same-rate-bypass') {
      return report.sameRateBypass &&
        report.engine === 'exact-bypass' &&
        !report.linearInterpolationRejected &&
        report.filterContract === null &&
        report.reason === 'same_rate_exact_bypass';
    }

    if (report.state === 'windowed-sinc-reference-required') {
      const contract = report.filterContract;

      return !report.sameRateBypass &&
        report.engine === 'windowed-sinc-float64-reference' &&
        report.linearInterpolationRejected &&
        contract !== null &&
        contract.tapCount > 0 &&
        contract.phaseCount > 0 &&
        contract.cutoffRatio > 0 &&
        contract.cutoffRatio < 1 &&
        contract.transitionWidthRatio > 0 &&
        contract.stopbandAttenuationDb > 0 &&
        (report.reason === 'cross_family_response_resample_uses_windowed_sinc_reference' ||
          report.reason === 'exact_rate_mismatch_response_resample_uses_windowed_sinc_reference');
    }

    return false;
  });
};

const formatUzumeReferenceConvolutionDuplicateGuard = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard;
  if (!report) {
    return fallback;
  }

  const assignments = report.sourceAssignments
    .map((assignment) => `${assignment.sourceId}:${assignment.state}${assignment.convolverPlanId ? ` conv ${assignment.convolverPlanId}` : ''}${assignment.fftPlanId ? ` fft ${assignment.fftPlanId}` : ''}${assignment.splitReason ? ` split ${normalizeReason(assignment.splitReason, fallback)}` : ''}`)
    .join(' | ');
  const rejected = report.rejectedDuplicatePlans
    .map((plan) => `${plan.sourceId}:${plan.rejectedConvolverPlanId}+${plan.rejectedFftPlanId}`)
    .join(' | ');

  return [
    report.artifact,
    report.engine,
    report.state,
    `merged ${report.planCounts.mergedSourceCount}`,
    `split ${report.planCounts.splitSourceCount}`,
    `convolver plans ${report.planCounts.convolverPlanCount}`,
    `cpu fft ${report.planCounts.cpuFftPlanCount}`,
    `gpu fft ${report.planCounts.gpuFftPlanCount}`,
    `rejected conv ${report.planCounts.rejectedDuplicateConvolverCount}`,
    `rejected fft ${report.planCounts.rejectedDuplicateFftPlanCount}`,
    assignments,
    rejected ? `rejected ${rejected}` : 'rejected none',
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceConvolutionDuplicateGuard = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['sharedConvolution']['duplicatePlanGuard'] | null | undefined,
): boolean => {
  if (!report || report.state !== 'single-shared-plan') {
    return false;
  }

  const sharedAssignments = report.sourceAssignments.filter((assignment) => assignment.state === 'shared-plan');
  const splitAssignments = report.sourceAssignments.filter((assignment) => assignment.state === 'split-required');

  return report.engine === 'shared-convolution-planner-reference' &&
    report.planCounts.mergedSourceCount > 0 &&
    report.planCounts.convolverPlanCount === 1 &&
    report.planCounts.cpuFftPlanCount === 1 &&
    report.planCounts.gpuFftPlanCount <= 1 &&
    sharedAssignments.length === report.planCounts.mergedSourceCount &&
    splitAssignments.length === report.planCounts.splitSourceCount &&
    sharedAssignments.every((assignment) => Boolean(assignment.convolverPlanId) && Boolean(assignment.fftPlanId) && assignment.splitReason === null) &&
    splitAssignments.every((assignment) => !assignment.convolverPlanId && !assignment.fftPlanId && Boolean(assignment.splitReason)) &&
    report.planCounts.rejectedDuplicateConvolverCount === report.rejectedDuplicatePlans.length &&
    report.planCounts.rejectedDuplicateFftPlanCount === report.rejectedDuplicatePlans.length &&
    report.rejectedDuplicatePlans.every((plan) =>
      plan.reason === 'compatible_source_uses_shared_convolution_plan' &&
      Boolean(plan.rejectedConvolverPlanId) &&
      Boolean(plan.rejectedFftPlanId)) &&
    report.reasons.includes('compatible_sources_share_single_convolution_plan') &&
    report.reasons.includes('duplicate_per_source_convolver_and_fft_plans_rejected');
};

const formatUzumeReferenceConvolutionSerialNull = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.engine,
    report.state,
    `order ${report.sourceOrder.length ? report.sourceOrder.join('->') : 'none'}`,
    `merged taps ${report.mergedResponseTapCounts.length ? report.mergedResponseTapCounts.join('+') : 'none'}`,
    `frames ${report.comparedFrames}`,
    report.maxAbs !== null && report.rms !== null
      ? `residual ${report.maxAbs.toFixed(6)}/${report.rms.toFixed(6)}`
      : 'residual n/a',
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceConvolutionSerialNull = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['sharedConvolution']['serialNullReference'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  return report.artifact === 'shared-convolution-serial-null-reference' &&
    report.engine === 'shared-convolution-planner-reference' &&
    report.state === 'merged-matches-serial' &&
    report.sourceOrder.length > 1 &&
    report.mergedResponseTapCounts.length === report.sourceOrder.length &&
    report.comparedFrames > 0 &&
    report.maxAbs === 0 &&
    report.rms === 0 &&
    report.reasons.includes('merged_response_matches_serial_direct_fir_reference') &&
    report.reasons.includes('serial_null_reference_only');
};

const formatUzumeReferencePcmOutputQuantization = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.pcmOutputQuantization;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    `${report.formatPath}->${report.outputSampleFormat}`,
    report.state,
    `bit-perfect ${report.bitPerfectState}`,
    `pcm dither ${report.pcmDitherAllowed ? 'allowed' : 'blocked'}`,
    `dither ${report.dither.mode} ${report.dither.enabled ? 'enabled' : 'disabled'}`,
    report.dither.seed !== null ? `seed ${report.dither.seed}` : null,
    report.dither.lsbAmplitude !== null ? `lsb ${formatMetricScalar(report.dither.lsbAmplitude)}` : null,
    `peak ${report.dither.peakDitherLsb.toFixed(4)} lsb`,
    report.dither.noiseShaping !== 'none' ? `noise ${report.dither.noiseShaping}` : 'noise none',
    report.quantization.bitDepth !== null ? `${report.quantization.bitDepth} bit` : 'float/no pcm integer depth',
    report.quantization.maxInteger !== null ? `max ${report.quantization.maxInteger}` : null,
    `clips ${report.quantization.clippedSamples}`,
    report.quantization.residualMaxAbs !== null && report.quantization.residualRms !== null
      ? `residual ${formatMetricScalar(report.quantization.residualMaxAbs)}/${formatMetricScalar(report.quantization.residualRms)}`
      : 'residual not measured',
    `sdm noise ${report.sdmNoiseShapingTelemetry ? 'telemetry' : 'none'}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferencePcmOutputQuantization = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['pcmOutputQuantization'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  if (report.state === 'bypass') {
    return report.bitPerfectState === 'preserved' &&
      !report.dither.enabled &&
      report.dither.mode === 'none' &&
      report.quantization.clippedSamples === 0;
  }

  if (report.state === 'quantized') {
    return report.bitPerfectState === 'disabled' &&
      report.pcmDitherAllowed &&
      report.dither.enabled &&
      report.dither.mode !== 'none' &&
      report.dither.seed !== null &&
      report.dither.lsbAmplitude !== null &&
      report.dither.lsbAmplitude > 0 &&
      report.quantization.bitDepth !== null &&
      report.quantization.maxInteger !== null &&
      report.quantization.clippedSamples === 0 &&
      report.quantization.residualMaxAbs !== null &&
      report.quantization.residualMaxAbs >= 0 &&
      report.quantization.residualRms !== null &&
      report.quantization.residualRms >= 0 &&
      report.reasons.includes('fixed_point_pcm_output_quantized') &&
      report.reasons.includes('pcm_tpdf_or_plain_quantization_reference');
  }

  return false;
};

const formatUzumeReferencePcmIngressGuard = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.pcmIngressGuard;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.state,
    `expected ${report.expectedChannels ?? fallback}`,
    `channels ${report.channelCount}`,
    `frames ${report.frameCount}`,
    report.rectangular ? 'rectangular' : 'non-rectangular',
    `peak ${report.peak.toFixed(4)}`,
    `non-finite ${report.counts.nonFiniteReplaced}`,
    `denormal ${report.counts.denormalZeroed}`,
    `mismatch ${report.counts.channelMismatchCount}`,
    `silence ${report.counts.silenceFrames}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferencePcmIngressGuard = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['pcmIngressGuard'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  return report.artifact === 'pcm-ingress-guard-reference' &&
    (report.state === 'ok' || report.state === 'silence') &&
    report.expectedChannels !== null &&
    report.expectedChannels === report.channelCount &&
    report.frameCount > 0 &&
    report.rectangular &&
    report.counts.nonFiniteReplaced === 0 &&
    report.counts.denormalZeroed === 0 &&
    report.counts.channelMismatchCount === 0 &&
    Number.isFinite(report.peak) &&
    report.peak >= 0 &&
    report.reasons.includes('pcm_ingress_ready_for_reference_processing');
};

const formatUzumeReferenceGainStaging = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.gainStaging;
  if (!report) {
    return fallback;
  }

  const stages = report.stages
    .map((stage) => `${stage.id}:gain ${stage.gainDb.toFixed(2)} dB/cum ${stage.cumulativeGainDb.toFixed(2)} dB/peak ${stage.peak.toFixed(4)}`)
    .join(' | ');

  return [
    report.artifact,
    `order ${report.orderContract.join('->')}`,
    `total ${report.totalGainDb.toFixed(2)} dB`,
    `linear ${report.totalGainLinear.toFixed(4)}`,
    report.clipRisk ? 'clip risk' : 'clip safe',
    `extra headroom ${report.recommendedAdditionalHeadroomDb.toFixed(2)} dB`,
    stages,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceIirEq = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.iirEq;
  if (!report) {
    return fallback;
  }

  const bands = report.bands
    .slice(0, 4)
    .map((band) =>
      `band${band.index} ${band.filterType} ${formatRate(band.frequencyHz, fallback)} ${band.gainDb.toFixed(2)} dB q ${band.q.toFixed(2)} ${band.state} coeff ${band.coefficientState} resp ${band.responsePeakDb.toFixed(2)}/${band.responseDipDb.toFixed(2)} dB phase ${band.phaseSpanRadians.toFixed(4)}`)
    .join(' | ');
  const omitted = report.bands.length > 4 ? `bands omitted ${report.bands.length - 4}` : null;

  return [
    report.artifact,
    report.engine,
    report.state,
    `sample ${formatRate(report.sampleRate, fallback)}`,
    `bands ${report.activeBandCount}/${report.bandCount} active`,
    `bypassed ${report.bypassedBandCount}`,
    `order ${report.orderContract}`,
    bands,
    omitted,
    `residual ${report.residual.state} ${report.residual.maxAbs.toFixed(6)}/${report.residual.rms.toFixed(6)}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceChannelScope = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.channelScope;
  if (!report) {
    return fallback;
  }

  const operations = report.operations
    .map((operation) => `${operation.id}:${operation.state}->${operation.targetChannels.join('+') || 'none'} skip ${operation.skippedChannels.join('+') || 'none'}${operation.gainDb !== null ? ` gain ${operation.gainDb.toFixed(2)} dB` : ''}${operation.sourceChannel !== null ? ` source ${operation.sourceChannel}` : ''}`)
    .join(' | ');
  const residual = report.residualByChannel
    .map((channel) => `ch${channel.channelIndex}:${channel.state} ${channel.maxAbs.toFixed(6)}/${channel.rms.toFixed(6)}`)
    .join(' | ');

  return [
    report.artifact,
    report.engine,
    report.scopeContract,
    `channels ${report.channelCount}`,
    `ops ${report.operationCount}`,
    `applied ${report.appliedOperationCount}`,
    `noop ${report.noopOperationCount}`,
    `invalid ${report.invalidOperationCount}`,
    `untouched ${report.untouchedChannelIndexes.length ? report.untouchedChannelIndexes.join('+') : 'none'}`,
    operations,
    residual,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceStereoProcedural = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.stereoProcedural;
  if (!report) {
    return fallback;
  }

  const matrix = `[${report.matrix[0].map((value) => value.toFixed(3)).join(',')};${report.matrix[1].map((value) => value.toFixed(3)).join(',')}]`;
  const routing = [
    report.routing.invertLeft ? 'invert-left' : null,
    report.routing.invertRight ? 'invert-right' : null,
    report.routing.swapLeftRight ? 'swap' : null,
    report.routing.monoMode !== 'off' ? `mono ${report.routing.monoMode}` : null,
  ].filter((part): part is string => Boolean(part)).join('+') || 'routing identity';

  return [
    report.artifact,
    report.engine,
    report.state,
    `sample ${formatRate(report.sampleRate, fallback)}`,
    `channels ${report.channelCount}`,
    `steps ${report.steps.length ? report.steps.join('->') : 'identity'}`,
    `delay ${report.delaySamples.left.toFixed(3)}/${report.delaySamples.right.toFixed(3)} samples`,
    `matrix ${matrix}`,
    routing,
    report.crossfeed.enabled
      ? `crossfeed delay ${report.crossfeed.crossDelaySamples} lowpass ${report.crossfeed.lowPassHz ?? fallback} center ${report.crossfeed.centerPreservation}`
      : 'crossfeed disabled',
    `input peak ${report.input.peak.toFixed(4)} output peak ${report.output.peak.toFixed(4)}`,
    `residual ${report.residual.state} ${report.residual.maxAbs.toFixed(6)}/${report.residual.rms.toFixed(6)}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceBlockBoundary = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.blockBoundary;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.policy,
    `block ${report.blockFrames}`,
    `input ${report.inputFrames}`,
    `channels ${report.channelCount}`,
    `blocks ${report.blockCount}`,
    `states ${report.blockStates.join('+')}`,
    `coverage ${report.coverage.state} covered ${report.coverage.coveredFrames} missing ${report.coverage.missingFrames} duplicate ${report.coverage.duplicateFrames} committed ${report.coverage.committedFrames} padded ${report.coverage.paddedFrames}`,
    `residual ${report.residual.state} ${report.residual.maxAbs.toFixed(6)}/${report.residual.rms.toFixed(6)}`,
    `boundaries ${report.boundaryCount}`,
    `introduced ${report.maxIntroducedDiscontinuity.toFixed(6)}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceBlockBoundary = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['blockBoundary'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  return report.artifact === 'block-boundary-split-reference' &&
    report.policy === 'valid-frames-committed-padding-never-output' &&
    report.blockFrames > 0 &&
    report.inputFrames > 0 &&
    report.channelCount > 0 &&
    report.blockCount > 0 &&
    report.blockStates.includes('partial-padded') &&
    report.coverage.state === 'exact' &&
    report.coverage.coveredFrames === report.inputFrames &&
    report.coverage.missingFrames === 0 &&
    report.coverage.duplicateFrames === 0 &&
    report.coverage.committedFrames === report.inputFrames &&
    report.coverage.paddedFrames >= 0 &&
    report.residual.state === 'exact-reassembly' &&
    report.residual.comparedFrames === report.inputFrames &&
    report.residual.maxAbs === 0 &&
    report.residual.rms === 0 &&
    report.maxIntroducedDiscontinuity === 0 &&
    report.reasons.includes('block_boundaries_cover_each_source_frame_once') &&
    report.reasons.includes('final_block_zero_padding_not_committed') &&
    report.reasons.includes('reassembled_output_matches_source_without_boundary_discontinuity');
};

const formatFlushDrainIntent = (
  label: string,
  intent: NonNullable<AudioStatus['uzumeReferencePlan']>['flushDrain']['naturalEof'],
  fallback: string,
): string => [
  `${label}:${intent.state}`,
  `gen ${intent.generationAfter}`,
  `tail ${intent.tailFrames}`,
  `drain ${intent.drainFrames}`,
  intent.resetRequired ? 'reset required' : 'no reset',
  intent.drainCommitAllowed ? 'drain committed' : 'drain blocked',
  `source residual ${intent.residual.sourceWindowMaxAbs.toFixed(6)}/${intent.residual.sourceWindowRms.toFixed(6)}`,
  intent.residual.drainMaxAbs !== null && intent.residual.drainRms !== null
    ? `drain residual ${intent.residual.drainMaxAbs.toFixed(6)}/${intent.residual.drainRms.toFixed(6)}`
    : 'drain residual n/a',
  intent.reasons.length ? `reasons ${intent.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
].filter((part): part is string => Boolean(part)).join(' / ');

const formatUzumeReferenceFlushDrain = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.flushDrain;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.engine,
    `generation ${report.generationId}/${report.generationState}`,
    formatFlushDrainIntent('natural-eof', report.naturalEof, fallback),
    formatFlushDrainIntent('manual-flush', report.manualFlush, fallback),
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceFlushDrain = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['flushDrain'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const natural = report.naturalEof;
  const manual = report.manualFlush;

  return natural.state === 'drain-committed' &&
    !natural.resetRequired &&
    natural.drainCommitAllowed &&
    natural.residual.sourceWindowMaxAbs === 0 &&
    natural.residual.sourceWindowRms === 0 &&
    natural.residual.drainMaxAbs === 0 &&
    natural.residual.drainRms === 0 &&
    manual.state === 'tail-dropped-and-reset' &&
    manual.resetRequired &&
    !manual.drainCommitAllowed &&
    manual.drainFrames === 0 &&
    manual.residual.sourceWindowMaxAbs === 0 &&
    manual.residual.sourceWindowRms === 0 &&
    manual.residual.drainMaxAbs === 0 &&
    manual.residual.drainRms === 0;
};

const hasZeroReferenceResidual = (residual: { maxAbs: number; rms: number }): boolean =>
  residual.maxAbs === 0 && residual.rms === 0;

const isExpectedUzumeReferenceGaplessConcat = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['gaplessConcat'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const commonContract = report.artifact === 'gapless-concat-reference' &&
    report.policy === 'source-pcm-concat-before-src' &&
    report.concatNullResidual.state === 'concat-matches-no-reset' &&
    report.concatNullResidual.comparedFrames > 0 &&
    hasZeroReferenceResidual(report.concatNullResidual) &&
    report.resetResidual.state === 'reset-vs-concat-reference' &&
    report.resetResidual.comparedFrames > 0 &&
    report.boundaryCount > 0 &&
    report.boundaries.length === report.boundaryCount &&
    report.boundaries.every((boundary) => boundary.concatVsNoResetMaxAbs === 0) &&
    report.reasons.includes('source_pcm_concat_before_src') &&
    report.reasons.includes('reset_per_track_src_compared_against_concat_reference');

  if (!commonContract) {
    return false;
  }

  if (report.state === 'same-rate-bypass') {
    return report.sourceRate === report.targetRate &&
      report.ratio === 1 &&
      hasZeroReferenceResidual(report.resetResidual) &&
      report.boundaries.every((boundary) => boundary.resetVsConcatMaxAbs === 0) &&
      report.reasons.includes('same_rate_gapless_src_exact_bypass');
  }

  return report.state === 'src-stateful' &&
    report.resetResidual.maxAbs > 0 &&
    report.resetResidual.rms > 0 &&
    report.boundaries.every((boundary) => boundary.resetVsConcatMaxAbs > 0) &&
    report.reasons.includes('src_state_must_not_reset_at_gapless_boundary');
};

const isExpectedUzumeReferenceFirGaplessHistory = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['firGaplessHistory'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const commonContract = report.artifact === 'fir-gapless-history-reference' &&
    report.policy === 'source-pcm-concat-before-fir' &&
    report.engine === 'direct-fir-float64-reference' &&
    report.concatNullResidual.state === 'concat-matches-no-reset-history' &&
    report.concatNullResidual.comparedFrames > 0 &&
    hasZeroReferenceResidual(report.concatNullResidual) &&
    report.resetResidual.state === 'reset-vs-concat-history-reference' &&
    report.resetResidual.comparedFrames > 0 &&
    report.boundaryCount > 0 &&
    report.boundaries.length === report.boundaryCount &&
    report.boundaries.every((boundary) => boundary.concatVsNoResetMaxAbs === 0) &&
    report.reasons.includes('source_pcm_concat_before_fir') &&
    report.reasons.includes('reset_per_track_fir_history_compared_against_concat_reference') &&
    report.reasons.includes('fir_gapless_reference_only');

  if (!commonContract) {
    return false;
  }

  if (report.state === 'identity-bypass') {
    return report.tailFrames === 0 &&
      report.drainFrames === 0 &&
      hasZeroReferenceResidual(report.resetResidual) &&
      report.boundaries.every((boundary) =>
        boundary.overlapHistoryFrames === 0 &&
        boundary.resetVsConcatMaxAbs === 0) &&
      report.reasons.includes('identity_fir_has_no_gapless_tail');
  }

  return report.state === 'history-required' &&
    report.tailFrames > 0 &&
    report.drainFrames > 0 &&
    report.resetResidual.maxAbs > 0 &&
    report.resetResidual.rms > 0 &&
    report.boundaries.every((boundary) =>
      boundary.overlapHistoryFrames > 0 &&
      boundary.concatVsNoResetMaxAbs === 0 &&
      boundary.resetVsConcatMaxAbs > 0) &&
    report.reasons.includes('fir_history_must_cross_gapless_boundary');
};

const formatUzumeReferenceGaplessConcat = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.gaplessConcat;
  if (!report) {
    return fallback;
  }

  const boundaries = report.boundaries
    .map((boundary) => `${boundary.beforeSegmentId}->${boundary.afterSegmentId} out ${boundary.outputFrameOffset} reset ${boundary.resetVsConcatMaxAbs.toFixed(6)} jump ${boundary.outputJump.toFixed(6)}`)
    .join(' | ');

  return [
    report.artifact,
    report.policy,
    report.state,
    `${formatRate(report.sourceRate, fallback)}->${formatRate(report.targetRate, fallback)}`,
    `ratio ${report.ratio.toFixed(6)}`,
    `segments ${report.segmentCount}`,
    `boundaries ${report.boundaryCount}`,
    `concat ${report.concatNullResidual.state} ${report.concatNullResidual.maxAbs.toFixed(6)}/${report.concatNullResidual.rms.toFixed(6)}`,
    `reset ${report.resetResidual.state} ${report.resetResidual.maxAbs.toFixed(6)}/${report.resetResidual.rms.toFixed(6)}`,
    boundaries ? `boundary ${boundaries}` : null,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatUzumeReferenceFirGaplessHistory = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.firGaplessHistory;
  if (!report) {
    return fallback;
  }

  const boundaries = report.boundaries
    .map((boundary) => `${boundary.beforeSegmentId}->${boundary.afterSegmentId} out ${boundary.outputFrameOffset} overlap ${boundary.overlapHistoryFrames} reset ${boundary.resetVsConcatMaxAbs.toFixed(6)} jump ${boundary.outputJump.toFixed(6)}`)
    .join(' | ');

  return [
    report.artifact,
    report.policy,
    report.engine,
    report.state,
    report.sourceId,
    `sample ${formatRate(report.sampleRate, fallback)}`,
    `segments ${report.segmentCount}`,
    `boundaries ${report.boundaryCount}`,
    `tail ${report.tailFrames}`,
    `drain ${report.drainFrames}`,
    `concat ${report.concatNullResidual.state} ${report.concatNullResidual.maxAbs.toFixed(6)}/${report.concatNullResidual.rms.toFixed(6)}`,
    `reset ${report.resetResidual.state} ${report.resetResidual.maxAbs.toFixed(6)}/${report.resetResidual.rms.toFixed(6)}`,
    boundaries ? `boundary ${boundaries}` : null,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const isExpectedUzumeReferenceCallbackSafeControls = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['callbackSafeControls'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const urgent = report.urgentControl;
  const volume = report.volumeControl;
  const boundary = report.renderStateBoundary;

  return report.policy === 'urgent-controls-after-committed-output' &&
    urgent.control === 'mute' &&
    urgent.classification === 'callback-safe-urgent-control' &&
    urgent.generationState === 'current' &&
    urgent.state === 'applied' &&
    urgent.callbackRule === 'read-committed-output-then-apply-urgent-control' &&
    urgent.renderCacheAction === 'preserve' &&
    !urgent.requiresRenderGraphRebuild &&
    urgent.commitAllowed &&
    urgent.declick.enabled &&
    urgent.declick.frames > 0 &&
    urgent.gainEnvelopeFrames >= urgent.declick.frames &&
    urgent.peak.output <= urgent.peak.input &&
    urgent.reasons.includes('declick_gain_ramp') &&
    volume.control === 'volume' &&
    volume.classification === 'callback-safe-urgent-control' &&
    volume.generationState === 'current' &&
    volume.state === 'applied' &&
    volume.callbackRule === 'read-committed-output-then-apply-urgent-control' &&
    volume.renderCacheAction === 'preserve' &&
    !volume.requiresRenderGraphRebuild &&
    volume.commitAllowed &&
    !volume.declick.enabled &&
    volume.declick.frames === 0 &&
    volume.gainEnvelopeFrames > 0 &&
    volume.peak.output <= volume.peak.input &&
    volume.reasons.includes('constant_gain_applied') &&
    boundary.classification === 'render-state-boundary' &&
    boundary.generationState === 'current' &&
    boundary.state === 'render-cache-invalidated' &&
    boundary.callbackRule === 'read-committed-output-only' &&
    boundary.renderCacheAction === 'invalidate-generation' &&
    boundary.generationAfterControl > urgent.generationAfterControl &&
    boundary.requiresRenderGraphRebuild &&
    !boundary.commitAllowed;
};

const isExpectedUzumeReferenceEqualPowerCrossfade = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['equalPowerCrossfade'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const rendered = report.rendered;
  const rejected = report.rejectedBoundary;

  return report.policy === 'random-access-short-bridge-to-full-profile-only' &&
    rendered.intent === 'user-random-seek-or-skip' &&
    rendered.state === 'crossfade-rendered' &&
    rendered.rejectionReason === null &&
    rendered.fadeFrames > 0 &&
    rendered.gainLaw.state === 'equal-power' &&
    rendered.gainLaw.midpointShortBridgeGain !== null &&
    rendered.gainLaw.midpointFullProfileGain !== null &&
    rendered.gainLaw.maxPowerSumError === 0 &&
    rendered.residualVsHardSwitch.state === 'measured-crossfade-difference' &&
    rendered.residualVsHardSwitch.comparedFrames > 0 &&
    rendered.residualVsHardSwitch.maxAbs !== null &&
    rendered.residualVsHardSwitch.maxAbs > 0 &&
    rendered.residualVsHardSwitch.rms !== null &&
    rendered.residualVsHardSwitch.rms > 0 &&
    rejected.intent === 'gapless-boundary' &&
    rejected.state === 'rejected' &&
    rejected.rejectionReason === 'intent_not_user_random_seek_or_skip' &&
    rejected.gainLaw.state === 'not-applicable' &&
    rejected.residualVsHardSwitch.state === 'not-applicable';
};

const formatUzumeReferencePerEarEqPlacement = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.perEarEqPlacement;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.compilerRule,
    report.state,
    `sample ${formatRate(report.sampleRate, fallback)}`,
    `order ${report.orderContract.join('->')}`,
    `per-ear ${report.perEarEq.leftGainDb.toFixed(2)}/${report.perEarEq.rightGainDb.toFixed(2)} dB`,
    report.crossfeed.enabled
      ? `crossfeed ${report.crossfeed.crossGainDb?.toFixed(2) ?? fallback} dB delay ${report.crossfeed.crossDelayMs?.toFixed(3) ?? fallback} ms lowpass ${report.crossfeed.lowPassHz ?? fallback} center ${report.crossfeed.centerPreservation}`
      : 'crossfeed disabled',
    `pre ${report.preCrossfeedSteps.join('->') || fallback}`,
    `post ${report.postCrossfeedSteps.join('->') || fallback}`,
    `residual ${report.residual.comparedFrames} frames ${report.residual.maxAbs.toFixed(6)}/${report.residual.rms.toFixed(6)}`,
    report.reasons.length ? `reasons ${report.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const hasExactStringOrder = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && expected.every((item, index) => actual[index] === item);

const hasFiniteMetrics = (...values: number[]): boolean => values.every((value) => Number.isFinite(value));

const isExpectedUzumeReferenceGainStaging = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['gainStaging'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedOrder = ['input', 'headroom', 'replaygain', 'materialized-gain', 'output'];

  return report.artifact === 'gain-staging-reference' &&
    report.engine === 'gain-reference' &&
    hasExactStringOrder(report.orderContract, expectedOrder) &&
    hasExactStringOrder(report.stages.map((stage) => stage.id), expectedOrder) &&
    !report.clipRisk &&
    report.recommendedAdditionalHeadroomDb >= 0 &&
    hasFiniteMetrics(report.totalGainDb, report.totalGainLinear, report.recommendedAdditionalHeadroomDb) &&
    report.stages.every((stage) =>
      !stage.clippingRisk &&
      hasFiniteMetrics(stage.gainDb, stage.cumulativeGainDb, stage.peak, stage.rms, stage.peakDbfs, stage.rmsDbfs)) &&
    report.reasons.includes('headroom_applied_before_replaygain_and_materialized_gain') &&
    report.reasons.includes('gain_stages_merge_to_single_gain_reference') &&
    report.reasons.includes('gain_staging_within_sample_peak_budget');
};

const isExpectedUzumeReferenceIirEq = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['iirEq'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const bandCountsMatch = report.bandCount === report.bands.length &&
    report.activeBandCount + report.bypassedBandCount === report.bandCount;
  const bandsAreCoherent = report.bands.every((band) =>
    band.index >= 0 &&
    band.frequencyHz === band.requestedFrequencyHz &&
    band.q > 0 &&
    (band.state === 'active' ? band.coefficientState === 'generated' : band.coefficientState === 'bypassed') &&
    hasFiniteMetrics(band.frequencyHz, band.requestedFrequencyHz, band.q, band.gainDb, band.responsePeakDb, band.responseDipDb, band.phaseSpanRadians));

  if (!bandCountsMatch || !bandsAreCoherent || report.artifact !== 'iir-eq-reference' || report.engine !== 'iir-reference' || report.orderContract !== 'ui-band-order-biquad-cascade') {
    return false;
  }

  if (report.state === 'exact-bypass') {
    return report.activeBandCount === 0 &&
      report.residual.state === 'exact-bypass' &&
      report.residual.maxAbs === 0 &&
      report.residual.rms === 0;
  }

  return report.activeBandCount > 0 &&
    report.residual.state === 'processed' &&
    report.residual.comparedFrames > 0 &&
    hasFiniteMetrics(report.residual.maxAbs, report.residual.rms) &&
    report.reasons.includes('peq_basic_iir_reference_only') &&
    report.reasons.includes('active_biquads_applied_in_ui_order');
};

const isExpectedUzumeReferenceChannelScope = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['channelScope'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const operationCountsMatch = report.operationCount === report.operations.length &&
    report.appliedOperationCount + report.noopOperationCount + report.invalidOperationCount === report.operationCount;
  const untouchedBypassIsExact = report.untouchedChannelIndexes.every((channelIndex) =>
    report.residualByChannel.some((channel) =>
      channel.channelIndex === channelIndex &&
      channel.state === 'out-of-scope-bypass' &&
      channel.maxAbs === 0 &&
      channel.rms === 0));

  return report.artifact === 'channel-scope-reference' &&
    report.engine === 'stereo-procedural-reference' &&
    report.scopeContract === 'targeted-channels-only' &&
    report.channelCount > 0 &&
    report.residualByChannel.length === report.channelCount &&
    operationCountsMatch &&
    report.invalidOperationCount === 0 &&
    untouchedBypassIsExact &&
    report.operations.every((operation) =>
      operation.state !== 'invalid-source' &&
      operation.targetChannels.every((channelIndex) => channelIndex >= 0 && channelIndex < report.channelCount) &&
      operation.skippedChannels.every((channelIndex) => channelIndex >= 0 && channelIndex < report.channelCount)) &&
    report.residualByChannel.every((channel) =>
      channel.channelIndex >= 0 &&
      channel.channelIndex < report.channelCount &&
      hasFiniteMetrics(channel.maxAbs, channel.rms)) &&
    report.reasons.includes('channel_scope_resolved_before_operation') &&
    report.reasons.includes('out_of_scope_channels_must_remain_exact_bypass');
};

const isExpectedUzumeReferenceStereoProcedural = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['stereoProcedural'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const matrixIsFinite = report.matrix.every((row) => row.every((value) => Number.isFinite(value)));

  if (report.artifact !== 'stereo-procedural-matrix-filter-reference' ||
    report.engine !== 'stereo-procedural-reference' ||
    report.sampleRate <= 0 ||
    report.channelCount !== 2 ||
    !matrixIsFinite ||
    !hasFiniteMetrics(report.delaySamples.left, report.delaySamples.right, report.input.peak, report.input.rms, report.output.peak, report.output.rms, report.residual.maxAbs, report.residual.rms)) {
    return false;
  }

  if (report.state === 'identity-bypass') {
    return report.steps.length === 0 &&
      report.residual.state === 'exact-bypass' &&
      report.residual.maxAbs === 0 &&
      report.residual.rms === 0;
  }

  return report.steps.length > 0 &&
    report.residual.state === 'processed' &&
    report.residual.comparedFrames > 0 &&
    report.reasons.includes('stereo_procedural_reference_only') &&
    report.reasons.includes('stereo_procedural_steps_applied_in_order');
};

const isExpectedUzumeReferencePerEarEqPlacement = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['perEarEqPlacement'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const expectedOrder = ['pre-crossfeed-eq', 'crossfeed-matrix-filter', 'post-crossfeed-eq'];

  if (report.artifact !== 'per-ear-eq-placement-reference' ||
    !hasExactStringOrder(report.orderContract, expectedOrder) ||
    report.compilerRule !== 'do-not-reorder-across-crossfeed-without-null-proof' ||
    report.sampleRate <= 0 ||
    report.residual.comparedFrames <= 0 ||
    !hasFiniteMetrics(report.perEarEq.leftGainDb, report.perEarEq.rightGainDb, report.residual.maxAbs, report.residual.rms)) {
    return false;
  }

  if (report.state === 'commutative-for-input') {
    return report.residual.maxAbs === 0 && report.residual.rms === 0;
  }

  return report.crossfeed.enabled &&
    report.crossfeed.crossGainDb !== null &&
    report.crossfeed.crossDelayMs !== null &&
    report.preCrossfeedSteps.includes('pre-per-ear-eq') &&
    report.preCrossfeedSteps.includes('crossfeed') &&
    report.postCrossfeedSteps.includes('crossfeed') &&
    report.postCrossfeedSteps.includes('post-per-ear-eq') &&
    report.residual.maxAbs > 0 &&
    report.residual.rms > 0 &&
    report.reasons.includes('crossfeed_and_asymmetric_per_ear_eq_are_not_commutative') &&
    report.reasons.includes('do_not_reorder_across_crossfeed_without_null_proof') &&
    report.reasons.includes('per_ear_eq_placement_reference_only');
};

const formatCallbackSafeCase = (
  label: string,
  control: NonNullable<AudioStatus['uzumeReferencePlan']>['callbackSafeControls']['urgentControl'],
  fallback: string,
): string => [
  `${label}:${control.control}:${control.state}`,
  control.classification,
  control.callbackRule,
  `cache ${control.renderCacheAction}`,
  `gen ${control.generationAfterControl}`,
  control.requiresRenderGraphRebuild ? 'rebuild required' : 'no rebuild',
  control.commitAllowed ? 'commit allowed' : 'commit blocked',
  `declick ${control.declick.enabled ? 'enabled' : 'off'} ${control.declick.frames} frames ${control.declick.startGain.toFixed(3)}->${control.declick.endGain.toFixed(3)} step ${control.declick.maxStep.toFixed(6)}`,
  `envelope ${control.gainEnvelopeFrames}`,
  `peak ${control.peak.input.toFixed(6)}->${control.peak.output.toFixed(6)}`,
  control.reasons.length ? `reasons ${control.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
].filter((part): part is string => Boolean(part)).join(' / ');

const formatUzumeReferenceCallbackSafeControls = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.callbackSafeControls;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.policy,
    formatCallbackSafeCase('urgent', report.urgentControl, fallback),
    formatCallbackSafeCase('volume', report.volumeControl, fallback),
    formatCallbackSafeCase('boundary', report.renderStateBoundary, fallback),
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatCrossfadeCase = (
  label: string,
  crossfade: NonNullable<AudioStatus['uzumeReferencePlan']>['equalPowerCrossfade']['rendered'],
  fallback: string,
): string => [
  `${label}:${crossfade.intent}:${crossfade.state}`,
  crossfade.rejectionReason ? `reject ${normalizeReason(crossfade.rejectionReason, fallback)}` : 'accepted',
  `sample ${formatRate(crossfade.sampleRate, fallback)}`,
  `fade ${crossfade.fadeFrames} frames/${crossfade.durationMs.toFixed(3)} ms`,
  `gain ${crossfade.gainLaw.state}`,
  crossfade.gainLaw.midpointShortBridgeGain !== null && crossfade.gainLaw.midpointFullProfileGain !== null
    ? `mid ${crossfade.gainLaw.midpointShortBridgeGain.toFixed(6)}/${crossfade.gainLaw.midpointFullProfileGain.toFixed(6)}`
    : 'mid n/a',
  `power error ${crossfade.gainLaw.maxPowerSumError.toFixed(6)}`,
  crossfade.residualVsHardSwitch.maxAbs !== null && crossfade.residualVsHardSwitch.rms !== null
    ? `residual ${crossfade.residualVsHardSwitch.state} ${crossfade.residualVsHardSwitch.maxAbs.toFixed(6)}/${crossfade.residualVsHardSwitch.rms.toFixed(6)}`
    : `residual ${crossfade.residualVsHardSwitch.state}`,
  `peak ${crossfade.peak.shortBridge.toFixed(6)}/${crossfade.peak.fullProfile.toFixed(6)}/${crossfade.peak.output.toFixed(6)}`,
  crossfade.reasons.length ? `reasons ${crossfade.reasons.map((reason) => normalizeReason(reason, fallback)).join(' | ')}` : null,
].filter((part): part is string => Boolean(part)).join(' / ');

const formatUzumeReferenceEqualPowerCrossfade = (status: AudioStatus | null, fallback: string): string => {
  const report = status?.uzumeReferencePlan?.equalPowerCrossfade;
  if (!report) {
    return fallback;
  }

  return [
    report.artifact,
    report.policy,
    formatCrossfadeCase('rendered', report.rendered, fallback),
    formatCrossfadeCase('rejected-boundary', report.rejectedBoundary, fallback),
  ].filter((part): part is string => Boolean(part)).join(' / ');
};

const formatIssueReason = (
  value: string,
  fallback: string,
  formatSharedMixRateTooHigh: (decoderRate: number, deviceRate: number) => string,
  formatWindowsAudioDefaultFormatUnusual: (deviceRate: number) => string,
): string => {
  const sharedMixRateMatch = /^shared_output_mix_rate_too_high:(\d+)->(\d+)$/u.exec(value);
  const windowsAudioDefaultFormatMatch = /^windows_audio_default_format_unusual:(\d+)$/u.exec(value);
  const echoSrcActiveMatch = /^echo_src_active:(\d+)->(\d+)$/u.exec(value);

  if (sharedMixRateMatch) {
    return formatSharedMixRateTooHigh(Number(sharedMixRateMatch[1]), Number(sharedMixRateMatch[2]));
  }

  if (echoSrcActiveMatch) {
    return `ECHO/SOXR SRC (compat) ${formatRate(Number(echoSrcActiveMatch[1]), fallback)} -> ${formatRate(Number(echoSrcActiveMatch[2]), fallback)}`;
  }

  if (windowsAudioDefaultFormatMatch) {
    return formatWindowsAudioDefaultFormatUnusual(Number(windowsAudioDefaultFormatMatch[1]));
  }

  if (value === 'echo_src_bit_perfect_disabled') {
    return 'ECHO/SOXR SRC compatibility path disables bit-perfect output.';
  }

  if (value === 'echo_src_bypassed_in_shared_output') {
    return 'ECHO/SOXR SRC compatibility path is bypassed in shared output; the system mixer rate is used.';
  }

  if (value === 'echo_src_bypassed_in_non_direct_output') {
    return 'ECHO/SOXR SRC compatibility path is bypassed outside ASIO or Exclusive output.';
  }

  if (value === 'echo_src_bypassed_for_dsd_direct' || value === 'echo_src_bypassed_for_dsd_pcm') {
    return 'ECHO/SOXR SRC compatibility path is bypassed for DSD playback.';
  }

  return normalizeReason(value, fallback);
};

const formatRate = (value: number | null | undefined, unknown: string): string => {
  if (!value || !Number.isFinite(value)) {
    return unknown;
  }

  if (value >= 1000) {
    return `${trimTrailingZero((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} kHz`;
  }

  return `${Math.round(value)} Hz`;
};

const formatBitDepth = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value)} bit` : unknown;

const formatBitrate = (value: number | null | undefined, unknown: string): string =>
  value && Number.isFinite(value) ? `${Math.round(value / 1000)} kbps` : unknown;

const formatChannels = (value: number | null | undefined, unknown: string): string =>
  formatAudioChannelLayout(value) ?? unknown;

const formatFrames = (value: number | null | undefined, unknown: string): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} frames` : unknown;

const formatMs = (value: number | null | undefined, unknown: string): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} ms` : unknown;

const formatFractionalMs = (value: number | null | undefined, unknown: string): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return unknown;
  }
  if (Math.abs(value) < 0.005) {
    return '0 ms';
  }
  return `${trimTrailingZero(value.toFixed(value < 10 ? 2 : 1))} ms`;
};

const formatDb = (value: number | null | undefined, unknown: string): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)} dB` : unknown;

const formatUzumeReferenceContinuity = (status: AudioStatus | null, fallback: string): string => {
  const continuity = status?.uzumeReferencePlan?.continuity?.continuity;
  if (!continuity) {
    return fallback;
  }

  const shortBridge = continuity.shortBridgeAllowed
    ? 'short bridge allowed'
    : `short bridge blocked ${normalizeReason(continuity.shortBridgeReason, fallback)}`;

  return `${continuity.policy} / ${continuity.intent}->${continuity.selectedPath} / ${continuity.callbackRule} / wait ${continuity.waitTarget} / ${shortBridge} / rollback ${continuity.qualityRollback}`;
};

const formatUzumeReferencePreRoll = (status: AudioStatus | null, fallback: string): string => {
  const preRoll = status?.uzumeReferencePlan?.continuity?.preRoll;
  if (!preRoll) {
    return fallback;
  }

  return `${preRoll.state} / required ${formatFrames(preRoll.preRollRequiredFrames, fallback)} / slack ${formatFrames(preRoll.deadlineSlackFrames, fallback)} / render-ahead ${preRoll.renderAheadState} ${preRoll.renderAheadReadyFrames}/${preRoll.renderAheadTargetFrames} / ring ${formatFrames(preRoll.outputRingDepthFrames, fallback)} / ${preRoll.handoffStrategy} / ${preRoll.commitAllowed ? 'commit ready' : 'commit waits full profile'}`;
};

const formatUzumeReferenceCallbackRing = (status: AudioStatus | null, fallback: string): string => {
  const ring = status?.uzumeReferencePlan?.continuity?.callbackRing;
  if (!ring) {
    return fallback;
  }

  return `${ring.state} / ${ring.telemetryStatus} / depth ${formatFrames(ring.depthFrames, fallback)} / ${ring.depthBlocks.toFixed(1)} blocks / block ${formatFrames(ring.callbackBlockFrames, fallback)} / missing ${formatFrames(ring.missingFrames, fallback)} / ${ring.readRule} / no GPU wait`;
};

const formatUzumeReferenceRenderAheadCache = (status: AudioStatus | null, fallback: string): string => {
  const cache = status?.uzumeReferencePlan?.continuity?.renderAheadCache;
  if (!cache) {
    return fallback;
  }

  return `${cache.lookupState}->${cache.commitState} / key ${cache.requestKey} / cache ${cache.bytesAfterEvict}/${cache.budgetBytes} bytes / retained ${cache.retainedKeys.length ? cache.retainedKeys.join('+') : 'none'} / evictions ${cache.evictionCount} / ${cache.callbackRule} / no GPU wait`;
};

const formatUzumeReferenceUnderrunFallback = (status: AudioStatus | null, fallback: string): string => {
  const fallbackReference = status?.uzumeReferencePlan?.continuity?.fallback;
  if (!fallbackReference) {
    return fallback;
  }

  return `${fallbackReference.state} / source ${fallbackReference.selectedSource ?? 'none'} / ${fallbackReference.telemetryStatus} / rollback ${fallbackReference.qualityRollback} / ${fallbackReference.fallbackInjected ? 'fallback injected' : 'full-profile commit'} / no GPU wait / short bridge blocked ${normalizeReason(fallbackReference.shortBridgeReason, fallback)}`;
};

const isExpectedUzumeReferenceContinuity = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['continuity'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  const continuity = report.continuity;
  const preRoll = report.preRoll;
  const ring = report.callbackRing;
  const cache = report.renderAheadCache;
  const fallback = report.fallback;

  const continuityContract = report.artifact === 'continuity-telemetry-reference' &&
    report.policy === 'callback-read-committed-reference' &&
    continuity.artifact === 'continuity-quality-policy-reference' &&
    continuity.callbackRule === 'read-committed-output-only' &&
    !continuity.shortBridgeAllowed &&
    continuity.shortBridgeReason !== null &&
    continuity.qualityRollback === 'none' &&
    !continuity.commitAllowed &&
    continuity.waitTarget !== 'none';
  const preRollContract = preRoll.artifact === 'pre-roll-deadline-reference' &&
    (preRoll.state === 'ready' || preRoll.state === 'deadline-safe' || preRoll.state === 'start-pre-roll-now') &&
    preRoll.preRollRequiredFrames >= 0 &&
    preRoll.framesUntilBoundary >= 0 &&
    preRoll.deadlineSlackFrames >= 0 &&
    preRoll.renderAheadTargetFrames >= preRoll.renderAheadReadyFrames &&
    preRoll.renderAheadReadyFrames >= 0 &&
    preRoll.callbackBlockFrames > 0 &&
    preRoll.outputRingDepthFrames >= 0 &&
    preRoll.readRule === 'read-committed-output-only' &&
    preRoll.mustNotWaitForGpu &&
    !preRoll.shortBridgeAllowed;
  const ringContract = ring.artifact === 'cpu-callback-ring-reference' &&
    ring.state === 'stable' &&
    ring.telemetryStatus === 'safe' &&
    ring.capacityFrames >= ring.depthFrames &&
    ring.depthFrames >= ring.callbackBlockFrames &&
    ring.depthBlocks > 0 &&
    ring.missingFrames === 0 &&
    ring.readRule === 'read-committed-output-only' &&
    ring.mustNotWaitForGpu &&
    !ring.shortBridgeAllowed &&
    ring.shortBridgeReason === 'cpu_only_ring_does_not_enable_short_bridge';
  const cacheCommitMatchesState = cache.commitState === 'commit-to-callback-slot'
    ? cache.commitAllowed
    : !cache.commitAllowed;
  const cacheContract = cache.artifact === 'render-ahead-cache-reference' &&
    cache.requestKey.length > 0 &&
    cache.budgetBytes >= 0 &&
    cache.bytesBeforeEvict >= 0 &&
    cache.bytesAfterEvict >= 0 &&
    cache.evictionCount >= 0 &&
    cacheCommitMatchesState &&
    cache.callbackRule === 'read-committed-output-only' &&
    cache.mustNotWaitForGpu;
  const fallbackContract = fallback.artifact === 'fallback-injection-underrun-reference' &&
    fallback.telemetryStatus !== 'unsafe' &&
    fallback.callbackMustNotWaitForGpu &&
    !fallback.shortBridgeAllowed &&
    fallback.shortBridgeReason === 'underrun_protection_does_not_enable_short_bridge' &&
    ((fallback.state === 'gpu-render-ahead-commit' && fallback.selectedSource === 'gpu-render-ahead' && fallback.commitAllowed && !fallback.fallbackInjected && fallback.qualityRollback === 'none') ||
      (fallback.state === 'cpu-main-chain-fallback' && fallback.selectedSource === 'cpu-main-chain' && fallback.commitAllowed && fallback.fallbackInjected && fallback.qualityRollback === 'controlled-fallback') ||
      (fallback.state === 'prior-committed-fallback' && fallback.selectedSource === 'prior-committed' && fallback.commitAllowed && fallback.fallbackInjected && fallback.qualityRollback === 'controlled-fallback'));

  return continuityContract && preRollContract && ringContract && cacheContract && fallbackContract;
};

const joinedWarnings = (warnings: string[] | undefined, unknown: string): string =>
  warnings?.length ? warnings.join(', ') : unknown;

const isUzumeGpuBackend = (backend: string | null | undefined): boolean =>
  typeof backend === 'string' && (backend === 'gpu-cuda' || backend.includes('gpu'));

export const AudioProfessionalStatusPanel = ({ status, variant = 'drawer' }: AudioProfessionalStatusPanelProps): JSX.Element => {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const unknown = t('audioProfessional.value.unknown');
  const enabled = t('audioProfessional.value.enabled');
  const disabled = t('audioProfessional.value.disabled');
  const yes = t('audioProfessional.value.yes');
  const no = t('audioProfessional.value.no');

  const bitPerfectText = status?.bitPerfectCandidate
    ? t('audioProfessional.value.ready')
    : status?.bitPerfectDisabledReason
      ? formatBitPerfectReason(status.bitPerfectDisabledReason, unknown)
      : status?.outputMode === 'shared'
        ? t('audioProfessional.value.sharedMixer')
        : t('audioProfessional.value.pending');

  const playbackSummary = status
    ? `${status.outputMode} / ${formatRate(status.actualDeviceSampleRate ?? status.requestedOutputSampleRate, unknown)} / ${bitPerfectText}`
    : t('audioProfessional.summary.pending');
  const dspHeadroomActive = Boolean(status?.dspActive && Math.abs(status.dspHeadroomDb ?? 0) > 0.05);
  const dspModules = [
    dspHeadroomActive ? `${t('audioProfessional.signal.headroom')} ${formatDb(status?.dspHeadroomDb, unknown)}` : null,
    status?.eqEnabled ? t('audioProfessional.row.eq') : null,
    status?.roomCorrectionEnabled ? t('audioProfessional.signal.fir') : null,
    status?.channelBalanceEnabled ? t('audioProfessional.row.channelBalance') : null,
    status?.echoSrcActive ? `ECHO/SOXR SRC (compat) ${formatRate(status.echoSrcTargetSampleRate, unknown)}` : null,
    status?.replayGainEnabled ? t('audioProfessional.row.replayGain') : null,
    status?.dspLimiterProtecting ? t('audioProfessional.badge.protect') : null,
  ].filter((module): module is string => Boolean(module));
  const signalPathText = status
    ? dspModules.length
      ? t('audioProfessional.value.dspPath', { modules: dspModules.join(' -> ') })
      : t('audioProfessional.value.nativePath')
    : unknown;
  const signalPathNodes: SignalPathNode[] = [
    {
      eyebrow: t('audioProfessional.signal.source'),
      label: status?.codec ?? formatRate(status?.fileSampleRate, unknown),
      tone: status ? 'good' : 'muted',
    },
    {
      eyebrow: t('audioProfessional.signal.decode'),
      label: status?.activeDecodeBackendImpl ?? status?.outputBackend ?? unknown,
      tone: status ? 'good' : 'muted',
    },
    {
      eyebrow: dspModules.length ? t('audioProfessional.signal.dsp') : t('audioProfessional.signal.native'),
      label: signalPathText,
      tone: status?.dspLimiterProtecting ? 'danger' : dspModules.length ? 'warning' : status ? 'good' : 'muted',
    },
    {
      eyebrow: t('audioProfessional.signal.output'),
      label: status?.outputDeviceName ?? status?.outputMode ?? t('audioProfessional.value.systemDefault'),
      tone: status?.sampleRateMismatch ? 'danger' : status ? 'good' : 'muted',
    },
  ];
  const protectLimiterText = status?.dspLimiterProtecting
    ? enabled
    : status?.dspClippingRisk
      ? t('audioProfessional.value.pending')
      : disabled;
  const uzumeGpuText = status?.uzumeGpuAvailable
    ? status.uzumeGpuDevice ?? enabled
    : status?.uzumeGpuCompiled
      ? status.uzumeFallbackReason ?? disabled
      : disabled;
  const uzumeCufftText = status?.uzumeGpuCufftAvailable
    ? status.uzumeCufftVersion ? String(status.uzumeCufftVersion) : enabled
    : status?.uzumeGpuCompiled
      ? status.uzumeCufftFallbackReason ?? disabled
      : disabled;
  const uzumeBitPerfectText = status?.uzumeBitPerfectState
    ? status.uzumeDirectDisabledReason
      ? `${status.uzumeBitPerfectState} / ${formatBitPerfectReason(status.uzumeDirectDisabledReason, unknown)}`
      : status.uzumeBitPerfectState
    : unknown;
  const uzumeFormatPathText = formatUzumeFormatPath(status, unknown);
  const uzumeReferenceCompilerText = formatUzumeReferenceCompiler(status, unknown);
  const uzumeReferenceAssignmentsText = formatUzumeReferenceAssignments(status, unknown);
  const uzumeReferenceMergeGroupsText = formatUzumeReferenceMergeGroups(status, unknown);
  const uzumeReferenceLatencyOwnersText = formatUzumeReferenceLatencyOwners(status, unknown);
  const expectedUzumeReferenceCompiler = isExpectedUzumeReferenceCompiler(status?.uzumeReferencePlan);
  const expectedUzumeReferenceBackendSupport = isExpectedUzumeReferenceBackendSupport(status?.uzumeReferencePlan?.backendSupport);
  const expectedUzumeReferenceOutputDevicePolicy = isExpectedUzumeReferenceOutputDevicePolicy(status?.uzumeReferencePlan?.outputDevicePolicy);
  const expectedUzumeReferenceLatencyBudget = isExpectedUzumeReferenceLatencyBudget(status?.uzumeReferencePlan?.latencyBudget);
  const expectedUzumeReferenceReadinessContract = isExpectedUzumeReferenceReadinessContract(status?.uzumeReferencePlan?.readinessContract);
  const expectedUzumeReferenceGenerationCacheKey = isExpectedUzumeReferenceGenerationCacheKey(status?.uzumeReferencePlan?.generationCacheKey);
  const uzumeReferenceArtifactManifest = buildUzumeReferenceArtifactManifestSummary(status?.uzumeReferencePlan?.artifactPlan);
  const uzumeReferenceArtifactManifestText = formatUzumeReferenceArtifactManifest(status, unknown);
  const uzumeReferenceBitPerfectText = formatUzumeReferenceBitPerfect(status, unknown);
  const uzumeReferenceBackendSupportText = formatUzumeReferenceBackendSupport(status, unknown);
  const uzumeReferenceOutputDevicePolicyText = formatUzumeReferenceOutputDevicePolicy(status, unknown);
  const uzumeReferenceLatencyBudgetText = formatUzumeReferenceLatencyBudget(status, unknown);
  const uzumeReferenceReadinessContractText = formatUzumeReferenceReadinessContract(status, unknown);
  const uzumeReferenceGenerationCacheKeyText = formatUzumeReferenceGenerationCacheKey(status, unknown);
  const uzumeReferenceRealtimeBudgetSummaryText = formatUzumeReferenceRealtimeBudgetSummary(status, unknown);
  const expectedUzumeReferenceRealtimeBudgetSummary = isExpectedUzumeReferenceRealtimeBudgetSummary(status?.uzumeReferencePlan?.realtimeBudgetSummary);
  const uzumeReferenceResamplingText = formatUzumeReferenceResampling(status, unknown);
  const expectedUzumeReferenceResampling = isExpectedUzumeReferenceResampling(status?.uzumeReferencePlan?.resampling);
  const uzumeReferenceSrcRollbackText = formatUzumeReferenceSrcRollback(status, unknown);
  const uzumeReferenceSrcBudgetText = formatUzumeReferenceSrcBudget(status, unknown);
  const uzumeReferenceSrcArtifactsText = formatUzumeReferenceSrcArtifacts(status, unknown);
  const uzumeReferenceSrcValidationText = formatUzumeReferenceSrcValidation(status, unknown);
  const expectedUzumeReferenceSrcBudget = isExpectedUzumeReferenceSrcBudget(status?.uzumeReferencePlan?.resampling);
  const expectedUzumeReferenceSrcValidation = isExpectedUzumeReferenceSrcValidation(status?.uzumeReferencePlan?.resampling.validation);
  const uzumeReferenceSrcOutputRiskText = formatUzumeReferenceSrcOutputRisk(status, unknown);
  const uzumeReferenceSrcPhaseApodizingText = formatUzumeReferenceSrcPhaseApodizing(status, unknown);
  const uzumeReferenceDsdFamilyText = formatUzumeReferenceDsdFamily(status, unknown);
  const expectedUzumeReferenceDsdFamily = isExpectedUzumeReferenceDsdFamily(status?.uzumeReferencePlan?.dsdFamily);
  const uzumeReferenceConvolutionText = formatUzumeReferenceConvolution(status, unknown);
  const expectedUzumeReferenceConvolution = isExpectedUzumeReferenceConvolution(status?.uzumeReferencePlan?.sharedConvolution);
  const uzumeReferenceResponseResampleText = formatUzumeReferenceResponseResample(status, unknown);
  const uzumeReferenceConvolutionDuplicateGuardText = formatUzumeReferenceConvolutionDuplicateGuard(status, unknown);
  const uzumeReferenceConvolutionSerialNullText = formatUzumeReferenceConvolutionSerialNull(status, unknown);
  const expectedUzumeReferenceConvolutionSerialNull = isExpectedUzumeReferenceConvolutionSerialNull(status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference);
  const uzumeReferencePcmOutputQuantizationText = formatUzumeReferencePcmOutputQuantization(status, unknown);
  const uzumeReferencePcmIngressGuardText = formatUzumeReferencePcmIngressGuard(status, unknown);
  const expectedUzumeReferencePcmIngressGuard = isExpectedUzumeReferencePcmIngressGuard(status?.uzumeReferencePlan?.pcmIngressGuard);
  const uzumeReferenceGainStagingText = formatUzumeReferenceGainStaging(status, unknown);
  const uzumeReferenceIirEqText = formatUzumeReferenceIirEq(status, unknown);
  const uzumeReferenceChannelScopeText = formatUzumeReferenceChannelScope(status, unknown);
  const uzumeReferenceStereoProceduralText = formatUzumeReferenceStereoProcedural(status, unknown);
  const uzumeReferencePerEarEqPlacementText = formatUzumeReferencePerEarEqPlacement(status, unknown);
  const expectedUzumeReferenceGainStaging = isExpectedUzumeReferenceGainStaging(status?.uzumeReferencePlan?.gainStaging);
  const expectedUzumeReferenceIirEq = isExpectedUzumeReferenceIirEq(status?.uzumeReferencePlan?.iirEq);
  const expectedUzumeReferenceChannelScope = isExpectedUzumeReferenceChannelScope(status?.uzumeReferencePlan?.channelScope);
  const expectedUzumeReferenceStereoProcedural = isExpectedUzumeReferenceStereoProcedural(status?.uzumeReferencePlan?.stereoProcedural);
  const expectedUzumeReferencePerEarEqPlacement = isExpectedUzumeReferencePerEarEqPlacement(status?.uzumeReferencePlan?.perEarEqPlacement);
  const uzumeReferenceBlockBoundaryText = formatUzumeReferenceBlockBoundary(status, unknown);
  const expectedUzumeReferenceBlockBoundary = isExpectedUzumeReferenceBlockBoundary(status?.uzumeReferencePlan?.blockBoundary);
  const uzumeReferenceFlushDrainText = formatUzumeReferenceFlushDrain(status, unknown);
  const uzumeReferenceGaplessConcatText = formatUzumeReferenceGaplessConcat(status, unknown);
  const uzumeReferenceFirGaplessHistoryText = formatUzumeReferenceFirGaplessHistory(status, unknown);
  const uzumeReferenceCallbackSafeControlsText = formatUzumeReferenceCallbackSafeControls(status, unknown);
  const uzumeReferenceEqualPowerCrossfadeText = formatUzumeReferenceEqualPowerCrossfade(status, unknown);
  const uzumeReferenceContinuityText = formatUzumeReferenceContinuity(status, unknown);
  const uzumeReferencePreRollText = formatUzumeReferencePreRoll(status, unknown);
  const uzumeReferenceCallbackRingText = formatUzumeReferenceCallbackRing(status, unknown);
  const uzumeReferenceRenderAheadCacheText = formatUzumeReferenceRenderAheadCache(status, unknown);
  const uzumeReferenceUnderrunFallbackText = formatUzumeReferenceUnderrunFallback(status, unknown);
  const expectedUzumeReferenceContinuity = isExpectedUzumeReferenceContinuity(status?.uzumeReferencePlan?.continuity);
  const planned = 'Planned / not implemented';
  const transitional = 'Transitional';
  const uzumeHeadroomTelemetryText = status
    ? Math.abs(status.dspHeadroomDb ?? 0) > 0.05 || status.uzumeHeadroomActive
      ? `${formatDb(status.dspHeadroomDb, unknown)} / gain-reference / ${status.uzumeHeadroomActive ? enabled : 'reference pending'}`
      : disabled
    : unknown;
  const uzumeSafetyMeterText = status
    ? `${status.dspLimiterProtecting ? 'limiting' : status.dspClippingRisk ? 'near-limit' : 'monitoring'} / ${status.dspClippingRisk || status.dspLimiterProtecting ? 'clipping risk' : 'safe'} / stage telemetry separate from limiter`
    : unknown;
  const uzumeLimiterReferenceText = status
    ? `sample-domain safety limiter / ${status.dspLimiterProtecting ? 'active' : 'standby'} / GPU limiter ${status.uzumeGpuLimiterPlaybackActive ? enabled : planned}`
    : unknown;

  const issueReasons = useMemo(() => (
    [status?.error, ...(status?.warnings ?? [])]
      .filter((reason): reason is string => Boolean(reason?.trim()))
      .map((reason) => {
        if (reason === 'room_correction_bit_perfect_disabled') {
          return t('audioProfessional.issue.roomCorrectionBitPerfectDisabled');
        }

        if (reason === 'room_correction_clipping_risk') {
          return t('audioProfessional.issue.roomCorrectionClippingRisk');
        }

        if (reason === 'dsp_limiter_protecting') {
          return t('audioProfessional.issue.dspLimiterProtecting');
        }

        if (reason === 'dsp_clipping_risk') {
          return t('audioProfessional.issue.dspClippingRisk');
        }

        if (reason === 'audio_level_clipping_risk') {
          return t('audioProfessional.issue.audioLevelClippingRisk');
        }

        if (reason === 'audio_level_clipped') {
          return t('audioProfessional.issue.audioLevelClipped');
        }

        return formatIssueReason(
          reason,
          unknown,
          (decoderRate, deviceRate) => t('audioProfessional.issue.sharedMixRateTooHigh', {
            decoderRate: formatRate(decoderRate, unknown),
            deviceRate: formatRate(deviceRate, unknown),
          }),
          (deviceRate) => t('audioProfessional.issue.windowsDefaultFormatUnusual', {
            deviceRate: formatRate(deviceRate, unknown),
          }),
        );
      })
  ), [status, t, unknown]);

  const badges = useMemo<ProfessionalStatusBadge[]>(() => {
    const nextBadges: ProfessionalStatusBadge[] = [];

    if (status?.bitPerfectCandidate) {
      nextBadges.push({ label: t('audioProfessional.badge.bitPerfect'), tone: 'good' });
    }
    if (status?.resampling) {
      nextBadges.push({ label: t(status.echoSrcActive ? 'audioProfessional.badge.upsampling' : 'audioProfessional.badge.resampling'), tone: 'warning' });
    }
    if (status?.dspActive || status?.eqEnabled || status?.roomCorrectionEnabled || status?.channelBalanceEnabled) {
      nextBadges.push({ label: t('audioProfessional.badge.dsp'), tone: 'warning' });
    }
    if (status?.uzumeBackend) {
      nextBadges.push({ label: isUzumeGpuBackend(status.uzumeBackend) ? 'UZUME GPU' : 'UZUME', tone: status.uzumeFallbackActive ? 'warning' : 'neutral' });
    }
    if (status?.dspLimiterProtecting) {
      nextBadges.push({ label: t('audioProfessional.badge.protect'), tone: 'warning' });
    }
    if (status?.replayGainEnabled) {
      nextBadges.push({ label: t('audioProfessional.badge.replayGain'), tone: 'neutral' });
    }
    if (status?.sampleRateMismatch) {
      nextBadges.push({ label: t('audioProfessional.badge.sampleMismatch'), tone: 'danger' });
    }
    if (issueReasons.length) {
      nextBadges.push({ label: t('audioProfessional.badge.warning'), tone: status?.error ? 'danger' : 'warning' });
    }

    return nextBadges;
  }, [issueReasons.length, status, t]);

  const sections = useMemo<ProfessionalStatusSection[]>(() => [
    {
      title: t('audioProfessional.group.playbackChain'),
      icon: Activity,
      rows: [
        { label: t('audioProfessional.row.state'), value: status?.state ?? unknown },
        { label: t('audioProfessional.row.outputMode'), value: status?.outputMode ?? unknown },
        { label: t('audioProfessional.row.outputDevice'), value: status?.outputDeviceName ?? t('audioProfessional.value.systemDefault') },
        { label: t('audioProfessional.row.outputBackend'), value: status?.outputBackend ?? status?.outputDeviceType ?? unknown },
        { label: t('audioProfessional.row.decodeBackend'), value: status?.activeDecodeBackendImpl ?? unknown },
        { label: t('audioProfessional.row.codec'), value: status?.codec ?? unknown },
        { label: t('audioProfessional.row.channels'), value: formatChannels(status?.channels, unknown) },
        { label: t('audioProfessional.row.bitDepth'), value: formatBitDepth(status?.bitDepth, unknown) },
        { label: t('audioProfessional.row.bitrate'), value: formatBitrate(status?.bitrate, unknown) },
      ],
    },
    {
      title: t('audioProfessional.group.sampleRate'),
      icon: RadioTower,
      rows: [
        { label: t('audioProfessional.row.fileSampleRate'), value: formatRate(status?.fileSampleRate, unknown) },
        { label: t('audioProfessional.row.decoderOutputSampleRate'), value: formatRate(status?.decoderOutputSampleRate, unknown) },
        { label: t('audioProfessional.row.requestedOutputSampleRate'), value: formatRate(status?.requestedOutputSampleRate, unknown) },
        { label: t('audioProfessional.row.actualDeviceSampleRate'), value: formatRate(status?.actualDeviceSampleRate, unknown) },
        { label: t('audioProfessional.row.sharedDeviceSampleRate'), value: formatRate(status?.sharedDeviceSampleRate, unknown) },
        { label: t('audioProfessional.row.resampler'), value: status?.resamplerEngine ?? 'default' },
        { label: t('audioProfessional.row.soxr'), value: status?.soxrAvailable ? yes : no },
      ],
    },
    {
      title: t('audioProfessional.group.directDsp'),
      icon: SlidersHorizontal,
      rows: [
        { label: t('audioProfessional.row.signalPath'), value: signalPathText, tone: dspModules.length ? 'warning' : 'good' },
        { label: t('audioProfessional.row.bitPerfect'), value: bitPerfectText, tone: status?.bitPerfectCandidate ? 'good' : 'muted' },
        { label: t(status?.echoSrcActive ? 'audioProfessional.row.upsampling' : 'audioProfessional.row.resampling'), value: status?.resampling ? yes : no, tone: status?.resampling ? 'warning' : 'good' },
        { label: t('audioProfessional.row.sampleRateMismatch'), value: status?.sampleRateMismatch ? yes : no, tone: status?.sampleRateMismatch ? 'danger' : 'good' },
        { label: t('audioProfessional.row.eq'), value: status?.eqEnabled ? enabled : disabled, tone: status?.eqEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.roomCorrection'), value: status?.roomCorrectionEnabled ? enabled : disabled, tone: status?.roomCorrectionEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.channelBalance'), value: status?.channelBalanceEnabled ? enabled : disabled, tone: status?.channelBalanceEnabled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeBackend'), value: status?.uzumeBackend ?? disabled, tone: status?.uzumeFallbackActive ? 'warning' : isUzumeGpuBackend(status?.uzumeBackend) ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeProfile'), value: status?.uzumeProfile ?? unknown },
        { label: t('audioProfessional.row.uzumeRuntime'), value: status?.uzumeRuntimeModel ?? unknown },
        { label: t('audioProfessional.row.uzumeFormatPath'), value: uzumeFormatPathText, tone: status?.uzumeFormatPath === 'pcm_processed' ? 'warning' : status?.uzumeFormatPath === 'pcm_bitperfect' || status?.uzumeFormatPath === 'dsd_direct' ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumePathPlan'), value: formatUzumePathPlan(status, unknown), tone: status?.uzumeFormatPathPlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceCompiler'), value: uzumeReferenceCompilerText, tone: expectedUzumeReferenceCompiler ? 'good' : status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceAssignments'), value: uzumeReferenceAssignmentsText, tone: expectedUzumeReferenceCompiler ? 'good' : status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceMergeGroups'), value: uzumeReferenceMergeGroupsText, tone: expectedUzumeReferenceCompiler ? 'good' : status?.uzumeReferencePlan?.mergeGroups.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceLatencyOwners'), value: uzumeReferenceLatencyOwnersText, tone: expectedUzumeReferenceCompiler ? 'good' : Object.keys(status?.uzumeReferencePlan?.latencyOwners ?? {}).length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceArtifactManifest'), value: uzumeReferenceArtifactManifestText, tone: uzumeReferenceArtifactManifest?.hasPlanned ? 'warning' : uzumeReferenceArtifactManifest ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBitPerfect'), value: uzumeReferenceBitPerfectText, tone: status?.uzumeReferencePlan?.bitPerfectState === 'available' ? 'good' : status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBackendSupport'), value: uzumeReferenceBackendSupportText, tone: expectedUzumeReferenceBackendSupport ? 'good' : status?.uzumeReferencePlan?.backendSupport ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceOutputDevicePolicy'), value: uzumeReferenceOutputDevicePolicyText, tone: expectedUzumeReferenceOutputDevicePolicy ? 'good' : status?.uzumeReferencePlan?.outputDevicePolicy ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceLatencyBudget'), value: uzumeReferenceLatencyBudgetText, tone: expectedUzumeReferenceLatencyBudget ? 'good' : status?.uzumeReferencePlan?.latencyBudget ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceReadinessContract'), value: uzumeReferenceReadinessContractText, tone: expectedUzumeReferenceReadinessContract ? 'good' : status?.uzumeReferencePlan?.readinessContract ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGenerationCacheKey'), value: uzumeReferenceGenerationCacheKeyText, tone: expectedUzumeReferenceGenerationCacheKey ? 'good' : status?.uzumeReferencePlan?.generationCacheKey ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceRealtimeBudgetSummary'), value: uzumeReferenceRealtimeBudgetSummaryText, tone: expectedUzumeReferenceRealtimeBudgetSummary ? 'good' : status?.uzumeReferencePlan?.realtimeBudgetSummary ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePcmIngressGuard'), value: uzumeReferencePcmIngressGuardText, tone: expectedUzumeReferencePcmIngressGuard ? 'good' : status?.uzumeReferencePlan?.pcmIngressGuard ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGainStaging'), value: uzumeReferenceGainStagingText, tone: expectedUzumeReferenceGainStaging ? 'good' : status?.uzumeReferencePlan?.gainStaging ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceIirEq'), value: uzumeReferenceIirEqText, tone: expectedUzumeReferenceIirEq ? 'good' : status?.uzumeReferencePlan?.iirEq ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceChannelScope'), value: uzumeReferenceChannelScopeText, tone: expectedUzumeReferenceChannelScope ? 'good' : status?.uzumeReferencePlan?.channelScope ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceStereoProcedural'), value: uzumeReferenceStereoProceduralText, tone: expectedUzumeReferenceStereoProcedural ? 'good' : status?.uzumeReferencePlan?.stereoProcedural ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePerEarEqPlacement'), value: uzumeReferencePerEarEqPlacementText, tone: expectedUzumeReferencePerEarEqPlacement ? 'good' : status?.uzumeReferencePlan?.perEarEqPlacement ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBlockBoundary'), value: uzumeReferenceBlockBoundaryText, tone: expectedUzumeReferenceBlockBoundary ? 'good' : status?.uzumeReferencePlan?.blockBoundary ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceFlushDrain'), value: uzumeReferenceFlushDrainText, tone: isExpectedUzumeReferenceFlushDrain(status?.uzumeReferencePlan?.flushDrain) ? 'good' : status?.uzumeReferencePlan?.flushDrain ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGaplessConcat'), value: uzumeReferenceGaplessConcatText, tone: isExpectedUzumeReferenceGaplessConcat(status?.uzumeReferencePlan?.gaplessConcat) ? 'good' : status?.uzumeReferencePlan?.gaplessConcat ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceFirGaplessHistory'), value: uzumeReferenceFirGaplessHistoryText, tone: isExpectedUzumeReferenceFirGaplessHistory(status?.uzumeReferencePlan?.firGaplessHistory) ? 'good' : status?.uzumeReferencePlan?.firGaplessHistory ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceCallbackSafeControls'), value: uzumeReferenceCallbackSafeControlsText, tone: isExpectedUzumeReferenceCallbackSafeControls(status?.uzumeReferencePlan?.callbackSafeControls) ? 'good' : status?.uzumeReferencePlan?.callbackSafeControls ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceEqualPowerCrossfade'), value: uzumeReferenceEqualPowerCrossfadeText, tone: isExpectedUzumeReferenceEqualPowerCrossfade(status?.uzumeReferencePlan?.equalPowerCrossfade) ? 'good' : status?.uzumeReferencePlan?.equalPowerCrossfade ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceResampling'), value: uzumeReferenceResamplingText, tone: expectedUzumeReferenceResampling ? 'good' : status?.uzumeReferencePlan?.resampling ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcRollback'), value: uzumeReferenceSrcRollbackText, tone: isExpectedUzumeReferenceSrcRollback(status?.uzumeReferencePlan?.resampling.qualityRollback) ? status?.uzumeReferencePlan?.resampling.qualityRollback.state === 'armed' ? 'warning' : 'muted' : status?.uzumeReferencePlan?.resampling.qualityRollback ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcBudget'), value: uzumeReferenceSrcBudgetText, tone: expectedUzumeReferenceSrcBudget ? 'good' : status?.uzumeReferencePlan?.resampling.artifactMetrics.realtimeBudget ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcArtifacts'), value: uzumeReferenceSrcArtifactsText, tone: isExpectedUzumeReferenceSrcArtifacts(status?.uzumeReferencePlan?.resampling) ? 'good' : status?.uzumeReferencePlan?.resampling.artifactMetrics ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcValidation'), value: uzumeReferenceSrcValidationText, tone: expectedUzumeReferenceSrcValidation ? 'good' : status?.uzumeReferencePlan?.resampling.validation?.overall === 'fail' ? 'danger' : status?.uzumeReferencePlan?.resampling.validation ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcOutputRisk'), value: uzumeReferenceSrcOutputRiskText, tone: isExpectedUzumeReferenceSrcOutputRisk(status?.uzumeReferencePlan?.resampling.outputResamplingRisk) ? status?.uzumeReferencePlan?.resampling.outputResamplingRisk.signalPathTone === 'warning' ? 'warning' : 'good' : status?.uzumeReferencePlan?.resampling.outputResamplingRisk ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcPhaseApodizing'), value: uzumeReferenceSrcPhaseApodizingText, tone: isExpectedUzumeReferenceSrcPhaseApodizing(status?.uzumeReferencePlan?.resampling) ? 'good' : status?.uzumeReferencePlan?.resampling.phaseModeArtifacts ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceDsdFamily'), value: uzumeReferenceDsdFamilyText, tone: expectedUzumeReferenceDsdFamily ? 'good' : status?.uzumeReferencePlan?.dsdFamily ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolution'), value: uzumeReferenceConvolutionText, tone: expectedUzumeReferenceConvolution ? 'good' : status?.uzumeReferencePlan?.sharedConvolution ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceResponseResample'), value: uzumeReferenceResponseResampleText, tone: isExpectedUzumeReferenceResponseResample(status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports) ? 'good' : status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports?.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolutionDuplicateGuard'), value: uzumeReferenceConvolutionDuplicateGuardText, tone: isExpectedUzumeReferenceConvolutionDuplicateGuard(status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard) ? 'good' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard?.state === 'single-shared-plan' ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard?.state === 'split-required' ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolutionSerialNull'), value: uzumeReferenceConvolutionSerialNullText, tone: expectedUzumeReferenceConvolutionSerialNull ? 'good' : status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference?.state === 'residual-over-threshold' ? 'danger' : status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference?.state === 'merged-matches-serial' ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePcmOutputQuantization'), value: uzumeReferencePcmOutputQuantizationText, tone: isExpectedUzumeReferencePcmOutputQuantization(status?.uzumeReferencePlan?.pcmOutputQuantization) ? 'good' : status?.uzumeReferencePlan?.pcmOutputQuantization ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceContinuity'), value: uzumeReferenceContinuityText, tone: expectedUzumeReferenceContinuity ? 'good' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePreRoll'), value: uzumeReferencePreRollText, tone: expectedUzumeReferenceContinuity ? 'good' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceCallbackRing'), value: uzumeReferenceCallbackRingText, tone: expectedUzumeReferenceContinuity ? 'good' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceRenderAheadCache'), value: uzumeReferenceRenderAheadCacheText, tone: expectedUzumeReferenceContinuity ? 'good' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceUnderrunFallback'), value: uzumeReferenceUnderrunFallbackText, tone: status?.uzumeReferencePlan?.continuity?.fallback.telemetryStatus === 'unsafe' ? 'danger' : expectedUzumeReferenceContinuity ? 'good' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeBitPerfect'), value: uzumeBitPerfectText, tone: status?.uzumeBitPerfectState === 'available' ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeHeadroom'), value: uzumeHeadroomTelemetryText, tone: status?.uzumeHeadroomActive || Math.abs(status?.dspHeadroomDb ?? 0) > 0.05 ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeSafetyMeter'), value: uzumeSafetyMeterText, tone: status?.dspLimiterProtecting ? 'danger' : status?.dspClippingRisk || status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeLimiterReference'), value: uzumeLimiterReferenceText, tone: status?.dspLimiterProtecting ? 'danger' : status?.dspClippingRisk || status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeConvolution'), value: status?.uzumeTransitionalConvolutionPath ? `${transitional} / ${status.uzumeTransitionalConvolutionPath}` : planned, tone: status?.uzumeTransitionalConvolutionPath ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeFused'), value: status?.uzumeFusedMacroKernel ? yes : planned, tone: status?.uzumeFusedMacroKernel ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeBypass'), value: status?.uzumeBypassReason ?? disabled, tone: status?.uzumeBypassReason ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeGpu'), value: uzumeGpuText, tone: status?.uzumeGpuAvailable ? 'good' : status?.uzumeGpuCompiled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeGpuLimiter'), value: status?.uzumeGpuLimiterPlaybackActive ? enabled : planned, tone: status?.uzumeGpuLimiterPlaybackActive ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeGpuMatrix'), value: status?.uzumeGpuMatrixPlaybackActive ? enabled : planned, tone: status?.uzumeGpuMatrixPlaybackActive ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeFftScratch'), value: status?.uzumeGpuFftConvolutionPrepared ? transitional : planned, tone: status?.uzumeGpuFftConvolutionPrepared ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeFallback'), value: status?.uzumeFallbackReason ?? (status?.uzumeFallbackActive ? enabled : disabled), tone: status?.uzumeFallbackActive ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeCuda'), value: status?.uzumeCudaRuntimeVersion ? String(status.uzumeCudaRuntimeVersion) : disabled, tone: status?.uzumeCudaRuntimeVersion ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeCufft'), value: uzumeCufftText, tone: status?.uzumeGpuCufftAvailable ? 'good' : status?.uzumeGpuCompiled ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.protectLimiter'), value: protectLimiterText, tone: status?.dspLimiterProtecting ? 'danger' : status?.dspClippingRisk ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.replayGain'), value: status?.replayGainEnabled ? `${status.replayGainMode ?? 'track'} / ${formatDb(status.replayGainAppliedDb, '0.00 dB')}` : disabled },
        { label: t('audioProfessional.row.clippingProtection'), value: status?.replayGainPreventedClipping || status?.clippingRisk ? enabled : disabled, tone: status?.clippingRisk ? 'danger' : 'muted' },
      ],
    },
    {
      title: t('audioProfessional.group.stability'),
      icon: Gauge,
      rows: [
        { label: t('audioProfessional.row.latencyProfile'), value: status?.latencyProfile ?? unknown },
        { label: t('audioProfessional.row.requestedBuffer'), value: formatFrames(status?.nativeRequestedBufferFrames, unknown) },
        { label: t('audioProfessional.row.actualBuffer'), value: formatFrames(status?.nativeActualBufferFrames, unknown) },
        { label: t('audioProfessional.row.deviceBuffer'), value: formatFrames(status?.nativeDeviceBufferFrames, unknown) },
        { label: t('audioProfessional.row.outputLatency'), value: formatMs(status?.nativeOutputLatencyMs, unknown) },
        { label: t('audioProfessional.row.buffered'), value: formatMs(status?.nativeBufferedMs, unknown) },
        { label: t('audioProfessional.row.underrun'), value: `${status?.nativeUnderrunCallbacks ?? 0} / ${status?.nativeUnderrunFrames ?? 0}` },
        { label: t('audioProfessional.row.sharedStability'), value: status?.sharedStabilityTier ?? unknown },
        { label: t('audioProfessional.row.warnings'), value: joinedWarnings(status?.warnings, unknown), tone: status?.warnings.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.error'), value: status?.error ?? unknown, tone: status?.error ? 'danger' : 'muted' },
      ],
    },
  ], [bitPerfectText, disabled, dspModules.length, enabled, expectedUzumeReferenceDsdFamily, expectedUzumeReferenceResampling, no, planned, protectLimiterText, signalPathText, status, t, transitional, unknown, uzumeBitPerfectText, uzumeCufftText, uzumeFormatPathText, uzumeGpuText, uzumeHeadroomTelemetryText, uzumeLimiterReferenceText, uzumeReferenceAssignmentsText, uzumeReferenceBackendSupportText, uzumeReferenceBitPerfectText, uzumeReferenceBlockBoundaryText, uzumeReferenceCallbackRingText, uzumeReferenceCallbackSafeControlsText, uzumeReferenceChannelScopeText, uzumeReferenceCompilerText, uzumeReferenceContinuityText, uzumeReferenceConvolutionDuplicateGuardText, uzumeReferenceConvolutionSerialNullText, uzumeReferenceConvolutionText, uzumeReferenceDsdFamilyText, uzumeReferenceEqualPowerCrossfadeText, uzumeReferenceFirGaplessHistoryText, uzumeReferenceFlushDrainText, uzumeReferenceGainStagingText, uzumeReferenceGaplessConcatText, uzumeReferenceIirEqText, uzumeReferenceLatencyOwnersText, uzumeReferenceMergeGroupsText, uzumeReferenceOutputDevicePolicyText, uzumeReferencePcmIngressGuardText, uzumeReferencePcmOutputQuantizationText, uzumeReferencePerEarEqPlacementText, uzumeReferencePreRollText, uzumeReferenceRenderAheadCacheText, uzumeReferenceResamplingText, uzumeReferenceResponseResampleText, uzumeReferenceSrcArtifactsText, uzumeReferenceSrcBudgetText, uzumeReferenceSrcOutputRiskText, uzumeReferenceSrcPhaseApodizingText, uzumeReferenceSrcRollbackText, uzumeReferenceSrcValidationText, uzumeReferenceStereoProceduralText, uzumeReferenceUnderrunFallbackText, uzumeSafetyMeterText, yes]);

  const visibleSections = detailsOpen ? sections : [];
  const panelStateIcon = status?.error ? AlertTriangle : status?.bitPerfectCandidate ? CheckCircle2 : Zap;
  const PanelStateIcon = panelStateIcon;

  return (
    <section className={`audio-professional-status audio-professional-status--${variant}`} aria-label={t('audioProfessional.title')}>
      <header className="audio-professional-status__header">
        <span className="audio-professional-status__icon">
          <PanelStateIcon size={18} />
        </span>
        <div>
          <h3>{t('audioProfessional.title')}</h3>
          <p>{playbackSummary}</p>
        </div>
      </header>

      {badges.length ? (
        <div className="audio-professional-status__badges">
          {badges.map((badge) => (
            <em data-tone={badge.tone} key={`${badge.label}-${badge.tone}`}>{badge.label}</em>
          ))}
        </div>
      ) : null}

      <div className="audio-professional-status__signal" aria-label={t('audioProfessional.row.signalPath')}>
        {signalPathNodes.map((node, index) => (
          <span data-tone={node.tone} key={`${node.eyebrow}-${index}`}>
            <em>{node.eyebrow}</em>
            <strong title={node.label}>{node.label}</strong>
          </span>
        ))}
      </div>

      {issueReasons.length ? (
        <p className="audio-professional-status__issue" data-tone={status?.error ? 'danger' : 'warning'}>
          <strong>{t('audioProfessional.issue.reason')}</strong>
          <span>{issueReasons.join(' / ')}</span>
        </p>
      ) : null}

      {visibleSections.length ? (
        <div className="audio-professional-status__sections">
          {visibleSections.map((section) => {
            const SectionIcon = section.icon;

            return (
              <article className="audio-professional-status__section" key={section.title}>
                <h4>
                  <SectionIcon size={15} />
                  <span>{section.title}</span>
                </h4>
                <div className="audio-professional-status__grid">
                  {section.rows.map((row) => (
                    <span data-tone={row.tone} key={`${section.title}-${row.label}`}>
                      <em>{row.label}</em>
                      <strong title={row.value}>{row.value}</strong>
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <button className="audio-professional-status__toggle" type="button" onClick={() => setDetailsOpen((open) => !open)}>
        {detailsOpen ? t('audioProfessional.action.hideDetails') : t('audioProfessional.action.showDetails')}
      </button>
    </section>
  );
};
