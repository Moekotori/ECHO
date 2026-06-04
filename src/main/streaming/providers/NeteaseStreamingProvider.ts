import { createRequire } from 'node:module';
import type { AccountStatus } from '../../../shared/types/accounts';
import type {
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingArtistRef,
  StreamingLyricsResult,
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
import type { StreamingProvider } from '../StreamingProvider';
import { streamingSearchQueryVariants } from '../StreamingSearchQueryVariants';
import { asRecord, integer, jsonFetch, linesFromLyrics, number, splitLyricsByKind, streamingImageProxyUrl, text } from './chinaStreamingUtils';

const provider = 'netease' as const;
const neteaseReferer = 'https://music.163.com/';
const loadFromCjs = createRequire(import.meta.url);
const neteaseSongDetailBatchSize = 100;
const neteaseCloudSearchFrequentOperationCooldownMs = 30 * 1000;
const neteasePlaybackApiTimeoutMs = 2_500;
const neteasePlaybackJsonTimeoutMs = 4_500;
let neteaseCloudSearchCooldownUntil = 0;

const neteaseHeaders = (cookie?: string): Record<string, string> => ({
  Referer: neteaseReferer,
  Origin: 'https://music.163.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ...(cookie ? { Cookie: cookie } : {}),
});

type NeteaseRequestedQuality = NonNullable<StreamingPlaybackRequest['quality']> | 'fallback';
type NeteaseApi = {
  album?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  artist_album?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  artist_top_song?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  artists?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  cloudsearch?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  dj_detail?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  dj_program?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  likelist?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  login_status?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  playlist_track_all?: (request: Record<string, unknown>) => Promise<{ body?: { songs?: unknown[] } }>;
  recommend_songs?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  song_like?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  song_url?: (request: Record<string, unknown>) => Promise<{ body?: { data?: unknown[] } }>;
  song_url_v1?: (request: Record<string, unknown>) => Promise<{ body?: { data?: unknown[] } }>;
  user_account?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
  user_playlist?: (request: Record<string, unknown>) => Promise<{ body?: unknown }>;
};
type NeteaseResolvedSource = {
  url: string;
  type: string;
  br: number;
  level: string;
};
let ncmApiForTests: NeteaseApi | null | undefined;

const neteaseQualityLevels: Record<NeteaseRequestedQuality, Array<{ level: string; bitrate: number; quality: NonNullable<StreamingPlaybackSource['codec']> }>> = {
  hires: [
    { level: 'jymaster', bitrate: 2000000, quality: 'flac' },
    { level: 'sky', bitrate: 1500000, quality: 'flac' },
    { level: 'jyeffect', bitrate: 1500000, quality: 'flac' },
    { level: 'hires', bitrate: 999000, quality: 'flac' },
    { level: 'lossless', bitrate: 999000, quality: 'flac' },
    { level: 'exhigh', bitrate: 320000, quality: 'mp3' },
    { level: 'higher', bitrate: 192000, quality: 'mp3' },
    { level: 'standard', bitrate: 128000, quality: 'mp3' },
  ],
  lossless: [
    { level: 'lossless', bitrate: 999000, quality: 'flac' },
    { level: 'exhigh', bitrate: 320000, quality: 'mp3' },
    { level: 'higher', bitrate: 192000, quality: 'mp3' },
    { level: 'standard', bitrate: 128000, quality: 'mp3' },
  ],
  high: [
    { level: 'exhigh', bitrate: 320000, quality: 'mp3' },
    { level: 'higher', bitrate: 192000, quality: 'mp3' },
    { level: 'standard', bitrate: 128000, quality: 'mp3' },
  ],
  standard: [{ level: 'standard', bitrate: 128000, quality: 'mp3' }],
  fallback: [
    { level: 'lossless', bitrate: 999000, quality: 'flac' },
    { level: 'exhigh', bitrate: 320000, quality: 'mp3' },
    { level: 'higher', bitrate: 192000, quality: 'mp3' },
    { level: 'standard', bitrate: 128000, quality: 'mp3' },
  ],
};

const imageUrl = (value: unknown, size = 300): string | null => {
  const raw = text(value);
  const normalized = raw?.replace(/^http:\/\//iu, 'https://');
  return normalized ? `${normalized}${normalized.includes('?') ? '&' : '?'}param=${size}y${size}` : null;
};

const neteaseImageUrl = (value: unknown, size: number): string | null => streamingImageProxyUrl(imageUrl(value, size), neteaseReferer);

const accountStatus = (): AccountStatus => getAccountService().getStatus(provider);

const accountCookie = (): string | undefined => getAccountService().getCredentials(provider).cookie?.trim() || undefined;

const getNcmApi = (): NeteaseApi | null => {
  if (ncmApiForTests !== undefined) {
    return ncmApiForTests;
  }

  try {
    return loadFromCjs('@neteasecloudmusicapienhanced/api') as NeteaseApi;
  } catch {
    return null;
  }
};

export const setNeteaseApiForTests = (api: NeteaseApi | null | undefined): void => {
  ncmApiForTests = api;
  neteaseCloudSearchCooldownUntil = 0;
};

const withPlaybackApiTimeout = async <T>(work: Promise<T>): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('netease_playback_url_timeout')), neteasePlaybackApiTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const isNeteaseFrequentOperationError = (value: unknown): boolean => {
  const record = asRecord(value);
  const body = asRecord(record.body);
  const status = Number(record.status ?? body.code);
  const messages = [record.message, body.msg, body.message]
    .map((item) => text(item))
    .filter((item): item is string => Boolean(item));

  return status === 405 || messages.some((message) => /操作频繁|too many|frequent|rate[_ -]?limit/iu.test(message));
};

const cookieValue = (cookie: string | undefined, name: string): string | null => {
  if (!cookie) {
    return null;
  }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'u'));
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const toPlaybackSource = (
  request: StreamingPlaybackRequest,
  source: NeteaseResolvedSource,
  candidate: { bitrate: number; quality: NonNullable<StreamingPlaybackSource['codec']> },
  cookie?: string,
): StreamingPlaybackSource => {
  const type = source.type.toLocaleLowerCase() || candidate.quality || 'mp3';

  return {
    provider,
    providerTrackId: request.providerTrackId,
    url: source.url,
    expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
    mimeType: type === 'flac' ? 'audio/flac' : 'audio/mpeg',
    bitrate: source.br || candidate.bitrate,
    sampleRate: null,
    bitDepth: null,
    codec: type,
    headers: neteaseHeaders(cookie),
    requiresProxy: false,
    supportsRange: true,
  };
};

