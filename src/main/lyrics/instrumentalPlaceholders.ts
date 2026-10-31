import { parsePlainLyrics, parseSyncedLyrics } from './lyricsParser';

const instrumentalPlaceholderPatterns = [
  /\u6b64\u6b4c\u66f2\u4e3a\u6ca1\u6709\u586b\u8bcd\u7684\u7eaf\u97f3\u4e50/u,
  /\u6b64\u6b4c\u66f2\u4e3a\u7eaf\u97f3\u4e50/u,
  /\u7eaf\u97f3\u4e50[\s,，。.!！?？]*\u8bf7(?:\u60a8)?\u6b23\u8d4f/u,
  /\binstrumental\s+track\b/iu,
];

const normalizedLineText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[，。,.!！?？:：;；"“”'‘’()[\]{}<>]/g, '')
    .trim()
    .toLowerCase();

export const isInstrumentalLyricsText = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }

  const syncedLines = parseSyncedLyrics(value).map((line) => line.text);
  const plainLines = parsePlainLyrics(value).map((line) => line.text);
  const lines = (syncedLines.length > 0 ? syncedLines : plainLines)
    .map(normalizedLineText)
    .filter(Boolean);

  if (lines.length === 0) {
    return false;
  }

  return lines.some((line) => instrumentalPlaceholderPatterns.some((pattern) => pattern.test(line)));
};
