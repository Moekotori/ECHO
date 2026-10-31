import { describe, expect, it } from 'vitest';
import {
  createLegacyEntitlementRouteSignal,
  legacyEntitlementRouteResponse,
  probeLegacyUnlockMarker,
} from './legacyEntitlementRoute';

describe('legacy entitlement route', () => {
  it('returns the packaged compatibility response without destructive behavior', () => {
    const signal = createLegacyEntitlementRouteSignal('legacy-unlock-marker', 'signature');

    expect(signal).toMatchObject({
      class: 'legacy-entitlement-route',
      source: 'legacy-unlock-marker',
      returned: legacyEntitlementRouteResponse,
      destructive: false,
      action: 'paid-features-fail-closed',
      reason: 'decoy-unlock-marker-detected',
    });
    expect(signal.returned).toBe('MTgwNjQ5NzY5Nzc=');
  });

  it('treats legacy unlock markers as decoys', () => {
    expect(probeLegacyUnlockMarker('unlockAll=true')).toMatchObject({
      returned: 'MTgwNjQ5NzY5Nzc=',
      destructive: false,
      reason: 'decoy-unlock-marker-detected',
    });
  });
});
