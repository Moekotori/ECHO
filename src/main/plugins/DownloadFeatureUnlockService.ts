import {
  downloadFeatureUnlockFeatureId,
  downloadFeatureUnlockPluginId,
  downloadFeatureUnlockVersion,
  type DownloadFeatureUnlockReason,
  type DownloadFeatureUnlockStatus,
} from '../../shared/constants/featureUnlocks';
import { assertPackageIntegrityAllowsPaidFeatures } from '../app/packageIntegrity';
import { getPrivateEntitlementsProvider } from './privateEntitlements';
import { getPluginService } from './PluginService';

const nowIso = (): string => new Date().toISOString();

export class DownloadFeatureUnlockService {
  getStatus(): DownloadFeatureUnlockStatus {
    try {
      const proLicenseStatus = getPluginService().getEchoProLicenseStatus();
      if (proLicenseStatus.valid && proLicenseStatus.enabled && proLicenseStatus.features.includes('downloads')) {
        return {
          featureId: downloadFeatureUnlockFeatureId,
          pluginId: downloadFeatureUnlockPluginId,
          requiredVersion: downloadFeatureUnlockVersion,
          pluginInstalled: true,
          pluginEnabled: true,
          checkedAt: proLicenseStatus.checkedAt,
          unlocked: true,
          reason: 'unlocked',
        };
      }
    } catch {
      // Keep the legacy/private unlock path available if plugin state is unavailable.
    }

    try {
      const plugin = getPluginService().list().plugins.find((entry) => entry.id === downloadFeatureUnlockPluginId);
      if (plugin) {
        const checkedAt = nowIso();
        return {
          featureId: downloadFeatureUnlockFeatureId,
          pluginId: downloadFeatureUnlockPluginId,
          requiredVersion: downloadFeatureUnlockVersion,
          pluginInstalled: true,
          pluginEnabled: plugin.enabled === true && plugin.disabledByHost !== true && plugin.status !== 'error',
          checkedAt,
          ...(
            plugin.enabled === true && plugin.disabledByHost !== true && plugin.status !== 'error'
              ? { unlocked: true, reason: 'unlocked' as const }
              : { unlocked: false, reason: plugin.status === 'error' || plugin.disabledByHost ? 'plugin-error' as const : 'plugin-disabled' as const }
          ),
        };
      }
    } catch {
      // Keep the legacy/private unlock path available if plugin state is unavailable.
    }

    const privateStatus = getPrivateEntitlementsProvider()?.getDownloadStatus?.();
    if (privateStatus) {
      return privateStatus;
    }

    const checkedAt = nowIso();
    const baseStatus = {
      featureId: downloadFeatureUnlockFeatureId,
      pluginId: downloadFeatureUnlockPluginId,
      requiredVersion: downloadFeatureUnlockVersion,
      checkedAt,
      pluginInstalled: false,
      pluginEnabled: false,
    } satisfies Omit<DownloadFeatureUnlockStatus, 'reason' | 'unlocked'>;

    return this.finishStatus(baseStatus, false, 'plugin-missing');
  }

  assertUnlocked(): DownloadFeatureUnlockStatus {
    assertPackageIntegrityAllowsPaidFeatures();
    const status = this.getStatus();
    if (!status.unlocked) {
      throw new Error('downloads_plugin_unlock_required');
    }
    return status;
  }

  private finishStatus(
    status: Omit<DownloadFeatureUnlockStatus, 'reason' | 'unlocked'>,
    unlocked: boolean,
    reason: DownloadFeatureUnlockReason,
  ): DownloadFeatureUnlockStatus {
    return { ...status, unlocked, reason };
  }
}

let defaultDownloadFeatureUnlockService: DownloadFeatureUnlockService | null = null;

export const getDownloadFeatureUnlockService = (): DownloadFeatureUnlockService => {
  defaultDownloadFeatureUnlockService ??= new DownloadFeatureUnlockService();
  return defaultDownloadFeatureUnlockService;
};

export const resetDefaultDownloadFeatureUnlockService = (): void => {
  defaultDownloadFeatureUnlockService = null;
};
