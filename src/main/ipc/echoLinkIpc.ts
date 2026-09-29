import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { EchoLinkBasicStatus, EchoLinkPairingSession } from '../../shared/types/echoLink';
import { getAppSettings, setAppSettings } from '../app/appSettings';
import { syncEchoLinkBasicIntegrationFromSettings } from '../connect/EchoLinkBasicIntegration';
import { getEchoLinkService } from '../connect/EchoLinkService';

const requireClientId = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error('invalid_echo_link_client_id');
  }
  return value.trim();
};

export const registerEchoLinkIpc = (): void => {
  ipcMain.handle(IpcChannels.EchoLinkBasicGetStatus, (): EchoLinkBasicStatus =>
    getEchoLinkService().getBasicStatus(),
  );
  ipcMain.handle(
    IpcChannels.EchoLinkBasicSetEnabled,
    async (_event, enabled: unknown): Promise<EchoLinkBasicStatus> => {
      if (typeof enabled !== 'boolean') {
        throw new Error('invalid_echo_link_enabled_state');
      }
      const settings = setAppSettings({ echoLinkBasicEnabled: enabled });
      await syncEchoLinkBasicIntegrationFromSettings(settings);
      return getEchoLinkService().getBasicStatus();
    },
  );
  ipcMain.handle(
    IpcChannels.EchoLinkBasicStartPairing,
    async (): Promise<EchoLinkPairingSession> => {
      const settings = getAppSettings();
      if (settings.echoLinkBasicEnabled !== true) {
        throw new Error('echo_link_basic_disabled');
      }
      return getEchoLinkService().startBasicPairing();
    },
  );
  ipcMain.handle(IpcChannels.EchoLinkBasicCancelPairing, (): EchoLinkBasicStatus =>
    getEchoLinkService().cancelBasicPairing(),
  );
  ipcMain.handle(
    IpcChannels.EchoLinkBasicRevokeClient,
    (_event, clientId: unknown): EchoLinkBasicStatus =>
      getEchoLinkService().revokeBasicClient(requireClientId(clientId)),
  );
};
