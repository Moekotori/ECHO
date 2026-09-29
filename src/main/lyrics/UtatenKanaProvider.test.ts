import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LyricsQuery } from '../../shared/types/lyrics';
import {
  applyUtatenKanaLines,
  extractUtatenKanaLines,
  extractUtatenSearchResults,
  UtatenKanaProvider,
} from './UtatenKanaProvider';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';

const query: LyricsQuery = {
  trackId: 'track-1',
  title: '恋',
  artist: '星野源',
  album: null,
  durationSeconds: 242,
};

const searchHtml = `
  <table class="searchResult artistLyricList">
    <tr>
      <td>
        <p class="searchResult__title"><a href="/lyric/or16100101/">恋(TBS系 主題歌)</a></p>
      </td>
      <td class="searchResult__artist">
        <p><a href="/artist/6742/">星野源</a></p>
      </td>
    </tr>
  </table>
`;

const lyricHtml = `
  <h2 class="newLyricTitle__main">恋 <span class="newLyricTitle_afterTxt">歌詞</span></h2>
  <div class="newLyricWork__name"><h3><a href="/artist/6742/">星野源</a></h3></div>
  <div class="lyricBody">
    <div class="hiragana">
      <span class="ruby"><span class="rb">君</span><span class="rt">きみ</span></span>の
      <span class="ruby"><span class="rb">元</span><span class="rt">もと</span></span>へ
      <span class="ruby"><span class="rb">帰</span><span class="rt">かえ</span></span>るんだ<br />
      Hello world<br />
      <span class="ruby"><span class="rb">胸</span><span class="rt">むね</span></span>の
      <span class="ruby"><span class="rb">中</span><span class="rt">なか</span></span>にあるもの
    </div>
  </div>
`;

const htmlResponse = (value: string): Response =>
  new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UtatenKanaProvider', () => {
  it('parses UtaTen search results', () => {
    expect(extractUtatenSearchResults(searchHtml)).toEqual([
      {
        title: '恋(TBS系 主題歌)',
        artist: '星野源',
        url: 'https://utaten.com/lyric/or16100101/',
      },
    ]);
  });

  it('extracts ruby furigana as kana lines', () => {
    expect(extractUtatenKanaLines(lyricHtml)).toEqual([
      { text: '君の 元へ 帰るんだ', kana: 'きみの もとへ かえるんだ' },
      { text: 'Hello world', kana: 'Hello world' },
      { text: '胸の 中にあるもの', kana: 'むねの なかにあるもの' },
    ]);
  });

  it('looks up UtaTen and enriches exact lyric lines with kana', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(htmlResponse(searchHtml)).mockResolvedValueOnce(htmlResponse(lyricHtml));
    vi.stubGlobal('fetch', fetchMock);

    const lines = [
      { timeMs: 1000, text: '君の 元へ 帰るんだ', romanization: 'kimi no moto e kaerunda' },
      { timeMs: 2000, text: '胸の 中にあるもの', romanization: 'mune no naka ni aru mono' },
    ];
    const enriched = await new UtatenKanaProvider().enrichLines(query, lines, { timeoutMs: 2500 });

    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain('/lyric/search?sort=popular_sort_asc');
    expect(enriched).toEqual([
      { timeMs: 1000, text: '君の 元へ 帰るんだ', romanization: 'kimi no moto e kaerunda', kana: 'きみの もとへ かえるんだ' },
      { timeMs: 2000, text: '胸の 中にあるもの', romanization: 'mune no naka ni aru mono', kana: 'むねの なかにあるもの' },
    ]);
  });

  it('does not look up UtaTen for Chinese-only Han lyrics', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const lines = [
      { timeMs: 1000, text: '还为分手前那句抱歉在感动' },
      { timeMs: 2000, text: '穿梭时间的画面的钟' },
    ];

    const enriched = await new UtatenKanaProvider().enrichLines(query, lines, { timeoutMs: 2500 });

    expect(enriched).toBe(lines);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no enrichment when line matching is not precise enough', () => {
    const lines = [
      { timeMs: 1000, text: '君の 元へ 帰るんだ' },
      { timeMs: 2000, text: '別の歌詞' },
    ];

    expect(applyUtatenKanaLines(lines, extractUtatenKanaLines(lyricHtml))).toBe(lines);
  });

  it('returns no search results for empty or changed HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(htmlResponse('<main>No lyrics here</main>')));

    const results = await new UtatenKanaProvider().search({
      query,
      normalized: buildNormalizedLyricsQuery(query),
      timeoutMs: 2500,
    });

    expect(results).toEqual([]);
  });
});
