import type { TrackLyrics } from '../../../shared/types/lyrics';

export const maxTrackLyricsEditorChars = 1_000_000;
export const formatLyricsTime = (timeMs: number): string => {
  const value = Math.max(0, Math.floor(timeMs));
  return `[${String(Math.floor(value / 60_000)).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(Math.floor(value % 1000 / 10)).padStart(2, '0')}]`;
};

export const trackLyricsToEditorText = (lyrics: TrackLyrics | null): string => {
  if (!lyrics || lyrics.kind === 'empty' || lyrics.kind === 'instrumental') return '';
  if (lyrics.kind === 'synced') return lyrics.syncedText?.trim() || lyrics.lines.map((line) =>
    `${line.timeMs >= 0 ? formatLyricsTime(line.timeMs) : ''}${line.text}`).join('\n');
  return lyrics.plainText?.trim() || lyrics.lines.map((line) => line.text).join('\n');
};
