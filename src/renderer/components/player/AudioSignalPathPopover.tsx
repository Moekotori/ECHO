import { useEffect, useRef, useState } from 'react';
import {
  Cpu,
  Database,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Waves,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AudioStatus } from '../../../shared/types/audio';
import type { ConnectSessionStatus } from '../../../shared/types/connect';
import type { HqPlayerRemotePlaybackStatus, HqPlayerStatus } from '../../../shared/types/hqplayer';
import type { LibraryTrack } from '../../../shared/types/library';
import { isHqPlayerConnectStatus } from '../../utils/connectPlayback';

type AudioSignalPathPopoverProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  connectStatus?: ConnectSessionStatus | null;
  onClose: () => void;
  onOpenAudioSettings?: () => void;
};

type AudioSignalPathControlProps = {
  isOpen: boolean;
  status: AudioStatus | null;
  track: LibraryTrack | null;
  connectStatus?: ConnectSessionStatus | null;
  onClick: () => void;
};

type SignalTone = 'good' | 'process' | 'warning' | 'danger' | 'muted';

type SignalNode = {
  title: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: SignalTone;
};

type SignalSummary = {
  label: string;
  detail: string;
  spec: string;
  tone: SignalTone;
};

type RoonSignalNode = {
  badge: string;
  title: string;
  value: string;
  icon?: LucideIcon;
  tone: SignalTone;
  variant?: 'circle' | 'process';
};

const signalPathPopoverExitMs = 170;
const unknown = '等待信号';

const trimTrailingZero = (value: string): string => value.replace(/\.0$/u, '');

const trimFixed = (value: number, fractionDigits: number): string =>
  value.toFixed(fractionDigits).replace(/\.?0+$/u, '');

const formatRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 1000) {
    return `${trimTrailingZero((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} kHz`;
  }

  return `${Math.round(value)} Hz`;
};

const compactRate = (value: number | null | undefined): string | null => {
  const formatted = formatRate(value);
  return formatted?.replace(' kHz', 'k') ?? null;
};

const formatBitDepth = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value)} bit` : null;

const formatRoonRate = (value: number | null | undefined): string | null => formatRate(value)?.replace(' kHz', 'kHz') ?? null;

const formatHqPlayerOutputRate = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 1_000_000) {
    return `${trimFixed(value / 1_000_000, 2)}MHz`;
  }

  return formatRoonRate(value);
};

const formatEchoSrcQualityProfile = (value: AudioStatus['echoSrcQualityProfile']): string => {
  if (value === 'balanced') {
    return 'Balanced';
  }
  if (value === 'lowLatency') {
    return 'Low latency';
  }
  return 'Transparent';
};

const formatEchoSrcPath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.echoSrcActive) {
    return null;
  }

  const sourceRate = formatRoonRate(status.fileSampleRate ?? track?.sampleRate);
  const targetRate = formatRoonRate(
    status.echoSrcTargetSampleRate
    ?? status.decoderOutputSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.actualDeviceSampleRate,
  );
  const engine = status.resamplerEngine === 'soxr' ? 'SOXR' : status.resamplerEngine ?? 'SRC';
  const quality = formatEchoSrcQualityProfile(status.echoSrcQualityProfile);

  if (sourceRate && targetRate) {
    return `${sourceRate} -> ${targetRate} / ${engine} ${quality}`;
  }

  return targetRate ? `${targetRate} / ${engine} ${quality}` : `${engine} ${quality}`;
};

const formatResamplePath = (status: AudioStatus | null, track?: LibraryTrack | null): string | null => {
  if (!status?.resampling) {
    return null;
  }

  const echoSrcPath = formatEchoSrcPath(status, track);
  if (echoSrcPath) {
    return echoSrcPath;
  }

  const sourceRate = formatRoonRate(status.fileSampleRate ?? track?.sampleRate);
  const outputRate = formatRoonRate(
    status.actualDeviceSampleRate
    ?? status.sharedDeviceSampleRate
    ?? status.requestedOutputSampleRate
    ?? status.decoderOutputSampleRate,
  );

  if (sourceRate && outputRate) {
    return `${sourceRate} -> ${outputRate}`;
  }

  return outputRate ? `-> ${outputRate}` : null;
};

const formatRoonBitDepth = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value)}bit` : null;

const formatBitrate = (value: number | null | undefined): string | null =>
  value && Number.isFinite(value) ? `${Math.round(value / 1000)} kbps` : null;

const formatChannels = (value: number | null | undefined): string | null => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value === 1) {
    return 'Mono';
  }

  if (value === 2) {
    return 'Stereo';
  }

  return `${Math.round(value)} ch`;
};

const formatDb = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(1)} dB` : null;

const normalizeCodec = (value: string | null | undefined): string | null => {
  const codec = value?.trim();
  return codec ? codec.toUpperCase() : null;
};

const cleanReason = (value: string | null | undefined): string | null => value?.replaceAll('_', ' ') ?? null;

const joinSpec = (parts: Array<string | null | undefined>, fallback = unknown): string =>
  parts.filter((part): part is string => Boolean(part?.trim())).join(' / ') || fallback;

const formatReferenceEngineId = (value: string): string =>
  value.replace(/-reference$/u, ' ref').replaceAll('-', ' ');

const formatUzumeReferenceAssignments = (status: AudioStatus | null): string | null => {
  const plan = status?.uzumeReferencePlan;
  const assignments = plan?.engineAssignments ?? [];
  if (!assignments.length) {
    return null;
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
        assignment.mergeGroupId ? `merge:${assignment.mergeGroupId}` : null,
        assignment.latencyOwner ? `latency:${assignment.latencyOwner}` : null,
        assignment.splitReason ? `split:${cleanReason(assignment.splitReason)}` : null,
      ].filter((part): part is string => Boolean(part));

      return `${assignment.sectionId}->${formatReferenceEngineId(assignment.engineId)}(${details.join(', ')})`;
    })
    .join(' | ');
};

const formatUzumeReferenceMergeGroups = (status: AudioStatus | null): string | null => {
  const groups = status?.uzumeReferencePlan?.mergeGroups ?? [];
  if (!groups.length) {
    return null;
  }

  return groups
    .map((group) => {
      const details = [
        group.active ? 'active' : 'inactive',
        group.sampleRateFamily ?? null,
        group.sections.length ? `sections:${group.sections.join('+')}` : null,
        group.splitReason ? `split:${cleanReason(group.splitReason)}` : null,
      ].filter((part): part is string => Boolean(part));

      return `${group.id}->${formatReferenceEngineId(group.engineId)}(${details.join(', ')})`;
    })
    .join(' | ');
};

const formatUzumeReferenceLatencyOwners = (status: AudioStatus | null): string | null => {
  const owners = Object.entries(status?.uzumeReferencePlan?.latencyOwners ?? {});
  if (!owners.length) {
    return null;
  }

  return owners.map(([sectionId, owner]) => `${sectionId}->${owner}`).join(' | ');
};

const formatUzumeReferencePathPlan = (status: AudioStatus | null): string | null => {
  const plan = status?.uzumeReferencePlan?.formatPathPlan;
  if (!plan) {
    return null;
  }

  return ['pcm_bitperfect', 'pcm_processed', 'dsd_direct', 'dsd_upsampling', 'd2p_processed', 'sdm_processed']
    .map((path) => {
      const entry = plan[path as keyof typeof plan];
      if (!entry) {
        return null;
      }

      return `${path}:${entry.state}${entry.reason ? `/${cleanReason(entry.reason)}` : ''}`;
    })
    .filter((part): part is string => Boolean(part))
    .join(' | ') || null;
};

const formatUzumeReferenceBitPerfect = (status: AudioStatus | null): string | null => {
  const plan = status?.uzumeReferencePlan;
  if (!plan) {
    return null;
  }

  return joinSpec([
    plan.bitPerfectState,
    plan.directDisabledReason ? `direct disabled:${cleanReason(plan.directDisabledReason)}` : 'direct path available',
    `${plan.sourceContainer}->${plan.outputContainer}`,
    plan.internalDomain,
    `format:${plan.formatPath}`,
  ]);
};

const formatUzumeReferenceBackendSupport = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.backendSupport;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.policy,
    `selected ${report.selectedBackend}`,
    `realtime ${report.realtimeBackend}`,
    `cpu ${report.cpuReference.state} ${report.cpuReference.role}`,
    `avx ${report.cpuAvx.state} ${report.cpuAvx.gate}`,
    `gpu ${report.gpu.state} ${report.gpu.gate}`,
    `legacy ${report.legacy.state} compiler ${report.legacy.allowedInCompiler ? 'allowed' : 'blocked'}`,
    `output ${report.outputDevicePolicyState}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceOutputDevicePolicy = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.outputDevicePolicy;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.formatPath,
    report.outputMode,
    report.deviceCapability,
    report.state,
    `file ${formatRoonRate(report.fileRate) ?? 'unknown'}`,
    `decoder ${formatRoonRate(report.decoderOutputRate) ?? 'unknown'}`,
    `requested ${formatRoonRate(report.requestedOutputRate) ?? 'unknown'}`,
    `actual ${formatRoonRate(report.actualDeviceRate) ?? 'unknown'}`,
    `shared ${formatRoonRate(report.sharedDeviceRate) ?? 'unknown'}`,
    `output ${report.outputContainer}`,
    `bit-perfect candidate ${report.bitPerfectCandidate === null ? 'unknown' : report.bitPerfectCandidate ? 'yes' : 'no'}`,
    `resampling ${report.resampling === null ? 'unknown' : report.resampling ? 'yes' : 'no'}`,
    `mismatch ${report.sampleRateMismatch === null ? 'unknown' : report.sampleRateMismatch ? 'yes' : 'no'}`,
    `recommend ${cleanReason(report.recommendation)}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatReferenceSamples = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} samples` : null;

