import type { EmbeddedReadinessStatus, FieldSources, NetworkMetadataStatus } from '../libraryTypes';
import type { LibraryTrack, MissingMetadataReason } from '../../../shared/types/library';

export type NetworkProviderName = 'mock' | 'musicbrainz' | 'cover-art-archive' | 'netease-cloud-music' | 'qq-music' | 'kugou-music';

export type NetworkCompletionSource = NetworkProviderName;

export type NetworkTrackLookup = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  duration: number;
  trackNo: number | null;
  year: number | null;
  filename: string;
  folder: string;
  fieldSources: FieldSources;
  embeddedMetadataStatus: EmbeddedReadinessStatus;
  embeddedCoverStatus: EmbeddedReadinessStatus;
};

export type NetworkMissingMetadataTarget = NetworkTrackLookup & {
  track: LibraryTrack;
  reasons: MissingMetadataReason[];
  coverSource: string | null;
};

export type NetworkMetadataCandidateInput = {
  provider: NetworkProviderName;
  providerItemId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  trackNo: number | null;
  discNo: number | null;
  coverUrl: string | null;
  raw: unknown;
};

export type StoredNetworkMetadataCandidate = NetworkMetadataCandidateInput & {
  id: string;
  trackId: string;
  albumId: string | null;
  score: number;
  createdAt: string;
};

export type NetworkCoverCandidateInput = {
  provider: NetworkProviderName;
  coverUrl: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  score: number;
  raw: unknown;
};

export type StoredNetworkCoverCandidate = NetworkCoverCandidateInput & {
  id: string;
  trackId: string | null;
  albumId: string | null;
  cachedThumbPath: string | null;
  cachedLargePath: string | null;
  createdAt: string;
};

export type NetworkDecision = 'accepted' | 'rejected' | 'ignored';

export type AppliedNetworkFields = Partial<{
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: number;
  genre: string;
  trackNo: number;
  discNo: number;
  coverId: string;
}>;

export type NetworkApplyResult = {
  status: NetworkMetadataStatus;
  appliedFields: AppliedNetworkFields;
  reason?: string;
};