const resolveWithNcmApi = async (
  request: StreamingPlaybackRequest,
  candidate: { level: string; bitrate: number; quality: NonNullable<StreamingPlaybackSource['codec']> },
  cookie: string | undefined,
): Promise<NeteaseResolvedSource | null> => {
  const ncm = getNcmApi();
  if (!ncm?.song_url_v1 && !ncm?.song_url) {
    return null;
  }

  const id = Number(request.providerTrackId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  if (ncm.song_url_v1) {
    try {
      const response = await withPlaybackApiTimeout(ncm.song_url_v1({
        id,
        level: candidate.level,
        ...(cookie ? { cookie } : {}),
      }));
      const entry = asRecord(Array.isArray(response.body?.data) ? response.body?.data[0] : null);
      const url = text(entry.url);
      if (url) {
        return {
          url,
          type: text(entry.type) ?? candidate.quality,
          br: integer(entry.br) ?? candidate.bitrate,
          level: text(entry.level) ?? candidate.level,
        };
      }
    } catch {
      // Fall through to the older bitrate based resolver below.
    }
  }

  if (!ncm.song_url) {
    return null;
  }

  try {
    const response = await withPlaybackApiTimeout(ncm.song_url({
      id,
      br: candidate.bitrate,
      ...(cookie ? { cookie } : {}),
    }));
    const entry = asRecord(Array.isArray(response.body?.data) ? response.body?.data[0] : null);
    const url = text(entry.url);
    if (!url) {
      return null;
    }

    return {
      url,
      type: text(entry.type) ?? candidate.quality,
      br: integer(entry.br) ?? candidate.bitrate,
      level: text(entry.level) ?? candidate.level,
    };
  } catch {
    return null;
  }
};

const artistRefs = (artistsValue: unknown): StreamingArtistRef[] => {
  const artists = Array.isArray(artistsValue) ? artistsValue.map(asRecord) : [];
  return artists
    .map((artist): StreamingArtistRef | null => {
      const id = String(artist.id ?? text(artist.name) ?? '').trim();
      const name = text(artist.name);
      if (!id || !name) {
        return null;
      }

      return {
        id: streamingStableKey(provider, `artist:${id}`),
        provider,
        providerArtistId: id,
        name,
      };
    })
    .filter((artist): artist is StreamingArtistRef => Boolean(artist));
};

const mapSong = (songValue: unknown, detailCoverUrl: string | null = null): StreamingTrack => {
  const song = asRecord(songValue);
  const album = asRecord(song.album ?? song.al);
  const artistsValue = song.artists ?? song.ar;
  const artists = artistRefs(artistsValue);
  const providerTrackId = String(song.id ?? '').trim();
  const title = text(song.name) ?? text(song.title) ?? 'Untitled';
  const artist = artists.map((item) => item.name).join(' / ') || 'Unknown Artist';
  const albumTitle = text(album.name) ?? 'Unknown Album';
  const fee = integer(song.fee);
  const playable = Boolean(providerTrackId);
  const coverSource = detailCoverUrl ?? album.picUrl ?? album.blurPicUrl ?? album.pic;

  return {
    id: streamingStableKey(provider, providerTrackId || title),
    provider,
    providerTrackId: providerTrackId || title,
    stableKey: streamingStableKey(provider, providerTrackId || title),
    title,
    artist,
    artists,
    album: albumTitle,
    albumId: album.id == null ? null : String(album.id),
    albumArtist: artist,
    duration: (number(song.duration ?? song.dt) ?? 0) > 0 ? (number(song.duration ?? song.dt) ?? 0) / 1000 : null,
    coverUrl: neteaseImageUrl(coverSource, 600),
    coverThumb: neteaseImageUrl(coverSource, 160),
    qualities: fee === 1 ? ['standard', 'high'] : ['standard', 'high', 'lossless'],
    explicit: false,
    playable,
    unavailableReason: playable ? null : 'This NetEase track has no provider id.',
    lyricsStatus: 'available',
    mvStatus: integer(song.mvid ?? song.mv) ? 'available' : 'unknown',
  };
};

const mapAlbum = (albumValue: unknown): StreamingAlbum => {
  const album = asRecord(albumValue);
  const artists = artistRefs(album.artists ?? album.ar);
  const providerAlbumId = String(album.id ?? text(album.name) ?? '').trim();
  const title = text(album.name) ?? 'Unknown Album';
  const artist = artists.map((item) => item.name).join(' / ') || text(asRecord(album.artist).name) || 'Unknown Artist';
  const publishTime = number(album.publishTime);

  return {
    id: streamingStableKey(provider, `album:${providerAlbumId || title}`),
    provider,
    providerAlbumId: providerAlbumId || title,
    title,
    artist,
    artists,
    coverUrl: neteaseImageUrl(album.picUrl ?? album.blurPicUrl ?? album.pic, 600),
    coverThumb: neteaseImageUrl(album.picUrl ?? album.blurPicUrl ?? album.pic, 160),
    releaseDate: publishTime ? new Date(publishTime).toISOString().slice(0, 10) : text(album.publishTime),
    trackCount: integer(album.size ?? album.trackCount),
  };
};

const mapArtist = (artistValue: unknown): StreamingArtist => {
  const artist = asRecord(artistValue);
  const providerArtistId = String(artist.id ?? text(artist.name) ?? '').trim();
  const name = text(artist.name) ?? 'Unknown Artist';

  return {
    id: streamingStableKey(provider, `artist:${providerArtistId || name}`),
    provider,
    providerArtistId: providerArtistId || name,
    name,
    avatarUrl: neteaseImageUrl(artist.picUrl ?? artist.img1v1Url ?? artist.avatar, 160),
    coverUrl: neteaseImageUrl(artist.picUrl ?? artist.img1v1Url ?? artist.avatar, 600),
  };
};

const artistFromRef = (artist: StreamingArtistRef): StreamingArtist => ({
  id: streamingStableKey(provider, `artist:${artist.providerArtistId}`),
  provider,
  providerArtistId: artist.providerArtistId,
  name: artist.name,
  avatarUrl: null,
  coverUrl: null,
});

const uniqueArtistsFromTracks = (tracks: StreamingTrack[]): StreamingArtist[] => {
  const artistsById = new Map<string, StreamingArtist>();
  for (const track of tracks) {
    for (const artist of track.artists) {
      if (!artistsById.has(artist.providerArtistId)) {
        artistsById.set(artist.providerArtistId, artistFromRef(artist));
      }
    }
  }

  return [...artistsById.values()];
};

const mapPlaylist = (playlistValue: unknown): StreamingPlaylist => {
  const playlist = asRecord(playlistValue);
  const providerPlaylistId = String(playlist.id ?? text(playlist.name) ?? '').trim();
  const title = text(playlist.name) ?? 'NetEase Playlist';
  const creator = asRecord(playlist.creator);

  return {
    id: streamingStableKey(provider, `playlist:${providerPlaylistId || title}`),
    provider,
    providerPlaylistId: providerPlaylistId || title,
    title,
    description: text(playlist.description),
    creator: text(creator.nickname) ?? text(creator.userName) ?? text(creator.name),
    coverUrl: neteaseImageUrl(playlist.coverImgUrl ?? playlist.picUrl ?? playlist.coverUrl, 600),
    coverThumb: neteaseImageUrl(playlist.coverImgUrl ?? playlist.picUrl ?? playlist.coverUrl, 160),
    trackCount: integer(playlist.trackCount ?? playlist.bookCount ?? playlist.size),
  };
};

const neteaseDjRadioPlaylistPrefix = 'djradio:';

const neteaseDjRadioProviderPlaylistId = (radioId: string): string => `${neteaseDjRadioPlaylistPrefix}${radioId}`;

const neteaseDjRadioId = (providerPlaylistId: string): string | null =>
  providerPlaylistId.startsWith(neteaseDjRadioPlaylistPrefix) ? providerPlaylistId.slice(neteaseDjRadioPlaylistPrefix.length).trim() || null : null;

const djProgramArtistFallback = (program: Record<string, unknown>, radio: Record<string, unknown>): unknown[] => {
  const dj = asRecord(program.dj ?? radio.dj);
  const name = text(dj.nickname) ?? text(dj.userName) ?? text(dj.name) ?? text(radio.name);
  if (!name) {
    return [];
  }

  return [
    {
      id: dj.userId ?? dj.id ?? name,
      name,
    },
  ];
};

const mapDjProgramTrack = (programValue: unknown, radioValue: unknown): StreamingTrack | null => {
  const program = asRecord(programValue);
  const radio = asRecord(radioValue);
  const mainSong = asRecord(program.mainSong);
  const providerTrackId = neteaseIdText(mainSong.id ?? program.mainTrackId);
  if (!providerTrackId) {
    return null;
  }

  const album = asRecord(mainSong.album ?? mainSong.al);
  const radioId = neteaseIdText(radio.id);
  const coverSource = program.coverUrl ?? program.blurCoverUrl ?? album.picUrl ?? album.blurPicUrl ?? album.pic ?? radio.picUrl ?? radio.intervenePicUrl;
  const fallbackArtists = djProgramArtistFallback(program, radio);
  const song = {
    ...mainSong,
    id: providerTrackId,
    name: text(program.name) ?? text(mainSong.name) ?? `NetEase Podcast ${providerTrackId}`,
    duration: mainSong.duration ?? mainSong.dt ?? program.duration,
    dt: mainSong.dt ?? mainSong.duration ?? program.duration,
    artists: Array.isArray(mainSong.artists) && mainSong.artists.length > 0 ? mainSong.artists : fallbackArtists,
    ar: Array.isArray(mainSong.ar) && mainSong.ar.length > 0 ? mainSong.ar : fallbackArtists,
    album: {
      ...album,
      id: radioId ? neteaseDjRadioProviderPlaylistId(radioId) : album.id ?? 0,
      name: text(radio.name) ?? text(album.name) ?? 'NetEase Podcast',
      picUrl: album.picUrl ?? radio.picUrl ?? radio.intervenePicUrl,
      blurPicUrl: album.blurPicUrl ?? radio.picUrl ?? radio.intervenePicUrl,
      pic: album.pic ?? radio.picId,
    },
  };

  return {
    ...mapSong(song, text(coverSource)),
    lyricsStatus: program.existLyric === true ? 'available' : 'unknown',
  };
};

const neteaseAlbumSongs = (value: unknown): unknown[] => {
  const record = asRecord(value);
  const directSongs = record.songs;
  if (Array.isArray(directSongs)) {
    return directSongs;
  }

  const album = asRecord(record.album);
  const albumSongs = album.songs;
  if (Array.isArray(albumSongs)) {
    return albumSongs;
  }

  return [];
};

const neteaseSearchType = (request: StreamingSearchRequest): '1' | '10' | '100' | '1000' => {
  const mediaType = request.mediaTypes?.[0] ?? 'track';
  if (mediaType === 'album') {
    return '10';
  }
  if (mediaType === 'artist') {
    return '100';
  }
  if (mediaType === 'playlist') {
    return '1000';
  }
  return '1';
};

const neteaseSearchResultHasItems = (result: Record<string, unknown>): boolean => {
  const songs = Array.isArray(result.songs) ? result.songs : [];
  const albums = Array.isArray(result.albums) ? result.albums : [];
  const artists = Array.isArray(result.artists) ? result.artists : [];
  const playlists = Array.isArray(result.playlists) ? result.playlists : [];

  return songs.length > 0 || albums.length > 0 || artists.length > 0 || playlists.length > 0;
};

const resolveWithNcmCloudSearch = async (
  request: StreamingSearchRequest,
  searchType: '1' | '10' | '100' | '1000',
  page: number,
  pageSize: number,
  cookie: string | undefined,
): Promise<Record<string, unknown> | null> => {
  const ncm = getNcmApi();
  if (!ncm?.cloudsearch) {
    return null;
  }
  if (Date.now() < neteaseCloudSearchCooldownUntil) {
    return null;
  }

  try {
    const response = await ncm.cloudsearch({
      keywords: request.query,
      type: Number(searchType),
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(cookie ? { cookie } : {}),
    });
    const data = asRecord(response.body);
    if (isNeteaseFrequentOperationError(response) || isNeteaseFrequentOperationError(data)) {
      neteaseCloudSearchCooldownUntil = Date.now() + neteaseCloudSearchFrequentOperationCooldownMs;
      return null;
    }
    return asRecord(data.result);
  } catch (error) {
    if (isNeteaseFrequentOperationError(error)) {
      neteaseCloudSearchCooldownUntil = Date.now() + neteaseCloudSearchFrequentOperationCooldownMs;
    }
    return null;
  }
};

const dailyRecommendSongs = (value: unknown): unknown[] => {
  const body = asRecord(value);
  const data = asRecord(body.data);
  if (Array.isArray(data.dailySongs)) {
    return data.dailySongs;
  }

  if (Array.isArray(body.recommend)) {
    return body.recommend;
  }

  return [];
};

const neteaseUserIdFromBody = (value: unknown): string | null => {
  const body = asRecord(value);
  const data = asRecord(body.data);
  const account = asRecord(body.account ?? data.account);
  const profile = asRecord(body.profile ?? data.profile);
  const bindings = Array.isArray(body.bindings) ? body.bindings : Array.isArray(data.bindings) ? data.bindings : [];
  return (
    neteaseIdText(profile.userId) ??
    neteaseIdText(profile.userid) ??
    neteaseIdText(account.id) ??
    neteaseIdText(account.userId) ??
    neteaseIdText(account.userid) ??
    bindings.map((binding) => neteaseIdText(asRecord(binding).userId ?? asRecord(binding).userid)).find(Boolean) ??
    collectNeteaseUserIds(value)[0] ??
    null
  );
};

const neteaseIdText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return text(value);
};

