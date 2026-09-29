import type { AudioStatus } from '../../../shared/types/audio';
import { getAudioSession } from '../../audio/AudioSession';
import { getCrashReportService } from '../../diagnostics/CrashReportService';
import { getLastFmService } from './getLastFmService';

type LastFmSyncState = {
  initialized: boolean;
  statusListener: ((status: AudioStatus) => void) | null;
};

const state: LastFmSyncState = {
  initialized: false,
  statusListener: null,
};

const logWarn = (message: string, payload?: unknown): void => {
  getCrashReportService().getLogger()?.warn('main', message, payload);
  console.warn(message, payload ?? '');
};

export const syncLastFmStatus = (status: AudioStatus = getAudioSession().getStatus()): void => {
  try {
    getLastFmService().updateFromAudioStatus(status);
  } catch (error) {
    logWarn('[Last.fm] failed to sync audio status', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const initializeLastFmIntegration = (): void => {
  if (state.initialized) {
    return;
  }

  try {
    getLastFmService().initialize();
  } catch (error) {
    logWarn('[Last.fm] initialization failed', { error: error instanceof Error ? error.message : String(error) });
  }

  state.statusListener = (status: AudioStatus) => {
    syncLastFmStatus(status);
  };
  getAudioSession().on('status', state.statusListener);
  state.initialized = true;
};

export const disposeLastFmIntegration = (): void => {
  if (!state.initialized) {
    return;
  }

  if (state.statusListener) {
    getAudioSession().off('status', state.statusListener);
  }

  void getLastFmService().dispose();
  state.initialized = false;
  state.statusListener = null;
};
