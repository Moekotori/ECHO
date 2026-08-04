import type { EchoDatabase } from '../../database/createDatabase';
import type {
  ArtistOnlineInfo,
  ArtistOnlineInfoBio,
  ArtistOnlineInfoExternalLink,
  ArtistOnlineRelation,
  LibraryArtist,
} from '../../../shared/types/library';
import { artistOnlineInfoSources, defaultArtistOnlineInfoSources } from '../../../shared/types/appSettings';
import type { AppLocale, ArtistOnlineInfoSource } from '../../../shared/types/appSettings';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

type DbRow = Record<string, unknown>;

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
  url?: string;
}>;

type OnlineBioCandidate = {
  bio: ArtistOnlineInfoBio;
  source: Extract<ArtistOnlineInfoExternalLink['source'], 'wikipedia' | 'baidu-baike' | 'moegirl'>;
  sourceLabel: string;
  imageCreditLabel: string;
};

type OnlinePayload = {
  bio: ArtistOnlineInfoBio | null;
  imageCredits: string[];
  externalLinks: ArtistOnlineInfoExternalLink[];
  relatedArtists: ArtistOnlineRelation[];
  sourceLabels: string[];
  errors: string[];
};

type CachedArtistOnlineInfo = ArtistOnlineInfo & {
  cacheVersion: number;
};

class AsyncLimiter {
  private activeCount = 0;
  private lastStartedAt = 0;
  private readonly pending: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly minIntervalMs = 0,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.activeCount -= 1;
      this.pending.shift()?.();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeCount >= this.concurrency) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }

    const waitMs = Math.max(0, this.minIntervalMs - (Date.now() - this.lastStartedAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.activeCount += 1;
    this.lastStartedAt = Date.now();
  }
}

const wikipediaLimiter = new AsyncLimiter(2);
const baiduBaikeLimiter = new AsyncLimiter(2);
const moegirlLimiter = new AsyncLimiter(2);
const musicBrainzLimiter = new AsyncLimiter(1, 1050);
const successTtlMs = 30 * 24 * 60 * 60 * 1000;
const shortTtlMs = 60 * 60 * 1000;
const maxRelatedArtists = 8;
const maxExternalLinks = 8;
const wikipediaFallbackLanguages = ['zh', 'ja', 'en'] as const;
const chineseArtistBioTimeoutMs = 3000;
const artistOnlineInfoSourceLabels: Record<ArtistOnlineInfoSource, string> = {
  'baidu-baike': '百度百科',
  moegirl: '萌娘百科',
  wikipedia: 'Wikipedia',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

const wikipediaLanguageForLocale = (locale: AppLocale | undefined): 'zh' | 'ja' | 'en' => {
  if (locale === 'ja-JP') {
    return 'ja';
  }
  if (locale === 'en-US') {
    return 'en';
  }
  return 'zh';
};

const wikipediaLanguagePriority = (language: 'zh' | 'ja' | 'en'): Array<'zh' | 'ja' | 'en'> => [
  language,
  ...wikipediaFallbackLanguages.filter((fallback) => fallback !== language),
];

const normalizeArtistOnlineInfoSources = (sources: ArtistOnlineInfoSource[] | undefined): ArtistOnlineInfoSource[] => {
  if (!Array.isArray(sources)) {
    return [...defaultArtistOnlineInfoSources];
  }

  const source = sources.find((item): item is ArtistOnlineInfoSource =>
    artistOnlineInfoSources.includes(item as ArtistOnlineInfoSource),
  );
  return source ? [source] : [...defaultArtistOnlineInfoSources];
};

const cacheKeyFor = (artistId: string, artistName: string, language: string, region: string | null, sources: ArtistOnlineInfoSource[]): string =>
  `${artistId}:${language}:${sources.join(',')}:${normalizeText(region)}:${normalizeText(artistName)}`;

const levenshtein = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }

  const costs = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = costs[0];
    costs[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = costs[j];
      costs[j] = left[i - 1] === right[j - 1] ? previous : Math.min(previous, costs[j - 1], current) + 1;
      previous = current;
    }
  }
  return costs[right.length];
};

const similarity = (left: string | null | undefined, right: string | null | undefined): number => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 0 : Math.max(0, 1 - levenshtein(a, b) / maxLength);
};

