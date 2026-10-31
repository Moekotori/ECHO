import type { MetadataResult } from '../libraryTypes';

export type MetadataReadOptions = {
  readCover?: boolean;
  cueTrack?: import('../../audio/CueSheet').CueTrack;
};

export interface MetadataReader {
  read(filePath: string, options?: MetadataReadOptions): Promise<MetadataResult>;
}
