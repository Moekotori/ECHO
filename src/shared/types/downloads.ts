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

export type DownloadSearchProvider = 'youtube' | 'bilibili';

export type DownloadSearchScope = DownloadSearchProvider | 'all';

export type DownloadAudioStrategy = 'best_available';

export type DownloadSettings = {
  audioStrategy: DownloadAudioStrategy;
  importToLibrary: boolean;
  bindMvAfterImport: boolean;
  outputDirectory: string | null;
};

export type DownloadJob = {
  id: string;
  sourceUrl: string;
  provider: DownloadSourceProvider;
  audioStrategy: DownloadAudioStrategy;
  status: DownloadJobStatus;
  title: string | null;
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

export type DownloadToolsStatus = {
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
  ytDlpVersion: string | null;
  ytDlpPath: string | null;
  ffmpegPath: string | null;
};
