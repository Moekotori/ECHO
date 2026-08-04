import { LASTFM_API_KEY, LASTFM_BASE_URL } from '../../integrations/lastfm/LastFmClient';
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

const providerName = 'lastfm';

const imageSizeQuality = (value: unknown): number => {
  switch (text(value)) {
    case 'mega':
      return 300;
    case 'extralarge':
      return 300;
    case 'large':
      return 174;
    case 'medium':
      return 64;
    case 'small':
      return 34;
    default:
      return 0;
  }
};

export class LastFmArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 1100;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const params = new URLSearchParams({
      method: 'artist.getinfo',
      artist: input.artistName,
      api_key: LASTFM_API_KEY,
      autocorrect: '1',
      format: 'json',
    });
    const payload = asRecord(await requestJson(`${LASTFM_BASE_URL}?${params.toString()}`));
    const artist = asRecord(payload.artist);
    const artistName = text(artist.name);
    if (!artistName) {
      return [];
    }

    const images = Array.isArray(artist.image) ? artist.image : [];
    const confidence = artistImageConfidence(input.artistName, artistName);
    return sortArtistImageCandidates(
      unique(images.map((item) => text(asRecord(item)['#text'])))
        .map((url) => normalizeImageUrl(url))
        .filter((url) => !isLikelyDefaultRemoteImageUrl(url))
        .map((imageUrl) => {
          const raw = images.find((item) => text(asRecord(item)['#text']) === imageUrl || normalizeImageUrl(text(asRecord(item)['#text']) ?? '') === imageUrl);
          const record = asRecord(raw);
          return {
            provider: providerName,
            providerArtistId: text(artist.mbid),
            artistName,
            imageUrl,
            confidence,
            quality: imageSizeQuality(record.size),
            sourceUrl: text(artist.url),
            sourceRef: text(artist.mbid),
          };
        }),
    ).filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }
}
