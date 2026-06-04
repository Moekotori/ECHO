import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  StreamingArtistRef,
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
import { asRecord, integer, streamingImageProxyUrl, text } from './chinaStreamingUtils';

const provider = 'soundcloud' as const;
const soundCloudReferer = 'https://soundcloud.com/';
const soundCloudUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const soundCloudPlaybackHeaders: Record<string, string> = {
  'User-Agent': soundCloudUserAgent,
  Accept: '*/*',
  Referer: soundCloudReferer,
};
const ytDlpFileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpTimeoutMs = 45_000;
const ytDlpMaxBuffer = 1024 * 1024 * 12;

type YtDlpEntry = Record<string, unknown>;
type YtDlpFormat = Record<string, unknown>;

const accountCookie = (): string | undefined => getAccountService().getCredentials(provider).cookie?.trim() || undefined;

const accountStatus = () => getAccountService().getStatus(provider);

const requireCookie = (): string => {
  const cookie = accountCookie();
  if (!cookie) {
    throw new Error('Please log in to SoundCloud in Settings first. ECHO uses that saved login cookie for SoundCloud search and playback.');
  }

  return cookie;
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

const runYtDlp = (args: string[], cookie: string): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    execFile(
      resolveYtDlpPath(),
      ['--no-warnings', '--add-header', `Cookie:${cookie}`, ...args],
      {
        encoding: 'utf8',
        maxBuffer: ytDlpMaxBuffer,
        timeout: ytDlpTimeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`SoundCloud extractor failed: ${detail}`));
          return;
        }

        resolveOutput(stdout.trim());
      },
    );
  });

const ytDlpJson = async <T>(args: string[], cookie: string): Promise<T> => {
  const output = await runYtDlp(['--dump-single-json', ...args], cookie);
  if (!output) {
    throw new Error('SoundCloud extractor returned no metadata.');
  }

  return JSON.parse(output) as T;
};

