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
import {
  getEchoProAccountService,
  isEchoProAccountStatusWithinOfflineGrace,
} from './EchoProAccountService';
import { getEchoProMachineHwidHash } from './MachineIdentity';
import { getLocalProEntitlementSnapshot } from './LocalProEntitlements';

const nowIso = (): string => new Date().toISOString();

const createAccountConnectStatus = (): ConnectDonatorUnlockStatus | null => {
  try {
    const status = getEchoProAccountService().getStatus();
    const unlocked = isEchoProAccountStatusWithinOfflineGrace(status);
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
    const local = getLocalProEntitlementSnapshot('connect');
    if (local.unlocked) {
      return {
        featureId: connectDonatorUnlockFeatureId,
        pluginId: connectDonatorUnlockPluginId,
        requiredVersion: connectDonatorUnlockVersion,
        unlocked: true,
        pluginInstalled: true,
        pluginEnabled: true,
        hwidHash: getEchoProMachineHwidHash(),
        reason: 'unlocked',
        checkedAt: local.checkedAt ?? nowIso(),
      };
    }
    const privateStatus = getPrivateEntitlementsProvider()?.getConnectStatus?.();
    if (privateStatus?.unlocked === true) {
      return privateStatus;
    }
    return createAccountConnectStatus() ?? privateStatus ?? getDefaultConnectDonatorUnlockStatus();
  }

  async refreshStatus(options: { force?: boolean } = {}): Promise<ConnectDonatorUnlockStatus> {
    const cached = this.getStatus();
    if (cached.unlocked) {
      return cached;
    }
    if (options.force === true) {
      try {
        await getEchoProAccountService().refreshStatus({ force: true });
      } catch {
        // Preserve the last trusted account status when the refresh is temporarily unavailable.
      }
      const forcedAccountStatus = createAccountConnectStatus();
      if (forcedAccountStatus) {
        return forcedAccountStatus;
      }
    }
    const provider = getPrivateEntitlementsProvider();
    if (provider?.refreshConnectStatus) {
      const privateStatus = await provider.refreshConnectStatus();
      if (privateStatus.unlocked === true) {
        return privateStatus;
      }
    }
    return provider?.getConnectStatus?.() ?? getDefaultConnectDonatorUnlockStatus();
  }

  assertUnlocked(): ConnectDonatorUnlockStatus {
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
