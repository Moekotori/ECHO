import type { ArtistMergeStrategy } from '../../shared/types/appSettings';

export type ArtistMergeExisting = {
  key: string;
  name: string;
  trackIds: ReadonlySet<string>;
  albumIds: ReadonlySet<string>;
};

export type ArtistMergeContext = {
  trackId?: string | null;
  albumId?: string | null;
};

const defaultStrategy: ArtistMergeStrategy = 'standard';
const zeroWidthPattern = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;
const combiningMarkPattern = /[\u0300-\u036f]/gu;
const punctuationAndSpacePattern = /[\p{P}\p{Z}\p{S}]/gu;
const artistNameSeparatorPattern = /\s*(?:\/|,|;|；|×)\s*|(?<!\s)&(?!\s)|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/iu;
const trailingAsciiNoisePattern = /[\s._\-~!'"`]+$/u;
const standardSuffixPatterns: RegExp[] = [
  /\s*(?:\+|\uff0b)\s*(?:81|86|886|852|853|1|44)$/iu,
  /\s*(?:-|–|—|:|\|)\s*(?:official|topic|music|channel|vevo)$/iu,
  /\s+(?:official|topic|music|channel|vevo)$/iu,
];

const normalizeDisplayText = (value: unknown): string =>
  typeof value === 'string' ? value.normalize('NFKC').replace(zeroWidthPattern, '').replace(/\s+/gu, ' ').trim() : '';

const removeDiacritics = (value: string): string => value.normalize('NFKD').replace(combiningMarkPattern, '').normalize('NFKC');

const compactComparableKey = (value: string): string =>
  removeDiacritics(normalizeDisplayText(value)).toLocaleLowerCase().replace(punctuationAndSpacePattern, '');

const stripStandardSuffixes = (value: string): string => {
  let current = normalizeDisplayText(value);

  for (const pattern of standardSuffixPatterns) {
    current = current.replace(pattern, '').trim();
  }

  return current || normalizeDisplayText(value);
};

export const normalizeArtistMergeStrategy = (value: unknown): ArtistMergeStrategy =>
  value === 'conservative' || value === 'standard' ? value : defaultStrategy;

export const splitArtistCreditParts = (value: string): string[] => value.split(artistNameSeparatorPattern);

export const artistMergeKeyForName = (name: unknown, strategy: ArtistMergeStrategy = defaultStrategy): string => {
  const normalized = normalizeDisplayText(name);
  if (!normalized) {
    return '';
  }

  if (strategy === 'conservative') {
    return compactComparableKey(normalized);
  }

  return compactComparableKey(stripStandardSuffixes(normalized));
};

const boundedLevenshteinDistance = (left: string, right: string, limit: number): number => {
  if (left === right) {
    return 0;
  }

  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMinimum = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > limit) {
      return limit + 1;
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length];
};

const similarityScore = (left: string, right: string): number => {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 1;
  }

  const allowedDistance = Math.max(1, Math.floor(maxLength * 0.12));
  const distance = boundedLevenshteinDistance(left, right, allowedDistance);
  return distance > allowedDistance ? 0 : 1 - distance / maxLength;
};

const hasContextOverlap = (existing: ArtistMergeExisting, context?: ArtistMergeContext): boolean =>
  Boolean((context?.trackId && existing.trackIds.has(context.trackId)) || (context?.albumId && existing.albumIds.has(context.albumId)));

const canUseFuzzyMatch = (candidateKey: string, existingKey: string): boolean => {
  const minLength = Math.min(candidateKey.length, existingKey.length);
  if (minLength < 7) {
    return false;
  }

  return candidateKey.slice(0, 3) === existingKey.slice(0, 3) || candidateKey.slice(-3) === existingKey.slice(-3);
};

export const findArtistMergeKey = (
  name: string,
  existingArtists: Iterable<ArtistMergeExisting>,
  strategy: ArtistMergeStrategy,
  context?: ArtistMergeContext,
): string => {
  const candidateKey = artistMergeKeyForName(name, strategy);
  if (!candidateKey || strategy === 'conservative') {
    return candidateKey;
  }

  let bestKey = candidateKey;
  let bestScore = 0;

  for (const existing of existingArtists) {
    if (candidateKey === existing.key) {
      return existing.key;
    }

    if (!canUseFuzzyMatch(candidateKey, existing.key)) {
      continue;
    }

    const overlap = hasContextOverlap(existing, context);
    const score = similarityScore(candidateKey, existing.key);
    const threshold = overlap ? 0.86 : 0.96;

    if (score >= threshold && score > bestScore) {
      bestKey = existing.key;
      bestScore = score;
    }
  }

  return bestKey;
};

const displayNameQuality = (value: string): number => {
  const normalized = normalizeDisplayText(value);
  if (!normalized) {
    return -100;
  }

  let score = 0;
  if (!trailingAsciiNoisePattern.test(normalized)) {
    score += 4;
  }
  if (!standardSuffixPatterns.some((pattern) => pattern.test(normalized))) {
    score += 3;
  }
  if (/[a-z]/u.test(normalized) && /[A-Z]/u.test(normalized)) {
    score += 1;
  }

  return score;
};

export const chooseArtistDisplayName = (currentName: string, nextName: string): string => {
  const current = normalizeDisplayText(currentName);
  const next = normalizeDisplayText(nextName);

  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }

  const currentQuality = displayNameQuality(current);
  const nextQuality = displayNameQuality(next);
  if (nextQuality !== currentQuality) {
    return nextQuality > currentQuality ? next : current;
  }

  return current;
};

export const artistNameMatchesMergeKey = (
  name: unknown,
  targetKey: unknown,
  strategy: ArtistMergeStrategy = defaultStrategy,
): boolean => {
  const key = typeof targetKey === 'string' ? targetKey : '';
  return Boolean(key && artistMergeKeyForName(name, strategy) === key);
};
