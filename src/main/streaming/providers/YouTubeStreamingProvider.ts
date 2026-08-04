import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  StreamingArtistRef,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylistDetail,
  StreamingProviderDescriptor,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import { getAccountService } from '../../accounts/AccountService';
import type { StreamingProvider } from '../StreamingProvider';
import { asRecord, integer, text } from './chinaStreamingUtils';

const provider = 'youtube' as const;
const youtubeReferer = 'https://www.youtube.com/';
const youtubeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ytDlpFileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpTimeoutMs = 45_000;
const ytDlpMaxBuffer = 1024 * 1024 * 12;
const fallbackPlaybackTtlMs = 5 * 60 * 1000;

type YtDlpEntry = Record<string, unknown>;
type YtDlpFormat = Record<string, unknown>;

const accountStatus = () => getAccountService().getStatus(provider);

const accountBrowser = (): string | null => {
  const browser = getAccountService().getCredentials(provider).browser;
  return browser && browser !== 'none' ? browser : null;
};

const ytDlpPathCandidates = (): string[] => {
  const explicit = process.env.ECHO_YTDLP_PATH?.trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [
    ...(explicit ? [explicit] : []),
    ...(resourcesPath ? [resolve(resourcesPath, 'tools', ytDlpFileName)] : []),
    ...(process.platform !== 'win32' ? [resolve(process.cwd(), 'electron-app', 'tools-linux', ytDlpFileName)] : []),
    resolve(process.cwd(), 'electron-app', 'tools', ytDlpFileName),
    ytDlpFileName,
  ];
};

const resolveYtDlpPath = (): string => {
  for (const candidate of ytDlpPathCandidates()) {
    if (candidate === ytDlpFileName || existsSync(candidate)) {
      return candidate;
    }
  }

  return ytDlpFileName;
};

const isRecoverableBrowserCookieError = (detail: string): boolean =>
  /cookies-from-browser|dpapi|decrypt|browser cookies|cookie database|could not copy .*cookie/iu.test(detail);

const runYtDlpAttempt = (args: string[], browser: string | null): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    execFile(
      resolveYtDlpPath(),
      ['--no-warnings', ...(browser ? ['--cookies-from-browser', browser] : []), ...args],
      {
        encoding: 'utf8',
        maxBuffer: ytDlpMaxBuffer,
        timeout: ytDlpTimeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`YouTube extractor failed: ${detail}`));
          return;
        }

        resolveOutput(stdout.trim());
      },
    );
  });

const runYtDlp = async (args: string[], options: { useBrowserCookies?: boolean } = {}): Promise<string> => {
  const browser = options.useBrowserCookies === false ? null : accountBrowser();
  try {
    return await runYtDlpAttempt(args, browser);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!browser || !isRecoverableBrowserCookieError(message)) {
      throw error;
    }

    return runYtDlpAttempt(args, null);
  }
};

const ytDlpJson = async <T>(args: string[], options?: { useBrowserCookies?: boolean }): Promise<T> => {
  const output = await runYtDlp(['--dump-single-json', ...args], options);
  if (!output) {
    throw new Error('YouTube extractor returned no metadata.');
  }

  return JSON.parse(output) as T;
};

const youtubeVideoIdFromValue = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const direct = raw.match(/^[A-Za-z0-9_-]{11}$/u)?.[0];
  if (direct) {
    return direct;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      return parsed.searchParams.get('v') ?? parsed.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/u)?.[1] ?? null;
    }
  } catch {
    return raw.match(/[?&]v=([A-Za-z0-9_-]{11})/u)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/u)?.[1] ?? null;
  }

  return null;
};

const resolvedTrackUrl = (providerTrackId: string): string => {
  if (/^https?:\/\//iu.test(providerTrackId)) {
    return providerTrackId;
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(providerTrackId)}`;
};

const youtubePlaylistUrl = (providerPlaylistId: string): string => {
  if (/^https?:\/\//iu.test(providerPlaylistId)) {
    return providerPlaylistId;
  }

  return `https://www.youtube.com/playlist?list=${encodeURIComponent(providerPlaylistId)}`;
};

