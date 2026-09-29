import type { LyricsProviderId, LyricsSource, TrackLyrics } from '../../shared/types/lyrics';

export type SecondaryLyricsField = 'translation' | 'romanization';

const secondaryLineTimingToleranceMs = 500;
const lyricsRefreshMissTtlMs = 5 * 60 * 1000;
const maxLyricsRefreshMissEntries = 512;
const wordTimingRefreshProviders = new Set<LyricsProviderId>(['amll-ttml', 'netease', 'qqmusic']);

const normalizeLineIdentity = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const hasActiveLyricsRefreshMiss = (misses: Map<string, number>, key: string): boolean => {
  const expiresAt = misses.get(key);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    misses.delete(key);
    return false;
  }
  return true;
};

export const rememberLyricsRefreshMiss = (misses: Map<string, number>, key: string): void => {
  const nowMs = Date.now();
  for (const [missKey, expiresAt] of misses) {
    if (expiresAt <= nowMs) {
      misses.delete(missKey);
    }
  }

  misses.delete(key);
  misses.set(key, nowMs + lyricsRefreshMissTtlMs);
  while (misses.size > maxLyricsRefreshMissEntries) {
    const oldest = misses.keys().next();
    if (oldest.done) {
      return;
    }
    misses.delete(oldest.value);
  }
};

export const isWordTimingRefreshProvider = (provider: LyricsSource): provider is LyricsProviderId =>
  wordTimingRefreshProviders.has(provider as LyricsProviderId);

export const matchesCachedLyricsIdentity = (
  cached: Pick<TrackLyrics, 'provider' | 'providerLyricsId'>,
  provider: LyricsProviderId,
  providerLyricsId: string | null | undefined,
): boolean =>
  Boolean(
    cached.providerLyricsId &&
    cached.provider === provider &&
    cached.providerLyricsId === providerLyricsId,
  );

export const mergeSecondaryFieldsFromLyrics = (
  target: TrackLyrics,
  source: TrackLyrics,
  fields: SecondaryLyricsField[],
): TrackLyrics => {
  const usedSourceIndexes = new Set<number>();
  let changed = false;
  const lines = target.lines.map((line) => {
    let closestIndex = -1;
    let closestDeltaMs = Number.POSITIVE_INFINITY;
    for (let index = 0; index < source.lines.length; index += 1) {
      if (usedSourceIndexes.has(index)) {
        continue;
      }

      const candidate = source.lines[index];
      if (normalizeLineIdentity(candidate.text) !== normalizeLineIdentity(line.text)) {
        continue;
      }

      const bothUntimed = line.timeMs < 0 && candidate.timeMs < 0;
      const deltaMs = bothUntimed ? index : Math.abs(candidate.timeMs - line.timeMs);
      if (!bothUntimed && deltaMs > secondaryLineTimingToleranceMs) {
        continue;
      }
      if (deltaMs < closestDeltaMs) {
        closestIndex = index;
        closestDeltaMs = deltaMs;
      }
    }

    const match = closestIndex >= 0 ? source.lines[closestIndex] : null;
    if (!match) {
      return line;
    }

    const patch: Partial<Pick<TrackLyrics['lines'][number], SecondaryLyricsField>> = {};
    for (const field of fields) {
      const secondaryText = match[field]?.trim();
      if (secondaryText && !line[field]?.trim()) {
        patch[field] = secondaryText;
      }
    }
    if (Object.keys(patch).length === 0) {
      return line;
    }

    usedSourceIndexes.add(closestIndex);
    changed = true;
    return { ...line, ...patch };
  });

  return changed ? { ...target, lines } : target;
};
