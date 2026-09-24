import type { StreamingProviderName } from './streaming';

export type DownloadJobStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'extracting_audio'
  | 'importing'
  | 'binding_mv'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DownloadSourceProvider = 'youtube' | 'bilibili' | 'soundcloud' | 'osu' | 'unknown';

export type DownloadSearchProvider = 'youtube' | 'bilibili' | 'osu';

export type DownloadSearchScope = DownloadSearchProvider | 'all';

export type DownloadAudioStrategy = 'best_available';

export const osuDownloadMirrorValues = ['auto', 'official', 'sayobot', 'catboy', 'nerinyan'] as const;

export type OsuDownloadMirror = (typeof osuDownloadMirrorValues)[number];

export type DownloadSettings = {
  audioStrategy: DownloadAudioStrategy;
  importToLibrary: boolean;
  bindMvAfterImport: boolean;
  outputDirectory: string | null;
  osuOutputDirectory: string | null;
  osuDownloadMirror: OsuDownloadMirror;
};

export type DownloadJob = {
  id: string;
  sourceUrl: string;
  provider: DownloadSourceProvider;
  audioStrategy: DownloadAudioStrategy;
  status: DownloadJobStatus;
  title: string | null;
  artist?: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  webpageUrl: string | null;
  outputPath: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  importedTrackId: string | null;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateDownloadUrlJobOptions = Partial<Pick<DownloadSettings, 'importToLibrary' | 'bindMvAfterImport'>> & {
  providerLock?: DownloadSearchProvider;
  osuDownloadMirror?: OsuDownloadMirror;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  coverUrl?: string | null;
  webpageUrl?: string;
  requestHeaders?: Record<string, string>;
  outputSubdirectory?: string | null;
  directAudio?: boolean;
  directAudioMimeType?: string | null;
  directAudioExtension?: string | null;
  streamingProvider?: StreamingProviderName;
  streamingProviderTrackId?: string;
  streamingStableKey?: string;
  downloadAuthorizationToken?: string | null;
  deferImportToLibrary?: boolean;
};

export type DownloadSearchRequest = {
  query: string;
  limitPerProvider?: number;
  provider?: DownloadSearchScope;
  providerLock?: DownloadSearchProvider;
};

export type DownloadSearchResult = {
  id: string;
  provider: DownloadSearchProvider;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  webpageUrl: string;
  viewCount: number | null;
  publishedAt: string | null;
};

export type DownloadSearchProviderError = {
  provider: DownloadSearchProvider;
  error: string;
};

export type DownloadSearchResponse = {
  results: DownloadSearchResult[];
  errors: DownloadSearchProviderError[];
};

export const osuRulesetValues = ['osu', 'taiko', 'fruits', 'mania'] as const;

export type OsuRuleset = (typeof osuRulesetValues)[number];

export type OsuAccountProfile = {
  userId: number;
  username: string;
  avatarUrl: string | null;
  countryCode: string | null;
  isOnline: boolean | null;
  isSupporter: boolean;
  defaultRuleset: OsuRuleset;
  globalRank: number | null;
  countryRank: number | null;
  performancePoints: number | null;
  hitAccuracy: number | null;
  level: number | null;
  playCount: number | null;
  maximumCombo: number | null;
  playTimeSeconds: number | null;
  bestScoreCount: number | null;
  favouriteBeatmapsetCount: number | null;
  mostPlayedBeatmapCount: number | null;
};

export type OsuAccountCollectionKind = 'best' | 'favourites' | 'most_played';

export type OsuAccountCollectionRequest =
  | {
      kind: 'best';
      ruleset: OsuRuleset;
      start: number;
      end: number;
    }
  | {
      kind: 'favourites';
    }
  | {
      kind: 'most_played';
      offset?: number;
      limit?: number;
    };

export type OsuAccountBeatmapItem = {
  key: string;
  beatmapsetId: string;
  beatmapId: string | null;
  title: string;
  artist: string | null;
  creator: string | null;
  coverUrl: string | null;
  webpageUrl: string;
  durationSeconds: number | null;
  position: number;
  pp: number | null;
  accuracy: number | null;
  scoreRank: string | null;
  mods: string[];
  difficultyName: string | null;
  starRating: number | null;
  playCount: number | null;
};

export type OsuAccountCollectionResponse = {
  profile: OsuAccountProfile;
  kind: OsuAccountCollectionKind;
  items: OsuAccountBeatmapItem[];
  total: number | null;
};

export type DownloadToolsStatus = {
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
  ytDlpVersion: string | null;
  ytDlpPath: string | null;
  ffmpegPath: string | null;
};
