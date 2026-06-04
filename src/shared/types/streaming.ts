export type StreamingProviderName =
  | 'mock'
  | 'netease'
  | 'qqmusic'
  | 'kugou'
  | 'bilibili'
  | 'youtube'
  | 'soundcloud'
  | 'spotify'
  | 'tidal'
  | 'm3u8'
  | 'plugin';
export type StreamingFavoriteProviderName = Extract<StreamingProviderName, 'bilibili' | 'youtube' | 'soundcloud'>;

export type StreamingMediaType = 'track' | 'album' | 'artist' | 'playlist' | 'mv';

export type StreamingAudioQuality = 'standard' | 'high' | 'lossless' | 'hires';
export const defaultStreamingAudioQuality: StreamingAudioQuality = 'lossless';

export type StreamingLyricsStatus = 'unknown' | 'available' | 'missing';
export type StreamingMvStatus = 'unknown' | 'available' | 'missing';

export const streamingProviderNames: StreamingProviderName[] = [
  'mock',
  'netease',
  'qqmusic',
  'kugou',
  'bilibili',
  'youtube',
  'soundcloud',
  'spotify',
  'tidal',
  'm3u8',
  'plugin',
];

export const streamingStableKey = (provider: StreamingProviderName, providerTrackId: string): string =>
  `streaming:${provider}:${providerTrackId}`;

export const neteaseDjRadioPlaylistPrefix = 'djradio:';

export type StreamingArtistRef = {
  id: string;
  provider: StreamingProviderName;
  providerArtistId: string;
  name: string;
};

export type StreamingTrack = {
  id: string;
  provider: StreamingProviderName;
  providerTrackId: string;
  stableKey: string;
  title: string;
  artist: string;
  artists: StreamingArtistRef[];
  album: string;
  albumId: string | null;
  albumArtist: string | null;
  duration: number | null;
  coverUrl: string | null;
  coverThumb: string | null;
  qualities: StreamingAudioQuality[];
  explicit: boolean;
  playable: boolean;
  unavailableReason: string | null;
  lyricsStatus: StreamingLyricsStatus;
  mvStatus: StreamingMvStatus;
};

export type StreamingTrackSourceInfo = {
  provider: StreamingProviderName;
  providerTrackId: string;
  albumId: string | null;
  sourcePlaylistIds: string[];
  isNeteaseDjRadio: boolean;
};

export type StreamingAlbum = {
  id: string;
  provider: StreamingProviderName;
  providerAlbumId: string;
  title: string;
  artist: string;
  artists: StreamingArtistRef[];
  coverUrl: string | null;
  coverThumb: string | null;
  releaseDate: string | null;
  trackCount: number | null;
};

export type StreamingAlbumDetail = StreamingAlbum & {
  tracks: StreamingTrack[];
};

export type StreamingArtist = {
  id: string;
  provider: StreamingProviderName;
  providerArtistId: string;
  name: string;
  avatarUrl: string | null;
  coverUrl: string | null;
};

export type StreamingArtistDetail = StreamingArtist & {
  topTracks: StreamingTrack[];
  albums: StreamingAlbum[];
};

export type StreamingPlaylist = {
  id: string;
  provider: StreamingProviderName;
  providerPlaylistId: string;
  title: string;
  description: string | null;
  creator: string | null;
  coverUrl: string | null;
  coverThumb: string | null;
  trackCount: number | null;
};

