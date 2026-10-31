/** Qobuz subscription tier mapped from credential parameters. */
export type QobuzTier = 'free' | 'studio' | 'sublime';

/** Qobuz API format_id values for audio quality levels. */
export type QobuzFormatId = 5 | 6 | 7 | 27;

/** Authentication state snapshot exposed to renderer. */
export interface QobuzAuthState {
  valid: boolean;
  tier: QobuzTier | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  expiresAt: number | null;
  lastValidatedAt: number;
}

/** Result returned from startBrowserLogin / manual login flows. */
export interface QobuzLoginResult {
  success: boolean;
  tier: QobuzTier | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  error?: string;
}

/** Manual credentials passed from the settings UI.
 *  userAuthToken: required — obtained from browser DevTools after login + playing a track
 *  appId / appSecret: optional — auto-extracted from bundle; manual fallback */
export interface QobuzManualCredentials {
  userAuthToken: string;
  appId?: string;
  appSecret?: string;
}

/** Response from track/getFileUrl (signed endpoint).
 *  Qobuz API returns snake_case keys — we map to camelCase in getTrackFileUrl(). */
export interface QobuzTrackFileUrlRaw {
  url: string;
  track_id: number;
  duration: number;
  format_id: QobuzFormatId;
  mime_type: string;
  bit_depth: number | null;
  sampling_rate: number | null;
  restrictions: string | null;
}

/** Mapped to camelCase for internal use. */
export interface QobuzTrackFileUrl {
  url: string;
  trackId: number;
  duration: number;
  formatId: QobuzFormatId;
  mimeType: string;
  bitDepth: number | null;
  sampleRate: number | null;
  restrictions: string | null;
}

/** A single track item as returned by album/get tracks.items[]. */
export interface QobuzTrackItem {
  id: number;
  title: string;
  duration: number;
  track_number: number;
  media_number: number;
  streamable: boolean;
  parental_warning: boolean;
  performer: { id: number; name: string };
  album: QobuzAlbumBrief;
  maximum_format_id: number;
  maximum_bit_depth: number;
  maximum_sampling_rate: number;
}

/** Brief album reference embedded in track/artist responses. */
export interface QobuzAlbumBrief {
  id: number;
  title: string;
  image: { small: string; large: string } | null;
  artist: { id: number; name: string } | null;
}

/** Result from bundle extraction (app_id + secrets from play.qobuz.com). */
export interface QobuzBundleSecrets {
  appId: string;
  secrets: string[];
  bundleVersion: string;
  extractedAt: number;
}

/** Options for album downloads. */
export interface QobuzDownloadOptions {
  outputDir?: string;
  quality?: QobuzFormatId;
  folderFormat?: string;
  trackFormat?: string;
  embedCover?: boolean;
  importToLibrary?: boolean;
}

/** Quality display metadata. */
export interface QobuzQualityInfo {
  formatId: QobuzFormatId;
  label: string;
  description: string;
  extension: 'mp3' | 'flac';
  mimeType: 'audio/mpeg' | 'audio/flac';
}

/** Quality level metadata. */
export const QOBUZ_QUALITY_LEVELS: QobuzQualityInfo[] = [
  { formatId: 5, label: 'MP3 320kbps', description: '标准音质', extension: 'mp3', mimeType: 'audio/mpeg' },
  { formatId: 6, label: 'FLAC 16-bit 44.1kHz', description: 'CD 无损', extension: 'flac', mimeType: 'audio/flac' },
  { formatId: 7, label: 'FLAC 24-bit ≤96kHz', description: '高解析度', extension: 'flac', mimeType: 'audio/flac' },
  { formatId: 27, label: 'FLAC 24-bit >96kHz', description: '超高解析度', extension: 'flac', mimeType: 'audio/flac' },
];

export const QOBUZ_QUALITY_BY_FORMAT = new Map<QobuzFormatId, QobuzQualityInfo>(
  QOBUZ_QUALITY_LEVELS.map((q) => [q.formatId, q]),
);
