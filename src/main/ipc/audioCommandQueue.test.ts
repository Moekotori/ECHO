import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueAudioCommand, flushAudioCommandQueue, isAudioCommandTimeoutError } from './audioCommandQueue';

const AUDIO_COMMAND_TIMEOUT_MS = 15_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('audioCommandQueue', () => {
  it('does not overlap the next command after the caller times out', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let secondCommandRan = false;
    let finishFirstCommand!: () => void;

    const timedOutCommand = enqueueAudioCommand(() => new Promise<void>((resolve) => {
      finishFirstCommand = resolve;
    }));
    const timedOutExpectation = expect(timedOutCommand).rejects.toMatchObject({
      code: 'audio_command_timeout',
      message: 'audio_command_timeout',
      timeoutMs: AUDIO_COMMAND_TIMEOUT_MS,
    });

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS + 100);

    const secondCommand = enqueueAudioCommand(() => {
      secondCommandRan = true;
      return undefined;
    });

    await timedOutExpectation;
    expect(secondCommandRan).toBe(false);
    finishFirstCommand();
    await expect(secondCommand).resolves.toBeUndefined();
    expect(secondCommandRan).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[audioCommandQueue] command timed out after 15 s');
    await flushAudioCommandQueue();
  });

  it('caller receives an identifiable timeout error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let finishCommand!: () => void;

    const result = enqueueAudioCommand(() => new Promise<void>((resolve) => {
      finishCommand = resolve;
    }));
    const handledResult = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS);

    expect(isAudioCommandTimeoutError(await handledResult)).toBe(true);
    finishCommand();
    await flushAudioCommandQueue();
  });

  it('runs timeout cleanup before releasing the caller', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onTimeout = vi.fn();
    let finishCommand!: () => void;

    const result = enqueueAudioCommand(() => new Promise<void>((resolve) => {
      finishCommand = resolve;
    }), { onTimeout });
    const timeoutExpectation = expect(result).rejects.toMatchObject({ code: 'audio_command_timeout' });

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS);

    await timeoutExpectation;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    finishCommand();
    await flushAudioCommandQueue();
  });

  it('keeps the queue usable when timeout cleanup fails', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let finishCommand!: () => void;

    const result = enqueueAudioCommand(() => new Promise<void>((resolve) => {
      finishCommand = resolve;
    }), {
      onTimeout: () => {
        throw new Error('cleanup failed');
      },
    });
    const timeoutExpectation = expect(result).rejects.toMatchObject({ code: 'audio_command_timeout' });

    await vi.advanceTimersByTimeAsync(AUDIO_COMMAND_TIMEOUT_MS);

    await timeoutExpectation;
    const next = enqueueAudioCommand(() => 'next');
    finishCommand();
    await expect(next).resolves.toBe('next');
    expect(warnSpy).toHaveBeenCalledWith('[audioCommandQueue] timeout cleanup failed: cleanup failed');
    await flushAudioCommandQueue();
  });
});
