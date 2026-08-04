import type { PluginSourceTrack } from '../../../shared/types/plugins';
import {
  type StreamingPlaybackRequest,
  type StreamingPlaybackSource,
  type StreamingSearchRequest,
  type StreamingSearchResult,
  type StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import { createPrivateFeatureError, getPrivatePluginOperations } from '../../plugins/privateEntitlements';
import type { StreamingProvider } from '../StreamingProvider';

type PluginSourceIdentity = {
  pluginId: string;
  providerId: string;
  providerTrackId: string;
};

const encodePluginSourceIdentity = (identity: PluginSourceIdentity): string =>
  Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url');

const decodePluginSourceIdentity = (value: string): PluginSourceIdentity => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PluginSourceIdentity>;
    if (!parsed.pluginId || !parsed.providerId || !parsed.providerTrackId) {
      throw new Error('plugin_streaming_identity_invalid');
    }
    return {
      pluginId: parsed.pluginId,
      providerId: parsed.providerId,
      providerTrackId: parsed.providerTrackId,
    };
  } catch {
    throw new Error('plugin_streaming_identity_invalid');
  }
};

const trackToStreamingTrack = (track: PluginSourceTrack & PluginSourceIdentity): StreamingTrack => {
  const providerTrackId = encodePluginSourceIdentity(track);
  const stableKey = streamingStableKey('plugin', providerTrackId);
  const artist = track.artist?.trim() || 'Plugin Source';
  const album = track.album?.trim() || track.source?.trim() || 'Custom Source';

  return {
    id: stableKey,
    provider: 'plugin',
    providerTrackId,
    stableKey,
    title: track.title,
    artist,
    artists: [],
    album,
    albumId: null,
    albumArtist: track.albumArtist?.trim() || artist,
    duration: track.duration ?? null,
    coverUrl: track.coverUrl ?? null,
    coverThumb: track.coverUrl ?? null,
    qualities: ['standard'],
    explicit: false,
    playable: track.playable !== false,
    unavailableReason: track.playable === false ? track.unavailableReason ?? '这个插件音源暂不可播放。' : null,
    lyricsStatus: 'unknown',
    mvStatus: 'unknown',
  };
};

export class PluginStreamingProvider implements StreamingProvider {
  readonly name = 'plugin' as const;

  readonly descriptor = {
    displayName: '插件音源',
    enabled: true,
    supportsSearch: true,
    supportsPlayback: true,
    supportsDownload: false,
    supportsLyrics: false,
    supportsMv: false,
    requiresAccount: false,
    status: 'ready' as const,
    statusMessage: '由已启用插件提供搜索候选和显式播放 URL。',
  };

  private readonly recentTracks = new Map<string, StreamingTrack>();

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const pluginOperations = getPrivatePluginOperations();
    if (!pluginOperations) {
      throw createPrivateFeatureError('plugin-streaming-source');
    }
    const result = await pluginOperations.querySources({
      query: request.query,
      page: request.page,
      pageSize: request.pageSize,
    });
    const tracks = result.tracks.map(trackToStreamingTrack);
    for (const track of tracks) {
      this.recentTracks.set(track.providerTrackId, track);
    }

    return {
      provider: 'plugin',
      query: request.query,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 20,
      total: tracks.length,
      hasMore: false,
      tracks,
      albums: [],
      artists: [],
      playlists: [],
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const cached = this.recentTracks.get(input.providerTrackId);
    if (cached) {
      return cached;
    }

    const identity = decodePluginSourceIdentity(input.providerTrackId);
    return trackToStreamingTrack({
      ...identity,
      title: identity.providerTrackId,
      artist: 'Plugin Source',
      album: 'Custom Source',
      playable: true,
    });
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const pluginOperations = getPrivatePluginOperations();
    if (!pluginOperations) {
      throw createPrivateFeatureError('plugin-streaming-source');
    }
    const identity = decodePluginSourceIdentity(request.providerTrackId);
    const source = await pluginOperations.resolveSourcePlayback(identity);
    return {
      provider: 'plugin',
      providerTrackId: request.providerTrackId,
      url: source.url,
      expiresAt: source.expiresAt,
      mimeType: source.mimeType,
      bitrate: source.bitrate,
      sampleRate: source.sampleRate,
      bitDepth: source.bitDepth,
      codec: source.codec,
      headers: source.headers,
      requiresProxy: source.requiresProxy,
      supportsRange: source.supportsRange,
    };
  }
}

