const supportedVideoExtensions = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi']);
const browserPlayableVideoExtensions = new Set(['.mp4', '.m4v', '.webm']);

const getSafeExtension = (filePath: string): string => {
  const normalizedPath = filePath.trim();
  const fileName = normalizedPath.split(/[\\/]/).pop() ?? normalizedPath;
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return '';
  }

  return fileName.slice(dotIndex).toLocaleLowerCase();
};

export const isSupportedVideoExtension = (filePath: string): boolean =>
  supportedVideoExtensions.has(getSafeExtension(filePath));

export const isBrowserPlayableVideo = (filePath: string): boolean =>
  browserPlayableVideoExtensions.has(getSafeExtension(filePath));

export const mimeTypeForVideoPath = (filePath: string): string | null => {
  switch (getSafeExtension(filePath)) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.mov':
      return 'video/quicktime';
    case '.avi':
      return 'video/x-msvideo';
    default:
      return null;
  }
};
