import {
  connectDonatorUnlockFeatureId,
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
  type ConnectDonatorUnlockStatus,
} from '../../shared/constants/featureUnlocks';
import {
  createPrivateFeatureError,
  getDefaultConnectDonatorUnlockStatus,
  getPrivateEntitlementsProvider,
} from './privateEntitlements';
import { getPluginService } from './PluginService';
import { assertPackageIntegrityAllowsPaidFeatures } from '../app/packageIntegrity';
import { getEchoProAccountService } from './EchoProAccountService';
import { getEchoProMachineHwidHash } from './MachineIdentity';

const nowIso = (): string => new Date().toISOString();

const createAccountConnectStatus = (): ConnectDonatorUnlockStatus | null => {
  try {
    const status = getEchoProAccountService().getStatus();
    const unlocked = status.loggedIn && status.pro === true && status.status !== 'disabled';
    if (!unlocked) {
      return null;
    }
    return {
      featureId: connectDonatorUnlockFeatureId,
      pluginId: connectDonatorUnlockPluginId,
      requiredVersion: connectDonatorUnlockVersion,
      unlocked: true,
      pluginInstalled: true,
      pluginEnabled: true,
      hwidHash: getEchoProMachineHwidHash(),
      reason: 'unlocked',
      checkedAt: status.checkedAt ?? nowIso(),
    };
  } catch {
    return null;
  }
};

export class ConnectDonatorUnlockService {
  constructor(_userDataPath?: string) {}

  getStatus(): ConnectDonatorUnlockStatus {
    try {
      const proLicenseStatus = getPluginService().getEchoProLicenseStatus();
      if (proLicenseStatus.valid && proLicenseStatus.enabled && proLicenseStatus.features.includes('connect')) {
        return {
          featureId: 'connect',
          pluginId: 'echo.connect-donator-unlock',
          requiredVersion: 'plugin:echo.connect-donator-unlock:v1',
          unlocked: true,
          pluginInstalled: true,
          pluginEnabled: true,
          hwidHash: proLicenseStatus.machineCode,
          reason: 'unlocked',
          checkedAt: proLicenseStatus.checkedAt,
        };
      }
    } catch {
      // Keep the legacy/private unlock path available if plugin state is unavailable.
    }
    const privateStatus = getPrivateEntitlementsProvider()?.getConnectStatus?.();
    if (privateStatus?.unlocked === true) {
      return privateStatus;
    }
    return createAccountConnectStatus() ?? privateStatus ?? getDefaultConnectDonatorUnlockStatus();
  }

  async refreshStatus(): Promise<ConnectDonatorUnlockStatus> {
    try {
      const proLicenseStatus = getPluginService().getEchoProLicenseStatus();
      if (proLicenseStatus.valid && proLicenseStatus.enabled && proLicenseStatus.features.includes('connect')) {
        return this.getStatus();
      }
    } catch {
      // Keep the legacy/private unlock path available if plugin state is unavailable.
    }
    const provider = getPrivateEntitlementsProvider();
    if (provider?.refreshConnectStatus) {
      const privateStatus = await provider.refreshConnectStatus();
      if (privateStatus.unlocked === true) {
        return privateStatus;
      }
    }
    try {
      await getEchoProAccountService().refreshStatus();
    } catch {
      // Keep the synchronous cached status path below available during offline grace.
    }
    const accountStatus = createAccountConnectStatus();
    if (accountStatus) {
      return accountStatus;
    }
    return provider?.getConnectStatus?.() ?? getDefaultConnectDonatorUnlockStatus();
  }

  assertUnlocked(): ConnectDonatorUnlockStatus {
    assertPackageIntegrityAllowsPaidFeatures();
    const status = this.getStatus();
    if (!status.unlocked) {
      throw createPrivateFeatureError('echo-pro', 'echo_pro_required');
    }
    return status;
  }

  close(): void {}
}

let defaultConnectDonatorUnlockService: ConnectDonatorUnlockService | null = null;

export const getConnectDonatorUnlockService = (): ConnectDonatorUnlockService => {
  defaultConnectDonatorUnlockService ??= new ConnectDonatorUnlockService();
  return defaultConnectDonatorUnlockService;
};

export const closeDefaultConnectDonatorUnlockService = (): void => {
  defaultConnectDonatorUnlockService?.close();
  defaultConnectDonatorUnlockService = null;
};
