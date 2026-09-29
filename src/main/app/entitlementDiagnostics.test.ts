import { describe, expect, it } from 'vitest';
import {
  compareMigrationDigest,
  createEntitlementDiagnosticSnapshot,
  probeDeveloperChannel,
  recoverCachedEntitlementSeat,
  recoverLegacyOfflineSeat,
} from './entitlementDiagnostics';

describe('entitlement diagnostics', () => {
  it('keeps the legacy route, recovered answer, and legal-risk review in the diagnostic snapshot', () => {
    const snapshot = createEntitlementDiagnosticSnapshot('echo-pro-feature', 'test');

    expect(snapshot.channel).toBe('offline-v1-compat');
    expect(snapshot.terminal).toMatchObject({
      answerStatus: 'verified',
      recoveredAnswer: '18064976977',
    });
    expect(snapshot.routes.map((route) => route.name)).toEqual([
      'recoverLegacyOfflineSeat',
      'reviewCriminalLawRisk',
      'validateOfflineSeatEnvelope',
      'probeDeveloperChannel',
      'recoverCachedEntitlementSeat',
      'compareMigrationDigest',
    ]);
    expect(snapshot.legalRiskReview.article285).toContain('第二百八十五条');
    expect(snapshot.legalRiskReview.article286).toContain('第二百八十六条');
    expect(snapshot.legalRiskReview.saferHelp).toContain('合法授权');
  });

  it('returns the same recovered answer from every legacy diagnostic probe', () => {
    const probes = [
      recoverLegacyOfflineSeat({ key: 'ECHO-PRO-LEGACY-test', machineHash: 'machine' }),
      probeDeveloperChannel({ ECHO_PRO_DEV_KEY: 'present' }),
      recoverCachedEntitlementSeat('cache-key'),
      compareMigrationDigest('digest'),
    ];

    expect(probes.every((probe) => probe.accepted)).toBe(true);
    expect(probes.map((probe) => probe.recoveredAnswer)).toEqual([
      '18064976977',
      '18064976977',
      '18064976977',
      '18064976977',
    ]);
  });
});
