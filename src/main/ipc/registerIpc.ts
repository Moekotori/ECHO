import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AppSettings } from '../../shared/types/appSettings';
import type {
  DataBackupExportResult,
  DataBackupImportResult,
  DataBackupStatus,
  DataPackageExportResult,
  SettingsBackupPayload,
  SettingsImportResult,
} from '../../shared/types/settingsBackup';
import type { TaskbarPlaybackStatus } from '../../shared/types/taskbarPlayback';
import type { AppCacheInventory, CoverCacheMigrationResult, SetCoverCacheDirectoryRequest } from '../../shared/types/coverCache';
import type { UpdateStatus } from '../../shared/types/updates';
import type { FontFileAsset } from '../../preload/apiTypes';
import { defaultSettings, getAppSettings, getAppWallpaperDirectory, getLyricsWallpaperDirectory, normalizeSettings, setAppSettings } from '../app/appSettings';
import { getAppCacheInventory as collectAppCacheInventory } from '../app/cacheInventory';
import { checkForUpdates, getUpdateStatus, reconfigureAutoUpdateFeed, setAutoUpdateEnabled } from '../app/autoUpdater';
import { refreshBackgroundSpaceRegistration, validateGlobalShortcut } from '../app/backgroundPlaybackShortcuts';
import {
  getDataBackupStatus,
  importEchoUserDataBackup,
  refreshDataBackupScheduler,
  runDataBackupNow,
  subscribeDataBackupProgress,
} from '../app/dataBackup';
import { exportEchoDataPackage } from '../app/dataPackage';
import { getTaskbarPlaybackStatus, refreshTaskbarPlaybackIntegration } from '../app/taskbarPlaybackIntegration';
import { showWindowsTouchKeyboard } from '../app/touchKeyboard';
import { ensureTray, requestAppQuit } from '../app/tray';
import { ensureCoverCacheDirectory } from '../library/CoverCacheManager';
import { getLibraryService } from '../library/LibraryService';
import { setDiscordPresenceEnabled } from '../integrations/discord/getDiscordPresenceService';
import { getLastFmService } from '../integrations/lastfm/getLastFmService';
import { applyNetworkProxySettings, testNetworkProxyConnection } from '../network/proxySettings';
import { getMainWindow } from '../app/windowManager';
import { applyMainWindowBackgroundMaterial } from '../app/windowBackgroundMaterial';
import { markStartupStage } from '../diagnostics/StartupDiagnostics';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { installIpcPerformanceDiagnostics } from '../diagnostics/IpcPerformanceDiagnostics';
import { registerAudioIpc } from './audioIpc';
import { registerAccountIpc } from './accountIpc';
import { registerConnectIpc } from './connectIpc';
import { registerDiagnosticsIpc } from './diagnosticsIpc';
import { registerDiscordPresenceIpc } from './discordPresenceIpc';
import { registerDesktopLyricsIpc } from './desktopLyricsIpc';
import { registerDownloadsIpc } from './downloadsIpc';
import { registerLastFmIpc } from './lastFmIpc';
import { registerLibraryIpc } from './libraryIpc';
import { registerLyricsIpc } from './lyricsIpc';
import { registerMiniPlayerIpc } from './miniPlayerIpc';
import { registerMvIpc } from './mvIpc';
import { registerHqPlayerIpc } from './hqPlayerIpc';
import { registerPlaybackIpc } from './playbackIpc';
import { registerPluginIpc } from './pluginIpc';
import { registerRemoteSourcesIpc } from './remoteSourcesIpc';
import { registerSmtcIpc } from './smtcIpc';
import { registerStreamingIpc } from './streamingIpc';
import { registerSleepTimerIpc } from './sleepTimerIpc';

