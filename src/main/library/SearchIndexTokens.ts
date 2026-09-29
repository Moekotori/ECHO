import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pinyin } from 'pinyin-pro';

export type SearchIndexTrackFields = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre?: string | null;
  path?: string | null;
  remotePath?: string | null;
};

type KuroshiroInstance = {
  convert: (
    text: string,
    options:
      | { to: 'romaji'; mode: 'spaced'; romajiSystem: 'hepburn' }
      | { to: 'hiragana' | 'katakana'; mode: 'spaced' },
  ) => Promise<string>;
};

type KuroshiroConstructor = new () => { init: (analyzer: unknown) => Promise<void> } & KuroshiroInstance;
type KuromojiAnalyzerConstructor = new (options?: { dictPath?: string }) => unknown;

const nodeRequire = createRequire(import.meta.url);

const searchSeparatorPattern = /[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~_-]+/u;
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const hanRunPattern = /\p{Script=Han}+/gu;
const cjkRunPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const japanesePattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const combiningMarkPattern = /[\u0300-\u036f]/gu;
const maxCjkGramLength = 3;
const maxPinyinWindow = 6;
const maxInitialWindow = 12;
const maxRomajiWindow = 8;
const maxRomanizationInputLength = 512;
const maxRomanizationCacheEntries = 4096;

let kuroshiroPromise: Promise<KuroshiroInstance | null> | null = null;
let hasLoggedKuroshiroInitFailure = false;
const japaneseConversionCache = new Map<string, string | null>();

const normalizeSearchText = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

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

const resolveKuromojiDictPath = (): string | undefined => {
  try {
    const entry = nodeRequire.resolve('kuromoji');
    return join(dirname(dirname(entry)), 'dict');
  } catch {
    return undefined;
  }
};

const makeKuromojiAnalyzer = (KuromojiAnalyzer: KuromojiAnalyzerConstructor): unknown => {
  const dictPath = resolveKuromojiDictPath();
  return dictPath ? new KuromojiAnalyzer({ dictPath }) : new KuromojiAnalyzer();
};

