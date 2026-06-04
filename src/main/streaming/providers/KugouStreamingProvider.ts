import { createHash } from 'node:crypto';
import type { AccountStatus } from '../../../shared/types/accounts';
import type { LyricsQuery } from '../../../shared/types/lyrics';
import type {
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingArtistRef,
  StreamingAudioQuality,
  StreamingLyricsResult,
  StreamingMvItem,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylist,
  StreamingPlaylistDetail,
  StreamingProviderDescriptor,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import { getAccountService } from '../../accounts/AccountService';
import { KugouLyricsProvider } from '../../lyrics/KugouLyricsProvider';
import { buildNormalizedLyricsQuery } from '../../lyrics/lyricsQueryBuilder';
import type { StreamingProvider } from '../StreamingProvider';
import { streamingSearchQueryVariants } from '../StreamingSearchQueryVariants';
import { asRecord, integer, jsonFetch, linesFromLyrics, number, splitLyricsByKind, streamingImageProxyUrl, text } from './chinaStreamingUtils';

const provider = 'kugou' as const;
const kugouReferer = 'https://www.kugou.com/';
const kugouApiBase = 'https://mobiles.kugou.com/api/v3';
const kugouPlaybackBase = 'https://gateway.kugou.com/v5/url';
const kugouSearchTimeoutMs = 6500;
const kugouPlaybackTimeoutMs = 4500;
const kugouAppId = 1005;
const kugouClientVersion = 11430;
const kugouAndroidSecret = 'OIlwieks28dk2k092lksi2UIkp';
const kugouPlaybackKeySecret = '57ae12eb6890223e355ccfcb74edf70d';
const kugouPlaybackUserAgent = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';

export type KugouTrackKey = {
  hash: string;
  albumId: string | null;
  albumAudioId: string | null;
};

type KugouPlaybackQuality = 'flac' | '320' | '128';

const playbackFallbacks: Record<StreamingAudioQuality | 'fallback', KugouPlaybackQuality[]> = {
  hires: ['flac', '320', '128'],
  lossless: ['flac', '320', '128'],
  high: ['320', '128'],
  standard: ['128'],
  fallback: ['flac', '320', '128'],
};

const kugouHeaders = (cookie?: string): Record<string, string> => ({
  Referer: kugouReferer,
  Origin: 'https://www.kugou.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ...(cookie ? { Cookie: cookie } : {}),
});

const accountStatus = (): AccountStatus => getAccountService().getStatus(provider);

const accountCookie = (): string | undefined => getAccountService().getCredentials(provider).cookie?.trim() || undefined;

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

const cleanText = (value: unknown): string | null => text(value)?.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim() || null;

const idText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return cleanText(value);
};

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const firstIdText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = idText(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const cookieValue = (cookie: string | undefined, ...names: string[]): string | null => {
  if (!cookie) {
    return null;
  }

  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'iu'));
    if (!match) {
      continue;
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
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

const normalizeImageUrl = (value: unknown, size: number): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  return raw.replace(/\{size\}/gu, String(size)).replace(/^http:\/\//iu, 'https://');
};

const kugouImageUrl = (value: unknown, size = 400): string | null => streamingImageProxyUrl(normalizeImageUrl(value, size), kugouReferer);

const titleAndArtistFromFilename = (filename: string | null): { title: string | null; artist: string | null } => {
  if (!filename) {
    return { title: null, artist: null };
  }

  const parts = filename.split(/\s+-\s+/u);
  if (parts.length < 2) {
    return { title: filename, artist: null };
  }

  return {
    artist: parts[0]?.trim() || null,
    title: parts.slice(1).join(' - ').trim() || null,
  };
};

export const encodeKugouProviderTrackId = (key: KugouTrackKey): string => {
  const hash = key.hash.trim().toLocaleLowerCase();
  const albumId = key.albumId?.trim() || '0';
  const albumAudioId = key.albumAudioId?.trim() || '0';
  return `${hash}.${albumId}.${albumAudioId}`;
};

export const parseKugouProviderTrackId = (value: string): KugouTrackKey | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const [hashPart, albumIdPart, albumAudioIdPart] = trimmed.split('.');
  const hash = (hashPart ?? trimmed).trim().toLocaleLowerCase();
  if (!/^[a-f0-9]{16,64}$/iu.test(hash)) {
    return null;
  }

  return {
    hash,
    albumId: albumIdPart && albumIdPart !== '0' ? albumIdPart : null,
    albumAudioId: albumAudioIdPart && albumAudioIdPart !== '0' ? albumAudioIdPart : null,
  };
};