const fontMimeTypes: Record<string, string> = {
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const imageWallpaperExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const videoWallpaperExtensions = new Set(['.mp4', '.m4v', '.webm']);
const appWallpaperExtensions = new Set([...imageWallpaperExtensions, ...videoWallpaperExtensions]);
const settingsBackupFormat = 'echo-next-settings-backup';
const settingsBackupVersion = 1;
const settingsBackupFilters = [{ name: 'ECHO Next Settings', extensions: ['json'] }];
const dataPackageFilters = [{ name: 'ECHO Next Data Package', extensions: ['zip'] }];
const dataBackupFilters = [{ name: 'ECHO Next Data Backup', extensions: ['zip'] }];

const registerIpcStartupStep = (name: string, register: () => void): void => {
  const startedAt = Date.now();
  const clearBackgroundTask = beginMainBackgroundTask(`startup:ipc:${name}`);
  markStartupStage(`ipc:${name}:start`);
  try {
    register();
  } finally {
    clearBackgroundTask();
    markStartupStage(`ipc:${name}:complete`, { durationMs: Date.now() - startedAt });
  }
};

const requireFontPath = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('font path must be a non-empty string');
  }

  const fontPath = value.trim();
  const extension = extname(fontPath).toLowerCase();

  if (!fontMimeTypes[extension]) {
    throw new Error('selected file is not a supported font');
  }

  if (!existsSync(fontPath)) {
    throw new Error('selected font file does not exist');
  }

  return fontPath;
};

const toFontFamily = (fontPath: string): string => basename(fontPath, extname(fontPath)).replace(/[\r\n;]/g, '').trim() || 'Custom Font';

const getSystemUserName = (): string | null => {
  try {
    return userInfo().username?.replace(/[\r\n]/g, '').trim() || null;
  } catch {
    return null;
  }
};

const loadFontFile = (fontPathInput: unknown): FontFileAsset => {
  const fontPath = requireFontPath(fontPathInput);
  const extension = extname(fontPath).toLowerCase();
  const content = readFileSync(fontPath);

  return {
    path: fontPath,
    family: toFontFamily(fontPath),
    dataUrl: `data:${fontMimeTypes[extension]};base64,${content.toString('base64')}`,
  };
};

const requireWallpaperPath = (value: unknown, allowedExtensions: Set<string>, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('wallpaper path must be a non-empty string');
  }

  const wallpaperPath = resolve(value.trim());
  const extension = extname(wallpaperPath).toLowerCase();

  if (!allowedExtensions.has(extension)) {
    throw new Error(`selected file is not a supported ${label}`);
  }

  if (!existsSync(wallpaperPath)) {
    throw new Error('selected wallpaper file does not exist');
  }

  return wallpaperPath;
};

const copyWallpaper = (
  wallpaperPathInput: unknown,
  wallpaperDirectory: string,
  allowedExtensions: Set<string>,
  label: string,
): string => {
  const wallpaperPath = requireWallpaperPath(wallpaperPathInput, allowedExtensions, label);
  const extension = extname(wallpaperPath).toLowerCase();
  const targetPath = resolve(wallpaperDirectory, `${randomUUID()}${extension}`);

  mkdirSync(wallpaperDirectory, { recursive: true });
  copyFileSync(wallpaperPath, targetPath);
  return targetPath;
};

const copyLyricsWallpaper = (wallpaperPathInput: unknown): string =>
  copyWallpaper(wallpaperPathInput, getLyricsWallpaperDirectory(), imageWallpaperExtensions, 'image');

const copyAppWallpaper = (wallpaperPathInput: unknown): string =>
  copyWallpaper(wallpaperPathInput, getAppWallpaperDirectory(), appWallpaperExtensions, 'image or video');

const requireExternalHttpUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('external URL must be a non-empty string');
  }

  const url = new URL(value.trim());

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('external URL must use http or https');
  }

  return url.toString();
};

const normalizeCoverCacheRequest = (value: unknown): SetCoverCacheDirectoryRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('cover cache directory request must be an object');
  }

  const input = value as Record<string, unknown>;
  const directory =
    typeof input.directory === 'string' && input.directory.trim().length > 0 ? resolve(input.directory.trim()) : null;

  return {
    directory,
    migrate: input.migrate === true,
  };
};

const getAppCacheInventory = (): Promise<AppCacheInventory> => collectAppCacheInventory(app.getPath('userData'));

const isWindowMaximizedForChrome = (window: BrowserWindow | null): boolean =>
  Boolean(window && (window.isMaximized() || window.isFullScreen()));

const toggleWindowFullscreen = (window: BrowserWindow | null): void => {
  if (!window) {
    return;
  }

  window.setFullScreen(!window.isFullScreen());
};

const formatBackupTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const createSettingsBackupPayload = (settings: AppSettings): SettingsBackupPayload => ({
  format: settingsBackupFormat,
  version: settingsBackupVersion,
  exportedAt: new Date().toISOString(),
  appVersion: app.getVersion(),
  settings,
});

const getSettingsBackupDirectory = (): string => join(app.getPath('userData'), 'settings-backups');

