export const localLyricsFileExtensions = [
  '.lrc', '.ttml', '.vtt', '.yrc', '.qrc', '.krc', '.srt', '.ass', '.ssa', '.trc', '.lrcx', '.snc', '.txt',
] as const;

export type LocalLyricsFileExtension = typeof localLyricsFileExtensions[number];
export const maxLocalLyricsFileBytes = 2_000_000;

export const isLocalLyricsFileExtension = (value: unknown): value is LocalLyricsFileExtension =>
  typeof value === 'string' && (localLyricsFileExtensions as readonly string[]).includes(value);

export type LyricsParseLimits = {
  maxLines: number;
  maxLineTextChars: number;
  maxWordsPerLine: number;
  maxTrackTextChars?: number;
};
