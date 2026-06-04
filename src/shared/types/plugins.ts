import type { LibraryPage, LibraryPageQuery, LibraryTrack } from './library';
import type { AppThemePreset, AppThemeToneOverride } from './appSettings';

export const pluginApiVersion = 2;

export const pluginPermissions = [
  'playback:read',
  'playback:control',
  'library:read',
  'library:write',
  'sources:provide',
  'settings:read',
  'settings:write',
  'network',
  'fs:plugin',
] as const;

export type PluginPermission = (typeof pluginPermissions)[number];

export type PluginPermissionRisk = 'low' | 'medium' | 'high';
export type PluginPermissionAvailability = 'active' | 'reserved' | 'limited';

export type PluginPermissionDescriptor = {
  permission: PluginPermission;
  label: string;
  description: string;
  risk: PluginPermissionRisk;
  availability: PluginPermissionAvailability;
};

export const pluginPermissionDescriptors: Record<PluginPermission, PluginPermissionDescriptor> = {
  'playback:read': {
    permission: 'playback:read',
    label: '读取播放状态',
    description: '可读取当前播放状态、曲目 id、进度和音频状态快照。',
    risk: 'low',
    availability: 'active',
  },
  'playback:control': {
    permission: 'playback:control',
    label: '控制播放',
    description: '可触发播放、暂停、停止和跳转位置。',
    risk: 'medium',
    availability: 'active',
  },
  'library:read': {
    permission: 'library:read',
    label: '读取曲库',
    description: '可分页读取曲库摘要和公开曲目信息。',
    risk: 'medium',
    availability: 'active',
  },
  'library:write': {
    permission: 'library:write',
    label: '修改曲库（预留）',
    description: '预留给未来曲库写入能力；v1 不提供实际写入 API。',
    risk: 'high',
    availability: 'reserved',
  },
  'sources:provide': {
    permission: 'sources:provide',
    label: '提供自定义音源',
    description: '可注册用户自定义音源候选，并在用户触发播放时返回显式音频 URL。',
    risk: 'medium',
    availability: 'active',
  },
  'settings:read': {
    permission: 'settings:read',
    label: '读取设置',
    description: '可读取应用设置快照。',
    risk: 'medium',
    availability: 'active',
  },
  'settings:write': {
    permission: 'settings:write',
    label: '修改设置',
    description: '可写入小型设置 patch，属于高风险能力。',
    risk: 'high',
    availability: 'active',
  },
  network: {
    permission: 'network',
    label: '访问网络',
    description: '通过宿主受控 API 访问 http/https；v2 起生效，受超时、大小、方法和 header 限制。',
    risk: 'high',
    availability: 'active',
  },
  'fs:plugin': {
    permission: 'fs:plugin',
    label: '插件目录文件（受限）',
    description: 'v1 仅通过 storage API 读写插件自身存储，不开放任意文件 API。',
    risk: 'medium',
    availability: 'limited',
  },
};

export type PluginPanelContribution = {
  id: string;
  title: string;
  path: string;
};

export type PluginCommandContribution = {
  id: string;
  title: string;
  description?: string;
};

export type PluginMetadataProviderContribution = {
  id: string;
  title: string;
  description?: string;
};

export type PluginSourceProviderContribution = {
  id: string;
  title: string;
  description?: string;
};

export type PluginLyricsProviderContribution = {
  id: string;
  title: string;
  description?: string;
};

export type PluginCoverProviderContribution = {
  id: string;
  title: string;
  description?: string;
};

export type PluginThemePresetContribution = {
  id: string;
  title: string;
  description?: string;
  basePreset: AppThemePreset;
  light?: AppThemeToneOverride;
  dark?: AppThemeToneOverride;
  preview?: string;
  swatches?: string[];
};

export type PluginSettingType = 'string' | 'select' | 'boolean' | 'number' | 'secret';

export type PluginSettingOption = {
  label: string;
  value: string;
};

export type PluginSettingContribution = {
  id: string;
  title: string;
  description?: string;
  type: PluginSettingType;
  defaultValue?: string | number | boolean | null;
  options?: PluginSettingOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  required?: boolean;
};

export type PluginManifestContributes = {
  commands?: PluginCommandContribution[];
  panels?: PluginPanelContribution[];
  metadataProviders?: PluginMetadataProviderContribution[];
  sourceProviders?: PluginSourceProviderContribution[];
  lyricsProviders?: PluginLyricsProviderContribution[];
  coverProviders?: PluginCoverProviderContribution[];
  themePresets?: PluginThemePresetContribution[];
  settings?: PluginSettingContribution[];
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  minEchoVersion?: string;
  entry?: string;
  panel?: string;
  permissions?: PluginPermission[];
  contributes?: PluginManifestContributes;
};

export const pluginEventNames = [
  'playback:status',
  'library:changed',
] as const;

