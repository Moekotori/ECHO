import { describe, expect, it } from 'vitest';
import OpenCC from 'opencc-js';
import { getOpenCCConverter, getOpenCCTrieCountForTests, type OpenCCLocale } from './openccConverters';

const pairs: Array<[OpenCCLocale, OpenCCLocale]> = [
  ['cn', 'tw'], ['cn', 'hk'], ['cn', 't'], ['tw', 'cn'], ['hk', 'cn'],
  ['t', 'cn'], ['tw', 'hk'], ['hk', 'tw'], ['jp', 'cn'],
];
const samples = [
  '爱与梦 裏面 裡面', '软件 硬件 网络 程序员', '鼠标 光标 硅谷 出租车 公交车 计程车',
  '為什麼這麼慢', '着 著 麵包 面包', '東京タワー 藝術 芸術 発売 發売',
  '頭髮 發展 干杯 乾燥 音樂 樂隊', 'Hello 世界 😀 𠀋 ECHO Player', '', 'ascii only',
];

describe('shared OpenCC dictionaries', () => {
  it.each(pairs)('preserves OpenCC output for %s to %s, including phrases and mixed scripts', (from, to) => {
    const reference = OpenCC.Converter({ from, to });
    const shared = getOpenCCConverter(from, to);
    for (const sample of samples) expect(shared(sample)).toBe(reference(sample));
  });

  it('shares common tries across search and MV converters without rebuilding on use', () => {
    for (const [from, to] of pairs) getOpenCCConverter(from, to);
    const before = getOpenCCTrieCountForTests();
    const search = getOpenCCConverter('tw', 'cn');
    const mv = getOpenCCConverter('tw', 'cn');
    expect(search).toBe(mv);
    for (const [from, to] of pairs) getOpenCCConverter(from, to)('裡面 爱与梦');
    expect(getOpenCCTrieCountForTests()).toBe(before);
    // These nine distinct converters originally built separate segmentation
    // and conversion tries, even when dictionary groups were identical.
    expect(before).toBeLessThanOrEqual(14);
  });
});
