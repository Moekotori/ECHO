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
import { asRecord, integer, jsonFetch, linesFromLyrics, maybeDecodeBase64, number, splitLyricsByKind, streamingImageProxyUrl, text } from './chinaStreamingUtils';

const provider = 'qqmusic' as const;
const qqReferer = 'https://y.qq.com/';
const qqLegacyApiReferer = 'https://c.y.qq.com/';

const qqHeaders = (cookie?: string): Record<string, string> => ({
  Referer: qqReferer,
  Origin: 'https://y.qq.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ...(cookie ? { Cookie: cookie } : {}),
});

const parseJsonText = (raw: string): unknown => JSON.parse(raw.trim().replace(/^[^(]*\((.*)\);?$/s, '$1')) as unknown;

const fetchJsonWithRawReferer = async (url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        ...headers,
      },
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    return parseJsonText(await response.text());
  } finally {
    clearTimeout(timer);
  }
};

const isInvalidRefererResponse = (value: unknown): boolean => {
  const body = asRecord(value);
  return /invalid referer/iu.test(text(body.message) ?? text(body.msg) ?? '');
};

const accountStatus = (): AccountStatus => getAccountService().getStatus(provider);

const accountCookie = (): string | undefined => getAccountService().getCredentials(provider).cookie?.trim() || undefined;

const cookieValue = (cookie: string | undefined, ...names: string[]): string | null => {
  if (!cookie) {
    return null;
  }

  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'iu'));
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return null;
};

const uinFromCookie = (cookie?: string): string => {
  const value = cookieValue(cookie, 'uin', 'qqmusic_uin', 'p_uin', 'pt2gguin', 'loginUin', 'wxuin');
  const match = value?.match(/o?(\d+)/iu);
  return match?.[1] ?? '0';
};

const hasQqPlaybackCredential = (cookie?: string): boolean =>
  Boolean(cookieValue(cookie, 'qqmusic_key', 'qm_keyst', 'music_key', 'p_skey', 'skey'));

const hasConnectedQqPlaybackAccount = (): boolean => {
  const status = accountStatus();
  const cookie = accountCookie();
  return status.connected && uinFromCookie(cookie) !== '0' && hasQqPlaybackCredential(cookie);
};

const stableNumericId = (value: string): string => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return String(100000000 + (hash >>> 0) % 900000000);
};

const qqGuidFromCookie = (cookie: string | undefined, uin: string): string =>
  cookieValue(cookie, 'pgv_pvid', 'qqmusic_guid', 'guid')?.replace(/\D/gu, '') || stableNumericId(uin !== '0' ? uin : cookie ?? 'qqmusic');

const qqGtkFromCookie = (cookie: string | undefined): number => {
  const skey = cookieValue(cookie, 'qqmusic_key', 'qm_keyst', 'music_key', 'p_skey', 'skey') ?? '';
  let hash = 5381;
  for (const char of skey) {
    hash += (hash << 5) + char.charCodeAt(0);
  }

  return hash & 0x7fffffff;
};

const qqIdText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return text(value);
};

const firstQqText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = qqIdText(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const qqSongIdKeys = [
  'providerTrackId',
  'mid',
  'songmid',
  'songMid',
  'songMID',
  'song_mid',
  'strMediaMid',
  'mediaMid',
  'media_mid',
  'id',
  'songid',
  'songId',
  'songID',
] as const;
const qqSongNameKeys = ['name', 'title', 'songname', 'songName', 'songorig', 'songOrig'] as const;
const qqSongWrapperKeys = ['data', 'songInfo', 'songinfo', 'song', 'songData', 'musicData', 'track', 'info'] as const;
const qqPlaylistTitleKeys = ['dissname', 'dirName', 'dirname', 'dir_name', 'name', 'title', 'titleName'] as const;
const qqPlaylistIdKeys = ['dissid', 'disstid', 'dissId', 'tid', 'dirid', 'dirId', 'dirID', 'dir_id', 'playlistId', 'id'] as const;
const qqArtistIdKeys = ['mid', 'singerMID', 'singerMid', 'singermid', 'singer_mid', 'pmid', 'singer_id', 'singerid', 'singerId', 'id'] as const;
const qqArtistNameKeys = ['name', 'singerName', 'singername', 'singer_name', 'singerTitle', 'singer_title', 'title'] as const;

const unwrapQqSongRecord = (value: unknown): Record<string, unknown> => {
  let record = asRecord(value);
  for (let index = 0; index < 5; index += 1) {
    const nested = qqSongWrapperKeys.map((key) => asRecord(record[key])).find((candidate) => Object.keys(candidate).length > 0);
    if (!nested) {
      break;
    }

    record = { ...record, ...nested };
  }

  return record;
};

const isQqSongRecord = (value: unknown): boolean => {
  const song = unwrapQqSongRecord(value);
  const hasId = Boolean(firstQqText(song, qqSongIdKeys));
  const hasName = Boolean(firstQqText(song, qqSongNameKeys));
  const hasSongSignal = [
    'songmid',
    'songMid',
    'songMID',
    'songid',
    'songId',
    'songID',
    'albummid',
    'albumMID',
    'interval',
    'duration',
    'singer',
    'singers',
    'songname',
    'songName',
    'file',
  ].some((key) => song[key] !== undefined && song[key] !== null);
  return hasId && (hasName || hasSongSignal) && hasSongSignal;
};

const uniqueQqSongs = (songs: unknown[]): unknown[] => {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const songValue of songs) {
    const song = unwrapQqSongRecord(songValue);
    const key = firstQqText(song, qqSongIdKeys) ?? JSON.stringify(song);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(songValue);
  }

  return result;
};

