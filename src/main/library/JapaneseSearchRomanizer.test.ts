import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn(async () => {}), convert: vi.fn(async () => 'kimi') }));
vi.mock('kuroshiro', () => ({ default: class {
  init = mocks.init;
  convert = mocks.convert;
} }));
vi.mock('kuroshiro-analyzer-kuromoji', () => ({ default: class {} }));

describe('Japanese search romanizer residency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.init.mockReset().mockResolvedValue(undefined);
    mocks.convert.mockReset().mockResolvedValue('kimi');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares initialization and reloads only after the idle lease expires', async () => {
    const { preloadSearchIndexRomanizer: preload, japaneseRomanizerIdleMs: idle } = await import('./JapaneseSearchRomanizer');
    expect(await Promise.all([preload(), preload()])).toEqual([true, true]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(idle - 1);
    await preload();
    await vi.advanceTimersByTimeAsync(idle - 1);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await preload();
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });

  it('keeps a shared instance while any conversion is still running', async () => {
    const { withJapaneseSearchRomanizer: use, preloadSearchIndexRomanizer: preload, japaneseRomanizerIdleMs: idle } = await import('./JapaneseSearchRomanizer');
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const running = use(async romanizer => { await pending; return romanizer!.convert('君', { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' }); });
    await preload();
    await vi.advanceTimersByTimeAsync(idle * 2);
    await preload();
    expect(mocks.init).toHaveBeenCalledTimes(1);
    finish();
    expect(await running).toBe('kimi');
    await vi.advanceTimersByTimeAsync(idle);
    await preload();
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });

  it('releases the lease after a caller fails', async () => {
    const { withJapaneseSearchRomanizer: use, preloadSearchIndexRomanizer: preload, japaneseRomanizerIdleMs: idle } = await import('./JapaneseSearchRomanizer');
    await expect(use(() => { throw new Error('conversion failed'); })).rejects.toThrow('conversion failed');
    await vi.advanceTimersByTimeAsync(idle);
    await preload();
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed initialization on every idle cycle', async () => {
    mocks.init.mockRejectedValue(new Error('unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { preloadSearchIndexRomanizer: preload, japaneseRomanizerIdleMs: idle } = await import('./JapaneseSearchRomanizer');
    expect(await preload()).toBe(false);
    await vi.advanceTimersByTimeAsync(idle * 2);
    expect(await preload()).toBe(false);
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });
});
