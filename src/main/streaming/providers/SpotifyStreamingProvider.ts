import type {
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingArtistRef,
  StreamingLyricsResult,
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
import type { LyricsProviderId, LyricsQuery, TrackLyrics } from '../../../shared/types/lyrics';
import { getAccountService } from '../../accounts/AccountService';
import { getSpotifyAuthService } from '../../accounts/SpotifyAuthService';
import { getAppSettings } from '../../app/appSettings';
import { LyricsMatchEngine } from '../../lyrics/LyricsMatchEngine';
import { NeteaseLyricsProvider } from '../../lyrics/NeteaseLyricsProvider';
import { QQMusicLyricsProvider } from '../../lyrics/QQMusicLyricsProvider';
import { LrclibProvider } from '../../lyrics/LrclibProvider';
import { providerResultToTrackLyrics } from '../../lyrics/LyricsProvider';
import { fetchWithNetworkProxy } from '../../network/networkFetch';
import type { StreamingProvider } from '../StreamingProvider';
import { asRecord, text } from './chinaStreamingUtils';

const provider = 'spotify' as const;
const spotifyApiBaseUrl = 'https://api.spotify.com/v1';
const spotifySearchPageSizeMax = 10;
const spotifyLyricsCacheVersion = 'spotify-metadata-v1';
const spotifyLyricsProviders: LyricsProviderId[] = ['lrclib', 'netease', 'qqmusic'];

const lyricsMatchEngine = new LyricsMatchEngine([
  new LrclibProvider(),
  new NeteaseLyricsProvider(),
  new QQMusicLyricsProvider(),
]);

const bearerHeaders = async (): Promise<Record<string, string>> => ({
  Authorization: `Bearer ${await getSpotifyAuthService().getAccessToken()}`,
  Accept: 'application/json',
});

const spotifyApiFetch = async <T>(path: string): Promise<T> => {
  const response = await fetchWithNetworkProxy(`${spotifyApiBaseUrl}${path}`, {
    method: 'GET',
    headers: await bearerHeaders(),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Spotify 登录已过期，请重新检查账号或重新登录。');
    }
    if (response.status === 403) {
      throw new Error('Spotify Premium 或当前地区权限不足，无法访问该内容。');
    }
    if (response.status === 404) {
      throw new Error('Spotify 内容不存在或不可访问。');
    }

    throw new Error(`Spotify request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

void spotifyApiFetch;

const spotifyApiFetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetchWithNetworkProxy(`${spotifyApiBaseUrl}${path}`, {
    method: 'GET',
    headers: await bearerHeaders(),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let detail = raw.trim().slice(0, 240);
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } | string; error_description?: string };
      if (typeof parsed.error === 'object' && parsed.error?.message) {
        detail = parsed.error.message;
      } else if (typeof parsed.error === 'string') {
        detail = parsed.error_description ? `${parsed.error}: ${parsed.error_description}` : parsed.error;
      }
    } catch {
      // Keep raw error text when Spotify does not return JSON.
    }

    if (response.status === 401) {
      throw new Error('Spotify login expired. Please reconnect Spotify.');
    }
    if (response.status === 403) {
      const suffix = detail ? ` (${detail})` : '';
      if (/insufficient client scope|scope/iu.test(detail)) {
        throw new Error(`Spotify playlist permission is missing. Reconnect Spotify from Settings after saving your OAuth config.${suffix}`);
      }
      if (/not registered for this application|not registered/iu.test(detail)) {
        throw new Error(`This Spotify account is not added to the Spotify Developer App allowlist. Add it in Spotify Dashboard > Users Management, or use your own Client ID.${suffix}`);
      }
      if (/not owner|not.*collaborator|collaborator|owner/iu.test(detail) || /^\/playlists\/[^/]+\/(?:items|tracks)(?:\?|$)/u.test(path)) {
        throw new Error(`Spotify only allows this playlist's owner or collaborators to read its track list through the Web API.${suffix}`);
      }
      throw new Error(`Spotify refused access to this content. This is usually a playlist permission, OAuth scope, account allowlist, or regional restriction issue.${suffix}`);
    }
    if (response.status === 404) {
      throw new Error('Spotify content was not found or is unavailable.');
    }

    throw new Error(`Spotify request failed: ${response.status}${detail ? ` (${detail})` : ''}`);
  }

  return (await response.json()) as T;
};

const emptySpotifyLyrics = (providerTrackId: string): StreamingLyricsResult => ({
  provider,
  providerTrackId,
  status: 'missing',
  plainLyrics: null,
  syncedLyrics: null,
  translationLyrics: null,
  romanizationLyrics: null,
  lines: [],
  sourceLabel: null,
});

