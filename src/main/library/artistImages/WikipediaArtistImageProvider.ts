import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

const providerName = 'wikipedia';
const wikipediaLanguages = ['zh', 'ja', 'en'] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const stripHtml = (value: string): string => value.replace(/<[^>]*>/gu, '').trim();

const isUsableWikipediaImageUrl = (url: string | null | undefined): url is string => {
  if (!url) {
    return false;
  }

  const normalized = url.toLocaleLowerCase();
  return !/(?:default|placeholder|no[_-]?image|wikimedia-button|disambig)/u.test(normalized);
};

const summaryUrl = (language: string, artistName: string): string =>
  `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName.replace(/\s+/gu, '_'))}`;

const wikipediaPageUrl = (language: string, title: string): string =>
  `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/gu, '_'))}`;

export class WikipediaArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 1200;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const settled = await Promise.all(
      wikipediaLanguages.map((language) => this.searchLanguage(language, input.artistName)),
    );

    const seen = new Set<string>();
    return settled
      .flat()
      .filter((candidate) => {
        if (seen.has(candidate.imageUrl)) {
          return false;
        }

        seen.add(candidate.imageUrl);
        return true;
      })
      .sort((left, right) => {
        const confidenceDelta = right.confidence - left.confidence;
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }

        return (right.quality ?? 0) - (left.quality ?? 0);
      })
      .filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }

  private async searchLanguage(language: string, artistName: string): Promise<ArtistImageCandidate[]> {
    try {
      const response = await fetchWithNetworkProxy(summaryUrl(language, artistName), {
        redirect: 'follow',
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        return [];
      }

      const payload = asRecord(await response.json());
      if (text(payload.type) === 'disambiguation') {
        return [];
      }

      const title = text(payload.title);
      const displayTitle = text(payload.displaytitle);
      const candidateName = stripHtml(displayTitle ?? title ?? '');
      if (!candidateName) {
        return [];
      }

      const original = asRecord(payload.originalimage);
      const thumbnail = asRecord(payload.thumbnail);
      const originalUrl = text(original.source);
      const thumbnailUrl = text(thumbnail.source);
      const imageUrl = isUsableWikipediaImageUrl(originalUrl) ? originalUrl : thumbnailUrl;
      if (!isUsableWikipediaImageUrl(imageUrl)) {
        return [];
      }

      return [
        {
          provider: providerName,
          providerArtistId: title ?? candidateName,
          artistName: candidateName,
          imageUrl,
          confidence: artistImageConfidence(artistName, candidateName),
          quality: number(original.width) ?? number(thumbnail.width) ?? 0,
          sourceUrl: title ? wikipediaPageUrl(language, title) : null,
          sourceRef: `${language}:${title ?? candidateName}`,
        },
      ];
    } catch {
      return [];
    }
  }
}
