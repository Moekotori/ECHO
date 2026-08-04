import type { IAudioMetadata } from 'music-metadata';
import type { MetadataResult, ParsedTrackMetadata, ScannedAudioFile } from './libraryTypes';
import { TsMetadataReader } from './workers/TsMetadataReader';

export const flattenMetadataResult = (result: MetadataResult): ParsedTrackMetadata => ({
  ...result.fields,
  fieldSources: result.fieldSources,
  embeddedCover: result.embeddedCover,
  embeddedMetadataStatus: result.embeddedMetadataStatus,
  embeddedCoverStatus: result.embeddedCoverStatus,
  warnings: result.warnings,
  errors: result.errors,
  metadataStatus: result.status,
});

export const inflateMetadataResult = (metadata: ParsedTrackMetadata): MetadataResult => ({
  fields: {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    albumArtist: metadata.albumArtist,
    trackNo: metadata.trackNo,
    discNo: metadata.discNo,
    year: metadata.year,
    genre: metadata.genre,
    duration: metadata.duration,
    codec: metadata.codec,
    sampleRate: metadata.sampleRate,
    bitDepth: metadata.bitDepth,
    bitrate: metadata.bitrate,
    bpm: metadata.bpm ?? null,
  },
  fieldSources: metadata.fieldSources,
  embeddedCover: metadata.embeddedCover,
  embeddedMetadataStatus: metadata.embeddedMetadataStatus ?? 'present',
  embeddedCoverStatus: metadata.embeddedCoverStatus ?? (metadata.embeddedCover ? 'present' : 'missing'),
  warnings: metadata.warnings ?? [],
  errors: metadata.errors ?? [],
  status: metadata.metadataStatus ?? 'ok',
});

export class MetadataService {
  private readonly reader = new TsMetadataReader();

  async read(file: ScannedAudioFile): Promise<ParsedTrackMetadata> {
    return flattenMetadataResult(await this.reader.read(file.path));
  }

  normalize(filePath: string, metadata: IAudioMetadata): ParsedTrackMetadata {
    return flattenMetadataResult(this.reader.normalize(filePath, metadata));
  }
}