const trackToLyricsQuery = (track: StreamingTrack): LyricsQuery => ({
  trackId: track.stableKey,
  mediaType: 'streaming',
  sourceId: `${provider}:${track.providerTrackId}`,
  stableKey: `${spotifyLyricsCacheVersion}:${track.stableKey}`,
  title: track.title,
  artist: track.artist,
  album: track.album || null,
  durationSeconds: track.duration && track.duration > 0 ? track.duration : null,
  filePath: null,
});

const trackLyricsToStreamingLyrics = (providerTrackId: string, lyrics: TrackLyrics | null): StreamingLyricsResult => {
  if (!lyrics) {
    return emptySpotifyLyrics(providerTrackId);
  }

  return {
    provider,
    providerTrackId,
    status: lyrics.lines.length > 0 || lyrics.kind === 'instrumental' ? 'available' : 'missing',
    plainLyrics: lyrics.plainText ?? null,
    syncedLyrics: lyrics.syncedText ?? null,
    translationLyrics: lyrics.lines.some((line) => line.translation) ? lyrics.lines.map((line) => line.translation ?? '').join('\n') : null,
    romanizationLyrics: lyrics.lines.some((line) => line.romanization) ? lyrics.lines.map((line) => line.romanization ?? '').join('\n') : null,
    lines: lyrics.lines.map((line) => ({
      timeMs: line.timeMs >= 0 ? line.timeMs : null,
      text: line.text,
      translation: line.translation ?? null,
      romanization: line.romanization ?? null,
    })),
    sourceLabel: lyrics.provider === 'lrclib' ? 'LRCLIB' : lyrics.provider === 'netease' ? '网易云音乐' : lyrics.provider === 'qqmusic' ? 'QQ 音乐' : '歌词匹配',
  };
};

const imagesFrom = (value: unknown): Array<Record<string, unknown>> => {
  const images = Array.isArray(value) ? value.map(asRecord) : [];
  return images.filter((image) => text(image.url));
};

const imageUrl = (value: unknown, preferSmall = false): string | null => {
  const images = imagesFrom(value);
  if (images.length === 0) {
    return null;
  }

  const sorted = [...images].sort((left, right) => {
    const leftWidth = Number(left.width ?? 0);
    const rightWidth = Number(right.width ?? 0);
    return preferSmall ? leftWidth - rightWidth : rightWidth - leftWidth;
  });
  return text(sorted[0]?.url);
};

