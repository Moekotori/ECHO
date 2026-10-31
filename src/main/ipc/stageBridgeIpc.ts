import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { StageBridgeServerStatus } from '../../shared/types/stage';
import { getAppSettings, setAppSettings } from '../app/appSettings';
import { getStageBridgeService, syncStageBridgeIntegrationFromSettings } from '../integrations/stage/getStageBridgeService';

export const registerStageBridgeIpc = (): void => {
  ipcMain.handle(IpcChannels.StageBridgeGetStatus, (): StageBridgeServerStatus =>
    getStageBridgeService().getServerStatus(),
  );
  ipcMain.handle(IpcChannels.StageBridgeSetEnabled, async (_event, patch: unknown): Promise<StageBridgeServerStatus> => {
    const input = patch && typeof patch === 'object' && !Array.isArray(patch)
      ? patch as { obsBrowserSourceEnabled?: unknown; stageApiEnabled?: unknown }
      : {};
    const current = getAppSettings();
    const settings = setAppSettings({
      obsBrowserSourceEnabled: typeof input.obsBrowserSourceEnabled === 'boolean'
        ? input.obsBrowserSourceEnabled
        : current.obsBrowserSourceEnabled,
      stageApiEnabled: typeof input.stageApiEnabled === 'boolean'
        ? input.stageApiEnabled
        : current.stageApiEnabled,
    });
    await syncStageBridgeIntegrationFromSettings(settings);
    return getStageBridgeService().getServerStatus();
  });
};
