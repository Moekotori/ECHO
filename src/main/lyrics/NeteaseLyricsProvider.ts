import type { LyricsQuery } from '../../shared/types/lyrics';
import { asRecord, fetchJsonWithTimeout, number, text } from '../library/network/providers/providerFetch';
import type { LyricsProvider, LyricsProviderCapability, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { isInstrumentalLyricsText } from './instrumentalPlaceholders';
import { parseSyncedLyrics } from './lyricsParser';

const neteaseHeaders = {
  Referer: 'https://music.163.com/',
};

const lyricText = (value: unknown): string | null => text(asRecord(value).lyric);

const splitLyricsByKind = (value: string | null): { syncedLyrics: string | null; plainLyrics: string | null } => {
  if (!value) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  return parseSyncedLyrics(value).length > 0
    ? { syncedLyrics: value, plainLyrics: null }
    : { syncedLyrics: null, plainLyrics: value };
};

type NeteaseSong = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  raw: unknown;
};

const searchQueryFor = (query: LyricsQuery): string => [query.title, query.artist].filter(Boolean).join(' ').trim();

const neteaseSearchUrls = (query: string): string[] => {
  const params = new URLSearchParams({ type: '1', s: query, limit: '5', offset: '0' });
  return [
    `https://music.163.com/api/search/get/web?${params.toString()}`,
    `https://music.163.com/api/cloudsearch/pc?${params.toString()}`,
  ];
};

const rawSongArtists = (song: Record<string, unknown>): Record<string, unknown>[] => {
  const artists = song.artists ?? song.ar;
  return Array.isArray(artists) ? artists.map(asRecord) : [];
};

const rawSongAlbum = (song: Record<string, unknown>): Record<string, unknown> =>
  asRecord(song.album ?? song.al);

const rawSongDurationMs = (song: Record<string, unknown>): number | null =>
  number(song.duration) ?? number(song.dt);

export class NeteaseLyricsProvider implements LyricsProvider {
  readonly id = 'netease' as const;
  readonly label = 'NetEase';
  readonly priority = 600;
  readonly capabilities: LyricsProviderCapability = {
    synced: true,
    plain: true,
    translation: true,
    romanization: true,
    byDuration: true,
    byIsrc: false,
    byMusicBrainzId: false,
    needsAccount: false,
  };

  async search(request: LyricsProviderSearchRequest): Promise<LyricsProviderResult[]> {
    try {
      const songs = await this.searchSongs(request);
      if (!request.collectAllCandidates) {
        for (const song of songs.slice(0, 5)) {
          const result = await this.fetchLyrics(song, request);
          if (result) {
            return [result];
          }
        }

        return [];
      }

      const results = await Promise.all(songs.slice(0, 5).map((song) => this.fetchLyrics(song, request)));
      return results.filter((result): result is LyricsProviderResult => Boolean(result));
    } catch {
      return [];
    }
  }

  private async searchSongs(request: LyricsProviderSearchRequest): Promise<NeteaseSong[]> {
    const seen = new Set<string>();
    const songs: NeteaseSong[] = [];

    for (const variant of request.normalized.searchVariants) {
      const songsBeforeVariant = songs.length;
      if (request.signal?.aborted) {
        break;
      }

      const query = searchQueryFor({
        ...request.query,
        title: variant.title,
        artist: variant.artist,
        album: variant.album,
      });
      if (!query) {
        continue;
      }

      for (const url of neteaseSearchUrls(query)) {
        let songValues: unknown[] = [];
        try {
          const data = asRecord(await fetchJsonWithTimeout(url, request.signal, neteaseHeaders, request.timeoutMs));
          const rawSongs = asRecord(data.result).songs;
          songValues = Array.isArray(rawSongs) ? rawSongs : [];
        } catch {
          continue;
        }

        for (const songValue of songValues) {
          const song = asRecord(songValue);
          const id = String(song.id ?? '');
          if (!id || seen.has(id)) {
            continue;
          }

          const artists = rawSongArtists(song);
          const artist = artists.map((artistValue) => text(artistValue.name)).filter(Boolean).join(' / ');
          const album = rawSongAlbum(song);
          const durationMs = rawSongDurationMs(song);

          seen.add(id);
          songs.push({
            id,
            title: text(song.name) ?? request.query.title,
            artist: artist || request.query.artist,
            album: text(album.name),
            durationSeconds: durationMs ? durationMs / 1000 : null,
            raw: songValue,
          });
        }

        if (songValues.length > 0) {
          break;
        }
      }

      if (!request.collectAllCandidates && songs.length > songsBeforeVariant) {
        break;
      }
    }

    return songs;
  }

  private async fetchLyrics(song: NeteaseSong, request: LyricsProviderSearchRequest): Promise<LyricsProviderResult | null> {
    try {
      const params = new URLSearchParams({ id: song.id, lv: '1', kv: '1', tv: '1', yv: '1', rv: '1' });
      const data = asRecord(
        await fetchJsonWithTimeout(`https://music.163.com/api/song/lyric?${params.toString()}`, request.signal, neteaseHeaders, request.timeoutMs),
      );
      const primaryLyricsText = lyricText(data.lrc);
      const isPlaceholderInstrumental = isInstrumentalLyricsText(primaryLyricsText);
      const providerText = isPlaceholderInstrumental
        ? { syncedLyrics: null, plainLyrics: null }
        : splitLyricsByKind(primaryLyricsText);
      const karaokeLyrics = lyricText(data.yrc) ?? lyricText(data.klyric);
      const instrumental = data.nolyric === true || data.needDesc === true || isPlaceholderInstrumental;

      if (!instrumental && !providerText.syncedLyrics && !providerText.plainLyrics && !karaokeLyrics) {
        return null;
      }

      return {
        provider: 'netease',
        providerLyricsId: `netease:${song.id}`,
        title: song.title,
        artist: song.artist,
        album: song.album,
        durationSeconds: song.durationSeconds,
        instrumental,
        plainLyrics: providerText.plainLyrics,
        syncedLyrics: providerText.syncedLyrics,
        karaokeLyrics,
        translationLyrics: lyricText(data.tlyric),
        romanizationLyrics: lyricText(data.romalrc),
        sourceUrl: `https://music.163.com/#/song?id=${encodeURIComponent(song.id)}`,
        sourceLabel: 'NetEase',
        matchReasons: ['netease_provider'],
        raw: {
          song: song.raw,
          lyric: data,
        },
      };
    } catch {
      return null;
    }
  }
}