const hasNormalizedTerm = (value: string | null | undefined, term: string | null | undefined): boolean => {
  const normalizedValue = normalizeText(value);
  const normalizedTerm = normalizeText(term);
  if (!normalizedValue || !normalizedTerm) {
    return false;
  }
  return (
    normalizedValue === normalizedTerm ||
    normalizedValue.startsWith(`${normalizedTerm} `) ||
    normalizedValue.endsWith(` ${normalizedTerm}`) ||
    normalizedValue.includes(` ${normalizedTerm} `) ||
    (normalizedTerm.length >= 4 && normalizedValue.includes(normalizedTerm))
  );
};

const baiduBaikeItemUrl = (title: string): string => `https://baike.baidu.com/item/${encodeURIComponent(title)}`;

const baiduBaikeDisplayTitle = (rawTitle: string | null | undefined): string | null =>
  rawTitle
    ?.replace(/[_-]\s*百度百科\s*$/u, '')
    .replace(/\s*百度百科\s*$/u, '')
    .trim() || null;

const baiduBaikeComparableTitle = (title: string): string =>
  title
    .replace(/[（(][^（）()]{1,80}[）)]\s*$/u, '')
    .trim();

const isRelevantBaiduBaikeCandidate = (artistName: string, title: string, extract: string): boolean => {
  const comparableTitle = baiduBaikeComparableTitle(title);
  return (
    similarity(artistName, title) >= 0.34 ||
    similarity(artistName, comparableTitle) >= 0.34 ||
    hasNormalizedTerm(title, artistName) ||
    hasNormalizedTerm(comparableTitle, artistName) ||
    hasNormalizedTerm(extract, artistName)
  );
};

const uniqueByUrl = (links: ArtistOnlineInfoExternalLink[]): ArtistOnlineInfoExternalLink[] => {
  const seen = new Set<string>();
  const result: ArtistOnlineInfoExternalLink[] = [];
  for (const link of links) {
    const key = link.url.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(link);
  }
  return result.slice(0, maxExternalLinks);
};

const fetchJson = async (
  url: string,
  fetcher: FetchLike,
  headers: Record<string, string>,
  timeoutMs = 7000,
  redirect?: RequestRedirect,
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchText = async (
  url: string,
  fetcher: FetchLike,
  headers: Record<string, string>,
  timeoutMs = 5000,
  redirect?: RequestRedirect,
): Promise<{ body: string; url: string }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }
    if (typeof response.text === 'function') {
      return { body: await response.text(), url: response.url ?? url };
    }
    const fallback = await response.json();
    return { body: typeof fallback === 'string' ? fallback : JSON.stringify(fallback), url: response.url ?? url };
  } finally {
    clearTimeout(timer);
  }
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));

const htmlText = (value: string): string =>
  decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|section|li|dd|dt|h[1-6])>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

const htmlMetaContent = (html: string, key: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'iu'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapedKey}["'][^>]*>`, 'iu'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }
  return null;
};

const htmlTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  return match?.[1] ? htmlText(match[1]) : null;
};

const mediaWikiPages = (value: unknown): Record<string, unknown>[] => {
  const pages = asRecord(asRecord(asRecord(value).query).pages);
  return Object.values(pages).map(asRecord).filter((page) => !page.missing);
};

const pageExtractFromQuery = (value: unknown): string | null => {
  for (const page of mediaWikiPages(value)) {
    const extract = text(page.extract);
    if (extract) {
      return extract;
    }
  }
  return null;
};

const pageHtmlFromParse = (value: unknown): string | null => {
  const parse = asRecord(asRecord(value).parse);
  const parseText = parse.text;
  if (typeof parseText === 'string' && parseText.trim()) {
    return parseText.trim();
  }
  return text(asRecord(parseText)['*']);
};

const normalizeExtract = (value: string, maxLength: number): string => {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
};

const normalizeExtractHtml = (value: string, maxLength: number): string | null => {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
};

