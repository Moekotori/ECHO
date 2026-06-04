import type {
  StreamingAlbumDetail,
  StreamingArtistDetail,
  StreamingLyricsResult,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingPlaylistDetail,
  StreamingProviderDescriptor,
  StreamingProviderName,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../shared/types/streaming';

export interface StreamingProvider {
  name: StreamingProviderName;
  descriptor?: Omit<StreamingProviderDescriptor, 'name'>;

  search(request: StreamingSearchRequest): Promise<StreamingSearchResult>;

  getTrack(input: { providerTrackId: string }): Promise<StreamingTrack>;

  getAlbum?(input: { providerAlbumId: string }): Promise<StreamingAlbumDetail>;

  getArtist?(input: { providerArtistId: string }): Promise<StreamingArtistDetail>;

  getPlaylist?(input: { providerPlaylistId: string; page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail>;

  getLikedSongsPlaylist?(input: { page?: number; pageSize?: number }): Promise<StreamingPlaylistDetail>;

  setTrackLiked?(input: { providerTrackId: string; liked: boolean }): Promise<void>;

  getDailyRecommendPlaylist?(): Promise<StreamingPlaylistDetail>;

  getLyrics?(input: { providerTrackId: string }): Promise<StreamingLyricsResult>;

  getMv?(input: { providerTrackId: string }): Promise<StreamingMvResult>;

  resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource>;
}
