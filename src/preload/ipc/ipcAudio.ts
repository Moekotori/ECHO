import type { EchoApi } from '../apiTypes';
import type { AudioOutputSettings, AudioStatus } from '../../shared/types/audio';
import type { SystemAudioEngine } from '../systemAudioEngine';

export function createAudioApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
  sa: SystemAudioEngine,
): EchoApi['audio'] {
  return {
    getStatus: async () => {
      if (sa.systemAudioModeActive) {
        return sa.getSystemAudioStatus();
      }

      const status = await ipcRenderer.invoke(IpcChannels.AudioGetStatus) as AudioStatus;
      sa.lastNativeAudioStatus = status;
      sa.applySystemOutputSettings(null, status);
      if (status.outputMode === 'system') {
        sa.systemAudioModeActive = true;
        return sa.getSystemAudioStatus();
      }
      return status;
    },
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.AudioGetDiagnostics),
    onStatus: (handler) => {
      const unsubscribeInternal = sa.onAudioStatus(handler);
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        const nextStatus = status as AudioStatus;
        sa.lastNativeAudioStatus = nextStatus;
        sa.applySystemOutputSettings(null, nextStatus);
        if (sa.systemAudioModeActive || nextStatus.outputMode === 'system') {
          if (nextStatus.outputMode === 'system') {
            sa.systemAudioModeActive = true;
          }
          handler(sa.getSystemAudioStatus());
          return;
        }

        handler(nextStatus as Awaited<ReturnType<EchoApi['audio']['getStatus']>>);
      };
      ipcRenderer.on(IpcChannels.AudioStatus, listener);
      return () => {
        unsubscribeInternal();
        ipcRenderer.off(IpcChannels.AudioStatus, listener);
      };
    },
    onSessionReset: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown): void => {
        handler(event as Parameters<Parameters<EchoApi['audio']['onSessionReset']>[0]>[0]);
      };
      ipcRenderer.on(IpcChannels.AudioSessionReset, listener);
      return () => ipcRenderer.off(IpcChannels.AudioSessionReset, listener);
    },
    listDevices: () => ipcRenderer.invoke(IpcChannels.AudioListDevices),
    setOutput: async (settings) => {
      const wasSystemAudioModeActive = sa.systemAudioModeActive;
      const previousNativeAudioStatus = sa.lastNativeAudioStatus;
      const nextStatus = await ipcRenderer.invoke(IpcChannels.AudioSetOutput, settings) as AudioStatus;
      sa.lastNativeAudioStatus = nextStatus;
      sa.applySystemOutputSettings(settings, nextStatus);

      if (
        !sa.isExplicitNativeOutputRequest(settings) &&
        (wasSystemAudioModeActive || (settings && typeof settings === 'object' && (settings as AudioOutputSettings).outputMode === 'system') || nextStatus.outputMode === 'system')
      ) {
        sa.systemAudioModeActive = true;
        const handoffStatus = await sa.handoffNativePlaybackToSystemAudio(
          Boolean(
            previousNativeAudioStatus &&
            previousNativeAudioStatus.currentFilePath &&
            (previousNativeAudioStatus.state === 'playing' || previousNativeAudioStatus.state === 'loading'),
          ) ? previousNativeAudioStatus : nextStatus,
        );
        if (handoffStatus) {
          return handoffStatus;
        }
        return sa.getSystemAudioStatus();
      }

      if (sa.systemAudioModeActive) {
        sa.stopSystemPlayback('idle', false);
        sa.systemAudioModeActive = false;
      }

      return nextStatus;
    },
    exportFile: (request) => ipcRenderer.invoke(IpcChannels.AudioExportFile, request),
    resetEngine: () => ipcRenderer.invoke(IpcChannels.AudioResetEngine),
    forceRestart: (reason) => ipcRenderer.invoke(IpcChannels.AudioForceRestart, reason),
    restartWindowsAudioService: () => ipcRenderer.invoke(IpcChannels.AudioRestartWindowsAudioService),
  };
}
