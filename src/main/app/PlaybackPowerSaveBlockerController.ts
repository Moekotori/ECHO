import type { AudioStatus } from '../../shared/types/audio';

export type PlaybackStatusSource = {
  getStatus: () => AudioStatus;
  on: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
  off: (event: 'status', listener: (status: AudioStatus) => void) => unknown;
};

export type PowerSaveBlockerApi = {
  start: (type: 'prevent-display-sleep') => number;
  stop: (id: number) => void;
  isStarted: (id: number) => boolean;
};

const powerBlockingPlaybackStates = new Set<AudioStatus['state']>(['loading', 'playing']);

export const shouldPreventDisplaySleepForPlayback = (status: Pick<AudioStatus, 'state'>): boolean =>
  powerBlockingPlaybackStates.has(status.state);

export class PlaybackPowerSaveBlockerController {
  private blockerId: number | null = null;
  private initialized = false;

  constructor(
    private readonly statusSource: PlaybackStatusSource,
    private readonly blocker: PowerSaveBlockerApi,
    private readonly isEnabled: () => boolean,
  ) {}

  initialize(): void {
    if (this.initialized) {
      this.refresh();
      return;
    }

    this.initialized = true;
    this.statusSource.on('status', this.handleStatus);
    this.refresh();
  }

  refresh(status: AudioStatus = this.statusSource.getStatus()): void {
    if (this.isEnabled() && shouldPreventDisplaySleepForPlayback(status)) {
      if (this.blockerId === null || !this.blocker.isStarted(this.blockerId)) {
        this.blockerId = this.blocker.start('prevent-display-sleep');
      }
      return;
    }

    this.stopBlocker();
  }

  dispose(): void {
    if (this.initialized) {
      this.statusSource.off('status', this.handleStatus);
    }
    this.initialized = false;
    this.stopBlocker();
  }

  private readonly handleStatus = (status: AudioStatus): void => {
    this.refresh(status);
  };

  private stopBlocker(): void {
    if (this.blockerId === null) {
      return;
    }

    if (this.blocker.isStarted(this.blockerId)) {
      this.blocker.stop(this.blockerId);
    }
    this.blockerId = null;
  }
}