export type StreamingPlaylistDetail = StreamingPlaylist & {
  tracks: StreamingTrack[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
};

export type StreamingSearchRequest = {
  provider: StreamingProviderName;
  query: string;
  mediaTypes?: StreamingMediaType[];
  page?: number;
  pageSize?: number;
};

export type StreamingSearchResult = {
  provider: StreamingProviderName;
  query: string;
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  tracks: StreamingTrack[];
  albums: StreamingAlbum[];
  artists: StreamingArtist[];
  playlists: StreamingPlaylist[];
  mvs: StreamingMvItem[];
  cached?: boolean;
};

export type StreamingPlaybackRequest = {
  provider: StreamingProviderName;
  providerTrackId: string;
  quality?: StreamingAudioQuality;
};

export type StreamingPlaybackSource = {
  provider: StreamingProviderName;
  providerTrackId: string;
  url: string;
  expiresAt: string | null;
  mimeType: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  codec: string | null;
  headers: Record<string, string>;
  requiresProxy: boolean;
  supportsRange: boolean;
  downloadAuthorizationToken?: string | null;
};

export type StreamingLyricsLine = {
  timeMs: number | null;
  text: string;
  translation?: string | null;
  romanization?: string | null;
};

export type StreamingLyricsResult = {
  provider: StreamingProviderName;
  providerTrackId: string;
  status: StreamingLyricsStatus;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  translationLyrics?: string | null;
  romanizationLyrics?: string | null;
  instrumental?: boolean;
  lines: StreamingLyricsLine[];
  sourceLabel: string | null;
};

export type StreamingMvItem = {
  id: string;
  provider: StreamingProviderName;
  providerMvId: string;
  providerTrackId: string | null;
  title: string;
  artist: string;
  duration: number | null;
  thumbnailUrl: string | null;
};

export type StreamingMvResult = {
  provider: StreamingProviderName;
  providerTrackId: string;
  status: StreamingMvStatus;
  items: StreamingMvItem[];
};

export type StreamingProviderDescriptor = {
  name: StreamingProviderName;
  displayName: string;
  enabled: boolean;
  supportsSearch: boolean;
  supportsPlayback?: boolean;
  supportsDownload?: boolean;
  supportsLyrics: boolean;
  supportsMv: boolean;
  requiresAccount: boolean;
  accountConnected?: boolean;
  accountDisplayName?: string | null;
  accountUsername?: string | null;
  accountAvatarUrl?: string | null;
  status?: 'ready' | 'needs_account' | 'disabled' | 'error';
  statusMessage?: string | null;
};

export type StreamingPlaylistImportRequest = {
  url: string;
};

export type StreamingPlaylistImportResult = {
  playlistId: string;
  playlistName: string;
  importedCount: number;
  provider: Extract<StreamingProviderName, 'netease' | 'qqmusic' | 'kugou' | 'spotify' | 'm3u8'>;
  providerPlaylistId: string;
};

export type StreamingFavoritesImportResult = {
  provider: StreamingFavoriteProviderName;
  providerPlaylistId: string;
  collectionId: string;
  playlistName: string;
  importedCount: number;
  addedCount: number;
  snapshot: StreamingFavoritesSnapshot;
};

export type StreamingLikedSongsSyncProviderResult = {
  provider: Extract<StreamingProviderName, 'netease' | 'qqmusic'>;
  success: boolean;
  importedCount: number;
  addedCount: number;
  total: number | null;
  error?: string;
};

export type StreamingLikedSongsSyncResult = {
  playlistId: string;
  importedCount: number;
  addedCount: number;
  providers: StreamingLikedSongsSyncProviderResult[];
  syncedAt: string;
};

export type StreamingTrackLikedResult = {
  liked: boolean;
};

export type StreamingFavoriteTrack = {
  id: string;
  provider: StreamingFavoriteProviderName;
  providerTrackId: string;
  stableKey: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string | null;
  duration: number | null;
  coverUrl: string | null;
  coverThumb: string | null;
  qualities: StreamingAudioQuality[];
  playable: boolean;
  unavailableReason: string | null;
  lyricsStatus: StreamingLyricsStatus;
  mvStatus: StreamingMvStatus;
  webUrl: string;
  addedAt: string;
  updatedAt: string;
};

export type StreamingFavoriteCollection = {
  id: string;
  provider: StreamingFavoriteProviderName;
  providerPlaylistId: string;
  name: string;
  sourceName: string | null;
  tracks: StreamingFavoriteTrack[];
  createdAt: string;
  updatedAt: string;
};

export type StreamingFavoritesSnapshot = {
  version: 1;
  updatedAt: string;
  providers: Record<StreamingFavoriteProviderName, StreamingFavoriteTrack[]>;
  collections: StreamingFavoriteCollection[];
};

export type StreamingFavoriteCollectionRenameResult = {
  collection: StreamingFavoriteCollection;
  snapshot: StreamingFavoritesSnapshot;
};

export type StreamingFavoriteCollectionDeleteResult = {
  collectionId: string;
  snapshot: StreamingFavoritesSnapshot;
};

export type StreamingFavoriteSetRequest = {
  track: StreamingTrack;
  favorite: boolean;
};

export type StreamingFavoriteSetResult = {
  favorite: boolean;
  item: StreamingFavoriteTrack | null;
  snapshot: StreamingFavoritesSnapshot;
};
