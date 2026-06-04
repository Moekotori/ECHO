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

const providerName = 'deezer';

const deezerImageUrls = (record: Record<string, unknown>): Array<{ url: string; quality: number }> =>
  unique([
    text(record.picture_xl),
    text(record.picture_big),
    text(record.picture_medium),
    text(record.picture),
  ])
    .map((url) => normalizeImageUrl(url))
    .filter((url) => !isLikelyDefaultRemoteImageUrl(url))
    .map((url) => ({
      url,
      quality: Number(url.match(/\/(\d+)x\d+-/iu)?.[1] ?? 500),
    }));

export class DeezerArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 700;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const params = new URLSearchParams({
      q: input.artistName,
      limit: '6',
    });
    const payload = asRecord(await requestJson(`https://api.deezer.com/search/artist?${params.toString()}`));
    const artists = Array.isArray(payload.data) ? payload.data : [];

    return sortArtistImageCandidates(
      artists.flatMap((item): ArtistImageCandidate[] => {
        const record = asRecord(item);
        const artistName = text(record.name);
        const artistId = record.id === null || record.id === undefined ? null : String(record.id);
        if (!artistName) {
          return [];
        }

        const confidence = artistImageConfidence(input.artistName, artistName);
        return deezerImageUrls(record).map((image) => ({
          provider: providerName,
          providerArtistId: artistId,
          artistName,
          imageUrl: image.url,
          confidence,
          quality: image.quality,
          sourceUrl: text(record.link),
          sourceRef: artistId,
        }));
      }),
    ).filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }
}
