import { describe, expect, it } from 'vitest';
import { KugouLyricsProvider } from './KugouLyricsProvider';
import { KuwoLyricsProvider } from './KuwoLyricsProvider';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import type { LyricsQuery } from '../../shared/types/lyrics';

const chineseQuery: LyricsQuery = {
  trackId: 'live-lyrics-test',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  durationSeconds: 269,
};

const japaneseQuery: LyricsQuery = {
  trackId: 'live-lyrics-japanese-test',
  title: 'リルラ リルハ',
  artist: '遠野ひかる',
  album: '「負けヒロインが多すぎる！」マケイン応援！カバーソングコレクション',
  durationSeconds: 234,
};

const requestFor = (query: LyricsQuery) => ({
  query,
  normalized: buildNormalizedLyricsQuery(query),
  timeoutMs: 8000,
});

describe.runIf(process.env.ECHO_LIVE_LYRICS === '1')('China lyrics providers live network', () => {
  it('returns real KuGou and Kuwo lyrics candidates', async () => {
    const startedAt = Date.now();
    const request = requestFor(chineseQuery);
    const [kugou, kuwo] = await Promise.all([
      new KugouLyricsProvider().search(request),
      new KuwoLyricsProvider().search(request),
    ]);

    expect(Date.now() - startedAt).toBeLessThan(12000);
    expect(kugou.length).toBeGreaterThan(0);
    expect(kuwo.length).toBeGreaterThan(0);
    expect(kugou.some((candidate) => candidate.syncedLyrics || candidate.plainLyrics)).toBe(true);
    expect(kuwo.some((candidate) => candidate.syncedLyrics || candidate.plainLyrics)).toBe(true);
  }, 15000);

  it('returns a real KuGou candidate for Japanese catalog matches', async () => {
    const results = await new KugouLyricsProvider().search(requestFor(japaneseQuery));

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((candidate) => candidate.provider === 'kugou' && candidate.syncedLyrics)).toBe(true);
  }, 15000);
});