const uniqueTexts = (values: Array<string | null>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
};

const collectNeteaseUserIds = (value: unknown, depth = 0): string[] => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return uniqueTexts(value.flatMap((item) => collectNeteaseUserIds(item, depth + 1)));
  }

  const record = asRecord(value);
  const direct = neteaseIdText(record.userId ?? record.userid);
  return uniqueTexts([direct, ...Object.values(record).flatMap((item) => collectNeteaseUserIds(item, depth + 1))]);
};

const neteaseIdsFromArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueTexts(
    value.map((item) => {
      const record = asRecord(item);
      return neteaseIdText(record.id ?? record.songId ?? record.trackId ?? item);
    }),
  );
};

const collectNeteaseLikedIds = (value: unknown, depth = 0): string[] => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return uniqueTexts(value.flatMap((item) => collectNeteaseLikedIds(item, depth + 1)));
  }

  const record = asRecord(value);
  const direct: string[] = [];
  const likedIdKeys = new Set(['ids', 'checkPoint', 'songIds', 'trackIds']);
  for (const [key, item] of Object.entries(record)) {
    if (likedIdKeys.has(key) && Array.isArray(item)) {
      direct.push(...neteaseIdsFromArray(item));
    }
  }

  return uniqueTexts([...direct, ...Object.values(record).flatMap((item) => collectNeteaseLikedIds(item, depth + 1))]);
};

