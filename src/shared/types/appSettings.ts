import type { AudioDsdOutputMode, AudioEchoSrcMode, AudioEchoSrcQualityProfile, AudioExportFormat, AudioLatencyProfile, AudioOutputMode, AudioSharedBackend, ChannelBalanceState, PlaybackSpeedMode } from './audio';
import type { DuplicateTrackMode } from './library';
import type { LibrarySort } from './library';
import type { LyricsProviderId } from './lyrics';
import type { MvMaxQuality, MvSyncMode, NetworkMvProviderId } from './mv';
import type { GlobalShortcutSettings, LocalShortcutSettings } from './globalShortcuts';
import type { HqPlayerSettings } from './hqplayer';
import type { SidebarRouteId } from './sidebar';

export type ScanPerformanceMode = 'low' | 'balanced' | 'performance';
export type RemoteCoverLoadPerformanceMode = 'low' | 'balanced' | 'aggressive' | 'lan';
export type LyricsBackgroundMode = 'theme' | 'cover' | 'coverColor' | 'customWallpaper';
export type LyricsTextDirection = 'horizontal' | 'vertical';
export type LyricsMiniPlayerColorMode = 'default' | 'custom' | 'cover';
export type DesktopLyricsColorMode = 'theme' | 'custom';
export type AppWallpaperMediaType = 'image' | 'video';
export type AppVideoWallpaperPauseMode = 'smart' | 'minimized' | 'never';
export type AppLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
export type AppThemeMode = 'light' | 'dark' | 'system';
export type ReplayGainMode = 'off' | 'track' | 'album';
export type AirPlayReceiverProtocol = 'airplay1' | 'airplay2';
export type AudioTransportFadeCurve = 'linear' | 'smooth' | 'equalPower';
export type NetworkProxyMode = 'off' | 'system' | 'manual' | 'pac';
export type DataBackupIntervalDays = 3 | 7 | 30;
export type ArtistMergeStrategy = 'conservative' | 'standard';
export const autoUpdateSources = ['official', 'ghfast', 'ghproxyVip', 'ghproxyCxkpro', 'custom'] as const;
export type AutoUpdateSource = typeof autoUpdateSources[number];
export const artistOnlineInfoSources = ['baidu-baike', 'moegirl', 'wikipedia'] as const;
export type ArtistOnlineInfoSource = typeof artistOnlineInfoSources[number];
export const defaultArtistOnlineInfoSources: ArtistOnlineInfoSource[] = ['wikipedia'];
export const artistStreamingAlbumProviders = ['netease', 'qqmusic'] as const;
export type ArtistStreamingAlbumsProvider = typeof artistStreamingAlbumProviders[number];
export const defaultArtistStreamingAlbumsProvider: ArtistStreamingAlbumsProvider = 'netease';

export type DesktopLyricsBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NetworkProxyTestResult = {
  ok: boolean;
  mode: NetworkProxyMode;
  message: string;
  resolvedProxy: string | null;
  status: number | null;
  elapsedMs: number;
};
export type AppThemePreset =
  | 'classic'
  | 'echoTwilight'
  | 'sakuraMilk'
  | 'peachSoda'
  | 'mintCandy'
  | 'berryDream'
  | 'matchaCream'
  | 'lemonMochi'
  | 'cottonCloud'
  | 'melonCream'
  | 'seaSaltJelly'
  | 'caramelPudding'
  | 'neonCandy'
  | 'nyanCat'
  | 'childrenDoodle'
  | 'wisteriaBubble'
  | 'strawberryCookie'
  | 'graphiteAurora'
  | 'amberNoir'
  | 'oceanStudio'
  | 'rosewoodVinyl'
  | 'darkSideMoon'
  | 'shibuyaNight'
  | 'kyotoKurenai'
  | 'ukiyoIndigo'
  | 'fujiSnow'
  | 'matsuriLantern'
  | 'ginzaNoir'
  | 'frostJazz'
  | 'FINAL';

