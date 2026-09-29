import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EchoProAccountStatus } from '../../shared/types/privateEntitlements';
import {
  clearPrivateEntitlementsProvider,
  getDefaultConnectDonatorUnlockStatus,
  installPrivateEntitlementsProvider,
} from './privateEntitlements';
import { ConnectDonatorUnlockService } from './ConnectDonatorUnlockService';

const mocks = vi.hoisted(() => ({
  localProUnlocked: false,
  accountStatus: {
    loggedIn: false,
    username: null,
    displayName: null,
    pro: false,
    status: 'anonymous',
    machineCount: 0,
    maxMachineCount: 2,
    checkedAt: null,
    lastError: null,
  } as EchoProAccountStatus,
  proLicenseStatus: {
    valid: false,
    enabled: false,
    features: [] as string[],
    checkedAt: '2026-06-21T00:00:00.000Z',
    machineCode: 'plugin-machine',
  },
  refreshAccountStatus: vi.fn(),
}));

vi.mock('./LocalProEntitlements', () => ({
  getLocalProEntitlementSnapshot: () => ({
    unlocked: mocks.localProUnlocked,
    source: mocks.localProUnlocked ? 'included' : 'none',
    checkedAt: null,
  }),
}));

vi.mock('./PluginService', () => ({
  getPluginService: () => ({
    getEchoProLicenseStatus: () => mocks.proLicenseStatus,
  }),
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
  getEchoProAccountService: () => ({
    getStatus: () => mocks.accountStatus,
    refreshStatus: mocks.refreshAccountStatus,
  }),
}));

vi.mock('./MachineIdentity', () => ({
  getEchoProMachineHwidHash: () => 'account-machine',
}));

describe('ConnectDonatorUnlockService public stub', () => {
  beforeEach(() => {
    mocks.localProUnlocked = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    mocks.accountStatus = {
      loggedIn: false,
      username: null,
      displayName: null,
      pro: false,
      status: 'anonymous',
      machineCount: 0,
      maxMachineCount: 2,
      checkedAt: null,
      lastError: null,
    };
    mocks.proLicenseStatus = {
      valid: false,
      enabled: false,
      features: [],
      checkedAt: '2026-06-21T00:00:00.000Z',
      machineCode: 'plugin-machine',
    };
    mocks.refreshAccountStatus.mockReset();
    mocks.refreshAccountStatus.mockImplementation(async () => mocks.accountStatus);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPrivateEntitlementsProvider();
  });

  it('stays locked when the private entitlement overlay is not installed', async () => {
    const service = new ConnectDonatorUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: false,
      pluginInstalled: false,
      pluginEnabled: false,
      reason: 'license-invalid',
      hwidHash: 'private-overlay',
    });
    await expect(service.refreshStatus()).resolves.toMatchObject({ unlocked: false });
    expect(() => service.assertUnlocked()).toThrow('echo_pro_required');
  });

  it('allows Connect without an account when the base app includes it', async () => {
    mocks.localProUnlocked = true;
    const service = new ConnectDonatorUnlockService();

    expect(service.getStatus()).toMatchObject({ unlocked: true, reason: 'unlocked' });
    await expect(service.refreshStatus({ force: true })).resolves.toMatchObject({ unlocked: true });
    expect(() => service.assertUnlocked()).not.toThrow();
    expect(mocks.refreshAccountStatus).not.toHaveBeenCalled();
  });

  it('delegates status checks to an installed private entitlement overlay', async () => {
    const unlockedStatus = {
      ...getDefaultConnectDonatorUnlockStatus(),
      unlocked: true,
      reason: 'unlocked' as const,
      hwidHash: 'overlay-owned',
    };
    installPrivateEntitlementsProvider({
      getConnectStatus: () => unlockedStatus,
      refreshConnectStatus: async () => unlockedStatus,
    });

    const service = new ConnectDonatorUnlockService();

    expect(service.getStatus()).toBe(unlockedStatus);
    await expect(service.refreshStatus()).resolves.toBe(unlockedStatus);
    expect(service.assertUnlocked()).toBe(unlockedStatus);
  });

  it('accepts an unlocked local overlay cache without forcing an online account refresh', async () => {
    const unlockedStatus = {
      ...getDefaultConnectDonatorUnlockStatus(),
      unlocked: true,
      reason: 'unlocked' as const,
      hwidHash: 'overlay-owned',
    };
    installPrivateEntitlementsProvider({
      getConnectStatus: () => unlockedStatus,
      refreshConnectStatus: async () => unlockedStatus,
    });
    const service = new ConnectDonatorUnlockService();

    await expect(service.refreshStatus({ force: true })).resolves.toBe(unlockedStatus);

    expect(mocks.refreshAccountStatus).not.toHaveBeenCalled();
  });

  it('unlocks Connect from an active ECHO Pro account when no overlay status is installed', async () => {
    mocks.accountStatus = {
      loggedIn: true,
      username: 'moe',
      displayName: 'Moe',
      pro: true,
      status: 'active',
      machineCount: 1,
      maxMachineCount: 2,
      checkedAt: '2026-07-12T00:00:00.000Z',
      lastError: null,
    };
    const service = new ConnectDonatorUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      reason: 'unlocked',
      hwidHash: 'account-machine',
    });
    await expect(service.refreshStatus()).resolves.toMatchObject({ unlocked: true });
    expect(service.assertUnlocked()).toMatchObject({ unlocked: true });
  });

  it('does not unlock Connect from an account status beyond the offline grace period', () => {
    mocks.accountStatus = {
      loggedIn: true,
      username: 'moe',
      displayName: 'Moe',
      pro: true,
      status: 'active',
      machineCount: 1,
      maxMachineCount: 2,
      checkedAt: '2026-07-05T11:59:59.999Z',
      lastError: null,
    };
    const service = new ConnectDonatorUnlockService();

    expect(service.getStatus()).toMatchObject({
      unlocked: false,
      reason: 'license-invalid',
    });
    expect(() => service.assertUnlocked()).toThrow('echo_pro_required');
  });

});
