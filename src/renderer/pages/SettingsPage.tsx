import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  Captions,
  Check,
  Clapperboard,
  Code2,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Github,
  Globe2,
  GripVertical,
  Headphones,
  History,
  Info,
  Keyboard,
  Link2,
  MessageSquare,
  Palette,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  AudioDeviceInfo,
  AudioExportFormat,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioStatus,
  ChannelBalanceState,
  PlaybackSpeedMode,
} from '../../shared/types/audio';
import { QUIET_REPLAY_GAIN_TARGET_LUFS, SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS } from '../../shared/constants/replayGain';
import { isDownloadFeatureUnlockCode, isFinalThemeUnlockCode } from '../../shared/constants/featureUnlocks';
import { defaultArtistOnlineInfoSources, defaultArtistStreamingAlbumsProvider } from '../../shared/types/appSettings';
import {
  defaultSidebarRouteOrder,
  lockedVisibleSidebarRouteIds,
  normalizeSidebarHiddenRouteIds,
  normalizeSidebarRouteOrder,
  type SidebarRouteId,
} from '../../shared/types/sidebar';
import type { AccountProvider, AccountStatus, YouTubeBrowser } from '../../shared/types/accounts';
import type {
  ArtistOnlineInfoSource,
  ArtistStreamingAlbumsProvider,
  AppSettings,
  AppThemeCustomTheme,
  AppThemeMode,
  AppThemePreset,
  AppThemePresetOverrides,
  AppThemeToneOverride,
  NetworkProxyMode,
  NetworkProxyTestResult,
} from '../../shared/types/appSettings';
import type { MvSettings, NetworkMvProviderId } from '../../shared/types/mv';
import type { MiniPlayerState } from '../../shared/types/miniPlayer';
import {
  createDefaultGlobalShortcuts,
  createDefaultLocalShortcuts,
  createRecommendedGlobalShortcuts,
  createRecommendedLocalShortcuts,
  globalShortcutActions,
  validateGlobalShortcutAccelerator,
  type GlobalShortcutAction,
  type GlobalShortcutSettings,
  type LocalShortcutSettings,
} from '../../shared/types/globalShortcuts';
import type { AppCacheInventory, CoverCacheMigrationResult } from '../../shared/types/coverCache';
import type { LastCrashSummary } from '../../shared/types/diagnostics';
import type { DiscordPresenceStatus } from '../../shared/types/discordPresence';
import type { DownloadSettings } from '../../shared/types/downloads';
import type { DataBackupProgress, DataBackupStatus } from '../../shared/types/settingsBackup';
import type { LastFmStatus } from '../../shared/types/lastfm';
import type { PlaybackStatus } from '../../shared/types/playback';
import type { PluginSummary, PluginThemePresetContribution } from '../../shared/types/plugins';
import type { SmtcDiagnostics } from '../../shared/types/smtc';
import type { TaskbarPlaybackStatus } from '../../shared/types/taskbarPlayback';
import type {
  ArtistImageCacheSummary,
  ArtistImageJobStatus,
  BpmAnalysisJobStatus,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  LibraryDatabaseProtectionStatus,
  LibraryScanStatus,
  LyricsBackfillJobStatus,
  ReplayGainAnalysisJobStatus,
} from '../../shared/types/library';
import type { UpdateStatus } from '../../shared/types/updates';
import { LibraryDiagnosticsPanel } from '../components/library/LibraryDiagnosticsPanel';
import { LibraryHealthReportPanel } from '../components/library/LibraryHealthReportPanel';
import { LibraryFoldersPanel } from '../components/library/LibraryFoldersPanel';
import { LibraryQualityPanel } from '../components/library/LibraryQualityPanel';
import { NetworkMetadataPanel } from '../components/library/NetworkMetadataPanel';
import { LyricsSettingsPanel } from '../components/lyrics/LyricsSettingsDrawer';
import { AudioProfessionalStatusPanel } from '../components/player/AudioProfessionalStatusPanel';
import { PlaybackStabilityDiagnosticsPanel } from '../components/player/PlaybackStabilityDiagnosticsPanel';
import { SegmentLoopPanel } from '../components/player/SegmentLoopPanel';
import { formatAudioDiagnostics } from '../components/player/audioDiagnosticsFormat';
import { titleFromPath } from '../components/player/playerFormat';
import { DiagnosticsAssistantPanel } from '../components/settings/DiagnosticsAssistantPanel';
import { RemoteSourcesPanel } from '../components/settings/RemoteSourcesPanel';
import { StyledSelect } from '../components/ui/StyledSelect';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import {
  detectRendererPlatform,
  isAdvancedNativeOutputPlatform,
  isNativeSharedOutputPlatform,
  normalizeAudioSharedBackendForPlatform,
} from '../../shared/utils/audioPlatformCapabilities';
import {
  defaultAppearancePreferences,
  readAppearancePreferences,
  registerAppearanceFontFile,
  updateAppearancePreferences,
  type AppearancePreferences,
} from '../preferences/appearancePreferences';
import {
  applyThemeSettings,
  defaultThemeMode,
  defaultThemePreset,
  normalizeThemeCustomId,
  normalizeThemeCustomTheme,
  normalizeThemeCustomThemes,
  normalizeThemeHexColor,
  normalizeThemePreset,
  normalizeThemePresetOverrides,
  normalizeThemeScheduleTime,
  readThemeCustomId,
  readThemeCustomThemes,
  readThemePreset,
  readThemePresetOverrides,
  resolveThemeModeForSchedule,
  updateThemePreferences,
  updateThemePresetOverrides,
} from '../preferences/themePreferences';
import {
  getLibraryScanStatuses,
  rememberLibraryScanStatus,
  subscribeLibraryScanStatuses,
  type ScanStatusByFolder,
} from '../stores/libraryScanSession';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { isSpotifyTrack, seekSpotifyPlayback } from '../integrations/spotify/spotifyPlayback';
import { getVisualPlaybackState, refreshPlaybackStatus, setPlaybackStatusSnapshot, useSharedPlaybackStatus } from '../stores/playbackStatusStore';
import {
  getAccountsBridge,
  getAppBridge,
  getAudioBridge,
  getDiagnosticsBridge,
  getDiscordPresenceBridge,
  getDownloadsBridge,
  getEqBridge,
  getLastFmBridge,
  getLibraryBridge,
  getPluginsBridge,
  getSmtcBridge,
} from '../utils/echoBridge';
import { isImeComposingKeyEvent } from '../utils/imeInput';

const automixTemporarilyDisabled = true;

const normalizeAsioOutputChannelStart = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
};

const deviceMatchesAudioStatus = (device: AudioDeviceInfo, status: AudioStatus | null): boolean => {
  if (!status) {
    return false;
  }

  if (status.outputMode === 'system') {
    return false;
  }

  const modeMatches = status.outputMode === 'asio' ? device.outputMode === 'asio' : device.outputMode === 'shared';
  if (!modeMatches) {
    return false;
  }

  const identityMatches = status.outputDeviceId === device.id || status.outputDeviceName === device.name;
  if (!identityMatches || status.outputMode !== 'asio') {
    return identityMatches;
  }

  const deviceChannelStart = normalizeAsioOutputChannelStart(device.asioOutputChannelStart) ?? 0;
  const statusChannelStart = normalizeAsioOutputChannelStart(status.asioOutputChannelStart) ?? 0;
  return deviceChannelStart === statusChannelStart;
};

const playbackSpeedModes: Array<{ mode: PlaybackSpeedMode; label: string }> = [
  { mode: 'nightcore', label: 'Nightcore' },
  { mode: 'daycore', label: 'Daycore' },
  { mode: 'speed', label: '普通变速' },
];

const audioExportFormatOptions: Array<{ format: AudioExportFormat; label: string }> = [
  { format: 'mp3', label: 'MP3' },
  { format: 'wav', label: 'WAV' },
  { format: 'flac', label: 'FLAC' },
  { format: 'ogg', label: 'OGG' },
];

const globalShortcutActionMeta: Array<{
  action: GlobalShortcutAction;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  { action: 'playPause', titleKey: 'settings.shortcuts.action.playPause.title', descriptionKey: 'settings.shortcuts.action.playPause.description' },
  { action: 'previousTrack', titleKey: 'settings.shortcuts.action.previousTrack.title', descriptionKey: 'settings.shortcuts.action.previousTrack.description' },
  { action: 'nextTrack', titleKey: 'settings.shortcuts.action.nextTrack.title', descriptionKey: 'settings.shortcuts.action.nextTrack.description' },
  { action: 'stop', titleKey: 'settings.shortcuts.action.stop.title', descriptionKey: 'settings.shortcuts.action.stop.description' },
  { action: 'volumeUp', titleKey: 'settings.shortcuts.action.volumeUp.title', descriptionKey: 'settings.shortcuts.action.volumeUp.description' },
  { action: 'volumeDown', titleKey: 'settings.shortcuts.action.volumeDown.title', descriptionKey: 'settings.shortcuts.action.volumeDown.description' },
  { action: 'seekBackward', titleKey: 'settings.shortcuts.action.seekBackward.title', descriptionKey: 'settings.shortcuts.action.seekBackward.description' },
  { action: 'seekForward', titleKey: 'settings.shortcuts.action.seekForward.title', descriptionKey: 'settings.shortcuts.action.seekForward.description' },
  { action: 'showMainWindow', titleKey: 'settings.shortcuts.action.showMainWindow.title', descriptionKey: 'settings.shortcuts.action.showMainWindow.description' },
  { action: 'bossKey', titleKey: 'settings.shortcuts.action.bossKey.title', descriptionKey: 'settings.shortcuts.action.bossKey.description' },
  { action: 'speedUp', titleKey: 'settings.shortcuts.action.speedUp.title', descriptionKey: 'settings.shortcuts.action.speedUp.description' },
  { action: 'speedDown', titleKey: 'settings.shortcuts.action.speedDown.title', descriptionKey: 'settings.shortcuts.action.speedDown.description' },
  { action: 'openAudioSettings', titleKey: 'settings.shortcuts.action.openAudioSettings.title', descriptionKey: 'settings.shortcuts.action.openAudioSettings.description' },
  { action: 'openMvSettings', titleKey: 'settings.shortcuts.action.openMvSettings.title', descriptionKey: 'settings.shortcuts.action.openMvSettings.description' },
  { action: 'openLyricsSettings', titleKey: 'settings.shortcuts.action.openLyricsSettings.title', descriptionKey: 'settings.shortcuts.action.openLyricsSettings.description' },
  { action: 'locateCurrentTrack', titleKey: 'settings.shortcuts.action.locateCurrentTrack.title', descriptionKey: 'settings.shortcuts.action.locateCurrentTrack.description' },
  { action: 'toggleDesktopLyrics', titleKey: 'settings.shortcuts.action.toggleDesktopLyrics.title', descriptionKey: 'settings.shortcuts.action.toggleDesktopLyrics.description' },
  { action: 'toggleDesktopLyricsLock', titleKey: 'settings.shortcuts.action.toggleDesktopLyricsLock.title', descriptionKey: 'settings.shortcuts.action.toggleDesktopLyricsLock.description' },
];

type ShortcutScope = 'local' | 'global';
type RecordingShortcutTarget = {
  action: GlobalShortcutAction;
  scope: ShortcutScope;
};
type ShortcutMessageKey = `${ShortcutScope}:${GlobalShortcutAction}`;

const shortcutMessageKey = (scope: ShortcutScope, action: GlobalShortcutAction): ShortcutMessageKey => `${scope}:${action}`;
const localShortcutUnavailableActions = new Set<GlobalShortcutAction>(['showMainWindow']);

const shortcutKeyAliases = new Map<string, string>([
  [' ', 'Space'],
  ['Spacebar', 'Space'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['Escape', 'Esc'],
  ['+', 'Plus'],
  ['Add', 'Plus'],
  ['NumpadAdd', 'numadd'],
  ['Subtract', '-'],
  ['NumpadSubtract', 'numsub'],
  ['Multiply', '*'],
  ['NumpadMultiply', 'nummult'],
  ['Divide', '/'],
  ['NumpadDivide', 'numdiv'],
  ['Decimal', '.'],
  ['NumpadDecimal', 'numdec'],
  ['MediaPlayPause', 'MediaPlayPause'],
  ['MediaNextTrack', 'MediaNextTrack'],
  ['MediaPreviousTrack', 'MediaPreviousTrack'],
  ['MediaStop', 'MediaStop'],
]);

const normalizeShortcutEventKey = (event: KeyboardEvent): string | null => {
  const code = event.code;
  const aliasedCode = shortcutKeyAliases.get(code);
  if (aliasedCode) {
    return aliasedCode;
  }

  if (/^Key[A-Z]$/u.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/u.test(code)) {
    return code.slice(5);
  }

  if (/^Numpad[0-9]$/u.test(code)) {
    return `num${code.slice(6)}`;
  }

  const aliased = shortcutKeyAliases.get(event.key);
  if (aliased) {
    return aliased;
  }

  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') {
    return null;
  }

  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
};

const acceleratorFromKeyboardEvent = (event: KeyboardEvent): string | null => {
  const key = normalizeShortcutEventKey(event);
  if (!key) {
    return null;
  }

  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Command' : null,
  ].filter((item): item is string => Boolean(item));

  return [...modifiers, key].join('+');
};

const acceleratorFromMouseEvent = (event: MouseEvent): string | null => {
  switch (event.button) {
    case 1:
      return 'MouseButton3';
    case 3:
      return 'MouseButton4';
    case 4:
      return 'MouseButton5';
    default:
      return null;
  }
};

const formatAcceleratorForDisplay = (accelerator: string | null | undefined, emptyLabel: string): string =>
  accelerator ? accelerator.split('+').join(' + ') : emptyLabel;

const findDuplicateShortcutAction = (
  shortcuts: GlobalShortcutSettings | LocalShortcutSettings,
  action: GlobalShortcutAction,
  accelerator: string,
): GlobalShortcutAction | null => {
  const normalized = accelerator.toLowerCase();
  return (
    globalShortcutActions.find(
      (candidate) => candidate !== action && shortcuts[candidate]?.accelerator?.toLowerCase() === normalized,
    ) ?? null
  );
};

const mergeShortcutSettings = <T extends GlobalShortcutSettings | LocalShortcutSettings>(
  defaults: T,
  saved: Partial<T> | null | undefined,
): T =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...defaults[action],
        ...(saved?.[action] ?? {}),
      },
    ]),
  ) as T;

const normalizeSharedBackend = (value: unknown): AudioSharedBackend =>
  value === 'windows' || value === 'directsound' || value === 'alsa' ? value : 'auto';

const defaultSpotifyRedirectUri = 'http://127.0.0.1:43879/spotify/callback';
const defaultTidalRedirectUri = 'http://127.0.0.1:43880/tidal/callback';
const spotifyDeveloperDashboardUrl = 'https://developer.spotify.com/dashboard';
const tidalDeveloperDashboardUrl = 'https://developer.tidal.com/dashboard';
const discogsDeveloperSettingsUrl = 'https://www.discogs.com/settings/developers';
const playbackAdvancedPanelExpandedStorageKey = 'echo:settings:playback:advanced-panel-expanded';
const integrationsAccountPanelExpandedStorageKey = 'echo:settings:integrations:account-panel-expanded';
const integrationsCredentialPanelExpandedStorageKey = 'echo:settings:integrations:credential-panel-expanded';
const finalThemeUnlockedStorageKey = 'echo-next:settings:final-theme-unlocked';
const integrationCredentialSettingIds = new Set([
  'settings-row-spotify-auth-config',
  'settings-row-tidal-auth-config',
  'settings-row-online-album-info',
  'settings-row-online-artist-info',
  'settings-row-lastfm',
  'settings-row-lastfm-connection',
  'settings-row-lastfm-now-playing',
  'settings-row-lastfm-scrobbling',
]);

const isIntegrationCredentialSettingId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && integrationCredentialSettingIds.has(value);

const readBooleanStoragePreference = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const value = window.localStorage.getItem(key);
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const isSpotifyClientIdInputValid = (value: string): boolean => {
  const trimmed = value.trim();
  return /^[A-Za-z0-9]{8,128}$/u.test(trimmed);
};

const isSpotifyRedirectUriInputValid = (value: string): boolean => {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const port = Number.parseInt(url.port, 10);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};

const isTidalClientIdInputValid = (value: string): boolean => /^[A-Za-z0-9_-]{8,128}$/u.test(value.trim());

const isTidalClientSecretInputValid = (value: string): boolean => /^[A-Za-z0-9._~+/=-]{8,256}$/u.test(value.trim());

const isTidalCountryCodeInputValid = (value: string): boolean => /^[A-Za-z]{2}$/u.test(value.trim());

const playbackOutputModes: AudioOutputMode[] = ['system', 'shared', 'exclusive', 'asio'];

const detectSettingsPlatform = (): NodeJS.Platform | 'unknown' =>
  typeof window !== 'undefined' ? detectRendererPlatform(window.navigator) : 'unknown';

const getPlaybackOutputModesForPlatform = (platform: NodeJS.Platform | 'unknown'): AudioOutputMode[] =>
  playbackOutputModes.filter((mode) => {
    if (mode === 'system') {
      return true;
    }

    if (mode === 'shared') {
      return isNativeSharedOutputPlatform(platform);
    }

    return isAdvancedNativeOutputPlatform(platform);
  });

const getPlaybackOutputModeLabel = (mode: AudioOutputMode, translate: (key: TranslationKey) => string): string =>
  translate(`settings.playback.outputMode.${mode}` as TranslationKey);

const getSharedBackendOptionsForPlatform = (
  platform: NodeJS.Platform | 'unknown',
): Array<[AudioSharedBackend, TranslationKey]> => {
  if (platform === 'linux') {
    return [
      ['auto', 'settings.playback.sharedBackend.auto'],
      ['alsa', 'settings.playback.sharedBackend.alsa'],
    ];
  }

  if (platform === 'win32') {
    return [
      ['auto', 'settings.playback.sharedBackend.wasapi'],
      ['directsound', 'settings.playback.sharedBackend.directSound'],
    ];
  }

  return [];
};

const getSharedBackendDescriptionKey = (platform: NodeJS.Platform | 'unknown'): TranslationKey =>
  platform === 'linux' ? 'settings.playback.sharedBackend.linuxDescription' : 'settings.playback.sharedBackend.description';

const getCompatiblePlaybackDevices = (devices: AudioDeviceInfo[], outputMode: AudioOutputMode): AudioDeviceInfo[] => {
  if (outputMode === 'system') {
    return [];
  }

  return devices.filter((device) => (outputMode === 'asio' ? device.outputMode === 'asio' : device.outputMode === 'shared'));
};

const networkProviderLabels: Record<AppSettings['networkMetadataProviders'][number], string> = {
  'netease-cloud-music': '网易云音乐',
  'qq-music': 'QQ 音乐',
  'kugou-music': '酷狗音乐',
  musicbrainz: 'MusicBrainz',
  'cover-art-archive': 'Cover Art Archive',
  mock: 'Mock',
};
const visibleNetworkMetadataProviders: AppSettings['networkMetadataProviders'] = ['netease-cloud-music', 'qq-music', 'kugou-music', 'musicbrainz'];
const defaultNetworkMetadataProviders: AppSettings['networkMetadataProviders'] = ['netease-cloud-music', 'qq-music'];
const artistOnlineInfoSourceOptions: Array<{ source: ArtistOnlineInfoSource; label: string; description: string }> = [
  { source: 'baidu-baike', label: '百度百科', description: '中文艺人和大众歌手优先' },
  { source: 'wikipedia', label: 'Wikipedia', description: '国际艺人兜底' },
];
const artistStreamingAlbumProviderOptions: Array<{ provider: ArtistStreamingAlbumsProvider; label: string; description: string }> = [
  { provider: 'netease', label: '网易云', description: '默认来源，优先减少额外搜索压力' },
  { provider: 'qqmusic', label: 'QQ音乐', description: '艺人详情专辑页改用 QQ 音乐搜索' },
];
const mvNetworkProviders: NetworkMvProviderId[] = ['bilibili', 'youtube'];
const mvProviderLabels: Record<NetworkMvProviderId, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
};
const mvQualityCaps: MvSettings['maxQuality'][] = ['720p', '1080p', '1440p', '2160p', 'max'];
const mvSyncModes = ['stable', 'balanced', 'precise'] satisfies Array<NonNullable<MvSettings['syncMode']>>;
const mvImmersiveBackgroundDefaults = {
  immersiveBackgroundScalePercent: 115,
  immersiveBackgroundOffsetXPercent: 50,
  immersiveBackgroundOffsetYPercent: 50,
  immersiveBackgroundBlurPx: 0,
  immersiveBackgroundBrightnessPercent: 100,
  immersiveBackgroundOverlayOpacityPercent: 0,
} satisfies Partial<MvSettings>;
const appVideoWallpaperPauseModes = ['smart', 'minimized', 'never'] satisfies Array<NonNullable<AppSettings['appVideoWallpaperPauseMode']>>;
const appVideoWallpaperPauseModeLabels: Record<NonNullable<AppSettings['appVideoWallpaperPauseMode']>, TranslationKey> = {
  smart: 'settings.appearance.wallpaper.videoPause.smart',
  minimized: 'settings.appearance.wallpaper.videoPause.minimized',
  never: 'settings.appearance.wallpaper.videoPause.never',
};

const inferAppWallpaperMediaType = (filePath: string): NonNullable<AppSettings['appWallpaperMediaType']> =>
  /\.(?:mp4|m4v|webm)$/iu.test(filePath.trim()) ? 'video' : 'image';

const hasOwn = <T extends object>(value: T, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

const formatMvThreshold = (threshold: number | undefined): string => `${Math.round((threshold ?? 0.7) * 100)}%`;
const mvThresholdFromPercent = (value: number): number => Math.max(30, Math.min(100, Math.round(value))) / 100;

const normalizeMvProviderOrder = (value: NetworkMvProviderId[] | undefined): NetworkMvProviderId[] => {
  const ordered = (value ?? mvNetworkProviders).filter((provider): provider is NetworkMvProviderId => mvNetworkProviders.includes(provider));
  const missing = mvNetworkProviders.filter((provider) => !ordered.includes(provider));
  return [...ordered, ...missing];
};

const appSettingsPatchFromMvSettingsPatch = (patch: Partial<MvSettings>): Partial<AppSettings> => {
  const appPatch: Partial<AppSettings> = {};

  if (hasOwn(patch, 'enabled')) {
    appPatch.mvEnabled = patch.enabled;
  }
  if (hasOwn(patch, 'enabledProviders') && patch.enabledProviders) {
    appPatch.mvEnabledProviders = patch.enabledProviders;
  }
  if (hasOwn(patch, 'providerOrder') && patch.providerOrder) {
    appPatch.mvProviderOrder = patch.providerOrder;
  }
  if (hasOwn(patch, 'autoSearch') && patch.autoSearch !== undefined) {
    appPatch.mvAutoSearch = patch.autoSearch;
  }
  if (hasOwn(patch, 'autoPreload')) {
    appPatch.mvAutoPreload = patch.autoPreload;
  }
  if (hasOwn(patch, 'autoApplyThreshold')) {
    appPatch.mvAutoApplyThreshold = patch.autoApplyThreshold;
  }
  if (hasOwn(patch, 'preferHighestViewCount')) {
    appPatch.mvPreferHighestViewCount = patch.preferHighestViewCount;
  }
  if (hasOwn(patch, 'immersiveBackground')) {
    appPatch.mvImmersiveBackground = patch.immersiveBackground;
  }
  if (hasOwn(patch, 'immersiveBackgroundScalePercent')) {
    appPatch.mvImmersiveBackgroundScalePercent = patch.immersiveBackgroundScalePercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOffsetXPercent')) {
    appPatch.mvImmersiveBackgroundOffsetXPercent = patch.immersiveBackgroundOffsetXPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOffsetYPercent')) {
    appPatch.mvImmersiveBackgroundOffsetYPercent = patch.immersiveBackgroundOffsetYPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundBlurPx')) {
    appPatch.mvImmersiveBackgroundBlurPx = patch.immersiveBackgroundBlurPx;
  }
  if (hasOwn(patch, 'immersiveBackgroundBrightnessPercent')) {
    appPatch.mvImmersiveBackgroundBrightnessPercent = patch.immersiveBackgroundBrightnessPercent;
  }
  if (hasOwn(patch, 'immersiveBackgroundOverlayOpacityPercent')) {
    appPatch.mvImmersiveBackgroundOverlayOpacityPercent = patch.immersiveBackgroundOverlayOpacityPercent;
  }
  if (hasOwn(patch, 'lyricsReadabilityEnhanced')) {
    appPatch.mvLyricsReadabilityEnhanced = patch.lyricsReadabilityEnhanced;
  }
  if (hasOwn(patch, 'restartAudioOnLoad')) {
    appPatch.mvRestartAudioOnLoad = patch.restartAudioOnLoad;
  }
  if (hasOwn(patch, 'syncMode')) {
    appPatch.mvSyncMode = patch.syncMode;
  }
  if (hasOwn(patch, 'replayAudioOnChange')) {
    appPatch.mvReplayAudioOnChange = patch.replayAudioOnChange;
  }
  if (hasOwn(patch, 'maxQuality') && patch.maxQuality) {
    appPatch.mvMaxQuality = patch.maxQuality;
  }
  if (hasOwn(patch, 'allow60fps') && patch.allow60fps !== undefined) {
    appPatch.mvAllow60fps = patch.allow60fps;
  }

  return appPatch;
};

const normalizeExternalAppSettingsPatch = (patch: Partial<AppSettings> | Partial<MvSettings>): Partial<AppSettings> => ({
  ...(patch as Partial<AppSettings>),
  ...appSettingsPatchFromMvSettingsPatch(patch as Partial<MvSettings>),
});

type SettingsNavKey = 'general' | 'playback' | 'shortcuts' | 'lyrics' | 'mv' | 'integrations' | 'plugins' | 'remote' | 'eq' | 'appearance' | 'library' | 'about' | 'danger';

type SettingsNavItem = {
  key: SettingsNavKey;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

type SettingsSearchResult = {
  id: string;
  sectionKey: SettingsNavKey;
  title: string;
  description: string;
  targetId?: string;
  score: number;
};

type FontPickerTarget = 'main' | 'chinese' | 'fallback';
type AlbumMergeStrategy = AppSettings['albumMergeStrategy'];
type ArtistMergeStrategy = NonNullable<AppSettings['artistMergeStrategy']>;
type AccountBusyAction = 'save' | 'check' | 'clear' | 'browser' | 'login';

type LocalFontData = {
  family: string;
};

type NavigatorWithLocalFonts = Navigator & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

const fallbackFontFamilies = [
  'Outfit',
  'Inter',
  'Segoe UI',
  'Arial',
  'Helvetica Neue',
  'Microsoft YaHei',
  'Microsoft JhengHei',
  'PingFang SC',
  'PingFang TC',
  'Noto Sans SC',
  'Noto Sans TC',
  'Source Han Sans SC',
  'Source Han Sans TC',
  'SimHei',
  'SimSun',
  'Hiragino Sans',
  'Yu Gothic',
  'Meiryo',
];

const accountProviderLabels: Record<AccountProvider, string> = {
  kugou: '酷狗音乐',
  netease: '网易云音乐',
  qqmusic: 'QQ 音乐',
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  osu: 'osu!',
};

type ArtistImageProgress = ArtistImageJobStatus & {
  startedAt: number;
};

const libraryScanRunningStatuses = new Set<LibraryScanStatus['status']>(['queued', 'running']);

const libraryScanPhaseLabels: Record<LibraryScanStatus['phase'], string> = {
  queued: '排队中',
  discovering: '发现文件',
  checking_cache: '检查缓存',
  reading_metadata: '读取元数据',
  extracting_covers: '处理封面',
  grouping_albums: '整理专辑/艺人',
  writing_database: '写入数据库',
  finished: '完成',
  failed: '失败',
  cancelled: '已取消',
};

const formatLibraryScanProgressMessage = (statuses: LibraryScanStatus[]): string | null => {
  if (statuses.length === 0) {
    return null;
  }

  const active = statuses.filter((status) => libraryScanRunningStatuses.has(status.status));
  const failed = statuses.filter((status) => status.status === 'failed').length;
  const completed = statuses.filter((status) => status.status === 'completed').length;
  const cancelled = statuses.filter((status) => status.status === 'cancelled').length;
  const totalFiles = statuses.reduce((total, status) => total + status.totalFiles, 0);
  const processedFiles = statuses.reduce((total, status) => total + status.processedFiles, 0);
  const skippedFiles = statuses.reduce((total, status) => total + status.skippedFiles, 0);
  const errorCount = statuses.reduce((total, status) => total + status.errorCount, 0);

  if (active.length > 0) {
    const current = active.find((status) => status.status === 'running') ?? active[0];
    const phase = current ? libraryScanPhaseLabels[current.phase] ?? current.phase : '扫描中';
    return `扫描进度：${processedFiles}/${totalFiles || '?'}，跳过 ${skippedFiles}，错误 ${errorCount}。当前 ${phase}，排队/运行 ${active.length} 个。`;
  }

  return `扫描结束：完成 ${completed} 个，取消 ${cancelled} 个，失败 ${failed} 个；已处理 ${processedFiles}/${totalFiles || 0}，跳过 ${skippedFiles}，错误 ${errorCount}。`;
};

const emptyArtistImageSummary: ArtistImageCacheSummary = {
  total: 0,
  matched: 0,
  pending: 0,
  loading: 0,
  notFound: 0,
  error: 0,
  rateLimited: 0,
};

const accountLoginUrls: Record<AccountProvider, string> = {
  netease: 'https://music.163.com/',
  qqmusic: 'https://y.qq.com/',
  kugou: 'https://www.kugou.com/',
  bilibili: 'https://www.bilibili.com/',
  youtube: 'https://www.youtube.com/',
  soundcloud: 'https://soundcloud.com/',
  spotify: 'https://accounts.spotify.com/',
  tidal: 'https://login.tidal.com/',
  osu: 'https://osu.ppy.sh/',
};

const cookieAccountProviders: AccountProvider[] = ['netease', 'qqmusic', 'kugou', 'bilibili', 'soundcloud', 'osu'];
const buildYouTubeBrowserOptions = (t: (key: TranslationKey, params?: Record<string, string | number>) => string): Array<{ value: YouTubeBrowser; label: string }> => [
  { value: 'edge', label: 'Edge' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'none', label: t('settings.integrations.accounts.youtube.browserNone') },
];

const defaultNetworkProxyBypassRules =
  '<local>;localhost;127.0.0.1;::1;*.local;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*';
const buildNetworkProxyModeOptions = (t: (key: TranslationKey, params?: Record<string, string | number>) => string): Array<{ value: NetworkProxyMode; label: string }> => [
  { value: 'off', label: t('settings.integrations.networkProxy.mode.off') },
  { value: 'system', label: t('settings.integrations.networkProxy.mode.system') },
  { value: 'manual', label: t('settings.integrations.networkProxy.mode.manual') },
  { value: 'pac', label: 'PAC' },
];

const dataBackupProgressPhaseLabels: Record<DataBackupProgress['phase'], TranslationKey> = {
  preparing: 'settings.general.dataBackup.progress.preparing',
  snapshot: 'settings.general.dataBackup.progress.snapshot',
  scanning: 'settings.general.dataBackup.progress.scanning',
  writing: 'settings.general.dataBackup.progress.writing',
  finalizing: 'settings.general.dataBackup.progress.finalizing',
  completed: 'settings.general.dataBackup.progress.completed',
  failed: 'settings.general.dataBackup.progress.failed',
};

type SettingSectionProps = {
  id: SettingsNavKey;
  activeKey: SettingsNavKey;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
};

type SettingRowProps = {
  className?: string;
  id?: string;
  highlighted?: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

const playbackSeekedEvent = 'playback:seeked';

const dispatchPlaybackSeeked = (positionSeconds: number, trackId: string | null): void => {
  window.dispatchEvent(new CustomEvent(playbackSeekedEvent, { detail: { positionSeconds, trackId } }));
};

const defaultSettingsChannelBalance: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
  clippingRisk: false,
};

const hasNonMonoChannelBalanceEffect = (state: ChannelBalanceState): boolean =>
  Math.abs(state.balance) > 0.001 ||
  Math.abs(state.leftGainDb) > 0.001 ||
  Math.abs(state.rightGainDb) > 0.001 ||
  Math.abs(state.leftDelayMs ?? 0) > 0.001 ||
  Math.abs(state.rightDelayMs ?? 0) > 0.001 ||
  state.swapLeftRight ||
  state.invertLeft ||
  state.invertRight ||
  state.constantPower === false;

const scheduleSettingsIdleTask = (callback: () => void): (() => void) => {
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  const requestIdleCallback = window.requestIdleCallback;
  const cancelIdleCallback = window.cancelIdleCallback;

  const frameId = window.requestAnimationFrame(() => {
    if (cancelled) {
      return;
    }

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        if (!cancelled) {
          callback();
        }
      }, { timeout: 1200 });
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        callback();
      }
    }, 120);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
};

const settingsNavItems: SettingsNavItem[] = [
  { key: 'general', labelKey: 'settings.nav.general.label', descriptionKey: 'settings.nav.general.description', icon: MessageSquare },
  { key: 'playback', labelKey: 'settings.nav.playback.label', descriptionKey: 'settings.nav.playback.description', icon: Zap },
  { key: 'shortcuts', labelKey: 'settings.nav.shortcuts.label', descriptionKey: 'settings.nav.shortcuts.description', icon: Keyboard },
  { key: 'lyrics', labelKey: 'route.lyricsSettings.label', descriptionKey: 'route.lyricsSettings.description', icon: Captions },
  { key: 'mv', labelKey: 'route.mvSettings.label', descriptionKey: 'route.mvSettings.description', icon: Clapperboard },
  { key: 'integrations', labelKey: 'settings.nav.integrations.label', descriptionKey: 'settings.nav.integrations.description', icon: Link2 },
  { key: 'plugins', labelKey: 'settings.nav.plugins.label', descriptionKey: 'settings.nav.plugins.description', icon: Code2 },
  { key: 'remote', labelKey: 'settings.nav.remote.label', descriptionKey: 'settings.nav.remote.description', icon: Globe2 },
  { key: 'eq', labelKey: 'settings.nav.eq.label', descriptionKey: 'settings.nav.eq.description', icon: SlidersHorizontal },
  { key: 'appearance', labelKey: 'settings.nav.appearance.label', descriptionKey: 'settings.nav.appearance.description', icon: Palette },
  { key: 'library', labelKey: 'settings.nav.library.label', descriptionKey: 'settings.nav.library.description', icon: Download },
  { key: 'about', labelKey: 'settings.nav.about.label', descriptionKey: 'settings.nav.about.description', icon: Info },
  { key: 'danger', labelKey: 'settings.nav.danger.label', descriptionKey: 'settings.nav.danger.description', icon: Trash2 },
];

type SidebarSettingsRouteItem = {
  id: SidebarRouteId;
  labelKey: TranslationKey;
  placement: 'main' | 'utility';
};

const sidebarSettingsCopy = {
  titleKey: 'settings.appearance.sidebar.title',
  descriptionKey: 'settings.appearance.sidebar.description',
  mainGroupKey: 'settings.appearance.sidebar.mainGroup',
  utilityGroupKey: 'settings.appearance.sidebar.utilityGroup',
  resetKey: 'settings.appearance.sidebar.reset',
  expandKey: 'settings.appearance.sidebar.expand',
  collapseKey: 'settings.appearance.sidebar.collapse',
  visibleKey: 'settings.appearance.sidebar.visible',
  hiddenKey: 'settings.appearance.sidebar.hidden',
  fixedKey: 'settings.appearance.sidebar.fixed',
  noItemsKey: 'settings.appearance.sidebar.noItems',
} as const satisfies Record<string, TranslationKey>;

const sidebarSettingsRouteItems: SidebarSettingsRouteItem[] = [
  { id: 'home', labelKey: 'route.home.label', placement: 'main' },
  { id: 'songs', labelKey: 'route.songs.label', placement: 'main' },
  { id: 'downloads', labelKey: 'route.downloads.label', placement: 'main' },
  { id: 'albums', labelKey: 'route.albums.label', placement: 'main' },
  { id: 'artists', labelKey: 'route.artists.label', placement: 'main' },
  { id: 'folders', labelKey: 'route.folders.label', placement: 'main' },
  { id: 'remote', labelKey: 'route.remote.label', placement: 'main' },
  { id: 'connect', labelKey: 'route.connect.label', placement: 'main' },
  { id: 'dsp', labelKey: 'route.dsp.label', placement: 'main' },
  { id: 'streaming', labelKey: 'route.streaming.label', placement: 'main' },
  { id: 'queue', labelKey: 'route.queue.label', placement: 'main' },
  { id: 'history', labelKey: 'route.history.label', placement: 'main' },
  { id: 'playlists', labelKey: 'route.playlists.label', placement: 'main' },
  { id: 'inbox', labelKey: 'route.inbox.label', placement: 'main' },
  { id: 'plugins', labelKey: 'route.plugins.label', placement: 'main' },
  { id: 'liked', labelKey: 'route.liked.label', placement: 'utility' },
  { id: 'settings', labelKey: 'route.settings.label', placement: 'utility' },
  { id: 'audio-settings', labelKey: 'route.audioSettings.label', placement: 'utility' },
  { id: 'lyrics-settings', labelKey: 'route.lyricsSettings.label', placement: 'utility' },
  { id: 'import-folder', labelKey: 'route.importFolder.label', placement: 'utility' },
  { id: 'import-file', labelKey: 'route.importFile.label', placement: 'utility' },
];

const sidebarSettingsRouteItemById = new Map(sidebarSettingsRouteItems.map((item) => [item.id, item]));
const lockedVisibleSidebarRouteIdSet = new Set<SidebarRouteId>(lockedVisibleSidebarRouteIds);

const pendingSettingsSectionStorageKey = 'echo-next.settings.pending-section';
const pendingRouteStorageKey = 'echo-next.pending-route';
const settingsBackNavigationEvent = 'app:navigate:settings-back';
const pluginsDocumentationUrl = 'https://github.com/moekotori/echo/blob/main/docs/ECHO_NEXT_PLUGINS.md';
const settingsNavKeys = new Set<SettingsNavKey>(settingsNavItems.map((item) => item.key));

const isSettingsEscapeBackEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
};

const readInitialSettingsSection = (): SettingsNavKey => {
  if (typeof window === 'undefined') {
    return 'general';
  }

  try {
    const pendingSection = window.sessionStorage.getItem(pendingSettingsSectionStorageKey) ?? window.localStorage.getItem(pendingSettingsSectionStorageKey);
    if (pendingSection && settingsNavKeys.has(pendingSection as SettingsNavKey)) {
      window.sessionStorage.removeItem(pendingSettingsSectionStorageKey);
      window.localStorage.removeItem(pendingSettingsSectionStorageKey);
      return pendingSection as SettingsNavKey;
    }
  } catch {
    // Fall through to the default section when browser storage is unavailable.
  }

  return 'general';
};

const settingsSearchAliases: Record<SettingsNavKey, string[]> = {
  general: ['general', 'language', 'locale', 'tray', 'window size', 'backup', 'settings backup', 'data backup', 'auto backup', 'restore backup', '通用', '语言', '简繁', '繁简', '托盘', '窗口尺寸', '备份', '自动备份', '数据备份', '导入备份'],
  playback: [
    'playback',
    'audio',
    'output',
    'device',
    'asio',
    'wasapi',
    'exclusive',
    'juce',
    'dsd',
    'dop',
    'soxr',
    'speed',
    'hqplayer',
    'hq player',
    'network audio adapter',
    'external playback',
    'naa',
    '播放',
    '音频',
    '输出',
    '设备',
    '独占',
    '采样率',
    '重启音频',
    '变速',
    '当前播放',
  ],
  shortcuts: ['shortcuts', 'hotkeys', 'keyboard', 'local shortcut', 'global shortcut', 'record shortcut', '快捷键', '热键', '键盘', '普通快捷键', '局部快捷键', '全局快捷键'],
  lyrics: [
    'lyrics',
    'lrc',
    'karaoke',
    'offset',
    'provider',
    'romaji',
    'utaten',
    'UtaTen',
    'kana',
    'furigana',
    '假名',
    'ふりがな',
    '注音',
    'translation',
    'translate',
    'translated lyrics',
    'bilingual lyrics',
    'font',
    'lyrics font',
    'custom font',
    '字体',
    '歌词字体',
    '自定义字体',
    '歌词',
    '逐字',
    '偏移',
    '音译',
    '罗马音',
    '歌词源',
    '翻译',
    '译文',
    '中文翻译',
    '双语歌词',
    '歌詞',
    '翻譯',
    '譯文',
    '雙語歌詞',
  ],
  mv: ['mv', 'music video', 'video', 'bilibili', 'youtube', 'auto search', 'preload', 'quality', 'immersive', 'background'],
  integrations: [
    'integrations',
    'account',
    'login',
    'last.fm',
    'discord',
    'smtc',
    'youtube',
    'spotify',
    'bilibili',
    'netease',
    'qq music',
    '集成',
    '账号',
    '登录',
    '账户',
    '网易云',
    'QQ 音乐',
    '哔哩哔哩',
    '会员',
  ],
  plugins: ['插件', 'plugin', 'plugins', '扩展', '脚本', 'manifest', '权限', '本地插件', '开发者', 'developer', 'sandbox', 'echo.plugin.json'],
  remote: ['remote', 'webdav', 'baidu', 'subsonic', 'jellyfin', 'emby', 'navidrome', 'server', '远程', '网盘', '百度网盘', '服务器', '媒体库', '云端'],
  eq: ['eq', 'equalizer', 'balance', 'preamp', 'channel', '均衡器', '均衡', '声道', '平衡', '预放大'],
  appearance: [
    'appearance',
    'theme',
    'dark',
    'light',
    'system',
    'wallpaper',
    'font',
    'density',
    'sidebar',
    'side bar',
    'left sidebar',
    'navigation order',
    'hide navigation',
    'artist avatar',
    'artist image',
    'cover',
    'transparent',
    '\u5de6\u4fa7\u680f',
    '\u4fa7\u680f',
    '\u5bfc\u822a\u6392\u5e8f',
    '\u9690\u85cf\u680f\u76ee',
    '外观',
    '主题',
    '深色',
    '浅色',
    '跟随系统',
    '壁纸',
    '字体',
    '密度',
    '艺术家头像',
    '艺术家封面',
    '封面',
    '透明',
    '背景',
  ],
  library: [
    'library',
    'folder',
    'scan',
    'cache',
    'download',
    'metadata',
    'duplicate',
    'bpm',
    'embedded tags',
    'artist images',
    '曲库',
    '资料库',
    '文件夹',
    '扫描',
    '缓存',
    '下载',
    '元数据',
    '重复歌曲',
    '内嵌标签',
    'BPM',
    '\u7f13\u5b58',
    '\u6062\u590d',
    '\u6570\u636e\u5e93',
    '\u7f51\u76d8',
    '\u5b9e\u65f6\u66f4\u65b0',
    '\u6b4c\u8bcd',
    'MV',
    '\u66f2\u5e93\u4f53\u68c0',
    '\u5065\u5eb7\u62a5\u544a',
    '\u5bfc\u51fa\u62a5\u544a',
    'health report',
    'library health',
  ],
  about: ['about', 'version', 'update', 'diagnostics', 'crash', 'repository', 'safe mode', 'startup', '关于', '版本', '更新', '诊断', '崩溃', '仓库', '慢启动'],
  danger: ['danger', 'reset', 'clear cache', 'delete cache', 'restore defaults', 'rebuild database', 'repair database', 'delete database', 'database recovery', 'database snapshot', 'database health', 'duplicate cleanup', 'duplicate songs', '危险', '重置', '清空缓存', '恢复默认', '重建数据库', '修复数据库', '删除数据库', '数据库恢复', '曲库恢复', '健康快照', '重复歌曲', '清理重复', '重复清理'],
};

const normalizeSettingsSearchText = (value: string): string => value.trim().toLocaleLowerCase();

const compactSettingsSearchText = (value: string): string => normalizeSettingsSearchText(value).replace(/\s+/gu, '');

const settingsSearchKeywordAliases: Record<string, string[]> = {
  status: ['state', 'connected', 'connection', 'presence', 'running', 'enabled', 'disabled', 'error', 'login', '健康', '状态', '狀態', '连接', '連線', '在线', '启用', '啟用'],
  状态: ['status', 'state', 'presence', 'connected', 'connection', 'running', 'enabled', 'disabled', 'error', '狀態', '连接', '在线', '启用'],
  狀態: ['status', 'state', 'presence', 'connected', 'connection', 'running', 'enabled', 'disabled', 'error', '状态', '連線', '在線', '啟用'],
  presence: ['discord', 'rich presence', 'status', '状态', '狀態'],
};

const expandSettingsSearchQuery = (query: string): string[] => {
  const normalized = normalizeSettingsSearchText(query);
  const compact = compactSettingsSearchText(query);
  const expansions = new Set([normalized, compact]);

  [normalized, compact].forEach((token) => {
    settingsSearchKeywordAliases[token]?.forEach((alias) => {
      expansions.add(normalizeSettingsSearchText(alias));
      expansions.add(compactSettingsSearchText(alias));
    });
  });

  return [...expansions].filter(Boolean);
};

const rankSettingsSearch = (query: string, terms: string[]): number => {
  const queries = expandSettingsSearchQuery(query);
  const normalizedTerms = terms.flatMap((term) => [normalizeSettingsSearchText(term), compactSettingsSearchText(term)]).filter(Boolean);

  let bestScore = 0;
  queries.forEach((candidateQuery, queryIndex) => {
    normalizedTerms.forEach((term, termIndex) => {
      if (!candidateQuery || !term) {
        return;
      }

      const aliasPenalty = queryIndex === 0 ? 0 : 8;
      const termPenalty = Math.min(termIndex, 8);
      if (term === candidateQuery) {
        bestScore = Math.max(bestScore, 120 - aliasPenalty - termPenalty);
      } else if (term.startsWith(candidateQuery)) {
        bestScore = Math.max(bestScore, 95 - aliasPenalty - termPenalty);
      } else if (term.includes(candidateQuery)) {
        bestScore = Math.max(bestScore, 75 - aliasPenalty - termPenalty);
      } else if (candidateQuery.length >= 2 && candidateQuery.includes(term)) {
        bestScore = Math.max(bestScore, 45 - aliasPenalty - termPenalty);
      }
    });
  });

  return bestScore;
};

const isSafeMarkdownHref = (href: string): boolean => {
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:|#|\/(?!\/))/iu.test(trimmed);
};

const looksLikeReleaseNotesHtml = (value: string): boolean => /<\/?[a-z][\s\S]*>/iu.test(value);

const parseMarkdownInline = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let textBuffer = '';

  const flushText = (): void => {
    if (textBuffer) {
      nodes.push(textBuffer);
      textBuffer = '';
    }
  };

  while (cursor < text.length) {
    if (text.startsWith('`', cursor)) {
      const end = text.indexOf('`', cursor + 1);
      if (end > cursor + 1) {
        flushText();
        nodes.push(<code key={`${keyPrefix}-code-${cursor}`}>{text.slice(cursor + 1, end)}</code>);
        cursor = end + 1;
        continue;
      }
    }

    if (text.startsWith('**', cursor)) {
      const end = text.indexOf('**', cursor + 2);
      if (end > cursor + 2) {
        flushText();
        nodes.push(<strong key={`${keyPrefix}-strong-${cursor}`}>{parseMarkdownInline(text.slice(cursor + 2, end), `${keyPrefix}-strong-${cursor}`)}</strong>);
        cursor = end + 2;
        continue;
      }
    }

    if (text[cursor] === '[') {
      const labelEnd = text.indexOf(']', cursor + 1);
      const hrefStart = labelEnd >= 0 && text[labelEnd + 1] === '(' ? labelEnd + 2 : -1;
      const hrefEnd = hrefStart >= 0 ? text.indexOf(')', hrefStart) : -1;

      if (labelEnd > cursor + 1 && hrefStart >= 0 && hrefEnd > hrefStart) {
        const label = text.slice(cursor + 1, labelEnd);
        const href = text.slice(hrefStart, hrefEnd).trim();
        flushText();
        nodes.push(
          isSafeMarkdownHref(href) ? (
            <a key={`${keyPrefix}-link-${cursor}`} href={href} target="_blank" rel="noreferrer">
              {parseMarkdownInline(label, `${keyPrefix}-link-${cursor}`)}
            </a>
          ) : (
            <span key={`${keyPrefix}-link-${cursor}`}>{parseMarkdownInline(label, `${keyPrefix}-link-${cursor}`)}</span>
          ),
        );
        cursor = hrefEnd + 1;
        continue;
      }
    }

    textBuffer += text[cursor];
    cursor += 1;
  }

  flushText();
  return nodes;
};

const renderReleaseNotesHtmlInline = (node: ChildNode, keyPrefix: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, childIndex) =>
    renderReleaseNotesHtmlInline(child, `${keyPrefix}-${childIndex}`),
  );

  if (tagName === 'br') {
    return <br key={keyPrefix} />;
  }

  if (tagName === 'strong' || tagName === 'b') {
    return <strong key={keyPrefix}>{children}</strong>;
  }

  if (tagName === 'em' || tagName === 'i') {
    return <em key={keyPrefix}>{children}</em>;
  }

  if (tagName === 'code') {
    return <code key={keyPrefix}>{element.textContent ?? ''}</code>;
  }

  if (tagName === 'a') {
    const href = element.getAttribute('href') ?? '';
    if (!isSafeMarkdownHref(href)) {
      return <span key={keyPrefix}>{children}</span>;
    }
    return (
      <a key={keyPrefix} href={href} target="_blank" rel="noreferrer">
        {children.length ? children : href}
      </a>
    );
  }

  if (tagName === 'img') {
    const src = element.getAttribute('src') ?? '';
    if (!isSafeMarkdownHref(src)) {
      return null;
    }
    return <img key={keyPrefix} src={src} alt={element.getAttribute('alt') ?? ''} loading="lazy" />;
  }

  return <span key={keyPrefix}>{children}</span>;
};

const renderReleaseNotesHtmlBlock = (node: ChildNode, keyPrefix: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    return text ? <p key={keyPrefix}>{text}</p> : null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, childIndex) =>
    renderReleaseNotesHtmlInline(child, `${keyPrefix}-inline-${childIndex}`),
  );

  if (tagName === 'h1' || tagName === 'h2') {
    return <h3 key={keyPrefix}>{children}</h3>;
  }

  if (tagName === 'h3') {
    return <h4 key={keyPrefix}>{children}</h4>;
  }

  if (tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
    return <h5 key={keyPrefix}>{children}</h5>;
  }

  if (tagName === 'p') {
    return <p key={keyPrefix}>{children}</p>;
  }

  if (tagName === 'ul' || tagName === 'ol') {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, childIndex) => (
        <li key={`${keyPrefix}-item-${childIndex}`}>
          {Array.from(child.childNodes).map((grandChild, grandChildIndex) =>
            renderReleaseNotesHtmlInline(grandChild, `${keyPrefix}-item-${childIndex}-${grandChildIndex}`),
          )}
        </li>
      ));
    return tagName === 'ol' ? <ol key={keyPrefix}>{items}</ol> : <ul key={keyPrefix}>{items}</ul>;
  }

  if (tagName === 'blockquote') {
    return <blockquote key={keyPrefix}>{children}</blockquote>;
  }

  if (tagName === 'pre') {
    return (
      <pre key={keyPrefix}>
        <code>{element.textContent ?? ''}</code>
      </pre>
    );
  }

  if (tagName === 'hr') {
    return <hr key={keyPrefix} />;
  }

  if (tagName === 'img' || tagName === 'a') {
    return <p key={keyPrefix}>{renderReleaseNotesHtmlInline(element, `${keyPrefix}-inline`)}</p>;
  }

  return (
    <div key={keyPrefix}>
      {Array.from(element.childNodes).map((child, childIndex) => renderReleaseNotesHtmlBlock(child, `${keyPrefix}-${childIndex}`))}
    </div>
  );
};

const ReleaseNotesMarkdown = ({ markdown }: { markdown: string }): JSX.Element => {
  const rendered = useMemo(() => {
    if (looksLikeReleaseNotesHtml(markdown) && typeof DOMParser !== 'undefined') {
      const document = new DOMParser().parseFromString(markdown, 'text/html');
      const blocks = Array.from(document.body.childNodes)
        .map((child, childIndex) => renderReleaseNotesHtmlBlock(child, `html-${childIndex}`))
        .filter(Boolean);

      return { blocks, isHtml: true };
    }

  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  const pushParagraph = (paragraphLines: string[], key: string): void => {
    const paragraph = paragraphLines.join(' ').trim();
    if (paragraph) {
      blocks.push(<p key={key}>{parseMarkdownInline(paragraph, key)}</p>);
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      const blockKey = `code-${index}`;
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={blockKey}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/u.exec(trimmed);
    if (headingMatch) {
      const headingLevel = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const headingKey = `heading-${index}`;
      blocks.push(
        headingLevel === 1 ? (
          <h3 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h3>
        ) : headingLevel === 2 ? (
          <h4 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h4>
        ) : (
          <h5 key={headingKey}>{parseMarkdownInline(headingText, headingKey)}</h5>
        ),
      );
      index += 1;
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/u.exec(line);
    if (listMatch) {
      const ordered = /\d+\./u.test(listMatch[2]);
      const items: ReactNode[] = [];
      const listKey = `list-${index}`;
      while (index < lines.length) {
        const itemMatch = /^(\s*)([-*+]|\d+\.)\s+(.+)$/u.exec(lines[index]);
        if (!itemMatch || /\d+\./u.test(itemMatch[2]) !== ordered) {
          break;
        }
        items.push(<li key={`${listKey}-item-${index}`}>{parseMarkdownInline(itemMatch[3].trim(), `${listKey}-item-${index}`)}</li>);
        index += 1;
      }
      blocks.push(ordered ? <ol key={listKey}>{items}</ol> : <ul key={listKey}>{items}</ul>);
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      const quoteKey = `quote-${index}`;
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push(<blockquote key={quoteKey}>{parseMarkdownInline(quoteLines.join(' '), quoteKey)}</blockquote>);
      continue;
    }

    const paragraphLines = [line.trim()];
    const paragraphKey = `paragraph-${index}`;
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith('```') &&
      !/^(#{1,3})\s+(.+)$/u.test(lines[index].trim()) &&
      !/^(\s*)([-*+]|\d+\.)\s+(.+)$/u.test(lines[index]) &&
      !lines[index].trim().startsWith('>')
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    pushParagraph(paragraphLines, paragraphKey);
  }

    return { blocks, isHtml: false };
  }, [markdown]);

  return <div className={`settings-update-markdown${rendered.isHtml ? ' settings-update-markdown--html' : ''}`}>{rendered.blocks}</div>;
};

const formatRate = (value: number | null): string => {
  if (!value) {
    return 'n/a';
  }

  return `${value} Hz`;
};

const themeModeOptions: Array<{ mode: AppThemeMode; labelKey: TranslationKey }> = [
  { mode: 'light', labelKey: 'settings.appearance.theme.light' },
  { mode: 'dark', labelKey: 'settings.appearance.theme.dark' },
  { mode: 'system', labelKey: 'settings.appearance.theme.followSystem' },
];
const defaultThemeScheduleDarkAt = '19:00';
const defaultThemeScheduleLightAt = '07:00';

const themePresetOptions: Array<{
  preset: AppThemePreset;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  preview: string;
  swatches: string[];
}> = [
  {
    preset: 'classic',
    labelKey: 'settings.appearance.themePreset.classic',
    descriptionKey: 'settings.appearance.themePreset.classic.description',
    preview: 'linear-gradient(135deg, #ffffff 0%, #f6f6f7 52%, #e6e7ea 100%)',
    swatches: ['#f6f6f7', '#4b55e8', '#727987'],
  },
  {
    preset: 'echoTwilight',
    labelKey: 'settings.appearance.themePreset.echoTwilight',
    descriptionKey: 'settings.appearance.themePreset.echoTwilight.description',
    preview: 'linear-gradient(135deg, #fff4ef 0%, #f3d7cf 48%, #efe5f2 100%)',
    swatches: ['#fff4ef', '#df6b5f', '#8ccfc8'],
  },
  {
    preset: 'sakuraMilk',
    labelKey: 'settings.appearance.themePreset.sakuraMilk',
    descriptionKey: 'settings.appearance.themePreset.sakuraMilk.description',
    preview: 'linear-gradient(135deg, #fff6f9 0%, #f7d9e7 48%, #f0eefc 100%)',
    swatches: ['#fff6f9', '#cf5d7d', '#7fc8d6'],
  },
  {
    preset: 'peachSoda',
    labelKey: 'settings.appearance.themePreset.peachSoda',
    descriptionKey: 'settings.appearance.themePreset.peachSoda.description',
    preview: 'linear-gradient(135deg, #fff2e8 0%, #ffd6bd 44%, #d7f4ee 100%)',
    swatches: ['#fff2e8', '#d96d4c', '#5eb9ad'],
  },
  {
    preset: 'mintCandy',
    labelKey: 'settings.appearance.themePreset.mintCandy',
    descriptionKey: 'settings.appearance.themePreset.mintCandy.description',
    preview: 'linear-gradient(135deg, #f6fff8 0%, #d7f2df 46%, #ffe5ec 100%)',
    swatches: ['#f6fff8', '#3f9274', '#dd6e86'],
  },
  {
    preset: 'berryDream',
    labelKey: 'settings.appearance.themePreset.berryDream',
    descriptionKey: 'settings.appearance.themePreset.berryDream.description',
    preview: 'linear-gradient(135deg, #f8f5ff 0%, #e2d9fb 46%, #ffddec 100%)',
    swatches: ['#f8f5ff', '#7657b8', '#cf5f95'],
  },
  {
    preset: 'matchaCream',
    labelKey: 'settings.appearance.themePreset.matchaCream',
    descriptionKey: 'settings.appearance.themePreset.matchaCream.description',
    preview: 'linear-gradient(135deg, #fbfaeb 0%, #e1edc9 48%, #f6d9d7 100%)',
    swatches: ['#fbfaeb', '#6e8f49', '#c8757a'],
  },
  {
    preset: 'lemonMochi',
    labelKey: 'settings.appearance.themePreset.lemonMochi',
    descriptionKey: 'settings.appearance.themePreset.lemonMochi.description',
    preview: 'linear-gradient(135deg, #fffbe6 0%, #f6e7ad 48%, #eaf4fb 100%)',
    swatches: ['#fffbe6', '#c99a26', '#86bdd4'],
  },
  {
    preset: 'cottonCloud',
    labelKey: 'settings.appearance.themePreset.cottonCloud',
    descriptionKey: 'settings.appearance.themePreset.cottonCloud.description',
    preview: 'linear-gradient(135deg, #f8fbff 0%, #dfe9ff 48%, #ffe5f0 100%)',
    swatches: ['#f8fbff', '#6c88d8', '#dc6f9b'],
  },
  {
    preset: 'melonCream',
    labelKey: 'settings.appearance.themePreset.melonCream',
    descriptionKey: 'settings.appearance.themePreset.melonCream.description',
    preview: 'linear-gradient(135deg, #f8fff0 0%, #dff0c9 48%, #ffe2d8 100%)',
    swatches: ['#f8fff0', '#6ca344', '#db7b62'],
  },
  {
    preset: 'seaSaltJelly',
    labelKey: 'settings.appearance.themePreset.seaSaltJelly',
    descriptionKey: 'settings.appearance.themePreset.seaSaltJelly.description',
    preview: 'linear-gradient(135deg, #f1fffb 0%, #cfeeea 48%, #ffe3dd 100%)',
    swatches: ['#f1fffb', '#3c9a92', '#d66d5e'],
  },
  {
    preset: 'caramelPudding',
    labelKey: 'settings.appearance.themePreset.caramelPudding',
    descriptionKey: 'settings.appearance.themePreset.caramelPudding.description',
    preview: 'linear-gradient(135deg, #fff7e8 0%, #f5d29b 46%, #ffdce6 100%)',
    swatches: ['#fff7e8', '#b7772f', '#d56f86'],
  },
  {
    preset: 'neonCandy',
    labelKey: 'settings.appearance.themePreset.neonCandy',
    descriptionKey: 'settings.appearance.themePreset.neonCandy.description',
    preview: 'linear-gradient(135deg, #f6f7ff 0%, #e7dcff 45%, #d8fff7 100%)',
    swatches: ['#f6f7ff', '#8b5cf6', '#ff6fb1'],
  },
  {
    preset: 'nyanCat',
    labelKey: 'settings.appearance.themePreset.nyanCat',
    descriptionKey: 'settings.appearance.themePreset.nyanCat.description',
    preview: 'linear-gradient(135deg, #fff7fb 0%, #d7f3ff 24%, #ffe6a8 44%, #d9ffd8 64%, #eadcff 84%, #ffd7ee 100%)',
    swatches: ['#fff7fb', '#ff5f93', '#ffd84f', '#44c765', '#28b8f0'],
  },
  {
    preset: 'childrenDoodle',
    labelKey: 'settings.appearance.themePreset.childrenDoodle',
    descriptionKey: 'settings.appearance.themePreset.childrenDoodle.description',
    preview: 'linear-gradient(135deg, #fff4dc 0%, #ffd9ec 26%, #d6f7ff 50%, #ede0ff 73%, #fff1a8 100%)',
    swatches: ['#fff4dc', '#ff6fa8', '#566fda', '#66cdb7', '#f4c746'],
  },
  {
    preset: 'wisteriaBubble',
    labelKey: 'settings.appearance.themePreset.wisteriaBubble',
    descriptionKey: 'settings.appearance.themePreset.wisteriaBubble.description',
    preview: 'linear-gradient(135deg, #fbf7ff 0%, #e8d9ff 46%, #dcfff4 100%)',
    swatches: ['#fbf7ff', '#8f6ed5', '#67cdb3'],
  },
  {
    preset: 'strawberryCookie',
    labelKey: 'settings.appearance.themePreset.strawberryCookie',
    descriptionKey: 'settings.appearance.themePreset.strawberryCookie.description',
    preview: 'linear-gradient(135deg, #fff8f0 0%, #f7dcc6 46%, #ffe3ee 100%)',
    swatches: ['#fff8f0', '#d75a72', '#c5924f'],
  },
  {
    preset: 'graphiteAurora',
    labelKey: 'settings.appearance.themePreset.graphiteAurora',
    descriptionKey: 'settings.appearance.themePreset.graphiteAurora.description',
    preview: 'linear-gradient(135deg, #f5f7f8 0%, #dfe6e8 48%, #d8f3ec 100%)',
    swatches: ['#f5f7f8', '#2f7f73', '#496a9f'],
  },
  {
    preset: 'amberNoir',
    labelKey: 'settings.appearance.themePreset.amberNoir',
    descriptionKey: 'settings.appearance.themePreset.amberNoir.description',
    preview: 'linear-gradient(135deg, #fbf7ee 0%, #ead9bb 48%, #f3e7d4 100%)',
    swatches: ['#fbf7ee', '#9a6a24', '#37302b'],
  },
  {
    preset: 'oceanStudio',
    labelKey: 'settings.appearance.themePreset.oceanStudio',
    descriptionKey: 'settings.appearance.themePreset.oceanStudio.description',
    preview: 'linear-gradient(135deg, #f4f8fb 0%, #d8e8ef 48%, #dce3f2 100%)',
    swatches: ['#f4f8fb', '#2f7390', '#596b9a'],
  },
  {
    preset: 'rosewoodVinyl',
    labelKey: 'settings.appearance.themePreset.rosewoodVinyl',
    descriptionKey: 'settings.appearance.themePreset.rosewoodVinyl.description',
    preview: 'linear-gradient(135deg, #fbf3ee 0%, #ead3c7 48%, #f0dfe7 100%)',
    swatches: ['#fbf3ee', '#8f4d48', '#6d4f2c'],
  },
  {
    preset: 'darkSideMoon',
    labelKey: 'settings.appearance.themePreset.darkSideMoon',
    descriptionKey: 'settings.appearance.themePreset.darkSideMoon.description',
    preview: 'linear-gradient(135deg, #10111a 0%, #202638 42%, #f6f0d8 49%, #ed2f3b 55%, #f68e20 62%, #ffd84f 69%, #44c765 76%, #28b8f0 84%, #8d63c7 100%)',
    swatches: ['#10111a', '#f6f0d8', '#ed2f3b', '#ffd84f', '#28b8f0'],
  },
  {
    preset: 'shibuyaNight',
    labelKey: 'settings.appearance.themePreset.shibuyaNight',
    descriptionKey: 'settings.appearance.themePreset.shibuyaNight.description',
    preview: 'linear-gradient(135deg, #1b0d2b 0%, #3a185e 46%, #073449 100%)',
    swatches: ['#1b0d2b', '#ff3b9d', '#23d0ee'],
  },
  {
    preset: 'kyotoKurenai',
    labelKey: 'settings.appearance.themePreset.kyotoKurenai',
    descriptionKey: 'settings.appearance.themePreset.kyotoKurenai.description',
    preview: 'linear-gradient(135deg, #fff1df 0%, #e8b99b 48%, #f7d989 100%)',
    swatches: ['#fff1df', '#a92f26', '#c08a1e'],
  },
  {
    preset: 'ukiyoIndigo',
    labelKey: 'settings.appearance.themePreset.ukiyoIndigo',
    descriptionKey: 'settings.appearance.themePreset.ukiyoIndigo.description',
    preview: 'linear-gradient(135deg, #eaf1ed 0%, #9fbccb 48%, #d8c094 100%)',
    swatches: ['#eaf1ed', '#174f7f', '#b06d1f'],
  },
  {
    preset: 'fujiSnow',
    labelKey: 'settings.appearance.themePreset.fujiSnow',
    descriptionKey: 'settings.appearance.themePreset.fujiSnow.description',
    preview: 'linear-gradient(135deg, #edf8ff 0%, #badcff 48%, #f5d1e6 100%)',
    swatches: ['#edf8ff', '#246fc8', '#c74786'],
  },
  {
    preset: 'matsuriLantern',
    labelKey: 'settings.appearance.themePreset.matsuriLantern',
    descriptionKey: 'settings.appearance.themePreset.matsuriLantern.description',
    preview: 'linear-gradient(135deg, #fff0d8 0%, #efae67 48%, #ffd35f 100%)',
    swatches: ['#fff0d8', '#c23c28', '#d88409'],
  },
  {
    preset: 'ginzaNoir',
    labelKey: 'settings.appearance.themePreset.ginzaNoir',
    descriptionKey: 'settings.appearance.themePreset.ginzaNoir.description',
    preview: 'linear-gradient(135deg, #090a0d 0%, #111219 48%, #1b1712 100%)',
    swatches: ['#090a0d', '#d6b158', '#66a8d4'],
  },
  {
    preset: 'frostJazz',
    labelKey: 'settings.appearance.themePreset.frostJazz',
    descriptionKey: 'settings.appearance.themePreset.frostJazz.description',
    preview: 'linear-gradient(135deg, #eaf2fb 0%, #aac2df 48%, #d4c0dc 100%)',
    swatches: ['#eaf2fb', '#245f9e', '#7f3e70'],
  },
  {
    preset: 'FINAL',
    labelKey: 'settings.appearance.themePreset.FINAL',
    descriptionKey: 'settings.appearance.themePreset.FINAL.description',
    preview: 'repeating-linear-gradient(90deg, rgb(124 133 136 / 0.22) 0 1px, transparent 1px 22px), linear-gradient(135deg, #f4f5f4 0%, #dde0df 46%, #101214 47%, #30363a 100%)',
    swatches: ['#f4f5f4', '#30363a', '#7c8588', '#b08a56'],
  },
];

type PluginThemeOption = PluginThemePresetContribution & {
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  customThemeId: string;
};

const pluginThemeStableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 8);
};

const pluginThemeCustomId = (pluginId: string, themeId: string): string => {
  const readableThemeId = themeId.replace(/[^a-zA-Z0-9_.:-]/g, '-').slice(0, 40) || 'theme';
  return `plugin:${pluginThemeStableHash(`${pluginId}:${themeId}`)}:${readableThemeId}`;
};

const collectPluginThemeOptions = (plugins: PluginSummary[]): PluginThemeOption[] =>
  plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.disabledByHost || plugin.error) {
      return [];
    }

    return (plugin.contributes.themePresets ?? []).map((theme) => ({
      ...theme,
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      customThemeId: pluginThemeCustomId(plugin.id, theme.id),
    }));
  });

type ThemeTone = 'light' | 'dark';
type ThemeColorField = keyof Pick<
  AppThemeToneOverride,
  | 'appBg'
  | 'appBg2'
  | 'appBg3'
  | 'panel'
  | 'panelSoft'
  | 'accent'
  | 'accentStrong'
  | 'secondary'
  | 'heading'
  | 'text'
  | 'muted'
  | 'border'
  | 'onAccent'
  | 'buttonText'
  | 'titlebar'
  | 'sidebar'
  | 'player'
  | 'field'
  | 'row'
  | 'rowHover'
  | 'rowActive'
  | 'chip'
  | 'focus'
  | 'danger'
  | 'success'
  | 'warning'
>;
type ThemeNumberField = keyof Pick<
  AppThemeToneOverride,
  'panelOpacityPercent' | 'glassPercent' | 'shadowPercent' | 'cornerRadiusPx' | 'panelBlurPx' | 'saturationPercent' | 'motionSpeedSeconds' | 'motionIntensityPercent'
>;
type ThemeBooleanField = keyof Pick<AppThemeToneOverride, 'motionEnabled'>;
type ThemeEditorDefaults = Required<Pick<AppThemeToneOverride, ThemeColorField | ThemeNumberField | ThemeBooleanField>>;
type ThemeLegacyExportPayload = {
  exportedAt: string;
  overrides: AppThemePresetOverrides;
  preset: AppThemePreset;
  schema: 'echo-next.theme-preset';
  version: 1;
};
type ThemeCustomExportPayload = {
  exportedAt: string;
  schema: 'echo-next.custom-theme';
  theme: AppThemeCustomTheme;
  version: 2;
};
type ThemeExportPayload = ThemeLegacyExportPayload | ThemeCustomExportPayload;

const baseThemeEditorDefaults: Record<ThemeTone, ThemeEditorDefaults> = {
  light: {
    appBg: '#f6f6f7',
    appBg2: '#edeef0',
    appBg3: '#e6e7ea',
    panel: '#ffffff',
    panelSoft: '#eff0f2',
    accent: '#4b55e8',
    accentStrong: '#3239c7',
    secondary: '#727987',
    heading: '#1e2025',
    text: '#2d3036',
    muted: '#6c7179',
    border: '#26282e',
    onAccent: '#ffffff',
    buttonText: '#3c4048',
    titlebar: '#ffffff',
    sidebar: '#eff0f2',
    player: '#fafafb',
    field: '#ffffff',
    row: '#ffffff',
    rowHover: '#f8f8f9',
    rowActive: '#eceeff',
    chip: '#ffffff',
    focus: '#4b55e8',
    danger: '#d64545',
    success: '#2f8f72',
    warning: '#c98a16',
    panelOpacityPercent: 72,
    glassPercent: 18,
    shadowPercent: 100,
    cornerRadiusPx: 14,
    panelBlurPx: 15,
    saturationPercent: 100,
    motionEnabled: true,
    motionSpeedSeconds: 0.22,
    motionIntensityPercent: 100,
  },
  dark: {
    appBg: '#101318',
    appBg2: '#151a22',
    appBg3: '#111827',
    panel: '#1c222b',
    panelSoft: '#161b23',
    accent: '#75b7ff',
    accentStrong: '#cce6ff',
    secondary: '#7dd7cb',
    heading: '#f8fbff',
    text: '#d8e0ea',
    muted: '#a8b5c4',
    border: '#647c96',
    onAccent: '#0f1720',
    buttonText: '#d8e0ea',
    titlebar: '#1c222b',
    sidebar: '#161b23',
    player: '#1c222b',
    field: '#1c222b',
    row: '#1c222b',
    rowHover: '#253040',
    rowActive: '#75b7ff',
    chip: '#1c222b',
    focus: '#75b7ff',
    danger: '#ff7575',
    success: '#7dd7a4',
    warning: '#f0b84a',
    panelOpacityPercent: 86,
    glassPercent: 22,
    shadowPercent: 100,
    cornerRadiusPx: 14,
    panelBlurPx: 16,
    saturationPercent: 100,
    motionEnabled: true,
    motionSpeedSeconds: 0.22,
    motionIntensityPercent: 100,
  },
};

const themeEditorDefaults: Record<AppThemePreset, Record<ThemeTone, Partial<ThemeEditorDefaults>>> = {
  classic: {
    light: {
      appBg: '#f6f6f7',
      appBg2: '#edeef0',
      appBg3: '#e6e7ea',
      panel: '#ffffff',
      panelSoft: '#eff0f2',
      accent: '#4b55e8',
      accentStrong: '#3239c7',
      secondary: '#727987',
      heading: '#1e2025',
      text: '#2d3036',
      muted: '#6c7179',
      border: '#26282e',
      onAccent: '#ffffff',
      buttonText: '#344540',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101318',
      appBg2: '#151a22',
      appBg3: '#111827',
      panel: '#1c222b',
      panelSoft: '#161b23',
      accent: '#75b7ff',
      accentStrong: '#cce6ff',
      secondary: '#7dd7cb',
      heading: '#f8fbff',
      text: '#d8e0ea',
      muted: '#a8b5c4',
      border: '#647c96',
      onAccent: '#0f1720',
      buttonText: '#d8e0ea',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  echoTwilight: {
    light: {
      appBg: '#fff4ef',
      appBg2: '#f3d7cf',
      appBg3: '#efe5f2',
      panel: '#fffcf9',
      panelSoft: '#fbe9e4',
      accent: '#df6b5f',
      accentStrong: '#a83e37',
      secondary: '#8ccfc8',
      heading: '#352321',
      text: '#4f3833',
      muted: '#765d57',
      border: '#b87065',
      onAccent: '#ffffff',
      buttonText: '#4f3833',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#151012',
      appBg2: '#211719',
      appBg3: '#171320',
      panel: '#271e21',
      panelSoft: '#1f181b',
      accent: '#e2776d',
      accentStrong: '#ffd0ca',
      secondary: '#8fd4ce',
      heading: '#fff7f4',
      text: '#f3e3de',
      muted: '#d2b9b2',
      border: '#df8479',
      onAccent: '#2b1513',
      buttonText: '#f3e3de',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  sakuraMilk: {
    light: {
      appBg: '#fff6f9',
      appBg2: '#f7d9e7',
      appBg3: '#f0eefc',
      panel: '#fffdfe',
      panelSoft: '#fce8f0',
      accent: '#cf5d7d',
      accentStrong: '#9a3157',
      secondary: '#7fc8d6',
      heading: '#361f29',
      text: '#55333f',
      muted: '#765b66',
      border: '#b05d7c',
      onAccent: '#ffffff',
      buttonText: '#55333f',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#151015',
      appBg2: '#231722',
      appBg3: '#171627',
      panel: '#271e26',
      panelSoft: '#201820',
      accent: '#e17599',
      accentStrong: '#ffd0df',
      secondary: '#8acdda',
      heading: '#fff6fb',
      text: '#f4e2ea',
      muted: '#d4b7c3',
      border: '#da7797',
      onAccent: '#2c131d',
      buttonText: '#f4e2ea',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  peachSoda: {
    light: {
      appBg: '#fff2e8',
      appBg2: '#ffd6bd',
      appBg3: '#d7f4ee',
      panel: '#fffdf9',
      panelSoft: '#faeadc',
      accent: '#d96d4c',
      accentStrong: '#9c3e26',
      secondary: '#5eb9ad',
      heading: '#33231d',
      text: '#50392f',
      muted: '#745d54',
      border: '#b3684c',
      onAccent: '#ffffff',
      buttonText: '#50392f',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#15110f',
      appBg2: '#241915',
      appBg3: '#10201f',
      panel: '#271f1b',
      panelSoft: '#201916',
      accent: '#e27b58',
      accentStrong: '#ffd2c1',
      secondary: '#78c9be',
      heading: '#fff5ef',
      text: '#f4e3d8',
      muted: '#d2b8ac',
      border: '#da7e56',
      onAccent: '#2c1710',
      buttonText: '#f4e3d8',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  mintCandy: {
    light: {
      appBg: '#f6fff8',
      appBg2: '#d7f2df',
      appBg3: '#ffe5ec',
      panel: '#fdfffa',
      panelSoft: '#e6f5e6',
      accent: '#3f9274',
      accentStrong: '#27664f',
      secondary: '#dd6e86',
      heading: '#1f3029',
      text: '#33493e',
      muted: '#556f63',
      border: '#5c896f',
      onAccent: '#ffffff',
      buttonText: '#33493e',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101512',
      appBg2: '#17231c',
      appBg3: '#23151b',
      panel: '#1d2721',
      panelSoft: '#17201b',
      accent: '#6bc09b',
      accentStrong: '#c3f5df',
      secondary: '#e28aa0',
      heading: '#f5fff8',
      text: '#e0f0e7',
      muted: '#b7d0c3',
      border: '#61b991',
      onAccent: '#10261c',
      buttonText: '#e0f0e7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  berryDream: {
    light: {
      appBg: '#f8f5ff',
      appBg2: '#e2d9fb',
      appBg3: '#ffddec',
      panel: '#fffdff',
      panelSoft: '#efe8fa',
      accent: '#7657b8',
      accentStrong: '#563995',
      secondary: '#cf5f95',
      heading: '#2d2440',
      text: '#45395b',
      muted: '#655878',
      border: '#725ba6',
      onAccent: '#ffffff',
      buttonText: '#45395b',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#11101a',
      appBg2: '#1b1730',
      appBg3: '#241421',
      panel: '#201d2e',
      panelSoft: '#1a1726',
      accent: '#9a79dd',
      accentStrong: '#ddd0ff',
      secondary: '#e48ab5',
      heading: '#fbf8ff',
      text: '#e9e4f7',
      muted: '#c4badd',
      border: '#9277d4',
      onAccent: '#1d1233',
      buttonText: '#e9e4f7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  matchaCream: {
    light: {
      appBg: '#fbfaeb',
      appBg2: '#e1edc9',
      appBg3: '#f6d9d7',
      panel: '#fffef6',
      panelSoft: '#ecefd4',
      accent: '#6e8f49',
      accentStrong: '#4d6b2f',
      secondary: '#c8757a',
      heading: '#2b301d',
      text: '#42452d',
      muted: '#62664a',
      border: '#7c8e4f',
      onAccent: '#ffffff',
      buttonText: '#42452d',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#12140e',
      appBg2: '#1d2215',
      appBg3: '#241716',
      panel: '#22261c',
      panelSoft: '#1c2017',
      accent: '#95b766',
      accentStrong: '#e5f5bd',
      secondary: '#dd8d91',
      heading: '#fbffe9',
      text: '#e8eddb',
      muted: '#c6d0ad',
      border: '#8ba658',
      onAccent: '#1d250f',
      buttonText: '#e8eddb',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  lemonMochi: {
    light: {
      appBg: '#fffbe6',
      appBg2: '#f6e7ad',
      appBg3: '#eaf4fb',
      panel: '#fffef5',
      panelSoft: '#f7eecb',
      accent: '#c99a26',
      accentStrong: '#8a6113',
      secondary: '#86bdd4',
      heading: '#332a10',
      text: '#4c3f1c',
      muted: '#706133',
      border: '#b28d37',
      onAccent: '#241800',
      buttonText: '#4c3f1c',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#15140f',
      appBg2: '#221f13',
      appBg3: '#111b23',
      panel: '#262319',
      panelSoft: '#201d15',
      accent: '#d5aa3a',
      accentStrong: '#ffe59a',
      secondary: '#8bc8df',
      heading: '#fff9df',
      text: '#f5eed2',
      muted: '#d5c99a',
      border: '#cfa93f',
      onAccent: '#2a1d05',
      buttonText: '#f5eed2',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  cottonCloud: {
    light: {
      appBg: '#f8fbff',
      appBg2: '#dfe9ff',
      appBg3: '#ffe5f0',
      panel: '#fdfeff',
      panelSoft: '#e7eefd',
      accent: '#6c88d8',
      accentStrong: '#3f5fb5',
      secondary: '#dc6f9b',
      heading: '#20283c',
      text: '#3a435c',
      muted: '#5c6680',
      border: '#6980bc',
      onAccent: '#ffffff',
      buttonText: '#3a435c',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10131d',
      appBg2: '#171d31',
      appBg3: '#241521',
      panel: '#1d2231',
      panelSoft: '#171c2a',
      accent: '#8ba5f0',
      accentStrong: '#dae3ff',
      secondary: '#e58db3',
      heading: '#fbfdff',
      text: '#e8eefc',
      muted: '#c2cce8',
      border: '#7e96e4',
      onAccent: '#11192c',
      buttonText: '#e8eefc',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  melonCream: {
    light: {
      appBg: '#f8fff0',
      appBg2: '#dff0c9',
      appBg3: '#ffe2d8',
      panel: '#fdfff8',
      panelSoft: '#e7f1d8',
      accent: '#6ca344',
      accentStrong: '#47752a',
      secondary: '#db7b62',
      heading: '#213218',
      text: '#354827',
      muted: '#596f45',
      border: '#6d9348',
      onAccent: '#ffffff',
      buttonText: '#354827',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10160f',
      appBg2: '#172415',
      appBg3: '#251814',
      panel: '#1d281c',
      panelSoft: '#172116',
      accent: '#8cc76a',
      accentStrong: '#d8f6bf',
      secondary: '#e18d78',
      heading: '#f8ffe9',
      text: '#e8f3dc',
      muted: '#c3d8ad',
      border: '#7bb852',
      onAccent: '#14270e',
      buttonText: '#e8f3dc',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  seaSaltJelly: {
    light: {
      appBg: '#f1fffb',
      appBg2: '#cfeeea',
      appBg3: '#ffe3dd',
      panel: '#fafffd',
      panelSoft: '#dbf1ee',
      accent: '#3c9a92',
      accentStrong: '#226f68',
      secondary: '#d66d5e',
      heading: '#183633',
      text: '#2b4d49',
      muted: '#4f716d',
      border: '#48948d',
      onAccent: '#ffffff',
      buttonText: '#2b4d49',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#0f1718',
      appBg2: '#152525',
      appBg3: '#241714',
      panel: '#1a292a',
      panelSoft: '#152223',
      accent: '#67c9c0',
      accentStrong: '#c2f5ef',
      secondary: '#e28b7d',
      heading: '#f2fffc',
      text: '#dcf1ee',
      muted: '#b1d8d2',
      border: '#50bdb5',
      onAccent: '#0d2826',
      buttonText: '#dcf1ee',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  caramelPudding: {
    light: {
      appBg: '#fff7e8',
      appBg2: '#f5d29b',
      appBg3: '#ffdce6',
      panel: '#fffaf0',
      panelSoft: '#f4dfb8',
      accent: '#b7772f',
      accentStrong: '#7f4b18',
      secondary: '#d56f86',
      heading: '#3a2511',
      text: '#5a3a20',
      muted: '#7a5940',
      border: '#b98245',
      onAccent: '#ffffff',
      buttonText: '#5a3a20',
      panelOpacityPercent: 74,
      glassPercent: 16,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#18110b',
      appBg2: '#2a1b10',
      appBg3: '#2a1019',
      panel: '#2b1c12',
      panelSoft: '#21160f',
      accent: '#e0a45c',
      accentStrong: '#ffd79a',
      secondary: '#f18aa7',
      heading: '#fff3db',
      text: '#f1d8b7',
      muted: '#d5b58a',
      border: '#d68f45',
      onAccent: '#29170a',
      buttonText: '#f1d8b7',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  neonCandy: {
    light: {
      appBg: '#f6f7ff',
      appBg2: '#e7dcff',
      appBg3: '#d8fff7',
      panel: '#ffffff',
      panelSoft: '#efe9ff',
      accent: '#8b5cf6',
      accentStrong: '#5b39b4',
      secondary: '#ff6fb1',
      heading: '#241a3f',
      text: '#46385f',
      muted: '#6a5a82',
      border: '#9275e8',
      onAccent: '#ffffff',
      buttonText: '#46385f',
      panelOpacityPercent: 72,
      glassPercent: 20,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#101021',
      appBg2: '#1b1640',
      appBg3: '#102b2b',
      panel: '#1f1b39',
      panelSoft: '#16162b',
      accent: '#a989ff',
      accentStrong: '#e1d7ff',
      secondary: '#ff84be',
      heading: '#f7f2ff',
      text: '#e7dcff',
      muted: '#c4b5e8',
      border: '#9b7cff',
      onAccent: '#181033',
      buttonText: '#e7dcff',
      panelOpacityPercent: 86,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  nyanCat: {
    light: {
      appBg: '#fff7fb',
      appBg2: '#d7f3ff',
      appBg3: '#eadcff',
      panel: '#ffffff',
      panelSoft: '#eef8ff',
      accent: '#ff5f93',
      accentStrong: '#cf3f75',
      secondary: '#28b8f0',
      heading: '#2b2f5f',
      text: '#475072',
      muted: '#697392',
      border: '#7aa7d9',
      onAccent: '#ffffff',
      buttonText: '#475072',
      panelOpacityPercent: 76,
      glassPercent: 24,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#11132d',
      appBg2: '#172959',
      appBg3: '#35164b',
      panel: '#1d2348',
      panelSoft: '#161a38',
      accent: '#ff7fb0',
      accentStrong: '#ffd1e5',
      secondary: '#59d9ff',
      heading: '#fff6fb',
      text: '#eaf1ff',
      muted: '#bfc9ee',
      border: '#7aa7ff',
      onAccent: '#2b0f24',
      buttonText: '#eaf1ff',
      panelOpacityPercent: 88,
      glassPercent: 28,
      shadowPercent: 100,
    },
  },
  childrenDoodle: {
    light: {
      appBg: '#fff4dc',
      appBg2: '#ffd9ec',
      appBg3: '#d6f7ff',
      panel: '#fffaf0',
      panelSoft: '#f9e7d0',
      accent: '#566fda',
      accentStrong: '#244caa',
      secondary: '#ff6fa8',
      heading: '#203f83',
      text: '#42537a',
      muted: '#6f7897',
      border: '#5f82c6',
      onAccent: '#ffffff',
      buttonText: '#42537a',
      panelOpacityPercent: 82,
      glassPercent: 10,
      shadowPercent: 56,
      cornerRadiusPx: 8,
      panelBlurPx: 4,
      saturationPercent: 112,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 78,
    },
    dark: {
      appBg: '#17142a',
      appBg2: '#241f42',
      appBg3: '#12313a',
      panel: '#292540',
      panelSoft: '#1f1b34',
      accent: '#ff8dbc',
      accentStrong: '#ffd2e4',
      secondary: '#7be5d1',
      heading: '#fff4fb',
      text: '#eee5ff',
      muted: '#cbbfe6',
      border: '#a68cf1',
      onAccent: '#321020',
      buttonText: '#eee5ff',
      panelOpacityPercent: 88,
      glassPercent: 14,
      shadowPercent: 72,
      cornerRadiusPx: 8,
      panelBlurPx: 6,
      saturationPercent: 118,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 78,
    },
  },
  wisteriaBubble: {
    light: {
      appBg: '#fbf7ff',
      appBg2: '#e8d9ff',
      appBg3: '#dcfff4',
      panel: '#fffaff',
      panelSoft: '#eee2ff',
      accent: '#8f6ed5',
      accentStrong: '#6043a6',
      secondary: '#67cdb3',
      heading: '#2c2144',
      text: '#4c3c68',
      muted: '#6f5f8c',
      border: '#9c82df',
      onAccent: '#ffffff',
      buttonText: '#4c3c68',
      panelOpacityPercent: 72,
      glassPercent: 18,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#13101d',
      appBg2: '#211a36',
      appBg3: '#10251f',
      panel: '#211a32',
      panelSoft: '#171423',
      accent: '#b99cff',
      accentStrong: '#eee6ff',
      secondary: '#7be0c5',
      heading: '#fbf7ff',
      text: '#e7dcfb',
      muted: '#c9b9e8',
      border: '#a88aff',
      onAccent: '#1c1230',
      buttonText: '#e7dcfb',
      panelOpacityPercent: 86,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  strawberryCookie: {
    light: {
      appBg: '#fff8f0',
      appBg2: '#f7dcc6',
      appBg3: '#ffe3ee',
      panel: '#fffaf4',
      panelSoft: '#f4dfcf',
      accent: '#d75a72',
      accentStrong: '#9f3449',
      secondary: '#c5924f',
      heading: '#3b211c',
      text: '#5b3a32',
      muted: '#7c5d52',
      border: '#c9798a',
      onAccent: '#ffffff',
      buttonText: '#5b3a32',
      panelOpacityPercent: 74,
      glassPercent: 16,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#19100f',
      appBg2: '#2a1915',
      appBg3: '#291018',
      panel: '#2b1b18',
      panelSoft: '#211412',
      accent: '#f08aa0',
      accentStrong: '#ffd0da',
      secondary: '#e0b66c',
      heading: '#fff0e8',
      text: '#f1d2c9',
      muted: '#d9b2a4',
      border: '#e18196',
      onAccent: '#321017',
      buttonText: '#f1d2c9',
      panelOpacityPercent: 86,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  graphiteAurora: {
    light: {
      appBg: '#f5f7f8',
      appBg2: '#dfe6e8',
      appBg3: '#d8f3ec',
      panel: '#fbfcfc',
      panelSoft: '#e8eef0',
      accent: '#2f7f73',
      accentStrong: '#1f5d55',
      secondary: '#496a9f',
      heading: '#1f292b',
      text: '#3f5053',
      muted: '#637174',
      border: '#7a9698',
      onAccent: '#ffffff',
      buttonText: '#3f5053',
      panelOpacityPercent: 76,
      glassPercent: 18,
      shadowPercent: 80,
    },
    dark: {
      appBg: '#101416',
      appBg2: '#182123',
      appBg3: '#10241f',
      panel: '#20292b',
      panelSoft: '#171f21',
      accent: '#5ec4b5',
      accentStrong: '#b2efe6',
      secondary: '#86a8e7',
      heading: '#edf6f5',
      text: '#d4e3e1',
      muted: '#a8bcba',
      border: '#5fb4aa',
      onAccent: '#0b2824',
      buttonText: '#d4e3e1',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  amberNoir: {
    light: {
      appBg: '#fbf7ee',
      appBg2: '#ead9bb',
      appBg3: '#f3e7d4',
      panel: '#fffaf1',
      panelSoft: '#efe1c9',
      accent: '#9a6a24',
      accentStrong: '#624015',
      secondary: '#6a4b3a',
      heading: '#33291e',
      text: '#584737',
      muted: '#7a6a59',
      border: '#b99662',
      onAccent: '#ffffff',
      buttonText: '#584737',
      panelOpacityPercent: 76,
      glassPercent: 14,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#11100e',
      appBg2: '#211a12',
      appBg3: '#2a2118',
      panel: '#2a241c',
      panelSoft: '#1d1914',
      accent: '#d4a64c',
      accentStrong: '#f5d78f',
      secondary: '#b88763',
      heading: '#fff3d8',
      text: '#ead9bd',
      muted: '#c3ad8d',
      border: '#c89a4b',
      onAccent: '#221405',
      buttonText: '#ead9bd',
      panelOpacityPercent: 88,
      glassPercent: 20,
      shadowPercent: 100,
    },
  },
  oceanStudio: {
    light: {
      appBg: '#f4f8fb',
      appBg2: '#d8e8ef',
      appBg3: '#dce3f2',
      panel: '#fbfdff',
      panelSoft: '#e5eef4',
      accent: '#2f7390',
      accentStrong: '#1d526a',
      secondary: '#596b9a',
      heading: '#202d3a',
      text: '#415363',
      muted: '#607486',
      border: '#7da3b7',
      onAccent: '#ffffff',
      buttonText: '#415363',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 80,
    },
    dark: {
      appBg: '#0f151b',
      appBg2: '#132332',
      appBg3: '#17203a',
      panel: '#1e2a34',
      panelSoft: '#16212b',
      accent: '#68b4d4',
      accentStrong: '#c2eaff',
      secondary: '#9aa7e8',
      heading: '#edf7ff',
      text: '#d4e5ef',
      muted: '#a9bfce',
      border: '#6cb1cf',
      onAccent: '#0c2531',
      buttonText: '#d4e5ef',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  rosewoodVinyl: {
    light: {
      appBg: '#fbf3ee',
      appBg2: '#ead3c7',
      appBg3: '#f0dfe7',
      panel: '#fff8f4',
      panelSoft: '#efdcd3',
      accent: '#8f4d48',
      accentStrong: '#66312d',
      secondary: '#8b6a3e',
      heading: '#35211f',
      text: '#5c4240',
      muted: '#7e6662',
      border: '#b27a73',
      onAccent: '#ffffff',
      buttonText: '#5c4240',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#140f10',
      appBg2: '#251717',
      appBg3: '#201821',
      panel: '#2a1d1d',
      panelSoft: '#1e1516',
      accent: '#d4827b',
      accentStrong: '#f3b8ae',
      secondary: '#d2a45c',
      heading: '#fff0eb',
      text: '#ebd1cb',
      muted: '#c7aaa3',
      border: '#d18279',
      onAccent: '#2f1210',
      buttonText: '#ebd1cb',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  darkSideMoon: {
    light: {
      appBg: '#171722',
      appBg2: '#202638',
      appBg3: '#151827',
      panel: '#232635',
      panelSoft: '#181b28',
      accent: '#f6f0d8',
      accentStrong: '#8fdcff',
      secondary: '#ffd84f',
      heading: '#fff7df',
      text: '#eef2fb',
      muted: '#cad4e7',
      border: '#c5d2e8',
      onAccent: '#121521',
      buttonText: '#eef2fb',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#10111a',
      appBg2: '#181d2b',
      appBg3: '#202337',
      panel: '#1e212f',
      panelSoft: '#131622',
      accent: '#f7f1dc',
      accentStrong: '#93dcff',
      secondary: '#28b8f0',
      heading: '#fff8df',
      text: '#eef3ff',
      muted: '#cbd7ec',
      border: '#cddaf0',
      onAccent: '#10131d',
      buttonText: '#eef3ff',
      panelOpacityPercent: 92,
      glassPercent: 28,
      shadowPercent: 100,
    },
  },
  shibuyaNight: {
    light: {
      appBg: '#1b0d2b',
      appBg2: '#3a185e',
      appBg3: '#073449',
      panel: '#2a1f3a',
      panelSoft: '#1d142d',
      accent: '#ff3b9d',
      accentStrong: '#ffd4ee',
      secondary: '#23d0ee',
      heading: '#fff6ff',
      text: '#f1e8ff',
      muted: '#cdbde8',
      border: '#da3796',
      onAccent: '#26001a',
      buttonText: '#f1e8ff',
      panelOpacityPercent: 90,
      glassPercent: 30,
      shadowPercent: 100,
    },
    dark: {
      appBg: '#070411',
      appBg2: '#120824',
      appBg3: '#061a24',
      panel: '#170f26',
      panelSoft: '#10091c',
      accent: '#ff2f98',
      accentStrong: '#ffd3ed',
      secondary: '#18d5f4',
      heading: '#fff4ff',
      text: '#f0e5ff',
      muted: '#c7b5e4',
      border: '#f03aa4',
      onAccent: '#240018',
      buttonText: '#f0e5ff',
      panelOpacityPercent: 92,
      glassPercent: 30,
      shadowPercent: 100,
    },
  },
  kyotoKurenai: {
    light: {
      appBg: '#fff1df',
      appBg2: '#e8b99b',
      appBg3: '#f7d989',
      panel: '#fff8ed',
      panelSoft: '#f0d5b7',
      accent: '#a92f26',
      accentStrong: '#6e1d17',
      secondary: '#c08a1e',
      heading: '#30170f',
      text: '#543124',
      muted: '#755040',
      border: '#a64d36',
      onAccent: '#ffffff',
      buttonText: '#543124',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 90,
    },
    dark: {
      appBg: '#120807',
      appBg2: '#27100d',
      appBg3: '#241806',
      panel: '#2a1914',
      panelSoft: '#1d100d',
      accent: '#ff5f4a',
      accentStrong: '#ffd2c4',
      secondary: '#e3b23c',
      heading: '#fff4e8',
      text: '#f4d8c6',
      muted: '#d5b39b',
      border: '#e6644f',
      onAccent: '#310b06',
      buttonText: '#f4d8c6',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  ukiyoIndigo: {
    light: {
      appBg: '#eaf1ed',
      appBg2: '#9fbccb',
      appBg3: '#d8c094',
      panel: '#fbfbf3',
      panelSoft: '#d6e1df',
      accent: '#174f7f',
      accentStrong: '#0d3659',
      secondary: '#b06d1f',
      heading: '#10283a',
      text: '#314655',
      muted: '#536b78',
      border: '#4f7893',
      onAccent: '#ffffff',
      buttonText: '#314655',
      panelOpacityPercent: 78,
      glassPercent: 18,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#07101a',
      appBg2: '#0a2540',
      appBg3: '#211d15',
      panel: '#172b40',
      panelSoft: '#0d1d2e',
      accent: '#4aa6dd',
      accentStrong: '#c5e7ff',
      secondary: '#d59b43',
      heading: '#edf8ff',
      text: '#d8e8f4',
      muted: '#abc1d1',
      border: '#5eb3e2',
      onAccent: '#041b2f',
      buttonText: '#d8e8f4',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  fujiSnow: {
    light: {
      appBg: '#edf8ff',
      appBg2: '#badcff',
      appBg3: '#f5d1e6',
      panel: '#fbfdff',
      panelSoft: '#d8ecff',
      accent: '#246fc8',
      accentStrong: '#174b90',
      secondary: '#c74786',
      heading: '#12233d',
      text: '#344860',
      muted: '#536983',
      border: '#5b89d0',
      onAccent: '#ffffff',
      buttonText: '#344860',
      panelOpacityPercent: 76,
      glassPercent: 20,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#08111f',
      appBg2: '#10244a',
      appBg3: '#2a1430',
      panel: '#182438',
      panelSoft: '#0f192b',
      accent: '#6b9beb',
      accentStrong: '#d7e7ff',
      secondary: '#f07db7',
      heading: '#f8fbff',
      text: '#e2ecff',
      muted: '#b7c9e6',
      border: '#6b9beb',
      onAccent: '#071936',
      buttonText: '#e2ecff',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  matsuriLantern: {
    light: {
      appBg: '#fff0d8',
      appBg2: '#efae67',
      appBg3: '#ffd35f',
      panel: '#fff7e9',
      panelSoft: '#f2d4a7',
      accent: '#c23c28',
      accentStrong: '#842116',
      secondary: '#d88409',
      heading: '#35180d',
      text: '#553323',
      muted: '#77513d',
      border: '#b75a2f',
      onAccent: '#ffffff',
      buttonText: '#553323',
      panelOpacityPercent: 76,
      glassPercent: 16,
      shadowPercent: 94,
    },
    dark: {
      appBg: '#120706',
      appBg2: '#2d100b',
      appBg3: '#2a1a05',
      panel: '#311c15',
      panelSoft: '#21100c',
      accent: '#ff5a3c',
      accentStrong: '#ffd0bf',
      secondary: '#ffb72e',
      heading: '#fff1e2',
      text: '#f5d5c2',
      muted: '#d8ad91',
      border: '#f67c48',
      onAccent: '#340c05',
      buttonText: '#f5d5c2',
      panelOpacityPercent: 88,
      glassPercent: 22,
      shadowPercent: 100,
    },
  },
  ginzaNoir: {
    light: {
      appBg: '#ebe5da',
      appBg2: '#c7bca8',
      appBg3: '#c2cbd5',
      panel: '#faf7ef',
      panelSoft: '#e0d8c7',
      accent: '#72530e',
      accentStrong: '#4a3507',
      secondary: '#2f668e',
      heading: '#1c1c1d',
      text: '#413b33',
      muted: '#665d50',
      border: '#8a7650',
      onAccent: '#ffffff',
      buttonText: '#413b33',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 86,
    },
    dark: {
      appBg: '#090a0d',
      appBg2: '#111219',
      appBg3: '#1b1712',
      panel: '#1d1d24',
      panelSoft: '#111218',
      accent: '#d6b158',
      accentStrong: '#ffe1a0',
      secondary: '#66a8d4',
      heading: '#fff5e5',
      text: '#e8dfce',
      muted: '#c2b5a1',
      border: '#d6b158',
      onAccent: '#1f1604',
      buttonText: '#e8dfce',
      panelOpacityPercent: 92,
      glassPercent: 30,
      shadowPercent: 100,
    },
  },
  frostJazz: {
    light: {
      appBg: '#eaf2fb',
      appBg2: '#aac2df',
      appBg3: '#d4c0dc',
      panel: '#fbfdff',
      panelSoft: '#d9e5f2',
      accent: '#245f9e',
      accentStrong: '#163f70',
      secondary: '#7f3e70',
      heading: '#142234',
      text: '#34495f',
      muted: '#546a80',
      border: '#5c7da9',
      onAccent: '#ffffff',
      buttonText: '#34495f',
      panelOpacityPercent: 78,
      glassPercent: 20,
      shadowPercent: 82,
    },
    dark: {
      appBg: '#080d15',
      appBg2: '#101b2c',
      appBg3: '#201426',
      panel: '#182434',
      panelSoft: '#0e1724',
      accent: '#5c8fd3',
      accentStrong: '#d1e4ff',
      secondary: '#c06a9e',
      heading: '#f5f9ff',
      text: '#deebfb',
      muted: '#b1c4dc',
      border: '#5c8fd3',
      onAccent: '#07182d',
      buttonText: '#deebfb',
      panelOpacityPercent: 88,
      glassPercent: 24,
      shadowPercent: 100,
    },
  },
  FINAL: {
    light: {
      appBg: '#f4f5f4',
      appBg2: '#dde0df',
      appBg3: '#fbfbf8',
      panel: '#fcfcf9',
      panelSoft: '#e8eae8',
      accent: '#30363a',
      accentStrong: '#121416',
      secondary: '#7c8588',
      heading: '#101214',
      text: '#333638',
      muted: '#62686a',
      border: '#81898b',
      onAccent: '#f8f8f3',
      buttonText: '#333638',
      panelOpacityPercent: 82,
      glassPercent: 12,
      shadowPercent: 62,
      cornerRadiusPx: 8,
      panelBlurPx: 10,
      saturationPercent: 96,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 64,
    },
    dark: {
      appBg: '#08090a',
      appBg2: '#111315',
      appBg3: '#171819',
      panel: '#181a1c',
      panelSoft: '#101214',
      accent: '#c3c7c3',
      accentStrong: '#f1f2ee',
      secondary: '#89969b',
      heading: '#fbfbf8',
      text: '#dce1e1',
      muted: '#aeb7b9',
      border: '#767f84',
      onAccent: '#08090a',
      buttonText: '#dce1e1',
      panelOpacityPercent: 90,
      glassPercent: 18,
      shadowPercent: 92,
      cornerRadiusPx: 8,
      panelBlurPx: 12,
      saturationPercent: 96,
      motionSpeedSeconds: 0.18,
      motionIntensityPercent: 64,
    },
  },
};

const coreThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'appBg', labelKey: 'settings.appearance.themeCustom.field.appBg', descriptionKey: 'settings.appearance.themeCustom.field.appBg.description' },
  { field: 'accent', labelKey: 'settings.appearance.themeCustom.field.accent', descriptionKey: 'settings.appearance.themeCustom.field.accent.description' },
  { field: 'accentStrong', labelKey: 'settings.appearance.themeCustom.field.accentStrong', descriptionKey: 'settings.appearance.themeCustom.field.accentStrong.description' },
  { field: 'secondary', labelKey: 'settings.appearance.themeCustom.field.secondary', descriptionKey: 'settings.appearance.themeCustom.field.secondary.description' },
  { field: 'heading', labelKey: 'settings.appearance.themeCustom.field.heading', descriptionKey: 'settings.appearance.themeCustom.field.heading.description' },
  { field: 'muted', labelKey: 'settings.appearance.themeCustom.field.muted', descriptionKey: 'settings.appearance.themeCustom.field.muted.description' },
  { field: 'panel', labelKey: 'settings.appearance.themeCustom.field.panel', descriptionKey: 'settings.appearance.themeCustom.field.panel.description' },
];

const gradientThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'appBg2', labelKey: 'settings.appearance.themeCustom.field.appBg2', descriptionKey: 'settings.appearance.themeCustom.field.appBg2.description' },
  { field: 'appBg3', labelKey: 'settings.appearance.themeCustom.field.appBg3', descriptionKey: 'settings.appearance.themeCustom.field.appBg3.description' },
];

const advancedThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'panelSoft', labelKey: 'settings.appearance.themeCustom.field.panelSoft', descriptionKey: 'settings.appearance.themeCustom.field.panelSoft.description' },
  { field: 'text', labelKey: 'settings.appearance.themeCustom.field.text', descriptionKey: 'settings.appearance.themeCustom.field.text.description' },
  { field: 'border', labelKey: 'settings.appearance.themeCustom.field.border', descriptionKey: 'settings.appearance.themeCustom.field.border.description' },
  { field: 'onAccent', labelKey: 'settings.appearance.themeCustom.field.onAccent', descriptionKey: 'settings.appearance.themeCustom.field.onAccent.description' },
  { field: 'buttonText', labelKey: 'settings.appearance.themeCustom.field.buttonText', descriptionKey: 'settings.appearance.themeCustom.field.buttonText.description' },
];

const surfaceThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'titlebar', labelKey: 'settings.appearance.themeCustom.field.titlebar', descriptionKey: 'settings.appearance.themeCustom.field.titlebar.description' },
  { field: 'sidebar', labelKey: 'settings.appearance.themeCustom.field.sidebar', descriptionKey: 'settings.appearance.themeCustom.field.sidebar.description' },
  { field: 'player', labelKey: 'settings.appearance.themeCustom.field.player', descriptionKey: 'settings.appearance.themeCustom.field.player.description' },
  { field: 'field', labelKey: 'settings.appearance.themeCustom.field.field', descriptionKey: 'settings.appearance.themeCustom.field.field.description' },
  { field: 'row', labelKey: 'settings.appearance.themeCustom.field.row', descriptionKey: 'settings.appearance.themeCustom.field.row.description' },
  { field: 'rowHover', labelKey: 'settings.appearance.themeCustom.field.rowHover', descriptionKey: 'settings.appearance.themeCustom.field.rowHover.description' },
  { field: 'rowActive', labelKey: 'settings.appearance.themeCustom.field.rowActive', descriptionKey: 'settings.appearance.themeCustom.field.rowActive.description' },
  { field: 'chip', labelKey: 'settings.appearance.themeCustom.field.chip', descriptionKey: 'settings.appearance.themeCustom.field.chip.description' },
];

const stateThemeColorFields: Array<{ field: ThemeColorField; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { field: 'success', labelKey: 'settings.appearance.themeCustom.field.success', descriptionKey: 'settings.appearance.themeCustom.field.success.description' },
  { field: 'warning', labelKey: 'settings.appearance.themeCustom.field.warning', descriptionKey: 'settings.appearance.themeCustom.field.warning.description' },
  { field: 'danger', labelKey: 'settings.appearance.themeCustom.field.danger', descriptionKey: 'settings.appearance.themeCustom.field.danger.description' },
  { field: 'focus', labelKey: 'settings.appearance.themeCustom.field.focus', descriptionKey: 'settings.appearance.themeCustom.field.focus.description' },
];

const numberThemeFields: Array<{ field: ThemeNumberField; labelKey: TranslationKey; descriptionKey: TranslationKey; min: number; max: number; step?: number; suffix: string }> = [
  { field: 'panelOpacityPercent', labelKey: 'settings.appearance.themeCustom.field.panelOpacity', descriptionKey: 'settings.appearance.themeCustom.field.panelOpacity.description', min: 40, max: 100, suffix: '%' },
  { field: 'glassPercent', labelKey: 'settings.appearance.themeCustom.field.glass', descriptionKey: 'settings.appearance.themeCustom.field.glass.description', min: 0, max: 80, suffix: '%' },
  { field: 'shadowPercent', labelKey: 'settings.appearance.themeCustom.field.shadow', descriptionKey: 'settings.appearance.themeCustom.field.shadow.description', min: 0, max: 100, suffix: '%' },
  { field: 'cornerRadiusPx', labelKey: 'settings.appearance.themeCustom.field.cornerRadius', descriptionKey: 'settings.appearance.themeCustom.field.cornerRadius.description', min: 0, max: 28, suffix: 'px' },
  { field: 'panelBlurPx', labelKey: 'settings.appearance.themeCustom.field.panelBlur', descriptionKey: 'settings.appearance.themeCustom.field.panelBlur.description', min: 0, max: 32, suffix: 'px' },
  { field: 'saturationPercent', labelKey: 'settings.appearance.themeCustom.field.saturation', descriptionKey: 'settings.appearance.themeCustom.field.saturation.description', min: 60, max: 140, suffix: '%' },
  { field: 'motionSpeedSeconds', labelKey: 'settings.appearance.themeCustom.field.motionSpeed', descriptionKey: 'settings.appearance.themeCustom.field.motionSpeed.description', min: 0.12, max: 8, step: 0.01, suffix: 's' },
  { field: 'motionIntensityPercent', labelKey: 'settings.appearance.themeCustom.field.motionIntensity', descriptionKey: 'settings.appearance.themeCustom.field.motionIntensity.description', min: 0, max: 160, suffix: '%' },
];

const hexToRgb = (value: string): { r: number; g: number; b: number } | null => {
  const color = normalizeThemeHexColor(value);
  if (!color) {
    return null;
  }

  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
};

const getRelativeLuminance = (value: string): number => {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return 0;
  }

  const channel = (component: number): number => {
    const normalized = component / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return channel(rgb.r) * 0.2126 + channel(rgb.g) * 0.7152 + channel(rgb.b) * 0.0722;
};

const getContrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

const bestReadableColor = (background: string): string => (getContrastRatio('#ffffff', background) >= getContrastRatio('#241a17', background) ? '#ffffff' : '#241a17');

const getThemeEditorDefaults = (preset: AppThemePreset, tone: ThemeTone): ThemeEditorDefaults => ({
  ...baseThemeEditorDefaults[tone],
  ...(themeEditorDefaults[preset]?.[tone] ?? {}),
});

const mergeThemeToneValues = (preset: AppThemePreset, tone: ThemeTone, draft: AppThemeToneOverride): ThemeEditorDefaults => ({
  ...getThemeEditorDefaults(preset, tone),
  ...draft,
});

const buildThemePresetOverrides = (
  current: AppThemePresetOverrides,
  preset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride | null,
): AppThemePresetOverrides => {
  const next: AppThemePresetOverrides = { ...current };
  const currentPresetOverride = { ...(next[preset] ?? {}) };

  if (!draft || Object.keys(draft).length === 0) {
    delete currentPresetOverride[tone];
  } else {
    currentPresetOverride[tone] = draft;
  }

  if (currentPresetOverride.light || currentPresetOverride.dark) {
    next[preset] = currentPresetOverride;
  } else {
    delete next[preset];
  }

  return next;
};

const isThemeExportPayload = (value: unknown): value is Partial<ThemeExportPayload> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readThemeExportPreset = (value: unknown): AppThemePreset | null => {
  if (!themePresetOptions.some((option) => option.preset === value)) {
    return null;
  }
  return normalizeThemePreset(value);
};

const createThemeCustomId = (): string => `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const getNextThemeCustomName = (themes: AppThemeCustomTheme[]): string => {
  const usedNames = new Set(themes.map((theme) => theme.name));
  let index = themes.length + 1;
  while (usedNames.has(`我的主题 ${index}`)) {
    index += 1;
  }
  return `我的主题 ${index}`;
};

const buildThemeCustomTheme = (
  themes: AppThemeCustomTheme[],
  basePreset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride = {},
  name = getNextThemeCustomName(themes),
): AppThemeCustomTheme => {
  const timestamp = new Date().toISOString();
  const theme: AppThemeCustomTheme = {
    id: createThemeCustomId(),
    name,
    basePreset,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (Object.keys(draft).length > 0) {
    theme[tone] = draft;
  }

  return theme;
};

const buildPluginThemeCustomTheme = (pluginTheme: PluginThemeOption, existing?: AppThemeCustomTheme): AppThemeCustomTheme => {
  const timestamp = new Date().toISOString();
  const theme: AppThemeCustomTheme = {
    id: pluginTheme.customThemeId,
    name: `${pluginTheme.title} · ${pluginTheme.pluginName}`.slice(0, 48),
    basePreset: pluginTheme.basePreset,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  if (pluginTheme.light) {
    theme.light = { ...pluginTheme.light };
  }
  if (pluginTheme.dark) {
    theme.dark = { ...pluginTheme.dark };
  }

  return theme;
};

const updateThemeCustomThemeTone = (
  themes: AppThemeCustomTheme[],
  themeId: string,
  tone: ThemeTone,
  draft: AppThemeToneOverride | null,
): AppThemeCustomTheme[] => {
  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes(
    themes.map((theme) => {
      if (theme.id !== themeId) {
        return theme;
      }

      const next: AppThemeCustomTheme = { ...theme, updatedAt: timestamp };
      if (!draft || Object.keys(draft).length === 0) {
        delete next[tone];
      } else {
        next[tone] = draft;
      }
      return next;
    }),
  );
};

const renameThemeCustomTheme = (themes: AppThemeCustomTheme[], themeId: string, name: string): AppThemeCustomTheme[] => {
  const normalized = name.replace(/[\r\n;]/g, '').trim().slice(0, 48);
  if (!normalized) {
    return themes;
  }

  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes(themes.map((theme) => (theme.id === themeId ? { ...theme, name: normalized, updatedAt: timestamp } : theme)));
};

const duplicateThemeCustomTheme = (themes: AppThemeCustomTheme[], themeId: string): AppThemeCustomTheme[] => {
  const source = themes.find((theme) => theme.id === themeId);
  if (!source) {
    return themes;
  }

  const timestamp = new Date().toISOString();
  return normalizeThemeCustomThemes([
    ...themes,
    {
      ...source,
      id: createThemeCustomId(),
      name: `${source.name} Copy`.slice(0, 48),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
};

const createThemeExportPayload = (
  themes: AppThemeCustomTheme[],
  selectedTheme: AppThemeCustomTheme | undefined,
  selectedPreset: AppThemePreset,
  tone: ThemeTone,
  draft: AppThemeToneOverride,
): ThemeCustomExportPayload => {
  const theme = selectedTheme ?? buildThemeCustomTheme(themes, selectedPreset, tone, draft, getNextThemeCustomName(themes));
  return {
    exportedAt: new Date().toISOString(),
    schema: 'echo-next.custom-theme',
    theme,
    version: 2,
  };
};

const downloadTextFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const getThemeContrastWarnings = (values: ThemeEditorDefaults): string[] => {
  const warnings: string[] = [];

  if (getContrastRatio(values.text, values.appBg) < 4.5) {
    warnings.push('body');
  }
  if (getContrastRatio(values.heading, values.appBg) < 4.5) {
    warnings.push('heading');
  }
  if (getContrastRatio(values.buttonText, values.panel) < 4.5) {
    warnings.push('button');
  }
  if (getContrastRatio(values.onAccent, values.accent) < 3) {
    warnings.push('accent');
  }

  return warnings;
};

const getUpdateStateLabel = (state: UpdateStatus['state']): TranslationKey => {
  switch (state) {
    case 'checking':
      return 'settings.about.updates.state.checking';
    case 'available':
      return 'settings.about.updates.state.available';
    case 'downloading':
      return 'settings.about.updates.state.downloading';
    case 'downloaded':
      return 'settings.about.updates.state.downloaded';
    case 'not-available':
      return 'settings.about.updates.state.notAvailable';
    case 'error':
      return 'settings.about.updates.state.error';
    case 'disabled':
      return 'settings.about.updates.state.disabled';
    default:
      return 'settings.about.updates.state.idle';
  }
};

const readFinalThemeUnlocked = (): boolean =>
  readBooleanStoragePreference(finalThemeUnlockedStorageKey, false);

const writeFinalThemeUnlocked = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(finalThemeUnlockedStorageKey, 'true');
  } catch {
    // Ignore storage failures; the unlock can still work for this session.
  }
};

const formatUpdateBytes = (bytes: number | null | undefined): string => {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return 'n/a';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

type DuplicateCleanupMember = DuplicateTrackCleanupPreview['groups'][number]['keep'];

const formatDuplicateCleanupTrackQuality = (member: DuplicateCleanupMember): string => {
  const { track } = member;
  const parts: string[] = [];

  if (track.codec) {
    parts.push(track.codec.toUpperCase());
  }
  if (track.bitDepth && track.sampleRate) {
    parts.push(`${track.bitDepth}bit / ${formatRate(track.sampleRate)}`);
  } else if (track.sampleRate) {
    parts.push(formatRate(track.sampleRate));
  }
  if (track.bitrate && track.bitrate > 0) {
    parts.push(`${Math.round(track.bitrate / 1000)} kbps`);
  }
  if (member.sizeBytes && member.sizeBytes > 0) {
    parts.push(formatUpdateBytes(member.sizeBytes));
  }
  parts.push(`评分 ${member.qualityScore}`);

  return parts.join(' · ');
};

const formatCacheBytes = (bytes: number | null | undefined): string => {
  if (!Number.isFinite(bytes) || bytes === null || bytes === undefined || bytes <= 0) {
    return '0 B';
  }

  return formatUpdateBytes(bytes);
};

const formatProtectionTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return '暂无';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
};

const getDatabaseHealthLabel = (status: LibraryDatabaseProtectionStatus['health']['status'] | undefined): TranslationKey => {
  switch (status) {
    case 'ok':
      return 'settings.danger.database.health.ok';
    case 'corrupt':
      return 'settings.danger.database.health.corrupt';
    case 'unreadable':
      return 'settings.danger.database.health.unreadable';
    default:
      return 'settings.danger.database.health.idle';
  }
};

const SettingSection = ({ id, activeKey, icon: Icon, title, children }: SettingSectionProps): JSX.Element => {
  const isActive = activeKey === id;

  return (
    <section className="settings-section" id={`settings-sec-${id}`} data-visible={isActive}>
      <div className="section-title">
        <span className="section-title-icon">
          <Icon size={18} />
        </span>
        <h2>{title}</h2>
      </div>
      {isActive ? children : null}
    </section>
  );
};

const SettingRow = ({ className, highlighted, id, title, description, children }: SettingRowProps): JSX.Element => (
  <div className={`setting-row ${className ?? ''}`.trim()} id={id} data-search-highlight={highlighted ? 'true' : undefined}>
    <div className="setting-info">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
    {children}
  </div>
);

const ChipButton = ({
  active,
  children,
  disabled,
  onClick,
  title,
}: {
  active?: boolean;
  children: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}): JSX.Element => (
  <button className={`list-filter-chip ${active ? 'active' : ''}`} type="button" aria-pressed={active} disabled={disabled} title={title} onClick={onClick}>
    {children}
    {active ? <Check size={13} /> : null}
  </button>
);

const StatusText = ({
  children,
  tone = 'neutral',
}: {
  children: string;
  tone?: 'neutral' | 'good' | 'muted';
}): JSX.Element => <span className={`settings-status-text settings-status-text--${tone}`}>{children}</span>;

const ToggleButton = ({
  active,
  disabled,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element => (
  <button className={`toggle-btn ${active ? 'active' : ''}`} type="button" aria-pressed={active} disabled={disabled} onClick={onClick}>
    <span />
  </button>
);

const getAccountStatusLabel = (status: AccountStatus | undefined): string => {
  if (!status) {
    return '检查中';
  }

  if (status.connected && status.error) {
    return '登录失效';
  }

  return status.connected ? '已登录' : '未登录';
};

const getAccountBadgeClass = (status: AccountStatus | undefined): string => {
  if (!status || !status.connected) {
    return 'list-filter-chip';
  }

  return status.error ? 'list-filter-chip settings-account-badge-error active' : 'list-filter-chip active';
};

const renderAccountStatusBadge = (
  t: ReturnType<typeof useI18n>['t'],
  status: AccountStatus | undefined,
  onOpenLogin: () => void,
): JSX.Element => {
  if (status && !status.connected) {
    return (
      <button className={`${getAccountBadgeClass(status)} settings-account-status-link`} type="button" onClick={onOpenLogin}>
        {t('settings.integrations.accounts.clickToLogin')}
      </button>
    );
  }

  return <span className={getAccountBadgeClass(status)}>{getAccountStatusLabel(status)}</span>;
};

const AccountCookieCard = ({
  busyAction,
  cookieValue,
  error,
  message,
  onChangeCookie,
  onCheck,
  onClear,
  onOpenLogin,
  onSave,
  provider,
  status,
}: {
  busyAction?: AccountBusyAction;
  cookieValue: string;
  error?: string | null;
  message?: string | null;
  onChangeCookie: (value: string) => void;
  onCheck: () => void;
  onClear: () => void;
  onOpenLogin: () => void;
  onSave: () => void;
  provider: AccountProvider;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  return (
    <article className="settings-account-row" aria-label={accountProviderLabels[provider]}>
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>{accountProviderLabels[provider]}</h3>
          <p>{provider === 'bilibili' ? t('settings.integrations.accounts.description.bilibili') : t('settings.integrations.accounts.description.default')}</p>
        </div>
      </div>
      <label className="settings-account-cookie-field">
        <input
          type="password"
          value={cookieValue}
          placeholder={t('settings.integrations.accounts.cookiePlaceholder')}
          onChange={(event) => onChangeCookie(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" disabled={busyAction === 'save' || cookieValue.trim().length === 0} onClick={onSave}>
          <Save size={15} />
          {busyAction === 'save' ? t('settings.integrations.accounts.manualSaveBusy') : t('settings.integrations.accounts.manualSave')}
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login' || busyAction === 'browser'} onClick={onOpenLogin}>
          <Check size={15} />
          {busyAction === 'login' || busyAction === 'browser' ? t('settings.integrations.accounts.checkBusy') : '保存浏览器选择'}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{t('settings.integrations.accounts.cookieFallback')}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      {provider === 'soundcloud' ? <p className="settings-inline-note settings-account-note">{t('settings.integrations.accounts.soundcloudNote')}</p> : null}
      {provider === 'osu' ? <p className="settings-inline-note settings-account-note">{t('settings.integrations.accounts.osuNote')}</p> : null}
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

const YouTubeAccountCard = ({
  browser,
  busyAction,
  error,
  message,
  onBrowserChange,
  onCheck,
  onClear,
  onOpenLogin,
  status,
}: {
  browser: YouTubeBrowser;
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onBrowserChange: (browser: YouTubeBrowser) => void;
  onCheck: () => void;
  onClear: () => void;
  onOpenLogin: () => void;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  const youtubeBrowserOptions = buildYouTubeBrowserOptions(t);
  return (
    <article className="settings-account-row" aria-label="YouTube">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>YouTube</h3>
          <p>{t('settings.integrations.accounts.youtube.description')}</p>
        </div>
      </div>
      <label className="settings-select-field settings-account-browser-field">
        <span>{t('settings.integrations.accounts.youtube.browser')}</span>
        <select value={browser} onChange={(event) => onBrowserChange(event.target.value as YouTubeBrowser)} disabled={busyAction === 'browser'}>
          {youtubeBrowserOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login' || busyAction === 'browser'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' || busyAction === 'browser' ? t('settings.integrations.accounts.loginBusy') : '打开浏览器登录'}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? t('settings.integrations.accounts.youtube.savedStatus')}</span>
        <span>{t('settings.integrations.accounts.check')} {status?.lastCheckedAt ?? 'n/a'}</span>
      </div>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

const SpotifyAccountCard = ({
  busyAction,
  error,
  message,
  onCheck,
  onClear,
  onOpenDashboard,
  onOpenLogin,
  status,
}: {
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onCheck: () => void;
  onClear: () => void;
  onOpenDashboard: () => void;
  onOpenLogin: () => void;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  return (
    <article className="settings-account-row" aria-label="Spotify">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>Spotify</h3>
          <p>{t('settings.integrations.accounts.spotify.description')}</p>
        </div>
      </div>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" onClick={onOpenDashboard}>
          <ExternalLink size={15} />
          打开 Spotify Dashboard
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' ? t('settings.integrations.accounts.spotify.loginBusy') : t('settings.integrations.accounts.spotify.login')}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? status?.username ?? t('settings.integrations.accounts.spotify.savedStatus')}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

const TidalAccountCard = ({
  busyAction,
  error,
  message,
  onCheck,
  onClear,
  onOpenDashboard,
  onOpenLogin,
  status,
}: {
  busyAction?: AccountBusyAction;
  error?: string | null;
  message?: string | null;
  onCheck: () => void;
  onClear: () => void;
  onOpenDashboard: () => void;
  onOpenLogin: () => void;
  status?: AccountStatus;
}): JSX.Element => {
  const { t } = useI18n();
  return (
    <article className="settings-account-row" aria-label="TIDAL">
      <div className="settings-account-summary">
        {renderAccountStatusBadge(t, status, onOpenLogin)}
        <div>
          <h3>TIDAL</h3>
          <p>TIDAL 仅接入官方 catalog 元数据；不会获取音频 URL，也不会进入 ECHO 播放链。</p>
        </div>
      </div>
      <div className="settings-account-actions">
        <button className="settings-action-button" type="button" onClick={onOpenDashboard}>
          <ExternalLink size={15} />
          打开 TIDAL Dashboard
        </button>
        <button className="settings-action-button" type="button" disabled={busyAction === 'check'} onClick={onCheck}>
          {busyAction === 'check' ? t('settings.integrations.accounts.checkBusy') : t('settings.integrations.accounts.check')}
        </button>
        <button className="settings-action-button settings-account-login-button" type="button" disabled={busyAction === 'login'} onClick={onOpenLogin}>
          <ExternalLink size={15} />
          {busyAction === 'login' ? '等待授权...' : '登录 TIDAL'}
        </button>
        <button className="settings-danger-button" type="button" disabled={busyAction === 'clear'} onClick={onClear}>
          {busyAction === 'clear' ? t('settings.integrations.accounts.logoutBusy') : t('settings.integrations.accounts.logout')}
        </button>
      </div>
      <div className="settings-account-meta">
        <span>{status?.displayName ?? status?.username ?? '使用 OAuth PKCE 授权，不保存 Client Secret；仅用于 TIDAL 元数据。'}</span>
        <span>{t('settings.integrations.accounts.loginMeta', { loginAt: status?.lastLoginAt ?? 'n/a', checkedAt: status?.lastCheckedAt ?? 'n/a' })}</span>
      </div>
      <p className="settings-inline-note settings-account-note">
        默认回调地址是 http://127.0.0.1:43880/tidal/callback，需要在 TIDAL Developer Dashboard 的 app 设置里登记。
      </p>
      {message ? <p className="settings-inline-note settings-account-note">{message}</p> : null}
      {error ? <p className="settings-inline-error settings-account-note">{error}</p> : null}
    </article>
  );
};

const NumberRangeField = ({
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}): JSX.Element => (
  <label className="settings-range-field">
    <input min={min} max={max} step={step} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <span>
      {value}
      {suffix}
    </span>
  </label>
);

const FontPickerModal = ({
  currentFont,
  fonts,
  onClose,
  onChooseFile,
  onSelect,
  query,
  setQuery,
  title,
}: {
  currentFont: string;
  fonts: string[];
  onClose: () => void;
  onChooseFile: () => void;
  onSelect: (fontFamily: string) => void;
  query: string;
  setQuery: (query: string) => void;
  title: string;
}): JSX.Element => {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFonts = normalizedQuery ? fonts.filter((font) => font.toLowerCase().includes(normalizedQuery)) : fonts;

  return (
    <div className="settings-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-font-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-font-modal-header">
          <h3>{title}</h3>
          <button className="settings-icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <label className="settings-font-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        </label>
        <button className="settings-font-file-button" type="button" onClick={onChooseFile}>
          <FolderOpen size={15} aria-hidden="true" />
          从资源管理器选择
        </button>
        <div className="settings-font-list">
          {filteredFonts.map((font) => (
            <button
              className={`settings-font-option ${font === currentFont ? 'active' : ''}`}
              key={font}
              type="button"
              style={{ fontFamily: `"${font}", var(--echo-font-family)` }}
              onClick={() => onSelect(font)}
            >
              <span>{font}</span>
              <em>Echo font preview Aa 你好</em>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export const SettingsPage = (): JSX.Element => {
  const { locale, localeOptions, setLocale, t } = useI18n();
  const playbackQueue = usePlaybackQueue();
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectSettingsPlatform());
  const playbackOutputModesForPlatform = useMemo(() => getPlaybackOutputModesForPlatform(rendererPlatform), [rendererPlatform]);
  const sharedBackendOptionsForPlatform = useMemo(() => getSharedBackendOptionsForPlatform(rendererPlatform), [rendererPlatform]);
  const advancedNativeOutputAvailable = isAdvancedNativeOutputPlatform(rendererPlatform);
  const windowsIntegrationAvailable = rendererPlatform === 'win32';
  const settingsScrollShellRef = useRef<HTMLDivElement | null>(null);
  const [settingsHorizontalScroll, setSettingsHorizontalScroll] = useState({
    available: false,
    canLeft: false,
    canRight: false,
  });
  const [activeSection, setActiveSection] = useState<SettingsNavKey>(() => readInitialSettingsSection());
  const [settingsQuery, setSettingsQuery] = useState('');
  const [highlightedSettingId, setHighlightedSettingId] = useState<string | null>(null);
  const [mysteriousKeyVisible, setMysteriousKeyVisible] = useState(false);
  const mysteriousKeyUnlockNoticeShownRef = useRef(false);
  const [finalThemeUnlocked, setFinalThemeUnlocked] = useState(() => readFinalThemeUnlocked());
  const finalThemeUnlockNoticeShownRef = useRef(false);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [audioDiagnosticsCopied, setAudioDiagnosticsCopied] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputMode, setOutputMode] = useState<AudioOutputMode>('shared');
  const [sharedBackend, setSharedBackend] = useState<AudioSharedBackend>('auto');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(() => readAppearancePreferences());
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const sidebarRouteOrder = useMemo(() => normalizeSidebarRouteOrder(appSettings?.sidebarRouteOrder), [appSettings?.sidebarRouteOrder]);
  const sidebarHiddenRouteIds = useMemo(() => normalizeSidebarHiddenRouteIds(appSettings?.sidebarHiddenRouteIds), [appSettings?.sidebarHiddenRouteIds]);
  const sidebarHiddenRouteIdSet = useMemo(() => new Set(sidebarHiddenRouteIds), [sidebarHiddenRouteIds]);
  const sidebarLayoutExpanded = appSettings?.appearanceSidebarLayoutExpanded === true;
  const sidebarLayoutSummary = sidebarHiddenRouteIds.length > 0 ? t('settings.appearance.sidebar.summary.hidden', { count: sidebarHiddenRouteIds.length }) : t('settings.appearance.sidebar.summary.allVisible');
  const sidebarSettingsGroups = useMemo(() => {
    const groups: Record<SidebarSettingsRouteItem['placement'], SidebarSettingsRouteItem[]> = {
      main: [],
      utility: [],
    };
    const includeDownloads = appSettings?.downloadsFeatureUnlocked === true;

    for (const routeId of sidebarRouteOrder) {
      if (routeId === 'downloads' && !includeDownloads) {
        continue;
      }

      const item = sidebarSettingsRouteItemById.get(routeId);
      if (item) {
        groups[item.placement].push(item);
      }
    }

    return groups;
  }, [appSettings?.downloadsFeatureUnlocked, sidebarRouteOrder]);
  const [selectedThemePreset, setSelectedThemePreset] = useState<AppThemePreset>(() => readThemePreset());
  const [themeCustomThemes, setThemeCustomThemes] = useState<AppThemeCustomTheme[]>(() => readThemeCustomThemes());
  const [activeThemeCustomId, setActiveThemeCustomId] = useState<string | null>(() => readThemeCustomId());
  const [pluginThemeOptions, setPluginThemeOptions] = useState<PluginThemeOption[]>([]);
  const [themeCustomTone, setThemeCustomTone] = useState<ThemeTone>('light');
  const [themeCustomDraft, setThemeCustomDraft] = useState<AppThemeToneOverride>({});
  const [themeCustomAdvancedOpen, setThemeCustomAdvancedOpen] = useState(false);
  const [themeCustomMessage, setThemeCustomMessage] = useState<string | null>(null);
  const pendingThemeCopyDraftRef = useRef<{ draft: AppThemeToneOverride; tone: ThemeTone } | null>(null);
  const skipNextThemePreviewRef = useRef(false);
  const wallpaperPersistTimerRef = useRef<number | null>(null);
  const [discordPresenceStatus, setDiscordPresenceStatus] = useState<DiscordPresenceStatus | null>(null);
  const [smtcDiagnostics, setSmtcDiagnostics] = useState<SmtcDiagnostics | null>(null);
  const [smtcRestarting, setSmtcRestarting] = useState(false);
  const [taskbarPlaybackStatus, setTaskbarPlaybackStatus] = useState<TaskbarPlaybackStatus | null>(null);
  const [lastFmStatus, setLastFmStatus] = useState<LastFmStatus | null>(null);
  const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([]);
  const [accountCookies, setAccountCookies] = useState<Record<AccountProvider, string>>({
    netease: '',
    qqmusic: '',
    kugou: '',
    bilibili: '',
    youtube: '',
    soundcloud: '',
    spotify: '',
    tidal: '',
    osu: '',
  });
  const [accountBusy, setAccountBusy] = useState<Partial<Record<AccountProvider, AccountBusyAction>>>({});
  const [accountErrors, setAccountErrors] = useState<Partial<Record<AccountProvider, string | null>>>({});
  const [accountMessages, setAccountMessages] = useState<Partial<Record<AccountProvider, string | null>>>({});
  const [youtubeBrowser, setYoutubeBrowser] = useState<YouTubeBrowser>('none');
  const [lastFmAuthToken, setLastFmAuthToken] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [deferredAboutReleaseNotes, setDeferredAboutReleaseNotes] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [lastCrashSummary, setLastCrashSummary] = useState<LastCrashSummary | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [devConsoleMessage, setDevConsoleMessage] = useState<string | null>(null);
  const [defaultCacheDirectory, setDefaultCacheDirectory] = useState<string | null>(null);
  const [pendingCacheDirectory, setPendingCacheDirectory] = useState<string | null | undefined>(undefined);
  const [cacheDirectoryBusy, setCacheDirectoryBusy] = useState(false);
  const [cacheDirectoryResult, setCacheDirectoryResult] = useState<CoverCacheMigrationResult | null>(null);
  const [cacheDirectoryMessage, setCacheDirectoryMessage] = useState<string | null>(null);
  const [cacheInventory, setCacheInventory] = useState<AppCacheInventory | null>(null);
  const [cacheInventoryBusy, setCacheInventoryBusy] = useState(false);
  const [downloadSettings, setDownloadSettings] = useState<DownloadSettings | null>(null);
  const [downloadDirectoryBusy, setDownloadDirectoryBusy] = useState(false);
  const [downloadDirectoryMessage, setDownloadDirectoryMessage] = useState<string | null>(null);
  const [downloadUnlockInput, setDownloadUnlockInput] = useState('');
  const [downloadUnlockMessage, setDownloadUnlockMessage] = useState<string | null>(null);
  const [pendingAlbumMergeStrategy, setPendingAlbumMergeStrategy] = useState<AlbumMergeStrategy | null>(null);
  const [pendingArtistMergeStrategy, setPendingArtistMergeStrategy] = useState<ArtistMergeStrategy | null>(null);
  const [albumGroupingBusy, setAlbumGroupingBusy] = useState(false);
  const [albumGroupingMessage, setAlbumGroupingMessage] = useState<string | null>(null);
  const [libraryScanBusy, setLibraryScanBusy] = useState(false);
  const [libraryScanMessage, setLibraryScanMessage] = useState<string | null>(null);
  const [libraryScanStatuses, setLibraryScanStatuses] = useState<ScanStatusByFolder>(getLibraryScanStatuses);
  const [libraryDeferredRefreshReady, setLibraryDeferredRefreshReady] = useState(false);
  const [artistImageBusyAction, setArtistImageBusyAction] = useState<'refresh' | 'clear' | null>(null);
  const [artistImageMessage, setArtistImageMessage] = useState<string | null>(null);
  const [artistImageProgress, setArtistImageProgress] = useState<ArtistImageProgress | null>(null);
  const [embeddedTagRescanBusy, setEmbeddedTagRescanBusy] = useState<'all' | 'missing-cover' | null>(null);
  const [embeddedTagRescanMessage, setEmbeddedTagRescanMessage] = useState<string | null>(null);
  const [duplicateSummary, setDuplicateSummary] = useState<DuplicateTrackIndexSummary | null>(null);
  const [duplicateBusyAction, setDuplicateBusyAction] = useState<'toggle' | 'analyze' | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [duplicateCleanupPreview, setDuplicateCleanupPreview] = useState<DuplicateTrackCleanupPreview | null>(null);
  const [duplicateCleanupBusyAction, setDuplicateCleanupBusyAction] = useState<'scan' | 'clean' | null>(null);
  const [duplicateCleanupMessage, setDuplicateCleanupMessage] = useState<string | null>(null);
  const [duplicateCleanupResultsExpanded, setDuplicateCleanupResultsExpanded] = useState(false);
  const [bpmAnalysisJob, setBpmAnalysisJob] = useState<BpmAnalysisJobStatus | null>(null);
  const [bpmAnalysisBusy, setBpmAnalysisBusy] = useState(false);
  const [bpmAnalysisMessage, setBpmAnalysisMessage] = useState<string | null>(null);
  const [replayGainAnalysisJob, setReplayGainAnalysisJob] = useState<ReplayGainAnalysisJobStatus | null>(null);
  const [replayGainAnalysisBusy, setReplayGainAnalysisBusy] = useState(false);
  const [replayGainAnalysisMessage, setReplayGainAnalysisMessage] = useState<string | null>(null);
  const [lyricsBackfillJob, setLyricsBackfillJob] = useState<LyricsBackfillJobStatus | null>(null);
  const [lyricsBackfillBusy, setLyricsBackfillBusy] = useState(false);
  const [lyricsBackfillMessage, setLyricsBackfillMessage] = useState<string | null>(null);
  const lyricsBackfillPollGenerationRef = useRef(0);
  const [playbackAdvancedPanelExpanded, setPlaybackAdvancedPanelExpanded] = useState(() =>
    readBooleanStoragePreference(playbackAdvancedPanelExpandedStorageKey, false),
  );
  const [replayGainAdvancedOpen, setReplayGainAdvancedOpen] = useState(false);
  const [audioStatusPanelOpen, setAudioStatusPanelOpen] = useState(false);
  const [channelBalanceState, setChannelBalanceState] = useState<ChannelBalanceState>(defaultSettingsChannelBalance);
  const [audioResetBusy, setAudioResetBusy] = useState(false);
  const [windowsAudioRestartBusy, setWindowsAudioRestartBusy] = useState(false);
  const [audioResetMessage, setAudioResetMessage] = useState<string | null>(null);
  const [settingsBackupBusy, setSettingsBackupBusy] = useState<'export' | 'import' | 'dataPackage' | null>(null);
  const [settingsBackupMessage, setSettingsBackupMessage] = useState<string | null>(null);
  const [dataBackupStatus, setDataBackupStatus] = useState<DataBackupStatus | null>(null);
  const [dataBackupProgress, setDataBackupProgress] = useState<DataBackupProgress | null>(null);
  const [dataBackupBusy, setDataBackupBusy] = useState<'choose' | 'run' | 'import' | 'open' | null>(null);
  const [dataBackupMessage, setDataBackupMessage] = useState<string | null>(null);
  const [draggingSidebarRouteId, setDraggingSidebarRouteId] = useState<SidebarRouteId | null>(null);
  const [pluginSettingsMessage, setPluginSettingsMessage] = useState<string | null>(null);
  const [recordingShortcutTarget, setRecordingShortcutTarget] = useState<RecordingShortcutTarget | null>(null);
  const [shortcutMessages, setShortcutMessages] = useState<Partial<Record<ShortcutMessageKey, string | null>>>({});
  const [fontFamilies, setFontFamilies] = useState<string[]>(fallbackFontFamilies);
  const [fontPickerTarget, setFontPickerTarget] = useState<FontPickerTarget | null>(null);
  const [fontPickerQuery, setFontPickerQuery] = useState('');
  const [databaseProtectionStatus, setDatabaseProtectionStatus] = useState<LibraryDatabaseProtectionStatus | null>(null);
  const [databaseProtectionBusyAction, setDatabaseProtectionBusyAction] = useState<'refresh' | 'snapshot' | 'restore' | 'scrub' | 'discard' | 'relaunch' | 'open' | null>(null);
  const [databaseProtectionMessage, setDatabaseProtectionMessage] = useState<string | null>(null);
  const [databaseProtectionError, setDatabaseProtectionError] = useState<string | null>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerMessage, setDangerMessage] = useState<string | null>(null);
  const [dangerConfirmWord, setDangerConfirmWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [networkProxyDraft, setNetworkProxyDraft] = useState({
    mode: 'off' as NetworkProxyMode,
    proxyUrl: '',
    pacUrl: '',
    bypassRules: defaultNetworkProxyBypassRules,
  });
  const [networkProxyBusy, setNetworkProxyBusy] = useState<'save' | 'test' | null>(null);
  const [networkProxyTestResult, setNetworkProxyTestResult] = useState<NetworkProxyTestResult | null>(null);
  const [spotifyAuthDraft, setSpotifyAuthDraft] = useState({
    clientId: '',
    redirectUri: '',
  });
  const [tidalAuthDraft, setTidalAuthDraft] = useState({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    countryCode: 'US',
  });
  const [spotifyAuthMessage, setSpotifyAuthMessage] = useState<string | null>(null);
  const [tidalAuthMessage, setTidalAuthMessage] = useState<string | null>(null);
  const [onlineArtistInfoDraft, setOnlineArtistInfoDraft] = useState({
    bandsintownAppId: '',
    ticketmasterApiKey: '',
    seatGeekClientId: '',
    region: '',
  });
  const [onlineAlbumInfoDraft, setOnlineAlbumInfoDraft] = useState({
    discogsUserToken: '',
  });
  const [onlineArtistInfoBusyAction, setOnlineArtistInfoBusyAction] = useState<'save' | 'clear' | null>(null);
  const [onlineArtistInfoMessage, setOnlineArtistInfoMessage] = useState<string | null>(null);
  const [onlineAlbumInfoBusyAction, setOnlineAlbumInfoBusyAction] = useState<'save' | null>(null);
  const [onlineAlbumInfoMessage, setOnlineAlbumInfoMessage] = useState<string | null>(null);
  const [accountPanelExpanded, setAccountPanelExpanded] = useState(() =>
    readBooleanStoragePreference(integrationsAccountPanelExpandedStorageKey, false),
  );
  const [credentialPanelExpanded, setCredentialPanelExpanded] = useState(() =>
    readBooleanStoragePreference(integrationsCredentialPanelExpandedStorageKey, false),
  );
  const credentialPanelSearchTarget = isIntegrationCredentialSettingId(highlightedSettingId);
  const credentialPanelVisible = credentialPanelExpanded;

  useEffect(() => {
    if (credentialPanelSearchTarget) {
      setCredentialPanelExpanded(true);
    }
  }, [credentialPanelSearchTarget]);

  const libraryScanStatusList = useMemo(() => Object.values(libraryScanStatuses), [libraryScanStatuses]);
  const libraryScanRunningList = useMemo(
    () => libraryScanStatusList.filter((scanStatus) => libraryScanRunningStatuses.has(scanStatus.status)),
    [libraryScanStatusList],
  );
  const libraryScanActiveJobIds = useMemo(
    () => libraryScanRunningList.map((scanStatus) => scanStatus.id).sort(),
    [libraryScanRunningList],
  );
  const libraryScanProgressTotal = libraryScanStatusList.reduce((total, scanStatus) => total + scanStatus.totalFiles, 0);
  const libraryScanProgressDone = libraryScanStatusList.reduce((total, scanStatus) => total + scanStatus.processedFiles, 0);
  const libraryScanProgressPercent =
    libraryScanProgressTotal > 0 ? Math.max(0, Math.min(100, Math.round((libraryScanProgressDone / libraryScanProgressTotal) * 100))) : 0;
  const libraryScanProgressMessage = formatLibraryScanProgressMessage(libraryScanStatusList);
  const libraryScanHasVisibleProgress = libraryScanStatusList.length > 0 && (libraryScanRunningList.length > 0 || libraryScanMessage !== null);
  const libraryScanActionDisabled = libraryScanBusy || libraryScanRunningList.length > 0;

  const settingsSearchEntries = useMemo(() => {
    const sectionEntries: Array<{
      id: string;
      sectionKey: SettingsNavKey;
      targetId?: string;
      title: string;
      description: string;
      terms: string[];
    }> = settingsNavItems.map((item) => {
      const title = t(item.labelKey);
      const description = t(item.descriptionKey);
      return {
        id: `section-${item.key}`,
        sectionKey: item.key,
        title,
        description,
        terms: [title, description, ...(settingsSearchAliases[item.key] ?? [])],
      };
    });

    const rowEntries: Array<{
      id: string;
      sectionKey: SettingsNavKey;
      targetId: string;
      title: string;
      description: string;
      terms: string[];
    }> = [
      {
        id: 'row-first-run-wizard',
        sectionKey: 'general',
        targetId: 'settings-row-first-run-wizard',
        title: t('settings.general.firstRunWizard.title'),
        description: t('settings.general.firstRunWizard.description'),
        terms: [t('settings.general.firstRunWizard.title'), t('settings.general.firstRunWizard.description'), '首次启动指引', '新手指引', '新手引导', '向导', '引导', '標準輸出', '標準出力', '标准输出', '系统音频', 'システムオーディオ', 'guide', 'onboarding', 'first run', 'welcome', 'system audio'],
      },
      {
        id: 'row-sidebar-auto-hide',
        sectionKey: 'general',
        targetId: 'settings-row-sidebar-auto-hide',
        title: t('settings.general.sidebarAutoHide.title'),
        description: t('settings.general.sidebarAutoHide.description'),
        terms: [
          t('settings.general.sidebarAutoHide.title'),
          t('settings.general.sidebarAutoHide.description'),
          '隐藏侧栏',
          '自动隐藏侧栏',
          '侧栏抽屉',
          'sidebar',
          'hide sidebar',
          'auto hide sidebar',
          'sidebar drawer',
        ],
      },
      {
        id: 'row-fast-startup',
        sectionKey: 'general',
        targetId: 'settings-row-fast-startup',
        title: t('settings.general.fastStartup.title'),
        description: t('settings.general.fastStartup.description'),
        terms: [t('settings.general.fastStartup.title'), t('settings.general.fastStartup.description'), '快速启动', '快速啟動', '高速起動', '启动加速', '慢启动', 'data protection', 'startup', 'fast startup', 'quick startup', 'database snapshot', '曲库检查'],
      },
      {
        id: 'row-data-protection-disabled',
        sectionKey: 'general',
        targetId: 'settings-row-data-protection-disabled',
        title: '关闭数据保护',
        description: '打开后不再执行启动、后台、扫描完成和更新前的数据保护快照。默认关闭。',
        terms: ['关闭 data-protection', '关闭数据保护', 'data protection', 'database snapshot', '数据保护', '快照', '播放卡顿'],
      },
      {
        id: 'row-sidebar-layout',
        sectionKey: 'appearance',
        targetId: 'settings-row-sidebar-layout',
        title: '左侧栏',
        description: '调整左侧入口的顺序和显示状态，不会改动页面或播放链路。',
        terms: [
          '左侧栏',
          '调整左侧入口的顺序和显示状态，不会改动页面或播放链路。',
          'sidebar',
          'left sidebar',
          'navigation order',
          'hide navigation',
          '\u5de6\u4fa7\u680f',
          '\u4fa7\u680f',
          '\u5bfc\u822a\u6392\u5e8f',
          '\u9690\u85cf\u680f\u76ee',
        ],
      },
      {
        id: 'row-player-waveform-progress',
        sectionKey: 'general',
        targetId: 'settings-row-player-waveform-progress',
        title: t('settings.general.playerWaveformProgress.title'),
        description: t('settings.general.playerWaveformProgress.description'),
        terms: [t('settings.general.playerWaveformProgress.title'), t('settings.general.playerWaveformProgress.description'), '波形进度条', '波形進度條', '波形播放进度', 'waveform progress', 'waveform seekbar', 'waveform scrubber', 'roon'],
      },
      {
        id: 'row-home-waveform-visualizer',
        sectionKey: 'general',
        targetId: 'settings-row-home-waveform-visualizer',
        title: t('settings.general.homeWaveformVisualizer.title'),
        description: t('settings.general.homeWaveformVisualizer.description'),
        terms: [
          t('settings.general.homeWaveformVisualizer.title'),
          t('settings.general.homeWaveformVisualizer.description'),
          '首页波形图',
          '主页波形图',
          '音频可视化',
          '可视化条',
          'waveform visualizer',
          'audio visualizer',
          'home visualizer',
        ],
      },
      {
        id: 'row-audio-visual-spectrum',
        sectionKey: 'general',
        targetId: 'settings-row-audio-visual-spectrum',
        title: '实时频谱分析',
        description: '默认关闭。开启后主页波形会请求主进程计算频谱；低负载播放模式会强制关闭它。',
        terms: ['实时频谱分析', '频谱', '可视化', 'FFT', 'visual spectrum', 'spectrum', 'audio visualizer', 'mouse freeze', '卡死', '低负载'],
      },
      {
        id: 'row-home-random-hero-title',
        sectionKey: 'general',
        targetId: 'settings-row-home-random-hero-title',
        title: t('settings.general.homeRandomHeroTitle.title'),
        description: t('settings.general.homeRandomHeroTitle.description'),
        terms: [
          t('settings.general.homeRandomHeroTitle.title'),
          t('settings.general.homeRandomHeroTitle.description'),
          '首页随机标题',
          '主页随机标题',
          '随机标题',
          '网络梗',
          'random',
          'random title',
          'home random title',
          '#define int long long',
        ],
      },
      {
        id: 'row-artist-streaming-albums',
        sectionKey: 'general',
        targetId: 'settings-row-artist-streaming-albums',
        title: t('settings.general.artistStreamingAlbums.title'),
        description: t('settings.general.artistStreamingAlbums.description'),
        terms: [t('settings.general.artistStreamingAlbums.title'), t('settings.general.artistStreamingAlbums.description'), '流媒体专辑', '串流專輯', 'ストリーミングアルバム', '艺人流媒体专辑', '在线专辑', '专辑页', '网易云', 'QQ音乐', 'NetEase', 'QQ Music', 'streaming albums', 'artist streaming albums'],
      },
      {
        id: 'row-artist-online-info-sources',
        sectionKey: 'general',
        targetId: 'settings-row-artist-online-info-sources',
        title: t('settings.general.artistInfoSources.title'),
        description: t('settings.general.artistInfoSources.description'),
        terms: [t('settings.general.artistInfoSources.title'), t('settings.general.artistInfoSources.description'), '艺人信息源', '藝人資訊來源', 'アーティスト情報ソース', '歌手信息源', '百度百科', '维基百科', 'Wikipedia', 'Baike', 'artist info source'],
      },
      {
        id: 'row-data-backup',
        sectionKey: 'general',
        targetId: 'settings-row-data-backup',
        title: '自动数据备份',
        description: '设置备份目录、备份周期，并导入完整数据备份。',
        terms: ['自动数据备份', '自动备份', '数据备份', '备份目录', '备份周期', '导入备份', '恢复备份', 'backup', 'auto backup', 'data backup', 'restore backup'],
      },
      {
        id: 'row-plugins',
        sectionKey: 'plugins',
        targetId: 'settings-row-plugins',
        title: '本地插件',
        description: '管理 userData/plugins 下的 echo.plugin.json、plugin.js 和面板文件。',
        terms: [
          '本地插件',
          '插件',
          'plugin',
          'plugins',
          '扩展',
          '脚本',
          'manifest',
          'echo.plugin.json',
          'plugin.js',
          'panel.html',
          '权限',
          '开发者',
          'sandbox',
          '沙箱',
        ],
      },
      {
        id: 'row-network-proxy',
        sectionKey: 'integrations',
        targetId: 'settings-row-network-proxy',
        title: t('settings.integrations.networkProxy.title'),
        description: t('settings.integrations.networkProxy.description'),
        terms: [
          t('settings.integrations.networkProxy.title'),
          t('settings.integrations.networkProxy.description'),
          'proxy',
          'http proxy',
          'socks',
          'socks5',
          'pac',
          'vpn',
          'mv',
          'metadata',
        ],
      },
      {
        id: 'row-spotify-auth-config',
        sectionKey: 'integrations',
        targetId: 'settings-row-spotify-auth-config',
        title: 'Spotify OAuth 配置',
        description: '必须使用用户自己的 Spotify Client ID 和本机回调地址登录。',
        terms: ['Spotify OAuth 配置', 'Spotify Client ID', 'Spotify redirect URI', 'Spotify API', 'Spotify 登录', 'spotify client_id', 'redirect_uri'],
      },
      {
        id: 'row-online-album-info',
        sectionKey: 'integrations',
        targetId: 'settings-row-online-album-info',
        title: 'Discogs 专辑评分',
        description: '给专辑页评分做兜底；不填也会尝试公开 API，填入 Personal access token 后更稳定。',
        terms: ['Discogs 专辑评分', 'Discogs token', 'Discogs API', 'album rating', '专辑评分', '在线专辑信息', 'Personal access token'],
      },
      {
        id: 'row-online-artist-info',
        sectionKey: 'integrations',
        targetId: 'settings-row-online-artist-info',
        title: '在线歌手信息',
        description: '配置演出和歌手补强数据源；不配置时歌手页只显示本地关系。',
        terms: ['在线歌手信息', '歌手信息', '演出', 'concert', 'event', 'bandsintown', 'ticketmaster', 'seatgeek', 'artist info', 'artist insights'],
      },
      {
        id: 'row-discord-presence',
        sectionKey: 'integrations',
        targetId: 'settings-row-discord-presence',
        title: t('settings.integrations.discord.title'),
        description: t('settings.integrations.discord.description'),
        terms: [
          t('settings.integrations.discord.title'),
          t('settings.integrations.discord.description'),
          t('settings.integrations.discord.action.refresh'),
          'discord',
          'discord status',
          'discord presence',
          'discord rich presence',
          'rich presence',
          'presence',
          'status',
          'state',
          'connected',
          'connection',
          'playing status',
          '状态',
          '狀態',
          'discord 状态',
          'discord 狀態',
          '播放状态',
          '連線狀態',
          '连接状态',
        ],
      },
      {
        id: 'row-smtc',
        sectionKey: 'integrations',
        targetId: 'settings-row-smtc',
        title: t('settings.integrations.smtc.title'),
        description: t('settings.integrations.smtc.description'),
        terms: [t('settings.integrations.smtc.title'), t('settings.integrations.smtc.description'), 'smtc', 'media session', 'system media controls', '系统媒体控制', '狀態列', '状态栏'],
      },
      {
        id: 'row-taskbar-playback',
        sectionKey: 'integrations',
        targetId: 'settings-row-taskbar-playback',
        title: t('settings.integrations.taskbarPlayback.title'),
        description: t('settings.integrations.taskbarPlayback.description'),
        terms: [
          t('settings.integrations.taskbarPlayback.title'),
          t('settings.integrations.taskbarPlayback.description'),
          'taskbar',
          'thumbnail toolbar',
          'progress bar',
          'windows taskbar',
          '任务栏',
          '工作列',
          '播放进度',
          '上一首',
          '下一首',
        ],
      },
      {
        id: 'row-lastfm',
        sectionKey: 'integrations',
        targetId: 'settings-row-lastfm',
        title: t('settings.integrations.lastfm.title'),
        description: t('settings.integrations.lastfm.description'),
        terms: [t('settings.integrations.lastfm.title'), t('settings.integrations.lastfm.description'), 'last.fm', 'lastfm', 'scrobble', 'status', '状态', '账号状态', 'login status'],
      },
      {
        id: 'row-account-startup-refresh',
        sectionKey: 'integrations',
        targetId: 'settings-row-account-startup-refresh',
        title: t('settings.integrations.accountStartupRefresh.title'),
        description: t('settings.integrations.accountStartupRefresh.description'),
        terms: [
          t('settings.integrations.accountStartupRefresh.title'),
          t('settings.integrations.accountStartupRefresh.description'),
          t('settings.integrations.accounts.loginStatus'),
          'account status',
          'login status',
          'startup account refresh',
          'youtube',
          'bilibili',
          'spotify',
        ],
      },
      {
        id: 'row-account-expiry-notices',
        sectionKey: 'integrations',
        targetId: 'settings-row-account-expiry-notices',
        title: '关闭账号失效通知',
        description: '开启后，账号失效时不再弹出左上角提醒；账号状态仍可在这里查看。',
        terms: ['关闭账号失效通知', '账号失效通知', '左上角通知', '消息推送', 'account notice', 'account expiry notice', 'login expired', 'notification'],
      },
      {
        id: 'row-audio-status',
        sectionKey: 'playback',
        targetId: 'settings-row-audio-status',
        title: t('settings.playback.audioStatus.title'),
        description: t('audioDrawer.note.engine'),
        terms: [t('settings.playback.audioStatus.title'), t('audioDrawer.note.engine'), 'audio status', 'engine status', '状态', '音频状态', '采样率', 'dac', 'wasapi', 'asio', 'juce'],
      },
      {
        id: 'row-automix',
        sectionKey: 'playback',
        targetId: 'settings-row-automix',
        title: t('settings.playback.automix.title'),
        description: t('settings.playback.automix.description'),
        terms: [
          t('settings.playback.automix.title'),
          t('settings.playback.automix.description'),
          'automix',
          'smart crossfade',
          'crossfade',
          'spotify',
          'apple music',
          '智能过渡',
          '连续播放',
        ],
      },
      {
        id: 'row-fixed-volume',
        sectionKey: 'playback',
        targetId: 'settings-row-fixed-volume',
        title: t('settings.playback.fixedVolume.title'),
        description: t('settings.playback.fixedVolume.description'),
        terms: [t('settings.playback.fixedVolume.title'), t('settings.playback.fixedVolume.description'), '固定音量', '固定音量', '固定音量', 'fixed volume', 'roon', '音量锁定', 'volume lock', 'ReplayGain'],
      },
      {
        id: 'row-transport-fade',
        sectionKey: 'playback',
        targetId: 'settings-row-transport-fade',
        title: t('settings.playback.transportFade.title'),
        description: t('settings.playback.transportFade.description'),
        terms: [
          t('settings.playback.transportFade.title'),
          t('settings.playback.transportFade.description'),
          'fade',
          'fade in',
          'fade out',
          'transport fade',
          'play pause fade',
          '淡入淡出',
          '播放暂停淡入淡出',
          '淡入',
          '淡出',
        ],
      },
      {
        id: 'row-mini-player',
        sectionKey: 'playback',
        targetId: 'settings-row-mini-player',
        title: t('settings.playback.miniPlayer.title'),
        description: t('settings.playback.miniPlayer.description'),
        terms: [t('settings.playback.miniPlayer.title'), t('settings.playback.miniPlayer.description'), '迷你播放器', '迷你播放器', 'ミニプレイヤー', 'mini player', 'overlay', 'always on top', '置顶', '游戏', '进度条', '封面', '隐藏主界面', '托盘'],
      },
      {
        id: 'row-gapless-playback',
        sectionKey: 'playback',
        targetId: 'settings-row-gapless-playback',
        title: t('settings.playback.gapless.title'),
        description: t('settings.playback.gapless.description'),
        terms: [t('settings.playback.gapless.title'), t('settings.playback.gapless.description'), '专辑无缝播放', '專輯無縫播放', 'ギャップレス', '无缝播放', 'gapless', 'gapless playback', '0 秒间隔', '连续播放'],
      },
      {
        id: 'row-volume-balance',
        sectionKey: 'playback',
        targetId: 'settings-row-volume-balance',
        title: t('settings.playback.replayGain.title'),
        description: t('settings.playback.replayGain.description'),
        terms: [t('settings.playback.replayGain.title'), t('settings.playback.replayGain.description'), '音量标准化', '音量標準化', '音量ノーマライズ', '音量自动平衡', '音量平衡', '响度', 'ReplayGain', 'replay gain', 'loudness', 'lufs'],
      },
      {
        id: 'row-mono-audio',
        sectionKey: 'playback',
        targetId: 'settings-row-mono-audio',
        title: t('settings.playback.monoAudio.title'),
        description: t('settings.playback.monoAudio.description'),
        terms: [t('settings.playback.monoAudio.title'), t('settings.playback.monoAudio.description'), '单声道', '單聲道', 'モノラル', 'mono', 'mono sum', '左右声道', '声道合并', '单耳'],
      },
      {
        id: 'row-output-device',
        sectionKey: 'playback',
        targetId: 'settings-row-output-device',
        title: t('settings.playback.outputDevice.title'),
        description: t('settings.playback.outputDevice.description'),
        terms: [t('settings.playback.outputDevice.title'), t('settings.playback.outputDevice.description'), 'output', 'device', 'dac', 'asio', 'wasapi', 'exclusive', '输出设备'],
      },
      {
        id: 'row-low-load-playback',
        sectionKey: 'playback',
        targetId: 'settings-row-low-load-playback',
        title: t('audioDrawer.option.lowLoadPlaybackMode'),
        description: t('audioDrawer.option.lowLoadPlaybackModeDescription'),
        terms: ['低负载播放模式', '低负载', '卡死', '鼠标卡死', 'CPU', 'IO', 'FFT', 'ReplayGain', 'BPM', '歌词深搜', '封面', '艺人图', 'MV', 'low load', 'performance', 'mouse freeze'],
      },
      {
        id: 'row-low-load-playback-enhancements',
        sectionKey: 'playback',
        targetId: 'settings-row-low-load-playback-enhancements',
        title: t('audioDrawer.option.lowLoadPlaybackEnhancements'),
        description: t('audioDrawer.option.lowLoadPlaybackEnhancementsDescription'),
        terms: ['低负载增强保护', '增强低负载', '增强保护', '播放轮询', '桌面歌词', '诊断降频', '后台库任务', 'low load enhanced', 'enhanced low load'],
      },
      {
        id: 'row-theme',
        sectionKey: 'appearance',
        targetId: 'settings-row-theme',
        title: t('settings.appearance.theme.title'),
        description: t('settings.appearance.theme.description'),
        terms: [t('settings.appearance.theme.title'), t('settings.appearance.theme.description'), 'theme', 'dark', 'light', 'system', '主题', '深色', '浅色'],
      },
      {
        id: 'row-wallpaper',
        sectionKey: 'appearance',
        targetId: 'settings-row-wallpaper',
        title: '自定义背景',
        description: '支持图片和本地视频；视频静音循环，不进入音频链路。',
        terms: ['自定义背景', '视频壁纸', '动态背景', 'wallpaper', 'video wallpaper', 'background', 'opacity', 'blur', '壁纸', '背景', '透明度'],
      },
      {
        id: 'row-now-playing-cover-color',
        sectionKey: 'appearance',
        targetId: 'settings-row-now-playing-cover-color',
        title: t('settings.appearance.nowPlayingCoverColor.title'),
        description: t('settings.appearance.nowPlayingCoverColor.description'),
        terms: [
          t('settings.appearance.nowPlayingCoverColor.title'),
          t('settings.appearance.nowPlayingCoverColor.description'),
          'now playing cover color',
          'album cover color',
          'dominant color',
          'cover palette',
          '取色',
          '封面取色',
          '播放界面',
          '正在播放',
        ],
      },
      {
        id: 'row-album-cover-shape',
        sectionKey: 'appearance',
        targetId: 'settings-row-album-cover-shape',
        title: t('settings.appearance.albumCoverShape.title'),
        description: t('settings.appearance.albumCoverShape.description'),
        terms: [
          t('settings.appearance.albumCoverShape.title'),
          t('settings.appearance.albumCoverShape.description'),
          t('settings.appearance.albumCoverShape.rounded'),
          t('settings.appearance.albumCoverShape.square'),
          'album cover shape',
          'cover radius',
          'rounded cover',
          'square cover',
          '专辑封面',
          '封面圆角',
          '封面方角',
          '方角',
          '圆角',
        ],
      },
      {
        id: 'row-library-folders',
        sectionKey: 'library',
        targetId: 'settings-row-library-folders',
        title: '曲库文件夹',
        description: '管理本地音乐来源和扫描入口。',
        terms: ['曲库文件夹', '管理本地音乐来源和扫描入口。', 'library folders', 'scan', 'folder', '曲库', '文件夹', '扫描'],
      },
      {
        id: 'row-live-library-updates',
        sectionKey: 'library',
        targetId: 'settings-row-live-library-updates',
        title: '\u5b9e\u65f6\u66f4\u65b0\u66f2\u5e93',
        description: '\u76d1\u542c\u672c\u5730\u66f2\u5e93\u6587\u4ef6\u5939\uff0c\u65b0\u589e\u6216\u4fee\u6539\u97f3\u9891\u6587\u4ef6\u4f1a\u81ea\u52a8\u8fdb\u5165\u66f2\u5e93\u3002',
        terms: [
          '\u5b9e\u65f6\u66f4\u65b0\u66f2\u5e93',
          'library watcher',
          'live library',
          'auto rescan',
          'watcher',
          '\u81ea\u52a8\u626b\u63cf',
          '\u81ea\u52a8\u5237\u65b0',
          '\u65b0\u589e\u6b4c\u66f2',
        ],
      },
      {
        id: 'row-library-quality',
        sectionKey: 'library',
        targetId: 'settings-row-library-quality',
        title: '\u8d44\u6599\u8d28\u91cf\u6574\u7406',
        description: '\u67e5\u770b\u7f3a\u5c01\u9762\u3001\u56de\u9000\u5143\u6570\u636e\u3001\u672a\u77e5\u827a\u4eba\u4e13\u8f91\u548c\u7f51\u7edc\u5019\u9009\u3002',
        terms: [
          '\u8d44\u6599\u8d28\u91cf\u6574\u7406',
          '\u7f3a\u5c01\u9762',
          '\u56de\u9000\u5143\u6570\u636e',
          '\u672a\u77e5\u827a\u4eba',
          '\u672a\u77e5\u4e13\u8f91',
          '\u7f51\u7edc\u5019\u9009',
          '\u5143\u6570\u636e',
          '\u8d44\u6599\u8865\u5168',
          'metadata quality',
          'missing cover',
          'fallback metadata',
          'network candidate',
        ],
      },
      {
        id: 'row-library-lyrics-backfill',
        sectionKey: 'library',
        targetId: 'settings-row-library-lyrics-backfill',
        title: '\u4e00\u952e\u6b4c\u8bcd\u8865\u5168',
        description: '\u540e\u53f0\u626b\u63cf\u7f3a\u5931\u6b4c\u8bcd\u5e76\u5206\u6279\u8865\u5168\uff0c\u5feb\u901f\u6a21\u5f0f\u4f18\u5148\u7f51\u6613\u3001QQ\u3001LRCLIB \u7b49\u9ad8\u547d\u4e2d\u6e90\u3002',
        terms: [
          '\u4e00\u952e\u6b4c\u8bcd\u8865\u5168',
          '\u6b4c\u8bcd\u8865\u5168',
          '\u7f3a\u5931\u6b4c\u8bcd',
          '\u6279\u91cf\u6b4c\u8bcd',
          '\u6b4c\u8bcd\u626b\u63cf',
          '\u8fdb\u5ea6\u6761',
          'lyrics backfill',
          'lyrics completion',
          'missing lyrics',
          'batch lyrics',
          'lrclib',
          'amll',
        ],
      },
      {
        id: 'row-library-health-report',
        sectionKey: 'library',
        targetId: 'settings-row-library-health-report',
        title: '\u66f2\u5e93\u4f53\u68c0\u62a5\u544a',
        description: '\u6c47\u603b\u6570\u636e\u5e93\u3001\u626b\u63cf\u3001\u7f13\u5b58\u3001\u8d44\u6599\u8d28\u91cf\u3001\u5b9e\u65f6\u66f4\u65b0\u548c\u8fdc\u7a0b\u6e90\u72b6\u6001\u3002',
        terms: [
          '\u66f2\u5e93\u4f53\u68c0',
          '\u5065\u5eb7\u62a5\u544a',
          '\u6570\u636e\u5e93\u5065\u5eb7',
          '\u626b\u63cf\u9519\u8bef',
          '\u7f13\u5b58\u5360\u7528',
          '\u8d44\u6599\u8d28\u91cf',
          '\u5b9e\u65f6\u66f4\u65b0',
          '\u8fdc\u7a0b\u6e90',
          '\u5bfc\u51fa Markdown',
          'library health',
          'health report',
          'diagnostics',
        ],
      },
      {
        id: 'row-artist-wall-artwork',
        sectionKey: 'library',
        targetId: 'settings-row-artist-wall-artwork',
        title: '艺术家墙封面',
        description: '用艺术家的一张专辑封面替代字母占位。',
        terms: ['艺术家墙封面', '用艺术家的一张专辑封面替代字母占位。', 'artist wall', 'album artwork', 'artist cover', '艺术家', '封面'],
      },
      {
        id: 'row-artist-avatars',
        sectionKey: 'library',
        targetId: 'settings-row-artist-avatars',
        title: t('settings.appearance.artistAvatars.title'),
        description: t('settings.appearance.artistAvatars.description'),
        terms: [
          t('settings.appearance.artistAvatars.title'),
          t('settings.appearance.artistAvatars.description'),
          t('settings.appearance.artistAvatars.toggle'),
          'artist avatars',
          'artist images',
          'avatar cache',
          '歌手头像',
          '艺术家头像',
          '头像缓存',
        ],
      },
      {
        id: 'row-library-merge-strategy',
        sectionKey: 'library',
        targetId: 'settings-row-library-merge-strategy',
        title: '专辑/艺人合并策略',
        description: '调整专辑和艺人别名聚合，不改写歌曲元数据。',
        terms: ['专辑合并', '艺人合并', '艺术家合并', 'artist merge', 'album merge', 'metadata cleanup', 'Aiobahn', '25時'],
      },
      {
        id: 'row-mysterious-key',
        sectionKey: 'general',
        targetId: 'settings-row-mysterious-key',
        title: 'Mysterious key',
        description: 'Enter a special key to unlock hidden capabilities.',
        terms: ['Mysterious key', 'key', 'secret', 'unlock', 'hidden', 'zimin', '神秘钥匙', '密钥'],
      },
      {
        id: 'row-streaming-download-actions',
        sectionKey: 'library',
        targetId: 'settings-row-streaming-download-actions',
        title: '流媒体下载按钮',
        description: '默认隐藏流媒体页下载入口，需要时再显示支持平台的下载按钮。',
        terms: ['流媒体下载按钮', '隐藏下载', '显示下载', '下载入口', '流媒体', 'streaming download', 'download button'],
      },
      {
        id: 'row-safe-mode',
        sectionKey: 'about',
        targetId: 'settings-row-safe-mode',
        title: 'Safe mode',
        description: '每次启动自动打开异常记录器，单独显示异常、渲染器错误、音频错误和慢启动阶段。',
        terms: ['Safe mode', '安全模式', '异常记录器', '启动诊断', '慢启动', '打开控制台', 'startup diagnostics', 'debug console', 'slow startup', 'exception recorder', 'boot timing'],
      },
      {
        id: 'row-dev-console',
        sectionKey: 'general',
        targetId: 'settings-row-dev-console',
        title: '开发控制台',
        description: '实时显示主进程 stdout/stderr 与渲染器 console，接近 npm run dev 的调试输出。',
        terms: ['开发控制台', '打开控制台', '调试控制台', 'console', 'stdout', 'stderr', 'npm run dev', 'debug console', 'devtools', '日志'],
      },
      {
        id: 'row-diagnostics-assistant',
        sectionKey: 'about',
        targetId: 'settings-row-diagnostics-assistant',
        title: '诊断助手',
        description: '汇总音频链路、崩溃状态、日志目录、Markdown 和安全诊断包导出。',
        terms: ['诊断助手', '音频诊断', '安全诊断包', '导出 zip', 'audio diagnostics', 'diagnostics assistant', 'underrun', 'ffmpeg', 'logs'],
      },
      {
        id: 'row-diagnostics',
        sectionKey: 'about',
        targetId: 'settings-row-diagnostics',
        title: 'Diagnostics / 崩溃报告',
        description: '报错默认生成轻量 Markdown 报告；日志目录仍保留在本地，不会自动上传。',
        terms: ['Diagnostics / 崩溃报告', 'Markdown 报告', 'diagnostics', 'crash', 'logs', 'status', '诊断', '崩溃', '日志', '状态'],
      },
    ];

    const entries = [...rowEntries, ...sectionEntries].filter((entry) => {
      if (!mysteriousKeyVisible && entry.targetId === 'settings-row-mysterious-key') {
        return false;
      }

      if (appSettings?.downloadsFeatureUnlocked !== true && entry.targetId === 'settings-row-streaming-download-actions') {
        return false;
      }

      return true;
    });
    return windowsIntegrationAvailable
      ? entries
      : entries.filter((entry) => entry.targetId !== 'settings-row-smtc' && entry.targetId !== 'settings-row-taskbar-playback');
  }, [appSettings?.downloadsFeatureUnlocked, mysteriousKeyVisible, t, windowsIntegrationAvailable]);

  const mysteriousKeySearchUnlocked = activeSection === 'general' && normalizeSettingsSearchText(settingsQuery) === 'zimin';
  const finalThemeSearchUnlocked = isFinalThemeUnlockCode(settingsQuery);

  useEffect(() => {
    if (!mysteriousKeySearchUnlocked) {
      return;
    }

    setMysteriousKeyVisible(true);
    if (mysteriousKeyUnlockNoticeShownRef.current) {
      return;
    }

    mysteriousKeyUnlockNoticeShownRef.current = true;
    window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: 'Mysterious key 已解锁。' }));
  }, [mysteriousKeySearchUnlocked]);

  useEffect(() => {
    if (!finalThemeSearchUnlocked) {
      return;
    }

    if (!finalThemeUnlocked) {
      writeFinalThemeUnlocked();
      setFinalThemeUnlocked(true);
    }

    setSettingsQuery('');
    setActiveSection('appearance');
    setAppSettings((current) => (current ? { ...current, appearanceThemePresetsExpanded: true } : current));

    if (finalThemeUnlockNoticeShownRef.current) {
      return;
    }

    finalThemeUnlockNoticeShownRef.current = true;
    window.dispatchEvent(new CustomEvent('app:show-chrome-notice', { detail: 'FINAL theme unlocked.' }));
  }, [finalThemeSearchUnlocked, finalThemeUnlocked]);

  const settingsSearchResults = useMemo<SettingsSearchResult[]>(() => {
    const query = normalizeSettingsSearchText(settingsQuery);

    if (!query) {
      return [];
    }

    const results: SettingsSearchResult[] = [];
    settingsSearchEntries.forEach((entry) => {
      const score = rankSettingsSearch(query, entry.terms);
      if (score <= 0) {
        return;
      }

      results.push({
        id: entry.id,
        sectionKey: entry.sectionKey,
        targetId: entry.targetId,
        title: entry.title,
        description: entry.description,
        score,
      });
    });

    return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, locale));
  }, [locale, settingsQuery, settingsSearchEntries]);

  const visibleNavItems = useMemo(() => {
    const query = normalizeSettingsSearchText(settingsQuery);

    if (!query) {
      return settingsNavItems;
    }

    const resultKeys = new Set(settingsSearchResults.map((item) => item.sectionKey));
    return settingsNavItems.filter((item) => resultKeys.has(item.key));
  }, [settingsQuery, settingsSearchResults]);

  const compatibleDevices = useMemo(
    () => getCompatiblePlaybackDevices(devices, outputMode),
    [devices, outputMode],
  );
  const statusSelectedDevice = useMemo(
    () => devices.find((device) => deviceMatchesAudioStatus(device, status)) ?? null,
    [devices, status],
  );
  const outputDeviceOptions = useMemo(
    () =>
      outputMode === 'system'
        ? [{ value: '', label: t('audioDrawer.device.systemDefaultOutput'), disabled: true }]
        : compatibleDevices.length === 0
        ? [{ value: '', label: t('settings.playback.outputDevice.empty'), disabled: true }]
        : compatibleDevices.map((device) => ({
            value: device.id,
            label: `${device.index} - ${device.name}`,
          })),
    [compatibleDevices, outputMode, t],
  );
  const localShortcuts = useMemo(
    () => mergeShortcutSettings(createDefaultLocalShortcuts(), appSettings?.localShortcuts),
    [appSettings?.localShortcuts],
  );
  const globalShortcuts = useMemo(
    () => mergeShortcutSettings(createDefaultGlobalShortcuts(), appSettings?.globalShortcuts),
    [appSettings?.globalShortcuts],
  );
  const segmentPlaybackStatus = sharedPlaybackStatus.playbackStatus;
  const segmentAudioStatus = sharedPlaybackStatus.audioStatus ?? status;
  const segmentTrackId = playbackQueue.currentTrackId ?? segmentPlaybackStatus?.currentTrackId ?? segmentAudioStatus?.currentTrackId ?? null;
  const segmentQueueTracks = playbackQueue.tracks ?? [];
  const segmentCurrentTrack = playbackQueue.currentTrack ?? segmentQueueTracks.find((track) => track.id === segmentTrackId) ?? null;
  const segmentFilePath = segmentCurrentTrack?.path ?? segmentAudioStatus?.currentFilePath ?? segmentPlaybackStatus?.filePath ?? null;
  const segmentTrackKey = segmentCurrentTrack?.stableKey ?? segmentCurrentTrack?.id ?? segmentTrackId ?? segmentFilePath ?? null;
  const segmentDurationSeconds = Math.max(
    0,
    segmentAudioStatus?.durationSeconds ?? 0,
    (segmentPlaybackStatus?.durationMs ?? 0) / 1000,
    segmentCurrentTrack?.duration ?? 0,
  );
  const segmentPositionSeconds = Math.max(0, segmentAudioStatus?.positionSeconds ?? (segmentPlaybackStatus?.positionMs ?? 0) / 1000);
  const segmentVisualState = getVisualPlaybackState({
    audioStatus: segmentAudioStatus,
    playbackStatus: segmentPlaybackStatus,
    playbackVisualIntent: sharedPlaybackStatus.playbackVisualIntent,
  });
  const libraryHeavyRefreshAllowed = segmentVisualState !== 'playing' && segmentVisualState !== 'loading';
  const segmentIsSpotifyTrack = isSpotifyTrack(segmentCurrentTrack);
  const segmentTitle = segmentCurrentTrack?.title ?? titleFromPath(segmentFilePath);
  const segmentArtist = segmentCurrentTrack?.artist ?? segmentCurrentTrack?.albumArtist ?? '';
  const segmentLoopDisabled =
    segmentDurationSeconds <= 0 ||
    (!segmentFilePath && !segmentIsSpotifyTrack) ||
    Boolean(segmentAudioStatus?.currentTrackId?.startsWith('airplay-receiver:') || segmentAudioStatus?.currentFilePath?.startsWith('airplay://'));

  const accountStatusByProvider = useMemo(
    () => Object.fromEntries(accountStatuses.map((item) => [item.provider, item])) as Partial<Record<AccountProvider, AccountStatus>>,
    [accountStatuses],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const audio = getAudioBridge();

      if (!audio) {
        setStatus(null);
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to inspect audio settings.');
        return;
      }

      setStatus(await audio.getStatus());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, []);

  const handleSegmentSeek = useCallback(
    async (nextPositionSeconds: number): Promise<void> => {
      if (segmentDurationSeconds <= 0) {
        return;
      }

      const safePositionSeconds = Math.min(segmentDurationSeconds, Math.max(0, nextPositionSeconds));

      try {
        let nextStatus: PlaybackStatus;

        if (segmentIsSpotifyTrack && segmentCurrentTrack) {
          nextStatus = await seekSpotifyPlayback(segmentCurrentTrack, safePositionSeconds);
          setPlaybackStatusSnapshot({ audioStatus: null, playbackStatus: nextStatus, error: null });
        } else {
          const playback = window.echo?.playback;

          if (!playback) {
            setError('Desktop bridge unavailable. Open ECHO Next in Electron to control playback.');
            return;
          }

          const statusAfterSeek = await playback.seek(safePositionSeconds);
          nextStatus = {
            ...statusAfterSeek,
            positionMs: Math.round(safePositionSeconds * 1000),
          };
          setPlaybackStatusSnapshot({ playbackStatus: nextStatus, error: null });
          void refreshPlaybackStatus();
        }

        dispatchPlaybackSeeked(safePositionSeconds, nextStatus.currentTrackId ?? segmentTrackId);
      } catch (seekError) {
        setError(seekError instanceof Error ? seekError.message : String(seekError));
      }
    },
    [segmentCurrentTrack, segmentDurationSeconds, segmentIsSpotifyTrack, segmentTrackId],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const audio = getAudioBridge();

      if (!audio) {
        setDevices([]);
        return;
      }

      const nextDevices = await audio.listDevices();
      setDevices(nextDevices);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      setDevices([]);
    }
  }, []);

  const refreshDiscordPresenceStatus = useCallback(async () => {
    try {
      const discordPresence = getDiscordPresenceBridge();

      if (!discordPresence) {
        setDiscordPresenceStatus(null);
        return;
      }

      setDiscordPresenceStatus(await discordPresence.getStatus());
    } catch {
      setDiscordPresenceStatus(null);
    }
  }, []);

  const copyAudioDiagnostics = useCallback(async (): Promise<void> => {
    const audio = getAudioBridge();

    if (!audio?.getDiagnostics) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to copy audio diagnostics.');
      return;
    }

    try {
      const diagnostics = await audio.getDiagnostics();
      await window.navigator.clipboard.writeText(formatAudioDiagnostics(diagnostics));
      setAudioDiagnosticsCopied(true);
      setError(null);
      window.setTimeout(() => setAudioDiagnosticsCopied(false), 1800);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, []);

  const refreshTaskbarPlaybackStatus = useCallback(async () => {
    try {
      const app = getAppBridge();

      if (!app?.getTaskbarPlaybackStatus) {
        setTaskbarPlaybackStatus(null);
        return;
      }

      setTaskbarPlaybackStatus(await app.getTaskbarPlaybackStatus());
    } catch {
      setTaskbarPlaybackStatus(null);
    }
  }, []);

  const refreshSmtcDiagnostics = useCallback(async () => {
    try {
      const smtc = getSmtcBridge();

      if (!smtc?.getDiagnostics) {
        setSmtcDiagnostics(null);
        return;
      }

      setSmtcDiagnostics(await smtc.getDiagnostics());
    } catch {
      setSmtcDiagnostics(null);
    }
  }, []);

  const restartSmtcSupport = useCallback(async () => {
    setSmtcRestarting(true);
    setError(null);
    try {
      const smtc = getSmtcBridge();
      if (typeof smtc?.restart !== 'function') {
        throw new Error('SMTC restart bridge is unavailable.');
      }
      setSmtcDiagnostics(await smtc.restart());
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setSmtcRestarting(false);
    }
  }, []);

  const refreshLastFmStatus = useCallback(async () => {
    try {
      const lastfm = getLastFmBridge();

      if (!lastfm) {
        setLastFmStatus(null);
        return;
      }

      setLastFmStatus(await lastfm.getStatus());
    } catch {
      setLastFmStatus(null);
    }
  }, []);

  const refreshAccountStatuses = useCallback(async () => {
    try {
      const accounts = getAccountsBridge();

      if (!accounts) {
        setAccountStatuses([]);
        return;
      }

      setAccountStatuses(await accounts.getStatuses());
      setAccountErrors({});
      setAccountMessages({});
    } catch (accountError) {
      setAccountErrors((current) => ({
        ...current,
        netease: accountError instanceof Error ? accountError.message : String(accountError),
      }));
    }
  }, []);

  const refreshDuplicateSummary = useCallback(async () => {
    try {
      const library = getLibraryBridge();

      if (!library) {
        setDuplicateSummary(null);
        return;
      }

      setDuplicateSummary(await library.getDuplicateIndexSummary('strict'));
    } catch {
      setDuplicateSummary(null);
    }
  }, []);

  const refreshDatabaseProtectionStatus = useCallback(async (options: { deepCheck?: boolean } = {}) => {
    const library = getLibraryBridge();
    if (!library?.getDatabaseProtectionStatus) {
      setDatabaseProtectionStatus(null);
      return;
    }

    try {
      setDatabaseProtectionStatus(await library.getDatabaseProtectionStatus({ deepCheck: options.deepCheck !== false }));
    } catch (statusError) {
      setDatabaseProtectionStatus(null);
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    }
  }, []);

  const refreshCacheInventory = useCallback(async () => {
    const app = getAppBridge();
    if (!app?.getCacheInventory) {
      setCacheInventory(null);
      return;
    }

    setCacheInventoryBusy(true);
    try {
      setCacheInventory(await app.getCacheInventory());
    } catch {
      setCacheInventory(null);
    } finally {
      setCacheInventoryBusy(false);
    }
  }, []);

  const refreshDataBackupStatus = useCallback(async () => {
    const app = getAppBridge();
    if (!app?.getDataBackupStatus) {
      setDataBackupStatus(null);
      setDataBackupProgress(null);
      return;
    }

    try {
      const status = await app.getDataBackupStatus();
      setDataBackupStatus(status);
      setDataBackupProgress(status.progress);
    } catch {
      setDataBackupStatus(null);
      setDataBackupProgress(null);
    }
  }, []);

  useEffect(() => {
    const app = getAppBridge();
    void app?.getSettings().then((settings) => {
      setAppSettings(settings);
      const customThemes = normalizeThemeCustomThemes(settings.appearanceCustomThemes ?? []);
      const customThemeId = normalizeThemeCustomId(settings.appearanceThemeCustomId ?? null, customThemes);
      const activeCustomTheme = customThemes.find((theme) => theme.id === customThemeId);
      const basePreset = activeCustomTheme?.basePreset ?? settings.appearanceThemePreset ?? defaultThemePreset;
      setThemeCustomThemes(customThemes);
      setActiveThemeCustomId(customThemeId);
      setSelectedThemePreset(basePreset);
      updateThemePreferences(
        settings.appearanceTheme ?? defaultThemeMode,
        basePreset,
        settings.appearanceThemePresetOverrides ?? {},
        { customThemeId, customThemes },
      );
      setThemeCustomDraft(activeCustomTheme?.light ?? settings.appearanceThemePresetOverrides?.[basePreset]?.light ?? {});
      if (settings.appearancePreferences) {
        setAppearancePreferences(updateAppearancePreferences(settings.appearancePreferences));
      }
      setSharedBackend(normalizeAudioSharedBackendForPlatform(settings.rememberedAudioOutput?.sharedBackend ?? 'auto', rendererPlatform));
      setChannelBalanceState(settings.channelBalance ?? defaultSettingsChannelBalance);
    }).catch(() => undefined);
    void app?.getVersion().then(setAppVersion).catch(() => undefined);
    void app?.getUpdateStatus?.().then(setUpdateStatus).catch(() => undefined);
    void app?.getDataBackupStatus?.().then((status) => {
      setDataBackupStatus(status);
      setDataBackupProgress(status.progress);
    }).catch(() => undefined);
    const unsubscribeDataBackupProgress = app?.onDataBackupProgress?.((progress) => {
      setDataBackupProgress(progress);
      setDataBackupStatus((currentStatus) => currentStatus ? { ...currentStatus, running: progress.running, progress } : currentStatus);
      if (!progress.running) {
        void app?.getDataBackupStatus?.().then((status) => {
          setDataBackupStatus(status);
          setDataBackupProgress(status.progress);
        }).catch(() => undefined);
      }
    });
    const unsubscribeUpdateStatus = app?.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      if (status.state === 'downloading' || status.state === 'downloaded') {
        setUpdateBusy(false);
      }
    });

    return () => {
      unsubscribeDataBackupProgress?.();
      unsubscribeUpdateStatus?.();
    };
  }, []);

  useEffect(() => {
    if (activeSection !== 'appearance') {
      return undefined;
    }

    let disposed = false;
    const plugins = getPluginsBridge();
    if (!plugins) {
      setPluginThemeOptions([]);
      return undefined;
    }

    void plugins
      .list()
      .then((result) => {
        if (!disposed) {
          setPluginThemeOptions(collectPluginThemeOptions(result.plugins));
        }
      })
      .catch(() => {
        if (!disposed) {
          setPluginThemeOptions([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'playback' && activeSection !== 'eq') {
      return undefined;
    }

    const cancelInitialRefresh = scheduleSettingsIdleTask(() => {
      void refreshStatus();
      if (activeSection === 'playback') {
        void refreshDevices();
      }
    });
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 2500);

    return () => {
      cancelInitialRefresh();
      window.clearInterval(timer);
    };
  }, [activeSection, refreshDevices, refreshStatus]);

  useEffect(() => {
    if (activeSection !== 'integrations') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      void refreshDiscordPresenceStatus();
      void refreshSmtcDiagnostics();
      void refreshTaskbarPlaybackStatus();
      void refreshLastFmStatus();
      void refreshAccountStatuses();
    });
  }, [activeSection, refreshAccountStatuses, refreshDiscordPresenceStatus, refreshLastFmStatus, refreshSmtcDiagnostics, refreshTaskbarPlaybackStatus]);

  useEffect(() => {
    if (activeSection !== 'library') {
      setLibraryDeferredRefreshReady(false);
      return undefined;
    }

    setLibraryDeferredRefreshReady(false);
    let timeoutId: number | null = null;
    const cancelIdleTask = scheduleSettingsIdleTask(() => {
      timeoutId = window.setTimeout(() => {
        setLibraryDeferredRefreshReady(true);
      }, 1200);
    });

    return () => {
      cancelIdleTask();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'library' || !libraryDeferredRefreshReady) {
      return undefined;
    }

    let cacheInventoryTimer: number | null = null;
    const cancelIdleTask = scheduleSettingsIdleTask(() => {
      void refreshDuplicateSummary();

      if (!libraryHeavyRefreshAllowed) {
        return;
      }

      cacheInventoryTimer = window.setTimeout(() => {
        void refreshCacheInventory();
      }, 900);
    });

    return () => {
      cancelIdleTask();
      if (cacheInventoryTimer !== null) {
        window.clearTimeout(cacheInventoryTimer);
      }
    };
  }, [activeSection, libraryDeferredRefreshReady, libraryHeavyRefreshAllowed, refreshCacheInventory, refreshDuplicateSummary]);

  useEffect(() => {
    if (activeSection !== 'library') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      const app = getAppBridge();
      const downloads = getDownloadsBridge();
      void app?.getDefaultCacheDirectory().then(setDefaultCacheDirectory).catch(() => undefined);
      void downloads?.getSettings().then(setDownloadSettings).catch(() => undefined);
    });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'library') {
      return undefined;
    }

    return subscribeLibraryScanStatuses(setLibraryScanStatuses);
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'library' || libraryScanActiveJobIds.length === 0) {
      return undefined;
    }

    const pollActiveScans = (): void => {
      const library = getLibraryBridge();
      if (!library?.getScanStatus) {
        return;
      }

      for (const jobId of libraryScanActiveJobIds) {
        void Promise.resolve(library.getScanStatus(jobId))
          .then((status) => {
            if (status) {
              rememberLibraryScanStatus(status);
            }
          })
          .catch(() => undefined);
      }
    };

    pollActiveScans();
    const timer = window.setInterval(pollActiveScans, 1000);
    return () => window.clearInterval(timer);
  }, [activeSection, libraryScanActiveJobIds]);

  useEffect(() => {
    if (activeSection !== 'about') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      void getDiagnosticsBridge()?.getLastCrashSummary().then(setLastCrashSummary).catch(() => undefined);
    });
  }, [activeSection]);

  useEffect(() => {
    const releaseNotes = updateStatus?.releaseNotes ?? null;
    if (activeSection !== 'about' || !releaseNotes) {
      setDeferredAboutReleaseNotes(null);
      return undefined;
    }

    if (deferredAboutReleaseNotes === releaseNotes) {
      return undefined;
    }

    setDeferredAboutReleaseNotes(null);
    return scheduleSettingsIdleTask(() => {
      setDeferredAboutReleaseNotes(releaseNotes);
    });
  }, [activeSection, deferredAboutReleaseNotes, updateStatus?.releaseNotes]);

  useEffect(() => {
    if (activeSection !== 'library' || !libraryDeferredRefreshReady || appSettings?.autoFetchArtistImages !== true) {
      return undefined;
    }

    const library = getLibraryBridge();
    if (!library?.getArtistImageJobStatus) {
      return undefined;
    }

    let disposed = false;
    let timer: number | null = null;

    const refreshSummary = async (): Promise<void> => {
      try {
        const status = await library.getArtistImageJobStatus();
        if (disposed) {
          return;
        }

        setArtistImageProgress((current) => ({
          ...status,
          startedAt: current?.startedAt ?? Date.now(),
        }));
      } catch {
        if (!disposed && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      }
    };

    const cancelInitialRefresh = scheduleSettingsIdleTask(() => {
      void refreshSummary();
      timer = window.setInterval(() => {
        void refreshSummary();
      }, 3000);
    });

    return () => {
      disposed = true;
      cancelInitialRefresh();
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [activeSection, appSettings?.autoFetchArtistImages, libraryDeferredRefreshReady]);

  useEffect(() => {
    if (activeSection === 'appearance') {
      const localThemes = readThemeCustomThemes();
      const localCustomId = readThemeCustomId();
      const localCustomTheme = localThemes.find((theme) => theme.id === localCustomId);
      setThemeCustomThemes(localThemes);
      setActiveThemeCustomId(localCustomId);
      setSelectedThemePreset(localCustomTheme?.basePreset ?? readThemePreset());
    }
  }, [activeSection]);

  const savedThemePresetOverrides = useMemo<AppThemePresetOverrides>(
    () => appSettings?.appearanceThemePresetOverrides ?? readThemePresetOverrides(),
    [appSettings?.appearanceThemePresetOverrides],
  );
  const savedThemeCustomThemes = useMemo<AppThemeCustomTheme[]>(
    () => normalizeThemeCustomThemes(appSettings?.appearanceCustomThemes ?? themeCustomThemes),
    [appSettings?.appearanceCustomThemes, themeCustomThemes],
  );
  const savedThemeCustomId = useMemo<string | null>(
    () => normalizeThemeCustomId(appSettings?.appearanceThemeCustomId ?? activeThemeCustomId, savedThemeCustomThemes),
    [activeThemeCustomId, appSettings?.appearanceThemeCustomId, savedThemeCustomThemes],
  );
  const activeThemeCustom = useMemo(
    () => savedThemeCustomThemes.find((theme) => theme.id === savedThemeCustomId),
    [savedThemeCustomId, savedThemeCustomThemes],
  );

  useEffect(() => {
    const pendingCopy = pendingThemeCopyDraftRef.current;
    if (pendingCopy?.tone === themeCustomTone) {
      setThemeCustomDraft(pendingCopy.draft);
      pendingThemeCopyDraftRef.current = null;
      setThemeCustomMessage(null);
      return;
    }

    setThemeCustomDraft(activeThemeCustom?.[themeCustomTone] ?? savedThemePresetOverrides[selectedThemePreset]?.[themeCustomTone] ?? {});
    setThemeCustomMessage(null);
  }, [activeThemeCustom, savedThemePresetOverrides, selectedThemePreset, themeCustomTone]);

  useEffect(() => {
    if (activeSection !== 'appearance') {
      return;
    }
    if (skipNextThemePreviewRef.current) {
      skipNextThemePreviewRef.current = false;
      return;
    }

    const previewOverrides = activeThemeCustom
      ? savedThemePresetOverrides
      : buildThemePresetOverrides(savedThemePresetOverrides, selectedThemePreset, themeCustomTone, themeCustomDraft);
    const previewThemes = activeThemeCustom
      ? updateThemeCustomThemeTone(savedThemeCustomThemes, activeThemeCustom.id, themeCustomTone, themeCustomDraft)
      : savedThemeCustomThemes;
    applyThemeSettings({
      ...(appSettings ?? {}),
      appearanceTheme: appSettings?.appearanceTheme ?? defaultThemeMode,
      appearanceThemePreset: selectedThemePreset,
      appearanceThemePresetOverrides: previewOverrides,
      appearanceCustomThemes: previewThemes,
      appearanceThemeCustomId: activeThemeCustom?.id ?? null,
    }, {
      customThemeId: activeThemeCustom?.id ?? null,
      customThemes: previewThemes,
    });
  }, [activeSection, activeThemeCustom, appSettings?.appearanceTheme, savedThemeCustomThemes, savedThemePresetOverrides, selectedThemePreset, themeCustomDraft, themeCustomTone]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings> | Partial<MvSettings>>).detail;
      if (!patch || typeof patch !== 'object') {
        return;
      }
      const appPatch = normalizeExternalAppSettingsPatch(patch);

      setAppSettings((current) => {
        const nextSettings = current ? { ...current, ...appPatch } : current;
        if (appPatch.appearanceCustomThemes || Object.prototype.hasOwnProperty.call(appPatch, 'appearanceThemeCustomId')) {
          const customThemes = normalizeThemeCustomThemes(nextSettings?.appearanceCustomThemes ?? appPatch.appearanceCustomThemes ?? []);
          const customThemeId = normalizeThemeCustomId(nextSettings?.appearanceThemeCustomId ?? appPatch.appearanceThemeCustomId ?? null, customThemes);
          const activeCustomTheme = customThemes.find((theme) => theme.id === customThemeId);
          setThemeCustomThemes(customThemes);
          setActiveThemeCustomId(customThemeId);
          setSelectedThemePreset(activeCustomTheme?.basePreset ?? nextSettings?.appearanceThemePreset ?? defaultThemePreset);
          updateThemePreferences(
            nextSettings?.appearanceTheme ?? appPatch.appearanceTheme ?? defaultThemeMode,
            activeCustomTheme?.basePreset ?? nextSettings?.appearanceThemePreset ?? appPatch.appearanceThemePreset ?? defaultThemePreset,
            nextSettings?.appearanceThemePresetOverrides ?? appPatch.appearanceThemePresetOverrides ?? {},
            { customThemeId, customThemes },
          );
        } else if (appPatch.appearanceTheme || appPatch.appearanceThemePreset) {
          setSelectedThemePreset(nextSettings?.appearanceThemePreset ?? appPatch.appearanceThemePreset ?? defaultThemePreset);
          updateThemePreferences(
            nextSettings?.appearanceTheme ?? appPatch.appearanceTheme ?? defaultThemeMode,
            nextSettings?.appearanceThemePreset ?? appPatch.appearanceThemePreset ?? defaultThemePreset,
            nextSettings?.appearanceThemePresetOverrides ?? appPatch.appearanceThemePresetOverrides ?? {},
            {
              customThemeId: nextSettings?.appearanceThemeCustomId ?? null,
              customThemes: nextSettings?.appearanceCustomThemes ?? [],
            },
          );
        }
        if (appPatch.appearanceThemePresetOverrides) {
          updateThemePresetOverrides(
            nextSettings?.appearanceThemePresetOverrides ?? appPatch.appearanceThemePresetOverrides,
            nextSettings?.appearanceTheme ?? defaultThemeMode,
            nextSettings?.appearanceThemePreset ?? defaultThemePreset,
            {
              customThemeId: nextSettings?.appearanceThemeCustomId ?? null,
              customThemes: nextSettings?.appearanceCustomThemes ?? [],
            },
          );
        }
        return nextSettings;
      });
      if (appPatch.appearancePreferences) {
        setAppearancePreferences(updateAppearancePreferences(appPatch.appearancePreferences));
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => window.removeEventListener('settings:changed', handleSettingsChanged);
  }, []);

  useEffect(
    () => () => {
      if (wallpaperPersistTimerRef.current !== null) {
        window.clearTimeout(wallpaperPersistTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setOutputMode(status?.outputMode ?? 'shared');
    if (status?.sharedBackend || status?.outputBackend === 'directsound-shared') {
      setSharedBackend(
        normalizeAudioSharedBackendForPlatform(
          status.outputBackend === 'directsound-shared' ? 'directsound' : normalizeSharedBackend(status.sharedBackend),
          rendererPlatform,
        ),
      );
    }
  }, [rendererPlatform, status?.outputBackend, status?.outputMode, status?.sharedBackend]);

  useEffect(() => {
    if (statusSelectedDevice) {
      setSelectedDeviceId(statusSelectedDevice.id);
    }
  }, [statusSelectedDevice]);

  useEffect(() => {
    if (appSettings?.albumMergeStrategy) {
      setPendingAlbumMergeStrategy(appSettings.albumMergeStrategy);
    }
  }, [appSettings?.albumMergeStrategy]);

  useEffect(() => {
    setPendingArtistMergeStrategy(appSettings?.artistMergeStrategy ?? 'standard');
  }, [appSettings?.artistMergeStrategy]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setNetworkProxyDraft({
      mode: appSettings.networkProxyMode ?? 'off',
      proxyUrl: appSettings.networkProxyUrl ?? '',
      pacUrl: appSettings.networkProxyPacUrl ?? '',
      bypassRules: appSettings.networkProxyBypassRules ?? defaultNetworkProxyBypassRules,
    });
  }, [
    appSettings?.networkProxyBypassRules,
    appSettings?.networkProxyMode,
    appSettings?.networkProxyPacUrl,
    appSettings?.networkProxyUrl,
    appSettings,
  ]);

  useEffect(() => {
    const displayName = accountStatusByProvider.youtube?.displayName?.toLowerCase() ?? '';
    const savedBrowser = buildYouTubeBrowserOptions(t).find((option) => option.value !== 'none' && displayName.includes(option.value))?.value;
    if (savedBrowser) {
      setYoutubeBrowser(savedBrowser);
    }
  }, [accountStatusByProvider.youtube?.displayName, t]);

  useEffect(() => {
    if (statusSelectedDevice && compatibleDevices.some((device) => device.id === statusSelectedDevice.id)) {
      return;
    }

    if (compatibleDevices.length === 0) {
      setSelectedDeviceId('');
      return;
    }

    if (!compatibleDevices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(compatibleDevices.find((device) => device.isDefault)?.id ?? compatibleDevices[0].id);
    }
  }, [compatibleDevices, selectedDeviceId, statusSelectedDevice]);

  useEffect(() => {
    if (activeSection !== 'appearance') {
      return undefined;
    }

    const queryLocalFonts = (navigator as NavigatorWithLocalFonts).queryLocalFonts;

    if (!queryLocalFonts) {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      void queryLocalFonts()
        .then((fonts) => {
          const families = Array.from(new Set([...fallbackFontFamilies, ...fonts.map((font) => font.family).filter(Boolean)])).sort((a, b) =>
            a.localeCompare(b),
          );
          setFontFamilies(families);
        })
        .catch(() => {
          setFontFamilies(fallbackFontFamilies);
        });
    });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'danger') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      void refreshDatabaseProtectionStatus({ deepCheck: false });
    });
  }, [activeSection, refreshDatabaseProtectionStatus]);

  const refreshSettingsHorizontalScroll = useCallback((): void => {
    const scrollShell = settingsScrollShellRef.current;
    if (!scrollShell) {
      setSettingsHorizontalScroll({ available: false, canLeft: false, canRight: false });
      return;
    }

    const maxScrollLeft = scrollShell.scrollWidth - scrollShell.clientWidth;
    const nextState = {
      available: maxScrollLeft > 8,
      canLeft: scrollShell.scrollLeft > 4,
      canRight: scrollShell.scrollLeft < maxScrollLeft - 4,
    };

    setSettingsHorizontalScroll((current) =>
      current.available === nextState.available && current.canLeft === nextState.canLeft && current.canRight === nextState.canRight
        ? current
        : nextState,
    );
  }, []);

  useEffect(() => {
    if (activeSection !== 'playback' && activeSection !== 'eq') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      void getEqBridge()?.getChannelBalanceState().then(setChannelBalanceState).catch(() => undefined);
    });
  }, [activeSection]);

  useEffect(() => {
    const scrollShell = settingsScrollShellRef.current;
    if (!scrollShell) {
      return undefined;
    }

    let frameId = window.requestAnimationFrame(refreshSettingsHorizontalScroll);
    const handleScroll = (): void => refreshSettingsHorizontalScroll();
    const handleResize = (): void => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(refreshSettingsHorizontalScroll);
    };

    scrollShell.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            handleResize();
          });

    resizeObserver?.observe(scrollShell);
    if (scrollShell.firstElementChild instanceof HTMLElement) {
      resizeObserver?.observe(scrollShell.firstElementChild);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      scrollShell.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [activeSection, refreshSettingsHorizontalScroll]);

  const handleSettingsHorizontalScroll = (direction: -1 | 1): void => {
    const scrollShell = settingsScrollShellRef.current;
    if (!scrollShell) {
      return;
    }

    const distance = Math.min(Math.max(scrollShell.clientWidth * 0.72, 180), 360);
    scrollShell.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  const applyOutputSettings = useCallback(
    async (nextOutputMode = outputMode, nextDeviceId = selectedDeviceId, nextSharedBackend = sharedBackend) => {
      const nextDevice =
        getCompatiblePlaybackDevices(devices, nextOutputMode).find((device) => device.id === nextDeviceId) ?? null;
      const normalizedSharedBackend = nextOutputMode === 'shared'
        ? normalizeAudioSharedBackendForPlatform(normalizeSharedBackend(nextSharedBackend), rendererPlatform)
        : 'auto';
      const output: AudioOutputSettings = {
        outputMode: nextOutputMode,
        sharedBackend: normalizedSharedBackend,
        latencyProfile: 'lowLatency',
        useJuceOutput: appSettings?.audioUseJuceOutput === true,
        useJuceDecode: appSettings?.audioUseJuceDecode === true,
        dsdOutputMode: appSettings?.audioDsdOutputMode === 'dop' ? 'dop' : 'pcm',
        asioNativeDsdExperimentalEnabled: appSettings?.audioAsioNativeDsdExperimentalEnabled === true,
        asioUnavailableFallbackEnabled: appSettings?.audioAsioUnavailableFallbackEnabled === true,
        exclusiveInstabilityFallbackEnabled: appSettings?.audioExclusiveInstabilityFallbackEnabled === true,
        soxrFallbackEnabled: appSettings?.audioSoxrFallbackEnabled !== false,
      };

      if (nextDevice) {
        if (normalizedSharedBackend !== 'directsound') {
          output.deviceIndex = nextDevice.index;
        }
        output.deviceName = nextDevice.name;
      }

      const audio = getAudioBridge();

      if (!audio) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
        return;
      }

      setStatus(await audio.setOutput(output));
    },
    [
      appSettings?.audioAsioUnavailableFallbackEnabled,
      appSettings?.audioAsioNativeDsdExperimentalEnabled,
      appSettings?.audioExclusiveInstabilityFallbackEnabled,
      appSettings?.audioSoxrFallbackEnabled,
      appSettings?.audioDsdOutputMode,
      appSettings?.audioUseJuceDecode,
      appSettings?.audioUseJuceOutput,
      devices,
      outputMode,
      rendererPlatform,
      selectedDeviceId,
      sharedBackend,
    ],
  );

  const scrollSettingsSectionIntoView = useCallback((key: SettingsNavKey, targetId?: string): void => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (targetId) {
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        const scrollShell = settingsScrollShellRef.current;
        if (!scrollShell) {
          document.getElementById(`settings-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        if (typeof scrollShell.scrollTo === 'function') {
          scrollShell.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } else {
          scrollShell.scrollTop = 0;
          scrollShell.scrollLeft = 0;
        }
      });
    });
  }, []);

  const jumpToSettingsSection = useCallback((key: SettingsNavKey, options: { clearSearch?: boolean; targetId?: string } = {}): void => {
    setActiveSection(key);
    if (isIntegrationCredentialSettingId(options.targetId)) {
      setCredentialPanelExpanded(true);
    }
    if (options.clearSearch) {
      setSettingsQuery('');
    }
    setHighlightedSettingId(options.targetId ?? null);
    scrollSettingsSectionIntoView(key, options.targetId);
  }, [scrollSettingsSectionIntoView]);

  useEffect(() => {
    const handleSettingsEscapeBack = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        document.body.dataset.echoShortcutRecording === 'true' ||
        isImeComposingKeyEvent(event) ||
        event.key !== 'Escape' ||
        isSettingsEscapeBackEditableTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new Event(settingsBackNavigationEvent));
    };

    window.addEventListener('keydown', handleSettingsEscapeBack);
    return () => {
      window.removeEventListener('keydown', handleSettingsEscapeBack);
    };
  }, []);

  useEffect(() => {
    const handleOpenSettingsSection = (event: Event): void => {
      const detail = (event as CustomEvent<{ section?: unknown }>).detail;
      const section = typeof detail?.section === 'string' && settingsNavKeys.has(detail.section as SettingsNavKey)
        ? detail.section as SettingsNavKey
        : 'danger';
      jumpToSettingsSection(section, { clearSearch: true });
    };

    window.addEventListener('settings:open-section', handleOpenSettingsSection);
    return () => {
      window.removeEventListener('settings:open-section', handleOpenSettingsSection);
    };
  }, [jumpToSettingsSection]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setSpotifyAuthDraft({
      clientId: appSettings.spotifyClientId ?? '',
      redirectUri: appSettings.spotifyRedirectUri ?? defaultSpotifyRedirectUri,
    });
  }, [
    appSettings?.spotifyClientId,
    appSettings?.spotifyRedirectUri,
  ]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setTidalAuthDraft({
      clientId: appSettings.tidalClientId ?? '',
      clientSecret: appSettings.tidalClientSecret ?? '',
      redirectUri: appSettings.tidalRedirectUri ?? defaultTidalRedirectUri,
      countryCode: appSettings.tidalCountryCode ?? 'US',
    });
  }, [
    appSettings?.tidalClientId,
    appSettings?.tidalClientSecret,
    appSettings?.tidalCountryCode,
    appSettings?.tidalRedirectUri,
  ]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setOnlineAlbumInfoDraft({
      discogsUserToken: appSettings.onlineAlbumInfoDiscogsUserToken ?? '',
    });
  }, [appSettings?.onlineAlbumInfoDiscogsUserToken]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setOnlineArtistInfoDraft({
      bandsintownAppId: appSettings.onlineArtistInfoBandsintownAppId ?? '',
      ticketmasterApiKey: appSettings.onlineArtistInfoTicketmasterApiKey ?? '',
      seatGeekClientId: appSettings.onlineArtistInfoSeatGeekClientId ?? '',
      region: appSettings.onlineArtistInfoRegion ?? '',
    });
  }, [
    appSettings?.onlineArtistInfoBandsintownAppId,
    appSettings?.onlineArtistInfoRegion,
    appSettings?.onlineArtistInfoSeatGeekClientId,
    appSettings?.onlineArtistInfoTicketmasterApiKey,
  ]);

  const handleNavClick = (key: SettingsNavKey): void => {
    jumpToSettingsSection(key);
  };

  const handleSettingsSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (isImeComposingKeyEvent(event) || event.key !== 'Enter' || settingsSearchResults.length === 0) {
      return;
    }

    event.preventDefault();
    jumpToSettingsSection(settingsSearchResults[0].sectionKey, { clearSearch: true, targetId: settingsSearchResults[0].targetId });
  };

  const handleOutputModeChange = (nextMode: AudioOutputMode): void => {
    setOutputMode(nextMode);
    const nextDevices = getCompatiblePlaybackDevices(devices, nextMode);
    const nextDeviceId = nextDevices.find((device) => device.isDefault)?.id ?? nextDevices[0]?.id ?? '';
    setSelectedDeviceId(nextDeviceId);
    void applyOutputSettings(nextMode, nextDeviceId, nextMode === 'shared' ? sharedBackend : 'auto');
  };

  const handleDeviceChange = (nextDeviceId: string): void => {
    setSelectedDeviceId(nextDeviceId);
    void applyOutputSettings(outputMode, nextDeviceId);
  };

  const handleSharedBackendChange = (nextSharedBackend: AudioSharedBackend): void => {
    setOutputMode('shared');
    setSharedBackend(nextSharedBackend);
    void applyOutputSettings('shared', selectedDeviceId, nextSharedBackend);
  };

  const handleJuceOutputToggle = async (): Promise<void> => {
    const nextUseJuceOutput = appSettings?.audioUseJuceOutput !== true;
    patchAppSettings({ audioUseJuceOutput: nextUseJuceOutput });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ useJuceOutput: nextUseJuceOutput }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleJuceDecodeToggle = async (): Promise<void> => {
    const nextUseJuceDecode = appSettings?.audioUseJuceDecode !== true;
    patchAppSettings({ audioUseJuceDecode: nextUseJuceDecode });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ useJuceDecode: nextUseJuceDecode }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleDsdDopToggle = async (): Promise<void> => {
    const nextEnabled = appSettings?.audioDsdOutputMode !== 'dop';
    const nextDsdOutputMode = nextEnabled ? 'dop' : 'pcm';
    patchAppSettings({
      audioDsdOutputMode: nextDsdOutputMode,
      audioAsioNativeDsdExperimentalEnabled: nextEnabled,
    });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ dsdOutputMode: nextDsdOutputMode, asioNativeDsdExperimentalEnabled: nextEnabled }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleAsioNativeDsdExperimentalToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioAsioNativeDsdExperimentalEnabled ?? false);
    const nextDsdOutputMode = nextEnabled ? 'dop' : 'pcm';
    patchAppSettings({
      audioDsdOutputMode: nextDsdOutputMode,
      audioAsioNativeDsdExperimentalEnabled: nextEnabled,
    });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ dsdOutputMode: nextDsdOutputMode, asioNativeDsdExperimentalEnabled: nextEnabled }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleAsioUnavailableFallbackToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioAsioUnavailableFallbackEnabled ?? false);
    patchAppSettings({ audioAsioUnavailableFallbackEnabled: nextEnabled });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ asioUnavailableFallbackEnabled: nextEnabled }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleExclusiveInstabilityFallbackToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioExclusiveInstabilityFallbackEnabled ?? false);
    patchAppSettings({ audioExclusiveInstabilityFallbackEnabled: nextEnabled });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ exclusiveInstabilityFallbackEnabled: nextEnabled }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleSoxrFallbackToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioSoxrFallbackEnabled ?? true);
    patchAppSettings({ audioSoxrFallbackEnabled: nextEnabled });

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      setStatus(await audio.setOutput({ soxrFallbackEnabled: nextEnabled }));
    } catch (audioError) {
      setError(audioError instanceof Error ? audioError.message : String(audioError));
    }
  };

  const handleAudioEngineReset = async (): Promise<void> => {
    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to reset the audio engine.');
      return;
    }

    setAudioResetBusy(true);
    setAudioResetMessage(null);
    try {
      const nextStatus = await audio.forceRestart('settings-audio-force-restart');
      setStatus(nextStatus);
      setError(null);
      setAudioResetMessage(t('settings.playback.troubleshooting.softDone'));
      void refreshDevices();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setAudioResetBusy(false);
    }
  };

  const handleWindowsAudioServiceRestart = async (): Promise<void> => {
    if (!windowsIntegrationAvailable) {
      return;
    }

    if (!window.confirm(t('settings.playback.troubleshooting.hardConfirm'))) {
      return;
    }

    const audio = getAudioBridge();
    if (!audio) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to restart Windows audio service.');
      return;
    }

    setWindowsAudioRestartBusy(true);
    setAudioResetMessage(null);
    try {
      const nextStatus = await audio.restartWindowsAudioService();
      setStatus(nextStatus);
      setError(null);
      setAudioResetMessage(t('settings.playback.troubleshooting.hardDone'));
      void refreshDevices();
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setWindowsAudioRestartBusy(false);
    }
  };

  const handleAppearanceChange = (nextPreferences: AppearancePreferences): void => {
    setAppearancePreferences(updateAppearancePreferences(nextPreferences));
  };

  const handleAppearanceReset = (): void => {
    handleAppearanceChange(defaultAppearancePreferences);
  };

  const applyThemeSettingsPatch = (patch: Partial<AppSettings>, animate = true): void => {
    applyThemeSettings({ ...(appSettings ?? {}), ...patch }, {
      animate,
      customThemeId: Object.prototype.hasOwnProperty.call(patch, 'appearanceThemeCustomId')
        ? patch.appearanceThemeCustomId ?? null
        : activeThemeCustom?.id ?? appSettings?.appearanceThemeCustomId ?? null,
      customThemes: patch.appearanceCustomThemes ?? savedThemeCustomThemes,
    });
  };

  const handleThemeModeChange = (appearanceTheme: AppThemeMode): void => {
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appearanceTheme, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: activeThemeCustom?.id ?? null,
      customThemes: savedThemeCustomThemes,
    });
    applyThemeSettingsPatch({ appearanceTheme });
    setAppSettings((current) => (current ? { ...current, appearanceTheme } : current));
    patchAppSettings({ appearanceTheme });
  };

  const handleThemeScheduleChange = (patch: Pick<Partial<AppSettings>, 'appearanceThemeScheduleEnabled' | 'appearanceThemeScheduleDarkAt' | 'appearanceThemeScheduleLightAt'>): void => {
    const nextPatch: Partial<AppSettings> = {
      appearanceThemeScheduleDarkAt: appSettings?.appearanceThemeScheduleDarkAt ?? defaultThemeScheduleDarkAt,
      appearanceThemeScheduleLightAt: appSettings?.appearanceThemeScheduleLightAt ?? defaultThemeScheduleLightAt,
      ...patch,
    };
    applyThemeSettingsPatch(nextPatch);
    setAppSettings((current) => (current ? { ...current, ...nextPatch } : current));
    patchAppSettings(nextPatch);
  };

  const handleThemePresetChange = (appearanceThemePreset: AppThemePreset): void => {
    if (appearanceThemePreset === 'FINAL' && !finalThemeUnlocked) {
      return;
    }

    const nextCustomId = activeThemeCustom ? null : savedThemeCustomId;
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, appearanceThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextCustomId,
      customThemes: savedThemeCustomThemes,
    });
    setSelectedThemePreset(appearanceThemePreset);
    setActiveThemeCustomId(nextCustomId);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset,
            appearanceThemeCustomId: nextCustomId,
          }
        : current,
    );
    patchAppSettings(activeThemeCustom ? { appearanceThemePreset, appearanceThemeCustomId: null } : { appearanceThemePreset });
  };

  const themeCustomValues = mergeThemeToneValues(selectedThemePreset, themeCustomTone, themeCustomDraft);
  const themeCustomWarnings = getThemeContrastWarnings(themeCustomValues);
  const selectedThemePresetOption = themePresetOptions.find((option) => option.preset === selectedThemePreset) ?? themePresetOptions[0];
  const visibleThemePresetOptions = useMemo(
    () => finalThemeUnlocked ? themePresetOptions : themePresetOptions.filter((option) => option.preset !== 'FINAL'),
    [finalThemeUnlocked],
  );
  const themePresetsExpanded = appSettings?.appearanceThemePresetsExpanded === true;
  const themeCustomGradientPreview = `linear-gradient(135deg, ${themeCustomValues.appBg} 0%, ${themeCustomValues.appBg2} 52%, ${themeCustomValues.appBg3} 100%)`;

  const updateThemeCustomColor = (field: ThemeColorField, value: string): void => {
    const color = normalizeThemeHexColor(value);
    if (!color) {
      setThemeCustomMessage(t('settings.appearance.themeCustom.message.invalidColor'));
      return;
    }

    setThemeCustomMessage(null);
    setThemeCustomDraft((current) => {
      const next = { ...current };
      if (color === getThemeEditorDefaults(selectedThemePreset, themeCustomTone)[field]) {
        delete next[field];
      } else {
        next[field] = color;
      }
      return next;
    });
  };

  const updateThemeCustomPercent = (field: ThemeNumberField, value: number): void => {
    const spec = numberThemeFields.find((option) => option.field === field);
    if (!spec) {
      return;
    }

    const factor = 1 / (spec.step ?? 1);
    const normalized = Math.round(Math.min(spec.max, Math.max(spec.min, value)) * factor) / factor;
    setThemeCustomMessage(null);
    setThemeCustomDraft((current) => {
      const next = { ...current };
      if (normalized === getThemeEditorDefaults(selectedThemePreset, themeCustomTone)[field]) {
        delete next[field];
      } else {
        next[field] = normalized;
      }
      return next;
    });
  };

  const updateThemeCustomMotionEnabled = (enabled: boolean): void => {
    setThemeCustomMessage(null);
    setThemeCustomDraft((current) => {
      const next = { ...current };
      if (enabled === getThemeEditorDefaults(selectedThemePreset, themeCustomTone).motionEnabled) {
        delete next.motionEnabled;
      } else {
        next.motionEnabled = enabled;
      }
      return next;
    });
  };

  const handleThemeCustomAutoFix = (): void => {
    const backgroundText = bestReadableColor(themeCustomValues.appBg);
    const panelText = bestReadableColor(themeCustomValues.panel);
    const accentText = bestReadableColor(themeCustomValues.accent);
    const darkBackground = getRelativeLuminance(themeCustomValues.appBg) < 0.42;

    setThemeCustomDraft((current) => ({
      ...current,
      heading: backgroundText,
      text: backgroundText,
      muted: darkBackground ? '#c7d1d8' : '#61564d',
      buttonText: panelText,
      onAccent: accentText,
    }));
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.fixed'));
  };

  const handleThemeCustomSave = (): void => {
    const currentTheme = activeThemeCustom;
    const nextThemes = currentTheme
      ? updateThemeCustomThemeTone(savedThemeCustomThemes, currentTheme.id, themeCustomTone, themeCustomDraft)
      : normalizeThemeCustomThemes([...savedThemeCustomThemes, buildThemeCustomTheme(savedThemeCustomThemes, selectedThemePreset, themeCustomTone, themeCustomDraft)]);
    const nextThemeId = currentTheme?.id ?? nextThemes[nextThemes.length - 1]?.id ?? null;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextThemeId,
      customThemes: nextThemes,
    });
    setThemeCustomThemes(nextThemes);
    setActiveThemeCustomId(nextThemeId);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: selectedThemePreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: nextThemeId,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: selectedThemePreset, appearanceCustomThemes: nextThemes, appearanceThemeCustomId: nextThemeId });
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.saved'));
  };

  const handleThemeCustomReset = (): void => {
    setThemeCustomDraft({});
    if (activeThemeCustom) {
      const nextThemes = updateThemeCustomThemeTone(savedThemeCustomThemes, activeThemeCustom.id, themeCustomTone, null);
      updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
        animate: true,
        customThemeId: activeThemeCustom.id,
        customThemes: nextThemes,
      });
      setThemeCustomThemes(nextThemes);
      setAppSettings((current) => (current ? { ...current, appearanceCustomThemes: nextThemes } : current));
      patchAppSettings({ appearanceCustomThemes: nextThemes });
    } else {
      const nextOverrides = buildThemePresetOverrides(savedThemePresetOverrides, selectedThemePreset, themeCustomTone, null);
      updateThemePresetOverrides(nextOverrides, appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, { animate: true });
      setAppSettings((current) => (current ? { ...current, appearanceThemePresetOverrides: nextOverrides } : current));
      patchAppSettings({ appearanceThemePreset: selectedThemePreset, appearanceThemePresetOverrides: nextOverrides });
    }
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.reset'));
  };

  const handleThemeCustomExport = (): void => {
    const payload = createThemeExportPayload(savedThemeCustomThemes, activeThemeCustom, selectedThemePreset, themeCustomTone, themeCustomDraft);
    downloadTextFile(`echo-theme-${payload.theme.name}.echo-theme.json`, `${JSON.stringify(payload, null, 2)}\n`);
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.exported'));
  };

  const handleThemeCustomImport = (): void => {
    const input = document.createElement('input');
    input.accept = '.json,.echo-theme.json,application/json';
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      void file
        .text()
        .then((content) => {
          const parsed = JSON.parse(content) as unknown;
          if (!isThemeExportPayload(parsed)) {
            throw new Error('Invalid theme payload');
          }

          let importedTheme: AppThemeCustomTheme | undefined;
          if (parsed.version === 2 && parsed.schema === 'echo-next.custom-theme') {
            importedTheme = normalizeThemeCustomTheme(parsed.theme);
          } else if (parsed.version === 1 && parsed.schema === 'echo-next.theme-preset') {
            const importedPreset = readThemeExportPreset(parsed.preset);
            if (!importedPreset) {
              throw new Error('Invalid theme preset');
            }
            const normalizedOverrides = normalizeThemePresetOverrides(parsed.overrides);
            const importedOverride = normalizedOverrides[importedPreset];
            importedTheme = normalizeThemeCustomTheme({
              ...buildThemeCustomTheme(savedThemeCustomThemes, importedPreset, themeCustomTone, importedOverride?.[themeCustomTone] ?? {}, '导入主题'),
              light: importedOverride?.light,
              dark: importedOverride?.dark,
            });
          }

          if (!importedTheme) {
            throw new Error('Invalid theme payload');
          }

          const nextThemes = normalizeThemeCustomThemes([...savedThemeCustomThemes.filter((theme) => theme.id !== importedTheme.id), importedTheme]);
          setThemeCustomThemes(nextThemes);
          setActiveThemeCustomId(importedTheme.id);
          setSelectedThemePreset(importedTheme.basePreset);
          setThemeCustomDraft(importedTheme[themeCustomTone] ?? {});
          updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, importedTheme.basePreset, savedThemePresetOverrides, {
            animate: true,
            customThemeId: importedTheme.id,
            customThemes: nextThemes,
          });
          setAppSettings((current) =>
            current
              ? {
                  ...current,
                  appearanceThemePreset: importedTheme.basePreset,
                  appearanceCustomThemes: nextThemes,
                  appearanceThemeCustomId: importedTheme.id,
                }
              : current,
          );
          patchAppSettings({
            appearanceThemePreset: importedTheme.basePreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: importedTheme.id,
          });
          setThemeCustomMessage(t('settings.appearance.themeCustom.message.imported'));
        })
        .catch(() => setThemeCustomMessage(t('settings.appearance.themeCustom.message.importFailed')));
    };
    input.click();
  };

  const handlePluginThemeApply = (pluginTheme: PluginThemeOption): void => {
    const existingTheme = savedThemeCustomThemes.find((theme) => theme.id === pluginTheme.customThemeId);
    const importedTheme = buildPluginThemeCustomTheme(pluginTheme, existingTheme);
    const nextThemes = normalizeThemeCustomThemes([...savedThemeCustomThemes.filter((theme) => theme.id !== importedTheme.id), importedTheme]);

    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, importedTheme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: importedTheme.id,
      customThemes: nextThemes,
    });
    setThemeCustomThemes(nextThemes);
    setActiveThemeCustomId(importedTheme.id);
    setSelectedThemePreset(importedTheme.basePreset);
    setThemeCustomDraft(importedTheme[themeCustomTone] ?? {});
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: importedTheme.basePreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: importedTheme.id,
          }
        : current,
    );
    patchAppSettings({
      appearanceThemePreset: importedTheme.basePreset,
      appearanceCustomThemes: nextThemes,
      appearanceThemeCustomId: importedTheme.id,
    });
    setThemeCustomMessage(`已应用插件主题：${pluginTheme.title}`);
  };

  const handleThemeCustomCreate = (): void => {
    const nextTheme = buildThemeCustomTheme(savedThemeCustomThemes, selectedThemePreset, themeCustomTone, themeCustomDraft);
    const nextThemes = normalizeThemeCustomThemes([...savedThemeCustomThemes, nextTheme]);
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextTheme.id,
      customThemes: nextThemes,
    });
    setThemeCustomThemes(nextThemes);
    setActiveThemeCustomId(nextTheme.id);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: selectedThemePreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: nextTheme.id,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: selectedThemePreset, appearanceCustomThemes: nextThemes, appearanceThemeCustomId: nextTheme.id });
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.created'));
  };

  const handleThemeCustomSelect = (theme: AppThemeCustomTheme): void => {
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, theme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: theme.id,
      customThemes: savedThemeCustomThemes,
    });
    setActiveThemeCustomId(theme.id);
    setSelectedThemePreset(theme.basePreset);
    setThemeCustomDraft(theme[themeCustomTone] ?? {});
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: theme.basePreset,
            appearanceThemeCustomId: theme.id,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: theme.basePreset, appearanceThemeCustomId: theme.id });
  };

  const handleThemeCustomRename = (): void => {
    if (!activeThemeCustom) {
      return;
    }
    const nextName = window.prompt(t('settings.appearance.themeCustom.action.rename'), activeThemeCustom.name);
    if (nextName === null) {
      return;
    }

    const nextThemes = renameThemeCustomTheme(savedThemeCustomThemes, activeThemeCustom.id, nextName);
    setThemeCustomThemes(nextThemes);
    setAppSettings((current) => (current ? { ...current, appearanceCustomThemes: nextThemes } : current));
    patchAppSettings({ appearanceCustomThemes: nextThemes });
  };

  const handleThemeCustomDuplicate = (): void => {
    if (!activeThemeCustom) {
      return;
    }

    const nextThemes = duplicateThemeCustomTheme(savedThemeCustomThemes, activeThemeCustom.id);
    const nextTheme = nextThemes[nextThemes.length - 1];
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, nextTheme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextTheme.id,
      customThemes: nextThemes,
    });
    setThemeCustomThemes(nextThemes);
    setActiveThemeCustomId(nextTheme.id);
    setSelectedThemePreset(nextTheme.basePreset);
    setThemeCustomDraft(nextTheme[themeCustomTone] ?? {});
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: nextTheme.basePreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: nextTheme.id,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: nextTheme.basePreset, appearanceCustomThemes: nextThemes, appearanceThemeCustomId: nextTheme.id });
  };

  const handleThemeCustomDelete = (): void => {
    if (!activeThemeCustom) {
      return;
    }
    if (!window.confirm(t('settings.appearance.themeCustom.action.delete'))) {
      return;
    }

    const fallbackPreset = activeThemeCustom.basePreset;
    const nextThemes = savedThemeCustomThemes.filter((theme) => theme.id !== activeThemeCustom.id);
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, fallbackPreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: null,
      customThemes: nextThemes,
    });
    setThemeCustomThemes(nextThemes);
    setActiveThemeCustomId(null);
    setSelectedThemePreset(fallbackPreset);
    setThemeCustomDraft(savedThemePresetOverrides[fallbackPreset]?.[themeCustomTone] ?? {});
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: fallbackPreset,
            appearanceCustomThemes: nextThemes,
            appearanceThemeCustomId: null,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: fallbackPreset, appearanceCustomThemes: nextThemes, appearanceThemeCustomId: null });
  };

  const handleThemeCustomCopyTone = (fromTone: ThemeTone, toTone: ThemeTone): void => {
    const source = fromTone === themeCustomTone ? themeCustomDraft : activeThemeCustom?.[fromTone] ?? savedThemePresetOverrides[selectedThemePreset]?.[fromTone] ?? {};
    const draft = { ...source };
    pendingThemeCopyDraftRef.current = { draft, tone: toTone };
    setThemeCustomTone(toTone);
    setThemeCustomDraft(draft);
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.copied'));
  };

  const dispatchSettingsChanged = useCallback((patch: Partial<AppSettings> | Partial<MvSettings>): void => {
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: patch }));
  }, []);

  const patchAppSettings = useCallback((patch: Partial<AppSettings>, options: { announce?: boolean; mvSettingsPatch?: Partial<MvSettings> } = {}): void => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save app settings.');
      return;
    }

    void app
      .setSettings(patch)
      .then((settings) => {
        setAppSettings(settings);
        if (Object.prototype.hasOwnProperty.call(patch, 'taskbarPlaybackControlsEnabled')) {
          void refreshTaskbarPlaybackStatus();
        }
        if (
          Object.prototype.hasOwnProperty.call(patch, 'autoDataBackupEnabled') ||
          Object.prototype.hasOwnProperty.call(patch, 'autoDataBackupDirectory') ||
          Object.prototype.hasOwnProperty.call(patch, 'autoDataBackupIntervalDays')
        ) {
          void refreshDataBackupStatus();
        }
        if (options.announce !== false) {
          dispatchSettingsChanged(options.mvSettingsPatch ? { ...settings, ...options.mvSettingsPatch } : settings);
        }
      })
      .catch((settingsError) => {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [dispatchSettingsChanged, refreshDataBackupStatus, refreshTaskbarPlaybackStatus]);

  const handleSidebarRouteDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>, routeId: SidebarRouteId): void => {
    setDraggingSidebarRouteId(routeId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', routeId);
  }, []);

  const handleSidebarRouteDragEnd = useCallback((): void => {
    setDraggingSidebarRouteId(null);
  }, []);

  const handleSidebarRouteDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSidebarRouteDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, targetRouteId: SidebarRouteId, placement: SidebarSettingsRouteItem['placement']): void => {
      event.preventDefault();
      const draggedRouteId = (event.dataTransfer.getData('text/plain') || draggingSidebarRouteId) as SidebarRouteId | null;
      setDraggingSidebarRouteId(null);
      if (!draggedRouteId || draggedRouteId === targetRouteId) {
        return;
      }

      const draggedItem = sidebarSettingsRouteItemById.get(draggedRouteId);
      const targetItem = sidebarSettingsRouteItemById.get(targetRouteId);
      if (!draggedItem || !targetItem || draggedItem.placement !== placement || targetItem.placement !== placement) {
        return;
      }

      const groupIds = sidebarSettingsGroups[placement].map((item) => item.id);
      const draggedIndex = groupIds.indexOf(draggedRouteId);
      const targetIndex = groupIds.indexOf(targetRouteId);
      if (draggedIndex < 0 || targetIndex < 0) {
        return;
      }

      const targetBounds = event.currentTarget.getBoundingClientRect();
      const insertAfterTarget = event.clientY > targetBounds.top + targetBounds.height / 2;
      let targetInsertIndex = targetIndex + (insertAfterTarget ? 1 : 0);
      const nextGroupIds = groupIds.filter((id) => id !== draggedRouteId);
      if (draggedIndex < targetInsertIndex) {
        targetInsertIndex -= 1;
      }
      if (targetInsertIndex === draggedIndex) {
        return;
      }

      nextGroupIds.splice(targetInsertIndex, 0, draggedRouteId);
      const remainingGroupIds = [...nextGroupIds];
      const nextOrder = sidebarRouteOrder.map((routeId) => {
        const routeItem = sidebarSettingsRouteItemById.get(routeId);
        return routeItem?.placement === placement ? remainingGroupIds.shift() ?? routeId : routeId;
      });

      patchAppSettings({
        sidebarRouteOrder: nextOrder,
        sidebarHiddenRouteIds,
      });
    },
    [draggingSidebarRouteId, patchAppSettings, sidebarHiddenRouteIds, sidebarRouteOrder, sidebarSettingsGroups],
  );

  const handleSidebarRouteVisibilityToggle = useCallback(
    (routeId: SidebarRouteId): void => {
      if (lockedVisibleSidebarRouteIdSet.has(routeId)) {
        return;
      }

      const hiddenSet = new Set(sidebarHiddenRouteIds);
      if (hiddenSet.has(routeId)) {
        hiddenSet.delete(routeId);
      } else {
        hiddenSet.add(routeId);
      }

      patchAppSettings({
        sidebarRouteOrder,
        sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds([...hiddenSet]),
      });
    },
    [patchAppSettings, sidebarHiddenRouteIds, sidebarRouteOrder],
  );

  const handleSidebarRoutesReset = useCallback((): void => {
    patchAppSettings({
      sidebarRouteOrder: [...defaultSidebarRouteOrder],
      sidebarHiddenRouteIds: [],
    });
  }, [patchAppSettings]);

  const handleSidebarLayoutToggle = useCallback((): void => {
    patchAppSettings({ appearanceSidebarLayoutExpanded: !sidebarLayoutExpanded });
  }, [patchAppSettings, sidebarLayoutExpanded]);

  const applyMiniPlayerState = useCallback(
    (state: MiniPlayerState): void => {
      setAppSettings((current) => (current ? { ...current, ...state.settings } : current));
      dispatchSettingsChanged(state.settings);
      setError(null);
    },
    [dispatchSettingsChanged],
  );

  const handleMiniPlayerVisibleChange = useCallback(
    async (visible: boolean): Promise<void> => {
      const miniPlayer = window.echo?.miniPlayer;

      if (!miniPlayer) {
        patchAppSettings({ miniPlayerEnabled: visible });
        return;
      }

      try {
        const state = visible ? await miniPlayer.show() : await miniPlayer.hide();
        applyMiniPlayerState(state);
      } catch (miniPlayerError) {
        setError(miniPlayerError instanceof Error ? miniPlayerError.message : String(miniPlayerError));
      }
    },
    [applyMiniPlayerState, patchAppSettings],
  );

  const handleMiniPlayerResetBounds = useCallback(async (): Promise<void> => {
    const miniPlayer = window.echo?.miniPlayer;

    if (!miniPlayer) {
      return;
    }

    try {
      applyMiniPlayerState(await miniPlayer.resetBounds());
    } catch (miniPlayerError) {
      setError(miniPlayerError instanceof Error ? miniPlayerError.message : String(miniPlayerError));
    }
  }, [applyMiniPlayerState]);

  const handleSpotifyAuthConfigSave = useCallback((): void => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save Spotify settings.');
      return;
    }

    const clientId = spotifyAuthDraft.clientId.trim();
    const redirectUri = spotifyAuthDraft.redirectUri.trim();
    if (!isSpotifyClientIdInputValid(clientId)) {
      setSpotifyAuthMessage('请填写你自己的 Spotify Developer App Client ID。');
      return;
    }

    if (!isSpotifyRedirectUriInputValid(redirectUri)) {
      setSpotifyAuthMessage('Redirect URI 必须是 http://127.0.0.1:端口/路径，且不能包含账号、密码、查询参数或 hash。');
      return;
    }

    setSpotifyAuthMessage(null);
    void app
      .setSettings({
        spotifyClientId: clientId,
        spotifyRedirectUri: redirectUri,
      })
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
        setSpotifyAuthMessage('已保存。修改 Spotify OAuth 配置后，请重新登录 Spotify。');
      })
      .catch((settingsError) => {
        setSpotifyAuthMessage(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [dispatchSettingsChanged, spotifyAuthDraft]);

  const handleTidalAuthConfigSave = useCallback((): void => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save TIDAL settings.');
      return;
    }

    const clientId = tidalAuthDraft.clientId.trim();
    const clientSecret = tidalAuthDraft.clientSecret.trim();
    const redirectUri = tidalAuthDraft.redirectUri.trim();
    const countryCode = tidalAuthDraft.countryCode.trim().toUpperCase();
    if (!isTidalClientIdInputValid(clientId)) {
      setTidalAuthMessage('Please fill a valid TIDAL Developer App Client ID.');
      return;
    }

    if (!isTidalClientSecretInputValid(clientSecret)) {
      setTidalAuthMessage('Please fill your TIDAL Developer App Client Secret.');
      return;
    }

    if (!isSpotifyRedirectUriInputValid(redirectUri)) {
      setTidalAuthMessage('Redirect URI must be an http://127.0.0.1:PORT/path loopback URL.');
      return;
    }

    if (!isTidalCountryCodeInputValid(countryCode)) {
      setTidalAuthMessage('Country Code must be a two-letter code such as US, HK, or JP.');
      return;
    }

    setTidalAuthMessage(null);
    void app
      .setSettings({
        tidalClientId: clientId,
        tidalClientSecret: clientSecret,
        tidalRedirectUri: redirectUri,
        tidalCountryCode: countryCode,
      })
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
        setTidalAuthMessage('Saved. TIDAL catalog search now uses your custom developer credentials.');
      })
      .catch((settingsError) => {
        setTidalAuthMessage(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [dispatchSettingsChanged, tidalAuthDraft]);

  const handleNetworkProxySave = useCallback((): void => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save proxy settings.');
      return;
    }

    if (networkProxyDraft.mode === 'manual' && networkProxyDraft.proxyUrl.trim().length === 0) {
      setNetworkProxyTestResult({
        ok: false,
        mode: networkProxyDraft.mode,
        message: '请先填写手动代理地址。',
        resolvedProxy: null,
        status: null,
        elapsedMs: 0,
      });
      return;
    }

    if (networkProxyDraft.mode === 'pac' && networkProxyDraft.pacUrl.trim().length === 0) {
      setNetworkProxyTestResult({
        ok: false,
        mode: networkProxyDraft.mode,
        message: '请先填写 PAC 地址。',
        resolvedProxy: null,
        status: null,
        elapsedMs: 0,
      });
      return;
    }

    setNetworkProxyBusy('save');
    setNetworkProxyTestResult(null);
    void app
      .setSettings({
        networkProxyMode: networkProxyDraft.mode,
        networkProxyUrl: networkProxyDraft.proxyUrl.trim() || null,
        networkProxyPacUrl: networkProxyDraft.pacUrl.trim() || null,
        networkProxyBypassRules: networkProxyDraft.bypassRules.trim() || defaultNetworkProxyBypassRules,
      })
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
        setNetworkProxyTestResult({
          ok: true,
          mode: settings.networkProxyMode ?? 'off',
          message: '代理设置已保存并应用。',
          resolvedProxy: null,
          status: null,
          elapsedMs: 0,
        });
      })
      .catch((proxyError) => {
        const message = proxyError instanceof Error ? proxyError.message : String(proxyError);
        setError(message);
        setNetworkProxyTestResult({
          ok: false,
          mode: networkProxyDraft.mode,
          message,
          resolvedProxy: null,
          status: null,
          elapsedMs: 0,
        });
      })
      .finally(() => setNetworkProxyBusy(null));
  }, [dispatchSettingsChanged, networkProxyDraft]);

  const handleNetworkProxyTest = useCallback((): void => {
    const app = getAppBridge();

    if (!app?.testNetworkProxy) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to test proxy settings.');
      return;
    }

    if (networkProxyDraft.mode === 'manual' && networkProxyDraft.proxyUrl.trim().length === 0) {
      setNetworkProxyTestResult({
        ok: false,
        mode: networkProxyDraft.mode,
        message: '请先填写手动代理地址。',
        resolvedProxy: null,
        status: null,
        elapsedMs: 0,
      });
      return;
    }

    if (networkProxyDraft.mode === 'pac' && networkProxyDraft.pacUrl.trim().length === 0) {
      setNetworkProxyTestResult({
        ok: false,
        mode: networkProxyDraft.mode,
        message: '请先填写 PAC 地址。',
        resolvedProxy: null,
        status: null,
        elapsedMs: 0,
      });
      return;
    }

    setNetworkProxyBusy('test');
    setNetworkProxyTestResult(null);
    void app
      .testNetworkProxy({
        networkProxyMode: networkProxyDraft.mode,
        networkProxyUrl: networkProxyDraft.proxyUrl.trim() || null,
        networkProxyPacUrl: networkProxyDraft.pacUrl.trim() || null,
        networkProxyBypassRules: networkProxyDraft.bypassRules.trim() || defaultNetworkProxyBypassRules,
      })
      .then((result) => setNetworkProxyTestResult(result))
      .catch((proxyError) => {
        setNetworkProxyTestResult({
          ok: false,
          mode: networkProxyDraft.mode,
          message: proxyError instanceof Error ? proxyError.message : String(proxyError),
          resolvedProxy: null,
          status: null,
          elapsedMs: 0,
        });
      })
      .finally(() => setNetworkProxyBusy(null));
  }, [networkProxyDraft]);

  const togglePlaybackAdvancedPanelExpanded = useCallback((): void => {
    setPlaybackAdvancedPanelExpanded((expanded) => {
      const next = !expanded;
      try {
        window.localStorage.setItem(playbackAdvancedPanelExpandedStorageKey, next ? 'true' : 'false');
      } catch {
        // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  const toggleAccountPanelExpanded = useCallback((): void => {
    setAccountPanelExpanded((expanded) => {
      const next = !expanded;
      try {
        window.localStorage.setItem(integrationsAccountPanelExpandedStorageKey, next ? 'true' : 'false');
      } catch {
        // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  const toggleCredentialPanelExpanded = useCallback((): void => {
    setCredentialPanelExpanded((expanded) => {
      const next = !expanded;
      try {
        window.localStorage.setItem(integrationsCredentialPanelExpandedStorageKey, next ? 'true' : 'false');
      } catch {
        // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  const handleOnlineAlbumInfoSave = useCallback((): void => {
    const patch: Partial<AppSettings> = {
      onlineAlbumInfoDiscogsUserToken: onlineAlbumInfoDraft.discogsUserToken.trim() || null,
    };

    setOnlineAlbumInfoBusyAction('save');
    setOnlineAlbumInfoMessage('正在保存 Discogs 专辑评分配置...');
    const app = getAppBridge();
    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save Discogs settings.');
      setOnlineAlbumInfoBusyAction(null);
      setOnlineAlbumInfoMessage(null);
      return;
    }

    void app
      .setSettings(patch)
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
        setOnlineAlbumInfoMessage('Discogs token 已保存。回到专辑页点“刷新在线信息”即可重拉评分。');
      })
      .catch((settingsError) => {
        const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
        setError(message);
        setOnlineAlbumInfoMessage(message);
      })
      .finally(() => setOnlineAlbumInfoBusyAction(null));
  }, [dispatchSettingsChanged, onlineAlbumInfoDraft.discogsUserToken]);

  const handleOnlineArtistInfoSave = useCallback((): void => {
    const patch: Partial<AppSettings> = {
      onlineArtistInfoBandsintownAppId: onlineArtistInfoDraft.bandsintownAppId.trim() || null,
      onlineArtistInfoTicketmasterApiKey: onlineArtistInfoDraft.ticketmasterApiKey.trim() || null,
      onlineArtistInfoSeatGeekClientId: onlineArtistInfoDraft.seatGeekClientId.trim() || null,
      onlineArtistInfoRegion: onlineArtistInfoDraft.region.trim() || null,
    };

    setOnlineArtistInfoBusyAction('save');
    setOnlineArtistInfoMessage('正在保存在线歌手信息配置...');
    const app = getAppBridge();
    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save artist info settings.');
      setOnlineArtistInfoBusyAction(null);
      setOnlineArtistInfoMessage(null);
      return;
    }

    void app
      .setSettings(patch)
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
        setOnlineArtistInfoMessage('在线歌手信息配置已保存。艺人页会按需后台加载简介和演出。');
      })
      .catch((settingsError) => {
        const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
        setError(message);
        setOnlineArtistInfoMessage(message);
      })
      .finally(() => setOnlineArtistInfoBusyAction(null));
  }, [dispatchSettingsChanged, onlineArtistInfoDraft]);

  const handleArtistOnlineInfoSourceSelect = useCallback((source: ArtistOnlineInfoSource): void => {
    patchAppSettings({ onlineArtistInfoSources: [source] });
  }, [patchAppSettings]);

  const handleClearArtistOnlineInfoCache = useCallback((): void => {
    const library = getLibraryBridge();

    if (!library?.clearArtistOnlineInfoCache) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to clear artist online info cache.');
      return;
    }

    setOnlineArtistInfoBusyAction('clear');
    setOnlineArtistInfoMessage(null);
    void library
      .clearArtistOnlineInfoCache()
      .then((result) => {
        setOnlineArtistInfoMessage(`已清理 ${result.removedRows} 条在线歌手信息和演出缓存。`);
        window.dispatchEvent(new Event('library:changed'));
      })
      .catch((clearError) => {
        const message = clearError instanceof Error ? clearError.message : String(clearError);
        setError(message);
        setOnlineArtistInfoMessage(message);
      })
      .finally(() => setOnlineArtistInfoBusyAction(null));
  }, []);

  const handleMonoAudioToggle = useCallback((enabled: boolean): void => {
    const eq = getEqBridge();

    if (!eq) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change mono audio.');
      return;
    }

    const nextPatch: Partial<ChannelBalanceState> = enabled
      ? { enabled: true, monoMode: 'sum' }
      : { enabled: hasNonMonoChannelBalanceEffect(channelBalanceState), monoMode: 'off' };

    void eq
      .setChannelBalanceState(nextPatch)
      .then((state) => {
        setChannelBalanceState(state);
        setAppSettings((current) => (current ? { ...current, channelBalance: state } : current));
        dispatchSettingsChanged({ channelBalance: state });
        void refreshStatus();
      })
      .catch((monoError) => {
        setError(monoError instanceof Error ? monoError.message : String(monoError));
      });
  }, [channelBalanceState, dispatchSettingsChanged, refreshStatus]);

  const mvQualityLabels = useMemo<Record<MvSettings['maxQuality'], string>>(
    () => ({
      '720p': '720p',
      '1080p': '1080p',
      '1440p': '1440p',
      '2160p': '4K',
      max: t('mvSettings.quality.max'),
    }),
    [t],
  );
  const mvProviderOrder = useMemo(() => normalizeMvProviderOrder(appSettings?.mvProviderOrder), [appSettings?.mvProviderOrder]);
  const mvEnabledProviders = useMemo(() => new Set(appSettings?.mvEnabledProviders ?? mvNetworkProviders), [appSettings?.mvEnabledProviders]);
  const taskbarPlaybackLabel = useMemo(() => {
    if (!taskbarPlaybackStatus) {
      return '未检测';
    }
    if (!taskbarPlaybackStatus.supported) {
      return '非 Windows';
    }
    if (!taskbarPlaybackStatus.bound || !taskbarPlaybackStatus.windowAvailable) {
      return '未绑定窗口';
    }
    if (!taskbarPlaybackStatus.enabled) {
      return '已关闭';
    }
    if (taskbarPlaybackStatus.lastError) {
      return `异常: ${taskbarPlaybackStatus.lastError}`;
    }
    if (!taskbarPlaybackStatus.visible) {
      return taskbarPlaybackStatus.playbackState ? `等待播放 (${taskbarPlaybackStatus.playbackState})` : '等待播放';
    }

    const progress =
      typeof taskbarPlaybackStatus.progress === 'number' ? ` ${Math.round(taskbarPlaybackStatus.progress * 100)}%` : '';
    return `已应用${progress}`;
  }, [taskbarPlaybackStatus]);

  const patchMvSettings = useCallback(
    (patch: Partial<MvSettings>): void => {
      patchAppSettings(appSettingsPatchFromMvSettingsPatch(patch), { mvSettingsPatch: patch });
    },
    [patchAppSettings],
  );

  const handleMvProviderToggle = useCallback(
    (provider: NetworkMvProviderId): void => {
      const current = appSettings?.mvEnabledProviders ?? mvNetworkProviders;
      const next = current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider];
      patchMvSettings({ enabledProviders: next });
    },
    [appSettings?.mvEnabledProviders, patchMvSettings],
  );

  const handleMvProviderMove = useCallback(
    (provider: NetworkMvProviderId, direction: -1 | 1): void => {
      const current = normalizeMvProviderOrder(appSettings?.mvProviderOrder);
      const index = current.indexOf(provider);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      if (!item) {
        return;
      }
      next.splice(targetIndex, 0, item);
      patchMvSettings({ providerOrder: next });
    },
    [appSettings?.mvProviderOrder, patchMvSettings],
  );

  const handleCheckForUpdates = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.checkForUpdates) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to check for updates.');
      return;
    }

    setUpdateBusy(true);
    try {
      setUpdateStatus(await app.checkForUpdates());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleOpenRepository = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.openRepository) {
      window.open('https://github.com/moekotori/echo', '_blank', 'noopener,noreferrer');
      return;
    }

    await app.openRepository();
  };

  const handleOpenExternalUrl = async (url: string): Promise<void> => {
    const app = getAppBridge();

    if (!app?.openExternalUrl) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    await app.openExternalUrl(url);
  };

  const handleOpenPluginsPage = (): void => {
    window.dispatchEvent(new Event('app:navigate:plugins'));
  };

  const handleOpenDspPage = (): void => {
    window.dispatchEvent(new Event('app:navigate:dsp'));
  };

  const handleOpenPluginDirectory = async (): Promise<void> => {
    const plugins = getPluginsBridge();

    if (!plugins) {
      setPluginSettingsMessage('插件桥接不可用，请在 ECHO Next 桌面端打开。');
      return;
    }

    try {
      await plugins.openDirectory();
      setPluginSettingsMessage('已打开插件目录。');
    } catch (pluginError) {
      setPluginSettingsMessage(pluginError instanceof Error ? pluginError.message : String(pluginError));
    }
  };

  const handleCreatePlaybackPanelExample = async (): Promise<void> => {
    const plugins = getPluginsBridge();

    if (!plugins) {
      setPluginSettingsMessage('插件桥接不可用，请在 ECHO Next 桌面端打开。');
      return;
    }

    try {
      await plugins.createExample('playback-panel');
      setPluginSettingsMessage('已创建播放状态面板示例，可前往插件页启用或重载。');
    } catch (pluginError) {
      setPluginSettingsMessage(pluginError instanceof Error ? pluginError.message : String(pluginError));
    }
  };

  const previewAndPersistAppWallpaperSettings = (patch: Partial<AppSettings>): void => {
    setAppSettings((current) => (current ? { ...current, ...patch } : current));
    dispatchSettingsChanged(patch);

    if (wallpaperPersistTimerRef.current !== null) {
      window.clearTimeout(wallpaperPersistTimerRef.current);
    }

    wallpaperPersistTimerRef.current = window.setTimeout(() => {
      wallpaperPersistTimerRef.current = null;
      patchAppSettings(patch, { announce: false });
    }, 220);
  };

  const handleAppWallpaperChoose = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.chooseAppWallpaper) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to choose app wallpaper.');
      return;
    }

    try {
      const wallpaperPath = await app.chooseAppWallpaper();
      if (!wallpaperPath) {
        return;
      }

      const mediaType = inferAppWallpaperMediaType(wallpaperPath);
      patchAppSettings({
        appCustomWallpaperPath: wallpaperPath,
        appWallpaperMediaType: mediaType,
        ...(mediaType === 'video' ? { appVideoWallpaperPauseMode: 'never' } : {}),
      });
      setError(null);
    } catch (wallpaperError) {
      setError(wallpaperError instanceof Error ? wallpaperError.message : String(wallpaperError));
    }
  };

  const handleAppWallpaperClear = (): void => {
    patchAppSettings({ appCustomWallpaperPath: null, appWallpaperMediaType: 'image' });
  };

  const handleAppPortraitWallpaperChoose = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.chooseAppWallpaper) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to choose app wallpaper.');
      return;
    }

    try {
      const wallpaperPath = await app.chooseAppWallpaper();
      if (!wallpaperPath) {
        return;
      }

      const mediaType = inferAppWallpaperMediaType(wallpaperPath);
      patchAppSettings({
        appPortraitWallpaperPath: wallpaperPath,
        appPortraitWallpaperMediaType: mediaType,
        ...(mediaType === 'video' ? { appVideoWallpaperPauseMode: 'never' } : {}),
      });
      setError(null);
    } catch (wallpaperError) {
      setError(wallpaperError instanceof Error ? wallpaperError.message : String(wallpaperError));
    }
  };

  const handleAppPortraitWallpaperClear = (): void => {
    patchAppSettings({ appPortraitWallpaperPath: null, appPortraitWallpaperMediaType: 'image' });
  };

  const handleDiscordPresenceToggle = async (): Promise<void> => {
    const discordPresence = getDiscordPresenceBridge();

    if (!discordPresence) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change Discord Rich Presence.');
      return;
    }

    try {
      setError(null);
      const nextEnabled = !(discordPresenceStatus?.enabled ?? appSettings?.discordRichPresenceEnabled ?? false);
      const nextStatus = await discordPresence.setEnabled(nextEnabled);
      setDiscordPresenceStatus(nextStatus);
      setAppSettings((current) => (current ? { ...current, discordRichPresenceEnabled: nextStatus.enabled } : current));
    } catch (presenceError) {
      setError(presenceError instanceof Error ? presenceError.message : String(presenceError));
    }
  };

  const handleLastFmToggle = async (): Promise<void> => {
    const lastfm = getLastFmBridge();

    if (!lastfm) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change Last.fm settings.');
      return;
    }

    try {
      setError(null);
      const nextEnabled = !(lastFmStatus?.enabled ?? appSettings?.lastFmEnabled ?? false);
      const nextStatus = await lastfm.setEnabled(nextEnabled);
      setLastFmStatus(nextStatus);
      setAppSettings((current) => (current ? { ...current, lastFmEnabled: nextStatus.enabled } : current));
    } catch (lastFmError) {
      setError(lastFmError instanceof Error ? lastFmError.message : String(lastFmError));
    }
  };

  const handleLastFmNowPlayingToggle = async (): Promise<void> => {
    const lastfm = getLastFmBridge();

    if (!lastfm) {
      return;
    }

    const nextStatus = await lastfm.setNowPlayingEnabled(!(lastFmStatus?.nowPlayingEnabled ?? true));
    setLastFmStatus(nextStatus);
  };

  const handleLastFmScrobbleToggle = async (): Promise<void> => {
    const lastfm = getLastFmBridge();

    if (!lastfm) {
      return;
    }

    const nextStatus = await lastfm.setScrobbleEnabled(!(lastFmStatus?.scrobbleEnabled ?? true));
    setLastFmStatus(nextStatus);
  };

  const handleLastFmConnect = async (): Promise<void> => {
    const lastfm = getLastFmBridge();

    if (!lastfm) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to connect Last.fm.');
      return;
    }

    try {
      setError(null);
      const result = await lastfm.createAuthToken();
      if (!result.ok || !result.token) {
        setError(result.error ?? 'Unable to start Last.fm authorization.');
        return;
      }

      setLastFmAuthToken(result.token);
      await lastfm.openAuthUrl(result.token);
      void refreshLastFmStatus();
    } catch (lastFmError) {
      setError(lastFmError instanceof Error ? lastFmError.message : String(lastFmError));
    }
  };

  const handleLastFmCompleteAuth = async (): Promise<void> => {
    const lastfm = getLastFmBridge();
    const token = lastFmAuthToken ?? appSettings?.lastFmAuthToken ?? '';

    if (!lastfm) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to complete Last.fm authorization.');
      return;
    }

    if (!token && !lastFmStatus?.authPending) {
      setError('Start Last.fm authorization first, then click complete after allowing access in the browser.');
      return;
    }

    try {
      setError(null);
      const nextStatus = await lastfm.completeAuth(token);
      setLastFmStatus(nextStatus);
      setLastFmAuthToken(null);
      setAppSettings((current) =>
        current
          ? {
              ...current,
              lastFmEnabled: nextStatus.enabled,
              lastFmUsername: nextStatus.username,
              lastFmAuthToken: null,
            }
          : current,
      );
      if (!nextStatus.connected) {
        setError(nextStatus.lastError ?? 'Last.fm authorization did not complete. Click Connect Last.fm again, allow access, then click Complete authorization.');
      }
    } catch (lastFmError) {
      setError(lastFmError instanceof Error ? lastFmError.message : String(lastFmError));
    }
  };

  const handleLastFmDisconnect = async (): Promise<void> => {
    const lastfm = getLastFmBridge();

    if (!lastfm) {
      return;
    }

    const nextStatus = await lastfm.disconnect();
    setLastFmStatus(nextStatus);
    setLastFmAuthToken(null);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            lastFmUsername: null,
            lastFmSessionKey: null,
            lastFmAuthToken: null,
          }
        : current,
    );
  };

  const setAccountBusyFor = (provider: AccountProvider, action: AccountBusyAction | null): void => {
    setAccountBusy((current) => ({ ...current, [provider]: action ?? undefined }));
  };

  const updateAccountStatus = (status: AccountStatus): void => {
    setAccountStatuses((current) => {
      const withoutProvider = current.filter((item) => item.provider !== status.provider);
      return [...withoutProvider, status];
    });
  };

  const handleAccountSaveCookie = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();
    const cookie = accountCookies[provider].trim();

    if (!accounts) {
      setAccountErrors((current) => ({ ...current, [provider]: 'Desktop bridge unavailable. Open ECHO Next in Electron to save accounts.' }));
      return;
    }

    if (!cookie) {
      setAccountErrors((current) => ({ ...current, [provider]: '请先粘贴 Cookie；或使用“登录并同步”自动保存登录 Cookie。' }));
      return;
    }

    try {
      setAccountBusyFor(provider, 'save');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: null }));
      const status = await accounts.saveCookie(provider, cookie);
      updateAccountStatus(status);
      setAccountCookies((current) => ({ ...current, [provider]: '' }));
      setAccountMessages((current) => ({ ...current, [provider]: 'Cookie 已保存，账号状态已更新。' }));
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, [provider]: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor(provider, null);
    }
  };

  const handleAccountCheck = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();

    if (!accounts) {
      return;
    }

    if (provider !== 'spotify' && provider !== 'tidal' && !accountStatusByProvider[provider]?.connected && accountCookies[provider].trim().length === 0) {
      setAccountErrors((current) => ({ ...current, [provider]: '尚未保存 Cookie。请先使用“登录并同步”自动保存，或手动粘贴 Cookie 后保存。' }));
      return;
    }

    try {
      setAccountBusyFor(provider, 'check');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: null }));
      updateAccountStatus(await accounts.check(provider));
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, [provider]: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor(provider, null);
    }
  };

  const handleAccountClear = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();

    if (!accounts) {
      return;
    }

    try {
      setAccountBusyFor(provider, 'clear');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: null }));
      updateAccountStatus(await accounts.clear(provider));
      if (provider === 'youtube') {
        setYoutubeBrowser('none');
      }
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, [provider]: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor(provider, null);
    }
  };

  const handleYouTubeBrowserChange = async (browser: YouTubeBrowser): Promise<void> => {
    const accounts = getAccountsBridge();
    setYoutubeBrowser(browser);

    if (!accounts) {
      return;
    }

    try {
      setAccountBusyFor('youtube', 'browser');
      setAccountErrors((current) => ({ ...current, youtube: null }));
      setAccountMessages((current) => ({ ...current, youtube: browser === 'none' ? null : `${browser} 浏览器登录状态已保存。` }));
      updateAccountStatus(await accounts.setYouTubeBrowser(browser));
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, youtube: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor('youtube', null);
    }
  };

  const handleAccountOpenLogin = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();

    if (!accounts) {
      setAccountErrors((current) => ({ ...current, [provider]: 'Desktop bridge unavailable. Open ECHO Next in Electron to sign in.' }));
      return;
    }

    if (provider === 'youtube') {
      if (youtubeBrowser === 'none') {
        setAccountErrors((current) => ({ ...current, youtube: '请先选择 Edge、Chrome 或 Firefox。' }));
        return;
      }

      try {
        setAccountBusyFor('youtube', 'login');
        setAccountErrors((current) => ({ ...current, youtube: null }));
        const status = await accounts.setYouTubeBrowser(youtubeBrowser);
        const result = typeof accounts.startLogin === 'function'
          ? await accounts.startLogin('youtube')
          : null;
        if (!result) {
          await handleOpenExternalUrl('https://www.youtube.com/');
        }
        updateAccountStatus(result?.status ?? status);
        setAccountMessages((current) => ({
          ...current,
          youtube: result?.message ?? '已打开系统浏览器。ECHO 会让 yt-dlp 读取所选浏览器 Cookie，不会打开 Electron 登录窗口。',
        }));
      } catch (accountError) {
        setAccountErrors((current) => ({ ...current, youtube: accountError instanceof Error ? accountError.message : String(accountError) }));
      } finally {
        setAccountBusyFor('youtube', null);
      }
      return;
    }

    if (typeof accounts.startLogin !== 'function') {
      window.open(accountLoginUrls[provider], '_blank', 'noopener,noreferrer');
      setAccountErrors((current) => ({
        ...current,
        [provider]: '当前桌面桥接还是旧版本，自动同步登录不可用。请重启 ECHO Next 后再点“登录并同步”。',
      }));
      setAccountMessages((current) => ({
        ...current,
        [provider]: '已先打开网页登录页；重启 ECHO 后会启用自动同步登录窗口。',
      }));
      return;
    }

    try {
      setAccountBusyFor(provider, 'login');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: '登录窗口已打开。登录完成后关闭窗口，ECHO 会自动同步。' }));
      const result = await accounts.startLogin(provider);
      updateAccountStatus(result.status);
      setAccountMessages((current) => ({ ...current, [provider]: result.message }));
      if (!result.saved) {
        setAccountErrors((current) => ({ ...current, [provider]: result.message }));
      }
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, [provider]: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor(provider, null);
    }
  };

  const handleDiagnosticsExport = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to export diagnostics.');
        return;
      }

      setDiagnosticsBusy(true);
      setDiagnosticsMessage(null);
      const exportedPath = await diagnostics.exportDiagnostics();
      setDiagnosticsMessage(`Markdown 报告已导出：${exportedPath}`);
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const handleDiagnosticsExportZip = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics?.exportDiagnosticsZip) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to export diagnostics.');
        return;
      }

      setDiagnosticsBusy(true);
      setDiagnosticsMessage(null);
      const exportedPath = await diagnostics.exportDiagnosticsZip();
      setDiagnosticsMessage(`诊断包已导出：${exportedPath}`);
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const handleDiagnosticsOpenFolder = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to open diagnostics.');
        return;
      }

      await diagnostics.openDiagnosticsFolder();
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    }
  };

  const handleDiagnosticsOpenCrashReport = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to view crash reports.');
        return;
      }

      const openedPath = await diagnostics.openCrashReport();
      setDiagnosticsMessage(`崩溃报告：${openedPath}`);
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    }
  };

  const handleDiagnosticsOpenAudioCrashReport = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to view audio crash reports.');
        return;
      }

      const openedPath = await diagnostics.openAudioCrashReport();
      setDiagnosticsMessage(`音频报告：${openedPath}`);
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    }
  };

  const handleDiagnosticsOpenDevConsole = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics?.openDevConsole) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to view the debug console.');
        return;
      }

      await diagnostics.openDevConsole();
      setDevConsoleMessage('控制台已打开：实时显示主进程 stdout/stderr 和渲染器 console。');
    } catch (diagnosticsError) {
      setDevConsoleMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    }
  };

  const handleDiagnosticsClearSummary = async (): Promise<void> => {
    try {
      const diagnostics = getDiagnosticsBridge();

      if (!diagnostics) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to clear diagnostics.');
        return;
      }

      await diagnostics.clearLastCrashSummary();
      setLastCrashSummary(null);
      setDiagnosticsMessage('已清除上次异常退出提示。');
    } catch (diagnosticsError) {
      setDiagnosticsMessage(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    }
  };

  const currentCacheDirectory = appSettings?.coverCacheDir ?? defaultCacheDirectory ?? '';
  const currentCacheDirectoryLabel = appSettings?.coverCacheDir
    ? appSettings.coverCacheDir
    : defaultCacheDirectory
      ? `默认：${defaultCacheDirectory}`
      : '默认目录读取中';
  const pendingResolvedCacheDirectory =
    pendingCacheDirectory === undefined ? null : pendingCacheDirectory ?? defaultCacheDirectory;
  const currentDownloadDirectoryLabel = downloadSettings?.outputDirectory ?? '尚未选择下载文件夹';
  const downloadsFeatureUnlocked = appSettings?.downloadsFeatureUnlocked === true;
  const networkMetadataEnabled = appSettings?.networkMetadataEnabled ?? true;
  const lyricsBackfillAutoAcceptScore = appSettings?.lyricsBackfillAutoAcceptScore ?? 0.45;
  const lyricsBackfillAutoAcceptPercent = Math.round(lyricsBackfillAutoAcceptScore * 100);

  const handleDownloadFeatureUnlock = (): void => {
    if (!isDownloadFeatureUnlockCode(downloadUnlockInput)) {
      setDownloadUnlockMessage('Key not accepted.');
      return;
    }

    setDownloadUnlockMessage('Key accepted.');
    setDownloadUnlockInput('');
    patchAppSettings({ downloadsFeatureUnlocked: true });
  };

  const handleDownloadFeatureRelease = (): void => {
    setDownloadUnlockInput('');
    setDownloadUnlockMessage(null);
    patchAppSettings({ downloadsFeatureUnlocked: false, streamingDownloadActionsEnabled: false });
  };

  const handleDownloadUnlockKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (!isImeComposingKeyEvent(event) && event.key === 'Enter') {
      handleDownloadFeatureUnlock();
    }
  };
  const updateDownloadPercent = Math.max(0, Math.min(100, Math.round(updateStatus?.downloadPercent ?? 0)));
  const showUpdateDownloadProgress = updateStatus?.state === 'downloading' || updateStatus?.state === 'downloaded';
  const updateDownloadSizeLabel =
    updateStatus?.transferredBytes && updateStatus.totalBytes
      ? `${formatUpdateBytes(updateStatus.transferredBytes)} / ${formatUpdateBytes(updateStatus.totalBytes)}`
      : formatUpdateBytes(updateStatus?.totalBytes);
  const updateDownloadSpeedLabel = updateStatus?.bytesPerSecond ? `${formatUpdateBytes(updateStatus.bytesPerSecond)}/s` : 'n/a';
  const artistImageHasSummary = Boolean(artistImageProgress);
  const artistImageSummary = artistImageProgress?.summary ?? emptyArtistImageSummary;
  const artistImageQueuedTotal = artistImageProgress?.lastQueued.queued ?? 0;
  const artistImageRuntimeActive = (artistImageProgress?.queued ?? 0) + (artistImageProgress?.active ?? 0);
  const artistImageFailed = artistImageSummary.error + artistImageSummary.rateLimited;
  const artistImageTerminalTotal = artistImageSummary.matched + artistImageSummary.notFound + artistImageFailed;
  const artistImagePersistedActive = artistImageSummary.pending + artistImageSummary.loading;
  const artistImageActive = artistImageHasSummary ? Math.max(artistImageRuntimeActive, artistImagePersistedActive) : artistImageQueuedTotal;
  const artistImageProgressTotal = Math.max(
    artistImageSummary.total,
    artistImageTerminalTotal + artistImageActive,
    artistImageQueuedTotal,
    1,
  );
  const artistImageProgressDone =
    !artistImageHasSummary
      ? 0
      : Math.max(0, Math.min(artistImageProgressTotal, artistImageTerminalTotal));
  const artistImageProgressPercent =
    artistImageProgressTotal > 0 ? Math.max(0, Math.min(100, Math.round((artistImageProgressDone / artistImageProgressTotal) * 100))) : 0;
  const artistImagePaused = artistImageProgress?.paused ?? appSettings?.artistImageFetchPaused ?? false;
  const artistImageStatusLabel = !appSettings?.autoFetchArtistImages
    ? '未启用'
    : artistImagePaused
      ? '已暂停'
      : artistImageProgress?.running
        ? '运行中'
        : '空闲';

  const lyricsBackfillRunning = lyricsBackfillJob?.status === 'queued' || lyricsBackfillJob?.status === 'running';
  const lyricsBackfillProgressTotal = Math.max(lyricsBackfillJob?.totalTracks ?? 0, 1);
  const lyricsBackfillProgressDone = Math.max(
    0,
    Math.min(lyricsBackfillProgressTotal, lyricsBackfillJob?.processedTracks ?? 0),
  );
  const lyricsBackfillProgressPercent =
    lyricsBackfillJob && lyricsBackfillJob.totalTracks > 0
      ? Math.max(0, Math.min(100, Math.round((lyricsBackfillProgressDone / lyricsBackfillProgressTotal) * 100)))
      : lyricsBackfillJob?.phase === 'collecting'
        ? 4
        : 0;
  const lyricsBackfillStatusLabel = !lyricsBackfillJob
    ? '未开始'
    : lyricsBackfillJob.playbackThrottled
      ? '播放中，降速补全'
      : lyricsBackfillJob.phase === 'collecting'
      ? `筛选缺失歌词 · 已检查 ${lyricsBackfillJob.scannedTracks} 首`
      : lyricsBackfillJob.status === 'completed'
        ? '已完成'
        : lyricsBackfillJob.status === 'cancelled'
          ? '已取消'
          : lyricsBackfillJob.status === 'failed'
            ? '失败'
            : lyricsBackfillJob.mode === 'complete'
              ? '完整补全中'
              : '快速补全中';

  const handleDownloadDirectoryChoose = async (): Promise<void> => {
    try {
      const downloads = getDownloadsBridge();

      if (!downloads) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to choose a download directory.');
        return;
      }

      setDownloadDirectoryBusy(true);
      setDownloadDirectoryMessage(null);
      setError(null);
      const settings = await downloads.chooseOutputDirectory();

      if (!settings) {
        return;
      }

      setDownloadSettings(settings);
      setDownloadDirectoryMessage('下载路径已更新。');
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloadDirectoryBusy(false);
    }
  };

  const handleCacheDirectoryChoose = async (): Promise<void> => {
    try {
      const app = getAppBridge();

      if (!app) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to choose a cache directory.');
        return;
      }

      const directory = await app.chooseCacheDirectory();
      if (!directory) {
        return;
      }

      setPendingCacheDirectory(directory);
      setCacheDirectoryResult(null);
      setCacheDirectoryMessage(null);
      setError(null);
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : String(cacheError));
    }
  };

  const handleCacheDirectoryApply = async (migrate: boolean): Promise<void> => {
    if (pendingCacheDirectory === undefined) {
      return;
    }

    try {
      const app = getAppBridge();

      if (!app) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to change the cache directory.');
        return;
      }

      setCacheDirectoryBusy(true);
      setCacheDirectoryResult(null);
      setCacheDirectoryMessage(null);
      const result = await app.setCoverCacheDirectory({
        directory: pendingCacheDirectory,
        migrate,
      });
      setCacheDirectoryResult(result);

      if (result?.errors.length) {
        setCacheDirectoryMessage('迁移未完成，缓存目录没有切换。请查看错误摘要后重试。');
        return;
      }

      const settings = await app.getSettings();
      setAppSettings(settings);
      await refreshCacheInventory();
      setPendingCacheDirectory(undefined);
      setCacheDirectoryMessage(migrate ? '缓存目录已切换，封面缓存路径已更新。' : '缓存目录已切换，后续扫描会按需重新生成封面缓存。');
      window.dispatchEvent(new Event('library:changed'));
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : String(cacheError));
    } finally {
      setCacheDirectoryBusy(false);
    }
  };

  const handleCloseToTrayToggle = (): void => {
    const nextHideToTrayOnClose = !(appSettings?.hideToTrayOnClose ?? false);
    patchAppSettings({ hideToTrayOnClose: nextHideToTrayOnClose });
  };

  const handleFirstRunWizardToggle = (): void => {
    patchAppSettings({ onboardingCompleted: false });
  };

  const handleLiveLibraryUpdatesToggle = (): void => {
    const nextEnabled = !(appSettings?.liveLibraryUpdatesEnabled ?? false);
    patchAppSettings({
      liveLibraryUpdatesEnabled: nextEnabled,
      liveLibraryAutoHideDeletedEnabled: false,
    });
  };

  const handleArtistWallAlbumArtworkToggle = (): void => {
    const nextArtistWallAlbumArtwork = !(appSettings?.artistWallAlbumArtwork ?? false);
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save app settings.');
      return;
    }

    void app
      .setSettings({ artistWallAlbumArtwork: nextArtistWallAlbumArtwork })
      .then((settings) => {
        setAppSettings(settings);
        window.dispatchEvent(new Event('settings:changed'));
      })
      .catch((settingsError) => {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  };

  const setShortcutMessage = useCallback((scope: ShortcutScope, action: GlobalShortcutAction, message: string | null): void => {
    setShortcutMessages((current) => ({ ...current, [shortcutMessageKey(scope, action)]: message }));
  }, []);

  const patchLocalShortcuts = useCallback((nextShortcuts: LocalShortcutSettings): void => {
    patchAppSettings({ localShortcuts: nextShortcuts });
  }, [patchAppSettings]);

  const patchGlobalShortcuts = useCallback((nextShortcuts: GlobalShortcutSettings): void => {
    patchAppSettings({ globalShortcuts: nextShortcuts });
  }, [patchAppSettings]);

  const patchShortcut = useCallback((scope: ShortcutScope, action: GlobalShortcutAction, patch: Partial<GlobalShortcutSettings[GlobalShortcutAction]>): void => {
    if (scope === 'local') {
      patchLocalShortcuts({
        ...localShortcuts,
        [action]: {
          ...localShortcuts[action],
          ...patch,
        },
      });
      return;
    }

    patchGlobalShortcuts({
      ...globalShortcuts,
      [action]: {
        ...globalShortcuts[action],
        ...patch,
      },
    });
  }, [globalShortcuts, localShortcuts, patchGlobalShortcuts, patchLocalShortcuts]);

  const validateShortcutBeforeEnable = async (
    scope: ShortcutScope,
    action: GlobalShortcutAction,
    accelerator: string | null,
  ): Promise<string | null> => {
    if (!accelerator) {
      return t('settings.shortcuts.message.empty');
    }

    const validation = validateGlobalShortcutAccelerator(accelerator);
    if (!validation.valid || !validation.accelerator) {
      return t(validation.reason === 'unsafe' ? 'settings.shortcuts.message.unsafe' : 'settings.shortcuts.message.invalid');
    }

    const shortcuts = scope === 'local' ? localShortcuts : globalShortcuts;
    const duplicateAction = findDuplicateShortcutAction(shortcuts, action, validation.accelerator);
    if (duplicateAction) {
      return t('settings.shortcuts.message.duplicate');
    }

    if (scope === 'global') {
      const bridgeValidation = await getAppBridge()?.validateGlobalShortcut?.(validation.accelerator);
      if (bridgeValidation && (!bridgeValidation.valid || !bridgeValidation.available)) {
        return t(bridgeValidation.reason === 'unavailable' ? 'settings.shortcuts.message.unavailable' : 'settings.shortcuts.message.invalid');
      }
    }

    return null;
  };

  const handleShortcutToggle = async (scope: ShortcutScope, action: GlobalShortcutAction): Promise<void> => {
    const binding = scope === 'local' ? localShortcuts[action] : globalShortcuts[action];
    if (binding.enabled) {
      setShortcutMessage(scope, action, null);
      patchShortcut(scope, action, { enabled: false });
      return;
    }

    const message = await validateShortcutBeforeEnable(scope, action, binding.accelerator);
    if (message) {
      setShortcutMessage(scope, action, message);
      patchShortcut(scope, action, { enabled: false });
      return;
    }

    setShortcutMessage(scope, action, null);
    patchShortcut(scope, action, { enabled: true });
  };

  const handleShortcutClear = (scope: ShortcutScope, action: GlobalShortcutAction): void => {
    setShortcutMessage(scope, action, null);
    patchShortcut(scope, action, { enabled: false, accelerator: null });
  };

  const handleShortcutRecommendedReset = (): void => {
    setRecordingShortcutTarget(null);
    setShortcutMessages({});
    patchAppSettings({
      localShortcuts: createRecommendedLocalShortcuts(),
      globalShortcuts: createRecommendedGlobalShortcuts(),
    });
  };

  const commitRecordedShortcut = useCallback(
    ({ action, scope }: RecordingShortcutTarget, rawAccelerator: string | null): void => {
      const validation = validateGlobalShortcutAccelerator(rawAccelerator);
      if (!validation.valid || !validation.accelerator) {
        setShortcutMessage(scope, action, t(validation.reason === 'unsafe' ? 'settings.shortcuts.message.unsafe' : 'settings.shortcuts.message.invalid'));
        return;
      }

      const shortcuts = scope === 'local' ? localShortcuts : globalShortcuts;
      const duplicateAction = findDuplicateShortcutAction(shortcuts, action, validation.accelerator);
      if (duplicateAction) {
        setShortcutMessage(scope, action, t('settings.shortcuts.message.duplicate'));
        return;
      }

      setShortcutMessage(scope, action, null);
      patchShortcut(scope, action, {
        accelerator: validation.accelerator,
        enabled: false,
      });
      setRecordingShortcutTarget(null);
    },
    [globalShortcuts, localShortcuts, patchShortcut, setShortcutMessage, t],
  );

  useEffect(() => {
    if (!recordingShortcutTarget) {
      return undefined;
    }

    document.body.dataset.echoShortcutRecording = 'true';

    const handleShortcutKeyDown = (event: KeyboardEvent): void => {
      if (isImeComposingKeyEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecordingShortcutTarget(null);
        return;
      }

      commitRecordedShortcut(recordingShortcutTarget, acceleratorFromKeyboardEvent(event));
    };

    const handleShortcutMouseEvent = (event: MouseEvent): void => {
      const rawAccelerator = acceleratorFromMouseEvent(event);
      if (!rawAccelerator) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      commitRecordedShortcut(recordingShortcutTarget, rawAccelerator);
    };

    const handleShortcutContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleShortcutKeyDown, true);
    window.addEventListener('mousedown', handleShortcutMouseEvent, true);
    window.addEventListener('mouseup', handleShortcutMouseEvent, true);
    window.addEventListener('auxclick', handleShortcutMouseEvent, true);
    window.addEventListener('contextmenu', handleShortcutContextMenu, true);
    return () => {
      window.removeEventListener('keydown', handleShortcutKeyDown, true);
      window.removeEventListener('mousedown', handleShortcutMouseEvent, true);
      window.removeEventListener('mouseup', handleShortcutMouseEvent, true);
      window.removeEventListener('auxclick', handleShortcutMouseEvent, true);
      window.removeEventListener('contextmenu', handleShortcutContextMenu, true);
      delete document.body.dataset.echoShortcutRecording;
    };
  }, [commitRecordedShortcut, recordingShortcutTarget]);

  const handleAutoFetchArtistImagesToggle = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save app settings.');
      return;
    }

    const nextAutoFetch = !(appSettings?.autoFetchArtistImages ?? false);
    const patch: Partial<AppSettings> = nextAutoFetch
      ? { autoFetchArtistImages: true, artistImageFetchPaused: false }
      : { autoFetchArtistImages: false };

    try {
      setArtistImageBusyAction(nextAutoFetch ? 'refresh' : null);
      setArtistImageMessage(null);
      const settings = await app.setSettings(patch);
      setAppSettings(settings);
      dispatchSettingsChanged(settings);

      const library = getLibraryBridge();
      if (nextAutoFetch) {
        if (!library?.kickoffArtistImageBackfill) {
          setError(t('settings.appearance.artistAvatars.message.desktopBridgeRefresh'));
          return;
        }

        const status = await library.kickoffArtistImageBackfill({ force: false, limit: 500 });
        setArtistImageProgress({ ...status, startedAt: Date.now() });
        setArtistImageMessage(
          t('settings.appearance.artistAvatars.message.queued', {
            queued: status.lastQueued.queued,
            skipped: status.lastQueued.skipped,
          }),
        );
        return;
      }

      const status = await library?.getArtistImageJobStatus?.();
      setArtistImageProgress(status ? { ...status, startedAt: Date.now() } : null);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    } finally {
      setArtistImageBusyAction(null);
    }
  };

  const handleArtistWallAlbumFallbackForMissingAvatarsToggle = (): void => {
    patchAppSettings({
      artistWallAlbumFallbackForMissingAvatars: !(appSettings?.artistWallAlbumFallbackForMissingAvatars ?? false),
    });
  };

  const handleRefreshMissingArtistImages = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.kickoffArtistImageBackfill) {
      setError(t('settings.appearance.artistAvatars.message.desktopBridgeRefresh'));
      return;
    }

    try {
      setArtistImageBusyAction('refresh');
      setArtistImageMessage(null);
      const status = await library.kickoffArtistImageBackfill({ force: true, limit: 500 });
      setArtistImageMessage(
        !appSettings?.autoFetchArtistImages
          ? t('settings.appearance.artistAvatars.message.enableFirst')
          : t('settings.appearance.artistAvatars.message.queued', { queued: status.lastQueued.queued, skipped: status.lastQueued.skipped }),
      );
      setArtistImageProgress({ ...status, startedAt: Date.now() });
    } catch (artistImageError) {
      setError(artistImageError instanceof Error ? artistImageError.message : String(artistImageError));
    } finally {
      setArtistImageBusyAction(null);
    }
  };

  const handleArtistImagePauseToggle = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.setArtistImageJobsPaused) {
      setError(t('settings.appearance.artistAvatars.message.desktopBridgeRefresh'));
      return;
    }

    try {
      const nextPaused = !(artistImageProgress?.paused ?? appSettings?.artistImageFetchPaused ?? false);
      const status = await library.setArtistImageJobsPaused(nextPaused);
      setAppSettings((current) => (current ? { ...current, artistImageFetchPaused: nextPaused } : current));
      setArtistImageProgress({ ...status, startedAt: Date.now() });
      setArtistImageMessage(nextPaused ? '已暂停歌手头像后台获取。' : '已继续歌手头像后台获取。');
    } catch (artistImageError) {
      setError(artistImageError instanceof Error ? artistImageError.message : String(artistImageError));
    }
  };

  const handleClearArtistImageCache = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.clearArtistImageCache) {
      setError(t('settings.appearance.artistAvatars.message.desktopBridgeClear'));
      return;
    }

    try {
      setArtistImageBusyAction('clear');
      setArtistImageMessage(null);
      const result = await library.clearArtistImageCache();
      setArtistImageMessage(
        t('settings.appearance.artistAvatars.message.cleared', { removedRows: result.removedRows, deletedFiles: result.deletedFiles }),
      );
      const status = await library.getArtistImageJobStatus?.();
      setArtistImageProgress(status ? { ...status, startedAt: Date.now() } : null);
      window.dispatchEvent(new Event('library:changed'));
    } catch (artistImageError) {
      setError(artistImageError instanceof Error ? artistImageError.message : String(artistImageError));
    } finally {
      setArtistImageBusyAction(null);
    }
  };

  const handleAlbumMergeStrategyApply = async (): Promise<void> => {
    const nextStrategy = pendingAlbumMergeStrategy ?? appSettings?.albumMergeStrategy ?? 'standard';
    const nextArtistStrategy = pendingArtistMergeStrategy ?? appSettings?.artistMergeStrategy ?? 'standard';
    const app = getAppBridge();
    const library = getLibraryBridge();

    if (!app || !library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to refresh album grouping.');
      return;
    }

    try {
      setAlbumGroupingBusy(true);
      setAlbumGroupingMessage(null);
      setError(null);
      const beforeSummary = await library.getSummary();
      const settings = await app.setSettings({ albumMergeStrategy: nextStrategy, artistMergeStrategy: nextArtistStrategy });
      setAppSettings(settings);
      const afterSummary = await library.refreshAlbumGrouping();
      const albumDelta = beforeSummary.albumCount - afterSummary.albumCount;
      const artistDelta = beforeSummary.artistCount - afterSummary.artistCount;
      const changeText =
        albumDelta > 0
          ? `减少 ${albumDelta} 张`
          : albumDelta < 0
            ? `增加 ${Math.abs(albumDelta)} 张`
            : '数量未变化';
      const artistChangeText =
        artistDelta > 0
          ? `减少 ${artistDelta} 位`
          : artistDelta < 0
            ? `增加 ${Math.abs(artistDelta)} 位`
            : '数量未变化';
      setAlbumGroupingMessage(
        `分组已更新：专辑 ${beforeSummary.albumCount} -> ${afterSummary.albumCount}，${changeText}；艺人 ${beforeSummary.artistCount} -> ${afterSummary.artistCount}，${artistChangeText}。`,
      );
      window.dispatchEvent(new Event('library:changed'));
    } catch (albumGroupingError) {
      setAlbumGroupingMessage(null);
      setError(albumGroupingError instanceof Error ? albumGroupingError.message : String(albumGroupingError));
    } finally {
      setAlbumGroupingBusy(false);
    }
  };

  const handleScanLibraryFolders = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to scan library folders.');
      return;
    }

    try {
      setLibraryScanBusy(true);
      setLibraryScanMessage(null);
      setError(null);
      const folders = await library.getFolders();

      if (folders.length === 0) {
        setLibraryScanMessage('还没有导入曲库文件夹。');
        return;
      }

      const runningFolderIds = new Set(
        Object.values(getLibraryScanStatuses())
          .filter((status) => libraryScanRunningStatuses.has(status.status))
          .map((status) => status.folderId),
      );
      const foldersToScan = folders.filter((folder) => !runningFolderIds.has(folder.id));

      if (foldersToScan.length === 0) {
        setLibraryScanMessage('曲库扫描已经在后台运行，下面会持续显示进度。');
        return;
      }

      const scans = await Promise.all(foldersToScan.map((folder) => library.scanFolder(folder.id)));
      scans.forEach(rememberLibraryScanStatus);
      setLibraryScanStatuses(getLibraryScanStatuses());
      setLibraryScanMessage(
        runningFolderIds.size > 0
          ? `已加入 ${scans.length} 个曲库文件夹到扫描队列，已有 ${runningFolderIds.size} 个正在排队/运行。`
          : `已加入 ${scans.length} 个曲库文件夹到扫描队列。`,
      );
    } catch (scanError) {
      setLibraryScanMessage(null);
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setLibraryScanBusy(false);
    }
  };

  const handleRescanEmbeddedTags = async (scope: 'all' | 'missing-cover'): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to rescan embedded tags.');
      return;
    }

    try {
      setEmbeddedTagRescanBusy(scope);
      setEmbeddedTagRescanMessage(null);
      setError(null);
      const scans = await library.rescanEmbeddedTags(
        scope === 'all' ? 'embedded-tags-all' : 'embedded-tags-missing-cover',
      );
      scans.forEach(rememberLibraryScanStatus);
      if (scans.length === 0) {
        setEmbeddedTagRescanMessage('还没有导入曲库文件夹。');
        return;
      }

      setEmbeddedTagRescanMessage(
        scope === 'all'
          ? `已开始重扫 ${scans.length} 个曲库文件夹的全部嵌入标签，扫到后会自动应用。`
          : `已开始重扫 ${scans.length} 个曲库文件夹中缺失封面的歌曲，扫到嵌入标签/封面后会自动应用。`,
      );
      window.dispatchEvent(new Event('library:changed'));
    } catch (scanError) {
      setEmbeddedTagRescanMessage(null);
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setEmbeddedTagRescanBusy(null);
    }
  };

  const handleDuplicateVisibilityToggle = async (): Promise<void> => {
    const app = getAppBridge();
    const library = getLibraryBridge();
    const nextEnabled = !(appSettings?.duplicateTracksEnabled ?? false);

    if (!app || !library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change duplicate track settings.');
      return;
    }

    try {
      setDuplicateBusyAction('toggle');
      setDuplicateMessage(null);
      setError(null);
      const [settings, summary] = await Promise.all([
        app.setSettings({
          duplicateTracksEnabled: nextEnabled,
          duplicateTracksMode: 'strict',
        }),
        library.getDuplicateIndexSummary('strict'),
      ]);

      setAppSettings(settings);
      setDuplicateSummary(summary);
      if (nextEnabled) {
        setDuplicateMessage(
          summary.duplicateGroups > 0
            ? `已开启隐藏重复歌曲，当前隐藏 ${summary.hiddenTracks} 首。`
            : '已开启隐藏重复歌曲。还没有分析结果，请先分析重复歌曲。',
        );
      } else {
        setDuplicateMessage('已关闭隐藏重复歌曲。');
      }
      window.dispatchEvent(new Event('settings:changed'));
      window.dispatchEvent(new Event('library:changed'));
    } catch (duplicateError) {
      setDuplicateMessage(null);
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError));
    } finally {
      setDuplicateBusyAction(null);
    }
  };

  const handleAnalyzeDuplicateTracks = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to analyze duplicate tracks.');
      return;
    }

    try {
      setDuplicateBusyAction('analyze');
      setDuplicateMessage(null);
      setError(null);
      const summary = await library.refreshDuplicateTracks('strict');
      setDuplicateSummary(summary);
      setDuplicateMessage(`发现 ${summary.duplicateGroups} 组重复歌曲，当前可隐藏 ${summary.hiddenTracks} 首。`);
      window.dispatchEvent(new Event('library:changed'));
    } catch (duplicateError) {
      setDuplicateMessage(null);
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError));
    } finally {
      setDuplicateBusyAction(null);
    }
  };

  const handleScanDuplicateTrackCleanup = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.previewDuplicateTrackCleanup) {
      setError('桌面桥接不可用，无法扫描重复歌曲清理清单。');
      return;
    }

    try {
      setDuplicateCleanupBusyAction('scan');
      setDuplicateCleanupMessage(null);
      setDuplicateCleanupPreview(null);
      setDuplicateCleanupResultsExpanded(false);
      setDangerMessage(null);
      setError(null);
      setDuplicateCleanupMessage('正在分批扫描重复歌曲，播放会继续保持响应；完成后会列出可清理清单。');
      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
      const preview = await library.previewDuplicateTrackCleanup('strict');
      setDuplicateCleanupPreview(preview);
      setDuplicateSummary(preview.summary);
      setDuplicateCleanupResultsExpanded(false);
      setDuplicateCleanupMessage(
        preview.totalTracksToRemove > 0
          ? `发现 ${preview.groups.length} 组重复歌曲，建议移入回收站 ${preview.totalTracksToRemove} 首低评分版本。`
          : '没有发现需要清理的重复歌曲。',
      );
      window.dispatchEvent(new Event('library:changed'));
    } catch (cleanupError) {
      setDuplicateCleanupPreview(null);
      setDuplicateCleanupMessage(null);
      setError(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    } finally {
      setDuplicateCleanupBusyAction(null);
    }
  };

  const handleApplyDuplicateTrackCleanup = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.applyDuplicateTrackCleanup) {
      setError('桌面桥接不可用，无法清理重复歌曲。');
      return;
    }
    if (!duplicateCleanupPreview || duplicateCleanupPreview.removeTrackIds.length === 0) {
      setDuplicateCleanupMessage('请先扫描并确认有待清理的重复歌曲。');
      return;
    }
    if (
      !requireDangerConfirmWord(
        '清理重复歌曲',
        `将把扫描结果中的 ${duplicateCleanupPreview.totalTracksToRemove} 首低评分重复版本移入系统回收站，并从曲库索引移除；每组会保留评分最高的一首。`,
      )
    ) {
      setDuplicateCleanupMessage('需要先在上方确认词输入框输入“清理重复歌曲”，再点击清理扫描结果。');
      return;
    }

    try {
      setDuplicateCleanupBusyAction('clean');
      setDuplicateCleanupMessage(null);
      setError(null);
      setDangerMessage(null);
      const result = await library.applyDuplicateTrackCleanup({
        mode: 'strict',
        trackIds: duplicateCleanupPreview.removeTrackIds,
      });
      setDuplicateSummary(result.updatedSummary);
      setDuplicateCleanupPreview(null);
      setDuplicateCleanupResultsExpanded(false);
      setDuplicateCleanupMessage(
        `已移入回收站 ${result.trashedTracks} 首，从曲库移除 ${result.removedFromLibrary} 首；找不到源文件 ${result.missingFiles} 首，失败 ${result.failedTracks.length} 首。`,
      );
      window.dispatchEvent(new Event('library:changed'));
    } catch (cleanupError) {
      setDuplicateCleanupMessage(null);
      setError(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    } finally {
      setDuplicateCleanupBusyAction(null);
    }
  };

  const pollBpmAnalysisJob = async (jobId: string): Promise<void> => {
    const library = getLibraryBridge();
    if (!library) {
      return;
    }

    for (;;) {
      const status = await library.getBpmAnalysisStatus(jobId);
      setBpmAnalysisJob(status);
      setBpmAnalysisMessage(
        status.status === 'completed'
          ? `BPM 分析完成：${status.updatedTracks}/${status.totalTracks} 首已更新`
          : `BPM 分析中：${status.processedTracks}/${status.totalTracks}`,
      );

      if (status.status === 'completed' || status.status === 'failed') {
        setBpmAnalysisBusy(false);
        window.dispatchEvent(new Event('library:changed'));
        return;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 700);
      });
    }
  };

  const handleStartBpmAnalysis = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to analyze BPM.');
      return;
    }

    try {
      setBpmAnalysisBusy(true);
      setBpmAnalysisMessage(null);
      setError(null);
      const job = await library.startBpmAnalysis({ limit: 500 });
      setBpmAnalysisJob(job);
      setBpmAnalysisMessage(job.totalTracks > 0 ? `BPM 分析已开始：0/${job.totalTracks}` : '没有需要分析的歌曲');
      if (job.totalTracks === 0) {
        setBpmAnalysisBusy(false);
        return;
      }
      void pollBpmAnalysisJob(job.id).catch((analysisError) => {
        setBpmAnalysisBusy(false);
        setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
      });
    } catch (analysisError) {
      setBpmAnalysisBusy(false);
      setBpmAnalysisMessage(null);
      setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
    }
  };

  const pollReplayGainAnalysisJob = async (jobId: string): Promise<void> => {
    const library = getLibraryBridge();
    if (!library) {
      return;
    }

    for (;;) {
      const status = await library.getReplayGainAnalysisStatus(jobId);
      setReplayGainAnalysisJob(status);
      setReplayGainAnalysisMessage(
        status.status === 'completed'
          ? `音量分析完成：${status.updatedTracks}/${status.totalTracks} 首已更新`
          : `音量分析中：${status.processedTracks}/${status.totalTracks}`,
      );

      if (status.status === 'completed' || status.status === 'failed') {
        setReplayGainAnalysisBusy(false);
        window.dispatchEvent(new Event('library:changed'));
        return;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 700);
      });
    }
  };

  const handleStartReplayGainAnalysis = async (): Promise<void> => {
    const library = getLibraryBridge();

    if (!library) {
      setError('桌面桥接不可用，无法分析音量。');
      return;
    }

    try {
      setReplayGainAnalysisBusy(true);
      setReplayGainAnalysisMessage(null);
      setError(null);
      const job = await library.startReplayGainAnalysis({ limit: 500 });
      setReplayGainAnalysisJob(job);
      setReplayGainAnalysisMessage(job.totalTracks > 0 ? `音量分析已开始：0/${job.totalTracks}` : '没有需要分析音量的歌曲');
      if (job.totalTracks === 0) {
        setReplayGainAnalysisBusy(false);
        return;
      }
      void pollReplayGainAnalysisJob(job.id).catch((analysisError) => {
        setReplayGainAnalysisBusy(false);
        setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
      });
    } catch (analysisError) {
      setReplayGainAnalysisBusy(false);
      setReplayGainAnalysisMessage(null);
      setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
    }
  };

  const formatLyricsBackfillMessage = (status: LyricsBackfillJobStatus): string => {
    if (status.phase === 'collecting') {
      return `正在筛选缺失歌词：已检查 ${status.scannedTracks} 首`;
    }

    if (status.status === 'completed') {
      return `歌词补全完成：命中 ${status.matchedTracks} 首，未找到 ${status.notFoundTracks} 首，跳过已有 ${status.alreadyCachedTracks} 首`;
    }

    if (status.status === 'cancelled') {
      return `歌词补全已取消：已处理 ${status.processedTracks}/${status.totalTracks} 首`;
    }

    if (status.status === 'failed') {
      return `歌词补全失败：已处理 ${status.processedTracks}/${status.totalTracks} 首，失败 ${status.errorCount} 首`;
    }

    return `歌词补全中：${status.processedTracks}/${status.totalTracks}，命中 ${status.matchedTracks} 首`;
  };

  const pollLyricsBackfillJob = async (jobId: string, generation: number): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.getLyricsBackfillStatus) {
      return;
    }

    for (;;) {
      if (lyricsBackfillPollGenerationRef.current !== generation) {
        return;
      }

      const status = await library.getLyricsBackfillStatus(jobId);
      if (lyricsBackfillPollGenerationRef.current !== generation) {
        return;
      }

      setLyricsBackfillJob(status);
      setLyricsBackfillMessage(formatLyricsBackfillMessage(status));

      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        setLyricsBackfillBusy(false);
        window.dispatchEvent(new Event('library:changed'));
        return;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 700);
      });
    }
  };

  const startLyricsBackfillPolling = (jobId: string): void => {
    const generation = lyricsBackfillPollGenerationRef.current + 1;
    lyricsBackfillPollGenerationRef.current = generation;
    void pollLyricsBackfillJob(jobId, generation).catch((lyricsError) => {
      if (lyricsBackfillPollGenerationRef.current !== generation) {
        return;
      }

      setLyricsBackfillBusy(false);
      setError(lyricsError instanceof Error ? lyricsError.message : String(lyricsError));
    });
  };

  useEffect(() => {
    let disposed = false;
    const library = getLibraryBridge();
    if (!library?.getCurrentLyricsBackfillStatus) {
      return () => {
        disposed = true;
        lyricsBackfillPollGenerationRef.current += 1;
      };
    }

    const restore = async (): Promise<void> => {
      try {
        const status = await library.getCurrentLyricsBackfillStatus();
        if (disposed || !status) {
          return;
        }

        setLyricsBackfillJob(status);
        setLyricsBackfillMessage(formatLyricsBackfillMessage(status));
        const running = status.status === 'queued' || status.status === 'running';
        setLyricsBackfillBusy(running);
        if (running) {
          startLyricsBackfillPolling(status.id);
        }
      } catch (lyricsError) {
        if (!disposed) {
          setError(lyricsError instanceof Error ? lyricsError.message : String(lyricsError));
        }
      }
    };

    void restore();

    return () => {
      disposed = true;
      lyricsBackfillPollGenerationRef.current += 1;
    };
  }, []);

  const handleStartLyricsBackfill = async (mode: 'quick' | 'complete'): Promise<void> => {
    const library = getLibraryBridge();

    if (!library?.startLyricsBackfill) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to backfill lyrics.');
      return;
    }

    try {
      setLyricsBackfillBusy(true);
      setLyricsBackfillMessage(null);
      setError(null);
      const job = await library.startLyricsBackfill({
        mode,
        limit: 10000,
        concurrency: mode === 'complete' ? 6 : 18,
        autoAcceptScore: lyricsBackfillAutoAcceptScore,
      });
      setLyricsBackfillJob(job);
      setLyricsBackfillMessage(formatLyricsBackfillMessage(job));
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        setLyricsBackfillBusy(false);
        return;
      }
      startLyricsBackfillPolling(job.id);
    } catch (lyricsError) {
      setLyricsBackfillBusy(false);
      setLyricsBackfillMessage(null);
      setError(lyricsError instanceof Error ? lyricsError.message : String(lyricsError));
    }
  };

  const handleCancelLyricsBackfill = async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.cancelLyricsBackfill || !lyricsBackfillJob) {
      return;
    }

    try {
      const status = await library.cancelLyricsBackfill(lyricsBackfillJob.id);
      lyricsBackfillPollGenerationRef.current += 1;
      setLyricsBackfillJob(status);
      setLyricsBackfillMessage(formatLyricsBackfillMessage(status));
      setLyricsBackfillBusy(false);
    } catch (lyricsError) {
      setError(lyricsError instanceof Error ? lyricsError.message : String(lyricsError));
    }
  };

  const toggleNetworkProvider = (provider: AppSettings['networkMetadataProviders'][number]): void => {
    const current = (appSettings?.networkMetadataProviders ?? defaultNetworkMetadataProviders).filter((item) =>
      visibleNetworkMetadataProviders.includes(item),
    );
    const next = current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider];
    patchAppSettings({ networkMetadataProviders: next.length ? next : defaultNetworkMetadataProviders });
  };

  const handlePlaybackSpeedModeChange = (playbackSpeedMode: PlaybackSpeedMode): void => {
    const playbackSpeed = appSettings?.playbackSpeed ?? status?.playbackRate ?? 1;
    const audio = getAudioBridge();
    patchAppSettings({ playbackSpeedMode });

    if (!audio) {
      return;
    }

    void audio
      .setOutput({ playbackRate: playbackSpeed, playbackSpeedMode })
      .then(setStatus)
      .catch((speedError) => {
        setError(speedError instanceof Error ? speedError.message : String(speedError));
      });
  };

  const requireDangerConfirmWord = (word: string, message: string): boolean => {
    if (dangerConfirmWord.trim() === word) {
      setDangerConfirmWord('');
      return true;
    }

    setDangerMessage(`${message} 需要先在确认词输入框输入“${word}”。`);
    return false;
  };

  const clearDatabaseProtectionFeedback = (): void => {
    setDatabaseProtectionMessage(null);
    setDatabaseProtectionError(null);
  };

  const setDatabaseProtectionFailure = (failure: unknown): void => {
    setDatabaseProtectionMessage(null);
    setDatabaseProtectionError(failure instanceof Error ? failure.message : String(failure));
  };

  const handleRefreshDatabaseProtectionStatus = async (): Promise<void> => {
    try {
      setDatabaseProtectionBusyAction('refresh');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      await refreshDatabaseProtectionStatus({ deepCheck: true });
      setDatabaseProtectionMessage('数据库健康状态已刷新。');
    } catch (refreshError) {
      setDatabaseProtectionFailure(refreshError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleCreateDatabaseSnapshot = async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.createDatabaseSnapshot) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里创建健康快照。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('snapshot');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在创建健康快照...');
      const nextStatus = await library.createDatabaseSnapshot();
      setDatabaseProtectionStatus(nextStatus);
      setDatabaseProtectionMessage('已创建新的健康快照。');
    } catch (snapshotError) {
      setDatabaseProtectionFailure(snapshotError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleRestoreDatabaseSnapshot = async (): Promise<void> => {
    const snapshot = databaseProtectionStatus?.latestHealthySnapshot;
    if (!snapshot) {
      setDatabaseProtectionFailure('没有可恢复的健康快照。');
      return;
    }
    if (!requireDangerConfirmWord('恢复曲库', '恢复最近健康快照会先归档当前数据库，再复制快照数据库；音乐文件不会被删除。')) {
      setDatabaseProtectionMessage('已取消恢复。需要输入确认词“恢复曲库”后才会执行。');
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.restoreDatabaseSnapshot) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里恢复曲库数据库。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('restore');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在恢复最近健康快照...');
      const result = await library.restoreDatabaseSnapshot(snapshot.id);
      setDatabaseProtectionMessage(`已从健康快照恢复曲库数据库。当前库检查：${getDatabaseHealthLabel(result.health.status)}。`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (restoreError) {
      setDatabaseProtectionFailure(restoreError);
    } finally {
      setDangerBusy(false);
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleScrubQuarantinedDatabase = async (): Promise<void> => {
    if (!requireDangerConfirmWord('修复隔离曲库', 'ECHO 会先修复隔离库的副本，验证通过后才替换当前曲库；原隔离库和当前库都会保留归档，音乐文件不会被删除。')) {
      setDatabaseProtectionMessage('已取消修复。需要输入确认词“修复隔离曲库”后才会执行。');
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.scrubQuarantinedDatabase) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里修复隔离曲库副本。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('scrub');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在修复隔离曲库副本...');
      const result = await library.scrubQuarantinedDatabase();
      setDatabaseProtectionMessage(`已修复隔离曲库副本并恢复：清理 ${result.scrubbedRows} 行，当前检查：${getDatabaseHealthLabel(result.health.status)}。`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (scrubError) {
      setDatabaseProtectionFailure(scrubError);
    } finally {
      setDangerBusy(false);
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleDiscardQuarantinedProblemTracks = async (): Promise<void> => {
    if (!requireDangerConfirmWord('归档问题曲目', 'ECHO 会复制隔离库副本，把含有危险元数据的曲目记录归档成 JSON 后从曲库数据库移除；音乐文件不会被删除。')) {
      setDatabaseProtectionMessage('已取消归档。需要输入确认词“归档问题曲目”后才会执行。');
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.discardQuarantinedProblemTracks) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里归档问题曲目。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('discard');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在归档问题曲目...');
      const result = await library.discardQuarantinedProblemTracks();
      setDatabaseProtectionMessage(`已归档并移除 ${result.discardedTracks} 首问题曲目，当前检查：${getDatabaseHealthLabel(result.health.status)}。归档：${result.discardArchivePath}`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (discardError) {
      setDatabaseProtectionFailure(discardError);
    } finally {
      setDangerBusy(false);
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleRelaunchLibraryRecoveryMode = async (): Promise<void> => {
    if (!window.confirm('退出 ECHO Next 并重启到恢复模式？重启时会先关闭当前实例，再在播放、扫描、歌词和 MV 服务占用数据库前检查并自动修复曲库。音乐文件不会被删除。')) {
      setDatabaseProtectionMessage('已取消重启到恢复模式。');
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.relaunchRecoveryMode) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里重启到恢复模式。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('relaunch');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在安排退出并重启到恢复模式...');
      try {
        window.localStorage.setItem(pendingRouteStorageKey, 'settings');
        window.localStorage.setItem(pendingSettingsSectionStorageKey, 'danger');
      } catch {
        // Recovery can still proceed; this only controls which page reopens after relaunch.
      }
      const result = await library.relaunchRecoveryMode();
      setDatabaseProtectionMessage(result.message);
    } catch (relaunchError) {
      setDatabaseProtectionFailure(relaunchError);
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleRebuildEmptyLibraryDatabase = async (): Promise<void> => {
    if (!requireDangerConfirmWord('重建空库', '数据库无法从健康快照恢复。此操作会先归档当前坏库和数据库三件套，再重建为空库；音乐文件不会被删除。')) {
      setDatabaseProtectionMessage('已取消重建。需要输入确认词“重建空库”后才会执行。');
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.repairDatabase) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里重建曲库数据库。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('restore');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage('正在归档坏库并重建空库...');
      const result = await library.repairDatabase();
      const archived = result.archivePath ? `已归档坏库：${result.archivePath}` : '没有发现可归档的数据库文件。';
      setDatabaseProtectionMessage(`已归档坏库并重建为空库。${archived} 请重新添加曲库文件夹并扫描；如果重扫后再次报错，请导出诊断。`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (rebuildError) {
      setDatabaseProtectionFailure(rebuildError);
    } finally {
      setDangerBusy(false);
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleOpenDataProtectionFolder = async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.openDataProtectionFolder) {
      setDatabaseProtectionFailure('桌面桥接不可用：请在 ECHO Next 桌面端里打开保护目录。');
      return;
    }

    try {
      setDatabaseProtectionBusyAction('open');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      await library.openDataProtectionFolder();
      setDatabaseProtectionMessage('已请求打开保护目录。');
    } catch (openError) {
      setDatabaseProtectionFailure(openError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleClearLibraryCache = async (): Promise<void> => {
    if (!window.confirm('清空曲库缓存？这会移除曲库索引、扫描缓存和封面缓存，不会删除你的音乐文件。')) {
      return;
    }

    const library = getLibraryBridge();

    if (!library) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to clear the library cache.');
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const result = await library.clearCache();
      setDangerMessage(
        `曲库缓存已清空：移除 ${result.removedCount}/${result.scannedCount} 首索引，删除 ${result.deletedCoverCacheFiles} 个封面缓存文件。`,
      );
      window.dispatchEvent(new Event('library:changed'));
    } catch (clearError) {
      setDangerMessage(null);
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleRepairLibraryDatabase = async (): Promise<void> => {
    if (!requireDangerConfirmWord('重建曲库', '重建会归档并移除当前曲库数据库索引，随后需要重新扫描；音乐文件不会被删除。')) {
      return;
    }

    if (!window.confirm('重建曲库数据库？这会归档当前曲库数据库并删除正在使用的数据库索引，不会删除你的音乐文件。重建后需要重新添加歌曲文件夹并扫描。')) {
      return;
    }

    const library = getLibraryBridge();

    if (!library?.repairDatabase) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to repair the library database.');
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const result = await library.repairDatabase();
      const archived = result.archivePath ? `已归档旧数据库：${result.archivePath}` : '没有发现旧数据库文件。';
      setDangerMessage(`曲库数据库已重建为空库。${archived} 请重新添加歌曲文件夹并扫描；如果重扫后再次报错，请直接导出诊断。`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (repairError) {
      setDangerMessage(null);
      setError(repairError instanceof Error ? repairError.message : String(repairError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleDeleteLibraryDatabase = async (): Promise<void> => {
    if (!requireDangerConfirmWord('删除曲库', '删除会归档并移除当前数据库文件；音乐文件不会被删除。')) {
      return;
    }

    if (!window.confirm('删除曲库数据库？这会归档并删除当前数据库文件，不会主动重建数据库，也不会删除你的音乐文件。删除后请重启 ECHO Next，再重新添加歌曲文件夹并扫描。')) {
      return;
    }

    const library = getLibraryBridge();

    if (!library?.deleteDatabase) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to delete the library database.');
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const result = await library.deleteDatabase();
      const archived = result.archivePath ? `已归档旧数据库：${result.archivePath}` : '没有发现旧数据库文件。';
      const removed = result.removedDatabaseFiles.length > 0 ? `已删除 ${result.removedDatabaseFiles.join('、')}。` : '没有需要删除的数据库文件。';
      setDangerMessage(`曲库数据库已删除。${removed}${archived} 请重启 ECHO Next 后重新添加歌曲文件夹并扫描。`);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDatabaseProtectionStatus();
    } catch (deleteError) {
      setDangerMessage(null);
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleDeleteAllUserData = async (): Promise<void> => {
    if (!requireDangerConfirmWord('删除所有内容', '这会删除 ECHO Next 的设置、账号、插件、曲库数据库、播放记录、缓存、日志、壁纸和保护快照；音乐文件不会被删除。')) {
      return;
    }

    if (
      !window.confirm(
        '彻底删除所有 ECHO Next 本地内容？这会清空 ECHO 的 userData 和外部封面缓存目录，删除后需要重启应用；音乐文件夹和下载输出目录不会被主动删除。',
      )
    ) {
      return;
    }

    const library = getLibraryBridge();

    if (!library?.deleteAllUserData) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to delete all local data.');
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const result = await library.deleteAllUserData();
      const removed = result.removedPaths.length;
      const failed = result.failedPaths.length;
      const failedText = failed > 0 ? ` 有 ${failed} 个路径删除失败，请关闭 ECHO 后手动检查。` : '';
      setDangerMessage(`ECHO 本地内容已清理：删除 ${removed} 个路径。${failedText}请立即重启 ECHO Next。`);
      window.dispatchEvent(new Event('library:changed'));
    } catch (deleteError) {
      setDangerMessage(null);
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleResetDefaultSettings = async (): Promise<void> => {
    if (!window.confirm('恢复默认设置？这会重置应用偏好、封面缓存目录和外观偏好，不会删除音乐文件或曲库文件夹。')) {
      return;
    }

    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to reset settings.');
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const settings = await app.resetSettings();
      setAppSettings(settings);
      handleAppearanceChange(defaultAppearancePreferences);
      setPendingCacheDirectory(undefined);
      setCacheDirectoryResult(null);
      setCacheDirectoryMessage(null);
      setPendingAlbumMergeStrategy(settings.albumMergeStrategy);
      setPendingArtistMergeStrategy(settings.artistMergeStrategy ?? 'standard');
      setDefaultCacheDirectory(await app.getDefaultCacheDirectory());
      setDangerMessage('默认设置已恢复。');
      window.dispatchEvent(new Event('settings:changed'));
      window.dispatchEvent(new Event('library:changed'));
    } catch (resetError) {
      setDangerMessage(null);
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleExportSettings = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.exportSettings) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端导出设置。');
      return;
    }

    try {
      setSettingsBackupBusy('export');
      setSettingsBackupMessage(null);
      setError(null);
      const exportedPath = await app.exportSettings();

      if (exportedPath) {
        setSettingsBackupMessage(`设置参数已导出：${exportedPath}`);
      }
    } catch (exportError) {
      setSettingsBackupMessage(null);
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setSettingsBackupBusy(null);
    }
  };

  const handleImportSettings = async (): Promise<void> => {
    if (!window.confirm('导入设置会先自动备份当前参数，然后覆盖应用偏好、播放、歌词、MV、外观、快捷键等设置；不会删除音乐文件或曲库。是否继续？')) {
      return;
    }

    const app = getAppBridge();

    if (!app?.importSettings) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端导入设置。');
      return;
    }

    try {
      setSettingsBackupBusy('import');
      setSettingsBackupMessage(null);
      setError(null);
      const result = await app.importSettings();

      if (!result) {
        return;
      }

      setAppSettings(result.settings);
      handleAppearanceChange(result.settings.appearancePreferences ?? defaultAppearancePreferences);
      setPendingAlbumMergeStrategy(result.settings.albumMergeStrategy);
      setPendingArtistMergeStrategy(result.settings.artistMergeStrategy ?? 'standard');
      setPendingCacheDirectory(undefined);
      setCacheDirectoryResult(null);
      setCacheDirectoryMessage(null);
      setDefaultCacheDirectory(await app.getDefaultCacheDirectory());
      dispatchSettingsChanged(result.settings);
      window.dispatchEvent(new Event('library:changed'));
      setSettingsBackupMessage(`设置参数已导入。导入前备份：${result.backupPath}`);
    } catch (importError) {
      setSettingsBackupMessage(null);
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setSettingsBackupBusy(null);
    }
  };

  const handleExportDataPackage = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.exportDataPackage) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端导出迁移数据包。');
      return;
    }

    try {
      setSettingsBackupBusy('dataPackage');
      setSettingsBackupMessage(null);
      setError(null);
      const result = await app.exportDataPackage();

      if (result) {
        const warningText = result.warnings.length > 0 ? `，警告 ${result.warnings.length} 条` : '';
        setSettingsBackupMessage(`ECHO 数据包已导出：${result.filePath}${warningText}`);
      }
    } catch (exportError) {
      setSettingsBackupMessage(null);
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setSettingsBackupBusy(null);
    }
  };

  const handleChooseDataBackupDirectory = async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.chooseDataBackupDirectory) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端设置备份目录。');
      return;
    }

    try {
      setDataBackupBusy('choose');
      setDataBackupMessage(null);
      setError(null);
      const directory = await app.chooseDataBackupDirectory();
      if (!directory) {
        return;
      }

      const settings = await app.setSettings({
        autoDataBackupDirectory: directory,
      });
      setAppSettings(settings);
      dispatchSettingsChanged(settings);
      await refreshDataBackupStatus();
      setDataBackupMessage(`自动备份目录已设置：${directory}。自动备份仍保持关闭，开启后才会按周期执行。`);
    } catch (backupError) {
      setDataBackupMessage(null);
      setError(backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setDataBackupBusy(null);
    }
  };

  const handleRunDataBackupNow = async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.runDataBackupNow) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端执行数据备份。');
      return;
    }

    try {
      setDataBackupBusy('run');
      setDataBackupMessage(null);
      setError(null);
      const result = await app.runDataBackupNow();
      await refreshDataBackupStatus();
      setDataBackupMessage(`数据备份已完成：${result.filePath}`);
    } catch (backupError) {
      await refreshDataBackupStatus();
      setDataBackupMessage(null);
      setError(backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setDataBackupBusy(null);
    }
  };

  const handleImportDataBackup = async (): Promise<void> => {
    if (
      !window.confirm(
        '导入数据备份会先归档当前 ECHO 数据，然后恢复备份里的设置、曲库索引、账号状态、缓存和元数据。音乐文件不会被删除。确认继续？',
      )
    ) {
      return;
    }

    const app = getAppBridge();
    if (!app?.importDataBackup) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端导入数据备份。');
      return;
    }

    try {
      setDataBackupBusy('import');
      setDataBackupMessage(null);
      setError(null);
      const result = await app.importDataBackup();
      if (!result) {
        return;
      }

      setAppSettings(result.settings);
      handleAppearanceChange(result.settings.appearancePreferences ?? defaultAppearancePreferences);
      setPendingAlbumMergeStrategy(result.settings.albumMergeStrategy);
      setPendingArtistMergeStrategy(result.settings.artistMergeStrategy ?? 'standard');
      setPendingCacheDirectory(undefined);
      setCacheDirectoryResult(null);
      setCacheDirectoryMessage(null);
      setDefaultCacheDirectory(await app.getDefaultCacheDirectory());
      dispatchSettingsChanged(result.settings);
      window.dispatchEvent(new Event('library:changed'));
      await refreshDataBackupStatus();
      const warningText = result.warnings.length > 0 ? `，警告 ${result.warnings.length} 条` : '';
      const rollbackText = result.rollbackBackupPath ? `。导入前归档：${result.rollbackBackupPath}` : '';
      setDataBackupMessage(`数据备份已导入${warningText}${rollbackText}`);
    } catch (backupError) {
      await refreshDataBackupStatus();
      setDataBackupMessage(null);
      setError(backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setDataBackupBusy(null);
    }
  };

  const handleOpenDataBackupDirectory = async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.openDataBackupDirectory) {
      setError('桌面桥接不可用。请在 ECHO Next 桌面端打开备份目录。');
      return;
    }

    try {
      setDataBackupBusy('open');
      setError(null);
      await app.openDataBackupDirectory();
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setDataBackupBusy(null);
    }
  };

  const handleFontPickerOpen = (target: FontPickerTarget): void => {
    setFontPickerTarget(target);
    setFontPickerQuery('');
  };

  const handleFontSelect = (fontFamily: string): void => {
    if (fontPickerTarget === 'main') {
      handleAppearanceChange({ ...appearancePreferences, mainFontFamily: fontFamily, mainFontFilePath: null });
    }

    if (fontPickerTarget === 'chinese') {
      handleAppearanceChange({ ...appearancePreferences, chineseFontFamily: fontFamily, chineseFontFilePath: null });
    }

    if (fontPickerTarget === 'fallback') {
      handleAppearanceChange({ ...appearancePreferences, fallbackFontFamily: fontFamily, fallbackFontFilePath: null });
    }

    setFontPickerTarget(null);
  };

  const handleFontFileChoose = async (): Promise<void> => {
    const target = fontPickerTarget;

    if (!target) {
      return;
    }

    try {
      const app = getAppBridge();

      if (!app) {
        setError('Desktop bridge unavailable. Open ECHO Next in Electron to choose local font files.');
        return;
      }

      const fontFile = await app.chooseFontFile();

      if (!fontFile) {
        return;
      }

      const fontFamily = await registerAppearanceFontFile(target, fontFile);
      setFontFamilies((current) => Array.from(new Set([...current, fontFamily])).sort((a, b) => a.localeCompare(b)));

      if (target === 'main') {
        handleAppearanceChange({ ...appearancePreferences, mainFontFamily: fontFamily, mainFontFilePath: fontFile.path });
      }

      if (target === 'chinese') {
        handleAppearanceChange({ ...appearancePreferences, chineseFontFamily: fontFamily, chineseFontFilePath: fontFile.path });
      }

      if (target === 'fallback') {
        handleAppearanceChange({ ...appearancePreferences, fallbackFontFamily: fontFamily, fallbackFontFilePath: fontFile.path });
      }

      setFontPickerTarget(null);
      setError(null);
    } catch (fontError) {
      setError(fontError instanceof Error ? fontError.message : String(fontError));
    }
  };

  const activeNavItems = visibleNavItems.length ? visibleNavItems : settingsNavItems;
  const activeNavItem = settingsNavItems.find((item) => item.key === activeSection) ?? settingsNavItems[0];
  const ActiveNavIcon = activeNavItem.icon;
  const activeFontValue =
    fontPickerTarget === 'chinese'
      ? appearancePreferences.chineseFontFamily
      : fontPickerTarget === 'fallback'
        ? appearancePreferences.fallbackFontFamily
        : appearancePreferences.mainFontFamily;
  const activeFontTitle =
    fontPickerTarget === 'chinese'
      ? t('settings.appearance.font.chinese.title')
      : fontPickerTarget === 'fallback'
        ? t('settings.appearance.font.fallback.title')
        : t('settings.appearance.font.main.title');
  const dataBackupDirectory = dataBackupStatus?.directory ?? appSettings?.autoDataBackupDirectory ?? null;
  const dataBackupEnabled = appSettings?.autoDataBackupEnabled === true;
  const dataBackupIntervalDays = appSettings?.autoDataBackupIntervalDays ?? dataBackupStatus?.intervalDays ?? 7;
  const activeDataBackupProgress = dataBackupProgress?.running === true ? dataBackupProgress : dataBackupStatus?.progress?.running === true ? dataBackupStatus.progress : null;
  const dataBackupRunning = dataBackupBusy !== null || dataBackupStatus?.running === true || activeDataBackupProgress?.running === true;
  const dataBackupProgressPercent = typeof activeDataBackupProgress?.percent === 'number'
    ? Math.max(0, Math.min(100, Math.round(activeDataBackupProgress.percent)))
    : null;
  const dataBackupProgressPhaseLabel = activeDataBackupProgress
    ? t(dataBackupProgressPhaseLabels[activeDataBackupProgress.phase])
    : null;
  const dataBackupProgressEntryLabel = activeDataBackupProgress?.currentEntry
    ? activeDataBackupProgress.currentEntry
    : t('settings.general.dataBackup.progress.waiting');
  const dataBackupProgressCountLabel = activeDataBackupProgress
    ? activeDataBackupProgress.totalEntries
      ? `${activeDataBackupProgress.processedEntries}/${activeDataBackupProgress.totalEntries}`
      : `${activeDataBackupProgress.processedEntries}`
    : '';
  const dataBackupProgressBytesLabel = activeDataBackupProgress
    ? activeDataBackupProgress.totalBytes && activeDataBackupProgress.totalBytes > 0
      ? `${formatUpdateBytes(activeDataBackupProgress.processedBytes)} / ${formatUpdateBytes(activeDataBackupProgress.totalBytes)}`
      : formatUpdateBytes(activeDataBackupProgress.processedBytes)
    : '';
  const dataBackupLastLabel = dataBackupStatus?.lastBackupAt
    ? dataBackupStatus.lastBackupPath
      ? t('settings.general.dataBackup.meta.atPath', {
          time: formatProtectionTimestamp(dataBackupStatus.lastBackupAt),
          path: dataBackupStatus.lastBackupPath,
        })
      : formatProtectionTimestamp(dataBackupStatus.lastBackupAt)
    : t('settings.general.dataBackup.meta.noneYet');
  const dataBackupNextLabel = dataBackupEnabled && dataBackupDirectory
    ? formatProtectionTimestamp(dataBackupStatus?.nextBackupAt)
    : t('settings.general.dataBackup.meta.nextRunPending');
  const databaseHealthStatus = databaseProtectionStatus?.health.status;
  const latestHealthySnapshot = databaseProtectionStatus?.latestHealthySnapshot ?? null;
  const databaseProtectionBusy = databaseProtectionBusyAction !== null || dangerBusy;
  const databaseRecommendedAction = databaseProtectionStatus?.recommendedAction ?? 'none';
  const databaseQuarantined = databaseRecommendedAction === 'scrub-quarantined-database';
  const databaseUnrecoverable = databaseRecommendedAction === 'rebuild-empty-database';
  const databaseHealthLabel = t(getDatabaseHealthLabel(databaseHealthStatus));
  const databaseHealthBadgeLabel = databaseQuarantined ? t('settings.danger.database.badge.quarantined') : databaseHealthLabel;
  const databaseProtectionDescription = !databaseProtectionStatus
    ? t('settings.danger.database.description.loading')
    : databaseQuarantined
    ? t('settings.danger.database.description.quarantined')
    : databaseHealthStatus === 'ok'
    ? t('settings.danger.database.description.healthy')
    : databaseUnrecoverable
    ? t('settings.danger.database.description.unrecoverable')
    : t('settings.danger.database.description.recoverable');
  const databaseRecoverySteps = databaseQuarantined
    ? [
        t('settings.danger.database.steps.quarantined.1'),
        t('settings.danger.database.steps.quarantined.2'),
        t('settings.danger.database.steps.quarantined.3'),
      ]
    : databaseUnrecoverable
    ? [
        t('settings.danger.database.steps.unrecoverable.1'),
        t('settings.danger.database.steps.unrecoverable.2'),
        t('settings.danger.database.steps.unrecoverable.3'),
      ]
    : [
        t('settings.danger.database.steps.recoverable.1'),
        t('settings.danger.database.steps.recoverable.2'),
        t('settings.danger.database.steps.recoverable.3'),
      ];
  const databasePrimaryActionLabel = databaseQuarantined
    ? t('settings.danger.database.action.scrub')
    : databaseUnrecoverable
    ? t('settings.danger.database.action.rebuild')
    : t('settings.danger.database.action.restore');
  const databasePrimaryActionBusyLabel = databaseQuarantined
    ? t('settings.danger.database.action.scrubbing')
    : databaseUnrecoverable
      ? t('settings.danger.database.action.rebuilding')
      : t('settings.danger.database.action.restoring');
  const databasePrimaryActionDisabled =
    databaseProtectionBusy ||
    databaseProtectionStatus?.hasRunningScan ||
    (databaseQuarantined ? !databaseProtectionStatus?.canScrubQuarantinedDatabase : databaseUnrecoverable ? !databaseProtectionStatus : !latestHealthySnapshot);
  const handleDatabasePrimaryRecoveryAction = databaseQuarantined
    ? handleScrubQuarantinedDatabase
    : databaseUnrecoverable
    ? handleRebuildEmptyLibraryDatabase
    : handleRestoreDatabaseSnapshot;
  const databasePathLabel = databaseProtectionStatus?.databasePath ?? t('settings.danger.database.meta.pending');
  const databaseSnapshotLabel = latestHealthySnapshot
    ? `${formatProtectionTimestamp(latestHealthySnapshot.createdAt)} · ${formatUpdateBytes(latestHealthySnapshot.databaseSizeBytes)}`
    : t('settings.danger.database.meta.noSnapshot');
  const databaseArchiveLabel = databaseProtectionStatus?.latestArchive
    ? `${formatProtectionTimestamp(databaseProtectionStatus.latestArchive.createdAt)} · ${formatUpdateBytes(databaseProtectionStatus.latestArchive.databaseSizeBytes)}`
    : t('settings.danger.database.meta.noArchive');
  const databasePrimaryActionUnavailableReason =
    databaseProtectionStatus?.hasRunningScan
      ? null
      : databaseQuarantined && !databaseProtectionStatus?.canScrubQuarantinedDatabase
      ? t('settings.danger.database.unavailable.scrub')
      : !databaseQuarantined && !databaseUnrecoverable && !latestHealthySnapshot
      ? t('settings.danger.database.unavailable.restore')
      : null;
  const formatLastFmTimestamp = (value: string | null | undefined): string => {
    if (!value) {
      return t('settings.integrations.lastfm.never');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return t('settings.integrations.lastfm.never');
    }

    return new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };
  const discordPresenceLabel = !discordPresenceStatus?.enabled
    ? 'Disabled'
    : discordPresenceStatus.connected
      ? 'Connected'
      : discordPresenceStatus.lastError
        ? `Error: ${discordPresenceStatus.lastError}`
        : discordPresenceStatus.available
          ? 'Enabled'
          : 'Discord not running';
  const smtcLabel = !appSettings?.smtcEnabled
    ? t('common.disabled')
    : smtcDiagnostics?.recoveryInFlight
      ? 'Recovering'
      : smtcDiagnostics?.hostState ?? 'Not checked';
  const lastFmLabel = !lastFmStatus?.enabled
    ? t('common.disabled')
    : lastFmStatus.connected
      ? t('settings.integrations.lastfm.status.connected', { username: lastFmStatus.username ?? '' }).trim()
      : lastFmStatus.authPending
        ? t('settings.integrations.lastfm.status.pending')
      : lastFmStatus.lastError
        ? t('settings.integrations.lastfm.status.error', { error: lastFmStatus.lastError })
        : t('settings.integrations.lastfm.status.notConnected');
  const lastFmActiveLabel = lastFmStatus?.activeTrack
    ? t('settings.integrations.lastfm.activeProgress', {
        artist: lastFmStatus.activeTrack.artist,
        title: lastFmStatus.activeTrack.title,
        played: lastFmStatus.activeTrack.playedSeconds,
        threshold: lastFmStatus.activeTrack.thresholdSeconds,
      })
    : t('settings.integrations.lastfm.noActiveTrack');
  const themeScheduleEnabled = appSettings?.appearanceThemeScheduleEnabled === true;
  const themeScheduleDarkAt = normalizeThemeScheduleTime(appSettings?.appearanceThemeScheduleDarkAt, defaultThemeScheduleDarkAt);
  const themeScheduleLightAt = normalizeThemeScheduleTime(appSettings?.appearanceThemeScheduleLightAt, defaultThemeScheduleLightAt);
  const scheduledThemeMode = resolveThemeModeForSchedule({
    appearanceTheme: appSettings?.appearanceTheme ?? defaultThemeMode,
    appearanceThemeScheduleEnabled: themeScheduleEnabled,
    appearanceThemeScheduleDarkAt: themeScheduleDarkAt,
    appearanceThemeScheduleLightAt: themeScheduleLightAt,
  });
  const sidebarSettingsText = {
    title: t(sidebarSettingsCopy.titleKey),
    description: t(sidebarSettingsCopy.descriptionKey),
    mainGroup: t(sidebarSettingsCopy.mainGroupKey),
    utilityGroup: t(sidebarSettingsCopy.utilityGroupKey),
    reset: t(sidebarSettingsCopy.resetKey),
    expand: t(sidebarSettingsCopy.expandKey),
    collapse: t(sidebarSettingsCopy.collapseKey),
    visible: t(sidebarSettingsCopy.visibleKey),
    hidden: t(sidebarSettingsCopy.hiddenKey),
    fixed: t(sidebarSettingsCopy.fixedKey),
    noItems: t(sidebarSettingsCopy.noItemsKey),
  };
  const themeScheduleStatus = themeScheduleEnabled
    ? t('settings.appearance.themeSchedule.status.enabled', {
        darkAt: themeScheduleDarkAt,
        lightAt: themeScheduleLightAt,
        mode: scheduledThemeMode === 'dark'
          ? t('settings.appearance.theme.dark')
          : t('settings.appearance.theme.light'),
      })
    : t('settings.appearance.themeSchedule.status.disabled');
  const transportFadeInMs = appSettings?.audioTransportFadeInMs ?? 80;
  const transportFadeOutMs = appSettings?.audioTransportFadeOutMs ?? transportFadeInMs;
  const transportFadeDurationMs = appSettings?.audioTransportFadeEnabled
    ? Math.max(0, Math.round((transportFadeInMs + transportFadeOutMs) / 2))
    : 0;
  const transportFadeDurationLabel = transportFadeDurationMs > 0
    ? `${transportFadeDurationMs} ms`
    : t('settings.playback.transportFade.status.disabled');
  const replayGainMode = appSettings?.replayGainMode ?? 'track';
  const replayGainTargetLufs = appSettings?.replayGainTargetLufs ?? SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS;
  const replayGainModeLabel = replayGainMode === 'album'
    ? t('settings.playback.replayGain.mode.album')
    : replayGainMode === 'off'
      ? t('settings.playback.replayGain.mode.off')
      : t('settings.playback.replayGain.mode.track');
  const replayGainAppliedLabel = Number.isFinite(status?.replayGainAppliedDb) ? `${status?.replayGainAppliedDb?.toFixed(2)} dB` : '0 dB';
  const replayGainProgressLabel = replayGainAnalysisJob ? `${replayGainAnalysisJob.processedTracks}/${replayGainAnalysisJob.totalTracks}` : t('settings.playback.replayGain.notRun');

  return (
    <div className="settings-page no-drag">
      <header className="settings-header">
        <div className="settings-header-copy">
          <h1>{t('route.settings.label')}</h1>
          <div className="settings-header-context">
            <span className="settings-header-context-icon">
              <ActiveNavIcon size={14} aria-hidden="true" />
            </span>
            <span>{t(activeNavItem.labelKey)}</span>
            <em>{t(activeNavItem.descriptionKey)}</em>
          </div>
        </div>
        <label className="settings-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={settingsQuery}
            onChange={(event) => setSettingsQuery(event.target.value)}
            onKeyDown={handleSettingsSearchKeyDown}
            placeholder={t('settings.header.searchPlaceholder')}
          />
          {settingsQuery.trim() ? (
            <div className="settings-search-results" role="listbox" aria-label={t('settings.header.searchPlaceholder')}>
              {settingsSearchResults.length ? (
                settingsSearchResults.slice(0, 6).map((result, index) => (
                  <button
                    className="settings-search-result"
                    key={result.id}
                    type="button"
                    role="option"
                    aria-selected={index === 0}
                    onClick={() => jumpToSettingsSection(result.sectionKey, { clearSearch: true, targetId: result.targetId })}
                  >
                    <span>{result.title}</span>
                    <small>{result.description}</small>
                  </button>
                ))
              ) : (
                <p className="settings-search-empty">没有匹配的设置</p>
              )}
            </div>
          ) : null}
        </label>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label={t('route.settings.label')}>
          {activeNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            const isDanger = item.key === 'danger';

            return (
              <button
                className={`settings-nav-item ${isActive ? 'active' : ''} ${isDanger ? 'is-danger' : ''}`}
                key={item.key}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleNavClick(item.key)}
              >
                <span className="settings-nav-icon">
                  <Icon size={17} />
                </span>
                <span className="settings-nav-copy">
                  <span className="settings-nav-label">{t(item.labelKey)}</span>
                  <span className="settings-nav-desc">{t(item.descriptionKey)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className={`settings-scroll-frame ${settingsHorizontalScroll.available ? 'has-horizontal-overflow' : ''}`}>
          <button
            className="settings-horizontal-pager settings-horizontal-pager--left"
            type="button"
            aria-label="向左翻动设置内容"
            disabled={!settingsHorizontalScroll.canLeft}
            onClick={() => handleSettingsHorizontalScroll(-1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            className="settings-horizontal-pager settings-horizontal-pager--right"
            type="button"
            aria-label="向右翻动设置内容"
            disabled={!settingsHorizontalScroll.canRight}
            onClick={() => handleSettingsHorizontalScroll(1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>

          <div className="settings-scroll-shell" ref={settingsScrollShellRef}>
            <div className="settings-content">
            <SettingSection activeKey={activeSection} icon={MessageSquare} id="general" title={t('settings.nav.general.label')}>
              <SettingRow title={t('settings.general.language.title')} description={t('settings.general.language.description')}>
                <div className="settings-chip-row">
                  {localeOptions.map((option) => (
                    <ChipButton active={locale === option.locale} key={option.locale} onClick={() => setLocale(option.locale)}>
                      {option.label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-first-run-wizard"
                highlighted={highlightedSettingId === 'settings-row-first-run-wizard'}
                title={t('settings.general.firstRunWizard.title')}
                description={t('settings.general.firstRunWizard.description')}
              >
                <ToggleButton
                  active={appSettings?.onboardingCompleted === false}
                  disabled={!appSettings}
                  onClick={handleFirstRunWizardToggle}
                />
              </SettingRow>
              <SettingRow title={t('settings.general.closeToTray')}>
                <ToggleButton
                  active={appSettings?.hideToTrayOnClose ?? false}
                  disabled={!appSettings}
                  onClick={handleCloseToTrayToggle}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-sidebar-auto-hide"
                highlighted={highlightedSettingId === 'settings-row-sidebar-auto-hide'}
                title={t('settings.general.sidebarAutoHide.title')}
                description={t('settings.general.sidebarAutoHide.description')}
              >
                <ToggleButton
                  active={appSettings?.sidebarAutoHideEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      sidebarAutoHideEnabled: !(appSettings?.sidebarAutoHideEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('settings.general.rememberWindowSize.title')} description={t('settings.general.rememberWindowSize.description')}>
                <ToggleButton
                  active={appSettings?.rememberWindowSizeEnabled ?? true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      rememberWindowSizeEnabled: !(appSettings?.rememberWindowSizeEnabled ?? true),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-fast-startup"
                highlighted={highlightedSettingId === 'settings-row-fast-startup'}
                title={t('settings.general.fastStartup.title')}
                description={t('settings.general.fastStartup.description')}
              >
                <ToggleButton
                  active={appSettings?.fastStartupEnabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ fastStartupEnabled: !(appSettings?.fastStartupEnabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-data-protection-disabled"
                highlighted={highlightedSettingId === 'settings-row-data-protection-disabled'}
                title="关闭数据保护"
                description="打开后不再执行启动、后台、扫描完成和更新前的数据保护快照。默认关闭。"
              >
                <ToggleButton
                  active={appSettings?.dataProtectionDisabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ dataProtectionDisabled: !(appSettings?.dataProtectionDisabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-player-waveform-progress"
                highlighted={highlightedSettingId === 'settings-row-player-waveform-progress'}
                title={t('settings.general.playerWaveformProgress.title')}
                description={t('settings.general.playerWaveformProgress.description')}
              >
                <ToggleButton
                  active={appSettings?.playerWaveformProgressEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      playerWaveformProgressEnabled: !(appSettings?.playerWaveformProgressEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-signal-path-control"
                highlighted={highlightedSettingId === 'settings-row-signal-path-control'}
                title="底栏信号路径"
                description="在底部播放栏显示 Signal Path 入口。默认关闭，歌词页始终隐藏。"
              >
                <ToggleButton
                  active={appSettings?.signalPathControlEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      signalPathControlEnabled: !(appSettings?.signalPathControlEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-home-waveform-visualizer"
                highlighted={highlightedSettingId === 'settings-row-home-waveform-visualizer'}
                title={t('settings.general.homeWaveformVisualizer.title')}
                description={t('settings.general.homeWaveformVisualizer.description')}
              >
                <ToggleButton
                  active={appSettings?.homeWaveformVisualizerEnabled !== false}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      homeWaveformVisualizerEnabled: !(appSettings?.homeWaveformVisualizerEnabled ?? true),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-audio-visual-spectrum"
                highlighted={highlightedSettingId === 'settings-row-audio-visual-spectrum'}
                title="实时频谱分析"
                description="默认关闭。开启后主页波形会请求主进程计算频谱；低负载播放模式会强制关闭它。"
              >
                <ToggleButton
                  active={appSettings?.audioVisualSpectrumEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      audioVisualSpectrumEnabled: appSettings?.audioVisualSpectrumEnabled !== true,
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-home-random-hero-title"
                highlighted={highlightedSettingId === 'settings-row-home-random-hero-title'}
                title={t('settings.general.homeRandomHeroTitle.title')}
                description={t('settings.general.homeRandomHeroTitle.description')}
              >
                <ToggleButton
                  active={appSettings?.homeRandomHeroTitleEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      homeRandomHeroTitleEnabled: !(appSettings?.homeRandomHeroTitleEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('settings.general.searchTraditionalVariants.title')} description={t('settings.general.searchTraditionalVariants.description')}>
                <ToggleButton
                  active={appSettings?.chineseCrossScriptSearchEnabled ?? true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      chineseCrossScriptSearchEnabled: !(appSettings?.chineseCrossScriptSearchEnabled ?? true),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-artist-streaming-albums"
                highlighted={highlightedSettingId === 'settings-row-artist-streaming-albums'}
                title={t('settings.general.artistStreamingAlbums.title')}
                description={t('settings.general.artistStreamingAlbums.description')}
              >
                <div className="artist-streaming-albums-setting-control">
                  <div className="settings-chip-row" aria-label="流媒体专辑来源">
                    {artistStreamingAlbumProviderOptions.map((option) => (
                      <ChipButton
                        active={(appSettings?.artistStreamingAlbumsProvider ?? defaultArtistStreamingAlbumsProvider) === option.provider}
                        disabled={!appSettings}
                        key={option.provider}
                        title={option.description}
                        onClick={() => patchAppSettings({ artistStreamingAlbumsProvider: option.provider })}
                      >
                        {option.label}
                      </ChipButton>
                    ))}
                  </div>
                  <ToggleButton
                    active={appSettings?.artistStreamingAlbumsEnabled !== false}
                    disabled={!appSettings}
                    onClick={() =>
                      patchAppSettings({
                        artistStreamingAlbumsEnabled: !(appSettings?.artistStreamingAlbumsEnabled ?? true),
                      })
                    }
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-artist-online-info-sources"
                highlighted={highlightedSettingId === 'settings-row-artist-online-info-sources'}
                title={t('settings.general.artistInfoSources.title')}
                description={t('settings.general.artistInfoSources.description')}
              >
                <div className="settings-chip-row">
                  {artistOnlineInfoSourceOptions.map((option) => (
                    <ChipButton
                      active={(appSettings?.onlineArtistInfoSources?.[0] ?? defaultArtistOnlineInfoSources[0]) === option.source}
                      disabled={!appSettings}
                      key={option.source}
                      title={option.description}
                      onClick={() => handleArtistOnlineInfoSourceSelect(option.source)}
                    >
                      {option.label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              {mysteriousKeyVisible ? (
                <SettingRow
                  id="settings-row-mysterious-key"
                  highlighted={highlightedSettingId === 'settings-row-mysterious-key'}
                  className="setting-row--full setting-row--compact-panel"
                  title="Mysterious key"
                  description="Enter a special key to unlock hidden capabilities."
                >
                  {downloadsFeatureUnlocked ? (
                    <div className="settings-mysterious-key-accepted">
                      <div className="settings-inline-toggle settings-inline-toggle--compact">
                        <span>Accepted</span>
                        <Check size={16} />
                      </div>
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={!appSettings}
                        onClick={handleDownloadFeatureRelease}
                      >
                        <RotateCcw size={15} />
                        释放
                      </button>
                    </div>
                  ) : (
                    <div className="settings-cache-panel settings-cache-panel--download">
                      <label className="settings-input-field" htmlFor="mysterious-key">
                        <input
                          id="mysterious-key"
                          type="text"
                          value={downloadUnlockInput}
                          onChange={(event) => {
                            setDownloadUnlockInput(event.target.value);
                            setDownloadUnlockMessage(null);
                          }}
                          onKeyDown={handleDownloadUnlockKeyDown}
                          placeholder="Enter key"
                        />
                      </label>
                      <div className="settings-chip-row settings-chip-row--left">
                        <button
                          className="settings-action-button"
                          type="button"
                          disabled={!appSettings || !downloadUnlockInput.trim()}
                          onClick={handleDownloadFeatureUnlock}
                        >
                          <Check size={15} />
                          Apply
                        </button>
                      </div>
                      {downloadUnlockMessage ? <p className="settings-inline-note">{downloadUnlockMessage}</p> : null}
                    </div>
                  )}
                </SettingRow>
              ) : null}
              <SettingRow
                id="settings-row-dev-console"
                highlighted={highlightedSettingId === 'settings-row-dev-console'}
                title="开发控制台"
                description="显示 ECHO 当前运行期的 stdout/stderr、主进程日志和渲染器 console，方便像 npm run dev 一样排查问题。"
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-chip-row">
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenDevConsole()}>
                      <Code2 size={15} />
                      打开控制台
                    </button>
                  </div>
                  {devConsoleMessage ? <p className="settings-inline-note">{devConsoleMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingRow title={t('settings.general.backup.title')} description={t('settings.general.backup.description')}>
                <div className="settings-chip-row">
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={settingsBackupBusy !== null}
                    onClick={() => void handleExportSettings()}
                  >
                    <Download size={15} />
                    {settingsBackupBusy === 'export' ? '导出中...' : t('settings.general.backup.export')}
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={settingsBackupBusy !== null}
                    onClick={() => void handleImportSettings()}
                  >
                    <FileText size={15} />
                    {settingsBackupBusy === 'import' ? '导入中...' : t('settings.general.backup.import')}
                  </button>
                </div>
                {settingsBackupMessage ? <StatusText tone="good">{settingsBackupMessage}</StatusText> : null}
              </SettingRow>
              <SettingRow
                className="setting-row--compact-panel"
                id="settings-row-data-backup"
                highlighted={highlightedSettingId === 'settings-row-data-backup'}
                title={t('settings.general.dataBackup.title')}
                description={t('settings.general.dataBackup.description')}
              >
                <div className="settings-data-backup-panel">
                  <div className="settings-data-backup-primary">
                    <div className="settings-data-backup-switch">
                      <ToggleButton
                        active={dataBackupEnabled}
                        disabled={!appSettings || !dataBackupDirectory || dataBackupRunning}
                        onClick={() =>
                          patchAppSettings({
                            autoDataBackupEnabled: !dataBackupEnabled,
                          })
                        }
                      />
                      <div>
                        <strong>{dataBackupEnabled ? t('settings.general.dataBackup.status.enabled') : t('settings.general.dataBackup.status.disabled')}</strong>
                        <StatusText tone={dataBackupEnabled ? 'good' : 'muted'}>
                          {dataBackupDirectory ? t('settings.general.dataBackup.hint.directoryReady') : t('settings.general.dataBackup.hint.chooseDirectory')}
                        </StatusText>
                      </div>
                    </div>
                    <div className="settings-data-backup-frequency" aria-label={t('settings.general.dataBackup.frequency.aria')}>
                      {([3, 7, 30] as const).map((days) => (
                        <ChipButton
                          active={dataBackupIntervalDays === days}
                          key={days}
                          onClick={() => patchAppSettings({ autoDataBackupIntervalDays: days })}
                        >
                          {days === 30 ? t('settings.general.dataBackup.frequency.monthly') : t('settings.general.dataBackup.frequency.days', { days })}
                        </ChipButton>
                      ))}
                    </div>
                  </div>
                  <div className="settings-data-backup-meta">
                    <span>
                      <em>{t('settings.general.dataBackup.meta.directory')}</em>
                      <strong>{dataBackupDirectory ?? t('settings.general.dataBackup.meta.notSet')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.general.dataBackup.meta.lastBackup')}</em>
                      <strong>{dataBackupLastLabel}</strong>
                    </span>
                    <span>
                      <em>{t('settings.general.dataBackup.meta.nextRun')}</em>
                      <strong>{dataBackupNextLabel}</strong>
                    </span>
                  </div>
                  {activeDataBackupProgress ? (
                    <div className="settings-data-backup-progress" role="status" aria-live="polite">
                      <div className="settings-data-backup-progress-head">
                        <strong>{dataBackupProgressPhaseLabel}</strong>
                        <span>{dataBackupProgressPercent !== null ? `${dataBackupProgressPercent}%` : t('settings.general.dataBackup.progress.measuring')}</span>
                      </div>
                      <div
                        className="settings-data-backup-progress-track"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={dataBackupProgressPercent ?? undefined}
                        aria-label={dataBackupProgressPhaseLabel ?? t('settings.general.dataBackup.title')}
                        data-indeterminate={dataBackupProgressPercent === null ? 'true' : undefined}
                      >
                        <span style={{ width: `${dataBackupProgressPercent ?? 36}%` }} />
                      </div>
                      <div className="settings-data-backup-progress-detail">
                        <span title={dataBackupProgressEntryLabel}>{dataBackupProgressEntryLabel}</span>
                        <em>
                          {dataBackupProgressCountLabel}
                          {dataBackupProgressBytesLabel ? ` - ${dataBackupProgressBytesLabel}` : ''}
                        </em>
                      </div>
                    </div>
                  ) : null}
                  <div className="settings-data-backup-actions">
                    <button className="settings-action-button" type="button" disabled={dataBackupRunning} onClick={() => void handleChooseDataBackupDirectory()}>
                      <FolderOpen size={15} />
                      {dataBackupBusy === 'choose' ? t('settings.general.dataBackup.action.choosingDirectory') : t('settings.general.dataBackup.action.chooseDirectory')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!dataBackupDirectory || dataBackupRunning}
                      onClick={() => void handleRunDataBackupNow()}
                    >
                      <Download size={15} />
                      {dataBackupBusy === 'run' ? t('settings.general.dataBackup.action.backingUp') : t('settings.general.dataBackup.action.backupNow')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={dataBackupRunning} onClick={() => void handleImportDataBackup()}>
                      <FileText size={15} />
                      {dataBackupBusy === 'import' ? t('settings.general.dataBackup.action.importingBackup') : t('settings.general.dataBackup.action.importBackup')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!dataBackupDirectory || dataBackupRunning}
                      onClick={() => void handleOpenDataBackupDirectory()}
                    >
                      <FolderOpen size={15} />
                      {t('settings.general.dataBackup.action.openDirectory')}
                    </button>
                  </div>
                  {dataBackupStatus?.lastError ? <StatusText tone="muted">{dataBackupStatus.lastError}</StatusText> : null}
                  {dataBackupMessage ? <StatusText tone="good">{dataBackupMessage}</StatusText> : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--package-export"
                title={t('settings.general.dataPackage.title')}
                description={t('settings.general.dataPackage.description')}
              >
                <div className="settings-package-export-panel">
                  <div className="settings-chip-row">
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={settingsBackupBusy !== null}
                      onClick={() => void handleExportDataPackage()}
                    >
                      <Download size={15} />
                      {settingsBackupBusy === 'dataPackage' ? t('settings.general.dataPackage.action.exporting') : t('settings.general.dataPackage.action.export')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={databaseProtectionBusy} onClick={() => void handleOpenDataProtectionFolder()}>
                      <FolderOpen size={15} />
                      {t('settings.general.dataPackage.action.recovery')}
                    </button>
                  </div>
                  <p className="settings-inline-note">{t('settings.general.dataPackage.note')}</p>
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Zap} id="playback" title={t('settings.nav.playback.label')}>
              <SettingRow title={t('settings.playback.outputMode.title')} description={t('settings.playback.outputMode.description')}>
                <div className="settings-chip-row">
                  {playbackOutputModesForPlatform.map((mode) => (
                    <ChipButton active={outputMode === mode} key={mode} onClick={() => handleOutputModeChange(mode)}>
                      {getPlaybackOutputModeLabel(mode, t)}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              {sharedBackendOptionsForPlatform.length > 0 ? (
                <SettingRow title={t('settings.playback.sharedBackend.title')} description={t(getSharedBackendDescriptionKey(rendererPlatform))}>
                  <div className="settings-chip-row">
                    {sharedBackendOptionsForPlatform.map(([backend, labelKey]) => (
                      <ChipButton active={outputMode === 'shared' && sharedBackend === backend} key={backend} onClick={() => handleSharedBackendChange(backend)}>
                        {t(labelKey)}
                      </ChipButton>
                    ))}
                  </div>
                </SettingRow>
              ) : null}
              <SettingRow
                id="settings-row-output-device"
                highlighted={highlightedSettingId === 'settings-row-output-device'}
                title={t('settings.playback.outputDevice.title')}
                description={t('settings.playback.outputDevice.description')}
              >
                <StyledSelect
                  className="settings-select-control"
                  value={selectedDeviceId}
                  options={outputDeviceOptions}
                  onChange={handleDeviceChange}
                  ariaLabel={t('settings.playback.outputDevice.title')}
                  disabled={compatibleDevices.length === 0}
                  showFilterIcon={false}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-low-load-playback"
                highlighted={highlightedSettingId === 'settings-row-low-load-playback'}
                title={t('audioDrawer.option.lowLoadPlaybackMode')}
                description={t('audioDrawer.option.lowLoadPlaybackModeDescription')}
              >
                <ToggleButton
                  active={appSettings?.lowLoadPlaybackModeEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      lowLoadPlaybackModeEnabled: appSettings?.lowLoadPlaybackModeEnabled !== true,
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-low-load-playback-enhancements"
                highlighted={highlightedSettingId === 'settings-row-low-load-playback-enhancements'}
                title={t('audioDrawer.option.lowLoadPlaybackEnhancements')}
                description={t('audioDrawer.option.lowLoadPlaybackEnhancementsDescription')}
              >
                <ToggleButton
                  active={appSettings?.lowLoadPlaybackEnhancementsEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      lowLoadPlaybackEnhancementsEnabled: appSettings?.lowLoadPlaybackEnhancementsEnabled !== true,
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.playback.advancedPanel.title')}
                description={t('settings.playback.advancedPanel.description')}
              >
                <button
                  className="settings-collapse-toggle settings-playback-advanced-toggle"
                  type="button"
                  aria-expanded={playbackAdvancedPanelExpanded}
                  onClick={togglePlaybackAdvancedPanelExpanded}
                >
                  <ChevronDown size={15} />
                  <span>
                    <strong>{playbackAdvancedPanelExpanded ? t('settings.playback.advancedPanel.action.collapse') : t('settings.playback.advancedPanel.action.expand')}</strong>
                    <small>{t('settings.playback.advancedPanel.memory')}</small>
                  </span>
                </button>
              </SettingRow>
              {playbackAdvancedPanelExpanded ? (
                <>
              <SettingRow title={t('settings.playback.troubleshooting.title')} description={t('settings.playback.troubleshooting.description')}>
                <div className="settings-chip-row">
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={audioResetBusy || windowsAudioRestartBusy}
                    onClick={() => void handleAudioEngineReset()}
                  >
                    <RotateCw size={15} />
                    {audioResetBusy ? t('settings.playback.troubleshooting.softBusy') : t('settings.playback.troubleshooting.softAction')}
                  </button>
                  {windowsIntegrationAvailable ? (
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={audioResetBusy || windowsAudioRestartBusy}
                      onClick={() => void handleWindowsAudioServiceRestart()}
                    >
                      <ShieldAlert size={15} />
                      {windowsAudioRestartBusy ? t('settings.playback.troubleshooting.hardBusy') : t('settings.playback.troubleshooting.hardAction')}
                    </button>
                  ) : null}
                  {audioResetMessage ? <StatusText tone="good">{audioResetMessage}</StatusText> : null}
                </div>
              </SettingRow>
              <SettingRow
                title={t('settings.playback.issueDiagnostics.title')}
                description={t('settings.playback.issueDiagnostics.description')}
              >
                <ToggleButton
                  active={appSettings?.audioIssueDiagnosticsWindowEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      audioIssueDiagnosticsWindowEnabled: !(appSettings?.audioIssueDiagnosticsWindowEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow title={t('settings.playback.juceOutput.title')} description={t('settings.playback.juceOutput.description')}>
                <ToggleButton
                  active={appSettings?.audioUseJuceOutput === true}
                  disabled={!appSettings}
                  onClick={() => void handleJuceOutputToggle()}
                />
              </SettingRow>
              <SettingRow title={t('settings.playback.nativeDecode.title')} description={t('settings.playback.nativeDecode.description')}>
                <ToggleButton
                  active={appSettings?.audioUseJuceDecode === true}
                  disabled={!appSettings}
                  onClick={() => void handleJuceDecodeToggle()}
                />
              </SettingRow>
              {advancedNativeOutputAvailable ? (
                <>
              <SettingRow
                title={t('settings.playback.dsdDop.title')}
                description={
                  <>
                    {t('settings.playback.dsdDop.description')}
                    <span className="settings-inline-warning-text">{t('settings.playback.dsdDop.requiresAsio')}</span>
                  </>
                }
              >
                <ToggleButton
                  active={appSettings?.audioDsdOutputMode === 'dop'}
                  disabled={!appSettings}
                  onClick={() => void handleDsdDopToggle()}
                />
              </SettingRow>
              <SettingRow
                title={t('settings.playback.asioNativeDsd.title')}
                description={
                  <>
                    {t('settings.playback.asioNativeDsd.description')}
                    <span className="settings-inline-warning-text">{t('settings.playback.dsdDop.requiresAsio')}</span>
                  </>
                }
              >
                <ToggleButton
                  active={appSettings?.audioAsioNativeDsdExperimentalEnabled === true}
                  disabled={!appSettings}
                  onClick={() => void handleAsioNativeDsdExperimentalToggle()}
                />
              </SettingRow>
              <SettingRow title={t('audioDrawer.guard.asioUnavailable.title')} description={t('audioDrawer.guard.asioUnavailable.description')}>
                <ToggleButton
                  active={appSettings?.audioAsioUnavailableFallbackEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() => void handleAsioUnavailableFallbackToggle()}
                />
              </SettingRow>
              <SettingRow title={t('audioDrawer.guard.exclusiveInstability.title')} description={t('audioDrawer.guard.exclusiveInstability.description')}>
                <ToggleButton
                  active={appSettings?.audioExclusiveInstabilityFallbackEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() => void handleExclusiveInstabilityFallbackToggle()}
                />
              </SettingRow>
                </>
              ) : null}
              <SettingRow title={t('audioDrawer.guard.soxrFallback.title')} description={t('audioDrawer.guard.soxrFallback.description')}>
                <ToggleButton
                  active={appSettings?.audioSoxrFallbackEnabled ?? true}
                  disabled={!appSettings}
                  onClick={() => void handleSoxrFallbackToggle()}
                />
              </SettingRow>
              <SettingRow title={t('settings.playback.speedMode.title')} description={t('settings.playback.speedMode.description')}>
                <div className="settings-chip-row">
                  {playbackSpeedModes.map((item) => (
                    <ChipButton
                      active={(appSettings?.playbackSpeedMode ?? status?.playbackSpeedMode ?? 'nightcore') === item.mode}
                      key={item.mode}
                      onClick={() => handlePlaybackSpeedModeChange(item.mode)}
                    >
                      {item.label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title={t('settings.playback.exportFormat.title')} description={t('settings.playback.exportFormat.description')}>
                <div className="settings-chip-row">
                  {audioExportFormatOptions.map((item) => (
                    <ChipButton
                      active={(appSettings?.audioExportFormat ?? 'mp3') === item.format}
                      key={item.format}
                      onClick={() => patchAppSettings({ audioExportFormat: item.format })}
                    >
                      {item.label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-fixed-volume"
                highlighted={highlightedSettingId === 'settings-row-fixed-volume'}
                title={t('settings.playback.fixedVolume.title')}
                description={t('settings.playback.fixedVolume.description')}
              >
                <div className="settings-chip-row">
                  <ToggleButton
                    active={appSettings?.fixedVolumeEnabled ?? false}
                    disabled={!appSettings}
                    onClick={() => {
                      const enabled = !(appSettings?.fixedVolumeEnabled ?? false);
                      patchAppSettings({
                        fixedVolumeEnabled: enabled,
                        ...(enabled ? { playerVolume: 1 } : {}),
                      });
                      if (enabled) {
                        void getAudioBridge()?.setOutput({ volume: 1 }).then(setStatus).catch(() => undefined);
                      }
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-transport-fade"
                highlighted={highlightedSettingId === 'settings-row-transport-fade'}
                title={t('settings.playback.transportFade.title')}
                description={t('settings.playback.transportFade.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--transport-fade">
                  <label className="settings-transport-fade-slider" data-disabled={!appSettings ? 'true' : undefined}>
                    <span className="settings-transport-fade-copy">{t('settings.playback.transportFade.field.duration')}</span>
                    <strong className="settings-transport-fade-value">{transportFadeDurationLabel}</strong>
                    <input
                      type="range"
                      min={0}
                      max={2000}
                      step={10}
                      value={transportFadeDurationMs}
                      disabled={!appSettings}
                      aria-valuetext={transportFadeDurationLabel}
                      onChange={(event) => {
                        const durationMs = Math.max(0, Math.min(2000, Number(event.currentTarget.value) || 0));
                        patchAppSettings({
                          audioTransportFadeEnabled: durationMs > 0,
                          audioTransportFadeInMs: durationMs,
                          audioTransportFadeOutMs: durationMs,
                          audioTransportFadeCurve: 'smooth',
                        });
                      }}
                    />
                  </label>
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-mini-player"
                highlighted={highlightedSettingId === 'settings-row-mini-player'}
                title={t('settings.playback.miniPlayer.title')}
                description={t('settings.playback.miniPlayer.description')}
              >
                <div className="settings-chip-row">
                  <StatusText tone={appSettings?.miniPlayerEnabled ? 'good' : 'muted'}>
                    {appSettings?.miniPlayerEnabled ? t('settings.playback.miniPlayer.status.visible') : t('settings.playback.miniPlayer.status.hidden')}
                  </StatusText>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={!appSettings || !window.echo?.miniPlayer}
                    onClick={() => void handleMiniPlayerVisibleChange(!(appSettings?.miniPlayerEnabled ?? false))}
                  >
                    <Headphones size={15} />
                    {appSettings?.miniPlayerEnabled ? t('settings.playback.miniPlayer.action.hide') : t('settings.playback.miniPlayer.action.show')}
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={!appSettings || !window.echo?.miniPlayer}
                    onClick={() => void handleMiniPlayerResetBounds()}
                  >
                    <RotateCcw size={15} />
                    {t('miniPlayer.action.resetPosition')}
                  </button>
                </div>
                <div className="settings-chip-row">
                  <span className="settings-inline-note">{t('settings.playback.miniPlayer.autoHideNote')}</span>
                  <ToggleButton
                    active={appSettings?.miniPlayerAutoHideMainWindow ?? false}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ miniPlayerAutoHideMainWindow: !(appSettings?.miniPlayerAutoHideMainWindow ?? false) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-segment-loop"
                highlighted={highlightedSettingId === 'settings-row-segment-loop'}
                title={t('settings.playback.segmentLoop.title')}
                description={t('settings.playback.segmentLoop.description')}
              >
                <div className="settings-segment-loop-panel">
                  <SegmentLoopPanel
                    artist={segmentArtist}
                    disabled={segmentLoopDisabled}
                    durationSeconds={segmentDurationSeconds}
                    isPlaying={segmentVisualState === 'playing'}
                    positionSeconds={segmentPositionSeconds}
                    title={segmentTitle}
                    trackKey={segmentTrackKey}
                    onSeek={(nextPositionSeconds) => void handleSegmentSeek(nextPositionSeconds)}
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-automix"
                highlighted={highlightedSettingId === 'settings-row-automix'}
                title={t('settings.playback.automix.title')}
                description={t('settings.playback.automix.description')}
              >
                <div className="settings-chip-row">
                  {automixTemporarilyDisabled ? (
                    <StatusText tone="muted">暂停中</StatusText>
                  ) : status?.automix?.active && !status.automix.gapless && status.automix.transitionMode ? (
                    <StatusText tone="good">
                      {`${status.automix.engine ?? 'fallback'} / ${status.automix.transitionMode} / ${
                        status.automix.overlapSeconds?.toFixed(1) ?? '?'
                      }s / tempo ${status.automix.tempoRatio?.toFixed(3) ?? '1.000'}`}
                    </StatusText>
                  ) : null}
                  <ToggleButton
                    active={automixTemporarilyDisabled ? false : playbackQueue.automixEnabled}
                    disabled={automixTemporarilyDisabled}
                    onClick={() => playbackQueue.setAutomixEnabled(!playbackQueue.automixEnabled)}
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-gapless-playback"
                highlighted={highlightedSettingId === 'settings-row-gapless-playback'}
                title={t('settings.playback.gapless.title')}
                description={t('settings.playback.gapless.description')}
              >
                <ToggleButton
                  active={appSettings?.gaplessPlaybackEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ gaplessPlaybackEnabled: !(appSettings?.gaplessPlaybackEnabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-volume-balance"
                highlighted={highlightedSettingId === 'settings-row-volume-balance'}
                title={t('settings.playback.replayGain.title')}
                description={t('settings.playback.replayGain.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--replay-gain">
                  <div className="settings-replay-gain-simple">
                    <div className="settings-inline-toggle settings-replay-gain-toggle">
                      <span>{appSettings?.replayGainEnabled ? t('settings.playback.replayGain.status.enabled') : t('settings.playback.replayGain.status.disabled')}</span>
                      <ToggleButton
                        active={appSettings?.replayGainEnabled ?? false}
                        disabled={!appSettings}
                        onClick={() => patchAppSettings({ replayGainEnabled: !(appSettings?.replayGainEnabled ?? false) })}
                      />
                    </div>
                    <div className="settings-chip-row settings-chip-row--left settings-replay-gain-presets">
                      <ChipButton
                        active={replayGainTargetLufs === SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS}
                        onClick={() =>
                          patchAppSettings({
                            replayGainEnabled: true,
                            replayGainMode: 'track',
                            replayGainTargetLufs: SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS,
                            replayGainPreventClipping: true,
                            replayGainAnalyzeOnPlay: true,
                          })
                        }
                      >
                        {t('settings.playback.replayGain.preset.standard')}
                      </ChipButton>
                      <ChipButton
                        active={replayGainTargetLufs === QUIET_REPLAY_GAIN_TARGET_LUFS}
                        onClick={() =>
                          patchAppSettings({
                            replayGainEnabled: true,
                            replayGainMode: 'track',
                            replayGainTargetLufs: QUIET_REPLAY_GAIN_TARGET_LUFS,
                            replayGainPreventClipping: true,
                            replayGainAnalyzeOnPlay: true,
                          })
                        }
                      >
                        {t('settings.playback.replayGain.preset.quiet')}
                      </ChipButton>
                    </div>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => setReplayGainAdvancedOpen((open) => !open)}
                    >
                      <SlidersHorizontal size={15} />
                      {t('settings.playback.replayGain.action.advanced')}
                    </button>
                  </div>
                  <div className="settings-replay-gain-summary">
                    <span>
                      <em>{t('settings.playback.replayGain.field.mode')}</em>
                      <strong>{replayGainModeLabel}</strong>
                    </span>
                    <span>
                      <em>{t('settings.playback.replayGain.field.target')}</em>
                      <strong>{replayGainTargetLufs} LUFS</strong>
                    </span>
                    <span>
                      <em>{t('settings.playback.replayGain.field.applied')}</em>
                      <strong>{replayGainAppliedLabel}</strong>
                    </span>
                    <span>
                      <em>{t('settings.playback.replayGain.field.progress')}</em>
                      <strong>{replayGainProgressLabel}</strong>
                    </span>
                  </div>
                  {replayGainAdvancedOpen ? (
                    <div className="settings-replay-gain-advanced">
                      <div className="settings-chip-row settings-chip-row--left settings-replay-gain-mode">
                        {(['track', 'album', 'off'] as const).map((mode) => (
                          <ChipButton
                            active={(appSettings?.replayGainMode ?? 'track') === mode}
                            key={mode}
                            onClick={() => patchAppSettings({ replayGainMode: mode })}
                          >
                            {mode === 'track' ? t('settings.playback.replayGain.mode.track') : mode === 'album' ? t('settings.playback.replayGain.mode.album') : t('settings.playback.replayGain.mode.off')}
                          </ChipButton>
                        ))}
                      </div>
                      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions settings-replay-gain-toggles">
                        <div className="settings-inline-toggle">
                          <span>{t('settings.playback.replayGain.toggle.preventClipping')}</span>
                          <ToggleButton
                            active={appSettings?.replayGainPreventClipping ?? true}
                            disabled={!appSettings}
                            onClick={() => patchAppSettings({ replayGainPreventClipping: !(appSettings?.replayGainPreventClipping ?? true) })}
                          />
                        </div>
                        <div className="settings-inline-toggle">
                          <span>{t('settings.playback.replayGain.toggle.analyzeOnPlay')}</span>
                          <ToggleButton
                            active={appSettings?.replayGainAnalyzeOnPlay ?? true}
                            disabled={!appSettings}
                            onClick={() => patchAppSettings({ replayGainAnalyzeOnPlay: !(appSettings?.replayGainAnalyzeOnPlay ?? true) })}
                          />
                        </div>
                        <div className="settings-inline-toggle">
                          <span>{t('settings.playback.replayGain.toggle.analyzeOnScan')}</span>
                          <ToggleButton
                            active={appSettings?.replayGainAnalyzeMissingOnScan ?? false}
                            disabled={!appSettings}
                            onClick={() => {
                              const nextAnalyzeOnScan = !(appSettings?.replayGainAnalyzeMissingOnScan ?? false);
                              patchAppSettings({
                                replayGainAnalyzeMissingOnScan: nextAnalyzeOnScan,
                                replayGainAnalyzeMissingOnScanOptIn: nextAnalyzeOnScan,
                              });
                            }}
                          />
                        </div>
                        <label className="settings-number-field">
                          <span>{t('settings.playback.replayGain.field.target')} LUFS</span>
                          <input
                            type="number"
                            min={-24}
                            max={-11}
                            step={0.5}
                            value={appSettings?.replayGainTargetLufs ?? SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS}
                            onChange={(event) => patchAppSettings({ replayGainTargetLufs: Number(event.currentTarget.value) })}
                          />
                        </label>
                        <label className="settings-number-field">
                          <span>{t('settings.playback.replayGain.field.preamp')} dB</span>
                          <input
                            type="number"
                            min={-12}
                            max={12}
                            step={0.5}
                            value={appSettings?.replayGainPreampDb ?? 0}
                            onChange={(event) => patchAppSettings({ replayGainPreampDb: Number(event.currentTarget.value) })}
                          />
                        </label>
                        <button
                          className="settings-action-button"
                          type="button"
                          disabled={replayGainAnalysisBusy}
                          onClick={() => void handleStartReplayGainAnalysis()}
                        >
                          <RotateCw className={replayGainAnalysisBusy ? 'spinning-icon' : undefined} size={15} />
                          {replayGainAnalysisBusy ? t('settings.playback.replayGain.action.analyzing') : t('settings.playback.replayGain.action.analyzeMissing')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {replayGainAnalysisMessage ? <p className="settings-inline-note">{replayGainAnalysisMessage}</p> : null}
                  {replayGainAnalysisJob?.errorCount ? <p className="settings-inline-error">{t('settings.playback.replayGain.error', { count: replayGainAnalysisJob.errorCount })}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-mono-audio"
                highlighted={highlightedSettingId === 'settings-row-mono-audio'}
                title={t('settings.playback.monoAudio.title')}
                description={t('settings.playback.monoAudio.description')}
              >
                <ToggleButton
                  active={channelBalanceState.enabled && channelBalanceState.monoMode === 'sum'}
                  disabled={!appSettings}
                  onClick={() => handleMonoAudioToggle(!(channelBalanceState.enabled && channelBalanceState.monoMode === 'sum'))}
                />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--audio-status"
                id="settings-row-audio-status"
                highlighted={highlightedSettingId === 'settings-row-audio-status'}
                title={t('settings.playback.audioStatus.title')}
                description={t('settings.playback.audioStatus.description')}
              >
                {audioStatusPanelOpen ? (
                  <div className="settings-audio-professional-panel">
                    <AudioProfessionalStatusPanel status={status} variant="settings" />
                    <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                      <button className="settings-action-button" type="button" onClick={() => setAudioStatusPanelOpen(false)}>
                        {t('audioProfessional.action.hideDetails')}
                      </button>
                      <button className="settings-action-button" type="button" onClick={() => void refreshStatus()}>
                        <RotateCw size={15} />
                        {t('audioProfessional.action.refresh')}
                      </button>
                      <button className="settings-action-button" type="button" onClick={() => void copyAudioDiagnostics()}>
                        <Clipboard size={15} />
                        {audioDiagnosticsCopied ? t('audioDrawer.action.copiedDiagnostics') : t('audioDrawer.action.copyDiagnostics')}
                      </button>
                    </div>
                    {error ? <p className="settings-inline-error">{error}</p> : null}
                    {status?.warnings.length ? (
                      <p className="settings-inline-error">warnings: {status.warnings.join(', ')}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="settings-audio-professional-collapsed">
                    <button className="settings-action-button" type="button" onClick={() => setAudioStatusPanelOpen(true)}>
                      {t('audioProfessional.action.showDetails')}
                    </button>
                  </div>
                )}
              </SettingRow>
              <PlaybackStabilityDiagnosticsPanel />
                </>
              ) : null}
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Keyboard} id="shortcuts" title={t('settings.nav.shortcuts.label')}>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.shortcuts.title')}
                description={t('settings.shortcuts.description')}
              >
                <div className="settings-shortcut-toolbar">
                  <button className="settings-action-button" type="button" disabled={!appSettings} onClick={handleShortcutRecommendedReset}>
                    {t('settings.shortcuts.action.restoreRecommended')}
                  </button>
                  <p className="settings-inline-note">{t('settings.shortcuts.note')}</p>
                </div>
              </SettingRow>
              <div className="setting-row setting-row--shortcut setting-row--shortcut-header">
                <span>{t('settings.shortcuts.column.function')}</span>
                <span>{t('settings.shortcuts.column.local')}</span>
                <span>{t('settings.shortcuts.column.global')}</span>
              </div>
              {globalShortcutActionMeta.map((item) => {
                const localBinding = localShortcuts[item.action];
                const globalBinding = globalShortcuts[item.action];
                const isLocalRecording = recordingShortcutTarget?.scope === 'local' && recordingShortcutTarget.action === item.action;
                const isGlobalRecording = recordingShortcutTarget?.scope === 'global' && recordingShortcutTarget.action === item.action;
                const localMessage = shortcutMessages[shortcutMessageKey('local', item.action)] ?? null;
                const globalMessage = shortcutMessages[shortcutMessageKey('global', item.action)] ?? null;
                const localUnavailable = localShortcutUnavailableActions.has(item.action);

                const renderShortcutControl = (
                  scope: ShortcutScope,
                  binding: LocalShortcutSettings[GlobalShortcutAction] | GlobalShortcutSettings[GlobalShortcutAction],
                  isRecording: boolean,
                  message: string | null,
                ): JSX.Element => (
                  <div className="settings-shortcut-control" role="group" aria-label={t(`settings.shortcuts.scope.${scope}` as TranslationKey)}>
                    <button
                      className={`settings-shortcut-key ${isRecording ? 'is-recording' : ''}`}
                      type="button"
                      disabled={!appSettings}
                      onClick={() => setRecordingShortcutTarget({ scope, action: item.action })}
                    >
                      {isRecording
                        ? t('settings.shortcuts.recording')
                        : formatAcceleratorForDisplay(binding.accelerator, t('settings.shortcuts.empty'))}
                    </button>
                    <div className="settings-chip-row settings-chip-row--actions">
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={!appSettings}
                        onClick={() => setRecordingShortcutTarget({ scope, action: item.action })}
                      >
                        {t('settings.shortcuts.action.record')}
                      </button>
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={!appSettings || !binding.accelerator}
                        onClick={() => handleShortcutClear(scope, item.action)}
                      >
                        {t('settings.shortcuts.action.clear')}
                      </button>
                      <ToggleButton
                        active={binding.enabled}
                        disabled={!appSettings || !binding.accelerator}
                        onClick={() => void handleShortcutToggle(scope, item.action)}
                      />
                    </div>
                    {message ? <p className="settings-inline-error">{message}</p> : null}
                  </div>
                );

                return (
                  <SettingRow
                    className="setting-row--shortcut"
                    key={item.action}
                    title={t(item.titleKey)}
                    description={t(item.descriptionKey)}
                  >
                    {localUnavailable ? (
                      <div className="settings-shortcut-unavailable" role="group" aria-label={t('settings.shortcuts.scope.local')}>
                        {t('settings.shortcuts.localUnavailable')}
                      </div>
                    ) : renderShortcutControl('local', localBinding, isLocalRecording, localMessage)}
                    {renderShortcutControl('global', globalBinding, isGlobalRecording, globalMessage)}
                  </SettingRow>
                );
              })}
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Captions} id="lyrics" title={t('route.lyricsSettings.label')}>
              <LyricsSettingsPanel className="settings-lyrics-panel" variant="settings" />
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Clapperboard} id="mv" title={t('route.mvSettings.label')}>
              <SettingRow title={t('route.mvSettings.label')} description={t('route.mvSettings.description')}>
                <div className="settings-chip-row">
                  <StatusText tone={(appSettings?.mvEnabled ?? true) ? 'good' : 'muted'}>
                    {(appSettings?.mvEnabled ?? true) ? t('mvSettings.status.on') : t('mvSettings.status.off')}
                  </StatusText>
                  <ToggleButton
                    active={appSettings?.mvEnabled ?? true}
                    disabled={!appSettings}
                    onClick={() => patchMvSettings({ enabled: !(appSettings?.mvEnabled ?? true) })}
                  />
                </div>
              </SettingRow>
              <SettingRow title={t('mvSettings.network.maxQuality')} description={t('mvSettings.aria.maxQuality', { quality: mvQualityLabels[appSettings?.mvMaxQuality ?? 'max'] })}>
                <div className="settings-chip-row">
                  {mvQualityCaps.map((quality) => (
                    <ChipButton
                      active={(appSettings?.mvMaxQuality ?? 'max') === quality}
                      key={quality}
                      onClick={() => patchMvSettings({ maxQuality: quality })}
                    >
                      {mvQualityLabels[quality]}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mvSettings.network.title')}
                description={t('mvSettings.network.autoApplyThresholdDescription', { threshold: formatMvThreshold(appSettings?.mvAutoApplyThreshold) })}
              >
                <div className="settings-cache-panel settings-cache-panel--mv-network">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.autoApply')}</span>
                      <ToggleButton
                        active={appSettings?.mvAutoSearch ?? true}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ autoSearch: !(appSettings?.mvAutoSearch ?? true) })}
                      />
                    </div>
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.autoPreload')}</span>
                      <ToggleButton
                        active={appSettings?.mvAutoPreload ?? true}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ autoPreload: !(appSettings?.mvAutoPreload ?? true) })}
                      />
                    </div>
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.preferHighestViewCount')}</span>
                      <ToggleButton
                        active={appSettings?.mvPreferHighestViewCount === true}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ preferHighestViewCount: !(appSettings?.mvPreferHighestViewCount === true) })}
                      />
                    </div>
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.restartAudioOnLoad')}</span>
                      <ToggleButton
                        active={appSettings?.mvRestartAudioOnLoad === true}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ restartAudioOnLoad: !(appSettings?.mvRestartAudioOnLoad === true) })}
                      />
                    </div>
                    {appSettings?.mvRestartAudioOnLoad === true ? (
                      <div className="settings-chip-row settings-chip-row--left">
                        {mvSyncModes.map((mode) => (
                          <ChipButton
                            active={(appSettings?.mvSyncMode ?? 'balanced') === mode}
                            key={mode}
                            onClick={() => {
                              if (appSettings) {
                                patchMvSettings({ syncMode: mode });
                              }
                            }}
                          >
                            {{
                              stable: t('mvSettings.network.syncMode.stable'),
                              balanced: t('mvSettings.network.syncMode.balanced'),
                              precise: t('mvSettings.network.syncMode.precise'),
                            }[mode]}
                          </ChipButton>
                        ))}
                        <StatusText tone="muted">建议使用智能暂停；视频模糊越高越吃 GPU。</StatusText>
                      </div>
                    ) : null}
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.replayAudioOnChange')}</span>
                      <ToggleButton
                        active={appSettings?.mvReplayAudioOnChange !== false}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ replayAudioOnChange: !(appSettings?.mvReplayAudioOnChange !== false) })}
                      />
                    </div>
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('mvSettings.network.autoApplyThreshold')}</span>
                    <NumberRangeField
                      min={30}
                      max={100}
                      step={1}
                      suffix="%"
                      value={Math.round((appSettings?.mvAutoApplyThreshold ?? 0.7) * 100)}
                      onChange={(value) => patchMvSettings({ autoApplyThreshold: mvThresholdFromPercent(value) })}
                    />
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    {mvProviderOrder.map((provider, index) => (
                      <div className="settings-inline-toggle" key={provider}>
                        <span>{`${index + 1}. ${mvProviderLabels[provider]}`}</span>
                        <ToggleButton
                          active={mvEnabledProviders.has(provider)}
                          disabled={!appSettings}
                          onClick={() => handleMvProviderToggle(provider)}
                        />
                        <button
                          className="settings-icon-button"
                          type="button"
                          aria-label={`Move ${mvProviderLabels[provider]} up`}
                          disabled={!appSettings || index === 0}
                          onClick={() => handleMvProviderMove(provider, -1)}
                        >
                          <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />
                        </button>
                        <button
                          className="settings-icon-button"
                          type="button"
                          aria-label={`Move ${mvProviderLabels[provider]} down`}
                          disabled={!appSettings || index === mvProviderOrder.length - 1}
                          onClick={() => handleMvProviderMove(provider, 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mvSettings.immersive.title')}
                description={t('mvSettings.immersive.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--mv-immersive">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.immersive.title')}</span>
                      <ToggleButton
                        active={appSettings?.mvImmersiveBackground !== false}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ immersiveBackground: !(appSettings?.mvImmersiveBackground !== false) })}
                      />
                    </div>
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => patchMvSettings(mvImmersiveBackgroundDefaults)}>
                      <RotateCw size={15} />
                      {t('mvSettings.immersive.reset')}
                    </button>
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('mvSettings.immersive.zoom')}</span>
                    <NumberRangeField
                      min={100}
                      max={220}
                      step={1}
                      suffix="%"
                      value={appSettings?.mvImmersiveBackgroundScalePercent ?? 115}
                      onChange={(value) => patchMvSettings({ immersiveBackgroundScalePercent: value })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('mvSettings.immersive.blur')}</span>
                    <NumberRangeField
                      min={0}
                      max={32}
                      step={1}
                      suffix="px"
                      value={appSettings?.mvImmersiveBackgroundBlurPx ?? 0}
                      onChange={(value) => patchMvSettings({ immersiveBackgroundBlurPx: value })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('mvSettings.immersive.brightness')}</span>
                    <NumberRangeField
                      min={60}
                      max={140}
                      step={1}
                      suffix="%"
                      value={appSettings?.mvImmersiveBackgroundBrightnessPercent ?? 100}
                      onChange={(value) => patchMvSettings({ immersiveBackgroundBrightnessPercent: value })}
                    />
                  </div>
                  <div className="settings-wallpaper-control">
                    <span>{t('mvSettings.immersive.overlay')}</span>
                    <NumberRangeField
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      value={appSettings?.mvImmersiveBackgroundOverlayOpacityPercent ?? 0}
                      onChange={(value) => patchMvSettings({ immersiveBackgroundOverlayOpacityPercent: value })}
                    />
                  </div>
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Link2} id="integrations" title={t('settings.nav.integrations.label')}>
              <SettingRow
                className="setting-row--full"
                id="settings-row-network-proxy"
                highlighted={highlightedSettingId === 'settings-row-network-proxy'}
                title={t('settings.integrations.networkProxy.title')}
                description={t('settings.integrations.networkProxy.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--network-proxy">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>{t('settings.integrations.networkProxy.mode')}</span>
                      <StyledSelect
                        className="settings-select-control"
                        value={networkProxyDraft.mode}
                        options={buildNetworkProxyModeOptions(t)}
                        onChange={(mode) => {
                          setNetworkProxyDraft((current) => ({ ...current, mode }));
                          setNetworkProxyTestResult(null);
                        }}
                        ariaLabel={t('settings.integrations.networkProxy.modeAria')}
                        disabled={!appSettings || networkProxyBusy !== null}
                        showFilterIcon={false}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>{t('settings.integrations.networkProxy.manualUrl')}</span>
                      <input
                        type="text"
                        value={networkProxyDraft.proxyUrl}
                        placeholder={t('settings.integrations.networkProxy.manualPlaceholder')}
                        disabled={networkProxyDraft.mode !== 'manual' || networkProxyBusy !== null}
                        onChange={(event) => {
                          setNetworkProxyDraft((current) => ({ ...current, proxyUrl: event.target.value }));
                          setNetworkProxyTestResult(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>{t('settings.integrations.networkProxy.pacUrl')}</span>
                      <input
                        type="text"
                        value={networkProxyDraft.pacUrl}
                        placeholder="https://example.com/proxy.pac"
                        disabled={networkProxyDraft.mode !== 'pac' || networkProxyBusy !== null}
                        onChange={(event) => {
                          setNetworkProxyDraft((current) => ({ ...current, pacUrl: event.target.value }));
                          setNetworkProxyTestResult(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field settings-proxy-field--wide">
                      <span>{t('settings.integrations.networkProxy.bypass')}</span>
                      <input
                        type="text"
                        value={networkProxyDraft.bypassRules}
                        disabled={networkProxyDraft.mode === 'off' || networkProxyDraft.mode === 'system' || networkProxyBusy !== null}
                        onChange={(event) => {
                          setNetworkProxyDraft((current) => ({ ...current, bypassRules: event.target.value }));
                          setNetworkProxyTestResult(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={!appSettings || networkProxyBusy !== null} onClick={handleNetworkProxySave}>
                      <Save size={15} />
                      {networkProxyBusy === 'save' ? t('settings.integrations.networkProxy.saveBusy') : t('settings.integrations.networkProxy.save')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={!appSettings || networkProxyBusy !== null} onClick={handleNetworkProxyTest}>
                      <RotateCw size={15} />
                      {networkProxyBusy === 'test' ? t('settings.integrations.networkProxy.testBusy') : t('settings.integrations.networkProxy.test')}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.integrations.networkProxy.note')}
                  </p>
                  {networkProxyTestResult ? (
                    <p className={`settings-inline-note settings-proxy-result ${networkProxyTestResult.ok ? 'is-ok' : 'is-error'}`}>
                      {networkProxyTestResult.message}
                      {networkProxyTestResult.resolvedProxy ? `；${networkProxyTestResult.resolvedProxy}` : ''}
                      {networkProxyTestResult.elapsedMs ? `；${networkProxyTestResult.elapsedMs}ms` : ''}
                    </p>
                  ) : null}
                </div>
              </SettingRow>
              <div className="settings-credential-panel" data-expanded={credentialPanelVisible}>
                <header className="settings-credential-panel-header">
                  <div>
                    <h3>{t('settings.integrations.credentialPanel.title')}</h3>
                    <p>{t('settings.integrations.credentialPanel.description')}</p>
                  </div>
                  <button
                    className="settings-action-button settings-credential-panel-toggle"
                    type="button"
                    aria-expanded={credentialPanelVisible}
                    aria-label={credentialPanelVisible ? t('settings.integrations.credentialPanel.collapse') : t('settings.integrations.credentialPanel.expand')}
                    onClick={toggleCredentialPanelExpanded}
                  >
                    {credentialPanelVisible ? t('settings.integrations.credentialPanel.collapse') : t('settings.integrations.credentialPanel.expand')}
                    <ChevronDown size={15} />
                  </button>
                </header>
              </div>
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-online-album-info"
                highlighted={highlightedSettingId === 'settings-row-online-album-info'}
                title="Discogs 专辑评分"
                description="专辑评分兜底；可留空，填 token 更稳定。"
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--online-album-info">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Discogs personal access token</span>
                      <input
                        type="password"
                        value={onlineAlbumInfoDraft.discogsUserToken}
                        placeholder="可留空；粘贴 Discogs User Token"
                        disabled={!appSettings || onlineAlbumInfoBusyAction !== null}
                        autoComplete="off"
                        onChange={(event) => {
                          setOnlineAlbumInfoDraft({ discogsUserToken: event.target.value });
                          setOnlineAlbumInfoMessage(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={!appSettings || onlineAlbumInfoBusyAction !== null} onClick={handleOnlineAlbumInfoSave}>
                      <Save size={15} />
                      {onlineAlbumInfoBusyAction === 'save' ? '保存中...' : '保存 Discogs Token'}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(discogsDeveloperSettingsUrl)}>
                      <ExternalLink size={15} />
                      打开 Discogs Token 页面
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    Discogs Settings &gt; Developers 复制 Personal access token；仅用于评分查询。
                  </p>
                  {onlineAlbumInfoMessage ? <p className="settings-inline-note">{onlineAlbumInfoMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-online-artist-info"
                highlighted={highlightedSettingId === 'settings-row-online-artist-info'}
                title="在线歌手信息"
                description="演出和歌手补强数据源；留空则跳过对应来源。"
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--online-artist-info">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Bandsintown app_id</span>
                      <input
                        type="password"
                        value={onlineArtistInfoDraft.bandsintownAppId}
                        placeholder="留空则不启用"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setOnlineArtistInfoDraft((current) => ({ ...current, bandsintownAppId: event.target.value }));
                          setOnlineArtistInfoMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>Ticketmaster apikey</span>
                      <input
                        type="password"
                        value={onlineArtistInfoDraft.ticketmasterApiKey}
                        placeholder="留空则不启用"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setOnlineArtistInfoDraft((current) => ({ ...current, ticketmasterApiKey: event.target.value }));
                          setOnlineArtistInfoMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>SeatGeek client_id</span>
                      <input
                        type="password"
                        value={onlineArtistInfoDraft.seatGeekClientId}
                        placeholder="留空则不启用"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setOnlineArtistInfoDraft((current) => ({ ...current, seatGeekClientId: event.target.value }));
                          setOnlineArtistInfoMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>地区过滤</span>
                      <input
                        type="text"
                        value={onlineArtistInfoDraft.region}
                        placeholder="例如 HK、Tokyo、US；留空为全球"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setOnlineArtistInfoDraft((current) => ({ ...current, region: event.target.value }));
                          setOnlineArtistInfoMessage(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={!appSettings || onlineArtistInfoBusyAction !== null} onClick={handleOnlineArtistInfoSave}>
                      <Save size={15} />
                      {onlineArtistInfoBusyAction === 'save' ? '保存中...' : '保存配置'}
                    </button>
                    <button className="settings-action-button" type="button" disabled={onlineArtistInfoBusyAction !== null} onClick={handleClearArtistOnlineInfoCache}>
                      <Trash2 size={15} />
                      {onlineArtistInfoBusyAction === 'clear' ? '清理中...' : '清理艺人资料缓存'}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    地区可填 HK、Tokyo、US；艺人页按需缓存，不伪造内容。
                  </p>
                  {onlineArtistInfoMessage ? <p className="settings-inline-note">{onlineArtistInfoMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
              <SettingRow
                id="settings-row-discord-presence"
                highlighted={highlightedSettingId === 'settings-row-discord-presence'}
                title={t('settings.integrations.discord.title')}
                description={t('settings.integrations.discord.description')}
              >
                <div className="settings-chip-row">
                  <StatusText tone={discordPresenceStatus?.enabled ? 'good' : 'muted'}>{discordPresenceLabel}</StatusText>
                  <button className="settings-action-button" type="button" onClick={() => void refreshDiscordPresenceStatus()}>
                    {t('settings.integrations.discord.action.refresh')}
                  </button>
                  <ToggleButton
                    active={discordPresenceStatus?.enabled ?? appSettings?.discordRichPresenceEnabled ?? false}
                    disabled={!appSettings}
                    onClick={() => void handleDiscordPresenceToggle()}
                  />
                </div>
              </SettingRow>
              {windowsIntegrationAvailable ? (
                <>
              <SettingRow
                id="settings-row-smtc"
                highlighted={highlightedSettingId === 'settings-row-smtc'}
                title={t('settings.integrations.smtc.title')}
                description={t('settings.integrations.smtc.description')}
              >
                <div className="settings-chip-row">
                  <StatusText tone={smtcDiagnostics?.hostState === 'running' ? 'good' : 'muted'}>{smtcLabel}</StatusText>
                  <button className="settings-action-button" type="button" onClick={() => void refreshSmtcDiagnostics()}>
                    <RefreshCw size={15} />
                    {t('settings.integrations.discord.action.refresh')}
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={smtcRestarting || !(appSettings?.smtcEnabled ?? true)}
                    onClick={() => void restartSmtcSupport()}
                  >
                    <RotateCw size={15} />
                    {smtcRestarting ? t('settings.integrations.smtc.action.restarting') : t('settings.integrations.smtc.action.restart')}
                  </button>
                  <ToggleButton
                    active={appSettings?.smtcEnabled ?? true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ smtcEnabled: !(appSettings?.smtcEnabled ?? true) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-smtc-lyrics"
                highlighted={highlightedSettingId === 'settings-row-smtc-lyrics'}
                title={t('settings.integrations.smtcLyrics.title')}
                description={t('settings.integrations.smtcLyrics.description')}
              >
                <ToggleButton
                  active={appSettings?.smtcLyricsEnabled ?? false}
                  disabled={!appSettings || !(appSettings?.smtcEnabled ?? true)}
                  onClick={() => patchAppSettings({ smtcLyricsEnabled: !(appSettings?.smtcLyricsEnabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-taskbar-playback"
                highlighted={highlightedSettingId === 'settings-row-taskbar-playback'}
                title={t('settings.integrations.taskbarPlayback.title')}
                description={t('settings.integrations.taskbarPlayback.description')}
              >
                <div className="settings-chip-row">
                  <StatusText tone={taskbarPlaybackStatus?.visible ? 'good' : 'muted'}>
                    {taskbarPlaybackLabel}
                  </StatusText>
                  <button className="settings-action-button" type="button" onClick={() => void refreshTaskbarPlaybackStatus()}>
                    刷新状态
                  </button>
                  <ToggleButton
                    active={appSettings?.taskbarPlaybackControlsEnabled ?? false}
                    disabled={!appSettings}
                    onClick={() =>
                      patchAppSettings({
                        taskbarPlaybackControlsEnabled: !(appSettings?.taskbarPlaybackControlsEnabled ?? false),
                      })
                    }
                  />
                </div>
              </SettingRow>
                </>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-lastfm"
                highlighted={highlightedSettingId === 'settings-row-lastfm'}
                title={t('settings.integrations.lastfm.title')}
                description={t('settings.integrations.lastfm.description')}
              >
                <div className="settings-chip-row">
                  <StatusText tone={lastFmStatus?.enabled ? 'good' : 'muted'}>{lastFmLabel}</StatusText>
                  <ToggleButton active={lastFmStatus?.enabled ?? appSettings?.lastFmEnabled ?? false} disabled={!appSettings} onClick={() => void handleLastFmToggle()} />
                </div>
              </SettingRow>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-lastfm-connection"
                highlighted={highlightedSettingId === 'settings-row-lastfm'}
                title={t('settings.integrations.lastfm.connection.title')}
                description="浏览器授权后回到 ECHO 完成连接。"
              >
                <div className="settings-cache-panel settings-cache-panel--bpm-analysis">
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" onClick={() => void handleLastFmConnect()}>
                      {t('settings.integrations.lastfm.action.connect')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleLastFmCompleteAuth()}>
                      {t('settings.integrations.lastfm.action.completeAuth')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void refreshLastFmStatus()}>
                      {t('settings.integrations.lastfm.action.refresh')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleLastFmDisconnect()} disabled={!lastFmStatus?.connected}>
                      {t('settings.integrations.lastfm.action.disconnect')}
                    </button>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('settings.integrations.lastfm.lastNowPlaying')}</em>
                      <strong>{formatLastFmTimestamp(lastFmStatus?.lastNowPlayingAt)}</strong>
                    </span>
                    <span>
                      <em>{t('settings.integrations.lastfm.lastScrobble')}</em>
                      <strong>{formatLastFmTimestamp(lastFmStatus?.lastScrobbleAt)}</strong>
                    </span>
                    <span>
                      <em>{t('settings.integrations.lastfm.activeTrack')}</em>
                      <strong title={lastFmActiveLabel}>{lastFmActiveLabel}</strong>
                    </span>
                    <span>
                      <em>{t('settings.integrations.lastfm.statusLabel')}</em>
                      <strong>{lastFmLabel}</strong>
                    </span>
                  </div>
                </div>
              </SettingRow>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-lastfm-now-playing"
                highlighted={highlightedSettingId === 'settings-row-lastfm'}
                title={t('settings.integrations.lastfm.nowPlaying.title')}
                description={t('settings.integrations.lastfm.nowPlaying.description')}
              >
                <ToggleButton active={lastFmStatus?.nowPlayingEnabled ?? true} disabled={!lastFmStatus} onClick={() => void handleLastFmNowPlayingToggle()} />
              </SettingRow>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-lastfm-scrobbling"
                highlighted={highlightedSettingId === 'settings-row-lastfm'}
                title={t('settings.integrations.lastfm.scrobbling.title')}
                description={t('settings.integrations.lastfm.scrobbling.description')}
              >
                <ToggleButton active={lastFmStatus?.scrobbleEnabled ?? true} disabled={!lastFmStatus} onClick={() => void handleLastFmScrobbleToggle()} />
              </SettingRow>
              ) : null}
              <SettingRow
                id="settings-row-account-startup-refresh"
                highlighted={highlightedSettingId === 'settings-row-account-startup-refresh'}
                title={t('settings.integrations.accountStartupRefresh.title')}
                description={t('settings.integrations.accountStartupRefresh.description')}
              >
                <ToggleButton
                  active={appSettings?.autoAccountCheckOnStartup ?? true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ autoAccountCheckOnStartup: !(appSettings?.autoAccountCheckOnStartup ?? true) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-account-expiry-notices"
                highlighted={highlightedSettingId === 'settings-row-account-expiry-notices'}
                title={t('settings.integrations.accountExpiryNotices.title')}
                description={t('settings.integrations.accountExpiryNotices.description')}
              >
                <ToggleButton
                  active={appSettings?.suppressAccountExpiryNotices === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ suppressAccountExpiryNotices: appSettings?.suppressAccountExpiryNotices !== true })}
                />
              </SettingRow>
              <SettingRow
                title={t('settings.integrations.spotifyAutoLaunchOfficialPlayer.title')}
                description={t('settings.integrations.spotifyAutoLaunchOfficialPlayer.description')}
              >
                <ToggleButton
                  active={appSettings?.spotifyAutoLaunchOfficialPlayer ?? true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ spotifyAutoLaunchOfficialPlayer: !(appSettings?.spotifyAutoLaunchOfficialPlayer ?? true) })}
                />
              </SettingRow>
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-spotify-auth-config"
                highlighted={highlightedSettingId === 'settings-row-spotify-auth-config'}
                title="Spotify OAuth 配置"
                description="填自己的 Developer App；保存后重新登录。"
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--spotify-auth">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Client ID</span>
                      <input
                        type="text"
                        value={spotifyAuthDraft.clientId}
                        placeholder="必填：Spotify Developer App 的 Client ID"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setSpotifyAuthDraft((current) => ({ ...current, clientId: event.target.value }));
                          setSpotifyAuthMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>Redirect URI</span>
                      <input
                        type="text"
                        value={spotifyAuthDraft.redirectUri}
                        placeholder={defaultSpotifyRedirectUri}
                        disabled={!appSettings}
                        onChange={(event) => {
                          setSpotifyAuthDraft((current) => ({ ...current, redirectUri: event.target.value }));
                          setSpotifyAuthMessage(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={handleSpotifyAuthConfigSave}>
                      <Save size={15} />
                      保存 Spotify 配置
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(spotifyDeveloperDashboardUrl)}>
                      <ExternalLink size={15} />
                      打开 Spotify Dashboard
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    Dashboard 回调地址填：{defaultSpotifyRedirectUri}
                  </p>
                  {spotifyAuthMessage ? <p className="settings-inline-note">{spotifyAuthMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-tidal-auth-config"
                highlighted={highlightedSettingId === 'settings-row-tidal-auth-config'}
                title="TIDAL Developer 配置"
                description="用于 catalog 元数据搜索；不接入播放流。"
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--tidal-auth">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Client ID</span>
                      <input
                        type="text"
                        value={tidalAuthDraft.clientId}
                        placeholder="TIDAL Developer App Client ID"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setTidalAuthDraft((current) => ({ ...current, clientId: event.target.value }));
                          setTidalAuthMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>Client Secret</span>
                      <input
                        type="password"
                        value={tidalAuthDraft.clientSecret}
                        placeholder="TIDAL Developer App Client Secret"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setTidalAuthDraft((current) => ({ ...current, clientSecret: event.target.value }));
                          setTidalAuthMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>Redirect URI</span>
                      <input
                        type="text"
                        value={tidalAuthDraft.redirectUri}
                        placeholder={defaultTidalRedirectUri}
                        disabled={!appSettings}
                        onChange={(event) => {
                          setTidalAuthDraft((current) => ({ ...current, redirectUri: event.target.value }));
                          setTidalAuthMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>Country Code</span>
                      <input
                        type="text"
                        value={tidalAuthDraft.countryCode}
                        placeholder="US"
                        disabled={!appSettings}
                        onChange={(event) => {
                          setTidalAuthDraft((current) => ({ ...current, countryCode: event.target.value.toUpperCase() }));
                          setTidalAuthMessage(null);
                        }}
                      />
                    </label>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={handleTidalAuthConfigSave}>
                      <Save size={15} />
                      保存 TIDAL 配置
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(tidalDeveloperDashboardUrl)}>
                      <ExternalLink size={15} />
                      打开 TIDAL Dashboard
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    Dashboard 回调地址填：{defaultTidalRedirectUri}
                  </p>
                  {tidalAuthMessage ? <p className="settings-inline-note">{tidalAuthMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
              <div className="settings-account-panel" data-expanded={accountPanelExpanded}>
                <header className="settings-account-panel-header">
                  <div>
                    <h3>{t('settings.integrations.accountPanel.title')}</h3>
                    <p>{t('settings.integrations.accountPanel.description')}</p>
                  </div>
                  <div className="settings-account-panel-actions">
                    <button className="settings-action-button" type="button" onClick={() => void refreshAccountStatuses()}>
                      {t('settings.integrations.accountPanel.refreshAll')}
                    </button>
                    <button
                      className="settings-action-button settings-account-panel-toggle"
                      type="button"
                      aria-controls="settings-account-list"
                      aria-expanded={accountPanelExpanded}
                      aria-label={accountPanelExpanded ? '收起账号登录' : '展开账号登录'}
                      onClick={toggleAccountPanelExpanded}
                    >
                      {accountPanelExpanded ? '收起账号登录' : '展开账号登录'}
                      <ChevronDown size={15} />
                    </button>
                  </div>
                </header>
                {accountPanelExpanded ? (
                  <div className="settings-account-list" id="settings-account-list">
                    {cookieAccountProviders.map((provider) => (
                      <AccountCookieCard
                        key={provider}
                        provider={provider}
                        status={accountStatusByProvider[provider]}
                        cookieValue={accountCookies[provider]}
                        busyAction={accountBusy[provider]}
                        error={accountErrors[provider]}
                        message={accountMessages[provider]}
                        onChangeCookie={(value) => setAccountCookies((current) => ({ ...current, [provider]: value }))}
                        onSave={() => void handleAccountSaveCookie(provider)}
                        onCheck={() => void handleAccountCheck(provider)}
                        onOpenLogin={() => void handleAccountOpenLogin(provider)}
                        onClear={() => void handleAccountClear(provider)}
                      />
                    ))}
                    <YouTubeAccountCard
                      status={accountStatusByProvider.youtube}
                      browser={youtubeBrowser}
                      busyAction={accountBusy.youtube}
                      error={accountErrors.youtube}
                      message={accountMessages.youtube}
                      onBrowserChange={(browser) => void handleYouTubeBrowserChange(browser)}
                      onCheck={() => void handleAccountCheck('youtube')}
                      onOpenLogin={() => void handleAccountOpenLogin('youtube')}
                      onClear={() => void handleAccountClear('youtube')}
                    />
                    <SpotifyAccountCard
                      status={accountStatusByProvider.spotify}
                      busyAction={accountBusy.spotify}
                      error={accountErrors.spotify}
                      message={accountMessages.spotify}
                      onCheck={() => void handleAccountCheck('spotify')}
                      onOpenDashboard={() => void handleOpenExternalUrl(spotifyDeveloperDashboardUrl)}
                      onOpenLogin={() => void handleAccountOpenLogin('spotify')}
                      onClear={() => void handleAccountClear('spotify')}
                    />
                    <TidalAccountCard
                      status={accountStatusByProvider.tidal}
                      busyAction={accountBusy.tidal}
                      error={accountErrors.tidal}
                      message={accountMessages.tidal}
                      onCheck={() => void handleAccountCheck('tidal')}
                      onOpenDashboard={() => void handleOpenExternalUrl(tidalDeveloperDashboardUrl)}
                      onOpenLogin={() => void handleAccountOpenLogin('tidal')}
                      onClear={() => void handleAccountClear('tidal')}
                    />
                  </div>
                ) : null}
              </div>
              <SettingRow title={t('settings.integrations.mobile.title')} description={t('settings.integrations.mobile.description')}>
                <ToggleButton />
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Code2} id="plugins" title={t('settings.nav.plugins.label')}>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-plugins"
                highlighted={highlightedSettingId === 'settings-row-plugins'}
                title={t('settings.plugins.card.title')}
                description={t('settings.plugins.card.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--plugins">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('settings.plugins.meta.runtime')}</em>
                      <strong>{t('settings.plugins.meta.runtimeValue')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.plugins.meta.defaultState')}</em>
                      <strong>{t('settings.plugins.meta.defaultStateValue')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.plugins.meta.permissions')}</em>
                      <strong>{t('settings.plugins.meta.permissionsValue')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.plugins.meta.playbackSafety')}</em>
                      <strong>{t('settings.plugins.meta.playbackSafetyValue')}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" onClick={handleOpenPluginsPage}>
                      <Code2 size={15} />
                      {t('settings.plugins.action.openPage')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenPluginDirectory()}>
                      <FolderOpen size={15} />
                      {t('settings.plugins.action.openDirectory')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleCreatePlaybackPanelExample()}>
                      <FileText size={15} />
                      {t('settings.plugins.action.createExample')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(pluginsDocumentationUrl)}>
                      <ExternalLink size={15} />
                      {t('settings.plugins.action.openDocs')}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.plugins.note')}
                  </p>
                  {pluginSettingsMessage ? <p className="settings-inline-note">{pluginSettingsMessage}</p> : null}
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Globe2} id="remote" title={t('settings.nav.remote.label')}>
              <RemoteSourcesPanel />
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={SlidersHorizontal} id="eq" title={t('settings.nav.eq.label')}>
              <SettingRow
                title="DSP 工作台"
                description="EQ、余量、声道与输出保护已经搬到侧栏里的调音工作区。"
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--dsp-workbench">
                  <div className="settings-status-grid settings-status-grid--audio">
                    <span>
                      <em>Signal path</em>
                      <strong>{status?.dspActive ? 'DSP path' : 'Native direct'}</strong>
                    </span>
                    <span>
                      <em>EQ</em>
                      <strong>{status?.eqEnabled ? 'Enabled' : 'Bypassed'}</strong>
                    </span>
                    <span>
                      <em>Preset</em>
                      <strong>{status?.eqPresetName ?? 'Flat'}</strong>
                    </span>
                    <span>
                      <em>Safety</em>
                      <strong>{status?.clippingRisk ? 'Headroom risk' : 'Protected'}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" onClick={handleOpenDspPage}>
                      <SlidersHorizontal size={15} />
                      打开 DSP 工作台
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void refreshStatus()}>
                      <RefreshCw size={15} />
                      刷新状态
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    这里保留状态摘要；具体调音请从左侧 DSP 进入，布局更接近 Roon 的链路式工作流。
                  </p>
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Palette} id="appearance" title={t('settings.nav.appearance.label')}>
              <SettingRow
                id="settings-row-theme"
                highlighted={highlightedSettingId === 'settings-row-theme'}
                title={t('settings.appearance.theme.title')}
                description={t('settings.appearance.theme.description')}
              >
                <div className="settings-chip-row">
                  {themeModeOptions.map((option) => (
                    <ChipButton
                      active={(appSettings?.appearanceTheme ?? defaultThemeMode) === option.mode}
                      key={option.mode}
                      onClick={() => handleThemeModeChange(option.mode)}
                    >
                      {t(option.labelKey)}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                title={t('settings.appearance.themeSchedule.title')}
                description={t('settings.appearance.themeSchedule.description')}
              >
                <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions settings-theme-schedule">
                  <div className="settings-inline-toggle">
                    <span>{t('settings.appearance.themeSchedule.toggle')}</span>
                    <button
                      aria-label={t('settings.appearance.themeSchedule.toggleAria')}
                      aria-pressed={themeScheduleEnabled}
                      className={`toggle-btn ${themeScheduleEnabled ? 'active' : ''}`}
                      type="button"
                      onClick={() => handleThemeScheduleChange({ appearanceThemeScheduleEnabled: !themeScheduleEnabled })}
                    >
                      <span />
                    </button>
                  </div>
                  <label className="settings-time-field">
                    <span>{t('settings.appearance.themeSchedule.darkAt')}</span>
                    <input
                      type="time"
                      value={themeScheduleDarkAt}
                      disabled={!themeScheduleEnabled}
                      onChange={(event) => handleThemeScheduleChange({ appearanceThemeScheduleDarkAt: normalizeThemeScheduleTime(event.currentTarget.value, defaultThemeScheduleDarkAt) })}
                    />
                  </label>
                  <label className="settings-time-field">
                    <span>{t('settings.appearance.themeSchedule.lightAt')}</span>
                    <input
                      type="time"
                      value={themeScheduleLightAt}
                      disabled={!themeScheduleEnabled}
                      onChange={(event) => handleThemeScheduleChange({ appearanceThemeScheduleLightAt: normalizeThemeScheduleTime(event.currentTarget.value, defaultThemeScheduleLightAt) })}
                    />
                  </label>
                  <p className="settings-inline-note">{themeScheduleStatus}</p>
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full"
                id="settings-row-sidebar-layout"
                highlighted={highlightedSettingId === 'settings-row-sidebar-layout'}
                title={sidebarSettingsText.title}
                description={sidebarSettingsText.description}
              >
                <div className="settings-sidebar-layout-panel">
                  <div className="settings-sidebar-layout-toolbar">
                    <button
                      aria-expanded={sidebarLayoutExpanded}
                      className="settings-sidebar-layout-toggle"
                      type="button"
                      disabled={!appSettings}
                      onClick={handleSidebarLayoutToggle}
                    >
                      <ChevronDown size={16} />
                      <span>{sidebarLayoutSummary}</span>
                      <em>{sidebarLayoutExpanded ? sidebarSettingsText.collapse : sidebarSettingsText.expand}</em>
                    </button>
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={handleSidebarRoutesReset}>
                      <RotateCcw size={15} />
                      {sidebarSettingsText.reset}
                    </button>
                  </div>
                  {sidebarLayoutExpanded
                    ? (['main', 'utility'] as const).map((placement) => {
                        const groupItems = sidebarSettingsGroups[placement];

                        return (
                          <section className="settings-sidebar-layout-group" key={placement}>
                            <div className="settings-sidebar-layout-group-title">
                              <strong>{placement === 'main' ? sidebarSettingsText.mainGroup : sidebarSettingsText.utilityGroup}</strong>
                              <span>{t('settings.appearance.sidebar.count', { count: groupItems.length })}</span>
                            </div>
                            <div className="settings-sidebar-route-list">
                              {groupItems.length > 0 ? (
                                groupItems.map((item) => {
                                  const label = t(item.labelKey);
                                  const isLockedVisible = lockedVisibleSidebarRouteIdSet.has(item.id);
                                  const isVisible = isLockedVisible || !sidebarHiddenRouteIdSet.has(item.id);

                                  return (
                                    <div
                                      className="settings-sidebar-route-item"
                                      data-dragging={draggingSidebarRouteId === item.id ? 'true' : undefined}
                                      data-hidden={isVisible ? undefined : 'true'}
                                      draggable={Boolean(appSettings)}
                                      key={item.id}
                                      onDragEnd={handleSidebarRouteDragEnd}
                                      onDragOver={handleSidebarRouteDragOver}
                                      onDragStart={(event) => handleSidebarRouteDragStart(event, item.id)}
                                      onDrop={(event) => handleSidebarRouteDrop(event, item.id, placement)}
                                    >
                                      <span className="settings-sidebar-route-drag-handle" aria-hidden="true">
                                        <GripVertical size={15} />
                                      </span>
                                      <span className="settings-sidebar-route-copy">
                                        <strong>{label}</strong>
                                        <em>{isLockedVisible ? sidebarSettingsText.fixed : isVisible ? sidebarSettingsText.visible : sidebarSettingsText.hidden}</em>
                                      </span>
                                      <span className="settings-sidebar-route-actions">
                                        <button
                                          aria-label={isVisible ? t('settings.appearance.sidebar.hideAria', { label }) : t('settings.appearance.sidebar.showAria', { label })}
                                          aria-pressed={isVisible}
                                          className="settings-icon-button settings-sidebar-visibility-button"
                                          disabled={!appSettings || isLockedVisible}
                                          title={isVisible ? sidebarSettingsText.visible : sidebarSettingsText.hidden}
                                          type="button"
                                          onClick={() => handleSidebarRouteVisibilityToggle(item.id)}
                                        >
                                          {isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                                        </button>
                                      </span>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="settings-sidebar-layout-empty">{sidebarSettingsText.noItems}</p>
                              )}
                            </div>
                          </section>
                        );
                      })
                    : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--theme-presets"
                title={t('settings.appearance.themePreset.title')}
                description={t('settings.appearance.themePreset.description')}
              >
                <div className="settings-theme-preset-panel">
                  <button
                    aria-expanded={themePresetsExpanded}
                    className="settings-theme-preset-summary"
                    type="button"
                    onClick={() => patchAppSettings({ appearanceThemePresetsExpanded: !themePresetsExpanded })}
                  >
                    <span
                      aria-hidden="true"
                      className="settings-theme-preset-summary-preview"
                      style={{ background: selectedThemePresetOption.preview } as CSSProperties}
                    />
                    <span>
                      <strong>{activeThemeCustom?.name ?? t(selectedThemePresetOption.labelKey)}</strong>
                      <em>{themePresetsExpanded ? '收起主题预设' : '展开主题预设'}</em>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {themePresetsExpanded ? (
                    <div className="settings-theme-preset-grid">
                      {visibleThemePresetOptions.map((option) => {
                        const activePreset = selectedThemePreset;
                        const isActive = activePreset === option.preset;

                        return (
                          <button
                            aria-pressed={isActive}
                            className={`settings-theme-preset-card${isActive ? ' active' : ''}`}
                            data-preset={option.preset}
                            key={option.preset}
                            onClick={() => handleThemePresetChange(option.preset)}
                            title={t(option.descriptionKey)}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className="settings-theme-preset-preview"
                              style={{ background: option.preview } as CSSProperties}
                            >
                              {isActive ? <Check size={16} /> : null}
                            </span>
                            <span className="settings-theme-preset-copy">
                              <strong>{t(option.labelKey)}</strong>
                              <em>{t(option.descriptionKey)}</em>
                            </span>
                            <span aria-hidden="true" className="settings-theme-preset-swatches">
                              {option.swatches.map((swatch) => (
                                <span key={swatch} style={{ background: swatch } as CSSProperties} />
                              ))}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--theme-custom"
                title={t('settings.appearance.themeCustom.title')}
                description={t('settings.appearance.themeCustom.description')}
              >
                <div className="settings-theme-custom-panel">
                  <div className="settings-theme-custom-header">
                    <div className="settings-theme-custom-heading">
                      <span>{t('settings.appearance.themeCustom.preview.title')}</span>
                      <strong>{activeThemeCustom ? activeThemeCustom.name : t(selectedThemePresetOption.labelKey)}</strong>
                      <em>{t('settings.appearance.themeCustom.preview.description')}</em>
                    </div>
                    <div className="settings-theme-custom-toolbar">
                      <div className="settings-chip-row settings-chip-row--left">
                        <ChipButton active={themeCustomTone === 'light'} onClick={() => setThemeCustomTone('light')}>
                          {t('settings.appearance.theme.light')}
                        </ChipButton>
                        <ChipButton active={themeCustomTone === 'dark'} onClick={() => setThemeCustomTone('dark')}>
                          {t('settings.appearance.theme.dark')}
                        </ChipButton>
                      </div>
                      <div className="settings-theme-custom-preview" aria-hidden="true" style={{ background: themeCustomGradientPreview }}>
                        <span style={{ background: themeCustomValues.accent }} />
                        <span style={{ background: themeCustomValues.accentStrong }} />
                        <span style={{ background: themeCustomValues.secondary }} />
                        <strong style={{ background: themeCustomValues.accent, color: themeCustomValues.onAccent }}>Aa</strong>
                      </div>
                    </div>
                  </div>

                  <div className="settings-theme-custom-section settings-theme-custom-library">
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.myThemes.title')}</strong>
                      <span>{t('settings.appearance.themeCustom.myThemes.description')}</span>
                    </div>
                    <div className="settings-theme-custom-library-actions">
                      <button className="settings-action-button" type="button" onClick={handleThemeCustomCreate}>
                        <Palette size={15} />
                        {t('settings.appearance.themeCustom.action.create')}
                      </button>
                      <button className="settings-action-button" type="button" onClick={handleThemeCustomRename} disabled={!activeThemeCustom}>
                        <FileText size={15} />
                        {t('settings.appearance.themeCustom.action.rename')}
                      </button>
                      <button className="settings-action-button" type="button" onClick={handleThemeCustomDuplicate} disabled={!activeThemeCustom}>
                        <History size={15} />
                        {t('settings.appearance.themeCustom.action.duplicate')}
                      </button>
                      <button className="settings-danger-button" type="button" onClick={handleThemeCustomDelete} disabled={!activeThemeCustom}>
                        <Trash2 size={15} />
                        {t('settings.appearance.themeCustom.action.delete')}
                      </button>
                    </div>
                    <div className="settings-theme-custom-theme-list">
                      {savedThemeCustomThemes.length > 0 ? (
                        savedThemeCustomThemes.map((theme) => (
                          <button
                            className={`settings-theme-custom-theme-card${theme.id === savedThemeCustomId ? ' active' : ''}`}
                            key={theme.id}
                            type="button"
                            onClick={() => handleThemeCustomSelect(theme)}
                          >
                            <span>
                              <strong>{theme.name}</strong>
                              <em>{t(themePresetOptions.find((option) => option.preset === theme.basePreset)?.labelKey ?? selectedThemePresetOption.labelKey)}</em>
                            </span>
                            {theme.id === savedThemeCustomId ? <Check size={15} /> : null}
                          </button>
                        ))
                      ) : (
                        <p className="settings-theme-custom-empty">{t('settings.appearance.themeCustom.myThemes.empty')}</p>
                      )}
                    </div>
                    {pluginThemeOptions.length > 0 ? (
                      <div className="settings-theme-plugin-presets">
                        <div className="settings-theme-custom-section-title">
                          <strong>插件主题</strong>
                          <span>已启用插件贡献的主题会导入到“我的主题”，之后仍可继续微调。</span>
                        </div>
                        <div className="settings-theme-custom-theme-list">
                          {pluginThemeOptions.map((theme) => {
                            const installed = savedThemeCustomThemes.some((item) => item.id === theme.customThemeId);
                            const active = savedThemeCustomId === theme.customThemeId;
                            const preview = theme.preview ?? `linear-gradient(135deg, ${theme.swatches?.[0] ?? '#f6f6f7'} 0%, ${theme.swatches?.[1] ?? '#4b55e8'} 52%, ${theme.swatches?.[2] ?? '#727987'} 100%)`;

                            return (
                              <button
                                className={`settings-theme-custom-theme-card settings-theme-plugin-card${active ? ' active' : ''}`}
                                key={`${theme.pluginId}:${theme.id}`}
                                type="button"
                                onClick={() => handlePluginThemeApply(theme)}
                              >
                                <span>
                                  <strong>{theme.title}</strong>
                                  <em>{theme.pluginName} v{theme.pluginVersion} · {installed ? '更新并应用' : '导入并应用'}</em>
                                </span>
                                <span className="settings-theme-plugin-preview" aria-hidden="true" style={{ background: preview } as CSSProperties}>
                                  {(theme.swatches ?? []).slice(0, 4).map((swatch) => (
                                    <i key={swatch} style={{ background: swatch } as CSSProperties} />
                                  ))}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="settings-theme-custom-copy-actions">
                      <button className="settings-action-button" type="button" onClick={() => handleThemeCustomCopyTone('light', 'dark')}>
                        {t('settings.appearance.themeCustom.action.copyLightToDark')}
                      </button>
                      <button className="settings-action-button" type="button" onClick={() => handleThemeCustomCopyTone('dark', 'light')}>
                        {t('settings.appearance.themeCustom.action.copyDarkToLight')}
                      </button>
                    </div>
                  </div>

                  <div className="settings-theme-custom-mock-preview" aria-hidden="true">
                    <div className="settings-theme-custom-mock-titlebar" style={{ background: themeCustomValues.titlebar }} />
                    <div className="settings-theme-custom-mock-body" style={{ background: themeCustomValues.panel }}>
                      <aside style={{ background: themeCustomValues.sidebar }}>
                        <span style={{ background: themeCustomValues.chip, color: themeCustomValues.text }}>曲库</span>
                        <span style={{ background: themeCustomValues.rowActive, color: themeCustomValues.heading }}>外观</span>
                        <span style={{ background: themeCustomValues.chip, color: themeCustomValues.muted }}>歌词</span>
                      </aside>
                      <main>
                        <div className="settings-theme-custom-mock-card" style={{ background: themeCustomValues.field, color: themeCustomValues.text }}>
                          <strong style={{ color: themeCustomValues.heading }}>Aa 主题预览</strong>
                          <em style={{ color: themeCustomValues.muted }}>标题、正文和弱化文字</em>
                        </div>
                        <div className="settings-theme-custom-mock-row" style={{ background: themeCustomValues.row, color: themeCustomValues.text }}>
                          <span>播放列表</span>
                          <strong style={{ color: themeCustomValues.accentStrong }}>128</strong>
                        </div>
                        <div className="settings-theme-custom-mock-row" style={{ background: themeCustomValues.rowHover, color: themeCustomValues.text }}>
                          <span>悬停状态</span>
                          <strong style={{ color: themeCustomValues.secondary }}>ON</strong>
                        </div>
                        <div className="settings-theme-custom-mock-accent" style={{ background: themeCustomValues.accent, color: themeCustomValues.onAccent }}>
                          主要按钮
                        </div>
                      </main>
                    </div>
                    <div className="settings-theme-custom-mock-player" style={{ background: themeCustomValues.player }}>
                      <strong style={{ color: themeCustomValues.heading }}>Now Playing</strong>
                      <span style={{ background: themeCustomValues.success }} />
                      <span style={{ background: themeCustomValues.warning }} />
                      <span style={{ background: themeCustomValues.danger }} />
                    </div>
                  </div>

                  <div className="settings-theme-custom-section">
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.core')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.core.description')}</span>
                    </div>
                    <div className="settings-theme-custom-card-grid">
                      {coreThemeColorFields.map((option) => (
                        <label className="settings-theme-custom-color-card" key={option.field}>
                          <span className="settings-theme-custom-color-copy">
                            <strong>{t(option.labelKey)}</strong>
                            <em>{t(option.descriptionKey)}</em>
                          </span>
                          <span className="settings-theme-custom-color-control">
                            <code>{themeCustomValues[option.field].toUpperCase()}</code>
                            <input
                              aria-label={t(option.labelKey)}
                              type="color"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomColor(option.field, event.currentTarget.value)}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="settings-theme-custom-section settings-theme-custom-section--gradient">
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.gradient')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.gradient.description')}</span>
                    </div>
                    <div className="settings-theme-custom-gradient-card" style={{ background: themeCustomGradientPreview }}>
                      {gradientThemeColorFields.map((option) => (
                        <label className="settings-theme-custom-color-card settings-theme-custom-color-card--compact" key={option.field}>
                          <span className="settings-theme-custom-color-copy">
                            <strong>{t(option.labelKey)}</strong>
                            <em>{t(option.descriptionKey)}</em>
                          </span>
                          <span className="settings-theme-custom-color-control">
                            <code>{themeCustomValues[option.field].toUpperCase()}</code>
                            <input
                              aria-label={t(option.labelKey)}
                              type="color"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomColor(option.field, event.currentTarget.value)}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button className="settings-theme-custom-advanced-toggle" type="button" onClick={() => setThemeCustomAdvancedOpen((current) => !current)}>
                    <SlidersHorizontal size={15} />
                    {themeCustomAdvancedOpen ? t('settings.appearance.themeCustom.advanced.hide') : t('settings.appearance.themeCustom.advanced.show')}
                  </button>

                  <div className="settings-theme-custom-section" hidden={!themeCustomAdvancedOpen}>
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.surface')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.surface.description')}</span>
                    </div>
                    <div className="settings-theme-custom-card-grid">
                      {surfaceThemeColorFields.map((option) => (
                        <label className="settings-theme-custom-color-card" key={option.field}>
                          <span className="settings-theme-custom-color-copy">
                            <strong>{t(option.labelKey)}</strong>
                            <em>{t(option.descriptionKey)}</em>
                          </span>
                          <span className="settings-theme-custom-color-control">
                            <code>{themeCustomValues[option.field].toUpperCase()}</code>
                            <input
                              aria-label={t(option.labelKey)}
                              type="color"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomColor(option.field, event.currentTarget.value)}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="settings-theme-custom-section" hidden={!themeCustomAdvancedOpen}>
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.state')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.state.description')}</span>
                    </div>
                    <div className="settings-theme-custom-card-grid settings-theme-custom-card-grid--advanced">
                      {stateThemeColorFields.map((option) => (
                        <label className="settings-theme-custom-color-card" key={option.field}>
                          <span className="settings-theme-custom-color-copy">
                            <strong>{t(option.labelKey)}</strong>
                            <em>{t(option.descriptionKey)}</em>
                          </span>
                          <span className="settings-theme-custom-color-control">
                            <code>{themeCustomValues[option.field].toUpperCase()}</code>
                            <input
                              aria-label={t(option.labelKey)}
                              type="color"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomColor(option.field, event.currentTarget.value)}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="settings-theme-custom-sliders" hidden={!themeCustomAdvancedOpen}>
                    {numberThemeFields
                      .filter((option) => option.field !== 'motionSpeedSeconds' && option.field !== 'motionIntensityPercent')
                      .map((option) => (
                      <label className="settings-theme-custom-slider" key={option.field}>
                        <span>
                          <em>
                            <strong>{t(option.labelKey)}</strong>
                            {t(option.descriptionKey)}
                          </em>
                          <strong>
                            {themeCustomValues[option.field]}
                            {option.suffix}
                          </strong>
                        </span>
                        <input
                          aria-label={t(option.labelKey)}
                          min={option.min}
                          max={option.max}
                          step={option.step ?? 1}
                          type="range"
                          value={themeCustomValues[option.field]}
                          onChange={(event) => updateThemeCustomPercent(option.field, Number(event.currentTarget.value))}
                        />
                      </label>
                    ))}
                  </div>

                  <div className="settings-theme-custom-section" hidden={!themeCustomAdvancedOpen}>
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.motion')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.motion.description')}</span>
                    </div>
                    <div className="settings-theme-custom-motion-row">
                      <span>
                        <strong>{t('settings.appearance.themeCustom.field.motionEnabled')}</strong>
                        <em>{t('settings.appearance.themeCustom.field.motionEnabled.description')}</em>
                      </span>
                      <ToggleButton active={themeCustomValues.motionEnabled} onClick={() => updateThemeCustomMotionEnabled(!themeCustomValues.motionEnabled)} />
                    </div>
                    <div className="settings-theme-custom-sliders settings-theme-custom-sliders--motion">
                      {numberThemeFields
                        .filter((option) => option.field === 'motionSpeedSeconds' || option.field === 'motionIntensityPercent')
                        .map((option) => (
                          <label className="settings-theme-custom-slider" key={option.field}>
                            <span>
                              <em>
                                <strong>{t(option.labelKey)}</strong>
                                {t(option.descriptionKey)}
                              </em>
                              <strong>
                                {themeCustomValues[option.field]}
                                {option.suffix}
                              </strong>
                            </span>
                            <input
                              aria-label={t(option.labelKey)}
                              min={option.min}
                              max={option.max}
                              step={option.step ?? 1}
                              type="range"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomPercent(option.field, Number(event.currentTarget.value))}
                            />
                          </label>
                        ))}
                    </div>
                  </div>

                  <div className="settings-theme-custom-section" hidden={!themeCustomAdvancedOpen}>
                    <div className="settings-theme-custom-section-title">
                      <strong>{t('settings.appearance.themeCustom.group.advanced')}</strong>
                      <span>{t('settings.appearance.themeCustom.group.advanced.description')}</span>
                    </div>
                    <div className="settings-theme-custom-card-grid settings-theme-custom-card-grid--advanced">
                      {advancedThemeColorFields.map((option) => (
                        <label className="settings-theme-custom-color-card" key={option.field}>
                          <span className="settings-theme-custom-color-copy">
                            <strong>{t(option.labelKey)}</strong>
                            <em>{t(option.descriptionKey)}</em>
                          </span>
                          <span className="settings-theme-custom-color-control">
                            <code>{themeCustomValues[option.field].toUpperCase()}</code>
                            <input
                              aria-label={t(option.labelKey)}
                              type="color"
                              value={themeCustomValues[option.field]}
                              onChange={(event) => updateThemeCustomColor(option.field, event.currentTarget.value)}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {themeCustomWarnings.length > 0 ? (
                    <p className="settings-theme-custom-warning">{t('settings.appearance.themeCustom.message.lowContrast')}</p>
                  ) : null}
                  {themeCustomMessage ? <p className="settings-theme-custom-message">{themeCustomMessage}</p> : null}

                  <div className="settings-theme-custom-actions">
                    <button className="settings-action-button" type="button" onClick={handleThemeCustomAutoFix}>
                      <Palette size={15} />
                      {t('settings.appearance.themeCustom.action.autoFix')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={handleThemeCustomSave}>
                      <Save size={15} />
                      {t('settings.appearance.themeCustom.action.save')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={handleThemeCustomExport}>
                      <Download size={15} />
                      {t('settings.appearance.themeCustom.action.export')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={handleThemeCustomImport}>
                      <FolderOpen size={15} />
                      {t('settings.appearance.themeCustom.action.import')}
                    </button>
                    <button className="settings-danger-button" type="button" onClick={handleThemeCustomReset}>
                      <RotateCw size={15} />
                      {t('settings.appearance.themeCustom.action.reset')}
                    </button>
                  </div>
                </div>
              </SettingRow>
              <SettingRow title={t('settings.appearance.density.title')} description={t('settings.appearance.density.description')}>
                <div className="settings-chip-row">
                  <ChipButton active>{t('settings.appearance.density.compact')}</ChipButton>
                  <ChipButton>{t('settings.appearance.density.standard')}</ChipButton>
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-now-playing-cover-color"
                highlighted={highlightedSettingId === 'settings-row-now-playing-cover-color'}
                title={t('settings.appearance.nowPlayingCoverColor.title')}
                description={t('settings.appearance.nowPlayingCoverColor.description')}
              >
                <ToggleButton
                  active={appSettings?.nowPlayingCoverColorEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      nowPlayingCoverColorEnabled: !(appSettings?.nowPlayingCoverColorEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-wallpaper"
                highlighted={highlightedSettingId === 'settings-row-wallpaper'}
                title={t('settings.appearance.wallpaper.title')}
                description={t('settings.appearance.wallpaper.description')}
              >
                {appSettings?.appCustomWallpaperPath || appSettings?.appPortraitWallpaperPath ? (
                  <div className="settings-cache-panel settings-cache-panel--app-wallpaper">
                    <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                      <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => void handleAppWallpaperChoose()}>
                        <FolderOpen size={15} />
                        {t('settings.appearance.wallpaper.choose')}
                      </button>
                      <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => void handleAppPortraitWallpaperChoose()}>
                        <FolderOpen size={15} />
                        {t('settings.appearance.wallpaper.portraitChoose')}
                      </button>
                      {appSettings.appCustomWallpaperPath ? (
                        <button className="settings-danger-button" type="button" onClick={handleAppWallpaperClear}>
                          <Trash2 size={15} />
                          {t('settings.appearance.wallpaper.clear')}
                        </button>
                      ) : null}
                      {appSettings.appPortraitWallpaperPath ? (
                        <button className="settings-danger-button" type="button" onClick={handleAppPortraitWallpaperClear}>
                          <Trash2 size={15} />
                          {t('settings.appearance.wallpaper.portraitClear')}
                        </button>
                      ) : null}
                    </div>
                    {appSettings.appCustomWallpaperPath ? (
                      <p className="settings-wallpaper-path" title={appSettings.appCustomWallpaperPath}>
                        <span>{t('settings.appearance.wallpaper.landscapePath')}</span>
                        {appSettings.appCustomWallpaperPath}
                      </p>
                    ) : null}
                    {appSettings.appPortraitWallpaperPath ? (
                      <p className="settings-wallpaper-path" title={appSettings.appPortraitWallpaperPath}>
                        <span>{t('settings.appearance.wallpaper.portraitPath')}</span>
                        {appSettings.appPortraitWallpaperPath}
                      </p>
                    ) : null}
                    {appSettings.appWallpaperMediaType === 'video' || appSettings.appPortraitWallpaperMediaType === 'video' ? (
                      <div className="settings-chip-row settings-chip-row--left">
                        <StatusText tone="good">{t('settings.appearance.wallpaper.videoStatus')}</StatusText>
                        {appVideoWallpaperPauseModes.map((mode) => (
                          <ChipButton
                            active={(appSettings.appVideoWallpaperPauseMode ?? 'smart') === mode}
                            key={mode}
                            onClick={() => previewAndPersistAppWallpaperSettings({ appVideoWallpaperPauseMode: mode })}
                          >
                            {t(appVideoWallpaperPauseModeLabels[mode])}
                          </ChipButton>
                        ))}
                      </div>
                    ) : null}
                    <div className="settings-wallpaper-controls">
                        <div className="settings-wallpaper-control">
                          <span>{t('settings.appearance.wallpaper.scale')}</span>
                          <NumberRangeField
                            min={100}
                            max={220}
                            step={1}
                            suffix="%"
                            value={appSettings.appWallpaperScalePercent ?? 100}
                            onChange={(appWallpaperScalePercent) => previewAndPersistAppWallpaperSettings({ appWallpaperScalePercent })}
                          />
                        </div>
                        <div className="settings-wallpaper-control">
                          <span>{t('settings.appearance.wallpaper.blur')}</span>
                          <NumberRangeField
                            min={0}
                            max={40}
                            step={1}
                            suffix="px"
                            value={appSettings.appWallpaperBlurPx ?? 0}
                            onChange={(appWallpaperBlurPx) => previewAndPersistAppWallpaperSettings({ appWallpaperBlurPx })}
                          />
                        </div>
                        <div className="settings-wallpaper-control">
                          <span>{t('settings.appearance.wallpaper.brightness')}</span>
                          <NumberRangeField
                            min={40}
                            max={140}
                            step={1}
                            suffix="%"
                            value={appSettings.appWallpaperBrightnessPercent ?? 100}
                            onChange={(appWallpaperBrightnessPercent) => previewAndPersistAppWallpaperSettings({ appWallpaperBrightnessPercent })}
                          />
                        </div>
                        <div className="settings-wallpaper-control">
                          <span>{t('settings.appearance.wallpaper.uiOpacity')}</span>
                          <NumberRangeField
                            min={0}
                            max={100}
                            step={1}
                            suffix="%"
                            value={appSettings.appWallpaperUiOpacityPercent ?? 100}
                            onChange={(appWallpaperUiOpacityPercent) => previewAndPersistAppWallpaperSettings({ appWallpaperUiOpacityPercent })}
                          />
                        </div>
                        <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                          <span>{t('settings.appearance.wallpaper.visualProtection')}</span>
                          <ToggleButton
                            active={appSettings.appWallpaperVisualProtectionEnabled !== false}
                            onClick={() =>
                              previewAndPersistAppWallpaperSettings({
                                appWallpaperVisualProtectionEnabled: !(appSettings.appWallpaperVisualProtectionEnabled !== false),
                              })
                            }
                          />
                        </div>
                        <div className="settings-wallpaper-control settings-wallpaper-control--toggle">
                          <span>{t('settings.appearance.wallpaper.unifiedOpacity')}</span>
                          <ToggleButton
                            active={appSettings.appWallpaperUnifiedOpacityEnabled ?? false}
                            onClick={() =>
                              previewAndPersistAppWallpaperSettings({
                                appWallpaperUnifiedOpacityEnabled: !(appSettings.appWallpaperUnifiedOpacityEnabled ?? false),
                              })
                            }
                          />
                        </div>
                    </div>
                  </div>
                ) : (
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions settings-wallpaper-empty-actions">
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => void handleAppWallpaperChoose()}>
                      <FolderOpen size={15} />
                      {t('settings.appearance.wallpaper.choose')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => void handleAppPortraitWallpaperChoose()}>
                      <FolderOpen size={15} />
                      {t('settings.appearance.wallpaper.portraitChoose')}
                    </button>
                  </div>
                )}
              </SettingRow>
              <SettingRow title={t('settings.appearance.font.main.title')} description={t('settings.appearance.font.main.description')}>
                <button className="settings-font-picker-button" type="button" onClick={() => handleFontPickerOpen('main')}>
                  <span style={{ fontFamily: `"${appearancePreferences.mainFontFamily}", var(--echo-font-family)` }}>{appearancePreferences.mainFontFamily}</span>
                  <em>{t('settings.appearance.font.choose')}</em>
                </button>
              </SettingRow>
              <SettingRow title={t('settings.appearance.font.chinese.title')} description={t('settings.appearance.font.chinese.description')}>
                <button className="settings-font-picker-button" type="button" onClick={() => handleFontPickerOpen('chinese')}>
                  <span style={{ fontFamily: `"${appearancePreferences.chineseFontFamily}", var(--echo-font-family)` }}>
                    {appearancePreferences.chineseFontFamily}
                  </span>
                  <em>{t('settings.appearance.font.choose')}</em>
                </button>
              </SettingRow>
              <SettingRow title={t('settings.appearance.font.fallback.title')} description={t('settings.appearance.font.fallback.description')}>
                <button className="settings-font-picker-button" type="button" onClick={() => handleFontPickerOpen('fallback')}>
                  <span style={{ fontFamily: `"${appearancePreferences.fallbackFontFamily}", var(--echo-font-family)` }}>
                    {appearancePreferences.fallbackFontFamily}
                  </span>
                  <em>{t('settings.appearance.font.choose')}</em>
                </button>
              </SettingRow>
              <SettingRow title={t('settings.appearance.fontSize.title')} description={t('settings.appearance.fontSize.description')}>
                <NumberRangeField
                  min={12}
                  max={18}
                  step={1}
                  suffix="px"
                  value={appearancePreferences.baseFontSize}
                  onChange={(baseFontSize) => handleAppearanceChange({ ...appearancePreferences, baseFontSize })}
                />
              </SettingRow>
              <SettingRow title={t('settings.appearance.lineHeight.title')} description={t('settings.appearance.lineHeight.description')}>
                <NumberRangeField
                  min={1.1}
                  max={1.8}
                  step={0.05}
                  suffix=""
                  value={appearancePreferences.lineHeight}
                  onChange={(lineHeight) => handleAppearanceChange({ ...appearancePreferences, lineHeight })}
                />
              </SettingRow>
              <SettingRow title={t('settings.appearance.textDepth.title')} description={t('settings.appearance.textDepth.description')}>
                <NumberRangeField
                  min={35}
                  max={100}
                  step={1}
                  suffix="%"
                  value={appearancePreferences.textDepth}
                  onChange={(textDepth) => handleAppearanceChange({ ...appearancePreferences, textDepth })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-album-cover-shape"
                highlighted={highlightedSettingId === 'settings-row-album-cover-shape'}
                title={t('settings.appearance.albumCoverShape.title')}
                description={t('settings.appearance.albumCoverShape.description')}
              >
                <div className="settings-chip-row settings-chip-row--left">
                  <ChipButton
                    active={appearancePreferences.albumCoverShape !== 'square'}
                    onClick={() => handleAppearanceChange({ ...appearancePreferences, albumCoverShape: 'rounded' })}
                  >
                    {t('settings.appearance.albumCoverShape.rounded')}
                  </ChipButton>
                  <ChipButton
                    active={appearancePreferences.albumCoverShape === 'square'}
                    onClick={() => handleAppearanceChange({ ...appearancePreferences, albumCoverShape: 'square' })}
                  >
                    {t('settings.appearance.albumCoverShape.square')}
                  </ChipButton>
                </div>
              </SettingRow>
              <SettingRow title={t('settings.appearance.reset.title')} description={t('settings.appearance.reset.description')}>
                <button className="settings-action-button" type="button" onClick={handleAppearanceReset}>
                  {t('settings.appearance.reset.action')}
                </button>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Download} id="library" title={t('settings.nav.library.label')}>
              <div id="settings-row-library-folders" data-search-highlight={highlightedSettingId === 'settings-row-library-folders' ? 'true' : undefined}>
                <LibraryFoldersPanel autoRefresh={libraryDeferredRefreshReady} pollScanStatuses={false} />
              </div>
              <SettingRow
                id="settings-row-live-library-updates"
                highlighted={highlightedSettingId === 'settings-row-live-library-updates'}
                title={'\u5b9e\u65f6\u66f4\u65b0\u66f2\u5e93'}
                description={'\u5f00\u542f\u540e\u4f1a\u76d1\u542c\u5df2\u6dfb\u52a0\u7684\u672c\u5730\u66f2\u5e93\u6587\u4ef6\u5939\uff0c\u65b0\u589e\u6216\u4fee\u6539\u97f3\u9891\u6587\u4ef6\u4f1a\u81ea\u52a8\u8fdb\u5165\u66f2\u5e93\uff1b\u9ed8\u8ba4\u5173\u95ed\u3002'}
              >
                <ToggleButton
                  active={appSettings?.liveLibraryUpdatesEnabled ?? false}
                  disabled={!appSettings}
                  onClick={handleLiveLibraryUpdatesToggle}
                />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-quality"
                highlighted={highlightedSettingId === 'settings-row-library-quality'}
                title={'\u8d44\u6599\u8d28\u91cf\u6574\u7406'}
                description={'\u7edf\u8ba1\u7f3a\u5c01\u9762\u3001\u56de\u9000\u5143\u6570\u636e\u548c\u7f51\u7edc\u5019\u9009\uff0c\u53ea\u505a\u5b9a\u5411\u67e5\u770b\u548c\u624b\u52a8\u8865\u5168\u5165\u53e3\u3002'}
              >
                <LibraryQualityPanel autoRefresh={libraryDeferredRefreshReady} networkMetadataEnabled={networkMetadataEnabled} />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-lyrics-backfill"
                highlighted={highlightedSettingId === 'settings-row-library-lyrics-backfill'}
                title="一键歌词补全"
                description="后台筛选缺失歌词并分批补全；快速模式优先网易、QQ、LRCLIB 等高命中源，完整模式会继续扩大来源。"
              >
                <div className="settings-cache-panel settings-cache-panel--lyrics-backfill">
                  <div className="settings-inline-control">
                    <span>命中率</span>
                    <NumberRangeField
                      min={30}
                      max={95}
                      step={1}
                      suffix="%"
                      value={lyricsBackfillAutoAcceptPercent}
                      onChange={(value) => patchAppSettings({ lyricsBackfillAutoAcceptScore: value / 100 })}
                    />
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={lyricsBackfillBusy || lyricsBackfillRunning}
                      onClick={() => void handleStartLyricsBackfill('quick')}
                    >
                      <Zap size={15} />
                      快速补全缺失歌词
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={lyricsBackfillBusy || lyricsBackfillRunning}
                      onClick={() => void handleStartLyricsBackfill('complete')}
                    >
                      <Search size={15} />
                      完整补全
                    </button>
                    {lyricsBackfillRunning ? (
                      <button
                        className="settings-danger-button"
                        type="button"
                        onClick={() => void handleCancelLyricsBackfill()}
                      >
                        <X size={15} />
                        取消
                      </button>
                    ) : null}
                  </div>
                  {lyricsBackfillMessage ? <p className="settings-inline-note">{lyricsBackfillMessage}</p> : null}
                  {lyricsBackfillJob ? (
                    <div className="settings-update-progress settings-lyrics-backfill-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>歌词补全进度 · {lyricsBackfillStatusLabel}</strong>
                        <span>
                          {lyricsBackfillProgressDone} / {lyricsBackfillJob.totalTracks || 0}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label="歌词补全进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={lyricsBackfillProgressPercent}
                      >
                        <span style={{ width: `${lyricsBackfillProgressPercent}%` }} />
                      </div>
                      <div className="settings-update-progress-meta">
                        <span>
                          命中 {lyricsBackfillJob.matchedTracks} · 未找到 {lyricsBackfillJob.notFoundTracks} · 已有 {lyricsBackfillJob.alreadyCachedTracks} · 失败 {lyricsBackfillJob.errorCount}
                        </span>
                        <span>{lyricsBackfillJob.currentTrackTitle ?? (lyricsBackfillJob.mode === 'complete' ? '完整模式' : '快速模式')}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-health-report"
                highlighted={highlightedSettingId === 'settings-row-library-health-report'}
                title={'曲库体检报告'}
                description={'汇总数据库、扫描、缓存、资料质量、实时更新和远程源状态；只读导出，不自动修复。'}
              >
                <LibraryHealthReportPanel />
              </SettingRow>
              <div id="settings-row-library-lab" data-search-highlight={highlightedSettingId === 'settings-row-library-lab' ? 'true' : undefined}>
                <LibraryDiagnosticsPanel />
              </div>
              <SettingRow
                id="settings-row-artist-wall-artwork"
                highlighted={highlightedSettingId === 'settings-row-artist-wall-artwork'}
                title="艺术家墙封面"
                description="用艺术家的一张专辑封面替代字母占位。"
              >
                <ToggleButton active={appSettings?.artistWallAlbumArtwork ?? false} disabled={!appSettings} onClick={handleArtistWallAlbumArtworkToggle} />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-artist-avatars"
                highlighted={highlightedSettingId === 'settings-row-artist-avatars'}
                title={t('settings.appearance.artistAvatars.title')}
                description={t('settings.appearance.artistAvatars.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--artist-avatars">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('settings.appearance.artistAvatars.toggle')}</span>
                      <ToggleButton
                        active={appSettings?.autoFetchArtistImages ?? false}
                        disabled={!appSettings || artistImageBusyAction !== null}
                        onClick={handleAutoFetchArtistImagesToggle}
                      />
                    </div>
                    <div className="settings-inline-toggle">
                      <span>{t('settings.appearance.artistAvatars.fallback')}</span>
                      <ToggleButton
                        active={appSettings?.artistWallAlbumFallbackForMissingAvatars ?? false}
                        disabled={!appSettings}
                        onClick={handleArtistWallAlbumFallbackForMissingAvatarsToggle}
                      />
                    </div>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!appSettings?.autoFetchArtistImages || artistImageBusyAction !== null}
                      onClick={() => void handleRefreshMissingArtistImages()}
                    >
                      <RotateCw className={artistImageBusyAction === 'refresh' ? 'spinning-icon' : undefined} size={15} />
                      {artistImageBusyAction === 'refresh'
                        ? t('settings.appearance.artistAvatars.action.queueing')
                        : t('settings.appearance.artistAvatars.action.refreshMissing')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!appSettings?.autoFetchArtistImages || artistImageBusyAction !== null}
                      onClick={() => void handleArtistImagePauseToggle()}
                    >
                      {artistImagePaused ? <Play size={15} /> : <Pause size={15} />}
                      {artistImagePaused ? '继续获取' : '暂停获取'}
                    </button>
                    <button
                      className="settings-danger-button"
                      type="button"
                      disabled={artistImageBusyAction !== null}
                      onClick={() => void handleClearArtistImageCache()}
                    >
                      <Trash2 size={15} />
                      {t('settings.appearance.artistAvatars.action.clear')}
                    </button>
                  </div>
                  {artistImageMessage ? <p className="settings-inline-note">{artistImageMessage}</p> : null}
                  {artistImageProgress ? (
                    <div className="settings-update-progress settings-artist-image-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>头像获取进度 · {artistImageStatusLabel}</strong>
                        <span>
                          {artistImageProgressDone} / {artistImageProgressTotal}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label="头像获取进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={artistImageProgressPercent}
                      >
                        <span style={{ width: `${artistImageProgressPercent}%` }} />
                      </div>
                      <div className="settings-update-progress-meta">
                        <span>
                          处理中 {artistImageActive} · 待处理 {artistImageSummary.pending} · 已缓存 {artistImageSummary.matched} · 未找到 {artistImageSummary.notFound} · 失败 {artistImageFailed}
                        </span>
                        <span>跳过 {artistImageProgress.lastQueued.skipped}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              {downloadsFeatureUnlocked ? (
                <>
                  <SettingRow
                    className="setting-row--full setting-row--compact-panel"
                    title="下载路径"
                    description="选择下载音频保存目录，下载页会同步使用这个位置。"
                  >
                    <div className="settings-cache-panel settings-cache-panel--download">
                      <div className="settings-cache-path">
                        <em>当前下载文件夹</em>
                        <strong title={currentDownloadDirectoryLabel}>{currentDownloadDirectoryLabel}</strong>
                      </div>
                      <div className="settings-chip-row settings-chip-row--left">
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => void handleDownloadDirectoryChoose()}
                          disabled={downloadDirectoryBusy}
                        >
                          <FolderOpen size={15} />
                          {downloadSettings?.outputDirectory ? '更换文件夹' : '选择文件夹'}
                        </button>
                      </div>
                      {downloadDirectoryMessage ? <p className="settings-inline-note">{downloadDirectoryMessage}</p> : null}
                    </div>
                  </SettingRow>
                  <SettingRow
                    id="settings-row-streaming-download-actions"
                    highlighted={highlightedSettingId === 'settings-row-streaming-download-actions'}
                    title="流媒体下载按钮"
                    description="默认隐藏流媒体页下载入口；开启后才会在支持的平台歌曲行显示下载按钮。"
                  >
                    <div className="settings-inline-toggle settings-inline-toggle--compact">
                      <span>{appSettings?.streamingDownloadActionsEnabled ? '已显示' : '已隐藏'}</span>
                      <ToggleButton
                        active={appSettings?.streamingDownloadActionsEnabled === true}
                        disabled={!appSettings}
                        onClick={() => patchAppSettings({ streamingDownloadActionsEnabled: !(appSettings?.streamingDownloadActionsEnabled ?? false) })}
                      />
                    </div>
                  </SettingRow>
                </>
              ) : null}
              <SettingRow
                title="歌单自动备份"
                description="开启后，刷新、清空或删除歌单前会先在系统下载文件夹保存一份 JSON 备份。"
              >
                <div className="settings-inline-toggle settings-inline-toggle--compact">
                  <span>{appSettings?.playlistBackupsEnabled === false ? '已关闭' : '已开启'}</span>
                  <ToggleButton
                    active={appSettings?.playlistBackupsEnabled ?? true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ playlistBackupsEnabled: !(appSettings?.playlistBackupsEnabled ?? true) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title="重复歌曲"
                description="在歌曲列表中隐藏低音质重复版本，不会删除文件。"
              >
                <div className="settings-cache-panel settings-cache-panel--duplicates">
                  <div className="settings-status-grid">
                    <span>
                      <em>隐藏状态</em>
                      <strong>{appSettings?.duplicateTracksEnabled ? `已开启，隐藏 ${duplicateSummary?.hiddenTracks ?? 0} 首` : '未开启'}</strong>
                    </span>
                    <span>
                      <em>分析结果</em>
                      <strong>{duplicateSummary ? `${duplicateSummary.duplicateGroups} 组 / ${duplicateSummary.duplicateMembers} 首候选` : '尚未读取'}</strong>
                    </span>
                    <span>
                      <em>更新时间</em>
                      <strong>{duplicateSummary?.updatedAt ? new Date(duplicateSummary.updatedAt).toLocaleString() : '尚未分析'}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>隐藏重复歌曲</span>
                      <ToggleButton
                        active={appSettings?.duplicateTracksEnabled ?? false}
                        disabled={!appSettings || duplicateBusyAction !== null}
                        onClick={() => void handleDuplicateVisibilityToggle()}
                      />
                    </div>
                    <button className="settings-action-button" type="button" disabled={duplicateBusyAction !== null} onClick={() => void handleAnalyzeDuplicateTracks()}>
                      <RotateCw className={duplicateBusyAction === 'analyze' ? 'spinning-icon' : undefined} size={15} />
                      {duplicateBusyAction === 'analyze' ? '分析中...' : '分析重复歌曲'}
                    </button>
                  </div>
                  {appSettings?.duplicateTracksEnabled ? <p className="settings-inline-note">当前已隐藏 {duplicateSummary?.hiddenTracks ?? 0} 首重复歌曲。</p> : null}
                  {duplicateMessage ? <p className="settings-inline-note">{duplicateMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-merge-strategy"
                highlighted={highlightedSettingId === 'settings-row-library-merge-strategy'}
                title="专辑/艺人合并策略"
                description="选择资料库如何整理专辑和艺人别名，不会改写歌曲 artist 显示或元数据。"
              >
                <div className="settings-cache-panel settings-cache-panel--album">
                  <div className="settings-chip-row settings-chip-row--left">
                    <ChipButton
                      active={(pendingAlbumMergeStrategy ?? appSettings?.albumMergeStrategy ?? 'standard') === 'standard'}
                      onClick={() => setPendingAlbumMergeStrategy('standard')}
                    >
                      标准模式（推荐）
                    </ChipButton>
                    <ChipButton
                      active={(pendingAlbumMergeStrategy ?? appSettings?.albumMergeStrategy ?? 'standard') === 'sameTitleAndCover'}
                      onClick={() => setPendingAlbumMergeStrategy('sameTitleAndCover')}
                    >
                      宽松合并
                    </ChipButton>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>标准模式（推荐）</em>
                      <strong>优先使用 Album Artist；缺失时按文件夹 + 专辑名分组，最不容易误合并。</strong>
                    </span>
                    <span>
                      <em>宽松合并</em>
                      <strong>专辑名匹配度 95% 以上直接合并；否则封面一致且专辑名匹配度 90% 以上时合并。</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <ChipButton
                      active={(pendingArtistMergeStrategy ?? appSettings?.artistMergeStrategy ?? 'standard') === 'conservative'}
                      onClick={() => setPendingArtistMergeStrategy('conservative')}
                    >
                      保守艺人合并
                    </ChipButton>
                    <ChipButton
                      active={(pendingArtistMergeStrategy ?? appSettings?.artistMergeStrategy ?? 'standard') === 'standard'}
                      onClick={() => setPendingArtistMergeStrategy('standard')}
                    >
                      普通艺人合并（推荐）
                    </ChipButton>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>保守艺人合并</em>
                      <strong>只合并大小写、全半角、空格、点号、尾部符号等明显同名变体。</strong>
                    </span>
                    <span>
                      <em>普通艺人合并（推荐）</em>
                      <strong>在保守规则上处理 +81 / Topic / Official 等尾缀，并用高阈值模糊匹配合并长名称近似别名。</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleAlbumMergeStrategyApply()}
                      disabled={!appSettings || albumGroupingBusy}
                    >
                      {albumGroupingBusy ? '重新整理中...' : '应用并重新整理分组'}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleScanLibraryFolders()}
                      disabled={libraryScanActionDisabled}
                    >
                      <RotateCw className={libraryScanActionDisabled ? 'spinning-icon' : undefined} size={15} />
                      {libraryScanActionDisabled ? '扫描队列中...' : '扫描曲库'}
                    </button>
                  </div>
                  {albumGroupingMessage ? <p className="settings-inline-note">{albumGroupingMessage}</p> : null}
                  {libraryScanMessage ? <p className="settings-inline-note">{libraryScanMessage}</p> : null}
                  {libraryScanHasVisibleProgress ? (
                    <div className="settings-update-progress settings-library-scan-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>{libraryScanRunningList.length > 0 ? '曲库扫描进度' : '最近一次曲库扫描'}</strong>
                        <span>
                          {libraryScanProgressDone} / {libraryScanProgressTotal || '?'}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label="曲库扫描进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={libraryScanProgressPercent}
                        data-indeterminate={libraryScanProgressTotal === 0 ? 'true' : undefined}
                      >
                        <span style={{ width: `${libraryScanProgressTotal === 0 ? 35 : libraryScanProgressPercent}%` }} />
                      </div>
                      {libraryScanProgressMessage ? (
                        <div className="settings-update-progress-meta">
                          <span>{libraryScanProgressMessage}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title="嵌入标签重扫"
                description="重新读取音频文件里的内嵌标题、艺人、专辑、音轨号和封面；读取到后直接应用到曲库。"
              >
                <div className="settings-cache-panel settings-cache-panel--embedded-tags">
                  <div className="settings-status-grid">
                    <span>
                      <em>全部重扫</em>
                      <strong>无视旧缓存，逐首重新读取嵌入标签</strong>
                    </span>
                    <span>
                      <em>缺失封面</em>
                      <strong>只重扫没有封面或只有默认封面的歌曲</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={embeddedTagRescanBusy !== null}
                      onClick={() => void handleRescanEmbeddedTags('all')}
                    >
                      <RotateCw className={embeddedTagRescanBusy === 'all' ? 'spinning-icon' : undefined} size={15} />
                      {embeddedTagRescanBusy === 'all' ? '启动中...' : '重扫所有嵌入标签'}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={embeddedTagRescanBusy !== null}
                      onClick={() => void handleRescanEmbeddedTags('missing-cover')}
                    >
                      <RotateCw className={embeddedTagRescanBusy === 'missing-cover' ? 'spinning-icon' : undefined} size={15} />
                      {embeddedTagRescanBusy === 'missing-cover' ? '启动中...' : '重扫缺失封面的歌曲'}
                    </button>
                  </div>
                  {embeddedTagRescanMessage ? <p className="settings-inline-note">{embeddedTagRescanMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title="封面缓存目录"
                description="迁移只会复制缓存，不会移动或删除你的音乐文件。"
              >
                <div className="settings-cache-panel settings-cache-panel--cover">
                  {cacheInventory ? (
                    <div className="settings-cache-result">
                      <span>
                        <em>缓存合计</em>
                        <strong>{formatCacheBytes(cacheInventory.totalSizeBytes)}</strong>
                      </span>
                      {cacheInventory.items.map((item) => (
                        <span key={item.kind}>
                          <em>{item.label}</em>
                          <strong>{formatCacheBytes(item.sizeBytes)} · {item.fileCount} 个文件</strong>
                          <p title={item.path}>{item.path}</p>
                          <p>{item.movable ? '可迁移' : '暂不迁移'} · {item.reason}{item.lastError ? ` · ${item.lastError}` : ''}</p>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-inline-note">{cacheInventoryBusy ? '正在统计缓存...' : '缓存清单暂不可用。'}</p>
                  )}
                  <div className="settings-cache-path">
                    <em>当前缓存目录</em>
                    <strong title={currentCacheDirectoryLabel}>{currentCacheDirectoryLabel}</strong>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" onClick={() => void handleCacheDirectoryChoose()} disabled={cacheDirectoryBusy}>
                      <FolderOpen size={15} />
                      选择目录
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => {
                        setPendingCacheDirectory(null);
                        setCacheDirectoryResult(null);
                        setCacheDirectoryMessage(null);
                      }}
                      disabled={cacheDirectoryBusy || !defaultCacheDirectory}
                    >
                      恢复默认
                    </button>
                  </div>
                  {pendingCacheDirectory !== undefined ? (
                    <div className="settings-cache-confirm">
                      <span>
                        <em>当前</em>
                        <strong title={currentCacheDirectory}>{currentCacheDirectory || '读取中'}</strong>
                      </span>
                      <span>
                        <em>新目录</em>
                        <strong title={pendingResolvedCacheDirectory ?? ''}>{pendingResolvedCacheDirectory ?? '默认目录读取中'}</strong>
                      </span>
                      <p>迁移会复制封面缓存并更新数据库路径，不会删除旧缓存目录。</p>
                      <div className="settings-chip-row settings-chip-row--left">
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => void handleCacheDirectoryApply(true)}
                          disabled={cacheDirectoryBusy || !pendingResolvedCacheDirectory}
                        >
                          迁移到新目录
                        </button>
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => void handleCacheDirectoryApply(false)}
                          disabled={cacheDirectoryBusy || !pendingResolvedCacheDirectory}
                        >
                          仅切换不迁移
                        </button>
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => setPendingCacheDirectory(undefined)}
                          disabled={cacheDirectoryBusy}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {cacheDirectoryMessage ? <p className="settings-inline-note">{cacheDirectoryMessage}</p> : null}
                  {cacheDirectoryResult ? (
                    <div className="settings-cache-result">
                      <span>
                        <em>复制</em>
                        <strong>{cacheDirectoryResult.copiedFiles}</strong>
                      </span>
                      <span>
                        <em>跳过</em>
                        <strong>{cacheDirectoryResult.skippedFiles}</strong>
                      </span>
                      <span>
                        <em>更新记录</em>
                        <strong>{cacheDirectoryResult.updatedCoverRows}</strong>
                      </span>
                      {cacheDirectoryResult.warnings.length ? (
                        <p>警告：{cacheDirectoryResult.warnings.slice(0, 3).join('；')}</p>
                      ) : null}
                      {cacheDirectoryResult.errors.length ? (
                        <p className="settings-inline-error">错误：{cacheDirectoryResult.errors.slice(0, 3).join('；')}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                title="扫描性能"
                description="选择 ECHO Next 在曲库扫描时并行读取的文件数量。"
              >
                <div className="settings-chip-row">
                  {[
                    ['low', '低占用'],
                    ['balanced', '均衡'],
                    ['performance', '高性能'],
                  ].map(([mode, label]) => (
                    <ChipButton
                      active={(appSettings?.scanPerformanceMode ?? 'balanced') === mode}
                      key={mode}
                      onClick={() => patchAppSettings({ scanPerformanceMode: mode as AppSettings['scanPerformanceMode'] })}
                    >
                      {label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title="BPM / Offset 分析"
                description="默认开启。开启后只会在播放当前歌曲时低优先级分析缺失 BPM，并把检测到的 BPM 写入歌曲标签；手动按钮仍可一次性补齐缺失 BPM。"
              >
                <div className="settings-cache-panel settings-cache-panel--bpm-analysis">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>启用 BPM 分析</span>
                      <ToggleButton
                        active={appSettings?.audioAnalysisEnabled ?? false}
                        disabled={!appSettings || bpmAnalysisBusy}
                        onClick={() => patchAppSettings({ audioAnalysisEnabled: !(appSettings?.audioAnalysisEnabled ?? false) })}
                      />
                    </div>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!appSettings?.audioAnalysisEnabled || bpmAnalysisBusy}
                      onClick={() => void handleStartBpmAnalysis()}
                    >
                      <RotateCw className={bpmAnalysisBusy ? 'spinning-icon' : undefined} size={15} />
                      {bpmAnalysisBusy ? '分析中...' : '分析缺失 BPM'}
                    </button>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>状态</em>
                      <strong>{appSettings?.audioAnalysisEnabled ? '已开启' : '已关闭'}</strong>
                    </span>
                    <span>
                      <em>进度</em>
                      <strong>{bpmAnalysisJob ? `${bpmAnalysisJob.processedTracks}/${bpmAnalysisJob.totalTracks}` : '尚未运行'}</strong>
                    </span>
                    <span>
                      <em>已更新</em>
                      <strong>{bpmAnalysisJob?.updatedTracks ?? 0}</strong>
                    </span>
                  </div>
                  {bpmAnalysisMessage ? <p className="settings-inline-note">{bpmAnalysisMessage}</p> : null}
                  {bpmAnalysisJob?.errorCount ? <p className="settings-inline-error">分析错误 {bpmAnalysisJob.errorCount} 个，已跳过问题文件。</p> : null}
                </div>
              </SettingRow>
              <SettingRow title={t('settings.library.network.title')} description={t('settings.library.network.description')}>
                <button
                  className={`toggle-btn ${networkMetadataEnabled ? 'active' : ''}`}
                  type="button"
                  aria-pressed={networkMetadataEnabled}
                  onClick={() => patchAppSettings({ networkMetadataEnabled: !networkMetadataEnabled })}
                >
                  <span />
                </button>
              </SettingRow>
              <SettingRow title={t('settings.library.networkSources.title')} description={t('settings.library.networkSources.description')}>
                <div className="settings-chip-row">
                  {visibleNetworkMetadataProviders.map((provider) => (
                    <ChipButton
                      active={(appSettings?.networkMetadataProviders ?? defaultNetworkMetadataProviders).includes(provider)}
                      key={provider}
                      onClick={() => toggleNetworkProvider(provider)}
                    >
                      {networkProviderLabels[provider]}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <NetworkMetadataPanel networkMetadataEnabled={networkMetadataEnabled} />
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Info} id="about" title={t('settings.nav.about.label')}>
              <SettingRow title={t('settings.about.version.title')} description={t('settings.about.version.description')}>
                <StatusText tone={appVersion ? 'neutral' : 'muted'}>{appVersion ?? t('common.checking')}</StatusText>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.about.updates.title')}
                description={t('settings.about.updates.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--updates">
                  <div className="settings-status-grid settings-status-grid--updates">
                    <span>
                      <em>{t('settings.about.updates.currentVersion')}</em>
                      <strong>{appVersion ?? updateStatus?.currentVersion ?? t('common.checking')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.updates.latestVersion')}</em>
                      <strong>{updateStatus?.latestVersion ?? 'n/a'}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.updates.status')}</em>
                      <strong>{t(getUpdateStateLabel(updateStatus?.state ?? (appSettings?.autoUpdateEnabled === false ? 'disabled' : 'idle')))}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.updates.lastChecked')}</em>
                      <strong>{updateStatus?.checkedAt ? new Date(updateStatus.checkedAt).toLocaleString() : 'n/a'}</strong>
                    </span>
                  </div>
                  {showUpdateDownloadProgress ? (
                    <div className="settings-update-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <span>{updateStatus?.state === 'downloaded' ? t('settings.about.updates.progress.ready') : t('settings.about.updates.progress.downloading')}</span>
                        <strong>{updateDownloadPercent}%</strong>
                      </div>
                      <div
                        aria-label={t('settings.about.updates.progress.aria', { percent: updateDownloadPercent })}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={updateDownloadPercent}
                        className="settings-update-progress-track"
                        role="progressbar"
                      >
                        <span style={{ width: `${updateDownloadPercent}%` }} />
                      </div>
                      <div className="settings-update-progress-meta">
                        <span>{updateDownloadSizeLabel}</span>
                        <span>{updateDownloadSpeedLabel}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('settings.about.updates.autoCheck')}</span>
                      <ToggleButton
                        active={appSettings?.autoUpdateEnabled ?? true}
                        disabled={!appSettings}
                        onClick={() => patchAppSettings({ autoUpdateEnabled: !(appSettings?.autoUpdateEnabled ?? true) })}
                      />
                    </div>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={updateBusy || appSettings?.autoUpdateEnabled === false}
                      onClick={() => void handleCheckForUpdates()}
                    >
                      <RotateCw className={updateBusy ? 'spinning-icon' : undefined} size={15} />
                      {updateBusy ? t('settings.about.updates.action.checking') : t('settings.about.updates.action.check')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenRepository()}>
                      <Github size={15} />
                      ECHO NEXT
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://afdian.com/a/echonext')}
                    >
                      <ExternalLink size={15} />
                      {t('settings.about.updates.action.afdian')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://github.com/moekotori/echo/releases')}
                    >
                      <History size={15} />
                      {t('settings.about.updates.action.history')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://qm.qq.com/q/KrJE8PIqSQ')}
                    >
                      <ExternalLink size={15} />
                      {t('settings.about.updates.action.qq')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://discord.gg/g7v4WMRq3K')}
                    >
                      <ExternalLink size={15} />
                      {t('settings.about.updates.action.discord')}
                    </button>
                  </div>
                  {updateStatus?.releaseNotes ? (
                    <div className="settings-update-notes">
                      <em>{t('settings.about.updates.releaseNotes')}</em>
                      {deferredAboutReleaseNotes === updateStatus.releaseNotes ? (
                        <ReleaseNotesMarkdown markdown={updateStatus.releaseNotes} />
                      ) : (
                        <p className="settings-inline-note">{t('settings.about.updates.releaseNotesPending')}</p>
                      )}
                    </div>
                  ) : (
                    <p className="settings-inline-note">{t('settings.about.updates.releaseNotesEmpty')}</p>
                  )}
                  {updateStatus?.error ? <p className="settings-inline-error">{updateStatus.error}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-safe-mode"
                highlighted={highlightedSettingId === 'settings-row-safe-mode'}
                title="Safe mode"
                description="持续开启后，每次启动会先打开异常记录器；只显示异常、渲染器错误、音频错误和慢启动阶段，不混入普通播放日志。"
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-status-grid">
                    <span>
                      <em>状态</em>
                      <strong>{appSettings?.safeModeEnabled ? '开启' : '关闭'}</strong>
                    </span>
                    <span>
                      <em>生效范围</em>
                      <strong>每次启动</strong>
                    </span>
                    <span>
                      <em>启动行为</em>
                      <strong>只诊断</strong>
                    </span>
                    <span>
                      <em>慢阶段阈值</em>
                      <strong>2000ms</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>Safe mode</span>
                      <ToggleButton
                        active={appSettings?.safeModeEnabled === true}
                        disabled={!appSettings}
                        onClick={() => patchAppSettings({ safeModeEnabled: !(appSettings?.safeModeEnabled ?? false) })}
                      />
                    </div>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenDevConsole()}>
                      <Code2 size={15} />
                      打开控制台
                    </button>
                    <button className="settings-action-button" type="button" disabled={diagnosticsBusy} onClick={() => void handleDiagnosticsExportZip()}>
                      <Download size={15} />
                      {diagnosticsBusy ? '导出中...' : '导出诊断包'}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    早期 PowerShell 只盯 exceptions.safe.log：警告显示黄色，错误和致命错误显示红色；完整启动时间线仍会写入安全诊断包里的 startup-timeline.safe.json。
                  </p>
                  <p className="settings-inline-note">
                    提问前请先打开此功能并导出 log；如果只有口头阐述，请向我的合作伙伴提问。
                  </p>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://www.doubao.com/chat/')}
                    >
                      <ExternalLink size={15} />
                      合作伙伴
                    </button>
                  </div>
                  {devConsoleMessage ? <p className="settings-inline-note">{devConsoleMessage}</p> : null}
                  {diagnosticsMessage ? <p className="settings-inline-note">{diagnosticsMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-diagnostics-assistant"
                highlighted={highlightedSettingId === 'settings-row-diagnostics-assistant'}
                title="诊断助手"
                description="本地、安全、详细地整理音频链路、崩溃状态、日志和导出入口；不会自动上传。"
              >
                <DiagnosticsAssistantPanel lastCrashSummary={lastCrashSummary} />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-diagnostics"
                highlighted={highlightedSettingId === 'settings-row-diagnostics'}
                title="Diagnostics / 崩溃报告"
                description="报错默认生成轻量 Markdown 报告；日志目录仍保留在本地，不会自动上传。"
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-status-grid">
                    <span>
                      <em>上次异常退出</em>
                      <strong>{lastCrashSummary ? '检测到' : '未检测到'}</strong>
                    </span>
                    <span>
                      <em>Session</em>
                      <strong>{lastCrashSummary?.sessionId ?? 'n/a'}</strong>
                    </span>
                    <span>
                      <em>Started</em>
                      <strong>{lastCrashSummary?.startedAt ?? 'n/a'}</strong>
                    </span>
                    <span>
                      <em>Detected</em>
                      <strong>{lastCrashSummary?.detectedAt ?? 'n/a'}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" disabled={diagnosticsBusy} onClick={() => void handleDiagnosticsExport()}>
                      <Download size={15} />
                      {diagnosticsBusy ? '导出中...' : '导出 Markdown'}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenFolder()}>
                      <FolderOpen size={15} />
                      打开日志目录
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenCrashReport()}>
                      <FileText size={15} />
                      打开崩溃报告
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenAudioCrashReport()}>
                      <Headphones size={15} />
                      打开音频报告
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenDevConsole()}>
                      <Code2 size={15} />
                      打开调试控制台
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!lastCrashSummary}
                      onClick={() => void handleDiagnosticsClearSummary()}
                    >
                      清除上次异常提示
                    </button>
                  </div>
                  {diagnosticsMessage ? <p className="settings-inline-note">{diagnosticsMessage}</p> : null}
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Trash2} id="danger" title={t('settings.nav.danger.label')}>
              <div className="settings-database-protection" data-health={databaseHealthStatus ?? 'unknown'}>
                <header>
                  <div>
                    <span className="section-kicker">{t('settings.danger.database.kicker')}</span>
                    <h3>{t('settings.danger.database.title')}</h3>
                    <p>{databaseProtectionDescription}</p>
                  </div>
                  <span className={`settings-database-health settings-database-health--${databaseHealthStatus ?? 'unknown'}`}>
                    {databaseHealthBadgeLabel}
                  </span>
                </header>
                <div className="settings-database-grid">
                  <span>
                    <em>{t('settings.danger.database.meta.current')}</em>
                    <strong>{formatUpdateBytes(databaseProtectionStatus?.databaseSizeBytes)}</strong>
                    <small title={databasePathLabel}>{databasePathLabel}</small>
                  </span>
                  <span>
                    <em>{t('settings.danger.database.meta.snapshot')}</em>
                    <strong>{databaseSnapshotLabel}</strong>
                    <small>{latestHealthySnapshot?.id ?? t('settings.danger.database.meta.snapshotHint')}</small>
                  </span>
                  <span>
                    <em>{t('settings.danger.database.meta.archive')}</em>
                    <strong>{databaseArchiveLabel}</strong>
                    <small>{databaseProtectionStatus?.latestArchive?.id ?? t('settings.danger.database.meta.archiveHint')}</small>
                  </span>
                </div>
                {databaseQuarantined || (databaseHealthStatus && databaseHealthStatus !== 'ok') ? (
                  <ol className="settings-database-steps">
                    {databaseRecoverySteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
                {databaseUnrecoverable && databaseProtectionStatus?.unrecoverableReason ? (
                  <p className="settings-inline-error">{databaseProtectionStatus.unrecoverableReason}</p>
                ) : null}
                <div className="settings-database-actions">
                  <button className="settings-action-button" type="button" disabled={databaseProtectionBusyAction === 'refresh'} onClick={() => void handleRefreshDatabaseProtectionStatus()}>
                    <RotateCw size={15} />
                    {databaseProtectionBusyAction === 'refresh' ? t('settings.danger.database.action.checking') : t('settings.danger.database.action.check')}
                  </button>
                  <button className="settings-action-button" type="button" disabled={databaseProtectionBusy || appSettings?.dataProtectionDisabled === true} onClick={() => void handleCreateDatabaseSnapshot()}>
                    <Save size={15} />
                    {databaseProtectionBusyAction === 'snapshot' ? t('settings.danger.database.action.creating') : t('settings.danger.database.action.create')}
                  </button>
                  <button
                    className="settings-danger-button"
                    type="button"
                    disabled={databasePrimaryActionDisabled}
                    onClick={() => void handleDatabasePrimaryRecoveryAction()}
                  >
                    <ShieldAlert size={15} />
                    {databaseProtectionBusyAction === 'restore' || databaseProtectionBusyAction === 'scrub' ? databasePrimaryActionBusyLabel : databasePrimaryActionLabel}
                  </button>
                  {databaseQuarantined ? (
                    <button
                      className="settings-danger-button"
                      type="button"
                      disabled={databaseProtectionBusy || databaseProtectionStatus?.hasRunningScan || !databaseProtectionStatus?.canScrubQuarantinedDatabase}
                      onClick={() => void handleDiscardQuarantinedProblemTracks()}
                    >
                      <Trash2 size={15} />
                      {databaseProtectionBusyAction === 'discard' ? t('settings.danger.database.action.discarding') : t('settings.danger.database.action.discard')}
                    </button>
                  ) : null}
                  <button className="settings-danger-button" type="button" disabled={databaseProtectionBusy} onClick={() => void handleRelaunchLibraryRecoveryMode()}>
                    <Power size={15} />
                    {databaseProtectionBusyAction === 'relaunch' ? t('settings.danger.database.action.relaunching') : t('settings.danger.database.action.relaunch')}
                  </button>
                  <button className="settings-action-button" type="button" disabled={databaseProtectionBusyAction === 'open'} onClick={() => void handleOpenDataProtectionFolder()}>
                    <FolderOpen size={15} />
                    {t('settings.danger.database.action.open')}
                  </button>
                  <button className="settings-action-button" type="button" disabled={diagnosticsBusy} onClick={() => void handleDiagnosticsExport()}>
                    <FileText size={15} />
                    {diagnosticsBusy ? t('settings.danger.database.action.exporting') : t('settings.danger.database.action.export')}
                  </button>
                </div>
                <label className="settings-danger-confirm-field" htmlFor="settings-danger-confirm-word">
                  <span>{t('settings.danger.database.confirmWord')}</span>
                  <input
                    id="settings-danger-confirm-word"
                    type="text"
                    value={dangerConfirmWord}
                    placeholder={t('settings.danger.database.confirmPlaceholder')}
                    autoComplete="off"
                    onChange={(event) => setDangerConfirmWord(event.target.value)}
                  />
                </label>
                {databasePrimaryActionUnavailableReason ? <p className="settings-inline-note">{databasePrimaryActionUnavailableReason}</p> : null}
                {databaseProtectionError ? <p className="settings-inline-error" role="alert">{databaseProtectionError}</p> : null}
                {databaseProtectionMessage ? <p className="settings-inline-note" role="status">{databaseProtectionMessage}</p> : null}
                {databaseProtectionStatus?.hasRunningScan ? <p className="settings-inline-error">{t('settings.danger.database.scanRunning')}</p> : null}
                {databaseProtectionStatus?.maintenanceEvents.length ? (
                  <div className="settings-database-events">
                    {databaseProtectionStatus.maintenanceEvents.slice(0, 3).map((event) => (
                      <span key={`${event.createdAt}-${event.action}`}>
                        <em>{formatProtectionTimestamp(event.createdAt)}</em>
                        <strong>{event.action}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.danger.duplicates.title')}
                description={t('settings.danger.duplicates.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--duplicates">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('settings.danger.duplicates.meta.result')}</em>
                      <strong>
                        {duplicateCleanupBusyAction === 'scan'
                          ? t('settings.danger.duplicates.action.scanning')
                          : duplicateCleanupPreview
                          ? t('settings.danger.duplicates.meta.resultValue', { groups: duplicateCleanupPreview.groups.length, tracks: duplicateCleanupPreview.totalTracksToRemove })
                          : t('settings.danger.duplicates.meta.notScanned')}
                      </strong>
                    </span>
                    <span>
                      <em>{t('settings.danger.duplicates.meta.release')}</em>
                      <strong>{duplicateCleanupPreview ? formatUpdateBytes(duplicateCleanupPreview.totalBytesToRemove) : 'n/a'}</strong>
                    </span>
                    <span>
                      <em>{t('settings.danger.duplicates.meta.scanTime')}</em>
                      <strong>{duplicateCleanupPreview?.generatedAt ? new Date(duplicateCleanupPreview.generatedAt).toLocaleString() : t('settings.danger.duplicates.meta.notScanned')}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={duplicateCleanupBusyAction !== null || dangerBusy}
                      onClick={() => void handleScanDuplicateTrackCleanup()}
                    >
                      <RotateCw className={duplicateCleanupBusyAction === 'scan' ? 'spinning-icon' : undefined} size={15} />
                      {duplicateCleanupBusyAction === 'scan' ? t('settings.danger.duplicates.action.scanning') : t('settings.danger.duplicates.action.scan')}
                    </button>
                    <button
                      className="settings-danger-button"
                      type="button"
                      disabled={
                        duplicateCleanupBusyAction !== null ||
                        dangerBusy ||
                        !duplicateCleanupPreview ||
                        duplicateCleanupPreview.removeTrackIds.length === 0
                      }
                      onClick={() => void handleApplyDuplicateTrackCleanup()}
                    >
                      <Trash2 size={15} />
                      {duplicateCleanupBusyAction === 'clean' ? t('settings.danger.duplicates.action.cleaning') : t('settings.danger.duplicates.action.clean')}
                    </button>
                  </div>
                  {duplicateCleanupBusyAction ? (
                    <div className="settings-update-progress settings-duplicate-cleanup-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>{duplicateCleanupBusyAction === 'scan' ? t('settings.danger.duplicates.progress.scan.title') : t('settings.danger.duplicates.progress.clean.title')}</strong>
                        <span>{duplicateCleanupBusyAction === 'scan' ? t('settings.danger.duplicates.progress.scan.description') : t('settings.danger.duplicates.progress.clean.description')}</span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        data-indeterminate="true"
                        role="progressbar"
                        aria-label={duplicateCleanupBusyAction === 'scan' ? t('settings.danger.duplicates.progress.scan.aria') : t('settings.danger.duplicates.progress.clean.aria')}
                      >
                        <span />
                      </div>
                    </div>
                  ) : null}
                  {duplicateCleanupMessage ? <p className="settings-inline-note">{duplicateCleanupMessage}</p> : null}
                  {duplicateCleanupPreview?.groups.length ? (
                    <>
                      <button
                        aria-expanded={duplicateCleanupResultsExpanded}
                        className="settings-library-quality-summary settings-duplicate-cleanup-summary"
                        type="button"
                        onClick={() => setDuplicateCleanupResultsExpanded((expanded) => !expanded)}
                      >
                        <span>
                          <strong>扫描结果明细</strong>
                          <em>{duplicateCleanupPreview.groups.length} 组重复，待清理 {duplicateCleanupPreview.totalTracksToRemove} 首</em>
                        </span>
                        <ChevronDown size={16} />
                      </button>
                      {duplicateCleanupResultsExpanded ? (
                        <div className="settings-library-quality-list">
                          {duplicateCleanupPreview.groups.map((group) => (
                            <div className="settings-library-quality-row" key={group.id}>
                              <div>
                                <strong>{group.keep.track.title} - {group.keep.track.artist}</strong>
                                <small title={group.keep.track.path}>保留：{formatDuplicateCleanupTrackQuality(group.keep)} · {group.keep.track.path}</small>
                                {group.remove.map((member) => (
                                  <small title={member.track.path} key={member.track.id}>
                                    清理：{member.track.title} - {member.track.artist} · {formatDuplicateCleanupTrackQuality(member)} · {member.track.path}
                                  </small>
                                ))}
                              </div>
                              <div className="settings-library-quality-actions">
                                <em>清理 {group.remove.length} 首</em>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow title={t('settings.danger.clearCache.title')} description={t('settings.danger.clearCache.description')}>
                <button className="settings-danger-button" type="button" disabled={dangerBusy} onClick={() => void handleClearLibraryCache()}>
                  {dangerBusy ? '处理中...' : '清空曲库缓存'}
                </button>
              </SettingRow>
              <SettingRow title="恢复默认设置" description="重置应用偏好、封面缓存目录和外观偏好；不会删除音乐文件或曲库文件夹。">
                <button className="settings-danger-button" type="button" disabled={dangerBusy} onClick={() => void handleResetDefaultSettings()}>
                  {dangerBusy ? '处理中...' : '恢复默认设置'}
                </button>
              </SettingRow>
              <SettingRow title="重建曲库数据库" description="曲库数据库完全损坏、重新添加文件夹无效、重扫没反应时使用；会归档旧数据库并删除当前索引，不删除音乐文件。">
                <button className="settings-danger-button" type="button" disabled={dangerBusy} onClick={() => void handleRepairLibraryDatabase()}>
                  {dangerBusy ? '处理中...' : '重建曲库数据库'}
                </button>
              </SettingRow>
              <SettingRow title="删除曲库数据库" description="比重建更硬：只归档并删除数据库文件，不主动创建新库；适合重建也失败或数据库文件被严重损坏时使用。">
                <button className="settings-danger-button" type="button" disabled={dangerBusy} onClick={() => void handleDeleteLibraryDatabase()}>
                  {dangerBusy ? '处理中...' : '删除曲库数据库'}
                </button>
              </SettingRow>
              <SettingRow title="删除所有 ECHO 本地内容" description="清空设置、账号、插件、曲库数据库、缓存、日志、壁纸、保护快照和下载任务记录；不会主动删除音乐文件夹或下载输出目录。确认词：删除所有内容">
                <button className="settings-danger-button" type="button" disabled={dangerBusy} onClick={() => void handleDeleteAllUserData()}>
                  {dangerBusy ? '处理中...' : '删除所有内容'}
                </button>
              </SettingRow>
              {dangerMessage ? <p className="settings-inline-note">{dangerMessage}</p> : null}
            </SettingSection>

            <details className="settings-section settings-section--devices settings-collapsible-section" data-visible={activeSection === 'playback'}>
              <summary className="section-title settings-collapsible-summary">
                <Headphones size={18} />
                <h2>{t('settings.devices.title')}</h2>
                <ChevronDown size={17} />
              </summary>
              {devices.length === 0 ? (
                <p className="settings-inline-note">{t('settings.devices.empty')}</p>
              ) : (
                <div className="audio-device-table">
                  <div className="audio-device-row audio-device-row--head">
                    <span>name</span>
                    <span>index</span>
                    <span>sampleRate</span>
                    <span>sharedDeviceSampleRate</span>
                    <span>outputMode</span>
                  </div>
                  {devices.map((device) => (
                    <div className="audio-device-row" key={device.id}>
                      <strong>{device.name}</strong>
                      <span>{device.index}</span>
                      <span>{formatRate(device.sampleRate)}</span>
                      <span>{formatRate(device.sharedDeviceSampleRate)}</span>
                      <span>{device.outputMode}</span>
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>
        </div>
      </div>
      </div>
      {fontPickerTarget ? (
        <FontPickerModal
          currentFont={activeFontValue}
          fonts={fontFamilies}
          onClose={() => setFontPickerTarget(null)}
          onChooseFile={() => void handleFontFileChoose()}
          onSelect={handleFontSelect}
          query={fontPickerQuery}
          setQuery={setFontPickerQuery}
          title={activeFontTitle}
        />
      ) : null}
    </div>
  );
};
