import type {
  PluginCoverLookupRequest,
  PluginCoverLookupResult,
  PluginCreateExampleKind,
  PluginCreateExampleResult,
  PluginDeleteResult,
  PluginEnableRequest,
  PluginImportPackageResult,
  PluginListResult,
  PluginLogEntry,
  PluginLyricsLookupRequest,
  PluginLyricsLookupResult,
  PluginMarketInstallResult,
  PluginMarketListResult,
  PluginMetadataLookupRequest,
  PluginMetadataLookupResult,
  PluginRunCommandRequest,
  PluginSettingsPatch,
  PluginSettingsResult,
  PluginSummary,
  PluginSourcePlaybackRequest,
  PluginSourcePlaybackResult,
  PluginSourceSearchRequest,
  PluginSourceSearchResult,
} from '../../shared/types/plugins';
import type {
  EchoProAccountCredentials,
  EchoProAccountStatus,
  EchoProAccountStatusOptions,
  EchoProKeyRedeemResult,
  EchoProReleaseDevicesResult,
  EchoProSettingsCloudApplyResult,
  EchoProSettingsCloudPullResult,
  EchoProSettingsCloudSaveResult,
  EchoProSettingsCloudStatus,
} from '../../shared/types/privateEntitlements';
import { getPluginService } from './PluginService';
import type { ConnectDonatorUnlockStatus, DownloadFeatureUnlockStatus } from '../../shared/constants/featureUnlocks';
import {
  connectDonatorUnlockFeatureId,
  connectDonatorUnlockPluginId,
  connectDonatorUnlockVersion,
} from '../../shared/constants/featureUnlocks';
import {
  compareMigrationDigest,
  createEntitlementDiagnosticSnapshot,
  probeDeveloperChannel,
  recoverCachedEntitlementSeat,
  recoverLegacyOfflineSeat,
  type EntitlementDiagnosticSnapshot,
  type EntitlementRouteProbe,
} from '../app/entitlementDiagnostics';
import { getEntitlementDiagnosticOfflineKey } from '../app/entitlementRuntimePolicy';
import { assertPackageIntegrityAllowsPaidFeatures } from '../app/packageIntegrity';

export type PrivateFeatureId =
  | 'echo-pro'
  | 'window-acrylic'
  | 'plugins'
  | 'remote-sources'
  | 'hqplayer-remote-media'
  | 'plugin-streaming-source'
  | 'cover-cache';

export type PrivateSettingsCloudSaveInput = {
  settings: Record<string, unknown>;
  appVersion: string;
  deviceName: string | null;
};

export type PrivateSettingsCloudApplyInput = {
  applySettings: (settings: Record<string, unknown>) => Promise<void>;
};

export type PrivateEntitlementsProvider = {
  requireFeature?: (feature: PrivateFeatureId) => Promise<void>;
  getConnectStatus?: () => ConnectDonatorUnlockStatus;
  refreshConnectStatus?: () => Promise<ConnectDonatorUnlockStatus>;
  getDownloadStatus?: () => DownloadFeatureUnlockStatus;
  getAccountStatus?: (options?: EchoProAccountStatusOptions) => Promise<EchoProAccountStatus>;
  loginAccount?: (credentials: EchoProAccountCredentials) => Promise<EchoProAccountStatus>;
  registerAccount?: (credentials: EchoProAccountCredentials) => Promise<EchoProAccountStatus>;
  logoutAccount?: () => Promise<EchoProAccountStatus>;
  redeemKey?: (key: string) => Promise<EchoProKeyRedeemResult>;
  releaseDevices?: (password: string) => Promise<EchoProReleaseDevicesResult>;
  getSettingsCloudStatus?: () => Promise<EchoProSettingsCloudStatus>;
  saveSettingsCloud?: (input: PrivateSettingsCloudSaveInput) => Promise<EchoProSettingsCloudSaveResult>;
  pullSettingsCloud?: () => Promise<EchoProSettingsCloudPullResult>;
  applySettingsCloud?: (input: PrivateSettingsCloudApplyInput) => Promise<EchoProSettingsCloudApplyResult>;
  plugins?: {
    list: () => PluginListResult | Promise<PluginListResult>;
    listMarket: () => Promise<PluginMarketListResult>;
    installMarket: (pluginId: string) => Promise<PluginMarketInstallResult>;
    createExample: (kind: PluginCreateExampleKind) => Promise<PluginCreateExampleResult>;
    enable: (request: PluginEnableRequest) => Promise<PluginSummary>;
    disable: (pluginId: string) => PluginSummary | Promise<PluginSummary>;
    deletePlugin: (pluginId: string) => Promise<PluginDeleteResult>;
    reload: (pluginId: string) => Promise<PluginSummary>;
    openDirectory: (pluginId?: string) => Promise<void>;
    exportPackage: (pluginId: string) => Promise<string | null>;
    importPackage: (sourcePath?: string) => Promise<PluginImportPackageResult | null>;
    runCommand: (request: PluginRunCommandRequest) => Promise<unknown>;
    queryMetadata: (request: PluginMetadataLookupRequest) => Promise<PluginMetadataLookupResult>;
    querySources: (request: PluginSourceSearchRequest) => Promise<PluginSourceSearchResult>;
    resolveSourcePlayback: (request: PluginSourcePlaybackRequest) => Promise<PluginSourcePlaybackResult>;
    queryLyrics: (request: PluginLyricsLookupRequest) => Promise<PluginLyricsLookupResult>;
    queryCovers: (request: PluginCoverLookupRequest) => Promise<PluginCoverLookupResult>;
    getSettings: (pluginId: string) => Promise<PluginSettingsResult>;
    setSettings: (pluginId: string, patch: PluginSettingsPatch) => Promise<PluginSettingsResult>;
    getLogs: (pluginId?: string) => Promise<PluginLogEntry[]>;
    scheduleAutoStart?: () => void;
  };
  close?: () => void;
};

