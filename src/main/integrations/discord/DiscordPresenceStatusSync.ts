import type { AudioStatus } from '../../../shared/types/audio';
import { getAudioSession } from '../../audio/AudioSession';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { getDiscordPresenceService } from './getDiscordPresenceService';

type DiscordPresenceSyncState = {
  initialized: boolean;
  statusListener: ((status: AudioStatus) => void) | null;
};

const state: DiscordPresenceSyncState = {
  initialized: false,
  statusListener: null,
};

const logWarn = (message: string, payload?: unknown): void => {
  getCrashReportService().getLogger()?.warn('main', message, payload);
  console.warn(message, payload ?? '');
};

export const syncDiscordPresenceStatus = async (status: AudioStatus = getAudioSession().getStatus()): Promise<void> => {
  try {
    await getDiscordPresenceService().updateFromAudioStatus(status);
  } catch (error) {
    logWarn('[DiscordPresence] Failed to sync audio status', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const initializeDiscordPresenceIntegration = async (): Promise<void> => {
  if (state.initialized) {
    return;
  }

  try {
    await getDiscordPresenceService().initialize();
  } catch (error) {
    logWarn('[DiscordPresence] Initialization failed', { error: error instanceof Error ? error.message : String(error) });
  }

  state.statusListener = (status: AudioStatus) => {
    void syncDiscordPresenceStatus(status);
  };
  getAudioSession().on('status', state.statusListener);
  state.initialized = true;
  const initialStatus = getAudioSession().getStatus();
  if (initialStatus.state === 'playing' || initialStatus.state === 'loading') {
    await syncDiscordPresenceStatus(initialStatus);
  }
};

export const disposeDiscordPresenceIntegration = (): void => {
  if (!state.initialized) {
    return;
  }

  if (state.statusListener) {
    getAudioSession().off('status', state.statusListener);
  }

  void getDiscordPresenceService().dispose();
  state.initialized = false;
  state.statusListener = null;
};
