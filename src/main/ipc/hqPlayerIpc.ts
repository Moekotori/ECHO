import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  HqPlayerConnectionTestResult,
  HqPlayerPlaybackControlPlan,
  HqPlayerPlaybackControlSendResult,
  HqPlayerPlaybackHandoffPlan,
  HqPlayerPlaybackHandoffRequest,
  HqPlayerSettings,
  HqPlayerStatus,
} from '../../shared/types/hqplayer';
import { getHqPlayerService } from '../integrations/hqplayer/HqPlayerService';

const normalizeSettingsPatch = (value: unknown): Partial<HqPlayerSettings> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Partial<HqPlayerSettings>;
};

const normalizePlaybackHandoffRequest = (value: unknown): HqPlayerPlaybackHandoffRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hqplayer_handoff_request_invalid');
  }

  const input = value as Partial<HqPlayerPlaybackHandoffRequest>;
  if (!input.item || typeof input.item !== 'object' || Array.isArray(input.item)) {
    throw new Error('hqplayer_handoff_item_invalid');
  }

  return {
    item: input.item as HqPlayerPlaybackHandoffRequest['item'],
    startSeconds: typeof input.startSeconds === 'number' ? input.startSeconds : undefined,
    forceRefresh: input.forceRefresh === true,
    confirmed: input.confirmed === true,
    resolvedSource: input.resolvedSource ?? null,
  };
};

export const registerHqPlayerIpc = (): void => {
  const service = getHqPlayerService();

  ipcMain.handle(IpcChannels.HqPlayerGetSettings, (): HqPlayerSettings => service.getSettings());
  ipcMain.handle(IpcChannels.HqPlayerSetSettings, (_event, patch: unknown): HqPlayerSettings =>
    service.setSettings(normalizeSettingsPatch(patch)),
  );
  ipcMain.handle(IpcChannels.HqPlayerGetStatus, (): HqPlayerStatus => service.getStatus());
  ipcMain.handle(IpcChannels.HqPlayerTestConnection, (_event, patch: unknown): Promise<HqPlayerConnectionTestResult> =>
    service.testConnection(normalizeSettingsPatch(patch)),
  );
  ipcMain.handle(IpcChannels.HqPlayerCreatePlaybackHandoff, (_event, request: unknown): Promise<HqPlayerPlaybackHandoffPlan> =>
    service.createPlaybackHandoff(normalizePlaybackHandoffRequest(request)),
  );
  ipcMain.handle(IpcChannels.HqPlayerSendLastPlaybackControl, (): Promise<HqPlayerPlaybackControlSendResult> =>
    service.sendLastPlaybackControl(),
  );
  ipcMain.handle(IpcChannels.HqPlayerGetLastPlaybackHandoff, (): HqPlayerPlaybackHandoffPlan | null =>
    service.getLastPlaybackHandoffPlan(),
  );
  ipcMain.handle(IpcChannels.HqPlayerGetLastPlaybackControl, (): HqPlayerPlaybackControlPlan | null =>
    service.getLastPlaybackControlPlan(),
  );
};
