import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createPetApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['pet'] {
  return {
    show: () => ipcRenderer.invoke(IpcChannels.PetShow),
    hide: () => ipcRenderer.invoke(IpcChannels.PetHide),
    getState: () => ipcRenderer.invoke(IpcChannels.PetGetState),
    moveTo: (position) => ipcRenderer.invoke(IpcChannels.PetMoveTo, position),
    resetBounds: () => ipcRenderer.invoke(IpcChannels.PetResetBounds),
    setScale: (scalePercent) => ipcRenderer.invoke(IpcChannels.PetSetScale, scalePercent),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['pet']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.PetStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.PetStateChanged, listener);
    },
  };
}
