import type { LyricLine, LyricsQuery } from '../../shared/types/lyrics';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import {
  hasJapaneseKanaSignal,
  hasKanaText,
  shouldRomanizeJapaneseLine,
} from '../../shared/utils/lyricsLanguage';
import type { LyricsProviderSearchRequest } from './LyricsProvider';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';
import { similarity } from './lyricsScoring';
import { normalizeTextForIdentity } from './lyricsTextNormalization';

export type UtatenKanaLine = {
  text: string;
  kana: string;
};

export type UtatenKanaResult = {
  providerLyricsId: string;
  title: string;
  artist: string;
  sourceUrl: string;
  lines: UtatenKanaLine[];
};

export type UtatenKanaProviderOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type UtatenKanaProviderLike = {
  enrichLines: (query: LyricsQuery, lines: LyricLine[], options?: UtatenKanaProviderOptions) => Promise<LyricLine[]>;
};

const utatenOrigin = 'https://utaten.com';
const utatenUserAgent = 'ECHO-Next/1.0.1 (lyrics kana lookup)';
const defaultTimeoutMs = 2500;
const maxSearchVariants = 2;
const maxResultPages = 2;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');

const normalizeInlineText = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const stripTags = (value: string): string =>
  normalizeInlineText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]+>/gu, ' '),
  );

const classNamePattern = (className: string): RegExp =>
  new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'iu');

const extractClassBlock = (html: string, className: string): string | null => {
  const match = classNamePattern(className).exec(html);
  if (!match || match.index < 0) {
    return null;
  }

  const tag = match[1];
  const start = match.index + match[0].length;
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'giu');
  tagPattern.lastIndex = start;
  let depth = 1;
  let next: RegExpExecArray | null;

  while ((next = tagPattern.exec(html))) {
    if (next[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, next.index);
      }
    } else if (!next[0].endsWith('/>')) {
      depth += 1;
    }
  }

  return null;
};

const extractFirstTagBlock = (html: string, tag: string): string | null => {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu');
  return pattern.exec(html)?.[1] ?? null;
};

const textFromClass = (html: string, className: string): string | null => {
  const block = extractClassBlock(html, className);
  const text = block ? stripTags(block) : '';
  return text || null;
};

const cleanUtatenTitle = (value: string | null): string | null => {
  const cleaned = value?.replace(/\s*歌詞(?:\s.*)?$/u, '').trim() ?? '';
  return cleaned || null;
};

const fetchTextWithTimeout = async (
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': utatenUserAgent,
        Referer: utatenOrigin,
      },
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    return await response.text();
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(timer);
  }
};

const buildSearchUrl = (query: LyricsQuery): string => {
  const url = new URL('/lyric/search', utatenOrigin);
  url.searchParams.set('sort', 'popular_sort_asc');
  url.searchParams.set('artist_name', query.artist);
  url.searchParams.set('title', query.title);
  url.searchParams.set('show_artists', '1');
  return url.toString();
};

type UtatenSearchResult = {
  title: string;
  artist: string;
  url: string;
};

export const extractUtatenSearchResults = (html: string): UtatenSearchResult[] => {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/giu) ?? [];
  const results: UtatenSearchResult[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.includes('searchResult__title')) {
      continue;
    }

    const href = /href=["'](\/lyric\/[^"']+)["']/iu.exec(row)?.[1];
    const title = stripTags(extractClassBlock(row, 'searchResult__title') ?? '');
    const artistBlock = extractClassBlock(row, 'searchResult__artist') ?? '';
    const artist = stripTags(extractFirstTagBlock(artistBlock, 'p') ?? artistBlock);
    if (!href || !title || !artist || seen.has(href)) {
      continue;
    }

    seen.add(href);
    results.push({
      title,
      artist,
      url: new URL(href, utatenOrigin).toString(),
    });
  }

  return results;
};

