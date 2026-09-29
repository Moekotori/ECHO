import type { LyricLine } from '../../shared/types/lyrics';
import {
  hasJapaneseKanaSignal,
  hasKanaText,
  shouldRomanizeJapaneseLine,
} from '../../shared/utils/lyricsLanguage';

type KuroshiroInstance = {
  convert: (text: string, options: { to: 'romaji'; mode: 'spaced'; romajiSystem: 'hepburn' }) => Promise<string>;
};

type KuroshiroConstructor = new () => { init: (analyzer: unknown) => Promise<void> } & KuroshiroInstance;
type KuromojiAnalyzerConstructor = new () => unknown;

let kuroshiroPromise: Promise<KuroshiroInstance | null> | null = null;

export const hasJapaneseText = (text: string): boolean => hasKanaText(text);

const normalizeRomanization = (value: string): string | null => {
  const normalized = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const getKuroshiro = async (): Promise<KuroshiroInstance | null> => {
  if (!kuroshiroPromise) {
    kuroshiroPromise = (async () => {
      try {
        const [kuroshiroModule, kuromojiModule] = await Promise.all([
          import('kuroshiro'),
          import('kuroshiro-analyzer-kuromoji'),
        ]);
        const Kuroshiro = resolveDefaultExport<KuroshiroConstructor>(kuroshiroModule);
        const KuromojiAnalyzer = resolveDefaultExport<KuromojiAnalyzerConstructor>(kuromojiModule);
        if (!Kuroshiro || !KuromojiAnalyzer) {
          return null;
        }

        const kuroshiro = new Kuroshiro();
        await kuroshiro.init(new KuromojiAnalyzer());
        return kuroshiro;
      } catch {
        return null;
      }
    })();
  }

  return kuroshiroPromise;
};

const resolveDefaultExport = <T>(moduleValue: unknown): T | null => {
  const firstDefault =
    moduleValue && typeof moduleValue === 'object' && 'default' in moduleValue
      ? (moduleValue as { default?: unknown }).default
      : moduleValue;
  const nestedDefault =
    firstDefault && typeof firstDefault === 'object' && 'default' in firstDefault
      ? (firstDefault as { default?: unknown }).default
      : firstDefault;

  return typeof nestedDefault === 'function' ? (nestedDefault as T) : null;
};

export const fillMissingRomanization = async (lines: LyricLine[]): Promise<LyricLine[]> => {
  const lyricsHaveJapaneseKana = hasJapaneseKanaSignal(lines);
  const missingJapaneseLines = lines.filter(
    (line) => !line.romanization && shouldRomanizeJapaneseLine(line.text, lyricsHaveJapaneseKana),
  );
  if (missingJapaneseLines.length === 0) {
    return lines;
  }

  const kuroshiro = await getKuroshiro();
  if (!kuroshiro) {
    return lines;
  }

  const converted = new Map<LyricLine, string>();
  await Promise.all(
    missingJapaneseLines.map(async (line) => {
      try {
        const romanization = normalizeRomanization(
          await kuroshiro.convert(line.text, {
            to: 'romaji',
            mode: 'spaced',
            romajiSystem: 'hepburn',
          }),
        );
        if (romanization && romanization !== line.text) {
          converted.set(line, romanization);
        }
      } catch {
        // Romanization is an enhancement; failed conversion must not block lyrics.
      }
    }),
  );

  if (converted.size === 0) {
    return lines;
  }

  return lines.map((line) => {
    const romanization = converted.get(line);
    return romanization ? { ...line, romanization } : line;
  });
};

export const hasMissingRomanization = (lines: LyricLine[]): boolean =>
  hasJapaneseKanaSignal(lines) &&
  lines.some((line) => !line.romanization && shouldRomanizeJapaneseLine(line.text, true));
