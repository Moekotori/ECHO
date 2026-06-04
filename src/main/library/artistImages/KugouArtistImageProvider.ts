import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

const providerName = 'kugou';
const kugouReferer = 'https://www.kugou.com/';

type KugouSearchArtist = {
  id: string;
  name: string;
  confidence: number;
};

type KugouAuthorImage = {
  url: string;
  quality: number;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

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

const parseJsonText = (raw: string): unknown => JSON.parse(raw.trim().replace(/^\uFEFF/u, ''));

const isKugouDefaultArtistImageUrl = (url: string | null | undefined): boolean => {
  if (!url) {
    return true;
  }

  const normalized = url.toLocaleLowerCase();
  return /(?:default|nopic|no_pic|placeholder|avatar_default|singer_default|artist_default)/u.test(normalized)
    || /\/(?:0|default)\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/u.test(normalized)
    || /\{size\}/u.test(normalized);
};

const kugouImageVariants = (url: string): KugouAuthorImage[] => {
  const normalized = normalizeImageUrl(url);
  const variants = normalized.includes('{size}')
    ? [1000, 800, 500, 400, 240].map((size) => normalized.replace(/\{size\}/gu, String(size)))
    : [normalized];

  return unique([...variants, normalized])
    .filter((candidate) => !isKugouDefaultArtistImageUrl(candidate))
    .map((candidate) => ({
      url: candidate,
      quality: Number(
        candidate.match(/\/(?:softhead|mobilehead)\/(\d+)\//iu)?.[1]
          ?? candidate.match(/[?&](?:size|param)=(\d+)/iu)?.[1]
          ?? 700,
      ),
    }));
};

const requestJson = async (url: string, timeoutMs = 6000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Referer: kugouReferer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`kugou_artist_request_failed:${response.status}`);
    }

    return parseJsonText(await response.text());
  } finally {
    clearTimeout(timer);
  }
};

const searchKugouArtists = async (artistName: string): Promise<Array<{ id: string; name: string }>> => {
  const params = new URLSearchParams({
    format: 'json',
    keyword: artistName,
    page: '1',
    pagesize: '6',
  });
  const payload = asRecord(await requestJson(`http://mobilecdn.kugou.com/api/v3/search/singer?${params.toString()}`));
  const data = Array.isArray(payload.data) ? payload.data : [];

  return data
    .map((item): { id: string; name: string } | null => {
      const record = asRecord(item);
      const id = String(record.singerid ?? record.singerId ?? '').trim();
      const name = text(record.singername) ?? text(record.singerName) ?? text(record.name);

      return id && name ? { id, name } : null;
    })
    .filter((artist): artist is { id: string; name: string } => Boolean(artist));
};

const authorSourceUrl = (artistId: string): string => `https://www.kugou.com/singer/${encodeURIComponent(artistId)}.html`;

const fetchAuthorImages = async (artistId: string): Promise<KugouAuthorImage[]> => {
  const params = new URLSearchParams({
    fields_pack: 'allimages',
    authorimg_type: '4,5',
    entity_id: artistId,
  });
  const payload = asRecord(await requestJson(`https://openapicdnretry.kugou.com/kmr/v1/author/extend?${params.toString()}`));
  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = asRecord(data[0]);
  const base = asRecord(first.base);
  const imgs = Array.isArray(first.imgs) ? first.imgs : [];
  const imageUrls = [
    text(base.avatar),
    ...imgs.map((item) => {
      const record = asRecord(item);
      return text(record.file);
    }),
  ];

  return imageUrls.flatMap((url) => (url ? kugouImageVariants(url) : []));
};

export class KugouArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 700;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const artists = (await searchKugouArtists(input.artistName))
      .map((artist): KugouSearchArtist => ({
        ...artist,
        confidence: artistImageConfidence(input.artistName, artist.name),
      }))
      .filter((artist) => artist.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE)
      .sort((left, right) => {
        const scoreDelta = right.confidence - left.confidence;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return left.name.localeCompare(right.name);
      })
      .slice(0, 3);

    const candidates = await Promise.all(
      artists.map(async (artist): Promise<ArtistImageCandidate[]> => {
        const images = await fetchAuthorImages(artist.id);
        return images.map((image) => ({
          provider: providerName,
          providerArtistId: artist.id,
          artistName: artist.name,
          imageUrl: image.url,
          confidence: artist.confidence,
          quality: image.quality,
          sourceUrl: authorSourceUrl(artist.id),
          sourceRef: artist.id,
        }));
      }),
    );

    return candidates
      .flat()
      .sort((left, right) => {
        const scoreDelta = right.confidence - left.confidence;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        const qualityDelta = (right.quality ?? 0) - (left.quality ?? 0);
        if (qualityDelta !== 0) {
          return qualityDelta;
        }

        return left.artistName.localeCompare(right.artistName);
      });
  }
}
