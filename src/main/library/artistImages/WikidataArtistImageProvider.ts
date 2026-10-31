import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

const providerName = 'wikidata';
const searchLanguages = ['zh', 'ja', 'en'] as const;
const musicDescriptionPattern =
  /(?:singer|musician|band|composer|rapper|disc jockey|dj|songwriter|vocalist|recording artist|music producer|歌手|音樂|音乐|樂隊|乐队|作曲|饒舌|饶舌|音楽|ミュージシャン|バンド|歌い手|作曲家|アイドル|声優)/iu;

type WikidataSearchResult = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
};

type WikidataSearchPayload = {
  search?: WikidataSearchResult[];
};

type WikidataEntityPayload = {
  entities?: Record<string, {
    labels?: Record<string, { value?: unknown }>;
    descriptions?: Record<string, { value?: unknown }>;
    claims?: Record<string, Array<{
      mainsnak?: {
        datavalue?: {
          value?: unknown;
        };
      };
    }>>;
  }>;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const wikidataApiUrl = (params: Record<string, string>): string => {
  const url = new URL('https://www.wikidata.org/w/api.php');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const commonsRedirectUrl = (filename: string): string =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}?width=1200`;

const sourceUrl = (entityId: string): string => `https://www.wikidata.org/wiki/${encodeURIComponent(entityId)}`;

const isLikelyMusicEntity = (item: WikidataSearchResult): boolean => {
  const description = text(item.description);
  return !description || musicDescriptionPattern.test(description);
};

const uniqueBy = <T>(values: T[], keyFor: (value: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
};

export class WikidataArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 1400;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const searchResults = (
      await Promise.all(searchLanguages.map((language) => this.searchLanguage(language, input.artistName).catch(() => [])))
    ).flat();
    const entities = uniqueBy(
      searchResults.filter((item) => text(item.id) && text(item.label) && isLikelyMusicEntity(item)),
      (item) => text(item.id) ?? '',
    ).slice(0, 4);
    const candidates = (
      await Promise.all(entities.map((item) => this.entityToCandidate(item, input.artistName).catch(() => null)))
    ).filter((candidate): candidate is ArtistImageCandidate => Boolean(candidate));

    return candidates
      .sort((left, right) => {
        const scoreDelta = right.confidence - left.confidence;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return (right.quality ?? 0) - (left.quality ?? 0);
      })
      .filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }

  private async searchLanguage(language: string, artistName: string): Promise<WikidataSearchResult[]> {
    const response = await fetchWithNetworkProxy(wikidataApiUrl({
      action: 'wbsearchentities',
      search: artistName,
      language,
      uselang: language,
      format: 'json',
      limit: '6',
    }), {
      redirect: 'follow',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'ECHO-Next/26 artist-image-cache (https://github.com/moekotori/echo)',
      },
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as WikidataSearchPayload;
    return Array.isArray(payload.search) ? payload.search : [];
  }

  private async entityToCandidate(item: WikidataSearchResult, artistName: string): Promise<ArtistImageCandidate | null> {
    const entityId = text(item.id);
    const label = text(item.label);
    if (!entityId || !label) {
      return null;
    }

    const response = await fetchWithNetworkProxy(wikidataApiUrl({
      action: 'wbgetentities',
      ids: entityId,
      props: 'claims|labels|descriptions',
      languages: 'zh|ja|en',
      format: 'json',
    }), {
      redirect: 'follow',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'ECHO-Next/26 artist-image-cache (https://github.com/moekotori/echo)',
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as WikidataEntityPayload;
    const entity = payload.entities?.[entityId];
    const filename = text(entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value);
    if (!filename) {
      return null;
    }

    const displayName =
      text(entity?.labels?.zh?.value)
      ?? text(entity?.labels?.ja?.value)
      ?? text(entity?.labels?.en?.value)
      ?? label;

    return {
      provider: providerName,
      providerArtistId: entityId,
      artistName: displayName,
      imageUrl: commonsRedirectUrl(filename),
      confidence: artistImageConfidence(artistName, displayName),
      quality: 1200,
      sourceUrl: sourceUrl(entityId),
      sourceRef: entityId,
    };
  }
}
