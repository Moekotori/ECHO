import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import {
  asRecord,
  isLikelyDefaultRemoteImageUrl,
  normalizeImageUrl,
  requestJson,
  sortArtistImageCandidates,
  text,
  unique,
} from './ArtistImageProviderUtils';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';

const providerName = 'douban';

const doubanImageVariants = (url: string): Array<{ url: string; quality: number }> => {
  const normalized = normalizeImageUrl(url);
  const large = normalized.replace(/\/view\/(celebrity|personage)\/[sml]\//iu, '/view/$1/l/');
  const medium = normalized.replace(/\/view\/(celebrity|personage)\/[sml]\//iu, '/view/$1/m/');

  return unique([large, medium, normalized])
    .filter((candidate) => !isLikelyDefaultRemoteImageUrl(candidate))
    .map((candidate) => ({
      url: candidate,
      quality: /\/view\/(?:celebrity|personage)\/l\//iu.test(candidate) ? 800 : 420,
    }));
};

export class DoubanArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 1200;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const params = new URLSearchParams({
      q: input.artistName,
    });
    const payload = await requestJson(`https://movie.douban.com/j/subject_suggest?${params.toString()}`, {
      headers: {
        Referer: 'https://movie.douban.com/',
      },
    });
    const results = Array.isArray(payload) ? payload : [];

    return sortArtistImageCandidates(
      results.flatMap((item): ArtistImageCandidate[] => {
        const record = asRecord(item);
        if (text(record.type) !== 'celebrity') {
          return [];
        }

        const title = text(record.title);
        const subtitle = text(record.sub_title);
        const imageUrl = text(record.img);
        if (!title || !imageUrl) {
          return [];
        }

        const confidence = Math.max(
          artistImageConfidence(input.artistName, title),
          subtitle ? artistImageConfidence(input.artistName, subtitle) : 0,
        );
        return doubanImageVariants(imageUrl).map((variant) => ({
          provider: providerName,
          providerArtistId: text(record.id),
          artistName: title,
          imageUrl: variant.url,
          confidence,
          quality: variant.quality,
          sourceUrl: text(record.url),
          sourceRef: text(record.id),
        }));
      }),
    ).filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }
}
