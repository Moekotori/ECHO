import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import type {
  StreamingArtistRef,
  StreamingMediaType,
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
import { fetchWithNetworkProxy } from '../../network/networkFetch';
import type { StreamingProvider } from '../StreamingProvider';
import { streamingSearchQueryVariants } from '../StreamingSearchQueryVariants';
import { asRecord, integer, streamingImageProxyUrl, text } from './chinaStreamingUtils';

const provider = 'bilibili' as const;
const bilibiliReferer = 'https://www.bilibili.com/';
const bilibiliUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ytDlpFileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpTimeoutMs = 45_000;
const ytDlpMaxBuffer = 1024 * 1024 * 12;
const fallbackPlaybackTtlMs = 45 * 60 * 1000;

type BilibiliSearchEntry = {
  aid?: number | string;
  author?: string;
  bvid?: string;
  duration?: string | number;
  pic?: string;
  play?: string | number;
  pubdate?: string | number;
  title?: string;
  arcurl?: string;
};

type BilibiliSearchResponse = {
  code?: number;
  data?: {
    numResults?: number;
    result?: BilibiliSearchEntry[];
  };
};

type BilibiliFavoriteMedia = {
  bvid?: string;
  id?: number | string;
  title?: string;
  intro?: string;
  cover?: string;
  duration?: number | string;
  upper?: {
    mid?: number | string;
    name?: string;
  };
};

type BilibiliFavoriteListResponse = {
  code?: number;
  message?: string;
  data?: {
    info?: {
      title?: string;
      media_count?: number;
      upper?: {
        name?: string;
      };
    };
    medias?: BilibiliFavoriteMedia[];
    has_more?: boolean;
  };
};

type YtDlpFormat = Record<string, unknown>;
type BilibiliSearchPage = {
  tracks: StreamingTrack[];
  total: number | null;
  hasMore: boolean;
};

const accountCookie = (): string | undefined => getAccountService().getCredentials(provider).cookie?.trim() || undefined;

const accountStatus = () => getAccountService().getStatus(provider);

const toNetscapeCookieFile = (cookieHeader: string): string => {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    const name = rawName?.trim();
    const value = rawValueParts.join('=').trim();
    if (!name || !value) {
      continue;
    }

    lines.push(['.bilibili.com', 'TRUE', '/', 'TRUE', '0', name, value].join('\t'));
  }

  return `${lines.join('\n')}\n`;
};

const writeCookieFile = (): string | null => {
  const cookie = accountCookie();
  if (!cookie) {
    return null;
  }

  const cookieFilePath = join(tmpdir(), `echo-streaming-bilibili-${randomUUID()}.cookies.txt`);
  writeFileSync(cookieFilePath, toNetscapeCookieFile(cookie), 'utf8');
  return cookieFilePath;
};

const deleteTempFile = (filePath: string | null): void => {
  if (!filePath) {
    return;
  }

  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup for temporary cookie files.
  }
};

const bilibiliHeaders = (extra: Record<string, string> = {}, options: { includeCookie?: boolean } = {}): Record<string, string> => ({
  Accept: 'application/json,text/plain,*/*',
  Referer: bilibiliReferer,
  Origin: 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
  'User-Agent': bilibiliUserAgent,
  ...((options.includeCookie ?? true) && accountCookie() ? { Cookie: accountCookie() } : {}),
  ...extra,
});

const cleanHtml = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  return raw
    .replace(/<[^>]*>/gu, '')
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#(\d+);/gu, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .trim();
};

const bvidFromValue = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const direct = raw.match(/^BV[A-Za-z0-9]+$/u)?.[0];
  if (direct) {
    return direct;
  }

  try {
    const parsed = new URL(raw);
    return parsed.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/u)?.[1] ?? null;
  } catch {
    return raw.match(/BV[A-Za-z0-9]+/u)?.[0] ?? null;
  }
};

const normalizeBilibiliImageUrl = (value: unknown): string | null => {
  const rawUrl = text(value);
  const url = rawUrl?.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }

    return streamingImageProxyUrl(parsed.toString(), bilibiliReferer);
  } catch {
    return streamingImageProxyUrl(url, bilibiliReferer);
  }
};

