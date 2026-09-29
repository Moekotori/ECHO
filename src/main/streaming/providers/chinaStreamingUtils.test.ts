import { describe, expect, it } from 'vitest';
import { linesFromLyrics, splitLyricsByKind } from './chinaStreamingUtils';

describe('chinaStreamingUtils', () => {
  it('folds same-timestamp embedded alternates before returning streaming lyrics', () => {
    const lines = linesFromLyrics(
      [
        '[00:08.48]世界中のすべての人間に',
        '[00:08.48]se ka i ju u no su be te no ni n ge n ni',
        '[00:08.48]如果试着去取悦全世界的人',
      ].join('\n'),
      null,
    );

    expect(lines).toEqual([
      {
        timeMs: 8480,
        text: '世界中のすべての人間に',
        romanization: 'se ka i ju u no su be te no ni n ge n ni',
        translation: '如果试着去取悦全世界的人',
      },
    ]);
  });

  it('does not attach secondary streaming lyrics by line index when timestamps disagree', () => {
    const lines = linesFromLyrics(
      '[00:10.00]Hello\n[00:20.00]World',
      null,
      '[00:01.00]你好\n[00:02.00]世界',
      '[00:01.00]hello\n[00:02.00]world',
    );

    expect(lines).toEqual([
      { timeMs: 10000, text: 'Hello' },
      { timeMs: 20000, text: 'World' },
    ]);
  });

  it('treats provider pure-music placeholders as non-lyrics', () => {
    expect(splitLyricsByKind('[00:00.00]\u6b64\u6b4c\u66f2\u4e3a\u6ca1\u6709\u586b\u8bcd\u7684\u7eaf\u97f3\u4e50\uff0c\u8bf7\u60a8\u6b23\u8d4f')).toEqual({
      syncedLyrics: null,
      plainLyrics: null,
    });
  });
});
