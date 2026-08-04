import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AirPlayReceiverStatus, ConnectDevice, ConnectReceiverStatus, ConnectSessionStatus } from '../../shared/types/connect';
import { getAppSettings } from '../app/appSettings';
import { getAirPlayReceiverSpikeService } from '../connect/AirPlayReceiverSpikeService';
import { getConnectReceiverService } from '../connect/ConnectReceiverService';
import { getConnectService, normalizeConnectStartRequest } from '../connect/ConnectService';
import { getEchoLinkService } from '../connect/EchoLinkService';
import type { EchoLinkServerStatus, EchoLinkWebBackground } from '../../shared/types/echoLink';
import { getWallpaperEngineBridgeService } from '../integrations/wallpaperEngine/getWallpaperEngineBridgeService';
import { getConnectDonatorUnlockService } from '../plugins/ConnectDonatorUnlockService';
import { requireConnectDonatorFeatureThen } from './entitlementIpcGuards';

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

const createLockedConnectReceiverStatus = (): ConnectReceiverStatus => ({
  enabled: false,
  state: 'disabled',
  advertisedName: 'ECHO Next',
  addresses: [],
  currentClient: null,
  currentUri: null,
  metadata: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 100,
  error: null,
  debugEvents: [],
  updatedAt: new Date().toISOString(),
});

const createLockedAirPlayReceiverStatus = (): AirPlayReceiverStatus => ({
  enabled: false,
  state: 'disabled',
  protocol: getAppSettings().airPlayReceiverProtocol === 'airplay2' ? 'airplay2' : 'airplay1',
  advertisedName: 'ECHO Next',
  nativeAvailable: false,
  currentSourceId: null,
  currentClient: null,
  metadata: null,
  currentLyricLine: null,
  artworkUrl: null,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 100,
  error: null,
  debugEvents: [],
  updatedAt: new Date().toISOString(),
});

const isConnectDonatorUnlocked = (): boolean => getConnectDonatorUnlockService().getStatus().unlocked === true;

const getReceiverStatusForCurrentEntitlement = (
  receiverService: ReturnType<typeof getConnectReceiverService>,
): ConnectReceiverStatus => (
  isConnectDonatorUnlocked() ? receiverService.getStatus() : createLockedConnectReceiverStatus()
);

const getAirPlayReceiverStatusForCurrentEntitlement = (
  airPlayReceiverService: ReturnType<typeof getAirPlayReceiverSpikeService>,
): AirPlayReceiverStatus => (
  isConnectDonatorUnlocked() ? airPlayReceiverService.getStatus() : createLockedAirPlayReceiverStatus()
);

const webBackgroundImageFilters = [
  { name: 'Images', extensions: ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'] },
];

const startConfiguredReceivers = (
  receiverService: ReturnType<typeof getConnectReceiverService>,
  airPlayReceiverService: ReturnType<typeof getAirPlayReceiverSpikeService>,
): void => {
  if (getAppSettings().connectAutoStartReceiversEnabled !== true) {
    return;
  }
  if (!isConnectDonatorUnlocked()) {
    return;
  }
  void receiverService.setEnabled(true).catch(() => undefined);
  void airPlayReceiverService.setEnabled(true).catch(() => undefined);
};

export const registerConnectIpc = (): void => {
  const service = getConnectService();
  const receiverService = getConnectReceiverService();
  const airPlayReceiverService = getAirPlayReceiverSpikeService();
  const echoLinkService = getEchoLinkService();
  service.on('status', sendConnectStatus);
  receiverService.on('status', sendConnectReceiverStatus);
  airPlayReceiverService.on('status', sendAirPlayReceiverStatus);

  ipcMain.handle(IpcChannels.ConnectGetDonatorUnlockStatus, () => getConnectDonatorUnlockService().getStatus());
  ipcMain.handle(IpcChannels.ConnectListDevices, requireConnectDonatorFeatureThen((): ConnectDevice[] => service.listDevices()));
  ipcMain.handle(IpcChannels.ConnectRefresh, requireConnectDonatorFeatureThen((): Promise<ConnectDevice[]> => service.refreshDevices()));
  ipcMain.handle(IpcChannels.ConnectGetStatus, (): ConnectSessionStatus => service.getStatus());
  ipcMain.handle(IpcChannels.ConnectConnect, requireConnectDonatorFeatureThen((_event, request: unknown): Promise<ConnectSessionStatus> =>
    service.connect(normalizeConnectStartRequest(request)),
  ));
  ipcMain.handle(IpcChannels.ConnectDisconnect, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => service.disconnect()));
  ipcMain.handle(IpcChannels.ConnectPlay, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => service.play()));
  ipcMain.handle(IpcChannels.ConnectPause, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => service.pause()));
  ipcMain.handle(IpcChannels.ConnectStop, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => service.stop()));
  ipcMain.handle(IpcChannels.ConnectSeek, requireConnectDonatorFeatureThen((_event, positionSeconds: unknown): Promise<ConnectSessionStatus> =>
    service.seek(normalizeSeconds(positionSeconds)),
  ));
  ipcMain.handle(IpcChannels.ConnectSetVolume, requireConnectDonatorFeatureThen((_event, volumePercent: unknown): Promise<ConnectSessionStatus> =>
    service.setVolume(normalizeVolume(volumePercent)),
  ));
  ipcMain.handle(IpcChannels.EchoLinkGetStatus, requireConnectDonatorFeatureThen((): EchoLinkServerStatus => echoLinkService.getServerStatus()));
  ipcMain.handle(IpcChannels.EchoLinkSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<EchoLinkServerStatus> =>
    echoLinkService.setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.EchoLinkRotateToken, requireConnectDonatorFeatureThen((): EchoLinkServerStatus => echoLinkService.rotateToken()));
  ipcMain.handle(IpcChannels.EchoLinkSetWebBackground, requireConnectDonatorFeatureThen((_event, background: unknown): EchoLinkServerStatus =>
    echoLinkService.setWebBackground(background as Partial<EchoLinkWebBackground>),
  ));
  ipcMain.handle(IpcChannels.EchoLinkChooseWebBackgroundImage, requireConnectDonatorFeatureThen(async (): Promise<EchoLinkServerStatus | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Album Sea background image',
      properties: ['openFile'],
      filters: webBackgroundImageFilters,
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return echoLinkService.setLocalWebBackgroundImage(result.filePaths[0]);
  }));
  ipcMain.handle(IpcChannels.ConnectReceiverGetStatus, (): ConnectReceiverStatus =>
    getReceiverStatusForCurrentEntitlement(receiverService),
  );
  ipcMain.handle(IpcChannels.ConnectReceiverSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<ConnectReceiverStatus> =>
    receiverService.setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.ConnectReceiverStopPlayback, requireConnectDonatorFeatureThen((): ConnectReceiverStatus => receiverService.stopPlayback()));
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverGetStatus, (): AirPlayReceiverStatus =>
    getAirPlayReceiverStatusForCurrentEntitlement(airPlayReceiverService),
  );
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<AirPlayReceiverStatus> =>
    airPlayReceiverService.setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverStopPlayback, requireConnectDonatorFeatureThen((): Promise<AirPlayReceiverStatus> =>
    airPlayReceiverService.stopPlayback(),
  ));
  ipcMain.handle(IpcChannels.ConnectWallpaperEngineBridgeGetStatus, requireConnectDonatorFeatureThen(() =>
    getWallpaperEngineBridgeService().getServerStatus(),
  ));
  startConfiguredReceivers(receiverService, airPlayReceiverService);
};
