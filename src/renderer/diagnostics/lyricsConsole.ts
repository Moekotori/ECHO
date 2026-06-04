type LyricsConsoleLevel = 'info' | 'warn';

type LyricsConsoleOptions = {
  level?: LyricsConsoleLevel;
  dedupeKey?: string;
  dedupeMs?: number;
};

const lastLogAtByKey = new Map<string, number>();

const isTestEnvironment = (): boolean => {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.NODE_ENV === 'test' || maybeProcess?.env?.VITEST === 'true';
};

export const logLyricsConsole = (
  event: string,
  payload: Record<string, unknown> = {},
  options: LyricsConsoleOptions = {},
): void => {
  if (isTestEnvironment()) {
    return;
  }

  const dedupeKey = options.dedupeKey;
  if (dedupeKey) {
    const now = Date.now();
    const lastLogAt = lastLogAtByKey.get(dedupeKey) ?? 0;
    if (now - lastLogAt < (options.dedupeMs ?? 1000)) {
      return;
    }

    lastLogAtByKey.set(dedupeKey, now);
  }

  const level = options.level ?? 'info';
  console[level](`[lyrics:${event}]`, payload);
};
