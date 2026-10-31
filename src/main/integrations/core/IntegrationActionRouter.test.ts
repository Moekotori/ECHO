import { describe, expect, it, vi } from 'vitest';
import { IntegrationActionRouter } from './IntegrationActionRouter';

describe('IntegrationActionRouter', () => {
  it('maps all basic actions to the typed renderer control surface', async () => {
    const executeControl = vi.fn().mockResolvedValue(undefined);
    const router = new IntegrationActionRouter({ relay: { executeControl }, now: () => 1_000 });

    await router.execute({ requestId: 'play-1', action: 'play' });
    await router.execute({ requestId: 'pause-1', action: 'pause' });
    await router.execute({ requestId: 'stop-1', action: 'stop' });
    await router.execute({ requestId: 'previous-1', action: 'previous' });
    await router.execute({ requestId: 'next-1', action: 'next' });
    await router.execute({ requestId: 'seek-1', action: 'seek', positionMs: 12_345 });
    await router.execute({ requestId: 'volume-1', action: 'setVolume', volume: 0.25 });
    const result = await router.execute({ requestId: 'order-1', action: 'setPlaybackOrder', mode: 'shuffle' });

    expect(executeControl).toHaveBeenNthCalledWith(1, { type: 'play' });
    expect(executeControl).toHaveBeenNthCalledWith(2, { type: 'pause' });
    expect(executeControl).toHaveBeenNthCalledWith(3, { type: 'stop' });
    expect(executeControl).toHaveBeenNthCalledWith(4, { type: 'previous' });
    expect(executeControl).toHaveBeenNthCalledWith(5, { type: 'next' });
    expect(executeControl).toHaveBeenNthCalledWith(6, { type: 'seek', positionSeconds: 12.345 });
    expect(executeControl).toHaveBeenNthCalledWith(7, { type: 'setVolume', volume: 0.25 });
    expect(executeControl).toHaveBeenNthCalledWith(8, { type: 'setPlaybackOrder', mode: 'shuffle' });
    expect(result).toEqual({ requestId: 'order-1', ok: true, completedAt: new Date(1_000).toISOString() });
  });
});
