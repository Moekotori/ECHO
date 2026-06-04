import type { EchoDatabase } from '../../database/createDatabase';
import type {
  AlbumCreditGroup,
  AlbumCreditPerson,
  AlbumExternalRating,
  AlbumInformationSummary,
  AlbumOnlineInfo,
  AlbumOnlineInfoMatch,
  AlbumOnlineInfoRequestOptions,
  AlbumReleaseDetails,
  AlbumReleaseLabel,
  AlbumReleaseVersion,
  AlbumOnlineInfoSource,
  AlbumSourceLink,
  LibraryAlbumDetail,
  LibraryTrack,
} from '../../../shared/types/library';
import type { AppLocale } from '../../../shared/types/appSettings';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

type DbRow = Record<string, unknown>;

type AlbumSnapshot = {
  album: LibraryAlbumDetail;
  tracks: LibraryTrack[];
};

type OnlinePayload = {
  credits: AlbumCreditGroup[];
  information: AlbumInformationSummary | null;
  artistInformation: AlbumInformationSummary | null;
  match: AlbumOnlineInfoMatch | null;
  sources: AlbumOnlineInfoSource[];
  sourceLinks: AlbumSourceLink[];
  externalRatings: AlbumExternalRating[];
  releaseDetails: AlbumReleaseDetails | null;
  releaseVersions: AlbumReleaseVersion[];
  errors: string[];
};

type CachedAlbumOnlineInfo = AlbumOnlineInfo & {
  cacheVersion: number;
};

type AlbumOnlineInfoProvider = NonNullable<AlbumOnlineInfoRequestOptions['provider']>;

type AlbumOnlineInfoServiceOptions = AlbumOnlineInfoRequestOptions & {
  locale?: AppLocale;
  discogsUserToken?: string | null;
};

type ParsedInformationCache = {
  version: number;
  information: AlbumInformationSummary | null;
  artistInformation: AlbumInformationSummary | null;
  sourceLinks: AlbumSourceLink[];
  externalRatings: AlbumExternalRating[];
  releaseDetails: AlbumReleaseDetails | null;
  releaseVersions: AlbumReleaseVersion[];
};

type MusicBrainzReleaseSearchResult = {
  id: string;
  releaseGroupId: string | null;
  title: string;
  artist: string;
  artistId: string | null;
  date: string | null;
  country: string | null;
  barcode: string | null;
  status: string | null;
  disambiguation: string | null;
  mediaFormats: string[];
  catalogNumbers: string[];
  labels: string[];
  trackCount: number | null;
  score: number;
};

type MusicBrainzReleasePayload = {
  release: Record<string, unknown>;
  search: MusicBrainzReleaseSearchResult;
  versions: MusicBrainzReleaseSearchResult[];
  releaseGroupId: string | null;
};

type DiscogsReleaseSearchResult = {
  id: number;
  title: string;
  year: number | null;
  uri: string | null;
  score: number;
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

const musicBrainzLimiter = new AsyncLimiter(1, 1050);
const discogsLimiter = new AsyncLimiter(1, 1050);
const wikipediaLimiter = new AsyncLimiter(2);

const successTtlMs = 30 * 24 * 60 * 60 * 1000;
const shortTtlMs = 60 * 60 * 1000;
const maxCreditGroups = 12;
const maxPeoplePerGroup = 12;
const maxSourceLinks = 18;
const maxReleaseVersions = 8;
const informationCacheVersion = 6;

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const numericValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizedConfidence = (value: unknown): number => {
  const parsed = numericValue(value);
  return parsed === null ? 0 : Math.max(0, Math.min(1, parsed));
};

const yearFromDate = (value: string | null): number | null => {
  const year = value?.slice(0, 4);
  return year && /^\d{4}$/u.test(year) ? Number(year) : null;
};

const uniqueText = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));

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

const cacheKeyFor = (albumId: string, title: string, artist: string, language: string): string =>
  `${albumId}:${language}:${normalizeText(title)}:${normalizeText(artist)}`;

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

const containsNormalizedText = (haystack: string | null | undefined, needle: string | null | undefined): boolean => {
  const source = normalizeText(haystack);
  const target = normalizeText(needle);
  return Boolean(source && target && source.includes(target));
};

const fetchJson = async (url: string, headers: Record<string, string>, timeoutMs = 7000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }
    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timer);
  }
};

const musicBrainzJson = (url: string): Promise<unknown> =>
  musicBrainzLimiter.run(() =>
    fetchJson(url, {
      'User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
    }),
  );

const discogsJson = (url: string, userToken: string | null = null): Promise<unknown> =>
  discogsLimiter.run(() =>
    fetchJson(url, {
      'User-Agent': 'ECHO-Next/26.5.29 +https://github.com/moekotori/echo',
      ...(userToken ? { Authorization: `Discogs token=${userToken}` } : {}),
    }),
  );

const wikipediaJson = (language: string, title: string): Promise<unknown> =>
  wikipediaLimiter.run(() =>
    fetchJson(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      'Api-User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
      'User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
    }),
  );

const wikipediaExtractJson = (language: string, title: string, maxChars: number): Promise<unknown> =>
  wikipediaLimiter.run(() => {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      explaintext: '1',
      exchars: String(maxChars),
      redirects: '1',
      titles: title,
      format: 'json',
    });
    return fetchJson(`https://${language}.wikipedia.org/w/api.php?${params.toString()}`, {
      'Api-User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
      'User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
    });
  });

const wikipediaExternalLinksJson = (language: string, title: string): Promise<unknown> =>
  wikipediaLimiter.run(() => {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extlinks',
      ellimit: '20',
      redirects: '1',
      titles: title,
      format: 'json',
    });
    return fetchJson(`https://${language}.wikipedia.org/w/api.php?${params.toString()}`, {
      'Api-User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
      'User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
    });
  });

const wikipediaSearchJson = (language: string, query: string): Promise<unknown> =>
  wikipediaLimiter.run(() =>
    fetchJson(`https://${language}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`, {
      'Api-User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
      'User-Agent': 'ECHO-Next/26.5.19 (https://github.com/moekotori/echo)',
    }),
  );

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

