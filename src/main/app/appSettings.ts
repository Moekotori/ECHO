import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { app } from 'electron';
import { finalThemeUnlockVersion } from '../../shared/constants/featureUnlocks';
import { artistOnlineInfoSources, artistStreamingAlbumProviders, autoUpdateSources, defaultArtistOnlineInfoSources, defaultArtistStreamingAlbumsProvider } from '../../shared/types/appSettings';
import { defaultSidebarHiddenRouteIds, defaultSidebarRouteOrder, normalizeSidebarHiddenRouteIds, normalizeSidebarRouteOrder } from '../../shared/types/sidebar';
import type {
  ArtistOnlineInfoSource,
  ArtistStreamingAlbumsProvider,
  AirPlayReceiverProtocol,
  AppThemeCustomTheme,
  AppLocale,
  AppThemeMode,
  AppThemePresetOverride,
  AppThemePresetOverrides,
  AppThemeToneOverride,
  AppThemePreset,
  AppearancePreferences,
  AppVideoWallpaperPauseMode,
  AppWallpaperMediaType,
  AppSettings,
  AutoUpdateSource,
  AudioTransportFadeCurve,
  DataBackupIntervalDays,
  DesktopLyricsColorMode,
  LyricsBackgroundMode,
  LyricsMiniPlayerColorMode,
  NetworkProxyMode,
  RememberedAudioOutput,
  DesktopLyricsBounds,
  RememberedWindowSize,
  RemoteAlbumMergeStrategy,
  RemoteBackgroundConcurrencySettings,
  RemoteCoverLoadPerformanceMode,
  ReplayGainMode,
} from '../../shared/types/appSettings';
import type { LyricsProviderId } from '../../shared/types/lyrics';
import type { LibrarySort } from '../../shared/types/library';
import type { MvSettings, NetworkMvProviderId } from '../../shared/types/mv';
import type { HqPlayerDefaultPlaybackBackend, HqPlayerSettings } from '../../shared/types/hqplayer';
import {
  createDefaultGlobalShortcuts,
  createDefaultLocalShortcuts,
  globalShortcutActions,
  validateGlobalShortcutAccelerator,
  type GlobalShortcutAction,
  type GlobalShortcutSettings,
  type GlobalShortcutBinding,
  type LocalShortcutSettings,
} from '../../shared/types/globalShortcuts';
import {
  channelBalanceMaxBalance,
  channelBalanceBandIds,
  channelBalanceBandMaxGainDb,
  channelBalanceBandMinGainDb,
  channelBalanceMaxDelayMs,
  channelBalanceMaxGainDb,
  channelBalanceMinBalance,
  channelBalanceMinDelayMs,
  channelBalanceMinGainDb,
  type AudioEchoSrcMode,
  type AudioEchoSrcQualityProfile,
  type AudioExportFormat,
  type ChannelBalanceMonoMode,
  type ChannelBalanceState,
} from '../../shared/types/audio';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../../shared/constants/replayGain';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const imageWallpaperExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const videoWallpaperExtensions = new Set(['.mp4', '.m4v', '.webm']);
const appWallpaperExtensions = new Set([...imageWallpaperExtensions, ...videoWallpaperExtensions]);
const defaultLyricsColor = '#314054';
const defaultDesktopLyricsColor = '#FFFFFF';
const defaultDesktopLyricsStrokeColor = '#111827';
const defaultDesktopLyricsFontFamily = 'Microsoft YaHei';
const defaultLyricsMiniPlayerColor = '#232120';
const mvNetworkProviders: NetworkMvProviderId[] = ['bilibili', 'youtube'];
const lyricsProviders: LyricsProviderId[] = ['local', 'lrclib', 'amll-ttml', 'netease', 'qqmusic', 'kugou', 'kuwo', 'musixmatch', 'genius', 'manual'];
const legacyDefaultLyricsProviderOrder: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic'];
const defaultLyricsProviderOrder: LyricsProviderId[] = ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo'];
export const defaultNetworkProxyBypassRules = '<local>;localhost;127.0.0.1;::1;*.local;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*';
export const defaultTidalClientId = 'vmtQLf79BHl9YgUT';
const appMemoryVersion = 6;
const locales: AppLocale[] = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP'];
const fallbackLocale: AppLocale = 'zh-CN';
const appThemeModes: AppThemeMode[] = ['light', 'dark', 'system'];
const defaultAppearanceThemeScheduleDarkAt = '19:00';
const defaultAppearanceThemeScheduleLightAt = '07:00';
const defaultAppWindowAcrylicTransparencyPercent = 70;
const audioTransportFadeCurves: AudioTransportFadeCurve[] = ['linear', 'smooth', 'equalPower'];
const defaultAudioTransportFadeDurationMs = 80;
const defaultAudioTransportFadeCurve: AudioTransportFadeCurve = 'smooth';
const remoteCoverLoadPerformanceModes: RemoteCoverLoadPerformanceMode[] = ['low', 'balanced', 'aggressive', 'lan'];
const remoteAlbumMergeStrategies: RemoteAlbumMergeStrategy[] = ['conservative', 'standard'];
const defaultRemoteBackgroundConcurrency: RemoteBackgroundConcurrencySettings = {
  metadata: 2,
  cover: 2,
  lyrics: 1,
  mv: 1,
  durationBackfill: 1,
};
const appThemePresets: AppThemePreset[] = [
  'classic',
  'echoTwilight',
  'sakuraMilk',
  'peachSoda',
  'mintCandy',
  'berryDream',
  'matchaCream',
  'lemonMochi',
  'cottonCloud',
  'melonCream',
  'seaSaltJelly',
  'caramelPudding',
  'neonCandy',
  'nyanCat',
  'childrenDoodle',
  'wisteriaBubble',
  'strawberryCookie',
  'graphiteAurora',
  'amberNoir',
  'oceanStudio',
  'rosewoodVinyl',
  'darkSideMoon',
  'shibuyaNight',
  'kyotoKurenai',
  'ukiyoIndigo',
  'fujiSnow',
  'matsuriLantern',
  'ginzaNoir',
  'frostJazz',
  'FINAL',
];
const themeOverrideColorKeys: Array<keyof Pick<
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
>> = [
  'appBg',
  'appBg2',
  'appBg3',
  'panel',
  'panelSoft',
  'accent',
  'accentStrong',
  'secondary',
  'heading',
  'text',
  'muted',
  'border',
  'onAccent',
  'buttonText',
  'titlebar',
  'sidebar',
  'player',
  'field',
  'row',
  'rowHover',
  'rowActive',
  'chip',
  'focus',
  'danger',
  'success',
  'warning',
];
const maxCustomThemes = 24;
const fallbackCustomThemeTimestamp = '1970-01-01T00:00:00.000Z';
const librarySorts: LibrarySort[] = [
  'default',
  'createdAsc',
  'createdDesc',
  'titleAsc',
  'titleDesc',
  'durationAsc',
  'durationDesc',
  'qualityAsc',
  'qualityDesc',
  'frequent',
  'random',
  'title',
  'artist',
  'artistAlbum',
  'album',
  'recent',
];

export const defaultAppearancePreferences: AppearancePreferences = {
  mainFontFamily: 'Outfit',
  mainFontFilePath: null,
  chineseFontFamily: 'Microsoft YaHei',
  chineseFontFilePath: null,
  fallbackFontFamily: 'Noto Sans SC',
  fallbackFontFilePath: null,
  baseFontSize: 14,
  lineHeight: 1.35,
  textDepth: 62,
  albumCoverShape: 'rounded',
};

const defaultRememberedAudioOutput: RememberedAudioOutput = {
  enabled: true,
  outputMode: 'system',
  sharedBackend: 'auto',
  latencyProfile: 'balanced',
};
export const defaultHqPlayerSettings: HqPlayerSettings = {
  enabled: false,
  connectionMode: 'localDesktop',
  host: '127.0.0.1',
  port: 4321,
  executablePath: null,
  allowLaunch: false,
  mediaServerEnabled: false,
  mediaServerPort: null,
  defaultPlaybackBackend: 'ask',
  profileName: null,
};
const lowLatencyMaxBufferSizeFrames = 2048;

const sanitizeRememberedBufferSizeFrames = (
  outputMode: RememberedAudioOutput['outputMode'],
  latencyProfile: RememberedAudioOutput['latencyProfile'],
  bufferSizeFrames: number,
): number | undefined => {
  if (!Number.isFinite(bufferSizeFrames) || bufferSizeFrames <= 0) {
    return undefined;
  }

  const rounded = Math.round(bufferSizeFrames);
  if (latencyProfile !== 'lowLatency' || rounded <= lowLatencyMaxBufferSizeFrames) {
    return rounded;
  }

  return outputMode === 'shared' ? undefined : lowLatencyMaxBufferSizeFrames;
};

const normalizeRememberedWindowSize = (value: unknown): RememberedWindowSize | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<RememberedWindowSize>;
  const width = Number(input.width);
  const height = Number(input.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: Math.round(clamp(width, 360, 3840)),
    height: Math.round(clamp(height, 620, 2160)),
  };
};

const normalizeDesktopLyricsBounds = (value: unknown): DesktopLyricsBounds | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<DesktopLyricsBounds>;
  const x = Number(input.x);
  const y = Number(input.y);
  const width = Number(input.width);
  const height = Number(input.height);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    x: Math.round(clamp(x, -32000, 32000)),
    y: Math.round(clamp(y, -32000, 32000)),
    width: Math.round(clamp(width, 360, 1600)),
    height: Math.round(clamp(height, 84, 320)),
  };
};

export const getLyricsWallpaperDirectory = (): string => join(app.getPath('userData'), 'lyrics-wallpapers');
export const getAppWallpaperDirectory = (): string => join(app.getPath('userData'), 'app-wallpapers');

const isPathInsideDirectory = (directory: string, filePath: string): boolean => {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

export const defaultChannelBalanceSettings: ChannelBalanceState = {
  enabled: false,
  balance: 0,
  leftGainDb: 0,
  rightGainDb: 0,
  bandGains: {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  },
  leftDelayMs: 0,
  rightDelayMs: 0,
  swapLeftRight: false,
  monoMode: 'off',
  invertLeft: false,
  invertRight: false,
  constantPower: true,
};

export const normalizeSystemLocale = (value: unknown): AppLocale => {
  if (typeof value !== 'string') {
    return fallbackLocale;
  }

  const locale = value.toLowerCase();
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo') || locale.startsWith('zh-hant')) {
    return 'zh-TW';
  }
  if (locale.startsWith('ja')) {
    return 'ja-JP';
  }
  if (locale.startsWith('en')) {
    return 'en-US';
  }
  if (locale.startsWith('zh')) {
    return 'zh-CN';
  }
  return fallbackLocale;
};

const getDefaultLocale = (): AppLocale => {
  try {
    return normalizeSystemLocale(app.getLocale?.());
  } catch {
    return fallbackLocale;
  }
};