const logKuroshiroInitFailure = (error: unknown): void => {
  if (hasLoggedKuroshiroInitFailure) {
    return;
  }

  hasLoggedKuroshiroInitFailure = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[library-search] Japanese romaji search disabled: ${message}`);
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
        await kuroshiro.init(makeKuromojiAnalyzer(KuromojiAnalyzer));
        return kuroshiro;
      } catch (error) {
        logKuroshiroInitFailure(error);
        return null;
      }
    })();
  }

  return kuroshiroPromise;
};

export const preloadSearchIndexRomanizer = async (): Promise<boolean> => Boolean(await getKuroshiro());

export const hasJapaneseSearchText = (fields: SearchIndexTrackFields): boolean =>
  [
    fields.title,
    fields.artist,
    fields.album,
    fields.albumArtist,
    fields.genre,
    fields.path,
    fields.remotePath,
  ].some((value) => typeof value === 'string' && japanesePattern.test(value));

const rememberJapaneseConversion = (key: string, value: string | null): string | null => {
  if (japaneseConversionCache.size >= maxRomanizationCacheEntries) {
    const oldestKey = japaneseConversionCache.keys().next().value as string | undefined;
    if (oldestKey) {
      japaneseConversionCache.delete(oldestKey);
    }
  }
  japaneseConversionCache.set(key, value);
  return value;
};

const normalizeRomanizedText = (value: string): string | null => {
  const normalized = value
    .normalize('NFKD')
    .replace(combiningMarkPattern, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const simplifiedLongVowelRomaji = (value: string): string | null => {
  const simplified = value
    .replace(/ou/giu, (match) => match[0] ?? 'o')
    .replace(/uu/giu, (match) => match[0] ?? 'u')
    .replace(/\s+/g, ' ')
    .trim();

  return simplified && simplified !== value ? simplified : null;
};

const convertJapaneseText = async (value: string, target: 'romaji' | 'hiragana' | 'katakana'): Promise<string | null> => {
  const normalized = normalizeSearchText(value).slice(0, maxRomanizationInputLength);
  if (!normalized || !japanesePattern.test(normalized)) {
    return null;
  }

  const cacheKey = `${target}:${normalized}`;
  if (japaneseConversionCache.has(cacheKey)) {
    return japaneseConversionCache.get(cacheKey) ?? null;
  }

  const kuroshiro = await getKuroshiro();
  if (!kuroshiro) {
    return null;
  }

  try {
    const converted = normalizeRomanizedText(
      target === 'romaji'
        ? await kuroshiro.convert(normalized, {
            to: 'romaji',
            mode: 'spaced',
            romajiSystem: 'hepburn',
          })
        : await kuroshiro.convert(normalized, {
            to: target,
            mode: 'spaced',
          }),
    );
    return rememberJapaneseConversion(cacheKey, converted && converted !== normalized ? converted : null);
  } catch {
    return rememberJapaneseConversion(cacheKey, null);
  }
};

const romanizeJapaneseText = (value: string): Promise<string | null> => convertJapaneseText(value, 'romaji');

const kanaReadingsForJapaneseText = async (value: string): Promise<string[]> => {
  const readings = await Promise.all([convertJapaneseText(value, 'hiragana'), convertJapaneseText(value, 'katakana')]);
  return Array.from(new Set(readings.filter((reading): reading is string => Boolean(reading))));
};

const addCjkGrams = (text: string, terms: Set<string>): void => {
  for (const match of text.matchAll(cjkRunPattern)) {
    const chars = Array.from(match[0]);

    for (let start = 0; start < chars.length; start += 1) {
      for (let length = 1; length <= maxCjkGramLength && start + length <= chars.length; length += 1) {
        terms.add(chars.slice(start, start + length).join(''));
      }
    }
  }
};

const addPinyinTokens = (text: string, terms: Set<string>): void => {
  for (const match of text.matchAll(hanRunPattern)) {
    const syllables = pinyin(match[0], { toneType: 'none', type: 'array' })
      .map((item) => normalizeSearchText(item))
      .filter(Boolean);

    if (syllables.length === 0) {
      continue;
    }

    const initials = syllables.map((syllable) => syllable[0] ?? '').join('');
    const compact = syllables.join('');
    terms.add(compact);
    terms.add(initials);

    for (let start = 0; start < syllables.length; start += 1) {
      for (let length = 1; length <= maxPinyinWindow && start + length <= syllables.length; length += 1) {
        const window = syllables.slice(start, start + length);
        terms.add(window.join(''));
        for (const syllable of window) {
          terms.add(syllable);
        }
      }

      for (let length = 1; length <= maxInitialWindow && start + length <= initials.length; length += 1) {
        terms.add(initials.slice(start, start + length));
      }
    }
  }
};

const compactRomajiToken = (value: string): string => value.replace(/['’]/gu, '');

const particleAdjustedRomaji = (value: string): string | null => {
  const syllables = normalizeSearchText(value).split(searchSeparatorPattern).filter(Boolean);
  if (syllables.length === 0) {
    return null;
  }

  let changed = false;
  const adjusted = syllables.map((syllable) => {
    if (syllable === 'ha') {
      changed = true;
      return 'wa';
    }
    if (syllable === 'he') {
      changed = true;
      return 'e';
    }
    if (syllable === 'wo') {
      changed = true;
      return 'o';
    }
    return syllable;
  });

  return changed ? adjusted.join(' ') : null;
};

const romajiVariants = (value: string): string[] => {
  const variants = new Set<string>();
  const addVariant = (candidate: string | null): void => {
    if (!candidate) {
      return;
    }
    const normalized = normalizeSearchText(candidate);
    if (normalized) {
      variants.add(normalized);
      const compacted = compactRomajiToken(normalized);
      if (compacted !== normalized) {
        variants.add(compacted);
      }
    }
  };

  addVariant(value);
  for (const candidate of Array.from(variants)) {
    addVariant(simplifiedLongVowelRomaji(candidate));
    addVariant(particleAdjustedRomaji(candidate));
  }
  for (const candidate of Array.from(variants)) {
    addVariant(simplifiedLongVowelRomaji(candidate));
  }

  return Array.from(variants);
};

const addRomajiSequenceTokens = (value: string, terms: Set<string>): void => {
  const syllables = normalizeSearchText(value).split(searchSeparatorPattern).map(compactRomajiToken).filter(Boolean);
  if (syllables.length === 0) {
    return;
  }

  const compact = syllables.join('');
  const initials = syllables.map((syllable) => syllable[0] ?? '').join('');
  terms.add(compact);
  terms.add(initials);

  for (let start = 0; start < syllables.length; start += 1) {
    for (let length = 1; length <= maxRomajiWindow && start + length <= syllables.length; length += 1) {
      const window = syllables.slice(start, start + length);
      terms.add(window.join(''));
      for (const syllable of window) {
        terms.add(syllable);
      }
    }

    for (let length = 1; length <= maxInitialWindow && start + length <= initials.length; length += 1) {
      terms.add(initials.slice(start, start + length));
    }
  }
};

const addTextSearchTerms = (value: string | null | undefined, terms: Set<string>): void => {
  if (!value) {
    return;
  }

  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return;
  }

  terms.add(normalized);

  const parts = normalized.split(searchSeparatorPattern).filter(Boolean);
  for (const part of parts) {
    terms.add(part);

    if (cjkPattern.test(part)) {
      addCjkGrams(part, terms);
    }
  }

  if (parts.length > 1) {
    terms.add(parts.join(''));
  }

  addCjkGrams(normalized, terms);
  addPinyinTokens(normalized, terms);
};

const addRomanizedSearchTerms = (value: string | null, terms: Set<string>): void => {
  if (!value) {
    return;
  }

  for (const variant of romajiVariants(value)) {
    addTextSearchTerms(variant, terms);
    addRomajiSequenceTokens(variant, terms);
  }
};

export const buildTrackSearchTerms = (fields: SearchIndexTrackFields): string => {
  const terms = new Set<string>();

  addTextSearchTerms(fields.title, terms);
  addTextSearchTerms(fields.artist, terms);
  addTextSearchTerms(fields.album, terms);
  addTextSearchTerms(fields.albumArtist, terms);
  addTextSearchTerms(fields.genre, terms);
  addTextSearchTerms(fields.path, terms);
  addTextSearchTerms(fields.remotePath, terms);

  return Array.from(terms).join(' ');
};

export const buildTrackSearchTermsAsync = async (fields: SearchIndexTrackFields): Promise<string> => {
  const terms = new Set(buildTrackSearchTerms(fields).split(' ').filter(Boolean));
  const values = [
    fields.title,
    fields.artist,
    fields.album,
    fields.albumArtist,
    fields.genre,
    fields.path,
    fields.remotePath,
  ];

  await Promise.all(
    values.map(async (value) => {
      if (!value) {
        return;
      }

      addRomanizedSearchTerms(await romanizeJapaneseText(value), terms);
      for (const reading of await kanaReadingsForJapaneseText(value)) {
        addTextSearchTerms(reading, terms);
      }
    }),
  );

  return Array.from(terms).join(' ');
};
