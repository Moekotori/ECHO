import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { DownloadJob } from '../../shared/types/downloads';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const handleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler;
});
const showOpenDialogMock = vi.fn();
const getAppSettingsMock = vi.fn(() => ({ downloadsFeatureUnlocked: false }));
const downloadUnlockStatusMock = vi.fn(() => ({ unlocked: false }));
const downloadUnlockAssertMock = vi.fn<() => unknown>(() => {
  throw new Error('downloads_plugin_unlock_required');
});
const searchMock = vi.fn(async () => ({ results: [], errors: [] }));
const createUrlJobMock = vi.fn((url: string, _options?: Record<string, unknown>): DownloadJob => ({
  id: 'job-osu',
  sourceUrl: url,
  provider: 'osu',
  audioStrategy: 'best_available',
  status: 'queued',
  title: null,
  durationSeconds: null,
  thumbnailUrl: null,
  webpageUrl: url,
  outputPath: null,
  downloadedBytes: null,
  totalBytes: null,
  speedBytesPerSecond: null,
  etaSeconds: null,
  importedTrackId: null,
  progress: 0,
  error: null,
  createdAt: '2026-06-21T00:00:00.000Z',
  updatedAt: '2026-06-21T00:00:00.000Z',
  completedAt: null,
}));

const downloadServiceMock = {
  on: vi.fn(),
  getJobs: vi.fn(() => []),
  createUrlJob: createUrlJobMock,
  cancelJob: vi.fn(() => null),
  clearCompleted: vi.fn(() => []),
  getSettings: vi.fn(() => ({
    audioStrategy: 'best_available',
    importToLibrary: true,
    bindMvAfterImport: false,
    outputDirectory: 'D:\\test',
    osuOutputDirectory: 'D:\\osu',
    osuDownloadMirror: 'auto',
  })),
  setSettings: vi.fn((patch: Record<string, unknown>) => ({
    audioStrategy: 'best_available',
    importToLibrary: true,
    bindMvAfterImport: false,
    outputDirectory: typeof patch.outputDirectory === 'string' ? patch.outputDirectory : 'D:\\test',
    osuOutputDirectory: typeof patch.osuOutputDirectory === 'string' ? patch.osuOutputDirectory : 'D:\\osu',
    osuDownloadMirror: typeof patch.osuDownloadMirror === 'string' ? patch.osuDownloadMirror : 'auto',
  })),
  search: searchMock,
  checkTools: vi.fn(async () => ({
    ytDlpAvailable: false,
    ytDlpPath: null,
    ytDlpVersion: null,
    ffmpegAvailable: true,
    ffmpegPath: 'ffmpeg',
  })),
};

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../diagnostics/PlaybackPerformanceDiagnostics', () => ({
  beginMainBackgroundTask: vi.fn(() => () => undefined),
}));

vi.mock('../downloads/DownloadService', () => ({
  getDownloadService: () => downloadServiceMock,
}));

vi.mock('../plugins/DownloadFeatureUnlockService', () => ({
  getDownloadFeatureUnlockService: () => ({
    getStatus: downloadUnlockStatusMock,
    assertUnlocked: downloadUnlockAssertMock,
  }),
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: getAppSettingsMock,
}));

describe('downloads IPC osu downloader gate', () => {
  beforeEach(async () => {
    for (const key of Object.keys(handlers)) {
      delete handlers[key];
    }
    vi.clearAllMocks();
    getAppSettingsMock.mockReturnValue({ downloadsFeatureUnlocked: false });
    downloadUnlockStatusMock.mockReturnValue({ unlocked: false });

    const module = await import('./downloadsIpc');
    module.registerDownloadsIpc();
  });

  it('allows osu searches without the downloads unlock plugin', async () => {
    await expect(
      handlers[IpcChannels.DownloadsSearch]?.({}, { query: 'a hisa', provider: 'osu', providerLock: 'osu' }),
    ).resolves.toEqual({ results: [], errors: [] });

    expect(downloadUnlockAssertMock).not.toHaveBeenCalled();
    expect(searchMock).toHaveBeenCalledWith({ query: 'a hisa', provider: 'osu', providerLock: 'osu' });
  });

  it('allows osu beatmapset URL jobs without the downloads unlock plugin', () => {
    const job = handlers[IpcChannels.DownloadsCreateUrlJob]?.(
      {},
      'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400',
      { providerLock: 'osu' },
    );

    expect(downloadUnlockAssertMock).not.toHaveBeenCalled();
    expect(createUrlJobMock).toHaveBeenCalledWith(
      'https://osu.ppy.sh/beatmapsets/2492872#osu/5477400',
      { providerLock: 'osu' },
    );
    expect(job).toEqual(expect.objectContaining({ provider: 'osu' }));
  });

  it('rejects non-osu searches from the osu downloader gate', () => {
    expect(() =>
      handlers[IpcChannels.DownloadsSearch]?.({}, { query: 'video', provider: 'youtube', providerLock: 'osu' }),
    ).toThrow('osu_downloader_only_supports_osu_search');

    expect(downloadUnlockAssertMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('rejects non-osu URLs from the osu downloader gate', () => {
    expect(() =>
      handlers[IpcChannels.DownloadsCreateUrlJob]?.({}, 'https://www.youtube.com/watch?v=probe', { providerLock: 'osu' }),
    ).toThrow('osu_downloader_only_supports_beatmapset_links');

    expect(downloadUnlockAssertMock).not.toHaveBeenCalled();
    expect(createUrlJobMock).not.toHaveBeenCalled();
  });

  it('keeps the downloads unlock requirement for non-osu download requests', () => {
    expect(() =>
      handlers[IpcChannels.DownloadsCreateUrlJob]?.({}, 'https://www.youtube.com/watch?v=probe', {}),
    ).toThrow('echo_authorization_required');

    expect(downloadUnlockAssertMock).toHaveBeenCalledTimes(1);
    expect(createUrlJobMock).not.toHaveBeenCalled();
  });

  it('requires the hidden key even when the downloads entitlement is valid', () => {
    downloadUnlockStatusMock.mockReturnValue({ unlocked: true });
    downloadUnlockAssertMock.mockReturnValue({ unlocked: true });
    getAppSettingsMock.mockReturnValue({ downloadsFeatureUnlocked: false });

    expect(() =>
      handlers[IpcChannels.DownloadsCreateUrlJob]?.({}, 'https://www.youtube.com/watch?v=probe', {}),
    ).toThrow('echo_authorization_required');

    expect(createUrlJobMock).not.toHaveBeenCalled();
  });

  it('allows non-osu downloads only after entitlement and hidden key are both valid', () => {
    downloadUnlockStatusMock.mockReturnValue({ unlocked: true });
    downloadUnlockAssertMock.mockReturnValue({ unlocked: true });
    getAppSettingsMock.mockReturnValue({ downloadsFeatureUnlocked: true });

    const job = handlers[IpcChannels.DownloadsCreateUrlJob]?.({}, 'https://www.youtube.com/watch?v=probe', {});

    expect(createUrlJobMock).toHaveBeenCalledWith('https://www.youtube.com/watch?v=probe', {});
    expect(job).toEqual(expect.objectContaining({ sourceUrl: 'https://www.youtube.com/watch?v=probe' }));
  });
});
