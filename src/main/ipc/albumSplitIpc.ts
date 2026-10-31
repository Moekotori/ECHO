import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AlbumSplitPlanOptions, AlbumSplitRequest } from '../../shared/types/albumSplit';
import type { ImportAudioFilesResult } from '../../shared/types/library';
import { AlbumSplitService } from '../library/AlbumSplitService';
import { normalizeAlbumSplitFileNamePattern, normalizeAlbumSplitFormat } from '../library/AlbumSplitCommand';
import { getLibraryService } from '../library/LibraryService';

let albumSplitService: AlbumSplitService | null = null;

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

const normalizeAlbumSplitPlanOptions = (value: unknown): AlbumSplitPlanOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const input = value as { format?: unknown; fileNamePattern?: unknown };
  return {
    ...(input.format !== undefined ? { format: normalizeAlbumSplitFormat(input.format) } : {}),
    ...(input.fileNamePattern !== undefined ? { fileNamePattern: normalizeAlbumSplitFileNamePattern(input.fileNamePattern) } : {}),
  };
};

const normalizeAlbumSplitRequest = (value: unknown): AlbumSplitRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('album split request must be an object');
  }
  const input = value as Record<string, unknown>;
  return {
    albumId: requireText(input.albumId, 'albumId'),
    outputDir: typeof input.outputDir === 'string' ? input.outputDir : '',
    format: normalizeAlbumSplitFormat(input.format),
    fileNamePattern: normalizeAlbumSplitFileNamePattern(input.fileNamePattern),
    embedCover: input.embedCover === true,
    importAfter: input.importAfter === true,
    overwrite: input.overwrite === true,
    backupConfirmed: input.backupConfirmed === true,
  };
};

const importSplitOutputs = async (paths: string[]): Promise<ImportAudioFilesResult> => {
  const library = getLibraryService();
  const tracks: ImportAudioFilesResult['tracks'] = [];
  let failedCount = 0;
  for (const filePath of paths) {
    try {
      tracks.push(await library.importAudioFile(filePath, { deferGroupingRefresh: true }));
    } catch {
      failedCount += 1;
    }
  }
  return {
    importedCount: tracks.length,
    skippedCount: 0,
    failedCount,
    trackIds: tracks.map((track) => track.id),
    tracks,
  };
};

const getAlbumSplitService = (): AlbumSplitService => {
  albumSplitService ??= new AlbumSplitService({
    getAlbum: (albumId) => getLibraryService().getAlbum(albumId),
    getAllAlbumTracks: (albumId) => getLibraryService().getAllAlbumTracks(albumId),
    resolveCoverAsset: (coverId) => {
      const library = getLibraryService();
      return library.resolveCoverAsset(coverId, 'original')
        ?? library.resolveCoverAsset(coverId, 'large')
        ?? library.resolveCoverAsset(coverId, 'album');
    },
    importAudioFiles: importSplitOutputs,
  });
  return albumSplitService;
};

export const closeAlbumSplitService = (): void => {
  albumSplitService?.close();
  albumSplitService = null;
};

export const registerAlbumSplitIpc = (): void => {
  ipcMain.handle(IpcChannels.LibraryPlanAlbumSplit, (_event, albumId: unknown, options: unknown) =>
    getAlbumSplitService().plan(requireText(albumId, 'albumId'), normalizeAlbumSplitPlanOptions(options)),
  );
  ipcMain.handle(IpcChannels.LibraryStartAlbumSplit, (_event, request: unknown) =>
    getAlbumSplitService().start(normalizeAlbumSplitRequest(request)),
  );
  ipcMain.handle(IpcChannels.LibraryGetAlbumSplitStatus, (_event, jobId: unknown) =>
    getAlbumSplitService().getStatus(requireText(jobId, 'jobId')),
  );
  ipcMain.handle(IpcChannels.LibraryCancelAlbumSplit, (_event, jobId: unknown) =>
    getAlbumSplitService().cancel(requireText(jobId, 'jobId')),
  );
};
