import { describe, expect, it, vi } from 'vitest';
import type { PersistedPlaybackSessionV1, PlaybackOrderMode } from '../../shared/types/playback';
import { TaskbarPlaybackOrderController } from './taskbarPlaybackOrder';

const modeFor = (order: PlaybackOrderMode): PersistedPlaybackSessionV1['mode'] => ({
  automixEnabled: false,
  repeatMode: order === 'repeat-one' ? 'one' : 'off',
  isShuffleEnabled: order === 'shuffle',
});

describe('TaskbarPlaybackOrderController', () => {
  it('cycles all modes using the acknowledged queue state', async () => {
    let mode = modeFor('sequential');
    const setOrder = vi.fn(async (order: PlaybackOrderMode) => { mode = modeFor(order); });
    const controller = new TaskbarPlaybackOrderController({ getMode: () => mode, setOrder });

    await controller.cycle();
    expect(controller.getOrder()).toBe('shuffle');
    await controller.cycle();
    expect(controller.getOrder()).toBe('repeat-one');
    await controller.cycle();
    expect(controller.getOrder()).toBe('sequential');
    expect(setOrder.mock.calls.map(([order]) => order)).toEqual(['shuffle', 'repeat-one', 'sequential']);
  });

  it('serializes rapid clicks until the previous mode is saved', async () => {
    let mode = modeFor('sequential');
    let finish!: () => void;
    const setOrder = vi.fn(async (order: PlaybackOrderMode) => {
      if (order === 'shuffle') await new Promise<void>((resolve) => { finish = resolve; });
      mode = modeFor(order);
    });
    const controller = new TaskbarPlaybackOrderController({ getMode: () => mode, setOrder });

    const first = controller.cycle();
    const second = controller.cycle();
    await Promise.resolve();
    expect(setOrder).toHaveBeenCalledTimes(1);
    expect(controller.getOrder()).toBe('sequential');
    finish();
    await Promise.all([first, second]);
    expect(controller.getOrder()).toBe('repeat-one');
  });

  it('reports a rejected command and can retry without inventing a new mode', async () => {
    let mode = modeFor('sequential');
    const setOrder = vi.fn<(order: PlaybackOrderMode) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('queue_save_failed'))
      .mockImplementationOnce(async (order) => { mode = modeFor(order); });
    const controller = new TaskbarPlaybackOrderController({ getMode: () => mode, setOrder });

    await expect(controller.cycle()).rejects.toThrow('queue_save_failed');
    expect(controller.getOrder()).toBe('sequential');
    await controller.cycle();
    expect(setOrder.mock.calls.map(([order]) => order)).toEqual(['shuffle', 'shuffle']);
  });

  it('disables cycling when there is no persisted queue', async () => {
    const setOrder = vi.fn();
    const controller = new TaskbarPlaybackOrderController({ getMode: () => null, setOrder });
    expect(controller.getOrder()).toBeNull();
    await controller.cycle();
    expect(setOrder).not.toHaveBeenCalled();
  });
});
