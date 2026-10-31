import type { ScannedFile, ScanOptions } from '../libraryTypes';

export interface FileScanner {
  scanFolder(folderPath: string, options?: ScanOptions): AsyncIterable<ScannedFile>;
}