const bestThumbnail = (value: unknown, preferSmall = false): string | null => {
  const thumbnails = Array.isArray(value) ? value.map(asRecord) : [];
  if (thumbnails.length === 0) {
    return null;
  }

  const sorted = [...thumbnails].sort((left, right) => {
    const leftWidth = Number(left.width ?? 0);
    const rightWidth = Number(right.width ?? 0);
    return preferSmall ? leftWidth - rightWidth : rightWidth - leftWidth;
  });
  const imageUrl = text(sorted[0]?.url)?.replace(/^http:\/\//iu, 'https://') ?? null;
  return imageUrl ? streamingImageProxyUrl(imageUrl, soundCloudReferer) : null;
};

const formatsFromMetadata = (value: unknown): YtDlpFormat[] => {
  const record = asRecord(value);
  const requestedDownloads = Array.isArray(record.requested_downloads) ? record.requested_downloads.map(asRecord) : [];
  const formats = Array.isArray(record.formats) ? record.formats.map(asRecord) : [];
  return [...requestedDownloads, ...formats];
};

const pickPlaybackFormat = (value: unknown): YtDlpFormat | null => {
  const formats = formatsFromMetadata(value).filter((format) => Boolean(text(format.url)));
  const directAudioFormats = formats.filter((format) => {
    const protocol = text(format.protocol);
    const acodec = text(format.acodec);
    return /^https?$/iu.test(protocol ?? '') && acodec !== 'none';
  });

  return (
    directAudioFormats.find((format) => /http_mp3/iu.test(text(format.format_id) ?? '')) ??
    directAudioFormats.find((format) => !/\.m3u8(?:\?|$)/iu.test(text(format.url) ?? '')) ??
    formats.find((format) => !/\.m3u8(?:\?|$)/iu.test(text(format.url) ?? '')) ??
    formats[0] ??
    null
  );
};

const headersFromFormat = (format: YtDlpFormat): Record<string, string> => {
  const headers = asRecord(format.http_headers);
  return {
    ...soundCloudPlaybackHeaders,
    ...Object.fromEntries(
      Object.entries(headers).filter(
        ([key, value]) => typeof value === 'string' && !/authorization|cookie/iu.test(key),
      ),
    ),
  } as Record<string, string>;
};

const playbackMimeType = (format: YtDlpFormat, url: string): string => {
  const ext = text(format.ext);
  if (/\.m3u8(?:\?|$)/iu.test(url)) {
    return 'application/vnd.apple.mpegurl';
  }
  if (ext === 'm4a' || ext === 'mp4') {
    return 'audio/mp4';
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

const artistRef = (entry: YtDlpEntry): StreamingArtistRef => {
  const uploaderId = String(entry.uploader_id ?? text(entry.uploader_url) ?? text(entry.uploader) ?? 'soundcloud').trim();
  const name = text(entry.uploader) ?? (Array.isArray(entry.artists) ? text(entry.artists[0]) : null) ?? 'SoundCloud';
  return {
    id: streamingStableKey(provider, `artist:${uploaderId}`),
    provider,
    providerArtistId: uploaderId,
    name,
  };
};

const providerTrackIdFromEntry = (entry: YtDlpEntry): string => {
  const extractorUrl = text(entry.url);
  const webpageUrl = text(entry.webpage_url);
  const id = text(entry.id);
  return extractorUrl ?? webpageUrl ?? id ?? '';
};

const trackFromYtDlpEntry = (value: unknown): StreamingTrack | null => {
  const entry = asRecord(value);
  const providerTrackId = providerTrackIdFromEntry(entry);
  const title = text(entry.title) ?? text(entry.track);
  if (!providerTrackId || !title) {
    return null;
  }

  const artist = artistRef(entry);
  const genres = Array.isArray(entry.genres) ? entry.genres.map(text).filter(Boolean) : [];
  const duration = Number(entry.duration);

  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist: artist.name,
    artists: [artist],
    album: genres[0] ?? 'SoundCloud',
    albumId: null,
    albumArtist: artist.name,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    coverUrl: bestThumbnail(entry.thumbnails),
    coverThumb: bestThumbnail(entry.thumbnails, true),
    qualities: ['standard'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'missing',
    mvStatus: 'missing',
  };
};

const entriesFromSearch = (value: unknown): unknown[] => {
  const record = asRecord(value);
  return Array.isArray(record.entries) ? record.entries : [];
};

const resolvedTrackUrl = (providerTrackId: string): string => {
  if (/^https?:\/\//iu.test(providerTrackId)) {
    return providerTrackId;
  }

  return `https://api.soundcloud.com/tracks/${encodeURIComponent(providerTrackId)}`;
};

const resolvedPlaylistUrl = (providerPlaylistId: string): string => providerPlaylistId;

const streamUrlExpiresAt = (url: string): string | null => {
  try {
    const expires = integer(new URL(url).searchParams.get('expires'));
    return expires ? new Date(expires * 1000).toISOString() : new Date(Date.now() + 5 * 60 * 1000).toISOString();
  } catch {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
};

export class SoundCloudStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: 'SoundCloud',
      enabled: status.connected,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: true,
      supportsLyrics: false,
      supportsMv: false,
      requiresAccount: true,
      accountConnected: status.connected,
      accountDisplayName: status.displayName,
      accountUsername: status.username,
      accountAvatarUrl: status.avatarUrl,
      status: status.connected ? (status.error ? 'error' : 'ready') : 'needs_account',
      statusMessage: status.connected
        ? 'SoundCloud uses your saved login cookie through yt-dlp. No developer API credentials are required.'
        : 'Log in to SoundCloud in Settings before using SoundCloud streaming.',
    };
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const cookie = requireCookie();
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? 20)));
    const mediaType = request.mediaTypes?.[0] ?? 'track';
    if (mediaType !== 'track') {
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
    const data = await ytDlpJson<unknown>(['--flat-playlist', `scsearch${requestedCount}:${request.query}`], cookie);
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
      tracks,
      albums: [],
      artists: [],
      playlists: [],
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const cookie = requireCookie();
    const data = await ytDlpJson<unknown>(['--no-playlist', resolvedTrackUrl(input.providerTrackId)], cookie);
    const track = trackFromYtDlpEntry({ ...asRecord(data), url: input.providerTrackId });
    if (!track) {
      throw new Error('SoundCloud track is unavailable.');
    }

    return track;
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const cookie = requireCookie();
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
    const start = (page - 1) * pageSize + 1;
    const end = page * pageSize;
    const data = await ytDlpJson<unknown>(
      [
        '--flat-playlist',
        '--playlist-start',
        String(start),
        '--playlist-end',
        String(end),
        resolvedPlaylistUrl(input.providerPlaylistId),
      ],
      cookie,
    );
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
      title: text(record.title) ?? 'SoundCloud Playlist',
      description: text(record.description),
      creator: text(record.uploader),
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
    const cookie = requireCookie();
    const metadata = await ytDlpJson<unknown>(
      ['--no-playlist', '-f', 'http_mp3_0_1/http_mp3_1_0/http_mp3_0_0/bestaudio/best', resolvedTrackUrl(request.providerTrackId)],
      cookie,
    );
    const format = pickPlaybackFormat(metadata);
    const url = text(format?.url);
    if (!url) {
      throw new Error('SoundCloud playback URL could not be resolved.');
    }

    const isM3u8 = /\.m3u8(?:\?|$)/iu.test(url);
    const codec = text(format?.acodec) ?? (isM3u8 ? 'aac' : 'mp3');
    return {
      provider,
      providerTrackId: request.providerTrackId,
      url,
      expiresAt: streamUrlExpiresAt(url),
      mimeType: playbackMimeType(format ?? {}, url),
      bitrate: format ? bitrateFromFormat(format) : null,
      sampleRate: null,
      bitDepth: null,
      codec,
      headers: format ? headersFromFormat(format) : {},
      requiresProxy: false,
      supportsRange: !isM3u8,
    };
  }
}
