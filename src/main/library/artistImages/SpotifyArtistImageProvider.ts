import type { StreamingArtist } from '../../../shared/types/streaming';
import { getAccountService } from '../../accounts/AccountService';
import { SpotifyStreamingProvider } from '../../streaming/providers/SpotifyStreamingProvider';
import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';

const providerName = 'spotify';

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

const artistSourceUrl = (artist: StreamingArtist): string | null =>
  artist.providerArtistId ? `https://open.spotify.com/artist/${encodeURIComponent(artist.providerArtistId)}` : null;

export class SpotifyArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 500;

  constructor(private readonly streamingProvider = new SpotifyStreamingProvider()) {}

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    if (!getAccountService().getStatus(providerName).connected) {
      return [];
    }

    const result = await this.streamingProvider.search({
      provider: providerName,
      query: input.artistName,
      mediaTypes: ['artist'],
      page: 1,
      pageSize: 8,
    });

    return result.artists
      .flatMap((artist): ArtistImageCandidate[] => {
        const confidence = artistImageConfidence(input.artistName, artist.name);
        return unique([artist.coverUrl, artist.avatarUrl]).map((imageUrl, index) => ({
          provider: providerName,
          providerArtistId: artist.providerArtistId,
          artistName: artist.name,
          imageUrl,
          confidence,
          quality: index === 0 ? 640 : 320,
          sourceUrl: artistSourceUrl(artist),
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
  }
}