const isInformationSummary = (value: unknown): value is AlbumInformationSummary => {
  const record = asRecord(value);
  return Boolean(text(record.title) && text(record.extract) && text(record.language));
};

const normalizeInformationSummary = (value: unknown): AlbumInformationSummary | null => {
  if (!isInformationSummary(value)) {
    return null;
  }
  const record = asRecord(value);
  const externalLinks = Array.isArray(record.externalLinks)
    ? record.externalLinks
        .map(asRecord)
        .map((link) => ({ label: text(link.label), url: text(link.url) }))
        .filter((link): link is { label: string; url: string } => Boolean(link.label && link.url))
    : [];
  return {
    title: text(record.title) ?? '',
    description: text(record.description),
    extract: text(record.extract) ?? '',
    url: text(record.url),
    language: text(record.language) ?? '',
    thumbnailUrl: text(record.thumbnailUrl),
    externalLinks,
  };
};

const normalizeSourceLink = (value: unknown): AlbumSourceLink | null => {
  const record = asRecord(value);
  const provider = text(record.provider);
  const label = text(record.label);
  const url = text(record.url);
  const kind = text(record.kind);
  if (!label || !url) {
    return null;
  }
  const normalizedProvider: AlbumSourceLink['provider'] =
    provider === 'musicbrainz' ||
    provider === 'wikipedia' ||
    provider === 'wikidata' ||
    provider === 'vgmdb' ||
    provider === 'discogs' ||
    provider === 'rateYourMusic' ||
    provider === 'spotify' ||
    provider === 'appleMusic' ||
    provider === 'youtubeMusic' ||
    provider === 'bandcamp' ||
    provider === 'official' ||
    provider === 'other'
      ? provider
      : 'other';
  const normalizedKind: AlbumSourceLink['kind'] =
    kind === 'database' || kind === 'streaming' || kind === 'official' || kind === 'reference' || kind === 'other' ? kind : 'other';
  return { provider: normalizedProvider, label, url, kind: normalizedKind };
};

const normalizeExternalRating = (value: unknown): AlbumExternalRating | null => {
  const record = asRecord(value);
  const provider = text(record.provider);
  if (provider !== 'rateYourMusic' && provider !== 'musicbrainz' && provider !== 'discogs') {
    return null;
  }
  const score = numericValue(record.score);
  const maxScore = numericValue(record.maxScore);
  if (score === null || maxScore === null || score < 0 || maxScore <= 0 || score > maxScore) {
    return null;
  }
  const ratingCount = numericValue(record.ratingCount);
  return {
    provider,
    score,
    maxScore,
    ratingCount: ratingCount === null || ratingCount < 0 ? null : Math.floor(ratingCount),
    rankText: text(record.rankText),
    url: text(record.url),
    fetchedAt: text(record.fetchedAt),
    expiresAt: text(record.expiresAt),
    confidence: normalizedConfidence(record.confidence),
  };
};

const normalizeReleaseLabel = (value: unknown): AlbumReleaseLabel | null => {
  const record = asRecord(value);
  const name = text(record.name);
  return name ? { name, catalogNumber: text(record.catalogNumber) } : null;
};

const normalizeReleaseDetails = (value: unknown): AlbumReleaseDetails | null => {
  const record = asRecord(value);
  const title = text(record.title);
  if (!title) {
    return null;
  }
  return {
    title,
    date: text(record.date),
    country: text(record.country),
    barcode: text(record.barcode),
    status: text(record.status),
    labels: Array.isArray(record.labels) ? record.labels.map(normalizeReleaseLabel).filter((label): label is AlbumReleaseLabel => Boolean(label)) : [],
    mediaFormats: Array.isArray(record.mediaFormats) ? uniqueText(record.mediaFormats.map((value) => text(value))) : [],
    copyrights: Array.isArray(record.copyrights) ? uniqueText(record.copyrights.map((value) => text(value))) : [],
  };
};

const normalizeReleaseVersion = (value: unknown): AlbumReleaseVersion | null => {
  const record = asRecord(value);
  const providerItemId = text(record.providerItemId);
  const title = text(record.title);
  const artist = text(record.artist);
  const url = text(record.url);
  if (!providerItemId || !title || !artist || !url) {
    return null;
  }
  return {
    providerItemId,
    title,
    artist,
    year: Number.isFinite(Number(record.year)) ? Number(record.year) : null,
    date: text(record.date),
    country: text(record.country),
    barcode: text(record.barcode),
    status: text(record.status),
    disambiguation: text(record.disambiguation),
    mediaFormats: Array.isArray(record.mediaFormats) ? uniqueText(record.mediaFormats.map((value) => text(value))) : [],
    trackCount: Number.isFinite(Number(record.trackCount)) ? Number(record.trackCount) : null,
    catalogNumbers: Array.isArray(record.catalogNumbers) ? uniqueText(record.catalogNumbers.map((value) => text(value))) : [],
    labels: Array.isArray(record.labels) ? uniqueText(record.labels.map((value) => text(value))) : [],
    url,
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0,
    isMatched: record.isMatched === true,
  };
};

const pageExtractFromQuery = (value: unknown): string | null => {
  const pages = asRecord(asRecord(asRecord(value).query).pages);
  for (const page of Object.values(pages).map(asRecord)) {
    if (page.missing) {
      continue;
    }
    const extract = text(page.extract);
    if (extract) {
      return extract;
    }
  }
  return null;
};

const linkLabelFromUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./iu, '');
    const path = decodeURIComponent(url.pathname.replace(/\/$/u, '')).split('/').filter(Boolean).pop();
    return path ? `${host} / ${path.replace(/[_-]+/gu, ' ')}` : host;
  } catch {
    return value;
  }
};

const externalLinksFromQuery = (value: unknown): Array<{ label: string; url: string }> => {
  const pages = asRecord(asRecord(asRecord(value).query).pages);
  const seen = new Set<string>();
  const links: Array<{ label: string; url: string }> = [];
  for (const page of Object.values(pages).map(asRecord)) {
    const extlinks = Array.isArray(page.extlinks) ? page.extlinks.map(asRecord) : [];
    for (const extlink of extlinks) {
      const rawUrl = text(extlink.url) ?? text(extlink['*']);
      if (!rawUrl || seen.has(rawUrl)) {
        continue;
      }
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          continue;
        }
        seen.add(rawUrl);
        links.push({ label: linkLabelFromUrl(rawUrl), url: rawUrl });
      } catch {
        continue;
      }
      if (links.length >= 8) {
        return links;
      }
    }
  }
  return links;
};