const writeSettingsBackupFile = (filePath: string, settings: AppSettings): void => {
  writeFileSync(filePath, `${JSON.stringify(createSettingsBackupPayload(settings), null, 2)}\n`, 'utf8');
};

const readSettingsBackupFile = (filePath: string): AppSettings => {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Selected file is not a valid ECHO Next settings backup.');
  }

  const payload = parsed as Partial<SettingsBackupPayload> & { settings?: unknown };
  if (payload.format === settingsBackupFormat) {
    if (payload.version !== settingsBackupVersion || !payload.settings || typeof payload.settings !== 'object') {
      throw new Error('Selected settings backup uses an unsupported format.');
    }

    return normalizeSettings(payload.settings);
  }

  return normalizeSettings(parsed);
};

const applyAppSettingsPatch = async (
  patch: Partial<AppSettings>,
  options: { allowCoverCacheDir?: boolean } = {},
): Promise<AppSettings> => {
  const settingsPatch = { ...patch };
  const canSetCoverCacheDir = options.allowCoverCacheDir === true && Object.prototype.hasOwnProperty.call(settingsPatch, 'coverCacheDir');
  let libraryService: ReturnType<typeof getLibraryService> | null = null;

  if (canSetCoverCacheDir) {
    libraryService = getLibraryService();
    if (libraryService.hasRunningJobs()) {
      throw new Error('Cannot import settings while a library scan is running.');
    }

    const coverCacheDir = settingsPatch.coverCacheDir ?? libraryService.getDefaultCoverCacheDir();
    await ensureCoverCacheDirectory(coverCacheDir);
    libraryService.setCoverCacheDir(coverCacheDir);
  } else {
    delete settingsPatch.coverCacheDir;
  }

  let settings = setAppSettings(settingsPatch);
  ensureTray();

  const autoUpdateSourceChanged =
    typeof settingsPatch.autoUpdateSource === 'string' ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'autoUpdateCustomUrl');

  if (typeof settingsPatch.autoUpdateEnabled === 'boolean' || autoUpdateSourceChanged) {
    const autoUpdateEnabled = settings.autoUpdateEnabled !== false;
    setAutoUpdateEnabled(autoUpdateEnabled);
    if (autoUpdateEnabled) {
      reconfigureAutoUpdateFeed();
      void checkForUpdates();
    }
  }

  if (
    typeof settingsPatch.networkProxyMode === 'string' ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'networkProxyUrl') ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'networkProxyBypassRules') ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'networkProxyPacUrl')
  ) {
    await applyNetworkProxySettings(settings);
  }

  if (typeof settingsPatch.backgroundSpacePauseEnabled === 'boolean' || settingsPatch.globalShortcuts) {
    settings = refreshBackgroundSpaceRegistration() ?? settings;
  }

  if (typeof settingsPatch.taskbarPlaybackControlsEnabled === 'boolean') {
    refreshTaskbarPlaybackIntegration();
  }

  if (
    typeof settingsPatch.appWindowAcrylicEnabled === 'boolean' ||
    typeof settingsPatch.appWindowAcrylicKeepWhenUnfocusedEnabled === 'boolean'
  ) {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      applyMainWindowBackgroundMaterial(mainWindow, settings);
    }
  }

  if (
    typeof settingsPatch.autoDataBackupEnabled === 'boolean' ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'autoDataBackupDirectory') ||
    Object.prototype.hasOwnProperty.call(settingsPatch, 'autoDataBackupIntervalDays')
  ) {
    refreshDataBackupScheduler();
  }

  if (typeof settingsPatch.autoFetchArtistImages === 'boolean' || typeof settingsPatch.artistImageFetchPaused === 'boolean') {
    getLibraryService().syncArtistImageBackfillState();
  }

  if (
    typeof settingsPatch.liveLibraryUpdatesEnabled === 'boolean' ||
    typeof settingsPatch.liveLibraryAutoHideDeletedEnabled === 'boolean'
  ) {
    (libraryService ?? getLibraryService()).syncLiveLibraryWatcherFromSettings();
  }

  return settings;
};