const artistRefsFromSong = (song: Record<string, unknown>, fallbackArtist: string): StreamingArtistRef[] => {
  const artistId = firstIdText(song, ['singerid', 'SingerId', 'singer_id', 'author_id', 'authorId']);
  const names = fallbackArtist
    .split(/\s*(?:\/|、|,|，|&)\s*/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 5);

  return (names.length ? names : [fallbackArtist]).map((name, index) => {
    const providerArtistId = index === 0 ? artistId ?? name : name;
    return {
      id: streamingStableKey(provider, `artist:${providerArtistId}`),
      provider,
      providerArtistId,
      name,
    };
  });
};

const qualitiesFromSong = (song: Record<string, unknown>): StreamingAudioQuality[] => {
  const qualities: StreamingAudioQuality[] = [];
  if (firstText(song, ['SQFileHash', 'sqhash', 'ResFileHash']) || number(song.SQFileSize) || number(song.resFileSize)) {
    qualities.push('lossless');
  }
  if (firstText(song, ['HQFileHash', 'hqhash']) || number(song.HQFileSize)) {
    qualities.push('high');
  }
  qualities.push('standard');
  return [...new Set(qualities)];
};

const mvStatusFromSong = (song: Record<string, unknown>): StreamingTrack['mvStatus'] => {
  if (firstText(song, ['mvhash', 'mv_hash', 'mvHash'])) {
    return 'available';
  }

  const mvdata = song.mvdata;
  if (Array.isArray(mvdata) && mvdata.length > 0) {
    return 'available';
  }
  if (Object.keys(asRecord(mvdata)).length > 0) {
    return 'available';
  }

  return 'unknown';
};

const mapSong = (value: unknown, fallback: Partial<KugouTrackKey> = {}): StreamingTrack | null => {
  const song = asRecord(value);
  const filename = firstText(song, ['FileName', 'filename', 'filename_hilight']);
  const filenameParts = titleAndArtistFromFilename(filename);
  const hash = (firstText(song, ['hash', 'Hash', 'FileHash', 'file_hash']) ?? fallback.hash ?? '').toLocaleLowerCase();
  if (!hash) {
    return null;
  }

  const albumId = firstIdText(song, ['album_id', 'albumid', 'albumId', 'AlbumId', 'AlbumID']) ?? fallback.albumId ?? null;
  const albumAudioId =
    firstIdText(song, ['album_audio_id', 'albumAudioId', 'audio_id', 'audioid', 'mixsongid', 'mixsong_id']) ?? fallback.albumAudioId ?? null;
  const providerTrackId = encodeKugouProviderTrackId({ hash, albumId, albumAudioId });
  const title = firstText(song, ['songname', 'SongName', 'song_name', 'name', 'title']) ?? filenameParts.title ?? hash;
  const artist = firstText(song, ['singername', 'SingerName', 'singer_name', 'author_name', 'artist']) ?? filenameParts.artist ?? 'Unknown Artist';
  const album = firstText(song, ['AlbumName', 'album_name', 'albumname', 'albumName']) ?? 'Unknown Album';
  const cover = kugouImageUrl(song.imgurl ?? song.image ?? song.cover ?? song.album_img, 400);

  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist,
    artists: artistRefsFromSong(song, artist),
    album,
    albumId,
    albumArtist: artist,
    duration: secondsFromDuration(song.duration ?? song.Duration ?? song.time_length ?? song.timelength),
    coverUrl: cover,
    coverThumb: cover ?? kugouImageUrl(song.imgurl ?? song.image ?? song.cover ?? song.album_img, 150),
    qualities: qualitiesFromSong(song),
    explicit: false,
    playable: true,
    unavailableReason: null,
    lyricsStatus: 'available',
    mvStatus: mvStatusFromSong(song),
  };
};

