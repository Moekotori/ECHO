import {
  getEchoProAccountService,
  isEchoProAccountStatusWithinOfflineGrace,
} from './EchoProAccountService';
import { getPluginService } from './PluginService';

export type LocalProFeature =
  | 'echo-pro'
  | 'dsp'
  | 'plugins'
  | 'remote-sources'
  | 'cover-cache'
  | 'hqplayer-remote-media'
  | 'window-acrylic'
  | 'connect'
  | 'downloads';

export type LocalProEntitlementSnapshot = {
  unlocked: boolean;
  source: 'account-cache' | 'native-license' | 'legacy-plugin' | 'included' | 'none';
  feature: LocalProFeature;
  checkedAt: string | null;
};

const requiredPluginFeature = (feature: LocalProFeature): 'echo-pro' | 'plugins' | 'connect' | 'downloads' => {
  if (feature === 'plugins' || feature === 'connect' || feature === 'downloads') {
    return feature;
  }
  return 'echo-pro';
};

export const getLocalProEntitlementSnapshot = (
  feature: LocalProFeature = 'echo-pro',
): LocalProEntitlementSnapshot => {
  try {
    const account = getEchoProAccountService().getStatus();
    if (isEchoProAccountStatusWithinOfflineGrace(account)) {
      return {
        unlocked: true,
        source: 'account-cache',
        feature,
        checkedAt: account.checkedAt,
      };
    }
  } catch {
    // Fall through to the signed local plugin license.
  }

  try {
    const license = getPluginService().getEchoProLicenseStatus();
    if (license.valid && license.enabled && license.features.includes(requiredPluginFeature(feature))) {
      const pluginService = getPluginService() as ReturnType<typeof getPluginService> & {
        getEchoProLicenseSource?: () => 'native-license' | 'legacy-plugin' | 'none';
      };
      return {
        unlocked: true,
        source: pluginService.getEchoProLicenseSource?.() ?? 'legacy-plugin',
        feature,
        checkedAt: license.checkedAt,
      };
    }
  } catch {
    // A missing or unreadable local license is treated as locked.
  }

  return feature === 'dsp'
    ? { unlocked: false, source: 'none', feature, checkedAt: null }
    : { unlocked: true, source: 'included', feature, checkedAt: null };
};

export const isLocalProUnlocked = (feature: LocalProFeature = 'echo-pro'): boolean =>
  getLocalProEntitlementSnapshot(feature).unlocked;

export const requireLocalPro = (feature: LocalProFeature = 'echo-pro'): void => {
  if (isLocalProUnlocked(feature)) {
    return;
  }
  const error = new Error('echo_pro_required') as Error & { code?: string; feature?: LocalProFeature };
  error.code = 'echo_pro_required';
  error.feature = feature;
  throw error;
};