export type AppThemeToneOverride = {
  appBg?: string;
  appBg2?: string;
  appBg3?: string;
  panel?: string;
  panelSoft?: string;
  accent?: string;
  accentStrong?: string;
  secondary?: string;
  heading?: string;
  text?: string;
  muted?: string;
  border?: string;
  onAccent?: string;
  buttonText?: string;
  titlebar?: string;
  sidebar?: string;
  player?: string;
  field?: string;
  row?: string;
  rowHover?: string;
  rowActive?: string;
  chip?: string;
  focus?: string;
  danger?: string;
  success?: string;
  warning?: string;
  panelOpacityPercent?: number;
  glassPercent?: number;
  shadowPercent?: number;
  cornerRadiusPx?: number;
  panelBlurPx?: number;
  saturationPercent?: number;
  motionEnabled?: boolean;
  motionSpeedSeconds?: number;
  motionIntensityPercent?: number;
};

export type AppThemePresetOverride = {
  light?: AppThemeToneOverride;
  dark?: AppThemeToneOverride;
};

export type AppThemePresetOverrides = Partial<Record<AppThemePreset, AppThemePresetOverride>>;

export type AppThemeCustomTheme = {
  id: string;
  name: string;
  basePreset: AppThemePreset;
  light?: AppThemeToneOverride;
  dark?: AppThemeToneOverride;
  createdAt: string;
  updatedAt: string;
};

export type AlbumCoverShape = 'rounded' | 'square';

export type AppearancePreferences = {
  mainFontFamily: string;
  mainFontFilePath: string | null;
  chineseFontFamily: string;
  chineseFontFilePath: string | null;
  fallbackFontFamily: string;
  fallbackFontFilePath: string | null;
  baseFontSize: number;
  lineHeight: number;
  textDepth: number;
  albumCoverShape: AlbumCoverShape;
};

export type RememberedAudioOutput = {
  enabled: boolean;
  outputMode: AudioOutputMode;
  sharedBackend?: AudioSharedBackend;
  latencyProfile?: AudioLatencyProfile;
  deviceIndex?: number;
  deviceName?: string;
  asioOutputChannelStart?: number;
  bufferSizeFrames?: number;
};

export type RememberedWindowSize = {
  width: number;
  height: number;
};

export type RemoteAlbumMergeStrategy = 'conservative' | 'standard';

export type RemoteBackgroundConcurrencySettings = {
  metadata: number;
  cover: number;
  lyrics: number;
  mv: number;
  durationBackfill: number;
};

