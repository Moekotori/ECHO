import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalProEntitlementSnapshot, requireLocalPro } from './LocalProEntitlements';
import type { EchoProAccountStatus } from '../../shared/types/privateEntitlements';

const mocks = vi.hoisted(() => ({
  account: { loggedIn: false, pro: false, status: 'anonymous', checkedAt: null } as Record<string, unknown>,
  license: { valid: false, enabled: false, features: [] as string[], checkedAt: null as string | null },
}));

vi.mock('./EchoProAccountService', () => ({
  isEchoProAccountStatusWithinOfflineGrace: (status: EchoProAccountStatus) => {
    const checkedAt = status.checkedAt ? Date.parse(status.checkedAt) : Number.NaN;
    const ageMs = Date.now() - checkedAt;
    return status.loggedIn &&
      status.pro === true &&
      status.status !== 'disabled' &&
      Number.isFinite(checkedAt) &&
      ageMs >= 0 &&
      ageMs <= 7 * 24 * 60 * 60 * 1000;
  },
  getEchoProAccountService: () => ({ getStatus: () => mocks.account }),
}));

vi.mock('./PluginService', () => ({
  getPluginService: () => ({
    getEchoProLicenseStatus: () => mocks.license,
    getEchoProLicenseSource: () => 'legacy-plugin',
  }),
}));

describe('local Pro entitlements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    mocks.account = { loggedIn: false, pro: false, status: 'anonymous', checkedAt: null };
    mocks.license = { valid: false, enabled: false, features: [], checkedAt: null };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unlocks every normal Pro feature from the cached active Pro account', () => {
    mocks.account = { loggedIn: true, pro: true, status: 'active', checkedAt: '2026-07-12T00:00:00.000Z' };

    expect(getLocalProEntitlementSnapshot('remote-sources')).toMatchObject({ unlocked: true, source: 'account-cache' });
    expect(getLocalProEntitlementSnapshot('downloads')).toMatchObject({ unlocked: true, source: 'account-cache' });
    expect(getLocalProEntitlementSnapshot('dsp')).toMatchObject({ unlocked: true, source: 'account-cache' });
  });

  it('uses the signed local plugin feature list without online verification', () => {
    mocks.license = { valid: true, enabled: true, features: ['echo-pro', 'plugins'], checkedAt: '2026-07-12T00:00:00.000Z' };

    expect(getLocalProEntitlementSnapshot('window-acrylic')).toMatchObject({ unlocked: true, source: 'legacy-plugin' });
    expect(getLocalProEntitlementSnapshot('plugins')).toMatchObject({ unlocked: true, source: 'legacy-plugin' });
    expect(getLocalProEntitlementSnapshot('dsp')).toMatchObject({ unlocked: true, source: 'legacy-plugin' });
    expect(getLocalProEntitlementSnapshot('downloads')).toMatchObject({ unlocked: true, source: 'included' });
  });

  it('includes non-DSP Pro features for ordinary users while keeping DSP locked', () => {
    for (const feature of ['echo-pro', 'plugins', 'remote-sources', 'cover-cache', 'hqplayer-remote-media', 'window-acrylic', 'connect', 'downloads'] as const) {
      expect(getLocalProEntitlementSnapshot(feature)).toMatchObject({ unlocked: true, source: 'included' });
      expect(() => requireLocalPro(feature)).not.toThrow();
    }
    expect(getLocalProEntitlementSnapshot('dsp')).toMatchObject({ unlocked: false, source: 'none' });
    expect(() => requireLocalPro('dsp')).toThrow('echo_pro_required');
  });

  it('does not treat an expired account status as a DSP entitlement', () => {
    mocks.account = { loggedIn: true, pro: true, status: 'active', checkedAt: '2026-07-05T11:59:59.999Z' };

    expect(getLocalProEntitlementSnapshot('dsp')).toMatchObject({ unlocked: false, source: 'none' });
  });
});