const parseDuration = (value: unknown): number | null => {
  const numeric = integer(value);
  if (numeric) {
    return numeric;
  }

  const raw = text(value);
  if (!raw) {
    return null;
  }

  const parts = raw.split(':').map((part) => Number(part));
  if ((parts.length === 2 || parts.length === 3) && parts.every(Number.isFinite)) {
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  return null;
};

const artistRef = (name: string): StreamingArtistRef => ({
  id: streamingStableKey(provider, `artist:${name}`),
  provider,
  providerArtistId: name,
  name,
});

const trackFromSearchEntry = (entry: BilibiliSearchEntry): StreamingTrack | null => {
  const bvid = text(entry.bvid);
  const aid = integer(entry.aid);
  const providerTrackId = bvid ?? (aid ? `av${aid}` : null);
  const title = cleanHtml(entry.title);
  if (!providerTrackId || !title) {
    return null;
  }

  const artistName = cleanHtml(entry.author) ?? 'Bilibili';
  const artist = artistRef(artistName);
  const cover = normalizeBilibiliImageUrl(entry.pic);
  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist: artist.name,
    artists: [artist],
    album: 'Bilibili',
    albumId: null,
    albumArtist: artist.name,
    duration: parseDuration(entry.duration),
    coverUrl: cover,
    coverThumb: cover,
    qualities: ['standard', 'high'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'missing',
    mvStatus: 'available',
  };
};

const thumbnailFromYtDlpEntry = (entry: Record<string, unknown>): string | null => {
  const direct = text(entry.thumbnail);
  if (direct) {
    return direct;
  }

  if (!Array.isArray(entry.thumbnails)) {
    return null;
  }

  const thumbnails = entry.thumbnails
    .map(asRecord)
    .map((thumbnail) => text(thumbnail.url))
    .filter((url): url is string => Boolean(url));
  return thumbnails.at(-1) ?? null;
};

const trackFromYtDlpSearchEntry = (value: unknown): StreamingTrack | null => {
  const entry = asRecord(value);
  const providerTrackId = text(entry.id) ?? bvidFromValue(entry.webpage_url) ?? bvidFromValue(entry.url);
  const title = cleanHtml(entry.title);
  if (!providerTrackId || !title) {
    return null;
  }

  const artistName = cleanHtml(entry.uploader) ?? cleanHtml(entry.channel) ?? 'Bilibili';
  const artist = artistRef(artistName);
  const cover = normalizeBilibiliImageUrl(thumbnailFromYtDlpEntry(entry));
  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist: artist.name,
    artists: [artist],
    album: 'Bilibili',
    albumId: null,
    albumArtist: artist.name,
    duration: integer(entry.duration),
    coverUrl: cover,
    coverThumb: cover,
    qualities: ['standard', 'high'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'missing',
    mvStatus: 'available',
  };
};

const extractPiniaExpression = (html: string): string | null => {
  const marker = 'window.__pinia=';
  const start = html.indexOf(marker);
  if (start < 0) {
    return null;
  }

  const expressionStart = start + marker.length;
  const end = html.indexOf('</script>', expressionStart);
  if (end < 0) {
    return null;
  }

  const expression = html.slice(expressionStart, end).trim().replace(/;$/u, '');
  return expression || null;
};

const parseSearchPagePinia = (html: string): Record<string, unknown> | null => {
  const expression = extractPiniaExpression(html);
  if (!expression) {
    return null;
  }

  try {
    const sandbox = { window: {} as { __pinia?: unknown } };
    runInNewContext(`window.__pinia=${expression};`, sandbox, { timeout: 1000 });
    return asRecord(sandbox.window.__pinia) || null;
  } catch {
    return null;
  }
};

const findVideoGroupItems = (value: unknown): unknown[] => {
  const record = asRecord(value);
  const searchResponse = asRecord(record.searchResponse);
  const searchAllResponse = asRecord(searchResponse.searchAllResponse);
  const groups = Array.isArray(searchAllResponse.result) ? searchAllResponse.result.map(asRecord) : [];
  const videoGroup = groups.find((group) => group.result_type === 'video');
  return Array.isArray(videoGroup?.data) ? videoGroup.data : [];
};

const searchPageTotal = (value: unknown): number | null => {
  const record = asRecord(value);
  const searchResponse = asRecord(record.searchResponse);
  const searchAllResponse = asRecord(searchResponse.searchAllResponse);
  const pageinfo = asRecord(searchAllResponse.pageinfo);
  const videoInfo = asRecord(pageinfo.video);
  return integer(videoInfo.total) ?? integer(videoInfo.numResults) ?? integer(searchAllResponse.numResults);
};

const trackFromViewData = (value: unknown, fallbackProviderTrackId: string): StreamingTrack | null => {
  const data = asRecord(value);
  const owner = asRecord(data.owner);
  const bvid = text(data.bvid) ?? bvidFromValue(fallbackProviderTrackId) ?? fallbackProviderTrackId;
  const title = cleanHtml(data.title);
  if (!bvid || !title) {
    return null;
  }

  const artistName = cleanHtml(owner.name) ?? 'Bilibili';
  const artist = artistRef(artistName);
  const cover = normalizeBilibiliImageUrl(data.pic);
  return {
    id: streamingStableKey(provider, bvid),
    provider,
    providerTrackId: bvid,
    stableKey: streamingStableKey(provider, bvid),
    title,
    artist: artist.name,
    artists: [artist],
    album: 'Bilibili',
    albumId: null,
    albumArtist: artist.name,
    duration: integer(data.duration),
    coverUrl: cover,
    coverThumb: cover,
    qualities: ['standard', 'high'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'missing',
    mvStatus: 'available',
  };
};

const trackFromFavoriteMedia = (value: BilibiliFavoriteMedia): StreamingTrack | null => {
  const bvid = bvidFromValue(value.bvid) ?? bvidFromValue(value.id);
  const title = cleanHtml(value.title);
  if (!bvid || !title) {
    return null;
  }

  const upper = asRecord(value.upper);
  const artistName = cleanHtml(upper.name) ?? 'Bilibili';
  const artist = artistRef(artistName);
  const cover = normalizeBilibiliImageUrl(value.cover);
  return {
    id: streamingStableKey(provider, bvid),
    provider,
    providerTrackId: bvid,
    stableKey: streamingStableKey(provider, bvid),
    title,
    artist: artist.name,
    artists: [artist],
    album: 'Bilibili',
    albumId: null,
    albumArtist: artist.name,
    duration: parseDuration(value.duration),
    coverUrl: cover,
    coverThumb: cover,
    qualities: ['standard', 'high'],
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'missing',
    mvStatus: 'available',
  };
};

const bilibiliFavoriteIdFromValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get('fid') ?? parsed.searchParams.get('media_id') ?? parsed.searchParams.get('mediaId');
  } catch {
    return trimmed.match(/(?:fid|media_id|mediaId)=(\d+)/u)?.[1] ?? null;
  }
};

