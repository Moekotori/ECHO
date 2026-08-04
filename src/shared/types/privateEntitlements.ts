export type EchoProAccountStatus = {
  loggedIn: boolean;
  username: string | null;
  displayName: string | null;
  pro: boolean;
  status: 'anonymous' | 'active' | 'inactive' | 'disabled';
  machineCount: number;
  maxMachineCount: number;
  checkedAt: string | null;
  lastError: string | null;
};

export type EchoProAccountCredentials = {
  username: string;
  password: string;
};

export type EchoProAccountStatusOptions = {
  force?: boolean;
};

export type EchoProKeyRedeemResult = {
  ok: boolean;
  redeemedAt: string;
  status: EchoProAccountStatus;
};

export type EchoProPluginActivationMode = 'afdian' | 'key';

export type EchoProPluginActivationRequest = {
  mode: EchoProPluginActivationMode;
  qq: string;
  orderId?: string;
  key?: string;
};

export type EchoProPluginActivationResult = {
  ok: boolean;
  mode: EchoProPluginActivationMode;
  pluginId: string;
  enabled: boolean;
  licenseId: string | null;
  activationId: string | null;
  qq: string | null;
  activatedAt: string;
  importedFileCount: number;
  checksum: string;
};

export type EchoProReleaseDevicesResult = {
  ok: boolean;
  releasedAt: string;
  releasedCount: number;
  cooldownSeconds?: number;
  status: EchoProAccountStatus;
};

export type EchoProSettingsCloudStatus = {
  available: boolean;
  lastSavedAt: string | null;
  lastPulledAt: string | null;
  lastAppliedAt: string | null;
  appVersion: string | null;
  deviceName: string | null;
  settingsCount: number;
  librarySyncPlaylistCount: number;
  librarySyncFavoriteTrackCount: number;
  lastError: string | null;
};

export type EchoProSettingsCloudSaveResult = EchoProSettingsCloudStatus & {
  savedAt: string;
};

export type EchoProSettingsCloudPullResult = EchoProSettingsCloudStatus & {
  settings: Record<string, unknown> | null;
};

export type EchoProSettingsCloudApplyResult = EchoProSettingsCloudStatus & {
  appliedAt: string;
};
