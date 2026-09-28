import type { PersistedPlaybackSessionV1, PlaybackOrderMode } from '../../shared/types/playback';
import { getPlaybackSessionStore } from '../audioPublicApi';
import { getMainWindowPlaybackCommandRelay } from '../playback/MainWindowPlaybackCommandRelay';

const nextPlaybackOrder: Record<PlaybackOrderMode, PlaybackOrderMode> = {
  sequential: 'shuffle',
  shuffle: 'repeat-one',
  'repeat-one': 'sequential',
};

export const taskbarPlaybackOrderLabels: Record<PlaybackOrderMode, string> = {
  sequential: 'Sequential',
  shuffle: 'Shuffle',
  'repeat-one': 'Repeat one',
};

type PlaybackMode = PersistedPlaybackSessionV1['mode'];

type TaskbarPlaybackOrderOptions = {
  getMode?: () => PlaybackMode | null;
  setOrder?: (mode: PlaybackOrderMode) => Promise<unknown>;
};

const setPlaybackOrder = async (mode: PlaybackOrderMode): Promise<unknown> => {
  const { isUltraLightModeActive, controlUltraLightModePlayback } = await import('./UltraLightModeService');
  const request = { type: 'setPlaybackOrder', mode } as const;
  return isUltraLightModeActive()
    ? controlUltraLightModePlayback(request)
    : getMainWindowPlaybackCommandRelay().executeControl(request);
};

export class TaskbarPlaybackOrderController {
  private readonly getMode: () => PlaybackMode | null;
  private readonly setOrder: (mode: PlaybackOrderMode) => Promise<unknown>;
  private operationLane: Promise<unknown> = Promise.resolve();

  constructor(options: TaskbarPlaybackOrderOptions = {}) {
    this.getMode = options.getMode ?? (() => getPlaybackSessionStore().getPlaybackMode());
    this.setOrder = options.setOrder ?? setPlaybackOrder;
  }

  getOrder(): PlaybackOrderMode | null {
    const mode = this.getMode();
    if (!mode) return null;
    return mode.isShuffleEnabled ? 'shuffle' : mode.repeatMode === 'one' ? 'repeat-one' : 'sequential';
  }

  cycle(): Promise<unknown> {
    const operation = (): Promise<unknown> => {
      const current = this.getOrder();
      return current ? this.setOrder(nextPlaybackOrder[current]) : Promise.resolve();
    };
    const queued = this.operationLane.then(operation, operation);
    // Each click waits for the persisted result of the previous command.
    this.operationLane = queued.catch(() => undefined);
    return queued;
  }
}
