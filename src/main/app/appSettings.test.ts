import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLocalShortcuts } from '../../shared/types/globalShortcuts';

let userDataPath = process.cwd();
let systemLocale = 'zh-CN';
const tempRoots: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath,
    getLocale: () => systemLocale,
  },
}));

describe('app settings normalization', () => {
  afterEach(() => {
    userDataPath = process.cwd();
    systemLocale = 'zh-CN';
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('uses the system locale when no display language has been chosen', async () => {
    const { normalizeSettings, normalizeSystemLocale } = await import('./appSettings');

    expect(normalizeSystemLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeSystemLocale('ja-JP')).toBe('ja-JP');
    expect(normalizeSystemLocale('en-GB')).toBe('en-US');
    expect(normalizeSystemLocale('fr-FR')).toBe('zh-CN');

    systemLocale = 'ja-JP';
    expect(normalizeSettings({}).locale).toBe('ja-JP');
    expect(normalizeSettings({ locale: 'en-US' }).locale).toBe('en-US');
    expect(normalizeSettings({ locale: 'bad' }).locale).toBe('ja-JP');
  });

  it('keeps old settings files compatible when coverCacheDir is missing', async () => {
    const { normalizeSettings } = await import('./appSettings');
    const settings = normalizeSettings({
      hideToTrayOnClose: true,
      networkMetadataEnabled: true,
      networkMetadataProviders: ['qq-music'],
      playerVolume: 0.5,
      playbackSpeed: 1.25,
      playbackSpeedMode: 'speed',
    });

    expect(settings.coverCacheDir).toBeNull();
    expect(settings.appearanceTheme).toBe('light');
    expect(settings.appearanceThemeScheduleEnabled).toBe(false);
    expect(settings.appearanceThemeScheduleDarkAt).toBe('19:00');
    expect(settings.appearanceThemeScheduleLightAt).toBe('07:00');
    expect(settings.appearanceThemePreset).toBe('classic');
    expect(settings.appearanceThemePresetOverrides).toEqual({});
    expect(settings.appearanceCustomThemes).toEqual([]);
    expect(settings.appearanceThemeCustomId).toBeNull();
    expect(settings.appearanceThemePresetsExpanded).toBe(false);
    expect(settings.appearanceThemeCustomExpanded).toBe(false);
    expect(settings.appearanceSidebarLayoutExpanded).toBe(false);
    expect(settings.albumMergeStrategy).toBe('standard');
    expect(settings.chineseCrossScriptSearchEnabled).toBe(true);
    expect(settings.artistWallAlbumArtwork).toBe(false);
    expect(settings.artistWallAlbumFallbackForMissingAvatars).toBe(false);
    expect(settings.autoFetchArtistImages).toBe(false);
    expect(settings.artistImageFetchPaused).toBe(false);
    expect(settings.safeModeEnabled).toBe(false);
    expect(settings.fastStartupEnabled).toBe(false);
    expect(settings.dataProtectionDisabled).toBe(false);
    expect(settings.autoAccountCheckOnStartup).toBe(true);
    expect(settings.spotifyAutoLaunchOfficialPlayer).toBe(true);
    expect(settings.connectAutoStartReceiversEnabled).toBe(false);
    expect(settings.airPlayReceiverProtocol).toBe('airplay1');
    expect(settings.hqPlayer).toMatchObject({
      enabled: false,
      connectionMode: 'localDesktop',
      host: '127.0.0.1',
      port: 4321,
      defaultPlaybackBackend: 'ask',
    });
    expect(settings.playlistBackupsEnabled).toBe(true);
    expect(settings.autoDataBackupEnabled).toBe(false);
    expect(settings.autoDataBackupDirectory).toBeNull();
    expect(settings.autoDataBackupIntervalDays).toBe(7);
    expect(settings.autoDataBackupLastRunAt).toBeNull();
    expect(settings.autoDataBackupLastPath).toBeNull();
    expect(settings.autoDataBackupLastError).toBeNull();
    expect(settings.sidebarAutoHideEnabled).toBe(false);
    expect(settings.sidebarIconOnlyEnabled).toBe(false);
    expect(settings.settingsOptionalSectionsVisible).toBe(false);
    expect(settings.featureCommentsHidden).toBe(false);
    expect(settings.touchOnScreenKeyboardEnabled).toBe(false);
    expect(settings.rememberWindowSizeEnabled).toBe(true);
    expect(settings.rememberedWindowSize).toBeNull();
    expect(settings.appWindowAcrylicEnabled).toBe(false);
    expect(settings.appWindowAcrylicKeepWhenUnfocusedEnabled).toBe(false);
    expect(settings.appWindowAcrylicTransparencyPercent).toBe(70);
    expect(settings.appCustomWallpaperPath).toBeNull();
    expect(settings.appWallpaperMediaType).toBe('image');
    expect(settings.appWallpaperScalePercent).toBe(100);
    expect(settings.appWallpaperBlurPx).toBe(0);
    expect(settings.appWallpaperBrightnessPercent).toBe(100);
    expect(settings.appWallpaperUiOpacityPercent).toBe(100);
    expect(settings.appWallpaperVisualProtectionEnabled).toBe(true);
    expect(settings.appWallpaperUnifiedOpacityEnabled).toBe(false);
    expect(settings.nowPlayingCoverColorEnabled).toBe(false);
    expect(settings.appVideoWallpaperPauseMode).toBe('smart');
    expect(settings.networkProxyMode).toBe('off');
    expect(settings.networkProxyUrl).toBeNull();
    expect(settings.networkProxyPacUrl).toBeNull();
    expect(settings.onlineArtistInfoBandsintownAppId).toBeNull();
    expect(settings.onlineArtistInfoTicketmasterApiKey).toBeNull();
    expect(settings.onlineArtistInfoSeatGeekClientId).toBeNull();
    expect(settings.onlineArtistInfoRegion).toBeNull();
    expect(settings.onlineArtistInfoSources).toEqual(['wikipedia']);
    expect(settings.onlineAlbumInfoDiscogsUserToken).toBeNull();
    expect(settings.scanPerformanceMode).toBe('balanced');
    expect(settings.nativeFileScannerEnabled).toBe(false);
    expect(settings.nativeMetadataReaderEnabled).toBe(false);
    expect(settings.backgroundSpacePauseEnabled).toBe(false);
    expect(settings.localShortcuts).toEqual(createDefaultLocalShortcuts());
    expect(settings.globalShortcuts?.playPause).toEqual({ enabled: false, accelerator: null });
    expect(settings.globalShortcuts?.nextTrack).toEqual({ enabled: false, accelerator: null });
    expect(settings.hideToTrayOnClose).toBe(true);
    expect(settings.networkMetadataProviders).toEqual(['qq-music']);
    expect(settings.audioAnalysisEnabled).toBe(true);
    expect(settings.smtcLyricsEnabled).toBe(false);
    expect(settings.lyricsNetworkEnabled).toBe(true);
    expect(settings.lyricsEnabledProviders).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
    expect(settings.lyricsProviderOrder).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
    expect(settings.lyricsDeepSearchEnabled).toBe(true);
    expect(settings.lyricsAutoSearch).toBe(true);
    expect(settings.lyricsAutoAcceptScore).toBe(0.5);
    expect(settings.lyricsBackfillAutoAcceptScore).toBe(0.45);
    expect(settings.lyricsRestartOnApplyEnabled).toBe(false);
    expect(settings.lyricsAutoSaveSidecarEnabled).toBe(false);
    expect(settings.lyricsDefaultOffsetMs).toBe(0);
    expect(settings.lyricsGlobalSyncOffsetMs).toBe(0);
    expect(settings.lyricsTimelineCorrectionEnabled).toBe(true);
    expect(settings.lyricsOffsetControlsEnabled).toBe(true);
    expect(settings.lyricsSmartAlignmentEnabled).toBe(true);
    expect(settings.lyricsEnabled).toBe(true);
    expect(settings.lyricsHeaderHidden).toBe(false);
    expect(settings.lyricsMvAutoShowTrackInfoDisabled).toBe(true);
    expect(settings.lyricsEmptyStateHidden).toBe(true);
    expect(settings.lyricsPlayerBarDrawerEnabled).toBe(true);
    expect(settings.lyricsPlayerBarDrawerAutoEnableForMv).toBe(true);
    expect(settings.lyricsPlayerBarDrawerAutoHideEnabled).toBe(false);
    expect(settings.lyricsPlayerBarDrawerOpacityPercent).toBe(78);
    expect(settings.lyricsPlayerBarDrawerColorMode).toBe('default');
    expect(settings.lyricsPlayerBarDrawerColor).toBe('#232120');
    expect(settings.lyricsRomanizationEnabled).toBe(true);
    expect(settings.lyricsUtatenKanaEnabled).toBe(false);
    expect(settings.lyricsTranslationEnabled).toBe(true);
    expect(settings.lyricsWordHighlightEnabled).toBe(true);
    expect(settings.lyricsWordHighlightClarityPercent).toBe(70);
    expect(settings.lyricsFontSizePx).toBe(40);
    expect(settings.lyricsSecondaryFontSizePx).toBe(22);
    expect(settings.lyricsTextDirection).toBe('horizontal');
    expect(settings.lyricsLineSpacingPercent).toBe(110);
    expect(settings.lyricsLineMaxChars).toBe(0);
    expect(settings.lyricsContextOpacityPercent).toBe(49);
    expect(settings.lyricsColor).toBe('#314054');
    expect(settings.lyricsSmartReadableColorsEnabled).toBe(false);
    expect(settings.lyricsHighResolutionNetworkCoverEnabled).toBe(false);
    expect(settings.lyricsBackgroundMode).toBe('theme');
    expect(settings.lyricsCustomWallpaperPath).toBeNull();
    expect(settings.lyricsCoverOpacityPercent).toBe(100);
    expect(settings.lyricsCoverBlurPx).toBe(10);
    expect(settings.lyricsCoverBrightnessPercent).toBe(100);
    expect(settings.lyricsBackgroundScalePercent).toBe(100);
    expect(settings.desktopLyricsFontFamily).toBe('Microsoft YaHei');
    expect(settings.desktopLyricsFontFilePath).toBeNull();
    expect(settings.desktopLyricsColorMode).toBe('theme');
    expect(settings.desktopLyricsTextDirection).toBe('horizontal');
    expect(settings.desktopLyricsRomanizationEnabled).toBe(true);
    expect(settings.desktopLyricsTranslationEnabled).toBe(true);
    expect(settings.miniPlayerEnabled).toBe(false);
    expect(settings.miniPlayerLocked).toBe(false);
    expect(settings.miniPlayerBounds).toBeNull();
    expect(settings.mvEnabled).toBe(true);
    expect(settings.mvEnabledProviders).toEqual(['bilibili', 'youtube']);
    expect(settings.mvProviderOrder).toEqual(['bilibili', 'youtube']);
    expect(settings.mvAutoSearch).toBe(true);
    expect(settings.mvAutoApplyThreshold).toBe(0.7);
    expect(settings.mvPreferHighestViewCount).toBe(false);
    expect(settings.mvImmersiveBackground).toBe(true);
    expect(settings.mvImmersiveBackgroundAutoScale).toBe(true);
    expect(settings.mvImmersiveBackgroundScalePercent).toBe(115);
    expect(settings.mvImmersiveBackgroundOffsetXPercent).toBe(50);
    expect(settings.mvImmersiveBackgroundOffsetYPercent).toBe(50);
    expect(settings.mvImmersiveBackgroundBlurPx).toBe(0);
    expect(settings.mvImmersiveBackgroundBrightnessPercent).toBe(100);
    expect(settings.mvImmersiveBackgroundOverlayOpacityPercent).toBe(0);
    expect(settings.mvLyricsReadabilityEnhanced).toBe(false);
    expect(settings.mvHideLyrics).toBe(false);
    expect(settings.mvMaxQuality).toBe('max');
    expect(settings.mvAllow60fps).toBe(true);
    expect(settings.homeWaveformVisualizerEnabled).toBe(true);
    expect(settings.homeRandomHeroTitleEnabled).toBe(false);
    expect(settings.gaplessPlaybackEnabled).toBe(false);
    expect(settings.audioTransportFadeEnabled).toBe(false);
    expect(settings.audioTransportFadeInMs).toBe(80);
    expect(settings.audioTransportFadeOutMs).toBe(80);
    expect(settings.audioTransportFadeCurve).toBe('smooth');
  });

  it('normalizes an empty coverCacheDir to null', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ coverCacheDir: '   ' }).coverCacheDir).toBeNull();
  });

  it('defaults network metadata backfill to NetEase and QQ sources', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).networkMetadataEnabled).toBe(true);
    expect(normalizeSettings({}).networkMetadataProviders).toEqual(['netease-cloud-music', 'qq-music']);
    expect(normalizeSettings({ networkMetadataEnabled: false }).networkMetadataEnabled).toBe(false);
    expect(normalizeSettings({ networkMetadataProviders: [] }).networkMetadataProviders).toEqual(['netease-cloud-music', 'qq-music']);
  });

  it('normalizes safe mode as an explicit diagnostic opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).safeModeEnabled).toBe(false);
    expect(normalizeSettings({ safeModeEnabled: true }).safeModeEnabled).toBe(true);
    expect(normalizeSettings({ safeModeEnabled: 'true' }).safeModeEnabled).toBe(false);
  });

  it('normalizes native file scanner as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).nativeFileScannerEnabled).toBe(false);
    expect(normalizeSettings({ nativeFileScannerEnabled: true }).nativeFileScannerEnabled).toBe(true);
    expect(normalizeSettings({ nativeFileScannerEnabled: false }).nativeFileScannerEnabled).toBe(false);
    expect(normalizeSettings({ nativeFileScannerEnabled: 'true' as never }).nativeFileScannerEnabled).toBe(false);
  });

  it('normalizes native metadata reader as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).nativeMetadataReaderEnabled).toBe(false);
    expect(normalizeSettings({ nativeMetadataReaderEnabled: true }).nativeMetadataReaderEnabled).toBe(true);
    expect(normalizeSettings({ nativeMetadataReaderEnabled: false }).nativeMetadataReaderEnabled).toBe(false);
    expect(normalizeSettings({ nativeMetadataReaderEnabled: 'true' as never }).nativeMetadataReaderEnabled).toBe(false);
  });

  it('keeps the artist-album song sort preference', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ songsSort: 'artistAlbum' }).songsSort).toBe('artistAlbum');
  });

  it('normalizes fast startup as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).fastStartupEnabled).toBe(false);
    expect(normalizeSettings({ fastStartupEnabled: true }).fastStartupEnabled).toBe(true);
    expect(normalizeSettings({ fastStartupEnabled: 'true' }).fastStartupEnabled).toBe(false);
  });

  it('normalizes the touch on-screen keyboard as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).touchOnScreenKeyboardEnabled).toBe(false);
    expect(normalizeSettings({ touchOnScreenKeyboardEnabled: true }).touchOnScreenKeyboardEnabled).toBe(true);
    expect(normalizeSettings({ touchOnScreenKeyboardEnabled: 'true' as never }).touchOnScreenKeyboardEnabled).toBe(false);
  });

  it('normalizes optional settings sections as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).settingsOptionalSectionsVisible).toBe(false);
    expect(normalizeSettings({ settingsOptionalSectionsVisible: true }).settingsOptionalSectionsVisible).toBe(true);
    expect(normalizeSettings({ settingsOptionalSectionsVisible: 'true' as never }).settingsOptionalSectionsVisible).toBe(false);
  });

  it('normalizes data protection disable as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).dataProtectionDisabled).toBe(false);
    expect(normalizeSettings({ dataProtectionDisabled: true }).dataProtectionDisabled).toBe(true);
    expect(normalizeSettings({ dataProtectionDisabled: 'true' }).dataProtectionDisabled).toBe(false);
  });

  it('keeps the home waveform visualizer enabled unless explicitly disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).homeWaveformVisualizerEnabled).toBe(true);
    expect(normalizeSettings({ homeWaveformVisualizerEnabled: true }).homeWaveformVisualizerEnabled).toBe(true);
    expect(normalizeSettings({ homeWaveformVisualizerEnabled: false }).homeWaveformVisualizerEnabled).toBe(false);
    expect(normalizeSettings({ homeWaveformVisualizerEnabled: 'true' }).homeWaveformVisualizerEnabled).toBe(true);
  });

  it('keeps the home random hero title disabled unless explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).homeRandomHeroTitleEnabled).toBe(false);
    expect(normalizeSettings({ homeRandomHeroTitleEnabled: true }).homeRandomHeroTitleEnabled).toBe(true);
    expect(normalizeSettings({ homeRandomHeroTitleEnabled: false }).homeRandomHeroTitleEnabled).toBe(false);
    expect(normalizeSettings({ homeRandomHeroTitleEnabled: 'false' }).homeRandomHeroTitleEnabled).toBe(false);
  });

  it('keeps Now Playing cover color disabled unless explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).nowPlayingCoverColorEnabled).toBe(false);
    expect(normalizeSettings({ nowPlayingCoverColorEnabled: true }).nowPlayingCoverColorEnabled).toBe(true);
    expect(normalizeSettings({ nowPlayingCoverColorEnabled: false }).nowPlayingCoverColorEnabled).toBe(false);
    expect(normalizeSettings({ nowPlayingCoverColorEnabled: 'true' as never }).nowPlayingCoverColorEnabled).toBe(false);
  });

  it('normalizes play/pause fade as a default-off customizable opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioTransportFadeEnabled).toBe(false);
    expect(normalizeSettings({ audioTransportFadeEnabled: true }).audioTransportFadeEnabled).toBe(true);
    expect(normalizeSettings({
      audioTransportFadeInMs: 123.4,
      audioTransportFadeOutMs: 2500,
      audioTransportFadeCurve: 'equalPower',
    })).toMatchObject({
      audioTransportFadeInMs: 123,
      audioTransportFadeOutMs: 2000,
      audioTransportFadeCurve: 'equalPower',
    });
    expect(normalizeSettings({
      audioTransportFadeInMs: -10,
      audioTransportFadeOutMs: 'bad',
      audioTransportFadeCurve: 'bad',
    })).toMatchObject({
      audioTransportFadeInMs: 0,
      audioTransportFadeOutMs: 80,
      audioTransportFadeCurve: 'smooth',
    });
  });

  it('normalizes automatic data backup settings safely', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const settings = normalizeSettings({
      autoDataBackupEnabled: true,
      autoDataBackupDirectory: '  D:\\Echo Backups  ',
      autoDataBackupIntervalDays: 30,
      autoDataBackupLastRunAt: '2026-05-20T00:00:00.000Z',
      autoDataBackupLastPath: '  D:\\Echo Backups\\backup.zip  ',
      autoDataBackupLastError: 'failed\r\nagain',
    });

    expect(settings.autoDataBackupEnabled).toBe(true);
    expect(settings.autoDataBackupDirectory).toBe(resolve('D:\\Echo Backups'));
    expect(settings.autoDataBackupIntervalDays).toBe(30);
    expect(settings.autoDataBackupLastRunAt).toBe('2026-05-20T00:00:00.000Z');
    expect(settings.autoDataBackupLastPath).toBe(resolve('D:\\Echo Backups\\backup.zip'));
    expect(settings.autoDataBackupLastError).toBe('failed again');

    expect(normalizeSettings({ autoDataBackupIntervalDays: 14 }).autoDataBackupIntervalDays).toBe(7);
    expect(normalizeSettings({ autoDataBackupLastRunAt: 'not-a-date' }).autoDataBackupLastRunAt).toBeNull();
  });

  it('normalizes network proxy settings conservatively', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const manual = normalizeSettings({
      networkProxyMode: 'manual',
      networkProxyUrl: 'socks5://127.0.0.1:7890',
      networkProxyBypassRules: 'localhost, 127.0.0.1\n*.local',
    });
    expect(manual.networkProxyMode).toBe('manual');
    expect(manual.networkProxyUrl).toBe('socks5://127.0.0.1:7890');
    expect(manual.networkProxyBypassRules).toBe('localhost;127.0.0.1;*.local');

    const hostPort = normalizeSettings({
      networkProxyMode: 'manual',
      networkProxyUrl: '192.168.51.1:7890',
    });
    expect(hostPort.networkProxyMode).toBe('manual');
    expect(hostPort.networkProxyUrl).toBe('http://192.168.51.1:7890/');

    expect(normalizeSettings({ networkProxyMode: 'manual', networkProxyUrl: 'ftp://127.0.0.1:21' }).networkProxyMode).toBe('off');
    expect(normalizeSettings({ networkProxyMode: 'pac', networkProxyPacUrl: 'file:///proxy.pac' }).networkProxyMode).toBe('off');
    expect(normalizeSettings({ networkProxyMode: 'pac', networkProxyPacUrl: 'https://example.com/proxy.pac' }).networkProxyMode).toBe('pac');
  });

  it('normalizes online artist info provider settings as optional local text', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const settings = normalizeSettings({
      onlineArtistInfoBandsintownAppId: ' echo-next ',
      onlineArtistInfoTicketmasterApiKey: ' ticketmaster-key ',
      onlineArtistInfoSeatGeekClientId: ' seatgeek-id ',
      onlineArtistInfoRegion: ' HK ',
      onlineAlbumInfoDiscogsUserToken: ' discogs-token ',
    });

    expect(settings.onlineArtistInfoBandsintownAppId).toBe('echo-next');
    expect(settings.onlineArtistInfoTicketmasterApiKey).toBe('ticketmaster-key');
    expect(settings.onlineArtistInfoSeatGeekClientId).toBe('seatgeek-id');
    expect(settings.onlineArtistInfoRegion).toBe('HK');
    expect(settings.onlineAlbumInfoDiscogsUserToken).toBe('discogs-token');
    expect(normalizeSettings({ onlineArtistInfoSources: ['moegirl', 'bad', 'baidu-baike'] }).onlineArtistInfoSources).toEqual(['baidu-baike']);
    expect(normalizeSettings({ onlineArtistInfoSources: ['moegirl'] }).onlineArtistInfoSources).toEqual(['wikipedia']);
    expect(normalizeSettings({ onlineArtistInfoSources: [] }).onlineArtistInfoSources).toEqual(['wikipedia']);
    expect(normalizeSettings({ onlineArtistInfoBandsintownAppId: '   ' }).onlineArtistInfoBandsintownAppId).toBeNull();
    expect(normalizeSettings({ onlineAlbumInfoDiscogsUserToken: '   ' }).onlineAlbumInfoDiscogsUserToken).toBeNull();
  });

  it('normalizes HQPlayer settings as an opt-in external playback foundation', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).hqPlayer).toMatchObject({
      enabled: false,
      connectionMode: 'localDesktop',
      host: '127.0.0.1',
      port: 4321,
      mediaServerEnabled: false,
      defaultPlaybackBackend: 'ask',
    });

    expect(
      normalizeSettings({
        hqPlayer: {
          enabled: true,
          connectionMode: 'remote',
          host: '  192.168.1.32\r\n  ',
          port: 4321,
          executablePath: ' C:\\Program Files\\HQPlayer\\HQPlayer.exe ',
          allowLaunch: true,
          mediaServerEnabled: true,
          mediaServerPort: 17890,
          defaultPlaybackBackend: 'hqplayer',
          profileName: ' DSD preset ',
        },
      }).hqPlayer,
    ).toMatchObject({
      enabled: true,
      connectionMode: 'remote',
      host: '192.168.1.32',
      port: 4321,
      executablePath: 'C:\\Program Files\\HQPlayer\\HQPlayer.exe',
      allowLaunch: true,
      mediaServerEnabled: true,
      mediaServerPort: 17890,
      defaultPlaybackBackend: 'hqplayer',
      profileName: 'DSD preset',
    });

    expect(
      normalizeSettings({
        hqPlayer: {
          defaultPlaybackBackend: 'echoNative',
        },
      }).hqPlayer,
    ).toMatchObject({ defaultPlaybackBackend: 'echoNative' });

    expect(
      normalizeSettings({
        hqPlayer: {
          enabled: 'yes',
          connectionMode: 'embedded',
          host: ' ',
          port: 70000,
          mediaServerPort: 0,
          defaultPlaybackBackend: 'replace-native',
        },
      } as never).hqPlayer,
    ).toMatchObject({
      enabled: false,
      connectionMode: 'localDesktop',
      host: '127.0.0.1',
      port: 4321,
      mediaServerPort: null,
      defaultPlaybackBackend: 'ask',
    });
  });

  it('normalizes appearance theme modes', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).appearanceTheme).toBe('light');
    expect(normalizeSettings({ appearanceTheme: 'dark' }).appearanceTheme).toBe('dark');
    expect(normalizeSettings({ appearanceTheme: 'system' }).appearanceTheme).toBe('system');
    expect(normalizeSettings({ appearanceTheme: 'midnight' as never }).appearanceTheme).toBe('light');
  });

  it('normalizes window acrylic as an explicit opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).appWindowAcrylicEnabled).toBe(false);
    expect(normalizeSettings({ appWindowAcrylicEnabled: true }).appWindowAcrylicEnabled).toBe(true);
    expect(normalizeSettings({ appWindowAcrylicEnabled: 'true' as never }).appWindowAcrylicEnabled).toBe(false);
    expect(normalizeSettings({ appWindowAcrylicKeepWhenUnfocusedEnabled: true }).appWindowAcrylicKeepWhenUnfocusedEnabled).toBe(true);
    expect(normalizeSettings({ appWindowAcrylicTransparencyPercent: -5 }).appWindowAcrylicTransparencyPercent).toBe(0);
    expect(normalizeSettings({ appWindowAcrylicTransparencyPercent: 100 }).appWindowAcrylicTransparencyPercent).toBe(100);
  });

  it('normalizes appearance theme schedule settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).appearanceThemeScheduleEnabled).toBe(false);
    expect(normalizeSettings({ appearanceThemeScheduleEnabled: true }).appearanceThemeScheduleEnabled).toBe(true);
    expect(normalizeSettings({ appearanceThemeScheduleDarkAt: '21:30', appearanceThemeScheduleLightAt: '06:15' })).toMatchObject({
      appearanceThemeScheduleDarkAt: '21:30',
      appearanceThemeScheduleLightAt: '06:15',
    });
    expect(normalizeSettings({ appearanceThemeScheduleDarkAt: '25:99', appearanceThemeScheduleLightAt: 'morning' })).toMatchObject({
      appearanceThemeScheduleDarkAt: '19:00',
      appearanceThemeScheduleLightAt: '07:00',
    });
  });

  it('normalizes appearance theme presets', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).appearanceThemePreset).toBe('classic');
    expect(normalizeSettings({ appearanceThemePreset: 'echoTwilight' }).appearanceThemePreset).toBe('echoTwilight');
    expect(normalizeSettings({ appearanceThemePreset: 'sakuraMilk' }).appearanceThemePreset).toBe('sakuraMilk');
    expect(normalizeSettings({ appearanceThemePreset: 'lemonMochi' }).appearanceThemePreset).toBe('lemonMochi');
    expect(normalizeSettings({ appearanceThemePreset: 'seaSaltJelly' }).appearanceThemePreset).toBe('seaSaltJelly');
    expect(normalizeSettings({ appearanceThemePreset: 'caramelPudding' }).appearanceThemePreset).toBe('caramelPudding');
    expect(normalizeSettings({ appearanceThemePreset: 'neonCandy' }).appearanceThemePreset).toBe('neonCandy');
    expect(normalizeSettings({ appearanceThemePreset: 'nyanCat' }).appearanceThemePreset).toBe('nyanCat');
    expect(normalizeSettings({ appearanceThemePreset: 'childrenDoodle' }).appearanceThemePreset).toBe('childrenDoodle');
    expect(normalizeSettings({ appearanceThemePreset: 'wisteriaBubble' }).appearanceThemePreset).toBe('wisteriaBubble');
    expect(normalizeSettings({ appearanceThemePreset: 'strawberryCookie' }).appearanceThemePreset).toBe('strawberryCookie');
    expect(normalizeSettings({ appearanceThemePreset: 'graphiteAurora' }).appearanceThemePreset).toBe('graphiteAurora');
    expect(normalizeSettings({ appearanceThemePreset: 'amberNoir' }).appearanceThemePreset).toBe('amberNoir');
    expect(normalizeSettings({ appearanceThemePreset: 'oceanStudio' }).appearanceThemePreset).toBe('oceanStudio');
    expect(normalizeSettings({ appearanceThemePreset: 'rosewoodVinyl' }).appearanceThemePreset).toBe('rosewoodVinyl');
    expect(normalizeSettings({ appearanceThemePreset: 'darkSideMoon' }).appearanceThemePreset).toBe('darkSideMoon');
    expect(normalizeSettings({ appearanceThemePreset: 'shibuyaNight' }).appearanceThemePreset).toBe('shibuyaNight');
    expect(normalizeSettings({ appearanceThemePreset: 'kyotoKurenai' }).appearanceThemePreset).toBe('kyotoKurenai');
    expect(normalizeSettings({ appearanceThemePreset: 'ukiyoIndigo' }).appearanceThemePreset).toBe('ukiyoIndigo');
    expect(normalizeSettings({ appearanceThemePreset: 'fujiSnow' }).appearanceThemePreset).toBe('fujiSnow');
    expect(normalizeSettings({ appearanceThemePreset: 'matsuriLantern' }).appearanceThemePreset).toBe('matsuriLantern');
    expect(normalizeSettings({ appearanceThemePreset: 'ginzaNoir' }).appearanceThemePreset).toBe('ginzaNoir');
    expect(normalizeSettings({ appearanceThemePreset: 'frostJazz' }).appearanceThemePreset).toBe('frostJazz');
    expect(normalizeSettings({ appearanceThemePreset: 'FINAL' }).appearanceThemePreset).toBe('classic');
    expect(normalizeSettings({ appearanceThemePreset: 'midnight' as never }).appearanceThemePreset).toBe('classic');
  });

  it('keeps FINAL locked unless the unlock plugin is present for the current marker', async () => {
    const { normalizeSettings } = await import('./appSettings');
    const { finalThemeUnlockVersion } = await import('../../shared/constants/featureUnlocks');

    expect(normalizeSettings({ appearanceThemePreset: 'FINAL', finalThemeUnlockVersion: 'true' }).appearanceThemePreset).toBe('classic');
    expect(normalizeSettings({ appearanceThemePreset: 'FINAL', finalThemeUnlockVersion }).appearanceThemePreset).toBe('classic');
    expect(normalizeSettings({ appearanceThemePreset: 'FINAL', finalThemeUnlockVersion }, { finalThemeUnlocked: true }).appearanceThemePreset).toBe('FINAL');
    expect(normalizeSettings({ appearanceThemePreset: 'FINAL', finalThemeUnlockVersion }, { finalThemeUnlocked: true }).finalThemeUnlockVersion).toBe(finalThemeUnlockVersion);
  });

  it('drops FINAL custom themes and overrides even when the unlock plugin is present', async () => {
    const { normalizeSettings } = await import('./appSettings');
    const { finalThemeUnlockVersion } = await import('../../shared/constants/featureUnlocks');

    const normalized = normalizeSettings({
      appearanceThemePreset: 'FINAL',
      finalThemeUnlockVersion,
      appearanceThemeCustomId: 'theme-final',
      appearanceCustomThemes: [
        { id: 'theme-final', name: 'Final Copy', basePreset: 'FINAL', createdAt: '2026-06-08T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z' },
      ],
      appearanceThemePresetOverrides: {
        FINAL: { light: { accent: '#ffffff' } },
      },
    }, { finalThemeUnlocked: true });

    expect(normalized.appearanceThemePreset).toBe('FINAL');
    expect(normalized.appearanceThemeCustomId).toBeNull();
    expect(normalized.appearanceCustomThemes).toEqual([]);
    expect(normalized.appearanceThemePresetOverrides?.FINAL).toBeUndefined();
  });

  it('normalizes appearance theme preset expansion state', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ appearanceThemePresetsExpanded: true }).appearanceThemePresetsExpanded).toBe(true);
    expect(normalizeSettings({ appearanceThemePresetsExpanded: false }).appearanceThemePresetsExpanded).toBe(false);
    expect(normalizeSettings({ appearanceThemePresetsExpanded: 'yes' as never }).appearanceThemePresetsExpanded).toBe(false);
  });

  it('normalizes appearance theme preset overrides', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const normalized = normalizeSettings({
      appearanceThemePresetOverrides: {
        echoTwilight: {
          light: {
            appBg: '#FFF4EF',
            accent: '#df6b5f',
            panel: 'not-a-color',
            panelOpacityPercent: 10,
            glassPercent: 120,
            shadowPercent: 44.4,
          },
          dark: {
            text: '#F3E3DE',
            onAccent: '#2b1513',
          },
        },
        unknownPreset: {
          light: {
            appBg: '#000000',
          },
        },
        lemonMochi: {
          light: {
            border: '#c99a26',
            buttonText: '#332a10',
          },
        },
      },
    } as never);

    expect(normalized.appearanceThemePresetOverrides).toEqual({
      echoTwilight: {
        light: {
          appBg: '#fff4ef',
          accent: '#df6b5f',
          panelOpacityPercent: 40,
          glassPercent: 80,
          shadowPercent: 44,
        },
        dark: {
          text: '#f3e3de',
          onAccent: '#2b1513',
        },
      },
      lemonMochi: {
        light: {
          border: '#c99a26',
          buttonText: '#332a10',
        },
      },
    });
  });

  it('normalizes custom appearance themes with safe colors, clamped numbers, and a count limit', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const manyThemes = Array.from({ length: 30 }, (_item, index) => ({
      id: `theme-${index}`,
      name: `Theme ${index}`,
      basePreset: index === 0 ? 'nyanCat' : 'unknown',
      light: {
        titlebar: '#AABBCC',
        player: 'not-a-color',
        cornerRadiusPx: 99,
        panelBlurPx: -1,
        saturationPercent: 42,
        motionEnabled: false,
        motionSpeedSeconds: 99,
        motionIntensityPercent: 222,
      },
      dark: {
        danger: '#ff0011',
        success: '#00aa77',
        warning: '#FFCC00',
      },
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T01:00:00.000Z',
    }));

    const normalized = normalizeSettings({
      appearanceCustomThemes: [
        ...manyThemes,
        { id: 'theme-0', name: 'Duplicate', basePreset: 'classic' },
        { id: 'bad id', name: 'Bad', basePreset: 'classic' },
      ],
      appearanceThemeCustomId: 'theme-0',
    } as never);

    expect(normalized.appearanceCustomThemes).toHaveLength(24);
    expect(normalized.appearanceThemeCustomId).toBe('theme-0');
    expect(normalized.appearanceThemePreset).toBe('nyanCat');
    expect(normalized.appearanceCustomThemes?.[0]).toEqual({
      id: 'theme-0',
      name: 'Theme 0',
      basePreset: 'nyanCat',
      light: {
        titlebar: '#aabbcc',
        cornerRadiusPx: 28,
        panelBlurPx: 0,
        saturationPercent: 60,
        motionEnabled: false,
        motionSpeedSeconds: 8,
        motionIntensityPercent: 160,
      },
      dark: {
        danger: '#ff0011',
        success: '#00aa77',
        warning: '#ffcc00',
      },
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T01:00:00.000Z',
    });
    expect(normalized.appearanceCustomThemes?.[1]?.basePreset).toBe('classic');
    expect(normalizeSettings({ appearanceCustomThemes: manyThemes, appearanceThemeCustomId: 'missing' } as never).appearanceThemeCustomId).toBeNull();
  });

  it('resolves a custom coverCacheDir to an absolute path', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ coverCacheDir: 'relative-cover-cache' }).coverCacheDir).toBe(resolve('relative-cover-cache'));
  });

  it('normalizes albumMergeStrategy values', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).albumMergeStrategy).toBe('standard');
    expect(normalizeSettings({ albumMergeStrategy: 'sameTitleAndCover' }).albumMergeStrategy).toBe('sameTitleAndCover');
    expect(normalizeSettings({ albumMergeStrategy: 'loose' as never }).albumMergeStrategy).toBe('standard');
  });

  it('normalizes artistMergeStrategy values', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).artistMergeStrategy).toBe('standard');
    expect(normalizeSettings({ artistMergeStrategy: 'conservative' }).artistMergeStrategy).toBe('conservative');
    expect(normalizeSettings({ artistMergeStrategy: 'loose' as never }).artistMergeStrategy).toBe('standard');
  });

  it('keeps gapless playback opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).gaplessPlaybackEnabled).toBe(false);
    expect(normalizeSettings({ gaplessPlaybackEnabled: true }).gaplessPlaybackEnabled).toBe(true);
    expect(normalizeSettings({ gaplessPlaybackEnabled: 'yes' as never }).gaplessPlaybackEnabled).toBe(false);
  });

  it('keeps Chinese cross-script search enabled unless explicitly disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).chineseCrossScriptSearchEnabled).toBe(true);
    expect(normalizeSettings({ chineseCrossScriptSearchEnabled: true }).chineseCrossScriptSearchEnabled).toBe(true);
    expect(normalizeSettings({ chineseCrossScriptSearchEnabled: false }).chineseCrossScriptSearchEnabled).toBe(false);
    expect(normalizeSettings({ chineseCrossScriptSearchEnabled: 'no' as never }).chineseCrossScriptSearchEnabled).toBe(true);
  });

  it('normalizes artist wall album artwork setting as disabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).artistWallAlbumArtwork).toBe(false);
    expect(normalizeSettings({ artistWallAlbumArtwork: 'yes' as never }).artistWallAlbumArtwork).toBe(false);
    expect(normalizeSettings({ artistWallAlbumArtwork: true }).artistWallAlbumArtwork).toBe(true);
  });

  it('normalizes artist wall missing-avatar fallback as disabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).artistWallAlbumFallbackForMissingAvatars).toBe(false);
    expect(normalizeSettings({ artistWallAlbumFallbackForMissingAvatars: 'yes' as never }).artistWallAlbumFallbackForMissingAvatars).toBe(false);
    expect(normalizeSettings({ artistWallAlbumFallbackForMissingAvatars: true }).artistWallAlbumFallbackForMissingAvatars).toBe(true);
  });

  it('normalizes automatic artist image fetching as disabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).autoFetchArtistImages).toBe(false);
    expect(normalizeSettings({ autoFetchArtistImages: 'yes' as never }).autoFetchArtistImages).toBe(false);
    expect(normalizeSettings({ autoFetchArtistImages: true }).autoFetchArtistImages).toBe(true);
  });

  it('normalizes artist image fetching pause as disabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).artistImageFetchPaused).toBe(false);
    expect(normalizeSettings({ artistImageFetchPaused: 'yes' as never }).artistImageFetchPaused).toBe(false);
    expect(normalizeSettings({ artistImageFetchPaused: true }).artistImageFetchPaused).toBe(true);
  });

  it('keeps playlist backups enabled unless explicitly disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).playlistBackupsEnabled).toBe(true);
    expect(normalizeSettings({ playlistBackupsEnabled: true }).playlistBackupsEnabled).toBe(true);
    expect(normalizeSettings({ playlistBackupsEnabled: false }).playlistBackupsEnabled).toBe(false);
    expect(normalizeSettings({ playlistBackupsEnabled: 'no' as never }).playlistBackupsEnabled).toBe(true);
  });

  it('keeps startup account checks enabled unless explicitly disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).autoAccountCheckOnStartup).toBe(true);
    expect(normalizeSettings({ autoAccountCheckOnStartup: true }).autoAccountCheckOnStartup).toBe(true);
    expect(normalizeSettings({ autoAccountCheckOnStartup: false }).autoAccountCheckOnStartup).toBe(false);
    expect(normalizeSettings({ autoAccountCheckOnStartup: 'no' as never }).autoAccountCheckOnStartup).toBe(true);
  });

  it('suppresses account expiry notices unless explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).suppressAccountExpiryNotices).toBe(true);
    expect(normalizeSettings({ suppressAccountExpiryNotices: true }).suppressAccountExpiryNotices).toBe(true);
    expect(normalizeSettings({ suppressAccountExpiryNotices: false }).suppressAccountExpiryNotices).toBe(false);
    expect(normalizeSettings({ suppressAccountExpiryNotices: 'yes' as never }).suppressAccountExpiryNotices).toBe(true);
  });

  it('keeps Spotify official player auto launch enabled unless explicitly disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).spotifyAutoLaunchOfficialPlayer).toBe(true);
    expect(normalizeSettings({ spotifyAutoLaunchOfficialPlayer: true }).spotifyAutoLaunchOfficialPlayer).toBe(true);
    expect(normalizeSettings({ spotifyAutoLaunchOfficialPlayer: false }).spotifyAutoLaunchOfficialPlayer).toBe(false);
    expect(normalizeSettings({ spotifyAutoLaunchOfficialPlayer: 'no' as never }).spotifyAutoLaunchOfficialPlayer).toBe(true);
  });

  it('normalizes optional Spotify OAuth app settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).spotifyClientId).toBeNull();
    expect(normalizeSettings({}).spotifyRedirectUri).toBeNull();
    expect(normalizeSettings({ spotifyClientId: '  abcDEF1234567890  ' }).spotifyClientId).toBe('abcDEF1234567890');
    expect(normalizeSettings({ spotifyClientId: 'bad id!' }).spotifyClientId).toBeNull();
    expect(normalizeSettings({ spotifyRedirectUri: ' http://127.0.0.1:43901/custom/callback ' }).spotifyRedirectUri).toBe(
      'http://127.0.0.1:43901/custom/callback',
    );
    expect(normalizeSettings({ spotifyRedirectUri: 'http://localhost:43901/custom/callback' }).spotifyRedirectUri).toBeNull();
    expect(normalizeSettings({ spotifyRedirectUri: 'https://127.0.0.1:43901/custom/callback' }).spotifyRedirectUri).toBeNull();
  });

  it('normalizes optional TIDAL developer app settings', async () => {
    const { defaultTidalClientId, normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).tidalClientId).toBe(defaultTidalClientId);
    expect(normalizeSettings({}).tidalClientSecret).toBeNull();
    expect(normalizeSettings({}).tidalCountryCode).toBe('US');
    expect(normalizeSettings({ tidalClientId: '  vmtQLf79BHl9YgUT  ' }).tidalClientId).toBe('vmtQLf79BHl9YgUT');
    expect(normalizeSettings({ tidalClientId: 'bad id!' }).tidalClientId).toBe(defaultTidalClientId);
    expect(normalizeSettings({ tidalClientSecret: '  tidal-secret_123  ' }).tidalClientSecret).toBe('tidal-secret_123');
    expect(normalizeSettings({ tidalClientSecret: 'bad secret with spaces' }).tidalClientSecret).toBeNull();
    expect(normalizeSettings({ tidalCountryCode: ' hk ' }).tidalCountryCode).toBe('HK');
    expect(normalizeSettings({ tidalCountryCode: 'hkg' }).tidalCountryCode).toBe('US');
    expect(normalizeSettings({ tidalRedirectUri: ' http://127.0.0.1:43880/tidal/callback ' }).tidalRedirectUri).toBe(
      'http://127.0.0.1:43880/tidal/callback',
    );
  });

  it('keeps Connect receiver autostart disabled until explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).connectAutoStartReceiversEnabled).toBe(false);
    expect(normalizeSettings({ connectAutoStartReceiversEnabled: true }).connectAutoStartReceiversEnabled).toBe(true);
    expect(normalizeSettings({ connectAutoStartReceiversEnabled: false }).connectAutoStartReceiversEnabled).toBe(false);
    expect(normalizeSettings({ connectAutoStartReceiversEnabled: 'yes' as never }).connectAutoStartReceiversEnabled).toBe(false);
  });

  it('defaults AirPlay receiver to AirPlay 1 unless the experimental mode is selected', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).airPlayReceiverProtocol).toBe('airplay1');
    expect(normalizeSettings({ airPlayReceiverProtocol: 'airplay1' }).airPlayReceiverProtocol).toBe('airplay1');
    expect(normalizeSettings({ airPlayReceiverProtocol: 'airplay2' }).airPlayReceiverProtocol).toBe('airplay2');
    expect(normalizeSettings({ airPlayReceiverProtocol: 'airplay3' as never }).airPlayReceiverProtocol).toBe('airplay1');
  });

  it('normalizes remembered window size settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).rememberWindowSizeEnabled).toBe(true);
    expect(normalizeSettings({ rememberWindowSizeEnabled: false }).rememberWindowSizeEnabled).toBe(false);
    expect(normalizeSettings({ rememberWindowSizeEnabled: 'no' as never }).rememberWindowSizeEnabled).toBe(true);
    expect(normalizeSettings({ rememberedWindowSize: { width: 1280.4, height: 720.6 } }).rememberedWindowSize).toEqual({
      width: 1280,
      height: 721,
    });
    expect(normalizeSettings({ rememberedWindowSize: { width: 100, height: 100 } }).rememberedWindowSize).toEqual({
      width: 360,
      height: 620,
    });
    expect(normalizeSettings({ rememberedWindowSize: { width: 'wide', height: 720 } as never }).rememberedWindowSize).toBeNull();
  });

  it('normalizes sidebar auto-hide as a default-off opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).sidebarAutoHideEnabled).toBe(false);
    expect(normalizeSettings({ sidebarAutoHideEnabled: true }).sidebarAutoHideEnabled).toBe(true);
    expect(normalizeSettings({ sidebarAutoHideEnabled: 'true' as never }).sidebarAutoHideEnabled).toBe(false);
  });

  it('normalizes sidebar icon-only as a visible-sidebar opt-in', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).sidebarIconOnlyEnabled).toBe(false);
    expect(normalizeSettings({ sidebarIconOnlyEnabled: true }).sidebarIconOnlyEnabled).toBe(true);
    expect(normalizeSettings({ sidebarIconOnlyEnabled: 'true' as never }).sidebarIconOnlyEnabled).toBe(false);
    expect(normalizeSettings({ sidebarAutoHideEnabled: true, sidebarIconOnlyEnabled: true }).sidebarIconOnlyEnabled).toBe(false);
  });

  it('normalizes hidden feature comments as a default-off display preference', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).featureCommentsHidden).toBe(false);
    expect(normalizeSettings({ featureCommentsHidden: true }).featureCommentsHidden).toBe(true);
    expect(normalizeSettings({ featureCommentsHidden: 'true' as never }).featureCommentsHidden).toBe(false);
  });

  it('normalizes app wallpaper settings without accepting unsafe paths', async () => {
    const { normalizeSettings } = await import('./appSettings');
    userDataPath = join(tmpdir(), `echo-next-settings-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    tempRoots.push(userDataPath);
    const appWallpaperDirectory = join(userDataPath, 'app-wallpapers');
    mkdirSync(appWallpaperDirectory, { recursive: true });
    const videoWallpaperPath = join(appWallpaperDirectory, 'motion.mp4');
    const portraitWallpaperPath = join(appWallpaperDirectory, 'portrait.webp');
    const portraitVideoWallpaperPath = join(appWallpaperDirectory, 'portrait-motion.webm');
    const unsupportedWallpaperPath = join(appWallpaperDirectory, 'motion.mkv');
    writeFileSync(videoWallpaperPath, 'video');
    writeFileSync(portraitWallpaperPath, 'portrait');
    writeFileSync(portraitVideoWallpaperPath, 'portrait-video');
    writeFileSync(unsupportedWallpaperPath, 'unsupported');

    expect(
      normalizeSettings({
        appCustomWallpaperPath: 'D:\\Outside\\wallpaper.png',
        appPortraitWallpaperPath: 'D:\\Outside\\portrait.png',
        appWallpaperScalePercent: 999,
        appWallpaperBlurPx: 99,
        appWallpaperBrightnessPercent: 12,
        appWallpaperUiOpacityPercent: -10,
        appWallpaperVisualProtectionEnabled: false,
        appWallpaperUnifiedOpacityEnabled: true,
      }),
    ).toMatchObject({
      appCustomWallpaperPath: null,
      appPortraitWallpaperPath: null,
      appWallpaperScalePercent: 220,
      appWallpaperBlurPx: 40,
      appWallpaperBrightnessPercent: 40,
      appWallpaperUiOpacityPercent: 0,
      appWallpaperVisualProtectionEnabled: false,
      appWallpaperUnifiedOpacityEnabled: true,
    });

    expect(
      normalizeSettings({
        appWallpaperScalePercent: 80,
        appWallpaperBlurPx: -4,
        appWallpaperBrightnessPercent: 180,
        appWallpaperUiOpacityPercent: 128,
        appWallpaperVisualProtectionEnabled: 'yes' as never,
        appWallpaperUnifiedOpacityEnabled: 'yes' as never,
      }),
    ).toMatchObject({
      appWallpaperScalePercent: 100,
      appWallpaperBlurPx: 0,
      appWallpaperBrightnessPercent: 140,
      appWallpaperUiOpacityPercent: 100,
      appWallpaperVisualProtectionEnabled: true,
      appWallpaperUnifiedOpacityEnabled: false,
    });

    expect(
      normalizeSettings({
        appCustomWallpaperPath: videoWallpaperPath,
        appPortraitWallpaperPath: portraitWallpaperPath,
        appWallpaperMediaType: 'image',
        appPortraitWallpaperMediaType: 'video',
        appVideoWallpaperPauseMode: 'minimized',
      }),
    ).toMatchObject({
      appCustomWallpaperPath: videoWallpaperPath,
      appPortraitWallpaperPath: portraitWallpaperPath,
      appWallpaperMediaType: 'video',
      appPortraitWallpaperMediaType: 'image',
      appVideoWallpaperPauseMode: 'minimized',
    });

    expect(
      normalizeSettings({
        appPortraitWallpaperPath: portraitVideoWallpaperPath,
        appPortraitWallpaperMediaType: 'image',
      }),
    ).toMatchObject({
      appPortraitWallpaperPath: portraitVideoWallpaperPath,
      appPortraitWallpaperMediaType: 'video',
    });

    expect(
      normalizeSettings({
        appCustomWallpaperPath: unsupportedWallpaperPath,
        appPortraitWallpaperPath: unsupportedWallpaperPath,
        appWallpaperMediaType: 'video',
        appPortraitWallpaperMediaType: 'video',
        appVideoWallpaperPauseMode: 'always' as never,
      }),
    ).toMatchObject({
      appCustomWallpaperPath: null,
      appPortraitWallpaperPath: null,
      appWallpaperMediaType: 'image',
      appPortraitWallpaperMediaType: 'image',
      appVideoWallpaperPauseMode: 'smart',
    });
  });

  it('keeps Discord Rich Presence enabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).discordRichPresenceEnabled).toBe(true);
    expect(normalizeSettings({ discordRichPresenceEnabled: true }).discordRichPresenceEnabled).toBe(true);
    expect(normalizeSettings({ discordRichPresenceEnabled: false }).discordRichPresenceEnabled).toBe(false);
    expect(normalizeSettings({ discordRichPresenceEnabled: 'yes' as never }).discordRichPresenceEnabled).toBe(false);
  });

  it('normalizes Last.fm settings with privacy-friendly defaults', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({})).toMatchObject({
      lastFmEnabled: false,
      lastFmUsername: null,
      lastFmSessionKey: null,
      lastFmScrobbleEnabled: true,
      lastFmNowPlayingEnabled: true,
      lastFmMinScrobbleSeconds: 30,
      lastFmAuthToken: null,
      taskbarPlaybackControlsEnabled: false,
    });
    expect(
      normalizeSettings({
        lastFmEnabled: true,
        lastFmUsername: ' alice ',
        lastFmSessionKey: ' session ',
        lastFmScrobbleEnabled: false,
        lastFmNowPlayingEnabled: false,
        lastFmMinScrobbleSeconds: 999,
        lastFmAuthToken: ' token ',
        taskbarPlaybackControlsEnabled: true,
      }),
    ).toMatchObject({
      lastFmEnabled: true,
      lastFmUsername: 'alice',
      lastFmSessionKey: 'session',
      lastFmScrobbleEnabled: false,
      lastFmNowPlayingEnabled: false,
      lastFmMinScrobbleSeconds: 240,
      lastFmAuthToken: 'token',
      taskbarPlaybackControlsEnabled: true,
    });
  });

  it('normalizes mini player window settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({})).toMatchObject({
      miniPlayerEnabled: false,
      miniPlayerLocked: false,
      miniPlayerAutoHideMainWindow: true,
      miniPlayerBounds: null,
    });
    expect(
      normalizeSettings({
        miniPlayerAutoHideMainWindow: false,
      }),
    ).toMatchObject({
      miniPlayerAutoHideMainWindow: false,
    });
    expect(
      normalizeSettings({
        lyricsPlayerBarDrawerAutoEnableForMv: false,
        lyricsPlayerBarDrawerAutoHideEnabled: true,
      }),
    ).toMatchObject({
      lyricsPlayerBarDrawerAutoEnableForMv: false,
      lyricsPlayerBarDrawerAutoHideEnabled: true,
    });
    expect(
      normalizeSettings({
        miniPlayerEnabled: true,
        miniPlayerLocked: true,
        miniPlayerAutoHideMainWindow: true,
        miniPlayerBounds: { x: 12.4, y: 20.6, width: 1200, height: 40 },
      }),
    ).toMatchObject({
      miniPlayerEnabled: true,
      miniPlayerLocked: false,
      miniPlayerAutoHideMainWindow: true,
      miniPlayerBounds: { x: 12, y: 21, width: 388, height: 74 },
    });
  });

  it('normalizes scan performance mode', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).scanPerformanceMode).toBe('balanced');
    expect(normalizeSettings({ scanPerformanceMode: 'low' }).scanPerformanceMode).toBe('low');
    expect(normalizeSettings({ scanPerformanceMode: 'performance' }).scanPerformanceMode).toBe('performance');
    expect(normalizeSettings({ scanPerformanceMode: 'turbo' as never }).scanPerformanceMode).toBe('balanced');
  });

  it('normalizes remote cover load performance mode', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).remoteCoverLoadPerformanceMode).toBe('balanced');
    expect(normalizeSettings({ remoteCoverLoadPerformanceMode: 'low' }).remoteCoverLoadPerformanceMode).toBe('low');
    expect(normalizeSettings({ remoteCoverLoadPerformanceMode: 'aggressive' }).remoteCoverLoadPerformanceMode).toBe('aggressive');
    expect(normalizeSettings({ remoteCoverLoadPerformanceMode: 'lan' }).remoteCoverLoadPerformanceMode).toBe('lan');
    expect(normalizeSettings({ remoteCoverLoadPerformanceMode: 'turbo' as never }).remoteCoverLoadPerformanceMode).toBe('balanced');
  });

  it('normalizes remote background concurrency limits', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).remoteBackgroundConcurrency).toEqual({
      metadata: 2,
      cover: 2,
      lyrics: 1,
      mv: 1,
      durationBackfill: 1,
    });
    expect(normalizeSettings({
      remoteBackgroundConcurrency: {
        metadata: 12,
        cover: 99,
        lyrics: 3,
        mv: 0,
        durationBackfill: 4,
      },
    }).remoteBackgroundConcurrency).toEqual({
      metadata: 8,
      cover: 48,
      lyrics: 3,
      mv: 1,
      durationBackfill: 4,
    });
  });

  it('normalizes remote album merge strategy', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).remoteAlbumMergeStrategy).toBe('conservative');
    expect(normalizeSettings({ remoteAlbumMergeStrategy: 'conservative' }).remoteAlbumMergeStrategy).toBe('conservative');
    expect(normalizeSettings({ remoteAlbumMergeStrategy: 'standard' }).remoteAlbumMergeStrategy).toBe('standard');
    expect(normalizeSettings({ remoteAlbumMergeStrategy: 'loose' as never }).remoteAlbumMergeStrategy).toBe('conservative');
  });

  it('normalizes MV sync mode', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).mvSyncMode).toBe('balanced');
    expect(normalizeSettings({ mvSyncMode: 'stable' }).mvSyncMode).toBe('stable');
    expect(normalizeSettings({ mvSyncMode: 'precise' }).mvSyncMode).toBe('precise');
    expect(normalizeSettings({ mvSyncMode: 'strict' as never }).mvSyncMode).toBe('balanced');
  });

  it('migrates the legacy background space pause setting to disabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).backgroundSpacePauseEnabled).toBe(false);
    expect(normalizeSettings({ backgroundSpacePauseEnabled: true }).backgroundSpacePauseEnabled).toBe(false);
    expect(normalizeSettings({ backgroundSpacePauseEnabled: 'yes' as never }).backgroundSpacePauseEnabled).toBe(false);
  });

  it('normalizes global shortcut settings as disabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const shortcuts = normalizeSettings({}).globalShortcuts;

    expect(shortcuts?.playPause).toEqual({ enabled: false, accelerator: null });
    expect(shortcuts?.previousTrack).toEqual({ enabled: false, accelerator: null });
    expect(shortcuts?.showMainWindow).toEqual({ enabled: false, accelerator: null });
  });

  it('normalizes local shortcut settings with focused-window defaults', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const shortcuts = normalizeSettings({}).localShortcuts;
    const defaults = createDefaultLocalShortcuts();

    expect(shortcuts?.playPause).toEqual(defaults.playPause);
    expect(shortcuts?.previousTrack).toEqual(defaults.previousTrack);
    expect(shortcuts?.nextTrack).toEqual(defaults.nextTrack);
  });

  it('keeps valid global shortcuts and removes invalid or duplicate bindings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const shortcuts = normalizeSettings({
      globalShortcuts: {
        playPause: { enabled: true, accelerator: 'ctrl + alt + space' },
        previousTrack: { enabled: true, accelerator: 'Space' },
        nextTrack: { enabled: true, accelerator: 'Ctrl+Alt+Space' },
        stop: { enabled: true, accelerator: 'MediaStop' },
        volumeUp: { enabled: true, accelerator: 'F13' },
        volumeDown: { enabled: true, accelerator: 'MouseButton4' },
        seekBackward: { enabled: true, accelerator: 'Ctrl+Alt+???' },
      },
    }).globalShortcuts;

    expect(shortcuts?.playPause).toEqual({ enabled: true, accelerator: 'Ctrl+Alt+Space' });
    expect(shortcuts?.previousTrack).toEqual({ enabled: true, accelerator: 'Space' });
    expect(shortcuts?.nextTrack).toEqual({ enabled: false, accelerator: null });
    expect(shortcuts?.stop).toEqual({ enabled: true, accelerator: 'MediaStop' });
    expect(shortcuts?.volumeUp).toEqual({ enabled: true, accelerator: 'F13' });
    expect(shortcuts?.volumeDown).toEqual({ enabled: true, accelerator: 'MouseButton4' });
    expect(shortcuts?.seekBackward).toEqual({ enabled: false, accelerator: null });
  });

  it('keeps valid local shortcuts and removes invalid or duplicate bindings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const shortcuts = normalizeSettings({
      localShortcuts: {
        playPause: { enabled: true, accelerator: 'ctrl + p' },
        previousTrack: { enabled: true, accelerator: 'a' },
        nextTrack: { enabled: true, accelerator: 'A' },
        stop: { enabled: true, accelerator: 'MediaStop' },
        volumeUp: { enabled: true, accelerator: 'Ctrl+Up' },
        seekBackward: { enabled: true, accelerator: 'Ctrl+???' },
      },
    }).localShortcuts;

    expect(shortcuts?.playPause).toEqual({ enabled: true, accelerator: 'Ctrl+P' });
    expect(shortcuts?.previousTrack).toEqual({ enabled: true, accelerator: 'A' });
    expect(shortcuts?.nextTrack).toEqual({ enabled: false, accelerator: null });
    expect(shortcuts?.stop).toEqual({ enabled: true, accelerator: 'MediaStop' });
    expect(shortcuts?.volumeUp).toEqual({ enabled: true, accelerator: 'Ctrl+Up' });
    expect(shortcuts?.seekBackward).toEqual({ enabled: false, accelerator: null });
  });

  it('defaults users without remembered audio output to system audio', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).rememberedAudioOutput).toMatchObject({
      enabled: true,
      outputMode: 'system',
      sharedBackend: 'auto',
      latencyProfile: 'balanced',
    });
  });

  it('preserves valid remembered audio output latency profiles', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(
      normalizeSettings({
        appMemoryVersion: 5,
        rememberedAudioOutput: { enabled: true, outputMode: 'asio', latencyProfile: 'balanced' },
      }).rememberedAudioOutput,
    ).toMatchObject({
      enabled: true,
      outputMode: 'asio',
      latencyProfile: 'balanced',
    });
    expect(
      normalizeSettings({
        rememberedAudioOutput: { enabled: true, outputMode: 'shared', sharedBackend: 'directsound', latencyProfile: 'stable' },
      }).rememberedAudioOutput,
    ).toMatchObject({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'directsound',
      latencyProfile: 'stable',
    });
    expect(
      normalizeSettings({
        rememberedAudioOutput: { enabled: true, outputMode: 'shared', sharedBackend: 'alsa', latencyProfile: 'stable' },
      }).rememberedAudioOutput,
    ).toMatchObject({
      enabled: true,
      outputMode: 'shared',
      sharedBackend: 'alsa',
      latencyProfile: 'stable',
    });
    expect(
      normalizeSettings({
        rememberedAudioOutput: { enabled: false, outputMode: 'shared', sharedBackend: 'auto', latencyProfile: 'balanced' },
      }).rememberedAudioOutput,
    ).toMatchObject({
      enabled: false,
      outputMode: 'shared',
      sharedBackend: 'auto',
      latencyProfile: 'balanced',
    });
    expect(
      normalizeSettings({
        rememberedAudioOutput: { enabled: true, outputMode: 'shared', sharedBackend: 'invalid' as never },
      }).rememberedAudioOutput?.sharedBackend,
    ).toBe('auto');
  });

  it('migrates stale remembered exclusive output back to system audio', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(
      normalizeSettings({
        appMemoryVersion: 4,
        rememberedAudioOutput: {
          enabled: true,
          outputMode: 'exclusive',
          sharedBackend: 'auto',
          latencyProfile: 'balanced',
          deviceIndex: 6,
          deviceName: 'TEAC USB AUDIO DEVICE',
        },
      }).rememberedAudioOutput,
    ).toEqual({
      enabled: true,
      outputMode: 'system',
      sharedBackend: 'auto',
      latencyProfile: 'balanced',
    });
    expect(
      normalizeSettings({
        appMemoryVersion: 5,
        rememberedAudioOutput: { enabled: true, outputMode: 'exclusive', latencyProfile: 'balanced' },
      }).rememberedAudioOutput,
    ).toMatchObject({
      enabled: true,
      outputMode: 'exclusive',
      latencyProfile: 'balanced',
    });
  });

  it('sanitizes incompatible remembered low-latency buffer sizes', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(
      normalizeSettings({
        rememberedAudioOutput: {
          enabled: true,
          outputMode: 'shared',
          latencyProfile: 'lowLatency',
          bufferSizeFrames: 8192,
        },
      }).rememberedAudioOutput,
    ).not.toHaveProperty('bufferSizeFrames');
    expect(
      normalizeSettings({
        rememberedAudioOutput: {
          enabled: true,
          outputMode: 'asio',
          latencyProfile: 'lowLatency',
          bufferSizeFrames: 8192,
        },
      }).rememberedAudioOutput?.bufferSizeFrames,
    ).toBe(2048);
    expect(
      normalizeSettings({
        rememberedAudioOutput: {
          enabled: true,
          outputMode: 'shared',
          latencyProfile: 'stable',
          bufferSizeFrames: 8192,
        },
      }).rememberedAudioOutput?.bufferSizeFrames,
    ).toBe(8192);
  });

  it('normalizes JUCE output as an opt-in audio output', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioUseJuceOutput).toBe(false);
    expect(normalizeSettings({ audioUseJuceOutput: true }).audioUseJuceOutput).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 5, audioUseJuceOutput: false }).audioUseJuceOutput).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 6, audioUseJuceOutput: true }).audioUseJuceOutput).toBe(true);
    expect(normalizeSettings({ appMemoryVersion: 6, audioUseJuceOutput: 'yes' as never }).audioUseJuceOutput).toBe(false);
  });

  it('migrates older settings back to the FFmpeg compatibility output by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ appMemoryVersion: 1, audioUseJuceOutput: true }).audioUseJuceOutput).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 1, audioUseJuceOutput: false }).appMemoryVersion).toBe(6);
  });

  it('normalizes JUCE decode as an opt-in local decode fast path', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioUseJuceDecode).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 5, audioUseJuceDecode: true }).audioUseJuceDecode).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 6, audioUseJuceDecode: true }).audioUseJuceDecode).toBe(true);
    expect(normalizeSettings({ appMemoryVersion: 3, audioUseJuceDecode: false }).audioUseJuceDecode).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 3, audioUseJuceDecode: 'yes' as never }).audioUseJuceDecode).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 3, audioUseJuceDecode: true }).audioUseJuceDecode).toBe(false);
    expect(normalizeSettings({ appMemoryVersion: 2, audioUseJuceDecode: false }).audioUseJuceDecode).toBe(false);
  });

  it('normalizes ASIO unavailable fallback as an opt-in audio setting', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioAsioUnavailableFallbackEnabled).toBe(false);
    expect(normalizeSettings({ audioAsioUnavailableFallbackEnabled: true }).audioAsioUnavailableFallbackEnabled).toBe(true);
    expect(normalizeSettings({ audioAsioUnavailableFallbackEnabled: false }).audioAsioUnavailableFallbackEnabled).toBe(false);
    expect(normalizeSettings({ audioAsioUnavailableFallbackEnabled: 'yes' as never }).audioAsioUnavailableFallbackEnabled).toBe(false);
  });

  it('normalizes exclusive instability fallback as an opt-in audio setting', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioExclusiveInstabilityFallbackEnabled).toBe(false);
    expect(normalizeSettings({ audioExclusiveInstabilityFallbackEnabled: true }).audioExclusiveInstabilityFallbackEnabled).toBe(true);
    expect(normalizeSettings({ audioExclusiveInstabilityFallbackEnabled: false }).audioExclusiveInstabilityFallbackEnabled).toBe(false);
    expect(normalizeSettings({ audioExclusiveInstabilityFallbackEnabled: 'yes' as never }).audioExclusiveInstabilityFallbackEnabled).toBe(false);
  });

  it('keeps ASIO native DSD experiment disabled until explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioAsioNativeDsdExperimentalEnabled).toBe(false);
    expect(normalizeSettings({ audioAsioNativeDsdExperimentalEnabled: true }).audioAsioNativeDsdExperimentalEnabled).toBe(true);
    expect(normalizeSettings({ audioAsioNativeDsdExperimentalEnabled: false }).audioAsioNativeDsdExperimentalEnabled).toBe(false);
    expect(normalizeSettings({ audioAsioNativeDsdExperimentalEnabled: 'yes' as never }).audioAsioNativeDsdExperimentalEnabled).toBe(false);
  });

  it('keeps DSD auto volume lock disabled until explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioDsdAutoVolumeLockEnabled).toBe(false);
    expect(normalizeSettings({ audioDsdAutoVolumeLockEnabled: true }).audioDsdAutoVolumeLockEnabled).toBe(true);
    expect(normalizeSettings({ audioDsdAutoVolumeLockEnabled: false }).audioDsdAutoVolumeLockEnabled).toBe(false);
    expect(normalizeSettings({ audioDsdAutoVolumeLockEnabled: 'yes' as never }).audioDsdAutoVolumeLockEnabled).toBe(false);
  });

  it('keeps SOXR fallback enabled by default for stable playback', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioSoxrFallbackEnabled).toBe(true);
    expect(normalizeSettings({ audioSoxrFallbackEnabled: true }).audioSoxrFallbackEnabled).toBe(true);
    expect(normalizeSettings({ audioSoxrFallbackEnabled: false }).audioSoxrFallbackEnabled).toBe(false);
    expect(normalizeSettings({ audioSoxrFallbackEnabled: 'yes' as never }).audioSoxrFallbackEnabled).toBe(true);
  });

  it('keeps ECHO SRC disabled by default and normalizes safe PCM targets', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioEchoSrcMode).toBe('off');
    expect(normalizeSettings({ audioEchoSrcMode: 'family2x' }).audioEchoSrcMode).toBe('family2x');
    expect(normalizeSettings({ audioEchoSrcMode: 'family4x' }).audioEchoSrcMode).toBe('family4x');
    expect(normalizeSettings({ audioEchoSrcMode: 'family8x' }).audioEchoSrcMode).toBe('family8x');
    expect(normalizeSettings({ audioEchoSrcMode: 'dsd512' as never }).audioEchoSrcMode).toBe('off');
    expect(normalizeSettings({}).audioEchoSrcQualityProfile).toBe('transparent');
    expect(normalizeSettings({ audioEchoSrcQualityProfile: 'balanced' }).audioEchoSrcQualityProfile).toBe('balanced');
    expect(normalizeSettings({ audioEchoSrcQualityProfile: 'lowLatency' }).audioEchoSrcQualityProfile).toBe('lowLatency');
    expect(normalizeSettings({ audioEchoSrcQualityProfile: 'linearPhase' as never }).audioEchoSrcQualityProfile).toBe('transparent');
  });

  it('keeps release-exclusive-on-pause experiment disabled until explicitly enabled', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioReleaseExclusiveOnPauseExperimentalEnabled).toBe(false);
    expect(normalizeSettings({ audioReleaseExclusiveOnPauseExperimentalEnabled: true }).audioReleaseExclusiveOnPauseExperimentalEnabled).toBe(true);
    expect(normalizeSettings({ audioReleaseExclusiveOnPauseExperimentalEnabled: false }).audioReleaseExclusiveOnPauseExperimentalEnabled).toBe(false);
    expect(normalizeSettings({ audioReleaseExclusiveOnPauseExperimentalEnabled: 'yes' as never }).audioReleaseExclusiveOnPauseExperimentalEnabled).toBe(false);
  });

  it('keeps audio analysis enabled by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).audioAnalysisEnabled).toBe(true);
    expect(normalizeSettings({ audioAnalysisEnabled: false }).audioAnalysisEnabled).toBe(false);
    expect(normalizeSettings({ audioAnalysisEnabled: true }).audioAnalysisEnabled).toBe(true);
    expect(normalizeSettings({ audioAnalysisEnabled: 'yes' as never }).audioAnalysisEnabled).toBe(true);
    expect(normalizeSettings({ smtcLyricsEnabled: true }).smtcLyricsEnabled).toBe(true);
    expect(normalizeSettings({ smtcLyricsEnabled: false }).smtcLyricsEnabled).toBe(false);
    expect(normalizeSettings({ smtcLyricsEnabled: 'yes' as never }).smtcLyricsEnabled).toBe(false);
    expect(normalizeSettings({}).audioIssueDiagnosticsWindowEnabled).toBe(false);
    expect(normalizeSettings({ audioIssueDiagnosticsWindowEnabled: true }).audioIssueDiagnosticsWindowEnabled).toBe(true);
    expect(normalizeSettings({ audioIssueDiagnosticsWindowEnabled: 'yes' as never }).audioIssueDiagnosticsWindowEnabled).toBe(false);
  });

  it('keeps ReplayGain analysis lazy by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).replayGainAnalyzeOnPlay).toBe(true);
    expect(normalizeSettings({}).replayGainAnalyzeMissingOnScan).toBe(false);
    expect(normalizeSettings({ replayGainAnalyzeOnPlay: false }).replayGainAnalyzeOnPlay).toBe(false);
    expect(normalizeSettings({ replayGainAnalyzeMissingOnScan: true }).replayGainAnalyzeMissingOnScan).toBe(false);
    expect(normalizeSettings({
      replayGainAnalyzeMissingOnScan: true,
      replayGainAnalyzeMissingOnScanOptIn: true,
    }).replayGainAnalyzeMissingOnScan).toBe(true);
    expect(normalizeSettings({ replayGainAnalyzeMissingOnScan: 'yes' as never }).replayGainAnalyzeMissingOnScan).toBe(false);
  });

  it('normalizes duplicate track settings conservatively', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).duplicateTracksEnabled).toBe(true);
    expect(normalizeSettings({ duplicateTracksEnabled: false }).duplicateTracksEnabled).toBe(false);
    expect(normalizeSettings({ duplicateTracksEnabled: true }).duplicateTracksEnabled).toBe(true);
    expect(normalizeSettings({ duplicateTracksMode: 'aggressive' }).duplicateTracksMode).toBe('strict');
    expect(normalizeSettings({ duplicateTracksAutoRebuildAfterScan: true }).duplicateTracksAutoRebuildAfterScan).toBe(true);
  });

  it('keeps artist streaming albums enabled by default with an opt-out', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).artistStreamingAlbumsEnabled).toBe(true);
    expect(normalizeSettings({}).artistStreamingAlbumsProvider).toBe('netease');
    expect(normalizeSettings({ artistStreamingAlbumsEnabled: true }).artistStreamingAlbumsEnabled).toBe(true);
    expect(normalizeSettings({ artistStreamingAlbumsEnabled: false }).artistStreamingAlbumsEnabled).toBe(false);
    expect(normalizeSettings({ artistStreamingAlbumsProvider: 'qqmusic' }).artistStreamingAlbumsProvider).toBe('qqmusic');
    expect(normalizeSettings({ artistStreamingAlbumsProvider: 'spotify' as never }).artistStreamingAlbumsProvider).toBe('netease');
    expect(normalizeSettings({ artistStreamingAlbumsEnabled: 'yes' as never }).artistStreamingAlbumsEnabled).toBe(true);
  });

  it('keeps streaming download actions behind the downloads unlock', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ streamingDownloadActionsEnabled: true }).streamingDownloadActionsEnabled).toBe(false);
    expect(
      normalizeSettings({
        downloadsFeatureUnlocked: true,
        streamingDownloadActionsEnabled: true,
      }).streamingDownloadActionsEnabled,
    ).toBe(true);
  });

  it('normalizes lyrics settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(
      normalizeSettings({
        lyricsNetworkEnabled: false,
        lyricsEnabledProviders: ['local', 'qqmusic', 'bad-provider'] as never,
        lyricsProviderOrder: ['qqmusic', 'lrclib', 'bad-provider'] as never,
        lyricsProviderTimeoutMs: 50,
        lyricsTotalMatchTimeoutMs: 99999,
        lyricsCoverAutoAcceptScore: 2,
        lyricsDeepSearchEnabled: false,
        lyricsAutoSearch: false,
        lyricsAutoAcceptScore: 2,
        lyricsBackfillAutoAcceptScore: 2,
        lyricsAutoSaveSidecarEnabled: true,
        lyricsDefaultOffsetMs: -24000,
        lyricsGlobalSyncOffsetMs: 24000,
        lyricsTimelineCorrectionEnabled: false,
        lyricsOffsetControlsEnabled: true,
        lyricsSmartAlignmentEnabled: 'yes' as never,
        lyricsEnabled: false,
        lyricsHeaderHidden: true,
        lyricsMvAutoShowTrackInfoDisabled: false,
        lyricsEmptyStateHidden: false,
        lyricsPlayerBarDrawerEnabled: true,
        lyricsPlayerBarDrawerAutoHideEnabled: 'yes' as never,
        lyricsPlayerBarDrawerOpacityPercent: 500,
        lyricsPlayerBarDrawerColorMode: 'neon' as never,
        lyricsPlayerBarDrawerColor: 'red',
        lyricsRomanizationEnabled: false,
        lyricsUtatenKanaEnabled: 'yes' as never,
        lyricsTranslationEnabled: false,
        lyricsWordHighlightEnabled: false,
        lyricsWordHighlightClarityPercent: 999,
        lyricsFontSizePx: 999,
        lyricsTextDirection: 'sideways' as never,
        lyricsLineSpacingPercent: 999,
        lyricsLineMaxChars: 999,
        lyricsContextOpacityPercent: 1000,
        lyricsColor: 'red',
        lyricsSmartReadableColorsEnabled: 'yes' as never,
        lyricsHighResolutionNetworkCoverEnabled: 'yes' as never,
        lyricsBackgroundMode: 'album' as never,
        lyricsCustomWallpaperPath: 'D:\\Outside\\wallpaper.png',
        lyricsCoverOpacityPercent: -10,
        lyricsCoverBlurPx: 999,
        lyricsCoverBrightnessPercent: 12,
        lyricsBackgroundScalePercent: 999,
        desktopLyricsColorMode: 'neon' as never,
        desktopLyricsTextDirection: 'sideways' as never,
        desktopLyricsRomanizationEnabled: false,
        desktopLyricsTranslationEnabled: false,
      }),
    ).toMatchObject({
      lyricsNetworkEnabled: false,
      lyricsPreferredProvider: 'lrclib',
      lyricsEnabledProviders: ['local', 'qqmusic'],
      lyricsProviderOrder: ['qqmusic', 'lrclib', 'local', 'netease', 'kugou', 'kuwo'],
      lyricsProviderTimeoutMs: 1000,
      lyricsTotalMatchTimeoutMs: 15000,
      lyricsCoverAutoAcceptScore: 1,
      lyricsDeepSearchEnabled: false,
      lyricsAutoSearch: false,
      lyricsAutoAcceptScore: 1,
      lyricsBackfillAutoAcceptScore: 0.95,
      lyricsAutoSaveSidecarEnabled: true,
      lyricsDefaultOffsetMs: -10000,
      lyricsGlobalSyncOffsetMs: 1000,
      lyricsTimelineCorrectionEnabled: false,
      lyricsOffsetControlsEnabled: true,
      lyricsSmartAlignmentEnabled: true,
      lyricsEnabled: false,
      lyricsHeaderHidden: true,
      lyricsMvAutoShowTrackInfoDisabled: false,
      lyricsEmptyStateHidden: false,
      lyricsPlayerBarDrawerEnabled: true,
      lyricsPlayerBarDrawerAutoHideEnabled: false,
      lyricsPlayerBarDrawerOpacityPercent: 100,
      lyricsPlayerBarDrawerColorMode: 'default',
      lyricsPlayerBarDrawerColor: '#232120',
      lyricsRomanizationEnabled: false,
      lyricsUtatenKanaEnabled: false,
      lyricsTranslationEnabled: false,
      lyricsWordHighlightEnabled: false,
      lyricsWordHighlightClarityPercent: 100,
      lyricsFontSizePx: 56,
      lyricsTextDirection: 'horizontal',
      lyricsLineSpacingPercent: 150,
      lyricsLineMaxChars: 80,
      lyricsContextOpacityPercent: 100,
      lyricsColor: '#314054',
      lyricsSmartReadableColorsEnabled: false,
      lyricsHighResolutionNetworkCoverEnabled: false,
      lyricsBackgroundMode: 'theme',
      lyricsCustomWallpaperPath: null,
      lyricsCoverOpacityPercent: 0,
      lyricsCoverBlurPx: 60,
      lyricsCoverBrightnessPercent: 40,
      lyricsBackgroundScalePercent: 180,
      desktopLyricsColorMode: 'theme',
      desktopLyricsTextDirection: 'horizontal',
      desktopLyricsRomanizationEnabled: false,
      desktopLyricsTranslationEnabled: false,
    });


    expect(
      normalizeSettings({
        lyricsFontSizePx: 12,
        lyricsTextDirection: 'vertical',
        lyricsWordHighlightClarityPercent: 20,
        lyricsLineSpacingPercent: 20,
        lyricsLineMaxChars: -1,
        lyricsAutoAcceptScore: 0.1,
        lyricsBackfillAutoAcceptScore: 0.1,
        lyricsContextOpacityPercent: 64.4,
        lyricsPlayerBarDrawerAutoHideEnabled: true,
        lyricsPlayerBarDrawerOpacityPercent: 12,
        lyricsPlayerBarDrawerColorMode: 'cover',
        lyricsPlayerBarDrawerColor: '#ff8a80',
        lyricsColor: '#ff3366',
        lyricsSmartReadableColorsEnabled: true,
        lyricsSmartAlignmentEnabled: true,
        lyricsHighResolutionNetworkCoverEnabled: true,
        lyricsBackgroundMode: 'cover',
        lyricsCoverOpacityPercent: 64.4,
        lyricsCoverBlurPx: 12.5,
        lyricsCoverBrightnessPercent: 118.6,
        lyricsBackgroundScalePercent: 55,
        desktopLyricsColorMode: 'custom',
        desktopLyricsColor: '#ff8a80',
        desktopLyricsTextDirection: 'vertical',
      }),
    ).toMatchObject({
      lyricsFontSizePx: 22,
      lyricsWordHighlightClarityPercent: 40,
      lyricsLineSpacingPercent: 60,
      lyricsTextDirection: 'vertical',
      lyricsLineMaxChars: 0,
      lyricsAutoAcceptScore: 0.3,
      lyricsBackfillAutoAcceptScore: 0.3,
      lyricsContextOpacityPercent: 64,
      lyricsPlayerBarDrawerAutoHideEnabled: true,
      lyricsPlayerBarDrawerOpacityPercent: 20,
      lyricsPlayerBarDrawerColorMode: 'cover',
      lyricsPlayerBarDrawerColor: '#FF8A80',
      lyricsColor: '#FF3366',
      lyricsSmartReadableColorsEnabled: true,
      lyricsSmartAlignmentEnabled: true,
      lyricsHighResolutionNetworkCoverEnabled: true,
      lyricsBackgroundMode: 'cover',
      lyricsCoverOpacityPercent: 64,
      lyricsCoverBlurPx: 13,
      lyricsCoverBrightnessPercent: 119,
      lyricsBackgroundScalePercent: 70,
      desktopLyricsColorMode: 'custom',
      desktopLyricsColor: '#FF8A80',
      desktopLyricsTextDirection: 'vertical',
      lyricsRomanizationEnabled: true,
      lyricsTranslationEnabled: true,
      lyricsWordHighlightEnabled: true,
      desktopLyricsRomanizationEnabled: true,
      desktopLyricsTranslationEnabled: true,
    });

    expect(normalizeSettings({ lyricsBackgroundMode: 'coverColor' })).toMatchObject({
      lyricsBackgroundMode: 'coverColor',
    });
  });

  it('keeps legacy custom desktop lyrics colors in custom mode', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({ desktopLyricsColor: '#ffd166' })).toMatchObject({
      desktopLyricsColorMode: 'custom',
      desktopLyricsColor: '#FFD166',
    });
  });

  it('adds new lyrics providers when saved settings still use the old default source list', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const settings = normalizeSettings({
      lyricsEnabledProviders: ['local', 'lrclib', 'netease', 'qqmusic'],
      lyricsProviderOrder: ['local', 'lrclib', 'netease', 'qqmusic'],
    });

    expect(settings.lyricsEnabledProviders).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
    expect(settings.lyricsProviderOrder).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
  });

  it('does not re-enable new lyrics providers for a manually reduced source list', async () => {
    const { normalizeSettings } = await import('./appSettings');

    const settings = normalizeSettings({
      lyricsEnabledProviders: ['local', 'lrclib'],
      lyricsProviderOrder: ['local', 'lrclib'],
    });

    expect(settings.lyricsEnabledProviders).toEqual(['local', 'lrclib']);
    expect(settings.lyricsProviderOrder).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
  });

  it('keeps AMLL TTML lyrics available as an explicit opt-in provider', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).lyricsEnabledProviders).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
    expect(normalizeSettings({}).lyricsProviderOrder).toEqual(['local', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);

    const settings = normalizeSettings({
      lyricsEnabledProviders: ['local', 'amll-ttml'],
      lyricsProviderOrder: ['local', 'amll-ttml', 'lrclib'],
    });

    expect(settings.lyricsEnabledProviders).toEqual(['local', 'amll-ttml']);
    expect(settings.lyricsProviderOrder).toEqual(['local', 'amll-ttml', 'lrclib', 'netease', 'qqmusic', 'kugou', 'kuwo']);
  });

  it('enables the bottom signal path control by default', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).signalPathControlEnabled).toBe(true);
    expect(normalizeSettings({ signalPathControlEnabled: true }).signalPathControlEnabled).toBe(true);
    expect(normalizeSettings({ signalPathControlEnabled: false }).signalPathControlEnabled).toBe(false);
    expect(normalizeSettings({ signalPathControlEnabled: 'true' as never }).signalPathControlEnabled).toBe(true);
  });

  it('normalizes channel balance settings for old and malformed settings files', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(normalizeSettings({}).channelBalance).toMatchObject({
      enabled: false,
      balance: 0,
      leftGainDb: 0,
      rightGainDb: 0,
      leftDelayMs: 0,
      rightDelayMs: 0,
      monoMode: 'off',
      constantPower: true,
    });

    expect(
      normalizeSettings({
        channelBalance: {
          enabled: true,
          balance: -5,
          leftGainDb: -99,
          rightGainDb: 99,
          leftDelayMs: -3,
          rightDelayMs: 99,
          monoMode: 'right',
          invertLeft: true,
          constantPower: false,
        },
      }).channelBalance,
    ).toMatchObject({
      enabled: true,
      balance: -1,
      leftGainDb: -12,
      rightGainDb: 6,
      leftDelayMs: 0,
      rightDelayMs: 10,
      monoMode: 'right',
      invertLeft: true,
      constantPower: false,
    });
  });

  it('normalizes MV network settings', async () => {
    const { normalizeSettings } = await import('./appSettings');

    expect(
      normalizeSettings({
        mvEnabledProviders: ['youtube', 'qqmusic', 'youtube'] as never,
        mvEnabled: false,
        mvProviderOrder: ['youtube'] as never,
        mvAutoSearch: false,
        mvAutoApplyThreshold: 0.82,
        mvPreferHighestViewCount: true,
        mvImmersiveBackground: false,
        mvImmersiveBackgroundAutoScale: false,
        mvImmersiveBackgroundScalePercent: 180,
        mvImmersiveBackgroundOffsetXPercent: 18,
        mvImmersiveBackgroundOffsetYPercent: 76,
        mvImmersiveBackgroundBlurPx: 12,
        mvImmersiveBackgroundBrightnessPercent: 118,
        mvImmersiveBackgroundOverlayOpacityPercent: 42,
        mvLyricsReadabilityEnhanced: true,
        mvHideLyrics: true,
        mvReplayAudioOnChange: false,
        mvMaxQuality: 'max',
        mvAllow60fps: false,
      }),
    ).toMatchObject({
      mvEnabledProviders: ['youtube'],
      mvEnabled: false,
      mvProviderOrder: ['youtube', 'bilibili'],
      mvAutoSearch: false,
      mvAutoApplyThreshold: 0.82,
      mvPreferHighestViewCount: true,
      mvImmersiveBackground: false,
      mvImmersiveBackgroundAutoScale: false,
      mvImmersiveBackgroundScalePercent: 180,
      mvImmersiveBackgroundOffsetXPercent: 18,
      mvImmersiveBackgroundOffsetYPercent: 76,
      mvImmersiveBackgroundBlurPx: 12,
      mvImmersiveBackgroundBrightnessPercent: 118,
      mvImmersiveBackgroundOverlayOpacityPercent: 42,
      mvLyricsReadabilityEnhanced: true,
      mvHideLyrics: true,
      mvReplayAudioOnChange: false,
      mvMaxQuality: 'max',
      mvAllow60fps: false,
    });

    expect(
      normalizeSettings({
        mvAutoApplyThreshold: 0.1,
        mvMaxQuality: '8k' as never,
        mvImmersiveBackgroundScalePercent: 999,
        mvImmersiveBackgroundAutoScale: 'yes' as never,
        mvImmersiveBackgroundOffsetXPercent: -10,
        mvImmersiveBackgroundOffsetYPercent: 140,
        mvImmersiveBackgroundBlurPx: 99,
        mvImmersiveBackgroundBrightnessPercent: 12,
        mvImmersiveBackgroundOverlayOpacityPercent: -10,
        mvLyricsReadabilityEnhanced: 'yes' as never,
        mvHideLyrics: 'yes' as never,
        mvPreferHighestViewCount: 'yes' as never,
      }),
    ).toMatchObject({
      mvAutoSearch: true,
      mvAutoApplyThreshold: 0.3,
      mvPreferHighestViewCount: false,
      mvImmersiveBackground: true,
      mvImmersiveBackgroundAutoScale: true,
      mvImmersiveBackgroundScalePercent: 220,
      mvImmersiveBackgroundOffsetXPercent: 0,
      mvImmersiveBackgroundOffsetYPercent: 100,
      mvImmersiveBackgroundBlurPx: 32,
      mvImmersiveBackgroundBrightnessPercent: 60,
      mvImmersiveBackgroundOverlayOpacityPercent: 0,
      mvLyricsReadabilityEnhanced: false,
      mvHideLyrics: false,
      mvReplayAudioOnChange: true,
      mvMaxQuality: 'max',
      mvAllow60fps: true,
    });

    expect(normalizeSettings({ mvAutoApplyThreshold: 2 })).toMatchObject({
      mvAutoApplyThreshold: 1,
    });
  });
});
