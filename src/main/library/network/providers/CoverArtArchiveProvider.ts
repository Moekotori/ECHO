import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkCoverCandidateInput } from '../networkTypes';

export class CoverArtArchiveProvider implements NetworkMetadataProvider {
  readonly name = 'cover-art-archive' as const;

  async findMetadata(): Promise<[]> {
    return [];
  }

  async findCovers(): Promise<NetworkCoverCandidateInput[]> {
    return [];
  }
}