export const defaultSettings: AppSettings = {
  appMemoryVersion,
  onboardingCompleted: false,
  locale: getDefaultLocale(),
  appearanceTheme: 'light',
  appearanceThemeScheduleEnabled: false,
  appearanceThemeScheduleDarkAt: defaultAppearanceThemeScheduleDarkAt,
  appearanceThemeScheduleLightAt: defaultAppearanceThemeScheduleLightAt,
  appearanceThemePreset: 'classic',
  appearanceThemePresetOverrides: {},
  appearanceCustomThemes: [],
  appearanceThemeCustomId: null,
  finalThemeUnlockVersion: null,
  appearanceThemePresetsExpanded: false,
  appearanceThemeCustomExpanded: false,
  appearanceSidebarLayoutExpanded: false,
  appWindowAcrylicEnabled: false,
  appWindowAcrylicKeepWhenUnfocusedEnabled: false,
  appWindowAcrylicTransparencyPercent: defaultAppWindowAcrylicTransparencyPercent,
  appearancePreferences: { ...defaultAppearancePreferences },
  sidebarRouteOrder: [...defaultSidebarRouteOrder],
  sidebarHiddenRouteIds: [...defaultSidebarHiddenRouteIds],
  sidebarAutoHideEnabled: false,
  sidebarIconOnlyEnabled: false,
  settingsOptionalSectionsVisible: false,
  featureCommentsHidden: false,
  trackContextMenuExtraActionsEnabled: false,
  touchOnScreenKeyboardEnabled: false,
  songsSort: 'default',
  rememberedAudioOutput: { ...defaultRememberedAudioOutput },
  hiddenAudioDeviceKeys: [],
  audioUseJuceOutput: false,
  audioUseJuceDecode: false,
  audioDsdOutputMode: 'pcm',
  audioAsioNativeDsdExperimentalEnabled: false,
  audioDsdAutoVolumeLockEnabled: false,
  audioAsioUnavailableFallbackEnabled: false,
  audioExclusiveInstabilityFallbackEnabled: false,
  audioSoxrFallbackEnabled: true,
  audioEchoSrcMode: 'off',
  audioEchoSrcQualityProfile: 'transparent',
  audioReleaseExclusiveOnPauseExperimentalEnabled: false,
  audioIssueDiagnosticsWindowEnabled: false,
  albumMergeStrategy: 'standard',
  artistMergeStrategy: 'standard',
  chineseCrossScriptSearchEnabled: true,
  artistWallAlbumArtwork: false,
  artistWallAlbumFallbackForMissingAvatars: false,
  artistStreamingAlbumsEnabled: true,
  artistStreamingAlbumsProvider: defaultArtistStreamingAlbumsProvider,
  autoFetchArtistImages: false,
  artistImageFetchPaused: false,
  liveLibraryUpdatesEnabled: false,
  liveLibraryAutoHideDeletedEnabled: false,
  safeModeEnabled: false,
  fastStartupEnabled: false,
  dataProtectionDisabled: false,
  autoUpdateEnabled: true,
  autoUpdateSource: 'official',
  autoUpdateCustomUrl: null,
  autoAccountCheckOnStartup: true,
  suppressAccountExpiryNotices: true,
  spotifyAutoLaunchOfficialPlayer: true,
  spotifyClientId: null,
  spotifyRedirectUri: null,
  tidalClientId: defaultTidalClientId,
  tidalClientSecret: null,
  tidalRedirectUri: null,
  tidalCountryCode: 'US',
  downloadsFeatureUnlocked: false,
  streamingDownloadActionsEnabled: false,
  connectAutoStartReceiversEnabled: false,
  airPlayReceiverProtocol: 'airplay1',
  hqPlayer: { ...defaultHqPlayerSettings },
  playlistBackupsEnabled: true,
  autoDataBackupEnabled: false,
  autoDataBackupDirectory: null,
  autoDataBackupIntervalDays: 7,
  autoDataBackupLastRunAt: null,
  autoDataBackupLastPath: null,
  autoDataBackupLastError: null,
  coverCacheDir: null,
  hideToTrayOnClose: false,
  rememberWindowSizeEnabled: true,
  rememberedWindowSize: null,
  appCustomWallpaperPath: null,
  appPortraitWallpaperPath: null,
  appWallpaperMediaType: 'image',
  appPortraitWallpaperMediaType: 'image',
  appWallpaperScalePercent: 100,
  appWallpaperBlurPx: 0,
  appWallpaperBrightnessPercent: 100,
  appWallpaperUiOpacityPercent: 100,
  appWallpaperVisualProtectionEnabled: true,
  appWallpaperUnifiedOpacityEnabled: false,
  nowPlayingCoverColorEnabled: false,
  appVideoWallpaperPauseMode: 'smart',
  networkProxyMode: 'off',
  networkProxyUrl: null,
  networkProxyBypassRules: defaultNetworkProxyBypassRules,
  networkProxyPacUrl: null,
  networkMetadataEnabled: true,
  networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
  onlineArtistInfoBandsintownAppId: null,
  onlineArtistInfoTicketmasterApiKey: null,
  onlineArtistInfoSeatGeekClientId: null,
  onlineArtistInfoRegion: null,
  onlineArtistInfoSources: [...defaultArtistOnlineInfoSources],
  onlineAlbumInfoDiscogsUserToken: null,
  audioAnalysisEnabled: true,
  lyricsNetworkEnabled: true,
  lyricsPreferredProvider: 'lrclib',
  lyricsEnabledProviders: [...defaultLyricsProviderOrder],
  lyricsProviderOrder: [...defaultLyricsProviderOrder],
  lyricsProviderTimeoutMs: 4500,
  lyricsTotalMatchTimeoutMs: 6000,
  lyricsCoverAutoAcceptScore: 0.97,
  lyricsDeepSearchEnabled: true,
  lyricsAutoSearch: true,
  lyricsAutoAcceptScore: 0.5,
  lyricsBackfillAutoAcceptScore: 0.45,
  lyricsRestartOnApplyEnabled: false,
  lyricsAutoSaveSidecarEnabled: false,
  lyricsDefaultOffsetMs: 0,
  lyricsGlobalSyncOffsetMs: 0,
  lyricsTimelineCorrectionEnabled: true,
  lyricsOffsetControlsEnabled: true,
  lyricsSmartAlignmentEnabled: true,
  lyricsEnabled: true,
  lyricsHeaderHidden: false,
  lyricsMvAutoShowTrackInfoDisabled: true,
  lyricsCandidatePanelAutoOpenEnabled: false,
  lyricsEmptyStateHidden: true,
  lyricsPlayerBarDrawerEnabled: true,
  lyricsPlayerBarDrawerAutoEnableForMv: true,
  lyricsPlayerBarDrawerAutoHideEnabled: false,
  lyricsPlayerBarDrawerOpacityPercent: 78,
  lyricsPlayerBarDrawerColorMode: 'default',
  lyricsPlayerBarDrawerColor: defaultLyricsMiniPlayerColor,
  lyricsRomanizationEnabled: true,
  lyricsUtatenKanaEnabled: false,
  lyricsTranslationEnabled: true,
  lyricsWordHighlightEnabled: true,
  lyricsWordHighlightClarityPercent: 70,
  lyricsFontSizePx: 40,
  lyricsSecondaryFontSizePx: 22,
  lyricsFontFamily: 'Microsoft YaHei',
  lyricsFontFilePath: null,
  lyricsTextDirection: 'horizontal',
  lyricsLineSpacingPercent: 110,
  lyricsLineMaxChars: 0,
  lyricsContextOpacityPercent: 49,
  lyricsColor: defaultLyricsColor,
  lyricsSmartReadableColorsEnabled: false,
  lyricsHighResolutionNetworkCoverEnabled: false,
  lyricsBackgroundMode: 'theme',
  lyricsCustomWallpaperPath: null,
  lyricsCoverOpacityPercent: 100,
  lyricsCoverBlurPx: 10,
  lyricsCoverBrightnessPercent: 100,
  lyricsBackgroundScalePercent: 100,
  desktopLyricsEnabled: false,
  desktopLyricsLocked: false,
  desktopLyricsFontSizePx: 34,
  desktopLyricsScalePercent: 100,
  desktopLyricsFontFamily: defaultDesktopLyricsFontFamily,
  desktopLyricsFontFilePath: null,
  desktopLyricsColorMode: 'theme',
  desktopLyricsColor: defaultDesktopLyricsColor,
  desktopLyricsStrokeColor: defaultDesktopLyricsStrokeColor,
  desktopLyricsOpacityPercent: 96,
  desktopLyricsTextDirection: 'horizontal',
  desktopLyricsRomanizationEnabled: true,
  desktopLyricsTranslationEnabled: true,
  desktopLyricsBounds: null,
  miniPlayerEnabled: false,
  miniPlayerLocked: false,
  miniPlayerAutoHideMainWindow: true,
  miniPlayerBounds: null,
  mvEnabled: true,
  mvEnabledProviders: ['bilibili', 'youtube'],
  mvProviderOrder: ['bilibili', 'youtube'],
  mvAutoSearch: true,
  mvAutoPreload: true,
  mvAutoApplyThreshold: 0.7,
  mvPreferHighestViewCount: false,
  mvImmersiveBackground: true,
  mvImmersiveBackgroundAutoScale: true,
  mvImmersiveBackgroundScalePercent: 115,
  mvImmersiveBackgroundOffsetXPercent: 50,
  mvImmersiveBackgroundOffsetYPercent: 50,
  mvImmersiveBackgroundBlurPx: 0,
  mvImmersiveBackgroundBrightnessPercent: 100,
  mvImmersiveBackgroundOverlayOpacityPercent: 0,
  mvLyricsReadabilityEnhanced: false,
  mvHideLyrics: false,
  mvRestartAudioOnLoad: false,
  mvSyncMode: 'balanced',
  mvReplayAudioOnChange: true,
  mvMaxQuality: 'max',
  mvAllow60fps: true,
  channelBalance: defaultChannelBalanceSettings,
  playerVolume: 1,
  homeWaveformVisualizerEnabled: true,
  audioVisualSpectrumEnabled: false,
  lowLoadPlaybackModeEnabled: false,
  lowLoadPlaybackEnhancementsEnabled: false,
  homeRandomHeroTitleEnabled: false,
  playerWaveformProgressEnabled: false,
  signalPathControlEnabled: true,
  fixedVolumeEnabled: false,
  gaplessPlaybackEnabled: false,
  audioTransportFadeEnabled: false,
  audioTransportFadeInMs: defaultAudioTransportFadeDurationMs,
  audioTransportFadeOutMs: defaultAudioTransportFadeDurationMs,
  audioTransportFadeCurve: defaultAudioTransportFadeCurve,
  replayGainEnabled: false,
  replayGainMode: 'track',
  replayGainTargetLufs: DEFAULT_REPLAY_GAIN_TARGET_LUFS,
  replayGainPreampDb: 0,
  replayGainPreventClipping: true,
  replayGainAnalyzeOnPlay: true,
  replayGainAnalyzeMissingOnScanOptIn: false,
  replayGainAnalyzeMissingOnScan: false,
  backgroundSpacePauseEnabled: false,
  localShortcuts: createDefaultLocalShortcuts(),
  globalShortcuts: createDefaultGlobalShortcuts(),
  audioExportFormat: 'mp3',
  playbackSpeed: 1,
  playbackSpeedMode: 'nightcore',
  scanPerformanceMode: 'balanced',
  nativeFileScannerEnabled: false,
  nativeMetadataReaderEnabled: false,
  remoteCoverLoadPerformanceMode: 'balanced',
  remoteAlbumMergeStrategy: 'conservative',
  remoteBackgroundConcurrency: { ...defaultRemoteBackgroundConcurrency },
  duplicateTracksEnabled: true,
  duplicateTracksMode: 'strict',
  duplicateTracksAutoRebuildAfterScan: false,
  discordRichPresenceEnabled: true,
  lastFmEnabled: false,
  lastFmUsername: null,
  lastFmSessionKey: null,
  lastFmScrobbleEnabled: true,
  lastFmNowPlayingEnabled: true,
  lastFmMinScrobbleSeconds: 30,
  lastFmAuthToken: null,
  smtcEnabled: true,
  smtcLyricsEnabled: false,
  taskbarPlaybackControlsEnabled: false,
};

