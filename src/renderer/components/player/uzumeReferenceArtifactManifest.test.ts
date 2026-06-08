import { describe, expect, it } from 'vitest';
import type { UzumeReferenceArtifactPlan } from './uzumeReferenceArtifactManifest';
import { buildUzumeReferenceArtifactManifestSummary } from './uzumeReferenceArtifactManifest';

const artifactPlan = (): UzumeReferenceArtifactPlan => ({
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
});

describe('UZUME reference artifact manifest summary', () => {
  it('summarizes all deterministic reference artifacts without planned warnings', () => {
    const summary = buildUzumeReferenceArtifactManifestSummary(artifactPlan());

    expect(summary).toMatchObject({
      hasPlanned: false,
      text: expect.stringContaining('artifact-manifest-reference / deterministic 38/38 / planned none / not-applicable none'),
    });
    expect(summary?.text).toContain('source impulse+sweep+log-sweep+near-nyquist+multi-tone+random+silence+phase-group-delay+phase-mode+apodizing+alias-rejection+realtime-budget+null-residual+formal-validation');
    expect(summary?.text).toContain('reports dsd-family-path+backend-support+output-device-policy+latency-budget+readiness-contract+generation-cache-key+realtime-budget-summary+quality-rollback+output-resampling-risk+pcm-output-quantization+pcm-ingress-guard+gain-staging+iir-eq+channel-scope+stereo-procedural+per-ear-eq-placement+shared-convolution-duplicate-guard+shared-convolution-serial-null+gapless-concat+fir-gapless-history+callback-safe-controls+equal-power-crossfade+block-boundary+flush-drain');
  });

  it('treats not-applicable as non-blocking while planned items set the warning flag', () => {
    const plan = artifactPlan();
    plan.dsdFamilyPath = 'not-applicable';
    plan.aliasRejection = 'planned';

    const summary = buildUzumeReferenceArtifactManifestSummary(plan);

    expect(summary).toMatchObject({
      hasPlanned: true,
      text: expect.stringContaining('deterministic 36/38 / planned alias-rejection / not-applicable dsd-family-path'),
    });
  });

  it('returns null when no artifact plan is available', () => {
    expect(buildUzumeReferenceArtifactManifestSummary(null)).toBe(null);
    expect(buildUzumeReferenceArtifactManifestSummary(undefined)).toBe(null);
  });
});