const fetchBilibiliFavoriteList = async (url: URL, referer: string, includeCookie: boolean): Promise<Response> => {
  const requestInit = {
    headers: bilibiliHeaders({ Referer: referer }, { includeCookie }),
  };

  try {
    return await fetch(url.toString(), requestInit);
  } catch {
    return fetchWithNetworkProxy(url.toString(), requestInit);
  }
};

const resolvedTrackUrl = (providerTrackId: string): string => {
  if (/^https?:\/\//iu.test(providerTrackId)) {
    return providerTrackId;
  }

  return `https://www.bilibili.com/video/${encodeURIComponent(providerTrackId)}`;
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

const runYtDlp = (args: string[]): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const cookieFilePath = writeCookieFile();
    execFile(
      resolveYtDlpPath(),
      ['--no-warnings', ...(cookieFilePath ? ['--cookies', cookieFilePath] : []), ...args],
      {
        encoding: 'utf8',
        maxBuffer: ytDlpMaxBuffer,
        timeout: ytDlpTimeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        deleteTempFile(cookieFilePath);
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`Bilibili extractor failed: ${detail}`));
          return;
        }

        resolveOutput(stdout.trim());
      },
    );
  });

const ytDlpJson = async <T>(args: string[]): Promise<T> => {
  const output = await runYtDlp(['--dump-single-json', ...args]);
  if (!output) {
    throw new Error('Bilibili extractor returned no metadata.');
  }

  return JSON.parse(output) as T;
};

const entriesFromYtDlpSearch = (value: unknown): unknown[] => {
  const record = asRecord(value);
  return Array.isArray(record.entries) ? record.entries : [];
};

