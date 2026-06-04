import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { UpdateStatus } from '../../shared/types/updates';
import { getAppSettings } from './appSettings';
import { createDataProtectionSnapshot, writeDataProtectionManifest } from './dataProtection';

const { autoUpdater } = electronUpdater;

type ReleaseNoteInfo = {
  version?: string;
  note?: string | null;
};

type DownloadProgressInfo = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

let isUpdaterInitialized = false;
const formatVersion = (version: string): string => (version.startsWith('v') ? version : `v${version}`);
const currentVersion = (): string => formatVersion(app.getVersion());

let updateStatus: UpdateStatus = {
  state: 'idle',
  currentVersion: currentVersion(),
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  downloadPercent: null,
  transferredBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
  error: null,
  checkedAt: null,
};

const emitUpdateStatus = (): void => {
  const status = getUpdateStatus();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.AppUpdateStatusChanged, status);
    }
  }
};

const releaseNotesToText = (releaseNotes: string | ReleaseNoteInfo[] | null | undefined): string | null => {
  if (typeof releaseNotes === 'string') {
    return releaseNotes.trim() || null;
  }

  if (!Array.isArray(releaseNotes)) {
    return null;
  }

  return (
    releaseNotes
      .map((note) => [note.version ? formatVersion(note.version) : null, note.note].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n')
      .trim() || null
  );
};

const applyUpdateInfo = (updateInfo: UpdateInfo): void => {
  updateStatus = {
    ...updateStatus,
    latestVersion: formatVersion(updateInfo.version),
    releaseName: updateInfo.releaseName ?? null,
    releaseNotes: releaseNotesToText(updateInfo.releaseNotes),
    checkedAt: new Date().toISOString(),
  };
};

export const getUpdateStatus = (): UpdateStatus => ({
  ...updateStatus,
  currentVersion: currentVersion(),
});

export const setAutoUpdateEnabled = (enabled: boolean): UpdateStatus => {
  if (!enabled) {
    updateStatus = {
      ...updateStatus,
      state: 'disabled',
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      error: null,
    };
  } else if (updateStatus.state === 'disabled') {
    updateStatus = {
      ...updateStatus,
      state: 'idle',
      error: null,
    };
  }

  emitUpdateStatus();
  return getUpdateStatus();
};

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (updateStatus.state === 'disabled') {
    return getUpdateStatus();
  }

  if (!app.isPackaged) {
    updateStatus = {
      ...updateStatus,
      state: 'not-available',
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      error: null,
      checkedAt: new Date().toISOString(),
    };
    emitUpdateStatus();
    return getUpdateStatus();
  }

  updateStatus = {
    ...updateStatus,
    state: 'checking',
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    error: null,
  };
  emitUpdateStatus();

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateStatus = {
      ...updateStatus,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
    emitUpdateStatus();
  }

  return getUpdateStatus();
};

export const initializeAutoUpdater = (enabled: boolean): void => {
  if (isUpdaterInitialized) {
    return;
  }

  isUpdaterInitialized = true;
  setAutoUpdateEnabled(enabled);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateStatus = { ...updateStatus, state: 'checking', error: null };
    emitUpdateStatus();
  });

  autoUpdater.on('update-available', (updateInfo) => {
    applyUpdateInfo(updateInfo);
    updateStatus = {
      ...updateStatus,
      state: 'available',
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      error: null,
    };
    emitUpdateStatus();
  });

  autoUpdater.on('download-progress', (progressInfo: DownloadProgressInfo) => {
    updateStatus = {
      ...updateStatus,
      state: 'downloading',
      downloadPercent: Math.max(0, Math.min(100, progressInfo.percent ?? 0)),
      transferredBytes: Number.isFinite(progressInfo.transferred) ? progressInfo.transferred ?? null : null,
      totalBytes: Number.isFinite(progressInfo.total) ? progressInfo.total ?? null : null,
      bytesPerSecond: Number.isFinite(progressInfo.bytesPerSecond) ? progressInfo.bytesPerSecond ?? null : null,
      error: null,
    };
    emitUpdateStatus();
  });

  autoUpdater.on('update-not-available', (updateInfo) => {
    applyUpdateInfo(updateInfo);
    updateStatus = {
      ...updateStatus,
      state: 'not-available',
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      error: null,
    };
    emitUpdateStatus();
  });

  autoUpdater.on('error', (error) => {
    updateStatus = {
      ...updateStatus,
      state: 'error',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
    emitUpdateStatus();
    console.warn('[auto-updater] update check failed', error);
  });

  autoUpdater.on('update-downloaded', (updateInfo) => {
    applyUpdateInfo(updateInfo);
    void (async () => {
      try {
        if (getAppSettings().dataProtectionDisabled !== true) {
          writeDataProtectionManifest();
          await createDataProtectionSnapshot('update-install');
        }
      } catch (error) {
        console.warn('[data-protection] failed to snapshot protected data before update install', error);
      }
      updateStatus = {
        ...updateStatus,
        state: 'downloaded',
        downloadPercent: 100,
        transferredBytes: updateStatus.totalBytes,
        error: null,
      };
      emitUpdateStatus();
      setTimeout(() => {
        autoUpdater.quitAndInstall();
      }, 1000);
    })();
  });

  if (!app.isPackaged) {
    if (process.env.ECHO_VERBOSE_APP_LOGS === '1') {
      console.info('[auto-updater] skipped update check outside packaged builds');
    }
    return;
  }

  if (enabled) {
    void checkForUpdates();
  }
};
