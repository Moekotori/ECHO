/**
 * Album splitting turns one CUE image (sidecar or embedded) into one tagged file per track.
 * The library already exposes those albums as virtual `#cueTrack=N` tracks. Splitting writes
 * new files with FFmpeg and never modifies or deletes the original image or CUE.
 */

export const albumSplitFormats = ['flac', 'mp3', 'wav', 'ogg'] as const;
export type AlbumSplitFormat = (typeof albumSplitFormats)[number];

export const albumSplitFileNamePatterns = ['track-title', 'track-artist-title', 'artist-title', 'title'] as const;
export type AlbumSplitFileNamePattern = (typeof albumSplitFileNamePatterns)[number];

export type AlbumSplitSkipReason = 'not-cue' | 'missing-source' | 'remote';

export type AlbumSplitPlanTrack = {
  trackId: string;
  trackNumber: number;
  discNumber: number | null;
  title: string;
  artist: string;
  sourcePath: string;
  startSeconds: number;
  /** `null` means "until the end of the source file". */
  durationSeconds: number | null;
  /** Suggested output file name (without directory) for the requested pattern + format. */
  fileName: string;
};

export type AlbumSplitPlanSkippedTrack = {
  trackId: string;
  title: string;
  reason: AlbumSplitSkipReason;
};

export type AlbumSplitSourceFile = {
  path: string;
  sizeBytes: number | null;
  codec: string | null;
};

export type AlbumSplitBackupFile = {
  path: string;
  role: 'audio' | 'cue';
  sizeBytes: number | null;
};

export type AlbumSplitPlan = {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  year: number | null;
  trackTotal: number;
  sourceFiles: AlbumSplitSourceFile[];
  backupFiles: AlbumSplitBackupFile[];
  tracks: AlbumSplitPlanTrack[];
  skippedTracks: AlbumSplitPlanSkippedTrack[];
  hasCover: boolean;
  ffmpegAvailable: boolean;
  ffmpegError: string | null;
  suggestedOutputDir: string;
  suggestedBackupDir: string;
};

export type AlbumSplitPlanOptions = {
  format?: AlbumSplitFormat;
  fileNamePattern?: AlbumSplitFileNamePattern;
};

export type AlbumSplitRequest = {
  albumId: string;
  outputDir: string;
  format: AlbumSplitFormat;
  fileNamePattern: AlbumSplitFileNamePattern;
  embedCover: boolean;
  importAfter: boolean;
  overwrite: boolean;
  /** Required. Splitting refuses to write until the user confirms a separate backup. */
  backupConfirmed: boolean;
};

export type AlbumSplitOutputStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export type AlbumSplitOutput = {
  trackId: string;
  trackNumber: number;
  title: string;
  fileName: string;
  status: AlbumSplitOutputStatus;
  error: string | null;
};

export type AlbumSplitJobStatus = {
  id: string;
  albumId: string;
  status: 'queued' | 'backing-up' | 'running' | 'importing' | 'completed' | 'cancelled' | 'failed';
  outputDir: string;
  backupDir: string | null;
  format: AlbumSplitFormat;
  total: number;
  completed: number;
  failed: number;
  backupTotal: number;
  backupCompleted: number;
  currentTitle: string | null;
  outputs: AlbumSplitOutput[];
  importedCount: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};