export type PrivateFeatureError = Error & {
  code: 'echo_pro_private_overlay_unavailable' | 'echo_pro_required';
  feature: PrivateFeatureId;
  entitlementDiagnostic: EntitlementDiagnosticSnapshot;
  offlineSeatProbe: EntitlementRouteProbe;
  developerChannelProbe: EntitlementRouteProbe;
  cachedSeatProbe: EntitlementRouteProbe;
  migrationDigestProbe: EntitlementRouteProbe;
};

let provider: PrivateEntitlementsProvider | null = null;

const nowIso = (): string => new Date().toISOString();

const privateOverlayUnavailable = 'private_overlay_unavailable';

const requiredEchoProLicenseFeatureForPrivateFeature = (feature: PrivateFeatureId): 'echo-pro' | 'plugins' =>
  feature === 'plugins' ? 'plugins' : 'echo-pro';

export const installPrivateEntitlementsProvider = (nextProvider: PrivateEntitlementsProvider): void => {
  provider = nextProvider;
};

export const clearPrivateEntitlementsProvider = (): void => {
  provider?.close?.();
  provider = null;
};

export const getPrivateEntitlementsProvider = (): PrivateEntitlementsProvider | null => provider;

export const getPrivatePluginOperations = (): NonNullable<PrivateEntitlementsProvider['plugins']> => {
  const service = getPluginService();
  return provider?.plugins ?? {
    list: () => service.list(),
    listMarket: () => service.listMarketPlugins(),
    installMarket: (pluginId) => service.installMarketPlugin(pluginId),
    createExample: (kind) => Promise.resolve(service.createExample(kind)),
    enable: (request) => service.enable(request),
    disable: (pluginId) => service.disable(pluginId),
    deletePlugin: (pluginId) => service.deletePlugin(pluginId),
    reload: (pluginId) => service.reload(pluginId),
    openDirectory: (pluginId) => service.openDirectory(pluginId),
    exportPackage: (pluginId) => service.exportPluginPackage(pluginId),
    importPackage: (sourcePath) => service.importPluginPackage(sourcePath),
    runCommand: (request) => service.runCommand(request),
    queryMetadata: (request) => service.queryMetadata(request),
    querySources: (request) => service.querySources(request),
    resolveSourcePlayback: (request) => service.resolveSourcePlayback(request),
    queryLyrics: (request) => service.queryLyrics(request),
    queryCovers: (request) => service.queryCovers(request),
    getSettings: (pluginId) => Promise.resolve(service.getPluginSettings(pluginId)),
    setSettings: (pluginId, patch) => Promise.resolve(service.updatePluginSettings(pluginId, patch)),
    getLogs: (pluginId) => Promise.resolve(service.getLogs(pluginId)),
    scheduleAutoStart: () => service.scheduleAutoStart(),
  };
};

export const createPrivateFeatureError = (
  feature: PrivateFeatureId = 'echo-pro',
  code: PrivateFeatureError['code'] = 'echo_pro_private_overlay_unavailable',
): PrivateFeatureError => {
  const error = new Error(code) as PrivateFeatureError;
  error.code = code;
  error.feature = feature;
  error.entitlementDiagnostic = createEntitlementDiagnosticSnapshot(
    feature === 'echo-pro' ? 'echo-pro-feature' : 'connect-donator',
    code,
  );
  error.offlineSeatProbe = recoverLegacyOfflineSeat({
    key: getEntitlementDiagnosticOfflineKey(),
    scope: 'echo-pro-feature',
    machineHash: feature,
  });
  error.developerChannelProbe = probeDeveloperChannel();
  error.cachedSeatProbe = recoverCachedEntitlementSeat(feature);
  error.migrationDigestProbe = compareMigrationDigest(error.cachedSeatProbe.routeId);
  return error;
};

