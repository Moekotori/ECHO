import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AppSettings, AutoUpdateSource } from '../../shared/types/appSettings';
import type { UpdateStatus } from '../../shared/types/updates';
import type { UpdateInstallResult } from '../../shared/types/updates';
import { getAppSettings } from './appSettings';
import { createDataProtectionSnapshot, writeDataProtectionManifest } from './dataProtection';
import { getDataBackupStatus } from './dataBackup';
import { getAudioSession } from '../audio/AudioSession';
import { getDownloadService } from '../downloads/DownloadService';
import { getLibraryService } from '../library/LibraryService';
import { hasPendingTagWrites } from '../library/TagWriter';
import { isScoopInstallation, getPortableDataPath, runScoopUpdate } from './scoopService';

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

type NsisUpdaterWithInstallDirectory = typeof autoUpdater & {
  installDirectory?: string;
};

const officialGithubFeed = {
  provider: 'github',
  owner: 'Moekotori',
  repo: 'ECHO',
} as const;

const genericUpdateFeeds: Partial<Record<AutoUpdateSource, string>> = {
  ghfast: 'https://ghfast.top/https://github.com/Moekotori/ECHO/releases/latest/download',
  ghproxyVip: 'https://ghproxy.vip/https://github.com/Moekotori/ECHO/releases/latest/download',
  ghproxyCxkpro: 'https://ghproxy.cxkpro.top/https://github.com/Moekotori/ECHO/releases/latest/download',
};

const getExecutablePath = (): string => {
  try {
    return app.getPath('exe') || process.execPath;
  } catch {
    return process.execPath;
  }
};

export const isPortableWindowsBuild = (): boolean => {
  if (process.platform !== 'win32') {
    return false;
  }
  const execPath = getExecutablePath();
  if (isScoopInstallation(execPath)) {
    return false;
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE?.trim()) {
    return true;
  }
  if (getPortableDataPath(execPath)) {
    return true;
  }
  if (app.isPackaged) {
    const installDir = dirname(execPath);
    const hasNsisUninstaller =
      existsSync(join(installDir, 'Uninstall ECHO NEXT.exe')) ||
      existsSync(join(installDir, 'Uninstall echo-next.exe')) ||
      existsSync(join(installDir, `Uninstall ${app.name}.exe`));
    if (!hasNsisUninstaller && !isScoopInstallation(execPath)) {
      return true;
    }
  }
  return false;
};

const hasPinnedWindowsUpdatePublisher = (): boolean => {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return true;
  }

  try {
    const resourcesPath = process.resourcesPath || dirname(app.getPath('exe') || process.execPath);
    const updateConfig = readFileSync(join(resourcesPath, 'app-update.yml'), 'utf8');
    return /(?:^|\r?\n)publisherName\s*:\s*(?:\S[^\r\n]*|\r?\n\s*-\s*\S)/u.test(updateConfig);
  } catch {
    return false;
  }
};

let isUpdaterInitialized = false;
let lastAttemptedScoopUpdateVersion: string | null = null;

export const resetLastAttemptedScoopUpdateVersionForTest = (): void => {
  lastAttemptedScoopUpdateVersion = null;
};

export const resetAutoUpdaterForTest = (): void => {
  isUpdaterInitialized = false;
  lastAttemptedScoopUpdateVersion = null;
  updateStatus = {
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
};
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

const isScoopUpdateSuppressed = (version: string): boolean => {
  if (!isScoopInstallation(getExecutablePath())) {
    return false;
  }
  const normalizedCandidate = version.replace(/^v/, '');
  return Boolean(lastAttemptedScoopUpdateVersion && normalizedCandidate === lastAttemptedScoopUpdateVersion);
};

const applyUpdateInfo = (updateInfo: UpdateInfo): void => {
  const isSuppressed = isScoopUpdateSuppressed(updateInfo.version);
  updateStatus = {
    ...updateStatus,
    latestVersion: formatVersion(updateInfo.version),
    releaseName: updateInfo.releaseName ?? null,
    releaseNotes: releaseNotesToText(updateInfo.releaseNotes),
    checkedAt: new Date().toISOString(),
    ...(isSuppressed ? { state: 'not-available' as const } : {}),
  };
};

const resolveGenericFeedUrl = (settings: Pick<AppSettings, 'autoUpdateSource' | 'autoUpdateCustomUrl'>): string | null => {
  if (settings.autoUpdateSource === 'custom') {
    const candidate = settings.autoUpdateCustomUrl?.trim();
    if (!candidate) {
      return null;
    }

    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' ? url.toString().replace(/\/+$/u, '') : null;
    } catch {
      return null;
    }
  }

  return genericUpdateFeeds[settings.autoUpdateSource ?? 'official'] ?? null;
};

const configureUpdateFeed = (): boolean => {
  const settings = getAppSettings();
  const genericUrl = resolveGenericFeedUrl(settings);

  if (genericUrl) {
    if (!hasPinnedWindowsUpdatePublisher()) {
      updateStatus = {
        ...updateStatus,
        state: 'error',
        error: 'Third-party update sources require a signed release with a pinned Windows publisher.',
        checkedAt: new Date().toISOString(),
      };
      emitUpdateStatus();
      return false;
    }
    autoUpdater.setFeedURL({ provider: 'generic', url: genericUrl });
    return true;
  }

  if (settings.autoUpdateSource === 'custom') {
    updateStatus = {
      ...updateStatus,
      state: 'error',
      error: 'Custom update source URL is empty or invalid.',
      checkedAt: new Date().toISOString(),
    };
    emitUpdateStatus();
    return false;
  }

  autoUpdater.setFeedURL(officialGithubFeed);
  return true;
};