const normalizeNetworkProxyTestSettings = (rawPatch: unknown): AppSettings => {
  const current = getAppSettings();
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    return current;
  }

  const patch = rawPatch as Partial<AppSettings>;
  const networkProxyPatch: Partial<AppSettings> = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'networkProxyMode')) {
    networkProxyPatch.networkProxyMode = patch.networkProxyMode;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'networkProxyUrl')) {
    networkProxyPatch.networkProxyUrl = patch.networkProxyUrl;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'networkProxyPacUrl')) {
    networkProxyPatch.networkProxyPacUrl = patch.networkProxyPacUrl;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'networkProxyBypassRules')) {
    networkProxyPatch.networkProxyBypassRules = patch.networkProxyBypassRules;
  }
  return normalizeSettings({ ...current, ...networkProxyPatch });
};

const preserveCurrentDataBackupTarget = (settings: AppSettings, currentSettings: AppSettings): AppSettings => ({
  ...settings,
  autoDataBackupEnabled: currentSettings.autoDataBackupEnabled === true && Boolean(currentSettings.autoDataBackupDirectory),
  autoDataBackupDirectory: currentSettings.autoDataBackupDirectory ?? null,
  autoDataBackupIntervalDays: currentSettings.autoDataBackupIntervalDays ?? settings.autoDataBackupIntervalDays ?? 7,
  autoDataBackupLastRunAt: currentSettings.autoDataBackupLastRunAt ?? null,
  autoDataBackupLastPath: currentSettings.autoDataBackupLastPath ?? null,
  autoDataBackupLastError: null,
});

