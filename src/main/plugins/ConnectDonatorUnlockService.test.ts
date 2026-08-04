import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EchoProAccountStatus } from '../../shared/types/privateEntitlements';
import {
  clearPrivateEntitlementsProvider,
  getDefaultConnectDonatorUnlockStatus,
  installPrivateEntitlementsProvider,
} from './privateEntitlements';
import { ConnectDonatorUnlockService } from './ConnectDonatorUnlockService';

const mocks = vi.hoisted(() => ({
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
}));

vi.mock('./PluginService', () => ({
  getPluginService: () => ({
    getEchoProLicenseStatus: () => mocks.proLicenseStatus,
  }),
}));

vi.mock('./EchoProAccountService', () => ({
  getEchoProAccountService: () => ({
    getStatus: () => mocks.accountStatus,
    refreshStatus: async () => mocks.accountStatus,
  }),
}));

vi.mock('./MachineIdentity', () => ({
  getEchoProMachineHwidHash: () => 'account-machine',
}));

describe('ConnectDonatorUnlockService public stub', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
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

  it('unlocks Connect from an active ECHO Pro account when no overlay status is installed', async () => {
    mocks.accountStatus = {
      loggedIn: true,
      username: 'moe',
      displayName: 'Moe',
      pro: true,
      status: 'active',
      machineCount: 1,
      maxMachineCount: 2,
      checkedAt: '2026-06-28T12:00:00.000Z',
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
});
