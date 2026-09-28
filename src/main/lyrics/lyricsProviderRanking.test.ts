import { describe, expect, it } from 'vitest';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import { hasSafeLyricsProviderItem, providerSearchVariants, rankLyricsProviderItems } from './lyricsProviderRanking';

const query = { title: 'Echo Song (Cover)', artist: 'Singer', durationSeconds: 120 };
const request = { query, normalized: buildNormalizedLyricsQuery(query), timeoutMs: 1000 };
const recording = { title: 'Echo Song', artist: 'Singer', album: null, durationSeconds: 121 };

describe('provider query budget and ranking', () => {
  it('puts a verified recording ahead of an exact-duration wrong version', () => {
    const live = { ...recording, title: 'Echo Song (Live)', durationSeconds: 120 };
    expect(rankLyricsProviderItems(request, [live, recording])).toEqual([recording, live]);
    expect(hasSafeLyricsProviderItem(request, [live])).toBe(false);
    expect(hasSafeLyricsProviderItem(request, [recording])).toBe(true);
  });

  it('deduplicates the actual search terms and limits automatic fallback work', () => {
    const variants = Array.from({ length: 8 }, (_, index) => ({
      title: index < 3 ? 'Echo Song' : `Alias ${index}`, artist: 'Singer', album: `Album ${index}`,
      reason: 'test', priority: 100 - index,
    }));
    const input = { ...request, normalized: { ...request.normalized, searchVariants: variants } };
    expect(providerSearchVariants(input)).toHaveLength(3);
    expect(providerSearchVariants({ ...input, collectAllCandidates: true })).toHaveLength(6);
  });
});
