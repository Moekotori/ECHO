import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createLibraryLabApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['libraryLab'] {
  return {
    setWatcherEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetWatcherEnabled, enabled),
    setAutoRescanEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetAutoRescanEnabled, enabled),
    setMoveCandidateEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveCandidateEnabled, enabled),
    setMoveRepairLabEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.LibraryLabSetMoveRepairLabEnabled, enabled),
    getState: () => ipcRenderer.invoke(IpcChannels.LibraryLabGetState),
    startWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStartWatcher),
    stopWatcher: () => ipcRenderer.invoke(IpcChannels.LibraryLabStopWatcher),
    refreshDiagnostics: () => ipcRenderer.invoke(IpcChannels.LibraryLabRefreshDiagnostics),
    backfillPlaceholderMetadata: () => ipcRenderer.invoke(IpcChannels.LibraryLabBackfillPlaceholderMetadata),
    getMoveCandidates: (options) => ipcRenderer.invoke(IpcChannels.LibraryLabGetMoveCandidates, options),
    dryRunMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabDryRunMoveRepair, candidateId),
    applyMoveRepair: (candidateId) => ipcRenderer.invoke(IpcChannels.LibraryLabApplyMoveRepair, candidateId),
  };
}
