import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  Accessibility,
  AudioLines,
  BookOpen,
  Captions,
  Check,
  Clapperboard,
  Code2,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileDown,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  Github,
  Globe2,
  Headphones,
  Info,
  Keyboard,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  Monitor,
  Palette,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Save,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  User,
  UsersRound,
  VolumeX,
  X,
  Zap,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type {
  AudioDeviceInfo,
  AudioOutputMode,
  AudioOutputSettings,
  AudioSharedBackend,
  AudioStatus,
  ChannelBalanceState,
  PlaybackSpeedMode,
} from '../../shared/types/audio';
import { SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS } from '../../shared/constants/replayGain';
import { finalThemeUnlockVersion, isDownloadFeatureUnlockCode } from '../../shared/constants/featureUnlocks';
import { defaultArtistOnlineInfoSources, defaultArtistStreamingAlbumsProvider } from '../../shared/types/appSettings';
import { SteamEditionOverview } from '../components/common/SteamEditionOverview';
import {
  defaultSidebarHiddenRouteIds,
  defaultSidebarRouteOrder,
  normalizeSidebarHiddenRouteIds,
  normalizeSidebarRouteOrder,
  type SidebarRouteId,
} from '../../shared/types/sidebar';
import type { AccountBrowser, AccountProvider, AccountStatus, YouTubeBrowser } from '../../shared/types/accounts';
import type { EchoProAccountStatus, EchoProPluginActivationMode } from '../../shared/types/privateEntitlements';
import type {
  AccessibilityPreferences,
  ArtistOnlineInfoSource,
  AppSettings,
  AppThemeCustomTheme,
  AppThemeMode,
  AppThemePreset,
  AppThemePresetOverrides,
  AppThemeToneOverride,
  AutoUpdateSource,
  NetworkProxyMode,
  NetworkProxyTestResult,
  PlayerBarButtonId,
  RememberedAudioOutput,
} from '../../shared/types/appSettings';
import {
  defaultAccessibilityPreferences,
  normalizeAccessibilityPreferences,
} from '../preferences/accessibilityPreferences';
import type { MvSettings, NetworkMvProviderId } from '../../shared/types/mv';
import type { MiniPlayerState } from '../../shared/types/miniPlayer';
import {
  defaultPetScalePercent,
  petScalePercentMax,
  petScalePercentMin,
  type PetState,
} from '../../shared/types/pet';
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
import type { SmtcDiagnostics } from '../../shared/types/smtc';
import type { StageBridgeServerStatus } from '../../shared/types/stage';
import type { TaskbarPlaybackStatus } from '../../shared/types/taskbarPlayback';
import type {
  BpmAnalysisJobStatus,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  LibraryDatabaseProtectionStatus,
  LibraryDiagnostics,
  LibraryLabState,
  LibraryScanStatus,
  LyricsBackfillJobStatus,
} from '../../shared/types/library';
import type { UpdateStatus } from '../../shared/types/updates';
import { LibraryDiagnosticsPanel } from '../components/library/LibraryDiagnosticsPanel';
import { LibraryHealthReportPanel } from '../components/library/LibraryHealthReportPanel';
import { LibraryFoldersPanel } from '../components/library/LibraryFoldersPanel';
import { LibraryQualityPanel } from '../components/library/LibraryQualityPanel';
import { NetworkMetadataPanel } from '../components/library/NetworkMetadataPanel';
import { AudioProfessionalStatusPanel } from '../components/player/AudioProfessionalStatusPanel';
import { PlaybackStabilityDiagnosticsPanel } from '../components/player/PlaybackStabilityDiagnosticsPanel';
import { SegmentLoopPanel } from '../components/player/SegmentLoopPanel';
import { formatAudioDiagnostics } from '../components/player/audioDiagnosticsFormat';
import { writeRememberedAudioOutput } from '../components/player/audioOutputMemory';
import { titleFromPath } from '../components/player/playerFormat';
import { DiagnosticsAssistantPanel } from '../components/settings/DiagnosticsAssistantPanel';
import { EchoLinkBasicPanel } from '../components/settings/EchoLinkBasicPanel';
import { MqttIntegrationPanel } from '../components/settings/MqttIntegrationPanel';
import { StreamingConsentNoticeModal } from '../components/streaming/StreamingConsentNoticeModal';
import { StyledSelect } from '../components/ui/StyledSelect';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/locales';
import {
  isAdvancedNativeOutputPlatform,
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
  getLibraryLabBridge,
  getPluginsBridge,
  getQobuzBridge,
  getSmtcBridge,
  getStageBridge,
} from '../utils/echoBridge';
import { isImeComposingKeyEvent } from '../utils/imeInput';
import { formatUserFacingError } from '../utils/userFacingError';
import {
  dispatchAudioOutputRouteStatusChanged,
  markAudioOutputRouteMutationStarted,
} from '../utils/audioOutputRouteEvents';
import {
  buildLibraryScanStages,
  summarizeLibraryScanStatuses,
} from '../utils/libraryScanProgress';
import {
  AccountCookieCard,
  NeteaseQrLoginDialog,
  QobuzAccountCard,
  SpotifyAccountCard,
  TidalAccountCard,
  YouTubeAccountCard,
  accountProviderLabels,
  buildYouTubeBrowserOptions,
  getAccountBadgeClass,
  getAccountStatusLabel,
} from './settings/components/AccountCards';
import { FontPickerModal } from './settings/components/FontPickerModal';
import {
  ChipButton,
  NumberRangeField,
  SettingRow,
  SettingSection,
  SettingSubsectionTitle,
  StatusText,
  ToggleButton,
  type SettingSubsectionTitleProps,
} from './settings/components/SettingsPrimitives';
import {
  SettingsHeader,
  SettingsHorizontalPager,
  SettingsNavigation,
  SettingsSectionIndex,
} from './settings/components/SettingsPageShell';
import {
  initialNeteaseQrLoginState,
  type AccountBusyAction,
  type NeteaseQrLoginUiState,
  type SettingsNavKey,
} from './settings/settingsTypes';
import {
  getSettingsNavIndex,
  isSettingsEscapeBackEditableTarget,
  pendingRouteStorageKey,
  pendingSettingsSectionStorageKey,
  readInitialSettingsSection,
  settingsBackNavigationEvent,
  settingsNavGroups,
  settingsNavItems,
  settingsNavKeys,
  settingsSectionNavigationEvent,
  shouldShowSettingsNavItem,
  type SettingsNavItem,
} from './settings/settingsNavigation';
import {
  normalizeSettingsSearchText,
  rankSettingsSearch,
  settingsSearchAliases,
  type SettingsSearchResult,
} from './settings/settingsSearch';
import {
  experimentalLabCopy,
  settingsLocaleCopy,
  settingsSearchSubsectionByTargetId,
  settingsSubsectionCopy,
  type SettingsSubsectionCopyKey,
} from './settings/settingsSubsections';
import {
  bestReadableColor,
  buildPluginThemeCustomTheme,
  buildRandomThemeDraft,
  buildThemeCustomTheme,
  buildThemePresetOverrides,
  collectPluginThemeOptions,
  createThemeCustomId,
  createThemeExportPayload,
  downloadTextFile,
  duplicateThemeCustomTheme,
  getRelativeLuminance,
  getThemeContrastWarnings,
  getThemeEditorDefaults,
  isEchoProUnlockPluginActive,
  isProOnlyThemePreset,
  isThemeExportPayload,
  mergeThemeToneValues,
  numberThemeFields,
  defaultThemeScheduleDarkAt,
  defaultThemeScheduleLightAt,
  randomThemePresetOption,
  readThemeExportPreset,
  renameThemeCustomTheme,
  themePresetOptions,
  updateThemeCustomThemeTone,
  type GeneratedRandomThemeDraft,
  type PluginThemeOption,
  type ThemeColorField,
  type ThemeNumberField,
  type ThemeTone,
} from './settings/appearance/themeSettingsModel';
import {
  automixTemporarilyDisabled,
  audioExportFormatOptions,
  defaultSettingsChannelBalance,
  detectSettingsPlatform,
  deviceMatchesAudioStatus,
  dispatchPlaybackSeeked,
  getCompatiblePlaybackDevices,
  getPlaybackOutputModeLabel,
  getPlaybackOutputModesForPlatform,
  getSharedBackendDescriptionKey,
  getSharedBackendOptionsForPlatform,
  getShufflePlaybackModeId,
  hasNonMonoChannelBalanceEffect,
  isPlaybackOutputMode,
  normalizeLatencyProfile,
  normalizeSharedBackend,
  playbackNoSoundGuideSteps,
  playbackAdvancedPanelExpandedStorageKey,
  playbackSpeedModes,
  shufflePlaybackModeOptions,
} from './settings/playback/playbackSettingsModel';
import { PlaybackNoSoundGuideDialog } from './settings/playback/PlaybackNoSoundGuideDialog';
import {
  acceleratorFromKeyboardEvent,
  acceleratorFromMouseEvent,
  findDuplicateShortcutAction,
  formatAcceleratorForDisplay,
  globalShortcutActionMeta,
  localShortcutUnavailableActions,
  mergeShortcutSettings,
  shortcutActionIcons,
  shortcutFilterOptions,
  shortcutMessageKey,
  type RecordingShortcutTarget,
  type ShortcutFilter,
  type ShortcutMessageKey,
  type ShortcutScope,
} from './settings/shortcuts/shortcutSettingsModel';
import {
  formatCacheBytes,
  formatDiagnosticsDuration,
  formatDiagnosticsPercent,
  formatDiagnosticsTimestampDuration,
  formatProtectionTimestamp,
  formatRate,
  formatUpdateBytes,
  getDatabaseHealthLabel,
} from './settings/diagnostics/settingsDiagnosticsFormat';
import {
  accountLoginUrls,
  accountProviderLogoUrls,
  cookieAccountProviders,
  echoProActivationUrl,
  generalEchoProAccountPanelExpandedStorageKey,
  generalEchoProActivationPanelExpandedStorageKey,
  readEchoProDisplayStatusSnapshot,
  rememberEchoProDisplayStatus,
  resetEchoProDisplayStatusSnapshotForTests,
  settingsAccountProviders,
  type EchoProDisplayStatusSnapshot,
} from './settings/accounts/accountSettingsModel';
import {
  formatEchoProError,
  normalizeEchoProErrorCode,
} from './settings/accounts/echoProErrorFormat';
import {
  fallbackFontFamilies,
  type FontPickerTarget,
  type NavigatorWithLocalFonts,
} from './settings/appearance/fontSettingsModel';
import {
  defaultHiddenPlayerBarButtonIds,
  lockedHiddenSidebarRouteIdSet,
  lockedVisibleSidebarRouteIdSet,
  normalizeHiddenPlayerBarButtonIdsForRenderer,
  sidebarSettingsRouteItemById,
  type SidebarSettingsRouteItem,
} from './settings/appearance/navigationCustomizationModel';
import {
  PlayerBarButtonSettings,
  SidebarLayoutSettings,
} from './settings/appearance/NavigationCustomizationSettings';
import { ThemeModeSettings } from './settings/appearance/ThemeModeSettings';
import { ThemePresetSettings } from './settings/appearance/ThemePresetSettings';
import { ThemeCustomEditor } from './settings/appearance/ThemeCustomEditor';
import { TypographySettings } from './settings/appearance/TypographySettings';
import { AppWallpaperSettings } from './settings/appearance/AppWallpaperSettings';
import {
  appWallpaperEffectPresets,
  inferAppWallpaperMediaType,
} from './settings/appearance/wallpaperSettingsModel';
import {
  afdianSponsorUrl,
  authorEmailUrl,
  bugFeedbackUrl,
  dataBackupProgressPhaseLabels,
} from './settings/general/generalSettingsModel';
import { DatabaseProtectionPanel } from './settings/danger/DatabaseProtectionPanel';
import { DuplicateCleanupSettings } from './settings/danger/DuplicateCleanupSettings';
import { DangerMaintenanceSettings } from './settings/danger/DangerMaintenanceSettings';
import {
  buildNetworkProxyModeOptions,
  defaultNetworkProxyBypassRules,
  defaultSpotifyRedirectUri,
  defaultTidalRedirectUri,
  discogsDeveloperSettingsUrl,
  integrationsCredentialPanelExpandedStorageKey,
  isIntegrationCredentialSettingId,
  isSpotifyClientIdInputValid,
  isSpotifyRedirectUriInputValid,
  isTidalClientIdInputValid,
  isTidalClientSecretInputValid,
  isTidalCountryCodeInputValid,
  spotifyDeveloperDashboardUrl,
  tidalDeveloperDashboardUrl,
} from './settings/integrations/integrationSettingsModel';
import {
  artistOnlineInfoSourceOptions,
  artistStreamingAlbumProviderOptions,
  defaultNetworkMetadataProviders,
  emptyArtistImageSummary,
  formatLibraryScanProgressMessage,
  libraryScanResultMetrics,
  libraryScanRunningStatuses,
  libraryScanStageLabelKeys,
  libraryScanStageMetricLabelKeys,
  networkProviderLabels,
  visibleNetworkMetadataProviders,
  type ArtistImageProgress,
} from './settings/library/librarySettingsModel';
import {
  appSettingsPatchFromMvSettingsPatch,
  formatMvThreshold,
  mvImmersiveBackgroundDefaults,
  mvNetworkProviders,
  mvProviderLabels,
  mvQualityCaps,
  mvSyncModes,
  mvThresholdFromPercent,
  normalizeExternalAppSettingsPatch,
  normalizeMvProviderOrder,
} from './settings/mv/mvSettingsModel';
import { LyricsSettingsSection } from './settings/lyrics/LyricsSettingsSection';
import {
  readBooleanStoragePreference,
  scheduleSettingsIdleTask,
  yieldToSettingsPaint,
} from './settings/settingsRuntime';
import { PluginsSettingsSection } from './settings/plugins/PluginsSettingsSection';
import { RemoteSettingsSection } from './settings/remote/RemoteSettingsSection';
import { EqSettingsSection } from './settings/playback/EqSettingsSection';

export { deviceMatchesAudioStatus };
export { resetEchoProDisplayStatusSnapshotForTests };

type SettingsSectionMotionDirection = 'initial' | 'forward' | 'backward';

type AlbumMergeStrategy = AppSettings['albumMergeStrategy'];
type ArtistMergeStrategy = NonNullable<AppSettings['artistMergeStrategy']>;

const AboutUpdateSettings = lazy(async () => {
  const module = await import('./settings/about/AboutUpdateSettings');
  return { default: module.AboutUpdateSettings };
});

const ContributorsPage = lazy(async () => {
  const module = await import('./settings/about/ContributorsPage');
  return { default: module.ContributorsPage };
});

export const SettingsPage = (): JSX.Element => {
  const { locale, localeOptions, setLocale, t } = useI18n();
  const experimentalPerformanceBugNote = settingsLocaleCopy(locale, {
    'zh-CN': '可能会大幅度提高 ECHO 性能，也可能出现奇怪的 BUG。',
    'zh-TW': '可能會大幅度提高 ECHO 效能，也可能出現奇怪的 BUG。',
    'ja-JP': 'ECHO の性能を大きく改善する可能性がありますが、奇妙な不具合が出る場合もあります。',
    'en-US': 'May significantly improve ECHO performance, but may also cause strange bugs.',
    'ko-KR': 'ECHO 성능을 크게 높일 수 있지만 이상한 버그가 생길 수도 있습니다.',
  });
  const playbackQueue = usePlaybackQueue();
  const sharedPlaybackStatus = useSharedPlaybackStatus();
  const [rendererPlatform] = useState<NodeJS.Platform | 'unknown'>(() => detectSettingsPlatform());
  const playbackOutputModesForPlatform = useMemo(() => getPlaybackOutputModesForPlatform(rendererPlatform), [rendererPlatform]);
  const sharedBackendOptionsForPlatform = useMemo(() => getSharedBackendOptionsForPlatform(rendererPlatform), [rendererPlatform]);
  const advancedNativeOutputAvailable = isAdvancedNativeOutputPlatform(rendererPlatform);
  const settingsScrollShellRef = useRef<HTMLDivElement | null>(null);
  const settingsSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsHorizontalScroll, setSettingsHorizontalScroll] = useState({
    available: false,
    canLeft: false,
    canRight: false,
  });
  const [activeSection, setActiveSection] = useState<SettingsNavKey>(() => readInitialSettingsSection());
  const [aboutPage, setAboutPage] = useState<'overview' | 'contributors'>('overview');
  const [settingsSectionMotionDirection, setSettingsSectionMotionDirection] = useState<SettingsSectionMotionDirection>('initial');
  const [settingsSectionIndexItems, setSettingsSectionIndexItems] = useState<Array<{ id: string; label: string }>>([]);
  const [activeSettingsSectionIndexId, setActiveSettingsSectionIndexId] = useState<string | null>(null);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [activeSettingsSearchResultIndex, setActiveSettingsSearchResultIndex] = useState(0);
  const [highlightedSettingId, setHighlightedSettingId] = useState<string | null>(null);
  const [mysteriousKeyVisible, setMysteriousKeyVisible] = useState(false);
  const mysteriousKeyUnlockNoticeShownRef = useRef(false);
  const [finalThemeUnlocked, setFinalThemeUnlocked] = useState(false);
  const [finalThemeUnlockChecked, setFinalThemeUnlockChecked] = useState(false);
  const finalThemeRelockAppliedRef = useRef(false);
  const finalThemeMarkerUnlockedRef = useRef(false);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [audioDiagnosticsCopied, setAudioDiagnosticsCopied] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputMode, setOutputMode] = useState<AudioOutputMode>('shared');
  const [sharedBackend, setSharedBackend] = useState<AudioSharedBackend>('auto');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [appearancePreferences, setAppearancePreferences] = useState<AppearancePreferences>(() => readAppearancePreferences());
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [liveLibraryState, setLiveLibraryState] = useState<LibraryLabState | null>(null);
  const [signalPathControlSaving, setSignalPathControlSaving] = useState(false);
  const signalPathControlSaveRequestRef = useRef(0);
  const [streamingNoticeOpen, setStreamingNoticeOpen] = useState(false);
  const [streamingNoticeConsent, setStreamingNoticeConsent] = useState('');
  const sidebarRouteOrder = useMemo(() => normalizeSidebarRouteOrder(appSettings?.sidebarRouteOrder), [appSettings?.sidebarRouteOrder]);
  const sidebarHiddenRouteIds = useMemo(() => normalizeSidebarHiddenRouteIds(appSettings?.sidebarHiddenRouteIds), [appSettings?.sidebarHiddenRouteIds]);
  const sidebarHiddenRouteIdSet = useMemo(() => new Set(sidebarHiddenRouteIds), [sidebarHiddenRouteIds]);
  const hiddenPlayerBarButtonIds = useMemo(
    () => normalizeHiddenPlayerBarButtonIdsForRenderer(appSettings?.hiddenPlayerBarButtonIds),
    [appSettings?.hiddenPlayerBarButtonIds],
  );
  const hiddenPlayerBarButtonIdSet = useMemo(() => new Set(hiddenPlayerBarButtonIds), [hiddenPlayerBarButtonIds]);
  const sidebarLayoutExpanded = appSettings?.appearanceSidebarLayoutExpanded === true;
  const connectSidebarProLocked = !finalThemeUnlocked;
  const sidebarLayoutSummary = sidebarHiddenRouteIds.length > 0 ? t('settings.appearance.sidebar.summary.hidden', { count: sidebarHiddenRouteIds.length }) : t('settings.appearance.sidebar.summary.allVisible');
  const automaticOutputStageMessage =
    status?.automaticOutputStage === 'safe-shared'
      ? t('audioDrawer.option.automaticOutputStage.safeShared')
      : status?.automaticOutputStage === 'directsound'
        ? t('audioDrawer.option.automaticOutputStage.directSound')
        : status?.automaticOutputStage === 'system-required'
          ? t('audioDrawer.option.automaticOutputStage.systemRequired')
          : status?.automaticOutputStage === 'failed'
            ? t('audioDrawer.option.automaticOutputStage.failed')
            : t('settings.playback.automaticOutput.recommended');
  const sidebarSettingsGroups = useMemo(() => {
    const groups: Record<SidebarSettingsRouteItem['placement'], SidebarSettingsRouteItem[]> = {
      main: [],
      utility: [],
    };
    const includeStreaming = appSettings?.streamingFeatureEnabled === true;
    const includeOsuDownloader = appSettings?.osuDownloaderFeatureEnabled === true;

    for (const routeId of sidebarRouteOrder) {
      if (lockedHiddenSidebarRouteIdSet.has(routeId)) {
        continue;
      }

      if (routeId === 'streaming' && !includeStreaming) {
        continue;
      }

      if (routeId === 'osu-downloader' && !includeOsuDownloader) {
        continue;
      }

      const item = sidebarSettingsRouteItemById.get(routeId);
      if (item) {
        groups[item.placement].push(item);
      }
    }

    return groups;
  }, [appSettings?.osuDownloaderFeatureEnabled, appSettings?.streamingFeatureEnabled, sidebarRouteOrder]);
  const [selectedThemePreset, setSelectedThemePreset] = useState<AppThemePreset>(() => readThemePreset());
  const [themeCustomThemes, setThemeCustomThemes] = useState<AppThemeCustomTheme[]>(() => readThemeCustomThemes());
  const [activeThemeCustomId, setActiveThemeCustomId] = useState<string | null>(() => readThemeCustomId());
  const [pluginThemeOptions, setPluginThemeOptions] = useState<PluginThemeOption[]>([]);
  const [themeCustomTone, setThemeCustomTone] = useState<ThemeTone>('light');
  const [themeCustomDraft, setThemeCustomDraft] = useState<AppThemeToneOverride>({});
  const [themeCustomPanelOpen, setThemeCustomPanelOpen] = useState(false);
  const [themeCustomAdvancedOpen, setThemeCustomAdvancedOpen] = useState(false);
  const [appearanceWallpaperAdvancedOpen, setAppearanceWallpaperAdvancedOpen] = useState(false);
  const [appearanceTypographyOpen, setAppearanceTypographyOpen] = useState(false);
  const [themeCustomMessage, setThemeCustomMessage] = useState<string | null>(null);
  const pendingThemeCopyDraftRef = useRef<{ draft: AppThemeToneOverride; tone: ThemeTone } | null>(null);
  const pendingRandomThemeDraftRef = useRef<GeneratedRandomThemeDraft | null>(null);
  const skipNextThemePreviewRef = useRef(false);
  const wallpaperPersistTimerRef = useRef<number | null>(null);
  const wallpaperPreviewFrameRef = useRef<number | null>(null);
  const pendingWallpaperPreviewPatchRef = useRef<Partial<AppSettings> | null>(null);
  const pendingWallpaperPersistPatchRef = useRef<Partial<AppSettings> | null>(null);
  const mvTuningPersistTimerRef = useRef<number | null>(null);
  const mvTuningPreviewFrameRef = useRef<number | null>(null);
  const pendingMvTuningPreviewPatchRef = useRef<Partial<MvSettings> | null>(null);
  const pendingMvTuningPersistPatchRef = useRef<Partial<MvSettings> | null>(null);
  const [discordPresenceStatus, setDiscordPresenceStatus] = useState<DiscordPresenceStatus | null>(null);
  const [smtcDiagnostics, setSmtcDiagnostics] = useState<SmtcDiagnostics | null>(null);
  const [stageBridgeStatus, setStageBridgeStatus] = useState<StageBridgeServerStatus | null>(null);
  const [smtcRestarting, setSmtcRestarting] = useState(false);
  const [taskbarPlaybackStatus, setTaskbarPlaybackStatus] = useState<TaskbarPlaybackStatus | null>(null);
  const windowsIntegrationAvailable =
    rendererPlatform === 'win32' || smtcDiagnostics?.platform === 'win32' || taskbarPlaybackStatus?.supported === true;
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
    qobuz: '',
    osu: '',
  });
  const [qobuzTokenValue, setQobuzTokenValue] = useState('');
  const [accountBusy, setAccountBusy] = useState<Partial<Record<AccountProvider, AccountBusyAction>>>({});
  const [accountErrors, setAccountErrors] = useState<Partial<Record<AccountProvider, string | null>>>({});
  const [accountMessages, setAccountMessages] = useState<Partial<Record<AccountProvider, string | null>>>({});
  const [neteaseQrLogin, setNeteaseQrLogin] = useState<NeteaseQrLoginUiState>(initialNeteaseQrLoginState);
  const neteaseQrCloseTimerRef = useRef<number | null>(null);
  const [echoProAccountPanelExpanded, setEchoProAccountPanelExpanded] = useState(() =>
    readBooleanStoragePreference(generalEchoProAccountPanelExpandedStorageKey, false),
  );
  const [echoProAccountStatus, setEchoProAccountStatus] = useState<EchoProAccountStatus | null>(null);
  const [echoProAccountStatusChecked, setEchoProAccountStatusChecked] = useState(false);
  const [echoProStatusSnapshot, setEchoProStatusSnapshot] = useState<EchoProDisplayStatusSnapshot>(
    readEchoProDisplayStatusSnapshot,
  );
  const [echoProUsername, setEchoProUsername] = useState('');
  const [echoProPassword, setEchoProPassword] = useState('');
  const [echoProPasswordVisible, setEchoProPasswordVisible] = useState(false);
  const [echoProCapsLockEnabled, setEchoProCapsLockEnabled] = useState(false);
  const [echoProRedeemKey, setEchoProRedeemKey] = useState('');
  const [echoProActivationMode, setEchoProActivationMode] = useState<EchoProPluginActivationMode>('afdian');
  const [echoProActivationQq, setEchoProActivationQq] = useState('');
  const [echoProActivationOrderId, setEchoProActivationOrderId] = useState('');
  const [echoProActivationKey, setEchoProActivationKey] = useState('');
  const [echoProActivationSecretVisible, setEchoProActivationSecretVisible] = useState(false);
  const [echoProActivationBusyAction, setEchoProActivationBusyAction] = useState<'activate' | 'release' | null>(null);
  const echoProActivationBusy = echoProActivationBusyAction !== null;
  const [echoProActivationPanelExpanded, setEchoProActivationPanelExpanded] = useState(() =>
    readBooleanStoragePreference(generalEchoProActivationPanelExpandedStorageKey, false),
  );
  const [echoProBusyAction, setEchoProBusyAction] = useState<'login' | 'register' | 'logout' | 'refresh' | 'redeem' | 'release-devices' | null>(null);
  const [echoProMachineCode, setEchoProMachineCode] = useState<string | null>(null);
  const [echoProMachineCodeCopied, setEchoProMachineCodeCopied] = useState(false);
  const [echoProPluginUnlocked, setEchoProPluginUnlocked] = useState(false);
  const [echoProPluginStatusChecked, setEchoProPluginStatusChecked] = useState(false);
  const echoProUnlockedForDisplay = echoProAccountStatus?.pro === true || echoProPluginUnlocked || finalThemeUnlocked;
  const echoProPluginUnlockedForStatus =
    echoProPluginStatusChecked ? echoProPluginUnlocked : echoProStatusSnapshot.pluginUnlocked === true;
  const echoProAccountStatusForStatus =
    echoProAccountStatus ?? (!echoProAccountStatusChecked ? echoProStatusSnapshot.accountStatus : null);
  const echoProUnlockedForStatus = echoProPluginUnlockedForStatus || echoProAccountStatusForStatus?.pro === true;
  const [echoProMessage, setEchoProMessage] = useState<string | null>(null);
  const [echoProError, setEchoProError] = useState<string | null>(null);
  const echoProActivationReady = useMemo(() => {
    const qqReady = /^[1-9][0-9]{4,11}$/u.test(echoProActivationQq.trim());
    if (!qqReady) {
      return false;
    }
    if (echoProActivationMode === 'afdian') {
      return /^[0-9A-Za-z_-]{12,80}$/u.test(echoProActivationOrderId.trim());
    }
    return /^ECHO-[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/u.test(echoProActivationKey.trim().toUpperCase().replace(/\s+/gu, ''));
  }, [echoProActivationKey, echoProActivationMode, echoProActivationOrderId, echoProActivationQq]);
  const echoProOrderReleaseReady =
    echoProActivationMode === 'afdian' &&
    /^[0-9A-Za-z_-]{12,80}$/u.test(echoProActivationOrderId.trim());
  const [youtubeBrowser, setYoutubeBrowser] = useState<YouTubeBrowser>('none');
  const [soundCloudBrowser, setSoundCloudBrowser] = useState<AccountBrowser>('none');
  const [lastFmAuthToken, setLastFmAuthToken] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [deferredAboutReleaseNotes, setDeferredAboutReleaseNotes] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [autoUpdateCustomUrlDraft, setAutoUpdateCustomUrlDraft] = useState('');
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
  const [libraryDiagnostics, setLibraryDiagnostics] = useState<LibraryDiagnostics | null>(null);
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
  const [lyricsBackfillJob, setLyricsBackfillJob] = useState<LyricsBackfillJobStatus | null>(null);
  const [lyricsBackfillBusy, setLyricsBackfillBusy] = useState(false);
  const [lyricsBackfillMessage, setLyricsBackfillMessage] = useState<string | null>(null);
  const lyricsBackfillPollGenerationRef = useRef(0);
  const [playbackAdvancedPanelExpanded, setPlaybackAdvancedPanelExpanded] = useState(() =>
    readBooleanStoragePreference(playbackAdvancedPanelExpandedStorageKey, true),
  );
  const [playbackNoSoundGuideOpen, setPlaybackNoSoundGuideOpen] = useState(false);
  const [playbackNoSoundGuideStepIndex, setPlaybackNoSoundGuideStepIndex] = useState(0);
  const [audioStatusPanelOpen, setAudioStatusPanelOpen] = useState(false);
  const [channelBalanceState, setChannelBalanceState] = useState<ChannelBalanceState>(defaultSettingsChannelBalance);
  const [audioResetBusy, setAudioResetBusy] = useState(false);
  const [windowsAudioRestartBusy, setWindowsAudioRestartBusy] = useState(false);
  const [audioResetMessage, setAudioResetMessage] = useState<string | null>(null);
  const [playbackSettingsMessage, setPlaybackSettingsMessage] = useState<string | null>(null);
  const [automaticOutputBusy, setAutomaticOutputBusy] = useState(false);
  const [settingsBackupBusy, setSettingsBackupBusy] = useState<'export' | 'import' | 'dataPackage' | null>(null);
  const [settingsBackupMessage, setSettingsBackupMessage] = useState<string | null>(null);
  const [dataBackupStatus, setDataBackupStatus] = useState<DataBackupStatus | null>(null);
  const [dataBackupProgress, setDataBackupProgress] = useState<DataBackupProgress | null>(null);
  const [dataBackupBusy, setDataBackupBusy] = useState<'choose' | 'run' | 'import' | 'open' | null>(null);
  const [dataBackupMessage, setDataBackupMessage] = useState<string | null>(null);
  const [draggingSidebarRouteId, setDraggingSidebarRouteId] = useState<SidebarRouteId | null>(null);
  const [pluginSettingsMessage, setPluginSettingsMessage] = useState<string | null>(null);
  const [recordingShortcutTarget, setRecordingShortcutTarget] = useState<RecordingShortcutTarget | null>(null);
  const [shortcutFilter, setShortcutFilter] = useState<ShortcutFilter>('all');
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
  const [selectedAccountProvider, setSelectedAccountProvider] = useState<AccountProvider>('netease');
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
  const libraryScanProgressMessage = formatLibraryScanProgressMessage(libraryScanStatusList, t);
  const libraryScanTotals = useMemo(() => summarizeLibraryScanStatuses(libraryScanStatusList), [libraryScanStatusList]);
  const libraryScanStages = useMemo(() => buildLibraryScanStages(libraryScanStatusList), [libraryScanStatusList]);
  const libraryScanHasVisibleProgress = libraryScanStatusList.length > 0 && (libraryScanRunningList.length > 0 || libraryScanMessage !== null);
  const libraryScanActionDisabled = libraryScanBusy || libraryScanRunningList.length > 0;

  const settingsNavigationItems = useMemo(
    () => settingsNavItems.filter((item) => shouldShowSettingsNavItem(item.key, appSettings)),
    [appSettings],
  );

  const setAnimatedActiveSection = useCallback((nextSection: SettingsNavKey): void => {
    if (nextSection === activeSection) {
      setSettingsSectionMotionDirection('initial');
      return;
    }

    const currentIndex = getSettingsNavIndex(activeSection);
    const nextIndex = getSettingsNavIndex(nextSection);
    startTransition(() => {
      setSettingsSectionMotionDirection(
        currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex ? 'backward' : 'forward',
      );
      setActiveSection(nextSection);
    });
  }, [activeSection]);

  useEffect(() => {
    const handleSettingsSectionNavigation = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail as { section?: unknown; targetId?: unknown } | null | undefined : null;
      const section = detail?.section;
      const targetId = typeof detail?.targetId === 'string' ? detail.targetId : null;
      if (!section || !settingsNavKeys.has(section as SettingsNavKey)) {
        return;
      }

      setAnimatedActiveSection(section as SettingsNavKey);
      setSettingsQuery('');
      if (targetId === 'settings-row-echo-pro-account') {
        setEchoProAccountPanelExpanded(true);
        try {
          window.localStorage.setItem(generalEchoProAccountPanelExpandedStorageKey, 'true');
        } catch {
          // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
        }
      }
      if (targetId === 'settings-row-echo-pro-activation') {
        setEchoProActivationPanelExpanded(true);
        try {
          window.localStorage.setItem(generalEchoProActivationPanelExpandedStorageKey, 'true');
        } catch {
          // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
        }
      }
      setHighlightedSettingId(targetId);
      if (targetId) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      }
    };

    window.addEventListener(settingsSectionNavigationEvent, handleSettingsSectionNavigation);
    return () => window.removeEventListener(settingsSectionNavigationEvent, handleSettingsSectionNavigation);
  }, [setAnimatedActiveSection]);

  useEffect(() => {
    if (!settingsNavigationItems.some((item) => item.key === activeSection)) {
      setAnimatedActiveSection('general');
      setSettingsQuery('');
      setHighlightedSettingId(null);
    }
  }, [activeSection, setAnimatedActiveSection, settingsNavigationItems]);

  useEffect(() => {
    if (activeSection !== 'about' && aboutPage !== 'overview') {
      setAboutPage('overview');
    }
  }, [aboutPage, activeSection]);

  const settingsSearchEntries = useMemo(() => {
    const visibleSectionKeys = new Set(settingsNavigationItems.map((item) => item.key));
    const sectionLabelByKey = new Map(settingsNavigationItems.map((item) => [item.key, t(item.labelKey)]));
    const sectionEntries: Array<{
      id: string;
      sectionKey: SettingsNavKey;
      targetId?: string;
      title: string;
      description: string;
      terms: string[];
    }> = settingsNavigationItems.map((item) => {
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
    const buildSearchEntryPath = (entry: { sectionKey: SettingsNavKey; targetId?: string; title: string }): string => {
      const sectionLabel = sectionLabelByKey.get(entry.sectionKey) ?? entry.title;
      const subsectionKey = entry.targetId ? settingsSearchSubsectionByTargetId[entry.targetId] : undefined;
      const parts = [sectionLabel];

      if (subsectionKey) {
        parts.push(settingsLocaleCopy(locale, settingsSubsectionCopy[subsectionKey].title));
      }

      if (entry.targetId) {
        parts.push(entry.title);
      }

      return parts.join(' > ');
    };

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
        terms: [t('settings.general.firstRunWizard.title'), t('settings.general.firstRunWizard.description'), '首次启动指引', '新手教程', '新手指引', '新手引导', '向导', '引导', '標準輸出', '標準出力', '标准输出', '系统音频', 'システムオーディオ', 'guide', 'beginner guide', 'onboarding', 'first run', 'welcome', 'system audio'],
      },
      {
        id: 'row-echo-pro-activation',
        sectionKey: 'general',
        targetId: 'settings-row-echo-pro-activation',
        title: t('settings.general.echoProActivation.title'),
        description: t('settings.general.echoProActivation.description'),
        terms: [
          t('settings.general.echoProActivation.title'),
          t('settings.general.echoProActivation.description'),
          t('settings.general.echoProActivation.action'),
          'ECHO Pro',
          'Pro',
          'activate',
          'activation',
          'membership',
          'member',
          'license',
          'redeem',
          'HWID',
          'machine id',
          'machine code',
          'device binding',
          'device limit',
          'plugin package',
          'Afdian',
          '爱发电',
          '会员',
          '会员激活',
          '激活码',
          '设备绑定',
          '机器码',
          '插件包',
          '解绑',
          '激活',
          '兑换',
          echoProActivationUrl,
        ],
      },
      {
        id: 'row-echo-pro-account',
        sectionKey: 'general',
        targetId: 'settings-row-echo-pro-account',
        title: t('settings.general.echoProAccount.title'),
        description: t('settings.general.echoProAccount.unavailable'),
        terms: [
          'ECHO Pro',
          'Echo Pro',
          'Pro',
          'pro account',
          'membership',
          'member',
          'account',
          'login',
          'password',
          'HWID',
          'machine id',
          'machine code',
          'device binding',
          'cloud account',
          '账号',
          '账户',
          '登录',
          '密码',
          '会员',
          '会员账号',
          '云端验证',
          '联网验证',
          '机器码',
          '设备绑定',
          t('settings.general.echoProAccount.copyHwid'),
          t('settings.general.echoProAccount.showHwid'),
        ],
      },
      {
        id: 'row-low-spec-mode',
        sectionKey: 'general',
        targetId: 'settings-row-low-spec-mode',
        title: settingsLocaleCopy(locale, {
    'zh-CN': '低配置模式',
    'zh-TW': '低配置模式',
    'ja-JP': '低スペックモード',
    'en-US': 'Low-spec mode',
    'ko-KR': 'Low-spec mode',
  }),
        description: settingsLocaleCopy(locale, {
    'zh-CN': '降低动画、模糊、可视化、视频壁纸、扫描和后台任务占用。',
    'zh-TW': '降低動畫、模糊、視覺化、影片桌布、掃描和背景工作佔用。',
    'ja-JP': 'アニメーション、ぼかし、視覚化、動画壁紙、スキャン、バックグラウンド処理の負荷を抑えます。',
    'en-US': 'Reduces animation, blur, visualizers, video wallpaper, scanning, and background work.',
    'ko-KR': '애니메이션, 블러, 시각화, 동영상 배경, 스캔, 백그라운드 작업 부하를 줄입니다.',
  }),
        terms: ['低配', '低配置', '低内存', '低占用', '流畅模式', '性能模式', '省资源', 'low spec', 'low memory', 'performance mode'],
      },
      {
        id: 'row-close-to-tray',
        sectionKey: 'general',
        targetId: 'settings-row-close-to-tray',
        title: t('settings.general.closeToTray'),
        description: t('settings.nav.general.description'),
        terms: [
          t('settings.general.closeToTray'),
          '关闭时隐藏到托盘',
          '关闭窗口隐藏到托盘',
          '隐藏到托盘',
          '最小化到托盘',
          '系统托盘',
          '托盘',
          'close to tray',
          'hide to tray',
          'minimize to tray',
          'system tray',
          'tray',
        ],
      },
      {
        id: 'row-launch-at-login',
        sectionKey: 'general',
        targetId: 'settings-row-launch-at-login',
        title: t('settings.general.launchAtLogin.title'),
        description: t('settings.general.launchAtLogin.description'),
        terms: [
          t('settings.general.launchAtLogin.title'),
          t('settings.general.launchAtLogin.description'),
          '开机自启动',
          '开机启动',
          '自启动',
          '登录时启动',
          '启动项',
          '开机自动打开',
          'launch at login',
          'open at login',
          'start on login',
          'startup',
          'auto start',
          'autostart',
        ],
      },
      {
        id: 'row-lyrics-mv-graphics-pressure-guard',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-lyrics-mv-graphics-pressure-guard',
        title: t('settings.general.lyricsMvGraphicsPressureGuard.title'),
        description: t('settings.general.lyricsMvGraphicsPressureGuard.description'),
        terms: [
          t('settings.general.lyricsMvGraphicsPressureGuard.title'),
          t('settings.general.lyricsMvGraphicsPressureGuard.description'),
          'MV',
          'lyrics',
          '歌词',
          '歌詞',
          '内存',
          '記憶體',
          '显存',
          'GPU',
          'renderer',
          'memory pressure',
          'graphics pressure',
        ],
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
        id: 'row-sidebar-icon-only',
        sectionKey: 'general',
        targetId: 'settings-row-sidebar-icon-only',
        title: t('settings.general.sidebarIconOnly.title'),
        description: t('settings.general.sidebarIconOnly.description'),
        terms: [
          t('settings.general.sidebarIconOnly.title'),
          t('settings.general.sidebarIconOnly.description'),
          '\u4fa7\u680f\u4ec5\u663e\u793a\u56fe\u6807',
          '\u53ea\u663e\u793a\u56fe\u6807',
          '\u56fe\u6807\u4fa7\u680f',
          'sidebar',
          'icons only',
          'icon only sidebar',
          'compact sidebar',
        ],
      },
      {
        id: 'row-streaming-feature',
        sectionKey: 'general',
        targetId: 'settings-row-streaming-feature',
        title: t('settings.general.streamingFeature.title'),
        description: t('settings.general.streamingFeature.description'),
        terms: [
          t('settings.general.streamingFeature.title'),
          t('settings.general.streamingFeature.description'),
          'streaming',
          'online music',
          'sidebar',
        ],
      },
      {
        id: 'row-osu-downloader-feature',
        sectionKey: 'general',
        targetId: 'settings-row-osu-downloader-feature',
        title: t('settings.general.osuDownloaderFeature.title'),
        description: t('settings.general.osuDownloaderFeature.description'),
        terms: [
          t('settings.general.osuDownloaderFeature.title'),
          t('settings.general.osuDownloaderFeature.description'),
          'osu',
          'osu downloader',
          'beatmap',
          'osz',
          'sidebar',
        ],
      },
      {
        id: 'row-performance',
        sectionKey: 'experimental',
        targetId: 'settings-row-performance',
        title: t('settings.performance.title'),
        description: t('settings.performance.description'),
        terms: [
          t('settings.performance.title'),
          t('settings.performance.description'),
          t('audioDrawer.option.lowLoadPlaybackMode'),
          t('audioDrawer.option.lowLoadPlaybackModeDescription'),
          t('mediaLibrary.settings.albumWallVirtualization.title'),
          t('mediaLibrary.settings.albumWallVirtualization.description'),
          t('audioDrawer.option.nativeDirectLocalPlayback'),
          t('audioDrawer.note.nativeDirectLocalPlayback'),
          experimentalPerformanceBugNote,
          '低负载播放模式',
          '低负载',
          '专辑墙',
          '虚拟化',
          '本地直读',
          '本地直通',
          'native direct',
          'local playback',
          'local direct read',
          'album wall',
          'virtualization',
          'low load',
          'performance',
          'mouse freeze',
          'BUG',
        ],
      },
      {
        id: 'row-scan-performance',
        sectionKey: 'experimental',
        targetId: 'settings-row-scan-performance',
        title: t('mediaLibrary.settings.scanPerformance.title'),
        description: t('mediaLibrary.settings.scanPerformance.description'),
        terms: [
          t('mediaLibrary.settings.scanPerformance.title'),
          t('mediaLibrary.settings.scanPerformance.description'),
          t('mediaLibrary.settings.scanPerformance.low'),
          t('mediaLibrary.settings.scanPerformance.balanced'),
          t('mediaLibrary.settings.scanPerformance.performance'),
          t('mediaLibrary.settings.scanPerformance.ultra'),
          '扫描速度',
          '扫描并发',
          '极速扫描',
          'scan speed',
          'scan concurrency',
          'ultra scan',
        ],
      },
      {
        id: 'row-dsd-passthrough',
        sectionKey: 'experimental',
        targetId: 'settings-row-dsd-passthrough',
        title: t('settings.playback.dsdDop.title'),
        description: t('settings.playback.dsdDop.description'),
        terms: [
          t('settings.playback.dsdDop.title'),
          t('settings.playback.dsdDop.description'),
          'DSD',
          'DSF',
          'Native DSD',
          'DoP',
          'ASIO',
          'bit perfect',
          'passthrough',
          '直通',
          '直出',
          '不重采样',
        ],
      },
      {
        id: 'row-window-acrylic',
        sectionKey: 'experimental',
        targetId: 'settings-row-window-acrylic',
        title: t('settings.appearance.windowAcrylic.title'),
        description: t('settings.appearance.windowAcrylic.description'),
        terms: [
          t('settings.appearance.windowAcrylic.title'),
          t('settings.appearance.windowAcrylic.description'),
          t('settings.appearance.windowAcrylic.experimental'),
          '窗口亚克力',
          '窗口透明',
          'acrylic',
          'window transparency',
        ],
      },
      {
        id: 'row-notifications-disabled',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-notifications-disabled',
        title: t('settings.general.notificationsDisabled.title'),
        description: t('settings.general.notificationsDisabled.description'),
        terms: [
          t('settings.general.notificationsDisabled.title'),
          t('settings.general.notificationsDisabled.description'),
          '\u5173\u95ed\u6240\u6709\u901a\u77e5',
          '\u7981\u7528\u901a\u77e5',
          '\u9759\u97f3\u63d0\u9192',
          'disable notifications',
          'mute notifications',
          'notifications',
          'notices',
        ],
      },
      {
        id: 'row-upcoming-track-notice',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-upcoming-track-notice',
        title: t('settings.general.upcomingTrackNotice.title'),
        description: t('settings.general.upcomingTrackNotice.description'),
        terms: [
          t('settings.general.upcomingTrackNotice.title'),
          t('settings.general.upcomingTrackNotice.description'),
          '\u4e0b\u4e00\u9996',
          '\u64ad\u653e\u9884\u544a',
          '\u5de6\u4e0a\u89d2\u901a\u77e5',
          '\u5c01\u9762\u63d0\u793a',
          'up next',
          'next track notice',
          'upcoming track',
          'now playing notice',
        ],
      },
      {
        id: 'row-track-context-menu-extra-actions',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-track-context-menu-extra-actions',
        title: t('settings.general.trackContextMenuExtraActions.title'),
        description: t('settings.general.trackContextMenuExtraActions.description'),
        terms: [
          t('settings.general.trackContextMenuExtraActions.title'),
          t('settings.general.trackContextMenuExtraActions.description'),
          '\u53f3\u952e\u83dc\u5355',
          '\u590d\u5236\u6b4c\u66f2\u5361\u7247\u56fe\u7247',
          '\u4fdd\u5b58\u6b4c\u66f2\u5361\u7247\u56fe\u7247',
          '\u7cfb\u7edf\u9ed8\u8ba4\u5e94\u7528',
          'context menu',
          'osu timing',
          'system default app',
          'song card image',
        ],
      },
      {
        id: 'row-fast-startup',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-fast-startup',
        title: t('settings.general.fastStartup.title'),
        description: t('settings.general.fastStartup.description'),
        terms: [t('settings.general.fastStartup.title'), t('settings.general.fastStartup.description'), '快速启动', '快速啟動', '高速起動', '启动加速', '慢启动', 'data protection', 'startup', 'fast startup', 'quick startup', 'database snapshot', '曲库检查'],
      },
      {
        id: 'row-sqlite-balanced-durability',
        sectionKey: 'general',
        targetId: 'settings-row-sqlite-balanced-durability',
        title: t('settings.general.sqliteBalancedDurability.title'),
        description: t('settings.general.sqliteBalancedDurability.description'),
        terms: [
          t('settings.general.sqliteBalancedDurability.title'),
          t('settings.general.sqliteBalancedDurability.description'),
          'sqlite',
          'database',
          'synchronous',
          'scan write',
          'scan performance',
          'power loss',
          'crash',
          '\u626b\u63cf\u5199\u5165',
          '\u65ad\u7535',
          '\u5d29\u6e83',
        ],
      },
      {
        id: 'row-data-protection-disabled',
        sectionKey: 'advancedCustom',
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
        id: 'row-remember-window-size',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-remember-window-size',
        title: t('settings.general.rememberWindowSize.title'),
        description: t('settings.general.rememberWindowSize.description'),
        terms: [
          t('settings.general.rememberWindowSize.title'),
          t('settings.general.rememberWindowSize.description'),
          '记住窗口尺寸',
          '記住視窗尺寸',
          '窗口大小',
          'window size',
          'remember window',
          'restore window size',
        ],
      },
      {
        id: 'row-signal-path-control',
        sectionKey: 'advancedCustom',
        targetId: 'settings-row-signal-path-control',
        title: t('settings.general.signalPathControl.title'),
        description: t('settings.general.signalPathControl.description'),
        terms: [
          t('settings.general.signalPathControl.title'),
          t('settings.general.signalPathControl.description'),
          '信号路径',
          '訊號路徑',
          'signal path',
          '播放栏入口',
          'player bar',
          'bottom bar',
        ],
      },
      {
        id: 'row-home-waveform-visualizer',
        sectionKey: 'advancedCustom',
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
        sectionKey: 'advancedCustom',
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
        sectionKey: 'about',
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
        sectionKey: 'accounts',
        targetId: 'settings-row-spotify-auth-config',
        title: 'Spotify OAuth 配置',
        description: '必须使用用户自己的 Spotify Client ID 和本机回调地址登录。',
        terms: ['Spotify OAuth 配置', 'Spotify Client ID', 'Spotify redirect URI', 'Spotify API', 'Spotify 登录', 'spotify client_id', 'redirect_uri'],
      },
      {
        id: 'row-online-album-info',
        sectionKey: 'accounts',
        targetId: 'settings-row-online-album-info',
        title: 'Discogs 专辑评分',
        description: '给专辑页评分做兜底；不填也会尝试公开 API，填入 Personal access token 后更稳定。',
        terms: ['Discogs 专辑评分', 'Discogs token', 'Discogs API', 'album rating', '专辑评分', '在线专辑信息', 'Personal access token'],
      },
      {
        id: 'row-online-artist-info',
        sectionKey: 'accounts',
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
        id: 'row-obs-browser-source',
        sectionKey: 'integrations',
        targetId: 'settings-row-obs-browser-source',
        title: t('settings.integrations.obs.title'),
        description: t('settings.integrations.obs.description'),
        terms: [t('settings.integrations.obs.title'), t('settings.integrations.obs.description'), 'obs', 'browser source', 'browser-source', 'stream overlay', 'lyrics overlay', 'live overlay'],
      },
      {
        id: 'row-stage-api',
        sectionKey: 'integrations',
        targetId: 'settings-row-stage-api',
        title: t('settings.integrations.stage.title'),
        description: t('settings.integrations.stage.description'),
        terms: [t('settings.integrations.stage.title'), t('settings.integrations.stage.description'), 'stage api', 'stage', 'http api', 'eventsource', 'sse', 'obs api'],
      },
      {
        id: 'row-taskbar-mini-player',
        sectionKey: 'integrations',
        targetId: 'settings-row-taskbar-mini-player',
        title: t('settings.integrations.taskbarMiniPlayer.title'),
        description: t('settings.integrations.taskbarMiniPlayer.description'),
        terms: [
          t('settings.integrations.taskbarMiniPlayer.title'),
          t('settings.integrations.taskbarMiniPlayer.description'),
          'taskbar mini player',
          'windows taskbar overlay',
          '任务栏迷你播放器',
          '工作列迷你播放器',
        ],
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
        sectionKey: 'accounts',
        targetId: 'settings-row-lastfm',
        title: t('settings.integrations.lastfm.title'),
        description: t('settings.integrations.lastfm.description'),
        terms: [t('settings.integrations.lastfm.title'), t('settings.integrations.lastfm.description'), 'last.fm', 'lastfm', 'scrobble', 'status', '状态', '账号状态', 'login status'],
      },
      {
        id: 'row-account-startup-refresh',
        sectionKey: 'accounts',
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
        id: 'row-audio-status',
        sectionKey: 'playback',
        targetId: 'settings-row-audio-status',
        title: t('settings.playback.audioStatus.title'),
        description: t('audioDrawer.note.engine'),
        terms: [t('settings.playback.audioStatus.title'), t('audioDrawer.note.engine'), 'audio status', 'engine status', '状态', '音频状态', '采样率', 'dac', 'wasapi', 'juce'],
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
        id: 'row-prevent-sleep-while-playing',
        sectionKey: 'playback',
        targetId: 'settings-row-prevent-sleep-while-playing',
        title: t('settings.playback.preventSleepWhilePlaying.title'),
        description: t('settings.playback.preventSleepWhilePlaying.description'),
        terms: [t('settings.playback.preventSleepWhilePlaying.title'), '防止休眠', '禁止息屏', 'keep awake', 'prevent sleep'],
      },
      {
        id: 'row-auto-play-on-startup',
        sectionKey: 'playback',
        targetId: 'settings-row-auto-play-on-startup',
        title: t('settings.playback.autoPlayOnStartup.title'),
        description: t('settings.playback.autoPlayOnStartup.description'),
        terms: [t('settings.playback.autoPlayOnStartup.title'), '启动播放', '开机播放', 'startup autoplay', 'launch playback'],
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
        id: 'row-pet',
        sectionKey: 'general',
        targetId: 'settings-row-pet',
        title: t('settings.playback.pet.title'),
        description: t('settings.playback.pet.description'),
        terms: [t('settings.playback.pet.title'), t('settings.playback.pet.description'), '宠物', '桌面宠物', 'pet', 'mascot', '悬浮', '像素角色', 'always on top'],
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
        id: 'row-shuffle-credibility',
        sectionKey: 'playback',
        targetId: 'settings-row-shuffle-credibility',
        title: t('settings.playback.shuffleCredibility.title'),
        description: t('settings.playback.shuffleCredibility.description'),
        terms: [
          t('settings.playback.shuffleCredibility.title'),
          t('settings.playback.shuffleCredibility.description'),
          '随机播放模式',
          '全曲库',
          '全曲库随机',
          '避免最近重复',
          '伪随机',
          '随机避重',
          '短时间重复',
          'shuffle',
          'random',
          'repeat avoidance',
        ],
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
        id: 'row-soxr-fallback',
        sectionKey: 'playback',
        targetId: 'settings-row-soxr-fallback',
        title: t('audioDrawer.guard.soxrFallback.title'),
        description: t('audioDrawer.guard.soxrFallback.description'),
        terms: [
          t('audioDrawer.guard.soxrFallback.title'),
          t('audioDrawer.guard.soxrFallback.description'),
          'SOXR',
          'soxr',
          'sample rate',
          'resample',
          'resampler',
          'fallback',
          'FFmpeg',
          'pcm',
        ],
      },
      {
        id: 'row-output-device',
        sectionKey: 'playback',
        targetId: 'settings-row-output-device',
        title: t('settings.playback.outputDevice.title'),
        description: t('settings.playback.outputDevice.description'),
        terms: [
          t('settings.playback.outputDevice.title'),
          t('settings.playback.outputDevice.description'),
          'audio output',
          'output',
          'output mode',
          'output device',
          'device',
          'dac',
          'sound card',
          'wasapi',
          'wasapi shared',
          'wasapi exclusive',
          'exclusive',
          'exclusive mode',
          'bit perfect',
          'quality',
          'hi-fi',
          'hifi',
          'system audio',
          'safe output',
          '音质',
          '高音质',
          '无损',
          '播放输出',
          '音频输出',
          '输出模式',
          '输出设备',
          '声卡',
          '独占',
          '独占输出',
          '系统音频',
          '安全输出',
        ],
      },
      {
        id: 'row-lyrics-romanization',
        sectionKey: 'lyrics',
        targetId: 'settings-row-lyrics-romanization',
        title: t('lyricsSettings.display.showRomanization'),
        description: t('lyricsSettings.display.showRomanizationDescription'),
        terms: [
          t('lyricsSettings.display.showRomanization'),
          t('lyricsSettings.display.showRomanizationDescription'),
          '罗马音',
          '罗马字',
          '假名',
          '注音',
          '日文注音',
          'romaji',
          'romanization',
          'kana',
          'furigana',
        ],
      },
      {
        id: 'row-lyrics-translation',
        sectionKey: 'lyrics',
        targetId: 'settings-row-lyrics-translation',
        title: t('lyricsSettings.display.showTranslation'),
        description: t('lyricsSettings.display.showTranslationDescription'),
        terms: [
          t('lyricsSettings.display.showTranslation'),
          t('lyricsSettings.display.showTranslationDescription'),
          '歌词翻译',
          '翻译',
          '译文',
          '中文翻译',
          '双语歌词',
          'translation',
          'translated lyrics',
          'bilingual lyrics',
        ],
      },
      {
        id: 'row-lyrics-color',
        sectionKey: 'lyrics',
        targetId: 'settings-row-lyrics-color',
        title: t('lyricsSettings.style.lyricsColor'),
        description: t('lyricsSettings.style.chooseLyricsColor'),
        terms: [
          t('lyricsSettings.style.lyricsColor'),
          t('lyricsSettings.style.chooseLyricsColor'),
          t('lyricsSettings.style.lyricsColorPalette'),
          '歌词颜色',
          '歌词色',
          '歌词调色盘',
          '歌词样式',
          'lyrics color',
          'lyric color',
          'color palette',
        ],
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
        terms: [t('settings.appearance.theme.title'), t('settings.appearance.theme.description'), 'theme', 'dark', 'light', 'system', 'ambient', '主题', '深色', '浅色'],
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
        id: 'row-native-file-scanner',
        sectionKey: 'experimental',
        targetId: 'settings-row-native-file-scanner',
        title: 'Native File Scanner\uff08\u5b9e\u9a8c\uff09',
        description: '\u4f7f\u7528 C++ \u72ec\u7acb\u8fdb\u7a0b\u53d1\u73b0\u97f3\u9891\u6587\u4ef6\uff1b\u4e0d\u8bfb\u53d6\u5143\u6570\u636e\u3001\u4e0d\u63d0\u53d6\u5c01\u9762\u3001\u4e0d\u5199\u5165\u66f2\u5e93\u6570\u636e\u5e93\u3002',
        terms: [
          'Native File Scanner',
          'native scanner',
          'C++ scanner',
          'file discovery',
          'NDJSON',
          '\u539f\u751f\u626b\u63cf\u5668',
          '\u6587\u4ef6\u53d1\u73b0',
          '\u626b\u63cf\u6027\u80fd',
          '\u5927\u66f2\u5e93',
        ],
      },
      {
        id: 'row-native-metadata-reader',
        sectionKey: 'experimental',
        targetId: 'settings-row-native-metadata-reader',
        title: 'Native Metadata Reader\uff08\u5b9e\u9a8c\uff09',
        description: '\u4f7f\u7528 C++ \u72ec\u7acb\u8fdb\u7a0b\u8bfb\u53d6\u5143\u6570\u636e\uff1b\u9ed8\u8ba4\u5173\u95ed\uff0c\u5173\u95ed\u65f6\u7ee7\u7eed\u4f7f\u7528 TypeScript\u3002',
        terms: [
          'Native Metadata Reader',
          'native metadata',
          'C++ metadata',
          'metadata pool',
          'FLAC',
          'MP3',
          'M4A',
          '\u539f\u751f\u5143\u6570\u636e',
          '\u5143\u6570\u636e\u8bfb\u53d6',
          '\u5b9e\u9a8c\u5ba4',
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
        id: 'row-library-performance-diagnostics',
        sectionKey: 'library',
        targetId: 'settings-row-library-performance-diagnostics',
        title: t('mediaLibrary.settings.performanceDiagnostics.title'),
        description: t('mediaLibrary.settings.performanceDiagnostics.description'),
        terms: [
          t('mediaLibrary.settings.performanceDiagnostics.title'),
          t('mediaLibrary.settings.performanceDiagnostics.description'),
          '\u626b\u63cf\u8017\u65f6',
          '\u8df3\u8fc7\u7387',
          '\u5e76\u53d1',
          '\u6e32\u67d3\u5361\u987f',
          '\u6162 IPC',
          'scan duration',
          'skip rate',
          'metadata concurrency',
          'cover concurrency',
          'native scanner',
          'slow IPC',
          'render stall',
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
        id: 'row-settings-export',
        sectionKey: 'about',
        targetId: 'settings-row-settings-export',
        title: t('settings.about.settingsExport.title'),
        description: t('settings.about.settingsExport.description'),
        terms: [
          t('settings.about.settingsExport.title'),
          t('settings.about.settingsExport.action.export'),
          t('settings.about.settingsExport.action.import'),
          '导出设置',
          '导入设置',
          '设置导出',
          '设置导入',
          '设置备份',
          '恢复设置',
          '用户设置',
          '备份设置',
          'settings export',
          'settings import',
          'export settings',
          'import settings',
          'settings backup',
          'restore settings',
          'user settings',
          'backup settings',
        ],
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

      return visibleSectionKeys.has(entry.sectionKey);
    });
    const entriesWithPaths = entries.map((entry) => ({
      ...entry,
      path: buildSearchEntryPath(entry),
    }));
    return windowsIntegrationAvailable
      ? entriesWithPaths
      : entriesWithPaths.filter((entry) => entry.targetId !== 'settings-row-smtc' && entry.targetId !== 'settings-row-taskbar-playback');
  }, [appSettings?.downloadsFeatureUnlocked, experimentalPerformanceBugNote, locale, mysteriousKeyVisible, settingsNavigationItems, t, windowsIntegrationAvailable]);

  const mysteriousKeySearchUnlocked = activeSection === 'general' && normalizeSettingsSearchText(settingsQuery) === 'zimin';
  const nativeFileScannerDiagnostics = libraryDiagnostics?.nativeFileScanner ?? null;
  const nativeMetadataReaderDiagnostics = libraryDiagnostics?.nativeMetadataReader ?? null;
  const latestLibraryScan = libraryDiagnostics?.lastScan ?? null;
  const latestLibraryScanDurationText = formatDiagnosticsTimestampDuration(latestLibraryScan?.startedAt, latestLibraryScan?.finishedAt);
  const latestLibraryScanTotal =
    latestLibraryScan !== null
      ? Math.max(latestLibraryScan.discoveredCount, latestLibraryScan.parsedCount + latestLibraryScan.skippedCount)
      : 0;
  const latestLibraryScanSkipRate =
    latestLibraryScan !== null && latestLibraryScanTotal > 0 ? latestLibraryScan.skippedCount / latestLibraryScanTotal : null;
  const latestLibraryScanSkipRateText =
    latestLibraryScan !== null
      ? t('mediaLibrary.settings.performanceDiagnostics.value.skipRate', {
          percent: formatDiagnosticsPercent(latestLibraryScanSkipRate),
          skipped: latestLibraryScan.skippedCount,
          total: latestLibraryScanTotal,
        })
      : t('mediaLibrary.settings.performanceDiagnostics.value.noScan');
  const latestSlowIpc = libraryDiagnostics?.performance?.lastSlowIpc ?? null;
  const latestRendererStall =
    libraryDiagnostics?.performance?.recentStalls.find((stall) => stall.source === 'renderer') ?? null;
  const latestMainStall = libraryDiagnostics?.performance?.recentStalls.find((stall) => stall.source === 'main') ?? null;
  const nativeFileScannerState = nativeFileScannerDiagnostics
    ? nativeFileScannerDiagnostics.willUseNative
      ? 'ready'
      : nativeFileScannerDiagnostics.enabled && !nativeFileScannerDiagnostics.binaryFound
        ? 'missing'
        : 'disabled'
    : 'unknown';
  const nativeMetadataReaderState = nativeMetadataReaderDiagnostics
    ? nativeMetadataReaderDiagnostics.willUseNative
      ? 'ready'
      : nativeMetadataReaderDiagnostics.enabled && !nativeMetadataReaderDiagnostics.binaryFound
        ? 'missing'
        : 'disabled'
    : 'unknown';
  const nativeFileScannerStatusText = nativeFileScannerDiagnostics
    ? nativeFileScannerDiagnostics.willUseNative
      ? t('mediaLibrary.settings.nativeStatus.ready')
      : nativeFileScannerDiagnostics.enabled && !nativeFileScannerDiagnostics.binaryFound
        ? t('mediaLibrary.settings.nativeStatus.binaryMissing')
        : t('mediaLibrary.settings.nativeStatus.disabled')
    : t('mediaLibrary.settings.nativeStatus.unavailable');
  const nativeMetadataReaderStatusText = nativeMetadataReaderDiagnostics
    ? nativeMetadataReaderDiagnostics.willUseNative
      ? t('mediaLibrary.settings.nativeStatus.ready')
      : nativeMetadataReaderDiagnostics.enabled && !nativeMetadataReaderDiagnostics.binaryFound
        ? t('mediaLibrary.settings.nativeStatus.binaryMissing')
        : t('mediaLibrary.settings.nativeStatus.disabled')
    : t('mediaLibrary.settings.nativeStatus.unavailable');
  const nativeFileScannerStatsText = nativeFileScannerDiagnostics
    ? t('mediaLibrary.settings.nativeFileScanner.stats', {
        nativeOk: nativeFileScannerDiagnostics.nativeScanOk ?? 0,
        total: nativeFileScannerDiagnostics.totalScans ?? 0,
        fallback: nativeFileScannerDiagnostics.fallbackToTs ?? 0,
        tsOnly: nativeFileScannerDiagnostics.tsOnlyScans ?? 0,
      })
    : t('mediaLibrary.settings.nativeStatus.diagnosticsPending');
  const nativeMetadataReaderStatsText = nativeMetadataReaderDiagnostics
    ? t('mediaLibrary.settings.nativeMetadataReader.stats', {
        nativeOk: nativeMetadataReaderDiagnostics.nativeOk ?? 0,
        total: nativeMetadataReaderDiagnostics.totalReads ?? 0,
        fallback: nativeMetadataReaderDiagnostics.fallbackToTs ?? 0,
        skipped: nativeMetadataReaderDiagnostics.skippedUnsupportedExtension ?? 0,
        hitRate: `${Math.round((nativeMetadataReaderDiagnostics.hitRate ?? 0) * 100)}%`,
      })
    : t('mediaLibrary.settings.nativeStatus.diagnosticsPending');
  const nativeFileScannerCapabilitiesText = nativeFileScannerDiagnostics
    ? t('mediaLibrary.settings.nativeFileScanner.capabilities', {
        protocol: nativeFileScannerDiagnostics.protocolVersion ?? 1,
        features: (nativeFileScannerDiagnostics.workerFeatures ?? []).join(', ') || '-',
      })
    : null;
  const nativeMetadataReaderCapabilitiesText = nativeMetadataReaderDiagnostics
    ? t('mediaLibrary.settings.nativeMetadataReader.capabilities', {
        protocol: nativeMetadataReaderDiagnostics.protocolVersion ?? 2,
        formats: nativeMetadataReaderDiagnostics.supportedFormats.join(', ') || '-',
      })
    : null;
  const latestSlowIpcText = latestSlowIpc
    ? t('mediaLibrary.settings.performanceDiagnostics.value.slowIpc', {
        channel: latestSlowIpc.channel,
        duration: formatDiagnosticsDuration(latestSlowIpc.durationMs),
        age: formatDiagnosticsDuration(latestSlowIpc.ageMs),
      })
    : t('mediaLibrary.settings.performanceDiagnostics.value.noneRecent');
  const latestRendererStallText = latestRendererStall
    ? t('mediaLibrary.settings.performanceDiagnostics.value.stall', {
        kind: latestRendererStall.kind,
        duration: formatDiagnosticsDuration(latestRendererStall.durationMs),
        cause: latestRendererStall.probableCause,
      })
    : t('mediaLibrary.settings.performanceDiagnostics.value.noneRecent');
  const latestMainStallText = latestMainStall
    ? t('mediaLibrary.settings.performanceDiagnostics.value.stall', {
        kind: latestMainStall.kind,
        duration: formatDiagnosticsDuration(latestMainStall.durationMs),
        cause: latestMainStall.probableCause,
      })
    : t('mediaLibrary.settings.performanceDiagnostics.value.noneRecent');

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
        path: entry.path,
        description: entry.description,
        score,
      });
    });

    return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, locale));
  }, [locale, settingsQuery, settingsSearchEntries]);

  const visibleNavItems = useMemo(() => {
    const query = normalizeSettingsSearchText(settingsQuery);

    if (!query) {
      return settingsNavigationItems;
    }

    const resultKeys = new Set(settingsSearchResults.map((item) => item.sectionKey));
    return settingsNavigationItems.filter((item) => resultKeys.has(item.key));
  }, [settingsNavigationItems, settingsQuery, settingsSearchResults]);

  const visibleSettingsSearchResults = settingsSearchResults.slice(0, 6);

  useEffect(() => {
    setActiveSettingsSearchResultIndex(0);
  }, [settingsQuery]);

  const compatibleDevices = useMemo(
    () => getCompatiblePlaybackDevices(devices, outputMode, rendererPlatform),
    [devices, outputMode, rendererPlatform],
  );
  const effectiveAudioStatus = sharedPlaybackStatus.audioStatus ?? status;
  const libraryAutoRefreshPlaybackBusy = effectiveAudioStatus?.state === 'loading' || effectiveAudioStatus?.state === 'playing';
  const statusSelectedDevice = useMemo(
    () => devices.find((device) => deviceMatchesAudioStatus(device, effectiveAudioStatus)) ?? null,
    [devices, effectiveAudioStatus],
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
  const shortcutIssueCount = useMemo(
    () =>
      globalShortcutActions.reduce(
        (count, action) =>
          count +
          (shortcutMessages[shortcutMessageKey('local', action)] ? 1 : 0) +
          (shortcutMessages[shortcutMessageKey('global', action)] ? 1 : 0),
        0,
      ),
    [shortcutMessages],
  );
  const shortcutSummary = useMemo(
    () => ({
      localEnabled: globalShortcutActions.filter((action) => localShortcuts[action]?.enabled).length,
      globalEnabled: globalShortcutActions.filter((action) => globalShortcuts[action]?.enabled).length,
      unbound: globalShortcutActions.filter((action) => !localShortcuts[action]?.accelerator && !globalShortcuts[action]?.accelerator).length,
      issues: shortcutIssueCount,
    }),
    [globalShortcuts, localShortcuts, shortcutIssueCount],
  );
  const filteredShortcutActionMeta = useMemo(
    () =>
      globalShortcutActionMeta.filter((item) => {
        const localBinding = localShortcuts[item.action];
        const globalBinding = globalShortcuts[item.action];

        switch (shortcutFilter) {
          case 'enabled':
            return Boolean(localBinding?.enabled || globalBinding?.enabled);
          case 'unbound':
            return !localBinding?.accelerator && !globalBinding?.accelerator;
          case 'issues':
            return Boolean(
              shortcutMessages[shortcutMessageKey('local', item.action)] ||
                shortcutMessages[shortcutMessageKey('global', item.action)],
            );
          case 'all':
          default:
            return true;
        }
      }),
    [globalShortcuts, localShortcuts, shortcutFilter, shortcutMessages],
  );
  const segmentPlaybackStatus = sharedPlaybackStatus.playbackStatus;
  const segmentAudioStatus = effectiveAudioStatus;
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
  const accountOverview = useMemo(() => {
    const connected = settingsAccountProviders.filter((provider) => accountStatusByProvider[provider]?.connected).length;
    const checking = settingsAccountProviders.filter((provider) => !accountStatusByProvider[provider]).length;
    return {
      connected,
      checking,
      disconnected: settingsAccountProviders.length - connected - checking,
    };
  }, [accountStatusByProvider]);

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

  const refreshStageBridgeStatus = useCallback(async () => {
    try {
      const stageBridge = getStageBridge();
      if (!stageBridge) {
        setStageBridgeStatus(null);
        return;
      }

      setStageBridgeStatus(await stageBridge.getStatus());
    } catch {
      setStageBridgeStatus(null);
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

  const refreshEchoProAccountStatus = useCallback(async (options?: { force?: boolean }): Promise<void> => {
    const app = getAppBridge();
    if (!app?.getEchoProAccountStatus) {
      setEchoProAccountStatus(null);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: null }));
      setEchoProError('ECHO Pro account bridge unavailable.');
      return;
    }

    setEchoProBusyAction('refresh');
    setEchoProError(null);
    try {
      const status = await app.getEchoProAccountStatus(options);
      setEchoProAccountStatus(status);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: status }));
    } catch (accountError) {
      setEchoProError(formatEchoProError(accountError, locale));
    } finally {
      setEchoProBusyAction(null);
    }
  }, [locale]);

  const copyTextToClipboard = useCallback(async (value: string): Promise<void> => {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);

  const copyEchoProMachineCode = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.getEchoProMachineCode) {
      setEchoProError('ECHO Pro HWID bridge unavailable.');
      return;
    }

    setEchoProError(null);
    try {
      const machineCode = echoProMachineCode ?? await app.getEchoProMachineCode();
      setEchoProMachineCode(machineCode);
      await copyTextToClipboard(machineCode);
      setEchoProMachineCodeCopied(true);
      setEchoProMessage('HWID 已复制，可粘贴到 ECHO Pro 激活页面生成专属插件。');
      window.setTimeout(() => setEchoProMachineCodeCopied(false), 1800);
    } catch (copyError) {
      setEchoProError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, [copyTextToClipboard, echoProMachineCode]);

  useEffect(() => {
    if (echoProAccountPanelExpanded) {
      void refreshEchoProAccountStatus();
      void getAppBridge()?.getEchoProMachineCode?.().then(setEchoProMachineCode).catch(() => undefined);
    }
  }, [echoProAccountPanelExpanded, refreshEchoProAccountStatus]);

  const refreshLibraryDiagnostics = useCallback(async () => {
    try {
      const library = getLibraryBridge();

      if (!library?.getDiagnostics) {
        setLibraryDiagnostics(null);
        return;
      }

      setLibraryDiagnostics(await library.getDiagnostics());
    } catch {
      setLibraryDiagnostics(null);
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
      const settingsFinalThemeUnlocked = settings.finalThemeUnlockVersion === finalThemeUnlockVersion;
      finalThemeMarkerUnlockedRef.current = settingsFinalThemeUnlocked;
      if (settingsFinalThemeUnlocked) {
        setFinalThemeUnlocked(true);
        setFinalThemeUnlockChecked(true);
      }
      setThemeCustomThemes(customThemes);
      setActiveThemeCustomId(customThemeId);
      setSelectedThemePreset(basePreset);
      setAutoUpdateCustomUrlDraft(settings.autoUpdateCustomUrl ?? '');
      updateThemePreferences(
        settings.appearanceTheme ?? defaultThemeMode,
        basePreset,
        settings.appearanceThemePresetOverrides ?? {},
        { customThemeId, customThemes, finalThemeUnlocked: settingsFinalThemeUnlocked, scheduleSettings: settings },
      );
      setThemeCustomDraft(activeCustomTheme?.light ?? settings.appearanceThemePresetOverrides?.[basePreset]?.light ?? {});
      if (settings.appearancePreferences) {
        setAppearancePreferences(updateAppearancePreferences(settings.appearancePreferences));
      }
      const rememberedOutputMode = settings.rememberedAudioOutput?.outputMode;
      if (isPlaybackOutputMode(rememberedOutputMode) && getPlaybackOutputModesForPlatform(rendererPlatform).includes(rememberedOutputMode)) {
        setOutputMode(rememberedOutputMode);
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
  }, [rendererPlatform]);

  useEffect(() => {
    let disposed = false;
    const plugins = getPluginsBridge();
    const app = getAppBridge();

    const refreshUnlockState = (): void => {
      void Promise.all([
        plugins?.list().catch(() => null) ?? Promise.resolve(null),
        app?.getEchoProAccountStatus?.().catch(() => null) ?? Promise.resolve(null),
        app?.getEchoProLocalEntitlementStatus?.().catch(() => null) ?? Promise.resolve(null),
      ])
        .then(([pluginResult, echoProStatus, localEntitlement]) => {
          if (!disposed) {
            const pluginUnlocked = localEntitlement
              ? localEntitlement.source === 'native-license' || localEntitlement.source === 'legacy-plugin'
              : pluginResult?.plugins.some(isEchoProUnlockPluginActive) === true;
            if (pluginResult || localEntitlement) {
              setEchoProPluginUnlocked(pluginUnlocked);
              setEchoProPluginStatusChecked(true);
            }
            if (echoProStatus) {
              setEchoProAccountStatus(echoProStatus);
              setEchoProAccountStatusChecked(true);
            }
            setEchoProStatusSnapshot(rememberEchoProDisplayStatus({
              ...(echoProStatus ? { accountStatus: echoProStatus } : {}),
              ...(pluginResult || localEntitlement ? { pluginUnlocked } : {}),
            }));
            setFinalThemeUnlocked((current) =>
              echoProStatus?.pro === true || localEntitlement?.unlocked === true ||
              (pluginResult ? pluginUnlocked : current) || finalThemeMarkerUnlockedRef.current,
            );
            setFinalThemeUnlockChecked(true);
            setPluginThemeOptions(pluginResult ? collectPluginThemeOptions(pluginResult.plugins) : []);
          }
        })
        .catch(() => {
          if (!disposed) {
            setFinalThemeUnlocked(finalThemeMarkerUnlockedRef.current);
            setFinalThemeUnlockChecked(true);
          }
        });
    };

    refreshUnlockState();
    window.addEventListener('plugins:changed', refreshUnlockState);
    window.addEventListener('echo-pro:status-changed', refreshUnlockState);

    return () => {
      disposed = true;
      window.removeEventListener('plugins:changed', refreshUnlockState);
      window.removeEventListener('echo-pro:status-changed', refreshUnlockState);
    };
  }, []);

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
    if (activeSection !== 'integrations' && activeSection !== 'accounts') {
      return undefined;
    }

    return scheduleSettingsIdleTask(() => {
      if (activeSection === 'accounts') {
        void refreshAccountStatuses();
        return;
      }

      void refreshDiscordPresenceStatus();
      void refreshSmtcDiagnostics();
      void refreshStageBridgeStatus();
      void refreshTaskbarPlaybackStatus();
      void refreshLastFmStatus();
    });
  }, [activeSection, refreshAccountStatuses, refreshDiscordPresenceStatus, refreshLastFmStatus, refreshSmtcDiagnostics, refreshStageBridgeStatus, refreshTaskbarPlaybackStatus]);

  useEffect(() => {
    let cancelled = false;
    const cancelIdleTask = scheduleSettingsIdleTask(() => {
      void (async () => {
        await yieldToSettingsPaint();
        if (cancelled) {
          return;
        }
        if (activeSection !== 'playback' && activeSection !== 'eq') {
          void refreshStatus();
        }

        await yieldToSettingsPaint();
        if (cancelled) {
          return;
        }
        if (activeSection !== 'playback') {
          void refreshDevices();
        }

        await yieldToSettingsPaint();
        if (cancelled) {
          return;
        }
        if (activeSection !== 'integrations') {
          void refreshDiscordPresenceStatus();
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelIdleTask();
    };
  }, [activeSection, refreshDevices, refreshDiscordPresenceStatus, refreshStatus]);

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
    if ((activeSection !== 'library' && activeSection !== 'experimental') || !libraryDeferredRefreshReady || libraryAutoRefreshPlaybackBusy) {
      return undefined;
    }

    const cancelIdleTask = scheduleSettingsIdleTask(() => {
      void refreshDuplicateSummary();
    });

    return () => {
      cancelIdleTask();
    };
  }, [activeSection, libraryAutoRefreshPlaybackBusy, libraryDeferredRefreshReady, refreshDuplicateSummary]);

  useEffect(() => {
    if (activeSection !== 'library' || !libraryDeferredRefreshReady || libraryAutoRefreshPlaybackBusy) {
      return undefined;
    }

    const cancelIdleTask = scheduleSettingsIdleTask(() => {
      void refreshLibraryDiagnostics();
    });

    return () => {
      cancelIdleTask();
    };
  }, [
    activeSection,
    appSettings?.nativeFileScannerEnabled,
    appSettings?.nativeMetadataReaderEnabled,
    libraryAutoRefreshPlaybackBusy,
    libraryDeferredRefreshReady,
    refreshLibraryDiagnostics,
  ]);

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
      const proThemeUnlocked = echoProUnlockedForDisplay || appSettings?.finalThemeUnlockVersion === finalThemeUnlockVersion;
      const localThemes = readThemeCustomThemes();
      const customThemes = normalizeThemeCustomThemes(appSettings?.appearanceCustomThemes ?? localThemes);
      const customThemeId = normalizeThemeCustomId(appSettings?.appearanceThemeCustomId ?? readThemeCustomId(), customThemes);
      const activeCustomTheme = customThemes.find((theme) => theme.id === customThemeId);
      setThemeCustomThemes(customThemes);
      setActiveThemeCustomId(customThemeId);
      setSelectedThemePreset(activeCustomTheme?.basePreset ?? appSettings?.appearanceThemePreset ?? readThemePreset({ finalThemeUnlocked: proThemeUnlocked }));
    }
  }, [
    activeSection,
    appSettings?.appearanceCustomThemes,
    appSettings?.appearanceThemeCustomId,
    appSettings?.appearanceThemePreset,
    appSettings?.finalThemeUnlockVersion,
    echoProUnlockedForDisplay,
  ]);

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
  const currentAppearanceTheme = appSettings?.appearanceTheme ?? defaultThemeMode;
  const accessibilityPreferences = normalizeAccessibilityPreferences(appSettings?.accessibilityPreferences);
  const ambientThemeActive = currentAppearanceTheme === 'ambient';
  const ambientThemePresetLockMessage = t('settings.appearance.themePreset.ambientLocked');
  const ambientThemeCustomLockMessage = t('settings.appearance.themeCustom.ambientLocked');
  const activeThemeCustom = useMemo(
    () => ambientThemeActive ? undefined : savedThemeCustomThemes.find((theme) => theme.id === savedThemeCustomId),
    [ambientThemeActive, savedThemeCustomId, savedThemeCustomThemes],
  );

  useEffect(() => {
    const pendingCopy = pendingThemeCopyDraftRef.current;
    if (pendingCopy?.tone === themeCustomTone) {
      setThemeCustomDraft(pendingCopy.draft);
      pendingThemeCopyDraftRef.current = null;
      setThemeCustomMessage(null);
      return;
    }

    const pendingRandom = pendingRandomThemeDraftRef.current;
    if (pendingRandom && !activeThemeCustom && selectedThemePreset === 'classic') {
      setThemeCustomDraft(pendingRandom[themeCustomTone]);
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

    const previewOverrides = ambientThemeActive || activeThemeCustom
      ? savedThemePresetOverrides
      : buildThemePresetOverrides(savedThemePresetOverrides, selectedThemePreset, themeCustomTone, themeCustomDraft);
    const previewThemes = ambientThemeActive
      ? savedThemeCustomThemes
      : activeThemeCustom
        ? updateThemeCustomThemeTone(savedThemeCustomThemes, activeThemeCustom.id, themeCustomTone, themeCustomDraft)
        : savedThemeCustomThemes;
    applyThemeSettings({
      ...(appSettings ?? {}),
      appearanceTheme: currentAppearanceTheme,
      appearanceThemePreset: selectedThemePreset,
      appearanceThemePresetOverrides: previewOverrides,
      appearanceCustomThemes: previewThemes,
      appearanceThemeCustomId: activeThemeCustom?.id ?? null,
    }, {
      finalThemeUnlocked: echoProUnlockedForDisplay,
      customThemeId: activeThemeCustom?.id ?? null,
      customThemes: previewThemes,
    });
  }, [activeSection, activeThemeCustom, ambientThemeActive, appSettings, currentAppearanceTheme, echoProUnlockedForDisplay, savedThemeCustomThemes, savedThemePresetOverrides, selectedThemePreset, themeCustomDraft, themeCustomTone]);

  useEffect(() => {
    const handleSettingsChanged = (event: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings> | Partial<MvSettings>>).detail;
      if (!patch || typeof patch !== 'object') {
        void getAppBridge()?.getSettings?.()
          .then((settings) => setAppSettings(settings))
          .catch(() => undefined);
        return;
      }
      const appPatch = normalizeExternalAppSettingsPatch(patch);
      if (Object.prototype.hasOwnProperty.call(appPatch, 'finalThemeUnlockVersion')) {
        finalThemeMarkerUnlockedRef.current = appPatch.finalThemeUnlockVersion === finalThemeUnlockVersion;
        setFinalThemeUnlocked((current) => current || finalThemeMarkerUnlockedRef.current);
      }

      setAppSettings((current) => {
        const nextSettings = current ? { ...current, ...appPatch } : current;
        const themeSettings = nextSettings ?? appPatch;
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
            {
              customThemeId,
              customThemes,
              finalThemeUnlocked: echoProUnlockedForDisplay || nextSettings?.finalThemeUnlockVersion === finalThemeUnlockVersion,
              scheduleSettings: themeSettings,
            },
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
              finalThemeUnlocked: echoProUnlockedForDisplay || nextSettings?.finalThemeUnlockVersion === finalThemeUnlockVersion,
              scheduleSettings: themeSettings,
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
              finalThemeUnlocked: echoProUnlockedForDisplay || nextSettings?.finalThemeUnlockVersion === finalThemeUnlockVersion,
              scheduleSettings: themeSettings,
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
  }, [echoProUnlockedForDisplay]);

  useEffect(
    () => () => {
      if (wallpaperPersistTimerRef.current !== null) {
        window.clearTimeout(wallpaperPersistTimerRef.current);
        wallpaperPersistTimerRef.current = null;
      }
      if (wallpaperPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(wallpaperPreviewFrameRef.current);
        wallpaperPreviewFrameRef.current = null;
      }
      const pendingWallpaperPatch = pendingWallpaperPersistPatchRef.current;
      const app = getAppBridge();
      if (pendingWallpaperPatch && app) {
        void app.setSettings(pendingWallpaperPatch).catch(() => undefined);
      }
      pendingWallpaperPreviewPatchRef.current = null;
      pendingWallpaperPersistPatchRef.current = null;
      if (mvTuningPersistTimerRef.current !== null) {
        window.clearTimeout(mvTuningPersistTimerRef.current);
      }
      if (mvTuningPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(mvTuningPreviewFrameRef.current);
      }
      pendingMvTuningPreviewPatchRef.current = null;
      pendingMvTuningPersistPatchRef.current = null;
    },
    [],
  );

  useEffect(() => {
    setOutputMode(effectiveAudioStatus?.outputMode ?? 'shared');
    if (effectiveAudioStatus?.sharedBackend || effectiveAudioStatus?.outputBackend === 'directsound-shared') {
      setSharedBackend(
        normalizeAudioSharedBackendForPlatform(
          effectiveAudioStatus.outputBackend === 'directsound-shared' ? 'directsound' : normalizeSharedBackend(effectiveAudioStatus.sharedBackend),
          rendererPlatform,
        ),
      );
    }
  }, [effectiveAudioStatus?.outputBackend, effectiveAudioStatus?.outputMode, effectiveAudioStatus?.sharedBackend, rendererPlatform]);

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
    const displayName = accountStatusByProvider.soundcloud?.displayName?.toLowerCase() ?? '';
    const savedBrowser = buildYouTubeBrowserOptions(t).find((option) => option.value !== 'none' && displayName.includes(option.value))?.value;
    if (savedBrowser) {
      setSoundCloudBrowser(savedBrowser);
    }
  }, [accountStatusByProvider.soundcloud?.displayName, t]);

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
        getCompatiblePlaybackDevices(devices, nextOutputMode, rendererPlatform).find((device) => device.id === nextDeviceId) ?? null;
      const normalizedSharedBackend = nextOutputMode === 'shared'
        ? normalizeAudioSharedBackendForPlatform(normalizeSharedBackend(nextSharedBackend), rendererPlatform)
        : 'auto';
      const rememberedLatencyProfile = normalizeLatencyProfile(appSettings?.rememberedAudioOutput?.latencyProfile);
      const output: AudioOutputSettings = {
        outputMode: nextOutputMode,
        sharedBackend: normalizedSharedBackend,
        latencyProfile: rememberedLatencyProfile,
        useNativeOutput: appSettings?.audioUseMiniaudioOutput === true || appSettings?.audioMiniaudioOutputExperimentalEnabled === true,
        useMiniaudioOutput: appSettings?.audioUseMiniaudioOutput === true || appSettings?.audioMiniaudioOutputExperimentalEnabled === true,
        useLibavDecode: appSettings?.audioUseLibavDecode === true,
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

      setError(null);
      setPlaybackSettingsMessage(null);
      let nextStatus: AudioStatus;

      try {
        markAudioOutputRouteMutationStarted();
        nextStatus = await audio.setOutput(output);
      } catch (audioError) {
        const message = formatUserFacingError(audioError, { context: 'audio' });
        setPlaybackSettingsMessage(t('settings.playback.outputStatus.failed', { reason: message }));
        setError(message);
        return;
      }

      setStatus(nextStatus);
      dispatchAudioOutputRouteStatusChanged(nextStatus);
      if (nextStatus.outputMode !== nextOutputMode) {
        setOutputMode(nextStatus.outputMode);
        if (nextStatus.sharedBackend) {
          setSharedBackend(normalizeAudioSharedBackendForPlatform(nextStatus.sharedBackend, rendererPlatform));
        }
        setPlaybackSettingsMessage(t('settings.playback.outputStatus.fallback', {
          requested: getPlaybackOutputModeLabel(nextOutputMode, t, rendererPlatform),
          actual: getPlaybackOutputModeLabel(nextStatus.outputMode, t, rendererPlatform),
        }));
      } else {
        setPlaybackSettingsMessage(t('settings.playback.outputStatus.saved', {
          mode: getPlaybackOutputModeLabel(nextOutputMode, t, rendererPlatform),
        }));
      }

      const rememberedOutput: RememberedAudioOutput = {
        enabled: true,
        outputMode: nextStatus.outputMode,
        sharedBackend: normalizedSharedBackend,
        latencyProfile: rememberedLatencyProfile,
        deviceIndex: nextDevice && normalizedSharedBackend !== 'directsound' ? nextDevice.index : undefined,
        deviceName: nextDevice?.name,
      };
      writeRememberedAudioOutput(rememberedOutput);
      setAppSettings((currentSettings) =>
        currentSettings ? { ...currentSettings, rememberedAudioOutput: rememberedOutput } : currentSettings,
      );
      const app = getAppBridge();
      if (app?.setSettings) {
        try {
          setAppSettings(await app.setSettings({ rememberedAudioOutput: rememberedOutput }));
        } catch (settingsError) {
          const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
          setPlaybackSettingsMessage(t('settings.playback.outputStatus.failed', { reason: message }));
          setError(message);
        }
      }
    },
    [
      appSettings?.audioExclusiveInstabilityFallbackEnabled,
      appSettings?.audioSoxrFallbackEnabled,
      appSettings?.audioMiniaudioOutputExperimentalEnabled,
      appSettings?.audioUseLibavDecode,
      appSettings?.audioUseMiniaudioOutput,
      appSettings?.rememberedAudioOutput?.latencyProfile,
      devices,
      outputMode,
      rendererPlatform,
      selectedDeviceId,
      sharedBackend,
      t,
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
    setAnimatedActiveSection(key);
    if (isIntegrationCredentialSettingId(options.targetId)) {
      setCredentialPanelExpanded(true);
    }
    if (options.targetId === 'settings-row-echo-pro-account') {
      setEchoProAccountPanelExpanded(true);
      try {
        window.localStorage.setItem(generalEchoProAccountPanelExpandedStorageKey, 'true');
      } catch {
        // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
      }
    }
    if (options.clearSearch) {
      setSettingsQuery('');
    }
    setHighlightedSettingId(options.targetId ?? null);
    scrollSettingsSectionIntoView(key, options.targetId);
  }, [scrollSettingsSectionIntoView, setAnimatedActiveSection]);

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
      if (activeSection === 'about' && aboutPage === 'contributors') {
        setAboutPage('overview');
        scrollSettingsSectionIntoView('about');
        return;
      }
      window.dispatchEvent(new Event(settingsBackNavigationEvent));
    };

    window.addEventListener('keydown', handleSettingsEscapeBack);
    return () => {
      window.removeEventListener('keydown', handleSettingsEscapeBack);
    };
  }, [aboutPage, activeSection, scrollSettingsSectionIntoView]);

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
  }, [appSettings]);

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
  }, [appSettings]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }

    setOnlineAlbumInfoDraft({
      discogsUserToken: appSettings.onlineAlbumInfoDiscogsUserToken ?? '',
    });
  }, [appSettings]);

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
  }, [appSettings]);

  const handleNavClick = (key: SettingsNavKey): void => {
    if (key === 'about') {
      setAboutPage('overview');
    }
    jumpToSettingsSection(key);
  };

  const handleSectionIndexClick = (id: string): void => {
    setActiveSettingsSectionIndexId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSettingsSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (isImeComposingKeyEvent(event)) {
      return;
    }

    if (event.key === 'Escape' && settingsQuery) {
      event.preventDefault();
      setSettingsQuery('');
      return;
    }

    if (visibleSettingsSearchResults.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveSettingsSearchResultIndex((current) =>
        (current + direction + visibleSettingsSearchResults.length) % visibleSettingsSearchResults.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const result = visibleSettingsSearchResults[activeSettingsSearchResultIndex] ?? visibleSettingsSearchResults[0];
      jumpToSettingsSection(result.sectionKey, { clearSearch: true, targetId: result.targetId });
    }
  };

  const handleOutputModeChange = (nextMode: AudioOutputMode): void => {
    setOutputMode(nextMode);
    const nextDevices = getCompatiblePlaybackDevices(devices, nextMode, rendererPlatform);
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

  const handleAutomaticOutputToggle = async (): Promise<void> => {
    const audio = getAudioBridge();
    const app = getAppBridge();
    if (!audio || !app?.setSettings || !appSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    const previousEnabled = appSettings.audioAutomaticOutputEnabled === true;
    const nextEnabled = !previousEnabled;
    setAutomaticOutputBusy(true);
    setError(null);
    setPlaybackSettingsMessage(null);

    try {
      const nextSettings = await app.setSettings({ audioAutomaticOutputEnabled: nextEnabled });
      setAppSettings(nextSettings);
      try {
        const nextStatus = await audio.setOutput({ automaticOutputEnabled: nextEnabled });
        setStatus(nextStatus);
        setOutputMode(nextStatus.outputMode);
        setSharedBackend(normalizeAudioSharedBackendForPlatform(nextStatus.sharedBackend ?? 'auto', rendererPlatform));
        setPlaybackSettingsMessage(t(nextEnabled
          ? 'settings.playback.automaticOutput.statusEnabled'
          : 'settings.playback.automaticOutput.statusDisabled'));
      } catch (audioError) {
        const restoredSettings = await app.setSettings({ audioAutomaticOutputEnabled: previousEnabled });
        setAppSettings(restoredSettings);
        throw audioError;
      }
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : String(toggleError);
      setPlaybackSettingsMessage(t('settings.playback.outputStatus.failed', { reason: message }));
      setError(message);
    } finally {
      setAutomaticOutputBusy(false);
    }
  };

const handleNativeDirectLocalPlaybackToggle = async (): Promise<void> => {
    const nextEnabled = appSettings?.audioNativeDirectLocalPlaybackEnabled !== true;

    const audio = getAudioBridge();
    const app = getAppBridge();
    if (!audio || !app?.setSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      const nextStatus = await audio.setOutput({ nativeDirectLocalPlaybackEnabled: nextEnabled });
      try {
        const nextSettings = await app.setSettings({ audioNativeDirectLocalPlaybackEnabled: nextEnabled });
        setAppSettings(nextSettings);
        dispatchSettingsChanged(nextSettings);
        setStatus(nextStatus);
        setError(null);
      } catch (settingsError) {
        await audio.setOutput({ nativeDirectLocalPlaybackEnabled: !nextEnabled }).catch(() => undefined);
        throw settingsError;
      }
    } catch (audioError) {
      setError(formatUserFacingError(audioError, { context: 'audio' }));
    }
  };

  const handleDsdDopToggle = async (): Promise<void> => {
    const nextEnabled = appSettings?.audioDsdOutputMode === 'pcm';
    const nextDsdOutputMode = nextEnabled ? 'dop' : 'pcm';

    const audio = getAudioBridge();
    const app = getAppBridge();
    if (!audio || !app?.setSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    const previousDsdOutputMode = appSettings?.audioDsdOutputMode === 'dop' ? 'dop' : 'pcm';
    try {
      const nextStatus = await audio.setOutput({ dsdOutputMode: nextDsdOutputMode });
      try {
        const nextSettings = await app.setSettings({ audioDsdOutputMode: nextDsdOutputMode });
        setAppSettings(nextSettings);
        window.dispatchEvent(new CustomEvent('settings:changed', { detail: nextSettings }));
        setStatus(nextStatus);
        setError(null);
      } catch (settingsError) {
        await audio.setOutput({ dsdOutputMode: previousDsdOutputMode }).catch(() => undefined);
        throw settingsError;
      }
    } catch (audioError) {
      setError(formatUserFacingError(audioError, { context: 'audio' }));
    }
  };

  const handleExclusiveInstabilityFallbackToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioExclusiveInstabilityFallbackEnabled ?? false);

    const audio = getAudioBridge();
    const app = getAppBridge();
    if (!audio || !app?.setSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      const nextStatus = await audio.setOutput({ exclusiveInstabilityFallbackEnabled: nextEnabled });
      try {
        const nextSettings = await app.setSettings({ audioExclusiveInstabilityFallbackEnabled: nextEnabled });
        setAppSettings(nextSettings);
        dispatchSettingsChanged(nextSettings);
        setStatus(nextStatus);
        setError(null);
      } catch (settingsError) {
        await audio.setOutput({ exclusiveInstabilityFallbackEnabled: !nextEnabled }).catch(() => undefined);
        throw settingsError;
      }
    } catch (audioError) {
      setError(formatUserFacingError(audioError, { context: 'audio' }));
    }
  };

  const handleSoxrFallbackToggle = async (): Promise<void> => {
    const nextEnabled = !(appSettings?.audioSoxrFallbackEnabled ?? true);

    const audio = getAudioBridge();
    const app = getAppBridge();
    if (!audio || !app?.setSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change audio output.');
      return;
    }

    try {
      const nextStatus = await audio.setOutput({ soxrFallbackEnabled: nextEnabled });
      try {
        const nextSettings = await app.setSettings({ audioSoxrFallbackEnabled: nextEnabled });
        setAppSettings(nextSettings);
        dispatchSettingsChanged(nextSettings);
        setStatus(nextStatus);
        setError(null);
      } catch (settingsError) {
        await audio.setOutput({ soxrFallbackEnabled: !nextEnabled }).catch(() => undefined);
        throw settingsError;
      }
    } catch (audioError) {
      setError(formatUserFacingError(audioError, { context: 'audio' }));
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
      setError(formatUserFacingError(resetError, { context: 'audio' }));
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
      setError(formatUserFacingError(restartError, { context: 'audio' }));
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
      finalThemeUnlocked: echoProUnlockedForDisplay,
      customThemeId: Object.prototype.hasOwnProperty.call(patch, 'appearanceThemeCustomId')
        ? patch.appearanceThemeCustomId ?? null
        : activeThemeCustom?.id ?? appSettings?.appearanceThemeCustomId ?? null,
      customThemes: patch.appearanceCustomThemes ?? savedThemeCustomThemes,
    });
  };
  const getThemeScheduleSettings = (patch: Partial<AppSettings> = {}): Partial<AppSettings> => ({ ...(appSettings ?? {}), ...patch });

  const handleThemeModeChange = (appearanceTheme: AppThemeMode): void => {
    skipNextThemePreviewRef.current = true;
    pendingRandomThemeDraftRef.current = null;
    const nextCustomThemeId = appearanceTheme === 'ambient' ? null : activeThemeCustom?.id ?? savedThemeCustomId ?? null;
    updateThemePreferences(appearanceTheme, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextCustomThemeId,
      customThemes: savedThemeCustomThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({ appearanceTheme }),
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
    if (ambientThemeActive) {
      setThemeCustomMessage(ambientThemePresetLockMessage);
      return;
    }
    if (isProOnlyThemePreset(appearanceThemePreset) && !echoProUnlockedForDisplay) {
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    const nextCustomId = activeThemeCustom ? null : savedThemeCustomId;
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, appearanceThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextCustomId,
      customThemes: savedThemeCustomThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({ appearanceThemePreset, appearanceThemeCustomId: nextCustomId }),
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
    const nextFinalThemeUnlockVersion = isProOnlyThemePreset(appearanceThemePreset) && echoProUnlockedForDisplay ? finalThemeUnlockVersion : null;
    const finalThemeUnlockPatch = isProOnlyThemePreset(appearanceThemePreset) || appSettings?.finalThemeUnlockVersion
      ? { finalThemeUnlockVersion: nextFinalThemeUnlockVersion }
      : {};
    patchAppSettings(
      activeThemeCustom
        ? { appearanceThemePreset, appearanceThemeCustomId: null, ...finalThemeUnlockPatch }
        : { appearanceThemePreset, ...finalThemeUnlockPatch },
    );
  };

  const revokeFinalThemeSelection = (message?: string): void => {
    const fallbackPreset: AppThemePreset = 'classic';
    const safeCustomThemes = savedThemeCustomThemes.filter((theme) => theme.basePreset !== 'FINAL');
    pendingRandomThemeDraftRef.current = null;
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, fallbackPreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: null,
      customThemes: safeCustomThemes,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: fallbackPreset,
        appearanceCustomThemes: safeCustomThemes,
        appearanceThemeCustomId: null,
      }),
    });
    setSelectedThemePreset(fallbackPreset);
    setActiveThemeCustomId(null);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: fallbackPreset,
            appearanceCustomThemes: safeCustomThemes,
            appearanceThemeCustomId: null,
            finalThemeUnlockVersion: null,
          }
        : current,
    );
    setThemeCustomThemes(safeCustomThemes);
    patchAppSettings({
      appearanceThemePreset: fallbackPreset,
      appearanceCustomThemes: safeCustomThemes,
      appearanceThemeCustomId: null,
      finalThemeUnlockVersion: null,
    });
    if (message) {
      setThemeCustomMessage(message);
    }
  };

  const handleRandomThemeCreate = (): void => {
    if (ambientThemeActive) {
      setThemeCustomMessage(ambientThemePresetLockMessage);
      return;
    }

    const randomTheme = buildRandomThemeDraft();
    pendingRandomThemeDraftRef.current = randomTheme;
    setActiveThemeCustomId(null);
    setSelectedThemePreset('classic');
    setThemeCustomDraft(randomTheme[themeCustomTone]);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: 'classic',
            appearanceThemeCustomId: null,
            finalThemeUnlockVersion: null,
          }
        : current,
    );
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.randomReady'));
  };

  const themeCustomValues = mergeThemeToneValues(selectedThemePreset, themeCustomTone, themeCustomDraft);
  const themeCustomWarnings = getThemeContrastWarnings(themeCustomValues);
  const selectedThemePresetOption = themePresetOptions.find((option) => option.preset === selectedThemePreset) ?? themePresetOptions[0];
  const themePresetsExpanded = appSettings?.appearanceThemePresetsExpanded === true;
  const ambientThemePreview = 'linear-gradient(135deg, #070910 0%, #151a27 48%, #f4f6fb 100%)';
  const themePresetSummaryPreview = ambientThemeActive ? ambientThemePreview : selectedThemePresetOption.preview;
  const themePresetSummaryLabel = ambientThemeActive ? t('settings.appearance.theme.ambient') : activeThemeCustom?.name ?? t(selectedThemePresetOption.labelKey);
  const blockAmbientThemeEdit = (): boolean => {
    if (!ambientThemeActive) {
      return false;
    }

    setThemeCustomMessage(ambientThemeCustomLockMessage);
    return true;
  };

  const rememberPendingRandomThemeDraft = (draft: AppThemeToneOverride): void => {
    if (!pendingRandomThemeDraftRef.current) {
      return;
    }

    pendingRandomThemeDraftRef.current = {
      ...pendingRandomThemeDraftRef.current,
      [themeCustomTone]: draft,
    };
  };

  const updateThemeCustomColor = (field: ThemeColorField, value: string): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

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
      rememberPendingRandomThemeDraft(next);
      return next;
    });
  };

  const updateThemeCustomPercent = (field: ThemeNumberField, value: number): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

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
      rememberPendingRandomThemeDraft(next);
      return next;
    });
  };

  const updateThemeCustomMotionEnabled = (enabled: boolean): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    setThemeCustomMessage(null);
    setThemeCustomDraft((current) => {
      const next = { ...current };
      if (enabled === getThemeEditorDefaults(selectedThemePreset, themeCustomTone).motionEnabled) {
        delete next.motionEnabled;
      } else {
        next.motionEnabled = enabled;
      }
      rememberPendingRandomThemeDraft(next);
      return next;
    });
  };

  const handleThemeCustomAutoFix = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    const backgroundText = bestReadableColor(themeCustomValues.appBg);
    const panelText = bestReadableColor(themeCustomValues.panel);
    const accentText = bestReadableColor(themeCustomValues.accent);
    const darkBackground = getRelativeLuminance(themeCustomValues.appBg) < 0.42;

    setThemeCustomDraft((current) => {
      const next = {
        ...current,
        heading: backgroundText,
        text: backgroundText,
        muted: darkBackground ? '#c7d1d8' : '#61564d',
        buttonText: panelText,
        onAccent: accentText,
      };
      rememberPendingRandomThemeDraft(next);
      return next;
    });
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.fixed'));
  };

  const handleThemeCustomSave = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (
      (isProOnlyThemePreset(selectedThemePreset) || (activeThemeCustom && isProOnlyThemePreset(activeThemeCustom.basePreset))) &&
      !echoProUnlockedForDisplay
    ) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    const currentTheme = activeThemeCustom;
    const pendingRandomTheme = pendingRandomThemeDraftRef.current;
    const buildSavedRandomTheme = (): AppThemeCustomTheme => {
      const timestamp = new Date().toISOString();
      return {
        id: createThemeCustomId(),
        name: t(randomThemePresetOption.labelKey),
        basePreset: selectedThemePreset,
        light: pendingRandomTheme?.light,
        dark: pendingRandomTheme?.dark,
        [themeCustomTone]: themeCustomDraft,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    };
    const nextThemes = currentTheme
      ? updateThemeCustomThemeTone(savedThemeCustomThemes, currentTheme.id, themeCustomTone, themeCustomDraft)
      : pendingRandomTheme
        ? normalizeThemeCustomThemes([...savedThemeCustomThemes, buildSavedRandomTheme()])
      : normalizeThemeCustomThemes([...savedThemeCustomThemes, buildThemeCustomTheme(savedThemeCustomThemes, selectedThemePreset, themeCustomTone, themeCustomDraft)]);
    const nextThemeId = currentTheme?.id ?? nextThemes[nextThemes.length - 1]?.id ?? null;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextThemeId,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: selectedThemePreset,
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: nextThemeId,
      }),
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
    pendingRandomThemeDraftRef.current = null;
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.saved'));
  };

  const handleThemeCustomReset = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (
      (isProOnlyThemePreset(selectedThemePreset) || (activeThemeCustom && isProOnlyThemePreset(activeThemeCustom.basePreset))) &&
      !echoProUnlockedForDisplay
    ) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    setThemeCustomDraft({});
    if (activeThemeCustom) {
      const nextThemes = updateThemeCustomThemeTone(savedThemeCustomThemes, activeThemeCustom.id, themeCustomTone, null);
      updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
        animate: true,
        customThemeId: activeThemeCustom.id,
        customThemes: nextThemes,
        finalThemeUnlocked: echoProUnlockedForDisplay,
        scheduleSettings: getThemeScheduleSettings({ appearanceCustomThemes: nextThemes }),
      });
      setThemeCustomThemes(nextThemes);
      setAppSettings((current) => (current ? { ...current, appearanceCustomThemes: nextThemes } : current));
      patchAppSettings({ appearanceCustomThemes: nextThemes });
    } else {
      const nextOverrides = buildThemePresetOverrides(savedThemePresetOverrides, selectedThemePreset, themeCustomTone, null);
      updateThemePresetOverrides(nextOverrides, appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, {
        animate: true,
        finalThemeUnlocked: echoProUnlockedForDisplay,
        scheduleSettings: getThemeScheduleSettings({
          appearanceThemePreset: selectedThemePreset,
          appearanceThemePresetOverrides: nextOverrides,
        }),
      });
      setAppSettings((current) => (current ? { ...current, appearanceThemePresetOverrides: nextOverrides } : current));
      patchAppSettings({ appearanceThemePreset: selectedThemePreset, appearanceThemePresetOverrides: nextOverrides });
    }
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.reset'));
  };

  const handleThemeCustomExport = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (
      (isProOnlyThemePreset(selectedThemePreset) || (activeThemeCustom && isProOnlyThemePreset(activeThemeCustom.basePreset))) &&
      !echoProUnlockedForDisplay
    ) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    const payload = createThemeExportPayload(savedThemeCustomThemes, activeThemeCustom, selectedThemePreset, themeCustomTone, themeCustomDraft);
    downloadTextFile(`echo-theme-${payload.theme.name}.echo-theme.json`, `${JSON.stringify(payload, null, 2)}\n`);
    setThemeCustomMessage(t('settings.appearance.themeCustom.message.exported'));
  };

  const handleThemeCustomImport = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    pendingRandomThemeDraftRef.current = null;
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
            if (
              parsed.theme &&
              typeof parsed.theme === 'object' &&
              !Array.isArray(parsed.theme) &&
              isProOnlyThemePreset((parsed.theme as Partial<AppThemeCustomTheme>).basePreset as AppThemePreset) &&
              !echoProUnlockedForDisplay
            ) {
              throw new Error('Pro custom themes cannot be imported without unlock');
            }
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
          if (isProOnlyThemePreset(importedTheme.basePreset) && !echoProUnlockedForDisplay) {
            throw new Error('Pro custom themes cannot be imported without unlock');
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
            finalThemeUnlocked: echoProUnlockedForDisplay,
            scheduleSettings: getThemeScheduleSettings({
              appearanceThemePreset: importedTheme.basePreset,
              appearanceCustomThemes: nextThemes,
              appearanceThemeCustomId: importedTheme.id,
            }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (isProOnlyThemePreset(pluginTheme.basePreset) && !echoProUnlockedForDisplay) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    const existingTheme = savedThemeCustomThemes.find((theme) => theme.id === pluginTheme.customThemeId);
    const importedTheme = buildPluginThemeCustomTheme(pluginTheme, existingTheme);
    const nextThemes = normalizeThemeCustomThemes([...savedThemeCustomThemes.filter((theme) => theme.id !== importedTheme.id), importedTheme]);

    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, importedTheme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: importedTheme.id,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: importedTheme.basePreset,
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: importedTheme.id,
      }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (isProOnlyThemePreset(selectedThemePreset) && !echoProUnlockedForDisplay) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    const nextTheme = buildThemeCustomTheme(savedThemeCustomThemes, selectedThemePreset, themeCustomTone, themeCustomDraft);
    const nextThemes = normalizeThemeCustomThemes([...savedThemeCustomThemes, nextTheme]);
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, selectedThemePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextTheme.id,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: selectedThemePreset,
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: nextTheme.id,
      }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (isProOnlyThemePreset(theme.basePreset) && !echoProUnlockedForDisplay) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    skipNextThemePreviewRef.current = true;
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, theme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: theme.id,
      customThemes: savedThemeCustomThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: theme.basePreset,
        appearanceThemeCustomId: theme.id,
      }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (!activeThemeCustom) {
      return;
    }
    const nextName = window.prompt(t('settings.appearance.themeCustom.action.rename'), activeThemeCustom.name);
    if (nextName === null) {
      return;
    }

    const nextThemes = renameThemeCustomTheme(savedThemeCustomThemes, activeThemeCustom.id, nextName);
    setThemeCustomThemes(nextThemes);
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, activeThemeCustom.basePreset, savedThemePresetOverrides, {
      customThemeId: activeThemeCustom.id,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: {
        ...(appSettings ?? {}),
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: activeThemeCustom.id,
      },
    });
    setAppSettings((current) => (current ? { ...current, appearanceCustomThemes: nextThemes, appearanceThemeCustomId: activeThemeCustom.id } : current));
    patchAppSettings({ appearanceCustomThemes: nextThemes, appearanceThemeCustomId: activeThemeCustom.id });
  };

  const handleThemeCustomDuplicate = (): void => {
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (!activeThemeCustom) {
      return;
    }
    if (isProOnlyThemePreset(activeThemeCustom.basePreset) && !echoProUnlockedForDisplay) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    const nextThemes = duplicateThemeCustomTheme(savedThemeCustomThemes, activeThemeCustom.id);
    const nextTheme = nextThemes[nextThemes.length - 1];
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, nextTheme.basePreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: nextTheme.id,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: nextTheme.basePreset,
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: nextTheme.id,
      }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    if (!activeThemeCustom) {
      return;
    }
    if (isProOnlyThemePreset(activeThemeCustom.basePreset) && !echoProUnlockedForDisplay) {
      revokeFinalThemeSelection(t('settings.appearance.themeCustom.message.importFailed'));
      return;
    }
    if (!window.confirm(t('settings.appearance.themeCustom.action.delete'))) {
      return;
    }

    pendingRandomThemeDraftRef.current = null;
    const fallbackPreset = activeThemeCustom.basePreset;
    const nextThemes = savedThemeCustomThemes.filter((theme) => theme.id !== activeThemeCustom.id);
    updateThemePreferences(appSettings?.appearanceTheme ?? defaultThemeMode, fallbackPreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: null,
      customThemes: nextThemes,
      finalThemeUnlocked: echoProUnlockedForDisplay,
      scheduleSettings: getThemeScheduleSettings({
        appearanceThemePreset: fallbackPreset,
        appearanceCustomThemes: nextThemes,
        appearanceThemeCustomId: null,
      }),
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
    if (blockAmbientThemeEdit()) {
      return;
    }

    pendingRandomThemeDraftRef.current = null;
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

  const applyTaskbarMiniPlayerEnabled = useCallback((enabled: boolean): void => {
    const taskbarMiniPlayer = window.echo?.taskbarMiniPlayer;
    if (!taskbarMiniPlayer?.setEnabled) {
      setError('Taskbar mini player bridge is unavailable.');
      return;
    }

    setError(null);
    void taskbarMiniPlayer
      .setEnabled(enabled)
      .then((state) => {
        const nextEnabled = state.settings.taskbarMiniPlayerEnabled === true;
        setAppSettings((current) => current ? { ...current, taskbarMiniPlayerEnabled: nextEnabled } : current);
        dispatchSettingsChanged({ taskbarMiniPlayerEnabled: nextEnabled });
      })
      .catch((taskbarError) => {
        setError(taskbarError instanceof Error ? taskbarError.message : String(taskbarError));
      });
  }, [dispatchSettingsChanged]);

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
        if (Object.prototype.hasOwnProperty.call(patch, 'autoUpdateCustomUrl')) {
          setAutoUpdateCustomUrlDraft(settings.autoUpdateCustomUrl ?? '');
        }
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

  useEffect(() => {
    if (activeSection !== 'library') {
      return;
    }

    const libraryLab = getLibraryLabBridge();
    if (!libraryLab) {
      setLiveLibraryState(null);
      return;
    }

    let cancelled = false;
    const refresh = (): void => {
      void libraryLab
        .getState()
        .then((state) => {
          if (!cancelled) {
            setLiveLibraryState(state);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLiveLibraryState(null);
          }
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, appSettings?.liveLibraryUpdatesEnabled, appSettings?.lowSpecModeEnabled]);

  const handleAccessibilityChange = useCallback((patch: Partial<AccessibilityPreferences>): void => {
    const current = normalizeAccessibilityPreferences(appSettings?.accessibilityPreferences);
    patchAppSettings({
      accessibilityPreferences: {
        ...current,
        ...patch,
      },
    });
  }, [appSettings?.accessibilityPreferences, patchAppSettings]);

  useEffect(() => {
    if (
      !finalThemeUnlockChecked ||
      echoProUnlockedForDisplay ||
      finalThemeRelockAppliedRef.current ||
      !appSettings?.appearanceThemePreset ||
      !isProOnlyThemePreset(appSettings.appearanceThemePreset)
    ) {
      return;
    }

    finalThemeRelockAppliedRef.current = true;
    const fallbackPreset: AppThemePreset = 'classic';
    updateThemePreferences(appSettings.appearanceTheme ?? defaultThemeMode, fallbackPreset, savedThemePresetOverrides, {
      animate: true,
      customThemeId: null,
      customThemes: savedThemeCustomThemes,
      scheduleSettings: {
        ...appSettings,
        appearanceThemePreset: fallbackPreset,
        appearanceThemeCustomId: null,
      },
    });
    setSelectedThemePreset(fallbackPreset);
    setActiveThemeCustomId(null);
    setAppSettings((current) =>
      current
        ? {
            ...current,
            appearanceThemePreset: fallbackPreset,
            appearanceThemeCustomId: null,
          }
        : current,
    );
    patchAppSettings({ appearanceThemePreset: fallbackPreset, appearanceThemeCustomId: null, finalThemeUnlockVersion: null });
  }, [
    appSettings,
    finalThemeUnlockChecked,
    echoProUnlockedForDisplay,
    patchAppSettings,
    savedThemeCustomThemes,
    savedThemePresetOverrides,
  ]);

  const handleWindowAcrylicToggle = useCallback((): void => {
    const app = getAppBridge();
    const diagnostics = getDiagnosticsBridge();

    if (!app || !appSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save app settings.');
      return;
    }

    const nextEnabled = !(appSettings.appWindowAcrylicEnabled ?? false);
    if (nextEnabled && !echoProUnlockedForDisplay) {
      setError('窗口亚克力是 ECHO Pro Only 功能，请先在通用设置登录、兑换 ECHO Pro 或导入有效 Pro 插件。');
      setEchoProAccountPanelExpanded(true);
      try {
        window.localStorage.setItem(generalEchoProAccountPanelExpandedStorageKey, 'true');
      } catch {
        // Ignore storage failures; the in-memory panel state is enough for this session.
      }
      return;
    }

    void app
      .setSettings({ appWindowAcrylicEnabled: nextEnabled })
      .then((settings) => {
        setAppSettings(settings);
        dispatchSettingsChanged(settings);

        if (window.confirm(t('settings.appearance.windowAcrylic.restartConfirm'))) {
          if (!diagnostics) {
            setError('Desktop bridge unavailable. Restart ECHO Next manually to apply Window Acrylic.');
            return;
          }
          void diagnostics.relaunchApp();
        }
      })
      .catch((settingsError) => {
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [appSettings, dispatchSettingsChanged, echoProUnlockedForDisplay, t]);

  const handleWindowAcrylicTransparencyChange = useCallback(
    (value: number): void => {
      if (!echoProUnlockedForDisplay) {
        setError('窗口亚克力是 ECHO Pro Only 功能，请先在通用设置登录、兑换 ECHO Pro 或导入有效 Pro 插件。');
        return;
      }
      patchAppSettings({
        appWindowAcrylicTransparencyPercent: Math.max(0, Math.min(100, Math.round(value))),
      });
    },
    [echoProUnlockedForDisplay, patchAppSettings],
  );

  const handleWindowAcrylicKeepWhenUnfocusedToggle = useCallback((): void => {
    const nextEnabled = !(appSettings?.appWindowAcrylicKeepWhenUnfocusedEnabled ?? false);
    if (nextEnabled && !echoProUnlockedForDisplay) {
      setError('窗口亚克力是 ECHO Pro Only 功能，请先在通用设置登录、兑换 ECHO Pro 或导入有效 Pro 插件。');
      return;
    }
    patchAppSettings({
      appWindowAcrylicKeepWhenUnfocusedEnabled: nextEnabled,
    });
  }, [appSettings?.appWindowAcrylicKeepWhenUnfocusedEnabled, echoProUnlockedForDisplay, patchAppSettings]);

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
      if (lockedVisibleSidebarRouteIdSet.has(routeId) || lockedHiddenSidebarRouteIdSet.has(routeId)) {
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
      sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds],
    });
  }, [patchAppSettings]);

  const handlePlayerBarButtonVisibilityToggle = useCallback(
    (buttonId: PlayerBarButtonId): void => {
      const hiddenSet = new Set(hiddenPlayerBarButtonIds);
      if (hiddenSet.has(buttonId)) {
        hiddenSet.delete(buttonId);
      } else {
        hiddenSet.add(buttonId);
      }

      patchAppSettings({
        hiddenPlayerBarButtonIds: normalizeHiddenPlayerBarButtonIdsForRenderer([...hiddenSet]),
      });
    },
    [hiddenPlayerBarButtonIds, patchAppSettings],
  );

  const handlePlayerBarButtonsReset = useCallback((): void => {
    patchAppSettings({ hiddenPlayerBarButtonIds: [...defaultHiddenPlayerBarButtonIds] });
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
        const state = visible
          ? await miniPlayer.show()
          : await miniPlayer.hide({ restoreMainWindow: true });
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

  const applyPetState = useCallback(
    (state: PetState): void => {
      setAppSettings((current) => (current ? { ...current, ...state.settings } : current));
      dispatchSettingsChanged(state.settings);
      setError(null);
    },
    [dispatchSettingsChanged],
  );

  useEffect(() => window.echo?.pet?.onStateChanged?.(applyPetState), [applyPetState]);

  const handlePetVisibleChange = useCallback(
    async (visible: boolean): Promise<void> => {
      const pet = window.echo?.pet;
      if (!pet) {
        patchAppSettings({ petEnabled: visible });
        return;
      }

      try {
        applyPetState(await (visible ? pet.show() : pet.hide()));
      } catch (petError) {
        setError(petError instanceof Error ? petError.message : String(petError));
      }
    },
    [applyPetState, patchAppSettings],
  );

  const handlePetResetBounds = useCallback(async (): Promise<void> => {
    try {
      const pet = window.echo?.pet;
      if (pet) {
        applyPetState(await pet.resetBounds());
      }
    } catch (petError) {
      setError(petError instanceof Error ? petError.message : String(petError));
    }
  }, [applyPetState]);

  const handlePetScaleChange = useCallback(async (scalePercent: number): Promise<void> => {
    const normalizedScalePercent = Math.round(Math.max(petScalePercentMin, Math.min(petScalePercentMax, scalePercent)));
    const pet = window.echo?.pet;
    if (!pet) {
      patchAppSettings({ petScalePercent: normalizedScalePercent });
      return;
    }

    try {
      applyPetState(await pet.setScale(normalizedScalePercent));
    } catch (petError) {
      setError(petError instanceof Error ? petError.message : String(petError));
    }
  }, [applyPetState, patchAppSettings]);

  const handleSpotifyAuthConfigSave = useCallback((): void => {
    const app = getAppBridge();

    if (!app) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save Spotify settings.');
      return;
    }

    const clientId = spotifyAuthDraft.clientId.trim();
    const redirectUri = spotifyAuthDraft.redirectUri.trim();
    if (!isSpotifyClientIdInputValid(clientId)) {
      setSpotifyAuthMessage(t('settings.integrations.spotifyAuth.message.clientIdRequired'));
      return;
    }

    if (!isSpotifyRedirectUriInputValid(redirectUri)) {
      setSpotifyAuthMessage(t('settings.integrations.spotifyAuth.message.redirectInvalid'));
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
        setSpotifyAuthMessage(t('settings.integrations.spotifyAuth.message.saved'));
      })
      .catch((settingsError) => {
        setSpotifyAuthMessage(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [dispatchSettingsChanged, spotifyAuthDraft, t]);

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
      setTidalAuthMessage(t('settings.integrations.tidalAuth.message.clientIdRequired'));
      return;
    }

    if (!isTidalClientSecretInputValid(clientSecret)) {
      setTidalAuthMessage(t('settings.integrations.tidalAuth.message.clientSecretRequired'));
      return;
    }

    if (!isSpotifyRedirectUriInputValid(redirectUri)) {
      setTidalAuthMessage(t('settings.integrations.tidalAuth.message.redirectInvalid'));
      return;
    }

    if (!isTidalCountryCodeInputValid(countryCode)) {
      setTidalAuthMessage(t('settings.integrations.tidalAuth.message.countryInvalid'));
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
        setTidalAuthMessage(t('settings.integrations.tidalAuth.message.saved'));
      })
      .catch((settingsError) => {
        setTidalAuthMessage(settingsError instanceof Error ? settingsError.message : String(settingsError));
      });
  }, [dispatchSettingsChanged, tidalAuthDraft, t]);

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
        message: t('settings.integrations.networkProxy.message.manualRequired'),
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
        message: t('settings.integrations.networkProxy.message.pacRequired'),
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
          message: t('settings.integrations.networkProxy.message.saved'),
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
  }, [dispatchSettingsChanged, networkProxyDraft, t]);

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
        message: t('settings.integrations.networkProxy.message.manualRequired'),
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
        message: t('settings.integrations.networkProxy.message.pacRequired'),
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
  }, [networkProxyDraft, t]);

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

  const toggleEchoProAccountPanelExpanded = useCallback((): void => {
    setEchoProAccountPanelExpanded((expanded) => {
      const next = !expanded;
      try {
        window.localStorage.setItem(generalEchoProAccountPanelExpandedStorageKey, next ? 'true' : 'false');
      } catch {
        // Local storage can be unavailable in privacy-restricted shells; the in-memory toggle still works.
      }
      return next;
    });
  }, []);

  const toggleEchoProActivationPanelExpanded = useCallback((): void => {
    setEchoProActivationPanelExpanded((expanded) => {
      const next = !expanded;
      try {
        window.localStorage.setItem(generalEchoProActivationPanelExpandedStorageKey, next ? 'true' : 'false');
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

  const submitEchoProAccount = useCallback(async (action: 'login' | 'register'): Promise<void> => {
    const app = getAppBridge();
    if (!app?.loginEchoProAccount || !app.registerEchoProAccount) {
      setEchoProError('ECHO Pro account bridge unavailable.');
      return;
    }

    setEchoProBusyAction(action);
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const credentials = { username: echoProUsername.trim(), password: echoProPassword };
      const status = action === 'login'
        ? await app.loginEchoProAccount(credentials)
        : await app.registerEchoProAccount(credentials);
      setEchoProAccountStatus(status);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: status }));
      setEchoProPassword('');
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(action === 'login' ? '已登录 ECHO Pro 账号。下次启动会自动保持登录。' : '账号已创建。下次启动会自动保持登录，Pro 资格需要服务器授权或兑换 Key 后生效。');
    } catch (accountError) {
      setEchoProError(formatEchoProError(accountError, locale));
    } finally {
      setEchoProBusyAction(null);
    }
  }, [echoProPassword, echoProUsername, locale]);

  const logoutEchoProAccount = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.logoutEchoProAccount) {
      setEchoProError('ECHO Pro account bridge unavailable.');
      return;
    }

    setEchoProBusyAction('logout');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const status = await app.logoutEchoProAccount();
      setEchoProAccountStatus(status);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: status }));
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage('已退出 ECHO Pro 账号。');
    } catch (accountError) {
      setEchoProError(formatEchoProError(accountError, locale));
    } finally {
      setEchoProBusyAction(null);
    }
  }, [locale]);

  const activateEchoProPluginInApp = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.activateEchoProPlugin) {
      setEchoProError('ECHO Pro activation bridge unavailable.');
      return;
    }

    setEchoProActivationBusyAction('activate');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const submitActivation = (replaceMachineBinding: boolean) => app.activateEchoProPlugin(
        echoProActivationMode === 'afdian'
          ? {
              mode: 'afdian',
              qq: echoProActivationQq,
              orderId: echoProActivationOrderId,
              ...(replaceMachineBinding ? { replaceMachineBinding: true } : {}),
            }
          : {
              mode: 'key',
              qq: echoProActivationQq,
              key: echoProActivationKey,
              ...(replaceMachineBinding ? { replaceMachineBinding: true } : {}),
            },
      );
      let replaceMachineBinding = false;
      let result;
      try {
        result = await submitActivation(false);
      } catch (activationError) {
        if (normalizeEchoProErrorCode(activationError) !== 'echo_pro_activation_machine_binding_confirmation_required') {
          throw activationError;
        }
        if (!window.confirm(
          locale === 'zh-CN'
            ? '这份 Pro 授权目前绑定在另一台设备上。\n\n继续后，ECHO 只会释放这份授权对应的旧设备，并立即绑定到当前电脑；其他授权和订单不会受影响。\n\n确认换绑到这台电脑吗？'
            : 'This Pro license is currently bound to another device.\n\nContinuing releases only the old device proven by this license and immediately binds this computer. Other licenses and orders are unaffected.\n\nMove Pro to this computer?',
        )) {
          setEchoProError(formatEchoProError(new Error('echo_pro_license_machine-mismatch'), locale));
          return;
        }
        replaceMachineBinding = true;
        result = await submitActivation(true);
      }
      setEchoProPluginUnlocked(result.enabled);
      setEchoProPluginStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ pluginUnlocked: result.enabled }));
      if (result.enabled) {
        setFinalThemeUnlocked(true);
      }
      if (echoProActivationMode === 'afdian') {
        setEchoProActivationOrderId('');
      } else {
        setEchoProActivationKey('');
      }
      setEchoProActivationSecretVisible(false);
      window.dispatchEvent(new Event('plugins:changed'));
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(locale === 'zh-CN'
        ? replaceMachineBinding
          ? '换绑完成：旧设备名额已释放，ECHO Pro 已在这台电脑启用。以后无需安装授权插件。'
          : '激活完成：ECHO Pro 已在这台电脑启用。以后启动会自动识别，无需安装授权插件。'
        : replaceMachineBinding
          ? 'Transfer complete: the old device slot was released and ECHO Pro is enabled on this computer. No license plugin is required.'
          : 'Activation complete: ECHO Pro is enabled on this computer and will be recognized automatically. No license plugin is required.');
    } catch (activationError) {
      setEchoProError(formatEchoProError(activationError, locale));
    } finally {
      setEchoProActivationBusyAction(null);
    }
  }, [echoProActivationKey, echoProActivationMode, echoProActivationOrderId, echoProActivationQq, locale]);

  const releaseEchoProCurrentDevice = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.releaseEchoProCurrentDevice) {
      setEchoProError('ECHO Pro device release bridge unavailable.');
      return;
    }
    const releaseByOrder = echoProActivationMode === 'afdian';
    const orderId = echoProActivationOrderId.trim();
    if (releaseByOrder && !/^[0-9A-Za-z_-]{12,80}$/u.test(orderId)) {
      setEchoProError(locale === 'zh-CN'
        ? '请填写完整的爱发电订单号；订单解绑不需要 QQ。'
        : 'Enter the complete Afdian order ID. QQ is not required for order release.');
      return;
    }
    if (!window.confirm(
      locale === 'zh-CN'
        ? releaseByOrder
          ? '解绑这个订单下的全部设备？\n\n只会提交爱发电订单号，不需要 QQ。该订单当前占用的所有设备名额都会释放，之后可重新激活。'
          : '解绑当前电脑？\n\n只会释放这台电脑占用的设备名额，并删除本机授权；其他设备不会受影响。之后仍可重新激活。'
        : releaseByOrder
          ? 'Release every device for this order?\n\nOnly the Afdian order ID is submitted; QQ is not required. All occupied slots for this order will be released and can be activated again later.'
          : 'Release this computer?\n\nOnly this computer’s slot and local license are removed. Other devices are unaffected, and you can activate again later.',
    )) {
      return;
    }

    setEchoProActivationBusyAction('release');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const result = await app.releaseEchoProCurrentDevice(releaseByOrder ? orderId : undefined);
      setEchoProPluginUnlocked(false);
      setEchoProPluginStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ pluginUnlocked: false }));
      if (releaseByOrder) {
        setEchoProActivationOrderId('');
        setEchoProActivationSecretVisible(false);
      }
      window.dispatchEvent(new Event('plugins:changed'));
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(locale === 'zh-CN'
        ? releaseByOrder
          ? result.alreadyReleased
            ? '这个订单已经没有已绑定设备，无需重复解绑。'
            : `解绑完成：已释放这个订单的 ${result.releasedCount ?? 0} 个设备名额，现在可以重新激活。`
          : '解绑完成：这台电脑的设备名额已释放，本机 Pro 已关闭；其他设备不受影响。'
        : releaseByOrder
          ? result.alreadyReleased
            ? 'This order already has no active HWIDs. All device slots are released.'
            : `Released ${result.releasedCount ?? 0} HWIDs for this order at ${formatProtectionTimestamp(result.releasedAt)}.`
          : `This device was securely released at ${formatProtectionTimestamp(result.releasedAt)}.`);
    } catch (releaseError) {
      setEchoProError(formatEchoProError(releaseError, locale));
    } finally {
      setEchoProActivationBusyAction(null);
    }
  }, [echoProActivationMode, echoProActivationOrderId, locale]);

  const logoutEchoProFromThisComputer = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.releaseEchoProCurrentDevice) {
      setEchoProError('ECHO Pro device release bridge unavailable.');
      return;
    }
    if (!window.confirm(
      locale === 'zh-CN'
        ? '登出 ECHO Pro？\n\n这会释放当前电脑占用的设备名额并删除本机授权；其他设备不受影响，之后仍可重新激活。'
        : 'Sign out of ECHO Pro?\n\nThis releases only this computer’s device slot and removes its local license. Other devices are unaffected, and you can activate again later.',
    )) {
      return;
    }

    setEchoProActivationBusyAction('release');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      await app.releaseEchoProCurrentDevice();
      setEchoProPluginUnlocked(false);
      setEchoProPluginStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ pluginUnlocked: false }));

      if (echoProAccountStatusForStatus?.loggedIn && app.logoutEchoProAccount) {
        const accountStatus = await app.logoutEchoProAccount();
        setEchoProAccountStatus(accountStatus);
        setEchoProAccountStatusChecked(true);
        setEchoProStatusSnapshot(rememberEchoProDisplayStatus({
          accountStatus,
          pluginUnlocked: false,
        }));
      }

      window.dispatchEvent(new Event('plugins:changed'));
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(locale === 'zh-CN'
        ? '已登出 ECHO Pro：当前电脑的设备名额已释放，本机授权已移除；之后可随时重新激活。'
        : 'Signed out of ECHO Pro. This computer’s device slot and local license were released; you can activate again anytime.');
    } catch (logoutError) {
      setEchoProError(formatEchoProError(logoutError, locale));
    } finally {
      setEchoProActivationBusyAction(null);
    }
  }, [echoProAccountStatusForStatus?.loggedIn, locale]);

  const redeemEchoProKey = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.redeemEchoProKey) {
      setEchoProError('ECHO Pro key bridge unavailable.');
      return;
    }

    setEchoProBusyAction('redeem');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const result = await app.redeemEchoProKey(echoProRedeemKey);
      setEchoProAccountStatus(result.status);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: result.status }));
      setEchoProRedeemKey('');
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(`ECHO Pro key redeemed at ${formatProtectionTimestamp(result.redeemedAt)}.`);
    } catch (redeemError) {
      setEchoProError(formatEchoProError(redeemError, locale));
    } finally {
      setEchoProBusyAction(null);
    }
  }, [echoProRedeemKey, locale]);

  const releaseEchoProDevices = useCallback(async (): Promise<void> => {
    const app = getAppBridge();
    if (!app?.releaseEchoProDevices) {
      setEchoProError('ECHO Pro device bridge unavailable.');
      return;
    }
    if (!echoProAccountStatus?.loggedIn) {
      setEchoProError('Please log in before releasing ECHO Pro devices.');
      return;
    }
    if (!echoProPassword) {
      setEchoProError('Enter your current ECHO Pro password before releasing all devices.');
      return;
    }
    if (!window.confirm('解绑所有 ECHO Pro 设备？这会释放当前账号的 2 个设备槽位，并让其它设备重新验证。')) {
      return;
    }

    setEchoProBusyAction('release-devices');
    setEchoProError(null);
    setEchoProMessage(null);
    try {
      const result = await app.releaseEchoProDevices(echoProPassword);
      setEchoProAccountStatus(result.status);
      setEchoProAccountStatusChecked(true);
      setEchoProStatusSnapshot(rememberEchoProDisplayStatus({ accountStatus: result.status }));
      setEchoProPassword('');
      window.dispatchEvent(new Event('echo-pro:status-changed'));
      setEchoProMessage(`已解绑 ${result.releasedCount} 台设备，时间 ${formatProtectionTimestamp(result.releasedAt)}。`);
    } catch (releaseError) {
      setEchoProError(formatEchoProError(releaseError, locale));
    } finally {
      setEchoProBusyAction(null);
    }
  }, [echoProAccountStatus?.loggedIn, echoProPassword, locale]);

  const updateEchoProCapsLock = useCallback((event: ReactKeyboardEvent<HTMLInputElement>): void => {
    setEchoProCapsLockEnabled(event.getModifierState('CapsLock'));
  }, []);

  const handleOnlineAlbumInfoSave = useCallback((): void => {
    const patch: Partial<AppSettings> = {
      onlineAlbumInfoDiscogsUserToken: onlineAlbumInfoDraft.discogsUserToken.trim() || null,
    };

    setOnlineAlbumInfoBusyAction('save');
    setOnlineAlbumInfoMessage(t('settings.integrations.onlineAlbum.message.saving'));
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
        setOnlineAlbumInfoMessage(t('settings.integrations.onlineAlbum.message.saved'));
      })
      .catch((settingsError) => {
        const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
        setError(message);
        setOnlineAlbumInfoMessage(message);
      })
      .finally(() => setOnlineAlbumInfoBusyAction(null));
  }, [dispatchSettingsChanged, onlineAlbumInfoDraft.discogsUserToken, t]);

  const handleOnlineArtistInfoSave = useCallback((): void => {
    const patch: Partial<AppSettings> = {
      onlineArtistInfoBandsintownAppId: onlineArtistInfoDraft.bandsintownAppId.trim() || null,
      onlineArtistInfoTicketmasterApiKey: onlineArtistInfoDraft.ticketmasterApiKey.trim() || null,
      onlineArtistInfoSeatGeekClientId: onlineArtistInfoDraft.seatGeekClientId.trim() || null,
      onlineArtistInfoRegion: onlineArtistInfoDraft.region.trim() || null,
    };

    setOnlineArtistInfoBusyAction('save');
    setOnlineArtistInfoMessage(t('settings.integrations.onlineArtist.message.saving'));
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
        setOnlineArtistInfoMessage(t('settings.integrations.onlineArtist.message.saved'));
      })
      .catch((settingsError) => {
        const message = settingsError instanceof Error ? settingsError.message : String(settingsError);
        setError(message);
        setOnlineArtistInfoMessage(message);
      })
      .finally(() => setOnlineArtistInfoBusyAction(null));
  }, [dispatchSettingsChanged, onlineArtistInfoDraft, t]);

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
        setOnlineArtistInfoMessage(t('settings.integrations.onlineArtist.message.cleared', { count: result.removedRows }));
        window.dispatchEvent(new Event('library:changed'));
      })
      .catch((clearError) => {
        const message = clearError instanceof Error ? clearError.message : String(clearError);
        setError(message);
        setOnlineArtistInfoMessage(message);
      })
      .finally(() => setOnlineArtistInfoBusyAction(null));
  }, [t]);

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
      return t('settings.integrations.common.status.notChecked');
    }
    if (!taskbarPlaybackStatus.supported) {
      return t('settings.integrations.common.status.nonWindows');
    }
    if (!taskbarPlaybackStatus.bound || !taskbarPlaybackStatus.windowAvailable) {
      return t('settings.integrations.common.status.windowUnbound');
    }
    if (!taskbarPlaybackStatus.enabled) {
      return t('settings.integrations.common.status.disabled');
    }
    if (taskbarPlaybackStatus.lastError) {
      return t('settings.integrations.common.status.error', { error: taskbarPlaybackStatus.lastError });
    }
    if (!taskbarPlaybackStatus.visible) {
      return taskbarPlaybackStatus.playbackState
        ? t('settings.integrations.common.status.waitingPlaybackState', { state: taskbarPlaybackStatus.playbackState })
        : t('settings.integrations.common.status.waitingPlayback');
    }

    const progress =
      typeof taskbarPlaybackStatus.progress === 'number' ? ` ${Math.round(taskbarPlaybackStatus.progress * 100)}%` : '';
    return t('settings.integrations.common.status.applied', { progress });
  }, [taskbarPlaybackStatus, t]);

  const patchMvSettings = useCallback(
    (patch: Partial<MvSettings>): void => {
      patchAppSettings(appSettingsPatchFromMvSettingsPatch(patch), { mvSettingsPatch: patch });
    },
    [patchAppSettings],
  );

  const previewAndPersistMvTuning = useCallback((patch: Partial<MvSettings>): void => {
    pendingMvTuningPreviewPatchRef.current = {
      ...(pendingMvTuningPreviewPatchRef.current ?? {}),
      ...patch,
    };
    pendingMvTuningPersistPatchRef.current = {
      ...(pendingMvTuningPersistPatchRef.current ?? {}),
      ...patch,
    };

    if (mvTuningPreviewFrameRef.current === null) {
      mvTuningPreviewFrameRef.current = window.requestAnimationFrame(() => {
        mvTuningPreviewFrameRef.current = null;
        const previewPatch = pendingMvTuningPreviewPatchRef.current;
        pendingMvTuningPreviewPatchRef.current = null;
        if (!previewPatch) {
          return;
        }

        const appPatch = appSettingsPatchFromMvSettingsPatch(previewPatch);
        setAppSettings((current) => (current ? { ...current, ...appPatch } : current));
        dispatchSettingsChanged(previewPatch);
      });
    }

    if (mvTuningPersistTimerRef.current !== null) {
      window.clearTimeout(mvTuningPersistTimerRef.current);
    }
    mvTuningPersistTimerRef.current = window.setTimeout(() => {
      mvTuningPersistTimerRef.current = null;
      const persistPatch = pendingMvTuningPersistPatchRef.current ?? patch;
      pendingMvTuningPersistPatchRef.current = null;
      patchAppSettings(appSettingsPatchFromMvSettingsPatch(persistPatch), { announce: false });
    }, 420);
  }, [dispatchSettingsChanged, patchAppSettings]);

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

  const handleAutoUpdateSourceSelect = (source: AutoUpdateSource): void => {
    patchAppSettings({
      autoUpdateSource: source,
      autoUpdateCustomUrl: source === 'custom' ? autoUpdateCustomUrlDraft.trim() || null : appSettings?.autoUpdateCustomUrl ?? null,
    });
  };

  const handleAutoUpdateCustomUrlSave = (): void => {
    patchAppSettings({
      autoUpdateSource: 'custom',
      autoUpdateCustomUrl: autoUpdateCustomUrlDraft.trim() || null,
    });
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
    pendingWallpaperPreviewPatchRef.current = {
      ...(pendingWallpaperPreviewPatchRef.current ?? {}),
      ...patch,
    };
    pendingWallpaperPersistPatchRef.current = {
      ...(pendingWallpaperPersistPatchRef.current ?? {}),
      ...patch,
    };

    if (wallpaperPreviewFrameRef.current === null) {
      wallpaperPreviewFrameRef.current = window.requestAnimationFrame(() => {
        wallpaperPreviewFrameRef.current = null;
        const previewPatch = pendingWallpaperPreviewPatchRef.current;
        pendingWallpaperPreviewPatchRef.current = null;

        if (previewPatch) {
          dispatchSettingsChanged(previewPatch);
        }
      });
    }

    if (wallpaperPersistTimerRef.current !== null) {
      window.clearTimeout(wallpaperPersistTimerRef.current);
    }

    wallpaperPersistTimerRef.current = window.setTimeout(() => {
      wallpaperPersistTimerRef.current = null;
      const persistPatch = pendingWallpaperPersistPatchRef.current ?? patch;
      pendingWallpaperPersistPatchRef.current = null;
      patchAppSettings(persistPatch, { announce: false });
    }, 280);
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
      const isFirstAppWallpaper =
        !appSettings?.appCustomWallpaperPath &&
        !appSettings?.appPortraitWallpaperPath;
      patchAppSettings({
        ...(isFirstAppWallpaper ? appWallpaperEffectPresets[0].patch : {}),
        appCustomWallpaperPath: wallpaperPath,
        appWallpaperMediaType: mediaType,
      });
      setError(null);
    } catch (wallpaperError) {
      setError(wallpaperError instanceof Error ? wallpaperError.message : String(wallpaperError));
    }
  };

  const handleAppWallpaperClear = (): void => {
    patchAppSettings({
      appCustomWallpaperPath: null,
      appPortraitWallpaperPath: null,
      appWallpaperMediaType: 'image',
      appPortraitWallpaperMediaType: 'image',
    });
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

  const handleStageBridgeToggle = async (key: 'obsBrowserSourceEnabled' | 'stageApiEnabled'): Promise<void> => {
    const stageBridge = getStageBridge();
    if (!stageBridge) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change OBS/Stage settings.');
      return;
    }

    try {
      setError(null);
      const nextEnabled = !(appSettings?.[key] ?? false);
      const nextStatus = await stageBridge.setEnabled({ [key]: nextEnabled });
      setStageBridgeStatus(nextStatus);
      setAppSettings((current) => (current ? { ...current, [key]: nextEnabled } : current));
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : String(stageError));
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

  const clearNeteaseQrCloseTimer = useCallback((): void => {
    if (neteaseQrCloseTimerRef.current !== null) {
      window.clearTimeout(neteaseQrCloseTimerRef.current);
      neteaseQrCloseTimerRef.current = null;
    }
  }, []);

  const handleCloseNeteaseQrLogin = useCallback((): void => {
    clearNeteaseQrCloseTimer();
    setNeteaseQrLogin(initialNeteaseQrLoginState);
  }, [clearNeteaseQrCloseTimer]);

  useEffect(
    () => () => {
      clearNeteaseQrCloseTimer();
    },
    [clearNeteaseQrCloseTimer],
  );

  const updateAccountStatus = useCallback((status: AccountStatus): void => {
    setAccountStatuses((current) => {
      const withoutProvider = current.filter((item) => item.provider !== status.provider);
      return [...withoutProvider, status];
    });
  }, []);

  const handleAccountSaveCookie = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();
    const cookie = accountCookies[provider].trim();

    if (!accounts) {
      setAccountErrors((current) => ({ ...current, [provider]: t('settings.integrations.common.desktopBridge.accounts') }));
      return;
    }

    if (!cookie) {
      setAccountErrors((current) => ({ ...current, [provider]: t('settings.integrations.accounts.cookieRequired') }));
      return;
    }

    try {
      setAccountBusyFor(provider, 'save');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: null }));
      const status = await accounts.saveCookie(provider, cookie);
      updateAccountStatus(status);
      setAccountCookies((current) => ({ ...current, [provider]: '' }));
      setAccountMessages((current) => ({ ...current, [provider]: t('settings.integrations.accounts.cookieSaved') }));
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

    if (provider !== 'spotify' && provider !== 'tidal' && provider !== 'qobuz' && !accountStatusByProvider[provider]?.connected && accountCookies[provider].trim().length === 0) {
      setAccountErrors((current) => ({ ...current, [provider]: t('settings.integrations.accounts.cookieMissing') }));
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
    // Qobuz has its own logout flow that clears credentials + URL cache
    if (provider === 'qobuz') {
      try {
        setAccountBusyFor('qobuz', 'clear');
        setAccountErrors((current) => ({ ...current, qobuz: null }));
        setAccountMessages((current) => ({ ...current, qobuz: null }));
        const qobuz = getQobuzBridge();
        if (qobuz) {
          await qobuz.logout();
        }
        updateAccountStatus({
          provider: 'qobuz',
          connected: false,
          username: null,
          displayName: null,
          avatarUrl: null,
          lastLoginAt: null,
          lastCheckedAt: null,
          expiresAt: null,
          error: null,
        });
        setQobuzTokenValue('');
      } catch (accountError) {
        setAccountErrors((current) => ({ ...current, qobuz: accountError instanceof Error ? accountError.message : String(accountError) }));
      } finally {
        setAccountBusyFor('qobuz', null);
      }
      return;
    }

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
      } else if (provider === 'soundcloud') {
        setSoundCloudBrowser('none');
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
      setAccountMessages((current) => ({ ...current, youtube: browser === 'none' ? null : t('settings.integrations.common.savedBrowser', { browser }) }));
      updateAccountStatus(await accounts.setYouTubeBrowser(browser));
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, youtube: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor('youtube', null);
    }
  };

  const handleSoundCloudBrowserChange = async (browser: AccountBrowser): Promise<void> => {
    const accounts = getAccountsBridge();
    setSoundCloudBrowser(browser);

    if (!accounts) {
      return;
    }

    try {
      setAccountBusyFor('soundcloud', 'browser');
      setAccountErrors((current) => ({ ...current, soundcloud: null }));
      setAccountMessages((current) => ({ ...current, soundcloud: browser === 'none' ? null : t('settings.integrations.common.browserLoginSaved', { browser }) }));
      updateAccountStatus(await accounts.setBrowser('soundcloud', browser));
    } catch (accountError) {
      setAccountErrors((current) => ({ ...current, soundcloud: accountError instanceof Error ? accountError.message : String(accountError) }));
    } finally {
      setAccountBusyFor('soundcloud', null);
    }
  };

  const handleAccountOpenLogin = async (provider: AccountProvider): Promise<void> => {
    const accounts = getAccountsBridge();

    if (!accounts) {
      setAccountErrors((current) => ({ ...current, [provider]: t('settings.integrations.common.desktopBridge.signIn') }));
      return;
    }

    if (provider === 'youtube') {
      if (youtubeBrowser === 'none') {
        setAccountErrors((current) => ({ ...current, youtube: t('settings.integrations.common.requireBrowser') }));
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
          youtube: result?.message ?? t('settings.integrations.accounts.youtube.browserOpened'),
        }));
      } catch (accountError) {
        setAccountErrors((current) => ({ ...current, youtube: accountError instanceof Error ? accountError.message : String(accountError) }));
      } finally {
        setAccountBusyFor('youtube', null);
      }
      return;
    }

    if (provider === 'soundcloud') {
      if (soundCloudBrowser === 'none' && !accountCookies.soundcloud.trim()) {
        setAccountErrors((current) => ({ ...current, soundcloud: t('settings.integrations.accounts.soundcloud.requireBrowserOrCookie') }));
        return;
      }

      try {
        setAccountBusyFor('soundcloud', 'login');
        setAccountErrors((current) => ({ ...current, soundcloud: null }));
        const status = soundCloudBrowser !== 'none'
          ? await accounts.setBrowser('soundcloud', soundCloudBrowser)
          : (accountStatusByProvider.soundcloud ?? await accounts.getStatus('soundcloud'));
        const result = typeof accounts.startLogin === 'function'
          ? await accounts.startLogin('soundcloud')
          : null;
        if (!result) {
          await handleOpenExternalUrl('https://soundcloud.com/');
        }
        updateAccountStatus(result?.status ?? status);
        setAccountMessages((current) => ({
          ...current,
          soundcloud: result?.message ?? t('settings.integrations.accounts.soundcloud.browserOpened'),
        }));
      } catch (accountError) {
        setAccountErrors((current) => ({ ...current, soundcloud: accountError instanceof Error ? accountError.message : String(accountError) }));
      } finally {
        setAccountBusyFor('soundcloud', null);
      }
      return;
    }

    // Qobuz: token-based login (user pastes user_auth_token from browser DevTools)
    if (provider === 'qobuz') {
      const qobuz = getQobuzBridge();
      if (!qobuz) {
        setAccountErrors((current) => ({ ...current, qobuz: t('settings.integrations.common.desktopBridge.signIn') }));
        return;
      }
      const token = qobuzTokenValue.trim();
      if (!token) {
        setAccountErrors((current) => ({ ...current, qobuz: '请先粘贴 user_auth_token' }));
        return;
      }
      try {
        setAccountBusyFor('qobuz', 'login');
        setAccountErrors((current) => ({ ...current, qobuz: null }));
        setAccountMessages((current) => ({ ...current, qobuz: null }));
        const result = await qobuz.login({ userAuthToken: token });
        if (result.success) {
          updateAccountStatus({
            provider: 'qobuz',
            connected: true,
            username: result.username,
            displayName: result.displayName,
            avatarUrl: result.avatarUrl,
            lastLoginAt: new Date().toISOString(),
            lastCheckedAt: new Date().toISOString(),
            expiresAt: null,
            error: result.error ?? null,
          });
          setQobuzTokenValue('');
          setAccountMessages((current) => ({ ...current, qobuz: result.error ?? t('settings.integrations.accounts.qobuz.loginSuccess') }));
        } else {
          setAccountErrors((current) => ({ ...current, qobuz: result.error ?? t('settings.integrations.accounts.qobuz.loginFailed') }));
        }
      } catch (accountError) {
        setAccountErrors((current) => ({ ...current, qobuz: accountError instanceof Error ? accountError.message : String(accountError) }));
      } finally {
        setAccountBusyFor('qobuz', null);
      }
      return;
    }

    if (typeof accounts.startLogin !== 'function') {
      window.open(accountLoginUrls[provider], '_blank', 'noopener,noreferrer');
      setAccountErrors((current) => ({
        ...current,
        [provider]: t('settings.integrations.accounts.legacyLoginUnavailable'),
      }));
      setAccountMessages((current) => ({
        ...current,
        [provider]: t('settings.integrations.accounts.legacyLoginOpened'),
      }));
      return;
    }

    try {
      setAccountBusyFor(provider, 'login');
      setAccountErrors((current) => ({ ...current, [provider]: null }));
      setAccountMessages((current) => ({ ...current, [provider]: t('settings.integrations.accounts.loginWindowOpened') }));
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

  const handleNeteaseQrLogin = async (): Promise<void> => {
    const accounts = getAccountsBridge();

    if (!accounts?.startNeteaseQrLogin || !accounts.pollNeteaseQrLogin) {
      await handleAccountOpenLogin('netease');
      return;
    }

    try {
      clearNeteaseQrCloseTimer();
      setAccountBusyFor('netease', 'login');
      setAccountErrors((current) => ({ ...current, netease: null }));
      setAccountMessages((current) => ({ ...current, netease: null }));
      setNeteaseQrLogin({
        ...initialNeteaseQrLoginState,
        open: true,
        busy: true,
        state: 'creating',
        message: t('settings.integrations.accounts.neteaseQr.creating'),
      });

      const started = await accounts.startNeteaseQrLogin();
      setNeteaseQrLogin({
        open: true,
        busy: false,
        key: started.key,
        qrUrl: started.qrUrl,
        qrDataUrl: started.qrUrl,
        expiresAt: started.expiresAt,
        state: started.state,
        message: t('settings.integrations.accounts.neteaseQr.scanHint'),
        error: null,
      });
    } catch (accountError) {
      const message = accountError instanceof Error ? accountError.message : String(accountError);
      setAccountErrors((current) => ({ ...current, netease: message }));
      setNeteaseQrLogin((current) => ({
        ...current,
        open: true,
        busy: false,
        state: 'failed',
        message: null,
        error: message,
      }));
    } finally {
      setAccountBusyFor('netease', null);
    }
  };

  useEffect(() => {
    const shouldPoll =
      neteaseQrLogin.open &&
      Boolean(neteaseQrLogin.key) &&
      (neteaseQrLogin.state === 'waiting' || neteaseQrLogin.state === 'scanned');
    if (!shouldPoll || !neteaseQrLogin.key) {
      return;
    }

    const accounts = getAccountsBridge();
    if (!accounts?.pollNeteaseQrLogin) {
      return;
    }

    const key = neteaseQrLogin.key;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const result = await accounts.pollNeteaseQrLogin!(key);
        if (cancelled) {
          return;
        }

        if (result.status) {
          updateAccountStatus(result.status);
        }

        if (result.state === 'confirmed') {
          const message = result.message || t('settings.integrations.accounts.neteaseQr.success');
          setAccountErrors((current) => ({ ...current, netease: null }));
          setAccountMessages((current) => ({ ...current, netease: message }));
          setNeteaseQrLogin((current) => current.key === key
            ? {
                ...current,
                busy: false,
                state: 'confirmed',
                message,
                error: null,
              }
            : current);
          clearNeteaseQrCloseTimer();
          neteaseQrCloseTimerRef.current = window.setTimeout(() => {
            setNeteaseQrLogin(initialNeteaseQrLoginState);
            neteaseQrCloseTimerRef.current = null;
          }, 900);
          return;
        }

        if (result.state === 'expired' || result.state === 'failed') {
          const fallbackKey = result.state === 'expired'
            ? 'settings.integrations.accounts.neteaseQr.expired'
            : 'settings.integrations.accounts.neteaseQr.failed';
          const message = result.message || t(fallbackKey);
          setAccountErrors((current) => ({ ...current, netease: message }));
          setNeteaseQrLogin((current) => current.key === key
            ? {
                ...current,
                busy: false,
                state: result.state,
                message: null,
                error: message,
              }
            : current);
          return;
        }

        const message = result.state === 'scanned'
          ? t('settings.integrations.accounts.neteaseQr.scanned')
          : t('settings.integrations.accounts.neteaseQr.waiting');
        setNeteaseQrLogin((current) => current.key === key
          ? {
              ...current,
              busy: false,
              state: result.state,
              message,
              error: null,
            }
          : current);
      } catch (accountError) {
        if (cancelled) {
          return;
        }
        const message = accountError instanceof Error ? accountError.message : String(accountError);
        setAccountErrors((current) => ({ ...current, netease: message }));
        setNeteaseQrLogin((current) => current.key === key
          ? {
              ...current,
              busy: false,
              state: 'failed',
              message: null,
              error: message,
            }
          : current);
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 1800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    clearNeteaseQrCloseTimer,
    neteaseQrLogin.key,
    neteaseQrLogin.open,
    neteaseQrLogin.state,
    t,
    updateAccountStatus,
  ]);

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
      ? t('mediaLibrary.settings.coverCache.defaultPath', { path: defaultCacheDirectory })
      : t('mediaLibrary.settings.coverCache.defaultLoading');
  const pendingResolvedCacheDirectory =
    pendingCacheDirectory === undefined ? null : pendingCacheDirectory ?? defaultCacheDirectory;
  const currentDownloadDirectoryLabel = downloadSettings?.outputDirectory ?? t('mediaLibrary.settings.download.path.notSelected');
  const downloadsFeatureUnlocked = appSettings?.downloadsFeatureUnlocked === true;
  const streamingFeatureEnabled = appSettings?.streamingFeatureEnabled === true;
  const osuDownloaderFeatureEnabled = appSettings?.osuDownloaderFeatureEnabled === true;
  const osuDownloaderSidebarHidden = sidebarHiddenRouteIdSet.has('osu-downloader');
  const signalPathControlEnabled = appSettings?.signalPathControlEnabled === true;
  const signalPathControlToggleTarget = !signalPathControlEnabled;
  const networkMetadataEnabled = appSettings?.networkMetadataEnabled ?? true;
  const lyricsBackfillAutoAcceptScore = appSettings?.lyricsBackfillAutoAcceptScore ?? 0.45;
  const lyricsBackfillAutoAcceptPercent = Math.round(lyricsBackfillAutoAcceptScore * 100);

  const applyStreamingFeatureEnabled = (nextStreamingFeatureEnabled: boolean): void => {
    patchAppSettings({
      streamingFeatureEnabled: nextStreamingFeatureEnabled,
      sidebarHiddenRouteIds: nextStreamingFeatureEnabled
        ? sidebarHiddenRouteIds.filter((routeId) => routeId !== 'streaming')
        : normalizeSidebarHiddenRouteIds([...sidebarHiddenRouteIds, 'streaming']),
    });
  };

  const handleStreamingFeatureToggle = (): void => {
    if (streamingFeatureEnabled) {
      applyStreamingFeatureEnabled(false);
      return;
    }

    setStreamingNoticeConsent('');
    setStreamingNoticeOpen(true);
  };

  const handleStreamingNoticeCancel = (): void => {
    setStreamingNoticeOpen(false);
    setStreamingNoticeConsent('');
  };

  const handleStreamingNoticeConfirm = (): void => {
    setStreamingNoticeOpen(false);
    setStreamingNoticeConsent('');
    applyStreamingFeatureEnabled(true);
  };

  const applyOsuDownloaderFeatureEnabled = (nextOsuDownloaderFeatureEnabled: boolean): void => {
    patchAppSettings({
      osuDownloaderFeatureEnabled: nextOsuDownloaderFeatureEnabled,
      sidebarHiddenRouteIds: nextOsuDownloaderFeatureEnabled
        ? sidebarHiddenRouteIds.filter((routeId) => routeId !== 'osu-downloader')
        : normalizeSidebarHiddenRouteIds([...sidebarHiddenRouteIds, 'osu-downloader']),
    });
  };

  const showOsuDownloaderInSidebar = (): void => {
    patchAppSettings({
      osuDownloaderFeatureEnabled: true,
      sidebarHiddenRouteIds: sidebarHiddenRouteIds.filter((routeId) => routeId !== 'osu-downloader'),
    });
  };

  const applySignalPathControlEnabled = (nextSignalPathControlEnabled: boolean): void => {
    const app = getAppBridge();

    if (!app || !appSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to save app settings.');
      return;
    }

    const requestId = signalPathControlSaveRequestRef.current + 1;
    signalPathControlSaveRequestRef.current = requestId;
    const previousSettings = appSettings;
    const optimisticSettings: AppSettings = {
      ...appSettings,
      signalPathControlEnabled: nextSignalPathControlEnabled,
    };

    setSignalPathControlSaving(true);
    setAppSettings(optimisticSettings);
    dispatchSettingsChanged(optimisticSettings);

    void app
      .setSettings({ signalPathControlEnabled: nextSignalPathControlEnabled })
      .then((settings) => {
        if (signalPathControlSaveRequestRef.current !== requestId) {
          return;
        }
        setAppSettings(settings);
        dispatchSettingsChanged(settings);
      })
      .catch((settingsError) => {
        if (signalPathControlSaveRequestRef.current !== requestId) {
          return;
        }
        setAppSettings(previousSettings);
        dispatchSettingsChanged(previousSettings);
        setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      })
      .finally(() => {
        if (signalPathControlSaveRequestRef.current === requestId) {
          setSignalPathControlSaving(false);
        }
      });
  };

  const handleDownloadFeatureUnlock = (): void => {
    if (!isDownloadFeatureUnlockCode(downloadUnlockInput)) {
      setDownloadUnlockMessage('Key not accepted.');
      return;
    }

    setDownloadUnlockMessage('Key accepted.');
    setDownloadUnlockInput('');
    patchAppSettings({ downloadsFeatureKeyAccepted: true });
  };

  const handleDownloadFeatureRelease = (): void => {
    setDownloadUnlockInput('');
    setDownloadUnlockMessage(null);
    patchAppSettings({ downloadsFeatureKeyAccepted: false, streamingDownloadActionsEnabled: false });
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
  const currentAutoUpdateSource = appSettings?.autoUpdateSource ?? 'official';
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
    ? t('common.disabled')
    : artistImagePaused
      ? t('mediaLibrary.settings.artistImages.status.paused')
      : artistImageProgress?.running
        ? t('mediaLibrary.settings.artistImages.status.running')
        : t('mediaLibrary.settings.artistImages.status.idle');

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
    ? t('mediaLibrary.settings.lyrics.status.notStarted')
    : lyricsBackfillJob.playbackThrottled
      ? t('mediaLibrary.settings.lyrics.status.throttled')
      : lyricsBackfillJob.phase === 'collecting'
      ? t('mediaLibrary.settings.lyrics.status.collecting', { scanned: lyricsBackfillJob.scannedTracks })
      : lyricsBackfillJob.status === 'completed'
        ? t('mediaLibrary.folders.status.completed')
        : lyricsBackfillJob.status === 'cancelled'
          ? t('mediaLibrary.folders.status.cancelled')
          : lyricsBackfillJob.status === 'failed'
            ? t('mediaLibrary.folders.status.failed')
            : lyricsBackfillJob.mode === 'complete'
              ? t('mediaLibrary.settings.lyrics.status.completeRunning')
              : t('mediaLibrary.settings.lyrics.status.quickRunning');

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
      const migratedNothing = migrate && result && result.copiedFiles === 0 && result.skippedFiles === 0 && result.updatedCoverRows === 0;
      setCacheDirectoryMessage(
        migratedNothing
          ? '缓存目录已切换；旧缓存不可用或没有可迁移文件，请点击上方“重扫缺失封面的歌曲”重新生成封面。'
          : migrate
            ? '缓存目录已切换，封面缓存路径已更新。'
            : '缓存目录已切换，后续扫描会按需重新生成封面缓存。',
      );
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

  const handleOpenFirstRunWizard = (): void => {
    patchAppSettings({ onboardingCompleted: false });
  };

  const handleLiveLibraryUpdatesToggle = (): void => {
    const nextEnabled = !(appSettings?.liveLibraryUpdatesEnabled ?? false);
    patchAppSettings({
      liveLibraryUpdatesEnabled: nextEnabled,
      liveLibraryAutoHideDeletedEnabled: false,
    });
  };

  const liveLibraryStatus = (() => {
    if (liveLibraryState?.watcherEnabled && liveLibraryState.watcherLastError) {
      return {
        text: settingsLocaleCopy(locale, {
          'zh-CN': liveLibraryState.watchedFolderCount > 0
            ? `部分监听异常，正在自动重试 · ${liveLibraryState.watchedFolderCount} 个文件夹可用`
            : '监听异常，正在自动重试',
          'zh-TW': liveLibraryState.watchedFolderCount > 0
            ? `部分監聽異常，正在自動重試 · ${liveLibraryState.watchedFolderCount} 個資料夾可用`
            : '監聽異常，正在自動重試',
          'ja-JP': liveLibraryState.watchedFolderCount > 0
            ? `一部の監視でエラー、自動再試行中 · ${liveLibraryState.watchedFolderCount} フォルダー利用可能`
            : '監視エラー、自動再試行中',
          'en-US': liveLibraryState.watchedFolderCount > 0
            ? `Watcher error · retrying · ${liveLibraryState.watchedFolderCount} folders available`
            : 'Watcher error · retrying',
          'ko-KR': liveLibraryState.watchedFolderCount > 0
            ? `일부 감시 오류 · 자동 재시도 중 · 폴더 ${liveLibraryState.watchedFolderCount}개 사용 가능`
            : '감시 오류 · 자동 재시도 중',
        }),
        tone: 'muted' as const,
      };
    }
    if (liveLibraryState?.watcherRunning) {
      return {
        text: settingsLocaleCopy(locale, {
          'zh-CN': `运行中 · ${liveLibraryState.watchedFolderCount} 个文件夹`,
          'zh-TW': `運行中 · ${liveLibraryState.watchedFolderCount} 個資料夾`,
          'ja-JP': `実行中 · ${liveLibraryState.watchedFolderCount} フォルダー`,
          'en-US': `Running · ${liveLibraryState.watchedFolderCount} folders`,
          'ko-KR': `실행 중 · 폴더 ${liveLibraryState.watchedFolderCount}개`,
        }),
        tone: 'good' as const,
      };
    }
    if (appSettings?.liveLibraryUpdatesEnabled && appSettings.lowSpecModeEnabled) {
      return {
        text: settingsLocaleCopy(locale, {
          'zh-CN': '已由低配置模式暂停',
          'zh-TW': '已由低配置模式暫停',
          'ja-JP': '低スペックモードで一時停止',
          'en-US': 'Paused by low-spec mode',
          'ko-KR': '저사양 모드로 일시 중지됨',
        }),
        tone: 'muted' as const,
      };
    }
    if (liveLibraryState?.watcherEnabled && liveLibraryState.watchedFolderCount === 0) {
      return {
        text: settingsLocaleCopy(locale, {
          'zh-CN': '没有可监听的文件夹',
          'zh-TW': '沒有可監聽的資料夾',
          'ja-JP': '監視できるフォルダーがありません',
          'en-US': 'No folders available to watch',
          'ko-KR': '감시할 폴더가 없음',
        }),
        tone: 'muted' as const,
      };
    }
    if (appSettings?.liveLibraryUpdatesEnabled && !liveLibraryState) {
      return { text: t('common.checking'), tone: 'neutral' as const };
    }
    return { text: t('common.disabled'), tone: 'muted' as const };
  })();

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

  const handleAlbumWallVirtualizationToggle = (): void => {
    patchAppSettings({ albumWallVirtualizationEnabled: !(appSettings?.albumWallVirtualizationEnabled ?? false) });
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

  const getShortcutActionTitle = useCallback((action: GlobalShortcutAction): string => {
    const meta = globalShortcutActionMeta.find((item) => item.action === action);
    return meta ? t(meta.titleKey) : action;
  }, [t]);

  const formatShortcutDuplicateMessage = useCallback(
    (duplicateAction: GlobalShortcutAction): string =>
      t('settings.shortcuts.message.duplicateWithAction', { action: getShortcutActionTitle(duplicateAction) }),
    [getShortcutActionTitle, t],
  );

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
      return formatShortcutDuplicateMessage(duplicateAction);
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

  const handleShortcutRecommendedReset = (scope: ShortcutScope | 'all'): void => {
    if (scope === 'all' && !window.confirm(t('settings.shortcuts.action.restoreRecommendedConfirm'))) {
      return;
    }

    setRecordingShortcutTarget(null);
    setShortcutMessages({});

    if (scope === 'local') {
      patchAppSettings({ localShortcuts: createRecommendedLocalShortcuts() });
      return;
    }

    if (scope === 'global') {
      patchAppSettings({ globalShortcuts: createRecommendedGlobalShortcuts() });
      return;
    }

    patchAppSettings({ localShortcuts: createRecommendedLocalShortcuts(), globalShortcuts: createRecommendedGlobalShortcuts() });
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
        setShortcutMessage(scope, action, formatShortcutDuplicateMessage(duplicateAction));
        return;
      }

      setShortcutMessage(scope, action, null);
      patchShortcut(scope, action, {
        accelerator: validation.accelerator,
        enabled: false,
      });
      setRecordingShortcutTarget(null);
    },
    [formatShortcutDuplicateMessage, globalShortcuts, localShortcuts, patchShortcut, setShortcutMessage, t],
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
      await yieldToSettingsPaint();
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
        setLibraryScanMessage(t('mediaLibrary.settings.scan.message.alreadyRunning'));
        return;
      }

      const scans: LibraryScanStatus[] = [];
      for (const folder of foldersToScan) {
        const scan = await library.scanFolder(folder.id);
        scans.push(scan);
        rememberLibraryScanStatus(scan);
        setLibraryScanStatuses(getLibraryScanStatuses());
        await yieldToSettingsPaint();
      }
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
      await yieldToSettingsPaint();
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

  const handleReplayGainEnabledChange = (enabled: boolean): void => {
    patchAppSettings({
      replayGainEnabled: enabled,
      ...(enabled
        ? {
            replayGainMode: 'track',
            replayGainTargetLufs: SPOTIFY_NORMAL_REPLAY_GAIN_TARGET_LUFS,
            replayGainPreampDb: 0,
            replayGainPreventClipping: true,
            replayGainAnalyzeOnPlay: true,
            replayGainAnalyzeMissingOnScan: false,
            replayGainAnalyzeMissingOnScanOptIn: false,
          }
        : {}),
    });

    if (enabled) {
      const library = getLibraryBridge();
      if (library) {
        void library.startReplayGainAnalysis({ limit: 500 }).catch((analysisError) => {
          setError(analysisError instanceof Error ? analysisError.message : String(analysisError));
        });
      }
    }
  };

  const formatLyricsBackfillMessage = useCallback((status: LyricsBackfillJobStatus): string => {
    if (status.phase === 'collecting') {
      return t('mediaLibrary.settings.lyrics.message.collecting', { scanned: status.scannedTracks });
    }

    if (status.status === 'completed') {
      return t('mediaLibrary.settings.lyrics.message.completed', {
        matched: status.matchedTracks,
        notFound: status.notFoundTracks,
        cached: status.alreadyCachedTracks,
      });
    }

    if (status.status === 'cancelled') {
      return t('mediaLibrary.settings.lyrics.message.cancelled', { processed: status.processedTracks, total: status.totalTracks });
    }

    if (status.status === 'failed') {
      return t('mediaLibrary.settings.lyrics.message.failed', {
        processed: status.processedTracks,
        total: status.totalTracks,
        errors: status.errorCount,
      });
    }

    return t('mediaLibrary.settings.lyrics.message.running', {
      processed: status.processedTracks,
      total: status.totalTracks,
      matched: status.matchedTracks,
    });
  }, [t]);

  const pollLyricsBackfillJob = useCallback(async (jobId: string, generation: number): Promise<void> => {
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
  }, [formatLyricsBackfillMessage]);

  const startLyricsBackfillPolling = useCallback((jobId: string): void => {
    const generation = lyricsBackfillPollGenerationRef.current + 1;
    lyricsBackfillPollGenerationRef.current = generation;
    void pollLyricsBackfillJob(jobId, generation).catch((lyricsError) => {
      if (lyricsBackfillPollGenerationRef.current !== generation) {
        return;
      }

      setLyricsBackfillBusy(false);
      setError(lyricsError instanceof Error ? lyricsError.message : String(lyricsError));
    });
  }, [pollLyricsBackfillJob]);

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
  }, [formatLyricsBackfillMessage, startLyricsBackfillPolling]);

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
        concurrency: mode === 'complete' ? 6 : 10,
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

    setDangerMessage(t('settings.danger.message.confirmRequired', { message, word }));
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
      setDatabaseProtectionMessage(t('settings.danger.database.message.healthRefreshed'));
    } catch (refreshError) {
      setDatabaseProtectionFailure(refreshError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleCreateDatabaseSnapshot = async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.createDatabaseSnapshot) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeCreateSnapshot'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('snapshot');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.creatingSnapshot'));
      const nextStatus = await library.createDatabaseSnapshot();
      setDatabaseProtectionStatus(nextStatus);
      setDatabaseProtectionMessage(t('settings.danger.database.message.snapshotCreated'));
    } catch (snapshotError) {
      setDatabaseProtectionFailure(snapshotError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleRestoreDatabaseSnapshot = async (): Promise<void> => {
    const snapshot = databaseProtectionStatus?.latestHealthySnapshot;
    if (!snapshot) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.noSnapshot'));
      return;
    }
    if (!requireDangerConfirmWord(t('settings.danger.database.confirm.restore'), t('settings.danger.database.confirm.restoreMessage'))) {
      setDatabaseProtectionMessage(t('settings.danger.database.message.restoreCancelled'));
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.restoreDatabaseSnapshot) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeRestore'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('restore');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.restoringSnapshot'));
      const result = await library.restoreDatabaseSnapshot(snapshot.id);
      setDatabaseProtectionMessage(t('settings.danger.database.message.restoredSnapshot', { status: t(getDatabaseHealthLabel(result.health.status)) }));
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
    if (!requireDangerConfirmWord(t('settings.danger.database.confirm.scrub'), t('settings.danger.database.confirm.scrubMessage'))) {
      setDatabaseProtectionMessage(t('settings.danger.database.message.scrubCancelled'));
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.scrubQuarantinedDatabase) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeScrub'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('scrub');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.scrubbingCopy'));
      const result = await library.scrubQuarantinedDatabase();
      setDatabaseProtectionMessage(t('settings.danger.database.message.scrubbedCopy', { rows: result.scrubbedRows, status: t(getDatabaseHealthLabel(result.health.status)) }));
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
    if (!requireDangerConfirmWord(t('settings.danger.database.confirm.discard'), t('settings.danger.database.confirm.discardMessage'))) {
      setDatabaseProtectionMessage(t('settings.danger.database.message.discardCancelled'));
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.discardQuarantinedProblemTracks) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeDiscard'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('discard');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.discardingTracks'));
      const result = await library.discardQuarantinedProblemTracks();
      setDatabaseProtectionMessage(t('settings.danger.database.message.discardedTracks', { count: result.discardedTracks, status: t(getDatabaseHealthLabel(result.health.status)), path: result.discardArchivePath }));
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
    if (!window.confirm(t('settings.danger.database.confirm.relaunchRecovery'))) {
      setDatabaseProtectionMessage(t('settings.danger.database.message.relaunchCancelled'));
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.relaunchRecoveryMode) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeRelaunch'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('relaunch');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.relaunchingRecovery'));
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
    if (!requireDangerConfirmWord(t('settings.danger.database.confirm.rebuildEmpty'), t('settings.danger.database.confirm.rebuildEmptyMessage'))) {
      setDatabaseProtectionMessage(t('settings.danger.database.message.rebuildCancelled'));
      setDatabaseProtectionError(null);
      return;
    }

    const library = getLibraryBridge();
    if (!library?.repairDatabase) {
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeRebuild'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('restore');
      setDangerBusy(true);
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      setDatabaseProtectionMessage(t('settings.danger.database.message.rebuildingEmpty'));
      const result = await library.repairDatabase();
      const archived = result.archivePath ? t('settings.danger.database.message.badArchivePath', { path: result.archivePath }) : t('settings.danger.database.message.noArchiveFound');
      setDatabaseProtectionMessage(t('settings.danger.database.message.rebuiltEmpty', { archived }));
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
      setDatabaseProtectionFailure(t('settings.danger.database.error.bridgeOpenProtection'));
      return;
    }

    try {
      setDatabaseProtectionBusyAction('open');
      clearDatabaseProtectionFeedback();
      setDangerMessage(null);
      setError(null);
      await library.openDataProtectionFolder();
      setDatabaseProtectionMessage(t('settings.danger.database.message.openProtectionRequested'));
    } catch (openError) {
      setDatabaseProtectionFailure(openError);
    } finally {
      setDatabaseProtectionBusyAction(null);
    }
  };

  const handleClearLibraryCache = async (): Promise<void> => {
    if (!window.confirm(t('settings.danger.clearCache.confirm'))) {
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
        t('settings.danger.clearCache.message.cleared', {
          removed: result.removedCount,
          scanned: result.scannedCount,
          deleted: result.deletedCoverCacheFiles,
        }),
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
    if (!requireDangerConfirmWord(t('settings.danger.repair.confirmWord'), t('settings.danger.repair.confirmMessage'))) {
      return;
    }

    if (!window.confirm(t('settings.danger.repair.confirm'))) {
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
      const archived = result.archivePath ? t('settings.danger.database.message.oldArchivePath', { path: result.archivePath }) : t('settings.danger.database.message.noOldDatabase');
      setDangerMessage(t('settings.danger.repair.message.rebuilt', { archived }));
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
    if (!requireDangerConfirmWord(t('settings.danger.deleteDatabase.confirmWord'), t('settings.danger.deleteDatabase.confirmMessage'))) {
      return;
    }

    if (!window.confirm(t('settings.danger.deleteDatabase.confirm'))) {
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
      const archived = result.archivePath ? t('settings.danger.database.message.oldArchivePath', { path: result.archivePath }) : t('settings.danger.database.message.noOldDatabase');
      const removed = result.removedDatabaseFiles.length > 0 ? t('settings.danger.deleteDatabase.message.removedFiles', { files: result.removedDatabaseFiles.join('、') }) : t('settings.danger.deleteDatabase.message.noFiles');
      setDangerMessage(t('settings.danger.deleteDatabase.message.deleted', { removed, archived }));
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
    if (!requireDangerConfirmWord(t('settings.danger.deleteAll.confirmWord'), t('settings.danger.deleteAll.confirmMessage'))) {
      return;
    }

    if (
      !window.confirm(
        t('settings.danger.deleteAll.confirm'),
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
      if (!result.relaunchScheduled) {
        setDangerMessage(t('settings.danger.deleteAll.message.notRestarted', { removed, failed }));
        return;
      }
      const failedText = failed > 0 ? t('settings.danger.deleteAll.message.failed', { failed }) : '';
      setDangerMessage(t('settings.danger.deleteAll.message.deleted', { removed, failedText }));
      window.dispatchEvent(new Event('library:changed'));
    } catch (deleteError) {
      setDangerMessage(null);
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleResetDefaultSettings = async (): Promise<void> => {
    if (!window.confirm(t('settings.danger.reset.confirm'))) {
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
      setDangerMessage(t('settings.danger.reset.message.restored'));
      window.dispatchEvent(new Event('settings:changed'));
      window.dispatchEvent(new Event('library:changed'));
    } catch (resetError) {
      setDangerMessage(null);
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setDangerBusy(false);
    }
  };

  const handleHardwareAccelerationToggle = async (): Promise<void> => {
    const app = getAppBridge();

    if (!app?.setSettings) {
      setError('Desktop bridge unavailable. Open ECHO Next in Electron to change hardware acceleration.');
      return;
    }

    const nextDisabled = appSettings?.hardwareAccelerationDisabled !== true;
    if (!window.confirm(t(nextDisabled ? 'settings.danger.hardwareAcceleration.confirmDisable' : 'settings.danger.hardwareAcceleration.confirmEnable'))) {
      return;
    }

    try {
      setDangerBusy(true);
      setDangerMessage(null);
      setError(null);
      const settings = await app.setSettings({ hardwareAccelerationDisabled: nextDisabled });
      setAppSettings(settings);
      setDangerMessage(t(nextDisabled ? 'settings.danger.hardwareAcceleration.message.disabled' : 'settings.danger.hardwareAcceleration.message.enabled'));
      window.dispatchEvent(new Event('settings:changed'));
    } catch (accelerationError) {
      setDangerMessage(null);
      setError(accelerationError instanceof Error ? accelerationError.message : String(accelerationError));
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
        setSettingsBackupMessage(t('settings.about.settingsExport.message.exported', { path: exportedPath }));
      }
    } catch (exportError) {
      setSettingsBackupMessage(null);
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setSettingsBackupBusy(null);
    }
  };

  const handleImportSettings = async (): Promise<void> => {
    if (!window.confirm(t('settings.about.settingsExport.confirmImport'))) {
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

      setSettingsBackupMessage(t('settings.about.settingsExport.message.imported', { path: result.backupPath }));
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

  const activeNavItems = visibleNavItems.length ? visibleNavItems : settingsNavigationItems;
  const activeNavItemsByKey = useMemo(() => new Map(activeNavItems.map((item) => [item.key, item])), [activeNavItems]);
  const activeNavGroups = useMemo(
    () =>
      settingsNavGroups
        .map((group) => ({
          ...group,
          items: group.itemKeys
            .map((key) => activeNavItemsByKey.get(key))
            .filter((item): item is SettingsNavItem => Boolean(item)),
        }))
        .filter((group) => group.items.length > 0),
    [activeNavItemsByKey],
  );
  const activeNavItem = settingsNavItems.find((item) => item.key === activeSection) ?? settingsNavItems[0];
  const getSettingsSubsection = useCallback((key: SettingsSubsectionCopyKey): SettingSubsectionTitleProps => {
    const copy = settingsSubsectionCopy[key];
    return {
      title: settingsLocaleCopy(locale, copy.title),
      description: 'description' in copy ? settingsLocaleCopy(locale, copy.description) : undefined,
    };
  }, [locale]);
  useEffect(() => {
    const section = document.getElementById(`settings-sec-${activeSection}`);
    if (!section) {
      setSettingsSectionIndexItems([]);
      return undefined;
    }
    let frame = 0;
    const refreshSectionIndex = (): void => {
      const subsectionElements = Array.from(
        section.querySelectorAll<HTMLElement>(
          '.settings-subsection-title, .lyrics-collapsible-section > .lyrics-section-collapse-button, .remote-section-heading > div > h3',
        ),
      );
      const seenLabels = new Set<string>();
      const nextItems = subsectionElements.flatMap((element, index) => {
        const label = element.matches('.settings-subsection-title')
          ? element.querySelector('span')?.textContent?.trim()
          : element.matches('.lyrics-section-collapse-button')
            ? element.querySelector('strong')?.textContent?.trim()
            : element.textContent?.trim();
        if (!label || seenLabels.has(label)) {
          return [];
        }
        seenLabels.add(label);
        const id = element.id || `settings-subsection-${activeSection}-${index + 1}`;
        element.id = id;
        return [{ id, label }];
      });

      if (nextItems.length === 0) {
        const title = section.querySelector<HTMLElement>(':scope > .section-title h2')?.textContent?.trim();
        if (title) {
          nextItems.push({ id: section.id, label: title });
        }
      }

      setSettingsSectionIndexItems(nextItems);
      setActiveSettingsSectionIndexId((current) => nextItems.some((item) => item.id === current) ? current : (nextItems[0]?.id ?? null));
    };
    const scheduleRefresh = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshSectionIndex);
    };
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(section, { childList: true, subtree: true, characterData: true });
    scheduleRefresh();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [activeSection, locale]);
  useEffect(() => {
    const scrollShell = settingsScrollShellRef.current;
    if (!scrollShell || settingsSectionIndexItems.length < 2) {
      return;
    }

    const updateActiveIndexItem = (): void => {
      const shellTop = scrollShell.getBoundingClientRect().top + 96;
      let nextActiveId = settingsSectionIndexItems[0]?.id ?? null;
      for (const item of settingsSectionIndexItems) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top <= shellTop) {
          nextActiveId = item.id;
        }
      }
      setActiveSettingsSectionIndexId(nextActiveId);
    };

    updateActiveIndexItem();
    scrollShell.addEventListener('scroll', updateActiveIndexItem, { passive: true });
    return () => scrollShell.removeEventListener('scroll', updateActiveIndexItem);
  }, [settingsSectionIndexItems]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = document.querySelector<HTMLElement>('.settings-page .settings-nav');
      const activeItem = nav?.querySelector<HTMLElement>('.settings-nav-item.active');
      if (!nav || !activeItem || nav.scrollHeight <= nav.clientHeight) {
        return;
      }

      const navRect = nav.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      if (itemRect.top < navRect.top + 8 || itemRect.bottom > navRect.bottom - 8) {
        nav.scrollTo({
          top: nav.scrollTop + itemRect.top - navRect.top - 12,
          behavior: 'smooth',
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const index = document.querySelector<HTMLElement>('.settings-page .settings-section-index');
      const activeItem = index?.querySelector<HTMLElement>('.settings-section-index-item[data-active="true"]');
      if (!index || !activeItem || index.scrollWidth <= index.clientWidth) {
        return;
      }

      const indexRect = index.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      if (itemRect.left < indexRect.left + 8 || itemRect.right > indexRect.right - 8) {
        index.scrollTo({
          left: index.scrollLeft + itemRect.left - indexRect.left - 12,
          behavior: 'smooth',
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSettingsSectionIndexId]);
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
  const integrationsOverviewTitle = settingsLocaleCopy(locale, {
    'zh-CN': '连接概览',
    'zh-TW': '連接概覽',
    'ja-JP': '接続の概要',
    'en-US': 'Connection Overview',
    'ko-KR': '연결 개요',
  });
  const integrationsCommonTitle = settingsLocaleCopy(locale, {
    'zh-CN': '常用联动',
    'zh-TW': '常用聯動',
    'ja-JP': 'よく使う連携',
    'en-US': 'Common Integrations',
    'ko-KR': '자주 쓰는 연동',
  });
  const integrationsNeedsAttention = settingsLocaleCopy(locale, {
    'zh-CN': '个服务需要处理',
    'zh-TW': '個服務需要處理',
    'ja-JP': '件のサービスを確認',
    'en-US': 'services need attention',
    'ko-KR': '개 서비스 확인 필요',
  });
  const integrationsConfigure = settingsLocaleCopy(locale, {
    'zh-CN': '配置',
    'zh-TW': '設定',
    'ja-JP': '設定',
    'en-US': 'Configure',
    'ko-KR': '구성',
  });
  const integrationsAdvancedSettings = settingsLocaleCopy(locale, {
    'zh-CN': '高级设置',
    'zh-TW': '進階設定',
    'ja-JP': '詳細設定',
    'en-US': 'Advanced settings',
    'ko-KR': '고급 설정',
  });
  const integrationsAdditionalTitle = settingsLocaleCopy(locale, {
    'zh-CN': '其他联动',
    'zh-TW': '其他聯動',
    'ja-JP': 'その他の連携',
    'en-US': 'Other integrations',
    'ko-KR': '기타 연동',
  });
  const integrationsMobileSummary = settingsLocaleCopy(locale, {
    'zh-CN': '免费 · 局域网联动',
    'zh-TW': '免費 · 區域網路聯動',
    'ja-JP': '無料 · LAN 連携',
    'en-US': 'Free · Local network',
    'ko-KR': '무료 · 로컬 네트워크',
  });
  const integrationsProxyUnchecked = settingsLocaleCopy(locale, {
    'zh-CN': '尚未测试',
    'zh-TW': '尚未測試',
    'ja-JP': '未テスト',
    'en-US': 'Not tested',
    'ko-KR': '아직 테스트하지 않음',
  });
  const integrationsNormal = settingsLocaleCopy(locale, {
    'zh-CN': '正常',
    'zh-TW': '正常',
    'ja-JP': '正常',
    'en-US': 'Normal',
    'ko-KR': '정상',
  });
  const integrationsEnabledCount = (count: number): string => settingsLocaleCopy(locale, {
    'zh-CN': `${count} 项已启用`,
    'zh-TW': `${count} 項已啟用`,
    'ja-JP': `${count} 件が有効`,
    'en-US': `${count} enabled`,
    'ko-KR': `${count}개 사용 중`,
  });
  const discordPresenceEnabled = discordPresenceStatus?.enabled ?? appSettings?.discordRichPresenceEnabled ?? false;
  const obsBrowserSourceEnabled = appSettings?.obsBrowserSourceEnabled === true;
  const windowsIntegrationEnabledCount = [
    appSettings?.smtcEnabled ?? true,
    appSettings?.taskbarMiniPlayerEnabled ?? false,
    appSettings?.taskbarPlaybackControlsEnabled ?? false,
  ].filter(Boolean).length;
  const integrationsAttentionCount = Number(!discordPresenceEnabled) + Number(!obsBrowserSourceEnabled);
  const networkProxyModeLabel = buildNetworkProxyModeOptions(t).find((option) => option.value === networkProxyDraft.mode)?.label
    ?? t('settings.integrations.networkProxy.mode.off');
  const networkProxyOverviewLabel = networkProxyDraft.mode === 'off'
    ? networkProxyModeLabel
    : `${networkProxyModeLabel} · ${networkProxyTestResult?.ok ? integrationsNormal : integrationsProxyUnchecked}`;
  const discordPresenceLabel = !discordPresenceStatus?.enabled
    ? t('common.disabled')
    : discordPresenceStatus.connected
      ? t('settings.integrations.discord.status.connected')
      : discordPresenceStatus.lastError
        ? t('settings.integrations.discord.status.error', { error: discordPresenceStatus.lastError })
        : discordPresenceStatus.available
          ? t('common.enabled')
          : t('settings.integrations.discord.status.notRunning');
  const stageBridgeRunning = stageBridgeStatus?.running === true;
  const stageBridgeUrl = stageBridgeStatus?.url ?? t('settings.integrations.stage.status.notRunning');
  const obsBrowserSourceUrl = stageBridgeStatus?.obsUrl ?? t('settings.integrations.stage.status.notRunning');
  const smtcLabel = !appSettings?.smtcEnabled
    ? t('common.disabled')
    : smtcDiagnostics?.recoveryInFlight
      ? t('settings.integrations.smtc.status.recovering')
      : smtcDiagnostics?.hostState ?? t('settings.integrations.common.status.notChecked');
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
  const themeScheduleLockedByAmbient = themeScheduleEnabled && (appSettings?.appearanceTheme ?? defaultThemeMode) === 'ambient';
  const scheduledThemeLabel = scheduledThemeMode === 'ambient'
    ? t('settings.appearance.theme.ambient')
    : scheduledThemeMode === 'dark'
      ? t('settings.appearance.theme.dark')
      : t('settings.appearance.theme.light');
  const themeScheduleStatus = themeScheduleLockedByAmbient
    ? t('settings.appearance.themeSchedule.status.ambient')
    : themeScheduleEnabled
      ? t('settings.appearance.themeSchedule.status.enabled', {
          darkAt: themeScheduleDarkAt,
          lightAt: themeScheduleLightAt,
          mode: scheduledThemeLabel,
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
  const shuffleAvoidRecentCount = appSettings?.playbackShuffleAvoidRecentCount ?? 25;
  const shufflePlaybackModeId = getShufflePlaybackModeId(shuffleAvoidRecentCount);
  const shufflePlaybackMode = shufflePlaybackModeOptions.find((option) => option.id === shufflePlaybackModeId) ?? shufflePlaybackModeOptions[1];
  const shufflePlaybackModeDetail = shuffleAvoidRecentCount === 0
    ? t('settings.playback.shuffleCredibility.off')
    : t('settings.playback.shuffleCredibility.count', { count: shuffleAvoidRecentCount });
  const shufflePlaybackModeStatus = t('settings.playback.shuffleCredibility.current', {
    mode: t(shufflePlaybackMode.labelKey),
    detail: shufflePlaybackModeDetail,
  });
  const noSoundGuideStepCount = playbackNoSoundGuideSteps.length;
  const activeNoSoundGuideStepIndex = Math.min(playbackNoSoundGuideStepIndex, noSoundGuideStepCount - 1);
  const activeNoSoundGuideStep = playbackNoSoundGuideSteps[activeNoSoundGuideStepIndex] ?? playbackNoSoundGuideSteps[0]!;
  const openNoSoundGuide = (): void => {
    setPlaybackNoSoundGuideStepIndex(0);
    setPlaybackNoSoundGuideOpen(true);
  };
  const closeNoSoundGuide = (): void => {
    setPlaybackNoSoundGuideOpen(false);
  };
  const renderNoSoundGuideStepControl = (): ReactNode => {
    switch (activeNoSoundGuideStep.id) {
      case 'output-mode':
        return (
          <div className="settings-no-sound-wizard__control" role="group" aria-label={t('settings.playback.outputMode.title')}>
            <div className="settings-chip-row">
              {playbackOutputModesForPlatform.map((mode) => (
                <ChipButton active={outputMode === mode} key={mode} onClick={() => handleOutputModeChange(mode)}>
                  {getPlaybackOutputModeLabel(mode, t, rendererPlatform)}
                </ChipButton>
              ))}
            </div>
            {playbackSettingsMessage ? <StatusText tone={error ? 'muted' : 'good'}>{playbackSettingsMessage}</StatusText> : null}
          </div>
        );
      case 'backend':
        return sharedBackendOptionsForPlatform.length > 0 ? (
          <div className="settings-no-sound-wizard__control" role="group" aria-label={t('settings.playback.sharedBackend.title')}>
            <div className="settings-chip-row">
              {sharedBackendOptionsForPlatform.map(([backend, labelKey]) => (
                <ChipButton active={outputMode === 'shared' && sharedBackend === backend} key={backend} onClick={() => handleSharedBackendChange(backend)}>
                  {t(labelKey)}
                </ChipButton>
              ))}
            </div>
            {playbackSettingsMessage ? <StatusText tone={error ? 'muted' : 'good'}>{playbackSettingsMessage}</StatusText> : null}
          </div>
        ) : (
          <StatusText tone="muted">{t('settings.playback.noSoundGuide.control.unavailable')}</StatusText>
        );
      case 'device':
        return (
          <div className="settings-no-sound-wizard__control">
            <StyledSelect
              className="settings-select-control"
              value={selectedDeviceId}
              options={outputDeviceOptions}
              onChange={handleDeviceChange}
              ariaLabel={t('settings.playback.outputDevice.title')}
              disabled={compatibleDevices.length === 0}
              showFilterIcon={false}
            />
            {playbackSettingsMessage ? <StatusText tone={error ? 'muted' : 'good'}>{playbackSettingsMessage}</StatusText> : null}
          </div>
        );
      case 'restart':
        return (
          <div className="settings-no-sound-wizard__control">
            <button
              className="settings-action-button"
              type="button"
              disabled={audioResetBusy || windowsAudioRestartBusy}
              onClick={() => void handleAudioEngineReset()}
            >
              <RotateCw size={14} />
              {audioResetBusy ? t('settings.playback.troubleshooting.softBusy') : t('settings.playback.troubleshooting.softAction')}
            </button>
            {audioResetMessage ? <StatusText tone="good">{audioResetMessage}</StatusText> : null}
          </div>
        );
      default:
        return <StatusText tone="muted">{t('settings.playback.noSoundGuide.control.manual')}</StatusText>;
    }
  };

  return (
    <div className="settings-page no-drag">
      {streamingNoticeOpen ? (
        <StreamingConsentNoticeModal
          consent={streamingNoticeConsent}
          onCancel={handleStreamingNoticeCancel}
          onConfirm={handleStreamingNoticeConfirm}
          setConsent={setStreamingNoticeConsent}
        />
      ) : null}
      <NeteaseQrLoginDialog
        state={neteaseQrLogin}
        onClose={handleCloseNeteaseQrLogin}
        onRetry={() => void handleNeteaseQrLogin()}
      />
      <SettingsHeader
        activeNavItem={activeNavItem}
        activeResultIndex={activeSettingsSearchResultIndex}
        inputRef={settingsSearchInputRef}
        onActiveResultIndexChange={setActiveSettingsSearchResultIndex}
        onQueryChange={setSettingsQuery}
        onResultSelect={(result) =>
          jumpToSettingsSection(result.sectionKey, {
            clearSearch: true,
            targetId: result.targetId,
          })
        }
        onSearchKeyDown={handleSettingsSearchKeyDown}
        query={settingsQuery}
        searchResults={settingsSearchResults}
        t={t}
        visibleSearchResults={visibleSettingsSearchResults}
      />

      <div className="settings-body">
        <SettingsNavigation
          activeSection={activeSection}
          groups={activeNavGroups}
          locale={locale}
          onNavigate={handleNavClick}
          t={t}
        />

        <div className={`settings-scroll-frame ${settingsHorizontalScroll.available ? 'has-horizontal-overflow' : ''}`}>
          <SettingsHorizontalPager
            canLeft={settingsHorizontalScroll.canLeft}
            canRight={settingsHorizontalScroll.canRight}
            onScroll={handleSettingsHorizontalScroll}
          />

          <div className="settings-scroll-shell" ref={settingsScrollShellRef}>
            <div className="settings-content" data-transition-direction={settingsSectionMotionDirection}>
            <SettingSection activeKey={activeSection} icon={MessageSquare} id="general" title={t('settings.nav.general.label')}>
              <SettingSubsectionTitle {...getSettingsSubsection('generalPerformance')} />
              <SettingRow
                id="settings-row-low-spec-mode"
                highlighted={highlightedSettingId === 'settings-row-low-spec-mode'}
                title={settingsLocaleCopy(locale, {
    'zh-CN': '低配置模式',
    'zh-TW': '低配置模式',
    'ja-JP': '低スペックモード',
    'en-US': 'Low-spec mode',
    'ko-KR': 'Low-spec mode',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '降低动画、模糊、可视化、视频壁纸、扫描和后台任务占用。保留原设置，关闭后自动恢复；不会改变音质、音频后端或硬件加速。',
    'zh-TW': '降低動畫、模糊、視覺化、影片桌布、掃描和背景工作佔用。保留原設定，關閉後自動恢復；不會改變音質、音訊後端或硬體加速。',
    'ja-JP': 'アニメーション、ぼかし、視覚化、動画壁紙、スキャン、バックグラウンド処理の負荷を抑えます。元の設定は保持され、音質やオーディオバックエンド、ハードウェアアクセラレーションは変更しません。',
    'en-US': 'Reduces animation, blur, visualizers, video wallpaper, scanning, and background work. Original preferences are preserved; audio quality, audio backends, and hardware acceleration are unchanged.',
    'ko-KR': 'Reduces animation, blur, visualizers, video wallpaper, scanning, and background work. Original preferences are preserved; audio quality, audio backends, and hardware acceleration are unchanged.',
  })}
              >
                <div className="settings-inline-toggle">
                  <span>{appSettings?.lowSpecModeEnabled === true ? t('common.enabled') : t('common.disabled')}</span>
                  <ToggleButton
                    active={appSettings?.lowSpecModeEnabled === true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ lowSpecModeEnabled: appSettings?.lowSpecModeEnabled !== true })}
                  />
                </div>
              </SettingRow>
              <SettingSubsectionTitle id="settings-subsection-language" {...getSettingsSubsection('generalBasics')} />
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
                <button
                  className="settings-action-button settings-first-run-guide-button"
                  type="button"
                  disabled={!appSettings}
                  onClick={handleOpenFirstRunWizard}
                >
                  <BookOpen size={15} />
                  {t('settings.general.firstRunWizard.action')}
                </button>
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
              <SettingSubsectionTitle
                id="settings-subsection-account"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '账户与 Pro',
    'zh-TW': '帳戶與 Pro',
    'ja-JP': 'アカウントと Pro',
    'en-US': 'Account & Pro',
    'ko-KR': 'Account & Pro',
  })}
              />
              <SettingRow
                id="settings-row-echo-pro-activation"
                className="setting-row--credential setting-row--pro-activation"
                highlighted={highlightedSettingId === 'settings-row-echo-pro-activation'}
                title={t('settings.general.echoProActivation.title')}
                description={t('settings.general.echoProActivation.description')}
              >
                <div className="settings-pro-activation-panel" data-expanded={echoProActivationPanelExpanded}>
                  <div className="settings-pro-activation-header">
                    <div className="settings-pro-activation-tags">
                      <span className="list-filter-chip active settings-static-chip">
                        解锁Pro
                      </span>
                      <span className={`list-filter-chip ${echoProUnlockedForStatus ? 'active' : ''}`.trim()}>
                        {echoProPluginUnlockedForStatus ? '本机 Pro 已启用' : echoProAccountStatusForStatus?.pro ? '账号 Pro 已启用' : '待激活'}
                      </span>
                    </div>
                    <div className="settings-pro-activation-header-actions">
                      {echoProPluginUnlockedForStatus ? (
                        <button
                          className="settings-danger-button"
                          type="button"
                          disabled={echoProActivationBusy}
                          onClick={() => void logoutEchoProFromThisComputer()}
                        >
                          <LogOut size={14} aria-hidden="true" />
                          {echoProActivationBusyAction === 'release'
                            ? (locale === 'zh-CN' ? '正在登出…' : 'Signing out…')
                            : (locale === 'zh-CN' ? '登出 Pro' : 'Sign out of Pro')}
                        </button>
                      ) : null}
                      <button
                        className="settings-action-button"
                        type="button"
                        disabled={echoProActivationBusy}
                        onClick={() => void handleOpenExternalUrl(echoProActivationUrl)}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        {t('settings.general.echoProActivation.action')}
                      </button>
                      <button
                        className="settings-action-button settings-account-panel-toggle"
                        type="button"
                        aria-controls="settings-echo-pro-activation-body"
                        aria-expanded={echoProActivationPanelExpanded}
                        aria-label={echoProActivationPanelExpanded ? '折叠 ECHO Pro 激活' : '展开 ECHO Pro 激活'}
                        onClick={toggleEchoProActivationPanelExpanded}
                      >
                        {echoProActivationPanelExpanded ? '折叠' : '展开'}
                        <ChevronDown size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {echoProActivationPanelExpanded ? (
                    <div className="settings-pro-activation-body" id="settings-echo-pro-activation-body">
                      <div className="settings-pro-activation-modes" role="group" aria-label="ECHO Pro activation mode">
                        <button
                          className={`list-filter-chip ${echoProActivationMode === 'afdian' ? 'active' : ''}`.trim()}
                          type="button"
                          disabled={echoProActivationBusy}
                          onClick={() => {
                            setEchoProActivationMode('afdian');
                            setEchoProActivationSecretVisible(false);
                          }}
                        >
                          <MessageSquare size={14} aria-hidden="true" />
                          {locale === 'zh-CN' ? '爱发电订单' : 'Afdian Order'}
                        </button>
                        <button
                          className={`list-filter-chip ${echoProActivationMode === 'key' ? 'active' : ''}`.trim()}
                          type="button"
                          disabled={echoProActivationBusy}
                          onClick={() => {
                            setEchoProActivationMode('key');
                            setEchoProActivationSecretVisible(false);
                          }}
                        >
                          <KeyRound size={14} aria-hidden="true" />
                          Pro Key
                        </button>
                      </div>
                      <div className="settings-pro-activation-fields">
                        <label className="settings-account-cookie-field">
                          <input
                            type="text"
                            aria-label={locale === 'zh-CN' ? '用于核对授权的 QQ 号' : 'QQ number used for verification'}
                            value={echoProActivationQq}
                            autoComplete="off"
                            placeholder={locale === 'zh-CN' ? 'QQ 号' : 'QQ number'}
                            disabled={echoProActivationBusy}
                            onChange={(event) => setEchoProActivationQq(event.target.value)}
                          />
                        </label>
                        <label className="settings-account-cookie-field">
                          <span className="settings-account-field-wrap">
                            <input
                              type={echoProActivationSecretVisible ? 'text' : 'password'}
                              aria-label={echoProActivationMode === 'afdian'
                                ? (locale === 'zh-CN' ? '爱发电订单号' : 'Afdian order ID')
                                : 'ECHO Pro Key'}
                              value={echoProActivationMode === 'afdian' ? echoProActivationOrderId : echoProActivationKey}
                              autoComplete="off"
                              placeholder={echoProActivationMode === 'afdian'
                                ? (locale === 'zh-CN' ? '爱发电订单号' : 'Afdian order ID')
                                : 'ECHO Pro Key'}
                              disabled={echoProActivationBusy}
                              onChange={(event) => {
                                if (echoProActivationMode === 'afdian') {
                                  setEchoProActivationOrderId(event.target.value);
                                } else {
                                  setEchoProActivationKey(event.target.value);
                                }
                              }}
                            />
                            <button
                              className="settings-account-password-toggle"
                              type="button"
                              aria-label={echoProActivationSecretVisible
                                ? t('settings.general.echoProAccount.passwordHide')
                                : t('settings.general.echoProAccount.passwordShow')}
                              aria-pressed={echoProActivationSecretVisible}
                              title={echoProActivationSecretVisible
                                ? t('settings.general.echoProAccount.passwordHide')
                                : t('settings.general.echoProAccount.passwordShow')}
                              disabled={echoProActivationBusy}
                              onClick={() => setEchoProActivationSecretVisible((visible) => !visible)}
                            >
                              {echoProActivationSecretVisible
                                ? <EyeOff size={14} aria-hidden="true" />
                                : <Eye size={14} aria-hidden="true" />}
                            </button>
                          </span>
                        </label>
                      </div>
                      <div className="settings-account-actions settings-pro-activation-actions">
                        <button
                          className="settings-action-button settings-pro-activation-submit"
                          type="button"
                          disabled={echoProActivationBusy || !echoProActivationReady}
                          onClick={() => void activateEchoProPluginInApp()}
                        >
                          <ShieldCheck size={14} aria-hidden="true" />
                          {echoProActivationBusyAction === 'activate'
                            ? (locale === 'zh-CN' ? '正在激活…' : 'Activating…')
                            : echoProActivationBusy
                              ? (locale === 'zh-CN' ? '请稍候…' : 'Please wait…')
                              : (locale === 'zh-CN' ? '激活此设备' : 'Activate this device')}
                        </button>
                        <button
                          className="settings-danger-button"
                          type="button"
                          disabled={echoProActivationBusy || (
                            echoProActivationMode === 'afdian'
                              ? !echoProOrderReleaseReady
                              : !echoProPluginUnlockedForStatus
                          )}
                          onClick={() => void releaseEchoProCurrentDevice()}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {echoProActivationBusyAction === 'release'
                            ? (locale === 'zh-CN' ? '正在解绑…' : 'Releasing…')
                            : echoProActivationBusy
                              ? (locale === 'zh-CN' ? '请稍候…' : 'Please wait…')
                            : echoProActivationMode === 'afdian'
                              ? (locale === 'zh-CN' ? '解绑此订单的设备' : 'Release order devices')
                              : (locale === 'zh-CN' ? '解绑当前电脑' : 'Release this computer')}
                        </button>
                      </div>
                      <p className="settings-inline-note settings-pro-activation-note">
                        {locale === 'zh-CN'
                          ? echoProActivationMode === 'afdian'
                            ? '激活需要 QQ 和订单号；解绑只需要订单号，会释放该订单当前绑定的全部设备。'
                            : '激活需要 QQ 和 Pro Key；解绑只释放当前电脑，其他设备不会受影响。'
                          : echoProActivationMode === 'afdian'
                            ? 'Activation requires QQ and the order ID. Release uses only the order ID and releases every active HWID for that order.'
                            : 'Pro Key release proves the native signed license and raw machine code, releases only this HWID, and permanently removes the local license.'}
                      </p>
                      {echoProMessage ? <p className="settings-inline-note settings-pro-activation-note">{echoProMessage}</p> : null}
                      {echoProError ? <p className="settings-inline-error settings-pro-activation-note">{echoProError}</p> : null}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <div
                className="settings-account-panel settings-echo-pro-account-panel"
                data-expanded={echoProAccountPanelExpanded}
                data-search-highlight={highlightedSettingId === 'settings-row-echo-pro-account' ? 'true' : undefined}
                id="settings-row-echo-pro-account"
              >
                <header className="settings-account-panel-header">
                  <div>
                    <h3>{t('settings.general.echoProAccount.title')}</h3>
                    <p>{t('settings.general.echoProAccount.unavailable')}</p>
                  </div>
                  <div className="settings-account-panel-actions">
                    <span className={`list-filter-chip ${echoProUnlockedForStatus ? 'active' : ''}`}>
                      {echoProPluginUnlockedForStatus ? t('settings.general.echoProAccount.status.pluginUnlocked') : echoProAccountStatusForStatus?.pro ? t('settings.general.echoProAccount.status.proEnabled') : echoProAccountStatusForStatus?.loggedIn ? t('settings.general.echoProAccount.status.proUnauthorized') : t('settings.general.echoProAccount.status.loggedOut')}
                    </span>
                    {echoProMachineCode ? (
                      <span className="settings-hwid-preview" title={echoProMachineCode}>
                        HWID {echoProMachineCode.slice(0, 8)}...{echoProMachineCode.slice(-6)}
                      </span>
                    ) : null}
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void copyEchoProMachineCode()}
                    >
                      {echoProMachineCodeCopied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
                      {echoProMachineCodeCopied ? t('settings.general.echoProAccount.hwidCopied') : t('settings.general.echoProAccount.showHwid')}
                    </button>
                    <button
                      className="settings-action-button settings-account-panel-toggle"
                      type="button"
                      aria-controls="settings-echo-pro-account-body"
                      aria-expanded={echoProAccountPanelExpanded}
                      aria-label={echoProAccountPanelExpanded ? t('settings.general.echoProAccount.collapseAria') : t('settings.general.echoProAccount.expandAria')}
                      onClick={toggleEchoProAccountPanelExpanded}
                    >
                      {echoProAccountPanelExpanded ? t('common.collapse') : t('common.expand')}
                      <ChevronDown size={15} />
                    </button>
                  </div>
                </header>
                {echoProAccountPanelExpanded ? (
                  <div className="settings-account-list settings-echo-pro-account-body" id="settings-echo-pro-account-body">
                    <article className="settings-account-row">
                      <div className="settings-account-summary">
                        <User size={18} aria-hidden="true" />
                        <div>
                          <h3>{echoProAccountStatus?.displayName ?? echoProAccountStatus?.username ?? 'ECHO Pro'}</h3>
                          <p>{echoProAccountStatus?.checkedAt ? t('settings.general.echoProAccount.lastChecked', { time: echoProAccountStatus.checkedAt }) : t('settings.general.echoProAccount.description')}</p>
                        </div>
                      </div>
                      <label className="settings-account-cookie-field">
                        <input
                          type="text"
                          value={echoProUsername}
                          autoComplete="username"
                          placeholder={t('settings.general.echoProAccount.usernamePlaceholder')}
                          disabled={echoProBusyAction !== null}
                          onChange={(event) => setEchoProUsername(event.target.value)}
                        />
                      </label>
                      <label className="settings-account-cookie-field">
                        <span className="settings-account-field-wrap">
                        <input
                          type={echoProPasswordVisible ? 'text' : 'password'}
                          value={echoProPassword}
                          autoComplete={echoProAccountStatus?.loggedIn ? 'current-password' : 'new-password'}
                          placeholder={t('settings.general.echoProAccount.passwordPlaceholder')}
                          disabled={echoProBusyAction !== null}
                          onChange={(event) => setEchoProPassword(event.target.value)}
                          onKeyDown={updateEchoProCapsLock}
                          onKeyUp={updateEchoProCapsLock}
                          onBlur={() => setEchoProCapsLockEnabled(false)}
                        />
                          <button
                            className="settings-account-password-toggle"
                            type="button"
                            aria-label={echoProPasswordVisible ? t('settings.general.echoProAccount.passwordHide') : t('settings.general.echoProAccount.passwordShow')}
                            title={echoProPasswordVisible ? t('settings.general.echoProAccount.passwordHide') : t('settings.general.echoProAccount.passwordShow')}
                            disabled={echoProBusyAction !== null}
                            onClick={() => setEchoProPasswordVisible((visible) => !visible)}
                          >
                            {echoProPasswordVisible ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                          </button>
                        </span>
                        {echoProCapsLockEnabled ? <span className="settings-account-field-warning">{t('settings.general.echoProAccount.capsLock')}</span> : null}
                      </label>
                      <label className="settings-account-cookie-field">
                        <input
                          type="text"
                          value={echoProRedeemKey}
                          autoComplete="off"
                          placeholder="ECHO Pro Key"
                          disabled={echoProBusyAction !== null}
                          onChange={(event) => setEchoProRedeemKey(event.target.value)}
                        />
                      </label>
                      <div className="settings-account-actions">
                        <button className="settings-action-button settings-account-login-button" type="button" disabled={echoProBusyAction !== null} onClick={() => void submitEchoProAccount('login')}>
                          <LogIn size={14} aria-hidden="true" />
                          {echoProBusyAction === 'login' ? t('settings.general.echoProAccount.action.loggingIn') : t('settings.general.echoProAccount.action.login')}
                        </button>
                        <button className="settings-action-button" type="button" disabled={echoProBusyAction !== null} onClick={() => void submitEchoProAccount('register')}>
                          <User size={14} aria-hidden="true" />
                          {echoProBusyAction === 'register' ? t('settings.general.echoProAccount.action.registering') : t('settings.general.echoProAccount.action.register')}
                        </button>
                        <button className="settings-action-button" type="button" disabled={echoProBusyAction !== null} onClick={() => void refreshEchoProAccountStatus({ force: true })}>
                          <RefreshCw size={14} aria-hidden="true" />
                          {echoProBusyAction === 'refresh' ? t('settings.general.echoProAccount.action.checking') : t('settings.general.echoProAccount.action.check')}
                        </button>
                        <button className="settings-action-button" type="button" disabled={echoProBusyAction !== null || !echoProAccountStatus?.loggedIn || echoProRedeemKey.trim().length === 0} onClick={() => void redeemEchoProKey()}>
                          <KeyRound size={14} aria-hidden="true" />
                          {echoProBusyAction === 'redeem' ? t('settings.general.echoProAccount.action.redeeming') : t('settings.general.echoProAccount.action.redeemKey')}
                        </button>
                        <button className="settings-danger-button" type="button" disabled={echoProBusyAction !== null || !echoProAccountStatus?.loggedIn} onClick={() => void logoutEchoProAccount()}>
                          {echoProBusyAction === 'logout' ? t('settings.general.echoProAccount.action.loggingOut') : t('settings.general.echoProAccount.action.logout')}
                        </button>
                        <button className="settings-danger-button" type="button" disabled={echoProBusyAction !== null || !echoProAccountStatus?.loggedIn || echoProPassword.length === 0} onClick={() => void releaseEchoProDevices()}>
                          {echoProBusyAction === 'release-devices' ? t('settings.general.echoProAccount.action.releasingDevices') : t('settings.general.echoProAccount.action.releaseDevices')}
                        </button>
                      </div>
                      <div className="settings-account-meta">
                        <span>{t('settings.general.echoProAccount.developmentNote')}</span>
                        <span>{t('settings.general.echoProAccount.statusLine', { login: echoProAccountStatus?.loggedIn ? t('settings.general.echoProAccount.status.loggedIn') : t('settings.general.echoProAccount.status.loggedOut'), pro: echoProPluginUnlocked ? t('settings.general.echoProAccount.status.pluginUnlocked') : echoProAccountStatus?.pro ? t('settings.general.echoProAccount.status.proValid') : t('settings.general.echoProAccount.status.proUnauthorized') })}</span>
                        <span>{t('settings.general.echoProAccount.deviceLine', { count: echoProAccountStatus?.machineCount ?? 0, max: echoProAccountStatus?.maxMachineCount ?? 2 })}</span>
                        <span>{t('settings.general.echoProAccount.registrationTip')}</span>
                        <span>{t('settings.general.echoProAccount.verificationNote')}</span>
                      </div>
                      <div className="settings-account-meta">
                        <span>{t('settings.general.echoProAccount.localHwid', { hwid: echoProMachineCode ? `${echoProMachineCode.slice(0, 12)}...${echoProMachineCode.slice(-8)}` : t('common.loading') })}</span>
                        <span>{t('settings.general.echoProAccount.hwidNote')}</span>
                      </div>
                      <div className="settings-account-actions">
                        <button className="settings-action-button" type="button" onClick={() => void copyEchoProMachineCode()}>
                          {echoProMachineCodeCopied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
                          {echoProMachineCodeCopied ? t('settings.general.echoProAccount.hwidCopied') : t('settings.general.echoProAccount.copyHwid')}
                        </button>
                      </div>
                      {echoProMessage ? <p className="settings-inline-note settings-account-note">{echoProMessage}</p> : null}
                      {echoProError ? <p className="settings-inline-error settings-account-note">{echoProError}</p> : null}
                    </article>
                  </div>
                ) : null}
              </div>
              <SettingSubsectionTitle id="settings-subsection-window" {...getSettingsSubsection('generalWindow')} />
              <SettingRow
                id="settings-row-close-to-tray"
                highlighted={highlightedSettingId === 'settings-row-close-to-tray'}
                title={t('settings.general.closeToTray')}
              >
                <ToggleButton
                  active={appSettings?.hideToTrayOnClose ?? false}
                  disabled={!appSettings}
                  onClick={handleCloseToTrayToggle}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-launch-at-login"
                highlighted={highlightedSettingId === 'settings-row-launch-at-login'}
                title={t('settings.general.launchAtLogin.title')}
                description={t('settings.general.launchAtLogin.description')}
              >
                <ToggleButton
                  active={appSettings?.launchAtLoginEnabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ launchAtLoginEnabled: !(appSettings?.launchAtLoginEnabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-pet"
                highlighted={highlightedSettingId === 'settings-row-pet'}
                title={t('settings.playback.pet.title')}
                description={t('settings.playback.pet.description')}
              >
                <div className="settings-pet-control">
                  <div className="settings-chip-row">
                    <StatusText tone={appSettings?.petEnabled ? 'good' : 'muted'}>
                      {appSettings?.petEnabled ? t('settings.playback.pet.status.visible') : t('settings.playback.pet.status.hidden')}
                    </StatusText>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!appSettings || !window.echo?.pet}
                      onClick={() => void handlePetVisibleChange(!(appSettings?.petEnabled ?? false))}
                    >
                      <Sparkles size={15} />
                      {appSettings?.petEnabled ? t('settings.playback.pet.action.hide') : t('settings.playback.pet.action.show')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!appSettings || !window.echo?.pet}
                      onClick={() => void handlePetResetBounds()}
                    >
                      <RotateCcw size={15} />
                      {t('pet.action.resetPosition')}
                    </button>
                  </div>
                  <div className="settings-pet-size">
                    <span>{t('settings.playback.pet.size')}</span>
                    <NumberRangeField
                      min={petScalePercentMin}
                      max={petScalePercentMax}
                      step={10}
                      suffix="%"
                      value={appSettings?.petScalePercent ?? defaultPetScalePercent}
                      disabled={!appSettings}
                      onChange={(value) => void handlePetScaleChange(value)}
                    />
                  </div>
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-touch-keyboard"
                highlighted={highlightedSettingId === 'settings-row-touch-keyboard'}
                title={t('settings.general.touchKeyboard.title')}
                description={t('settings.general.touchKeyboard.description')}
              >
                <ToggleButton
                  active={appSettings?.touchOnScreenKeyboardEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      touchOnScreenKeyboardEnabled: !(appSettings?.touchOnScreenKeyboardEnabled ?? false),
                    })
                  }
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
                      sidebarIconOnlyEnabled: appSettings?.sidebarAutoHideEnabled === true ? (appSettings?.sidebarIconOnlyEnabled ?? false) : false,
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                id="settings-row-sidebar-icon-only"
                highlighted={highlightedSettingId === 'settings-row-sidebar-icon-only'}
                title={t('settings.general.sidebarIconOnly.title')}
                description={t('settings.general.sidebarIconOnly.description')}
              >
                <ToggleButton
                  active={appSettings?.sidebarIconOnlyEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      sidebarIconOnlyEnabled: !(appSettings?.sidebarIconOnlyEnabled ?? false),
                      sidebarAutoHideEnabled: appSettings?.sidebarIconOnlyEnabled === true ? (appSettings?.sidebarAutoHideEnabled ?? false) : false,
                    })
                  }
                />
              </SettingRow>
              <SettingSubsectionTitle id="settings-subsection-features" {...getSettingsSubsection('generalFeatures')} />
              <SettingRow
                id="settings-row-streaming-feature"
                highlighted={highlightedSettingId === 'settings-row-streaming-feature'}
                title={t('settings.general.streamingFeature.title')}
                description={t('settings.general.streamingFeature.description')}
              >
                <ToggleButton
                  active={streamingFeatureEnabled}
                  disabled={!appSettings}
                  onClick={handleStreamingFeatureToggle}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-sqlite-balanced-durability"
                highlighted={highlightedSettingId === 'settings-row-sqlite-balanced-durability'}
                title={t('settings.general.sqliteBalancedDurability.title')}
                description={t('settings.general.sqliteBalancedDurability.description')}
              >
                <ToggleButton
                  active={appSettings?.sqliteBalancedDurabilityEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      sqliteBalancedDurabilityEnabled: !(appSettings?.sqliteBalancedDurabilityEnabled ?? false),
                    })
                  }
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
                  {appSettings?.downloadsFeatureKeyAccepted === true ? (
                    <div className="settings-mysterious-key-accepted">
                      <div className="settings-inline-toggle settings-inline-toggle--compact">
                        <span>{downloadsFeatureUnlocked ? 'Accepted' : 'Accepted · Pro required'}</span>
                        {downloadsFeatureUnlocked ? <Check size={16} /> : null}
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
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              description={settingsLocaleCopy(locale, {
    'zh-CN': '让界面在低视力、键盘操作和读屏环境下更清晰、更可控。',
    'zh-TW': '讓介面在低視力、鍵盤操作和螢幕閱讀器環境下更清晰、更可控。',
    'ja-JP': '弱視、キーボード操作、スクリーンリーダー環境で画面を見やすく、操作しやすくします。',
    'en-US': 'Make ECHO clearer and easier to control with low vision, keyboard navigation, and screen readers.',
    'ko-KR': 'Make ECHO clearer and easier to control with low vision, keyboard navigation, and screen readers.',
  })}
              icon={Accessibility}
              id="accessibility"
              title={t('settings.nav.accessibility.label')}
            >
              <SettingRow
                id="settings-row-accessibility-preset"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '一键无障碍预设',
    'zh-TW': '一鍵無障礙預設',
    'ja-JP': 'アクセシビリティプリセット',
    'en-US': 'Accessibility preset',
    'ko-KR': 'Accessibility preset',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '开启减少动画、高对比、130% 界面缩放、强化键盘焦点和播放状态播报。',
    'zh-TW': '開啟減少動畫、高對比、130% 介面縮放、強化鍵盤焦點和播放狀態播報。',
    'ja-JP': 'モーション軽減、高コントラスト、130% 表示、強調フォーカス、再生状態の読み上げを有効にします。',
    'en-US': 'Enables reduced motion, high contrast, 130% UI scale, strong keyboard focus, and playback announcements.',
    'ko-KR': 'Enables reduced motion, high contrast, 130% UI scale, strong keyboard focus, and playback announcements.',
  })}
              >
                <div className="settings-chip-row">
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={!appSettings}
                    onClick={() => handleAccessibilityChange({
                      reduceMotionEnabled: true,
                      highContrastEnabled: true,
                      uiScalePercent: 130,
                      alwaysShowFocusEnabled: true,
                      screenReaderAnnouncementsEnabled: true,
                    })}
                  >
                    <Accessibility size={15} aria-hidden="true" />
                    {settingsLocaleCopy(locale, {
    'zh-CN': '启用推荐预设',
    'zh-TW': '啟用建議預設',
    'ja-JP': '推奨設定を有効化',
    'en-US': 'Enable recommended preset',
    'ko-KR': 'Enable recommended preset',
  })}
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={!appSettings}
                    onClick={() => handleAccessibilityChange(defaultAccessibilityPreferences)}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    {settingsLocaleCopy(locale, {
    'zh-CN': '恢复默认',
    'zh-TW': '恢復預設',
    'ja-JP': '既定値に戻す',
    'en-US': 'Restore defaults',
    'ko-KR': 'Restore defaults',
  })}
                  </button>
                </div>
              </SettingRow>

              <SettingRow
                id="settings-row-accessibility-reduce-motion"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '减少动态效果',
    'zh-TW': '減少動態效果',
    'ja-JP': 'モーションを減らす',
    'en-US': 'Reduce motion',
    'ko-KR': 'Reduce motion',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '关闭界面转场、滚动动画和动态视频背景；不影响音频播放。',
    'zh-TW': '關閉介面轉場、捲動動畫和動態影片背景；不影響音訊播放。',
    'ja-JP': '画面遷移、スクロールアニメーション、動画背景を停止します。音声再生には影響しません。',
    'en-US': 'Stops transitions, animated scrolling, and video backgrounds without changing audio playback.',
    'ko-KR': 'Stops transitions, animated scrolling, and video backgrounds without changing audio playback.',
  })}
              >
                <ToggleButton
                  active={accessibilityPreferences.reduceMotionEnabled}
                  ariaLabel={settingsLocaleCopy(locale, {
    'zh-CN': '减少动态效果',
    'zh-TW': '減少動態效果',
    'ja-JP': 'モーションを減らす',
    'en-US': 'Reduce motion',
    'ko-KR': 'Reduce motion',
  })}
                  disabled={!appSettings}
                  onClick={() => handleAccessibilityChange({ reduceMotionEnabled: !accessibilityPreferences.reduceMotionEnabled })}
                />
              </SettingRow>

              <SettingRow
                id="settings-row-accessibility-high-contrast"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '高对比度',
    'zh-TW': '高對比度',
    'ja-JP': '高コントラスト',
    'en-US': 'High contrast',
    'ko-KR': 'High contrast',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '增强文字、边框和面板对比，并移除主要区域的透明模糊效果。',
    'zh-TW': '增強文字、邊框和面板對比，並移除主要區域的透明模糊效果。',
    'ja-JP': '文字、境界線、パネルのコントラストを高め、主要部分の透明ぼかしを除去します。',
    'en-US': 'Strengthens text, borders, and panels while removing translucent blur from key areas.',
    'ko-KR': 'Strengthens text, borders, and panels while removing translucent blur from key areas.',
  })}
              >
                <ToggleButton
                  active={accessibilityPreferences.highContrastEnabled}
                  ariaLabel={settingsLocaleCopy(locale, {
    'zh-CN': '高对比度',
    'zh-TW': '高對比度',
    'ja-JP': '高コントラスト',
    'en-US': 'High contrast',
    'ko-KR': 'High contrast',
  })}
                  disabled={!appSettings}
                  onClick={() => handleAccessibilityChange({ highContrastEnabled: !accessibilityPreferences.highContrastEnabled })}
                />
              </SettingRow>

              <SettingRow
                id="settings-row-accessibility-scale"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '界面缩放',
    'zh-TW': '介面縮放',
    'ja-JP': 'UI の拡大率',
    'en-US': 'UI scale',
    'ko-KR': 'UI scale',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '同时放大文字、按钮和点击区域。',
    'zh-TW': '同時放大文字、按鈕和點擊區域。',
    'ja-JP': '文字、ボタン、クリック領域をまとめて拡大します。',
    'en-US': 'Scales text, controls, and hit targets together.',
    'ko-KR': 'Scales text, controls, and hit targets together.',
  })}
              >
                <div className="settings-chip-row" role="group" aria-label={settingsLocaleCopy(locale, {
    'zh-CN': '界面缩放比例',
    'zh-TW': '介面縮放比例',
    'ja-JP': 'UI の拡大率',
    'en-US': 'UI scale percentage',
    'ko-KR': 'UI scale percentage',
  })}>
                  {([100, 115, 130, 150] as const).map((uiScalePercent) => (
                    <ChipButton
                      active={accessibilityPreferences.uiScalePercent === uiScalePercent}
                      disabled={!appSettings}
                      key={uiScalePercent}
                      onClick={() => handleAccessibilityChange({ uiScalePercent })}
                    >
                      {`${uiScalePercent}%`}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>

              <SettingRow
                id="settings-row-accessibility-focus"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '始终显示键盘焦点',
    'zh-TW': '永遠顯示鍵盤焦點',
    'ja-JP': 'キーボードフォーカスを常に表示',
    'en-US': 'Always show keyboard focus',
    'ko-KR': 'Always show keyboard focus',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '用高亮轮廓明确显示 Tab 键当前所在位置。',
    'zh-TW': '用醒目輪廓明確顯示 Tab 鍵目前所在位置。',
    'ja-JP': 'Tab キーで現在選択されている場所を強い輪郭で示します。',
    'en-US': 'Uses a strong outline to show exactly where Tab navigation is focused.',
    'ko-KR': 'Uses a strong outline to show exactly where Tab navigation is focused.',
  })}
              >
                <ToggleButton
                  active={accessibilityPreferences.alwaysShowFocusEnabled}
                  ariaLabel={settingsLocaleCopy(locale, {
    'zh-CN': '始终显示键盘焦点',
    'zh-TW': '永遠顯示鍵盤焦點',
    'ja-JP': 'キーボードフォーカスを常に表示',
    'en-US': 'Always show keyboard focus',
    'ko-KR': 'Always show keyboard focus',
  })}
                  disabled={!appSettings}
                  onClick={() => handleAccessibilityChange({ alwaysShowFocusEnabled: !accessibilityPreferences.alwaysShowFocusEnabled })}
                />
              </SettingRow>

              <SettingRow
                id="settings-row-accessibility-announcements"
                title={settingsLocaleCopy(locale, {
    'zh-CN': '播报播放状态',
    'zh-TW': '播報播放狀態',
    'ja-JP': '再生状態を読み上げる',
    'en-US': 'Announce playback status',
    'ko-KR': 'Announce playback status',
  })}
                description={settingsLocaleCopy(locale, {
    'zh-CN': '让读屏器播报切歌、播放和暂停；不会逐句朗读歌词。',
    'zh-TW': '讓螢幕閱讀器播報切歌、播放和暫停；不會逐句朗讀歌詞。',
    'ja-JP': '曲の切り替え、再生、一時停止を読み上げます。歌詞は一行ずつ読み上げません。',
    'en-US': 'Lets screen readers announce track changes, play, and pause without reading every lyric line.',
    'ko-KR': 'Lets screen readers announce track changes, play, and pause without reading every lyric line.',
  })}
              >
                <ToggleButton
                  active={accessibilityPreferences.screenReaderAnnouncementsEnabled}
                  ariaLabel={settingsLocaleCopy(locale, {
    'zh-CN': '播报播放状态',
    'zh-TW': '播報播放狀態',
    'ja-JP': '再生状態を読み上げる',
    'en-US': 'Announce playback status',
    'ko-KR': 'Announce playback status',
  })}
                  disabled={!appSettings}
                  onClick={() => handleAccessibilityChange({ screenReaderAnnouncementsEnabled: !accessibilityPreferences.screenReaderAnnouncementsEnabled })}
                />
              </SettingRow>
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              description={settingsLocaleCopy(locale, {
    'zh-CN': '预览仍在验证中的功能；每项都可单独关闭并安全回退。',
    'zh-TW': '預覽仍在驗證中的功能；每項都可單獨關閉並安全回退。',
    'ja-JP': '検証中の機能を試せます。各機能は個別に無効化でき、安全にフォールバックします。',
    'en-US': 'Preview features still under validation. Each can be disabled independently with a safe fallback.',
    'ko-KR': 'Preview features still under validation. Each can be disabled independently with a safe fallback.',
  })}
              icon={FlaskConical}
              id="experimental"
              title={t('settings.nav.experimental.label')}
            >
              <SettingSubsectionTitle {...getSettingsSubsection('experimentalVisual')} />
              <SettingRow
                id="settings-row-window-acrylic"
                highlighted={highlightedSettingId === 'settings-row-window-acrylic'}
                title={
                  <span className="settings-title-with-badge">
                    <span>{t('settings.appearance.windowAcrylic.title')}</span>
                    <small aria-hidden="true">ECHO Pro</small>
                  </span>
                }
                description={
                  <span className="settings-experimental-description">
                    <span>{settingsLocaleCopy(locale, experimentalLabCopy.windowAcrylicDescription)}</span>
                    {appSettings?.appWindowAcrylicEnabled === true ? <em>{t('settings.appearance.windowAcrylic.themeWarning')}</em> : null}
                  </span>
                }
              >
                <div className="settings-acrylic-control">
                  <ToggleButton
                    active={appSettings?.appWindowAcrylicEnabled === true}
                    disabled={!appSettings || (appSettings.appWindowAcrylicEnabled !== true && !echoProUnlockedForDisplay)}
                    onClick={handleWindowAcrylicToggle}
                  />
                  {appSettings?.appWindowAcrylicEnabled === true ? (
                    <div className="settings-acrylic-options">
                      <div className="settings-acrylic-subtoggle">
                        <span>{t('settings.appearance.windowAcrylic.keepWhenUnfocused')}</span>
                        <ToggleButton
                          active={appSettings.appWindowAcrylicKeepWhenUnfocusedEnabled === true}
                          disabled={!echoProUnlockedForDisplay}
                          onClick={handleWindowAcrylicKeepWhenUnfocusedToggle}
                        />
                      </div>
                      <div className="settings-acrylic-slider">
                        <span>{t('settings.appearance.windowAcrylic.transparency')}</span>
                        <NumberRangeField
                          min={0}
                          max={100}
                          step={1}
                          suffix="%"
                          value={appSettings.appWindowAcrylicTransparencyPercent ?? 70}
                          disabled={!echoProUnlockedForDisplay}
                          onChange={handleWindowAcrylicTransparencyChange}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <div className="settings-experimental-subsection-heading">
                <SettingSubsectionTitle {...getSettingsSubsection('experimentalPerformance')} />
                <span>{settingsLocaleCopy(locale, {
    'zh-CN': '实验功能可能影响稳定性',
    'zh-TW': '實驗功能可能影響穩定性',
    'ja-JP': '実験機能は安定性に影響する場合があります',
    'en-US': 'Experimental features may affect stability',
    'ko-KR': 'Experimental features may affect stability',
  })}</span>
              </div>
              <div
                className="settings-performance-group"
                id="settings-row-performance"
                data-search-highlight={
                  highlightedSettingId === 'settings-row-performance' ||
                  highlightedSettingId === 'settings-row-low-load-playback' ||
                  highlightedSettingId === 'settings-row-album-wall-virtualization' ||
                  highlightedSettingId === 'settings-row-native-direct-local-playback'
                    ? 'true'
                    : undefined
                }
              >
                <div className="settings-performance-toggle-list">
                  <div className="settings-performance-toggle" id="settings-row-low-load-playback">
                    <span>
                      <strong>{t('audioDrawer.option.lowLoadPlaybackMode')}</strong>
                      <small>{settingsLocaleCopy(locale, experimentalLabCopy.lowLoadDescription)}</small>
                    </span>
                    <ToggleButton
                      active={appSettings?.lowLoadPlaybackModeEnabled === true}
                      disabled={!appSettings}
                      onClick={() =>
                        patchAppSettings({
                          lowLoadPlaybackModeEnabled: appSettings?.lowLoadPlaybackModeEnabled !== true,
                        })
                      }
                    />
                  </div>
                  <div className="settings-performance-toggle" id="settings-row-album-wall-virtualization">
                    <span>
                      <strong>{settingsLocaleCopy(locale, experimentalLabCopy.albumWallTitle)}</strong>
                      <small>{settingsLocaleCopy(locale, experimentalLabCopy.albumWallDescription)}</small>
                    </span>
                    <ToggleButton
                      active={appSettings?.albumWallVirtualizationEnabled ?? false}
                      disabled={!appSettings}
                      onClick={handleAlbumWallVirtualizationToggle}
                    />
                  </div>
                  <div className="settings-performance-toggle" id="settings-row-native-direct-local-playback">
                    <span>
                      <strong>{settingsLocaleCopy(locale, experimentalLabCopy.nativeDirectTitle)}</strong>
                      <small>{settingsLocaleCopy(locale, experimentalLabCopy.nativeDirectDescription)}</small>
                    </span>
                    <ToggleButton
                      active={appSettings?.audioNativeDirectLocalPlaybackEnabled === true}
                      disabled={!appSettings}
                      onClick={() => void handleNativeDirectLocalPlaybackToggle()}
                    />
                  </div>
                </div>
              </div>
              <SettingRow
                id="settings-row-scan-performance"
                highlighted={highlightedSettingId === 'settings-row-scan-performance'}
                title={t('mediaLibrary.settings.scanPerformance.title')}
                description={t('mediaLibrary.settings.scanPerformance.description')}
              >
                <div className="settings-chip-row">
                  {[
                    ['low', t('mediaLibrary.settings.scanPerformance.low')],
                    ['balanced', t('mediaLibrary.settings.scanPerformance.balanced')],
                    ['performance', t('mediaLibrary.settings.scanPerformance.performance')],
                    ['ultra', t('mediaLibrary.settings.scanPerformance.ultra')],
                  ].map(([mode, label]) => (
                    <ChipButton
                      active={(appSettings?.scanPerformanceMode ?? 'balanced') === mode}
                      disabled={!appSettings}
                      key={mode}
                      onClick={() => patchAppSettings({ scanPerformanceMode: mode as AppSettings['scanPerformanceMode'] })}
                    >
                      {label}
                    </ChipButton>
                  ))}
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('experimentalFeatures')} />
              {advancedNativeOutputAvailable ? (
                <SettingRow
                  id="settings-row-dsd-passthrough"
                  highlighted={highlightedSettingId === 'settings-row-dsd-passthrough'}
                  title={t('settings.playback.dsdDop.title')}
                  description={t('settings.playback.dsdDop.description')}
                >
                  <ToggleButton
                    active={appSettings?.audioDsdOutputMode !== 'pcm'}
                    disabled={!appSettings}
                    onClick={() => void handleDsdDopToggle()}
                  />
                </SettingRow>
              ) : null}
              <SettingRow
                id="settings-row-native-file-scanner"
                highlighted={highlightedSettingId === 'settings-row-native-file-scanner'}
                title={
                  <span className="settings-title-with-badge">
                    <span>Native File Scanner</span>
                    <small aria-hidden="true" className="settings-title-status">{appSettings?.nativeFileScannerEnabled ? t('common.enabled') : t('common.disabled')}</small>
                  </span>
                }
                description={settingsLocaleCopy(locale, experimentalLabCopy.nativeFileScannerDescription)}
              >
                <div className="settings-native-experiment-control">
                  <div
                    className="settings-native-experiment-status"
                    data-state={nativeFileScannerState}
                    title={nativeFileScannerDiagnostics?.binaryPath ?? undefined}
                  >
                    <span>{nativeFileScannerStatusText}</span>
                    <em>{nativeFileScannerStatsText}</em>
                    {nativeFileScannerCapabilitiesText ? <em>{nativeFileScannerCapabilitiesText}</em> : null}
                  </div>
                  <ToggleButton
                    active={appSettings?.nativeFileScannerEnabled === true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ nativeFileScannerEnabled: !(appSettings?.nativeFileScannerEnabled ?? false) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-native-metadata-reader"
                highlighted={highlightedSettingId === 'settings-row-native-metadata-reader'}
                title={
                  <span className="settings-title-with-badge">
                    <span>Native Metadata Reader</span>
                    <small aria-hidden="true" className="settings-title-status">{appSettings?.nativeMetadataReaderEnabled ? t('common.enabled') : t('common.disabled')}</small>
                  </span>
                }
                description={settingsLocaleCopy(locale, experimentalLabCopy.nativeMetadataReaderDescription)}
              >
                <div className="settings-native-experiment-control">
                  <div
                    className="settings-native-experiment-status"
                    data-state={nativeMetadataReaderState}
                    title={nativeMetadataReaderDiagnostics?.binaryPath ?? undefined}
                  >
                    <span>{nativeMetadataReaderStatusText}</span>
                    <em>{nativeMetadataReaderStatsText}</em>
                    {nativeMetadataReaderCapabilitiesText ? <em>{nativeMetadataReaderCapabilitiesText}</em> : null}
                  </div>
                  <ToggleButton
                    active={appSettings?.nativeMetadataReaderEnabled === true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ nativeMetadataReaderEnabled: !(appSettings?.nativeMetadataReaderEnabled ?? false) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-osu-downloader-feature"
                highlighted={highlightedSettingId === 'settings-row-osu-downloader-feature'}
                title={t('settings.general.osuDownloaderFeature.title')}
                description={t('settings.general.osuDownloaderFeature.description')}
              >
                <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                  <ToggleButton
                    active={osuDownloaderFeatureEnabled}
                    disabled={!appSettings}
                    onClick={() => applyOsuDownloaderFeatureEnabled(!osuDownloaderFeatureEnabled)}
                  />
                  {osuDownloaderFeatureEnabled && osuDownloaderSidebarHidden ? (
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={showOsuDownloaderInSidebar}>
                      显示在侧栏
                    </button>
                  ) : null}
                </div>
              </SettingRow>
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Gauge} id="advancedCustom" title={t('settings.nav.advancedCustom.label')}>
              <SettingSubsectionTitle {...getSettingsSubsection('advancedInterface')} />
              <SettingRow
                id="settings-row-settings-optional-sections"
                highlighted={highlightedSettingId === 'settings-row-settings-optional-sections'}
                title={t('settings.general.settingsOptionalSections.title')}
                description={t('settings.general.settingsOptionalSections.description')}
              >
                <ToggleButton
                  active={appSettings?.settingsOptionalSectionsVisible === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ settingsOptionalSectionsVisible: !(appSettings?.settingsOptionalSectionsVisible ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-track-context-menu-extra-actions"
                highlighted={highlightedSettingId === 'settings-row-track-context-menu-extra-actions'}
                title={t('settings.general.trackContextMenuExtraActions.title')}
                description={t('settings.general.trackContextMenuExtraActions.description')}
              >
                <div className="settings-inline-toggle settings-inline-toggle--compact">
                  <span>{appSettings?.trackContextMenuExtraActionsEnabled ? '已显示' : '已隐藏'}</span>
                  <ToggleButton
                    active={appSettings?.trackContextMenuExtraActionsEnabled === true}
                    disabled={!appSettings}
                    onClick={() =>
                      patchAppSettings({
                        trackContextMenuExtraActionsEnabled: !(appSettings?.trackContextMenuExtraActionsEnabled ?? false),
                      })
                    }
                  />
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('advancedPerformance')} />
              <SettingSubsectionTitle {...getSettingsSubsection('advancedVisuals')} />
              <SettingRow
                id="settings-row-remember-window-size"
                highlighted={highlightedSettingId === 'settings-row-remember-window-size'}
                title={t('settings.general.rememberWindowSize.title')}
                description={t('settings.general.rememberWindowSize.description')}
              >
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
                id="settings-row-signal-path-control"
                highlighted={highlightedSettingId === 'settings-row-signal-path-control'}
                title={t('settings.general.signalPathControl.title')}
                description={t('settings.general.signalPathControl.description')}
              >
                <ToggleButton
                  active={signalPathControlEnabled}
                  disabled={signalPathControlSaving || !appSettings}
                  onClick={() => applySignalPathControlEnabled(signalPathControlToggleTarget)}
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
                id="settings-row-lyrics-mv-graphics-pressure-guard"
                highlighted={highlightedSettingId === 'settings-row-lyrics-mv-graphics-pressure-guard'}
                title={t('settings.general.lyricsMvGraphicsPressureGuard.title')}
                description={t('settings.general.lyricsMvGraphicsPressureGuard.description')}
              >
                <ToggleButton
                  active={appSettings?.lyricsMvGraphicsPressureGuardEnabled === true}
                  disabled={!appSettings}
                  onClick={() =>
                    patchAppSettings({
                      lyricsMvGraphicsPressureGuardEnabled: !(appSettings?.lyricsMvGraphicsPressureGuardEnabled ?? false),
                    })
                  }
                />
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('advancedFeedback')} />
              <SettingRow
                id="settings-row-notifications-disabled"
                highlighted={highlightedSettingId === 'settings-row-notifications-disabled'}
                title={t('settings.general.notificationsDisabled.title')}
                description={t('settings.general.notificationsDisabled.description')}
              >
                <ToggleButton
                  active={appSettings?.notificationsDisabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ notificationsDisabled: !(appSettings?.notificationsDisabled ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-upcoming-track-notice"
                highlighted={highlightedSettingId === 'settings-row-upcoming-track-notice'}
                title={t('settings.general.upcomingTrackNotice.title')}
                description={t('settings.general.upcomingTrackNotice.description')}
              >
                <ToggleButton
                  active={appSettings?.upcomingTrackNoticeEnabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ upcomingTrackNoticeEnabled: !(appSettings?.upcomingTrackNoticeEnabled ?? false) })}
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
              <SettingSubsectionTitle {...getSettingsSubsection('advancedSafety')} />
              <SettingRow
                id="settings-row-data-protection-disabled"
                highlighted={highlightedSettingId === 'settings-row-data-protection-disabled'}
                title="关闭数据保护"
                description="默认开启此开关：不执行启动、后台、扫描完成和更新前的数据保护快照；仍保留只读健康检查，异常曲库会停止写入。"
              >
                <ToggleButton
                  active={appSettings?.dataProtectionDisabled === true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ dataProtectionDisabled: !(appSettings?.dataProtectionDisabled ?? true) })}
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
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Zap} id="playback" title={t('settings.nav.playback.label')}>
              <SettingSubsectionTitle {...getSettingsSubsection('playbackOutput')} />
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.playback.automaticOutput.title')}
                description={t('settings.playback.automaticOutput.description')}
              >
                <div className="settings-output-mode-control">
                  <ToggleButton
                    active={appSettings?.audioAutomaticOutputEnabled === true}
                    disabled={!appSettings || automaticOutputBusy}
                    onClick={() => void handleAutomaticOutputToggle()}
                  />
                  <StatusText tone={status?.automaticOutputStage === 'system-required' || status?.automaticOutputStage === 'failed' ? 'muted' : 'good'}>
                    {automaticOutputStageMessage}
                  </StatusText>
                </div>
              </SettingRow>
              <SettingRow
                id="settings-row-no-sound-guide"
                highlighted={highlightedSettingId === 'settings-row-no-sound-guide'}
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.playback.audioDrawerNotice.title')}
                description={t('settings.playback.audioDrawerNotice.description')}
              >
                <div className="settings-audio-notice-actions">
                  <StatusText tone="muted">{t('settings.playback.audioDrawerNotice.status')}</StatusText>
                  <button
                    className="settings-action-button settings-no-sound-guide-button"
                    type="button"
                    onClick={openNoSoundGuide}
                  >
                    <VolumeX size={15} />
                    {t('settings.playback.noSoundGuide.action')}
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('settings.playback.recommendedPath.title')}
                description={t('settings.playback.recommendedPath.description')}
              >
                <div className="settings-playback-recommended-path" role="list">
                  <span role="listitem">
                    <strong>{t('settings.playback.recommendedPath.shared.title')}</strong>
                    <em>{t('settings.playback.recommendedPath.shared.body')}</em>
                  </span>
                  <span role="listitem">
                    <strong>{t('settings.playback.recommendedPath.device.title')}</strong>
                    <em>{t('settings.playback.recommendedPath.device.body')}</em>
                  </span>
                  <span role="listitem">
                    <strong>{t('settings.playback.recommendedPath.advanced.title')}</strong>
                    <em>{t('settings.playback.recommendedPath.advanced.body')}</em>
                  </span>
                </div>
              </SettingRow>
              <SettingRow title={t('settings.playback.outputMode.title')} description={t('settings.playback.outputMode.description')}>
                <div className="settings-output-mode-control">
                  <div className="settings-chip-row">
                    {playbackOutputModesForPlatform.map((mode) => (
                      <ChipButton active={outputMode === mode} disabled={appSettings?.audioAutomaticOutputEnabled === true} key={mode} onClick={() => handleOutputModeChange(mode)}>
                        {getPlaybackOutputModeLabel(mode, t, rendererPlatform)}
                      </ChipButton>
                    ))}
                  </div>
                  {playbackSettingsMessage ? <StatusText tone={error ? 'muted' : 'good'}>{playbackSettingsMessage}</StatusText> : null}
                </div>
              </SettingRow>
              {sharedBackendOptionsForPlatform.length > 0 ? (
                <SettingRow title={t('settings.playback.sharedBackend.title')} description={t(getSharedBackendDescriptionKey(rendererPlatform))}>
                  <div className="settings-chip-row">
                    {sharedBackendOptionsForPlatform.map(([backend, labelKey]) => (
                      <ChipButton active={outputMode === 'shared' && sharedBackend === backend} disabled={appSettings?.audioAutomaticOutputEnabled === true} key={backend} onClick={() => handleSharedBackendChange(backend)}>
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
                  disabled={compatibleDevices.length === 0 || appSettings?.audioAutomaticOutputEnabled === true}
                  showFilterIcon={false}
                />
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('playbackPerformance')} />
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
              <SettingSubsectionTitle {...getSettingsSubsection('playbackMore')} />
              <SettingRow
                className={`setting-row--full setting-row--compact-panel setting-row--playback-advanced${playbackAdvancedPanelExpanded ? ' is-expanded' : ''}`}
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
                <div className="settings-expanded-panel settings-expanded-panel--playback">
              <SettingSubsectionTitle {...getSettingsSubsection('playbackRecovery')} />
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
              <SettingSubsectionTitle {...getSettingsSubsection('playbackCompatibility')} />
              {advancedNativeOutputAvailable ? (
                <>
              <SettingRow title={t('audioDrawer.guard.exclusiveInstability.title')} description={t('audioDrawer.guard.exclusiveInstability.description')}>
                <ToggleButton
                  active={appSettings?.audioExclusiveInstabilityFallbackEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() => void handleExclusiveInstabilityFallbackToggle()}
                />
              </SettingRow>
                </>
              ) : null}
              <SettingRow
                id="settings-row-soxr-fallback"
                highlighted={highlightedSettingId === 'settings-row-soxr-fallback'}
                title={t('audioDrawer.guard.soxrFallback.title')}
                description={t('audioDrawer.guard.soxrFallback.description')}
              >
                <ToggleButton
                  active={appSettings?.audioSoxrFallbackEnabled ?? true}
                  disabled={!appSettings}
                  onClick={() => void handleSoxrFallbackToggle()}
                />
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('playbackControls')} />
              <SettingRow
                id="settings-row-prevent-sleep-while-playing"
                highlighted={highlightedSettingId === 'settings-row-prevent-sleep-while-playing'}
                title={t('settings.playback.preventSleepWhilePlaying.title')}
                description={t('settings.playback.preventSleepWhilePlaying.description')}
              >
                <ToggleButton
                  active={appSettings?.preventSleepWhilePlaying ?? false}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ preventSleepWhilePlaying: !(appSettings?.preventSleepWhilePlaying ?? false) })}
                />
              </SettingRow>
              <SettingRow
                id="settings-row-auto-play-on-startup"
                highlighted={highlightedSettingId === 'settings-row-auto-play-on-startup'}
                title={t('settings.playback.autoPlayOnStartup.title')}
                description={t('settings.playback.autoPlayOnStartup.description')}
              >
                <ToggleButton
                  active={appSettings?.autoPlayOnStartup ?? false}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ autoPlayOnStartup: !(appSettings?.autoPlayOnStartup ?? false) })}
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
              <SettingSubsectionTitle {...getSettingsSubsection('playbackInterface')} />
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
              <SettingSubsectionTitle {...getSettingsSubsection('playbackTransitions')} />
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
                id="settings-row-shuffle-credibility"
                highlighted={highlightedSettingId === 'settings-row-shuffle-credibility'}
                title={t('settings.playback.shuffleCredibility.title')}
                description={t('settings.playback.shuffleCredibility.description')}
              >
                <div className="settings-chip-row">
                  {shufflePlaybackModeOptions.map((option) => (
                    <ChipButton
                      key={option.id}
                      active={shufflePlaybackModeId === option.id}
                      disabled={!appSettings}
                      title={t(option.descriptionKey)}
                      onClick={() => patchAppSettings({ playbackShuffleAvoidRecentCount: option.avoidRecentCount })}
                    >
                      {t(option.labelKey)}
                    </ChipButton>
                  ))}
                  <StatusText tone="muted">
                    {shufflePlaybackModeStatus}
                  </StatusText>
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('playbackLoudness')} />
              <SettingRow
                id="settings-row-volume-balance"
                highlighted={highlightedSettingId === 'settings-row-volume-balance'}
                title={t('settings.playback.replayGain.title')}
                description={t('settings.playback.replayGain.description')}
              >
                <ToggleButton
                  active={appSettings?.replayGainEnabled ?? false}
                  disabled={!appSettings}
                  onClick={() => handleReplayGainEnabledChange(!(appSettings?.replayGainEnabled ?? false))}
                />
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
              <SettingSubsectionTitle {...getSettingsSubsection('playbackDiagnostics')} />
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
                </div>
              ) : null}
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              context={settingsLocaleCopy(locale, {
    'zh-CN': '设置 / 高级',
    'zh-TW': '設定 / 進階',
    'ja-JP': '設定 / 詳細',
    'en-US': 'Settings / Advanced',
    'ko-KR': 'Settings / Advanced',
  })}
              description={settingsLocaleCopy(locale, {
    'zh-CN': '配置播放器在窗口内与系统全局的按键操作。',
    'zh-TW': '設定播放器在視窗內與系統全域的按鍵操作。',
    'ja-JP': 'アプリ内とシステム全体のキーボード操作を設定します。',
    'en-US': 'Configure in-app and system-wide player controls.',
    'ko-KR': 'Configure in-app and system-wide player controls.',
  })}
              icon={Keyboard}
              id="shortcuts"
              title={t('settings.nav.shortcuts.label')}
            >
              <SettingSubsectionTitle id="settings-shortcuts-profile" {...getSettingsSubsection('shortcutsMain')} />
              <div className="settings-shortcut-profile">
                <span className="settings-shortcut-profile-icon" aria-hidden="true">
                  <Keyboard size={19} />
                </span>
                <div className="settings-shortcut-profile-copy">
                  <div>
                    <strong>
                      {settingsLocaleCopy(locale, {
    'zh-CN': '默认方案',
    'zh-TW': '預設方案',
    'ja-JP': 'デフォルト',
    'en-US': 'Default profile',
    'ko-KR': 'Default profile',
  })}
                    </strong>
                    <span>
                      {settingsLocaleCopy(locale, {
    'zh-CN': '当前方案',
    'zh-TW': '目前方案',
    'ja-JP': '使用中',
    'en-US': 'Current',
    'ko-KR': 'Current',
  })}
                    </span>
                  </div>
                  <div className="settings-shortcut-toolbar-actions">
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => handleShortcutRecommendedReset('local')}>
                      {t('settings.shortcuts.action.restoreLocalRecommended')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => handleShortcutRecommendedReset('global')}>
                      {t('settings.shortcuts.action.restoreGlobalRecommended')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={!appSettings} onClick={() => handleShortcutRecommendedReset('all')}>
                      {t('settings.shortcuts.action.restoreRecommended')}
                    </button>
                  </div>
                  <div className="settings-shortcut-summary" aria-label={t('settings.shortcuts.summary.aria')}>
                    <span>{t('settings.shortcuts.summary.localEnabled', { count: shortcutSummary.localEnabled })}</span>
                    <span>{t('settings.shortcuts.summary.globalEnabled', { count: shortcutSummary.globalEnabled })}</span>
                    <span>{t('settings.shortcuts.summary.unbound', { count: shortcutSummary.unbound })}</span>
                    <span className={shortcutSummary.issues > 0 ? 'is-warning' : ''}>
                      {t('settings.shortcuts.summary.issues', { count: shortcutSummary.issues })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="settings-shortcut-toolbar">
                  <div className="settings-shortcut-filter" role="group" aria-label={t('settings.shortcuts.filter.aria')}>
                    {shortcutFilterOptions.map((option) => (
                      <ChipButton
                        active={shortcutFilter === option.filter}
                        key={option.filter}
                        onClick={() => setShortcutFilter(option.filter)}
                      >
                        {t(option.labelKey)}
                      </ChipButton>
                    ))}
                  </div>
                  <p className="settings-inline-note">{t('settings.shortcuts.note')}</p>
              </div>
              <SettingSubsectionTitle id="settings-shortcuts-bindings" {...getSettingsSubsection('shortcutsBindings')} />
              <div className="setting-row setting-row--shortcut setting-row--shortcut-header">
                <span>{t('settings.shortcuts.column.function')}</span>
                <span>{t('settings.shortcuts.column.local')}</span>
                <span>{t('settings.shortcuts.column.global')}</span>
              </div>
              {filteredShortcutActionMeta.length === 0 ? (
                <p className="settings-shortcut-empty">{t('settings.shortcuts.filter.empty')}</p>
              ) : null}
              {filteredShortcutActionMeta.map((item) => {
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
                    <span className="settings-shortcut-scope-label">{t(`settings.shortcuts.scope.${scope}` as TranslationKey)}</span>
                    <button
                      className={`settings-shortcut-key ${isRecording ? 'is-recording' : ''}`}
                      type="button"
                      aria-label={t('settings.shortcuts.action.record')}
                      disabled={!appSettings}
                      title={t('settings.shortcuts.action.record')}
                      onClick={() => setRecordingShortcutTarget({ scope, action: item.action })}
                    >
                      {isRecording
                        ? t('settings.shortcuts.recording')
                        : formatAcceleratorForDisplay(binding.accelerator, t('settings.shortcuts.empty'))}
                    </button>
                    <div className="settings-shortcut-actions">
                      <button
                        className="settings-icon-button settings-shortcut-clear"
                        type="button"
                        aria-label={t('settings.shortcuts.action.clear')}
                        disabled={!appSettings || !binding.accelerator}
                        title={t('settings.shortcuts.action.clear')}
                        onClick={() => handleShortcutClear(scope, item.action)}
                      >
                        <X size={14} />
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
                    leadingIcon={shortcutActionIcons[item.action] ?? KeyRound}
                    title={t(item.titleKey)}
                    description={t(item.descriptionKey)}
                  >
                    {localUnavailable ? (
                      <div className="settings-shortcut-unavailable" role="group" aria-label={t('settings.shortcuts.scope.local')}>
                        <span className="settings-shortcut-scope-label">{t('settings.shortcuts.scope.local')}</span>
                        <span>{t('settings.shortcuts.localUnavailable')}</span>
                      </div>
                    ) : renderShortcutControl('local', localBinding, isLocalRecording, localMessage)}
                    {renderShortcutControl('global', globalBinding, isGlobalRecording, globalMessage)}
                  </SettingRow>
                );
              })}
            </SettingSection>

            <LyricsSettingsSection
              activeKey={activeSection}
              getSubsection={getSettingsSubsection}
              highlightedSettingId={highlightedSettingId}
              t={t}
            />

            <SettingSection activeKey={activeSection} icon={Clapperboard} id="mv" title={t('route.mvSettings.label')}>
              <div className="settings-mv-workspace">
                <div className="settings-mv-primary-column">
              <SettingSubsectionTitle
                {...getSettingsSubsection('mvOverview')}
                title={settingsLocaleCopy(locale, { 'zh-CN': '基础与画质', 'zh-TW': '基礎與畫質', 'ja-JP': '基本と画質', 'en-US': 'Basics and quality', 'ko-KR': 'Basics and quality' })}
              />
              <SettingRow
                className="setting-row--full setting-row--compact-panel setting-row--mv-overview"
                title={t('route.mvSettings.label')}
                description={t('route.mvSettings.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--mv-overview">
                  <div className="settings-mv-overview-card settings-mv-overview-card--enable">
                    <span>
                      <strong>{t('mvSettings.general.enabled')}</strong>
                      <em>{(appSettings?.mvEnabled ?? true) ? t('mvSettings.status.on') : t('mvSettings.status.off')}</em>
                    </span>
                    <ToggleButton
                      active={appSettings?.mvEnabled ?? true}
                      disabled={!appSettings}
                      onClick={() => patchMvSettings({ enabled: !(appSettings?.mvEnabled ?? true) })}
                    />
                  </div>
                  <div className="settings-mv-overview-card settings-mv-overview-card--quality">
                    <span>
                      <strong>{t('mvSettings.network.maxQuality')}</strong>
                      <em>{t('mvSettings.aria.maxQuality', { quality: mvQualityLabels[appSettings?.mvMaxQuality ?? 'max'] })}</em>
                    </span>
                    <div className="settings-chip-row settings-chip-row--left">
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
                  </div>
                </div>
              </SettingRow>
              <SettingSubsectionTitle
                {...getSettingsSubsection('mvNetwork')}
                title={settingsLocaleCopy(locale, { 'zh-CN': '网络匹配', 'zh-TW': '網路匹配', 'ja-JP': 'ネットワーク一致', 'en-US': 'Network matching', 'ko-KR': 'Network matching' })}
              />
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mvSettings.network.title')}
                description={t('mvSettings.network.autoApplyThresholdDescription', { threshold: formatMvThreshold(appSettings?.mvAutoApplyThreshold) })}
              >
                <div className="settings-cache-panel settings-cache-panel--mv-network">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions settings-mv-toggle-grid">
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
                      <span>{t('mvSettings.network.titleOnlySearch')}</span>
                      <ToggleButton
                        active={appSettings?.mvTitleOnlySearch === true}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ titleOnlySearch: !(appSettings?.mvTitleOnlySearch === true) })}
                      />
                    </div>
                    <div className="settings-inline-toggle">
                      <span>{t('mvSettings.network.preferHighestViewCount')}</span>
                      <ToggleButton
                        active={appSettings?.mvPreferHighestViewCount !== false}
                        disabled={!appSettings}
                        onClick={() => patchMvSettings({ preferHighestViewCount: !(appSettings?.mvPreferHighestViewCount !== false) })}
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
                      <div className="settings-chip-row settings-chip-row--left settings-mv-sync-row">
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
                      onChange={(value) => previewAndPersistMvTuning({ autoApplyThreshold: mvThresholdFromPercent(value) })}
                    />
                  </div>
                </div>
              </SettingRow>
                </div>

                <aside className="settings-mv-side-column">
                  <section className="settings-mv-side-panel settings-mv-side-panel--providers">
                    <header className="settings-mv-side-heading">
                      <strong>{settingsLocaleCopy(locale, { 'zh-CN': '来源优先级', 'zh-TW': '來源優先級', 'ja-JP': 'ソース優先度', 'en-US': 'Source priority', 'ko-KR': 'Source priority' })}</strong>
                      <Info size={14} aria-hidden="true" />
                    </header>
                    <div className="settings-mv-provider-list">
                      {mvProviderOrder.map((provider, index) => (
                        <div className="settings-mv-provider-row" key={provider}>
                          <span className="settings-mv-provider-rank">{index + 1}</span>
                          <strong>{mvProviderLabels[provider]}</strong>
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
                  </section>

                  <section className="settings-mv-side-panel settings-mv-side-panel--summary">
                    <header className="settings-mv-side-heading">
                      <strong>{settingsLocaleCopy(locale, { 'zh-CN': '当前配置', 'zh-TW': '目前設定', 'ja-JP': '現在の設定', 'en-US': 'Current configuration', 'ko-KR': 'Current configuration' })}</strong>
                    </header>
                    <dl className="settings-mv-summary-list">
                      <div>
                        <dt>{t('mvSettings.general.enabled')}</dt>
                        <dd>{(appSettings?.mvEnabled ?? true) ? t('mvSettings.status.on') : t('mvSettings.status.off')}</dd>
                      </div>
                      <div>
                        <dt>{t('mvSettings.network.maxQuality')}</dt>
                        <dd>{mvQualityLabels[appSettings?.mvMaxQuality ?? 'max']}</dd>
                      </div>
                      <div>
                        <dt>{t('mvSettings.network.autoApplyThreshold')}</dt>
                        <dd>{formatMvThreshold(appSettings?.mvAutoApplyThreshold)}</dd>
                      </div>
                      <div>
                        <dt>{settingsLocaleCopy(locale, { 'zh-CN': '来源数量', 'zh-TW': '來源數量', 'ja-JP': 'ソース数', 'en-US': 'Sources', 'ko-KR': 'Sources' })}</dt>
                        <dd>{mvEnabledProviders.size}</dd>
                      </div>
                      <div>
                        <dt>{settingsLocaleCopy(locale, { 'zh-CN': '当前来源', 'zh-TW': '目前來源', 'ja-JP': '現在のソース', 'en-US': 'Active sources', 'ko-KR': 'Active sources' })}</dt>
                        <dd>{mvProviderOrder.filter((provider) => mvEnabledProviders.has(provider)).map((provider) => mvProviderLabels[provider]).join(', ') || t('mvSettings.status.none')}</dd>
                      </div>
                    </dl>
                  </section>
                </aside>

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
                      min={70}
                      max={220}
                      step={1}
                      suffix="%"
                      value={appSettings?.mvImmersiveBackgroundScalePercent ?? 115}
                      onChange={(value) => previewAndPersistMvTuning({ immersiveBackgroundScalePercent: value })}
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
                      onChange={(value) => previewAndPersistMvTuning({ immersiveBackgroundBlurPx: value })}
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
                      onChange={(value) => previewAndPersistMvTuning({ immersiveBackgroundBrightnessPercent: value })}
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
                      onChange={(value) => previewAndPersistMvTuning({ immersiveBackgroundOverlayOpacityPercent: value })}
                    />
                  </div>
                </div>
              </SettingRow>
              </div>
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              icon={activeSection === 'accounts' ? User : Link2}
              id={activeSection === 'accounts' ? 'accounts' : 'integrations'}
              title={t(activeSection === 'accounts' ? 'settings.nav.accounts.label' : 'settings.nav.integrations.label')}
            >
              {activeSection === 'integrations' ? (
                <div className="settings-integrations-workspace">
                  <div className="settings-integrations-toolbar">
                    <p>{t('settings.nav.integrations.description')}</p>
                    <div>
                      <button
                        className="settings-action-button"
                        type="button"
                        onClick={() => {
                          void Promise.all([
                            refreshDiscordPresenceStatus(),
                            refreshStageBridgeStatus(),
                            refreshSmtcDiagnostics(),
                            refreshTaskbarPlaybackStatus(),
                          ]);
                        }}
                      >
                        <RefreshCw size={15} />
                        {t('settings.integrations.accountPanel.refreshAll')}
                      </button>
                      <span className="settings-integrations-attention">
                        <i aria-hidden="true" />
                        {integrationsAttentionCount} {integrationsNeedsAttention}
                      </span>
                    </div>
                  </div>

                  <section className="settings-integrations-overview" aria-labelledby="settings-integrations-overview-title">
                    <h3 id="settings-integrations-overview-title">{integrationsOverviewTitle}</h3>
                    <div className="settings-integrations-overview-grid">
                      <button type="button" onClick={() => handleSectionIndexClick('settings-row-network-proxy')}>
                        <span className="settings-integrations-overview-icon"><Globe2 size={20} /></span>
                        <span><strong>{t('settings.integrations.networkProxy.title')}</strong><small>{networkProxyOverviewLabel}</small></span>
                        <em>{integrationsConfigure}</em>
                      </button>
                      <button type="button" onClick={() => handleSectionIndexClick('settings-row-discord-presence')}>
                        <span className="settings-integrations-overview-icon"><MessageSquare size={20} /></span>
                        <span><strong>{getSettingsSubsection('integrationsExternal').title}</strong><small>{discordPresenceEnabled ? discordPresenceLabel : t('common.disabled')}</small></span>
                        <em>{integrationsConfigure}</em>
                      </button>
                      <button type="button" onClick={() => handleSectionIndexClick('settings-row-smtc')} disabled={!windowsIntegrationAvailable}>
                        <span className="settings-integrations-overview-icon"><Monitor size={20} /></span>
                        <span><strong>{getSettingsSubsection('integrationsWindows').title}</strong><small>{integrationsEnabledCount(windowsIntegrationEnabledCount)}</small></span>
                        <em>{integrationsConfigure}</em>
                      </button>
                      <button type="button" onClick={() => handleSectionIndexClick('settings-row-mobile-integration')}>
                        <span className="settings-integrations-overview-icon"><QrCode size={20} /></span>
                        <span><strong>{getSettingsSubsection('integrationsMobile').title}</strong><small>{integrationsMobileSummary}</small></span>
                        <em>{integrationsConfigure}</em>
                      </button>
                    </div>
                  </section>

                  <div className="settings-integrations-main-grid">
                    <section className="settings-integrations-common" aria-labelledby="settings-integrations-common-title">
                      <h3 id="settings-integrations-common-title">{integrationsCommonTitle}</h3>
                      <div className="settings-integrations-service-list">
                        <div className="settings-integrations-service-row" id="settings-row-discord-presence" data-search-highlight={highlightedSettingId === 'settings-row-discord-presence' ? 'true' : undefined}>
                          <span className="settings-integrations-service-icon is-discord"><MessageSquare size={20} /></span>
                          <div className="settings-integrations-service-copy">
                            <h4>{t('settings.integrations.discord.title')}</h4>
                            <p>{t('settings.integrations.discord.description')}</p>
                          </div>
                          <StatusText tone={discordPresenceEnabled ? 'good' : 'muted'}>{discordPresenceEnabled ? discordPresenceLabel : t('common.disabled')}</StatusText>
                          <ToggleButton active={discordPresenceEnabled} disabled={!appSettings} onClick={() => void handleDiscordPresenceToggle()} />
                          <button className="settings-action-button" type="button" onClick={() => void refreshDiscordPresenceStatus()}>
                            {t('settings.integrations.discord.action.refresh')}
                          </button>
                        </div>
                        <div className="settings-integrations-service-row" id="settings-row-obs-browser-source" data-search-highlight={highlightedSettingId === 'settings-row-obs-browser-source' ? 'true' : undefined}>
                          <span className="settings-integrations-service-icon is-obs"><Clapperboard size={20} /></span>
                          <div className="settings-integrations-service-copy">
                            <h4>{t('settings.integrations.obs.title')}</h4>
                            <p>{t('settings.integrations.obs.description')}</p>
                          </div>
                          <StatusText tone={obsBrowserSourceEnabled && stageBridgeRunning ? 'good' : 'muted'}>
                            {obsBrowserSourceEnabled ? obsBrowserSourceUrl : t('common.disabled')}
                          </StatusText>
                          <ToggleButton active={obsBrowserSourceEnabled} disabled={!appSettings} onClick={() => void handleStageBridgeToggle('obsBrowserSourceEnabled')} />
                          <button
                            className="settings-action-button"
                            type="button"
                            disabled={!stageBridgeStatus?.obsUrl}
                            onClick={() => stageBridgeStatus?.obsUrl && void copyTextToClipboard(stageBridgeStatus.obsUrl)}
                          >
                            {t('settings.integrations.stage.action.copyUrl')}
                          </button>
                        </div>
                        {windowsIntegrationAvailable ? (
                          <div className="settings-integrations-service-row" id="settings-row-smtc" data-search-highlight={highlightedSettingId === 'settings-row-smtc' ? 'true' : undefined}>
                            <span className="settings-integrations-service-icon is-windows"><Monitor size={20} /></span>
                            <div className="settings-integrations-service-copy">
                              <h4>{t('settings.integrations.smtc.title')}</h4>
                              <p>{t('settings.integrations.smtc.description')}</p>
                            </div>
                            <StatusText tone={(appSettings?.smtcEnabled ?? true) ? 'good' : 'muted'}>{smtcLabel}</StatusText>
                            <ToggleButton active={appSettings?.smtcEnabled ?? true} disabled={!appSettings} onClick={() => patchAppSettings({ smtcEnabled: !(appSettings?.smtcEnabled ?? true) })} />
                            <button
                              className="settings-action-button"
                              type="button"
                              disabled={smtcRestarting || !(appSettings?.smtcEnabled ?? true)}
                              onClick={() => void restartSmtcSupport()}
                            >
                              {smtcRestarting ? t('settings.integrations.smtc.action.restarting') : t('settings.integrations.smtc.action.restart')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="settings-integrations-proxy" id="settings-row-network-proxy" data-search-highlight={highlightedSettingId === 'settings-row-network-proxy' ? 'true' : undefined} aria-labelledby="settings-integrations-proxy-title">
                      <h3 id="settings-integrations-proxy-title">{t('settings.integrations.networkProxy.title')}</h3>
                      <label className="settings-integrations-proxy-control">
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
                      <label className="settings-integrations-proxy-control">
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
                      {networkProxyTestResult ? (
                        <p className={`settings-integrations-proxy-result ${networkProxyTestResult.ok ? 'is-ok' : 'is-error'}`}>
                          <i aria-hidden="true" />
                          {networkProxyTestResult.message}
                          {networkProxyTestResult.elapsedMs ? ` · ${networkProxyTestResult.elapsedMs} ms` : ''}
                        </p>
                      ) : (
                        <p className="settings-integrations-proxy-result"><i aria-hidden="true" />{integrationsProxyUnchecked}</p>
                      )}
                      <button className="settings-action-button settings-integrations-proxy-save" type="button" disabled={!appSettings || networkProxyBusy !== null} onClick={handleNetworkProxySave}>
                        <Save size={15} />
                        {networkProxyBusy === 'save' ? t('settings.integrations.networkProxy.saveBusy') : t('settings.integrations.networkProxy.save')}
                      </button>
                      <details className="settings-integrations-proxy-advanced">
                        <summary>{integrationsAdvancedSettings}<ChevronRight size={15} /></summary>
                        <label className="settings-integrations-proxy-control">
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
                        <label className="settings-integrations-proxy-control">
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
                        <p>{t('settings.integrations.networkProxy.note')}</p>
                        <button className="settings-action-button" type="button" disabled={!appSettings || networkProxyBusy !== null} onClick={handleNetworkProxyTest}>
                          <RotateCw size={15} />
                          {networkProxyBusy === 'test' ? t('settings.integrations.networkProxy.testBusy') : t('settings.integrations.networkProxy.test')}
                        </button>
                      </details>
                    </section>
                  </div>

                  <EchoLinkBasicPanel />
                  <MqttIntegrationPanel />

                  <section className="settings-integrations-additional" aria-labelledby="settings-integrations-additional-title">
                    <h3 id="settings-integrations-additional-title">{integrationsAdditionalTitle}</h3>
                    <div className="settings-integrations-service-list">
                      <div className="settings-integrations-service-row" id="settings-row-stage-api" data-search-highlight={highlightedSettingId === 'settings-row-stage-api' ? 'true' : undefined}>
                        <span className="settings-integrations-service-icon"><Link2 size={20} /></span>
                        <div className="settings-integrations-service-copy"><h4>{t('settings.integrations.stage.title')}</h4><p>{t('settings.integrations.stage.description')}</p></div>
                        <StatusText tone={appSettings?.stageApiEnabled && stageBridgeRunning ? 'good' : 'muted'}>{appSettings?.stageApiEnabled ? stageBridgeUrl : t('common.disabled')}</StatusText>
                        <ToggleButton active={appSettings?.stageApiEnabled === true} disabled={!appSettings} onClick={() => void handleStageBridgeToggle('stageApiEnabled')} />
                        <button className="settings-action-button" type="button" disabled={!stageBridgeStatus?.url} onClick={() => stageBridgeStatus?.url && void copyTextToClipboard(stageBridgeStatus.url)}>{t('settings.integrations.stage.action.copyUrl')}</button>
                      </div>
                      {windowsIntegrationAvailable ? (
                        <>
                          <div className="settings-integrations-service-row" id="settings-row-smtc-lyrics" data-search-highlight={highlightedSettingId === 'settings-row-smtc-lyrics' ? 'true' : undefined}>
                            <span className="settings-integrations-service-icon"><Captions size={20} /></span>
                            <div className="settings-integrations-service-copy"><h4>{t('settings.integrations.smtcLyrics.title')}</h4><p>{t('settings.integrations.smtcLyrics.description')}</p></div>
                            <span />
                            <ToggleButton active={appSettings?.smtcLyricsEnabled ?? false} disabled={!appSettings || !(appSettings?.smtcEnabled ?? true)} onClick={() => patchAppSettings({ smtcLyricsEnabled: !(appSettings?.smtcLyricsEnabled ?? false) })} />
                          </div>
                          <div className="settings-integrations-service-row" id="settings-row-taskbar-mini-player" data-search-highlight={highlightedSettingId === 'settings-row-taskbar-mini-player' ? 'true' : undefined}>
                            <span className="settings-integrations-service-icon"><Monitor size={20} /></span>
                            <div className="settings-integrations-service-copy"><h4>{t('settings.integrations.taskbarMiniPlayer.title')}</h4><p>{t('settings.integrations.taskbarMiniPlayer.description')}</p></div>
                            <span />
                            <ToggleButton active={appSettings?.taskbarMiniPlayerEnabled ?? false} disabled={!appSettings || !window.echo?.taskbarMiniPlayer?.setEnabled} onClick={() => applyTaskbarMiniPlayerEnabled(!(appSettings?.taskbarMiniPlayerEnabled ?? false))} />
                          </div>
                          <div className="settings-integrations-service-row" id="settings-row-taskbar-playback" data-search-highlight={highlightedSettingId === 'settings-row-taskbar-playback' ? 'true' : undefined}>
                            <span className="settings-integrations-service-icon"><Play size={20} /></span>
                            <div className="settings-integrations-service-copy"><h4>{t('settings.integrations.taskbarPlayback.title')}</h4><p>{t('settings.integrations.taskbarPlayback.description')}</p></div>
                            <StatusText tone={taskbarPlaybackStatus?.visible ? 'good' : 'muted'}>{taskbarPlaybackLabel}</StatusText>
                            <ToggleButton active={appSettings?.taskbarPlaybackControlsEnabled ?? false} disabled={!appSettings} onClick={() => patchAppSettings({ taskbarPlaybackControlsEnabled: !(appSettings?.taskbarPlaybackControlsEnabled ?? false) })} />
                            <button className="settings-action-button" type="button" onClick={() => void refreshTaskbarPlaybackStatus()}>{t('settings.integrations.discord.action.refresh')}</button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </section>
                </div>
              ) : null}
              {activeSection === 'accounts' ? (
                <>
              <SettingSubsectionTitle id="settings-subsection-service-accounts" {...getSettingsSubsection('integrationsServiceAccounts')} />
              <div className="settings-account-panel settings-service-account-panel" id="settings-service-account-panel">
                <header className="settings-service-account-header">
                  <div>
                    <h3>{t('settings.integrations.accountPanel.title')}</h3>
                    <p>{t('settings.integrations.accountPanel.description')}</p>
                  </div>
                  <div className="settings-service-account-header-side">
                    <div className="settings-account-overview" aria-label={t('settings.integrations.accountPanel.title')}>
                      <span className="settings-account-overview-stat is-connected">
                        {accountOverview.connected} {t('settings.integrations.accounts.status.loggedIn')}
                      </span>
                      <span className="settings-account-overview-stat is-checking">
                        {accountOverview.checking} {t('settings.integrations.accounts.status.checking')}
                      </span>
                      <span className="settings-account-overview-stat">
                        {accountOverview.disconnected} {t('settings.integrations.accounts.status.loggedOut')}
                      </span>
                    </div>
                    <button className="settings-action-button" type="button" onClick={() => void refreshAccountStatuses()}>
                      <RefreshCw size={15} />
                      {t('settings.integrations.accountPanel.refreshAll')}
                    </button>
                  </div>
                </header>
                <div className="settings-account-workspace">
                  <nav className="settings-account-service-list" aria-label={t('settings.integrations.accountPanel.title')}>
                    {settingsAccountProviders.map((provider) => {
                      const status = accountStatusByProvider[provider];
                      const active = provider === selectedAccountProvider;
                      const state = !status ? 'checking' : status.connected ? (status.error ? 'expired' : 'connected') : 'disconnected';
                      return (
                        <button
                          className={`settings-account-service-button${active ? ' is-active' : ''}`}
                          type="button"
                          key={provider}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setSelectedAccountProvider(provider)}
                        >
                          <span className="settings-account-service-logo">
                            <img src={accountProviderLogoUrls[provider]} alt="" draggable={false} />
                          </span>
                          <span className="settings-account-service-copy">
                            <strong>{accountProviderLabels[provider]}</strong>
                            <span className={`settings-account-service-state is-${state}`}>
                              {getAccountStatusLabel(t, status)}
                            </span>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </nav>
                  <section className="settings-account-detail" aria-label={accountProviderLabels[selectedAccountProvider]}>
                    <header className="settings-account-detail-header">
                      <span className="settings-account-detail-logo">
                        <img src={accountProviderLogoUrls[selectedAccountProvider]} alt="" draggable={false} />
                      </span>
                      <div>
                        <h3>{accountProviderLabels[selectedAccountProvider]}</h3>
                        <span className={getAccountBadgeClass(accountStatusByProvider[selectedAccountProvider])}>
                          {getAccountStatusLabel(t, accountStatusByProvider[selectedAccountProvider])}
                        </span>
                      </div>
                    </header>
                    <div className="settings-account-detail-body">
                      {cookieAccountProviders.includes(selectedAccountProvider) ? (
                        <AccountCookieCard
                          provider={selectedAccountProvider}
                          status={accountStatusByProvider[selectedAccountProvider]}
                          browser={selectedAccountProvider === 'soundcloud' ? soundCloudBrowser : undefined}
                          cookieValue={accountCookies[selectedAccountProvider]}
                          busyAction={accountBusy[selectedAccountProvider]}
                          error={accountErrors[selectedAccountProvider]}
                          message={accountMessages[selectedAccountProvider]}
                          onBrowserChange={selectedAccountProvider === 'soundcloud' ? (browser) => void handleSoundCloudBrowserChange(browser) : undefined}
                          onChangeCookie={(value) => setAccountCookies((current) => ({ ...current, [selectedAccountProvider]: value }))}
                          onSave={() => void handleAccountSaveCookie(selectedAccountProvider)}
                          onCheck={() => void handleAccountCheck(selectedAccountProvider)}
                          onOpenLogin={() => void handleAccountOpenLogin(selectedAccountProvider)}
                          onOpenQrLogin={selectedAccountProvider === 'netease' ? () => void handleNeteaseQrLogin() : undefined}
                          onClear={() => void handleAccountClear(selectedAccountProvider)}
                        />
                      ) : selectedAccountProvider === 'youtube' ? (
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
                      ) : selectedAccountProvider === 'spotify' ? (
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
                      ) : selectedAccountProvider === 'tidal' ? (
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
                      ) : selectedAccountProvider === 'qobuz' ? (
                        <QobuzAccountCard
                          status={accountStatusByProvider.qobuz}
                          busyAction={accountBusy.qobuz}
                          error={accountErrors.qobuz}
                          message={accountMessages.qobuz}
                          onCheck={() => void handleAccountCheck('qobuz')}
                          onLogin={() => void handleAccountOpenLogin('qobuz')}
                          onClear={() => void handleAccountClear('qobuz')}
                          tokenValue={qobuzTokenValue}
                          onTokenChange={setQobuzTokenValue}
                        />
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
              <SettingSubsectionTitle {...getSettingsSubsection('integrationsAdvanced')} />
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
              {credentialPanelVisible ? <SettingSubsectionTitle {...getSettingsSubsection('integrationsMetadata')} /> : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-online-album-info"
                highlighted={highlightedSettingId === 'settings-row-online-album-info'}
                title={t('settings.integrations.onlineAlbum.title')}
                description={t('settings.integrations.onlineAlbum.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--online-album-info">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>{t('settings.integrations.onlineAlbum.token')}</span>
                      <input
                        type="password"
                        value={onlineAlbumInfoDraft.discogsUserToken}
                        placeholder={t('settings.integrations.onlineAlbum.placeholder')}
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
                      {onlineAlbumInfoBusyAction === 'save' ? t('settings.integrations.common.saving') : t('settings.integrations.onlineAlbum.save')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(discogsDeveloperSettingsUrl)}>
                      <ExternalLink size={15} />
                      {t('settings.integrations.onlineAlbum.openToken')}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.integrations.onlineAlbum.note')}
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
                title={t('settings.integrations.onlineArtist.title')}
                description={t('settings.integrations.onlineArtist.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--online-artist-info">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Bandsintown app_id</span>
                      <input
                        type="password"
                        value={onlineArtistInfoDraft.bandsintownAppId}
                        placeholder={t('settings.integrations.onlineArtist.placeholder')}
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
                        placeholder={t('settings.integrations.onlineArtist.placeholder')}
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
                        placeholder={t('settings.integrations.onlineArtist.placeholder')}
                        disabled={!appSettings}
                        onChange={(event) => {
                          setOnlineArtistInfoDraft((current) => ({ ...current, seatGeekClientId: event.target.value }));
                          setOnlineArtistInfoMessage(null);
                        }}
                      />
                    </label>
                    <label className="settings-proxy-field">
                      <span>{t('settings.integrations.onlineArtist.region')}</span>
                      <input
                        type="text"
                        value={onlineArtistInfoDraft.region}
                        placeholder={t('settings.integrations.onlineArtist.regionPlaceholder')}
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
                      {onlineArtistInfoBusyAction === 'save' ? t('settings.integrations.common.saving') : t('settings.integrations.onlineArtist.save')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={onlineArtistInfoBusyAction !== null} onClick={handleClearArtistOnlineInfoCache}>
                      <Trash2 size={15} />
                      {onlineArtistInfoBusyAction === 'clear' ? t('settings.integrations.onlineArtist.clearing') : t('settings.integrations.onlineArtist.clearCache')}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.integrations.onlineArtist.note')}
                  </p>
                  {onlineArtistInfoMessage ? <p className="settings-inline-note">{onlineArtistInfoMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
                </>
              ) : null}
              {activeSection === 'accounts' ? (
                <>
              {credentialPanelVisible ? <SettingSubsectionTitle id="settings-subsection-lastfm" {...getSettingsSubsection('integrationsLastFm')} /> : null}
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
                description={t('settings.integrations.lastfm.connection.description.browser')}
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
              <SettingSubsectionTitle id="settings-subsection-account-automation" {...getSettingsSubsection('integrationsAutomation')} />
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
                title={t('settings.integrations.spotifyAutoLaunchOfficialPlayer.title')}
                description={t('settings.integrations.spotifyAutoLaunchOfficialPlayer.description')}
              >
                <ToggleButton
                  active={appSettings?.spotifyAutoLaunchOfficialPlayer ?? true}
                  disabled={!appSettings}
                  onClick={() => patchAppSettings({ spotifyAutoLaunchOfficialPlayer: !(appSettings?.spotifyAutoLaunchOfficialPlayer ?? true) })}
                />
              </SettingRow>
              {credentialPanelVisible ? <SettingSubsectionTitle {...getSettingsSubsection('integrationsAccounts')} /> : null}
              {credentialPanelVisible ? (
              <SettingRow
                className="setting-row--full setting-row--credential"
                id="settings-row-spotify-auth-config"
                highlighted={highlightedSettingId === 'settings-row-spotify-auth-config'}
                title={t('settings.integrations.spotifyAuth.title')}
                description={t('settings.integrations.spotifyAuth.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--spotify-auth">
                  <div className="settings-proxy-grid">
                    <label className="settings-proxy-field">
                      <span>Client ID</span>
                      <input
                        type="text"
                        value={spotifyAuthDraft.clientId}
                        placeholder={t('settings.integrations.spotifyAuth.clientIdPlaceholder')}
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
                      {t('settings.integrations.common.saveConfig', { service: 'Spotify' })}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(spotifyDeveloperDashboardUrl)}>
                      <ExternalLink size={15} />
                      {t('settings.integrations.common.openDashboard', { service: 'Spotify' })}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.integrations.common.dashboardCallback', { uri: defaultSpotifyRedirectUri })}
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
                title={t('settings.integrations.tidalAuth.title')}
                description={t('settings.integrations.tidalAuth.description')}
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
                      {t('settings.integrations.tidalAuth.save')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(tidalDeveloperDashboardUrl)}>
                      <ExternalLink size={15} />
                      {t('settings.integrations.common.openDashboard', { service: 'TIDAL' })}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.integrations.common.dashboardCallback', { uri: defaultTidalRedirectUri })}
                  </p>
                  {tidalAuthMessage ? <p className="settings-inline-note">{tidalAuthMessage}</p> : null}
                </div>
              </SettingRow>
              ) : null}
                </>
              ) : null}
            </SettingSection>

            <PluginsSettingsSection
              activeKey={activeSection}
              getSubsection={getSettingsSubsection}
              highlightedSettingId={highlightedSettingId}
              message={pluginSettingsMessage}
              onCreatePlaybackPanelExample={handleCreatePlaybackPanelExample}
              onOpenDirectory={handleOpenPluginDirectory}
              onOpenExternalUrl={handleOpenExternalUrl}
              onOpenPage={handleOpenPluginsPage}
              t={t}
            />

            <RemoteSettingsSection
              activeKey={activeSection}
              getSubsection={getSettingsSubsection}
              t={t}
            />

            <EqSettingsSection
              activeKey={activeSection}
              getSubsection={getSettingsSubsection}
              onOpenDspPage={handleOpenDspPage}
              onRefreshStatus={refreshStatus}
              status={status}
              t={t}
            />

            <SettingSection activeKey={activeSection} icon={Palette} id="appearance" title={t('settings.nav.appearance.label')}>
              <ThemeModeSettings
                currentMode={appSettings?.appearanceTheme ?? defaultThemeMode}
                darkAt={themeScheduleDarkAt}
                getSubsection={getSettingsSubsection}
                highlighted={highlightedSettingId === 'settings-row-theme'}
                lightAt={themeScheduleLightAt}
                onModeChange={handleThemeModeChange}
                onScheduleChange={handleThemeScheduleChange}
                scheduleEnabled={themeScheduleEnabled}
                scheduleStatus={themeScheduleStatus}
                t={t}
              />
              <SidebarLayoutSettings
                available={Boolean(appSettings)}
                connectProLocked={connectSidebarProLocked}
                draggingRouteId={draggingSidebarRouteId}
                expanded={sidebarLayoutExpanded}
                groups={sidebarSettingsGroups}
                hiddenRouteIds={sidebarHiddenRouteIdSet}
                highlighted={highlightedSettingId === 'settings-row-sidebar-layout'}
                onDragEnd={handleSidebarRouteDragEnd}
                onDragOver={handleSidebarRouteDragOver}
                onDragStart={handleSidebarRouteDragStart}
                onDrop={handleSidebarRouteDrop}
                onExpandedToggle={handleSidebarLayoutToggle}
                onReset={handleSidebarRoutesReset}
                onVisibilityToggle={handleSidebarRouteVisibilityToggle}
                summary={sidebarLayoutSummary}
                t={t}
              />
              <ThemePresetSettings
                ambientActive={ambientThemeActive}
                ambientLockMessage={ambientThemePresetLockMessage}
                echoProUnlocked={echoProUnlockedForDisplay}
                expanded={themePresetsExpanded}
                onExpandedChange={(expanded) =>
                  patchAppSettings({ appearanceThemePresetsExpanded: expanded })
                }
                onPresetChange={handleThemePresetChange}
                onRandomCreate={handleRandomThemeCreate}
                selectedPreset={selectedThemePreset}
                summaryLabel={themePresetSummaryLabel}
                summaryPreview={themePresetSummaryPreview}
                t={t}
              />
              <ThemeCustomEditor
                activeTheme={activeThemeCustom}
                advancedOpen={themeCustomAdvancedOpen}
                ambientActive={ambientThemeActive}
                ambientLockMessage={ambientThemeCustomLockMessage}
                message={themeCustomMessage}
                onAdvancedOpenChange={setThemeCustomAdvancedOpen}
                onAutoFix={handleThemeCustomAutoFix}
                onColorChange={updateThemeCustomColor}
                onCopyTone={handleThemeCustomCopyTone}
                onCreate={handleThemeCustomCreate}
                onDelete={handleThemeCustomDelete}
                onDuplicate={handleThemeCustomDuplicate}
                onExport={handleThemeCustomExport}
                onImport={handleThemeCustomImport}
                onMotionEnabledChange={updateThemeCustomMotionEnabled}
                onNumberChange={updateThemeCustomPercent}
                onPanelOpenChange={setThemeCustomPanelOpen}
                onPluginApply={handlePluginThemeApply}
                onRename={handleThemeCustomRename}
                onReset={handleThemeCustomReset}
                onSave={handleThemeCustomSave}
                onSelect={handleThemeCustomSelect}
                onToneChange={setThemeCustomTone}
                panelOpen={themeCustomPanelOpen}
                pluginThemes={pluginThemeOptions}
                presetLabelKey={selectedThemePresetOption.labelKey}
                savedThemeId={savedThemeCustomId}
                savedThemes={savedThemeCustomThemes}
                t={t}
                tone={themeCustomTone}
                values={themeCustomValues}
                warningCount={themeCustomWarnings.length}
              />
              <SettingSubsectionTitle {...getSettingsSubsection('appearanceWindow')} />
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
              <PlayerBarButtonSettings
                available={Boolean(appSettings)}
                hiddenButtonIds={hiddenPlayerBarButtonIdSet}
                highlighted={highlightedSettingId === 'settings-row-player-bar-buttons'}
                onReset={handlePlayerBarButtonsReset}
                onVisibilityToggle={handlePlayerBarButtonVisibilityToggle}
                t={t}
              />
              <SettingSubsectionTitle {...getSettingsSubsection('appearanceWallpaper')} />
              <AppWallpaperSettings
                advancedOpen={appearanceWallpaperAdvancedOpen}
                highlighted={highlightedSettingId === 'settings-row-wallpaper'}
                onAdvancedOpenChange={setAppearanceWallpaperAdvancedOpen}
                onChoose={() => void handleAppWallpaperChoose()}
                onClear={handleAppWallpaperClear}
                onPatch={previewAndPersistAppWallpaperSettings}
                onPortraitChoose={() => void handleAppPortraitWallpaperChoose()}
                onPortraitClear={handleAppPortraitWallpaperClear}
                settings={appSettings}
                t={t}
              />
              <TypographySettings
                highlightedAlbumCoverShape={highlightedSettingId === 'settings-row-album-cover-shape'}
                onChange={handleAppearanceChange}
                onFontPickerOpen={handleFontPickerOpen}
                onOpenChange={setAppearanceTypographyOpen}
                onReset={handleAppearanceReset}
                open={appearanceTypographyOpen}
                preferences={appearancePreferences}
                t={t}
              />
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              actions={(
                <button
                  className="settings-primary-button settings-library-scan-button"
                  type="button"
                  disabled={libraryScanActionDisabled}
                  onClick={() => void handleScanLibraryFolders()}
                >
                  <RefreshCw className={libraryScanActionDisabled ? 'spinning-icon' : undefined} size={15} />
                  {libraryScanActionDisabled
                    ? t('mediaLibrary.settings.scan.action.queued')
                    : settingsLocaleCopy(locale, {
    'zh-CN': '扫描曲库',
    'zh-TW': '掃描音樂庫',
    'ja-JP': 'ライブラリをスキャン',
    'en-US': 'Scan library',
    'ko-KR': 'Scan library',
  })}
                </button>
              )}
              context={settingsLocaleCopy(locale, {
    'zh-CN': '设置 / 内容与媒体',
    'zh-TW': '設定 / 內容與媒體',
    'ja-JP': '設定 / コンテンツとメディア',
    'en-US': 'Settings / Content and media',
    'ko-KR': 'Settings / Content and media',
  })}
              description={settingsLocaleCopy(locale, {
    'zh-CN': '管理本地音乐的导入、修复与维护。',
    'zh-TW': '管理本機音樂的匯入、修復與維護。',
    'ja-JP': 'ローカル音楽の取り込み、修復、管理を行います。',
    'en-US': 'Import, repair, and maintain your local music library.',
    'ko-KR': 'Import, repair, and maintain your local music library.',
  })}
              icon={Download}
              id="library"
              title={t('settings.nav.library.label')}
            >
              <div className="settings-library-overview" role="status" aria-label={t('settings.nav.library.label')}>
                <span className="settings-library-overview__status" data-busy={libraryScanRunningList.length > 0 ? 'true' : undefined}>
                  <Check size={15} />
                  <em>{settingsLocaleCopy(locale, { 'zh-CN': '曲库状态', 'zh-TW': '音樂庫狀態', 'ja-JP': 'ライブラリ状態', 'en-US': 'Library status', 'ko-KR': 'Library status' })}</em>
                  <strong>
                    {libraryScanRunningList.length > 0
                      ? settingsLocaleCopy(locale, { 'zh-CN': '正在扫描', 'zh-TW': '正在掃描', 'ja-JP': 'スキャン中', 'en-US': 'Scanning', 'ko-KR': 'Scanning' })
                      : settingsLocaleCopy(locale, { 'zh-CN': '良好', 'zh-TW': '良好', 'ja-JP': '良好', 'en-US': 'Healthy', 'ko-KR': 'Healthy' })}
                  </strong>
                </span>
                <span>
                  <em>{settingsLocaleCopy(locale, { 'zh-CN': '最近扫描', 'zh-TW': '最近掃描', 'ja-JP': '最近のスキャン', 'en-US': 'Latest scan', 'ko-KR': 'Latest scan' })}</em>
                  <strong>{latestLibraryScanTotal > 0 ? latestLibraryScanTotal.toLocaleString(locale) : '—'}</strong>
                </span>
                <span>
                  <em>{settingsLocaleCopy(locale, { 'zh-CN': '文件夹', 'zh-TW': '資料夾', 'ja-JP': 'フォルダー', 'en-US': 'Folders', 'ko-KR': 'Folders' })}</em>
                  <strong>{libraryScanStatusList.length > 0 ? libraryScanStatusList.length : '—'}</strong>
                </span>
                <span>
                  <em>{settingsLocaleCopy(locale, { 'zh-CN': '扫描耗时', 'zh-TW': '掃描耗時', 'ja-JP': 'スキャン時間', 'en-US': 'Scan duration', 'ko-KR': 'Scan duration' })}</em>
                  <strong>{latestLibraryScan ? latestLibraryScanDurationText : '—'}</strong>
                </span>
                <span>
                  <em>{settingsLocaleCopy(locale, { 'zh-CN': '缓存', 'zh-TW': '快取', 'ja-JP': 'キャッシュ', 'en-US': 'Cache', 'ko-KR': 'Cache' })}</em>
                  <strong>{cacheInventory ? formatCacheBytes(cacheInventory.totalSizeBytes) : '—'}</strong>
                </span>
              </div>
              <SettingSubsectionTitle {...getSettingsSubsection('libraryImport')} />
              <div id="settings-row-library-folders" data-search-highlight={highlightedSettingId === 'settings-row-library-folders' ? 'true' : undefined}>
                <LibraryFoldersPanel autoRefresh={libraryDeferredRefreshReady} pollScanStatuses={false} showOsuFolderImport />
              </div>
              <SettingRow
                id="settings-row-live-library-updates"
                highlighted={highlightedSettingId === 'settings-row-live-library-updates'}
                title={t('mediaLibrary.settings.liveUpdates.title')}
                description={t('mediaLibrary.settings.liveUpdates.description')}
              >
                <div className="settings-inline-toggle settings-inline-toggle--compact">
                  <StatusText tone={liveLibraryStatus.tone}>{liveLibraryStatus.text}</StatusText>
                  <ToggleButton
                    active={appSettings?.liveLibraryUpdatesEnabled ?? false}
                    ariaLabel={t('mediaLibrary.settings.liveUpdates.title')}
                    disabled={!appSettings}
                    onClick={handleLiveLibraryUpdatesToggle}
                  />
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('libraryQuality')} />
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-quality"
                highlighted={highlightedSettingId === 'settings-row-library-quality'}
                title={t('mediaLibrary.quality.title')}
                description={t('mediaLibrary.settings.quality.description')}
              >
                <LibraryQualityPanel autoRefresh={libraryDeferredRefreshReady} networkMetadataEnabled={networkMetadataEnabled} />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-lyrics-backfill"
                highlighted={highlightedSettingId === 'settings-row-library-lyrics-backfill'}
                title={t('mediaLibrary.settings.lyrics.title')}
                description={t('mediaLibrary.settings.lyrics.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--lyrics-backfill">
                  <div className="settings-inline-control">
                    <span>{t('mediaLibrary.settings.lyrics.hitRate')}</span>
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
                      {t('mediaLibrary.settings.lyrics.action.quick')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={lyricsBackfillBusy || lyricsBackfillRunning}
                      onClick={() => void handleStartLyricsBackfill('complete')}
                    >
                      <Search size={15} />
                      {t('mediaLibrary.settings.lyrics.action.complete')}
                    </button>
                    {lyricsBackfillRunning ? (
                      <button
                        className="settings-danger-button"
                        type="button"
                        onClick={() => void handleCancelLyricsBackfill()}
                      >
                        <X size={15} />
                        {t('mediaLibrary.settings.action.cancel')}
                      </button>
                    ) : null}
                  </div>
                  {lyricsBackfillMessage ? <p className="settings-inline-note">{lyricsBackfillMessage}</p> : null}
                  {lyricsBackfillJob ? (
                    <div className="settings-update-progress settings-lyrics-backfill-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>{t('mediaLibrary.settings.lyrics.progressTitle', { status: lyricsBackfillStatusLabel })}</strong>
                        <span>
                          {lyricsBackfillProgressDone} / {lyricsBackfillJob.totalTracks || 0}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label={t('mediaLibrary.settings.lyrics.progressAria')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={lyricsBackfillProgressPercent}
                      >
                        <span style={{ width: `${lyricsBackfillProgressPercent}%` }} />
                      </div>
                      <div className="settings-update-progress-meta">
                        <span>
                          {t('mediaLibrary.settings.lyrics.progressMeta', {
                            matched: lyricsBackfillJob.matchedTracks,
                            notFound: lyricsBackfillJob.notFoundTracks,
                            cached: lyricsBackfillJob.alreadyCachedTracks,
                            errors: lyricsBackfillJob.errorCount,
                          })}
                        </span>
                        <span>{lyricsBackfillJob.currentTrackTitle ?? (lyricsBackfillJob.mode === 'complete' ? t('mediaLibrary.settings.lyrics.mode.complete') : t('mediaLibrary.settings.lyrics.mode.quick'))}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-health-report"
                highlighted={highlightedSettingId === 'settings-row-library-health-report'}
                title={t('mediaLibrary.health.title')}
                description={t('mediaLibrary.settings.health.description')}
              >
                <LibraryHealthReportPanel />
              </SettingRow>
              <div id="settings-row-library-lab" data-search-highlight={highlightedSettingId === 'settings-row-library-lab' ? 'true' : undefined}>
                <LibraryDiagnosticsPanel />
              </div>
              <SettingRow
                id="settings-row-artist-wall-artwork"
                highlighted={highlightedSettingId === 'settings-row-artist-wall-artwork'}
                title={t('mediaLibrary.settings.artistWallArtwork.title')}
                description={t('mediaLibrary.settings.artistWallArtwork.description')}
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
                      {artistImagePaused ? t('mediaLibrary.settings.artistImages.action.resume') : t('mediaLibrary.settings.artistImages.action.pause')}
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
                        <strong>{t('mediaLibrary.settings.artistImages.progressTitle', { status: artistImageStatusLabel })}</strong>
                        <span>
                          {artistImageProgressDone} / {artistImageProgressTotal}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label={t('mediaLibrary.settings.artistImages.progressAria')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={artistImageProgressPercent}
                      >
                        <span style={{ width: `${artistImageProgressPercent}%` }} />
                      </div>
                      <div className="settings-update-progress-meta">
                        <span>
                          {t('mediaLibrary.settings.artistImages.progressMeta', {
                            active: artistImageActive,
                            pending: artistImageSummary.pending,
                            cached: artistImageSummary.matched,
                            notFound: artistImageSummary.notFound,
                            failed: artistImageFailed,
                          })}
                        </span>
                        <span>{t('mediaLibrary.settings.artistImages.skipped', { count: artistImageProgress.lastQueued.skipped })}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              {downloadsFeatureUnlocked ? (
                <>
                  <SettingRow
                    className="setting-row--full setting-row--compact-panel"
                    title={t('mediaLibrary.settings.download.path.title')}
                    description={t('mediaLibrary.settings.download.path.description')}
                  >
                    <div className="settings-cache-panel settings-cache-panel--download">
                      <div className="settings-cache-path">
                        <em>{t('mediaLibrary.settings.download.path.current')}</em>
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
                          {downloadSettings?.outputDirectory ? t('mediaLibrary.settings.download.path.action.change') : t('mediaLibrary.settings.download.path.action.choose')}
                        </button>
                      </div>
                      {downloadDirectoryMessage ? <p className="settings-inline-note">{downloadDirectoryMessage}</p> : null}
                    </div>
                  </SettingRow>
                  <SettingRow
                    id="settings-row-streaming-download-actions"
                    highlighted={highlightedSettingId === 'settings-row-streaming-download-actions'}
                    title={t('mediaLibrary.settings.download.streamingActions.title')}
                    description={t('mediaLibrary.settings.download.streamingActions.description')}
                  >
                    <div className="settings-inline-toggle settings-inline-toggle--compact">
                      <span>{appSettings?.streamingDownloadActionsEnabled ? t('mediaLibrary.settings.download.streamingActions.visible') : t('mediaLibrary.settings.download.streamingActions.hidden')}</span>
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
                title={t('mediaLibrary.settings.playlistBackups.title')}
                description={t('mediaLibrary.settings.playlistBackups.description')}
              >
                <div className="settings-inline-toggle settings-inline-toggle--compact">
                  <span>{appSettings?.playlistBackupsEnabled === false ? t('common.disabled') : t('common.enabled')}</span>
                  <ToggleButton
                    active={appSettings?.playlistBackupsEnabled ?? true}
                    disabled={!appSettings}
                    onClick={() => patchAppSettings({ playlistBackupsEnabled: !(appSettings?.playlistBackupsEnabled ?? true) })}
                  />
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mediaLibrary.settings.duplicates.title')}
                description={t('mediaLibrary.settings.duplicates.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--duplicates">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('mediaLibrary.settings.duplicates.metric.visibility')}</em>
                      <strong>{appSettings?.duplicateTracksEnabled ? t('mediaLibrary.settings.duplicates.value.enabledHidden', { count: duplicateSummary?.hiddenTracks ?? 0 }) : t('common.disabled')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.duplicates.metric.analysis')}</em>
                      <strong>{duplicateSummary ? t('mediaLibrary.settings.duplicates.value.analysis', { groups: duplicateSummary.duplicateGroups, tracks: duplicateSummary.duplicateMembers }) : t('mediaLibrary.health.value.notRead')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.duplicates.metric.updatedAt')}</em>
                      <strong>{duplicateSummary?.updatedAt ? new Date(duplicateSummary.updatedAt).toLocaleString() : t('mediaLibrary.settings.duplicates.value.notAnalyzed')}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('mediaLibrary.settings.duplicates.action.hide')}</span>
                      <ToggleButton
                        active={appSettings?.duplicateTracksEnabled ?? false}
                        disabled={!appSettings || duplicateBusyAction !== null}
                        onClick={() => void handleDuplicateVisibilityToggle()}
                      />
                    </div>
                    <button className="settings-action-button" type="button" disabled={duplicateBusyAction !== null} onClick={() => void handleAnalyzeDuplicateTracks()}>
                      <RotateCw className={duplicateBusyAction === 'analyze' ? 'spinning-icon' : undefined} size={15} />
                      {duplicateBusyAction === 'analyze' ? t('mediaLibrary.settings.duplicates.action.analyzing') : t('mediaLibrary.settings.duplicates.action.analyze')}
                    </button>
                  </div>
                  {appSettings?.duplicateTracksEnabled ? <p className="settings-inline-note">{t('mediaLibrary.settings.duplicates.message.hiddenNow', { count: duplicateSummary?.hiddenTracks ?? 0 })}</p> : null}
                  {duplicateMessage ? <p className="settings-inline-note">{duplicateMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('libraryMaintenance')} />
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-merge-strategy"
                highlighted={highlightedSettingId === 'settings-row-library-merge-strategy'}
                title={t('mediaLibrary.settings.merge.title')}
                description={t('mediaLibrary.settings.merge.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--album">
                  <div className="settings-chip-row settings-chip-row--left">
                    <ChipButton
                      active={(pendingAlbumMergeStrategy ?? appSettings?.albumMergeStrategy ?? 'standard') === 'standard'}
                      onClick={() => setPendingAlbumMergeStrategy('standard')}
                    >
                      {t('mediaLibrary.settings.merge.album.standard')}
                    </ChipButton>
                    <ChipButton
                      active={(pendingAlbumMergeStrategy ?? appSettings?.albumMergeStrategy ?? 'standard') === 'sameTitleAndCover'}
                      onClick={() => setPendingAlbumMergeStrategy('sameTitleAndCover')}
                    >
                      {t('mediaLibrary.settings.merge.album.loose')}
                    </ChipButton>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('mediaLibrary.settings.merge.album.standard')}</em>
                      <strong>{t('mediaLibrary.settings.merge.album.standardDescription')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.merge.album.loose')}</em>
                      <strong>{t('mediaLibrary.settings.merge.album.looseDescription')}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left">
                    <ChipButton
                      active={(pendingArtistMergeStrategy ?? appSettings?.artistMergeStrategy ?? 'standard') === 'conservative'}
                      onClick={() => setPendingArtistMergeStrategy('conservative')}
                    >
                      {t('mediaLibrary.settings.merge.artist.conservative')}
                    </ChipButton>
                    <ChipButton
                      active={(pendingArtistMergeStrategy ?? appSettings?.artistMergeStrategy ?? 'standard') === 'standard'}
                      onClick={() => setPendingArtistMergeStrategy('standard')}
                    >
                      {t('mediaLibrary.settings.merge.artist.standard')}
                    </ChipButton>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('mediaLibrary.settings.merge.artist.conservative')}</em>
                      <strong>{t('mediaLibrary.settings.merge.artist.conservativeDescription')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.merge.artist.standard')}</em>
                      <strong>{t('mediaLibrary.settings.merge.artist.standardDescription')}</strong>
                    </span>
                  </div>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleAlbumMergeStrategyApply()}
                      disabled={!appSettings || albumGroupingBusy}
                    >
                      {albumGroupingBusy ? t('mediaLibrary.settings.merge.action.regrouping') : t('mediaLibrary.settings.merge.action.apply')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleScanLibraryFolders()}
                      disabled={libraryScanActionDisabled}
                    >
                      <RotateCw className={libraryScanActionDisabled ? 'spinning-icon' : undefined} size={15} />
                      {libraryScanActionDisabled ? t('mediaLibrary.settings.scan.action.queued') : t('mediaLibrary.settings.scan.action.scanLibrary')}
                    </button>
                  </div>
                  {albumGroupingMessage ? <p className="settings-inline-note">{albumGroupingMessage}</p> : null}
                  {libraryScanMessage ? <p className="settings-inline-note">{libraryScanMessage}</p> : null}
                  {libraryScanHasVisibleProgress ? (
                    <div className="settings-update-progress settings-library-scan-progress" role="status" aria-live="polite">
                      <div className="settings-update-progress-label">
                        <strong>{libraryScanRunningList.length > 0 ? t('mediaLibrary.settings.scan.progressTitle.running') : t('mediaLibrary.settings.scan.progressTitle.last')}</strong>
                        <span>
                          {libraryScanProgressDone} / {libraryScanProgressTotal || '?'}
                        </span>
                      </div>
                      <div
                        className="settings-update-progress-track"
                        role="progressbar"
                        aria-label={t('mediaLibrary.settings.scan.progressAria')}
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
                      <div className="library-scan-stage-grid">
                        {libraryScanStages.map((stage) => (
                          <span className="library-scan-stage" data-state={stage.state} key={stage.id}>
                            <em>{t(libraryScanStageLabelKeys[stage.id])}</em>
                            <strong>{stage.value}</strong>
                            <small>{t(libraryScanStageMetricLabelKeys[stage.id])}</small>
                          </span>
                        ))}
                      </div>
                      <div className="library-scan-result-panel">
                        {libraryScanRunningList.length === 0 ? <strong>{t('mediaLibrary.scanProgress.summaryTitle')}</strong> : null}
                        <div className="library-scan-result-grid">
                          {libraryScanResultMetrics.map((metric) => (
                            <span key={metric.id}>
                              <em>{t(metric.labelKey)}</em>
                              <strong>{metric.getValue(libraryScanTotals)}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mediaLibrary.settings.embeddedRescan.title')}
                description={t('mediaLibrary.settings.embeddedRescan.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--embedded-tags">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('mediaLibrary.settings.embeddedRescan.all')}</em>
                      <strong>{t('mediaLibrary.settings.embeddedRescan.allDescription')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.embeddedRescan.missingCover')}</em>
                      <strong>{t('mediaLibrary.settings.embeddedRescan.missingCoverDescription')}</strong>
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
                      {embeddedTagRescanBusy === 'all' ? t('mediaLibrary.settings.action.starting') : t('mediaLibrary.settings.embeddedRescan.action.all')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={embeddedTagRescanBusy !== null}
                      onClick={() => void handleRescanEmbeddedTags('missing-cover')}
                    >
                      <RotateCw className={embeddedTagRescanBusy === 'missing-cover' ? 'spinning-icon' : undefined} size={15} />
                      {embeddedTagRescanBusy === 'missing-cover' ? t('mediaLibrary.settings.action.starting') : t('mediaLibrary.settings.embeddedRescan.action.missingCover')}
                    </button>
                  </div>
                  {embeddedTagRescanMessage ? <p className="settings-inline-note">{embeddedTagRescanMessage}</p> : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mediaLibrary.settings.coverCache.title')}
                description={t('mediaLibrary.settings.coverCache.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--cover">
                  {cacheInventory ? (
                    <div className="settings-cache-result">
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.total')}</em>
                        <strong>{formatCacheBytes(cacheInventory.totalSizeBytes)}</strong>
                      </span>
                      {cacheInventory.items.map((item) => (
                        <span key={item.kind}>
                          <em>{item.label}</em>
                          <strong>{t('mediaLibrary.settings.coverCache.fileCount', { size: formatCacheBytes(item.sizeBytes), count: item.fileCount })}</strong>
                          <p title={item.path}>{item.path}</p>
                          <p>
                            {item.movable ? t('mediaLibrary.settings.coverCache.movable') : t('mediaLibrary.settings.coverCache.notMovable')} · {item.reason}
                            {item.lastError ? ` · ${item.lastError}` : ''}
                          </p>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-inline-note">{cacheInventoryBusy ? t('mediaLibrary.settings.coverCache.inventory.loading') : t('mediaLibrary.settings.coverCache.inventory.unavailable')}</p>
                  )}
                  <div className="settings-cache-path">
                    <em>{t('mediaLibrary.settings.coverCache.current')}</em>
                    <strong title={currentCacheDirectoryLabel}>{currentCacheDirectoryLabel}</strong>
                  </div>
                  <p className="settings-inline-note">{t('mediaLibrary.settings.coverCache.echoDirectoryWarning')}</p>
                  <div className="settings-chip-row settings-chip-row--left">
                    <button className="settings-action-button" type="button" onClick={() => void refreshCacheInventory()} disabled={cacheInventoryBusy}>
                      <RefreshCw className={cacheInventoryBusy ? 'spinning-icon' : undefined} size={15} />
                      {t('mediaLibrary.settings.coverCache.action.refresh')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleCacheDirectoryChoose()} disabled={cacheDirectoryBusy}>
                      <FolderOpen size={15} />
                      {t('mediaLibrary.settings.coverCache.action.choose')}
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
                      {t('mediaLibrary.settings.coverCache.action.restoreDefault')}
                    </button>
                  </div>
                  {pendingCacheDirectory !== undefined ? (
                    <div className="settings-cache-confirm">
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.currentShort')}</em>
                        <strong title={currentCacheDirectory}>{currentCacheDirectory || t('mediaLibrary.settings.coverCache.loading')}</strong>
                      </span>
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.newDirectory')}</em>
                        <strong title={pendingResolvedCacheDirectory ?? ''}>{pendingResolvedCacheDirectory ?? t('mediaLibrary.settings.coverCache.defaultLoading')}</strong>
                      </span>
                      <p>{t('mediaLibrary.settings.coverCache.confirmDescription')}</p>
                      <div className="settings-chip-row settings-chip-row--left">
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => void handleCacheDirectoryApply(true)}
                          disabled={cacheDirectoryBusy || !pendingResolvedCacheDirectory}
                        >
                          {t('mediaLibrary.settings.coverCache.action.migrate')}
                        </button>
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => void handleCacheDirectoryApply(false)}
                          disabled={cacheDirectoryBusy || !pendingResolvedCacheDirectory}
                        >
                          {t('mediaLibrary.settings.coverCache.action.switchOnly')}
                        </button>
                        <button
                          className="settings-action-button"
                          type="button"
                          onClick={() => setPendingCacheDirectory(undefined)}
                          disabled={cacheDirectoryBusy}
                        >
                          {t('mediaLibrary.settings.action.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {cacheDirectoryMessage ? <p className="settings-inline-note">{cacheDirectoryMessage}</p> : null}
                  {cacheDirectoryResult ? (
                    <div className="settings-cache-result">
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.result.copied')}</em>
                        <strong>{cacheDirectoryResult.copiedFiles}</strong>
                      </span>
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.result.skipped')}</em>
                        <strong>{cacheDirectoryResult.skippedFiles}</strong>
                      </span>
                      <span>
                        <em>{t('mediaLibrary.settings.coverCache.result.updated')}</em>
                        <strong>{cacheDirectoryResult.updatedCoverRows}</strong>
                      </span>
                      {cacheDirectoryResult.warnings.length ? (
                        <p>{t('mediaLibrary.settings.coverCache.result.warnings', { message: cacheDirectoryResult.warnings.slice(0, 3).join('；') })}</p>
                      ) : null}
                      {cacheDirectoryResult.errors.length ? (
                        <p className="settings-inline-error">{t('mediaLibrary.settings.coverCache.result.errors', { message: cacheDirectoryResult.errors.slice(0, 3).join('；') })}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-library-performance-diagnostics"
                highlighted={highlightedSettingId === 'settings-row-library-performance-diagnostics'}
                title={t('mediaLibrary.settings.performanceDiagnostics.title')}
                description={t('mediaLibrary.settings.performanceDiagnostics.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--library-performance">
                  <div className="settings-status-grid settings-status-grid--library-performance">
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.lastScanDuration')}</em>
                      <strong>{latestLibraryScan ? latestLibraryScanDurationText : t('mediaLibrary.settings.performanceDiagnostics.value.noScan')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.skipRate')}</em>
                      <strong>{latestLibraryScanSkipRateText}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.metadataConcurrency')}</em>
                      <strong>
                        {libraryDiagnostics
                          ? t('mediaLibrary.settings.performanceDiagnostics.value.metadataConcurrency', {
                              count: libraryDiagnostics.metadataConcurrency,
                              cpu: libraryDiagnostics.cpuCount,
                            })
                          : 'n/a'}
                      </strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.coverConcurrency')}</em>
                      <strong>
                        {libraryDiagnostics
                          ? t('mediaLibrary.settings.performanceDiagnostics.value.coverConcurrency', {
                              count: libraryDiagnostics.coverConcurrency,
                            })
                          : 'n/a'}
                      </strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.nativeScanner')}</em>
                      <strong title={nativeFileScannerDiagnostics?.binaryPath ?? undefined}>{nativeFileScannerStatusText}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.slowIpc')}</em>
                      <strong title={latestSlowIpc?.channel ?? undefined}>{latestSlowIpcText}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.rendererStall')}</em>
                      <strong title={latestRendererStall?.route ?? undefined}>{latestRendererStallText}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.performanceDiagnostics.metric.mainStall')}</em>
                      <strong>{latestMainStallText}</strong>
                    </span>
                  </div>
                  <p className="settings-inline-note">{t('mediaLibrary.settings.performanceDiagnostics.note')}</p>
                </div>
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                title={t('mediaLibrary.settings.bpm.title')}
                description={t('mediaLibrary.settings.bpm.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--bpm-analysis">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <div className="settings-inline-toggle">
                      <span>{t('mediaLibrary.settings.bpm.enable')}</span>
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
                      {bpmAnalysisBusy ? t('mediaLibrary.settings.bpm.action.analyzing') : t('mediaLibrary.settings.bpm.action.analyzeMissing')}
                    </button>
                  </div>
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('mediaLibrary.settings.bpm.status')}</em>
                      <strong>{appSettings?.audioAnalysisEnabled ? t('common.enabled') : t('common.disabled')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.bpm.progress')}</em>
                      <strong>{bpmAnalysisJob ? `${bpmAnalysisJob.processedTracks}/${bpmAnalysisJob.totalTracks}` : t('mediaLibrary.settings.bpm.notRun')}</strong>
                    </span>
                    <span>
                      <em>{t('mediaLibrary.settings.bpm.updated')}</em>
                      <strong>{bpmAnalysisJob?.updatedTracks ?? 0}</strong>
                    </span>
                  </div>
                  {bpmAnalysisMessage ? <p className="settings-inline-note">{bpmAnalysisMessage}</p> : null}
                  {bpmAnalysisJob?.errorCount ? <p className="settings-inline-error">{t('mediaLibrary.settings.bpm.errorCount', { count: bpmAnalysisJob.errorCount })}</p> : null}
                </div>
              </SettingRow>
              <SettingSubsectionTitle {...getSettingsSubsection('libraryMetadata')} />
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
              <p className="settings-inline-note">
                使用补全信息、扫描缺失信息或应用全部候选会访问网络并批量处理媒体库，可能造成网络卡顿或播放器短暂卡顿；播放时建议少量操作。
              </p>
              <NetworkMetadataPanel networkMetadataEnabled={networkMetadataEnabled} />
            </SettingSection>

            <SettingSection
              activeKey={activeSection}
              hideHeader={aboutPage === 'contributors'}
              icon={Info}
              id="about"
              title={t('settings.nav.about.label')}
            >
              {aboutPage === 'contributors' ? (
                <Suspense fallback={null}>
                  <ContributorsPage
                    locale={locale}
                    onBack={() => {
                      setAboutPage('overview');
                      scrollSettingsSectionIntoView('about');
                    }}
                  />
                </Suspense>
              ) : (
              <>
              <SettingSubsectionTitle {...getSettingsSubsection('aboutVersion')} />
              <SettingRow title={t('settings.about.version.title')} description={t('settings.about.version.description')}>
                <StatusText tone={appVersion ? 'neutral' : 'muted'}>{appVersion ?? t('common.checking')}</StatusText>
              </SettingRow>
              <SettingRow
                leadingIcon={UsersRound}
                title={settingsLocaleCopy(locale, {
                  'zh-CN': '贡献者',
                  'zh-TW': '貢獻者',
                  'ja-JP': 'コントリビューター',
                  'en-US': 'Contributors',
                  'ko-KR': '기여자',
                })}
                description={settingsLocaleCopy(locale, {
                  'zh-CN': '查看让 ECHO 变得更好的每一位贡献者。',
                  'zh-TW': '查看讓 ECHO 變得更好的每一位貢獻者。',
                  'ja-JP': 'ECHO をより良くしてくれたすべての人を表示します。',
                  'en-US': 'See everyone who helps make ECHO better.',
                  'ko-KR': 'ECHO를 더 좋게 만드는 모든 기여자를 확인합니다.',
                })}
              >
                <button
                  className="settings-action-button"
                  type="button"
                  onClick={() => {
                    setAboutPage('contributors');
                    scrollSettingsSectionIntoView('about');
                  }}
                >
                  <UsersRound size={15} />
                  {settingsLocaleCopy(locale, {
                    'zh-CN': '查看贡献者',
                    'zh-TW': '查看貢獻者',
                    'ja-JP': '一覧を見る',
                    'en-US': 'View contributors',
                    'ko-KR': '기여자 보기',
                  })}
                </button>
              </SettingRow>
              <SettingRow title="Powered by Moekotori" description="反馈问题或联系作者。">
                <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                  <button
                    className="settings-action-button"
                    type="button"
                    onClick={() => void handleOpenExternalUrl(bugFeedbackUrl)}
                  >
                    <Github size={15} />
                    BUG反馈
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    onClick={() => void handleOpenExternalUrl(authorEmailUrl)}
                  >
                    <Mail size={15} />
                    联系作者
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                title={t('settings.about.pro.title')}
                description={echoProUnlockedForStatus ? '已解锁 ECHO Pro。感谢支持 ECHO Next。' : t('settings.about.pro.description')}
              >
                <button className="settings-action-button" type="button" onClick={() => void handleOpenExternalUrl(afdianSponsorUrl)}>
                  {echoProUnlockedForStatus ? <Check size={15} /> : <ExternalLink size={15} />}
                  {echoProUnlockedForStatus ? '已解锁 ECHO Pro' : t('settings.about.pro.action')}
                </button>
              </SettingRow>
              <Suspense fallback={null}>
                <AboutUpdateSettings
                  appVersion={appVersion}
                  autoUpdateAvailable={Boolean(appSettings)}
                  autoUpdateEnabled={appSettings?.autoUpdateEnabled ?? true}
                  busy={updateBusy}
                  currentSource={currentAutoUpdateSource}
                  customUrlDraft={autoUpdateCustomUrlDraft}
                  deferredReleaseNotes={deferredAboutReleaseNotes}
                  downloadPercent={updateDownloadPercent}
                  downloadSizeLabel={updateDownloadSizeLabel}
                  downloadSpeedLabel={updateDownloadSpeedLabel}
                  onAutoUpdateEnabledChange={(autoUpdateEnabled) =>
                    patchAppSettings({ autoUpdateEnabled })
                  }
                  onCheck={() => void handleCheckForUpdates()}
                  onCustomUrlChange={setAutoUpdateCustomUrlDraft}
                  onCustomUrlSave={handleAutoUpdateCustomUrlSave}
                  onOpenRepository={() => void handleOpenRepository()}
                  onOpenUrl={(url) => void handleOpenExternalUrl(url)}
                  onSourceChange={handleAutoUpdateSourceSelect}
                  showDownloadProgress={showUpdateDownloadProgress}
                  status={updateStatus}
                  t={t}
                />
              </Suspense>
              <SettingSubsectionTitle {...getSettingsSubsection('generalData')} />
              <SettingRow
                id="settings-row-settings-export"
                highlighted={highlightedSettingId === 'settings-row-settings-export'}
                title={t('settings.about.settingsExport.title')}
                description={t('settings.about.settingsExport.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={settingsBackupBusy !== null}
                      onClick={() => void handleExportSettings()}
                    >
                      <FileDown size={15} />
                      {settingsBackupBusy === 'export' ? t('settings.about.settingsExport.action.exporting') : t('settings.about.settingsExport.action.export')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={settingsBackupBusy !== null}
                      onClick={() => void handleImportSettings()}
                    >
                      <FileText size={15} />
                      {settingsBackupBusy === 'import' ? t('settings.about.settingsExport.action.importing') : t('settings.about.settingsExport.action.import')}
                    </button>
                  </div>
                  <p className="settings-inline-note">{t('settings.about.settingsExport.note')}</p>
                  {settingsBackupMessage ? <p className="settings-inline-note">{settingsBackupMessage}</p> : null}
                </div>
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
              <SettingSubsectionTitle {...getSettingsSubsection('aboutDiagnostics')} />
              <SettingRow
                id="settings-row-safe-mode"
                highlighted={highlightedSettingId === 'settings-row-safe-mode'}
                title="Safe mode"
                description={t('settings.about.safeMode.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('settings.about.safeMode.status')}</em>
                      <strong>{appSettings?.safeModeEnabled ? t('common.enabled') : t('common.disabled')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.safeMode.scope')}</em>
                      <strong>{t('settings.about.safeMode.scopeEveryLaunch')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.safeMode.startupBehavior')}</em>
                      <strong>{t('settings.about.safeMode.diagnosticsOnly')}</strong>
                    </span>
                    <span>
                      <em>{t('settings.about.safeMode.slowStageThreshold')}</em>
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
                      {t('settings.about.safeMode.action.openConsole')}
                    </button>
                    <button className="settings-action-button" type="button" disabled={diagnosticsBusy} onClick={() => void handleDiagnosticsExportZip()}>
                      <Download size={15} />
                      {diagnosticsBusy ? t('settings.about.diagnostics.action.exporting') : t('settings.about.safeMode.action.exportZip')}
                    </button>
                  </div>
                  <p className="settings-inline-note">
                    {t('settings.about.safeMode.note.powerShell')}
                  </p>
                  <p className="settings-inline-note">
                    {t('settings.about.safeMode.note.beforeAsk')}
                  </p>
                  <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => void handleOpenExternalUrl('https://www.doubao.com/chat/')}
                    >
                      <ExternalLink size={15} />
                      {t('settings.about.safeMode.action.partner')}
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
                title={t('settings.about.diagnosticsAssistant.title')}
                description={t('settings.about.diagnosticsAssistant.description')}
              >
                <DiagnosticsAssistantPanel lastCrashSummary={lastCrashSummary} />
              </SettingRow>
              <SettingRow
                className="setting-row--full setting-row--compact-panel"
                id="settings-row-diagnostics"
                highlighted={highlightedSettingId === 'settings-row-diagnostics'}
                title={t('settings.about.diagnostics.title')}
                description={t('settings.about.diagnostics.description')}
              >
                <div className="settings-cache-panel settings-cache-panel--diagnostics">
                  <div className="settings-status-grid">
                    <span>
                      <em>{t('settings.about.diagnostics.lastCrash')}</em>
                      <strong>{lastCrashSummary ? t('settings.about.diagnostics.detected') : t('settings.about.diagnostics.notDetected')}</strong>
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
                      {diagnosticsBusy ? t('settings.about.diagnostics.action.exporting') : t('settings.about.diagnostics.action.exportMarkdown')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenFolder()}>
                      <FolderOpen size={15} />
                      {t('settings.about.diagnostics.action.openLogs')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenCrashReport()}>
                      <FileText size={15} />
                      {t('settings.about.diagnostics.action.openCrashReport')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenAudioCrashReport()}>
                      <Headphones size={15} />
                      {t('settings.about.diagnostics.action.openAudioReport')}
                    </button>
                    <button className="settings-action-button" type="button" onClick={() => void handleDiagnosticsOpenDevConsole()}>
                      <Code2 size={15} />
                      {t('settings.about.diagnostics.action.openDebugConsole')}
                    </button>
                    <button
                      className="settings-action-button"
                      type="button"
                      disabled={!lastCrashSummary}
                      onClick={() => void handleDiagnosticsClearSummary()}
                    >
                      {t('settings.about.diagnostics.action.clearLastCrash')}
                    </button>
                  </div>
                  {diagnosticsMessage ? <p className="settings-inline-note">{diagnosticsMessage}</p> : null}
                </div>
              </SettingRow>
              </>
              )}
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={AudioLines} id="steam" title={t('settings.nav.steam.label')}>
              <SteamEditionOverview />
            </SettingSection>

            <SettingSection activeKey={activeSection} icon={Trash2} id="danger" title={t('settings.nav.danger.label')}>
              <SettingSubsectionTitle {...getSettingsSubsection('dangerRecovery')} />
              <DatabaseProtectionPanel
                archiveLabel={databaseArchiveLabel}
                badgeLabel={databaseHealthBadgeLabel}
                busy={databaseProtectionBusy}
                busyAction={databaseProtectionBusyAction}
                confirmWord={dangerConfirmWord}
                dataProtectionDisabled={appSettings?.dataProtectionDisabled === true}
                description={databaseProtectionDescription}
                diagnosticsBusy={diagnosticsBusy}
                error={databaseProtectionError}
                message={databaseProtectionMessage}
                onConfirmWordChange={setDangerConfirmWord}
                onCreateSnapshot={() => void handleCreateDatabaseSnapshot()}
                onDiscardQuarantinedTracks={() => void handleDiscardQuarantinedProblemTracks()}
                onExportDiagnostics={() => void handleDiagnosticsExport()}
                onOpenFolder={() => void handleOpenDataProtectionFolder()}
                onPrimaryRecovery={() => void handleDatabasePrimaryRecoveryAction()}
                onRefresh={() => void handleRefreshDatabaseProtectionStatus()}
                onRelaunchRecovery={() => void handleRelaunchLibraryRecoveryMode()}
                pathLabel={databasePathLabel}
                primaryActionBusyLabel={databasePrimaryActionBusyLabel}
                primaryActionDisabled={databasePrimaryActionDisabled}
                primaryActionLabel={databasePrimaryActionLabel}
                primaryActionUnavailableReason={databasePrimaryActionUnavailableReason}
                quarantined={databaseQuarantined}
                recoverySteps={databaseRecoverySteps}
                snapshotLabel={databaseSnapshotLabel}
                status={databaseProtectionStatus}
                t={t}
                unrecoverable={databaseUnrecoverable}
              />
              <DuplicateCleanupSettings
                busyAction={duplicateCleanupBusyAction}
                dangerBusy={dangerBusy}
                expanded={duplicateCleanupResultsExpanded}
                message={duplicateCleanupMessage}
                onApply={() => void handleApplyDuplicateTrackCleanup()}
                onExpandedChange={setDuplicateCleanupResultsExpanded}
                onScan={() => void handleScanDuplicateTrackCleanup()}
                preview={duplicateCleanupPreview}
                t={t}
              />
              <SettingSubsectionTitle {...getSettingsSubsection('dangerCleanup')} />
              <DangerMaintenanceSettings
                busy={dangerBusy}
                hardwareAccelerationDisabled={appSettings?.hardwareAccelerationDisabled === true}
                message={dangerMessage}
                onClearLibraryCache={() => void handleClearLibraryCache()}
                onDeleteAllUserData={() => void handleDeleteAllUserData()}
                onDeleteLibraryDatabase={() => void handleDeleteLibraryDatabase()}
                onHardwareAccelerationToggle={() => void handleHardwareAccelerationToggle()}
                onRepairLibraryDatabase={() => void handleRepairLibraryDatabase()}
                onResetDefaultSettings={() => void handleResetDefaultSettings()}
                t={t}
              />
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
          {activeSection !== 'integrations' && settingsSectionIndexItems.length > 0 ? (
            <SettingsSectionIndex
              activeId={activeSettingsSectionIndexId}
              ariaLabel={t(activeNavItem.labelKey)}
              items={settingsSectionIndexItems}
              onSelect={handleSectionIndexClick}
            />
          ) : null}
        </div>
      </div>
      </div>
      <PlaybackNoSoundGuideDialog
        activeStepIndex={activeNoSoundGuideStepIndex}
        control={playbackNoSoundGuideOpen ? renderNoSoundGuideStepControl() : null}
        onClose={closeNoSoundGuide}
        onStepChange={setPlaybackNoSoundGuideStepIndex}
        open={playbackNoSoundGuideOpen}
        t={t}
      />
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
