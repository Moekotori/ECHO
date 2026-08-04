import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { finalThemeUnlockVersion } from '../../shared/constants/featureUnlocks';
import type { PluginRuntimeStatus } from '../../shared/types/plugins';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const onMock = vi.fn();
const showOpenDialogMock = vi.fn();
const showSaveDialogMock = vi.fn();
const openExternalMock = vi.fn();
const setAppSettingsMock = vi.fn((patch: Record<string, unknown>): Record<string, unknown> => ({ coverCacheDir: patch.coverCacheDir ?? null, hideToTrayOnClose: false, ...patch }));
const getAppSettingsMock = vi.fn<() => Record<string, unknown>>(() => ({ coverCacheDir: null, hideToTrayOnClose: false }));
type MinimalPluginSummary = {
  id: string;
  enabled: boolean;
  disabledByHost: boolean;
  error: string | null;
  status: PluginRuntimeStatus;
};
const pluginListMock = vi.fn<() => { directory: string; plugins: MinimalPluginSummary[] }>(() => ({ directory: 'D:\\Echo\\plugins', plugins: [] }));
const activateEchoProPluginMock = vi.fn(async () => ({
  ok: true,
  mode: 'key',
  pluginId: 'echo.pro-unlock',
  enabled: true,
  licenseId: 'lic_test',
  activationId: 'act_test',
  qq: '12345',
  activatedAt: '2026-06-22T00:00:00.000Z',
  importedFileCount: 4,
  checksum: '0'.repeat(64),
}));
const getEchoProLicenseStatusMock = vi.fn(() => ({ valid: false, enabled: false, features: [] as string[] }));
const connectDonatorUnlockStatusMock = vi.fn(() => ({ unlocked: false }));
const downloadFeatureUnlockStatusMock = vi.fn(() => ({ unlocked: false }));
const requirePrivateFeatureMock = vi.fn(async () => undefined);
const saveEchoProSettingsCloudMock = vi.fn(async () => ({ available: true, saved: true }));
const pullEchoProSettingsCloudMock = vi.fn(async () => ({ available: true, settings: {}, librarySync: null }));
const applyEchoProSettingsCloudMock = vi.fn(async () => ({ available: true, applied: true }));
const lockedFeatureSettingsOptions = { finalThemeUnlocked: false, downloadsFeatureUnlocked: false };
const proxyTestSessionMock = { partition: 'network-proxy-test' };
const fromPartitionMock = vi.fn(() => proxyTestSessionMock);
const getLibraryServiceMock = vi.fn();
const ensureCoverCacheDirectoryMock = vi.fn();
const ensureTrayMock = vi.fn();
const destroyTrayMock = vi.fn();
const requestAppQuitMock = vi.fn();
const setLaunchAtLoginEnabledMock = vi.fn();
const fromWebContentsMock = vi.fn();
const appQuitMock = vi.fn();
const refreshGlobalShortcutRegistrationMock = vi.fn(() => null);
const refreshDataBackupSchedulerMock = vi.fn();
const subscribeDataBackupProgressMock = vi.fn(() => () => undefined);
const getDataBackupStatusMock = vi.fn(() => ({
  enabled: false,
  directory: null,
  intervalDays: 7,
  lastBackupAt: null,
  lastBackupPath: null,
  lastError: null,
  nextBackupAt: null,
  running: false,
  progress: null,
}));
const runDataBackupNowMock = vi.fn();
const importEchoUserDataBackupMock = vi.fn();
const validateGlobalShortcutMock = vi.fn(() => ({
  accelerator: 'Ctrl+Alt+Space',
  available: true,
  reason: 'available',
  valid: true,
}));
const applyNetworkProxySettingsMock = vi.fn();
const testNetworkProxyConnectionMock = vi.fn(() => ({
  ok: true,
  mode: 'off',
  message: '连接正常',
  resolvedProxy: 'DIRECT',
  status: 204,
  elapsedMs: 12,
}));
const appPathMock = vi.fn((name: string) =>
  name === 'downloads' ? tmpdir() : join(tmpdir(), 'echo-next-register-ipc-test-userdata'),
);
const nativeThemeMock = { themeSource: 'system' as 'system' | 'light' | 'dark' };