const mapAlbum = (value: unknown, fallback: { providerAlbumId?: string; title?: string; artist?: string; coverUrl?: string | null } = {}): StreamingAlbum => {
  const album = asRecord(value);
  const providerAlbumId = firstIdText(album, ['albumid', 'album_id', 'albumId', 'AlbumId', 'id']) ?? fallback.providerAlbumId ?? '';
  const artist = firstText(album, ['singername', 'SingerName', 'author_name', 'artist']) ?? fallback.artist ?? 'Unknown Artist';
  const cover = kugouImageUrl(album.imgurl ?? album.image ?? album.cover, 400) ?? fallback.coverUrl ?? null;
  const artistRef: StreamingArtistRef = {
    id: streamingStableKey(provider, `artist:${firstIdText(album, ['singerid', 'singer_id', 'author_id']) ?? artist}`),
    provider,
    providerArtistId: firstIdText(album, ['singerid', 'singer_id', 'author_id']) ?? artist,
    name: artist,
  };

  return {
    id: streamingStableKey(provider, `album:${providerAlbumId}`),
    provider,
    providerAlbumId,
    title: firstText(album, ['albumname', 'album_name', 'albumName', 'name', 'title']) ?? fallback.title ?? `KuGou Album ${providerAlbumId}`,
    artist,
    artists: [artistRef],
    coverUrl: cover,
    coverThumb: cover ?? kugouImageUrl(album.imgurl ?? album.image ?? album.cover, 150),
    releaseDate: firstText(album, ['publishtime', 'publish_time', 'publicTime', 'releaseDate']),
    trackCount: integer(album.songcount ?? album.song_count ?? album.count),
  };
};

const mapArtist = (value: unknown, fallbackId?: string): StreamingArtist => {
  const artist = asRecord(value);
  const providerArtistId = firstIdText(artist, ['singerid', 'singer_id', 'author_id', 'id']) ?? fallbackId ?? firstText(artist, ['singername']) ?? '';
  const avatar = kugouImageUrl(artist.imgurl ?? artist.image ?? artist.avatar ?? artist.pic, 400);

  return {
    id: streamingStableKey(provider, `artist:${providerArtistId}`),
    provider,
    providerArtistId,
    name: firstText(artist, ['singername', 'singer_name', 'author_name', 'name']) ?? providerArtistId,
    avatarUrl: avatar,
    coverUrl: avatar,
  };
};

const mapPlaylist = (value: unknown, fallbackId?: string): StreamingPlaylist => {
  const playlist = asRecord(value);
  const providerPlaylistId = firstIdText(playlist, ['specialid', 'special_id', 'id', 'global_collection_id']) ?? fallbackId ?? '';
  const cover = kugouImageUrl(playlist.imgurl ?? playlist.image ?? playlist.cover, 400);

  return {
    id: streamingStableKey(provider, `playlist:${providerPlaylistId}`),
    provider,
    providerPlaylistId,
    title: firstText(playlist, ['specialname', 'special_name', 'name', 'title']) ?? `KuGou Playlist ${providerPlaylistId}`,
    description: firstText(playlist, ['intro', 'specialdesc', 'description']),
    creator: firstText(playlist, ['nickname', 'username', 'singername']),
    coverUrl: cover,
    coverThumb: cover ?? kugouImageUrl(playlist.imgurl ?? playlist.image ?? playlist.cover, 150),
    trackCount: integer(playlist.songcount ?? playlist.song_count ?? playlist.count ?? playlist.total),
  };
};

