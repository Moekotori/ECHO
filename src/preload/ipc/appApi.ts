import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';
import type { UpdateStatus } from '../../shared/types/updates';
import type { GlobalShortcutAction } from '../../shared/types/globalShortcuts';
import type { DataBackupProgress } from '../../shared/types/settingsBackup';

export function createAppApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['app'] {
  return {
    getVersion: () => ipcRenderer.invoke(IpcChannels.AppGetVersion),
    minimize: () => ipcRenderer.invoke(IpcChannels.AppWindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleMaximize),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.AppWindowIsMaximized),
    onMaximizedChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: unknown): void => {
        handler(isMaximized === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowMaximizedChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowMaximizedChanged, listener);
    },
    toggleFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowToggleFullscreen),
    triggerFullscreenShortcut: () => ipcRenderer.invoke(IpcChannels.AppWindowTriggerFullscreenShortcut),
    isFullscreen: () => ipcRenderer.invoke(IpcChannels.AppWindowIsFullscreen),
    onFullscreenChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullscreen: unknown): void => {
        handler(isFullscreen === true);
      };
      ipcRenderer.on(IpcChannels.AppWindowFullscreenChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppWindowFullscreenChanged, listener);
    },
    close: () => ipcRenderer.invoke(IpcChannels.AppWindowClose),
    quit: () => ipcRenderer.invoke(IpcChannels.AppQuit),
    getSystemUserName: () => ipcRenderer.invoke(IpcChannels.AppGetSystemUserName),
    getSettings: () => ipcRenderer.invoke(IpcChannels.AppGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.AppSetSettings, patch),
    getTaskbarPlaybackStatus: () => ipcRenderer.invoke(IpcChannels.AppGetTaskbarPlaybackStatus),
    resetSettings: () => ipcRenderer.invoke(IpcChannels.AppResetSettings),
    exportSettings: () => ipcRenderer.invoke(IpcChannels.AppExportSettings),
    importSettings: () => ipcRenderer.invoke(IpcChannels.AppImportSettings),
    exportDataPackage: () => ipcRenderer.invoke(IpcChannels.AppExportDataPackage),
    chooseDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseDataBackupDirectory),
    getDataBackupStatus: () => ipcRenderer.invoke(IpcChannels.AppGetDataBackupStatus),
    onDataBackupProgress: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
        if (progress) {
          handler(progress as DataBackupProgress);
        }
      };
      ipcRenderer.on(IpcChannels.AppDataBackupProgress, listener);
      return () => ipcRenderer.off(IpcChannels.AppDataBackupProgress, listener);
    },
    runDataBackupNow: () => ipcRenderer.invoke(IpcChannels.AppRunDataBackupNow),
    importDataBackup: () => ipcRenderer.invoke(IpcChannels.AppImportDataBackup),
    openDataBackupDirectory: () => ipcRenderer.invoke(IpcChannels.AppOpenDataBackupDirectory),
    chooseFontFile: () => ipcRenderer.invoke(IpcChannels.AppChooseFontFile),
    chooseLyricsWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseLyricsWallpaper),
    chooseAppWallpaper: () => ipcRenderer.invoke(IpcChannels.AppChooseAppWallpaper),
    loadFontFile: (path) => ipcRenderer.invoke(IpcChannels.AppLoadFontFile, path),
    chooseCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppChooseCacheDirectory),
    getDefaultCacheDirectory: () => ipcRenderer.invoke(IpcChannels.AppGetDefaultCacheDirectory),
    getCacheInventory: () => ipcRenderer.invoke(IpcChannels.AppGetCacheInventory),
    setCoverCacheDirectory: (request) => ipcRenderer.invoke(IpcChannels.AppSetCoverCacheDirectory, request),
    getUpdateStatus: () => ipcRenderer.invoke(IpcChannels.AppGetUpdateStatus),
    checkForUpdates: () => ipcRenderer.invoke(IpcChannels.AppCheckForUpdates),
    downloadUpdate: () => ipcRenderer.invoke(IpcChannels.AppDownloadUpdate),
    onUpdateStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as UpdateStatus);
      };
      ipcRenderer.on(IpcChannels.AppUpdateStatusChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AppUpdateStatusChanged, listener);
    },
    openRepository: () => ipcRenderer.invoke(IpcChannels.AppOpenRepository),
    openExternalUrl: (url) => ipcRenderer.invoke(IpcChannels.AppOpenExternalUrl, url),
    showTouchKeyboard: () => ipcRenderer.invoke(IpcChannels.AppShowTouchKeyboard),
    testNetworkProxy: (patch) =>
      patch === undefined ? ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy) : ipcRenderer.invoke(IpcChannels.AppTestNetworkProxy, patch),
    getEchoProAccountStatus: (options) =>
      options === undefined
        ? ipcRenderer.invoke(IpcChannels.AppEchoProAccountGetStatus)
        : ipcRenderer.invoke(IpcChannels.AppEchoProAccountGetStatus, options),
    loginEchoProAccount: (credentials) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountLogin, credentials),
    registerEchoProAccount: (credentials) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountRegister, credentials),
    logoutEchoProAccount: () => ipcRenderer.invoke(IpcChannels.AppEchoProAccountLogout),
    redeemEchoProKey: (key) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountRedeemKey, key),
    activateEchoProPlugin: (request) => ipcRenderer.invoke(IpcChannels.AppEchoProPluginActivate, request),
    releaseEchoProDevices: (password) => ipcRenderer.invoke(IpcChannels.AppEchoProAccountReleaseDevices, password),
    getEchoProMachineCode: () => ipcRenderer.invoke(IpcChannels.AppEchoProMachineCodeGet),
    getEchoProSettingsCloudStatus: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudGetStatus),
    saveEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudSave),
    pullEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudPull),
    applyEchoProSettingsCloud: () => ipcRenderer.invoke(IpcChannels.AppEchoProSettingsCloudApply),
    validateGlobalShortcut: (accelerator) => ipcRenderer.invoke(IpcChannels.AppValidateGlobalShortcut, accelerator),
    onGlobalShortcutCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, action: unknown): void => {
        handler(action as GlobalShortcutAction);
      };
      ipcRenderer.on(IpcChannels.AppGlobalShortcutCommand, listener);
      return () => ipcRenderer.off(IpcChannels.AppGlobalShortcutCommand, listener);
    },
  };
}
