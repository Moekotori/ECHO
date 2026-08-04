import { pinyin } from 'pinyin-pro';

const hanRunPattern = /\p{Script=Han}+/gu;
const combiningMarkPattern = /[\u0300-\u036f]/gu;
const maxSortKeyCacheEntries = 4096;
const sortKeyCache = new Map<string, string>();

const normalizeSortText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(combiningMarkPattern, '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();

export const libraryTextSortKey = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.normalize('NFKC').trim();
  if (!text) {
    return '';
  }

  const cached = sortKeyCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  const sortKey = normalizeSortText(
    text.replace(hanRunPattern, (match) =>
      pinyin(match, { toneType: 'none', type: 'array' })
        .map((syllable) => normalizeSortText(syllable))
        .filter(Boolean)
        .join(' '),
    ),
  );

  if (sortKeyCache.size >= maxSortKeyCacheEntries) {
    const oldestKey = sortKeyCache.keys().next().value as string | undefined;
    if (oldestKey) {
      sortKeyCache.delete(oldestKey);
    }
  }
  sortKeyCache.set(text, sortKey);
  return sortKey;
};