export type PluginEventName = (typeof pluginEventNames)[number];

export const pluginLibraryTrackFields = [
  'id',
  'mediaType',
  'path',
  'sourceId',
  'provider',
  'remotePath',
  'stableKey',
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNo',
  'discNo',
  'year',
  'genre',
  'duration',
  'codec',
  'sampleRate',
  'bitDepth',
  'bitrate',
  'bpm',
  'coverId',
  'coverThumb',
  'metadataStatus',
  'embeddedMetadataStatus',
  'embeddedCoverStatus',
  'networkMetadataStatus',
  'fieldSources',
  'unavailable',
] as const satisfies ReadonlyArray<keyof LibraryTrack>;

export type PluginLibraryTrackField = (typeof pluginLibraryTrackFields)[number];

export type PluginLibraryTracksQuery = Pick<LibraryPageQuery, 'page' | 'pageSize' | 'search' | 'sort' | 'sourceProvider'> & {
  fields?: PluginLibraryTrackField[];
};

export type PluginLibraryTrack = Partial<Pick<LibraryTrack, PluginLibraryTrackField>>;

export type PluginLibraryTrackPage = Omit<LibraryPage<PluginLibraryTrack>, 'items'> & {
  items: PluginLibraryTrack[];
};

export type PluginMetadataLookupTrack = {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number;
};

export type PluginMetadataLookupProvider = {
  pluginId: string;
  providerId: string;
};

export type PluginMetadataLookupRequest = {
  track: PluginMetadataLookupTrack;
  provider?: PluginMetadataLookupProvider;
};

export type PluginMetadataCandidate = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  bpm?: number;
  confidence?: number;
  source?: string;
  sourceUrl?: string;
};

export type PluginMetadataProviderResult = {
  candidates?: PluginMetadataCandidate[];
};

export type PluginMetadataProvider = PluginMetadataProviderContribution & {
  pluginId: string;
};

export type PluginMetadataLookupResult = {
  providers: PluginMetadataProvider[];
  candidates: Array<PluginMetadataCandidate & {
    pluginId: string;
    providerId: string;
  }>;
};

export type PluginSourceSearchRequest = {
  query: string;
  page?: number;
  pageSize?: number;
  provider?: {
    pluginId: string;
    providerId: string;
  };
};

export type PluginSourceTrack = {
  providerTrackId: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number | null;
  coverUrl?: string | null;
  webUrl?: string | null;
  playable?: boolean;
  unavailableReason?: string | null;
  source?: string;
};

export type PluginSourceSearchProviderResult = {
  tracks?: PluginSourceTrack[];
  total?: number | null;
  hasMore?: boolean;
};

export type PluginSourceProvider = PluginSourceProviderContribution & {
  pluginId: string;
};

export type PluginSourceSearchResult = {
  providers: PluginSourceProvider[];
  tracks: Array<PluginSourceTrack & {
    pluginId: string;
    providerId: string;
  }>;
};

export type PluginSourcePlaybackRequest = {
  pluginId: string;
  providerId: string;
  providerTrackId: string;
};

export type PluginSourcePlaybackResult = {
  pluginId: string;
  providerId: string;
  providerTrackId: string;
  url: string;
  expiresAt: string | null;
  mimeType: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  codec: string | null;
  headers: Record<string, string>;
  requiresProxy: boolean;
  supportsRange: boolean;
};

export type PluginLyricsLookupRequest = {
  track: PluginMetadataLookupTrack;
  provider?: PluginMetadataLookupProvider;
};

export type PluginLyricsCandidate = {
  title?: string;
  language?: string;
  lrc?: string;
  text?: string;
  source?: string;
  sourceUrl?: string;
  confidence?: number;
};

export type PluginLyricsProviderResult = {
  candidates?: PluginLyricsCandidate[];
};

export type PluginLyricsProvider = PluginLyricsProviderContribution & {
  pluginId: string;
};

export type PluginLyricsLookupResult = {
  providers: PluginLyricsProvider[];
  candidates: Array<PluginLyricsCandidate & {
    pluginId: string;
    providerId: string;
  }>;
};

export type PluginCoverLookupRequest = {
  track: PluginMetadataLookupTrack;
  provider?: PluginMetadataLookupProvider;
};

export type PluginCoverCandidate = {
  imageUrl: string;
  title?: string;
  source?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  confidence?: number;
};

export type PluginCoverProviderResult = {
  candidates?: PluginCoverCandidate[];
};

export type PluginCoverProvider = PluginCoverProviderContribution & {
  pluginId: string;
};

export type PluginCoverLookupResult = {
  providers: PluginCoverProvider[];
  candidates: Array<PluginCoverCandidate & {
    pluginId: string;
    providerId: string;
  }>;
};

export type PluginNetworkRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export type PluginSettingsPatch = Record<string, string | number | boolean | null>;