const configureWindowsInstallDirectory = (): void => {
  if (process.platform !== 'win32' || !app.isPackaged || isPortableWindowsBuild()) {
    return;
  }

  const executablePath = app.getPath('exe') || process.execPath;
  const installDirectory = dirname(executablePath);
  if (!installDirectory) {
    return;
  }

  (autoUpdater as NsisUpdaterWithInstallDirectory).installDirectory = installDirectory;
};

export const getUpdateStatus = (): UpdateStatus => ({
  ...updateStatus,
  currentVersion: currentVersion(),
});

export const setAutoUpdateEnabled = (enabled: boolean): UpdateStatus => {
  const effectiveEnabled = enabled && !isPortableWindowsBuild();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (!effectiveEnabled) {
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

  if (!configureUpdateFeed()) {
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

export const downloadUpdate = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged || isPortableWindowsBuild()) {
    return getUpdateStatus();
  }
  if (updateStatus.state !== 'available') {
    return getUpdateStatus();
  }

  if (isScoopInstallation(getExecutablePath())) {
    updateStatus = {
      ...updateStatus,
      state: 'downloaded',
      downloadPercent: 100,
      error: null,
    };
    emitUpdateStatus();
    return getUpdateStatus();
  }

  updateStatus = {
    ...updateStatus,
    state: 'downloading',
    downloadPercent: updateStatus.downloadPercent ?? 0,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    error: null,
  };
  emitUpdateStatus();

  try {
    await autoUpdater.downloadUpdate();
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

export const reconfigureAutoUpdateFeed = (): UpdateStatus => {
  if (isPortableWindowsBuild()) {
    return getUpdateStatus();
  }
  configureUpdateFeed();
  emitUpdateStatus();
  return getUpdateStatus();
};

const activeDownloadStates = new Set(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);

export const installDownloadedUpdate = async (): Promise<UpdateInstallResult> => {
  if (isPortableWindowsBuild()) {
    return { outcome: 'error', error: 'Portable builds use manual updates.' };
  }

  const isScoop = isScoopInstallation(getExecutablePath());

  if (updateStatus.state !== 'downloaded' && (!isScoop || updateStatus.state !== 'available')) {
    return { outcome: 'error', error: 'No downloaded update is ready to install.' };
  }

  const reasons: string[] = [];
  const playbackState = getAudioSession().getStatus().state;
  if (playbackState === 'playing' || playbackState === 'loading') reasons.push('playback');
  if (getDownloadService().getJobs().some((job) => activeDownloadStates.has(job.status))) reasons.push('downloads');
  if (getLibraryService().hasRunningJobs()) reasons.push('library-scan');
  if (hasPendingTagWrites()) reasons.push('tag-writes');
  if (getDataBackupStatus().running) reasons.push('data-backup');
  if (reasons.length > 0) return { outcome: 'blocked', reasons };

  try {
    if (getAppSettings().dataProtectionDisabled !== true) {
      writeDataProtectionManifest();
      await createDataProtectionSnapshot('update-install');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[data-protection] update install blocked because the protected-data snapshot failed', error);
    return { outcome: 'error', error: `Protected-data snapshot failed: ${message}` };
  }

  if (isScoop) {
    lastAttemptedScoopUpdateVersion = updateStatus.latestVersion?.replace(/^v/, '') ?? null;
    const launched = runScoopUpdate();
    if (!launched) {
      return { outcome: 'error', error: 'Failed to launch Scoop updater.' };
    }
    app.quit();
    return { outcome: 'installing' };
  }

  configureWindowsInstallDirectory();
  autoUpdater.quitAndInstall();
  return { outcome: 'installing' };
};

export const initializeAutoUpdater = (enabled: boolean): void => {
  if (isUpdaterInitialized) {
    return;
  }

  isUpdaterInitialized = true;
  setAutoUpdateEnabled(enabled);
  configureWindowsInstallDirectory();
  if (enabled && !isPortableWindowsBuild()) {
    configureUpdateFeed();
  }

  autoUpdater.on('checking-for-update', () => {
    updateStatus = { ...updateStatus, state: 'checking', error: null };
    emitUpdateStatus();
  });

  autoUpdater.on('update-available', (updateInfo) => {
    applyUpdateInfo(updateInfo);
    if (isScoopUpdateSuppressed(updateInfo.version)) {
      emitUpdateStatus();
      return;
    }
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
    updateStatus = {
      ...updateStatus,
      state: 'downloaded',
      downloadPercent: 100,
      transferredBytes: updateStatus.totalBytes,
      error: null,
    };
    emitUpdateStatus();
  });

  if (!app.isPackaged) {
    if (process.env.ECHO_VERBOSE_APP_LOGS === '1') {
      console.info('[auto-updater] skipped update check outside packaged builds');
    }
    return;
  }

  if (enabled && !isPortableWindowsBuild()) {
    void checkForUpdates();
  }
};
