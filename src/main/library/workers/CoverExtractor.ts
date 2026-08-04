import type { CoverCacheRepairOptions, CoverExtractOptions, CoverResult } from '../libraryTypes';

export interface CoverExtractor {
  extract(filePath: string, options: CoverExtractOptions): Promise<CoverResult>;
  repairCachedCover?(options: CoverCacheRepairOptions): Promise<CoverResult>;
}
