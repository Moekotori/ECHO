import { pinyin } from 'pinyin-pro';
import { librarySortTextCache as sortKeyCache } from './libraryTextCaches';

const hanRunPattern = /\p{Script=Han}+/gu;
const combiningMarkPattern = /[\u0300-\u036f]/gu;

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
  if (cached !== undefined && cached !== null) {
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

  sortKeyCache.set(text, sortKey);
  return sortKey;
};

export const libraryTextOrderSql = (columnSql: string, direction: 'ASC' | 'DESC' = 'ASC'): string =>
  `echo_library_sort_key(${columnSql}) COLLATE NOCASE ${direction}, ${columnSql} COLLATE NOCASE ${direction}`;
