import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AirPlayReceiverStatus, ConnectDevice, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
import { getAppSettings } from '../app/appSettings';
import { getAirPlayReceiverSpikeService } from '../connect/AirPlayReceiverSpikeService';
import { getConnectReceiverService } from '../connect/ConnectReceiverService';
import { getConnectService, normalizeConnectStartRequest } from '../connect/ConnectService';

const sendConnectStatus = (status: ConnectSessionStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.ConnectStatus, status);
    }
  }
};

const sendConnectReceiverStatus = (status: ConnectReceiverStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.ConnectReceiverStatus, status);
    }
  }
};

const sendAirPlayReceiverStatus = (status: AirPlayReceiverStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.ConnectAirPlayReceiverStatus, status);
    }
  }
};

const normalizeSeconds = (value: unknown): number => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : 0;
};

const normalizeVolume = (value: unknown): number => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 100;
};

const startConfiguredReceivers = (
  receiverService: ReturnType<typeof getConnectReceiverService>,
  airPlayReceiverService: ReturnType<typeof getAirPlayReceiverSpikeService>,
): void => {
  if (getAppSettings().connectAutoStartReceiversEnabled !== true) {
    return;
  }

  void receiverService.setEnabled(true).catch(() => undefined);
  void airPlayReceiverService.setEnabled(true).catch(() => undefined);
};

export const registerConnectIpc = (): void => {
  const service = getConnectService();
  const receiverService = getConnectReceiverService();
  const airPlayReceiverService = getAirPlayReceiverSpikeService();
  service.on('status', sendConnectStatus);
  receiverService.on('status', sendConnectReceiverStatus);
  airPlayReceiverService.on('status', sendAirPlayReceiverStatus);

  ipcMain.handle(IpcChannels.ConnectListDevices, (): ConnectDevice[] => service.listDevices());
  ipcMain.handle(IpcChannels.ConnectRefresh, (): Promise<ConnectDevice[]> => service.refreshDevices());
  ipcMain.handle(IpcChannels.ConnectGetStatus, (): ConnectSessionStatus => service.getStatus());
  ipcMain.handle(IpcChannels.ConnectConnect, (_event, request: unknown): Promise<ConnectSessionStatus> =>
    service.connect(normalizeConnectStartRequest(request)),
  );
  ipcMain.handle(IpcChannels.ConnectDisconnect, (): Promise<ConnectSessionStatus> => service.disconnect());
  ipcMain.handle(IpcChannels.ConnectPlay, (): Promise<ConnectSessionStatus> => service.play());
  ipcMain.handle(IpcChannels.ConnectPause, (): Promise<ConnectSessionStatus> => service.pause());
  ipcMain.handle(IpcChannels.ConnectStop, (): Promise<ConnectSessionStatus> => service.stop());
  ipcMain.handle(IpcChannels.ConnectSeek, (_event, positionSeconds: unknown): Promise<ConnectSessionStatus> =>
    service.seek(normalizeSeconds(positionSeconds)),
  );
  ipcMain.handle(IpcChannels.ConnectSetVolume, (_event, volumePercent: unknown): Promise<ConnectSessionStatus> =>
    service.setVolume(normalizeVolume(volumePercent)),
  );
  ipcMain.handle(IpcChannels.ConnectReceiverGetStatus, (): ConnectReceiverStatus => receiverService.getStatus());
  ipcMain.handle(IpcChannels.ConnectReceiverSetEnabled, (_event, enabled: unknown): Promise<ConnectReceiverStatus> =>
    receiverService.setEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.ConnectReceiverStopPlayback, (): ConnectReceiverStatus => receiverService.stopPlayback());
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverGetStatus, (): AirPlayReceiverStatus => airPlayReceiverService.getStatus());
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverSetEnabled, (_event, enabled: unknown): Promise<AirPlayReceiverStatus> =>
    airPlayReceiverService.setEnabled(enabled === true),
  );
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverStopPlayback, (): Promise<AirPlayReceiverStatus> =>
    airPlayReceiverService.stopPlayback(),
  );
  startConfiguredReceivers(receiverService, airPlayReceiverService);
};
