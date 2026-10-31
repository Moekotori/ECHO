import type { EchoApi } from '../../../preload/apiTypes';
import type { ImportPathClassification, LibraryFolder, LibraryScanStatus } from '../../../shared/types/library';
import { translateFallback } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';

export type DroppedImportResult = {
  addedFolderCount: number;
  scannedAudioFolderCount: number;
  importedFileCount: number;
  ignoredCount: number;
  missingCount: number;
  failedCount: number;
  importedFolderPaths: string[];
};

type LibraryImportBridge = Pick<EchoApi['library'], 'addFolder' | 'classifyImportPaths' | 'importAudioFiles' | 'scanFolder'>;

type HandleDroppedImportOptions = {
  onScanStatus?: (status: LibraryScanStatus) => void;
};

type Translate = (key: TranslationKey, options?: Record<string, string | number>) => string;

const uniquePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    const trimmed = path.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
};

export const dirnameFromImportPath = (filePath: string): string => {
  const normalized = filePath.trim().replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));

  if (separatorIndex <= 0) {
    return '';
  }

  return normalized.slice(0, separatorIndex);
};

const importAndScanFolder = async (
  library: LibraryImportBridge,
  folderPath: string,
  options: HandleDroppedImportOptions,
): Promise<LibraryFolder | null> => {
  try {
    const folder = await library.addFolder(folderPath);
    const scanStatus = await library.scanFolder(folder.id);
    options.onScanStatus?.(scanStatus);
    return folder;
  } catch (error) {
    console.error('Failed to import dropped path', folderPath, error);
    return null;
  }
};

export const summarizeDroppedImport = (result: DroppedImportResult, t: Translate = translateFallback): string => {
  const parts: string[] = [];

  if (result.addedFolderCount > 0) {
    parts.push(t('import.dragDrop.paths.addedFolders', { count: result.addedFolderCount }));
  }

  if (result.scannedAudioFolderCount > 0) {
    parts.push(t('import.dragDrop.paths.scannedAudioFolders', { count: result.scannedAudioFolderCount }));
  }

  if (result.importedFileCount > 0) {
    parts.push(t('import.dragDrop.paths.importedFiles', { count: result.importedFileCount }));
  }

  if (result.ignoredCount > 0) {
    parts.push(t('import.dragDrop.paths.ignored', { count: result.ignoredCount }));
  }

  if (result.missingCount > 0) {
    parts.push(t('import.dragDrop.paths.missing', { count: result.missingCount }));
  }

  if (result.failedCount > 0) {
    parts.push(t('import.dragDrop.paths.failed', { count: result.failedCount }));
  }

  return parts.length > 0 ? parts.join(t('punctuation.clauseSeparator')) : t('import.dragDrop.paths.empty');
};

export const handleDroppedImportPaths = async (
  paths: string[],
  library: LibraryImportBridge,
  options: HandleDroppedImportOptions = {},
): Promise<DroppedImportResult> => {
  const classification: ImportPathClassification = await library.classifyImportPaths(uniquePaths(paths));
  const folderPaths = uniquePaths(classification.folders);
  const audioFolderPaths = uniquePaths(classification.audioFiles.map(dirnameFromImportPath).filter(Boolean));
  const result: DroppedImportResult = {
    addedFolderCount: 0,
    scannedAudioFolderCount: 0,
    importedFileCount: 0,
    ignoredCount: classification.unsupportedFiles.length,
    missingCount: classification.missingPaths.length,
    failedCount: 0,
    importedFolderPaths: [],
  };

  for (const folderPath of folderPaths) {
    const folder = await importAndScanFolder(library, folderPath, options);
    if (folder) {
      result.addedFolderCount += 1;
      result.importedFolderPaths.push(folder.path);
    } else {
      result.failedCount += 1;
    }
  }

  for (const folderPath of audioFolderPaths) {
    const folder = await importAndScanFolder(library, folderPath, options);
    if (folder) {
      result.scannedAudioFolderCount += 1;
      result.importedFolderPaths.push(folder.path);
    } else {
      result.failedCount += 1;
    }
  }

  if (classification.osuArchives.length > 0) {
    try {
      const imported = await library.importAudioFiles(classification.osuArchives);
      result.importedFileCount += imported.importedCount;
      result.failedCount += imported.failedCount;
    } catch (error) {
      console.error('Failed to import dropped osu archives', error);
      result.failedCount += classification.osuArchives.length;
    }
  }

  if (result.addedFolderCount > 0 || result.scannedAudioFolderCount > 0 || result.importedFileCount > 0) {
    window.dispatchEvent(new Event('library:changed'));
  }

  return result;
};
