import { describe, expect, it } from 'vitest';
import { chineseSearchVariants } from './ChineseSearchVariants';

describe('chineseSearchVariants', () => {
  it('includes simplified and traditional variants for a search term', () => {
    expect(chineseSearchVariants('爱与梦')).toEqual(expect.arrayContaining(['爱与梦', '愛與夢']));
    expect(chineseSearchVariants('愛與夢')).toEqual(expect.arrayContaining(['爱与梦', '愛與夢']));
    expect(chineseSearchVariants('里面')).toEqual(expect.arrayContaining(['里面', '裡面', '裏面']));
  });

  it('deduplicates unchanged terms', () => {
    expect(chineseSearchVariants('Echo')).toEqual(['Echo']);
  });
});