let cachedSettingsSource: Partial<AppSettings> | null = null;
let cachedSettings: AppSettings | null = null;
let finalThemeUnlockAvailable = false;

export type NormalizeSettingsOptions = {
  finalThemeUnlocked?: boolean;
};

const getSettingsPath = (): string => join(app.getPath('userData'), 'echo-settings.json');

const normalizeCoverCacheDir = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? resolve(trimmed) : null;
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSpotifyClientId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9]{8,128}$/u.test(normalized) ? normalized : null;
};

const normalizeSpotifyRedirectUri = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/[\r\n]/g, '').trim();
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const port = Number.parseInt(url.port, 10);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return `${url.origin}${url.pathname || '/'}`;
  } catch {
    return null;
  }
};

const normalizeTidalClientId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{8,128}$/u.test(normalized) ? normalized : null;
};

const normalizeTidalClientSecret = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9._~+/=-]{8,256}$/u.test(normalized) ? normalized : null;
};

const normalizeTidalCountryCode = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
};

const normalizeRequiredText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.replace(/[\r\n;]/g, '').trim();
  return normalized || fallback;
};

const normalizeFontPath = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/[\r\n]/g, '').trim();
  return normalized || null;
};

const normalizeNullablePort = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 65535 ? numeric : null;
};

const normalizeHqPlayerBackend = (value: unknown): HqPlayerDefaultPlaybackBackend =>
  value === 'echoNative' || value === 'hqplayer' || value === 'ask' ? value : defaultHqPlayerSettings.defaultPlaybackBackend;

export const normalizeAirPlayReceiverProtocol = (value: unknown): AirPlayReceiverProtocol =>
  value === 'airplay2' ? 'airplay2' : 'airplay1';

const normalizeRemoteBackgroundConcurrency = (value: unknown): RemoteBackgroundConcurrencySettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultRemoteBackgroundConcurrency };
  }

  const input = value as Partial<Record<keyof RemoteBackgroundConcurrencySettings, unknown>>;
  const normalizeLimit = (key: keyof RemoteBackgroundConcurrencySettings, min: number, max: number): number => {
    const numeric = Number(input[key]);
    return Number.isFinite(numeric)
      ? Math.round(clamp(numeric, min, max))
      : defaultRemoteBackgroundConcurrency[key];
  };

  return {
    metadata: normalizeLimit('metadata', 1, 8),
    cover: normalizeLimit('cover', 1, 48),
    lyrics: normalizeLimit('lyrics', 1, 4),
    mv: normalizeLimit('mv', 1, 4),
    durationBackfill: normalizeLimit('durationBackfill', 1, 4),
  };
};

export const normalizeHqPlayerSettings = (value: unknown): HqPlayerSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultHqPlayerSettings };
  }

  const input = value as Partial<HqPlayerSettings>;
  return {
    enabled: input.enabled === true,
    connectionMode: input.connectionMode === 'remote' ? 'remote' : 'localDesktop',
    host: normalizeRequiredText(input.host, defaultHqPlayerSettings.host).slice(0, 255),
    port: normalizeNullablePort(input.port) ?? defaultHqPlayerSettings.port,
    executablePath: normalizeFontPath(input.executablePath),
    allowLaunch: input.allowLaunch === true,
    mediaServerEnabled: input.mediaServerEnabled === true,
    mediaServerPort: normalizeNullablePort(input.mediaServerPort),
    defaultPlaybackBackend: normalizeHqPlayerBackend(input.defaultPlaybackBackend),
    profileName: normalizeOptionalText(input.profileName)?.slice(0, 120) ?? null,
  };
};

const normalizeLocale = (value: unknown): AppLocale =>
  locales.includes(value as AppLocale) ? (value as AppLocale) : getDefaultLocale();

const normalizeAppearanceTheme = (value: unknown): AppThemeMode =>
  appThemeModes.includes(value as AppThemeMode) ? (value as AppThemeMode) : defaultSettings.appearanceTheme;

const normalizeThemeScheduleTime = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  return match ? `${match[1]}:${match[2]}` : fallback;
};

const normalizeAppearanceThemePreset = (value: unknown): AppThemePreset =>
  appThemePresets.includes(value as AppThemePreset) ? (value as AppThemePreset) : defaultSettings.appearanceThemePreset ?? 'classic';

const normalizeThemeHexColorSetting = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : undefined;
};

const dataBackupIntervals: DataBackupIntervalDays[] = [3, 7, 30];

const normalizeDataBackupIntervalDays = (value: unknown): DataBackupIntervalDays => {
  const numeric = Number(value);
  return dataBackupIntervals.includes(numeric as DataBackupIntervalDays) ? (numeric as DataBackupIntervalDays) : 7;
};

const normalizeDataBackupDirectory = (value: unknown): string | null => normalizeCoverCacheDir(value);

const normalizeBackupTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : trimmed.slice(0, 64);
};

const normalizeBackupMessage = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 1000) : null;
};

const normalizeThemeOverrideNumber = (value: unknown, min: number, max: number, decimals = 0): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const factor = 10 ** decimals;
  return Math.round(clamp(numeric, min, max) * factor) / factor;
};

const normalizeThemeOverridePercent = (value: unknown, min: number, max: number): number | undefined => {
  const normalized = normalizeThemeOverrideNumber(value, min, max);
  return normalized === undefined ? undefined : Math.round(normalized);
};

const normalizeThemeToneOverride = (value: unknown): AppThemeToneOverride | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemeToneOverride>;
  const output: AppThemeToneOverride = {};

  for (const key of themeOverrideColorKeys) {
    const color = normalizeThemeHexColorSetting(input[key]);
    if (color) {
      (output as Record<string, string>)[key] = color;
    }
  }

  const panelOpacityPercent = normalizeThemeOverridePercent(input.panelOpacityPercent, 40, 100);
  const glassPercent = normalizeThemeOverridePercent(input.glassPercent, 0, 80);
  const shadowPercent = normalizeThemeOverridePercent(input.shadowPercent, 0, 100);
  const cornerRadiusPx = normalizeThemeOverridePercent(input.cornerRadiusPx, 0, 28);
  const panelBlurPx = normalizeThemeOverridePercent(input.panelBlurPx, 0, 32);
  const saturationPercent = normalizeThemeOverridePercent(input.saturationPercent, 60, 140);
  const motionSpeedSeconds = normalizeThemeOverrideNumber(input.motionSpeedSeconds, 0.12, 8, 2);
  const motionIntensityPercent = normalizeThemeOverridePercent(input.motionIntensityPercent, 0, 160);

  if (panelOpacityPercent !== undefined) {
    output.panelOpacityPercent = panelOpacityPercent;
  }
  if (glassPercent !== undefined) {
    output.glassPercent = glassPercent;
  }
  if (shadowPercent !== undefined) {
    output.shadowPercent = shadowPercent;
  }
  if (cornerRadiusPx !== undefined) {
    output.cornerRadiusPx = cornerRadiusPx;
  }
  if (panelBlurPx !== undefined) {
    output.panelBlurPx = panelBlurPx;
  }
  if (saturationPercent !== undefined) {
    output.saturationPercent = saturationPercent;
  }
  if (typeof input.motionEnabled === 'boolean') {
    output.motionEnabled = input.motionEnabled;
  }
  if (motionSpeedSeconds !== undefined) {
    output.motionSpeedSeconds = motionSpeedSeconds;
  }
  if (motionIntensityPercent !== undefined) {
    output.motionIntensityPercent = motionIntensityPercent;
  }

  return Object.keys(output).length > 0 ? output : undefined;
};

const normalizeThemePresetOverride = (value: unknown): AppThemePresetOverride | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemePresetOverride>;
  const light = normalizeThemeToneOverride(input.light);
  const dark = normalizeThemeToneOverride(input.dark);
  const output: AppThemePresetOverride = {};

  if (light) {
    output.light = light;
  }
  if (dark) {
    output.dark = dark;
  }

  return Object.keys(output).length > 0 ? output : undefined;
};

const normalizeThemePresetOverrides = (value: unknown): AppThemePresetOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Partial<Record<string, unknown>>;
  const output: AppThemePresetOverrides = {};

  for (const preset of appThemePresets) {
    const override = normalizeThemePresetOverride(input[preset]);
    if (override) {
      output[preset] = override;
    }
  }

  return output;
};

const normalizeThemeCustomIdValue = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? normalized : null;
};

const normalizeThemeCustomTimestamp = (value: unknown): string => {
  if (typeof value !== 'string') {
    return fallbackCustomThemeTimestamp;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 64) : fallbackCustomThemeTimestamp;
};

const normalizeThemeCustomName = (value: unknown): string => {
  const normalized = normalizeRequiredText(value, '我的主题');
  return normalized.slice(0, 48);
};

const normalizeThemeCustomTheme = (value: unknown): AppThemeCustomTheme | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Partial<AppThemeCustomTheme>;
  const id = normalizeThemeCustomIdValue(input.id);
  if (!id) {
    return undefined;
  }

  const light = normalizeThemeToneOverride(input.light);
  const dark = normalizeThemeToneOverride(input.dark);
  const output: AppThemeCustomTheme = {
    id,
    name: normalizeThemeCustomName(input.name),
    basePreset: normalizeAppearanceThemePreset(input.basePreset),
    createdAt: normalizeThemeCustomTimestamp(input.createdAt),
    updatedAt: normalizeThemeCustomTimestamp(input.updatedAt),
  };

  if (light) {
    output.light = light;
  }
  if (dark) {
    output.dark = dark;
  }

  return output;
};

const normalizeThemeCustomThemes = (value: unknown): AppThemeCustomTheme[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: AppThemeCustomTheme[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (output.length >= maxCustomThemes) {
      break;
    }

    const theme = normalizeThemeCustomTheme(item);
    if (!theme || seenIds.has(theme.id)) {
      continue;
    }

    output.push(theme);
    seenIds.add(theme.id);
  }

  return output;
};

const normalizeThemeCustomId = (value: unknown, themes: AppThemeCustomTheme[]): string | null => {
  const id = normalizeThemeCustomIdValue(value);
  return id && themes.some((theme) => theme.id === id) ? id : null;
};

const normalizeSongsSort = (value: unknown): LibrarySort =>
  librarySorts.includes(value as LibrarySort) ? (value as LibrarySort) : 'default';

const normalizeReplayGainMode = (value: unknown): ReplayGainMode =>
  value === 'track' || value === 'album' || value === 'off' ? value : 'track';

const normalizeAudioTransportFadeCurve = (value: unknown): AudioTransportFadeCurve =>
  audioTransportFadeCurves.includes(value as AudioTransportFadeCurve)
    ? (value as AudioTransportFadeCurve)
    : defaultAudioTransportFadeCurve;

const normalizeAudioTransportFadeDurationMs = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.round(clamp(numeric, 0, 2000))
    : defaultAudioTransportFadeDurationMs;
};

const normalizeAudioExportFormat = (value: unknown): AudioExportFormat =>
  value === 'wav' || value === 'flac' || value === 'ogg' || value === 'mp3' ? value : defaultSettings.audioExportFormat ?? 'mp3';

const normalizeAudioEchoSrcMode = (value: unknown): AudioEchoSrcMode =>
  value === 'family2x' || value === 'family4x' || value === 'family8x' ? value : 'off';

