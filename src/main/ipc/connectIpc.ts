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
  loadReceiverService: () => ReturnType<typeof getConnectReceiverService>,
): ConnectReceiverStatus => (
  isConnectDonatorUnlocked() ? loadReceiverService().getStatus() : createLockedConnectReceiverStatus()
);

const getAirPlayReceiverStatusForCurrentEntitlement = (
  loadAirPlayReceiverService: () => ReturnType<typeof getAirPlayReceiverSpikeService>,
): AirPlayReceiverStatus => (
  isConnectDonatorUnlocked() ? loadAirPlayReceiverService().getStatus() : createLockedAirPlayReceiverStatus()
);

const webBackgroundImageFilters = [
  { name: 'Images', extensions: ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'] },
];

const startConfiguredReceivers = (
  loadReceiverService: () => ReturnType<typeof getConnectReceiverService>,
  loadAirPlayReceiverService: () => ReturnType<typeof getAirPlayReceiverSpikeService>,
): void => {
  if (getAppSettings().connectAutoStartReceiversEnabled !== true) {
    return;
  }
  if (!isConnectDonatorUnlocked()) {
    return;
  }
  void loadReceiverService().setEnabled(true).catch(() => undefined);
  void loadAirPlayReceiverService().setEnabled(true).catch(() => undefined);
};

export const registerConnectIpc = (): void => {
  let connectService: ReturnType<typeof getConnectService> | null = null;
  let receiverService: ReturnType<typeof getConnectReceiverService> | null = null;
  let airPlayReceiverService: ReturnType<typeof getAirPlayReceiverSpikeService> | null = null;
  let echoLinkService: ReturnType<typeof getEchoLinkService> | null = null;

  const loadConnectService = (): ReturnType<typeof getConnectService> => {
    if (!connectService) {
      connectService = getConnectService();
      connectService.on('status', sendConnectStatus);
    }
    return connectService;
  };

  const loadReceiverService = (): ReturnType<typeof getConnectReceiverService> => {
    if (!receiverService) {
      receiverService = getConnectReceiverService();
      receiverService.on('status', sendConnectReceiverStatus);
    }
    return receiverService;
  };

  const loadAirPlayReceiverService = (): ReturnType<typeof getAirPlayReceiverSpikeService> => {
    if (!airPlayReceiverService) {
      airPlayReceiverService = getAirPlayReceiverSpikeService();
      airPlayReceiverService.on('status', sendAirPlayReceiverStatus);
    }
    return airPlayReceiverService;
  };

  const loadEchoLinkService = (): ReturnType<typeof getEchoLinkService> => {
    echoLinkService ??= getEchoLinkService();
    return echoLinkService;
  };

  ipcMain.handle(IpcChannels.ConnectGetDonatorUnlockStatus, (_event, options?: unknown) =>
    getConnectDonatorUnlockService().refreshStatus(
      options && typeof options === 'object'
        ? { force: (options as { force?: unknown }).force === true }
        : undefined,
    ),
  );
  ipcMain.handle(IpcChannels.ConnectListDevices, requireConnectDonatorFeatureThen((): ConnectDevice[] => loadConnectService().listDevices()));
  ipcMain.handle(IpcChannels.ConnectRefresh, requireConnectDonatorFeatureThen((): Promise<ConnectDevice[]> => loadConnectService().refreshDevices()));
  ipcMain.handle(IpcChannels.ConnectGetStatus, (): ConnectSessionStatus => loadConnectService().getStatus());
  ipcMain.handle(IpcChannels.ConnectConnect, requireConnectDonatorFeatureThen((_event, request: unknown): Promise<ConnectSessionStatus> =>
    loadConnectService().connect(normalizeConnectStartRequest(request)),
  ));
  ipcMain.handle(IpcChannels.ConnectDisconnect, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => loadConnectService().disconnect()));
  ipcMain.handle(IpcChannels.ConnectPlay, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => loadConnectService().play()));
  ipcMain.handle(IpcChannels.ConnectPause, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => loadConnectService().pause()));
  ipcMain.handle(IpcChannels.ConnectStop, requireConnectDonatorFeatureThen((): Promise<ConnectSessionStatus> => loadConnectService().stop()));
  ipcMain.handle(IpcChannels.ConnectSeek, requireConnectDonatorFeatureThen((_event, positionSeconds: unknown): Promise<ConnectSessionStatus> =>
    loadConnectService().seek(normalizeSeconds(positionSeconds)),
  ));
  ipcMain.handle(IpcChannels.ConnectSetVolume, requireConnectDonatorFeatureThen((_event, volumePercent: unknown): Promise<ConnectSessionStatus> =>
    loadConnectService().setVolume(normalizeVolume(volumePercent)),
  ));
  ipcMain.handle(IpcChannels.EchoLinkGetStatus, requireConnectDonatorFeatureThen((): EchoLinkServerStatus => loadEchoLinkService().getServerStatus()));
  ipcMain.handle(IpcChannels.EchoLinkSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<EchoLinkServerStatus> =>
    loadEchoLinkService().setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.EchoLinkRotateToken, requireConnectDonatorFeatureThen((): EchoLinkServerStatus => loadEchoLinkService().rotateToken()));
  ipcMain.handle(IpcChannels.EchoLinkSetWebBackground, requireConnectDonatorFeatureThen((_event, background: unknown): EchoLinkServerStatus =>
    loadEchoLinkService().setWebBackground(background as Partial<EchoLinkWebBackground>),
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
    return loadEchoLinkService().setLocalWebBackgroundImage(result.filePaths[0]);
  }));
  ipcMain.handle(IpcChannels.ConnectReceiverGetStatus, (): ConnectReceiverStatus =>
    getReceiverStatusForCurrentEntitlement(loadReceiverService),
  );
  ipcMain.handle(IpcChannels.ConnectReceiverSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<ConnectReceiverStatus> =>
    loadReceiverService().setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.ConnectReceiverStopPlayback, requireConnectDonatorFeatureThen((): ConnectReceiverStatus => loadReceiverService().stopPlayback()));
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverGetStatus, (): AirPlayReceiverStatus =>
    getAirPlayReceiverStatusForCurrentEntitlement(loadAirPlayReceiverService),
  );
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverSetEnabled, requireConnectDonatorFeatureThen((_event, enabled: unknown): Promise<AirPlayReceiverStatus> =>
    loadAirPlayReceiverService().setEnabled(enabled === true),
  ));
  ipcMain.handle(IpcChannels.ConnectAirPlayReceiverStopPlayback, requireConnectDonatorFeatureThen((): Promise<AirPlayReceiverStatus> =>
    loadAirPlayReceiverService().stopPlayback(),
  ));
  ipcMain.handle(IpcChannels.ConnectWallpaperEngineBridgeGetStatus, requireConnectDonatorFeatureThen(() =>
    getWallpaperEngineBridgeService().getServerStatus(),
  ));
  startConfiguredReceivers(loadReceiverService, loadAirPlayReceiverService);
};