const bestThumbnail = (entry: YtDlpEntry, videoId: string, preferSmall = false): string | null => {
  const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails.map(asRecord) : [];
  const directThumbnail = text(entry.thumbnail);
  const candidates = thumbnails.length > 0 ? thumbnails : directThumbnail ? [{ url: directThumbnail }] : [];
  const fallbackUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${preferSmall ? 'default' : 'hqdefault'}.jpg`;
  if (candidates.length === 0) {
    return fallbackUrl;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftWidth = Number(left.width ?? 0);
    const rightWidth = Number(right.width ?? 0);
    return preferSmall ? leftWidth - rightWidth : rightWidth - leftWidth;
  });
  const imageUrl = text(sorted[0]?.url)?.replace(/^http:\/\//iu, 'https://') ?? fallbackUrl;
  return imageUrl;
};

const artistRef = (entry: YtDlpEntry): StreamingArtistRef => {
  const channelId = String(entry.channel_id ?? entry.uploader_id ?? entry.channel_url ?? entry.uploader_url ?? entry.channel ?? entry.uploader ?? 'youtube').trim();
  const name = text(entry.artist) ?? text(entry.channel) ?? text(entry.uploader) ?? 'YouTube';
  return {
    id: streamingStableKey(provider, `artist:${channelId}`),
    provider,
    providerArtistId: channelId,
    name,
  };
};

const trackFromYtDlpEntry = (value: unknown): StreamingTrack | null => {
  const entry = asRecord(value);
  const videoId = youtubeVideoIdFromValue(entry.id) ?? youtubeVideoIdFromValue(entry.webpage_url) ?? youtubeVideoIdFromValue(entry.url);
  const title = text(entry.track) ?? text(entry.title);
  if (!videoId || !title) {
    return null;
  }

  const artist = artistRef(entry);
  const album = text(entry.album) ?? 'YouTube';
  return {
    id: streamingStableKey(provider, videoId),
    provider,
    providerTrackId: videoId,
    stableKey: streamingStableKey(provider, videoId),
    title,
    artist: artist.name,
    artists: [artist],
    album,
    albumId: null,
    albumArtist: text(entry.album_artist) ?? artist.name,
    duration: integer(entry.duration),
    coverUrl: bestThumbnail(entry, videoId),
    coverThumb: bestThumbnail(entry, videoId, true),
    qualities: ['standard', 'high'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'unknown',
    mvStatus: 'available',
  };
};

const entriesFromSearch = (value: unknown): unknown[] => {
  const record = asRecord(value);
  return Array.isArray(record.entries) ? record.entries : [];
};

const formatsFromMetadata = (value: unknown): YtDlpFormat[] => {
  const record = asRecord(value);
  const requestedDownloads = Array.isArray(record.requested_downloads) ? record.requested_downloads.map(asRecord) : [];
  const formats = Array.isArray(record.formats) ? record.formats.map(asRecord) : [];
  return [...requestedDownloads, ...formats];
};

const pickAudioFormat = (value: unknown): YtDlpFormat | null => {
  const audioFormats = formatsFromMetadata(value).filter((format) => {
    const url = text(format.url);
    const acodec = text(format.acodec);
    const vcodec = text(format.vcodec);
    return Boolean(url) && acodec !== 'none' && (vcodec === null || vcodec === 'none');
  });

  return [...audioFormats].sort((left, right) => Number(right.abr ?? right.tbr ?? 0) - Number(left.abr ?? left.tbr ?? 0))[0] ?? null;
};

const headersFromFormat = (format: YtDlpFormat): Record<string, string> => {
  const headers = asRecord(format.http_headers);
  return {
    'User-Agent': youtubeUserAgent,
    Accept: '*/*',
    Referer: youtubeReferer,
    ...Object.fromEntries(
      Object.entries(headers).filter(
        ([key, value]) => typeof value === 'string' && !/authorization|cookie/iu.test(key),
      ),
    ),
  } as Record<string, string>;
};

const playbackMimeType = (format: YtDlpFormat, url: string): string => {
  const ext = text(format.ext)?.toLocaleLowerCase();
  if (/\.m3u8(?:\?|$)/iu.test(url)) {
    return 'application/vnd.apple.mpegurl';
  }
  if (ext === 'm4a' || ext === 'mp4') {
    return 'audio/mp4';
  }
  if (ext === 'webm') {
    return 'audio/webm';
  }
  if (ext === 'opus') {
    return 'audio/ogg';
  }
  return 'audio/mpeg';
};

const bitrateFromFormat = (format: YtDlpFormat): number | null => {
  const kilobits = Number(format.abr ?? format.tbr);
  return Number.isFinite(kilobits) && kilobits > 0 ? Math.round(kilobits * 1000) : null;
};

const streamUrlExpiresAt = (url: string): string | null => {
  try {
    const params = new URL(url).searchParams;
    const expires = integer(params.get('expire')) ?? integer(params.get('expires')) ?? integer(params.get('e'));
    return expires ? new Date(expires * 1000).toISOString() : new Date(Date.now() + fallbackPlaybackTtlMs).toISOString();
  } catch {
    return new Date(Date.now() + fallbackPlaybackTtlMs).toISOString();
  }
};

export class YouTubeStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: 'YouTube',
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: false,
      supportsLyrics: false,
      supportsMv: true,
      requiresAccount: false,
      accountConnected: status.connected,
      accountDisplayName: status.displayName,
      accountUsername: status.username,
      accountAvatarUrl: status.avatarUrl,
      status: status.error ? 'error' : 'ready',
      statusMessage: status.connected
        ? 'YouTube uses your selected browser login through yt-dlp when needed. Playback is audio-only; MV opens as the YouTube video.'
        : 'Public YouTube search and audio-only playback are available. Select a browser in Settings for account-gated videos.',
    };
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? 20)));
    const mediaType = request.mediaTypes?.[0] ?? 'track';
    if (mediaType !== 'track' && mediaType !== 'mv') {
      return {
        provider,
        query: request.query,
        page,
        pageSize,
        total: 0,
        hasMore: false,
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        mvs: [],
      };
    }

    const requestedCount = Math.min(100, page * pageSize);
    const data = await ytDlpJson<unknown>([
      '--simulate',
      '--flat-playlist',
      '--playlist-end',
      String(requestedCount),
      `ytsearch${requestedCount}:${request.query}`,
    ], { useBrowserCookies: false });
    const allTracks = entriesFromSearch(data)
      .map(trackFromYtDlpEntry)
      .filter((track): track is StreamingTrack => Boolean(track));
    const offset = (page - 1) * pageSize;
    const tracks = allTracks.slice(offset, offset + pageSize);

    return {
      provider,
      query: request.query,
      page,
      pageSize,
      total: null,
      hasMore: allTracks.length >= requestedCount && tracks.length === pageSize,
      tracks: mediaType === 'track' ? tracks : [],
      albums: [],
      artists: [],
      playlists: [],
      mvs: mediaType === 'mv'
        ? tracks.map((track) => ({
            id: streamingStableKey(provider, `mv:${track.providerTrackId}`),
            provider,
            providerMvId: track.providerTrackId,
            providerTrackId: track.providerTrackId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnailUrl: track.coverThumb,
          }))
        : [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const data = await ytDlpJson<unknown>(['--no-playlist', '--skip-download', resolvedTrackUrl(input.providerTrackId)], { useBrowserCookies: false });
    const track = trackFromYtDlpEntry({ ...asRecord(data), id: youtubeVideoIdFromValue(input.providerTrackId) ?? asRecord(data).id });
    if (!track) {
      throw new Error('YouTube video is unavailable.');
    }

    return track;
  }

  async getMv(input: { providerTrackId: string }): Promise<StreamingMvResult> {
    const track = await this.getTrack(input);
    return {
      provider,
      providerTrackId: track.providerTrackId,
      status: 'available',
      items: [
        {
          id: streamingStableKey(provider, `mv:${track.providerTrackId}`),
          provider,
          providerMvId: track.providerTrackId,
          providerTrackId: track.providerTrackId,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          thumbnailUrl: track.coverThumb,
        },
      ],
    };
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
    const start = (page - 1) * pageSize + 1;
    const end = page * pageSize;
    const data = await ytDlpJson<unknown>([
      '--simulate',
      '--flat-playlist',
      '--playlist-start',
      String(start),
      '--playlist-end',
      String(end),
      youtubePlaylistUrl(input.providerPlaylistId),
    ]);
    const record = asRecord(data);
    const playlistId = text(record.id) ?? input.providerPlaylistId;
    const tracks = entriesFromSearch(data)
      .map(trackFromYtDlpEntry)
      .filter((track): track is StreamingTrack => Boolean(track));
    const total = integer(record.playlist_count) ?? integer(record.n_entries);

    return {
      id: streamingStableKey(provider, `playlist:${playlistId}`),
      provider,
      providerPlaylistId: playlistId,
      title: text(record.title) ?? 'YouTube Playlist',
      description: text(record.description),
      creator: text(record.channel) ?? text(record.uploader),
      coverUrl: tracks[0]?.coverUrl ?? null,
      coverThumb: tracks[0]?.coverThumb ?? null,
      trackCount: total,
      tracks,
      page,
      pageSize,
      total,
      hasMore: total ? start - 1 + tracks.length < total : tracks.length === pageSize,
    };
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const metadata = await ytDlpJson<unknown>(['--no-playlist', '-f', 'ba/bestaudio', resolvedTrackUrl(request.providerTrackId)]);
    const format = pickAudioFormat(metadata);
    const url = text(format?.url);
    if (!format || !url) {
      throw new Error('YouTube audio playback URL could not be resolved.');
    }

    const isM3u8 = /\.m3u8(?:\?|$)/iu.test(url);
    return {
      provider,
      providerTrackId: request.providerTrackId,
      url,
      expiresAt: streamUrlExpiresAt(url),
      mimeType: playbackMimeType(format, url),
      bitrate: bitrateFromFormat(format),
      sampleRate: integer(format.asr),
      bitDepth: null,
      codec: text(format.acodec),
      headers: headersFromFormat(format),
      requiresProxy: false,
      supportsRange: !isM3u8,
    };
  }
}