const collectQqSongs = (value: unknown, depth = 0): unknown[] => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return uniqueQqSongs(
      value.flatMap((item) => {
        if (isQqSongRecord(item)) {
          return [item];
        }

        return collectQqSongs(item, depth + 1);
      }),
    );
  }

  if (isQqSongRecord(value)) {
    return [value];
  }

  return uniqueQqSongs(Object.values(asRecord(value)).flatMap((item) => collectQqSongs(item, depth + 1)));
};

const qqSongTotal = (value: unknown, depth = 0): number | null => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return null;
  }

  const record = asRecord(value);
  for (const key of ['totalsong', 'totalSong', 'total_song_num', 'totalnum', 'songnum', 'songCount', 'total']) {
    const total = integer(record[key]);
    if (total !== null) {
      return total;
    }
  }

  for (const item of Object.values(record)) {
    const total = qqSongTotal(item, depth + 1);
    if (total !== null) {
      return total;
    }
  }

  return null;
};

const qqPlaylistTitle = (record: Record<string, unknown>): string | null => firstQqText(record, qqPlaylistTitleKeys);

const qqPlaylistId = (record: Record<string, unknown>): string | null => firstQqText(record, qqPlaylistIdKeys);

const findPlaylistRecords = (value: unknown, depth = 0): Record<string, unknown>[] => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => findPlaylistRecords(item, depth + 1));
  }

  const record = asRecord(value);
  const title = qqPlaylistTitle(record);
  const id = qqPlaylistId(record);
  const current = title && id ? [record] : [];

  return [...current, ...Object.values(record).flatMap((item) => findPlaylistRecords(item, depth + 1))];
};

const findQqLikedPlaylistFallbackId = (value: unknown, depth = 0): string | null => {
  if (depth > 8 || !value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findQqLikedPlaylistFallbackId(item, depth + 1);
      if (id) {
        return id;
      }
    }

    return null;
  }

  const record = asRecord(value);
  for (const [key, item] of Object.entries(record)) {
    if (/^my_?music(?:id)?$/iu.test(key) || /^mymusic(?:id)?$/iu.test(key)) {
      const direct = qqIdText(item);
      if (direct) {
        return direct;
      }

      const nestedId = qqPlaylistId(asRecord(item));
      if (nestedId) {
        return nestedId;
      }
    }
  }

  for (const item of Object.values(record)) {
    const id = findQqLikedPlaylistFallbackId(item, depth + 1);
    if (id) {
      return id;
    }
  }

  return null;
};

const assertQqWriteSuccess = (value: unknown, fallback: string): void => {
  const body = asRecord(value);
  const rawCode = body.code ?? body.retcode ?? body.result;
  const code = rawCode === undefined || rawCode === null || rawCode === '' ? null : Number(rawCode);
  if (code !== null && Number.isFinite(code) && code !== 0) {
    throw new Error(text(body.message) ?? text(body.msg) ?? `${fallback} (${code})`);
  }
};

const songIdFromSong = (songValue: unknown): string | null => {
  const song = unwrapQqSongRecord(songValue);
  return firstQqText(song, ['id', 'songid', 'songId', 'songID']);
};

const songMidFromSong = (songValue: unknown): string | null => {
  const song = unwrapQqSongRecord(songValue);
  const file = asRecord(song.file);
  return (
    firstQqText(song, ['mid', 'songmid', 'songMid', 'songMID', 'song_mid', 'strMediaMid', 'mediaMid', 'media_mid']) ??
    text(file.media_mid) ??
    text(file.mediaMid) ??
    text(file.strMediaMid)
  );
};

const albumCoverUrl = (albumMid: string | null, size = 300): string | null =>
  albumMid
    ? streamingImageProxyUrl(`https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`, qqReferer)
    : null;

