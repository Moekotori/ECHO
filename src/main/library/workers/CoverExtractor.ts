import { createHash } from 'node:crypto';
import type { CoverCacheRepairOptions, CoverExtractOptions, CoverResult } from '../libraryTypes';

export const getEmbeddedCoverSourceHash = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export interface CoverExtractor {
  extract(filePath: string, options: CoverExtractOptions): Promise<CoverResult>;
  repairCachedCover?(options: CoverCacheRepairOptions): Promise<CoverResult>;
}
