// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirnameFromImportPath, handleDroppedImportPaths, summarizeDroppedImport } from './dragDropImport';
import type { EchoApi } from '../../../preload/apiTypes';
import type { ImportPathClassification } from '../../../shared/types/library';

const makeLibrary = (classification: ImportPathClassification): Pick<EchoApi['library'], 'addFolder' | 'classifyImportPaths' | 'importAudioFiles' | 'scanFolder'> => ({
  classifyImportPaths: vi.fn().mockResolvedValue(classification),
  importAudioFiles: vi.fn().mockResolvedValue({
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    trackIds: [],
    tracks: [],
  }),
  addFolder: vi.fn(async (path: string) => ({
    id: `folder-${path}`,
    path,
    name: path,
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
  scanFolder: vi.fn().mockResolvedValue({
    id: 'job-1',
    folderId: 'folder-1',
    status: 'completed',
    phase: 'finished',
    totalFiles: 1,
    processedFiles: 1,
    skippedFiles: 0,
    addedTracks: 1,
    updatedTracks: 0,
    removedTracks: 0,
    coverCount: 0,
    errorCount: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.000Z',
    errors: [],
  }),
});

describe('drag drop import helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates parent folders for multiple dropped audio files', async () => {
    const library = makeLibrary({
      folders: [],
      audioFiles: ['D:\\Music\\A\\one.flac', 'D:\\Music\\A\\two.opus', 'D:\\Music\\B\\three.dsf'],
      osuArchives: [],
      unsupportedFiles: [],
      missingPaths: [],
    });

    const result = await handleDroppedImportPaths(['D:\\Music\\A\\one.flac', 'D:\\Music\\A\\two.opus'], library);

    expect(dirnameFromImportPath('D:\\Music\\A\\one.flac')).toBe('D:\\Music\\A');
    expect(library.addFolder).toHaveBeenCalledTimes(2);
    expect(library.addFolder).toHaveBeenNthCalledWith(1, 'D:\\Music\\A');
    expect(library.addFolder).toHaveBeenNthCalledWith(2, 'D:\\Music\\B');
    expect(result.scannedAudioFolderCount).toBe(2);
  });

  it('imports folders directly and scans each imported folder', async () => {
    const library = makeLibrary({
      folders: ['D:\\Albums', 'D:\\Albums'],
      audioFiles: [],
      osuArchives: [],
      unsupportedFiles: [],
      missingPaths: [],
    });

    const result = await handleDroppedImportPaths(['D:\\Albums'], library);

    expect(library.addFolder).toHaveBeenCalledTimes(1);
    expect(library.scanFolder).toHaveBeenCalledTimes(1);
    expect(result.addedFolderCount).toBe(1);
  });

  it('counts unsupported files without interrupting supported imports', async () => {
    const library = makeLibrary({
      folders: [],
      audioFiles: ['D:\\Music\\song.flac'],
      osuArchives: [],
      unsupportedFiles: ['D:\\Music\\cover.jpg', 'D:\\Music\\notes.txt'],
      missingPaths: ['D:\\Missing\\gone.flac'],
    });

    const result = await handleDroppedImportPaths(['D:\\Music\\song.flac', 'D:\\Music\\cover.jpg'], library);

    expect(result.scannedAudioFolderCount).toBe(1);
    expect(result.ignoredCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(summarizeDroppedImport(result)).toContain('忽略 2 个不支持文件');
  });

  it('imports dropped osu archive paths directly', async () => {
    const library = makeLibrary({
      folders: [],
      audioFiles: [],
      osuArchives: ['D:\\Maps\\beatmap.osz'],
      unsupportedFiles: [],
      missingPaths: [],
    });
    vi.mocked(library.importAudioFiles).mockResolvedValue({
      importedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      trackIds: ['track-osu'],
      tracks: [],
    });

    const result = await handleDroppedImportPaths(['D:\\Maps\\beatmap.osz'], library);

    expect(library.importAudioFiles).toHaveBeenCalledWith(['D:\\Maps\\beatmap.osz']);
    expect(result.importedFileCount).toBe(1);
    expect(summarizeDroppedImport(result)).toContain('已导入 1 个文件');
  });
});
