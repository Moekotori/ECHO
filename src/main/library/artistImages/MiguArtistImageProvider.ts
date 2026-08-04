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

const providerName = 'migu';
const miguReferer = 'https://music.migu.cn/';

type MiguArtist = {
  id: string;
  name: string;
  confidence: number;
};

const imageQualityForSizeType = (value: unknown): number => {
  const normalized = text(value);
  switch (normalized) {
    case '03':
      return 1000;
    case '02':
      return 640;
    case '01':
      return 320;
    default:
      return 500;
  }
};

const sourceUrl = (artistId: string): string => `https://music.migu.cn/v3/music/artist/${encodeURIComponent(artistId)}`;

const searchArtists = async (artistName: string): Promise<Array<{ id: string; name: string }>> => {
  const searchSwitch = JSON.stringify({
    song: 0,
    album: 0,
    singer: 1,
    tagSong: 0,
    mvSong: 0,
    bestShow: 0,
    songlist: 0,
    lyricSong: 0,
  });
  const params = new URLSearchParams({
    text: artistName,
    pageNo: '1',
    pageSize: '6',
    searchSwitch,
  });
  const payload = asRecord(await requestJson(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?${params.toString()}`, {
    headers: {
      Referer: miguReferer,
    },
  }));
  const resultData = asRecord(payload.singerResultData);
  const results = Array.isArray(resultData.result) ? resultData.result : [];

  return results
    .map((item): { id: string; name: string } | null => {
      const record = asRecord(item);
      const id = text(record.id);
      const name = text(record.name);
      return id && name ? { id, name } : null;
    })
    .filter((artist): artist is { id: string; name: string } => Boolean(artist));
};

const fetchArtistImages = async (artistId: string): Promise<Array<{ url: string; quality: number }>> => {
  const params = new URLSearchParams({
    resourceType: '2002',
    resourceId: artistId,
  });
  const payload = asRecord(await requestJson(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${params.toString()}`, {
    headers: {
      Referer: miguReferer,
    },
  }));
  const resources = Array.isArray(payload.resource) ? payload.resource : [];
  const resource = asRecord(resources[0]);
  const imgs = Array.isArray(resource.imgs) ? resource.imgs : [];

  return imgs
    .flatMap((item) => {
      const record = asRecord(item);
      const quality = imageQualityForSizeType(record.imgSizeType);
      return unique([text(record.imgOri), text(record.webpImg), text(record.img)])
        .map((url) => normalizeImageUrl(url))
        .filter((url) => !isLikelyDefaultRemoteImageUrl(url))
        .map((url) => ({ url, quality }));
    });
};

export class MiguArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 750;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const artists = (await searchArtists(input.artistName))
      .map((artist): MiguArtist => ({
        ...artist,
        confidence: artistImageConfidence(input.artistName, artist.name),
      }))
      .filter((artist) => artist.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE)
      .slice(0, 3);

    const candidates = await Promise.all(
      artists.map(async (artist): Promise<ArtistImageCandidate[]> => {
        const images = await fetchArtistImages(artist.id);
        return images.map((image) => ({
          provider: providerName,
          providerArtistId: artist.id,
          artistName: artist.name,
          imageUrl: image.url,
          confidence: artist.confidence,
          quality: image.quality,
          sourceUrl: sourceUrl(artist.id),
          sourceRef: artist.id,
        }));
      }),
    );

    return sortArtistImageCandidates(candidates.flat());
  }
}
