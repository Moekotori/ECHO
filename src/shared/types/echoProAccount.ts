import type { StreamingFavoritesSnapshot, StreamingProviderName, StreamingTrack } from './streaming';

export type EchoProAccountStatus = {
  loggedIn: boolean;
  username: string | null;
  displayName: string | null;
  pro: boolean;
  status: 'anonymous' | 'active' | 'inactive' | 'disabled';
  machineCount: number;
  maxMachineCount: number;
  checkedAt: string | null;
  lastError: string | null;
};

export type EchoProAccountCredentials = {
  username: string;
  password: string;
};

export type EchoProAccountStatusOptions = {
  force?: boolean;
};

export type EchoProKeyRedeemResult = {
  ok: boolean;
  redeemedAt: string;
  status: EchoProAccountStatus;
};

export type EchoProReleaseDevicesResult = {
  ok: boolean;
  releasedAt: string;
  releasedCount: number;
  status: EchoProAccountStatus;
};

export type EchoProSettingsCloudStatus = {
  available: boolean;
  lastSavedAt: string | null;
  lastPulledAt: string | null;
  lastAppliedAt: string | null;
  appVersion: string | null;
  deviceName: string | null;
  settingsCount: number;
  librarySyncPlaylistCount: number;
  librarySyncFavoriteTrackCount: number;
  lastError: string | null;
};

export type EchoProCloudPlaylistProvider = Extract<StreamingProviderName, 'netease' | 'qqmusic' | 'kugou' | 'spotify'>;

export type EchoProCloudStreamingPlaylistTrack = Pick<
  StreamingTrack,
  | 'id'
  | 'provider'
  | 'providerTrackId'
  | 'stableKey'
  | 'title'
  | 'artist'
  | 'artists'
  | 'album'
  | 'albumId'
  | 'albumArtist'
  | 'duration'
  | 'coverUrl'
  | 'coverThumb'
  | 'qualities'
  | 'explicit'
  | 'playable'
  | 'unavailableReason'
  | 'lyricsStatus'
  | 'mvStatus'
>;

export type EchoProCloudStreamingPlaylist = {
  provider: EchoProCloudPlaylistProvider;
  providerPlaylistId: string;
  title: string;
  description: string | null;
  creator: string | null;
  coverUrl: string | null;
  coverThumb: string | null;
  trackCount: number | null;
  updatedAt: string;
  tracks: EchoProCloudStreamingPlaylistTrack[];
};

export type EchoProCloudLibrarySyncPayload = {
  version: 1;
  savedAt: string;
  streamingPlaylists: EchoProCloudStreamingPlaylist[];
  streamingFavorites: StreamingFavoritesSnapshot;
};

export type EchoProSettingsCloudSaveResult = EchoProSettingsCloudStatus & {
  savedAt: string;
};

export type EchoProSettingsCloudPullResult = EchoProSettingsCloudStatus & {
  settings: Record<string, unknown> | null;
  librarySync: EchoProCloudLibrarySyncPayload | null;
};

export type EchoProSettingsCloudApplyResult = EchoProSettingsCloudStatus & {
  appliedAt: string;
};
