import type { AudioStatus } from '../../../shared/types/audio';

export type UzumeReferenceArtifactPlan = NonNullable<NonNullable<AudioStatus['uzumeReferencePlan']>['artifactPlan']>;
type UzumeReferenceArtifactManifestGroup = 'source' | 'report';

type UzumeReferenceArtifactManifestEntry = {
  key: keyof UzumeReferenceArtifactPlan;
  label: string;
  group: UzumeReferenceArtifactManifestGroup;
};

export type UzumeReferenceArtifactManifestSummary = {
  text: string;
  hasPlanned: boolean;
};

const uzumeReferenceArtifactManifestEntries: ReadonlyArray<UzumeReferenceArtifactManifestEntry> = [
  { key: 'impulse', label: 'impulse', group: 'source' },
  { key: 'sweep', label: 'sweep', group: 'source' },
  { key: 'logSweep', label: 'log-sweep', group: 'source' },
  { key: 'nearNyquist', label: 'near-nyquist', group: 'source' },
  { key: 'multiTone', label: 'multi-tone', group: 'source' },
  { key: 'random', label: 'random', group: 'source' },
  { key: 'silence', label: 'silence', group: 'source' },
  { key: 'phaseGroupDelay', label: 'phase-group-delay', group: 'source' },
  { key: 'phaseMode', label: 'phase-mode', group: 'source' },
  { key: 'apodizing', label: 'apodizing', group: 'source' },
  { key: 'aliasRejection', label: 'alias-rejection', group: 'source' },
  { key: 'realtimeBudget', label: 'realtime-budget', group: 'source' },
  { key: 'nullResidual', label: 'null-residual', group: 'source' },
  { key: 'formalValidation', label: 'formal-validation', group: 'source' },
  { key: 'dsdFamilyPath', label: 'dsd-family-path', group: 'report' },
  { key: 'backendSupport', label: 'backend-support', group: 'report' },
  { key: 'outputDevicePolicy', label: 'output-device-policy', group: 'report' },
  { key: 'latencyBudget', label: 'latency-budget', group: 'report' },
  { key: 'readinessContract', label: 'readiness-contract', group: 'report' },
  { key: 'generationCacheKey', label: 'generation-cache-key', group: 'report' },
  { key: 'realtimeBudgetSummary', label: 'realtime-budget-summary', group: 'report' },
  { key: 'qualityRollback', label: 'quality-rollback', group: 'report' },
  { key: 'outputResamplingRisk', label: 'output-resampling-risk', group: 'report' },
  { key: 'pcmOutputQuantization', label: 'pcm-output-quantization', group: 'report' },
  { key: 'pcmIngressGuard', label: 'pcm-ingress-guard', group: 'report' },
  { key: 'gainStaging', label: 'gain-staging', group: 'report' },
  { key: 'headroomSafetyLimiter', label: 'headroom-safety-limiter', group: 'report' },
  { key: 'iirEq', label: 'iir-eq', group: 'report' },
  { key: 'channelScope', label: 'channel-scope', group: 'report' },
  { key: 'stereoProcedural', label: 'stereo-procedural', group: 'report' },
  { key: 'perEarEqPlacement', label: 'per-ear-eq-placement', group: 'report' },
  { key: 'sharedConvolutionDuplicateGuard', label: 'shared-convolution-duplicate-guard', group: 'report' },
  { key: 'sharedConvolutionSerialNull', label: 'shared-convolution-serial-null', group: 'report' },
  { key: 'gaplessConcat', label: 'gapless-concat', group: 'report' },
  { key: 'firGaplessHistory', label: 'fir-gapless-history', group: 'report' },
  { key: 'callbackSafeControls', label: 'callback-safe-controls', group: 'report' },
  { key: 'equalPowerCrossfade', label: 'equal-power-crossfade', group: 'report' },
  { key: 'blockBoundary', label: 'block-boundary', group: 'report' },
  { key: 'flushDrain', label: 'flush-drain', group: 'report' },
];

const formatManifestLabels = (labels: string[]): string => labels.length ? labels.join('+') : 'none';

export const buildUzumeReferenceArtifactManifestSummary = (
  plan: UzumeReferenceArtifactPlan | null | undefined,
): UzumeReferenceArtifactManifestSummary | null => {
  if (!plan) {
    return null;
  }

  const deterministic = uzumeReferenceArtifactManifestEntries.filter(({ key }) => plan[key] === 'deterministic-reference');
  const planned = uzumeReferenceArtifactManifestEntries.filter(({ key }) => plan[key] === 'planned');
  const notApplicable = uzumeReferenceArtifactManifestEntries.filter(({ key }) => plan[key] === 'not-applicable');
  const source = uzumeReferenceArtifactManifestEntries.filter(({ group }) => group === 'source').map(({ label }) => label);
  const reports = uzumeReferenceArtifactManifestEntries.filter(({ group }) => group === 'report').map(({ label }) => label);

  return {
    text: [
      'artifact-manifest-reference',
      `deterministic ${deterministic.length}/${uzumeReferenceArtifactManifestEntries.length}`,
      `planned ${formatManifestLabels(planned.map(({ label }) => label))}`,
      `not-applicable ${formatManifestLabels(notApplicable.map(({ label }) => label))}`,
      `source ${source.join('+')}`,
      `reports ${reports.join('+')}`,
    ].join(' / '),
    hasPlanned: planned.length > 0,
  };
};
