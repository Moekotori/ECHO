import { describe, expect, it, vi } from 'vitest';
import { LyricsRomanizationWorkerHost } from './lyricsRomanizationWorkerHost';

describe('LyricsRomanizationWorkerHost', () => {
  it('loads the CommonJS-shaped dependencies and converts Japanese text', async () => {
    const host = new LyricsRomanizationWorkerHost();

    await expect(
      host.handle({ requestId: 1, type: 'romanize', texts: ['君が好き'] }),
    ).resolves.toEqual({
      requestId: 1,
      ok: true,
      results: [{ text: '君が好き', romanization: 'kimi ga suki' }],
    });
  });

  it('serially converts each uncached text, caches null, and bounds its LRU', async () => {
    const convert = vi.fn(async (text: string) => (text === 'bad' ? '' : `r:${text}`));
    const host = new LyricsRomanizationWorkerHost(async () => ({ convert }), 2);

    await host.handle({ requestId: 1, type: 'romanize', texts: ['a', 'a', 'bad'] });
    expect(convert.mock.calls.map(([text]) => text)).toEqual(['a', 'bad']);
    expect(host.getCacheSize()).toBe(2);

    await host.handle({ requestId: 2, type: 'romanize', texts: ['bad', 'c', 'a'] });
    expect(convert.mock.calls.map(([text]) => text)).toEqual(['a', 'bad', 'c', 'a']);
    expect(host.getCacheSize()).toBe(2);
  });

  it('returns a request-scoped error when dynamic loading fails', async () => {
    const host = new LyricsRomanizationWorkerHost(async () => {
      throw new Error('dynamic import failed');
    });

    await expect(
      host.handle({ requestId: 7, type: 'romanize', texts: ['君'] }),
    ).resolves.toEqual({ requestId: 7, ok: false, message: 'dynamic import failed' });
  });

  it('rejects an invalid protocol request without converting text', async () => {
    const convert = vi.fn(async () => 'unused');
    const host = new LyricsRomanizationWorkerHost(async () => ({ convert }));

    await expect(host.handle({ requestId: 9, type: 'wrong', texts: ['君'] })).resolves.toEqual({
      requestId: 9,
      ok: false,
      message: 'Invalid lyrics romanization worker request',
    });
    expect(convert).not.toHaveBeenCalled();
  });
});
