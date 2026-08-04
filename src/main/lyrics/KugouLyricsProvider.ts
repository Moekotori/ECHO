import { Buffer } from 'node:buffer';
import type { LyricsQuery } from '../../shared/types/lyrics';
import { asRecord, fetchJsonWithTimeout, number, text } from '../library/network/providers/providerFetch';
import type { LyricsProvider, LyricsProviderCapability, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { isInstrumentalLyricsText } from './instrumentalPlaceholders';
import { parseSyncedLyrics } from './lyricsParser';

const kugouHeaders = {
  Referer: 'https://www.kugou.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

type KugouSong = {
  hash: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  raw: unknown;
};

type KugouLyricCandidate = {
  id: string;
  accessKey: string;
  title: string | null;
  artist: string | null;
  durationSeconds: number | null;
  raw: unknown;
};

const searchQueryFor = (query: LyricsQuery): string => [query.title, query.artist].filter(Boolean).join(' ').trim();

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) {
      return value;
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

const splitLyricsByKind = (value: string | null): { syncedLyrics: string | null; plainLyrics: string | null } => {
  if (!value) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  return parseSyncedLyrics(value).length > 0
    ? { syncedLyrics: value, plainLyrics: null }
    : { syncedLyrics: null, plainLyrics: value };
};

const decodeKugouContent = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  if (raw.includes('[') || raw.includes('\n') || /[\u4e00-\u9fff]/u.test(raw)) {
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded || null;
  } catch {
    return raw;
  }
};

export class KugouLyricsProvider implements LyricsProvider {
  readonly id = 'kugou' as const;
  readonly label = 'KuGou';
  readonly priority = 570;
  readonly capabilities: LyricsProviderCapability = {
    synced: true,
    plain: true,
    translation: false,
    romanization: false,
    byDuration: true,
    byIsrc: false,
    byMusicBrainzId: false,
    needsAccount: false,
  };

  async search(request: LyricsProviderSearchRequest): Promise<LyricsProviderResult[]> {
    try {
      const songs = await this.searchSongs(request);
      const results = await Promise.all(songs.slice(0, 5).map((song) => this.fetchLyrics(song, request)));
      return results.filter((result): result is LyricsProviderResult => Boolean(result));
    } catch {
      return [];
    }
  }

  private async searchSongs(request: LyricsProviderSearchRequest): Promise<KugouSong[]> {
    const seen = new Set<string>();
    const songs: KugouSong[] = [];

    for (const variant of request.normalized.searchVariants) {
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

      const params = new URLSearchParams({
        format: 'json',
        keyword: query,
        page: '1',
        pagesize: '5',
        showtype: '1',
      });
      const data = asRecord(
        await fetchJsonWithTimeout(`http://mobilecdn.kugou.com/api/v3/search/song?${params.toString()}`, request.signal, kugouHeaders, request.timeoutMs),
      );
      const rawSongValues = asRecord(data.data).info;
      const songValues: unknown[] = Array.isArray(rawSongValues) ? rawSongValues : [];

      for (const songValue of songValues) {
        const song = asRecord(songValue);
        const hash = firstText(song, ['hash', 'Hash', 'FileHash', 'SQFileHash', 'HQFileHash']);
        const id = hash ?? `${text(song.SongName) ?? text(song.songname) ?? ''}|${text(song.SingerName) ?? ''}`;
        if (!id || seen.has(id)) {
          continue;
        }

        seen.add(id);
        songs.push({
          hash,
          title: text(song.SongName) ?? text(song.songname) ?? text(song.FileName) ?? request.query.title,
          artist: text(song.SingerName) ?? text(song.singername) ?? request.query.artist,
          album: text(song.AlbumName) ?? text(song.album_name),
          durationSeconds: secondsFromDuration(song.Duration ?? song.duration),
          raw: songValue,
        });
      }
    }

    return songs;
  }

  private async searchLyricCandidates(song: KugouSong, request: LyricsProviderSearchRequest): Promise<KugouLyricCandidate[]> {
    const params = new URLSearchParams({
      ver: '1',
      man: 'yes',
      client: 'pc',
      keyword: [song.title, song.artist].filter(Boolean).join(' '),
      duration: song.durationSeconds ? String(Math.round(song.durationSeconds * 1000)) : '',
    });
    if (song.hash) {
      params.set('hash', song.hash);
    }

    const data = asRecord(await fetchJsonWithTimeout(`https://lyrics.kugou.com/search?${params.toString()}`, request.signal, kugouHeaders, request.timeoutMs));
    const dataCandidates = asRecord(data.data).candidates;
    const values: unknown[] = Array.isArray(data.candidates)
      ? data.candidates
      : Array.isArray(dataCandidates)
        ? dataCandidates
        : [];

    return values
      .map((value): KugouLyricCandidate | null => {
        const record = asRecord(value);
        const id = text(record.id);
        const accessKey = text(record.accesskey) ?? text(record.accessKey);
        if (!id || !accessKey) {
          return null;
        }

        return {
          id,
          accessKey,
          title: text(record.song) ?? text(record.title) ?? text(record.filename),
          artist: text(record.singer) ?? text(record.artist),
          durationSeconds: secondsFromDuration(record.duration),
          raw: value,
        };
      })
      .filter((candidate): candidate is KugouLyricCandidate => Boolean(candidate));
  }

  private async fetchLyrics(song: KugouSong, request: LyricsProviderSearchRequest): Promise<LyricsProviderResult | null> {
    const [candidate] = await this.searchLyricCandidates(song, request);
    if (!candidate) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        ver: '1',
        client: 'pc',
        id: candidate.id,
        accesskey: candidate.accessKey,
        fmt: 'lrc',
        charset: 'utf8',
      });
      const data = asRecord(await fetchJsonWithTimeout(`https://lyrics.kugou.com/download?${params.toString()}`, request.signal, kugouHeaders, request.timeoutMs));
      const lyricsText = decodeKugouContent(data.content);
      const isPlaceholderInstrumental = isInstrumentalLyricsText(lyricsText);
      const providerText = isPlaceholderInstrumental
        ? { syncedLyrics: null, plainLyrics: null }
        : splitLyricsByKind(lyricsText);

      if (!isPlaceholderInstrumental && !providerText.syncedLyrics && !providerText.plainLyrics) {
        return null;
      }

      return {
        provider: 'kugou',
        providerLyricsId: `kugou:${candidate.id}`,
        title: candidate.title ?? song.title,
        artist: candidate.artist ?? song.artist,
        album: song.album,
        durationSeconds: candidate.durationSeconds ?? song.durationSeconds,
        instrumental: isPlaceholderInstrumental,
        plainLyrics: providerText.plainLyrics,
        syncedLyrics: providerText.syncedLyrics,
        sourceUrl: song.hash ? `https://www.kugou.com/song/#hash=${encodeURIComponent(song.hash)}` : 'https://www.kugou.com/',
        sourceLabel: 'KuGou',
        matchReasons: ['kugou_provider'],
        raw: {
          song: song.raw,
          candidate: candidate.raw,
          lyric: data,
        },
      };
    } catch {
      return null;
    }
  }
}
