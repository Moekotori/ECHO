import { describe, expect, it } from 'vitest';
import { fillMissingRomanization, hasMissingRomanization } from './lyricsRomanization';

describe('lyricsRomanization', () => {
  it('loads kuroshiro from its CommonJS-shaped ESM namespace and fills missing romaji', async () => {
    const lines = await fillMissingRomanization([{ timeMs: 1000, text: '君が好き' }]);

    expect(lines).toEqual([{ timeMs: 1000, text: '君が好き', romanization: 'kimi ga suki' }]);
  });

  it('does not treat Chinese-only Han lyrics as Japanese romaji candidates', async () => {
    const input = [
      { timeMs: 1000, text: '还为分手前那句抱歉在感动' },
      { timeMs: 2000, text: '穿梭时间的画面的钟' },
    ];

    const lines = await fillMissingRomanization(input);

    expect(lines).toBe(input);
    expect(hasMissingRomanization(input)).toBe(false);
  });

  it('ignores a lone kana-like decoration in otherwise Chinese lyrics', async () => {
    const input = [
      { timeMs: 1000, text: '爱的の感觉还在' },
      { timeMs: 2000, text: '穿梭时间的画面的钟' },
    ];

    const lines = await fillMissingRomanization(input);

    expect(lines).toBe(input);
    expect(hasMissingRomanization(input)).toBe(false);
  });

  it('still romanizes Han-only lines when the lyric set has kana context', async () => {
    const lines = await fillMissingRomanization([
      { timeMs: 1000, text: '夢' },
      { timeMs: 2000, text: '君が好き' },
    ]);

    expect(lines[0]).toEqual({ timeMs: 1000, text: '夢', romanization: 'yume' });
    expect(lines[1]).toEqual({ timeMs: 2000, text: '君が好き', romanization: 'kimi ga suki' });
  });
});