export type PluginSettingsResult = {
  pluginId: string;
  values: PluginSettingsPatch;
};

export const pluginPanelBridgeChannel = 'echo:plugin-panel';
export const pluginPanelBridgeVersion = 1;

export const pluginPanelBridgeActions = [
  'plugin:getSummary',
  'plugin:getLogs',
  'plugin:runCommand',
] as const;

export type PluginPanelBridgeAction = (typeof pluginPanelBridgeActions)[number];

export type PluginPanelBridgeRequest = {
  channel: typeof pluginPanelBridgeChannel;
  version?: number;
  type: 'request';
  requestId: string;
  pluginId: string;
  action: PluginPanelBridgeAction;
  payload?: unknown;
};

export type PluginPanelBridgeResponse = {
  channel: typeof pluginPanelBridgeChannel;
  version: typeof pluginPanelBridgeVersion;
  type: 'response';
  requestId: string;
  pluginId: string;
} & (
  | {
      ok: true;
      result: unknown;
    }
  | {
      ok: false;
      error: string;
    }
);

export type PluginRuntimeStatus = 'disabled' | 'enabled' | 'running' | 'error';

export type PluginLogLevel = 'info' | 'warn' | 'error';

export type PluginLogEntry = {
  id: string;
  pluginId: string;
  level: PluginLogLevel;
  message: string;
  createdAt: string;
};

export type PluginActivitySummary = {
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastCommandAt: string | null;
  lastEventAt: string | null;
  lastNetworkAt: string | null;
  lastProviderCallAt: string | null;
  lastStorageWriteAt: string | null;
  lastSettingsWriteAt: string | null;
  lastErrorAt: string | null;
  commandRunCount: number;
  eventDispatchCount: number;
  networkCallCount: number;
  providerCallCount: number;
  storageWriteCount: number;
  settingsWriteCount: number;
  errorCount: number;
};

export type PluginSecuritySummary = {
  requestedPermissionCount: number;
  trustedPermissionCount: number;
  untrustedPermissions: PluginPermission[];
  highRiskPermissions: PluginPermission[];
  reservedPermissions: PluginPermission[];
  limitedPermissions: PluginPermission[];
  hasEntry: boolean;
  hasPanel: boolean;
  sandboxedPanel: boolean;
  commandCount: number;
  metadataProviderCount: number;
  sourceProviderCount: number;
  lyricsProviderCount: number;
  coverProviderCount: number;
  themePresetCount: number;
  settingCount: number;
  networkEnabled: boolean;
};

export type PluginCommand = PluginCommandContribution & {
  pluginId: string;
};

export type PluginCompatibilitySummary = {
  isCompatible: boolean;
  reason: string | null;
  minEchoVersion: string | null;
};

export type PluginPackageInfo = {
  origin: string | null;
  importedAt: string | null;
  packageVersion: number | null;
  checksum: string | null;
};

export type PluginHealthSummary = {
  lastStartedAt: string | null;
  lastApiCallAt: string | null;
  lastErrorAt: string | null;
  errorCount: number;
  disabledByHost: boolean;
};

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  compatibility: PluginCompatibilitySummary;
  packageInfo: PluginPackageInfo;
  health: PluginHealthSummary;
  directory: string;
  entry: string | null;
  panel: string | null;
  permissions: PluginPermission[];
  trustedPermissions: PluginPermission[];
  enabled: boolean;
  status: PluginRuntimeStatus;
  error: string | null;
  disabledByHost: boolean;
  activity: PluginActivitySummary;
  security: PluginSecuritySummary;
  contributes: PluginManifestContributes;
  commands: PluginCommand[];
  metadataProviders: PluginMetadataProvider[];
  sourceProviders: PluginSourceProvider[];
  lyricsProviders: PluginLyricsProvider[];
  coverProviders: PluginCoverProvider[];
  settingsValues: PluginSettingsPatch;
};

export type PluginListResult = {
  plugins: PluginSummary[];
  directory: string;
};

export type PluginEnableRequest = {
  pluginId: string;
  trustedPermissions?: PluginPermission[];
};

export type PluginRunCommandRequest = {
  pluginId: string;
  commandId: string;
  args?: unknown[];
};

export type PluginCreateExampleKind = 'playback-panel' | 'command-tool' | 'library-script' | 'source-provider' | 'theme-preset';

export type PluginCreateExampleResult = {
  pluginId: string;
  directory: string;
};

export type PluginPackageFile = {
  path: string;
  content: string;
};

export type PluginPackage = {
  type: 'echo-next-plugin-package';
  version: 1;
  exportedAt: string;
  manifest: PluginManifest;
  files: PluginPackageFile[];
};

export type PluginImportPackageResult = {
  pluginId: string;
  directory: string;
  importedFileCount: number;
  checksum: string;
  backedUpDirectory?: string | null;
};
