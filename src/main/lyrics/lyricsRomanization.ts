import type { LyricLine } from '../../shared/types/lyrics';
import {
  hasJapaneseKanaSignal,
  hasKanaText,
  shouldRomanizeJapaneseLine,
} from '../../shared/utils/lyricsLanguage';
import { registerSoftMemoryCleanupTask } from '../diagnostics/SoftMemoryJanitor';
import {
  LyricsRomanizationWorkerClient,
} from './LyricsRomanizationWorkerClient';
import type { LyricsRomanizationResult } from './LyricsRomanizationWorkerProtocol';

export type LyricsRomanizationRunner = {
  romanize(texts: string[]): Promise<LyricsRomanizationResult[]>;
};

export const lyricsRomanizationBatchSize = 96;

let defaultClient: LyricsRomanizationWorkerClient | null = null;
let unregisterJanitor: (() => void) | null = null;
let fallbackWarningLogged = false;

export const hasJapaneseText = (text: string): boolean => hasKanaText(text);

const normalizeRomanization = (value: string): string | null => {
  const normalized = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const getDefaultClient = (): LyricsRomanizationWorkerClient => {
  if (!defaultClient) {
    defaultClient = new LyricsRomanizationWorkerClient({
      warn: (message) => {
        if (!fallbackWarningLogged) {
          fallbackWarningLogged = true;
          console.warn(message);
        }
      },
    });
    unregisterJanitor = registerSoftMemoryCleanupTask('lyrics-romanization-worker', () => {
      const before = defaultClient?.getDiagnostics().workerActive ? 1 : 0;
      const released = defaultClient?.releaseIdle() ?? false;
      return {
        task: 'lyrics-romanization-worker',
        beforeEntries: before,
        afterEntries: released ? 0 : before,
        removedEntries: released ? 1 : 0,
      };
    });
  }
  return defaultClient;
};

const fillMissingRomanizationWithRunner = async (
  lines: LyricLine[],
  runner: LyricsRomanizationRunner | null,
): Promise<LyricLine[]> => {
  const lyricsHaveJapaneseKana = hasJapaneseKanaSignal(lines);
  const missingJapaneseLines = lines.filter(
    (line) => !line.romanization && shouldRomanizeJapaneseLine(line.text, lyricsHaveJapaneseKana),
  );
  if (missingJapaneseLines.length === 0) {
    return lines;
  }

  const uniqueTexts = [...new Set(missingJapaneseLines.map((line) => line.text))];
  const romanizer = runner ?? getDefaultClient();
  const converted = new Map<string, string>();
  for (let offset = 0; offset < uniqueTexts.length; offset += lyricsRomanizationBatchSize) {
    const batch = uniqueTexts.slice(offset, offset + lyricsRomanizationBatchSize);
    try {
      const requestedTexts = new Set(batch);
      const results = await romanizer.romanize(batch);
      for (const result of results) {
        if (!requestedTexts.has(result.text) || result.romanization === null) {
          continue;
        }
        const romanization = normalizeRomanization(result.romanization);
        if (romanization && romanization !== result.text) {
          converted.set(result.text, romanization);
        }
      }
    } catch {
      // Keep successful batches and leave this batch's original lines untouched.
    }
  }

  if (converted.size === 0) {
    return lines;
  }

  return lines.map((line) => {
    const romanization = line.romanization ? null : converted.get(line.text);
    return romanization ? { ...line, romanization } : line;
  });
};

export const fillMissingRomanization = (lines: LyricLine[]): Promise<LyricLine[]> =>
  fillMissingRomanizationWithRunner(lines, null);

export const fillMissingRomanizationForTest = (
  lines: LyricLine[],
  runner: LyricsRomanizationRunner,
): Promise<LyricLine[]> => fillMissingRomanizationWithRunner(lines, runner);

export const disposeLyricsRomanizationWorker = (): void => {
  unregisterJanitor?.();
  unregisterJanitor = null;
  defaultClient?.dispose();
  defaultClient = null;
};

export const getLyricsRomanizationWorkerDiagnostics = (): { clientCreated: boolean } => ({
  clientCreated: defaultClient !== null,
});

export const hasMissingRomanization = (lines: LyricLine[]): boolean =>
  hasJapaneseKanaSignal(lines) &&
  lines.some((line) => !line.romanization && shouldRomanizeJapaneseLine(line.text, true));