const searchResultFromTracks = (
  request: StreamingSearchRequest,
  mediaType: StreamingMediaType,
  page: number,
  pageSize: number,
  searchPage: BilibiliSearchPage,
): StreamingSearchResult => ({
  provider,
  query: request.query,
  page,
  pageSize,
  total: searchPage.total,
  hasMore: searchPage.hasMore,
  tracks: mediaType === 'track' ? searchPage.tracks : [],
  albums: [],
  artists: [],
  playlists: [],
  mvs: mediaType === 'mv'
    ? searchPage.tracks.map((track) => ({
      id: `bilibili-mv:${track.providerTrackId}`,
      provider,
      providerMvId: track.providerTrackId,
      providerTrackId: track.providerTrackId,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      thumbnailUrl: track.coverThumb,
    }))
    : [],
});

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
    'User-Agent': bilibiliUserAgent,
    Accept: '*/*',
    Referer: bilibiliReferer,
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
  if (ext === 'flac') {
    return 'audio/flac';
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
    const expires = integer(params.get('deadline')) ?? integer(params.get('expires')) ?? integer(params.get('e'));
    return expires ? new Date(expires * 1000).toISOString() : new Date(Date.now() + fallbackPlaybackTtlMs).toISOString();
  } catch {
    return new Date(Date.now() + fallbackPlaybackTtlMs).toISOString();
  }
};