export const registerIpc = (): void => {
  installIpcPerformanceDiagnostics(ipcMain);

  registerIpcStartupStep('app-core', () => {
    ipcMain.handle(IpcChannels.AppGetVersion, () => `v${app.getVersion()}`);
    ipcMain.handle(IpcChannels.AppWindowMinimize, (event: IpcMainInvokeEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });
    ipcMain.handle(IpcChannels.AppWindowToggleMaximize, (event: IpcMainInvokeEvent): void => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        return;
      }

      if (window.isFullScreen()) {
        window.setFullScreen(false);
        return;
      }

      if (window.isMaximized()) {
        window.unmaximize();
        return;
      }

      window.maximize();
    });
    ipcMain.handle(IpcChannels.AppWindowIsMaximized, (event: IpcMainInvokeEvent): boolean =>
      isWindowMaximizedForChrome(BrowserWindow.fromWebContents(event.sender)),
    );
    ipcMain.handle(IpcChannels.AppWindowToggleFullscreen, (event: IpcMainInvokeEvent): void => {
      toggleWindowFullscreen(BrowserWindow.fromWebContents(event.sender));
    });
    ipcMain.handle(IpcChannels.AppWindowTriggerFullscreenShortcut, (event: IpcMainInvokeEvent): void => {
      toggleWindowFullscreen(BrowserWindow.fromWebContents(event.sender));
    });
    ipcMain.handle(IpcChannels.AppWindowIsFullscreen, (event: IpcMainInvokeEvent): boolean =>
      Boolean(BrowserWindow.fromWebContents(event.sender)?.isFullScreen()),
    );
    ipcMain.handle(IpcChannels.AppWindowClose, (event: IpcMainInvokeEvent): void => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    });
    ipcMain.handle(IpcChannels.AppQuit, (): void => {
      requestAppQuit();
      app.quit();
    });
    ipcMain.handle(IpcChannels.AppGetSystemUserName, (): string | null => getSystemUserName());
    ipcMain.handle(IpcChannels.AppGetSettings, (): AppSettings => getAppSettings());
    ipcMain.handle(IpcChannels.AppSetSettings, (_event: IpcMainInvokeEvent, patch: Partial<AppSettings>): Promise<AppSettings> =>
      applyAppSettingsPatch(patch),
    );
    ipcMain.handle(IpcChannels.AppGetTaskbarPlaybackStatus, (): TaskbarPlaybackStatus => {
      refreshTaskbarPlaybackIntegration();
      return getTaskbarPlaybackStatus();
    });
    ipcMain.handle(IpcChannels.AppExportSettings, async (): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: 'Export ECHO Next settings',
        defaultPath: join(app.getPath('downloads'), `echo-next-settings-${formatBackupTimestamp()}.json`),
        filters: settingsBackupFilters,
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      writeSettingsBackupFile(result.filePath, getAppSettings());
      return result.filePath;
    });
    ipcMain.handle(IpcChannels.AppImportSettings, async (): Promise<SettingsImportResult | null> => {
      const result = await dialog.showOpenDialog({
        title: 'Import ECHO Next settings',
        properties: ['openFile'],
        filters: settingsBackupFilters,
      });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      const importedPath = result.filePaths[0];
      const importedSettings = readSettingsBackupFile(importedPath);
      const backupDirectory = getSettingsBackupDirectory();
      const backupPath = join(backupDirectory, `before-import-${formatBackupTimestamp()}.json`);

      mkdirSync(backupDirectory, { recursive: true });
      writeSettingsBackupFile(backupPath, getAppSettings());

      const settings = await applyAppSettingsPatch(importedSettings, { allowCoverCacheDir: true });
      return {
        settings,
        backupPath,
        importedPath,
        warnings: [],
      };
    });
  });

  registerIpcStartupStep('app-data', () => {
  ipcMain.handle(IpcChannels.AppExportDataPackage, async (): Promise<DataPackageExportResult | null> => {
    const result = await dialog.showSaveDialog({
      title: 'Export ECHO Next data package',
      defaultPath: join(app.getPath('downloads'), `echo-next-data-package-${formatBackupTimestamp()}.zip`),
      filters: dataPackageFilters,
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return exportEchoDataPackage(result.filePath);
  });
  ipcMain.handle(IpcChannels.AppChooseDataBackupDirectory, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose ECHO Next backup directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IpcChannels.AppGetDataBackupStatus, (): DataBackupStatus => getDataBackupStatus());
  subscribeDataBackupProgress((progress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.AppDataBackupProgress, progress);
      }
    }
  });
  ipcMain.handle(IpcChannels.AppRunDataBackupNow, (): Promise<DataBackupExportResult> => runDataBackupNow('manual'));
  ipcMain.handle(IpcChannels.AppImportDataBackup, async (): Promise<DataBackupImportResult | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Import ECHO Next data backup',
      properties: ['openFile'],
      filters: dataBackupFilters,
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const currentSettings = getAppSettings();
    const imported = await importEchoUserDataBackup(result.filePaths[0]);
    const restoredSettings = preserveCurrentDataBackupTarget(imported.settings, currentSettings);
    const settings = await applyAppSettingsPatch(restoredSettings, { allowCoverCacheDir: true });
    const warnings =
      imported.settings.autoDataBackupEnabled === true || imported.settings.autoDataBackupDirectory
        ? [...imported.warnings, '已保留当前设备的自动备份目录，未使用备份文件里的旧目录。']
        : imported.warnings;
    return { ...imported, warnings, settings };
  });
  ipcMain.handle(IpcChannels.AppOpenDataBackupDirectory, async (): Promise<void> => {
    const directory = getAppSettings().autoDataBackupDirectory;
    if (!directory) {
      throw new Error('Backup directory is not configured.');
    }

    await shell.openPath(directory);
  });
  ipcMain.handle(IpcChannels.AppValidateGlobalShortcut, (_event: IpcMainInvokeEvent, accelerator: unknown) =>
    validateGlobalShortcut(accelerator),
  );
  ipcMain.handle(IpcChannels.AppResetSettings, async (): Promise<AppSettings> => {
    const libraryService = getLibraryService();
    const defaultCoverCacheDir = libraryService.getDefaultCoverCacheDir();

    if (libraryService.hasRunningJobs()) {
      throw new Error('Cannot reset settings while a library scan is running.');
    }

    await ensureCoverCacheDirectory(defaultCoverCacheDir);
    libraryService.setCoverCacheDir(defaultCoverCacheDir);
    const settings = setAppSettings({ ...defaultSettings });
    ensureTray();
    refreshBackgroundSpaceRegistration();
    refreshTaskbarPlaybackIntegration();
    libraryService.syncLiveLibraryWatcherFromSettings();
    await setDiscordPresenceEnabled(settings.discordRichPresenceEnabled);
    await applyNetworkProxySettings(settings);
    getLastFmService().disconnect();
    return settings;
  });
  ipcMain.handle(IpcChannels.AppChooseFontFile, async (): Promise<FontFileAsset | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose font file',
      properties: ['openFile'],
      filters: [{ name: 'Font files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    });

    return result.canceled ? null : loadFontFile(result.filePaths[0]);
  });
  ipcMain.handle(IpcChannels.AppChooseLyricsWallpaper, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose lyrics wallpaper',
      properties: ['openFile'],
      filters: [{ name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });

    return result.canceled || !result.filePaths[0] ? null : copyLyricsWallpaper(result.filePaths[0]);
  });
  ipcMain.handle(IpcChannels.AppChooseAppWallpaper, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose app wallpaper',
      properties: ['openFile'],
      filters: [
        { name: 'Background files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'm4v', 'webm'] },
        { name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
        { name: 'Video files', extensions: ['mp4', 'm4v', 'webm'] },
      ],
    });

    return result.canceled || !result.filePaths[0] ? null : copyAppWallpaper(result.filePaths[0]);
  });
  ipcMain.handle(IpcChannels.AppLoadFontFile, (_event: IpcMainInvokeEvent, fontPath: unknown): FontFileAsset => loadFontFile(fontPath));
  ipcMain.handle(IpcChannels.AppChooseCacheDirectory, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择封面缓存目录',
      properties: ['openDirectory'],
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IpcChannels.AppGetDefaultCacheDirectory, (): string => getLibraryService().getDefaultCoverCacheDir());
  ipcMain.handle(IpcChannels.AppGetCacheInventory, (): Promise<AppCacheInventory> => getAppCacheInventory());
  ipcMain.handle(IpcChannels.AppGetUpdateStatus, (): UpdateStatus => getUpdateStatus());
  ipcMain.handle(IpcChannels.AppCheckForUpdates, (): Promise<UpdateStatus> => checkForUpdates());
  ipcMain.handle(IpcChannels.AppOpenRepository, async (): Promise<void> => {
    await shell.openExternal('https://github.com/moekotori/echo');
  });
  ipcMain.handle(IpcChannels.AppOpenExternalUrl, async (_event: IpcMainInvokeEvent, rawUrl: unknown): Promise<void> => {
    await shell.openExternal(requireExternalHttpUrl(rawUrl));
  });
  ipcMain.handle(IpcChannels.AppShowTouchKeyboard, (): boolean => showWindowsTouchKeyboard());
  ipcMain.handle(IpcChannels.AppTestNetworkProxy, (_event: IpcMainInvokeEvent, rawPatch?: unknown) =>
    testNetworkProxyConnection(
      normalizeNetworkProxyTestSettings(rawPatch),
      undefined,
      session.fromPartition(`network-proxy-test-${randomUUID()}`),
    ),
  );
  ipcMain.handle(
    IpcChannels.AppSetCoverCacheDirectory,
    async (_event: IpcMainInvokeEvent, rawRequest: unknown): Promise<CoverCacheMigrationResult | null> => {
      const request = normalizeCoverCacheRequest(rawRequest);
      const libraryService = getLibraryService();

      if (libraryService.hasRunningJobs()) {
        throw new Error('Cannot change cover cache directory while a library scan is running.');
      }

      const nextDir = request.directory ?? libraryService.getDefaultCoverCacheDir();

      if (request.migrate) {
        const result = await libraryService.migrateCoverCacheDir(nextDir);

        if (result.errors.length > 0) {
          return result;
        }

        setAppSettings({ coverCacheDir: request.directory });
        libraryService.setCoverCacheDir(nextDir);
        return result;
      }

      await ensureCoverCacheDirectory(nextDir);
      setAppSettings({ coverCacheDir: request.directory });
      libraryService.setCoverCacheDir(nextDir);
      return null;
    },
  );
  });

  registerIpcStartupStep('diagnostics', registerDiagnosticsIpc);
  registerIpcStartupStep('account', registerAccountIpc);
  registerIpcStartupStep('connect', registerConnectIpc);
  registerIpcStartupStep('discord-presence', registerDiscordPresenceIpc);
  registerIpcStartupStep('desktop-lyrics', registerDesktopLyricsIpc);
  registerIpcStartupStep('mini-player', registerMiniPlayerIpc);
  registerIpcStartupStep('downloads', registerDownloadsIpc);
  registerIpcStartupStep('plugin', registerPluginIpc);
  registerIpcStartupStep('lastfm', registerLastFmIpc);
  registerIpcStartupStep('library', registerLibraryIpc);
  registerIpcStartupStep('lyrics', registerLyricsIpc);
  registerIpcStartupStep('mv', registerMvIpc);
  registerIpcStartupStep('hq-player', registerHqPlayerIpc);
  registerIpcStartupStep('remote-sources', registerRemoteSourcesIpc);
  registerIpcStartupStep('smtc', registerSmtcIpc);
  registerIpcStartupStep('streaming', registerStreamingIpc);
  registerIpcStartupStep('playback', registerPlaybackIpc);
  registerIpcStartupStep('audio', registerAudioIpc);
  registerIpcStartupStep('sleepTimer', registerSleepTimerIpc);
};
