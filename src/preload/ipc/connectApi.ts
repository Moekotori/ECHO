import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createConnectApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['connect'] {
  return {
    getDonatorUnlockStatus: () => ipcRenderer.invoke(IpcChannels.ConnectGetDonatorUnlockStatus),
    listDevices: () => ipcRenderer.invoke(IpcChannels.ConnectListDevices),
    refresh: () => ipcRenderer.invoke(IpcChannels.ConnectRefresh),
    getStatus: () => ipcRenderer.invoke(IpcChannels.ConnectGetStatus),
    connect: (request) => ipcRenderer.invoke(IpcChannels.ConnectConnect, request),
    disconnect: () => ipcRenderer.invoke(IpcChannels.ConnectDisconnect),
    play: () => ipcRenderer.invoke(IpcChannels.ConnectPlay),
    pause: () => ipcRenderer.invoke(IpcChannels.ConnectPause),
    stop: () => ipcRenderer.invoke(IpcChannels.ConnectStop),
    seek: (positionSeconds) => ipcRenderer.invoke(IpcChannels.ConnectSeek, positionSeconds),
    setVolume: (volumePercent) => ipcRenderer.invoke(IpcChannels.ConnectSetVolume, volumePercent),
    getEchoLinkStatus: () => ipcRenderer.invoke(IpcChannels.EchoLinkGetStatus),
    setEchoLinkEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.EchoLinkSetEnabled, enabled),
    rotateEchoLinkToken: () => ipcRenderer.invoke(IpcChannels.EchoLinkRotateToken),
    setEchoLinkWebBackground: (background) => ipcRenderer.invoke(IpcChannels.EchoLinkSetWebBackground, background),
    chooseEchoLinkWebBackgroundImage: () => ipcRenderer.invoke(IpcChannels.EchoLinkChooseWebBackgroundImage),
    onStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectStatus, listener);
    },
    getReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverGetStatus),
    setReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectReceiverSetEnabled, enabled),
    stopReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectReceiverStopPlayback),
    onReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectReceiverStatus, listener);
    },
    getAirPlayReceiverStatus: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverGetStatus),
    setAirPlayReceiverEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverSetEnabled, enabled),
    stopAirPlayReceiverPlayback: () => ipcRenderer.invoke(IpcChannels.ConnectAirPlayReceiverStopPlayback),
    onAirPlayReceiverStatus: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
        handler(status as Awaited<ReturnType<EchoApi['connect']['getAirPlayReceiverStatus']>>);
      };
      ipcRenderer.on(IpcChannels.ConnectAirPlayReceiverStatus, listener);
      return () => ipcRenderer.off(IpcChannels.ConnectAirPlayReceiverStatus, listener);
    },
    getWallpaperEngineBridgeStatus: () => ipcRenderer.invoke(IpcChannels.ConnectWallpaperEngineBridgeGetStatus),
  };
}
