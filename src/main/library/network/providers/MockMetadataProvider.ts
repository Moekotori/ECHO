import type { NetworkMetadataProvider } from '../NetworkMetadataProvider';
import type { NetworkMetadataCandidateInput, NetworkTrackLookup } from '../networkTypes';

export class MockMetadataProvider implements NetworkMetadataProvider {
  readonly name = 'mock' as const;

  async findMetadata(track: NetworkTrackLookup): Promise<NetworkMetadataCandidateInput[]> {
    const titleLooksMissing = !track.title || track.title === 'Untitled' || track.fieldSources.title === 'filename_fallback';
    const artistLooksMissing = !track.artist || track.artist === 'Unknown Artist' || track.fieldSources.artist === 'unknown';

    if (!titleLooksMissing && !artistLooksMissing) {
      return [];
    }

    return [
      {
        provider: this.name,
        providerItemId: `mock:${track.trackId}`,
        title: titleLooksMissing ? track.filename.replace(/\.[^.]+$/, '') : track.title,
        artist: artistLooksMissing ? 'Recovered Artist' : track.artist,
        album: track.album || null,
        albumArtist: artistLooksMissing ? 'Recovered Artist' : track.albumArtist || track.artist,
        year: track.year,
        genre: null,
        duration: track.duration || null,
        trackNo: track.trackNo,
        discNo: null,
        coverUrl: null,
        raw: { mock: true },
      },
    ];
  }
}