const wikipediaExtractJson = (
  language: string,
  title: string,
  fetcher: FetchLike,
  headers: Record<string, string>,
  maxChars: number,
  plainText = true,
): Promise<unknown> =>
  wikipediaLimiter.run(() => {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exchars: String(maxChars),
      redirects: '1',
      titles: title,
      format: 'json',
    });
    if (plainText) {
      params.set('explaintext', '1');
    }
    return fetchJson(`https://${language}.wikipedia.org/w/api.php?${params.toString()}`, fetcher, headers);
  });

const wikipediaParseHtmlJson = (
  language: string,
  title: string,
  fetcher: FetchLike,
  headers: Record<string, string>,
): Promise<unknown> =>
  wikipediaLimiter.run(() => {
    const params = new URLSearchParams({
      action: 'parse',
      prop: 'text',
      redirects: '1',
      disableeditsection: '1',
      page: title,
      format: 'json',
    });
    return fetchJson(`https://${language}.wikipedia.org/w/api.php?${params.toString()}`, fetcher, headers);
  });

const defaultHeaders = {
  'Api-User-Agent': 'ECHO-Next/26.5.20 (https://github.com/moekotori/echo)',
  'User-Agent': 'ECHO-Next/26.5.20 (https://github.com/moekotori/echo)',
};

const statusFrom = (value: unknown): ArtistOnlineInfo['status'] => {
  if (value === 'ready' || value === 'partial' || value === 'empty' || value === 'unavailable') {
    return value;
  }
  return 'empty';
};

export const emptyArtistOnlineInfo = (message?: string): ArtistOnlineInfo => ({
  status: 'empty',
  bio: null,
  imageCredits: [],
  externalLinks: [],
  relatedArtists: [],
  sourceLabels: [],
  fetchedAt: null,
  expiresAt: null,
  fromCache: false,
  errors: [],
  message,
});

export class ArtistOnlineInfoService {
  constructor(
    private readonly database: EchoDatabase,
    private readonly fetcher: FetchLike = fetchWithNetworkProxy as FetchLike,
  ) {}

  async getArtistOnlineInfo(
    artist: LibraryArtist,
    options: { force?: boolean; locale?: AppLocale; region?: string | null; sources?: ArtistOnlineInfoSource[]; now?: Date } = {},
  ): Promise<ArtistOnlineInfo> {
    const artistName = artist.name.trim();
    if (!artistName) {
      return emptyArtistOnlineInfo('Artist name is empty.');
    }

    const language = wikipediaLanguageForLocale(options.locale);
    const region = options.region?.trim() || null;
    const sources = normalizeArtistOnlineInfoSources(options.sources);
    const normalizedName = normalizeText(artistName);
    const cacheKey = cacheKeyFor(artist.id, artistName, language, region, sources);
    const now = options.now ?? new Date();

    const cached = options.force !== true ? this.readCache(cacheKey) : null;
    const isCachedFresh = Boolean(cached && Date.parse(cached.expiresAt ?? '') > now.getTime());
    const needsRichRefresh = Boolean(cached && isCachedFresh && this.needsRichWikipediaRefresh(cached, sources));

    if (cached && isCachedFresh && !needsRichRefresh) {
      return cached;
    }

    const payload = await this.fetchOnlineInfo(artistName, language, sources);
    if (cached && needsRichRefresh && !payload.bio) {
      return cached;
    }
    const hasData = Boolean(payload.bio) || payload.externalLinks.length > 0 || payload.relatedArtists.length > 0;
    const status: ArtistOnlineInfo['status'] = hasData
      ? payload.errors.length > 0
        ? 'partial'
        : 'ready'
      : payload.errors.length > 0
        ? 'unavailable'
        : 'empty';
    const fetchedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + (hasData ? successTtlMs : shortTtlMs)).toISOString();
    const info: ArtistOnlineInfo = {
      status,
      bio: payload.bio,
      imageCredits: payload.imageCredits,
      externalLinks: uniqueByUrl(payload.externalLinks),
      relatedArtists: payload.relatedArtists.slice(0, maxRelatedArtists),
      sourceLabels: [...new Set(payload.sourceLabels)],
      fetchedAt,
      expiresAt,
      fromCache: false,
      errors: payload.errors,
      message: hasData ? undefined : 'No online artist information matched this artist yet.',
    };