const normalizeAudioEchoSrcQualityProfile = (value: unknown): AudioEchoSrcQualityProfile =>
  value === 'balanced' || value === 'lowLatency' ? value : 'transparent';

const normalizeAppearanceFontFamily = (value: unknown, fallback: string): string => {
  return normalizeRequiredText(value, fallback);
};

const normalizeAlbumCoverShape = (value: unknown): AppearancePreferences['albumCoverShape'] =>
  value === 'square' ? 'square' : 'rounded';

const normalizeAppearancePreferences = (value: unknown): AppearancePreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultAppearancePreferences };
  }

  const input = value as Partial<AppearancePreferences>;
  const baseFontSize = Number(input.baseFontSize);
  const lineHeight = Number(input.lineHeight);
  const textDepth = Number(input.textDepth);

  return {
    mainFontFamily: normalizeAppearanceFontFamily(input.mainFontFamily, defaultAppearancePreferences.mainFontFamily),
    mainFontFilePath: normalizeFontPath(input.mainFontFilePath),
    chineseFontFamily: normalizeAppearanceFontFamily(input.chineseFontFamily, defaultAppearancePreferences.chineseFontFamily),
    chineseFontFilePath: normalizeFontPath(input.chineseFontFilePath),
    fallbackFontFamily: normalizeAppearanceFontFamily(input.fallbackFontFamily, defaultAppearancePreferences.fallbackFontFamily),
    fallbackFontFilePath: normalizeFontPath(input.fallbackFontFilePath),
    baseFontSize: Number.isFinite(baseFontSize)
      ? clamp(baseFontSize, 12, 18)
      : defaultAppearancePreferences.baseFontSize,
    lineHeight: Number.isFinite(lineHeight)
      ? clamp(lineHeight, 1.1, 1.8)
      : defaultAppearancePreferences.lineHeight,
    textDepth: Number.isFinite(textDepth)
      ? clamp(textDepth, 35, 100)
      : defaultAppearancePreferences.textDepth,
    albumCoverShape: normalizeAlbumCoverShape(input.albumCoverShape),
  };
};

const normalizeRememberedAudioOutput = (value: unknown): RememberedAudioOutput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultRememberedAudioOutput };
  }

  const input = value as Partial<RememberedAudioOutput>;
  const outputMode =
    input.outputMode === 'shared' || input.outputMode === 'exclusive' || input.outputMode === 'asio' || input.outputMode === 'system'
      ? input.outputMode
      : defaultRememberedAudioOutput.outputMode;
  const sharedBackend =
    input.sharedBackend === 'directsound' || input.sharedBackend === 'windows' || input.sharedBackend === 'alsa'
      ? input.sharedBackend
      : defaultRememberedAudioOutput.sharedBackend;
  const latencyProfile =
    input.latencyProfile === 'stable' || input.latencyProfile === 'balanced' || input.latencyProfile === 'lowLatency'
      ? input.latencyProfile
      : defaultRememberedAudioOutput.latencyProfile;
  const deviceIndex = Number(input.deviceIndex);
  const deviceName = normalizeOptionalText(input.deviceName) ?? undefined;
  const asioOutputChannelStart = Number(input.asioOutputChannelStart);
  const bufferSizeFrames = Number(input.bufferSizeFrames);
  const normalized: RememberedAudioOutput = {
    enabled: input.enabled === true,
    outputMode,
    sharedBackend,
    latencyProfile,
    deviceIndex: Number.isInteger(deviceIndex) ? deviceIndex : undefined,
    deviceName,
    asioOutputChannelStart: outputMode === 'asio' && Number.isInteger(asioOutputChannelStart) && asioOutputChannelStart >= 0
      ? Math.round(asioOutputChannelStart)
      : undefined,
  };

  const normalizedBufferSizeFrames = sanitizeRememberedBufferSizeFrames(outputMode, latencyProfile, bufferSizeFrames);
  if (normalizedBufferSizeFrames !== undefined) {
    normalized.bufferSizeFrames = normalizedBufferSizeFrames;
  }

  return normalized;
};

const migrateRememberedAudioOutput = (
  remembered: RememberedAudioOutput,
  sourceAppMemoryVersion: number,
): RememberedAudioOutput => {
  if (sourceAppMemoryVersion >= 5 || remembered.outputMode !== 'exclusive') {
    return remembered;
  }

  return {
    enabled: remembered.enabled,
    outputMode: 'system',
    sharedBackend: 'auto',
    latencyProfile: 'balanced',
  };
};

const normalizeMiniPlayerBounds = (value: unknown): DesktopLyricsBounds | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<DesktopLyricsBounds>;
  const x = Number(input.x);
  const y = Number(input.y);
  const width = Number(input.width);
  const height = Number(input.height);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    x: Math.round(clamp(x, -32000, 32000)),
    y: Math.round(clamp(y, -32000, 32000)),
    width: Math.round(clamp(width, 320, 388)),
    height: 74,
  };
};

const normalizeHiddenAudioDeviceKeys = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)));
};

const cloneShortcutSettings = <T extends Record<GlobalShortcutAction, GlobalShortcutBinding>>(settings: T): T =>
  Object.fromEntries(
    globalShortcutActions.map((action) => [
      action,
      {
        ...settings[action],
      },
    ]),
  ) as T;

const normalizeShortcutSettings = <T extends Record<GlobalShortcutAction, GlobalShortcutBinding>>(value: unknown, defaults: T): T => {
  const shortcuts = cloneShortcutSettings(defaults);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return shortcuts;
  }

  const input = value as Partial<Record<GlobalShortcutAction, Partial<GlobalShortcutBinding>>>;
  const usedAccelerators = new Set<string>();

  for (const action of globalShortcutActions) {
    const binding = input[action];
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      continue;
    }

    const validation = validateGlobalShortcutAccelerator(binding.accelerator);
    if (!validation.valid || !validation.accelerator) {
      shortcuts[action] = { enabled: false, accelerator: null };
      continue;
    }

    const accelerator = validation.accelerator;
    const acceleratorKey = accelerator.toLowerCase();
    if (usedAccelerators.has(acceleratorKey)) {
      shortcuts[action] = { enabled: false, accelerator: null };
      continue;
    }

    usedAccelerators.add(acceleratorKey);
    shortcuts[action] = {
      enabled: binding.enabled === true,
      accelerator,
    };
  }

  return shortcuts;
};

const normalizeGlobalShortcuts = (value: unknown): GlobalShortcutSettings =>
  normalizeShortcutSettings(value, createDefaultGlobalShortcuts());

const normalizeLocalShortcuts = (value: unknown): LocalShortcutSettings =>
  normalizeShortcutSettings(value, createDefaultLocalShortcuts());

const normalizeHexColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
};

const normalizeLyricsColor = (value: unknown): string => normalizeHexColor(value, defaultLyricsColor);

const normalizeLyricsBackgroundMode = (value: unknown): LyricsBackgroundMode =>
  value === 'cover' || value === 'coverColor' || value === 'customWallpaper' || value === 'theme'
    ? value
    : defaultSettings.lyricsBackgroundMode;

const normalizeLyricsTextDirection = (value: unknown): AppSettings['lyricsTextDirection'] =>
  value === 'vertical' || value === 'horizontal' ? value : defaultSettings.lyricsTextDirection ?? 'horizontal';

const normalizeLyricsMiniPlayerColorMode = (value: unknown): LyricsMiniPlayerColorMode =>
  value === 'custom' || value === 'cover' || value === 'default' ? value : defaultSettings.lyricsPlayerBarDrawerColorMode ?? 'default';

const normalizeDesktopLyricsColorMode = (value: unknown, legacyColor: unknown): DesktopLyricsColorMode => {
  if (value === 'theme' || value === 'custom') {
    return value;
  }

  return normalizeHexColor(legacyColor, defaultDesktopLyricsColor) !== defaultDesktopLyricsColor
    ? 'custom'
    : defaultSettings.desktopLyricsColorMode ?? 'theme';
};

const normalizeMvProviderList = (value: unknown, fallback: NetworkMvProviderId[]): NetworkMvProviderId[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const providers = value.filter((provider): provider is NetworkMvProviderId =>
    mvNetworkProviders.includes(provider as NetworkMvProviderId),
  );
  return [...new Set(providers)];
};

const normalizeLyricsProviderList = (value: unknown, fallback: LyricsProviderId[]): LyricsProviderId[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const providers = value.filter((provider): provider is LyricsProviderId => lyricsProviders.includes(provider as LyricsProviderId));
  return [...new Set(providers)];
};

const migrateLegacyDefaultLyricsProviders = (providers: LyricsProviderId[]): LyricsProviderId[] => {
  const providerSet = new Set(providers);
  const isLegacyDefaultEnabled = legacyDefaultLyricsProviderOrder.every((provider) => providerSet.has(provider));
  if (!isLegacyDefaultEnabled) {
    return providers;
  }

  return [
    ...providers,
    ...defaultLyricsProviderOrder.filter((provider) => !providerSet.has(provider)),
  ];
};

const normalizeArtistOnlineInfoSources = (value: unknown): ArtistOnlineInfoSource[] => {
  if (!Array.isArray(value)) {
    return [...defaultArtistOnlineInfoSources];
  }

  const source = value.find((item): item is ArtistOnlineInfoSource =>
    item !== 'moegirl' && artistOnlineInfoSources.includes(item as ArtistOnlineInfoSource),
  );
  return source ? [source] : [...defaultArtistOnlineInfoSources];
};

const normalizeArtistStreamingAlbumsProvider = (value: unknown): ArtistStreamingAlbumsProvider =>
  artistStreamingAlbumProviders.includes(value as ArtistStreamingAlbumsProvider)
    ? (value as ArtistStreamingAlbumsProvider)
    : defaultArtistStreamingAlbumsProvider;

const normalizeMvMaxQuality = (value: unknown): MvSettings['maxQuality'] =>
  value === '720p' || value === '1080p' || value === '1440p' || value === '2160p' || value === 'max' ? value : defaultSettings.mvMaxQuality;

const normalizeMvSyncMode = (value: unknown): MvSettings['syncMode'] =>
  value === 'stable' || value === 'precise' || value === 'balanced' ? value : defaultSettings.mvSyncMode;

const normalizeAutoUpdateSource = (value: unknown): AutoUpdateSource =>
  autoUpdateSources.includes(value as AutoUpdateSource) ? (value as AutoUpdateSource) : defaultSettings.autoUpdateSource ?? 'official';

const normalizeAutoUpdateCustomUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.replace(/[\r\n]/g, '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.toString().replace(/\/+$/u, '');
  } catch {
    return null;
  }
};

const normalizeWallpaperPath = (value: unknown, directory: string, allowedExtensions: Set<string>): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = resolve(value.trim());
  if (!normalized || !allowedExtensions.has(extname(normalized).toLowerCase())) {
    return null;
  }

  if (!isPathInsideDirectory(directory, normalized) || !existsSync(normalized)) {
    return null;
  }

  return normalized;
};

const inferAppWallpaperMediaType = (filePath: string | null): AppWallpaperMediaType =>
  filePath && videoWallpaperExtensions.has(extname(filePath).toLowerCase()) ? 'video' : 'image';

const normalizeAppWallpaperMediaType = (filePath: string | null): AppWallpaperMediaType =>
  filePath ? inferAppWallpaperMediaType(filePath) : 'image';

