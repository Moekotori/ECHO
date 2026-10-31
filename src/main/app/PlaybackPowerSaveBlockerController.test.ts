import { describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import {
  PlaybackPowerSaveBlockerController,
  shouldPreventDisplaySleepForPlayback,
  type PlaybackStatusSource,
} from './PlaybackPowerSaveBlockerController';

const makeStatus = (state: AudioStatus['state']): AudioStatus => ({ state } as AudioStatus);

class FakeStatusSource implements PlaybackStatusSource {
  private listener: ((status: AudioStatus) => void) | null = null;

  constructor(private status: AudioStatus) {}

  getStatus(): AudioStatus {
    return this.status;
  }

  on(_event: 'status', listener: (status: AudioStatus) => void): void {
    this.listener = listener;
  }

  off(_event: 'status', listener: (status: AudioStatus) => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  update(state: AudioStatus['state']): void {
    this.status = makeStatus(state);
    this.listener?.(this.status);
  }
}

describe('PlaybackPowerSaveBlockerController', () => {
  it('blocks display sleep only while playback is loading or playing', () => {
    expect(shouldPreventDisplaySleepForPlayback(makeStatus('loading'))).toBe(true);
    expect(shouldPreventDisplaySleepForPlayback(makeStatus('playing'))).toBe(true);
    expect(shouldPreventDisplaySleepForPlayback(makeStatus('paused'))).toBe(false);
    expect(shouldPreventDisplaySleepForPlayback(makeStatus('stopped'))).toBe(false);
  });

  it('starts and releases one blocker as host playback state changes', () => {
    const source = new FakeStatusSource(makeStatus('idle'));
    const activeIds = new Set<number>();
    const blocker = {
      start: vi.fn(() => {
        activeIds.add(7);
        return 7;
      }),
      stop: vi.fn((id: number) => activeIds.delete(id)),
      isStarted: vi.fn((id: number) => activeIds.has(id)),
    };
    const controller = new PlaybackPowerSaveBlockerController(source, blocker, () => true);

    controller.initialize();
    source.update('loading');
    source.update('playing');
    expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');

    source.update('paused');
    expect(blocker.stop).toHaveBeenCalledWith(7);

    source.update('playing');
    controller.dispose();
    expect(blocker.start).toHaveBeenCalledTimes(2);
    expect(blocker.stop).toHaveBeenCalledTimes(2);
  });

  it('releases an active blocker when the setting is disabled', () => {
    const source = new FakeStatusSource(makeStatus('playing'));
    let enabled = true;
    const activeIds = new Set<number>();
    const blocker = {
      start: vi.fn(() => {
        activeIds.add(3);
        return 3;
      }),
      stop: vi.fn((id: number) => activeIds.delete(id)),
      isStarted: vi.fn((id: number) => activeIds.has(id)),
    };
    const controller = new PlaybackPowerSaveBlockerController(source, blocker, () => enabled);

    controller.initialize();
    enabled = false;
    controller.refresh();

    expect(blocker.stop).toHaveBeenCalledWith(3);
  });
});
