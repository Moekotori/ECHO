import type { StreamingArtist } from '../../../shared/types/streaming';
import { NeteaseStreamingProvider } from '../../streaming/providers/NeteaseStreamingProvider';
import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';

const providerName = 'netease';

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

const unwrapStreamingImageUrl = (url: string | null | undefined): string | null => {
  if (!url) {
    return null;
  }

  if (!url.startsWith('echo-image://remote/')) {
    return url;
  }

  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/u, ''));
  } catch {
    return null;
  }
};

export const isNeteaseDefaultArtistImageUrl = (url: string | null | undefined): boolean => {
  if (!url) {
    return true;
  }

  const normalized = url.toLocaleLowerCase();
  return /(?:default|nopic|no_pic|placeholder|avatar_default|artist_default|singer_default)/u.test(normalized)
    || /\/(?:0|default)\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/u.test(normalized)
    || /6y-uleoritedbvrolv0q8a|5639395138885805/u.test(normalized);
};

const normalizeNeteaseImageUrl = (url: string, size: number): string => {
  const normalized = url.startsWith('//') ? `https:${url}` : url.replace(/^http:\/\//iu, 'https://');
  const withoutParam = normalized.replace(/([?&])param=\d+y\d+(&?)/iu, (_match, prefix: string, suffix: string) =>
    suffix ? prefix : '',
  ).replace(/[?&]$/u, '');
  return `${withoutParam}${withoutParam.includes('?') ? '&' : '?'}param=${size}y${size}`;
};

const neteaseImageUrlVariants = (url: string): Array<{ url: string; quality: number }> => {
  const normalized = url.startsWith('//') ? `https:${url}` : url.replace(/^http:\/\//iu, 'https://');
  return unique([1200, 1000, 600, 500].map((size) => normalizeNeteaseImageUrl(normalized, size)).concat(normalized))
    .filter((candidate) => !isNeteaseDefaultArtistImageUrl(candidate))
    .map((candidate) => ({
      url: candidate,
      quality: Number(candidate.match(/[?&]param=(\d+)y\d+/iu)?.[1] ?? 0),
    }));
};

const artistSourceUrl = (artist: StreamingArtist): string | null =>
  artist.providerArtistId ? `https://music.163.com/#/artist?id=${encodeURIComponent(artist.providerArtistId)}` : null;

export class NeteaseArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 900;

  constructor(private readonly streamingProvider = new NeteaseStreamingProvider()) {}

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const result = await this.streamingProvider.search({
      provider: providerName,
      query: input.artistName,
      mediaTypes: ['artist'],
      page: 1,
      pageSize: 8,
    });

    return result.artists
      .flatMap((artist): ArtistImageCandidate[] => {
        const imageUrl = unwrapStreamingImageUrl(artist.coverUrl ?? artist.avatarUrl);
        if (!imageUrl) {
          return [];
        }

        const confidence = artistImageConfidence(input.artistName, artist.name);
        return neteaseImageUrlVariants(imageUrl).map((variant) => ({
          provider: providerName,
          providerArtistId: artist.providerArtistId,
          artistName: artist.name,
          imageUrl: variant.url,
          confidence,
          quality: variant.quality,
          sourceUrl: artistSourceUrl(artist),
          sourceRef: artist.id,
        }));
      })
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
      })
      .map((candidate) => ({
        ...candidate,
        confidence: Math.min(1, Math.max(0, candidate.confidence)),
      }))
      .filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }
}
