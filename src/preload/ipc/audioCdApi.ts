import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createAudioCdApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['audioCd'] {
  return {
    getStatus: (driveId) => ipcRenderer.invoke(IpcChannels.AudioCdGetStatus, driveId),
    playTrack: (request) => ipcRenderer.invoke(IpcChannels.AudioCdPlayTrack, request),
  };
}
