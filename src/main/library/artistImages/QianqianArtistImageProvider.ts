import { createHash } from 'node:crypto';
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

const providerName = 'qianqian';
const appId = 16073360;
const signSecret = '0b50b02fd0d73a9c4c8c3a781c30845f';
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

const signParams = (params: Record<string, string | number>): Record<string, string> => {
  const signed: Record<string, string | number> = {
    ...params,
    appid: appId,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const payload = `${Object.keys(signed)
    .sort()
    .map((key) => `${key}=${signed[key]}`)
    .join('&')}${signSecret}`;

  return Object.fromEntries(
    Object.entries({
      ...signed,
      sign: md5(payload),
    }).map(([key, value]) => [key, String(value)]),
  );
};

const imageUrlFromPath = (url: string): string => {
  if (url.startsWith('/')) {
    return `https://img01.dmhmusic.com${url}`;
  }

  return normalizeImageUrl(url);
};

const sourceUrl = (artistCode: string | null): string | null =>
  artistCode ? `https://music.91q.com/artist/${encodeURIComponent(artistCode)}` : null;

export class QianqianArtistImageProvider implements ArtistImageProvider {
  readonly name = providerName;
  readonly minRequestIntervalMs = 750;

  async searchArtistImage(input: { artistName: string; artistKey: string }): Promise<ArtistImageCandidate[]> {
    const params = signParams({
      word: input.artistName,
      type: 2,
      pageNo: 1,
      pageSize: 6,
    });
    const payload = asRecord(await requestJson(`https://music.91q.com/v1/search?${new URLSearchParams(params).toString()}`, {
      headers: {
        from: 'web',
        requestid: `${params.timestamp}_artist`,
        'device-id': md5(userAgent),
        Referer: 'https://music.91q.com/',
        'User-Agent': userAgent,
      },
    }));
    const data = asRecord(payload.data);
    const artists = Array.isArray(data.typeArtist) ? data.typeArtist : [];

    return sortArtistImageCandidates(
      artists.flatMap((item): ArtistImageCandidate[] => {
        const record = asRecord(item);
        const artistName = text(record.name);
        if (!artistName) {
          return [];
        }

        const providerArtistId = text(record.artistCode);
        const confidence = artistImageConfidence(input.artistName, artistName);
        const pictorialList = Array.isArray(record.pictorialList) ? record.pictorialList.map(text) : [];
        const imageUrls = unique([text(record.pic), ...pictorialList])
          .map(imageUrlFromPath)
          .filter((url) => !isLikelyDefaultRemoteImageUrl(url));

        return imageUrls.map((imageUrl, index) => ({
          provider: providerName,
          providerArtistId,
          artistName,
          imageUrl,
          confidence,
          quality: index === 0 ? 800 : 520,
          sourceUrl: sourceUrl(providerArtistId),
          sourceRef: providerArtistId,
        }));
      }),
    ).filter((candidate, index) => index === 0 || candidate.confidence >= ARTIST_IMAGE_AUTO_MATCH_MIN_CONFIDENCE);
  }
}
