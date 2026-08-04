import type { MetadataResult } from '../libraryTypes';

export interface MetadataReader {
  read(filePath: string): Promise<MetadataResult>;
}
