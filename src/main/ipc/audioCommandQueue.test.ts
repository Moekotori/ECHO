import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueAudioCommand, flushAudioCommandQueue, isAudioCommandTimeoutError } from './audioCommandQueue';

const AUDIO_COMMAND_TIMEOUT_MS = 15_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('audioCommandQueue', () => {
  it('timed-out command unblocks the queue', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let secondCommandRan = false;

    const timedOutCommand = enqueueAudioCommand(() => new Promise<void>(() => undefined));

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS + 100);

    await expect(enqueueAudioCommand(() => {
      secondCommandRan = true;
      return undefined;
    })).resolves.toBeUndefined();

    await expect(timedOutCommand).rejects.toMatchObject({
      code: 'audio_command_timeout',
      message: 'audio_command_timeout',
      timeoutMs: AUDIO_COMMAND_TIMEOUT_MS,
    });
    expect(secondCommandRan).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[audioCommandQueue] command timed out after 15 s');
    await flushAudioCommandQueue();
  });

  it('caller receives an identifiable timeout error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = enqueueAudioCommand(() => new Promise<void>(() => undefined));

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS);

    try {
      await result;
      throw new Error('expected timeout');
    } catch (error) {
      expect(isAudioCommandTimeoutError(error)).toBe(true);
    }
    await flushAudioCommandQueue();
  });
});
