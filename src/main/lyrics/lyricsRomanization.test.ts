import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeLyricsRomanizationWorker,
  fillMissingRomanization,
  fillMissingRomanizationForTest,
  getLyricsRomanizationWorkerDiagnostics,
  hasMissingRomanization,
  lyricsRomanizationBatchSize,
  type LyricsRomanizationRunner,
} from './lyricsRomanization';

const runnerFrom = (
  convert: (text: string) => string | null = (text) => `romaji:${text}`,
): LyricsRomanizationRunner => ({
  romanize: vi.fn(async (texts: string[]) =>
    texts.map((text) => ({ text, romanization: convert(text) }))),
});

afterEach(() => {
  disposeLyricsRomanizationWorker();
});

describe('lyricsRomanization', () => {
  it('does not create the lazy worker when no line needs romanization', async () => {
    const noJapanese = [
      { timeMs: 1000, text: 'Hello' },
      { timeMs: 2000, text: '안녕하세요' },
    ];
    const alreadyFilled = [{ timeMs: 1000, text: '君が好き', romanization: 'kimi ga suki' }];

    expect(await fillMissingRomanization(noJapanese)).toBe(noJapanese);
    expect(await fillMissingRomanization(alreadyFilled)).toBe(alreadyFilled);
    expect(getLyricsRomanizationWorkerDiagnostics()).toEqual({ clientCreated: false });
    expect(hasMissingRomanization(noJapanese)).toBe(false);
    expect(hasMissingRomanization(alreadyFilled)).toBe(false);
  });

  it('fills missing romaji without overwriting provider data or other lyric fields', async () => {
    const runner = runnerFrom((text) => (text === '君が好き' ? 'kimi ga suki' : null));
    const words = [{ startMs: 1000, endMs: 1200, text: '君' }];
    const input = [
      { timeMs: 1000, text: '君が好き', translation: 'I like you', words },
      { timeMs: 2000, text: '夢', romanization: 'provider yume' },
      { timeMs: 3000, text: 'Hello' },
    ];

    const lines = await fillMissingRomanizationForTest(input, runner);

    expect(lines).toEqual([
      {
        timeMs: 1000,
        text: '君が好き',
        translation: 'I like you',
        words,
        romanization: 'kimi ga suki',
      },
      { timeMs: 2000, text: '夢', romanization: 'provider yume' },
      { timeMs: 3000, text: 'Hello' },
    ]);
    expect(lines[0]?.words).toBe(words);
    expect(runner.romanize).toHaveBeenCalledWith(['君が好き']);
  });

  it('deduplicates repeated chorus text and maps one result to every missing line', async () => {
    const runner = runnerFrom(() => 'kimi ga suki');
    const input = [
      { timeMs: 1000, text: '君が好き' },
      { timeMs: 2000, text: '君が好き' },
      { timeMs: 3000, text: '君が好き', romanization: 'provider value' },
    ];

    const lines = await fillMissingRomanizationForTest(input, runner);

    expect(runner.romanize).toHaveBeenCalledTimes(1);
    expect(runner.romanize).toHaveBeenCalledWith(['君が好き']);
    expect(lines.map((line) => line.romanization)).toEqual([
      'kimi ga suki',
      'kimi ga suki',
      'provider value',
    ]);
  });

  it('processes every unique line in bounded sequential batches without truncation', async () => {
    const runner = runnerFrom((text) => `romaji ${text}`);
    const input = Array.from({ length: lyricsRomanizationBatchSize * 2 + 7 }, (_, index) => ({
      timeMs: index * 1000,
      text: `あ${index}`,
    }));

    const lines = await fillMissingRomanizationForTest(input, runner);

    expect(runner.romanize).toHaveBeenCalledTimes(3);
    expect(vi.mocked(runner.romanize).mock.calls.map(([texts]) => texts.length)).toEqual([
      lyricsRomanizationBatchSize,
      lyricsRomanizationBatchSize,
      7,
    ]);
    expect(lines.every((line) => Boolean(line.romanization))).toBe(true);
  });

  it('keeps successful batches and preserves original lines for a failed batch', async () => {
    let callCount = 0;
    const runner: LyricsRomanizationRunner = {
      romanize: vi.fn(async (texts: string[]) => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error('worker failed');
        }
        return texts.map((text) => ({ text, romanization: `romaji ${text}` }));
      }),
    };
    const input = Array.from({ length: lyricsRomanizationBatchSize + 2 }, (_, index) => ({
      timeMs: index * 1000,
      text: `あ${index}`,
    }));

    const lines = await fillMissingRomanizationForTest(input, runner);

    expect(lines.slice(0, lyricsRomanizationBatchSize).every((line) => line.romanization)).toBe(true);
    expect(lines.slice(lyricsRomanizationBatchSize)).toEqual(
      input.slice(lyricsRomanizationBatchSize),
    );
  });

  it('returns the original array when the worker fails or returns unusable results', async () => {
    const input = [{ timeMs: 1000, text: '君が好き' }];
    const failed: LyricsRomanizationRunner = {
      romanize: vi.fn(async () => {
        throw new Error('unavailable');
      }),
    };
    const empty = runnerFrom(() => null);
    const unchanged = runnerFrom((text) => text);

    expect(await fillMissingRomanizationForTest(input, failed)).toBe(input);
    expect(await fillMissingRomanizationForTest(input, empty)).toBe(input);
    expect(await fillMissingRomanizationForTest(input, unchanged)).toBe(input);
  });

  it('does not treat Chinese-only Han lyrics as Japanese romaji candidates', async () => {
    const input = [
      { timeMs: 1000, text: '还为分手前那句抱歉在感动' },
      { timeMs: 2000, text: '穿梭时间的画面的钟' },
    ];

    const lines = await fillMissingRomanizationForTest(input, runnerFrom());

    expect(lines).toBe(input);
    expect(hasMissingRomanization(input)).toBe(false);
  });

  it('ignores a lone kana-like decoration in otherwise Chinese lyrics', async () => {
    const input = [
      { timeMs: 1000, text: '爱的の感觉还在' },
      { timeMs: 2000, text: '穿梭时间的画面的钟' },
    ];

    const lines = await fillMissingRomanizationForTest(input, runnerFrom());

    expect(lines).toBe(input);
    expect(hasMissingRomanization(input)).toBe(false);
  });

  it('still romanizes Han-only lines when the lyric set has kana context', async () => {
    const runner = runnerFrom((text) => (text === '夢' ? 'yume' : 'kimi ga suki'));
    const lines = await fillMissingRomanizationForTest(
      [
        { timeMs: 1000, text: '夢' },
        { timeMs: 2000, text: '君が好き' },
      ],
      runner,
    );

    expect(lines[0]).toEqual({ timeMs: 1000, text: '夢', romanization: 'yume' });
    expect(lines[1]).toEqual({ timeMs: 2000, text: '君が好き', romanization: 'kimi ga suki' });
  });
});
