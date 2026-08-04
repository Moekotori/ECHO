import type {
  StreamingAccountPlaylist,
  StreamingAlbum,
  StreamingAlbumDetail,
  StreamingArtist,
  StreamingArtistDetail,
  StreamingAudioQuality,
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
import type { QobuzFormatId } from '../../../shared/types/qobuz';
import { QOBUZ_QUALITY_BY_FORMAT } from '../../../shared/types/qobuz';
import { QobuzAuthService } from '../../qobuz/QobuzAuthService';
import { QobuzApiClient } from '../../qobuz/QobuzApiClient';
import type { StreamingProvider } from '../StreamingProvider';

const provider = 'qobuz' as const;

const DEFAULT_SEARCH_LIMIT = 50;
const COVER_FALLBACK = '';

// ── helpers ───────────────────────────────────────────────────────

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const mapQualityFromFormatId = (formatId: number | undefined): StreamingAudioQuality => {
  if (!formatId || formatId <= 5) return 'standard';
  if (formatId === 6) return 'lossless';
  return 'hires';
};

const qualityFromTrackItem = (item: Record<string, unknown>): StreamingAudioQuality => {
  const maxId = typeof item.maximum_format_id === 'number' ? item.maximum_format_id : undefined;
  return mapQualityFromFormatId(maxId);
};

const formatIdFromQuality = (quality: StreamingAudioQuality): QobuzFormatId => {
  switch (quality) {
    case 'standard': return 5;
    case 'high': return 5;
    case 'lossless': return 6;
    case 'hires': return 7;
    default: return 6;
  }
};

const imageUrl = (image: unknown, prefer = 'large'): string => {
  const img = asRecord(image);
  return text(img[prefer]) || text(img.small) || text(img.medium) || COVER_FALLBACK;
};

// ── type-safe item access ─────────────────────────────────────────

const itemsFrom = (data: Record<string, unknown>, key: string): unknown[] => {
  const container = asRecord(data[key]);
  return asArray(container.items);
};

// ── mappers ───────────────────────────────────────────────────────

const mapQobuzTrack = (item: Record<string, unknown>): StreamingTrack | null => {
  const id = typeof item.id === 'number' ? String(item.id) : text(item.id);
  if (!id) return null;

  const performer = asRecord(item.performer);
  const album = asRecord(item.album);

  return {
    id: `streaming:qobuz:${id}`,
    provider: 'qobuz',
    providerTrackId: id,
    stableKey: streamingStableKey('qobuz', id),
    title: text(item.title) || 'Unknown Track',
    artist: text(performer.name) || text(item.artist_name) || 'Unknown Artist',
    artists: [{ id: `qobuz:artist:${text(performer.id)}`, provider: 'qobuz', providerArtistId: text(performer.id), name: text(performer.name) || 'Unknown Artist' }],
    album: text(album.title) || '',
    albumId: typeof album.id === 'number' ? String(album.id) : text(album.id),
    albumArtist: text(asRecord(album.artist).name) || null,
    duration: typeof item.duration === 'number' ? item.duration : null,
    coverUrl: imageUrl(album.image),
    coverThumb: imageUrl(album.image, 'small'),
    qualities: [qualityFromTrackItem(item)],
    explicit: item.parental_warning === true,
    playable: item.streamable !== false,
    unavailableReason: item.streamable === false ? '此曲目当前不可用' : null,
    lyricsStatus: 'unknown',
    mvStatus: 'unknown',
  };
};

const mapQobuzAlbum = (item: Record<string, unknown>): StreamingAlbum | null => {
  const id = typeof item.id === 'number' ? String(item.id) : text(item.id);
  if (!id) return null;

  const artist = asRecord(item.artist);

  return {
    id: `streaming:qobuz:album:${id}`,
    provider: 'qobuz',
    providerAlbumId: id,
    title: text(item.title) || 'Unknown Album',
    artist: text(artist.name) || text(item.artist_name) || 'Unknown Artist',
    artists: [{ id: `qobuz:artist:${text(artist.id)}`, provider: 'qobuz', providerArtistId: text(artist.id), name: text(artist.name) || 'Unknown Artist' }],
    coverUrl: imageUrl(item.image),
    coverThumb: imageUrl(item.image, 'small'),
    releaseDate: text(item.release_date_original) || text(item.release_date_stream) || null,
    trackCount: typeof item.tracks_count === 'number' ? item.tracks_count : null,
  };
};

const mapQobuzArtist = (item: Record<string, unknown>): StreamingArtist | null => {
  const id = typeof item.id === 'number' ? String(item.id) : text(item.id);
  if (!id) return null;

  return {
    id: `streaming:qobuz:artist:${id}`,
    provider: 'qobuz',
    providerArtistId: id,
    name: text(item.name) || 'Unknown Artist',
    avatarUrl: imageUrl(item.image),
    coverUrl: imageUrl(item.image),
  };
};

const mapQobuzPlaylist = (item: Record<string, unknown>): StreamingPlaylist | null => {
  const id = typeof item.id === 'number' ? String(item.id) : text(item.id);
  if (!id) return null;

  const owner = asRecord(item.owner);

  return {
    id: `streaming:qobuz:playlist:${id}`,
    provider: 'qobuz',
    providerPlaylistId: id,
    title: text(item.name) || 'Unknown Playlist',
    description: text(item.description) || null,
    creator: text(owner.name) || text(owner.login) || null,
    coverUrl: imageUrl(item.image),
    coverThumb: imageUrl(item.image, 'small'),
    trackCount: typeof item.tracks_count === 'number' ? item.tracks_count : null,
  };
};

// ── provider class ────────────────────────────────────────────────

export class QobuzStreamingProvider implements StreamingProvider {
  name = provider as 'qobuz';

  private get auth(): QobuzAuthService {
    return QobuzAuthService.getInstance();
  }

  private get api(): QobuzApiClient {
    return this.auth.getApiClient();
  }

  get descriptor(): Omit<StreamingProviderDescriptor, 'name'> {
    const authState = this.auth.getState();
    return {
      displayName: 'Qobuz',
      enabled: authState.valid,
      supportsSearch: true,
      supportsPlayback: true,
      supportsDownload: true,
      supportsLyrics: false,
      supportsMv: false,
      requiresAccount: true,
      accountConnected: authState.valid,
      accountDisplayName: authState.displayName ?? authState.username,
    };
  }

  // ── search ──────────────────────────────────────────────────────

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    await this.auth.ensureValid();

    const query = request.query.trim();
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? DEFAULT_SEARCH_LIMIT)));
    const mediaTypes = request.mediaTypes?.length ? request.mediaTypes : ['track'];

    const [tracks, albums, artists, playlists] = await Promise.all([
      mediaTypes.includes('track') ? this.searchTracks(query, pageSize) : Promise.resolve([] as StreamingTrack[]),
      mediaTypes.includes('album') ? this.searchAlbums(query, pageSize) : Promise.resolve([] as StreamingAlbum[]),
      mediaTypes.includes('artist') ? this.searchArtists(query, pageSize) : Promise.resolve([] as StreamingArtist[]),
      mediaTypes.includes('playlist') ? this.searchPlaylists(query, pageSize) : Promise.resolve([] as StreamingPlaylist[]),
    ]);

    return {
      provider: 'qobuz',
      query,
      page,
      pageSize,
      total: null,
      hasMore: false,
      tracks,
      albums,
      artists,
      playlists,
      mvs: [],
    };
  }

  private async searchTracks(query: string, limit: number): Promise<StreamingTrack[]> {
    try {
      const raw = await this.api.searchTracks(query, limit);
      return itemsFrom(asRecord(raw), 'tracks')
        .map((item) => mapQobuzTrack(asRecord(item)))
        .filter((t): t is StreamingTrack => t !== null);
    } catch {
      return [];
    }
  }

  private async searchAlbums(query: string, limit: number): Promise<StreamingAlbum[]> {
    try {
      const raw = await this.api.searchAlbums(query, limit);
      return itemsFrom(asRecord(raw), 'albums')
        .map((item) => mapQobuzAlbum(asRecord(item)))
        .filter((a): a is StreamingAlbum => a !== null);
    } catch {
      return [];
    }
  }

  private async searchArtists(query: string, limit: number): Promise<StreamingArtist[]> {
    try {
      const raw = await this.api.searchArtists(query, limit);
      return itemsFrom(asRecord(raw), 'artists')
        .map((item) => mapQobuzArtist(asRecord(item)))
        .filter((a): a is StreamingArtist => a !== null);
    } catch {
      return [];
    }
  }

  private async searchPlaylists(query: string, limit: number): Promise<StreamingPlaylist[]> {
    try {
      const raw = await this.api.searchPlaylists(query, limit);
      return itemsFrom(asRecord(raw), 'playlists')
        .map((item) => mapQobuzPlaylist(asRecord(item)))
        .filter((p): p is StreamingPlaylist => p !== null);
    } catch {
      return [];
    }
  }

  // ── getTrack ────────────────────────────────────────────────────

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    await this.auth.ensureValid();
    const raw = await this.api.getTrack(input.providerTrackId);
    const data = asRecord(raw);
    const track = mapQobuzTrack(data);
    if (!track) throw new Error('Track not found');
    const album = asRecord(data.album);
    if (!track.coverUrl) {
      track.coverUrl = imageUrl(album.image);
      track.coverThumb = imageUrl(album.image, 'small');
    }
    if (!track.album) track.album = text(album.title) || track.album;
    return track;
  }

  // ── getAlbum ────────────────────────────────────────────────────

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail> {
    await this.auth.ensureValid();
    const raw = await this.api.getAlbum(input.providerAlbumId);
    const data = asRecord(raw);

    const albumCover = imageUrl(data.image);
    const albumCoverThumb = imageUrl(data.image, 'small');
    const albumTitle = text(data.title) || 'Unknown Album';
    const albumArtist = asRecord(data.artist);
    const albumArtistName = text(albumArtist.name);

    const tracks: StreamingTrack[] = [];
    for (const item of itemsFrom(data, 'tracks')) {
      const track = mapQobuzTrack(asRecord(item));
      if (track) {
        tracks.push({
          ...track,
          album: track.album || albumTitle,
          albumArtist: track.albumArtist || albumArtistName || track.artist,
          coverUrl: track.coverUrl || albumCover,
          coverThumb: track.coverThumb || albumCoverThumb,
        });
      }
    }

    return {
      id: `streaming:qobuz:album:${input.providerAlbumId}`,
      provider: 'qobuz',
      providerAlbumId: input.providerAlbumId,
      title: albumTitle,
      artist: albumArtistName || 'Unknown Artist',
      artists: [{ id: `qobuz:artist:${text(albumArtist.id)}`, provider: 'qobuz', providerArtistId: text(albumArtist.id), name: albumArtistName || 'Unknown Artist' }],
      coverUrl: albumCover,
      coverThumb: albumCoverThumb,
      releaseDate: text(data.release_date_original) || text(data.release_date_stream) || null,
      trackCount: tracks.length,
      tracks,
    };
  }

  // ── getArtist ───────────────────────────────────────────────────

  async getArtist(input: { providerArtistId: string }): Promise<StreamingArtistDetail> {
    await this.auth.ensureValid();
    const raw = await this.api.getArtist(input.providerArtistId);
    const data = asRecord(raw);

    const albums = itemsFrom(data, 'albums')
      .map((item) => mapQobuzAlbum(asRecord(item)))
      .filter((a): a is StreamingAlbum => a !== null);

    return {
      id: `streaming:qobuz:artist:${input.providerArtistId}`,
      provider: 'qobuz',
      providerArtistId: input.providerArtistId,
      name: text(data.name) || 'Unknown Artist',
      avatarUrl: imageUrl(data.image),
      coverUrl: imageUrl(data.image),
      topTracks: [],
      albums,
    };
  }

  // ── resolvePlayback ─────────────────────────────────────────────

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    await this.auth.ensureValid();

    const formatId = formatIdFromQuality(request.quality ?? 'lossless');
    const fileUrl = await this.api.getTrackFileUrl(request.providerTrackId, formatId);

    const qualityInfo = QOBUZ_QUALITY_BY_FORMAT.get(fileUrl.formatId);

    return {
      provider: 'qobuz',
      providerTrackId: request.providerTrackId,
      url: fileUrl.url,
      mimeType: fileUrl.mimeType || (qualityInfo?.mimeType ?? 'audio/flac'),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      headers: {
        'Referer': 'https://play.qobuz.com/',
      },
      supportsRange: true,
      requiresProxy: false,
      codec: fileUrl.formatId === 5 ? 'mp3' : 'flac',
      bitDepth: fileUrl.bitDepth,
      sampleRate: fileUrl.sampleRate,
      bitrate: null,
    };
  }

  // ── getPlaylist ─────────────────────────────────────────────────

  async getPlaylist(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail> {
    await this.auth.ensureValid();
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 500;
    const offset = ((page - 1) * pageSize);
    const raw = await this.api.getPlaylist(input.providerPlaylistId, pageSize, offset);
    const data = asRecord(raw);

    const tracks = itemsFrom(data, 'tracks')
      .map((item) => mapQobuzTrack(asRecord(item)))
      .filter((t): t is StreamingTrack => t !== null);

    const owner = asRecord(data.owner);
    const totalNum = typeof (data.tracks as Record<string, unknown> | null)?.total === 'number'
      ? (data.tracks as Record<string, unknown>).total as number : null;

    return {
      id: `streaming:qobuz:playlist:${input.providerPlaylistId}`,
      provider: 'qobuz',
      providerPlaylistId: input.providerPlaylistId,
      title: text(data.name) || 'Unknown Playlist',
      description: text(data.description) || null,
      creator: text(owner.name) || text(owner.login) || null,
      coverUrl: imageUrl(data.image),
      coverThumb: imageUrl(data.image, 'small'),
      trackCount: tracks.length,
      page,
      pageSize,
      total: totalNum,
      hasMore: totalNum !== null ? offset + pageSize < totalNum : false,
      tracks,
    };
  }

  // ── listAccountPlaylists ────────────────────────────────────────

  async listAccountPlaylists(): Promise<StreamingAccountPlaylist[]> {
    await this.auth.ensureValid();
    try {
      const raw = await this.api.getUserPlaylists();
      const result: StreamingAccountPlaylist[] = [];
      for (const item of itemsFrom(asRecord(raw), 'playlists')) {
        const playlist = mapQobuzPlaylist(asRecord(item));
        if (!playlist) continue;
        result.push({
          ...playlist,
          ownership: 'unknown' as StreamingAccountPlaylist['ownership'],
          webUrl: `https://play.qobuz.com/playlist/${playlist.providerPlaylistId}`,
        } as StreamingAccountPlaylist);
      }
      return result;
    } catch {
      return [];
    }
  }
}
