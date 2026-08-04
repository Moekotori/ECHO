import type { EchoApi } from '../apiTypes';
import type { DiagnosticConsoleEntry, DiagnosticMemoryPressureEvent } from '../../shared/types/diagnostics';

export function createDiagnosticsApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['diagnostics'] {
  return {
    getLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsGetLastCrashSummary),
    clearLastCrashSummary: () => ipcRenderer.invoke(IpcChannels.DiagnosticsClearLastCrashSummary),
    exportDiagnostics: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExport),
    exportDiagnosticsZip: () => ipcRenderer.invoke(IpcChannels.DiagnosticsExportZip),
    openDiagnosticsFolder: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenFolder),
    openCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenCrashReport),
    openCrashTextReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenCrashTextReport),
    openAudioCrashReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenAudioCrashReport),
    openAudioCrashTextReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenAudioCrashTextReport),
    openMemoryPressureReport: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenMemoryPressureReport),
    relaunchApp: () => ipcRenderer.invoke(IpcChannels.DiagnosticsRelaunchApp),
    openDevConsole: () => ipcRenderer.invoke(IpcChannels.DiagnosticsOpenDevConsole),
    getDevConsoleSnapshot: () => ipcRenderer.invoke(IpcChannels.DiagnosticsDevConsoleSnapshot),
    onDevConsoleEntry: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: unknown): void => {
        handler(entry as DiagnosticConsoleEntry);
      };
      ipcRenderer.on(IpcChannels.DiagnosticsDevConsoleEntry, listener);
      return () => ipcRenderer.off(IpcChannels.DiagnosticsDevConsoleEntry, listener);
    },
    onMemoryPressure: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown): void => {
        handler(event as DiagnosticMemoryPressureEvent);
      };
      ipcRenderer.on(IpcChannels.DiagnosticsMemoryPressure, listener);
      return () => ipcRenderer.off(IpcChannels.DiagnosticsMemoryPressure, listener);
    },
    reportRendererError: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportRendererError, payload),
    reportPerformanceStall: (payload) => ipcRenderer.invoke(IpcChannels.DiagnosticsReportPerformanceStall, payload),
  };
}
