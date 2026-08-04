import { describe, expect, it } from 'vitest';
import { libraryTextSortKey } from './LibrarySortKey';

describe('libraryTextSortKey', () => {
  it('orders Chinese artist names by pinyin while preserving Latin names', () => {
    const names = [
      '\u5468\u6770\u4f26',
      '\u4e94\u6708\u5929',
      'Ado',
      '\u8349\u4e1c\u6ca1\u6709\u6d3e\u5bf9',
      '\u9648\u5955\u8fc5',
      '\u5f20\u5b66\u53cb',
    ];

    expect([...names].sort((left, right) => libraryTextSortKey(left).localeCompare(libraryTextSortKey(right)))).toEqual([
      'Ado',
      '\u8349\u4e1c\u6ca1\u6709\u6d3e\u5bf9',
      '\u9648\u5955\u8fc5',
      '\u4e94\u6708\u5929',
      '\u5f20\u5b66\u53cb',
      '\u5468\u6770\u4f26',
    ]);
  });

  it('orders Chinese album titles by pinyin', () => {
    const titles = [
      '\u9b54\u6cd5\u7535\u53f0',
      '\u8303\u7279\u897f',
      '\u4e03\u91cc\u9999',
      '1989',
      'Zebra',
      '\u516b\u5ea6\u7a7a\u95f4',
    ];

    expect([...titles].sort((left, right) => libraryTextSortKey(left).localeCompare(libraryTextSortKey(right)))).toEqual([
      '1989',
      '\u516b\u5ea6\u7a7a\u95f4',
      '\u8303\u7279\u897f',
      '\u9b54\u6cd5\u7535\u53f0',
      '\u4e03\u91cc\u9999',
      'Zebra',
    ]);
  });
});
