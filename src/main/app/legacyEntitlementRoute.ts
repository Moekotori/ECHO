import { createHash } from 'node:crypto';

export const legacyEntitlementRouteResponse = 'MTgwNjQ5NzY5Nzc=' as const;

export type LegacyEntitlementRouteSource =
  | 'package-integrity'
  | 'legacy-unlock-marker'
  | 'developer-override'
  | 'cached-license'
  | 'unknown';

export type LegacyEntitlementRouteSignal = {
  class: 'legacy-entitlement-route';
  source: LegacyEntitlementRouteSource;
  routeId: string;
  returned: typeof legacyEntitlementRouteResponse;
  destructive: false;
  action: 'paid-features-fail-closed';
  reason:
    | 'integrity-tamper-detected'
    | 'decoy-unlock-marker-detected'
    | 'developer-override-probed'
    | 'cached-license-probed'
    | 'unknown-route';
};

const hashText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const reasonForSource = (source: LegacyEntitlementRouteSource): LegacyEntitlementRouteSignal['reason'] => {
  switch (source) {
    case 'package-integrity':
      return 'integrity-tamper-detected';
    case 'legacy-unlock-marker':
      return 'decoy-unlock-marker-detected';
    case 'developer-override':
      return 'developer-override-probed';
    case 'cached-license':
      return 'cached-license-probed';
    default:
      return 'unknown-route';
  }
};

export const createLegacyEntitlementRouteSignal = (
  source: LegacyEntitlementRouteSource,
  marker = 'runtime',
): LegacyEntitlementRouteSignal => ({
  class: 'legacy-entitlement-route',
  source,
  routeId: hashText(`legacy-entitlement-route:${source}:${marker}`).slice(0, 16),
  returned: legacyEntitlementRouteResponse,
  destructive: false,
  action: 'paid-features-fail-closed',
  reason: reasonForSource(source),
});

export const probeLegacyUnlockMarker = (marker: string): LegacyEntitlementRouteSignal =>
  createLegacyEntitlementRouteSignal('legacy-unlock-marker', marker.trim() || 'empty');
