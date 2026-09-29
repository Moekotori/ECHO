import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

const providerName = 'kuwo';
const kuwoReferer = 'https://www.kuwo.cn/';

type KuwoArtist = {
  id: string | null;
  name: string | null;
  imageUrl: string | null;
};

const text = (value: string | null | undefined): string | null => (value?.trim() ? value.trim() : null);

const normalizeImageUrl = (url: string): string => {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  return trimmed.replace(/^http:\/\//iu, 'https://');
};

const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
};

const decodeKuwoText = (value: string): string =>
  value
    .replace(/\\'/gu, "'")
    .replace(/\\\\/gu, '\\')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .trim();

const extractQuotedField = (raw: string, field: string): string | null => {
  const pattern = new RegExp(`'${field}'\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`, 'u');
  const match = raw.match(pattern);
  return match?.[1] ? decodeKuwoText(match[1]) : null;
};

const extractKuwoObjects = (raw: string): string[] => {
  const marker = "'abslist':[";
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) {
    return [];
  }

  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = markerIndex + marker.length; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1));
        start = -1;
      }
      continue;
    }

    if (char === ']' && depth === 0) {
      break;
    }
  }

  return objects;
};

const isKuwoDefaultArtistImageUrl = (url: string | null | undefined): boolean => {
  if (!url) {
    return true;
  }

  return /(?:default|nopic|no_pic|placeholder|artist_default|starheads\/0\/)/iu.test(url);
};

const kuwoImageVariants = (url: string): Array<{ url: string; quality: number }> => {
  const normalized = normalizeImageUrl(url);
  const variants = normalized.includes('/star/starheads/')
    ? [500, 300, 240].map((size) => normalized.replace(/\/starheads\/\d+\//iu, `/starheads/${size}/`))
    : [normalized];

  return unique([...variants, normalized])
    .filter((candidate) => !isKuwoDefaultArtistImageUrl(candidate))
    .map((candidate) => ({
      url: candidate,
      quality: Number(candidate.match(/\/starheads\/(\d+)\//iu)?.[1] ?? 0),
    }));
};

const parseKuwoArtists = (raw: string): KuwoArtist[] => {
  const baseImagePath = text(extractQuotedField(raw, 'BASEPICPATH'))?.replace(/^http:\/\//iu, 'https://') ?? null;

  return extractKuwoObjects(raw)
    .map((item): KuwoArtist => {
      const id = text(extractQuotedField(item, 'ARTISTID'));
      const name = text(extractQuotedField(item, 'ARTIST'));
      const directImageUrl = text(extractQuotedField(item, 'hts_PICPATH'));
      const picPath = text(extractQuotedField(item, 'PICPATH'));
      const imageUrl = directImageUrl ?? (baseImagePath && picPath ? `${baseImagePath}${picPath}` : null);
      return { id, name, imageUrl };
    })
    .filter((artist) => Boolean(artist.name && artist.imageUrl));
};

const artistSourceUrl = (artistId: string | null): string | null =>
  artistId ? `https://www.kuwo.cn/singer_detail/${encodeURIComponent(artistId)}` : null;

export class KuwoArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 550;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const params = new URLSearchParams({
      all: input.artistName,
      ft: 'artist',
      itemset: 'web_2013',
      client: 'kt',
      pn: '0',
      rn: '8',
      rformat: 'json',
      encoding: 'utf8',
    });

    try {
      const response = await fetchWithNetworkProxy(`https://search.kuwo.cn/r.s?${params.toString()}`, {
        signal: controller.signal,
        headers: {
          Accept: 'text/plain,application/json,*/*',
          Referer: kuwoReferer,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`kuwo_artist_search_failed:${response.status}`);
      }

      return parseKuwoArtists(await response.text())
        .flatMap((artist): ArtistImageCandidate[] => {
          const confidence = artistImageConfidence(input.artistName, artist.name ?? '');
          return kuwoImageVariants(artist.imageUrl ?? '').map((variant) => ({
            provider: providerName,
            providerArtistId: artist.id,
            artistName: artist.name ?? input.artistName,
            imageUrl: variant.url,
            confidence,
            quality: variant.quality,
            sourceUrl: artistSourceUrl(artist.id),
            sourceRef: artist.id,
          }));
        })
        .sort((left, right) => {
          const scoreDelta = right.confidence - left.confidence;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }

          return (right.quality ?? 0) - (left.quality ?? 0);
        })
        .filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
    } finally {
      clearTimeout(timer);
    }
  }
}