vi.mock('electron', () => ({
  default: {
    app: {
      getAppPath: () => 'D:\\ECHONext\\ECHO-Next',
      getPath: appPathMock,
      isPackaged: false,
    },
  },
  app: {
    getVersion: () => '0.0.0-test',
    getPath: appPathMock,
    quit: appQuitMock,
  },
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
  ipcMain: {
    handle: handleMock,
    on: onMock,
  },
  nativeTheme: nativeThemeMock,
  session: {
    fromPartition: fromPartitionMock,
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

vi.mock('../app/appSettings', () => ({
  defaultSettings: {
    albumMergeStrategy: 'standard',
    artistWallAlbumArtwork: false,
    coverCacheDir: null,
    hideToTrayOnClose: false,
    appCustomWallpaperPath: null,
    appWallpaperScalePercent: 100,
    appWallpaperBlurPx: 0,
    appWallpaperBrightnessPercent: 100,
    appWallpaperUiOpacityPercent: 100,
    appWallpaperUnifiedOpacityEnabled: false,
    networkMetadataEnabled: false,
    networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
    channelBalance: {
      enabled: false,
      balance: 0,
      leftGainDb: 0,
      rightGainDb: 0,
      swapLeftRight: false,
      monoMode: 'off',
      invertLeft: false,
      invertRight: false,
      constantPower: true,
    },
    playerVolume: 1,
    playbackSpeed: 1,
    playbackSpeedMode: 'nightcore',
    scanPerformanceMode: 'balanced',
    duplicateTracksEnabled: false,
    duplicateTracksMode: 'strict',
    duplicateTracksAutoRebuildAfterScan: false,
    discordRichPresenceEnabled: false,
    lastFmEnabled: false,
    lastFmUsername: null,
    lastFmSessionKey: null,
    lastFmScrobbleEnabled: true,
    lastFmNowPlayingEnabled: true,
    lastFmMinScrobbleSeconds: 30,
    lastFmAuthToken: null,
    smtcEnabled: true,
  },
  getAppSettings: getAppSettingsMock,
  getAppWallpaperDirectory: vi.fn(() => 'D:\\Echo\\app-wallpapers'),
  getLyricsWallpaperDirectory: vi.fn(() => 'D:\\Echo\\lyrics-wallpapers'),
  normalizeSettings: vi.fn((value) => ({ coverCacheDir: null, hideToTrayOnClose: false, ...(value as Record<string, unknown>) })),
  setAppSettings: setAppSettingsMock,
  setFinalThemeUnlockAvailable: vi.fn(),
}));

vi.mock('../app/tray', () => ({
  destroyTray: destroyTrayMock,
  ensureTray: ensureTrayMock,
  requestAppQuit: requestAppQuitMock,
}));

vi.mock('../app/launchAtLogin', () => ({
  setLaunchAtLoginEnabled: setLaunchAtLoginEnabledMock,
}));

vi.mock('../app/autoUpdater', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  getUpdateStatus: vi.fn(() => ({
    state: 'idle',
    currentVersion: 'v0.0.0-test',
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    error: null,
    checkedAt: null,
  })),
  reconfigureAutoUpdateFeed: vi.fn(),
  setAutoUpdateEnabled: vi.fn(),
}));

vi.mock('../app/backgroundPlaybackShortcuts', () => ({
  refreshBackgroundSpaceRegistration: refreshGlobalShortcutRegistrationMock,
  validateGlobalShortcut: validateGlobalShortcutMock,
}));

vi.mock('../app/dataBackup', () => ({
  getDataBackupStatus: getDataBackupStatusMock,
  importEchoUserDataBackup: importEchoUserDataBackupMock,
  refreshDataBackupScheduler: refreshDataBackupSchedulerMock,
  runDataBackupNow: runDataBackupNowMock,
  subscribeDataBackupProgress: subscribeDataBackupProgressMock,
}));

vi.mock('../network/proxySettings', () => ({
  applyNetworkProxySettings: applyNetworkProxySettingsMock,
  testNetworkProxyConnection: testNetworkProxyConnectionMock,
}));

vi.mock('../library/CoverCacheManager', () => ({
  ensureCoverCacheDirectory: ensureCoverCacheDirectoryMock,
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: getLibraryServiceMock,
}));

vi.mock('./libraryIpc', () => ({
  registerLibraryIpc: vi.fn(),
}));

vi.mock('./lyricsIpc', () => ({
  registerLyricsIpc: vi.fn(),
}));

vi.mock('./mvIpc', () => ({
  registerMvIpc: vi.fn(),
}));

vi.mock('./hqPlayerIpc', () => ({
  registerHqPlayerIpc: vi.fn(),
}));

vi.mock('./playbackIpc', () => ({
  registerPlaybackIpc: vi.fn(),
}));

vi.mock('./audioIpc', () => ({
  registerAudioIpc: vi.fn(),
}));

vi.mock('./accountIpc', () => ({
  registerAccountIpc: vi.fn(),
}));

vi.mock('./diagnosticsIpc', () => ({
  registerDiagnosticsIpc: vi.fn(),
}));

vi.mock('./connectIpc', () => ({
  registerConnectIpc: vi.fn(),
}));

vi.mock('./discordPresenceIpc', () => ({
  registerDiscordPresenceIpc: vi.fn(),
}));

vi.mock('./downloadsIpc', () => ({
  registerDownloadsIpc: vi.fn(),
}));

vi.mock('./pluginIpc', () => ({
  registerPluginIpc: vi.fn(),
}));

vi.mock('../plugins/PluginService', () => ({
  getPluginService: () => ({
    list: pluginListMock,
    activateEchoProPlugin: activateEchoProPluginMock,
    getEchoProLicenseStatus: getEchoProLicenseStatusMock,
  }),
}));

vi.mock('../plugins/ConnectDonatorUnlockService', () => ({
  getConnectDonatorUnlockService: () => ({
    getStatus: connectDonatorUnlockStatusMock,
  }),
}));

vi.mock('../plugins/DownloadFeatureUnlockService', () => ({
  getDownloadFeatureUnlockService: () => ({
    getStatus: downloadFeatureUnlockStatusMock,
  }),
}));

vi.mock('../plugins/privateEntitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plugins/privateEntitlements')>();
  return {
    ...actual,
    applyEchoProSettingsCloud: applyEchoProSettingsCloudMock,
    pullEchoProSettingsCloud: pullEchoProSettingsCloudMock,
    requirePrivateFeature: requirePrivateFeatureMock,
    saveEchoProSettingsCloud: saveEchoProSettingsCloudMock,
  };
});

vi.mock('./lastFmIpc', () => ({
  registerLastFmIpc: vi.fn(),
}));

vi.mock('./stageBridgeIpc', () => ({
  registerStageBridgeIpc: vi.fn(),
}));

vi.mock('./remoteSourcesIpc', () => ({
  registerRemoteSourcesIpc: vi.fn(),
}));

vi.mock('./streamingIpc', () => ({
  registerStreamingIpc: vi.fn(),
}));

vi.mock('../integrations/discord/getDiscordPresenceService', () => ({
  setDiscordPresenceEnabled: vi.fn(),
}));

vi.mock('../integrations/lastfm/getLastFmService', () => ({
  getLastFmService: () => ({
    disconnect: vi.fn(),
  }),
}));

vi.mock('../integrations/stage/getStageBridgeService', () => ({
  syncStageBridgeIntegrationFromSettings: vi.fn(),
}));

const resetHandlers = (): void => {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
};

