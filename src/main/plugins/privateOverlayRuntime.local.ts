import type { DownloadFeatureUnlockStatus } from '../../shared/constants/featureUnlocks';
import type { ConnectDonatorUnlockStatus } from '../../shared/constants/featureUnlocks';
import {
  connectDonatorUnlockFeatureId,
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
  downloadFeatureUnlockFeatureId,
  downloadFeatureUnlockPluginId,
  downloadFeatureUnlockVersion,
} from '../../shared/constants/featureUnlocks';
import type { EchoProCloudLibrarySyncPayload } from '../../shared/types/echoProAccount';
import type { PrivateFeatureId, PrivateSettingsCloudApplyInput, PrivateSettingsCloudSaveInput } from './privateEntitlements';
import { createPrivateFeatureError, installPrivateEntitlementsProvider } from './privateEntitlements';
import { getEchoProAccountService } from './EchoProAccountService';
import { getEchoProMachineHwidHash } from './MachineIdentity';
import type { PrivateOverlayRuntimeInstallResult } from './privateOverlayRuntime';

const nowIso = (): string => new Date().toISOString();

const createEmptyLibrarySync = (): EchoProCloudLibrarySyncPayload => ({
  version: 1,
  savedAt: nowIso(),
  streamingPlaylists: [],
  streamingFavorites: {
    version: 1,
    updatedAt: nowIso(),
    providers: {
      bilibili: [],
      youtube: [],
      soundcloud: [],
    },
    collections: [],
  },
});

const requireActivePro = async (feature: PrivateFeatureId): Promise<void> => {
  try {
    await getEchoProAccountService().verifyFeature(feature);
  } catch {
    throw createPrivateFeatureError(feature, 'echo_pro_required');
  }
};

const getLockedDownloadStatus = (): DownloadFeatureUnlockStatus => ({
  featureId: downloadFeatureUnlockFeatureId,
  pluginId: downloadFeatureUnlockPluginId,
  requiredVersion: downloadFeatureUnlockVersion,
  unlocked: false,
  pluginInstalled: false,
  pluginEnabled: false,
  reason: 'plugin-missing',
  checkedAt: nowIso(),
});

const getConnectStatus = (): ConnectDonatorUnlockStatus => {
  const status = getEchoProAccountService().getStatus();
  const unlocked = status.loggedIn && status.pro === true && status.status !== 'disabled';
  return {
    featureId: connectDonatorUnlockFeatureId,
    pluginId: connectDonatorUnlockPluginId,
    requiredVersion: connectDonatorUnlockVersion,
    unlocked,
    pluginInstalled: unlocked,
    pluginEnabled: unlocked,
    hwidHash: getEchoProMachineHwidHash(),
    reason: unlocked ? 'unlocked' : 'license-invalid',
    checkedAt: status.checkedAt ?? nowIso(),
  };
};

const refreshConnectStatus = async (): Promise<ConnectDonatorUnlockStatus> => {
  await getEchoProAccountService().refreshStatus();
  return getConnectStatus();
};

export const installPrivateOverlayRuntime = (): PrivateOverlayRuntimeInstallResult => {
  installPrivateEntitlementsProvider({
    requireFeature: requireActivePro,
    getConnectStatus,
    refreshConnectStatus,
    getAccountStatus: (options) => getEchoProAccountService().refreshStatus(options),
    loginAccount: (credentials) => getEchoProAccountService().login(credentials),
    registerAccount: (credentials) => getEchoProAccountService().register(credentials),
    logoutAccount: () => getEchoProAccountService().logout(),
    redeemKey: (key) => getEchoProAccountService().redeemKey(key),
    releaseDevices: (password) => getEchoProAccountService().releaseAllDevices(password),
    getSettingsCloudStatus: () => getEchoProAccountService().getSettingsCloudStatus(),
    saveSettingsCloud: (input: PrivateSettingsCloudSaveInput) =>
      getEchoProAccountService().saveSettingsCloud({
        ...input,
        librarySync: createEmptyLibrarySync(),
      }),
    pullSettingsCloud: () => getEchoProAccountService().pullSettingsCloud(),
    applySettingsCloud: async (input: PrivateSettingsCloudApplyInput) => {
      const pulled = await getEchoProAccountService().pullSettingsCloud();
      if (pulled.settings) {
        await input.applySettings(pulled.settings);
      }
      return {
        ...pulled,
        lastAppliedAt: nowIso(),
        appliedAt: nowIso(),
      };
    },
    getDownloadStatus: getLockedDownloadStatus,
  });

  return {
    installed: true,
    source: 'private-overlay',
    features: ['echo-pro-account', 'echo-pro-key', 'echo-pro-hwid', 'echo-pro-cloud-settings'],
  };
};
