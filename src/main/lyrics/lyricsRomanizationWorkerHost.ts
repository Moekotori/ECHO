import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type {} from 'electron';
import {
  getLyricsRomanizationRequestId,
  isLyricsRomanizationWorkerRequest,
  type LyricsRomanizationResult,
  type LyricsRomanizationWorkerResponse,
} from './LyricsRomanizationWorkerProtocol';

type KuroshiroInstance = {
  convert: (
    text: string,
    options: { to: 'romaji'; mode: 'spaced'; romajiSystem: 'hepburn' },
  ) => Promise<string>;
};

type KuroshiroConstructor = new () => {
  init: (analyzer: unknown) => Promise<void>;
} & KuroshiroInstance;
type KuromojiAnalyzerConstructor = new (options?: { dictPath?: string }) => unknown;
export type LyricsRomanizerLoader = () => Promise<KuroshiroInstance>;

const nodeRequire = createRequire(import.meta.url);
const defaultCacheEntries = 384;

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

const loadKuroshiro = async (): Promise<KuroshiroInstance> => {
  const [kuroshiroModule, kuromojiModule] = await Promise.all([
    import('kuroshiro'),
    import('kuroshiro-analyzer-kuromoji'),
  ]);
  const Kuroshiro = resolveDefaultExport<KuroshiroConstructor>(kuroshiroModule);
  const KuromojiAnalyzer = resolveDefaultExport<KuromojiAnalyzerConstructor>(kuromojiModule);
  if (!Kuroshiro || !KuromojiAnalyzer) {
    throw new Error('Japanese romanization modules are unavailable');
  }

  const dictPath = resolveKuromojiDictPath();
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(
    dictPath ? new KuromojiAnalyzer({ dictPath }) : new KuromojiAnalyzer(),
  );
  return kuroshiro;
};

const normalizeRomanization = (value: string): string | null => {
  const normalized = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
};

export class LyricsRomanizationWorkerHost {
  private readonly cache = new Map<string, string | null>();
  private readonly maxCacheEntries: number;
  private romanizerPromise: Promise<KuroshiroInstance> | null = null;

  constructor(
    private readonly loadRomanizer: LyricsRomanizerLoader = loadKuroshiro,
    maxCacheEntries = defaultCacheEntries,
  ) {
    this.maxCacheEntries = Math.max(1, Math.round(maxCacheEntries));
  }

  async handle(requestValue: unknown): Promise<LyricsRomanizationWorkerResponse | null> {
    const requestId = getLyricsRomanizationRequestId(requestValue);
    if (!isLyricsRomanizationWorkerRequest(requestValue)) {
      return requestId === null
        ? null
        : { requestId, ok: false, message: 'Invalid lyrics romanization worker request' };
    }

    try {
      const romanizer = await this.getRomanizer();
      const results: LyricsRomanizationResult[] = [];
      for (const text of requestValue.texts) {
        results.push({ text, romanization: await this.convert(romanizer, text) });
      }
      return { requestId: requestValue.requestId, ok: true, results };
    } catch (error) {
      return {
        requestId: requestValue.requestId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  private getRomanizer(): Promise<KuroshiroInstance> {
    if (!this.romanizerPromise) {
      this.romanizerPromise = this.loadRomanizer();
    }
    return this.romanizerPromise;
  }

  private async convert(romanizer: KuroshiroInstance, text: string): Promise<string | null> {
    if (this.cache.has(text)) {
      const cached = this.cache.get(text) ?? null;
      this.cache.delete(text);
      this.cache.set(text, cached);
      return cached;
    }

    let romanization: string | null = null;
    try {
      romanization = normalizeRomanization(
        await romanizer.convert(text, {
          to: 'romaji',
          mode: 'spaced',
          romajiSystem: 'hepburn',
        }),
      );
      if (romanization === text) {
        romanization = null;
      }
    } catch {
      // A single bad line must not fail the remaining lyrics in this request.
    }

    this.cache.set(text, romanization);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
    return romanization;
  }
}

const host = new LyricsRomanizationWorkerHost();
let requestQueue = Promise.resolve();

const parentPort = process.parentPort;
parentPort?.on('message', ({ data: request }) => {
  requestQueue = requestQueue
    .then(async () => {
      const response = await host.handle(request);
      if (response) {
        parentPort?.postMessage(response);
      }
    })
    .catch(() => undefined);
});