const neteasePlaylistTrackIds = (value: unknown): string[] => {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const playlist = asRecord(root.playlist ?? data.playlist ?? root.result ?? data.result ?? value);
  return uniqueTexts([
    ...neteaseIdsFromArray(playlist.trackIds),
    ...neteaseIdsFromArray(playlist.tracks),
    ...neteaseIdsFromArray(playlist.songs),
  ]);
};

const neteasePlaylistRecords = (value: unknown, depth = 0): Record<string, unknown>[] => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => neteasePlaylistRecords(item, depth + 1));
  }

  const record = asRecord(value);
  const id = neteaseIdText(record.id ?? record.playlistId);
  const name = text(record.name);
  const current = id && name ? [record] : [];
  return [...current, ...Object.values(record).flatMap((item) => neteasePlaylistRecords(item, depth + 1))];
};

const neteaseLikedPlaylistId = (value: unknown): string | null => {
  const playlists = neteasePlaylistRecords(value);
  const liked =
    playlists.find((playlist) => integer(playlist.specialType) === 5) ??
    playlists.find((playlist) => /我喜欢|我喜歡|喜欢的音乐|喜歡的音樂|liked|favorite/iu.test(text(playlist.name) ?? ''));
  return liked ? neteaseIdText(liked.id ?? liked.playlistId) : null;
};

const assertNeteaseWriteSuccess = (value: unknown): void => {
  const body = asRecord(value);
  const rawCode = body.code ?? asRecord(body.data).code;
  const code = rawCode === undefined || rawCode === null || rawCode === '' ? null : Number(rawCode);
  if (code !== null && Number.isFinite(code) && code !== 200) {
    throw new Error(text(body.message) ?? text(body.msg) ?? `NetEase returned ${code}.`);
  }
};