const artistRefs = (singersValue: unknown): StreamingArtistRef[] => {
  const singers = Array.isArray(singersValue) ? singersValue.map(asRecord) : [];
  return singers
    .map((singer): StreamingArtistRef | null => {
      const name = firstQqText(singer, qqArtistNameKeys);
      const id = firstQqText(singer, qqArtistIdKeys) ?? name ?? '';
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

const mapSong = (songValue: unknown): StreamingTrack => {
  const song = unwrapQqSongRecord(songValue);
  const album = asRecord(song.album ?? song.albumInfo ?? song.albuminfo);
  const file = asRecord(song.file);
  const artists = artistRefs(song.singer ?? song.singers ?? song.singerList ?? song.singer_list);
  const mid = songMidFromSong(song) ?? songIdFromSong(song) ?? firstQqText(song, qqSongIdKeys) ?? '';
  const title = firstQqText(song, qqSongNameKeys) ?? 'Untitled';
  const artist =
    artists.map((item) => item.name).join(' / ') || text(song.singername) || text(song.singerName) || text(song.artist) || 'Unknown Artist';
  const albumTitle =
    text(album.name) ?? text(album.title) ?? text(album.albumName) ?? text(album.albumname) ?? text(song.albumname) ?? text(song.albumtitle) ?? 'Unknown Album';
  const albumMid =
    text(album.mid) ??
    text(album.pmid) ??
    text(album.albumMID) ??
    text(album.albumMid) ??
    text(song.albummid) ??
    text(song.album_mid) ??
    text(song.albumMID);
  const pay = asRecord(song.pay);
  const action = asRecord(song.action);
  const payPlay = integer(pay.pay_play ?? pay.payplay ?? pay.payPlay ?? song.pay_play ?? song.payplay ?? song.payPlay);
  const msgPay = integer(action.msgpay ?? action.msgPay ?? song.msgpay ?? song.msgPay);
  const paidPlaybackRequired = payPlay === 1 || Boolean(msgPay && msgPay > 0);
  const hasPlaybackAccount = hasConnectedQqPlaybackAccount();
  const disabled = song.disabled === true || song.disabled === 1 || song.disabled === '1';
  const playable = !disabled && (!paidPlaybackRequired || hasPlaybackAccount);

  return {
    id: streamingStableKey(provider, mid || title),
    provider,
    providerTrackId: mid || title,
    stableKey: streamingStableKey(provider, mid || title),
    title,
    artist,
    artists,
    album: albumTitle,
    albumId: albumMid ?? (album.id == null ? null : String(album.id)),
    albumArtist: artist,
    duration: number(song.interval ?? song.duration),
    coverUrl: albumCoverUrl(albumMid, 500),
    coverThumb: albumCoverUrl(albumMid, 150),
    qualities: paidPlaybackRequired && !hasPlaybackAccount ? ['standard'] : ['standard', 'high', 'lossless'],
    explicit: false,
    playable,
    unavailableReason: playable ? null : '需要 QQ 音乐会员或当前版权不可播放。',
    lyricsStatus: 'available',
    mvStatus: text(asRecord(song.mv).vid) ? 'available' : 'unknown',
  };
};

const qualityPrefix = (quality: StreamingPlaybackRequest['quality']): { prefix: string; extension: string; codec: string; mimeType: string; bitrate: number } => {
  if (quality === 'lossless' || quality === 'hires') {
    return { prefix: 'F000', extension: 'flac', codec: 'flac', mimeType: 'audio/flac', bitrate: 999000 };
  }
  if (quality === 'standard') {
    return { prefix: 'M500', extension: 'mp3', codec: 'mp3', mimeType: 'audio/mpeg', bitrate: 128000 };
  }

  return { prefix: 'M800', extension: 'mp3', codec: 'mp3', mimeType: 'audio/mpeg', bitrate: 320000 };
};

const mapAlbum = (albumValue: unknown): StreamingAlbum => {
  const album = asRecord(albumValue);
  const albumMid = text(album.albumMID) ?? text(album.album_mid) ?? text(album.mid) ?? text(album.albumid);
  const title = text(album.albumName) ?? text(album.albumname) ?? text(album.name) ?? 'Unknown Album';
  const singerList = album.singer_list ?? album.singer ?? album.singers;
  const artists = artistRefs(singerList);
  const artist = artists.map((item) => item.name).join(' / ') || text(album.singerName) || text(album.singername) || 'Unknown Artist';

  return {
    id: streamingStableKey(provider, `album:${albumMid || title}`),
    provider,
    providerAlbumId: albumMid || title,
    title,
    artist,
    artists,
    coverUrl: albumCoverUrl(albumMid, 500),
    coverThumb: albumCoverUrl(albumMid, 150),
    releaseDate: text(album.publicTime) ?? text(album.publishDate) ?? text(album.pub_time),
    trackCount: integer(album.song_count ?? album.songCount ?? album.total),
  };
};

const mapArtist = (artistValue: unknown): StreamingArtist => {
  const artist = asRecord(artistValue);
  const artistMid = firstQqText(artist, qqArtistIdKeys);
  const name = firstQqText(artist, qqArtistNameKeys) ?? 'Unknown Artist';
  const avatar = text(artist.singerPic) ?? text(artist.pic) ?? (artistMid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${artistMid}.jpg` : null);

  return {
    id: streamingStableKey(provider, `artist:${artistMid || name}`),
    provider,
    providerArtistId: artistMid || name,
    name,
    avatarUrl: avatar ? streamingImageProxyUrl(avatar, qqReferer) : null,
    coverUrl: avatar ? streamingImageProxyUrl(avatar, qqReferer) : null,
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

const normalizeArtistLookupText = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

const artistMatchesLookup = (artist: StreamingArtistRef | StreamingArtist, lookup: string): boolean => {
  const normalizedLookup = normalizeArtistLookupText(lookup);
  if (!normalizedLookup) {
    return false;
  }

  return (
    normalizeArtistLookupText(artist.providerArtistId) === normalizedLookup ||
    normalizeArtistLookupText(artist.name) === normalizedLookup
  );
};

const isInformativeArtistName = (value: string | null | undefined, providerArtistId: string): value is string => {
  const candidate = value?.trim();
  if (!candidate || candidate === 'Unknown Artist') {
    return false;
  }

  return normalizeArtistLookupText(candidate) !== normalizeArtistLookupText(providerArtistId);
};

const firstInformativeArtistName = (providerArtistId: string, candidates: Array<string | null | undefined>): string | null =>
  candidates.find((candidate): candidate is string => isInformativeArtistName(candidate, providerArtistId)) ?? null;

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

const albumsFromTracks = (tracks: StreamingTrack[]): StreamingAlbum[] => {
  const albums = new Map<string, StreamingAlbum>();
  for (const track of tracks) {
    const providerAlbumId = track.albumId ?? track.album;
    if (!providerAlbumId || !track.album || albums.has(providerAlbumId)) {
      continue;
    }

    albums.set(providerAlbumId, {
      id: streamingStableKey(provider, `album:${providerAlbumId}`),
      provider,
      providerAlbumId,
      title: track.album,
      artist: track.albumArtist ?? track.artist,
      artists: track.artists,
      coverUrl: track.coverUrl,
      coverThumb: track.coverThumb,
      releaseDate: null,
      trackCount: null,
    });
  }

  return [...albums.values()];
};

const mapPlaylist = (playlistValue: unknown): StreamingPlaylist => {
  const playlist = asRecord(playlistValue);
  const providerPlaylistId = text(playlist.dissid) ?? text(playlist.disstid) ?? text(playlist.id) ?? text(playlist.tid) ?? text(playlist.dirid) ?? text(playlist.name) ?? 'playlist';
  const title = text(playlist.dissname) ?? text(playlist.dirName) ?? text(playlist.name) ?? text(playlist.title) ?? 'QQ Music Playlist';
  const rawCover = text(playlist.imgurl) ?? text(playlist.logo) ?? text(playlist.picurl) ?? text(playlist.cover_url) ?? text(playlist.coverUrl);

  return {
    id: streamingStableKey(provider, `playlist:${providerPlaylistId}`),
    provider,
    providerPlaylistId,
    title,
    description: text(playlist.introduction) ?? text(playlist.desc) ?? text(playlist.description),
    creator: text(playlist.creator) ?? text(playlist.nickname) ?? text(playlist.username) ?? text(playlist.dissCreator),
    coverUrl: rawCover ? streamingImageProxyUrl(rawCover, qqReferer) : null,
    coverThumb: rawCover ? streamingImageProxyUrl(rawCover, qqReferer) : null,
    trackCount: integer(playlist.song_count ?? playlist.songCount ?? playlist.songnum ?? playlist.total_song_num),
  };
};

const qqSearchType = (request: StreamingSearchRequest): number => {
  const mediaType = request.mediaTypes?.[0] ?? 'track';
  if (mediaType === 'album') {
    return 8;
  }
  if (mediaType === 'artist') {
    return 9;
  }
  if (mediaType === 'playlist') {
    return 3;
  }
  return 0;
};

type QqPlaybackQuality = NonNullable<StreamingPlaybackRequest['quality']>;
type QqVkeyResult = {
  item: Record<string, unknown>;
  payload: Record<string, unknown>;
};

type QqPlaybackEndpoint = {
  module: string;
  method: string;
  modern: boolean;
  platforms: readonly (string | null)[];
};

const qqPlaybackQualityFallbacks: Record<QqPlaybackQuality | 'fallback', QqPlaybackQuality[]> = {
  hires: ['lossless', 'high', 'standard'],
  lossless: ['lossless', 'high', 'standard'],
  high: ['high', 'standard'],
  standard: ['standard'],
  fallback: ['lossless', 'high', 'standard'],
};

const qqPlaybackPlatforms = ['20', 'yqq'] as const;
const qqPlaybackEndpoints: readonly QqPlaybackEndpoint[] = [
  { module: 'music.vkey.GetVkey', method: 'UrlGetVkey', modern: true, platforms: [null] },
  { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', modern: false, platforms: qqPlaybackPlatforms },
];

const qqPlaybackFilenames = (
  selectedQuality: ReturnType<typeof qualityPrefix>,
  mediaMid: string | null,
  providerTrackId: string,
): string[] => {
  const primaryId = mediaMid ?? providerTrackId;
  const candidates = [`${selectedQuality.prefix}${primaryId}.${selectedQuality.extension}`];
  if (!mediaMid) {
    candidates.push(`${selectedQuality.prefix}${providerTrackId}${providerTrackId}.${selectedQuality.extension}`);
  }

  return [...new Set(candidates)];
};

const qqPlaybackFailureMessage = (lastResult: QqVkeyResult | null): string => {
  const requestCode = Number(lastResult?.payload.code);
  const rawResult = lastResult?.item.result ?? lastResult?.payload.result ?? lastResult?.payload.code;
  const result = Number(rawResult);
  const returnedUin = text(lastResult?.payload.uin);
  const loginKey = text(lastResult?.payload.login_key);
  if (result === 104003 && !hasConnectedQqPlaybackAccount()) {
    return '这首 QQ 音乐需要登录对应账号或会员权限才能播放；搜索、元数据和歌词仍可继续使用。';
  }
  if (requestCode === 1000 || (result === 104003 && !returnedUin && !loginKey)) {
    return 'QQ 音乐登录凭证已过期，当前 Cookie 已不能换取会员播放地址。请在设置里重新登录 QQ 音乐后再试。';
  }
  if (result === 104003) {
    return 'QQ 音乐返回无播放权限（104003）。请确认当前登录的是已开通会员的 QQ 音乐账号，并在设置里重新登录 QQ 音乐后再试。';
  }
  if (result === 104013) {
    return 'QQ 音乐限制当前设备播放（104013）。请稍后重试，或在设置里重新登录 QQ 音乐后再试。';
  }

  const message = text(lastResult?.item.msg) ?? text(lastResult?.item.message) ?? text(lastResult?.payload.msg) ?? text(lastResult?.payload.message);
  if (message && !/^\d{1,3}(?:\.\d{1,3}){3};/u.test(message)) {
    return message;
  }
  if (Number.isFinite(result) && result > 0) {
    return `QQ 音乐暂时没有返回播放地址（${result}）。若你已开通会员，请在设置里重新登录 QQ 音乐后再试。`;
  }

  return '这首歌暂时不可播放。若你已开通 QQ 音乐会员，请在设置里重新登录 QQ 音乐后再试。';
};

export class QQMusicStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = accountStatus();
    return {
      displayName: 'QQ 音乐',
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
      statusMessage: status.connected
        ? 'QQ Music account connected'
        : '公开搜索、歌词和元数据可用。登录后可播放会员内容并下载歌曲。',
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
    const searchType = qqSearchType(request);
    const body = {
      comm: {
        ct: '19',
        cv: '1859',
        uin: uinFromCookie(accountCookie()),
      },
      req_1: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          query: request.query,
          page_num: page,
          num_per_page: pageSize,
          search_type: searchType,
        },
      },
    };
    const data = asRecord(
      await jsonFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: qqHeaders(accountCookie()),
        body,
      }),
    );
    const payload = asRecord(asRecord(data.req_1).data);
    const bodyData = asRecord(payload.body);
    const songData = asRecord(bodyData.song);
    const albumData = asRecord(bodyData.album);
    const singerData = asRecord(bodyData.singer);
    const playlistData = asRecord(bodyData.songlist ?? bodyData.playlist ?? bodyData.mv);
    const meta = asRecord(payload.meta);
    const songs = Array.isArray(songData.list) ? songData.list : [];
    const albums = Array.isArray(albumData.list) ? albumData.list : [];
    const artists = Array.isArray(singerData.list) ? singerData.list : [];
    const playlistRecords = Array.isArray(playlistData.list)
      ? playlistData.list
      : Array.isArray(playlistData.itemlist)
        ? playlistData.itemlist
        : searchType === 3
          ? findPlaylistRecords(bodyData)
          : [];
    const total =
      searchType === 8
        ? integer(albumData.totalnum ?? albumData.total ?? meta.sum ?? meta.estimate_sum)
        : searchType === 9
          ? integer(singerData.totalnum ?? singerData.total ?? meta.sum ?? meta.estimate_sum)
          : searchType === 3
            ? integer(playlistData.totalnum ?? playlistData.total ?? meta.sum ?? meta.estimate_sum)
          : integer(songData.totalnum ?? songData.total ?? meta.sum ?? meta.estimate_sum);

    return {
      provider,
      query: request.query,
      page,
      pageSize,
      total,
      hasMore: total ? page * pageSize < total : Math.max(songs.length, albums.length, artists.length, playlistRecords.length) === pageSize,
      tracks: songs.map(mapSong),
      albums: albums.map(mapAlbum),
      artists: artists.map(mapArtist),
      playlists: playlistRecords.map(mapPlaylist),
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const song = await this.fetchSong(input.providerTrackId);
    return mapSong(song);
  }

  private async fetchArtistDetail(providerArtistId: string, cookie: string | undefined): Promise<StreamingArtistDetail> {
    const [tracksResult, albumsResult] = await Promise.allSettled([
      jsonFetch(
        `https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_track_cp.fcg?${new URLSearchParams({
          singermid: providerArtistId,
          begin: '0',
          num: '30',
          order: 'listen',
          format: 'json',
        }).toString()}`,
        { headers: qqHeaders(cookie) },
      ),
      jsonFetch(
        `https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_album.fcg?${new URLSearchParams({
          singermid: providerArtistId,
          begin: '0',
          num: '24',
          format: 'json',
        }).toString()}`,
        { headers: qqHeaders(cookie) },
      ),
    ]);
    if (tracksResult.status === 'rejected' && albumsResult.status === 'rejected') {
      throw tracksResult.reason instanceof Error ? tracksResult.reason : albumsResult.reason;
    }

    const tracksData = tracksResult.status === 'fulfilled' ? tracksResult.value : {};
    const albumsData = albumsResult.status === 'fulfilled' ? albumsResult.value : {};
    const tracksRoot = asRecord(asRecord(tracksData).data ?? tracksData);
    const albumsRoot = asRecord(asRecord(albumsData).data ?? albumsData);
    const singer = asRecord(tracksRoot.singer ?? albumsRoot.singer);
    const topTracks = (Array.isArray(tracksRoot.list) ? tracksRoot.list : [])
      .map((item) => asRecord(item).musicData ?? item)
      .map(mapSong);
    const albums = (Array.isArray(albumsRoot.list) ? albumsRoot.list : [])
      .map((item) => asRecord(item).album ?? item)
      .map(mapAlbum);
    const trackArtistRefs = topTracks.flatMap((track) => track.artists);
    const albumArtistRefs = albums.flatMap((album) => album.artists);
    const matchingTrackArtist = trackArtistRefs.find((artistRef) => artistMatchesLookup(artistRef, providerArtistId));
    const matchingAlbumArtist = albumArtistRefs.find((artistRef) => artistMatchesLookup(artistRef, providerArtistId));
    const detailArtistName =
      firstInformativeArtistName(providerArtistId, [
        firstQqText(singer, qqArtistNameKeys),
        firstQqText(tracksRoot, qqArtistNameKeys),
        firstQqText(albumsRoot, qqArtistNameKeys),
        matchingTrackArtist?.name,
        matchingAlbumArtist?.name,
        trackArtistRefs[0]?.name,
        albums[0]?.artist,
      ]) ??
      firstQqText(singer, qqArtistNameKeys) ??
      providerArtistId;
    const artist = mapArtist({
      ...singer,
      singerMID: firstQqText(singer, qqArtistIdKeys) ?? providerArtistId,
      singerName: detailArtistName,
    });

    return {
      ...artist,
      topTracks,
      albums,
    };
  }

  private async fetchArtistDetailFromTrackSearch(providerArtistId: string, preferredName?: string): Promise<StreamingArtistDetail | null> {
    const queries = [preferredName, providerArtistId].filter((query): query is string => Boolean(query?.trim()));
    const uniqueQueries = [...new Set(queries)];

    for (const query of uniqueQueries) {
      const searchResult = await this.search({ provider, query, mediaTypes: ['track'], page: 1, pageSize: 30 });
      if (searchResult.tracks.length === 0) {
        continue;
      }

      const matchingTracks = searchResult.tracks.filter((track) =>
        track.artists.some(
          (artist) => artistMatchesLookup(artist, providerArtistId) || Boolean(preferredName && artistMatchesLookup(artist, preferredName)),
        ),
      );
      const topTracks = matchingTracks.length > 0 ? matchingTracks : searchResult.tracks;
      const artistRef =
        topTracks
          .flatMap((track) => track.artists)
          .find((artist) => artistMatchesLookup(artist, providerArtistId) || Boolean(preferredName && artistMatchesLookup(artist, preferredName))) ??
        topTracks[0]?.artists[0] ?? {
          id: streamingStableKey(provider, `artist:${providerArtistId}`),
          provider,
          providerArtistId,
          name: preferredName ?? providerArtistId,
        };

      return {
        ...artistFromRef(artistRef),
        topTracks,
        albums: albumsFromTracks(topTracks),
      };
    }

    return null;
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    const params = new URLSearchParams({
      albummid: input.providerAlbumId,
      format: 'json',
      newsong: '1',
    });
    const data = asRecord(
      await jsonFetch(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?${params.toString()}`, {
        headers: qqHeaders(accountCookie()),
      }),
    );
    const albumValue = asRecord(data.data ?? data);
    const songs = Array.isArray(albumValue.list) ? albumValue.list : Array.isArray(albumValue.songlist) ? albumValue.songlist : [];
    const album = mapAlbum({
      ...albumValue,
      albumMID: text(albumValue.mid) ?? text(albumValue.albumMID) ?? input.providerAlbumId,
      albumName: text(albumValue.name) ?? text(albumValue.albumName),
      singerName: text(albumValue.singername) ?? text(albumValue.singerName),
      publicTime: text(albumValue.aDate) ?? text(albumValue.publicTime),
      song_count: integer(albumValue.total) ?? integer(albumValue.total_song_num) ?? songs.length,
    });

    if (!album.providerAlbumId && songs.length === 0) {
      throw new Error('没有找到这张 QQ 音乐专辑');
    }

    return {
      ...album,
      tracks: songs.map(mapSong),
    };
  }

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    const cookie = accountCookie();
    let lastError: unknown = null;

    try {
      return await this.fetchArtistDetail(input.providerArtistId, cookie);
    } catch (error) {
      lastError = error;
    }

    let replacements: StreamingArtist[] = [];
    try {
      const searchResult = await this.searchOnce({ provider, query: input.providerArtistId, mediaTypes: ['artist'], page: 1, pageSize: 5 });
      replacements = [
        ...searchResult.artists.filter((artist) => artist.providerArtistId !== input.providerArtistId),
        ...searchResult.artists.filter((artist) => artist.providerArtistId === input.providerArtistId),
      ];
    } catch (error) {
      lastError = error;
    }

    for (const replacement of replacements) {
      try {
        return await this.fetchArtistDetail(replacement.providerArtistId, cookie);
      } catch (error) {
        lastError = error;
      }

      const fallback = await this.fetchArtistDetailFromTrackSearch(replacement.providerArtistId, replacement.name);
      if (fallback) {
        return fallback;
      }
    }

    const fallback = await this.fetchArtistDetailFromTrackSearch(input.providerArtistId);
    if (fallback) {
      return fallback;
    }

    throw lastError instanceof Error ? lastError : new Error('没有找到这个 QQ 音乐艺人');
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 100)));
    const begin = (page - 1) * pageSize;
    const params = new URLSearchParams({
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: input.providerPlaylistId,
      format: 'json',
      g_tk: '5381',
      loginUin: uinFromCookie(accountCookie()),
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      song_begin: String(begin),
      song_num: String(pageSize),
    });
    const playlistDetailUrl = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${params.toString()}`;
    const playlistDetailHeaders = {
      ...qqHeaders(accountCookie()),
      Referer: qqLegacyApiReferer,
    };
    let data = asRecord(
      await jsonFetch(playlistDetailUrl, {
        headers: {
          ...playlistDetailHeaders,
        },
        timeoutMs: 12_000,
      }),
    );
    if (isInvalidRefererResponse(data)) {
      data = asRecord(await fetchJsonWithRawReferer(playlistDetailUrl, playlistDetailHeaders, 12_000));
    }
    const cd = asRecord((Array.isArray(data.cdlist) ? data.cdlist : [])[0]);
    if (Object.keys(cd).length === 0) {
      throw new Error(text(data.message) ?? text(data.msg) ?? 'QQ Music playlist detail is empty.');
    }
    const songlist = Array.isArray(cd.songlist) ? cd.songlist : [];
    const total = integer(cd.total_song_num ?? cd.songnum) ?? songlist.length;
    if (page === 1 && total > 0 && songlist.length === 0) {
      throw new Error('QQ Music playlist detail returned an empty song list.');
    }
    const logo = text(cd.logo) ?? text(cd.picurl);
    const coverUrl = logo ? streamingImageProxyUrl(logo, qqReferer) : null;

    return {
      id: streamingStableKey(provider, `playlist:${input.providerPlaylistId}`),
      provider,
      providerPlaylistId: input.providerPlaylistId,
      title: text(cd.dissname) ?? 'QQ Music Playlist',
      description: 'Liked songs synced from the QQ Music account',
      creator: text(asRecord(cd.headurl).nick) ?? text(cd.nickname),
      coverUrl,
      coverThumb: coverUrl,
      trackCount: total,
      tracks: songlist.map(mapSong),
      page,
      pageSize,
      total,
      hasMore: begin + songlist.length < total,
    };
  }

  async getLyrics(input: { providerTrackId: string }): Promise<StreamingLyricsResult> {
    const primaryResult = await this.fetchLyricsBySongMid(input.providerTrackId, input.providerTrackId);
    if (this.hasLyricsContent(primaryResult)) {
      return primaryResult;
    }

    const song = await this.fetchSong(input.providerTrackId).catch(() => null);
    const normalizedSongMid = song ? songMidFromSong(song) : null;
    if (normalizedSongMid && normalizedSongMid !== input.providerTrackId) {
      const retryResult = await this.fetchLyricsBySongMid(normalizedSongMid, input.providerTrackId);
      if (this.hasLyricsContent(retryResult)) {
        return retryResult;
      }
    }

    return primaryResult;
  }

  private async fetchLyricsBySongMid(songmid: string, providerTrackId: string): Promise<StreamingLyricsResult> {
    const params = new URLSearchParams({
      songmid,
      pcachetime: String(Date.now()),
      g_tk: '5381',
      loginUin: uinFromCookie(accountCookie()),
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      nobase64: '1',
    });
    const data = asRecord(await jsonFetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params.toString()}`, { headers: qqHeaders(accountCookie()) }));
    const translationLyrics = maybeDecodeBase64(data.trans);
    const romanizationLyrics = maybeDecodeBase64(data.roma);
    const lyricText = maybeDecodeBase64(data.lyric);
    const split = splitLyricsByKind(lyricText);
    const lines = linesFromLyrics(split.syncedLyrics, split.plainLyrics, translationLyrics, romanizationLyrics);
    const instrumental = !split.syncedLyrics && !split.plainLyrics && Boolean(lyricText);

    return {
      provider,
      providerTrackId,
      status: instrumental || split.syncedLyrics || split.plainLyrics || lines.length > 0 ? 'available' : 'missing',
      plainLyrics: split.plainLyrics,
      syncedLyrics: split.syncedLyrics,
      translationLyrics,
      romanizationLyrics,
      instrumental,
      lines,
      sourceLabel: 'QQ 音乐',
    };
  }

  private hasLyricsContent(result: StreamingLyricsResult): boolean {
    return result.instrumental === true || Boolean(result.syncedLyrics || result.plainLyrics || result.lines.length > 0);
  }

  async getMv(input: { providerTrackId: string }): Promise<StreamingMvResult> {
    const song = unwrapQqSongRecord(await this.fetchSong(input.providerTrackId));
    const track = mapSong(song);
    const mv = asRecord(song.mv);
    const mvId = text(mv.vid);

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
          providerMvId: mvId,
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
    const song = unwrapQqSongRecord(await this.fetchSong(request.providerTrackId));
    const file = asRecord(song.file);
    const songMid = songMidFromSong(song) ?? request.providerTrackId;
    const mediaMid = text(file.media_mid) ?? text(file.mediaMid) ?? text(file.strMediaMid);
    const cookie = accountCookie();
    const uin = uinFromCookie(cookie);

    const guid = qqGuidFromCookie(cookie, uin);
    const gtk = qqGtkFromCookie(cookie);
    const qualities = qqPlaybackQualityFallbacks[request.quality ?? 'fallback'] ?? qqPlaybackQualityFallbacks.fallback;
    let lastResult: QqVkeyResult | null = null;

    for (const quality of qualities) {
      const selectedQuality = qualityPrefix(quality);
      for (const filename of qqPlaybackFilenames(selectedQuality, mediaMid, songMid)) {
        for (const endpoint of qqPlaybackEndpoints) {
          for (const platform of endpoint.platforms) {
            const param: Record<string, unknown> = {
              guid,
              songmid: [songMid],
              filename: [filename],
              songtype: [0],
              uin,
            };
            if (endpoint.modern) {
              param.ctx = 0;
            } else {
              param.loginflag = 1;
              if (platform) {
                param.platform = platform;
              }
            }

            const body = {
              req_0: {
                module: endpoint.module,
                method: endpoint.method,
                param,
              },
              comm: endpoint.modern
                ? {
                    uin,
                    format: 'json',
                    ct: 24,
                    cv: 4_747_474,
                    platform: 'yqq.json',
                    chid: '0',
                    g_tk: gtk,
                    g_tk_new_20200303: gtk,
                    inCharset: 'utf-8',
                    outCharset: 'utf-8',
                    notice: 0,
                    needNewCode: 1,
                  }
                : {
                    uin,
                    format: 'json',
                    ct: 24,
                    cv: 0,
                  },
            };
            const data = asRecord(
              await jsonFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
                method: 'POST',
                headers: qqHeaders(cookie),
                body,
              }),
            );
            const payload = asRecord(asRecord(data.req_0).data);
            const item = asRecord((Array.isArray(payload.midurlinfo) ? payload.midurlinfo : [])[0]);
            lastResult = { item, payload };
            const purl = text(item.purl);

            if (!purl) {
              continue;
            }

            const sip = Array.isArray(payload.sip) ? payload.sip.map(text).find(Boolean) : null;
            const url = purl.startsWith('http') ? purl : `${sip ?? 'https://isure.stream.qqmusic.qq.com/'}${purl}`;

            return {
              provider,
              providerTrackId: request.providerTrackId,
              url,
              expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
              mimeType: selectedQuality.mimeType,
              bitrate: selectedQuality.bitrate,
              sampleRate: null,
              bitDepth: selectedQuality.codec === 'flac' ? 16 : null,
              codec: selectedQuality.codec,
              headers: {},
              requiresProxy: false,
              supportsRange: true,
            };
          }
        }
      }
    }

    throw new Error(qqPlaybackFailureMessage(lastResult));
  }

  async getLikedSongsPlaylist(input: { page?: number; pageSize?: number } = {}): Promise<StreamingPlaylistDetail> {
    const cookie = accountCookie();
    if (!cookie) {
      throw new Error('Please connect a QQ Music account first.');
    }

    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 100)));
    const begin = (page - 1) * pageSize;
    const data = await this.fetchLikedSongsPage(cookie, begin, pageSize);
    const tracks = data.songs.map(mapSong);

    return {
      id: streamingStableKey(provider, 'playlist:liked-songs'),
      provider,
      providerPlaylistId: 'liked-songs',
      title: 'QQ 喜欢',
      description: '从 QQ 音乐账号同步的喜欢歌曲',
      creator: accountStatus().displayName ?? accountStatus().username ?? null,
      coverUrl: tracks[0]?.coverUrl ?? null,
      coverThumb: tracks[0]?.coverThumb ?? null,
      trackCount: data.total,
      tracks,
      page,
      pageSize,
      total: data.total,
      hasMore: begin + tracks.length < data.total,
    };
  }

  async setTrackLiked(input: { providerTrackId: string; liked: boolean }): Promise<void> {
    const cookie = accountCookie();
    if (!cookie) {
      throw new Error('Please connect a QQ Music account before liking tracks.');
    }

    const uin = uinFromCookie(cookie);
    if (uin === '0') {
      throw new Error('Unable to read QQ Music account UIN. Please reconnect and try again.');
    }

    const playlistId = await this.findLikedPlaylistId(cookie);
    if (input.liked) {
      await this.addTrackToLikedPlaylist(cookie, uin, playlistId, input.providerTrackId);
      return;
    }

    const song = await this.fetchSong(input.providerTrackId);
    const songId = songIdFromSong(song);
    if (!songId) {
      throw new Error('Unable to read QQ Music song id for unlike.');
    }

    await this.removeTrackFromLikedPlaylist(cookie, uin, playlistId, songId);
  }

  private async fetchSong(providerTrackId: string): Promise<unknown> {
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
      const data = asRecord(await jsonFetch(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${params.toString()}`, { headers: qqHeaders(accountCookie()) }));
      const songs = Array.isArray(data.data) ? data.data : [];
      const song = songs[0];
      if (song) {
        return song;
      }
    }

    throw new Error('没有找到这首 QQ 音乐歌曲');
  }

  private async addTrackToLikedPlaylist(cookie: string, uin: string, playlistId: string, providerTrackId: string): Promise<void> {
    const gtk = String(qqGtkFromCookie(cookie));
    const params = new URLSearchParams({
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      uin,
      dirid: playlistId,
      midlist: providerTrackId,
      typelist: '13',
      addtype: '',
      formsender: '4',
      source: '153',
      type: '3',
      utf8: '1',
    });
    const data = await jsonFetch(`https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg?${params.toString()}`, {
      headers: qqHeaders(cookie),
      timeoutMs: 12_000,
    });
    assertQqWriteSuccess(data, 'QQ Music like failed');
  }

  private async removeTrackFromLikedPlaylist(cookie: string, uin: string, playlistId: string, songId: string): Promise<void> {
    const gtk = String(qqGtkFromCookie(cookie));
    const params = new URLSearchParams({
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      uin,
      dirid: playlistId,
      songids: songId,
    });
    const data = await jsonFetch(`https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_delbatchsong.fcg?${params.toString()}`, {
      headers: qqHeaders(cookie),
      timeoutMs: 12_000,
    });
    assertQqWriteSuccess(data, 'QQ Music unlike failed');
  }

  private async fetchLikedSongsPage(cookie: string, begin: number, pageSize: number): Promise<{ total: number; songs: unknown[] }> {
    const uin = uinFromCookie(cookie);
    if (uin === '0') {
      throw new Error('Unable to read QQ Music account UIN. Please reconnect QQ Music and try again.');
    }

    const gtk = String(qqGtkFromCookie(cookie));
    const params = new URLSearchParams({
      loginUin: uin,
      hostUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '1',
      sin: String(begin),
      ein: String(begin + pageSize - 1),
    });
    const data = asRecord(
      await jsonFetch(`https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?${params.toString()}`, {
        headers: qqHeaders(cookie),
        timeoutMs: 12_000,
      }),
    );
    const payload = asRecord(data.data);
    const directEntries = Array.isArray(payload.songlist) ? payload.songlist : [];
    const entries = directEntries.length > 0 ? directEntries : collectQqSongs(data);
    const songs = entries.map((entry) => asRecord(entry).data ?? entry);

    return {
      total: qqSongTotal(payload) ?? qqSongTotal(data) ?? songs.length,
      songs,
    };
  }

  private async findLikedPlaylistId(cookie: string): Promise<string> {
    const uin = uinFromCookie(cookie);
    if (uin === '0') {
      throw new Error('Unable to read QQ Music account UIN. Please reconnect QQ Music and try again.');
    }

    const gtk = String(qqGtkFromCookie(cookie));
    const params = new URLSearchParams({
      loginUin: uin,
      hostUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '2',
      sin: '0',
      ein: '49',
    });
    const data = await jsonFetch(`https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?${params.toString()}`, {
      headers: qqHeaders(cookie),
      timeoutMs: 12_000,
    });
    const playlists = findPlaylistRecords(data);
    const liked = playlists.find((playlist) => {
      const name = qqPlaylistTitle(playlist) ?? '';
      return /我喜欢|我喜歡|like/iu.test(name);
    });
    const id = liked ? qqPlaylistId(liked) : findQqLikedPlaylistFallbackId(data);

    if (!id) {
      throw new Error('Could not find the QQ Music liked songs playlist.');
    }

    return id;
  }
}
