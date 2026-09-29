const audioExtensionValues = [
  '.mp3',
  '.flac',
  '.wav',
  '.m4a',
  '.m4p',
  '.aac',
  '.ogg',
  '.opus',
  '.wma',
  '.alac',
  '.aiff',
  '.aif',
  '.ape',
  '.wv',
  '.tta',
  '.tak',
  '.caf',
  '.dsf',
  '.dff',
  '.mka',
  '.mkv',
  '.mp4',
  '.mov',
  '.webm',
  '.mp2',
  '.mp1',
  '.mpc',
  '.ofr',
  '.ofs',
  '.spx',
  '.amr',
  '.ac3',
  '.eac3',
  '.ec3',
  '.dd',
  '.ddp',
  '.thd',
  '.truehd',
  '.mlp',
  '.ac4',
  '.dts',
  '.cue',
  '.ncm',
  '.kgm',
  '.kgma',
] as const;

export const SUPPORTED_AUDIO_EXTENSION_LIST = [...audioExtensionValues];

export const SUPPORTED_AUDIO_EXTENSIONS = new Set<string>(SUPPORTED_AUDIO_EXTENSION_LIST);

export const SCANNABLE_AUDIO_EXTENSION_LIST = SUPPORTED_AUDIO_EXTENSION_LIST
  .filter((extension) => extension !== '.cue');

export const SCANNABLE_AUDIO_EXTENSIONS = new Set<string>(SCANNABLE_AUDIO_EXTENSION_LIST);

export const SUPPORTED_AUDIO_DIALOG_EXTENSIONS = SUPPORTED_AUDIO_EXTENSION_LIST
  .map((extension) => extension.slice(1));

const getSafeExtension = (filePath: string): string => {
  const normalizedPath = filePath.trim();
  const fileName = normalizedPath.split(/[\\/]/).pop() ?? normalizedPath;
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return '';
  }

  return fileName.slice(dotIndex).toLowerCase();
};

export const isSupportedAudioExtension = (filePath: string): boolean => SUPPORTED_AUDIO_EXTENSIONS.has(getSafeExtension(filePath));

export const isScannableAudioExtension = (filePath: string): boolean => SCANNABLE_AUDIO_EXTENSIONS.has(getSafeExtension(filePath));

export const isCueFile = (filePath: string): boolean => getSafeExtension(filePath) === '.cue';
