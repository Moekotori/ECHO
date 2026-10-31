import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runNonCriticalMainWork } from './MainProcessWorkScheduler';

const audioState = vi.hoisted(() => ({ current: 'idle' }));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => ({ state: audioState.current }),
  }),
}));

describe('MainProcessWorkScheduler', () => {
  beforeEach(() => {
    audioState.current = 'idle';
  });

  it('runs non-critical work while playback is idle', async () => {
    const work = vi.fn(() => 'fresh');
    const fallback = vi.fn(() => 'cached');

    await expect(runNonCriticalMainWork({
      name: 'library:stats',
      work,
      fallback,
    })).resolves.toBe('fresh');

    expect(work).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses fallback instead of non-critical work while playback is active', async () => {
    audioState.current = 'playing';
    const work = vi.fn(() => 'fresh');
    const fallback = vi.fn(() => 'cached');

    await expect(runNonCriticalMainWork({
      name: 'library:stats',
      work,
      fallback,
    })).resolves.toBe('cached');

    expect(work).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith('playback-active');
  });

  it('treats loading playback as active main work pressure', async () => {
    audioState.current = 'loading';
    const work = vi.fn(() => 'fresh');
    const fallback = vi.fn(() => 'cached');

    await expect(runNonCriticalMainWork({
      name: 'library:stats',
      work,
      fallback,
    })).resolves.toBe('cached');

    expect(work).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith('playback-active');
  });

  it('runs non-critical work while playback is paused', async () => {
    audioState.current = 'paused';
    const work = vi.fn(() => 'fresh');
    const fallback = vi.fn(() => 'cached');

    await expect(runNonCriticalMainWork({
      name: 'library:stats',
      work,
      fallback,
    })).resolves.toBe('fresh');

    expect(work).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs non-critical work after playback has ended', async () => {
    audioState.current = 'ended';
    const work = vi.fn(() => 'fresh');
    const fallback = vi.fn(() => 'cached');

    await expect(runNonCriticalMainWork({
      name: 'library:stats',
      work,
      fallback,
    })).resolves.toBe('fresh');

    expect(work).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});
