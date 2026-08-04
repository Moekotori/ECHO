import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';
import type { SmtcCommand } from '../../shared/types/smtc';

export function createSmtcApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['smtc'] {
  return {
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.SmtcGetDiagnostics),
    setLyricsProgress: (progress) => ipcRenderer.invoke(IpcChannels.SmtcSetLyricsProgress, progress),
    restart: () => ipcRenderer.invoke(IpcChannels.SmtcRestart),
    onCommand: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, command: unknown): void => {
        handler(command as SmtcCommand);
      };
      ipcRenderer.on(IpcChannels.SmtcCommand, listener);
      return () => ipcRenderer.off(IpcChannels.SmtcCommand, listener);
    },
  };
}
