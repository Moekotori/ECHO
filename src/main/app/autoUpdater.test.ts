import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    removeAllListeners: () => listeners.clear(),
  } as Record<string, any>;
  Object.assign(updater, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  });
  return {
    updater,
    send: vi.fn(),
    snapshot: vi.fn(),
    readFileSync: vi.fn(() => 'publisherName:\n  - ECHO Release Publisher\n'),
    playbackState: { value: 'idle' },
    settings: { autoUpdateSource: 'official', autoUpdateCustomUrl: null } as {
      autoUpdateSource: 'official' | 'custom';
      autoUpdateCustomUrl: string | null;
    },
  };
});

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true, getPath: () => 'C:\\ECHO\\ECHO.exe' },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] },
}));
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }));
vi.mock('./appSettings', () => ({ getAppSettings: () => mocks.settings }));
vi.mock('./dataProtection', () => ({ createDataProtectionSnapshot: mocks.snapshot, writeDataProtectionManifest: vi.fn() }));
vi.mock('./dataBackup', () => ({ getDataBackupStatus: () => ({ running: false }) }));
vi.mock('../audio/AudioSession', () => ({ getAudioSession: () => ({ getStatus: () => ({ state: mocks.playbackState.value }) }) }));
vi.mock('../downloads/DownloadService', () => ({ getDownloadService: () => ({ getJobs: () => [] }) }));
vi.mock('../library/LibraryService', () => ({ getLibraryService: () => ({ hasRunningJobs: () => false }) }));
vi.mock('../library/TagWriter', () => ({ hasPendingTagWrites: () => false }));

describe('auto updater download completion', () => {
  beforeEach(() => {
    mocks.updater.removeAllListeners();
    vi.clearAllMocks();
    mocks.playbackState.value = 'idle';
    mocks.snapshot.mockResolvedValue({});
    mocks.settings.autoUpdateSource = 'official';
    mocks.settings.autoUpdateCustomUrl = null;
    mocks.readFileSync.mockReturnValue('publisherName:\n  - ECHO Release Publisher\n');
    delete process.env.PORTABLE_EXECUTABLE_FILE;
  });

  it('never calls quitAndInstall when update-downloaded fires', async () => {
    const { initializeAutoUpdater, getUpdateStatus } = await import('./autoUpdater');
    initializeAutoUpdater(true);

    expect(mocks.updater.autoInstallOnAppQuit).toBe(false);

    mocks.updater.emit('update-available', { version: '2.0.0', releaseName: '2.0.0' });
    await Promise.resolve();

    expect(mocks.updater.autoDownload).toBe(false);
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toMatchObject({ state: 'available', latestVersion: 'v2.0.0' });

    mocks.updater.emit('update-downloaded', { version: '2.0.0', releaseName: '2.0.0' });
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toMatchObject({ state: 'downloaded', latestVersion: 'v2.0.0' });
  });

  it('blocks immediate installation when busy or when the safety snapshot fails', async () => {
    const { installDownloadedUpdate } = await import('./autoUpdater');

    mocks.playbackState.value = 'playing';
    await expect(installDownloadedUpdate()).resolves.toEqual({ outcome: 'blocked', reasons: ['playback'] });
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();

    mocks.playbackState.value = 'idle';
    mocks.snapshot.mockRejectedValueOnce(new Error('disk full'));
    await expect(installDownloadedUpdate()).resolves.toEqual({
      outcome: 'error',
      error: 'Protected-data snapshot failed: disk full',
    });
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('rejects HTTP custom feeds and accepts HTTPS custom feeds', async () => {
    const { reconfigureAutoUpdateFeed, getUpdateStatus } = await import('./autoUpdater');

    mocks.settings.autoUpdateSource = 'custom';
    mocks.settings.autoUpdateCustomUrl = 'http://updates.example.com/releases';
    reconfigureAutoUpdateFeed();

    expect(mocks.updater.setFeedURL).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toMatchObject({ state: 'error', error: 'Custom update source URL is empty or invalid.' });

    mocks.settings.autoUpdateCustomUrl = 'https://updates.example.com/releases/';
    reconfigureAutoUpdateFeed();

    expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://updates.example.com/releases',
    });
  });

  it('blocks third-party feeds when the packaged release has no pinned publisher', async () => {
    const { reconfigureAutoUpdateFeed, getUpdateStatus } = await import('./autoUpdater');
    mocks.settings.autoUpdateSource = 'custom';
    mocks.settings.autoUpdateCustomUrl = 'https://updates.example.com/releases';
    mocks.readFileSync.mockReturnValue('provider: github\n');

    reconfigureAutoUpdateFeed();

    expect(mocks.updater.setFeedURL).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toMatchObject({
      state: 'error',
      error: 'Third-party update sources require a signed release with a pinned Windows publisher.',
    });
  });

  it('disables automatic installation in portable builds', async () => {
    const { checkForUpdates, getUpdateStatus, isPortableWindowsBuild, setAutoUpdateEnabled } = await import('./autoUpdater');
    process.env.PORTABLE_EXECUTABLE_FILE = 'D:\\Portable\\ECHO-NEXT-Portable.exe';

    expect(isPortableWindowsBuild()).toBe(true);
    expect(setAutoUpdateEnabled(true)).toMatchObject({ state: 'disabled', error: null });
    await checkForUpdates();

    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toMatchObject({ state: 'disabled' });
  });
});
