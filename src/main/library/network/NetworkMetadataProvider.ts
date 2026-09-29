import type { NetworkCoverCandidateInput, NetworkMetadataCandidateInput, NetworkTrackLookup } from './networkTypes';

export interface NetworkMetadataProvider {
  readonly name: NetworkMetadataCandidateInput['provider'];
  findMetadata(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkMetadataCandidateInput[]>;
  findCovers?(track: NetworkTrackLookup, signal?: AbortSignal): Promise<NetworkCoverCandidateInput[]>;
}
