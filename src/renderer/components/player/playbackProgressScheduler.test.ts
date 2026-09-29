// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lowLoadPlaybackProgressRenderIntervalMs,
  normalPlaybackProgressRenderIntervalMs,
  startPlaybackProgressUpdates,
  unfocusedPlaybackProgressRenderIntervalMs,
} from './playbackProgressScheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('playbackProgressScheduler', () => {
  it('throttles normal playback updates instead of scheduling work every animation frame', () => {
    vi.useFakeTimers();
    const update = vi.fn();

    const stop = startPlaybackProgressUpdates(update, false, true);

    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(normalPlaybackProgressRenderIntervalMs * 3);
    expect(update).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(normalPlaybackProgressRenderIntervalMs);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it('reduces normal playback updates further while the window is unfocused', () => {
    vi.useFakeTimers();
    const update = vi.fn();

    const stop = startPlaybackProgressUpdates(update, false, false);

    vi.advanceTimersByTime(unfocusedPlaybackProgressRenderIntervalMs - 1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(2);

    stop();
  });

  it('keeps the existing one-second cadence in low-load playback mode', () => {
    vi.useFakeTimers();
    const update = vi.fn();

    const stop = startPlaybackProgressUpdates(update, true, true);

    vi.advanceTimersByTime(lowLoadPlaybackProgressRenderIntervalMs - 1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(2);

    stop();
  });
});
