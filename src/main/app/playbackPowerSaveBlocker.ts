import { powerSaveBlocker } from 'electron';
import { getAudioSession } from '../audio/AudioSession';
import { getAppSettings } from './appSettings';
import { PlaybackPowerSaveBlockerController } from './PlaybackPowerSaveBlockerController';

let controller: PlaybackPowerSaveBlockerController | null = null;

export const initializePlaybackPowerSaveBlocker = (): void => {
  controller ??= new PlaybackPowerSaveBlockerController(
    getAudioSession(),
    powerSaveBlocker,
    () => getAppSettings().preventSleepWhilePlaying === true,
  );
  controller.initialize();
};

export const refreshPlaybackPowerSaveBlocker = (): void => {
  controller?.refresh();
};

export const disposePlaybackPowerSaveBlocker = (): void => {
  controller?.dispose();
  controller = null;
};
