import { extname } from 'node:path';

/** Ripped lossless albums often retain a WAV reference. Never guess across names or directories. */
export const cueLosslessSourceCandidates = (declaredPath: string): string[] => {
  const extension = extname(declaredPath);
  if (!['.wav', '.wave'].includes(extension.toLowerCase())) return [];
  const stem = declaredPath.slice(0, -extension.length);
  return ['.flac', '.ape', '.wv'].map(format => stem + format);
};

export const resolveCueAudioSource = (declaredPath: string, exists: (path: string) => boolean): string => {
  if (exists(declaredPath)) return declaredPath;
  const candidates = cueLosslessSourceCandidates(declaredPath).filter(exists);
  return candidates.length === 1 ? candidates[0]! : declaredPath;
};