const arrayInfo = (data: unknown): unknown[] => {
  const root = asRecord(data);
  const body = asRecord(root.data);
  if (Array.isArray(body.info)) {
    return body.info;
  }
  if (Array.isArray(root.info)) {
    return root.info;
  }
  if (Array.isArray(body.list)) {
    return body.list;
  }
  if (Array.isArray(root.list)) {
    return root.list;
  }

  return [];
};

const totalFromData = (data: unknown): number | null => {
  const root = asRecord(data);
  const body = asRecord(root.data);
  return integer(body.total ?? body.totalnum ?? body.count ?? root.total ?? root.totalnum);
};

const mapSongs = (values: unknown[], fallback: Partial<KugouTrackKey> = {}): StreamingTrack[] =>
  values.map((value) => mapSong(value, fallback)).filter((track): track is StreamingTrack => Boolean(track));

const albumsFromTracks = (tracks: StreamingTrack[]): StreamingAlbum[] => {
  const seen = new Set<string>();
  const albums: StreamingAlbum[] = [];
  for (const track of tracks) {
    if (!track.albumId || seen.has(track.albumId)) {
      continue;
    }

    seen.add(track.albumId);
    albums.push({
      id: streamingStableKey(provider, `album:${track.albumId}`),
      provider,
      providerAlbumId: track.albumId,
      title: track.album,
      artist: track.albumArtist ?? track.artist,
      artists: track.artists,
      coverUrl: track.coverUrl,
      coverThumb: track.coverThumb,
      releaseDate: null,
      trackCount: null,
    });
  }

  return albums;
};

const fetchKugouJson = (path: string, params: URLSearchParams, timeoutMs = kugouSearchTimeoutMs): Promise<unknown> =>
  jsonFetch(`${kugouApiBase}/${path}?${params.toString()}`, {
    headers: kugouHeaders(accountCookie()),
    timeoutMs,
  });

const searchEndpoint = (mediaType: NonNullable<StreamingSearchRequest['mediaTypes']>[number]): string | null => {
  switch (mediaType) {
    case 'track':
      return 'search/song';
    case 'album':
      return 'search/album';
    case 'artist':
      return 'search/singer';
    case 'playlist':
      return 'search/special';
    default:
      return null;
  }
};

const signatureAndroidParams = (params: Record<string, string | number>): string => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  return md5(`${kugouAndroidSecret}${paramsString}${kugouAndroidSecret}`);
};

const signPlaybackKey = (hash: string, mid: string, userid: string | null, appid: number): string =>
  md5(`${hash}${kugouPlaybackKeySecret}${appid}${mid}${userid ?? 0}`);

const stableNumericId = (value: string): string => {
  const digits = md5(value).replace(/\D/gu, '');
  return (digits || '0').padEnd(32, '0').slice(0, 32);
};

const randomKugouString = (length: number): string => {
  const alphabet = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
};

const buildPlaybackParams = (
  trackKey: KugouTrackKey,
  quality: KugouPlaybackQuality,
  cookie: string | undefined,
): { params: Record<string, string | number>; headers: Record<string, string> } => {
  const dfid = cookieValue(cookie, 'dfid', 'kg_dfid', 'DFID') ?? randomKugouString(24);
  const mid = cookieValue(cookie, 'KUGOU_API_MID', 'kg_mid', 'mid') ?? stableNumericId(dfid);
  const userid = cookieValue(cookie, 'userid', 'KugooID', 'KugouID', 'kg_uid');
  const clienttime = Math.floor(Date.now() / 1000);
  const params: Record<string, string | number> = {
    dfid,
    mid,
    uuid: '-',
    appid: kugouAppId,
    clientver: kugouClientVersion,
    clienttime,
    album_id: Number(trackKey.albumId ?? 0),
    area_code: 1,
    hash: trackKey.hash.toLocaleLowerCase(),
    ssa_flag: 'is_fromtrack',
    version: 11430,
    page_id: 151369488,
    quality,
    album_audio_id: Number(trackKey.albumAudioId ?? 0),
    behavior: 'play',
    pid: 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: 0,
    ppage_id: '463467626,350369493,788954147',
    cdnBackup: 1,
    module: '',
  };
  if (userid && userid !== '0') {
    params.userid = userid;
  }
  params.key = signPlaybackKey(String(params.hash), String(params.mid), userid, kugouAppId);
  params.signature = signatureAndroidParams(params);

  return {
    params,
    headers: {
      ...kugouHeaders(cookie),
      'User-Agent': kugouPlaybackUserAgent,
      'x-router': 'trackercdn.kugou.com',
      dfid,
      mid,
      clienttime: String(clienttime),
    },
  };
};

