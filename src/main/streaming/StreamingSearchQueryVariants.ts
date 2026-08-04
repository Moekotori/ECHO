import { chineseSearchVariants } from '../library/ChineseSearchVariants';

const normalizeQuery = (query: string): string =>
  query
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();

const addVariant = (variants: string[], value: string): void => {
  const normalized = normalizeQuery(value);
  if (normalized && !variants.includes(normalized)) {
    variants.push(normalized);
  }
};

export const streamingSearchQueryVariants = (query: string, limit = 12): string[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const variants: string[] = [];
  for (const variant of chineseSearchVariants(normalized)) {
    addVariant(variants, variant);
  }

  const spaced = normalized.replace(/[\p{P}\p{S}_]+/gu, ' ');
  addVariant(variants, spaced);

  const compact = spaced.replace(/\s+/gu, '');
  if (compact.length >= 2) {
    addVariant(variants, compact);
    for (const variant of chineseSearchVariants(compact)) {
      addVariant(variants, variant);
    }
  }

  const tokens = spaced.split(/\s+/u).filter(Boolean);
  if (tokens.length > 1 && tokens.length <= 4) {
    addVariant(variants, tokens.slice().reverse().join(' '));
    addVariant(variants, tokens.join(''));
  }

  return variants.slice(0, limit);
};