const normalizeAppVideoWallpaperPauseMode = (value: unknown): AppVideoWallpaperPauseMode =>
  value === 'minimized' || value === 'never' || value === 'smart' ? value : defaultSettings.appVideoWallpaperPauseMode ?? 'smart';

const normalizeNetworkProxyUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.replace(/[\r\n]/g, '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(candidate);
    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'socks:' &&
      url.protocol !== 'socks4:' &&
      url.protocol !== 'socks5:'
    ) {
      return null;
    }
    if (!url.hostname || !url.port) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeNetworkProxyPacUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.replace(/[\r\n]/g, '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeNetworkProxyBypassRules = (value: unknown): string => {
  if (typeof value !== 'string') {
    return defaultNetworkProxyBypassRules;
  }

  const normalized = value
    .replace(/[\r\n]/g, ';')
    .split(/[;,]/u)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 80)
    .join(';');
  return normalized || defaultNetworkProxyBypassRules;
};

const normalizeNetworkProxyMode = (value: unknown, proxyUrl: string | null, pacUrl: string | null): NetworkProxyMode => {
  if (value === 'system') {
    return 'system';
  }
  if (value === 'manual') {
    return proxyUrl ? 'manual' : 'off';
  }
  if (value === 'pac') {
    return pacUrl ? 'pac' : 'off';
  }
  return 'off';
};

const normalizeLyricsWallpaperPath = (value: unknown): string | null =>
  normalizeWallpaperPath(value, getLyricsWallpaperDirectory(), imageWallpaperExtensions);

const normalizeAppWallpaperPath = (value: unknown): string | null =>
  normalizeWallpaperPath(value, getAppWallpaperDirectory(), appWallpaperExtensions);