    this.writeCache(cacheKey, artist.id, normalizedName, language, region, info);
    return info;
  }

  clearCache(): { removedRows: number } {
    const removedRows = Number(this.database.prepare('DELETE FROM artist_online_info_cache').run().changes ?? 0);
    return { removedRows };
  }

  private needsRichWikipediaRefresh(cached: CachedArtistOnlineInfo, sources: ArtistOnlineInfoSource[]): boolean {
    if (!sources.includes('wikipedia')) {
      return false;
    }
    const hasWikipediaBio =
      cached.bio?.url?.includes('wikipedia.org') === true ||
      cached.sourceLabels.some((label) => /wikipedia(?:\.org)?/iu.test(label));
    return hasWikipediaBio && !cached.bio?.extractHtml;
  }

  private async fetchOnlineInfo(artistName: string, language: 'zh' | 'ja' | 'en', sources: ArtistOnlineInfoSource[]): Promise<OnlinePayload> {
    const errors: string[] = [];
    const musicBrainzPromise = sources.includes('wikipedia')
      ? this.fetchMusicBrainzArtist(artistName).catch((error: unknown) => {
          errors.push(`MusicBrainz: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        })
      : Promise.resolve(null);
    const [bioResult, musicBrainz] = await Promise.all([
      this.fetchArtistBio(artistName, language, sources).catch((error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
        return null;
      }),
      musicBrainzPromise,
    ]);

    const externalLinks: ArtistOnlineInfoExternalLink[] = [];
    const sourceLabels: string[] = [];
    const imageCredits: string[] = [];
    if (bioResult) {
      sourceLabels.push(bioResult.sourceLabel);
      if (bioResult.bio.url) {
        externalLinks.push({ label: bioResult.bio.title, url: bioResult.bio.url, source: bioResult.source });
      }
      if (bioResult.bio.thumbnailUrl) {
        imageCredits.push(`${bioResult.bio.title} image via ${bioResult.imageCreditLabel}`);
      }
    }
    if (musicBrainz) {
      sourceLabels.push('MusicBrainz');
      externalLinks.push(...musicBrainz.externalLinks);
    }

    return {
      bio: bioResult?.bio ?? null,
      imageCredits,
      externalLinks,
      relatedArtists: musicBrainz?.relatedArtists ?? [],
      sourceLabels,
      errors,
    };
  }

  private async fetchArtistBio(artistName: string, language: 'zh' | 'ja' | 'en', sources: ArtistOnlineInfoSource[]): Promise<OnlineBioCandidate | null> {
    const errors: string[] = [];

    for (const source of sources) {
      try {
        const bio = await this.fetchArtistBioFromSource(artistName, language, source);
        if (bio) {
          return bio;
        }
      } catch (error) {
        errors.push(`${artistOnlineInfoSourceLabels[source]}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    return null;
  }

  private fetchArtistBioFromSource(artistName: string, language: 'zh' | 'ja' | 'en', source: ArtistOnlineInfoSource): Promise<OnlineBioCandidate | null> {
    if (source === 'baidu-baike') {
      return this.fetchBaiduBaikeBio(artistName);
    }
    if (source === 'moegirl') {
      return this.fetchMoegirlBio(artistName);
    }
    return this.fetchWikipediaBio(artistName, language).then((bio) =>
      bio
        ? {
            bio,
            source: 'wikipedia',
            sourceLabel: `${bio.language}.wikipedia.org`,
            imageCreditLabel: `${bio.language}.wikipedia.org`,
          }
        : null,
    );
  }

  private async fetchBaiduBaikeBio(artistName: string): Promise<OnlineBioCandidate | null> {
    const card = await this.fetchBaiduBaikeCard(artistName);
    if (card) {
      return card;
    }

    const { body, url } = await baiduBaikeLimiter.run(() =>
      fetchText(baiduBaikeItemUrl(artistName), this.fetcher, defaultHeaders, chineseArtistBioTimeoutMs),
    );
    if (/百度百科是一部内容开放|您所访问的页面不存在|创建词条/iu.test(body)) {
      return null;
    }

    const rawTitle = htmlMetaContent(body, 'og:title') ?? htmlTitle(body);
    const title = baiduBaikeDisplayTitle(rawTitle);
    const summaryMatch = body.match(/<div[^>]+class=["'][^"']*lemmaSummary[^"']*["'][^>]*>([\s\S]{40,5000}?)<\/div>/iu);
    const summary = summaryMatch?.[1] ? htmlText(summaryMatch[1]) : null;
    const description = htmlMetaContent(body, 'description') ?? htmlMetaContent(body, 'og:description');
    const extract = normalizeExtract(summary ?? description ?? '', 2400);

    if (!title || !extract || !isRelevantBaiduBaikeCandidate(artistName, title, extract)) {
      return null;
    }

    return this.baiduBaikeCandidate({
      title,
      extract,
      url,
      thumbnailUrl: htmlMetaContent(body, 'og:image'),
    });
  }

  private async fetchBaiduBaikeCard(artistName: string): Promise<OnlineBioCandidate | null> {
    const params = new URLSearchParams({
      scope: '103',
      format: 'json',
      appid: '379020',
      bk_key: artistName,
      bk_length: '1200',
    });
    const payload = asRecord(await baiduBaikeLimiter.run(() =>
      fetchJson(`https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?${params.toString()}`, this.fetcher, defaultHeaders, chineseArtistBioTimeoutMs),
    ));
    const title = text(payload.lemmaTitle) ?? text(payload.title) ?? artistName;
    const abstract = text(payload.abstract);
    const extract = abstract ? normalizeExtract(htmlText(abstract), 2400) : null;
    if (!title || !extract || !isRelevantBaiduBaikeCandidate(artistName, title, extract)) {
      return null;
    }

    return this.baiduBaikeCandidate({
      title,
      extract,
      url: text(payload.url) ?? baiduBaikeItemUrl(title),
      thumbnailUrl: text(payload.image),
    });
  }

  private baiduBaikeCandidate(input: { title: string; extract: string; url: string | null; thumbnailUrl: string | null }): OnlineBioCandidate {
    return {
      bio: {
        title: input.title,
        description: '百度百科',
        extract: input.extract,
        url: input.url,
        language: 'zh',
        thumbnailUrl: input.thumbnailUrl,
      },
      source: 'baidu-baike',
      sourceLabel: '百度百科',
      imageCreditLabel: '百度百科',
    };
  }

  private async fetchMoegirlBio(artistName: string): Promise<OnlineBioCandidate | null> {
    const searchParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: artistName,
      srlimit: '5',
      format: 'json',
      origin: '*',
    });
    const searchData = asRecord(await moegirlLimiter.run(() =>
      fetchJson(`https://zh.moegirl.org.cn/api.php?${searchParams.toString()}`, this.fetcher, defaultHeaders, chineseArtistBioTimeoutMs),
    ));
    const searchResults = asRecord(searchData.query).search;
    const results = Array.isArray(searchResults) ? searchResults.map(asRecord) : [];
    const best = results
      .map((page) => {
        const title = text(page.title);
        return title ? { title, score: Math.max(similarity(artistName, title), title.includes(artistName) ? 0.86 : 0) } : null;
      })
      .filter((page): page is { title: string; score: number } => Boolean(page))
      .sort((left, right) => right.score - left.score)[0];

    if (!best || best.score < 0.34) {
      return null;
    }

    const extractParams = new URLSearchParams({
      action: 'query',
      prop: 'extracts|pageimages',
      redirects: '1',
      explaintext: '1',
      exchars: '2400',
      pithumbsize: '600',
      titles: best.title,
      format: 'json',
      origin: '*',
    });
    const extractData = await moegirlLimiter.run(() =>
      fetchJson(`https://zh.moegirl.org.cn/api.php?${extractParams.toString()}`, this.fetcher, defaultHeaders, chineseArtistBioTimeoutMs),
    );
    const page = mediaWikiPages(extractData)[0];
    if (!page) {
      return null;
    }
    const extract = text(page.extract);
    const title = text(page.title) ?? best.title;

    if (!extract || !title) {
      return null;
    }

    return {
      bio: {
        title,
        description: '萌娘百科',
        extract: normalizeExtract(extract, 2400),
        url: `https://zh.moegirl.org.cn/${encodeURIComponent(title.replace(/\s+/gu, '_'))}`,
        language: 'zh',
        thumbnailUrl: text(asRecord(page.thumbnail).source),
      },
      source: 'moegirl',
      sourceLabel: '萌娘百科',
      imageCreditLabel: '萌娘百科',
    };
  }

  private async fetchWikipediaBio(artistName: string, preferredLanguage: 'zh' | 'ja' | 'en'): Promise<ArtistOnlineInfoBio | null> {
    let lastError: unknown = null;
    const languages = wikipediaLanguagePriority(preferredLanguage);

    for (const language of languages) {
      try {
        const bio = await this.fetchWikipediaBioInLanguage(artistName, language, [artistName]);
        if (bio) {
          return bio;
        }
      } catch (error) {
        lastError = error;
      }
    }

    const fallbackQueries = [
      `${artistName} singer`,
      `${artistName} musician`,
      `${artistName} band`,
    ];
    for (const language of [...new Set([preferredLanguage, 'en' as const])]) {
      try {
        const bio = await this.fetchWikipediaBioInLanguage(artistName, language, fallbackQueries);
        if (bio) {
          return bio;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    return null;
  }

  private async fetchWikipediaBioInLanguage(artistName: string, language: 'zh' | 'ja' | 'en', queries: string[]): Promise<ArtistOnlineInfoBio | null> {
    const uniqueQueries = queries.filter((value, index, values) => value.trim() && values.indexOf(value) === index);
    let lastError: unknown = null;

    for (const query of uniqueQueries) {
      try {
        const searchData = asRecord(await wikipediaLimiter.run(() =>
          fetchJson(
            `https://${language}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=4`,
            this.fetcher,
            defaultHeaders,
          ),
        ));
        const pages = Array.isArray(searchData.pages) ? searchData.pages.map(asRecord) : [];
        const best = pages
          .map((page) => ({
            key: text(page.key),
            title: text(page.title),
            score: Math.max(similarity(artistName, text(page.title)), similarity(query, text(page.title))),
          }))
          .filter((page): page is { key: string; title: string; score: number } => Boolean(page.key && page.title))
          .sort((left, right) => right.score - left.score)[0];

        if (!best || best.score < 0.34) {
          continue;
        }

        const summaryPayload = await wikipediaLimiter.run(() =>
          fetchJson(
            `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.key)}`,
            this.fetcher,
            defaultHeaders,
          ),
        );
        const data = asRecord(summaryPayload);
        const extract = text(data.extract);
        const title = text(data.title);
        if (!extract || !title) {
          continue;
        }
        let richExtract = extract;
        let richExtractHtml: string | null = null;
        try {
          const parsedHtml = pageHtmlFromParse(await wikipediaParseHtmlJson(language, best.key, this.fetcher, defaultHeaders));
          const htmlExtract = parsedHtml ?? pageExtractFromQuery(await wikipediaExtractJson(language, best.key, this.fetcher, defaultHeaders, 2800, false));
          richExtractHtml = htmlExtract ? normalizeExtractHtml(htmlExtract, 30000) : null;
          richExtract = richExtractHtml ? normalizeExtract(htmlText(richExtractHtml), 2400) : extract;
        } catch {
          richExtract = extract;
        }
        return {
          title,
          description: text(data.description),
          extract: normalizeExtract(richExtract, 2400),
          extractHtml: richExtractHtml,
          url: text(asRecord(asRecord(data.content_urls).desktop).page),
          language,
          thumbnailUrl: text(asRecord(data.thumbnail).source),
        };
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    if (lastError) {
      throw lastError;
    }
    return null;
  }

  private async fetchMusicBrainzArtist(artistName: string): Promise<{
    externalLinks: ArtistOnlineInfoExternalLink[];
    relatedArtists: ArtistOnlineRelation[];
  } | null> {
    const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:"${artistName}"`)}&fmt=json&limit=5`;
    const searchData = asRecord(await musicBrainzLimiter.run(() => fetchJson(searchUrl, this.fetcher, defaultHeaders)));
    const artists = Array.isArray(searchData.artists) ? searchData.artists.map(asRecord) : [];
    const best = artists
      .map((artist) => {
        const name = text(artist.name);
        const id = text(artist.id);
        const disambiguation = text(artist.disambiguation);
        const score = Math.max(similarity(artistName, name), Number(artist.score ?? 0) / 100);
        return id && name ? { id, name, disambiguation, score } : null;
      })
      .filter((artist): artist is { id: string; name: string; disambiguation: string | null; score: number } => Boolean(artist))
      .sort((left, right) => right.score - left.score)[0];

    if (!best || best.score < 0.45) {
      return null;
    }

    const lookupUrl = `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(best.id)}?fmt=json&inc=artist-rels+url-rels+tags`;
    const lookup = asRecord(await musicBrainzLimiter.run(() => fetchJson(lookupUrl, this.fetcher, defaultHeaders)));
    const externalLinks: ArtistOnlineInfoExternalLink[] = [
      {
        label: 'MusicBrainz',
        url: `https://musicbrainz.org/artist/${best.id}`,
        source: 'musicbrainz',
      },
    ];
    const relatedArtists: ArtistOnlineRelation[] = [];
    const relations = Array.isArray(lookup.relations) ? lookup.relations.map(asRecord) : [];

    for (const relation of relations) {
      const type = text(relation.type);
      const url = asRecord(relation.url);
      const resource = text(url.resource);
      if (resource) {
        const source = resource.includes('wikidata.org')
          ? 'wikidata'
          : resource.includes('musicbrainz.org')
            ? 'musicbrainz'
            : 'other';
        externalLinks.push({
          label: type ? type.replace(/_/g, ' ') : 'External link',
          url: resource,
          source,
        });
      }

      const relatedArtist = asRecord(relation.artist);
      const relatedName = text(relatedArtist.name);
      const relatedId = text(relatedArtist.id);
      if (relatedName && normalizeText(relatedName) !== normalizeText(best.name)) {
        relatedArtists.push({
          name: relatedName,
          type,
          url: relatedId ? `https://musicbrainz.org/artist/${relatedId}` : null,
          source: 'musicbrainz',
        });
      }
    }

    return {
      externalLinks: uniqueByUrl(externalLinks),
      relatedArtists: relatedArtists.slice(0, maxRelatedArtists),
    };
  }

  private readCache(cacheKey: string): CachedArtistOnlineInfo | null {
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM artist_online_info_cache WHERE cache_key = ?').get(cacheKey);
    if (!row) {
      return null;
    }
    return {
      status: statusFrom(row.status),
      bio: parseJson<ArtistOnlineInfoBio | null>(row.bio_json, null),
      imageCredits: parseJson<string[]>(row.image_credits_json, []),
      externalLinks: parseJson<ArtistOnlineInfoExternalLink[]>(row.external_links_json, []),
      relatedArtists: parseJson<ArtistOnlineRelation[]>(row.related_artists_json, []),
      sourceLabels: parseJson<string[]>(row.source_labels_json, []),
      fetchedAt: text(row.fetched_at),
      expiresAt: text(row.expires_at),
      fromCache: true,
      errors: parseJson<string[]>(row.provider_errors_json, []),
      cacheVersion: 1,
    };
  }

  private writeCache(cacheKey: string, artistId: string, normalizedName: string, locale: string, region: string | null, info: ArtistOnlineInfo): void {
    this.database
      .prepare(
        `INSERT INTO artist_online_info_cache (
          cache_key, artist_id, normalized_name, locale, region, bio_json, image_credits_json, external_links_json,
          related_artists_json, source_labels_json, provider_errors_json, status, fetched_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          artist_id = excluded.artist_id,
          normalized_name = excluded.normalized_name,
          locale = excluded.locale,
          region = excluded.region,
          bio_json = excluded.bio_json,
          image_credits_json = excluded.image_credits_json,
          external_links_json = excluded.external_links_json,
          related_artists_json = excluded.related_artists_json,
          source_labels_json = excluded.source_labels_json,
          provider_errors_json = excluded.provider_errors_json,
          status = excluded.status,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        cacheKey,
        artistId,
        normalizedName,
        locale,
        region,
        info.bio ? JSON.stringify(info.bio) : null,
        JSON.stringify(info.imageCredits),
        JSON.stringify(info.externalLinks),
        JSON.stringify(info.relatedArtists ?? []),
        JSON.stringify(info.sourceLabels),
        JSON.stringify(info.errors ?? []),
        info.status,
        info.fetchedAt ?? new Date().toISOString(),
        info.expiresAt ?? new Date(Date.now() + shortTtlMs).toISOString(),
      );
  }
}
