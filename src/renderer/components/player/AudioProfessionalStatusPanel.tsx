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

  return report.state === 'src-stateful' &&
    report.policy === 'source-pcm-concat-before-src' &&
    report.concatNullResidual.state === 'concat-matches-no-reset' &&
    report.concatNullResidual.comparedFrames > 0 &&
    hasZeroReferenceResidual(report.concatNullResidual) &&
    report.resetResidual.state === 'reset-vs-concat-reference' &&
    report.resetResidual.comparedFrames > 0 &&
    report.resetResidual.maxAbs > 0 &&
    report.resetResidual.rms > 0 &&
    report.boundaryCount > 0 &&
    report.boundaries.length === report.boundaryCount &&
    report.boundaries.every((boundary) => boundary.concatVsNoResetMaxAbs === 0 && boundary.resetVsConcatMaxAbs > 0);
};

const isExpectedUzumeReferenceFirGaplessHistory = (
  report: NonNullable<AudioStatus['uzumeReferencePlan']>['firGaplessHistory'] | null | undefined,
): boolean => {
  if (!report) {
    return false;
  }

  return report.state === 'history-required' &&
    report.policy === 'source-pcm-concat-before-fir' &&
    report.engine === 'direct-fir-float64-reference' &&
    report.tailFrames > 0 &&
    report.drainFrames > 0 &&
    report.concatNullResidual.state === 'concat-matches-no-reset-history' &&
    report.concatNullResidual.comparedFrames > 0 &&
    hasZeroReferenceResidual(report.concatNullResidual) &&
    report.resetResidual.state === 'reset-vs-concat-history-reference' &&
    report.resetResidual.comparedFrames > 0 &&
    report.resetResidual.maxAbs > 0 &&
    report.resetResidual.rms > 0 &&
    report.boundaryCount > 0 &&
    report.boundaries.length === report.boundaryCount &&
    report.boundaries.every((boundary) =>
      boundary.overlapHistoryFrames > 0 &&
      boundary.concatVsNoResetMaxAbs === 0 &&
      boundary.resetVsConcatMaxAbs > 0);
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
  const boundary = report.renderStateBoundary;

  return report.policy === 'urgent-controls-after-committed-output' &&
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
  const uzumeReferenceArtifactManifest = buildUzumeReferenceArtifactManifestSummary(status?.uzumeReferencePlan?.artifactPlan);
  const uzumeReferenceArtifactManifestText = formatUzumeReferenceArtifactManifest(status, unknown);
  const uzumeReferenceBitPerfectText = formatUzumeReferenceBitPerfect(status, unknown);
  const uzumeReferenceBackendSupportText = formatUzumeReferenceBackendSupport(status, unknown);
  const uzumeReferenceOutputDevicePolicyText = formatUzumeReferenceOutputDevicePolicy(status, unknown);
  const uzumeReferenceLatencyBudgetText = formatUzumeReferenceLatencyBudget(status, unknown);
  const uzumeReferenceReadinessContractText = formatUzumeReferenceReadinessContract(status, unknown);
  const uzumeReferenceGenerationCacheKeyText = formatUzumeReferenceGenerationCacheKey(status, unknown);
  const uzumeReferenceRealtimeBudgetSummaryText = formatUzumeReferenceRealtimeBudgetSummary(status, unknown);
  const uzumeReferenceResamplingText = formatUzumeReferenceResampling(status, unknown);
  const uzumeReferenceSrcRollbackText = formatUzumeReferenceSrcRollback(status, unknown);
  const uzumeReferenceSrcBudgetText = formatUzumeReferenceSrcBudget(status, unknown);
  const uzumeReferenceSrcArtifactsText = formatUzumeReferenceSrcArtifacts(status, unknown);
  const uzumeReferenceSrcValidationText = formatUzumeReferenceSrcValidation(status, unknown);
  const uzumeReferenceSrcOutputRiskText = formatUzumeReferenceSrcOutputRisk(status, unknown);
  const uzumeReferenceSrcPhaseApodizingText = formatUzumeReferenceSrcPhaseApodizing(status, unknown);
  const uzumeReferenceDsdFamilyText = formatUzumeReferenceDsdFamily(status, unknown);
  const uzumeReferenceConvolutionText = formatUzumeReferenceConvolution(status, unknown);
  const uzumeReferenceResponseResampleText = formatUzumeReferenceResponseResample(status, unknown);
  const uzumeReferenceConvolutionDuplicateGuardText = formatUzumeReferenceConvolutionDuplicateGuard(status, unknown);
  const uzumeReferenceConvolutionSerialNullText = formatUzumeReferenceConvolutionSerialNull(status, unknown);
  const uzumeReferencePcmOutputQuantizationText = formatUzumeReferencePcmOutputQuantization(status, unknown);
  const uzumeReferencePcmIngressGuardText = formatUzumeReferencePcmIngressGuard(status, unknown);
  const uzumeReferenceGainStagingText = formatUzumeReferenceGainStaging(status, unknown);
  const uzumeReferenceIirEqText = formatUzumeReferenceIirEq(status, unknown);
  const uzumeReferenceChannelScopeText = formatUzumeReferenceChannelScope(status, unknown);
  const uzumeReferenceStereoProceduralText = formatUzumeReferenceStereoProcedural(status, unknown);
  const uzumeReferencePerEarEqPlacementText = formatUzumeReferencePerEarEqPlacement(status, unknown);
  const uzumeReferenceBlockBoundaryText = formatUzumeReferenceBlockBoundary(status, unknown);
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
        { label: t('audioProfessional.row.uzumeReferenceCompiler'), value: uzumeReferenceCompilerText, tone: status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceAssignments'), value: uzumeReferenceAssignmentsText, tone: status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceMergeGroups'), value: uzumeReferenceMergeGroupsText, tone: status?.uzumeReferencePlan?.mergeGroups.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceLatencyOwners'), value: uzumeReferenceLatencyOwnersText, tone: Object.keys(status?.uzumeReferencePlan?.latencyOwners ?? {}).length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceArtifactManifest'), value: uzumeReferenceArtifactManifestText, tone: uzumeReferenceArtifactManifest?.hasPlanned ? 'warning' : uzumeReferenceArtifactManifest ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBitPerfect'), value: uzumeReferenceBitPerfectText, tone: status?.uzumeReferencePlan?.bitPerfectState === 'available' ? 'good' : status?.uzumeReferencePlan ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBackendSupport'), value: uzumeReferenceBackendSupportText, tone: status?.uzumeReferencePlan?.backendSupport ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceOutputDevicePolicy'), value: uzumeReferenceOutputDevicePolicyText, tone: status?.uzumeReferencePlan?.outputDevicePolicy?.state === 'direct-like-ready' ? 'good' : status?.uzumeReferencePlan?.outputDevicePolicy ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceLatencyBudget'), value: uzumeReferenceLatencyBudgetText, tone: status?.uzumeReferencePlan?.latencyBudget?.state === 'ready' ? 'good' : status?.uzumeReferencePlan?.latencyBudget ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceReadinessContract'), value: uzumeReferenceReadinessContractText, tone: status?.uzumeReferencePlan?.readinessContract?.state === 'ready-to-commit' || status?.uzumeReferencePlan?.readinessContract?.state === 'cache-ready' ? 'good' : status?.uzumeReferencePlan?.readinessContract ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGenerationCacheKey'), value: uzumeReferenceGenerationCacheKeyText, tone: status?.uzumeReferencePlan?.generationCacheKey?.state === 'ready' ? 'good' : status?.uzumeReferencePlan?.generationCacheKey ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceRealtimeBudgetSummary'), value: uzumeReferenceRealtimeBudgetSummaryText, tone: status?.uzumeReferencePlan?.realtimeBudgetSummary?.state === 'offline-reference-only' ? 'warning' : status?.uzumeReferencePlan?.realtimeBudgetSummary ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePcmIngressGuard'), value: uzumeReferencePcmIngressGuardText, tone: status?.uzumeReferencePlan?.pcmIngressGuard?.state === 'channel-mismatch' || status?.uzumeReferencePlan?.pcmIngressGuard?.state === 'sanitized' ? 'warning' : status?.uzumeReferencePlan?.pcmIngressGuard ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGainStaging'), value: uzumeReferenceGainStagingText, tone: status?.uzumeReferencePlan?.gainStaging?.clipRisk ? 'warning' : Math.abs(status?.uzumeReferencePlan?.gainStaging?.totalGainDb ?? 0) > 0.001 ? 'warning' : status?.uzumeReferencePlan?.gainStaging ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceIirEq'), value: uzumeReferenceIirEqText, tone: status?.uzumeReferencePlan?.iirEq?.state === 'active' ? 'warning' : status?.uzumeReferencePlan?.iirEq ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceChannelScope'), value: uzumeReferenceChannelScopeText, tone: status?.uzumeReferencePlan?.channelScope?.invalidOperationCount ? 'warning' : status?.uzumeReferencePlan?.channelScope?.appliedOperationCount ? 'warning' : status?.uzumeReferencePlan?.channelScope ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceStereoProcedural'), value: uzumeReferenceStereoProceduralText, tone: status?.uzumeReferencePlan?.stereoProcedural?.state === 'active' ? 'warning' : status?.uzumeReferencePlan?.stereoProcedural ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePerEarEqPlacement'), value: uzumeReferencePerEarEqPlacementText, tone: status?.uzumeReferencePlan?.perEarEqPlacement?.state === 'placement-sensitive' ? 'warning' : status?.uzumeReferencePlan?.perEarEqPlacement ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceBlockBoundary'), value: uzumeReferenceBlockBoundaryText, tone: status?.uzumeReferencePlan?.blockBoundary?.coverage.state === 'exact' && status?.uzumeReferencePlan?.blockBoundary?.residual.state === 'exact-reassembly' ? 'good' : status?.uzumeReferencePlan?.blockBoundary ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceFlushDrain'), value: uzumeReferenceFlushDrainText, tone: isExpectedUzumeReferenceFlushDrain(status?.uzumeReferencePlan?.flushDrain) ? 'good' : status?.uzumeReferencePlan?.flushDrain ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceGaplessConcat'), value: uzumeReferenceGaplessConcatText, tone: isExpectedUzumeReferenceGaplessConcat(status?.uzumeReferencePlan?.gaplessConcat) ? 'good' : status?.uzumeReferencePlan?.gaplessConcat?.state === 'src-stateful' ? 'warning' : status?.uzumeReferencePlan?.gaplessConcat ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceFirGaplessHistory'), value: uzumeReferenceFirGaplessHistoryText, tone: isExpectedUzumeReferenceFirGaplessHistory(status?.uzumeReferencePlan?.firGaplessHistory) ? 'good' : status?.uzumeReferencePlan?.firGaplessHistory?.state === 'history-required' ? 'warning' : status?.uzumeReferencePlan?.firGaplessHistory ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceCallbackSafeControls'), value: uzumeReferenceCallbackSafeControlsText, tone: isExpectedUzumeReferenceCallbackSafeControls(status?.uzumeReferencePlan?.callbackSafeControls) ? 'good' : status?.uzumeReferencePlan?.callbackSafeControls ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceEqualPowerCrossfade'), value: uzumeReferenceEqualPowerCrossfadeText, tone: isExpectedUzumeReferenceEqualPowerCrossfade(status?.uzumeReferencePlan?.equalPowerCrossfade) ? 'good' : status?.uzumeReferencePlan?.equalPowerCrossfade?.rendered.state === 'crossfade-rendered' ? 'warning' : status?.uzumeReferencePlan?.equalPowerCrossfade ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceResampling'), value: uzumeReferenceResamplingText, tone: status?.uzumeReferencePlan?.resampling.active ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcRollback'), value: uzumeReferenceSrcRollbackText, tone: status?.uzumeReferencePlan?.resampling.qualityRollback.state === 'armed' ? 'warning' : status?.uzumeReferencePlan?.resampling.qualityRollback ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcBudget'), value: uzumeReferenceSrcBudgetText, tone: status?.uzumeReferencePlan?.resampling.artifactMetrics.realtimeBudget.safetyClass === 'offline-reference-only' ? 'warning' : status?.uzumeReferencePlan?.resampling.artifactMetrics.realtimeBudget ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcArtifacts'), value: uzumeReferenceSrcArtifactsText, tone: status?.uzumeReferencePlan?.resampling.artifactMetrics ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcValidation'), value: uzumeReferenceSrcValidationText, tone: status?.uzumeReferencePlan?.resampling.validation?.overall === 'fail' ? 'danger' : status?.uzumeReferencePlan?.resampling.validation?.overall === 'warn' ? 'warning' : status?.uzumeReferencePlan?.resampling.validation ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcOutputRisk'), value: uzumeReferenceSrcOutputRiskText, tone: status?.uzumeReferencePlan?.resampling.outputResamplingRisk.signalPathTone === 'warning' ? 'warning' : status?.uzumeReferencePlan?.resampling.outputResamplingRisk ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceSrcPhaseApodizing'), value: uzumeReferenceSrcPhaseApodizingText, tone: status?.uzumeReferencePlan?.resampling.phaseModeArtifacts ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceDsdFamily'), value: uzumeReferenceDsdFamilyText, tone: status?.uzumeReferencePlan?.dsdFamily?.state === 'unavailable' ? 'warning' : status?.uzumeReferencePlan?.dsdFamily?.state === 'direct' ? 'good' : status?.uzumeReferencePlan?.dsdFamily ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolution'), value: uzumeReferenceConvolutionText, tone: status?.uzumeReferencePlan?.sharedConvolution?.sources.length ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceResponseResample'), value: uzumeReferenceResponseResampleText, tone: status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports?.some((report) => report.linearInterpolationRejected) ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports?.length ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolutionDuplicateGuard'), value: uzumeReferenceConvolutionDuplicateGuardText, tone: isExpectedUzumeReferenceConvolutionDuplicateGuard(status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard) ? 'good' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard?.state === 'single-shared-plan' ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard?.state === 'split-required' ? 'warning' : status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceConvolutionSerialNull'), value: uzumeReferenceConvolutionSerialNullText, tone: status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference?.state === 'merged-matches-serial' ? 'good' : status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference?.state === 'residual-over-threshold' ? 'danger' : status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference ? 'muted' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePcmOutputQuantization'), value: uzumeReferencePcmOutputQuantizationText, tone: status?.uzumeReferencePlan?.pcmOutputQuantization?.state === 'rejected' ? 'warning' : status?.uzumeReferencePlan?.pcmOutputQuantization?.dither.enabled ? 'warning' : status?.uzumeReferencePlan?.pcmOutputQuantization ? 'good' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceContinuity'), value: uzumeReferenceContinuityText, tone: status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferencePreRoll'), value: uzumeReferencePreRollText, tone: status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceCallbackRing'), value: uzumeReferenceCallbackRingText, tone: status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceRenderAheadCache'), value: uzumeReferenceRenderAheadCacheText, tone: status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
        { label: t('audioProfessional.row.uzumeReferenceUnderrunFallback'), value: uzumeReferenceUnderrunFallbackText, tone: status?.uzumeReferencePlan?.continuity?.fallback.telemetryStatus === 'unsafe' ? 'danger' : status?.uzumeReferencePlan?.continuity ? 'warning' : 'muted' },
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
  ], [bitPerfectText, disabled, dspModules.length, enabled, no, planned, protectLimiterText, signalPathText, status, t, transitional, unknown, uzumeBitPerfectText, uzumeCufftText, uzumeFormatPathText, uzumeGpuText, uzumeHeadroomTelemetryText, uzumeLimiterReferenceText, uzumeReferenceAssignmentsText, uzumeReferenceBackendSupportText, uzumeReferenceBitPerfectText, uzumeReferenceBlockBoundaryText, uzumeReferenceCallbackRingText, uzumeReferenceCallbackSafeControlsText, uzumeReferenceChannelScopeText, uzumeReferenceCompilerText, uzumeReferenceContinuityText, uzumeReferenceConvolutionDuplicateGuardText, uzumeReferenceConvolutionSerialNullText, uzumeReferenceConvolutionText, uzumeReferenceDsdFamilyText, uzumeReferenceEqualPowerCrossfadeText, uzumeReferenceFirGaplessHistoryText, uzumeReferenceFlushDrainText, uzumeReferenceGainStagingText, uzumeReferenceGaplessConcatText, uzumeReferenceIirEqText, uzumeReferenceLatencyOwnersText, uzumeReferenceMergeGroupsText, uzumeReferenceOutputDevicePolicyText, uzumeReferencePcmIngressGuardText, uzumeReferencePcmOutputQuantizationText, uzumeReferencePerEarEqPlacementText, uzumeReferencePreRollText, uzumeReferenceRenderAheadCacheText, uzumeReferenceResamplingText, uzumeReferenceResponseResampleText, uzumeReferenceSrcArtifactsText, uzumeReferenceSrcBudgetText, uzumeReferenceSrcOutputRiskText, uzumeReferenceSrcPhaseApodizingText, uzumeReferenceSrcRollbackText, uzumeReferenceSrcValidationText, uzumeReferenceStereoProceduralText, uzumeReferenceUnderrunFallbackText, uzumeSafetyMeterText, yes]);

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
