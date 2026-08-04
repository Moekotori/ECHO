import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadSearchRequest,
  DownloadSearchResponse,
  DownloadSettings,
  DownloadToolsStatus,
} from '../../shared/types/downloads';
import { beginMainBackgroundTask } from '../diagnostics/PlaybackPerformanceDiagnostics';
import { getDownloadService } from '../downloads/DownloadService';
import { getAppSettings } from '../app/appSettings';
import { getDownloadFeatureUnlockService } from '../plugins/DownloadFeatureUnlockService';
import { requireSyncMainFeatureThen } from './entitlementIpcGuards';

let downloadsIpcService: ReturnType<typeof getDownloadService> | null = null;

const getDownloadsIpcService = (): ReturnType<typeof getDownloadService> => {
  if (downloadsIpcService) {
    return downloadsIpcService;
  }

  const clearBackgroundTask = beginMainBackgroundTask('downloads:init');
  try {
    const service = getDownloadService();

    service.on('jobs-updated', (jobs: DownloadJob[]) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IpcChannels.DownloadsJobsUpdated, jobs);
      }
    });

    downloadsIpcService = service;
    return service;
  } finally {
    clearBackgroundTask();
  }
};

const parseOsuBeatmapsetId = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (host !== 'osu.ppy.sh' && host !== 'www.osu.ppy.sh') {
      return null;
    }

    const match = url.pathname.match(/^\/(?:beatmapsets|s)\/(\d+)(?:\/|$)/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const downloadsUnlocked = (): boolean => {
  const entitlementUnlocked = getDownloadFeatureUnlockService().getStatus().unlocked === true;
  if (!entitlementUnlocked) {
    return false;
  }

  return getAppSettings({ downloadsFeatureUnlocked: true }).downloadsFeatureUnlocked === true;
};

const isOsuOnlySearchRequest = (request: string | DownloadSearchRequest): boolean =>
  typeof request !== 'string' && request.provider === 'osu';

const assertDownloadsOrOsuRequest = (request: {
  url?: string;
  options?: CreateDownloadUrlJobOptions;
  search?: string | DownloadSearchRequest;
}): void => {
  const osuBeatmapsetUrl = typeof request.url === 'string' && Boolean(parseOsuBeatmapsetId(request.url));
  if (request.options?.providerLock === 'osu') {
    if (osuBeatmapsetUrl) {
      return;
    }
    throw new Error('osu_downloader_only_supports_beatmapset_links');
  }

  if (typeof request.search !== 'string' && request.search?.providerLock === 'osu') {
    if (request.search.provider === 'osu') {
      return;
    }
    throw new Error('osu_downloader_only_supports_osu_search');
  }

  if (downloadsUnlocked()) {
    return;
  }

  const osuOnlyRequest =
    osuBeatmapsetUrl ||
    (request.search !== undefined && isOsuOnlySearchRequest(request.search));

  if (osuOnlyRequest) {
    return;
  }

  getDownloadFeatureUnlockService().assertUnlocked();
  if (getAppSettings({ downloadsFeatureUnlocked: true }).downloadsFeatureUnlocked !== true) {
    throw new Error('downloads_plugin_unlock_required');
  }
};

const requireDownloadsOrOsuThen = <Args extends unknown[], Result>(
  getRequest: (...args: Args) => Parameters<typeof assertDownloadsOrOsuRequest>[0],
  handler: (_event: unknown, ...args: Args) => Result | Promise<Result>,
) => requireSyncMainFeatureThen(
  (_event: unknown, ...args: Args) => {
    assertDownloadsOrOsuRequest(getRequest(...args));
  },
  handler,
);

export const registerDownloadsIpc = (): void => {
  ipcMain.handle(IpcChannels.DownloadsGetJobs, (): DownloadJob[] => getDownloadsIpcService().getJobs());
  ipcMain.handle(IpcChannels.DownloadsCreateUrlJob, requireDownloadsOrOsuThen(
    (url: unknown, options?: CreateDownloadUrlJobOptions) => ({ url: typeof url === 'string' ? url : undefined, options }),
    (_event, url: unknown, options?: CreateDownloadUrlJobOptions): DownloadJob => {
    if (typeof url !== 'string') {
      throw new Error('download URL must be a string');
    }

    return getDownloadsIpcService().createUrlJob(url, options);
  }));
  ipcMain.handle(IpcChannels.DownloadsCancelJob, (_event, jobId: unknown): DownloadJob | null => getDownloadsIpcService().cancelJob(String(jobId)));
  ipcMain.handle(IpcChannels.DownloadsClearCompleted, (): DownloadJob[] => getDownloadsIpcService().clearCompleted());
  ipcMain.handle(IpcChannels.DownloadsGetSettings, (): DownloadSettings => getDownloadsIpcService().getSettings());
  ipcMain.handle(IpcChannels.DownloadsSetSettings, (_event, patch: Partial<DownloadSettings>): DownloadSettings =>
    getDownloadsIpcService().setSettings(patch),
  );
  ipcMain.handle(IpcChannels.DownloadsChooseOutputDirectory, async (_event, target?: 'default' | 'osu'): Promise<DownloadSettings | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择下载文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return getDownloadsIpcService().setSettings(target === 'osu' ? { osuOutputDirectory: result.filePaths[0] } : { outputDirectory: result.filePaths[0] });
  });
  ipcMain.handle(IpcChannels.DownloadsSearch, requireDownloadsOrOsuThen(
    (request: string | DownloadSearchRequest) => ({ search: request }),
    (_event, request: string | DownloadSearchRequest): Promise<DownloadSearchResponse> => getDownloadsIpcService().search(request),
  ));
  ipcMain.handle(IpcChannels.DownloadsCheckTools, (): Promise<DownloadToolsStatus> => getDownloadsIpcService().checkTools());
};
