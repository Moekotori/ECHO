import { app, BrowserWindow, dialog } from 'electron';
import { createMainWindow } from './createMainWindow';
import { requestAppQuit } from './tray';
import { getMainWindow } from './windowManager';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { registerAudioProtocolHandler } from '../protocol/audioProtocol';
import { registerCoverProtocolHandler } from '../protocol/coverProtocol';
import { registerVideoProtocolHandler } from '../protocol/videoProtocol';
import { disposeSmtcIntegration, initializeSmtcIntegration } from '../integrations/smtc/SmtcStatusSync';
import { disposeDiscordPresenceIntegration, initializeDiscordPresenceIntegration } from '../integrations/discord/DiscordPresenceStatusSync';
import { disposeLastFmIntegration, initializeLastFmIntegration } from '../integrations/lastfm/LastFmStatusSync';
import { savePlaybackMemoryNow } from '../ipc/playbackIpc';
import { dispatchLocalAudioFilesOpened, parseLocalAudioFileArguments } from './localFileOpen';
import { initializeAutoUpdater } from './autoUpdater';
import { getAppSettings } from './appSettings';
import { disposeDataBackupScheduler, initializeDataBackupScheduler } from './dataBackup';
import {
  createDataProtectionDisabledResult,
  ensureDataProtectionStartup,
  getLibraryDatabaseStartupMetrics,
  runDeferredStartupDataProtection,
} from './dataProtection';
import { disposeBackgroundPlaybackShortcuts, initializeBackgroundPlaybackShortcuts } from './backgroundPlaybackShortcuts';
import { getAccountService } from '../accounts/AccountService';
import { disposeAirPlayReceiverSpikeService } from '../connect/AirPlayReceiverSpikeService';
import { disposeConnectReceiverService } from '../connect/ConnectReceiverService';
import { disposeConnectService } from '../connect/ConnectService';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AccountStatus } from '../../shared/types/accounts';
import { closeDefaultLibraryService } from '../library/LibraryService';
import { closeDefaultRemoteSourceService } from '../library/remote/RemoteSourceService';
import { closeDefaultLyricsService } from '../lyrics/LyricsService';
import { closeDefaultMvService } from '../mv/MvService';
import { closeDefaultStreamingService } from '../streaming/StreamingService';
import { disposeDefaultAudioSessionGracefully } from '../audio/AudioSession';
import { closeDefaultLibraryDatabaseManager, getLibraryDatabaseManager } from '../database/LibraryDatabaseManager';
import { getSleepTimerService } from '../sleepTimer/SleepTimerService';
import { isLibraryRecoveryMode } from './libraryRecoveryMode';
import { applyNetworkProxySettings } from '../network/proxySettings';
import { markStartupStage, openSafeModeStartupConsoleIfEnabled } from '../diagnostics/StartupDiagnostics';
import { closeDevConsoleWindow } from '../diagnostics/DevConsoleService';
import { closeDesktopLyricsWindow, restoreDesktopLyricsWindowOnStartup } from './desktopLyricsWindow';
import { closeMiniPlayerWindow, restoreMiniPlayerWindowOnStartup } from './miniPlayerWindow';

const sendAccountStatusesChanged = (statuses: AccountStatus[]): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    const send = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannels.AccountStatusesChanged, statuses);
      }
    };

    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  }
};

const refreshPreviouslyLoggedInAccountsOnStartup = async (): Promise<void> => {
  const statuses = await getAccountService().checkPreviouslyLoggedInAccounts();
  const disconnectedStatuses = statuses.filter((status) => !status.connected && Boolean(status.error));

  if (disconnectedStatuses.length > 0) {
    sendAccountStatusesChanged(disconnectedStatuses);
  }
};

const notifyLibraryDatabaseProtected = (): void => {
  void dialog.showMessageBox({
    type: 'warning',
    title: '曲库数据库进入保护模式',
    message: 'ECHO Next 检测到音乐库数据库未通过健康检查，已先归档副本并停止继续写入。',
    detail: '你的音乐文件不会被删除。请打开设置里的数据库恢复工具，选择恢复健康快照或归档后重建曲库索引。',
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true,
  });
};

