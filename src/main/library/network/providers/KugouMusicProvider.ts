import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkMetadataCandidateInput, NetworkTrackLookup } from '../networkTypes';
import { asRecord, buildSearchQuery, fetchJsonWithTimeout, number, text } from './providerFetch';

const kugouHeaders = {
  Referer: 'https://www.kugou.com/',
};

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) {
      return value.replace(/<[^>]+>/gu, '').trim();
    }
  }

  return null;
};

const secondsFromDuration = (value: unknown): number | null => {
  const parsed = number(value);
  if (!parsed) {
    return null;
  }

  return parsed > 1000 ? parsed / 1000 : parsed;
};

const kugouImageUrl = (value: unknown, size = 300): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  return raw.replace(/\{size\}/gu, String(size)).replace(/^http:\/\//iu, 'https://');
};

export class KugouMusicProvider implements NetworkMetadataProvider {
  readonly name = 'kugou-music' as const;

  async findMetadata(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkMetadataCandidateInput[]> {
    const query = buildSearchQuery(track.title, track.artist, track.filename);
    if (!query) {
      return [];
    }

    const params = new URLSearchParams({
      format: 'json',
      keyword: query,
      page: '1',
      pagesize: '5',
      showtype: '1',
    });
    const data = asRecord(await fetchJsonWithTimeout(`https://mobiles.kugou.com/api/v3/search/song?${params.toString()}`, signal, kugouHeaders));
    const rawSongs = asRecord(data.data).info;
    const songs: unknown[] = Array.isArray(rawSongs) ? rawSongs : [];

    return songs.map((songValue): NetworkMetadataCandidateInput => {
      const song = asRecord(songValue);
      const hash = firstText(song, ['hash', 'Hash', 'FileHash', 'SQFileHash', 'HQFileHash']);
      const artist = firstText(song, ['singername', 'SingerName', 'singer_name', 'author_name']);
      const album = firstText(song, ['AlbumName', 'album_name', 'albumname', 'albumName']);

      return {
        provider: this.name,
        providerItemId: `kugou:${hash ?? firstText(song, ['songname', 'SongName']) ?? track.trackId}`,
        title: firstText(song, ['songname', 'SongName', 'song_name', 'FileName']),
        artist,
        album,
        albumArtist: artist,
        year: null,
        genre: null,
        duration: secondsFromDuration(song.duration ?? song.Duration),
        trackNo: null,
        discNo: null,
        coverUrl: kugouImageUrl(song.imgurl ?? song.image ?? song.cover),
        raw: song,
      };
    });
  }
}