const replaceRubySpans = (html: string, field: 'base' | 'kana'): string =>
  html.replace(
    /<span\b[^>]*class=["'][^"']*\bruby\b[^"']*["'][^>]*>\s*<span\b[^>]*class=["'][^"']*\brb\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["'][^"']*\brt\b[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/span>/giu,
    (_match, base: string, kana: string) => (field === 'base' ? base : kana || base),
  );

const htmlLineBreak = '\uE000ECHO_LINE_BREAK\uE000';

const htmlLines = (html: string): string[] =>
  html
    .replace(/<br\s*\/?>/giu, htmlLineBreak)
    .replace(/<\/(?:p|div|li)>/giu, htmlLineBreak)
    .replace(/[\r\n\t]+/gu, ' ')
    .replaceAll(htmlLineBreak, '\n')
    .split(/\r?\n/u)
    .map(stripTags)
    .filter(Boolean);

export const extractUtatenKanaLines = (html: string): UtatenKanaLine[] => {
  const lyricBody = extractClassBlock(html, 'lyricBody') ?? html;
  const hiragana = extractClassBlock(lyricBody, 'hiragana');
  if (!hiragana) {
    return [];
  }

  const baseLines = htmlLines(replaceRubySpans(hiragana, 'base'));
  const kanaLines = htmlLines(replaceRubySpans(hiragana, 'kana'));
  const lines: UtatenKanaLine[] = [];

  for (let index = 0; index < baseLines.length; index += 1) {
    const text = normalizeInlineText(baseLines[index] ?? '');
    const kana = normalizeInlineText(kanaLines[index] ?? '');
    if (text && kana) {
      lines.push({ text, kana });
    }
  }

  return lines;
};

export const parseUtatenLyricPage = (
  html: string,
  fallback: UtatenSearchResult,
): UtatenKanaResult | null => {
  const lines = extractUtatenKanaLines(html);
  if (lines.length === 0) {
    return null;
  }

  const title = cleanUtatenTitle(textFromClass(html, 'newLyricTitle__main')) ?? fallback.title;
  const artist = textFromClass(html, 'newLyricWork__name') ?? fallback.artist;

  return {
    providerLyricsId: `utaten:${new URL(fallback.url).pathname}`,
    title,
    artist,
    sourceUrl: fallback.url,
    lines,
  };
};

export const hasJapaneseLyricsText = (lines: LyricLine[]): boolean =>
  hasJapaneseKanaSignal(lines);

const hasMissingKana = (lines: LyricLine[]): boolean =>
  hasJapaneseKanaSignal(lines) &&
  lines.some((line) => !line.kana?.trim() && shouldRomanizeJapaneseLine(line.text, true));

const normalizeLineForKanaMatch = (value: string): string =>
  normalizeTextForIdentity(value).replace(/\s+/gu, '');

const isUsefulKana = (line: UtatenKanaLine): boolean =>
  hasKanaText(line.kana) &&
  normalizeLineForKanaMatch(line.kana) !== normalizeLineForKanaMatch(line.text);

export const applyUtatenKanaLines = (
  lines: LyricLine[],
  utatenLines: UtatenKanaLine[],
): LyricLine[] => {
  const lyricsHaveJapaneseKana = hasJapaneseKanaSignal(lines);
  const targetIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        !line.kana?.trim() &&
        shouldRomanizeJapaneseLine(line.text, lyricsHaveJapaneseKana) &&
        normalizeLineForKanaMatch(line.text).length >= 2,
    );
  if (targetIndexes.length === 0 || utatenLines.length === 0) {
    return lines;
  }

  const matchedKana = new Map<number, string>();
  let cursor = 0;
  let matched = 0;

  for (const { line, index } of targetIndexes) {
    const target = normalizeLineForKanaMatch(line.text);
    for (let utatenIndex = cursor; utatenIndex < utatenLines.length; utatenIndex += 1) {
      const candidate = utatenLines[utatenIndex];
      if (normalizeLineForKanaMatch(candidate.text) !== target) {
        continue;
      }

      matched += 1;
      cursor = utatenIndex + 1;
      if (isUsefulKana(candidate)) {
        matchedKana.set(index, candidate.kana);
      }
      break;
    }
  }

  const requiredMatches = Math.min(3, targetIndexes.length);
  if (matched < requiredMatches || matched / targetIndexes.length < 0.7 || matchedKana.size === 0) {
    return lines;
  }

  return lines.map((line, index) => {
    const kana = matchedKana.get(index);
    return kana ? { ...line, kana } : line;
  });
};

export class UtatenKanaProvider implements UtatenKanaProviderLike {
  async search(request: LyricsProviderSearchRequest): Promise<UtatenKanaResult[]> {
    const results: UtatenKanaResult[] = [];
    const seenUrls = new Set<string>();
    const variants = request.normalized.searchVariants.slice(0, maxSearchVariants);

    for (const variant of variants) {
      if (request.signal?.aborted || results.length >= maxResultPages) {
        break;
      }

      const query: LyricsQuery = {
        ...request.query,
        title: variant.title,
        artist: variant.artist,
        album: variant.album,
      };
      let searchHtml = '';
      try {
        searchHtml = await fetchTextWithTimeout(buildSearchUrl(query), request.signal, request.timeoutMs);
      } catch {
        continue;
      }
      const searchResults = extractUtatenSearchResults(searchHtml);
      for (const searchResult of searchResults) {
        if (request.signal?.aborted || results.length >= maxResultPages) {
          break;
        }

        if (seenUrls.has(searchResult.url) || !this.isSafeMetadataMatch(request.query, searchResult)) {
          continue;
        }

        seenUrls.add(searchResult.url);
        let parsed: UtatenKanaResult | null = null;
        try {
          const lyricHtml = await fetchTextWithTimeout(searchResult.url, request.signal, request.timeoutMs);
          parsed = parseUtatenLyricPage(lyricHtml, searchResult);
        } catch {
          parsed = null;
        }
        if (parsed && this.isSafeMetadataMatch(request.query, parsed)) {
          results.push(parsed);
        }
      }
    }

    return results;
  }

  async enrichLines(
    query: LyricsQuery,
    lines: LyricLine[],
    options: UtatenKanaProviderOptions = {},
  ): Promise<LyricLine[]> {
    if (!hasJapaneseLyricsText(lines) || !hasMissingKana(lines)) {
      return lines;
    }

    try {
      const request = {
        query,
        normalized: buildNormalizedLyricsQuery(query),
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
        signal: options.signal,
      } satisfies LyricsProviderSearchRequest;

      const results = await this.search(request);
      for (const result of results) {
        const enriched = applyUtatenKanaLines(lines, result.lines);
        if (enriched !== lines) {
          return enriched;
        }
      }
    } catch {
      // Kana is an optional display enhancement; lookup failures must not block lyrics.
    }

    return lines;
  }

  private isSafeMetadataMatch(
    query: Pick<LyricsQuery, 'title' | 'artist'>,
    candidate: Pick<UtatenKanaResult, 'title' | 'artist'>,
  ): boolean {
    const titleScore = similarity(query.title, candidate.title);
    const artistScore = query.artist.trim() ? similarity(query.artist, candidate.artist) : 1;
    return titleScore >= 0.82 && artistScore >= 0.86;
  }
}
