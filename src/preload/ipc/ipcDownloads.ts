import type { EchoApi } from '../apiTypes';

export function createDownloadsApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['downloads'] {
  return {
    getJobs: () => ipcRenderer.invoke(IpcChannels.DownloadsGetJobs),
    createUrlJob: (url, options) => ipcRenderer.invoke(IpcChannels.DownloadsCreateUrlJob, url, options),
    cancelJob: (jobId) => ipcRenderer.invoke(IpcChannels.DownloadsCancelJob, jobId),
    clearJobs: (provider) => ipcRenderer.invoke(IpcChannels.DownloadsClearJobs, provider),
    clearCompleted: (provider) => ipcRenderer.invoke(IpcChannels.DownloadsClearCompleted, provider),
    getSettings: () => ipcRenderer.invoke(IpcChannels.DownloadsGetSettings),
    setSettings: (patch) => ipcRenderer.invoke(IpcChannels.DownloadsSetSettings, patch),
    chooseOutputDirectory: (target) => ipcRenderer.invoke(IpcChannels.DownloadsChooseOutputDirectory, target),
    search: (request) => ipcRenderer.invoke(IpcChannels.DownloadsSearch, request),
    getOsuAccountProfile: () => ipcRenderer.invoke(IpcChannels.DownloadsGetOsuAccountProfile),
    getOsuAccountCollection: (request) => ipcRenderer.invoke(IpcChannels.DownloadsGetOsuAccountCollection, request),
    checkTools: () => ipcRenderer.invoke(IpcChannels.DownloadsCheckTools),
    onJobsUpdated: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, jobs: unknown): void => {
        handler(jobs as Awaited<ReturnType<EchoApi['downloads']['getJobs']>>);
      };
      ipcRenderer.on(IpcChannels.DownloadsJobsUpdated, listener);
      return () => ipcRenderer.off(IpcChannels.DownloadsJobsUpdated, listener);
    },
  };
}
