import { extname } from 'node:path';
import { isLocalLyricsFileExtension } from '../../shared/lyrics/localLyricsFormats';
import { maxLyricsTextBytes, maxLyricsTextChars, normalizeSyncedLyricAlternates, parsePlainLyrics, parseSyncedLyrics } from './lyricsParser';

/** Validate manual text before touching the lyrics cache. Only LRC/TXT allow a plain-text fallback. */
export const parseImportedLyrics = (text: string, fileName?: string | null) => {
  if (text.length > maxLyricsTextChars || Buffer.byteLength(text, 'utf8') > maxLyricsTextBytes) throw new Error('Lyrics file is too large to import');
  const normalizedText = text.replace(/^\uFEFF/u, '').trim();
  if (!normalizedText) throw new Error('Custom LRC file is empty');
  const syncedLines = normalizeSyncedLyricAlternates(parseSyncedLyrics(normalizedText));
  const extension = fileName ? extname(fileName).toLowerCase() : '';
  if (isLocalLyricsFileExtension(extension) && extension !== '.lrc' && extension !== '.txt' && syncedLines.length === 0) {
    throw new Error('Lyrics file does not contain valid timed lyrics');
  }
  const plainLines = syncedLines.length ? [] : parsePlainLyrics(normalizedText);
  if (!syncedLines.length && !plainLines.length) throw new Error('Custom LRC file does not contain readable lyrics');
  return { normalizedText, syncedLines, plainLines };
};
