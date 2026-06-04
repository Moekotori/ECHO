export type LyricWordTiming = {
  text: string;
  startMs: number;
  endMs: number | null;
};

export type LyricLine = {
  timeMs: number;
  text: string;
  words?: LyricWordTiming[];
  translation?: string | null;
  romanization?: string | null;
  kana?: string | null;
};

export type LyricsKind = 'empty' | 'plain' | 'synced' | 'instrumental';

export type LyricsProviderId =
  | 'local'
  | 'lrclib'
  | 'amll-ttml'
  | 'netease'
  | 'qqmusic'
  | 'kugou'
  | 'kuwo'
  | 'musixmatch'
  | 'genius'
  | 'manual';

export type LyricsSource = 'none' | LyricsProviderId | 'cached';

export type LyricsMatchRisk = 'low' | 'medium' | 'high';

export type TrackLyrics = {
  id: string;
  trackId: string | null;
  provider: LyricsSource;
  providerLyricsId?: string | null;
  kind: LyricsKind;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  lines: LyricLine[];
  plainText?: string | null;
  syncedText?: string | null;
  offsetMs: number;
  score?: number | null;
  cachedAt: string;
  updatedAt: string;
};

export type LyricsSearchCandidate = {
  id: string;
  provider: LyricsProviderId;
  providerLyricsId?: string | null;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  instrumental: boolean;
  hasSynced: boolean;
  hasPlain: boolean;
  score: number;
  sourceLabel: string;
  risk?: LyricsMatchRisk;
  reasons?: string[];
  titleScore?: number;
  artistScore?: number;
  albumScore?: number;
  durationScore?: number;
  versionScore?: number;
};

export type LyricsQuery = {
  trackId?: string | null;
  mediaType?: 'local' | 'remote' | 'streaming';
  sourceId?: string | null;
  stableKey?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  durationSeconds?: number | null;
  filePath?: string | null;
};

export type LyricsTrackSnapshotRequest = {
  trackId: string;
  title: string;
  artist: string;
  album?: string | null;
  albumArtist?: string | null;
  durationSeconds?: number | null;
  mediaType?: 'local' | 'remote' | 'streaming';
  sourceId?: string | null;
  stableKey?: string | null;
};

export type LyricsEmbedToTrackRequest = {
  candidateId?: string | null;
  preferSynced?: boolean;
};

export type LyricsEmbedTextKind = 'synced' | 'plain';

export type LyricsEmbedToTrackResult = {
  trackId: string;
  provider: LyricsSource;
  kind: LyricsKind;
  textKind: LyricsEmbedTextKind;
  queued: boolean;
  message: string;
};