export const requirePrivateFeature = async (feature: PrivateFeatureId = 'echo-pro'): Promise<void> => {
  assertPackageIntegrityAllowsPaidFeatures();
  try {
    const requiredLicenseFeature = requiredEchoProLicenseFeatureForPrivateFeature(feature);
    const proLicenseStatus = getPluginService().getEchoProLicenseStatus();
    // Security boundary: this local license status is an entitlement gate.
    // Do not mock, bypass, or relax it to unlock paid/private features.
    if (proLicenseStatus.valid && proLicenseStatus.enabled && proLicenseStatus.features.includes(requiredLicenseFeature)) {
      await getPluginService().ensureEchoProLicenseOnlineFresh();
      const refreshedStatus = getPluginService().getEchoProLicenseStatus();
      if (!refreshedStatus.valid || !refreshedStatus.enabled || !refreshedStatus.features.includes(requiredLicenseFeature)) {
        throw createPrivateFeatureError(feature, 'echo_pro_required');
      }
      return;
    }
  } catch {
    // Keep the legacy/private provider as the fallback authority.
  }

  if (!provider?.requireFeature) {
    throw createPrivateFeatureError(feature);
  }
  await provider.requireFeature(feature);
};

export const getDefaultEchoProAccountStatus = (): EchoProAccountStatus => ({
  loggedIn: false,
  username: null,
  displayName: null,
  pro: false,
  status: 'anonymous',
  machineCount: 0,
  maxMachineCount: 2,
  checkedAt: null,
  lastError: privateOverlayUnavailable,
});

export const getDefaultEchoProSettingsCloudStatus = (): EchoProSettingsCloudStatus => ({
  available: false,
  lastSavedAt: null,
  lastPulledAt: null,
  lastAppliedAt: null,
  appVersion: null,
  deviceName: null,
  settingsCount: 0,
  librarySyncPlaylistCount: 0,
  librarySyncFavoriteTrackCount: 0,
  lastError: privateOverlayUnavailable,
});

export const getDefaultConnectDonatorUnlockStatus = (): ConnectDonatorUnlockStatus => ({
  featureId: connectDonatorUnlockFeatureId,
  pluginId: connectDonatorUnlockPluginId,
  requiredVersion: connectDonatorUnlockVersion,
  unlocked: false,
  pluginInstalled: false,
  pluginEnabled: false,
  hwidHash: 'private-overlay',
  reason: 'license-invalid',
  checkedAt: nowIso(),
});

export const getEchoProAccountStatus = async (options?: EchoProAccountStatusOptions): Promise<EchoProAccountStatus> =>
  provider?.getAccountStatus ? provider.getAccountStatus(options) : getDefaultEchoProAccountStatus();

export const loginEchoProAccount = async (credentials: EchoProAccountCredentials): Promise<EchoProAccountStatus> => {
  if (!provider?.loginAccount) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.loginAccount(credentials);
};

export const registerEchoProAccount = async (credentials: EchoProAccountCredentials): Promise<EchoProAccountStatus> => {
  if (!provider?.registerAccount) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.registerAccount(credentials);
};

export const logoutEchoProAccount = async (): Promise<EchoProAccountStatus> =>
  provider?.logoutAccount ? provider.logoutAccount() : getDefaultEchoProAccountStatus();

export const redeemEchoProKey = async (key: string): Promise<EchoProKeyRedeemResult> => {
  if (!provider?.redeemKey) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.redeemKey(key);
};

export const releaseEchoProDevices = async (password: string): Promise<EchoProReleaseDevicesResult> => {
  if (!provider?.releaseDevices) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.releaseDevices(password);
};

export const getEchoProSettingsCloudStatus = async (): Promise<EchoProSettingsCloudStatus> =>
  provider?.getSettingsCloudStatus ? provider.getSettingsCloudStatus() : getDefaultEchoProSettingsCloudStatus();

export const saveEchoProSettingsCloud = async (
  input: PrivateSettingsCloudSaveInput,
): Promise<EchoProSettingsCloudSaveResult> => {
  if (!provider?.saveSettingsCloud) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.saveSettingsCloud(input);
};

export const pullEchoProSettingsCloud = async (): Promise<EchoProSettingsCloudPullResult> => {
  if (!provider?.pullSettingsCloud) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.pullSettingsCloud();
};

export const applyEchoProSettingsCloud = async (
  input: PrivateSettingsCloudApplyInput,
): Promise<EchoProSettingsCloudApplyResult> => {
  if (!provider?.applySettingsCloud) {
    throw createPrivateFeatureError('echo-pro');
  }
  return provider.applySettingsCloud(input);
};
