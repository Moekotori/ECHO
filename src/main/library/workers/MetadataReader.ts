import type { MetadataResult } from '../libraryTypes';

export type MetadataReadOptions = {
  readCover?: boolean;
};

export interface MetadataReader {
  read(filePath: string, options?: MetadataReadOptions): Promise<MetadataResult>;
}
