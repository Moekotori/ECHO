import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createMiniPlayerApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['miniPlayer'] {
  return {
    show: () => ipcRenderer.invoke(IpcChannels.MiniPlayerShow),
    hide: (options) =>
      options === undefined
        ? ipcRenderer.invoke(IpcChannels.MiniPlayerHide)
        : ipcRenderer.invoke(IpcChannels.MiniPlayerHide, options),
    getState: () => ipcRenderer.invoke(IpcChannels.MiniPlayerGetState),
    setLocked: (locked) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetLocked, locked),
    setQueueOpen: (open) => ipcRenderer.invoke(IpcChannels.MiniPlayerSetQueueOpen, open),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.MiniPlayerResetBounds),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['miniPlayer']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.MiniPlayerStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.MiniPlayerStateChanged, listener);
    },
  };
}