const collectUrls = (value: unknown, depth = 0): string[] => {
  if (depth > 5 || value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    return /^https?:\/\//iu.test(value.trim()) ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectUrls(item, depth + 1));
  }
  if (typeof value !== 'object') {
    return [];
  }

  const record = asRecord(value);
  const prioritizedKeys = ['url', 'play_url', 'playUrl', 'backup_url', 'backupUrl', 'urls', 'data', 'info'];
  return prioritizedKeys.flatMap((key) => collectUrls(record[key], depth + 1));
};

const playbackErrorMessage = (value: unknown): string | null => {
  const record = asRecord(value);
  const data = asRecord(record.data);
  const message = cleanText(record.error) ?? cleanText(record.msg) ?? cleanText(record.message) ?? cleanText(data.error) ?? cleanText(data.msg) ?? cleanText(data.message);
  if (message) {
    return message;
  }

  const errcode = idText(record.errcode ?? record.error_code ?? data.errcode ?? data.error_code);
  if (errcode) {
    return `KuGou Music did not return a playable URL (${errcode}).`;
  }

  return null;
};

const sourceFromPlaybackResponse = (
  request: StreamingPlaybackRequest,
  quality: KugouPlaybackQuality,
  response: unknown,
  cookie: string | undefined,
): StreamingPlaybackSource | null => {
  const [url] = [...new Set(collectUrls(response))];
  if (!url) {
    return null;
  }

  const codec = quality === 'flac' || /\.flac(?:[?#]|$)/iu.test(url) ? 'flac' : 'mp3';
  const bitrate = quality === 'flac' ? 999000 : quality === '320' ? 320000 : 128000;

  return {
    provider,
    providerTrackId: request.providerTrackId,
    url,
    expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
    mimeType: codec === 'flac' ? 'audio/flac' : 'audio/mpeg',
    bitrate,
    sampleRate: null,
    bitDepth: null,
    codec,
    headers: kugouHeaders(cookie),
    requiresProxy: false,
    supportsRange: true,
  };
};

export const resolveKugouPlaybackUrl = async (request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> => {
  const trackKey = parseKugouProviderTrackId(request.providerTrackId);
  if (!trackKey) {
    throw new Error('Invalid KuGou Music track id.');
  }

  const cookie = accountCookie();
  const qualities = playbackFallbacks[request.quality ?? 'fallback'] ?? playbackFallbacks.fallback;
  let lastResponse: unknown = null;

  for (const quality of qualities) {
    const { params, headers } = buildPlaybackParams(trackKey, quality, cookie);
    const response = await jsonFetch(`${kugouPlaybackBase}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`, {
      headers,
      timeoutMs: kugouPlaybackTimeoutMs,
    });
    lastResponse = response;
    const source = sourceFromPlaybackResponse(request, quality, response, cookie);
    if (source) {
      return source;
    }
  }

  throw new Error(playbackErrorMessage(lastResponse) ?? 'KuGou Music did not return a playable URL for this track.');
};

export class KugouStreamingProvider implements StreamingProvider {
  readonly name = provider;
  private readonly lyricsProvider = new KugouLyricsProvider();

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: '酷狗音乐',
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: true,
      supportsLyrics: true,
      supportsMv: true,
      requiresAccount: false,
      accountConnected: status.connected,
      accountDisplayName: status.displayName,
      accountUsername: status.username,
      accountAvatarUrl: status.avatarUrl,
      status: 'ready',
      statusMessage: status.connected
        ? 'KuGou Music account connected'
        : 'Search and lyrics are public. Sign in with KuGou Music cookies before playing or downloading protected tracks.',
    };
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const variants = (request.page ?? 1) === 1 ? streamingSearchQueryVariants(request.query) : [request.query];
    let firstResult: StreamingSearchResult | null = null;

    for (const query of variants) {
      const result = await this.searchOnce({ ...request, query });
      firstResult ??= result;
      if (result.tracks.length > 0 || result.albums.length > 0 || result.artists.length > 0 || result.playlists.length > 0) {
        return { ...result, query: request.query };
      }
    }

    return firstResult ? { ...firstResult, query: request.query } : this.searchOnce(request);
  }

  private async searchOnce(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? 20)));
    const mediaType = request.mediaTypes?.[0] ?? 'track';
    const endpoint = searchEndpoint(mediaType);
    const emptyResult: StreamingSearchResult = {
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
    if (!endpoint) {
      return emptyResult;
    }

    const params = new URLSearchParams({
      format: 'json',
      keyword: request.query,
      page: String(page),
      pagesize: String(pageSize),
      showtype: '1',
    });
    const data = await fetchKugouJson(endpoint, params);
    const values = arrayInfo(data);
    const total = totalFromData(data);

    return {
      ...emptyResult,
      total,
      hasMore: total ? page * pageSize < total : values.length === pageSize,
      tracks: mediaType === 'track' ? mapSongs(values) : [],
      albums: mediaType === 'album' ? values.map((value) => mapAlbum(value)).filter((album) => album.providerAlbumId) : [],
      artists: mediaType === 'artist' ? values.map((value) => mapArtist(value)).filter((artist) => artist.providerArtistId) : [],
      playlists: mediaType === 'playlist' ? values.map((value) => mapPlaylist(value)).filter((playlist) => playlist.providerPlaylistId) : [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const trackKey = parseKugouProviderTrackId(input.providerTrackId);
    if (!trackKey) {
      throw new Error('Invalid KuGou Music track id.');
    }

    const params = new URLSearchParams({ hash: trackKey.hash });
    const data = asRecord(await fetchKugouJson('song/info', params));
    const song = asRecord(data.data);
    const track = mapSong(Object.keys(song).length ? song : data, trackKey);
    if (!track) {
      throw new Error('KuGou Music track detail is empty.');
    }

    return track;
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    const params = new URLSearchParams({
      albumid: input.providerAlbumId,
      page: '1',
      pagesize: '100',
    });
    const data = await fetchKugouJson('album/song', params);
    const tracks = mapSongs(arrayInfo(data));
    const firstTrack = tracks[0] ?? null;
    const album = mapAlbum(asRecord(asRecord(data).data), {
      providerAlbumId: input.providerAlbumId,
      title: firstTrack?.album,
      artist: firstTrack?.artist,
      coverUrl: firstTrack?.coverUrl,
    });

    return {
      ...album,
      trackCount: album.trackCount ?? totalFromData(data) ?? tracks.length,
      tracks,
    };
  }

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    const [infoResult, songsResult] = await Promise.allSettled([
      fetchKugouJson('singer/info', new URLSearchParams({ singerid: input.providerArtistId })),
      fetchKugouJson('singer/song', new URLSearchParams({ singerid: input.providerArtistId, page: '1', pagesize: '50' })),
    ]);
    const info = infoResult.status === 'fulfilled' ? asRecord(asRecord(infoResult.value).data ?? infoResult.value) : {};
    const tracks = songsResult.status === 'fulfilled' ? mapSongs(arrayInfo(songsResult.value)) : [];
    const artist = mapArtist(info, input.providerArtistId);

    return {
      ...artist,
      topTracks: tracks,
      albums: albumsFromTracks(tracks),
    };
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 100)));
    const params = new URLSearchParams({
      specialid: input.providerPlaylistId,
      page: String(page),
      pagesize: String(pageSize),
    });
    const data = await fetchKugouJson('special/song', params, 12_000);
    const tracks = mapSongs(arrayInfo(data));
    const total = totalFromData(data) ?? tracks.length;
    const playlist = mapPlaylist(asRecord(asRecord(data).data), input.providerPlaylistId);

    return {
      ...playlist,
      trackCount: playlist.trackCount ?? total,
      tracks,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  async getLyrics(input: { providerTrackId: string }): Promise<StreamingLyricsResult> {
    const track = await this.getTrack(input);
    const query: LyricsQuery = {
      trackId: track.id,
      mediaType: 'streaming',
      sourceId: input.providerTrackId,
      stableKey: track.stableKey,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.duration,
    };
    const [result] = await this.lyricsProvider.search({
      query,
      normalized: buildNormalizedLyricsQuery(query),
      timeoutMs: kugouSearchTimeoutMs,
    });

    if (!result) {
      return {
        provider,
        providerTrackId: input.providerTrackId,
        status: 'missing',
        plainLyrics: null,
        syncedLyrics: null,
        lines: [],
        sourceLabel: 'KuGou',
      };
    }

    const split = splitLyricsByKind(result.syncedLyrics ?? result.plainLyrics);
    const syncedLyrics = result.syncedLyrics ?? split.syncedLyrics;
    const plainLyrics = result.plainLyrics ?? split.plainLyrics;

    return {
      provider,
      providerTrackId: input.providerTrackId,
      status: result.instrumental || syncedLyrics || plainLyrics ? 'available' : 'missing',
      plainLyrics,
      syncedLyrics,
      translationLyrics: result.translationLyrics,
      romanizationLyrics: result.romanizationLyrics,
      instrumental: result.instrumental,
      lines: linesFromLyrics(syncedLyrics, plainLyrics, result.translationLyrics ?? null, result.romanizationLyrics ?? null),
      sourceLabel: result.sourceLabel ?? 'KuGou',
    };
  }

  async getMv(input: { providerTrackId: string }): Promise<StreamingMvResult> {
    const trackKey = parseKugouProviderTrackId(input.providerTrackId);
    if (!trackKey) {
      return { provider, providerTrackId: input.providerTrackId, status: 'missing', items: [] };
    }

    const data = asRecord(await fetchKugouJson('song/info', new URLSearchParams({ hash: trackKey.hash })));
    const song = asRecord(data.data);
    const track = mapSong(Object.keys(song).length ? song : data, trackKey);
    const mvIds = [
      firstText(song, ['mvhash', 'mv_hash', 'mvHash']),
      ...((Array.isArray(song.mvdata) ? song.mvdata : [song.mvdata]).map((item) => firstText(asRecord(item), ['hash', 'mvhash', 'id']))),
    ].filter((item): item is string => Boolean(item));

    const items: StreamingMvItem[] = [...new Set(mvIds)].map((mvId) => ({
      id: streamingStableKey(provider, `mv:${mvId}`),
      provider,
      providerMvId: mvId,
      providerTrackId: input.providerTrackId,
      title: `${track?.title ?? 'KuGou'} MV`,
      artist: track?.artist ?? 'Unknown Artist',
      duration: track?.duration ?? null,
      thumbnailUrl: track?.coverThumb ?? null,
    }));

    return {
      provider,
      providerTrackId: input.providerTrackId,
      status: items.length > 0 ? 'available' : 'missing',
      items,
    };
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    return resolveKugouPlaybackUrl(request);
  }
}
