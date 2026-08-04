import type { EchoApi } from '../apiTypes';

export function createSleepTimerApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['sleepTimer'] {
  return {
    start: (request) => ipcRenderer.invoke(IpcChannels.SleepTimerStart, request),
    cancel: () => ipcRenderer.invoke(IpcChannels.SleepTimerCancel),
    getStatus: () => ipcRenderer.invoke(IpcChannels.SleepTimerGetStatus),
    onTick: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, remainingMs: unknown): void => {
        handler(typeof remainingMs === 'number' ? remainingMs : 0);
      };
      ipcRenderer.on(IpcChannels.SleepTimerOnTick, listener);
      return () => ipcRenderer.off(IpcChannels.SleepTimerOnTick, listener);
    },
  };
}
