import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/constants/ipcChannels';
import type { DiagnosticConsoleEntry, DiagnosticConsoleSnapshot } from '../shared/types/diagnostics';

export type DevConsoleApi = {
  getSnapshot: () => Promise<DiagnosticConsoleSnapshot>;
  clear: () => Promise<void>;
  openDevTools: () => Promise<void>;
  onEntry: (handler: (entry: DiagnosticConsoleEntry) => void) => () => void;
};

const api: DevConsoleApi = {
  getSnapshot: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleSnapshot),
  clear: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleClear),
  openDevTools: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleOpenDevTools),
  onEntry: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: DiagnosticConsoleEntry): void => {
      handler(entry);
    };

    ipcRenderer.on(IpcChannels.DiagnosticsDevConsoleEntry, listener);
    return () => ipcRenderer.off(IpcChannels.DiagnosticsDevConsoleEntry, listener);
  },
};

contextBridge.exposeInMainWorld('echoDevConsole', api);
