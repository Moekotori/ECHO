import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkMetadataCandidateInput, NetworkTrackLookup } from '../networkTypes';
import { asRecord, buildSearchQuery, fetchJsonWithTimeout, number, text } from './providerFetch';

export class QQMusicProvider implements NetworkMetadataProvider {
  readonly name = 'qq-music' as const;

  async findMetadata(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkMetadataCandidateInput[]> {
    const query = buildSearchQuery(track.title, track.artist, track.filename);
    if (!query) {
      return [];
    }

    const params = new URLSearchParams({
      ct: '24',
      qqmusic_ver: '1298',
      new_json: '1',
      remoteplace: 'txt.yqq.song',
      t: '0',
      aggr: '1',
      cr: '1',
      catZhida: '1',
      lossless: '0',
      flag_qc: '0',
      p: '1',
      n: '5',
      w: query,
      format: 'json',
    });
    const data = asRecord(
      await fetchJsonWithTimeout(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params.toString()}`, signal, {
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
      }),
    );
    const songData = asRecord(asRecord(data.data).song);
    const songs = Array.isArray(songData.list) ? songData.list : [];

    return songs.map((songValue): NetworkMetadataCandidateInput => {
      const song = asRecord(songValue);
      const album = asRecord(song.album);
      const singers = Array.isArray(song.singer) ? song.singer.map(asRecord) : [];
      const artistName = singers.map((singer) => text(singer.name)).filter(Boolean).join(' / ') || null;
      const interval = number(song.interval);
      const albumMid = text(album.mid) ?? text(album.pmid) ?? text(song.albummid);

      return {
        provider: this.name,
        providerItemId: `qq:${text(song.mid) ?? String(song.id ?? text(song.name) ?? track.trackId)}`,
        title: text(song.name) ?? text(song.title),
        artist: artistName,
        album: text(album.name) ?? text(album.title),
        albumArtist: artistName,
        year: null,
        genre: null,
        duration: interval,
        trackNo: null,
        discNo: null,
        coverUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
        raw: song,
      };
    });
  }
}