const artistRefs = (value: unknown): StreamingArtistRef[] => {
  const artists = Array.isArray(value) ? value.map(asRecord) : [];
  return artists
    .map((artist): StreamingArtistRef | null => {
      const id = text(artist.id);
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

const trackFrom = (value: unknown): StreamingTrack | null => {
  const track = asRecord(value);
  const providerTrackId = text(track.id);
  const title = text(track.name);
  if (!providerTrackId || !title) {
    return null;
  }

  const album = asRecord(track.album);
  const artists = artistRefs(track.artists);
  const artist = artists.map((item) => item.name).join(' / ') || 'Unknown Artist';
  const albumName = text(album.name) ?? 'Unknown Album';
  const albumArtists = artistRefs(album.artists);
  const durationMs = Number(track.duration_ms);
  const isPlayable = track.is_playable !== false;

  return {
    id: streamingStableKey(provider, providerTrackId),
    provider,
    providerTrackId,
    stableKey: streamingStableKey(provider, providerTrackId),
    title,
    artist,
    artists,
    album: albumName,
    albumId: text(album.id),
    albumArtist: albumArtists.map((item) => item.name).join(' / ') || null,
    duration: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : null,
    coverUrl: imageUrl(album.images),
    coverThumb: imageUrl(album.images, true),
    qualities: ['standard'],
    explicit: track.explicit === true,
    playable: isPlayable,
    unavailableReason: isPlayable ? null : '该 Spotify 曲目在当前账号或地区不可播放。',
    lyricsStatus: 'missing',
    mvStatus: 'missing',
  };
};

const albumFrom = (value: unknown): StreamingAlbum | null => {
  const album = asRecord(value);
  const providerAlbumId = text(album.id);
  const title = text(album.name);
  if (!providerAlbumId || !title) {
    return null;
  }

  const artists = artistRefs(album.artists);
  return {
    id: streamingStableKey(provider, `album:${providerAlbumId}`),
    provider,
    providerAlbumId,
    title,
    artist: artists.map((item) => item.name).join(' / ') || 'Unknown Artist',
    artists,
    coverUrl: imageUrl(album.images),
    coverThumb: imageUrl(album.images, true),
    releaseDate: text(album.release_date),
    trackCount: Number.isFinite(Number(album.total_tracks)) ? Number(album.total_tracks) : null,
  };
};

const artistFrom = (value: unknown): StreamingArtist | null => {
  const artist = asRecord(value);
  const providerArtistId = text(artist.id);
  const name = text(artist.name);
  if (!providerArtistId || !name) {
    return null;
  }

  return {
    id: streamingStableKey(provider, `artist:${providerArtistId}`),
    provider,
    providerArtistId,
    name,
    avatarUrl: imageUrl(artist.images, true),
    coverUrl: imageUrl(artist.images),
  };
};

const playlistFrom = (value: unknown): StreamingPlaylist | null => {
  const playlist = asRecord(value);
  const providerPlaylistId = text(playlist.id);
  const title = text(playlist.name);
  if (!providerPlaylistId || !title) {
    return null;
  }

  const owner = asRecord(playlist.owner);
  const tracks = asRecord(playlist.tracks ?? playlist.items);
  const total = Number(tracks.total);
  return {
    id: streamingStableKey(provider, `playlist:${providerPlaylistId}`),
    provider,
    providerPlaylistId,
    title,
    description: text(playlist.description),
    creator: text(owner.display_name) ?? text(owner.id),
    coverUrl: imageUrl(playlist.images),
    coverThumb: imageUrl(playlist.images, true),
    trackCount: Number.isFinite(total) ? total : null,
  };
};

const itemsFromPage = (page: unknown): unknown[] => {
  const record = asRecord(page);
  return Array.isArray(record.items) ? record.items : [];
};

const trackFromPlaylistItem = (item: unknown): StreamingTrack | null => {
  const record = asRecord(item);
  return trackFrom(record.track ?? record.item);
};

type SpotifySearchPage = {
  items?: unknown[];
  total?: number;
};

type SpotifySearchResponse = {
  tracks?: SpotifySearchPage;
  albums?: SpotifySearchPage;
  artists?: SpotifySearchPage;
  playlists?: SpotifySearchPage;
};

export class SpotifyStreamingProvider implements StreamingProvider {
  readonly name = provider;

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const status = getAccountService().getStatus(provider);
    return {
      displayName: 'Spotify',
      enabled: true,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: false,
      supportsLyrics: true,
      supportsMv: false,
      requiresAccount: true,
      accountConnected: status.connected,
      accountDisplayName: status.displayName,
      accountUsername: status.username,
      accountAvatarUrl: status.avatarUrl,
      status: status.connected ? (status.error ? 'error' : 'ready') : 'needs_account',
      statusMessage: status.connected
        ? 'Spotify 通过官方 Web Playback SDK 播放，需要 Premium；下载功能不适用于 Spotify。'
        : '请先登录 Spotify Premium 账号。',
    };
  }

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(spotifySearchPageSizeMax, Math.max(1, Math.floor(request.pageSize ?? spotifySearchPageSizeMax)));
    const offset = (page - 1) * pageSize;
    const mediaTypes = request.mediaTypes?.length
      ? request.mediaTypes.filter((type) => type === 'track' || type === 'album' || type === 'artist' || type === 'playlist')
      : ['track'];
    const type = mediaTypes.length > 0 ? mediaTypes.join(',') : 'track';
    const params = new URLSearchParams({
      q: request.query,
      type,
      limit: String(pageSize),
      offset: String(offset),
    });
    const data = await spotifyApiFetchJson<SpotifySearchResponse>(`/search?${params.toString()}`);
    const tracks = (data.tracks?.items ?? []).map(trackFrom).filter((track): track is StreamingTrack => Boolean(track));
    const albums = (data.albums?.items ?? []).map(albumFrom).filter((album): album is StreamingAlbum => Boolean(album));
    const artists = (data.artists?.items ?? []).map(artistFrom).filter((artist): artist is StreamingArtist => Boolean(artist));
    const playlists = (data.playlists?.items ?? []).map(playlistFrom).filter((playlist): playlist is StreamingPlaylist => Boolean(playlist));
    const total = Math.max(data.tracks?.total ?? 0, data.albums?.total ?? 0, data.artists?.total ?? 0, data.playlists?.total ?? 0);

    return {
      provider,
      query: request.query,
      page,
      pageSize,
      total,
      hasMore: offset + pageSize < total,
      tracks,
      albums,
      artists,
      playlists,
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const track = trackFrom(await spotifyApiFetchJson<unknown>(`/tracks/${encodeURIComponent(input.providerTrackId)}`));
    if (!track) {
      throw new Error('Spotify track is unavailable.');
    }

    return track;
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    const data = await spotifyApiFetchJson<unknown>(`/albums/${encodeURIComponent(input.providerAlbumId)}`);
    const album = albumFrom(data);
    if (!album) {
      throw new Error('Spotify album is unavailable.');
    }

    const albumRecord = asRecord(data);
    const trackItems = itemsFromPage(albumRecord.tracks);
    const tracks = trackItems
      .map((item) => trackFrom({ ...asRecord(item), album: albumRecord }))
      .filter((track): track is StreamingTrack => Boolean(track));

    return {
      ...album,
      tracks,
    };
  }

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    const artist = artistFrom(await spotifyApiFetchJson<unknown>(`/artists/${encodeURIComponent(input.providerArtistId)}`));
    if (!artist) {
      throw new Error('Spotify artist is unavailable.');
    }

    const [topTracksData, albumsData] = await Promise.all([
      spotifyApiFetchJson<unknown>(`/artists/${encodeURIComponent(input.providerArtistId)}/top-tracks`),
      spotifyApiFetchJson<unknown>(`/artists/${encodeURIComponent(input.providerArtistId)}/albums?limit=20&include_groups=album,single`),
    ]);
    const topTrackItems: unknown[] = Array.isArray(asRecord(topTracksData).tracks) ? asRecord(topTracksData).tracks as unknown[] : [];
    const topTracks = topTrackItems
      .map(trackFrom)
      .filter((track): track is StreamingTrack => Boolean(track));
    const albums = itemsFromPage(albumsData)
      .map(albumFrom)
      .filter((album): album is StreamingAlbum => Boolean(album));

    return {
      ...artist,
      topTracks,
      albums,
    };
  }

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
    const offset = (page - 1) * pageSize;
    const playlist = playlistFrom(await spotifyApiFetchJson<unknown>(`/playlists/${encodeURIComponent(input.providerPlaylistId)}`));
    if (!playlist) {
      throw new Error('Spotify playlist is unavailable.');
    }

    const trackParams = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    const tracksPage = await spotifyApiFetchJson<unknown>(
      `/playlists/${encodeURIComponent(input.providerPlaylistId)}/items?${trackParams.toString()}`,
    );
    const tracksRecord = asRecord(tracksPage);
    const total = Number(tracksRecord.total);
    const tracks = itemsFromPage(tracksPage)
      .map(trackFromPlaylistItem)
      .filter((track): track is StreamingTrack => Boolean(track));

    return {
      ...playlist,
      tracks,
      page,
      pageSize,
      total: Number.isFinite(total) ? total : tracks.length,
      hasMore: Number.isFinite(total) ? offset + pageSize < total : tracks.length === pageSize,
    };
  }

  async getLyrics(input: { providerTrackId: string }): Promise<StreamingLyricsResult> {
    const track = await this.getTrack(input);
    const query = trackToLyricsQuery(track);
    const settings = getAppSettings();
    const enabledProviders = (settings.lyricsEnabledProviders?.length ? settings.lyricsEnabledProviders : spotifyLyricsProviders)
      .filter((item): item is LyricsProviderId => spotifyLyricsProviders.includes(item as LyricsProviderId));

    if (!settings.lyricsNetworkEnabled || enabledProviders.length === 0) {
      return emptySpotifyLyrics(input.providerTrackId);
    }

    const result = await lyricsMatchEngine.match(query, {
      enabledProviders,
      networkEnabled: true,
      providerTimeoutMs: settings.lyricsProviderTimeoutMs,
      totalMatchTimeoutMs: settings.lyricsTotalMatchTimeoutMs,
      autoAcceptScore: settings.lyricsAutoAcceptScore,
      coverAutoAcceptScore: settings.lyricsCoverAutoAcceptScore,
      deepSearchEnabled: settings.lyricsDeepSearchEnabled,
      collectAllCandidates: false,
    });

    const accepted = result.accepted ?? result.candidates.find((candidate) => candidate.decision.risk !== 'high') ?? null;
    const lyrics = accepted ? providerResultToTrackLyrics(query, accepted.providerResult, accepted.score) : null;
    return trackLyricsToStreamingLyrics(input.providerTrackId, lyrics);
  }

  async resolvePlayback(_request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    void _request;
    throw new Error('Spotify 由官方 Web Playback SDK 播放，不提供可下载音频 URL。');
  }
}