const normalizeExtract = (value: string, maxLength: number): string => {
  const normalized = value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
};

const parseInformationCache = (value: unknown): ParsedInformationCache => {
  const parsed = parseJson<unknown>(value, null);
  if (!parsed) {
    return { version: 1, information: null, artistInformation: null, sourceLinks: [], externalRatings: [], releaseDetails: null, releaseVersions: [] };
  }

  const legacyInformation = normalizeInformationSummary(parsed);
  if (legacyInformation) {
    return { version: 1, information: legacyInformation, artistInformation: null, sourceLinks: [], externalRatings: [], releaseDetails: null, releaseVersions: [] };
  }

  const record = asRecord(parsed);
  const version = Number(record.version);
  return {
    version: Number.isFinite(version) ? Math.max(1, Math.min(informationCacheVersion, Math.floor(version))) : 1,
    information: normalizeInformationSummary(record.album),
    artistInformation: normalizeInformationSummary(record.artist),
    sourceLinks: Array.isArray(record.sourceLinks) ? record.sourceLinks.map(normalizeSourceLink).filter((link): link is AlbumSourceLink => Boolean(link)) : [],
    externalRatings: Array.isArray(record.externalRatings)
      ? record.externalRatings.map(normalizeExternalRating).filter((rating): rating is AlbumExternalRating => Boolean(rating))
      : [],
    releaseDetails: normalizeReleaseDetails(record.releaseDetails),
    releaseVersions: Array.isArray(record.releaseVersions)
      ? record.releaseVersions.map(normalizeReleaseVersion).filter((version): version is AlbumReleaseVersion => Boolean(version))
      : [],
  };
};

const serializeInformationCache = (info: AlbumOnlineInfo): string =>
  JSON.stringify({
    version: informationCacheVersion,
    album: info.information,
    artist: info.artistInformation,
    sourceLinks: info.sourceLinks,
    externalRatings: info.externalRatings,
    releaseDetails: info.releaseDetails,
    releaseVersions: info.releaseVersions,
  });

