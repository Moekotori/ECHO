import { Buffer } from 'node:buffer';
import { isInstrumentalLyricsText } from '../../lyrics/instrumentalPlaceholders';
import { normalizeSyncedLyricAlternates, parsePlainLyrics, parseSyncedLyrics } from '../../lyrics/lyricsParser';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const streamingImageProxyUrl = (url: string | null, referer: string): string | null => {
  if (!url) {
    return null;
  }

  return `echo-image://remote/${encodeURIComponent(url)}?referer=${encodeURIComponent(referer)}`;
};

export const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const integer = (value: unknown): number | null => {
  const parsed = number(value);
  return parsed ? Math.round(parsed) : null;
};

export const jsonFetch = async (
  url: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    method?: 'GET' | 'POST';
    timeoutMs?: number;
  } = {},
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await fetchWithNetworkProxy(url, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 ECHO-Next/1.0',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    const raw = (await response.text()).trim();
    const jsonText = raw.replace(/^[^(]*\((.*)\);?$/s, '$1');
    return JSON.parse(jsonText) as unknown;
  } finally {
    clearTimeout(timer);
  }
};

export const maybeDecodeBase64 = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  if (raw.includes('[') || raw.includes('\n') || /[\u4e00-\u9fff]/u.test(raw) || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(raw)) {
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded || raw;
  } catch {
    return raw;
  }
};

export const splitLyricsByKind = (value: string | null): { syncedLyrics: string | null; plainLyrics: string | null } => {
  if (!value || isInstrumentalLyricsText(value)) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  return parseSyncedLyrics(value).length > 0
    ? { syncedLyrics: value, plainLyrics: null }
    : { syncedLyrics: null, plainLyrics: value };
};

const normalizeSecondaryText = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
};

const mergeSecondaryLyrics = <Line extends { timeMs: number | null; text: string }>(
  lines: Line[],
  secondaryLyrics: string | null,
  field: 'translation' | 'romanization',
): Array<Line & { translation?: string | null; romanization?: string | null }> => {
  if (!secondaryLyrics || lines.length === 0) {
    return lines;
  }

  const syncedSecondary = parseSyncedLyrics(secondaryLyrics)
    .map((line) => ({ ...line, text: normalizeSecondaryText(line.text) ?? '' }))
    .filter((line) => line.text.length > 0);

  if (syncedSecondary.length > 0) {
    const usedIndexes = new Set<number>();
    let changed = false;
    const nextLines = lines.map((line) => {
      const lineTimeMs = typeof line.timeMs === 'number' ? line.timeMs : null;
      let secondaryText: string | null = null;

      if (lineTimeMs !== null) {
        let closestIndex = -1;
        let closestDelta = Number.POSITIVE_INFINITY;
        for (let secondaryIndex = 0; secondaryIndex < syncedSecondary.length; secondaryIndex += 1) {
          if (usedIndexes.has(secondaryIndex)) {
            continue;
          }

          const delta = Math.abs(syncedSecondary[secondaryIndex].timeMs - lineTimeMs);
          if (delta < closestDelta) {
            closestDelta = delta;
            closestIndex = secondaryIndex;
          }
        }

        if (closestIndex >= 0 && closestDelta <= 350) {
          usedIndexes.add(closestIndex);
          secondaryText = syncedSecondary[closestIndex].text;
        }
      }

      if (!secondaryText) {
        return line;
      }

      changed = true;
      return { ...line, [field]: secondaryText };
    });

    return changed ? nextLines : lines;
  }

  const plainSecondary = parsePlainLyrics(secondaryLyrics);
  if (plainSecondary.length === 0) {
    return lines;
  }

  let changed = false;
  const nextLines = lines.map((line, index) => {
    const secondaryText = normalizeSecondaryText(plainSecondary[index]?.text ?? '');
    if (!secondaryText) {
      return line;
    }

    changed = true;
    return { ...line, [field]: secondaryText };
  });

  return changed ? nextLines : lines;
};

export const linesFromLyrics = (
  syncedLyrics: string | null,
  plainLyrics: string | null,
  translationLyrics: string | null = null,
  romanizationLyrics: string | null = null,
) => {
  const syncedLines = syncedLyrics
    ? normalizeSyncedLyricAlternates(parseSyncedLyrics(syncedLyrics)).map((line) => ({
        timeMs: line.timeMs,
        text: line.text,
        ...(line.translation ? { translation: line.translation } : {}),
        ...(line.romanization ? { romanization: line.romanization } : {}),
      }))
    : [];
  const primaryLines: Array<{ timeMs: number | null; text: string }> = syncedLines.length > 0
    ? syncedLines
    : (plainLyrics ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ timeMs: null, text: line }));
  const withRomanization = mergeSecondaryLyrics(primaryLines, romanizationLyrics, 'romanization');
  return mergeSecondaryLyrics(withRomanization, translationLyrics, 'translation');
};
