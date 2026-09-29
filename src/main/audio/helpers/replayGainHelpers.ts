import { getAppSettings } from '../../app/appSettings';
import { DEFAULT_REPLAY_GAIN_TARGET_LUFS } from '../../../shared/constants/replayGain';
import type { ReplayGainMode } from '../../../shared/types/appSettings';

export type ReplayGainAudioSettings = {
  replayGainEnabled: boolean;
  replayGainMode: ReplayGainMode;
  replayGainTargetLufs: number;
  replayGainPreampDb: number;
  replayGainPreventClipping: boolean;
};

export const defaultReplayGainAudioSettings: ReplayGainAudioSettings = {
  replayGainEnabled: false,
  replayGainMode: 'track',
  replayGainTargetLufs: DEFAULT_REPLAY_GAIN_TARGET_LUFS,
  replayGainPreampDb: 0,
  replayGainPreventClipping: true,
};

export const getReplayGainAudioSettings = (): ReplayGainAudioSettings => {
  try {
    const settings = getAppSettings();
    return {
      replayGainEnabled: settings.replayGainEnabled === true,
      replayGainMode: settings.replayGainMode ?? 'track',
      replayGainTargetLufs: settings.replayGainTargetLufs ?? DEFAULT_REPLAY_GAIN_TARGET_LUFS,
      replayGainPreampDb: settings.replayGainPreampDb ?? 0,
      replayGainPreventClipping: settings.replayGainPreventClipping !== false,
    };
  } catch {
    return defaultReplayGainAudioSettings;
  }
};
