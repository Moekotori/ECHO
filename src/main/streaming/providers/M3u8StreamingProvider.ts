import type {
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import type { StreamingProvider } from '../StreamingProvider';
import { decodeM3u8ProviderTrackId } from '../M3u8Playlist';

const emptySearchResult = (request: StreamingSearchRequest): StreamingSearchResult => ({
  provider: 'm3u8',
  query: request.query,
  page: request.page ?? 1,
  pageSize: request.pageSize ?? 20,
  total: 0,
  hasMore: false,
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  mvs: [],
});

export class M3u8StreamingProvider implements StreamingProvider {
  name = 'm3u8' as const;

  descriptor = {
    displayName: 'M3U8',
    enabled: true,
    supportsSearch: false,
    supportsPlayback: true,
    supportsDownload: true,
    supportsLyrics: false,
    supportsMv: false,
    requiresAccount: false,
  };

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    return emptySearchResult(request);
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    const url = decodeM3u8ProviderTrackId(input.providerTrackId);
    const title = (() => {
      try {
        return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '') || 'M3U8 Stream';
      } catch {
        return 'M3U8 Stream';
      }
    })();

    return {
      id: streamingStableKey('m3u8', input.providerTrackId),
      provider: 'm3u8',
      providerTrackId: input.providerTrackId,
      stableKey: streamingStableKey('m3u8', input.providerTrackId),
      title,
      artist: 'Unknown Artist',
      artists: [],
      album: 'M3U8 Playlist',
      albumId: null,
      albumArtist: null,
      duration: null,
      coverUrl: null,
      coverThumb: null,
      qualities: ['standard'],
      explicit: false,
      playable: true,
      unavailableReason: null,
      lyricsStatus: 'unknown',
      mvStatus: 'unknown',
    };
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    return {
      provider: 'm3u8',
      providerTrackId: request.providerTrackId,
      url: decodeM3u8ProviderTrackId(request.providerTrackId),
      expiresAt: null,
      mimeType: null,
      bitrate: null,
      sampleRate: null,
      bitDepth: null,
      codec: null,
      headers: {},
      requiresProxy: false,
      supportsRange: true,
    };
  }
}
