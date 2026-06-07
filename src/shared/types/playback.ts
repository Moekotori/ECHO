import type { AudioOutputSettings, AudioPlaybackState } from './audio';
import type { LibraryTrack } from './library';
import type { PlayableTrack } from './remoteSources';
import type { ReplayGainTrackData } from '../utils/replayGain';

export type PlaybackStatus = {
  state: AudioPlaybackState;
  currentTrackId: string | null;
  positionMs: number;
  durationMs: number;
  filePath: string | null;
};

export type PlaybackProbeHint = {
  durationSeconds?: number;
  fileSampleRate?: number | null;
  channels?: number;
  codec?: string | null;
  bitDepth?: number | null;
  bitrate?: number | null;
  bpm?: number | null;
  bpmConfidence?: number | null;
  beatOffsetMs?: number | null;
};

export type PlaybackTrackMetadataHint = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  coverUrl?: string | null;
};

export type PlaybackAutomixOptions = {
  enabled?: boolean;
  maxTransitionSeconds?: number;
  beatAlignEnabled?: boolean;
  nextItem?: PlayableTrack | null;
  nextProbe?: PlaybackProbeHint;
  upcomingItems?: PlayableTrack[];
  upcomingProbes?: PlaybackProbeHint[];
};

export type PlaybackGaplessOptions = {
  enabled?: boolean;
  nextItem?: PlayableTrack | null;
  nextProbe?: PlaybackProbeHint;
  upcomingItems?: PlayableTrack[];
  upcomingProbes?: PlaybackProbeHint[];
};

export type PlaybackStartRequest = {
  filePath: string;
  trackId?: string;
  metadata?: PlaybackTrackMetadataHint;
  startSeconds?: number;
  output?: AudioOutputSettings;
  probe?: PlaybackProbeHint;
  replayGain?: ReplayGainTrackData | null;
  automix?: PlaybackAutomixOptions;
  gapless?: PlaybackGaplessOptions;
  automixAnalyze?: boolean;
};

export type PlaybackPrepareLocalFileRequest = {
  filePath: string;
  inputHeaders?: Record<string, string>;
  trackId?: string;
  probe?: PlaybackProbeHint;
  replayGain?: ReplayGainTrackData | null;
  automixAnalyze?: boolean;
};

export type PlaybackMediaStartRequest = {
  item: PlayableTrack;
  startSeconds?: number;
  output?: AudioOutputSettings;
  automix?: PlaybackAutomixOptions;
  gapless?: PlaybackGaplessOptions;
  automixAnalyze?: boolean;
  forceRefresh?: boolean;
};

export type PlaybackResolvedMediaSource = {
  filePath: string;
  inputHeaders?: Record<string, string>;
  mimeType?: string | null;
  probe?: PlaybackProbeHint;
  durationSeconds: number | null;
};

export type LocalFileOpenRejectionReason = 'missing' | 'not_file' | 'unsupported';

export type LocalFileOpenRejection = {
  path: string;
  reason: LocalFileOpenRejectionReason;
};

export type LocalFileResolveResult = {
  tracks: LibraryTrack[];
  rejected: LocalFileOpenRejection[];
};

export type PersistedPlaybackRepeatMode = 'off' | 'one' | 'all';

export type PersistedQueueSource =
  | { type: 'songs'; label: string; search?: string; sort?: string; hideDuplicates?: boolean; showDuplicatesOnly?: boolean }
  | { type: 'album'; label: string; albumId: string }
  | { type: 'artist'; label: string; artistId?: string }
  | { type: 'folder'; label: string; folderId: string; path: string; recursive: boolean; search?: string; sort?: string }
  | { type: 'liked'; label: string; sourceProvider: 'local' | 'netease' | 'qqmusic'; search?: string; sort?: string }
  | { type: 'streaming'; label: string; provider: string }
  | { type: 'local-file'; label: string }
  | { type: 'manual'; label: string };

export type PersistedQueueItem = {
  queueId: string;
  track: LibraryTrack;
  source: PersistedQueueSource;
  addedAt: string;
};

export type PersistedPlaybackSessionMode = {
  isShuffleEnabled: boolean;
  repeatMode: PersistedPlaybackRepeatMode;
  automixEnabled: boolean;
  autoFillQueueEnabled?: boolean;
};

export type PersistedPlaybackSessionResume = {
  queueId: string | null;
  trackId: string | null;
  filePath: string;
  positionMs: number;
  durationMs: number;
  state: AudioPlaybackState;
  updatedAt: string;
};

export type PersistedPlaylistPlaybackSnapshot = {
  items: PersistedQueueItem[];
  currentQueueId: string | null;
  currentTrackId: string | null;
  lastPlayedTrack: LibraryTrack | null;
  history: PersistedQueueItem[];
  mode: PersistedPlaybackSessionMode;
  resume: PersistedPlaybackSessionResume | null;
};

export type PersistedPlaylistPlaybackState = {
  active: boolean;
  label: string | null;
  playlistId: string | null;
  snapshot: PersistedPlaylistPlaybackSnapshot | null;
};

export type PersistedPlaybackSessionV1 = {
  version: 1;
  items: PersistedQueueItem[];
  currentQueueId: string | null;
  currentTrackId: string | null;
  lastPlayedTrack: LibraryTrack | null;
  history: PersistedQueueItem[];
  mode: PersistedPlaybackSessionMode;
  resume: PersistedPlaybackSessionResume | null;
  updatedAt: string;
  playlistPlayback?: PersistedPlaylistPlaybackState | null;
};

export type PlaybackQueueSessionSaveOptions = {
  broadcastSnapshot?: PersistedPlaybackSessionV1 | null;
};
