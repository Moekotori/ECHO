import type { LyricLine } from '../types/lyrics';

type LyricLanguageLine = Pick<LyricLine, 'text'> & Partial<Pick<LyricLine, 'kana'>>;

const kanaPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const kanaGlobalPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const hanPattern = /\p{Script=Han}/u;
const minimumKanaSignalCount = 2;

export const hasKanaText = (value: string | null | undefined): boolean => kanaPattern.test(value ?? '');

export const hasHanText = (value: string | null | undefined): boolean => hanPattern.test(value ?? '');

const countKanaText = (value: string | null | undefined): number =>
  Array.from((value ?? '').matchAll(kanaGlobalPattern)).length;

export const hasJapaneseKanaSignal = (lines: readonly LyricLanguageLine[]): boolean =>
  lines.reduce((count, line) => count + countKanaText(line.text) + countKanaText(line.kana), 0) >= minimumKanaSignalCount;

export const shouldRomanizeJapaneseLine = (text: string, lyricsHaveJapaneseKanaSignal: boolean): boolean =>
  lyricsHaveJapaneseKanaSignal && (hasKanaText(text) || hasHanText(text));

export const shouldShowRomanizationForLyrics = (lines: readonly LyricLanguageLine[]): boolean =>
  hasJapaneseKanaSignal(lines);