export class BilibiliStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: 'Bilibili',
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
        ? 'Bilibili uses your saved login cookie for account-gated playback quality when available.'
        : 'Public Bilibili video search and audio playback are available. Log in for account-gated quality.',
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

    const variants = page === 1 ? streamingSearchQueryVariants(request.query, 6) : [request.query];
    let fallbackResult: BilibiliSearchPage | null = null;

    for (const query of variants) {
      const variantRequest = query === request.query ? request : { ...request, query };
      const result = await this.searchBilibiliHttp(variantRequest, page, pageSize);
      fallbackResult ??= result;
      if (result.tracks.length > 0) {
        return searchResultFromTracks(request, mediaType, page, pageSize, result);
      }
    }

    const ytDlpResult = await this.searchBilibiliWithYtDlp(request, page, pageSize);
    if (ytDlpResult.tracks.length > 0 || !fallbackResult) {
      return searchResultFromTracks(request, mediaType, page, pageSize, ytDlpResult);
    }

    return searchResultFromTracks(request, mediaType, page, pageSize, fallbackResult);
  }

  private async searchBilibiliHttp(request: StreamingSearchRequest, page: number, pageSize: number): Promise<BilibiliSearchPage> {
    const apiResult = await this.searchBilibiliApi(request, page, pageSize);
    if (apiResult && apiResult.tracks.length > 0) {
      return apiResult;
    }

    const webpageResult = await this.searchBilibiliWebpage(request, page, pageSize);
    if (webpageResult.tracks.length > 0) {
      return webpageResult;
    }

    return apiResult ?? webpageResult;
  }

  private async searchBilibiliApi(request: StreamingSearchRequest, page: number, pageSize: number): Promise<BilibiliSearchPage | null> {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', request.query);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));

    try {
      const response = await fetchWithNetworkProxy(url.toString(), {
        headers: bilibiliHeaders({ Referer: `https://search.bilibili.com/video?keyword=${encodeURIComponent(request.query)}` }),
      });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as BilibiliSearchResponse;
      if (payload.code !== 0 || !Array.isArray(payload.data?.result)) {
        return null;
      }

      const tracks = payload.data.result
        .map(trackFromSearchEntry)
        .filter((track): track is StreamingTrack => Boolean(track));
      return {
        tracks,
        total: integer(payload.data.numResults),
        hasMore: tracks.length === pageSize,
      };
    } catch {
      return null;
    }
  }

  private async searchBilibiliWebpage(request: StreamingSearchRequest, page: number, pageSize: number): Promise<BilibiliSearchPage> {
    try {
      const url = new URL('https://search.bilibili.com/video');
      url.searchParams.set('keyword', request.query);
      url.searchParams.set('page', String(page));

      const response = await fetchWithNetworkProxy(url.toString(), {
        headers: {
          ...bilibiliHeaders({ Referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(request.query)}` }),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!response.ok) {
        return { tracks: [], total: null, hasMore: false };
      }

      const html = await response.text();
      const pinia = parseSearchPagePinia(html);
      const tracks = findVideoGroupItems(pinia)
        .map((entry) => trackFromSearchEntry(entry as BilibiliSearchEntry))
        .filter((track): track is StreamingTrack => Boolean(track))
        .slice(0, pageSize);
      const total = searchPageTotal(pinia);
      return {
        tracks,
        total,
        hasMore: total ? page * pageSize < total : tracks.length === pageSize,
      };
    } catch {
      return { tracks: [], total: null, hasMore: false };
    }
  }

  private async searchBilibiliWithYtDlp(request: StreamingSearchRequest, page: number, pageSize: number): Promise<BilibiliSearchPage> {
    try {
      const requestedCount = Math.min(100, page * pageSize);
      const data = await ytDlpJson<unknown>([
        '--simulate',
        '--flat-playlist',
        '--playlist-end',
        String(requestedCount),
        `bilisearch${requestedCount}:${request.query}`,
      ]);
      const allTracks = entriesFromYtDlpSearch(data)
        .map(trackFromYtDlpSearchEntry)
        .filter((track): track is StreamingTrack => Boolean(track));
      const offset = (page - 1) * pageSize;
      const tracks = allTracks.slice(offset, offset + pageSize);
      return {
        tracks,
        total: null,
        hasMore: allTracks.length >= requestedCount && tracks.length === pageSize,
      };
    } catch {
      return { tracks: [], total: null, hasMore: false };
    }
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const mediaId = bilibiliFavoriteIdFromValue(input.providerPlaylistId);
    if (!mediaId) {
      throw new Error('Bilibili favorite URL is missing fid.');
    }

    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(20, Math.max(1, Math.floor(input.pageSize ?? 20)));
    const url = new URL('https://api.bilibili.com/x/v3/fav/resource/list');
    url.searchParams.set('media_id', mediaId);
    url.searchParams.set('pn', String(page));
    url.searchParams.set('ps', String(pageSize));
    url.searchParams.set('keyword', '');
    url.searchParams.set('order', 'mtime');
    url.searchParams.set('type', '0');
    url.searchParams.set('tid', '0');
    url.searchParams.set('platform', 'web');

    const referer = input.providerPlaylistId.startsWith('http') ? input.providerPlaylistId : bilibiliReferer;
    let response = await fetchBilibiliFavoriteList(url, referer, true);
    if (!response.ok) {
      throw new Error(`Bilibili favorite import failed: HTTP ${response.status}`);
    }

    let payload = (await response.json()) as BilibiliFavoriteListResponse;
    if (payload.code !== 0 && accountCookie()) {
      response = await fetchBilibiliFavoriteList(url, referer, false);
      if (!response.ok) {
        throw new Error(`Bilibili favorite import failed: HTTP ${response.status}`);
      }
      payload = (await response.json()) as BilibiliFavoriteListResponse;
    }

    if (payload.code !== 0) {
      const message = text(payload.message) ?? `code ${payload.code}`;
      throw new Error(`Bilibili favorite import failed: ${message}`);
    }

    const info = payload.data?.info;
    const medias = Array.isArray(payload.data?.medias) ? payload.data.medias : [];
    const tracks = medias.map(trackFromFavoriteMedia).filter((track): track is StreamingTrack => Boolean(track));
    const total = integer(info?.media_count);
    return {
      id: streamingStableKey(provider, `playlist:${mediaId}`),
      provider,
      providerPlaylistId: mediaId,
      title: cleanHtml(info?.title) ?? 'Bilibili Favorites',
      description: null,
      creator: cleanHtml(info?.upper?.name),
      coverUrl: tracks[0]?.coverUrl ?? null,
      coverThumb: tracks[0]?.coverThumb ?? null,
      trackCount: total,
      tracks,
      page,
      pageSize,
      total,
      hasMore: payload.data?.has_more === true || (total ? page * pageSize < total : tracks.length === pageSize),
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const bvid = bvidFromValue(input.providerTrackId) ?? input.providerTrackId;
    const url = new URL('https://api.bilibili.com/x/web-interface/view');
    if (bvid.startsWith('av')) {
      url.searchParams.set('aid', bvid.slice(2));
    } else {
      url.searchParams.set('bvid', bvid);
    }

    const response = await fetchWithNetworkProxy(url.toString(), {
      headers: bilibiliHeaders({ Referer: resolvedTrackUrl(bvid) }),
    });
    if (!response.ok) {
      throw new Error(`Bilibili track lookup failed: HTTP ${response.status}`);
    }

    const payload = asRecord(await response.json());
    const track = trackFromViewData(payload.data, bvid);
    if (!track) {
      throw new Error('Bilibili video is unavailable.');
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
          id: `bilibili-mv:${track.providerTrackId}`,
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

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const metadata = await ytDlpJson<unknown>(['--no-playlist', '-f', 'ba/bestaudio', resolvedTrackUrl(request.providerTrackId)]);
    const format = pickAudioFormat(metadata);
    const url = text(format?.url);
    if (!format || !url) {
      throw new Error('Bilibili audio playback URL could not be resolved.');
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