const notifyLibraryRecoveryMode = (): void => {
  void dialog.showMessageBox({
    type: 'info',
    title: '曲库恢复模式',
    message: 'ECHO Next 已进入曲库恢复模式。',
    detail: '本次启动会跳过播放集成、账号检查、自动更新和后台服务，避免它们占用曲库数据库。请在设置的数据库恢复工具里执行修复、归档或健康检查。',
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true,
  });
};

const deferredStartupDataProtectionDelayMs = 10_000;

const scheduleDeferredStartupDataProtection = (userDataPath: string, window: BrowserWindow): void => {
  if (window.isDestroyed()) {
    markStartupStage('data-protection:background:skipped', { reason: 'window-destroyed' });
    return;
  }

  let timer: NodeJS.Timeout | null = null;
  let completed = false;

  const clearDeferredTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const markWindowDestroyedSkip = (): void => {
    if (completed) {
      return;
    }
    clearDeferredTimer();
    completed = true;
    markStartupStage('data-protection:background:skipped', { reason: 'window-destroyed' });
  };

  const startDeferredTimer = (): void => {
    if (completed || window.isDestroyed()) {
      markWindowDestroyedSkip();
      return;
    }

    markStartupStage('data-protection:background:scheduled', { delayMs: deferredStartupDataProtectionDelayMs });
    timer = setTimeout(() => {
      timer = null;
      if (window.isDestroyed()) {
        markWindowDestroyedSkip();
        return;
      }

      markStartupStage('data-protection:background:start');
      void runDeferredStartupDataProtection('startup', userDataPath)
        .then((result) => {
          completed = true;
          markStartupStage('data-protection:background:complete', {
            libraryHealth: result.libraryHealth.status,
            recoveryAction: result.recovery.action,
            backupMethod: result.snapshot.libraryBackupMethod,
            snapshotPath: result.snapshot.snapshotPath,
          });
          if (
            result.recovery.action === 'protected' ||
            result.recovery.action === 'archivedOnly' ||
            result.recovery.action === 'quarantined'
          ) {
            notifyLibraryDatabaseProtected();
            markStartupStage('library-protection:dialog-scheduled', { recoveryAction: result.recovery.action });
          }
        })
        .catch((error) => {
          completed = true;
          markStartupStage('data-protection:background:failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          getCrashReportService().getLogger()?.warn('main', '[Lifecycle] deferred startup data protection failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, deferredStartupDataProtectionDelayMs);
  };

  window.once('closed', markWindowDestroyedSkip);
  if (window.isVisible()) {
    startDeferredTimer();
  } else {
    window.once('ready-to-show', startDeferredTimer);
  }
};

export const registerAppLifecycle = (): void => {
  const libraryRecoveryMode = isLibraryRecoveryMode();

  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  if (process.platform === 'win32') {
    app.setAppUserModelId('app.echo.next');
  }

  const allowParallelInstance = process.env.ECHO_ALLOW_PARALLEL_INSTANCE === '1';
  const hasSingleInstanceLock = allowParallelInstance || app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, argv) => {
    let window = getMainWindow();
    if (window === null) {
      window = createMainWindow();
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
    if (libraryRecoveryMode || isLibraryRecoveryMode(argv)) {
      return;
    }
    dispatchLocalAudioFilesOpened(parseLocalAudioFileArguments(argv));
  });

  app.whenReady().then(async () => {
    markStartupStage('electron:app-ready');
    const appSettings = getAppSettings();
    markStartupStage('settings:loaded', { safeModeEnabled: appSettings.safeModeEnabled === true });
    openSafeModeStartupConsoleIfEnabled(appSettings, {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      userDataPath: app.getPath('userData'),
    });

    markStartupStage('diagnostics:init:start');
    getCrashReportService().initialize();
    markStartupStage('diagnostics:init:complete');
    const dataProtectionDisabled = appSettings.dataProtectionDisabled === true;
    markStartupStage(dataProtectionDisabled ? 'data-protection:startup:skipped' : 'data-protection:startup:start', {
      reason: dataProtectionDisabled ? 'disabled-by-setting' : undefined,
    });
    const dataProtection = dataProtectionDisabled
      ? createDataProtectionDisabledResult()
      : await ensureDataProtectionStartup('startup');
    const startupDataProtectionMetrics = getLibraryDatabaseStartupMetrics(dataProtection.userDataPath, { includeSnapshotCount: false });
    markStartupStage(dataProtectionDisabled ? 'data-protection:startup:disabled' : 'data-protection:startup:complete', {
      libraryHealth: dataProtection.libraryHealth.status,
      recoveryAction: dataProtection.recovery.action,
      fullProtection: dataProtectionDisabled ? 'disabled-by-setting' : libraryRecoveryMode ? 'skipped-recovery-mode' : 'deferred-background',
      fastStartupSetting: appSettings.fastStartupEnabled === true,
      ...startupDataProtectionMetrics,
    });
    markStartupStage('network-proxy:apply:start');
    await applyNetworkProxySettings(appSettings).then(() => {
      markStartupStage('network-proxy:apply:complete', { mode: appSettings.networkProxyMode ?? 'off' });
    }).catch((error) => {
      markStartupStage('network-proxy:apply:failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      getCrashReportService().getLogger()?.warn('main', '[Lifecycle] failed to apply network proxy settings', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    markStartupStage('protocols:register:start');
    registerAudioProtocolHandler();
    registerCoverProtocolHandler();
    registerVideoProtocolHandler();
    markStartupStage('protocols:register:complete');
    markStartupStage('startup-integrations:init:start', {
      libraryRecoveryMode,
      libraryHealth: dataProtection.libraryHealth.status,
    });
    if (dataProtection.libraryHealth.status === 'ok' && !libraryRecoveryMode) {
      void initializeSmtcIntegration();
      initializeLastFmIntegration();
      void initializeDiscordPresenceIntegration();
      markStartupStage('startup-integrations:init:scheduled', { smtc: true, lastfm: true, discord: true });
    } else if (libraryRecoveryMode) {
      getCrashReportService().getLogger()?.info?.('main', '[Lifecycle] library recovery mode is active; skipping library-backed startup integrations');
      markStartupStage('startup-integrations:init:skipped', { reason: 'library-recovery-mode' });
    } else {
      getCrashReportService().getLogger()?.warn('main', '[Lifecycle] library database is unhealthy; starting without library-backed integrations', {
        status: dataProtection.libraryHealth.status,
        error: dataProtection.libraryHealth.message,
      });
      markStartupStage('startup-integrations:init:skipped', {
        reason: 'library-database-unhealthy',
        status: dataProtection.libraryHealth.status,
      });
    }
    markStartupStage('main-window:create:request');
    const mainWindow = createMainWindow();
    markStartupStage('main-window:create:returned');
    if (!libraryRecoveryMode && !dataProtectionDisabled) {
      scheduleDeferredStartupDataProtection(dataProtection.userDataPath, mainWindow);
    } else if (dataProtectionDisabled) {
      markStartupStage('data-protection:background:skipped', { reason: 'disabled-by-setting' });
    }
    restoreDesktopLyricsWindowOnStartup();
    restoreMiniPlayerWindowOnStartup();
    if (libraryRecoveryMode) {
      notifyLibraryRecoveryMode();
      markStartupStage('library-recovery:dialog-scheduled');
    }
    if (
      dataProtection.recovery.action === 'protected' ||
      dataProtection.recovery.action === 'archivedOnly' ||
      dataProtection.recovery.action === 'quarantined'
    ) {
      notifyLibraryDatabaseProtected();
      markStartupStage('library-protection:dialog-scheduled', { recoveryAction: dataProtection.recovery.action });
    }
    if (libraryRecoveryMode) {
      app.on('activate', () => {
        if (getMainWindow() === null) {
          createMainWindow();
        }
      });
      markStartupStage('startup:ready', { mode: 'library-recovery' });
      return;
    }

    initializeBackgroundPlaybackShortcuts();
    markStartupStage('background-shortcuts:initialized');
    if (appSettings.autoAccountCheckOnStartup !== false) {
      markStartupStage('accounts:startup-check:scheduled');
      void refreshPreviouslyLoggedInAccountsOnStartup().catch(() => undefined);
    } else {
      markStartupStage('accounts:startup-check:skipped');
    }
    initializeAutoUpdater(appSettings.autoUpdateEnabled !== false);
    markStartupStage('auto-updater:initialized', { enabled: appSettings.autoUpdateEnabled !== false });
    initializeDataBackupScheduler();
    markStartupStage('data-backup:scheduler-initialized');
    dispatchLocalAudioFilesOpened(parseLocalAudioFileArguments(process.argv));
    markStartupStage('local-files:startup-arguments-dispatched');

    app.on('activate', () => {
      if (getMainWindow() === null) {
        createMainWindow();
      }
    });
    markStartupStage('startup:ready', { mode: 'normal' });
  }).catch((error) => {
    markStartupStage('startup:failed', { error: error instanceof Error ? error.message : String(error) });
    getCrashReportService().getLogger()?.warn('main', '[Lifecycle] startup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    createMainWindow();
  });

  let gracefulQuitInProgress = false;
  let gracefulQuitCompleted = false;

  const cleanupBeforeQuit = async (): Promise<void> => {
    closeDevConsoleWindow();
    closeDesktopLyricsWindow();
    closeMiniPlayerWindow();
    savePlaybackMemoryNow();
    disposeLastFmIntegration();
    disposeDiscordPresenceIntegration();
    await disposeAirPlayReceiverSpikeService();
    await disposeConnectReceiverService();
    await disposeConnectService();
    await disposeSmtcIntegration();
    await disposeDefaultAudioSessionGracefully('app-quit');
    getSleepTimerService().dispose();
    disposeDataBackupScheduler();
    disposeBackgroundPlaybackShortcuts();
    closeDefaultLyricsService();
    closeDefaultMvService();
    closeDefaultStreamingService();
    closeDefaultRemoteSourceService();
    closeDefaultLibraryService();
    const manager = getLibraryDatabaseManager();
    manager.closeAllUsers('app-quit');
    const checkpoint = manager.checkpoint('app-quit');
    if (checkpoint.status !== 'ok') {
      getCrashReportService().getLogger()?.warn('main', '[Lifecycle] library WAL checkpoint failed during shutdown', {
        status: checkpoint.status,
        error: checkpoint.message,
      });
    }
    closeDefaultLibraryDatabaseManager();
    getCrashReportService().closeSession();
    requestAppQuit();
  };

  const cleanupBeforeQuitWithTimeout = async (): Promise<void> => {
    let timeout: NodeJS.Timeout | null = null;
    let timedOut = false;
    try {
      await Promise.race([
        cleanupBeforeQuit(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true;
            resolve();
          }, 2000);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        getCrashReportService().getLogger()?.warn('main', '[Lifecycle] graceful shutdown cleanup timed out');
      }
    }
  };

  app.on('before-quit', (event) => {
    if (gracefulQuitCompleted) {
      return;
    }

    event.preventDefault();
    getCrashReportService().markShutdownRequested();
    if (gracefulQuitInProgress) {
      return;
    }

    gracefulQuitInProgress = true;
    void cleanupBeforeQuitWithTimeout()
      .catch((error) => {
        getCrashReportService().getLogger()?.warn('main', '[Lifecycle] graceful shutdown cleanup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        gracefulQuitCompleted = true;
        app.quit();
      });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};
