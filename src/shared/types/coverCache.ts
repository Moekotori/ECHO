export type CoverCacheMigrationResult = {
  oldDir: string;
  newDir: string;
  copiedFiles: number;
  skippedFiles: number;
  updatedCoverRows: number;
  warnings: string[];
  errors: string[];
};

export type SetCoverCacheDirectoryRequest = {
  directory: string | null;
  migrate: boolean;
};

export type AppCacheKind = 'cover' | 'artist-image' | 'smtc-cover' | 'download' | 'lyrics-mv';

export type AppCacheInventoryItem = {
  kind: AppCacheKind;
  label: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  movable: boolean;
  reason: string;
  lastError: string | null;
};

export type AppCacheInventory = {
  items: AppCacheInventoryItem[];
  totalSizeBytes: number;
  generatedAt: string;
};
