import { ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE, artistImageConfidence } from './ArtistImageMatching';
import {
  asRecord,
  isLikelyDefaultRemoteImageUrl,
  normalizeImageUrl,
  number,
  requestJson,
  sortArtistImageCandidates,
  text,
} from './ArtistImageProviderUtils';
import type { ArtistImageCandidate, ArtistImageProvider } from './ArtistImageTypes';

const providerName = 'musicbrainz_fanarttv';
const musicBrainzUserAgent = 'ECHO-Next/26 artist-image-cache (https://github.com/moekotori/echo)';

type MusicBrainzArtist = {
  id: string;
  name: string;
  confidence: number;
};

const fanartApiKey = (): string | null =>
  process.env.ECHO_FANARTTV_API_KEY?.trim()
  || process.env.FANARTTV_API_KEY?.trim()
  || null;

const searchMusicBrainzArtists = async (artistName: string): Promise<MusicBrainzArtist[]> => {
  const params = new URLSearchParams({
    query: `artist:"${artistName.replace(/"/gu, '\\"')}"`,
    fmt: 'json',
    limit: '6',
  });
  const payload = asRecord(await requestJson(`https://musicbrainz.org/ws/2/artist/?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': musicBrainzUserAgent,
    },
  }));
  const artists = Array.isArray(payload.artists) ? payload.artists : [];

  return artists
    .map((item): MusicBrainzArtist | null => {
      const record = asRecord(item);
      const id = text(record.id);
      const name = text(record.name);
      if (!id || !name) {
        return null;
      }

      const aliases = Array.isArray(record.aliases)
        ? record.aliases.map((alias) => text(asRecord(alias).name)).filter((alias): alias is string => Boolean(alias))
        : [];
      const confidence = Math.max(
        artistImageConfidence(artistName, name),
        ...aliases.map((alias) => artistImageConfidence(artistName, alias)),
      );
      const score = number(record.score) ?? 0;

      return score >= 80 && confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE
        ? { id, name, confidence }
        : null;
    })
    .filter((artist): artist is MusicBrainzArtist => Boolean(artist))
    .slice(0, 3);
};

const fanartSourceUrl = (artistId: string): string => `https://fanart.tv/artist/${encodeURIComponent(artistId)}/`;

const fetchFanartImages = async (
  artist: MusicBrainzArtist,
  apiKey: string,
): Promise<ArtistImageCandidate[]> => {
  const params = new URLSearchParams({
    api_key: apiKey,
  });
  const payload = asRecord(await requestJson(`https://webservice.fanart.tv/v3/music/${encodeURIComponent(artist.id)}?${params.toString()}`, {
    headers: {
      Referer: 'https://fanart.tv/',
    },
  }));
  const artistThumbs = Array.isArray(payload.artistthumb) ? payload.artistthumb : [];
  const artistBackgrounds = Array.isArray(payload.artistbackground) ? payload.artistbackground : [];
  const images = [
    ...artistThumbs.map((item) => ({ record: asRecord(item), baseQuality: 1000 })),
    ...artistBackgrounds.map((item) => ({ record: asRecord(item), baseQuality: 720 })),
  ];

  return images.flatMap(({ record, baseQuality }): ArtistImageCandidate[] => {
    const imageUrl = text(record.url);
    if (!imageUrl) {
      return [];
    }

    const normalized = normalizeImageUrl(imageUrl);
    if (isLikelyDefaultRemoteImageUrl(normalized)) {
      return [];
    }

    return [{
      provider: providerName,
      providerArtistId: artist.id,
      artistName: artist.name,
      imageUrl: normalized,
      confidence: artist.confidence,
      quality: baseQuality + (number(record.likes) ?? 0),
      sourceUrl: fanartSourceUrl(artist.id),
      sourceRef: artist.id,
    }];
  });
};

export class MusicBrainzFanartArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 1400;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const apiKey = fanartApiKey();
    if (!apiKey) {
      return [];
    }

    const artists = await searchMusicBrainzArtists(input.artistName);
    const candidates = await Promise.all(artists.map((artist) => fetchFanartImages(artist, apiKey).catch(() => [])));
    return sortArtistImageCandidates(candidates.flat());
  }
}
