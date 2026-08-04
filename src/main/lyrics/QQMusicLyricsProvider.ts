import { Buffer } from 'node:buffer';
import type { LyricsQuery } from '../../shared/types/lyrics';
import { asRecord, fetchJsonWithTimeout, number, text } from '../library/network/providers/providerFetch';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import type { LyricsProvider, LyricsProviderCapability, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { isInstrumentalLyricsText } from './instrumentalPlaceholders';
import { parseSyncedLyrics } from './lyricsParser';

const qqHeaders = {
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const fetchJsonBodyWithTimeout = async (
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  timeoutMs = 6000,
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchWithNetworkProxy(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'Content-Type': 'application/json',
        ...qqHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    const textValue = await response.text();
    const jsonText = textValue.trim().replace(/^[^(]*\((.*)\);?$/s, '$1');
    return JSON.parse(jsonText) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

type QQSong = {
  mid: string;
  id: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  raw: unknown;
};

const maybeDecodeBase64 = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  if (raw.includes('[') || raw.includes('\n') || /[\u4e00-\u9fff]/u.test(raw) || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(raw)) {
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded || raw;
  } catch {
    return raw;
  }
};

const splitLyricsByKind = (value: string | null): { syncedLyrics: string | null; plainLyrics: string | null } => {
  if (!value) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  return parseSyncedLyrics(value).length > 0
    ? { syncedLyrics: value, plainLyrics: null }
    : { syncedLyrics: null, plainLyrics: value };
};

const searchQueryFor = (query: LyricsQuery): string => [query.title, query.artist].filter(Boolean).join(' ').trim();

const qqIdText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return text(value);
};

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = qqIdText(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const songMidFromRecord = (song: Record<string, unknown>): string | null => {
  const file = asRecord(song.file);
  return (
    firstText(song, ['mid', 'songmid', 'songMid', 'songMID', 'song_mid', 'strMediaMid', 'mediaMid', 'media_mid']) ??
    text(file.media_mid) ??
    text(file.mediaMid) ??
    text(file.strMediaMid)
  );
};

export class QQMusicLyricsProvider implements LyricsProvider {
  readonly id = 'qqmusic' as const;
  readonly label = 'QQ Music';
  readonly priority = 590;
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
      const direct = await this.searchDirectStreamingLyrics(request);
      if (direct) {
        return [direct];
      }

      const songs = await this.searchSongs(request);
      const results = await Promise.all(songs.slice(0, 5).map((song) => this.fetchLyrics(song, request)));
      return results.filter((result): result is LyricsProviderResult => Boolean(result));
    } catch {
      return [];
    }
  }

  private async searchDirectStreamingLyrics(request: LyricsProviderSearchRequest): Promise<LyricsProviderResult | null> {
    const sourceId = text(request.query.sourceId);
    if (request.query.mediaType !== 'streaming' || !sourceId) {
      return null;
    }

    const song = await this.fetchSong(sourceId, request).catch(() => null);
    const fallback: QQSong = {
      mid: sourceId,
      id: sourceId.match(/^\d+$/u) ? sourceId : null,
      title: request.query.title,
      artist: request.query.artist,
      album: request.query.album ?? null,
      durationSeconds: request.query.durationSeconds ?? null,
      raw: { providerTrackId: sourceId },
    };

    return this.fetchLyrics(song ?? fallback, request);
  }

  private async fetchSong(providerTrackId: string, request: LyricsProviderSearchRequest): Promise<QQSong | null> {
    const requestVariants: Array<{ key: 'songmid' | 'songid'; value: string }> = [
      { key: 'songmid', value: providerTrackId },
      ...(providerTrackId.match(/^\d+$/u) ? [{ key: 'songid' as const, value: providerTrackId }] : []),
    ];

    for (const variant of requestVariants) {
      const params = new URLSearchParams({
        tpl: 'yqq_song_detail',
        format: 'json',
      });
      params.set(variant.key, variant.value);
      const data = asRecord(
        await fetchJsonWithTimeout(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${params.toString()}`, request.signal, qqHeaders, request.timeoutMs),
      );
      const songs = Array.isArray(data.data) ? data.data : [];
      const song = this.mapSong(songs[0], request.query);
      if (song) {
        return song;
      }
    }

    return null;
  }

  private async searchSongs(request: LyricsProviderSearchRequest): Promise<QQSong[]> {
    const seen = new Set<string>();
    const songs: QQSong[] = [];

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

      const nextSongs = await this.searchSongsWithMusicu(query, request);
      for (const song of nextSongs) {
        if (!seen.has(song.mid)) {
          seen.add(song.mid);
          songs.push(song);
        }
      }

      if (nextSongs.length > 0) {
        continue;
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
        await fetchJsonWithTimeout(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params.toString()}`, request.signal, qqHeaders, request.timeoutMs),
      );
      const songData = asRecord(asRecord(data.data).song);
      const songValues = Array.isArray(songData.list) ? songData.list : [];

      for (const songValue of songValues) {
        const song = this.mapSong(songValue, request.query);
        if (!song || seen.has(song.mid)) {
          continue;
        }

        seen.add(song.mid);
        songs.push(song);
      }
    }

    return songs;
  }

  private async searchSongsWithMusicu(query: string, request: LyricsProviderSearchRequest): Promise<QQSong[]> {
    try {
      const body = {
        comm: {
          ct: '19',
          cv: '1859',
          uin: '0',
        },
        req_1: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: {
            query,
            page_num: 1,
            num_per_page: 5,
            search_type: 0,
          },
        },
      };
      const data = asRecord(
        await fetchJsonBodyWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', body, request.signal, request.timeoutMs),
      );
      const payload = asRecord(asRecord(data.req_1).data);
      const bodyData = asRecord(payload.body);
      const songData = asRecord(bodyData.song);
      const songValues = Array.isArray(songData.list) ? songData.list : [];

      return songValues
        .map((songValue) => this.mapSong(songValue, request.query))
        .filter((song): song is QQSong => Boolean(song));
    } catch {
      return [];
    }
  }

  private mapSong(songValue: unknown, fallback: LyricsQuery): QQSong | null {
    const song = asRecord(songValue);
    const mid = songMidFromRecord(song);
    if (!mid) {
      return null;
    }

    const singers = Array.isArray(song.singer) ? song.singer.map(asRecord) : [];
    const artist = singers.map((singer) => text(singer.name)).filter(Boolean).join(' / ');
    const album = asRecord(song.album);

    return {
      mid,
      id: song.id == null ? null : String(song.id),
      title: text(song.name) ?? text(song.title) ?? text(song.songname) ?? text(song.songorig) ?? fallback.title,
      artist: artist || fallback.artist,
      album: text(album.name) ?? text(album.title) ?? text(song.albumname) ?? text(song.albumtitle),
      durationSeconds: number(song.interval),
      raw: songValue,
    };
  }

  private async fetchLyrics(song: QQSong, request: LyricsProviderSearchRequest): Promise<LyricsProviderResult | null> {
    try {
      const params = new URLSearchParams({
        songmid: song.mid,
        pcachetime: String(Date.now()),
        g_tk: '5381',
        loginUin: '0',
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq',
        needNewCode: '0',
        nobase64: '1',
      });
      const data = asRecord(
        await fetchJsonWithTimeout(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params.toString()}`, request.signal, qqHeaders, request.timeoutMs),
      );
      const primaryLyricsText = maybeDecodeBase64(data.lyric);
      const isPlaceholderInstrumental = isInstrumentalLyricsText(primaryLyricsText);
      const providerText = isPlaceholderInstrumental
        ? { syncedLyrics: null, plainLyrics: null }
        : splitLyricsByKind(primaryLyricsText);
      const karaokeLyrics = maybeDecodeBase64(data.qrc) ?? maybeDecodeBase64(data.karaoke);

      if (!isPlaceholderInstrumental && !providerText.syncedLyrics && !providerText.plainLyrics && !karaokeLyrics) {
        return null;
      }

      return {
        provider: 'qqmusic',
        providerLyricsId: `qqmusic:${song.mid}`,
        title: song.title,
        artist: song.artist,
        album: song.album,
        durationSeconds: song.durationSeconds,
        instrumental: isPlaceholderInstrumental,
        plainLyrics: providerText.plainLyrics,
        syncedLyrics: providerText.syncedLyrics,
        karaokeLyrics,
        translationLyrics: maybeDecodeBase64(data.trans),
        romanizationLyrics: maybeDecodeBase64(data.roma),
        sourceUrl: `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(song.mid)}`,
        sourceLabel: 'QQ Music',
        matchReasons: ['qqmusic_provider'],
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
