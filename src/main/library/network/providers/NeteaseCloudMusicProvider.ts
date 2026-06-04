import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkMetadataCandidateInput, NetworkTrackLookup } from '../networkTypes';
import { asRecord, buildSearchQuery, fetchJsonWithTimeout, number, text } from './providerFetch';

const neteaseHeaders = {
  Referer: 'https://music.163.com/',
};

const neteaseImageUrl = (value: unknown): string | null => {
  const raw = text(value);
  return raw ? `${raw}?param=300y300` : null;
};

export class NeteaseCloudMusicProvider implements NetworkMetadataProvider {
  readonly name = 'netease-cloud-music' as const;

  async findMetadata(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkMetadataCandidateInput[]> {
    const query = buildSearchQuery(track.title, track.artist, track.filename);
    if (!query) {
      return [];
    }

    const params = new URLSearchParams({ type: '1', s: query, limit: '5', offset: '0' });
    const data = asRecord(await fetchJsonWithTimeout(`https://music.163.com/api/search/get/web?${params.toString()}`, signal, neteaseHeaders));
    const result = asRecord(data.result);
    const songs = Array.isArray(result.songs) ? result.songs : [];
    const detailCoverUrls = await this.findDetailCoverUrls(
      songs.map((songValue) => asRecord(songValue).id).filter((id) => id !== undefined && id !== null),
      signal,
    );

    return songs.map((songValue): NetworkMetadataCandidateInput => {
      const song = asRecord(songValue);
      const album = asRecord(song.album);
      const artists = Array.isArray(song.artists) ? song.artists.map(asRecord) : [];
      const firstArtist = artists[0] ?? {};
      const artistName = artists.map((artist) => text(artist.name)).filter(Boolean).join(' / ') || text(firstArtist.name);
      const durationMs = number(song.duration);
      const songId = String(song.id ?? text(song.name) ?? track.trackId);

      return {
        provider: this.name,
        providerItemId: `netease:${songId}`,
        title: text(song.name),
        artist: artistName,
        album: text(album.name),
        albumArtist: artistName,
        year: null,
        genre: null,
        duration: durationMs ? durationMs / 1000 : null,
        trackNo: null,
        discNo: null,
        coverUrl: neteaseImageUrl(album.picUrl ?? album.blurPicUrl) ?? detailCoverUrls.get(songId) ?? null,
        raw: song,
      };
    });
  }

  private async findDetailCoverUrls(songIds: unknown[], signal?: AbortSignal): Promise<Map<string, string>> {
    const ids = songIds.map((id) => String(id)).filter(Boolean);
    if (!ids.length) {
      return new Map();
    }

    try {
      const params = new URLSearchParams({ id: ids[0], ids: JSON.stringify(ids) });
      const data = asRecord(await fetchJsonWithTimeout(`https://music.163.com/api/song/detail/?${params.toString()}`, signal, neteaseHeaders));
      const songs = Array.isArray(data.songs) ? data.songs : [];
      return new Map(
        songs
          .map((songValue): [string, string] | null => {
            const song = asRecord(songValue);
            const album = asRecord(song.album);
            const coverUrl = neteaseImageUrl(album.picUrl ?? album.blurPicUrl);
            return coverUrl ? [String(song.id), coverUrl] : null;
          })
          .filter((entry): entry is [string, string] => Boolean(entry)),
      );
    } catch {
      return new Map();
    }
  }
}