export type AppSettings = {
  appMemoryVersion?: number;
  onboardingCompleted?: boolean;
  locale?: AppLocale;
  appearanceTheme: AppThemeMode;
  appearanceThemeScheduleEnabled?: boolean;
  appearanceThemeScheduleDarkAt?: string;
  appearanceThemeScheduleLightAt?: string;
  appearanceThemePreset?: AppThemePreset;
  appearanceThemePresetOverrides?: AppThemePresetOverrides;
  appearanceCustomThemes?: AppThemeCustomTheme[];
  appearanceThemeCustomId?: string | null;
  finalThemeUnlockVersion?: string | null;
  appearanceThemePresetsExpanded?: boolean;
  appearanceThemeCustomExpanded?: boolean;
  appearanceSidebarLayoutExpanded?: boolean;
  appWindowAcrylicEnabled?: boolean;
  appWindowAcrylicKeepWhenUnfocusedEnabled?: boolean;
  appWindowAcrylicTransparencyPercent?: number;
  appearancePreferences?: AppearancePreferences;
  sidebarRouteOrder?: SidebarRouteId[];
  sidebarHiddenRouteIds?: SidebarRouteId[];
  sidebarAutoHideEnabled?: boolean;
  sidebarIconOnlyEnabled?: boolean;
  settingsOptionalSectionsVisible?: boolean;
  featureCommentsHidden?: boolean;
  trackContextMenuExtraActionsEnabled?: boolean;
  touchOnScreenKeyboardEnabled?: boolean;
  songsSort?: LibrarySort;
  rememberedAudioOutput?: RememberedAudioOutput;
  hiddenAudioDeviceKeys?: string[];
  audioUseJuceOutput?: boolean;
  audioUseJuceDecode?: boolean;
  audioDsdOutputMode?: AudioDsdOutputMode;
  audioAsioNativeDsdExperimentalEnabled?: boolean;
  audioDsdAutoVolumeLockEnabled?: boolean;
  audioAsioUnavailableFallbackEnabled?: boolean;
  audioExclusiveInstabilityFallbackEnabled?: boolean;
  audioSoxrFallbackEnabled?: boolean;
  audioEchoSrcMode?: AudioEchoSrcMode;
  audioEchoSrcQualityProfile?: AudioEchoSrcQualityProfile;
  audioReleaseExclusiveOnPauseExperimentalEnabled?: boolean;
  audioIssueDiagnosticsWindowEnabled?: boolean;
  albumMergeStrategy: 'standard' | 'sameTitleAndCover';
  artistMergeStrategy?: ArtistMergeStrategy;
  chineseCrossScriptSearchEnabled?: boolean;
  artistWallAlbumArtwork: boolean;
  artistWallAlbumFallbackForMissingAvatars?: boolean;
  artistStreamingAlbumsEnabled?: boolean;
  artistStreamingAlbumsProvider?: ArtistStreamingAlbumsProvider;
  autoFetchArtistImages?: boolean;
  artistImageFetchPaused?: boolean;
  liveLibraryUpdatesEnabled?: boolean;
  liveLibraryAutoHideDeletedEnabled?: boolean;
  safeModeEnabled?: boolean;
  fastStartupEnabled?: boolean;
  dataProtectionDisabled?: boolean;
  autoUpdateEnabled?: boolean;
  autoUpdateSource?: AutoUpdateSource;
  autoUpdateCustomUrl?: string | null;
  autoAccountCheckOnStartup?: boolean;
  suppressAccountExpiryNotices?: boolean;
  spotifyAutoLaunchOfficialPlayer?: boolean;
  spotifyClientId?: string | null;
  spotifyRedirectUri?: string | null;
  tidalClientId?: string | null;
  tidalClientSecret?: string | null;
  tidalRedirectUri?: string | null;
  tidalCountryCode?: string | null;
  downloadsFeatureUnlocked?: boolean;
  streamingDownloadActionsEnabled?: boolean;
  connectAutoStartReceiversEnabled?: boolean;
  airPlayReceiverProtocol?: AirPlayReceiverProtocol;
  hqPlayer?: HqPlayerSettings;
  playlistBackupsEnabled?: boolean;
  autoDataBackupEnabled?: boolean;
  autoDataBackupDirectory?: string | null;
  autoDataBackupIntervalDays?: DataBackupIntervalDays;
  autoDataBackupLastRunAt?: string | null;
  autoDataBackupLastPath?: string | null;
  autoDataBackupLastError?: string | null;
  coverCacheDir: string | null;
  hideToTrayOnClose: boolean;
  rememberWindowSizeEnabled?: boolean;
  rememberedWindowSize?: RememberedWindowSize | null;
  appCustomWallpaperPath: string | null;
  appPortraitWallpaperPath?: string | null;
  appWallpaperMediaType?: AppWallpaperMediaType;
  appPortraitWallpaperMediaType?: AppWallpaperMediaType;
  appWallpaperScalePercent: number;
  appWallpaperBlurPx: number;
  appWallpaperBrightnessPercent: number;
  appWallpaperUiOpacityPercent: number;
  appWallpaperVisualProtectionEnabled?: boolean;
  appWallpaperUnifiedOpacityEnabled: boolean;
  nowPlayingCoverColorEnabled?: boolean;
  appVideoWallpaperPauseMode?: AppVideoWallpaperPauseMode;
  networkProxyMode?: NetworkProxyMode;
  networkProxyUrl?: string | null;
  networkProxyBypassRules?: string | null;
  networkProxyPacUrl?: string | null;
  networkMetadataEnabled: boolean;
  networkMetadataProviders: Array<'mock' | 'musicbrainz' | 'cover-art-archive' | 'netease-cloud-music' | 'qq-music' | 'kugou-music'>;
  onlineArtistInfoBandsintownAppId?: string | null;
  onlineArtistInfoTicketmasterApiKey?: string | null;
  onlineArtistInfoSeatGeekClientId?: string | null;
  onlineArtistInfoRegion?: string | null;
  onlineArtistInfoSources?: ArtistOnlineInfoSource[];
  onlineAlbumInfoDiscogsUserToken?: string | null;
  audioAnalysisEnabled?: boolean;
  lyricsNetworkEnabled: boolean;
  lyricsPreferredProvider: 'lrclib';
  lyricsEnabledProviders?: LyricsProviderId[];
  lyricsProviderOrder: LyricsProviderId[];
  lyricsProviderTimeoutMs?: number;
  lyricsTotalMatchTimeoutMs?: number;
  lyricsCoverAutoAcceptScore?: number;
  lyricsDeepSearchEnabled: boolean;
  lyricsAutoSearch: boolean;
  lyricsAutoAcceptScore: number;
  lyricsBackfillAutoAcceptScore?: number;
  lyricsRestartOnApplyEnabled?: boolean;
  lyricsAutoSaveSidecarEnabled?: boolean;
  lyricsDefaultOffsetMs: number;
  lyricsGlobalSyncOffsetMs: number;
  lyricsTimelineCorrectionEnabled?: boolean;
  lyricsOffsetControlsEnabled?: boolean;
  lyricsSmartAlignmentEnabled?: boolean;
  lyricsEnabled: boolean;
  lyricsHeaderHidden: boolean;
  lyricsMvAutoShowTrackInfoDisabled?: boolean;
  lyricsCandidatePanelAutoOpenEnabled?: boolean;
  lyricsEmptyStateHidden: boolean;
  lyricsPlayerBarDrawerEnabled?: boolean;
  lyricsPlayerBarDrawerAutoEnableForMv?: boolean;
  lyricsPlayerBarDrawerAutoHideEnabled?: boolean;
  lyricsPlayerBarDrawerOpacityPercent?: number;
  lyricsPlayerBarDrawerColorMode?: LyricsMiniPlayerColorMode;
  lyricsPlayerBarDrawerColor?: string;
  lyricsRomanizationEnabled: boolean;
  lyricsUtatenKanaEnabled?: boolean;
  lyricsTranslationEnabled: boolean;
  lyricsWordHighlightEnabled?: boolean;
  lyricsWordHighlightClarityPercent?: number;
  lyricsFontSizePx: number;
  lyricsSecondaryFontSizePx?: number;
  lyricsFontFamily?: string;
  lyricsFontFilePath?: string | null;
  lyricsTextDirection?: LyricsTextDirection;
  lyricsLineSpacingPercent?: number;
  lyricsLineMaxChars?: number;
  lyricsContextOpacityPercent?: number;
  lyricsColor: string;
  lyricsSmartReadableColorsEnabled?: boolean;
  lyricsHighResolutionNetworkCoverEnabled?: boolean;
  lyricsBackgroundMode: LyricsBackgroundMode;
  lyricsCustomWallpaperPath: string | null;
  lyricsCoverOpacityPercent: number;
  lyricsCoverBlurPx: number;
  lyricsCoverBrightnessPercent: number;
  lyricsBackgroundScalePercent: number;
  desktopLyricsEnabled?: boolean;
  desktopLyricsLocked?: boolean;
  desktopLyricsFontSizePx?: number;
  desktopLyricsScalePercent?: number;
  desktopLyricsFontFamily?: string;
  desktopLyricsFontFilePath?: string | null;
  desktopLyricsColorMode?: DesktopLyricsColorMode;
  desktopLyricsColor?: string;
  desktopLyricsStrokeColor?: string;
  desktopLyricsOpacityPercent?: number;
  desktopLyricsTextDirection?: LyricsTextDirection;
  desktopLyricsRomanizationEnabled?: boolean;
  desktopLyricsTranslationEnabled?: boolean;
  desktopLyricsBounds?: DesktopLyricsBounds | null;
  miniPlayerEnabled?: boolean;
  miniPlayerLocked?: boolean;
  miniPlayerAutoHideMainWindow?: boolean;
  miniPlayerBounds?: DesktopLyricsBounds | null;
  mvEnabled?: boolean;
  mvEnabledProviders: NetworkMvProviderId[];
  mvProviderOrder: NetworkMvProviderId[];
  mvAutoSearch: boolean;
  mvAutoPreload?: boolean;
  mvAutoApplyThreshold?: number;
  mvPreferHighestViewCount?: boolean;
  mvImmersiveBackground?: boolean;
  mvImmersiveBackgroundAutoScale?: boolean;
  mvImmersiveBackgroundScalePercent?: number;
  mvImmersiveBackgroundOffsetXPercent?: number;
  mvImmersiveBackgroundOffsetYPercent?: number;
  mvImmersiveBackgroundBlurPx?: number;
  mvImmersiveBackgroundBrightnessPercent?: number;
  mvImmersiveBackgroundOverlayOpacityPercent?: number;
  mvLyricsReadabilityEnhanced?: boolean;
  mvHideLyrics?: boolean;
  mvRestartAudioOnLoad?: boolean;
  mvSyncMode?: MvSyncMode;
  mvReplayAudioOnChange?: boolean;
  mvMaxQuality: MvMaxQuality;
  mvAllow60fps: boolean;
  channelBalance: ChannelBalanceState;
  playerVolume: number;
  homeWaveformVisualizerEnabled?: boolean;
  audioVisualSpectrumEnabled?: boolean;
  lowLoadPlaybackModeEnabled?: boolean;
  lowLoadPlaybackEnhancementsEnabled?: boolean;
  homeRandomHeroTitleEnabled?: boolean;
  playerWaveformProgressEnabled?: boolean;
  signalPathControlEnabled?: boolean;
  fixedVolumeEnabled?: boolean;
  gaplessPlaybackEnabled?: boolean;
  audioTransportFadeEnabled?: boolean;
  audioTransportFadeInMs?: number;
  audioTransportFadeOutMs?: number;
  audioTransportFadeCurve?: AudioTransportFadeCurve;
  replayGainEnabled?: boolean;
  replayGainMode?: ReplayGainMode;
  replayGainTargetLufs?: number;
  replayGainPreampDb?: number;
  replayGainPreventClipping?: boolean;
  replayGainAnalyzeOnPlay?: boolean;
  replayGainAnalyzeMissingOnScanOptIn?: boolean;
  replayGainAnalyzeMissingOnScan?: boolean;
  backgroundSpacePauseEnabled?: boolean;
  localShortcuts?: LocalShortcutSettings;
  globalShortcuts?: GlobalShortcutSettings;
  audioExportFormat?: AudioExportFormat;
  playbackSpeed: number;
  playbackSpeedMode: PlaybackSpeedMode;
  scanPerformanceMode: ScanPerformanceMode;
  nativeFileScannerEnabled?: boolean;
  nativeMetadataReaderEnabled?: boolean;
  remoteCoverLoadPerformanceMode?: RemoteCoverLoadPerformanceMode;
  remoteAlbumMergeStrategy?: RemoteAlbumMergeStrategy;
  remoteBackgroundConcurrency?: RemoteBackgroundConcurrencySettings;
  duplicateTracksEnabled: boolean;
  duplicateTracksMode: DuplicateTrackMode;
  duplicateTracksAutoRebuildAfterScan: boolean;
  discordRichPresenceEnabled: boolean;
  lastFmEnabled: boolean;
  lastFmUsername: string | null;
  lastFmSessionKey: string | null;
  lastFmScrobbleEnabled: boolean;
  lastFmNowPlayingEnabled: boolean;
  lastFmMinScrobbleSeconds: number;
  lastFmAuthToken: string | null;
  smtcEnabled: boolean;
  smtcLyricsEnabled: boolean;
  taskbarPlaybackControlsEnabled: boolean;
};
