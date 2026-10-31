import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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

export const japaneseRomanizerIdleMs = 30_000;
let kuroshiroPromise: Promise<KuroshiroInstance | null> | null = null;
let hasLoggedKuroshiroInitFailure = false;
let activeUsers = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// Keep one instance during concurrent work; release only after all callers finish.
// Failed initialization stays memoized, preserving the existing no-retry behavior.
export const withJapaneseSearchRomanizer = async <T>(
  use: (romanizer: KuroshiroInstance | null) => T | Promise<T>,
): Promise<T> => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  activeUsers += 1;
  let loaded = false;
  try {
    const romanizer = await getKuroshiro();
    loaded = romanizer !== null;
    return await use(romanizer);
  } finally {
    activeUsers -= 1;
    if (activeUsers === 0 && loaded) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        kuroshiroPromise = null;
      }, japaneseRomanizerIdleMs);
      idleTimer.unref?.();
    }
  }
};

export const preloadSearchIndexRomanizer = (): Promise<boolean> =>
  withJapaneseSearchRomanizer(romanizer => Boolean(romanizer));