export const normalizeChannelBalanceSettings = (value: unknown): ChannelBalanceState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultChannelBalanceSettings };
  }

  const input = value as Partial<ChannelBalanceState>;
  const balance = Number(input.balance);
  const leftGainDb = Number(input.leftGainDb);
  const rightGainDb = Number(input.rightGainDb);
  const leftDelayMs = Number(input.leftDelayMs);
  const rightDelayMs = Number(input.rightDelayMs);
  const rawBandGains = input.bandGains && typeof input.bandGains === 'object' && !Array.isArray(input.bandGains)
    ? input.bandGains as Partial<NonNullable<ChannelBalanceState['bandGains']>>
    : {};
  const bandGains = channelBalanceBandIds.reduce<NonNullable<ChannelBalanceState['bandGains']>>((next, bandId) => {
    const band = rawBandGains[bandId];
    const leftBandGainDb = Number(band?.leftGainDb);
    const rightBandGainDb = Number(band?.rightGainDb);
    next[bandId] = {
      leftGainDb: Number.isFinite(leftBandGainDb) ? clamp(leftBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb) : 0,
      rightGainDb: Number.isFinite(rightBandGainDb) ? clamp(rightBandGainDb, channelBalanceBandMinGainDb, channelBalanceBandMaxGainDb) : 0,
    };
    return next;
  }, {
    low: { leftGainDb: 0, rightGainDb: 0 },
    mid: { leftGainDb: 0, rightGainDb: 0 },
    high: { leftGainDb: 0, rightGainDb: 0 },
  });
  const monoMode: ChannelBalanceMonoMode =
    input.monoMode === 'sum' || input.monoMode === 'left' || input.monoMode === 'right' || input.monoMode === 'off'
      ? input.monoMode
      : defaultChannelBalanceSettings.monoMode;

  return {
    enabled: input.enabled === true,
    balance: Number.isFinite(balance) ? clamp(balance, channelBalanceMinBalance, channelBalanceMaxBalance) : 0,
    leftGainDb: Number.isFinite(leftGainDb) ? clamp(leftGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : 0,
    rightGainDb: Number.isFinite(rightGainDb) ? clamp(rightGainDb, channelBalanceMinGainDb, channelBalanceMaxGainDb) : 0,
    bandGains,
    leftDelayMs: Number.isFinite(leftDelayMs) ? clamp(leftDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : 0,
    rightDelayMs: Number.isFinite(rightDelayMs) ? clamp(rightDelayMs, channelBalanceMinDelayMs, channelBalanceMaxDelayMs) : 0,
    swapLeftRight: input.swapLeftRight === true,
    monoMode,
    invertLeft: input.invertLeft === true,
    invertRight: input.invertRight === true,
    constantPower: input.constantPower !== false,
  };
};

export const normalizeSettings = (value: unknown, options: NormalizeSettingsOptions = {}): AppSettings => {
  if (!value || typeof value !== 'object') {
    return { ...defaultSettings };
  }

  const settings = value as Partial<AppSettings>;
  const normalizedAppMemoryVersion = Number(settings.appMemoryVersion);
  const sourceAppMemoryVersion = Number.isFinite(normalizedAppMemoryVersion)
    ? Math.max(0, Math.round(normalizedAppMemoryVersion))
    : 0;
  const playerVolume = Number(settings.playerVolume);
  const playbackSpeed = Number(settings.playbackSpeed);
  const albumMergeStrategy =
    settings.albumMergeStrategy === 'sameTitleAndCover' || settings.albumMergeStrategy === 'standard'
      ? settings.albumMergeStrategy
      : defaultSettings.albumMergeStrategy;
  const artistMergeStrategy =
    settings.artistMergeStrategy === 'conservative' || settings.artistMergeStrategy === 'standard'
      ? settings.artistMergeStrategy
      : defaultSettings.artistMergeStrategy;
  const playbackSpeedMode =
    settings.playbackSpeedMode === 'daycore' || settings.playbackSpeedMode === 'speed'
      ? settings.playbackSpeedMode
      : defaultSettings.playbackSpeedMode;
  const scanPerformanceMode =
    settings.scanPerformanceMode === 'low' ||
    settings.scanPerformanceMode === 'balanced' ||
    settings.scanPerformanceMode === 'performance'
      ? settings.scanPerformanceMode
      : defaultSettings.scanPerformanceMode;
  const remoteCoverLoadPerformanceMode = remoteCoverLoadPerformanceModes.includes(settings.remoteCoverLoadPerformanceMode as RemoteCoverLoadPerformanceMode)
    ? settings.remoteCoverLoadPerformanceMode
    : defaultSettings.remoteCoverLoadPerformanceMode;
  const remoteAlbumMergeStrategy = remoteAlbumMergeStrategies.includes(settings.remoteAlbumMergeStrategy as RemoteAlbumMergeStrategy)
    ? settings.remoteAlbumMergeStrategy
    : defaultSettings.remoteAlbumMergeStrategy;
  const duplicateTracksMode = settings.duplicateTracksMode === 'strict' ? settings.duplicateTracksMode : defaultSettings.duplicateTracksMode;
  const appWallpaperScalePercent = Number(settings.appWallpaperScalePercent);
  const appWallpaperBlurPx = Number(settings.appWallpaperBlurPx);
  const appWallpaperBrightnessPercent = Number(settings.appWallpaperBrightnessPercent);
  const appWallpaperUiOpacityPercent = Number(settings.appWallpaperUiOpacityPercent);
  const appCustomWallpaperPath = normalizeAppWallpaperPath(settings.appCustomWallpaperPath);
  const appPortraitWallpaperPath = normalizeAppWallpaperPath(settings.appPortraitWallpaperPath);
  const appWallpaperMediaType = normalizeAppWallpaperMediaType(appCustomWallpaperPath);
  const appPortraitWallpaperMediaType = normalizeAppWallpaperMediaType(appPortraitWallpaperPath);
  const networkProxyUrl = normalizeNetworkProxyUrl(settings.networkProxyUrl);
  const networkProxyPacUrl = normalizeNetworkProxyPacUrl(settings.networkProxyPacUrl);
  const networkProxyMode = normalizeNetworkProxyMode(settings.networkProxyMode, networkProxyUrl, networkProxyPacUrl);
  const providers = Array.isArray(settings.networkMetadataProviders)
    ? settings.networkMetadataProviders.filter(
        (provider): provider is AppSettings['networkMetadataProviders'][number] =>
          provider === 'mock' ||
          provider === 'musicbrainz' ||
          provider === 'cover-art-archive' ||
          provider === 'netease-cloud-music' ||
          provider === 'qq-music' ||
          provider === 'kugou-music',
      )
    : defaultSettings.networkMetadataProviders;
  const lyricsAutoAcceptScore = Number(settings.lyricsAutoAcceptScore);
  const lyricsCoverAutoAcceptScore = Number(settings.lyricsCoverAutoAcceptScore);
  const lyricsDefaultOffsetMs = Number(settings.lyricsDefaultOffsetMs);
  const lyricsGlobalSyncOffsetMs = Number(settings.lyricsGlobalSyncOffsetMs);
  const lyricsFontSizePx = Number(settings.lyricsFontSizePx);
  const lyricsWordHighlightClarityPercent = Number(settings.lyricsWordHighlightClarityPercent);
  const lyricsSecondaryFontSizePx = Number(settings.lyricsSecondaryFontSizePx);
  const lyricsLineSpacingPercent = Number(settings.lyricsLineSpacingPercent);
  const lyricsLineMaxChars = Number(settings.lyricsLineMaxChars);
  const lyricsContextOpacityPercent = Number(settings.lyricsContextOpacityPercent);
  const lyricsPlayerBarDrawerOpacityPercent = Number(settings.lyricsPlayerBarDrawerOpacityPercent);
  const lyricsCoverOpacityPercent = Number(settings.lyricsCoverOpacityPercent);
  const lyricsCoverBlurPx = Number(settings.lyricsCoverBlurPx);
  const lyricsCoverBrightnessPercent = Number(settings.lyricsCoverBrightnessPercent);
  const lyricsBackgroundScalePercent = Number(settings.lyricsBackgroundScalePercent);
  const desktopLyricsFontSizePx = Number(settings.desktopLyricsFontSizePx);
  const desktopLyricsScalePercent = Number(settings.desktopLyricsScalePercent);
  const desktopLyricsOpacityPercent = Number(settings.desktopLyricsOpacityPercent);
  const lyricsProviderTimeoutMs = Number(settings.lyricsProviderTimeoutMs);
  const lyricsTotalMatchTimeoutMs = Number(settings.lyricsTotalMatchTimeoutMs);
  const lyricsBackfillAutoAcceptScore = Number(settings.lyricsBackfillAutoAcceptScore);
  const mvProviderOrder = normalizeMvProviderList(settings.mvProviderOrder, defaultSettings.mvProviderOrder);
  const mvAutoApplyThreshold = Number(settings.mvAutoApplyThreshold);
  const mvImmersiveBackgroundScalePercent = Number(settings.mvImmersiveBackgroundScalePercent);
  const mvImmersiveBackgroundOffsetXPercent = Number(settings.mvImmersiveBackgroundOffsetXPercent);
  const mvImmersiveBackgroundOffsetYPercent = Number(settings.mvImmersiveBackgroundOffsetYPercent);
  const mvImmersiveBackgroundBlurPx = Number(settings.mvImmersiveBackgroundBlurPx);
  const mvImmersiveBackgroundBrightnessPercent = Number(settings.mvImmersiveBackgroundBrightnessPercent);
  const mvImmersiveBackgroundOverlayOpacityPercent = Number(settings.mvImmersiveBackgroundOverlayOpacityPercent);
  const lyricsEnabledProviders = migrateLegacyDefaultLyricsProviders(
    normalizeLyricsProviderList(settings.lyricsEnabledProviders, defaultSettings.lyricsEnabledProviders ?? defaultLyricsProviderOrder),
  );
  const lyricsProviderOrder = normalizeLyricsProviderList(
    settings.lyricsProviderOrder,
    Array.isArray(settings.lyricsEnabledProviders) ? settings.lyricsEnabledProviders : defaultSettings.lyricsProviderOrder,
  );
  const replayGainTargetLufs = Number(settings.replayGainTargetLufs);
  const replayGainPreampDb = Number(settings.replayGainPreampDb);
  const finalThemeUnlocked = (options.finalThemeUnlocked ?? finalThemeUnlockAvailable) === true
    && settings.finalThemeUnlockVersion === finalThemeUnlockVersion;
  const appearanceCustomThemes = normalizeThemeCustomThemes(settings.appearanceCustomThemes)
    .filter((theme) => theme.basePreset !== 'FINAL');
  const requestedAppearanceThemeCustomId = normalizeThemeCustomId(settings.appearanceThemeCustomId, appearanceCustomThemes);
  const requestedAppearanceCustomTheme = appearanceCustomThemes.find((theme) => theme.id === requestedAppearanceThemeCustomId);
  const appearanceThemeCustomId = requestedAppearanceCustomTheme?.basePreset === 'FINAL' && !finalThemeUnlocked
    ? null
    : requestedAppearanceThemeCustomId;
  const activeAppearanceCustomTheme = appearanceCustomThemes.find((theme) => theme.id === appearanceThemeCustomId);
  const requestedAppearanceThemePreset = activeAppearanceCustomTheme?.basePreset ?? normalizeAppearanceThemePreset(settings.appearanceThemePreset);
  const appearanceThemePreset = !finalThemeUnlocked && requestedAppearanceThemePreset === 'FINAL' ? 'classic' : requestedAppearanceThemePreset;
  const appearanceThemePresetOverrides = normalizeThemePresetOverrides(settings.appearanceThemePresetOverrides);
  delete appearanceThemePresetOverrides.FINAL;
  const downloadsFeatureUnlocked = settings.downloadsFeatureUnlocked === true;

  return {
    appMemoryVersion,
    onboardingCompleted: settings.onboardingCompleted !== false,
    locale: normalizeLocale(settings.locale),
    appearanceTheme: normalizeAppearanceTheme(settings.appearanceTheme),
    appearanceThemeScheduleEnabled: settings.appearanceThemeScheduleEnabled === true,
    appearanceThemeScheduleDarkAt: normalizeThemeScheduleTime(settings.appearanceThemeScheduleDarkAt, defaultAppearanceThemeScheduleDarkAt),
    appearanceThemeScheduleLightAt: normalizeThemeScheduleTime(settings.appearanceThemeScheduleLightAt, defaultAppearanceThemeScheduleLightAt),
    appearanceThemePreset,
    appearanceThemePresetOverrides,
    appearanceCustomThemes,
    appearanceThemeCustomId,
    finalThemeUnlockVersion: finalThemeUnlocked ? finalThemeUnlockVersion : null,
    appearanceThemePresetsExpanded: settings.appearanceThemePresetsExpanded === true,
    appearanceThemeCustomExpanded: settings.appearanceThemeCustomExpanded === true,
    appearanceSidebarLayoutExpanded: settings.appearanceSidebarLayoutExpanded === true,
    appWindowAcrylicEnabled: settings.appWindowAcrylicEnabled === true,
    appWindowAcrylicKeepWhenUnfocusedEnabled: settings.appWindowAcrylicKeepWhenUnfocusedEnabled === true,
    appWindowAcrylicTransparencyPercent: Number.isFinite(settings.appWindowAcrylicTransparencyPercent)
      ? clamp(Math.round(Number(settings.appWindowAcrylicTransparencyPercent)), 0, 100)
      : defaultAppWindowAcrylicTransparencyPercent,
    appearancePreferences: normalizeAppearancePreferences(settings.appearancePreferences),
    sidebarRouteOrder: normalizeSidebarRouteOrder(settings.sidebarRouteOrder),
    sidebarHiddenRouteIds: normalizeSidebarHiddenRouteIds(settings.sidebarHiddenRouteIds),
    sidebarAutoHideEnabled: settings.sidebarAutoHideEnabled === true,
    sidebarIconOnlyEnabled: settings.sidebarAutoHideEnabled === true ? false : settings.sidebarIconOnlyEnabled === true,
    settingsOptionalSectionsVisible: settings.settingsOptionalSectionsVisible === true,
    featureCommentsHidden: settings.featureCommentsHidden === true,
    trackContextMenuExtraActionsEnabled: settings.trackContextMenuExtraActionsEnabled === true,
    touchOnScreenKeyboardEnabled: settings.touchOnScreenKeyboardEnabled === true,
    songsSort: normalizeSongsSort(settings.songsSort),
    rememberedAudioOutput: migrateRememberedAudioOutput(
      normalizeRememberedAudioOutput(settings.rememberedAudioOutput),
      sourceAppMemoryVersion,
    ),
    hiddenAudioDeviceKeys: normalizeHiddenAudioDeviceKeys(settings.hiddenAudioDeviceKeys),
    audioUseJuceOutput: sourceAppMemoryVersion >= 6 && settings.audioUseJuceOutput === true,
    audioUseJuceDecode: sourceAppMemoryVersion >= 6 && settings.audioUseJuceDecode === true,
    audioDsdOutputMode: settings.audioDsdOutputMode === 'dop' ? 'dop' : 'pcm',
    audioAsioNativeDsdExperimentalEnabled: settings.audioAsioNativeDsdExperimentalEnabled === true,
    audioDsdAutoVolumeLockEnabled: settings.audioDsdAutoVolumeLockEnabled === true,
    audioAsioUnavailableFallbackEnabled: settings.audioAsioUnavailableFallbackEnabled === true,
    audioExclusiveInstabilityFallbackEnabled: settings.audioExclusiveInstabilityFallbackEnabled === true,
    audioSoxrFallbackEnabled: settings.audioSoxrFallbackEnabled !== false,
    audioEchoSrcMode: normalizeAudioEchoSrcMode(settings.audioEchoSrcMode),
    audioEchoSrcQualityProfile: normalizeAudioEchoSrcQualityProfile(settings.audioEchoSrcQualityProfile),
    audioReleaseExclusiveOnPauseExperimentalEnabled: settings.audioReleaseExclusiveOnPauseExperimentalEnabled === true,
    audioIssueDiagnosticsWindowEnabled: settings.audioIssueDiagnosticsWindowEnabled === true,
    albumMergeStrategy,
    artistMergeStrategy,
    chineseCrossScriptSearchEnabled: settings.chineseCrossScriptSearchEnabled !== false,
    artistWallAlbumArtwork: settings.artistWallAlbumArtwork === true,
    artistWallAlbumFallbackForMissingAvatars: settings.artistWallAlbumFallbackForMissingAvatars === true,
    artistStreamingAlbumsEnabled: settings.artistStreamingAlbumsEnabled !== false,
    artistStreamingAlbumsProvider: normalizeArtistStreamingAlbumsProvider(settings.artistStreamingAlbumsProvider),
    autoFetchArtistImages: settings.autoFetchArtistImages === true,
    artistImageFetchPaused: settings.artistImageFetchPaused === true,
    liveLibraryUpdatesEnabled: settings.liveLibraryUpdatesEnabled === true,
    liveLibraryAutoHideDeletedEnabled: settings.liveLibraryAutoHideDeletedEnabled === true,
    safeModeEnabled: settings.safeModeEnabled === true,
    fastStartupEnabled: settings.fastStartupEnabled === true,
    dataProtectionDisabled: settings.dataProtectionDisabled === true,
    autoUpdateEnabled: settings.autoUpdateEnabled !== false,
    autoUpdateSource: normalizeAutoUpdateSource(settings.autoUpdateSource),
    autoUpdateCustomUrl: normalizeAutoUpdateCustomUrl(settings.autoUpdateCustomUrl),
    autoAccountCheckOnStartup: settings.autoAccountCheckOnStartup !== false,
    suppressAccountExpiryNotices: settings.suppressAccountExpiryNotices !== false,
    spotifyAutoLaunchOfficialPlayer: settings.spotifyAutoLaunchOfficialPlayer !== false,
    spotifyClientId: normalizeSpotifyClientId(settings.spotifyClientId),
    spotifyRedirectUri: normalizeSpotifyRedirectUri(settings.spotifyRedirectUri),
    tidalClientId: normalizeTidalClientId(settings.tidalClientId) ?? defaultTidalClientId,
    tidalClientSecret: normalizeTidalClientSecret(settings.tidalClientSecret),
    tidalRedirectUri: normalizeSpotifyRedirectUri(settings.tidalRedirectUri),
    tidalCountryCode: normalizeTidalCountryCode(settings.tidalCountryCode) ?? defaultSettings.tidalCountryCode,
    downloadsFeatureUnlocked,
    streamingDownloadActionsEnabled: downloadsFeatureUnlocked && settings.streamingDownloadActionsEnabled === true,
    connectAutoStartReceiversEnabled: settings.connectAutoStartReceiversEnabled === true,
    airPlayReceiverProtocol: normalizeAirPlayReceiverProtocol(settings.airPlayReceiverProtocol),
    hqPlayer: normalizeHqPlayerSettings(settings.hqPlayer),
    playlistBackupsEnabled: settings.playlistBackupsEnabled !== false,
    autoDataBackupEnabled: settings.autoDataBackupEnabled === true,
    autoDataBackupDirectory: normalizeDataBackupDirectory(settings.autoDataBackupDirectory),
    autoDataBackupIntervalDays: normalizeDataBackupIntervalDays(settings.autoDataBackupIntervalDays),
    autoDataBackupLastRunAt: normalizeBackupTimestamp(settings.autoDataBackupLastRunAt),
    autoDataBackupLastPath: normalizeDataBackupDirectory(settings.autoDataBackupLastPath),
    autoDataBackupLastError: normalizeBackupMessage(settings.autoDataBackupLastError),
    coverCacheDir: normalizeCoverCacheDir(settings.coverCacheDir),
    hideToTrayOnClose: settings.hideToTrayOnClose === true,
    rememberWindowSizeEnabled: settings.rememberWindowSizeEnabled !== false,
    rememberedWindowSize: normalizeRememberedWindowSize(settings.rememberedWindowSize),
    appCustomWallpaperPath,
    appPortraitWallpaperPath,
    appWallpaperMediaType,
    appPortraitWallpaperMediaType,
    appWallpaperScalePercent: Number.isFinite(appWallpaperScalePercent)
      ? Math.round(clamp(appWallpaperScalePercent, 100, 220))
      : defaultSettings.appWallpaperScalePercent,
    appWallpaperBlurPx: Number.isFinite(appWallpaperBlurPx)
      ? Math.round(clamp(appWallpaperBlurPx, 0, 40))
      : defaultSettings.appWallpaperBlurPx,
    appWallpaperBrightnessPercent: Number.isFinite(appWallpaperBrightnessPercent)
      ? Math.round(clamp(appWallpaperBrightnessPercent, 40, 140))
      : defaultSettings.appWallpaperBrightnessPercent,
    appWallpaperUiOpacityPercent: Number.isFinite(appWallpaperUiOpacityPercent)
      ? Math.round(clamp(appWallpaperUiOpacityPercent, 0, 100))
      : defaultSettings.appWallpaperUiOpacityPercent,
    appWallpaperVisualProtectionEnabled: settings.appWallpaperVisualProtectionEnabled !== false,
    appWallpaperUnifiedOpacityEnabled: settings.appWallpaperUnifiedOpacityEnabled === true,
    nowPlayingCoverColorEnabled: settings.nowPlayingCoverColorEnabled === true,
    appVideoWallpaperPauseMode: normalizeAppVideoWallpaperPauseMode(settings.appVideoWallpaperPauseMode),
    networkProxyMode,
    networkProxyUrl,
    networkProxyBypassRules: normalizeNetworkProxyBypassRules(settings.networkProxyBypassRules),
    networkProxyPacUrl,
    networkMetadataEnabled: settings.networkMetadataEnabled !== false,
    networkMetadataProviders: providers.length ? providers : defaultSettings.networkMetadataProviders,
    onlineArtistInfoBandsintownAppId: normalizeOptionalText(settings.onlineArtistInfoBandsintownAppId),
    onlineArtistInfoTicketmasterApiKey: normalizeOptionalText(settings.onlineArtistInfoTicketmasterApiKey),
    onlineArtistInfoSeatGeekClientId: normalizeOptionalText(settings.onlineArtistInfoSeatGeekClientId),
    onlineArtistInfoRegion: normalizeOptionalText(settings.onlineArtistInfoRegion),
    onlineArtistInfoSources: normalizeArtistOnlineInfoSources(settings.onlineArtistInfoSources),
    onlineAlbumInfoDiscogsUserToken: normalizeOptionalText(settings.onlineAlbumInfoDiscogsUserToken),
    audioAnalysisEnabled: settings.audioAnalysisEnabled !== false,
    lyricsNetworkEnabled: settings.lyricsNetworkEnabled !== false,
    lyricsPreferredProvider: 'lrclib',
    lyricsEnabledProviders: lyricsEnabledProviders.length ? lyricsEnabledProviders : (defaultSettings.lyricsEnabledProviders ?? ['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']),
    lyricsProviderOrder: [
      ...lyricsProviderOrder,
      ...defaultLyricsProviderOrder.filter((provider) => !lyricsProviderOrder.includes(provider)),
    ],
    lyricsProviderTimeoutMs: Number.isFinite(lyricsProviderTimeoutMs)
      ? Math.round(clamp(lyricsProviderTimeoutMs, 1000, 10000))
      : defaultSettings.lyricsProviderTimeoutMs,
    lyricsTotalMatchTimeoutMs: Number.isFinite(lyricsTotalMatchTimeoutMs)
      ? Math.round(clamp(lyricsTotalMatchTimeoutMs, 1500, 15000))
      : defaultSettings.lyricsTotalMatchTimeoutMs,
    lyricsCoverAutoAcceptScore: Number.isFinite(lyricsCoverAutoAcceptScore)
      ? clamp(lyricsCoverAutoAcceptScore, 0.5, 1)
      : defaultSettings.lyricsCoverAutoAcceptScore,
    lyricsDeepSearchEnabled: settings.lyricsDeepSearchEnabled !== false,
    lyricsAutoSearch: settings.lyricsAutoSearch !== false,
    lyricsAutoAcceptScore: Number.isFinite(lyricsAutoAcceptScore)
      ? clamp(lyricsAutoAcceptScore, 0.3, 1)
      : defaultSettings.lyricsAutoAcceptScore,
    lyricsBackfillAutoAcceptScore: Number.isFinite(lyricsBackfillAutoAcceptScore)
      ? clamp(lyricsBackfillAutoAcceptScore, 0.3, 0.95)
      : defaultSettings.lyricsBackfillAutoAcceptScore,
    lyricsRestartOnApplyEnabled: settings.lyricsRestartOnApplyEnabled === true,
    lyricsAutoSaveSidecarEnabled: settings.lyricsAutoSaveSidecarEnabled === true,
    lyricsDefaultOffsetMs: Number.isFinite(lyricsDefaultOffsetMs)
      ? Math.round(clamp(lyricsDefaultOffsetMs, -10000, 10000))
      : defaultSettings.lyricsDefaultOffsetMs,
    lyricsGlobalSyncOffsetMs: Number.isFinite(lyricsGlobalSyncOffsetMs)
      ? Math.round(clamp(lyricsGlobalSyncOffsetMs, -1000, 1000))
      : defaultSettings.lyricsGlobalSyncOffsetMs,
    lyricsTimelineCorrectionEnabled: settings.lyricsTimelineCorrectionEnabled !== false,
    lyricsOffsetControlsEnabled: settings.lyricsOffsetControlsEnabled !== false,
    lyricsSmartAlignmentEnabled: settings.lyricsSmartAlignmentEnabled !== false,
    lyricsEnabled: settings.lyricsEnabled !== false,
    lyricsHeaderHidden: settings.lyricsHeaderHidden === true,
    lyricsMvAutoShowTrackInfoDisabled: settings.lyricsMvAutoShowTrackInfoDisabled !== false,
    lyricsCandidatePanelAutoOpenEnabled: settings.lyricsCandidatePanelAutoOpenEnabled === true,
    lyricsEmptyStateHidden: settings.lyricsEmptyStateHidden !== false,
    lyricsPlayerBarDrawerEnabled: settings.lyricsPlayerBarDrawerEnabled !== false,
    lyricsPlayerBarDrawerAutoEnableForMv: settings.lyricsPlayerBarDrawerAutoEnableForMv !== false,
    lyricsPlayerBarDrawerAutoHideEnabled: settings.lyricsPlayerBarDrawerAutoHideEnabled === true,
    lyricsPlayerBarDrawerOpacityPercent: Number.isFinite(lyricsPlayerBarDrawerOpacityPercent)
      ? Math.round(clamp(lyricsPlayerBarDrawerOpacityPercent, 20, 100))
      : defaultSettings.lyricsPlayerBarDrawerOpacityPercent,
    lyricsPlayerBarDrawerColorMode: normalizeLyricsMiniPlayerColorMode(settings.lyricsPlayerBarDrawerColorMode),
    lyricsPlayerBarDrawerColor: normalizeHexColor(settings.lyricsPlayerBarDrawerColor, defaultLyricsMiniPlayerColor),
    lyricsRomanizationEnabled: settings.lyricsRomanizationEnabled !== false,
    lyricsUtatenKanaEnabled: settings.lyricsUtatenKanaEnabled === true,
    lyricsTranslationEnabled: settings.lyricsTranslationEnabled !== false,
    lyricsWordHighlightEnabled: settings.lyricsWordHighlightEnabled !== false,
    lyricsWordHighlightClarityPercent: Number.isFinite(lyricsWordHighlightClarityPercent)
      ? Math.round(clamp(lyricsWordHighlightClarityPercent, 40, 100))
      : defaultSettings.lyricsWordHighlightClarityPercent,
    lyricsFontSizePx: Number.isFinite(lyricsFontSizePx)
      ? Math.round(clamp(lyricsFontSizePx, 22, 56))
      : defaultSettings.lyricsFontSizePx,
    lyricsSecondaryFontSizePx: Number.isFinite(lyricsSecondaryFontSizePx)
      ? Math.round(clamp(lyricsSecondaryFontSizePx, 12, 32))
      : defaultSettings.lyricsSecondaryFontSizePx,
    lyricsFontFamily: normalizeRequiredText(settings.lyricsFontFamily, defaultSettings.lyricsFontFamily ?? 'Microsoft YaHei'),
    lyricsFontFilePath: normalizeFontPath(settings.lyricsFontFilePath),
    lyricsTextDirection: normalizeLyricsTextDirection(settings.lyricsTextDirection),
    lyricsLineSpacingPercent: Number.isFinite(lyricsLineSpacingPercent)
      ? Math.round(clamp(lyricsLineSpacingPercent, 60, 150))
      : defaultSettings.lyricsLineSpacingPercent,
    lyricsLineMaxChars: Number.isFinite(lyricsLineMaxChars)
      ? Math.round(clamp(lyricsLineMaxChars, 0, 80))
      : defaultSettings.lyricsLineMaxChars,
    lyricsContextOpacityPercent: Number.isFinite(lyricsContextOpacityPercent)
      ? Math.round(clamp(lyricsContextOpacityPercent, 0, 100))
      : defaultSettings.lyricsContextOpacityPercent,
    lyricsColor: normalizeLyricsColor(settings.lyricsColor),
    lyricsSmartReadableColorsEnabled: settings.lyricsSmartReadableColorsEnabled === true,
    lyricsHighResolutionNetworkCoverEnabled: settings.lyricsHighResolutionNetworkCoverEnabled === true,
    lyricsBackgroundMode: normalizeLyricsBackgroundMode(settings.lyricsBackgroundMode),
    lyricsCustomWallpaperPath: normalizeLyricsWallpaperPath(settings.lyricsCustomWallpaperPath),
    lyricsCoverOpacityPercent: Number.isFinite(lyricsCoverOpacityPercent)
      ? Math.round(clamp(lyricsCoverOpacityPercent, 0, 100))
      : defaultSettings.lyricsCoverOpacityPercent,
    lyricsCoverBlurPx: Number.isFinite(lyricsCoverBlurPx)
      ? Math.round(clamp(lyricsCoverBlurPx, 0, 60))
      : defaultSettings.lyricsCoverBlurPx,
    lyricsCoverBrightnessPercent: Number.isFinite(lyricsCoverBrightnessPercent)
      ? Math.round(clamp(lyricsCoverBrightnessPercent, 40, 140))
      : defaultSettings.lyricsCoverBrightnessPercent,
    lyricsBackgroundScalePercent: Number.isFinite(lyricsBackgroundScalePercent)
      ? Math.round(clamp(lyricsBackgroundScalePercent, 70, 180))
      : defaultSettings.lyricsBackgroundScalePercent,
    desktopLyricsEnabled: settings.desktopLyricsEnabled === true,
    desktopLyricsLocked: settings.desktopLyricsLocked === true,
    desktopLyricsFontSizePx: Number.isFinite(desktopLyricsFontSizePx)
      ? Math.round(clamp(desktopLyricsFontSizePx, 18, 72))
      : defaultSettings.desktopLyricsFontSizePx,
    desktopLyricsScalePercent: Number.isFinite(desktopLyricsScalePercent)
      ? Math.round(clamp(desktopLyricsScalePercent, 75, 170))
      : defaultSettings.desktopLyricsScalePercent,
    desktopLyricsFontFamily: normalizeRequiredText(settings.desktopLyricsFontFamily, defaultDesktopLyricsFontFamily),
    desktopLyricsFontFilePath: normalizeFontPath(settings.desktopLyricsFontFilePath),
    desktopLyricsColorMode: normalizeDesktopLyricsColorMode(settings.desktopLyricsColorMode, settings.desktopLyricsColor),
    desktopLyricsColor: normalizeHexColor(settings.desktopLyricsColor, defaultDesktopLyricsColor),
    desktopLyricsStrokeColor: normalizeHexColor(settings.desktopLyricsStrokeColor, defaultDesktopLyricsStrokeColor),
    desktopLyricsOpacityPercent: Number.isFinite(desktopLyricsOpacityPercent)
      ? Math.round(clamp(desktopLyricsOpacityPercent, 35, 100))
      : defaultSettings.desktopLyricsOpacityPercent,
    desktopLyricsTextDirection: normalizeLyricsTextDirection(settings.desktopLyricsTextDirection),
    desktopLyricsRomanizationEnabled: settings.desktopLyricsRomanizationEnabled !== false,
    desktopLyricsTranslationEnabled: settings.desktopLyricsTranslationEnabled !== false,
    desktopLyricsBounds: normalizeDesktopLyricsBounds(settings.desktopLyricsBounds),
    miniPlayerEnabled: settings.miniPlayerEnabled === true,
    miniPlayerLocked: false,
    miniPlayerAutoHideMainWindow: settings.miniPlayerAutoHideMainWindow !== false,
    miniPlayerBounds: normalizeMiniPlayerBounds(settings.miniPlayerBounds),
    mvEnabled: settings.mvEnabled !== false,
    mvEnabledProviders: normalizeMvProviderList(settings.mvEnabledProviders, defaultSettings.mvEnabledProviders),
    mvProviderOrder: [
      ...mvProviderOrder,
      ...mvNetworkProviders.filter((provider) => !mvProviderOrder.includes(provider)),
    ],
    mvAutoSearch: settings.mvAutoSearch !== false,
    mvAutoPreload: settings.mvAutoPreload !== false,
    mvAutoApplyThreshold: Number.isFinite(mvAutoApplyThreshold)
      ? clamp(mvAutoApplyThreshold, 0.3, 1)
      : defaultSettings.mvAutoApplyThreshold,
    mvPreferHighestViewCount: settings.mvPreferHighestViewCount === true,
    mvImmersiveBackground: settings.mvImmersiveBackground !== false,
    mvImmersiveBackgroundAutoScale: settings.mvImmersiveBackgroundAutoScale !== false,
    mvImmersiveBackgroundScalePercent: Number.isFinite(mvImmersiveBackgroundScalePercent)
      ? Math.round(clamp(mvImmersiveBackgroundScalePercent, 100, 220))
      : defaultSettings.mvImmersiveBackgroundScalePercent,
    mvImmersiveBackgroundOffsetXPercent: Number.isFinite(mvImmersiveBackgroundOffsetXPercent)
      ? Math.round(clamp(mvImmersiveBackgroundOffsetXPercent, 0, 100))
      : defaultSettings.mvImmersiveBackgroundOffsetXPercent,
    mvImmersiveBackgroundOffsetYPercent: Number.isFinite(mvImmersiveBackgroundOffsetYPercent)
      ? Math.round(clamp(mvImmersiveBackgroundOffsetYPercent, 0, 100))
      : defaultSettings.mvImmersiveBackgroundOffsetYPercent,
    mvImmersiveBackgroundBlurPx: Number.isFinite(mvImmersiveBackgroundBlurPx)
      ? Math.round(clamp(mvImmersiveBackgroundBlurPx, 0, 32))
      : defaultSettings.mvImmersiveBackgroundBlurPx,
    mvImmersiveBackgroundBrightnessPercent: Number.isFinite(mvImmersiveBackgroundBrightnessPercent)
      ? Math.round(clamp(mvImmersiveBackgroundBrightnessPercent, 60, 140))
      : defaultSettings.mvImmersiveBackgroundBrightnessPercent,
    mvImmersiveBackgroundOverlayOpacityPercent: Number.isFinite(mvImmersiveBackgroundOverlayOpacityPercent)
      ? Math.round(clamp(mvImmersiveBackgroundOverlayOpacityPercent, 0, 100))
      : defaultSettings.mvImmersiveBackgroundOverlayOpacityPercent,
    mvLyricsReadabilityEnhanced: settings.mvLyricsReadabilityEnhanced === true,
    mvHideLyrics: settings.mvHideLyrics === true,
    mvRestartAudioOnLoad: settings.mvRestartAudioOnLoad === true,
    mvSyncMode: normalizeMvSyncMode(settings.mvSyncMode),
    mvReplayAudioOnChange: settings.mvReplayAudioOnChange !== false,
    mvMaxQuality: normalizeMvMaxQuality(settings.mvMaxQuality),
    mvAllow60fps: settings.mvAllow60fps !== false,
    channelBalance: normalizeChannelBalanceSettings(settings.channelBalance),
    playerVolume: Number.isFinite(playerVolume) ? Math.max(0, Math.min(1, playerVolume)) : defaultSettings.playerVolume,
    homeWaveformVisualizerEnabled: settings.homeWaveformVisualizerEnabled !== false,
    audioVisualSpectrumEnabled: settings.audioVisualSpectrumEnabled === true,
    lowLoadPlaybackModeEnabled: settings.lowLoadPlaybackModeEnabled === true,
    lowLoadPlaybackEnhancementsEnabled: settings.lowLoadPlaybackEnhancementsEnabled === true,
    homeRandomHeroTitleEnabled: settings.homeRandomHeroTitleEnabled === true,
    playerWaveformProgressEnabled: settings.playerWaveformProgressEnabled === true,
    signalPathControlEnabled: settings.signalPathControlEnabled !== false,
    fixedVolumeEnabled: settings.fixedVolumeEnabled === true,
    gaplessPlaybackEnabled: settings.gaplessPlaybackEnabled === true,
    audioTransportFadeEnabled: settings.audioTransportFadeEnabled === true,
    audioTransportFadeInMs: normalizeAudioTransportFadeDurationMs(settings.audioTransportFadeInMs),
    audioTransportFadeOutMs: normalizeAudioTransportFadeDurationMs(settings.audioTransportFadeOutMs),
    audioTransportFadeCurve: normalizeAudioTransportFadeCurve(settings.audioTransportFadeCurve),
    replayGainEnabled: settings.replayGainEnabled === true,
    replayGainMode: normalizeReplayGainMode(settings.replayGainMode),
    replayGainTargetLufs: Number.isFinite(replayGainTargetLufs)
      ? Math.round(clamp(replayGainTargetLufs, -24, -11) * 10) / 10
      : defaultSettings.replayGainTargetLufs,
    replayGainPreampDb: Number.isFinite(replayGainPreampDb)
      ? Math.round(clamp(replayGainPreampDb, -12, 12) * 10) / 10
      : defaultSettings.replayGainPreampDb,
    replayGainPreventClipping: settings.replayGainPreventClipping !== false,
    replayGainAnalyzeOnPlay: settings.replayGainAnalyzeOnPlay !== false,
    replayGainAnalyzeMissingOnScanOptIn: settings.replayGainAnalyzeMissingOnScanOptIn === true,
    replayGainAnalyzeMissingOnScan:
      settings.replayGainAnalyzeMissingOnScanOptIn === true && settings.replayGainAnalyzeMissingOnScan === true,
    backgroundSpacePauseEnabled: false,
    localShortcuts: normalizeLocalShortcuts(settings.localShortcuts),
    globalShortcuts: normalizeGlobalShortcuts(settings.globalShortcuts),
    audioExportFormat: normalizeAudioExportFormat(settings.audioExportFormat),
    playbackSpeed: Number.isFinite(playbackSpeed)
      ? Math.max(0.5, Math.min(2, playbackSpeed))
      : defaultSettings.playbackSpeed,
    playbackSpeedMode,
    scanPerformanceMode,
    nativeFileScannerEnabled: settings.nativeFileScannerEnabled === true,
    nativeMetadataReaderEnabled: settings.nativeMetadataReaderEnabled === true,
    remoteCoverLoadPerformanceMode,
    remoteAlbumMergeStrategy,
    remoteBackgroundConcurrency: normalizeRemoteBackgroundConcurrency(settings.remoteBackgroundConcurrency),
    duplicateTracksEnabled: settings.duplicateTracksEnabled !== false,
    duplicateTracksMode,
    duplicateTracksAutoRebuildAfterScan: settings.duplicateTracksAutoRebuildAfterScan === true,
    discordRichPresenceEnabled:
      settings.discordRichPresenceEnabled === undefined ? defaultSettings.discordRichPresenceEnabled : settings.discordRichPresenceEnabled === true,
    lastFmEnabled: settings.lastFmEnabled === true,
    lastFmUsername: normalizeOptionalText(settings.lastFmUsername),
    lastFmSessionKey: normalizeOptionalText(settings.lastFmSessionKey),
    lastFmScrobbleEnabled: settings.lastFmScrobbleEnabled !== false,
    lastFmNowPlayingEnabled: settings.lastFmNowPlayingEnabled !== false,
    lastFmMinScrobbleSeconds:
      typeof settings.lastFmMinScrobbleSeconds === 'number' &&
      Number.isFinite(settings.lastFmMinScrobbleSeconds) &&
      settings.lastFmMinScrobbleSeconds > 0
        ? Math.max(1, Math.min(240, Math.round(settings.lastFmMinScrobbleSeconds)))
        : defaultSettings.lastFmMinScrobbleSeconds,
    lastFmAuthToken: normalizeOptionalText(settings.lastFmAuthToken),
    smtcEnabled: settings.smtcEnabled !== false,
    smtcLyricsEnabled: settings.smtcLyricsEnabled === true,
    taskbarPlaybackControlsEnabled: settings.taskbarPlaybackControlsEnabled === true,
  };
};

export const setFinalThemeUnlockAvailable = (available: boolean): void => {
  if (finalThemeUnlockAvailable === available) {
    return;
  }
  finalThemeUnlockAvailable = available;
  cachedSettings = null;
};

const containsFinalThemeCustomTheme = (themes: unknown): boolean =>
  Array.isArray(themes) && themes.some((theme) =>
    Boolean(theme && typeof theme === 'object' && !Array.isArray(theme) && (theme as Partial<AppThemeCustomTheme>).basePreset === 'FINAL'),
  );

const containsFinalThemePresetOverride = (overrides: unknown): boolean =>
  Boolean(overrides && typeof overrides === 'object' && !Array.isArray(overrides) && Object.prototype.hasOwnProperty.call(overrides, 'FINAL'));

const shouldPersistFinalThemeRelock = (source: Partial<AppSettings>, normalized: AppSettings): boolean =>
  (source.appearanceThemePreset === 'FINAL' && normalized.appearanceThemePreset !== 'FINAL') ||
  (typeof source.finalThemeUnlockVersion === 'string' && source.finalThemeUnlockVersion !== normalized.finalThemeUnlockVersion) ||
  containsFinalThemeCustomTheme(source.appearanceCustomThemes) ||
  containsFinalThemePresetOverride(source.appearanceThemePresetOverrides);

const persistNormalizedSettings = (settings: AppSettings): void => {
  const settingsPath = getSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
};

export const getAppSettings = (options: NormalizeSettingsOptions = {}): AppSettings => {
  if (options.finalThemeUnlocked !== true && cachedSettings) {
    return cachedSettings;
  }

  if (!cachedSettingsSource) {
    const settingsPath = getSettingsPath();

    if (!existsSync(settingsPath)) {
      cachedSettingsSource = { ...defaultSettings };
    } else {
      try {
        cachedSettingsSource = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<AppSettings>;
      } catch {
        cachedSettingsSource = { ...defaultSettings };
      }
    }
  }

  const sourceSettings = cachedSettingsSource ?? defaultSettings;
  const settings = normalizeSettings(sourceSettings, options);
  if (shouldPersistFinalThemeRelock(sourceSettings, settings)) {
    persistNormalizedSettings(settings);
    cachedSettingsSource = settings;
  }
  if (options.finalThemeUnlocked !== true) {
    cachedSettings = settings;
  }

  return settings;
};

export const setAppSettings = (patch: Partial<AppSettings>, options: NormalizeSettingsOptions = {}): AppSettings => {
  const nextSettings = normalizeSettings({ ...getAppSettings(options), ...patch }, options);

  persistNormalizedSettings(nextSettings);
  cachedSettingsSource = nextSettings;
  cachedSettings = normalizeSettings(nextSettings, options);

  return nextSettings;
};
