import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';

const update = vi.hoisted(() => vi.fn());
vi.mock('./taskbarHostProcess', () => ({ updateTaskbarHostState: update }));
import { UltraLightNativeTaskbar } from './UltraLightNativeTaskbar';

describe('UltraLightNativeTaskbar', () => {
  beforeEach(() => update.mockClear());
  it('coalesces progress ticks but publishes playback and track changes immediately', () => {
    const player = new UltraLightNativeTaskbar();
    const status = { state: 'playing', currentTrackId: 'a', currentTrackTitle: 'A', positionSeconds: 1.1, durationSeconds: 100 } as AudioStatus;
    player.update(status);
    player.update({ ...status, positionSeconds: 1.9 });
    expect(update).toHaveBeenCalledTimes(1);
    player.update({ ...status, state: 'paused' });
    player.update({ ...status, currentTrackId: 'b', currentTrackTitle: 'B' });
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'B', coverPath: '', lyrics: '' }));
    player.reset();
    player.update({ ...status, currentTrackId: 'b', currentTrackTitle: 'B' });
    expect(update).toHaveBeenCalledTimes(4);
  });
});
