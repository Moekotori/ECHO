import type { ScannedAudioFile } from './libraryTypes';
import { TsFileScanner } from './workers/TsFileScanner';

export class LibraryScanner {
  private readonly fileScanner = new TsFileScanner();

  async scanFolder(folderId: string, folderPath: string): Promise<ScannedAudioFile[]> {
    const files: ScannedAudioFile[] = [];

    for await (const file of this.fileScanner.scanFolder(folderPath)) {
      files.push({
        ...file,
        folderId,
      });
    }

    return files;
  }
}