const formatUzumeReferenceLatencyBudget = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.latencyBudget;
  if (!report) {
    return null;
  }

  const frameValue = (value: number | null | undefined): string => formatReferenceFrames(value) ?? 'unknown';
  const byteValue = (value: number | null | undefined): string => formatReferenceBytes(value) ?? 'unknown';
  const owners = Object.entries(report.latencyOwners)
    .map(([sectionId, owner]) => `${sectionId}->${owner}`)
    .join(' | ') || 'none';

  return joinSpec([
    report.artifact,
    report.selectedBackend,
    `realtime ${report.realtimeBackend}`,
    `src ${formatReferenceSamples(report.srcGroupDelaySamples) ?? 'unknown'}/${formatFractionalMs(report.srcGroupDelayMs) ?? 'unknown'} lookahead ${formatReferenceSamples(report.srcLookaheadSamples) ?? 'unknown'}/${formatFractionalMs(report.srcLookaheadMs) ?? 'unknown'}`,
    `conv ${report.convolutionLatencyClass} latency ${frameValue(report.convolutionLatencySamples)} direct-head ${Math.round(report.convolutionDirectHeadTaps)} taps warmup ${frameValue(report.convolutionWarmupFrames)} tail ${frameValue(report.convolutionTailFrames)} drain ${frameValue(report.convolutionDrainFrames)}`,
    `blocks ${frameValue(report.callbackBlockFrames)}->${frameValue(report.internalBlockFrames)}->${frameValue(report.outputBlockFrames)}`,
    `pre-roll ${frameValue(report.preRollRequiredFrames)} slack ${frameValue(report.deadlineSlackFrames)}`,
    `ring ${frameValue(report.callbackRingDepthFrames)}/${frameValue(report.callbackRingCapacityFrames)} ${trimFixed(report.callbackRingDepthBlocks, 1)} blocks`,
    `render-ahead ${report.renderAheadState} ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames} frames`,
    `cache ${byteValue(report.cacheBytesAfterEvict)}/${byteValue(report.cacheBudgetBytes)}`,
    `owners ${owners}`,
    report.callbackRule,
    report.schedulerState,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceReadinessContract = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.readinessContract;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.policy,
    report.state,
    `${report.intent}->${report.selectedPath}`,
    `wait ${report.waitTarget}`,
    `full-profile ${report.fullProfileReady ? 'ready' : 'not-ready'}`,
    `gpu-prewarm ${report.gpuPrewarmReady ? 'ready' : report.gpuPrewarmState}`,
    `cache ${report.cacheState}->${report.cacheCommitState} key ${report.cacheKey}`,
    `render-ahead ${report.renderAheadState} ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames}`,
    `deadline ${report.deadlineState} slack ${formatReferenceFrames(report.deadlineSlackFrames) ?? 'unknown'}`,
    `ring ${report.callbackRingState}/${report.callbackRingTelemetryStatus}`,
    `short-bridge ${report.shortBridgeCandidate}${report.shortBridgeReason ? ` ${cleanReason(report.shortBridgeReason)}` : ''}`,
    `crossfade ${report.crossfadeToFullProfile}`,
    `generation ${report.generationCommitRule} stale ${report.staleGenerationCommitAllowed ? 'allowed' : 'blocked'}`,
    report.handoffStrategy,
    `scheduler ${report.productionScheduler}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceGenerationCacheKey = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.generationCacheKey;
  if (!report) {
    return null;
  }

  return joinSpec([
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
    `invalidate ${report.invalidatesOn.map(cleanReason).filter(Boolean).join('+')}`,
    `preserve ${report.preservesOn.join('+')}`,
    report.staleCommitRule,
    report.callbackSlotRule,
    report.evictionRule,
    `renderer ${report.rendererControl}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceRealtimeBudgetSummary = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.realtimeBudgetSummary;
  if (!report) {
    return null;
  }

  const measured = report.measuredRealtimeFactor === null
    ? report.measuredRealtimeFactorState
    : `${trimFixed(report.measuredRealtimeFactor, 2)}x`;
  const srcRealtime = report.srcEstimatedRealtimeFactor === null
    ? 'unmeasured'
    : `${trimFixed(report.srcEstimatedRealtimeFactor, 2)}x`;

  return joinSpec([
    report.artifact,
    report.policy,
    report.state,
    `selected ${report.selectedBackend}`,
    `realtime ${report.realtimeBackend}`,
    `measured ${measured}`,
    `src ${report.srcBudgetBackend} ${report.srcEstimatedMultiplyAdds} multiply-adds factor ${srcRealtime} ${report.srcSafetyClass}`,
    `ring ${trimFixed(report.callbackRingDepthBlocks, 1)} blocks ${report.callbackRingTelemetryStatus}`,
    `render-ahead ${report.renderAheadReadyFrames}/${report.renderAheadTargetFrames} ${Math.round(report.renderAheadCoverageRatio * 100)}%`,
    `cpu ${report.cpuFullProfileFallback}`,
    `gpu factor ${report.gpuRealtimeFactor === null ? 'unmeasured' : `${trimFixed(report.gpuRealtimeFactor, 2)}x`}`,
    `thresholds safe ${trimFixed(report.thresholdSafeFactor, 1)}x marginal ${trimFixed(report.thresholdMarginalFactor, 1)}x`,
    report.realtimeSafetyGate,
    report.gpuRenderAheadGate,
    `renderer ${report.rendererControl}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatFractionalMs = (value: number | null | undefined): string | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) < 0.005) {
    return '0 ms';
  }
  return `${trimFixed(value, value < 10 ? 2 : 1)} ms`;
};

const formatUzumeReferenceResampling = (status: AudioStatus | null): string | null => {
  const resampling = status?.uzumeReferencePlan?.resampling;
  if (!resampling) {
    return null;
  }

  const source = formatRoonRate(resampling.sourceRate);
  const target = formatRoonRate(resampling.targetRate);
  const ratePath = source && target ? `${source}->${target}` : resampling.sameRateBypass ? 'same-rate bypass' : null;
  const delay = joinSpec([
    `${resampling.groupDelaySamples} samples`,
    formatFractionalMs(resampling.groupDelayMs),
    resampling.lookaheadMs !== null && resampling.lookaheadMs !== undefined ? `lookahead ${formatFractionalMs(resampling.lookaheadMs)}` : null,
  ], '');
  const artifactSummary = [
    status?.uzumeReferencePlan?.artifactPlan?.impulse === 'deterministic-reference' ? 'impulse' : null,
    status?.uzumeReferencePlan?.artifactPlan?.sweep === 'deterministic-reference' ? 'sweep' : null,
    status?.uzumeReferencePlan?.artifactPlan?.nearNyquist === 'deterministic-reference' ? 'near-Nyquist' : null,
    status?.uzumeReferencePlan?.artifactPlan?.phaseGroupDelay === 'deterministic-reference' ? 'phase/group-delay' : null,
  ].filter((part): part is string => Boolean(part)).join('+');
  const alias = resampling.artifactMetrics?.aliasRejectionDb !== null && resampling.artifactMetrics?.aliasRejectionDb !== undefined
    ? `alias ${resampling.artifactMetrics.aliasRejectionDb.toFixed(1)} dB`
    : null;

  return joinSpec([
    resampling.family,
    ratePath,
    resampling.phaseMode,
    resampling.apodizing,
    delay || null,
    resampling.realtimeSafetyClass,
    resampling.outputResamplingRisk?.reason ? `risk:${cleanReason(resampling.outputResamplingRisk.reason)}` : cleanReason(resampling.doubleResamplingRisk),
    artifactSummary ? `artifacts:${artifactSummary}` : null,
    alias,
  ]);
};

const formatUzumeReferenceSrcRollback = (status: AudioStatus | null): string | null => {
  const rollback = status?.uzumeReferencePlan?.resampling?.qualityRollback;
  if (!rollback) {
    return null;
  }

  const profiles = [rollback.primaryProfile, ...rollback.rollbackChain]
    .map((profile) => `${profile.id}:${profile.tapCount} taps/${profile.stopbandAttenuationDb} dB/${profile.latencyClass}`)
    .join(' -> ');

  return joinSpec([
    rollback.state,
    rollback.reason.replaceAll('-', ' '),
    rollback.familyLock,
    profiles,
    rollback.legacyFallbackAllowed ? 'legacy fallback allowed' : `legacy blocked:${rollback.legacyFallbackSignalPath}`,
    rollback.shortBridgeIsRollback ? 'short bridge rollback' : 'short bridge not rollback',
  ]);
};

const formatUzumeReferenceSrcBudget = (status: AudioStatus | null): string | null => {
  const metrics = status?.uzumeReferencePlan?.resampling?.artifactMetrics;
  const budget = metrics?.realtimeBudget;
  const nullResidual = metrics?.nullResidual;
  if (!budget) {
    return null;
  }

  return joinSpec([
    budget.backend,
    `${budget.estimatedMultiplyAdds} multiply-adds`,
    budget.estimatedRealtimeFactor === null ? 'realtime factor unmeasured' : `realtime factor ${trimFixed(budget.estimatedRealtimeFactor, 2)}x`,
    budget.safetyClass,
    nullResidual ? `null ${nullResidual.state}` : null,
    nullResidual?.maxAbs !== null && nullResidual?.maxAbs !== undefined ? `max ${trimFixed(nullResidual.maxAbs, 6)}` : null,
    nullResidual?.rms !== null && nullResidual?.rms !== undefined ? `rms ${trimFixed(nullResidual.rms, 6)}` : null,
  ]);
};

const formatMetricDb = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${trimFixed(value, 2)} dB` : null;

const formatMetricRatio = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? trimFixed(value, 4) : null;

const formatMetricScalar = (value: number | null | undefined): string | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (Math.abs(value) > 0 && Math.abs(value) < 0.000001) {
    return value.toExponential(2);
  }
  return trimFixed(value, 6);
};

const formatUzumeReferenceSrcArtifacts = (status: AudioStatus | null): string | null => {
  const metrics = status?.uzumeReferencePlan?.resampling?.artifactMetrics;
  if (!metrics) {
    return null;
  }

  const passbandRipple = formatMetricDb(metrics.passbandRippleDb);
  const stopbandAttenuation = formatMetricDb(metrics.stopbandAttenuationDb);
  const cutoffRatio = formatMetricRatio(metrics.cutoffRatioEstimate);
  const transitionWidth = formatMetricRatio(metrics.transitionWidthRatioEstimate);
  const phaseSpread = formatMetricRatio(metrics.phaseGroupDelaySpreadSamples);
  const multiTonePeak = formatMetricRatio(metrics.multiTonePeak);
  const randomPeak = formatMetricRatio(metrics.randomPeak);
  const randomSeed = Number.isFinite(metrics.randomSeed) ? `random seed ${metrics.randomSeed}` : null;

  return joinSpec([
    passbandRipple ? `passband ${passbandRipple}` : null,
    stopbandAttenuation ? `stopband ${stopbandAttenuation}` : null,
    cutoffRatio ? `cutoff ${cutoffRatio}` : null,
    transitionWidth ? `transition ${transitionWidth}` : null,
    phaseSpread ? `phase spread ${phaseSpread} samples` : null,
    `silence ${metrics.silenceResidual.state} max ${trimFixed(metrics.silenceResidual.maxAbs, 6)}`,
    multiTonePeak ? `multi-tone peak ${multiTonePeak}` : null,
    randomPeak ? `seeded-random peak ${randomPeak}` : null,
    randomSeed,
  ]);
};

const formatUzumeReferenceSrcValidation = (status: AudioStatus | null): string | null => {
  const validation = status?.uzumeReferencePlan?.resampling?.validation;
  if (!validation) {
    return null;
  }

  const checks = validation.checks.map((check) => `${check.id}:${check.state}`).join(' / ');
  return joinSpec([
    validation.artifact,
    `overall ${validation.overall}`,
    checks,
  ]);
};

const formatUzumeReferenceSrcOutputRisk = (status: AudioStatus | null): string | null => {
  const risk = status?.uzumeReferencePlan?.resampling?.outputResamplingRisk;
  if (!risk) {
    return null;
  }

  return joinSpec([
    risk.artifact,
    risk.state,
    risk.reason ? cleanReason(risk.reason) : 'no double-resampling risk',
    `requested ${formatRoonRate(risk.requestedOutputRate) ?? 'unknown'}`,
    `actual ${formatRoonRate(risk.actualDeviceRate) ?? 'unknown'}`,
    risk.sharedDeviceRate !== null && risk.sharedDeviceRate !== undefined ? `shared ${formatRoonRate(risk.sharedDeviceRate) ?? 'unknown'}` : null,
    `current ${risk.currentResamplerEngine ?? 'none'}`,
    `tone ${risk.signalPathTone}`,
    `recommend ${risk.recommendation?.replaceAll('-', ' ') ?? 'none'}`,
  ]);
};

const formatUzumeReferenceSrcPhaseApodizing = (status: AudioStatus | null): string | null => {
  const resampling = status?.uzumeReferencePlan?.resampling;
  if (!resampling) {
    return null;
  }

  const phase = resampling.phaseModeArtifacts;
  const apodizing = resampling.apodizingArtifact;
  const phaseModes = phase.modes
    .map((mode) => `${mode.mode} gd ${trimFixed(mode.groupDelaySamples, 2)} spread ${trimFixed(mode.groupDelaySpreadSamples ?? 0, 2)} residual ${trimFixed(mode.residualVsLinearMaxAbs, 4)}/${trimFixed(mode.residualVsLinearRms, 4)}`)
    .join(' | ');

  return joinSpec([
    phase.artifact,
    `modes ${phase.phaseModesMeasured.join('+')}`,
    phaseModes,
    apodizing.artifact,
    apodizing.state,
    `${apodizing.mode} vs ${apodizing.baseline}`,
    apodizing.ringingReductionDb !== null ? `ringing reduction ${trimFixed(apodizing.ringingReductionDb, 2)} dB` : null,
    `response residual ${trimFixed(apodizing.responseResidualMaxAbs, 4)}/${trimFixed(apodizing.responseResidualRms, 4)}`,
    apodizing.highFrequencyRestorationClaim ? 'hf restoration claimed' : 'no hf restoration claim',
  ]);
};

const formatUzumeReferenceDsdFamily = (status: AudioStatus | null): string | null => {
  const dsd = status?.uzumeReferencePlan?.dsdFamily;
  if (!dsd) {
    return null;
  }

  const disabled = dsd.disabledControls.length
    ? dsd.disabledControls.map((control) => `${control.control}:${cleanReason(control.reason)}`).join(' | ')
    : 'disabled none';
  const d2p = dsd.d2p.active
    ? `d2p ${dsd.d2p.decimationProfile ?? 'reference'} @ ${dsd.d2p.internalPcmRate ?? 'unknown'} Hz`
    : dsd.d2p.available ? 'd2p available' : 'd2p unavailable';
  const sdm = dsd.sdm.active
    ? `sdm ${dsd.sdm.mode} / ${dsd.sdm.modulatorProfile ?? 'reference'} / target ${dsd.sdm.targetDsdRate ?? 'unknown'} / overload ${dsd.sdm.overloadMarginDb ?? 'unknown'} dB / noise ${dsd.sdm.ultrasonicNoiseRisk ?? 'unknown'} / ${dsd.sdm.realtimeSafetyClass}`
    : dsd.sdm.available ? 'sdm available' : 'sdm unavailable';

  return joinSpec([
    dsd.artifact,
    `${dsd.formatPath}:${dsd.state}`,
    `${dsd.sourceContainer}->${dsd.outputContainer}`,
    dsd.internalDomain,
    dsd.directDisabledReason ? `direct disabled ${cleanReason(dsd.directDisabledReason)}` : 'direct allowed',
    dsd.fallbackReason ? `fallback ${cleanReason(dsd.fallbackReason)}` : null,
    `allowed ${dsd.allowedControls.join('+') || 'none'}`,
    disabled,
    `pcm dsp ${dsd.pcmDomainDspAllowed ? 'allowed' : 'blocked'}`,
    `pcm dither ${dsd.pcmDitherAllowed ? 'allowed' : 'blocked'}`,
    `sdm noise ${dsd.sdmNoiseShapingTelemetry ? 'telemetry' : 'none'}`,
    dsd.dsd.outputEncoding ? `output ${dsd.dsd.outputEncoding}` : null,
    d2p,
    sdm,
    dsd.reasons.length ? `reasons ${dsd.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceConvolution = (status: AudioStatus | null): string | null => {
  const convolution = status?.uzumeReferencePlan?.sharedConvolution;
  if (!convolution) {
    return null;
  }

  const plan = convolution.partitionPlan;
  const sourceText = convolution.mergedSourceIds.length
    ? convolution.mergedSourceIds.join('+')
    : convolution.sources.map((source) => source.id).join('+') || 'inactive';
  const blockText = plan.internalBlockFrames
    ? `${plan.callbackBlockFrames}->${plan.internalBlockFrames}`
    : `${plan.callbackBlockFrames}->inactive`;
  const splitText = Object.entries(convolution.splitReasons)
    .map(([sourceId, reason]) => `${sourceId}:${cleanReason(reason)}`)
    .join(' | ');

  return joinSpec([
    convolution.engine,
    convolution.active ? sourceText : `inactive:${sourceText}`,
    plan.sampleRateFamily,
    plan.latencyClass,
    `block ${blockText}`,
    plan.fftHeadSize ? `fft ${plan.fftHeadSize}` : null,
    `tail ${plan.tailFrames}`,
    `drain ${plan.drainFrames}`,
    splitText ? `split ${splitText}` : null,
  ]);
};

const formatUzumeReferenceResponseResample = (status: AudioStatus | null): string | null => {
  const reports = status?.uzumeReferencePlan?.sharedConvolution?.responseResampleReports ?? [];
  if (!reports.length) {
    return null;
  }

  return reports.map((report) => joinSpec([
    `${report.sourceId}:${report.state}`,
    `${formatRoonRate(report.sourceRate) ?? 'unknown'}->${formatRoonRate(report.targetRate) ?? 'unknown'}`,
    `${report.sourceFamily ?? 'unknown'}->${report.targetFamily ?? 'unknown'}`,
    report.engine,
    report.linearInterpolationRejected ? 'linear interpolation rejected' : 'linear interpolation not used',
    report.filterContract ? `${report.filterContract.tapCount} taps/${trimFixed(report.filterContract.cutoffRatio, 4)} cutoff/${report.filterContract.stopbandAttenuationDb} dB` : null,
    cleanReason(report.reason),
  ])).join(' | ');
};

const formatUzumeReferenceConvolutionDuplicateGuard = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.sharedConvolution?.duplicatePlanGuard;
  if (!report) {
    return null;
  }

  const assignments = report.sourceAssignments
    .map((assignment) => `${assignment.sourceId}:${assignment.state}${assignment.convolverPlanId ? ` conv ${assignment.convolverPlanId}` : ''}${assignment.fftPlanId ? ` fft ${assignment.fftPlanId}` : ''}${assignment.splitReason ? ` split ${cleanReason(assignment.splitReason)}` : ''}`)
    .join(' | ');
  const rejected = report.rejectedDuplicatePlans
    .map((plan) => `${plan.sourceId}:${plan.rejectedConvolverPlanId}+${plan.rejectedFftPlanId}`)
    .join(' | ');

  return joinSpec([
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
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceConvolutionSerialNull = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.sharedConvolution?.serialNullReference;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.engine,
    report.state,
    `order ${report.sourceOrder.length ? report.sourceOrder.join('->') : 'none'}`,
    `merged taps ${report.mergedResponseTapCounts.length ? report.mergedResponseTapCounts.join('+') : 'none'}`,
    `frames ${report.comparedFrames}`,
    report.maxAbs !== null && report.rms !== null
      ? `residual ${trimFixed(report.maxAbs, 6)}/${trimFixed(report.rms, 6)}`
      : 'residual n/a',
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferencePcmOutputQuantization = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.pcmOutputQuantization;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    `${report.formatPath}->${report.outputSampleFormat}`,
    report.state,
    `bit-perfect ${report.bitPerfectState}`,
    `pcm dither ${report.pcmDitherAllowed ? 'allowed' : 'blocked'}`,
    `dither ${report.dither.mode} ${report.dither.enabled ? 'enabled' : 'disabled'}`,
    report.dither.seed !== null ? `seed ${report.dither.seed}` : null,
    report.dither.lsbAmplitude !== null ? `lsb ${formatMetricScalar(report.dither.lsbAmplitude)}` : null,
    `peak ${trimFixed(report.dither.peakDitherLsb, 4)} lsb`,
    report.dither.noiseShaping !== 'none' ? `noise ${report.dither.noiseShaping}` : 'noise none',
    report.quantization.bitDepth !== null ? `${report.quantization.bitDepth} bit` : 'float/no pcm integer depth',
    report.quantization.maxInteger !== null ? `max ${report.quantization.maxInteger}` : null,
    `clips ${report.quantization.clippedSamples}`,
    report.quantization.residualMaxAbs !== null && report.quantization.residualRms !== null
      ? `residual ${formatMetricScalar(report.quantization.residualMaxAbs)}/${formatMetricScalar(report.quantization.residualRms)}`
      : 'residual not measured',
    `sdm noise ${report.sdmNoiseShapingTelemetry ? 'telemetry' : 'none'}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferencePcmIngressGuard = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.pcmIngressGuard;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.state,
    `expected ${report.expectedChannels ?? 'unknown'}`,
    `channels ${report.channelCount}`,
    `frames ${report.frameCount}`,
    report.rectangular ? 'rectangular' : 'non-rectangular',
    `peak ${trimFixed(report.peak, 4)}`,
    `non-finite ${report.counts.nonFiniteReplaced}`,
    `denormal ${report.counts.denormalZeroed}`,
    `mismatch ${report.counts.channelMismatchCount}`,
    `silence ${report.counts.silenceFrames}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceGainStaging = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.gainStaging;
  if (!report) {
    return null;
  }

  const stages = report.stages
    .map((stage) => `${stage.id}:gain ${trimFixed(stage.gainDb, 2)} dB/cum ${trimFixed(stage.cumulativeGainDb, 2)} dB/peak ${trimFixed(stage.peak, 4)}`)
    .join(' | ');

  return joinSpec([
    report.artifact,
    `order ${report.orderContract.join('->')}`,
    `total ${trimFixed(report.totalGainDb, 2)} dB`,
    `linear ${trimFixed(report.totalGainLinear, 4)}`,
    report.clipRisk ? 'clip risk' : 'clip safe',
    `extra headroom ${trimFixed(report.recommendedAdditionalHeadroomDb, 2)} dB`,
    stages,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceIirEq = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.iirEq;
  if (!report) {
    return null;
  }

  const bands = report.bands
    .slice(0, 4)
    .map((band) =>
      `band${band.index} ${band.filterType} ${formatRoonRate(band.frequencyHz) ?? 'unknown'} ${trimFixed(band.gainDb, 2)} dB q ${trimFixed(band.q, 2)} ${band.state} coeff ${band.coefficientState} resp ${trimFixed(band.responsePeakDb, 2)}/${trimFixed(band.responseDipDb, 2)} dB phase ${trimFixed(band.phaseSpanRadians, 4)}`)
    .join(' | ');

  return joinSpec([
    report.artifact,
    report.engine,
    report.state,
    `sample ${formatRoonRate(report.sampleRate) ?? 'unknown'}`,
    `bands ${report.activeBandCount}/${report.bandCount} active`,
    `bypassed ${report.bypassedBandCount}`,
    `order ${report.orderContract}`,
    bands,
    report.bands.length > 4 ? `bands omitted ${report.bands.length - 4}` : null,
    `residual ${report.residual.state} ${trimFixed(report.residual.maxAbs, 6)}/${trimFixed(report.residual.rms, 6)}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceChannelScope = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.channelScope;
  if (!report) {
    return null;
  }

  const operations = report.operations
    .map((operation) => `${operation.id}:${operation.state}->${operation.targetChannels.join('+') || 'none'} skip ${operation.skippedChannels.join('+') || 'none'}${operation.gainDb !== null ? ` gain ${trimFixed(operation.gainDb, 2)} dB` : ''}${operation.sourceChannel !== null ? ` source ${operation.sourceChannel}` : ''}`)
    .join(' | ');
  const residual = report.residualByChannel
    .map((channel) => `ch${channel.channelIndex}:${channel.state} ${trimFixed(channel.maxAbs, 6)}/${trimFixed(channel.rms, 6)}`)
    .join(' | ');

  return joinSpec([
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
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceStereoProcedural = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.stereoProcedural;
  if (!report) {
    return null;
  }

  const matrix = `[${report.matrix[0].map((value) => trimFixed(value, 3)).join(',')};${report.matrix[1].map((value) => trimFixed(value, 3)).join(',')}]`;
  const routing = [
    report.routing.invertLeft ? 'invert-left' : null,
    report.routing.invertRight ? 'invert-right' : null,
    report.routing.swapLeftRight ? 'swap' : null,
    report.routing.monoMode !== 'off' ? `mono ${report.routing.monoMode}` : null,
  ].filter((part): part is string => Boolean(part)).join('+') || 'routing identity';

  return joinSpec([
    report.artifact,
    report.engine,
    report.state,
    `sample ${formatRoonRate(report.sampleRate) ?? 'unknown'}`,
    `channels ${report.channelCount}`,
    `steps ${report.steps.length ? report.steps.join('->') : 'identity'}`,
    `delay ${trimFixed(report.delaySamples.left, 3)}/${trimFixed(report.delaySamples.right, 3)} samples`,
    `matrix ${matrix}`,
    routing,
    report.crossfeed.enabled
      ? `crossfeed delay ${report.crossfeed.crossDelaySamples} lowpass ${report.crossfeed.lowPassHz ?? 'unknown'} center ${report.crossfeed.centerPreservation}`
      : 'crossfeed disabled',
    `input peak ${trimFixed(report.input.peak, 4)} output peak ${trimFixed(report.output.peak, 4)}`,
    `residual ${report.residual.state} ${trimFixed(report.residual.maxAbs, 6)}/${trimFixed(report.residual.rms, 6)}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceBlockBoundary = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.blockBoundary;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.policy,
    `block ${report.blockFrames}`,
    `input ${report.inputFrames}`,
    `channels ${report.channelCount}`,
    `blocks ${report.blockCount}`,
    `states ${report.blockStates.join('+')}`,
    `coverage ${report.coverage.state} covered ${report.coverage.coveredFrames} missing ${report.coverage.missingFrames} duplicate ${report.coverage.duplicateFrames} committed ${report.coverage.committedFrames} padded ${report.coverage.paddedFrames}`,
    `residual ${report.residual.state} ${trimFixed(report.residual.maxAbs, 6)}/${trimFixed(report.residual.rms, 6)}`,
    `boundaries ${report.boundaryCount}`,
    `introduced ${trimFixed(report.maxIntroducedDiscontinuity, 6)}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatFlushDrainIntent = (
  label: string,
  intent: NonNullable<AudioStatus['uzumeReferencePlan']>['flushDrain']['naturalEof'],
): string => joinSpec([
  `${label}:${intent.state}`,
  `gen ${intent.generationAfter}`,
  `tail ${intent.tailFrames}`,
  `drain ${intent.drainFrames}`,
  intent.resetRequired ? 'reset required' : 'no reset',
  intent.drainCommitAllowed ? 'drain committed' : 'drain blocked',
  `source residual ${trimFixed(intent.residual.sourceWindowMaxAbs, 6)}/${trimFixed(intent.residual.sourceWindowRms, 6)}`,
  intent.residual.drainMaxAbs !== null && intent.residual.drainRms !== null
    ? `drain residual ${trimFixed(intent.residual.drainMaxAbs, 6)}/${trimFixed(intent.residual.drainRms, 6)}`
    : 'drain residual n/a',
  intent.reasons.length ? `reasons ${intent.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
]);

const formatUzumeReferenceFlushDrain = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.flushDrain;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.engine,
    `generation ${report.generationId}/${report.generationState}`,
    formatFlushDrainIntent('natural-eof', report.naturalEof),
    formatFlushDrainIntent('manual-flush', report.manualFlush),
  ]);
};

const formatUzumeReferenceGaplessConcat = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.gaplessConcat;
  if (!report) {
    return null;
  }

  const boundaries = report.boundaries
    .map((boundary) => `${boundary.beforeSegmentId}->${boundary.afterSegmentId} out ${boundary.outputFrameOffset} reset ${trimFixed(boundary.resetVsConcatMaxAbs, 6)} jump ${trimFixed(boundary.outputJump, 6)}`)
    .join(' | ');

  return joinSpec([
    report.artifact,
    report.policy,
    report.state,
    `${formatRoonRate(report.sourceRate) ?? 'unknown'}->${formatRoonRate(report.targetRate) ?? 'unknown'}`,
    `ratio ${trimFixed(report.ratio, 6)}`,
    `segments ${report.segmentCount}`,
    `boundaries ${report.boundaryCount}`,
    `concat ${report.concatNullResidual.state} ${trimFixed(report.concatNullResidual.maxAbs, 6)}/${trimFixed(report.concatNullResidual.rms, 6)}`,
    `reset ${report.resetResidual.state} ${trimFixed(report.resetResidual.maxAbs, 6)}/${trimFixed(report.resetResidual.rms, 6)}`,
    boundaries ? `boundary ${boundaries}` : null,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferenceFirGaplessHistory = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.firGaplessHistory;
  if (!report) {
    return null;
  }

  const boundaries = report.boundaries
    .map((boundary) => `${boundary.beforeSegmentId}->${boundary.afterSegmentId} out ${boundary.outputFrameOffset} overlap ${boundary.overlapHistoryFrames} reset ${trimFixed(boundary.resetVsConcatMaxAbs, 6)} jump ${trimFixed(boundary.outputJump, 6)}`)
    .join(' | ');

  return joinSpec([
    report.artifact,
    report.policy,
    report.engine,
    report.state,
    report.sourceId,
    `sample ${formatRoonRate(report.sampleRate) ?? 'unknown'}`,
    `segments ${report.segmentCount}`,
    `boundaries ${report.boundaryCount}`,
    `tail ${report.tailFrames}`,
    `drain ${report.drainFrames}`,
    `concat ${report.concatNullResidual.state} ${trimFixed(report.concatNullResidual.maxAbs, 6)}/${trimFixed(report.concatNullResidual.rms, 6)}`,
    `reset ${report.resetResidual.state} ${trimFixed(report.resetResidual.maxAbs, 6)}/${trimFixed(report.resetResidual.rms, 6)}`,
    boundaries ? `boundary ${boundaries}` : null,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatUzumeReferencePerEarEqPlacement = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.perEarEqPlacement;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.compilerRule,
    report.state,
    `sample ${formatRoonRate(report.sampleRate) ?? 'unknown'}`,
    `order ${report.orderContract.join('->')}`,
    `per-ear ${trimFixed(report.perEarEq.leftGainDb, 2)}/${trimFixed(report.perEarEq.rightGainDb, 2)} dB`,
    report.crossfeed.enabled
      ? `crossfeed ${report.crossfeed.crossGainDb !== null ? trimFixed(report.crossfeed.crossGainDb, 2) : 'unknown'} dB delay ${report.crossfeed.crossDelayMs !== null ? trimFixed(report.crossfeed.crossDelayMs, 3) : 'unknown'} ms lowpass ${report.crossfeed.lowPassHz ?? 'unknown'} center ${report.crossfeed.centerPreservation}`
      : 'crossfeed disabled',
    `pre ${report.preCrossfeedSteps.join('->') || 'unknown'}`,
    `post ${report.postCrossfeedSteps.join('->') || 'unknown'}`,
    `residual ${report.residual.comparedFrames} frames ${trimFixed(report.residual.maxAbs, 6)}/${trimFixed(report.residual.rms, 6)}`,
    report.reasons.length ? `reasons ${report.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
  ]);
};

const formatCallbackSafeCase = (
  label: string,
  control: NonNullable<AudioStatus['uzumeReferencePlan']>['callbackSafeControls']['urgentControl'],
): string => joinSpec([
  `${label}:${control.control}:${control.state}`,
  control.classification,
  control.callbackRule,
  `cache ${control.renderCacheAction}`,
  `gen ${control.generationAfterControl}`,
  control.requiresRenderGraphRebuild ? 'rebuild required' : 'no rebuild',
  control.commitAllowed ? 'commit allowed' : 'commit blocked',
  `declick ${control.declick.enabled ? 'enabled' : 'off'} ${control.declick.frames} frames ${trimFixed(control.declick.startGain, 3)}->${trimFixed(control.declick.endGain, 3)} step ${trimFixed(control.declick.maxStep, 6)}`,
  `envelope ${control.gainEnvelopeFrames}`,
  `peak ${trimFixed(control.peak.input, 6)}->${trimFixed(control.peak.output, 6)}`,
  control.reasons.length ? `reasons ${control.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
]);

const formatUzumeReferenceCallbackSafeControls = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.callbackSafeControls;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.policy,
    formatCallbackSafeCase('urgent', report.urgentControl),
    formatCallbackSafeCase('boundary', report.renderStateBoundary),
  ]);
};

const formatCrossfadeCase = (
  label: string,
  crossfade: NonNullable<AudioStatus['uzumeReferencePlan']>['equalPowerCrossfade']['rendered'],
): string => joinSpec([
  `${label}:${crossfade.intent}:${crossfade.state}`,
  crossfade.rejectionReason ? `reject ${cleanReason(crossfade.rejectionReason)}` : 'accepted',
  `sample ${formatRoonRate(crossfade.sampleRate) ?? 'unknown'}`,
  `fade ${crossfade.fadeFrames} frames/${trimFixed(crossfade.durationMs, 3)} ms`,
  `gain ${crossfade.gainLaw.state}`,
  crossfade.gainLaw.midpointShortBridgeGain !== null && crossfade.gainLaw.midpointFullProfileGain !== null
    ? `mid ${trimFixed(crossfade.gainLaw.midpointShortBridgeGain, 6)}/${trimFixed(crossfade.gainLaw.midpointFullProfileGain, 6)}`
    : 'mid n/a',
  `power error ${trimFixed(crossfade.gainLaw.maxPowerSumError, 6)}`,
  crossfade.residualVsHardSwitch.maxAbs !== null && crossfade.residualVsHardSwitch.rms !== null
    ? `residual ${crossfade.residualVsHardSwitch.state} ${trimFixed(crossfade.residualVsHardSwitch.maxAbs, 6)}/${trimFixed(crossfade.residualVsHardSwitch.rms, 6)}`
    : `residual ${crossfade.residualVsHardSwitch.state}`,
  `peak ${trimFixed(crossfade.peak.shortBridge, 6)}/${trimFixed(crossfade.peak.fullProfile, 6)}/${trimFixed(crossfade.peak.output, 6)}`,
  crossfade.reasons.length ? `reasons ${crossfade.reasons.map(cleanReason).filter(Boolean).join(' | ')}` : null,
]);

const formatUzumeReferenceEqualPowerCrossfade = (status: AudioStatus | null): string | null => {
  const report = status?.uzumeReferencePlan?.equalPowerCrossfade;
  if (!report) {
    return null;
  }

  return joinSpec([
    report.artifact,
    report.policy,
    formatCrossfadeCase('rendered', report.rendered),
    formatCrossfadeCase('rejected-boundary', report.rejectedBoundary),
  ]);
};

const formatUzumeHeadroomReference = (status: AudioStatus | null): string | null => {
  if (!status || (!status.uzumeHeadroomActive && Math.abs(status.dspHeadroomDb ?? 0) <= 0.05)) {
    return null;
  }

  return joinSpec([
    `Headroom ${formatDb(status.dspHeadroomDb) ?? '0.0 dB'}`,
    'gain-reference',
    status.uzumeHeadroomActive ? 'active' : 'reference pending',
  ]);
};

const formatUzumeSafetyMeterReference = (status: AudioStatus | null): string | null => {
  if (!status?.uzumeReferencePlan && !status?.dspClippingRisk && !status?.dspLimiterProtecting) {
    return null;
  }

  return joinSpec([
    status.dspLimiterProtecting ? 'limiting' : status.dspClippingRisk ? 'near-limit' : 'monitoring',
    status.dspClippingRisk || status.dspLimiterProtecting ? 'clipping risk' : 'safe',
    'stage telemetry separate from limiter',
  ]);
};

const formatUzumeLimiterReference = (status: AudioStatus | null): string | null => {
  if (!status?.uzumeReferencePlan && !status?.dspClippingRisk && !status?.dspLimiterProtecting) {
    return null;
  }

  return joinSpec([
    'sample-domain safety limiter',
    status.dspLimiterProtecting ? 'active' : 'standby',
    status.uzumeGpuLimiterPlaybackActive ? 'GPU limiter active' : 'GPU limiter planned',
  ]);
};

const formatReferenceFrames = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} frames` : null;

const formatReferenceBytes = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? `${Math.round(value)} bytes` : null;

const formatUzumeContinuityReference = (status: AudioStatus | null): string | null => {
  const continuity = status?.uzumeReferencePlan?.continuity?.continuity;
  if (!continuity) {
    return null;
  }

  return joinSpec([
    continuity.policy,
    `${continuity.intent}->${continuity.selectedPath}`,
    `callback:${continuity.callbackRule}`,
    `wait:${continuity.waitTarget}`,
    continuity.shortBridgeAllowed ? 'short bridge allowed' : `short bridge blocked:${cleanReason(continuity.shortBridgeReason) ?? 'none'}`,
    `rollback:${continuity.qualityRollback}`,
  ]);
};

const formatUzumePreRollReference = (status: AudioStatus | null): string | null => {
  const preRoll = status?.uzumeReferencePlan?.continuity?.preRoll;
  if (!preRoll) {
    return null;
  }

  return joinSpec([
    preRoll.state,
    `required ${formatReferenceFrames(preRoll.preRollRequiredFrames)}`,
    `slack ${formatReferenceFrames(preRoll.deadlineSlackFrames)}`,
    `render-ahead ${preRoll.renderAheadState} ${preRoll.renderAheadReadyFrames}/${preRoll.renderAheadTargetFrames}`,
    `ring ${formatReferenceFrames(preRoll.outputRingDepthFrames)}`,
    preRoll.handoffStrategy,
    preRoll.requiresDualPipeline ? 'dual pipeline' : 'same pipeline',
    preRoll.commitAllowed ? 'commit ready' : 'commit waits full profile',
  ]);
};

const formatUzumeCallbackRingReference = (status: AudioStatus | null): string | null => {
  const ring = status?.uzumeReferencePlan?.continuity?.callbackRing;
  if (!ring) {
    return null;
  }

  return joinSpec([
    `${ring.state}/${ring.telemetryStatus}`,
    `depth ${formatReferenceFrames(ring.depthFrames)}`,
    `${trimFixed(ring.depthBlocks, 1)} blocks`,
    `block ${formatReferenceFrames(ring.callbackBlockFrames)}`,
    `missing ${formatReferenceFrames(ring.missingFrames)}`,
    ring.readRule,
    ring.mustNotWaitForGpu ? 'no GPU wait' : null,
    ring.shortBridgeAllowed ? 'short bridge allowed' : `short bridge blocked:${cleanReason(ring.shortBridgeReason)}`,
  ]);
};

const formatUzumeRenderAheadCacheReference = (status: AudioStatus | null): string | null => {
  const cache = status?.uzumeReferencePlan?.continuity?.renderAheadCache;
  if (!cache) {
    return null;
  }

  return joinSpec([
    `${cache.lookupState}->${cache.commitState}`,
    `key ${cache.requestKey}`,
    `cache ${formatReferenceBytes(cache.bytesAfterEvict)}/${formatReferenceBytes(cache.budgetBytes)}`,
    `retained ${cache.retainedKeys.length ? cache.retainedKeys.join('+') : 'none'}`,
    `evictions ${cache.evictionCount}`,
    cache.callbackRule,
    cache.mustNotWaitForGpu ? 'no GPU wait' : null,
  ]);
};

const formatUzumeUnderrunFallbackReference = (status: AudioStatus | null): string | null => {
  const fallback = status?.uzumeReferencePlan?.continuity?.fallback;
  if (!fallback) {
    return null;
  }

  return joinSpec([
    fallback.state,
    `source ${fallback.selectedSource ?? 'none'}`,
    fallback.telemetryStatus,
    `rollback:${fallback.qualityRollback}`,
    fallback.fallbackInjected ? 'fallback injected' : 'full-profile commit',
    fallback.callbackMustNotWaitForGpu ? 'no GPU wait' : null,
    fallback.shortBridgeAllowed ? 'short bridge allowed' : `short bridge blocked:${cleanReason(fallback.shortBridgeReason)}`,
  ]);
};

const formatUzumePath = (status: AudioStatus | null): string | null => {
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
      return status?.dspActive ? 'PCM processed / UZUME skeleton' : null;
  }
};

const formatUzumeRuntimeDetail = (status: AudioStatus | null): string => {
  const parts = [
    status?.uzumeRuntimeModel ?? null,
    status?.uzumeProfile ?? null,
    status?.uzumeDirectDisabledReason ? cleanReason(status.uzumeDirectDisabledReason) : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join(' / ') : 'transitional compatibility chain';
};

const isHqPlayerSignalPath = (connectStatus: ConnectSessionStatus | null | undefined): connectStatus is ConnectSessionStatus =>
  isHqPlayerConnectStatus(connectStatus) && connectStatus.state !== 'idle' && connectStatus.state !== 'unsupported';

const hqPlayerStateLabel = (state: ConnectSessionStatus['state'] | HqPlayerRemotePlaybackStatus['state'] | null | undefined): string => {
  switch (state) {
    case 'connecting':
      return '连接中';
    case 'ready':
      return '已就绪';
    case 'playing':
      return '播放中';
    case 'paused':
      return '已暂停';
    case 'stopped':
    case 'stop-requested':
      return '已停止';
    case 'error':
      return '异常';
    default:
      return '外部处理';
  }
};

const hqPlayerTone = (connectStatus: ConnectSessionStatus): SignalTone => {
  if (connectStatus.state === 'error') {
    return 'danger';
  }

  if (connectStatus.state === 'connecting' || connectStatus.state === 'ready') {
    return 'muted';
  }

  return 'process';
};

const normalizeHqPlayerCodec = (
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
  connectStatus: ConnectSessionStatus,
): string | null => {
  const mimeCodec = playbackStatus?.metadata?.mime?.replace(/^audio\//iu, '').replace(/^x-/iu, '') ?? null;
  return normalizeCodec(track?.codec ?? mimeCodec ?? (connectStatus.metadata ? 'pcm' : null));
};

const hqPlayerSourceLabel = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
): string => {
  const metadata = playbackStatus?.metadata ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus);
  const sampleRate = formatRoonRate(track?.sampleRate ?? metadata?.sampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? metadata?.bits);
  const channels = metadata?.channels && Number.isFinite(metadata.channels) ? `${Math.round(metadata.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], connectStatus.metadata ? 'PCM' : 'HQPlayer 输入').replaceAll(' / ', ' ');
};

const hqPlayerCompactSpec = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  playbackStatus: HqPlayerRemotePlaybackStatus | null,
): string => {
  const metadata = playbackStatus?.metadata ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus);
  const sampleRate = compactRate(track?.sampleRate ?? metadata?.sampleRate);
  const bitDepth = track?.bitDepth ?? metadata?.bits;
  const bitDepthLabel = bitDepth && Number.isFinite(bitDepth) ? `${Math.round(bitDepth)}b` : null;

  return joinSpec([codec, sampleRate, bitDepthLabel], 'HQPlayer');
};

const hqPlayerDspLabel = (status: HqPlayerRemotePlaybackStatus | null): string | null => {
  const modules = [status?.activeMode, status?.activeFilter, status?.activeShaper]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return modules.length ? modules.join(' / ') : null;
};

const hqPlayerOutputLabel = (status: HqPlayerRemotePlaybackStatus | null): string => {
  const outputFormat = joinSpec([
    formatHqPlayerOutputRate(status?.activeRate),
    formatRoonBitDepth(status?.activeBits),
    status?.activeChannels && Number.isFinite(status.activeChannels) ? `${Math.round(status.activeChannels)}ch` : null,
  ], '');

  return outputFormat || '由 HQPlayer 决定';
};

const hasHqPlayerPlaybackDetails = (
  status: HqPlayerRemotePlaybackStatus | null | undefined,
): status is HqPlayerRemotePlaybackStatus =>
  Boolean(status && (
    status.activeRate
    || status.activeBits
    || status.activeChannels
    || status.activeMode?.trim()
    || status.activeFilter?.trim()
    || status.activeShaper?.trim()
    || status.metadata
  ));

const outputModeLabel = (mode: AudioStatus['outputMode'] | null | undefined): string => {
  if (mode === 'asio') {
    return 'ASIO';
  }
  if (mode === 'exclusive') {
    return '独占';
  }
  if (mode === 'system') {
    return '系统音频';
  }
  return '共享';
};

const outputBackendLabel = (backend: string | null | undefined): string | null => {
  const normalized = backend?.trim().replace(/^legacy-/iu, '');
  if (!normalized) {
    return null;
  }

  if (/^wasapi[-_\s]?exclusive$/iu.test(normalized)) {
    return 'WASAPI Exclusive';
  }
  if (/^wasapi[-_\s]?shared$/iu.test(normalized)) {
    return 'WASAPI Shared';
  }
  if (/^asio$/iu.test(normalized)) {
    return 'ASIO';
  }
  if (/^system$/iu.test(normalized)) {
    return 'System Audio';
  }

  return normalized;
};

const sourceLabel = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatBitDepth(track?.bitDepth ?? status?.bitDepth);

  return joinSpec([codec, sampleRate, bitDepth], status ? '音频源' : unknown);
};

const roonSourceLabel = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = formatRoonRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = formatRoonBitDepth(track?.bitDepth ?? status?.bitDepth);
  const channels = status?.channels && Number.isFinite(status.channels) ? `${Math.round(status.channels)}ch` : null;

  return joinSpec([codec, sampleRate, bitDepth, channels], status ? '音频源' : unknown).replaceAll(' / ', ' ');
};

const sourceCompactSpec = (status: AudioStatus | null, track: LibraryTrack | null): string => {
  const codec = normalizeCodec(track?.codec ?? status?.codec);
  const sampleRate = compactRate(track?.sampleRate ?? status?.fileSampleRate);
  const bitDepth = track?.bitDepth ?? status?.bitDepth;
  const bitDepthLabel = bitDepth && Number.isFinite(bitDepth) ? `${Math.round(bitDepth)}` : null;

  return joinSpec([codec, sampleRate, bitDepthLabel ? `${bitDepthLabel}b` : null], 'Signal');
};

const buildDspModules = (status: AudioStatus | null): string[] => {
  if (!status) {
    return [];
  }

  return [
    (status.uzumeHeadroomActive || status.dspActive) && Math.abs(status.dspHeadroomDb ?? 0) > 0.05
      ? `Headroom ${formatDb(status.dspHeadroomDb) ?? ''}`.trim()
      : null,
    status.eqEnabled ? status.eqPresetName ? `EQ ${status.eqPresetName}` : 'EQ' : null,
    status.echoSrcActive ? 'ECHO/SOXR SRC (compat)' : null,
    status.roomCorrectionEnabled ? 'FIR 房间校正 (compat)' : null,
    status.channelBalanceEnabled ? '声道平衡 (compat)' : null,
    status.replayGainEnabled ? `ReplayGain ${formatDb(status.replayGainAppliedDb) ?? ''}`.trim() : null,
    status.dspLimiterProtecting ? '安全限幅' : null,
  ].filter((module): module is string => Boolean(module));
};

export const buildAudioSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null): SignalNode[] => {
  const dspModules = buildDspModules(status);
  const uzumePath = formatUzumePath(status);
  const outputRate = formatRate(status?.actualDeviceSampleRate ?? status?.requestedOutputSampleRate ?? status?.sharedDeviceSampleRate);
  const sourceTone: SignalTone = status ? 'good' : 'muted';
  const decodeTone: SignalTone = status?.resampling ? 'warning' : status ? 'good' : 'muted';
  const dspTone: SignalTone = status?.dspLimiterProtecting || status?.dspClippingRisk ? 'danger' : dspModules.length ? 'warning' : status ? 'good' : 'muted';
  const outputTone: SignalTone = status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted';

  return [
    {
      title: 'Source',
      value: sourceLabel(status, track),
      detail: joinSpec([
        formatChannels(status?.channels),
        formatBitrate(track?.bitrate ?? status?.bitrate),
        track?.mediaType === 'streaming' ? track.provider ?? '在线源' : track?.mediaType === 'remote' ? '远程媒体' : '本地媒体',
      ], status ? '源信息准备中' : unknown),
      icon: Database,
      tone: sourceTone,
    },
    {
      title: 'Decode',
      value: status?.activeDecodeBackendImpl ?? status?.outputBackend ?? '自动解码',
      detail: status?.resampling
        ? `重采样到 ${formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? '输出采样率'}`
        : `保持 ${formatRate(status?.decoderOutputSampleRate ?? status?.fileSampleRate) ?? '原采样率'}`,
      icon: Cpu,
      tone: decodeTone,
    },
    {
      title: 'Process',
      value: dspModules.length ? dspModules.join(' + ') : uzumePath ?? '原生路径',
      detail: dspModules.length
        ? `${uzumePath ?? 'UZUME skeleton'} / ${formatUzumeRuntimeDetail(status)}`
        : `${uzumePath ?? 'PCM bit-perfect'} / ${formatUzumeRuntimeDetail(status)} / 未启用 UZUME section`,
      icon: dspModules.length ? SlidersHorizontal : ShieldCheck,
      tone: dspTone,
    },
    {
      title: 'Output',
      value: status?.outputDeviceName ?? '系统默认设备',
      detail: joinSpec([
        outputModeLabel(status?.outputMode),
        outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
        outputRate,
      ], status ? outputModeLabel(status.outputMode) : unknown),
      icon: Speaker,
      tone: outputTone,
    },
  ];
};

const summaryTone = (status: AudioStatus | null): SignalTone => {
  if (!status) {
    return 'muted';
  }
  if (status.error || status.sampleRateMismatch) {
    return 'danger';
  }
  if (status.dspLimiterProtecting || status.dspClippingRisk) {
    return 'warning';
  }
  if (
    status.resampling
    || status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return 'process';
  }
  return 'good';
};

const getSignalSummary = (status: AudioStatus | null, track: LibraryTrack | null): SignalSummary => {
  const tone = summaryTone(status);
  const spec = sourceCompactSpec(status, track);
  const resamplePath = formatResamplePath(status, track);
  const uzumePath = formatUzumePath(status);

  if (!status) {
    return {
      label: '等待播放',
      detail: '播放后显示链路',
      spec,
      tone,
    };
  }
  if (status.error) {
    return {
      label: '链路异常',
      detail: cleanReason(status.error) ?? '需要检查输出',
      spec,
      tone,
    };
  }
  if (status.sampleRateMismatch) {
    return {
      label: '采样率不一致',
      detail: '源与设备不一致',
      spec,
      tone,
    };
  }
  if (status.dspLimiterProtecting) {
    return {
      label: '保护中',
      detail: '限幅保护输出',
      spec,
      tone,
    };
  }
  if (status.echoSrcActive) {
    return {
      label: '升频',
      detail: `${formatEchoSrcPath(status, track) ?? 'ECHO/SOXR SRC active'} / 兼容路径`,
      spec,
      tone,
    };
  }
  if (status.uzumeFormatPath === 'dsd_direct' || status.activeDsdOutputMode === 'dop' || status.activeDsdOutputMode === 'native') {
    return {
      label: 'DSD direct',
      detail: uzumePath ?? 'DSD direct',
      spec,
      tone,
    };
  }
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return {
      label: 'UZUME skeleton',
      detail: buildDspModules(status).slice(0, 2).join(' + ') || uzumePath || formatUzumeRuntimeDetail(status),
      spec,
      tone,
    };
  }
  if (status.resampling) {
    return {
      label: '重采样',
      detail: resamplePath ?? `到 ${formatRate(status.decoderOutputSampleRate ?? status.requestedOutputSampleRate) ?? '输出采样率'}`,
      spec,
      tone,
    };
  }
  if (status.bitPerfectCandidate) {
    return {
      label: '纯净候选',
      detail: `${outputModeLabel(status.outputMode)}输出`,
      spec,
      tone,
    };
  }

  return {
    label: '原生播放',
    detail: '未启用 UZUME',
    spec,
    tone,
  };
};

const getRoonPathLabel = (status: AudioStatus | null): string => {
  if (!status) {
    return '等待';
  }
  if (status.error || status.sampleRateMismatch) {
    return '异常';
  }
  if (status.dspLimiterProtecting || status.dspClippingRisk) {
    return '保护中';
  }
  if (status.uzumeFormatPath === 'dsd_direct' || status.activeDsdOutputMode === 'dop' || status.activeDsdOutputMode === 'native') {
    return 'DSD direct';
  }
  if (
    status.dspActive
    || status.eqEnabled
    || status.roomCorrectionEnabled
    || status.channelBalanceEnabled
    || status.replayGainEnabled
  ) {
    return 'UZUME skeleton';
  }
  if (status.resampling) {
    return '重采样';
  }
  return '无损';
};

const getDisplayRoonPathLabel = (status: AudioStatus | null): string =>
  status?.echoSrcActive ? '升频' : getRoonPathLabel(status);

const outputLabel = (status: AudioStatus | null): string => {
  if (!status) {
    return unknown;
  }
  if (status.outputMode === 'asio') {
    return 'ASIO 输出';
  }
  if (status.outputMode === 'exclusive') {
    return '独占输出';
  }
  if (status.outputMode === 'system') {
    return '系统输出';
  }
  return '共享输出';
};

const outputBitDepthLabel = (format: string | null | undefined): string => {
  const normalized = format?.toLowerCase() ?? '';

  if (normalized.includes('16')) {
    return '16bit';
  }
  if (normalized.includes('24')) {
    return '24bit';
  }
  return '32bit';
};

const buildRoonProcessingNodes = (status: AudioStatus | null, track: LibraryTrack | null): RoonSignalNode[] => {
  if (!status) {
    return [];
  }

  const nodes: RoonSignalNode[] = [];
  const echoSrcPath = formatEchoSrcPath(status, track);
  const resamplePath = echoSrcPath ? null : formatResamplePath(status, track);
  const referencePlan = status.uzumeReferencePlan;
  const referenceAssignments = formatUzumeReferenceAssignments(status);
  const referenceMergeGroups = formatUzumeReferenceMergeGroups(status);
  const referenceLatencyOwners = formatUzumeReferenceLatencyOwners(status);
  const referencePathPlan = formatUzumeReferencePathPlan(status);
  const referenceBitPerfect = formatUzumeReferenceBitPerfect(status);
  const referenceBackendSupport = formatUzumeReferenceBackendSupport(status);
  const referenceOutputDevicePolicy = formatUzumeReferenceOutputDevicePolicy(status);
  const referenceLatencyBudget = formatUzumeReferenceLatencyBudget(status);
  const referenceReadinessContract = formatUzumeReferenceReadinessContract(status);
  const referenceGenerationCacheKey = formatUzumeReferenceGenerationCacheKey(status);
  const referenceRealtimeBudgetSummary = formatUzumeReferenceRealtimeBudgetSummary(status);
  const referenceResampling = formatUzumeReferenceResampling(status);
  const referenceSrcRollback = formatUzumeReferenceSrcRollback(status);
  const referenceSrcBudget = formatUzumeReferenceSrcBudget(status);
  const referenceSrcArtifacts = formatUzumeReferenceSrcArtifacts(status);
  const referenceSrcValidation = formatUzumeReferenceSrcValidation(status);
  const referenceSrcOutputRisk = formatUzumeReferenceSrcOutputRisk(status);
  const referenceSrcPhaseApodizing = formatUzumeReferenceSrcPhaseApodizing(status);
  const referenceDsdFamily = formatUzumeReferenceDsdFamily(status);
  const referenceConvolution = formatUzumeReferenceConvolution(status);
  const referenceResponseResample = formatUzumeReferenceResponseResample(status);
  const referenceConvolutionDuplicateGuard = formatUzumeReferenceConvolutionDuplicateGuard(status);
  const referenceConvolutionSerialNull = formatUzumeReferenceConvolutionSerialNull(status);
  const referencePcmOutputQuantization = formatUzumeReferencePcmOutputQuantization(status);
  const referencePcmIngressGuard = formatUzumeReferencePcmIngressGuard(status);
  const referenceGainStaging = formatUzumeReferenceGainStaging(status);
  const referenceIirEq = formatUzumeReferenceIirEq(status);
  const referenceChannelScope = formatUzumeReferenceChannelScope(status);
  const referenceStereoProcedural = formatUzumeReferenceStereoProcedural(status);
  const referencePerEarEqPlacement = formatUzumeReferencePerEarEqPlacement(status);
  const referenceBlockBoundary = formatUzumeReferenceBlockBoundary(status);
  const referenceFlushDrain = formatUzumeReferenceFlushDrain(status);
  const referenceGaplessConcat = formatUzumeReferenceGaplessConcat(status);
  const referenceFirGaplessHistory = formatUzumeReferenceFirGaplessHistory(status);
  const referenceCallbackSafeControls = formatUzumeReferenceCallbackSafeControls(status);
  const referenceEqualPowerCrossfade = formatUzumeReferenceEqualPowerCrossfade(status);
  const referenceContinuity = formatUzumeContinuityReference(status);
  const referencePreRoll = formatUzumePreRollReference(status);
  const referenceCallbackRing = formatUzumeCallbackRingReference(status);
  const referenceRenderAheadCache = formatUzumeRenderAheadCacheReference(status);
  const referenceUnderrunFallback = formatUzumeUnderrunFallbackReference(status);
  const referenceHeadroom = formatUzumeHeadroomReference(status);
  const referenceSafetyMeter = formatUzumeSafetyMeterReference(status);
  const referenceLimiter = formatUzumeLimiterReference(status);

  if (echoSrcPath) {
    nodes.push({
      badge: '',
      title: 'ECHO/SOXR SRC (compat)',
      value: echoSrcPath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (resamplePath) {
    nodes.push({
      badge: '',
      title: '重采样',
      value: resamplePath,
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.replayGainEnabled) {
    nodes.push({
      badge: '',
      title: '音量标准化',
      value: joinSpec([
        'ReplayGain',
        formatDb(status.replayGainAppliedDb),
      ], 'ReplayGain'),
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.channelBalanceEnabled) {
    nodes.push({
      badge: '',
      title: '声道处理',
      value: '声道平衡',
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.roomCorrectionEnabled) {
    nodes.push({
      badge: '',
      title: '房间校正',
      value: 'FIR / 声学处理',
      tone: 'process',
      variant: 'process',
    });
  }

  if (status.eqEnabled) {
    nodes.push({
      badge: '',
      title: '参数化 EQ',
      value: '5 个频段',
      tone: 'process',
      variant: 'process',
    });
  }

  if (referencePlan) {
    nodes.push({
      badge: '',
      title: 'UZUME reference compiler',
      value: `schema v${referencePlan.schemaVersion} / telemetry v${referencePlan.telemetrySchemaVersion} / ${referencePlan.formatPath} / ${referencePlan.internalDomain}`,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceAssignments) {
    nodes.push({
      badge: '',
      title: 'Reference assignment',
      value: referenceAssignments,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referencePathPlan) {
    nodes.push({
      badge: '',
      title: 'UZUME reference path plan',
      value: referencePathPlan,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceBitPerfect) {
    nodes.push({
      badge: '',
      title: 'UZUME reference bit-perfect',
      value: referenceBitPerfect,
      tone: referencePlan?.bitPerfectState === 'available' ? 'process' : 'warning',
      variant: 'process',
    });
  }

  if (referenceBackendSupport) {
    nodes.push({
      badge: '',
      title: 'UZUME backend support reference',
      value: referenceBackendSupport,
      tone: 'warning',
      variant: 'process',
    });
  }

  if (referenceOutputDevicePolicy) {
    nodes.push({
      badge: '',
      title: 'UZUME output device policy reference',
      value: referenceOutputDevicePolicy,
      tone: referencePlan?.outputDevicePolicy.state === 'direct-like-ready' ? 'process' : 'warning',
      variant: 'process',
    });
  }

  if (referenceLatencyBudget) {
    nodes.push({
      badge: '',
      title: 'UZUME latency budget reference',
      value: referenceLatencyBudget,
      tone: 'warning',
      variant: 'process',
    });
  }

  if (referenceReadinessContract) {
    nodes.push({
      badge: '',
      title: 'UZUME readiness contract reference',
      value: referenceReadinessContract,
      tone: referencePlan?.readinessContract.state === 'ready-to-commit' || referencePlan?.readinessContract.state === 'cache-ready' ? 'process' : 'warning',
      variant: 'process',
    });
  }

  if (referenceGenerationCacheKey) {
    nodes.push({
      badge: '',
      title: 'UZUME generation cache key reference',
      value: referenceGenerationCacheKey,
      tone: 'warning',
      variant: 'process',
    });
  }

  if (referenceRealtimeBudgetSummary) {
    nodes.push({
      badge: '',
      title: 'UZUME realtime budget summary',
      value: referenceRealtimeBudgetSummary,
      tone: referencePlan?.realtimeBudgetSummary.state === 'offline-reference-only' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referencePcmIngressGuard) {
    nodes.push({
      badge: '',
      title: 'UZUME PCM ingress guard reference',
      value: referencePcmIngressGuard,
      tone: referencePlan?.pcmIngressGuard.state === 'channel-mismatch' || referencePlan?.pcmIngressGuard.state === 'sanitized'
        ? 'warning'
        : 'process',
      variant: 'process',
    });
  }

  if (referenceGainStaging) {
    nodes.push({
      badge: '',
      title: 'UZUME gain staging reference',
      value: referenceGainStaging,
      tone: referencePlan?.gainStaging.clipRisk || Math.abs(referencePlan?.gainStaging.totalGainDb ?? 0) > 0.001
        ? 'warning'
        : 'process',
      variant: 'process',
    });
  }

  if (referenceIirEq) {
    nodes.push({
      badge: '',
      title: 'UZUME PEQ/IIR reference',
      value: referenceIirEq,
      tone: referencePlan?.iirEq.state === 'active' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceChannelScope) {
    nodes.push({
      badge: '',
      title: 'UZUME channel scope reference',
      value: referenceChannelScope,
      tone: referencePlan?.channelScope.invalidOperationCount || referencePlan?.channelScope.appliedOperationCount
        ? 'warning'
        : 'process',
      variant: 'process',
    });
  }

  if (referenceStereoProcedural) {
    nodes.push({
      badge: '',
      title: 'UZUME stereo procedural reference',
      value: referenceStereoProcedural,
      tone: referencePlan?.stereoProcedural.state === 'active' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referencePerEarEqPlacement) {
    nodes.push({
      badge: '',
      title: 'UZUME per-ear EQ placement reference',
      value: referencePerEarEqPlacement,
      tone: referencePlan?.perEarEqPlacement.state === 'placement-sensitive' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceBlockBoundary) {
    nodes.push({
      badge: '',
      title: 'UZUME block boundary reference',
      value: referenceBlockBoundary,
      tone: referencePlan?.blockBoundary.coverage.state === 'exact' &&
        referencePlan?.blockBoundary.residual.state === 'exact-reassembly' ? 'process' : 'warning',
      variant: 'process',
    });
  }

  if (referenceFlushDrain) {
    nodes.push({
      badge: '',
      title: 'UZUME flush/drain reference',
      value: referenceFlushDrain,
      tone: 'warning',
      variant: 'process',
    });
  }

  if (referenceGaplessConcat) {
    nodes.push({
      badge: '',
      title: 'UZUME gapless SRC reference',
      value: referenceGaplessConcat,
      tone: referencePlan?.gaplessConcat.state === 'src-stateful' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceFirGaplessHistory) {
    nodes.push({
      badge: '',
      title: 'UZUME FIR gapless reference',
      value: referenceFirGaplessHistory,
      tone: referencePlan?.firGaplessHistory.state === 'history-required' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceCallbackSafeControls) {
    nodes.push({
      badge: '',
      title: 'UZUME urgent controls reference',
      value: referenceCallbackSafeControls,
      tone: 'warning',
      variant: 'process',
    });
  }

  if (referenceEqualPowerCrossfade) {
    nodes.push({
      badge: '',
      title: 'UZUME equal-power crossfade reference',
      value: referenceEqualPowerCrossfade,
      tone: referencePlan?.equalPowerCrossfade.rendered.state === 'crossfade-rendered' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceDsdFamily) {
    nodes.push({
      badge: '',
      title: 'UZUME DSD family reference',
      value: referenceDsdFamily,
      tone: referencePlan?.dsdFamily?.state === 'unavailable'
        ? 'warning'
        : referencePlan?.dsdFamily?.state === 'direct' ? 'good' : 'process',
      variant: 'process',
    });
  }

  if (referenceMergeGroups) {
    nodes.push({
      badge: '',
      title: 'Reference merge groups',
      value: referenceMergeGroups,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceLatencyOwners) {
    nodes.push({
      badge: '',
      title: 'Reference latency owners',
      value: referenceLatencyOwners,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceResampling) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC reference',
      value: referenceResampling,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceSrcRollback) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC rollback reference',
      value: referenceSrcRollback,
      tone: referencePlan?.resampling.qualityRollback.state === 'armed' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceSrcBudget) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC budget reference',
      value: referenceSrcBudget,
      tone: referencePlan?.resampling.artifactMetrics.realtimeBudget.safetyClass === 'offline-reference-only' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceSrcArtifacts) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC artifact reference',
      value: referenceSrcArtifacts,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceSrcValidation) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC validation reference',
      value: referenceSrcValidation,
      tone: referencePlan?.resampling.validation?.overall === 'fail'
        ? 'danger'
        : referencePlan?.resampling.validation?.overall === 'warn' ? 'warning' : 'good',
      variant: 'process',
    });
  }

  if (referenceSrcOutputRisk) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC output risk reference',
      value: referenceSrcOutputRisk,
      tone: referencePlan?.resampling.outputResamplingRisk.signalPathTone === 'warning' ? 'warning' : 'good',
      variant: 'process',
    });
  }

  if (referenceSrcPhaseApodizing) {
    nodes.push({
      badge: '',
      title: 'UZUME SRC phase/apodizing reference',
      value: referenceSrcPhaseApodizing,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceConvolution) {
    nodes.push({
      badge: '',
      title: 'UZUME convolution reference',
      value: referenceConvolution,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceResponseResample) {
    nodes.push({
      badge: '',
      title: 'UZUME response resample reference',
      value: referenceResponseResample,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceConvolutionDuplicateGuard) {
    nodes.push({
      badge: '',
      title: 'UZUME convolution duplicate guard',
      value: referenceConvolutionDuplicateGuard,
      tone: referencePlan?.sharedConvolution.duplicatePlanGuard?.state === 'inactive' ? 'muted' : 'warning',
      variant: 'process',
    });
  }

  if (referenceConvolutionSerialNull) {
    nodes.push({
      badge: '',
      title: 'UZUME convolution serial null reference',
      value: referenceConvolutionSerialNull,
      tone: referencePlan?.sharedConvolution.serialNullReference?.state === 'merged-matches-serial'
        ? 'good'
        : referencePlan?.sharedConvolution.serialNullReference?.state === 'residual-over-threshold' ? 'danger' : 'muted',
      variant: 'process',
    });
  }

  if (referencePcmOutputQuantization) {
    nodes.push({
      badge: '',
      title: 'UZUME PCM output quantization reference',
      value: referencePcmOutputQuantization,
      tone: referencePlan?.pcmOutputQuantization.state === 'rejected'
        ? 'warning'
        : referencePlan?.pcmOutputQuantization.dither.enabled ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceContinuity) {
    nodes.push({
      badge: '',
      title: 'UZUME continuity reference',
      value: referenceContinuity,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referencePreRoll) {
    nodes.push({
      badge: '',
      title: 'UZUME pre-roll reference',
      value: referencePreRoll,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceCallbackRing) {
    nodes.push({
      badge: '',
      title: 'UZUME callback ring reference',
      value: referenceCallbackRing,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceRenderAheadCache) {
    nodes.push({
      badge: '',
      title: 'UZUME render-ahead cache',
      value: referenceRenderAheadCache,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceUnderrunFallback) {
    nodes.push({
      badge: '',
      title: 'UZUME underrun fallback reference',
      value: referenceUnderrunFallback,
      tone: status.uzumeReferencePlan?.continuity?.fallback.telemetryStatus === 'unsafe' ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceHeadroom) {
    nodes.push({
      badge: '',
      title: 'UZUME headroom reference',
      value: referenceHeadroom,
      tone: 'process',
      variant: 'process',
    });
  }

  if (referenceSafetyMeter) {
    nodes.push({
      badge: '',
      title: 'UZUME safety meter',
      value: referenceSafetyMeter,
      tone: status.dspLimiterProtecting ? 'danger' : status.dspClippingRisk ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (referenceLimiter) {
    nodes.push({
      badge: '',
      title: 'UZUME limiter reference',
      value: referenceLimiter,
      tone: status.dspLimiterProtecting ? 'danger' : status.dspClippingRisk ? 'warning' : 'process',
      variant: 'process',
    });
  }

  if (nodes.length || status.dspActive) {
    nodes.push({
      badge: '',
      title: '比特位深转换',
      value: `64bit Float 至 ${outputBitDepthLabel(status.nativeOutputFormat)}`,
      tone: 'process',
      variant: 'process',
    });
  }

  return nodes;
};

const buildRoonSignalPathNodes = (status: AudioStatus | null, track: LibraryTrack | null): RoonSignalNode[] => {
  const codec = normalizeCodec(track?.codec ?? status?.codec) ?? 'SRC';
  const processingNodes = buildRoonProcessingNodes(status, track);
  const transport = joinSpec([
    outputModeLabel(status?.outputMode),
    outputBackendLabel(status?.activeOutputBackendImpl ?? status?.outputBackend),
  ], status ? outputModeLabel(status.outputMode) : unknown);
  const outputDetail = joinSpec([
    outputLabel(status),
    formatRoonRate(status?.actualDeviceSampleRate ?? status?.sharedDeviceSampleRate ?? status?.requestedOutputSampleRate),
  ], outputLabel(status));

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: '数据源',
      value: roonSourceLabel(status, track),
      tone: status ? 'good' : 'muted',
    },
    ...processingNodes,
    {
      badge: '',
      title: status?.outputDeviceName ?? '播放设备',
      value: transport,
      icon: Waves,
      tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
    },
    {
      badge: '',
      title: '输出',
      value: outputDetail,
      icon: Speaker,
      tone: status?.sampleRateMismatch || status?.error ? 'danger' : status ? 'good' : 'muted',
    },
  ];
};

const getHqPlayerSignalSummary = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
): SignalSummary => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const tone = hqPlayerTone(connectStatus);
  const dsp = hqPlayerDspLabel(playbackStatus);
  const output = hqPlayerOutputLabel(playbackStatus);

  const detail = cleanReason(connectStatus.error)
    ?? (dsp
      ? `${output} / ${dsp}`
      : `${hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state)} / 外部处理链`);

  return {
    label: connectStatus.state === 'error' ? 'HQPlayer 异常' : 'HQPlayer',
    detail,
    spec: hqPlayerCompactSpec(connectStatus, track, playbackStatus),
    tone,
  };
};

const getResolvedSignalSummary = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
): SignalSummary =>
  isHqPlayerSignalPath(connectStatus)
    ? getHqPlayerSignalSummary(connectStatus, track, hqPlayerStatus)
    : getSignalSummary(status, track);

const buildHqPlayerSignalPathNodes = (
  connectStatus: ConnectSessionStatus,
  track: LibraryTrack | null,
  hqPlayerStatus: HqPlayerStatus | null,
): RoonSignalNode[] => {
  const playbackStatus = hqPlayerStatus?.playbackStatus ?? null;
  const codec = normalizeHqPlayerCodec(track, playbackStatus, connectStatus) ?? 'HQ';
  const product = hqPlayerStatus?.controlInfo?.product?.trim() || 'HQPlayer Desktop';
  const dsp = hqPlayerDspLabel(playbackStatus);
  const playbackState = hqPlayerStateLabel(playbackStatus?.state ?? connectStatus.state);
  const output = hqPlayerOutputLabel(playbackStatus);
  const sourceTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'good';
  const processTone: SignalTone = connectStatus.state === 'error' ? 'danger' : 'process';

  return [
    {
      badge: codec.length > 4 ? codec.slice(0, 4) : codec,
      title: '数据源',
      value: hqPlayerSourceLabel(connectStatus, track, playbackStatus),
      tone: sourceTone,
    },
    {
      badge: '',
      title: product,
      value: dsp ?? `${playbackState} / 外部处理链`,
      icon: SlidersHorizontal,
      tone: processTone,
      variant: 'process',
    },
    {
      badge: '',
      title: '输出',
      value: output === '由 HQPlayer 决定' ? `${output} / 外部渲染` : `HQPlayer 输出 / ${output}`,
      icon: Speaker,
      tone: processTone,
    },
  ];
};

const buildResolvedSignalPathNodes = (
  status: AudioStatus | null,
  track: LibraryTrack | null,
  connectStatus: ConnectSessionStatus | null | undefined,
  hqPlayerStatus: HqPlayerStatus | null,
): RoonSignalNode[] =>
  isHqPlayerSignalPath(connectStatus)
    ? buildHqPlayerSignalPathNodes(connectStatus, track, hqPlayerStatus)
    : buildRoonSignalPathNodes(status, track);

const getDisplaySignalPathLabel = (status: AudioStatus | null, connectStatus: ConnectSessionStatus | null | undefined): string => {
  if (!isHqPlayerSignalPath(connectStatus)) {
    return getDisplayRoonPathLabel(status);
  }

  return connectStatus.state === 'error' ? 'HQPlayer 异常' : 'HQPlayer';
};

export const AudioSignalPathControl = ({
  isOpen,
  status,
  track,
  connectStatus,
  onClick,
}: AudioSignalPathControlProps): JSX.Element => {
  const summary = getResolvedSignalSummary(status, track, connectStatus, null);
  const label = `打开音频链路：${summary.label}，${summary.spec}`;

  return (
    <button
      className="signal-path-control"
      type="button"
      data-tone={summary.tone}
      aria-label={label}
      aria-expanded={isOpen}
      title={label}
      onClick={onClick}
    >
      <span className="signal-path-control__mark" aria-hidden="true">
        <Waves size={16} />
      </span>
      <span className="signal-path-control__status-dot" aria-hidden="true" />
    </button>
  );
};

export const AudioSignalPathPopover = ({
  isOpen,
  status,
  track,
  connectStatus,
  onClose,
}: AudioSignalPathPopoverProps): JSX.Element | null => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [hqPlayerStatus, setHqPlayerStatus] = useState<HqPlayerStatus | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hqPlayerSignalActive = isHqPlayerSignalPath(connectStatus);
  const hqPlayerSessionKey = hqPlayerSignalActive
    ? `${connectStatus.deviceId}:${connectStatus.currentTrackId ?? ''}`
    : null;

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (isOpen) {
      setShouldRender(true);
      return undefined;
    }

    if (!shouldRender) {
      return undefined;
    }

    closeTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
      closeTimerRef.current = null;
    }, signalPathPopoverExitMs);

    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isOpen, shouldRender]);

  useEffect(() => {
    setHqPlayerStatus(null);
  }, [hqPlayerSessionKey]);

  useEffect(() => {
    if (!hqPlayerSignalActive) {
      setHqPlayerStatus(null);
      return undefined;
    }

    if (!isOpen) {
      return undefined;
    }

    let cancelled = false;
    const refreshHqPlayerStatus = (): void => {
      const getStatus = window.echo?.hqPlayer?.getStatus;
      if (!getStatus) {
        return;
      }

      void getStatus()
        .then((nextStatus) => {
          if (!cancelled) {
            setHqPlayerStatus((previousStatus) => {
              if (hasHqPlayerPlaybackDetails(nextStatus.playbackStatus)) {
                return nextStatus;
              }

              if (previousStatus && hasHqPlayerPlaybackDetails(previousStatus.playbackStatus)) {
                return {
                  ...nextStatus,
                  controlInfo: nextStatus.controlInfo ?? previousStatus.controlInfo,
                  playbackStatus: previousStatus.playbackStatus,
                };
              }

              return nextStatus;
            });
          }
        })
        .catch(() => undefined);
    };

    refreshHqPlayerStatus();
    const interval = window.setInterval(refreshHqPlayerStatus, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hqPlayerSessionKey, hqPlayerSignalActive, isOpen]);

  if (!shouldRender) {
    return null;
  }

  const nodes = buildResolvedSignalPathNodes(status, track, connectStatus, hqPlayerStatus);
  const summary = getResolvedSignalSummary(status, track, connectStatus, hqPlayerStatus);
  const pathLabel = getDisplaySignalPathLabel(status, connectStatus);

  return (
    <section
      className="signal-path-popover signal-path-popover--roon"
      role="dialog"
      aria-label="信号路径"
      data-state={isOpen ? 'open' : 'closing'}
      data-tone={summary.tone}
    >
      <header className="signal-path-roon-header">
        <div>
          <h3>信号路径: {pathLabel}</h3>
          <p>{summary.detail}</p>
        </div>
        <button className="signal-path-roon-menu" type="button" aria-label="关闭信号路径" title="关闭" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="signal-path-roon-name" data-tone={summary.tone}>
        <span title={summary.spec}>{summary.spec}</span>
        <em>{nodes.length} 层链路</em>
      </div>

      <div className="signal-path-roon-chain">
        {nodes.map((node, index) => {
          const Icon = node.icon;

          return (
            <article
              className="signal-path-roon-node"
              data-tone={node.tone}
              data-variant={node.variant ?? 'circle'}
              key={`${node.title}-${index}`}
            >
              <span className="signal-path-roon-node__badge" aria-hidden="true">
                {Icon ? <Icon size={21} fill={node.title === '输出' ? 'currentColor' : 'none'} /> : node.badge}
              </span>
              <span className="signal-path-roon-node__line" aria-hidden="true" />
              <div className="signal-path-roon-node__copy">
                <span className="signal-path-roon-node__title">
                  <strong title={node.title} data-scroll={node.title.length > 22 ? 'true' : 'false'}>
                    <span>{node.title}</span>
                  </strong>
                </span>
                <em title={node.value}>{node.value}</em>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
