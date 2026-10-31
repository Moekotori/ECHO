import { localLyricsFileExtensions, maxLocalLyricsFileBytes } from '../../../shared/lyrics/localLyricsFormats';

export const customLyricsTextFileExtensions = localLyricsFileExtensions.filter((extension) => extension !== '.krc');
export const customLyricsFileAccept = [
  ...customLyricsTextFileExtensions,
  '.krc',
  'text/plain',
  'text/vtt',
  'application/ttml+xml',
].join(',');
export const customLyricsFilePrompt = 'Please choose an LRC, TTML, VTT, YRC, QRC, KRC, SRT, ASS, SSA, TRC, LRCX, SNC, or text lyrics file';
export const maxCustomLyricsFileBytes = maxLocalLyricsFileBytes;

export const isCustomLyricsFile = (fileName: string): boolean => {
  const normalizedName = fileName.toLowerCase();
  return normalizedName.endsWith('.krc') || customLyricsTextFileExtensions.some((extension) => normalizedName.endsWith(extension));
};

export const firstCustomLyricsFile = (fileList: FileList | null): File | null => {
  if (!fileList) {
    return null;
  }

  return Array.from(fileList).find((file) => isCustomLyricsFile(file.name)) ?? null;
};

export const hasFileDrag = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes('Files');
