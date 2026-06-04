import type {
  DuplicateTrackGroup,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
} from '../../../shared/types/library';

export type {
  DuplicateTrackGroup,
  DuplicateTrackCleanupPreview,
  DuplicateTrackIndexSummary,
  DuplicateTrackMember,
  DuplicateTrackMode,
};

export type DuplicateIdentityResult = {
  key: string;
  normalizedTitle: string;
  normalizedArtist: string;
  roundedDurationSeconds: number;
  confidence: number;
  reasons: string[];
};

export type DuplicateDecision = {
  duplicate: boolean;
  confidence: number;
  reasons: string[];
};

export type TrackLikeForDuplicate = {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  albumArtist?: string | null;
  duration: number;
  codec?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  bitrate?: number | null;
  coverId?: string | null;
  sizeBytes?: number | null;
  path?: string | null;
  metadataStatus?: string | null;
};