export class NeteaseStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: '网易云音乐',
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
      supportsLyrics: true,
      supportsMv: true,
      requiresAccount: false,
      accountConnected: status.connected,
      accountDisplayName: status.displayName,
      accountUsername: status.username,
      accountAvatarUrl: status.avatarUrl,
      status: 'ready',
      statusMessage: status.connected ? '已连接网易云音乐账号' : '公开搜索、歌词和元数据可用。登录后可播放会员内容并下载歌曲。',
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

    if ((request.mediaTypes?.[0] ?? 'track') === 'artist' && (request.page ?? 1) === 1) {
      for (const query of variants) {
        const trackResult = await this.searchOnce({ ...request, query, mediaTypes: ['track'] });
        const artists = uniqueArtistsFromTracks(trackResult.tracks);
        if (artists.length > 0) {
          return {
            ...trackResult,
            query: request.query,
            tracks: [],
            albums: [],
            artists: artists.slice(0, request.pageSize ?? 20),
            playlists: [],
            mvs: [],
            total: artists.length,
            hasMore: false,
          };
        }
      }
    }

    return firstResult ? { ...firstResult, query: request.query } : this.searchOnce(request);
  }

  private async searchOnce(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? 20)));
    const searchType = neteaseSearchType(request);
    const params = new URLSearchParams({
      type: searchType,
      s: request.query,
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    const cookie = accountCookie();
    let result: Record<string, unknown>;
    try {
      const data = asRecord(await jsonFetch(`https://music.163.com/api/search/get/web?${params.toString()}`, { headers: neteaseHeaders(cookie) }));
      result = asRecord(data.result);
    } catch (error) {
      const fallbackResult = await resolveWithNcmCloudSearch(request, searchType, page, pageSize, cookie);
      if (!fallbackResult) {
        throw error;
      }

      result = fallbackResult;
    }

    if (!neteaseSearchResultHasItems(result)) {
      const fallbackResult = await resolveWithNcmCloudSearch(request, searchType, page, pageSize, cookie);
      if (fallbackResult && neteaseSearchResultHasItems(fallbackResult)) {
        result = fallbackResult;
      }
    }

    const songs = Array.isArray(result.songs) ? result.songs : [];
    const albums = Array.isArray(result.albums) ? result.albums : [];
    const artists = Array.isArray(result.artists) ? result.artists : [];
    const playlists = Array.isArray(result.playlists) ? result.playlists : [];
    const total = integer(result.songCount);
    const detailCoverUrls = await this.findDetailCoverUrls(
      songs.map((songValue) => asRecord(songValue).id).filter((id) => id !== undefined && id !== null),
    );
    const resultTotal =
      searchType === '10'
        ? integer(result.albumCount)
        : searchType === '100'
          ? integer(result.artistCount)
          : searchType === '1000'
            ? integer(result.playlistCount)
            : total;

    return {
      provider,
      query: request.query,
      page,
      pageSize,
      total: resultTotal,
      hasMore: resultTotal ? page * pageSize < resultTotal : Math.max(songs.length, albums.length, artists.length, playlists.length) === pageSize,
      tracks: songs.map((song) => mapSong(song, detailCoverUrls.get(String(asRecord(song).id)) ?? null)),
      albums: albums.map(mapAlbum),
      artists: artists.map(mapArtist),
      playlists: playlists.map(mapPlaylist),
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const params = new URLSearchParams({ id: input.providerTrackId, ids: JSON.stringify([input.providerTrackId]) });
    const data = asRecord(await jsonFetch(`https://music.163.com/api/song/detail/?${params.toString()}`, { headers: neteaseHeaders(accountCookie()) }));
    const songs = Array.isArray(data.songs) ? data.songs : [];
    const song = songs[0];
    if (!song) {
      throw new Error('没有找到这首网易云音乐歌曲');
    }

    return mapSong(song);
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    const cookie = accountCookie();
    const ncm = getNcmApi();
    let data = asRecord(
      ncm?.album
        ? (await ncm.album({ id: input.providerAlbumId, ...(cookie ? { cookie } : {}) })).body
        : await jsonFetch(`https://music.163.com/api/v1/album/${encodeURIComponent(input.providerAlbumId)}`, {
            headers: neteaseHeaders(cookie),
          }),
    );
    let songs = neteaseAlbumSongs(data);
    if (songs.length === 0 && ncm?.album) {
      const fallbackData = asRecord(
        await jsonFetch(`https://music.163.com/api/v1/album/${encodeURIComponent(input.providerAlbumId)}`, {
          headers: neteaseHeaders(cookie),
        }),
      );
      songs = neteaseAlbumSongs(fallbackData);
      if (songs.length > 0 || !asRecord(data.album).id) {
        data = fallbackData;
      }
    }
    const albumValue = asRecord(data.album);
    if (!albumValue.id && songs.length === 0) {
      throw new Error('没有找到这张网易云音乐专辑');
    }

    const album = mapAlbum({ ...albumValue, id: albumValue.id ?? input.providerAlbumId });
    const coverUrl = text(albumValue.picUrl ?? albumValue.blurPicUrl ?? albumValue.pic);
    return {
      ...album,
      tracks: songs.map((song) => mapSong(song, coverUrl)),
    };
  }

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    const cookie = accountCookie();
    const ncm = getNcmApi();
    const [artistData, topSongData, albumData] = await Promise.all([
      ncm?.artists
        ? ncm.artists({ id: input.providerArtistId, ...(cookie ? { cookie } : {}) }).then((response) => response.body)
        : jsonFetch(`https://music.163.com/api/v1/artist/${encodeURIComponent(input.providerArtistId)}`, { headers: neteaseHeaders(cookie) }),
      ncm?.artist_top_song
        ? ncm.artist_top_song({ id: input.providerArtistId, ...(cookie ? { cookie } : {}) }).then((response) => response.body)
        : jsonFetch(`https://music.163.com/api/artist/top/song?id=${encodeURIComponent(input.providerArtistId)}`, { headers: neteaseHeaders(cookie) }),
      ncm?.artist_album
        ? ncm.artist_album({ id: input.providerArtistId, limit: 24, offset: 0, ...(cookie ? { cookie } : {}) }).then((response) => response.body)
        : jsonFetch(`https://music.163.com/api/artist/albums/${encodeURIComponent(input.providerArtistId)}?limit=24&offset=0`, { headers: neteaseHeaders(cookie) }),
    ]);
    const artistValue = asRecord(asRecord(artistData).artist);
    const artist = mapArtist({ ...artistValue, id: artistValue.id ?? input.providerArtistId });
    const topSongRecord = asRecord(topSongData);
    const topSongItems: unknown[] = Array.isArray(topSongRecord.songs)
      ? topSongRecord.songs
      : Array.isArray(asRecord(artistData).hotSongs)
        ? asRecord(artistData).hotSongs as unknown[]
        : [];
    const topTracks = topSongItems
      .slice(0, 30)
      .map((song) => mapSong(song));
    const albumRecord = asRecord(albumData);
    const albums = (Array.isArray(albumRecord.hotAlbums) ? albumRecord.hotAlbums : Array.isArray(albumRecord.albums) ? albumRecord.albums : [])
      .map(mapAlbum);

    return {
      ...artist,
      topTracks,
      albums,
    };
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 100)));
    const djRadioId = neteaseDjRadioId(input.providerPlaylistId);
    if (djRadioId) {
      return this.getDjRadioPlaylist(djRadioId, page, pageSize);
    }

    const params = new URLSearchParams({ id: input.providerPlaylistId });
    const data = asRecord(
      await jsonFetch(`https://music.163.com/api/v6/playlist/detail?${params.toString()}`, {
        headers: neteaseHeaders(accountCookie()),
        timeoutMs: 12_000,
      }),
    );
    const playlist = asRecord(data.playlist ?? data.result);
    const trackIds = Array.isArray(playlist.trackIds)
      ? playlist.trackIds.map((item) => String(asRecord(item).id ?? '').trim()).filter(Boolean)
      : [];
    const embeddedTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    const total = trackIds.length || integer(playlist.trackCount) || embeddedTracks.length;
    const offset = (page - 1) * pageSize;
    const pageTrackIds = trackIds.slice(offset, offset + pageSize);
    let tracks = embeddedTracks.slice(offset, offset + pageSize);

    if (pageTrackIds.length > 0) {
      tracks = await this.fetchPlaylistTrackPage(input.providerPlaylistId, offset, pageSize, pageTrackIds).catch(() => tracks);
    }

    const consumedCount = pageTrackIds.length || tracks.length;

    return {
      id: streamingStableKey(provider, `playlist:${input.providerPlaylistId}`),
      provider,
      providerPlaylistId: input.providerPlaylistId,
      title: text(playlist.name) ?? 'NetEase Playlist',
      description: text(playlist.description),
      creator: text(asRecord(playlist.creator).nickname),
      coverUrl: neteaseImageUrl(playlist.coverImgUrl ?? playlist.picUrl, 600),
      coverThumb: neteaseImageUrl(playlist.coverImgUrl ?? playlist.picUrl, 160),
      trackCount: total,
      tracks: tracks.map((track) => mapSong(track)),
      page,
      pageSize,
      total,
      hasMore: offset + consumedCount < total,
    };
  }

  private async getDjRadioPlaylist(radioId: string, page: number, pageSize: number): Promise<StreamingPlaylistDetail> {
    const cookie = accountCookie();
    const offset = (page - 1) * pageSize;
    const [detailData, programData] = await Promise.all([
      this.fetchDjRadioDetail(radioId, cookie).catch(() => ({})),
      this.fetchDjRadioProgramPage(radioId, offset, pageSize, cookie),
    ]);
    const programRecord = asRecord(programData);
    const programDataRecord = asRecord(programRecord.data);
    const programs = (
      Array.isArray(programRecord.programs)
        ? programRecord.programs
        : Array.isArray(programDataRecord.programs)
          ? programDataRecord.programs
          : Array.isArray(programDataRecord.list)
            ? programDataRecord.list
            : Array.isArray(programRecord.list)
              ? programRecord.list
              : []
    ) as unknown[];
    const detailRecord = asRecord(detailData);
    const radioFromDetail = asRecord(detailRecord.data ?? detailRecord.djRadio ?? detailRecord.radio ?? detailRecord);
    const radioFromProgram = asRecord(asRecord(programs[0]).radio);
    const hasDetailRadio = Boolean(text(radioFromDetail.name) || radioFromDetail.id);
    const baseRadio = hasDetailRadio ? radioFromDetail : radioFromProgram;
    const radio: Record<string, unknown> = { ...baseRadio, id: neteaseIdText(baseRadio.id) ?? radioId };
    const total = integer(programRecord.count ?? programRecord.total ?? programDataRecord.count ?? programDataRecord.total ?? radio.programCount) ?? programs.length;
    const explicitMore = typeof programRecord.more === 'boolean' ? programRecord.more : typeof programDataRecord.more === 'boolean' ? programDataRecord.more : null;
    const tracks = programs.map((program) => mapDjProgramTrack(program, radio)).filter((track): track is StreamingTrack => Boolean(track));

    return {
      id: streamingStableKey(provider, `playlist:${neteaseDjRadioProviderPlaylistId(radioId)}`),
      provider,
      providerPlaylistId: neteaseDjRadioProviderPlaylistId(radioId),
      title: text(radio.name) ?? 'NetEase Podcast',
      description: text(radio.desc) ?? text(radio.description),
      creator: text(asRecord(radio.dj).nickname) ?? text(asRecord(radio.dj).userName) ?? text(asRecord(radio.dj).name),
      coverUrl: neteaseImageUrl(radio.picUrl ?? radio.intervenePicUrl ?? radio.coverUrl, 600),
      coverThumb: neteaseImageUrl(radio.picUrl ?? radio.intervenePicUrl ?? radio.coverUrl, 160),
      trackCount: total,
      tracks,
      page,
      pageSize,
      total,
      hasMore: explicitMore ?? (total ? offset + programs.length < total : programs.length === pageSize),
    };
  }

  private async fetchDjRadioDetail(radioId: string, cookie: string | undefined): Promise<Record<string, unknown>> {
    const ncm = getNcmApi();
    if (ncm?.dj_detail) {
      try {
        return asRecord((await ncm.dj_detail({ rid: radioId, ...(cookie ? { cookie } : {}) })).body);
      } catch {
        // Fall through to the public endpoint below.
      }
    }

    const params = new URLSearchParams({ id: radioId });
    return asRecord(
      await jsonFetch(`https://music.163.com/api/djradio/v2/get?${params.toString()}`, {
        headers: neteaseHeaders(cookie),
        timeoutMs: 12_000,
      }),
    );
  }

  private async fetchDjRadioProgramPage(radioId: string, offset: number, limit: number, cookie: string | undefined): Promise<Record<string, unknown>> {
    const ncm = getNcmApi();
    if (ncm?.dj_program) {
      try {
        return asRecord(
          (await ncm.dj_program({
            rid: radioId,
            limit,
            offset,
            asc: 'false',
            ...(cookie ? { cookie } : {}),
          })).body,
        );
      } catch {
        // Fall through to the public endpoint below.
      }
    }

    const params = new URLSearchParams({
      radioId,
      limit: String(limit),
      offset: String(offset),
      asc: 'false',
    });
    return asRecord(
      await jsonFetch(`https://music.163.com/api/dj/program/byradio?${params.toString()}`, {
        headers: neteaseHeaders(cookie),
        timeoutMs: 12_000,
      }),
    );
  }

  async getLikedSongsPlaylist(input: { page?: number; pageSize?: number } = {}): Promise<StreamingPlaylistDetail> {
    const cookie = accountCookie();
    if (!cookie) {
      throw new Error('请先登录网易云音乐账号。');
    }

    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 100)));
    const offset = (page - 1) * pageSize;
    const userId = await this.resolveUserId(cookie);
    const songIds = await this.fetchLikedSongIds(userId, cookie);
    const pageSongIds = songIds.slice(offset, offset + pageSize);
    const songs = await this.fetchSongs(pageSongIds);
    const tracks = songs.map((song) => mapSong(song));

    return {
      id: streamingStableKey(provider, 'playlist:liked-songs'),
      provider,
      providerPlaylistId: 'liked-songs',
      title: '网易云我喜欢',
      description: '从网易云音乐账号同步的我喜欢歌曲',
      creator: accountStatus().displayName ?? accountStatus().username ?? null,
      coverUrl: tracks[0]?.coverUrl ?? null,
      coverThumb: tracks[0]?.coverThumb ?? null,
      trackCount: songIds.length,
      tracks,
      page,
      pageSize,
      total: songIds.length,
      hasMore: offset + pageSongIds.length < songIds.length,
    };
  }

  async setTrackLiked(input: { providerTrackId: string; liked: boolean }): Promise<void> {
    const cookie = accountCookie();
    if (!cookie) {
      throw new Error('Please connect a NetEase Cloud Music account before liking tracks.');
    }

    const id = Number(input.providerTrackId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error('NetEase track id is invalid.');
    }

    const userId = await this.resolveUserId(cookie);
    const ncm = getNcmApi();
    let lastError: unknown = null;

    if (ncm?.song_like) {
      try {
        const response = await ncm.song_like({
          id,
          uid: userId,
          like: input.liked,
          cookie,
        });
        assertNeteaseWriteSuccess(response.body);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const params = new URLSearchParams({
        trackId: String(id),
        id: String(id),
        userid: userId,
        uid: userId,
        like: String(input.liked),
        csrf_token: cookieValue(cookie, '__csrf') ?? cookieValue(cookie, 'csrf') ?? '',
      });
      const response = await jsonFetch(`https://music.163.com/api/song/like?${params.toString()}`, {
        headers: neteaseHeaders(cookie),
        timeoutMs: 12_000,
      });
      assertNeteaseWriteSuccess(response);
      return;
    } catch (error) {
      lastError = error;
    }

    throw lastError instanceof Error ? lastError : new Error('NetEase like API is unavailable.');
  }

  async getDailyRecommendPlaylist(): Promise<StreamingPlaylistDetail> {
    const cookie = accountCookie();
    if (!cookie) {
      throw new Error('Please connect a NetEase Cloud Music account before loading daily recommendations.');
    }

    const ncm = getNcmApi();
    let body: unknown = null;
    if (ncm?.recommend_songs) {
      const response = await ncm.recommend_songs({ cookie });
      body = response.body;
    } else {
      body = await jsonFetch('https://music.163.com/api/v3/discovery/recommend/songs', {
        headers: neteaseHeaders(cookie),
        timeoutMs: 12_000,
      });
    }

    const songs = dailyRecommendSongs(body);
    if (songs.length === 0) {
      const data = asRecord(asRecord(body).data);
      const message = text(data.message) ?? text(asRecord(body).message) ?? text(asRecord(body).msg);
      throw new Error(message ?? 'NetEase daily recommendations returned no songs.');
    }

    const tracks = songs.map((song) => mapSong(song));

    return {
      id: streamingStableKey(provider, 'playlist:daily-recommend'),
      provider,
      providerPlaylistId: 'daily-recommend',
      title: '每日推荐',
      description: '根据网易云音乐账号生成，每天 6:00 更新。',
      creator: accountStatus().displayName ?? accountStatus().username ?? null,
      coverUrl: tracks[0]?.coverUrl ?? null,
      coverThumb: tracks[0]?.coverThumb ?? null,
      trackCount: songs.length,
      tracks,
      page: 1,
      pageSize: songs.length,
      total: songs.length,
      hasMore: false,
    };
  }

  private async findDetailCoverUrls(songIds: unknown[]): Promise<Map<string, string>> {
    const ids = songIds.map((id) => String(id)).filter(Boolean);
    if (ids.length === 0) {
      return new Map();
    }

    try {
      const params = new URLSearchParams({ id: ids[0], ids: JSON.stringify(ids) });
      const data = asRecord(await jsonFetch(`https://music.163.com/api/song/detail/?${params.toString()}`, { headers: neteaseHeaders(accountCookie()) }));
      const songs = Array.isArray(data.songs) ? data.songs : [];
      return new Map(
        songs
          .map((songValue): [string, string] | null => {
            const song = asRecord(songValue);
            const album = asRecord(song.album ?? song.al);
            const coverUrl = text(album.picUrl ?? album.blurPicUrl ?? album.pic);
            return coverUrl ? [String(song.id), coverUrl] : null;
          })
          .filter((entry): entry is [string, string] => Boolean(entry)),
      );
    } catch {
      return new Map();
    }
  }

  private async resolveUserId(cookie: string): Promise<string> {
    const ncm = getNcmApi();

    if (ncm?.login_status) {
      try {
        const userId = neteaseUserIdFromBody((await ncm.login_status({ cookie })).body);
        if (userId) {
          return userId;
        }
      } catch {
        // Try the older account endpoint below.
      }
    }

    if (ncm?.user_account) {
      try {
        const userId = neteaseUserIdFromBody((await ncm.user_account({ cookie })).body);
        if (userId) {
          return userId;
        }
      } catch {
        // Fall back to the public endpoint below.
      }
    }

    const accountUrls = ['https://music.163.com/api/w/nuser/account/get', 'https://music.163.com/api/nuser/account/get'];
    for (const url of accountUrls) {
      for (const method of ['GET', 'POST'] as const) {
        try {
          const userId = neteaseUserIdFromBody(
            await jsonFetch(url, {
              method,
              headers: neteaseHeaders(cookie),
              timeoutMs: 12_000,
            }),
          );
          if (userId) {
            return userId;
          }
        } catch {
          // Try the next account endpoint shape.
        }
      }
    }

    const status = accountStatus();
    const statusUserId = neteaseIdText(status.username) ?? neteaseIdText(status.displayName);
    if (statusUserId && /^\d+$/u.test(statusUserId)) {
      return statusUserId;
    }

    throw new Error('无法读取网易云账号 ID，请重新登录后再同步。');
  }

  private async fetchLikedSongIds(userId: string, cookie: string): Promise<string[]> {
    const ncm = getNcmApi();
    if (ncm?.likelist) {
      try {
        const response = await ncm.likelist({ uid: userId, cookie });
        const ids = collectNeteaseLikedIds(response.body);
        if (ids.length > 0) {
          return ids;
        }
      } catch {
        // Fall back to the public endpoint below.
      }
    }

    try {
      const params = new URLSearchParams({ uid: userId });
      const data = await jsonFetch(`https://music.163.com/api/song/like/get?${params.toString()}`, {
        headers: neteaseHeaders(cookie),
        timeoutMs: 12_000,
      });
      const ids = collectNeteaseLikedIds(data);
      if (ids.length > 0) {
        return ids;
      }
    } catch {
      // Fall back to the liked playlist below.
    }

    return this.fetchLikedPlaylistTrackIds(userId, cookie);
  }

  private async fetchLikedPlaylistTrackIds(userId: string, cookie: string): Promise<string[]> {
    const playlistId = await this.findLikedPlaylistId(userId, cookie);
    if (!playlistId) {
      return [];
    }

    const params = new URLSearchParams({ id: playlistId });
    const data = await jsonFetch(`https://music.163.com/api/v6/playlist/detail?${params.toString()}`, {
      headers: neteaseHeaders(cookie),
      timeoutMs: 12_000,
    });
    return neteasePlaylistTrackIds(data);
  }

  private async findLikedPlaylistId(userId: string, cookie: string): Promise<string | null> {
    const ncm = getNcmApi();
    const bodies: unknown[] = [];

    if (ncm?.user_playlist) {
      try {
        const body = (await ncm.user_playlist({ uid: userId, limit: 1000, offset: 0, cookie })).body;
        const playlistId = neteaseLikedPlaylistId(body);
        if (playlistId) {
          return playlistId;
        }

        bodies.push(body);
      } catch {
        // Fall back to the public endpoint below.
      }
    }

    try {
      const params = new URLSearchParams({ uid: userId, limit: '1000', offset: '0', includeVideo: 'true' });
      bodies.push(
        await jsonFetch(`https://music.163.com/api/user/playlist?${params.toString()}`, {
          headers: neteaseHeaders(cookie),
          timeoutMs: 12_000,
        }),
      );
    } catch {
      // The enhanced API may already have returned the playlist list.
    }

    for (const body of bodies) {
      const playlistId = neteaseLikedPlaylistId(body);
      if (playlistId) {
        return playlistId;
      }
    }

    return null;
  }

  private async fetchSongs(songIds: string[]): Promise<unknown[]> {
    if (songIds.length === 0) {
      return [];
    }

    const songs: unknown[] = [];
    for (let index = 0; index < songIds.length; index += neteaseSongDetailBatchSize) {
      const batchIds = songIds.slice(index, index + neteaseSongDetailBatchSize);
      const params = new URLSearchParams({ id: batchIds[0], ids: JSON.stringify(batchIds) });
      const data = asRecord(
        await jsonFetch(`https://music.163.com/api/song/detail/?${params.toString()}`, {
          headers: neteaseHeaders(accountCookie()),
          timeoutMs: 12_000,
        }),
      );
      if (Array.isArray(data.songs)) {
        songs.push(...data.songs);
      }
    }

    return songs;
  }

  private async fetchPlaylistTrackPage(playlistId: string, offset: number, limit: number, fallbackSongIds: string[]): Promise<unknown[]> {
    const ncm = getNcmApi();
    const cookie = accountCookie();
    if (ncm?.playlist_track_all) {
      try {
        const response = await ncm.playlist_track_all({
          id: playlistId,
          limit,
          offset,
          ...(cookie ? { cookie } : {}),
        });
        if (Array.isArray(response.body?.songs) && response.body.songs.length > 0) {
          return response.body.songs;
        }
      } catch {
        // Fall back to the public song detail endpoint below.
      }
    }

    return this.fetchSongs(fallbackSongIds);
  }

  async getLyrics(input: { providerTrackId: string }): Promise<StreamingLyricsResult> {
    const params = new URLSearchParams({ id: input.providerTrackId, lv: '1', kv: '1', tv: '1', rv: '1' });
    const data = asRecord(await jsonFetch(`https://music.163.com/api/song/lyric?${params.toString()}`, { headers: neteaseHeaders(accountCookie()) }));
    const lyricText = text(asRecord(data.lrc).lyric);
    const translationLyrics = text(asRecord(data.tlyric).lyric);
    const romanizationLyrics = text(asRecord(data.romalrc).lyric);
    const split = splitLyricsByKind(lyricText);
    const lines = linesFromLyrics(split.syncedLyrics, split.plainLyrics, translationLyrics, romanizationLyrics);
    const instrumental = data.nolyric === true || data.needDesc === true || (!split.syncedLyrics && !split.plainLyrics && Boolean(lyricText));

    return {
      provider,
      providerTrackId: input.providerTrackId,
      status: instrumental || split.syncedLyrics || split.plainLyrics || lines.length > 0 ? 'available' : 'missing',
      plainLyrics: split.plainLyrics,
      syncedLyrics: split.syncedLyrics,
      translationLyrics,
      romanizationLyrics,
      instrumental,
      lines,
      sourceLabel: '网易云音乐',
    };
  }

  async getMv(input: { providerTrackId: string }): Promise<StreamingMvResult> {
    const track = await this.getTrack(input);
    const params = new URLSearchParams({ id: input.providerTrackId, ids: JSON.stringify([input.providerTrackId]) });
    const data = asRecord(await jsonFetch(`https://music.163.com/api/song/detail/?${params.toString()}`, { headers: neteaseHeaders(accountCookie()) }));
    const song = asRecord((Array.isArray(data.songs) ? data.songs : [])[0]);
    const mvId = integer(song.mv ?? song.mvid);

    if (!mvId) {
      return { provider, providerTrackId: input.providerTrackId, status: 'missing', items: [] };
    }

    return {
      provider,
      providerTrackId: input.providerTrackId,
      status: 'available',
      items: [
        {
          id: streamingStableKey(provider, `mv:${mvId}`),
          provider,
          providerMvId: String(mvId),
          providerTrackId: input.providerTrackId,
          title: `${track.title} MV`,
          artist: track.artist,
          duration: track.duration,
          thumbnailUrl: track.coverThumb,
        },
      ],
    };
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const cookie = accountCookie();
    const csrfToken = cookieValue(cookie, '__csrf') ?? cookieValue(cookie, 'csrf') ?? '';
    const candidates = neteaseQualityLevels[request.quality ?? 'fallback'] ?? neteaseQualityLevels.fallback;
    let lastSource: Record<string, unknown> = {};
    const attemptedLevels: string[] = [];

    for (const candidate of candidates) {
      attemptedLevels.push(candidate.level);
      const ncmSource = await resolveWithNcmApi(request, candidate, cookie);
      if (ncmSource) {
        return toPlaybackSource(request, ncmSource, candidate, cookie);
      }

      const params = new URLSearchParams({
        ids: JSON.stringify([request.providerTrackId]),
        level: candidate.level,
        br: String(candidate.bitrate),
        encodeType: candidate.quality === 'flac' ? 'flac' : 'mp3',
        csrf_token: csrfToken,
        os: 'pc',
      });
      const data = asRecord(
        await jsonFetch(`https://music.163.com/api/song/enhance/player/url/v1?${params.toString()}`, {
          headers: neteaseHeaders(cookie),
          timeoutMs: neteasePlaybackJsonTimeoutMs,
        }).catch(() =>
          jsonFetch(`https://music.163.com/api/song/enhance/player/url?${params.toString()}`, {
            headers: neteaseHeaders(cookie),
            timeoutMs: neteasePlaybackJsonTimeoutMs,
          }),
        ),
      );
      const source = asRecord((Array.isArray(data.data) ? data.data : [])[0]);
      lastSource = source;
      const url = text(source.url);
      if (url) {
        return toPlaybackSource(
          request,
          {
            url,
            type: text(source.type)?.toLocaleLowerCase() ?? candidate.quality,
            br: integer(source.br) ?? candidate.bitrate,
            level: text(source.level) ?? candidate.level,
          },
          candidate,
          cookie,
        );
      }
    }

    const message = text(lastSource.message) ?? text(lastSource.msg) ?? null;
    const code = integer(lastSource.code);
    throw new Error(message ?? `这首歌暂时不可播放，已尝试 ${attemptedLevels.join(' / ')} 音质${code ? `（网易返回 ${code}）` : ''}`);
  }
}
