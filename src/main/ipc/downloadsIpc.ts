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

export const registerDownloadsIpc = (): void => {
  ipcMain.handle(IpcChannels.DownloadsGetJobs, (): DownloadJob[] => getDownloadsIpcService().getJobs());
  ipcMain.handle(IpcChannels.DownloadsCreateUrlJob, (_event, url: unknown, options?: CreateDownloadUrlJobOptions): DownloadJob => {
    if (typeof url !== 'string') {
      throw new Error('download URL must be a string');
    }

    return getDownloadsIpcService().createUrlJob(url, options);
  });
  ipcMain.handle(IpcChannels.DownloadsCancelJob, (_event, jobId: unknown): DownloadJob | null => getDownloadsIpcService().cancelJob(String(jobId)));
  ipcMain.handle(IpcChannels.DownloadsClearCompleted, (): DownloadJob[] => getDownloadsIpcService().clearCompleted());
  ipcMain.handle(IpcChannels.DownloadsGetSettings, (): DownloadSettings => getDownloadsIpcService().getSettings());
  ipcMain.handle(IpcChannels.DownloadsSetSettings, (_event, patch: Partial<DownloadSettings>): DownloadSettings =>
    getDownloadsIpcService().setSettings(patch),
  );
  ipcMain.handle(IpcChannels.DownloadsChooseOutputDirectory, async (): Promise<DownloadSettings | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择下载文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return getDownloadsIpcService().setSettings({ outputDirectory: result.filePaths[0] });
  });
  ipcMain.handle(IpcChannels.DownloadsSearch, (_event, request: string | DownloadSearchRequest): Promise<DownloadSearchResponse> =>
    getDownloadsIpcService().search(request),
  );
  ipcMain.handle(IpcChannels.DownloadsCheckTools, (): Promise<DownloadToolsStatus> => getDownloadsIpcService().checkTools());
};
