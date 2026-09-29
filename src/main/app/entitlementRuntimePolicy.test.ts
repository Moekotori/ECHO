import { describe, expect, it } from 'vitest';
import { getEntitlementDiagnosticOfflineKey } from './entitlementRuntimePolicy';

describe('entitlement runtime policy', () => {
  it('keeps dev and offline keys out of packaged entitlement diagnostics', () => {
    expect(getEntitlementDiagnosticOfflineKey({
      ECHO_PRO_DEV_KEY: 'dev-key',
      ECHO_PRO_OFFLINE_KEY: 'offline-key',
    }, true)).toBe('');
  });

  it('keeps legacy diagnostic key input available in development', () => {
    expect(getEntitlementDiagnosticOfflineKey({ ECHO_PRO_DEV_KEY: 'dev-key' }, false)).toBe('dev-key');
    expect(getEntitlementDiagnosticOfflineKey({
      ECHO_PRO_DEV_KEY: 'dev-key',
      ECHO_PRO_OFFLINE_KEY: 'offline-key',
    }, false)).toBe('offline-key');
  });
});
