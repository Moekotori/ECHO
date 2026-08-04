import type { LyricsQuery } from '../../shared/types/lyrics';
import { asRecord, fetchJsonWithTimeout, number, text } from '../library/network/providers/providerFetch';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import type { LyricsProvider, LyricsProviderCapability, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { isInstrumentalLyricsText } from './instrumentalPlaceholders';

const kuwoHeaders = {
  Referer: 'https://www.kuwo.cn/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const parseKuwoObjectLiteral = (value: string): unknown => {
  const jsonText = value
    .trim()
    .replace(/'((?:\\.|[^'\\])*)'/gu, (_match, content: string) => `"${content.replace(/"/gu, '\\"')}"`);
  return JSON.parse(jsonText) as unknown;
};

const fetchKuwoSearchJson = async (url: string, signal: AbortSignal | undefined, timeoutMs = 6000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchWithNetworkProxy(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        ...kuwoHeaders,
      },
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    const rawText = await response.text();
    return parseKuwoObjectLiteral(rawText);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};

type KuwoSong = {
  rid: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  raw: unknown;
};

const searchQueryFor = (query: LyricsQuery): string => [query.title, query.artist].filter(Boolean).join(' ').trim();

const stripHtml = (value: string | null): string | null => {
  const normalized = value?.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim();
  return normalized || null;
};

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = stripHtml(text(record[key]));
    if (value) {
      return value;
    }
  }

  return null;
};

const normalizeRid = (value: unknown): string | null => {
  const raw = text(value);
  const match = raw?.match(/\d+/u);
  return match?.[0] ?? null;
};

const formatLrcTimestamp = (secondsValue: number): string => {
  const safeMs = Math.max(0, Math.round(secondsValue * 1000));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const centiseconds = Math.floor((safeMs % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

const lineTimeSeconds = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const buildSyncedLyrics = (value: unknown): string | null => {
  const lines = Array.isArray(value) ? value : [];
  const syncedLines = lines
    .map((lineValue) => {
      const line = asRecord(lineValue);
      const lyricText = stripHtml(text(line.lineLyric) ?? text(line.lyric) ?? text(line.text));
      const timeSeconds = lineTimeSeconds(line.time);
      return lyricText && timeSeconds !== null ? `${formatLrcTimestamp(timeSeconds)}${lyricText}` : null;
    })
    .filter((line): line is string => Boolean(line));

  return syncedLines.length ? syncedLines.join('\n') : null;
};

export class KuwoLyricsProvider implements LyricsProvider {
  readonly id = 'kuwo' as const;
  readonly label = 'Kuwo';
  readonly priority = 560;
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

  private async searchSongs(request: LyricsProviderSearchRequest): Promise<KuwoSong[]> {
    const seen = new Set<string>();
    const songs: KuwoSong[] = [];

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
        all: query,
        ft: 'music',
        itemset: 'web_2013',
        client: 'kt',
        pn: '0',
        rn: '5',
        rformat: 'json',
        encoding: 'utf8',
      });
      const data = asRecord(await fetchKuwoSearchJson(`https://search.kuwo.cn/r.s?${params.toString()}`, request.signal, request.timeoutMs));
      const songValues = Array.isArray(data.abslist) ? data.abslist : [];

      for (const songValue of songValues) {
        const song = asRecord(songValue);
        const rid = normalizeRid(song.MUSICRID ?? song.musicrid ?? song.rid);
        if (!rid || seen.has(rid)) {
          continue;
        }

        seen.add(rid);
        songs.push({
          rid,
          title: firstText(song, ['SONGNAME', 'songname', 'name']) ?? request.query.title,
          artist: firstText(song, ['ARTIST', 'artist']) ?? request.query.artist,
          album: firstText(song, ['ALBUM', 'album']),
          durationSeconds: number(song.DURATION ?? song.duration),
          raw: songValue,
        });
      }
    }

    return songs;
  }

  private async fetchLyrics(song: KuwoSong, request: LyricsProviderSearchRequest): Promise<LyricsProviderResult | null> {
    try {
      const params = new URLSearchParams({ musicId: song.rid });
      const data = asRecord(
        await fetchJsonWithTimeout(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?${params.toString()}`, request.signal, kuwoHeaders, request.timeoutMs),
      );
      const payload = asRecord(data.data);
      const syncedLyrics = buildSyncedLyrics(payload.lrclist);
      const plainLyrics = text(payload.lyrics) ?? null;
      const primaryText = syncedLyrics ?? plainLyrics;
      const isPlaceholderInstrumental = isInstrumentalLyricsText(primaryText);

      if (!isPlaceholderInstrumental && !syncedLyrics && !plainLyrics) {
        return null;
      }

      return {
        provider: 'kuwo',
        providerLyricsId: `kuwo:${song.rid}`,
        title: song.title,
        artist: song.artist,
        album: song.album,
        durationSeconds: song.durationSeconds,
        instrumental: isPlaceholderInstrumental,
        plainLyrics: isPlaceholderInstrumental ? null : plainLyrics,
        syncedLyrics: isPlaceholderInstrumental ? null : syncedLyrics,
        sourceUrl: `https://www.kuwo.cn/play_detail/${encodeURIComponent(song.rid)}`,
        sourceLabel: 'Kuwo',
        matchReasons: ['kuwo_provider'],
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