describe('app IPC cover cache directory', () => {
  beforeEach(async () => {
    resetHandlers();
    handleMock.mockClear();
    onMock.mockClear();
    showOpenDialogMock.mockReset();
    showSaveDialogMock.mockReset();
    openExternalMock.mockReset();
    setAppSettingsMock.mockClear();
    getAppSettingsMock.mockClear();
    pluginListMock.mockReset();
    pluginListMock.mockReturnValue({ directory: 'D:\\Echo\\plugins', plugins: [] });
    activateEchoProPluginMock.mockClear();
    getEchoProLicenseStatusMock.mockReset();
    getEchoProLicenseStatusMock.mockReturnValue({ valid: false, enabled: false, features: [] });
    connectDonatorUnlockStatusMock.mockReset();
    connectDonatorUnlockStatusMock.mockReturnValue({ unlocked: false });
    downloadFeatureUnlockStatusMock.mockReset();
    downloadFeatureUnlockStatusMock.mockReturnValue({ unlocked: false });
    requirePrivateFeatureMock.mockReset();
    requirePrivateFeatureMock.mockResolvedValue(undefined);
    saveEchoProSettingsCloudMock.mockClear();
    pullEchoProSettingsCloudMock.mockClear();
    applyEchoProSettingsCloudMock.mockClear();
    getLibraryServiceMock.mockReset();
    ensureCoverCacheDirectoryMock.mockReset();
    ensureTrayMock.mockClear();
    destroyTrayMock.mockClear();
    requestAppQuitMock.mockClear();
    setLaunchAtLoginEnabledMock.mockClear();
    appQuitMock.mockClear();
    fromWebContentsMock.mockReset();
    fromPartitionMock.mockClear();
    refreshGlobalShortcutRegistrationMock.mockClear();
    refreshDataBackupSchedulerMock.mockClear();
    subscribeDataBackupProgressMock.mockClear();
    getDataBackupStatusMock.mockClear();
    runDataBackupNowMock.mockReset();
    importEchoUserDataBackupMock.mockReset();
    validateGlobalShortcutMock.mockClear();
    applyNetworkProxySettingsMock.mockClear();
    testNetworkProxyConnectionMock.mockClear();
    appPathMock.mockClear();
    nativeThemeMock.themeSource = 'system';
    const module = await import('./registerIpc');
    module.registerIpc();
  });

  it('rejects changing the cache directory while a scan is running', async () => {
    getLibraryServiceMock.mockReturnValue({
      hasRunningJobs: () => true,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
    });

    await expect(
      handlers[IpcChannels.AppSetCoverCacheDirectory]!(null, { directory: 'D:\\NewCache', migrate: true }),
    ).rejects.toThrow('Cannot change cover cache directory while a library scan is running.');
    expect(setAppSettingsMock).not.toHaveBeenCalled();
  });

  it('can restore the default cache directory without migration', async () => {
    const service = {
      hasRunningJobs: () => false,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
      setCoverCacheDir: vi.fn(),
      syncLiveLibraryWatcherFromSettings: vi.fn(),
    };
    getLibraryServiceMock.mockReturnValue(service);

    const result = await handlers[IpcChannels.AppSetCoverCacheDirectory]!(null, { directory: null, migrate: false });

    expect(result).toBeNull();
    expect(ensureCoverCacheDirectoryMock).toHaveBeenCalledWith('D:\\Echo\\cover-cache');
    expect(setAppSettingsMock).toHaveBeenCalledWith({ coverCacheDir: null });
    expect(service.setCoverCacheDir).toHaveBeenCalledWith('D:\\Echo\\cover-cache');
  });

  it('lists app cache inventory without marking durable data movable', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-cache-inventory-'));
    const coverCache = join(tempRoot, 'covers');
    const artistImages = join(tempRoot, 'artist-images');
    const smtcCovers = join(appPathMock('userData'), 'smtc-covers');
    const databasePath = join(tempRoot, 'echo-library.sqlite');
    mkdirSync(coverCache, { recursive: true });
    mkdirSync(artistImages, { recursive: true });
    mkdirSync(smtcCovers, { recursive: true });
    writeFileSync(join(coverCache, 'cover.webp'), Buffer.alloc(10));
    writeFileSync(join(artistImages, 'artist.webp'), Buffer.alloc(20));
    writeFileSync(join(smtcCovers, 'smtc.webp'), Buffer.alloc(30));
    writeFileSync(databasePath, Buffer.alloc(40));

    getLibraryServiceMock.mockReturnValue({
      getCoverCacheDir: () => coverCache,
      getDiagnostics: () => ({ databasePath }),
    });

    try {
      const inventory = (await handlers[IpcChannels.AppGetCacheInventory]!()) as {
        items: Array<{ kind: string; path: string; sizeBytes: number; movable: boolean; reason: string }>;
        totalSizeBytes: number;
      };

      expect(inventory.items.map((item) => item.kind)).toEqual(['cover', 'artist-image', 'smtc-cover', 'download', 'lyrics-mv']);
      expect(inventory.items.find((item) => item.kind === 'cover')).toMatchObject({
        path: coverCache,
        sizeBytes: 10,
        movable: true,
      });
      expect(inventory.items.find((item) => item.kind === 'lyrics-mv')).toMatchObject({
        path: databasePath,
        sizeBytes: 40,
        movable: false,
      });
      expect(inventory.items.filter((item) => item.kind !== 'cover').every((item) => item.movable === false)).toBe(true);
      expect(inventory.totalSizeBytes).toBeGreaterThanOrEqual(100);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(appPathMock('userData'), { recursive: true, force: true });
    }
  });

  it('resets app settings and restores the default cover cache directory', async () => {
    const service = {
      hasRunningJobs: () => false,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
      setCoverCacheDir: vi.fn(),
      syncLiveLibraryWatcherFromSettings: vi.fn(),
    };
    getLibraryServiceMock.mockReturnValue(service);

    const result = (await handlers[IpcChannels.AppResetSettings]!()) as { coverCacheDir: string | null };

    expect(result.coverCacheDir).toBeNull();
    expect(ensureCoverCacheDirectoryMock).toHaveBeenCalledWith('D:\\Echo\\cover-cache');
    expect(setAppSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ coverCacheDir: null, hideToTrayOnClose: false }));
    expect(setLaunchAtLoginEnabledMock).toHaveBeenCalledWith(false);
    expect(service.setCoverCacheDir).toHaveBeenCalledWith('D:\\Echo\\cover-cache');
    expect(ensureTrayMock).toHaveBeenCalledTimes(1);
    expect(destroyTrayMock).not.toHaveBeenCalled();
  });

  it('syncs the login item when launch-at-login changes', async () => {
    setAppSettingsMock.mockReturnValue({ coverCacheDir: null, hideToTrayOnClose: false, launchAtLoginEnabled: true });

    await handlers[IpcChannels.AppSetSettings]!(null, { launchAtLoginEnabled: true });

    expect(setLaunchAtLoginEnabledMock).toHaveBeenCalledWith(true);
    expect(setAppSettingsMock).toHaveBeenCalledWith({ launchAtLoginEnabled: true }, lockedFeatureSettingsOptions);
  });

  it('keeps the tray icon resident when close-to-tray is disabled', async () => {
    setAppSettingsMock.mockReturnValue({ coverCacheDir: null, hideToTrayOnClose: false });

    await handlers[IpcChannels.AppSetSettings]!(null, { hideToTrayOnClose: false });

    expect(setAppSettingsMock).toHaveBeenCalledWith({ hideToTrayOnClose: false }, lockedFeatureSettingsOptions);
    expect(ensureTrayMock).toHaveBeenCalledTimes(1);
    expect(destroyTrayMock).not.toHaveBeenCalled();
  });

  it('syncs Electron native theme source when the app theme follows the system', async () => {
    setAppSettingsMock.mockReturnValue({ coverCacheDir: null, hideToTrayOnClose: false, appearanceTheme: 'system' });

    await handlers[IpcChannels.AppSetSettings]!(null, { appearanceTheme: 'system' });

    expect(setAppSettingsMock).toHaveBeenCalledWith({ appearanceTheme: 'system' }, lockedFeatureSettingsOptions);
    expect(nativeThemeMock.themeSource).toBe('system');
  });

  it('keeps Pro theme settings locked when the donator machine license is missing', async () => {
    await handlers[IpcChannels.AppSetSettings]!(null, {
      appearanceThemePreset: 'nyanCat',
      finalThemeUnlockVersion,
    });

    expect(setAppSettingsMock).toHaveBeenCalledWith(
      {
        appearanceThemePreset: 'nyanCat',
        finalThemeUnlockVersion,
      },
      lockedFeatureSettingsOptions,
    );
  });

  it('allows Pro theme settings only when the donator machine license is valid', async () => {
    connectDonatorUnlockStatusMock.mockReturnValue({ unlocked: true });

    await handlers[IpcChannels.AppSetSettings]!(null, {
      appearanceThemePreset: 'FINAL',
      finalThemeUnlockVersion,
    });

    expect(setAppSettingsMock).toHaveBeenCalledWith(
      {
        appearanceThemePreset: 'FINAL',
        finalThemeUnlockVersion,
      },
      { finalThemeUnlocked: true, downloadsFeatureUnlocked: false },
    );
  });

  it('allows Pro theme settings when the ECHO Pro unlock plugin license is valid without connect', async () => {
    getEchoProLicenseStatusMock.mockReturnValue({ valid: true, enabled: true, features: ['echo-pro'] });

    await handlers[IpcChannels.AppSetSettings]!(null, {
      appearanceThemePreset: 'FINAL',
      finalThemeUnlockVersion: null,
    });

    expect(setAppSettingsMock).toHaveBeenCalledWith(
      {
        appearanceThemePreset: 'FINAL',
        finalThemeUnlockVersion: null,
      },
      { finalThemeUnlocked: true, downloadsFeatureUnlocked: false },
    );
  });

  it('derives downloads unlock settings from the downloads unlock plugin', async () => {
    downloadFeatureUnlockStatusMock.mockReturnValue({ unlocked: true });

    await handlers[IpcChannels.AppGetSettings]!();

    expect(getAppSettingsMock).toHaveBeenLastCalledWith({ finalThemeUnlocked: false, downloadsFeatureUnlocked: true });
  });

  it('reads signal path control settings without ECHO Pro verification', async () => {
    getAppSettingsMock.mockImplementation(() => ({
      coverCacheDir: null,
      hideToTrayOnClose: false,
      signalPathControlEnabled: true,
    }));

    expect(handlers[IpcChannels.AppGetSettings]!()).toMatchObject({ signalPathControlEnabled: true });

    expect(requirePrivateFeatureMock).not.toHaveBeenCalled();
    expect(getAppSettingsMock).toHaveBeenLastCalledWith(lockedFeatureSettingsOptions);
  });

  it('saves the signal path control setting without ECHO Pro', async () => {
    await handlers[IpcChannels.AppSetSettings]!(null, { signalPathControlEnabled: true });

    expect(requirePrivateFeatureMock).not.toHaveBeenCalled();
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      { signalPathControlEnabled: true },
      lockedFeatureSettingsOptions,
    );
  });

  it('allows disabling the signal path control setting without ECHO Pro', async () => {
    await handlers[IpcChannels.AppSetSettings]!(null, { signalPathControlEnabled: false });

    expect(requirePrivateFeatureMock).not.toHaveBeenCalled();
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      { signalPathControlEnabled: false },
      lockedFeatureSettingsOptions,
    );
  });

  it('saves disabled signal path values carried by broader settings patches', async () => {
    await handlers[IpcChannels.AppSetSettings]!(null, {
      signalPathControlEnabled: false,
      rememberedWindowSize: { width: 1280, height: 820 },
    });

    expect(requirePrivateFeatureMock).not.toHaveBeenCalled();
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      {
        signalPathControlEnabled: false,
        rememberedWindowSize: { width: 1280, height: 820 },
      },
      lockedFeatureSettingsOptions,
    );
  });

  it('requires ECHO Pro before saving cloud settings', async () => {
    await expect(handlers[IpcChannels.AppEchoProSettingsCloudSave]!()).resolves.toMatchObject({ saved: true });

    expect(requirePrivateFeatureMock).toHaveBeenCalledWith('echo-pro');
    expect(saveEchoProSettingsCloudMock).toHaveBeenCalledTimes(1);
  });

  it('blocks cloud settings sync before reaching the provider when ECHO Pro is missing', async () => {
    requirePrivateFeatureMock.mockRejectedValue(new Error('echo_pro_required'));

    await expect(handlers[IpcChannels.AppEchoProSettingsCloudPull]!()).rejects.toThrow('echo_authorization_required');

    expect(pullEchoProSettingsCloudMock).not.toHaveBeenCalled();
  });

  it('requires ECHO Pro before applying cloud settings', async () => {
    await expect(handlers[IpcChannels.AppEchoProSettingsCloudApply]!()).resolves.toMatchObject({ applied: true });

    expect(requirePrivateFeatureMock).toHaveBeenCalledWith('echo-pro');
    expect(applyEchoProSettingsCloudMock).toHaveBeenCalledTimes(1);
  });

  it('uses an image-only picker for lyrics wallpaper selection', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handlers[IpcChannels.AppChooseLyricsWallpaper]!();

    expect(result).toBeNull();
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        properties: ['openFile'],
      }),
    );
  });

  it('uses an image and video picker for app wallpaper selection', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await handlers[IpcChannels.AppChooseAppWallpaper]!();

    expect(result).toBeNull();
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          { name: 'Background files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'm4v', 'webm'] },
          { name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
          { name: 'Video files', extensions: ['mp4', 'm4v', 'webm'] },
        ],
        properties: ['openFile'],
      }),
    );
  });

  it('copies browser-playable video files for app wallpaper selection', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-app-video-wallpaper-'));
    const videoPath = join(tempRoot, 'motion.webm');
    writeFileSync(videoPath, 'video');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [videoPath] });

    try {
      const result = await handlers[IpcChannels.AppChooseAppWallpaper]!();

      expect(typeof result).toBe('string');
      expect(String(result)).toMatch(/\.webm$/u);
      expect(existsSync(String(result))).toBe(true);
      expect(readFileSync(String(result), 'utf8')).toBe('video');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      if (typeof appPathMock('userData') === 'string') {
        rmSync(appPathMock('userData'), { recursive: true, force: true });
      }
    }
  });

  it('opens external http links through the system browser only', async () => {
    await handlers[IpcChannels.AppOpenExternalUrl]!(null, 'https://discord.gg/g7v4WMRq3K');

    expect(openExternalMock).toHaveBeenCalledWith('https://discord.gg/g7v4WMRq3K');
    await expect(handlers[IpcChannels.AppOpenExternalUrl]!(null, 'file:///C:/Windows/System32/calc.exe')).rejects.toThrow(
      'external URL must use http or https',
    );
  });

  it('activates the ECHO Pro plugin through the plugin service without requiring Pro first', async () => {
    const request = { mode: 'key', qq: '12345', key: 'ECHO-AAAAA-BBBBB-CCCCC-DDDDD' };

    await expect(handlers[IpcChannels.AppEchoProPluginActivate]!(null, request)).resolves.toMatchObject({
      ok: true,
      pluginId: 'echo.pro-unlock',
      enabled: true,
    });

    expect(activateEchoProPluginMock).toHaveBeenCalledWith(request);
    expect(requirePrivateFeatureMock).not.toHaveBeenCalled();
  });

  it('exits fullscreen when toggling maximize from F11 fullscreen mode', () => {
    const window = {
      isFullScreen: vi.fn(() => true),
      setFullScreen: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    };
    fromWebContentsMock.mockReturnValue(window);

    handlers[IpcChannels.AppWindowToggleMaximize]!({ sender: {} });

    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.isMaximized).not.toHaveBeenCalled();
    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.unmaximize).not.toHaveBeenCalled();
  });

  it('reports the current maximized state for custom window controls', () => {
    const window = {
      isFullScreen: vi.fn(() => false),
      isMaximized: vi.fn(() => true),
    };
    fromWebContentsMock.mockReturnValue(window);

    const result = handlers[IpcChannels.AppWindowIsMaximized]!({ sender: {} });

    expect(result).toBe(true);
    expect(window.isMaximized).toHaveBeenCalledTimes(1);
  });

  it('toggles fullscreen through the custom fullscreen control', () => {
    const window = {
      isFullScreen: vi.fn(() => false),
      setFullScreen: vi.fn(),
    };
    fromWebContentsMock.mockReturnValue(window);

    handlers[IpcChannels.AppWindowToggleFullscreen]!({ sender: {} });

    expect(window.setFullScreen).toHaveBeenCalledWith(true);
  });

  it('toggles fullscreen through the fullscreen shortcut trigger', () => {
    const window = {
      isFullScreen: vi.fn(() => false),
      setFullScreen: vi.fn(),
    };
    fromWebContentsMock.mockReturnValue(window);

    handlers[IpcChannels.AppWindowTriggerFullscreenShortcut]!({ sender: {} });

    expect(window.setFullScreen).toHaveBeenCalledWith(true);
  });

  it('reports the current fullscreen state for custom window controls', () => {
    const window = {
      isFullScreen: vi.fn(() => true),
    };
    fromWebContentsMock.mockReturnValue(window);

    const result = handlers[IpcChannels.AppWindowIsFullscreen]!({ sender: {} });

    expect(result).toBe(true);
    expect(window.isFullScreen).toHaveBeenCalledTimes(1);
  });

  it('requests a real app quit through IPC', () => {
    handlers[IpcChannels.AppQuit]!();

    expect(requestAppQuitMock).toHaveBeenCalledTimes(1);
    expect(appQuitMock).toHaveBeenCalledTimes(1);
  });

  it('exports app settings to a selected JSON backup', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-settings-export-'));
    const exportPath = join(tempRoot, 'settings.json');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: exportPath });
    getAppSettingsMock.mockReturnValue({ locale: 'ja-JP', coverCacheDir: null, hideToTrayOnClose: false });

    const result = await handlers[IpcChannels.AppExportSettings]!();

    expect(result).toBe(exportPath);
    const payload = JSON.parse(readFileSync(exportPath, 'utf8')) as { format: string; settings: { locale: string } };
    expect(payload.format).toBe('echo-next-settings-backup');
    expect(payload.settings.locale).toBe('ja-JP');
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('backs up current settings before importing a selected JSON backup', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-settings-import-'));
    const importPath = join(tempRoot, 'incoming.json');
    writeFileSync(importPath, JSON.stringify({ format: 'echo-next-settings-backup', version: 1, settings: { locale: 'en-US', coverCacheDir: null } }), 'utf8');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [importPath] });
    getAppSettingsMock.mockReturnValue({ locale: 'zh-CN', coverCacheDir: null, hideToTrayOnClose: false });
    const service = {
      hasRunningJobs: () => false,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
      setCoverCacheDir: vi.fn(),
      syncLiveLibraryWatcherFromSettings: vi.fn(),
    };
    getLibraryServiceMock.mockReturnValue(service);
    setAppSettingsMock.mockImplementation((patch) => ({ coverCacheDir: null, hideToTrayOnClose: false, ...(patch as Record<string, unknown>) }));

    const result = (await handlers[IpcChannels.AppImportSettings]!()) as { backupPath: string; settings: { locale: string } };

    expect(result.settings.locale).toBe('en-US');
    expect(existsSync(result.backupPath)).toBe(true);
    expect(setAppSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en-US' }), lockedFeatureSettingsOptions);
    expect(service.setCoverCacheDir).toHaveBeenCalledWith('D:\\Echo\\cover-cache');
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('round-trips all exported user settings through the settings import path', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'echo-settings-round-trip-'));
    const exportPath = join(tempRoot, 'settings.json');
    const exportedSettings: Record<string, unknown> = {
      locale: 'en-US',
      appearanceTheme: 'dark',
      appearanceThemeScheduleEnabled: true,
      appearanceThemeScheduleDarkAt: '20:30',
      appearanceThemeScheduleLightAt: '07:15',
      appearanceThemePreset: 'classic',
      appearanceThemePresetOverrides: { classic: { dark: { accent: '#66ccff' } } },
      appearanceCustomThemes: [{ id: 'theme-1', name: 'Theme 1', dark: { accent: '#66ccff' } }],
      appearanceThemeCustomId: 'theme-1',
      hiddenPlayerBarButtonIds: ['audioExport', 'desktopLyrics'],
      sidebarRouteOrder: ['home', 'songs', 'settings'],
      sidebarHiddenRouteIds: ['streaming', 'plugins'],
      sidebarAutoHideEnabled: true,
      sidebarIconOnlyEnabled: true,
      settingsOptionalSectionsVisible: true,
      featureCommentsHidden: true,
      trackContextMenuExtraActionsEnabled: true,
      touchOnScreenKeyboardEnabled: true,
      songsSort: 'title',
      rememberedAudioOutput: { outputMode: 'shared', deviceId: 'device-1', deviceName: 'DAC' },
      hiddenAudioDeviceKeys: ['wasapi:old-device'],
      audioDsdOutputMode: 'dop',
      audioSoxrFallbackEnabled: true,
      audioEchoSrcMode: 'balanced',
      audioPcmDitherMode: 'triangular',
      audioIssueDiagnosticsWindowEnabled: true,
      albumMergeStrategy: 'sameTitleAndCover',
      artistMergeStrategy: 'standard',
      chineseCrossScriptSearchEnabled: true,
      artistWallAlbumArtwork: true,
      artistWallAlbumFallbackForMissingAvatars: true,
      artistStreamingAlbumsEnabled: true,
      artistStreamingAlbumsProvider: 'netease-cloud-music',
      autoFetchArtistImages: true,
      artistImageFetchPaused: true,
      liveLibraryUpdatesEnabled: true,
      liveLibraryAutoHideDeletedEnabled: true,
      safeModeEnabled: true,
      launchAtLoginEnabled: true,
      fastStartupEnabled: true,
      hardwareAccelerationDisabled: true,
      lyricsMvGraphicsPressureGuardEnabled: true,
      sqliteBalancedDurabilityEnabled: true,
      dataProtectionDisabled: true,
      autoUpdateEnabled: false,
      autoUpdateSource: 'custom',
      autoUpdateCustomUrl: 'https://updates.example.com/feed.json',
      autoAccountCheckOnStartup: false,
      suppressAccountExpiryNotices: true,
      notificationsDisabled: true,
      upcomingTrackNoticeEnabled: true,
      streamingFeatureEnabled: true,
      osuDownloaderFeatureEnabled: true,
      streamingPlaylistImportNoticeAccepted: true,
      spotifyAutoLaunchOfficialPlayer: false,
      spotifyClientId: 'spotify-client',
      spotifyRedirectUri: 'http://127.0.0.1/callback',
      tidalClientId: 'tidal-client',
      tidalClientSecret: 'tidal-secret',
      tidalRedirectUri: 'http://127.0.0.1/tidal',
      tidalCountryCode: 'JP',
      downloadsFeatureKeyAccepted: true,
      downloadsFeatureUnlocked: true,
      streamingDownloadActionsEnabled: true,
      connectAutoStartReceiversEnabled: true,
      airPlayReceiverProtocol: 'airplay1',
      hqPlayer: { enabled: true, connectionMode: 'network', host: '192.168.1.2', port: 4321 },
      playlistBackupsEnabled: false,
      autoDataBackupEnabled: true,
      autoDataBackupDirectory: 'D:\\EchoBackups',
      autoDataBackupIntervalDays: 30,
      autoDataBackupLastRunAt: '2026-06-30T00:00:00.000Z',
      autoDataBackupLastPath: 'D:\\EchoBackups\\last.zip',
      autoDataBackupLastError: 'previous warning',
      coverCacheDir: join(tempRoot, 'cover-cache'),
      hideToTrayOnClose: true,
      rememberWindowSizeEnabled: true,
      rememberedWindowSize: { width: 1440, height: 900, x: 10, y: 20, maximized: false },
      appCustomWallpaperPath: 'D:\\Wallpapers\\app.jpg',
      appPortraitWallpaperPath: 'D:\\Wallpapers\\portrait.jpg',
      appWallpaperMediaType: 'image',
      appPortraitWallpaperMediaType: 'image',
      appWallpaperScalePercent: 110,
      appWallpaperBlurPx: 8,
      appWallpaperBrightnessPercent: 85,
      appWallpaperUiOpacityPercent: 92,
      appWallpaperVisualProtectionEnabled: true,
      appWallpaperUnifiedOpacityEnabled: true,
      nowPlayingCoverColorEnabled: true,
      appVideoWallpaperPauseMode: 'smart',
      networkProxyMode: 'manual',
      networkProxyUrl: 'http://127.0.0.1:7890',
      networkProxyBypassRules: '<local>',
      networkProxyPacUrl: null,
      networkMetadataEnabled: true,
      networkMetadataProviders: ['netease-cloud-music', 'qq-music'],
      onlineArtistInfoBandsintownAppId: 'bandsintown',
      onlineArtistInfoTicketmasterApiKey: 'ticketmaster',
      onlineArtistInfoSeatGeekClientId: 'seatgeek',
      onlineArtistInfoRegion: 'US',
      onlineArtistInfoSources: ['lastfm', 'musicbrainz'],
      onlineAlbumInfoDiscogsUserToken: 'discogs-token',
      audioAnalysisEnabled: true,
      lyricsNetworkEnabled: true,
      lyricsPreferredProvider: 'lrclib',
      lyricsEnabledProviders: ['local', 'lrclib', 'netease'],
      lyricsProviderOrder: ['local', 'lrclib', 'netease'],
      lyricsProviderTimeoutMs: 3000,
      lyricsTotalMatchTimeoutMs: 5000,
      lyricsDeepSearchEnabled: true,
      lyricsAutoSearch: true,
      lyricsAutoApplyEnabled: true,
      lyricsAutoAcceptScore: 0.82,
      lyricsBackfillAutoAcceptScore: 0.5,
      lyricsRestartOnApplyEnabled: true,
      lyricsAutoSaveSidecarEnabled: true,
      lyricsDefaultOffsetMs: 120,
      lyricsGlobalSyncOffsetMs: -40,
      lyricsTimelineCorrectionEnabled: true,
      lyricsOffsetControlsEnabled: true,
      lyricsSmartAlignmentEnabled: true,
      lyricsEnabled: true,
      lyricsHeaderHidden: true,
      lyricsCornerControlsAutoHideEnabled: true,
      lyricsMvAutoShowTrackInfoDisabled: true,
      lyricsCandidatePanelAutoOpenEnabled: true,
      lyricsEmptyStateHidden: true,
      lyricsPlayerBarDrawerEnabled: true,
      lyricsPlayerBarDrawerAutoEnableForMv: true,
      lyricsPlayerBarDrawerAutoHideEnabled: true,
      lyricsPlayerBarDrawerCompactOnIdleEnabled: true,
      lyricsPlayerBarDrawerOpacityPercent: 90,
      lyricsPlayerBarDrawerColorMode: 'custom',
      lyricsPlayerBarDrawerColor: '#ffffff',
      lyricsRomanizationEnabled: true,
      lyricsUtatenKanaEnabled: true,
      lyricsTranslationEnabled: true,
      lyricsWordHighlightEnabled: true,
      lyricsWordHighlightClarityPercent: 80,
      lyricsFontSizePx: 42,
      lyricsSecondaryFontSizePx: 24,
      lyricsFontFamily: 'Inter',
      lyricsFontFilePath: 'D:\\Fonts\\Inter.ttf',
      lyricsTextDirection: 'horizontal',
      lyricsLineSpacingPercent: 120,
      lyricsLineMaxChars: 24,
      lyricsContextOpacityPercent: 55,
      lyricsColor: '#f5f7fb',
      lyricsSmartReadableColorsEnabled: true,
      lyricsPageStyle: 'default',
      lyricsBackgroundMode: 'custom',
      lyricsCustomWallpaperPath: 'D:\\Wallpapers\\lyrics.jpg',
      lyricsCoverOpacityPercent: 80,
      lyricsCoverBlurPx: 12,
      lyricsCoverBrightnessPercent: 78,
      lyricsBackgroundScalePercent: 105,
      desktopLyricsEnabled: true,
      desktopLyricsLocked: true,
      mvEnabled: true,
      mvEnabledProviders: ['bilibili', 'youtube'],
      mvProviderOrder: ['youtube', 'bilibili'],
      mvAutoSearch: true,
      mvMaxQuality: '2160p',
      mvAllow60fps: true,
      mvAutoPreload: true,
      mvAutoApplyThreshold: 0.72,
      mvTitleOnlySearch: true,
      mvPreferHighestViewCount: true,
      mvImmersiveBackground: true,
      channelBalance: {
        enabled: true,
        balance: -0.1,
        leftGainDb: -1,
        rightGainDb: 1,
        swapLeftRight: true,
        monoMode: 'mix',
        invertLeft: false,
        invertRight: true,
        constantPower: true,
      },
      playerVolume: 0.67,
      backgroundSpacePauseEnabled: true,
      localShortcuts: { playPause: { enabled: true, accelerator: 'Space' } },
      globalShortcuts: { playPause: { enabled: true, accelerator: 'Ctrl+Alt+Space' } },
      playbackSpeed: 1.15,
      playbackSpeedMode: 'nightcore',
      playbackShuffleAvoidRecentCount: 40,
      replayGainMode: 'album',
      scanPerformanceMode: 'fast',
      duplicateTracksEnabled: true,
      duplicateTracksMode: 'relaxed',
      duplicateTracksAutoRebuildAfterScan: true,
      discordRichPresenceEnabled: true,
      lastFmEnabled: true,
      lastFmUsername: 'listener',
      lastFmSessionKey: 'lastfm-session',
      lastFmScrobbleEnabled: true,
      lastFmNowPlayingEnabled: true,
      lastFmMinScrobbleSeconds: 45,
      lastFmAuthToken: 'lastfm-token',
      smtcEnabled: true,
      smtcLyricsEnabled: true,
      taskbarPlaybackControlsEnabled: true,
      obsBrowserSourceEnabled: true,
      stageApiEnabled: true,
    };

    mkdirSync(exportedSettings.coverCacheDir as string, { recursive: true });
    showSaveDialogMock.mockResolvedValueOnce({ canceled: false, filePath: exportPath });
    getAppSettingsMock.mockReturnValueOnce(exportedSettings);

    await expect(handlers[IpcChannels.AppExportSettings]!()).resolves.toBe(exportPath);

    const payload = JSON.parse(readFileSync(exportPath, 'utf8')) as { settings: Record<string, unknown> };
    expect(payload.settings).toEqual(exportedSettings);
    expect(Object.keys(payload.settings).sort()).toEqual(Object.keys(exportedSettings).sort());

    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [exportPath] });
    getEchoProLicenseStatusMock.mockReturnValue({ valid: true, enabled: true, features: ['echo-pro'] });
    getAppSettingsMock.mockReturnValue({ locale: 'zh-CN', coverCacheDir: null, hideToTrayOnClose: false });
    const service = {
      hasRunningJobs: () => false,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
      setCoverCacheDir: vi.fn(),
      syncLiveLibraryWatcherFromSettings: vi.fn(),
      syncArtistImageBackfillState: vi.fn(),
    };
    getLibraryServiceMock.mockReturnValue(service);
    setAppSettingsMock.mockImplementation((patch) => ({ ...(patch as Record<string, unknown>) }));

    const result = (await handlers[IpcChannels.AppImportSettings]!()) as { importedPath: string; settings: Record<string, unknown> };
    const importedPatch = setAppSettingsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;

    expect(result.importedPath).toBe(exportPath);
    expect(importedPatch).toEqual(exportedSettings);
    expect(Object.keys(importedPatch).sort()).toEqual(Object.keys(exportedSettings).sort());
    expect(result.settings).toEqual(exportedSettings);
    expect(service.setCoverCacheDir).toHaveBeenCalledWith(exportedSettings.coverCacheDir);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('chooses an automatic data backup directory', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:\\EchoBackups'] });

    const result = await handlers[IpcChannels.AppChooseDataBackupDirectory]!();

    expect(result).toBe('D:\\EchoBackups');
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openDirectory', 'createDirectory'],
      }),
    );
  });

  it('runs a manual data backup through the configured service', async () => {
    runDataBackupNowMock.mockResolvedValue({
      filePath: 'D:\\EchoBackups\\ECHO-NEXT-backup.zip',
      exportedAt: '2026-05-20T00:00:00.000Z',
      reason: 'manual',
      snapshotPath: 'D:\\Echo\\snapshot',
      includedEntries: [],
      skippedEntries: [],
      warnings: [],
      sizeBytes: 1024,
    });

    const result = await handlers[IpcChannels.AppRunDataBackupNow]!();

    expect(runDataBackupNowMock).toHaveBeenCalledWith('manual');
    expect(result).toMatchObject({ filePath: 'D:\\EchoBackups\\ECHO-NEXT-backup.zip' });
  });

  it('imports a data backup and applies restored settings with side effects', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:\\EchoBackups\\backup.zip'] });
    getAppSettingsMock.mockReturnValue({
      locale: 'zh-CN',
      coverCacheDir: null,
      hideToTrayOnClose: false,
      autoDataBackupEnabled: true,
      autoDataBackupDirectory: 'D:\\CurrentBackups',
      autoDataBackupIntervalDays: 3,
      autoDataBackupLastRunAt: '2026-05-19T00:00:00.000Z',
      autoDataBackupLastPath: 'D:\\CurrentBackups\\last.zip',
    });
    importEchoUserDataBackupMock.mockResolvedValue({
      importedAt: '2026-05-20T00:00:00.000Z',
      importedPath: 'D:\\EchoBackups\\backup.zip',
      rollbackBackupPath: 'D:\\Echo\\rollback.zip',
      restoredEntries: ['user-data/echo-library.sqlite'],
      skippedEntries: [],
      warnings: [],
      settings: {
        locale: 'en-US',
        coverCacheDir: null,
        hideToTrayOnClose: false,
        autoDataBackupEnabled: true,
        autoDataBackupDirectory: 'D:\\OldMachineBackups',
        autoDataBackupIntervalDays: 30,
      },
    });
    const service = {
      hasRunningJobs: () => false,
      getDefaultCoverCacheDir: () => 'D:\\Echo\\cover-cache',
      setCoverCacheDir: vi.fn(),
      syncLiveLibraryWatcherFromSettings: vi.fn(),
    };
    getLibraryServiceMock.mockReturnValue(service);
    setAppSettingsMock.mockImplementation((patch) => ({ coverCacheDir: null, hideToTrayOnClose: false, ...(patch as Record<string, unknown>) }));

    const result = (await handlers[IpcChannels.AppImportDataBackup]!()) as {
      settings: { locale: string; autoDataBackupDirectory?: string | null };
      rollbackBackupPath: string;
      warnings: string[];
    };

    expect(importEchoUserDataBackupMock).toHaveBeenCalledWith('D:\\EchoBackups\\backup.zip');
    expect(setAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en-US',
        autoDataBackupEnabled: true,
        autoDataBackupDirectory: 'D:\\CurrentBackups',
        autoDataBackupIntervalDays: 3,
        autoDataBackupLastPath: 'D:\\CurrentBackups\\last.zip',
      }),
      lockedFeatureSettingsOptions,
    );
    expect(result.settings.locale).toBe('en-US');
    expect(result.settings.autoDataBackupDirectory).toBe('D:\\CurrentBackups');
    expect(result.warnings).toContain('已保留当前设备的自动备份目录，未使用备份文件里的旧目录。');
    expect(result.rollbackBackupPath).toBe('D:\\Echo\\rollback.zip');
  });

  it('refreshes global shortcuts when shortcut settings change', async () => {
    const shortcutPatch = {
      globalShortcuts: {
        playPause: { enabled: true, accelerator: 'Ctrl+Alt+Space' },
      },
    };
    setAppSettingsMock.mockReturnValue({ ...shortcutPatch, coverCacheDir: null, hideToTrayOnClose: false });

    await handlers[IpcChannels.AppSetSettings]!(null, shortcutPatch);

    expect(setAppSettingsMock).toHaveBeenCalledWith(shortcutPatch, lockedFeatureSettingsOptions);
    expect(refreshGlobalShortcutRegistrationMock).toHaveBeenCalledTimes(1);
  });

  it('validates global shortcut accelerators through IPC', () => {
    const result = handlers[IpcChannels.AppValidateGlobalShortcut]!(null, 'Ctrl+Alt+Space');

    expect(validateGlobalShortcutMock).toHaveBeenCalledWith('Ctrl+Alt+Space');
    expect(result).toMatchObject({ valid: true, available: true });
  });

  it('applies network proxy settings after saving proxy fields', async () => {
    const proxyPatch = {
      networkProxyMode: 'manual',
      networkProxyUrl: 'http://127.0.0.1:7890/',
      networkProxyBypassRules: '<local>;localhost',
    };
    setAppSettingsMock.mockReturnValue({ ...proxyPatch, coverCacheDir: null, hideToTrayOnClose: false });

    await handlers[IpcChannels.AppSetSettings]!(null, proxyPatch);

    expect(setAppSettingsMock).toHaveBeenCalledWith(proxyPatch, lockedFeatureSettingsOptions);
    expect(applyNetworkProxySettingsMock).toHaveBeenCalledWith(expect.objectContaining(proxyPatch));
  });

  it('tests the current network proxy settings through IPC', async () => {
    getAppSettingsMock.mockReturnValue({ networkProxyMode: 'off', coverCacheDir: null, hideToTrayOnClose: false });

    const result = await handlers[IpcChannels.AppTestNetworkProxy]!();

    expect(fromPartitionMock).toHaveBeenCalledWith(expect.stringMatching(/^network-proxy-test-/u));
    expect(testNetworkProxyConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkProxyMode: 'off' }),
      undefined,
      proxyTestSessionMock,
    );
    expect(result).toMatchObject({ ok: true, resolvedProxy: 'DIRECT' });
  });

  it('tests draft network proxy settings through IPC without saving them', async () => {
    getAppSettingsMock.mockReturnValue({ networkProxyMode: 'off', coverCacheDir: null, hideToTrayOnClose: false });

    await handlers[IpcChannels.AppTestNetworkProxy]!(null, {
      networkProxyMode: 'manual',
      networkProxyUrl: '192.168.51.1:7890',
      networkProxyBypassRules: '<local>',
    });

    expect(setAppSettingsMock).not.toHaveBeenCalled();
    expect(testNetworkProxyConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        networkProxyMode: 'manual',
        networkProxyUrl: '192.168.51.1:7890',
        networkProxyBypassRules: '<local>',
      }),
      undefined,
      proxyTestSessionMock,
    );
  });
});