const mergeSources = (fresh: AlbumOnlineInfoSource[], cached: AlbumOnlineInfoSource[]): AlbumOnlineInfoSource[] => {
  const seen = new Set<string>();
  const merged: AlbumOnlineInfoSource[] = [];
  for (const source of [...fresh, ...cached]) {
    const key = `${source.provider}:${source.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(source);
    }
  }
  return merged;
};

const mergeSourceLinks = (fresh: AlbumSourceLink[], cached: AlbumSourceLink[]): AlbumSourceLink[] => {
  const seen = new Set<string>();
  const merged: AlbumSourceLink[] = [];
  for (const link of [...fresh, ...cached]) {
    const key = `${link.provider}:${link.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(link);
    if (merged.length >= maxSourceLinks) {
      break;
    }
  }
  return merged;
};

const isRelevantAlbumInformation = (snapshot: AlbumSnapshot, information: AlbumInformationSummary | null): boolean => {
  if (!information) {
    return true;
  }

  const titleScore = similarity(snapshot.album.title, information.title);
  const albumMentioned = containsNormalizedText(information.title, snapshot.album.title) || containsNormalizedText(information.extract, snapshot.album.title);
  const artistMentioned =
    containsNormalizedText(information.title, snapshot.album.albumArtist) ||
    containsNormalizedText(information.description, snapshot.album.albumArtist) ||
    containsNormalizedText(information.extract, snapshot.album.albumArtist);

  return titleScore >= 0.72 || (albumMentioned && artistMentioned);
};

const isRelevantArtistInformation = (snapshot: AlbumSnapshot, information: AlbumInformationSummary | null): boolean => {
  if (!information) {
    return true;
  }

  return similarity(snapshot.album.albumArtist, information.title) >= 0.72 || containsNormalizedText(information.extract, snapshot.album.albumArtist);
};

const pickArtistCredit = (value: unknown): { name: string | null; id: string | null } => {
  const credits = Array.isArray(value) ? value.map(asRecord) : [];
  const first = credits[0] ?? {};
  const artist = asRecord(first.artist);
  return {
    name: text(artist.name) ?? text(first.name),
    id: text(artist.id),
  };
};

const roleForRelation = (type: string | null, attributes: string[]): string => {
  const haystack = [type ?? '', ...attributes].join(' ').toLocaleLowerCase();
  if (/(vocal|voice|singer|performer|instrument|guitar|bass|drum|piano|keyboard|violin|cello|sax|trumpet)/u.test(haystack)) {
    return haystack.includes('vocal') || haystack.includes('voice') || haystack.includes('singer') ? 'Vocal' : 'Performer';
  }
  if (/(composer|writer|music)/u.test(haystack)) {
    return 'Composer';
  }
  if (/(lyric|libretto|words)/u.test(haystack)) {
    return 'Lyrics';
  }
  if (/(arrang|orchestrat)/u.test(haystack)) {
    return 'Arrangement';
  }
  if (/(producer|production|executive)/u.test(haystack)) {
    return 'Production';
  }
  if (/(mix|master|engineer|recording|sound)/u.test(haystack)) {
    return 'Engineering';
  }
  if (/(label|phonographic|copyright)/u.test(haystack)) {
    return 'Label';
  }
  return 'Other';
};

const addCredit = (groups: Map<string, AlbumCreditPerson[]>, role: string, person: AlbumCreditPerson): void => {
  const people = groups.get(role) ?? [];
  const key = `${person.name}::${person.detail ?? ''}::${person.trackTitle ?? ''}::${person.source}`;
  if (!people.some((item) => `${item.name}::${item.detail ?? ''}::${item.trackTitle ?? ''}::${item.source}` === key)) {
    people.push(person);
  }
  groups.set(role, people);
};

const groupsFromMap = (groups: Map<string, AlbumCreditPerson[]>): AlbumCreditGroup[] => {
  const order = ['Vocal', 'Performer', 'Composer', 'Lyrics', 'Arrangement', 'Production', 'Engineering', 'Label', 'Other'];
  return [...groups.entries()]
    .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    .slice(0, maxCreditGroups)
    .map(([role, people]) => ({ role, people: people.slice(0, maxPeoplePerGroup) }));
};

export class AlbumOnlineInfoService {
  constructor(private readonly database: EchoDatabase) {}

  async getAlbumOnlineInfo(snapshot: AlbumSnapshot, options: AlbumOnlineInfoServiceOptions = {}): Promise<AlbumOnlineInfo> {
    const normalizedTitle = normalizeText(snapshot.album.title);
    const normalizedArtist = normalizeText(snapshot.album.albumArtist);
    const language = wikipediaLanguageForLocale(options.locale);
    const provider: AlbumOnlineInfoProvider =
      options.provider === 'musicbrainz' || options.provider === 'wikipedia' ? options.provider : 'all';
    const cacheLanguageKey = provider === 'all' ? language : `${language}:${provider}`;
    const cacheKey = cacheKeyFor(snapshot.album.id, snapshot.album.title, snapshot.album.albumArtist, cacheLanguageKey);
    const now = new Date();
    let legacyCache: CachedAlbumOnlineInfo | null = null;

    if (options.force !== true) {
      const cached = this.readCache(cacheKey, snapshot.album.id);
      if (cached && Date.parse(cached.expiresAt ?? '') > now.getTime()) {
        if (
          cached.cacheVersion >= informationCacheVersion &&
          isRelevantAlbumInformation(snapshot, cached.information) &&
          isRelevantArtistInformation(snapshot, cached.artistInformation)
        ) {
          return cached;
        }
        legacyCache = cached;
      }
    }

    const fetchedPayload = await this.fetchOnlineInfo(snapshot, language, provider, options.discogsUserToken?.trim() || null);
    const payload: OnlinePayload = legacyCache
      ? (() => {
          const cachedInformation = isRelevantAlbumInformation(snapshot, legacyCache.information) ? legacyCache.information : null;
          const cachedArtistInformation = isRelevantArtistInformation(snapshot, legacyCache.artistInformation) ? legacyCache.artistInformation : null;
          const cachedSources = cachedInformation || cachedArtistInformation
            ? legacyCache.sources
            : legacyCache.sources.filter((source) => source.provider !== 'wikipedia');
          return {
            ...fetchedPayload,
            credits: fetchedPayload.credits.length > 0 ? fetchedPayload.credits : legacyCache.credits,
            information: fetchedPayload.information ?? cachedInformation,
            artistInformation: fetchedPayload.artistInformation ?? cachedArtistInformation,
            match: fetchedPayload.match ?? legacyCache.match,
            sources: mergeSources(fetchedPayload.sources, cachedSources),
            sourceLinks: mergeSourceLinks(fetchedPayload.sourceLinks, legacyCache.sourceLinks),
            externalRatings: fetchedPayload.externalRatings.length > 0 ? fetchedPayload.externalRatings : legacyCache.externalRatings,
            releaseDetails: fetchedPayload.releaseDetails ?? legacyCache.releaseDetails,
            releaseVersions: fetchedPayload.releaseVersions.length > 0 ? fetchedPayload.releaseVersions : legacyCache.releaseVersions,
          };
        })()
      : fetchedPayload;
    const hasData =
      payload.credits.length > 0 ||
      payload.sourceLinks.length > 0 ||
      payload.externalRatings.length > 0 ||
      payload.releaseVersions.length > 0 ||
      Boolean(payload.releaseDetails) ||
      Boolean(payload.information) ||
      Boolean(payload.artistInformation);
    const status = hasData ? (payload.errors.length > 0 ? 'partial' : 'ready') : payload.errors.length > 0 ? 'error' : 'empty';
    const fetchedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + (hasData ? successTtlMs : shortTtlMs)).toISOString();
    const info: AlbumOnlineInfo = {
      albumId: snapshot.album.id,
      status,
      sources: payload.sources,
      match: payload.match,
      sourceLinks: payload.sourceLinks,
      externalRatings: payload.externalRatings,
      releaseDetails: payload.releaseDetails,
      releaseVersions: payload.releaseVersions,
      credits: payload.credits,
      information: payload.information,
      artistInformation: payload.artistInformation,
      fetchedAt,
      expiresAt,
      fromCache: false,
      errors: payload.errors,
    };

    this.writeCache(cacheKey, snapshot.album.id, normalizedTitle, normalizedArtist, info);
    return info;
  }

  private async fetchOnlineInfo(snapshot: AlbumSnapshot, language: string, provider: AlbumOnlineInfoProvider = 'all', discogsUserToken: string | null = null): Promise<OnlinePayload> {
    const errors: string[] = [];
    const shouldFetchMusicBrainz = provider === 'all' || provider === 'musicbrainz';
    const shouldFetchWikipedia = provider === 'all' || provider === 'wikipedia';

    const [musicBrainz, information, artistInformation] = await Promise.all([
      shouldFetchMusicBrainz
        ? this.fetchMusicBrainzRelease(snapshot).catch((error: unknown) => {
            errors.push(`MusicBrainz: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
        : Promise.resolve(null),
      shouldFetchWikipedia
        ? this.fetchWikipediaInformation(snapshot, language).catch((error: unknown) => {
            errors.push(`Wikipedia album: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
        : Promise.resolve(null),
      shouldFetchWikipedia
        ? this.fetchWikipediaArtistInformation(snapshot, language).catch((error: unknown) => {
            errors.push(`Wikipedia artist: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);

    const credits = musicBrainz ? this.extractCredits(musicBrainz.release) : [];
    const match = musicBrainz ? this.toMatch(musicBrainz.search) : null;
    const releaseDetails = musicBrainz ? this.extractReleaseDetails(musicBrainz.release) : null;
    const releaseVersions = musicBrainz ? this.toReleaseVersions(musicBrainz.versions, musicBrainz.search.id) : [];
    const sourceLinks = this.collectSourceLinks(musicBrainz?.release ?? null, match, information, artistInformation);
    const [musicBrainzRating, discogsRating] = musicBrainz
      ? await Promise.all([
          musicBrainz.releaseGroupId
            ? this.fetchMusicBrainzReleaseGroupRating(musicBrainz.releaseGroupId).catch((error: unknown) => {
                errors.push(`MusicBrainz rating: ${error instanceof Error ? error.message : String(error)}`);
                return null;
              })
            : Promise.resolve(null),
          this.fetchDiscogsRating(snapshot, musicBrainz, discogsUserToken).catch((error: unknown) => {
            errors.push(`Discogs rating: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }),
        ])
      : [null, null];
    const externalRatings: AlbumExternalRating[] = [musicBrainzRating, discogsRating].filter((rating): rating is AlbumExternalRating => Boolean(rating));
    const sources: AlbumOnlineInfoSource[] = [];
    if (musicBrainz) {
      sources.push({ provider: 'musicbrainz', label: 'MusicBrainz' });
    }
    if (information || artistInformation) {
      sources.push({ provider: 'wikipedia', label: `${language}.wikipedia.org` });
    }

    return {
      credits,
      information,
      artistInformation,
      match,
      sources,
      sourceLinks,
      externalRatings,
      releaseDetails,
      releaseVersions,
      errors,
    };
  }

  private async fetchMusicBrainzRelease(snapshot: AlbumSnapshot): Promise<MusicBrainzReleasePayload | null> {
    const queryParts = [`release:"${snapshot.album.title}"`];
    if (snapshot.album.albumArtist && snapshot.album.albumArtist !== 'Unknown Artist') {
      queryParts.push(`artist:"${snapshot.album.albumArtist}"`);
    }
    const searchUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(queryParts.join(' AND '))}&fmt=json&limit=5`;
    const searchData = asRecord(await musicBrainzJson(searchUrl));
    const releases = Array.isArray(searchData.releases) ? searchData.releases.map(asRecord) : [];
    const scored = releases
      .map((release) => this.scoreMusicBrainzRelease(release, snapshot))
      .filter((release): release is MusicBrainzReleaseSearchResult => Boolean(release))
      .sort((left, right) => right.score - left.score);
    const best = scored[0] ?? null;
    if (!best || best.score < 0.45) {
      return null;
    }

    const lookupUrl =
      `https://musicbrainz.org/ws/2/release/${encodeURIComponent(best.id)}` +
      '?fmt=json&inc=recordings+artist-credits+labels+url-rels+artist-rels+recording-rels+work-rels+release-groups';
    const release = asRecord(await musicBrainzJson(lookupUrl));
    const releaseGroupId = text(asRecord(release['release-group']).id) ?? best.releaseGroupId;
    return { release, search: best, versions: scored.slice(0, maxReleaseVersions), releaseGroupId };
  }

  private scoreMusicBrainzRelease(release: Record<string, unknown>, snapshot: AlbumSnapshot): MusicBrainzReleaseSearchResult | null {
    const id = text(release.id);
    const title = text(release.title);
    if (!id || !title) {
      return null;
    }

    const artist = pickArtistCredit(release['artist-credit']);
    const releaseGroupId = text(asRecord(release['release-group']).id);
    const media = Array.isArray(release.media) ? release.media.map(asRecord) : [];
    const mediumTrackCount = media.reduce((sum, item) => sum + Math.max(0, Number(item['track-count'] ?? 0)), 0);
    const labels = Array.isArray(release['label-info']) ? release['label-info'].map(asRecord) : [];
    const labelNames = labels.map((labelInfo) => text(asRecord(labelInfo.label).name));
    const catalogNumbers = labels.map((labelInfo) => text(labelInfo['catalog-number']));
    const mediaFormats = media.map((medium) => text(medium.format));
    const year = yearFromDate(text(release.date));
    let score = similarity(snapshot.album.title, title) * 0.45 + similarity(snapshot.album.albumArtist, artist.name) * 0.3;
    if (year && snapshot.album.year && year === snapshot.album.year) {
      score += 0.1;
    }
    if (mediumTrackCount > 0 && snapshot.album.trackCount > 0) {
      score += Math.max(0, 1 - Math.abs(mediumTrackCount - snapshot.album.trackCount) / Math.max(mediumTrackCount, snapshot.album.trackCount)) * 0.15;
    }

    return {
      id,
      releaseGroupId,
      title,
      artist: artist.name ?? snapshot.album.albumArtist,
      artistId: artist.id,
      date: text(release.date),
      country: text(release.country),
      barcode: text(release.barcode),
      status: text(release.status),
      disambiguation: text(release.disambiguation),
      mediaFormats: uniqueText(mediaFormats),
      catalogNumbers: uniqueText(catalogNumbers),
      labels: uniqueText(labelNames),
      trackCount: mediumTrackCount || null,
      score: Math.min(1, score),
    };
  }

  private async fetchMusicBrainzReleaseGroupRating(releaseGroupId: string): Promise<AlbumExternalRating | null> {
    const ratingUrl = `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(releaseGroupId)}?inc=ratings&fmt=json`;
    const payload = asRecord(await musicBrainzJson(ratingUrl));
    const rating = asRecord(payload.rating);
    const score = numericValue(rating.value);
    const votes = numericValue(rating['votes-count']);
    if (score === null || score <= 0 || score > 5) {
      return null;
    }
    return {
      provider: 'musicbrainz',
      score,
      maxScore: 5,
      ratingCount: votes === null || votes < 0 ? null : Math.floor(votes),
      rankText: null,
      url: `https://musicbrainz.org/release-group/${releaseGroupId}`,
      fetchedAt: null,
      expiresAt: null,
      confidence: 1,
    };
  }

  private async fetchDiscogsRating(snapshot: AlbumSnapshot, musicBrainz: MusicBrainzReleasePayload, discogsUserToken: string | null): Promise<AlbumExternalRating | null> {
    const query = [musicBrainz.search.artist, musicBrainz.search.title].filter(Boolean).join(' ');
    const searchParams = new URLSearchParams({
      type: 'release',
      q: query || `${snapshot.album.albumArtist} ${snapshot.album.title}`,
      per_page: '5',
    });
    const searchYear = yearFromDate(musicBrainz.search.date) ?? snapshot.album.year;
    if (searchYear) {
      searchParams.set('year', String(searchYear));
    }

    const searchData = asRecord(await discogsJson(`https://api.discogs.com/database/search?${searchParams.toString()}`, discogsUserToken));
    const results = Array.isArray(searchData.results) ? searchData.results.map(asRecord) : [];
    const scored = results
      .map((result) => this.scoreDiscogsRelease(result, snapshot, musicBrainz))
      .filter((result): result is DiscogsReleaseSearchResult => Boolean(result))
      .sort((left, right) => right.score - left.score);
    const best = scored[0] ?? null;
    if (!best || best.score < 0.62) {
      return null;
    }

    const release = asRecord(await discogsJson(`https://api.discogs.com/releases/${best.id}`, discogsUserToken));
    const rating = asRecord(asRecord(release.community).rating);
    const score = numericValue(rating.average);
    const count = numericValue(rating.count);
    if (score === null || score <= 0 || score > 5 || count === null || count <= 0) {
      return null;
    }

    return {
      provider: 'discogs',
      score,
      maxScore: 5,
      ratingCount: Math.floor(count),
      rankText: 'Data provided by Discogs',
      url: text(release.uri) ?? best.uri ?? `https://www.discogs.com/release/${best.id}`,
      fetchedAt: null,
      expiresAt: null,
      confidence: Number(best.score.toFixed(2)),
    };
  }

  private scoreDiscogsRelease(result: Record<string, unknown>, snapshot: AlbumSnapshot, musicBrainz: MusicBrainzReleasePayload): DiscogsReleaseSearchResult | null {
    const id = numericValue(result.id);
    const title = text(result.title);
    if (id === null || id <= 0 || !Number.isInteger(id) || !title) {
      return null;
    }

    const [artistPart, releasePart] = title.split(/\s+-\s+/u, 2);
    const releaseTitle = releasePart ?? title;
    const titleScore = Math.max(similarity(snapshot.album.title, releaseTitle), similarity(musicBrainz.search.title, releaseTitle), similarity(snapshot.album.title, title));
    if (titleScore < 0.58) {
      return null;
    }

    const artistScore = artistPart ? Math.max(similarity(snapshot.album.albumArtist, artistPart), similarity(musicBrainz.search.artist, artistPart)) : 0;
    const year = numericValue(result.year);
    const releaseYear = year === null || year <= 0 ? null : Math.floor(year);
    let score = titleScore * 0.72 + artistScore * 0.18;
    const expectedYear = yearFromDate(musicBrainz.search.date) ?? snapshot.album.year;
    if (releaseYear && expectedYear && releaseYear === expectedYear) {
      score += 0.1;
    }

    return {
      id,
      title,
      year: releaseYear,
      uri: text(result.uri),
      score: Math.min(1, score),
    };
  }

  private extractCredits(release: Record<string, unknown>): AlbumCreditGroup[] {
    const groups = new Map<string, AlbumCreditPerson[]>();
    const labels = Array.isArray(release['label-info']) ? release['label-info'].map(asRecord) : [];
    for (const labelInfo of labels) {
      const label = asRecord(labelInfo.label);
      const name = text(label.name);
      if (name) {
        addCredit(groups, 'Label', { name, detail: text(labelInfo['catalog-number']), trackTitle: null, source: 'label' });
      }
    }

    this.extractRelations(groups, Array.isArray(release.relations) ? release.relations.map(asRecord) : [], null, 'release');
    const media = Array.isArray(release.media) ? release.media.map(asRecord) : [];
    for (const medium of media) {
      const tracks = Array.isArray(medium.tracks) ? medium.tracks.map(asRecord) : [];
      for (const track of tracks) {
        const title = text(track.title);
        const recording = asRecord(track.recording);
        this.extractRelations(groups, Array.isArray(recording.relations) ? recording.relations.map(asRecord) : [], title, 'recording');
      }
    }

    return groupsFromMap(groups);
  }

  private extractReleaseDetails(release: Record<string, unknown>): AlbumReleaseDetails {
    const labels = Array.isArray(release['label-info']) ? release['label-info'].map(asRecord) : [];
    const media = Array.isArray(release.media) ? release.media.map(asRecord) : [];
    const relations = Array.isArray(release.relations) ? release.relations.map(asRecord) : [];
    const copyrightRelations = relations
      .map((relation) => {
        const type = text(relation.type);
        const normalizedType = type?.toLocaleLowerCase() ?? '';
        if (!normalizedType.includes('copyright') && !normalizedType.includes('phonographic')) {
          return null;
        }
        const targetName = text(asRecord(relation.artist).name) ?? text(asRecord(relation.label).name) ?? text(asRecord(relation.url).resource);
        return [targetName, type].filter(Boolean).join(' - ');
      })
      .filter((value): value is string => Boolean(value));

    return {
      title: text(release.title) ?? '',
      date: text(release.date),
      country: text(release.country),
      barcode: text(release.barcode),
      status: text(release.status),
      labels: labels
        .map((labelInfo): AlbumReleaseLabel | null => {
          const name = text(asRecord(labelInfo.label).name);
          return name ? { name, catalogNumber: text(labelInfo['catalog-number']) } : null;
        })
        .filter((label): label is AlbumReleaseLabel => Boolean(label)),
      mediaFormats: uniqueText(media.map((medium) => text(medium.format))),
      copyrights: uniqueText(copyrightRelations),
    };
  }

  private toReleaseVersions(versions: MusicBrainzReleaseSearchResult[], matchedId: string): AlbumReleaseVersion[] {
    return versions.map((version) => ({
      providerItemId: version.id,
      title: version.title,
      artist: version.artist,
      year: yearFromDate(version.date),
      date: version.date,
      country: version.country,
      barcode: version.barcode,
      status: version.status,
      disambiguation: version.disambiguation,
      mediaFormats: version.mediaFormats,
      trackCount: version.trackCount,
      catalogNumbers: version.catalogNumbers,
      labels: version.labels,
      url: `https://musicbrainz.org/release/${version.id}`,
      confidence: Number(version.score.toFixed(2)),
      isMatched: version.id === matchedId,
    }));
  }

  private collectSourceLinks(
    release: Record<string, unknown> | null,
    match: AlbumOnlineInfoMatch | null,
    information: AlbumInformationSummary | null,
    artistInformation: AlbumInformationSummary | null,
  ): AlbumSourceLink[] {
    const links: AlbumSourceLink[] = [];
    const addLink = (link: AlbumSourceLink): void => {
      if (!link.url || links.some((item) => item.url === link.url)) {
        return;
      }
      links.push(link);
    };

    if (match?.url) {
      addLink({ provider: 'musicbrainz', label: 'MusicBrainz', url: match.url, kind: 'database' });
    }

    for (const item of [information, artistInformation]) {
      if (item?.url) {
        addLink({ provider: 'wikipedia', label: `${item.language}.wikipedia.org`, url: item.url, kind: 'reference' });
      }
      for (const link of item?.externalLinks ?? []) {
        addLink(this.sourceLinkFromUrl(link.url, link.label));
      }
    }

    const relations = release && Array.isArray(release.relations) ? release.relations.map(asRecord) : [];
    for (const relation of relations) {
      const resource = text(asRecord(relation.url).resource);
      if (resource) {
        addLink(this.sourceLinkFromUrl(resource, text(relation.type) ?? undefined));
      }
      if (links.length >= maxSourceLinks) {
        break;
      }
    }

    return links.slice(0, maxSourceLinks);
  }

  private sourceLinkFromUrl(url: string, fallbackLabel?: string): AlbumSourceLink {
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./iu, '').toLocaleLowerCase();
    } catch {
      return { provider: 'other', label: fallbackLabel ?? linkLabelFromUrl(url), url, kind: 'other' };
    }

    if (host.includes('musicbrainz.org')) {
      return { provider: 'musicbrainz', label: 'MusicBrainz', url, kind: 'database' };
    }
    if (host.includes('wikidata.org')) {
      return { provider: 'wikidata', label: 'Wikidata', url, kind: 'database' };
    }
    if (host.includes('vgmdb.net')) {
      return { provider: 'vgmdb', label: 'VGMdb', url, kind: 'database' };
    }
    if (host.includes('discogs.com')) {
      return { provider: 'discogs', label: 'Discogs', url, kind: 'database' };
    }
    if (host === 'rateyourmusic.com' || host.endsWith('.rateyourmusic.com')) {
      return { provider: 'rateYourMusic', label: 'Rate Your Music', url, kind: 'database' };
    }
    if (host.includes('spotify.com')) {
      return { provider: 'spotify', label: 'Spotify', url, kind: 'streaming' };
    }
    if (host.includes('music.apple.com') || host.includes('itunes.apple.com')) {
      return { provider: 'appleMusic', label: 'Apple Music', url, kind: 'streaming' };
    }
    if (host.includes('music.youtube.com') || host.includes('youtube.com')) {
      return { provider: 'youtubeMusic', label: 'YouTube Music', url, kind: 'streaming' };
    }
    if (host.includes('bandcamp.com')) {
      return { provider: 'bandcamp', label: 'Bandcamp', url, kind: 'streaming' };
    }
    if (host.includes('wikipedia.org')) {
      return { provider: 'wikipedia', label: host, url, kind: 'reference' };
    }
    const lowerLabel = (fallbackLabel ?? '').toLocaleLowerCase();
    const isOfficial = lowerLabel.includes('official') || lowerLabel.includes('主页') || lowerLabel.includes('website') || lowerLabel.includes('site');
    return { provider: isOfficial ? 'official' : 'other', label: isOfficial ? 'Official' : linkLabelFromUrl(url), url, kind: isOfficial ? 'official' : 'other' };
  }

  private extractRelations(
    groups: Map<string, AlbumCreditPerson[]>,
    relations: Record<string, unknown>[],
    trackTitle: string | null,
    source: AlbumCreditPerson['source'],
  ): void {
    for (const relation of relations) {
      const artist = asRecord(relation.artist);
      const work = asRecord(relation.work);
      const targetName = text(artist.name) ?? text(work.title);
      if (!targetName) {
        continue;
      }
      const attributes = Array.isArray(relation.attributes) ? relation.attributes.map((value) => String(value)) : [];
      const role = roleForRelation(text(relation.type), attributes);
      addCredit(groups, role, {
        name: targetName,
        detail: attributes.length ? attributes.join(', ') : text(relation.type),
        trackTitle,
        source: text(work.title) ? 'work' : source,
      });
    }
  }

  private async fetchWikipediaInformation(snapshot: AlbumSnapshot, language: string): Promise<AlbumInformationSummary | null> {
    const queries = [
      `${snapshot.album.title} ${snapshot.album.albumArtist}`,
      snapshot.album.title,
    ].filter((value, index, values) => value.trim() && values.indexOf(value) === index);

    for (const query of queries) {
      try {
        const searchData = asRecord(await wikipediaSearchJson(language, query));
        const pages = Array.isArray(searchData.pages) ? searchData.pages.map(asRecord) : [];
        const best = pages
          .map((page) => ({
            key: text(page.key),
            title: text(page.title),
            score: Math.max(similarity(snapshot.album.title, text(page.title)), similarity(query, text(page.title))),
        }))
          .filter((page): page is { key: string; title: string; score: number } => Boolean(page.key && page.title))
          .sort((left, right) => right.score - left.score)[0];
        if (!best || best.score < 0.45) {
          continue;
        }
        const pageTitle = best.key;
        const [summaryPayload, extractPayload, externalLinksPayload] = await Promise.all([
          wikipediaJson(language, pageTitle),
          wikipediaExtractJson(language, pageTitle, 2600),
          wikipediaExternalLinksJson(language, pageTitle),
        ]);
        const data = asRecord(summaryPayload);
        const extract = text(data.extract);
        const title = text(data.title);
        const richExtract = pageExtractFromQuery(extractPayload) ?? extract;
        if (!richExtract || !title) {
          continue;
        }
        const information = {
          title,
          description: text(data.description),
          extract: normalizeExtract(richExtract, 2400),
          url: text(asRecord(asRecord(data.content_urls).desktop).page),
          language,
          thumbnailUrl: text(asRecord(data.thumbnail).source),
          externalLinks: externalLinksFromQuery(externalLinksPayload),
        };
        if (!isRelevantAlbumInformation(snapshot, information)) {
          continue;
        }
        return information;
      } catch {
        continue;
      }
    }

    return null;
  }

  private async fetchWikipediaArtistInformation(snapshot: AlbumSnapshot, language: string): Promise<AlbumInformationSummary | null> {
    const artist = snapshot.album.albumArtist.trim();
    if (!artist || /^unknown artist$/iu.test(artist) || /^various artists$/iu.test(artist)) {
      return null;
    }

    const queries = [
      artist,
      `${artist} musician`,
      `${artist} band`,
    ].filter((value, index, values) => value.trim() && values.indexOf(value) === index);

    for (const query of queries) {
      try {
        const searchData = asRecord(await wikipediaSearchJson(language, query));
        const pages = Array.isArray(searchData.pages) ? searchData.pages.map(asRecord) : [];
        const best = pages
          .map((page) => ({
            key: text(page.key),
            title: text(page.title),
            score: Math.max(similarity(artist, text(page.title)), similarity(query, text(page.title))),
        }))
          .filter((page): page is { key: string; title: string; score: number } => Boolean(page.key && page.title))
          .sort((left, right) => right.score - left.score)[0];
        if (!best || best.score < 0.45) {
          continue;
        }
        const pageTitle = best.key;
        const [summaryPayload, extractPayload, externalLinksPayload] = await Promise.all([
          wikipediaJson(language, pageTitle),
          wikipediaExtractJson(language, pageTitle, 3600),
          wikipediaExternalLinksJson(language, pageTitle),
        ]);
        const data = asRecord(summaryPayload);
        const extract = text(data.extract);
        const title = text(data.title);
        const richExtract = pageExtractFromQuery(extractPayload) ?? extract;
        if (!richExtract || !title) {
          continue;
        }
        const information = {
          title,
          description: text(data.description),
          extract: normalizeExtract(richExtract, 3200),
          url: text(asRecord(asRecord(data.content_urls).desktop).page),
          language,
          thumbnailUrl: text(asRecord(data.thumbnail).source),
          externalLinks: externalLinksFromQuery(externalLinksPayload),
        };
        if (!isRelevantArtistInformation(snapshot, information)) {
          continue;
        }
        return information;
      } catch {
        continue;
      }
    }

    return null;
  }

  private toMatch(search: MusicBrainzReleaseSearchResult): AlbumOnlineInfoMatch {
    return {
      provider: 'musicbrainz',
      providerItemId: search.id,
      title: search.title,
      artist: search.artist,
      year: yearFromDate(search.date),
      confidence: Number(search.score.toFixed(2)),
      url: `https://musicbrainz.org/release/${search.id}`,
      possible: search.score < 0.72,
    };
  }

  private readCache(cacheKey: string, albumId: string): CachedAlbumOnlineInfo | null {
    const row = this.database.prepare<[string], DbRow>('SELECT * FROM album_online_info_cache WHERE cache_key = ?').get(cacheKey);
    if (!row) {
      return null;
    }
    const cachedInformation = parseInformationCache(row.information_json);
    return {
      albumId,
      status: row.status === 'ready' || row.status === 'partial' || row.status === 'empty' || row.status === 'error' ? row.status : 'empty',
      sources: parseJson<AlbumOnlineInfoSource[]>(row.sources_json, []),
      match: parseJson<AlbumOnlineInfoMatch | null>(row.match_json, null),
      sourceLinks: cachedInformation.sourceLinks,
      externalRatings: cachedInformation.externalRatings,
      releaseDetails: cachedInformation.releaseDetails,
      releaseVersions: cachedInformation.releaseVersions,
      credits: parseJson<AlbumCreditGroup[]>(row.credits_json, []),
      information: cachedInformation.information,
      artistInformation: cachedInformation.artistInformation,
      fetchedAt: text(row.fetched_at),
      expiresAt: text(row.expires_at),
      fromCache: true,
      errors: parseJson<string[]>(row.provider_errors_json, []),
      cacheVersion: cachedInformation.version,
    };
  }

  private writeCache(cacheKey: string, albumId: string, normalizedTitle: string, normalizedArtist: string, info: AlbumOnlineInfo): void {
    const columns = new Set(
      this.database
        .prepare<[], DbRow>('PRAGMA table_info(album_online_info_cache)')
        .all()
        .map((row) => text(row.name))
        .filter((name): name is string => Boolean(name)),
    );
    const hasLegacyRelatedJson = columns.has('related_json');

    if (hasLegacyRelatedJson) {
      this.database
        .prepare(
          `INSERT INTO album_online_info_cache (
            cache_key, album_id, normalized_title, normalized_artist, credits_json, related_json, information_json,
            match_json, sources_json, provider_errors_json, status, fetched_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            credits_json = excluded.credits_json,
            related_json = excluded.related_json,
            information_json = excluded.information_json,
            match_json = excluded.match_json,
            sources_json = excluded.sources_json,
            provider_errors_json = excluded.provider_errors_json,
            status = excluded.status,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at`,
        )
        .run(
          cacheKey,
          albumId,
          normalizedTitle,
          normalizedArtist,
          JSON.stringify(info.credits),
          JSON.stringify({}),
          serializeInformationCache(info),
          JSON.stringify(info.match),
          JSON.stringify(info.sources),
          JSON.stringify(info.errors),
          info.status,
          info.fetchedAt,
          info.expiresAt,
        );
      return;
    }

    this.database
      .prepare(
        `INSERT INTO album_online_info_cache (
          cache_key, album_id, normalized_title, normalized_artist, credits_json, information_json,
          match_json, sources_json, provider_errors_json, status, fetched_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          credits_json = excluded.credits_json,
          information_json = excluded.information_json,
          match_json = excluded.match_json,
          sources_json = excluded.sources_json,
          provider_errors_json = excluded.provider_errors_json,
          status = excluded.status,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        cacheKey,
        albumId,
        normalizedTitle,
        normalizedArtist,
        JSON.stringify(info.credits),
        serializeInformationCache(info),
        JSON.stringify(info.match),
        JSON.stringify(info.sources),
        JSON.stringify(info.errors),
        info.status,
        info.fetchedAt,
        info.expiresAt,
      );
  }
}
